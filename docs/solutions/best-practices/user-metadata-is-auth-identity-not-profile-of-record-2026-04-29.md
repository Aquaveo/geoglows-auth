---
title: Supabase user_metadata is auth-time identity, not the profile of record
date: 2026-04-29
category: best-practices
module: geoglows-auth
problem_type: best_practice
component: authentication
severity: high
applies_when:
  - You build any feature that lets users edit name, avatar, or contact info post-sign-up
  - Your auth provider populates user_metadata from the OAuth id_token or sign-up form
  - You have a separate `profiles` (or equivalent) table where user-edited values live
tags:
  - supabase
  - authentication
  - profile
  - user-metadata
  - data-of-record
  - identity
---

# Supabase user_metadata is auth-time identity, not the profile of record

## Context

Supabase Auth populates `auth.users.raw_user_meta_data` (exposed as `user.user_metadata` in the JS client) from two sources at one specific moment:

1. The OAuth provider's `id_token` claims (Google `name`, GitHub `name`/`avatar_url`, etc.) — at the moment of sign-in via OAuth.
2. Whatever `options.data` you pass to `supabase.auth.signUp({ ..., options: { data: {...} } })` — at the moment of sign-up.

That's it. Supabase Auth does **not** update `user_metadata` after that. There is no automatic refresh from OAuth providers when the user's name changes upstream. There is no UI surface that writes back to `user_metadata` when the user edits their profile in your app. It is *frozen at sign-up time*, and treating it as a live source of truth is the root cause of an entire class of profile-data-loss bugs.

A common-but-wrong pattern: a post-auth hook that "ensures the profile row matches user_metadata" by re-syncing on every sign-in. Whatever the user has edited in your app — first/last name, display name, avatar — gets clobbered with the sign-up-time values silently, every session.

## Guidance

Treat `user_metadata` as **seed data for first creation only**. Anything user-editable belongs in your own table (typically `public.profiles`) and is the profile of record from then on.

```typescript
// CORRECT shape
async function ensureProfile(supabase, user) {
  // 1. Look up the existing row.
  const { data: existing } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.sub)
    .maybeSingle();

  // 2. If it exists, return it as-is. user_metadata is irrelevant now.
  if (existing) return existing;

  // 3. Row is absent — this is the first sign-in. Seed from user_metadata.
  return await supabase
    .from("profiles")
    .insert({
      id: user.sub,
      email: user.email,
      display_name: user.name ?? user.email,
      first_name: user.user_metadata?.first_name ?? null,
      last_name: user.user_metadata?.last_name ?? null,
      avatar_url: user.user_metadata?.avatar_url ?? null,
    })
    .select()
    .single()
    .then(({ data }) => data);
}
```

The opposite shape — `upsert` with the metadata-derived payload and `ignoreDuplicates: false` — *re-derives* on every conflict. See the bug tracked in `docs/solutions/logic-errors/ensureprofile-upsert-overwrites-user-edits-2026-04-29.md`.

What this means in practice for each kind of field:

| Field | First insert | Subsequent reads | Updates |
|---|---|---|---|
| `first_name`, `last_name`, `middle_name` | seed from `user_metadata.first_name` etc. (or split `full_name`) | read from `profiles` only | user-driven via your profile-edit UI; never from auth metadata |
| `display_name` | compose from name parts or `user.name` | read from `profiles` only | recomposed by your `updateProfile` whenever name parts change; never from `user_metadata` |
| `email` | seed from `user.email` | read from `profiles`; if you also need it on `auth.users`, that's a Supabase Auth API change (`updateUser`) | special — email changes go through `supabase.auth.updateUser`, which *does* update `user.email`; mirror to `profiles` separately |
| `avatar_url` | seed from `user_metadata.avatar_url` if OAuth supplied one | read from `profiles` | user-uploaded; never from auth metadata |
| `phone_number`, `address`, `user_type`, etc. | not in `user_metadata`; just `null` on insert | read from `profiles` | user-driven |

**The boundary is clear: `user_metadata` is one-way data flow into `profiles` at insert time. After that, it's `profiles` only.**

## Why This Matters

Two failure modes follow from violating this rule:

**1. Silent overwrite.** If your post-auth hook re-syncs on every sign-in, every edit a user makes via your UI lasts only until their next session. The bug is invisible — no error, no log, no UI signal. The user just sees their name "reset" and reasonably assumes the app is broken or their save didn't go through.

**2. False sense of an API contract.** Some teams reason "well, OAuth providers update names sometimes, so we should pick up the updated name." This is true in principle but false in practice for Supabase: `user_metadata` is not refreshed when the OAuth provider's data changes. The user has to sign out and sign in *and* the provider has to push fresh data into the id_token (which most don't until token refresh). Trying to treat it as a live source delivers nothing of the value (no real-time provider sync) while breaking the user-edit workflow.

The right model: `user_metadata` is the *handshake*. The `profiles` table is the *relationship*. They meet exactly once, at first sign-in.

## When to Apply

- Always, for any `profiles`-style table that mirrors auth identity. There is no useful exception — even fields that "feel" auth-owned (like email) need the boundary to be explicit.
- When designing a "post-auth bootstrap" function. The function name to reach for is `ensureProfile`, `getOrCreateProfile`, or similar — never `syncProfile` or `refreshProfile`. The verb matters: "ensure exists" is the right semantic; "sync" implies repeated reconciliation, which is the bug.
- When auditing existing code, search for usages of `user.user_metadata` outside the first-insert path. Any read of `user_metadata` after the row is known to exist is a candidate bug.

## Examples

The reverse pattern — incorrect, ships in `@aquaveo/geoglows-auth@0.3.0` and was fixed in 0.3.1:

```typescript
// 0.3.0 — BUGGY: re-derives every sign-in, overwrites user edits
const insertPayload = {
  id: user.sub,
  email: user.email,
  display_name: user.name,                 // ← from user_metadata
  first_name: parts[0],                    // ← derived from user_metadata.full_name
  last_name: parts[parts.length - 1],      // ← derived from user_metadata.full_name
  avatar_url: user.user_metadata.avatar_url,
};

await supabase.from("profiles")
  .upsert(insertPayload, { onConflict: "id", ignoreDuplicates: false })
  .select().single();
// ON CONFLICT DO UPDATE SET (every column above) — silently reverts user edits
```

The correct pattern (0.3.1 and onward):

```typescript
// Look up first
const { data: existing } = await supabase
  .from("profiles")
  .select("*")
  .eq("id", user.sub)
  .maybeSingle();

if (existing) return existing;   // user_metadata is no longer relevant

// Only here — first sign-in — does user_metadata seed the row
await supabase.from("profiles")
  .insert({ id: user.sub, email: user.email, display_name: user.name, ... })
  .select().single();
```

## Related

- **`docs/solutions/logic-errors/ensureprofile-upsert-overwrites-user-edits-2026-04-29.md`** — the concrete bug that this best-practice guards against, with the full trace and fix.
- **PR `Aquaveo/geoglows-auth#3`** — the patch that aligned `ensureProfile` with this rule.
- **PR `Aquaveo/apps.geoglows#4`** — consumer-side adoption of the fix (`@aquaveo/geoglows-auth@0.3.1`).
- Supabase Auth docs on `user_metadata` (and the distinction with `app_metadata`, which is the privileged side and similarly should not be re-flowed into a profiles table casually).
