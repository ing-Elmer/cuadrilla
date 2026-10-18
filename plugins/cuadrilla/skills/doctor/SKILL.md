---
name: doctor
description: Diagnose the cuadrilla setup on this machine and repo — required tools, hooks working, cuadrilla.json valid and its commands available, profile completeness, installed packs vs stacks, MCP credentials present, CI and review workflows. Read-only.
disable-model-invocation: true
---

Diagnose the cuadrilla setup. **Read-only**: don't install, change or create anything; only report
and propose fixes.

1. **Tools:** `node --version` (≥ 18, hooks need it), `git --version`, `gh --version` +
   `gh auth status` (optional), and the tools each component needs (first word of its `setup` and
   `checks` commands: `uv`, `npm`, `dotnet`, `./mvnw`/`java`, `go`, `cargo`…).
2. **Hooks:** confirm the session-context information appeared at session start. Then run the
   guard hook on a harmless and a forbidden sample by piping JSON to it:
   `echo '{"tool_name":"Bash","tool_input":{"command":"git push"}}' | node "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/guard.mjs"`
   must print a `deny` decision; the same with `git status` must print nothing.
3. **Config:** `.claude/cuadrilla.json` parses; every component path exists; every
   `forbidden[].pattern` compiles as a JavaScript regex; `format`/`lint` entries are arrays whose
   first element is an available command.
4. **Profile:** `CLAUDE.md` has `## Project profile`; count `TODO`/`<placeholder>` values.
5. **Packs:** each component's `stack` has its pack installed (its agent and `stack-<id>` skill
   are available); otherwise give the `/plugin install <pack>@cuadrilla` command.
6. **MCP:** which cuadrilla MCP servers are connected (`/mcp` shows them); for `github`, whether the
   `GITHUB_PAT` environment variable is set (check existence only — **never print it**).
7. **GitHub:** `.github/workflows/ci.yml` has one `ci-<name>` job per component with the same
   steps as `checks`; `claude-review.yml` exists and pins the action by SHA.

Report a checklist: item · status (✅ / ⚠️ / ❌) · fix.
