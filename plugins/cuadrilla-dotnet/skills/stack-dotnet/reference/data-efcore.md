# Data access — EF Core (only if the profile declares it)

Use this file instead of `data-dapper.md` **only** when the `## Project profile` declares EF Core.
Mixing both is allowed only if the profile says so (typical split: EF Core for writes, Dapper for
heavy read queries). Check the installed EF Core version and its docs (Microsoft Learn / Context7)
before using an API you are not sure about.

## Placement

- `<App>DbContext` and every `IEntityTypeConfiguration<T>` live in `<App>.Infrastructure/Data/`.
  Mapping is configured with the fluent API there; no EF attributes on Core types.
- Persistence classes (entities) live in `<App>.Infrastructure/Data/Entities/` unless the profile
  places them in Core; they never cross the Api boundary — services and controllers use DTOs.
- Services never inject `DbContext`; they use repository interfaces from Core, exactly like the
  Dapper setup. The architecture test forbids `Microsoft.EntityFrameworkCore` in Application,
  Core and Api controllers.
- `AddDbContext<…>` (or `AddDbContextPool<…>`) is registered in `Infrastructure/DependencyInjection.cs`
  with the provider of the profile (`UseSqlServer`, `UseNpgsql`, `UseOracle`); the connection
  string comes from `ConnectionStrings:<name>`.

## Rules checkable in a diff

- **No lazy loading:** never reference `Microsoft.EntityFrameworkCore.Proxies` or call
  `UseLazyLoadingProxies()`. Related data is loaded with `Include` or, preferably, projected.
- **Reads:** `AsNoTracking()` on every read-only query and projection with `Select(x => new
  <Feature>Response(...))`; never return tracked entities from a repository read method.
  Consider `UseQueryTrackingBehavior(QueryTrackingBehavior.NoTracking)` as the context default
  and `AsTracking()` where updates happen.
- Every async call passes the `CancellationToken` (`ToListAsync(ct)`, `SaveChangesAsync(ct)`).
- Multiple collection `Include`s use `AsSplitQuery()` (or a projection) to avoid cartesian
  explosion.
- Pagination: `OrderBy(...).ThenBy(x => x.Id).Skip(...).Take(...)` executed in the database,
  with a separate `CountAsync`. Never `ToList()` before filtering/paging.
- Bulk updates/deletes: `ExecuteUpdateAsync` / `ExecuteDeleteAsync`, not load-modify-save loops.
- Raw SQL only with `FromSql($"…")` / `SqlQuery<T>($"…")` / `ExecuteSql($"…")` (interpolation is
  parameterized by EF). `FromSqlRaw`/`ExecuteSqlRaw` only with constant SQL plus explicit
  parameters — never concatenated or interpolated input (the core stop hook flags it).
- Optimistic concurrency: a concurrency token (`rowversion` on SQL Server, `xmin` on PostgreSQL,
  a version column on Oracle) on aggregates that users edit concurrently;
  `DbUpdateConcurrencyException` → `ConflictException`.
- `SaveChangesAsync` is called once per use case, from the repository method that owns the write;
  it is the transaction boundary. Use `BeginTransactionAsync` only for multi-`SaveChanges` flows.
- No `EnsureCreated()`, no `Database.Migrate()` at startup, no seeding in `OnModelCreating` for
  environment data.

## Migrations

- Generated with `dotnet ef migrations add <Name> --project src/<App>.Infrastructure
  --startup-project src/<App>.Api`. The migration files are reviewed like any code.
- Applying them: `dotnet ef migrations script --idempotent --from <last> --to <new>` produces a
  SQL script saved in the profile's scripts folder with the next free number
  (`reference/sql-migrations.md`). A person runs it against each environment.
- Claude may run `migrations add` and `migrations script` (they do not touch a database) but
  **never** `dotnet ef database update`, `migrations remove` against an applied migration, or
  anything that connects to a real database.
- A migration that drops or renames columns with data needs an explicit data-migration step and
  the user's confirmation.
