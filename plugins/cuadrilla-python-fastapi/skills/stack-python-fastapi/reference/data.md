# Data access — psycopg 3 (async) + PostgreSQL

No ORM, no query builder: hand-written SQL in `infrastructure/repositories/`, mapped straight to
core DTOs. Table and connection names come from the project profile (`<schema>`, `<prefix>_`,
connection names, which ones are read-only).

## ConnectionFactory — `infrastructure/db.py`

```python
from collections.abc import AsyncIterator, Mapping
from contextlib import asynccontextmanager
from dataclasses import dataclass

from psycopg import AsyncConnection
from psycopg_pool import AsyncConnectionPool


@dataclass(frozen=True, slots=True)
class ConnectionConfig:
    dsn: str
    read_only: bool
    statement_timeout_ms: int
    max_size: int


class ConnectionFactory:
    def __init__(self, pools: Mapping[str, AsyncConnectionPool[AsyncConnection]]) -> None:
        self._pools = dict(pools)

    @classmethod
    async def open(cls, configs: Mapping[str, ConnectionConfig]) -> "ConnectionFactory":
        pools: dict[str, AsyncConnectionPool[AsyncConnection]] = {}
        for name, config in configs.items():
            options = f"-c statement_timeout={config.statement_timeout_ms}"
            if config.read_only:
                options += " -c default_transaction_read_only=on"
            pool: AsyncConnectionPool[AsyncConnection] = AsyncConnectionPool(
                conninfo=config.dsn,
                kwargs={"options": options},
                max_size=config.max_size,
                open=False,
                name=name,
            )
            await pool.open(wait=True)
            pools[name] = pool
        return cls(pools)

    @asynccontextmanager
    async def connection(self, name: str) -> AsyncIterator[AsyncConnection]:
        async with self._pools[name].connection() as conn:
            yield conn

    async def ping(self, name: str) -> None:
        async with self.connection(name) as conn:
            await conn.execute("SELECT 1")

    async def close(self) -> None:
        for pool in self._pools.values():
            await pool.close()
```

- Pools are created in the `lifespan` (`api/main.py`), never at import time, and closed on
  shutdown.
- `pool.connection()` commits on clean exit and rolls back on exception.
- Every pool has `statement_timeout`. Read-only connections add
  `default_transaction_read_only=on`; a repository that writes must use a writable connection
  name — writing through a read-only name is a bug even if the database would reject it.
- Connection names are constants in the repository module (`_CONNECTION = "main"`), matching the
  profile.

## Repository — `infrastructure/repositories/<feature>_repository.py`

```python
from psycopg.rows import class_row, scalar_row

from <app>.core.schemas.feature import FeatureRequest, FeatureResponse
from <app>.infrastructure.db import ConnectionFactory

_CONNECTION = "main"


class PgFeatureRepository:
    def __init__(self, db: ConnectionFactory) -> None:
        self._db = db

    async def find_page(self, *, is_active: bool, limit: int, offset: int) -> list[FeatureResponse]:
        sql = """
            SELECT f.id, f.name, f.is_active, f.created_at
              FROM <schema>.<prefix>_feature f
             WHERE f.is_active = %(is_active)s
             ORDER BY f.id
             LIMIT %(limit)s OFFSET %(offset)s
        """
        async with (
            self._db.connection(_CONNECTION) as conn,
            conn.cursor(row_factory=class_row(FeatureResponse)) as cur,
        ):
            await cur.execute(sql, {"is_active": is_active, "limit": limit, "offset": offset})
            return await cur.fetchall()

    async def count(self, *, is_active: bool) -> int:
        sql = "SELECT count(*) FROM <schema>.<prefix>_feature f WHERE f.is_active = %(is_active)s"
        async with (
            self._db.connection(_CONNECTION) as conn,
            conn.cursor(row_factory=scalar_row) as cur,
        ):
            await cur.execute(sql, {"is_active": is_active})
            total: int | None = await cur.fetchone()
            return total or 0

    async def create(self, data: FeatureRequest, created_by: int) -> FeatureResponse:
        sql = """
            INSERT INTO <schema>.<prefix>_feature (name, is_active, created_by)
            VALUES (%(name)s, %(is_active)s, %(created_by)s)
            RETURNING id, name, is_active, created_at
        """
        params = {"name": data.name, "is_active": data.is_active, "created_by": created_by}
        async with (
            self._db.connection(_CONNECTION) as conn,
            conn.cursor(row_factory=class_row(FeatureResponse)) as cur,
        ):
            await cur.execute(sql, params)
            row = await cur.fetchone()
            if row is None:  # RETURNING always yields a row; this keeps mypy honest
                raise RuntimeError("INSERT ... RETURNING returned no row")
            return row
```

