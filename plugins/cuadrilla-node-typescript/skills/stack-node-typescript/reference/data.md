# Data access — PostgreSQL with `pg` or Kysely

Read before writing a repository, a pool or a query. Schema, table prefix and connection names
come from the project profile (`<schema>`, `<prefix>_`, connection names, which are read-only).

## Choosing the library

- The profile declares `pg` (hand-written SQL, default) **or** `kysely` (type-safe query builder
  on top of `pg`). One per component; never mix them. If the profile says nothing, follow what
  the existing repositories use; for a new project use `pg`.
- ORMs (Prisma, TypeORM, Sequelize, MikroORM, Drizzle ORM) are prohibited unless the profile
  declares one. Kysely's `CamelCasePlugin` is allowed; its migrator is not used (see
  `sql-migrations.md`).

## Pools — `src/infrastructure/db.ts`

```ts
import pg from "pg";

export function createPool(options: PoolOptions): pg.Pool {
  const types = new pg.TypeOverrides();
  // bigint ids → number (safe below 2^53). numeric stays string (money is never a float).
  types.setTypeParser(pg.types.builtins.INT8, (value: string) => Number(value));
  return new pg.Pool({
    connectionString: options.dsn,
    max: options.poolMax,
    statement_timeout: options.statementTimeoutMs,
    idle_in_transaction_session_timeout: options.statementTimeoutMs * 2,
    connectionTimeoutMillis: 5_000,
    application_name: options.applicationName,
    types,
    ...(options.readOnly ? { options: "-c default_transaction_read_only=on" } : {}),
  });
}

export async function withTransaction<T>(pool: pg.Pool, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
```

- One pool per connection name of the profile, created in `api/container.ts` and closed in
  `onClose`. `new Pool(` anywhere else is flagged by stop-check.
- Every pool has `statement_timeout`; read-only connections (profile) pass
  `default_transaction_read_only=on` and their repositories have no INSERT/UPDATE/DELETE.
- Type parsers are set per pool (`TypeOverrides`), never with the global `pg.types.setTypeParser`.
  If ids can exceed 2^53, map INT8 to `string` and type ids as `string` end to end.
- DSNs come from `AppConfig` (`<APP>_DB_<NAME>_DSN`), never literals.

## Repositories with `pg`

```ts
export class PgItemRepository implements ItemRepository {
  readonly #pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.#pool = pool;
  }

  async findById(id: number): Promise<ItemResponse | null> {
    const { rows } = await this.#pool.query<ItemResponse>(
      `SELECT i.id, i.name, i.price, i.created_at AS "createdAt"
         FROM <schema>.<prefix>_item i
        WHERE i.id = $1`,
      [id],
    );
    return rows[0] ?? null;
  }

  async list(query: PageQuery): Promise<Page<ItemResponse>> {
    const offset = (query.page - 1) * query.pageSize;
    const [items, count] = await Promise.all([
      this.#pool.query<ItemResponse>(
        `SELECT i.id, i.name, i.price, i.created_at AS "createdAt"
           FROM <schema>.<prefix>_item i
          ORDER BY i.id
          LIMIT $1 OFFSET $2`,
        [query.pageSize, offset],
      ),
      this.#pool.query<{ total: number }>(`SELECT count(*)::int AS total FROM <schema>.<prefix>_item`),
    ]);
    return { items: items.rows, page: query.page, pageSize: query.pageSize, total: count.rows[0]?.total ?? 0 };
  }

  async create(input: ItemCreateRequest, createdBy: number): Promise<ItemResponse> {
    const { rows } = await this.#pool.query<ItemResponse>(
      `INSERT INTO <schema>.<prefix>_item (name, price, created_by)
       VALUES ($1, $2, $3)
       RETURNING id, name, price, created_at AS "createdAt"`,
      [input.name, input.price, createdBy],
    );
    const [created] = rows;
    if (!created) throw new Error("INSERT ... RETURNING returned no row");
    return created;
  }
}
```

Rules checkable in a diff:
- Values only through `$1..$n` + the values array. The SQL text is a constant string literal:
  no `${}` inside it, no `+` concatenation, no SQL assembled in a helper from user input.
- Dynamic identifiers (sort column/direction) only from a whitelist map:
  `const SORT = { name: "i.name", createdAt: "i.created_at" } as const;` then pick the
  constant; never interpolate the request value. Build such queries with an explicit `switch`
  over the whitelist returning complete constant SQL strings.
- Explicit column list, aliased to camelCase with double-quoted aliases (`AS "createdAt"`);
  never `SELECT *`. Tables always schema-qualified, snake_case, unquoted.
