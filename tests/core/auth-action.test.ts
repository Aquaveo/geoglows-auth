import { describe, expect, it } from "vitest";
import {
  renderAuthAction,
  wireAvatarMenuDismiss,
} from "../../src/core/auth-action";
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

    it("renders the retry-able error icon when status is error and user is null", () => {
      const html = renderAuthAction({
        user: null,
        account: null,
        status: "error",
      });
      // Not the sign-in button: the modal behind it cannot work when the
      // account service is what failed, so the slot says so and offers a retry.
      expect(html).toContain('id="geoglowsAuthRetry"');
      expect(html).toContain("geoglows-auth-action-error");
      expect(html).not.toContain('id="geoglowsSignIn"');
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
      expect(html).toContain("Sign out");
    });
  });

  describe("Profile link configuration (profileHref option)", () => {
    const signedInState = () => ({
      user: buildUser(),
      account: { profile: buildProfile() },
      status: "ready" as const,
    });

    it("defaults to '/profile' when no options arg is passed", () => {
      const html = renderAuthAction(signedInState());
      expect(html).toMatch(
        /<a[^>]*href="\/profile"[^>]*class="geoglows-auth-action-menu-link"[^>]*>Profile<\/a>/,
      );
    });

    it("uses the provided profileHref when passed an explicit value", () => {
      const html = renderAuthAction(signedInState(), { profileHref: "/#profile" });
      expect(html).toContain('href="/#profile"');
      expect(html).not.toContain('href="#profile"');
    });

    it("renders an absolute URL when profileHref is absolute", () => {
      const html = renderAuthAction(signedInState(), {
        profileHref: "https://example.com/#profile",
      });
      expect(html).toContain('href="https://example.com/#profile"');
    });

    it("omits the Profile link entirely when profileHref is null", () => {
      const html = renderAuthAction(signedInState(), { profileHref: null });
      expect(html).not.toContain("geoglows-auth-action-menu-link");
      expect(html).not.toContain(">Profile<");
      // Email header and sign-out button still render
      expect(html).toContain('id="geoglowsSignOut"');
      expect(html).toContain("Ada Lovelace");
    });

    it("escapes HTML-significant characters in the profileHref attribute", () => {
      const html = renderAuthAction(signedInState(), {
        profileHref: '"><script>alert(1)</script>',
      });
      expect(html).not.toContain("<script>");
      expect(html).toContain("&lt;script&gt;");
    });

    it("omits the Profile link entirely when profileHref has a javascript: scheme", () => {
      const html = renderAuthAction(signedInState(), {
        profileHref: "javascript:alert(1)",
      });
      expect(html).not.toContain("geoglows-auth-action-menu-link");
      expect(html).not.toContain("javascript:");
    });

    it("omits the Profile link entirely when profileHref has a data: scheme", () => {
      const html = renderAuthAction(signedInState(), {
        profileHref: "data:text/html,<script>alert(1)</script>",
      });
      expect(html).not.toContain("geoglows-auth-action-menu-link");
    });

    it("omits the Profile link when profileHref has a vbscript: scheme", () => {
      const html = renderAuthAction(signedInState(), {
        profileHref: "vbscript:msgbox(1)",
      });
      expect(html).not.toContain("geoglows-auth-action-menu-link");
    });

    it("omits the Profile link when profileHref is whitespace-prefixed javascript:", () => {
      const html = renderAuthAction(signedInState(), {
        profileHref: "  javascript:alert(1)",
      });
      expect(html).not.toContain("geoglows-auth-action-menu-link");
    });

    it("renders the Profile link for allowed schemes (https, /, /#)", () => {
      const httpsHtml = renderAuthAction(signedInState(), {
        profileHref: "https://example.com/profile",
      });
      expect(httpsHtml).toContain("geoglows-auth-action-menu-link");

      const rootRelativeHtml = renderAuthAction(signedInState(), {
        profileHref: "/profile",
      });
      expect(rootRelativeHtml).toContain('href="/profile"');

      const rootHashHtml = renderAuthAction(signedInState(), {
        profileHref: "/#profile",
      });
      expect(rootHashHtml).toContain('href="/#profile"');
    });

    it("does not render a Profile link in signed-out / loading states regardless of profileHref", () => {
      const signedOutHtml = renderAuthAction(
        { user: null, account: null, status: "anonymous" },
        { profileHref: "/#profile" },
      );
      expect(signedOutHtml).not.toContain("geoglows-auth-action-menu-link");

      const loadingHtml = renderAuthAction(
        { user: null, account: null, status: "bootstrapping" },
        { profileHref: "/#profile" },
      );
      expect(loadingHtml).not.toContain("geoglows-auth-action-menu-link");
    });
  });
});

describe("wireAvatarMenuDismiss", () => {
  const mount = () => {
    const slot = document.createElement("div");
    slot.innerHTML = renderAuthAction(
      { user: buildUser(), status: "authenticated", action: null },
      { profileHref: "/#profile" },
    );
    document.body.appendChild(slot);
    const menu = slot.querySelector("details") as HTMLDetailsElement;
    menu.open = true;
    return { slot, menu };
  };

  it("closes the open menu on a click outside it", () => {
    const { slot, menu } = mount();
    const unwire = wireAvatarMenuDismiss(slot);
    document.body.click();
    expect(menu.open).toBe(false);
    unwire();
    slot.remove();
  });

  it("leaves the menu open on a click inside it", () => {
    const { slot, menu } = mount();
    const unwire = wireAvatarMenuDismiss(slot);
    (menu.querySelector("a") as HTMLElement).click();
    expect(menu.open).toBe(true);
    unwire();
    slot.remove();
  });

  it("closes the open menu on Escape", () => {
    const { slot, menu } = mount();
    const unwire = wireAvatarMenuDismiss(slot);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(menu.open).toBe(false);
    unwire();
    slot.remove();
  });

  it("stops listening once unwired", () => {
    const { slot, menu } = mount();
    wireAvatarMenuDismiss(slot)();
    document.body.click();
    expect(menu.open).toBe(true);
    slot.remove();
  });
});
