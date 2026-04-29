---
title: ensureProfile upsert silently overwrites user-edited profile fields
date: 2026-04-29
category: logic-errors
module: geoglows-auth
problem_type: logic_error
component: authentication
severity: high
symptoms:
  - User profile name fields (first_name, last_name, display_name) silently revert to sign-up values on every sign-in
  - Edits to display_name persist within a session but vanish after sign-out/sign-in
  - No error surfaced in UI, logs, or network responses — the overwrite is silent
  - Affects only users who edited their name post-sign-up; new users see no symptom
root_cause: wrong_api
resolution_type: code_fix
tags:
  - supabase
  - upsert
  - profile
  - data-loss
  - silent-overwrite
  - postgrest
  - on-conflict
  - auth
---

# ensureProfile upsert silently overwrites user-edited profile fields

## Problem

`ensureProfile` in `@aquaveo/geoglows-auth` (≤ 0.3.0) silently overwrote user-edited profile fields (`display_name`, `first_name`, `last_name`, `avatar_url`, `email`) with stale values from Supabase Auth's `user_metadata` on every sign-in. Any edits a user made through the profile-edit UI reverted on their next session, with no error and no UI signal.

## Symptoms

- User signs up as "Gerardo Romero" (OAuth `full_name` from identity provider).
- User edits their profile via the profile page to "Jerry X Romero"; `updateProfile` writes the new values to the `profiles` table successfully.
- User signs out, then signs back in.
- `bootstrapSession` calls `ensureProfile` as part of the post-auth flow.
- Display name, first name, last name, and avatar revert to the original sign-up-time values from `user_metadata`.
- No error is thrown, no log line, no toast — the user just sees their edits "disappear" between sessions.
- Affects every consumer of `@aquaveo/geoglows-auth@0.3.0`; reproduced in `apps.geoglows` production.

## What Didn't Work

- **Unit tests mocked the upsert call shape, not the resulting DB state.** Tests asserted that `supabase.from('profiles').upsert(...)` was called with the right payload and options. They did not stand up a row first and assert that re-running `ensureProfile` left that row untouched. The bug was invisible to a green test suite — 0.3.0 shipped with full coverage of `ensureProfile`. (session history)
- **The test suite was a misleading signal of correctness.** When the rich-user-profiles unit updated the tests to match the new upsert payload shape, the assertions were rewritten to match *what the code did* rather than *what the code should do*. So 92 tests passed on the broken implementation and 92 tests passed after the fix — the test count alone gave no indication the behavior had changed. (session history)
- **The doc comment was correct; the implementation was wrong.** The JSDoc on `ensureProfile` already said "never overwrites user-edited fields on conflict — only `email` and `avatar_url` refresh from the auth provider." That comment was added during a doc-only pass before the implementation was finalized, and the upsert code never matched it. The fix was aligning implementation to existing intent, not designing new behavior. (session history)
- **The flag name `ignoreDuplicates: false` is a trap.** It reads like "insert duplicates anyway / don't ignore them", but in PostgREST/Supabase semantics it means "on conflict, run `DO UPDATE SET` over every column in the payload." Reviewers (and the original author) read past it because the English meaning is the opposite of the SQL meaning. The flag was never a deliberate choice — it was the Supabase JS client default, carried forward from earliest authorship and never questioned. (session history)
- **Flipping to `ignoreDuplicates: true` is NOT a valid fix.** That produces `ON CONFLICT DO NOTHING`, which returns zero rows on conflict; the chained `.select().single()` then throws `PGRST116` (`JSON object requested, multiple (or no) rows returned`). The "obvious" one-character fix breaks the function in a different way — both branches of the `ignoreDuplicates` boolean are wrong for an "ensure exists" operation.
- **Reasoning by function name alone.** The function was called `ensureProfile` and its doc comment said "ensure a profile row exists for an authenticated user". That phrasing matched neither branch of `upsert`'s actual behavior. The name lulled callers (and the author) into trusting the implementation matched the contract.