- `query<RowType>()` with the core DTO type; the row type must match the selected aliases.
- `INSERT/UPDATE ... RETURNING` instead of a second `SELECT`.
- Lists: `IN`/`ANY` with an array parameter (`WHERE i.id = ANY($1::bigint[])`), bulk inserts
  with `unnest($1::bigint[], $2::int[])`; never a loop of single-row queries.

## Repositories with Kysely

```ts
import { CamelCasePlugin, Kysely, PostgresDialect, sql, type Generated } from "kysely";

interface ItemTable {            // keys in camelCase; CamelCasePlugin maps to snake_case
  id: Generated<number>;
  name: string;
  price: string;
  createdAt: Generated<Date>;
  createdBy: number;
}
export interface Database {
  "<schema>.<prefix>Item": ItemTable;
}

export function createDb(pool: pg.Pool): Kysely<Database> {
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }), plugins: [new CamelCasePlugin()] });
}

export class KyselyItemRepository implements ItemRepository {
  readonly #db: Kysely<Database>;
  constructor(db: Kysely<Database>) {
    this.#db = db;
  }

  async findById(id: number): Promise<ItemResponse | null> {
    const row = await this.#db
      .selectFrom("<schema>.<prefix>Item")
      .select(["id", "name", "price", "createdAt"])
      .where("id", "=", id)
      .executeTakeFirst();
    return row ?? null;
  }

  async create(input: ItemCreateRequest, createdBy: number): Promise<ItemResponse> {
    return this.#db
      .insertInto("<schema>.<prefix>Item")
      .values({ name: input.name, price: input.price, createdBy })
      .returning(["id", "name", "price", "createdAt"])
      .executeTakeFirstOrThrow();
  }
}
```

- Database types live in `src/infrastructure/db-types.ts` (hand-written or generated with
  `kysely-codegen` if the profile allows it); they never leak into core — repositories return
  core DTOs.
- The `sql` template tag binds `${value}` as a parameter (safe). `sql.raw()`/`sql.lit()` are
  prohibited (flagged); for identifiers use `sql.ref()`/`sql.id()` with whitelisted names.
- Transactions: `await this.#db.transaction().execute(async (trx) => { ... })`, all statements
  on `trx`.
- One `Kysely` instance per pool, created in the composition root and destroyed in `onClose`
  (`db.destroy()` also ends the pool).

## Transactions

- Any operation that writes more than one table (or reads-then-writes with an invariant) runs in
  one transaction inside **one repository method**: `withTransaction(pool, async (client) => …)`
  with `pg`, `db.transaction().execute(…)` with Kysely. Every statement uses `client`/`trx`,
  never the pool, inside the callback.
- Services never open transactions or see clients. If a use case spans repositories, add a
  repository method (or a unit-of-work interface in core) instead of passing clients around.
- Translate driver errors that are part of the contract in infrastructure:

```ts
const UNIQUE_VIOLATION = "23505";
try {
  return await withTransaction(pool, async (client) => { /* … */ });
} catch (error) {
  if (error instanceof pg.DatabaseError && error.code === UNIQUE_VIOLATION) {
    throw new ConflictError("Order already exists");
  }
  throw error;
}
```

## Pagination

- Offset pagination (`LIMIT $1 OFFSET $2` + `count(*)`) for back-office lists; `pageSize`
  capped by `pageQuerySchema` (max 100).
- Keyset for large or infinite lists:

```ts
const { rows } = await pool.query<ItemResponse>(
  `SELECT i.id, i.name, i.price, i.created_at AS "createdAt"
     FROM <schema>.<prefix>_item i
    WHERE ($1::bigint IS NULL OR i.id > $1)
    ORDER BY i.id
    LIMIT $2`,
  [afterId, limit + 1],
);
const hasMore = rows.length > limit;
const items = hasMore ? rows.slice(0, limit) : rows;
return { items, nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null };
```

- Never load a whole table and slice in memory; always a deterministic `ORDER BY` (unique key
  last).

## Repository rules

- Implements the core interface; returns what the database has. No logging, no business rules,
  no defaults (`?? 0` for a nullable aggregate is fine; inventing a status is not).
- No `fastify` imports; no `AppConfig` reads beyond what the constructor receives.
- External-system codes that mean the same as an own catalog get a mapping column
  (`<system>_code`) in the own catalog table, editable with an `UPDATE`; never a hard-coded map
  in TypeScript or a parallel table.
- Repository tests (optional) run only against an ephemeral database (CI `services: postgres`
  or Testcontainers), never a shared one.
