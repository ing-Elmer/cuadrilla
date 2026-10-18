# Architecture — 4 layers, composition root, services and validators

Read before creating a feature, adding a layer file or moving code between layers. Code below
was type-checked with TypeScript strict, Fastify 5, Zod 4 and fastify-type-provider-zod 7;
confirm APIs against the versions pinned in the project's `package.json`.

## Folder layout

```
<path>/                         component folder from .claude/cuadrilla.json (default backend/)
├── .nvmrc                      Node LTS major (also engines.node in package.json)
├── package.json / package-lock.json
├── tsconfig.json               type-check src + test (noEmit)
├── tsconfig.build.json         build src → dist
├── eslint.config.mjs  .prettierrc.json  .dependency-cruiser.cjs
├── .env.example                committed; .env is local and ignored
├── src/
│   ├── main.ts                 entry: parseConfig(process.env) → buildApp → listen → shutdown
│   ├── api/
│   │   ├── app.ts              buildApp({ config, container? }) — plugins, scopes, routes
│   │   ├── container.ts        composition root (the only api file importing infrastructure)
│   │   ├── response.ts         ApiResponse helpers + apiResponseSchema()
│   │   ├── errors.ts           setErrorHandler + setNotFoundHandler
│   │   ├── auth/auth.ts        authenticate hook, getCurrentUser, requirePermission
│   │   └── routes/<feature>.routes.ts
│   ├── application/
│   │   ├── services/<feature>.service.ts
│   │   └── validators/<feature>.validator.ts
│   ├── core/
│   │   ├── config.ts           configSchema, AppConfig, parseConfig, ConfigError
│   │   ├── errors.ts           DomainError + subclasses, ErrorMap, addError
│   │   ├── auth.ts             CurrentUser, TokenService, PasswordHasher
│   │   ├── logger.ts           Logger interface (pino-compatible)
│   │   ├── pagination.ts       pageQuerySchema, Page<T>
│   │   ├── dtos/<feature>.dto.ts
│   │   └── repositories/<feature>.repository.ts
│   └── infrastructure/
│       ├── db.ts               createPool, withTransaction, ping
│       ├── auth/               jose-token.service.ts, argon2-password.hasher.ts
│       ├── clients/            external HTTP/SDK clients (implement core interfaces)
│       └── repositories/pg-<feature>.repository.ts
└── test/                       mirrors src/ (application/, api/, fakes/)
```

## Dependency rule (dependency-cruiser)

```
api ──► application ──► core ◄── infrastructure
 └─ container.ts ──► infrastructure        main.ts ──► anything
```

`.dependency-cruiser.cjs` (template) enforces: no cycles, no unresolvable imports, `src` never
imports `test`, core imports only `zod` (no framework, driver, `node:fs`/`node:http`…),
application never imports api/infrastructure or `fastify`/`pg`/`kysely`/`jose`/`argon2`/`pino`,
infrastructure never imports api/application/`fastify`, api never imports infrastructure (except
`container.ts`) nor `pg`/`kysely`. A violation fails `npm run lint:deps` and CI. Never weaken a
rule to make a change pass; move the code to the right layer instead.

## Core: DTOs, interfaces, errors

```ts
// src/core/dtos/item.dto.ts
import { z } from "zod";

const money = z.string().regex(/^\d{1,10}(\.\d{1,2})?$/, "Must be a decimal with up to 2 places");

export const itemCreateRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  price: money,
});
export type ItemCreateRequest = z.output<typeof itemCreateRequestSchema>;

export const itemResponseSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  price: money,
  createdAt: z.date(),
});
export type ItemResponse = z.output<typeof itemResponseSchema>;
```

- Naming: `<feature><Action>RequestSchema` / `<Feature><Action>Request` for input,
  `<feature>ResponseSchema` / `<Feature>Response` for output. Types are always `z.output<>` of
  the schema; never declare the same shape twice by hand.
- Money and `numeric` columns are decimal **strings** in DTOs and JSON (never `number`).
- `timestamptz` columns are `z.date()`; they serialize to ISO-8601 strings.

```ts
// src/core/repositories/item.repository.ts
export interface ItemRepository {
  findById(id: number): Promise<ItemResponse | null>;
  existsByName(name: string): Promise<boolean>;
  list(query: PageQuery): Promise<Page<ItemResponse>>;
  create(input: ItemCreateRequest, createdBy: number): Promise<ItemResponse>;
}
```

