# Security and configuration (detail)

Spring Security 6.x (Boot 3) / 7.x (Boot 4). Lambda DSL only; `WebSecurityConfigurerAdapter`
and `and()` chaining no longer exist. Check the pinned version in Context7.

## Filter chain — deny by default

```java
@Configuration
@EnableMethodSecurity
class SecurityConfig {

    @Bean
    SecurityFilterChain api(HttpSecurity http, ApiAuthenticationEntryPoint entryPoint,
                            ApiAccessDeniedHandler accessDenied) throws Exception {
        http
            .csrf(csrf -> csrf.disable())            // stateless bearer tokens, no auth cookies
            .cors(Customizer.withDefaults())          // uses the CorsConfigurationSource bean
            .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(auth -> auth
                // platform liveness/readiness probes
                .requestMatchers("/actuator/health", "/actuator/health/**").permitAll()
                // obtaining a token cannot require one
                .requestMatchers(HttpMethod.POST, "/api/auth/login", "/api/auth/refresh").permitAll()
                // container error dispatch; it renders no data
                .requestMatchers("/error").permitAll()
                .anyRequest().authenticated())
            .oauth2ResourceServer(rs -> rs
                .jwt(jwt -> jwt.jwtAuthenticationConverter(permissionsConverter()))
                .authenticationEntryPoint(entryPoint)
                .accessDeniedHandler(accessDenied))
            .exceptionHandling(e -> e.authenticationEntryPoint(entryPoint).accessDeniedHandler(accessDenied));
        return http.build();
    }

    private static JwtAuthenticationConverter permissionsConverter() {
        JwtGrantedAuthoritiesConverter permissions = new JwtGrantedAuthoritiesConverter();
        permissions.setAuthoritiesClaimName("permissions");
        permissions.setAuthorityPrefix("");          // authorities are the profile's permission codes
        JwtAuthenticationConverter converter = new JwtAuthenticationConverter();
        converter.setJwtGrantedAuthoritiesConverter(permissions);
        return converter;
    }
}
```

Checkable rules:
- `anyRequest().authenticated()` is the last matcher; every `permitAll()` has a comment with
  the reason. No user/credential creation endpoint is public.
- Authorization per endpoint with `@PreAuthorize("hasAuthority('<CODE>')")`; codes from the
  profile's permission catalogue. No `hasRole`, no role/permission `if`s in services; data-level
  ownership checks happen in the service and throw `ForbiddenException`.
