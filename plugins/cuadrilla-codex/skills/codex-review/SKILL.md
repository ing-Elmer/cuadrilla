---
name: codex-review
description: Second opinion — Codex reviews the changes in a read-only sandbox while the cuadrilla reviewer reviews the same diff; Claude verifies every Codex finding in the code and consolidates both into one list.
argument-hint: '[base branch]  (empty = uncommitted changes)'
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Agent, Bash(git diff*), Bash(git status*), Bash(git log*), Bash(codex exec*), Bash(codex --version*)
---

Current state:
!`git status --short`

Codex version:
!`codex --version`

## 1. Codex review (read-only)
`codex review --uncommitted/--base` doesn't accept custom instructions, and without them Codex
reviews without knowing the standard. Use `codex exec` in a read-only sandbox with the prompt on
stdin, from the repo root, in the background with a generous timeout; prompt and output in the
session scratchpad, **never in the repo**:

```
codex exec -s read-only --ephemeral -C <repo root> -o <scratchpad>/codex-review.md - < <scratchpad>/codex-review-prompt.md
```

The prompt says which diff to review (empty argument → `git diff HEAD` plus untracked files from
`git status --porcelain`; with a base branch → `git diff $ARGUMENTS...HEAD`) and includes:

> Review these changes against the project's standard. Before giving an opinion, read the
> "Project profile" and "Exceptions to the standard" sections of CLAUDE.md and
> .claude/cuadrilla.json. The standard: <paste a summary of cuadrilla:standard-core,
> standard-architecture, standard-api, standard-data, standard-testing and the component's stack
> standard>. Prioritize correctness, security and concurrency bugs over style. For each finding
> give file:line, the problem, a concrete scenario that triggers it and the fix. Don't report
> anything you can't point to in the code. Answer in <team language>.

If Codex fails (not logged in, proxy, timeout), report the error verbatim and continue with step 2.

## 2. Own review
In parallel, launch the `reviewer` agent on the same diff.

## 3. Consolidation
**Verify every Codex finding in the code** before including it. Classify:
- ✅ **Confirmed** — verified in the code.
- ➕ **Claude only** — found by the reviewer, not by Codex.
- ❌ **Discarded** — false positive or contradicts a profile exception (one line why).

Output: one list ordered by severity (🔴 / 🟡 / 🔵) with `file:line`, problem, fix and origin
(Codex / Claude / both), closing with how many findings each contributed and how many matched.
**Don't edit anything.**
