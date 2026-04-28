---
title: Add Supabase Auth adapter to geoglows-auth
type: feat
status: active
date: 2026-04-23
---

# Add Supabase Auth adapter to geoglows-auth

## Overview

The `@aquaveo/geoglows-auth` package currently bridges AWS Cognito (identity) with Supabase (data). The package architecture already isolates identity concerns behind an `AuthAdapter` interface, with Cognito implemented as one concrete adapter (`createOidcAuthAdapter`).

This plan adds a second concrete adapter, `createSupabaseAuthAdapter`, so consumers of the package can choose **either** Cognito (current) **or** Supabase Auth as their identity provider. Both adapters coexist; consumers pick one at instantiation time. No breaking changes to existing Cognito-using apps.

## Problem Frame

Some downstream apps may not need or want Cognito-backed identity. For projects that:
- have no institutional SSO requirement,
- prefer a single-vendor stack (Supabase for both auth and data),
- want to avoid AWS account setup,

…the current package forces them into Cognito-only configuration. Supabase already offers email/password, magic-link, OAuth (Google/GitHub/etc.), and SAML auth out of the box. The `AuthAdapter` seam was deliberately designed to support multiple identity providers — this plan delivers on that design intent.

## Requirements Trace

- **R1.** Both adapters must coexist in the same package without consumers paying for the one they don't use (tree-shakable).
- **R2.** Existing Cognito-based apps (portal, aquiferx) must continue to work unchanged after the upgrade — no breaking API changes to `AuthAdapter`, `AuthUser`, `AuthContextValue`, or any exported function.
- **R3.** The new adapter must satisfy the full `AuthAdapter` interface so `AuthProvider`, `bootstrapSession`, and `createGeoglowsSupabaseClient` work without conditional logic.
- **R4.** Supabase Auth users must produce an `AuthUser` shape compatible with downstream code that assumes `sub`, `email`, `name`, and tokens.
- **R5.** Profile and organization persistence in Supabase must work for both adapter modes — `auth.users` row id (Supabase Auth) and Cognito `sub` (UUID format) must both be acceptable values for the `profiles.id` column.
- **R6.** Token injection into Supabase clients must be idempotent for the Supabase Auth case (a single Supabase client serves both roles).
- **R7.** The `LoginPage` component must support a form-based sign-in flow for the Supabase Auth case while remaining backward-compatible for Cognito (button-only redirect).
- **R8.** Sign-out must work for both adapters and clear local session state regardless of provider.

## Scope Boundaries

- **In scope:** Core adapter implementation, Supabase client integration, login UI variants, profile/org compatibility, type updates, and documentation.
- **Out of scope (this plan):**
  - Migration tooling to move existing Cognito users into Supabase Auth.
  - SSO / OAuth provider configuration (consumers configure these themselves in their Supabase project).
  - Changes to RLS policies in any consumer's Supabase database — RLS is consumer-owned schema work.
  - Server-side / SSR support — package is browser-only today.

### Deferred to Separate Tasks

- **Migration playbook for existing Cognito-based apps that want to switch to Supabase Auth:** separate doc, only needed if a real consumer requests it.
- **MFA / WebAuthn flows for Supabase Auth:** future iteration; v1 supports password and magic-link only.

## Context & Research

### Relevant Code and Patterns

- `src/types.ts` — defines `AuthAdapter`, `AuthUser`, `OidcConfig`, `SupabaseFactoryOptions`. The seam is here.
- `src/core/cognito.ts` — current OIDC adapter implementation (`createOidcAuthAdapter`). New adapter will mirror this file's structure.
- `src/core/supabase.ts` — `createGeoglowsSupabaseClient` factory; currently injects an OIDC `id_token` via the `accessToken` callback. Must be updated to handle the case where the same Supabase client is also the auth provider.
- `src/core/profile.ts` — `ensureProfile` upserts using `user.sub`. Will work as-is for Supabase Auth (Supabase user IDs are UUIDs that map to `sub`).
- `src/core/account.ts` — `loadAccountSummary` reads from `profiles` and `org_memberships` keyed on `userId`. Provider-agnostic.
- `src/core/session.ts` — `bootstrapSession` orchestrates adapter calls; provider-agnostic.
- `src/react/AuthProvider.tsx` — consumes any `AuthAdapter`. No changes expected.
- `src/react/LoginPage.tsx` — currently a single sign-in button. Needs a variant for form-based login.
- `src/index.ts` and `src/core/index.ts` — re-export surface; new factory must be exported here.

