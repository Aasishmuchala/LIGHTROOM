// Test-only browser-global shims for the store/engine suites (node environment, no
// jsdom). Importing this module (side-effecting) installs:
//   - indexedDB + IDBKeyRange, via fake-indexeddb/auto (an in-memory IDB)
//   - a minimal in-memory localStorage
//   - `window` aliased to globalThis, so STORE.isBrowser() (typeof window !== "undefined")
//     takes the real browser code path instead of degrading to in-memory.
//
// Kept out of the pure lib suites (metrics/packs/schemas) — those import nothing from
// here and stay DOM-free.

import "fake-indexeddb/auto";

// -- minimal localStorage polyfill -------------------------------------------------
class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  key(index: number): string | null {
    return Array.from(this.map.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    this.map.set(key, String(value));
  }
}

const g = globalThis as unknown as {
  window?: unknown;
  localStorage?: Storage;
};

if (typeof g.localStorage === "undefined") {
  g.localStorage = new MemoryStorage();
}

// Alias window -> globalThis so isBrowser() is true. Assigning window = globalThis is
// the standard node-side trick; the store only reads window.localStorage / feature-
// detects window, so a full DOM is unnecessary.
if (typeof g.window === "undefined") {
  g.window = globalThis;
}

/** Reset localStorage between tests that care about pref/key isolation. */
export function clearLocalStorage(): void {
  (globalThis as unknown as { localStorage: Storage }).localStorage.clear();
}
