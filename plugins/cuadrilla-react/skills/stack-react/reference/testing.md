# Testing (Vitest + Testing Library)

## Setup

- Dev dependencies: `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/dom`,
  `@testing-library/jest-dom`, `@testing-library/user-event` (`@vitest/coverage-v8` for coverage).
- Config in `vite.config.ts > test` (`environment: "jsdom"`, `setupFiles`, `restoreMocks`,
  `env.VITE_API_URL` dummy). Setup in `src/test/setup.ts` (`@testing-library/jest-dom/vitest`,
  `cleanup`).
- Run once: `npm run test -- --run` (CI and `/cuadrilla:verify`).
- Test files next to the code: `<file>.test.ts(x)`. Shared helpers (`renderWithProviders`,
  DTO builders) in `src/test/`.

## Mandatory

| Area | Cases |
|---|---|
| `api/api.ts` interceptor | concurrent 401s → one refresh, all retried with the new token; refresh failure → token cleared, original 401 rejected; still 401 after retry → rejected, no loop; no refresh for `publicApi` calls |
| `api/tokenStore.ts` | get/set/clear, subscribe/unsubscribe, no web-storage writes |
| `context/AuthContext.tsx` | bootstrap success/failure, login, logout (clears even if server fails), token cleared externally → anonymous |
| `services/ApiClient.ts` | unwraps `data`; `status: "Error"` → `ApiError` with `errors`; 5xx → generic message; non-envelope body → generic |
| `routes/access.ts` | permission, roles, both, anonymous |
| Every new hook / mapper / util | happy path + error path in the same change |
| Every bug fix | a test that fails before the fix |

Reference implementations of the first four: `${CLAUDE_SKILL_DIR}/templates/src-skeleton.md`.

## How

- **Never** hit a real backend. Two seams:
  - Low level (api/ApiClient tests): replace `api.defaults.adapter` / `publicApi.defaults.adapter`
    with a fake adapter that returns envelopes or throws `AxiosError` with a response. Restore it
    in `afterEach`. These tests are the only ones allowed to import `axios`.
  - Everything above: `vi.mock("@/services/CustomerService")` and drive the hook/component
    through the mocked service (`vi.mocked(CustomerService.list).mockResolvedValue(...)`).
- Hooks and contexts: `renderHook(() => useX(), { wrapper })`; wrap state changes in `act`; use
  `waitFor` for async results, not timers.
- Components: query by role and accessible name (`getByRole("button", { name: /save/i })`,
  `getByLabelText`), interact with `userEvent.setup()`. No queries by class name or test id when
  a role exists — this also tests accessibility.
- Assert the three states for data views (loading, empty, error with retry) and that backend
  field errors appear next to the right field.
- Pages that use routing: render inside `createMemoryRouter` + `RouterProvider` with the
  providers they need.
- Name tests as behaviour: `it("shows field errors returned by the API")`.
- No `.only`, `.skip`, `it.todo` left behind, no snapshot tests of whole pages, no commented-out
  tests to make the build pass.

## End to end

Browser flows (login, navigation, permissions by role, keyboard pass) belong to the core `qa`
agent with Playwright against the running app (`start` in `.claude/cuadrilla.json`); screenshots go
to the session scratchpad, never into the repo.
