---
title: Replace lazy-loaded SupabaseAuthUI wrapper with a synchronous form component
type: refactor
status: active
date: 2026-04-28
---

# Replace lazy-loaded SupabaseAuthUI wrapper with a synchronous form component

## Overview

The current `<SupabaseAuthUI>` is a thin wrapper around `@supabase/auth-ui-react`,
loaded via `React.lazy` + dynamic `import()` to keep the dependency optional.
That underlying library is now in maintenance mode / deprecated, and the lazy-loading
indirection is no longer desirable.

This plan replaces the wrapper with a small, dependency-free, synchronously-rendered
form component built on standard HTML elements. It calls the headless adapter
methods (`signInWithPassword`, `signInWithMagicLink`) that already exist on
`createSupabaseAuthAdapter`. The component supports a password mode and a
magic-link mode via a single `mode` prop, with a built-in toggle when both are
enabled. No new runtime dependencies are introduced; two optional peer
dependencies are removed.

## Problem Frame

`@supabase/auth-ui-react` and `@supabase/auth-ui-shared` are deprecated, and
the lazy-import gymnastics in the existing wrapper exist solely to support
their absence as optional peer dependencies. With the underlying library
on its way out, both the wrapper and its dependency setup become liabilities
rather than assets.

The library's existing `<LoginPage />` (Cognito flow) is a deliberately
minimal, inline-styled component that consumers can drop in or replace.
Bringing the Supabase Auth UI to symmetry with that philosophy — small,
unstyled, replaceable, no external runtime — is what this plan delivers.

For consumers who want polished UI, the recommended path is
`npx shadcn add @supabase/password-based-auth-react` **in their own app**,
calling our headless adapter methods. The library does not need to ship that
itself, since it would force Tailwind/shadcn assumptions on consumers that
don't use them (e.g. the apps.geoglows portal).

## Requirements Trace

- **R1.** The new component renders synchronously — no `React.lazy`, no
  Suspense fallback, no dynamic import of any sign-in dependency.
- **R2.** No new runtime dependencies introduced. `@supabase/auth-ui-react`
  and `@supabase/auth-ui-shared` are removed from `peerDependencies`,
  `peerDependenciesMeta`, and `devDependencies` entirely.
- **R3.** The component supports password sign-in and magic-link sign-in,
  with a built-in toggle when both are enabled and a `mode` prop to lock
  to one when desired.
- **R4.** The component integrates with the rest of the package the same
  way the previous wrapper did: a successful sign-in causes
  `useAuth().refresh()` to fire so `AuthProvider`'s context picks up the
  new user without a manual reload.
- **R5.** The component has zero hard dependencies on Tailwind, shadcn,
  or any other design system, mirroring the inline-styled approach used
  by `src/react/LoginPage.tsx`.
- **R6.** Existing public surface is preserved where possible. The
  exported name remains `SupabaseAuthUI`. Props that map cleanly to the
  new component (e.g., `onAuthEvent`-equivalent success/error callbacks)
  are supported; props that no longer make sense (e.g., `appearance`
  forwarded to `@supabase/auth-ui-react`) are removed.
- **R7.** Documentation reflects the new shape: install instructions
  drop `@supabase/auth-ui-*`; `docs/adapters.md` describes the new
  component and points consumers wanting polished UI at the shadcn
  upgrade path in their own app.

## Scope Boundaries

- The new component is form-based and minimal. It does **not** include
  OAuth provider buttons (`Sign in with Google`, etc.) — those would
  add UI surface and provider-icon assumptions. Consumers wanting OAuth
  call `adapter.signInWithOAuth(...)` from a button they render
  themselves; this plan keeps that capability accessible via the
  headless adapter method but does not surface it in the wrapper.
- No new password reset / forgot-password UI in this iteration.
  Consumers needing that flow can call Supabase's
  `resetPasswordForEmail` directly or build a custom form.
- No styling theme, design tokens, or `appearance` prop. Consumers
  override styling by replacing the component, wrapping it, or applying
  a `containerStyle` for the outer wrapper only.
- No changes to the headless adapter (`createSupabaseAuthAdapter`),
  `AuthProvider`, `bootstrapSession`, or any other core module. This is
  a UI-component-only refactor.

## Context & Research

### Relevant Code and Patterns

- `src/react/LoginPage.tsx` — the existing minimal Cognito sign-in
  component. Establishes the package's "tiny, inline-styled,
  replaceable" philosophy. The new `<SupabaseAuthUI>` should match it
  in spirit and visual minimalism.
