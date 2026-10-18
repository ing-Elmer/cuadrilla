# Optional: publishing for IIS

Read only when the profile's **Deploy** section targets IIS. This produces publish packages; it
**never deploys**. Copying to servers, recycling app pools and changing sites is done by the
pipeline or a person.

## Inputs (from the profile — ask if missing)

`<App>`, the component path, framework-dependent vs self-contained, target runtime
(`win-x64`), environment name, destination folder.

## Steps

1. **Pre-check.** `git status`: if there are uncommitted changes, warn (the package would not
   match a commit) and continue only with the user's OK. Record branch and
   `git rev-parse --short HEAD` for the report.
2. **Destination.** Default `<repo>/publish/api/` (must be covered by `**/publish/` in
   `.gitignore` — verify and warn if not). Never publish straight into an IIS site folder
   (`C:\inetpub\…` or any path listed in the profile). If the destination is not empty, ask
   before clearing it.
3. **Publish.**
   `dotnet publish src/<App>.Api -c Release -o <destination>` — framework-dependent by default;
   add `-r win-x64 --self-contained` only if the profile says so. If files are locked by a
   running API, report the process name and PID instead of killing it.
4. **Inspect the output.**
   - `web.config` exists and uses `AspNetCoreModuleV2` with `hostingModel="inprocess"` (or what
     the profile says); `stdoutLogEnabled="false"` for production.
   - No `appsettings.Development.json`, `appsettings.*.local.json`, `secrets.json`, `*.user`,
     `*.pdb` (unless the profile wants symbols). If one appears, propose excluding it in the
     `.csproj` (`<Content Update="appsettings.Development.json" CopyToPublishDirectory="Never" />`)
     and apply it only with the user's OK.
   - Search the published `appsettings*.json` for connection strings with passwords, signing
     keys or API keys. If any is found, **stop** and report the file and key name — never the value.
5. **Report.** Table: part · result (OK / FAIL) · folder · size · file count · notes. Below it:
   branch + commit, configuration used, and warnings (secrets, `web.config`, uncommitted changes).

## Server prerequisites (document, do not change)

- The **ASP.NET Core Hosting Bundle** matching the app's major version is installed on the
  server (framework-dependent deployments fail with HTTP 500.31/500.19 otherwise).
- App pool: *No Managed Code*, integrated pipeline, its own identity with least privilege.
- `ASPNETCORE_ENVIRONMENT` and secrets are set as environment variables of the app pool /
  machine or through `web.config` `<environmentVariables>` written at deploy time by the
  pipeline — never committed.
- Zero-downtime replacement: drop `app_offline.htm`, copy, remove it (done by the pipeline).
- Behind IIS, configure `ForwardedHeaders` if TLS terminates at a load balancer.

## Limits

- No deploys, no `appcmd`, no app pool start/stop/recycle, no copies to servers or shares.
- No secrets in the package or the report. Temporary logs go to the scratchpad, never the repo.
