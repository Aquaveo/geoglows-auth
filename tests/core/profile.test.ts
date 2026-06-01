import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ensureProfile,
  isProfileComplete,
  updateProfile,
} from "../../src/core/profile";
import type { AuthUser, Profile } from "../../src/types";

interface MockSupabase {
  schema: ReturnType<typeof vi.fn>;
}

function buildAuthUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    sub: "user-uuid-1",
    email: "user@example.com",
    name: "Ada Lovelace",
    expired: false,
    profile: {
      full_name: "Ada Lovelace",
      avatar_url: "https://example.com/avatar.png",
    },
    ...overrides,
  };
}

function buildEnsureProfileMock(opts: {
  existing?: Partial<Profile> | null;
  inserted?: Partial<Profile>;
  selectError?: Error | null;
  insertError?: Error | null;
}) {
  const maybeSingle = vi.fn().mockResolvedValue({
    data: opts.existing ?? null,
    error: opts.selectError ?? null,
  });
  const eq = vi.fn(() => ({ maybeSingle }));
  const selectForLookup = vi.fn(() => ({ eq }));

  const insertSingle = vi.fn().mockResolvedValue({
    data: opts.inserted ?? {},
    error: opts.insertError ?? null,
  });
  const selectAfterInsert = vi.fn(() => ({ single: insertSingle }));
  const insert = vi.fn(() => ({ select: selectAfterInsert }));

  const from = vi.fn((table: string) => {
    if (table === "profiles") {
      return { select: selectForLookup, insert };
    }
    throw new Error(`Unexpected table: ${table}`);
  });
  const schema = vi.fn((name: string) => {
    if (name === "core") return { from };
    throw new Error(`Unexpected schema: ${name}`);
  });
  return { client: { schema } as MockSupabase, selectForLookup, eq, insert };
}

function buildProfileMockWithUpdate(returnedRow: Partial<Profile>) {
  const single = vi.fn().mockResolvedValue({ data: returnedRow, error: null });
  const select = vi.fn(() => ({ single }));
  const eq = vi.fn(() => ({ select }));
  const update = vi.fn(() => ({ eq }));
  const from = vi.fn((table: string) => {
    if (table === "profiles") return { update };
    throw new Error(`Unexpected table: ${table}`);
  });
  const schema = vi.fn((name: string) => {
    if (name === "core") return { from };
    throw new Error(`Unexpected schema: ${name}`);
  });
  return { client: { schema } as MockSupabase, update, eq };
}

describe("ensureProfile", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("inserts a new row seeded from user_metadata when none exists", async () => {
    const { client, insert } = buildEnsureProfileMock({
      existing: null,
      inserted: {
        id: "user-uuid-1",
        email: "user@example.com",
        display_name: "Ada Lovelace",
        first_name: "Ada",
        last_name: "Lovelace",
        avatar_url: "https://example.com/avatar.png",
      },
    });

    await ensureProfile(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client as any,
      buildAuthUser(),
    );

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "user-uuid-1",
        email: "user@example.com",
        display_name: "Ada Lovelace",
        first_name: "Ada",
        last_name: "Lovelace",
        avatar_url: "https://example.com/avatar.png",
      }),
    );
  });

  it("returns the existing row unchanged and does NOT insert when one is found", async () => {
    // Regression for the 0.3.0 bug: previously, ensureProfile re-derived
    // first_name/last_name from user_metadata.full_name on every sign-in
    // and overwrote user-edited values. With select-then-insert the
    // existing row is returned untouched.
    const userEditedRow: Partial<Profile> = {
      id: "user-uuid-1",
      email: "user@example.com",
      first_name: "Jerry",          // user edited this
      middle_name: "X",
      last_name: "Romero",
      display_name: "Jerry X Romero",
      user_type: "researcher",
    };
    const { client, insert } = buildEnsureProfileMock({
      existing: userEditedRow,
    });

    const result = await ensureProfile(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client as any,
      buildAuthUser({
        // user_metadata still says "Gerardo Romero" from sign-up time
        profile: { full_name: "Gerardo Romero" },
        name: "Gerardo Romero",
      }),
    );

    expect(insert).not.toHaveBeenCalled();
    expect(result.first_name).toBe("Jerry");
    expect(result.last_name).toBe("Romero");
    expect(result.display_name).toBe("Jerry X Romero");
  });

  it("falls back to null first/last when full_name is single-word", async () => {
    const { client, insert } = buildEnsureProfileMock({ existing: null });

    await ensureProfile(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client as any,
      buildAuthUser({
        profile: { full_name: "Madonna" },
        name: "Madonna",
      }),
    );

    const payload = insert.mock.calls[0][0];
    expect(payload.first_name).toBe("Madonna");
    expect(payload.last_name).toBeNull();
  });

  it("seeds first/last as null when no full_name on the user metadata", async () => {
    const { client, insert } = buildEnsureProfileMock({ existing: null });

    await ensureProfile(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client as any,
      buildAuthUser({ profile: {}, name: undefined }),
    );

    const payload = insert.mock.calls[0][0];
    expect(payload.first_name).toBeNull();
    expect(payload.last_name).toBeNull();
    expect(payload.avatar_url).toBeNull();
  });

  it("propagates select errors", async () => {
    const { client } = buildEnsureProfileMock({
      selectError: new Error("rls denied"),
    });

    await expect(
      ensureProfile(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        client as any,
        buildAuthUser(),
      ),
    ).rejects.toThrow(/rls denied/i);
  });

  it("propagates insert errors", async () => {
    const { client } = buildEnsureProfileMock({
      existing: null,
      insertError: new Error("unique violation"),
    });

    await expect(
      ensureProfile(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        client as any,
        buildAuthUser(),
      ),
    ).rejects.toThrow(/unique violation/i);
  });
});

