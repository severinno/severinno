/**
 * Severinno Marketplace SaaS — Realtime Mini-Service: port parsing (PURE)
 *
 * `parseRealtimePort` morava em security.ts, que importa `node:crypto` no
 * topo. O app importa o parser no `src/lib/env.ts` (deriva a URL default do
 * realtime), e o Edge Runtime do instrumentation do Next NÃO suporta
 * `node:crypto` — puxar security.ts pro grafo Edge derruba o hook de
 * instrumentação (500 em todas as rotas API no dev após restart). Este
 * módulo é PURAMENTE numérico (zero imports): `env.ts` importa daqui direto,
 * e security.ts re-exporta para o serviço realtime + testes continuarem
 * consumindo da MESMA fonte única.
 */

/**
 * Resolve the realtime HTTP/socket port from env `REALTIME_PORT` (fallback
 * 3003). O compose já repassa `PORT: ${REALTIME_PORT:-3003}` ao container
 * (docker-compose.yml) — o serviço aceita AMBOS para não quebrar o contrato
 * existente: `REALTIME_PORT` primeiro, depois `PORT`, senão 3003.
 * Guard pattern do repo (parseSweepIntervalMs): NaN/não-inteiro/'0'/
 * forado do range 1–65535 → fallback (uma porta inválida NUNCA derruba o
 * listen com erro obscuro — a misconfig cai no default documentado). Pura —
 * o serviço chama com `process.env.REALTIME_PORT` no boot, o que permite
 * smoke de boot em porta alternativa e testes de isolamento (várias
 * instâncias no mesmo host sem colisão).
 */
export function parseRealtimePort(raw: string | undefined, fallback = 3003): number {
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1 || n > 65535) return fallback
  return n
}
