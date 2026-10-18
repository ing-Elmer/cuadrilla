# Data access — Dapper (default)

The engine (SQL Server, PostgreSQL or Oracle), connection names, which connections are
read-only, `<SCHEMA>` and `<PREFIX>_` come from the profile. Check the installed Dapper and
provider versions (`Directory.Packages.props`) and their docs (Context7) before using an API you
are not sure about.

## Connection factory

```csharp
// <App>.Infrastructure/Data/IDbConnectionFactory.cs
public interface IDbConnectionFactory
{
    /// <summary>Creates and opens a connection declared in the profile (e.g. "Main", "ReportsReadOnly").</summary>
    Task<DbConnection> OpenAsync(string name, CancellationToken ct);
}
```

- Implemented once in `Infrastructure/Data/DbConnectionFactory.cs`, registered `Singleton`,
  reading `ConnectionStrings:<name>` through options validated on start. Connection names are
  `const string` in `Infrastructure/Data/ConnectionNames.cs`, matching the profile.
- PostgreSQL: build one `NpgsqlDataSource` per connection string at startup (singleton) and
  open connections from it; do not `new NpgsqlConnection` per call.
- Repositories `await using var connection = await factory.OpenAsync(ConnectionNames.Main, ct);`
  — connections are never stored in fields or shared across requests.
- Read-only connections: their repositories expose only query methods; a write against them is a
  review blocker.

## Repository (example in SQL Server syntax)

```csharp
internal sealed class OrderRepository(IDbConnectionFactory factory) : IOrderRepository
{
    private const string GetByIdSql = """
        SELECT o.ID AS Id, o.ORDER_NUMBER AS Number, o.TOTAL AS Total, o.CREATED_AT AS CreatedAt
        FROM <SCHEMA>.<PREFIX>_ORDERS o
        WHERE o.ID = @Id
        """;

    public async Task<OrderResponse?> GetByIdAsync(long id, CancellationToken ct)
    {
        await using var connection = await factory.OpenAsync(ConnectionNames.Main, ct);
        var command = new CommandDefinition(GetByIdSql, new { Id = id }, cancellationToken: ct);
        return await connection.QuerySingleOrDefaultAsync<OrderResponse>(command);
    }
}
```

Rules checkable in a diff:
- Every call is async and takes a `CommandDefinition` with `cancellationToken: ct` (and
  `transaction:` when inside one). Never the `(sql, param)` overloads without a token.
- SQL in `private const string` raw string literals (`"""`), one per statement, columns listed
  explicitly (no `SELECT *`), aliased to the DTO property names.
- Parameters: anonymous objects or `DynamicParameters`; lists via Dapper list expansion
  (`WHERE ID IN @Ids` — on Oracle keep lists under 1000 or use a temp table/array).
- **Never** `+`, `$"…"`, `string.Format`, `StringBuilder.Append(input)` in SQL. Optional filters
  use `(@Status IS NULL OR STATUS = @Status)` or a fixed set of pre-written fragments. Dynamic
  sort columns are mapped from a whitelist `switch` to constant SQL fragments.
- Repositories have no `ILogger`, no business rules, no default values, no `try/catch` except to
  translate a provider error code into a `DomainException` (e.g. unique violation → `ConflictException`).
- `QuerySingleOrDefaultAsync` when 0..1 rows are valid, `QuerySingleAsync` when exactly one is
  required; `QueryFirst*` only with an explicit `ORDER BY`.
- `buffered: false` / `QueryUnbufferedAsync` only for streaming exports.

## Transactions

```csharp
await using var connection = await factory.OpenAsync(ConnectionNames.Main, ct);
await using var transaction = await connection.BeginTransactionAsync(ct);
var id = await connection.ExecuteScalarAsync<long>(new CommandDefinition(InsertOrderSql, order, transaction, cancellationToken: ct));
await connection.ExecuteAsync(new CommandDefinition(InsertLinesSql, lines, transaction, cancellationToken: ct));
await transaction.CommitAsync(ct);
```

- Any operation writing to more than one table (or more than one row that must stay consistent)
  uses an explicit transaction, passed to **every** `CommandDefinition`. No commit = rollback on
  dispose; never swallow exceptions inside the transaction block.
- A transaction lives inside one repository method. If a use case truly needs several
  repositories in one transaction, add an `IUnitOfWork` in Infrastructure — ask first.

## Pagination

- Page in the database with a stable `ORDER BY` (ending in the primary key) and a separate
  `COUNT(*)` (or `COUNT(*) OVER()` where it is cheaper). Return `PagedResult<T>(Items, Page,
  PageSize, TotalCount)`; the controller turns it into `meta`.
- `pageSize` is capped (e.g. 100) by the validator. Never load everything and `.Skip().Take()`
  in memory.

## Per-engine notes

| | SQL Server | PostgreSQL | Oracle |
|---|---|---|---|
| Provider package | `Microsoft.Data.SqlClient` (never `System.Data.SqlClient`) | `Npgsql` | `Oracle.ManagedDataAccess.Core` |
| Parameter prefix | `@Name` | `@name` (Dapper rewrites for Npgsql) | `:Name` (Dapper sets `BindByName` on `OracleCommand`) |
| Naming (unless the profile says otherwise) | `PascalCase` or the profile's convention, `<SCHEMA>` e.g. `dbo` | `snake_case` lower case; set `DefaultTypeMap.MatchNamesWithUnderscores = true` once at startup | `UPPER_CASE`, schema-qualified, aliases to PascalCase DTO properties |
| Paging | `ORDER BY … OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY` | `ORDER BY … LIMIT @PageSize OFFSET @Offset` | `ORDER BY … OFFSET :Offset ROWS FETCH NEXT :PageSize ROWS ONLY` (12c+) |
| Identity | `IDENTITY(1,1)`; return with `OUTPUT INSERTED.Id` | `GENERATED ALWAYS AS IDENTITY`; `RETURNING id` | `GENERATED BY DEFAULT AS IDENTITY` (12c+) or a sequence; `RETURNING ID INTO :Id` with an output `DynamicParameters` |
| Booleans | `BIT` | `boolean` | `NUMBER(1)` with a check constraint (or `BOOLEAN` on 23ai+, if the profile allows) |
| Dates | `datetime2` / `datetimeoffset` | `timestamptz` | `TIMESTAMP WITH TIME ZONE` or `TIMESTAMP` in UTC |
| Cheapest health query | `SELECT 1` | `SELECT 1` | `SELECT 1 FROM DUAL` |
| Unique violation code | `SqlException.Number` 2627 / 2601 | `PostgresException.SqlState` `23505` | `OracleException.Number` 1 (ORA-00001) |

- Oracle: no empty string (`''` is `NULL`); `IN` lists are limited to 1000 items; `CLOB` /
  `BLOB` need explicit `OracleDbType` in `DynamicParameters` for large values.
- PostgreSQL: arrays (`= ANY(@ids)`) are preferred over `IN` expansion for large lists.
- SQL Server: pass strings as `DbString { IsAnsi = true }` only when the column is `varchar`, to
  avoid implicit conversions that kill index seeks.

## Data from external systems

When a code from an external system means the same as an existing catalog in your database, add
a mapping column (`<SYSTEM>_CODE`) to the existing catalog table. Never hard-code the mapping in
C# and never create a parallel table: the mapping must be fixable with an `UPDATE`, without a
redeploy.
