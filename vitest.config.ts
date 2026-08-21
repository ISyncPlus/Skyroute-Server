import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // The domain suite touches neither the database nor the network, so it is
    // safe — and much faster — to run the files in parallel.
    pool: "threads",
    env: {
      NODE_ENV: "test",
      API_URL: "http://localhost:4000",
      WEB_ORIGIN: "http://localhost:3000",
      DATABASE_URL: "postgresql://test:test@localhost:5432/skyroute_test?schema=public",
      SESSION_SECRET: "test-secret-that-is-definitely-long-enough-to-pass",
    },
  },
});
