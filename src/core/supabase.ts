import { createClient } from "@supabase/supabase-js";
import type { GeoglowsSupabaseClient, SupabaseFactoryOptions } from "../types";

export function createGeoglowsSupabaseClient({
  url,
  publishableKey,
  auth,
  useIdToken = true,
}: SupabaseFactoryOptions): GeoglowsSupabaseClient {
  return createClient(url, publishableKey, {
    accessToken: async () => {
      const user = await auth.getCurrentUser();
      if (!user) return null;

      return useIdToken ? user.id_token ?? null : user.access_token ?? null;
    },
  });
}