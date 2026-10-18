---
name: standard-api
description: HTTP API contract of the cuadrilla standard for any backend stack — the response envelope, camelCase, error mapping, validation errors, auth by default, pagination and health check. Load before designing, implementing, consuming or reviewing an HTTP endpoint.
user-invocable: false
---

# cuadrilla — HTTP API contract (any stack)

Every backend pack implements exactly this contract, so any frontend works with any backend.

## Envelope (mandatory)
```json
{ "status": "Success | Created | Error", "message": "text", "data": {}, "errors": { "field": ["msg"] }, "meta": {} }
```
- One generic envelope type with constructors: ok(message, data), created(message, data),
  success(message), badRequest(message, errors), error(message).
- Every endpoint returns the envelope and declares its typed `data` in the OpenAPI schema. Never
  return a bare DTO, a raw dict/map or a hand-built JSON response.
- JSON in **camelCase**; dates in ISO-8601 UTC; money as decimal strings or integer minor units
  (declared in the profile), never binary floats.
- `meta` carries pagination: `{ "page", "pageSize", "total" }` or a cursor `{ "next" }`.

## Errors
- Domain errors **declare** their HTTP status (403, 404, 409, 422…) as part of their type.
- **One** central handler translates errors: shape validation → 400 with
  `errors = { field: [messages] }` (not the framework's default 422/ProblemDetails shape unless
  mapped into the envelope); business validation → 400; unauthenticated → 401; domain error →
  its status; anything else → 500 with a generic message (logged with the stack trace; the
  client never sees details).
- Controllers/routes have **no try/catch** and don't build error responses.

## Endpoints
- Thin: path, inputs, dependencies, call one service method, wrap the result.
- Authenticated **by default** (router/controller level). Every anonymous endpoint has a comment
  justifying it; endpoints that create users or credentials are never anonymous.
- Permission per endpoint with the declarative mechanism and a permission code.
- Routes under `/api/...` grouped by domain, nouns in plural, verbs from HTTP methods; list
  endpoints are paginated and bounded (max page size).
- Idempotent `PUT`/`DELETE`; `POST` that may be retried accepts an idempotency key when the
  operation has side effects (payments, emails).
- Every endpoint the frontend consumes is added to the frontend's endpoint registry in the same
  change.

## Shared auth contract (every backend pack exposes it; every frontend consumes it)
The API base is `<origin>/api`; frontends configure their base URL **including** `/api`
(e.g. `VITE_API_URL=https://api.example.com/api`) and use paths relative to it.

| Method + path | Auth | Request | `data` in the envelope |
|---|---|---|---|
| `POST /api/auth/login` | anonymous, rate-limited | `{ "username", "password" }` | `{ "accessToken", "expiresIn" }` + refresh token in an `HttpOnly; Secure; SameSite` cookie |
| `POST /api/auth/refresh` | refresh cookie | — | `{ "accessToken", "expiresIn" }` + rotated refresh cookie |
| `POST /api/auth/logout` | refresh cookie | — | `null` (refresh token revoked, cookie cleared) |
| `GET /api/me` | access token | — | `{ "id", "username", "displayName", "roles": [], "permissions": [] }` |

- Access token sent as `Authorization: Bearer <token>`; short-lived (≈ 15 min).
- Failed login → 401 with a generic message (no account enumeration). Refresh failure → 401 and
  the frontend logs out.
- Roles and permissions for the UI come from `/api/me`, not from decoding the token.
- A project with an external identity provider declares the difference in its profile
  "Exceptions to the standard".

## Operations
- `GET /health` anonymous, cheap, checks the main DB connection.
- CORS with explicit origins from configuration; never `*` with credentials or in production.
- API docs (OpenAPI/Swagger UI) disabled or protected in production.
