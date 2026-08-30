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
    testTimeout: 30000,
    setupFiles: ["./tests/setup.ts"],
    // Integration tests share one Postgres database; run test files serially so
    // parallel transactions on the GiST exclusion index can't deadlock.
    fileParallelism: false,
    coverage: {
      provider: "v8",
      include: ["src/server/**", "src/lib/**"],
    },
  },
});
