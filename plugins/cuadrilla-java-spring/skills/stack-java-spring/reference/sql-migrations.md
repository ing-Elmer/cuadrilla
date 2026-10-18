# SQL migrations with Flyway

Folder: the profile's migrations folder (default `src/main/resources/db/migration`). Database
engine, `<schema>` and `<prefix>_` come from the profile; examples below are PostgreSQL —
translate types to the profile's engine.

## Naming and numbering

- `V<NNN>__<verb>_<description>.sql`: 3-digit zero-padded version, **two** underscores, verb
  `create | alter | seed | update | drop`, description in `snake_case`
  (`V007__create_order.sql`, `V008__alter_order_add_status.sql`).
- Before creating one, list the folder and take the next free number. Never two files with the
  same version, even on different branches; on a merge conflict the newer one is renumbered
  **before** it has run anywhere.
- Repeatable migrations (`R__<description>.sql`) only for views/functions that are fully
  re-created on each change.
- No undo (`U__`) scripts: a mistake is fixed with a new forward migration.
- **Never edit or rename a migration that may have run** in any shared environment (Flyway
  checksums fail and environments diverge).

## Content

- Explicit schema on every object (`<schema>.<prefix>_order`); `snake_case` lower-case
  identifiers, no quoted identifiers.
- Primary keys `bigint GENERATED ALWAYS AS IDENTITY` (or `uuid` if the profile says so);
  timestamps `timestamptz`; money `numeric(p,s)` (never float); text `text`/`varchar(n)`.
- Named constraints and indexes: `pk_`, `fk_`, `uq_`, `ck_`, `ix_`. Every foreign key has an index.
- Audit columns on transactional tables: `created_at`, `created_by`, `updated_at`, `updated_by`.
- `COMMENT ON TABLE/COLUMN` for new tables and columns.
- One logical change per file. Seed/test data in separate `seed_` migrations, never mixed with
  DDL; data meant only for local/dev lives in a location enabled only there
  (`spring.flyway.locations` per environment).
- Flyway wraps each file in a transaction on databases with transactional DDL. Large-table
  index creation that must not lock (`CREATE INDEX CONCURRENTLY`) goes in its own file with
  `-- flyway:executeInTransaction=false` on the first line (check the Flyway version supports
  script config comments; otherwise a `.sql.conf` file).
- Never DML against connections or schemas the profile marks read-only.

## Execution — never by Claude

- Claude writes migrations and **does not run them**: no `./mvnw flyway:migrate`, no Flyway
  CLI, no `psql`, no starting the app with `spring.flyway.enabled=true` against any shared or
  persistent database. Ask the user to run/confirm.
- `spring.flyway.enabled` is driven by an env var whose per-environment value is declared in
  the profile (`FLYWAY_ENABLED`, default `false`). Production either runs Flyway on startup or
  through a separate pipeline step — the profile says which; Claude does not change it.
- Tests may run migrations against an **ephemeral** Testcontainers database only; that is how
  the migrations are verified in CI.
- `spring.flyway.clean-disabled` stays `true` (default) everywhere; `clean` is never enabled.
- Dependency: `spring-boot-starter-flyway` (Boot 4) or `flyway-core` (Boot 3), plus the
  database module (`flyway-database-postgresql`, `flyway-database-oracle`, …). Check the pinned
  Boot version.
