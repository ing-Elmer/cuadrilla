# cuadrilla-dotnet

Stack pack for [cuadrilla](../cuadrilla): teaches the cuadrilla team to build **.NET + ASP.NET Core**
backends to a written, checkable standard. Requires the `cuadrilla` core plugin.

## Install

```text
/plugin install cuadrilla-dotnet@cuadrilla
```

The `cuadrilla` core is a declared dependency (install it too if your Claude Code version does not
resolve dependencies automatically). Then run `/cuadrilla:adopt` in your
repository so the .NET component lands in `.claude/cuadrilla.json`.

## What you get

| Piece | What it does |
|---|---|
| `backend-dotnet` agent | Specialist implementer: controllers, services, validators, repositories, SQL scripts and tests, finishing with your real build/format/test results. |
| `stack-dotnet` skill | The standard. Loads automatically when Claude touches `*.cs`, `*.csproj`, `*.sln`, `*.slnx`. Deeper rules in `reference/` (architecture, API, Dapper, EF Core, SQL scripts, testing, security/config, IIS publishing). |
| `/cuadrilla-dotnet:feature-dotnet` | Scaffolds a full feature across the 4 layers plus tests — shows the file list and endpoint contract first, waits for your OK, runs the checks, ends with the core reviewer. |
| `component.json` | What `/cuadrilla:adopt` writes into `.claude/cuadrilla.json` for a .NET component: setup, checks, start, audit, forbidden patterns, protected files. |
| Templates | `ci-job.yml` (GitHub Actions job), multi-stage non-root `Dockerfile` + `.dockerignore`, `Directory.Build.props`, `.editorconfig`, `appsettings.example.json`. |
| `microsoft-learn` MCP | Official Microsoft docs, so the agent checks APIs for your pinned .NET version instead of guessing. No credentials needed. |

## What the standard enforces

- **4 projects** — `<App>.Api`, `<App>.Application`, `<App>.Core`, `<App>.Infrastructure` — with
  the dependency rule enforced by an **architecture test** (NetArchTest.Rules or ArchUnitNET)
  that runs in `dotnet test` and CI.
- **API:** `ApiResponse<T>` envelope `{ status, message, data, errors, meta }`, validation → 400
  with per-field errors, domain exceptions that carry their HTTP status, one `IExceptionHandler`,
  thin controllers without `try/catch`, authentication on by default and policy-based
  permissions, `GET /health`.
- **Data:** Dapper with `CommandDefinition` + `CancellationToken` and parametrized SQL by
  default; EF Core only when your project profile declares it (no lazy loading, `AsNoTracking`
  reads, migrations scripted, never auto-applied). Per-engine notes for **SQL Server,
  PostgreSQL and Oracle** (parameter prefixes, paging, identity, naming).
- **Cross-cutting:** FluentValidation in services, `ICurrentUser` over claims, `ILogger` only,
  options pattern with `ValidateOnStart`, secrets in user-secrets / environment variables,
  `TimeProvider` instead of `DateTime.Now`.
- **Tests:** xUnit + NSubstitute, `WebApplicationFactory` endpoint tests (200/400/401/403),
  auth tests from day one, a regression test per bug, Testcontainers optional.
- **Tooling:** `Nullable` + `TreatWarningsAsErrors` in `Directory.Build.props`, Central Package
  Management, lock files, `dotnet format` verified in CI.
- **SQL scripts:** numbered `NNN_<verb>_<description>.sql`, idempotent per engine — Claude writes
  them and **never runs them**.

## Checks (local = CI)

```text
setup   dotnet restore --locked-mode
build   dotnet build --no-restore -warnaserror
format  dotnet format --verify-no-changes --no-restore
test    dotnet test --no-build
start   dotnet run --project src/<App>.Api --urls http://localhost:5000   (health: /health)
audit   dotnet list package --vulnerable --include-transitive
```

