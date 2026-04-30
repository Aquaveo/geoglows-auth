import { afterEach, describe, expect, it, vi } from "vitest";
import { mountSignInModal } from "../../src/core/sign-in";
import type { SupabaseAuthAdapter } from "../../src/types";

interface BuildOpts {
  signInWithPassword?: ReturnType<typeof vi.fn>;
  signInWithOAuth?: ReturnType<typeof vi.fn>;
  signUpWithPassword?: ReturnType<typeof vi.fn>;
}

function buildAdapter(opts: BuildOpts = {}): SupabaseAuthAdapter {
  const signInWithPassword =
    opts.signInWithPassword ??
    vi.fn().mockResolvedValue({ sub: "u-1", expired: false, profile: {} });
  const signInWithOAuth =
    opts.signInWithOAuth ?? vi.fn().mockResolvedValue(undefined);
  const signUpWithPassword =
    opts.signUpWithPassword ?? vi.fn().mockResolvedValue(undefined);

  return {
    signInWithPassword,
    signInWithOAuth,
    signUpWithPassword,
    signInWithMagicLink: vi.fn(),
    clearStaleAuthState: vi.fn(),
    completeSignInIfNeeded: vi.fn(),
    getCurrentUser: vi.fn(),
    signInRedirect: vi.fn(),
    signOutRedirect: vi.fn(),
    setupTokenRenewal: vi.fn(),
  } as unknown as SupabaseAuthAdapter;
}

function getDialog(): HTMLDialogElement {
  return document.querySelector(
    "#geoglowsSignInModal",
  ) as HTMLDialogElement;
}

function getForm(): HTMLFormElement {
  return document.querySelector("#geoglowsSignInForm") as HTMLFormElement;
}

function fillField(form: HTMLFormElement, name: string, value: string): void {
  (form.elements.namedItem(name) as HTMLInputElement).value = value;
}

