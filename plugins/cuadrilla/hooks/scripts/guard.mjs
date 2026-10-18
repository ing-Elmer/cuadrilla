#!/usr/bin/env node
// PreToolUse — the hard guardrails. Plugins can't ship permission rules, so this hook is where
// the limits live. It inspects the WHOLE command (not just its prefix), so chained, wrapped or
// alternative forms are caught too ("cd x && git push", "bash -c '...'", "type .env").
//
// deny: push, history rewrites, recursive deletes, skipping git hooks, merging/approving PRs,
//       repo secrets, deploys and infra changes, publishing packages, unsandboxed agents,
//       reading/dumping secret files or the environment, writing secrets into files.
// ask:  SQL against a database, running DB migrations, merge/rebase, force-installs.
import {
  ask,
  commandTouchesProtected,
  deny,
  isProtectedPath,
  loadConfig,
  projectRoot,
  readInput,
} from "./lib.mjs";

// "git <options> <subcommand>" within one command segment (up to | ; & or newline).
const GIT = String.raw`\bgit\b[^|;&\n]*?\s`;
const SEG = String.raw`[^|;&\n]*`;

const DENY = [
  [new RegExp(`${GIT}push\\b`, "i"), "git push is not allowed: a person pushes."],
  [new RegExp(`${GIT}reset\\b${SEG}--hard\\b`, "i"), "git reset --hard discards work irreversibly."],
  [new RegExp(`${GIT}clean\\b${SEG}\\s-\\w*f`, "i"), "git clean -f deletes untracked files."],
  [new RegExp(`${GIT}(?:filter-branch|filter-repo)\\b`, "i"), "Rewriting git history is not allowed."],
  [new RegExp(`${GIT}checkout\\b${SEG}\\s--\\s+\\.(?:\\s|$)`, "i"), "git checkout -- . discards all local changes."],
  [/--no-verify\b|\bcore\.hooksPath\b/i, "Git hooks are not skipped (--no-verify / core.hooksPath)."],
  [/\brm\s+(?:-\w*\s+)*-\w*(?:r\w*f|f\w*r)\w*\b/i, "rm -rf is not allowed."],
  [/\bRemove-Item\b[^|;&]*-Recurse\b/i, "Remove-Item -Recurse is not allowed."],
  [/\b(?:rmdir|rd)\s+\/s\b|\bdel\s+\/s\b/i, "Recursive delete is not allowed."],
  [/\bgh\s+pr\s+(?:merge|review|ready)\b/i, "Merging, approving or marking PRs ready is done by a person."],
  [/\bgh\s+(?:secret|variable|release|ruleset)\b|\bgh\s+repo\s+(?:delete|edit|rename|archive)\b/i, "Repository settings are not changed by Claude."],
  [/\bgh\s+api\b[^|;&]*(?:-X|--method)\s*(?:POST|PUT|PATCH|DELETE)\b/i, "gh api with write methods is not allowed."],
  [/danger-full-access|dangerously-bypass-approvals-and-sandbox|--dangerously-skip-permissions|--yolo\b/i, "Agents are never run without a sandbox."],
  [/\bprintenv\b|^\s*env\s*$|\b(?:Get-ChildItem|gci|dir|ls)\s+env:|\/proc\/[^\s]*\/environ|\[Environment\]::GetEnvironmentVariables|^\s*set\s*$|^\s*export\s+-p\s*$/im, "Environment variables are not dumped: they may hold secrets."],
  [/\b(?:railway|vercel|netlify|fly|flyctl|heroku|firebase|amplify|wrangler|serverless|sls)\s+(?:up|deploy|redeploy|down|delete|destroy|remove|rm|promote)\b|\bvercel\s+--prod\b/i, "Deploys are done by CI/CD or a person."],
  [/\b(?:az|aws|gcloud)\b[^|;&\n]*\s(?:delete|destroy|deploy|create|update|put|set-iam|add-iam|rm)\b/i, "Cloud resources are not changed by Claude."],
  [/\bkubectl\s+(?:apply|delete|create|replace|patch|scale|rollout|edit|drain)\b|\bhelm\s+(?:install|upgrade|uninstall|rollback)\b/i, "Cluster changes are not made by Claude."],
  [/\b(?:terraform|tofu|pulumi)\s+(?:apply|destroy|import|up)\b/i, "Infrastructure changes are applied by a person."],
  [/\bdocker\s+(?:push|login)\b|\bdocker\s+system\s+prune\b/i, "Pushing images / docker login / prune are done by a person."],
  [/\b(?:npm|pnpm|yarn)\s+publish\b|\btwine\s+upload\b|\buv\s+publish\b|\bdotnet\s+nuget\s+push\b|\bmvnw?\b[^|;&\n]*\bdeploy\b|\bcargo\s+publish\b|\bgradlew?\b[^|;&\n]*\bpublish\b/i, "Publishing packages is done by a person."],
];

