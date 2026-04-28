import { createClient } from "@supabase/supabase-js";
import type { GeoglowsSupabaseClient, SupabaseFactoryOptions } from "../types";

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
}: SupabaseFactoryOptions): GeoglowsSupabaseClient {
  if (!url?.trim()) {
    throw new Error("Supabase URL is required");
  }

  if (!publishableKey?.trim()) {
    throw new Error("Supabase publishable key is required");
  }

  if (!auth) {
    return createClient(url, publishableKey);
  }

  return createClient(url, publishableKey, {
    accessToken: async () => {
      const user = await auth.getCurrentUser();
      if (!user) return null;

      return useIdToken ? user.id_token ?? null : user.access_token ?? null;
    },
  });
}
