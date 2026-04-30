import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseAuthAdapter } from "../../src/core/supabase-auth";
import type { SupabaseAuthAdapter } from "../../src/types";

interface MockAuth {
  getSession: ReturnType<typeof vi.fn>;
  signInWithPassword: ReturnType<typeof vi.fn>;
  signInWithOtp: ReturnType<typeof vi.fn>;
  signInWithOAuth: ReturnType<typeof vi.fn>;
  signUp: ReturnType<typeof vi.fn>;
  resetPasswordForEmail: ReturnType<typeof vi.fn>;
  updateUser: ReturnType<typeof vi.fn>;
  exchangeCodeForSession: ReturnType<typeof vi.fn>;
  signOut: ReturnType<typeof vi.fn>;
  onAuthStateChange: ReturnType<typeof vi.fn>;
}

interface MockClient {
  auth: MockAuth;
}

function buildSession(overrides: Record<string, unknown> = {}) {
  return {
    access_token: "access-123",
    refresh_token: "refresh-456",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: {
      id: "user-uuid-1",
      email: "user@example.com",
      user_metadata: { full_name: "Ada Lovelace" },
      app_metadata: {},
      aud: "authenticated",
      created_at: "2026-01-01T00:00:00Z",
    },
    ...overrides,
  };
}

function buildMockClient(): MockClient {
  return {
    auth: {
      getSession: vi.fn(),
      signInWithPassword: vi.fn(),
      signInWithOtp: vi.fn(),
      signInWithOAuth: vi.fn(),
      signUp: vi.fn(),
      resetPasswordForEmail: vi.fn(),
      updateUser: vi.fn(),
      exchangeCodeForSession: vi.fn(),
      signOut: vi.fn(),
      onAuthStateChange: vi.fn(),
    },
  };
}

function setUrl(href: string) {
  window.history.replaceState({}, "", href);
}

