import { useMemo, useState, type CSSProperties, type FormEvent } from "react";
import type { GeoglowsSupabaseClient, Profile, UserType } from "../types";
import { updateProfile } from "../core/profile";
import {
  ProfileFields,
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
  primaryButtonDisabled: {
    opacity: 0.5,
    cursor: "not-allowed",
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

export interface ProfileEditFormProps {
  supabase: GeoglowsSupabaseClient;
  profile: Profile;
  onSuccess?: (profile: Profile) => void;
  onError?: (error: Error) => void;
  onCancel?: () => void;
  containerStyle?: CSSProperties;
}

function valuesFromProfile(profile: Profile): ProfileFieldsState {
  return {
    first_name: profile.first_name ?? "",
    middle_name: profile.middle_name ?? "",
    last_name: profile.last_name ?? "",
    user_type: profile.user_type ?? "",
    user_link: profile.user_link ?? "",
  };
}

function valuesEqual(a: ProfileFieldsState, b: ProfileFieldsState): boolean {
  return (
    a.first_name === b.first_name &&
    a.middle_name === b.middle_name &&
    a.last_name === b.last_name &&
    a.user_type === b.user_type &&
    a.user_link === b.user_link
  );
}

/**
 * Profile edit form. Pre-filled from the user's existing row;
 * disables Save until something has actually changed; offers a
 * Cancel button so the user can back out without saving.
 *
 * Submits through `updateProfile`, which respects the
 * `profiles_update_own` RLS policy.
 */
export function ProfileEditForm({
  supabase,
  profile,
  onSuccess,
  onError,
  onCancel,
  containerStyle,
}: ProfileEditFormProps) {
  const initial = useMemo(() => valuesFromProfile(profile), [profile]);
  const [values, setValues] = useState<ProfileFieldsState>(initial);
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const dirty = !valuesEqual(values, initial);

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
        user_type: (values.user_type || null) as UserType | null,
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
      <h2 style={styles.heading}>Edit profile</h2>
      <p style={styles.intro}>Update your information.</p>

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
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              disabled={pending}
              style={styles.secondaryButton}
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            disabled={pending || !dirty}
            style={{
              ...styles.primaryButton,
              ...(pending || !dirty ? styles.primaryButtonDisabled : {}),
            }}
          >
            {pending ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>
    </div>
  );
}
