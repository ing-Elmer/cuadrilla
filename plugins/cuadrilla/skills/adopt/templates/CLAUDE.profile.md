# CLAUDE.md

This project follows the **cuadrilla standard** (agents, standard skills and hooks from the
`cuadrilla` plugin and its stack packs). How each component is built, checked and started lives in
`.claude/cuadrilla.json`; this file holds what is specific to this system.

## Project profile

| Key | Value |
|---|---|
| System name | `<Readable name>` |
| Short description | `<one line: who uses it and for what>` |
| Base branch | `main` |
| Ticket prefix | `<PROJ>-` (Jira / GitHub issues) |
| Response language | `<English / Español / Português>` |

### Components
Details (paths, stacks, commands, ports) in `.claude/cuadrilla.json`.

| Component | Path | Stack | Local URL |
|---|---|---|---|
| `<api>` | `<backend/>` | `<python-fastapi / dotnet / node-typescript / java-spring / generic>` | `<http://localhost:8000>` |
| `<web>` | `<frontend/>` | `<react>` | `<http://localhost:5173>` |

### Naming
- Code package / root namespace (`<app>`): `<app>`
- Database engine and version: `<PostgreSQL 16 / SQL Server 2022 / Oracle 19c / MySQL 8>`
- Own schema (`<schema>`): `<schema>` · own table prefix (`<prefix>_`): `<prefix>_`
- Migration scripts folder: `<backend/db/>`

### Data connections
Connection strings come from environment variables (see each `.env.example`), never from this
file.

| Name | Environment variable | Purpose | Access |
|---|---|---|---|
| `<MAIN>` | `<APP>_DB_MAIN_DSN` | Own tables | read/write |
| `<EXTERNAL>` | `<APP>_DB_<NAME>_DSN` | External system `<name>` | **read-only** |

### Roles and permissions
- Identity source: `<own / external IdP / synchronized from another system>`.
- Roles: `<ROLE_1>`, `<ROLE_2>`… Permission codes: `<FEATURE_READ>`, `<FEATURE_WRITE>`…

### Deploy
- Repository: `<org>/<repo>` · CI: `.github/workflows/ci.yml` (checks `ci-<component>`).
- `<component>`: `<platform>` · `<service/project>` · `<URL>` · waits for CI: `<yes/no>`.
- Environment variables per component (names only): `<VAR_1>`, `<VAR_2>`…

### External integrations
- `<Service>` — what it is used for.

## Domain
Short description of the business, actors and main flow (or a link to `docs/`).

## Exceptions to the standard
What this project does differently from the cuadrilla standard and why (empty if none).

## Known technical debt
Living list of what doesn't comply with the standard yet.
