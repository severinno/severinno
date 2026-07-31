# Baseline de Cobertura — Camada Admin

> **Data**: 2026-07-31 · **Vitest** 3.1.1 · **Provider**: v8
> **Objetivo**: baseline de qualidade antes de novas refatorações. Todo número abaixo foi
> capturado com `--coverage.all=true` scoped ao diretório alvo (inclui arquivos com 0% de
> cobertura — a leitura honesta do estado).

---

## 1. Resumo executivo

| Camada                                     | Arquivos de teste |  Testes |   Status   | Cobertura Stmts |
| :----------------------------------------- | ----------------: | ------: | :--------: | --------------: |
| Componentes admin (snapshot + interaction) |                13 |     156 | ✅ 156/156 |      **14,18%** |
| Rotas API admin                            |                 9 |      75 |  ✅ 75/75  |      **28,27%** |
| **Total camada admin**                     |            **22** | **231** | ✅ 231/231 |               — |

> ⚠️ Os percentuais baixos **não** indicam teste ruim — são o efeito de `all=true` contando
> as ~28 páginas de dashboard e ~40 rotas admin que ainda **não têm teste algum** (0%).
> A cobertura dos componentes/rotas _efetivamente testados_ é alta (ver seções 3 e 5).
>
> 📌 **Nota conhecida**: o run de coverage dos componentes emitiu muitos warnings
> `"An update to Root inside a test was not wrapped in act(...)"` (gist-selectivity-section,
> gist-degradation-panel, radius-density-selector). São pré-existentes, não-bloqueantes
> (testes passam), mas indicam uma lacuna de qualidade de teste — alguns renders/fireEvents
> não estão embrulhados em `act()`. Vale tratar como débito separado.

---

## 2. Testes pré-existentes quebrados — corrigidos nesta baseline

A varredura revelou **48 testes quebrados por um bug de mock** (chaining
`)(vi.mocked(...)` que a ASI interpreta como chamada de função → `mockResolvedValue is not a
function`). Mesma classe de bug já atacada no commit `f604b77`, mas que persistia nestes
arquivos. **Todos corrigidos** com split em statements separados (prefixo `;`):

| Arquivo                                                                   | Testes quebrados | Testes agora |
| :------------------------------------------------------------------------ | ---------------: | -----------: |
| `src/app/api/__tests__/auth-route.test.ts`                                |                8 |           ✅ |
| `src/app/api/__tests__/bookings-route.test.ts`                            |                4 |           ✅ |
| `src/app/api/__tests__/providers-route.test.ts`                           |                9 |           ✅ |
| `src/app/api/__tests__/providers-radius-expansion.test.ts`                |               12 |           ✅ |
| `src/app/api/__tests__/webhooks-lytex-route.test.ts`                      |                5 |           ✅ |
| `src/app/api/__tests__/admin-settlements-route.test.ts`                   |                6 |           ✅ |
| `src/app/api/__tests__/admin-finance-provider-transactions-route.test.ts` |                4 |           ✅ |
| **Total**                                                                 |           **48** | **✅ 48/48** |

Verificação: `grep -rln "as any)(vi.mocked" src` → **0 resultados** após a correção.

---

## 3. Componentes admin — cobertura por arquivo (13 testes, 156 tests)

Comando: `vitest run src/components/admin/__tests__ --coverage --coverage.include="src/components/admin/**" --coverage.all=true`

### 3.1 Componentes testados (linhas cobertas > 0%)

| Componente                     | % Stmts | % Branch | % Funcs | % Lines |
| :----------------------------- | ------: | -------: | ------: | ------: |
| `_shared.ts` (barrel interno)  |     100 |      100 |     100 |     100 |
| `admin-chart-theme.ts`         |     100 |      100 |     100 |     100 |
| `gist-degradation-panel.tsx`   |     100 |      100 |     100 |     100 |
| `gist-reindex-button.tsx`      |     100 |    92,00 |     100 |     100 |
| `indicador-de-atualizacao.tsx` |     100 |      100 |     100 |     100 |
| `radius-density-selector.tsx`  |     100 |      100 |     100 |     100 |
| `admin-gateway-dashboard.tsx`  |     100 |    77,14 |   45,45 |     100 |
| `admin-refresh-button.tsx`     |     100 |    33,33 |     100 |     100 |
| `benchmark-section.tsx`        |   94,06 |    95,65 |   22,22 |   94,06 |
| `admin-finance.tsx`            |   74,88 |    61,19 |   43,33 |   74,88 |
| `gist-selectivity-section.tsx` |   61,88 |    66,66 |   28,57 |   61,88 |
| `admin-dashboard.tsx`          |   52,25 |    59,25 |   40,00 |   52,25 |
| `admin-metric-card.tsx`        |   44,11 |      100 |   50,00 |   44,11 |
| `admin-shared.tsx`             |   10,91 |    50,00 |    6,89 |   10,91 |
| `admin-tier-banner.tsx`        |   10,71 |      100 |       0 |   10,71 |
| `geo-latency-bar.tsx`          |   13,33 |      100 |       0 |   13,33 |
| `geo-skeleton.tsx`             |    9,09 |      100 |       0 |    9,09 |
| `admin-dashboard-header.tsx`   |    7,14 |      100 |       0 |    7,14 |
| `timeline-section.tsx`         |    4,11 |      100 |       0 |    4,11 |