### Institutional Learnings

- The current package structure was deliberately built with adapter abstraction in mind — see the `AuthAdapter` interface and how `AuthProvider` and `bootstrapSession` consume it without referencing OIDC specifics.
- Tokens for Supabase RLS go through `createClient(...).accessToken` callback. For Supabase-Auth-as-identity, the Supabase client manages its own session natively — the `accessToken` callback can return `null` and Supabase will fall back to its built-in session.

### External References

- Supabase Auth docs: `signInWithPassword`, `signInWithOtp` (magic link), `signInWithOAuth`, `onAuthStateChange`, `getSession`, `signOut`. See `https://supabase.com/docs/guides/auth`.
- Supabase Auth `User` type: `{ id, email, user_metadata, app_metadata, ... }` — maps to `AuthUser` as: `id → sub`, `email → email`, `user_metadata.name → name`.
- Supabase JS v2 sessions are stored in `localStorage` by default under key `sb-<project-ref>-auth-token` — orthogonal to Cognito's `oidc.user:` keys, so they don't collide if both are ever loaded together.

## Key Technical Decisions

- **Decision:** Add a parallel adapter rather than modifying the existing one.
  - **Rationale:** R2 (no breaking changes). The `AuthAdapter` interface already exists; adding a second implementation is the cleanest possible extension.

- **Decision:** Reuse the existing Supabase JS client instance for both auth (when in Supabase Auth mode) and data access.
  - **Rationale:** Supabase Auth's `signIn*` methods, `getSession`, `onAuthStateChange`, and `signOut` all attach to a `SupabaseClient` instance. Creating two clients would mean two independent sessions and double the token surface. One client also makes `accessToken` callback unnecessary in Supabase Auth mode.

- **Decision:** In Supabase Auth mode, `createGeoglowsSupabaseClient` should accept the case where `auth` is `null` or where the `accessToken` callback should be omitted — the same client is used directly without manual token injection.
  - **Rationale:** R6. Avoids an "outer client wraps inner client" anti-pattern.

