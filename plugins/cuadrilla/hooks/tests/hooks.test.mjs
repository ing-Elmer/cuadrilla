// cuadrilla hook tests. Run: node --test plugins/cuadrilla/hooks/tests/hooks.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { commandTouchesProtected, globToRegExp, isProtectedPath, matchesGlob } from "../scripts/lib.mjs";

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
    env: { ...process.env, CLAUDE_PROJECT_DIR: "", ...env },
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
