import { useAuth } from "./AuthProvider";

export function LoginPage() {
  const { signIn, loading } = useAuth();

  return (
    <div style={{ padding: 24 }}>
      <h1>Sign in</h1>
      <p>Sign in with your GEOGLOWS account.</p>
      <button onClick={() => signIn()} disabled={loading}>
        Continue to login
      </button>
    </div>
  );
}