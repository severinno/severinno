/**
 * Shared HTML escaping utility — safe for both server and client.
 *
 * Escapes characters that could cause HTML injection when embedding
 * user-provided content in HTML templates (emails, Slack messages, etc.).
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/`/g, "&#96;")
}
