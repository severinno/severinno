/**
 * csp.ts — Content Security Policy estrita com nonces (Edge-compatible).
 *
 * Substitui `'unsafe-inline'`/`'unsafe-eval'` em script-src por nonces
 * por-request:
 *
 *   1. `proxy.ts` (Edge middleware) gera um nonce aleatório por request e:
 *      - injeta `nonce-...` em `script-src` da CSP da resposta;
 *      - repassa o nonce ao app via request header `x-nonce`.
 *   2. O App Router do Next.js 16 PROPAGA automaticamente o header `x-nonce`
 *      para as tags <script> que ele mesmo renderiza — é o contrato oficial
 *      de CSP por nonce do framework (ver docs do Next.js, seção CSP).
 *   3. `'strict-dynamic'` permite que o bundle principal (com nonce) carregue
 *      os chunks filhos por import dinâmico — necessário para code-splitting.
 *
 * Removidos da allowlist nesta versão:
 *   - `'unsafe-inline'` (execução de qualquer script inline);
 *   - `'unsafe-eval'` (eval/Function — quebra alvos de XSS por eval);
 *   - `https://unpkg.com` (CDN de terceiros em script-src = vetor de
 *     supply-chain; o projeto não referencia nenhum asset do unpkg).
 *
 * Exceções documentadas que continuam permitidas:
 *   - `style-src-attr 'unsafe-inline'`: os ATRIBUTOS style (style={{...}}) de
 *     elementos dinâmicos (progress bars, duração de animações por item,
 *     cores de avatar por hue) não aceitam nonce/hash pela CSP — a diretiva
 *     de atributos só admite 'unsafe-inline'/'unsafe-hashes'. CSS sem
 *     execução de código; migração completa exigiria CSS custom-properties
 *     via inline <style> dinâmico (próxima rodada).
 *   - Hash do <style> do global-error: a página de erro catastrófico renderiza
 *     seu próprio <html> (sem os <link> de CSS do app), então o estilo é
 *     autocontido e PINADO por hash SHA-256 — se o CSS mudar sem atualizar o
 *     hash, o teste detecta o drift (ver csp.test.ts).
 *   - JSON-LD (`<script type="application/ld+json">`): o Next.js 16 aplica
 *     o nonce do header `x-nonce` também a estes scripts renderizados no
 *     servidor; conteúdo controlado e sanitizado por sanitizeForJsonLd().
 *
 * Dev: mantém 'unsafe-eval' (react-refresh/Turbopack exigem) e loga violações
 * em console. Produção: strict + report-to.
 */

// ── Nonce generation (Edge-compatible: Web Crypto) ─────────────────────────

/**
 * Gera um nonce base64 de 128 bits para ESTE request.
 * Deve ser chamado uma única vez por request e reutilizado na CSP + header.
 */
export function generateCspNonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  let binary = ""
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

// ── Directive builders ─────────────────────────────────────────────────────

const IMG_SOURCES = [
  "'self'",
  "data:",
  "blob:",
  "https://*.s3.amazonaws.com",
  "https://maps.googleapis.com",
  "https://*.tile.openstreetmap.org",
  "https://tile.openstreetmap.org",
  "https://*.gravatar.com",
  "https://ui-avatars.com",
  "https://i.pravatar.cc",
  "https://picsum.photos",
].join(" ")

const FONT_SOURCES = ["'self'", "https://fonts.gstatic.com"].join(" ")

/**
 * Monta a CSP completa para o request.
 *
 * @param nonce    Nonce gerado por generateCspNonce() para este request.
 * @param origin   Origin do request (connect-src ecoa o próprio domínio).
 * @param isProduction  Produção = strict (sem eval); dev = permite eval.
 * @param reportOnly    Se true, gera Content-Security-Policy-Report-Only
 *                      (mesmas diretrizes) — modo de observação para rollout.
 */
export function buildCsp(options: {
  nonce: string
  origin: string
  isProduction: boolean
  reportOnly?: boolean
}): { header: string; value: string } {
  const { nonce, origin, isProduction, reportOnly = false } = options

  // script-src: nonce + strict-dynamic. SEM unsafe-inline/unsafe-eval em prod.
  // Na presença de nonce + strict-dynamic, browsers modernos IGNORAM
  // 'unsafe-inline' (backward compat), então nem o incluímos.
  const scriptSrc = isProduction
    ? `'self' 'nonce-${nonce}' 'strict-dynamic' https://va.vercel-scripts.com https://vercel-insights.com`
    : `'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval' https://va.vercel-scripts.com https://vercel-insights.com`

  // connect-src: dev adiciona localhost + ws para HMR/realtime.
  const connectSrc = isProduction
    ? `'self' ${origin} https://severinno.com https://*.upstash.io https://sentry.io https://*.ingest.sentry.io https://tile.openstreetmap.org https://*.tile.openstreetmap.org https://api.glitchtip.com wss://severinno.com.br wss://${new URL(origin).host}`
    : `'self' ${origin} https://severinno.local https://severinno.com http://localhost:* https://*.upstash.io https://sentry.io https://*.ingest.sentry.io https://tile.openstreetmap.org https://*.tile.openstreetmap.org wss://localhost:* ws://localhost:*`

  const directives = [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "worker-src 'self' blob:",
    // ── Styles: SEM 'unsafe-inline' em elementos <style>/<link> ────────────
    // Os <style> inline que restavam (ticker, skeletons, 404) foram migrados
    // para globals.css; o do global-error é pinado por hash abaixo.
    // style-src-attr mantém 'unsafe-inline' APENAS para os atributos style={{}}
    // dinâmicos (nonces não se aplicam a atributos; ver header do arquivo).
    "style-src 'self' https://fonts.googleapis.com",
    `style-src-attr 'unsafe-inline'`,
    `style-src-elem 'self' 'sha256-eqW5FnLZ2T07K7f5xhzEJOVJru1NKj1t3pH4q2urlAE=' https://fonts.googleapis.com`,
    `img-src ${IMG_SOURCES}`,
    `font-src ${FONT_SOURCES}`,
    `connect-src ${connectSrc}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "media-src 'self'",
    "manifest-src 'self'",
    // Report URI local — rota dedicada coleta e loga violações (observability).
    "report-uri /api/csp-report",
  ]

  return {
    header: reportOnly ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy",
    value: directives.join("; "),
  }
}

/** Header de request pelo qual o nonce viaja proxy → app (contrato Next.js). */
export const CSP_NONCE_HEADER = "x-nonce"
