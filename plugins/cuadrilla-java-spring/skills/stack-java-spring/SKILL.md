---
name: stack-java-spring
description: Java + Spring Boot standard for cuadrilla projects — architecture, API, data access, testing and tooling rules. Load before writing, reviewing or planning Java/Spring Boot code in a component whose stack is "java-spring" in .claude/cuadrilla.json.
user-invocable: false
paths: "**/*.java, **/pom.xml, **/build.gradle*, **/application*.yml, **/application*.properties"
---

# Java + Spring Boot standard

Placeholders: `<base>` = root Java package (e.g. `com.acme.<app>`), `<schema>`, `<prefix>_`,
connection names, migrations folder and permission codes come from the `## Project profile` in
`CLAUDE.md`. Never invent them; if one is missing, ask. A profile exception overrides a rule here.

## 1. Scope

- **Java LTS** (21 or 25; new projects take the newest LTS), pinned in `pom.xml` as
  `<java.version>` and enforced by `maven-enforcer-plugin` (`requireJavaVersion`). CI uses the
  same number. Never use preview features.
- **Spring Boot** current major line (4.x at the time of writing; projects pinned to 3.5 keep it
  until a planned upgrade), inherited from `spring-boot-starter-parent`. Read the pinned version
  in `pom.xml` and check Context7 for that version before using an API (Boot 4 moved test
  annotations to per-technology modules and switched to Jackson 3; do not guess packages).
- **Build:** Maven wrapper (`./mvnw`, `.mvn/wrapper/` committed, `mvnw` executable in git).
  Gradle wrapper is allowed: commands map per `${CLAUDE_SKILL_DIR}/reference/gradle.md`.
- One Maven module per deployable. Dependency versions come from the Boot BOM; a version
  override needs a comment with the reason. New dependencies only after user confirmation.
- **Prohibited:** JPA/Hibernate unless the profile declares it, Lombok in new code unless the
  profile declares it, MapStruct/ModelMapper (map by hand in records or small mappers),
  `RestTemplate` (use `RestClient`), field injection, Spring profiles carrying credentials,
  `static` mutable state, DDD tactical patterns (Entity/Value Object/Aggregate classes).

## 2. Architecture — package-by-layer, one module

| Package | Contains | Prohibited | May depend on |
|---|---|---|---|
| `<base>.api` | `@RestController`s, request/response mapping, `ApiResponse`, `GlobalExceptionHandler` (`@RestControllerAdvice`), `api.security` (SecurityFilterChain, `CurrentUser` implementation, JWT issuing) | Business rules, SQL, `@Transactional` | application, domain |
| `<base>.application` | `@Service` classes, `validator/` business validators, settings records the services read | SQL, `jakarta.servlet`, `org.springframework.web`, `org.springframework.jdbc`, `org.springframework.security`, `SecurityContextHolder` | domain |
| `<base>.domain` | DTO records (`<Feature>Request`, `<Feature>Response`), repository interfaces, ports (`CurrentUser`, `PasswordHasher`, external gateways), `DomainException` hierarchy, `PageRequest`/`PageResult` | Spring beans, I/O, `org.springframework.web/jdbc/security`, JPA | — (JDK, `jakarta.validation`, `org.springframework.http.HttpStatus`) |
| `<base>.infrastructure` | Repository implementations (`persistence/`), external clients (`client/`), `config/` (`Clock`, DataSources, `RestClient` beans) | Business rules, calculations, defaults, logging inside repositories | domain |

- The `@SpringBootApplication` class lives in `<base>` (with `@ConfigurationPropertiesScan`).
- The dependency rule is enforced by **ArchUnit**: `src/test/java/<base path>/ArchitectureTest.java`
  (template `${CLAUDE_SKILL_DIR}/templates/ArchitectureTest.java`) runs in `./mvnw -B verify`;
  a broken rule breaks the build. Never weaken a rule to make a change pass.
- Constructor injection only, fields `private final`, one constructor. Validators are `final`
  classes; services are not `final` (CGLIB proxies for `@Transactional`).
- Two validation levels: **shape** with Bean Validation on request records (`@NotBlank`,
  `@Size`, `@Positive`…) + `@Valid` in the controller; **business** (existence, uniqueness, rules
  that read the database) in `application.validator.<Feature>Validator`, called by the service
  **before any logic**, throwing `ValidationException(Map<String, List<String>>)`.
- Slow side effects (email, notifications, integrations) leave the request: `@Async` on a bean
  in `infrastructure` with a bounded `ThreadPoolTaskExecutor` (or virtual threads if the profile
  says so) or a queue. Never block the HTTP request on them.
- Detail and code: `${CLAUDE_SKILL_DIR}/reference/architecture.md`.

## 3. API

- Every endpoint returns `ApiResponse<T>` (record in `<base>.api`):
  `{ status: "Success" | "Created" | "Error", message, data, errors, meta }`, built with
  `ApiResponse.ok(msg, data)`, `.success(msg)`, `.created(msg, data)`, `.badRequest(msg, errors)`,
  `.error(msg)`. Never return a bare DTO, `Map`, `String` or `ProblemDetail`.
