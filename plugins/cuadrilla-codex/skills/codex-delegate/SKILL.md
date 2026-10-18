---
name: codex-delegate
description: Delegate a bounded coding task to OpenAI Codex CLI (codex exec, workspace-write sandbox) with a self-contained prompt, then verify the result like any other agent's work — checks, diff review against the standard, at most one correction round.
argument-hint: '<task to delegate>'
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Bash(git diff*), Bash(git status*), Bash(codex exec*), Bash(codex --version*)
---

Task: **$ARGUMENTS**

Current state (to tell later what Codex touched):
!`git status --short`

## 1. Before delegating
- No task → ask and stop. `codex --version` fails → tell the user to install/log in and stop.
- Read the profile in `CLAUDE.md`, `.claude/cuadrilla.json` and the standard skills that apply
  (`cuadrilla:standard-core` + the component's `stack-<id>`).
- If the task spans components, fix the contract first, as with the cuadrilla agents.
- **Never delegate** tasks that run SQL or migrations, handle secrets, push/merge, or change
  deploy configuration.
- If the files Codex will touch have uncommitted changes, warn the user first: they couldn't be
  separated afterwards.

## 2. The prompt
Codex starts without context and **doesn't read CLAUDE.md or cuadrilla skills**. The prompt must be
self-contained:
1. The concrete task and the definition of done.
2. The profile values that apply (paths, names, schema, prefix, connections).
3. The rules that apply, **pasted as a summary** (layers, envelope, data access, testing) plus the
   paths of reference files to imitate.
4. The contract, if any.
5. Limits, always: no SQL, no migrations run, no `git commit`/`push`, no reading or creating env
   files, no secrets, no new dependencies without saying so, no deleting or skipping tests, write
   comments and messages in the team language.
6. What to verify before finishing (the component's `checks` from `.claude/cuadrilla.json`) and
   what to return (files touched, real check results).

Write the prompt to a file in the **session scratchpad** (never in the repo) and run from the
repo root, in the background with a generous timeout:

```
codex exec -s workspace-write --ephemeral -C <repo root> -o <scratchpad>/codex-answer.md - < <scratchpad>/codex-prompt.md
```

Never use `--dangerously-bypass-approvals-and-sandbox` or `-s danger-full-access` (the guard hook
blocks them anyway).

## 3. Verification (mandatory: Codex's report is not enough)
1. `git status --short` and `git diff`: which files it really touched; flag anything out of scope.
2. Run the component's checks yourself.
3. Review the diff against the standard like `reviewer` would, paying special attention to tests:
   they exist, they test what was asked and they weren't weakened.
4. If something fails or breaks a rule, fix it yourself or delegate the fix with a new prompt —
   **one** more round with Codex at most. If it's still wrong, report instead of insisting.

## 4. Report
What the user asked, what Codex did (files), what you verified with real results, what you fixed
yourself and what's pending. State explicitly which parts Codex wrote.
