# @aquaveo/geoglows-auth

## Project Overview
- TypeScript 5.9 npm library, published to npm as `@aquaveo/geoglows-auth`
- Provider-agnostic auth abstraction for GEOGloWS portals: same `AuthAdapter` interface backed by either AWS Cognito (OIDC) or Supabase Auth
- Two consumer surfaces: `core` (vanilla JS / TS) and `react` (React 19 hooks + components). Apps choose one
- Built with Vite library mode, TypeScript declarations emitted to `dist/types/`

## Architecture
- **AuthAdapter seam** (`src/types.ts`): single interface — `getCurrentUser`, `completeSignInIfNeeded`, `signInRedirect`, `signOutRedirect`, etc. Two implementations: `createOidcAuthAdapter` (Cognito, `oidc-client-ts`) and `createSupabaseAuthAdapter` (Supabase Auth). Consumers depend on the interface; the rest of the library never branches on which adapter is active
- **Session bootstrap orchestration** (`src/core/session.ts`): `bootstrapSession` walks the auth lifecycle — completes any pending sign-in callback, fetches the current user, ensures a `profiles` row, loads the account summary. Adapter-agnostic
- **Profile lifecycle** (`src/core/profile.ts`): `ensureProfile` is select-then-insert (NOT upsert) — if the row exists, it's returned untouched. `user_metadata` only seeds the row on first creation. See `docs/solutions/logic-errors/ensureprofile-upsert-overwrites-user-edits-2026-04-29.md` and `docs/solutions/best-practices/user-metadata-is-auth-identity-not-profile-of-record-2026-04-29.md`
- **React surface** (`src/react/`): `<SupabaseProvider>` + `<AuthProvider>` (auto-bootstraps session in `useEffect`); `useAuth()` exposes `{ user, profile, loading, refresh, signIn, signOut }`. UI components: `<SupabaseAuthUI>` (sign-in form), `<UserMenu>`, `<ProfileSetupForm>`, `<ProfileEditForm>`, `<ProfileCompletionBanner>`

## Key Files
- `src/types.ts` — `AuthUser`, `AuthAdapter`, `Profile`, `UserType` enum, `AccountSummary` (currently `{ profile }`)
- `src/core/index.ts` — barrel for the `core` entry point
- `src/core/cognito.ts` — `createOidcAuthAdapter` (Cognito OIDC implementation, `oidc-client-ts`). Still shipped but no production consumer uses it as of 2026-04-30
- `src/core/recovery-url.ts` — `detectRecoveryUrlState` synchronous URL parser used by consumers at module-load to detect recovery flow before Supabase JS consumes the hash (added 1.3.0)
- `src/core/escape.ts` — `escapeHtml` for vanilla template-string discipline; `sanitizeHref` (added 1.4.0) returns `null` for dangerous URL schemes (`javascript:`, `data:`, `vbscript:`) so href props can be configurable without making the consumer responsible for scheme validation
- `src/core/auth-action.ts` — `renderAuthAction(state, options?)`. `AuthActionOptions.profileHref` (added 1.4.0) configures the Profile link target; default `#profile` for backward compat. Sub-apps that want the link to navigate to the portal pass an absolute or root-relative URL; pass `null` to omit the link
- `src/react/UserMenu.tsx` — `<UserMenu profileHref?>` (prop added 1.4.0) renders a Profile link in the dropdown; default `undefined` (no link)
- `src/react/SupabaseAuthUI.tsx` — sign-in form with full vanilla-modal parity (1.5.0): Google + GitHub OAuth, sign-up state machine (`signUp` + `signUpSent` views), `onClose` for consumer-driven close X, `sanitizeHref` on `oauthRedirectTo`/`emailRedirectTo`. Discriminated union: `emailRedirectTo` required when `allowSignUp` is `true` or omitted. Visuals via `sign-in.css` classes; consumers must `import "@aquaveo/geoglows-auth/core/sign-in.css"` at app entry. The lib NEVER calls `dialog.close()` itself — `onClose` is the only side-effect of clicking the X (preserves consumer close-event cleanup paths).
- `src/core/supabase-auth.ts` — `createSupabaseAuthAdapter` (Supabase Auth implementation)
- `src/core/supabase.ts` — `createGeoglowsSupabaseClient` factory; the `useIdToken` flag was removed in 0.2.0 (Cognito sessions are no longer forwarded as bearer tokens to PostgREST — Supabase Auth uses its own access token)
- `src/core/session.ts` — `bootstrapSession`, `getUserDisplayInfo`, `SessionStatus`/`SessionState`
- `src/core/profile.ts` — `ensureProfile` (select-then-insert), `updateProfile`, `isProfileComplete`
- `src/core/account.ts` — `loadAccountSummary`
- `src/react/AuthProvider.tsx` — auto-bootstrap, `useAuth()` hook
- `src/react/SupabaseAuthUI.tsx` — sign-in form (password + magic-link + OAuth buttons)
- `tests/core/`, `tests/react/` — vitest + jsdom + Testing Library; mock the supabase client per-test, never the lib's own internals
- `docs/adapters.md` — adapter contracts (`AuthAdapter` interface, expected return shapes); the canonical reference for what an implementation must satisfy

