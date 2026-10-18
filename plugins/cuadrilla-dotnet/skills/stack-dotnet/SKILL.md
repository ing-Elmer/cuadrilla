---
name: stack-dotnet
description: .NET standard for cuadrilla projects — architecture, API, data access, testing and tooling rules. Load before writing, reviewing or planning C# / ASP.NET Core code in a component whose stack is "dotnet" in .claude/cuadrilla.json.
user-invocable: false
paths: "**/*.cs, **/*.csproj, **/*.sln, **/*.slnx"
---

# .NET standard (cuadrilla)

`<App>`, `<SCHEMA>`, `<PREFIX>_`, the database engine, connection names (and which are
read-only), the SQL scripts folder, the auth scheme and deploy targets come from the
`## Project profile` section of the root `CLAUDE.md`. Never invent them; if one is missing, ask.
A profile exception overrides a rule here — respect it and mention it in the hand-off.

## 1. Scope

- Stack: .NET (current LTS or STS) + ASP.NET Core controllers. Minimal APIs only if the profile
  says so (then the same rules apply to endpoint groups instead of controllers).
- **Versions:** the SDK is pinned in `global.json` and the runtime in `TargetFramework`
  (`Directory.Build.props`). Read them before writing code; never assume a version. At the time
  of writing the LTS line is .NET 10. For any API you are not sure about in that version, check
  the `microsoft-learn` MCP server or Context7 — do not rely on memory.
- Default libraries: Dapper (data), FluentValidation (business validation), xUnit (tests),
  NSubstitute (fakes), NetArchTest.Rules or ArchUnitNET (architecture test).
- **Prohibited unless the profile declares them:** EF Core (allowed only when declared — then
  `reference/data-efcore.md` replaces `reference/data-dapper.md`), MediatR or any mediator,
  AutoMapper (both now commercially licensed; map by hand or with Mapperly), FluentAssertions
  v8+ (commercial licence), DDD tactical-pattern base classes (Entity/ValueObject/Aggregate),
  `static` helpers holding state, `dynamic`, Newtonsoft.Json (use System.Text.Json).
- New NuGet packages need the user's confirmation. Versions live in `Directory.Packages.props`
  (Central Package Management); `.csproj` files carry no `Version=` on `PackageReference`.

## 2. Architecture — 4 projects

Solution layout: `src/<App>.Api`, `src/<App>.Application`, `src/<App>.Core`,
`src/<App>.Infrastructure`, `tests/<App>.Tests` (unit + architecture),
`tests/<App>.IntegrationTests` (WebApplicationFactory). Details: `reference/architecture.md`.

| Project | Contains | Prohibited | May reference |
|---|---|---|---|
| `<App>.Api` | Controllers, `Program.cs`, exception handler, `ApiResponse<T>`, `CurrentUser`, auth policies, form models (`Models/*FormModel.cs`) | Business logic, SQL, `DbConnection`, `DbContext` | Application, Core (Infrastructure **only** from the DI composition root) |
| `<App>.Application` | `Services/`, `Interfaces/` (service contracts, `ICurrentUser`), `Validators/`, `DependencyInjection.cs` | SQL, ADO.NET/Dapper/EF types, `HttpContext` | Core |
| `<App>.Core` | `DTOs/<Feature>/`, repository interfaces (`Interfaces/`), `Exceptions/`, `Settings/` (options classes), `Constants/` | DI, I/O, framework packages | nothing |
| `<App>.Infrastructure` | `Repositories/`, `Data/` (connection factory, type handlers), external service clients, `DependencyInjection.cs` | Business rules, calculations, default values, `ILogger` in repositories | Core |

- The dependency rule is enforced by an **architecture test** in `<App>.Tests/Architecture/`
  (NetArchTest.Rules or ArchUnitNET) that runs in `dotnet test` and therefore in CI. A new
  project or layer means updating that test in the same change.
- Services: constructor gets `I<Feature>Repository`, `IValidator<<Feature>Request>`,
  `ILogger<<Feature>Service>` (+ `ICurrentUser`, `TimeProvider` when needed). The validator runs
  **in the service, first**, via `await validator.ValidateAndThrowAsync(request, ct)`.
- DTOs are `sealed record`s: `<Feature>Request` (input) and `<Feature>Response` (output). Never
  return a database row type or EF entity from a controller.
- Slow side effects (email, notifications, file processing, slow integrations) go through a
  `Channel<T>`-based `IBackgroundTaskQueue` + `BackgroundService`, never inline in the request.
- Every async method takes a `CancellationToken` as its last parameter and forwards it.

## 3. API

Details and code: `reference/api.md`.

- Every response body is the envelope `ApiResponse<T>`:
  `{ "status": "Success" | "Created" | "Error", "message", "data", "errors", "meta" }`, JSON in
  camelCase (System.Text.Json web defaults), enums as strings. Never `return Ok(dto)` with a
  bare DTO; `return Ok(ApiResponse<T>.Ok(data))` is correct.
