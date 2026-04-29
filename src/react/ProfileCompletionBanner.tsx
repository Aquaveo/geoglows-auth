import type { CSSProperties } from "react";
import type { Profile } from "../types";
import { isProfileComplete } from "../core/profile";

const DEFAULT_MESSAGE =
  "Your profile is missing your name. Complete it so others can address you correctly.";
const DEFAULT_CTA_LABEL = "Complete profile";
const DEFAULT_DISMISS_LABEL = "Dismiss";

const styles: Record<string, CSSProperties> = {
  banner: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "12px 16px",
    background: "#fef3c7",
    border: "1px solid #fde68a",
    color: "#78350f",
    borderRadius: 6,
    fontSize: 14,
    fontFamily: "system-ui, sans-serif",
    flexWrap: "wrap",
  },
  message: { flex: 1, minWidth: 200 },
  buttonRow: {
    display: "flex",
    gap: 8,
    flexShrink: 0,
  },
  cta: {
    padding: "6px 14px",
    fontSize: 13,
    fontWeight: 500,
    cursor: "pointer",
    border: "1px solid #b45309",
    borderRadius: 4,
    background: "#b45309",
    color: "#fff",
  },
  dismiss: {
    padding: "6px 14px",
    fontSize: 13,
    fontWeight: 500,
    cursor: "pointer",
    border: "1px solid #d6d3d1",
    borderRadius: 4,
    background: "transparent",
    color: "#78350f",
  },
};

export interface ProfileCompletionBannerProps {
  profile: Profile | null | undefined;
  /** Fired when the user clicks the CTA. Wire this to open the
   *  profile-edit / profile-setup flow. */
  onComplete?: () => void;
  /** Fired when the user clicks Dismiss. Caller is responsible for
   *  hiding the banner if they want; this component does NOT track
   *  session-level dismissal state. */
  onDismiss?: () => void;
  /** Show the dismiss button. Default true. */
  dismissible?: boolean;
  /** Override the default message. */
  message?: string;
  /** Override the default CTA button label. */
  ctaLabel?: string;
  /** Override the default dismiss button label. */
  dismissLabel?: string;
  containerStyle?: CSSProperties;
}

/**
 * Soft, dismissible banner that prompts the user to complete missing
 * required profile fields. Returns null when the profile is complete;
 * otherwise renders an inline alert with a CTA.
 *
 * Pure presentational — does not persist dismissal state. The caller
 * decides whether to keep showing the banner or hide it after dismiss.
 */
export function ProfileCompletionBanner({
  profile,
  onComplete,
  onDismiss,
  dismissible = true,
  message = DEFAULT_MESSAGE,
  ctaLabel = DEFAULT_CTA_LABEL,
  dismissLabel = DEFAULT_DISMISS_LABEL,
  containerStyle,
}: ProfileCompletionBannerProps) {
  // Hide when no profile yet (user not signed in or profile not loaded)
  // and when the profile is already complete.
  if (!profile || isProfileComplete(profile)) return null;

  return (
    <div
      role="alert"
      aria-label="Profile completion reminder"
      style={{ ...styles.banner, ...containerStyle }}
    >
      <span style={styles.message}>{message}</span>
      <span style={styles.buttonRow}>
        {dismissible && (
          <button
            type="button"
            onClick={onDismiss}
            style={styles.dismiss}
          >
            {dismissLabel}
          </button>
        )}
        <button type="button" onClick={onComplete} style={styles.cta}>
          {ctaLabel}
        </button>
      </span>
    </div>
  );
}
