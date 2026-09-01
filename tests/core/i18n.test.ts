import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_LANGUAGE,
  SUPPORTED_LANGUAGES,
  getAuthMessages,
  resolveLanguage,
} from "../../src/core/i18n";

describe("resolveLanguage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("falls back to English when nothing is preferred", () => {
    expect(resolveLanguage(null)).toBe(DEFAULT_LANGUAGE);
    expect(resolveLanguage([])).toBe(DEFAULT_LANGUAGE);
    expect(resolveLanguage("")).toBe(DEFAULT_LANGUAGE);
  });

  it("matches a region tag by its base language", () => {
    expect(resolveLanguage("es-MX")).toBe("es");
    expect(resolveLanguage("pt_BR")).toBe("pt");
    expect(resolveLanguage("ZH-Hans-CN")).toBe("zh");
  });

  it("takes the first preferred language that has a translation", () => {
    expect(resolveLanguage(["de-DE", "fr-CA", "en"])).toBe("fr");
    expect(resolveLanguage(["de", "nl"])).toBe(DEFAULT_LANGUAGE);
  });

  it("reads the browser's preference list by default", () => {
    vi.stubGlobal("navigator", { languages: ["ar-EG", "en-US"], language: "ar-EG" });
    expect(resolveLanguage()).toBe("ar");
  });

  it("falls back to navigator.language when the list is empty", () => {
    vi.stubGlobal("navigator", { languages: [], language: "ru-RU" });
    expect(resolveLanguage()).toBe("ru");
  });

  it("is English outside a browser", () => {
    vi.stubGlobal("navigator", undefined);
    expect(resolveLanguage()).toBe(DEFAULT_LANGUAGE);
  });
});

describe("getAuthMessages", () => {
  it("has the string for every supported language", () => {
    for (const language of SUPPORTED_LANGUAGES) {
      const messages = getAuthMessages(language);
      expect(messages.serviceUnavailable.length).toBeGreaterThan(0);
    }
  });

  it("returns English for an unsupported language", () => {
    expect(getAuthMessages("xx")).toEqual(getAuthMessages(DEFAULT_LANGUAGE));
  });
});
