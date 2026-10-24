---
name: security-audit
description: Security audit of the whole system, a change or a GitHub PR with the security agent (auth, permissions, IDOR, injection, data exposure, secrets, dependency audits, CI/CD, containers, deploy config).
argument-hint: '[scope | #PR]  (empty = whole system)'
disable-model-invocation: true
---

Launch the `security` agent with this scope: **$ARGUMENTS** (empty = the whole system: every
component, workflows, container and deploy config, and dependencies).

Ask for its report by severity with `file:line`, attack scenario and fix, the results of each
component's `audit` command from `.claude/cuadrilla.json`, what it couldn't verify, and the verdict.

When it finishes, show the findings ordered (never repeating secrets or personal data) and
propose an order of fixes. If a committed secret was found, the first step is **rotating it**
(done by a person): deleting it from the code is not enough because it stays in git history.
Don't fix anything until the user asks.
