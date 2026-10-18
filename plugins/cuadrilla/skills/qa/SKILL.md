---
name: qa
description: Test an application flow in a real browser with the qa agent (Playwright) and get a report with steps, results, screenshots and severities.
argument-hint: '<flow to test>  (e.g. "create an order as SALES and see it in the list")'
disable-model-invocation: true
---

Delegate to the `qa` agent the test of this flow: **$ARGUMENTS**

- If the app isn't running, the agent starts it (like `/cuadrilla:run`).
- Ask the user for test users when needed; never production credentials or data.
- Return the agent's report: steps executed, result, findings with severity and screenshot paths.
