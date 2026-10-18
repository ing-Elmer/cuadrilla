# Gradle wrapper mapping

Maven is the default. A project may use the **Gradle wrapper** (`./gradlew`, Kotlin DSL
`build.gradle.kts` preferred, `gradle/wrapper/` committed, `gradle/libs.versions.toml` for
versions). Every rule of the standard stays; only commands and plugin wiring change.
`/cuadrilla:adopt` writes the Gradle commands into `.claude/cuadrilla.json` when it detects
`build.gradle*` and no `pom.xml`.

## Commands

| Purpose | Maven (default) | Gradle |
|---|---|---|
| setup | `./mvnw -B -q dependency:go-offline` | `./gradlew --no-daemon dependencies -q` (or omit) |
| format check | `./mvnw -B spotless:check` | `./gradlew --no-daemon spotlessCheck` |
| fix format | `./mvnw -q spotless:apply` | `./gradlew spotlessApply` |
| verify | `./mvnw -B verify` | `./gradlew --no-daemon check` (runs `test`, `integrationTest` if wired, ArchUnit) |
| run | `./mvnw spring-boot:run` | `./gradlew bootRun` |
| package | `./mvnw -B package -DskipTests` | `./gradlew bootJar -x test` |
| audit | `./mvnw -B org.owasp:dependency-check-maven:check` | `./gradlew dependencyCheckAnalyze` (plugin `org.owasp.dependencycheck`) |
| jar for Docker | `target/*.jar` | `build/libs/*.jar` (disable the plain jar: `tasks.jar { enabled = false }`) |

`component.json` for a Gradle component:

```json
"setup": "./gradlew --no-daemon dependencies -q",
"checks": [
  { "name": "format", "run": "./gradlew --no-daemon spotlessCheck" },
  { "name": "verify", "run": "./gradlew --no-daemon check" }
],
"start": { "run": "./gradlew bootRun", "port": 8080, "health": "http://localhost:8080/actuator/health" },
"audit": "./gradlew dependencyCheckAnalyze"
```

## Build file equivalents

- Java version: `java { toolchain { languageVersion = JavaLanguageVersion.of(<java-version>) } }`
  (replaces `<java.version>` + enforcer).
- Spring Boot: `id("org.springframework.boot")` + `id("io.spring.dependency-management")` (or
  the Boot BOM via `platform(...)`), versions in `libs.versions.toml`.
- Spotless: `id("com.diffplug.spotless")` with
  `spotless { java { palantirJavaFormat("<version>"); removeUnusedImports() } }`.
- Integration tests: JVM Test Suite plugin (`testing { suites { register<JvmTestSuite>("integrationTest") } }`)
  with `tasks.check { dependsOn(testing.suites.named("integrationTest")) }`, or keep `*IT`
  classes in `test` filtered by a `Test` task — `check` must run them.
- JaCoCo: `id("jacoco")`, `tasks.test { finalizedBy(tasks.jacocoTestReport) }`.

## CI job differences

- `actions/setup-java` keeps `distribution: temurin` but uses `cache: gradle`, or
  `gradle/actions/setup-gradle` pinned by full SHA (third-party rule) for build caching.
- Steps run the Gradle commands above in the same order as `component.json`.
- `gradlew` must be executable in git (`git update-index --chmod=+x gradlew`).

## Dockerfile differences

Copy `gradlew`, `gradle/`, `settings.gradle*`, `build.gradle*` first, run
`./gradlew --no-daemon dependencies -q` for a cached layer, then copy `src` and run
`./gradlew --no-daemon bootJar -x test`; extract from `build/libs/*.jar`.
