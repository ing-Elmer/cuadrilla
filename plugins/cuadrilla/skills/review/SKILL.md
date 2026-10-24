---
name: review
description: Review changes against the cuadrilla standard with the reviewer agent (layers, API envelope, data access, frontend rules, CI, basic security, tests). Local changes, a branch or a GitHub PR.
argument-hint: '[base branch | #PR]  (empty = local changes vs HEAD)'
disable-model-invocation: true
---

Current status:
!`git status --short`

Scope: **$ARGUMENTS**
- Empty → local changes vs `HEAD`, including new untracked files.
- A branch → `git diff <branch>...HEAD`.
- `#123` or a number → that GitHub PR (`gh pr diff`; without `gh`, the read-only `github` MCP).

Launch the `reviewer` agent with that exact scope (file list or branch/PR) and ask for its report
by severity with `file:line`, the real results of the component checks and the verdict.

When it finishes:
1. Show the findings ordered (🔴 blocker, 🟡 fix, 🔵 suggestion), never repeating secrets.
2. Propose what to fix and with which agent. **Don't edit** until the user asks.
3. If the scope was a PR, offer `/cuadrilla:review-pr <n> --comment` to publish a summary.

Deeper technical review: `/cuadrilla:deep-review`. Security: `/cuadrilla:security-audit`.
