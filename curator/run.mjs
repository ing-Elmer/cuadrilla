#!/usr/bin/env node
// The Cuadrilla curator: turns anonymous project reports into at most two small, evidence-backed
// changes to the kit's instructions, keeps only those the evals show are better, and opens them
// as draft pull requests for a person to review. It never merges.
//
//   node curator/run.mjs --plan                  # which patterns it would address (free)
//   node curator/run.mjs --yes                   # propose, evaluate, keep accepted branches locally
//   node curator/run.mjs --yes --pr              # … and push them and open draft PRs
//
// Options: --inbox <dir> (default curator/inbox) · --history <file> (default curator/history.json)
//          --base <branch> (default main) · --runs N (evals per version, default 3) · --max N (default 2)
//          --min-projects N (default 2) · --min-count N (default 10) · --cooldown <days> (default 30)
//          --model <m> · --claude <bin> · --budget <usd for the curator session, default 3>
//          --keep (keep rejected branches and sandboxes) · --yes · --pr
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanEnv, compare, loadCases, runClaude } from "../evals/lib.mjs";
import { parseArgs as parseEvalArgs, runEvals as defaultRunEvals } from "../evals/run.mjs";
import { accepted, branchName, checkZone, LIMITS, loadHistory, loadReports, mergeReports, parseNumstat, pickCandidates, saveHistory, suggestFiles } from "./lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const CURATOR_TOOLS = ["Read", "Edit", "Write", "MultiEdit", "Glob", "Grep"]; // no Bash: text edits only
const GIT_ENV = { GIT_AUTHOR_NAME: "cuadrilla-curator", GIT_AUTHOR_EMAIL: "curator@cuadrilla.invalid", GIT_COMMITTER_NAME: "cuadrilla-curator", GIT_COMMITTER_EMAIL: "curator@cuadrilla.invalid" };

export function parseArgs(argv) {
  const options = { inbox: null, history: null, base: "main", runs: 3, max: 2, minProjects: 2, minCount: 10, cooldown: 30, model: null, claude: process.env.CUADRILLA_EVAL_CLAUDE || "claude", budget: 3, keep: false, yes: false, pr: false, plan: false };
  const number = (value, min) => Math.max(min, Number.parseInt(value, 10) || min);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === "--inbox") options.inbox = next();
    else if (arg === "--history") options.history = next();
    else if (arg === "--base") options.base = next();
    else if (arg === "--runs") options.runs = number(next(), 1);
    else if (arg === "--max") options.max = Math.min(2, number(next(), 1));
    else if (arg === "--min-projects") options.minProjects = number(next(), 1);
    else if (arg === "--min-count") options.minCount = number(next(), 1);
    else if (arg === "--cooldown") options.cooldown = number(next(), 0);
    else if (arg === "--model") options.model = next();
    else if (arg === "--claude") options.claude = next();
    else if (arg === "--budget") options.budget = Number(next()) || 3;
    else if (arg === "--keep") options.keep = true;
    else if (arg === "--yes" || arg === "-y") options.yes = true;
    else if (arg === "--pr") options.pr = true;
    else if (arg === "--plan") options.plan = true;
    else throw new Error(`unknown option: ${arg}`);
  }
  return options;
}

function git(args, cwd) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", env: { ...cleanEnv(), ...GIT_ENV } });
  return { ok: result.status === 0, out: (result.stdout ?? "").trim(), err: (result.stderr ?? "").trim() };
}

function mustGit(args, cwd) {
  const result = git(args, cwd);
  if (!result.ok) throw new Error(`git ${args.join(" ")} failed: ${result.err}`);
  return result.out;
}

export function renderPrompt(candidate, { template = readFileSync(join(HERE, "curator.md"), "utf8"), limits = LIMITS } = {}) {
  const evidence = [
    `- Pattern: **${candidate.source}** — \`${candidate.rule}\``,
    `- Seen ${candidate.count} time(s) across ${candidate.projects} project report(s).`,
  ].join("\n");
  const guardrail = candidate.guardRail
    ? "- This rule protects secrets or the repository itself. Being blocked there is the guard doing its job: **never** make the agents more willing to attempt it, and never touch the rule. Only make it easier to do the legitimate thing (for example, reading variable names from `.env.example`)."
    : "";
  return template
    .replaceAll("{{EVIDENCE}}", evidence)
    .replaceAll("{{RULE}}", candidate.rule)
    .replaceAll("{{GUARDRAIL_NOTE}}", guardrail)
    .replaceAll("{{FILES}}", suggestFiles(candidate).map((f) => `   - \`${f}\``).join("\n"))
    .replaceAll("{{MAX_FILES}}", String(limits.files))
    .replaceAll("{{MAX_LINES}}", String(limits.lines));
}

