/**
 * vitrine-rum.ts — RUM leve das medidas User Timing da paginação da vitrine.
 *
 * O que faz: leva as measures `vitrine:*` (docs/vitrine-pagination-baseline.md —
 * os mesmos números do DevTools) do browser do usuário para
 * `POST /api/rum/vitrine`, onde viram log estruturado. É o CONTRAPOINTO do
 * guard de CI: o guard mede a máquina do CI (dados sintéticos, mesma seed);
 * o RUM mede o que o usuário REAL sentiu em produção (rede, dispositivo,
 * cold cache) — os limiares do doc ficam com o guard, o RUM responde
 * "quanto do baseline vale lá fora".
 *
 * SEM PII, POR CONSTRUÇÃO (não por promessa):
 *   - o payload é uma WHITELIST de campos — `name` (enum fechado), `duration`,
 *     `target` e os flags do regime (`direction`/`warm`/`inFlight`/`walked`).
 *     Qualquer outro campo do objeto de entrada é DESCARTADO aqui, antes da
 *     rede — nem por acidente um e-mail/id/cursor sai do browser;
 *   - sem session id, sem user id, sem UA, sem URL: a medida não pode ser
 *     ligada a uma pessoa nem a uma navegação específica;
 *   - o servidor (route.ts) revalida com zod e loga SÓ o parseado — o corpo
 *     cru nunca chega ao log.
 *
 * LEVE, POR CONSTRUÇÃO:
 *   - amostragem POR LOAD (não por evento): uma fração das sessões reporta
 *     TODAS as suas medidas, o resto nenhuma — a amostra é coerente (uma
 *     navegação de paginação do mesmo usuário) com o mínimo de requests.
 *     Fração via NEXT_PUBLIC_RUM_SAMPLE_RATE (default 0.1; 0 desliga);
 *   - micro-batch: até 5 medidas ou 5s, o que vier primeiro; transport é
 *     `navigator.sendBeacon` (fire-and-forget, sobrevive ao unload) com
 *     fallback `fetch keepalive`;
 *   - RUM é observabilidade: NENHUM caminho daqui lança — falha de beacon é
 *     engolida, buffer descartado, navegação intocada.
 */

/** Os 4 regimes instrumentados em src/components/vitrine/vitrine.tsx. */
export type VitrineRumName =
  | "vitrine:pagina:render"
  | "vitrine:walk:render"
  | "vitrine:deeplink:render"
  | "vitrine:popstate:render"

/** Uma medida assentada — o MESMO detail que performance.measure registrou. */
export type VitrineRumEntry = {
  name: VitrineRumName
  duration: number
  target: number
  direction?: "proxima" | "anterior"
  warm?: boolean
  inFlight?: boolean
  walked?: boolean
}

export const RUM_ENDPOINT = "/api/rum/vitrine"
/** Batch fecha em 5 medidas — a caminhada rápida (5 cliques) fecha exato. */
export const RUM_BATCH_SIZE = 5
export const RUM_FLUSH_MS = 5_000
export const DEFAULT_SAMPLE_RATE = 0.1

/** Amostragem SANEADA do env: fora de [0,1] ou não-numérica cai no default —
 *  um typo na variável nunca vira "reporta 100%" nem NaN quebrando o `<`. */
export function sampleRateFromEnv(raw: string | undefined): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return DEFAULT_SAMPLE_RATE
  return Math.min(1, n)
}

/** Transport injetável para os testes; o default é sendBeacon → fetch. */
export type VitrineRumSend = (url: string, body: string) => void

function defaultSend(url: string, body: string): void {
  if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
    if (navigator.sendBeacon(url, new Blob([body], { type: "application/json" }))) return
  }
  // Sem sendBeacon (ambientes exóticos) ou beacon recusado (fila cheia):
  // fetch keepalive é o fallback com o mesmo contrato fire-and-forget.
  void fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => {})
}

export type VitrineRumReporter = {
  /** Amostra esta medida? (decisão por load, uma vez) */
  sampled: () => boolean
  /** Reporta UMA medida — nunca lança. Campos fora da whitelist descartados. */
  report: (entry: VitrineRumEntry) => void
  /** Força o envio do buffer (útil em unload/testes). */
  flush: () => void
}

/**
 * Cria o reporter. A decisão de AMOSTRAGEM é tomada UMA vez, na criação
 * (por load): `random() < rate` — injetável para o teste enumerar os dois
 * lados da fronteira sem depender do dado do Math.random.
 */
export function createVitrineRumReporter(opts?: {
  rate?: number
  random?: () => number
  send?: VitrineRumSend
  batchSize?: number
  flushMs?: number
}): VitrineRumReporter {
  const rate = Math.min(1, Math.max(0, opts?.rate ?? DEFAULT_SAMPLE_RATE))
  const random = opts?.random ?? Math.random
  const send = opts?.send ?? defaultSend
  const batchSize = opts?.batchSize ?? RUM_BATCH_SIZE
  const flushMs = opts?.flushMs ?? RUM_FLUSH_MS

  const sampled = random() < rate
  let buffer: VitrineRumEntry[] = []
  let timer: ReturnType<typeof setTimeout> | null = null

  const flush = () => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    if (buffer.length === 0) return
    const entries = buffer
    buffer = []
    try {
      send(RUM_ENDPOINT, JSON.stringify({ entries }))
    } catch {
      // Transport indisponível: a amostra morre aqui — observabilidade não
      // levanta exceção e a navegação segue.
    }
  }

  /** Whitelist EXPLícita: o payload é montado campo a campo — o que não está
   *  aqui não existe no wire. É esta função que sustenta o "sem PII". */
  function toPayload(entry: VitrineRumEntry): VitrineRumEntry {
    const clean: VitrineRumEntry = {
      name: entry.name,
      duration: Math.round(entry.duration * 10) / 10,
      target: entry.target,
    }
    if (entry.direction !== undefined) clean.direction = entry.direction
    if (entry.warm !== undefined) clean.warm = entry.warm
    if (entry.inFlight !== undefined) clean.inFlight = entry.inFlight
    if (entry.walked !== undefined) clean.walked = entry.walked
    return clean
  }

  const report = (entry: VitrineRumEntry) => {
    if (!sampled) return
    try {
      buffer.push(toPayload(entry))
      if (buffer.length >= batchSize) {
        flush()
        return
      }
      if (timer === null) {
        timer = setTimeout(flush, flushMs)
      }
    } catch {
      // Nem um bug num campo pode quebrar o clique de paginação que a gerou.
    }
  }

  return { sampled: () => sampled, report, flush }
}

/** Singleton do app — criado LAZY (fora de SSR não existe window e nada
 *  acontece; no cliente, a decisão de amostragem nasce no 1º report). */
let singleton: VitrineRumReporter | null = null

export function reportVitrineMeasure(entry: VitrineRumEntry): void {
  if (typeof window === "undefined") return
  singleton ??= createVitrineRumReporter({
    rate: sampleRateFromEnv(process.env.NEXT_PUBLIC_RUM_SAMPLE_RATE),
  })
  singleton.report(entry)
}

/** Testes/instrumentação: derruba o singleton (a decisão de amostragem é
 *  re-feita na próxima medida). */
export function resetVitrineRumForTests(): void {
  singleton = null
}
