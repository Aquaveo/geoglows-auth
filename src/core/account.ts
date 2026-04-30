import type { GeoglowsSupabaseClient, Profile } from "../types";

/**
 * Account summary shape returned by `loadAccountSummary`. Currently only
 * carries the user's profile row; org-related fields were removed as part
 * of the rich-profiles refactor (the `organizations` and `org_memberships`
 * tables and helpers were dropped).
 */
export interface AccountSummary {
  profile: Profile | null;
}

/**
 * Loads the authenticated user's profile row.
 *
 * Respects the `profiles_select_own` RLS policy — users can only read
 * their own row, never another user's.
 */
export async function loadAccountSummary(
  supabase: GeoglowsSupabaseClient,
  userId: string,
): Promise<AccountSummary> {
  const { data: profile, error: profileError } = await supabase
    .schema("core")
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  if (profileError) throw profileError;

  return {
    profile: (profile as Profile | null) ?? null,
  };
}
