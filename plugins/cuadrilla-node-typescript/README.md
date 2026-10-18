# cuadrilla-node-typescript

Stack pack for [cuadrilla](../cuadrilla): a Node.js + TypeScript **backend** standard (Fastify, Zod,
PostgreSQL with `pg` or Kysely, jose, pino, Vitest) with a specialist agent, CI/Docker templates
and a feature scaffolder. Pair it with `cuadrilla-react` for the frontend.

## Install

```
/plugin install cuadrilla-node-typescript@cuadrilla
```

Requires the `cuadrilla` core plugin (declared as a dependency). Then run `/cuadrilla:adopt` in your
project: it detects the component, merges `skills/stack-node-typescript/component.json` into
`.claude/cuadrilla.json` and copies the templates you accept.

## What it adds

| Piece | Purpose |
|---|---|
| `backend-node` agent | Implements routes, services, validators, DTOs, repositories, SQL scripts and tests, then runs every check |
| `stack-node-typescript` skill | The standard; auto-loaded for backend `.ts`/`package.json`/`tsconfig` files of `node-typescript` components |
| `/cuadrilla-node-typescript:feature-node-typescript <Name> <description>` | Scaffolds a full feature across the 4 layers + tests, shows the contract first, ends with `cuadrilla:reviewer` |
| Templates | `ci-job.yml`, multi-stage `Dockerfile`, `.dockerignore`, `tsconfig.json` + `tsconfig.build.json`, `eslint.config.mjs`, `.dependency-cruiser.cjs`, `.prettierrc.json`, `.nvmrc`, `package.scripts.json`, `.env.example` |

## What it enforces

- Node.js LTS pinned in `.nvmrc` + `engines`; TypeScript strict (+ `noUncheckedIndexedAccess`);
  ESM; npm with a committed lockfile and `npm ci`.
- Four layers in `src/` — `api`, `application`, `core`, `infrastructure` — with the dependency
  rule checked by **dependency-cruiser** (`npm run lint:deps`, also in CI).
- Fastify + `fastify-type-provider-zod`: Zod at the edge, business rules in validators, the
  `{ status, message, data, errors, meta }` envelope, validation errors → 400 with a field map,
  domain errors carrying `statusCode`, one error handler, auth on by default, declarative
  permissions, `GET /health`.
- Hand-written parametrized SQL (`pg`) or Kysely; no ORMs; pools with `statement_timeout`,
  read-only connections, transactions, pagination in the database; numbered SQL scripts that
  Claude writes but never runs.
- Config parsed once with Zod (fail fast), pino logging with redaction, jose JWT with refresh
  rotation, argon2/bcrypt.
- Vitest with fakes for services/validators, `inject()` route tests, mandatory auth/permission
  tests.
- Extra stop-check patterns (on top of the core's): ORM imports/dependencies, `process.env`
  inside a layer, `throw new Error` in application/core, `reply.send({...})` in api, pools
  outside infrastructure, `Authorization` header in routes/services, SQL concatenation in
  `.query()`, Kysely `sql.raw`/`sql.lit`.

Checks (identical locally and in CI): `npm ci` → `npm run typecheck` → `npm run lint` →
`npm run lint:deps` → `npm run test -- --run` → `npm run build`.

Express or NestJS projects: declare it in the project profile; the pack's
`reference/express-nest-mapping.md` maps every rule.

## Recommended third-party skills (optional)

Reference only — the pack's standard wins on conflicts. Install with `npx skills add <source>@<skill>`.

| Skill | Why | Ignore from it |
|---|---|---|
| `mcollina/skills@fastify-best-practices` | By Fastify's lead maintainer: plugins, hooks, encapsulation, Pino | TypeBox/JSON Schema as validation layer; running TS via Node type stripping in production |
| `wshobson/agents@typescript-advanced-types` | Generics/conditional/mapped types for typed repositories and envelopes | Anything that bypasses strict mode |
| `wshobson/agents@nodejs-backend-patterns` | General Node backend background (shutdown, rate limiting, caching) | Express-first examples, Winston, its folder layout and response shapes, ORMs |

## Optional: PostgreSQL MCP (read-only)

The pack ships no `.mcp.json`. If you want the agent to read your local database structure
before writing repositories, add this to your project's `.mcp.json` (restricted = read-only;
the DSN comes from your environment, never committed):

```json
{
  "mcpServers": {
    "postgres": {
      "type": "stdio",
      "command": "uvx",
      "args": ["postgres-mcp", "--access-mode=restricted"],
      "env": { "DATABASE_URI": "${POSTGRES_MCP_DSN}" }
    }
  }
}
```

The agent never uses it to write data or run migrations.

## License

MIT — see the root [LICENSE](../../LICENSE).
