import { describe, expect, it } from "vitest";
import { detectRecoveryUrlState } from "../../src/core/recovery-url";

describe("detectRecoveryUrlState", () => {
  // Synchronous URL-state detector. Used at module-load BEFORE Supabase JS's
  // _initialize() consumes the hash, so consumers can act on PASSWORD_RECOVERY
  // even if the React useEffect listener registers too late to receive the
  // event via onAuthStateChange. Pure function; no side effects.

  it("returns 'valid' for an implicit-flow recovery URL", () => {
    expect(
      detectRecoveryUrlState({
        hash: "#access_token=ey...&refresh_token=abc&type=recovery&expires_in=3600",
        search: "",
      }),
    ).toEqual({ kind: "valid" });
  });

  it("returns 'expired' when hash carries error_code=otp_expired", () => {
    expect(
      detectRecoveryUrlState({
        hash: "#error=access_denied&error_code=otp_expired&error_description=expired",
        search: "",
      }),
    ).toEqual({ kind: "expired" });
  });

  it("returns 'expired' when search carries error_code=otp_expired", () => {
    expect(
      detectRecoveryUrlState({
        hash: "",
        search: "?error_code=otp_expired",
      }),
    ).toEqual({ kind: "expired" });
  });

  it("returns 'pkce-unsupported' when query has both ?code and type=recovery", () => {
    expect(
      detectRecoveryUrlState({
        hash: "",
        search: "?code=abc123&type=recovery",
      }),
    ).toEqual({ kind: "pkce-unsupported" });
  });

  it("returns 'pkce-unsupported' when type=recovery is in the hash with code", () => {
    expect(
      detectRecoveryUrlState({
        hash: "#code=abc123&type=recovery",
        search: "",
      }),
    ).toEqual({ kind: "pkce-unsupported" });
  });

  it("returns 'none' for a normal OAuth callback (code without type=recovery)", () => {
    // Critical regression guard: the existing OAuth ?code=&state= cleanup must
    // not be misclassified as a PKCE recovery URL.
    expect(
      detectRecoveryUrlState({
        hash: "",
        search: "?code=abc&state=xyz",
      }),
    ).toEqual({ kind: "none" });
  });

  it("returns 'none' for an empty URL", () => {
    expect(detectRecoveryUrlState({ hash: "", search: "" })).toEqual({
      kind: "none",
    });
  });

  it("returns 'none' for a URL with type=recovery but no actionable token", () => {
    // type=recovery alone (no access_token, no code) is not actionable —
    // shouldn't trigger any consumer-side error UX.
    expect(
      detectRecoveryUrlState({
        hash: "#type=recovery",
        search: "",
      }),
    ).toEqual({ kind: "none" });
  });

  it("'expired' takes precedence over 'pkce-unsupported' when both signals are present", () => {
    expect(
      detectRecoveryUrlState({
        hash: "#error_code=otp_expired",
        search: "?code=abc&type=recovery",
      }),
    ).toEqual({ kind: "expired" });
  });

  it("'expired' takes precedence over 'valid' when both signals are present", () => {
    // Edge case — Supabase shouldn't emit both, but defensive precedence
    // protects against malformed URLs.
    expect(
      detectRecoveryUrlState({
        hash: "#access_token=ey...&type=recovery&error_code=otp_expired",
        search: "",
      }),
    ).toEqual({ kind: "expired" });
  });

  it("handles missing url object gracefully", () => {
    // Defensive: if a consumer passes undefined hash/search, return none.
    expect(
      detectRecoveryUrlState({
        hash: undefined as unknown as string,
        search: undefined as unknown as string,
      }),
    ).toEqual({ kind: "none" });
  });
});
