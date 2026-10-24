#!/usr/bin/env node
// SessionStart — gives Claude, before the first prompt, the real state of the repository and
// the team's ground rules. Plugins can't ship CLAUDE.md, so the always-on rules travel here.
// Facts only, phrased as statements.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  agentBranchPrefix,
  CONFIG_PATH,
  git,
  loadConfig,
  projectRoot,
  readInput,
  respond,
  responseLanguage,
  unattendedMode,
} from "./lib.mjs";

const input = await readInput();
const root = projectRoot(input);
const { config, exists: hasConfig, error } = loadConfig(root);
const lines = ["cuadrilla — project state at session start:"];

const branch = git(["rev-parse", "--abbrev-ref", "HEAD"], root, 5_000);
if (branch.ok) {
  lines.push(`- Current branch: ${branch.output.trim()}.`);
  const status = git(["status", "--porcelain"], root, 10_000);
  if (status.ok) {
    const changes = status.output.split("\n").filter(Boolean);
    const untracked = changes.filter((l) => l.startsWith("??")).length;
    lines.push(changes.length ? `- Uncommitted changes: ${changes.length} files (${untracked} untracked).` : "- Working tree is clean.");
  }
} else {
  lines.push("- This folder is not a git repository.");
}

const claudeMd = join(root, "CLAUDE.md");
if (existsSync(claudeMd)) {
  const content = readFileSync(claudeMd, "utf8");
  const profile = content.split(/^## (?:Project profile|Perfil del proyecto|Perfil do projeto)\s*$/im)[1];
  if (profile === undefined) {
    lines.push("- CLAUDE.md has no '## Project profile' section yet (/cuadrilla:adopt creates it).");
  } else {
    const section = profile.split(/^## (?!#)/m)[0];
    const pending = (section.match(/\bTODO\b|<[A-Za-z][^>\n]{0,40}>/g) ?? []).length;
    lines.push(pending ? `- Project profile present, with ${pending} pending values (TODO or <placeholder>).` : "- Project profile present and complete.");
  }
} else {
  lines.push("- There is no CLAUDE.md at the root (/cuadrilla:adopt creates the project profile).");
}

if (error) lines.push(`- ${error}`);
else if (hasConfig) {
  const components = (config.components ?? []).map((c) => `${c.name ?? c.path} (${c.stack ?? "generic"}, ${c.path})`);
  lines.push(`- ${CONFIG_PATH}: components ${components.length ? components.join("; ") : "none declared"}.`);
} else {
  lines.push(`- ${CONFIG_PATH} does not exist: /cuadrilla:verify and the format hook use built-in defaults until /cuadrilla:adopt creates it.`);
}

for (const folder of new Set(["", ...(config.components ?? []).map((c) => c.path ?? "")])) {
  const base = join(root, folder);
  if (!existsSync(base)) continue;
  const env = existsSync(join(base, ".env"));
  const example = existsSync(join(base, ".env.example"));
  if (env || example) lines.push(`- ${folder || "."}/.env ${env ? "exists" : "does not exist"}; .env.example ${example ? "exists" : "does not exist"}.`);
}

const language = responseLanguage(config);
lines.push(
  "",
  "cuadrilla ground rules for this session:",
  `- The team answers, writes code comments, docs, UI text and commit messages in ${language}.`,
  "- Names, paths, schemas, ports and commands come from the project profile (CLAUDE.md) and .claude/cuadrilla.json; they are never assumed.",
  "- Precedence: project profile exceptions > cuadrilla standard skills (standard-*) > third-party skills > general knowledge.",
  "- A task is finished only after the area's checks run and their real result is reported.",
  "- Nobody pushes, merges or approves PRs, runs SQL or migrations without explicit confirmation, deploys, or writes secrets. The guard hook enforces this; a block is explained to the user, never worked around.",
  "- Temporary files (logs, tokens, JSON responses, screenshots) go to the session scratchpad, never into the repo.",
);

if (unattendedMode()) {
  const prefix = agentBranchPrefix();
  lines.push(
    "",
    "cuadrilla UNATTENDED MODE — nobody is watching this session and nobody can answer a question or a confirmation:",
    "- Never stop to ask. Make the most reasonable decision, write it down in the PR description under 'Decisions taken', and continue.",
    "- Anything that would need a confirmation (merge/rebase, SQL, migrations, forced installs) is blocked: do not attempt it. Leave a migration script unexecuted and say so in the PR.",
    `- Work on a branch named ${prefix}<ticket or short-description>, never on the base branch.`,
    `- When the work is done and its checks pass, push exactly with \`git push -u origin ${prefix}<name>\` (one command, nothing chained) and open the PR with \`gh pr create --draft\`.`,
    "- If the checks cannot be made to pass, still push the branch and open the draft PR, with the failing check and what was tried listed at the top of the description.",
    "- Never merge, approve or mark a PR as ready: a person reviews every change.",
  );
}

respond({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: lines.join("\n") } });
