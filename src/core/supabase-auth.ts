import {
  isAuthApiError,
  isAuthSessionMissingError,
  type Session,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";
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

/**
 * The service answered and rejected the token. That is "signed out", not
 * "unreachable": a 401/403 is the server's verdict on a stale or revoked
 * session, and a 404 is a user that no longer exists.
 */
function isSessionRejected(error: unknown): boolean {
  if (isAuthSessionMissingError(error)) return true;
  return (
    isAuthApiError(error) &&
    (error.status === 401 || error.status === 403 || error.status === 404)
  );
}

/**
 * One round trip to prove the account service is up. Any HTTP answer below
 * 500 — including a 401 from a gateway that wants a different key — means it
 * is reachable; a transport failure rejects with fetch's TypeError, and a 5xx
 * rejects with a status the retry policy classifies as transient.
 */
async function probeService(url: string, publishableKey: string): Promise<void> {
  const response = await fetch(`${url.replace(/\/+$/, "")}/auth/v1/health`, {
    headers: { apikey: publishableKey },
    cache: "no-store",
  });
  if (response.status >= 500) {
    throw Object.assign(
      new Error(`Account service responded ${response.status}`),
      { status: response.status },
    );
  }
}

/**
 * Drop the stored session without asking the server.
 *
 * `supabase.auth.signOut()` — with any scope — only removes the stored session
 * once the server has acknowledged the sign-out, so an unreachable service
 * leaves the visitor signed in with no way out short of clearing site data.
 * The storage key is what the client actually uses, read off the auth client
 * rather than recomputed from the URL, so a custom `storageKey` is honoured.
 */
async function forgetLocalSession(supabase: SupabaseClient): Promise<void> {
  const auth = supabase.auth as unknown as {
    storageKey?: unknown;
    storage?: { removeItem?: (key: string) => unknown };
  };
  if (typeof auth.storageKey !== "string" || !auth.storageKey) return;
  const keys = [auth.storageKey, `${auth.storageKey}-code-verifier`];
  for (const key of keys) {
    try {
      await auth.storage?.removeItem?.(key);
    } catch {
      // fall through to the default storage
    }
    try {
      globalThis.localStorage?.removeItem(key);
    } catch {
      // storage access can throw (privacy mode); nothing more to do
    }
  }
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

    async verifySession() {
      // getSession() reads storage. It only reaches the network to refresh an
      // expired token — and a refresh that could not reach the service is a
      // connect failure, not a signed-out visitor.
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;

      const session = data.session;
      if (!session) {
        if (config.supabaseUrl && config.supabasePublishableKey) {
          await probeService(config.supabaseUrl, config.supabasePublishableKey);
        }
        return null;
      }

      // Only the server can say whether a stored token is still good.
      const verified = await supabase.auth.getUser(session.access_token);
      if (verified.error) {
        if (isSessionRejected(verified.error)) {
          // The server said no: forget the token so the next load does not
          // ask again, and report signed out.
          await forgetLocalSession(supabase);
          return null;
        }
        throw verified.error;
      }
      return mapUser(session);
    },

    async signInRedirect() {
      // Password and magic-link flows do not redirect — the consumer-rendered
      // form handles those. For the OAuth flow, the consumer should call
      // signInWithOAuth directly with their chosen provider.
    },

    async signOutRedirect() {
      const { error } = await supabase.auth.signOut();
      if (error) {
        // The server did not acknowledge, so supabase-js kept the stored
        // session. The visitor asked to leave; honour that locally.
        console.warn(
          "Supabase signOut failed; clearing the local session:",
          error,
        );
        await forgetLocalSession(supabase);
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

    async resetPasswordForEmail({ email, redirectTo }) {
      const target = redirectTo ?? config.defaultRedirectTo;
      const { error } = await supabase.auth.resetPasswordForEmail(
        email,
        target ? { redirectTo: target } : {},
      );
      if (error) throw error;
    },

    async updateUserPassword({ password }) {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
    },

    async signOutOtherSessions() {
      // scope: "others" is load-bearing — calling supabase.auth.signOut() with
      // no args would sign out the CURRENT session too, destroying the
      // recovery session immediately after the password update completes.
      const { error } = await supabase.auth.signOut({ scope: "others" });
      if (error) throw error;
    },
  };
}
