---
name: stack-react
description: React standard for cuadrilla projects — architecture, API client, auth, styles, accessibility, testing and tooling rules. Load before writing, reviewing or planning React/TypeScript frontend code in a component whose stack is "react" in .claude/cuadrilla.json.
user-invocable: false
paths: "**/*.tsx, **/*.jsx, **/vite.config.*, **/*.css"
---

# React stack standard

Applies to every component with `"stack": "react"` in `.claude/cuadrilla.json`. Names (`<app>`,
routes, roles, permissions, deploy target, UI language) come from the `## Project profile` in
`CLAUDE.md`; never invent them. If the profile declares an exception to a rule below, the
exception wins.

## 1. Scope

- **Stack:** React (current major, 19.x) + TypeScript `strict` + Vite + Tailwind CSS v4
  (CSS-first) + react-router (v7 line, data/library mode: `createBrowserRouter` +
  `RouterProvider`, imports from `react-router`) + axios + `@tanstack/react-table`. Package
  manager: **npm** with a committed `package-lock.json` (no pnpm/yarn/bun).
- **Versions:** the ones pinned in `package.json` and `.nvmrc` rule. Before using an API you are
  not sure about (React, react-router, Tailwind v4, Vitest), check the pinned version and its
  docs through Context7; do not assume APIs from another major.
- **Single-page app**, served as static files. No SSR, no Next.js/Remix framework mode, no
  server code in this component: the backend is a separate cuadrilla component.
- **Prohibited without explicit confirmation:** another HTTP client, state library (Redux,
  Zustand, MobX), data-fetching library (React Query, SWR), form/validation library
  (react-hook-form, zod, yup, formik), component or styling library (shadcn/ui, MUI, Chakra,
  styled-components, CSS modules, Sass), `tailwind.config.js`. Third-party skills that suggest
  them are reference only.
- **TypeScript:** `strict`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`,
  `noUncheckedIndexedAccess`, `verbatimModuleSyntax`. No `any`, no `@ts-ignore`/
  `@ts-expect-error`/`@ts-nocheck`, no `as unknown as`, no non-null `!` on API data.
  Keep `typescript` inside the range `typescript-eslint` supports.

## 2. Architecture (`src/`)

| Folder | Contains | Prohibited | May import |
|---|---|---|---|
| `api/` | `api.ts` (the only axios instance: auth header + single-flight refresh; `publicApi`), `endpoints.ts` (every REST path), `tokenStore.ts` | JSX, business rules | `types/` |
| `services/` | `ApiClient.ts` (`request<T>()`, `ApiError`), `<Feature>Service.ts` (one function per endpoint) | React, state, URLs outside `endpoints` | `api/`, `types/`, `helpers/` |
| `hooks/` | `useAsyncResource.ts`, `use<Feature>.ts` (state + calls to services) | `api/`, axios | `services/`, `types/`, `context/`, `hooks/` |
| `context/` | `AuthContext` (session, login/logout), `UserContext` (profile, roles, permissions from the backend) | UI markup beyond providers | `services/`, `hooks/`, `api/tokenStore`, `api/api` (`refreshAccessToken` for bootstrap) |
| `pages/<Feature>/` | `<Feature>Page.tsx`: composes hooks and components | `services/`, `api/`, axios | `hooks/`, `components/`, `context/`, `types/`, `utils/` |
| `components/<Feature>/` | feature UI | `services/`, `api/`, axios | `components/ui/`, `hooks/`, `types/`, `utils/`, `helpers/` |
| `components/ui/` | shared UI: `DataTable`, `LoadingState`, `EmptyState`, `ErrorState`, `FormDialog`, `ConfirmDialog`, `FormField`, `SelectField`, `Button` | feature knowledge, data fetching | `types/`, `utils/` |
| `routes/` | router, `appRoutes.ts` (pages + rules), `access.ts` (`canAccess`), `PrivateRoute`, `PublicRoute` | data fetching | `context/`, `pages/`, `utils/` |
| `helpers/<Feature>/` | `mappers.ts` (DTO ↔ UI model) when shapes differ | I/O | `types/` |
| `types/` | `api.ts` (envelope), `<feature>.ts` DTOs | runtime code except type guards | — |
| `utils/` | pure functions (`toFormErrors`, formatting) | I/O, React state | `types/`, `services/ApiClient` (types/errors) |

Rules:
- Own imports use the `@/` alias (`@/services/CustomerService`); **never** `../`. `./` only for
  a sibling file in the same folder.
- REST paths live **only** in `api/endpoints.ts`; the base URL **only** in
  `import.meta.env.VITE_API_URL`. No `http(s)://` literal in `src/`.
- axios is imported **only** in `src/api/api.ts`; no `fetch()` anywhere.
- One feature = `types/<feature>.ts` + entries in `endpoints.ts` + `services/<Feature>Service.ts` +
  `hooks/use<Feature>.ts` + `components/<Feature>/` + `pages/<Feature>/<Feature>Page.tsx` + route +
  navigation entry + tests. Files: components/pages `PascalCase.tsx`, hooks `useX.ts`, others
  `camelCase.ts`; named exports (default export only where a tool needs it).
