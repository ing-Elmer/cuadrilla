# API client: envelope, request<T>(), services, hooks

Code: `${CLAUDE_SKILL_DIR}/templates/src-skeleton.md` (`types/api.ts`, `api/api.ts`,
`services/ApiClient.ts`, `hooks/useAsyncResource.ts`, `utils/toFormErrors.ts`).

## The envelope (any cuadrilla backend)

```json
{ "status": "Success" | "Created" | "Error", "message": "…", "data": <T> | null,
  "errors": { "field": ["message"] } | null, "meta": { … } | null }
```

- camelCase everywhere; DTO types in `types/<feature>.ts` match the backend field by field.
- Validation failure → HTTP 400, `status: "Error"`, `errors` keyed by the camelCase field name.
- Domain errors carry their HTTP status (404, 409, 403…) with a user-facing `message`.
- `meta` carries pagination or extra info; type it per endpoint (e.g.
  `interface PageMeta { page: number; pageSize: number; totalItems: number; totalPages: number }`)
  after checking the backend pack's actual field names. Never guess them.

## Layers of a call

```
Page/Component → use<Feature>() → <Feature>Service.fn() → request<T>() → api (axios) → backend
```

| Piece | Responsibility | Must not |
|---|---|---|
| `api/endpoints.ts` | paths, `encodeURIComponent` on path params | build query strings by hand (use `params`) |
| `api/api.ts` | axios instances, auth header, refresh, timeout | know about features |
| `services/ApiClient.ts` | unwrap envelope, map every failure to `ApiError` | show UI, log tokens |
| `services/<Feature>Service.ts` | one typed function per endpoint, pass `signal` | catch errors to hide them, hold state |
| `hooks/use<Feature>.ts` | loading/error/data state, mutations + `reload()` | call axios, build URLs |
| components/pages | render states, forms | import services or api |

## Service shape

```ts
// services/CustomerService.ts
import { endpoints } from "@/api/endpoints";
import { request, requestWithMeta } from "@/services/ApiClient";
import type { CreateCustomerRequest, CustomerDto, CustomerFilters } from "@/types/customer";

export const CustomerService = {
  list: (filters: CustomerFilters, signal?: AbortSignal) =>
    requestWithMeta<CustomerDto[]>({ url: endpoints.customers.list, params: filters, signal }),
  getById: (id: number, signal?: AbortSignal) =>
    request<CustomerDto>({ url: endpoints.customers.byId(id), signal }),
  create: (body: CreateCustomerRequest) =>
    request<CustomerDto>({ method: "post", url: endpoints.customers.list, data: body }),
  remove: (id: number) => request<null>({ method: "delete", url: endpoints.customers.byId(id) }),
};
```

## Feature hook shape

```ts
// hooks/useCustomers.ts
export function useCustomers(filters: CustomerFilters) {
  const { page, pageSize, search } = filters;
  const loader = useCallback(
    (signal: AbortSignal) => CustomerService.list({ page, pageSize, search }, signal),
    [page, pageSize, search],
  );
  return useAsyncResource(loader); // { data: { data, meta }, isLoading, error, reload }
}
```

- `loader` is wrapped in `useCallback` with primitive dependencies (not a fresh object every
  render, or it refetches forever).
- Mutations: call the service in an event handler, show `toFormErrors(err)` on failure,
  `reload()` on success. Disable the submit button while the promise is pending.
- Search inputs are debounced (≈300 ms) before they reach the loader dependencies.

## Errors

- `ApiError.status`: HTTP status, `0` for network/timeout/cancel/non-envelope body.
- `ApiError.message`: backend message for 4xx; `GENERIC_ERROR_MESSAGE` for 5xx and unknown
  failures. Translate `GENERIC_ERROR_MESSAGE` to the profile's UI language.
- `ApiError.errors`: field errors (`{}` when none). `toFormErrors(err)` → `{ formError,
  fieldErrors }` with the first message per field.
- 401 after a failed refresh ends the session (see `auth.md`); 403 shows a "not allowed"
  message, never a crash.
- Never `console.log` errors or responses; `console.error` only for unexpected states, without
  tokens or personal data.

## Rules checkable in a diff

- No string path outside `endpoints.ts`; no `http(s)://` literal in `src/`.
- No `axios`/`fetch` outside `api/api.ts`.
- Every service function returns `Promise<T>` with an explicit DTO type (no `unknown`/`any` leaks
  to components).
- GET functions accept `signal`; hooks pass the one from `useAsyncResource`.
- Pagination/sorting/filtering are request params, not client-side over a full download.
- If the endpoint does not exist: stop and hand back the contract (method, path, request DTO,
  response `data` and `meta`, error cases, permission).
