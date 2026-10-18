---
name: feature-python-fastapi
description: Scaffold a complete Python + FastAPI feature (all layers + tests) following the cuadrilla standard.
argument-hint: "<FeatureName> <short description>"
disable-model-invocation: true
---

Create the backend feature: **$ARGUMENTS**

Delegate the implementation to the `cuadrilla-python-fastapi:backend-python` agent. Take the package
`<app>`, the component path, schema, table prefix, connection name and SQL scripts folder from the
`## Project profile` in the root `CLAUDE.md` and the component in `.claude/cuadrilla.json` (stack
`python-fastapi`). If a value is missing, ask before continuing.

## Expected files (inside `<path>/src/<app>/` unless noted)

- **core**
  - `core/schemas/<feature>.py` — `<Feature>Request` and `<Feature>Response` on `CamelModel`,
    shape validation with `Field(...)`.
  - `core/repositories.py` — `<Feature>Repository` `Protocol`.
  - `core/exceptions.py` — new `DomainError` subclasses with `status_code`, only if needed.
- **infrastructure**
  - `infrastructure/repositories/<feature>_repository.py` — `Pg<Feature>Repository`, hand-written
    SQL with `%(name)s` placeholders and `class_row`.
- **application**
  - `application/validators/<feature>_validator.py` — business validation raising core
    `ValidationError`.
  - `application/services/<feature>_service.py` — service calling the validator first.
- **api**
  - `api/routers/<feature>.py` — `async def` endpoints returning `ApiResponse[...]`, router-level
    `get_current_user`, `require_permission("<CODE>")` per endpoint.
  - `api/dependencies.py` — `get_<feature>_service` provider + `<Feature>ServiceDep` alias.
  - `api/main.py` — `app.include_router(<feature>.router)`.
- **tests** (`<path>/tests/`)
  - `tests/fakes.py` — `Fake<Feature>Repository`.
  - `tests/application/test_<feature>_service.py`, `tests/application/test_<feature>_validator.py`.
  - `tests/api/test_<feature>_router.py` — 401, 403, 400 envelope and happy path.
- **SQL** (profile scripts folder, only if a table/column is needed) — next free
  `NNN_<verb>_<description>.sql`. Written, **never executed**.

## Steps

1. **Plan first.** Show the file list above filled with real names, and the endpoint contract:
   method + route, request DTO (camelCase JSON), response `ApiResponse[...]` shape, permission
   codes, status codes and domain errors. Wait for the user's OK before writing code.
2. **Implement** through the `backend-python` agent, layer by layer (core → infrastructure →
   application → api → tests → SQL), following the closest existing feature.
3. **Verify.** In the component folder run every `checks[].run` of the component in order
   (default: `uv run ruff check`, `uv run ruff format --check`, `uv run mypy`,
   `uv run lint-imports`, `uv run pytest`). Fix and re-run until green; report the real output.
4. **Review.** Launch the core `cuadrilla:reviewer` agent on the feature's files and show its
   findings by severity before declaring the feature done.
5. **Hand-off.** Files created/modified, final contract, SQL scripts the user must run (and
   where), check results.
