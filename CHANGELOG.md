# Changelog

All notable changes to `@aquaveo/geoglows-auth` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [1.0.0] — 2026-04-29

### Breaking — runtime database contract change

This release relocates the canonical `profiles` table from the `public` schema
to a new shared `core` schema. The TypeScript surface (`Profile` type, public
function signatures) is unchanged, but the lib's runtime DB contract changes:
PostgREST requests now include `Accept-Profile: core` and target `core.profiles`
instead of `public.profiles`. **The semver bump is major because the lib will
fail against any Supabase project that has not been migrated.**

### Required deployment ordering

Consumers upgrading to `1.0.0` must ensure their Supabase project:

1. Has `core` listed in the project's PostgREST exposed schemas (Dashboard →
   Project Settings → API → Exposed schemas, or `[api].schemas` in the local
   `supabase/config.toml`).
2. Has the `core.profiles` table created and populated, with RLS policies and
   grants configured.

The portal's reference migration is at
`apps.geoglows/supabase/migrations/20260429180000_relocate_profiles_to_core.sql`,
which also creates a `public.profiles` view (with `security_invoker = true`) so
older lib versions on `0.3.x` can continue to work during the cutover. The
upstream plan documenting the rollout sequence is
`apps.geoglows/docs/plans/2026-04-29-005-feat-profiles-relocation-to-core-schema-plan.md`.

### Changed

- `ensureProfile`, `updateProfile`, `loadAccountSummary` now route through
  `supabase.schema("core").from("profiles")` instead of
  `supabase.from("profiles")`. (4 call sites: `src/core/profile.ts` lines 27,
  58, 102; `src/core/account.ts` line 24.)
- Tests updated to mock the `.schema("core").from("profiles")` chain.

### Unchanged

- `Profile` interface columns and types.
- `AuthAdapter` interface.
- `ensureProfile` semantics (still select-then-insert, NOT upsert; `user_metadata`
  only seeds new rows).
- React surface (`<AuthProvider>`, `useAuth`, UI components) — no consumer-facing
  API change.

### Migration notes for consumers

- **`apps.geoglows`**: bump `@aquaveo/geoglows-auth` to `^1.0.0` after the
  database migration is live in the relevant Supabase project.
- **`aquiferx`** (Aquaveo-controlled fork): same — bump after the DB migration
  is live.
- **External / unmaintained consumers on `^0.3.x`**: caret-range will NOT
  auto-pull `1.0.0`. The bridge view in `public.profiles` keeps `0.3.x` working
  against a migrated database, so external consumers can upgrade at their own
  pace. The view is dropped in a follow-up migration once both controlled
  consumers (apps.geoglows + aquiferx fork) have shipped against `1.0.0`.

## [0.3.1] — 2026-04-29

- Regression fix: `ensureProfile` no longer overwrites user-edited `first_name`
  / `last_name` on subsequent sign-ins. Switched to select-then-insert; the
  existing row is returned untouched. See
  `docs/solutions/logic-errors/ensureprofile-upsert-overwrites-user-edits-2026-04-29.md`.

## [0.3.0]

- Cognito → Supabase Auth migration completed across consumer apps. Both
  adapters remain shipped (the library is dual-mode by design).

## [0.2.0]

- Supabase Auth adapter introduced as a peer to the existing Cognito OIDC
  adapter. `AuthAdapter` interface lifted to `src/types.ts` as the single
  contract. The `useIdToken` flag was removed — Supabase Auth uses its own
  access token, not the Cognito ID token forwarded as a bearer.

## [0.1.x]

- Initial library extraction from `apps.geoglows`. Cognito OIDC adapter only.
