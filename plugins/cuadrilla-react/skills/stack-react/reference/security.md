# Frontend security

The frontend is untrusted by design: every rule here reduces exposure, but authorization and
validation always happen in the backend.

## XSS

- React escapes text by default; keep it that way. `dangerouslySetInnerHTML` is forbidden with
  any non-constant value. If rich HTML from users is a requirement, it is declared in the profile
  and sanitized with a vetted library (e.g. DOMPurify) in one shared component — never ad hoc.
- `href`/`src` built from data are validated: only `http:`/`https:` (and `mailto:` if needed);
  reject `javascript:` and `data:` URLs. External links: `target="_blank"` with
  `rel="noopener noreferrer"`.
- No `eval`, `new Function`, `setTimeout("string")`, or HTML string concatenation into the DOM.

## Tokens and data at rest

- Access token in memory, refresh token in an httpOnly cookie (see `auth.md`). Nothing sensitive
  in `localStorage`/`sessionStorage`/IndexedDB unless the profile declares it.
- Never log tokens, passwords, full API responses or personal data (`console.*`, error trackers).
- Logout clears in-memory state (token, user, cached resources).

## Configuration

- Every `VITE_*` variable is embedded in the public bundle: only public values (API URL, public
  site keys, feature flags). Secrets (API keys with write access, signing keys, passwords) live
  in the backend.
- `.env*` files with real values are not committed; `.env.example` documents names only.
- Production builds without public source maps unless the profile says otherwise.

## Transport and headers

- API base URL is `https://` outside local development.
- The hosting layer sends: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` (or CSP
  `frame-ancestors 'none'`), `Referrer-Policy: strict-origin-when-cross-origin`,
  `Permissions-Policy` with unused features disabled, `Strict-Transport-Security`.
  Templates: `templates/vercel.json`, `reference/deploy-static.md`.
- Content-Security-Policy is recommended once the app's origins are known, at least:
  `default-src 'self'; connect-src 'self' <api-origin>; img-src 'self' data:; style-src 'self'
  'unsafe-inline'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'`. Add it in the
  hosting config and test it in a preview deploy before production.

## Auth UX that must not leak

- Login errors show the backend's generic message (same for unknown user and wrong password).
- 403 responses show "not allowed" without revealing whether the resource exists.
- Hidden menu items or disabled buttons are UX, not access control.
- Never send fields the user cannot decide (ids of other users, roles, prices) just because the
  form had them; send only what the endpoint's request DTO declares.

## Dependencies

- New packages only with confirmation; prefer maintained packages with many users; check the
  license fits the project.
- `npm ci` in CI (lockfile only); `package-lock.json` always committed with `package.json`.
- `npm audit --omit=dev` before a deploy (`/cuadrilla:security-audit`, `/cuadrilla:deploy-check`);
  Dependabot groups weekly npm updates.

## Forbidden patterns (stop-check, from `component.json`)

axios outside `src/api/api.ts`, `../` imports, `fetch(`, `http(s)://` literals in `src/`,
`dangerouslySetInnerHTML` with non-constant data, tokens in `localStorage`, secret-looking
`VITE_*` names, `@ts-expect-error` / disabled `react-hooks` rules, native `window.alert/confirm/
prompt`. The core already blocks `any`, `@ts-ignore`, `as unknown as`, `console.log`, `.only/.skip`.
