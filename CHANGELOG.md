# Changelog

All notable changes to `@aquaveo/geoglows-auth` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [1.3.0] — 2026-04-30

### Added — React-side forgot-password flow

The vanilla forgot-password flow shipped in 1.2.0 (modal-based for
apps.geoglows + grace + rfs). 1.3.0 adds React-side primitives so
aquiferx (the React consumer) can wire the same flow into its own
dialog without copy-pasting modal logic.

- **`<PasswordResetForm>`** — React component for requesting a
  password-reset email. Accepts `adapter`, optional `redirectTo`,
  `onSuccess(email)` / `onError` / `onCancel` callbacks. The component
  does NOT render its own "check your email" view — consumer handles
  the post-success view (matches the consumer-driven pattern from
  `<SupabaseAuthUI>`).
- **`<SetNewPasswordForm>`** — React component for the post-recovery
  set-new-password step. Accepts `adapter`, `onSuccess` / `onExpired`
  (recovery-session expired) / `onError` / `onCancel` callbacks. Reads
  the recovery user's email via `adapter.getCurrentUser()` in a
  `useEffect` on mount and renders "Resetting password for `<email>`"
  in the header (wrong-account protection, mirrors vanilla 1.2.0). Runs
  the full `updateUserPassword` → `signOutOtherSessions` → success
  message → `onSuccess` sequence; success-linger `setTimeout` is
  cleaned up on unmount so dismissing during the linger does NOT fire
  `onSuccess` against torn-down state.
- **`<SupabaseAuthUI>` `onForgotPasswordClick?` prop** — renders a
  "Forgot password?" `<button type="button">` link below the password
  input when both the prop is provided AND `mode === "password"`. Click
  fires the callback; consumer decides what to render next. No internal
  view-switching. Backward-compatible default behavior when prop is
  omitted.
- **`detectRecoveryUrlState({ hash, search })` from `core/recovery-url`** —
  synchronous URL-state detector. Returns `"valid" | "expired" |
  "pkce-unsupported" | "none"` based on the URL contents. Used at
  module-load time, BEFORE Supabase JS's `_initialize()` consumes the
  hash, to detect recovery scenarios race-proof. Pure function; no
  Supabase dependency, no React dependency. Reusable across vanilla and
  React consumers.

### Public types

`PasswordResetFormProps`, `SetNewPasswordFormProps`,
`RecoveryUrlState`, `UrlParts`.

### Tests

- 11 new `tests/core/recovery-url.test.ts` cases.
- 7 new `tests/react/PasswordResetForm.test.tsx` cases.
- 10 new `tests/react/SetNewPasswordForm.test.tsx` cases.
- 4 new `tests/react/SupabaseAuthUI.test.tsx` cases (forgot-password
  button rendering + click).
- 213/213 tests pass (was 181 before this release).

### Why minor (not patch)

Purely additive vs 1.2.0 — new React component exports,
`<SupabaseAuthUI>` gains an optional callback prop with a backward-
compatible default, new lib export from `core/recovery-url`. Existing
1.2.0 surfaces unchanged. Consumers on `^1.2.0` pick this up
automatically via caret-range.

### Vanilla forgot-password unchanged

`mountSignInModal` (1.2.0 in-modal recovery views) is untouched. Vanilla
consumers do not need to change anything to consume 1.3.0. The new
React primitives are React-only — vanilla cannot consume React
components, so the surfaces stay separate (this is documented architectural
divergence, not architectural debt).

## [1.2.0] — 2026-04-30

### Added — forgot-password flow (`core` consumer)

The vanilla sign-in modal now supports the full password-recovery flow:
request reset email → click email link → set new password → modal closes
and user is signed in. Companion to the existing sign-in / sign-up flow;
adds three new views and three new adapter methods.

- **`SupabaseAuthAdapter.resetPasswordForEmail({ email, redirectTo? })`** —
  triggers the recovery email. Falls back to `defaultRedirectTo` from
  adapter config. Throws on Supabase errors. Resolves successfully even
  for unknown emails (preserves enumeration resistance).
