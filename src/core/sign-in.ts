import type { SupabaseAuthAdapter } from "../types";
import { escapeHtml } from "./escape";
// Side-effect import so Vite's library build emits sign-in.css alongside
// the JS bundle. Consumers also get a stable subpath at
// `@aquaveo/geoglows-auth/core/sign-in.css` for explicit imports.
import "./sign-in.css";

export interface SignInModalOptions {
  /**
   * Adapter providing `signInWithPassword`, `signInWithOAuth`, and
   * `signUpWithPassword`. Created via `createSupabaseAuthAdapter({ supabase })`.
   */
  authAdapter: SupabaseAuthAdapter;
  /**
   * When `true` (default), users can toggle between sign-in and sign-up.
   * When `false`, only the sign-in form renders — useful for sub-apps that
   * share a session with a primary app where account creation already lives.
   */
  allowSignUp?: boolean;
  /**
   * Called after successful password sign-in. OAuth flows redirect away, so
   * this callback is not invoked for them. Errors thrown from this callback
   * are isolated from the modal's own error handling — they will be logged
   * but will not surface as a "Sign-in failed" message.
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
}

export interface SignInModalHandle {
  /** Show the modal. Idempotent. Throws if the handle has been unmounted. */
  open(): void;
  /**
   * Close the modal and reset to a fresh sign-in state. Idempotent. Cancels
   * any in-flight submit so its resolution does not fire `onSignedIn`.
   */
  close(): void;
  /**
   * Remove the modal from the DOM and clean up listeners. Cancels any in-flight
   * submit. The handle is unusable after this returns — `open`/`close` will
   * throw.
   */
  unmount(): void;
}

const GENERIC_PASSWORD_ERROR =
  "Sign-in failed. Please check your email and password and try again.";
const GENERIC_SIGNUP_ERROR =
  "We couldn't create your account. Please try again.";
const GENERIC_OAUTH_ERROR =
  "We couldn't start the sign-in flow. Please try again.";

type ModalView = "signIn" | "signUp" | "signUpSent";

interface ModalState {
  view: ModalView;
  error: string | null;
  pending: boolean;
  /** Retained across re-renders so validation errors don't wipe typed input. */
  email: string;
  firstName: string;
  lastName: string;
}

