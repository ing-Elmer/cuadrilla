# Architecture — 4 projects

## Solution layout

```
<component path>/
├── global.json                    SDK pin (+ "test": { "runner": "Microsoft.Testing.Platform" } if used)
├── Directory.Build.props          shared build properties (template in this skill)
├── Directory.Packages.props       Central Package Management: one version per package
├── .editorconfig                  formatting + analyzer severities
├── <App>.slnx                     (or .sln on older SDKs — only one solution file per folder)
├── src/
│   ├── <App>.Api/
│   │   ├── Controllers/           <Feature>Controller.cs (or Endpoints/ for minimal APIs)
│   │   ├── Models/                <Name>FormModel.cs (IFormFile uploads only)
│   │   ├── Responses/             ApiResponse.cs, ApiResponseStatus.cs, PageMeta.cs
│   │   ├── ErrorHandling/         ApiExceptionHandler.cs, envelope status-code pages
│   │   ├── Security/              Permissions.cs, AuthorizationSetup.cs, CurrentUser.cs
│   │   ├── Health/                DatabaseHealthCheck.cs (or in Infrastructure)
│   │   └── Program.cs             composition root
│   ├── <App>.Application/
│   │   ├── Interfaces/            I<Feature>Service.cs, ICurrentUser.cs, IBackgroundTaskQueue.cs
│   │   ├── Services/              <Feature>Service.cs
│   │   ├── Validators/            <Feature>RequestValidator.cs
│   │   ├── Mapping/               <Feature>Mappings.cs (extension methods) — if mapping is needed
│   │   └── DependencyInjection.cs AddApplication()
│   ├── <App>.Core/
│   │   ├── DTOs/<Feature>/        <Feature>Request.cs, <Feature>Response.cs
│   │   ├── Interfaces/            I<Feature>Repository.cs
│   │   ├── Exceptions/            DomainException.cs + concrete exceptions
│   │   ├── Settings/              <Name>Options.cs (options classes, SectionName const)
│   │   └── Constants/
│   └── <App>.Infrastructure/
│       ├── Data/                  IDbConnectionFactory.cs, DbConnectionFactory.cs, type handlers
│       ├── Repositories/          <Feature>Repository.cs
│       ├── External/              HTTP clients for third-party services (typed HttpClient)
│       └── DependencyInjection.cs AddInfrastructure(configuration)
└── tests/
    ├── <App>.Tests/               unit tests + Architecture/LayerTests.cs
    └── <App>.IntegrationTests/    WebApplicationFactory<Program> tests (+ Testcontainers, optional)
```

If the existing project uses other folder names, follow the project and mention the mismatch;
the layer table and the dependency rule are not negotiable without a profile exception.

## Dependency rule

```
Api ──► Application ──► Core ◄── Infrastructure
 └──────────────(DI only)──────────────┘
```

- `Core` references nothing in the solution and no framework packages (FluentValidation is not
  referenced by Core).
- `Application` references `Core` only. It may reference `FluentValidation`,
  `Microsoft.Extensions.*.Abstractions`. Never `Dapper`, `Microsoft.Data.SqlClient`, `Npgsql`,
  `Oracle.ManagedDataAccess`, `Microsoft.EntityFrameworkCore`, `Microsoft.AspNetCore.*`.
- `Infrastructure` references `Core` only (not Application).
- `Api` references Application and Core; it references Infrastructure **only** to call
  `AddInfrastructure()` from `Program.cs`. Controllers never use Infrastructure types.

## Composition root

```csharp
// Program.cs (excerpt)
builder.Services
    .AddApplication()
    .AddInfrastructure(builder.Configuration);
```

Each layer exposes one `DependencyInjection` static class with an `Add<Layer>` extension. Lifetimes:
services and repositories `Scoped`; connection factory, `TimeProvider.System`, background queue
`Singleton`; validators via `AddValidatorsFromAssemblyContaining<…>(ServiceLifetime.Scoped)`.

## Services

