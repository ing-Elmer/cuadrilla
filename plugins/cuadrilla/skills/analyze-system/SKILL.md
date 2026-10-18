---
name: analyze-system
description: Analyze an existing system (any stack) that will be migrated into this project and write the migration report in docs/ with the legacy-analyst agent.
argument-hint: '<path to the system> [scope or document name]'
disable-model-invocation: true
---

Analyze the system to migrate: **$ARGUMENTS**

The first argument is the source system path; the rest is the scope (a module, a screen) or the
document name.

## 1. Validate and size
- No path → ask for it. Path doesn't exist → say so and stop.
- If the path is outside the project and not accessible, ask the user to add it with
  `/add-dir <path>`.
- List the system's own code (no third-party or generated code) to know its size and modules.

## 2. Delegate to `legacy-analyst`
- **Small or medium system:** one agent with the path, scope and document
  (`docs/migration-<system-name>.md`).
- **Large system** (several independent modules): one agent per module in parallel, each writing
  `docs/migration-<system-name>/<module>.md`; then you write that folder's `README.md` with the
  summary, shared connections and tables, and the module index.

Give each agent: the path, the exact scope, the document path, and that this project (profile in
`CLAUDE.md`, components in `.claude/cuadrilla.json`) is the migration target.

## 3. Verify before reporting
- The document exists, contains no passwords or connection strings with credentials, and its
  references to files of this project resolve.
- An existing report for that system was updated, not duplicated.

## 4. Return
The report path, a short summary (what it does, connections, tables, what to know before
migrating) and the open questions. Don't implement the migration or commit.
