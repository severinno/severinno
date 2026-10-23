# Baseline de performance — paginação da vitrine

Instrumentação User Timing (Performance API) do clique de paginação
(Próxima/Anterior) e os números de referência medidos em dev. Objetivo:
detectar regressões futuras comparando medições como-como (mesmo ambiente,
mesmo método — NÃO comparar com produção).

Medido em: **2026-10-22** (re-ancoragem) · ambiente: dev Next.js :3100 (bundle de
desenvolvimento, não-minificado) · dataset: `scripts/seed-vitrine-baseline.ts`,
**415 prestadores visíveis**, 47 páginas de 9 (determinístico e idempotente) ·
navegador Chromium via Playwright (guard de CI, 1 ato). O primeiro ato, de
2026-10-05, usou a seed aleatória de Governador Valadares no mesmo total de 415
visíveis e outro host (medianas menores: 80ms no clique, 217ms no seek); a régua
compara **como-como** (mesmo ambiente e dataset), nunca com produção.

## O que é medido

Uma entrada por navegação, um nome por regime (filtragem direta no DevTools
e no RUM). O FIM é sempre o commit em que os dados da PÁGINA ALVO assentam
(não placeholder — placeholder é a página anterior ainda na tela):

| Nome                      | Início (gatilho)                                                                                   | detail                                  |
| ------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `vitrine:pagina:render`   | clique em Próxima/Anterior (`goPage`)                                                              | `{ target, direction, warm, inFlight }` |
| `vitrine:walk:render`     | Anterior que dispara o walk reverso (deep-link sem âncora de N-1)                                  | `{ target, kind }`                      |
| `vitrine:deeplink:render` | hidratação da URL com `?pagina=N` (seek direto `walked: false` ou com walk interno `walked: true`) | `{ target, walked, warm }`              |
| `vitrine:popstate:render` | rehidratação por back/forward (label próprio — não polui o baseline do deep-link)                  | `{ target, walked, warm }`              |

- `warm` — havia dados em cache para o alvo no instante do gatilho
- `inFlight` — havia fetch em voo para o alvo no clique (o render ainda
  assim espera o tail da rede; ex.: o focus-prefetch do botão dispara no
  `mousedown`, antes do `click`)

Onde está instrumentado: `src/components/vitrine/vitrine.tsx` — `navStartRef`
é aberto em `goPage` (clique), em `goPrevPage` (walk reverso) e no `applyUrl`
(deep-link/popstate), e fechado pelo MESMO effect de assentamento. Envolvido
em `try/catch`: User Timing é observabilidade e nunca pode quebrar a
navegação. Guardas: o `applyUrl` só abre medida quando a URL MUDA (o
double-invoke de effect em dev re-executa com a mesma URL e não sobrescreve
o pending — sem o filtro, o re-run rotulava popstate e roubava o deeplink);
deep-link para `/` (pagina=1) não gera medida; se o dataset acaba antes do
alvo do walk, a medida é descartada (pouso em página diferente do alvo).

## Como reproduzir

```js
// No dev (:3100), com a vitrine aberta:
// 1) clicar Próxima/Anterior normalmente, então:
performance
  .getEntriesByType("measure")
  .filter((e) => e.name.startsWith("vitrine:"))
  .map((e) => ({ name: e.name, dur: Math.round(e.duration * 10) / 10, detail: e.detail }))
// As entradas também aparecem no DevTools → Performance → Timings.
```

## Baseline medido

Ato de 22/10/2026 — 2 rodadas do guard contra o dataset determinístico, com
medianas estáveis entre elas (warm 111.8 / 113.5 ms; seek 327.6 / 339.0 ms); a
tabela publica as amostras da rodada `--json` (o primeiro clique é AQUECIMENTO e
o 1º pouso absorve a compilação da rota no dev):

| Regime                                                       | Nome da medida            | duração observada                                         | n   |
| ------------------------------------------------------------ | ------------------------- | --------------------------------------------------------- | --- |
| Clique, cache quente, nada em voo (1 aquec. + 5 amostras)    | `vitrine:pagina:render`   | **44.3 – 158.0 ms** (mediana ≈ 113.5 ms)                  | 6   |
| Clique, cache quente + fetch em voo                          | `vitrine:pagina:render`   | 0 amostras no ato (tail da rede; janela rara por design)  | 0   |
| Walk reverso (Anterior no pouso do seek, sem âncora de N-1)  | `vitrine:walk:render`     | **283.0 ms** (1 página de walk)                           | 1   |
| Pouso do deep-link por seek direto (`?pagina=N&cursor=X`)    | `vitrine:deeplink:render` | **326.9 – 354.2 ms** (contexto JS frio; mediana ≈ 328 ms) | 3   |
| Pouso do deep-link com walk interno (`?pagina=4`, 3 páginas) | `vitrine:deeplink:render` | **529.8 ms** (≈ 176.6 ms/página de walk)                  | 1   |

