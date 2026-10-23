# Baseline de performance — APIs da vitrine (busca, filtros, geo, perfil)

Primeira edição: 2026-10-05 · ambiente: dev Next.js :3100 (bundle de
desenvolvimento) · dataset: seed Governador Valadares, 415 prestadores ·
método: 5 fetches por regime no mesmo processo, mediana reportada,
`performance.now()` em volta de `fetch` + dreno do corpo · medição
server-side (TTFB completo), NÃO inclui render client.

## Números medidos

| Regime               | Rota (params)                                                             | mediana | min     | HTTP |
| -------------------- | ------------------------------------------------------------------------- | ------- | ------- | ---- |
| Listagem p1          | `/api/providers?page=1&limit=9`                                           | 14.6 ms | 12.4 ms | 200  |
| Busca por texto      | `/api/providers?q=eletricista&limit=9`                                    | 11.6 ms | 10.0 ms | 200  |
| Filtro por categoria | `/api/providers?categoryId=<Cuidados>&limit=9`                            | 13.1 ms | 11.8 ms | 200  |
| Geo + raio 5 km      | `/api/providers?lat=-19.5317&lng=-42.6253&radius=5&sort=distance&limit=9` | 14.7 ms | 13.7 ms | 200  |
| Geo + raio 100 km    | idem com `radius=100`                                                     | 12.6 ms | 10.7 ms | 200  |
| Keyset p2            | `/api/providers?page=2&limit=9`                                           | 10.3 ms | 9.0 ms  | 200  |
| Perfil do prestador  | `/api/providers/<id>`                                                     | 17.1 ms | 15.8 ms | 200  |

## Leitura

- A fase 2 da query (2-Phase Query + índices GIN/GiST/B-tree) mantém TODOS os
  regimes de catálogo em 1–2 dezenas de ms em dev, com cache Redis quente.
- A expansão de raio (KNN single-pass) não degrada o regime de 100 km contra o
  de 5 km — o custo do fallback de expansão não aparece nesta amostra.
- O regime de geo usa coordenadas de Governador Valadares (centro) — com a
  seed local, raio 5 km já encontra prestadores (não exercita expansão a vazio).

## Guardas e limites

- Este doc é de PRIMEIRA EDIÇÃO (n=5, uma rodada, host local): servem como
  referência de comparação "como-como" (mesmo ambiente, mesmo método), não
  como limiar de gate. Uma piora RELATIVA forte entre rodadas é o sinal.
- Comparar sempre em dev :3100, mesma seed, mediana de ≥ 3 amostras.
- O render client da listagem é coberto pelo baseline de paginação
  (`docs/vitrine-pagination-baseline.md`) e pelo RUM (`vitrine:*`); este doc
  cobre o lado servidor.

## Reprodução

```bash
# dev na :3100 com a seed de 415 prestadores (portas do guard: 55434/56381)
DATABASE_URL=postgresql://postgres:postgres@localhost:55434/severinno_test \
REDIS_URL=redis://localhost:56381 SESSION_SECRET=<32+ chars> bunx next dev -p 3100
```

Script da medição (inline, node 20+): fetch 5× por regime listado acima e
reportar a mediana — o método é o mesmo do doc; nenhuma ferramenta extra.
