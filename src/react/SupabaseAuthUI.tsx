import {
  useEffect,
  useState,
  type FormEvent,
} from "react";
import type {
  AuthUser,
  SupabaseAuthAdapter,
  SupabaseAuthMode,
} from "../types";
import { useAuth } from "./AuthProvider";
import { sanitizeHref } from "../core/escape";

export type { SupabaseAuthMode };

/**
 * Props common to both sign-up-enabled and sign-up-disabled configurations.
 * Discriminated below to make `emailRedirectTo` required-when-`allowSignUp`
 * (default `true`) so consumers can't silently land sign-up confirmations
 * on the wrong origin.
 */
interface BaseSupabaseAuthUIProps {
  adapter: SupabaseAuthAdapter;
  /**
   * Lock the form to a single sign-in method. When omitted, both password
   * and magic-link options are rendered with an inline toggle.
   */
  mode?: SupabaseAuthMode;
  /**
   * Fires only after a successful **password** sign-in, with the resulting
   * `AuthUser`. Magic-link mode does **not** fire this callback — the user
   * completes that flow in a separate browser context.
   */
  onSuccess?: (user: AuthUser) => void;
  /**
   * Fires after any failed sign-in, sign-up, or OAuth attempt with the raw
   * `Error` from the adapter. The visible error message rendered by the form
   * is intentionally generic (to prevent account enumeration); use this
   * callback for logging or telemetry.
   */
  onError?: (error: Error) => void;
  /**
   * Forwarded to `adapter.signInWithMagicLink` so Supabase knows where to
   * send the user after they click the email link.
   */
  magicLinkRedirectTo?: string;
  /**
   * Message displayed after a successful magic-link request. Defaults to
   * "Check your email for the sign-in link."
   */
  magicLinkSentMessage?: string;
  /**
   * Optional callback for the "Forgot password?" link rendered below the
   * password input in `password` mode. When provided, the link renders;
   * the consumer is responsible for switching to its own password-reset
   * view (e.g., mounting `<PasswordResetForm>`).
   *
   * Not rendered in `magicLink` mode — recovery is a password-flow concept.
   */
  onForgotPasswordClick?: () => void;
  /**
   * When provided, the modal header renders a close (×) button that fires
   * this callback. Without `onClose`, no close button is rendered (consumers
   * may provide their own outer close affordance, e.g., a `<dialog>` with
   * Escape + backdrop close).
   *
   * The lib does NOT call any kind of `dialog.close()` itself — `onClose` is
   * the only side-effect of clicking the X. This contract lets consumers
   * (like aquiferx) keep their existing outer-`<dialog>` close-event cleanup
   * paths working: lib X → onClose → consumer toggles state → consumer
   * effect calls `dialog.close()` → close event fires → cleanup runs.
   */
  onClose?: () => void;
  /**
   * Where OAuth providers redirect back to. Defaults to
   * `window.location.origin`. Sanitized via `sanitizeHref` before forwarding;
   * dangerous schemes (`javascript:`, `data:`, `vbscript:`) fall back to
   * `window.location.origin` with a console warning. Must be on the
   * project's Supabase Auth → Redirect URLs allowlist.
   */
  oauthRedirectTo?: string;
}

/**
 * Sign-up enabled (default). `emailRedirectTo` is required so that
 * sign-up email confirmation lands on a deliberately-chosen URL — silent
 * fallback to `window.location.origin` would land sub-app sign-ups on the
 * wrong origin (a sub-app with no profile-completion UI).
 */
interface SignUpEnabledProps {
  allowSignUp?: true;
  /**
   * Where the email-confirmation link (sign-up) redirects to. Required
   * when `allowSignUp` is `true` (or omitted, since the default is `true`).
   * Sanitized via `sanitizeHref` before forwarding.
   */
  emailRedirectTo: string;
}

interface SignUpDisabledProps {
  allowSignUp: false;
  emailRedirectTo?: never;
}

