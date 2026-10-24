---
name: standard-testing
description: Testing rules of the cuadrilla standard for any stack — what must be tested, how (fakes, API tests, auth tests), naming, and what is never allowed (skipping or deleting tests). Load before writing, changing or reviewing tests or logic that needs them.
user-invocable: false
---

# cuadrilla — testing (any stack)

The pack names the tools (pytest, xUnit, Vitest, JUnit…); these duties are the same everywhere.

## Mandatory
- Every service and every business validator has unit tests, using **fakes** that implement
  the repository interface (or the stack's mocking library) — never a shared or real database,
  never the cloud.
- API tests for each endpoint group with the framework's in-memory test client: status code,
  envelope shape and **permissions** (401 without a token, 403 without the permission).
- **From day one:** authentication tests — login, password verification, token issuing,
  refresh rotation, reuse of a revoked refresh token, inactive user.
- Frontend: the API client's refresh interceptor (several concurrent 401s), token storage and
  the auth context/provider.
- Every fixed bug gets a test that reproduces it first.
- New logic in a service, validator, hook or shared utility ships with tests in the same change.

## How
- Test name says method, scenario and expected result (stack idiom).
- Arrange/act/assert; one behaviour per test; no logic (loops/ifs) inside tests.
- Test behaviour, not implementation details; a test should fail if the bug came back.
- No dependence on time, order or randomness: inject clocks and seeds.
- Repository tests (optional) only against an ephemeral database (containers or the CI
  `services:` database), never a shared one.

## Never
- Delete, comment out, skip, mark expected-failure or focus (`only`) tests to get the build
  green.
- Weaken assertions so a failing test passes.
- Hit production services or real third-party APIs from tests.