## Solution

**Before (0.3.0, buggy):**

```typescript
const insertPayload = {
  id: user.sub,
  email: user.email ?? "",
  display_name: user.name ?? user.email ?? null,
  first_name: firstFromOauth,    // derived from user_metadata.full_name
  last_name: lastFromOauth,      // derived from user_metadata.full_name
  avatar_url: avatarUrl,
};

const { data, error } = await supabase
  .from("profiles")
  .upsert(insertPayload, {
    onConflict: "id",
    ignoreDuplicates: false,    // <-- enables ON CONFLICT DO UPDATE over every column above
  })
  .select()
  .single();
```

PostgREST emits (effectively):

```sql
INSERT INTO profiles (id, email, display_name, first_name, last_name, avatar_url)
VALUES (...)
ON CONFLICT (id) DO UPDATE SET
  email        = EXCLUDED.email,
  display_name = EXCLUDED.display_name,
  first_name   = EXCLUDED.first_name,
  last_name    = EXCLUDED.last_name,
  avatar_url   = EXCLUDED.avatar_url;
```

Every sign-in resets the five columns from `user_metadata`.

**After (0.3.1, fixed):**

```typescript
export async function ensureProfile(
  supabase: GeoglowsSupabaseClient,
  user: AuthUser,
): Promise<Profile> {
  const { data: existing, error: selectError } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.sub)
    .maybeSingle();

  if (selectError) throw selectError;
  if (existing) return existing as Profile;

  // Row absent — seed from metadata (auth-time identity values).
  const metadata = user.profile ?? {};
  const fullName =
    typeof metadata.full_name === "string" ? metadata.full_name.trim() : "";
  const nameParts = fullName.split(/\s+/).filter(Boolean);
  const firstFromOauth = nameParts[0] ?? null;
  const lastFromOauth =
    nameParts.length > 1 ? nameParts[nameParts.length - 1] : null;
  const avatarUrl =
    typeof metadata.avatar_url === "string" ? metadata.avatar_url : null;

  const insertPayload = {
    id: user.sub,
    email: user.email ?? "",
    display_name: user.name ?? user.email ?? null,
    first_name: firstFromOauth,
    last_name: lastFromOauth,
    avatar_url: avatarUrl,
  };

  const { data, error } = await supabase
    .from("profiles")
    .insert(insertPayload)
    .select()
    .single();

  if (error) throw error;
  return data as Profile;
}
```

Explicit select-then-insert. If the row exists, return it as-is — no writes. If it's absent, seed it once from auth metadata.

## Why This Works

The fix matches the function's actual contract — *ensure a row exists, do not overwrite user edits* — for three intersecting reasons:

1. **`user_metadata` is auth-time identity, not the profile of record.** Supabase Auth populates `user_metadata` from the OAuth `id_token` / sign-up form at the moment of authentication. It is the right source for *seeding* a fresh profile row, but it is the wrong source for *reconciling* an existing one. The profile-of-record is the `profiles` table — that's what the profile-edit UI writes to and what every user-facing read should trust. Once a row exists in `profiles`, `user_metadata` must never re-flow into it.

2. **`upsert` with `ignoreDuplicates: false` is `ON CONFLICT DO UPDATE` over every column in the payload.** There is no "only insert missing columns" mode. Every key you pass becomes part of the `SET` clause on conflict. So an "ensure" pattern implemented via `upsert` is structurally a "force-overwrite" pattern; the two cannot coexist.

3. **`.single()` makes the other `upsert` branch unusable too.** `ignoreDuplicates: true` produces `ON CONFLICT DO NOTHING`, which returns zero rows when the row already exists. `.select().single()` then throws because it requires exactly one row. So neither value of `ignoreDuplicates` can implement "ensure exists, return current row" — `upsert` is the wrong primitive for this job, full stop. Explicit lookup-then-insert is the only correct shape.

