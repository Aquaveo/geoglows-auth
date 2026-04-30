import { describe, expect, it } from "vitest";
import { escape } from "../../src/core/escape";

describe("escape", () => {
  it("returns empty string for null and undefined", () => {
    expect(escape(null)).toBe("");
    expect(escape(undefined)).toBe("");
  });

  it("returns the same string for plain text", () => {
    expect(escape("hello world")).toBe("hello world");
  });

  it("escapes the five HTML-significant characters", () => {
    expect(escape("&")).toBe("&amp;");
    expect(escape("<")).toBe("&lt;");
    expect(escape(">")).toBe("&gt;");
    expect(escape('"')).toBe("&quot;");
    expect(escape("'")).toBe("&#39;");
  });

  it("escapes ampersand first so already-escaped sequences are not double-escaped wrongly", () => {
    // The sequence "&amp;" in input becomes "&amp;amp;" after escape — this is
    // the correct behavior because the input "&" itself must be escaped.
    expect(escape("&amp;")).toBe("&amp;amp;");
  });

  it("neutralizes a script-tag injection attempt", () => {
    expect(escape('<img src=x onerror="alert(1)">')).toBe(
      "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;",
    );
  });

  it("coerces non-string values to strings before escaping", () => {
    expect(escape(42)).toBe("42");
    expect(escape(true)).toBe("true");
  });
});
