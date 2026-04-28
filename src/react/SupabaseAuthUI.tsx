import {
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import type {
  AuthUser,
  SupabaseAuthAdapter,
  SupabaseAuthMode,
} from "../types";
import { useAuth } from "./AuthProvider";

export type { SupabaseAuthMode };

export interface SupabaseAuthUIProps {
  adapter: SupabaseAuthAdapter;
  /**
   * Lock the form to a single sign-in method. When omitted, both password
   * and magic-link options are rendered with an inline toggle.
   */
  mode?: SupabaseAuthMode;
  onSuccess?: (user: AuthUser) => void;
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
  containerStyle?: CSSProperties;
}

const styles = {
  container: {
    padding: 24,
    maxWidth: 360,
    fontFamily: "system-ui, sans-serif",
  },
  heading: { fontSize: 18, fontWeight: 600, margin: "0 0 12px" },
  field: { display: "flex", flexDirection: "column", marginBottom: 12 },
  label: { fontSize: 13, marginBottom: 4 },
  input: {
    padding: 8,
    fontSize: 14,
    border: "1px solid #ccc",
    borderRadius: 4,
  },
  button: {
    padding: "8px 16px",
    fontSize: 14,
    cursor: "pointer",
    border: "1px solid #444",
    borderRadius: 4,
    background: "#fff",
  },
  error: { color: "#c00", fontSize: 13, marginBottom: 8 },
  toggleRow: { fontSize: 13, marginTop: 12 },
  toggleButton: {
    background: "none",
    border: "none",
    color: "#0066cc",
    cursor: "pointer",
    padding: 0,
    font: "inherit",
    textDecoration: "underline",
  },
  confirmation: {
    fontSize: 14,
    padding: 12,
    border: "1px solid #ccc",
    borderRadius: 4,
    background: "#f6f6f6",
  },
} as const satisfies Record<string, CSSProperties>;

const DEFAULT_MAGIC_LINK_MESSAGE = "Check your email for the sign-in link.";

export function SupabaseAuthUI({
  adapter,
  mode,
  onSuccess,
  onError,
  magicLinkRedirectTo,
  magicLinkSentMessage,
  containerStyle,
}: SupabaseAuthUIProps) {
  const { refresh } = useAuth();
  // `activeMode` is only consulted in toggle mode (when `mode` is omitted).
  const [activeMode, setActiveMode] = useState<SupabaseAuthMode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [magicLinkSent, setMagicLinkSent] = useState(false);

  const isModeLocked = mode !== undefined;
  const currentMode = mode ?? activeMode;

  function switchMode(next: SupabaseAuthMode) {
    setActiveMode(next);
    setErrorMessage(null);
    setPassword("");
    setMagicLinkSent(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
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
          console.error(
            "AuthProvider refresh failed after sign-in:",
            refreshError,
          );
        }
        onSuccess?.(user);
      } else {
        await adapter.signInWithMagicLink({
          email: trimmedEmail,
          redirectTo: magicLinkRedirectTo,
        });
        setMagicLinkSent(true);
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setErrorMessage(error.message);
      onError?.(error);
      // Clear the password so a failed value doesn't linger in state.
      // Email is preserved so the user only re-types the password.
      if (currentMode === "password") setPassword("");
    } finally {
      setPending(false);
    }
  }

  if (currentMode === "magicLink" && magicLinkSent) {
    return (
      <div style={{ ...styles.container, ...containerStyle }}>
        <p style={styles.confirmation} role="status">
          {magicLinkSentMessage ?? DEFAULT_MAGIC_LINK_MESSAGE}
        </p>
        {!isModeLocked && (
          <p style={styles.toggleRow}>
            <button
              type="button"
              style={styles.toggleButton}
              onClick={() => switchMode("password")}
            >
              Use a password instead
            </button>
          </p>
        )}
      </div>
    );
  }

  return (
    <div style={{ ...styles.container, ...containerStyle }}>
      <h2 style={styles.heading}>Sign in</h2>
      <form onSubmit={handleSubmit} noValidate>
        {errorMessage && (
          <p style={styles.error} role="alert" aria-live="polite">
            {errorMessage}
          </p>
        )}
        <div style={styles.field}>
          <label htmlFor="geoglows-auth-email" style={styles.label}>
            Email
          </label>
          <input
            id="geoglows-auth-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={pending}
            style={styles.input}
            required
          />
        </div>
        {currentMode === "password" && (
          <div style={styles.field}>
            <label htmlFor="geoglows-auth-password" style={styles.label}>
              Password
            </label>
            <input
              id="geoglows-auth-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={pending}
              style={styles.input}
              required
            />
          </div>
        )}
        <button type="submit" disabled={pending} style={styles.button}>
          {pending
            ? "Signing in…"
            : currentMode === "password"
              ? "Sign in"
              : "Send sign-in link"}
        </button>
      </form>
      {!isModeLocked && (
        <p style={styles.toggleRow}>
          {currentMode === "password" ? (
            <button
              type="button"
              style={styles.toggleButton}
              onClick={() => switchMode("magicLink")}
            >
              Sign in with a magic link instead
            </button>
          ) : (
            <button
              type="button"
              style={styles.toggleButton}
              onClick={() => switchMode("password")}
            >
              Sign in with a password instead
            </button>
          )}
        </p>
      )}
    </div>
  );
}
