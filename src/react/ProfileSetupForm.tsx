import { useState, type CSSProperties, type FormEvent } from "react";
import type { GeoglowsSupabaseClient, Profile, UserType } from "../types";
import { updateProfile } from "../core/profile";
import {
  ProfileFields,
  EMPTY_PROFILE_FIELDS,
  type ProfileFieldsState,
} from "./ProfileFields";

const GENERIC_SAVE_ERROR =
  "We couldn't save your profile. Please try again.";

const styles: Record<string, CSSProperties> = {
  container: {
    padding: 24,
    maxWidth: 720,
    margin: "0 auto",
    fontFamily: "system-ui, sans-serif",
  },
  heading: { fontSize: 22, fontWeight: 600, margin: "0 0 6px" },
  intro: {
    fontSize: 14,
    color: "#475569",
    margin: "0 0 24px",
    lineHeight: 1.5,
  },
  emailRow: {
    fontSize: 13,
    color: "#475569",
    marginBottom: 16,
    padding: "8px 12px",
    background: "#f1f5f9",
    borderRadius: 4,
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

export interface ProfileSetupFormProps {
  supabase: GeoglowsSupabaseClient;
  /**
   * The user's existing profile row. Required even on first-time setup —
   * `ensureProfile` always creates a row before this form is shown, so
   * the row exists with at least `id`, `email`, and possibly OAuth-supplied
   * `first_name` / `last_name` / `display_name`.
   */
  profile: Profile;
  onSuccess?: (profile: Profile) => void;
  onError?: (error: Error) => void;
  /** Called when the user clicks "Skip for now". Optional — if absent, no skip button is rendered. */
  onSkip?: () => void;
  containerStyle?: CSSProperties;
}

function valuesFromProfile(profile: Profile): ProfileFieldsState {
  return {
    first_name: profile.first_name ?? "",
    middle_name: profile.middle_name ?? "",
    last_name: profile.last_name ?? "",
    phone_number: profile.phone_number ?? "",
    user_type: profile.user_type ?? "",
    address: profile.address ?? "",
    user_link: profile.user_link ?? "",
  };
}

/**
 * Form shown to a user after sign-up so they can fill in the rest of
 * their profile (the auth provider only gives us email and a full name
 * string at best). Shares its field set with `<ProfileEditForm>`.
 *
 * Never displays another user's data — the email shown is the
 * authenticated user's own. Submission goes through `updateProfile`,
 * which respects the `profiles_update_own` RLS policy.
 */
export function ProfileSetupForm({
  supabase,
  profile,
  onSuccess,
  onError,
  onSkip,
  containerStyle,
}: ProfileSetupFormProps) {
  const [values, setValues] = useState<ProfileFieldsState>(
    profile ? valuesFromProfile(profile) : EMPTY_PROFILE_FIELDS,
  );
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);

    if (!values.first_name.trim()) {
      setErrorMessage("Please enter your first name.");
      return;
    }
    if (!values.last_name.trim()) {
      setErrorMessage("Please enter your last name.");
      return;
    }
    if (
      values.user_link &&
      !/^https?:\/\//i.test(values.user_link.trim())
    ) {
      setErrorMessage(
        "Personal link must start with http:// or https://",
      );
      return;
    }

    setPending(true);
    try {
      const updated = await updateProfile(supabase, {
        id: profile.id,
        first_name: values.first_name.trim(),
        middle_name: values.middle_name.trim() || null,
        last_name: values.last_name.trim(),
        phone_number: values.phone_number.trim() || null,
        user_type: (values.user_type || null) as UserType | null,
        address: values.address.trim() || null,
        user_link: values.user_link.trim() || null,
      });
      onSuccess?.(updated);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setErrorMessage(GENERIC_SAVE_ERROR);
      onError?.(error);
    } finally {
      setPending(false);
    }
  }

  return (
    <div style={{ ...styles.container, ...containerStyle }}>
      <h2 style={styles.heading}>Complete your profile</h2>
      <p style={styles.intro}>
        Tell us a bit about yourself. Only your account email is
        required; everything else is optional and stays private to you.
      </p>

      <div style={styles.emailRow}>
        Account email: <strong>{profile.email}</strong>
      </div>

      <form onSubmit={handleSubmit} noValidate>
        {errorMessage && (
          <p role="alert" aria-live="polite" style={styles.error}>
            {errorMessage}
          </p>
        )}

        <ProfileFields
          values={values}
          onChange={setValues}
          disabled={pending}
        />

        <div style={styles.buttonRow}>
          {onSkip && (
            <button
              type="button"
              onClick={onSkip}
              disabled={pending}
              style={styles.secondaryButton}
            >
              Skip for now
            </button>
          )}
          <button
            type="submit"
            disabled={pending}
            style={styles.primaryButton}
          >
            {pending ? "Saving…" : "Save and continue"}
          </button>
        </div>
      </form>
    </div>
  );
}