Por que o clique é quase sempre `warm`: o prefetch da página seguinte dispara
na chegada de cada página (e o hover/focus/touch revalida o cache vencido
antes do clique) — render de cache é o regime de projeto; a rede aparece como
tail (`inFlight`) ou na revalidação pós-clique em background.

## Limiar de regressão (sugestão)

Comparar SEMPRE em dev :3100, mesma seed, mediana de ≥ 3 amostras por
regime:

**Re-ancorados em 22/10/2026, os limiares NÃO mudaram.** O ato novo mediu
dentro deles com folga (warm 113.5 ≤ 250; seek 328 ≤ 800; walk 283 ≤ 800;
walk-interno 529.8 para 3 páginas ≤ 750), então apertá-los ou afrouxá-los com
1 ato de um dataset novo seria trocar o gate por ruído de máquina — o gate mede
REGRESSÃO relativa, não o absoluto do host.

- `vitrine:pagina:render` warm mediana **> 250 ms** → investigar (o
  observado é 44.3 – 158.0 ms, mediana ≈ 113.5 ms; pioras relativas importam
  mais que absolutos)
- `inFlight: true` ou cold **> 800 ms** → investigar (o fetch de uma página
  em dev responde em ~15–25 ms server-side; o tail é client)
- `vitrine:walk:render` **> 800 ms** por página de walk (o observado é
  283 ms para 1 página; escala linearmente com o número de páginas
  encadeadas)
- `vitrine:deeplink:render` seek **> 800 ms**; com walk interno **>
  250 ms × páginas de walk** (o observado é ~176.6 ms/página: 529.8 ms
  para 3 páginas)

## Guard de CI

Os limiares acima são APLICADOS pelo guard
`scripts/check-vitrine-pagination-baseline.mjs` — a constante `THRESHOLDS` do
script é a fonte canônica dos números, e o teste de simetria
(`src/lib/__tests__/check-vitrine-pagination-baseline.test.ts`) reprova quando
este doc e o script divergem: reajustar um limiar é mudar os DOIS lados no
mesmo commit.

O **dataset** do guard é versionado e determinístico:
`scripts/seed-vitrine-baseline.ts` garante **415 prestadores visíveis** (47
páginas de 9) — a seed base (`prisma/seed.ts`) cria 6 de demonstração, uma única
página. O script é idempotente: apaga só os prestadores que ele mesmo criou
(prefixo de e-mail reservado) e completa a diferença, então duas rodadas medem o
mesmo catálogo. Sem ele o guard morre no locator `Próxima` antes de medir.

O guard roda a rotina completa contra um dev server real e coleta as measures
pelo mesmo caminho do DevTools (`performance.getEntriesByType("measure")`):

- **Clique quente** — 1 clique de aquecimento (absorve a rota fria do dev) +
  5 cliques em Próxima; mediana dos warm ≤ 250 ms, qualquer clique ≤ 800 ms.
- **Deep-link seek** — a URL de p3 capturada durante a caminhada, reaberta em
  3 contextos JS frios; mediana ≤ 800 ms.
- **Walk reverso** — Anterior no pouso do seek (sem âncora de p2): ≤ 800 ms ×
  páginas de walk.
- **Deep-link com walk interno** — `?pagina=4` sem cursor: ≤ 250 ms × 3
  páginas.

Regime sem measure nenhuma REPROVA (fail-closed — sem prova não há verde),
com exit 1; ambiente não respondendo (server fora do ar, browser
indisponível) é exit 2. Local:

```sh
# dev :3100 com o dataset de 415 visíveis (script acima) + Chromium do Playwright
bun scripts/seed-vitrine-baseline.ts
bun run check:vitrine-pagination-baseline
```

