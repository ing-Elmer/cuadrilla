---
name: stack-python-fastapi
description: Python + FastAPI standard for cuadrilla projects — architecture, API, data access, testing and tooling rules. Load before writing, reviewing or planning Python/FastAPI code in a component whose stack is "python-fastapi" in .claude/cuadrilla.json.
user-invocable: false
paths: "**/*.py, **/pyproject.toml"
---

# Python + FastAPI standard

Every rule below is checkable in a diff. Names in angle brackets come from the `## Project
profile` section of the root `CLAUDE.md`: `<app>` (Python package), `<path>` (component folder,
usually `backend`), `<schema>`, `<prefix>_` (table prefix), connection names (and which ones are
read-only), SQL scripts folder. Never invent them; if one is missing, ask.

## 1. Scope

- Stack: Python 3.13 line (exact version pinned in `<path>/.python-version`), FastAPI, Pydantic v2,
  pydantic-settings, psycopg 3 (async) + psycopg_pool, PostgreSQL, PyJWT + bcrypt. Project and
  dependency management with `uv` (`pyproject.toml` + committed `uv.lock`).
- Library versions are the ones pinned in `uv.lock`. Before using an API you are not sure about
  (FastAPI, Pydantic, pydantic-settings, psycopg, psycopg_pool, PyJWT), check the pinned version
  and its docs (Context7) instead of assuming.
- **Prohibited:** ORMs and SQL-generating query builders (SQLAlchemy ORM/Core, SQLModel,
  Tortoise, Peewee, Pony, Django ORM), psycopg2, `requests` (use `httpx.AsyncClient`), DDD
  tactical patterns (Entity / Value Object / Aggregate classes), mutable module-level state
  (globals, home-made singletons; `@lru_cache` on `get_settings` is the one allowed cache).
- New dependencies only with `uv add`, and only after the user confirms.

## 2. Architecture — 4 layers in `<path>/src/<app>/`

| Layer | Contains | Prohibited | May import |
|---|---|---|---|
| `<app>.api` | `main.py` (`create_app` factory + `lifespan`), `routers/`, `dependencies.py` (composition root), `errors.py` (exception handlers), `security.py` (current user, permissions), `responses.py` (`ApiResponse`), `forms/` | business logic, SQL | application, core; infrastructure **only** from `main.py` and `dependencies.py` |
| `<app>.application` | `services/`, `validators/` | SQL, `psycopg`, `fastapi`, `starlette` | core |
| `<app>.core` | `schemas/` (Pydantic DTOs), `repositories.py` (`Protocol` interfaces), `settings.py`, `exceptions.py`, `auth.py` (`CurrentUser`) | I/O, `fastapi`, `psycopg` | — |
| `<app>.infrastructure` | `db.py` (`ConnectionFactory`), `repositories/`, external service clients | business logic, calculations, default values, logging in repositories | core |

- Enforced by **import-linter** (`uv run lint-imports`, contracts in `pyproject.toml`): a
  `layers` contract `api → (application | infrastructure) → core`, a `forbidden` contract
  `api.routers ↛ infrastructure`, and a `forbidden` contract `application, core ↛ fastapi,
  starlette, psycopg, psycopg_pool`. Breaking a contract breaks CI. Template:
  `${CLAUDE_SKILL_DIR}/templates/pyproject.example.toml`.
- Modules and files `snake_case`; classes `PascalCase`; absolute imports only
  (`from <app>.core... import ...`).
- Services: plain classes (no FastAPI) that receive in `__init__` the repository (typed with the
  core `Protocol`), the validator and, if needed, the `CurrentUser`. Module logger
  `logger = logging.getLogger(__name__)`.
- Wiring (repository → validator → service) lives **only** in `api/dependencies.py` as `Depends`
  providers exposed as `Annotated` aliases (`FeatureServiceDep`). Routers never instantiate
  repositories.
- Validation has two levels: **shape** (types, lengths, regex, ranges) in the DTO with `Field(...)`
  / validators; **business** (existence, uniqueness, rules that read the database) in
  `application/validators/<feature>_validator.py`, called by the service **before any logic**,
  raising core `ValidationError(errors)`. Never in the router.
- All I/O is `async`. No blocking calls inside `async def` (ruff `ASYNC` rules catch
  `time.sleep`, `open`, sync HTTP); wrap an unavoidable sync library in
  `await run_in_threadpool(...)`.
- Slow side work (email, notifications, OCR, slow integrations) goes to a
  `BackgroundTaskQueue` (an `asyncio.Queue` whose worker starts in the `lifespan`), never inside
  the HTTP request.
- A flow repeated in two services is extracted into a shared component, not duplicated.

Detail and code: `${CLAUDE_SKILL_DIR}/reference/architecture.md`.

## 3. API

- Every endpoint returns the envelope `ApiResponse[T]` (`api/responses.py`):
  `{ status, message, data, errors, meta }`, `status ∈ "Success" | "Created" | "Error"`,
  built with `ApiResponse.ok / .success / .created / .bad_request / .error`. Never return a DTO,
  a `dict` or a hand-built `JSONResponse` from a router.
