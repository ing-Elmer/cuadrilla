# Testing — Vitest

Read before writing tests. Command: `npm run test -- --run` (CI and `/cuadrilla:verify`);
`npm run test` alone starts watch mode for local work.

## Layout and naming

```
test/
├── application/<feature>.service.test.ts
├── application/<feature>.validator.test.ts
├── api/<feature>.routes.test.ts
├── infrastructure/<feature>.repository.test.ts   (optional, ephemeral DB only)
└── fakes/                                         in-memory repositories, FakeTokenService, testConfig, silentLogger
```

- `describe("<Unit>")` or `describe("<Unit>.<method>")`; `it("<scenario> → <expected result>")`.
- Imports use the `.js` extension like source files. No Vitest globals: import
  `describe/it/expect` from `vitest`.
- No `.only`, `.skip`, `it.todo` left behind, no commented-out tests (core stop-check flags
  `.only/.skip`). Never delete or weaken an assertion to get green.

## Fakes over mocks

Services and validators are tested with **fakes** that implement the core interfaces:

```ts
export class InMemoryItemRepository implements ItemRepository {
  readonly items: ItemResponse[] = [];

  findById(id: number): Promise<ItemResponse | null> {
    return Promise.resolve(this.items.find((item) => item.id === id) ?? null);
  }

  existsByName(name: string): Promise<boolean> {
    return Promise.resolve(this.items.some((item) => item.name.toLowerCase() === name.toLowerCase()));
  }
  // list(), create() …
}
```

```ts
describe("ItemService", () => {
  let items: InMemoryItemRepository;
  let service: ItemService;

  beforeEach(() => {
    items = new InMemoryItemRepository();
    service = new ItemService({ items, validator: new ItemValidator(items), logger: silentLogger });
  });

  it("create with a duplicated name → ValidationError on name", async () => {
    await service.create({ name: "Pen", price: "1.50" }, user);
    const promise = service.create({ name: "pen", price: "2.00" }, user);
    await expect(promise).rejects.toBeInstanceOf(ValidationError);
    await expect(promise).rejects.toMatchObject({ errors: { name: [expect.any(String)] } });
  });
});
```

- A fake is a class implementing the interface, so the compiler catches drift. `vi.fn()` is for
  asserting an interaction (e.g. "email sender called once"), not for replacing a repository.
- Never `vi.mock()` our own modules to bypass the architecture; inject instead. `vi.mock` is
  acceptable only for third-party modules without an interface seam.
- Time and randomness come through injected interfaces (`Clock`, id generator) or
  `vi.useFakeTimers()`; no real `setTimeout` waits.
- Tests never touch a real database, network or cloud service, except optional repository tests
  against an ephemeral database.

## Routes with `inject()`

```ts
beforeEach(async () => {
  const items = new InMemoryItemRepository();
  const tokens = new FakeTokenService()
    .register("writer", { id: 1, username: "writer", permissions: ["ITEMS_READ", "ITEMS_CREATE"] })
    .register("reader", { id: 2, username: "reader", permissions: ["ITEMS_READ"] });
  app = await buildApp({
    config: testConfig,
    container: () => ({
      services: { items: new ItemService({ items, validator: new ItemValidator(items), logger: silentLogger }) },
      tokens,
      healthCheck: () => Promise.resolve(),
      close: () => Promise.resolve(),
    }),
  });
});

afterEach(async () => {
  await app.close();
});

it("POST without permission → 403", async () => {
  const response = await app.inject({
    method: "POST",
    url: "/api/items",
    headers: { authorization: "Bearer reader" },
    payload: { name: "Pen", price: "1.50" },
  });
  expect(response.statusCode).toBe(403);
  expect(response.json()).toMatchObject({ status: "Error", data: null });
});
```

Every new route file has, at minimum:
- 401 without token and 403 without the permission (for each permission code used);
- 400 with the `errors` map for an invalid body/query (assert the field keys);
- the success status (200/201) asserting the **full envelope** and camelCase keys;
- 404 (or the relevant domain error) for the main failure path.

`testConfig` is built with `parseConfig({...})` and fictitious values (`LOG_LEVEL: "silent"`);
tests never read `process.env` or a real `.env`.

## Mandatory from day one

- **Auth service:** login OK, wrong password, unknown user (same error as wrong password),
  inactive user, refresh rotation (old token revoked, new pair issued), reuse of a revoked
  refresh token (whole family revoked), expired refresh token.
- **Token service:** a token signed with another key, another algorithm (`alg: none`), another
  issuer/audience, or expired is rejected with `UnauthorizedError`.
- **Permissions:** 401/403 per protected route as above.
- **Every bug fix** ships a test that fails before the fix.
- New logic in a service or validator ships its tests in the same change.

## Repository tests (optional)

- Only against an ephemeral PostgreSQL: the CI job's `services: postgres` or Testcontainers
  (`@testcontainers/postgresql`, only if the profile allows the dependency).
- Each test file creates its schema from the scripts folder and drops it; never a shared or
  developer database.
