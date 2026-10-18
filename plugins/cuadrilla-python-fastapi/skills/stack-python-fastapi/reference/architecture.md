# Architecture — 4 layers (Python + FastAPI)

One package `<app>` in `<path>/src/<app>/` (src layout, built with `uv_build`). `<app>`, `<path>`,
`<schema>`, `<prefix>_` and connection names come from the project profile.

## Folder tree

```
<path>/
├── pyproject.toml            deps + ruff / mypy / pytest / import-linter config
├── uv.lock                   committed; one version per package
├── .python-version           Python version (CI and Dockerfile follow it)
├── .env.example              variable names, fake values (versioned)
├── Dockerfile, .dockerignore
├── src/<app>/
│   ├── api/
│   │   ├── main.py           create_app() factory + lifespan (pools, queue, logging)
│   │   ├── dependencies.py   composition root: Depends providers + Annotated aliases
│   │   ├── security.py       get_current_user, CurrentUserDep, require_permission
│   │   ├── errors.py         register_exception_handlers (the only exception translator)
│   │   ├── responses.py      ApiResponse[T]
│   │   ├── forms/            <Feature>Form models (UploadFile + Form)
│   │   └── routers/          <feature>.py, health.py
│   ├── application/
│   │   ├── services/         <feature>_service.py
│   │   └── validators/       <feature>_validator.py
│   ├── core/
│   │   ├── schemas/          base.py (CamelModel), pagination.py, <feature>.py
│   │   ├── repositories.py   <Feature>Repository Protocols
│   │   ├── exceptions.py     DomainError + subclasses with status_code
│   │   ├── auth.py           CurrentUser dataclass
│   │   └── settings.py       Settings(BaseSettings) + get_settings
│   └── infrastructure/
│       ├── db.py             ConnectionFactory (one AsyncConnectionPool per connection)
│       └── repositories/     <feature>_repository.py (Pg<Feature>Repository)
└── tests/
    ├── fakes.py              Fake<Feature>Repository implementations
    ├── application/          test_<feature>_service.py, test_<feature>_validator.py
    └── api/                  test_<feature>_router.py, test_auth.py
```

## Layer rules (checked in review and by `lint-imports`)

| Layer | May import | Must not contain |
|---|---|---|
| `api` | application, core; infrastructure only in `main.py` and `dependencies.py` | business rules, SQL, `if` on roles, `try/except` in routers |
| `application` | core | SQL, `psycopg`, `fastapi`, `starlette`, `Request`, HTTP status codes |
| `core` | nothing of `<app>` | I/O, `fastapi`, `psycopg`, logging |
| `infrastructure` | core | business rules, calculations, defaults, logging inside repositories |

import-linter contracts (see `templates/pyproject.example.toml`):

1. `layers`: `<app>.api` → `<app>.application | <app>.infrastructure` (independent siblings: they
   may not import each other) → `<app>.core`.
2. `forbidden`: `<app>.api.routers` ↛ `<app>.infrastructure` (direct imports; routers reach
   infrastructure only through `api.dependencies`).
3. `forbidden`: `<app>.application`, `<app>.core` ↛ `fastapi`, `starlette`, `psycopg`,
   `psycopg_pool` (needs `include_external_packages = true`).

Adding a layer exception requires changing a contract — that is a design decision for the user,
not something to do to get CI green.

## Composition root — `api/dependencies.py`

The only place that builds repositories, validators and services. Each provider is exposed as an
`Annotated` alias so routers declare `service: FeatureServiceDep`.

```python
from typing import Annotated

from fastapi import Depends, Request

from <app>.api.security import CurrentUserDep
from <app>.application.services.feature_service import FeatureService
from <app>.application.validators.feature_validator import FeatureValidator
from <app>.core.settings import Settings, get_settings
from <app>.infrastructure.db import ConnectionFactory
from <app>.infrastructure.repositories.feature_repository import PgFeatureRepository

SettingsDep = Annotated[Settings, Depends(get_settings)]


def get_db(request: Request) -> ConnectionFactory:
    db: ConnectionFactory = request.app.state.db  # set in the lifespan
    return db


DbDep = Annotated[ConnectionFactory, Depends(get_db)]


def get_feature_service(db: DbDep, user: CurrentUserDep) -> FeatureService:
    repository = PgFeatureRepository(db)
    return FeatureService(repository, FeatureValidator(repository), user)


FeatureServiceDep = Annotated[FeatureService, Depends(get_feature_service)]
```

## Core: Protocol + DTOs

```python
# core/repositories.py
from typing import Protocol

from <app>.core.schemas.feature import FeatureRequest, FeatureResponse


class FeatureRepository(Protocol):
    async def find_page(self, *, is_active: bool, limit: int, offset: int) -> list[FeatureResponse]: ...
    async def count(self, *, is_active: bool) -> int: ...
    async def exists_by_name(self, name: str) -> bool: ...
    async def create(self, data: FeatureRequest, created_by: int) -> FeatureResponse: ...
```