- `--locked-mode` needs committed `packages.lock.json` files (`RestorePackagesWithLockFile` in the
  `Directory.Build.props` template creates them on the next restore). If your repo does not use
  lock files yet, change `setup` to plain `dotnet restore` in `.claude/cuadrilla.json` and remove
  the `cache` lines of the CI job.
- `dotnet format` and `dotnet build` need exactly one solution (`.slnx` or `.sln`) or project in
  the component folder; otherwise append its name to each command.
- There are **no per-file format/lint hooks** for C#: `dotnet format` loads the whole solution
  and is too slow to run after every edit. Formatting and analyzers are enforced by the
  `format` and `build` checks (`/cuadrilla:verify` and CI).

## Forbidden patterns (stop-check hook)

Added on top of the core C# built-ins (`Console.Write`, `Debugger.Break`, skipped tests,
interpolated SQL in Dapper/EF calls, sync-over-async):

| Pattern | Why |
|---|---|
| `"…" +` in a Dapper `Query*/Execute*` call or `new CommandDefinition("…" + …)` / `($"…")` | SQL injection; use constant SQL with parameters |
| `new SqlConnection(` / `NpgsqlConnection(` / `OracleConnection(` … in Api, Application or Core | connections belong to Infrastructure (`IDbConnectionFactory`) |
| `try` / `catch` in `Controllers/` or `Endpoints/` | the central exception handler translates errors |
| `[AllowAnonymous]` / `.AllowAnonymous()` without a same-line `// reason` | auth is on by default; public endpoints are justified |
| `DateTime.Now` / `DateTime.Today` (and `DateTimeOffset`) | use an injected `TimeProvider`, UTC |
| `#pragma warning disable` without a same-line comment, `[SuppressMessage]` without `Justification` | suppressions must be explained |

If your profile is **Dapper only**, you can also forbid EF Core in `.claude/cuadrilla.json`:

```json
{ "glob": "**/*.cs", "pattern": "\\busing\\s+Microsoft\\.EntityFrameworkCore\\b", "message": "EF Core is not allowed by the project profile", "tests": true }
```

Protected files (guard hook): `appsettings.Production.json`, `appsettings.*.local.json`,
`secrets.json` — in addition to the core defaults (`.env*`, keys, certificates).

## Recommended third-party skills

Optional, from the official .NET team repository [`dotnet/skills`](https://github.com/dotnet/skills).
They are reference material only; the cuadrilla standard wins on conflicts.

| Skill | Why | Ignore from it |
|---|---|---|
| `dotnet-webapi` | HTTP semantics, OpenAPI metadata, `.http` files for endpoints. | Its default of minimal APIs for new projects, raw `ProblemDetails`/`TypedResults` bodies and `Create{Entity}Request` naming — cuadrilla uses controllers (unless your profile says otherwise), the `ApiResponse<T>` envelope and `<Feature>Request`/`<Feature>Response`. |
| `test-anti-patterns` | Spots flaky, over-mocked or assertion-free tests during review. | Nothing known; cuadrilla's mandatory test list still applies. |
| `csharp-refactoring` | Behavior-preserving refactors verified by build + tests. | Never let a refactor break the layer rule or move SQL out of Infrastructure. |

Install with `npx skills add dotnet/skills` (choose the skills above) or the `dotnet/skills`
Claude Code marketplace.

## Library licensing notes

AutoMapper, MediatR and FluentAssertions (v8+) moved to commercial licences. The standard does not
require them: map by hand (or with Mapperly), call services directly, and assert with xUnit
`Assert` (or Shouldly/AwesomeAssertions if your profile declares one). The agent will not add
any NuGet package without your confirmation.

## Optional: IIS

If your profile deploys to IIS, `reference/deploy-iis.md` describes how the agent prepares a
publish package (framework-dependent, `web.config` checks, no secrets in the output) — it never
deploys, recycles app pools or copies to servers.
