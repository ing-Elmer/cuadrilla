#!/usr/bin/env node
// Aggregates .claude/cuadrilla/metrics.jsonl into a report: what the guard blocked, which
// forbidden patterns keep coming back, where lint fails, which agents/skills/commands are used,
// and the three most repeated patterns. Read-only except --save.
//
//   node report.mjs [--days 30] [--anonymous] [--json] [--save] [--root <project>]
//
// --days 0 means all history. --anonymous replaces component names and project-specific rule
// texts and drops session ids, so the report can be shared with whoever maintains the kit.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { METRICS_DIR } from "../../hooks/scripts/lib.mjs";

// --- Arguments ------------------------------------------------------------------------------

export function parseArgs(argv) {
  const options = { days: 30, anonymous: false, json: false, save: false, root: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--anonymous" || arg === "anonymous" || arg === "anonimo" || arg === "anônimo") options.anonymous = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--save") options.save = true;
    else if (arg === "--root") options.root = argv[++i] ?? null;
    else if (arg === "--days") options.days = Number(argv[++i]);
    else if (/^\d+$/.test(arg)) options.days = Number(arg);
  }
  if (!Number.isFinite(options.days) || options.days < 0) options.days = 30;
  return options;
}

// --- Reading --------------------------------------------------------------------------------

export function readEvents(root, days, now = Date.now()) {
  const cutoff = days > 0 ? now - days * 86_400_000 : -Infinity;
  const events = [];
  let invalid = 0;
  for (const name of ["metrics.1.jsonl", "metrics.jsonl"]) {
    const file = join(root, METRICS_DIR, name);
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        const time = Date.parse(event?.ts);
        if (!event || typeof event.kind !== "string" || Number.isNaN(time)) invalid++;
        else if (time >= cutoff) events.push(event);
      } catch {
        invalid++;
      }
    }
  }
  events.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  return { events, invalid };
}

// --- Aggregation ----------------------------------------------------------------------------

const bump = (map, key, by = 1) => map.set(key, (map.get(key) ?? 0) + by);
const sorted = (map) => [...map].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));

// What to look at when a guard rule keeps firing. The report comments are a starting point; the
// skill turns them into concrete changes for this project.
const GUARD_HINTS = {
  push: "Agents keep trying to push. Check that commands and agent prompts end with a summary for a person; in unattended runs the only push is `git push -u origin agent/<name>`, as one command.",
  "pr-merge-approve": "Agents try to merge or approve PRs. A person does that; make sure the ticket/PR flow ends at a draft PR.",
  "recursive-delete": "Agents reach for recursive deletes, usually to clean build output. Add a clean command to the component's checks or document the safe one.",
  "secret-file": "Agents try to open secret files. Make sure each component has a `.env.example` with every variable name, so they never need the real file.",
  "secret-in-content": "Agents tried to write something that looks like a secret. Check the example values in docs and fixtures: they should be obvious fakes.",
  "db-migration": "Agents try to run migrations. Remind them in the stack pack that migration scripts are written, never executed.",
  sql: "Agents try to run SQL against a database. Point them to a read-only MCP or to tests with a disposable database.",
  "merge-rebase": "Agents try to merge or rebase. Branches are integrated through PRs; this often means a task started on the wrong branch.",
  "force-install": "Agents try forced installs. Usually a dependency conflict worth fixing once by a person.",
  "env-dump": "Agents try to dump the environment to debug configuration. Document the configuration names in the profile instead.",
  "draft-pr-required": "In unattended runs agents tried to open non-draft PRs. Check the ticket/pr command text.",
  "remote-tampering": "In unattended runs an agent tried to change a git remote or git config. Review those sessions: it is unusual.",
};

