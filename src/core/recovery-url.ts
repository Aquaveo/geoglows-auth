/**
 * Synchronous URL-state detector for the password-recovery flow.
 *
 * Consumers call this at module-load time, BEFORE Supabase JS's
 * `_initialize()` consumes the URL hash, to detect:
 *   - a valid implicit-flow recovery URL → open the modal in `setNewPassword` view
 *   - an expired/used token (`error_code=otp_expired`) → open in `recoveryError` view
 *   - a PKCE-shape recovery URL (unsupported in v1) → open in `recoveryError` view + log
 *
 * This is the only race-proof signal that "the user is in a recovery flow."
 * Supabase fires `PASSWORD_RECOVERY` synchronously during `_initialize()`,
 * before any React `useEffect` runs — meaning a consumer relying solely on
 * `onAuthStateChange` may miss the event entirely. The URL itself is the
 * stable evidence.
 *
 * Pure function. No side effects. Synchronous. No Supabase dependency.
 */

export type RecoveryUrlState =
  | { kind: "valid" }
  | { kind: "expired" }
  | { kind: "pkce-unsupported" }
  | { kind: "none" };

export interface UrlParts {
  hash?: string;
  search?: string;
}

export function detectRecoveryUrlState(url: UrlParts): RecoveryUrlState {
  const hash = url?.hash ?? "";
  const search = url?.search ?? "";

  // Expired token takes precedence — the URL signals failure regardless of flow.
  if (
    /(?:^|[#&?])error_code=otp_expired/.test(hash) ||
    /(?:^|[?&])error_code=otp_expired/.test(search)
  ) {
    return { kind: "expired" };
  }

  const hasCode =
    /(?:^|[#&?])code=/.test(hash) || /(?:^|[?&])code=/.test(search);
  const hasRecovery =
    /(?:^|[#&?])type=recovery/.test(hash) ||
    /(?:^|[?&])type=recovery/.test(search);

  // PKCE recovery: `?code=` (or `#code=`) AND `type=recovery` in the same
  // request. Implicit flow uses `#access_token=` (NOT `code=`), so the
  // code+recovery combination uniquely identifies the unsupported-flow case.
  if (hasCode && hasRecovery) {
    return { kind: "pkce-unsupported" };
  }

  // Valid implicit-flow recovery: `#access_token=` AND `type=recovery`.
  const hasAccessToken = /(?:^|[#&])access_token=/.test(hash);
  if (hasAccessToken && hasRecovery) {
    return { kind: "valid" };
  }

  return { kind: "none" };
}
