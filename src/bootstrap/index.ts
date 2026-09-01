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
  computeBackoffMs,
  createGeoglowsSupabaseClient,
  createSupabaseAuthAdapter,
  isTransientError,
  mountSignInModal,
  renderAuthAction,
  RequestTimeoutError,
  wireAvatarMenuDismiss,
} from "../core";
import type { AuthActionState, SessionState } from "../core";

/** How a connect attempt or a retry loop ended. Reported via {@link BootstrapAuthConfig.onConnectState}. */
export type ConnectPhase =
  /** The account service answered; the slot is showing the real state. */
  | "connected"
  /** Signed in, but the profile row or account summary could not be loaded. */
  | "degraded"
  /** A transient failure; another attempt is scheduled. */
  | "retrying"
  /** The budget is spent (or the failure is permanent); the slot shows the error icon. */
  | "gave_up"
  /** A previously given-up connection came back. */
  | "recovered";

/** Payload passed to {@link BootstrapAuthConfig.onConnectState}. */
export interface ConnectEvent {
  phase: ConnectPhase;
  /** What triggered the loop: `"INITIAL_SESSION"`, `"retry"`, `"online"`, … */
  reason: string;
  /** 1-based attempt this event describes. */
  attempt: number;
  error?: unknown;
  /** Set on `"retrying"`: milliseconds until the next attempt. */
  nextRetryInMs?: number;
}

/** Connect-budget tuning. See {@link BootstrapAuthConfig.connect}. */
export interface ConnectConfig {
  /** Total attempts, including the first. Default 3. Clamped to >= 1. */
  attempts?: number;
  /** Cap on a single attempt before it is treated as a failure. Default 10_000. */
  timeoutMs?: number;
  /** Wall-clock budget across all attempts. Default 60_000. */
  giveUpMs?: number;
  /**
   * After giving up, the shortest gap before a tab-focus recheck may try
   * again. Default 300_000 (5 minutes). The `online` event and the retry
   * button ignore this — both are direct evidence that something changed.
   */
  recheckAfterMs?: number;
}

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
  /** Portal profile route appended to {@link BootstrapAuthConfig.portalUrl}. Default `"/profile"`. */
  profilePath?: string;
  /** Post-auth redirect. Default: `() => location.origin + location.pathname`. */
  defaultRedirectTo?: () => string;
  /** Post-sign-out redirect. Default: `() => location.origin`. */
  logoutRedirectTo?: () => string;
  /** Invoked after every render with the current auth state. */
  onAuthChange?: (state: AuthActionState) => void;
  /**
   * Invoked at each turn of the connect budget. Wire this to the app's
   * telemetry; the library only writes to `console`, which nothing collects.
   */
  onConnectState?: (event: ConnectEvent) => void;
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
  /**
   * How hard to try to reach the account service before giving up, in attempts
   * and in wall-clock milliseconds.
   *
   * Auth is never on the critical path of these apps — the map, the data and
   * every read-only feature work signed out — so an unreachable auth service is
   * a degraded corner of the UI, not a reason to keep a page retrying for the
   * length of a session. When the budget is spent the slot renders an error
   * icon that retries on click, and the Supabase token ticker is stopped so
   * nothing is left running in the background.
   *
   * Giving up is not permanent: coming back online, a tab focus after
   * `recheckAfterMs`, an auth event that proves the service answered, or a
   * click on the error icon all resume.
   *
   * Defaults: 3 attempts inside 60s, each attempt capped at 10s.
   */
  connect?: ConnectConfig;
}

