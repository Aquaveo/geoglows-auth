# Choosing an authentication adapter

`@aquaveo/geoglows-auth` ships two identity-provider adapters that satisfy the
same `AuthAdapter` interface. Consumers pick one at startup; both can be
imported from the same package without bundle-size penalty thanks to
tree-shaking.

| Adapter | Factory | Identity source |
|---|---|---|
| Cognito (OIDC) | `createOidcAuthAdapter` | AWS Cognito user pool, or any OIDC-compliant IdP |
| Supabase Auth | `createSupabaseAuthAdapter` | Supabase's built-in auth |

## When to pick each

| Aspect | Cognito (OIDC) | Supabase Auth |
|---|---|---|
| Setup complexity | Two services to configure (Cognito + Supabase) | One service (Supabase only) |
| Free tier (MAU) | Up to 50,000 in Cognito's free tier | Supabase plan dependent |
| Institutional SSO (SAML, university, agency) | Mature, first-class | Available on paid Supabase tiers |
| OAuth providers (Google, GitHub, etc.) | Configured in Cognito | Configured in Supabase |
| Identity portability | Easy — replace adapter, keep schema | Tightly coupled to Supabase |
| Compliance posture | Strong (SOC 2, HIPAA, FedRAMP via AWS) | Good (SOC 2) |
| Failure isolation | Auth and data are independent services | Single point of failure |
| Best fit | Multi-institutional users, regulated environments, future flexibility | Small teams, individual accounts, faster bootstrap |

If most of your priorities lean left, use Cognito. If they lean right, use
Supabase Auth. Both are revisitable — the schema and the rest of the package
are unchanged either way.

## Cognito (OIDC) setup

### Configuration

```ts
import {
  createOidcAuthAdapter,
  createGeoglowsSupabaseClient,
} from "@aquaveo/geoglows-auth";

export const auth = createOidcAuthAdapter({
  authority: "https://cognito-idp.<region>.amazonaws.com/<pool-id>",
  clientId: "<app-client-id>",
  redirectUri: "https://your-app.example.com/",
  logoutUri: "https://your-app.example.com/",
  cognitoDomain: "https://your-domain.auth.<region>.amazoncognito.com",
  scope: "openid email profile",
});

export const supabase = createGeoglowsSupabaseClient({
  url: import.meta.env.VITE_SUPABASE_URL,
  publishableKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  auth,
  useIdToken: true, // default — sends Cognito's id_token to Supabase
});
```

### How tokens flow

1. User clicks "Sign in" → redirected to Cognito hosted UI
2. After login, Cognito redirects back with `?code=...`
3. The adapter exchanges the code for `id_token` + `access_token` and stores
   them in `localStorage`
4. `createGeoglowsSupabaseClient` reads `id_token` on every Supabase request
   via the `accessToken` callback
5. Supabase's RLS policies verify the JWT against Cognito's JWKS

### Login UI

The package ships a minimal `<LoginPage />` button that calls
`signInRedirect()`:

```tsx
import { LoginPage } from "@aquaveo/geoglows-auth/react";

function SignInScreen() {
  return <LoginPage />;
}
```

You can replace this with anything — calling `useAuth().signIn()` triggers
the redirect.

## Supabase Auth setup

### Configuration

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
  // Optional: where Supabase sends users after magic-link/OAuth callbacks
  defaultRedirectTo: window.location.origin,
  // Optional: where to send the user after sign-out (no redirect by default)
  logoutRedirectTo: window.location.origin,
});

// IMPORTANT: do NOT pass `auth` here. Supabase Auth manages the session
// natively, and adding an external token callback would conflict with it.
export const supabase = createGeoglowsSupabaseClient({
  url: import.meta.env.VITE_SUPABASE_URL,
  publishableKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
});
```

### How tokens flow

1. User submits login form → `supabase.auth.signInWithPassword(...)` (or
   magic-link, or OAuth)
2. Supabase JS stores the session in `localStorage` and auto-refreshes it
3. Every Supabase data request automatically includes the access token
4. RLS policies use `auth.uid()` directly — no external JWKS verification
   required

### Login UI option 1: built-in `<SupabaseAuthUI>`

The package ships a small, dependency-free form component that supports
password sign-in and magic-link sign-in. When `mode` is omitted it renders
both options with a built-in toggle.

```tsx
import { SupabaseAuthUI } from "@aquaveo/geoglows-auth/react";
import { auth } from "./auth";