- The endpoint's return annotation is the response model: `-> ApiResponse[FeatureResponse]`
  (do not repeat it in `response_model=`; ruff `FAST001` flags the duplicate).
- JSON is **camelCase**: every DTO inherits `CamelModel` (`alias_generator=to_camel`, validate
  by name and alias, serialize by alias). Query params in camelCase via `Query(alias=...)`.
- `RequestValidationError` → **400** with `errors: { field: [messages] }`, never FastAPI's 422.
- Domain exceptions inherit `DomainError` (`core/exceptions.py`) and **declare**
  `status_code` as a class attribute (403, 404, 409…). `api/errors.py` is the single place that
  translates exceptions: `RequestValidationError` and core `ValidationError` → 400,
  `DomainError` → its `status_code`, anything else → 500 generic (logged with
  `logger.exception`; the client never sees the detail).
- Routers: path, dependencies, call the service, wrap the result. No `try/except`, no
  `HTTPException`, no SQL, no `if` on roles. Endpoints are `async def`.
- Dependencies use `Annotated[..., Depends(...)]` aliases (ruff `FAST002`), never
  `= Depends(...)` defaults.
- Auth on by default: every protected `APIRouter` declares
  `dependencies=[Depends(get_current_user)]`. A public endpoint lives in a public router with a
  comment justifying it; no endpoint that creates users or credentials is anonymous.
- Permissions are declarative: `dependencies=[Depends(require_permission("<CODE>"))]` on the
  endpoint.
- Form models (`UploadFile` + `Form`) live in `api/forms/` with suffix `Form`.
- Routes under `/api/<domain>`; `openapi_url`/`docs_url` disabled in production via `Settings`.
- `GET /health` is anonymous and runs `SELECT 1` on the main connection.
- `CORSMiddleware` with explicit origins from `Settings`; never `allow_origins=["*"]`.
- Pools and queues open/close in the `lifespan`, never at import time. The app is built by a
  factory: `uvicorn <app>.api.main:create_app --factory`.
- Every new endpoint consumed by a frontend is added to that frontend's endpoint map.

Detail and code: `${CLAUDE_SKILL_DIR}/reference/api.md`.

## 4. Data

- Hand-written SQL in `infrastructure/repositories/` only, async, mapped straight to the core
  DTO with `class_row(<Dto>)` (`scalar_row` for single values).
- Always parametrized with named placeholders `%(name)s` and a dict. **Never** f-strings, `%`,
  `.format()` or `+` with input. Dynamic identifiers (sort column) only from a whitelist through
  `psycopg.sql.Identifier`.
- Tables and columns lowercase `snake_case`, unquoted, schema-qualified:
  `<schema>.<prefix>_<table>`. Placeholders `snake_case`.
- Connections **only** through `ConnectionFactory.connection("<NAME>")` (one
  `AsyncConnectionPool` per profile connection, opened in the `lifespan`). Read-only connections
  of the profile are opened with `default_transaction_read_only=on` and never receive
  INSERT/UPDATE/DELETE.
- `statement_timeout` set on every pool; no unbounded queries.
- Writes touching several tables run in one explicit `async with conn.transaction():` inside one
  repository method.
- `INSERT`/`UPDATE` that need the resulting row use `RETURNING`, not a second `SELECT`.
- Repositories implement the `Protocol` in `core/repositories.py`, do not log, hold no business
  logic and apply no defaults: they return what the database has.
- Lists are paginated in the database (`LIMIT/OFFSET`, keyset for large tables), never in memory.
- External-system codes that mean the same as an own catalog get a mapping column
  (`<system>_code`) on that catalog table — never a hardcoded map in Python or a parallel table.
- SQL scripts: `NNN_<verb>_<description>.sql` (verb `create|alter|seed|update|drop`), next free
  number in the profile's scripts folder, idempotent, inside `BEGIN; … COMMIT;`. **Claude writes
  them and never executes them** (no `psql`, no MCP, no driver): the user runs them.

Detail: `${CLAUDE_SKILL_DIR}/reference/data.md`, `${CLAUDE_SKILL_DIR}/reference/sql-migrations.md`.

## 5. Validation, logging, configuration, current user

- Configuration: one `Settings(BaseSettings)` in `core/settings.py` with `env_prefix="<APP>_"`,
  obtained through `get_settings()` (`@lru_cache`) / `Annotated[Settings, Depends(get_settings)]`
  and built once at startup (fails fast on a missing value). No `os.getenv` / `os.environ`
  anywhere (ruff `TID251` bans them).
- Secrets (DSNs, JWT key, API keys) are `SecretStr`, come from env vars or a secret manager, and
  only `<path>/.env.example` (fake values) is versioned.
