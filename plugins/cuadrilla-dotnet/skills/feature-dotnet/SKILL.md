---
name: feature-dotnet
description: Scaffold a complete .NET feature (all layers + tests) following the cuadrilla standard.
argument-hint: "<FeatureName> <short description>"
disable-model-invocation: true
---

Create the .NET feature: **$ARGUMENTS**

Delegate the implementation to the `cuadrilla-dotnet:backend-dotnet` agent. It takes `<App>`, the
component path, engine, `<SCHEMA>`, `<PREFIX>_`, connection name, data library and scripts folder
from the `## Project profile` of `CLAUDE.md` and the component from `.claude/cuadrilla.json`.

## 1. Plan first — wait for OK

Before writing any file, show:

1. **The file list** (paths relative to the component), using the project's existing names when
   they differ from these defaults:
   - **Core:** `src/<App>.Core/DTOs/<Feature>/<Feature>Request.cs` (and `Create…`/`Update…`
     variants if needed), `<Feature>Response.cs`, `src/<App>.Core/Interfaces/I<Feature>Repository.cs`,
     new `DomainException` subclasses in `src/<App>.Core/Exceptions/` if needed.
   - **Infrastructure:** `src/<App>.Infrastructure/Repositories/<Feature>Repository.cs`
     (Dapper + `CommandDefinition`; or EF Core if the profile declares it), DI registration in
     `DependencyInjection.cs`.
   - **Application:** `src/<App>.Application/Interfaces/I<Feature>Service.cs`,
     `Services/<Feature>Service.cs`, `Validators/<Feature>RequestValidator.cs`, DI registration.
   - **Api:** `src/<App>.Api/Controllers/<Feature>Controller.cs` (or an endpoint group if the
     profile uses minimal APIs), permission constants + policies in `Security/Permissions.cs`.
   - **Tests:** `tests/<App>.Tests/<Feature>/<Feature>ServiceTests.cs`,
     `<Feature>RequestValidatorTests.cs`; `tests/<App>.IntegrationTests/<Feature>/<Feature>EndpointsTests.cs`
     (success, 400, 401, 403, 404).
   - **SQL (only if the schema changes):** `NNN_create_<feature>.sql` (next free number in the
     profile's scripts folder) — written, never executed.
   - **Frontend contract (if the repo has a frontend endpoint list):** the new routes.
2. **The endpoint contract:** for each endpoint — method, route, policy, request body/query,
   response `data` shape inside the `ApiResponse<T>` envelope, status codes and error cases.
3. **Open questions** (missing profile values, ambiguous rules).

Stop and wait for the user's OK or corrections. Do not create files before that.

## 2. Implement

After the OK, the agent implements every layer and the tests in one pass, following
`cuadrilla-dotnet:stack-dotnet` and its references, then registers everything in DI.

## 3. Verify

Run, from the component path, the component's `setup` and every `checks[].run` in order
(default: `dotnet restore --locked-mode`, `dotnet build --no-restore -warnaserror`,
`dotnet format --verify-no-changes --no-restore`, `dotnet test --no-build`). Fix failures and
re-run until green; report the real output.

## 4. Review

Finish by running the core `reviewer` agent (`cuadrilla:reviewer`) on the diff and address its
blocking findings. Then summarize: files by layer, contract, scripts the user must run, check
results and review outcome. Do not commit.