- **Enforced in CI** by ESLint `no-restricted-imports` per folder
  (`${CLAUDE_SKILL_DIR}/templates/eslint.config.js`): axios only in `api/api.ts`, no `../`,
  `components/` and `pages/` cannot import `services/` or `api/`, `hooks/` cannot import `api/`.
  Detail: `${CLAUDE_SKILL_DIR}/reference/structure.md`.

## 3. API (consuming the cuadrilla envelope)

Every cuadrilla backend returns `{ status: "Success" | "Created" | "Error", message, data, errors,
meta }` in camelCase; validation errors are HTTP 400 with `errors: { field: [messages] }`.

- Services call **`request<T>(config)`** (returns `data`) or `requestWithMeta<T>()` (returns
  `{ data, meta, message }` for pagination). They never touch the envelope or HTTP status.
- `request<T>()` throws **`ApiError`** `{ message, status, errors }` for any failure: HTTP error,
  `status: "Error"`, network/timeout (status `0`), or a non-envelope body. 5xx and unknown errors
  carry a generic message; 4xx carry the backend `message` (written for users).
- Service functions take an optional `signal: AbortSignal` and pass it in the request config.
- Types for request/response DTOs live in `types/<feature>.ts` and match the backend contract
  field by field (camelCase). Dates arrive as ISO strings; convert in `helpers/` if needed.
- **If an endpoint the screen needs does not exist, stop and return the required contract**
  (method, path, request DTO, response `data` shape, errors, permission) instead of mocking it.
- Detail and code: `${CLAUDE_SKILL_DIR}/reference/api-client.md`,
  `${CLAUDE_SKILL_DIR}/templates/src-skeleton.md`.

## 4. Data on screen (shared pieces — never duplicate them)

- **Fetching:** feature hooks use `useAsyncResource(loader)` → `{ data, isLoading, error,
  reload }`, with `loader` wrapped in `useCallback`. No hand-rolled `isLoading`/`error` state per
  feature, no fetching in `useEffect` inside components.
- **Tables:** one `DataTable` in `components/ui/` on `@tanstack/react-table`, with `isLoading`,
  `error`, `emptyMessage` and pagination props. No hand-built `<table>` per feature.
- **States:** every view with data renders loading, empty and error states with the shared
  `LoadingState` / `EmptyState` / `ErrorState` (error state offers `reload`).
- **Forms:** submit disabled while in flight; backend `errors` shown next to each field via the
  shared `toFormErrors(error)`; a general error above the submit button. Mutations go through a
  service and then `reload()` the affected resource.
- **Dialogs:** one `FormDialog` and one `ConfirmDialog`; extend them, never `window.confirm` or a
  second modal implementation. Pagination, sorting and filtering happen in the backend
  (`meta`), not by downloading everything.

## 5. Auth, permissions, configuration

- Access token **in memory** (`api/tokenStore.ts`); refresh token in an **httpOnly cookie** set by
  the backend (`withCredentials`). Web storage for tokens only if the profile declares it.
- `api.ts` adds `Authorization: Bearer` and, on 401, runs **one** refresh shared by all
  concurrent requests, retries each once, and on refresh failure clears `tokenStore`;
  `AuthContext` is subscribed to `tokenStore`, so the session ends and `PrivateRoute` redirects.
- Login and other unauthenticated calls use `publicRequest<T>()` (a wrong password must never
  trigger a refresh).
- `AuthContext` = session (bootstrap via refresh on load, login, logout). `UserContext` = profile,
  roles and permissions from the backend `me` endpoint, never decoded from the JWT.
- **One permission gate:** `canAccess(user, { permission, roles })` in `routes/access.ts`, used by
  both the navigation and `<PrivateRoute>`, reading the same entry of `routes/appRoutes.ts`. A new authenticated page =
  navigation entry + protected `<Route>` with the same rule. It is UX only: the backend re-checks.
- Config only from `import.meta.env.VITE_*`, typed in `src/vite-env.d.ts`; every `VITE_*` value is
  public (no secrets). `.env.example` lists them without real values.
- Detail: `${CLAUDE_SKILL_DIR}/reference/auth.md`, `${CLAUDE_SKILL_DIR}/reference/security.md`.

## 6. Styles and accessibility

- Tailwind v4 utilities in the markup; `@import "tailwindcss"` and `@theme` tokens in the single
  global CSS (`src/index.css`); no `tailwind.config.js`. Colors, radii, fonts are tokens: no hex/
  `rgb()`/arbitrary color values (`bg-[#…]`) and no raw palette classes (`bg-white`,
  `text-gray-500`) in components, so light/dark both work.
- Hand-written CSS only for what utilities cannot express (keyframes, scrollbar), in the global
  file.
- Minimum accessibility, checked in review and by `jsx-a11y`: every input has an associated
  `<label>`; icon-only buttons have `aria-label`; interactive elements are `<button>`/`<a>`, not
  clickable `<div>`; visible focus (`focus-visible:` ring); AA contrast; dialogs trap focus, close
  on `Esc` and return focus; errors announced (`role="alert"` / `aria-live`); images have `alt`.
