# Structure, naming and project setup

## Folder contract

```
<path>/                      component root (profile: usually frontend/)
├── .nvmrc                   Node LTS major (CI reads it via node-version-file)
├── package.json             npm scripts below; package-lock.json committed
├── index.html
├── vite.config.ts           alias @ → src, Tailwind plugin, Vitest config under "test"
├── eslint.config.js         flat config with the layer rules
├── .prettierrc.json         Prettier options (keep them minimal)
├── tsconfig.json            references tsconfig.app.json + tsconfig.node.json
├── .env.example             every VITE_* variable, no real values
├── vercel.json | netlify.toml | web.config   per deploy target (profile)
└── src/
    ├── main.tsx             createRoot + providers + RouterProvider; imports @/index.css
    ├── index.css            @import "tailwindcss"; tokens; the only hand-written CSS
    ├── vite-env.d.ts        typed ImportMetaEnv
    ├── api/                 api.ts, endpoints.ts, tokenStore.ts
    ├── services/            ApiClient.ts, <Feature>Service.ts
    ├── hooks/               useAsyncResource.ts, use<Feature>.ts
    ├── context/             AuthContext.tsx, UserContext.tsx (ThemeContext.tsx if dark mode toggle)
    ├── routes/              router.tsx, appRoutes.ts, access.ts, PrivateRoute.tsx, PublicRoute.tsx
    ├── pages/<Feature>/     <Feature>Page.tsx (+ <Feature>DetailPage.tsx …)
    ├── components/<Feature>/  feature UI (forms, columns, cards)
    ├── components/ui/       DataTable, LoadingState, EmptyState, ErrorState, FormDialog,
    │                        ConfirmDialog, FormField, SelectField, Button, Toast
    ├── components/layout/   AppShell, Sidebar, Header (navigation reads appRoutes + canAccess)
    ├── helpers/<Feature>/   mappers.ts (DTO ↔ UI model) only when shapes differ
    ├── types/               api.ts (envelope), <feature>.ts (DTOs)
    ├── utils/               pure functions: toFormErrors.ts, format.ts
    └── test/                setup.ts and shared test utilities (renderWithProviders)
```

Import direction (enforced by `eslint.config.js`): `pages`/`components` → `hooks` →
`services` → `api`. `components/ui` knows nothing about features or data fetching.

## Naming

| Thing | Convention | Example |
|---|---|---|
| Component / page file | `PascalCase.tsx`, named export same as file | `CustomersPage.tsx` → `export function CustomersPage` |
| Hook | `useCamelCase.ts` | `useCustomers.ts` |
| Service | `<Feature>Service.ts`, object of functions named by intent | `CustomerService.list/getById/create/update/remove` |
| Types | `types/<feature>.ts`; DTO names mirror the backend | `CustomerDto`, `CreateCustomerRequest` |
| Endpoints | `endpoints.<domain>.<action>`; ids via functions with `encodeURIComponent` | `endpoints.customers.byId(id)` |
| Tests | next to the file, `<file>.test.ts(x)` | `useCustomers.test.ts` |
| Routes | kebab-case URLs | `/purchase-orders/:id` |

Default exports only where a tool requires them (`vite.config.ts`, `eslint.config.js`,
`React.lazy` targets may re-export).

## tsconfig.app.json (essential options)

```jsonc
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "types": ["vite/client"],
    "jsx": "react-jsx",
    "verbatimModuleSyntax": true,
    "noEmit": true,
    "skipLibCheck": true,
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "erasableSyntaxOnly": true,
    "paths": { "@/*": ["./src/*"] }   // no baseUrl (deprecated in TS 6)
  },
  "include": ["src"]
}
```

`tsconfig.node.json` covers `vite.config.ts` with `"types": ["node"]`. `tsc -b` (in `npm run build`)
type-checks both, including test files.

## package.json scripts (the contract with component.json and CI)

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "lint": "eslint . && prettier --check .",
    "format": "prettier --write .",
    "test": "vitest"
  }
}
```

`npm run test -- --run` runs once (CI, `/cuadrilla:verify`); `npm run test` watches locally.
`.prettierignore`: `dist`, `coverage`, `package-lock.json`.

## Routing (react-router, data/library mode)

- One `router.tsx` with `createBrowserRouter`; `main.tsx` renders `<RouterProvider>` inside
  `AuthProvider` → `UserProvider`.
- Authenticated pages are declared once in `routes/appRoutes.ts` (`path`, `label`, `rule`,
  `inNavigation`). The navigation shows `Object.values(appRoutes).filter(r => r.inNavigation && can(r.rule))`;
  the router wraps the page as `<PrivateRoute rule={appRoutes.customers.rule}>`. Never write a
  permission string twice.
- Pages are lazy-loaded (`lazy` route property or `React.lazy`) once the app has more than a
  handful of them.
- Public pages (`/login`, `/forbidden`, not found) go through `PublicRoute` / plain routes. The
  router has an `errorElement` that shows a generic message.
- URL state that must survive reload or be shareable (filters, page, tab) lives in search params.

## Feature checklist (what "complete" means)

1. `types/<feature>.ts` — DTOs aligned with the backend contract.
2. `api/endpoints.ts` — the feature's paths.
3. `services/<Feature>Service.ts` — one function per endpoint via `request<T>()`.
4. `hooks/use<Feature>.ts` — on `useAsyncResource`, plus mutation helpers that `reload()`.
5. `components/<Feature>/` — form, table columns, cards (using `components/ui`).
6. `pages/<Feature>/<Feature>Page.tsx` — loading/empty/error states.
7. `routes/appRoutes.ts` entry + route in `router.tsx` behind `PrivateRoute`.
8. Tests for the hook, mappers and any non-trivial component logic.
