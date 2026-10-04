/**
 * maplibre-worker — garante que o MapLibre use um worker servido por URL
 * do próprio app (`/maplibre/...`) em vez do blob gerado a partir da
 * URL do bundle.
 *
 * Por quê: em dev (Turbopack) e em alguns deploys, o `import.meta.url` que
 * o MapLibre usa para derivar a URL do worker é reescrito e o fallback
 * blob/inline falha silenciosamente — o mapa fica com fundo vazio e NENHUM
 * tile é requisitado. Servir `maplibre-gl-worker.js` +
 * `maplibre-gl-shared.js` de `public/maplibre/` (mesma versão do pacote)
 * resolve; `worker-src 'self' blob:` na CSP já cobre a origem 'self'.
 *
 * Os arquivos são copiados de node_modules por `scripts/sync-maplibre-worker.mjs`
 * (roda no postinstall) — o check anti-drift falha o CI se desalinharem.
 */

import { config as maplibreConfig, getWorkerUrl } from "maplibre-gl"

const WORKER_PATH = "/maplibre/maplibre-gl-worker.js"

let ensured: Promise<boolean> | null = null

/**
 * Configura o worker por URL (idempotente). Respeita uma URL setada
 * antes por outra parte do código. Em caso de erro (API indisponível,
 * ambiente sem worker), apenas loga e deixa o MapLibre usar o default.
 *
 * @returns true se a URL custom foi aplicada.
 */
export function ensureMaplibreWorker(): Promise<boolean> {
  ensured ??= (async () => {
    try {
      if (typeof window === "undefined" || typeof Worker === "undefined") return false
      // Outra parte já configurou um worker custom — respeitar.
      if (getWorkerUrl()) return false

      // Sanity check: a URL servida precisa responder como módulo.
      const res = await fetch(WORKER_PATH, { method: "HEAD" })
      if (!res.ok) throw new Error(`worker não servido em ${WORKER_PATH} (${res.status})`)

      maplibreConfig.WORKER_URL = WORKER_PATH
      return true
    } catch (err) {
      console.warn(
        "[maplibre-worker] não foi possível configurar o worker por URL — usando o default:",
        err instanceof Error ? err.message : err,
      )
      return false
    }
  })()
  return ensured
}
