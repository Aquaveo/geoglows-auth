import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let lastAuthProps: any = null;
const mockAuth = vi.fn((props: Record<string, unknown>) => {
  lastAuthProps = props;
  return <div data-testid="mock-supabase-auth">supabase-auth-ui</div>;
});

vi.mock("@supabase/auth-ui-react", () => ({
  Auth: mockAuth,
}));

const refreshMock = vi.fn(async () => {});
vi.mock("../../src/react/AuthProvider", () => ({
  useAuth: () => ({ refresh: refreshMock }),
}));

import { SupabaseAuthUI } from "../../src/react/SupabaseAuthUI";

interface AuthStateChangeListener {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (event: string, session: any): void;
}

interface MockSupabase {
  auth: {
    onAuthStateChange: ReturnType<typeof vi.fn>;
  };
  __emit(event: string, session: unknown): void;
}

function buildMockSupabase(): MockSupabase {
  let listener: AuthStateChangeListener | null = null;
  const unsubscribe = vi.fn();
  const onAuthStateChange = vi.fn((cb: AuthStateChangeListener) => {
    listener = cb;
    return { data: { subscription: { unsubscribe } } };
  });
  return {
    auth: { onAuthStateChange },
    __emit(event, session) {
      listener?.(event, session);
    },
  };
}

describe("<SupabaseAuthUI>", () => {
  beforeEach(() => {
    refreshMock.mockClear();
    mockAuth.mockClear();
    lastAuthProps = null;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders the underlying Supabase Auth UI with forwarded props", async () => {
    const supabase = buildMockSupabase();

    render(
      <SupabaseAuthUI
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        supabase={supabase as any}
        providers={["google", "github"]}
        redirectTo="https://app.example.com/auth/callback"
      />,
    );

    await waitFor(() => screen.getByTestId("mock-supabase-auth"));

    expect(lastAuthProps.supabaseClient).toBe(supabase);
    expect(lastAuthProps.providers).toEqual(["google", "github"]);
    expect(lastAuthProps.redirectTo).toBe("https://app.example.com/auth/callback");
  });

  it("forwards `appearance` prop transparently", async () => {
    const supabase = buildMockSupabase();
    const appearance = { theme: { default: { colors: { brand: "#aabbcc" } } } };

    render(
      <SupabaseAuthUI
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        supabase={supabase as any}
        appearance={appearance}
      />,
    );

    await waitFor(() => screen.getByTestId("mock-supabase-auth"));
    expect(lastAuthProps.appearance).toBe(appearance);
  });

  it("renders without an appearance prop by passing undefined", async () => {
    const supabase = buildMockSupabase();

    render(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      <SupabaseAuthUI supabase={supabase as any} />,
    );

    await waitFor(() => screen.getByTestId("mock-supabase-auth"));
    expect(lastAuthProps.appearance).toBeUndefined();
  });

  it("calls AuthProvider.refresh() on SIGNED_IN events", async () => {
    const supabase = buildMockSupabase();

    render(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      <SupabaseAuthUI supabase={supabase as any} />,
    );

    await waitFor(() => screen.getByTestId("mock-supabase-auth"));

    await act(async () => {
      supabase.__emit("SIGNED_IN", { user: { id: "u1" } });
    });

    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("calls AuthProvider.refresh() on SIGNED_OUT events", async () => {
    const supabase = buildMockSupabase();

    render(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      <SupabaseAuthUI supabase={supabase as any} />,
    );

    await waitFor(() => screen.getByTestId("mock-supabase-auth"));

    await act(async () => {
      supabase.__emit("SIGNED_OUT", null);
    });

    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("does NOT call refresh() for non-sign events (e.g. TOKEN_REFRESHED)", async () => {
    const supabase = buildMockSupabase();

    render(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      <SupabaseAuthUI supabase={supabase as any} />,
    );

    await waitFor(() => screen.getByTestId("mock-supabase-auth"));

    await act(async () => {
      supabase.__emit("TOKEN_REFRESHED", { user: { id: "u1" } });
    });

    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("forwards every auth event to onAuthEvent callback", async () => {
    const supabase = buildMockSupabase();
    const onAuthEvent = vi.fn();

    render(
      <SupabaseAuthUI
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        supabase={supabase as any}
        onAuthEvent={onAuthEvent}
      />,
    );

    await waitFor(() => screen.getByTestId("mock-supabase-auth"));

    const session = { user: { id: "u1" } };
    await act(async () => {
      supabase.__emit("SIGNED_IN", session);
    });
    await act(async () => {
      supabase.__emit("TOKEN_REFRESHED", session);
    });
    await act(async () => {
      supabase.__emit("SIGNED_OUT", null);
    });

    expect(onAuthEvent).toHaveBeenCalledTimes(3);
    expect(onAuthEvent).toHaveBeenNthCalledWith(1, { event: "SIGNED_IN", session });
    expect(onAuthEvent).toHaveBeenNthCalledWith(2, {
      event: "TOKEN_REFRESHED",
      session,
    });
    expect(onAuthEvent).toHaveBeenNthCalledWith(3, {
      event: "SIGNED_OUT",
      session: null,
    });
  });

  it("unsubscribes from auth state changes on unmount", async () => {
    const supabase = buildMockSupabase();

    const { unmount } = render(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      <SupabaseAuthUI supabase={supabase as any} />,
    );

    await waitFor(() => screen.getByTestId("mock-supabase-auth"));

    const subscriptionResult =
      supabase.auth.onAuthStateChange.mock.results[0].value;
    expect(subscriptionResult.data.subscription.unsubscribe).not.toHaveBeenCalled();

    unmount();
    expect(subscriptionResult.data.subscription.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("survives a refresh() rejection without throwing", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    refreshMock.mockRejectedValueOnce(new Error("boom"));
    const supabase = buildMockSupabase();

    render(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      <SupabaseAuthUI supabase={supabase as any} />,
    );

    await waitFor(() => screen.getByTestId("mock-supabase-auth"));

    await act(async () => {
      supabase.__emit("SIGNED_IN", { user: { id: "u1" } });
    });

    await waitFor(() => expect(errorSpy).toHaveBeenCalled());
  });
});

describe("<SupabaseAuthUI> when @supabase/auth-ui-react is not installed", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("throws an actionable error pointing to the missing peer dependency", async () => {
    vi.doMock("@supabase/auth-ui-react", () => {
      throw new Error("Cannot find module '@supabase/auth-ui-react'");
    });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { SupabaseAuthUI: ReloadedAuthUI } = await import(
      "../../src/react/SupabaseAuthUI"
    );
    const supabase = buildMockSupabase();

    class ErrorBoundary extends (
      await import("react")
    ).Component<
      { children: React.ReactNode },
      { error: Error | null }
    > {
      state = { error: null as Error | null };
      static getDerivedStateFromError(error: Error) {
        return { error };
      }
      render() {
        if (this.state.error) {
          return (
            <div data-testid="boundary-error">{this.state.error.message}</div>
          );
        }
        return this.props.children;
      }
    }

    render(
      <ErrorBoundary>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <ReloadedAuthUI supabase={supabase as any} />
      </ErrorBoundary>,
    );

    await waitFor(() => screen.getByTestId("boundary-error"));
    expect(screen.getByTestId("boundary-error").textContent).toMatch(
      /requires `@supabase\/auth-ui-react`/,
    );
    errorSpy.mockRestore();
  });
});