```csharp
public sealed class OrderService(
    IOrderRepository repository,
    IValidator<CreateOrderRequest> validator,
    ICurrentUser currentUser,
    TimeProvider timeProvider,
    ILogger<OrderService> logger) : IOrderService
{
    public async Task<OrderResponse> CreateAsync(CreateOrderRequest request, CancellationToken ct)
    {
        await validator.ValidateAndThrowAsync(request, ct);          // always first
        if (await repository.ExistsByNumberAsync(request.Number, ct))
            throw new ConflictException($"Order {request.Number} already exists.");

        var id = await repository.InsertAsync(request, currentUser.UserId, timeProvider.GetUtcNow(), ct);
        logger.LogInformation("Order {OrderId} created by {UserId}", id, currentUser.UserId);
        return (await repository.GetByIdAsync(id, ct))!;
    }
}
```

Rules:
- Primary constructors are fine; fields are never reassigned.
- A service method orchestrates: validate → check rules → call repositories → map. Business
  rules (defaults, calculations, state transitions) live here, never in repositories or controllers.
- A flow duplicated in two services is extracted into a shared service; no copy-paste.
- Services return DTOs (or `PagedResult<T>`), never `ApiResponse<T>` (that is Api's concern).
- A service never catches an exception just to log and rethrow; let the handler do it.

## Background work

`IBackgroundTaskQueue` (Application interface) implemented with `Channel<Func<IServiceProvider,
CancellationToken, ValueTask>>` (bounded) in Infrastructure, consumed by a `BackgroundService`
that creates a scope per work item and logs failures. Requests enqueue and return; they never
`Task.Run` fire-and-forget.

## Architecture test (mandatory)

`tests/<App>.Tests/Architecture/LayerTests.cs` with NetArchTest.Rules (or the equivalent
ArchUnitNET rules). Marker types (`AssemblyMarker` classes, one per project) avoid fragile
string assembly names.

```csharp
public sealed class LayerTests
{
    private static readonly Assembly Core = typeof(Core.AssemblyMarker).Assembly;
    private static readonly Assembly Application = typeof(Application.AssemblyMarker).Assembly;
    private static readonly Assembly Infrastructure = typeof(Infrastructure.AssemblyMarker).Assembly;
    private static readonly Assembly Api = typeof(Program).Assembly;

    [Fact]
    public void Core_DependsOnNoOtherLayer() =>
        AssertNoDependency(Core, "<App>.Application", "<App>.Infrastructure", "<App>.Api");

    [Fact]
    public void Application_DoesNotDependOnInfrastructureOrDataLibraries() =>
        AssertNoDependency(Application, "<App>.Infrastructure", "<App>.Api",
            "Dapper", "Microsoft.Data.SqlClient", "Npgsql", "Oracle.ManagedDataAccess",
            "Microsoft.EntityFrameworkCore", "Microsoft.AspNetCore");

    [Fact]
    public void Infrastructure_DoesNotDependOnApplicationOrApi() =>
        AssertNoDependency(Infrastructure, "<App>.Application", "<App>.Api");

    [Fact]
    public void Controllers_DoNotDependOnInfrastructure()
    {
        var result = Types.InAssembly(Api)
            .That().ResideInNamespace("<App>.Api.Controllers")
            .ShouldNot().HaveDependencyOnAny("<App>.Infrastructure", "Dapper", "System.Data")
            .GetResult();
        Assert.True(result.IsSuccessful, Describe(result));
    }

    private static void AssertNoDependency(Assembly assembly, params string[] forbidden)
    {
        var result = Types.InAssembly(assembly).ShouldNot().HaveDependencyOnAny(forbidden).GetResult();
        Assert.True(result.IsSuccessful, Describe(result));
    }

    private static string Describe(TestResult result) =>
        "Violations: " + string.Join(", ", result.FailingTypeNames ?? []);
}
```

Check the library's current API with Context7 before writing (method names differ between
NetArchTest.Rules, its forks and ArchUnitNET). Add rules when you add a layer or a convention
(e.g. "repositories reside in `<App>.Infrastructure.Repositories` and are `internal sealed`").
