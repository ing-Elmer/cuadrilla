# Express or NestJS instead of Fastify

Read only when the project profile declares Express or NestJS. Every principle of the standard
still applies (4 layers, envelope, one error handler, Zod at the edge, fakes, no ORM, config
parsed once); only the HTTP-layer mechanics change. `core`, `application` and `infrastructure`
are identical — only `src/api/` differs. Update `.dependency-cruiser.cjs` `api-*` rules to name
the framework packages instead of `fastify`.

## Express (5.x)

| Fastify piece | Express equivalent |
|---|---|
| `buildApp()` returning a Fastify instance | `buildApp()` returning `express()` app; `main.ts` calls `app.listen` and keeps the `http.Server` for shutdown |
| `fastify-type-provider-zod` schemas | `validate({ body, query, params })` middleware in `api/validation.ts` that runs `schema.safeParse` and throws `ValidationError(errors)` (map `issue.path.join(".")` → messages); handlers read the parsed values from `res.locals.input` typed by a helper |
| response schema serialization | `res.json(ApiResponse.ok(msg, responseSchema.parse(dto)))` inside a `send(res, schema, envelope)` helper; never `res.json({ ... })` by hand |
| `setErrorHandler` | one error middleware `(err, req, res, next)` registered last in `app.ts`, same mapping as `api/errors.ts`; a final 404 middleware returns the envelope |
| `onRequest` authenticate hook in a scope | `authRouter.use(authenticate(tokens))` on the protected `Router`; public routes on a separate router with a justifying comment |
| `requirePermission()` preHandler | `requirePermission("CODE")` middleware per route |
| `request.currentUser` decorator | `res.locals.currentUser` set by `authenticate`; read only via `getCurrentUser(res)` |
| `app.inject()` tests | `supertest(app)` |
| pino logger | `pino-http` with the same `redact` paths; services get `logger.child()` |
| helmet/cors/rate-limit plugins | `helmet`, `cors`, `express-rate-limit` |

Express 5 forwards rejected promises from async handlers to the error middleware, so routes
still have no `try/catch`. `body-parser` limits via `express.json({ limit: "1mb" })`.

## NestJS (11.x)

| Standard piece | NestJS equivalent |
|---|---|
| `src/api/` routes | `src/api/<feature>/<feature>.controller.ts` + `<feature>.module.ts`; controllers only call the service and return `ApiResponse.*` |
| `container.ts` composition root | Nest modules: providers bind core interface tokens to infrastructure classes (`{ provide: ITEM_REPOSITORY, useClass: PgItemRepository }`) only in `api/` modules; application services stay framework-free classes registered with `useFactory` (no `@Injectable` in `application/` or `core/`) |
| Zod validation | `ZodValidationPipe` (e.g. `nestjs-zod`, if the profile allows) or a custom pipe that throws `ValidationError`; **not** class-validator DTOs |
| `setErrorHandler` | one global `@Catch()` exception filter with the same mapping; no `HttpException` thrown from services |
| authenticate + `requirePermission` | global `AuthGuard` (public routes marked `@Public()` with a comment) + `@RequirePermission("CODE")` decorator read by a `PermissionsGuard` |
| `getCurrentUser(request)` | `@CurrentUser()` param decorator |
| `inject()` tests | `Test.createTestingModule` overriding providers with fakes + `supertest` |
| pino | `nestjs-pino` with the same `redact` paths |
| `main.ts` | `NestFactory.create(AppModule, { bufferLogs: true })`, `app.enableShutdownHooks()`; still parses config once and provides `AppConfig` as a value provider |

Prefer the Fastify adapter (`@nestjs/platform-fastify`) for Nest unless the profile says
otherwise. TypeORM/Prisma integrations of Nest remain prohibited unless declared.