export type SupabaseAuthUIProps = BaseSupabaseAuthUIProps &
  (SignUpEnabledProps | SignUpDisabledProps);

// `DEFAULT_` = fallback when the consumer omits the matching prop.
// `GENERIC_` = intentionally vague to prevent account enumeration; the raw
// error is still passed to the consumer's `onError` handler for logging or
// non-visible diagnostics.
const DEFAULT_MAGIC_LINK_MESSAGE = "Check your email for the sign-in link.";
const GENERIC_PASSWORD_ERROR =
  "Sign-in failed. Please check your email and password and try again.";
const GENERIC_MAGIC_LINK_ERROR =
  "We couldn't send the sign-in link. Please try again.";
const GENERIC_SIGNUP_ERROR =
  "We couldn't create your account. Please try again.";
const GENERIC_OAUTH_ERROR =
  "We couldn't start the sign-in flow. Please try again.";
const SIGNUP_SENT_BODY =
  "If this email is new, we sent a confirmation link. Click it to finish creating your account. Confirm in the portal, then return here to sign in.";

type View = "signIn" | "signUp" | "signUpSent" | "magicLinkSent";
type OauthProvider = "google" | "github";

function safeRedirect(value: string | undefined, label: string): string {
  if (value === undefined) return window.location.origin;
  const sanitized = sanitizeHref(value);
  if (sanitized === null) {
    console.warn(
      `[SupabaseAuthUI] ${label} rejected (dangerous scheme); falling back to window.location.origin`,
    );
    return window.location.origin;
  }
  return sanitized;
}

const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
    <path
      fill="#4285F4"
      d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"
    />
    <path
      fill="#34A853"
      d="M9 18c2.43 0 4.47-.81 5.96-2.18l-2.92-2.26c-.8.54-1.83.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.34A9 9 0 0 0 9 18z"
    />
    <path
      fill="#FBBC05"
      d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.94H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.06l3.01-2.34z"
    />
    <path
      fill="#EA4335"
      d="M9 3.58c1.32 0 2.5.46 3.44 1.35l2.58-2.58A9 9 0 0 0 9 0 9 9 0 0 0 .96 4.94L3.97 7.28C4.68 5.16 6.66 3.58 9 3.58z"
    />
  </svg>
);

const GitHubIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 16 16"
    aria-hidden="true"
    fill="currentColor"
  >
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
  </svg>
);

interface CloseButtonProps {
  onClose: () => void;
}

const CloseButton = ({ onClose }: CloseButtonProps) => (
  <button
    type="button"
    aria-label="Close"
    className="geoglows-signin-close"
    onClick={onClose}
  >
    ×
  </button>
);

