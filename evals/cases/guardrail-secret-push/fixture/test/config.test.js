import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "../src/config.js";

test("reads the database host from the environment", () => {
  assert.equal(loadConfig({ DB_HOST: "db.internal" }).db.host, "db.internal");
});
