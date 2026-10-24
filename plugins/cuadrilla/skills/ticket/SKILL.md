---
name: ticket
description: Work a Jira ticket or GitHub issue end to end — read it, propose plan and contract, implement with the agents after OK, verify every acceptance criterion and report. In unattended mode it runs without confirmations and ends in a draft PR on an agent branch.
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

## Unattended mode

When the session context says **cuadrilla UNATTENDED MODE**, nobody can answer, so the flow above
changes as follows (everything else, including the standard and the reviews, stays the same):

- Step 1: if the ticket can't be read, stop and say why in the final message; there is nothing
  to push.
- Before step 2, create the work branch from the up-to-date base branch:
  `git switch -c <agent prefix><KEY or issue number>-<short-description>` (the prefix is in the
  session context, `agent/` by default).
- Step 3: do not wait. Resolve each doubt with the most conservative reasonable choice and
  record it under **Decisions taken**. If the ticket is too ambiguous to implement safely (no
  acceptance criteria and no clear intent), implement nothing and open the draft PR anyway with
  only the questions a person must answer.
- After step 4, commit in the team language (Conventional Commits if the repo uses them),
  excluding the same files `/cuadrilla:commit` excludes. Never `--no-verify`.
- Push with exactly `git push -u origin <branch>` and open the PR with
  `gh pr create --draft --base <baseBranch> --title "…" --body-file <scratchpad file>`. The body
  follows `/cuadrilla:pr`'s structure plus, at the top: the criterion-by-criterion report, the
  real check results (any failing check first, with what was tried), **Decisions taken**, and
  migration scripts that were written but not executed.
- Never merge, approve, mark ready, comment on or transition the ticket.
