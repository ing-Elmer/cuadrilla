# Security and configuration

## Secrets

- Committed `appsettings*.json` contain **no secrets**: only structure and non-sensitive values.
  Connection strings with credentials, signing keys, system passwords and API keys come from:
  - local: `dotnet user-secrets` (`dotnet user-secrets init --project src/<App>.Api`, then
    `dotnet user-secrets set "ConnectionStrings:Main" "<value>"` — the user runs it, Claude
    never types the value);
  - deployed: environment variables (`ConnectionStrings__Main`, `Jwt__SigningKey`) or a secret
    store (Azure Key Vault, AWS Secrets Manager, HashiCorp Vault…) per the profile.
- Every environment has its own secrets; never reuse a development value in production.
- The base `appsettings.json` holds no developer-specific data (cloud profiles, local paths,
  personal emails).
- Cryptographic keys are never `const`/`static readonly` literals in code.
- Found a committed secret? Tell the user **without repeating it** and propose rotating it.
- Protected files (guard hook): `appsettings.Production.json`, `appsettings.*.local.json`,
  `secrets.json` plus the core defaults (`.env*`, `*.pfx`, `*.key`…). Claude does not read or
  edit them.
- `appsettings.example.json` (template in this skill) documents the shape with empty values.

## Options pattern

```csharp
public sealed class JwtOptions
{
    public const string SectionName = "Jwt";
    [Required] public string Issuer { get; init; } = "";
    [Required] public string Audience { get; init; } = "";
    [Required, MinLength(32)] public string SigningKey { get; init; } = "";   // from secrets
    [Range(1, 1440)] public int AccessTokenMinutes { get; init; } = 15;
}

builder.Services.AddOptions<JwtOptions>()
    .BindConfiguration(JwtOptions.SectionName)
    .ValidateDataAnnotations()
    .ValidateOnStart();
```

- Every configuration section has an options class in `<App>.Core/Settings/` (or next to its
  consumer in Infrastructure) registered with `ValidateOnStart()`: a missing secret fails at
  startup, not on the first request.
- Consumers inject `IOptions<T>` (or `IOptionsMonitor<T>` for reloadable values). No
  `IConfiguration["…"]` / `GetValue<>` outside `Program.cs` and the `DependencyInjection` classes.
- Never log an options object that contains secrets.

## HTTP hardening

- HTTPS redirection + HSTS outside Development; forwarded headers restricted to known proxies.
- CORS explicit origins from configuration; credentials only with explicit origins.
- Rate limiting (`AddRateLimiter`) on login, refresh and other anonymous endpoints.
- Request size limits on upload endpoints; validate content type and extension; never use the
  client file name as a path.
- Error responses never include stack traces, SQL or exception messages from providers.
- Dependency audit: `dotnet list package --vulnerable --include-transitive` (the component's
  `audit`) before every release; NuGet audit warnings (`NU1901`–`NU1904`) are errors through
  `TreatWarningsAsErrors`.

## `.gitignore` minimum (for the .NET component)

`bin/`, `obj/`, `**/publish/`, `TestResults/`, `*.user`, `.vs/`, `.idea/`, `*.log`,
`appsettings.*.local.json`, `secrets.json`, `.claude/settings.local.json`, `CLAUDE.local.md`.

## Pipelines

- Credentials only as repository/environment secrets, never in YAML; never echo them.
- Deploy targets (sites, app pools, clusters, registries) are the profile's; do not change
  them without confirmation.
