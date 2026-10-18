# Testing

## Projects and tools

| Project | Contains | Packages (versions in `Directory.Packages.props`) |
|---|---|---|
| `tests/<App>.Tests` | Service, validator, mapping and handler unit tests; `Architecture/LayerTests.cs` | xUnit (v3 preferred: `xunit.v3`), NSubstitute, `Microsoft.Extensions.TimeProvider.Testing`, NetArchTest.Rules or ArchUnitNET |
| `tests/<App>.IntegrationTests` | API tests with `WebApplicationFactory<Program>`; optional repository tests with Testcontainers | `Microsoft.AspNetCore.Mvc.Testing`, xUnit, Testcontainers modules (`Testcontainers.MsSql` / `.PostgreSql` / `.Oracle`) — optional |

- Assertions: xUnit `Assert`. Shouldly or AwesomeAssertions only if the profile declares them.
  FluentAssertions v8+ requires a commercial licence: do not add it without the user's OK.
- Mocks: NSubstitute (Moq only if the project already uses it). Prefer hand-written fakes for
  simple interfaces (`FakeCurrentUser`) and `FakeTimeProvider` for time.
- With the .NET 10+ SDK and xUnit v3 / MSTest on Microsoft.Testing.Platform, opt into the MTP mode
  of `dotnet test` with `"test": { "runner": "Microsoft.Testing.Platform" }` in `global.json`.
  Check the pinned SDK and the docs before changing the runner.

## What is mandatory (in the same change)

1. **Every new or changed service method:** happy path + each business rule / exception branch.
2. **Every validator:** one test per rule (valid passes, each invalid case fails on the right
   property).
3. **Every new endpoint:** integration tests for success (200/201 with the envelope),
   400 (validation, `errors` keys camelCase), 401 (anonymous), 403 (authenticated without the
   permission) and 404 where applicable.
4. **Every bug fix:** a test that fails before the fix and passes after it.
5. **From day one:** authentication (login, password verification, token issue and refresh,
   inactive/locked user) and authorization policy tests, plus the architecture test.

## Conventions

- Test class per unit: `<Feature>ServiceTests`, `<Feature>RequestValidatorTests`.
- Method names `Method_Scenario_ExpectedResult` (`CreateAsync_DuplicateNumber_ThrowsConflict`).
- Arrange / Act / Assert blocks; one behavior per test; `[Theory]` + `[InlineData]` for
  variations of the same rule.
- Pass `TestContext.Current.CancellationToken` (xUnit v3) or `CancellationToken.None` explicitly.
- Unit tests never touch a real database, file system, network or clock.
- Never `[Fact(Skip = …)]`, never comment out or delete a failing test, never `Thread.Sleep`.

## Service test example

```csharp
public sealed class OrderServiceTests
{
    private readonly IOrderRepository _repository = Substitute.For<IOrderRepository>();
    private readonly FakeTimeProvider _time = new(new DateTimeOffset(2026, 1, 15, 10, 0, 0, TimeSpan.Zero));
    private readonly OrderService _sut;

    public OrderServiceTests() =>
        _sut = new OrderService(_repository, new CreateOrderRequestValidator(),
            new FakeCurrentUser(userId: 7), _time, NullLogger<OrderService>.Instance);

    [Fact]
    public async Task CreateAsync_DuplicateNumber_ThrowsConflict()
    {
        _repository.ExistsByNumberAsync("A-1", Arg.Any<CancellationToken>()).Returns(true);

        await Assert.ThrowsAsync<ConflictException>(() =>
            _sut.CreateAsync(new CreateOrderRequest("A-1", 10m), CancellationToken.None));

        await _repository.DidNotReceiveWithAnyArgs().InsertAsync(default!, default, default, default);
    }
}
```

Use the real validator in service tests (it is pure); mock only I/O boundaries.

## API tests

- `public sealed class ApiFactory : WebApplicationFactory<Program>` overrides
  `ConfigureWebHost`: environment `Testing`, replaces repositories (or the connection factory)
  with fakes or a Testcontainers database, and registers a **test authentication handler**
  (`AuthenticationHandler<AuthenticationSchemeOptions>` under scheme `"Test"`) that builds the
  principal from request headers (e.g. `X-Test-User`, `X-Test-Permissions`). Anonymous requests
  send no header → 401.
- On .NET 10+ the generated `Program` class is accessible to the test project; on older versions
  add `public partial class Program;` at the end of `Program.cs`.
- Assert the status code **and** the envelope (`status`, `message`, `errors` keys), deserializing
  with `JsonSerializerOptions.Web`.
- Tests are independent: each test seeds what it needs; no ordering dependencies.

## Repository tests (optional, recommended for complex SQL)

- Testcontainers with the profile's engine; the fixture applies the scripts of the profile's
  folder in order, then runs the repository against it. Shared per collection
  (`ICollectionFixture`) to keep runs fast.
- Never point tests at a shared, remote or production database. CI runs them on
  `ubuntu-latest`, which has Docker.
