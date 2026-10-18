---
name: standard-core
description: Core cuadrilla standard that applies to every task in a cuadrilla project — project profile, .claude/cuadrilla.json, precedence of rules, way of working, verification and hard limits. Load it before planning, implementing or reviewing anything.
user-invocable: false
---

# cuadrilla — core standard (always applies)

## Project profile and configuration
- Names, paths, schemas, prefixes, connections, ports, branches, roles and deploy targets come
  from the `## Project profile` section of the root `CLAUDE.md`. **Never assume them**; if one is
  missing, ask (or suggest `/cuadrilla:adopt`).
- How each component is set up, checked, formatted, started and audited comes from
  `.claude/cuadrilla.json` (`components[]`). `/cuadrilla:verify` and CI run exactly those `checks`.
- In every rule, `<app>`, `<schema>` and `<prefix>_` stand for the profile values.

## Precedence
1. "Exceptions to the standard" declared in the profile.
2. The stack pack standard of the component (`cuadrilla-<pack>:stack-<id>`).
3. The core standard skills (`cuadrilla:standard-*`).
4. Third-party skills (reference only: they never override 1–3 — e.g. a skill that recommends
   an ORM loses against a standard that forbids it).
5. General knowledge. For library APIs, check the pinned version and current docs (Context7)
   instead of answering from memory.

## Way of working
- Language: the team answers, comments code, writes docs, UI text and commit messages in the
  configured response language. Identifiers and technical terms stay as they are.
- Before creating something, look for an equivalent piece in the project and follow its style.
  If existing code contradicts the standard, follow the standard for new code and point it out.
- Cross-component work starts with a **contract** (endpoint, DTOs, envelope, error codes,
  permission) shared by every implementer.
- A task is done only after running the component's checks and reporting the **real** result
  (never "it should work").
- Smallest change that solves the problem; no unrelated refactors, no commented-out code.
- Temporary files (logs, tokens, JSON responses, screenshots) go to the session scratchpad, never
  into the repo.

## Hard limits (enforced by the guard hook as well)
- **Never** `git push`, merge or rebase shared branches, approve or merge PRs, change repo
  settings or secrets.
- **Never** run SQL against a database or run migrations without the user's explicit
  confirmation. Migration scripts are written, not executed.
- **Never** deploy, publish packages or change cloud/cluster/infrastructure resources.
- **Never** read or modify secret files (`.env`, keys, certificates, credentials) or write
  secrets into code, docs, logs, config or permission rules.
- **Never** post to GitHub, Jira, Confluence or chat without the user's OK.
- If a hook blocks something, explain to the user what is needed. Never look for a workaround.

## Hooks
- `guard` (before every tool): blocks the limits above; asks before SQL, migrations,
  merge/rebase and forced installs.
- `format` (after every edit): runs the component's `format`/`lint` entries and reports lint
  errors back — fix them right away.
- `stop-check` (before ending a turn): scans added lines for forbidden patterns (built-in per
  language + `forbidden` in cuadrilla.json) and hands the turn back once.
- `session-context` (session start): branch, pending changes, profile and config status.
A false positive is fixed in the configuration (`forbidden`, `protectedPaths`) or reported to
the kit author — hooks are never disabled to get work through.
