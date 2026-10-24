---
name: pr
description: Write the Pull Request description for the current branch and optionally create it as a draft after the user's OK. Never pushes, merges or marks ready.
argument-hint: '[target branch]  (empty = baseBranch)'
disable-model-invocation: true
allowed-tools: Read, Grep, Glob, Bash(git diff*), Bash(git log*), Bash(git branch*), Bash(git rev-parse*), Bash(git status*), Bash(gh pr view*), Bash(gh pr list*), Bash(gh pr create*), Bash(gh pr checks*)
---

Current branch: !`git rev-parse --abbrev-ref HEAD`

Target: **$ARGUMENTS** (empty = `baseBranch` from `.claude/cuadrilla.json`, or the profile's base
branch). Compute `git log --oneline <target>..HEAD` and `git diff --stat <target>...HEAD`.

## 1. Before writing
- Uncommitted changes → warn: they won't be in the PR.
- If `/cuadrilla:verify` and `reviewer` haven't run on these commits in this session, ask whether
  to run them first (the `claude-review` workflow and the human reviewer will look at the same).

## 2. Description
Follow `.github/pull_request_template.md` if it exists. Otherwise, in the team language:
- **Summary:** what and why (1–3 lines) with the ticket.
- **Changes:** one line per component; migration scripts in execution order.
- **How to test:** concrete steps and the role to use.
- **Risks / deploy notes:** migrations, new environment variables (names only), breaking
  contract changes.

## 3. Create (optional)
Return the text ready to paste. If the branch is already on the remote and has no PR, offer
`gh pr create --draft --base <target> --title "…" --body-file <scratchpad file>` and **wait for
OK**. If the branch isn't pushed, tell the user to push it themselves.

Never push, merge, approve or mark the PR as ready.
