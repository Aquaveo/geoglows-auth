import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { SetNewPasswordForm } from "../../src/react/SetNewPasswordForm";
import type { AuthUser, SupabaseAuthAdapter } from "../../src/types";

void React;

interface BuildOpts {
  updateUserPassword?: ReturnType<typeof vi.fn>;
  signOutOtherSessions?: ReturnType<typeof vi.fn>;
  getCurrentUser?: ReturnType<typeof vi.fn>;
}

function buildUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    sub: "u-recovery",
    email: "recovery-target@example.com",
    expired: false,
    profile: {},
    ...overrides,
  };
}

function buildAdapter(opts: BuildOpts = {}): SupabaseAuthAdapter {
  const updateUserPassword =
    opts.updateUserPassword ?? vi.fn().mockResolvedValue(undefined);
  const signOutOtherSessions =
    opts.signOutOtherSessions ?? vi.fn().mockResolvedValue(undefined);
  const getCurrentUser =
    opts.getCurrentUser ?? vi.fn().mockResolvedValue(buildUser());
  return {
    updateUserPassword,
    signOutOtherSessions,
    getCurrentUser,
    resetPasswordForEmail: vi.fn(),
    signInWithPassword: vi.fn(),
    signInWithMagicLink: vi.fn(),
    signInWithOAuth: vi.fn(),
    signUpWithPassword: vi.fn(),
    clearStaleAuthState: vi.fn(),
    completeSignInIfNeeded: vi.fn(),
    signInRedirect: vi.fn(),
    signOutRedirect: vi.fn(),
    setupTokenRenewal: vi.fn(),
  } as unknown as SupabaseAuthAdapter;
}

