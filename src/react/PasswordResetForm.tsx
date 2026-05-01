import { useState, type CSSProperties, type FormEvent } from "react";
import type { SupabaseAuthAdapter } from "../types";

const GENERIC_RESET_ERROR =
  "We couldn't send the reset link. Please try again.";

const styles: Record<string, CSSProperties> = {
  container: {
    padding: 24,
    maxWidth: 480,
    margin: "0 auto",
    fontFamily: "system-ui, sans-serif",
  },
  heading: { fontSize: 22, fontWeight: 600, margin: "0 0 6px" },
  intro: {
    fontSize: 14,
    color: "#475569",
    margin: "0 0 20px",
    lineHeight: 1.5,
  },
  fieldRow: { marginBottom: 16 },
  label: {
    display: "block",
    fontSize: 13,
    fontWeight: 500,
    color: "#475569",
    marginBottom: 4,
  },
  input: {
    width: "100%",
    padding: "8px 12px",
    fontSize: 14,
    border: "1px solid #cbd5e1",
    borderRadius: 4,
    boxSizing: "border-box",
  },
  error: {
    color: "#c00",
    fontSize: 13,
    marginBottom: 12,
    padding: "8px 12px",
    background: "#fee",
    borderRadius: 4,
    border: "1px solid #fcc",
  },
  buttonRow: {
    display: "flex",
    gap: 8,
    justifyContent: "flex-end",
    marginTop: 16,
  },
  primaryButton: {
    padding: "10px 20px",
    fontSize: 14,
    fontWeight: 500,
    cursor: "pointer",
    border: "1px solid #2563eb",
    borderRadius: 4,
    background: "#2563eb",
    color: "#fff",
  },
  secondaryButton: {
    padding: "10px 20px",
    fontSize: 14,
    fontWeight: 500,
    cursor: "pointer",
    border: "1px solid #cbd5e1",
    borderRadius: 4,
    background: "#fff",
    color: "#475569",
  },
};

export interface PasswordResetFormProps {
  /** Auth adapter; created via `createSupabaseAuthAdapter({ supabase })`. */
  adapter: SupabaseAuthAdapter;
  /**
   * Where the recovery email link redirects to. Defaults to the adapter's
   * `defaultRedirectTo` (which is `window.location.origin` in typical
   * configs). Must be on the project's Supabase Redirect URLs allowlist.
   */
  redirectTo?: string;
  /**
   * Called after a successful `resetPasswordForEmail` call. The consumer is
   * responsible for rendering a "check your email" confirmation view —
   * this component does NOT render its own confirmation. Receives the
   * submitted email so consumers can echo it in their confirmation copy.
   */
  onSuccess?: (email: string) => void;
  /** Called on adapter rejection. The component renders a generic inline error regardless. */
  onError?: (error: Error) => void;
  /** Called when the user clicks "Back to sign in". */
  onCancel?: () => void;
  containerStyle?: CSSProperties;
}

/**
 * Request a password-recovery email. Consumer-driven view — this component
 * fires `onSuccess(email)` and the parent is expected to switch to its own
 * "check your email" view (matches the enumeration-resistant pattern from
 * the vanilla 1.2.0 modal).
 *
 * No `dangerouslySetInnerHTML`. All user-controlled text rendered as JSX
 * children → React's auto-escape handles XSS.
 */
export function PasswordResetForm({
  adapter,
  redirectTo,
  onSuccess,
  onError,
  onCancel,
  containerStyle,
}: PasswordResetFormProps) {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);

    const trimmed = email.trim();
    if (!trimmed) {
      setErrorMessage("Please enter your email address.");
      return;
    }

    setPending(true);
    try {
      await adapter.resetPasswordForEmail({
        email: trimmed,
        ...(redirectTo ? { redirectTo } : {}),
      });
      onSuccess?.(trimmed);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error(
        "Password reset failed:",
        error.message,
      );
      setErrorMessage(GENERIC_RESET_ERROR);
      onError?.(error);
    } finally {
      setPending(false);
    }
  }

  return (
    <div style={{ ...styles.container, ...containerStyle }}>
      <h2 style={styles.heading}>Reset your password</h2>
      <p style={styles.intro}>
        Enter the email for your account. We&apos;ll send you a link to
        reset your password.
      </p>

      <form onSubmit={handleSubmit} noValidate>
        {errorMessage && (
          <p role="alert" aria-live="polite" style={styles.error}>
            {errorMessage}
          </p>
        )}

        <div style={styles.fieldRow}>
          <label htmlFor="geoglowsResetEmail" style={styles.label}>
            Email
          </label>
          <input
            id="geoglowsResetEmail"
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={pending}
            required
            style={styles.input}
          />
        </div>

        <div style={styles.buttonRow}>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              disabled={pending}
              style={styles.secondaryButton}
            >
              Back to sign in
            </button>
          )}
          <button
            type="submit"
            disabled={pending}
            style={styles.primaryButton}
          >
            {pending ? "Sending…" : "Send reset link"}
          </button>
        </div>
      </form>
    </div>
  );
}
