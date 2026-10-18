# API — envelope, errors, routes, auth scopes (Fastify)

Read before writing or reviewing anything in `src/api/`. Uses `fastify-type-provider-zod`
(`validatorCompiler`, `serializerCompiler`, `ZodTypeProvider`, `FastifyPluginCallbackZod`,
`hasZodFastifySchemaValidationErrors`); check its README for the installed major (v7+ requires
Zod ≥ 4.2 and serializes `z.output<>`).

## Envelope — `src/api/response.ts`

```ts
export type ApiStatus = "Success" | "Created" | "Error";
export interface PageMeta { page: number; pageSize: number; total: number }
export interface ApiResponse<T> {
  status: ApiStatus;
  message: string;
  data: T | null;
  errors: ErrorMap | null;
  meta: PageMeta | null;
}

export const ApiResponse = {
  ok<T>(message: string, data: T): ApiResponse<T> {
    return { status: "Success", message, data, errors: null, meta: null };
  },
  created<T>(message: string, data: T): ApiResponse<T> {
    return { status: "Created", message, data, errors: null, meta: null };
  },
  page<T>(message: string, page: Page<T>): ApiResponse<T[]> {
    const { items, ...meta } = page;
    return { status: "Success", message, data: items, errors: null, meta };
  },
  error(message: string, errors: ErrorMap | null = null): ApiResponse<null> {
    return { status: "Error", message, data: null, errors, meta: null };
  },
};

export function apiResponseSchema<T extends z.ZodType>(data: T) {
  return z.object({
    status: z.enum(["Success", "Created", "Error"]),
    message: z.string(),
    data: data.nullable(),
    errors: z.record(z.string(), z.array(z.string())).nullable(),
    meta: z.object({ page: z.number().int(), pageSize: z.number().int(), total: z.number().int() }).nullable(),
  });
}
```

Rules checkable in a diff:
- Handlers **return** `ApiResponse.ok|created|page(...)`. No `reply.send({ ... })`, no bare DTO,
  no hand-built envelope object (stop-check flags `reply.send({`).
- Every route declares `response: { <code>: apiResponseSchema(<dto schema>) }`. The serializer
  then strips fields the DTO does not declare (no accidental leaks such as `passwordHash`).
- `201` routes: `reply.code(201); return ApiResponse.created(...)` and declare `201` in `response`.
- JSON keys are camelCase (DTO fields are camelCase; SQL aliases map snake_case columns).

## Error handler — `src/api/errors.ts`

```ts
export function registerErrorHandlers(app: FastifyInstance): void {
  app.setErrorHandler<FastifyError>((error, request, reply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
      const errors: ErrorMap = {};
      for (const issue of error.validation) {
        const field = issue.instancePath.replace(/^\//, "").replaceAll("/", ".");
        addError(errors, field || (error.validationContext ?? "request"), issue.message ?? "Invalid value");
      }
      return reply.code(400).send(ApiResponse.error("Validation failed", errors));
    }
    if (error instanceof ValidationError) {
      return reply.code(400).send(ApiResponse.error(error.message, error.errors));
    }
    if (error instanceof DomainError) {
      return reply.code(error.statusCode).send(ApiResponse.error(error.message));
    }
    // Fastify's own client errors: malformed JSON, 413, 415, 429.
    if (error.statusCode !== undefined && error.statusCode >= 400 && error.statusCode < 500) {
      return reply.code(error.statusCode).send(ApiResponse.error(error.message));
    }
    request.log.error({ err: error }, "unhandled error");
    return reply.code(500).send(ApiResponse.error("Internal server error"));
  });

  app.setNotFoundHandler((request, reply) =>
    reply.code(404).send(ApiResponse.error(`Route ${request.method} ${request.url} not found`)),
  );
}
```

- The only `setErrorHandler` in the app (no per-plugin handlers). 500 responses never include
  `error.message` or stack; the log does.
- Nested field paths become dotted keys: `lines.0.quantity`.
- Routes and services have no `try/catch` to build HTTP responses. Infrastructure may catch a
  driver error to translate it (e.g. unique violation `23505` → `ConflictError`).

## App assembly — `src/api/app.ts`

