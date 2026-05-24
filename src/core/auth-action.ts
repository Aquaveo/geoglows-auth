import type { AuthUser } from "../types";
import type { AccountSummary } from "./account";
import { getUserDisplayInfo, type SessionStatus } from "./session";
import { escapeHtml, sanitizeHref } from "./escape";

/**
 * Statuses that render the loading pill. Centralized so future additions to
 * `SessionStatus` don't silently fall through to the sign-in branch.
 */
const LOADING_STATUSES: ReadonlySet<SessionStatus> = new Set<SessionStatus>([
  "bootstrapping",
  "processing_callback",
  "loading_profile",
  "loading_account",
]);

export type AuthActionVerb = "signing_out";

/**
 * State the auth action surface needs to render. Composed from `SessionState`
 * plus an optional in-flight verb that surfaces UI affordances (e.g. disabling
 * the sign-out button while the request is in flight).
 *
 * `account` reuses `AccountSummary` so consumers can pass `SessionState.account`
 * directly without adapter glue.
 */
export interface AuthActionState {
  user: AuthUser | null;
  account: AccountSummary | null;
  status: SessionStatus;
  action?: AuthActionVerb | null;
}

/**
 * Optional rendering options for `renderAuthAction`.
 *
 * `profileHref` controls the destination of the Profile link in the avatar
 * dropdown. The default `"#profile"` preserves backward compat for consumers
 * that handle the hash route in their own router (e.g. apps.geoglows). Sub-apps
 * that want the link to navigate elsewhere (typically the portal's profile
 * page) should pass an absolute or root-relative URL like `"/#profile"` or
 * `"https://portal-dev.geoglows.org/#profile"`.
 *
 * Pass `null` to omit the Profile link entirely from the dropdown — useful when
 * a sub-app does not have its own profile page AND the portal is unreachable
 * from this surface.
 *
 * Dangerous URL schemes (`javascript:`, `data:`, `vbscript:`) are rejected by
 * `sanitizeHref` and behave the same as `null` (link omitted).
 */
export interface AuthActionOptions {
  profileHref?: string | null;
}

/**
 * Returns the HTML string for the auth-action slot in a navbar.
 *
 * Three states it can render:
 *   - Loading pill (during session bootstrap)
 *   - "Sign in" button (signed out; click should open the sign-in modal)
 *   - Avatar with dropdown menu (signed in; menu has Profile link + Sign out)
 *
 * Consumers interpolate the returned string into their own template, OR
 * surgically update a slot via `container.innerHTML = renderAuthAction(state)`
 * to avoid tearing down sibling DOM (e.g., a map). The element IDs in the
 * markup are stable contract: `#geoglowsSignIn` (the sign-in button),
 * `#geoglowsSignOut` (the sign-out button), `#geoglowsAuthActionAvatar` (the
 * `<details>`-based dropdown).
 *
 * Pair with `mountSignInModal` and `import "@aquaveo/geoglows-auth/core/sign-in.css"`
 * for the matching styles.
 */
export function renderAuthAction(
  state: AuthActionState,
  options: AuthActionOptions = {},
): string {
  const { user, account, status, action } = state;
  // `profileHref === undefined` means "use the default" (#profile); explicit
  // `null` means "omit the Profile link"; any other string flows through
  // sanitizeHref which also returns null for dangerous schemes.
  const rawProfileHref =
    options.profileHref === undefined ? "#profile" : options.profileHref;
  const profileHref = sanitizeHref(rawProfileHref);

  // If we have a user, prefer the avatar even during transient loading
  // statuses. This protects against the visible flicker that would otherwise
  // happen when Supabase JS fires SIGNED_IN on tab focus for session
  // revalidation: consumers calling bootstrapSession again would briefly emit
  // status "bootstrapping" / "loading_profile" / "loading_account" while the
  // user is still authenticated. Pair with `bootstrapSession({ initialState })`
  // (session.ts) which avoids nulling out user/account during those phases.
  if (!user) {
    if (LOADING_STATUSES.has(status)) {
      return `
        <div class="geoglows-auth-action-loading" role="status" aria-live="polite">
          <span class="geoglows-auth-action-loading-dot" aria-hidden="true"></span>
          Signing in…
        </div>
      `;
    }

    return `
      <button
        type="button"
        id="geoglowsSignIn"
        class="geoglows-auth-action-signin"
        aria-label="Sign in"
      >
        Sign in
      </button>
    `;
  }

  const { name, email, initials } = getUserDisplayInfo(user, account);

  return `
    <details class="geoglows-auth-action-avatar-wrapper" id="geoglowsAuthActionAvatar">
      <summary class="geoglows-auth-action-avatar-summary" aria-label="Open user menu">
        ${escapeHtml(initials)}
      </summary>
      <div class="geoglows-auth-action-menu">
        <div class="geoglows-auth-action-menu-header">
          <p class="geoglows-auth-action-menu-name">${escapeHtml(name)}</p>
          <p class="geoglows-auth-action-menu-email">${escapeHtml(email)}</p>
        </div>
        ${profileHref === null ? "" : `<a href="${escapeHtml(profileHref)}" class="geoglows-auth-action-menu-link">Profile</a>`}
        <div class="geoglows-auth-action-menu-divider"></div>
        <button
          type="button"
          id="geoglowsSignOut"
          class="geoglows-auth-action-menu-signout"
          ${action === "signing_out" ? "disabled" : ""}
        >
          ${action === "signing_out" ? "Signing out…" : "Sign out"}
        </button>
      </div>
    </details>
  `;
}
