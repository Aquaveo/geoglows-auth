import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ProfileSetupForm } from "../../src/react/ProfileSetupForm";
import type { Profile } from "../../src/types";

interface MockSupabase {
  schema: ReturnType<typeof vi.fn>;
}

function buildProfileMockWithUpdate(returnedRow: Partial<Profile>) {
  const single = vi.fn().mockResolvedValue({ data: returnedRow, error: null });
  const select = vi.fn(() => ({ single }));
  const eq = vi.fn(() => ({ select }));
  const update = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ update }));
  const schema = vi.fn(() => ({ from }));
  return { client: { schema } as MockSupabase, update, eq };
}

const baseProfile: Profile = {
  id: "user-1",
  email: "user@example.com",
  display_name: null,
};

function getInput(label: RegExp | string) {
  return screen.getByLabelText(label) as HTMLInputElement;
}

function getSubmitButton() {
  return screen.getByRole("button", { name: /save and continue/i }) as HTMLButtonElement;
}

describe("<ProfileSetupForm>", () => {
  beforeEach(() => {});
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("submits filled fields via updateProfile and fires onSuccess", async () => {
    const returned: Partial<Profile> = {
      ...baseProfile,
      first_name: "Ada",
      last_name: "Lovelace",
      user_type: "researcher",
      display_name: "Ada Lovelace",
    };
    const { client, update, eq } = buildProfileMockWithUpdate(returned);
    const onSuccess = vi.fn();

    render(
      <ProfileSetupForm
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        supabase={client as any}
        profile={baseProfile}
        onSuccess={onSuccess}
      />,
    );

    fireEvent.change(getInput(/first name/i), { target: { value: "Ada" } });
    fireEvent.change(getInput(/last name/i), { target: { value: "Lovelace" } });
    fireEvent.change(getInput(/user type/i), {
      target: { value: "researcher" },
    });
    fireEvent.change(getInput(/personal link/i), {
      target: { value: "https://ada.example.com" },
    });

    fireEvent.click(getSubmitButton());

    await vi.waitFor(() => {
      expect(update).toHaveBeenCalled();
    });

    const updatePayload = update.mock.calls[0][0];
    expect(updatePayload.first_name).toBe("Ada");
    expect(updatePayload.last_name).toBe("Lovelace");
    expect(updatePayload.user_type).toBe("researcher");
    expect(updatePayload.user_link).toBe("https://ada.example.com");
    expect(eq).toHaveBeenCalledWith("id", "user-1");

    await vi.waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith(
        expect.objectContaining({ first_name: "Ada", last_name: "Lovelace" }),
      );
    });
  });

  it("pre-fills from existingProfile and lets the user keep / change values", async () => {
    const existingProfile: Profile = {
      ...baseProfile,
      first_name: "Ada",
      last_name: "Lovelace",
      phone_number: "+1-555-0001",
    };
    const { client, update } = buildProfileMockWithUpdate(existingProfile);

    render(
      <ProfileSetupForm
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        supabase={client as any}
        profile={existingProfile}
      />,
    );

    expect(getInput(/first name/i).value).toBe("Ada");
    expect(getInput(/last name/i).value).toBe("Lovelace");
    expect(getInput(/phone/i).value).toBe("+1-555-0001");

    // Edit phone, submit
    fireEvent.change(getInput(/phone/i), { target: { value: "+1-555-9999" } });
    fireEvent.click(getSubmitButton());

    await vi.waitFor(() => {
      expect(update).toHaveBeenCalled();
    });
    expect(update.mock.calls[0][0].phone_number).toBe("+1-555-9999");
  });

  it("shows a validation error and does NOT call updateProfile when first name is empty", () => {
    const { client, update } = buildProfileMockWithUpdate({});

    render(
      <ProfileSetupForm
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        supabase={client as any}
        profile={baseProfile}
      />,
    );

    fireEvent.change(getInput(/last name/i), { target: { value: "Lovelace" } });
    fireEvent.click(getSubmitButton());

    expect(screen.getByRole("alert")).toHaveTextContent(/first name/i);
    expect(update).not.toHaveBeenCalled();
  });

  it("shows a validation error for an invalid user_link URL", () => {
    const { client, update } = buildProfileMockWithUpdate({});

    render(
      <ProfileSetupForm
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        supabase={client as any}
        profile={baseProfile}
      />,
    );

    fireEvent.change(getInput(/first name/i), { target: { value: "Ada" } });
    fireEvent.change(getInput(/last name/i), { target: { value: "Lovelace" } });
    fireEvent.change(getInput(/personal link/i), {
      target: { value: "javascript:alert(1)" },
    });
    fireEvent.click(getSubmitButton());

    expect(screen.getByRole("alert")).toHaveTextContent(/http:\/\/ or https:\/\//i);
    expect(update).not.toHaveBeenCalled();
  });

  it("shows a generic error and forwards the raw Error to onError when updateProfile rejects", async () => {
    const single = vi
      .fn()
      .mockResolvedValue({ data: null, error: new Error("permission denied") });
    const select = vi.fn(() => ({ single }));
    const eq = vi.fn(() => ({ select }));
    const update = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ update }));
    const schema = vi.fn(() => ({ from }));
    const onError = vi.fn();

    render(
      <ProfileSetupForm
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        supabase={{ schema } as any}
        profile={baseProfile}
        onError={onError}
      />,
    );

    fireEvent.change(getInput(/first name/i), { target: { value: "Ada" } });
    fireEvent.change(getInput(/last name/i), { target: { value: "Lovelace" } });
    fireEvent.click(getSubmitButton());

    await vi.waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        /couldn't save your profile/i,
      );
    });
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    // The visible message is generic; the raw error is on the onError side.
    expect(onError.mock.calls[0][0].message).toMatch(/permission denied/i);
  });

  it("renders the Skip button only when onSkip is provided", () => {
    const { client } = buildProfileMockWithUpdate({});
    const { rerender } = render(
      <ProfileSetupForm
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        supabase={client as any}
        profile={baseProfile}
      />,
    );
    expect(screen.queryByRole("button", { name: /skip/i })).toBeNull();

    const onSkip = vi.fn();
    rerender(
      <ProfileSetupForm
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        supabase={client as any}
        profile={baseProfile}
        onSkip={onSkip}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /skip/i }));
    expect(onSkip).toHaveBeenCalled();
  });

  it("displays the user's email read-only", () => {
    const { client } = buildProfileMockWithUpdate({});
    render(
      <ProfileSetupForm
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        supabase={client as any}
        profile={{ ...baseProfile, email: "scientist@example.com" }}
      />,
    );
    expect(screen.getByText(/scientist@example.com/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^email/i)).toBeNull();
  });
});
