import { defineConfig } from "vitest/config";

// The ported core (packs / metrics / schemas) is pure TS with no DOM, so tests run in
// the plain `node` environment. Discovery is scoped to src/lib/__tests__ so vitest
// never tries to load the Next.js app files.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/lib/__tests__/**/*.test.ts"],
  },
});
