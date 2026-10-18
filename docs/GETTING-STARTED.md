# Getting started

## 1. Install (5 minutes)

1. Make sure you have Claude Code, **Node.js ≥ 18** (`node --version`) and git, and that git can
   read the private cuadrilla repository **without prompting** (Claude Code never asks for
   credentials):
   - SSH: a key loaded in `ssh-agent`, with github.com in `known_hosts`; or
   - HTTPS: `gh auth login` then `gh auth setup-git`, and set the environment variable
     `CLAUDE_CODE_PLUGIN_PREFER_HTTPS=1` if you have no GitHub SSH key.
   Optional: in `/plugin` → Marketplaces → cuadrilla → **Enable auto-update** to receive updates.
2. In Claude Code:
   ```text
   /plugin marketplace add <your-org>/cuadrilla
   /plugin install cuadrilla@cuadrilla
   ```
   Pick the **response language** when asked (you can change it later in `/config`).
3. Install the packs for your stacks (any combination):
   ```text
   /plugin install cuadrilla-python-fastapi@cuadrilla
   /plugin install cuadrilla-dotnet@cuadrilla
   /plugin install cuadrilla-node-typescript@cuadrilla
   /plugin install cuadrilla-java-spring@cuadrilla
   /plugin install cuadrilla-react@cuadrilla
   ```
   No pack for your language (Go, Rust, PHP, Ruby, Kotlin…)? The core works anyway with the
   `developer` agent and the language-agnostic standard.
4. Restart Claude Code in your project. The first message should show the cuadrilla session
   context (branch, profile status).

## 2. Adopt the standard in a project

```text
/cuadrilla:adopt          # existing repository
/cuadrilla:adopt new      # empty folder / new project
```

It walks you through checkpoints — nothing is written without your OK:

1. Detects components (`backend/`, `frontend/`…) and their stacks.
2. Writes `.claude/cuadrilla.json` (setup, checks, format, lint, start, audit per component) and
   runs each check once to confirm the commands exist.
3. Writes the `## Project profile` in `CLAUDE.md`.
4. Generates `.github/workflows/ci.yml` (one `ci-<component>` job each),
   `claude-review.yml`, PR template, dependabot and CODEOWNERS.
5. Offers project permission rules in `.claude/settings.json`.
6. Recommends third-party skills for your stacks and vets them before installing.
7. Reports gaps against the standard into `## Known technical debt`.
8. Gives you the manual checklist (branch protection, Claude GitHub App + secret, deploy
   platform, MCP credentials).

Run `/cuadrilla:doctor` afterwards.

## 3. Daily work

| You want to… | Do |
|---|---|
| Build a feature | describe it, or `/cuadrilla:feature Orders "list and create orders"` |
| Work a ticket | `/cuadrilla:ticket PROJ-123` or `/cuadrilla:ticket #42` |
| Check everything like CI | `/cuadrilla:verify` |
| Review before a PR | `/cuadrilla:review` (standard) · `/cuadrilla:deep-review` (technical) |
| Commit and open a PR | `/cuadrilla:commit` → push yourself → `/cuadrilla:pr` |
| Review a teammate's PR | `/cuadrilla:review-pr 57` (add `--comment` to post a summary) |
| Test in a browser | `/cuadrilla:qa "create an order as SALES"` |
| Before deploying | `/cuadrilla:deploy-check` + `/cuadrilla:security-audit` |

## 4. MCP credentials (optional)

Set environment variables in your OS (never in the repo):

- `GITHUB_PAT` — GitHub fine-grained token (this repo; read + "Pull requests: write" if Claude
  should comment) for the `github` MCP. Without it, cuadrilla uses the `gh` CLI.
- `POSTGRES_MCP_DSN` — connection to a **local** database with a read-only user, for the
  read-only `postgres` MCP of the Python and Node packs.
- Atlassian: run `/mcp` and log in.

How to set an environment variable (then **restart Claude Code**):

| OS | Command |
|---|---|
| Windows (PowerShell) | `setx GITHUB_PAT "<token>"` |
| macOS / Linux | add `export GITHUB_PAT="<token>"` to `~/.zshrc` or `~/.bashrc` |

Both MCP servers are optional. If you don't set them up, `/mcp` and `/cuadrilla:doctor` will list
`github` as failed ("Authorization header is badly formatted") and `atlassian` as "needs OAuth".
That is expected: everything else works, and GitHub tasks use the `gh` CLI instead.

## 5. Troubleshooting

- **`github` MCP shows as failed ("Authorization header is badly formatted").** `GITHUB_PAT` is not
  set. Set it (section 4) and restart Claude Code, or ignore it and use the `gh` CLI.
- **"Session-context hook not seen" in `/cuadrilla:doctor`.** The plugin was installed after the
  session started. Restart Claude Code.

- **A hook blocked something legitimate.** Read the reason. Secret file false positive → adjust
  `protectedPaths`; pattern false positive → adjust `forbidden` / `builtinPatterns` in
  `.claude/cuadrilla.json`. Report real false positives to the vendor with the command and reason.
- **Format hook does nothing.** The component has no `format` entry and no built-in default
  applies (only ruff, Prettier and gofmt are defaults). Add a fast single-file formatter to
  `cuadrilla.json`.
- **"node: command not found" in hooks.** Install Node.js ≥ 18 and restart Claude Code.
- Anything else: `/cuadrilla:doctor`.
