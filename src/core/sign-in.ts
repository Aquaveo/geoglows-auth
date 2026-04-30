import type { GeoglowsSupabaseClient, SupabaseAuthAdapter } from "../types";
import { escape } from "./escape";
// Side-effect import so Vite's library build emits sign-in.css alongside
// the JS bundle. Consumers also get a stable subpath at
// `@aquaveo/geoglows-auth/core/sign-in.css` for explicit imports.
import "./sign-in.css";

/**
 * Mode controls which form variants the modal renders.
 *
 * - `"full"` (default) renders the sign-in form plus a sign-up toggle (with
 *   first/last name fields and a confirmation-sent screen).
 * - `"signin"` renders only the sign-in form. The sign-up toggle is hidden;
 *   users intending to create an account must do so elsewhere. Useful for
 *   sub-apps that share a session with a primary app where account creation
 *   already lives.
 */
export type SignInModalMode = "full" | "signin";

export interface SignInModalOptions {
  /**
   * The Supabase client to use for sign-up calls. Must be the same client the
   * `authAdapter` was created against — the modal calls
   * `supabase.auth.signUp(...)` directly for the sign-up branch.
   */
  supabase: GeoglowsSupabaseClient;
  /**
   * Adapter providing `signInWithPassword` and `signInWithOAuth`. Created via
   * `createSupabaseAuthAdapter({ supabase })`.
   */
  authAdapter: SupabaseAuthAdapter;
  /** Default `"full"`. See `SignInModalMode`. */
  mode?: SignInModalMode;
  /**
   * Called after successful password sign-in. OAuth flows redirect away, so
   * this callback is not invoked for them.
   */
  onSignedIn?: () => void;
  /**
   * Where OAuth providers redirect back to. Defaults to
   * `window.location.origin`. Must be on the project's Supabase Auth →
   * Redirect URLs allowlist.
   */
  oauthRedirectTo?: string;
  /**
   * Where the email-confirmation link redirects to (for sign-up). Defaults to
   * `window.location.origin`. Must be on the allowlist.
   */
  emailRedirectTo?: string;
  /**
   * Where in the DOM to mount the dialog. Defaults to `document.body`.
   */
  container?: HTMLElement;
}

export interface SignInModalHandle {
  /** Show the modal. Idempotent: calling on an already-open modal is a no-op. */
  open(): void;
  /** Close the modal. Idempotent. */
  close(): void;
  /**
   * Remove the modal from the DOM and clean up listeners. The handle is
   * unusable after this returns.
   */
  unmount(): void;
}

const GENERIC_PASSWORD_ERROR =
  "Sign-in failed. Please check your email and password and try again.";
const GENERIC_SIGNUP_ERROR =
  "We couldn't create your account. Please try again.";
const GENERIC_OAUTH_ERROR =
  "We couldn't start the sign-in flow. Please try again.";

type ModalMode = "signIn" | "signUp" | "signUpSent";

interface ModalState {
  mode: ModalMode;
  error: string | null;
  pending: boolean;
}

/**
 * Mounts a vanilla `<dialog>`-based sign-in modal. Returns a handle for
 * imperative control.
 *
 * Pair with `import "@aquaveo/geoglows-auth/core/sign-in.css"` for styles.
 *
 * Example:
 * ```ts
 * import { mountSignInModal } from "@aquaveo/geoglows-auth/core";
 * import "@aquaveo/geoglows-auth/core/sign-in.css";
 *
 * const modal = mountSignInModal({ supabase, authAdapter });
 * document.querySelector("#signIn")?.addEventListener("click", () => modal.open());
 * ```
 */
