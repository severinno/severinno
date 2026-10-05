# Baseline de performance — paginação da vitrine

Instrumentação User Timing (Performance API) do clique de paginação
(Próxima/Anterior) e os números de referência medidos em dev. Objetivo:
detectar regressões futuras comparando medições como-como (mesmo ambiente,
mesmo método — NÃO comparar com produção).

Medido em: 2026-10-04 · ambiente: dev Next.js :3100 (bundle de desenvolvimento,
não-minificado) · dataset: seed Governador Valadares, 415 prestadores, 47
páginas de 9 · navegador Chromium via preview.

## O que é medido

Uma única entrada por navegação por clique:

- Nome: `vitrine:pagina:render`
- Início: o clique (`goPage` — pushState + `setPaginaState`)
- Fim: o commit em que os dados da PÁGINA ALVO assentam (não placeholder —
  placeholder é a página anterior ainda na tela)
- `detail`: `{ target, direction: "proxima"|"anterior", warm, inFlight }`
  - `warm` — havia dados em cache para o alvo no instante do clique
  - `inFlight` — havia fetch em voo para o alvo no clique (o render ainda
    assim espera o tail da rede; ex.: o focus-prefetch do botão dispara no
    `mousedown`, antes do `click`)

Onde está instrumentado: `src/components/vitrine/vitrine.tsx` — `navStartRef`
é aberto em `goPage` e fechado no effect de assentamento (logo após o effect
de prefetch). Envolvido em `try/catch`: User Timing é observabilidade e nunca
pode quebrar a navegação. O walk reverso do Anterior (deep-link sem âncora)
não passa por `goPage` — não gera medida (ver observação abaixo).

## Como reproduzir

```js
// No dev (:3100), com a vitrine aberta:
// 1) clicar Próxima/Anterior normalmente, então:
performance
  .getEntriesByType("measure")
  .filter((e) => e.name === "vitrine:pagina:render")
  .map((e) => ({ dur: Math.round(e.duration * 10) / 10, detail: e.detail }))
// As entradas também aparecem no DevTools → Performance → Timings.
```

## Baseline medido

| Regime                                            | detail                        | duração observada                                          | n   |
| ------------------------------------------------- | ----------------------------- | ---------------------------------------------------------- | --- |
| Cache quente, nada em voo                         | `warm: true, inFlight: false` | **42.7 – 119.9 ms** (mediana ≈ 110 ms)                     | 5   |
| Cache quente + fetch em voo no clique             | `warm: true, inFlight: true`  | ~204 ms observado (tail da rede; janela rara por design)   | 1   |
| Walk reverso (Anterior após deep-link sem âncora) | — (fora da instrumentação)    | ~1.1 s para 2 páginas (observação de sessão, não baseline) | 1   |

Por que o clique é quase sempre `warm`: o prefetch da página seguinte dispara
na chegada de cada página (e o hover/focus/touch revalida o cache vencido
antes do clique) — render de cache é o regime de projeto; a rede aparece como
tail (`inFlight`) ou na revalidação pós-clique em background.

## Limiar de regressão (sugestão)

Comparar SEMPRE em dev :3100, mesma seed, mediana de ≥ 3 cliques warm:

- mediana warm (`inFlight: false`) **> 250 ms** → investigar (o esperado é
  40–120 ms em dev; cada regime ganha custo de dev-bundle, então pioras
  relativas importam mais que absolutos)
- `inFlight: true` ou cold **> 800 ms** → investigar (o fetch de uma página
  em dev responde em ~15–25 ms server-side; o tail é client)

## Notas

- Números de DEV (React development, HMR, sem minificação) — servem para
  detectar regressões relativas, não para estimar produção.
- O buffer do User Timing é limitado pelo browser (entradas antigas caem
  fora); as medidas não são consumidas pelo app — só observabilidade.
- Mudança de filtro (`resetToFirstPage`) NÃO gera medida (não passa por
  `goPage` — é reset de estado, não navegação de paginação).
