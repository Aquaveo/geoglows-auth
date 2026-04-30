/**
 * HTML-escapes a value for safe interpolation into template strings.
 *
 * Use this for every `${value}` interpolation in vanilla-JS template-string-
 * then-innerHTML rendering, otherwise user-supplied data becomes an HTML
 * injection point. See:
 *   apps.geoglows/docs/solutions/security-issues/html-escape-discipline-vanilla-js-templates-2026-04-29.md
 *
 * Returns an empty string for null/undefined; otherwise coerces to string and
 * escapes the five HTML-significant characters (`&`, `<`, `>`, `"`, `'`).
 */
export function escape(value: unknown): string {
  if (value == null) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
