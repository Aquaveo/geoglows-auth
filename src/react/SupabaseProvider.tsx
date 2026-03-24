import React, { createContext, useContext } from "react";
import type { GeoglowsSupabaseClient } from "../types";

const SupabaseContext = createContext<GeoglowsSupabaseClient | null>(null);

export function SupabaseProvider({
  client,
  children,
}: {
  client: GeoglowsSupabaseClient;
  children: React.ReactNode;
}) {
  return (
    <SupabaseContext.Provider value={client}>
      {children}
    </SupabaseContext.Provider>
  );
}

export function useSupabase() {
  const client = useContext(SupabaseContext);
  if (!client) {
    throw new Error("useSupabase must be used inside SupabaseProvider");
  }
  return client;
}