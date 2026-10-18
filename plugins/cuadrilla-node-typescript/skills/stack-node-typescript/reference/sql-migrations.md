# SQL scripts and migrations (PostgreSQL)

Read before writing any `.sql` file. The scripts folder is the one the project profile declares
(e.g. `<path>/db/migrations/` or `database/scripts/`).

## Claude never runs them

- Claude **writes** scripts and **never executes** them: no `psql`, no `node`/`tsx` script that
  runs SQL, no Kysely migrator, no `node-pg-migrate up`, no MCP write tool. After writing, tell
  the user which file to run and against which environment, and wait.
- If the profile declares a migration tool (node-pg-migrate, Kysely migrator, Flyway,
  Sqitch…), follow its file format and naming, but the rule above still applies: Claude only
  writes the files. Never add a `migrate` step to `npm start`, the Dockerfile `CMD` or a
  platform pre-deploy command unless the profile declares it.
- Never DML against a connection or schema the profile marks as read-only.

## Naming

- `NNN_<verb>_<description>.sql`: `NNN` three digits, verb one of `create`, `alter`, `seed`,
  `update`, `drop`; description in snake_case. Example: `014_create_invoice_line.sql`.
- Numbers are unique: list the folder and use the next free number. Never two scripts with the
  same number, even from different branches; on a merge conflict the newer one is renumbered.
- One script = one logical change. Test/demo data only in `seed_` scripts, never mixed with DDL.

## Content

- Explicit schema on every object: `<schema>.<prefix>_<table>`; tables and columns in lowercase
  snake_case without double quotes.
- Primary keys `bigint GENERATED ALWAYS AS IDENTITY` (or `uuid` if the profile says so); dates
  `timestamptz`; text `text` or `varchar(n)`; money `numeric(p,s)` — never `float`/`real`.
- Named constraints and indexes: `pk_`, `fk_`, `uq_`, `ck_`, `ix_`; never auto-generated names.
  Every foreign key has its index.
- Audit columns on transactional tables: `created_at`, `created_by`, `updated_at`,
  `updated_by`.
- Idempotent: `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`,
  `CREATE INDEX IF NOT EXISTS`; constraints inside a `DO $$ … $$` block that checks
  `pg_constraint`.
- Wrapped in `BEGIN; … COMMIT;`. Indexes on large production tables: `CREATE INDEX
  CONCURRENTLY` in a separate script without a transaction.
- `COMMENT ON TABLE/COLUMN` for every new table and column.

```sql
-- 014_create_invoice_line.sql
BEGIN;

CREATE TABLE IF NOT EXISTS <schema>.<prefix>_invoice_line (
    id          bigint GENERATED ALWAYS AS IDENTITY,
    invoice_id  bigint        NOT NULL,
    description varchar(200)  NOT NULL,
    quantity    integer       NOT NULL,
    unit_price  numeric(12,2) NOT NULL,
    created_at  timestamptz   NOT NULL DEFAULT now(),
    created_by  bigint        NOT NULL,
    updated_at  timestamptz,
    updated_by  bigint,
    CONSTRAINT pk_<prefix>_invoice_line PRIMARY KEY (id),
    CONSTRAINT fk_<prefix>_invoice_line_invoice FOREIGN KEY (invoice_id)
        REFERENCES <schema>.<prefix>_invoice (id),
    CONSTRAINT ck_<prefix>_invoice_line_quantity CHECK (quantity > 0)
);

CREATE INDEX IF NOT EXISTS ix_<prefix>_invoice_line_invoice
    ON <schema>.<prefix>_invoice_line (invoice_id);

COMMENT ON TABLE <schema>.<prefix>_invoice_line IS 'Lines of an invoice';
COMMENT ON COLUMN <schema>.<prefix>_invoice_line.unit_price IS 'Unit price without taxes';

COMMIT;
```

## Keeping code and schema in sync

- A repository change that needs a new column ships with its script in the same change; the PR
  description lists the scripts to run before deploying.
- With Kysely, update the table interface in `db-types.ts` in the same change.
- If the `postgres` MCP is enabled (restricted mode), it may be used to **read** the real table
  and index structure before writing a repository or a script — never to write.