function SignInScreen() {
  return (
    <SupabaseAuthUI
      adapter={auth}
      magicLinkRedirectTo={window.location.origin}
      onSuccess={(user) => console.log("signed in:", user)}
      onError={(err) => console.error(err)}
    />
  );
}
```

After a successful password sign-in, the component calls
`useAuth().refresh()` automatically so `AuthProvider`'s context picks up the
new user without a manual reload. After a successful magic-link request, the
component switches to a "check your email" confirmation state — the actual
session resolves in a separate browser context when the user clicks the link.

Available props:

| Prop | Purpose |
|---|---|
| `adapter` (required) | The `SupabaseAuthAdapter` returned from `createSupabaseAuthAdapter` |
| `mode?` | `"password"` or `"magicLink"` — locks the form to one method. Omit to render both with a toggle |
| `onSuccess?` | Called with the `AuthUser` after a successful password sign-in |
| `onError?` | Called with the `Error` after a failed sign-in attempt |
| `magicLinkRedirectTo?` | Forwarded to Supabase so it knows where to send the user after the magic-link click |
| `magicLinkSentMessage?` | Override the default "Check your email for the sign-in link." confirmation copy |
| `containerStyle?` | Inline style applied to the wrapper `<div>` |

The form is intentionally minimal (inline styles, no theme). If you want
polish, see option 2.

### Login UI option 2: shadcn-generated form (in your own app)

If your app uses Tailwind + shadcn/ui, you can generate a polished
Supabase-blessed form with one command **in the app, not in this library**:

```bash
npx shadcn add @supabase/password-based-auth-react
```

This copies the registry components into your project and adds shadcn
primitives if they're missing. Wire the generated form to our adapter by
calling `auth.signInWithPassword({ email, password })` (or any of the other
headless methods) in its submit handler, then call `useAuth().refresh()` so
the React context picks up the new user.

This library deliberately does **not** bundle shadcn output for you, because
doing so would force Tailwind + shadcn assumptions on every consumer — not
all consumers (the apps.geoglows portal, for example) use Tailwind.

### Login UI option 3: custom (headless)

If you want full control over branding and UX, build your own form using the
adapter's headless methods:

```tsx
import { useAuth } from "@aquaveo/geoglows-auth/react";
import { auth } from "./auth";

function CustomSignInForm() {
  const { refresh } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    await auth.signInWithPassword({ email, password });
    await refresh();
  }

  return (
    <form onSubmit={onSubmit}>
      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      <button type="submit">Sign in</button>
    </form>
  );
}
```

The adapter exposes three sign-in entry points beyond the standard
`AuthAdapter` interface:

```ts
auth.signInWithPassword({ email, password });
auth.signInWithMagicLink({ email, redirectTo? });
auth.signInWithOAuth({ provider, redirectTo? });
```

Magic-link and OAuth flows return immediately; the user completes the flow
in their email client or the OAuth provider's redirect page. Listen to
`supabase.auth.onAuthStateChange` (or use `useAuth()`'s `refresh`) when the
session resolves on return.

## Schema notes

The `profiles`, `organizations`, and `org_memberships` tables are
**provider-agnostic**. The adapter only needs:

- `profiles.id` (UUID) — the user's identifier; Cognito sub or Supabase user
  id depending on the adapter
- `profiles.email`, `profiles.display_name`, `profiles.created_at`
- `org_memberships.user_id` (UUID) — same shape as `profiles.id`
- `org_memberships.org_id`, `org_memberships.role`
- `organizations.id`, `organizations.name`, `organizations.slug`

RLS policies will differ:

- For Cognito, policies typically reference `(auth.jwt() ->> 'sub')::uuid`
- For Supabase Auth, policies typically reference `auth.uid()`

Both produce the same UUID for the user, so the data shape is identical.

## Migrating between adapters

The package supports both adapters simultaneously. Migration considerations:

### Cognito → Supabase Auth

- Existing Cognito users need to be re-registered or imported into Supabase
  Auth. There is no automatic migration — Cognito and Supabase manage user
  records independently.
- Existing rows in `profiles` keyed by Cognito sub will not match
  `auth.users.id` for the new Supabase users. Plan for either a data migration
  or a one-time backfill that maps Cognito sub → new Supabase user id.
- RLS policies that reference `(auth.jwt() ->> 'sub')` need to be rewritten
  to reference `auth.uid()`.

### Supabase Auth → Cognito

- Mirror image: existing Supabase Auth users would need to be onboarded into
  Cognito.
- RLS policies need to switch from `auth.uid()` to validating the external
  JWT's `sub` claim.

In both directions, the application code change itself is small — swap the
factory call. The data and policy work is the bulk of the effort.

## FAQ

### Can I instantiate both adapters in the same app?

Technically yes. Each maintains its own `localStorage` namespace
(`oidc.user:*` for Cognito, `sb-*-auth-token` for Supabase) so they don't
collide. But there's no good reason to — pick one identity model per app.

### Does `<SupabaseAuthUI>` work with the Cognito adapter?

No. `<SupabaseAuthUI>` accepts a `SupabaseAuthAdapter` and calls its
`signInWithPassword` / `signInWithMagicLink` extension methods, which only
exist on the Supabase Auth adapter. The Cognito adapter uses a redirect
flow with the Cognito hosted UI — use `<LoginPage />` (or your own button
calling `useAuth().signIn()`) for that.

### How do I add OAuth provider buttons (Google, GitHub, etc.)?

The built-in `<SupabaseAuthUI>` covers password and magic-link flows
only. For OAuth, render your own provider buttons and call
`auth.signInWithOAuth({ provider, redirectTo })` directly from each
button's onClick handler. The headless adapter method handles the redirect
to Supabase, which in turn redirects to the OAuth provider.

### What happens if the consumer forgets to omit `auth` in Supabase Auth mode?

If you accidentally pair `createSupabaseAuthAdapter` with
`createGeoglowsSupabaseClient({ ..., auth })`, every Supabase request would
go through a token callback that returns the same Supabase access token the
client already includes — redundant, but not actively harmful. The
recommended pattern is to omit `auth` in Supabase Auth mode for clarity.

### Does the `geoglows-auth` library require any specific Supabase row-level security policies?

No. The library reads from and writes to `profiles`, `org_memberships`, and
`organizations`, but the tables and their policies are owned by your project.
The library only assumes the columns named in the schema notes above exist.
