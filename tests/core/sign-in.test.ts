import { afterEach, describe, expect, it, vi } from "vitest";
import { mountSignInModal } from "../../src/core/sign-in";
import type {
  GeoglowsSupabaseClient,
  SupabaseAuthAdapter,
} from "../../src/types";

interface BuildOpts {
  signInWithPassword?: ReturnType<typeof vi.fn>;
  signInWithOAuth?: ReturnType<typeof vi.fn>;
  signUp?: ReturnType<typeof vi.fn>;
}

function buildMocks(opts: BuildOpts = {}): {
  supabase: GeoglowsSupabaseClient;
  adapter: SupabaseAuthAdapter;
} {
  const signUp =
    opts.signUp ?? vi.fn().mockResolvedValue({ data: { user: null, session: null }, error: null });
  const signInWithPassword =
    opts.signInWithPassword ?? vi.fn().mockResolvedValue({ sub: "u-1", expired: false, profile: {} });
  const signInWithOAuth =
    opts.signInWithOAuth ?? vi.fn().mockResolvedValue(undefined);

  // Minimal supabase client shape — only `auth.signUp` is used inside the
  // modal directly. Other adapter methods are wrapped in the adapter mock.
  const supabase = { auth: { signUp } } as unknown as GeoglowsSupabaseClient;
  const adapter = {
    signInWithPassword,
    signInWithOAuth,
    // Other AuthAdapter methods are not exercised by the modal; stub as needed.
    signInWithMagicLink: vi.fn(),
    clearStaleAuthState: vi.fn(),
    completeSignInIfNeeded: vi.fn(),
    getCurrentUser: vi.fn(),
    signInRedirect: vi.fn(),
    signOutRedirect: vi.fn(),
    setupTokenRenewal: vi.fn(),
  } as unknown as SupabaseAuthAdapter;

  return { supabase, adapter };
}

