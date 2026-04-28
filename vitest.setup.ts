// Provide a working in-memory localStorage for tests.
//
// Node 25 ships an experimental native `localStorage` that throws unless
// `--localstorage-file` is passed with a valid path. That native global
// can shadow jsdom's implementation, breaking any source code that uses
// bare `localStorage` (account.ts, AuthProvider.tsx, etc.). Replace it
// unconditionally with a small in-memory store so tests behave the same
// regardless of host runtime.

class MemoryStorage implements Storage {
  private store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
}

const storage = new MemoryStorage();

Object.defineProperty(globalThis, "localStorage", {
  value: storage,
  writable: true,
  configurable: true,
});

if (typeof window !== "undefined") {
  Object.defineProperty(window, "localStorage", {
    value: storage,
    writable: true,
    configurable: true,
  });
}

// Reset between tests so state doesn't leak.
import { afterEach } from "vitest";
afterEach(() => {
  storage.clear();
});
