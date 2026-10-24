# Changelog

All notable changes to cuadrilla are documented here. Versions follow semantic versioning; every
plugin's `plugin.json` carries its own version.

## Unreleased — repository

### Evals (`evals/`, not part of any plugin)
- Runner that measures a change to the kit: reference tasks solved end to end by the agent team
  in unattended mode, isolated from personal settings and MCP servers, each judged by hidden
  tests, files that must or must not change, forbidden patterns in any added line (committed or
  not), pushes to `agent/*` and an untouched `origin/main`. Collects cost, turns, minutes, guard
  blocks and `stop-check` findings, and compares two git refs of the kit
  (`node evals/run.mjs --base main --runs 3 --yes`) with a verdict and a confidence note.
- Three cases: `node-slugify-bug`, `python-parse-amount`, `guardrail-secret-push`, each with a
  reference solution.
- `--dry-run` proves every case is fair (untouched fixture fails, reference passes) without
  calling Claude; `scripts/check.mjs` runs it and 18 runner tests on every push.

### Curator (`curator/`, not part of any plugin)
- Reads anonymous `/cuadrilla:report --json` files from projects, merges them and picks at most two
  patterns seen in ≥ 2 projects or ≥ 10 times, with a 30-day cooldown per pattern (`history.json`).
- For each, a Claude Code session with file tools only (no shell) proposes one change on a
  `curator/<date>-<pattern>` branch. The real diff must stay within agents/skills Markdown, 3 files
  and 60 lines; security agent and skills, hooks, evals, the curator, scripts, CI and license are
  protected. Protective guard rules are never loosened.
- The branch is evaluated against the base branch; only a better (or equal and cheaper) verdict
  is kept, and with `--pr` it is pushed and opened as a draft PR with evidence, cause/change/risk
  and the eval summary. It never merges. `--plan` previews for free.
- 22 tests, including the real report → curator handoff; run by `scripts/check.mjs`.

### Core
- `/cuadrilla:report` documents `--json`, the format the curator reads.

## 1.2.0 — local metrics and report

### Core (`cuadrilla`)
- **Local metrics** in `.claude/cuadrilla/metrics.jsonl`, so the standard improves with evidence:
  - `guard` records every block and confirmation with a stable rule id (`push`, `secret-file`,
    `db-migration`…) and the tool;
  - `stop-check` records findings as counts by pattern, source (built-in or project) and file
    extension;
  - `format` records lint problems per component;
  - `session-context` records session starts with their stacks;
  - new `usage` hook records which agents, skills and slash commands are used.
  Never records commands, prompts, task descriptions, code, file paths or secrets. The folder
  ignores itself in git, the file rotates at 5 MB, and a metrics failure never changes a hook's
  decision. Off with `"metrics": false` or `CUADRILLA_METRICS=off`.
- **`/cuadrilla:report [days] [anonymous] [--save]`**: blocks, confirmations, findings, lint and
  usage, with the three most repeated patterns explained and a concrete fix proposed for each.
  `anonymous` hides component names and project rules and drops session ids.
- `/cuadrilla:doctor` shows the metrics status and no longer counts its own sample guard check.
- 19 new tests (169 total).

## 1.1.0 — unattended mode

### Core (`cuadrilla`)
- **Unattended mode** for runs with nobody watching (scheduler, CI, OpenJarvis), enabled only
  from the runner's environment with `CUADRILLA_UNATTENDED=1` (never from the repository):
  - `guard`: every "ask" becomes a deny; exactly one plain `git push [-u] origin <prefix><name>`
    is allowed (`CUADRILLA_AGENT_BRANCH_PREFIX`, default `agent/`); `gh pr create` must be
    `--draft`. Force, delete, tags, mirror, several refspecs, other remotes and chained or
    wrapped pushes stay denied, as do merging, approving and marking PRs ready. So that the
    allowed push can only reach the original `origin`, remote edits, URL rewrites
    (`insteadOf`, `pushurl`), `git -c`, `GIT_CONFIG*`/`GIT_DIR` and edits inside `.git/` are
    denied too.
  - `session-context`: tells the agents they are unattended, which push is allowed and how to
    finish.
  - `/cuadrilla:ticket` runs end to end without confirmations — agent branch, commit, push and a
    draft PR with the criterion report, failing checks first and **Decisions taken**.
    `/cuadrilla:feature`, `/cuadrilla:commit`, `/cuadrilla:pr` and the orchestrator skip their
    confirmations in this mode.
- 53 new hook tests (150 total).

## 1.0.0 — first release (MIT)

### Core (`cuadrilla`)
- Agents: orchestrator, developer (any stack), reviewer, code-reviewer, security, qa,
  docs-writer, legacy-analyst. All answer in the configured response language.
- Standard skills: core, architecture, API contract, data & migrations, testing, security,
  GitHub/CI/deploy.
- Commands: adopt, feature, ticket, verify, review, deep-review, security-audit, review-pr,
  commit, pr, migration, run, qa, deploy-check, analyze-system, find-skill, doctor.
- Hooks: guard (deny/ask guardrails, secret detection), format (config-driven), stop-check
  (multi-language forbidden patterns), session-context.
- `.claude/cuadrilla.json` project configuration shared by hooks, `/cuadrilla:verify` and CI.
- GitHub PR review workflow template (`claude-review.yml`) and CI generator.
- MCP: GitHub (env token), Atlassian (OAuth), Playwright (pinned).

### Stack packs
- `cuadrilla-python-fastapi`, `cuadrilla-dotnet`, `cuadrilla-node-typescript`, `cuadrilla-java-spring`,
  `cuadrilla-react`.

### Optional
- `cuadrilla-codex`: Codex CLI delegation and second-opinion review.