- CSRF stays disabled only while authentication is bearer-header based. If the refresh token
  travels in a cookie, the refresh endpoint needs CSRF protection (`SameSite=Strict` cookie +
  a custom header check or Spring's CSRF token).
- Security headers: keep Spring Security defaults (nosniff, frame DENY, HSTS on HTTPS); never
  `headers(h -> h.disable())`.
- `ApiAuthenticationEntryPoint` (401, adds `WWW-Authenticate: Bearer`) and
  `ApiAccessDeniedHandler` (403) write the `ApiResponse` envelope as a constant JSON string
  (`{"status":"Error","message":"Unauthorized","data":null,"errors":null,"meta":null}`) with
  `application/json`; they do not depend on a specific Jackson major version.

## Current user

```java
public interface CurrentUser {               // <base>.domain.common
    long id();
    String username();
    Set<String> permissions();
    default boolean hasPermission(String code) { return permissions().contains(code); }
}

@Component
class SecurityCurrentUser implements CurrentUser {   // <base>.api.security — the only reader
    @Override public long id() {
        String sub = jwt().getSubject();
        if (sub == null) throw new UnauthorizedException("Missing subject");
        return Long.parseLong(sub);
    }
    …
    private static Jwt jwt() {
        if (SecurityContextHolder.getContext().getAuthentication() instanceof JwtAuthenticationToken t) {
            return t.getToken();
        }
        throw new UnauthorizedException("No authenticated user");
    }
}
```

`SecurityContextHolder`, `Authentication`, `Jwt` and `@AuthenticationPrincipal` appear only in
`api.security` (ArchUnit + forbidden pattern). Services receive `CurrentUser`.

## Tokens

**External identity provider** (preferred when the profile has one): only
`spring.security.oauth2.resourceserver.jwt.issuer-uri` (+ audience validation); the app never
sees passwords.

**Self-issued tokens** (when the profile says the app authenticates users):
- Access token: JWT signed with a fixed algorithm — HS256 with a ≥ 256-bit secret from
  `<APP>_JWT_SECRET`, or RS256/ES256 with a key pair from the secret store. Decoder built with
  the algorithm pinned: `NimbusJwtDecoder.withSecretKey(key).macAlgorithm(MacAlgorithm.HS256).build()`
  plus issuer/audience validators (`JwtValidators.createDefaultWithIssuer(issuer)`).
  Encoder: `NimbusJwtEncoder` (`JwsHeader.with(MacAlgorithm.HS256)`). TTL 5–15 minutes.
  Claims: `sub` (user id), `iss`, `aud`, `iat`, `exp`, `permissions`. No personal data in claims.
- Refresh token: opaque, 256 bits from `SecureRandom`, base64url; stored **only as a SHA-256
  hash** in `<schema>.<prefix>_refresh_token` with `family_id`, `expires_at`, `revoked_at`,
  `replaced_by`. **Rotated on every use**; presenting a revoked/replaced token revokes the whole
  family (theft detection). Logout revokes the family.
- The issuing code is a domain port (`TokenIssuer`) used by `application.auth.AuthService`; its
  implementation lives in `api.security` (it needs `JwtEncoder`).
- Login: same error message and similar timing for unknown user and wrong password (hash a
  dummy password when the user is missing); inactive users get 401/403 per the profile; failed
  attempts are rate-limited if the profile requires it.

## Passwords

- `PasswordEncoder` bean: `new BCryptPasswordEncoder(12)` (cost ≥ 12) or
  `Argon2PasswordEncoder.defaultsForSpringSecurity_v5_8()` (needs BouncyCastle — new dependency,
  ask first). Exposed to `application` through a domain port (`PasswordHasher`) implemented in
  `infrastructure.security`.
- Never `NoOpPasswordEncoder`, MD5/SHA-1/plain SHA-256 for passwords, or reversible encryption.

## CORS

```java
@Validated
@ConfigurationProperties("<app>.cors")
public record CorsProperties(@NotEmpty List<@NotBlank String> allowedOrigins) {}

@Bean
CorsConfigurationSource corsConfigurationSource(CorsProperties props) {
    CorsConfiguration c = new CorsConfiguration();
    c.setAllowedOrigins(props.allowedOrigins());          // explicit list, never "*"
    c.setAllowedMethods(List.of("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));
    c.setAllowedHeaders(List.of("Authorization", "Content-Type"));
    c.setMaxAge(Duration.ofHours(1));
    UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
    source.registerCorsConfiguration("/api/**", c);
    return source;
}
```

Origins per environment from `<APP>_CORS_ALLOWED_ORIGINS`. Preview/wildcard origins only on
non-production backends. No `@CrossOrigin`.

## Actuator

```yaml
management:
  endpoints:
    web:
      exposure:
        include: health,info          # never "*"
  endpoint:
    health:
      show-details: never             # or when-authorized with an authority
      probes:
        enabled: true                 # /actuator/health/liveness, /readiness
  info:
    env:
      enabled: false
```

Only `/actuator/health/**` is public. Anything else exposed (metrics, prometheus) requires an
authority or a separate management port not reachable from the internet. `env`, `heapdump`,
`threaddump`, `loggers`, `configprops` are never exposed over HTTP in production.

## Configuration properties

```java
@Validated
@ConfigurationProperties("<app>.security.jwt")
public record JwtProperties(
        @NotBlank String issuer,
        @NotBlank String audience,
        @NotBlank @Size(min = 44) String secret,       // base64 of >= 32 bytes
        @NotNull Duration accessTokenTtl,
        @NotNull Duration refreshTokenTtl) {}
```

- Records + `@Validated` + constraints; registered with `@ConfigurationPropertiesScan`. Keys
  kebab-case under the `<app>` prefix. The record lives in the layer that consumes it.
- No `@Value`, no `System.getenv`, no `Environment#getProperty` scattered in code.
- `application.yml` is committed with **no secret values**: secrets are `${ENV_VAR}` without a
  default so a missing value fails at startup. `application-<env>.yml` may exist only with
  non-secret differences. No `spring.profiles.active` hardcoded in committed config.
- Local secrets: environment variables, the IDE run configuration, or
  `spring.config.import: optional:file:.env[.properties]` with `.env` git-ignored (the cuadrilla
  guard hook blocks reading it). A committed `.env.example` lists the names with fake values.
- Each environment has distinct secrets; never reuse a development secret in production.
- A secret found in the repo: tell the user without repeating it and propose rotating it.

## Errors and information leakage

- `server.error.include-stacktrace: never`, `include-message: never`,
  `include-binding-errors: never`, `include-exception: false`.
- Generic 500 message; details only in the log. Never echo SQL, class names or stack traces.
- `spring.jpa.show-sql`/SQL debug logging off outside local.

## Container and deployment

- Image from `templates/Dockerfile`: multi-stage, layered jar extraction, `eclipse-temurin:<java>-jre`,
  non-root user, `server.port=${PORT:8080}`, JVM sized with `-XX:MaxRAMPercentage`.
- Behind a proxy/load balancer: `server.forward-headers-strategy: framework`.
- `server.shutdown: graceful` with `spring.lifecycle.timeout-per-shutdown-phase`.
- Credentials only in the platform's secret store / GitHub Secrets; never in the Dockerfile,
  YAML or CI file.

## .gitignore minimum (Java)

`target/`, `build/`, `.gradle/`, `*.class`, `*.log`, `.idea/`, `*.iml`, `.vscode/`, `.env`,
`.env.*` (with `!.env.example`), `HELP.md`, `.claude/settings.local.json`, `CLAUDE.local.md`.
