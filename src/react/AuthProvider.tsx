import React, { createContext, useContext, useEffect, useState } from "react";
import type {
  AuthAdapter,
  AuthContextValue,
  AuthUser,
  Profile,
} from "../types";
import { useSupabase } from "./SupabaseProvider";
import { ensureProfile } from "../core/profile";

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({
  auth,
  children,
}: {
  auth: AuthAdapter;
  children: React.ReactNode;
}) {
  const supabase = useSupabase();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    try {
      await auth.clearStaleAuthState();
      auth.setupTokenRenewal?.();
      await auth.completeSignInIfNeeded();

      const nextUser = await auth.getCurrentUser();
      setUser(nextUser);

      if (!nextUser) {
        setProfile(null);
        return;
      }

      const nextProfile = await ensureProfile(supabase, nextUser);
      setProfile(nextProfile);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh().catch((error) => {
      console.error("AuthProvider refresh failed:", error);
      setLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value: AuthContextValue = {
    user,
    profile,
    loading,
    refresh,
    signIn: () => auth.signInRedirect(),
    signOut: () => auth.signOutRedirect(),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
