---
name: standard-security
description: Security and secret-handling rules of the cuadrilla standard for any stack — authentication, authorization and IDOR, input/output handling, frontend sinks, secrets and configuration, dependencies, containers. Load before writing or reviewing auth, permissions, data handling, configuration, Dockerfiles or dependency changes.
user-invocable: false
---

# cuadrilla — security (any stack)

The `security` agent (`/cuadrilla:security-audit`) does full audits; these are the rules every
change must respect.

## Authentication and authorization
- Deny by default; every anonymous endpoint justified in a comment and reviewed in the PR.
- Permissions are checked on the server with the declarative mechanism. What the UI hides is UX
  only.
- **IDOR:** every lookup of a resource owned by someone filters by the owner or checks a
  permission on that specific resource.
- Input DTOs never accept fields the user may not decide (`id`, `role`, `active`, `ownerId`,
  computed amounts): no mass assignment.
- Tokens: algorithm pinned when verifying, expiry checked, issuer/audience validated; refresh
  tokens stored hashed, rotated on every use, reuse detection revokes the family; password
  change/deactivation revokes sessions.
- Passwords with bcrypt (cost ≥ 12) or argon2id. Login and recovery give the same message,
  status and similar timing whether the account exists or not; rate-limited per user and IP.

## Input and output
- Validate on the server (shape at the edge + business validator). Never trust frontend
  validation.
- Parametrized queries only (see `standard-data`); no shell commands built from input.
- Uploads: max size, type checked by content, server-generated names, never a user-built path.
- Server-side requests to user-provided URLs: host allow-list (SSRF).
- Responses carry only the fields the screen needs (the output DTO filters). Never hashes,
  tokens or other people's personal data.
- Errors to clients are generic; details go to logs without sensitive data.

## Frontend
- No raw-HTML sinks (`dangerouslySetInnerHTML`, `v-html`, `innerHTML`) with non-constant data;
  URLs from data are validated (`http:`/`https:` only).
- Access token in memory; refresh token per the frontend pack. Nothing sensitive in
  `localStorage` unless the profile justifies it.
- Public build-time variables (`VITE_*`, `NEXT_PUBLIC_*`…) end up in the bundle: never secrets.

## Secrets and configuration
- Secrets only in environment variables or a secret manager; typed as secrets when the stack
  allows it. Committed: `.env.example` with names and fake values only.
- Different secrets per environment; never reuse development values in production.
- Base configuration contains no personal data of a developer (local paths, emails, profiles).
- A committed secret is reported **without repeating it** and must be **rotated**; deleting it
  from the code is not enough (it stays in history). Secret-scanning alerts are never dismissed
  as false positives without the user.
- Cryptographic keys are never constants in code.
- Minimum `.gitignore`: env files (except examples), build outputs, dependency folders, caches,
  coverage, logs, IDE files, `.claude/settings.local.json`, `CLAUDE.local.md`.

## Dependencies and containers
- New dependencies only with confirmation, from known and maintained sources; lockfiles
  committed and used in CI (`--frozen`/`ci`/`--locked-mode`).
- Dependency audit (component `audit` command) before a deploy.
- Production images: multi-stage, non-root user, no dev servers or hot reload, no secrets in any
  layer, dependencies installed from the lockfile, minimal base image.
