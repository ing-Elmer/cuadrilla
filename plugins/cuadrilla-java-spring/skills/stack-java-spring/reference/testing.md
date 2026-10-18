# Testing (detail)

Tools: JUnit 5 (Jupiter), AssertJ, Mockito — from `spring-boot-starter-test`;
`spring-security-test` for security post-processors; ArchUnit (`archunit-junit5`);
Testcontainers optional. Boot 4 moved test slices to per-technology modules/starters
(`spring-boot-starter-webmvc-test`, `spring-boot-starter-jdbc-test`…) and packages
(`org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest`); Boot 3.x uses
`org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest`. Check the pinned version.
`@MockBean` is gone in Boot 4: use `@MockitoBean`.

## Layout and naming

```
src/test/java/<base path>/
├── ArchitectureTest.java
├── application/<feature>/<Feature>ServiceTest.java, <Feature>ValidatorTest.java
├── api/<feature>/<Feature>ControllerTest.java
├── infrastructure/persistence/Jdbc<Feature>RepositoryIT.java      (optional)
└── support/Fake<Feature>Repository.java, TestClocks.java, TestUsers.java
```

- Unit tests `*Test.java` run in Surefire (`test` phase); integration tests `*IT.java` run in
  Failsafe (`integration-test`/`verify`). Both run in `./mvnw -B verify`.
- Method names `method_scenario_expectedResult` (e.g. `create_duplicateDescription_throwsValidation`).
- AssertJ only (`assertThat`, `assertThatThrownBy`); no JUnit `assertEquals`, no Hamcrest in new code.

## Services and validators — plain unit tests

```java
class OrderServiceTest {
    private final FakeOrderRepository repository = new FakeOrderRepository();
    private final Clock clock = Clock.fixed(Instant.parse("2026-01-15T10:00:00Z"), ZoneOffset.UTC);
    private final OrderService service =
            new OrderService(repository, new OrderValidator(repository), TestUsers.withId(7), clock);

    @Test
    void create_validRequest_persistsWithAuditFields() {
        OrderResponse created = service.create(new OrderRequest(1L, "Desk", new BigDecimal("10.00")));
        assertThat(created.createdAt()).isEqualTo(OffsetDateTime.now(clock));
        assertThat(repository.lastCreatedBy()).isEqualTo(7);
    }

    @Test
    void create_duplicateDescription_throwsValidation() {
        repository.add(existingOrder("Desk"));
        assertThatThrownBy(() -> service.create(new OrderRequest(1L, "Desk", BigDecimal.TEN)))
                .isInstanceOf(ValidationException.class)
                .extracting(e -> ((ValidationException) e).errors())
                .satisfies(errors -> assertThat(errors).containsKey("description"));
    }
}
```

- No Spring context (`@SpringBootTest`) for service/validator tests.
- Repositories: hand-written fakes implementing the domain interface (in-memory map). Mockito
  `mock()` is fine for ports whose behaviour is trivial (e.g. a notification sender, verify a call).
- `CurrentUser`: a small test implementation (`TestUsers.withId(7, "ORDERS_WRITE")`).
- Time: `Clock.fixed(...)`; never assert against the real current time.
- Every fixed bug gets a test that fails before the fix.

## Controllers — `@WebMvcTest` with the real security

```java
@WebMvcTest(OrderController.class)
@Import(SecurityConfig.class)                  // plus anything SecurityConfig needs
class OrderControllerTest {
    @Autowired MockMvcTester mvc;
    @MockitoBean OrderService service;
    @MockitoBean JwtDecoder jwtDecoder;         // resource server needs one; tokens come from jwt()

    @Test
    void create_withoutToken_returns401Envelope() {
        assertThat(mvc.post().uri("/api/orders").contentType(MediaType.APPLICATION_JSON).content("{}"))
                .hasStatus(HttpStatus.UNAUTHORIZED)
                .bodyJson().extractingPath("$.status").isEqualTo("Error");
    }

    @Test
    void create_withoutPermission_returns403() {
        assertThat(mvc.post().uri("/api/orders")
                .with(jwt().authorities(new SimpleGrantedAuthority("ORDERS_READ")))
                .contentType(MediaType.APPLICATION_JSON).content(validBody()))
                .hasStatus(HttpStatus.FORBIDDEN);
    }

    @Test
    void create_invalidBody_returns400WithFieldErrors() {
        assertThat(mvc.post().uri("/api/orders")
                .with(jwt().authorities(new SimpleGrantedAuthority("ORDERS_WRITE")))
                .contentType(MediaType.APPLICATION_JSON).content("{\"description\":\"\"}"))
                .hasStatus(HttpStatus.BAD_REQUEST)
                .bodyJson().extractingPath("$.errors.description").asArray().isNotEmpty();
    }
}
```

- Mandatory per controller: 401 without token, 403 without the permission, 400 envelope on an
  invalid body/param, success envelope (`status`, `data` shape, 201 + `Location` on create).
- `MockMvcTester` (AssertJ) is preferred; `MockMvc` is fine where the project already uses it.
- `@Autowired` is acceptable in test classes (field injection is forbidden only in main code).

## Auth (mandatory when the app issues tokens)

Login success, wrong password, inactive user, access-token claims (`sub`, permissions, `exp`),
refresh rotation (old refresh rejected after use), **reuse of a revoked refresh token revokes
the whole family**, expired refresh, logout revocation, 401 without token, 403 without permission.

## Repositories — optional, ephemeral database only

```java
@JdbcTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = "spring.flyway.enabled=true")   // migrate the throwaway DB
@Testcontainers(disabledWithoutDocker = true)
@Import(JdbcOrderRepository.class)
class JdbcOrderRepositoryIT {
    @Container @ServiceConnection
    static PostgreSQLContainer postgres = new PostgreSQLContainer("postgres:17-alpine");
    …
}
```

- Testcontainers 2.x (Boot 4) uses per-module packages (`org.testcontainers.postgresql`) and
  non-generic container classes; 1.x uses `org.testcontainers.containers.PostgreSQLContainer<?>`.
  Check the version.
- Image tag matches the production major version from the profile.
- `disabledWithoutDocker = true` lets laptops without Docker build; CI runners have Docker, so
  the ITs must show as executed in the CI log. Never point a test at a shared database.

## Architecture

- `ArchitectureTest` (template in `templates/ArchitectureTest.java`) is mandatory and runs in
  every build. New rules may be added; existing rules are never removed or relaxed to make a
  change pass — fix the code instead.

## Never

- `@Disabled` without a reason and ticket, commenting out tests, deleting a failing test,
  `-DskipTests`/`-Dmaven.test.skip` in CI or in `component.json` checks.
- `Thread.sleep` for synchronisation (use Awaitility if the project has it).
- Tests depending on execution order or on the machine's time zone/locale.
