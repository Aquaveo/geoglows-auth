# @aquaveo/geoglows-auth

Authentication library for GEOGloWS portal applications. Bridges an identity
provider with a Supabase data layer (profiles, organizations, memberships) and
exposes React components and hooks for consuming sessions.

Two identity-provider adapters are supported and **coexist in the same
package** — pick one at startup:

| Adapter | Identity provider | Best for |
|---|---|---|
| `createOidcAuthAdapter` | AWS Cognito (or any OIDC-compliant IdP) | Institutional SSO, AWS-aligned organizations, regulated environments |
| `createSupabaseAuthAdapter` | Supabase Auth | Single-vendor stacks, individual-account user bases, fast prototyping |

See [`docs/adapters.md`](./docs/adapters.md) for a full comparison, decision
guide, and worked code examples for both modes.

## Install

```bash
npm install @aquaveo/geoglows-auth @supabase/supabase-js
```

If you plan to use the Cognito (OIDC) adapter, also install:

```bash
npm install oidc-client-ts
```

If you plan to use the Supabase Auth adapter with the prebuilt UI wrapper:

```bash
npm install @supabase/auth-ui-react @supabase/auth-ui-shared
```

`@supabase/auth-ui-react` is an **optional peer dependency** — install it only
if you use `<SupabaseAuthUI>`. Consumers who build custom forms with the
adapter's headless methods (`signInWithPassword`, etc.) do not need it.

## Quick start — Cognito (OIDC)

```ts
import {
  createOidcAuthAdapter,
  createGeoglowsSupabaseClient,
} from "@aquaveo/geoglows-auth";

export const auth = createOidcAuthAdapter({
  authority: import.meta.env.VITE_COGNITO_AUTHORITY,
  clientId: import.meta.env.VITE_COGNITO_CLIENT_ID,
  redirectUri: import.meta.env.VITE_COGNITO_REDIRECT_URI,
  logoutUri: import.meta.env.VITE_COGNITO_LOGOUT_URI,
  cognitoDomain: import.meta.env.VITE_COGNITO_DOMAIN,
});

export const supabase = createGeoglowsSupabaseClient({
  url: import.meta.env.VITE_SUPABASE_URL,
  publishableKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  auth, // injects the Cognito id_token into Supabase requests
});
```

## Quick start — Supabase Auth

```ts
import { createClient } from "@supabase/supabase-js";
import {
  createSupabaseAuthAdapter,
  createGeoglowsSupabaseClient,
} from "@aquaveo/geoglows-auth";

const supabaseClient = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
);

export const auth = createSupabaseAuthAdapter({
  supabase: supabaseClient,
  defaultRedirectTo: window.location.origin,
});

// Same client serves both auth and data — no token callback needed.
export const supabase = createGeoglowsSupabaseClient({
  url: import.meta.env.VITE_SUPABASE_URL,
  publishableKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  // No `auth` field — Supabase manages its own session
});
```

## React provider tree

Both adapters use the same provider tree:

```tsx
import {
  AuthProvider,
  SupabaseProvider,
  LoginPage,            // for Cognito
  SupabaseAuthUI,       // for Supabase Auth
  useAuth,
} from "@aquaveo/geoglows-auth/react";
import { auth, supabase } from "./auth";

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

## Choosing a login UI

| Adapter | Recommended UI | Why |
|---|---|---|
| Cognito | `<LoginPage />` (built-in button → redirects to Cognito hosted UI) | OIDC is a redirect flow |
| Supabase Auth | `<SupabaseAuthUI />` wrapper (around `@supabase/auth-ui-react`) | Inline form for password / magic-link / OAuth |
| Either, custom UI | Build your own using adapter methods | Full control over branding |

See [`docs/adapters.md`](./docs/adapters.md) for examples of each.

## Database schema

This package expects three tables in your Supabase project:

- `profiles` — keyed by `id` (the user's `sub`)
- `organizations` — orgs the user belongs to
- `org_memberships` — join table with `role` (`admin` or `viewer`)

The schema is **provider-agnostic** — it works identically for users sourced
from Cognito (where `id` = Cognito sub UUID) and Supabase Auth (where `id` =
`auth.users.id` UUID). RLS policies typically reference `auth.jwt() ->> 'sub'`
or `auth.uid()` — see your Supabase project's policy definitions.

## Scripts

```bash
npm run build       # produces dist/ (ESM + CJS + types)
npm test            # runs the vitest suite
npm run test:watch  # watch mode
npm run lint        # eslint
```
