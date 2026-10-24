#!/usr/bin/env node
// Stop — before Claude ends its turn, scans the lines ADDED in the working tree (git diff HEAD
// plus new untracked files) for patterns the standard forbids and linters often miss. If it finds
// any, it hands the turn back to Claude ONCE with the list; on the second stop
// (stop_hook_active) it lets Claude finish, so it never loops.
//
// Patterns = built-in, per language (disable with "builtinPatterns": false)
//          + project/pack patterns in .claude/cuadrilla.json → "forbidden": [{ glob, pattern, message, tests }]
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { git, loadConfig, matchesGlob, projectRoot, readInput, respond } from "./lib.mjs";

const input = await readInput();
if (input.stop_hook_active) process.exit(0);

const root = projectRoot(input);
const { config, error: configError } = loadConfig(root);
if (config.stopCheck === false) process.exit(0);
if (!git(["rev-parse", "--is-inside-work-tree"], root, 5_000).ok) process.exit(0);

const isTest = (path) =>
  /(^|\/)(tests?|__tests__|spec|src\/test)\//i.test(path) ||
  /(^|\/)test_[^/]*\.py$|_test\.(py|go)$|\.(test|spec)\.[cm]?[jt]sx?$|Tests?\.cs$|Tests?\.java$|IT\.java$/.test(path);
const isSource = (path) =>
  !/(^|\/)(node_modules|dist|build|out|bin|obj|target|vendor|\.venv|venv|\.claude|docs|\.github|migrations?|generated)\//i.test(path) &&
  !/\.(md|lock|min\.js|map|snap)$/i.test(path);

