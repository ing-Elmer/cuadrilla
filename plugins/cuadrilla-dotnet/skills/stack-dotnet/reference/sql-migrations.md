# SQL scripts and migrations

The scripts folder, engine, `<SCHEMA>`, `<PREFIX>_` and read-only connections come from the profile.

## Naming and numbering

- `NNN_<verb>_<description>.sql`: `NNN` = 3 digits, `<verb>` ∈ `create`, `alter`, `seed`,
  `update`, `drop`; description in `snake_case` (`014_create_orders.sql`).
- **Unique numbers:** list the folder before creating a script and take the next free number.
  Two scripts never share a number, even from different branches; on a merge conflict the newer
  script is renumbered.
- One script = one logical change. Test/demo data goes in separate `seed_` scripts, never mixed
  with DDL. Environment-specific data is never committed.

## Content

- Every object is schema-qualified: `<SCHEMA>.<PREFIX>_<NAME>`.
- Case per engine unless the profile says otherwise: Oracle `UPPER_CASE`, PostgreSQL
  `snake_case` lower case (never quoted identifiers), SQL Server the profile's convention.
- Named constraints and indexes, never auto-generated names: `PK_<TABLE>`, `FK_<TABLE>_<REF>`,
  `UQ_<TABLE>_<COLS>`, `CK_<TABLE>_<RULE>`, `IX_<TABLE>_<COLS>` (respect the engine's identifier
  length limit: Oracle 128 bytes from 12.2, PostgreSQL 63).
- Every foreign key column has an index.
- Audit columns on transactional tables: `CREATED_AT`, `CREATED_BY`, `UPDATED_AT`, `UPDATED_BY`
  (cased per engine), timestamps in UTC.
- Document new tables and columns: `COMMENT ON TABLE/COLUMN` (Oracle, PostgreSQL) or
  `sp_addextendedproperty 'MS_Description'` (SQL Server).
- Idempotent whenever possible:

| Engine | Pattern |
|---|---|
| SQL Server | `IF OBJECT_ID(N'<schema>.<table>', N'U') IS NULL CREATE TABLE …`; `IF COL_LENGTH(N'<schema>.<table>', N'<col>') IS NULL ALTER TABLE … ADD …` |
| PostgreSQL | `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE … ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`; wrap multi-statement changes in `BEGIN; … COMMIT;` (DDL is transactional) |
| Oracle | PL/SQL block checking `ALL_TABLES` / `ALL_TAB_COLUMNS` / `ALL_CONSTRAINTS` / `ALL_INDEXES` with `OWNER = '<SCHEMA>'` before `EXECUTE IMMEDIATE` (or `IF NOT EXISTS` on 23ai+ if the profile allows); remember DDL auto-commits |

- `update_` scripts that change data state the expected row count in a comment and are written
  so a second run changes nothing.
- Never DML against connections or schemas marked read-only in the profile.
- Grants/synonyms needed by the application user are part of the same script.

## Execution

- **Claude writes scripts and never executes them** — not with `sqlcmd`, `psql`, `sqlplus`,
  `dotnet ef database update`, a test fixture pointed at a shared database, or any MCP tool.
  Ask the user to run the script (or confirm it was run) and say which environment it targets.
- With EF Core, migrations are turned into idempotent scripts in this folder
  (`data-efcore.md`); the same rules apply.
- Integration tests create their own schema in an ephemeral container (Testcontainers) or a
  CI `services:` database, applying the scripts in order.