- **`SupabaseAuthAdapter.updateUserPassword({ password })`** — updates
  the currently-authenticated user's password (used during the recovery
  session that follows the email link click). Does NOT take an `email`
  argument — Supabase infers from the active session.
- **`SupabaseAuthAdapter.signOutOtherSessions()`** — calls
  `supabase.auth.signOut({ scope: "others" })`. Distinct from
  `signOutRedirect()`: targets only OTHER active refresh tokens (other
  devices/browsers), preserving the current session. Used internally
  by the modal after a successful password update for security
  best-practice; failure is logged but non-fatal.
- **`mountSignInModal` `open({ view? })` overload** — pass
  `{ view: "setNewPassword" }` from a `PASSWORD_RECOVERY` event handler,
  `{ view: "recoveryError" }` when the URL hash carries
  `error_code=otp_expired`, or `{ view: "forgotPassword" }` to skip
  straight to the recovery-request form. Default view stays `"signIn"`
  (backward-compatible).
- **"Forgot password?" link** in the sign-in view, rendered as a
  `<button type="button">` with class `.geoglows-signin-forgot-link`.
  Always shown regardless of `allowSignUp` — recovery is independent
  of sign-up availability.

### Modal behavior highlights

- The `setNewPassword` view fetches the recovery user via
  `authAdapter.getCurrentUser()` and renders a "Resetting password for
  `<email>`" header. This prevents silent identity-swap on shared/
  borrowed browsers when the recovery email is for an account different
  from the currently-signed-in user.
- After successful `updateUserPassword`, the modal calls
  `signOutOtherSessions` (best-effort) and renders an inline
  "Password updated. We've signed you out on other devices for safety."
  message for ~1.5s before closing — explicit messaging, not silent
  surprise.
- Closing the `setNewPassword` view via "Back to sign in" calls
  `signOutRedirect` to clear the recovery session so it doesn't linger
  unauthenticated as a different user.
- Auth errors during `updateUserPassword` (recovery session expired)
  transition to a `recoveryError` view that surfaces a corporate-
  gateway hint and a `mailto:gromero@aquaveo.com` support fallback —
  graceful degradation for users whose email security gateway
  pre-fetches the link.

### Tests

- 26 new tests in `tests/core/sign-in.test.ts` covering forgot-password
  entry / forgotPassword view (8 scenarios) / forgotPasswordSent view /
  `open({ view })` overload (4 scenarios) / setNewPassword view
  (8 scenarios) / recoveryError view (2 scenarios).
- 7 new tests in `tests/core/supabase-auth.test.ts` covering each new
  adapter method (happy path + error path; `signOutOtherSessions` has
  a regression guard against calling without scope).
- 181/181 tests pass; build clean.

## [1.1.2] — 2026-04-30

### Fixed — avatar → "Signing in…" flicker on tab focus

When a portal user signs in, switches browser tabs, and returns to the
portal, the navbar avatar would briefly flicker to "Signing in…" before
settling back. Root cause: Supabase JS fires a redundant `SIGNED_IN`
event on every visibility-change session revalidation
(`@supabase/auth-js` `_recoverAndRefresh`), which consumers were
treating as a fresh sign-in and re-running `bootstrapSession`. The lib's
transient `bootstrapping` / `loading_profile` / `loading_account` emits
were nulling out user and account during the rebootstrap, causing the
visible flicker.

Two layers of defense, both shipped:

- **`bootstrapSession({ initialState })`** — new optional baseline state.
  When provided (consumers pass their currently-known `{ status, user,
  account }`), the transient phases preserve the previous user and
  account values until the new authoritative ones arrive. First-bootstrap
  behavior is unchanged when `initialState` is omitted.
- **`renderAuthAction`** — render-layer guard: if `user` is set, the
  avatar renders even during loading status. Defense in depth: any
  consumer that still re-bootstraps without `initialState` no longer
  flickers.

