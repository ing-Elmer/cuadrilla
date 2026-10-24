---
name: report
description: Report of the team's local metrics — what the guard blocked, which forbidden patterns keep coming back, where lint fails, which agents and commands are used — with the three most repeated patterns explained and a concrete fix proposed for each. Read-only.
argument-hint: '[days, default 30; 0 = all] [anonymous] [--json] [--save]'
disable-model-invocation: true
allowed-tools: Read, Grep, Glob, Bash(node *report.mjs*)
---

Report for: **$ARGUMENTS**

1. Run `node "${CLAUDE_SKILL_DIR}/report.mjs" $ARGUMENTS` from the project root. It reads
   `.claude/cuadrilla/metrics.jsonl` (written by the cuadrilla hooks; it never contains commands,
   prompts, code, paths or secrets) and prints the report. Pass the arguments through as given:
   a number is the period in days, `anonymous` hides component names and project-specific rules
   and drops session ids, `--save` also writes it under `.claude/cuadrilla/reports/`, `--json`
   prints the data instead of the tables. `anonymous --json --save` is the file the kit's
   curator reads: if that is what the user asked for, show where it was saved and skip steps 3–4.
2. If it says there are no events, explain how metrics are recorded and how they are turned on or
   off (`"metrics"` in `.claude/cuadrilla.json`, `CUADRILLA_METRICS`), and stop.
3. Show the report in the team language, keeping its tables.
4. For each of the **most repeated patterns** (at most three), add a short comment:
   - **What it means** in this project, in one or two sentences.
   - **Likely cause:** look at the text that drives that behaviour — the agent, command or stack
     skill involved, the project profile in `CLAUDE.md`, `.claude/cuadrilla.json` — and quote
     the line that explains it, with `file:line`. If nothing explains it, say so.
   - **Proposed fix:** one concrete change (which file, what text to add or change) that makes
     the agents avoid the problem instead of being blocked or corrected afterwards. Prefer the
     narrowest place: a project profile exception, a `forbidden` entry, a stack skill, then an
     agent.
5. Don't change any file. Offer to apply the fixes the user picks. In unattended mode, only
   report.
6. With `anonymous`, end by saying what the report does and doesn't contain, so the user knows it
   is safe to share with whoever maintains the kit.