const INITIAL_STATE: ModalState = {
  view: "signIn",
  error: null,
  pending: false,
  email: "",
  firstName: "",
  lastName: "",
};

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
 * const modal = mountSignInModal({ authAdapter });
 * document.querySelector("#geoglowsSignIn")?.addEventListener("click", () => modal.open());
 * ```
 */
export function mountSignInModal(
  options: SignInModalOptions,
): SignInModalHandle {
  const {
    authAdapter,
    allowSignUp = true,
    onSignedIn,
    oauthRedirectTo,
    emailRedirectTo,
  } = options;

  const dialog = document.createElement("dialog");
  dialog.id = "geoglowsSignInModal";
  dialog.className = "geoglows-signin-modal";
  document.body.appendChild(dialog);

  let state: ModalState = { ...INITIAL_STATE };

  // Tracks the currently-allowed in-flight request. Incremented on every
  // close/unmount and on every new submit. Resolutions whose captured epoch
  // doesn't match the live one are stale (the user closed the modal, hit
  // Escape, or kicked off another request) and must not mutate state or fire
  // onSignedIn.
  let requestEpoch = 0;
  let unmounted = false;

  function assertMounted(): void {
    if (unmounted) {
      throw new Error("SignInModal handle has been unmounted");
    }
  }

  function captureFormValues(): Pick<
    ModalState,
    "email" | "firstName" | "lastName"
  > {
    const form = dialog.querySelector("#geoglowsSignInForm");
    if (!(form instanceof HTMLFormElement)) {
      return {
        email: state.email,
        firstName: state.firstName,
        lastName: state.lastName,
      };
    }
    const read = (name: string): string | null => {
      const el = form.querySelector(`input[name="${name}"]`);
      return el instanceof HTMLInputElement ? el.value : null;
    };
    return {
      email: read("email")?.trim() ?? state.email,
      firstName: read("first_name")?.trim() ?? state.firstName,
      lastName: read("last_name")?.trim() ?? state.lastName,
    };
  }

  function setState(patch: Partial<ModalState>): void {
    state = { ...state, ...patch };
    const scrollTop = dialog.scrollTop;
    dialog.innerHTML = renderBody(state, allowSignUp);
    bindEvents();
    dialog.scrollTop = scrollTop;
  }

  function close(): void {
    requestEpoch++;
    state = { ...INITIAL_STATE };
    dialog.innerHTML = renderBody(state, allowSignUp);
    if (dialog.open) dialog.close();
  }

  function open(): void {
    assertMounted();
    if (dialog.open) return;
    setState({ ...INITIAL_STATE });
    dialog.showModal();
  }

  async function handleOAuth(provider: string): Promise<void> {
    const epoch = ++requestEpoch;
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
        err instanceof Error ? err.message : String(err),
      );
      if (epoch !== requestEpoch || unmounted) return;
      setState({ pending: false, error: GENERIC_OAUTH_ERROR });
    }
  }

  async function handlePasswordSubmit(form: HTMLFormElement): Promise<void> {
    const captured = readFormValues(form);
    const isSignUp = state.view === "signUp";

    if (isSignUp && !captured.firstName) {
      setState({ error: "Please enter your first name.", ...captured });
      return;
    }
    if (isSignUp && !captured.lastName) {
      setState({ error: "Please enter your last name.", ...captured });
      return;
    }
    if (!captured.email) {
      setState({ error: "Please enter your email address.", ...captured });
      return;
    }
    if (!captured.password.trim()) {
      setState({
        error: isSignUp
          ? "Please choose a password."
          : "Please enter your password.",
        ...captured,
      });
      return;
    }

    const epoch = ++requestEpoch;
    setState({ pending: true, error: null, ...captured });

    try {
      if (isSignUp) {
        const fullName = [captured.firstName, captured.lastName]
          .filter(Boolean)
          .join(" ");
        await authAdapter.signUpWithPassword({
          email: captured.email,
          password: captured.password,
          emailRedirectTo: emailRedirectTo ?? window.location.origin,
          metadata: {
            first_name: captured.firstName,
            last_name: captured.lastName,
            full_name: fullName,
          },
        });
        if (epoch !== requestEpoch || unmounted) return;
        setState({
          pending: false,
          error: null,
          view: "signUpSent",
        });
      } else {
        await authAdapter.signInWithPassword({
          email: captured.email,
          password: captured.password,
        });
        if (epoch !== requestEpoch || unmounted) return;
        close();
        // Isolate consumer-callback errors from auth-error rendering. A throw
        // from onSignedIn must NOT bubble back into a "Sign-in failed" toast.
        try {
          onSignedIn?.();
        } catch (callbackErr) {
          console.error(
            "onSignedIn callback threw:",
            callbackErr instanceof Error
              ? callbackErr.message
              : String(callbackErr),
          );
        }
      }
    } catch (err) {
      console.error(
        `${isSignUp ? "Sign-up" : "Sign-in"} failed:`,
        err instanceof Error ? err.message : String(err),
      );
      if (epoch !== requestEpoch || unmounted) return;
      setState({
        pending: false,
        error: isSignUp ? GENERIC_SIGNUP_ERROR : GENERIC_PASSWORD_ERROR,
        ...captured,
      });
    }
  }

  function bindEvents(): void {
    dialog
      .querySelector<HTMLButtonElement>("#geoglowsSignInClose")
      ?.addEventListener("click", () => close());

    dialog
      .querySelector<HTMLButtonElement>("#geoglowsSignInGoogle")
      ?.addEventListener("click", () => {
        void handleOAuth("google");
      });

    dialog
      .querySelector<HTMLButtonElement>("#geoglowsSignInGithub")
      ?.addEventListener("click", () => {
        void handleOAuth("github");
      });

    dialog
      .querySelector<HTMLFormElement>("#geoglowsSignInForm")
      ?.addEventListener("submit", (e) => {
        e.preventDefault();
        const formEl = e.currentTarget;
        if (formEl instanceof HTMLFormElement) {
          void handlePasswordSubmit(formEl);
        }
      });

    dialog
      .querySelector<HTMLButtonElement>("#geoglowsSignInToggleMode")
      ?.addEventListener("click", () => {
        // Capture typed values so toggling sign-in <-> sign-up doesn't lose them.
        const captured = captureFormValues();
        setState({
          view: state.view === "signUp" ? "signIn" : "signUp",
          error: null,
          ...captured,
        });
      });

    dialog
      .querySelector<HTMLButtonElement>("#geoglowsSignInBackToForm")
      ?.addEventListener("click", () => {
        setState({ view: "signIn", error: null });
      });
  }

  // Close on backdrop click. Native <dialog> doesn't do this for us.
  function handleBackdropClick(e: MouseEvent): void {
    if (e.target === dialog) close();
  }
  dialog.addEventListener("click", handleBackdropClick);

  // Reset state on close (Escape key or programmatic close).
  function handleClose(): void {
    requestEpoch++;
    state = { ...INITIAL_STATE };
    // Re-render so DOM and state stay aligned for the next open().
    dialog.innerHTML = renderBody(state, allowSignUp);
    bindEvents();
  }
  dialog.addEventListener("close", handleClose);

  // Initial render
  dialog.innerHTML = renderBody(state, allowSignUp);
  bindEvents();

  return {
    open,
    close(): void {
      assertMounted();
      close();
    },
    unmount(): void {
      if (unmounted) return;
      unmounted = true;
      requestEpoch++;
      dialog.removeEventListener("click", handleBackdropClick);
      dialog.removeEventListener("close", handleClose);
      if (dialog.open) dialog.close();
      dialog.remove();
    },
  };
}

interface CapturedFormValues {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}

function readFormValues(form: HTMLFormElement): CapturedFormValues {
  const read = (name: string): string => {
    const el = form.querySelector(`input[name="${name}"]`);
    return el instanceof HTMLInputElement ? el.value : "";
  };
  return {
    email: read("email").trim(),
    password: read("password"),
    firstName: read("first_name").trim(),
    lastName: read("last_name").trim(),
  };
}

function renderBody(state: ModalState, allowSignUp: boolean): string {
  if (state.view === "signUpSent") {
    return `
      <div class="geoglows-signin-confirmation">
        <h2 class="geoglows-signin-title">Check your email</h2>
        <p class="geoglows-signin-confirmation-text">
          If this email is new, we sent a confirmation link. Click it to finish
          creating your account. If you already have an account, try signing in.
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

  const isSignUp = state.view === "signUp";
  const errorBlock = state.error
    ? `<p role="alert" aria-live="polite" class="geoglows-signin-error">${escapeHtml(state.error)}</p>`
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
            value="${escapeHtml(state.firstName)}"
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
            value="${escapeHtml(state.lastName)}"
            ${state.pending ? "disabled" : ""}
            required
          />
        </div>
      </div>
    `
    : "";

  const toggle = allowSignUp
    ? `
      <p class="geoglows-signin-toggle-text">
        ${
          isSignUp
            ? `Already have an account? <button type="button" id="geoglowsSignInToggleMode" class="geoglows-signin-toggle-button" ${state.pending ? "disabled" : ""}>Sign in</button>`
            : `New here? <button type="button" id="geoglowsSignInToggleMode" class="geoglows-signin-toggle-button" ${state.pending ? "disabled" : ""}>Create an account</button>`
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
            value="${escapeHtml(state.email)}"
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