Domain errors (`src/core/errors.ts`): `DomainError` is abstract with `abstract readonly
statusCode: number`; subclasses `ValidationError` (400, carries `errors: ErrorMap`),
`UnauthorizedError` 401, `ForbiddenError` 403, `NotFoundError` 404, `ConflictError` 409. A new
error class extends `DomainError` and sets `readonly statusCode = <n>`. Application and core
never `throw new Error(...)`.

## Application: validators and services

```ts
// src/application/validators/item.validator.ts
export class ItemValidator {
  readonly #items: ItemRepository;

  constructor(items: ItemRepository) {
    this.#items = items;
  }

  async validateCreate(input: ItemCreateRequest): Promise<void> {
    const errors: ErrorMap = {};
    if (await this.#items.existsByName(input.name)) {
      addError(errors, "name", "An item with this name already exists");
    }
    if (Object.keys(errors).length > 0) throw new ValidationError(errors);
  }
}
```

```ts
// src/application/services/item.service.ts
export interface ItemServiceDeps {
  items: ItemRepository;
  validator: ItemValidator;
  logger: Logger;
}

export class ItemService {
  readonly #items: ItemRepository;
  readonly #validator: ItemValidator;
  readonly #logger: Logger;

  constructor(deps: ItemServiceDeps) {
    this.#items = deps.items;
    this.#validator = deps.validator;
    this.#logger = deps.logger;
  }

  async getById(id: number): Promise<ItemResponse> {
    const item = await this.#items.findById(id);
    if (!item) throw new NotFoundError(`Item ${id} not found`);
    return item;
  }

  async create(input: ItemCreateRequest, user: CurrentUser): Promise<ItemResponse> {
    await this.#validator.validateCreate(input);        // business rules first
    const item = await this.#items.create(input, user.id);
    this.#logger.info({ itemId: item.id, userId: user.id }, "item created");
    return item;
  }
}
```

Rules:
- Constructor injection with one `<Feature>ServiceDeps` object; private `#fields`; no parameter
  properties (keeps the code compatible with Node type stripping).
- The validator runs before any write. Services never read the `Authorization` header: they
  receive `CurrentUser` as an argument.
- A flow repeated by two services is extracted into a shared service, not copied.
- Services return core DTOs, never envelopes (envelopes belong to api).
- Infrastructure capabilities a service needs (tokens, hashing, email, storage, clock) are core
  interfaces implemented in infrastructure and injected.

## Composition root

```ts
// src/api/container.ts
export interface Container {
  services: { items: ItemService };
  tokens: TokenService;
  healthCheck: () => Promise<void>;
  close: () => Promise<void>;
}
export type ContainerFactory = (config: AppConfig, logger: Logger) => Container;

export const createContainer: ContainerFactory = (config, logger) => {
  const mainPool = createPool({
    dsn: config.db.main.dsn,
    readOnly: config.db.main.readOnly,
    poolMax: config.db.poolMax,
    statementTimeoutMs: config.db.statementTimeoutMs,
    applicationName: "<app>-api",
  });
  const itemRepository = new PgItemRepository(mainPool);
  return {
    services: {
      items: new ItemService({
        items: itemRepository,
        validator: new ItemValidator(itemRepository),
        logger: logger.child({ module: "items" }),
      }),
    },
    tokens: new JoseTokenService(config.jwt),
    healthCheck: () => ping(mainPool),
    close: () => mainPool.end(),
  };
};
```

- The only place that calls `new` on repositories, pools and clients. Adding a feature = add
  its service to `Container.services` and wire it here.
- No DI container library (tsyringe, inversify, awilix) unless the profile declares it.
- `buildApp` accepts an optional `container` factory so tests inject fakes.

## Entry point

```ts
// src/main.ts
function loadConfig(): AppConfig {
  try {
    return parseConfig(process.env); // the only process.env read in the codebase
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`Invalid configuration:\n${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }
}

const config = loadConfig();
const app = await buildApp({ config });

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  app.log.info({ signal }, "shutting down");
  await app.close(); // onClose hooks drain the pools
  process.exit(0);
}
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => void shutdown(signal));
}

await app.listen({ host: config.server.host, port: config.server.port });
```

## Logging

- pino through Fastify: `request.log` inside hooks/handlers, `app.log` at startup, and a
  `Logger` (core interface, structurally satisfied by pino) injected into services as
  `logger.child({ module: "<feature>" })`.
- Always structured: `logger.info({ itemId }, "item created")`. Levels: `info` for business
  events, `warn` for handled anomalies, `error` with `{ err }` for failures.
- Repositories do not log. Never log passwords, tokens, full documents or connection strings.
- Business audit trails (who changed what) go to an audit table through a service, not to logs.
