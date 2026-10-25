# Cuadrilla — an engineering team for Claude Code

*[Leer en español](README.es.md)*

Cuadrilla turns [Claude Code](https://claude.com/claude-code) into an **engineering team with a
written standard**: an orchestrator that plans and delegates, stack specialists that implement in
parallel, reviewers that never edit, a security auditor, QA in a real browser — and **guardrail
hooks** that make the limits real instead of hopeful prompt text.

It works with **any language**. Stack packs add deep, opinionated rules for Python/FastAPI,
.NET, Node/TypeScript, Java/Spring and React.

```
                       ┌────────────────────┐
     request ────────▶ │    orchestrator    │  reads the project profile,
                       │                    │  fixes the contract, delegates
                       └─────────┬──────────┘
        ┌────────────────┬───────┴────────┬────────────────┐
        ▼                ▼                ▼                ▼
  backend-python   backend-dotnet   backend-node     frontend-react   … or `developer`
  backend-java     (stack packs: concrete rules, CI job, Dockerfile)    for any other stack
        └────────────────┴───────┬────────┴────────────────┘
                                 ▼
              /cuadrilla:verify  — the same checks as CI, from .claude/cuadrilla.json
                                 ▼
        reviewer  ‖  code-reviewer  ‖  security        (never edit; findings by severity)
                                 ▼
              qa (Playwright)  ‖  docs-writer
                                 ▼
        PR ──▶ GitHub Actions: ci-<component> + claude-review (inline comments)
```

## Why use it

- **Limits in code, not in prompts.** The `guard` hook inspects the *whole* command, so
  `cd api && git push`, `bash -c "…"` or `type .env` are blocked just like `git push`. It also
  refuses to write secrets (API keys, tokens, private keys, connection strings with passwords)
  into any file. 97 automated tests back it.
- **One source of truth for checks.** `.claude/cuadrilla.json` declares how every component is set
  up, checked, formatted, started and audited. `/cuadrilla:verify`, the hooks and the generated
  CI all read it — local and CI never drift.
- **Contract first, then parallel work.** Cross-component features start with an explicit
  contract (endpoint, DTOs, envelope, errors, permission), then each stack specialist works in
  parallel.
- **Reviews that a human can trust.** Reviewers don't edit, confirm every finding in the code,
  rank by severity with `file:line`, and end with a verdict. On GitHub, every PR gets inline
  comments from Claude — advisory, never auto-approving.
- **Answers in your language.** Prompts are written in English for quality; the team answers,
  comments code and writes docs in English, Spanish or Portuguese (chosen at install).
- **Small footprint.** ~2.8k tokens always-on; everything else loads on demand.

## What's inside

| Plugin | What it adds |
|---|---|
| `cuadrilla` (core) | 8 agents (orchestrator, developer, reviewer, code-reviewer, security, qa, docs-writer, legacy-analyst) · 7 standard skills (core, architecture, API, data, testing, security, GitHub/CI) · 18 commands · 5 hooks · GitHub, Atlassian and Playwright MCP |
| `cuadrilla-python-fastapi` | Python + FastAPI + PostgreSQL (psycopg 3, hand-written SQL, uv/ruff/mypy/pytest) |
| `cuadrilla-dotnet` | .NET + ASP.NET Core (4 projects, Dapper or EF Core, FluentValidation, xUnit) |
| `cuadrilla-node-typescript` | Node + TypeScript API (Fastify, Zod, pg/Kysely, Vitest) |
| `cuadrilla-java-spring` | Java + Spring Boot (JdbcClient or JPA, Flyway, ArchUnit, JUnit 5) |
| `cuadrilla-react` | React + TypeScript + Vite + Tailwind v4 frontend for any backend pack |
| `cuadrilla-codex` (optional) | OpenAI Codex CLI as second executor/reviewer, always verified by Claude |

### Commands

| Command | What it does |
|---|---|
| `/cuadrilla:adopt [new]` | Detects components and stacks, writes the profile and `.claude/cuadrilla.json`, generates CI + PR review workflow, proposes permissions and skills, reports gaps |
| `/cuadrilla:feature <Name> <desc>` | Contract → parallel implementation → verify → review → QA |
| `/cuadrilla:ticket <KEY \| #issue>` | Jira ticket or GitHub issue end to end, criterion by criterion |
| `/cuadrilla:verify [component]` | Every component's checks (= CI), results table |
| `/cuadrilla:review`, `/cuadrilla:deep-review` | Standard compliance / deep technical review |
| `/cuadrilla:security-audit` | OWASP-based audit + dependency audits |
| `/cuadrilla:review-pr <n> [--comment]` | Multi-agent review of a GitHub PR; posts a summary only with your OK |
| `/cuadrilla:commit`, `/cuadrilla:pr` | Commit message and PR description in your language (draft PR with OK) |
| `/cuadrilla:migration <change>` | Next numbered migration script — never executed |
| `/cuadrilla:run`, `/cuadrilla:qa <flow>` | Start the app; test a flow in a real browser |
| `/cuadrilla:deploy-check` | Pre-deploy readiness (any platform); never deploys |
| `/cuadrilla:analyze-system <path>` | Survey a legacy system and write the migration report |
| `/cuadrilla:find-skill <topic>` | Find, vet and install skills from skills.sh |
| `/cuadrilla:doctor` | Diagnose tools, hooks, config, packs and MCP credentials |
| `/cuadrilla:report [days] [anonymous]` | Local metrics: what the guard blocked, which forbidden patterns keep coming back, where lint fails, which agents are used — with the 3 most repeated patterns and a fix proposed for each |

### Hooks

| Hook | When | What |
|---|---|---|
| `guard` | before every tool | **Denies** push, history rewrites, recursive deletes, `--no-verify`, merging/approving PRs, repo secrets, deploys, cloud/cluster/IaC changes, package publishing, unsandboxed agents, reading/dumping secret files or the environment, writing secrets. **Asks** before SQL, migrations, merge/rebase, forced installs. In [unattended mode](#unattended-mode) every "ask" becomes a deny. |
| `format` | after every edit | Runs the component's formatter/linter from `cuadrilla.json` (or ruff / Prettier / gofmt by default) and feeds lint errors back to Claude. |
| `stop-check` | before ending a turn | Scans added lines for forbidden patterns — built-in for Python, JS/TS, C#, Java/Kotlin, Go, Rust, plus each pack's and project's own — and hands the turn back once. |
| `session-context` | session start | Branch, pending changes, profile/config status and the team's ground rules. |
| `usage` | agent / skill calls, slash commands | Records which agents, skills and commands are used — names only, never prompts or arguments. |

Every hook also writes to the local [metrics](#metrics).

## Install

Requirements: Claude Code, Node.js ≥ 18 (hooks), git. Optional: `gh`, Docker.

```text
/plugin marketplace add ing-Elmer/cuadrilla          # the GitHub repo
/plugin install cuadrilla@cuadrilla                      # choose the response language
/plugin install cuadrilla-python-fastapi@cuadrilla       # the packs for your stacks
/plugin install cuadrilla-react@cuadrilla
```

Then, in your project:

```text
/cuadrilla:adopt          # existing project
/cuadrilla:adopt new      # from scratch
/cuadrilla:doctor         # check everything is wired
```

See [docs/GETTING-STARTED.md](docs/GETTING-STARTED.md), [docs/CONFIG.md](docs/CONFIG.md)
(`.claude/cuadrilla.json`) and [docs/PACK-SPEC.md](docs/PACK-SPEC.md) (write your own pack).

## MCP servers

| Server | Plugin | Setup |
|---|---|---|
| `github` | core | **Optional.** `GITHUB_PAT` environment variable (fine-grained token, this repo only). Without it the server shows as failed in `/mcp` ("Authorization header is badly formatted"); that is expected and harmless: Cuadrilla falls back to the `gh` CLI |
| `atlassian` | core | **Optional.** OAuth via `/mcp`; only needed for Jira/Confluence. Shows as "needs auth" until you log in |
| `playwright` | core | none (used by the `qa` agent) |
| `postgres` (read-only) | python-fastapi, node-typescript | `POSTGRES_MCP_DSN` pointing to a **local** database |
| `microsoft-learn` | dotnet | none |

Credentials are only read from environment variables; nothing secret is stored in the plugins.
See [MCP credentials](docs/GETTING-STARTED.md#4-mcp-credentials-optional) for how to set them on Windows, macOS and Linux.

## Unattended mode

Run the team with nobody watching — from a scheduler, a CI job or an agent runner such as
OpenJarvis — and review the result as a draft PR. The runner sets the variables in the
environment of the `claude` process; they can't be turned on from the repository, so the agent
can't enable them for itself.

```bash
export CUADRILLA_UNATTENDED=1
export CUADRILLA_AGENT_BRANCH_PREFIX=agent/   # optional, this is the default
claude -p "/cuadrilla:ticket #42"
```

What changes:

- **Confirmations become denies.** Merge/rebase, SQL, migrations and forced installs are
  blocked, because a confirmation nobody answers would hang the run.
- **One push is allowed:** exactly `git push [-u] origin <prefix><name>`, as a single command.
  Force, delete, tags, mirror, several refspecs, other remotes, chained or wrapped commands and
  any other branch stay denied. Remotes, URL rewrites, `git -c` and `.git/` can't be changed,
  so that push can only reach the original `origin`.
- **PRs are drafts:** `gh pr create` must use `--draft`. Merging, approving and marking ready
  stay denied.
- The agents are told at session start: they don't stop to ask, they record their **Decisions
  taken**, and `/cuadrilla:ticket` ends with a draft PR that puts failing checks first.

Run it in a disposable container or VM with a clean clone, a fine-grained token limited to that
repository (contents and pull requests), and branch protection on the base branch.

## Metrics

The hooks keep a local log in `.claude/cuadrilla/metrics.jsonl` of what gets in the team's way:
which guard rule blocked or asked (by rule id), which forbidden patterns `stop-check` found (by
pattern and file extension), how many lint problems each component had, and which agents, skills
and commands were used. `/cuadrilla:report` turns it into a report and explains the three most
repeated patterns with a concrete fix, so the standard improves with evidence.

- **It never records** commands, prompts, task descriptions, code, file paths or secrets.
- **It stays on the machine:** the folder ignores itself in git; nothing is sent anywhere.
- `/cuadrilla:report 30 anonymous` also hides component names and project rules and drops session
  ids, so the report can be shared with whoever maintains the kit.
- Turn it off with `"metrics": false` in `.claude/cuadrilla.json` or `CUADRILLA_METRICS=off`.

## Evals

Changes to the kit itself are measured, not guessed. [`evals/`](evals/README.md) runs reference
tasks end to end with the agent team in unattended mode — a bug fix, a feature with validation, a
request to hard-code a password and push to `main` — judges them with hidden tests and strict
expectations on the diff, and compares two versions of the kit by pass rate, cost and turns.
Every case ships a reference solution, and CI proves on each push that every case is fair.

The [curator](curator/README.md) closes the loop: it reads anonymous reports from the projects
that use Cuadrilla, proposes at most two small changes to the agents' and skills' instructions
for the most repeated patterns, keeps only those the evals show are better, and opens them as
draft PRs. It can't run commands, can't touch hooks, security rules or the evals, and never
merges.

## Security model

- Hard limits live in the `guard` hook (plugins can't ship permission rules). `/cuadrilla:adopt`
  also offers project permission rules (`.claude/settings.json`) as a second layer.
- Third-party skills are **not bundled**. Packs recommend them; `/cuadrilla:find-skill` installs
  each one in a scratch folder, reads it for conflicts and risky instructions, and only then
  installs it with your OK.
- The PR review workflow runs only on same-repo PRs, with minimal permissions, a SHA-pinned
  action and restricted tools.

## License

MIT — see [LICENSE](LICENSE). Third-party skills recommended by the packs keep
their own licenses and are installed from their original sources.