describe("<SetNewPasswordForm>", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("wrong-account header (R6)", () => {
    it("calls adapter.getCurrentUser on mount and renders 'Resetting password for <email>'", async () => {
      const adapter = buildAdapter();
      render(<SetNewPasswordForm adapter={adapter} />);

      await waitFor(() => {
        expect(adapter.getCurrentUser).toHaveBeenCalled();
      });
      await waitFor(() => {
        expect(
          screen.getByText(/recovery-target@example\.com/),
        ).toBeInTheDocument();
      });
    });

    it("renders generic 'Resetting password' + warning when getCurrentUser returns null (B2 race)", async () => {
      const adapter = buildAdapter({
        getCurrentUser: vi.fn().mockResolvedValue(null),
      });
      render(<SetNewPasswordForm adapter={adapter} />);

      await waitFor(() => {
        expect(adapter.getCurrentUser).toHaveBeenCalled();
      });
      // No email rendered; warning text shown.
      expect(
        screen.getByText(/unable to confirm/i),
      ).toBeInTheDocument();
    });

    it("escapes user-controlled email via JSX (XSS regression)", async () => {
      const adapter = buildAdapter({
        getCurrentUser: vi.fn().mockResolvedValue(
          buildUser({ email: '<img src=x onerror="alert(1)">' }),
        ),
      });
      render(<SetNewPasswordForm adapter={adapter} />);

      await waitFor(() => {
        expect(adapter.getCurrentUser).toHaveBeenCalled();
      });
      expect(document.querySelector("img[onerror]")).toBeNull();
    });
  });

  describe("submit flow", () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
    });

    it("happy path: updateUserPassword → signOutOtherSessions → success message → onSuccess fires after linger", async () => {
      const adapter = buildAdapter();
      const onSuccess = vi.fn();
      render(<SetNewPasswordForm adapter={adapter} onSuccess={onSuccess} />);

      // Wait for the user fetch to settle so the form is fully rendered.
      await waitFor(() => {
        expect(adapter.getCurrentUser).toHaveBeenCalled();
      });

      fireEvent.change(screen.getByLabelText(/new password/i), {
        target: { value: "new-strong-password" },
      });
      fireEvent.click(screen.getByRole("button", { name: /set new password/i }));

      await waitFor(() => {
        expect(adapter.updateUserPassword).toHaveBeenCalledWith({
          password: "new-strong-password",
        });
      });
      await waitFor(() => {
        expect(adapter.signOutOtherSessions).toHaveBeenCalled();
      });
      // Success message rendered before close.
      await waitFor(() => {
        expect(
          screen.getByText(/signed.*out.*other|password updated/i),
        ).toBeInTheDocument();
      });
      // onSuccess fires after the ~1.5s linger.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1600);
      });
      expect(onSuccess).toHaveBeenCalled();
    });

    it("rejects empty password; updateUserPassword NOT called", async () => {
      const adapter = buildAdapter();
      render(<SetNewPasswordForm adapter={adapter} />);
      await waitFor(() => {
        expect(adapter.getCurrentUser).toHaveBeenCalled();
      });

      fireEvent.click(screen.getByRole("button", { name: /set new password/i }));
      expect(screen.getByRole("alert")).toHaveTextContent(/password/i);
      expect(adapter.updateUserPassword).not.toHaveBeenCalled();
    });

    it("validation error (e.g. password too weak): renders inline error; stays on form", async () => {
      const adapter = buildAdapter({
        updateUserPassword: vi
          .fn()
          .mockRejectedValue(
            new Error("New password should be at least 6 characters"),
          ),
      });
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      render(<SetNewPasswordForm adapter={adapter} />);
      await waitFor(() => {
        expect(adapter.getCurrentUser).toHaveBeenCalled();
      });

      fireEvent.change(screen.getByLabelText(/new password/i), {
        target: { value: "x" },
      });
      fireEvent.click(screen.getByRole("button", { name: /set new password/i }));

      await waitFor(() => {
        expect(screen.getByRole("alert")).toBeInTheDocument();
      });
      // Generic error; no leak of "at least 6 characters"
      expect(screen.getByRole("alert").textContent).not.toMatch(
        /6 characters/,
      );
      // Form still rendered (the password input is still mounted).
      expect(screen.getByLabelText(/new password/i)).toBeInTheDocument();
      errSpy.mockRestore();
    });

    it("auth-error (recovery session expired): fires onExpired; component does NOT render expired view itself", async () => {
      const adapter = buildAdapter({
        updateUserPassword: vi.fn().mockRejectedValue(
          Object.assign(new Error("Invalid Refresh Token"), {
            code: "refresh_token_not_found",
          }),
        ),
      });
      const onExpired = vi.fn();
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      render(
        <SetNewPasswordForm adapter={adapter} onExpired={onExpired} />,
      );
      await waitFor(() => {
        expect(adapter.getCurrentUser).toHaveBeenCalled();
      });

      fireEvent.change(screen.getByLabelText(/new password/i), {
        target: { value: "anything" },
      });
      fireEvent.click(screen.getByRole("button", { name: /set new password/i }));

      await waitFor(() => {
        expect(onExpired).toHaveBeenCalled();
      });
      errSpy.mockRestore();
    });

    it("signOutOtherSessions failure does NOT block onSuccess (best-effort)", async () => {
      const adapter = buildAdapter({
        signOutOtherSessions: vi
          .fn()
          .mockRejectedValue(new Error("network down")),
      });
      const onSuccess = vi.fn();
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      render(<SetNewPasswordForm adapter={adapter} onSuccess={onSuccess} />);
      await waitFor(() => {
        expect(adapter.getCurrentUser).toHaveBeenCalled();
      });

      fireEvent.change(screen.getByLabelText(/new password/i), {
        target: { value: "new-strong-password" },
      });
      fireEvent.click(screen.getByRole("button", { name: /set new password/i }));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1600);
      });
      expect(onSuccess).toHaveBeenCalled();
      expect(errSpy).toHaveBeenCalled();
      errSpy.mockRestore();
    });
  });

  describe("G5 unmount-during-linger", () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
    });

    it("does NOT fire onSuccess if unmounted during the success linger window", async () => {
      const adapter = buildAdapter();
      const onSuccess = vi.fn();
      const { unmount } = render(
        <SetNewPasswordForm adapter={adapter} onSuccess={onSuccess} />,
      );
      await waitFor(() => {
        expect(adapter.getCurrentUser).toHaveBeenCalled();
      });

      fireEvent.change(screen.getByLabelText(/new password/i), {
        target: { value: "new-strong-password" },
      });
      fireEvent.click(screen.getByRole("button", { name: /set new password/i }));

      // Wait for the post-update success state to render.
      await waitFor(() => {
        expect(adapter.updateUserPassword).toHaveBeenCalled();
      });

      // Mid-linger unmount (well before 1500ms).
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
      unmount();

      // Past the original linger window.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });

      expect(onSuccess).not.toHaveBeenCalled();
    });
  });

  describe("cancel", () => {
    it("calls onCancel when 'Back to sign in' is clicked; updateUserPassword NOT called", async () => {
      const adapter = buildAdapter();
      const onCancel = vi.fn();
      render(<SetNewPasswordForm adapter={adapter} onCancel={onCancel} />);
      await waitFor(() => {
        expect(adapter.getCurrentUser).toHaveBeenCalled();
      });
      fireEvent.click(screen.getByRole("button", { name: /back to sign in/i }));
      expect(onCancel).toHaveBeenCalled();
      expect(adapter.updateUserPassword).not.toHaveBeenCalled();
    });
  });
});
