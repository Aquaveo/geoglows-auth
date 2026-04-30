import type { Session, User } from "@supabase/supabase-js";
import type {
  AuthUser,
  SupabaseAuthAdapter,
  SupabaseAuthConfig,
} from "../types";

function mapUser(session: Session | null | undefined): AuthUser | null {
  if (!session?.user) return null;

  const user = session.user;
  const metadata = (user.user_metadata ?? {}) as Record<string, unknown>;
  const fullName =
    typeof metadata.full_name === "string" ? metadata.full_name : undefined;
  const fallbackName =
    typeof metadata.name === "string" ? metadata.name : undefined;

  const expiresAtMs = session.expires_at ? session.expires_at * 1000 : null;
  const expired = expiresAtMs !== null ? expiresAtMs <= Date.now() : false;

  return {
    sub: user.id,
    email: user.email ?? undefined,
    name: fullName ?? fallbackName ?? user.email ?? undefined,
    access_token: session.access_token,
    id_token: undefined,
    expired,
    profile: { ...metadata, id: user.id, email: user.email ?? null },
  };
}

function mapUserOnly(user: User | null | undefined): AuthUser | null {
  if (!user) return null;
  const metadata = (user.user_metadata ?? {}) as Record<string, unknown>;
  const fullName =
    typeof metadata.full_name === "string" ? metadata.full_name : undefined;
  const fallbackName =
    typeof metadata.name === "string" ? metadata.name : undefined;

  return {
    sub: user.id,
    email: user.email ?? undefined,
    name: fullName ?? fallbackName ?? user.email ?? undefined,
    access_token: undefined,
    id_token: undefined,
    expired: false,
    profile: { ...metadata, id: user.id, email: user.email ?? null },
  };
}

function stripAuthParamsFromUrl() {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  const authParams = ["code", "state", "error", "error_description", "error_code"];
  let changed = false;
  for (const param of authParams) {
    if (url.searchParams.has(param)) {
      url.searchParams.delete(param);
      changed = true;
    }
  }
  if (!changed) return;
  const cleanUrl = `${url.origin}${url.pathname}${url.search}${url.hash}`;
  window.history.replaceState({}, document.title, cleanUrl);
}

export function createSupabaseAuthAdapter(
  config: SupabaseAuthConfig,
): SupabaseAuthAdapter {
  if (!config.supabase) {
    throw new Error("Supabase client is required");
  }

  const supabase = config.supabase;
  let renewalListenerBound = false;

  return {
    async clearStaleAuthState() {
      // Supabase JS manages its own session storage and lifecycle. Nothing to do.
    },

    async completeSignInIfNeeded() {
      if (typeof window === "undefined") return null;

      const params = new URLSearchParams(window.location.search);

      if (params.has("error")) {
        const description =
          params.get("error_description") ??
          params.get("error") ??
          "Authentication failed";
        stripAuthParamsFromUrl();
        throw new Error(description);
      }

      if (!params.has("code")) {
        return null;
      }

      // Supabase v2 with `detectSessionInUrl: true` (default) auto-exchanges
      // the code on client init. If a session exists, prefer it. Otherwise
      // exchange the code explicitly.
      const existing = await supabase.auth.getSession();
      if (existing.error) {
        stripAuthParamsFromUrl();
        throw existing.error;
      }
      if (existing.data.session) {
        stripAuthParamsFromUrl();
        return mapUser(existing.data.session);
      }

      const code = params.get("code") ?? "";
      const exchanged = await supabase.auth.exchangeCodeForSession(code);
      stripAuthParamsFromUrl();
      if (exchanged.error) throw exchanged.error;
      return mapUser(exchanged.data.session);
    },

    async getCurrentUser() {
      const { data, error } = await supabase.auth.getSession();
      if (error) {
        console.warn("Supabase getSession failed:", error);
        return null;
      }
      return mapUser(data.session);
    },

    async signInRedirect() {
      // Password and magic-link flows do not redirect — the consumer-rendered
      // form handles those. For the OAuth flow, the consumer should call
      // signInWithOAuth directly with their chosen provider.
    },

    async signOutRedirect() {
      const { error } = await supabase.auth.signOut();
      if (error) {
        console.warn("Supabase signOut failed:", error);
      }

      const redirectTo = config.logoutRedirectTo;
      if (redirectTo && typeof window !== "undefined") {
        window.location.assign(redirectTo);
      }
    },

    setupTokenRenewal() {
      // Supabase JS auto-refreshes tokens internally when `autoRefreshToken`
      // is enabled (the default). We only register a listener so other
      // pieces of the system can observe SIGNED_IN / SIGNED_OUT transitions.
      if (renewalListenerBound) return;
      renewalListenerBound = true;
      supabase.auth.onAuthStateChange((event) => {
        if (event === "SIGNED_OUT") {
          // No-op for now; AuthProvider will refresh on its own cadence.
        }
      });
    },

    async signInWithPassword({ email, password }) {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;

      const mapped = mapUser(data.session) ?? mapUserOnly(data.user);
      if (!mapped) {
        throw new Error("Sign-in succeeded but no user was returned");
      }
      return mapped;
    },

    async signInWithMagicLink({ email, redirectTo }) {
      const target = redirectTo ?? config.defaultRedirectTo;
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: target ? { emailRedirectTo: target } : undefined,
      });
      if (error) throw error;
    },

    async signInWithOAuth({ provider, redirectTo }) {
      const target = redirectTo ?? config.defaultRedirectTo;
      const { error } = await supabase.auth.signInWithOAuth({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        provider: provider as any,
        options: target ? { redirectTo: target } : undefined,
      });
      if (error) throw error;
    },

    async signUpWithPassword({ email, password, emailRedirectTo, metadata }) {
      const target = emailRedirectTo ?? config.defaultRedirectTo;
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          ...(target ? { emailRedirectTo: target } : {}),
          ...(metadata ? { data: metadata } : {}),
        },
      });
      if (error) throw error;
    },
  };
}
