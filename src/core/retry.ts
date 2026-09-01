// src/core/retry.ts
//
// Retry policy shared by the connect budget in `bootstrapAuth` and by any
// consumer that wants the same "is this worth trying again?" judgement.
//
// The distinction that matters here is transient vs permanent. Retrying an
// unreachable host is the whole point of a budget; retrying an RLS denial or a
// malformed request burns the budget on a request that can never succeed and
// then reports "service unavailable" for what is really a bug or a permission
// problem.

/**
 * Thrown by the timeout-wrapping `fetch` installed by
 * `createGeoglowsSupabaseClient({ fetchTimeoutMs })`.
 *
 * Distinct from a plain `AbortError` so a timeout can be told apart from a
 * caller-initiated cancellation when both surface as a rejected fetch.
 */
export class RequestTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`Request timed out after ${timeoutMs}ms`);
    this.name = "RequestTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

/** HTTP statuses worth another attempt. Everything else in 4xx is permanent. */
const RETRYABLE_STATUSES = new Set([408, 425, 429]);

/**
 * SQLSTATE class prefixes (and PostgREST's own codes) that describe a request
 * the server understood and rejected: data errors, integrity violations,
 * authorization failures, syntax/access-rule violations. Trying again with the
 * identical request produces the identical rejection.
 */
const PERMANENT_CODE_PATTERN = /^(?:PGRST|22|23|28|42|P0)/;

/** Node/undici transport failures — the network layer, not the request. */
const TRANSIENT_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
  "ENETDOWN",
  "ENETUNREACH",
]);

const TRANSIENT_MESSAGE_PATTERN =
  /failed to fetch|networkerror|network request failed|load failed|network error|socket hang up/i;

/**
 * Is this failure worth another attempt?
 *
 * Unknown shapes default to `true`: a bounded number of extra attempts against
 * something we cannot classify is cheap, while misclassifying a real outage as
 * permanent strands the user on the error icon with no automatic recovery.
 */
export function isTransientError(error: unknown): boolean {
  if (error === null || error === undefined) return true;

  if (error instanceof RequestTimeoutError) return true;

  // fetch() rejects with a TypeError for every transport-level failure.
  if (error instanceof TypeError) return true;

  const err = error as {
    name?: unknown;
    message?: unknown;
    status?: unknown;
    code?: unknown;
  };

  if (err.name === "AbortError" || err.name === "TimeoutError") return true;

  if (typeof err.status === "number") {
    if (err.status >= 500) return true;
    if (RETRYABLE_STATUSES.has(err.status)) return true;
    // Any other status the server actually produced — including 0/2xx/3xx
    // oddities and the whole of 4xx — means it was reachable and answered.
    if (err.status >= 400) return false;
  }

  if (typeof err.code === "string" && err.code) {
    if (TRANSIENT_CODES.has(err.code)) return true;
    if (PERMANENT_CODE_PATTERN.test(err.code)) return false;
  }

  if (typeof err.message === "string" && TRANSIENT_MESSAGE_PATTERN.test(err.message)) {
    return true;
  }

  return true;
}

/** Tuning for {@link computeBackoffMs}. */
export interface BackoffOptions {
  /** Delay before the second attempt. Default 1000. */
  baseMs?: number;
  /** Ceiling on the exponential term. Default 30_000. */
  maxMs?: number;
  /**
   * Fraction of the delay left to chance, in `[0, 1]`. Default 0.5, i.e. the
   * returned delay lands somewhere in the top half of the computed window.
   *
   * Jitter is not cosmetic: without it every tab open against the same outage
   * retries on the same 1s/2s/4s schedule and the recovering service is hit by
   * the whole fleet at once.
   */
  jitter?: number;
  /** Injectable for deterministic tests. Default `Math.random`. */
  random?: () => number;
}

/** Exponential backoff with jitter for `attempt` (1-based). */
export function computeBackoffMs(
  attempt: number,
  { baseMs = 1000, maxMs = 30_000, jitter = 0.5, random = Math.random }: BackoffOptions = {},
): number {
  const n = Math.max(1, Math.floor(attempt));
  const exponential = Math.min(maxMs, baseMs * 2 ** (n - 1));
  const spread = Math.min(1, Math.max(0, jitter));
  return Math.round(exponential * (1 - spread + spread * random()));
}
