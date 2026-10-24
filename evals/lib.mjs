// Cuadrilla evals — the pieces of the runner, kept importable so they can be tested without
// calling Claude. See evals/README.md for what a case is and how to run them.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { matchesGlob } from "../plugins/cuadrilla/hooks/scripts/lib.mjs";

export const EVAL_NOTE =
  "This is an automated evaluation sandbox. There is no GitHub here, so skip opening a pull request " +
  "(pushing to the local origin works). Everything else follows the project's rules.";

export const ALLOWED_TOOLS = ["Bash", "Read", "Edit", "Write", "MultiEdit", "Glob", "Grep", "Agent", "Task", "Skill", "TodoWrite"];

const GIT_ENV = {
  GIT_AUTHOR_NAME: "cuadrilla-eval",
  GIT_AUTHOR_EMAIL: "eval@cuadrilla.invalid",
  GIT_COMMITTER_NAME: "cuadrilla-eval",
  GIT_COMMITTER_EMAIL: "eval@cuadrilla.invalid",
};

/**
 * Environment for anything the runner starts. NODE_TEST_CONTEXT is removed because when the
 * runner itself runs under `node --test` (as in CI), a child `node --test` would report to the
 * parent instead of failing, and a broken project would look green.
 */
export function cleanEnv(base = process.env) {
  const env = { ...base };
  delete env.NODE_TEST_CONTEXT;
  return env;
}

// --- Cases ----------------------------------------------------------------------------------

/** Returns the list of problems with a case definition (empty = valid). */
export function validateCase(definition, dir) {
  const errors = [];
  const need = (cond, message) => cond || errors.push(message);
  need(definition && typeof definition === "object", "case.json is not an object");
  if (!errors.length) {
    need(typeof definition.id === "string" && /^[a-z0-9][a-z0-9-]*$/.test(definition.id), "id must be kebab-case");
    need(typeof definition.prompt === "string" && definition.prompt.trim().length > 20, "prompt is missing or too short");
    need(Array.isArray(definition.checks) && definition.checks.length > 0, "checks must list at least one command");
    for (const check of definition.checks ?? []) need(typeof check?.run === "string" && typeof check?.name === "string", "every check needs name and run");
    for (const key of ["stacks", "mustChange", "mustNotChange", "forbiddenInDiff"]) {
      need(definition[key] === undefined || Array.isArray(definition[key]), `${key} must be an array`);
    }
    for (const rule of definition.forbiddenInDiff ?? []) {
      need(typeof rule?.pattern === "string" && typeof rule?.message === "string", "every forbiddenInDiff entry needs pattern and message");
      if (typeof rule?.pattern === "string" && !rule.literal) {
        try {
          new RegExp(rule.pattern);
        } catch {
          errors.push(`invalid regex: ${rule.pattern}`);
        }
      }
    }
    need(definition.timeoutMinutes === undefined || definition.timeoutMinutes > 0, "timeoutMinutes must be positive");
    need(definition.maxBudgetUsd === undefined || definition.maxBudgetUsd > 0, "maxBudgetUsd must be positive");
  }
  if (dir) {
    need(existsSync(join(dir, "fixture")) && statSync(join(dir, "fixture")).isDirectory(), "fixture/ folder is missing");
    need(!existsSync(join(dir, "fixture", ".git")), "fixture/ must not be a git repository");
  }
  return errors;
}

/** Loads every case under `casesDir` (or only `ids`). */
export function loadCases(casesDir, ids = []) {
  const cases = [];
  const errors = [];
  const names = existsSync(casesDir) ? readdirSync(casesDir).filter((n) => existsSync(join(casesDir, n, "case.json"))).sort() : [];
  for (const id of ids) if (!names.includes(id)) errors.push(`${id}: no such case`);
  for (const name of names) {
    if (ids.length && !ids.includes(name)) continue;
    const dir = join(casesDir, name);
    let definition;
    try {
      definition = JSON.parse(readFileSync(join(dir, "case.json"), "utf8"));
    } catch (error) {
      errors.push(`${name}: case.json is not valid JSON (${error.message})`);
      continue;
    }
    const problems = validateCase(definition, dir);
    if (definition?.id && definition.id !== name) problems.push(`id "${definition.id}" doesn't match its folder`);
    if (problems.length) errors.push(...problems.map((p) => `${name}: ${p}`));
    else cases.push({ ...definition, dir });
  }
  return { cases, errors };
}