- JSON is camelCase (Jackson default for record components). No `@JsonProperty` renames to
  snake_case. Dates as ISO-8601 strings, never epoch numbers.
- Bean Validation failures (`MethodArgumentNotValidException`, `HandlerMethodValidationException`),
  unreadable bodies and type mismatches → **400** with `errors: { field: [messages] }`.
- `DomainException` (domain) carries its `HttpStatus`; every subclass declares it
  (`NotFoundException` 404, `ConflictException` 409, `ForbiddenException` 403,
  `UnauthorizedException` 401, `ValidationException` 400).
- `GlobalExceptionHandler` is the only place that translates exceptions: domain → its status,
  `AccessDeniedException` → 403, `AuthenticationException` → 401, Spring `ErrorResponse`
  exceptions → their status, anything else → 500 generic message (logged with the exception;
  the client never sees details). `spring.mvc.problemdetails.enabled=false`;
  `server.error.include-stacktrace=never`.
- Controllers are thin: map the path, `@Valid` the body, call one service method, wrap the
  result. No `try/catch`, no `ResponseStatusException`, no business `if`s, no repository access.
- Routes under `/api/<domain>`; `POST` that creates returns 201 with `Location`. Every
  endpoint consumed by the frontend is added to the frontend endpoint map in the same change.
- Health: `GET /actuator/health` is the only public actuator endpoint (it includes the database
  check); it is the stack equivalent of `GET /health`.
- Detail: `${CLAUDE_SKILL_DIR}/reference/api.md`.

## 4. Data

- Default: **`JdbcClient`** (or `NamedParameterJdbcTemplate`) with hand-written SQL and named
  parameters (`:name` + `.param("name", v)`), mapped straight to domain records
  (`.query(<Feature>Response.class)`). Never concatenate, `String.format` or `.formatted()`
  input into SQL; dynamic `ORDER BY` only from a whitelist map. Detail:
  `${CLAUDE_SKILL_DIR}/reference/data-jdbc.md`.
- Spring Data JPA only if the profile declares it, then
  `${CLAUDE_SKILL_DIR}/reference/data-jpa.md` applies (no open-in-view, LAZY + explicit fetch
  plans, entities never leave `infrastructure`).
- Tables/columns `snake_case`, schema explicit: `<schema>.<prefix>_<table>`.
- Connections only from configuration (one `DataSource`/`JdbcClient` per profile connection,
  `@Qualifier`-named). Connections the profile marks read-only use `read-only: true` in Hikari
  and never receive INSERT/UPDATE/DELETE.
- Statement timeout set (`spring.jdbc.template.query-timeout` or per-DataSource).
- `@Transactional` only on public methods of `application` services (`readOnly = true` for
  queries). Repositories never open transactions; one service call = one transaction.
- Pagination in the database (`LIMIT :limit OFFSET :offset` or keyset) with a max page size;
  never load everything and page in memory.
- Repositories do not log, hold no business rules and add no defaults.
- **Migrations:** Flyway files `V<NNN>__<verb>_<description>.sql` (3-digit, verb
  `create|alter|seed|update|drop`) in the profile's folder (default
  `src/main/resources/db/migration`). Claude writes them, **never runs them** (no
  `flyway:migrate`, no starting the app with Flyway enabled against a shared database).
  `spring.flyway.enabled` per environment is set by the profile (default `false` outside tests).
  Never edit a migration that may have run; fix forward. Detail:
  `${CLAUDE_SKILL_DIR}/reference/sql-migrations.md`.

## 5. Validation, logging, configuration, current user

- Configuration: `@ConfigurationProperties("<app>.<area>")` **records** with `@Validated` and
  constraints, so startup fails fast on a missing value. No `@Value`, no
  `Environment.getProperty` in services. Secrets come from environment variables
  (`${DB_PASSWORD}` with no default); `application.yml` holds no credentials for any profile.
- Time: inject `java.time.Clock` (bean in `infrastructure.config`); never `LocalDateTime.now()`.
- Logging: SLF4J `private static final Logger log = LoggerFactory.getLogger(X.class);`,
  parameterized messages, `warn` or above on known error paths, the exception as last argument.
  Never log passwords, tokens, full documents or personal data. Business audit goes through a
  dedicated audit service, not the technical log.
- Current user: services receive the `CurrentUser` port (domain); the only implementation reads
  the security context in `api.security`. No `SecurityContextHolder`, `Authentication` or
  `Jwt` outside `api.security`. A missing mandatory claim throws `UnauthorizedException` (401).
- Security: deny-by-default `SecurityFilterChain` (`anyRequest().authenticated()`), stateless
  JWT resource server, `@EnableMethodSecurity` and `@PreAuthorize("hasAuthority('<CODE>')")`
  on every protected endpoint (never role `if`s in code), CORS origins from properties.
  Public endpoints are listed in the filter chain with a comment justifying each; no
  user/credential creation endpoint is anonymous. Detail:
  `${CLAUDE_SKILL_DIR}/reference/security-config.md`.