- Validation errors → **400** with `errors: { "fieldName": ["message", …] }` (camelCase keys).
  Model-binding errors go through `InvalidModelStateResponseFactory` → envelope; never the
  default `ValidationProblemDetails`.
- Domain exceptions inherit `DomainException` (`<App>.Core/Exceptions/`) and **declare** their
  `StatusCode` (404, 409, 403, 422…). Never throw `Exception`/`ApplicationException` for a
  business case.
- **One** central handler: `ApiExceptionHandler : IExceptionHandler` + `AddProblemDetails()` +
  `app.UseExceptionHandler()`. It maps `ValidationException` → 400, `DomainException` → its
  status (so `UnauthenticatedException` from `ICurrentUser` → 401), client cancellation → no
  body, `LogInformation`; anything else → 500 with a generic message and `LogError` (on .NET 10
  handled exceptions are not logged by the middleware — the handler logs them). Status-code-only
  responses (401/403/404/405) are rewritten to the envelope by `UseStatusCodePages`.
- Controllers are thin: route, call **one** service method, wrap the result. **No `try/catch`
  in controllers**, no `if` on roles, no SQL, no mapping logic.
- Auth on by default: `FallbackPolicy = RequireAuthenticatedUser()`. Permissions are declarative
  with named policies: `[Authorize(Policy = Permissions.<Feature>.<Action>)]`.
  `[AllowAnonymous]` only with a justification comment **on the same line**; endpoints that
  create users or credentials are never anonymous.
- `GET /health` via `MapHealthChecks` (anonymous, checks the main database connection).
- CORS with explicit origins from configuration; never `AllowAnyOrigin()` outside Development.
- Routes: `api/<feature-plural>` in kebab-case; `[ApiController]` on every controller;
  `CreatedAtAction` + `ApiResponse.Created` for creations.

## 4. Data

Dapper (default): `reference/data-dapper.md`. EF Core (only if declared):
`reference/data-efcore.md`. Scripts: `reference/sql-migrations.md`.

- Parametrized SQL only. Never `+`, `$"…"`, `string.Format` or `StringBuilder` with input in
  SQL text; dynamic `ORDER BY` columns come from a whitelist `switch`.
- Every Dapper call uses `new CommandDefinition(sql, parameters, transaction, cancellationToken: ct)`.
- Connections only through `IDbConnectionFactory` (Infrastructure) with the connection names of
  the profile; `new SqlConnection(`/`NpgsqlConnection(`/`OracleConnection(` outside
  Infrastructure is forbidden. Read-only connections never receive INSERT/UPDATE/DELETE/MERGE.
- Explicit schema and the profile's naming case (`<SCHEMA>.<PREFIX>_TABLE`); parameter prefix
  per engine (`@` SQL Server/PostgreSQL, `:` Oracle). SQL in `const string` raw literals (`"""`).
- Multi-table writes run in one explicit transaction passed to every `CommandDefinition`.
- Lists are paginated **in the database** (`OFFSET/FETCH` or `LIMIT/OFFSET`) with a stable
  `ORDER BY`; never load all rows and page in memory.
- Repositories return what the database has: no logging, no defaults, no business rules.
- Schema changes are numbered SQL scripts in the profile's folder. **Claude writes them, never
  runs them** (no `dotnet ef database update`, no `Database.Migrate()` at startup).

## 5. Validation, logging, configuration, current user

- **Validation:** FluentValidation `AbstractValidator<<Feature>Request>` in
  `Application/Validators/`, registered with `AddValidatorsFromAssemblyContaining<…>()`. Data
  annotations only on options classes. No validation logic in controllers.
- **Logging:** `ILogger<T>` only, message templates with named placeholders
  (`LogWarning("Order {OrderId} not found", id)`), never string interpolation in log calls.
  Never log passwords, tokens, connection strings, full documents or personal data. Business
  audit trails (if the profile has one) use their own service, not `ILogger`.
- **Configuration:** options pattern —
  `AddOptions<T>().BindConfiguration(T.SectionName).ValidateDataAnnotations().ValidateOnStart()`.
  No `IConfiguration["…"]` outside `Program.cs`/`DependencyInjection.cs`. Secrets come from
  user-secrets (local) and environment variables / a secret store (deployed), never from a
  committed `appsettings*.json`. Details: `reference/security-config.md`.
- **Time:** inject `TimeProvider` (tests use `FakeTimeProvider`); store UTC. `DateTime.Now` is
  forbidden.
- **Current user:** claims are read only through `ICurrentUser` (interface in Application,
  implementation over `IHttpContextAccessor` in Api). A missing required claim throws
  `UnauthenticatedException` (a `DomainException` with 401). No `User.FindFirst(...)!.Value` in controllers or services.

