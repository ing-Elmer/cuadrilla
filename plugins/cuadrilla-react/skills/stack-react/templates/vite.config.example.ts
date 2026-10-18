// cuadrilla — React stack: Vite + Vitest configuration (copy to vite.config.ts and adapt).
// - "@" alias → src/ (must match "paths" in tsconfig.app.json: { "@/*": ["./src/*"] }).
// - Tailwind v4 through its Vite plugin (CSS-first: no tailwind.config.js, no postcss config).
// - Vitest lives here, under "test" (no separate vitest.config.ts).
// Check the pinned versions in package.json and their docs (Context7) before changing options.
import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    // Source maps expose the original code; enable only if the profile says they are uploaded
    // privately (e.g. to an error tracker) and not served.
    sourcemap: false,
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    restoreMocks: true,
    unstubEnvs: true,
    // Tests never hit a real API: this value only satisfies the VITE_API_URL check in api.ts.
    env: { VITE_API_URL: "http://api.test" },
    include: ["src/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/test/**", "src/main.tsx", "src/**/*.d.ts"],
    },
  },
});