- `src/react/AuthProvider.tsx` — exposes `useAuth()` with
  `refresh()`, `signIn()`, `signOut()`, etc. The new component depends
  on `useAuth()` for the post-sign-in `refresh()` call only. It does
  **not** call `useAuth().signIn()` because that maps to the OIDC
  redirect flow on the base `AuthAdapter` interface.
- `src/core/supabase-auth.ts` — defines
  `createSupabaseAuthAdapter` and the headless extension methods
  `signInWithPassword`, `signInWithMagicLink`, `signInWithOAuth`. The
  new component invokes the first two directly via the `adapter` prop.
- `src/types.ts` — `SupabaseAuthAdapter` is the typed surface for
  the `adapter` prop. No new types required for this plan; reuse the
  existing one.
- `tests/react/SupabaseAuthUI.test.tsx` — the existing test file.
  Most cases (lazy import, missing peer dep, `appearance` forwarding,
  `onAuthEvent` for `TOKEN_REFRESHED`) become irrelevant after the
  refactor and need replacement, not patching.
- `tests/core/supabase-auth.test.ts` — already covers the headless
  methods at the unit level. The new component tests focus on UI
  interactions and `refresh()` integration, not on adapter internals.

### Institutional Learnings

- The package's existing minimal-style philosophy (`<LoginPage />`)
  works because consumers replace the components they want polished.
  Honoring that pattern keeps the package truly framework-agnostic.
- The Vitest setup file (`vitest.setup.ts`) provides an in-memory
  `localStorage` shim. The new component does not write to
  localStorage directly, but if any state ever does, the existing
  shim covers it without per-test setup.

### External References

- Supabase headless auth recipes:
  `https://supabase.com/docs/guides/auth/passwords` and
  `https://supabase.com/docs/guides/auth/auth-magic-link`. These show
  the call signatures the headless adapter methods already expose.
- shadcn registry path for consumer-side UI:
  `npx shadcn add @supabase/password-based-auth-react`. Documented
  as the recommended upgrade path; not used inside the library.

## Key Technical Decisions

- **Decision:** The component receives the adapter explicitly as a
  prop rather than reading it from a React context.
  **Rationale:** `SupabaseAuthAdapter`'s extension methods
  (`signInWithPassword`, `signInWithMagicLink`) are not part of the
  base `AuthAdapter` interface that `AuthProvider` consumes, so the
  context only knows about the base shape. A dedicated context for
  the Supabase adapter would be over-engineering for one component.
  Explicit prop is small and makes the dependency obvious to readers.

- **Decision:** Two-mode component (`"password"` and `"magicLink"`)
  with a built-in toggle when both are allowed.
  **Rationale:** Matches the brainstorm-resolved sweet spot. Password
  alone covers the most common sign-in case; magic-link adds a
  password-less option for users who prefer it. Anything beyond this
  (OAuth, sign-up form, password reset) is intentionally out of scope.

- **Decision:** Inline styles only (consistent with `<LoginPage />`),
  with a single `containerStyle` prop on the outer `<div>` for layout
  hooks and a documented `className` escape hatch on inputs.
  **Rationale:** R5. Avoids any Tailwind/CSS-in-JS dependency. Keeps
  the package working in non-Tailwind consumers like the
  apps.geoglows portal.

- **Decision:** Drop `appearance`, `view`, `providers`, `redirectTo`,
  and `fallback` props. Drop `onAuthEvent` in favor of more focused
  `onSuccess(user)` and `onError(error)` callbacks.
  **Rationale:** R6. Those props existed to forward to
  `@supabase/auth-ui-react`. The new component owns its own form
  state, so the surface narrows to what's actually used. Existing
  consumers (none in production yet for this component) will need to
  update — but the only known consumer is the planned aquiferx /
  portal integration that hasn't shipped, so the breakage is
  contained.

- **Decision:** The post-sign-in `refresh()` call is unconditional and
  awaited. If `refresh()` rejects, the component still calls
  `onSuccess` with the user but logs the rejection — same behavior as
  the previous wrapper.
  **Rationale:** Auth and downstream-data refresh are separate
  concerns; a failed RLS read should not invalidate a successful
  sign-in. Mirrors the existing wrapper's behavior.

- **Decision:** Magic-link mode renders a "check your email"
  confirmation state after submission instead of `onSuccess` firing.
  `onSuccess` is meaningful only for password mode where a session
  exists immediately.
  **Rationale:** Matches the actual Supabase auth flow. Magic links
  resolve in a separate browser context (the email link click), at
  which point `onAuthStateChange` will fire and `AuthProvider` will
  pick up the new user via its own bootstrap cycle.

## Open Questions

### Resolved During Planning