/** Imperative handle returned by {@link bootstrapAuth}. */
export interface AuthHandle {
  supabase: ReturnType<typeof createGeoglowsSupabaseClient>;
  authAdapter: ReturnType<typeof createSupabaseAuthAdapter>;
  /** Current auth state (as passed to `renderAuthAction`). */
  getState(): AuthActionState;
  /** Programmatically open the sign-in modal. */
  openSignIn(): void;
  /** Clear a given-up connection and spend a fresh budget. Safe to call anytime. */
  reconnect(): void;
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
    profilePath = "/profile",
    defaultRedirectTo = () => window.location.origin + window.location.pathname,
    logoutRedirectTo = () => window.location.origin,
    onAuthChange,
    onConnectState,
    mountModal = true,
    signInRequestedEvent = "geoglows:sign-in-requested",
    oauthRedirectTo = () => window.location.origin + window.location.pathname,
    connect = {},
  } = config;

  // Clamped rather than trusted: `attempts: 0` would otherwise give up before
  // trying at all, and a negative timeout would fail every attempt instantly.
  const connectAttempts = Math.max(1, Math.floor(connect.attempts ?? 3));
  const connectTimeoutMs = Math.max(1000, connect.timeoutMs ?? 10_000);
  const connectGiveUpMs = Math.max(connectTimeoutMs, connect.giveUpMs ?? 60_000);
  const connectRecheckAfterMs = Math.max(0, connect.recheckAfterMs ?? 300_000);

  const profileHref = `${portalUrl}${profilePath}`;

  const supabase = createGeoglowsSupabaseClient({
    url: supabaseUrl,
    publishableKey: supabasePublishableKey,
    // The ticker is started below, and only once a session exists to refresh —
    // see startTicker(). Left on Supabase's default it runs from construction to
    // the end of the page, and against a stored session it cannot redeem it
    // becomes a retry storm every 30s for as long as the tab is open.
    autoRefreshToken: false,
    // Bounds every request the client makes, not just the bootstrap: the
    // sign-in form, password reset and profile writes are on the same
    // unreachable host when auth is down, and none of them had a timeout.
    fetchTimeoutMs: connectTimeoutMs,
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
    el.querySelector<HTMLElement>("#geoglowsAuthRetry")?.addEventListener(
      "click",
      () => reconnect("retry-button"),
    );

    onAuthChange?.(authState);
  }

  function openSignIn(): void {
    // The modal talks to the same host that just failed. Offering a form that
    // cannot submit is worse than saying so — and the attempt is itself a good
    // moment to find out whether the service came back.
    if (connectGaveUp) {
      console.warn(
        "Sign-in is unavailable: the account service could not be reached. Retrying…",
      );
      reconnect("sign-in-requested");
      return;
    }
    signInModal?.open();
  }

  const onSignInRequested = () => openSignIn();
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
  // Set once the connect budget is spent, so a later trigger cannot quietly
  // restart the retrying that the budget just ended. Cleared only by evidence:
  // the retry button, coming back online, a stale-enough tab focus, or an auth
  // event that could only have come from a service that answered.
  let connectGaveUp = false;
  // Torn down. Checked at every await boundary so nothing renders into, or
  // schedules against, a page that has gone away (HMR).
  let destroyed = false;
  // Rises with each retry loop. An older loop sees a newer generation at its
  // next await and returns, so a SIGNED_OUT supersedes an in-flight
  // INITIAL_SESSION loop instead of racing it with a second attempt counter.
  let loopGen = 0;
  // Rises with every attempt. A bootstrapSession that timed out keeps running
  // to completion — nothing can cancel a promise already in flight — and would
  // go on emitting state long after we moved on. Only the current attempt may
  // write. See commitLate() for the one deliberate exception.
  let attemptToken = 0;
  let lastAttemptAt = 0;
  // Whether an attempt has already consumed the OAuth callback code. Retrying
  // the exchange after it succeeded fails with a different, more confusing
  // error than the one being retried.
  let callbackConsumed = false;

  // Every pending timer, so destroy() can actually stop the loop rather than
  // clearing one handle and leaving the backoff sleep to wake up afterwards.
  const timers = new Set<ReturnType<typeof setTimeout>>();

  function track(fn: () => void, ms: number): ReturnType<typeof setTimeout> {
    const timer = setTimeout(() => {
      timers.delete(timer);
      fn();
    }, ms);
    timers.add(timer);
    return timer;
  }

  function untrack(timer: ReturnType<typeof setTimeout>): void {
    clearTimeout(timer);
    timers.delete(timer);
  }

  function sleep(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      track(resolve, ms);
    });
  }

  function emitConnect(event: ConnectEvent): void {
    try {
      onConnectState?.(event);
    } catch (error) {
      console.error("onConnectState handler threw:", error);
    }
  }

  /**
   * Supabase's background token refresh, run only while there is a session.
   *
   * The client is constructed with `autoRefreshToken: false`, so nothing ticks
   * until a bootstrap actually finds a session; a signed-out visitor and a
   * given-up connection both leave it stopped. `stopAutoRefresh()` also removes
   * the visibilitychange handler, so a stop is not undone by the next tab focus.
   */
  const startTicker = () =>
    void supabase.auth
      .startAutoRefresh()
      .catch((error: unknown) => console.debug("startAutoRefresh failed:", error));
  const stopTicker = () =>
    void supabase.auth
      .stopAutoRefresh()
      .catch((error: unknown) => console.debug("stopAutoRefresh failed:", error));

  function errorState(error: unknown): SessionState {
    return {
      status: "error",
      user: authState.user,
      account: authState.account,
      error,
    };
  }

  /**
   * Adopt a resolved session state and render it.
   *
   * The loop commits the state it awaited rather than trusting that
   * `onStateChange` fired for it. Same values, so this is idempotent with what
   * the callback already rendered — but the slot no longer depends on a
   * callback having been invoked in order to show a final answer.
   */
  function commit(state: SessionState): void {
    authState = {
      user: state.user,
      account: state.account,
      status: state.status,
      action: authState.action,
    };
    renderSlot();
  }

  /**
   * An abandoned attempt that nevertheless produced a session.
   *
   * The timeout says "stop waiting", not "discard the answer". If a slow
   * attempt eventually resolves with a real user while the slot is sitting on
   * the error state, committing it late beats showing an error icon over a
   * valid session. Deliberately narrow: it never overwrites a user we already
   * have, and never resurrects a session over a newer, healthy signed-out
   * answer.
   */
  function commitLate(token: number, state: SessionState): void {
    if (destroyed) return;
    if (!state.user || authState.user) return;
    if (!connectGaveUp && authState.status !== "error") return;

    connectGaveUp = false;
    commit(state);
    startTicker();
    emitConnect({ phase: "recovered", reason: "late-response", attempt: token });
  }

  /** One bootstrap, failed rather than left hanging if the service never answers. */
  function bootstrapOnce(): Promise<SessionState> {
    const token = ++attemptToken;
    lastAttemptAt = Date.now();

    const run = bootstrapSession({
      auth: authAdapter,
      supabase,
      completeCallback: !callbackConsumed,
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
        // Anything past the callback phase means the exchange is behind us.
        if (
          state.status !== "bootstrapping" &&
          state.status !== "processing_callback"
        ) {
          callbackConsumed = true;
        }
        if (destroyed || connectGaveUp || token !== attemptToken) return;
        // Preserve any locally-tracked action (e.g. "signing_out").
        authState = {
          user: state.user,
          account: state.account,
          status: state.status,
          action: authState.action,
        };
        renderSlot();
      },
    });

    // bootstrapSession resolves with an "error" state rather than rejecting, so
    // the only outcome it cannot report is the one where a request never
    // settles at all. The client-level fetch timeout covers most of that; this
    // cap covers the rest of the pipeline (adapter logic, storage, a stalled
    // promise chain) so an attempt always ends.
    let timedOut = false;
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<SessionState>((resolve) => {
      timeoutTimer = track(() => {
        timedOut = true;
        resolve(errorState(new RequestTimeoutError(connectTimeoutMs)));
      }, connectTimeoutMs);
    });

    // Only an abandoned attempt needs the late path; one the loop is still
    // awaiting is committed by the loop itself.
    void run.then(
      (state) => {
        if (timedOut) commitLate(token, state);
      },
      () => {},
    );

    return Promise.race([run, timeout]).finally(() => {
      if (timeoutTimer !== undefined) untrack(timeoutTimer);
    });
  }

  function giveUp(reason: string, attempt: number, error: unknown): void {
    connectGaveUp = true;
    stopTicker();
    authState = { ...authState, status: "error" };
    renderSlot();
    console.warn(
      `Could not reach the account service after ${attempt} attempt(s); ` +
        "showing the error state and stopping. Signed-out features are unaffected.",
      error,
    );
    emitConnect({ phase: "gave_up", reason, attempt, error });
  }

  /**
   * Bootstrap, retrying a failure until the connect budget is spent.
   *
   * The budget is the whole point: an app whose auth service is down should
   * settle into a stated error and stop, not retry for as long as the tab is
   * open. Attempts back off with jitter and stop at whichever of
   * `connect.attempts` / `connect.giveUpMs` comes first — or immediately, if
   * the failure is one that another identical request cannot fix.
   */
  async function runConnectLoop(gen: number, reason: string): Promise<void> {
    const deadline = Date.now() + connectGiveUpMs;

    for (let attempt = 1; ; attempt++) {
      if (destroyed || gen !== loopGen) return;

      // No point spending the budget with the radio off. The `online` listener
      // resumes without waiting for a click.
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        giveUp(reason, attempt - 1, new Error("The browser is offline"));
        return;
      }

      let state: SessionState;
      try {
        state = await bootstrapOnce();
      } catch (error) {
        console.error(
          `Bootstrap after ${reason} failed:`,
          error instanceof Error ? error.message : error,
        );
        state = errorState(error);
      }

      if (destroyed || gen !== loopGen) return;

      if (state.status !== "error") {
        commit(state);
        // Reached the service. A signed-out visitor has no token to refresh, so
        // the ticker stays stopped until a sign-in actually produces a session.
        if (state.status === "anonymous") stopTicker();
        else startTicker();
        emitConnect({ phase: "connected", reason, attempt });
        return;
      }

      // Reached the service, but a step after sign-in failed — the profile row
      // or the account summary. The session is real and the avatar is correct;
      // retrying the whole pipeline as if the host were down would burn the
      // budget and then hide a live session behind an error icon.
      if (state.user) {
        commit(state);
        startTicker();
        console.warn(
          "Signed in, but the account details could not be loaded:",
          state.error,
        );
        emitConnect({ phase: "degraded", reason, attempt, error: state.error });
        return;
      }

      const transient = isTransientError(state.error);
      const backoffMs = computeBackoffMs(attempt);
      const outOfAttempts = attempt >= connectAttempts;
      const outOfTime = Date.now() + backoffMs > deadline;

      if (!transient || outOfAttempts || outOfTime) {
        giveUp(reason, attempt, state.error);
        return;
      }

      emitConnect({
        phase: "retrying",
        reason,
        attempt,
        error: state.error,
        nextRetryInMs: backoffMs,
      });
      await sleep(backoffMs);
    }
  }

  function bootstrapSafe(reason: string): void {
    if (destroyed || connectGaveUp) return;
    // Supersedes any loop already running, so two triggers cannot share — and
    // double — one budget.
    const gen = ++loopGen;
    void runConnectLoop(gen, reason);
  }

  /** Clear the give-up and spend a fresh budget. The error icon's click, and more. */
  function reconnect(reason: string): void {
    if (destroyed) return;
    const wasGivenUp = connectGaveUp;
    connectGaveUp = false;
    if (!authState.user) {
      authState = { ...authState, status: "bootstrapping" };
      renderSlot();
    }
    if (wasGivenUp) {
      emitConnect({ phase: "recovered", reason, attempt: 0 });
    }
    bootstrapSafe(reason);
  }

  const { data: authSub } = supabase.auth.onAuthStateChange(
    (event, session) => {
      if (destroyed) return;

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
        // A signed-out visitor should see "Sign in", never a stale error icon —
        // whatever the connection was doing beforehand.
        reconnect("SIGNED_OUT");
        return;
      }
      if (event === "SIGNED_IN") {
        // Supabase fires SIGNED_IN on every visibility-change revalidation.
        // Skip the rebootstrap when it's the same user we already have.
        const newId = session?.user?.id;
        const currentSub = authState.user?.sub;
        if (newId && currentSub && newId === currentSub) return;
        // A SIGNED_IN could only come from a service that answered, so it
        // clears a give-up rather than being swallowed by it.
        reconnect("SIGNED_IN");
      }
      if (event === "TOKEN_REFRESHED") {
        // Same reasoning: proof of reachability. Nothing else to do when the
        // connection was already healthy.
        if (connectGaveUp) reconnect("TOKEN_REFRESHED");
      }
      if (event === "PASSWORD_RECOVERY") {
        if (!tabHasRecoveryUrl) return;
        signInModal?.open({ view: "setNewPassword" });
      }
    },
  );

  // Most failures here are a flaky client network, not a downed service.
  // Coming back online is direct evidence that retrying is worth it.
  const onOnline = () => {
    if (connectGaveUp) reconnect("online");
  };
  window.addEventListener("online", onOnline);

  // A tab left on the error icon for long enough is worth one quiet recheck
  // when the user comes back to it. Rate-limited so focus-flipping cannot
  // become a retry loop by hand.
  const onVisibilityChange = () => {
    if (document.visibilityState !== "visible" || !connectGaveUp) return;
    if (Date.now() - lastAttemptAt < connectRecheckAfterMs) return;
    reconnect("visibilitychange");
  };
  document.addEventListener("visibilitychange", onVisibilityChange);

  // Safety net: if INITIAL_SESSION never fires within 2s, bootstrap anyway so
  // the slot never sticks on the "Signing in…" placeholder.
  track(() => {
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
    openSignIn,
    reconnect: () => reconnect("manual"),
    signOut,
    destroy: () => {
      destroyed = true;
      // Any loop mid-backoff returns at its next await instead of waking up
      // and rendering into a torn-down page.
      loopGen++;
      window.removeEventListener(signInRequestedEvent, onSignInRequested);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      unwireAvatarMenu();
      authSub?.subscription?.unsubscribe();
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      stopTicker();
    },
  };
}
