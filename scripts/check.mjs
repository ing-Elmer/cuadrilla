#!/usr/bin/env node
// Repository self-check for the cuadrilla marketplace. Run: node scripts/check.mjs
//  - every JSON file parses
//  - every agent / skill / command has parseable frontmatter with name/description where required
//  - every pack's component.json has the required shape and its regexes compile
//  - every ci-job.yml / workflow parses as YAML (when python+pyyaml or uv are available)
//  - marketplace entries point to existing plugins whose plugin.json name matches
//  - hook tests pass
//  - eval runner tests pass, and every eval case is fair (fixture fails, reference passes)
//  - curator tests pass
// Exit code 1 on any failure.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
const notes = [];
const fail = (file, message) => failures.push(`${relative(ROOT, file).replace(/\\/g, "/")}: ${message}`);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".git") continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

const files = walk(ROOT);

// 1. JSON
// tsconfig and VS Code files are JSONC (comments and trailing commas allowed).
const isJsonc = (file) => /(?:^|[\\/])(?:tsconfig[^\\/]*|jsconfig[^\\/]*|\.vscode[\\/][^\\/]*)\.json$/.test(file);
const stripJsonc = (text) =>
  text
    .replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (_, string) => string ?? "")
    .replace(/,(\s*[}\]])/g, "$1");

for (const file of files.filter((f) => f.endsWith(".json"))) {
  try {
    const text = readFileSync(file, "utf8");
    JSON.parse(isJsonc(file) ? stripJsonc(text) : text);
  } catch (error) {
    fail(file, `invalid JSON (${error.message})`);
  }
}

