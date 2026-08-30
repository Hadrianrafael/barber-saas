import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "server-only": path.resolve(__dirname, "./tests/stubs/empty.ts"),
      "client-only": path.resolve(__dirname, "./tests/stubs/empty.ts"),
    },
  },
  test: {
    environment: "node",
    include: [
      "src/**/*.test.{ts,tsx}",
      "tests/unit/**/*.test.{ts,tsx}",
      "tests/integration/**/*.test.{ts,tsx}",
    ],
    testTimeout: 20000,
    setupFiles: [],
    coverage: {
      provider: "v8",
      include: ["src/server/**", "src/lib/**"],
    },
  },
});
