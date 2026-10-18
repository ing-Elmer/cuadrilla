# Auth, session and permissions

Code: `${CLAUDE_SKILL_DIR}/templates/src-skeleton.md` (`tokenStore.ts`, `api.ts`,
`AuthService.ts`, `AuthContext.tsx`, `UserContext.tsx`, `access.ts`, `appRoutes.ts`,
`PrivateRoute.tsx`) and their tests.

## Token storage

| Token | Where | Why |
|---|---|---|
| Access token (short-lived JWT) | module memory in `api/tokenStore.ts` | not readable after the tab closes; not in web storage |
| Refresh token (rotating) | httpOnly, `Secure`, `SameSite` cookie set by the backend on login/refresh | JavaScript never sees it |

- Requests that need the cookie use `withCredentials: true` (set on both axios instances).
- Frontend and API on different sites (e.g. `*.vercel.app` → `*.railway.app`) need
  `SameSite=None; Secure` on the cookie and CORS with the explicit frontend origin and
  `allowCredentials`. Prefer serving both under one registrable domain (`app.example.com` +
  `api.example.com`) so `SameSite=Lax` works.
- Exception (declare it in the profile): if the backend returns the refresh token in the body,
  only `tokenStore.ts` may persist it, and the `localStorage` forbidden pattern is adjusted in
  `.claude/cuadrilla.json` consciously.

## Refresh flow (api.ts)

1. Request interceptor adds `Authorization: Bearer <access>` when there is a token.
2. Response 401 → if the request was already retried, reject (no loops).
3. Otherwise `refreshAccessToken()`: a single in-flight promise shared by every concurrent 401.
4. Success → new token stored, each original request retried once with it.
5. Failure → `tokenStore.clear()`; `AuthContext` (subscribed) becomes `anonymous`;
   `PrivateRoute` redirects to `/login` keeping `from` to return after login.
6. `refresh` and `login` go through `publicApi` (no interceptor): a wrong password is a normal
   400/401 error, never a refresh.

## AuthContext vs UserContext

- `AuthContext`: `status` (`loading` | `authenticated` | `anonymous`), `login`, `logout`.
  On mount it calls `refreshAccessToken()` to restore the session from the cookie.
  `logout()` calls the backend (revokes the refresh token) and clears `tokenStore` even if the
  call fails.
- `UserContext`: the current user from `GET me` (id, name, roles, permissions), loaded when
  `status` becomes `authenticated`; `can(rule)`. Roles and permissions are **never** decoded from
  the JWT on the client.
- Contexts expose memoized values (`useMemo`/`useCallback`) and a `useX()` hook that throws
  outside its provider.

## The permission gate

- `canAccess(user, { permission?, roles? })` in `routes/access.ts` is the only place that
  evaluates access. `permission` = the user must have it; `roles` = any of them.
- `routes/appRoutes.ts` declares each authenticated page once with its `rule`; the navigation and
  the router both read that entry. Buttons for actions (edit, delete) use `can({ permission })`
  from `useUser()` with the backend's permission codes.
- Hiding is UX only: every endpoint is authorized by the backend. Never rely on a hidden button
  for security; never send role or permission values from the client.
- Permission codes and roles come from the project profile / backend; do not invent them.

## Mandatory tests

- `api.test.ts`: concurrent 401s → exactly one refresh, all requests retried with the new token;
  refresh failure → token cleared and original 401 rejected; second 401 after retry → no loop.
- `tokenStore.test.ts`: in-memory get/set/clear, subscribers notified, unsubscribe works, no web
  storage writes.
- `AuthContext.test.tsx`: bootstrap success/failure, login sets authenticated, logout clears
  token even if the server call fails, token cleared by the api layer → anonymous.
- `access.ts`: permission, roles, both, anonymous user.
