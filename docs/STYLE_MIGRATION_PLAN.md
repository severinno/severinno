# Plano de migração dos atributos `style={{}}` → CSS (eliminação do `style-src-attr 'unsafe-inline'`)

> Análise caso a caso dos **102** atributos `style={{}}` em `src/**/*.tsx`
> (censo de 2026-10-02: `grep -rn "style={{" src --include="*.tsx" | wc -l` —
> o número correto, não os ~107 estimados antes de medir). A fonte da verdade
> numérica passa a ser o censo do guard `check:inline-style` (§Guard), que
> conta os atributos por arquivo e reprova crescimento fora da allowlist.
>
> Objetivo: zerar os atributos sujeitos à CSP do browser e remover a diretiva
> `style-src-attr 'unsafe-inline'` de `src/lib/csp.ts` — hoje a única
> tolerância a CSS inline que resta na política (o `<style>` de elemento já é
> pinado por hash e vigiado pelo guard).

## Por que a via é possível (o que a CSP bloqueia e o que não bloqueia)

`style-src-attr` rege **apenas o atributo** `style="..."` no HTML. NÃO passam
por ele (e são, portanto, caminhos legítimos):

1. **Classes/Tailwind** — a via preferida; Tailwind v4 já é a base do projeto
   e _arbitrary values/properties_ (`[animation:...]`, `w-[63%]`) já estão em
   uso (`opacity-[0.06]` etc.).
2. **CSS custom-properties em classes** — a classe carrega
   `width: var(--bar-pct, 0%)` e o valor dinâmico entra por… onde? Se a
   resposta for "atributo style", não migrou nada. As duas entradas reais:
   **atributos de dados + seletor de valor discreto** (§Grupo B) ou **CSSOM**
   (§Grupo C).
3. **CSSOM** (`el.style.setProperty(...)` / `el.style.cssText`) — já é
   prática da casa nos overlays de mapa (`components/map/helpers.ts`,
   `AnimatedProviderPin.tsx`, `providers-map.tsx`): manipulação de estilo
   depois da inserção não é "CSS inline no HTML" e a CSP não bloqueia.
4. **Fora do browser** — Satori/ImageResponse (`opengraph-image.tsx`) renderiza
   PNG no servidor; a CSP do browser não se aplica.

⚠️ Um `style={{ '--x': v }}` (custom property POR ATRIBUTO) continua sendo
atributo — a CSP bloqueia igual. "Migrar para custom-properties" só fecha a
conta se o valor entrar por data-attr (B) ou CSSOM (C).

## Sumário

| Grupo                         | Atributos | Técnica                           | Esforço | Risco  |
| ----------------------------- | --------- | --------------------------------- | ------- | ------ |
| A. Estático → Tailwind        | ~20       | `[animation:...]`, durações fixas | baixo   | mínimo |
| B. Discreto → data-attr + CSS | ~12       | `data-*` + regra em globals.css   | baixo   | mínimo |
| C. Contínuo → nativo/CSSOM    | ~67       | `width` nativo ou `setProperty`   | médio   | baixo  |
| D. Fora da CSP (isento)       | 3         | — (documentar na allowlist)       | —       | —      |

## Grupo A — Estático: Tailwind arbitrary properties (~20)

`animation` fixa com `both`/delays escalonados. O padrão é o stagger dos
loadings — a classe já existe no elemento; o estilo vira classe.

1. `src/app/loading.tsx` (10) — `style={{ animation: "fadeIn 0.4s 0.3s both" }}`
   → `[animation:fadeIn_0.4s_0.3s_both]` (underscores = espaços no Tailwind v4).
   Padronizar os 10 delays num utilitário `@utility` do globals.css
   (`anim-fade-in-delay-*`) se a repetição incomodar — não é obrigatório.
2. `src/app/{u/[slug],busca,categoria/[slug],categoria/[slug]/[child]}/loading.tsx` (7) — mesma mecânica.
3. `src/components/vitrine/hero.tsx` (3 de 4) — `animationDuration: "6s"` sobre
   `animate-pulse` → `[animation-duration:6s]` (o resto do blob já é classe).
4. `partners-trust`/`provider-spotlight` estáticos idem.

**Commit único** (só className/JSX, zero runtime). Regressão visual: screenshot
das rotas de loading.

## Grupo B — Discreto: data-attr + regra CSS (~12)

Valores fixos por chamada, mas semânticos — viram **um** seletor cada no
`globals.css`, com custom-property default para o futuro:

- `backgroundColor: COLORS.miss` / `COLORS.hit` (4: dashboards admin) →
  `data-fill="miss|hit"` + `.bar[data-fill="miss"] { background: var(--miss) }`.
- `minWidth: 120` (3) → `data-minwidth="120"` (ou classe dedicada se o valor
  for único de verdade).
- `touchAction: "pan-x pan-y pinch-zoom"` (1) → classe `.gesture-pan`.
- `"--sidebar-width": "16.25rem"` (1) → propriedade estática no wrapper:
  mover para classe `.layout-sidebar { --sidebar-width: 16.25rem }`.
- `gap: 2`/`width/height: size` do `star-rating` com `size` CONSTANTE na
  chamada → se o prop variar entre instâncias, é do Grupo C; se fixo, classe.

## Grupo C — Contínuo: atributo nativo ou CSSOM (~67)

A classe dominante: barras de progresso (`width: ${pct}%` — 4 em
admin-push-metrics, 5 em admin-health, e dezenas de dashboards) e
dimensionamento por prop. Duas vias, nesta ordem de preferência:

