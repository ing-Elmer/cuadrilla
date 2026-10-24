---
name: deploy-check
description: Pre-deploy readiness check for any stack and platform — git/CI state, every component's checks and production build, container image, environment variables by name, dependency audits and pending migrations. Never deploys.
argument-hint: '[component name …]  (empty = all components)'
disable-model-invocation: true
---

Pre-deploy check. Scope: **$ARGUMENTS** (empty = every component). Deploy targets, branches and
variable names come from the profile's **Deploy** section; components and commands from
`.claude/cuadrilla.json`. Missing data → ask.

**This never deploys.** The platform deploys from Git after CI passes; this only confirms that
what will be deployed is ready.

## 1. Code state
- `git status`: uncommitted changes → warn (they won't be deployed).
- Branch, short commit, and difference with the deploy branch
  (`git log --oneline origin/<branch>..HEAD` and the reverse).
- CI of the latest commit on that branch: `gh run list --branch <branch> --limit 3` (or the
  `github` MCP).

## 2. Per component
1. `/cuadrilla:verify <component>`.
2. Production build/package (the stack's build command) — artifacts to the scratchpad or the
   build folder that is git-ignored; report size.
3. Container: check the Dockerfile against `cuadrilla:standard-security` (multi-stage, non-root, no
   dev server, lockfile install, no secrets). If Docker is available, `docker build` locally
   **without pushing** and report the image size.
4. Environment variables: compare names in `.env.example`, the settings/config class and the
   profile. List variables **added since the last deploy** (names only) that someone must set
   on the platform. Never print values.
5. Public frontend variables: make sure none holds a secret and the API URL points to the right
   environment; no source maps or env files in the build output unless the profile allows it.
6. Dependency audit: the component's `audit` command.

## 3. Database
Migration scripts added since the last deploy
(`git diff --name-only origin/<branch>...HEAD -- <migrations folder>`), in execution order.
**Don't run them**: hand the list to the person who runs them before the merge.

## 4. Report
Table: component · step · result (OK / FAIL / PENDING) · notes. Then: branch + commit, CI status,
variables to set (names), migrations to run (in order) and warnings.

## Limits
No deploys, no platform variable or config changes, no image pushes, no SQL. Logs and temporary
builds go to the scratchpad.
