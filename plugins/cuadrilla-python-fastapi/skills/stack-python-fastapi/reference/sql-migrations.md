# SQL scripts (PostgreSQL)

Scripts folder: the one declared in the project profile. **Claude writes scripts and never
executes them** — not with `psql`, not through the `postgres` MCP server, not from Python. When a
script is ready, tell the user which file to run and against which environment, and wait.

## Naming and numbering

- `NNN_<verb>_<description>.sql`: `NNN` is 3 digits, `<verb>` ∈ `create`, `alter`, `seed`,
  `update`, `drop`; `<description>` in `snake_case`. Example: `014_create_feature.sql`.
- **Unique numbers**: list the folder and use the next free number. Never two scripts with the
  same number, even from different branches; on an integration conflict, renumber the newer one.
- One script = one logical change. Test data goes in separate `seed_` scripts, never mixed with
  DDL.

## Content rules

- Explicit schema on every object: `<schema>.<prefix>_<table>`. Tables and columns lowercase
  `snake_case`, never double-quoted.
- Primary keys `bigint GENERATED ALWAYS AS IDENTITY` (or `uuid` if the profile says so); dates
  `timestamptz`; text `text` / `varchar(n)`; money `numeric(p,s)`, never `float`/`real`.
- Named constraints and indexes: `pk_`, `fk_`, `uq_`, `ck_`, `ix_`. Never rely on generated
  names. Every foreign key has its index.
- Audit columns on transactional tables: `created_at`, `created_by`, `updated_at`, `updated_by`.
- Idempotent: `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`,
  `CREATE INDEX IF NOT EXISTS`; constraints inside a `DO $$ … $$` block that checks
  `pg_constraint`.
- Wrapped in `BEGIN; … COMMIT;` (transactional DDL). Indexes on large production tables:
  `CREATE INDEX CONCURRENTLY` in a separate script, without a transaction.
- New tables and columns documented with `COMMENT ON`.
- No DML against connections or schemas the profile marks read-only.
- No `preDeployCommand`/startup hook runs migrations: a person runs them against each
  environment before merging the code that needs them.

## Template

```sql
-- 014_create_feature.sql — features catalog
BEGIN;

CREATE TABLE IF NOT EXISTS <schema>.<prefix>_feature (
    id          bigint GENERATED ALWAYS AS IDENTITY,
    name        varchar(120) NOT NULL,
    is_active   boolean      NOT NULL DEFAULT true,
    owner_id    bigint       NOT NULL,
    created_at  timestamptz  NOT NULL DEFAULT now(),
    created_by  bigint       NOT NULL,
    updated_at  timestamptz,
    updated_by  bigint,
    CONSTRAINT pk_<prefix>_feature PRIMARY KEY (id)
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_<prefix>_feature_name') THEN
        ALTER TABLE <schema>.<prefix>_feature
            ADD CONSTRAINT uq_<prefix>_feature_name UNIQUE (name);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_<prefix>_feature_owner') THEN
        ALTER TABLE <schema>.<prefix>_feature
            ADD CONSTRAINT fk_<prefix>_feature_owner
            FOREIGN KEY (owner_id) REFERENCES <schema>.<prefix>_user (id);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_<prefix>_feature_owner_id ON <schema>.<prefix>_feature (owner_id);

COMMENT ON TABLE <schema>.<prefix>_feature IS 'Features catalog';
COMMENT ON COLUMN <schema>.<prefix>_feature.is_active IS 'False hides the feature from lists';

COMMIT;
```

## Review checklist

- [ ] Next free number, correct verb, one logical change.
- [ ] Schema-qualified, snake_case, unquoted; named `pk_/fk_/uq_/ck_/ix_`; FK indexed.
- [ ] Idempotent; inside `BEGIN; … COMMIT;` (except `CONCURRENTLY`).
- [ ] Audit columns and `COMMENT ON` for new objects.
- [ ] Not executed by Claude; the hand-off says who runs it and where.
