import { describe, expect, it } from "vitest";
import { escapeHtml } from "../../src/core/escape";

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
