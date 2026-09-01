# Changelog

All notable changes to `@aquaveo/geoglows-auth` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [1.8.0] — 2026-09-01

Resilience release. An unreachable account service used to leave a portal
retrying for the length of the tab: Supabase's own token ticker retried every
30s against a session it could not redeem, the bootstrap had no timeout, and
the navbar offered a "Sign in" button whose modal could not possibly work.
Auth is never on the critical path of these apps — the map, the data and every
read-only feature work signed out — so an unreachable auth service is now a
degraded corner of the UI that states itself, stops, and recovers on its own
when the service comes back.

### Added

- **Connect budget (`bootstrapAuth({ connect })`).** Bounds how hard a page
  tries to reach the account service: `attempts` (default 2), `timeoutMs` (per
  attempt, default 10s), `giveUpMs` (wall clock across all attempts, default
  60s), `recheckAfterMs` (shortest gap before a tab-focus recheck, default 5
  min). Values are clamped — `attempts: 0` no longer gives up before trying.
  When the budget is spent the navbar renders an error icon and everything
  stops.
- **Automatic recovery from a given-up connection.** Giving up is not
  permanent. Coming back `online`, a tab focus after `recheckAfterMs`, a
  `SIGNED_IN` / `SIGNED_OUT` / `TOKEN_REFRESHED` event (each of which is proof
  the service answered), a click on the error icon, or a sign-in request all
  resume. A tab that gave up while the user was on a train now heals itself
  instead of showing a red triangle until reload.
- **`renderAuthAction` error state.** `status === "error"` with no user renders
  a retry-able error icon (`#geoglowsAuthRetry`) instead of the sign-in button —
  offering a form backed by a dead service is worse than saying it is dead. New
  stable element ID; new `.geoglows-auth-action-error` styles in `sign-in.css`,
  sized to the avatar it stands in for so the navbar does not reflow, with a
  dark-theme variant.
- **`AuthHandle.reconnect()`.** Clears a given-up connection and spends a fresh
  budget. Safe to call at any time.
- **`BootstrapAuthConfig.onConnectState`.** Reports every turn of the budget
  (`connected` / `degraded` / `retrying` / `gave_up` / `recovered`) with the
  attempt number, the triggering reason and the error, so consumers can send
  this to their telemetry instead of relying on `console`.
- **`SupabaseFactoryOptions.fetchTimeoutMs`.** Installs a timeout-wrapping
  `fetch` on the Supabase client, so *every* call it makes is bounded — session
  reads, profile reads and writes, sign-in, password reset — not just the
  bootstrap. Aborts at the transport layer, which stops the work rather than
  only stopping the wait, and chains (never replaces) a caller-supplied
  `signal`. Omitted by default, preserving current behaviour. `bootstrapAuth`
  passes `connect.timeoutMs`.
- **`SupabaseFactoryOptions.autoRefreshToken`.** Defaults to `true` (Supabase's
  own default). `bootstrapAuth` now passes `false` and drives
  `startAutoRefresh()` / `stopAutoRefresh()` itself, so the ticker runs only
  while a session actually exists to refresh. Left on the default it runs from
  client construction to the end of the page, and against a stored session it
  cannot redeem it becomes a retry storm every 30s for as long as the tab is
  open.
- **`src/core/retry.ts`.** `isTransientError` (transient vs permanent failure
  classification), `computeBackoffMs` (exponential backoff with jitter) and
  `RequestTimeoutError`. Exported from the `core` surface.
- **`BootstrapSessionOptions.completeCallback`.** Defaults to `true`. Set
  `false` to skip the OAuth code exchange on a re-run; an authorization code is
  single-use, so a retry that replays it fails with a different and more
  confusing error than the one being retried. `bootstrapAuth` sets it
  automatically once an attempt has consumed the callback.
- **Tests for `src/bootstrap/`,** which previously had none: the give-up path,
  permanent-failure short-circuiting, degraded sign-in, the retry button,
  `online` / `SIGNED_OUT` recovery, ticker start/stop, teardown mid-backoff,
  superseded and late attempt results, and budget clamping. Plus coverage for
  `retry.ts`, `fetchTimeoutMs` and `completeCallback`.