- **Should the component live in `src/react/SupabaseAuthUI.tsx` or
  rename it?** Keep the same path and exported name. The public API
  stays `SupabaseAuthUI`. This makes the refactor a clean replacement
  rather than a parallel surface.
- **Should we keep the optional peer dependency declarations in case
  consumers still want to use the old library?** No. R2 calls for
  removing them entirely. Consumers who need the deprecated library
  install it themselves and build their own component.
- **Should the magic-link "check your email" state be replaceable?**
  Default state is built in; consumers who need a custom message can
  pass a `magicLinkSentMessage?: string` prop. Anything more elaborate
  is a sign the consumer should replace the component.

### Deferred to Implementation

- **Exact prop names for the success and error callbacks** —
  `onSuccess` / `onError` is the working assumption; finalize during
  implementation if a clearer name emerges.
- **Whether the `mode` prop accepts a `"both"` value or whether the
  toggle is implicit when `mode` is omitted** — plan assumes implicit
  toggle when `mode` is omitted, but the implementer may choose
  whichever reads cleaner once the form code is written.
- **Whether to expose `defaultEmail` for prefilling** — small enhancement,
  decide based on whether real consumer code wants it.

## Implementation Units

- [ ] **Unit 1: Replace `SupabaseAuthUI` component implementation**

  **Goal:** Replace the lazy wrapper with a synchronous form component that
  supports password and magic-link sign-in via the headless adapter methods.

  **Requirements:** R1, R3, R4, R5, R6

  **Dependencies:** None — relies only on existing
  `createSupabaseAuthAdapter` extension methods and `useAuth()` from
  `AuthProvider`.

  **Files:**
  - Modify: `src/react/SupabaseAuthUI.tsx` (full rewrite)

  **Approach:**
  - Component takes an `adapter: SupabaseAuthAdapter` prop, an optional
    `mode?: "password" | "magicLink"` prop, optional `onSuccess(user)` and
    `onError(error)` callbacks, an optional `magicLinkRedirectTo?: string`,
    an optional `magicLinkSentMessage?: string`, and an optional
    `containerStyle?: CSSProperties` for the wrapper element.
  - Manages local form state for `email`, `password`, `pending`, and
    `error` plus a `sentForEmail` flag for the post-magic-link confirmation
    state.
  - Submits via `adapter.signInWithPassword({email, password})` for
    password mode and `adapter.signInWithMagicLink({email, redirectTo})`
    for magic-link mode.
  - On password-mode success, calls `useAuth().refresh()` (awaited, with
    rejection logged), then calls `onSuccess(user)` if provided.
  - On magic-link success, switches the form to a confirmation state
    showing `magicLinkSentMessage` (default: "Check your email for the
    sign-in link.").
  - On error, sets local `error` state and calls `onError(error)` if
    provided. Inputs and submit are re-enabled.
  - When `mode` is omitted, renders both flows with a toggle (radio
    buttons or a small text button to switch).
  - Inline styles match `LoginPage.tsx` minimal style. Submit button is
    disabled while `pending` is true. The form is a real `<form>` with
    `<label>`-bound inputs for accessibility.

  **Patterns to follow:**
  - `src/react/LoginPage.tsx` — single-component, inline styles, minimal.
  - `src/react/SupabaseProvider.tsx` — no logic-heavy pattern, but
    illustrates the inline-style approach used elsewhere.

  **Test scenarios:** *(see Unit 2 — tests are rewritten there)*

  **Verification:**
  - File contains no `React.lazy`, no `Suspense`, no
    `import("@supabase/auth-ui-react")`, and no reference to
    `@supabase/auth-ui-react` or `@supabase/auth-ui-shared`.
  - Type-check passes (`npx tsc -p tsconfig.build.json`).
  - Lint passes for the changed file.

---

- [ ] **Unit 2: Rewrite the component test suite**

  **Goal:** Replace the test cases that targeted the lazy-import wrapper
  with cases that exercise the synchronous form behavior.

  **Requirements:** R3, R4, R6

  **Dependencies:** Unit 1

  **Files:**
  - Modify: `tests/react/SupabaseAuthUI.test.tsx` (full rewrite)

  **Approach:**
  - Replace the `vi.mock("@supabase/auth-ui-react", ...)` setup with a
    plain mock for the `SupabaseAuthAdapter` (using `vi.fn()` for each
    extension method).
  - Drop the missing-peer-dependency test entirely; the dependency no
    longer exists.
  - Drop the `appearance`-forwarding and `TOKEN_REFRESHED`-event tests;
    those props/events no longer apply.
  - Continue to use `@testing-library/react` with `cleanup` in
    `afterEach` (existing pattern). No setup changes needed beyond
    those already in `vitest.setup.ts`.
  - Reuse the `useAuth` mock approach for `refresh()` integration tests.

  **Test scenarios:**
  - Happy path: password-mode submission with valid credentials calls
    `adapter.signInWithPassword({email, password})`, awaits the returned
    user, calls `useAuth().refresh()`, and fires `onSuccess(user)`.
  - Happy path: magic-link-mode submission calls
    `adapter.signInWithMagicLink({email})`, switches to confirmation
    state, and renders `magicLinkSentMessage` (or its default).
  - Happy path: When `mode` is omitted, both modes are reachable via
    the toggle UI.
  - Edge case: Submitting with empty email shows a validation
    message and does not call any adapter method.
  - Edge case: Submitting with empty password in password mode shows
    a validation message; magic-link mode doesn't show one because
    password isn't required.
  - Edge case: `magicLinkRedirectTo` prop is forwarded to
    `adapter.signInWithMagicLink({email, redirectTo})`.
  - Edge case: After successful magic-link submission, switching modes
    and submitting again works (state resets correctly).
  - Error path: `signInWithPassword` rejection sets the local error
    message, calls `onError(error)`, and re-enables submit.
  - Error path: A rejected `useAuth().refresh()` is logged but
    `onSuccess` still fires (auth-vs-data separation).
  - Integration: With a real `AuthProvider` mounted as a parent and
    a stubbed adapter, a successful password sign-in causes
    `useAuth().user` to update on the next `refresh()` cycle. *(May
    be skipped if mocking `AuthProvider` is simpler and already
    covers the same assertion via `refreshMock`.)*

  **Verification:**
  - `npm test` passes.
  - All test cases describe behavior of the new synchronous component
    only — no references to `@supabase/auth-ui-react`, lazy imports,
    or peer-dependency error paths remain in the file.

---

- [ ] **Unit 3: Remove deprecated peer dependencies from `package.json`**

  **Goal:** Drop `@supabase/auth-ui-react` and `@supabase/auth-ui-shared`
  from all dependency sections.

  **Requirements:** R2

  **Dependencies:** Unit 1, Unit 2 (no source code or test code may
  reference the removed packages before this lands)

  **Files:**
  - Modify: `package.json`
  - Modify: `package-lock.json` (regenerated)

  **Approach:**
  - Remove the entries for both packages from `peerDependencies`,
    `peerDependenciesMeta`, and `devDependencies`.
  - Run `npm install` to regenerate the lockfile and prune the
    packages from `node_modules`.
  - Delete `peerDependenciesMeta` entirely if it becomes empty.

  **Test expectation:** none — pure dependency cleanup.

  **Verification:**
  - `npm test` still passes.
  - `npm run build` still succeeds.
  - `node_modules/@supabase/auth-ui-react` and
    `node_modules/@supabase/auth-ui-shared` are gone.
  - `grep -r "@supabase/auth-ui" src tests` returns no results.

---

- [ ] **Unit 4: Update README and adapter docs**

  **Goal:** Reflect the new component shape and steer consumers
  wanting polished UI to the shadcn upgrade path in their own apps.

  **Requirements:** R7

  **Dependencies:** Units 1–3

  **Files:**
  - Modify: `README.md`
  - Modify: `docs/adapters.md`

  **Approach:**
  - **README.md:**
    - Remove the optional install line for
      `@supabase/auth-ui-react` and `@supabase/auth-ui-shared`.
    - Update the "Login UI" recommendations table: the Supabase Auth
      row now points to the built-in `<SupabaseAuthUI>` (no peer
      dependency required).
    - Replace the Supabase Auth quick-start `<SupabaseAuthUI>` example
      to match the new prop shape.
  - **docs/adapters.md:**
    - Update the "Login UI option 1" section to describe the new
      component (props, `mode`, magic-link confirmation state).
    - Remove the install command for the deprecated packages.
    - Add (or expand) a note on the **shadcn upgrade path**:
      consumers who want polished, branded UI run
      `npx shadcn add @supabase/password-based-auth-react` in their
      **own application** and call our headless adapter methods
      (`signInWithPassword`, `signInWithMagicLink`,
      `signInWithOAuth`) from the generated form. Stress that the
      library does not bundle this for them because it would force
      Tailwind/shadcn assumptions that not all consumers share.
    - Update the FAQ entry about
      `@supabase/auth-ui-react`-not-installed errors — that error
      path is gone, so the question becomes obsolete and should be
      removed or replaced.

  **Test expectation:** none — documentation only.

  **Verification:**
  - No occurrences of `@supabase/auth-ui-react` or
    `@supabase/auth-ui-shared` remain in `README.md` or
    `docs/adapters.md`.
  - The shadcn upgrade path is mentioned in `docs/adapters.md` with
    enough context that a consumer can act on it.
  - Code examples in both docs match the new component's prop shape.

## System-Wide Impact

- **Interaction graph:** The component's only outward call besides
  the adapter methods is `useAuth().refresh()`. That call already
  exists in the previous wrapper, so the impact on `AuthProvider`'s
  refresh cycle is unchanged.
- **Error propagation:** Adapter errors bubble through React's
  promise handling into the local error state and the optional
  `onError` callback. `refresh()` rejections are logged but do not
  block `onSuccess`.
- **State lifecycle risks:** None significant. The component owns
  only local form state; no localStorage or persistent storage is
  written by the component itself (the underlying
  `signInWithPassword` and `signInWithMagicLink` write Supabase
  session storage as a side effect, but that's existing adapter
  behavior unchanged by this plan).
- **API surface parity:** The exported component name remains
  `SupabaseAuthUI` so consumers' import paths are stable. The prop
  shape changes — this is the only externally visible change. Since
  the package is unreleased post-`<SupabaseAuthUI>`-introduction
  (the new component shipped in the same in-flight branch as the
  Supabase Auth adapter), there are no production consumers to
  break.
- **Integration coverage:** The integration test in
  `tests/core/session.test.ts` does not render any UI and is
  therefore unaffected. The end-to-end refresh-on-sign-in
  integration assertion belongs in the new
  `tests/react/SupabaseAuthUI.test.tsx`.
- **Unchanged invariants:** `AuthAdapter`, `AuthUser`,
  `AuthContextValue`, `createSupabaseAuthAdapter`, `AuthProvider`,
  `bootstrapSession`, the `LoginPage` component, and the headless
  extension methods are all unchanged.

## Risks & Dependencies

| Risk | Mitigation |
|---|---|
| The new minimal form looks too plain and consumers complain. | Document the shadcn upgrade path explicitly in `docs/adapters.md`. The component is small enough to replace entirely, which is the package's existing posture for `<LoginPage />`. |
| Consumers who already wrote code against the old prop shape (`appearance`, `providers`, `view`, `onAuthEvent`) get TypeScript errors after upgrading. | The component is in an unreleased branch (Unit 1–5 of the broader Supabase Auth adapter plan haven't published yet). No external consumers depend on the old shape. The breaking change is contained to in-flight work. |
| Magic-link flow is harder to test because the user "completes" sign-in in another tab/email client. | The component's responsibility ends at "request sent → confirmation state". The actual session resolution happens via `onAuthStateChange` after the redirect, which is already covered by `AuthProvider`'s bootstrap cycle and the existing `tests/core/session.test.ts` integration tests. |
| Accessibility regressions vs. the deprecated library. | Use semantic `<form>`, `<label>`, and `<button>` elements. Set `aria-describedby` on the password input pointing at the error message when one is shown. Keep submit-button focus visible. These are minimal but standard. |

## Documentation / Operational Notes

- This refactor is part of the same in-flight work as the broader
  Supabase Auth adapter plan
  (`docs/plans/2026-04-23-001-feat-supabase-auth-adapter-plan.md`).
  Land it before publishing the package version that introduces
  `createSupabaseAuthAdapter` to consumers, so the v0.2.0 release
  ships the synchronous component shape rather than the lazy
  wrapper that consumers would briefly see and then have to
  migrate away from.
- No changelog entry is needed for the lazy → sync refactor in
  isolation; the broader v0.2.0 release notes (Unit 6 of the
  earlier plan) will describe the final `<SupabaseAuthUI>` API.
- No env-var changes, no migration steps for downstream apps
  beyond updating their imports if they had wired the old props.

## Sources & References

- **Origin context:** Brainstorm conversation in this session about
  Approach A (build our own minimal component) vs. Approach B (bake
  shadcn registry components into the library) vs. Approach C (ship
  no UI). Approach A selected.
- Related plan: `docs/plans/2026-04-23-001-feat-supabase-auth-adapter-plan.md`
- Related code: `src/react/LoginPage.tsx` (style reference),
  `src/react/AuthProvider.tsx`, `src/core/supabase-auth.ts`
- External docs:
  - Supabase headless auth recipes —
    `https://supabase.com/docs/guides/auth/passwords`,
    `https://supabase.com/docs/guides/auth/auth-magic-link`
  - shadcn registry for consumer-side polished UI —
    `npx shadcn add @supabase/password-based-auth-react`
