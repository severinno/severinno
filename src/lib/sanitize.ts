/**
 * sanitize.ts
 *
 * Lightweight text sanitizer for user-generated content.
 * Strips HTML tags and dangerous characters to prevent stored XSS
 * in third-party renderers (email, WhatsApp, API consumers).
 *
 * This is a defense-in-depth measure — React escapes output on the
 * frontend, but raw strings are returned by the API and may be
 * rendered unsafely by external clients.
 */

/**
 * Strip HTML tags and encode special characters.
 * Safe for plain-text storage — preserves readable content.
 */
export function sanitizeText(input: string): string {
  return input
    .replace(/<[^>]*>/g, "") // Strip HTML tags
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;")
    .trim()
}

/**
 * Strip HTML tags only (no entity encoding).
 * Use when you want clean text without &amp; entities.
 */
export function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, "").trim()
}

export function sanitizeForJsonLd(input: string): string {
  return input
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/'/g, "\\u0027")
}

/**
 * Escape HTML special characters to prevent XSS when rendering user data in HTML templates.
 */
export function escapeHtml(input: unknown): string {
  if (input === null || input === undefined) return ""
  return String(input)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;")
}

/**
 * Serializa um objeto JSON-LD para uso seguro dentro de
 * `<script type="application/ld+json">` via `dangerouslySetInnerHTML`.
 *
 * `JSON.stringify` NÃO escapa `<`, então um valor como `</script><script>…`
 * em QUALQUER campo (cidade, estado, URL de avatar…) fecharia a tag e
 * executaria script. Aqui o escape é feito no nível do JSON (`\u003c`), o que
 * cobre todos os campos — inclusive os que alguém esquecer de sanitizar — e
 * decodifica de volta para o caractere original nos parsers de JSON-LD.
 */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029")
}
