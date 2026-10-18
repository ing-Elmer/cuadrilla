# API — routers, envelope, errors, security (FastAPI)

The code below type-checks under `mypy --strict` with the pydantic plugin and passes the ruff
config of `templates/pyproject.example.toml`. Replace `<app>`; check the pinned FastAPI/Pydantic
versions (Context7) if an API looks different.

## CamelModel — `core/schemas/base.py`

```python
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    """Base for every DTO: snake_case in Python, camelCase in JSON."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        validate_by_name=True,
        validate_by_alias=True,
        serialize_by_alias=True,
        from_attributes=True,
    )
```

(On Pydantic < 2.11 the equivalent is `populate_by_name=True` and dumping with `by_alias=True`.)

## Pagination — `core/schemas/pagination.py`

```python
from <app>.core.schemas.base import CamelModel


class PageMeta(CamelModel):
    page: int
    page_size: int
    total: int


class Page[T](CamelModel):
    items: list[T]
    page: int
    page_size: int
    total: int

    @property
    def meta(self) -> PageMeta:
        return PageMeta(page=self.page, page_size=self.page_size, total=self.total)
```

## ApiResponse — `api/responses.py`

```python
from typing import Literal, Self

from <app>.core.schemas.base import CamelModel
from <app>.core.schemas.pagination import PageMeta

Status = Literal["Success", "Created", "Error"]


class ApiResponse[T](CamelModel):
    """The one response envelope: { status, message, data, errors, meta }."""

    status: Status
    message: str
    data: T | None = None
    errors: dict[str, list[str]] | None = None
    meta: PageMeta | None = None

    @classmethod
    def ok(cls, message: str, data: T, meta: PageMeta | None = None) -> Self:
        return cls(status="Success", message=message, data=data, meta=meta)

    @classmethod
    def success(cls, message: str) -> Self:
        return cls(status="Success", message=message)

    @classmethod
    def created(cls, message: str, data: T) -> Self:
        return cls(status="Created", message=message, data=data)

    @classmethod
    def bad_request(cls, message: str, errors: dict[str, list[str]]) -> Self:
        return cls(status="Error", message=message, errors=errors)

    @classmethod
    def error(cls, message: str) -> Self:
        return cls(status="Error", message=message)
```

Wire format (what the frontend consumes):

```json
{ "status": "Success", "message": "Features retrieved",
  "data": [{ "id": 1, "name": "Alpha", "isActive": true, "createdAt": "2026-01-01T10:00:00Z" }],
  "errors": null, "meta": { "page": 1, "pageSize": 20, "total": 1 } }
```

Validation error: status 400, `"status": "Error"`, `"errors": { "name": ["String should have at
least 1 character"] }`.

## Domain exceptions — `core/exceptions.py`

```python
from typing import ClassVar


class DomainError(Exception):
    status_code: ClassVar[int] = 400

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class ValidationError(DomainError):
    """Business validation failed (raised by application validators)."""

    status_code = 400

    def __init__(self, errors: dict[str, list[str]], message: str = "Validation failed") -> None:
        super().__init__(message)
        self.errors = errors


class UnauthorizedError(DomainError):
    status_code = 401


class ForbiddenError(DomainError):
    status_code = 403


class NotFoundError(DomainError):
    status_code = 404


class ConflictError(DomainError):
    status_code = 409
```

A new exception **declares** its `status_code` in the class body; documenting it is not enough.
Import the core `ValidationError` explicitly; never confuse it with `pydantic.ValidationError`.

## Exception handlers — `api/errors.py` (the only translator)

```python
import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from <app>.api.responses import ApiResponse
from <app>.core.exceptions import DomainError, ValidationError

logger = logging.getLogger(__name__)

_LOCATIONS = {"body", "query", "path", "header", "cookie", "form"}


def _envelope(status_code: int, body: ApiResponse[None]) -> JSONResponse:
    return JSONResponse(status_code=status_code, content=body.model_dump(mode="json"))


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(RequestValidationError)
    async def request_validation(_: Request, exc: RequestValidationError) -> JSONResponse:
        errors: dict[str, list[str]] = {}
        for error in exc.errors():
            field = ".".join(str(p) for p in error["loc"] if p not in _LOCATIONS) or "request"
            errors.setdefault(field, []).append(str(error["msg"]))
        return _envelope(400, ApiResponse[None].bad_request("Invalid request", errors))

    @app.exception_handler(ValidationError)
    async def business_validation(_: Request, exc: ValidationError) -> JSONResponse:
        return _envelope(400, ApiResponse[None].bad_request(exc.message, exc.errors))

    @app.exception_handler(DomainError)
    async def domain_error(_: Request, exc: DomainError) -> JSONResponse:
        return _envelope(exc.status_code, ApiResponse[None].error(exc.message))

    @app.exception_handler(StarletteHTTPException)
    async def http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        # Framework-raised errors only (404 unknown route, 405 method not allowed).
        return _envelope(exc.status_code, ApiResponse[None].error(str(exc.detail)))

    @app.exception_handler(Exception)
    async def unhandled(request: Request, exc: Exception) -> JSONResponse:
        logger.exception("Unhandled error on %s %s", request.method, request.url.path)
        return _envelope(500, ApiResponse[None].error("Internal server error"))
```

- Handlers are registered with the decorator inside `register_exception_handlers` (typed
  correctly under mypy strict; `add_exception_handler` with a narrower `exc` type is not).
- The 500 response never contains `str(exc)`, a traceback or SQL.

## Current user and permissions — `api/security.py`

