import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const refreshMock = vi.fn(async () => {});
vi.mock("../../src/react/AuthProvider", () => ({
  useAuth: () => ({ refresh: refreshMock }),
}));

import { SupabaseAuthUI } from "../../src/react/SupabaseAuthUI";
import type { AuthUser, SupabaseAuthAdapter } from "../../src/types";

function buildAuthUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    sub: "user-1",
    email: "user@example.com",
    name: "User One",
    access_token: "token",
    id_token: undefined,
    expired: false,
    profile: {},
    ...overrides,
  };
}

interface MockAdapter extends SupabaseAuthAdapter {
  signInWithPassword: ReturnType<typeof vi.fn>;
  signInWithMagicLink: ReturnType<typeof vi.fn>;
  signInWithOAuth: ReturnType<typeof vi.fn>;
}

function buildAdapter(): MockAdapter {
  return {
    clearStaleAuthState: vi.fn(async () => {}),
    completeSignInIfNeeded: vi.fn(async () => null),
    getCurrentUser: vi.fn(async () => null),
    signInRedirect: vi.fn(async () => {}),
    signOutRedirect: vi.fn(async () => {}),
    setupTokenRenewal: vi.fn(),
    signInWithPassword: vi.fn(async () => buildAuthUser()),
    signInWithMagicLink: vi.fn(async () => {}),
    signInWithOAuth: vi.fn(async () => {}),
  };
}

function getEmailInput() {
  return screen.getByLabelText(/email/i) as HTMLInputElement;
}

function getPasswordInput() {
  return screen.getByLabelText(/password/i) as HTMLInputElement;
}

function getSubmitButton() {
  // Find the form's submit button by type, not by accessible name —
  // the magic-link toggle button also starts with "Sign in".
  const buttons = screen.getAllByRole("button") as HTMLButtonElement[];
  const submit = buttons.find((b) => b.type === "submit");
  if (!submit) throw new Error("Submit button not found in document");
  return submit;
}

