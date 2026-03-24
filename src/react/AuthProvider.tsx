import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import type {
  AuthAdapter,
  AuthContextValue,
  AuthUser,
  Organization,
  OrgMembership,
  Profile,
} from "../types";
import { useSupabase } from "./SupabaseProvider";
import { ensureProfile, loadOrganizations } from "../core/profile";

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({
  auth,
  children,
  storageKey = "geoglows.activeOrgId",
}: {
  auth: AuthAdapter;
  children: React.ReactNode;
  storageKey?: string;
}) {
  const supabase = useSupabase();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [memberships, setMemberships] = useState<OrgMembership[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [activeOrgId, setActiveOrgIdState] = useState<string | null>(
    localStorage.getItem(storageKey)
  );
  const [loading, setLoading] = useState(true);

  function setActiveOrgId(orgId: string | null) {
    setActiveOrgIdState(orgId);
    if (orgId) localStorage.setItem(storageKey, orgId);
    else localStorage.removeItem(storageKey);
  }

  async function refresh() {
    setLoading(true);
    try {
      await auth.clearStaleAuthState();
      auth.setupTokenRenewal?.();
      await auth.completeSignInIfNeeded();

      const nextUser = await auth.getCurrentUser();
      setUser(nextUser);

      if (!nextUser) {
        setProfile(null);
        setMemberships([]);
        setOrganizations([]);
        setActiveOrgId(null);
        return;
      }

      const nextProfile = await ensureProfile(supabase, nextUser);
      setProfile(nextProfile);

      const { memberships, organizations } = await loadOrganizations(supabase, nextUser.sub);
      setMemberships(memberships);
      setOrganizations(organizations);

      if (!activeOrgId && organizations.length > 0) {
        setActiveOrgId(organizations[0].id);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh().catch((error) => {
      console.error("AuthProvider refresh failed:", error);
      setLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeOrg = useMemo(
    () => organizations.find((org) => org.id === activeOrgId) ?? null,
    [organizations, activeOrgId]
  );

  const activeRole = useMemo(
    () => memberships.find((m) => m.org_id === activeOrgId)?.role ?? null,
    [memberships, activeOrgId]
  );

  const value: AuthContextValue = {
    user,
    profile,
    memberships,
    organizations,
    activeOrgId,
    activeOrg,
    activeRole,
    loading,
    refresh,
    setActiveOrgId,
    signIn: () => auth.signInRedirect(),
    signOut: () => auth.signOutRedirect(),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}

export function useOrg() {
  const value = useAuth();
  return {
    organizations: value.organizations,
    memberships: value.memberships,
    activeOrgId: value.activeOrgId,
    activeOrg: value.activeOrg,
    activeRole: value.activeRole,
    setActiveOrgId: value.setActiveOrgId,
  };
}