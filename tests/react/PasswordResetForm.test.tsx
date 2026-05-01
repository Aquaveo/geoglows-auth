import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PasswordResetForm } from "../../src/react/PasswordResetForm";
import type { SupabaseAuthAdapter } from "../../src/types";

interface BuildOpts {
  resetPasswordForEmail?: ReturnType<typeof vi.fn>;
}

function buildAdapter(opts: BuildOpts = {}): SupabaseAuthAdapter {
  const resetPasswordForEmail =
    opts.resetPasswordForEmail ?? vi.fn().mockResolvedValue(undefined);
  return {
    resetPasswordForEmail,
    signInWithPassword: vi.fn(),
    signInWithMagicLink: vi.fn(),
    signInWithOAuth: vi.fn(),
    signUpWithPassword: vi.fn(),
    updateUserPassword: vi.fn(),
    signOutOtherSessions: vi.fn(),
    clearStaleAuthState: vi.fn(),
    completeSignInIfNeeded: vi.fn(),
    getCurrentUser: vi.fn(),
    signInRedirect: vi.fn(),
    signOutRedirect: vi.fn(),
    setupTokenRenewal: vi.fn(),
  } as unknown as SupabaseAuthAdapter;
}

// Suppress lint noise — `React` is the JSX namespace; explicit reference
// keeps it in the binding so TS tooling doesn't drop the import.
void React;

describe("<PasswordResetForm>", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders email input and submit button", () => {
    render(<PasswordResetForm adapter={buildAdapter()} />);
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /send reset link/i }),
    ).toBeInTheDocument();
  });

  it("calls adapter.resetPasswordForEmail with the email and configured redirectTo", async () => {
    const adapter = buildAdapter();
    const onSuccess = vi.fn();
    render(
      <PasswordResetForm
        adapter={adapter}
        redirectTo="https://app.example.com/recover"
        onSuccess={onSuccess}
      />,
    );

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "ada@example.com" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /send reset link/i }),
    );

    await waitFor(() => {
      expect(adapter.resetPasswordForEmail).toHaveBeenCalledWith({
        email: "ada@example.com",
        redirectTo: "https://app.example.com/recover",
      });
    });
    expect(onSuccess).toHaveBeenCalledWith("ada@example.com");
  });

  it("rejects empty email; adapter NOT called", () => {
    const adapter = buildAdapter();
    render(<PasswordResetForm adapter={adapter} />);
    fireEvent.click(
      screen.getByRole("button", { name: /send reset link/i }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/email/i);
    expect(adapter.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("renders generic error when adapter rejects (does NOT leak Supabase error message)", async () => {
    const onError = vi.fn();
    const adapter = buildAdapter({
      resetPasswordForEmail: vi
        .fn()
        .mockRejectedValue(
          new Error("Email rate limit exceeded for ada@example.com"),
        ),
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(<PasswordResetForm adapter={adapter} onError={onError} />);

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "ada@example.com" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /send reset link/i }),
    );

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    // Generic error rendered; raw Supabase message NOT exposed.
    expect(screen.getByRole("alert").textContent).not.toMatch(/rate limit/i);
    expect(screen.getByRole("alert").textContent).not.toMatch(/ada@/);
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    errSpy.mockRestore();
  });

  it("renders email value as React text — XSS regression guard", () => {
    render(<PasswordResetForm adapter={buildAdapter()} />);
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: '<img src=x onerror="alert(1)">' },
    });
    expect(document.querySelector("img[onerror]")).toBeNull();
  });

  it("calls onCancel when 'Back to sign in' button is clicked", () => {
    const adapter = buildAdapter();
    const onCancel = vi.fn();
    render(<PasswordResetForm adapter={adapter} onCancel={onCancel} />);
    fireEvent.click(
      screen.getByRole("button", { name: /back to sign in/i }),
    );
    expect(onCancel).toHaveBeenCalled();
    expect(adapter.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("disables submit while pending", async () => {
    let resolve: () => void = () => {};
    const adapter = buildAdapter({
      resetPasswordForEmail: vi.fn().mockImplementation(
        () =>
          new Promise<void>((r) => {
            resolve = r;
          }),
      ),
    });
    render(<PasswordResetForm adapter={adapter} />);

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "ada@example.com" },
    });
    const submit = screen.getByRole("button", {
      name: /send reset link/i,
    });
    fireEvent.click(submit);

    await waitFor(() => {
      expect(submit).toBeDisabled();
    });

    resolve();
  });
});
