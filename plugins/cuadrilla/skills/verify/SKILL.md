---
name: verify
description: Run every check of the project's components (the same commands as CI, from .claude/cuadrilla.json) and report a results table. Works for any language.
argument-hint: '[component name …]  (empty = all components)'
---

Verify the project. Scope: **$ARGUMENTS** (empty = every component).

1. Read `.claude/cuadrilla.json`. If it doesn't exist, say so, propose `/cuadrilla:adopt`, and fall
   back to the obvious commands of each manifest you find (tell the user they are guesses).
2. For each component in scope, with `cwd` = its `path`:
   - Run `setup` first (e.g. install from the lockfile). If it fails because the lockfile is out
     of date, **stop and tell the user**: never regenerate a lockfile without asking.
   - Run every `checks[].run` **in order**. Keep going after a failure to report everything.
   - Run independent components **in parallel** (background commands), logs to the scratchpad.
3. Compare with `.github/workflows/ci.yml`: if the CI job of a component runs different steps,
   flag the drift.

Report a table: component · check · result (OK / FAIL) · tests passed/failed (if any) · first
relevant error line. If something fails, analyze the likely cause, but **don't fix it** unless
the user asks.
