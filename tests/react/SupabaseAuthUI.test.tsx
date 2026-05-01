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
    signUpWithPassword: vi.fn(async () => {}),
    resetPasswordForEmail: vi.fn(async () => {}),
    updateUserPassword: vi.fn(async () => buildAuthUser()),
    signOutOtherSessions: vi.fn(async () => {}),
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
        <SupabaseAuthUI
          adapter={adapter}
          mode="password"
          allowSignUp={false}
          onSuccess={onSuccess}
        />,
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
      render(
        <SupabaseAuthUI adapter={adapter} mode="password" allowSignUp={false} />,
      );

      fireEvent.change(getPasswordInput(), { target: { value: "hunter2" } });
      fireEvent.click(getSubmitButton());

      expect(screen.getByRole("alert")).toHaveTextContent(/email/i);
      expect(adapter.signInWithPassword).not.toHaveBeenCalled();
    });

    it("shows a validation message when submitted with empty password", async () => {
      render(
        <SupabaseAuthUI adapter={adapter} mode="password" allowSignUp={false} />,
      );

      fireEvent.change(getEmailInput(), {
        target: { value: "user@example.com" },
      });
      fireEvent.click(getSubmitButton());

      expect(screen.getByRole("alert")).toHaveTextContent(/password/i);
      expect(adapter.signInWithPassword).not.toHaveBeenCalled();
    });

    it("rejects whitespace-only passwords as if empty", () => {
      render(
        <SupabaseAuthUI adapter={adapter} mode="password" allowSignUp={false} />,
      );

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

      render(
        <SupabaseAuthUI adapter={adapter} mode="password" allowSignUp={false} />,
      );

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
          allowSignUp={false}
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
        <SupabaseAuthUI
          adapter={adapter}
          mode="password"
          allowSignUp={false}
          onSuccess={onSuccess}
        />,
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

      render(
        <SupabaseAuthUI adapter={adapter} mode="password" allowSignUp={false} />,
      );

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
      render(
        <SupabaseAuthUI adapter={adapter} mode="magicLink" allowSignUp={false} />,
      );

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
          allowSignUp={false}
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
          allowSignUp={false}
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
      render(
        <SupabaseAuthUI adapter={adapter} mode="magicLink" allowSignUp={false} />,
      );
      expect(screen.queryByLabelText(/password/i)).toBeNull();
    });

    it("validates that email is required before sending", () => {
      render(
        <SupabaseAuthUI adapter={adapter} mode="magicLink" allowSignUp={false} />,
      );
      fireEvent.click(getSubmitButton());
      expect(screen.getByRole("alert")).toHaveTextContent(/email/i);
      expect(adapter.signInWithMagicLink).not.toHaveBeenCalled();
    });

    it("shows a generic error and forwards the raw error to onError when magic-link send fails", async () => {
      const rawError = new Error("Rate limited");
      adapter.signInWithMagicLink.mockRejectedValue(rawError);
      const onError = vi.fn();

      render(
        <SupabaseAuthUI
          adapter={adapter}
          mode="magicLink"
          allowSignUp={false}
          onError={onError}
        />,
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
      render(
        <SupabaseAuthUI adapter={adapter} mode="magicLink" allowSignUp={false} />,
      );

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
      render(
        <SupabaseAuthUI adapter={adapter} mode="magicLink" allowSignUp={false} />,
      );

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
      render(<SupabaseAuthUI adapter={adapter} allowSignUp={false} />);

      expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /magic link/i }),
      ).toBeInTheDocument();
    });

    it("switches to magic-link mode when the toggle is clicked, hiding password", () => {
      render(<SupabaseAuthUI adapter={adapter} allowSignUp={false} />);

      fireEvent.click(screen.getByRole("button", { name: /magic link/i }));

      expect(screen.queryByLabelText(/password/i)).toBeNull();
      expect(
        screen.getByRole("button", { name: /password/i }),
      ).toBeInTheDocument();
    });

    it("clears errors and password when toggling to magic-link mode", () => {
      render(<SupabaseAuthUI adapter={adapter} allowSignUp={false} />);

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
      render(<SupabaseAuthUI adapter={adapter} allowSignUp={false} />);

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
      const onForgotPasswordClick = vi.fn();
      render(
        <SupabaseAuthUI
          adapter={adapter}
          mode="password"
          allowSignUp={false}
          onForgotPasswordClick={onForgotPasswordClick}
        />,
      );
      const link = screen.getByRole("button", { name: /forgot password/i });
      expect(link).toBeInTheDocument();
      expect(link.tagName).toBe("BUTTON");
      expect(link.getAttribute("type")).toBe("button");
    });

    it("calls onForgotPasswordClick when clicked", () => {
      const onForgotPasswordClick = vi.fn();
      render(
        <SupabaseAuthUI
          adapter={adapter}
          mode="password"
          allowSignUp={false}
          onForgotPasswordClick={onForgotPasswordClick}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: /forgot password/i }));
      expect(onForgotPasswordClick).toHaveBeenCalled();
    });

    it("does NOT render 'Forgot password?' button when prop is omitted", () => {
      render(
        <SupabaseAuthUI adapter={adapter} mode="password" allowSignUp={false} />,
      );
      expect(
        screen.queryByRole("button", { name: /forgot password/i }),
      ).toBeNull();
    });

    it("does NOT render 'Forgot password?' button in magic-link mode (even if prop provided)", () => {
      const onForgotPasswordClick = vi.fn();
      render(
        <SupabaseAuthUI
          adapter={adapter}
          mode="magicLink"
          allowSignUp={false}
          onForgotPasswordClick={onForgotPasswordClick}
        />,
      );
      expect(
        screen.queryByRole("button", { name: /forgot password/i }),
      ).toBeNull();
    });
  });

  describe("OAuth providers (1.5.0)", () => {
    it("renders Google + GitHub buttons in signIn view by default", () => {
      render(
        <SupabaseAuthUI
          adapter={adapter}
          allowSignUp
          emailRedirectTo="https://example.com/profile"
        />,
      );
      expect(
        screen.getByRole("button", { name: /continue with google/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /continue with github/i }),
      ).toBeInTheDocument();
    });

    it("calls signInWithOAuth with provider=google and the default redirect", () => {
      render(
        <SupabaseAuthUI
          adapter={adapter}
          allowSignUp
          emailRedirectTo="https://example.com/profile"
        />,
      );
      fireEvent.click(
        screen.getByRole("button", { name: /continue with google/i }),
      );
      expect(adapter.signInWithOAuth).toHaveBeenCalledWith({
        provider: "google",
        redirectTo: window.location.origin,
      });
    });

    it("calls signInWithOAuth with provider=github", () => {
      render(
        <SupabaseAuthUI
          adapter={adapter}
          allowSignUp
          emailRedirectTo="https://example.com/profile"
        />,
      );
      fireEvent.click(
        screen.getByRole("button", { name: /continue with github/i }),
      );
      expect(adapter.signInWithOAuth).toHaveBeenCalledWith({
        provider: "github",
        redirectTo: window.location.origin,
      });
    });

    it("forwards oauthRedirectTo when provided", () => {
      render(
        <SupabaseAuthUI
          adapter={adapter}
          allowSignUp
          emailRedirectTo="https://example.com/profile"
          oauthRedirectTo="https://example.com/oauth-callback"
        />,
      );
      fireEvent.click(
        screen.getByRole("button", { name: /continue with google/i }),
      );
      expect(adapter.signInWithOAuth).toHaveBeenCalledWith({
        provider: "google",
        redirectTo: "https://example.com/oauth-callback",
      });
    });

    it("disables both OAuth buttons while one is pending; clicked shows 'Signing in…'", async () => {
      let resolveOAuth: () => void = () => {};
      adapter.signInWithOAuth.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolveOAuth = resolve;
          }),
      );

      render(
        <SupabaseAuthUI
          adapter={adapter}
          allowSignUp
          emailRedirectTo="https://example.com/profile"
        />,
      );

      const googleButton = screen.getByRole("button", {
        name: /continue with google/i,
      });
      fireEvent.click(googleButton);

      await vi.waitFor(() => {
        expect(screen.getByRole("button", { name: /signing in/i })).toBeInTheDocument();
      });
      const githubButton = screen.getByRole("button", {
        name: /continue with github/i,
      });
      expect(googleButton).toBeDisabled();
      expect(githubButton).toBeDisabled();

      resolveOAuth();
    });

    it("rejects javascript: oauthRedirectTo via sanitizeHref and falls back to window.location.origin", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      render(
        <SupabaseAuthUI
          adapter={adapter}
          allowSignUp
          emailRedirectTo="https://example.com/profile"
          oauthRedirectTo="javascript:alert(1)"
        />,
      );
      fireEvent.click(
        screen.getByRole("button", { name: /continue with google/i }),
      );
      expect(adapter.signInWithOAuth).toHaveBeenCalledWith({
        provider: "google",
        redirectTo: window.location.origin,
      });
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("oauthRedirectTo"),
      );
    });

    it("shows GENERIC_OAUTH_ERROR and forwards raw error on OAuth failure", async () => {
      const rawError = new Error("OAuth provider unavailable");
      adapter.signInWithOAuth.mockRejectedValue(rawError);
      const onError = vi.fn();

      render(
        <SupabaseAuthUI
          adapter={adapter}
          allowSignUp
          emailRedirectTo="https://example.com/profile"
          onError={onError}
        />,
      );
      fireEvent.click(
        screen.getByRole("button", { name: /continue with google/i }),
      );

      await vi.waitFor(() => {
        expect(screen.getByRole("alert")).toHaveTextContent(
          /couldn't start the sign-in flow/i,
        );
        expect(screen.getByRole("alert")).not.toHaveTextContent(
          /provider unavailable/i,
        );
      });
      expect(onError).toHaveBeenCalledWith(rawError);
      // Buttons re-enabled after error.
      await vi.waitFor(() => {
        expect(
          screen.getByRole("button", { name: /continue with google/i }),
        ).not.toBeDisabled();
      });
    });

    it("resets OAuth pending state on pageshow event (browser back from OAuth provider)", async () => {
      let resolveOAuth: () => void = () => {};
      adapter.signInWithOAuth.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolveOAuth = resolve;
          }),
      );

      render(
        <SupabaseAuthUI
          adapter={adapter}
          allowSignUp
          emailRedirectTo="https://example.com/profile"
        />,
      );
      fireEvent.click(
        screen.getByRole("button", { name: /continue with google/i }),
      );
      await vi.waitFor(() => {
        expect(
          screen.getByRole("button", { name: /signing in/i }),
        ).toBeInTheDocument();
      });

      // Fire pageshow event (simulating bfcache restore).
      window.dispatchEvent(new Event("pageshow"));

      await vi.waitFor(() => {
        expect(
          screen.getByRole("button", { name: /continue with google/i }),
        ).not.toBeDisabled();
      });
      resolveOAuth();
    });

    it("hides OAuth row when mode is locked to magicLink", () => {
      render(
        <SupabaseAuthUI adapter={adapter} mode="magicLink" allowSignUp={false} />,
      );
      // Magic-link locked = no OAuth (matches vanilla which has no magic-link).
      expect(
        screen.queryByRole("button", { name: /continue with google/i }),
      ).toBeNull();
    });
  });

  describe("sign-up flow (1.5.0)", () => {
    it("renders 'Create an account' toggle when allowSignUp=true (default)", () => {
      render(
        <SupabaseAuthUI
          adapter={adapter}
          allowSignUp
          emailRedirectTo="https://example.com/profile"
        />,
      );
      expect(
        screen.getByRole("button", { name: /create an account/i }),
      ).toBeInTheDocument();
    });

    it("does NOT render sign-up toggle when allowSignUp=false", () => {
      render(<SupabaseAuthUI adapter={adapter} allowSignUp={false} />);
      expect(
        screen.queryByRole("button", { name: /create an account/i }),
      ).toBeNull();
    });

    it("does NOT render sign-up toggle when mode is locked to magicLink", () => {
      render(
        <SupabaseAuthUI
          adapter={adapter}
          mode="magicLink"
          allowSignUp
          emailRedirectTo="https://example.com/profile"
        />,
      );
      expect(
        screen.queryByRole("button", { name: /create an account/i }),
      ).toBeNull();
    });

    it("clicking 'Create an account' switches to signUp view with first/last name fields", () => {
      render(
        <SupabaseAuthUI
          adapter={adapter}
          allowSignUp
          emailRedirectTo="https://example.com/profile"
        />,
      );
      fireEvent.click(
        screen.getByRole("button", { name: /create an account/i }),
      );
      expect(screen.getByLabelText(/first name/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/last name/i)).toBeInTheDocument();
      // OAuth row hidden in signUp view.
      expect(
        screen.queryByRole("button", { name: /continue with google/i }),
      ).toBeNull();
      // Magic-link toggle hidden in signUp view.
      expect(
        screen.queryByRole("button", { name: /magic link/i }),
      ).toBeNull();
    });

    it("submits sign-up with metadata and transitions to signUpSent view", async () => {
      render(
        <SupabaseAuthUI
          adapter={adapter}
          allowSignUp
          emailRedirectTo="https://example.com/profile"
        />,
      );
      fireEvent.click(
        screen.getByRole("button", { name: /create an account/i }),
      );

      fireEvent.change(screen.getByLabelText(/first name/i), {
        target: { value: "Ada" },
      });
      fireEvent.change(screen.getByLabelText(/last name/i), {
        target: { value: "Lovelace" },
      });
      fireEvent.change(getEmailInput(), {
        target: { value: "  ada@example.com  " },
      });
      fireEvent.change(getPasswordInput(), { target: { value: "hunter2" } });
      fireEvent.click(getSubmitButton());

      await vi.waitFor(() => {
        expect(adapter.signUpWithPassword).toHaveBeenCalledWith({
          email: "ada@example.com",
          password: "hunter2",
          emailRedirectTo: "https://example.com/profile",
          metadata: { first_name: "Ada", last_name: "Lovelace" },
        });
      });

      // signUpSent view renders.
      await vi.waitFor(() => {
        expect(
          screen.getByRole("heading", { name: /check your email/i }),
        ).toBeInTheDocument();
      });
    });

    it("validates required fields on sign-up submit", () => {
      render(
        <SupabaseAuthUI
          adapter={adapter}
          allowSignUp
          emailRedirectTo="https://example.com/profile"
        />,
      );
      fireEvent.click(
        screen.getByRole("button", { name: /create an account/i }),
      );

      // Submit with everything empty.
      fireEvent.click(getSubmitButton());
      expect(screen.getByRole("alert")).toHaveTextContent(/first name/i);
      expect(adapter.signUpWithPassword).not.toHaveBeenCalled();
    });

    it("shows GENERIC_SIGNUP_ERROR and forwards raw error on sign-up failure; clears password, preserves names", async () => {
      const rawError = new Error("User already registered");
      adapter.signUpWithPassword.mockRejectedValue(rawError);
      const onError = vi.fn();

      render(
        <SupabaseAuthUI
          adapter={adapter}
          allowSignUp
          emailRedirectTo="https://example.com/profile"
          onError={onError}
        />,
      );
      fireEvent.click(
        screen.getByRole("button", { name: /create an account/i }),
      );

      const firstNameInput = screen.getByLabelText(/first name/i) as HTMLInputElement;
      const lastNameInput = screen.getByLabelText(/last name/i) as HTMLInputElement;
      fireEvent.change(firstNameInput, { target: { value: "Ada" } });
      fireEvent.change(lastNameInput, { target: { value: "Lovelace" } });
      fireEvent.change(getEmailInput(), {
        target: { value: "ada@example.com" },
      });
      fireEvent.change(getPasswordInput(), { target: { value: "hunter2" } });
      fireEvent.click(getSubmitButton());

      await vi.waitFor(() => {
        expect(screen.getByRole("alert")).toHaveTextContent(
          /couldn't create your account/i,
        );
      });
      expect(onError).toHaveBeenCalledWith(rawError);
      // Password cleared, name fields preserved.
      expect(getPasswordInput().value).toBe("");
      expect(firstNameInput.value).toBe("Ada");
      expect(lastNameInput.value).toBe("Lovelace");
    });

    it("rejects javascript: emailRedirectTo via sanitizeHref and falls back to window.location.origin", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      render(
        <SupabaseAuthUI
          adapter={adapter}
          allowSignUp
          emailRedirectTo={"javascript:alert(1)" as string}
        />,
      );
      fireEvent.click(
        screen.getByRole("button", { name: /create an account/i }),
      );

      fireEvent.change(screen.getByLabelText(/first name/i), {
        target: { value: "Ada" },
      });
      fireEvent.change(screen.getByLabelText(/last name/i), {
        target: { value: "Lovelace" },
      });
      fireEvent.change(getEmailInput(), {
        target: { value: "ada@example.com" },
      });
      fireEvent.change(getPasswordInput(), { target: { value: "hunter2" } });
      fireEvent.click(getSubmitButton());

      await vi.waitFor(() => {
        expect(adapter.signUpWithPassword).toHaveBeenCalledWith(
          expect.objectContaining({
            emailRedirectTo: window.location.origin,
          }),
        );
      });
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("emailRedirectTo"),
      );
    });

    it("clicking '← Back' in signUp view returns to signIn with name fields cleared", () => {
      render(
        <SupabaseAuthUI
          adapter={adapter}
          allowSignUp
          emailRedirectTo="https://example.com/profile"
        />,
      );
      fireEvent.click(
        screen.getByRole("button", { name: /create an account/i }),
      );
      fireEvent.change(screen.getByLabelText(/first name/i), {
        target: { value: "Ada" },
      });
      fireEvent.change(screen.getByLabelText(/last name/i), {
        target: { value: "Lovelace" },
      });
      // Click the Back link.
      fireEvent.click(screen.getByRole("button", { name: /^← back$/i }));

      // Back to signIn view: password input visible, name inputs gone.
      expect(screen.queryByLabelText(/first name/i)).toBeNull();
      expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    });

    it("clicking 'Back to sign in' from signUpSent returns to signIn with email preserved, password cleared", async () => {
      render(
        <SupabaseAuthUI
          adapter={adapter}
          allowSignUp
          emailRedirectTo="https://example.com/profile"
        />,
      );
      fireEvent.click(
        screen.getByRole("button", { name: /create an account/i }),
      );
      fireEvent.change(screen.getByLabelText(/first name/i), {
        target: { value: "Ada" },
      });
      fireEvent.change(screen.getByLabelText(/last name/i), {
        target: { value: "Lovelace" },
      });
      fireEvent.change(getEmailInput(), {
        target: { value: "ada@example.com" },
      });
      fireEvent.change(getPasswordInput(), { target: { value: "hunter2" } });
      fireEvent.click(getSubmitButton());

      await vi.waitFor(() => {
        expect(screen.getByRole("status")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole("button", { name: /back to sign in/i }));

      // Back to signIn view: email preserved, password input present and empty.
      expect(getEmailInput().value).toBe("ada@example.com");
      expect(getPasswordInput().value).toBe("");
    });
  });

  describe("onClose prop (1.5.0)", () => {
    it("renders close (×) button when onClose is provided", () => {
      const onClose = vi.fn();
      render(
        <SupabaseAuthUI
          adapter={adapter}
          allowSignUp={false}
          onClose={onClose}
        />,
      );
      expect(
        screen.getByRole("button", { name: /close/i }),
      ).toBeInTheDocument();
    });

    it("does NOT render close button when onClose is omitted", () => {
      render(<SupabaseAuthUI adapter={adapter} allowSignUp={false} />);
      expect(screen.queryByRole("button", { name: /close/i })).toBeNull();
    });

    it("calls onClose exactly once when the close button is clicked (no other side effects)", () => {
      const onClose = vi.fn();
      render(
        <SupabaseAuthUI
          adapter={adapter}
          allowSignUp={false}
          onClose={onClose}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: /close/i }));
      // The lib does NOT call dialog.close() itself — onClose is the only
      // side-effect. This contract lets consumers (like aquiferx) keep their
      // outer-<dialog> close-event cleanup paths working.
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("renders close button in signUp view when onClose is provided", () => {
      const onClose = vi.fn();
      render(
        <SupabaseAuthUI
          adapter={adapter}
          allowSignUp
          emailRedirectTo="https://example.com/profile"
          onClose={onClose}
        />,
      );
      fireEvent.click(
        screen.getByRole("button", { name: /create an account/i }),
      );
      expect(
        screen.getByRole("button", { name: /close/i }),
      ).toBeInTheDocument();
    });

    it("renders close button in signUpSent view when onClose is provided", async () => {
      const onClose = vi.fn();
      render(
        <SupabaseAuthUI
          adapter={adapter}
          allowSignUp
          emailRedirectTo="https://example.com/profile"
          onClose={onClose}
        />,
      );
      fireEvent.click(
        screen.getByRole("button", { name: /create an account/i }),
      );
      fireEvent.change(screen.getByLabelText(/first name/i), {
        target: { value: "Ada" },
      });
      fireEvent.change(screen.getByLabelText(/last name/i), {
        target: { value: "Lovelace" },
      });
      fireEvent.change(getEmailInput(), {
        target: { value: "ada@example.com" },
      });
      fireEvent.change(getPasswordInput(), { target: { value: "hunter2" } });
      fireEvent.click(getSubmitButton());

      await vi.waitFor(() => {
        expect(screen.getByRole("status")).toBeInTheDocument();
      });
      expect(
        screen.getByRole("button", { name: /close/i }),
      ).toBeInTheDocument();
    });
  });

  describe("CSS class migration (1.5.0)", () => {
    it("renders form using geoglows-signin-* classes (not inline styles)", () => {
      render(
        <SupabaseAuthUI
          adapter={adapter}
          allowSignUp
          emailRedirectTo="https://example.com/profile"
        />,
      );
      // Spot-check key classes are present — the visual restyle relies on
      // sign-in.css being imported at app entry.
      expect(document.querySelector(".geoglows-signin-content")).not.toBeNull();
      expect(document.querySelector(".geoglows-signin-form")).not.toBeNull();
      expect(document.querySelector(".geoglows-signin-providers")).not.toBeNull();
      expect(document.querySelector(".geoglows-signin-divider")).not.toBeNull();
      expect(document.querySelector(".geoglows-signin-submit")).not.toBeNull();
    });

    it("magic-link confirmation uses geoglows-signin-confirmation classes (not legacy gray box)", async () => {
      render(<SupabaseAuthUI adapter={adapter} allowSignUp={false} />);

      fireEvent.click(screen.getByRole("button", { name: /magic link/i }));
      fireEvent.change(getEmailInput(), {
        target: { value: "user@example.com" },
      });
      fireEvent.click(getSubmitButton());

      await vi.waitFor(() => {
        expect(screen.getByRole("status")).toBeInTheDocument();
      });
      expect(
        document.querySelector(".geoglows-signin-confirmation"),
      ).not.toBeNull();
      expect(
        document.querySelector(".geoglows-signin-confirmation-back"),
      ).not.toBeNull();
    });
  });
});
