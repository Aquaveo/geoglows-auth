import { createClient } from "@supabase/supabase-js";
import type { GeoglowsSupabaseClient, SupabaseFactoryOptions } from "../types";
import { RequestTimeoutError } from "./retry";

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

/**
 * Wraps `fetch` so no Supabase request can hang forever.
 *
 * This is the only place a timeout belongs. Racing a promise at a call site
 * abandons the wait but leaves the request — and Supabase's own internal
 * retries behind it — running; aborting the transport actually stops the work,
 * and it does so for every call the client makes (auth, profile reads, profile
 * writes) rather than the one path that remembered to add a race.
 *
 * A caller-supplied `init.signal` is chained, not replaced, so an abort from
 * either side cancels the request.
 */
function fetchWithTimeout(timeoutMs: number, baseFetch: FetchLike): FetchLike {
  return async (input, init) => {
    const controller = new AbortController();
    const upstream = init?.signal ?? null;
    const abortFromUpstream = () => controller.abort(upstream?.reason);

    if (upstream) {
      if (upstream.aborted) controller.abort(upstream.reason);
      else upstream.addEventListener("abort", abortFromUpstream, { once: true });
    }

    const timer = setTimeout(
      () => controller.abort(new RequestTimeoutError(timeoutMs)),
      timeoutMs,
    );

    try {
      return await baseFetch(input, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
      upstream?.removeEventListener("abort", abortFromUpstream);
    }
  };
}

/**
 * Creates a Supabase client wired into the GEOGloWS auth model.
 *
 * Two modes are supported:
 *
 * 1. **External identity (e.g. Cognito).** Pass an `auth` adapter. The client
 *    calls `auth.getCurrentUser()` on every request and forwards the user's
 *    OIDC token to Supabase's `accessToken` hook so RLS policies can verify
 *    the caller via the configured external JWT issuer.
 *
 * 2. **Supabase Auth as identity.** Omit `auth` (or pass `null`). The client
 *    manages its own session through `supabase.auth.*` and Supabase's built-in
 *    token refresh — no external token injection. Pair this mode with
 *    `createSupabaseAuthAdapter` from `./supabase-auth`.
 */
export function createGeoglowsSupabaseClient({
  url,
  publishableKey,
  auth,
  useIdToken = true,
  autoRefreshToken = true,
  fetchTimeoutMs,
}: SupabaseFactoryOptions): GeoglowsSupabaseClient {
  if (!url?.trim()) {
    throw new Error("Supabase URL is required");
  }

  if (!publishableKey?.trim()) {
    throw new Error("Supabase publishable key is required");
  }

  // Assembled rather than passed wholesale, so a caller that opts into none of
  // these constructs exactly the client it did before — `createClient(url, key,
  // {})` is not the same call as `createClient(url, key)` to anything
  // inspecting arity.
  const options: Record<string, unknown> = {};

  if (!autoRefreshToken) {
    options.auth = { autoRefreshToken };
  }

  if (typeof fetchTimeoutMs === "number" && fetchTimeoutMs > 0) {
    const baseFetch = globalThis.fetch?.bind(globalThis) as FetchLike | undefined;
    if (baseFetch) {
      options.global = { fetch: fetchWithTimeout(fetchTimeoutMs, baseFetch) };
    }
  }

  if (auth) {
    options.accessToken = async () => {
      const user = await auth.getCurrentUser();
      if (!user) return null;

      return useIdToken ? user.id_token ?? null : user.access_token ?? null;
    };
  }

  if (Object.keys(options).length === 0) {
    return createClient(url, publishableKey);
  }

  return createClient(url, publishableKey, options);
}
