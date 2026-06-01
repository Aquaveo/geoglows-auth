import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ProfileEditForm } from "../../src/react/ProfileEditForm";
import type { Profile } from "../../src/types";

interface MockSupabase {
  schema: ReturnType<typeof vi.fn>;
}

function buildMock(returnedRow: Partial<Profile>) {
  const single = vi.fn().mockResolvedValue({ data: returnedRow, error: null });
  const select = vi.fn(() => ({ single }));
  const eq = vi.fn(() => ({ select }));
  const update = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ update }));
  const schema = vi.fn(() => ({ from }));
  return { client: { schema } as MockSupabase, update, eq };
}

const filledProfile: Profile = {
  id: "user-1",
  email: "user@example.com",
  display_name: "Ada Lovelace",
  first_name: "Ada",
  last_name: "Lovelace",
  user_type: "researcher",
  user_link: "https://ada.example.com",
};

function getInput(label: RegExp | string) {
  return screen.getByLabelText(label) as HTMLInputElement;
}

function getSubmitButton() {
  return screen.getByRole("button", { name: /save changes/i }) as HTMLButtonElement;
}

describe("<ProfileEditForm>", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("pre-fills from the profile prop", () => {
    const { client } = buildMock({});
    render(
      <ProfileEditForm
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        supabase={client as any}
        profile={filledProfile}
      />,
    );
    expect(getInput(/first name/i).value).toBe("Ada");
    expect(getInput(/last name/i).value).toBe("Lovelace");
    expect(getInput(/phone/i).value).toBe("+1-555-0001");
    expect(getInput(/user type/i).value).toBe("researcher");
  });

  it("disables Save until something has changed", () => {
    const { client } = buildMock({});
    render(
      <ProfileEditForm
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        supabase={client as any}
        profile={filledProfile}
      />,
    );
    expect(getSubmitButton()).toBeDisabled();

    fireEvent.change(getInput(/first name/i), { target: { value: "Augusta" } });
    expect(getSubmitButton()).not.toBeDisabled();
  });

  it("calls updateProfile with only the user-changed payload (omits id from the update)", async () => {
    const { client, update, eq } = buildMock({
      ...filledProfile,
      first_name: "Augusta",
    });
    const onSuccess = vi.fn();

    render(
      <ProfileEditForm
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        supabase={client as any}
        profile={filledProfile}
        onSuccess={onSuccess}
      />,
    );

    fireEvent.change(getInput(/first name/i), { target: { value: "Augusta" } });
    fireEvent.click(getSubmitButton());

    await vi.waitFor(() => {
      expect(update).toHaveBeenCalled();
    });

    const payload = update.mock.calls[0][0];
    expect(payload.first_name).toBe("Augusta");
    // Update payload must NOT carry id — that's used in the WHERE clause.
    expect(payload.id).toBeUndefined();
    expect(eq).toHaveBeenCalledWith("id", "user-1");

    await vi.waitFor(() => {
      expect(onSuccess).toHaveBeenCalled();
    });
  });

  it("Cancel fires onCancel and does NOT call updateProfile", () => {
    const { client, update } = buildMock({});
    const onCancel = vi.fn();

    render(
      <ProfileEditForm
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        supabase={client as any}
        profile={filledProfile}
        onCancel={onCancel}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("does NOT render Cancel when onCancel is not provided", () => {
    const { client } = buildMock({});
    render(
      <ProfileEditForm
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        supabase={client as any}
        profile={filledProfile}
      />,
    );
    expect(screen.queryByRole("button", { name: /cancel/i })).toBeNull();
  });

  it("validates that first_name is non-empty even when other fields are present", () => {
    const { client, update } = buildMock({});
    render(
      <ProfileEditForm
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        supabase={client as any}
        profile={filledProfile}
      />,
    );

    fireEvent.change(getInput(/first name/i), { target: { value: "" } });
    fireEvent.click(getSubmitButton());

    expect(screen.getByRole("alert")).toHaveTextContent(/first name/i);
    expect(update).not.toHaveBeenCalled();
  });

  it("renders all fields empty when profile has only id and email", () => {
    const { client } = buildMock({});
    render(
      <ProfileEditForm
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        supabase={client as any}
        profile={{ id: "u", email: "u@x.com", display_name: null }}
      />,
    );
    expect(getInput(/first name/i).value).toBe("");
    expect(getInput(/last name/i).value).toBe("");
    expect(getInput(/phone/i).value).toBe("");
  });
});
