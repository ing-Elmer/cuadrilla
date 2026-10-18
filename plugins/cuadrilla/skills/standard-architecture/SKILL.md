---
name: standard-architecture
description: Language-agnostic architecture rules of the cuadrilla standard — layers and dependency direction, services and validators, configuration, logging, current user, background work. Load before designing or reviewing backend code in any language; stack packs make these rules concrete.
user-invocable: false
---

# cuadrilla — architecture (any backend stack)

Stack packs (`stack-<id>`) map these rules to concrete folders, libraries and tools. For a
stack without a pack, apply them using the project's own idioms.

## Layers and dependency rule
| Layer | Contains | Never contains | May depend on |
|---|---|---|---|
| **api** (transport) | routes/controllers, request/response mapping, auth wiring, error handler, composition root | business logic, SQL | application, core |
| **application** | services (use cases), business validators | SQL, HTTP/framework types, DB drivers | core |
| **core** (domain contracts) | DTOs, repository interfaces, domain errors, settings schema | I/O, frameworks, drivers | — |
| **infrastructure** | DB access (repositories), external clients, config loading | business rules, defaults invented in SQL, logging in repositories | core |

- The dependency rule is **enforced by a tool in CI** (import-linter, NetArchTest/ArchUnit,
  dependency-cruiser, go-arch-lint…). Breaking it breaks the build.
- No tactical DDD ceremony (aggregates, value objects) unless the profile declares it.
- No mutable global state; dependencies are passed in (constructor/DI/function params) and wired
  only in the composition root.

## Services and validation
- A service receives its repository (typed by the core interface), its validator and, if needed,
  the current user. One public method per use case.
- Validation in two levels: **shape** (types, lengths, formats, ranges) at the edge with the
  stack's schema tool; **business** (existence, uniqueness, rules that read the DB) in a
  validator the service calls **before any logic**. Never in the controller.
- A flow repeated in two services is extracted to a shared component, not duplicated.
- Slow side effects (email, notifications, OCR, slow integrations) go to a background queue/job,
  not inside the HTTP request.

## Current user and permissions
- Claims are read **only** through one current-user abstraction (dependency, service, provider)
  that returns a typed object and fails with 401 when a mandatory claim is missing.
- No decoding tokens or reading auth headers in controllers or services.
- Permissions are declared per endpoint (decorator/attribute/dependency/policy) with permission
  codes, not `if role == …` inside handlers.

## Configuration
- Typed settings loaded once at startup that **fail fast** when a value is missing. No scattered
  environment reads.
- Secrets come from environment variables or a secret manager, typed as secret where the stack
  allows it. Only an `.env.example` (names + fake values) is committed.

## Logging
- The stack's standard logger for diagnostics (structured when possible), configured once. No
  print/console output. Warning or higher on known error paths.
- Business audit trail is a separate, persistent mechanism — don't mix the two.
- Never log passwords, tokens, secrets or full documents/personal data.

## Async and resources
- In async stacks, no blocking I/O on async paths; offload sync libraries to a thread pool.
- Pools and clients are created and disposed with the application lifecycle, never at import
  time.
