# `.claude/cuadrilla.json` — project configuration

`/cuadrilla:adopt` creates this file in the buyer's project. It is the **single source of truth**
for how each part of the project is built, checked, formatted and started. The hooks read it,
`/cuadrilla:verify` runs its `checks`, and the CI workflow is generated from it, so local checks
and CI never drift apart.

Human-facing facts (domain, connections, roles, deploy targets) live in the
`## Project profile` section of `CLAUDE.md`. Machine-facing commands live here.

```jsonc
{
  "version": 1,
  "language": "Español",          // optional: overrides the plugin's response_language for this repo
  "baseBranch": "main",           // branch PRs target
  "components": [
    {
      "name": "api",              // short id; CI job is named ci-<name>
      "path": "backend",          // folder, relative to the repo root ("" or "." = root)
      "stack": "python-fastapi",  // pack stack id, or "generic"
      "agent": "cuadrilla-python-fastapi:backend-python", // implementer; "cuadrilla:developer" if no pack
      "setup": "uv sync --frozen",                       // install deps from the lockfile
      "checks": [                                        // what /cuadrilla:verify and CI run, in order
        { "name": "lint", "run": "uv run ruff check" },
        { "name": "format", "run": "uv run ruff format --check" },
        { "name": "types", "run": "uv run mypy" },
        { "name": "layers", "run": "uv run lint-imports" },
        { "name": "test", "run": "uv run pytest" }
      ],
      "format": [                                        // run by the format hook after each edit
        { "glob": "**/*.py", "run": ["uv", "run", "--no-sync", "ruff", "format", "{file}"] }
      ],
      "lint": [                                          // per-file lint; output goes back to Claude
        { "glob": "**/*.py", "run": ["uv", "run", "--no-sync", "ruff", "check", "--output-format", "concise", "{file}"] }
      ],
      "start": {                                         // used by /cuadrilla:run and the qa agent
        "run": "uv run uvicorn app.api.main:create_app --factory --reload --port 8000",
        "port": 8000,
        "health": "http://localhost:8000/health"
      },
      "audit": "uv run pip-audit"                        // dependency audit for /cuadrilla:security-audit
    }
  ],
  "forbidden": [                    // extra patterns for the stop-check hook (packs add theirs)
    { "glob": "backend/**/*.py", "pattern": "from sqlalchemy|import sqlmodel", "message": "ORM is not allowed by the standard", "tests": true }
  ],
  "protectedPaths": ["appsettings.Production.json"], // extra secret files for the guard hook
  "stopCheck": true,                // false disables the stop-check hook
  "builtinPatterns": true,          // false keeps only the "forbidden" list
  "metrics": true                   // false stops writing .claude/cuadrilla/metrics.jsonl
}
```

## Field reference

| Field | Used by | Notes |
|---|---|---|
| `language` | session-context hook, agents | Falls back to the plugin option chosen at install. |
| `baseBranch` | `/cuadrilla:pr`, `/cuadrilla:commit`, CI template | |
| `components[].checks[].run` | `/cuadrilla:verify`, CI | Shell strings, run with `cwd = path`. Keep them identical to CI. |
| `components[].format[]` / `lint[]` | format hook | `run` is an **array** (no shell). `{file}` = absolute path of the edited file. `glob` is relative to the component `path`. Optional `fallback` (array) runs when the `run` tool isn't installed. Keep them fast (< 1 s ideally): call the tool's entry point with `"node"` (e.g. `node_modules/prettier/bin/prettier.cjs`) instead of `npx` — npx costs 2–60 s per call on Windows — and use resident linters (`eslint_d`) when the plain tool takes seconds to start. `"node"` as first element runs with the same Node binary as the hooks. |
| `components[].start` | `/cuadrilla:run`, `qa` agent | `health` is polled until it answers. |
| `components[].audit` | `/cuadrilla:security-audit`, `/cuadrilla:deploy-check` | Read-only audit command. |
| `forbidden[]` | stop-check hook | `pattern` is a JavaScript regex (escape backslashes in JSON). `tests: false` skips test files. |
| `protectedPaths[]` | guard hook | Globs; a glob without `/` matches the file name anywhere. |
| `metrics` | every hook, `/cuadrilla:report` | `false` turns the local metrics off. Turning them **on** is the default, so this can only make the hooks record less. |

Without this file the hooks still work with built-in defaults (ruff, Prettier, gofmt; built-in
patterns for Python, JS/TS, C#, Java/Kotlin, Go and Rust).

## Environment variables (not in this file)

Some settings are deliberately **not** read from `.claude/cuadrilla.json`: the agent can edit files
in the repository, so a switch that loosens a guardrail must live where the agent can't reach it.
The runner that starts `claude` sets them in its environment.

| Variable | Default | Effect |
|---|---|---|
| `CUADRILLA_UNATTENDED` | off | `1`, `true`, `yes` or `on` turns on unattended mode: every guard "ask" becomes a deny, one plain push to an agent branch is allowed, `gh pr create` must be `--draft`, and the agents are told not to stop and ask. See the README's *Unattended mode*. |
| `CUADRILLA_METRICS` | on | `off`, `0`, `false` or `no` stops writing local metrics, whatever the config says. |
| `CUADRILLA_AGENT_BRANCH_PREFIX` | `agent/` | Branch prefix the unattended push may target. Must be a plain segment ending in `/` (e.g. `bot/`); anything else falls back to the default. |