describe("mountSignInModal", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("mounts a dialog into document.body and starts closed", () => {
    const { supabase, adapter } = buildMocks();
    mountSignInModal({ supabase, authAdapter: adapter });
    const dialog = document.querySelector(
      "#geoglowsSignInModal",
    ) as HTMLDialogElement | null;
    expect(dialog).not.toBeNull();
    expect(dialog?.open).toBe(false);
  });

  it("open() shows the modal and renders sign-in title by default", () => {
    const { supabase, adapter } = buildMocks();
    const handle = mountSignInModal({ supabase, authAdapter: adapter });
    handle.open();
    const dialog = document.querySelector(
      "#geoglowsSignInModal",
    ) as HTMLDialogElement;
    expect(dialog.open).toBe(true);
    expect(dialog.textContent).toContain("Sign in");
  });

  it("close() closes an open modal and is idempotent", () => {
    const { supabase, adapter } = buildMocks();
    const handle = mountSignInModal({ supabase, authAdapter: adapter });
    handle.open();
    handle.close();
    const dialog = document.querySelector(
      "#geoglowsSignInModal",
    ) as HTMLDialogElement;
    expect(dialog.open).toBe(false);
    handle.close(); // should not throw
    expect(dialog.open).toBe(false);
  });

  it("clicking Google calls signInWithOAuth with provider 'google'", async () => {
    const { supabase, adapter } = buildMocks();
    const handle = mountSignInModal({ supabase, authAdapter: adapter });
    handle.open();
    const button = document.querySelector(
      "#geoglowsSignInGoogle",
    ) as HTMLButtonElement;
    button.click();
    await Promise.resolve();
    expect(adapter.signInWithOAuth).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "google" }),
    );
  });

  it("clicking GitHub calls signInWithOAuth with provider 'github'", async () => {
    const { supabase, adapter } = buildMocks();
    const handle = mountSignInModal({ supabase, authAdapter: adapter });
    handle.open();
    const button = document.querySelector(
      "#geoglowsSignInGithub",
    ) as HTMLButtonElement;
    button.click();
    await Promise.resolve();
    expect(adapter.signInWithOAuth).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "github" }),
    );
  });

  it("submitting the password form calls signInWithPassword and closes modal on success", async () => {
    const onSignedIn = vi.fn();
    const { supabase, adapter } = buildMocks();
    const handle = mountSignInModal({
      supabase,
      authAdapter: adapter,
      onSignedIn,
    });
    handle.open();

    const form = document.querySelector("#geoglowsSignInForm") as HTMLFormElement;
    (form.elements.namedItem("email") as HTMLInputElement).value =
      "user@example.com";
    (form.elements.namedItem("password") as HTMLInputElement).value =
      "hunter2";
    form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));

    expect(adapter.signInWithPassword).toHaveBeenCalledWith({
      email: "user@example.com",
      password: "hunter2",
    });
    expect(onSignedIn).toHaveBeenCalled();
    const dialog = document.querySelector(
      "#geoglowsSignInModal",
    ) as HTMLDialogElement;
    expect(dialog.open).toBe(false);
  });

  it("renders an error inside role=alert when signInWithPassword rejects", async () => {
    const signInWithPassword = vi.fn().mockRejectedValue(new Error("nope"));
    const { supabase, adapter } = buildMocks({ signInWithPassword });
    // Suppress noisy console.error from the modal's catch handler in this test.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const handle = mountSignInModal({ supabase, authAdapter: adapter });
    handle.open();

    const form = document.querySelector("#geoglowsSignInForm") as HTMLFormElement;
    (form.elements.namedItem("email") as HTMLInputElement).value =
      "user@example.com";
    (form.elements.namedItem("password") as HTMLInputElement).value =
      "hunter2";
    form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));

    const alert = document.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert?.textContent).toContain("Sign-in failed");
    errSpy.mockRestore();
  });

  it("escapes user-controlled error text — XSS regression guard", async () => {
    // The modal renders provider/auth API errors. If those error strings ever
    // reflect user input (e.g., an email value or a provider message), the
    // template-string-then-innerHTML rendering must escape them.
    const signInWithPassword = vi
      .fn()
      .mockRejectedValue(new Error('<img src=x onerror="alert(1)">'));
    const { supabase, adapter } = buildMocks({ signInWithPassword });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const handle = mountSignInModal({ supabase, authAdapter: adapter });
    handle.open();

    const form = document.querySelector("#geoglowsSignInForm") as HTMLFormElement;
    (form.elements.namedItem("email") as HTMLInputElement).value =
      "user@example.com";
    (form.elements.namedItem("password") as HTMLInputElement).value = "hunter2";
    form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));

    // The modal's actual error message is GENERIC_PASSWORD_ERROR (a constant),
    // but assert that no <img onerror=...> tag landed in the DOM regardless.
    const dialog = document.querySelector("#geoglowsSignInModal");
    expect(dialog?.querySelector("img[onerror]")).toBeNull();
    errSpy.mockRestore();
  });

  describe("mode: 'signin' (sign-up branch hidden)", () => {
    it("does not render the sign-up toggle", () => {
      const { supabase, adapter } = buildMocks();
      const handle = mountSignInModal({
        supabase,
        authAdapter: adapter,
        mode: "signin",
      });
      handle.open();
      expect(
        document.querySelector("#geoglowsSignInToggleMode"),
      ).toBeNull();
    });
  });

  describe("mode: 'full' (default)", () => {
    it("renders the sign-up toggle so users can switch modes", () => {
      const { supabase, adapter } = buildMocks();
      const handle = mountSignInModal({ supabase, authAdapter: adapter });
      handle.open();
      expect(
        document.querySelector("#geoglowsSignInToggleMode"),
      ).not.toBeNull();
    });

    it("toggling to sign-up renders first/last name fields", () => {
      const { supabase, adapter } = buildMocks();
      const handle = mountSignInModal({ supabase, authAdapter: adapter });
      handle.open();
      const toggle = document.querySelector(
        "#geoglowsSignInToggleMode",
      ) as HTMLButtonElement;
      toggle.click();
      expect(
        document.querySelector('input[name="first_name"]'),
      ).not.toBeNull();
      expect(
        document.querySelector('input[name="last_name"]'),
      ).not.toBeNull();
    });

    it("validates first_name presence in sign-up mode", () => {
      const { supabase, adapter } = buildMocks();
      const handle = mountSignInModal({ supabase, authAdapter: adapter });
      handle.open();
      (
        document.querySelector(
          "#geoglowsSignInToggleMode",
        ) as HTMLButtonElement
      ).click();

      const form = document.querySelector(
        "#geoglowsSignInForm",
      ) as HTMLFormElement;
      // Leave first_name empty
      (form.elements.namedItem("last_name") as HTMLInputElement).value = "X";
      (form.elements.namedItem("email") as HTMLInputElement).value =
        "user@example.com";
      (form.elements.namedItem("password") as HTMLInputElement).value =
        "hunter2";
      form.dispatchEvent(
        new Event("submit", { cancelable: true, bubbles: true }),
      );
      const alert = document.querySelector('[role="alert"]');
      expect(alert?.textContent).toContain("first name");
      expect(adapter.signInWithPassword).not.toHaveBeenCalled();
      expect(supabase.auth.signUp).not.toHaveBeenCalled();
    });
  });

  it("unmount() removes the dialog from the DOM", () => {
    const { supabase, adapter } = buildMocks();
    const handle = mountSignInModal({ supabase, authAdapter: adapter });
    expect(document.querySelector("#geoglowsSignInModal")).not.toBeNull();
    handle.unmount();
    expect(document.querySelector("#geoglowsSignInModal")).toBeNull();
  });
});