## 6. Testing

Details: `reference/testing.md`.

- Mandatory in the same change: unit tests for every new/changed service method and validator,
  integration tests (`WebApplicationFactory<Program>`) for every new endpoint covering 200/201,
  400, 401 (anonymous) and 403 (missing permission), and a regression test for every bug fixed.
- From day one: authentication/authorization tests (login, token issue/refresh, inactive user,
  permission policies) and the architecture test.
- Tools: xUnit, NSubstitute (or Moq if already used), xUnit `Assert` (or Shouldly /
  AwesomeAssertions if the profile declares one), `FakeTimeProvider`. Repository tests against a
  real engine use Testcontainers (optional) — never a shared or remote database.
- Names: `Method_Scenario_ExpectedResult`. One test class per service and per validator.
- Never delete, comment out or `Skip` a test to get green; never lower coverage thresholds.

## 7. Tooling

Exact commands (identical to `component.json`, `/cuadrilla:verify` and CI), run in the component
folder:

| Step | Command |
|---|---|
| setup | `dotnet restore --locked-mode` (plain `dotnet restore` if the repo has no `packages.lock.json`) |
| build | `dotnet build --no-restore -warnaserror` |
| format | `dotnet format --verify-no-changes --no-restore` |
| test | `dotnet test --no-build` (includes the architecture test) |
| start | `dotnet run --project src/<App>.Api --urls http://localhost:5000` → `GET /health` |
| audit | `dotnet list package --vulnerable --include-transitive` |

- `Directory.Build.props` sets `Nullable=enable`, `TreatWarningsAsErrors=true`,
  `EnforceCodeStyleInBuild=true`, `RestorePackagesWithLockFile=true`. Never add `<NoWarn>` or
  `#pragma warning disable` without a justification comment on the same line.
- There are **no per-file format/lint hooks** for C#: `dotnet format` needs the whole solution
  and takes too long per edit. Formatting and analyzers are verified by the `format` and `build`
  checks — run them before handing off and fix what they report (`dotnet format` without
  `--verify-no-changes` applies fixes).
- Forbidden patterns checked on every stop (besides the core C# built-ins): SQL concatenation in
  Dapper calls, provider connections outside Infrastructure, `try/catch` in controllers,
  `[AllowAnonymous]` without a same-line comment, `DateTime.Now`, unjustified
  `#pragma warning disable` / `[SuppressMessage]`.

## 8. Files in this skill

- `${CLAUDE_SKILL_DIR}/component.json` — the `cuadrilla.json` component template (checks, start,
  audit, forbidden patterns, protected paths, recommended skills). Read when adopting or when a
  check command is in question.
- `${CLAUDE_SKILL_DIR}/reference/architecture.md` — solution layout, DI composition, services,
  background queue, architecture test code. Read when creating projects, services or layers.
- `${CLAUDE_SKILL_DIR}/reference/api.md` — `ApiResponse<T>`, exception handler, controllers,
  auth policies, `ICurrentUser`, health, CORS. Read when touching Api.
- `${CLAUDE_SKILL_DIR}/reference/data-dapper.md` — connection factory, repositories,
  transactions, paging and per-engine notes (SQL Server, PostgreSQL, Oracle). Default data rules.
- `${CLAUDE_SKILL_DIR}/reference/data-efcore.md` — EF Core rules; read only if the profile
  declares EF Core.
- `${CLAUDE_SKILL_DIR}/reference/sql-migrations.md` — script naming, numbering, per-engine
  idempotency. Read before writing any `.sql` file.
- `${CLAUDE_SKILL_DIR}/reference/testing.md` — unit, integration, auth and architecture tests.
- `${CLAUDE_SKILL_DIR}/reference/security-config.md` — secrets, options, appsettings, gitignore.
- `${CLAUDE_SKILL_DIR}/reference/deploy-iis.md` — optional: publishing for IIS (only if the
  profile deploys to IIS).
- `${CLAUDE_SKILL_DIR}/templates/ci-job.yml` — GitHub Actions job for this component.
- `${CLAUDE_SKILL_DIR}/templates/Dockerfile` and `.dockerignore` — multi-stage, non-root image.
- `${CLAUDE_SKILL_DIR}/templates/Directory.Build.props` — build properties shared by all projects.
- `${CLAUDE_SKILL_DIR}/templates/.editorconfig` — formatting and analyzer severities.
- `${CLAUDE_SKILL_DIR}/templates/appsettings.example.json` — configuration shape without secrets.

## Shared auth contract
Authentication endpoints (`/api/auth/login`, `/api/auth/refresh`, `/api/auth/logout`, `/api/me`), payloads and cookie rules are defined once in `cuadrilla:standard-api` ("Shared auth contract") so every frontend pack works with this backend. Implement them exactly; differences go to the profile's "Exceptions to the standard".
