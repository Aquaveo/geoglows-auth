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
  schema: ReturnType<typeof vi.fn>;
  // Exposed for tests that introspect the inner `from` chain (call counts /
  // overrides). Set by buildClient and updated when tests swap chains.
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

interface ClientMocks {
  client: MockSupabaseClient;
  profilesMaybeSingle: ReturnType<typeof vi.fn>;
  profilesInsert: ReturnType<typeof vi.fn>;
  profilesInsertSingle: ReturnType<typeof vi.fn>;
}

function buildClient(opts: { existingProfile?: boolean } = {}): ClientMocks {
  const existingProfile = opts.existingProfile ?? true;
  const profileRow = {
    id: "supabase-user-uuid",
    email: "scientist@example.com",
    display_name: "Scientist Name",
    first_name: "Scientist",
    last_name: "Name",
    created_at: "2026-01-01T00:00:00Z",
  };

  // Shared select chain for `from('profiles').select('*').eq('id', uid)
  // .maybeSingle()` — used by both ensureProfile (for the existence check)
  // and loadAccountSummary (for fetching the row to surface in state).
  const profilesMaybeSingle = vi.fn().mockResolvedValue({
    data: existingProfile ? profileRow : null,
    error: null,
  });
  const profilesEq = vi.fn(() => ({ maybeSingle: profilesMaybeSingle }));
  const profilesSelect = vi.fn(() => ({ eq: profilesEq }));

  // Insert chain for ensureProfile when no row exists.
  const profilesInsertSingle = vi.fn().mockResolvedValue({
    data: profileRow,
    error: null,
  });
  const profilesInsertSelect = vi.fn(() => ({ single: profilesInsertSingle }));
  const profilesInsert = vi.fn(() => ({ select: profilesInsertSelect }));

  const from = vi.fn((table: string) => {
    if (table === "profiles") {
      return {
        select: profilesSelect,
        insert: profilesInsert,
      };
    }
    throw new Error(`Unexpected table: ${table}`);
  });
  const schema = vi.fn((name: string) => {
    if (name === "core") return { from };
    throw new Error(`Unexpected schema: ${name}`);
  });

  const client: MockSupabaseClient = {
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
    schema,
    from,
  };

  return { client, profilesMaybeSingle, profilesInsert, profilesInsertSingle };
}

function setUrl(href: string) {
  window.history.replaceState({}, "", href);
}

describe("bootstrapSession with the Supabase Auth adapter", () => {
  let mocks: ClientMocks;
  let client: MockSupabaseClient;

  beforeEach(() => {
    setUrl("http://localhost/");
    mocks = buildClient();
    client = mocks.client;
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
    // Existing row was found, so insert must not have run.
    expect(mocks.profilesInsert).not.toHaveBeenCalled();
  });

  it("inserts a new profiles row seeded from auth metadata when none exists", async () => {
    mocks = buildClient({ existingProfile: false });
    client = mocks.client;
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

    expect(client.schema).toHaveBeenCalledWith("core");
    expect(client.from).toHaveBeenCalledWith("profiles");
    expect(mocks.profilesInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "supabase-user-uuid",
        email: "scientist@example.com",
        display_name: "Scientist Name",
        first_name: "Scientist",
        last_name: "Name",
        avatar_url: null,
      }),
    );
  });

  it("does NOT overwrite a user-edited profiles row on subsequent sign-ins", async () => {
    // Regression for the 0.3.0 bug: ensureProfile must not re-derive
    // first_name/last_name from user_metadata.full_name when a row
    // already exists.
    mocks = buildClient({ existingProfile: true });
    client = mocks.client;
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

    expect(mocks.profilesInsert).not.toHaveBeenCalled();
    expect(mocks.profilesInsertSingle).not.toHaveBeenCalled();
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

  it("preserves user and account across transient phases when initialState is provided", async () => {
    // Models the rebootstrap scenario: Supabase fires SIGNED_IN on tab focus,
    // consumer calls bootstrapSession again. With initialState, the lib must
    // NOT briefly null out user/account during transient bootstrapping /
    // loading_profile / loading_account emits — that flicker is the bug we
    // are fixing.
    client.auth.getSession.mockResolvedValue({
      data: { session: buildSession() },
      error: null,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adapter = createSupabaseAuthAdapter({ supabase: client as any });

    // Simulate the "we are already signed in" baseline that a consumer would
    // have in its appState before the rebootstrap fires.
    const previousState: SessionState = {
      status: "ready",
      user: {
        sub: "supabase-user-uuid",
        email: "scientist@example.com",
        name: "Scientist Name",
        expired: false,
        profile: {},
      },
      account: {
        profile: {
          id: "supabase-user-uuid",
          email: "scientist@example.com",
          display_name: "Scientist Name",
          first_name: "Scientist",
          last_name: "Name",
          created_at: "2026-01-01T00:00:00Z",
        },
      },
      error: null,
    };

    const emits: SessionState[] = [];
    await bootstrapSession({
      auth: adapter,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: client as any,
      initialState: previousState,
      onStateChange: (s) => emits.push({ ...s }),
    });

    // Every emit during the rebootstrap MUST keep user/account non-null —
    // the previous values stay visible until the new authoritative ones arrive.
    for (const emit of emits) {
      expect(emit.user, `user must persist during ${emit.status}`).not.toBeNull();
      expect(emit.account, `account must persist during ${emit.status}`).not.toBeNull();
    }
  });

  it("starts with user/account null when no initialState is provided (first bootstrap)", async () => {
    // Regression guard: the existing first-bootstrap behavior must NOT change.
    // Without initialState, the function still emits user/account null until
    // they are loaded.
    client.auth.getSession.mockResolvedValue({
      data: { session: buildSession() },
      error: null,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adapter = createSupabaseAuthAdapter({ supabase: client as any });

    const emits: SessionState[] = [];
    await bootstrapSession({
      auth: adapter,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: client as any,
      onStateChange: (s) => emits.push({ ...s }),
    });

    // First emit (status: bootstrapping) is before any user/account fetch.
    expect(emits[0].status).toBe("bootstrapping");
    expect(emits[0].user).toBeNull();
    expect(emits[0].account).toBeNull();
  });

  it("reaches 'error' state if the profiles select fails", async () => {
    client.auth.getSession.mockResolvedValue({
      data: { session: buildSession() },
      error: null,
    });

    // Override profiles select chain to reject (RLS denial).
    client.from = vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi
            .fn()
            .mockResolvedValue({ data: null, error: new Error("rls denied") }),
        })),
      })),
      insert: vi.fn(),
    }));
    // Re-wire schema('core') to return the new from chain.
    client.schema = vi.fn(() => ({ from: client.from }));

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
