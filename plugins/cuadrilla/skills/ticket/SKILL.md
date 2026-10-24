---
name: ticket
description: Work a Jira ticket or GitHub issue end to end — read it, propose plan and contract, implement with the agents after OK, verify every acceptance criterion and report.
argument-hint: '<JIRA-KEY | #issue>'
disable-model-invocation: true
---

Work the ticket **$ARGUMENTS**.

1. Read it: Jira key → Atlassian MCP (description, acceptance criteria, subtasks, comments,
   links and linked Confluence pages); `#n` → `gh issue view n --comments` or the `github` MCP.
   If the source isn't reachable/authenticated, say so and stop.
2. Read the profile and `.claude/cuadrilla.json` and explore the related code. Summarize:
   - What the ticket asks and what already exists.
   - Contract (endpoints, DTOs, permissions, migrations) when it spans components.
   - Files to create/change and which agent does each part.
   - How each acceptance criterion will be verified (test, QA in browser, manual).
   - Doubts or ambiguities.
3. **Wait for the user's confirmation** before implementing.
4. Implement through the components' agents (in parallel once the contract is fixed), run
   `/cuadrilla:verify`, pass the change through `reviewer` (+ `security` if it touches auth,
   permissions or personal data), fix 🔴/🟡, and finish with `qa` if there is UI.
5. Report criterion by criterion (done / pending, with evidence), the real check results and
   what's pending. Suggest a branch name (`<type>/<KEY>-<description>`) if still on the base
   branch. Don't comment on or transition the ticket unless asked.
