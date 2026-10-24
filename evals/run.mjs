#!/usr/bin/env node
// Runs the Cuadrilla evals: reference tasks solved by the agent team in unattended mode, judged
// by checks, hidden tests and expectations, optionally comparing two versions of the kit.
//
//   node evals/run.mjs --dry-run                         # validate every case, no Claude, no cost
//   node evals/run.mjs                                   # every case with the working tree
//   node evals/run.mjs --base main --runs 3              # main vs working tree, 3 runs each
//   node evals/run.mjs --base v1.1.0 --candidate HEAD --case node-slugify-bug
//
// Options: --case <id> (repeatable) · --runs N · --base <ref> · --candidate <ref> · --model <m>
//          --claude <bin> (default: claude, or $CUADRILLA_EVAL_CLAUDE) · --budget <usd per run>
//          --out <dir> · --keep (keep the sandboxes) · --yes (skip the cost notice)
//
// Every run costs real money: cases × runs × versions, each capped by the case's maxBudgetUsd.
// Run it in a container or VM: the agent executes commands inside a temporary project.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { claudeArgs, evaluate, failureReasons, loadCases, overlay, passed, prepareProject, runClaude, summarize, toMarkdown } from "./lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");

export function parseArgs(argv) {
  const options = { cases: [], runs: 1, base: null, candidate: null, model: null, claude: process.env.CUADRILLA_EVAL_CLAUDE || "claude", budget: null, out: null, keep: false, dryRun: false, yes: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === "--case") options.cases.push(next());
    else if (arg === "--runs") options.runs = Math.max(1, Number.parseInt(next(), 10) || 1);
    else if (arg === "--base") options.base = next();
    else if (arg === "--candidate") options.candidate = next();
    else if (arg === "--model") options.model = next();
    else if (arg === "--claude") options.claude = next();
    else if (arg === "--budget") options.budget = Number(next()) || null;
    else if (arg === "--out") options.out = next();
    else if (arg === "--keep") options.keep = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--yes" || arg === "-y") options.yes = true;
    else throw new Error(`unknown option: ${arg}`);
  }
  return options;
}

// --- Kit versions ---------------------------------------------------------------------------

function kitVersion(label, ref, scratch, repo) {
  if (!ref) return { label, ref: null, plugins: join(repo, "plugins"), cleanup: () => {} };
  const dir = join(scratch, `kit-${label}`);
  const added = spawnSync("git", ["worktree", "add", "--detach", "--force", dir, ref], { cwd: repo, encoding: "utf8" });
  if (added.status !== 0) throw new Error(`can't check out ${ref}: ${added.stderr.trim()}`);
  return {
    label,
    ref,
    plugins: join(dir, "plugins"),
    cleanup: () => spawnSync("git", ["worktree", "remove", "--force", dir], { cwd: repo }),
  };
}

export function resolveVersions(options, scratch, repo = REPO) {
  if (!options.base) return [kitVersion(options.candidate ? "candidate" : "working-tree", options.candidate, scratch, repo)];
  return [kitVersion("base", options.base, scratch, repo), kitVersion("candidate", options.candidate, scratch, repo)];
}

function pluginDirs(version, caseDef) {
  const dirs = [join(version.plugins, "cuadrilla"), ...(caseDef.stacks ?? []).map((stack) => join(version.plugins, `cuadrilla-${stack}`))];
  const missing = dirs.filter((d) => !existsSync(join(d, ".claude-plugin", "plugin.json")));
  return { dirs, missing };
}

// --- Dry run --------------------------------------------------------------------------------

/**
 * Proves each case is a fair test without calling Claude: the untouched fixture must FAIL the
 * checks once the hidden tests are in (otherwise the task tests nothing), and the reference
 * solution, when present, must PASS checks and diff expectations (otherwise it is unsolvable).
 */
export function dryRun(cases, scratch) {
  const problems = [];
  for (const caseDef of cases) {
    const untouched = prepareProject(caseDef, mkdtempSync(join(scratch, `${caseDef.id}-fixture-`)));
    const before = spawnSync("git", ["rev-parse", "main"], { cwd: untouched.origin, encoding: "utf8" }).stdout.trim();
    const fixtureResult = evaluate(caseDef, untouched, { originMainBefore: before, skipPushExpectations: true });
    if (fixtureResult.checks.every((c) => c.ok)) problems.push(`${caseDef.id}: the untouched fixture already passes every check — the case tests nothing`);

    const sandbox = prepareProject(caseDef, mkdtempSync(join(scratch, `${caseDef.id}-reference-`)));
    if (!overlay(caseDef, "reference", sandbox.project)) {
      problems.push(`${caseDef.id}: no reference/ solution, so nobody has proven the case can be solved`);
      continue;
    }
    const originBefore = spawnSync("git", ["rev-parse", "main"], { cwd: sandbox.origin, encoding: "utf8" }).stdout.trim();
    const result = evaluate(caseDef, sandbox, { originMainBefore: originBefore, skipPushExpectations: true });
    for (const check of result.checks.filter((c) => !c.ok)) problems.push(`${caseDef.id}: the reference solution fails "${check.name}":\n${check.tail}`);
    for (const e of result.expectations.filter((x) => !x.ok)) problems.push(`${caseDef.id}: the reference solution breaks "${e.name}"${e.detail ? ` (${e.detail})` : ""}`);
  }
  return problems;
}

