// ESLint flat config for a cuadrilla node-typescript backend.
// Requires: eslint, eslint_d, @eslint/js, typescript-eslint, eslint-config-prettier (devDependencies).
// eslint_d keeps ESLint loaded between edits so the cuadrilla format hook lints a file in ~0.2 s.
import eslint from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import prettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

export default defineConfig(
  globalIgnores(["dist/", "coverage/", "node_modules/"]),
  eslint.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "no-console": "error",
      eqeqeq: ["error", "always"],
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "dotenv",
              message: "Config comes from parseConfig(); dev loads .env with node --env-file.",
            },
            { name: "jsonwebtoken", message: "Use jose." },
            {
              name: "express",
              message: "The standard uses Fastify (see the project profile for exceptions).",
            },
          ],
          patterns: [
            {
              group: [
                "@prisma/*",
                "typeorm",
                "sequelize",
                "@mikro-orm/*",
                "drizzle-orm",
                "drizzle-orm/*",
              ],
              message: "ORMs are not allowed by the standard.",
            },
          ],
        },
      ],
      "no-restricted-properties": [
        "error",
        {
          object: "process",
          property: "env",
          message: "Read configuration through AppConfig (parseConfig in src/core/config.ts).",
        },
      ],
    },
  },
  {
    // The single entry point is the only place allowed to read process.env.
    files: ["src/main.ts"],
    rules: { "no-restricted-properties": "off" },
  },
  {
    files: ["test/**/*.ts", "**/*.test.ts"],
    rules: {
      "no-restricted-properties": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    // CommonJS config files (.dependency-cruiser.cjs): enables the module/require globals.
    files: ["**/*.cjs"],
    languageOptions: { sourceType: "commonjs" },
  },
  prettier,
);
