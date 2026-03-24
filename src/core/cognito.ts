import { UserManager, WebStorageStateStore } from "oidc-client-ts";
import type { AuthAdapter, AuthUser, OidcConfig } from "../types";

function mapUser(user: any): AuthUser | null {
  if (!user) return null;

  return {
    sub: user.profile?.sub,
    email: user.profile?.email,
    name: user.profile?.name,
    access_token: user.access_token,
    id_token: user.id_token,
    expired: Boolean(user.expired),
    profile: user.profile ?? {},
  };
}

export function createOidcAuthAdapter(config: OidcConfig): AuthAdapter {
  const userManager = new UserManager({
    authority: config.authority,
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    post_logout_redirect_uri: config.logoutUri,
    response_type: "code",
    scope: config.scope ?? "openid email profile",
    userStore: new WebStorageStateStore({ store: window.localStorage }),
    automaticSilentRenew: false,
    revokeTokenTypes: ["refresh_token"],
  });

  let renewalInFlight: Promise<AuthUser | null> | null = null;

  async function renewTokens(): Promise<AuthUser | null> {
    if (renewalInFlight) return renewalInFlight;

    renewalInFlight = (async () => {
      try {
        const renewed = await userManager.signinSilent();
        return mapUser(renewed);
      } catch (error) {
        console.error("Token renewal failed:", error);
        await userManager.removeUser();
        return null;
      } finally {
        renewalInFlight = null;
      }
    })();

    return renewalInFlight;
  }

  return {
    async clearStaleAuthState() {
      await userManager.clearStaleState();
    },

    async completeSignInIfNeeded() {
      const params = new URLSearchParams(window.location.search);
      const hasAuthParams = params.has("code") && params.has("state");

      if (!hasAuthParams) return null;

      const user = await userManager.signinCallback();
      const cleanUrl = `${window.location.origin}${window.location.pathname}${window.location.hash}`;
      window.history.replaceState({}, document.title, cleanUrl);
      return mapUser(user);
    },

    async getCurrentUser() {
      let user = await userManager.getUser();
      if (!user) return null;

      if (user.expired) {
        return renewTokens();
      }

      return mapUser(user);
    },

    async signInRedirect() {
      await userManager.signinRedirect();
    },

    async signOutRedirect() {
      try {
        await userManager.removeUser();
      } catch (error) {
        console.warn("Unable to remove local user before logout:", error);
      }

      const url = new URL(`${config.cognitoDomain}/logout`);
      url.searchParams.set("client_id", config.clientId);
      url.searchParams.set("logout_uri", config.logoutUri);
      window.location.assign(url.toString());
    },

    setupTokenRenewal() {
      userManager.events.addAccessTokenExpiring(async () => {
        await renewTokens();
      });

      userManager.events.addAccessTokenExpired(async () => {
        await renewTokens();
      });

      userManager.events.addUserSignedOut(async () => {
        await userManager.removeUser();
      });
    },
  };
}