- Do not name a Protocol/class method `list`, `dict`, `type`… — inside the class body it shadows
  the builtin used in annotations (mypy error). Use `find_page`, `get_page`, `find_by_id`.
- DTOs: `core/schemas/<feature>.py` with `<Feature>Request` (input) and `<Feature>Response`
  (output), both `CamelModel`. Shape validation lives here (`Field(min_length=…, max_length=…)`,
  `field_validator`). See `api.md` for `CamelModel`.
- `CurrentUser` is a frozen dataclass in `core/auth.py` (`id`, `username`, `permissions:
  frozenset[str]`), so services can depend on it without FastAPI.

## Application: service + validator

```python
# application/validators/feature_validator.py
from <app>.core.exceptions import ValidationError
from <app>.core.repositories import FeatureRepository
from <app>.core.schemas.feature import FeatureRequest


class FeatureValidator:
    def __init__(self, repository: FeatureRepository) -> None:
        self._repository = repository

    async def validate_create(self, data: FeatureRequest) -> None:
        errors: dict[str, list[str]] = {}
        if await self._repository.exists_by_name(data.name):
            errors.setdefault("name", []).append("A feature with this name already exists.")
        if errors:
            raise ValidationError(errors)
```

```python
# application/services/feature_service.py
import logging

from <app>.application.validators.feature_validator import FeatureValidator
from <app>.core.auth import CurrentUser
from <app>.core.repositories import FeatureRepository
from <app>.core.schemas.feature import FeatureRequest, FeatureResponse
from <app>.core.schemas.pagination import Page

logger = logging.getLogger(__name__)


class FeatureService:
    def __init__(
        self, repository: FeatureRepository, validator: FeatureValidator, user: CurrentUser
    ) -> None:
        self._repository = repository
        self._validator = validator
        self._user = user

    async def get_page(self, *, is_active: bool, page: int, page_size: int) -> Page[FeatureResponse]:
        offset = (page - 1) * page_size
        items = await self._repository.find_page(is_active=is_active, limit=page_size, offset=offset)
        total = await self._repository.count(is_active=is_active)
        return Page(items=items, page=page, page_size=page_size, total=total)

    async def create(self, data: FeatureRequest) -> FeatureResponse:
        await self._validator.validate_create(data)  # business validation first
        created = await self._repository.create(data, created_by=self._user.id)
        logger.info("Feature %s created by user %s", created.id, self._user.id)
        return created
```

Rules visible in the diff:

- The validator runs before any logic and raises core `ValidationError`; services raise
  `DomainError` subclasses (`NotFoundError`, `ConflictError`, `ForbiddenError`), never
  `HTTPException` or status codes.
- Services receive dependencies through `__init__`; no `Depends`, `Request` or module-level
  instances.
- A flow used by two services (e.g. login for two user types) becomes one shared component.

## Async and background work

- Every I/O call is awaited (`psycopg` async, `httpx.AsyncClient`, `anyio`/`aiofiles` for
  files). A sync-only library is wrapped: `await run_in_threadpool(fn, *args)`
  (`starlette.concurrency`, called from `api` or `infrastructure`, not from `application`).
- Slow side effects are enqueued, not awaited in the request:

```python
# infrastructure/background.py — started/stopped in the lifespan
import asyncio
import logging
from collections.abc import Awaitable, Callable

logger = logging.getLogger(__name__)
Job = Callable[[], Awaitable[None]]


class BackgroundTaskQueue:
    def __init__(self, maxsize: int = 1000) -> None:
        self._queue: asyncio.Queue[Job] = asyncio.Queue(maxsize=maxsize)
        self._worker: asyncio.Task[None] | None = None

    def enqueue(self, job: Job) -> None:
        self._queue.put_nowait(job)

    async def start(self) -> None:
        self._worker = asyncio.create_task(self._run())

    async def stop(self) -> None:
        await self._queue.join()
        if self._worker is not None:
            self._worker.cancel()

    async def _run(self) -> None:
        while True:
            job = await self._queue.get()
            try:
                await job()
            except Exception:  # a failed job must not kill the worker; logged, not swallowed
                logger.exception("Background job failed")
            finally:
                self._queue.task_done()
```

Application code depends on a core `Protocol` (`TaskQueue` with `enqueue`), not on this class.

## Logging

- `logging` configured once in the `lifespan`; module loggers `logging.getLogger(__name__)`.
- `warning` or above on known error paths; `logger.exception` only in the 500 handler and in
  background workers.
- Business audit (who did what) goes through a `SystemLogService` that persists to the database.
  Do not use technical logs as audit, nor the audit table for diagnostics.
- Never log passwords, tokens, DSNs or full documents; log ids.
