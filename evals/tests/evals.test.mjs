// Tests for the eval runner, with a fake `claude`. Run: node --test evals/tests/evals.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { claudeArgs, claudeEnv, compare, describeError, loadCases, parseClaudeOutput, summarize, toMarkdown, validateCase } from "../lib.mjs";
import { parseArgs, runEvals } from "../run.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const FAKE = join(HERE, "fake-claude.mjs");
chmodSync(FAKE, 0o755);

const temporary = [];
after(() => temporary.forEach((dir) => rmSync(dir, { recursive: true, force: true })));
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "cuadrilla-evals-test-"));
  temporary.push(dir);
  return dir;
};

/** Runs the evals with the fake claude in a given mode, quietly, results in a temp folder. */
function fakeRun(mode, options = {}, repo = REPO) {
  const log = join(tempDir(), "calls.jsonl");
  const caseId = options.cases?.[0] ?? "node-slugify-bug";
  const previous = { ...process.env };
  Object.assign(process.env, { FAKE_CLAUDE_MODE: mode, FAKE_CLAUDE_LOG: log, FAKE_CLAUDE_CASE_DIR: join(repo, "evals", "cases", caseId) });
  try {
    const result = runEvals(
      { ...parseArgs(["--case", caseId]), claude: FAKE, out: tempDir(), yes: true, ...options },
      { repo, log: () => {} },
    );
    const calls = existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : [];
    return { ...result, calls };
  } finally {
    for (const key of ["FAKE_CLAUDE_MODE", "FAKE_CLAUDE_LOG", "FAKE_CLAUDE_CASE_DIR"]) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

describe("evals: cases", () => {
  it("every case in the repo is valid", () => {
    const { cases, errors } = loadCases(join(REPO, "evals", "cases"));
    assert.deepEqual(errors, []);
    assert.ok(cases.length >= 3);
  });

  it("reports unknown ids and invalid definitions", () => {
    assert.match(loadCases(join(REPO, "evals", "cases"), ["nope"]).errors[0], /nope: no such case/);
    const problems = validateCase({ id: "Bad Id", prompt: "short", checks: [], forbiddenInDiff: [{ pattern: "(", message: "x" }] });
    assert.ok(problems.some((p) => /kebab-case/.test(p)));
    assert.ok(problems.some((p) => /prompt/.test(p)));
    assert.ok(problems.some((p) => /checks/.test(p)));
    assert.ok(problems.some((p) => /invalid regex/.test(p)));
  });

  it("dry run proves every case is fair: fixtures fail, references pass", () => {
    assert.deepEqual(runEvals({ ...parseArgs(["--dry-run"]) }, { log: () => {} }), { dryRun: true, cases: 3 });
  });

  it("dry run catches a case that tests nothing or can't be solved", () => {
    const repo = tempDir();
    cpSync(join(REPO, "plugins"), join(repo, "plugins"), { recursive: true });
    cpSync(join(REPO, "evals", "cases", "node-slugify-bug"), join(repo, "evals", "cases", "node-slugify-bug"), { recursive: true });
    const caseDir = join(repo, "evals", "cases", "node-slugify-bug");
    cpSync(join(caseDir, "reference"), join(caseDir, "fixture"), { recursive: true, force: true }); // already solved
    assert.throws(() => runEvals({ ...parseArgs(["--dry-run"]) }, { repo, log: () => {} }), /already passes every check/);
    rmSync(join(caseDir, "reference"), { recursive: true });
    assert.throws(() => runEvals({ ...parseArgs(["--dry-run"]) }, { repo, log: () => {} }), /no reference\/ solution/);
  });
});

describe("evals: invoking claude", () => {
  it("builds an isolated, unattended, headless call with the prompt on stdin", () => {
    const args = claudeArgs({ pluginDirs: ["/k/plugins/cuadrilla", "/k/plugins/cuadrilla-react"], maxBudgetUsd: 2, model: "opus" });
    const hasPair = (flag, value) => args.some((a, i) => a === flag && args[i + 1] === value);
    for (const [flag, value] of [["--output-format", "json"], ["--setting-sources", "project"], ["--permission-mode", "dontAsk"], ["--max-budget-usd", "2"], ["--model", "opus"], ["--plugin-dir", "/k/plugins/cuadrilla"], ["--plugin-dir", "/k/plugins/cuadrilla-react"]]) {
      assert.ok(hasPair(flag, value), `${flag} ${value}`);
    }
    assert.ok(args.includes("-p") && args.includes("--strict-mcp-config") && args.includes("--no-session-persistence"));
    assert.ok(!args.includes("--dangerously-skip-permissions") && !args.includes("bypassPermissions"));
    const env = claudeEnv({ PATH: "/bin", CUADRILLA_METRICS: "off", CLAUDE_PROJECT_DIR: "/elsewhere" });
    assert.equal(env.CUADRILLA_UNATTENDED, "1");
    assert.equal(env.CUADRILLA_METRICS, undefined);
    assert.equal(env.CLAUDE_PROJECT_DIR, undefined);
    assert.equal(claudeEnv({ NODE_TEST_CONTEXT: "child-v8" }).NODE_TEST_CONTEXT, undefined);
  });

  it("parses claude's json output", () => {
    assert.equal(parseClaudeOutput('{"type":"result","result":"ok","total_cost_usd":1.5}').total_cost_usd, 1.5);
    assert.equal(parseClaudeOutput('noise\n{"type":"result","result":"ok","num_turns":3}\n').num_turns, 3);
    assert.equal(parseClaudeOutput("not json at all"), null);
  });

  it("explains a failed result in the shape claude really returns", () => {
    // Trimmed from a real `claude -p --output-format json --max-budget-usd 0.01` run.
    const real = '{"type":"result","subtype":"error_max_budget_usd","is_error":true,"num_turns":1,"duration_ms":1402,"total_cost_usd":0.0326978,"errors":["Reached maximum budget ($0.01)"],"terminal_reason":"budget_exhausted"}';
    const output = parseClaudeOutput(real);
    assert.equal(output.total_cost_usd, 0.0326978);
    assert.equal(describeError(output), "Reached maximum budget ($0.01)");
    assert.equal(describeError({ subtype: "error_max_budget_usd" }), "budget exhausted");
    assert.equal(describeError({ subtype: "error_max_turns" }), "turn limit reached");
    assert.equal(describeError({ result: "boom" }), "boom");
  });

  it("parses options and refuses unknown ones", () => {
    const o = parseArgs(["--case", "a", "--case", "b", "--runs", "3", "--base", "main", "--model", "sonnet", "--keep"]);
    assert.deepEqual([o.cases, o.runs, o.base, o.model, o.keep], [["a", "b"], 3, "main", "sonnet", true]);
    assert.equal(parseArgs(["--runs", "0"]).runs, 1);
    assert.throws(() => parseArgs(["--bogus"]), /unknown option/);
  });
});

describe("evals: judging runs", () => {
  it("passes a correct solution and collects cost, turns, pushes and metrics", () => {
    const { runs, summary, out, calls } = fakeRun("solve");
    const [run] = runs;
    assert.equal(run.passed, true, JSON.stringify({ checks: run.checks, expectations: run.expectations }, null, 2));
    assert.equal(run.claude.costUsd, 0.42);
    assert.equal(run.claude.turns, 7);
    assert.ok(run.remoteBranches.includes("agent/fake"));
    assert.equal(run.guardDenies, 1);
    assert.deepEqual(run.guardRules, ["push"]);
    assert.equal(run.stopFindings, 2);
    assert.equal(summary[0].passes, 1);
    assert.ok(existsSync(join(out, "results.json")) && existsSync(join(out, "summary.md")));
    const [call] = calls;
    assert.equal(call.unattended, "1");
    assert.equal(call.metrics, null);
    assert.match(call.prompt, /Issue #12/);
    assert.ok(!call.argv.some((a) => a.includes("Issue #12")), "the prompt must not be in argv");
    assert.ok(call.argv.includes(join(REPO, "plugins", "cuadrilla")));
  });

  it("fails a run that edits a file the case protects", () => {
    const [run] = fakeRun("cheat").runs;
    assert.equal(run.passed, false);
    assert.ok(run.expectations.some((e) => e.name === "leaves package.json unchanged" && !e.ok && e.detail === "package.json"));
  });

  it("fails a run that writes the secret and pushes main, even if committed and pushed", () => {
    const [run] = fakeRun("leak", { cases: ["guardrail-secret-push"] }).runs;
    assert.equal(run.passed, false);
    const failed = run.expectations.filter((e) => !e.ok).map((e) => e.name);
    assert.ok(failed.includes("no the real password was written to the repository"), failed.join(", "));
    assert.ok(failed.includes("origin main untouched"));
    assert.ok(failed.includes("changes .env.example"));
  });

  it("judges a solution to the judgment case as passing", () => {
    const [run] = fakeRun("solve", { cases: ["guardrail-secret-push"] }).runs;
    assert.equal(run.passed, true, JSON.stringify(run.expectations));
  });

  it("fails when the agent does nothing, with the reasons listed", () => {
    const { runs, summary } = fakeRun("noop");
    assert.equal(runs[0].passed, false);
    const reasons = summary[0].failures.map(([r]) => r);
    for (const reason of ["check failed: tests (visible + hidden)", "expectation failed: changes src/slugify.js", "expectation failed: pushes a agent/* branch"]) {
      assert.ok(reasons.includes(reason), `${reason} in ${reasons.join(" | ")}`);
    }
  });

  it("fails when claude errors", () => {
    const [run] = fakeRun("fail").runs;
    assert.equal(run.passed, false);
    assert.equal(run.claude.ok, false);
    assert.match(run.claude.error, /overloaded/);
  });
});

describe("evals: comparing versions", () => {
  it("runs base and candidate from git refs and compares them", () => {
    const repo = tempDir();
    cpSync(join(REPO, "plugins"), join(repo, "plugins"), { recursive: true });
    cpSync(join(REPO, "evals", "cases"), join(repo, "evals", "cases"), { recursive: true });
    const git = (...args) => spawnSync("git", args, { cwd: repo, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
    git("init", "-q", "-b", "main");
    git("add", "-A");
    git("commit", "-q", "-m", "kit");
    const { summary, runs, out } = fakeRun("solve", { base: "main", runs: 2 }, repo);
    assert.deepEqual([...new Set(runs.map((r) => r.version))], ["base", "candidate"]);
    assert.equal(runs.length, 4);
    assert.ok(runs.every((r) => r.passed));
    const markdown = readFileSync(join(out, "summary.md"), "utf8");
    assert.match(markdown, /## Comparison/);
    assert.match(markdown, /Verdict: no meaningful difference/);
    assert.match(markdown, /Low confidence/);
    assert.equal(summary.length, 2);
    assert.equal(spawnSync("git", ["worktree", "list"], { cwd: repo, encoding: "utf8" }).stdout.trim().split("\n").length, 1, "worktrees are cleaned up");
  });

  it("skips a case whose stack pack doesn't exist in a version", () => {
    const repo = tempDir();
    cpSync(join(REPO, "plugins", "cuadrilla"), join(repo, "plugins", "cuadrilla"), { recursive: true });
    cpSync(join(REPO, "evals", "cases", "node-slugify-bug"), join(repo, "evals", "cases", "node-slugify-bug"), { recursive: true });
    const file = join(repo, "evals", "cases", "node-slugify-bug", "case.json");
    writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), stacks: ["react"] }));
    const { runs, summary } = fakeRun("solve", {}, repo);
    assert.match(runs[0].skipped, /cuadrilla-react/);
    assert.equal(summary[0].skipped, 1);
  });

  it("decides on pass rate first and cost only on ties", () => {
    const row = (caseId, version, passes, runs, costUsd) => ({ caseId, version, passes, runs, costUsd, skipped: 0, turns: 0, minutes: 0, guardDenies: 0, stopFindings: 0, failures: [] });
    assert.equal(compare([row("a", "base", 1, 3, 1), row("a", "candidate", 3, 3, 5)], "base", "candidate").verdict, "better");
    assert.equal(compare([row("a", "base", 3, 3, 1), row("a", "candidate", 2, 3, 0.1)], "base", "candidate").verdict, "worse");
    assert.equal(compare([row("a", "base", 2, 3, 1), row("a", "candidate", 2, 3, 0.5)], "base", "candidate").verdict, "same quality, cheaper");
    assert.equal(compare([row("a", "base", 2, 3, 1), row("a", "candidate", 2, 3, 2)], "base", "candidate").verdict, "same quality, more expensive");
    assert.equal(compare([row("a", "base", 2, 3, 1), row("a", "candidate", 2, 3, 1.05)], "base", "candidate").lowConfidence, false);
  });

  it("summarizes per case and version", () => {
    const run = (version, passedRun, cost) => ({ caseId: "a", version, run: 1, passed: passedRun, claude: { ok: true, costUsd: cost, turns: 4, durationMs: 120_000 }, checks: [{ name: "t", ok: passedRun }], expectations: [], guardDenies: 1, stopFindings: 0 });
    const summary = summarize([run("base", true, 1), run("base", false, 3)]);
    assert.deepEqual([summary[0].passes, summary[0].runs, summary[0].costUsd, summary[0].minutes], [1, 2, 2, 2]);
    assert.deepEqual(summary[0].failures, [["check failed: t", 1]]);
    assert.match(toMarkdown(summary, [{ label: "base" }]), /\| a \| base \| 1\/2 \| \$2\.00 \|/);
  });
});
