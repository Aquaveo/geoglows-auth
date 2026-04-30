import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The set of allowed values for `Profile.user_type`. Mirrors the
 * `public.user_type` enum on the Supabase project.
 */
export type UserType =
  | "researcher"
  | "student"
  | "agency_staff"
  | "industry_professional"
  | "public"
  | "other";

export interface Profile {
  id: string;
  email: string;
  display_name: string | null;
  first_name?: string | null;
  middle_name?: string | null;
  last_name?: string | null;
  phone_number?: string | null;
  user_type?: UserType | null;
  address?: string | null;
  user_link?: string | null;
  avatar_url?: string | null;
  created_at?: string;
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
  setupTokenRenewal(): void;
}

export interface OidcConfig {
  authority: string;
  clientId: string;
  redirectUri: string;
  logoutUri: string;
  cognitoDomain: string;
  scope?: string;
}

export type SupabaseAuthFlow = "password" | "magicLink" | "oauth";

/**
 * The subset of `SupabaseAuthFlow` that the built-in `<SupabaseAuthUI>` form
 * renders inline. Excludes `"oauth"` because OAuth requires provider buttons
 * and a redirect, which the built-in form does not handle — consumers wanting
 * OAuth call `adapter.signInWithOAuth(...)` directly.
 */
export type SupabaseAuthMode = Exclude<SupabaseAuthFlow, "oauth">;

export interface SupabaseAuthConfig {
  supabase: SupabaseClient;
  defaultRedirectTo?: string;
  logoutRedirectTo?: string;
  flow?: SupabaseAuthFlow;
}

export interface SignUpWithPasswordArgs {
  email: string;
  password: string;
  /**
   * Where the email-confirmation link redirects the user after they click it.
   * Must be on the project's Supabase Auth → Redirect URLs allowlist.
   */
  emailRedirectTo?: string;
  /**
   * Sign-up-time identity that Supabase stores under `auth.users.user_metadata`.
   * Per the lib's own learning at
   * `docs/solutions/best-practices/user-metadata-is-auth-identity-not-profile-of-record-2026-04-29.md`,
   * `user_metadata` is sign-up-time identity ONLY — `ensureProfile` reads it
   * once to seed the row on first sign-in, then never again. Consumers must
   * `escapeHtml(...)` these values on render.
   */
  metadata?: Record<string, unknown>;
}

export interface SupabaseAuthAdapter extends AuthAdapter {
  signInWithPassword(args: { email: string; password: string }): Promise<AuthUser>;
  signInWithMagicLink(args: { email: string; redirectTo?: string }): Promise<void>;
  signInWithOAuth(args: { provider: string; redirectTo?: string }): Promise<void>;
  signUpWithPassword(args: SignUpWithPasswordArgs): Promise<void>;
}

export interface SupabaseFactoryOptions {
  url: string;
  publishableKey: string;
  /**
   * External identity provider (e.g. the OIDC/Cognito adapter). When set, the
   * Supabase client injects tokens minted by this adapter on every request.
   * Omit or pass `null` when Supabase Auth is acting as the identity provider —
   * in that mode the client manages its own session natively, so no external
   * token callback is needed.
   */
  auth?: AuthAdapter | null;
  useIdToken?: boolean;
}

export interface AuthContextValue {
  user: AuthUser | null;
  profile: Profile | null;
  loading: boolean;
  refresh(): Promise<void>;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
}

export type GeoglowsSupabaseClient = SupabaseClient;
