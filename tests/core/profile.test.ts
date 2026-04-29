import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ensureProfile,
  isProfileComplete,
  updateProfile,
} from "../../src/core/profile";
import type { AuthUser, Profile } from "../../src/types";

interface MockSupabase {
  from: ReturnType<typeof vi.fn>;
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

function buildProfileMockWithUpsert(returnedRow: Partial<Profile>) {
  const single = vi.fn().mockResolvedValue({ data: returnedRow, error: null });
  const select = vi.fn(() => ({ single }));
  const upsert = vi.fn(() => ({ select }));
  const from = vi.fn((table: string) => {
    if (table === "profiles") return { upsert };
    throw new Error(`Unexpected table: ${table}`);
  });
  return { client: { from } as MockSupabase, upsert };
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
  return { client: { from } as MockSupabase, update, eq };
}

describe("ensureProfile", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("upserts with id, email, display_name, and seeds names from full_name", async () => {
    const { client, upsert } = buildProfileMockWithUpsert({
      id: "user-uuid-1",
      email: "user@example.com",
      display_name: "Ada Lovelace",
      first_name: "Ada",
      last_name: "Lovelace",
      avatar_url: "https://example.com/avatar.png",
    });

    await ensureProfile(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client as any,
      buildAuthUser(),
    );

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "user-uuid-1",
        email: "user@example.com",
        display_name: "Ada Lovelace",
        first_name: "Ada",
        last_name: "Lovelace",
        avatar_url: "https://example.com/avatar.png",
      }),
      expect.objectContaining({ onConflict: "id", ignoreDuplicates: false }),
    );
  });

  it("falls back to null first/last when full_name is single-word or missing", async () => {
    const { client, upsert } = buildProfileMockWithUpsert({});

    await ensureProfile(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client as any,
      buildAuthUser({
        profile: { full_name: "Madonna" },
        name: "Madonna",
      }),
    );

    const payload = upsert.mock.calls[0][0];
    expect(payload.first_name).toBe("Madonna");
    expect(payload.last_name).toBeNull();
  });

  it("seeds first/last as null when no full_name on the user metadata", async () => {
    const { client, upsert } = buildProfileMockWithUpsert({});

    await ensureProfile(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client as any,
      buildAuthUser({ profile: {}, name: undefined }),
    );

    const payload = upsert.mock.calls[0][0];
    expect(payload.first_name).toBeNull();
    expect(payload.last_name).toBeNull();
    expect(payload.avatar_url).toBeNull();
  });

  it("propagates upstream errors", async () => {
    const single = vi
      .fn()
      .mockResolvedValue({ data: null, error: new Error("rls denied") });
    const select = vi.fn(() => ({ single }));
    const upsert = vi.fn(() => ({ select }));
    const from = vi.fn(() => ({ upsert }));

    await expect(
      ensureProfile(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { from } as any,
        buildAuthUser(),
      ),
    ).rejects.toThrow(/rls denied/i);
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
      phone_number: "+1-555",
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
        phone_number: "+1-555",
        user_type: "researcher",
      },
    );

    // Update payload omits id (it's used in the WHERE clause via .eq)
    // and adds a derived display_name from first/last/middle.
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        first_name: "Ada",
        last_name: "Lovelace",
        phone_number: "+1-555",
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
      { id: "user-uuid-1", phone_number: "+1-555" },
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

    await expect(
      updateProfile(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { from } as any,
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
