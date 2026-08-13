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

## Medição A/B — code-split da vitrine (2026-08-13)

A/B isolado da conversão das 16 seções da vitrine para `next/dynamic` (P1-1): mesma árvore, mesmo toolchain (`ANALYZE=true next build --webpack` + `check-js-budget --json`), única diferença = `vitrine.tsx` (16 imports estáticos vs 16 `next/dynamic` com `ssr:true` + `SectionSkeleton` de fallback).

| Métrica (KB gzip) | Antes (estático) | Depois (dynamic) | Δ |
|---|---|---|---|
| Initial JS (/) — real transfer | 236.5 | 236.8 | +0.3 |
| Total client bundle | 1181.9 | 1202.1 | +20.2 |
| Largest chunk | 266.9 | 266.9 | +0.0 |
| Chunks | 210 | 227 | +17 |
| Rota / (layout+page) | 7.4 | 7.4 | +0.0 |

**Veredito calibrado**: com `ssr:true` (decisão de SEO — as seções abaixo da dobra são renderizadas no servidor), o `next/dynamic` **não reduz o JS de primeiro paint**: os chunks das 16 seções continuam no script list do HTML pré-renderizado (necessários para hidratar), por isso o Initial (/) fica plano (+0.3 KB ≈ o próprio `SectionSkeleton` — o único código novo de primeiro paint, já que o código das 16 seções é idêntico entre os dois builds). O custo medido é granularidade: 210 → 227 chunks, e o total +20.2 KB decompõe em ≈ +0.3 KB do SectionSkeleton + ≈ +19.9 KB de overhead de split. O ganho real hoje é **granularidade de cache** (editar uma seção invalida só o chunk dela, não o bundle da vitrine) + o fallback de loading sem flash de null. Para cortar o primeiro paint de fato, o caminho é `ssr:false` + Suspense nas seções abaixo da dobra — com o custo de SEO documentado — ou aceitar o flat como o preço da renderização no servidor.

**Gate**: budgets da sec 8.1 seguem verdes (initial 236.8 < 270, total 1202.1 < 1480) — nenhuma recalibração necessária.

> ℹ️ Medição manual pontual (2026-08-13) — o job `budget` do CI regenera `bundle-report.md` a cada release; se esta seção for sobrescrita, re-executar o A/B com a metodologia documentada acima.

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
