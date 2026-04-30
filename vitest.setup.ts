import "@testing-library/jest-dom/vitest";

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

// jsdom 26 ships `HTMLDialogElement` but doesn't implement `showModal()` /
// `close()` on its prototype — calling them throws "Not implemented". Patch
// the prototype with minimal in-memory open/close behavior so vanilla
// `<dialog>`-based components (sign-in modal) are testable. See
// apps.geoglows/docs/solutions/test-failures/jsdom-26-htmldialogelement-undefined-2026-04-29.md
if (typeof HTMLDialogElement !== "undefined") {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal(): void {
      this.open = true;
    };
  }
  if (!HTMLDialogElement.prototype.show) {
    HTMLDialogElement.prototype.show = function show(): void {
      this.open = true;
    };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function close(): void {
      this.open = false;
      this.dispatchEvent(new Event("close"));
    };
  }
}
