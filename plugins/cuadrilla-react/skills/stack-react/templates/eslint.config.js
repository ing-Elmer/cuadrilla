// cuadrilla — React stack: ESLint flat config (typescript-eslint + react-hooks + jsx-a11y + Prettier).
// Dev dependencies: eslint@9 eslint_d @eslint/js@9 typescript-eslint eslint-plugin-react-hooks
//   eslint-plugin-react-refresh eslint-plugin-jsx-a11y eslint-config-prettier globals prettier
// (eslint-plugin-jsx-a11y does not declare ESLint 10 support yet: stay on ESLint 9 until it does.)
//
// The layer rules below are the CI enforcement of the folder contract in the stack-react skill:
//   - axios is imported only in src/api/api.ts
//   - no ../ imports (use the @/ alias)
//   - components/ and pages/ never import services/ or api/ (they use hooks/)
//   - hooks/ never import api/ (they use services/)
import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

const relative = {
  regex: "^\\.\\./",
  message: "Use the @/ alias instead of ../ imports.",
};
const noAxios = {
  group: ["axios"],
  message: "axios is imported only in src/api/api.ts. Call the API through a service and request<T>().",
};
const noApiLayer = {
  regex: "^@/api/",
  message: "Only services/ and context/ use the api layer. UI code goes through hooks/ and services/.",
};
const noServices = {
  regex: "^@/services/",
  message: "Components and pages get data through hooks/use<Feature>.ts, not services directly.",
};

const restrict = (...patterns) => ["error", { patterns }];

export default defineConfig([
  globalIgnores(["dist", "coverage", "node_modules"]),
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      tseslint.configs.strict,
      tseslint.configs.stylistic,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
      jsxA11y.flatConfigs.recommended,
    ],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.browser,
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/ban-ts-comment": ["error", { "ts-expect-error": true, "ts-ignore": true, "ts-nocheck": true }],
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-console": ["error", { allow: ["warn", "error"] }],
      eqeqeq: ["error", "smart"],
      "react-hooks/exhaustive-deps": "error",
      "no-restricted-globals": [
        "error",
        { name: "fetch", message: "Use a service and request<T>() (src/services/ApiClient.ts)." },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: "dangerouslySetInnerHTML is forbidden; render text, or justify a constant/sanitized value in review.",
        },
        {
          selector: "CallExpression[callee.object.name='window'][callee.property.name=/^(alert|confirm|prompt)$/]",
          message: "Use the shared ConfirmDialog / toast components instead of window dialogs.",
        },
      ],
      "no-restricted-imports": restrict(relative, noAxios),
    },
  },
  {
    files: ["src/api/api.ts"],
    rules: { "no-restricted-imports": restrict(relative) },
  },
  {
    files: ["src/components/**/*.{ts,tsx}", "src/pages/**/*.{ts,tsx}"],
    rules: { "no-restricted-imports": restrict(relative, noAxios, noApiLayer, noServices) },
  },
  {
    files: ["src/hooks/**/*.{ts,tsx}"],
    rules: { "no-restricted-imports": restrict(relative, noAxios, noApiLayer) },
  },
  {
    // Tests may build fake axios adapters/errors; layer rules do not apply to them.
    files: ["src/**/*.test.{ts,tsx}", "src/test/**/*.{ts,tsx}"],
    rules: { "no-restricted-imports": restrict(relative) },
  },
  {
    files: ["*.config.{js,ts}", "vite.config.ts"],
    languageOptions: { globals: globals.node },
  },
  prettier,
]);
