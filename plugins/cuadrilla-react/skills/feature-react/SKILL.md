---
name: feature-react
description: Scaffold a complete React feature (types, endpoints, service, hook, components, page, route, tests) following the cuadrilla standard.
argument-hint: "<FeatureName> <short description / endpoints it consumes>"
disable-model-invocation: true
---

Create the React feature: **$ARGUMENTS**

## 1. Delegate

Use the `cuadrilla-react:frontend-react` agent. Take the frontend component path, UI language,
roles and permission codes from the `## Project profile` in `CLAUDE.md` and `.claude/cuadrilla.json`.
If there are several React components, ask which one.

## 2. Plan first, then wait for OK

Before writing any file, show:

- **API contract consumed** — for each endpoint: method, path, request DTO, response `data` (and
  `meta` if paginated), error cases, required permission. Verify it exists in the backend. If an
  endpoint does not exist, **stop and return the required contract** instead of scaffolding
  against an imaginary API.
- **File list** (adapt names; `<feature>` camelCase, `<Feature>` PascalCase):
  - `src/types/<feature>.ts` — DTOs mirroring the backend (camelCase)
  - `src/api/endpoints.ts` — the feature's paths (edit)
  - `src/services/<Feature>Service.ts` — one function per endpoint via `request<T>()`
  - `src/hooks/use<Feature>.ts` — on `useAsyncResource`, mutations that `reload()`
  - `src/helpers/<Feature>/mappers.ts` — only if UI and DTO shapes differ
  - `src/components/<Feature>/…` — form, table columns, detail pieces using `components/ui`
  - `src/pages/<Feature>/<Feature>Page.tsx` — loading / empty / error states
  - `src/routes/appRoutes.ts` (edit) + router entry wrapped in `<PrivateRoute rule=…>`
  - Tests: `use<Feature>.test.ts`, mapper/util tests, component test for non-trivial form logic
- **Shared pieces missing** (`useAsyncResource`, `DataTable`, states, `FormDialog`,
  `ConfirmDialog`, `toFormErrors`, `canAccess`) — they are created first in their shared place,
  from the `templates/src-skeleton.md` file of the `cuadrilla-react:stack-react` skill when
  applicable.

Wait for the user's OK (or changes) before implementing.

## 3. Implement and verify

- The agent implements in the order types → endpoints → service → hook → components → page →
  route/navigation → tests.
- Run every `checks[].run` of the component (default `npm run build`, `npm run lint`,
  `npm run test -- --run`) from the component path and fix failures. Report real results.

## 4. Review

When the checks pass, launch the core `cuadrilla:reviewer` agent on the feature's files and show
its blocking and important findings before calling the feature done. Suggest the core `qa`
agent for a browser pass of the flow (including a role without the permission).
