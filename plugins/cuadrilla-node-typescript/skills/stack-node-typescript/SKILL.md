---
name: stack-node-typescript
description: Node.js + TypeScript backend standard for cuadrilla projects — architecture, API, data access, testing and tooling rules for Fastify services with Zod, pg/Kysely and Vitest. Load before writing, reviewing or planning backend TypeScript (API routes, services, validators, repositories, SQL, server config) in a component whose stack is "node-typescript" in .claude/cuadrilla.json. Not for frontend/React components (stack "react"), even though both use .ts files.
user-invocable: false
paths: "**/*.ts, **/*.mts, **/package.json, **/tsconfig*.json"
---

# Node.js + TypeScript backend standard

Applies only to components with `"stack": "node-typescript"` in `.claude/cuadrilla.json`. If the
file you are touching belongs to a `react` (or other) component, this skill does not apply.
`<app>`, `<schema>`, `<prefix>_`, connection names and the SQL scripts folder come from the
`## Project profile` section of `CLAUDE.md` — never invent them. An exception declared in the
profile wins over any rule here.

## 1. Scope

- **Runtime:** Node.js Active LTS line (24.x at the time of writing). The version is pinned in
  `.nvmrc` and `package.json > engines.node`; Dockerfile and CI read the same value. Check the
  pinned version before using a Node API; never bump it without confirmation.
- **Language:** TypeScript `strict` + `noUncheckedIndexedAccess` + `noImplicitOverride`
  (+ `exactOptionalPropertyTypes` when the profile enables it). ESM only: `"type": "module"`,
  `module`/`moduleResolution` `NodeNext`, relative imports end in `.js`. No `require` in `src/`.
- **Package manager:** npm. `package-lock.json` is committed; installs are `npm ci`. New
  dependencies only after the user confirms (say which package, why, and its weekly downloads).
