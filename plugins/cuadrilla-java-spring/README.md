# cuadrilla-java-spring

Java + Spring Boot stack pack for [cuadrilla](../cuadrilla). It adds a concrete, checkable standard
for Spring Boot services, a specialist implementer agent, the project configuration that the
cuadrilla hooks and `/cuadrilla:verify` use, and CI/Docker templates.

Requires the `cuadrilla` core plugin (declared as a dependency).

## Install

With the cuadrilla marketplace added (`/plugin marketplace add <owner>/<repo>`):

```
/plugin install cuadrilla-java-spring@cuadrilla
```

Then run `/cuadrilla:adopt` in the project so it writes the `java-spring` component into
`.claude/cuadrilla.json` and copies the templates.

## What you get

| Piece | Name | Purpose |
|---|---|---|
| Agent | `cuadrilla-java-spring:backend-java` | Implements controllers, services, validators, records, JdbcClient repositories, security and Flyway migrations, with tests, then runs the component checks |
| Skill (auto) | `stack-java-spring` | The standard; loads automatically on `*.java`, `pom.xml`, `build.gradle*`, `application*.yml/properties` |
| Skill (command) | `/cuadrilla-java-spring:feature-java-spring <Feature> <description>` | Scaffolds a full feature across all layers, shows the contract first, verifies and sends it to review |
| Config | `skills/stack-java-spring/component.json` | Component commands and forbidden patterns that `/cuadrilla:adopt` writes into `.claude/cuadrilla.json` |
| Templates | `ci-job.yml`, `Dockerfile`, `.dockerignore`, `ArchitectureTest.java`, `application.example.yml`, `pom-plugins.example.xml` | Copied/merged by `/cuadrilla:adopt` |

## What the standard enforces

- **Versions:** a Java LTS (21 or 25) pinned in `pom.xml` and enforced by the Maven Enforcer;
  the current Spring Boot major line (4.x; 3.5 projects keep their pin until a planned
  upgrade); Maven wrapper by default, Gradle wrapper supported (`reference/gradle.md`). The
  agent checks the pinned versions and Context7 instead of assuming APIs.
- **Architecture:** package-by-layer in one module — `<base>.api`, `<base>.application`,
  `<base>.domain`, `<base>.infrastructure` — with the dependency rule, `@Transactional`
  placement, `SecurityContextHolder` confinement, controller placement, no field injection and
  "every endpoint declares authorization" enforced by an **ArchUnit** test that runs in
  `./mvnw -B verify`.
- **API:** every endpoint returns the `ApiResponse<T>` envelope
  `{ status, message, data, errors, meta }` in camelCase; Bean Validation errors become 400 with
  `errors: { field: [messages] }`; domain exceptions carry their `HttpStatus`; one
  `@RestControllerAdvice`; thin controllers without `try/catch`; Problem Details disabled and
  stack traces never exposed.
- **Data:** `JdbcClient` with hand-written SQL and named parameters by default (Spring Data
  JPA only when the project profile declares it, with no open-in-view, LAZY associations and
  explicit fetch plans); explicit schema and `snake_case`; read-only connections; transactions
  only on application services; pagination in the database; Flyway migrations
  `V<NNN>__<verb>_<desc>.sql` that Claude writes but never runs.
- **Security:** deny-by-default `SecurityFilterChain`, stateless JWT resource server,
  `@PreAuthorize("hasAuthority('<CODE>')")`, a `CurrentUser` port, rotating hashed refresh
  tokens when tokens are self-issued, BCrypt (cost ≥ 12) or Argon2, explicit CORS origins,
  only `/actuator/health` public.
- **Configuration:** `@Validated @ConfigurationProperties` records, secrets from environment
  variables, `Clock` injected instead of `now()`.
- **Testing:** JUnit 5 + AssertJ + Mockito; service and validator unit tests with fakes;
  `@WebMvcTest` controller tests including 401/403; optional Testcontainers repository ITs;
  mandatory ArchUnit test.
- **Tooling:** `./mvnw -B spotless:check` (palantir-java-format) and `./mvnw -B verify`, the
  same commands locally (`/cuadrilla:verify`) and in CI.

Forbidden patterns checked by the cuadrilla stop-check hook (in addition to the core's Java
built-ins such as `System.out` and `printStackTrace`): `@Autowired` injection,
`SecurityContextHolder` outside `api.security`, `@Transactional` outside `application`,
`new RestTemplate(`, `LocalDateTime.now()`-style clock reads, empty `catch` blocks,
`@CrossOrigin`, `anyRequest().permitAll()`, wildcard CORS origins, `NoOpPasswordEncoder`,
`@Value("${…}")`, SQL built with `String.format`/`.formatted()`, JPA imports (unless the
profile allows JPA), `FetchType.EAGER`, `ddl-auto: update/create`, `open-in-view: true`,
exposed error details and actuator exposure `*`.

## Notes

- `component.json` deliberately has **no per-file format/lint commands**: Maven needs several
  seconds per invocation, beyond the format hook's budget. Formatting is enforced by
  `spotless:check` in `/cuadrilla:verify` and CI; the agent runs `spotless:apply` before handing off.
- The dependency audit (`./mvnw -B org.owasp:dependency-check-maven:check`) is slow on first
  run (it downloads the NVD database) and is not part of `verify`.
- Health is `GET /actuator/health` (includes the database check) — the Spring equivalent of
  the standard's `GET /health`.

## Recommended third-party skills (optional)

The pack copies no third-party content. These skills are reference material; when they
disagree with the pack, the pack wins.

| Skill | Install | Why | Ignore from it |
|---|---|---|---|
| `java-springboot` (GitHub, awesome-copilot) | `npx skills add github/awesome-copilot@java-springboot` | Broad Spring Boot practices: constructor injection, typed config, DTOs, SLF4J, test slices | Package-by-feature, JPA as default data layer, `@Transactional` anywhere, per-profile config files with values |
| `java-junit` (GitHub, awesome-copilot) | `npx skills add github/awesome-copilot@java-junit` | JUnit 5 structure, parameterized tests, `@Nested` | JUnit `Assertions` instead of AssertJ, Mockito mocks for repositories instead of fakes, ordered tests, `@Disabled` to get green |
| `springboot-security` (affaan-m/everything-claude-code) | `npx skills add affaan-m/everything-claude-code@springboot-security` | Spring Security review checklist: method security, validation, headers, rate limiting, dependency scanning | Hand-written JWT filter writing to `SecurityContextHolder` (use the resource server), `hasRole` checks (use permission authorities), controllers without the envelope |

## License

MIT — see the root [LICENSE](../../LICENSE).
