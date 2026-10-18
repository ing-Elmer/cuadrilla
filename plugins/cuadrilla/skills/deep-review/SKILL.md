---
name: deep-review
description: Deep technical review of a change, branch or GitHub PR with the code-reviewer agent (correctness, concurrency, design, performance, test quality).
argument-hint: '[base branch | commits | #PR]  (empty = local changes vs HEAD)'
disable-model-invocation: true
---

Launch the `code-reviewer` agent on: **$ARGUMENTS** (empty = local changes vs `HEAD` including
new untracked files; `#123` or a number = that GitHub PR).

Give it the exact scope (base branch and commits, PR number, or file list) and ask for its
report by severity with `file:line`, the real check results and the verdict.

When it finishes, show the findings ordered and propose what to fix and with which agent. Don't
fix anything until the user asks. To publish the result on a PR: `/cuadrilla:review-pr <n> --comment`.