```python
from collections.abc import Awaitable, Callable
from typing import Annotated

import jwt
from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from <app>.core.auth import CurrentUser
from <app>.core.exceptions import ForbiddenError, UnauthorizedError
from <app>.core.settings import Settings, get_settings

_bearer = HTTPBearer(auto_error=False)


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> CurrentUser:
    if credentials is None:
        raise UnauthorizedError("Missing bearer token")
    try:
        claims = jwt.decode(
            credentials.credentials,
            settings.jwt_secret.get_secret_value(),
            algorithms=[settings.jwt_algorithm],
            options={"require": ["exp", "sub"]},
        )
        return CurrentUser(
            id=int(claims["sub"]),
            username=str(claims["username"]),
            permissions=frozenset(str(p) for p in claims.get("permissions", [])),
        )
    except (jwt.PyJWTError, KeyError, TypeError, ValueError) as exc:
        raise UnauthorizedError("Invalid or expired token") from exc


CurrentUserDep = Annotated[CurrentUser, Depends(get_current_user)]


def require_permission(code: str) -> Callable[[CurrentUser], Awaitable[CurrentUser]]:
    async def checker(user: CurrentUserDep) -> CurrentUser:
        if code not in user.permissions:
            raise ForbiddenError(f"Missing permission {code}")
        return user

    return checker
```

`HTTPBearer(auto_error=False)` so a missing token goes through `UnauthorizedError` → 401 with the
envelope (FastAPI's own error would bypass it). Token issuing (login/refresh) lives in an
application `AuthService` that depends on a core `TokenIssuer` Protocol implemented in
infrastructure; see `security-config.md`.

## Router — `api/routers/<feature>.py`

```python
from typing import Annotated

from fastapi import APIRouter, Depends, Query

from <app>.api.dependencies import FeatureServiceDep
from <app>.api.responses import ApiResponse
from <app>.api.security import get_current_user, require_permission
from <app>.core.schemas.feature import FeatureRequest, FeatureResponse

router = APIRouter(
    prefix="/api/features", tags=["features"], dependencies=[Depends(get_current_user)]
)


@router.get("", dependencies=[Depends(require_permission("FEATURE_READ"))])
async def list_features(
    service: FeatureServiceDep,
    is_active: Annotated[bool, Query(alias="isActive")] = True,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(alias="pageSize", ge=1, le=100)] = 20,
) -> ApiResponse[list[FeatureResponse]]:
    result = await service.get_page(is_active=is_active, page=page, page_size=page_size)
    return ApiResponse.ok("Features retrieved", result.items, meta=result.meta)


@router.post("", status_code=201, dependencies=[Depends(require_permission("FEATURE_CREATE"))])
async def create_feature(
    body: FeatureRequest, service: FeatureServiceDep
) -> ApiResponse[FeatureResponse]:
    created = await service.create(body)
    return ApiResponse.created("Feature created", created)
```

Checklist per endpoint: `async def`; return annotation `ApiResponse[...]`; `Annotated`
dependencies; router-level `get_current_user`; `require_permission("<CODE>")`; `status_code=201`
with `ApiResponse.created` on creation; no `try`, `HTTPException`, `JSONResponse`, SQL or role
`if`.

Public endpoints go in a separate router **without** the auth dependency and with a comment that
says why (health, login, refresh, public catalog). Registration of users or credentials is never
public.

## Forms — `api/forms/<feature>_form.py`

Multipart endpoints declare a `<Feature>Form` model (fields annotated with `Form()` / `File()`)
used as `form: Annotated[<Feature>Form, Form()]`. The router passes plain values or bytes to the
service; `UploadFile` never reaches application code.

## Health — `api/routers/health.py`

```python
from fastapi import APIRouter

from <app>.api.dependencies import DbDep
from <app>.api.responses import ApiResponse

# Public on purpose: the platform health check calls it without credentials.
router = APIRouter(tags=["health"])


@router.get("/health")
async def health(db: DbDep) -> ApiResponse[None]:
    await db.ping("main")  # SELECT 1 on the main connection
    return ApiResponse.success("Healthy")
```

## App factory and lifespan — `api/main.py`

```python
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from <app>.api.errors import register_exception_handlers
from <app>.api.routers import feature, health
from <app>.core.settings import Settings, get_settings
from <app>.infrastructure.db import ConnectionConfig, ConnectionFactory


def create_app(settings: Settings | None = None) -> FastAPI:
    """App factory: run with `uvicorn <app>.api.main:create_app --factory`."""
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        logging.basicConfig(level=logging.INFO)
        db = await ConnectionFactory.open(
            {
                "main": ConnectionConfig(
                    dsn=settings.db_main_dsn.get_secret_value(),
                    read_only=False,
                    statement_timeout_ms=settings.db_statement_timeout_ms,
                    max_size=settings.db_pool_max_size,
                ),
            }
        )
        app.state.db = db
        try:
            yield
        finally:
            await db.close()

    docs = settings.docs_enabled
    app = FastAPI(
        title="<app>",
        lifespan=lifespan,
        openapi_url="/openapi.json" if docs else None,
        docs_url="/docs" if docs else None,
        redoc_url=None,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    register_exception_handlers(app)
    app.include_router(health.router)
    app.include_router(feature.router)
    return app
```

- The factory keeps imports side-effect free (tests build the app with test `Settings`, no env
  needed, and `ASGITransport` does not run the lifespan, so no pool is opened).
- One `ConnectionConfig` per connection of the profile; read-only ones with `read_only=True`.
- New routers are registered here; nothing else in `main.py` grows per feature.
