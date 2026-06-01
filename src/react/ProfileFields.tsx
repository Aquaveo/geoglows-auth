import type { ChangeEvent, CSSProperties } from "react";
import type { UserType } from "../types";

/**
 * Internal field-level state shape used by ProfileSetupForm and
 * ProfileEditForm. Strings (not nullable) so the form inputs are always
 * controlled with definite values; conversion to nullable fields happens
 * at submission time.
 */
export interface ProfileFieldsState {
  first_name: string;
  middle_name: string;
  last_name: string;
  user_type: UserType | "";
  user_link: string;
}

export const EMPTY_PROFILE_FIELDS: ProfileFieldsState = {
  first_name: "",
  middle_name: "",
  last_name: "",
  user_type: "",
  user_link: "",
};

const USER_TYPE_OPTIONS: Array<{ value: UserType; label: string }> = [
  { value: "researcher", label: "Researcher" },
  { value: "student", label: "Student" },
  { value: "agency_staff", label: "Agency staff" },
  { value: "industry_professional", label: "Industry professional" },
  { value: "public", label: "Member of the public" },
  { value: "other", label: "Other" },
];

const styles: Record<string, CSSProperties> = {
  field: { display: "flex", flexDirection: "column", marginBottom: 12 },
  label: { fontSize: 13, marginBottom: 4, fontWeight: 500 },
  required: { color: "#c00", marginLeft: 2 },
  input: {
    padding: 8,
    fontSize: 14,
    border: "1px solid #ccc",
    borderRadius: 4,
    fontFamily: "inherit",
  },
  textarea: {
    padding: 8,
    fontSize: 14,
    border: "1px solid #ccc",
    borderRadius: 4,
    minHeight: 60,
    resize: "vertical",
    fontFamily: "inherit",
  },
  select: {
    padding: 8,
    fontSize: 14,
    border: "1px solid #ccc",
    borderRadius: 4,
    background: "#fff",
    fontFamily: "inherit",
  },
  row: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 },
  rowThree: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 },
};

export interface ProfileFieldsProps {
  values: ProfileFieldsState;
  onChange: (next: ProfileFieldsState) => void;
  disabled?: boolean;
  /** Render a `*` next to required field labels. Default true. */
  showRequiredMarkers?: boolean;
}

/**
 * Renders the shared profile-form input fields. Controlled component;
 * parent owns the state and validation.
 */
export function ProfileFields({
  values,
  onChange,
  disabled,
  showRequiredMarkers = true,
}: ProfileFieldsProps) {
  function set<K extends keyof ProfileFieldsState>(
    key: K,
    value: ProfileFieldsState[K],
  ) {
    onChange({ ...values, [key]: value });
  }

  function handleInput<K extends keyof ProfileFieldsState>(key: K) {
    return (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      set(key, e.target.value as ProfileFieldsState[K]);
    };
  }

  const requiredMark = showRequiredMarkers ? <span style={styles.required}>*</span> : null;

  return (
    <>
      <div style={styles.rowThree}>
        <div style={styles.field}>
          <label htmlFor="profile-first-name" style={styles.label}>
            First name{requiredMark}
          </label>
          <input
            id="profile-first-name"
            type="text"
            autoComplete="given-name"
            value={values.first_name}
            onChange={handleInput("first_name")}
            disabled={disabled}
            style={styles.input}
            required
          />
        </div>
        <div style={styles.field}>
          <label htmlFor="profile-middle-name" style={styles.label}>
            Middle name
          </label>
          <input
            id="profile-middle-name"
            type="text"
            autoComplete="additional-name"
            value={values.middle_name}
            onChange={handleInput("middle_name")}
            disabled={disabled}
            style={styles.input}
          />
        </div>
        <div style={styles.field}>
          <label htmlFor="profile-last-name" style={styles.label}>
            Last name{requiredMark}
          </label>
          <input
            id="profile-last-name"
            type="text"
            autoComplete="family-name"
            value={values.last_name}
            onChange={handleInput("last_name")}
            disabled={disabled}
            style={styles.input}
            required
          />
        </div>
      </div>

      <div style={styles.row}>
        <div style={styles.field}>
          <label htmlFor="profile-user-type" style={styles.label}>
            User type
          </label>
          <select
            id="profile-user-type"
            value={values.user_type}
            onChange={handleInput("user_type")}
            disabled={disabled}
            style={styles.select}
          >
            <option value="">Select…</option>
            {USER_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>



      <div style={styles.field}>
        <label htmlFor="profile-link" style={styles.label}>
          Personal link (URL)
        </label>
        <input
          id="profile-link"
          type="url"
          autoComplete="url"
          value={values.user_link}
          onChange={handleInput("user_link")}
          disabled={disabled}
          style={styles.input}
          placeholder="https://"
        />
      </div>
    </>
  );
}
