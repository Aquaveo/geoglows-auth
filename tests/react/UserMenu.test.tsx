import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { UserMenu } from "../../src/react/UserMenu";
import type { AuthContextValue, AuthUser } from "../../src/types";

const mockAuth = vi.hoisted(() => ({ value: null as AuthContextValue | null }));

vi.mock("../../src/react/AuthProvider", () => ({
  useAuth: () => mockAuth.value,
}));

function setAuth(value: Partial<AuthContextValue>) {
  mockAuth.value = {
    user: null,
    profile: null,
    loading: false,
    refresh: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
    ...value,
  };
}

function buildUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    sub: "user-1",
    email: "user@example.com",
    name: "Ada Lovelace",
    expired: false,
    profile: {},
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  mockAuth.value = null;
});

describe("UserMenu", () => {
  describe("signed-out state", () => {
    it("renders a Sign In button when no user is present", () => {
      setAuth({ user: null });
      render(<UserMenu />);
      expect(screen.getByRole("button", { name: /sign in/i })).toBeTruthy();
    });
  });

  describe("signed-in state — Profile link configuration (profileHref prop)", () => {
    it("renders no Profile link by default (no prop passed)", () => {
      setAuth({ user: buildUser() });
      render(<UserMenu />);
      expect(screen.queryByRole("link", { name: /profile/i })).toBeNull();
      // Email and Log out should still render
      expect(screen.getByText("user@example.com")).toBeTruthy();
      expect(screen.getByRole("button", { name: /log out/i })).toBeTruthy();
    });

    it("renders no Profile link when profileHref is null", () => {
      setAuth({ user: buildUser() });
      render(<UserMenu profileHref={null} />);
      expect(screen.queryByRole("link", { name: /profile/i })).toBeNull();
    });

    it("renders the Profile link with a root-relative href", () => {
      setAuth({ user: buildUser() });
      render(<UserMenu profileHref="/#profile" />);
      const link = screen.getByRole("link", { name: /profile/i }) as HTMLAnchorElement;
      expect(link.getAttribute("href")).toBe("/#profile");
    });

    it("renders the Profile link with an absolute https href", () => {
      setAuth({ user: buildUser() });
      render(<UserMenu profileHref="https://example.com/#profile" />);
      const link = screen.getByRole("link", { name: /profile/i }) as HTMLAnchorElement;
      expect(link.getAttribute("href")).toBe("https://example.com/#profile");
    });

    it("renders the Profile link for a hash-only href", () => {
      setAuth({ user: buildUser() });
      render(<UserMenu profileHref="#profile" />);
      const link = screen.getByRole("link", { name: /profile/i }) as HTMLAnchorElement;
      expect(link.getAttribute("href")).toBe("#profile");
    });

    it("omits the Profile link when profileHref has a javascript: scheme", () => {
      setAuth({ user: buildUser() });
      render(<UserMenu profileHref="javascript:alert(1)" />);
      expect(screen.queryByRole("link", { name: /profile/i })).toBeNull();
    });

    it("omits the Profile link when profileHref has a data: scheme", () => {
      setAuth({ user: buildUser() });
      render(<UserMenu profileHref="data:text/html,<script>alert(1)</script>" />);
      expect(screen.queryByRole("link", { name: /profile/i })).toBeNull();
    });

    it("omits the Profile link when profileHref has a vbscript: scheme", () => {
      setAuth({ user: buildUser() });
      render(<UserMenu profileHref="vbscript:msgbox(1)" />);
      expect(screen.queryByRole("link", { name: /profile/i })).toBeNull();
    });

    it("omits the Profile link when profileHref is whitespace-prefixed javascript:", () => {
      setAuth({ user: buildUser() });
      render(<UserMenu profileHref="  javascript:alert(1)" />);
      expect(screen.queryByRole("link", { name: /profile/i })).toBeNull();
    });

    it("renders the Profile link with text 'Profile'", () => {
      setAuth({ user: buildUser() });
      render(<UserMenu profileHref="/#profile" />);
      const link = screen.getByRole("link", { name: "Profile" });
      expect(link).toBeTruthy();
    });
  });
});
