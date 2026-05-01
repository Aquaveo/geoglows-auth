import * as React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockedObject,
} from "vitest";
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

// Preserves per-method signatures so `.mockResolvedValue(...)` is type-checked
// against each method's actual return type rather than collapsing to `any`.
type MockAdapter = MockedObject<SupabaseAuthAdapter>;

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
  return screen.getByLabelText("Email") as HTMLInputElement;
}

function getPasswordInput() {
  return screen.getByLabelText("Password") as HTMLInputElement;
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

    it("rejects whitespace-only passwords as if empty", () => {
      render(<SupabaseAuthUI adapter={adapter} mode="password" />);

      fireEvent.change(getEmailInput(), {
        target: { value: "user@example.com" },
      });
      fireEvent.change(getPasswordInput(), { target: { value: "   " } });
      fireEvent.click(getSubmitButton());

      expect(screen.getByRole("alert")).toHaveTextContent(/password/i);
      expect(adapter.signInWithPassword).not.toHaveBeenCalled();
    });

    it("preserves passwords that contain leading/trailing spaces (does not trim before forwarding)", async () => {
      const user = buildAuthUser();
      adapter.signInWithPassword.mockResolvedValue(user);

      render(<SupabaseAuthUI adapter={adapter} mode="password" />);

      fireEvent.change(getEmailInput(), {
        target: { value: "user@example.com" },
      });
      fireEvent.change(getPasswordInput(), { target: { value: " spaced " } });
      fireEvent.click(getSubmitButton());

      await vi.waitFor(() => {
        expect(adapter.signInWithPassword).toHaveBeenCalledWith({
          email: "user@example.com",
          password: " spaced ",
        });
      });
    });

    it("shows a generic error and forwards the raw error to onError when sign-in fails", async () => {
      const rawError = new Error("Email not confirmed");
      adapter.signInWithPassword.mockRejectedValue(rawError);
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
        // Visible message must be generic — never leak the raw backend message
        // (e.g. "Email not confirmed") because it enables account enumeration.
        expect(screen.getByRole("alert")).toHaveTextContent(
          /sign-in failed\. please check your email and password/i,
        );
        expect(screen.getByRole("alert")).not.toHaveTextContent(
          /email not confirmed/i,
        );
      });
      // The raw error still flows to onError so consumers can log it.
      expect(onError).toHaveBeenCalledWith(rawError);
      expect(onSuccess).not.toHaveBeenCalled();
      expect(getSubmitButton()).not.toBeDisabled();
      // Password is cleared after a failed attempt so a stale value doesn't
      // linger in component state or in the input's DOM value.
      expect(getPasswordInput().value).toBe("");
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
      // Verify we log only the message string (not the raw error object) to
      // avoid leaking internal Supabase response details into log forwarders.
      expect(errorSpy).toHaveBeenCalledWith(
        "AuthProvider refresh failed after sign-in:",
        "RLS denied",
      );
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

    it("shows a generic error and forwards the raw error to onError when magic-link send fails", async () => {
      const rawError = new Error("Rate limited");
      adapter.signInWithMagicLink.mockRejectedValue(rawError);
      const onError = vi.fn();

      render(
        <SupabaseAuthUI adapter={adapter} mode="magicLink" onError={onError} />,
      );

      fireEvent.change(getEmailInput(), {
        target: { value: "user@example.com" },
      });
      fireEvent.click(getSubmitButton());

      await vi.waitFor(() => {
        expect(screen.getByRole("alert")).toHaveTextContent(
          /couldn't send the sign-in link/i,
        );
        expect(screen.getByRole("alert")).not.toHaveTextContent(
          /rate limited/i,
        );
      });
      expect(onError).toHaveBeenCalledWith(rawError);
      expect(screen.queryByRole("status")).toBeNull();
      expect(getSubmitButton()).not.toBeDisabled();
    });

    it("returns to the form when the user clicks 'Use a different email address' on the confirmation panel", async () => {
      render(<SupabaseAuthUI adapter={adapter} mode="magicLink" />);

      fireEvent.change(getEmailInput(), {
        target: { value: "typo@example.com" },
      });
      fireEvent.click(getSubmitButton());

      await vi.waitFor(() => {
        expect(screen.getByRole("status")).toBeInTheDocument();
      });

      fireEvent.click(
        screen.getByRole("button", { name: /different email address/i }),
      );

      // Form is back, email input is empty.
      expect(screen.queryByRole("status")).toBeNull();
      expect(getEmailInput().value).toBe("");
    });

    it("does not render the password-toggle button when locked", async () => {
      render(<SupabaseAuthUI adapter={adapter} mode="magicLink" />);

      fireEvent.change(getEmailInput(), {
        target: { value: "user@example.com" },
      });
      fireEvent.click(getSubmitButton());

      await vi.waitFor(() => {
        expect(screen.getByRole("status")).toBeInTheDocument();
      });
      expect(
        screen.queryByRole("button", { name: /password/i }),
      ).toBeNull();
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

  describe("onForgotPasswordClick prop", () => {
    it("renders 'Forgot password?' button when onForgotPasswordClick provided AND mode=password", () => {
      const adapter = buildAdapter();
      const onForgotPasswordClick = vi.fn();
      render(
        <SupabaseAuthUI
          adapter={adapter}
          mode="password"
          onForgotPasswordClick={onForgotPasswordClick}
        />,
      );
      const link = screen.getByRole("button", { name: /forgot password/i });
      expect(link).toBeInTheDocument();
      expect(link.tagName).toBe("BUTTON");
      expect(link.getAttribute("type")).toBe("button");
    });

    it("calls onForgotPasswordClick when clicked", () => {
      const adapter = buildAdapter();
      const onForgotPasswordClick = vi.fn();
      render(
        <SupabaseAuthUI
          adapter={adapter}
          mode="password"
          onForgotPasswordClick={onForgotPasswordClick}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: /forgot password/i }));
      expect(onForgotPasswordClick).toHaveBeenCalled();
    });

    it("does NOT render 'Forgot password?' button when prop is omitted", () => {
      const adapter = buildAdapter();
      render(<SupabaseAuthUI adapter={adapter} mode="password" />);
      expect(
        screen.queryByRole("button", { name: /forgot password/i }),
      ).toBeNull();
    });

    it("does NOT render 'Forgot password?' button in magic-link mode (even if prop provided)", () => {
      const adapter = buildAdapter();
      const onForgotPasswordClick = vi.fn();
      render(
        <SupabaseAuthUI
          adapter={adapter}
          mode="magicLink"
          onForgotPasswordClick={onForgotPasswordClick}
        />,
      );
      expect(
        screen.queryByRole("button", { name: /forgot password/i }),
      ).toBeNull();
    });
  });

  describe("containerStyle prop", () => {
    function getWrapperDiv() {
      // The form is rendered inside the wrapper div; walk up from a known child.
      const form = document.querySelector("form");
      const wrapper = form?.parentElement;
      if (!wrapper) throw new Error("Wrapper div not found");
      return wrapper;
    }

    it("merges containerStyle into the form-render wrapper div", () => {
      render(
        <SupabaseAuthUI
          adapter={adapter}
          mode="password"
          containerStyle={{ background: "rgb(255, 240, 240)", maxWidth: 999 }}
        />,
      );

      const wrapper = getWrapperDiv();
      // Caller value wins on collisions (maxWidth) and adds new keys (background).
      expect(wrapper).toHaveStyle({ background: "rgb(255, 240, 240)" });
      expect(wrapper).toHaveStyle({ maxWidth: "999px" });
      // Baseline styles still apply where caller did not override.
      expect(wrapper).toHaveStyle({ padding: "24px" });
    });

    it("merges containerStyle into the magic-link confirmation wrapper div", async () => {
      render(
        <SupabaseAuthUI
          adapter={adapter}
          mode="magicLink"
          containerStyle={{ background: "rgb(240, 255, 240)" }}
        />,
      );

      fireEvent.change(getEmailInput(), {
        target: { value: "user@example.com" },
      });
      fireEvent.click(getSubmitButton());

      await vi.waitFor(() => {
        expect(screen.getByRole("status")).toBeInTheDocument();
      });

      const status = screen.getByRole("status");
      const wrapper = status.parentElement!;
      expect(wrapper).toHaveStyle({ background: "rgb(240, 255, 240)" });
      expect(wrapper).toHaveStyle({ padding: "24px" });
    });
  });
});
