# Curator

The curator closes the loop between how the kit is used and how it is written. Projects report
what keeps getting in the agents' way; the curator turns the most repeated of those patterns
into at most two small changes to the kit's instructions, keeps only the ones the
[evals](../evals/README.md) show are better, and opens them as **draft** pull requests. A person
reviews and merges, or closes them. The curator never merges anything.

This folder belongs to the kit's repository only; it is not part of any plugin.

## The loop

1. **Projects report.** In each project that uses Cuadrilla:
   `/cuadrilla:report 30 anonymous --json --save` writes
   `.claude/cuadrilla/reports/report-<date>-anonymous.json`. Copy those files into
   `curator/inbox/` (git-ignored). They hold rule ids and counts only; see
   [metrics](../README.md#metrics).
2. **The curator picks patterns.** It merges the reports and picks at most two patterns that
   appear in at least 2 projects or at least 10 times, skipping anything it tried in the last 30
   days. Patterns from more projects come first.
3. **One proposal per pattern.** For each pattern it creates `curator/<date>-<pattern>` from the
   base branch in a separate worktree and starts a Claude Code session with the instructions in
   [`curator.md`](curator.md) and the evidence. The session has **file tools only — no shell**.
4. **The diff is checked, not trusted.** Only Markdown under `plugins/*/agents/` and
   `plugins/*/skills/` may change, at most 3 files and 60 lines. The security agent and skills,
   hooks, evals, the curator itself, scripts, CI and the license are protected. Anything else
   rejects the proposal before a single eval runs.
5. **The evals decide.** The branch is committed and evaluated against the base branch (3 runs
   per version by default). Only a **better** verdict — or the same pass rate at a lower cost —
   is kept. Everything else is deleted.
6. **A person decides.** With `--pr`, accepted branches are pushed and opened as draft PRs with
   the evidence, the curator's explanation (cause, change, risk) and the eval summary.
7. **Memory.** Every attempt is appended to `curator/history.json` (commit it), so a pattern
   that didn't lead anywhere isn't retried for 30 days. A failed session (budget, outage)
   doesn't count, so it is retried next time.

## Running

```bash
node curator/run.mjs --plan              # which patterns it would address — free
node curator/run.mjs --yes               # propose and evaluate; accepted branches stay local
node curator/run.mjs --yes --pr          # … and push them and open draft PRs (needs `gh` logged in)
```

| Option | Meaning |
|---|---|
| `--plan` | Only list the patterns it would address. No Claude, no git changes. |
| `--pr` | Push accepted branches and open draft PRs. |
| `--base <branch>` | Branch proposals start from and are compared against (default `main`). |
| `--runs N` | Eval runs per version (default 3). |
| `--max N` | Proposals per run, 1 or 2 (default 2). |
| `--min-projects N`, `--min-count N` | Thresholds for a pattern (defaults 2 and 10). |
| `--cooldown <days>` | Don't retry a pattern for this long (default 30). |
| `--budget <usd>` | Cap for each curator session (default 3). |
| `--model <name>`, `--claude <bin>` | Model and Claude Code executable for curator and evals. |
| `--inbox <dir>`, `--history <file>` | Other locations for the reports and the history. |
| `--keep` | Keep rejected branches and the sandboxes, to inspect them. |
| `--yes` | Proceed; without it the runner only prints the cost ceiling. |

**Cost:** each proposal is one curator session plus a full eval comparison (every case × runs ×
2 versions). The ceiling is printed before anything starts; `--plan` is free.

**Where to run it:** like the evals, in a container or VM. A weekly scheduled run — from cron,
a CI job with Claude Code credentials, or an agent runner such as OpenJarvis — with `--pr` gives
the maintainers a short queue of evidence-backed proposals to review.

## Why it can't break the kit

- It reads **anonymous** reports only, and ignores project-specific rule texts (they arrive as
  `project rule #n`), so no project can address it through a report.
- The session can't run commands, and the runner checks the real diff against the zone and size
  limits.
- It can't touch what judges it (evals) or what protects the repository (hooks, security), and
  it is told never to weaken a limit. For protective rules such as `secret-file`, being blocked
  is the guard working: the curator may only make the legitimate path easier.
- Nothing reaches the base branch without a person merging a draft PR.
