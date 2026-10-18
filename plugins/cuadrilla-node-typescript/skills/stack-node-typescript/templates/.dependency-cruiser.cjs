/**
 * Layer rules for a cuadrilla node-typescript backend (npm run lint:deps).
 *
 *   api ──► application ──► core ◄── infrastructure
 *    └── container.ts (composition root) may also import infrastructure
 *
 * src/main.ts is the entry point and may import anything.
 * @type {import('dependency-cruiser').IConfiguration}
 */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "Circular imports hide layering problems and break initialization order.",
      from: {},
      to: { circular: true },
    },
    {
      name: "not-to-unresolvable",
      severity: "error",
      comment: "Every import must resolve (missing dependency or wrong relative path).",
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: "no-orphans",
      severity: "warn",
      comment:
        "A module nobody imports is dead code (declaration files and the entry point excepted).",
      from: { orphan: true, pathNot: ["[.]d[.]ts$", "^src/main[.]ts$"] },
      to: {},
    },
    {
      name: "src-not-to-test",
      severity: "error",
      from: { path: "^src/" },
      to: { path: "^test/" },
    },
    // ---- core: pure (types, Zod schemas, interfaces, domain errors, config schema) ----
    {
      name: "core-imports-nothing-internal",
      severity: "error",
      comment:
        "core is the innermost layer: it must not import api, application or infrastructure.",
      from: { path: "^src/core/" },
      to: { path: "^src/(api|application|infrastructure)/" },
    },
    {
      name: "core-no-frameworks-or-io",
      severity: "error",
      comment: "core may only depend on zod: no framework, driver, crypto library or I/O module.",
      from: { path: "^src/core/" },
      to: {
        dependencyTypes: [
          "npm",
          "npm-dev",
          "npm-optional",
          "npm-peer",
          "npm-no-pkg",
          "npm-unknown",
          "core",
        ],
        pathNot: ["node_modules/zod/"],
      },
    },
    // ---- application: services + validators, depends on core only ----
    {
      name: "application-only-core",
      severity: "error",
      from: { path: "^src/application/" },
      to: { path: "^src/(api|infrastructure)/" },
    },
    {
      name: "application-no-frameworks",
      severity: "error",
      comment:
        "Services use core interfaces (repositories, TokenService, PasswordHasher, Logger), never the libraries.",
      from: { path: "^src/application/" },
      to: {
        path: "node_modules/(fastify|@fastify|fastify-[^/]+|pg|pg-[^/]+|kysely|jose|argon2|bcrypt|bcryptjs|pino)/",
      },
    },
    // ---- infrastructure: implements core interfaces ----
    {
      name: "infrastructure-only-core",
      severity: "error",
      from: { path: "^src/infrastructure/" },
      to: { path: "^src/(api|application)/" },
    },
    {
      name: "infrastructure-no-http-framework",
      severity: "error",
      from: { path: "^src/infrastructure/" },
      to: { path: "node_modules/(fastify|@fastify|fastify-[^/]+)/" },
    },
    // ---- api: only the composition root touches infrastructure ----
    {
      name: "api-not-to-infrastructure",
      severity: "error",
      comment:
        "Only src/api/container.ts wires infrastructure; routes receive services by plugin options.",
      from: { path: "^src/api/", pathNot: "^src/api/container[.]ts$" },
      to: { path: "^src/infrastructure/" },
    },
    {
      name: "api-no-db-driver",
      severity: "error",
      from: { path: "^src/api/" },
      to: { path: "node_modules/(pg|pg-[^/]+|kysely)/" },
    },
  ],
  options: {
    doNotFollow: { path: ["node_modules"] },
    exclude: { path: ["^dist/", "^coverage/"] },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      mainFields: ["module", "main", "types", "typings"],
      extensions: [".ts", ".mts", ".js", ".mjs", ".d.ts"],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