describe("<SupabaseAuthUI>", () => {
  let adapter: MockAdapter;

  beforeEach(() => {
    adapter = buildAdapter();
    refreshMock.mockReset();
    refreshMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  describe("password mode (locked)", () => {
    it("calls signInWithPassword with trimmed email and password, refreshes, and fires onSuccess", async () => {
      const user = buildAuthUser({ sub: "abc" });
      adapter.signInWithPassword.mockResolvedValue(user);
      const onSuccess = vi.fn();

      render(
        <SupabaseAuthUI adapter={adapter} mode="password" onSuccess={onSuccess} />,
      );

      fireEvent.change(getEmailInput(), {
        target: { value: "  user@example.com  " },
      });
      fireEvent.change(getPasswordInput(), { target: { value: "hunter2" } });
      fireEvent.click(getSubmitButton());

      await vi.waitFor(() => {
        expect(adapter.signInWithPassword).toHaveBeenCalledWith({
          email: "user@example.com",
          password: "hunter2",
        });
      });
      await vi.waitFor(() => {
        expect(refreshMock).toHaveBeenCalled();
      });
      await vi.waitFor(() => {
        expect(onSuccess).toHaveBeenCalledWith(user);
      });
    });

    it("shows a validation message when submitted with empty email", async () => {
      render(<SupabaseAuthUI adapter={adapter} mode="password" />);

      fireEvent.change(getPasswordInput(), { target: { value: "hunter2" } });
      fireEvent.click(getSubmitButton());

      expect(screen.getByRole("alert")).toHaveTextContent(/email/i);
      expect(adapter.signInWithPassword).not.toHaveBeenCalled();
    });

    it("shows a validation message when submitted with empty password", async () => {
      render(<SupabaseAuthUI adapter={adapter} mode="password" />);

      fireEvent.change(getEmailInput(), {
        target: { value: "user@example.com" },
      });
      fireEvent.click(getSubmitButton());

      expect(screen.getByRole("alert")).toHaveTextContent(/password/i);
      expect(adapter.signInWithPassword).not.toHaveBeenCalled();
    });

    it("shows the adapter error message and calls onError when sign-in fails", async () => {
      adapter.signInWithPassword.mockRejectedValue(
        new Error("Invalid login credentials"),
      );
      const onError = vi.fn();
      const onSuccess = vi.fn();

      render(
        <SupabaseAuthUI
          adapter={adapter}
          mode="password"
          onError={onError}
          onSuccess={onSuccess}
        />,
      );

      fireEvent.change(getEmailInput(), {
        target: { value: "user@example.com" },
      });
      fireEvent.change(getPasswordInput(), { target: { value: "wrong" } });
      fireEvent.click(getSubmitButton());

      await vi.waitFor(() => {
        expect(screen.getByRole("alert")).toHaveTextContent(
          /invalid login credentials/i,
        );
      });
      expect(onError).toHaveBeenCalledWith(expect.any(Error));
      expect(onSuccess).not.toHaveBeenCalled();
      // Submit button is re-enabled
      expect(getSubmitButton()).not.toBeDisabled();
    });

    it("still fires onSuccess if AuthProvider.refresh() rejects (auth/data separation)", async () => {
      const user = buildAuthUser();
      adapter.signInWithPassword.mockResolvedValue(user);
      refreshMock.mockRejectedValueOnce(new Error("RLS denied"));
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const onSuccess = vi.fn();

      render(
        <SupabaseAuthUI adapter={adapter} mode="password" onSuccess={onSuccess} />,
      );

      fireEvent.change(getEmailInput(), {
        target: { value: "user@example.com" },
      });
      fireEvent.change(getPasswordInput(), { target: { value: "hunter2" } });
      fireEvent.click(getSubmitButton());

      await vi.waitFor(() => {
        expect(onSuccess).toHaveBeenCalledWith(user);
      });
      expect(errorSpy).toHaveBeenCalled();
    });

    it("disables the submit button while a request is in flight", async () => {
      let resolveSignIn: (user: AuthUser) => void = () => {};
      adapter.signInWithPassword.mockImplementation(
        () =>
          new Promise<AuthUser>((resolve) => {
            resolveSignIn = resolve;
          }),
      );

      render(<SupabaseAuthUI adapter={adapter} mode="password" />);

      fireEvent.change(getEmailInput(), {
        target: { value: "user@example.com" },
      });
      fireEvent.change(getPasswordInput(), { target: { value: "hunter2" } });
      fireEvent.click(getSubmitButton());

      await vi.waitFor(() => expect(getSubmitButton()).toBeDisabled());
      resolveSignIn(buildAuthUser());
      await vi.waitFor(() => expect(getSubmitButton()).not.toBeDisabled());
    });
  });

  describe("magic-link mode (locked)", () => {
    it("calls signInWithMagicLink and shows the confirmation state", async () => {
      render(<SupabaseAuthUI adapter={adapter} mode="magicLink" />);

      fireEvent.change(getEmailInput(), {
        target: { value: "user@example.com" },
      });
      fireEvent.click(getSubmitButton());

      await vi.waitFor(() => {
        expect(adapter.signInWithMagicLink).toHaveBeenCalledWith({
          email: "user@example.com",
          redirectTo: undefined,
        });
      });
      await vi.waitFor(() => {
        expect(screen.getByRole("status")).toHaveTextContent(
          /check your email/i,
        );
      });
    });

    it("forwards magicLinkRedirectTo to the adapter", async () => {
      render(
        <SupabaseAuthUI
          adapter={adapter}
          mode="magicLink"
          magicLinkRedirectTo="https://app.example.com/auth/callback"
        />,
      );

      fireEvent.change(getEmailInput(), {
        target: { value: "user@example.com" },
      });
      fireEvent.click(getSubmitButton());

      await vi.waitFor(() => {
        expect(adapter.signInWithMagicLink).toHaveBeenCalledWith({
          email: "user@example.com",
          redirectTo: "https://app.example.com/auth/callback",
        });
      });
    });

    it("renders a custom magicLinkSentMessage when provided", async () => {
      render(
        <SupabaseAuthUI
          adapter={adapter}
          mode="magicLink"
          magicLinkSentMessage="Magic link sent — go check Gmail."
        />,
      );

      fireEvent.change(getEmailInput(), {
        target: { value: "user@example.com" },
      });
      fireEvent.click(getSubmitButton());

      await vi.waitFor(() => {
        expect(screen.getByRole("status")).toHaveTextContent(
          /go check gmail/i,
        );
      });
    });

    it("does not show a password field in magic-link mode", () => {
      render(<SupabaseAuthUI adapter={adapter} mode="magicLink" />);
      expect(screen.queryByLabelText(/password/i)).toBeNull();
    });

    it("validates that email is required before sending", () => {
      render(<SupabaseAuthUI adapter={adapter} mode="magicLink" />);
      fireEvent.click(getSubmitButton());
      expect(screen.getByRole("alert")).toHaveTextContent(/email/i);
      expect(adapter.signInWithMagicLink).not.toHaveBeenCalled();
    });
  });

  describe("toggle mode (mode prop omitted)", () => {
    it("starts in password mode and exposes a toggle to magic link", () => {
      render(<SupabaseAuthUI adapter={adapter} />);

      expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /magic link/i }),
      ).toBeInTheDocument();
    });

    it("switches to magic-link mode when the toggle is clicked, hiding password", () => {
      render(<SupabaseAuthUI adapter={adapter} />);

      fireEvent.click(screen.getByRole("button", { name: /magic link/i }));

      expect(screen.queryByLabelText(/password/i)).toBeNull();
      expect(
        screen.getByRole("button", { name: /password/i }),
      ).toBeInTheDocument();
    });

    it("clears errors and password when toggling modes", () => {
      render(<SupabaseAuthUI adapter={adapter} />);

      fireEvent.change(getEmailInput(), {
        target: { value: "user@example.com" },
      });
      fireEvent.change(getPasswordInput(), { target: { value: "secret" } });
      // Trigger validation error
      fireEvent.change(getEmailInput(), { target: { value: "" } });
      fireEvent.click(getSubmitButton());
      expect(screen.getByRole("alert")).toBeInTheDocument();

      // Toggle modes
      fireEvent.click(screen.getByRole("button", { name: /magic link/i }));

      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("after a successful magic-link send, can toggle back to password mode", async () => {
      render(<SupabaseAuthUI adapter={adapter} />);

      fireEvent.click(screen.getByRole("button", { name: /magic link/i }));
      fireEvent.change(getEmailInput(), {
        target: { value: "user@example.com" },
      });
      fireEvent.click(getSubmitButton());

      await vi.waitFor(() => {
        expect(screen.getByRole("status")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole("button", { name: /password/i }));

      expect(screen.queryByRole("status")).toBeNull();
      expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    });
  });
});