## Conventions
- TypeScript strict mode; no `any` outside test mock typing escape hatches
- `Profile` interface is the source of truth for the `profiles` table shape; UI components compose against this type
- The `display_name` column is computed from name parts (`first_name + middle_name + last_name`) by `updateProfile` and used as the navbar fallback. It is NOT user-editable directly
- `user_metadata` is auth-time identity, NOT the profile of record. See `docs/solutions/best-practices/user-metadata-is-auth-identity-not-profile-of-record-2026-04-29.md`
- `user_metadata` is render-untrusted at all sites (security invariant). Sign-up metadata flows into Supabase `user_metadata` → seeded into `core.profiles` by `ensureProfile` → rendered in vanilla via `escapeHtml(...)` and in React via JSX auto-escape. Any future `ensureProfile` modifications or new render sites MUST preserve this discipline; the React surface uses `sanitizeHref` for href-shaped consumer props (`profileHref`, `oauthRedirectTo`, `emailRedirectTo`) for the same reason
- Tests assert observable behavior, not call shape — for write paths, seed a row first and assert that the row state is correct after the function runs (see the `ensureProfile` regression test added in 0.3.1)

## Commands
- `npm run build` — clean `dist/`, emit TS declarations, build ESM + CJS bundles via Vite library mode
- `npm test` — run vitest suite under jsdom
- `npm run test:watch` — vitest in watch mode
- `npm run lint` — eslint over `.ts` / `.tsx`
- `npm run dev` — vite dev server (rarely used; this is a library)

## Publishing
- npm publish requires Aquaveo org membership + 2FA OTP
- Version bump in `package.json`; commit; merge to `main`; `npm publish`; tag `v<version>`; push tags
- `dist/` is generated at publish time (gitignored). The `files: ["dist"]` field in package.json scopes what ships

## Documentation
- `docs/plans/` — engineering plans (`YYYY-MM-DD-NNN-<type>-<descriptive-name>-plan.md`); progress-tracked living documents
- `docs/solutions/` — captured learnings from past problems (bugs, best practices, workflow patterns), organized by category with YAML frontmatter (`module`, `tags`, `problem_type`). Relevant when implementing or debugging in documented areas — grep here before reinventing
- `docs/adapters.md` — `AuthAdapter` contract and adapter implementation requirements

## Consumers
- `apps.geoglows` (vanilla JS, uses `core` surface, currently on Supabase Auth)
- `aquiferx` (React, uses `react` surface, on Supabase Auth as of the 2026-04-29 migration; the dual-mode AuthAdapter remains shipped but every active portal consumer uses Supabase Auth in production)

Both adapters remain shipped — the library is dual-mode by design. The product direction (per `apps.geoglows/docs/plans/2026-04-28-002-refactor-cognito-to-supabase-auth-plan.md`) is consolidation on Supabase Auth, but consumers migrate at their own pace