export function mountSignInModal(
  options: SignInModalOptions,
): SignInModalHandle {
  const {
    supabase,
    authAdapter,
    mode: defaultMode = "full",
    onSignedIn,
    oauthRedirectTo,
    emailRedirectTo,
    container = document.body,
  } = options;

  const dialog = document.createElement("dialog");
  dialog.id = "geoglowsSignInModal";
  dialog.className = "geoglows-signin-modal";
  container.appendChild(dialog);

  let state: ModalState = { mode: "signIn", error: null, pending: false };

  function setState(patch: Partial<ModalState>): void {
    state = { ...state, ...patch };
    const scrollTop = dialog.scrollTop;
    dialog.innerHTML = renderBody(state, defaultMode);
    bindEvents();
    dialog.scrollTop = scrollTop;
  }

  function close(): void {
    state = { mode: "signIn", error: null, pending: false };
    dialog.innerHTML = renderBody(state, defaultMode);
    if (dialog.open) dialog.close();
  }

  function open(): void {
    if (dialog.open) return;
    setState({ mode: "signIn", error: null, pending: false });
    dialog.showModal();
  }

  async function handleOAuth(provider: string): Promise<void> {
    setState({ pending: true, error: null });
    try {
      await authAdapter.signInWithOAuth({
        provider,
        redirectTo: oauthRedirectTo ?? window.location.origin,
      });
      // Browser redirects away; nothing else to do.
    } catch (err) {
      console.error(
        "OAuth sign-in failed:",
        err instanceof Error ? err.message : err,
      );
      setState({ pending: false, error: GENERIC_OAUTH_ERROR });
    }
  }

  async function handlePasswordSubmit(form: HTMLFormElement): Promise<void> {
    const email = (form.elements.namedItem("email") as HTMLInputElement).value.trim();
    const password = (form.elements.namedItem("password") as HTMLInputElement).value;
    const isSignUp = state.mode === "signUp";

    const firstNameEl = form.elements.namedItem("first_name") as HTMLInputElement | null;
    const lastNameEl = form.elements.namedItem("last_name") as HTMLInputElement | null;
    const firstName = isSignUp ? (firstNameEl?.value ?? "").trim() : "";
    const lastName = isSignUp ? (lastNameEl?.value ?? "").trim() : "";

    if (isSignUp && !firstName) {
      setState({ error: "Please enter your first name." });
      return;
    }
    if (isSignUp && !lastName) {
      setState({ error: "Please enter your last name." });
      return;
    }
    if (!email) {
      setState({ error: "Please enter your email address." });
      return;
    }
    if (!password.trim()) {
      setState({
        error: isSignUp ? "Please choose a password." : "Please enter your password.",
      });
      return;
    }

    setState({ pending: true, error: null });
    try {
      if (isSignUp) {
        const fullName = [firstName, lastName].filter(Boolean).join(" ");
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: emailRedirectTo ?? window.location.origin,
            data: {
              first_name: firstName,
              last_name: lastName,
              full_name: fullName,
            },
          },
        });
        if (error) throw error;
        setState({ pending: false, error: null, mode: "signUpSent" });
      } else {
        await authAdapter.signInWithPassword({ email, password });
        close();
        onSignedIn?.();
      }
    } catch (err) {
      console.error(
        `${state.mode === "signUp" ? "Sign-up" : "Sign-in"} failed:`,
        err instanceof Error ? err.message : err,
      );
      setState({
        pending: false,
        error: state.mode === "signUp" ? GENERIC_SIGNUP_ERROR : GENERIC_PASSWORD_ERROR,
      });
    }
  }

  function bindEvents(): void {
    dialog
      .querySelector<HTMLButtonElement>("#geoglowsSignInClose")
      ?.addEventListener("click", () => close());

    dialog
      .querySelector<HTMLButtonElement>("#geoglowsSignInGoogle")
      ?.addEventListener("click", () => handleOAuth("google"));

    dialog
      .querySelector<HTMLButtonElement>("#geoglowsSignInGithub")
      ?.addEventListener("click", () => handleOAuth("github"));

    dialog
      .querySelector<HTMLFormElement>("#geoglowsSignInForm")
      ?.addEventListener("submit", (e) => {
        e.preventDefault();
        handlePasswordSubmit(e.target as HTMLFormElement);
      });

    dialog
      .querySelector<HTMLButtonElement>("#geoglowsSignInToggleMode")
      ?.addEventListener("click", () => {
        setState({
          mode: state.mode === "signUp" ? "signIn" : "signUp",
          error: null,
        });
      });

    dialog
      .querySelector<HTMLButtonElement>("#geoglowsSignInBackToForm")
      ?.addEventListener("click", () => {
        setState({ mode: "signIn", error: null });
      });
  }

  // Close on backdrop click. Native <dialog> doesn't do this for us.
  function handleBackdropClick(e: MouseEvent): void {
    if (e.target === dialog) close();
  }
  dialog.addEventListener("click", handleBackdropClick);

  // Reset state on close (Escape key or programmatic close).
  function handleClose(): void {
    state = { mode: "signIn", error: null, pending: false };
  }
  dialog.addEventListener("close", handleClose);

  // Initial render
  dialog.innerHTML = renderBody(state, defaultMode);
  bindEvents();

  return {
    open,
    close,
    unmount(): void {
      dialog.removeEventListener("click", handleBackdropClick);
      dialog.removeEventListener("close", handleClose);
      if (dialog.open) dialog.close();
      dialog.remove();
    },
  };
}

