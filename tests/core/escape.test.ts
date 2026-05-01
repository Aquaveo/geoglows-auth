import { describe, expect, it } from "vitest";
import { escapeHtml, sanitizeHref } from "../../src/core/escape";

describe("escapeHtml", () => {
  it("returns empty string for null and undefined", () => {
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
  });

  it("returns the same string for plain text", () => {
    expect(escapeHtml("hello world")).toBe("hello world");
  });

  it("escapes the five HTML-significant characters", () => {
    expect(escapeHtml("&")).toBe("&amp;");
    expect(escapeHtml("<")).toBe("&lt;");
    expect(escapeHtml(">")).toBe("&gt;");
    expect(escapeHtml('"')).toBe("&quot;");
    expect(escapeHtml("'")).toBe("&#39;");
  });

  it("escapes ampersand first so already-escaped sequences are not double-escaped wrongly", () => {
    // The sequence "&amp;" in input becomes "&amp;amp;" after escape — this is
    // the correct behavior because the input "&" itself must be escaped.
    expect(escapeHtml("&amp;")).toBe("&amp;amp;");
  });

  it("neutralizes a script-tag injection attempt", () => {
    expect(escapeHtml('<img src=x onerror="alert(1)">')).toBe(
      "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;",
    );
  });

  it("coerces non-string values to strings before escaping", () => {
    expect(escapeHtml(42)).toBe("42");
    expect(escapeHtml(true)).toBe("true");
  });
});

describe("sanitizeHref", () => {
  it("returns null for null, undefined, and empty string", () => {
    expect(sanitizeHref(null)).toBeNull();
    expect(sanitizeHref(undefined)).toBeNull();
    expect(sanitizeHref("")).toBeNull();
  });

  it("rejects javascript: scheme (case-insensitive)", () => {
    expect(sanitizeHref("javascript:alert(1)")).toBeNull();
    expect(sanitizeHref("JavaScript:alert(1)")).toBeNull();
    expect(sanitizeHref("JAVASCRIPT:alert(1)")).toBeNull();
  });

  it("rejects javascript: scheme with leading whitespace", () => {
    expect(sanitizeHref("  javascript:alert(1)")).toBeNull();
    expect(sanitizeHref("\tjavascript:alert(1)")).toBeNull();
    expect(sanitizeHref("\n javascript:alert(1)")).toBeNull();
  });

  it("rejects data: scheme", () => {
    expect(sanitizeHref("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(sanitizeHref("Data:image/png;base64,...")).toBeNull();
  });

  it("rejects vbscript: scheme", () => {
    expect(sanitizeHref("vbscript:msgbox(1)")).toBeNull();
    expect(sanitizeHref("VBScript:msgbox(1)")).toBeNull();
  });

  it("returns http: and https: urls unchanged", () => {
    expect(sanitizeHref("https://example.com/profile")).toBe(
      "https://example.com/profile",
    );
    expect(sanitizeHref("http://example.com")).toBe("http://example.com");
  });

  it("returns root-relative paths unchanged", () => {
    expect(sanitizeHref("/profile")).toBe("/profile");
    expect(sanitizeHref("/#profile")).toBe("/#profile");
    expect(sanitizeHref("/path/to/page?q=1")).toBe("/path/to/page?q=1");
  });

  it("returns hash-only and relative paths unchanged", () => {
    expect(sanitizeHref("#anchor")).toBe("#anchor");
    expect(sanitizeHref("profile-relative")).toBe("profile-relative");
    expect(sanitizeHref("./relative/path")).toBe("./relative/path");
  });
});
