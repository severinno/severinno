# Plano: Elevar Camada de Testes de 7.5 → 10/10

## Diagnóstico Atual

| Métrica | Valor |
|:--------|:-----:|
| Arquivos de teste unitário | 140 |
| Arquivos com falha | **3** |
| Testes falhando | **~40** |
| Arquivos sem teste (novos) | ~12 |
| E2E push tests existentes | 32 (seções 1–7) |

## Fase 1 — Corrigir as 3 Falhas Atuais (~40 testes)

### 1.1 `preference-toggles.test.tsx` (27 falhas)

**Problema:** O componente `PreferenceToggles` renderiza ícones do `lucide-react` (`Volume2`, `Vibrate`, etc.), mas o teste não faz `vi.mock("lucide-react")`. Os 27 testes quebram porque `render` lança exceção ao encontrar os ícones reais no jsdom.

**Solução:** Adicionar no topo do arquivo (após os mocks existentes):
```ts
vi.mock("lucide-react", () => ({
  Volume2: () => <svg data-testid="icon-volume" />,
  Vibrate: () => <svg data-testid="icon-vibrate" />,
}))
```
Estimar: **+5 linhas, 27 testes corrigidos**

### 1.2 `admin-finance.test.tsx` (8 falhas)

**Problema:** O componente `AdminFinanceDashboard` usa ícones do `lucide-react` e hooks de real-time que não estão mockados. 8 testes quebram por render exceptions.

**Solução:** Adicionar mock de `lucide-react` no bloco de mocks existente:
```ts
vi.mock("lucide-react", () => ({
  ArrowDown: () => <svg />,
  ArrowUp: () => <svg />,
  Banknote: () => <svg />,
  // ... todos os ícones usados no admin-finance.tsx
}))
```
Estimar: **+15 linhas, 8 testes corrigidos**

### 1.3 `client-finance.test.tsx` (5 falhas)

**Problema:** `Error: [vitest] No "Wallet" export is defined on the "lucide-react" mock.` — o mock de lucide-react está ausente, e o componente `ClientFinance` importa `Wallet` e outros.

**Solução:** Adicionar mock de `lucide-react` (similar ao admin-finance, porém com os ícones usados pelo client-finance).

Estimar: **+12 linhas, 5 testes corrigidos**

## Fase 2 — Adicionar Testes para os Módulos Novos sem Cobertura

### 2.1 `admin-gateway-dashboard.test.tsx` (NOVO)

**Componentes:** `AdminGatewayDashboard` (~766 linhas)
**Padrão:** Seguir o mesmo padrão de `admin-finance.test.tsx` (mock do useQuery + Recharts + lucide-react)
**Testes:**
- Loading: skeleton visível
- Error: ErrorState com retry
- Data: cards de resumo, seletor de período, títulos dos charts, tabela de detalhamento
- Acessibilidade axe-core

Estimar: **~80 linhas, 8 testes**

### 2.2 `admin-gateway-stats-route.test.ts` (NOVO)

**Rota:** `src/app/api/admin/gateway/stats/route.ts` (~259 linhas)
**Padrão:** Mockar fetch global, testar agregação de métricas
**Testes:**
- 401 sem autenticação ADMIN
- Agregação com invoices mockadas (3 status diferentes)
- Filtro por período (7d, 30d, all)
- Conversão rate com dados parciais (50% paid, 50% waiting)
- Edge case: lista vazia retorna zeros

Estimar: **~100 linhas, 5 testes**

### 2.3 Módulos de Push sem Testes Unitários

| Módulo | Prioridade | Sugestão |
|:-------|:----------:|:---------|
| `src/lib/push-store.ts` | Alta | Testar getPayload, setPayload com Redis mock |
| `src/lib/push-monitor.ts` | Alta | Testar trackDelivery, getMetrics |
| `src/lib/event-hub.ts` | Média | Já tem `event-hub.test.ts` — verificar cobertura |
| `src/lib/performance.ts` | Média | Já tem `performance.test.ts` — verificar cobertura |
| `src/lib/health-monitor.ts` | Baixa | Testar checkService, aggregate |

Estimar: **~200 linhas no total, 15–20 testes**

## Fase 3 — Completar Cobertura E2E de Push

### 3.1 Já existe (32 testes em `e2e/push-notification.spec.ts`)

| Seção | Cobertura |
|:------|:----------|
| 1. Subscribe (6) | ✅ subscribe, unsubscribe, duplicate, API |
| 2. Service Worker (4) | ✅ install, activate, message, push event |
| 3. API Push Test (5) | ✅ auth, payload validation, send |
| 4. Fluxo completo (2) | ✅ subscribe → send → click |
| 5. Admin Send (9) | ✅ auth, validation, happy path |
| 6. Cron push-scheduled (3) | ✅ auth, execução |
| 7. Cron scheduled-push (3) | ✅ auth, execução |

### 3.2 Testes Faltando para E2E

| Fluxo | Prioridade | Descrição |
|:------|:----------:|:----------|
| Provider aceita booking via push | Média | Clicar "Aceitar" na notificação → booking confirmado |
| Push recorrente dispara no horário | Média | Agendar push recorrente, verificar execução via API |
| Payload > 4KB (signal + fetch) | Baixa | Testar o fluxo de signal payload + busca do payload completo |
| Badge de notificação atualiza | Baixa | Verificar se o contador de não lidas persiste |

Estimar: **~150 linhas, 8–10 testes**

## Fase 4 — Métricas e Qualidade

### 4.1 Verificações Finais

- [ ] `bun test` → 0 falhas em 140+ arquivos
- [ ] `tsc --noEmit` → 0 erros nos arquivos de teste
- [ ] Cobertura mínima por módulo novo > 60%
- [ ] Testes de acessibilidade axe-core nos dashboards

### 4.2 Checklist de 10/10

- [ ] **Fase 1**: 3 arquivos com falha → 0 arquivos com falha ✅ ~40 testes salvos
- [ ] **Fase 2**: Novos componentes cobertos com testes unitários
- [ ] **Fase 3**: Push E2E completo (fluxo provider aceita booking, push recorrente)
- [ ] **Métrica**: 0 falhas, 0 warnings de tipo, cobertura > 60% nos módulos novos
- [ ] **Bônus**: Pré-commit hook com `bun test` passa limpo

## Estimativa de Esforço

| Fase | Arquivos | Testes | Linhas |
|:-----|:--------:|:------:|:------:|
| Fase 1 — Corrigir falhas | 3 | ~40 salvos | ~32 |
| Fase 2 — Novos testes | 4–5 | ~30 novos | ~380 |
| Fase 3 — Push E2E | 1 | ~10 novos | ~150 |
| **Total** | **8–9** | **~80 novos** | **~560** |

## Ordem de Execução Recomendada

```
Fase 1.1 → Fase 1.2 → Fase 1.3   (corrigir existente, impacto imediato)
    ↓
Fase 2.1 → Fase 2.2              (dashboard gateway + rota stats)
    ↓
Fase 3.2                          (E2E push faltante)
    ↓
Fase 4                            (validação final métricas)
```

Cada passo é verificável (`bun test` após cada implementação). As fases são independentes e podem ser paralelizadas (Fase 1 + Fase 3 podem rodar juntas).