The 0.3.1 implementation respects all three: it reads the current row when present (no writes, no clobber), seeds from `user_metadata` only on first creation, and uses `.maybeSingle()` for the read so an absent row isn't an error.

## Prevention

- **Function name as design constraint.** When a function name implies "ensure exists" / "make idempotent" / "get-or-create", reach for explicit lookup-then-insert. `upsert` is for *reconciliation* operations where overwrite-on-conflict is the desired behavior — never for "ensure" semantics.
- **Audit upsert payloads as `SET` clauses.** Every column in an `upsert` payload becomes part of `ON CONFLICT DO UPDATE SET` (when `ignoreDuplicates: false`). Read each `upsert` call as if it said `UPDATE ... SET col1=..., col2=..., ...` and ask whether overwriting each of those columns is correct on every call.
- **Don't trust the flag name `ignoreDuplicates`.** Its English reading is the inverse of its SQL effect. Treat it as a known-bad API and prefer the more explicit primitives (`insert`, `update`, lookup-then-insert).
- **`user_metadata` is auth-time identity, not the profile of record.** Anything user-editable belongs in your own table and must never be re-synced from auth metadata after the initial seed. If you find yourself writing `user.user_metadata.foo` into a `profiles`-style table on anything other than first creation, stop.
- **Raise the test assertion bar for write paths.** Don't just assert call shape (`expect(supabase.upsert).toHaveBeenCalledWith(...)`); assert the *resulting DB state* given a pre-existing row. The regression test added in 0.3.1 (`tests/core/profile.test.ts`) seeds a row with user-edited values, calls `ensureProfile` with auth metadata that differs, and asserts the returned/persisted row equals the pre-existing edited row — not the metadata-derived one. Any future regression to upsert-style semantics fails this test immediately.
- **Beware tests that drift toward what the code does instead of what the code should do.** The 0.3.0 test rewrite kept all 92 tests green by updating assertions to match the broken upsert shape. Test pass-count is not behavioral evidence. When changing tests *and* implementation in the same unit, write the test from the user-observable contract first, watch it fail against the new code, then make the code pass — not the other way around. (session history)
- **Decouple test mocks from DB call shape.** Both 0.3.0 and 0.3.1 required rewriting `session.test.ts` because its mock chain was hardcoded to `from().upsert()`. Tightly-coupled mocks turn every refactor into a test-file refactor and obscure observable-behavior assertions. Where possible, mock at the higher boundary (e.g., the lib's exported function) and let DB call shape vary. (session history)
- **`/ce-review` caught this; unit tests didn't.** The bug shipped as 0.3.0, reached production, and was discovered weeks later (ADV-003, severity high, confidence 0.88). When a code-review pass flags an "overwrite of user data" pattern, treat it as a P0 even if tests are green — green tests on a write path mean the assertions are too shallow, not that the code is correct.

## Related Issues

- **PR `Aquaveo/geoglows-auth#3`** — *fix(profile): ensureProfile must not overwrite user-edited fields*. The fix that ships as 0.3.1.
- **PR `Aquaveo/geoglows-auth#2`** — *feat: rich user profiles, drop org surface (v0.3.0)*. The PR that introduced the buggy upsert in `ensureProfile`.
- **PR `Aquaveo/apps.geoglows#4`** — consumer-side bump to 0.3.1 plus the safe_auto fixes from the same review pass (XSS escape in navbar, broken personal-link in profile view).
- **PR `Aquaveo/apps.geoglows#6`** — vitest infrastructure + tests for `profilePage`, `signInModal`, and the events.js profile-edit submit handler. Includes a `MAINT-001` cleanup that removes a stale `profileBannerDismissed: false` reset.
- **`docs/adapters.md` lines 393-402** in this repo — already states the *intended* `ensureProfile` contract ("never overwrites user-edited fields"). The 0.3.0 implementation contradicted this doc; 0.3.1 makes the implementation match. Treat that contract as authoritative; this solutions doc captures the regression mechanism so a future refactor doesn't reintroduce it.