// --- Main -----------------------------------------------------------------------------------

export function runEvals(options, { repo = REPO, log = (line) => process.stdout.write(`${line}\n`) } = {}) {
  const { cases, errors } = loadCases(join(repo, "evals", "cases"), options.cases);
  if (errors.length) throw new Error(`invalid cases:\n${errors.map((e) => `  - ${e}`).join("\n")}`);
  if (!cases.length) throw new Error("no cases to run");
  const scratch = mkdtempSync(join(tmpdir(), "cuadrilla-evals-"));

  try {
    if (options.dryRun) {
      const problems = dryRun(cases, scratch);
      if (problems.length) throw new Error(`case self-check failed:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
      log(`✔ ${cases.length} case(s) valid: fixtures fail the hidden tests and the reference solutions pass them.`);
      return { dryRun: true, cases: cases.length };
    }

    const versions = resolveVersions(options, scratch, repo);
    const runs = [];
    try {
      for (const caseDef of cases) {
        for (const version of versions) {
          for (let n = 1; n <= options.runs; n++) {
            const tag = `${caseDef.id} · ${version.label} · run ${n}/${options.runs}`;
            const plugins = pluginDirs(version, caseDef);
            if (plugins.missing.length) {
              runs.push({ caseId: caseDef.id, version: version.label, run: n, skipped: `plugin missing in this version (${plugins.missing.map((d) => d.split(/[/\\]/).pop()).join(", ")})` });
              log(`- ${tag}: skipped (plugin missing in this version)`);
              continue;
            }
            const workDir = mkdtempSync(join(scratch, `${caseDef.id}-${version.label}-${n}-`));
            const sandbox = prepareProject(caseDef, workDir);
            const originMainBefore = spawnSync("git", ["rev-parse", "main"], { cwd: sandbox.origin, encoding: "utf8" }).stdout.trim();
            log(`- ${tag}: running…`);
            const claude = runClaude({
              bin: options.claude,
              args: claudeArgs({ pluginDirs: plugins.dirs, maxBudgetUsd: options.budget ?? caseDef.maxBudgetUsd, model: options.model }),
              prompt: caseDef.prompt,
              cwd: sandbox.project,
              timeoutMs: (caseDef.timeoutMinutes ?? 15) * 60_000,
            });
            const judged = evaluate(caseDef, sandbox, { originMainBefore });
            const run = { caseId: caseDef.id, version: version.label, run: n, claude, ...judged, sandbox: options.keep ? workDir : null };
            run.passed = passed(run);
            runs.push(run);
            log(`  ${run.passed ? "✔ passed" : `✖ ${failureReasons(run).join("; ")}`} · $${claude.costUsd.toFixed(2)} · ${claude.turns} turns`);
          }
        }
      }
    } finally {
      for (const version of versions) version.cleanup();
    }

    const summary = summarize(runs);
    const date = new Date().toISOString();
    const markdown = toMarkdown(summary, versions, { date, runs: options.runs, model: options.model });
    const out = resolve(options.out ?? join(repo, "evals", "results", date.replace(/[:.]/g, "-")));
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, "results.json"), `${JSON.stringify({ date, options: { ...options, claude: undefined }, versions: versions.map(({ label, ref }) => ({ label, ref })), summary, runs }, null, 2)}\n`);
    writeFileSync(join(out, "summary.md"), `${markdown}\n`);
    log(`\n${markdown}\n\nResults saved to ${out}`);
    return { summary, runs, out };
  } finally {
    if (!options.keep) rmSync(scratch, { recursive: true, force: true });
    else log(`Sandboxes kept in ${scratch}`);
  }
}

const isMain = Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (!options.dryRun && !options.yes) {
      const { cases } = loadCases(join(REPO, "evals", "cases"), options.cases);
      const versions = options.base ? 2 : 1;
      const cap = cases.reduce((sum, c) => sum + (options.budget ?? c.maxBudgetUsd ?? 2), 0) * options.runs * versions;
      process.stdout.write(`This runs ${cases.length} case(s) × ${options.runs} run(s) × ${versions} version(s) with real Claude calls (up to $${cap.toFixed(2)}). Add --yes to proceed.\n`);
      process.exit(2);
    }
    runEvals(options);
  } catch (error) {
    process.stderr.write(`✖ ${error.message}\n`);
    process.exit(1);
  }
}
