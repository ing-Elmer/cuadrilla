# Security, configuration, CI and deploy (Python + FastAPI)

## Settings — `core/settings.py`

```python
from functools import lru_cache
from typing import Literal

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Typed configuration. Env vars are prefixed <APP>_ (e.g. <APP>_DB_MAIN_DSN)."""

    model_config = SettingsConfigDict(env_prefix="<APP>_", env_file=".env", extra="ignore")

    environment: Literal["development", "test", "production"] = "development"
    db_main_dsn: SecretStr                      # one <APP>_DB_<NAME>_DSN per profile connection
    db_statement_timeout_ms: int = Field(default=5000, gt=0)
    db_pool_max_size: int = Field(default=10, gt=0)
    jwt_secret: SecretStr
    jwt_algorithm: Literal["HS256"] = "HS256"   # fixed; RS256 needs key-pair settings instead
    access_token_minutes: int = Field(default=15, gt=0)
    refresh_token_days: int = Field(default=7, gt=0)
    bcrypt_rounds: int = Field(default=12, ge=12)
    cors_origins: list[str] = []                # JSON list in the env var
    docs_enabled: bool = False


@lru_cache
def get_settings() -> Settings:
    return Settings()
```

- Built once at startup by `create_app()`; a missing variable fails the boot, not the first
  request. Obtained elsewhere via `Annotated[Settings, Depends(get_settings)]` (overridable in
  tests).
- No `os.getenv` / `os.environ` anywhere (ruff `TID251` bans them; the cuadrilla stop-check flags
  them outside `core/settings.py`).
- Secrets are `SecretStr` and are unwrapped (`.get_secret_value()`) only at the point of use
  (pool creation, JWT encode/decode). Never log or return a `Settings` dump.
- Defaults are safe for production (`docs_enabled=False`, empty CORS list); development turns
  things on through `.env`.

## Secrets

- Only `<path>/.env.example` (names + fake values) is versioned; `<path>/.env` never is.
- Every environment has different secrets; never reuse a development value in production.
- Base configuration holds no personal data of a developer (local paths, emails, cloud profiles).
- Cryptographic keys are never constants in code.
- If a committed secret is found: tell the user without repeating it and propose rotation. If
  GitHub secret scanning / push protection flags one, do not dismiss it as a false positive.

## Passwords and tokens

- Passwords: `bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=settings.bcrypt_rounds))`
  with rounds ≥ 12, verified with `bcrypt.checkpw`. Hashing runs in a thread
  (`await run_in_threadpool(...)` / `anyio.to_thread.run_sync`) because it is CPU-bound and
  blocking. bcrypt only uses the first 72 bytes: reject longer passwords in the DTO
  (`Field(max_length=72)`) or pre-hash consistently.
- Access tokens: PyJWT, fixed algorithm, short lived (`exp`), `sub` = user id, permissions as a
  claim; decode with `algorithms=[settings.jwt_algorithm]` and `options={"require": ["exp", "sub"]}`.
  Never `verify_signature: False`, never `algorithms` taken from the token header.
- Refresh tokens: random (`secrets.token_urlsafe(32)`), stored **hashed** (SHA-256) with expiry
  and a family id, **rotated on every use**; reuse of a revoked token revokes the whole family.
- Token issuing lives in an application `AuthService` that depends on core Protocols
  (`TokenIssuer`, `PasswordHasher`, `RefreshTokenRepository`) implemented in infrastructure.
  Token **reading** of requests happens only in `api/security.py`.
- Inactive users cannot log in or refresh.

## HTTP hardening

- CORS: explicit origins from `Settings.cors_origins`; never `["*"]` with credentials. Preview
  domains only on non-production backends.
- `openapi_url` / `docs_url` disabled in production (`docs_enabled=False`).
- The 500 handler never leaks exception text, SQL or stack traces.
- Behind a proxy: `uvicorn --proxy-headers` (and `--forwarded-allow-ips` narrowed when the
  platform documents its proxy range).
- Uploads: validate size and content type in the form model; never trust the client file name
  for storage paths.

## `.gitignore` minimum

`__pycache__/`, `*.py[cod]`, `.venv/`, `.pytest_cache/`, `.mypy_cache/`, `.ruff_cache/`,
`.coverage`, `htmlcov/`, `.env`, `.env*.local`, `*.log`, `.claude/settings.local.json`,
`CLAUDE.local.md`.

## Dependencies

- `uv.lock` committed; CI and Docker install with `uv sync --frozen` (never resolve at build
  time).
- `uv run pip-audit` for known vulnerabilities (`/cuadrilla:security-audit`).
- New packages only with `uv add` after the user confirms; no packages copied into the repo.

## CI (GitHub Actions) — `templates/ci-job.yml`

- One job `ci-<name>` with the same steps as `component.json`, in order: `uv sync --frozen` →
  `uv run ruff check` → `uv run ruff format --check` → `uv run mypy` → `uv run lint-imports` →
  `uv run pytest`. If a check changes in one place, it changes in the other.
- `actions/checkout@v7` with `persist-credentials: false`; `astral-sh/setup-uv` pinned by full
  SHA with the version in a comment; `timeout-minutes` set; workflow `permissions: contents: read`.
- No `paths` filters on a required check (a check that does not run blocks the PR).
- Tests that need a database use an ephemeral `services: postgres` container in the job, never a
  hosted environment database.
- Credentials only as GitHub Secrets (preferably per environment); never in YAML, never
  interpolate `${{ github.event.* }}` directly into `run:` (pass it through `env:`).

## Docker — `templates/Dockerfile`

- Multi-stage: builder with `uv` (`uv sync --frozen --no-dev --no-install-project`, then the
  project with `--no-editable`); runtime image without `uv` or build tools.
- Non-root user, `PYTHONUNBUFFERED=1`, no `--reload`, app started through the factory
  (`uvicorn <app>.api.main:create_app --factory`), listening on `$PORT` when the platform injects
  it, `--proxy-headers`.
- No secrets in the image (`.dockerignore` excludes `.env*` except `.env.example`, and `tests/`).

## Deploy (optional templates)

- The deploy target is the one in the project profile; never change sites, services or targets
  without confirmation.
- CI does CI, the platform deploys: prefer the platform's native GitHub integration waiting for
  the `ci-<name>` check over deploy tokens stored in GitHub. A `deploy.yml` with platform tokens
  is a profile exception.
- **Railway** (`templates/railway.toml`, optional): Dockerfile builder, `healthcheckPath =
  "/health"`, restart on failure, *Root Directory* `/<path>` and *Config-as-code*
  `/<path>/railway.toml` set on the service, *Wait for CI* on. Database DSN as a **reference
  variable** (`<APP>_DB_MAIN_DSN = ${{Postgres.DATABASE_URL}}`), never a copied value. No
  `preDeployCommand` running migrations.
- Branch protection, environments and platform settings are configured by a person: Claude
  documents and verifies them, it does not change them.
