import type { AuthUser, GeoglowsSupabaseClient, Profile } from "../types";

export async function ensureProfile(
  supabase: GeoglowsSupabaseClient,
  user: AuthUser
): Promise<Profile> {
  const payload = {
    id: user.sub,
    email: user.email ?? "",
    display_name: user.name ?? user.email ?? null,
  };

  const { data, error } = await supabase
    .from("profiles")
    .upsert(payload, { onConflict: "id" })
    .select()
    .single();

  if (error) throw error;
  return data as Profile;
}

export async function loadOrganizations(
  supabase: GeoglowsSupabaseClient,
  userId: string
) {
  const { data, error } = await supabase
    .from("org_memberships")
    .select(
      `
      id,
      org_id,
      user_id,
      role,
      invited_at,
      accepted_at,
      organizations (
        id,
        name,
        slug,
        created_by,
        created_at
      )
    `
    )
    .eq("user_id", userId);

  if (error) throw error;

  const memberships = (data ?? []).map((row: any) => ({
    id: row.id,
    org_id: row.org_id,
    user_id: row.user_id,
    role: row.role,
    invited_at: row.invited_at,
    accepted_at: row.accepted_at,
    organization: row.organizations,
  }));

  const organizations = memberships
    .map((m: any) => m.organization)
    .filter(Boolean);

  return { memberships, organizations };
}