describe("createSupabaseAuthAdapter", () => {
  let client: MockClient;
  let adapter: SupabaseAuthAdapter;

  beforeEach(() => {
    setUrl("http://localhost/");
    client = buildMockClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    adapter = createSupabaseAuthAdapter({ supabase: client as any });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws when no supabase client is provided", () => {
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      createSupabaseAuthAdapter({ supabase: undefined as any }),
    ).toThrow(/required/i);
  });

  describe("getCurrentUser", () => {
    it("returns mapped AuthUser when a session exists", async () => {
      client.auth.getSession.mockResolvedValue({
        data: { session: buildSession() },
        error: null,
      });

      const user = await adapter.getCurrentUser();

      expect(user).toEqual(
        expect.objectContaining({
          sub: "user-uuid-1",
          email: "user@example.com",
          name: "Ada Lovelace",
          access_token: "access-123",
          id_token: undefined,
          expired: false,
        }),
      );
    });

    it("returns null when no session is active", async () => {
      client.auth.getSession.mockResolvedValue({
        data: { session: null },
        error: null,
      });

      expect(await adapter.getCurrentUser()).toBeNull();
    });

    it("returns null and logs a warning on transient session-fetch error", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      client.auth.getSession.mockResolvedValue({
        data: { session: null },
        error: new Error("network blip"),
      });

      expect(await adapter.getCurrentUser()).toBeNull();
      expect(warnSpy).toHaveBeenCalled();
    });

    it("falls back to user_metadata.name when full_name is absent", async () => {
      const session = buildSession({
        user: {
          id: "u-2",
          email: "x@y.com",
          user_metadata: { name: "Alt Name" },
          app_metadata: {},
          aud: "authenticated",
          created_at: "2026-01-01T00:00:00Z",
        },
      });
      client.auth.getSession.mockResolvedValue({
        data: { session },
        error: null,
      });

      const user = await adapter.getCurrentUser();
      expect(user?.name).toBe("Alt Name");
    });

    it("falls back to email when no metadata names are present", async () => {
      const session = buildSession({
        user: {
          id: "u-3",
          email: "only-email@example.com",
          user_metadata: {},
          app_metadata: {},
          aud: "authenticated",
          created_at: "2026-01-01T00:00:00Z",
        },
      });
      client.auth.getSession.mockResolvedValue({
        data: { session },
        error: null,
      });

      const user = await adapter.getCurrentUser();
      expect(user?.name).toBe("only-email@example.com");
    });

    it("marks the session as expired when expires_at is in the past", async () => {
      const session = buildSession({
        expires_at: Math.floor(Date.now() / 1000) - 100,
      });
      client.auth.getSession.mockResolvedValue({
        data: { session },
        error: null,
      });

      const user = await adapter.getCurrentUser();
      expect(user?.expired).toBe(true);
    });
  });

  describe("completeSignInIfNeeded", () => {
    it("returns null when URL has no auth params", async () => {
      setUrl("http://localhost/dashboard");

      const user = await adapter.completeSignInIfNeeded();
      expect(user).toBeNull();
      expect(client.auth.exchangeCodeForSession).not.toHaveBeenCalled();
    });

    it("returns the session when Supabase already auto-exchanged the code", async () => {
      setUrl("http://localhost/?code=abc&state=xyz");
      client.auth.getSession.mockResolvedValue({
        data: { session: buildSession() },
        error: null,
      });

      const user = await adapter.completeSignInIfNeeded();

      expect(user?.sub).toBe("user-uuid-1");
      expect(client.auth.exchangeCodeForSession).not.toHaveBeenCalled();
      expect(window.location.search).toBe("");
    });

    it("explicitly exchanges the code when no session is present yet", async () => {
      setUrl("http://localhost/?code=abc&state=xyz");
      client.auth.getSession.mockResolvedValue({
        data: { session: null },
        error: null,
      });
      client.auth.exchangeCodeForSession.mockResolvedValue({
        data: { session: buildSession(), user: buildSession().user },
        error: null,
      });

      const user = await adapter.completeSignInIfNeeded();

      expect(client.auth.exchangeCodeForSession).toHaveBeenCalledWith("abc");
      expect(user?.sub).toBe("user-uuid-1");
      expect(window.location.search).toBe("");
    });

    it("throws and strips URL params on error= callback", async () => {
      setUrl(
        "http://localhost/?error=access_denied&error_description=user%20cancelled",
      );

      await expect(adapter.completeSignInIfNeeded()).rejects.toThrow(
        /user cancelled/,
      );
      expect(window.location.search).toBe("");
    });
  });

  describe("signInWithPassword", () => {
    it("returns the mapped user on success", async () => {
      const session = buildSession();
      client.auth.signInWithPassword.mockResolvedValue({
        data: { session, user: session.user },
        error: null,
      });

      const user = await adapter.signInWithPassword({
        email: "user@example.com",
        password: "hunter2",
      });

      expect(user.sub).toBe("user-uuid-1");
      expect(client.auth.signInWithPassword).toHaveBeenCalledWith({
        email: "user@example.com",
        password: "hunter2",
      });
    });

    it("propagates an auth error with bad credentials", async () => {
      client.auth.signInWithPassword.mockResolvedValue({
        data: { session: null, user: null },
        error: new Error("Invalid login credentials"),
      });

      await expect(
        adapter.signInWithPassword({
          email: "user@example.com",
          password: "wrong",
        }),
      ).rejects.toThrow(/invalid login/i);
    });
  });

  describe("signInWithMagicLink", () => {
    it("calls signInWithOtp with the configured redirect", async () => {
      adapter = createSupabaseAuthAdapter({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        supabase: client as any,
        defaultRedirectTo: "http://localhost/auth/callback",
      });
      client.auth.signInWithOtp.mockResolvedValue({
        data: {},
        error: null,
      });

      await adapter.signInWithMagicLink({ email: "user@example.com" });

      expect(client.auth.signInWithOtp).toHaveBeenCalledWith({
        email: "user@example.com",
        options: { emailRedirectTo: "http://localhost/auth/callback" },
      });
    });

    it("propagates errors from Supabase", async () => {
      client.auth.signInWithOtp.mockResolvedValue({
        data: {},
        error: new Error("Rate limited"),
      });

      await expect(
        adapter.signInWithMagicLink({ email: "user@example.com" }),
      ).rejects.toThrow(/rate limited/i);
    });
  });

  describe("signOutRedirect", () => {
    it("calls supabase.auth.signOut", async () => {
      client.auth.signOut.mockResolvedValue({ error: null });

      await adapter.signOutRedirect();

      expect(client.auth.signOut).toHaveBeenCalled();
    });

    it("does not throw when signOut returns an error", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      client.auth.signOut.mockResolvedValue({
        error: new Error("network down"),
      });

      await expect(adapter.signOutRedirect()).resolves.toBeUndefined();
      expect(warnSpy).toHaveBeenCalled();
    });
  });

  describe("setupTokenRenewal", () => {
    it("registers an onAuthStateChange listener exactly once", () => {
      adapter.setupTokenRenewal();
      adapter.setupTokenRenewal();
      expect(client.auth.onAuthStateChange).toHaveBeenCalledTimes(1);
    });
  });

  describe("resetPasswordForEmail", () => {
    it("calls supabase.auth.resetPasswordForEmail with configured defaultRedirectTo", async () => {
      adapter = createSupabaseAuthAdapter({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        supabase: client as any,
        defaultRedirectTo: "http://localhost/auth/callback",
      });
      client.auth.resetPasswordForEmail.mockResolvedValue({
        data: {},
        error: null,
      });

      await adapter.resetPasswordForEmail({ email: "user@example.com" });

      expect(client.auth.resetPasswordForEmail).toHaveBeenCalledWith(
        "user@example.com",
        { redirectTo: "http://localhost/auth/callback" },
      );
    });

    it("forwards an explicit redirectTo verbatim, ignoring the default", async () => {
      adapter = createSupabaseAuthAdapter({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        supabase: client as any,
        defaultRedirectTo: "http://localhost/default",
      });
      client.auth.resetPasswordForEmail.mockResolvedValue({
        data: {},
        error: null,
      });

      await adapter.resetPasswordForEmail({
        email: "user@example.com",
        redirectTo: "https://example.com/auth/recovery",
      });

      expect(client.auth.resetPasswordForEmail).toHaveBeenCalledWith(
        "user@example.com",
        { redirectTo: "https://example.com/auth/recovery" },
      );
    });

    it("propagates errors from Supabase", async () => {
      client.auth.resetPasswordForEmail.mockResolvedValue({
        data: {},
        error: new Error("Email rate limit exceeded"),
      });

      await expect(
        adapter.resetPasswordForEmail({ email: "user@example.com" }),
      ).rejects.toThrow(/rate limit/i);
    });
  });

  describe("updateUserPassword", () => {
    it("calls supabase.auth.updateUser with only the password attribute", async () => {
      client.auth.updateUser.mockResolvedValue({
        data: { user: buildSession().user },
        error: null,
      });

      await adapter.updateUserPassword({ password: "new-strong-password" });

      expect(client.auth.updateUser).toHaveBeenCalledWith({
        password: "new-strong-password",
      });
    });

    it("propagates errors from Supabase (e.g. password too weak, session expired)", async () => {
      client.auth.updateUser.mockResolvedValue({
        data: { user: null },
        error: new Error("New password should be at least 6 characters"),
      });

      await expect(
        adapter.updateUserPassword({ password: "x" }),
      ).rejects.toThrow(/at least 6 characters/i);
    });
  });

  describe("signOutOtherSessions", () => {
    it("calls supabase.auth.signOut with scope: 'others' EXACTLY", async () => {
      client.auth.signOut.mockResolvedValue({ error: null });

      await adapter.signOutOtherSessions();

      // Regression guard: must NOT call with no args (which would be a global
      // sign-out of the current session — destroying the recovery session
      // immediately after the password update).
      expect(client.auth.signOut).toHaveBeenCalledWith({ scope: "others" });
      expect(client.auth.signOut).not.toHaveBeenCalledWith();
    });

    it("propagates errors from Supabase (modal layer treats as best-effort)", async () => {
      client.auth.signOut.mockResolvedValue({
        error: new Error("network down"),
      });

      await expect(adapter.signOutOtherSessions()).rejects.toThrow(
        /network down/i,
      );
    });
  });
});
