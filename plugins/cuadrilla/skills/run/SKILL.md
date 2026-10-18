---
name: run
description: Start the project's components locally in the background (commands, ports and health URLs from .claude/cuadrilla.json) and wait until they answer.
argument-hint: '[component name …]  (empty = all components with a start command)'
disable-model-invocation: true
---

Start the local environment. Scope: **$ARGUMENTS** (empty = every component with `start.run`).

1. Read `start` of each component in `.claude/cuadrilla.json`. If there is none, infer from the
   manifest/README and say it is a guess.
2. Check whether each port is already in use. If a process holds it, tell the user its PID and
   name and **ask** before stopping it (never stop processes you didn't start without asking).
3. If the component needs a local env file and it doesn't exist, tell the user which variables
   `.env.example` lists (names only). Never create secrets or open `.env` files.
4. Start each component in the background with `cwd` = its path; logs to the scratchpad.
5. Poll each `health` URL until it answers (≈ 90 s max; on timeout show the last log lines).
6. Report the URLs, and how to stop them.