describe("updateProfile", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("UPDATEs only the fields the caller provided, scoped to the user's id", async () => {
    const returnedRow: Partial<Profile> = {
      id: "user-uuid-1",
      email: "user@example.com",
      first_name: "Ada",
      last_name: "Lovelace",
      display_name: "Ada Lovelace",
      user_type: "researcher",
    };
    const { client, update, eq } = buildProfileMockWithUpdate(returnedRow);

    const result = await updateProfile(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client as any,
      {
        id: "user-uuid-1",
        first_name: "Ada",
        last_name: "Lovelace",
        user_type: "researcher",
      },
    );

    // Update payload omits id (it's used in the WHERE clause via .eq)
    // and adds a derived display_name from first/last/middle.
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        first_name: "Ada",
        last_name: "Lovelace",
        user_type: "researcher",
        display_name: "Ada Lovelace",
      }),
    );
    expect(eq).toHaveBeenCalledWith("id", "user-uuid-1");
    expect(result.first_name).toBe("Ada");
  });

  it("does not synthesize display_name when the caller didn't touch any name field", async () => {
    const { client, update } = buildProfileMockWithUpdate({});

    await updateProfile(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client as any,
      { id: "user-uuid-1", user_type: "researcher" },
    );

    const payload = update.mock.calls[0][0];
    expect(payload.display_name).toBeUndefined();
  });

  it("propagates upstream errors", async () => {
    const single = vi
      .fn()
      .mockResolvedValue({ data: null, error: new Error("invalid user_type") });
    const select = vi.fn(() => ({ single }));
    const eq = vi.fn(() => ({ select }));
    const update = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ update }));
    const schema = vi.fn(() => ({ from }));

    await expect(
      updateProfile(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { schema } as any,
        { id: "user-uuid-1", user_type: "researcher" },
      ),
    ).rejects.toThrow(/invalid user_type/i);
  });
});

describe("isProfileComplete", () => {
  it("returns true when first_name and last_name are both non-empty strings", () => {
    expect(
      isProfileComplete({
        id: "x",
        email: "x@y.com",
        display_name: null,
        first_name: "Ada",
        last_name: "Lovelace",
      }),
    ).toBe(true);
  });

  it("returns false when first_name is missing", () => {
    expect(
      isProfileComplete({
        id: "x",
        email: "x@y.com",
        display_name: null,
        last_name: "Lovelace",
      }),
    ).toBe(false);
  });

  it("returns false when last_name is missing", () => {
    expect(
      isProfileComplete({
        id: "x",
        email: "x@y.com",
        display_name: null,
        first_name: "Ada",
      }),
    ).toBe(false);
  });

  it("returns false for whitespace-only names", () => {
    expect(
      isProfileComplete({
        id: "x",
        email: "x@y.com",
        display_name: null,
        first_name: "   ",
        last_name: "Lovelace",
      }),
    ).toBe(false);
  });

  it("returns false for null profile", () => {
    expect(isProfileComplete(null)).toBe(false);
    expect(isProfileComplete(undefined)).toBe(false);
  });
});
