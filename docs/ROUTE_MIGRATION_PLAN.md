# Plano de migração das rotas sem wrapper (withRoute/withParams)

> Análise rota a rota dos 48 arquivos de rota ainda com `export async function`
> (2026-10-01). Fonte do censo: guard `check:route-handler-style` + grep
> (`try {`, `handleError(`, `runtime =`). O conjunto exato de pares
> rota×handler com o padrão manual **try/catch + handleError** (o que a
> allowlist congela hoje) é o que o guard lista com `--list` (19 pares); esta
> análise cobre os 48 arquivos sem wrapper, inclusive os SEM try/catch, que
> são migração mecânica sem alteração de semântica de erro.

## Sumário

| Grupo                                   | Rotas (arquivos) | Esforço            | Extensão do wrapper               |
| --------------------------------------- | ---------------- | ------------------ | --------------------------------- |
| A. Mecânica (catch = handleError)       | 12               | baixo, rota a rota | não                               |
| B. Erro custom com status próprio       | 9                | baixo              | não (erros → throw)               |
| C. Degradação em vez de erro            | 7                | baixo              | não (throw → degradação)          |
| D. Erro com headers (rate limit)        | 2                | mínimo             | **sim — `handleError` já cobre**  |
| E. Fire-and-forget / side-effect        | 2                | baixo              | não                               |
| F. Monitor de infraestrutura            | 3                | médio              | **sim — `withRoute` com `fatal`** |
| G. Streaming / tiles / webhooks / graph | 8                | médio a alto       | **sim — segunda classe de span**  |
| H. Fora do escopo (mantêm export)       | 5                | —                  | não                               |

O destino dos 19 pares allowlistados hoje, após a migração completa: **13
saem da allowlist** (grupos A–E), **3 entram no grupo de degradação
deliberada** (novo contrato do wrapper) e **3 permanecem isentos** (grupos F/G).

---

## Grupo A — Mecânica (catch só chama handleError): 12 handlers

O handler termina com `} catch (e) { return handleError(e) }` e nada mais — a
conversão é literal e sem mudança de semântica. É o mesmo refactoring dos 142
já convertidos.

**Arquivos (por método):**

1. `calendar/feed/[token]` GET — o catch é handleError; a resposta 200 é ICS
   (`new NextResponse(icsContent)`), o que o wrapper já aceita.
2. `notifications` GET
3. `providers/[id]` GET
4. `push/payload/[id]` GET
5. `admin/settings` GET e POST
6. `availability` GET e POST
7. `availability/blocks` GET e POST
8. `search/providers` GET
9. `search/services` GET
10. `search` GET
11. `admin/push/webhooks/[id]` PATCH (o DELETE do mesmo arquivo já usa `withParams`)
12. `push/click` POST — confirmar que o `.catch(() => null)` do tracking
    fire-and-forget é interno ao try (é: degradação de side-effect, não do handler)

**Impacto na allowlist:** os 13 pares abaixo saem no mesmo commit da migração
(entrada ociosa é violação do guard, então allowlist e migração andam juntos):

```
src/app/api/calendar/feed/[token]/route.ts GET
src/app/api/notifications/route.ts GET
src/app/api/providers/[id]/route.ts GET
src/app/api/push/payload/[id]/route.ts GET
src/app/api/push/click/route.ts POST
src/app/api/availability/route.ts GET
src/app/api/availability/route.ts POST
src/app/api/availability/blocks/route.ts GET
src/app/api/availability/blocks/route.ts POST
src/app/api/search/providers/route.ts GET
src/app/api/search/services/route.ts GET
src/app/api/search/route.ts GET
src/app/api/admin/settings/route.ts GET
src/app/api/admin/settings/route.ts POST
```

_(14 pares — o guard conta pares; `push/click` entra na lista acima e os 19
menos estes 14 deixam 5 para os grupos F/G/H.)_

**Ordem sugerida (menor risco primeiro):** começar por `search*` (rotas de
leitura com cache public), depois `availability*`/`notifications`/`settings`
(escritas com Zod + rate limit, que continuam idênticas dentro do wrapper), e
`providers/[id]`/`push/payload/[id]`/`calendar/feed` por último (dinâmicas com
params, exercitam `withParams`).

## Grupo B — Erro custom com status próprio → convert to throw: 9 arquivos

O catch retorna resposta de erro com **status fixo e mensagem própria**. Como
`handleError` já mapeia `HttpError`/domain errors/Zod para status, o padrão
migra para **throw** e o wrapper faz o mapeamento — sem extensão do wrapper.

