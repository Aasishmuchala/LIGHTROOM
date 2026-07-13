import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// The ported core (packs / metrics / schemas) plus the stateful layer (store / engine /
// route) are pure/DOM-light TS, so tests run in the plain `node` environment. The
// store/engine tests self-install the small browser globals they need (indexedDB via
// fake-indexeddb, a localStorage + window shim) from ./src/test/setup.ts — no jsdom.
//
// Discovery covers the lib core, the engine store, and the API route tests. The `@`
// alias is resolved here too so tests can import from "@/lib/..." / "@/store/..." the
// same way the app does.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    // Threads, not the default forks pool: on Windows the child_process fork workers
    // crash non-deterministically ("Worker exited unexpectedly") under the full suite's
    // parallelism, silently dropping a random file's tests from the count. Every file
    // passes in isolation and under threads (612/612, stable) — the crash is pool
    // infrastructure, not the tests. Threads are also faster here.
    pool: "threads",
    include: [
      "src/lib/__tests__/**/*.test.ts",
      "src/store/__tests__/**/*.test.ts",
      "src/app/api/**/__tests__/**/*.test.ts",
    ],
  },
});
