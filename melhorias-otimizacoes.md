# Análise de Melhorias e Otimizações — Severinno Marketplace

> Data: 22/07/2026 | Stack: Next.js 16 + Prisma + SQLite/PostGIS + Tailwind v4 + shadcn/ui

---

## Resumo Executivo

O projeto tem **arquitetura sólida** e boa engenharia. As recomendações abaixo estão organizadas por criticidade e camada.

---

## 🔴 CRÍTICAS (Impacto Imediato)

### 1. Provider Listing sem Paginação no DB

**Onde:** `src/app/api/providers/route.ts:41`
**Problema:** Busca TODOS os providers do DB e faz filtro/ordenação/paginação em memória.
**Risco:** Com 1000+ providers, cada request consome memória e CPU linearmente. O `haversineKm` roda em JS para cada item.
**Solução:** Migrar para paginação via Prisma (`skip`/`take`) + filtrar por distância no DB (PostGIS `ST_DWithin`).

### 2. Middleware Fail-Open

**Onde:** `src/middleware.ts:124`
**Problema:** Se `SESSION_SECRET` não está definida, o middleware passa todas as requisições sem autenticação.
**Solução:** Falhar com 500 em produção se a chave estiver ausente.

### 3. Redis Indisponível

**Onde:** `dev.out.log` — `ECONNREFUSED 127.0.0.1:6379`
**Problema:** Redis não está rodando. Toda chamada a `cacheGet`/`cacheSet` adiciona ~3s de latência (timeout de conexão) antes de cair no fallback silencioso.
**Solução:** Subir Valkey/Redis via Docker Compose. Ou tratar o erro com timeout mais agressivo.

### 4. Schema Drift: `Booking.reminderSentAt`

**Onde:** `dev.out.log` — `PrismaClientKnownRequestError`
**Problema:** Coluna `reminderSentAt` referenciada no código mas ausente no schema Prisma.
**Solução:** Rodar `prisma db push` ou criar migration para sincronizar schema.

---

## 🟡 PRIORIDADE ALTA

### 5. `"use client"` em Massa

**Onde:** 23/24 componentes `vitrine/` + muitos outros (~100 ao total)
**Problema:** Componentes puramente de apresentação (Footer, Hero, CategoryShowcase, HowItWorks) são marcados como client, perdendo SSR e aumentando o bundle JS inicial.
**Impacto:** LCP maior, mais JS para processar no cliente.
**Solução:** Separar `"use client"` apenas onde há interatividade (hooks, event handlers, estado). O resto pode ser Server Component.
**Esforço:** Médio (refatoração gradual).

### 6. `next/image` Não Utilizado

**Onde:** Todas as imagens usam `<img>` nativo
**Problema:** Perde otimizações automáticas: lazy loading nativo, srcset responsivo, conversão AVIF/WebP, blur placeholder.
**Impacto:** LCP e CLS piores. Next.config já configurado para formatos modernos (avif, webp) — mas nunca usados.
**Solução:** Substituir `<img>` por `next/image` em imagens críticas (hero, provider cards). Usar `next/legacy/image` onde houver restrições de layout.

### 7. API Routes sem Cache

**Onde:** `src/lib/api.ts:146` — `cache: "no-store"` em TODAS as requisições
**Problema:** Nenhum cache HTTP em endpoints públicos (categorias, providers list, etc).
**Solução:** Usar `stale-while-revalidate` em endpoints públicos. Ex: `Cache-Control: public, s-maxage=60, stale-while-revalidate=300`.

### 8. OpenSearch Fora de Sincronia

**Onde:** `src/lib/search.ts`
**Problema:** O índice OpenSearch nunca é atualizado nas mutations (criar/editar provider, serviço, categoria). Precisa de script manual (`db:search:refresh`).
**Solução:** Disparar reindexação nos webhooks/eventos das mutations, ou usar fila RabbitMQ para atualização assíncrona.

### 9. Barrel File `@/store` Impede Tree-Shaking

**Onde:** `src/store/index.ts`
**Problema:** Importar de `@/store` puxa TODAS as stores (auth, geo, view, ui, compare, recently-viewed) mesmo usando apenas uma.
**Impacto:** Bundle maior que o necessário.
**Solução:** Importar diretamente: `@/store/auth` em vez de `@/store`.

---

## 🟢 PRIORIDADE MÉDIA

### 10. Duplicação Soft-Delete em `db.ts`

**Onde:** `src/lib/db.ts:30-108`
**Problema:** 7 métodos com o mesmo padrão de adicionar `deletedAt: null` ao `where`. ~50 linhas duplicadas.
**Solução:** Extrair HOF (Higher-Order Function) que envolve o `where` automaticamente.

