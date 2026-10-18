# Stack pack specification

A stack pack is a Claude Code plugin that depends on `cuadrilla` (the core) and teaches the team
one stack in depth. The core works for any language; a pack adds **concrete rules, a specialist
agent, the project configuration and the CI/deploy templates** for its stack.

Everything a pack ships is written in **English** (prompts perform best and the product is sold
globally). The team *answers* in the user's chosen language: agents say so explicitly.

## Layout

```
plugins/cuadrilla-<pack>/
├── .claude-plugin/plugin.json     name, displayName, version 1.0.0, description, author
│                                  {"name": "Elmer Mejías"}, license "MIT",
│                                  keywords, "dependencies": ["cuadrilla"]
├── agents/<agent>.md              the specialist implementer (one; frontend-react for the React pack)
├── skills/stack-<id>/
│   ├── SKILL.md                   the stack standard (rules). Model-invocable, not user-invocable
│   ├── component.json             cuadrilla.json component template + forbidden patterns
│   ├── reference/*.md             deeper rules loaded on demand (architecture, api, data, testing…)
│   └── templates/                 files /cuadrilla:adopt copies into the project
│       ├── ci-job.yml             one GitHub Actions job for this component
│       ├── Dockerfile             (backend packs) production image
│       ├── .dockerignore
│       └── …                      stack-specific extras (e.g. vercel.json for React)
├── skills/feature-<id>/SKILL.md   user-invocable: scaffold a full feature in this stack
├── .mcp.json                      (optional) stack MCP servers; secrets via ${ENV_VAR} only
└── README.md                      what the pack enforces, recommended third-party skills
```

Stack ids: `python-fastapi`, `dotnet`, `node-typescript`, `java-spring`, `react`.

## `skills/stack-<id>/SKILL.md`

Frontmatter:

```yaml
---
name: stack-<id>
description: <Stack> standard for cuadrilla projects — architecture, API, data access, testing and tooling rules. Load before writing, reviewing or planning <language/framework> code in a component whose stack is "<id>" in .claude/cuadrilla.json.
user-invocable: false
paths: "**/*.<ext>, **/<manifest file>"
---
```

`paths` makes Claude load the standard automatically when it touches files of that stack. In
the body, reference sibling files as `${CLAUDE_SKILL_DIR}/reference/x.md` and
`${CLAUDE_SKILL_DIR}/templates/…` (this variable expands to the skill folder inside the
installed plugin).

Body (concise, imperative, testable rules — every rule must be checkable in a diff):

1. **Scope** — stack, versions policy ("version pinned in <file>"), prohibited technologies.
2. **Architecture** — layers/folders table (contains / prohibited / may import) and how the
   dependency rule is enforced by a tool in CI (import-linter, NetArchTest/ArchUnit,
   dependency-cruiser/eslint-plugin-boundaries…).
3. **API** — the standard envelope `{ status, message, data, errors, meta }` with
   `status ∈ Success|Created|Error`, camelCase JSON, validation errors → 400 with
   `errors: { field: [messages] }`, domain exceptions carry their HTTP status, one central
   exception handler, controllers/routers thin, auth on by default, permission checks
   declarative, `GET /health`.
4. **Data** — parametrized SQL only; naming; connections from config; read-only connections;
   transactions; pagination in the database; migrations numbered and never executed by Claude.
5. **Validation, logging, configuration, current user** — stack-idiomatic.
6. **Testing** — what is mandatory (service + validator tests, auth tests, a test per bug),
   tools, naming, fakes vs mocks, no skipped tests.
7. **Tooling** — formatter, linter, type checker, test runner: the exact commands, matching
   `component.json`.
8. **Files in this skill** — list `${CLAUDE_SKILL_DIR}/component.json`,
   `${CLAUDE_SKILL_DIR}/reference/*`, `${CLAUDE_SKILL_DIR}/templates/*` with one line each and
   when to read them.

Keep `SKILL.md` under ~250 lines; move detail to `reference/`.

## `component.json`

