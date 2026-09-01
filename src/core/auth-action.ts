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
 * dropdown. The default `"/profile"` targets the portal's profile page. Sub-apps
 * that want the link to navigate elsewhere (typically the portal's profile
 * page on another host) should pass an absolute URL like
 * `"https://apps.geoglows.org/profile"`.
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
 * Four states it can render:
 *   - Loading pill (during session bootstrap)
 *   - Error icon (the account service could not be reached; click retries)
 *   - "Sign in" button (signed out; click should open the sign-in modal)
 *   - Avatar with dropdown menu (signed in; menu has Profile link + Sign out)
 *
 * Consumers interpolate the returned string into their own template, OR
 * surgically update a slot via `container.innerHTML = renderAuthAction(state)`
 * to avoid tearing down sibling DOM (e.g., a map). The element IDs in the
 * markup are stable contract: `#geoglowsSignIn` (the sign-in button),
 * `#geoglowsSignOut` (the sign-out button), `#geoglowsAuthActionAvatar` (the
 * `<details>`-based dropdown), `#geoglowsAuthRetry` (the error-state retry).
 *
 * Pair with `mountSignInModal` and `import "@aquaveo/geoglows-auth/core/sign-in.css"`
 * for the matching styles.
 */
export function renderAuthAction(
  state: AuthActionState,
  options: AuthActionOptions = {},
): string {
  const { user, account, status, action } = state;
  // `profileHref === undefined` means "use the default" (/profile); explicit
  // `null` means "omit the Profile link"; any other string flows through
  // sanitizeHref which also returns null for dangerous schemes.
  const rawProfileHref =
    options.profileHref === undefined ? "/profile" : options.profileHref;
  const profileHref = sanitizeHref(rawProfileHref);

  // If we have a user, prefer the avatar even during transient loading
  // statuses. This protects against the visible flicker that would otherwise
  // happen when Supabase JS fires SIGNED_IN on tab focus for session
  // revalidation: consumers calling bootstrapSession again would briefly emit
  // status "bootstrapping" / "loading_profile" / "loading_account" while the
  // user is still authenticated. Pair with `bootstrapSession({ initialState })`
  // (session.ts) which avoids nulling out user/account during those phases.
  if (!user) {
    // The account service could not be reached and we have stopped trying — see
    // `bootstrapAuth`'s connect budget. Deliberately not the "Sign in" button: a
    // button that opens a modal which cannot possibly work is worse than saying
    // so, and the retry is the one action that can change the answer.
    if (status === "error") {
      return `
        <button
          type="button"
          id="geoglowsAuthRetry"
          class="geoglows-auth-action-error"
          aria-label="Account service unavailable. Retry."
          title="Could not reach the account service. Click to try again."
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M12 9v4" />
            <path d="M12 17h.01" />
            <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
          </svg>
        </button>
      `;
    }

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

/**
 * Close the avatar `<details>` menu when the user clicks anywhere outside it
 * or presses Escape. A native `<details>` only toggles from its own summary,
 * so without this the menu stays open until the avatar is clicked again.
 *
 * The slot is re-rendered on every auth change, so the open menu is looked up
 * per event rather than captured. Returns a function that removes the
 * listeners.
 */
export function wireAvatarMenuDismiss(
  slot: Element,
  doc: Document = document,
): () => void {
  const openMenu = () =>
    slot.querySelector<HTMLDetailsElement>("details[open]");
  const onClick = (e: Event) => {
    const menu = openMenu();
    if (menu && !menu.contains(e.target as Node)) menu.open = false;
  };
  const onKeydown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      const menu = openMenu();
      if (menu) menu.open = false;
    }
  };
  doc.addEventListener("click", onClick);
  doc.addEventListener("keydown", onKeydown);
  return () => {
    doc.removeEventListener("click", onClick);
    doc.removeEventListener("keydown", onKeydown);
  };
}
