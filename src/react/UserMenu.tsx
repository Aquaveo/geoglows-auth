import { useAuth } from "./AuthProvider";
import { sanitizeHref } from "../core/escape";

/**
 * Avatar dropdown for the currently signed-in user.
 *
 * When `profileHref` is provided AND `sanitizeHref` accepts the scheme, a
 * Profile link is rendered as a dropdown item. The default (`undefined`) omits
 * the link entirely — preserves backward compat for consumers that have not
 * migrated. Pass `null` to make "no link" explicit. Dangerous URL schemes
 * (`javascript:`, `data:`, `vbscript:`) are rejected and behave the same as
 * `null`.
 *
 * The label is hardcoded to the literal string "Profile"; only the href is
 * configurable.
 */
export interface UserMenuProps {
  profileHref?: string | null;
}

export function UserMenu({ profileHref }: UserMenuProps = {}) {
  const { user, signIn, signOut } = useAuth();

  if (!user) {
    return <button onClick={() => signIn()}>Sign In</button>;
  }

  const safeProfileHref = sanitizeHref(profileHref);

  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
      <span>{user.email ?? "Signed in"}</span>
      {safeProfileHref !== null && <a href={safeProfileHref}>Profile</a>}
      <button onClick={() => signOut()}>Log out</button>
    </div>
  );
}
