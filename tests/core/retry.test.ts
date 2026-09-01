import { describe, expect, it } from "vitest";
import {
  computeBackoffMs,
  isTransientError,
  RequestTimeoutError,
} from "../../src/core/retry";

describe("isTransientError", () => {
  describe("worth another attempt", () => {
    it("treats a fetch transport failure as transient", () => {
      expect(isTransientError(new TypeError("Failed to fetch"))).toBe(true);
    });

    it("treats a request timeout as transient", () => {
      expect(isTransientError(new RequestTimeoutError(10_000))).toBe(true);
    });

    it("treats an abort as transient", () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      expect(isTransientError(error)).toBe(true);
    });

    it("treats 5xx as transient", () => {
      expect(isTransientError({ status: 500 })).toBe(true);
      expect(isTransientError({ status: 503 })).toBe(true);
    });

    it("treats 408 and 429 as transient", () => {
      expect(isTransientError({ status: 408 })).toBe(true);
      expect(isTransientError({ status: 429 })).toBe(true);
    });

    it("treats socket-level codes as transient", () => {
      expect(isTransientError({ code: "ECONNRESET" })).toBe(true);
      expect(isTransientError({ code: "EAI_AGAIN" })).toBe(true);
    });

    it("defaults to transient for an unrecognised shape", () => {
      // Misclassifying an outage as permanent strands the user with no
      // automatic recovery; a couple of wasted attempts do not.
      expect(isTransientError(new Error("something odd"))).toBe(true);
      expect(isTransientError(undefined)).toBe(true);
      expect(isTransientError({})).toBe(true);
    });
  });

  describe("no amount of retrying will help", () => {
    it("treats an RLS denial as permanent", () => {
      expect(
        isTransientError({
          message: "permission denied for table profiles",
          code: "42501",
          status: 403,
        }),
      ).toBe(false);
    });

    it("treats a unique-violation as permanent", () => {
      expect(isTransientError({ code: "23505" })).toBe(false);
    });

    it("treats PostgREST's own codes as permanent", () => {
      expect(isTransientError({ code: "PGRST116" })).toBe(false);
    });

    it("treats bad credentials as permanent", () => {
      expect(
        isTransientError({ status: 400, code: "invalid_credentials" }),
      ).toBe(false);
    });

    it("treats 401/404 as permanent", () => {
      expect(isTransientError({ status: 401 })).toBe(false);
      expect(isTransientError({ status: 404 })).toBe(false);
    });
  });
});

describe("computeBackoffMs", () => {
  it("grows exponentially", () => {
    const opts = { jitter: 0, baseMs: 1000 };
    expect(computeBackoffMs(1, opts)).toBe(1000);
    expect(computeBackoffMs(2, opts)).toBe(2000);
    expect(computeBackoffMs(3, opts)).toBe(4000);
  });

  it("caps at maxMs", () => {
    expect(computeBackoffMs(20, { jitter: 0, baseMs: 1000, maxMs: 5000 })).toBe(
      5000,
    );
  });

  it("spreads the delay so a fleet does not retry in lockstep", () => {
    const opts = { baseMs: 1000, jitter: 0.5 };
    const low = computeBackoffMs(1, { ...opts, random: () => 0 });
    const high = computeBackoffMs(1, { ...opts, random: () => 1 });

    expect(low).toBe(500);
    expect(high).toBe(1000);
  });

  it("treats attempt numbers below 1 as the first attempt", () => {
    expect(computeBackoffMs(0, { jitter: 0, baseMs: 1000 })).toBe(1000);
  });
});
