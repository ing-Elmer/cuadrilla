# Testing — pytest + pytest-asyncio + httpx

Config (in `pyproject.toml`, see the template): `asyncio_mode = "auto"` (plain `async def test_…`
functions, no marker), `pythonpath = ["tests"]` (so `from fakes import …` works),
`--strict-markers --strict-config`, `xfail_strict = true`. Tests are type-checked by mypy too.

## Layout and naming

```
tests/
├── fakes.py                       Fake<Feature>Repository (implements the core Protocol)
├── application/
│   ├── test_<feature>_service.py
│   └── test_<feature>_validator.py
└── api/
    ├── test_<feature>_router.py
    └── test_auth.py               login, refresh rotation, permissions
```

- One test file per service and per validator.
- Test names: `test_<method>_<scenario>_<expected>` (e.g.
  `test_create_duplicate_name_raises_validation_error`).
- Arrange / act / assert separated by blank lines; one behavior per test.

## What is mandatory

- Every new or changed service/validator method: tests in the same change (happy path + each
  business rule + each `DomainError` it raises).
- Authentication from day one: login with valid/invalid password, inactive user rejected, access
  token issued with `exp`/`sub`, refresh token issued and **rotated** on use, reuse of a revoked
  refresh token rejected (and the family revoked), expired/forged token → 401.
- Authorization: each protected router has a 401 test (no token) and a 403 test (missing
  permission).
- Every fixed bug: a test that fails before the fix.
- Never delete, comment out, `skip` or `xfail` a test to get green (the cuadrilla stop-check flags
  `pytest.mark.skip`/`xfail` without reason).

## Fakes over mocks

Services and validators are tested with fake repositories — small classes that implement the
`Protocol` in memory — or `AsyncMock(spec=...)` for one-off interactions. Never the real database,
cloud services or network.

```python
# tests/fakes.py
from datetime import UTC, datetime

from <app>.core.schemas.feature import FeatureRequest, FeatureResponse


class FakeFeatureRepository:
    """In-memory implementation of the FeatureRepository Protocol."""

    def __init__(self, existing: list[FeatureResponse] | None = None) -> None:
        self.rows = list(existing or [])
        self.created_by: list[int] = []

    async def find_page(self, *, is_active: bool, limit: int, offset: int) -> list[FeatureResponse]:
        rows = [r for r in self.rows if r.is_active == is_active]
        return rows[offset : offset + limit]

    async def count(self, *, is_active: bool) -> int:
        return sum(1 for r in self.rows if r.is_active == is_active)

    async def exists_by_name(self, name: str) -> bool:
        return any(r.name.lower() == name.lower() for r in self.rows)

    async def create(self, data: FeatureRequest, created_by: int) -> FeatureResponse:
        row = FeatureResponse(
            id=len(self.rows) + 1, name=data.name, is_active=data.is_active, created_at=datetime.now(UTC)
        )
        self.rows.append(row)
        self.created_by.append(created_by)
        return row
```

mypy verifies the fake matches the Protocol wherever it is passed as `FeatureRepository`.

## Service test

```python
import pytest

from <app>.application.services.feature_service import FeatureService
from <app>.application.validators.feature_validator import FeatureValidator
from <app>.core.auth import CurrentUser
from <app>.core.exceptions import ValidationError
from <app>.core.schemas.feature import FeatureRequest
from fakes import FakeFeatureRepository

USER = CurrentUser(id=7, username="ana", permissions=frozenset({"FEATURE_CREATE"}))


def make_service(repository: FakeFeatureRepository) -> FeatureService:
    return FeatureService(repository, FeatureValidator(repository), USER)


async def test_create_valid_request_persists_with_current_user() -> None:
    repository = FakeFeatureRepository()

    created = await make_service(repository).create(FeatureRequest(name="Alpha"))

    assert created.name == "Alpha"
    assert repository.created_by == [7]


async def test_create_duplicate_name_raises_validation_error() -> None:
    repository = FakeFeatureRepository()
    service = make_service(repository)
    await service.create(FeatureRequest(name="Alpha"))

    with pytest.raises(ValidationError) as caught:
        await service.create(FeatureRequest(name="alpha"))

    assert "name" in caught.value.errors
    assert len(repository.rows) == 1
```

## Router test

`httpx.AsyncClient` + `ASGITransport` over `create_app(test_settings)`; services and the current
user replaced with `app.dependency_overrides`. `ASGITransport` does not run the lifespan, so no
database pool is opened.

```python
from collections.abc import AsyncIterator

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from pydantic import SecretStr

from <app>.api.dependencies import get_feature_service
from <app>.api.main import create_app
from <app>.api.security import get_current_user
from <app>.application.services.feature_service import FeatureService
from <app>.application.validators.feature_validator import FeatureValidator
from <app>.core.auth import CurrentUser
from <app>.core.settings import Settings, get_settings
from fakes import FakeFeatureRepository

SETTINGS = Settings(
    environment="test",
    db_main_dsn=SecretStr("postgresql://unused"),
    jwt_secret=SecretStr("test-secret-test-secret-test-secret!"),
)


def as_user(*permissions: str) -> CurrentUser:
    return CurrentUser(id=1, username="ana", permissions=frozenset(permissions))


@pytest.fixture
def app() -> FastAPI:
    app = create_app(SETTINGS)
    repository = FakeFeatureRepository()
    app.dependency_overrides[get_settings] = lambda: SETTINGS
    app.dependency_overrides[get_feature_service] = lambda: FeatureService(
        repository, FeatureValidator(repository), as_user()
    )
    return app


@pytest.fixture
async def client(app: FastAPI) -> AsyncIterator[AsyncClient]:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client


async def test_list_without_token_returns_401_envelope(client: AsyncClient) -> None:
    response = await client.get("/api/features")

    assert response.status_code == 401
    assert response.json()["status"] == "Error"


async def test_list_without_permission_returns_403(app: FastAPI, client: AsyncClient) -> None:
    app.dependency_overrides[get_current_user] = lambda: as_user()

    response = await client.get("/api/features")

    assert response.status_code == 403


async def test_create_invalid_body_returns_400_with_field_errors(app: FastAPI, client: AsyncClient) -> None:
    app.dependency_overrides[get_current_user] = lambda: as_user("FEATURE_CREATE")

    response = await client.post("/api/features", json={"name": ""})

    assert response.status_code == 400
    assert "name" in response.json()["errors"]


async def test_create_valid_body_returns_201_camel_case(app: FastAPI, client: AsyncClient) -> None:
    app.dependency_overrides[get_current_user] = lambda: as_user("FEATURE_CREATE")

    response = await client.post("/api/features", json={"name": "Alpha", "isActive": True})

    body = response.json()
    assert response.status_code == 201
    assert body["status"] == "Created"
    assert body["data"]["isActive"] is True
```

For the 401/403 tests that exercise real token decoding, build a token with `jwt.encode` and the
test `SETTINGS.jwt_secret` instead of overriding `get_current_user`.

## Repository tests (optional)

Only against an ephemeral PostgreSQL (testcontainers locally, a `services: postgres` container in
the CI job), with the schema created from the project's SQL scripts. Never against a shared,
staging or production database. Mark them so they can be selected (`-m db`), and register the
marker in `pyproject.toml` (`--strict-markers`).

## Running

In `<path>/`: `uv run pytest` (all), `uv run pytest tests/application -q`,
`uv run pytest -k create_duplicate`. Report the real summary line (`N passed`), never "should
pass".