Consumer-side dedup (skip rebootstrap on `SIGNED_IN` for the same user)
is still recommended — it eliminates the wasted network round trip — but
the lib alone now masks the visible symptom.

### Tests

- 4 new `renderAuthAction` tests covering avatar-renders-during-loading
  for `bootstrapping` / `loading_profile` / `loading_account` /
  `null-account` cases.
- 2 new `bootstrapSession` tests: `initialState` preserves user/account
  through transient phases; first bootstrap (no `initialState`) still
  starts with nulls.

## [1.1.1] — 2026-04-30

Re-publish of the 1.1.0 changes. 1.1.0 was published in error without a
build and was unpublished from the registry; npm permanently reserves
unpublished version numbers, so the same artifact ships as 1.1.1. No
content difference vs the 1.1.0 entry below.

## [1.1.0] — 2026-04-30 (unpublished)

### Added — vanilla-JS sign-in surface (`core` consumer)

This release adds a vanilla-JS sign-in modal and auth-action helper as
new public exports from `@aquaveo/geoglows-auth/core`, so vanilla consumer
apps (apps.geoglows, grace-groundwater-dashboard, future sub-apps) no longer
need to copy-paste the modal code from apps.geoglows.

- **`mountSignInModal({ authAdapter, allowSignUp?, onSignedIn?, oauthRedirectTo?, emailRedirectTo? })`** —
  mounts a `<dialog>`-based sign-in modal. Returns a handle with
  `{ open, close, unmount }`. Supports OAuth (Google + GitHub) and
  email/password sign-in; sign-up flow on by default, hidden via
  `allowSignUp: false`. Errors thrown from `onSignedIn` are isolated from
  the modal's own error handling. Open/close after `unmount` throws.
  Sign-up routes through `authAdapter.signUpWithPassword` (no direct
  Supabase client coupling).
- **`renderAuthAction(state)`** — returns the HTML string for an auth-action
  navbar slot (loading pill / sign-in button / avatar dropdown). Consumers
  interpolate or surgically inject; element IDs `#geoglowsSignIn`,
  `#geoglowsSignOut`, and `#geoglowsAuthActionAvatar` are stable for event
  binding. `AuthActionState.status` is typed as `SessionStatus` and
  `account` reuses `AccountSummary`.
- **`escapeHtml(value)`** — the canonical HTML-escape helper. Use for every
  `${value}` interpolation in vanilla-JS template-string-then-innerHTML
  rendering. Returns `""` for null/undefined; escapes `& < > " '`.
- **`SupabaseAuthAdapter.signUpWithPassword({ email, password, emailRedirectTo?, metadata? })`** —
  new method on the adapter. The OIDC adapter does not implement it
  (Cognito sign-up is server-driven, not modal-driven).
- **`@aquaveo/geoglows-auth/core/sign-in.css`** — plain-CSS stylesheet for
  the modal and auth-action. Light theme by default; dark theme available
  via `[data-theme="dark"]` ancestor selector. Uses semantic class names
  (`.geoglows-signin-*`, `.geoglows-auth-action-*`).

### Public types

- `SignInModalOptions`, `SignInModalHandle` — for `mountSignInModal`.
- `AuthActionState`, `AuthActionVerb` — for `renderAuthAction`.
- `SignUpWithPasswordArgs` — for `SupabaseAuthAdapter.signUpWithPassword`.

### Why minor (not patch)

Purely additive vs. 1.0.0 — `escapeHtml`, `mountSignInModal`,
`renderAuthAction`, the namespaced element IDs, `signUpWithPassword`, the
`./core/sign-in.css` subpath export, and the new types are all net-new.
Existing 1.0.0 exports (`Profile`, `AuthAdapter`, `bootstrapSession`,
`createSupabaseAuthAdapter`, `createOidcAuthAdapter`, etc.) are unchanged.
Consumers on `^1.0.0` pick this up automatically via caret-range.

### React surface unchanged

`<SupabaseAuthUI>` and the rest of the `/react` exports remain available.
The new vanilla surface is a sibling, not a replacement.

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
