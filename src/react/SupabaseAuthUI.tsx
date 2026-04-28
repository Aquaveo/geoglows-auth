import {
  Suspense,
  lazy,
  useEffect,
  useMemo,
  type ComponentType,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { AuthChangeEvent, Session, SupabaseClient } from "@supabase/supabase-js";
import { useAuth } from "./AuthProvider";

const MISSING_PEER_DEP_MESSAGE =
  "@aquaveo/geoglows-auth: <SupabaseAuthUI> requires `@supabase/auth-ui-react` and " +
  "`@supabase/auth-ui-shared`. Install with: " +
  "`npm install @supabase/auth-ui-react @supabase/auth-ui-shared`. " +
  "Or build a custom form using the headless adapter methods (signInWithPassword, " +
  "signInWithMagicLink, signInWithOAuth) on createSupabaseAuthAdapter.";

// Loosely typed because @supabase/auth-ui-react is an optional peer dependency
// that may not be installed in every consumer's environment.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AuthUIProps = Record<string, any>;
type AuthUIComponent = ComponentType<AuthUIProps>;

const LazyAuthUI = lazy<AuthUIComponent>(async () => {
  try {
    const mod = await import(
      /* @vite-ignore */
      "@supabase/auth-ui-react"
    );
    if (!mod?.Auth) {
      throw new Error(MISSING_PEER_DEP_MESSAGE);
    }
    return { default: mod.Auth as unknown as AuthUIComponent };
  } catch (error) {
    if (error instanceof Error && error.message === MISSING_PEER_DEP_MESSAGE) {
      throw error;
    }
    throw new Error(MISSING_PEER_DEP_MESSAGE);
  }
});

export interface SupabaseAuthUIEvent {
  event: AuthChangeEvent;
  session: Session | null;
}

export interface SupabaseAuthUIProps {
  supabase: SupabaseClient;
  providers?: string[];
  redirectTo?: string;
  view?: "sign_in" | "sign_up" | "magic_link" | "forgotten_password" | "update_password";
  /**
   * Pass-through to `@supabase/auth-ui-react`'s `appearance` prop. Forwarded
   * verbatim so consumers retain full control over theming (ThemeSupa, custom
   * Tailwind classes, inline style overrides, etc.).
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  appearance?: Record<string, any>;
  /**
   * Fired on every auth state change emitted by Supabase
   * (`SIGNED_IN`, `SIGNED_OUT`, `TOKEN_REFRESHED`, etc.).
   */
  onAuthEvent?: (event: SupabaseAuthUIEvent) => void;
  /** Rendered while the optional UI library is being loaded. */
  fallback?: ReactNode;
  /** Applied to the wrapper element only, not forwarded to the inner UI. */
  containerStyle?: CSSProperties;
}

export function SupabaseAuthUI({
  supabase,
  providers,
  redirectTo,
  view,
  appearance,
  onAuthEvent,
  fallback = null,
  containerStyle,
}: SupabaseAuthUIProps) {
  const { refresh } = useAuth();

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      onAuthEvent?.({ event, session });
      if (event === "SIGNED_IN" || event === "SIGNED_OUT") {
        refresh().catch((err) => {
          console.error("AuthProvider refresh failed after Supabase auth event:", err);
        });
      }
    });
    return () => data.subscription.unsubscribe();
  }, [supabase, refresh, onAuthEvent]);

  const innerProps = useMemo<AuthUIProps>(
    () => ({
      supabaseClient: supabase,
      providers,
      redirectTo,
      view,
      appearance,
    }),
    [supabase, providers, redirectTo, view, appearance],
  );

  return (
    <div style={containerStyle}>
      <Suspense fallback={fallback}>
        <LazyAuthUI {...innerProps} />
      </Suspense>
    </div>
  );
}