- **Stack:** Fastify (current major) + `fastify-type-provider-zod` + Zod, `pg` (node-postgres)
  or Kysely, `jose` (JWT), `argon2` (or `bcrypt`, cost ≥ 12), pino (Fastify's logger),
  `@fastify/helmet`, `@fastify/cors`, `@fastify/rate-limit`, Vitest, ESLint (flat config,
  typescript-eslint) + Prettier, dependency-cruiser, `tsx` for `dev` only.
- **Prohibited unless the profile declares it:** ORMs (Prisma, TypeORM, Sequelize, MikroORM,
  Drizzle ORM); Express / NestJS / Koa / Hapi (mapping in `reference/express-nest-mapping.md`);
  `jsonwebtoken` (use `jose`); Joi / Yup / class-validator (Zod only); `dotenv` imports (dev
  uses `node --env-file`); Mongoose/MongoDB; yarn/pnpm; DDD tactical patterns
  (Entity/ValueObject/Aggregate base classes); module-level mutable state and home-made
  singletons (no `export const db = new Pool()`; everything is created in the composition root).
- Library APIs change between majors: confirm Fastify, Zod, Kysely, jose and Vitest APIs against
  the version in `package.json` with Context7 instead of assuming.

## 2. Architecture — 4 layers in `src/`

| Layer | Contains | Prohibited | May import |
|---|---|---|---|
| `src/api` | `app.ts` (`buildApp`), `container.ts` (composition root), `routes/<feature>.routes.ts`, `response.ts` (envelope), `errors.ts` (error handler), `auth/` (authenticate hook, `getCurrentUser`, `requirePermission`) | business logic, SQL, `pg`/`kysely` imports, `try/catch` in routes | `application`, `core`; `infrastructure` **only** from `container.ts` |
| `src/application` | `services/<feature>.service.ts`, `validators/<feature>.validator.ts` | SQL, `fastify`, `pg`, `kysely`, `jose`, `argon2`, `process.env`, `throw new Error` | `core` |
| `src/core` | `dtos/<feature>.dto.ts` (Zod schemas + inferred types), `repositories/<feature>.repository.ts` (interfaces), `errors.ts` (domain errors), `config.ts` (config schema + `parseConfig`), `auth.ts` (`CurrentUser`, `TokenService`, `PasswordHasher`), `logger.ts` (`Logger` type), `pagination.ts` | I/O, `fastify`, `pg`, `kysely`, `node:fs`/`node:http`, `throw new Error` | `zod` only |
| `src/infrastructure` | `db.ts` (pools, `withTransaction`), `repositories/pg-<feature>.repository.ts`, `auth/` (jose token service, argon2 hasher), external API clients | business logic, defaults, logging in repositories, `fastify` | `core` |

- `src/main.ts` is the only entry point and the only file that reads `process.env`:
  `parseConfig(process.env)` → `buildApp({ config })` → `listen` → graceful shutdown.
- The dependency rule is enforced by **dependency-cruiser** (`.dependency-cruiser.cjs`,
  `npm run lint:deps`, CI check `deps`); no circular imports. Breaking it breaks the build.
- Files `kebab-case` with a role suffix (`invoice-line.service.ts`); types/classes `PascalCase`;
  functions/variables `camelCase`; Zod schemas `<name>Schema`. One feature = one file per role.
- Services are classes with constructor injection (repository interface, validator, `Logger`,
  other services). Wiring happens **only** in `api/container.ts`; routes receive services via
  plugin options and never instantiate repositories. Details: `reference/architecture.md`.
- Slow work (email, notifications, integrations) never runs inside the request; use the job
  mechanism the profile declares (none declared → ask).

## 3. API (Fastify)

- Every response uses the envelope `{ status, message, data, errors, meta }`,
  `status ∈ "Success" | "Created" | "Error"`, built only with the helpers in `api/response.ts`
  (`ApiResponse.ok`, `.created`, `.page`, `.error`). Routes **return** the envelope; never
  `reply.send({...})`, never a bare DTO.
- Each route declares `schema: { body/querystring/params: <zod>, response: { 200: apiResponseSchema(<dto>) } }`
  through `fastify-type-provider-zod`, so input is validated and output is serialized (unknown
  fields stripped). JSON is camelCase both ways.
- Validation errors → **400** with `errors: { field: ["message"] }` (never Fastify's default
  shape). Domain errors extend `DomainError` and declare `statusCode`
  (`NotFoundError` 404, `ConflictError` 409, `ForbiddenError` 403, `UnauthorizedError` 401,
  `ValidationError` 400 with its `errors` map). A new error class **declares** its status.
- `api/errors.ts` is the only place that translates errors (`setErrorHandler` +
  `setNotFoundHandler`); anything unknown → 500 with a generic message, logged with the error.
  Routes have no `try/catch` and never call `reply.code(4xx/5xx)` themselves.
- Auth is on by default: protected routes are registered inside the authenticated scope (an
  `onRequest` hook that verifies the JWT). A public route goes in the public scope with a
  comment justifying it; endpoints that create users or credentials are never anonymous.
- Permissions are declarative: `preHandler: requirePermission("<CODE>")`, never an `if` on the
  role inside the handler. The current user comes only from `getCurrentUser(request)`.
- Routes under `/api/<domain>/...`; `GET /health` is anonymous and runs `SELECT 1`.
  CORS with explicit origins from config (never `*` in production); `@fastify/helmet` on;
  rate limit on auth endpoints; Swagger UI disabled in production by config.
  Details and code: `reference/api.md`.

## 4. Data (PostgreSQL)

- One data library per component, declared in the profile: `pg` with hand-written SQL
  (default) **or** Kysely. Never mix both in a component.
- SQL is always parametrized: `$1..$n` with `pg`, bound values with Kysely. Never concatenate or
  interpolate input (no template literals in `query()`, no `sql.raw`/`sql.lit` with input).
  Dynamic identifiers (sort column) only from a whitelist.
- Explicit schema and snake_case: `<schema>.<prefix>_<table>`. Select explicit columns aliased
  to camelCase (`created_at AS "createdAt"`) or use Kysely's `CamelCasePlugin`; no `SELECT *`.
- Pools only from `infrastructure/db.ts`, one per connection name of the profile, created in the
  composition root and closed in `onClose`. Every pool sets `statement_timeout`; read-only
  connections set `default_transaction_read_only=on` and never receive INSERT/UPDATE/DELETE.
- Writes touching more than one table run in `withTransaction(pool, fn)` inside one repository
  method. `INSERT/UPDATE ... RETURNING` instead of a follow-up `SELECT`.
- Pagination in the database (`LIMIT/OFFSET`, keyset for large tables); never page in memory.
- Repositories implement the core interface, return what the database has, and do not log,
  validate or apply defaults. Details: `reference/data.md`.
- Migrations: `NNN_<verb>_<description>.sql` in the profile's scripts folder, next free number.
  **Claude writes them and never runs them** (no `psql`, no migration tool, no MCP write).
  Details: `reference/sql-migrations.md`.

## 5. Validation, configuration, logging, current user

- **Validation in two levels:** shape (types, lengths, formats, ranges) in the Zod DTO schema at
  the edge; business rules (existence, uniqueness, state) in
  `application/validators/<feature>.validator.ts`, called first in the service, which throws
  `ValidationError(errors)`.
- **Config:** `core/config.ts` defines `configSchema` (Zod) and `parseConfig(env)`; `main.ts`
  calls it once at startup and the process exits with a readable message if it fails. Secrets
  are never logged. `process.env` appears nowhere else. Committed `.env.example` only.
- **Logging:** pino through Fastify (`app.log`, `request.log`); services receive a `Logger`
  (child logger) by constructor. No `console.*`. Redact `authorization`, `cookie`, `password`,
  `token` paths. Never log passwords, tokens or full documents.
- **Auth:** JWT with `jose` (fixed algorithm, `algorithms`, `issuer` and `audience` checked);
  short-lived access token; refresh tokens opaque, stored hashed, rotated on every use, reuse of
  a revoked token revokes the family. Passwords with argon2id (or bcrypt cost ≥ 12).
  Details: `reference/security-config.md`.

## 6. Testing (Vitest)

- Tests in `test/` mirroring `src/`: `test/application/<feature>.service.test.ts`,
  `test/application/<feature>.validator.test.ts`, `test/api/<feature>.routes.test.ts`.
  Names: `describe("<Unit>.<method>")` + `it("<scenario> → <expected result>")`.
- **Mandatory:** service and validator tests for new logic in the same change, using **fakes**
  that implement the core repository interfaces (in-memory classes), not the real database.
- Routes are tested with `app.inject()` over `buildApp({ config, container: fakeContainer })`:
  status, envelope shape, validation 400 map, 401 without token, 403 without permission.
- **Mandatory from day one:** auth tests (login, wrong password, inactive user, refresh rotation,
  reuse of a revoked refresh token) and permission tests (401/403).
- Every bug fix ships a test that reproduces it. Repository tests are optional and only against
  an ephemeral database (CI `services:` or Testcontainers), never a shared one.
- Never skip, delete or comment out tests to get green. Details: `reference/testing.md`.

## 7. Tooling — exact commands (match `component.json`)

| Purpose | Command |
|---|---|
| Install | `npm ci` |
| Types | `npm run typecheck` (`tsc --noEmit`, src + test) |
| Lint + format check | `npm run lint` (`eslint . && prettier --check .`) |
| Layers | `npm run lint:deps` (dependency-cruiser) |
| Tests | `npm run test -- --run` (Vitest, single run) |
| Build | `npm run build` (`tsc -p tsconfig.build.json` → `dist/`) |
| Dev server | `npm run dev` (port 3000, `GET /health`) |
| Audit | `npm audit --omit=dev` |

The format hook runs Prettier and ESLint on every file you edit: fix what it reports right away.
Before handing off, run every check above in the component folder and report the real output.

## 8. Files in this skill

- `${CLAUDE_SKILL_DIR}/component.json` — the component block, forbidden patterns and
  recommended skills `/cuadrilla:adopt` merges into `.claude/cuadrilla.json`.
- `${CLAUDE_SKILL_DIR}/reference/architecture.md` — layer contents, composition root, service
  and validator shapes, `main.ts`. Read before creating a feature or moving code between layers.
- `${CLAUDE_SKILL_DIR}/reference/api.md` — envelope, error handler, routes, auth scopes,
  permissions, health. Read before writing or reviewing routes.
- `${CLAUDE_SKILL_DIR}/reference/data.md` — pools, repositories with `pg` and Kysely,
  transactions, pagination. Read before writing a repository.
- `${CLAUDE_SKILL_DIR}/reference/sql-migrations.md` — naming and content rules for SQL scripts.
  Read before writing any `.sql`.
- `${CLAUDE_SKILL_DIR}/reference/testing.md` — fakes, `inject()` tests, mandatory auth tests.
- `${CLAUDE_SKILL_DIR}/reference/security-config.md` — config schema, secrets, JWT/refresh,
  hashing, headers, Docker/CI rules.
- `${CLAUDE_SKILL_DIR}/reference/express-nest-mapping.md` — only when the profile declares
  Express or NestJS instead of Fastify.
- `${CLAUDE_SKILL_DIR}/templates/` — files `/cuadrilla:adopt` copies: `ci-job.yml`, `Dockerfile`,
  `.dockerignore`, `tsconfig.json`, `tsconfig.build.json`, `eslint.config.mjs`,
  `.dependency-cruiser.cjs`, `package.scripts.json` (the `scripts`/`engines` blocks),
  `.prettierrc.json`, `.nvmrc`, `.env.example`. Read them when creating or repairing tooling.

## Shared auth contract
Authentication endpoints (`/api/auth/login`, `/api/auth/refresh`, `/api/auth/logout`, `/api/me`), payloads and cookie rules are defined once in `cuadrilla:standard-api` ("Shared auth contract") so every frontend pack works with this backend. Implement them exactly; differences go to the profile's "Exceptions to the standard".
