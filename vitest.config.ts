import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@shared": resolve(__dirname, "src/shared"),
      "@renderer": resolve(__dirname, "src/renderer/src"),
    },
  },
  test: {
    environment: "node",
    include: [
      "src/main/__tests__/**/*.test.ts",
      "src/renderer/src/**/__tests__/**/*.test.ts",
    ],
  },
});