## 6. Testing

- JUnit 5 + AssertJ + Mockito (all from `spring-boot-starter-test`). Mandatory in the same
  change:
  - `<Feature>ServiceTest` and `<Feature>ValidatorTest` as plain unit tests (no Spring context)
    with hand-written fakes of the domain repository interfaces and `Clock.fixed(...)`.
  - `<Feature>ControllerTest` with `@WebMvcTest` + the real security config: 401 without
    token, 403 without the permission, 400 envelope on invalid body, success envelope.
  - Auth tests from day one when the project issues tokens: login, password check, refresh
    rotation, reuse of a revoked refresh token, inactive user.
  - A test reproducing every fixed bug.
  - `ArchitectureTest` (ArchUnit) — never removed or weakened.
- Repository tests are optional and only against an ephemeral database (Testcontainers,
  `*IT.java`, run by Failsafe in `verify`); never against a shared database.
- Names: class `<Subject>Test`/`<Subject>IT`; methods `method_scenario_expectedResult`.
- Never delete, comment out or `@Disabled` a test to get green; `@Disabled` needs a reason and
  a ticket.
- Detail: `${CLAUDE_SKILL_DIR}/reference/testing.md`.

## 7. Tooling — exact commands (same as `component.json` and CI)

| Step | Command |
|---|---|
| setup | `./mvnw -B -q dependency:go-offline` |
| format check | `./mvnw -B spotless:check` (Spotless + palantir-java-format) |
| verify | `./mvnw -B verify` (compile, unit tests, ArchUnit, Failsafe ITs, JaCoCo report) |
| fix formatting | `./mvnw -q spotless:apply` (run before handing off) |
| run | `./mvnw spring-boot:run` → `http://localhost:8080/actuator/health` |
| audit (slow, optional) | `./mvnw -B org.owasp:dependency-check-maven:check` |

- `component.json` has **no per-file `format`/`lint` entries on purpose**: every Maven
  invocation takes several seconds, far over the hook budget. Formatting is enforced by
  `spotless:check` in `/cuadrilla:verify` and CI; run `spotless:apply` yourself before handing off.
- Compiler: `-parameters` (Boot parent) and no new warnings; Error Prone or Checkstyle are
  optional and, if the project has them, run inside `verify`.
- Plugin snippet: `${CLAUDE_SKILL_DIR}/templates/pom-plugins.example.xml`.
- Under Windows `cmd`, `./mvnw` is `mvnw.cmd`; in Git Bash and PowerShell `./mvnw` works.

## 8. Files in this skill

| File | Read when |
|---|---|
| `${CLAUDE_SKILL_DIR}/component.json` | `/cuadrilla:adopt` builds the `cuadrilla.json` component and forbidden patterns from it |
| `${CLAUDE_SKILL_DIR}/reference/architecture.md` | Creating packages, services, validators, ports, wiring, async work |
| `${CLAUDE_SKILL_DIR}/reference/api.md` | Writing controllers, `ApiResponse`, the exception handler, pagination meta |
| `${CLAUDE_SKILL_DIR}/reference/data-jdbc.md` | Writing a repository with `JdbcClient`, multiple/read-only connections |
| `${CLAUDE_SKILL_DIR}/reference/data-jpa.md` | Only when the profile declares Spring Data JPA |
| `${CLAUDE_SKILL_DIR}/reference/sql-migrations.md` | Writing a Flyway migration |
| `${CLAUDE_SKILL_DIR}/reference/testing.md` | Writing unit, `@WebMvcTest`, Testcontainers or ArchUnit tests |
| `${CLAUDE_SKILL_DIR}/reference/security-config.md` | Security chain, JWT/refresh, passwords, CORS, actuator, properties, secrets, Docker |
| `${CLAUDE_SKILL_DIR}/reference/gradle.md` | The project uses the Gradle wrapper instead of Maven |
| `${CLAUDE_SKILL_DIR}/templates/ci-job.yml` | Generating the CI job for this component |
| `${CLAUDE_SKILL_DIR}/templates/Dockerfile`, `.dockerignore` | Production image (multi-stage, layered jar, non-root) |
| `${CLAUDE_SKILL_DIR}/templates/ArchitectureTest.java` | Adding the mandatory ArchUnit test (replace `<base>`) |
| `${CLAUDE_SKILL_DIR}/templates/application.example.yml` | Base `application.yml` without secrets |
| `${CLAUDE_SKILL_DIR}/templates/pom-plugins.example.xml` | Enforcer, Spotless, Surefire/Failsafe, JaCoCo, ArchUnit setup |

## Shared auth contract
Authentication endpoints (`/api/auth/login`, `/api/auth/refresh`, `/api/auth/logout`, `/api/me`), payloads and cookie rules are defined once in `cuadrilla:standard-api` ("Shared auth contract") so every frontend pack works with this backend. Implement them exactly; differences go to the profile's "Exceptions to the standard".