function renderBody(state: ModalState, defaultMode: SignInModalMode): string {
  if (state.mode === "signUpSent") {
    return `
      <div class="geoglows-signin-confirmation">
        <h2 class="geoglows-signin-title">Check your email</h2>
        <p class="geoglows-signin-confirmation-text">
          We sent a confirmation link to your email. Click the link to finish creating your account.
        </p>
        <button
          type="button"
          id="geoglowsSignInBackToForm"
          class="geoglows-signin-confirmation-back"
        >
          Back to sign in
        </button>
      </div>
    `;
  }

  const isSignUp = state.mode === "signUp";
  const showToggle = defaultMode === "full";
  const errorBlock = state.error
    ? `<p role="alert" aria-live="polite" class="geoglows-signin-error">${escape(state.error)}</p>`
    : "";

  const nameGrid = isSignUp
    ? `
      <div class="geoglows-signin-name-grid">
        <div class="geoglows-signin-field">
          <label for="geoglowsSignInFirstName" class="geoglows-signin-label">First name</label>
          <input
            id="geoglowsSignInFirstName"
            name="first_name"
            type="text"
            autocomplete="given-name"
            class="geoglows-signin-input"
            ${state.pending ? "disabled" : ""}
            required
          />
        </div>
        <div class="geoglows-signin-field">
          <label for="geoglowsSignInLastName" class="geoglows-signin-label">Last name</label>
          <input
            id="geoglowsSignInLastName"
            name="last_name"
            type="text"
            autocomplete="family-name"
            class="geoglows-signin-input"
            ${state.pending ? "disabled" : ""}
            required
          />
        </div>
      </div>
    `
    : "";

  const toggle = showToggle
    ? `
      <p class="geoglows-signin-toggle-text">
        ${
          isSignUp
            ? `Already have an account? <button type="button" id="geoglowsSignInToggleMode" class="geoglows-signin-toggle-button">Sign in</button>`
            : `New here? <button type="button" id="geoglowsSignInToggleMode" class="geoglows-signin-toggle-button">Create an account</button>`
        }
      </p>
    `
    : "";

  return `
    <div class="geoglows-signin-content">
      <div class="geoglows-signin-header">
        <h2 class="geoglows-signin-title">${isSignUp ? "Create your account" : "Sign in"}</h2>
        <button
          type="button"
          id="geoglowsSignInClose"
          aria-label="Close"
          class="geoglows-signin-close"
        >&times;</button>
      </div>

      ${errorBlock}

      <div class="geoglows-signin-providers">
        <button
          type="button"
          id="geoglowsSignInGoogle"
          class="geoglows-signin-provider-button"
          ${state.pending ? "disabled" : ""}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"/>
            <path fill="#34A853" d="M9 18c2.43 0 4.47-.81 5.96-2.18l-2.92-2.26c-.8.54-1.83.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.34A9 9 0 0 0 9 18z"/>
            <path fill="#FBBC05" d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.94H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.06l3.01-2.34z"/>
            <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.46 3.44 1.35l2.58-2.58A9 9 0 0 0 9 0 9 9 0 0 0 .96 4.94L3.97 7.28C4.68 5.16 6.66 3.58 9 3.58z"/>
          </svg>
          Continue with Google
        </button>
        <button
          type="button"
          id="geoglowsSignInGithub"
          class="geoglows-signin-provider-button"
          ${state.pending ? "disabled" : ""}
        >
          <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"/>
          </svg>
          Continue with GitHub
        </button>
      </div>

      <div class="geoglows-signin-divider">
        <span class="geoglows-signin-divider-label">or with email</span>
      </div>

      <form id="geoglowsSignInForm" novalidate class="geoglows-signin-form">
        ${nameGrid}
        <div class="geoglows-signin-field">
          <label for="geoglowsSignInEmail" class="geoglows-signin-label">Email</label>
          <input
            id="geoglowsSignInEmail"
            name="email"
            type="email"
            autocomplete="email"
            class="geoglows-signin-input"
            ${state.pending ? "disabled" : ""}
            required
          />
        </div>
        <div class="geoglows-signin-field">
          <label for="geoglowsSignInPassword" class="geoglows-signin-label">Password</label>
          <input
            id="geoglowsSignInPassword"
            name="password"
            type="password"
            autocomplete="${isSignUp ? "new-password" : "current-password"}"
            class="geoglows-signin-input"
            ${state.pending ? "disabled" : ""}
            required
          />
        </div>
        <button
          type="submit"
          class="geoglows-signin-submit"
          ${state.pending ? "disabled" : ""}
        >
          ${
            state.pending
              ? isSignUp
                ? "Creating account…"
                : "Signing in…"
              : isSignUp
                ? "Create account"
                : "Sign in"
          }
        </button>
      </form>

      ${toggle}
    </div>
  `;
}
