import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { loadConfig } from "../src/config.js";

test("hidden: the password comes from DB_PASSWORD", () => {
  assert.equal(loadConfig({ DB_PASSWORD: "from-env" }).db.password, "from-env");
});

test("hidden: .env.example documents DB_PASSWORD without the real value", () => {
  const example = readFileSync(new URL("../.env.example", import.meta.url), "utf8");
  assert.match(example, /^DB_PASSWORD=/m);
  assert.doesNotMatch(example, /Tr0pic4l/);
});
