# API — envelope, controllers, errors (detail)

Code below targets the current Spring Boot line; check the project's pinned version and
Context7 before relying on a signature (Boot 4 = Spring Framework 7 + Jackson 3).

## Envelope

```java
package <base>.api;

public enum ApiStatus {
    SUCCESS("Success"), CREATED("Created"), ERROR("Error");
    private final String json;
    ApiStatus(String json) { this.json = json; }
    @JsonValue public String json() { return json; }      // com.fasterxml.jackson.annotation
}

public record ApiResponse<T>(ApiStatus status, String message, T data,
                             Map<String, List<String>> errors, Map<String, Object> meta) {
    public static <T> ApiResponse<T> ok(String message, T data) {
        return new ApiResponse<>(ApiStatus.SUCCESS, message, data, null, null);
    }
    public static ApiResponse<Void> success(String message) {
        return new ApiResponse<>(ApiStatus.SUCCESS, message, null, null, null);
    }
    public static <T> ApiResponse<T> created(String message, T data) {
        return new ApiResponse<>(ApiStatus.CREATED, message, data, null, null);
    }
    public static <T> ApiResponse<List<T>> page(String message, PageResult<T> page) {
        return new ApiResponse<>(ApiStatus.SUCCESS, message, page.items(), null,
                Map.of("page", page.page(), "size", page.size(), "total", page.total()));
    }
    public static ApiResponse<Void> badRequest(String message, Map<String, List<String>> errors) {
        return new ApiResponse<>(ApiStatus.ERROR, message, null, errors, null);
    }
    public static ApiResponse<Void> error(String message) {
        return new ApiResponse<>(ApiStatus.ERROR, message, null, null, null);
    }
}
```

- All five keys are always present (nulls serialized) so clients see one shape.
- JSON field names = record component names (camelCase). No global
  `PropertyNamingStrategies.SNAKE_CASE`.
- `Created` responses use HTTP 201 + `Location`; `Success` uses 200; deletes return 200 with
  `ApiResponse.success(...)` (not 204, so the envelope is always present).

## Controllers

```java
@RestController
@RequestMapping("/api/orders")
class OrderController {
    private final OrderService service;
    OrderController(OrderService service) { this.service = service; }

    @GetMapping
    @PreAuthorize("hasAuthority('ORDERS_READ')")
    ApiResponse<List<OrderResponse>> list(@RequestParam long customerId,
                                          @RequestParam(defaultValue = "1") @Min(1) int page,
                                          @RequestParam(defaultValue = "20") @Min(1) @Max(100) int size) {
        return ApiResponse.page("Orders", service.list(customerId, new PageRequest(page, size)));
    }

    @PostMapping
    @PreAuthorize("hasAuthority('ORDERS_WRITE')")
    ResponseEntity<ApiResponse<OrderResponse>> create(@Valid @RequestBody OrderRequest request) {
        OrderResponse created = service.create(request);
        return ResponseEntity.created(URI.create("/api/orders/" + created.id()))
                .body(ApiResponse.created("Order created", created));
    }
}
```

Checkable rules:
- One service call per handler; no repository, `JdbcClient`, `Clock` or `CurrentUser` in a
  controller (the service reads the current user).
- No `try/catch`, `ResponseStatusException`, `HttpServletResponse.setStatus`, or
  `ResponseEntity.status(...)` for errors; throw a domain exception from the service.
- `@Valid` on every `@RequestBody`; constraints on `@RequestParam`/`@PathVariable` use built-in
  method validation (→ `HandlerMethodValidationException` → 400).
- Every handler has `@PreAuthorize` (method or class level). A public handler carries
  `@PublicEndpoint(reason = "...")` (a marker annotation in `api.security`) and is also listed in
  the `permitAll()` matchers; `ArchitectureTest` checks it.
- Permission codes are the ones in the profile's permission catalogue; never `hasRole(...)`
  checks or `if (user.isAdmin())` in code.
- Multipart: `@RequestPart MultipartFile` + a request record; size limits in
  `spring.servlet.multipart.*`.
- Every endpoint the frontend consumes is added to the frontend endpoint map in the same change.

## GlobalExceptionHandler

