# Data access with JdbcClient (default)

`JdbcClient` (Spring Framework 6.1+) is auto-configured on top of the primary `DataSource`.
`NamedParameterJdbcTemplate` is acceptable where the project already uses it; do not mix both
in one repository.

## Repository

```java
@Repository
class JdbcOrderRepository implements OrderRepository {
    private final JdbcClient jdbc;
    JdbcOrderRepository(JdbcClient jdbc) { this.jdbc = jdbc; }

    @Override
    public Optional<OrderResponse> findById(long id) {
        return jdbc.sql("""
                SELECT o.id, o.customer_id, o.description, o.amount, o.created_at
                  FROM <schema>.<prefix>_order o
                 WHERE o.id = :id
                """)
            .param("id", id)
            .query(OrderResponse.class)          // snake_case columns → camelCase record components
            .optional();
    }

    @Override
    public PageResult<OrderResponse> findPage(long customerId, PageRequest page) {
        List<OrderResponse> items = jdbc.sql("""
                SELECT o.id, o.customer_id, o.description, o.amount, o.created_at
                  FROM <schema>.<prefix>_order o
                 WHERE o.customer_id = :customerId
                 ORDER BY o.id
                 LIMIT :limit OFFSET :offset
                """)
            .param("customerId", customerId)
            .param("limit", page.size())
            .param("offset", page.offset())
            .query(OrderResponse.class)
            .list();
        long total = jdbc.sql("SELECT count(*) FROM <schema>.<prefix>_order WHERE customer_id = :customerId")
            .param("customerId", customerId)
            .query(Long.class)
            .single();
        return new PageResult<>(items, page.page(), page.size(), total);
    }

    @Override
    public long insert(OrderRequest r, long createdBy, OffsetDateTime createdAt) {
        return jdbc.sql("""
                INSERT INTO <schema>.<prefix>_order (customer_id, description, amount, created_at, created_by)
                VALUES (:customerId, :description, :amount, :createdAt, :createdBy)
                RETURNING id
                """)
            .param("customerId", r.customerId())
            .param("description", r.description())
            .param("amount", r.amount())
            .param("createdAt", createdAt)
            .param("createdBy", createdBy)
            .query(Long.class)
            .single();
    }
}
```

Checkable rules:
- SQL lives only in `infrastructure.persistence`; text blocks, explicit column lists (never
  `SELECT *`), explicit schema (`<schema>.<prefix>_<table>`), `snake_case` identifiers.
- Parameters are always named (`:camelCase` + `.param("camelCase", value)`); `.paramSource(record)`
  is fine when a record maps 1:1. Never `+`, `String.format`, `.formatted()` or `StringBuilder`
  with input values.
- Dynamic sorting: `Map<String, String> SORTABLE = Map.of("createdAt", "o.created_at", …)`; an
  unknown key throws `ValidationException`; the direction is an enum. Dynamic `IN` lists pass a
  `Collection` as one named parameter (`WHERE id IN (:ids)`), never a joined string.
- Map to domain records with `.query(Record.class)` or an explicit `RowMapper` when names don't
  line up; no `Map<String, Object>` rows escaping the repository.
- `INSERT/UPDATE` that need the resulting row use `RETURNING` (PostgreSQL/Oracle 23ai) or a
  `KeyHolder` (`.update(keyHolder, "id")`), not a second `SELECT` by natural key.
- `update()` row counts are checked where 0 rows means "not found" or a lost optimistic lock;
  the repository returns the count/boolean and the **service** throws the domain exception.
- Bulk writes: `JdbcTemplate.batchUpdate` / `NamedParameterJdbcTemplate.batchUpdate` with
  `SqlParameterSource[]`, in chunks.
- No logging, no defaults, no business rules in repositories; return what the database has.

## Connections

- Single database: `spring.datasource.*` from environment variables (see
  `templates/application.example.yml`).
- Several profile connections: one `@ConfigurationProperties` per connection in
  `infrastructure.config.DataSourceConfig`, each producing a `HikariDataSource`, a
  `JdbcClient` and (for writable ones) a `DataSourceTransactionManager`, all `@Qualifier`-named
  with the profile connection name. The main one is `@Primary`.
- Connections marked **read-only** in the profile: `hikari.read-only: true` and a
  database-level read-only user when available; repositories on them only `SELECT`.
- Timeouts: `spring.jdbc.template.query-timeout` (seconds) for the auto-configured client, or
  `JdbcTemplate.setQueryTimeout` on custom ones; Hikari `connection-timeout` and
  `maximum-pool-size` explicit.

## Transactions

- `@Transactional` only on public `application` service methods; `readOnly = true` on queries.
- A use case that writes several tables calls several repository methods inside **one**
  service transaction; repositories never call each other.
- With multiple transaction managers, name it: `@Transactional(transactionManager = "<name>Tx")`.
- No remote calls (HTTP, email) inside a transaction; publish an event or queue the work and
  run it after commit (`@TransactionalEventListener(phase = AFTER_COMMIT)`).

## External-system codes

- When an external system's code represents the same concept as an own catalogue, add a
  mapping column (`<system>_code`) to the own catalogue table; never hardcode the mapping in
  Java nor create a parallel table.
