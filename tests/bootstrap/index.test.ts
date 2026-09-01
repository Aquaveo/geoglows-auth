import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "../../src/types";
import type { SessionState } from "../../src/core/session";

// The rendering half of `core` is kept real: these tests assert what ends up in
// the navbar slot, which is the observable behaviour, rather than which
// functions were called. Only the pieces that would reach the network (the
// client, the adapter, the session pipeline) and the <dialog> are stubbed.
vi.mock("../../src/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/core")>();
  return {
    ...actual,
    bootstrapSession: vi.fn(),
    createGeoglowsSupabaseClient: vi.fn(),
    createSupabaseAuthAdapter: vi.fn(),
    mountSignInModal: vi.fn(),
  };
});

import {
  bootstrapSession,
  createGeoglowsSupabaseClient,
  createSupabaseAuthAdapter,
  mountSignInModal,
} from "../../src/core";
import { bootstrapAuth, type ConnectEvent } from "../../src/bootstrap";

const bootstrapSessionMock = vi.mocked(bootstrapSession);
const createClientMock = vi.mocked(createGeoglowsSupabaseClient);
const createAdapterMock = vi.mocked(createSupabaseAuthAdapter);
const mountSignInModalMock = vi.mocked(mountSignInModal);

type AuthChangeHandler = (event: string, session: unknown) => void;

interface Harness {
  fire: (event: string, session?: unknown) => void;
  startAutoRefresh: ReturnType<typeof vi.fn>;
  stopAutoRefresh: ReturnType<typeof vi.fn>;
  unsubscribe: ReturnType<typeof vi.fn>;
  openModal: ReturnType<typeof vi.fn>;
  slot: HTMLElement;
}

function buildUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    sub: "user-1",
    email: "scientist@example.com",
    name: "Scientist Name",
    access_token: "token",
    id_token: undefined,
    expired: false,
    profile: {},
    ...overrides,
  };
}

function ready(user: AuthUser = buildUser()): SessionState {
  return { status: "ready", user, account: { profile: null }, error: null };
}

function anonymous(): SessionState {
  return { status: "anonymous", user: null, account: null, error: null };
}

function failure(error: unknown): SessionState {
  return { status: "error", user: null, account: null, error };
}

/** A transport failure — the kind the budget exists to retry. */
const networkError = () => new TypeError("Failed to fetch");
/** An RLS denial — the kind no number of identical retries can fix. */
const permissionError = () => ({
  message: "permission denied for table profiles",
  code: "42501",
  status: 403,
});