### 11. Fetch Duplicado no Auth Store

**Onde:** `src/store/auth.ts:58,87` vs `src/lib/api.ts`
**Problema:** `login`/`register` usam `fetch` bruto em vez do `apiPost` tipado, duplicando lógica de erro.
**Risco:** Erros não-JSON podem crashar o parse.
**Solução:** Usar `apiPost` do `@/lib/api`.

### 12. Error Matching por String Mágica

**Onde:** `src/lib/api-server.ts:84`
**Problema:** `Error.message === "UNAUTHORIZED"` — frágil, qualquer mudança na mensagem quebra.
**Solução:** Usar `instanceof HttpError` ou comparar por propriedade `cause`/`code`.

### 13. Sem Error Boundaries no Dashboard/Panels

**Onde:** `src/app/page.tsx` (vitrine + panels)
**Problema:** Se um panel (ex: provider-dashboard) lança erro, a UI inteira fica em branco.
**Solução:** Envolver cada panel em `<ErrorBoundary>` com fallback UI.

### 14. Bundle Analyzer Nunca Rodado

**Onde:** `package.json:28` — configurado mas nunca executado
**Problema:** Não há visibilidade do tamanho real do bundle.
**Solução:** Rodar `ANALYZE=true bun run build` e agir sobre os maiores chunks.

### 15. ESLint Totalmente Desabilitado

**Onde:** `eslint.config.mjs`
**Problema:** Todas as regras setadas para `"off"`. Zero guardrails de qualidade.
**Solução:** Reativar regras gradativamente: `@typescript-eslint/no-unused-vars`, `react-hooks/exhaustive-deps`, `no-console`, `prefer-const` como pontos de partida.

---

## ⚪ PRIORIDADE BAIXA / FUTURO

### 16. Cache-Control Ausente nas APIs Públicas

Endpoints como `/api/categories`, `/api/providers` (leituras) deveriam ter headers de cache.

### 17. `globals.css` Muito Grande (365 linhas)

Extrair animações/keyframes para arquivo separado reduz o CSS crítico.

### 18. Store UI Única para Modal + Sidebar

Separar em `modal-store.ts` e `sidebar-store.ts` melhora tree-shaking e coesão.

### 19. useTilt com Listener por Card

Provider-card.tsx adiciona mousemove listener por card. Em grids grandes (>20), considerar virtualização ou desligar em mobile.

### 20. Testes de Unidade ainda Limitados

16 arquivos de teste em `src/lib/__tests__/`. Cobertura de componentes próxima de zero. Expandir cobertura gradualmente.

---

## 📊 Métricas Atuais

| Métrica             | Status                 | Meta                    |
| ------------------- | ---------------------- | ----------------------- |
| LCP                 | < 4.5s (Lighthouse CI) | < 2.5s                  |
| CLS                 | < 0.25 (Lighthouse CI) | < 0.1                   |
| Bundle Analyzer     | Nunca rodado           | Rodar semanalmente      |
| Cobertura de Testes | ~5%                    | > 60% (alvo Fase 2)     |
| ESLint              | 0 regras ativas        | Reativar gradativamente |
| next/image          | 0 ocorrências          | 100% das imagens        |
| Redis               | Off (ECONNREFUSED)     | Running                 |
| OpenSearch Sync     | Manual                 | Automático via eventos  |

---

## 🎯 Ações Imediatas Recomendadas (Top 5)

| #   | Ação                                        | Esforço | Impacto                             |
| --- | ------------------------------------------- | ------- | ----------------------------------- |
| 1   | Subir Redis (Valkey) via Docker             | 5 min   | Latência de cache em todas as rotas |
| 2   | Rodar `prisma db push` para sync schema     | 2 min   | Bug de schema drift resolvido       |
| 3   | Middleware fail-closed para SESSION_SECRET  | 15 min  | Segurança crítica                   |
| 4   | Remover barrel `@/store` → imports diretos  | 30 min  | Bundle menor                        |
| 5   | Substituir `<img>` por `next/image` no Hero | 1h      | LCP improvement                     |

---

## Observações Positivas

- ✅ Arquitetura modular (monolito organizado por domínio)
- ✅ Validação de env vars com Zod (`env.ts`)
- ✅ Logger Pino com redação de dados sensíveis
- ✅ HMAC-SHA256 para sessão com Redis cache
- ✅ Rate limiting infrastructure ready (Valkey)
- ✅ Testes co-localizados (Vitest junto ao código)
- ✅ Docker multi-stage com non-root user
- ✅ CSP headers no Next.js config
- ✅ Geolocalização com PostGIS + OSRM self-hosted
- ✅ OpenSearch + índice full-text em português