No CI, o guard é REQUIRED CHECK DO MERGE na forja dona do merge: o job
`vitrine-baseline` do `.gitea/workflows/ci.yml` (contexto **Pagination
baseline guard**, no manifesto `ci/required-checks.json`) sobe PostGIS + seed

- `next dev` na :3100 e roda em TODO PR e push daquela forja — regressão de
  performance da paginação bloqueia o merge, com a reaplicação de branch
  protection declarada em `ci/required-checks-applied.json` (escrita pelo
  applier, nunca à mão). O espelho do GitHub (sem portão de merge — 403 de
  plano) roda o MESMO guard POR PATHS em `.github/workflows/vitrine-baseline.yml`
  (precedente `e2e-cache.yml`), com o report como artifact. A saída JSON (flag
  `--json`) traz as amostras cruas para triagem — um vermelho em regime de
  amostra única (walk, walk-interno) primeiro pergunta "ruído de máquina?"
  (rodar de novo) antes de investigar código.

## RUM — o baseline visto pelos usuários reais

O baseline deste doc vem de MEDIDAS CONTROLADAS (dev, mesma seed, guard de CI).
O CONTRAPOINTO é o RUM leve: as mesmas 4 measures `vitrine:*` saem do browser
dos usuários reais e viram log estruturado — resposta a "quanto do baseline
vale em produção" (rede real, dispositivo real, cache frio).

- **Client** (`src/lib/vitrine-rum.ts`): no assentamento de cada medida, o
  reporter decide por AMOSTRAGEM DE LOAD (`NEXT_PUBLIC_RUM_SAMPLE_RATE`,
  default **0.1**; `0` desliga) — a fração amostrada reporta TODAS as suas
  medidas, o resto nenhuma (amostra coerente, mínimo de requests). Micro-batch
  de 5 medidas ou 5s; transport é `navigator.sendBeacon` com fallback
  `fetch keepalive`; nenhum caminho lança.
- **SEM PII, por construção**: o payload é uma whitelist de campos (`name`,
  `duration`, `target`, e os flags do regime `direction`/`warm`/`inFlight`/
  `walked`) — qualquer outro campo é descartado no client ANTES da rede, e o
  servidor revalida com zod e loga SÓ o parseado (o corpo cru nunca chega ao
  log). Sem session id, sem user id, sem UA, sem URL, sem IP.
- **Server** (`POST /api/rum/vitrine`): `withRoute` + zod (1–20 entries,
  duração ≤ 60s, content-length ≤ 16 KB), resposta **sempre 204 sem corpo**
  (beacon não lê resposta e RUM nunca vira sinal de erro), log pino no mesmo
  destino do `/api/web-vitals` (Loki/Promtail).

Como consultar: os logs carregam `[VitrineRUM] N medida(s)` com
`rum: [{ name, duration, target, ... }]` — p95/mediana por `name` no agregador
dá o perfil real por regime. NÃO comparar com os limiares deste doc (dev);
produção tem outra régua — use o RUM para distribuições e tendência, o guard
para o gate de regressão.

## Notas

- Números de DEV (React development, HMR, sem minificação) — servem para
  detectar regressões relativas, não para estimar produção.
- O buffer do User Timing é limitado pelo browser (entradas antigas caem
  fora); as medidas não são consumidas pelo app — só observabilidade.
- Mudança de filtro (`resetToFirstPage`) NÃO gera medida (não passa por
  `goPage` — é reset de estado, não navegação de paginação).

## Avaliação: prefetch N+2 em cascata — RECUSADA com dados

Proposta: pré-buscar duas páginas à frente para caminhadas rápidas de
Próxima repetido. Medição da caminhada rápida atual (4 cliques, dev :3100,
2026-10-04): **5 requests para 5 páginas** (1/página — a prefetch da
seguinte dispara na chegada de cada uma, gaps de 105–170 ms) e cliques a
**36–102 ms**, todos `warm: true, inFlight: false`.

Por que recusar: a âncora de N+2 só existe quando a prefetch de N+1
COMPLETA (é o `nextCursor` dela) — o cascado dispararia no MESMO instante
em que o landing-prefetch de N+2 já dispara (o pouso em N+1). **Zero ganho
de latência, +1 request por página** (desperdiçado quando a caminhada
para). O contrato "não cascateia" do effect de prefetch é o certo. Reabrir
apenas se o regime de rede mudar (ex.: RTT > 300 ms, onde antecipar 1 RTT
por clique importaria).
