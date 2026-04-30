import { describe, expect, it } from "vitest";
import { renderAuthAction } from "../../src/core/auth-action";
import type { AuthUser, Profile } from "../../src/types";

const buildUser = (overrides: Partial<AuthUser> = {}): AuthUser => ({
  sub: "user-1",
  email: "user@example.com",
  name: "Ada Lovelace",
  expired: false,
  profile: {},
  ...overrides,
});

const buildProfile = (overrides: Partial<Profile> = {}): Profile => ({
  id: "user-1",
  email: "user@example.com",
  display_name: "Ada Lovelace",
  first_name: "Ada",
  last_name: "Lovelace",
  ...overrides,
});

describe("renderAuthAction", () => {
  describe("loading state", () => {
    it("renders the loading pill during bootstrapping", () => {
      const html = renderAuthAction({
        user: null,
        account: null,
        status: "bootstrapping",
      });
      expect(html).toContain("geoglows-auth-action-loading");
      expect(html).toContain("Signing in");
    });

    it("renders the loading pill during loading_profile", () => {
      const html = renderAuthAction({
        user: null,
        account: null,
        status: "loading_profile",
      });
      expect(html).toContain("geoglows-auth-action-loading");
    });

    it("renders the loading pill during loading_account", () => {
      const html = renderAuthAction({
        user: null,
        account: null,
        status: "loading_account",
      });
      expect(html).toContain("geoglows-auth-action-loading");
    });

    it("renders the loading pill during processing_callback", () => {
      const html = renderAuthAction({
        user: null,
        account: null,
        status: "processing_callback",
      });
      expect(html).toContain("geoglows-auth-action-loading");
    });
  });

  describe("signed-out state", () => {
    it("renders the sign-in button when user is null and status is anonymous", () => {
      const html = renderAuthAction({
        user: null,
        account: null,
        status: "anonymous",
      });
      expect(html).toContain('id="geoglowsSignIn"');
      expect(html).toContain("geoglows-auth-action-signin");
      expect(html).toContain("Sign in");
    });

    it("renders the sign-in button when status is error and user is null", () => {
      const html = renderAuthAction({
        user: null,
        account: null,
        status: "error",
      });
      expect(html).toContain('id="geoglowsSignIn"');
    });

    it("renders the sign-in button when status is ready and user is null", () => {
      const html = renderAuthAction({
        user: null,
        account: null,
        status: "ready",
      });
      expect(html).toContain('id="geoglowsSignIn"');
    });
  });

  describe("user takes precedence over loading status (rebootstrap defense)", () => {
    // Supabase JS fires SIGNED_IN on every tab-focus session revalidation.
    // If a consumer's onAuthStateChange responds by re-running bootstrapSession,
    // the lib's transient "bootstrapping" / "loading_profile" / "loading_account"
    // emits would normally null out user and account, causing the navbar to
    // briefly show "Signing in…" before settling back to the avatar — a visible
    // flicker. The render-layer guard: if user is set, prefer the avatar even
    // during loading status. The lib's session.ts also accepts initialState now
    // to avoid clearing user in the first place; this is defense in depth.
    it("renders the avatar (not the loading pill) when status is bootstrapping but user is present", () => {
      const html = renderAuthAction({
        user: buildUser(),
        account: { profile: buildProfile() },
        status: "bootstrapping",
      });
      expect(html).toContain('id="geoglowsAuthActionAvatar"');
      expect(html).not.toContain("geoglows-auth-action-loading");
    });

    it("renders the avatar when status is loading_profile but user is present", () => {
      const html = renderAuthAction({
        user: buildUser(),
        account: { profile: buildProfile() },
        status: "loading_profile",
      });
      expect(html).toContain('id="geoglowsAuthActionAvatar"');
      expect(html).not.toContain("geoglows-auth-action-loading");
    });

    it("renders the avatar when status is loading_account but user is present", () => {
      const html = renderAuthAction({
        user: buildUser(),
        account: { profile: buildProfile() },
        status: "loading_account",
      });
      expect(html).toContain('id="geoglowsAuthActionAvatar"');
      expect(html).not.toContain("geoglows-auth-action-loading");
    });

    it("renders the avatar even if account is null (e.g. mid-rebootstrap before account reloads)", () => {
      const html = renderAuthAction({
        user: buildUser(),
        account: null,
        status: "loading_account",
      });
      expect(html).toContain('id="geoglowsAuthActionAvatar"');
      expect(html).not.toContain("geoglows-auth-action-loading");
    });
  });

  describe("signed-in state", () => {
    it("renders the avatar dropdown when user is present", () => {
      const html = renderAuthAction({
        user: buildUser(),
        account: { profile: buildProfile() },
        status: "ready",
      });
      expect(html).toContain('id="geoglowsAuthActionAvatar"');
      expect(html).toContain("geoglows-auth-action-avatar-summary");
      expect(html).toContain('id="geoglowsSignOut"');
    });

    it("renders the user's display name, email, and initials", () => {
      const html = renderAuthAction({
        user: buildUser(),
        account: { profile: buildProfile() },
        status: "ready",
      });
      expect(html).toContain("Ada Lovelace");
      expect(html).toContain("user@example.com");
      // Initials live inside the <summary>, possibly surrounded by whitespace.
      expect(html).toMatch(/<summary[^>]*>\s*AL\s*<\/summary>/);
    });

    it("escapes user-controlled fields (name, email, initials) — XSS regression guard", () => {
      const html = renderAuthAction({
        user: buildUser({ email: '<img src=x onerror="alert(1)">' }),
        account: {
          profile: buildProfile({
            display_name: '<script>alert("pwned")</script>',
            email: '<img src=x onerror="alert(1)">',
          }),
        },
        status: "ready",
      });
      expect(html).not.toContain("<script>");
      expect(html).not.toContain('onerror="alert');
      expect(html).toContain("&lt;script&gt;");
    });

    it("disables the sign-out button when action is signing_out", () => {
      const html = renderAuthAction({
        user: buildUser(),
        account: { profile: buildProfile() },
        status: "ready",
        action: "signing_out",
      });
      expect(html).toMatch(/<button[^>]*id="geoglowsSignOut"[^>]*disabled/);
      expect(html).toContain("Signing out");
    });

    it("does not disable the sign-out button when no action is in flight", () => {
      const html = renderAuthAction({
        user: buildUser(),
        account: { profile: buildProfile() },
        status: "ready",
      });
      expect(html).not.toMatch(/<button[^>]*id="geoglowsSignOut"[^>]*disabled/);
      expect(html).toContain("Log out");
    });
  });
});