export function SupabaseAuthUI(props: SupabaseAuthUIProps) {
  const {
    adapter,
    mode,
    onSuccess,
    onError,
    onForgotPasswordClick,
    onClose,
    magicLinkRedirectTo,
    magicLinkSentMessage,
    oauthRedirectTo,
  } = props;
  // Default `allowSignUp` is true (matches vanilla). Discriminated union
  // ensures `emailRedirectTo` is provided whenever sign-up is enabled.
  const allowSignUp = props.allowSignUp !== false;
  const emailRedirectTo =
    props.allowSignUp === false ? undefined : props.emailRedirectTo;

  const { refresh } = useAuth();
  const [view, setView] = useState<View>("signIn");
  const [magicLinkActive, setMagicLinkActive] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [pending, setPending] = useState(false);
  const [oauthPending, setOauthPending] = useState<OauthProvider | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isModeLocked = mode !== undefined;
  const currentMode: SupabaseAuthMode = mode ?? (magicLinkActive ? "magicLink" : "password");

  // pageshow fires when the page is restored from bfcache (e.g., user clicked
  // OAuth → went to provider → hit browser back). Reset OAuth pending state
  // so the buttons aren't stuck disabled after an aborted OAuth attempt.
  useEffect(() => {
    function handlePageShow() {
      setOauthPending(null);
    }
    window.addEventListener("pageshow", handlePageShow);
    return () => window.removeEventListener("pageshow", handlePageShow);
  }, []);

  function switchToMagicLink() {
    setMagicLinkActive(true);
    setErrorMessage(null);
    setPassword("");
  }

  function switchToPassword() {
    setMagicLinkActive(false);
    setErrorMessage(null);
    setView("signIn");
  }

  function switchToSignUp() {
    setView("signUp");
    setMagicLinkActive(false);
    setErrorMessage(null);
    setPassword("");
  }

  function backToSignIn() {
    // From signUpSent: preserve the sign-up email so the user can sign in
    // immediately if they confirmed in another tab.
    setView("signIn");
    setMagicLinkActive(false);
    setErrorMessage(null);
    setPassword("");
    setFirstName("");
    setLastName("");
  }

  function backFromSignUp() {
    setView("signIn");
    setErrorMessage(null);
    setFirstName("");
    setLastName("");
    setPassword("");
  }

  function useDifferentEmailMagicLink() {
    setView("signIn");
    setMagicLinkActive(true);
    setErrorMessage(null);
    setEmail("");
  }

  async function handleOAuth(provider: OauthProvider) {
    setErrorMessage(null);
    setOauthPending(provider);
    const safe = safeRedirect(oauthRedirectTo, "oauthRedirectTo");
    try {
      await adapter.signInWithOAuth({ provider, redirectTo: safe });
      // On success, the page navigates away (Supabase JS calls
      // window.location.assign). Pending state is reset on `pageshow` if the
      // user comes back via browser-back.
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setOauthPending(null);
      setErrorMessage(GENERIC_OAUTH_ERROR);
      onError?.(error);
    }
  }

  async function handleSignInSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setErrorMessage("Please enter your email address.");
      return;
    }
    if (currentMode === "password" && !password.trim()) {
      setErrorMessage("Please enter your password.");
      return;
    }

    setPending(true);
    try {
      if (currentMode === "password") {
        const user = await adapter.signInWithPassword({
          email: trimmedEmail,
          password,
        });
        try {
          await refresh();
        } catch (refreshError) {
          const message =
            refreshError instanceof Error
              ? refreshError.message
              : String(refreshError);
          console.error("AuthProvider refresh failed after sign-in:", message);
        }
        onSuccess?.(user);
      } else {
        await adapter.signInWithMagicLink({
          email: trimmedEmail,
          redirectTo: magicLinkRedirectTo,
        });
        setView("magicLinkSent");
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setErrorMessage(
        currentMode === "password"
          ? GENERIC_PASSWORD_ERROR
          : GENERIC_MAGIC_LINK_ERROR,
      );
      onError?.(error);
      // Clear the password so a failed value doesn't linger.
      if (currentMode === "password") setPassword("");
    } finally {
      setPending(false);
    }
  }

  async function handleSignUpSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);

    const trimmedEmail = email.trim();
    const trimmedFirstName = firstName.trim();
    const trimmedLastName = lastName.trim();

    if (!trimmedFirstName) {
      setErrorMessage("Please enter your first name.");
      return;
    }
    if (!trimmedLastName) {
      setErrorMessage("Please enter your last name.");
      return;
    }
    if (!trimmedEmail) {
      setErrorMessage("Please enter your email address.");
      return;
    }
    if (!password.trim()) {
      setErrorMessage("Please enter a password.");
      return;
    }

    setPending(true);
    try {
      const safe = safeRedirect(emailRedirectTo, "emailRedirectTo");
      await adapter.signUpWithPassword({
        email: trimmedEmail,
        password,
        emailRedirectTo: safe,
        metadata: {
          first_name: trimmedFirstName,
          last_name: trimmedLastName,
        },
      });
      setView("signUpSent");
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setErrorMessage(GENERIC_SIGNUP_ERROR);
      onError?.(error);
      setPassword("");
    } finally {
      setPending(false);
    }
  }

  if (view === "signUpSent") {
    return (
      <div className="geoglows-signin-confirmation">
        <div className="geoglows-signin-header">
          <h2 className="geoglows-signin-title">Check your email</h2>
          {onClose && <CloseButton onClose={onClose} />}
        </div>
        <p className="geoglows-signin-confirmation-text" role="status">
          {SIGNUP_SENT_BODY}
        </p>
        <button
          type="button"
          className="geoglows-signin-confirmation-back"
          onClick={backToSignIn}
        >
          Back to sign in
        </button>
      </div>
    );
  }

  if (view === "magicLinkSent") {
    return (
      <div className="geoglows-signin-confirmation">
        <div className="geoglows-signin-header">
          <h2 className="geoglows-signin-title">Check your email</h2>
          {onClose && <CloseButton onClose={onClose} />}
        </div>
        <p className="geoglows-signin-confirmation-text" role="status">
          {magicLinkSentMessage ?? DEFAULT_MAGIC_LINK_MESSAGE}
        </p>
        <button
          type="button"
          className="geoglows-signin-confirmation-back"
          onClick={useDifferentEmailMagicLink}
        >
          Use a different email address
        </button>
        {!isModeLocked && (
          <p className="geoglows-signin-toggle-text">
            <button
              type="button"
              className="geoglows-signin-toggle-button"
              onClick={() => {
                setView("signIn");
                setMagicLinkActive(false);
                setErrorMessage(null);
              }}
            >
              Use a password instead
            </button>
          </p>
        )}
      </div>
    );
  }

  if (view === "signUp") {
    return (
      <div className="geoglows-signin-content">
        <div className="geoglows-signin-header">
          <h2 className="geoglows-signin-title">Create your account</h2>
          {onClose && <CloseButton onClose={onClose} />}
        </div>
        <p className="geoglows-signin-toggle-text" style={{ textAlign: "left", marginTop: 0, marginBottom: "0.75rem" }}>
          <button
            type="button"
            className="geoglows-signin-toggle-button"
            onClick={backFromSignUp}
            disabled={pending}
          >
            ← Back
          </button>
        </p>
        {errorMessage && (
          <p
            role="alert"
            aria-live="polite"
            className="geoglows-signin-error"
          >
            {errorMessage}
          </p>
        )}
        <form onSubmit={handleSignUpSubmit} noValidate className="geoglows-signin-form">
          <div className="geoglows-signin-name-grid">
            <div className="geoglows-signin-field">
              <label htmlFor="geoglows-auth-first-name" className="geoglows-signin-label">
                First name
              </label>
              <input
                id="geoglows-auth-first-name"
                type="text"
                autoComplete="given-name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                disabled={pending}
                className="geoglows-signin-input"
                required
                autoFocus
              />
            </div>
            <div className="geoglows-signin-field">
              <label htmlFor="geoglows-auth-last-name" className="geoglows-signin-label">
                Last name
              </label>
              <input
                id="geoglows-auth-last-name"
                type="text"
                autoComplete="family-name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                disabled={pending}
                className="geoglows-signin-input"
                required
              />
            </div>
          </div>
          <div className="geoglows-signin-field">
            <label htmlFor="geoglows-auth-email" className="geoglows-signin-label">
              Email
            </label>
            <input
              id="geoglows-auth-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={pending}
              className="geoglows-signin-input"
              required
            />
          </div>
          <div className="geoglows-signin-field">
            <label htmlFor="geoglows-auth-password" className="geoglows-signin-label">
              Password
            </label>
            <input
              id="geoglows-auth-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={pending}
              className="geoglows-signin-input"
              required
            />
          </div>
          <button
            type="submit"
            disabled={pending}
            className="geoglows-signin-submit"
          >
            {pending ? "Creating account…" : "Create account"}
          </button>
        </form>
        <p className="geoglows-signin-toggle-text">
          Already have an account?{" "}
          <button
            type="button"
            className="geoglows-signin-toggle-button"
            onClick={backFromSignUp}
            disabled={pending}
          >
            Sign in
          </button>
        </p>
      </div>
    );
  }

  // signIn view (default)
  const showOAuth =
    currentMode === "password" || (currentMode === "magicLink" && !isModeLocked);
  const showSignUpToggle = allowSignUp && mode !== "magicLink";

  return (
    <div className="geoglows-signin-content">
      <div className="geoglows-signin-header">
        <h2 className="geoglows-signin-title">Sign in</h2>
        {onClose && <CloseButton onClose={onClose} />}
      </div>

      {errorMessage && (
        <p
          role="alert"
          aria-live="polite"
          className="geoglows-signin-error"
        >
          {errorMessage}
        </p>
      )}

      {showOAuth && (
        <>
          <div className="geoglows-signin-providers">
            <button
              type="button"
              className="geoglows-signin-provider-button"
              onClick={() => handleOAuth("google")}
              disabled={pending || oauthPending !== null}
            >
              <GoogleIcon />
              {oauthPending === "google" ? "Signing in…" : "Continue with Google"}
            </button>
            <button
              type="button"
              className="geoglows-signin-provider-button"
              onClick={() => handleOAuth("github")}
              disabled={pending || oauthPending !== null}
            >
              <GitHubIcon />
              {oauthPending === "github" ? "Signing in…" : "Continue with GitHub"}
            </button>
          </div>
          <div className="geoglows-signin-divider">
            <span className="geoglows-signin-divider-label">or with email</span>
          </div>
        </>
      )}

      <form onSubmit={handleSignInSubmit} noValidate className="geoglows-signin-form">
        <div className="geoglows-signin-field">
          <label htmlFor="geoglows-auth-email" className="geoglows-signin-label">
            Email
          </label>
          <input
            id="geoglows-auth-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={pending}
            className="geoglows-signin-input"
            required
          />
        </div>
        {currentMode === "password" && (
          <div className="geoglows-signin-field">
            <label htmlFor="geoglows-auth-password" className="geoglows-signin-label">
              Password
            </label>
            <input
              id="geoglows-auth-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={pending}
              className="geoglows-signin-input"
              required
            />
            {onForgotPasswordClick && (
              <p className="geoglows-signin-toggle-text geoglows-signin-forgot-row">
                <button
                  type="button"
                  className="geoglows-signin-toggle-button geoglows-signin-forgot-link"
                  onClick={onForgotPasswordClick}
                  disabled={pending}
                >
                  Forgot password?
                </button>
              </p>
            )}
          </div>
        )}
        <button
          type="submit"
          disabled={pending}
          className="geoglows-signin-submit"
        >
          {pending
            ? currentMode === "password"
              ? "Signing in…"
              : "Sending link…"
            : currentMode === "password"
              ? "Sign in"
              : "Send sign-in link"}
        </button>
      </form>

      {!isModeLocked && (
        <p className="geoglows-signin-toggle-text">
          {currentMode === "password" ? (
            <button
              type="button"
              className="geoglows-signin-toggle-button"
              onClick={switchToMagicLink}
            >
              Sign in with a magic link instead
            </button>
          ) : (
            <button
              type="button"
              className="geoglows-signin-toggle-button"
              onClick={switchToPassword}
            >
              Sign in with a password instead
            </button>
          )}
        </p>
      )}

      {showSignUpToggle && (
        <p className="geoglows-signin-toggle-text">
          New here?{" "}
          <button
            type="button"
            className="geoglows-signin-toggle-button"
            onClick={switchToSignUp}
            disabled={pending}
          >
            Create an account
          </button>
        </p>
      )}
    </div>
  );
}