const ASK = [
  [new RegExp(`${GIT}(?:merge|rebase)\\b(?!${SEG}--(?:abort|continue|quit))`, "i"), "merge/rebase: confirm this is not a shared branch (shared branches are integrated through PRs)."],
  [/\b(?:alembic\s+(?:upgrade|downgrade)|dotnet\s+ef\s+database\s+(?:update|drop)|prisma\s+(?:migrate\s+(?:deploy|reset|dev)|db\s+(?:push|execute))|knex\s+migrate|sequelize\s+db:migrate|flyway\b[^|;&\n]*\b(?:migrate|clean)|liquibase\b[^|;&\n]*\bupdate|rails\s+db:|rake\s+db:|django-admin\s+migrate|manage\.py\s+migrate|goose\b[^|;&\n]*\bup|migrate\s+-path)/i, "This runs database migrations: it requires the user's explicit confirmation."],
  [/\b(?:npm|pnpm|yarn)\s+[^|;&\n]*--force\b|\bnpm\s+audit\s+fix\b/i, "Forced installs / audit fix change many dependencies: confirm first."],
];

const SQL_CLIENTS = /\b(?:psql|mysql|mariadb|sqlcmd|sqlplus|sqlite3|mongosh|mongo|redis-cli|cqlsh|bq\s+query|clickhouse-client)\b/i;
const SQL_WRITE = /\b(?:insert|update|delete|drop|alter|truncate|create|grant|revoke|merge|replace|flushall|flushdb|dropDatabase)\b/i;

// Real secret patterns. Placeholders typical of .env.example files are not flagged.
const SECRETS = [
  [/-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP |ENCRYPTED )?PRIVATE KEY-----/, "private key"],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/, "AWS access key"],
  [/\bsk-ant-[A-Za-z0-9_-]{20,}/, "Anthropic API key"],
  [/\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}/, "OpenAI API key"],
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}/, "GitHub token"],
  [/\bglpat-[A-Za-z0-9_-]{20,}/, "GitLab token"],
  [/\bxox[abpr]-[A-Za-z0-9-]{10,}/, "Slack token"],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, "Google API key"],
  [/\b(?:sk|rk)_live_[A-Za-z0-9]{20,}/, "Stripe live key"],
  [/\bSG\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/, "SendGrid key"],
  [/\beyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{20,}/, "JWT"],
  [/AccountKey=[A-Za-z0-9+/=]{40,}/, "Azure storage key"],
];
const DSN_WITH_PASSWORD = /\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|rediss|amqps?|mssql|sqlserver|oracle):\/\/[^:\s/@]+:([^@\s/]+)@/gi;
// ADO.NET / JDBC-style "Server=...;Password=...;" — only inside a line that is clearly a
// connection string, so C# code like `user.Password = request.Password` is not flagged.
const CONN_STRING_LINE = /(?:Server|Host|Data Source|Initial Catalog|Database|Uid|User ?Id)\s*=[^;\n]*;/i;
const CONN_STRING_PASSWORD = /(?:^|[;"'])\s*(?:Password|Pwd)\s*=\s*([^;"'\s]+)/gi;
const PLACEHOLDER = /^(?:\$\{.*\}|\$\(.*\)|\{\{.*\}\}|%.*%|<.*>|\*+|x+|\.\.\.|password|passw0rd|contrase(?:ñ|n)a|senha|changeme|change_me|cambiar|secret|postgres|root|admin|test|dummy|example|ejemplo|pass|usuario|user|your_?password|tu_?password|placeholder)$/i;

/**
 * The text that actually executes: the command without the CONTENT of quoted strings (a commit
 * message saying "push" is not a push), except one-word quoted arguments (paths like ".env") and
 * whatever is handed to another interpreter (bash -c "...").
 */
function executableText(command) {
  const inner = [];
  const interpreter = /\b(?:bash|sh|zsh|pwsh|powershell(?:\.exe)?|cmd(?:\.exe)?|eval|Invoke-Expression|iex|xargs)\b[^"']*?(["'])([\s\S]*?)\1/gi;
  for (const match of command.matchAll(interpreter)) inner.push(match[2]);
  const stripped = command.replace(/"([^"]*)"|'([^']*)'/g, (_, double, single) => {
    const content = double ?? single ?? "";
    return /\s/.test(content) ? '""' : content;
  });
  return [stripped, ...inner].join("\n");
}

