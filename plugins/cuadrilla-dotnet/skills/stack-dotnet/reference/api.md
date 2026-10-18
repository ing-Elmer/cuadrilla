# API — envelope, errors, controllers, auth

## Envelope

The envelope is the contract with every client (the frontend packs consume the same shape).

```jsonc
{
  "status": "Success",            // "Success" | "Created" | "Error"
  "message": "Order created.",    // human-readable, safe to show
  "data": { },                    // payload or null
  "errors": { "number": ["Number is required."] },   // null unless status = Error
  "meta": { "page": 1, "pageSize": 20, "totalCount": 135 }  // paging, null otherwise
}
```

```csharp
// <App>.Api/Responses/ApiResponse.cs
[JsonConverter(typeof(JsonStringEnumConverter<ApiResponseStatus>))]
public enum ApiResponseStatus { Success, Created, Error }

public sealed record PageMeta(int Page, int PageSize, long TotalCount);

public sealed record ApiResponse<T>(
    ApiResponseStatus Status,
    string Message,
    T? Data,
    IReadOnlyDictionary<string, string[]>? Errors = null,
    PageMeta? Meta = null)
{
    public static ApiResponse<T> Ok(T data, string message = "OK", PageMeta? meta = null) =>
        new(ApiResponseStatus.Success, message, data, null, meta);
    public static ApiResponse<T> Created(T data, string message = "Created") =>
        new(ApiResponseStatus.Created, message, data);
}

public static class ApiResponse
{
    public static ApiResponse<object?> Success(string message) => new(ApiResponseStatus.Success, message, null);
    public static ApiResponse<object?> Error(string message, IReadOnlyDictionary<string, string[]>? errors = null) =>
        new(ApiResponseStatus.Error, message, null, errors);
}
```

Rules checkable in a diff:
- Every action returns `ActionResult<ApiResponse<T>>` (or `IResult` with the envelope in minimal
  APIs) and declares `[ProducesResponseType<ApiResponse<T>>(StatusCodes.Status200OK)]` plus the
  error codes it can return.
- No `return Ok(dto)`, `return NotFound()`, `return BadRequest("text")`, `Problem(...)`. Errors
  are exceptions; the handler writes the body.
- Keys in `errors` are camelCase property paths (`items[0].quantity`); the generic 500 message
  never contains exception text.

## JSON

`AddControllers().AddJsonOptions(o => o.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter()))`.
Web defaults already give camelCase. Dates are `DateTimeOffset` (or `DateOnly`) in ISO 8601 UTC.

## Validation → 400

```csharp
builder.Services.AddControllers()
    .ConfigureApiBehaviorOptions(o => o.InvalidModelStateResponseFactory = context =>
        new BadRequestObjectResult(ApiResponse.Error("Validation failed.",
            context.ModelState.Where(e => e.Value?.Errors.Count > 0)
                .ToDictionary(e => JsonNamingPolicy.CamelCase.ConvertName(e.Key),
                              e => e.Value!.Errors.Select(x => x.ErrorMessage).ToArray()))));
```

FluentValidation's `ValidationException` (thrown by `ValidateAndThrowAsync` in the service) is
mapped by the exception handler to the same shape, grouping `Errors` by camelCased
`PropertyName`. Do not use the auto-validation filter packages; validation runs in the service.

## Domain exceptions

```csharp
// <App>.Core/Exceptions/DomainException.cs
public abstract class DomainException(string message, int statusCode) : Exception(message)
{
    public int StatusCode { get; } = statusCode;
}
public sealed class NotFoundException(string message) : DomainException(message, 404);
public sealed class ConflictException(string message) : DomainException(message, 409);
public sealed class ForbiddenException(string message) : DomainException(message, 403);
public sealed class UnauthenticatedException(string message) : DomainException(message, 401);
public sealed class BusinessRuleException(string message) : DomainException(message, 422);
```

Core has no ASP.NET reference, so status codes are plain `int` literals. A new exception type
declares its status in its base-constructor call; a comment is not enough.

## Central exception handler

```csharp
public sealed class ApiExceptionHandler(ILogger<ApiExceptionHandler> logger) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext http, Exception exception, CancellationToken ct)
    {
        if (exception is OperationCanceledException && http.RequestAborted.IsCancellationRequested)
        {
            logger.LogInformation("Request {Path} cancelled by the client", http.Request.Path);
            http.Response.StatusCode = 499;   // client closed request; nobody reads the body
            return true;
        }

        var (status, body) = exception switch
        {
            ValidationException v => (400, ApiResponse.Error("Validation failed.", GroupErrors(v))),
            DomainException d => (d.StatusCode, ApiResponse.Error(d.Message)),
            _ => (500, ApiResponse.Error("An unexpected error occurred.")),
        };

        if (status >= 500) logger.LogError(exception, "Unhandled exception on {Path}", http.Request.Path);
        else logger.LogWarning("{ExceptionType} on {Path}: {Message}", exception.GetType().Name, http.Request.Path, exception.Message);

        http.Response.StatusCode = status;
        await http.Response.WriteAsJsonAsync(body, ct);
        return true;
    }
}
```

