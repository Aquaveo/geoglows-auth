import type {
  GeoglowsSupabaseClient,
  Organization,
  OrgMembership,
  Profile,
} from "../types";

const ACTIVE_ORG_STORAGE_KEY = "geoglows.activeOrgId";

export interface AccountSummary {
  profile: Profile | null;
  memberships: OrgMembership[];
  organizations: Organization[];
  activeOrgId: string | null;
  activeOrg: Organization | null;
  activeRole: "admin" | "viewer" | null;
}

export async function loadAccountSummary(
  supabase: GeoglowsSupabaseClient,
  userId: string
): Promise<AccountSummary> {
  const [{ data: profile, error: profileError }, { data, error: membershipsError }] =
    await Promise.all([
      supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
      supabase
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
        .eq("user_id", userId),
    ]);

  if (profileError) throw profileError;
  if (membershipsError) throw membershipsError;

  const memberships = (data ?? []).map((row: any) => ({
    id: row.id,
    org_id: row.org_id,
    user_id: row.user_id,
    role: row.role,
    invited_at: row.invited_at,
    accepted_at: row.accepted_at,
    organization: Array.isArray(row.organizations)
      ? row.organizations[0] ?? null
      : row.organizations ?? null,
  })) as OrgMembership[];

  const organizations = memberships
    .map((m) => m.organization)
    .filter(Boolean) as Organization[];

  let activeOrgId = getActiveOrgId();
  if (!activeOrgId && organizations.length > 0) {
    activeOrgId = organizations[0].id;
    setActiveOrgId(activeOrgId);
  }

  const activeOrg =
    organizations.find((org) => org.id === activeOrgId) ?? null;

  const activeRole =
    memberships.find((m) => m.org_id === activeOrgId)?.role ?? null;

  return {
    profile: (profile as Profile | null) ?? null,
    memberships,
    organizations,
    activeOrgId,
    activeOrg,
    activeRole,
  };
}

export async function createOrganization(
  supabase: GeoglowsSupabaseClient,
  name: string
): Promise<Organization> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("Organization name is required");
  }

  const { data, error } = await supabase.rpc(
    "create_organization_with_admin",
    { org_name: trimmed }
  );

  if (error) throw error;

  const org = Array.isArray(data) ? data[0] : data;
  if (!org?.id) {
    throw new Error("Organization creation did not return an organization");
  }

  setActiveOrgId(org.id);
  return org as Organization;
}

export function getActiveOrgId(): string | null {
  return localStorage.getItem(ACTIVE_ORG_STORAGE_KEY);
}

export function setActiveOrgId(orgId: string | null) {
  if (orgId) localStorage.setItem(ACTIVE_ORG_STORAGE_KEY, orgId);
  else localStorage.removeItem(ACTIVE_ORG_STORAGE_KEY);
}