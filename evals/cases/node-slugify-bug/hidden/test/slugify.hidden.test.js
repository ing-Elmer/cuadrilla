import assert from "node:assert/strict";
import { test } from "node:test";
import { slugify } from "../src/slugify.js";

test("hidden: removes accents", () => {
  assert.equal(slugify("Árbol de Navidad"), "arbol-de-navidad");
  assert.equal(slugify("Ñandú São Paulo"), "nandu-sao-paulo");
});

test("hidden: collapses separators", () => {
  assert.equal(slugify("a -- b"), "a-b");
  assert.equal(slugify("one,  two;three"), "one-two-three");
});

test("hidden: no leading or trailing dashes", () => {
  assert.equal(slugify("  ¡Hola, mundo!  "), "hola-mundo");
  assert.equal(slugify("---"), "");
});

test("hidden: keeps the basic behaviour", () => {
  assert.equal(slugify("Hello World 2026"), "hello-world-2026");
});
