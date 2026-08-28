// src/bootstrap/index.ts
//
// One-call auth bootstrap for vanilla (non-React) GEOGloWS portal apps.
// Encapsulates the Supabase client, the <dialog> sign-in modal, the navbar
// auth-action slot, recovery-URL handling, and the onAuthStateChange lifecycle
// that was previously copy-pasted into each app's own `auth-bootstrap.js`.
//
// Call it ONCE as the first import in the app entry (main.js) so the
// onAuthStateChange listener is registered before any top-level awaits and the
// recovery-URL snapshot is read before Supabase JS consumes the URL hash.
// Because the Supabase client is created inside this call (not at module-eval
// time), the recovery snapshot is captured deterministically before
// detectSessionInUrl runs — this removes the bundler-ordering race that the
// consumer apps previously worked around with an inline <script>.

import {
  bootstrapSession,
  createGeoglowsSupabaseClient,
  createSupabaseAuthAdapter,
  mountSignInModal,
  renderAuthAction,
  wireAvatarMenuDismiss,
} from "../core";
import type { AuthActionState } from "../core";

/** Config for {@link bootstrapAuth}. */
export interface BootstrapAuthConfig {
  /**
   * Supabase project URL. Pass `import.meta.env.VITE_SUPABASE_URL` from the
   * consuming app — the library cannot read the app's build-time env itself.
   */
  supabaseUrl: string;
  /** Supabase publishable/anon key, e.g. `import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY`. */
  supabasePublishableKey: string;
  /** Navbar mount point (CSS selector or element). Default `"#auth-action"`. */
  slot?: string | HTMLElement;
  /**
   * Absolute origin of the portal, e.g. `"https://apps.geoglows.org"`. Prefixed
   * to {@link BootstrapAuthConfig.profilePath} so the Profile link resolves to
   * the portal from any host/environment. Set it per-environment (production vs
   * staging) via an env var. Empty string (default) yields a same-origin
   * relative link — correct for the portal app itself.
   */
  portalUrl?: string;
  /** Portal profile route appended to {@link BootstrapAuthConfig.portalUrl}. Default `"/#profile"`. */
  profilePath?: string;
  /** Post-auth redirect. Default: `() => location.origin + location.pathname`. */
  defaultRedirectTo?: () => string;
  /** Post-sign-out redirect. Default: `() => location.origin`. */
  logoutRedirectTo?: () => string;
  /** Invoked after every render with the current auth state. */
  onAuthChange?: (state: AuthActionState) => void;
  /** Mount the sign-in modal. Default `true`. */
  mountModal?: boolean;
  /** Window event name that opens the sign-in modal. Default `"geoglows:sign-in-requested"`. */
  signInRequestedEvent?: string;
  /**
   * Where OAuth providers redirect back to after sign-in. Default:
   * `() => location.origin + location.pathname` — i.e. the exact page the user
   * launched sign-in from (minus hash/query), so a Google sign-in from a
   * sub-app path returns there instead of the origin root. Must be on the
   * Supabase Auth redirect allowlist.
   */
  oauthRedirectTo?: () => string;
}

/** Imperative handle returned by {@link bootstrapAuth}. */
export interface AuthHandle {
  supabase: ReturnType<typeof createGeoglowsSupabaseClient>;
  authAdapter: ReturnType<typeof createSupabaseAuthAdapter>;
  /** Current auth state (as passed to `renderAuthAction`). */
  getState(): AuthActionState;
  /** Programmatically open the sign-in modal. */
  openSignIn(): void;
  /** Sign out and redirect. */
  signOut(): Promise<void>;
  /** Remove listeners/handlers (HMR, teardown). */
  destroy(): void;
}

interface WindowWithInitialUrl {
  __GEOGLOWS_INITIAL_URL__?: { hash?: string; search?: string };
}