function install(): Harness {
  // The failure paths under test log deliberately; keep the suite output about
  // the assertions rather than the expected warnings.
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "debug").mockImplementation(() => {});

  const handlers: AuthChangeHandler[] = [];
  const startAutoRefresh = vi.fn().mockResolvedValue(undefined);
  const stopAutoRefresh = vi.fn().mockResolvedValue(undefined);
  const unsubscribe = vi.fn();
  const openModal = vi.fn();

  const client = {
    auth: {
      onAuthStateChange: vi.fn((handler: AuthChangeHandler) => {
        handlers.push(handler);
        return { data: { subscription: { unsubscribe } } };
      }),
      startAutoRefresh,
      stopAutoRefresh,
    },
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createClientMock.mockReturnValue(client as any);
  createAdapterMock.mockReturnValue({
    signOutRedirect: vi.fn().mockResolvedValue(undefined),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mountSignInModalMock.mockReturnValue({ open: openModal, close: vi.fn() } as any);

  const slot = document.createElement("div");
  slot.id = "auth-action";
  document.body.appendChild(slot);

  return {
    fire: (event, session) => handlers.forEach((h) => h(event, session)),
    startAutoRefresh,
    stopAutoRefresh,
    unsubscribe,
    openModal,
    slot,
  };
}

/** Let queued microtasks and any timer up to `ms` run. */
async function tick(ms = 10_000): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

describe("bootstrapAuth connect budget", () => {
  let harness: Harness;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
    bootstrapSessionMock.mockReset();
    createClientMock.mockReset();
    createAdapterMock.mockReset();
    mountSignInModalMock.mockReset();
    harness = install();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("gives up after the configured attempts and renders the retry icon", async () => {
    bootstrapSessionMock.mockResolvedValue(failure(networkError()));

    const handle = bootstrapAuth({
      supabaseUrl: "https://x.supabase.co",
      supabasePublishableKey: "key",
      connect: { attempts: 2, timeoutMs: 1000, giveUpMs: 60_000 },
    });

    harness.fire("INITIAL_SESSION");
    await tick();

    expect(bootstrapSessionMock).toHaveBeenCalledTimes(2);
    expect(harness.slot.innerHTML).toContain('id="geoglowsAuthRetry"');
    expect(harness.slot.innerHTML).not.toContain('id="geoglowsSignIn"');
    expect(handle.getState().status).toBe("error");
    // Nothing left running in the background once we have stopped trying.
    expect(harness.stopAutoRefresh).toHaveBeenCalled();

    handle.destroy();
  });

  it("stops the budget immediately when the failure is permanent", async () => {
    bootstrapSessionMock.mockResolvedValue(failure(permissionError()));

    const handle = bootstrapAuth({
      supabaseUrl: "https://x.supabase.co",
      supabasePublishableKey: "key",
      connect: { attempts: 5, timeoutMs: 1000 },
    });

    harness.fire("INITIAL_SESSION");
    await tick(60_000);

    // A 403/42501 answers the same way every time — retrying it four more
    // times only delays the error the user is going to see anyway.
    expect(bootstrapSessionMock).toHaveBeenCalledTimes(1);
    expect(harness.slot.innerHTML).toContain('id="geoglowsAuthRetry"');

    handle.destroy();
  });

  it("keeps the avatar when the session is real but the account load failed", async () => {
    bootstrapSessionMock.mockResolvedValue({
      status: "error",
      user: buildUser(),
      account: null,
      error: permissionError(),
    });

    const handle = bootstrapAuth({
      supabaseUrl: "https://x.supabase.co",
      supabasePublishableKey: "key",
      connect: { attempts: 3, timeoutMs: 1000 },
    });

    harness.fire("INITIAL_SESSION");
    await tick();

    // Auth reachable + profile unreachable is not the same failure as auth
    // unreachable: the user is signed in, so the avatar is the truth.
    expect(bootstrapSessionMock).toHaveBeenCalledTimes(1);
    expect(harness.slot.innerHTML).toContain('id="geoglowsAuthActionAvatar"');
    expect(harness.slot.innerHTML).not.toContain('id="geoglowsAuthRetry"');
    expect(harness.startAutoRefresh).toHaveBeenCalled();

    handle.destroy();
  });

  it("fails an attempt that never settles, then gives up", async () => {
    bootstrapSessionMock.mockReturnValue(new Promise<SessionState>(() => {}));

    const handle = bootstrapAuth({
      supabaseUrl: "https://x.supabase.co",
      supabasePublishableKey: "key",
      connect: { attempts: 1, timeoutMs: 2000 },
    });

    harness.fire("INITIAL_SESSION");

    await tick(1500);
    expect(harness.slot.innerHTML).not.toContain('id="geoglowsAuthRetry"');

    await tick(1500);
    expect(harness.slot.innerHTML).toContain('id="geoglowsAuthRetry"');

    handle.destroy();
  });

  it("does not replay the OAuth code exchange on a retry", async () => {
    bootstrapSessionMock.mockImplementation(async (options) => {
      // First attempt gets past the callback stage before failing further down.
      options.onStateChange?.({
        status: "processing_callback",
        user: null,
        account: null,
        error: null,
      });
      options.onStateChange?.({
        status: "authenticated",
        user: buildUser(),
        account: null,
        error: null,
      });
      return failure(networkError());
    });

    const handle = bootstrapAuth({
      supabaseUrl: "https://x.supabase.co",
      supabasePublishableKey: "key",
      connect: { attempts: 2, timeoutMs: 1000 },
    });

    harness.fire("INITIAL_SESSION");
    await tick();

    expect(bootstrapSessionMock.mock.calls[0][0].completeCallback).toBe(true);
    // An authorization code is single-use; attempt two must not try again.
    expect(bootstrapSessionMock.mock.calls[1][0].completeCallback).toBe(false);

    handle.destroy();
  });

  it("retry button clears the give-up and re-bootstraps", async () => {
    bootstrapSessionMock.mockResolvedValue(failure(networkError()));

    const handle = bootstrapAuth({
      supabaseUrl: "https://x.supabase.co",
      supabasePublishableKey: "key",
      connect: { attempts: 1, timeoutMs: 1000 },
    });

    harness.fire("INITIAL_SESSION");
    await tick();
    expect(harness.slot.innerHTML).toContain('id="geoglowsAuthRetry"');

    bootstrapSessionMock.mockResolvedValue(ready());
    harness.slot.querySelector<HTMLElement>("#geoglowsAuthRetry")?.click();
    await tick();

    expect(harness.slot.innerHTML).toContain('id="geoglowsAuthActionAvatar"');
    expect(harness.slot.innerHTML).not.toContain('id="geoglowsAuthRetry"');

    handle.destroy();
  });

  it("resumes when the browser comes back online", async () => {
    bootstrapSessionMock.mockResolvedValue(failure(networkError()));

    const handle = bootstrapAuth({
      supabaseUrl: "https://x.supabase.co",
      supabasePublishableKey: "key",
      connect: { attempts: 1, timeoutMs: 1000 },
    });

    harness.fire("INITIAL_SESSION");
    await tick();
    expect(harness.slot.innerHTML).toContain('id="geoglowsAuthRetry"');

    bootstrapSessionMock.mockResolvedValue(anonymous());
    window.dispatchEvent(new Event("online"));
    await tick();

    expect(harness.slot.innerHTML).toContain('id="geoglowsSignIn"');

    handle.destroy();
  });

  it("a SIGNED_OUT clears a given-up connection instead of leaving the error icon", async () => {
    bootstrapSessionMock.mockResolvedValue(failure(networkError()));

    const handle = bootstrapAuth({
      supabaseUrl: "https://x.supabase.co",
      supabasePublishableKey: "key",
      connect: { attempts: 1, timeoutMs: 1000 },
    });

    harness.fire("INITIAL_SESSION");
    await tick();
    expect(harness.slot.innerHTML).toContain('id="geoglowsAuthRetry"');

    bootstrapSessionMock.mockResolvedValue(anonymous());
    harness.fire("SIGNED_OUT");
    await tick();

    expect(harness.slot.innerHTML).toContain('id="geoglowsSignIn"');

    handle.destroy();
  });
});

describe("bootstrapAuth ticker", () => {
  let harness: Harness;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
    bootstrapSessionMock.mockReset();
    createClientMock.mockReset();
    createAdapterMock.mockReset();
    mountSignInModalMock.mockReset();
    harness = install();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("constructs the client with Supabase's own refresh scheduling disabled", () => {
    bootstrapSessionMock.mockResolvedValue(anonymous());

    const handle = bootstrapAuth({
      supabaseUrl: "https://x.supabase.co",
      supabasePublishableKey: "key",
      connect: { timeoutMs: 7000 },
    });

    const options = createClientMock.mock.calls[0][0];
    expect(options.autoRefreshToken).toBe(false);
    expect(options.fetchTimeoutMs).toBe(7000);

    handle.destroy();
  });

  it("never starts the ticker for a signed-out visitor", async () => {
    bootstrapSessionMock.mockResolvedValue(anonymous());

    const handle = bootstrapAuth({
      supabaseUrl: "https://x.supabase.co",
      supabasePublishableKey: "key",
    });

    harness.fire("INITIAL_SESSION");
    await tick();

    expect(harness.startAutoRefresh).not.toHaveBeenCalled();

    handle.destroy();
  });

  it("starts the ticker once a session exists", async () => {
    bootstrapSessionMock.mockResolvedValue(ready());

    const handle = bootstrapAuth({
      supabaseUrl: "https://x.supabase.co",
      supabasePublishableKey: "key",
    });

    harness.fire("INITIAL_SESSION");
    await tick();

    expect(harness.startAutoRefresh).toHaveBeenCalled();

    handle.destroy();
  });
});

describe("bootstrapAuth lifecycle", () => {
  let harness: Harness;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
    bootstrapSessionMock.mockReset();
    createClientMock.mockReset();
    createAdapterMock.mockReset();
    mountSignInModalMock.mockReset();
    harness = install();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("destroy() stops a retry loop that is mid-backoff", async () => {
    bootstrapSessionMock.mockResolvedValue(failure(networkError()));

    const handle = bootstrapAuth({
      supabaseUrl: "https://x.supabase.co",
      supabasePublishableKey: "key",
      connect: { attempts: 5, timeoutMs: 1000, giveUpMs: 60_000 },
    });

    harness.fire("INITIAL_SESSION");
    // Far enough for the first attempt to fail and the loop to be sleeping.
    await tick(100);
    const callsAtTeardown = bootstrapSessionMock.mock.calls.length;

    handle.destroy();
    await tick(60_000);

    // The backoff sleep must not wake up and bootstrap into a torn-down page.
    expect(bootstrapSessionMock).toHaveBeenCalledTimes(callsAtTeardown);
    expect(harness.unsubscribe).toHaveBeenCalled();
  });

  it("a superseded attempt cannot overwrite a newer result", async () => {
    let resolveFirst: ((state: SessionState) => void) | undefined;
    bootstrapSessionMock.mockReturnValueOnce(
      new Promise<SessionState>((resolve) => {
        resolveFirst = resolve;
      }),
    );

    const handle = bootstrapAuth({
      supabaseUrl: "https://x.supabase.co",
      supabasePublishableKey: "key",
      connect: { attempts: 1, timeoutMs: 60_000 },
    });

    harness.fire("INITIAL_SESSION");
    await tick(10);

    // A newer trigger lands and commits a real session first.
    bootstrapSessionMock.mockResolvedValue(ready(buildUser({ sub: "user-2" })));
    harness.fire("SIGNED_IN", { user: { id: "user-2" } });
    await tick(10);
    expect(harness.slot.innerHTML).toContain('id="geoglowsAuthActionAvatar"');

    // The abandoned first attempt finally answers — and must not clobber it.
    resolveFirst?.(anonymous());
    await tick(10);

    expect(handle.getState().user?.sub).toBe("user-2");
    expect(harness.slot.innerHTML).toContain('id="geoglowsAuthActionAvatar"');

    handle.destroy();
  });

  it("commits a late success rather than discarding a valid session", async () => {
    let resolveFirst: ((state: SessionState) => void) | undefined;
    bootstrapSessionMock.mockReturnValueOnce(
      new Promise<SessionState>((resolve) => {
        resolveFirst = resolve;
      }),
    );

    const handle = bootstrapAuth({
      supabaseUrl: "https://x.supabase.co",
      supabasePublishableKey: "key",
      connect: { attempts: 1, timeoutMs: 2000 },
    });

    harness.fire("INITIAL_SESSION");
    await tick(3000);
    // Timed out and gave up.
    expect(harness.slot.innerHTML).toContain('id="geoglowsAuthRetry"');

    // The slow request eventually answers with a real session. Late is better
    // than an error icon over a valid session.
    resolveFirst?.(ready());
    await tick(10);

    expect(harness.slot.innerHTML).toContain('id="geoglowsAuthActionAvatar"');
    expect(handle.getState().user?.sub).toBe("user-1");

    handle.destroy();
  });

  it("does not open a sign-in modal that cannot work, and retries instead", async () => {
    bootstrapSessionMock.mockResolvedValue(failure(networkError()));

    const handle = bootstrapAuth({
      supabaseUrl: "https://x.supabase.co",
      supabasePublishableKey: "key",
      connect: { attempts: 1, timeoutMs: 1000 },
    });

    harness.fire("INITIAL_SESSION");
    await tick();
    expect(harness.slot.innerHTML).toContain('id="geoglowsAuthRetry"');

    bootstrapSessionMock.mockResolvedValue(anonymous());
    handle.openSignIn();
    expect(harness.openModal).not.toHaveBeenCalled();

    await tick();
    // The connection recovered, so the next request opens the form normally.
    handle.openSignIn();
    expect(harness.openModal).toHaveBeenCalledTimes(1);

    handle.destroy();
  });

  it("reports the connect lifecycle to onConnectState", async () => {
    bootstrapSessionMock.mockResolvedValue(failure(networkError()));
    const events: ConnectEvent[] = [];

    const handle = bootstrapAuth({
      supabaseUrl: "https://x.supabase.co",
      supabasePublishableKey: "key",
      onConnectState: (event) => events.push(event),
      connect: { attempts: 2, timeoutMs: 1000 },
    });

    harness.fire("INITIAL_SESSION");
    await tick();

    expect(events.map((e) => e.phase)).toEqual(["retrying", "gave_up"]);
    expect(events[0].nextRetryInMs).toBeGreaterThan(0);
    expect(events[1].attempt).toBe(2);

    handle.destroy();
  });

  it("clamps a nonsensical attempt count instead of giving up before trying", async () => {
    bootstrapSessionMock.mockResolvedValue(anonymous());

    const handle = bootstrapAuth({
      supabaseUrl: "https://x.supabase.co",
      supabasePublishableKey: "key",
      connect: { attempts: 0 },
    });

    harness.fire("INITIAL_SESSION");
    await tick();

    expect(bootstrapSessionMock).toHaveBeenCalledTimes(1);
    expect(harness.slot.innerHTML).toContain('id="geoglowsSignIn"');

    handle.destroy();
  });
});