// 2. Frontmatter (minimal YAML: key: value lines, quoted or plain, plus simple lists)
function frontmatter(file) {
  const text = readFileSync(file, "utf8");
  if (!text.startsWith("---")) return null;
  const end = text.indexOf("\n---", 3);
  if (end === -1) return { error: "frontmatter not closed" };
  const data = {};
  let lastKey = null;
  for (const raw of text.slice(3, end).split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (!line.trim() || line.trim().startsWith("#")) continue;
    if (/^\s+-\s+/.test(line) && lastKey) {
      (data[lastKey] = Array.isArray(data[lastKey]) ? data[lastKey] : []).push(line.replace(/^\s+-\s+/, ""));
      continue;
    }
    const match = /^([A-Za-z][\w-]*):(?:\s+(.*))?$/.exec(line);
    if (!match) return { error: `unparseable line: ${line}` };
    const [, key, value = ""] = match;
    lastKey = key;
    if (/^(["']).*\1$/.test(value) || value === "") data[key] = value.replace(/^(["'])(.*)\1$/, "$2");
    else if (/^[[{<]/.test(value) || / #/.test(value) || /:\s/.test(value)) return { error: `value of "${key}" must be quoted` };
    else data[key] = value;
  }
  return { data };
}

for (const file of files.filter((f) => f.endsWith(".md"))) {
  const path = file.replace(/\\/g, "/");
  const isAgent = /\/plugins\/[^/]+\/agents\//.test(path);
  const isSkill = /\/skills\/[^/]+\/SKILL\.md$/.test(path);
  const isCommand = /\/plugins\/[^/]+\/commands\//.test(path);
  if (!isAgent && !isSkill && !isCommand) continue;
  const parsed = frontmatter(file);
  if (!parsed) {
    fail(file, "missing frontmatter");
    continue;
  }
  if (parsed.error) {
    fail(file, parsed.error);
    continue;
  }
  if (!parsed.data.description) fail(file, "missing description");
  if (isAgent && !parsed.data.name) fail(file, "agent without name");
  for (const ignored of ["hooks", "mcpServers", "permissionMode"]) {
    if (isAgent && ignored in parsed.data) fail(file, `"${ignored}" is ignored in plugin agents`);
  }
}

// 3. Packs: component.json
for (const file of files.filter((f) => f.replace(/\\/g, "/").endsWith("/component.json"))) {
  let spec;
  try {
    spec = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    continue; // already reported
  }
  for (const key of ["stack", "agent", "component"]) if (!(key in spec)) fail(file, `missing "${key}"`);
  const component = spec.component ?? {};
  if (!Array.isArray(component.checks) || !component.checks.length) fail(file, "component.checks must be a non-empty array");
  for (const list of ["format", "lint"]) {
    for (const entry of component[list] ?? []) {
      for (const key of ["run", "fallback"]) {
        if (!(key in entry)) continue;
        if (!Array.isArray(entry[key])) fail(file, `${list}[].${key} must be an array`);
        else if (!entry[key].some((a) => a.includes("{file}"))) fail(file, `${list}[].${key} should receive {file}`);
        else if (entry[key][0] === "npx") fail(file, `${list}[].${key} uses npx (slow on Windows): call the entry point with "node"`);
      }
      if (!("run" in entry)) fail(file, `${list}[] without run`);
    }
  }
  for (const entry of spec.forbidden ?? []) {
    try {
      new RegExp(entry.pattern, entry.flags ?? "");
    } catch (error) {
      fail(file, `invalid regex ${entry.pattern}: ${error.message}`);
    }
    if (!entry.message) fail(file, `forbidden pattern without message: ${entry.pattern}`);
  }
  const plugin = file.replace(/\\/g, "/").split("/plugins/")[1]?.split("/")[0];
  if (plugin && !spec.agent?.startsWith(`${plugin}:`)) fail(file, `agent should be "${plugin}:<agent>"`);
}

// 4. Marketplace
const marketplace = JSON.parse(readFileSync(join(ROOT, ".claude-plugin", "marketplace.json"), "utf8"));
for (const entry of marketplace.plugins) {
  const dir = join(ROOT, entry.source);
  const manifest = join(dir, ".claude-plugin", "plugin.json");
  if (!existsSync(manifest)) {
    fail(dir, `marketplace entry "${entry.name}" has no plugin.json`);
    continue;
  }
  const plugin = JSON.parse(readFileSync(manifest, "utf8"));
  if (plugin.name !== entry.name) fail(manifest, `name "${plugin.name}" differs from marketplace entry "${entry.name}"`);
  if (!plugin.version) fail(manifest, "missing version");
}

// 5. YAML (best effort)
const yamlFiles = files.filter((f) => /\.ya?ml$/.test(f));
const yamlCheck = spawnSync(
  "uv",
  ["run", "-q", "--no-project", "--with", "pyyaml", "python", "-I", "-c",
    "import sys,yaml\nbad=0\nfor f in sys.argv[1:]:\n  t=open(f,encoding='utf8').read()\n  try:\n    yaml.safe_load(t)\n  except Exception:\n    try:\n      yaml.safe_load('jobs:\\n'+t)\n    except Exception as e:\n      bad+=1; print(f+': '+str(e).splitlines()[0])\nsys.exit(1 if bad else 0)",
    ...yamlFiles],
  { encoding: "utf8" },
);
if (yamlCheck.error) notes.push("YAML not checked (uv not available)");
else if (yamlCheck.status !== 0) for (const line of yamlCheck.stdout.trim().split("\n")) failures.push(`YAML ${line}`);

// 6. Hook tests
const tests = spawnSync(process.execPath, ["--test", join(ROOT, "plugins", "cuadrilla", "hooks", "tests", "hooks.test.mjs")], { encoding: "utf8" });
const summary = /[ℹ#] pass (\d+)[\s\S]*?[ℹ#] fail (\d+)/.exec(tests.stdout);
if (tests.status !== 0) failures.push(`hook tests failed (${summary ? `${summary[2]} failing` : "see node --test output"})`);
else notes.push(`hook tests: ${summary?.[1] ?? "?"} passed`);

// 7. Eval runner tests, including the dry run that proves every case is fair (no Claude calls)
const evals = spawnSync(process.execPath, ["--test", join(ROOT, "evals", "tests", "evals.test.mjs")], { encoding: "utf8" });
const evalSummary = /[ℹ#] pass (\d+)[\s\S]*?[ℹ#] fail (\d+)/.exec(evals.stdout);
if (evals.status !== 0) failures.push(`eval tests failed (${evalSummary ? `${evalSummary[2]} failing` : "see node --test evals/tests/evals.test.mjs"})`);
else notes.push(`eval tests: ${evalSummary?.[1] ?? "?"} passed (cases validated with their reference solutions)`);

// 8. Curator tests (fake Claude, simulated evals)
const curator = spawnSync(process.execPath, ["--test", join(ROOT, "curator", "tests", "curator.test.mjs")], { encoding: "utf8" });
const curatorSummary = /[ℹ#] pass (\d+)[\s\S]*?[ℹ#] fail (\d+)/.exec(curator.stdout);
if (curator.status !== 0) failures.push(`curator tests failed (${curatorSummary ? `${curatorSummary[2]} failing` : "see node --test curator/tests/curator.test.mjs"})`);
else notes.push(`curator tests: ${curatorSummary?.[1] ?? "?"} passed`);

for (const note of notes) console.log(`ℹ ${note}`);
if (failures.length) {
  console.error(`✖ ${failures.length} problem(s):\n${failures.map((f) => `  - ${f}`).join("\n")}`);
  process.exit(1);
}
console.log(`✔ cuadrilla self-check passed (${files.length} files)`);