- Current user: claims are read **only** via `get_current_user` in `api/security.py`, which
  returns the typed `CurrentUser` (core dataclass) or raises `UnauthorizedError` (401). Never
  decode the JWT or read `Authorization` / `request.state` in routers or services.
- JWT: fixed algorithm, `algorithms=[...]` explicit on decode, `exp` and `sub` required.
  Passwords: bcrypt with cost ≥ 12. Refresh tokens stored hashed and rotated on every use.
- Logging: stdlib `logging` for technical diagnostics (configured once in the `lifespan`;
  `warning`+ on known error paths); a `SystemLogService` for persistent business audit. Never
  mix them. Never log passwords, tokens or full documents. No `print`.

Detail: `${CLAUDE_SKILL_DIR}/reference/security-config.md`.

## 6. Testing (`<path>/tests/`, pytest + pytest-asyncio + httpx)

- One test file per service and per validator: `tests/application/test_<feature>_service.py`,
  `test_<feature>_validator.py`. Test names `test_<method>_<scenario>_<expected>`.
- Services and validators are tested with **fake repositories** (classes implementing the core
  `Protocol`) or `AsyncMock`; never the real database or cloud services.
- Routers: `httpx.AsyncClient(transport=ASGITransport(app=create_app(settings)))` with
  `app.dependency_overrides` replacing services and the current user; assert status, envelope
  and permissions (401 without token, 403 without permission, 400 with `errors`).
- Mandatory from day one: authentication tests (login, password check, refresh token issue and
  rotation, reuse of a revoked refresh token, inactive user) and permission tests.
- Repository tests are optional and only against an ephemeral database (testcontainers or the CI
  `services: postgres`), never a shared one.
- Every fixed bug gets a test that reproduces it; new service/validator logic ships with tests in
  the same change. Never delete, comment out, skip or `xfail` a test to get green.

Detail: `${CLAUDE_SKILL_DIR}/reference/testing.md`.

## 7. Tooling — the exact commands (run in `<path>/`, same as CI and `component.json`)

| Step | Command |
|---|---|
| setup | `uv sync --frozen` |
| lint | `uv run ruff check` |
| format | `uv run ruff format --check` |
| types | `uv run mypy` (strict + pydantic plugin) |
| layers | `uv run lint-imports` |
| test | `uv run pytest` |
| run | `uv run uvicorn <app>.api.main:create_app --factory --reload --port 8000` |
| audit | `uv run pip-audit` |

- `mypy --strict` clean. No `# type: ignore` without an error code and a justifying comment; no
  explicit `Any` in public signatures.
- The cuadrilla format hook runs `ruff format` + import sorting on each edited file and reports
  remaining lint errors: fix them immediately.

## 8. Files in this skill

- `${CLAUDE_SKILL_DIR}/component.json` — the `.claude/cuadrilla.json` component (setup, checks,
  format/lint, start, audit), forbidden patterns and recommended third-party skills. Read when
  adopting or changing checks.
- `${CLAUDE_SKILL_DIR}/reference/architecture.md` — layers, folder tree, composition root,
  services, validators, background queue. Read before creating a feature or moving code.
- `${CLAUDE_SKILL_DIR}/reference/api.md` — `ApiResponse`, `CamelModel`, `DomainError`,
  `errors.py`, `security.py`, router and `main.py` code. Read before touching `api/`.
- `${CLAUDE_SKILL_DIR}/reference/data.md` — `ConnectionFactory`, repository code, transactions,
  pagination, dynamic identifiers. Read before touching `infrastructure/`.
- `${CLAUDE_SKILL_DIR}/reference/sql-migrations.md` — script naming and DDL rules. Read before
  writing any `.sql`.
- `${CLAUDE_SKILL_DIR}/reference/testing.md` — fakes, service and router tests, conftest. Read
  before writing tests.
- `${CLAUDE_SKILL_DIR}/reference/security-config.md` — settings, secrets, JWT/bcrypt, `.gitignore`,
  CI and deploy rules. Read before touching settings, auth, Dockerfile or workflows.
- `${CLAUDE_SKILL_DIR}/templates/pyproject.example.toml` — dependencies + ruff/mypy/pytest/
  import-linter config.
- `${CLAUDE_SKILL_DIR}/templates/ci-job.yml` — the `ci-<name>` GitHub Actions job.
- `${CLAUDE_SKILL_DIR}/templates/Dockerfile`, `.dockerignore` — production image (multi-stage,
  `uv sync --frozen --no-dev`, non-root).
- `${CLAUDE_SKILL_DIR}/templates/railway.toml` — optional Railway config-as-code.
- `${CLAUDE_SKILL_DIR}/templates/.env.example` — variable names with fake values.

## Shared auth contract
Authentication endpoints (`/api/auth/login`, `/api/auth/refresh`, `/api/auth/logout`, `/api/me`), payloads and cookie rules are defined once in `cuadrilla:standard-api` ("Shared auth contract") so every frontend pack works with this backend. Implement them exactly; differences go to the profile's "Exceptions to the standard".