### Added

- **Translated error tooltip.** The error icon's tooltip and accessible name
  ("Unable to log in to GEOGLOWS accounts at this time") follow the browser's
  `navigator.languages` — Spanish, French, Portuguese, Arabic, Chinese, Hindi
  and Russian, falling back to English. Region tags match their base language
  (`pt-BR` → `pt`). `renderAuthAction({ language })` and
  `bootstrapAuth({ language })` override the browser for apps with their own
  language switcher. `resolveLanguage` / `getAuthMessages` /
  `SUPPORTED_LANGUAGES` are exported from `core`.

### Changed

- **The loading state is a spinner, not a "Signing in…" pill.** Until the
  account service has said whether there is a session, the slot shows a
  spinner in the avatar's footprint (`.geoglows-auth-action-loading` /
  `.geoglows-auth-action-loading-spinner`, with a reduced-motion pulse and a
  dark variant) rather than a sign-in button that may be wrong and a moment
  later jumps to the avatar. It renders synchronously from `bootstrapAuth` and
  stays up through retry backoff: a failed attempt with budget remaining no
  longer flashes the error icon between attempts.
- **Retries are classified, not blind.** A permanent failure — an RLS denial, a
  4xx, a constraint violation — now stops the budget immediately instead of
  spending every attempt on a request that can never succeed and then reporting
  "service unavailable" for what is really a permission problem.
- **Partial degradation.** Auth reachable + profile unreachable is no longer
  treated as auth unreachable: when the session is real but `ensureProfile` or
  `loadAccountSummary` failed, the avatar stays and the failure is reported as
  `degraded`, rather than hiding a live session behind an error icon.
- **Backoff is jittered.** Fixed 1s/2s/4s meant every tab open against a shared
  outage retried in lockstep and hit the recovering service at once.
- **The sign-in modal is not offered while the service is unreachable.**
  `openSignIn()` (and the `geoglows:sign-in-requested` event) triggers a
  reconnect instead of opening a form that cannot submit.

### Fixed

- **A stored session no longer passes for a reachable service.** The Supabase
  adapter's `getCurrentUser` reads local storage and never touches the network,
  so with the account service down and a token in storage the slot showed the
  avatar and reported the profile load as `degraded` — while the service had
  never been reached at all. `bootstrapSession` now prefers the adapter's new
  `verifySession`, which confirms a stored token with `auth.getUser()`, forgets
  a token the server rejects, and for a signed-out visitor makes one round trip
  to `/auth/v1/health` (when `bootstrapAuth` has the project URL) so "no
  session" and "no service" stay distinct. A failure rejects into the `error`
  state with no user, where the connect budget handles it. Adapters without
  `verifySession` fall back to `getCurrentUser` as before.
- **Sign-out works while the service is unreachable.** `supabase.auth.signOut()`
  keeps the stored session unless the server acknowledges, so a downed service
  left the visitor signed in with no way out. `signOutRedirect` now clears the
  stored session itself when the call fails, then redirects as usual.
- **Concurrent retry loops.** Nothing stopped a second trigger (`SIGNED_OUT`,
  `SIGNED_IN`) from starting a second loop while the first was mid-backoff,
  each with its own attempt counter and deadline — so the budget was silently
  doubled. A generation counter now supersedes the older loop.
- **`destroy()` did not stop a retry loop.** The backoff sleep was untracked,
  so after teardown the loop woke up and bootstrapped into a torn-down page
  (visible under HMR). All timers are tracked and cleared, and the loop exits
  at its next await.
- **A leaked per-attempt timeout handle.** The timeout timer was stored in one
  module-scope variable written by every attempt, so overlapping attempts
  cleared each other's handle.
- **The retry button started the token ticker before knowing a session
  existed** — briefly reproducing the exact retry storm the ticker control was
  added to prevent.
- **A given-up connection swallowed genuine auth events.** A `SIGNED_OUT` in
  another tab left this one showing an error icon instead of "Sign in",
  permanently.