export function aggregate(events) {
  const sessions = new Set();
  const unattendedSessions = new Set();
  const report = {
    period: { from: events[0]?.ts ?? null, to: events.at(-1)?.ts ?? null },
    events: events.length,
    sessionStarts: 0,
    stacks: new Map(),
    guard: { deny: new Map(), ask: new Map(), denyUnattended: new Map(), sessionsByRule: new Map() },
    stopCheck: { turns: 0, findings: 0, rules: new Map(), sources: new Map(), sessionsByRule: new Map() },
    lint: { events: 0, problems: new Map(), byExt: new Map() },
    agents: new Map(),
    skills: new Map(),
    commands: new Map(),
  };
  const addSession = (map, key, session) => {
    if (!session) return;
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(session);
  };

  for (const event of events) {
    const session = typeof event.session === "string" ? event.session : null;
    if (session) sessions.add(session);
    if (session && event.unattended === true) unattendedSessions.add(session);
    switch (event.kind) {
      case "session":
        report.sessionStarts++;
        for (const stack of Array.isArray(event.stacks) ? event.stacks : []) bump(report.stacks, String(stack));
        break;
      case "guard": {
        const rule = String(event.rule ?? "unknown");
        if (event.decision === "ask") bump(report.guard.ask, rule);
        else {
          bump(report.guard.deny, rule);
          if (event.unattended === true) bump(report.guard.denyUnattended, rule);
          addSession(report.guard.sessionsByRule, rule, session);
        }
        break;
      }
      case "stop-check":
        report.stopCheck.turns++;
        report.stopCheck.findings += Number(event.findings) || 0;
        for (const pattern of Array.isArray(event.patterns) ? event.patterns : []) {
          const rule = String(pattern?.rule ?? "unknown");
          bump(report.stopCheck.rules, rule, Number(pattern?.count) || 1);
          report.stopCheck.sources.set(rule, pattern?.source === "project" ? "project" : "builtin");
          addSession(report.stopCheck.sessionsByRule, rule, session);
        }
        break;
      case "lint":
        report.lint.events++;
        bump(report.lint.problems, String(event.component ?? "unknown"), Number(event.problems) || 0);
        if (event.ext) bump(report.lint.byExt, String(event.ext), Number(event.problems) || 0);
        break;
      case "agent":
        bump(report.agents, String(event.name ?? "unknown"));
        break;
      case "skill":
        bump(report.skills, String(event.name ?? "unknown"));
        break;
      case "command":
        bump(report.commands, String(event.name ?? "unknown"));
        break;
      default:
        break;
    }
  }
  report.sessions = sessions.size;
  report.unattendedSessions = unattendedSessions.size;
  report.patterns = topPatterns(report);
  return report;
}

/** The three most repeated problems across guard denies, stop-check rules and lint. */
export function topPatterns(report, limit = 3) {
  const candidates = [];
  for (const [rule, count] of report.guard.deny) {
    const sessions = report.guard.sessionsByRule.get(rule)?.size ?? 0;
    candidates.push({
      source: "guard",
      rule,
      count,
      sessions,
      summary: `guard blocked \`${rule}\` ${count} time(s)${sessions ? ` in ${sessions} session(s)` : ""}`,
      hint: GUARD_HINTS[rule] ?? "Find out what the agents were trying to achieve and give them the allowed way to do it.",
    });
  }
  for (const [rule, count] of report.stopCheck.rules) {
    const sessions = report.stopCheck.sessionsByRule.get(rule)?.size ?? 0;
    candidates.push({
      source: "stop-check",
      rule,
      count,
      sessions,
      summary: `stop-check found "${rule}" ${count} time(s)${sessions ? ` in ${sessions} session(s)` : ""}`,
      hint: "The agents keep writing this. Add the rule, with the right alternative, to the stack pack or the agent that writes that code, so it is avoided instead of fixed afterwards.",
    });
  }
  for (const [component, count] of report.lint.problems) {
    candidates.push({
      source: "lint",
      rule: component,
      count,
      sessions: 0,
      summary: `lint reported ${count} problem(s) in component \`${component}\``,
      hint: "Look at which lint rules fail most in this component and add them to its stack skill or agent.",
    });
  }
  return candidates
    .filter((c) => c.count >= 2)
    .sort((a, b) => b.count - a.count || b.sessions - a.sessions || a.rule.localeCompare(b.rule))
    .slice(0, limit);
}

// --- Anonymizing ----------------------------------------------------------------------------

/** Replaces component names and project-specific rule texts; built-in rule names stay. */
export function anonymize(report) {
  const components = new Map();
  const componentAlias = (name) => {
    if (name === "builtin") return name;
    if (!components.has(name)) components.set(name, `component-${components.size + 1}`);
    return components.get(name);
  };
  const projectRules = new Map();
  const ruleAlias = (rule) => {
    if (report.stopCheck.sources.get(rule) !== "project") return rule;
    if (!projectRules.has(rule)) projectRules.set(rule, `project rule #${projectRules.size + 1}`);
    return projectRules.get(rule);
  };
  const remap = (map, alias) => {
    const out = new Map();
    for (const [key, value] of map) {
      const k = alias(key);
      out.set(k, value instanceof Set ? new Set([...(out.get(k) ?? []), ...value]) : (out.get(k) ?? 0) + value);
    }
    return out;
  };
  const copy = {
    ...report,
    anonymous: true,
    lint: { ...report.lint, problems: remap(report.lint.problems, componentAlias) },
    stopCheck: {
      ...report.stopCheck,
      rules: remap(report.stopCheck.rules, ruleAlias),
      sessionsByRule: remap(report.stopCheck.sessionsByRule, ruleAlias),
      sources: new Map([...report.stopCheck.sources].map(([rule, source]) => [ruleAlias(rule), source])),
    },
  };
  copy.patterns = topPatterns(copy);
  return copy;
}

// --- Output ---------------------------------------------------------------------------------

function table(title, map, columns, limit = 15) {
  const rows = sorted(map).slice(0, limit);
  if (!rows.length) return [];
  return [`### ${title}`, "", `| ${columns[0]} | ${columns[1]} |`, "|---|---:|", ...rows.map(([k, v]) => `| ${k} | ${v} |`), ""];
}

