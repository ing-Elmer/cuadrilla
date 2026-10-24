---
name: standard-github
description: GitHub, CI and deploy rules of the cuadrilla standard for any stack — branch model, ci.yml generated from .claude/cuadrilla.json, workflow security, the Claude PR review workflow, dependabot, CODEOWNERS and the deploy model. Load before writing or reviewing anything under .github/, Dockerfiles or deploy configuration.
user-invocable: false
paths: "**/.github/**, **/Dockerfile, **/*.dockerfile, **/docker-compose*.yml, **/vercel.json, **/railway.toml, **/netlify.toml, **/fly.toml"
---

# cuadrilla — GitHub, CI and deploy (any stack)

## Branches and PRs
- The base branch (profile / `baseBranch`) is reached only through PRs with green CI (branch
  protection configured by a person).
- Branch names `<type>/<TICKET>-<short-description>`; commits in the team language, first line
  ≤ 72 characters, ticket key when there is one.

## `ci.yml`
- **One job per component**, named `ci-<component name>`, running the component's `setup` and
  then every `checks[].run` **in the same order** as `.claude/cuadrilla.json`. If one changes, the
  other changes in the same PR. `/cuadrilla:adopt` generates the jobs from the pack templates.
- The job names are what branch protection and deploy platforms require: renaming one means
  updating those settings too.
- No `paths` filters at workflow level on required checks (a required check that doesn't run
  blocks the PR). Use job-level conditions if really needed.
- Tests needing a database use an ephemeral `services:` container, never a shared database.

## Workflow security
- `permissions:` explicit and minimal (`contents: read` at the top); a job asks for more only if
  it needs it.
- Official `actions/*` by major tag; third-party actions pinned by **full commit SHA** with the
  version in a comment. Dependabot keeps them updated.
- `actions/checkout` with `persist-credentials: false`.
- Secrets only in GitHub Secrets (preferably per environment); never in YAML or printed.
- Never `pull_request_target` with a checkout of the PR code; never interpolate
  `${{ github.event.* }}` directly in `run:` (pass it through `env:`).
- `concurrency` per ref with `cancel-in-progress: true`; `timeout-minutes` on every job.

## `claude-review.yml` (AI code review on every PR)
- Runs `anthropics/claude-code-action` (pinned by SHA) on non-draft PRs **from the same
  repository** and not from Dependabot; trigger `pull_request`, never `pull_request_target`.
- Job permissions: `contents: read`, `pull-requests: write`, `id-token: write` — nothing else.
- `--allowedTools` limited to reading the repo, `gh pr diff/view/comment` and the inline-comment
  tool. It reviews against `CLAUDE.md` and the cuadrilla standard, never approves, requests changes,
  edits or merges. It is advisory, not a required check.
- Credential: `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` repo secret.

## Repository files
- `.github/dependabot.yml` for every ecosystem in use + `github-actions`, weekly and grouped.
- `.github/CODEOWNERS` and `.github/pull_request_template.md`.

## Deploy model
- **CI verifies; the platform deploys.** Prefer the platform's native GitHub integration that
  waits for CI (Railway "Wait for CI", Vercel "Deployment Checks", Azure/Render/Fly equivalents)
  over deploy tokens stored in GitHub. A `deploy.yml` holding platform tokens is an exception
  declared in the profile.
- Migrations are never run automatically on deploy unless the profile declares it; a person runs
  the scripts against the target database before the merge that needs them.
- Branch protection, environments and platform settings are configured by a person: Claude
  documents and verifies them, never changes them.
