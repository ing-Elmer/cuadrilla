#!/usr/bin/env node
// PreToolUse (Agent|Task|Skill) and UserPromptSubmit — records WHICH agents, skills and slash
// commands the team uses, so /cuadrilla:report can show it. It never records the prompt, the
// task description or the command's arguments: only the agent type, the skill name or the
// command name. Never blocks and never prints anything.
import { loadConfig, projectRoot, readInput, recordEvent } from "./lib.mjs";

const NAME = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,80}$/;
const clean = (value) => (typeof value === "string" && NAME.test(value.trim()) ? value.trim() : null);

const input = await readInput();
const root = projectRoot(input);
const { config } = loadConfig(root);
const event = input.hook_event_name ?? "";
const tool = input.tool_name ?? "";
const data = input.tool_input ?? {};

if (event === "UserPromptSubmit") {
  // Only a slash command typed as the first word counts; everything else is the user's text.
  const command = /^\s*\/([A-Za-z0-9][A-Za-z0-9:._-]{0,80})(?:\s|$)/.exec(String(input.prompt ?? ""))?.[1];
  if (command) recordEvent(root, config, input, { kind: "command", name: command });
} else if (tool === "Agent" || tool === "Task") {
  recordEvent(root, config, input, { kind: "agent", name: clean(data.subagent_type) ?? "general-purpose" });
} else if (tool === "Skill") {
  const name = clean(data.skill ?? data.name ?? data.command);
  if (name) recordEvent(root, config, input, { kind: "skill", name });
}
process.exit(0);
