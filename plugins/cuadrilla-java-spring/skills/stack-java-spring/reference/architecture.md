# Architecture — package-by-layer (detail)

Read with the `stack-java-spring` SKILL.md. `<base>` is the root package from the profile;
`<Feature>` is PascalCase, `<feature>` its lowerCamel/lowercase form.

## Folder layout

```
src/main/java/<base path>/
├── <App>Application.java              @SpringBootApplication @ConfigurationPropertiesScan
├── api/
│   ├── ApiResponse.java, ApiStatus.java
│   ├── GlobalExceptionHandler.java     @RestControllerAdvice (the only exception translator)
│   ├── <feature>/<Feature>Controller.java
│   └── security/                       SecurityConfig, SecurityCurrentUser, JwtProperties,
│                                       ApiAuthenticationEntryPoint, ApiAccessDeniedHandler,
│                                       TokenService (only if the app issues tokens)
├── application/
│   ├── <feature>/<Feature>Service.java
│   ├── <feature>/<Feature>Validator.java
│   └── config/<Area>Settings.java      @ConfigurationProperties records read by services
├── domain/
│   ├── <feature>/<Feature>Request.java, <Feature>Response.java, <Feature>Repository.java
│   ├── common/PageRequest.java, PageResult.java, CurrentUser.java
│   └── exception/DomainException.java, NotFoundException.java, ValidationException.java…
└── infrastructure/
    ├── config/ClockConfig.java, DataSourceConfig.java, HttpClientConfig.java
    ├── persistence/Jdbc<Feature>Repository.java
    └── client/<System>Client.java       implements a domain port
src/main/resources/application.yml, db/migration/V<NNN>__*.sql
src/test/java/<base path>/ArchitectureTest.java, application/…, api/…, infrastructure/…
```

Sub-packaging by feature *inside* a layer (`application.order`, `domain.order`) is fine; the
layer is always the second segment after `<base>`.

## Dependency rule

```
api ──► application ──► domain ◄── infrastructure
  └───────────────────────► domain
```

- Nothing depends on `api` or `infrastructure`; Spring wires implementations to the domain
  interfaces through component scanning.
- `domain` depends only on the JDK, `jakarta.validation` (constraints on request records) and
  `org.springframework.http.HttpStatus` (status on domain exceptions).
- `ArchitectureTest` encodes these rules plus: controllers only in `api`, `@Transactional`
  only in `application`, `SecurityContextHolder` only in `api.security`, no field injection,
  every request-mapping method protected by `@PreAuthorize` (or a documented `@PublicEndpoint`).

## Domain

```java
public record OrderRequest(
        @NotNull @Positive Long customerId,
        @NotBlank @Size(max = 200) String description,
        @NotNull @DecimalMin("0.01") BigDecimal amount) {}

public record OrderResponse(long id, long customerId, String description,
                            BigDecimal amount, OffsetDateTime createdAt) {}

public interface OrderRepository {
    Optional<OrderResponse> findById(long id);
    PageResult<OrderResponse> findPage(long customerId, PageRequest page);
    long insert(OrderRequest request, long createdBy, OffsetDateTime createdAt);
    boolean existsByDescription(String description);
}
```

- Request/response records are the API contract; no separate "entity" classes in JDBC mode.
- Money: `BigDecimal`; instants: `OffsetDateTime`/`Instant` in UTC; ids: `long`/`UUID` per
  profile. No `java.util.Date`.
- Exceptions: `abstract class DomainException extends RuntimeException` with
  `abstract HttpStatus status()`; subclasses declare it. `ValidationException` additionally
  carries `Map<String, List<String>> errors`.

## Application

```java
@Service
public class OrderService {
    private final OrderRepository repository;
    private final OrderValidator validator;
    private final CurrentUser currentUser;
    private final Clock clock;

    public OrderService(OrderRepository repository, OrderValidator validator,
                        CurrentUser currentUser, Clock clock) { … }

    @Transactional
    public OrderResponse create(OrderRequest request) {
        validator.validateCreate(request);            // first, before any logic
        long id = repository.insert(request, currentUser.id(), OffsetDateTime.now(clock));
        return repository.findById(id).orElseThrow(() -> new NotFoundException("Order", id));
    }

    @Transactional(readOnly = true)
    public PageResult<OrderResponse> list(long customerId, PageRequest page) { … }
}
```

- Spring proxies `@Transactional` beans with CGLIB subclasses, so **services must not be
  `final`**, transactional methods are `public`, and they are called from outside the bean
  (self-invocation bypasses the proxy). Validators and other beans without proxies are `final`.
- Validators collect all errors into a `Map<String, List<String>>` and throw one
  `ValidationException`; keys are the camelCase field names of the request.
- A flow repeated in two services (e.g. login for two user types) moves to a shared
  component in `application`; never duplicated.
- Services never return `ResponseEntity`, never read HTTP headers, never touch `HttpServletRequest`.

## Infrastructure

- Repository implementations are `@Repository` (exception translation) and package-private
  where possible.
- External HTTP clients use a `RestClient` built from the auto-configured `RestClient.Builder`
  with base URL, timeouts (`ClientHttpRequestFactorySettings`/`JdkClientHttpRequestFactory`)
  and error mapping to domain exceptions; or a declarative `@HttpExchange` interface.
- `ClockConfig` exposes `Clock.systemUTC()`; tests replace it with `Clock.fixed`.
- Async work: `@EnableAsync` in a config class, a named bounded executor, `@Async("<name>")`
  on an infrastructure bean that implements a domain port (e.g. `NotificationSender`). Errors
  in async work are logged; they never vanish.

## Logging and audit

- Technical log: SLF4J, one `private static final Logger log` per class, parameterized messages.
- Business audit (who did what): a dedicated `AuditService`/table, never mixed with the
  technical log.
- MDC: a request-id filter in `api` puts `requestId` in the MDC; the log pattern prints it.
