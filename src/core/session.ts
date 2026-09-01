import type { AuthAdapter, AuthUser, GeoglowsSupabaseClient } from "../types";
import { loadAccountSummary, type AccountSummary } from "./account";
import { ensureProfile } from "./profile";

export type SessionStatus =
  | "bootstrapping"
  | "processing_callback"
  | "anonymous"
  | "authenticated"
  | "loading_profile"
  | "loading_account"
  | "ready"
  | "error";

export interface SessionState {
  status: SessionStatus;
  user: AuthUser | null;
  account: AccountSummary | null;
  error: unknown | null;
}

export interface BootstrapSessionOptions {
  auth: AuthAdapter;
  supabase: GeoglowsSupabaseClient;
  syncProfile?: boolean;
  loadAccount?: boolean;
  /**
   * Run `auth.completeSignInIfNeeded()` — the OAuth callback exchange. Default
   * `true`.
   *
   * Pass `false` when re-running bootstrap after a failure that happened
   * *after* the callback was already consumed. An authorization code is
   * single-use: a retry that replays the exchange fails with a different and
   * more confusing error than the one being retried.
   */
  completeCallback?: boolean;
  onStateChange?: (state: SessionState) => void;
  /**
   * Optional baseline state — pass the consumer's currently-known
   * `{ status, user, account }` when re-running bootstrap (for example,
   * in response to Supabase's `SIGNED_IN` event firing on tab focus).
   * The transient `bootstrapping` / `loading_profile` / `loading_account`
   * emits will preserve the previous user and account values instead of
   * nulling them, avoiding the visible "Signing in…" flicker on the
   * navbar avatar slot.
   *
   * Omit on first bootstrap.
   */
  initialState?: SessionState;
}

export interface UserDisplayInfo {
  name: string;
  email: string;
  initials: string;
}

function createState(overrides: Partial<SessionState> = {}): SessionState {
  return {
    status: "bootstrapping",
    user: null,
    account: null,
    error: null,
    ...overrides,
  };
}

function buildInitials(value: string): string {
  const cleaned = value.trim();
  if (!cleaned) return "U";

  const parts = cleaned
    .replace(/[@._-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  const initials = parts.map((part) => part[0]?.toUpperCase() ?? "").join("");
  return initials || "U";
}

export function getUserDisplayInfo(
  user: AuthUser | null,
  account: AccountSummary | null
): UserDisplayInfo {
  const name =
    account?.profile?.display_name?.trim() ||
    user?.name?.trim() ||
    user?.email?.trim() ||
    "Signed in";

  const email = account?.profile?.email?.trim() || user?.email?.trim() || "";

  return {
    name,
    email,
    initials: buildInitials(name === "Signed in" && email ? email : name),
  };
}

/**
 * Bootstraps a session: completes any pending sign-in callback, fetches the
 * current user, syncs the profile row, and loads the account summary.
 *
 * Provider-agnostic: works identically with `createOidcAuthAdapter` (Cognito)
 * and `createSupabaseAuthAdapter` (Supabase Auth). Both produce an `AuthUser`
 * with the same shape, and the orchestration here only depends on the
 * `AuthAdapter` interface.
 */
export async function bootstrapSession({
  auth,
  supabase,
  syncProfile = true,
  loadAccount = true,
  completeCallback = true,
  onStateChange,
  initialState,
}: BootstrapSessionOptions): Promise<SessionState> {
  // When initialState is provided (rebootstrap on tab focus etc.), seed
  // currentUser / currentAccount / currentState from it. Transient phases
  // then carry the previous values forward until the new authoritative
  // ones arrive, avoiding the avatar → "Signing in…" flicker.
  let currentUser: AuthUser | null = initialState?.user ?? null;
  let currentAccount: AccountSummary | null = initialState?.account ?? null;
  let currentState: SessionState = initialState ?? createState();

  const emit = (overrides: Partial<SessionState>) => {
    currentState = createState({
      ...currentState,
      ...overrides,
    });
    onStateChange?.(currentState);
    return currentState;
  };

  try {
    // Carry previous user/account through the transient phase. On first
    // bootstrap (no initialState), they are already null in currentState,
    // so this is a no-op for that path.
    emit({ status: "bootstrapping", error: null });

    auth.setupTokenRenewal();
    await auth.clearStaleAuthState();

    emit({ status: "processing_callback" });
    const callbackUser = completeCallback
      ? await auth.completeSignInIfNeeded()
      : null;
    currentUser = callbackUser ?? (await auth.getCurrentUser());

    if (!currentUser) {
      return emit({
        status: "anonymous",
        user: null,
        account: null,
        error: null,
      });
    }

    if (!currentUser.sub?.trim()) {
      throw new Error("Authenticated user is missing a subject identifier");
    }

    emit({
      status: "authenticated",
      user: currentUser,
      error: null,
    });

    if (syncProfile) {
      emit({ status: "loading_profile", user: currentUser, error: null });
      await ensureProfile(supabase, currentUser);
    }

    if (loadAccount) {
      emit({ status: "loading_account", user: currentUser, error: null });
      currentAccount = await loadAccountSummary(supabase, currentUser.sub);
    }

    return emit({
      status: "ready",
      user: currentUser,
      account: currentAccount,
      error: null,
    });
  } catch (error) {
    return emit({
      status: "error",
      user: currentUser,
      account: currentAccount,
      error,
    });
  }
}