export function toMarkdown(report, options) {
  const day = (ts) => (ts ? ts.slice(0, 10) : "—");
  const lines = [
    `# Cuadrilla metrics report${report.anonymous ? " (anonymous)" : ""}`,
    "",
    `- Period: ${options.days > 0 ? `last ${options.days} day(s)` : "all history"} (${day(report.period.from)} → ${day(report.period.to)})`,
    `- Sessions: ${report.sessions} (${report.unattendedSessions} unattended) · session starts: ${report.sessionStarts} · events: ${report.events}`,
  ];
  if (report.stacks.size) lines.push(`- Stacks: ${sorted(report.stacks).map(([s]) => s).join(", ")}`);
  if (options.invalid) lines.push(`- Skipped ${options.invalid} unreadable line(s) in the metrics file.`);
  lines.push("");

  if (!report.events) {
    lines.push("No events in this period. Metrics are recorded by the cuadrilla hooks while the team works; check that they are not turned off (`\"metrics\": false` in `.claude/cuadrilla.json` or `CUADRILLA_METRICS=off`).");
    return lines.join("\n");
  }

  lines.push("## Most repeated patterns", "");
  if (report.patterns.length) {
    report.patterns.forEach((p, i) => lines.push(`${i + 1}. **${p.summary}.** ${p.hint}`));
  } else {
    lines.push("Nothing repeated twice or more in this period.");
  }
  lines.push("");

  lines.push("## Guardrails", "");
  const denies = [...report.guard.deny.values()].reduce((a, b) => a + b, 0);
  const asks = [...report.guard.ask.values()].reduce((a, b) => a + b, 0);
  lines.push(`Blocked: ${denies} · confirmations requested: ${asks}`, "");
  lines.push(...table("Blocked by rule", report.guard.deny, ["Rule", "Times"]));
  lines.push(...table("Blocked in unattended runs", report.guard.denyUnattended, ["Rule", "Times"]));
  lines.push(...table("Confirmation requested by rule", report.guard.ask, ["Rule", "Times"]));

  lines.push("## Standard (stop-check)", "");
  lines.push(`Turns handed back: ${report.stopCheck.turns} · findings: ${report.stopCheck.findings}`, "");
  lines.push(...table("Findings by pattern", report.stopCheck.rules, ["Pattern", "Times"]));

  lines.push("## Lint", "");
  lines.push(`Edits with lint problems: ${report.lint.events}`, "");
  lines.push(...table("Problems by component", report.lint.problems, ["Component", "Problems"]));
  lines.push(...table("Problems by file type", report.lint.byExt, ["Extension", "Problems"]));

  lines.push("## Usage", "");
  lines.push(...table("Commands", report.commands, ["Command", "Times"]));
  lines.push(...table("Agents", report.agents, ["Agent", "Times"]));
  lines.push(...table("Skills", report.skills, ["Skill", "Times"]));
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
}

export function toJson(report, options) {
  const plain = (map) => Object.fromEntries(sorted(map));
  return {
    anonymous: Boolean(report.anonymous),
    days: options.days,
    period: report.period,
    sessions: report.sessions,
    unattendedSessions: report.unattendedSessions,
    sessionStarts: report.sessionStarts,
    events: report.events,
    stacks: plain(report.stacks),
    guard: { deny: plain(report.guard.deny), ask: plain(report.guard.ask), denyUnattended: plain(report.guard.denyUnattended) },
    stopCheck: { turns: report.stopCheck.turns, findings: report.stopCheck.findings, rules: plain(report.stopCheck.rules) },
    lint: { events: report.lint.events, problems: plain(report.lint.problems), byExt: plain(report.lint.byExt) },
    usage: { commands: plain(report.commands), agents: plain(report.agents), skills: plain(report.skills) },
    patterns: report.patterns.map(({ source, rule, count, sessions, summary, hint }) => ({ source, rule, count, sessions, summary, hint })),
  };
}

// --- Main -----------------------------------------------------------------------------------

const isMain = Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const options = parseArgs(process.argv.slice(2));
  const root = resolve(options.root ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd());
  const { events, invalid } = readEvents(root, options.days);
  let report = aggregate(events);
  if (options.anonymous) report = anonymize(report);
  const output = options.json ? JSON.stringify(toJson(report, options), null, 2) : toMarkdown(report, { ...options, invalid });
  if (options.save) {
    const dir = join(root, METRICS_DIR, "reports");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `report-${new Date().toISOString().slice(0, 10)}${options.anonymous ? "-anonymous" : ""}.${options.json ? "json" : "md"}`);
    writeFileSync(file, `${output}\n`);
    process.stdout.write(`${output}\n\nSaved to ${file}\n`);
  } else {
    process.stdout.write(`${output}\n`);
  }
}
