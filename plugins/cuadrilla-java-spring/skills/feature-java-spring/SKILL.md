---
name: feature-java-spring
description: Scaffold a complete Java + Spring Boot feature (all layers + tests) following the cuadrilla standard.
argument-hint: "<FeatureName> <short description>"
disable-model-invocation: true
---

Build the Java + Spring Boot feature: **$ARGUMENTS**

## 1. Gather context

- Read the `## Project profile` in `CLAUDE.md` (root package `<base>`, `<schema>`, `<prefix>_`,
  connection, migrations folder, permission codes) and the `java-spring` component in
  `.claude/cuadrilla.json` (its `path` and `checks`). If a needed value is missing, ask before
  continuing.
- Find the most similar existing feature and use it as the shape to follow.

## 2. Propose the plan and wait for OK

Show the user, before writing any file:

- The **endpoint contract**: for each endpoint the method, path (`/api/<domain>/…`), required
  permission code, request record (fields + constraints), response record, success status and
  error statuses (400 validation, 401, 403, 404/409 domain).
- The **file list** (paths under the component, `<base path>` = `<base>` with `/`):

| Layer | Files |
|---|---|
| domain | `domain/<feature>/<Feature>Request.java`, `<Feature>Response.java` (records), `<Feature>Repository.java` (interface); new `DomainException` subclasses with their `HttpStatus` if needed |
| infrastructure | `infrastructure/persistence/Jdbc<Feature>Repository.java` (JdbcClient, named parameters) |
| application | `application/<feature>/<Feature>Service.java` (`@Transactional`), `application/<feature>/<Feature>Validator.java` |
| api | `api/<feature>/<Feature>Controller.java` (`ApiResponse<…>`, `@Valid`, `@PreAuthorize`) |
| migration | `V<NNN>__create_<table>.sql` with the next free number, only if a table/column is needed — written, not run |
| tests | `application/<feature>/<Feature>ServiceTest.java`, `<Feature>ValidatorTest.java`, `support/Fake<Feature>Repository.java`, `api/<feature>/<Feature>ControllerTest.java` (401/403/400/success); optional `infrastructure/persistence/Jdbc<Feature>RepositoryIT.java` |
| frontend | the new endpoints in the frontend endpoint map, if a frontend consumes them |

Wait for the user's OK (or corrections) before implementing.

## 3. Implement

Delegate to the `cuadrilla-java-spring:backend-java` agent with: the approved contract, the file
list, the profile values, and the similar feature to follow. The agent loads the
`stack-java-spring` standard and its references.

## 4. Verify

In the component `path`, run `./mvnw -q spotless:apply`, then every `checks[].run` of the
component in order (default `./mvnw -B spotless:check`, `./mvnw -B verify`). Report the real
output (pass/fail, test counts, first failure). Fix and re-run until green; never skip or
disable tests. Remind the user which migration files they must run themselves.

## 5. Review

When the checks pass, launch the core `cuadrilla:reviewer` agent on the feature's files and show
its findings by severity before declaring the feature done.
