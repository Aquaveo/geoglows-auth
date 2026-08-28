# @geoglows/geoglows-auth

Authentication for GEOGloWS portal apps — session bootstrap, profile management, the sign-in modal, and the navbar auth-action, for vanilla JS and React. Published to **GitHub Packages** under the
`geoglows` org.

## Entry points

| Import                                     | Use case                                                        |
|--------------------------------------------|-----------------------------------------------------------------|
| `@geoglows/geoglows-auth/bootstrap`        | **Vanilla sub-apps** — one-call `bootstrapAuth()` (recommended) |
| `@geoglows/geoglows-auth/core`             | Vanilla primitives (composed directly by the portal)            |
| `@geoglows/geoglows-auth/react`            | React 19 apps                                                   |
| `@geoglows/geoglows-auth/core/sign-in.css` | Modal + auth-action styles (import once at app entry)           |

## Install

It lives in GitHub Packages, so scope the registry and authenticate with a `read:packages` token.

`.npmrc`:

```
@geoglows:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

Set `NODE_AUTH_TOKEN` (a GitHub token with `read:packages`) in your shell/CI, then `npm install @geoglows/geoglows-auth`.

## Quick start — vanilla (recommended)

One call wires the Supabase client, sign-in modal, navbar slot, recovery handling, and the full `onAuthStateChange` lifecycle. Import it **first** in your entry, and add a `<div id="auth-action">` to
your navbar.

```js
import {bootstrapAuth} from "@geoglows/geoglows-auth/bootstrap";
import "@geoglows/geoglows-auth/core/sign-in.css";

bootstrapAuth({
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
  supabasePublishableKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  portalUrl: import.meta.env.VITE_PORTAL_URL, // "" for the portal itself
});
```

Options: `slot`, `portalUrl`/`profilePath`, `defaultRedirectTo`/`logoutRedirectTo`, `oauthRedirectTo`, `onAuthChange`, `mountModal`. Returns
`{ supabase, authAdapter, getState, openSignIn, signOut, destroy }`.

Apps that own their own orchestration (e.g. the portal) compose the `/core` primitives directly: `createGeoglowsSupabaseClient`, `createSupabaseAuthAdapter`, `bootstrapSession`, `mountSignInModal`,
`renderAuthAction`, `detectRecoveryUrlState`, plus `escapeHtml` / `sanitizeHref`.

## Quick start — React

```tsx
import {SupabaseProvider, AuthProvider, useAuth} from "@geoglows/geoglows-auth/react";
import "@geoglows/geoglows-auth/core/sign-in.css";

<SupabaseProvider client={supabase}>
    <AuthProvider auth={auth}><Routes/></AuthProvider>
</SupabaseProvider>
```

`useAuth()` → `{ user, profile, loading, refresh, signIn, signOut }`. Also ships `<SupabaseAuthUI>`, `<UserMenu>`, and profile forms/banner.

## Database schema

Expects a `core.profiles` table (`id`, `email`, `display_name`, name parts, `avatar_url`, `user_type`, `user_link`, timestamps), RLS-gated by `auth.uid()`. Migrations live in
`geoglows/geoglows-water-intelligence-portal-db`. `user_metadata` seeds the row on first sign-in only.

## Development

```bash
npm run build   # clean dist/, emit types, build ESM + CJS
npm test        # vitest (jsdom)
npm run lint
```

## Publishing

Automated: bump `version` in `package.json`, merge, then publish a GitHub **Release** (or run the *Publish to GitHub Packages* workflow). It builds and publishes to GitHub Packages using the
workflow's built-in `GITHUB_TOKEN` — no personal token or npm login needed. `prepublishOnly` runs build + tests.

## Consumers

| App                    | Surface     | Repo                                       |
|------------------------|-------------|--------------------------------------------|
| apps.geoglows (portal) | `core`      | geoglows/apps.geoglows                     |
| rfs-v2-hydroviewer     | `bootstrap` | geoglows/rfs-v2-hydroviewer                |
| grace                  | `bootstrap` | geoglows/grace-gldas-groundwater-dashboard |
| aquiferx               | `react`     | Aquaveo/aquiferx                           |
