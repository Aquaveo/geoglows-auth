import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { createGeoglowsSupabaseClient } from "../../src/core/supabase";
import { RequestTimeoutError } from "../../src/core/retry";
import type { AuthAdapter, AuthUser } from "../../src/types";

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ __mock: "client" })),
}));

const createClientMock = vi.mocked(createClient);

function buildAuthAdapter(user: AuthUser | null): AuthAdapter {
  return {
    clearStaleAuthState: vi.fn(async () => {}),
    completeSignInIfNeeded: vi.fn(async () => null),
    getCurrentUser: vi.fn(async () => user),
    signInRedirect: vi.fn(async () => {}),
    signOutRedirect: vi.fn(async () => {}),
    setupTokenRenewal: vi.fn(),
  };
}

function buildAuthUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    sub: "user-1",
    email: "user@example.com",
    name: "User One",
    access_token: "access-token-from-cognito",
    id_token: "id-token-from-cognito",
    expired: false,
    profile: {},
    ...overrides,
  };
}

describe("createGeoglowsSupabaseClient", () => {
  beforeEach(() => {
    createClientMock.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("validation", () => {
    it("throws when url is empty", () => {
      expect(() =>
        createGeoglowsSupabaseClient({
          url: "",
          publishableKey: "key",
          auth: buildAuthAdapter(null),
        }),
      ).toThrow(/url is required/i);
    });

    it("throws when url is whitespace", () => {
      expect(() =>
        createGeoglowsSupabaseClient({
          url: "   ",
          publishableKey: "key",
          auth: buildAuthAdapter(null),
        }),
      ).toThrow(/url is required/i);
    });

    it("throws when publishableKey is empty", () => {
      expect(() =>
        createGeoglowsSupabaseClient({
          url: "https://x.supabase.co",
          publishableKey: "",
          auth: buildAuthAdapter(null),
        }),
      ).toThrow(/publishable key is required/i);
    });
  });

  describe("with external auth adapter (Cognito mode)", () => {
    it("creates a client wired to inject the adapter's id_token via accessToken", async () => {
      const adapter = buildAuthAdapter(buildAuthUser());

      createGeoglowsSupabaseClient({
        url: "https://x.supabase.co",
        publishableKey: "key",
        auth: adapter,
      });

      expect(createClientMock).toHaveBeenCalledTimes(1);
      const [url, key, options] = createClientMock.mock.calls[0];
      expect(url).toBe("https://x.supabase.co");
      expect(key).toBe("key");
      expect(options).toBeDefined();
      expect(typeof options?.accessToken).toBe("function");

      const token = await options!.accessToken!();
      expect(token).toBe("id-token-from-cognito");
      expect(adapter.getCurrentUser).toHaveBeenCalled();
    });

    it("returns access_token when useIdToken is false", async () => {
      const adapter = buildAuthAdapter(buildAuthUser());

      createGeoglowsSupabaseClient({
        url: "https://x.supabase.co",
        publishableKey: "key",
        auth: adapter,
        useIdToken: false,
      });

      const options = createClientMock.mock.calls[0][2];
      const token = await options!.accessToken!();
      expect(token).toBe("access-token-from-cognito");
    });

    it("accessToken returns null when adapter has no current user", async () => {
      const adapter = buildAuthAdapter(null);

      createGeoglowsSupabaseClient({
        url: "https://x.supabase.co",
        publishableKey: "key",
        auth: adapter,
      });

      const options = createClientMock.mock.calls[0][2];
      const token = await options!.accessToken!();
      expect(token).toBeNull();
    });

    it("accessToken returns null when token field is missing", async () => {
      const adapter = buildAuthAdapter(
        buildAuthUser({ id_token: undefined, access_token: undefined }),
      );

      createGeoglowsSupabaseClient({
        url: "https://x.supabase.co",
        publishableKey: "key",
        auth: adapter,
      });

      const options = createClientMock.mock.calls[0][2];
      expect(await options!.accessToken!()).toBeNull();
    });
  });

  describe("without external auth (Supabase Auth mode)", () => {
    it("creates a client without an accessToken callback when auth is omitted", () => {
      createGeoglowsSupabaseClient({
        url: "https://x.supabase.co",
        publishableKey: "key",
      });

      expect(createClientMock).toHaveBeenCalledWith(
        "https://x.supabase.co",
        "key",
      );
      expect(createClientMock.mock.calls[0]).toHaveLength(2);
    });

    it("treats auth: null identically to an omitted auth field", () => {
      createGeoglowsSupabaseClient({
        url: "https://x.supabase.co",
        publishableKey: "key",
        auth: null,
      });

      expect(createClientMock.mock.calls[0]).toHaveLength(2);
    });

    it("still validates url and publishableKey in no-auth mode", () => {
      expect(() =>
        createGeoglowsSupabaseClient({
          url: "",
          publishableKey: "key",
        }),
      ).toThrow(/url is required/i);

      expect(() =>
        createGeoglowsSupabaseClient({
          url: "https://x.supabase.co",
          publishableKey: "",
        }),
      ).toThrow(/publishable key is required/i);
    });
  });

  describe("autoRefreshToken", () => {
    it("leaves Supabase's own refresh scheduling alone by default", () => {
      createGeoglowsSupabaseClient({
        url: "https://x.supabase.co",
        publishableKey: "key",
      });

      expect(createClientMock.mock.calls[0]).toHaveLength(2);
    });

    it("disables Supabase's refresh scheduling when asked", () => {
      createGeoglowsSupabaseClient({
        url: "https://x.supabase.co",
        publishableKey: "key",
        autoRefreshToken: false,
      });

      const options = createClientMock.mock.calls[0][2];
      expect(options?.auth?.autoRefreshToken).toBe(false);
    });
  });

  describe("fetchTimeoutMs", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    });

    function wrappedFetch(timeoutMs: number) {
      createGeoglowsSupabaseClient({
        url: "https://x.supabase.co",
        publishableKey: "key",
        fetchTimeoutMs: timeoutMs,
      });
      const options = createClientMock.mock.calls[0][2];
      return options?.global?.fetch as typeof fetch;
    }

    it("installs no fetch wrapper by default", () => {
      createGeoglowsSupabaseClient({
        url: "https://x.supabase.co",
        publishableKey: "key",
      });

      expect(createClientMock.mock.calls[0]).toHaveLength(2);
    });

    it("aborts a request that outlives the timeout", async () => {
      vi.useFakeTimers();
      vi.stubGlobal(
        "fetch",
        vi.fn(
          (_input: unknown, init?: RequestInit) =>
            new Promise<Response>((_resolve, reject) => {
              init?.signal?.addEventListener("abort", () =>
                reject(init.signal?.reason),
              );
            }),
        ),
      );

      const settled = wrappedFetch(5000)("https://x.supabase.co/rest/v1/profiles")
        .then(() => null)
        .catch((error: unknown) => error);

      await vi.advanceTimersByTimeAsync(5001);

      expect(await settled).toBeInstanceOf(RequestTimeoutError);
    });

    it("passes a fast response through untouched", async () => {
      const response = { ok: true } as Response;
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

      await expect(
        wrappedFetch(5000)("https://x.supabase.co/rest/v1/profiles"),
      ).resolves.toBe(response);
    });

    it("chains a caller-supplied signal rather than replacing it", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          (_input: unknown, init?: RequestInit) =>
            new Promise<Response>((_resolve, reject) => {
              init?.signal?.addEventListener("abort", () =>
                reject(init.signal?.reason),
              );
            }),
        ),
      );

      const controller = new AbortController();
      const settled = wrappedFetch(60_000)(
        "https://x.supabase.co/rest/v1/profiles",
        { signal: controller.signal },
      )
        .then(() => null)
        .catch((error: unknown) => error);

      controller.abort(new Error("caller cancelled"));

      expect((await settled) as Error).toHaveProperty(
        "message",
        "caller cancelled",
      );
    });
  });
});
