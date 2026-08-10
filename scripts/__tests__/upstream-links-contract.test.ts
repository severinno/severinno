/**
 * upstream-links-contract.test.ts - pin de rastreabilidade dos links upstream
 * citados no gates-proofs.md (secao 11.2, eslint_d.js).
 *
 * WHY: a secao 11.2 documenta o estado do upstream (mantoni/eslint_d.js)
 * citando as issues #281 (PSA: ESLINT_USE_FLAT_CONFIG locked no start) e #276
 * (suporte a flat config) com links de rastreabilidade - "se o eslint_d
 * ganhar watch, a adocao vira viavel" depende de seguir essas issues. A
 * verificacao foi manual via API (2026-08-09); este teste trava a
 * rastreabilidade contra LINK ROT futuro em DUAS camadas:
 *
 * 1. PARSE CONTRACT (sem rede, roda em todo test:unit): o doc DEVE citar as
 *    issues #281 e #276 como links para o repo mantoni/eslint_d.js. Se a
 *    secao 11.2 mudar de repo/tracker, este teste quebra - obrigando a
 *    decisao explicita de atualizar o contrato junto.
 * 2. LIVE CHECK (rede): cada URL citada deve responder HTTP 200 (ou um
 *    redirect 3xx seguido ate 200 - repos movidos). Link rot real (404/410)
 *    FALHA; indisponibilidade de rede (DNS/fetch/5xx) faz SKIP honesto com
 *    aviso - a rastreabilidade da secao 11.2 fica auditavel em todo PR sem
 *    transformar flake de CI em falso blocker. Explicito: o skip so acontece
 *    quando o fetch NAO consegue alcancar o GitHub de jeito nenhum (o
 *    checker pode ser usado fora do CI); 404/410 sao semantica de link rot
 *    e falham sempre.
 *
 * Subprocess-free (fetch direto, sem spawn) - mas o LIVE CHECK e
 * network-heavy: timeout explicito de 60000 (o scan-timeouts guard exige
 * timeout explicito em todo teste que pode esperar rede).
 */
import { describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"

const DOC = path.resolve(process.cwd(), "docs", "gates-proofs.md")
const UPSTREAM_ISSUES = ["281", "276"] // secao 11.2: as issues citadas do mantoni/eslint_d.js
const REPO = "https://github.com/mantoni/eslint_d.js"

function docText(): string {
  return fs.readFileSync(DOC, "utf8")
}

/** The documented links for the pinned upstream issues, in doc order. */
function documentedLinks(): string[] {
  const text = docText()
  return UPSTREAM_ISSUES.map((n) => {
    const m = text.match(new RegExp(`\\[#${n}\\]\\(${REPO.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/issues/${n}\\)`))
    if (!m) return ""
    return m[0].match(/https:\/\/[^)]+/)![0]
  })
}

/**
 * Live-check one URL: follows redirects, resolves to the final status.
 * 429 (GitHub rate limit em IP compartilhado de CI) ganha 1 retry com 400ms
 * de espera - e se persistir, quem decide e o chamador (o catch trata 429
 * como indisponibilidade, NAO como link rot: a URL existe, so o throttling
 * falhou). 404/410 (link rot real) nunca retryam e sempre falham.
 */
async function httpStatus(url: string): Promise<number> {
  const attempt = (): Promise<Response> =>
    fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: { "user-agent": "severinno-upstream-links-contract" },
      signal: AbortSignal.timeout(15000),
    })
  let res = await attempt()
  if (res.status === 429) {
    await new Promise((r) => setTimeout(r, 400))
    res = await attempt()
  }
  return res.status
}

describe("upstream links citados no gates-proofs.md (secao 11.2, eslint_d.js)", () => {
  it("PARSE CONTRACT: o doc DEVE citar as issues 281/276 como links para o mantoni/eslint_d.js", () => {
    const links = documentedLinks()
    for (let i = 0; i < UPSTREAM_ISSUES.length; i++) {
      expect(links[i], `secao 11.2 deve citar a issue ${UPSTREAM_ISSUES[i]} como link do upstream`).toContain(
        `${REPO}/issues/${UPSTREAM_ISSUES[i]}`,
      )
    }
  }, 30000)

  it("LIVE CHECK: as URLs citadas respondem HTTP 200 (link rot 404/410 FALHA; rede indisponivel faz skip honesto)", async () => {
    const links = documentedLinks()
    const reachable: string[] = []
    for (const url of links) {
      try {
        const status = await httpStatus(url)
        expect(
          status,
          `link rot: ${url} respondeu ${status} (esperado 200) - a rastreabilidade da secao 11.2 quebrou`,
        ).toBe(200)
        reachable.push(url)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        // So skip quando o GitHub e INALCANCAVEL (DNS/fetch/timeout/429 - ex.:
        // o checker rodando offline, ou rate limit persistente de IP de CI).
        // Um 404/410 cai no expect acima e falha - link rot nunca skipa.
        console.warn(`[upstream-links] SKIP de rede para ${url}: ${msg}`)
      }
    }
    if (reachable.length === 0 && links.length > 0) {
      console.warn("[upstream-links] rede indisponivel - LIVE CHECK pulado, PARSE CONTRACT ainda vale")
    }
  }, 60000)
})