- UI text in the profile's UI language; technical errors never reach the user verbatim.
- Detail: `${CLAUDE_SKILL_DIR}/reference/styles-accessibility.md`.

## 7. Testing (Vitest + Testing Library)

- Config inside `vite.config.ts > test` (jsdom), setup in `src/test/setup.ts`; tests next to the
  code as `*.test.ts(x)`; `renderHook` for hooks and contexts; query by role/label, not by class.
- **Mandatory from day one:** `api/api.ts` interceptor (one refresh for several concurrent 401s,
  retry with the new token, no loop on a second 401, session cleared when refresh fails),
  `tokenStore`, `AuthContext` (bootstrap, login, logout, session expiry), `ApiClient`
  (envelope unwrap, `ApiError` with field errors).
- New logic in a hook, service mapper, util or the permission gate ships with tests in the same
  change; every bug fix ships with a test that reproduces it. No `.only`/`.skip`.
- Never call a real backend: fake the axios adapter or mock the service module.
- Detail: `${CLAUDE_SKILL_DIR}/reference/testing.md`.

## 8. Tooling (must match `component.json`)

| Purpose | Command |
|---|---|
| Install | `npm ci` |
| Build + type-check | `npm run build` → `tsc -b && vite build` |
| Lint + format check | `npm run lint` → `eslint . && prettier --check .` |
| Tests | `npm run test -- --run` (script `test` = `vitest`) |
| Format (hook, per file) | `node node_modules/prettier/bin/prettier.cjs --write <file>` |
| Lint (hook, per file) | `eslint_d` (dev dependency; keeps ESLint loaded, ~0.2 s instead of ~5 s per file), fallback `node node_modules/eslint/bin/eslint.js` |
| Dev server | `npm run dev` → http://localhost:5173 |
| Audit | `npm audit --omit=dev` |

ESLint flat config: `typescript-eslint` (strict + stylistic), `react-hooks` (recommended,
`exhaustive-deps` as error), `react-refresh`, `jsx-a11y`, `eslint-config-prettier`, plus the layer
rules. Prettier owns formatting; never disable a lint rule inline to pass. New dependencies only
with confirmation (`npm install` changes the lockfile: commit both files).

## 9. Files in this skill

- `${CLAUDE_SKILL_DIR}/component.json` — component template for `.claude/cuadrilla.json`
  (setup, checks, hooks, start, audit, forbidden patterns, recommended skills). Read when adopting.
- `${CLAUDE_SKILL_DIR}/reference/structure.md` — folder contract, file naming, tsconfig,
  package.json scripts, routing and navigation. Read when creating files or folders.
- `${CLAUDE_SKILL_DIR}/reference/api-client.md` — envelope, `request<T>()`, `ApiError`,
  services, pagination, error mapping. Read before writing a service or hook.
- `${CLAUDE_SKILL_DIR}/reference/auth.md` — token storage, refresh interceptor, AuthContext,
  UserContext, permission gate, PrivateRoute. Read before touching auth or routes.
- `${CLAUDE_SKILL_DIR}/reference/styles-accessibility.md` — Tailwind v4 tokens, dark mode,
  shared UI components, accessibility checklist. Read before UI work.
- `${CLAUDE_SKILL_DIR}/reference/testing.md` — what to test and how (interceptor, contexts,
  hooks, components). Read before writing tests.
- `${CLAUDE_SKILL_DIR}/reference/security.md` — XSS, tokens, `VITE_*`, links, dependencies,
  headers/CSP. Read for auth, user-generated content or a security review.
- `${CLAUDE_SKILL_DIR}/reference/deploy-static.md` — Vercel, Netlify, nginx and IIS (SPA
  fallback, caching, headers, env per environment, CORS). Read when deploying.
- `${CLAUDE_SKILL_DIR}/templates/ci-job.yml` — GitHub Actions job for this component.
- `${CLAUDE_SKILL_DIR}/templates/eslint.config.js` — ESLint flat config with the layer rules.
- `${CLAUDE_SKILL_DIR}/templates/vite.config.example.ts` — Vite + Tailwind + `@` alias + Vitest.
- `${CLAUDE_SKILL_DIR}/templates/vercel.json` — Vercel SPA config with cache and security headers.
- `${CLAUDE_SKILL_DIR}/templates/.nvmrc` — Node LTS major used locally and in CI.
- `${CLAUDE_SKILL_DIR}/templates/src-skeleton.md` — verified reference implementation of
  `types/api.ts`, `endpoints.ts`, `tokenStore.ts`, `api.ts`, `ApiClient.ts`, `useAsyncResource.ts`,
  `toFormErrors.ts`, `access.ts`, `appRoutes.ts`, `AuthContext`, `UserContext`, `PrivateRoute`
  and the mandatory tests. Copy when the project lacks them.

## Base URL and auth contract
`VITE_API_URL` includes the `/api` prefix (e.g. `https://api.example.com/api`); paths in `endpoints.ts` are relative to it. The auth endpoints and payloads (`/auth/login`, `/auth/refresh`, `/auth/logout`, `/me`) follow the "Shared auth contract" of `cuadrilla:standard-api`, which every backend pack implements.