- **A late-arriving valid session is no longer discarded.** A response that
  lands just after its attempt timed out is committed if the slot is showing
  the error state and nothing better has arrived — better late than an error
  icon over a live session.
- **Ticker failures are no longer swallowed silently** (`console.debug` instead
  of an empty `catch`).

## [1.7.4] — 2026-08-28

### Changed

- **Profile link defaults to `/profile`.** `renderAuthAction` (`profileHref`)
  and `bootstrapAuth` (`profilePath`) now default to the portal's `/profile`
  route instead of the `#profile` hash. Consumers still handling the hash route
  can pass `profileHref: "#profile"` / `profilePath: "/#profile"` explicitly.

## [1.7.3] — 2026-08-28

### Added

- **Avatar menu dismissal.** The vanilla auth-action avatar menu (a native
  `<details>`) now closes on a click anywhere outside it and on Escape.
  `bootstrapAuth` wires this automatically and removes the listeners in
  `destroy()`. Portal / `core` consumers that render the slot themselves can
  call the new `wireAvatarMenuDismiss(slotElement)` (returns an unwire
  function).

## [1.5.0] — 2026-04-30

### Added — `<SupabaseAuthUI>` parity with vanilla `mountSignInModal`

The React `<SupabaseAuthUI>` component is rewritten to match the
vanilla portal modal in both look and capability:

- **Google + GitHub OAuth buttons** above the email form, separated
  by an "or with email" divider. `adapter.signInWithOAuth({ provider,
  redirectTo })` is called; the clicked button shows "Signing in…"
  and both OAuth buttons disable until navigation fires or an error
  is caught. Pending state resets on the `pageshow` event so the
  form recovers cleanly when the user hits browser-back from the
  OAuth provider (bfcache restore).
- **Sign-up state machine.** When `allowSignUp=true` (default), the
  signIn view shows a "New here? Create an account" toggle. Clicking
  it switches to a sign-up form with first/last name + email +
  password. Submission calls `adapter.signUpWithPassword` with
  `metadata: { first_name, last_name }`. Success transitions to a
  `signUpSent` "Check your email" confirmation view; "Back to sign
  in" returns to the sign-in form with the sign-up email pre-filled
  so the user can sign in immediately if they confirmed in another
  tab.
- **Visual restyle via `sign-in.css` reuse.** All inline `style={}`
  references are replaced with `className=` references to the
  existing `geoglows-signin-*` classes. Single source of truth for
  the visual treatment across vanilla and React surfaces. Consumers
  must `import "@aquaveo/geoglows-auth/core/sign-in.css"` once at
  app entry to see the new visuals.
- **`sanitizeHref` defensive scheme blocking on `oauthRedirectTo`
  and `emailRedirectTo`.** Dangerous URL schemes (`javascript:`,
  `data:`, `vbscript:`) fall back to `window.location.origin` with
  a `console.warn`. Same security control as the 1.4.0 `profileHref`
  work.
