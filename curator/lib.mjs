// Cuadrilla curator — the decisions, kept importable and testable without Claude or git.
// See curator/README.md.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { matchesGlob } from "../plugins/cuadrilla/hooks/scripts/lib.mjs";

// --- Where the curator may write ------------------------------------------------------------
// Only the text that tells agents how to work. Never code, hooks, security rules, the evals that
// judge it, itself, CI or licensing: an automated change there could disable its own safeguards.

export const ALLOWED = ["plugins/*/agents/*.md", "plugins/*/skills/**/*.md"];
export const PROTECTED = [
  "plugins/cuadrilla/agents/security.md",
  "plugins/cuadrilla/skills/standard-security/**",
  "plugins/cuadrilla/skills/security-audit/**",
  "plugins/*/hooks/**",
  "evals/**",
  "curator/**",
  "scripts/**",
  ".github/**",
  "LICENSE",
];
export const LIMITS = { files: 3, lines: 60 };

/** Problems with a proposed diff: files outside the zone, protected files, or too large. */
export function checkZone(changes, limits = LIMITS) {
  const problems = [];
  for (const { file } of changes) {
    if (PROTECTED.some((glob) => matchesGlob(file, glob))) problems.push(`${file} is protected`);
    else if (!ALLOWED.some((glob) => matchesGlob(file, glob))) problems.push(`${file} is outside the curator's zone (agents and skills text only)`);
  }
  if (changes.length > limits.files) problems.push(`${changes.length} files changed (limit ${limits.files})`);
  const lines = changes.reduce((sum, c) => sum + c.added + c.removed, 0);
  if (lines > limits.lines) problems.push(`${lines} lines changed (limit ${limits.lines})`);
  if (!changes.length) problems.push("no change was made");
  return problems;
}

/** Parses `git diff --numstat` into [{ file, added, removed }]; binary files count as large. */
export function parseNumstat(text) {
  return String(text ?? "")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [added, removed, ...rest] = line.split("\t");
      const binary = added === "-" || removed === "-";
      return { file: rest.join("\t"), added: binary ? 1000 : Number(added), removed: binary ? 1000 : Number(removed) };
    });
}

// --- Reports ----------------------------------------------------------------------------------

/**
 * Reads the JSON reports in the inbox (`/cuadrilla:report <days> anonymous --json --save`).
 * Only anonymous reports are used: the others may carry project names, and project-specific
 * rule texts are free text a project could use to address the curator.
 */
export function loadReports(inbox) {
  const reports = [];
  const rejected = [];
  if (!existsSync(inbox)) return { reports, rejected };
  for (const name of readdirSync(inbox).filter((n) => n.endsWith(".json")).sort()) {
    try {
      const report = JSON.parse(readFileSync(join(inbox, name), "utf8"));
      if (report?.anonymous !== true) rejected.push(`${name}: not anonymous`);
      else if (typeof report.guard !== "object" || typeof report.stopCheck !== "object") rejected.push(`${name}: not a cuadrilla report`);
      else reports.push({ ...report, name });
    } catch (error) {
      rejected.push(`${name}: invalid JSON (${error.message})`);
    }
  }
  return { reports, rejected };
}

