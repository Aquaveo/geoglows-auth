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

function stripAuthParamsFromUrl() {
  const cleanUrl = `${window.location.origin}${window.location.pathname}${window.location.hash}`;
  window.history.replaceState({}, document.title, cleanUrl);
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
  let renewalListenersBound = false;

  async function renewTokens(): Promise<AuthUser | null> {
    if (renewalInFlight) return renewalInFlight;

    renewalInFlight = (async () => {
      try {
        const renewed = await userManager.signinSilent();
        return mapUser(renewed);
      } catch (error) {
        console.error("Token renewal failed:", error);
        try {
          await userManager.removeUser();
        } catch (removeError) {
          console.warn("Unable to remove local user after token renewal failure:", removeError);
        }
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

      if (params.has("error")) {
        const description =
          params.get("error_description") ??
          params.get("error") ??
          "Authentication failed";
        stripAuthParamsFromUrl();
        throw new Error(description);
      }

      const hasAuthParams = params.has("code") && params.has("state");
      if (!hasAuthParams) return null;

      try {
        const user = await userManager.signinCallback();
        return mapUser(user);
      } finally {
        stripAuthParamsFromUrl();
      }
    },

    async getCurrentUser() {
      const user = await userManager.getUser();
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
      if (renewalListenersBound) return;
      renewalListenersBound = true;

      userManager.events.addAccessTokenExpiring(async () => {
        await renewTokens();
      });

      userManager.events.addAccessTokenExpired(async () => {
        await renewTokens();
      });

      userManager.events.addSilentRenewError((error) => {
        console.error("Silent renew error:", error);
      });

      userManager.events.addUserSignedOut(async () => {
        try {
          await userManager.removeUser();
        } catch (error) {
          console.warn("Unable to remove local user after sign out:", error);
        }
      });
    },
  };
}