# Changelog

All notable changes to cuadrilla are documented here. Versions follow semantic versioning; every
plugin's `plugin.json` carries its own version.

## 1.0.0 — first release (MIT)

### Core (`cuadrilla`)
- Agents: orchestrator, developer (any stack), reviewer, code-reviewer, security, qa,
  docs-writer, legacy-analyst. All answer in the configured response language.
- Standard skills: core, architecture, API contract, data & migrations, testing, security,
  GitHub/CI/deploy.
- Commands: adopt, feature, ticket, verify, review, deep-review, security-audit, review-pr,
  commit, pr, migration, run, qa, deploy-check, analyze-system, find-skill, doctor.
- Hooks: guard (deny/ask guardrails, secret detection), format (config-driven), stop-check
  (multi-language forbidden patterns), session-context.
- `.claude/cuadrilla.json` project configuration shared by hooks, `/cuadrilla:verify` and CI.
- GitHub PR review workflow template (`claude-review.yml`) and CI generator.
- MCP: GitHub (env token), Atlassian (OAuth), Playwright (pinned).

### Stack packs
- `cuadrilla-python-fastapi`, `cuadrilla-dotnet`, `cuadrilla-node-typescript`, `cuadrilla-java-spring`,
  `cuadrilla-react`.

### Optional
- `cuadrilla-codex`: Codex CLI delegation and second-opinion review.
