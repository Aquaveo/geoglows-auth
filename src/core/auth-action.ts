import type { AuthUser, Profile } from "../types";
import { getUserDisplayInfo } from "./session";
import { escape } from "./escape";

/**
 * State the auth action surface needs to render. Consumers compose this from
 * their own application state (typically `{ user, account, status, action }`).
 *
 * - `status` values that render the loading pill: `"bootstrapping"`,
 *   `"processing_callback"`, `"loading_profile"`, `"loading_account"`. Any
 *   other value with `user === null` renders the sign-in button.
 * - `action === "signing_out"` disables the sign-out button and shows
 *   "Signing out…" text inside the user menu.
 */
export interface AuthActionState {
  user: AuthUser | null;
  account: { profile: Profile | null } | null;
  status: string;
  action?: string | null;
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
 * markup are stable: `#signIn` (the sign-in button), `#signOut` (the sign-out
 * button), `#authActionAvatar` (the `<details>`-based dropdown).
 *
 * Pair with `mountSignInModal` and `import "@aquaveo/geoglows-auth/core/sign-in.css"`
 * for the matching styles.
 */
export function renderAuthAction(state: AuthActionState): string {
  const { user, account, status, action } = state;

  if (
    status === "bootstrapping" ||
    status === "processing_callback" ||
    status === "loading_profile" ||
    status === "loading_account"
  ) {
    return `
      <div class="geoglows-auth-action-loading" role="status" aria-live="polite">
        <span class="geoglows-auth-action-loading-dot" aria-hidden="true"></span>
        Signing in…
      </div>
    `;
  }

  if (!user) {
    return `
      <button
        type="button"
        id="signIn"
        class="geoglows-auth-action-signin"
        aria-label="Sign in"
      >
        Sign in
      </button>
    `;
  }

  const { name, email, initials } = getUserDisplayInfo(user, account);

  return `
    <details class="geoglows-auth-action-avatar-wrapper" id="authActionAvatar">
      <summary class="geoglows-auth-action-avatar-summary" aria-label="Open user menu">
        ${escape(initials)}
      </summary>
      <div class="geoglows-auth-action-menu">
        <div class="geoglows-auth-action-menu-header">
          <p class="geoglows-auth-action-menu-name">${escape(name)}</p>
          <p class="geoglows-auth-action-menu-email">${escape(email)}</p>
        </div>
        <a href="#profile" class="geoglows-auth-action-menu-link">Profile</a>
        <div class="geoglows-auth-action-menu-divider"></div>
        <button
          type="button"
          id="signOut"
          class="geoglows-auth-action-menu-signout"
          ${action === "signing_out" ? "disabled" : ""}
        >
          ${action === "signing_out" ? "Signing out…" : "Log out"}
        </button>
      </div>
    </details>
  `;
}