- **`onClose` prop.** When provided, the modal header renders a
  close (×) button that fires the callback. The lib does NOT call
  any kind of `dialog.close()` itself — `onClose` is the only
  side-effect of clicking the X. This contract lets consumers
  preserve outer-`<dialog>` close-event cleanup paths (e.g.,
  aquiferx's recovery-session cleanup).

### Breaking changes

- **`emailRedirectTo` is required when `allowSignUp` is `true` (or
  omitted, since `true` is the default).** Discriminated union
  enforces this at the type level. Consumers who don't want sign-up
  pass `allowSignUp={false}` explicitly. There is no silent default
  for `emailRedirectTo` — sub-app consumers who forgot to pass it
  would have landed sign-up confirmations on the wrong origin.
- **`containerStyle` prop removed.** The CSS-class migration replaces
  the inline-style override mechanism. Consumers wanting custom
  styling override via CSS targeting `.geoglows-signin-content`,
  `.geoglows-signin-confirmation`, or specific inner classes.
- **Default visual treatment changed.** Consumers who imported
  `<SupabaseAuthUI>` but did NOT import `sign-in.css` will see
  unstyled output (CSS classes with no styles attached). To preserve
  the previous look they must add `import "@aquaveo/geoglows-auth/core/sign-in.css"`.

### Security invariant documented

- **`user_metadata` is render-untrusted at all sites.** Sign-up
  metadata flows into Supabase `user_metadata`, then into
  `core.profiles` via `ensureProfile` on first creation. Vanilla
  render sites must `escapeHtml(...)` these fields; React render
  sites rely on JSX auto-escape. Future `ensureProfile` modifications
  or new render sites must preserve this. Documented in this file
  and in `src/core/profile.ts`.

### Cross-surface coupling acknowledged

- Visuals for `<SupabaseAuthUI>` and the vanilla `mountSignInModal`
  are now defined in the same `sign-in.css` file. A future redesign
  of either surface affects both unless the file is split. Trade-off
  is intentional: parity today justifies the coupling. If divergence
  is ever needed, that's a separate plan.

### Operational note: OAuth on Vercel preview branches

`oauthRedirectTo` defaults to `window.location.origin`, which on
Vercel preview branches is a unique per-PR origin (e.g.,
`<repo>-git-<branch>-<owner>.vercel.app`). Supabase Auth's redirect
allowlist matches strict strings; preview-branch OAuth fails with
`redirect_uri_mismatch` (surfaced as `GENERIC_OAUTH_ERROR`).
Production smoke is the supported test path. Document this in your
consuming app's CLAUDE.md if OAuth is wired.

### Tests

- 24 new `tests/react/SupabaseAuthUI.test.tsx` cases covering OAuth
  (5), sign-up flow (8), `signUpSent` view (1), `onClose` prop (5),
  CSS class migration (2), and other view-machine transitions.
- 267/267 tests pass (was 243 before this release).

## [1.4.0] — 2026-04-30

### Added — Configurable Profile link target + scheme sanitization

Sub-apps (grace, rfs, aquiferx) need the avatar-dropdown Profile link
to point at the portal's profile page rather than the hardcoded
`#profile` hash that only resolves on apps.geoglows. 1.4.0 makes the
target configurable on both vanilla and React surfaces and adds a
proactive scheme sanitizer so dangerous URLs are refused at the
library level.

- **`renderAuthAction(state, options?)` — second `options` argument**
  with `profileHref?: string | null`. Default `"#profile"` (UNCHANGED
  — apps.geoglows behavior is preserved without any code change). Pass
  a string to override the href; pass `null` to omit the Profile link
  entirely. Backward-compatible signature: existing callers
  `renderAuthAction(state)` continue to work and produce identical HTML.
- **`AuthActionOptions` exported type** — `{ profileHref?: string | null }`.
- **`<UserMenu>` `profileHref?: string | null` prop** — adds an
  optional Profile link to the React dropdown (which previously had
  email + Log out only). Default `undefined` (no link rendered) so
  existing aquiferx behavior is unchanged unless the prop is passed.
- **`sanitizeHref(value)` from `core/escape`** — exported helper that
  returns `null` for null/undefined/empty input OR for dangerous URL
  schemes (`javascript:`, `data:`, `vbscript:`, case-insensitive,
  leading-whitespace tolerant). Returns the original value otherwise.
  Both vanilla and React surfaces apply this to `profileHref` so the
  consumer is NOT responsible for blocking dangerous schemes — the
  library refuses them proactively. Caller is still responsible for
  HTML-escaping the returned value with `escapeHtml` before
  interpolating into a vanilla template string.

### No behavioral default change

The vanilla `renderAuthAction` default remains `"#profile"`. No
consumer breaks without explicit code changes; this is a purely
additive minor release per semver.

### Tests

- 11 new `tests/core/auth-action.test.ts` cases (Profile link config +
  scheme sanitization).
- 6 new `tests/core/escape.test.ts` cases (`sanitizeHref`).
- 11 new `tests/react/UserMenu.test.tsx` cases.
- 243/243 tests pass (was 215 before this release).

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