```csharp
builder.Services.AddExceptionHandler<ApiExceptionHandler>();
builder.Services.AddProblemDetails();          // fallback required by UseExceptionHandler()
// …
app.UseExceptionHandler();
app.UseStatusCodePages(async ctx =>             // 401/403/404/405 without body → envelope
{
    var response = ctx.HttpContext.Response;
    await response.WriteAsJsonAsync(ApiResponse.Error(ReasonPhrases.GetReasonPhrase(response.StatusCode)));
});
```

- On .NET 10+ the middleware does not log exceptions a handler marks as handled; the handler
  logs (500 → `LogError` with the exception, 4xx → `LogWarning` without stack trace).
- No other `try/catch` translates exceptions to HTTP: not in controllers, filters or services.
  A `catch` is allowed in services/infrastructure only to wrap a provider error into a
  `DomainException` (e.g. unique-constraint violation → `ConflictException`) or for retries.
- `UseDeveloperExceptionPage` is never enabled outside Development.

## Controllers

```csharp
[ApiController]
[Route("api/orders")]
public sealed class OrdersController(IOrderService service) : ControllerBase
{
    [HttpGet("{id:long}")]
    [Authorize(Policy = Permissions.Orders.Read)]
    [ProducesResponseType<ApiResponse<OrderResponse>>(StatusCodes.Status200OK)]
    public async Task<ActionResult<ApiResponse<OrderResponse>>> GetById(long id, CancellationToken ct) =>
        Ok(ApiResponse<OrderResponse>.Ok(await service.GetByIdAsync(id, ct)));

    [HttpPost]
    [Authorize(Policy = Permissions.Orders.Create)]
    [ProducesResponseType<ApiResponse<OrderResponse>>(StatusCodes.Status201Created)]
    public async Task<ActionResult<ApiResponse<OrderResponse>>> Create(CreateOrderRequest request, CancellationToken ct)
    {
        var created = await service.CreateAsync(request, ct);
        return CreatedAtAction(nameof(GetById), new { id = created.Id }, ApiResponse<OrderResponse>.Created(created));
    }
}
```

- One service call per action; the `CancellationToken` parameter is always present and forwarded.
- No `try/catch`, no `if (User.IsInRole(...))`, no repository injection, no mapping code.
- Uploads: `[FromForm] <Name>FormModel` in `Api/Models/`, validated size/content type, streamed
  to the service as `Stream`; never `IFormFile` past the Api layer.
- Every endpoint consumed by a frontend is added to the frontend's endpoint list in the same change
  (if the repo has one).

## Authentication and authorization

```csharp
builder.Services.AddAuthorizationBuilder()
    .SetFallbackPolicy(new AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build())
    .AddPolicy(Permissions.Orders.Read, p => p.RequireClaim("permission", Permissions.Orders.Read))
    .AddPolicy(Permissions.Orders.Create, p => p.RequireClaim("permission", Permissions.Orders.Create));
```

- The scheme (JWT bearer, cookies, Microsoft Entra ID via Microsoft.Identity.Web, …) comes from
  the profile. JWT: validate issuer, audience, lifetime and signing key; `ClockSkew` ≤ 1 minute;
  signing keys from configuration secrets, never a `const`.
- Permission codes are `const string` in `Api/Security/Permissions.cs`, one nested class per
  feature. Dynamic permissions (from the database) use a custom `IAuthorizationHandler` +
  requirement, still referenced by policy name.
- `[AllowAnonymous] // <reason>` — the comment is mandatory and on the same line (checked by the
  stop hook). Login, refresh and health are typical; user/credential creation never is.
- If the app stores passwords: `PasswordHasher<T>` (ASP.NET Core Identity) or a vetted
  Argon2/BCrypt package; never a home-made hash. Refresh tokens are stored hashed and rotated.

## Current user

```csharp
// <App>.Application/Interfaces/ICurrentUser.cs
public interface ICurrentUser
{
    long UserId { get; }                 // throws UnauthenticatedException if the claim is missing
    string UserName { get; }
    bool HasPermission(string permission);
}
```

Implemented in `Api/Security/CurrentUser.cs` over `IHttpContextAccessor`
(`AddHttpContextAccessor()`), registered `Scoped`. Background jobs get a system implementation.
Controllers and services never read `HttpContext.User` directly.

## Operation

- `builder.Services.AddHealthChecks().AddCheck<DatabaseHealthCheck>("database");`
  `app.MapHealthChecks("/health").AllowAnonymous(); // load balancer / orchestrator probe`
  The database check opens the main connection and runs the engine's cheapest query.
- CORS: named policy with `WithOrigins(options.AllowedOrigins)` from configuration;
  `AllowAnyOrigin()` only inside `if (app.Environment.IsDevelopment())`.
- OpenAPI: `AddOpenApi()` / `MapOpenApi()` (built-in since .NET 9) only in non-production
  environments or behind auth, per the profile.
- Behind a reverse proxy (IIS, nginx, a cloud load balancer) configure `ForwardedHeadersOptions`
  with the known proxies; `UseHttpsRedirection` + `UseHsts` outside Development.
- Middleware order: `UseExceptionHandler` → `UseStatusCodePages` → `UseHsts`/`UseHttpsRedirection`
  → `UseCors` → `UseAuthentication` → `UseAuthorization` → `MapControllers`/`MapHealthChecks`.