- **Decision:** Map Supabase user fields to `AuthUser` as follows: `id → sub`, `email → email`, `user_metadata.full_name ?? email → name`, `access_token` populated from the current session, `id_token` left undefined (Supabase doesn't issue a separate ID token).
  - **Rationale:** R4. Keeps `AuthUser` shape stable for downstream consumers; `id_token` being optional is already documented in `types.ts`.

- **Decision:** Lean on Supabase's official auth UI offerings rather than building custom login forms from scratch. Supabase provides:
  - **`@supabase/auth-ui-react`** — a pre-built React component (`<Auth>`) supporting password, magic-link, OAuth providers, and password recovery, with theming hooks (Tailwind, custom styles).
  - **Hosted Auth UI** — Supabase-hosted login pages reachable via redirect (similar to Cognito's hosted UI pattern).
  - **Headless recipes** — code snippets in Supabase docs that consumers can copy if they want full control.

  We expose **two integration paths** for consumers:
  1. **Recommended path:** Re-export a thin wrapper (`<SupabaseAuthUI />`) around `@supabase/auth-ui-react`'s `<Auth>` component, pre-wired to call our adapter on success. Zero form code in our package.
  2. **Headless path:** Document how consumers can use Supabase's auth methods (`signInWithPassword`, `signInWithOtp`, etc.) directly via the adapter's exposed methods, for cases where they need custom UI matching their brand.
  - **Rationale:** R7. Don't reinvent UI Supabase already maintains. Avoids us owning password validation, error display, OAuth provider buttons, theming. Consumers get a richer feature set (forgot-password, sign-up, OAuth provider buttons) for free. The headless path keeps the door open for branded UI without forcing it on everyone.
  - **Note:** `@supabase/auth-ui-react` is in maintenance mode as of late 2025 — consumers should evaluate whether to use it directly, copy from Supabase's headless recipes, or wait for Supabase's next-generation UI library. The plan accommodates all three by keeping our wrapper thin and the headless adapter methods first-class.

- **Decision:** Keep the existing `<LoginPage />` unchanged as the redirect-button variant for Cognito. Do not modify it for Supabase Auth.
  - **Rationale:** R2 (no breaking changes). Each adapter has its own UI entry point — `LoginPage` for OIDC redirect, `SupabaseAuthUI` (or consumer-built form) for Supabase Auth.

- **Decision:** Token renewal is handled by Supabase JS automatically (`autoRefreshToken: true` is the default); the adapter's `setupTokenRenewal` becomes a no-op or wires `onAuthStateChange` to forward token updates.
  - **Rationale:** Don't reinvent renewal; trust the Supabase SDK to manage it. Keep `setupTokenRenewal` in the interface for parity.

- **Decision:** Sign-in flow is config-driven. The adapter accepts a `flow: 'password' | 'magicLink' | 'oauth'` option and exposes typed methods for each. `signInRedirect()` becomes either a no-op (the form handles sign-in) or a redirect to an OAuth provider depending on configuration.
  - **Rationale:** Supabase Auth supports multiple flows; we don't want to hard-code one. But we keep the `AuthAdapter` interface unchanged — the new methods (e.g., `signInWithPassword`) are extensions exposed only on the Supabase adapter.

## Open Questions

### Resolved During Planning

- **Should both adapters coexist in one package or split into separate packages?** Coexist. The package is small, and sharing types/profile/org logic across adapters is the whole point.
- **Should `LoginPage` auto-detect which adapter is being used?** No — explicit components per adapter (`LoginPage` for Cognito, `SupabaseAuthUI` for Supabase Auth). Keeps each component small and type-safe.
- **Should we build login UI ourselves or use Supabase's?** Use Supabase's. They maintain `@supabase/auth-ui-react` (covers password, magic-link, OAuth, recovery) and provide hosted UI plus headless recipes. We provide a thin wrapper around their UI library and document the headless path. Saves us from owning password validation, OAuth provider buttons, theming, error UX, and recovery flows.
- **Will profile UUIDs collide between Cognito and Supabase Auth?** No. Cognito `sub` and Supabase user `id` are both UUIDs; collision odds are zero in practice.

### Deferred to Implementation

- **Exact field name in `user_metadata` for display name** — depends on consumer's Supabase project conventions; default to `full_name`, fall back to `email`. Document the assumption.
- **Whether `@supabase/auth-ui-react` is still the right UI library at implementation time** — it has been in maintenance mode; check current Supabase recommendations before pinning. If a successor library exists, swap the wrapper target accordingly. The wrapper is intentionally thin so this swap is low-cost.
- **Default theme for `<SupabaseAuthUI />` wrapper** — pass through Supabase's default appearance unless a sensible neutral theme emerges during implementation. Consumers can always override via the `appearance` prop.
- **CJS build emit format for the new adapter and wrapper** — verify `vite.config.ts` picks up new files automatically; adjust if not.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```
                       Consumer App
                            │
                            ▼
            ┌──────────────────────────────────┐
            │ choose adapter at startup        │
            └──────────────────────────────────┘
              │                              │
              ▼                              ▼
    createOidcAuthAdapter()        createSupabaseAuthAdapter()
       (existing)                       (new)
              │                              │
              └──────────────┬───────────────┘
                             ▼
                  AuthAdapter interface
                  (unchanged)
                             │
                             ▼
                    AuthProvider / bootstrapSession
                    (no changes — provider-agnostic)
                             │
              ┌──────────────┴───────────────┐
              ▼                              ▼
       createGeoglowsSupabaseClient    LoginPage / SupabaseAuthLoginForm
       (small change: token            (new form variant for password / magic-link)
        callback optional)
              │
              ▼
       Supabase client (data + RLS)
```

Adapter interface remains identical; the difference is **where the user comes from** and **how tokens are minted**. Cognito redirects out and back. Supabase Auth handles password/magic-link inline within the same Supabase client.

## Implementation Units

- [ ] **Unit 1: Add Supabase Auth config type and factory**

**Goal:** Introduce `SupabaseAuthConfig` type and `createSupabaseAuthAdapter` factory that returns an object satisfying `AuthAdapter`.

**Requirements:** R1, R3, R4, R8

**Dependencies:** None

**Files:**
- Create: `src/core/supabase-auth.ts`
- Modify: `src/types.ts` (add `SupabaseAuthConfig` interface)
- Modify: `src/core/index.ts` (re-export new factory)
- Test: `src/core/supabase-auth.test.ts`

**Approach:**
- `SupabaseAuthConfig` carries: `supabase: SupabaseClient`, optional `defaultRedirectTo: string` (used for magic-link emails), and optional `flow: 'password' | 'magicLink' | 'oauth'` hint for default UI.
- The adapter wraps the supplied `SupabaseClient` and implements every `AuthAdapter` method by calling `supabase.auth.*`.
- `getCurrentUser` reads `supabase.auth.getSession()` and maps to `AuthUser`.
- `completeSignInIfNeeded` checks the URL for OAuth callback fragments and calls `supabase.auth.exchangeCodeForSession` if present; otherwise returns `null`.
- `signInRedirect` is a no-op for password flow; for OAuth flow, calls `supabase.auth.signInWithOAuth({ provider })`. The adapter exposes additional non-interface methods (`signInWithPassword`, `signInWithMagicLink`) that the Supabase form components call directly.
- `signOutRedirect` calls `supabase.auth.signOut()` then optionally redirects to `logoutUri`.
- `setupTokenRenewal` registers an `onAuthStateChange` listener that re-emits user changes; Supabase already auto-refreshes tokens internally, so no manual renewal is needed.

**Patterns to follow:**
- `src/core/cognito.ts` for adapter shape, error handling, and the `mapUser` helper.

**Test scenarios:**
- Happy path: `getCurrentUser` returns mapped `AuthUser` when a Supabase session exists.
- Happy path: `getCurrentUser` returns `null` when no session is active.
- Happy path: After `signInWithPassword({ email, password })` succeeds, `getCurrentUser` returns the new user.
- Edge case: `completeSignInIfNeeded` returns `null` when URL has no auth params.
- Edge case: `signOutRedirect` clears the session even if Supabase reports no active user.
- Error path: `signInWithPassword` with bad credentials surfaces a typed error; subsequent `getCurrentUser` still returns `null`.
- Error path: `getCurrentUser` swallows transient session-fetch errors and returns `null` rather than throwing.
- Integration: After mocked `onAuthStateChange` fires a `SIGNED_IN` event, `setupTokenRenewal` callback receives the updated user.

**Verification:**
- Adapter satisfies `AuthAdapter` interface (TypeScript compiles).
- All test scenarios pass under Vitest with a mocked `SupabaseClient`.
- Bundle size for consumers using only the OIDC adapter does not increase (tree-shaking confirmed via build output diff).

---

- [ ] **Unit 2: Update Supabase client factory to support Supabase-Auth mode**

**Goal:** Allow `createGeoglowsSupabaseClient` to operate without an external `AuthAdapter` (i.e., when the Supabase client is itself the identity provider).

**Requirements:** R6

**Dependencies:** Unit 1 (the adapter type informs how the factory branches)

**Files:**
- Modify: `src/core/supabase.ts`
- Modify: `src/types.ts` (loosen `SupabaseFactoryOptions.auth` to `auth?: AuthAdapter | null` and add a clarifying comment)
- Test: `src/core/supabase.test.ts`

**Approach:**
- When `auth` is omitted or null, do not pass an `accessToken` callback to `createClient` — let Supabase manage its own session natively.
- When `auth` is provided (Cognito case), keep the existing behavior unchanged.
- Add JSDoc clarifying the two modes and when each applies.

**Patterns to follow:**
- Existing factory in `src/core/supabase.ts`.

**Test scenarios:**
- Happy path: With `auth` provided, the factory returns a client that calls `auth.getCurrentUser()` for token injection (existing behavior).
- Happy path: Without `auth`, the factory returns a client that does not invoke any token callback — Supabase manages tokens itself.
- Edge case: Empty `url` or empty `publishableKey` still throws (existing behavior preserved).
- Edge case: `auth` set to `null` is treated identically to omitted `auth`.

**Verification:**
- Existing aquiferx and portal usages continue to compile and behave unchanged.
- New no-auth mode produces a Supabase client that successfully signs in via `client.auth.signInWithPassword`.

---

- [ ] **Unit 3: Wrap Supabase's auth UI and document headless usage**

**Goal:** Expose a thin `<SupabaseAuthUI />` wrapper around `@supabase/auth-ui-react` that integrates with our `AuthProvider`, plus document the headless escape hatch for consumers who need custom UI.

**Requirements:** R7

**Dependencies:** Unit 1

**Files:**
- Create: `src/react/SupabaseAuthUI.tsx`
- Modify: `src/react/index.ts` (re-export new component)
- Modify: `package.json` (add `@supabase/auth-ui-react` and `@supabase/auth-ui-shared` as **optional peer dependencies** so consumers who pick the headless path don't pay the bundle cost)
- Test: `src/react/SupabaseAuthUI.test.tsx`

**Approach:**
- `<SupabaseAuthUI />` accepts: the Supabase client, a `providers` array for OAuth (e.g., `['google', 'github']`), an optional `appearance` prop forwarded to Supabase's UI library, an optional `redirectTo` URL, and `onAuthEvent` for sign-in/out callbacks.
- Internally renders `@supabase/auth-ui-react`'s `<Auth>` component pre-configured with our Supabase client. Subscribes to `onAuthStateChange` and forwards `SIGNED_IN` / `SIGNED_OUT` events to the consumer's `onAuthEvent` callback.
- After a successful sign-in event, ensures `AuthProvider.refresh()` is invoked so the React context picks up the new user without a full page reload — coordination via the `useAuth()` hook.
- Treat `@supabase/auth-ui-react` as an **optional peer dependency**: declare it in `peerDependenciesMeta` with `optional: true`. The wrapper detects its absence at runtime and throws a helpful error pointing the consumer to either install it or use the headless path.
- Provide a documentation example in `docs/adapters.md` (Unit 5) showing the headless path: how to call `adapter.signInWithPassword`, `adapter.signInWithMagicLink`, `adapter.signInWithOAuth` directly from a consumer-built form.
- Do **not** build a custom form from scratch in this package. Consumers needing custom UI use the headless adapter methods exposed by Unit 1.

**Patterns to follow:**
- `src/react/SupabaseProvider.tsx` for context-aware component shape.
- `src/react/AuthProvider.tsx` for how adapter results flow into React state and how `refresh()` is exposed.

**Test scenarios:**
- Happy path: Component renders Supabase's `<Auth>` UI with the configured providers and Supabase client.
- Happy path: A `SIGNED_IN` event from Supabase triggers `AuthProvider.refresh()`, causing `useAuth().user` to update.
- Happy path: `onAuthEvent` callback fires with `{ event: 'SIGNED_IN', user }` and `{ event: 'SIGNED_OUT' }` payloads.
- Edge case: Component renders without an `appearance` prop using Supabase's default theme.
- Edge case: When `@supabase/auth-ui-react` is not installed, the component throws an actionable error message at first render, naming the missing package.
- Integration: With `AuthProvider` mounted as a parent, a sign-in event causes the auth context user state to update without a manual page reload.

**Verification:**
- Wrapper renders under React Testing Library with `@supabase/auth-ui-react` mocked.
- Bundle-size check: consumers using only the OIDC adapter and `LoginPage` do not pull in `@supabase/auth-ui-react` (verified via build output).
- Headless path documented with a working code snippet that does not import any UI dependency.

---

- [ ] **Unit 4: Update profile/account modules to confirm provider-agnostic behavior**

**Goal:** Verify and document that `ensureProfile`, `loadAccountSummary`, and `bootstrapSession` work without modification under the Supabase Auth adapter.

**Requirements:** R5

**Dependencies:** Units 1, 2

**Files:**
- Modify: `src/core/profile.ts` (JSDoc comment only — no logic change expected)
- Modify: `src/core/session.ts` (JSDoc comment only — no logic change expected)
- Test: `src/core/session.test.ts` (new test, integrate with Supabase Auth adapter)

**Approach:**
- Confirm that `ensureProfile` upserts using `user.sub` work for both adapters since both produce UUID-shaped subs.
- Confirm `loadAccountSummary` queries `profiles.id` and `org_memberships.user_id` by string equality — adapter-agnostic.
- Add a test that runs `bootstrapSession` end-to-end with a mocked Supabase Auth adapter and verifies the same `SessionState` transitions occur as with Cognito.
- If anything actually requires changes (rather than just verification), do that work here.

**Test scenarios:**
- Integration: `bootstrapSession` with Supabase Auth adapter walks through `bootstrapping → processing_callback → authenticated → loading_profile → loading_account → ready` exactly as it does with the OIDC adapter.
- Integration: `ensureProfile` called with a `sub` from Supabase Auth produces a row in `profiles` with the same shape as Cognito-sourced calls.
- Edge case: Anonymous (no session) state resolves to `'anonymous'` for the Supabase Auth adapter.

**Verification:**
- Existing Cognito session tests still pass.
- New Supabase Auth integration test passes.
- No behavior change for current consumers.

---

- [ ] **Unit 5: Documentation and consumer migration notes**

**Goal:** Document the new adapter, its configuration, and how to choose between the two.

**Requirements:** R1, R2

**Dependencies:** Units 1–4 complete

**Files:**
- Create: `docs/adapters.md` (or update `README.md` if no docs/ exists yet)
- Modify: `README.md` (add a "choosing an adapter" section)

**Approach:**
- Comparison table: Cognito (OIDC) vs Supabase Auth — when to pick each.
- Code examples for both adapters' setup (config, provider tree).
- Note about the `<LoginPage />` vs `<SupabaseAuthLoginForm />` choice.
- Note about `createGeoglowsSupabaseClient` accepting `auth?` to enable Supabase-Auth-as-identity mode.
- Mention that the `geoglows-auth` Supabase schema (`profiles`, `org_memberships`, `organizations`) is provider-agnostic and works for both.

**Test expectation:** none — documentation only.

**Verification:**
- A new consumer can follow the docs to bootstrap an app on Supabase Auth without reading source.
- Existing consumers see "no action required if you're already on Cognito" prominently.

---

- [ ] **Unit 6: Bump version and publish**

**Goal:** Release the new adapter as a minor version bump.

**Requirements:** R1, R2

**Dependencies:** Units 1–5

**Files:**
- Modify: `package.json` (bump `version` from `0.1.x` to `0.2.0`)
- Modify: `README.md` (changelog entry or `CHANGELOG.md` if convention emerges)

**Approach:**
- Minor version bump (no breaking changes; pure addition).
- Verify `npm pack --dry-run` includes the new files (dist outputs for both adapters).
- Publish to npm via existing publish workflow.

**Test expectation:** none — release task.

**Verification:**
- `npm view @aquaveo/geoglows-auth versions` shows the new version published.
- A fresh install in a sandbox project resolves the new exports correctly.

## System-Wide Impact

- **Interaction graph:** The package's core seam (`AuthAdapter`) is unchanged. Downstream consumers (apps.geoglows, aquiferx) continue to import the OIDC adapter the same way. New consumers can opt into the Supabase Auth adapter without affecting existing apps.
- **Error propagation:** Supabase Auth errors (network failures, bad credentials) must surface through `AuthAdapter` methods consistently with how OIDC errors do today — i.e., thrown errors propagate up through `bootstrapSession` to the `'error'` state.
- **State lifecycle risks:** Two adapters maintain two distinct localStorage namespaces (`oidc.user:*` for Cognito, `sb-*-auth-token` for Supabase). No cross-contamination. If a single app ever instantiated both adapters, they'd hold independent sessions — explicitly out of scope but worth noting.
- **API surface parity:** Both adapters expose identical `AuthAdapter` methods. The Supabase adapter additionally exposes `signInWithPassword`, `signInWithMagicLink`, `signInWithOAuth` as adapter-specific extensions. These are documented as Supabase-only and not part of the core interface.
- **Integration coverage:** End-to-end test with `bootstrapSession` + Supabase Auth adapter must run to prove the React layer works without modification.
- **Unchanged invariants:** `AuthAdapter` interface signature, `AuthUser` shape, `AuthContextValue` shape, all React component public props, `createGeoglowsSupabaseClient` signature for the Cognito case, `ensureProfile` / `loadAccountSummary` / `bootstrapSession` signatures and behaviors.

## Risks & Dependencies

| Risk | Mitigation |
|---|---|
| Token-callback collision: `createGeoglowsSupabaseClient` is given an `auth` adapter while the Supabase client is also acting as the identity provider, causing double token injection. | Explicit guard: when consumer wires the Supabase Auth adapter, instruct them in docs (and via TypeScript JSDoc) to omit `auth` from `createGeoglowsSupabaseClient` options. Add a runtime warning in dev builds if both are detected. |
| `LoginPage` consumers accidentally pair the Cognito-style button with a Supabase Auth backend, leading to a no-op button. | Document clearly that `LoginPage` is for redirect-style flows (Cognito/OAuth). Provide `SupabaseAuthUI` wrapper for inline flows. Consider renaming `LoginPage` → `OidcLoginButton` in a future major version for clarity (deferred, breaking). |
| Supabase JS auto-refresh interacts badly with `setupTokenRenewal` if both attempt to refresh tokens. | The Supabase adapter's `setupTokenRenewal` does not call `refreshSession` directly — it only listens to `onAuthStateChange`. Supabase's internal refresh remains the single source of truth. |
| Mapping `user_metadata.full_name` may be absent on users who signed up via password without a profile flow. | Fallback chain: `user_metadata.full_name → user_metadata.name → email`. Document the convention. |
| Test infrastructure: package currently has no test runner configured (no test scripts in `package.json`). | Add Vitest as a devDependency and configure it as part of Unit 1. Set up minimal test scaffolding before writing any new tests. |
| `@supabase/auth-ui-react` is in maintenance mode and may be deprecated or replaced by a new library before or shortly after this plan ships. | Wrapper is intentionally thin (~30 lines) — swapping the underlying UI library is a low-effort change. Treat the dependency as **optional** so consumers using the headless path are unaffected. Re-evaluate the UI library choice during Unit 3 implementation. |
| Consumers expect Supabase's UI to render with their app's design system (Tailwind, custom theme) and the wrapper hides too much of `@supabase/auth-ui-react`'s `appearance` API. | Forward the full `appearance` prop transparently. Document common theming patterns (Tailwind, ThemeSupa) in `docs/adapters.md`. |

## Documentation / Operational Notes

- Add a short adapter-comparison section to `README.md`.
- No deployment changes — package is published to npm the same way.
- No env-var changes for the package itself; consumer apps configure their chosen adapter and pass values explicitly.

## Sources & References

- Origin: User question — "if we would like to add the functionality for the geoglows-auth package to also support only supabase auth, what can we do?"
- Related code: `src/core/cognito.ts` (existing adapter pattern), `src/types.ts` (the `AuthAdapter` seam)
- External docs: Supabase Auth — `https://supabase.com/docs/guides/auth`
- External docs: `@supabase/auth-ui-react` — `https://supabase.com/docs/guides/auth/auth-helpers/auth-ui` (verify current status at implementation time; library is in maintenance mode)
- External docs: Supabase headless auth recipes — `https://supabase.com/docs/guides/auth/auth-email-passwords`, `https://supabase.com/docs/guides/auth/auth-magic-link`, `https://supabase.com/docs/guides/auth/social-login`
- Architectural context: `portals/ARCHITECTURE_FOR_CLIENTS.md` (Decision 1 explicitly anticipates this work)
