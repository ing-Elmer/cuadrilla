#!/usr/bin/env node
// Stand-in for `claude` in the curator tests. Reads the prompt from stdin, records the call and
// behaves according to FAKE_CURATOR_MODE:
//   edit       — adds one line to plugins/cuadrilla/agents/developer.md (inside the zone)
//   protected  — edits the guard hook (protected)
//   outside    — edits README.md (outside the zone)
//   big        — adds 100 lines to developer.md (over the size limit)
//   nochange   — changes nothing and says why
//   fail       — reports an error
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const prompt = Buffer.concat(chunks).toString("utf8");
const mode = process.env.FAKE_CURATOR_MODE ?? "edit";
const cwd = process.cwd();
if (process.env.FAKE_CURATOR_LOG) appendFileSync(process.env.FAKE_CURATOR_LOG, `${JSON.stringify({ argv: process.argv.slice(2), prompt, cwd })}\n`);

const result = (text, extra = {}) => process.stdout.write(`${JSON.stringify({ type: "result", is_error: false, result: text, total_cost_usd: 0.8, num_turns: 9, duration_ms: 60_000, ...extra })}\n`);
const append = (file, text) => writeFileSync(join(cwd, file), `${readFileSync(join(cwd, file), "utf8")}${text}`);

if (mode === "fail") {
  process.stdout.write(`${JSON.stringify({ type: "result", subtype: "error_max_budget_usd", is_error: true, errors: ["Reached maximum budget ($3)"], total_cost_usd: 3 })}\n`);
  process.exit(1);
}
if (mode === "nochange") {
  result("## No change\nThe orchestrator already says it at the point of decision.");
  process.exit(0);
}
if (mode === "edit") append("plugins/cuadrilla/agents/developer.md", "\nFinish with a summary for a person; never push from here.\n");
if (mode === "protected") append("plugins/cuadrilla/hooks/scripts/guard.mjs", "\n// loosened\n");
if (mode === "outside") append("README.md", "\nCurated.\n");
if (mode === "big") append("plugins/cuadrilla/agents/developer.md", `\n${Array.from({ length: 100 }, (_, i) => `Line ${i}.`).join("\n")}\n`);
result("## Cause\nplugins/cuadrilla/agents/developer.md:36 doesn't say how to finish.\n\n## Change\nSays it.\n\n## Risk\nNone expected; node-slugify-bug would show it.");
