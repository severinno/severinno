# Orçamento de bundle client (primeira edição)

Primeira edição: 2026-10-05 · build de produção (Turbopack, Next 16.3.8,
`bun run build` — warm) · medição por `stat` dos chunks estáticos servidos
(sem gzip) · o build de produção foi rodado com `ANALYZE=true`
(`bun run build:analyze`) para o HTML do analyzer.

## Números medidos

| Medida                                    | Valor                        | Como medir                                              |
| ----------------------------------------- | ---------------------------- | ------------------------------------------------------- |
| Total de chunks client                    | 201 chunks · 7.9 MB agregado | `du -sh .next/static/chunks`                            |
| Chunk da rota da vitrine (VitrineResults) | **86.4 KB**                  | chunk que contém `aria-label="Paginação de resultados"` |
| Vendor react-dom (chunk compartilhado)    | 226.8 KB                     | chunk que contém `react-dom`                            |
| Chunk maplibre-gl (mapa)                  | **1026.4 KB**                | chunk com 429 refs a `maplibre`                         |
| Rota leve de comparação (/como-funciona)  | 7.8 KB                       | chunk que contém o texto da página                      |

## Leitura

- O chunk inicial da vitrine (86.4 KB) NÃO referencia o chunk de 1 MB:
  `maplibre-gl` entra por cadeia de `await import()` (`providers-map.tsx` →
  `enhanced-providers-map.tsx` carregado por `next/dynamic`) — o mapa é lazy
  por desenho e o carregamento inicial da vitrine não o paga.
- O vendor react-dom (226.8 KB) é o maior chunk compartilhado; é a base de
  qualquer rota React e não é alvo de otimização nesta edição.

## Orçamento declarado (guarda de regressão manual)

- Chunk da rota da vitrine: **≤ 120 KB** (hoje 86.4 KB) — ultrapassar é
  sinal para investigar antes de merge.
- Qualquer chunk estático > 300 KB novo fora do vendor react-dom e do
  maplibre lazy exige justificativa (dynamic import ou code-split).
- `maplibre-gl` deve permanecer **lazy**: um import estático dele em qualquer
  rota reprova este orçamento (salta ~1 MB para o carregamento inicial).

## Limites

- Primeira edição, build warm, sem gzip (os números de rede são ~1/3 disso).
- Turbopack (Next 16) não imprime a tabela de tamanhos no log do build; a
  medição é pós-build, pelos chunks em `.next/static/chunks/`.
- Não cobre CSS nem fontes — só JS client.