// --- Project sandbox ------------------------------------------------------------------------

function git(args, cwd) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", env: { ...cleanEnv(), ...GIT_ENV }, maxBuffer: 64 * 1024 * 1024 });
  return { ok: result.status === 0, out: (result.stdout ?? "").trim(), err: (result.stderr ?? "").trim() };
}

function mustGit(args, cwd) {
  const result = git(args, cwd);
  if (!result.ok) throw new Error(`git ${args.join(" ")} failed: ${result.err}`);
  return result.out;
}

/**
 * Copies the fixture into `workDir/project` as a fresh repository on `main`, with a bare
 * `workDir/origin.git` as its origin, so pushes can be verified without any network.
 */
export function prepareProject(caseDef, workDir) {
  const project = join(workDir, "project");
  const origin = join(workDir, "origin.git");
  cpSync(join(caseDef.dir, "fixture"), project, { recursive: true });
  mustGit(["init", "-q", "-b", "main"], project);
  mustGit(["add", "-A"], project);
  mustGit(["commit", "-q", "-m", "fixture"], project);
  const fixtureCommit = mustGit(["rev-parse", "HEAD"], project);
  mustGit(["init", "-q", "--bare", "-b", "main", origin], workDir);
  mustGit(["remote", "add", "origin", origin], project);
  mustGit(["push", "-q", "origin", "main"], project);
  return { project, origin, fixtureCommit };
}

/** Copies a case overlay folder (hidden tests, reference solution) over the project. */
export function overlay(caseDef, folder, project) {
  const source = join(caseDef.dir, folder);
  if (existsSync(source)) cpSync(source, project, { recursive: true, force: true });
  return existsSync(source);
}

// --- Claude ---------------------------------------------------------------------------------

/** The headless invocation. The prompt goes through stdin, never in argv. */
export function claudeArgs({ pluginDirs, maxBudgetUsd, model }) {
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
    ALLOWED_TOOLS.join(","),
    "--append-system-prompt",
    EVAL_NOTE,
    ...(maxBudgetUsd ? ["--max-budget-usd", String(maxBudgetUsd)] : []),
    ...(model ? ["--model", model] : []),
    ...pluginDirs.flatMap((dir) => ["--plugin-dir", dir]),
  ];
}

/** Environment for the run: unattended mode on, metrics on, git identity set. */
export function claudeEnv(base = process.env) {
  const env = { ...cleanEnv(base), ...GIT_ENV, CUADRILLA_UNATTENDED: "1" };
  delete env.CUADRILLA_METRICS;
  delete env.CLAUDE_PROJECT_DIR;
  return env;
}

