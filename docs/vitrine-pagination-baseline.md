# Baseline de performance — paginação da vitrine

Instrumentação User Timing (Performance API) do clique de paginação
(Próxima/Anterior) e os números de referência medidos em dev. Objetivo:
detectar regressões futuras comparando medições como-como (mesmo ambiente,
mesmo método — NÃO comparar com produção).

Medido em: 2026-10-04 · ambiente: dev Next.js :3100 (bundle de desenvolvimento,
não-minificado) · dataset: seed Governador Valadares, 415 prestadores, 47
páginas de 9 · navegador Chromium via preview.

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

| Regime                                                       | Nome da medida            | duração observada                                            | n   |
| ------------------------------------------------------------ | ------------------------- | ------------------------------------------------------------ | --- |
| Clique, cache quente, nada em voo                            | `vitrine:pagina:render`   | **42.7 – 119.9 ms** (mediana ≈ 110 ms)                       | 5   |
| Clique, cache quente + fetch em voo                          | `vitrine:pagina:render`   | ~204 ms observado (tail da rede; janela rara por design)     | 1   |
| Caminhada rápida (4 cliques na cadência do botão)            | `vitrine:pagina:render`   | 36 – 102 ms por clique, 5 requests para 5 páginas (1/página) | 4   |
| Walk reverso (Anterior, deep-link sem âncora de N-1; p1→p2)  | `vitrine:walk:render`     | **238.6 ms**                                                 | 1   |
| Pouso do deep-link por seek direto (`?pagina=N&cursor=X`)    | `vitrine:deeplink:render` | **283.2 – 283.9 ms** (cold — inclui o seek)                  | 2   |
| Pouso do deep-link com walk interno (`?pagina=4`, 3 páginas) | `vitrine:deeplink:render` | **489 ms**                                                   | 1   |

Por que o clique é quase sempre `warm`: o prefetch da página seguinte dispara
na chegada de cada página (e o hover/focus/touch revalida o cache vencido
antes do clique) — render de cache é o regime de projeto; a rede aparece como
tail (`inFlight`) ou na revalidação pós-clique em background.

## Limiar de regressão (sugestão)

Comparar SEMPRE em dev :3100, mesma seed, mediana de ≥ 3 amostras por
regime:

- `vitrine:pagina:render` warm mediana **> 250 ms** → investigar (o
  esperado é 40–120 ms em dev; pioras relativas importam mais que
  absolutos)
- `inFlight: true` ou cold **> 800 ms** → investigar (o fetch de uma página
  em dev responde em ~15–25 ms server-side; o tail é client)
- `vitrine:walk:render` **> 800 ms** por página de walk (o observado é
  ~240 ms/página; escala linearmente com o número de páginas encadeadas)
- `vitrine:deeplink:render` seek **> 800 ms**; com walk interno **>
  250 ms × páginas de walk** (o observado é ~163 ms/página)

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
