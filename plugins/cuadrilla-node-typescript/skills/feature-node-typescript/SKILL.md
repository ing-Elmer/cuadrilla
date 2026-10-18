---
name: feature-node-typescript
description: Scaffold a complete Node.js + TypeScript backend feature (all layers + tests) following the cuadrilla standard.
argument-hint: "<FeatureName> <short description>"
disable-model-invocation: true
---

Create the backend feature: **$ARGUMENTS**

Delegate the implementation to the `cuadrilla-node-typescript:backend-node` agent. Take the
component path, `<schema>`, `<prefix>_`, connection, data library (`pg` or `kysely`), permission
codes and SQL scripts folder from the `## Project profile` in `CLAUDE.md` and from
`.claude/cuadrilla.json`. If several components use the `node-typescript` stack, ask which one.

## Expected files (`<feature>` in kebab-case, inside the component's `src/` and `test/`)

- **core:** `core/dtos/<feature>.dto.ts` (Zod request/response schemas + `z.output<>` types),
  `core/repositories/<feature>.repository.ts` (interface), new domain errors in
  `core/errors.ts` only if needed (each with its `statusCode`).
- **infrastructure:** `infrastructure/repositories/pg-<feature>.repository.ts` (or
  `kysely-<feature>.repository.ts`) implementing the interface.
- **application:** `application/validators/<feature>.validator.ts`,
  `application/services/<feature>.service.ts`.
- **api:** `api/routes/<feature>.routes.ts` (schemas, `requirePermission`, `ApiResponse.*`),
  wiring in `api/container.ts` (`Container.services`) and registration inside the authenticated
  scope in `api/app.ts`.
- **tests:** `test/fakes/in-memory-<feature>.repository.ts`,
  `test/application/<feature>.service.test.ts`, `test/application/<feature>.validator.test.ts`,
  `test/api/<feature>.routes.test.ts` (401, 403, 400 errors map, success envelope, 404).
- **SQL:** if a table or column is needed, `NNN_<verb>_<description>.sql` with the next free
  number in the scripts folder — written, never executed.

## Steps

1. First show the file list and the endpoint contract (method, path, permission code, request
   and response shapes, status codes) and **wait for the user's OK**.
2. Implement through the agent.
3. In the component folder run, in order: `npm run typecheck`, `npm run lint`,
   `npm run lint:deps`, `npm run test -- --run`, `npm run build`. Report the real results; fix
   failures before continuing.
4. When the checks pass, run the core `cuadrilla:reviewer` agent on the feature's files and show
   its findings by severity before declaring the feature done. List any SQL scripts the user
   must run.
