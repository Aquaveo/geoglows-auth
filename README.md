# @aquaveo/geoglows-auth

Authentication library for GEOGLOWS portal applications. Provides session bootstrap, profile management, sign-in UI, and auth-action components for both vanilla JS and React consumers.

**npm:** [@aquaveo/geoglows-auth](https://www.npmjs.com/package/@aquaveo/geoglows-auth) (v1.6.0)

## Entry points

| Entry | Import | Use case |
|-------|--------|----------|
| `core` | `@aquaveo/geoglows-auth/core` | Vanilla JS / TS apps (portal, sub-apps) |
| `react` | `@aquaveo/geoglows-auth/react` | React 19 apps (aquiferx) |
| `core/sign-in.css` | `@aquaveo/geoglows-auth/core/sign-in.css` | Sign-in modal and auth-action styles (import at app entry) |

## Install

```bash
npm install @aquaveo/geoglows-auth @supabase/supabase-js
```

## Quick start (vanilla JS)

```js
import { createClient } from "@supabase/supabase-js";
import {
  createSupabaseAuthAdapter,
  bootstrapSession,
  mountSignInModal,
  renderAuthAction,
  escapeHtml,
} from "@aquaveo/geoglows-auth/core";
import "@aquaveo/geoglows-auth/core/sign-in.css";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const auth = createSupabaseAuthAdapter({
  supabase,
  defaultRedirectTo: window.location.origin,
  logoutRedirectTo: window.location.origin,
});

// Mount the sign-in modal once
const signInModal = mountSignInModal({ authAdapter: auth });

// Open it from anywhere via a window event
window.addEventListener("geoglows:sign-in-requested", () => signInModal.open());

// Bootstrap session on auth state change
supabase.auth.onAuthStateChange((event) => {
  if (event === "INITIAL_SESSION") {
    bootstrapSession({ auth, supabase, onStateChange: updateUI });
  }
});

// Render the navbar auth slot (sign-in button or avatar dropdown)
function updateUI(state) {
  document.getElementById("auth-action").innerHTML = renderAuthAction(state);
}
```

## Quick start (React)

```tsx
import { createClient } from "@supabase/supabase-js";
import {
  createSupabaseAuthAdapter,
  SupabaseProvider,
  AuthProvider,
  SupabaseAuthUI,
  useAuth,
} from "@aquaveo/geoglows-auth/react";
import "@aquaveo/geoglows-auth/core/sign-in.css";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const auth = createSupabaseAuthAdapter({ supabase, defaultRedirectTo: "/" });

function App() {
  return (
    <SupabaseProvider client={supabase}>
      <AuthProvider auth={auth}>
        <Routes />
      </AuthProvider>
    </SupabaseProvider>
  );
}
```

`useAuth()` returns `{ user, profile, loading, refresh, signIn, signOut }`.

## Core surface API

### Session and auth

| Export | Description |
|--------|-------------|
| `createSupabaseAuthAdapter(opts)` | Create a Supabase Auth adapter |
| `bootstrapSession(opts)` | Full session lifecycle: sign-in completion, user fetch, profile ensure, account load |
| `mountSignInModal({ authAdapter })` | Mount the vanilla sign-in modal (password, OAuth, sign-up, forgot password) |
| `renderAuthAction(state, opts?)` | Render the navbar auth slot (sign-in button or avatar dropdown with profile link) |
| `detectRecoveryUrlState({ hash, search })` | Synchronous URL parser for password recovery detection at module load |

### Profile

| Export | Description |
|--------|-------------|
| `ensureProfile(supabase, user)` | Select-then-insert: creates a `core.profiles` row on first sign-in, returns existing row otherwise |
| `updateProfile(supabase, data)` | Update profile fields; recomputes `display_name` from name parts |
| `loadAccountSummary(supabase, userId)` | Load `{ profile }` for the current user |
| `isProfileComplete(profile)` | Returns true if first_name and last_name are non-empty |

### Security helpers

| Export | Description |
|--------|-------------|
| `escapeHtml(value)` | HTML entity escaping for template-string innerHTML rendering |
| `sanitizeHref(url)` | Returns null for dangerous URL schemes (`javascript:`, `data:`, `vbscript:`) |

## React surface API

| Export | Description |
|--------|-------------|
| `<SupabaseProvider>` | Supabase client context |
| `<AuthProvider>` | Auto-bootstraps session, provides `useAuth()` |
| `useAuth()` | `{ user, profile, loading, refresh, signIn, signOut }` |
| `<SupabaseAuthUI>` | Sign-in form (password + OAuth + sign-up + forgot password) |
| `<UserMenu profileHref?>` | Avatar dropdown with optional profile link |
| `<ProfileSetupForm>` | First-time profile completion form |
| `<ProfileEditForm>` | Profile editing form |
| `<ProfileCompletionBanner>` | Banner prompting incomplete profile completion |

## Auth adapters

Two adapters ship in the package:

| Adapter | Provider | Status |
|---------|----------|--------|
| `createSupabaseAuthAdapter` | Supabase Auth | Active (all production consumers) |
| `createOidcAuthAdapter` | AWS Cognito / OIDC | Shipped but unused in production |

The library is dual-mode by design. See [`docs/adapters.md`](./docs/adapters.md) for the full contract and decision guide.

## Database schema

The library expects a `profiles` table in the `core` schema:

```sql
core.profiles (
  id uuid primary key,       -- matches auth.users.id
  email text,
  display_name text,          -- computed from name parts by updateProfile
  first_name text,
  middle_name text,
  last_name text,
  avatar_url text,
  user_type text,
  user_link text,
  created_at timestamptz,
  updated_at timestamptz
)
```

RLS policies gate access by `auth.uid()`. Migrations live in the portal repo at `apps.geoglows/supabase/migrations/`.

`user_metadata` from Supabase Auth seeds the profile row on first sign-in only. It is never re-flowed into `profiles` on subsequent sign-ins.

## Development

```bash
npm run build         # clean dist/, emit TS declarations, build ESM + CJS
npm test              # vitest under jsdom
npm run test:watch    # watch mode
npm run lint          # eslint
```

## Publishing

```bash
# 1. Bump version in package.json
# 2. Build and verify
npm run build
npm test

# 3. Publish (requires Aquaveo npm org membership + 2FA OTP)
npm publish

# 4. Tag and push
git tag v<version>
git push && git push --tags
```

The `prepublishOnly` script runs `npm run build` automatically before publish.

## Consumers

| App | Surface | Repo |
|-----|---------|------|
| apps.geoglows (portal) | `core` | Aquaveo/apps.geoglows |
| aquiferx | `react` | Aquaveo/aquiferx |
| grace-groundwater-dashboard | `core` | Aquaveo/grace-groundwater-dashboard |
| rfs-v2-hydroviewer | `core` | Aquaveo/rfs-v2-hydroviewer |
