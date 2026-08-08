# Bundle Report — Severinno

> Gerado automaticamente a cada release pelo CI (job `budget`). Não editar manualmente.
> Fonte: `ANALYZE=true next build --webpack` + `scripts/check-js-budget.mjs` (KB gzip).
> Δ = variação vs a versão anterior da tabela.

## Histórico

| Versão | Data | Initial (/) | Δ Init | Total | Δ Total | Largest | Δ Largest | Maplibre | Recharts | Framer | Δ Framer | Gate |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| v0.4.2 | 2026-08-08 | 219.1 | -0.1 | 1189.3 | -39.9 | 266.8 | 0.0 | 266.9 | 85.4 | — | — | ✅ |
| v0.4.1 | 2026-08-08 | 219.2 | -52.8 | 1229.2 | 0.0 | 266.8 | — | 266.9 | 85.4 | 40.0 | +0.5 | ✅ |
| v0.4.0 | 2026-08-08 | 272.0 | — | 1229.2 | — | — | — | 266.9 | 85.4 | 39.5 | — | ❌ |

> ℹ️ As colunas de libs (Maplibre/Recharts/Framer) medem o **total gzip da lib no bundle**, incluindo o que vive em modais lazy — **Δ Framer, em particular, mede o total da lib, não o initial JS**. Presença no primeiro paint é garantida pelo guard de lazy-load (check 5), não pela coluna.

## Top 5 maiores chunks (KB gzip)

### v0.4.2 — 2026-08-08
| # | Chunk | KB gzip |
|---|---|---|
| 1 | static/chunks/33ef75ef.66c5b92e23827666.js | 266.8 |
| 2 | static/chunks/319.44b2765c8cc7c430.js | 104.7 |
| 3 | static/chunks/8863.d3dd9e19f2086ae6.js | 68.7 |
| 4 | static/chunks/6260586b-c09e5c25c5b59621.js | 61.3 |
| 5 | static/chunks/1840-ba222946fea25761.js | 60.3 |

## Rotas (real transfer, KB gzip)

### v0.4.2 — 2026-08-08
| Rota | Params | KB gzip | Δ |
|---|---|---|---|
| /busca | 1 | 261.1 | — |
| /dashboard | 1 | 218.1 | — |
| /u/[slug] | 6 | 228.6 | — |
| /categoria/[slug] | 27 | 259.0 | — |

_Última atualização: 2026-08-08 (v0.4.2)_
