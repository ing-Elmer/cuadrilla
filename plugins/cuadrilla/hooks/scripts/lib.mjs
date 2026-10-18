// Shared helpers for cuadrilla hooks. No dependencies: Node >= 18 only.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const CONFIG_PATH = join(".claude", "cuadrilla.json");

/** Reads the JSON Claude Code sends on stdin. Returns {} when empty or invalid. */
export async function readInput() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

/** Prints a structured JSON answer and exits 0. */
export function respond(object) {
  process.stdout.write(JSON.stringify(object));
  process.exit(0);
}

/** PreToolUse: block the tool call with a reason Claude can read. */
export function deny(reason) {
  respond({
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason },
  });
}

/** PreToolUse: force a user confirmation even if permissions would allow the call. */
export function ask(reason) {
  respond({
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: reason },
  });
}

/**
 * Runs a command without a shell (with a quoted shell only on Windows, where npx/npm/gradlew
 * are .cmd/.bat shims). Never throws: returns { ok, output, notFound }.
 */
export function run(command, args, options = {}) {
  const useShell = process.platform === "win32" && !/\.exe$/i.test(command) && options.shellOnWindows !== false;
  const quote = (value) => (useShell && /[\s&()^|<>"]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value);
  try {
    const output = execFileSync(quote(command), args.map(quote), {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: options.timeout ?? 30_000,
      cwd: options.cwd,
      shell: useShell,
      windowsHide: true,
    });
    return { ok: true, output };
  } catch (error) {
    const output = `${error.stdout ?? ""}${error.stderr ?? ""}`.trim();
    // Missing tool: binary not on PATH, or a node script whose package isn't installed.
    const notFound =
      error.code === "ENOENT" ||
      /is not recognized as an internal or external command|command not found|code: '(?:ERR_)?MODULE_NOT_FOUND'/i.test(output);
    return { ok: false, output, notFound };
  }
}

/** git helper: runs git in `cwd` without a shell. */
export function git(args, cwd, timeout = 15_000) {
  return run("git", args, { cwd, timeout, shellOnWindows: false });
}

/** Walks up from `from` looking for `file`; stops at `stop` (inclusive). */
export function findUp(from, file, stop) {
  let current = resolve(from);
  const limit = stop ? resolve(stop) : null;
  for (;;) {
    if (existsSync(join(current, file))) return current;
    const parent = dirname(current);
    if (parent === current || (limit && current === limit)) return null;
    current = parent;
  }
}

/** Project root: the one Claude Code exports, or the input's cwd. */
export function projectRoot(input) {
  return process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
}

/** Loads .claude/cuadrilla.json. Returns { config, error }; config is {} when absent. */
export function loadConfig(root) {
  const file = join(root, CONFIG_PATH);
  if (!existsSync(file)) return { config: {}, exists: false };
  try {
    const config = JSON.parse(readFileSync(file, "utf8"));
    return { config: config && typeof config === "object" ? config : {}, exists: true };
  } catch (error) {
    return { config: {}, exists: true, error: `${CONFIG_PATH} is not valid JSON: ${error.message}` };
  }
}

/** Normalizes a path to forward slashes, relative to root when possible. */
export function relativePath(root, file) {
  const normalizedRoot = resolve(root).replace(/\\/g, "/").replace(/\/$/, "");
  const normalized = resolve(root, file).replace(/\\/g, "/");
  return normalized.toLowerCase().startsWith(`${normalizedRoot.toLowerCase()}/`)
    ? normalized.slice(normalizedRoot.length + 1)
    : normalized;
}

/** Minimal glob → RegExp: supports **, *, ? and {a,b}. Matches against forward-slash paths. */
export function globToRegExp(glob) {
  let pattern = "";
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i];
    if (char === "*") {
      if (glob[i + 1] === "*") {
        const slash = glob[i + 2] === "/";
        pattern += slash ? "(?:.*/)?" : ".*";
        i += slash ? 2 : 1;
      } else pattern += "[^/]*";
    } else if (char === "?") pattern += "[^/]";
    else if (char === "{") {
      const end = glob.indexOf("}", i);
      if (end === -1) pattern += "\\{";
      else {
        pattern += `(?:${glob
          .slice(i + 1, end)
          .split(",")
          .map((part) => part.replace(/[.+^$()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*"))
          .join("|")})`;
        i = end;
      }
    } else pattern += char.replace(/[.+^$()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${pattern}$`, "i");
}

export function matchesGlob(path, glob) {
  const normalized = path.replace(/\\/g, "/");
  const regex = globToRegExp(glob);
  // A glob without a slash matches the file name anywhere (like .gitignore).
  return regex.test(normalized) || (!glob.includes("/") && regex.test(normalized.split("/").pop() ?? ""));
}

// --- Sensitive files ------------------------------------------------------------------------

const SAFE_EXAMPLES = /\.(example|sample|template|dist|defaults)(\.[a-z0-9]+)?$/i;

/** File names that always hold secrets. Projects add more with `protectedPaths`. */
export const DEFAULT_PROTECTED = [
  ".env",
  ".env.*",
  "*.pem",
  "*.key",
  "*.pfx",
  "*.p12",
  "*.jks",
  "*.keystore",
  "id_rsa*",
  "id_ed25519*",
  "id_ecdsa*",
  "credentials.json",
  "service-account*.json",
  ".npmrc.local",
  ".pypirc",
  "*.tfstate",
  "*.tfstate.*",
];

/** True when `path` points to a protected file (examples like .env.example are allowed). */
export function isProtectedPath(path, extra = []) {
  if (!path || typeof path !== "string") return false;
  const name = path.replace(/\\/g, "/").split("/").pop() ?? "";
  if (!name || SAFE_EXAMPLES.test(name) || name.endsWith(".pub")) return false;
  return [...DEFAULT_PROTECTED, ...extra].some((glob) => matchesGlob(path, glob));
}

/** True when a shell command mentions a protected file as an argument. */
export function commandTouchesProtected(command, extra = []) {
  const tokens = command.match(/[^\s"'`;|&<>()=]+/g) ?? [];
  return tokens.some((token) => {
    const clean = token.replace(/[,:]+$/, "");
    // Skip flags, URLs and globs-of-everything; we only care about path-like tokens.
    if (clean.startsWith("-") || /^[a-z]+:\/\//i.test(clean)) return false;
    return isProtectedPath(clean, extra);
  });
}

/** Response language chosen when the plugin was enabled (or the project override). */
export function responseLanguage(config) {
  return config.language || process.env.CLAUDE_PLUGIN_OPTION_RESPONSE_LANGUAGE || "English";
}