export function curatorArgs({ budget, model }) {
  return [
    "-p",
    "--output-format",
    "json",
    "--no-session-persistence",
    "--setting-sources",
    "project",
    "--strict-mcp-config",
    "--permission-mode",
    "dontAsk",
    "--allowedTools",
    CURATOR_TOOLS.join(","),
    "--max-budget-usd",
    String(budget),
    ...(model ? ["--model", model] : []),
  ];
}

function uniqueBranch(repo, name) {
  let candidate = name;
  for (let n = 2; git(["rev-parse", "--verify", "--quiet", `refs/heads/${candidate}`], repo).ok; n++) candidate = `${name}-${n}`;
  return candidate;
}

function prBody(candidate, explanation, evalMarkdown) {
  return [
    "Proposed by the Cuadrilla curator. **Review before merging**: the evals say it helps, a person decides.",
    "",
    "## Evidence",
    "",
    `- Pattern: **${candidate.source}** — \`${candidate.rule}\``,
    `- Seen ${candidate.count} time(s) across ${candidate.projects} anonymous project report(s).`,
    "",
    explanation.trim(),
    "",
    "## Evals",
    "",
    evalMarkdown.replace(/^# Cuadrilla eval results\n*/, "").trim(),
  ].join("\n");
}

/**
 * One proposal: a branch from `base` in its own worktree, a curator session with file tools
 * only, a zone and size check on the real diff, a commit, the evals against `base`, and a draft
 * PR only when they say it is better.
 */
function propose(candidate, options, ctx) {
  const { repo, scratch, log, runEvals, gh } = ctx;
  const branch = uniqueBranch(repo, branchName(candidate));
  const dir = join(scratch, branch.replace(/\//g, "-"));
  const record = { key: candidate.key, source: candidate.source, rule: candidate.rule, date: new Date().toISOString(), branch, evidence: { count: candidate.count, projects: candidate.projects } };
  mustGit(["worktree", "add", "-q", "-b", branch, dir, options.base], repo);
  const dropBranch = () => {
    git(["worktree", "remove", "--force", dir], repo);
    if (!options.keep) git(["branch", "-D", branch], repo);
  };

  log(`- ${candidate.key}: asking the curator…`);
  const session = runClaude({ bin: options.claude, args: curatorArgs(options), prompt: renderPrompt(candidate), cwd: dir, timeoutMs: 20 * 60_000 });
  record.cost = session.costUsd;
  if (!session.ok) {
    dropBranch();
    return { ...record, outcome: "curator-failed", detail: session.error ?? "no result" };
  }
  if (/^\s*## No change/m.test(session.summary)) {
    dropBranch();
    return { ...record, outcome: "no-change", detail: session.summary.replace(/^\s*## No change\s*/m, "").trim().slice(0, 500) };
  }

  git(["add", "-A"], dir);
  const changes = parseNumstat(git(["diff", "--cached", "--numstat", options.base], dir).out);
  const problems = checkZone(changes);
  if (problems.length) {
    dropBranch();
    return { ...record, outcome: "rejected", detail: problems.join("; ") };
  }
  record.files = changes.map((c) => c.file);
  mustGit(["commit", "-q", "-m", `curator: ${candidate.source} pattern "${candidate.rule}"`, "-m", session.summary.slice(0, 4000)], dir);
  git(["worktree", "remove", "--force", dir], repo);

  log(`  evaluating ${branch} against ${options.base} (${options.runs} run(s) per version)…`);
  const evalOut = join(scratch, `evals-${branch.replace(/\//g, "-")}`);
  const evaluation = runEvals({ ...parseEvalArgs([]), base: options.base, candidate: branch, runs: options.runs, model: options.model, claude: options.claude, out: evalOut, yes: true }, { repo, log: () => {} });
  const comparison = compare(evaluation.summary, "base", "candidate");
  record.verdict = comparison.verdict;
  record.passRate = { base: comparison.base.rate, candidate: comparison.candidate.rate };
  record.cost += evaluation.runs.reduce((sum, r) => sum + (r.claude?.costUsd ?? 0), 0);

  if (!accepted(comparison.verdict)) {
    if (!options.keep) git(["branch", "-D", branch], repo);
    return { ...record, outcome: "not-better" };
  }
  if (!options.pr) return { ...record, outcome: "accepted-local" };

  const push = git(["push", "-q", "-u", "origin", branch], repo);
  if (!push.ok) return { ...record, outcome: "accepted-local", detail: `push failed: ${push.err}` };
  const bodyFile = join(scratch, `${branch.replace(/\//g, "-")}.md`);
  writeFileSync(bodyFile, prBody(candidate, session.summary, readFileSync(join(evalOut, "summary.md"), "utf8")));
  const pr = gh(["pr", "create", "--draft", "--base", options.base, "--head", branch, "--title", `curator: ${candidate.source} pattern "${candidate.rule}"`.slice(0, 120), "--body-file", bodyFile], repo);
  return { ...record, outcome: pr.ok ? "proposed" : "pushed", pr: pr.ok ? pr.out.split("\n").pop() : null, detail: pr.ok ? undefined : `gh pr create failed: ${pr.err}` };
}

const defaultGh = (args, cwd) => {
  const result = spawnSync("gh", args, { cwd, encoding: "utf8", env: cleanEnv() });
  return { ok: result.status === 0, out: (result.stdout ?? "").trim(), err: (result.stderr ?? result.error?.message ?? "").trim() };
};

export function runCurator(options, { repo = REPO, log = (line) => process.stdout.write(`${line}\n`), runEvals = defaultRunEvals, gh = defaultGh, now = Date.now() } = {}) {
  const inbox = resolve(repo, options.inbox ?? join("curator", "inbox"));
  const historyFile = resolve(repo, options.history ?? join("curator", "history.json"));
  const { reports, rejected } = loadReports(inbox);
  for (const reason of rejected) log(`! report skipped — ${reason}`);
  if (!reports.length) {
    log(`No anonymous reports in ${inbox}. Collect them with /cuadrilla:report 30 anonymous --json --save in each project.`);
    return { candidates: [], results: [] };
  }

  const history = loadHistory(historyFile);
  const candidates = pickCandidates(mergeReports(reports), history, { max: options.max, minProjects: options.minProjects, minCount: options.minCount, cooldownDays: options.cooldown, now });
  log(`${reports.length} report(s) · ${candidates.length} pattern(s) to address${candidates.length ? ":" : "."}`);
  for (const c of candidates) log(`  - ${c.source} \`${c.rule}\`: ${c.count} time(s) in ${c.projects} project(s)${c.guardRail ? " (protective rule: never loosened)" : ""}`);
  if (options.plan || !candidates.length) return { candidates, results: [] };

  if (git(["status", "--porcelain", "--untracked-files=no"], repo).out) log("! the kit has uncommitted changes; proposals start from the committed base branch.");
  const scratch = mkdtempSync(join(tmpdir(), "cuadrilla-curator-"));
  const results = [];
  try {
    for (const candidate of candidates) {
      let result;
      try {
        result = propose(candidate, options, { repo, scratch, log, runEvals, gh });
      } catch (error) {
        result = { key: candidate.key, source: candidate.source, rule: candidate.rule, date: new Date().toISOString(), outcome: "error", detail: error.message };
      }
      results.push(result);
      log(`  → ${result.outcome}${result.verdict ? ` (${result.verdict})` : ""}${result.pr ? ` ${result.pr}` : ""}${result.detail ? ` — ${result.detail}` : ""}`);
    }
  } finally {
    mkdirSync(dirname(historyFile), { recursive: true });
    saveHistory(historyFile, [...history, ...results]);
    if (!options.keep) rmSync(scratch, { recursive: true, force: true });
    else log(`Sandboxes kept in ${scratch}`);
  }
  return { candidates, results };
}

const isMain = Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (!options.plan && !options.yes) {
      const { cases } = loadCases(join(REPO, "evals", "cases"));
      const perProposal = options.budget + cases.reduce((sum, c) => sum + (c.maxBudgetUsd ?? 2), 0) * options.runs * 2;
      process.stdout.write(`Each proposal runs a curator session (up to $${options.budget}) and the evals against ${options.base} (${options.runs} run(s) × 2 versions × every case). Expect up to ~$${(perProposal * options.max).toFixed(0)} for ${options.max} proposal(s). Use --plan to preview for free, or --yes to proceed.\n`);
      process.exit(2);
    }
    runCurator(options);
  } catch (error) {
    process.stderr.write(`✖ ${error.message}\n`);
    process.exit(1);
  }
}
