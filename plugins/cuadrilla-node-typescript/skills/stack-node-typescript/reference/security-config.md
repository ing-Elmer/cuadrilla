# Security and configuration

Read before touching config, auth, secrets, the Dockerfile or CI.

## Configuration — `src/core/config.ts`

- One Zod `configSchema` declares every environment variable; `parseConfig(env)` returns a
  structured, camelCase `AppConfig` (`server`, `db`, `jwt`, …) or throws `ConfigError` with
  every invalid variable listed (`z.prettifyError`). `src/main.ts` calls it once and exits 1 on
  failure (fail fast). Nothing else reads `process.env` (ESLint `no-restricted-properties` +
  stop-check).
- Production guards live in the schema as `.refine()`: docs disabled, no `*` CORS origin.
- Booleans are parsed from `"true" | "false"` explicitly (never `Boolean("false")`); numbers
  with `z.coerce.number().int()` and bounds.
- Dev loads `.env` with `node --env-file-if-exists=.env` (the `dev` script); no `dotenv`
  import. Production gets real environment variables from the platform.
- `.env.example` is committed with every variable and fictitious values; `.env` and
  `.env.*.local` are git-ignored and never read or printed by Claude (the core guard hook blocks
  them).

## Secrets

- DSNs, JWT secret, API keys only from env / a secret manager; never literals in code, tests,
  docs or logs. Each environment has its own values.
- Logs redact `req.headers.authorization`, `req.headers.cookie`, `*.password`, `*.token`,
  `*.refreshToken` (pino `redact` in `buildApp`). Never log `AppConfig`.
- A committed secret found in the repo: tell the user without repeating it and propose rotation.

## Authentication

- Access token: JWT signed with `jose` `SignJWT`, fixed algorithm (`HS256` with a ≥ 32-byte
  secret, or `RS256`/`EdDSA` with a key pair if the profile says so). Verification with
  `jwtVerify(token, key, { algorithms: [ALG], issuer, audience })`; claims re-validated with a
  Zod schema. Lifetime from config (default 15 min). `jsonwebtoken` is not used.
- Refresh token: opaque random value (`crypto.randomBytes(32).toString("base64url")`), stored
  only as a SHA-256 hash with user, family id, expiry and `revoked_at`. Every refresh rotates
  (old revoked, new issued in one transaction); presenting a revoked token revokes the whole
  family. Sent as an `HttpOnly; Secure; SameSite=Strict` cookie scoped to the refresh path, or
  in the body if the profile declares a non-browser client.
- Passwords: `argon2` (argon2id, library defaults or stronger) or `bcrypt` with cost ≥ 12, behind
  the core `PasswordHasher` interface. Login errors are identical for unknown user and wrong
  password; inactive users are rejected.
- `@fastify/rate-limit` on login and refresh (per IP + username).
- Token verification lives in `TokenService` (infrastructure), called only by the
  `authenticate` hook; current user only via `getCurrentUser(request)`.

## HTTP hardening

- `@fastify/helmet` registered; CORS with explicit origins and `credentials: true` only if
  cookies are used.
- `trustProxy` from config (true behind Railway/Fly/ingress so `request.ip` is the client).
- Response schemas on every route (serializer strips undeclared fields such as
  `passwordHash`). 500 responses never expose messages or stacks.
- Uploads with explicit size/file-count limits; never trust client MIME types.

## Dependencies

- New packages only after user confirmation. `npm audit --omit=dev` (component `audit`) before
  deploys; `npm ci` everywhere (never `npm install` in CI/Docker).
- `@types/node` major = the Node major in `.nvmrc`.

## Docker (template `Dockerfile`)

- Multi-stage on `node:<lts>-slim`: build stage `npm ci` + `tsc`; deps stage
  `npm ci --omit=dev`; runtime copies `dist/` + prod `node_modules`, runs as `USER node`.
- `CMD ["node", "--enable-source-maps", "dist/main.js"]` (not `npm start`, so SIGTERM reaches
  Node and graceful shutdown runs). No `.env`, no secrets, no `tsx` in the image.
- `.dockerignore` excludes `node_modules`, `dist`, `.env*` (except `.env.example`), `.git`,
  `.claude`, tests.

## CI (template `ci-job.yml`)

- Job `ci-<name>`, `permissions: contents: read`, `timeout-minutes`, checkout with
  `persist-credentials: false`, `actions/setup-node` reading `.nvmrc`, then exactly the
  component's `setup` and `checks` in order. Secrets only via GitHub Secrets/environments; never
  interpolate `${{ github.event.* }}` into `run:`. Tests needing a database use the job's
  ephemeral `services: postgres`.