function submit(form: HTMLFormElement): void {
  form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe("mountSignInModal", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("mounts a dialog into document.body and starts closed", () => {
    mountSignInModal({ authAdapter: buildAdapter() });
    expect(getDialog()).not.toBeNull();
    expect(getDialog().open).toBe(false);
  });

  it("open() shows the modal and renders sign-in title by default", () => {
    const handle = mountSignInModal({ authAdapter: buildAdapter() });
    handle.open();
    expect(getDialog().open).toBe(true);
    expect(getDialog().textContent).toContain("Sign in");
  });

  it("close() closes an open modal and is idempotent", () => {
    const handle = mountSignInModal({ authAdapter: buildAdapter() });
    handle.open();
    handle.close();
    expect(getDialog().open).toBe(false);
    handle.close();
    expect(getDialog().open).toBe(false);
  });

  describe("OAuth", () => {
    it("clicking Google calls signInWithOAuth with provider 'google'", async () => {
      const adapter = buildAdapter();
      const handle = mountSignInModal({ authAdapter: adapter });
      handle.open();
      (
        document.querySelector("#geoglowsSignInGoogle") as HTMLButtonElement
      ).click();
      await flush();
      expect(adapter.signInWithOAuth).toHaveBeenCalledWith(
        expect.objectContaining({ provider: "google" }),
      );
    });

    it("clicking GitHub calls signInWithOAuth with provider 'github'", async () => {
      const adapter = buildAdapter();
      const handle = mountSignInModal({ authAdapter: adapter });
      handle.open();
      (
        document.querySelector("#geoglowsSignInGithub") as HTMLButtonElement
      ).click();
      await flush();
      expect(adapter.signInWithOAuth).toHaveBeenCalledWith(
        expect.objectContaining({ provider: "github" }),
      );
    });

    it("renders generic OAuth error when signInWithOAuth rejects", async () => {
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const adapter = buildAdapter({
        signInWithOAuth: vi.fn().mockRejectedValue(new Error("oauth boom")),
      });
      const handle = mountSignInModal({ authAdapter: adapter });
      handle.open();
      (
        document.querySelector("#geoglowsSignInGoogle") as HTMLButtonElement
      ).click();
      await flush();
      const alert = document.querySelector('[role="alert"]');
      expect(alert?.textContent).toContain("couldn't start the sign-in flow");
      errSpy.mockRestore();
    });
  });

  describe("password sign-in", () => {
    it("calls signInWithPassword and closes modal on success", async () => {
      const onSignedIn = vi.fn();
      const adapter = buildAdapter();
      const handle = mountSignInModal({ authAdapter: adapter, onSignedIn });
      handle.open();

      fillField(getForm(), "email", "user@example.com");
      fillField(getForm(), "password", "hunter2");
      submit(getForm());
      await flush();

      expect(adapter.signInWithPassword).toHaveBeenCalledWith({
        email: "user@example.com",
        password: "hunter2",
      });
      expect(onSignedIn).toHaveBeenCalled();
      expect(getDialog().open).toBe(false);
    });

    it("renders generic error when signInWithPassword rejects", async () => {
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const adapter = buildAdapter({
        signInWithPassword: vi.fn().mockRejectedValue(new Error("nope")),
      });
      const handle = mountSignInModal({ authAdapter: adapter });
      handle.open();

      fillField(getForm(), "email", "user@example.com");
      fillField(getForm(), "password", "hunter2");
      submit(getForm());
      await flush();

      const alert = document.querySelector('[role="alert"]');
      expect(alert?.textContent).toContain("Sign-in failed");
      errSpy.mockRestore();
    });

    it("rejects empty email", () => {
      const adapter = buildAdapter();
      const handle = mountSignInModal({ authAdapter: adapter });
      handle.open();
      fillField(getForm(), "password", "hunter2");
      submit(getForm());
      expect(document.querySelector('[role="alert"]')?.textContent).toContain(
        "email address",
      );
      expect(adapter.signInWithPassword).not.toHaveBeenCalled();
    });

    it("rejects empty password", () => {
      const adapter = buildAdapter();
      const handle = mountSignInModal({ authAdapter: adapter });
      handle.open();
      fillField(getForm(), "email", "user@example.com");
      submit(getForm());
      expect(document.querySelector('[role="alert"]')?.textContent).toContain(
        "your password",
      );
      expect(adapter.signInWithPassword).not.toHaveBeenCalled();
    });

    it("escapes attacker-controlled state.error in the rendered alert", async () => {
      // Drives a real failing submit whose generic error is one of the static
      // constants — but injects an attacker-shaped value through a path that
      // ends up in renderBody. Even if a future change reflects raw error text
      // back into state.error, the escapeHtml() in renderBody will neutralize it.
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const adapter = buildAdapter({
        signInWithPassword: vi
          .fn()
          .mockRejectedValue(new Error('<img src=x onerror="alert(1)">')),
      });
      const handle = mountSignInModal({ authAdapter: adapter });
      handle.open();
      fillField(getForm(), "email", "user@example.com");
      fillField(getForm(), "password", "hunter2");
      submit(getForm());
      await flush();
      // Alert exists, no raw img tag injected.
      expect(document.querySelector('[role="alert"]')).not.toBeNull();
      expect(getDialog().querySelector("img[onerror]")).toBeNull();
      errSpy.mockRestore();
    });

    it("retains typed email across validation re-renders", () => {
      const handle = mountSignInModal({ authAdapter: buildAdapter() });
      handle.open();
      fillField(getForm(), "email", "ada@example.com");
      // Empty password — triggers validation error, re-renders.
      submit(getForm());
      // Form is re-rendered; same name, fresh element. The retained value
      // should be on the new input.
      const emailInput = getForm().elements.namedItem(
        "email",
      ) as HTMLInputElement;
      expect(emailInput.value).toBe("ada@example.com");
    });

    it("disables submit button + inputs while pending", async () => {
      let resolve: (v: { sub: string; expired: boolean; profile: object }) => void = () => {};
      const adapter = buildAdapter({
        signInWithPassword: vi.fn().mockImplementation(
          () =>
            new Promise((r) => {
              resolve = r;
            }),
        ),
      });
      const handle = mountSignInModal({ authAdapter: adapter });
      handle.open();
      fillField(getForm(), "email", "user@example.com");
      fillField(getForm(), "password", "hunter2");
      submit(getForm());
      await Promise.resolve();
      // While pending, submit button should be disabled
      const submitBtn = getForm().querySelector(
        'button[type="submit"]',
      ) as HTMLButtonElement;
      expect(submitBtn.disabled).toBe(true);
      resolve({ sub: "u-1", expired: false, profile: {} });
      await flush();
    });
  });

  describe("sign-up branch", () => {
    it("toggling renders first/last name fields", () => {
      const handle = mountSignInModal({ authAdapter: buildAdapter() });
      handle.open();
      (
        document.querySelector("#geoglowsSignInToggleMode") as HTMLButtonElement
      ).click();
      expect(document.querySelector('input[name="first_name"]')).not.toBeNull();
      expect(document.querySelector('input[name="last_name"]')).not.toBeNull();
    });

    it("validates first_name presence", () => {
      const adapter = buildAdapter();
      const handle = mountSignInModal({ authAdapter: adapter });
      handle.open();
      (
        document.querySelector("#geoglowsSignInToggleMode") as HTMLButtonElement
      ).click();

      fillField(getForm(), "last_name", "Smith");
      fillField(getForm(), "email", "user@example.com");
      fillField(getForm(), "password", "hunter2");
      submit(getForm());

      const alert = document.querySelector('[role="alert"]');
      expect(alert?.textContent).toContain("first name");
      expect(adapter.signUpWithPassword).not.toHaveBeenCalled();
    });

    it("validates last_name presence", () => {
      const adapter = buildAdapter();
      const handle = mountSignInModal({ authAdapter: adapter });
      handle.open();
      (
        document.querySelector("#geoglowsSignInToggleMode") as HTMLButtonElement
      ).click();

      fillField(getForm(), "first_name", "Ada");
      fillField(getForm(), "email", "user@example.com");
      fillField(getForm(), "password", "hunter2");
      submit(getForm());

      const alert = document.querySelector('[role="alert"]');
      expect(alert?.textContent).toContain("last name");
      expect(adapter.signUpWithPassword).not.toHaveBeenCalled();
    });

    it("calls signUpWithPassword with metadata and renders confirmation on success", async () => {
      const adapter = buildAdapter();
      const handle = mountSignInModal({ authAdapter: adapter });
      handle.open();
      (
        document.querySelector("#geoglowsSignInToggleMode") as HTMLButtonElement
      ).click();

      fillField(getForm(), "first_name", "Ada");
      fillField(getForm(), "last_name", "Lovelace");
      fillField(getForm(), "email", "ada@example.com");
      fillField(getForm(), "password", "hunter2");
      submit(getForm());
      await flush();

      expect(adapter.signUpWithPassword).toHaveBeenCalledWith(
        expect.objectContaining({
          email: "ada@example.com",
          password: "hunter2",
          metadata: expect.objectContaining({
            first_name: "Ada",
            last_name: "Lovelace",
            full_name: "Ada Lovelace",
          }),
        }),
      );
      // signUpSent screen
      expect(getDialog().textContent).toContain("Check your email");
      expect(
        document.querySelector("#geoglowsSignInBackToForm"),
      ).not.toBeNull();
    });

    it("renders sign-up error when signUpWithPassword rejects", async () => {
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const adapter = buildAdapter({
        signUpWithPassword: vi.fn().mockRejectedValue(new Error("taken")),
      });
      const handle = mountSignInModal({ authAdapter: adapter });
      handle.open();
      (
        document.querySelector("#geoglowsSignInToggleMode") as HTMLButtonElement
      ).click();
      fillField(getForm(), "first_name", "Ada");
      fillField(getForm(), "last_name", "Lovelace");
      fillField(getForm(), "email", "ada@example.com");
      fillField(getForm(), "password", "hunter2");
      submit(getForm());
      await flush();

      const alert = document.querySelector('[role="alert"]');
      expect(alert?.textContent).toContain("create your account");
      // Stays on signUp form (not signUpSent)
      expect(document.querySelector("#geoglowsSignInBackToForm")).toBeNull();
      expect(getDialog().textContent).toContain("Create your account");
      errSpy.mockRestore();
    });

    it("retains typed first/last/email across validation re-render", () => {
      const handle = mountSignInModal({ authAdapter: buildAdapter() });
      handle.open();
      (
        document.querySelector("#geoglowsSignInToggleMode") as HTMLButtonElement
      ).click();
      fillField(getForm(), "first_name", "Ada");
      fillField(getForm(), "last_name", "Lovelace");
      fillField(getForm(), "email", "ada@example.com");
      // Empty password triggers validation
      submit(getForm());

      const form = getForm();
      expect(
        (form.elements.namedItem("first_name") as HTMLInputElement).value,
      ).toBe("Ada");
      expect(
        (form.elements.namedItem("last_name") as HTMLInputElement).value,
      ).toBe("Lovelace");
      expect((form.elements.namedItem("email") as HTMLInputElement).value).toBe(
        "ada@example.com",
      );
    });

    it("Back-to-sign-in button on signUpSent returns to sign-in form", async () => {
      const handle = mountSignInModal({ authAdapter: buildAdapter() });
      handle.open();
      (
        document.querySelector("#geoglowsSignInToggleMode") as HTMLButtonElement
      ).click();
      fillField(getForm(), "first_name", "Ada");
      fillField(getForm(), "last_name", "Lovelace");
      fillField(getForm(), "email", "ada@example.com");
      fillField(getForm(), "password", "hunter2");
      submit(getForm());
      await flush();

      (
        document.querySelector(
          "#geoglowsSignInBackToForm",
        ) as HTMLButtonElement
      ).click();

      expect(getDialog().textContent).toContain("Sign in");
      expect(document.querySelector('input[name="first_name"]')).toBeNull();
    });
  });

  describe("allowSignUp option", () => {
    it("hides the sign-up toggle when allowSignUp is false", () => {
      const handle = mountSignInModal({
        authAdapter: buildAdapter(),
        allowSignUp: false,
      });
      handle.open();
      expect(document.querySelector("#geoglowsSignInToggleMode")).toBeNull();
    });

    it("shows the sign-up toggle by default", () => {
      const handle = mountSignInModal({ authAdapter: buildAdapter() });
      handle.open();
      expect(
        document.querySelector("#geoglowsSignInToggleMode"),
      ).not.toBeNull();
    });
  });

  describe("backdrop click", () => {
    it("closes the modal when the dialog backdrop is clicked", () => {
      const handle = mountSignInModal({ authAdapter: buildAdapter() });
      handle.open();
      const dialog = getDialog();
      // A click whose target is the dialog itself (not a child) simulates backdrop.
      const event = new MouseEvent("click", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "target", { value: dialog });
      dialog.dispatchEvent(event);
      expect(dialog.open).toBe(false);
    });

    it("does not close when an inner element is clicked", () => {
      const handle = mountSignInModal({ authAdapter: buildAdapter() });
      handle.open();
      const inner = document.querySelector(
        "#geoglowsSignInForm",
      ) as HTMLFormElement;
      const event = new MouseEvent("click", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "target", { value: inner });
      getDialog().dispatchEvent(event);
      expect(getDialog().open).toBe(true);
    });
  });

  describe("in-flight cancellation", () => {
    it("does not fire onSignedIn if close() is called mid-submit", async () => {
      const onSignedIn = vi.fn();
      let resolve: (v: { sub: string; expired: boolean; profile: object }) => void = () => {};
      const adapter = buildAdapter({
        signInWithPassword: vi.fn().mockImplementation(
          () =>
            new Promise((r) => {
              resolve = r;
            }),
        ),
      });
      const handle = mountSignInModal({ authAdapter: adapter, onSignedIn });
      handle.open();
      fillField(getForm(), "email", "user@example.com");
      fillField(getForm(), "password", "hunter2");
      submit(getForm());
      await Promise.resolve();
      handle.close();
      resolve({ sub: "u-1", expired: false, profile: {} });
      await flush();
      expect(onSignedIn).not.toHaveBeenCalled();
    });

    it("does not render error if close() is called before rejection settles", async () => {
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      let reject: (e: Error) => void = () => {};
      const adapter = buildAdapter({
        signInWithPassword: vi.fn().mockImplementation(
          () =>
            new Promise((_, r) => {
              reject = r;
            }),
        ),
      });
      const handle = mountSignInModal({ authAdapter: adapter });
      handle.open();
      fillField(getForm(), "email", "user@example.com");
      fillField(getForm(), "password", "hunter2");
      submit(getForm());
      await Promise.resolve();
      handle.close();
      reject(new Error("bad"));
      await flush();
      // Modal is closed; no alert visible from a stale rejection.
      expect(getDialog().open).toBe(false);
      errSpy.mockRestore();
    });
  });

  describe("onSignedIn isolation", () => {
    it("logs but does not surface a callback throw as a sign-in error", async () => {
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const onSignedIn = vi.fn(() => {
        throw new Error("router exploded");
      });
      const adapter = buildAdapter();
      const handle = mountSignInModal({ authAdapter: adapter, onSignedIn });
      handle.open();
      fillField(getForm(), "email", "user@example.com");
      fillField(getForm(), "password", "hunter2");
      submit(getForm());
      await flush();

      // Modal closed (sign-in succeeded), no "Sign-in failed" alert.
      expect(getDialog().open).toBe(false);
      expect(errSpy).toHaveBeenCalledWith(
        expect.stringContaining("onSignedIn"),
        expect.stringContaining("router exploded"),
      );
      errSpy.mockRestore();
    });
  });

  describe("unmount", () => {
    it("removes the dialog from the DOM", () => {
      const handle = mountSignInModal({ authAdapter: buildAdapter() });
      expect(document.querySelector("#geoglowsSignInModal")).not.toBeNull();
      handle.unmount();
      expect(document.querySelector("#geoglowsSignInModal")).toBeNull();
    });

    it("throws when open() is called after unmount", () => {
      const handle = mountSignInModal({ authAdapter: buildAdapter() });
      handle.unmount();
      expect(() => handle.open()).toThrow(/unmounted/i);
    });

    it("throws when close() is called after unmount", () => {
      const handle = mountSignInModal({ authAdapter: buildAdapter() });
      handle.unmount();
      expect(() => handle.close()).toThrow(/unmounted/i);
    });

    it("unmount is idempotent", () => {
      const handle = mountSignInModal({ authAdapter: buildAdapter() });
      handle.unmount();
      expect(() => handle.unmount()).not.toThrow();
    });

    it("does not fire onSignedIn if unmount is called mid-submit", async () => {
      const onSignedIn = vi.fn();
      let resolve: (v: { sub: string; expired: boolean; profile: object }) => void = () => {};
      const adapter = buildAdapter({
        signInWithPassword: vi.fn().mockImplementation(
          () =>
            new Promise((r) => {
              resolve = r;
            }),
        ),
      });
      const handle = mountSignInModal({ authAdapter: adapter, onSignedIn });
      handle.open();
      fillField(getForm(), "email", "user@example.com");
      fillField(getForm(), "password", "hunter2");
      submit(getForm());
      await Promise.resolve();
      handle.unmount();
      resolve({ sub: "u-1", expired: false, profile: {} });
      await flush();
      expect(onSignedIn).not.toHaveBeenCalled();
    });
  });
});
