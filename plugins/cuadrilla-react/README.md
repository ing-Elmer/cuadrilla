# cuadrilla-react

Stack pack for [cuadrilla](../cuadrilla): the frontend standard for **React + TypeScript (strict) +
Vite + Tailwind CSS v4 + react-router + axios**, with npm. It works with any cuadrilla backend pack
(`python-fastapi`, `dotnet`, `node-typescript`, `java-spring`) because all of them return the same
camelCase envelope `{ status, message, data, errors, meta }`.

```
/plugin install cuadrilla-react@cuadrilla
```

Requires the `cuadrilla` core plugin (installed automatically as a dependency). Then run
`/cuadrilla:adopt` in your project to register the React component in `.claude/cuadrilla.json` and
copy the templates you choose.

## What it adds

| Piece | Name | What it does |
|---|---|---|
| Agent | `cuadrilla-react:frontend-react` | Implements pages, components, hooks, services, routes and styles following the standard; stops and returns the API contract if an endpoint does not exist. |
| Skill (auto) | `cuadrilla-react:stack-react` | The standard. Loads automatically when Claude touches `*.tsx`, `*.jsx`, `vite.config.*` or `*.css`. |
| Skill (command) | `/cuadrilla-react:feature-react <Feature> <description>` | Plans the contract and file list, waits for OK, scaffolds the full feature with tests, runs the checks and the core reviewer. |

## What the standard enforces

- **Structure:** `src/{api, services, hooks, context, routes, pages, components/<Feature>,
  components/ui, helpers, types, utils}` with a one-way import direction
  (`pages/components → hooks → services → api`), enforced in CI by ESLint `no-restricted-imports`.
- **API access:** axios only in `src/api/api.ts`; REST paths only in `src/api/endpoints.ts`; base
  URL only from `VITE_API_URL`; services use `request<T>()`, which unwraps the envelope and throws a
  typed `ApiError` with field errors.
- **Auth:** access token in memory, refresh token in an httpOnly cookie, a single-flight refresh
  interceptor for concurrent 401s, `AuthContext` + `UserContext` (permissions from the backend,
  never from the JWT), and one permission gate shared by navigation and routes.
- **Shared UI:** `useAsyncResource`, `DataTable` (@tanstack/react-table), loading/empty/error
  states, `FormDialog`, `ConfirmDialog`, `toFormErrors` — built once, reused everywhere.
- **Styles:** Tailwind v4 CSS-first with `@theme` tokens (light/dark), no hard-coded colors.
- **Accessibility:** labels, keyboard and focus management, announced errors, jsx-a11y in lint.
- **Testing:** Vitest + Testing Library; mandatory tests for the refresh interceptor
  (concurrent 401s), `tokenStore` and `AuthContext`.
- **Tooling:** `tsc -b` in the build, ESLint flat config (typescript-eslint + react-hooks +
  jsx-a11y) + Prettier, `npm audit --omit=dev`.
- **Guardrails:** stop-check patterns for axios outside `api.ts`, `../` imports, `fetch(`,
  hard-coded URLs, `dangerouslySetInnerHTML`, tokens in `localStorage`, secret-looking `VITE_*`
  variables, `@ts-expect-error`, disabled hook rules and native browser dialogs (on top of the
  core's `any` / `@ts-ignore` / `console.log` checks).

## Component configuration

Added to `.claude/cuadrilla.json` by `/cuadrilla:adopt` (default path `frontend`):

| Field | Value |
|---|---|
| setup | `npm ci` |
| checks | `npm run build` (tsc -b + vite build) → `npm run lint` (eslint + prettier --check) → `npm run test -- --run` |
| format hook | `node node_modules/prettier/bin/prettier.cjs --write {file}` (no npx: ~10x faster) |
| lint hook | `eslint_d` (resident ESLint, ~0.2 s per file); falls back to `node node_modules/eslint/bin/eslint.js` if it is not installed |
| start | `npm run dev` on port 5173 |
| audit | `npm audit --omit=dev` |

## Templates

`ci-job.yml` (GitHub Actions job: checkout v7, setup-node v7 with `node-version-file`),
`eslint.config.js`, `vite.config.example.ts` (alias `@`, Tailwind plugin, Vitest), `vercel.json`,
`.nvmrc`, and `src-skeleton.md` — a verified implementation of the API client, refresh
interceptor, contexts, permission gate, `useAsyncResource` and the mandatory tests. Netlify,
nginx and IIS configs are in `reference/deploy-static.md`.

## Recommended third-party skills

Not bundled; install them yourself if you want them. The cuadrilla standard wins on conflicts.

| Skill | Install | Why | Ignore from it |
|---|---|---|---|
| `vercel-react-best-practices` (Vercel) | `npx skills add vercel-labs/agent-skills@vercel-react-best-practices` | React performance patterns | Next.js/server-component advice, SWR |
| `frontend-design` (Anthropic) | `npx skills add anthropics/skills@frontend-design` | Visual direction for new screens | Anything that bypasses `@theme` tokens or adds UI libraries |
| `web-design-guidelines` (Vercel) | `npx skills add vercel-labs/agent-skills@web-design-guidelines` | UI/accessibility review checklist | — (advisory) |
| `tailwind-design-system` (Seth Hobson) | `npx skills add wshobson/agents@tailwind-design-system` | Tailwind v4 tokens and variants | react-hook-form, zod, shadcn/ui, cva without asking |
| `webapp-testing` (Anthropic) | `npx skills add anthropics/skills@webapp-testing` | Playwright recipes for the core `qa` agent | Artifacts inside the repo |

Adding react-hook-form, zod, shadcn/ui, SWR/React Query or any other library is a project
decision: the agent asks first, and the profile records it as an exception.

## License

MIT — see the root [LICENSE](../../LICENSE).