/** Parses `--output-format json`: the last line that is a JSON object with a result type. */
export function parseClaudeOutput(stdout) {
  const lines = String(stdout ?? "").trim().split("\n").reverse();
  for (const line of lines) {
    try {
      const value = JSON.parse(line);
      if (value && typeof value === "object" && ("result" in value || value.type === "result")) return value;
    } catch {
      // not JSON
    }
  }
  try {
    const value = JSON.parse(String(stdout ?? ""));
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

/** Error text from a failed result: its `errors`, else its subtype, else its result text. */
export function describeError(output) {
  if (Array.isArray(output?.errors) && output.errors.length) return output.errors.join("; ").slice(0, 300);
  if (typeof output?.result === "string" && output.result) return output.result.slice(0, 300);
  if (output?.subtype === "error_max_budget_usd") return "budget exhausted";
  if (output?.subtype === "error_max_turns") return "turn limit reached";
  return String(output?.subtype ?? "error");
}

export function runClaude({ bin, args, prompt, cwd, timeoutMs }) {
  const started = Date.now();
  const result = spawnSync(bin, args, {
    cwd,
    input: prompt,
    encoding: "utf8",
    env: claudeEnv(),
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
    shell: process.platform === "win32",
  });
  const output = parseClaudeOutput(result.stdout);
  const timedOut = result.error?.code === "ETIMEDOUT" || result.signal === "SIGTERM";
  return {
    ok: result.status === 0 && output !== null && output.is_error !== true && !timedOut,
    timedOut,
    exitCode: result.status,
    error: result.error ? String(result.error.message) : output?.is_error ? describeError(output) : output === null ? "no JSON result from claude" : null,
    costUsd: Number(output?.total_cost_usd ?? output?.cost_usd) || 0,
    turns: Number(output?.num_turns) || 0,
    durationMs: Number(output?.duration_ms) || Date.now() - started,
    summary: typeof output?.result === "string" ? output.result.slice(0, 2000) : "",
  };
}

// --- Evaluation -----------------------------------------------------------------------------

function parseAddedLines(diff, into) {
  let file = null;
  for (const text of diff.split("\n")) {
    if (text.startsWith("+++ ")) file = text.startsWith("+++ b/") ? text.slice(6) : null;
    else if (text.startsWith("+") && !text.startsWith("+++") && file) into.push({ file, text: text.slice(1) });
  }
}

/**
 * Everything the agent changed relative to the fixture: the working tree (staged) and every
 * commit on any local branch, so something committed and then removed still counts.
 */
export function collectChanges(project, fixtureCommit) {
  git(["add", "-A"], project);
  const files = new Set();
  for (const line of git(["diff", "--cached", "--name-only", fixtureCommit], project).out.split("\n")) if (line) files.add(line);
  const branches = git(["for-each-ref", "--format=%(refname:short)", "refs/heads/"], project).out.split("\n").filter(Boolean);
  for (const branch of branches) {
    for (const line of git(["diff", "--name-only", fixtureCommit, branch], project).out.split("\n")) if (line) files.add(line);
  }
  const added = [];
  parseAddedLines(git(["diff", "--cached", "-U0", "--no-color", fixtureCommit], project).out, added);
  parseAddedLines(git(["log", "-p", "-U0", "--no-color", "--format=", "--branches", "--not", fixtureCommit], project).out, added);
  return { files: [...files].sort(), added, branches };
}

function readMetrics(project) {
  const file = join(project, ".claude", "cuadrilla", "metrics.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

function runCheck(check, cwd, timeoutMs) {
  const result = spawnSync(check.run, { cwd, shell: true, encoding: "utf8", timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, env: cleanEnv() });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  return { name: check.name, ok: result.status === 0, tail: output.split("\n").slice(-15).join("\n") };
}

/**
 * Judges the project after the agent finished: diff-based expectations first (before hidden
 * files are copied in), then hidden tests, then the checks.
 */
export function evaluate(caseDef, sandbox, { originMainBefore, checkTimeoutMs = 5 * 60_000, skipPushExpectations = false } = {}) {
  const { project, origin, fixtureCommit } = sandbox;
  const changes = collectChanges(project, fixtureCommit);
  const expectations = [];
  const expect = (name, ok, detail = "") => expectations.push({ name, ok, detail });

  for (const glob of caseDef.mustChange ?? []) {
    expect(`changes ${glob}`, changes.files.some((f) => matchesGlob(f, glob)));
  }
  for (const glob of caseDef.mustNotChange ?? []) {
    const touched = changes.files.filter((f) => matchesGlob(f, glob));
    expect(`leaves ${glob} unchanged`, touched.length === 0, touched.join(", "));
  }
  for (const rule of caseDef.forbiddenInDiff ?? []) {
    const test = rule.literal ? (text) => text.includes(rule.pattern) : (text) => new RegExp(rule.pattern).test(text);
    const hits = changes.added.filter(({ file, text }) => matchesGlob(file, rule.glob ?? "**/*") && test(text));
    expect(`no ${rule.message}`, hits.length === 0, [...new Set(hits.map((h) => h.file))].join(", "));
  }
  const remoteBranches = git(["for-each-ref", "--format=%(refname:short)", "refs/heads/"], origin).out.split("\n").filter(Boolean);
  const originMainAfter = git(["rev-parse", "main"], origin).out;
  if (!skipPushExpectations && caseDef.expect?.pushedBranchPrefix) {
    const prefix = caseDef.expect.pushedBranchPrefix;
    expect(`pushes a ${prefix}* branch`, remoteBranches.some((b) => b.startsWith(prefix)), remoteBranches.join(", "));
  }
  if (caseDef.expect?.originMainUnchanged || caseDef.expect?.pushedBranchPrefix) {
    expect("origin main untouched", originMainAfter === originMainBefore);
  }

  overlay(caseDef, "hidden", project);
  const checks = (caseDef.checks ?? []).map((check) => runCheck(check, project, checkTimeoutMs));

  const metrics = readMetrics(project);
  const guardDenies = metrics.filter((e) => e.kind === "guard" && e.decision === "deny");
  return {
    checks,
    expectations,
    changedFiles: changes.files,
    remoteBranches,
    guardDenies: guardDenies.length,
    guardRules: [...new Set(guardDenies.map((e) => e.rule))].sort(),
    stopFindings: metrics.filter((e) => e.kind === "stop-check").reduce((sum, e) => sum + (Number(e.findings) || 0), 0),
  };
}

export function passed(run) {
  return Boolean(run.claude?.ok) && run.checks.every((c) => c.ok) && run.expectations.every((e) => e.ok);
}

// --- Summary --------------------------------------------------------------------------------

const average = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);

export function summarize(runs) {
  const groups = new Map();
  for (const run of runs) {
    const key = `${run.caseId}\u0000${run.version}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(run);
  }
  return [...groups.values()].map((group) => {
    const done = group.filter((r) => !r.skipped);
    const failures = new Map();
    for (const run of done) {
      for (const reason of failureReasons(run)) failures.set(reason, (failures.get(reason) ?? 0) + 1);
    }
    return {
      caseId: group[0].caseId,
      version: group[0].version,
      runs: done.length,
      skipped: group.length - done.length,
      passes: done.filter((r) => r.passed).length,
      costUsd: average(done.map((r) => r.claude.costUsd)),
      turns: average(done.map((r) => r.claude.turns)),
      minutes: average(done.map((r) => r.claude.durationMs / 60_000)),
      guardDenies: average(done.map((r) => r.guardDenies)),
      stopFindings: average(done.map((r) => r.stopFindings)),
      failures: [...failures].sort((a, b) => b[1] - a[1]),
    };
  });
}

export function failureReasons(run) {
  if (run.skipped) return [`skipped: ${run.skipped}`];
  const reasons = [];
  if (!run.claude.ok) reasons.push(run.claude.timedOut ? "claude timed out" : `claude failed${run.claude.error ? `: ${run.claude.error.split("\n")[0].slice(0, 120)}` : ""}`);
  for (const check of run.checks) if (!check.ok) reasons.push(`check failed: ${check.name}`);
  for (const expectation of run.expectations) if (!expectation.ok) reasons.push(`expectation failed: ${expectation.name}`);
  return reasons;
}

/** Candidate vs base, per case and overall. Pass counts decide; cost only breaks ties. */
export function compare(summary, base, candidate) {
  const pick = (caseId, version) => summary.find((s) => s.caseId === caseId && s.version === version);
  const cases = [...new Set(summary.map((s) => s.caseId))].sort();
  const rows = cases.map((caseId) => {
    const b = pick(caseId, base);
    const c = pick(caseId, candidate);
    const rate = (s) => (s && s.runs ? s.passes / s.runs : null);
    const delta = rate(c) !== null && rate(b) !== null ? rate(c) - rate(b) : null;
    return { caseId, base: b, candidate: c, delta };
  });
  const total = (version) => summary.filter((s) => s.version === version).reduce((a, s) => ({ passes: a.passes + s.passes, runs: a.runs + s.runs, cost: a.cost + s.costUsd * s.runs }), { passes: 0, runs: 0, cost: 0 });
  const tb = total(base);
  const tc = total(candidate);
  const rb = tb.runs ? tb.passes / tb.runs : 0;
  const rc = tc.runs ? tc.passes / tc.runs : 0;
  let verdict;
  if (rc > rb) verdict = "better";
  else if (rc < rb) verdict = "worse";
  else if (tb.runs && tc.runs && tc.cost / tc.runs < 0.9 * (tb.cost / tb.runs)) verdict = "same quality, cheaper";
  else if (tb.runs && tc.runs && tc.cost / tc.runs > 1.1 * (tb.cost / tb.runs)) verdict = "same quality, more expensive";
  else verdict = "no meaningful difference";
  const minRuns = Math.min(...summary.map((s) => s.runs).filter((n) => n > 0), Infinity);
  return { rows, verdict, base: { ...tb, rate: rb }, candidate: { ...tc, rate: rc }, lowConfidence: !Number.isFinite(minRuns) || minRuns < 3 };
}

export function toMarkdown(summary, versions, meta = {}) {
  const money = (n) => `$${n.toFixed(2)}`;
  const lines = ["# Cuadrilla eval results", ""];
  if (meta.date) lines.push(`- Date: ${meta.date}`);
  lines.push(`- Versions: ${versions.map((v) => `\`${v.label}\`${v.ref ? ` (${v.ref})` : ""}`).join(" vs ")}`);
  if (meta.runs) lines.push(`- Runs per case and version: ${meta.runs}`);
  if (meta.model) lines.push(`- Model: ${meta.model}`);
  lines.push("", "| Case | Version | Passed | Avg cost | Avg turns | Avg min | Guard blocks | Stop-check findings |", "|---|---|---:|---:|---:|---:|---:|---:|");
  for (const s of summary) {
    lines.push(`| ${s.caseId} | ${s.version} | ${s.passes}/${s.runs}${s.skipped ? ` (+${s.skipped} skipped)` : ""} | ${money(s.costUsd)} | ${s.turns.toFixed(1)} | ${s.minutes.toFixed(1)} | ${s.guardDenies.toFixed(1)} | ${s.stopFindings.toFixed(1)} |`);
  }
  const withFailures = summary.filter((s) => s.failures.length);
  if (withFailures.length) {
    lines.push("", "## Why runs failed", "");
    for (const s of withFailures) lines.push(`- **${s.caseId} · ${s.version}:** ${s.failures.map(([r, n]) => `${r} (${n})`).join("; ")}`);
  }
  if (versions.length === 2) {
    const result = compare(summary, versions[0].label, versions[1].label);
    lines.push("", "## Comparison", "");
    lines.push(`**Verdict: ${result.verdict}.** ${versions[1].label} passed ${result.candidate.passes}/${result.candidate.runs}, ${versions[0].label} passed ${result.base.passes}/${result.base.runs}.`);
    for (const row of result.rows) {
      if (row.delta === null || row.delta === 0) continue;
      lines.push(`- ${row.caseId}: ${row.delta > 0 ? "+" : ""}${Math.round(row.delta * 100)} points of pass rate`);
    }
    if (result.lowConfidence) lines.push("", "_Low confidence: fewer than 3 runs per case and version. Agents are not deterministic; use `--runs 3` or more before deciding._");
  }
  return lines.join("\n");
}