Rules visible in the diff:

- The class name is `Pg<Feature>Repository` and it structurally implements
  `core.repositories.<Feature>Repository` (mypy checks it where `dependencies.py` passes it to
  the service).
- `SELECT` lists explicit columns whose names equal the DTO's snake_case fields (alias in SQL
  with `AS` when they differ); `class_row(<Dto>)` builds the DTO. No `SELECT *`.
- Placeholders are named `%(name)s` and passed as a dict. Never f-strings, `%` formatting,
  `.format()` or `+` concatenation of values into SQL (the cuadrilla stop-check flags them).
- Repositories return what the database has: no defaults (`or ""`), no calculations, no
  business `if`, no logging.
- `INSERT`/`UPDATE` that need the row use `RETURNING`.

## Transactions

Writes that touch several tables run in one method and one transaction:

```python
async with (
    self._db.connection(_CONNECTION) as conn,
    conn.transaction(),
    conn.cursor(row_factory=scalar_row) as cur,
):
    await cur.execute(INSERT_ORDER_RETURNING_ID, params)
    order_id = await cur.fetchone()
    await cur.executemany(INSERT_LINE, [{**line, "order_id": order_id} for line in lines])
```

Never split one logical write across two repository calls coordinated by the service.

## Pagination

- Always in SQL: `LIMIT %(limit)s OFFSET %(offset)s` with a deterministic `ORDER BY` (include the
  primary key). For large tables or infinite scroll use keyset:
  `WHERE (f.created_at, f.id) < (%(after_created_at)s, %(after_id)s) ORDER BY f.created_at DESC, f.id DESC LIMIT %(limit)s`.
- Page size is bounded at the API (`Query(le=100)`); the repository never loads a full table.
- Totals with a separate `count(*)` (or `count(*) OVER ()` when the list query is cheap).

## Dynamic identifiers (sort column, direction)

Only from a whitelist, composed with `psycopg.sql`:

```python
from psycopg import sql

_SORTABLE = {"name": "name", "createdAt": "created_at"}

column = _SORTABLE.get(sort_by, "id")  # whitelist; unknown values fall back
query = sql.SQL("SELECT id, name FROM {table} ORDER BY {column} {direction} LIMIT %(limit)s").format(
    table=sql.Identifier("<schema>", "<prefix>_feature"),
    column=sql.Identifier(column),
    direction=sql.SQL("DESC" if descending else "ASC"),
)
```

User input never becomes a `sql.SQL(...)` literal.

## Naming

- Tables and columns: lowercase `snake_case`, unquoted, schema-qualified
  (`<schema>.<prefix>_<table>`). Aliases short and consistent (`f` for feature).
- Placeholders: `snake_case`, same name as the column when possible.

## External-system codes

When a code from an external system means the same as an own catalog entry, add a mapping column
(`<system>_code`) to the existing catalog table. Never hardcode the mapping in Python and never
create a parallel table: the mapping must be fixable with an `UPDATE`, without a redeploy.

## Inspecting the real schema

If the pack's read-only `postgres` MCP server is enabled (see the pack README), use it to **read**
the actual tables, columns and indexes of the local database before writing a repository. Never
use it (or `psql`, or a script) to change data or run migrations.