### 3.2 Componentes com 0% (sem teste — maior oportunidade)

**28 páginas de dashboard** sem nenhum teste direto (todas `0%` stmts):
`admin-benchmark-dashboard`, `admin-benchmark-evolution`, `admin-bookings`,
`admin-commissions`, `admin-coverage-map`, `admin-errors`, `admin-gateway`,
`admin-geo-cache-dashboard`, `admin-geo-metrics-dashboard` (só via leaves),
`admin-geo-rate-limit-status`, `admin-geo-snapshots-chart`, `admin-health`,
`admin-metrics`, `admin-panel`, `admin-performance`, `admin-pgbouncer`,
`admin-project-status`, `admin-providers`, `admin-push*` (6 páginas), `admin-redis-diagnostics`,
`admin-services`, `admin-settings`, `admin-settlements`, `admin-taxonomy`,
`admin-users`, `admin-webhook-audit`.

> **Nota**: `admin-geo-metrics-dashboard` tem cobertura indireta via leaves extraídos
> (BenchmarkSection, TimelineSection, GiSTSelectivitySection, GistDegradationPanel,
> RadiusDensitySelector — todos na seção 3.1). As páginas cobertas por testes E2E
> (Playwright) não aparecem aqui (fora do escopo vitest).

---

## 4. Rotas API admin — cobertura por endpoint (9 testes, 75 tests)

Comando: `vitest run src/app/api/__tests__/admin-*-route.test.ts --coverage --coverage.include="src/app/api/admin/**" --coverage.all=true`

### 4.1 Rotas testadas

| Rota                                  | % Stmts | % Branch | % Funcs | % Lines |
| :------------------------------------ | ------: | -------: | ------: | ------: |
| `admin/gateway/invoices`              |     100 |    70,58 |     100 |     100 |
| `admin/commissions`                   |   98,01 |    89,47 |     100 |   98,01 |
| `admin/gateway/stats`                 |   96,82 |    75,00 |     100 |   96,82 |
| `admin/finance`                       |   95,70 |    73,33 |     100 |   95,70 |
| `admin/finance/export`                |   95,58 |    59,37 |     100 |   95,58 |
| `admin/finance/provider-transactions` |     ~95 |        — |     100 |     ~95 |
| `admin/settlements` (rota principal)  |   ~95,5 |        — |     100 |   ~95,5 |

### 4.2 Rotas com 0% (sem teste)

`bookings` (?), `payments/*`, `push/*` (analytics, audit, history, metrics, recurring,
schedule, send, users, webhooks), `pgbouncer`, `redis-diagnostics`, `services`,
`settings`, `settlements/[id]/*` (parciais), `stats`, `users/*`, `webhooks/*`.

---

## 5. Como reproduzir

```bash
# Componentes admin (13 arquivos, 156 testes)
npx vitest run src/components/admin/__tests__ --coverage \
  --coverage.include="src/components/admin/**" --coverage.all=true

# Rotas API admin (9 arquivos, 75 testes)
npx vitest run src/app/api/__tests__/admin-commissions-route.test.ts \
  src/app/api/__tests__/admin-commissions-export-route.test.ts \
  src/app/api/__tests__/admin-finance-route.test.ts \
  src/app/api/__tests__/admin-finance-export-route.test.ts \
  src/app/api/__tests__/admin-finance-provider-transactions-route.test.ts \
  src/app/api/__tests__/admin-finance-export-providers-route.test.ts \
  src/app/api/__tests__/admin-gateway-invoices-route.test.ts \
  src/app/api/__tests__/admin-gateway-stats-route.test.ts \
  src/app/api/__tests__/admin-settlements-route.test.ts --coverage \
  --coverage.include="src/app/api/admin/**" --coverage.all=true
```

---

## 6. Próximos passos recomendados (por ROI)

1. **🔴 Páginas admin com lógica de negócio real** sem teste: `admin-providers.tsx`
   (filtros de usuário/prestador), `admin-services.tsx` (CRUD), `admin-users.tsx` (gestão).
   Estas têm mais código condicional que os dashboards de métricas.
2. **🟡 Rotas de escrita** sem teste: `settlements/[id]/finalize`,
   `settlements/[id]/pay/[providerId]` (cobertas indiretamente pelo settlements-route.test
   que importa os 4 handlers), `users/*`, `push/send`.
3. **🟢 Guard de CI**: adicionar um `check:admin-coverage` que falha se `all=true` cair
   abaixo de um threshold por camada — evita regressão silenciosa da baseline.
