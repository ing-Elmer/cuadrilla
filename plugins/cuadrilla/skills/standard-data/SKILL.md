---
name: standard-data
description: Data-access and SQL migration rules of the cuadrilla standard for any stack and relational database — parametrized SQL, naming, connections, read-only sources, transactions, pagination, numbered migration scripts that Claude never runs. Load before writing or reviewing repositories, queries or migration scripts.
user-invocable: false
paths: "**/*.sql"
---

# cuadrilla — data access and migrations (any stack)

The database engine, schema, table prefix, connection names and which connections are
**read-only** come from the project profile. The stack pack says which data library is standard
(and whether an ORM is allowed).

## Queries
- SQL is **always parametrized** with the driver's named/positional parameters. Never string
  concatenation, interpolation or formatting with any input. Dynamic identifiers (sort column,
  direction) only from an allow-list, quoted with the driver's identifier helper.
- `IN` lists use array parameters or generated placeholders, never joined strings.
- Explicit column lists; no `SELECT *` in application code.
- Every query has a bound: pagination (`LIMIT/OFFSET`, keyset for big tables, or the engine's
  equivalent) and a statement timeout configured on the connection/pool.
- Writes that need the resulting row use `RETURNING`/`OUTPUT`/equivalent instead of a second
  `SELECT`.
- Paginate and filter in the database, never in memory.

## Repositories
- One repository per aggregate/table group, implementing the interface declared in core.
- They return what is in the database: no business rules, no invented defaults, no logging.
- Multi-table writes run in one explicit transaction inside one repository method (or a unit of
  work owned by the service when the pack says so).
- Connections are obtained only through the connection factory/pool by the **profile name**.
  Read-only connections are opened read-only and never receive INSERT/UPDATE/DELETE/DDL.

## External systems
- When an external code means the same as an own catalog, add a mapping column
  (`<system>_code`) to the own catalog table. Never hard-code the mapping in code nor create a
  parallel table: it must be fixable with an `UPDATE`, without a redeploy.

## Naming (unless the engine/profile says otherwise)
- Tables and columns in `snake_case`, own tables with `<schema>.<prefix>_name`.
- Constraints and indexes named explicitly: `pk_`, `fk_`, `uq_`, `ck_`, `ix_`. Every FK has an
  index.
- Audit columns on transactional tables: `created_at`, `created_by`, `updated_at`, `updated_by`
  (timestamps with time zone / UTC).
- Primary keys: identity/bigint or UUID as the profile says. Money in exact decimals.

## Migration scripts
- Folder from the profile. Name `NNN_<verb>_<description>.sql` (`verb` ∈ create, alter, seed,
  update, drop) or the tool's convention declared by the pack (e.g. Flyway `V<NNN>__…`).
- **Unique numbers**: list the folder and take the next free number. If two branches collide,
  the newer one is renumbered.
- One logical change per script; seed data in separate `seed` scripts, never mixed with DDL.
- Idempotent where the engine allows (`IF NOT EXISTS`), wrapped in a transaction where DDL is
  transactional. Large-table index builds go in a separate script with the engine's online
  option.
- Document new tables/columns with comments.
- **Never execute** scripts or migration tools: write them and ask the user to run or confirm.
