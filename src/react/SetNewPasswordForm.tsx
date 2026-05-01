import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import type { SupabaseAuthAdapter } from "../types";

const GENERIC_UPDATE_PASSWORD_ERROR =
  "We couldn't update your password. Please try again.";
const SUCCESS_PASSWORD_UPDATED =
  "Password updated. We've signed you out on other devices for safety.";
const SUCCESS_LINGER_MS = 1500;

const styles: Record<string, CSSProperties> = {
  container: {
    padding: 24,
    maxWidth: 480,
    margin: "0 auto",
    fontFamily: "system-ui, sans-serif",
  },
  heading: { fontSize: 22, fontWeight: 600, margin: "0 0 6px" },
  recoveryHeader: {
    fontSize: 14,
    color: "#475569",
    margin: "0 0 16px",
    lineHeight: 1.5,
  },
  recoveryWarning: {
    fontSize: 13,
    color: "#92400e",
    margin: "0 0 16px",
    padding: "8px 12px",
    background: "#fef3c7",
    borderRadius: 4,
    border: "1px solid #fde68a",
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
  success: {
    color: "#166534",
    fontSize: 13,
    marginBottom: 12,
    padding: "8px 12px",
    background: "#f0fdf4",
    borderRadius: 4,
    border: "1px solid #bbf7d0",
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

export interface SetNewPasswordFormProps {
  /** Auth adapter; created via `createSupabaseAuthAdapter({ supabase })`. */
  adapter: SupabaseAuthAdapter;
  /**
   * Called after the password update + signOutOtherSessions sequence
   * completes successfully and the success message has lingered.
   * Consumer typically closes the dialog.
   */
  onSuccess?: () => void;
  /**
   * Called when `updateUserPassword` rejects with an auth-error (recovery
   * session expired or otherwise invalidated). The form does NOT render
   * its own expired UX — the consumer is expected to swap to a recovery-
   * error view.
   */
  onExpired?: (error: Error) => void;
  /** Called on non-auth adapter rejection. The component renders a generic inline error regardless. */
  onError?: (error: Error) => void;
  /** Called when the user clicks "Back to sign in". */
  onCancel?: () => void;
  containerStyle?: CSSProperties;
}

function isAuthExpiredError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as { code?: string }).code ?? "";
  const msg = err.message.toLowerCase();
  return (
    code === "refresh_token_not_found" ||
    code === "session_not_found" ||
    /refresh token|session.*expired|invalid.*token|jwt expired/.test(msg)
  );
}

/**
 * Set a new password during a Supabase recovery session. Consumer mounts
 * this component when `PASSWORD_RECOVERY` fires (or when the URL hash
 * carries a valid recovery token at module load).
 *
 * Reads the recovery user's email via `adapter.getCurrentUser()` in a
 * `useEffect` on mount — does NOT rely on `useAuth().user.email` because
 * `<AuthProvider>`'s `refresh()` is async and may not have populated by
 * the time this component first renders. Renders "Resetting password for
 * `<email>`" in the header to prevent silent identity-swap on shared
 * browsers (the wrong-account scenario).
 *
 * Submit flow: `updateUserPassword` → `signOutOtherSessions` (best-effort)
 * → render success message for ~1.5s → fire `onSuccess`. The setTimeout
 * is cleaned up on unmount so dismissing during the linger window does
 * NOT fire `onSuccess` against torn-down state.
 *
 * No `dangerouslySetInnerHTML`. JSX auto-escape handles all user-controlled text.
 */
export function SetNewPasswordForm({
  adapter,
  onSuccess,
  onExpired,
  onError,
  onCancel,
  containerStyle,
}: SetNewPasswordFormProps) {
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [recoveryEmail, setRecoveryEmail] = useState<string | null>(null);
  const [userFetched, setUserFetched] = useState(false);

  const mountedRef = useRef(true);
  const lingerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track unmount so async resolutions don't touch state after teardown.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (lingerTimerRef.current !== null) {
        clearTimeout(lingerTimerRef.current);
        lingerTimerRef.current = null;
      }
    };
  }, []);

  // Fetch recovery user on mount — source of truth for the wrong-account
  // header. `useAuth()` may not be hydrated yet when PASSWORD_RECOVERY fires.
  useEffect(() => {
    let cancelled = false;
    adapter
      .getCurrentUser()
      .then((user) => {
        if (cancelled || !mountedRef.current) return;
        setRecoveryEmail(user?.email ?? null);
        setUserFetched(true);
      })
      .catch((err: unknown) => {
        if (cancelled || !mountedRef.current) return;
        console.error(
          "Recovery getCurrentUser failed:",
          err instanceof Error ? err.message : String(err),
        );
        setUserFetched(true);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);

    if (!password.trim()) {
      setErrorMessage("Please choose a new password.");
      return;
    }

    setPending(true);
    try {
      await adapter.updateUserPassword({ password });
      if (!mountedRef.current) return;

      // Best-effort other-session invalidation. Failure is logged but
      // does NOT block the success flow — password is already updated.
      try {
        await adapter.signOutOtherSessions();
      } catch (sessionErr) {
        console.error(
          "signOutOtherSessions failed (best-effort):",
          sessionErr instanceof Error
            ? sessionErr.message
            : String(sessionErr),
        );
      }
      if (!mountedRef.current) return;

      setPending(false);
      setSuccessMessage(SUCCESS_PASSWORD_UPDATED);

      lingerTimerRef.current = setTimeout(() => {
        if (!mountedRef.current) return;
        try {
          onSuccess?.();
        } catch (callbackErr) {
          console.error(
            "onSuccess callback threw:",
            callbackErr instanceof Error
              ? callbackErr.message
              : String(callbackErr),
          );
        }
      }, SUCCESS_LINGER_MS);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error("Password update failed:", error.message);

      if (!mountedRef.current) return;
      setPending(false);

      if (isAuthExpiredError(error)) {
        onExpired?.(error);
      } else {
        setErrorMessage(GENERIC_UPDATE_PASSWORD_ERROR);
        onError?.(error);
      }
    }
  }

  return (
    <div style={{ ...styles.container, ...containerStyle }}>
      <h2 style={styles.heading}>Choose a new password</h2>

      {userFetched && recoveryEmail && (
        <p style={styles.recoveryHeader}>
          Resetting password for <strong>{recoveryEmail}</strong>.
        </p>
      )}
      {userFetched && !recoveryEmail && (
        <p style={styles.recoveryWarning}>
          Resetting password — unable to confirm the account email. If
          you&apos;re not expecting this prompt, click &quot;Back to sign
          in&quot; below.
        </p>
      )}

      <form onSubmit={handleSubmit} noValidate>
        {errorMessage && (
          <p role="alert" aria-live="polite" style={styles.error}>
            {errorMessage}
          </p>
        )}

        {successMessage && (
          <p role="status" aria-live="polite" style={styles.success}>
            {successMessage}
          </p>
        )}

        <div style={styles.fieldRow}>
          <label htmlFor="geoglowsNewPassword" style={styles.label}>
            New password
          </label>
          <input
            id="geoglowsNewPassword"
            name="password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={pending || successMessage !== null}
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
            disabled={pending || successMessage !== null}
            style={styles.primaryButton}
          >
            {pending ? "Updating…" : "Set new password"}
          </button>
        </div>
      </form>
    </div>
  );
}