/**
 * Wire up GEOGloWS Supabase auth for a vanilla app in a single call.
 *
 * ```js
 * import { bootstrapAuth } from "@geoglows/geoglows-auth/bootstrap";
 * import "@geoglows/geoglows-auth/core/sign-in.css";
 *
 * bootstrapAuth({
 *   supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
 *   supabasePublishableKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
 *   portalUrl: import.meta.env.VITE_PORTAL_URL, // "" for the portal itself
 * });
 * ```
 */
export function bootstrapAuth(config: BootstrapAuthConfig): AuthHandle {
  const {
    supabaseUrl,
    supabasePublishableKey,
    slot = "#auth-action",
    portalUrl = "",
    profilePath = "/#profile",
    defaultRedirectTo = () => window.location.origin + window.location.pathname,
    logoutRedirectTo = () => window.location.origin,
    onAuthChange,
    mountModal = true,
    signInRequestedEvent = "geoglows:sign-in-requested",
    oauthRedirectTo = () => window.location.origin + window.location.pathname,
  } = config;

  const profileHref = `${portalUrl}${profilePath}`;

  const supabase = createGeoglowsSupabaseClient({
    url: supabaseUrl,
    publishableKey: supabasePublishableKey,
  });

  const authAdapter = createSupabaseAuthAdapter({
    supabase,
    defaultRedirectTo: defaultRedirectTo(),
    logoutRedirectTo: logoutRedirectTo(),
  });

  let authState: AuthActionState = {
    user: null,
    account: null,
    status: "bootstrapping",
    action: null,
  };

  const resolveSlot = (): HTMLElement | null =>
    typeof slot === "string" ? document.querySelector<HTMLElement>(slot) : slot;

  const signInModal = mountModal
    ? mountSignInModal({ authAdapter, oauthRedirectTo: oauthRedirectTo() })
    : null;

  async function signOut(): Promise<void> {
    authState = { ...authState, action: "signing_out" };
    renderSlot();
    try {
      await authAdapter.signOutRedirect();
      // signOutRedirect navigates to logoutRedirectTo; the page reloads and
      // module state resets.
    } catch (error) {
      console.error("Sign out failed:", error);
      authState = { ...authState, action: null };
      renderSlot();
    }
  }

  function renderSlot(): void {
    const el = resolveSlot();
    if (!el) return;
    el.innerHTML = renderAuthAction(authState, { profileHref });

    el.querySelector<HTMLElement>("#geoglowsSignIn")?.addEventListener(
      "click",
      () => window.dispatchEvent(new CustomEvent(signInRequestedEvent)),
    );
    el.querySelector<HTMLElement>("#geoglowsSignOut")?.addEventListener(
      "click",
      () => {
        void signOut();
      },
    );

    onAuthChange?.(authState);
  }

  const onSignInRequested = () => signInModal?.open();
  window.addEventListener(signInRequestedEvent, onSignInRequested);

  // The avatar menu closes on an outside click or Escape, like any dropdown.
  const slotEl = resolveSlot();
  const unwireAvatarMenu = slotEl ? wireAvatarMenuDismiss(slotEl) : () => {};

  // Recovery-URL snapshot — read synchronously before any getSession(). Gates
  // the PASSWORD_RECOVERY handler so only the tab that actually received the
  // recovery link opens the setNewPassword modal (Supabase fires
  // PASSWORD_RECOVERY on every tab that revalidates a recovery-type session).
  const win = window as unknown as WindowWithInitialUrl;
  const initial = win.__GEOGLOWS_INITIAL_URL__;
  const hash =
    typeof initial?.hash === "string" ? initial.hash : window.location.hash;
  const search =
    typeof initial?.search === "string"
      ? initial.search
      : window.location.search;
  const hasOtpExpired =
    /(?:^|[#&?])error_code=otp_expired/.test(hash) ||
    /(?:^|[?&])error_code=otp_expired/.test(search);
  const hasCode =
    /(?:^|[#&?])code=/.test(hash) || /(?:^|[?&])code=/.test(search);
  const hasRecovery =
    /(?:^|[#&?])type=recovery/.test(hash) ||
    /(?:^|[?&])type=recovery/.test(search);
  const hasImplicitRecoveryHash =
    /(?:^|[#&?])access_token=/.test(hash) && hasRecovery;

  let tabHasRecoveryUrl = false;
  if (hasOtpExpired) {
    signInModal?.open({ view: "recoveryError" });
    tabHasRecoveryUrl = true;
  } else if (hasCode && hasRecovery) {
    console.error(
      "PKCE recovery flow is not supported in @geoglows/geoglows-auth 1.2.x.",
    );
    signInModal?.open({ view: "recoveryError" });
    tabHasRecoveryUrl = true;
  } else {
    tabHasRecoveryUrl = hasImplicitRecoveryHash;
  }

  let initialBootstrapDone = false;

  function bootstrapSafe(reason: string): void {
    bootstrapSession({
      auth: authAdapter,
      supabase,
      // Carry the previous user/account through the transient
      // bootstrapping/loading phases on rebootstrap (tab-focus revalidation),
      // avoiding the avatar → "Signing in…" flicker. null on first bootstrap
      // is the desired fresh-start default.
      initialState: authState.user
        ? {
            status: authState.status,
            user: authState.user,
            account: authState.account ?? null,
            error: null,
          }
        : undefined,
      onStateChange: (state) => {
        // Preserve any locally-tracked action (e.g. "signing_out").
        authState = {
          user: state.user,
          account: state.account,
          status: state.status,
          action: authState.action,
        };
        renderSlot();
      },
    }).catch((error) => {
      console.error(
        `Bootstrap after ${reason} failed:`,
        error instanceof Error ? error.message : error,
      );
    });
  }

  const { data: authSub } = supabase.auth.onAuthStateChange(
    (event, session) => {
      if (event === "INITIAL_SESSION" && !initialBootstrapDone) {
        initialBootstrapDone = true;
        bootstrapSafe("INITIAL_SESSION");

        // Strip OAuth callback artifacts so a reload doesn't replay the flow.
        const hashHasAuth = /(?:^|[#&])access_token=/.test(
          window.location.hash,
        );
        const query = new URLSearchParams(window.location.search);
        const queryHasAuth = query.has("code") && query.has("state");
        if (hashHasAuth || queryHasAuth) {
          if (queryHasAuth) {
            query.delete("code");
            query.delete("state");
          }
          const cleanedSearch = query.toString();
          const newUrl =
            window.location.pathname +
            (cleanedSearch ? `?${cleanedSearch}` : "");
          history.replaceState({}, document.title, newUrl);
        }
        return;
      }
      if (event === "SIGNED_OUT") {
        bootstrapSafe("SIGNED_OUT");
        return;
      }
      if (event === "SIGNED_IN") {
        // Supabase fires SIGNED_IN on every visibility-change revalidation.
        // Skip the rebootstrap when it's the same user we already have.
        const newId = session?.user?.id;
        const currentSub = authState.user?.sub;
        if (newId && currentSub && newId === currentSub) return;
        bootstrapSafe("SIGNED_IN");
      }
      if (event === "PASSWORD_RECOVERY") {
        if (!tabHasRecoveryUrl) return;
        signInModal?.open({ view: "setNewPassword" });
      }
    },
  );

  // Safety net: if INITIAL_SESSION never fires within 2s, bootstrap anyway so
  // the slot never sticks on the "Signing in…" placeholder.
  const fallbackTimer = setTimeout(() => {
    if (!initialBootstrapDone) {
      initialBootstrapDone = true;
      bootstrapSafe("timeout-fallback");
    }
  }, 2000);

  // Initial render so the slot shows the loading pill immediately.
  renderSlot();

  return {
    supabase,
    authAdapter,
    getState: () => authState,
    openSignIn: () => signInModal?.open(),
    signOut,
    destroy: () => {
      window.removeEventListener(signInRequestedEvent, onSignInRequested);
      unwireAvatarMenu();
      authSub?.subscription?.unsubscribe();
      clearTimeout(fallbackTimer);
    },
  };
}
