import type { SupabaseClient } from "@supabase/supabase-js";

export type OrgRole = "admin" | "viewer";

export interface Profile {
  id: string;
  email: string;
  display_name: string | null;
  created_at?: string;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  created_by?: string | null;
  created_at?: string;
}

export interface OrgMembership {
  id: string;
  org_id: string;
  user_id: string;
  role: OrgRole;
  invited_at?: string | null;
  accepted_at?: string | null;
  organization?: Organization;
}

export interface AuthUser {
  sub: string;
  email?: string;
  name?: string;
  access_token?: string;
  id_token?: string;
  expired: boolean;
  profile: Record<string, unknown>;
}

export interface AuthAdapter {
  clearStaleAuthState(): Promise<void>;
  completeSignInIfNeeded(): Promise<AuthUser | null>;
  getCurrentUser(): Promise<AuthUser | null>;
  signInRedirect(): Promise<void>;
  signOutRedirect(): Promise<void>;
  setupTokenRenewal?(): void;
}

export interface OidcConfig {
  authority: string;
  clientId: string;
  redirectUri: string;
  logoutUri: string;
  cognitoDomain: string;
  scope?: string;
}

export interface SupabaseFactoryOptions {
  url: string;
  publishableKey: string;
  auth: AuthAdapter;
  useIdToken?: boolean;
}

export interface AuthContextValue {
  user: AuthUser | null;
  profile: Profile | null;
  memberships: OrgMembership[];
  organizations: Organization[];
  activeOrgId: string | null;
  activeOrg: Organization | null;
  activeRole: OrgRole | null;
  loading: boolean;
  refresh(): Promise<void>;
  setActiveOrgId(orgId: string | null): void;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
}

export type GeoglowsSupabaseClient = SupabaseClient;