#!/usr/bin/env node
// PostToolUse (Edit | Write) — formats the file Claude just edited with the project's own tools
// and tells Claude about remaining lint errors. Never blocks.
//
// 1. If .claude/cuadrilla.json has a component whose `path` contains the file, its `format` and
//    `lint` entries whose `glob` matches are run (cwd = component path, {file} = absolute path).
// 2. Otherwise, safe built-in defaults: ruff for Python (uv project), Prettier for JS/TS/CSS/JSON
//    (when installed in node_modules), gofmt for Go. Slow formatters (dotnet format, Spotless)
//    only run when configured.
import { existsSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { findUp, loadConfig, matchesGlob, projectRoot, readInput, relativePath, respond, run } from "./lib.mjs";

const input = await readInput();
const file = input.tool_input?.file_path;
if (!file || !existsSync(file)) process.exit(0);

const root = projectRoot(input);
const { config } = loadConfig(root);
const absolute = resolve(root, file);
const relative = relativePath(root, absolute);
const extension = extname(absolute).toLowerCase();

// "node" runs with the same Node binary as this hook: no PATH lookup and no Windows shell.
const expand = (args) =>
  args.map((arg, i) => (i === 0 && arg === "node" ? process.execPath : arg.replaceAll("{file}", absolute)));
// Located lines: "file:12:3: msg" (ruff, tsc, gcc style), "file(12,3)" (MSBuild) or ESLint's
// stylish "  12:3  error  msg  rule".
const lintLines = (output) => {
  const lines = output.split("\n").map((l) => l.trimEnd()).filter(Boolean);
  const located = lines.filter((l) => /[:(]\d+[,:]\d+/.test(l) || /^\s*\d+:\d+\s+(?:error|warning)\b/.test(l));
  return (located.length ? located : lines).slice(0, 15);
};

/** Runs an entry; if its tool is missing and it declares a `fallback` command, runs that one. */
function runEntry(entry, cwd) {
  const [command, ...args] = expand(entry.run);
  const result = run(command, args, { cwd, timeout: entry.timeout ?? 30_000 });
  if (result.notFound && Array.isArray(entry.fallback)) {
    const [fallbackCommand, ...fallbackArgs] = expand(entry.fallback);
    return run(fallbackCommand, fallbackArgs, { cwd, timeout: entry.timeout ?? 30_000 });
  }
  return result;
}

function fromConfig() {
  const components = Array.isArray(config.components) ? config.components : [];
  const component = components
    .filter((c) => typeof c?.path === "string")
    .sort((a, b) => b.path.length - a.path.length)
    .find((c) => {
      const base = c.path.replace(/\\/g, "/").replace(/^\.\/?|\/$/g, "");
      return base === "" || relative.toLowerCase().startsWith(`${base.toLowerCase()}/`);
    });
  if (!component) return null;
  const base = component.path.replace(/\\/g, "/").replace(/^\.\/?|\/$/g, "");
  const inside = base ? relative.slice(base.length + 1) : relative;
  const cwd = join(root, base);
  const pick = (entries) =>
    (Array.isArray(entries) ? entries : []).filter((e) => Array.isArray(e?.run) && matchesGlob(inside, e.glob ?? "**/*"));
  const formatters = pick(component.format);
  const linters = pick(component.lint);
  if (!formatters.length && !linters.length) return null;
  for (const entry of formatters) runEntry(entry, cwd);
  const problems = [];
  for (const entry of linters) {
    const result = runEntry(entry, cwd);
    if (!result.ok && !result.notFound) problems.push(...lintLines(result.output));
  }
  return { handled: true, problems };
}

function builtinDefaults() {
  const problems = [];
  if (extension === ".py" || extension === ".pyi") {
    const project = findUp(dirname(absolute), "pyproject.toml", root);
    if (!project) return problems;
    const ruff = (args) => run("uv", ["run", "--no-sync", "ruff", ...args], { cwd: project, timeout: 20_000 });
    const formatted = ruff(["format", "--quiet", absolute]);
    if (formatted.notFound || /failed to spawn|No such file/i.test(formatted.output)) return problems;
    ruff(["check", "--fix", "--select", "I", "--quiet", absolute]);
    const lint = ruff(["check", "--output-format", "concise", absolute]);
    if (!lint.ok) problems.push(...lintLines(lint.output));
  } else if ([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".css", ".scss", ".json", ".md", ".html", ".vue", ".svelte"].includes(extension)) {
    const project = findUp(dirname(absolute), "package.json", root);
    if (!project) return problems;
    // Call Prettier's own entry point with node: ~10x faster than npx or the .cmd shim on Windows.
    const prettier = join(project, "node_modules", "prettier", "bin", "prettier.cjs");
    if (existsSync(prettier)) {
      run(process.execPath, [prettier, "--write", "--log-level", "warn", absolute], { cwd: project, timeout: 20_000 });
    }
  } else if (extension === ".go") {
    run("gofmt", ["-w", absolute], { cwd: dirname(absolute), timeout: 15_000, shellOnWindows: false });
  }
  return problems;
}

const configured = fromConfig();
const problems = configured ? configured.problems : builtinDefaults();

if (problems.length) {
  respond({
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: `Lint reported problems in ${relative}:\n${problems.join("\n")}\nFix them before finishing the task.`,
    },
  });
}
process.exit(0);
