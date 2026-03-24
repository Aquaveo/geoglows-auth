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
  onStateChange?: (state: SessionState) => void;
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

export async function bootstrapSession({
  auth,
  supabase,
  syncProfile = true,
  loadAccount = true,
  onStateChange,
}: BootstrapSessionOptions): Promise<SessionState> {
  let currentUser: AuthUser | null = null;
  let currentAccount: AccountSummary | null = null;
  let currentState = createState();

  const emit = (overrides: Partial<SessionState>) => {
    currentState = createState({
      ...currentState,
      ...overrides,
    });
    onStateChange?.(currentState);
    return currentState;
  };

  try {
    emit({ status: "bootstrapping", error: null, user: null, account: null });

    auth.setupTokenRenewal();
    await auth.clearStaleAuthState();

    emit({ status: "processing_callback" });
    const callbackUser = await auth.completeSignInIfNeeded();
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
      account: null,
      error: null,
    });

    if (syncProfile) {
      emit({
        status: "loading_profile",
        user: currentUser,
        account: null,
        error: null,
      });
      await ensureProfile(supabase, currentUser);
    }

    if (loadAccount) {
      emit({
        status: "loading_account",
        user: currentUser,
        account: null,
        error: null,
      });
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