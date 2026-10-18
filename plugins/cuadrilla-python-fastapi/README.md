# cuadrilla-python-fastapi

Stack pack for [cuadrilla](../cuadrilla): teaches the cuadrilla team to build **Python + FastAPI +
PostgreSQL** backends to one written standard. Requires the `cuadrilla` core plugin.

Stack: Python 3.13 line, FastAPI, Pydantic v2 + pydantic-settings, psycopg 3 (async) +
psycopg_pool, hand-written SQL on PostgreSQL, PyJWT + bcrypt, managed with `uv`, checked with
ruff, mypy `--strict`, import-linter and pytest (+ pytest-asyncio, httpx).

## What it adds

| Component | Purpose |
|---|---|
| `backend-python` agent | Specialist implementer: endpoints, services, validators, repositories, DTOs, tests, SQL scripts. Hands off with real check results. |
| `stack-python-fastapi` skill | The standard (auto-loaded on `*.py` / `pyproject.toml`), with `reference/` docs and `templates/`. |
| `/cuadrilla-python-fastapi:feature-python-fastapi` | Scaffold a full feature across the 4 layers + tests; shows the plan and contract first, ends with the core reviewer. |
| `component.json` | What `/cuadrilla:adopt` writes into `.claude/cuadrilla.json`: setup, checks, per-file format/lint, start, audit, forbidden patterns. |
| Templates | `ci-job.yml` (GitHub Actions job), `Dockerfile`, `.dockerignore`, `pyproject.example.toml`, `.env.example`, optional `railway.toml`. |
| `postgres` MCP server | Read-only schema inspection of your local database (optional, see below). |

## What it enforces

- **4 layers** in `backend/src/<app>/`: `api` (routers, composition root, security, error
  handlers) → `application` (services, validators) | `infrastructure` (psycopg repositories) →
  `core` (DTOs, Protocols, settings, exceptions). Enforced in CI by **import-linter** contracts,
  including "routers never import infrastructure" and "application/core never import FastAPI or
  psycopg".
- **One response envelope** `ApiResponse[T]` = `{ status, message, data, errors, meta }`,
  camelCase JSON via `CamelModel`, validation errors as **400** with `errors: { field: [...] }`.
- **Domain exceptions** (`DomainError` with `status_code`) translated in one place; routers
  without `try/except` or `HTTPException`.
- **Auth on by default** (`get_current_user` on every protected router) and declarative
  permissions (`require_permission("CODE")`); JWT with fixed algorithm, bcrypt cost ≥ 12, rotated
  hashed refresh tokens.
- **No ORM**: hand-written, parametrized SQL (`%(name)s`) with `class_row`, connections only via
  a pooled `ConnectionFactory`, read-only connections enforced, pagination in SQL.
- **SQL migrations** `NNN_<verb>_<description>.sql`, idempotent — written by Claude, **never
  executed** by Claude.
- **Typed config** with pydantic-settings and `SecretStr`; no `os.getenv`.
- **Tests**: services/validators with fake repositories, routers with `httpx` +
  `dependency_overrides`, mandatory auth/permission tests, no skipped tests.
- **Same checks locally and in CI**: `uv sync --frozen` → `ruff check` → `ruff format --check`
  → `mypy` → `lint-imports` → `pytest`.

The cuadrilla stop-check hook additionally flags, in the lines Claude adds: ORM/psycopg2 imports,
SQL built with `%`/`+`/`.format()`, `HTTPException`/`try`/`JSONResponse`/sync `def` in routers,
`os.getenv`/`os.environ` outside settings, token reading outside `api/security.py`, CORS `"*"`,
bcrypt cost < 12 and disabled JWT verification (on top of the core built-ins such as `print`,
f-string SQL, `# type: ignore` without code and skipped tests).

## Installation

```
/plugin install cuadrilla-python-fastapi@cuadrilla
```

Then run `/cuadrilla:adopt` in your project: it detects `pyproject.toml`, adds the component to
`.claude/cuadrilla.json`, and offers to copy the templates (replace `<app>`, `<path>`, `<name>`,
`<APP>` with your profile values).

## Optional: read-only PostgreSQL MCP

The pack declares a `postgres` MCP server
([`postgres-mcp`](https://pypi.org/project/postgres-mcp/), run with `uvx`) in
**`--access-mode=restricted`** (read-only transactions, bounded execution). The agent uses it only
to read table, column and index definitions before writing a repository; it never runs
migrations or DML through it.

Setup:

1. Have `uv` installed (provides `uvx`).
2. Create a **read-only role** on your **local/development** database (never production), e.g.
   with `SELECT` on the project schema only.
3. Export the DSN before starting Claude Code (it is read from the environment, never stored in
   the plugin):
   ```bash
   export POSTGRES_MCP_DSN="postgresql://readonly_user:<password>@localhost:5432/<db>"
   ```
   PowerShell: `$env:POSTGRES_MCP_DSN = "postgresql://..."`.
4. If you do not want it, disable the `postgres` server with `/mcp`.

## Recommended third-party skills

Not bundled — install them yourself if you want them. The cuadrilla standard takes precedence; the
`component.json` `recommendedSkills` list says what to ignore in each.

| Skill | Source | Why | Ignore |
|---|---|---|---|
| `fastapi` | [fastapi/fastapi](https://github.com/fastapi/fastapi) | Official FastAPI idioms (Annotated dependencies, lifespan, testing). | SQLModel/ORM, sync `def` by default, returning the model directly, `ty` instead of mypy. |
| `async-python-patterns` | [wshobson/agents](https://github.com/wshobson/agents) | asyncio patterns, timeouts, cancellation. | Ad-hoc `create_task` in handlers (use the lifespan queue). |
| `python-testing-patterns` | [wshobson/agents](https://github.com/wshobson/agents) | pytest fixtures, parametrization, async tests. | SQLAlchemy-based examples (use fake repositories). |
| `supabase-postgres-best-practices` | [supabase/agent-skills](https://github.com/supabase/agent-skills) | PostgreSQL indexing, query plans, schema design. | Supabase-specific RLS / `auth.uid()` unless your profile uses Supabase. |

## License

MIT — see the root [LICENSE](../../LICENSE).
