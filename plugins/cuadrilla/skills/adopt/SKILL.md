---
name: adopt
description: Adopt the cuadrilla standard in the current project (new or existing, any language) — detect components and stacks, create the project profile in CLAUDE.md and .claude/cuadrilla.json, generate CI and the PR review workflow, propose permissions and recommended skills, and report gaps against the standard.
argument-hint: '[new]  (empty = existing project; "new" = start from scratch)'
disable-model-invocation: true
---

Adopt the cuadrilla standard in this project. Mode: **$ARGUMENTS** (empty = existing project).
Answer in the team's response language. Show every file before writing it and **wait for the
user's OK** at each checkpoint (✋).

Templates live in `${CLAUDE_SKILL_DIR}/templates/`. The configuration format is described in
`${CLAUDE_SKILL_DIR}/reference/cuadrilla-config.md`.

## 1. Detect components
- Existing project: find every deployable/testable unit by its manifest (`pyproject.toml`,
  `package.json`, `*.csproj`/`*.sln(x)`, `pom.xml`/`build.gradle*`, `go.mod`, `Cargo.toml`,
  `composer.json`, `Gemfile`…), ignoring dependency and build folders. Read the CI workflows,
  Dockerfiles, lint/format configs and the git remote/branches (`git remote -v`,
  `git branch -a`).
- New project: ask which components (backend/frontend/worker…), which stack each, names, ports,
  database engine, base branch, deploy targets.
- For each component, map the stack to a pack:
  | Detected | Stack id | Pack plugin | Agent |
  |---|---|---|---|
  | FastAPI / Python web API | `python-fastapi` | `cuadrilla-python-fastapi` | `cuadrilla-python-fastapi:backend-python` |
  | ASP.NET Core | `dotnet` | `cuadrilla-dotnet` | `cuadrilla-dotnet:backend-dotnet` |
  | Node + TypeScript API | `node-typescript` | `cuadrilla-node-typescript` | `cuadrilla-node-typescript:backend-node` |
  | Spring Boot | `java-spring` | `cuadrilla-java-spring` | `cuadrilla-java-spring:backend-java` |
  | React (Vite) SPA | `react` | `cuadrilla-react` | `cuadrilla-react:frontend-react` |
  | anything else | `generic` | — | `cuadrilla:developer` |
- Several stacks share manifests: decide by dependencies, not by file names. A `package.json`
  with `react` + `vite` is `react`; one with `fastify`/`express`/`@nestjs/core` is
  `node-typescript`; a monorepo can have both in different folders.
- If a matching pack is not installed, tell the user the exact command
  (`/plugin install <pack>@cuadrilla`) and continue with `generic` for now.

## 2. `.claude/cuadrilla.json` ✋
- For each component with a pack: load its stack skill with the Skill tool
  (`cuadrilla-<pack>:stack-<id>`) and read its `component.json` (path given in that skill's
  "Files" section). Start from its `component` block, set `name`, `path`, `stack`, `agent`, and
  **adapt the commands to what the project really has** (scripts in package.json, wrapper vs
  global tool, solution path). Add the pack's `forbidden` and `protectedPaths`.
- For `generic` components: infer `setup`, `checks`, `start`, `audit` from the manifest, CI and
  README; leave `format`/`lint` empty unless there is a fast single-file formatter (gofmt,
  rustfmt, php-cs-fixer, rubocop -a).
- Existing project: **run each check once** (in the background, logs to the scratchpad) to
  confirm the command exists and report pass/fail — failures are fine, wrong commands are not.
- Start from `${CLAUDE_SKILL_DIR}/templates/cuadrilla.example.json`. Show it and wait for OK.

## 3. Project profile in `CLAUDE.md` ✋
- If `CLAUDE.md` has no `## Project profile`, add it from
  `${CLAUDE_SKILL_DIR}/templates/CLAUDE.profile.md` (keep any existing content).
- Existing project: infer every value from the code (manifests, settings classes — **names of
  variables only, never values; never open `.env` files** —, Dockerfiles, CI, git remote). New
  project: ask for what can't be inferred.
- Mark unknowns with `TODO`. Show it and wait for OK.

## 4. Repository files ✋
Propose, show and write after OK (adapting placeholders to the profile):
- `.github/workflows/ci.yml`: start from `templates/github/ci.header.yml`, then append one job per
  component: the pack's `templates/ci-job.yml` (from its stack skill) with placeholders filled,
  or for `generic` a job built from `setup` + `checks`. Follow `cuadrilla:standard-github`.
- `.github/workflows/claude-review.yml` from `templates/github/claude-review.yml`, replacing
  `<RESPONSE LANGUAGE>` with the team language and the branch names with `baseBranch`.
- `.github/pull_request_template.md`, `.github/dependabot.yml` (one entry per ecosystem in use +
  github-actions), `.github/CODEOWNERS` (owners from the user).
- Per component, the pack's deploy templates (Dockerfile, .dockerignore, platform files) **only
  if the profile declares that deploy target** and the file doesn't exist.
- `.gitignore` entries from `templates/gitignore.txt` that are missing.
- Never overwrite an existing file without showing the diff and getting OK.

## 5. Permissions for this repo ✋
Plugins can't ship permission rules. Offer to merge `templates/settings.project.json` into
`.claude/settings.json` (shared) — allow the read-only and check commands, ask before commits and
installs, deny pushes and secret files. Show the merged result; never remove existing rules.

## 6. Recommended skills ✋
Collect `recommendedSkills` from every pack's `component.json`. Show a table (skill, source,
why, what to ignore because the standard overrides it) and, for the ones the user picks, run
`/cuadrilla:find-skill install <owner/repo@skill>` (which vets them before installing).

## 7. Gap report (existing project)
Review the code against the core and pack standards and produce a table: rule · complies
(yes / partial / no) · evidence (`file:line`) · effort (low / medium / high). Priorities:
committed secrets, `.gitignore`, workflows without `permissions:` or unpinned actions, lockfiles,
non-parametrized SQL, forbidden data libraries, dependency rule tool, central error handling and
envelope, current-user abstraction, auth tests, duplicated migration numbers.
Write the non-compliances to `## Known technical debt` in `CLAUDE.md` (after OK). **Don't fix
code** in this command.

## 8. Manual setup checklist
Give the user what only a person can do (mark what you could verify as done):
1. GitHub branch protection on the base branch: PRs required, `ci-<component>` checks required.
2. Claude GitHub App (`/install-github-app`) + secret `ANTHROPIC_API_KEY` or
   `CLAUDE_CODE_OAUTH_TOKEN` for the review workflow.
3. Deploy platform settings (wait for CI, root directories, environment variables by name).
4. Run initial migration scripts against each environment's database.
5. MCP credentials as environment variables (`GITHUB_PAT` for the `github` MCP; pack MCPs per
   their README) and OAuth with `/mcp` for Atlassian.
6. Node.js ≥ 18 on every developer machine (the hooks use it).
