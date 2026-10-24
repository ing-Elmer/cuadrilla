---
name: feature
description: Build a feature across one or more components — fix the contract, delegate each component to its stack agent in parallel, verify, review and QA. Works for any stack (uses the pack's feature skill when there is one).
argument-hint: '<FeatureName> <short description>'
disable-model-invocation: true
---

Build the feature: **$ARGUMENTS**

1. Read the profile and `.claude/cuadrilla.json`. Decide which components the feature touches.
2. Explore the closest existing feature in each component and list the files to create/change
   per layer.
3. If it spans components, write the **contract** (endpoint, method, request/response DTOs in
   camelCase, envelope, error codes, permission code, migrations needed).
4. Show the plan (files per component, contract, migrations, tests) and **wait for OK**. In
   unattended mode (stated in the session context) don't wait: keep the plan in the final report
   and record every choice you made under **Decisions taken**.
5. Implement: for each component launch its `agent` (from cuadrilla.json) in parallel with the
   contract, the reference feature, and the instruction to follow its pack's feature skill if the
   pack has one (`cuadrilla-<pack>:feature-<id>`). Migration scripts are written first and never
   executed.
6. `/cuadrilla:verify` for the touched components → `reviewer` → fix 🔴/🟡 → re-verify.
7. `qa` if there is UI; `docs-writer` if the API contract or usage docs changed.
8. Report: files per component, contract, checks with real results, review verdict, pending.