// Keys of rules the kit owns. Anything else (renamed project rules, unexpected text) is ignored.
const SAFE_RULE = /^[A-Za-z0-9 .,:;!?'"`()\/[\]#+*_=<>@{}|-]{1,120}$/;
const isProjectRule = (rule) => /^project rule #\d+$/.test(rule);

/** Merges every report into one list of kit-level patterns, counted per project. */
export function mergeReports(reports) {
  const patterns = new Map();
  const add = (source, rule, count, report) => {
    if (!SAFE_RULE.test(rule) || isProjectRule(rule) || !(count > 0)) return;
    const key = `${source}:${rule}`;
    const entry = patterns.get(key) ?? { key, source, rule, count: 0, projects: 0, reports: [] };
    entry.count += count;
    entry.projects += 1;
    entry.reports.push(report.name);
    patterns.set(key, entry);
  };
  for (const report of reports) {
    for (const [rule, count] of Object.entries(report.guard?.deny ?? {})) add("guard", rule, Number(count), report);
    for (const [rule, count] of Object.entries(report.stopCheck?.rules ?? {})) add("stop-check", rule, Number(count), report);
  }
  return [...patterns.values()];
}

/** Rules that exist only to stop something dangerous: being blocked is the success. */
const NEVER_LOOSEN = new Set(["secret-file", "secret-in-content", "remote-tampering", "git-internals", "unsandboxed-agent", "env-dump"]);

/** Outcomes caused by the run, not by the proposal: they don't start a cooldown. */
const RETRYABLE = new Set(["error", "curator-failed"]);

/**
 * Picks up to `max` patterns worth a proposal: seen in enough projects or often enough, not
 * attempted in the last `cooldownDays`. Patterns from several projects come first.
 */
export function pickCandidates(patterns, history, { max = 2, minProjects = 2, minCount = 10, cooldownDays = 30, now = Date.now() } = {}) {
  const recent = new Set(
    (history ?? [])
      .filter((h) => !RETRYABLE.has(h.outcome) && now - Date.parse(h.date) < cooldownDays * 86_400_000)
      .map((h) => h.key),
  );
  return patterns
    .filter((p) => p.projects >= minProjects || p.count >= minCount)
    .filter((p) => !recent.has(p.key))
    .sort((a, b) => b.projects - a.projects || b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, max)
    .map((p) => ({ ...p, guardRail: p.source === "guard" && NEVER_LOOSEN.has(p.rule) }));
}

// --- Where to look ------------------------------------------------------------------------------

const PACKS_BY_EXT = {
  py: ["cuadrilla-python-fastapi"],
  cs: ["cuadrilla-dotnet"],
  java: ["cuadrilla-java-spring"],
  kt: ["cuadrilla-java-spring"],
  ts: ["cuadrilla-node-typescript", "cuadrilla-react"],
  tsx: ["cuadrilla-react"],
  js: ["cuadrilla-node-typescript", "cuadrilla-react"],
  jsx: ["cuadrilla-react"],
};

/** Files the proposal most likely belongs in, given the pattern. A hint, not a constraint. */
export function suggestFiles(candidate) {
  if (candidate.source === "guard") {
    return [
      "plugins/cuadrilla/agents/orchestrator.md",
      "plugins/cuadrilla/agents/developer.md",
      "plugins/cuadrilla/skills/standard-core/SKILL.md",
      "plugins/cuadrilla/skills/ticket/SKILL.md",
      "plugins/cuadrilla/skills/feature/SKILL.md",
    ];
  }
  const text = candidate.rule.toLowerCase();
  const exts = Object.keys(PACKS_BY_EXT).filter((ext) => new RegExp(`\\b${ext}\\b`).test(text));
  const byLanguage = [
    [/print\(|python|f-string|pytest|type: ignore/, "py"],
    [/console\.|any\b|debugger|typescript|\.only|\.skip/, "ts"],
    [/console\.write|\.wait\(|getawaiter|c#/, "cs"],
    [/system\.out|printstacktrace|java/, "java"],
  ];
  for (const [pattern, ext] of byLanguage) if (pattern.test(text)) exts.push(ext);
  const packs = [...new Set(exts.flatMap((ext) => PACKS_BY_EXT[ext] ?? []))];
  return [
    ...packs.flatMap((pack) => {
      const stack = pack.replace(/^cuadrilla-/, "");
      return [`plugins/${pack}/skills/stack-${stack}/SKILL.md`, `plugins/${pack}/agents/`];
    }),
    "plugins/cuadrilla/agents/developer.md",
    "plugins/cuadrilla/skills/standard-core/SKILL.md",
  ];
}

// --- History ----------------------------------------------------------------------------------

export function loadHistory(file) {
  if (!existsSync(file)) return [];
  try {
    const data = JSON.parse(readFileSync(file, "utf8"));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export function saveHistory(file, history) {
  writeFileSync(file, `${JSON.stringify(history, null, 2)}\n`);
}

/** Branch name for a proposal: curator/<date>-<slug of the rule>. */
export function branchName(candidate, date = new Date()) {
  const slug = `${candidate.source}-${candidate.rule}`
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return `curator/${date.toISOString().slice(0, 10)}-${slug || "pattern"}`;
}

/** Whether a proposal is worth a PR, from the evals verdict. */
export function accepted(verdict, { acceptCheaper = true } = {}) {
  return verdict === "better" || (acceptCheaper && verdict === "same quality, cheaper");
}