| Rota                                     | Hoje                                          | Depois                                              |
| ---------------------------------------- | --------------------------------------------- | --------------------------------------------------- |
| `search/fuzzy` GET                       | 500 `Search unavailable`                      | `throw new HttpError(503, ...)` ou 500 com mensagem |
| `metrics` GET                            | 500 `Metrics unavailable`                     | idem                                                |
| `admin/financial/export-csv` GET         | 500 + `{success:false,error}`                 | `throw new HttpError(500, ...)`                     |
| `admin/gtm/leads` GET/POST/PATCH/DELETE  | `{success:false,error}`                       | throw por método                                    |
| `users/notification-preferences` GET/PUT | 500 `Erro ao carregar/atualizar preferências` | throw com mensagem                                  |
| `provider/reports` GET                   | 500 `Erro ao gerar relatório`                 | throw                                               |
| `cron/settlements` GET                   | 500 `{error: msg}`                            | throw                                               |
| `cron/whatsapp-flows` GET/POST           | 500 `{error, details}`                        | throw (avaliar se `details` é usado)                |
| `geo/tiles/[z]/[x]/[y]` GET              | 500 `Failed to generate vector tile`          | throw                                               |

**Cuidado:** verificar consumidores do corpo `success:false` (o export-csv tem
frontend que lê o corpo? testes?). O corpo do erro muda de
`{success:false,error}` para `{error}`+`requestId` — changelog de API
necessário se houver cliente.

## Grupo C — Degradação deliberada (erro NÃO vira resposta de erro): 7 arquivos

O catch é o COMPORTAMENTO: falha parcial de sub-sistema vira 200 com payload
degradado. Converter para throw seria um bug (o "erro" do sub-sistema derrubaria
a resposta). Duas opções:

**C1 — converter mantendo degradação (throw só do que é fatal):** o handler
usa o wrapper e o catch do sub-sistema permanece DENTRO do corpo (catch interno
não é escaneado nem reprovado — o guard olha o handler). Aplicável a:
`admin/pgbouncer` (3 catchs de sondas), `health/detailed` (10), `health`
(9, nos checkers individuais), `health/extended` (3), `admin/analytics/demand`
(2 best-effort de cache), `admin/identity`/`auth/identity` (best-effort de
OCR/notificação), `users/notification-preferences` (catch interno de parse).

**C2 — extensão do wrapper (opção `degraded`):** se a equipe preferir declarar
a degradação em vez de catchs internos, uma opção nova no wrapper:

```ts
withRoute(name, handler, { degraded: (e) => NextResponse.json({...}, { status: 200 }) })
```

Recomendo **C1**: o wrapper continua com um contrato só, e o catch interno
continua legível no corpo. Extensão só se o padrão se repetir muito.

## Grupo D — Erro com headers (rate limit 429): 2 arquivos — NÃO precisa de extensão

`geo/reverse` e `geo/search` têm: `if (isGeoRateLimitError(e)) return
noStoreJson({...}, 429, e.headers)`. O `handleError` JÁ preserva headers de
`HttpError` (`new HttpError(429, msg, e.headers)` mapeia 429 + headers +
no-store). Se `isGeoRateLimitError` não for `HttpError` hoje, a migração é:
transformar o rate-limit error em `HttpError(429, e.message, e.headers)` na
fonte (lib de geo) e deixar o wrapper mapear. Verificar também `geo/cep`
(catch vira resposta `{data:{error}}` status 400 — degradação de contrato do
client; migrar com throw de HttpError(400) e ajustar o cliente).

## Grupo E — Fire-and-forget / beacon: 2 arquivos

- `web-vitals` POST: catch silently `return 200`. Com o wrapper: remover o try
  e deixar o handleError mapear — ou manter 200 silencioso com throw de
  `HttpError(200)`? **Recomendo: 200 incondicional** (beacon não pode falhar
  para o usuário) → o handler fica sem catch, e o "catch silencioso" vira
  política do corpo: `try { ... } catch { /* beacon */ }` interno. Grupo C1.
- `sentry` POST: catch `return 200` — envelope de erro não pode falhar (loop
  de telemetria). Mesma solução C1.

## Grupo F — Monitor de infra (health/metrics): 3 arquivos — extensão do wrapper

`health` (451 l, 9 catchs), `health/detailed` (742 l, 10), `health/extended`,
`metrics`, `metrics/prometheus`, `admin/alerts`, `admin/pgbouncer` — o corpo
é um agregador de sondas com degradação **por sub-sistema** e status agregado.
Necessidade real do wrapper: marcar span `ERROR` quando o agregado é
unhealthy **sem que a resposta seja de erro** (o monitor responde 200/503).

**Extensão proposta:**

```ts
withRoute(name, handler, { spanStatus: "auto" | "never-error" | (res) => SpanStatusCode })
```

Ou mais simples: uma função `markSpanError(span)` exportada do api-route que o
corpo chama quando o agregado fica unhealthy. Sem extensão de assinatura —
o span já chega no ctx do handler.