```ts
export async function buildApp({ config, container: makeContainer = createContainer }: BuildAppOptions) {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      redact: ["req.headers.authorization", "req.headers.cookie", "*.password", "*.token", "*.refreshToken"],
    },
    trustProxy: config.server.trustProxy,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandlers(app);
  app.decorateRequest("currentUser", null);

  const container = makeContainer(config, app.log);
  app.addHook("onClose", async () => {
    await container.close();
  });

  await app.register(helmet);
  await app.register(cors, { origin: config.server.corsOrigins, credentials: true });

  // Public scope: only routes that must be anonymous, each with a justifying comment.
  await app.register(healthRoutes, { healthCheck: container.healthCheck });

  // Authenticated scope (default for everything else).
  await app.register(async (secured) => {
    secured.addHook("onRequest", authenticate(container.tokens));
    await secured.register(itemRoutes, { prefix: "/api/items", service: container.services.items });
  });

  return app;
}
```

- New feature routes are registered **inside the authenticated scope**. Registering a route in
  the public scope requires a `// Public on purpose: <reason>` comment; login/refresh go there
  (with `@fastify/rate-limit`), user/credential creation never does.
- Swagger (`@fastify/swagger` + `@fastify/swagger-ui` with `jsonSchemaTransform`) is registered
  only when `config.docsEnabled` (false in production — enforced by the config schema).
- Body size: keep Fastify's default `bodyLimit` (1 MiB) unless a route needs more; set it per
  route, not globally. Uploads use `@fastify/multipart` with explicit `limits`.

## Auth hooks — `src/api/auth/auth.ts`

```ts
declare module "fastify" {
  interface FastifyRequest {
    currentUser: CurrentUser | null;
  }
}

export function authenticate(tokens: TokenService): onRequestAsyncHookHandler {
  return async (request) => {
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) throw new UnauthorizedError("Missing bearer token");
    request.currentUser = await tokens.verifyAccess(header.slice("Bearer ".length));
  };
}

export function getCurrentUser(request: FastifyRequest): CurrentUser {
  if (!request.currentUser) throw new UnauthorizedError("Not authenticated");
  return request.currentUser;
}

export function requirePermission(code: string): preHandlerHookHandler {
  return (request, _reply, done) => {
    const user = request.currentUser;
    if (!user) {
      done(new UnauthorizedError("Not authenticated"));
      return;
    }
    if (!user.permissions.includes(code)) {
      done(new ForbiddenError(`Missing permission ${code}`));
      return;
    }
    done();
  };
}
```

- Only this module reads `request.headers.authorization` or `request.currentUser` directly;
  routes call `getCurrentUser(request)` (stop-check flags the header in routes/services).
- Permission codes are `UPPER_SNAKE` strings from the profile's permission catalog; never
  `if (user.role === "admin")` in a handler or service.

## Routes — `src/api/routes/<feature>.routes.ts`

```ts
export interface ItemRoutesOptions {
  service: ItemService;
}

const idParams = z.object({ id: z.coerce.number().int().positive() });

export const itemRoutes: FastifyPluginCallbackZod<ItemRoutesOptions> = (app, { service }, done) => {
  app.get(
    "/",
    {
      schema: { querystring: pageQuerySchema, response: { 200: apiResponseSchema(z.array(itemResponseSchema)) } },
      preHandler: requirePermission("ITEMS_READ"),
    },
    async (request) => ApiResponse.page("Items", await service.list(request.query)),
  );

  app.get(
    "/:id",
    {
      schema: { params: idParams, response: { 200: apiResponseSchema(itemResponseSchema) } },
      preHandler: requirePermission("ITEMS_READ"),
    },
    async (request) => ApiResponse.ok("Item", await service.getById(request.params.id)),
  );

  app.post(
    "/",
    {
      schema: { body: itemCreateRequestSchema, response: { 201: apiResponseSchema(itemResponseSchema) } },
      preHandler: requirePermission("ITEMS_CREATE"),
    },
    async (request, reply) => {
      const item = await service.create(request.body, getCurrentUser(request));
      reply.code(201);
      return ApiResponse.created("Item created", item);
    },
  );

  done();
};
```

- A route handler is at most: read validated input, get the current user, call **one** service
  method, wrap the result. No SQL, no repository, no business `if`.
- Paths: `/api/<domain>` plural kebab-case (`/api/invoice-lines`), ids as path params, filters
  and pagination as querystring (`page`, `pageSize`, `sort` from a whitelist).
- Every endpoint consumed by the frontend is also added to the frontend's API client (the React
  pack's `api/endpoints.ts`) in the same change when both live in the repo.

## Health and operations

- `GET /health` (public): runs `SELECT 1` on the main pool through `container.healthCheck()`
  and returns `ApiResponse.ok("Healthy", { database: "up" })`; a DB failure becomes a 500.
- `@fastify/helmet` registered; CORS origins explicit from config; `trustProxy` from config when
  behind a proxy/PaaS router.
- Resources (pools, queues, clients) are created in `createContainer` and closed in `onClose`;
  nothing opens connections at import time.