**C1. Atributo HTML nativo (maioria das barras):** `<div className="h-1.5 …"
style={{ width: pct% }} />` é, na prática, uma barra de progresso → trocar o
div por elemento com `role="progressbar"` (acessibilidade de brinde) e
**atributo** `aria-valuenow={pct}`… não move o width. A via que move: o
**width por CSSOM no mount** (C2) ou — mais simples e sem JS — manter o div e
usar **CSSOM do próprio componente**: como a esmagadora maioria dos arquivos
deste grupo é `"use client"`, um helper de 6 linhas cobre todos:

```ts
// src/lib/style-vars.ts — CSP-safe: custom-property via CSSOM (não via atributo)
export function setStyleVars(el: HTMLElement | null, vars: Record<string, string>) {
  if (!el) return
  for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v)
}
```

Uso: `<div ref={(el) => setStyleVars(el, { "--bar-pct": `${pct}%` })}
  className="bar-fill" />` com `.bar-fill { width: var(--bar-pct, 0%) }` no
globals.css. Atributo zero, CSP zero, SSR-renderiza 0% e hidrata no mount
(aceitável para dashboards admin; ver riscos).

**C2. Alternativa sem ref para barras puras:** componente `<Bar pct={63} />`
que cria o elemento imperativamente com `cssText` (o padrão dos overlays de
mapa da casa). Mais código por instância; usar só onde ref atrapalhe
(server components de vitrine, ex. `provider-spotlight`).

**Distribuição (arquivos com 2+):** admin-push-metrics (6), admin-health (5),
admin-geo-cache-dashboard (4), admin-redis-diagnostics (3),
admin-project-status (3), admin-geo-rate-limit-status (3),
admin-gateway-dashboard (3), admin-benchmark-dashboard (3),
geo-latency-bar (2), gist-selectivity-section (2), step-wizard (2),
quick-quote-calculator (2) + caudas de 1 (map, hero gradient, star-rating
`pct`, clamped widths de admin-shared/partners-section/enhanced-providers-map,
transform de slider). Todos client exceto os de vitrine estáticos.

## Grupo D — Isentos com justificativa (3)

`src/app/opengraph-image.tsx` — Satori/ImageResponse: PNG gerado no servidor,
sem browser, sem CSP. Entra na **allowlist do guard** (mesmo formato
`{path, reason, addedAt}`), não no plano de migração.

## Guard: o censo vira invariante

Estender `scripts/check-inline-style.mjs` (mesma máquina de estados, mesmos
importes — zero deps) com `checkStyleAttributes(rel, content)`:

- casa `style={{` (e `style={` com template) em .tsx, com a mesma allowlist
  mecanismada por tipo: `attrsAllowed` (opengraph-image) e exclusão de
  `__tests__`/vendados permitidos um a um;
- **violação = atributo fora da allowlist** — o número não pode mais crescer;
- modo `--census`: imprime contagem por arquivo; o total (102 → meta 0 + 3
  isentos) fica PINADO no GUARDS.md — queda não quebra ninguém, crescimento
  reprova;
- mutation test: acrescentar `style={{ top: 0 }}` num .tsx qualquer tem que
  virar exit 1 (mesma matriz `test-mutation-guards.sh` do `<style>`).

## Rollout da CSP (a última etapa, reversível)

1. **Semanas 1–2:** Grupos A+B (estáticos, zero runtime) + guard com censo.
2. **Semanas 3–4:** Grupo C em dois lotes — (a) dashboards admin (12 arquivos,
   ~45 atributos; mesma técnica repetida, ref+helper), (b) vitrine/modais
   (~22; atenção aos server components → C2). Cada lote: screenshot diff dos
   dashboards tocados.
3. **Observação (1 semana):** em `csp.ts`, `style-src-attr` vira
   `'self'` (tira o `'unsafe-inline'`) mas com a CSP inteira em
   `Report-Only` — o backend `/api/csp-report` (já existe, com report-uri
   configurado) acumula violações reais; o campo `styleSummary` do painel
   separa `attr` (dívida desta migração — top documentos apontam as páginas
   a migrar) de `elem` (defeito imediato). Bibliotecas (Leaflet e cia) que
   fizerem `setAttribute("style", …)` por baixo aparecem AQUI, não na
   produção.
4. **Corte:** zero violações novas por 7 dias → CSP volta a enforce SEM
   `style-src-attr` (a diretiva sai inteira; herda de `style-src`, que não
   tem unsafe-inline). Rollback: re-adicionar a diretiva em um commit.
5. **Fecho:** atualizar o comentário de exceções do `csp.ts` (a exceção deixa
   de existir), a allowlist do guard (só opengraph) e a seção 38 do GUARDS.md.

## Riscos e mitigação

- **FOUC de barra (C1 no server):** dashboards admin são dados carregados
  client-side — barra nasce 0% e hidrata; visualmente indistinguível do
  estado de loading. Para as 2 barras de vitrine renderizadas no SSR, usar C2
  (imperativo) ou aceitar o flash medido no screenshot diff.
- **Regressão silenciosa via vendador:** componente shadcn novo com
  `style={{}}` embutido → o guard pega no censo (allowlist explícita ou
  migração antes do merge).
- **Terceiros que escrevem atributo style:** janela de Report-Only da etapa 3
  existe exatamente para isso; Leaflet já usa cssText (CSSOM) nos caminhos
  que o repo usa hoje (overlays próprios em helpers.ts).
