import { useAuth } from "./AuthProvider";

export function UserMenu() {
  const { user, signIn, signOut } = useAuth();

  if (!user) {
    return <button onClick={() => signIn()}>Sign In</button>;
  }

  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
      <span>{user.email ?? "Signed in"}</span>
      <button onClick={() => signOut()}>Log out</button>
    </div>
  );
}