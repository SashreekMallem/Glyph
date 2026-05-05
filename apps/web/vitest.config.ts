import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@glyph/extract": path.resolve(
        __dirname,
        "../../packages/extract/src/index.ts",
      ),
    },
  },
  css: { postcss: { plugins: [] } },
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    include: [
      "test/**/*.test.ts",
      "test/**/*.test.tsx",
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
    ],
    testTimeout: 15000,
    setupFiles: ["./vitest.setup.ts"],
  },
});