function checkCommand(original, protectedExtra) {
  const command = executableText(original);
  for (const [pattern, reason] of DENY) if (pattern.test(command)) deny(`Blocked by cuadrilla guard: ${reason}`);
  if (commandTouchesProtected(command, protectedExtra)) {
    deny(
      "Blocked by cuadrilla guard: secret files (.env, keys, certificates, credentials) are not read or modified " +
        "through commands. Use the .example file to learn variable names.",
    );
  }
  if (SQL_CLIENTS.test(command) && (SQL_WRITE.test(original) || /\s(?:-f|-i|--file|<)\s*\S/.test(original))) {
    ask("SQL against a database: requires the user's explicit confirmation.");
  }
  for (const [pattern, reason] of ASK) if (pattern.test(command)) ask(reason);
}

function findSecret(text) {
  if (!text) return null;
  for (const [pattern, name] of SECRETS) if (pattern.test(text)) return name;
  for (const match of text.matchAll(DSN_WITH_PASSWORD)) {
    if (!PLACEHOLDER.test(match[1])) return "connection string with a password";
  }
  for (const line of text.split("\n")) {
    if (!CONN_STRING_LINE.test(line)) continue;
    for (const match of line.matchAll(CONN_STRING_PASSWORD)) {
      if (!PLACEHOLDER.test(match[1])) return "connection string with a password";
    }
  }
  return null;
}

const input = await readInput();
const { config } = loadConfig(projectRoot(input));
const protectedExtra = Array.isArray(config.protectedPaths) ? config.protectedPaths : [];
const tool = input.tool_name ?? "";
const data = input.tool_input ?? {};

if (tool === "Bash" || tool === "PowerShell") {
  checkCommand(String(data.command ?? ""), protectedExtra);
} else {
  const paths =
    tool === "Grep"
      ? [data.path, data.glob]
      : [data.file_path, data.path, data.notebook_path, tool === "Glob" ? data.pattern : undefined];
  if (paths.some((p) => typeof p === "string" && isProtectedPath(p, protectedExtra))) {
    deny("Blocked by cuadrilla guard: secret files are not read, searched or edited. Use the .example file.");
  }
  if (tool === "Write" || tool === "Edit" || tool === "MultiEdit") {
    const texts = [data.content, data.new_string, ...(data.edits ?? []).map((edit) => edit?.new_string)];
    for (const text of texts) {
      const secret = findSecret(typeof text === "string" ? text : "");
      if (secret) {
        deny(
          `Blocked by cuadrilla guard: the content looks like it contains a secret (${secret}). ` +
            "Secrets live in environment variables or a secret manager; the repo only holds names and fake values.",
        );
      }
    }
  }
}
process.exit(0);