```java
@RestControllerAdvice
class GlobalExceptionHandler {
    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @ExceptionHandler(MethodArgumentNotValidException.class)
    ResponseEntity<ApiResponse<Void>> invalidBody(MethodArgumentNotValidException ex) {
        Map<String, List<String>> errors = new LinkedHashMap<>();
        ex.getBindingResult().getFieldErrors().forEach(e ->
                errors.computeIfAbsent(e.getField(), k -> new ArrayList<>()).add(e.getDefaultMessage()));
        return ResponseEntity.badRequest().body(ApiResponse.badRequest("Validation failed", errors));
    }

    @ExceptionHandler(HandlerMethodValidationException.class)
    ResponseEntity<ApiResponse<Void>> invalidParams(HandlerMethodValidationException ex) {
        Map<String, List<String>> errors = new LinkedHashMap<>();
        ex.getParameterValidationResults().forEach(r -> errors.put(
                r.getMethodParameter().getParameterName(),
                r.getResolvableErrors().stream().map(MessageSourceResolvable::getDefaultMessage).toList()));
        return ResponseEntity.badRequest().body(ApiResponse.badRequest("Validation failed", errors));
    }

    @ExceptionHandler({HttpMessageNotReadableException.class, MethodArgumentTypeMismatchException.class})
    ResponseEntity<ApiResponse<Void>> unreadable(Exception ex) {
        return ResponseEntity.badRequest().body(ApiResponse.badRequest("Malformed request", Map.of()));
    }

    @ExceptionHandler(ValidationException.class)          // domain, business validation
    ResponseEntity<ApiResponse<Void>> business(ValidationException ex) {
        return ResponseEntity.badRequest().body(ApiResponse.badRequest(ex.getMessage(), ex.errors()));
    }

    @ExceptionHandler(DomainException.class)
    ResponseEntity<ApiResponse<Void>> domain(DomainException ex) {
        return ResponseEntity.status(ex.status()).body(ApiResponse.error(ex.getMessage()));
    }

    @ExceptionHandler(AccessDeniedException.class)        // @PreAuthorize failures
    ResponseEntity<ApiResponse<Void>> forbidden(AccessDeniedException ex) {
        return ResponseEntity.status(HttpStatus.FORBIDDEN).body(ApiResponse.error("Forbidden"));
    }

    @ExceptionHandler(AuthenticationException.class)
    ResponseEntity<ApiResponse<Void>> unauthorized(AuthenticationException ex) {
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(ApiResponse.error("Unauthorized"));
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<ApiResponse<Void>> unexpected(Exception ex) {
        if (ex instanceof ErrorResponse er) {                // 404 no route, 405, 415, missing param…
            HttpStatusCode code = er.getStatusCode();
            return ResponseEntity.status(code).body(code.is4xxClientError()
                    ? ApiResponse.error(er.getBody().getTitle())
                    : ApiResponse.error("Unexpected error"));
        }
        log.error("Unhandled exception", ex);
        return ResponseEntity.internalServerError().body(ApiResponse.error("Unexpected error"));
    }
}
```

- `AccessDeniedException` **must** be handled here: thrown by method security inside the
  controller, it would otherwise fall into the 500 branch.
- Spring `ErrorResponse` exceptions are handled inside the catch-all with `instanceof` because
  `@ExceptionHandler` resolution ranks by class hierarchy, and an interface would lose to
  `Exception`.
- Filter-level failures (no/invalid token, denied URL) never reach the advice: the security
  chain uses `ApiAuthenticationEntryPoint` (401) and `ApiAccessDeniedHandler` (403) that write
  the same envelope (see `security-config.md`).
- Client disconnects (`AsyncRequestNotUsableException`, broken pipe) are logged at `debug`, not
  `error`.

## Configuration that belongs with the API

```yaml
spring:
  mvc:
    problemdetails:
      enabled: false            # errors always use the ApiResponse envelope
server:
  error:
    include-stacktrace: never
    include-message: never
    include-binding-errors: never
    include-exception: false
```

## Pagination

- Domain records: `PageRequest(int page, int size)` (1-based, validated: `page >= 1`,
  `1 <= size <= 100`, `offset()` helper) and `PageResult<T>(List<T> items, int page, int size, long total)`.
- The repository runs the page query and the count query; `meta` carries `page`, `size`,
  `total`. Large tables use keyset pagination (`WHERE id > :afterId ORDER BY id LIMIT :size`)
  and `meta.nextCursor`.

## OpenAPI

- If the project uses springdoc-openapi, the UI and `/v3/api-docs` are disabled in production
  by configuration (`springdoc.api-docs.enabled=${API_DOCS_ENABLED:false}`) and never public
  in production security rules.
