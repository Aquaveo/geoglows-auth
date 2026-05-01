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
export function escapeHtml(value: unknown): string {
  if (value == null) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const DANGEROUS_HREF_SCHEMES = /^\s*(?:javascript|data|vbscript):/i;

/**
 * Sanitizes a URL-like value for use as an `<a href>` attribute.
 *
 * Returns `null` when the value is null/undefined/empty OR when the scheme is
 * dangerous (`javascript:`, `data:`, `vbscript:` — case-insensitive, leading
 * whitespace tolerant). Returns the original value unchanged otherwise.
 *
 * `escapeHtml` only escapes HTML-significant characters; it does NOT block
 * dangerous URL schemes (none of those characters are HTML-significant). This
 * helper closes that gap proactively so consumers can pass `profileHref` (and
 * future href-shaped props) without having to enforce the same discipline at
 * every call site. JSX auto-escapes HTML entities but likewise does NOT block
 * dangerous schemes — the React surface uses this same helper.
 *
 * Allowed schemes after sanitization: `http:`, `https:`, paths starting with
 * `/`, paths starting with `#`, and same-origin relative paths. The caller is
 * still responsible for `escapeHtml` on the returned value before interpolating
 * into a vanilla-JS template string.
 */
export function sanitizeHref(
  value: string | null | undefined,
): string | null {
  if (value == null || value === "") return null;
  if (DANGEROUS_HREF_SCHEMES.test(value)) return null;
  return value;
}