**Recomendo:** expor o span (JÁ acontece) + documentar o padrão
`span.setStatus(ERROR)` para agregadores. Zero extensão de assinatura; os 3
health migram com C1 + setStatus no agregado.

## Grupo G — Streaming / webhooks / graph: 8 arquivos — segunda classe de span

| Rota                         | Impedimento real                                                                  |
| ---------------------------- | --------------------------------------------------------------------------------- |
| `messages/stream` GET (SSE)  | `duration_ms` errado (o stream outlives o span), `status_code` = 200 do cabeçalho |
| `geo/tiles` GET              | ok pós-grupo B (resposta binária)                                                 |
| `webhooks/lytex` POST        | assinatura HMAC: catch precisa inspecionar o RAW body antes do `request.json()`   |
| `webhooks/evolution` POST    | 7 catchs de degradação por evento                                                 |
| `webhooks/sentry-alert` POST | assinatura + resposta vazia                                                       |
| `csp-report` GET             | AuthError → 403 custom; assinatura de formato                                     |
| `graphql` GET/POST           | wrapper Apollo/server próprio com try/catch interno                               |
| `admin/benchmarks` GET       | 798 l; telemetria fire-and-forget (catchs internos)                               |

**Extensão proposta para streaming:** `withRouteStream` (segunda função
exportada do api-route, não opção): idêntica ao withRoute, mas estampa os
atributos no INÍCIO (method/route/path/request_id) e **não** calcula
`duration_ms`/`status_code` no fim — quem fecha o stream seta à mão
(`span.setAttribute` no `close`/`cancel` do ReadableStream). Sem isso, o E2E
de streaming reportaria duração errada.

**Webhooks com assinatura:** o corpo (raw body + assinatura + evento) continua
idêntico; o handler só muda a borda (`export const POST = withRoute(...)`) e o
catch final desaparece (erros → throw → handleError; assinatura inválida →
`throw new HttpError(401)`). Os catchs INTERNOS de degradação por evento
permanecem (C1). `admin/benchmarks` idem (C1).

## Grupo H — Fora do escopo: 5 arquivos

| Rota                        | Motivo                                                                                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `route.ts` (raiz de /api)   | 7 linhas, sem try/catch — sem valor                                                                                                                     |
| `health/dashboard` GET      | 0 try/catch — já compatível; migração trivial ou "fora" por tautologia                                                                                  |
| `metrics/prometheus` GET    | 0 try/catch; formato Prometheus puro; migração trivial                                                                                                  |
| `graphql` GET/POST          | **fora de verdade**: server GraphQL tem pipeline de erro próprio; forçar o wrapper duplica tratamento                                                   |
| `cron/geo-health-alert` GET | `runtime = "nodejs"` + agregação de falhas parciais com auth de cron — pode migrar no lote C1 se o time quiser; isento por decisão, não por impedimento |

## Lotes propostos (cada lote = 1 PR + 1 roda da suíte)

1. **Lote 1 (grupos A, ~13 pares)**: mecânica. Allowlist encolhe no mesmo PR.
2. **Lote 2 (grupo B, 9 arquivos)**: throw + HttpError. Conferir consumidores
   de `{success:false}` antes (frontend/tests) — changelog de corpo de erro.
3. **Lote 3 (grupo C1, ~9 arquivos)**: degradação com catch interno; allowlist
   perde os pares que restavam (`geo/search`, `admin/benchmarks`).
4. **Lote 4 (grupo F, health/metrics/admin-alerts)**: C1 + `span.setStatus`
   no agregado unhealthy; permitir `503` real no health se for o desenho.
5. **Lote 5 (grupo G)**: `withRouteStream` para `messages/stream`; webhooks
   (lytex/evolution/sentry-alert/csp-report) com C1 + throw de HttpError na
   assinatura; graphql fica fora (H).
6. **Lote 6 (grupo D+E, o que sobrar)**: geo (HttpError com headers na fonte)
   e beacons (C1). Allowlist termina com ZERO entradas ou com as que o time
   decidir manter como "custom intencional de verdade".

## Contratos que o wrapper NÃO precisa ganhar

- **catch custom na assinatura** (`catch: (e) => Response`) — seria o padrão
  manual de volta, agora com bênção do tipo; o grupo B resolve com throw, o C
  com catch interno. Recusar.
- **`withRoute` com `runtime`/`dynamic`** — já é responsabilidade do arquivo
  (`export const runtime = ...`), não do handler.
- **opção `degraded`** (C2) — só se o C1 provar repetição dolorosa.

## Métrica de sucesso

- `node scripts/check-route-handler-style.mjs --list` → vazio (ou só os pares
  de "custom intencional de verdade", cada um com addedAt < 180 dias).
- `grep -rl "handleError(" src/app/api --include=route.ts` → 0 arquivos.
- Suíte completa verde; corpos de erro de API estáveis (grupo B é o único que
  muda corpo de resposta — changelog).