// [file glob, regex, message, applies to tests?]
const BUILTIN = [
  // Every text file
  ["**/*", /^(?:<{7}|>{7}) /, "unresolved merge conflict marker", true],
  // Python
  ["**/*.py", /^\s*print\(/, "print() in application code (use logging)", false],
  ["**/*.py", /^\s*(?:breakpoint\(\)|import pdb|pdb\.set_trace\(\))/, "debugger left in code", true],
  ["**/*.py", /#\s*type:\s*ignore(?!\[)/, "# type: ignore without an error code", true],
  ["**/*.py", /@pytest\.mark\.skip\b|pytest\.skip\(|@pytest\.mark\.xfail(?!\(.*reason)/, "skipped test", true],
  ["**/*.py", /\b(?:execute|executemany|fetch\w*|raw|text)\(\s*f["']/, "SQL built with an f-string", true],
  // JavaScript / TypeScript
  ["**/*.{js,jsx,ts,tsx,mjs,cjs,vue,svelte}", /\bconsole\.(?:log|debug)\(/, "console.log in application code", false],
  ["**/*.{js,jsx,ts,tsx,mjs,cjs,vue,svelte}", /^\s*debugger;?\s*$/, "debugger statement", true],
  ["**/*.{js,jsx,ts,tsx,mjs,cjs}", /\b(?:it|test|describe)\.(?:only|skip)\(|\bx(?:it|describe)\(/, ".only/.skip in tests", true],
  ["**/*.{ts,tsx}", /@ts-ignore|@ts-nocheck|as unknown as/, "@ts-ignore / @ts-nocheck / as unknown as", true],
  ["**/*.{ts,tsx}", /(?::|<|\bas)\s*any\b(?![\w-])/, "type any", true],
  ["**/*.{js,jsx,ts,tsx,mjs,cjs}", /\b(?:query|execute|raw|unsafe)\(\s*`[^`]*\$\{/, "SQL built with a template literal", true],
  // C#
  ["**/*.cs", /\bConsole\.Write(?:Line)?\(/, "Console.Write in application code (use ILogger)", false],
  ["**/*.cs", /\bDebugger\.Break\(\)/, "Debugger.Break()", true],
  ["**/*.cs", /\[(?:Fact|Theory)\s*\(\s*Skip\s*=|\[Ignore\b/, "skipped test", true],
  ["**/*.cs", /\b(?:Query|Execute|QueryFirst\w*|QuerySingle\w*|FromSqlRaw|ExecuteSqlRaw)\w*(?:<[^>]*>)?\(\s*\$"/, "SQL built with string interpolation", true],
  ["**/*.cs", /\.GetAwaiter\(\)\.GetResult\(\)|\.Wait\(\)\s*;/, "blocking on async (.GetAwaiter().GetResult() / .Wait())", false],
  // Java / Kotlin
  ["**/*.{java,kt}", /\bSystem\.(?:out|err)\.print/, "System.out/err in application code (use a logger)", false],
  ["**/*.{java,kt}", /\.printStackTrace\(\)/, "printStackTrace() (log the exception)", false],
  ["**/*.{java,kt}", /@Disabled\s*(?:$|\(\s*\))/, "@Disabled test without a reason", true],
  ["**/*.{java,kt}", /\b(?:createQuery|createNativeQuery|executeQuery|executeUpdate|query|update|sql)\(\s*"[^"]*"\s*\+/, "SQL built with string concatenation", true],
  // Go
  ["**/*.go", /^\s*fmt\.Print(?:ln|f)?\(/, "fmt.Print in application code (use a logger)", false],
  ["**/*.go", /\bt\.Skip(?:f|Now)?\(/, "skipped test", true],
  // Rust
  ["**/*.rs", /\b(?:println|dbg)!\(/, "println!/dbg! in application code", false],
  ["**/*.rs", /#\[ignore\]/, "ignored test", true],
];

function addedLines() {
  const result = [];
  const diff = git(["diff", "HEAD", "--unified=0", "--no-color", "--no-ext-diff"], root);
  if (diff.ok) {
    let file = null;
    let line = 0;
    for (const text of diff.output.split("\n")) {
      if (text.startsWith("+++ ")) file = text.startsWith("+++ b/") ? text.slice(6) : null;
      else if (text.startsWith("@@")) line = Number(/\+(\d+)/.exec(text)?.[1] ?? 0);
      else if (text.startsWith("+") && file) result.push({ file, line: line++, text: text.slice(1) });
    }
  }
  const untracked = git(["ls-files", "--others", "--exclude-standard"], root);
  if (untracked.ok) {
    for (const file of untracked.output.split("\n").filter(Boolean)) {
      const path = join(root, file);
      if (!existsSync(path) || statSync(path).size > 300_000) continue;
      const content = readFileSync(path, "utf8");
      if (content.includes("\u0000")) continue; // binary
      content.split("\n").forEach((text, i) => result.push({ file, line: i + 1, text }));
    }
  }
  return result;
}

const rules = [];
if (config.builtinPatterns !== false) {
  for (const [glob, regex, message, tests] of BUILTIN) rules.push({ glob, regex, message, tests });
}
for (const entry of Array.isArray(config.forbidden) ? config.forbidden : []) {
  try {
    rules.push({
      glob: entry.glob ?? "**/*",
      regex: new RegExp(entry.pattern, entry.flags ?? ""),
      message: entry.message ?? `forbidden pattern ${entry.pattern}`,
      tests: entry.tests !== false,
    });
  } catch {
    // An invalid project regex must not break the hook; it is reported below.
    rules.push({ invalid: entry.pattern });
  }
}

const findings = [];
for (const { file, line, text } of addedLines()) {
  if (!isSource(file)) continue;
  const test = isTest(file);
  for (const rule of rules) {
    if (rule.invalid) continue;
    if (!rule.tests && test) continue;
    if (matchesGlob(file, rule.glob) && rule.regex.test(text)) findings.push(`- ${file}:${line} — ${rule.message}`);
  }
}

const notes = [];
if (configError) notes.push(configError);
const invalid = rules.filter((r) => r.invalid).map((r) => r.invalid);
if (invalid.length) notes.push(`Invalid regex in cuadrilla.json "forbidden": ${invalid.join(", ")}`);

if (findings.length || notes.length) {
  const list = findings.slice(0, 25).join("\n");
  const more = findings.length > 25 ? `\n… and ${findings.length - 25} more.` : "";
  respond({
    decision: "block",
    reason:
      (findings.length ? `cuadrilla stop-check found patterns the standard forbids in your changes:\n${list}${more}\n` : "") +
      (notes.length ? `${notes.join("\n")}\n` : "") +
      "Fix them, or if one is intentional (a profile exception or a false positive), say so in your answer.",
  });
}
process.exit(0);
