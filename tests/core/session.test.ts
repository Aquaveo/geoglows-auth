import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootstrapSession, type SessionState } from "../../src/core/session";
import { createSupabaseAuthAdapter } from "../../src/core/supabase-auth";

interface MockSupabaseClient {
  auth: {
    getSession: ReturnType<typeof vi.fn>;
    signOut: ReturnType<typeof vi.fn>;
    onAuthStateChange: ReturnType<typeof vi.fn>;
    exchangeCodeForSession: ReturnType<typeof vi.fn>;
    signInWithPassword: ReturnType<typeof vi.fn>;
    signInWithOtp: ReturnType<typeof vi.fn>;
    signInWithOAuth: ReturnType<typeof vi.fn>;
  };
  from: ReturnType<typeof vi.fn>;
}

function buildSession(overrides: Record<string, unknown> = {}) {
  return {
    access_token: "access-1",
    refresh_token: "refresh-1",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: {
      id: "supabase-user-uuid",
      email: "scientist@example.com",
      user_metadata: { full_name: "Scientist Name" },
      app_metadata: {},
      aud: "authenticated",
      created_at: "2026-01-01T00:00:00Z",
    },
    ...overrides,
  };
}

function buildClient(): MockSupabaseClient {
  // Profile upsert chain: from(...).upsert(...).select().single()
  const profileSingle = vi.fn().mockResolvedValue({
    data: {
      id: "supabase-user-uuid",
      email: "scientist@example.com",
      display_name: "Scientist Name",
      created_at: "2026-01-01T00:00:00Z",
    },
    error: null,
  });
  const profileSelect = vi.fn(() => ({ single: profileSingle }));
  const profileUpsert = vi.fn(() => ({ select: profileSelect }));

  // Account fetch chains:
  // - from('profiles').select('*').eq('id', userId).maybeSingle()
  // - from('org_memberships').select(`...`).eq('user_id', userId)
  const profilesMaybeSingle = vi.fn().mockResolvedValue({
    data: {
      id: "supabase-user-uuid",
      email: "scientist@example.com",
      display_name: "Scientist Name",
    },
    error: null,
  });
  const profilesEq = vi.fn(() => ({ maybeSingle: profilesMaybeSingle }));
  const profilesSelect = vi.fn(() => ({ eq: profilesEq }));

  const orgMembershipsEq = vi.fn().mockResolvedValue({
    data: [],
    error: null,
  });
  const orgMembershipsSelect = vi.fn(() => ({ eq: orgMembershipsEq }));

  const from = vi.fn((table: string) => {
    if (table === "profiles") {
      return {
        upsert: profileUpsert,
        select: profilesSelect,
      };
    }
    if (table === "org_memberships") {
      return { select: orgMembershipsSelect };
    }
    throw new Error(`Unexpected table: ${table}`);
  });

  return {
    auth: {
      getSession: vi.fn(),
      signOut: vi.fn().mockResolvedValue({ error: null }),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
      exchangeCodeForSession: vi.fn(),
      signInWithPassword: vi.fn(),
      signInWithOtp: vi.fn(),
      signInWithOAuth: vi.fn(),
    },
    from,
  };
}

function setUrl(href: string) {
  window.history.replaceState({}, "", href);
}

describe("bootstrapSession with the Supabase Auth adapter", () => {
  let client: MockSupabaseClient;

  beforeEach(() => {
    setUrl("http://localhost/");
    client = buildClient();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("walks through bootstrapping → ready when a session exists", async () => {
    client.auth.getSession.mockResolvedValue({
      data: { session: buildSession() },
      error: null,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adapter = createSupabaseAuthAdapter({ supabase: client as any });

    const states: SessionState["status"][] = [];
    const final = await bootstrapSession({
      auth: adapter,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: client as any,
      onStateChange: (s) => {
        states.push(s.status);
      },
    });

    expect(states).toEqual([
      "bootstrapping",
      "processing_callback",
      "authenticated",
      "loading_profile",
      "loading_account",
      "ready",
    ]);
    expect(final.status).toBe("ready");
    expect(final.user?.sub).toBe("supabase-user-uuid");
    expect(final.user?.email).toBe("scientist@example.com");
    expect(final.user?.name).toBe("Scientist Name");
    expect(final.account).not.toBeNull();
    expect(final.account?.profile?.email).toBe("scientist@example.com");
    expect(final.account?.organizations).toEqual([]);
  });

  it("upserts a row in profiles using the Supabase user id as sub", async () => {
    client.auth.getSession.mockResolvedValue({
      data: { session: buildSession() },
      error: null,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adapter = createSupabaseAuthAdapter({ supabase: client as any });

    await bootstrapSession({
      auth: adapter,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: client as any,
    });

    expect(client.from).toHaveBeenCalledWith("profiles");
    // first call: upsert returned by from('profiles')
    const profilesCall = client.from.mock.results.find(
      (r) => r.value?.upsert,
    );
    const upsertFn = profilesCall?.value.upsert as ReturnType<typeof vi.fn>;
    expect(upsertFn).toHaveBeenCalledWith(
      {
        id: "supabase-user-uuid",
        email: "scientist@example.com",
        display_name: "Scientist Name",
      },
      { onConflict: "id" },
    );
  });

  it("resolves to 'anonymous' when no Supabase session is active", async () => {
    client.auth.getSession.mockResolvedValue({
      data: { session: null },
      error: null,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adapter = createSupabaseAuthAdapter({ supabase: client as any });

    const final = await bootstrapSession({
      auth: adapter,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: client as any,
    });

    expect(final.status).toBe("anonymous");
    expect(final.user).toBeNull();
    expect(final.account).toBeNull();
    // ensureProfile and loadAccountSummary should NOT have been called
    expect(client.from).not.toHaveBeenCalled();
  });

  it("respects syncProfile=false and loadAccount=false flags", async () => {
    client.auth.getSession.mockResolvedValue({
      data: { session: buildSession() },
      error: null,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adapter = createSupabaseAuthAdapter({ supabase: client as any });

    const final = await bootstrapSession({
      auth: adapter,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: client as any,
      syncProfile: false,
      loadAccount: false,
    });

    expect(final.status).toBe("ready");
    expect(final.user?.sub).toBe("supabase-user-uuid");
    expect(final.account).toBeNull();
    expect(client.from).not.toHaveBeenCalled();
  });

  it("reaches 'error' state if profile upsert fails", async () => {
    client.auth.getSession.mockResolvedValue({
      data: { session: buildSession() },
      error: null,
    });

    // Override profile upsert to reject
    client.from = vi.fn(() => ({
      upsert: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi
            .fn()
            .mockResolvedValue({ data: null, error: new Error("rls denied") }),
        })),
      })),
    }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adapter = createSupabaseAuthAdapter({ supabase: client as any });

    const final = await bootstrapSession({
      auth: adapter,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: client as any,
    });

    expect(final.status).toBe("error");
    expect((final.error as Error).message).toMatch(/rls denied/);
    expect(final.user?.sub).toBe("supabase-user-uuid");
  });
});