```json
{
  "stack": "<id>",
  "agent": "cuadrilla-<pack>:<agent-name>",
  "defaultPath": "backend",
  "detect": ["pyproject.toml"],
  "component": {
    "setup": "...",
    "checks": [{ "name": "...", "run": "..." }],
    "format": [{ "glob": "**/*.ext", "run": ["tool", "...", "{file}"] }],
    "lint":   [{ "glob": "**/*.ext", "run": ["tool", "...", "{file}"] }],
    "start":  { "run": "...", "port": 8000, "health": "http://localhost:8000/health" },
    "audit": "..."
  },
  "forbidden": [
    { "glob": "**/*.ext", "pattern": "<js regex>", "message": "...", "tests": true }
  ],
  "protectedPaths": [],
  "recommendedSkills": [
    { "source": "owner/repo", "skill": "name", "why": "...", "conflicts": "what to ignore" }
  ]
}
```

- `format`/`lint` must be **fast** single-file commands (< 1 s ideally, never more than a few
  seconds) or be omitted (then only CI checks). Never put a whole-solution build there.
- **Never `npx` in `format`/`lint`**: it costs 2–60 s per call on Windows. Call the package's
  entry point with `"node"` (`node_modules/prettier/bin/prettier.cjs`). For tools with a slow
  startup (ESLint with plugins ≈ 3–5 s) use a resident variant (`eslint_d`) in `run` and the plain
  tool in `fallback`, which the hook uses when the resident one isn't installed.
- `forbidden` patterns complement the core built-ins (don't repeat print/console.log/etc.):
  stack-specific prohibitions (ORM where forbidden, framework anti-patterns, SQL concatenation
  forms specific to the data library).
- `{file}` and paths: globs are relative to the component path.

## `templates/ci-job.yml`

A single job, indented as it goes under `jobs:`, with placeholders `<name>`, `<path>` and the
toolchain version placeholder(s). Requirements (they mirror `standard-github`):
`name: ci-<name>`, `runs-on: ubuntu-latest`, `timeout-minutes`, `defaults.run.working-directory: <path>`,
`actions/checkout@v7` with `persist-credentials: false`, official `actions/setup-*` by major tag,
third-party actions pinned by full SHA with the version in a comment, then `setup` and every
`checks[].run` in the same order as `component.json`. Use an ephemeral `services:` database only
if tests need one.

## The agent

```yaml
---
name: <agent-name>
description: <Stack> specialist implementer for cuadrilla projects … Use for … in components whose stack is "<id>".
tools: Read, Glob, Grep, Edit, Write, Bash, PowerShell, Skill
model: sonnet
---
```

Body sections: **Before writing** (read the profile and `.claude/cuadrilla.json`; load
`stack-<id>` and the core `cuadrilla:standard-core`, `cuadrilla:standard-testing`,
`cuadrilla:standard-security` skills with the Skill tool; find a similar existing feature and
follow it; third-party skills are reference only), **Checklist before handing off** (concrete,
stack-specific, ends with running every `checks[].run` of the component and reporting real
results), **Limits** (no SQL execution, no migrations run, no new dependencies without
confirmation, no commits/pushes), **Hand-off** (files touched, contract implemented, check
results), and the line: "Answer in the team's response language (session context or
`language` in .claude/cuadrilla.json; default ${user_config.response_language})."

Do not set `hooks`, `mcpServers` or `permissionMode` in plugin agent frontmatter (ignored).

## `skills/feature-<id>/SKILL.md`

```yaml
---
name: feature-<id>
description: Scaffold a complete <stack> feature (all layers + tests) following the cuadrilla standard.
argument-hint: "<FeatureName> <short description>"
disable-model-invocation: true
---
```

Body: delegate to the pack agent; list the expected files per layer; show the file list and
contract first and wait for OK; run the component checks; end with the core `reviewer`.

## Quality bar

- Every rule is concrete and verifiable in a diff; no generic advice ("write clean code").
- No project-specific names: use `<app>`, `<schema>`, `<prefix>_` and refer to the profile.
- Versions: name the current major line, and tell the agent to check the pinned version and
  Context7 docs instead of assuming APIs.
- No third-party content copied into the pack. Third-party skills are only *recommended* in
  `component.json` (`recommendedSkills`) and `README.md`, with source and why.
