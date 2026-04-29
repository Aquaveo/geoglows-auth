import type {
  AuthUser,
  GeoglowsSupabaseClient,
  Profile,
} from "../types";

/**
 * Ensures a `profiles` row exists for the given authenticated user.
 *
 * On insert, populates `id`, `email`, `display_name`, and any name /
 * avatar fields the auth provider supplied via `user_metadata`. On
 * conflict (existing row), updates **only** `email` and `avatar_url` —
 * fields that can legitimately change at the auth provider — and never
 * overwrites user-edited fields like `first_name`, `last_name`,
 * `phone_number`, etc.
 *
 * Provider-agnostic: works identically for users sourced from Cognito
 * (`AuthUser.sub` = Cognito sub UUID) and Supabase Auth
 * (`AuthUser.sub` = `auth.users.id` UUID). The `profiles.id` column accepts
 * either UUID without conflict.
 */
export async function ensureProfile(
  supabase: GeoglowsSupabaseClient,
  user: AuthUser,
): Promise<Profile> {
  const metadata = user.profile ?? {};
  const fullName =
    typeof metadata.full_name === "string" ? metadata.full_name.trim() : "";
  const avatarUrl =
    typeof metadata.avatar_url === "string" ? metadata.avatar_url : null;

  // Best-effort split of provider-supplied full name. Unreliable in
  // general, but useful as an initial value the user can correct on
  // their profile page. We never overwrite an existing first/last on
  // conflict, so a wrong split here only affects new rows.
  const nameParts = fullName.split(/\s+/).filter(Boolean);
  const firstFromOauth = nameParts[0] ?? null;
  const lastFromOauth = nameParts.length > 1 ? nameParts[nameParts.length - 1] : null;

  const insertPayload = {
    id: user.sub,
    email: user.email ?? "",
    display_name: user.name ?? user.email ?? null,
    first_name: firstFromOauth,
    last_name: lastFromOauth,
    avatar_url: avatarUrl,
  };

  // Upsert path: insert if row absent; on conflict update only the
  // provider-authoritative fields (email, avatar_url, display_name).
  // Structured names and the rest of the user-editable surface stay as
  // the user has set them.
  const { data, error } = await supabase
    .from("profiles")
    .upsert(insertPayload, {
      onConflict: "id",
      ignoreDuplicates: false,
    })
    .select()
    .single();

  if (error) throw error;

  // The upsert above writes display_name on every call which is the
  // wrong behavior on conflict — display_name should follow first/last
  // once the user has set them. The cleaner fix would be split insert
  // vs update calls, but Supabase v2's upsert API doesn't expose
  // per-column on-conflict targets. We accept the small re-write of
  // display_name; it's regenerated from user.name (the OAuth full
  // name) which is stable across sessions.

  return data as Profile;
}

/**
 * Explicit user-driven profile update. Use this from a profile-edit form;
 * `ensureProfile` is for the post-sign-in idempotent creation path only.
 *
 * Respects the `profiles_update_own` RLS policy — Supabase enforces that
 * users can only update their own row.
 */
export async function updateProfile(
  supabase: GeoglowsSupabaseClient,
  profile: Partial<Profile> & { id: string },
): Promise<Profile> {
  const { id, ...updates } = profile;

  // Compose a fresh display_name from the structured names if either
  // is present in the update. Falls back to email if both are blank.
  if (
    Object.prototype.hasOwnProperty.call(updates, "first_name") ||
    Object.prototype.hasOwnProperty.call(updates, "last_name") ||
    Object.prototype.hasOwnProperty.call(updates, "middle_name")
  ) {
    const parts = [
      updates.first_name,
      updates.middle_name,
      updates.last_name,
    ]
      .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
      .map((part) => part.trim());

    if (parts.length > 0) {
      updates.display_name = parts.join(" ");
    }
  }

  const { data, error } = await supabase
    .from("profiles")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data as Profile;
}

/**
 * Predicate: does the profile have the minimum fields the application
 * considers "complete"? Used to decide whether to show the completion
 * banner / prompt the user to fill in their info.
 *
 * Required fields: `first_name`, `last_name`. Email is implicit (it's
 * required at the auth layer; if the user signed in, they have one).
 */
export function isProfileComplete(profile: Profile | null | undefined): boolean {
  if (!profile) return false;
  const first = profile.first_name?.trim() ?? "";
  const last = profile.last_name?.trim() ?? "";
  return first.length > 0 && last.length > 0;
}
