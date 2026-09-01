// src/core/i18n.ts
//
// The handful of strings the navbar slot shows a visitor who is not signed in,
// in the languages a GEOGLOWS portal is most likely to be read in. Resolution
// follows the browser's preference list (`navigator.languages`), matching an
// exact tag first ("pt-BR"), then its base language ("pt"), and falling back
// to English. Consumers with their own language switcher pass the tag
// explicitly instead.

export interface AuthMessages {
  /** Tooltip and accessible name of the error icon when the account service cannot be reached. */
  serviceUnavailable: string;
}

export const DEFAULT_LANGUAGE = "en";

const MESSAGES: Record<string, AuthMessages> = {
  en: {
    serviceUnavailable: "Unable to log in to GEOGLOWS accounts at this time",
  },
  es: {
    serviceUnavailable:
      "No es posible iniciar sesión en las cuentas de GEOGLOWS en este momento",
  },
  fr: {
    serviceUnavailable:
      "Impossible de se connecter aux comptes GEOGLOWS pour le moment",
  },
  pt: {
    serviceUnavailable:
      "Não é possível entrar nas contas GEOGLOWS neste momento",
  },
  ar: {
    serviceUnavailable:
      "تعذّر تسجيل الدخول إلى حسابات GEOGLOWS في الوقت الحالي",
  },
  zh: {
    serviceUnavailable: "目前无法登录 GEOGLOWS 账户",
  },
  hi: {
    serviceUnavailable: "इस समय GEOGLOWS खातों में लॉग इन नहीं किया जा सकता",
  },
  ru: {
    serviceUnavailable:
      "В настоящее время невозможно войти в учётные записи GEOGLOWS",
  },
};

/** Languages with a translation, as base tags. */
export const SUPPORTED_LANGUAGES: readonly string[] = Object.keys(MESSAGES);

function normalize(tag: unknown): string | null {
  if (typeof tag !== "string") return null;
  const trimmed = tag.trim().toLowerCase().replace(/_/g, "-");
  return trimmed || null;
}

/**
 * Pick the first language in `preferred` that has a translation.
 *
 * Each entry is tried as given ("pt-br") and then by its base language ("pt"),
 * in the order the browser lists them, so a visitor whose list is
 * `["de-DE", "es"]` gets Spanish rather than English. With no argument the
 * browser's `navigator.languages` (then `navigator.language`) is consulted;
 * outside a browser, or with nothing usable, the answer is English.
 */
export function resolveLanguage(
  preferred?: readonly string[] | string | null,
): string {
  let candidates: readonly unknown[];
  if (preferred === undefined) {
    const nav = (globalThis as { navigator?: Navigator }).navigator;
    candidates = nav?.languages?.length
      ? nav.languages
      : nav?.language
        ? [nav.language]
        : [];
  } else if (preferred === null) {
    candidates = [];
  } else {
    candidates = typeof preferred === "string" ? [preferred] : preferred;
  }

  for (const raw of candidates) {
    const tag = normalize(raw);
    if (!tag) continue;
    if (tag in MESSAGES) return tag;
    const base = tag.split("-")[0];
    if (base in MESSAGES) return base;
  }
  return DEFAULT_LANGUAGE;
}

/** Messages for `language`, resolved through {@link resolveLanguage}. */
export function getAuthMessages(
  language?: readonly string[] | string | null,
): AuthMessages {
  return MESSAGES[resolveLanguage(language)] ?? MESSAGES[DEFAULT_LANGUAGE];
}
