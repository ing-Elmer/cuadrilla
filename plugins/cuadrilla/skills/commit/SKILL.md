---
name: commit
description: Propose a commit message in the team language from the staged changes and commit after the user's OK. Never pushes.
argument-hint: '[ticket key]'
disable-model-invocation: true
allowed-tools: Read, Bash(git status*), Bash(git diff*), Bash(git log*), Bash(git rev-parse*), Bash(git add*), Bash(git commit*)
---

Branch: !`git rev-parse --abbrev-ref HEAD`

Status:
!`git status --short`

Staged:
!`git diff --cached --stat`

Recent commits (to match the style):
!`git log --oneline -8`

1. If the branch is the base branch (`baseBranch` in `.claude/cuadrilla.json`, or `main`/`master`),
   warn first: changes reach the base branch through PRs.
2. If nothing is staged, propose which files to add and wait for confirmation. Always exclude
   secret files (env files except examples, keys, certificates), logs, temp files, screenshots,
   build outputs, dependency folders, caches, `.claude/settings.local.json`, `CLAUDE.local.md`.
   If any of them shows up as not ignored, propose adding it to `.gitignore`.
3. Read the staged diff (`git diff --cached`): if you see a secret, a debug print or a skipped
   test, warn before writing the message.
4. Write the message in the team language, in the style of previous commits (Conventional
   Commits if they use it), with the ticket **$ARGUMENTS** if given (or the one in the branch
   name). First line ≤ 72 characters; a body explaining the why when it isn't obvious.
5. Show the message and **wait for OK** before `git commit`. If a pre-commit hook fails, show the
   error and fix the cause: never `--no-verify`.
6. Never `git push`.

In **unattended mode** (stated in the session context) nobody can confirm: stage the files from
step 2 yourself, keep the same exclusions, and commit without waiting in step 5. Pushing is
covered by `/cuadrilla:ticket`'s unattended flow, not by this command.
