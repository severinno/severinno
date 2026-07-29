# Plano de Testes: Camada de Geolocalização

> **Baseado em:** `plan-testes-10.md` (estrutura) + análise da codebase em `freebuff/new-thread-thms5x3m7xt8k4`
> **Data:** Julho 2026
> **Cobertura atual:** ~20 arquivos de teste, ~200 testes geo

---

## Diagnóstico Atual

| Camada                                                       | Arquivos de Teste |          Testes           |     Cobertura      |
| :----------------------------------------------------------- | :---------------: | :-----------------------: | :----------------: |
| **Libs** (haversine, format, geo-circle, geo-client)         |         4         |           ~120            |     ✅ Robusta     |
| **Store** (geo store)                                        |         1         |            ~25            |     ✅ Robusta     |
| **API routes** (cep, reverse, search)                        |         3         |            ~25            |     ✅ Robusta     |
| **Distância** (fallback, fuzz)                               |         2         |            ~20            |     ✅ Robusta     |
| **Componentes** (address-autocomplete CEP+cache)             |         1         |     17 (14 ✅ / 3 ❌)     |      🟡 Média      |
| **Vitrine geo** (nearby-providers, spotlight, provider-card) |         0         |             0             | 🔴 **Inexistente** |
| **Comparador** (compare-bar, compare-modal)                  |         0         |             0             | 🔴 **Inexistente** |
| **Mapa** (radius-preview-map, providers-map)                 |         0         |             0             | 🔴 **Inexistente** |
| **Health check** (geo APIs)                                  |         1         |             3             |     🟡 Mínima      |
| **Performance** (benchmark, regressão)                       |         2         | 2 (bench) + 2 (regressão) |     🟡 Mínima      |

**Resumo:** 20 arquivos, ~200 testes. Componentes de UI geo têm **cobertura zero**.

---

## Fase 1 — Corrigir Testes Existentes com Falha

### 1.1 `address-autocomplete-cache-cep.test.tsx` (3 falhas)

**Problema:** Interação entre `vi.useFakeTimers()` e o debounce de 300ms. O `GLOBAL_CACHE` (nível de módulo) persiste entre testes, e o `useEffect` com dependência `[debouncedInput]` não re-executa quando o valor não muda (retry com mesmo termo).

**Testes falhando:**

| Teste                                  | Causa                                 | Solução                                                                     |
| -------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------- |
| "re-fetches after cache TTL expires"   | Cache de teste anterior + fake timers | Avançar tempo 5min no beforeEach ou usar `vi.useRealTimers()` com `waitFor` |
| "recovers from fetchGeoSearch error"   | `debouncedInput` não muda no retry    | Usar termos diferentes para primeira e segunda busca                        |
| "closes dropdown when input < 3 chars" | Fake timers + debounce não disparam   | Usar `waitFor` em vez de `flushDebounce`                                    |

**Estimativa:** 30 min, +10 linhas

---

## Fase 2 — Testes de Componentes Vitrine (GEO)

### 2.1 `nearby-providers.test.tsx` (NOVO — Prioridade Alta)

**Componente:** `src/components/vitrine/nearby-providers.tsx` (~170 linhas)
**Funcionalidades:** Seção "Perto de você" com scroll horizontal (collapsed) + grid expansível + "Mostrar mais/menos"

**Padrão:** Mock `useGeoStore` (lat/lng ready), mock `fetchProviders` via TanStack Query, render com `QueryClientProvider`

**Testes:**

| #   | Teste                                                                   | Tipo        |
| --- | ----------------------------------------------------------------------- | ----------- |
| 1   | Não renderiza quando status não é "ready"                               | Condicional |
| 2   | Não renderiza quando não há providers e não está loading                | Condicional |
| 3   | Mostra loading skeleton quando `isLoading`                              | Loading     |
| 4   | Renderiza cards em scroll horizontal (collapsed)                        | Happy path  |
| 5   | Mostra no máximo `COLLAPSED_COUNT` cards no collapsed                   | Limite      |
| 6   | Card "Mostrar mais" aparece quando `providers.length > COLLAPSED_COUNT` | Toggle      |
| 7   | Clica em "Mostrar mais" → expande para grid                             | Interação   |
| 8   | Grid expansível mostra todos os providers                               | Happy path  |
| 9   | Botão "Mostrar menos" recolhe de volta                                  | Interação   |
| 10  | Hint sutil aparece quando `providers.length ≤ COLLAPSED_COUNT`          | Edge case   |
| 11  | Cada card tem distância formatada corretamente                          | Formatação  |
| 12  | Card mostra preço do serviço mais barato                                | Dados       |
| 13  | Click no card → `openProvider(id)`                                      | Callback    |
| 14  | Query key inclui lat/lng (invalida quando localização muda)             | Cache       |
| 15  | Não mostra "Mostrar mais" quando exatamente 4 providers                 | Edge case   |

**Estimativa:** ~120 linhas, 15 testes

### 2.2 `provider-spotlight-geo.test.tsx` (NOVO — Prioridade Alta)

**Componente:** `src/components/vitrine/provider-spotlight-geo.tsx` (~200 linhas)
**Funcionalidades:** Seção de destaque com carrossel mobile / grid desktop, badge "Perto de você"

**Testes:**

| #   | Teste                                                        | Tipo        |
| --- | ------------------------------------------------------------ | ----------- |
| 1   | Não renderiza sem localização                                | Condicional |
| 2   | Não renderiza sem providers (sem loading)                    | Condicional |
| 3   | Loading: 3 skeletons                                         | Loading     |
| 4   | Desktop (sm+): grid de 3 colunas com SpotlightCards          | Responsivo  |
| 5   | Mobile (sm-): Carousel com navegação                         | Responsivo  |
| 6   | Badge "Perto de você" aparece quando `distanceKm ≤ radiusKm` | Badge       |
| 7   | Badge cai para threshold 2km quando radiusKm é undefined     | Fallback    |
| 8   | Badge não aparece quando distanceKm > radiusKm               | Badge       |
| 9   | Preço mais barato é calculado corretamente                   | Dados       |
| 10  | Botões Orçamento/Agendar chamam callbacks                    | Callback    |
| 11  | Clicar no nome → onView(id)                                  | Callback    |
| 12  | Query key inclui lat/lng para cache                          | Cache       |

**Estimativa:** ~100 linhas, 12 testes

### 2.3 `provider-card-geo.test.tsx` (NOVO — Prioridade Média)

**Componente:** `src/components/vitrine/provider-card.tsx` (badges + distância apenas — o resto já tem cobertura)

**Testes específicos de geo:**

| #   | Teste                                                       | Tipo           |
| --- | ----------------------------------------------------------- | -------------- |
| 1   | Badge "Perto de você" baseado em `distanceKm ≤ radiusKm`    | Badge          |
| 2   | `data-compare-distance` formatado corretamente (m/km)       | Data attribute |
| 3   | Distância formatada via `formatDistance`                    | Formatação     |
| 4   | Badge não aparece quando radiusKm é null e distanceKm > 2km | Fallback       |
| 5   | Badge não aparece quando distanceKm é null                  | Edge case      |

**Estimativa:** ~50 linhas, 5 testes

### 2.4 `address-autocomplete-structured.test.tsx` (NOVO — Prioridade Média)

**Complemento do teste existente** — cobrir o fluxo de structured search com Nominatim após CEP.
**Arquivo base:** `address-autocomplete-cache-cep.test.tsx`

**Testes:**

| #   | Teste                                                                     | Tipo        |
| --- | ------------------------------------------------------------------------- | ----------- |
| 1   | Após CEP válido, chama `fetchGeoSearchStructured` com postcode+city+state | Fluxo       |
| 2   | Structured search com sucesso → resultado tem lat/lng reais               | Happy path  |
| 3   | Structured search falha → fallback para ViaCEP (lat=0, lng=0)             | Fallback    |
| 4   | CEP sem city → não tenta structured search                                | Condicional |
| 5   | Seleção de CEP com coordenadas → `setFromCoords` + `onSelect(lat, lng)`   | Callback    |
| 6   | Seleção de CEP sem coordenadas → `onSelect(0, 0)`                         | Callback    |

**Estimativa:** ~80 linhas, 6 testes

---

## Fase 3 — Testes do Comparador com Distância

### 3.1 `compare-bar-geo.test.tsx` (NOVO — Prioridade Média)

**Componente:** `src/components/vitrine/compare-bar.tsx` (chip de distância + data attributes)

**Testes:**

| #   | Teste                                             | Tipo           |
| --- | ------------------------------------------------- | -------------- |
| 1   | Não renderiza quando compare store está vazia     | Condicional    |
| 2   | Chip mostra nome + avatar + distância do provider | Happy path     |
| 3   | `data-compare-distance` é lido do DOM e exibido   | Data attribute |
| 4   | Chip sem distância → não mostra fallback          | Edge case      |
| 5   | Remover chip → `remove(id)` é chamado             | Interação      |
| 6   | Botão "Comparar" fica disabled com < 2 providers  | Gate           |
| 7   | Botão "Comparar" fica enabled com ≥ 2 providers   | Gate           |

**Estimativa:** ~80 linhas, 7 testes

### 3.2 `compare-modal-distance.test.tsx` (NOVO — Prioridade Média)

**Componente:** `src/components/vitrine/compare-modal.tsx` (linha de distância + badge "Mais próximo")

**Testes:**

| #   | Teste                                                      | Tipo       |
| --- | ---------------------------------------------------------- | ---------- |
| 1   | Linha distância aparece quando `distanceKm` está presente  | Happy path |
| 2   | Linha distância mostra "—" quando `distanceKm` é null      | Fallback   |
| 3   | Badge "Mais próximo" no provider com menor distância       | Badge      |
| 4   | Badge não aparece quando todos têm mesma distância         | Edge case  |
| 5   | Badge não aparece quando nenhum tem distância              | Edge case  |
| 6   | lat/lng da geo store são passados ao `fetchProviderDetail` | Integração |
| 7   | Distância formatada corretamente (m/km)                    | Formatação |

**Estimativa:** ~100 linhas, 7 testes

### 3.3 `compare-store.test.ts` (NOVO — Prioridade Baixa)

**Store:** `src/store/compare.ts` (Zustand + persist)

**Testes:**

| #   | Teste                                             | Tipo    |
| --- | ------------------------------------------------- | ------- |
| 1   | `toggle` adiciona ID quando ausente               | State   |
| 2   | `toggle` remove ID quando presente                | State   |
| 3   | `toggle` respeita MAX_COMPARE (ignora se cheio)   | Limite  |
| 4   | `remove` funciona corretamente                    | State   |
| 5   | `clear` zera a lista                              | State   |
| 6   | `isAdded` retorna true/false                      | Getter  |
| 7   | `openCompare` / `closeCompare` alternam modalOpen | State   |
| 8   | Persist: `partialize` salva só `ids`              | Persist |

**Estimativa:** ~60 linhas, 8 testes

---

## Fase 4 — Testes de API Geo

### 4.1 `geo-search-structured.test.ts` (NOVO — Prioridade Média)

**Rota:** `/api/geo/search` com parâmetros estruturados
**Base:** `geo-search-route.test.ts` já cobre free-form + structured básico

**Testes adicionais:**

| #   | Teste                                                      | Tipo        |
| --- | ---------------------------------------------------------- | ----------- |
| 1   | structured com postcode + city (sem street)                | Happy path  |
| 2   | structured com apenas postcode → modo free-form (sem city) | Fallback    |
| 3   | structured com country default "Brazil"                    | Default     |
| 4   | structured com limit=1 (min)                               | Limite      |
| 5   | structured City com espaços extras → trim                  | Sanitização |
| 6   | structured + rate limit                                    | Rate limit  |

**Estimativa:** ~60 linhas, 6 testes

### 4.2 `providers-detail-distance.test.ts` (NOVO — Prioridade Alta)

**Rota:** `/api/providers/[id]` (retorna `distanceKm`)
**Base:** Teste de rota de detail PROVERS precisa ser criado

**Testes:**

| #   | Teste                                                                 | Tipo        |
| --- | --------------------------------------------------------------------- | ----------- |
| 1   | GET com lat/lng → retorna distanceKm calculado                        | Happy path  |
| 2   | GET sem lat/lng → distanceKm é null                                   | Condicional |
| 3   | GET com lat/lng inválidos (NaN) → 400                                 | Validação   |
| 4   | GET com lat/lng de provedor sem coordenadas → null                    | Edge case   |
| 5   | GET sem auth → dados públicos ainda retornam                          | Auth        |
| 6   | `radiusKm` presente na resposta (agora que `ProviderDataItem` inclui) | Campo       |
| 7   | Haversine distance precisa (±5% de tolerância)                        | Precisão    |

**Estimativa:** ~80 linhas, 7 testes

### 4.3 `providers-list-radius.test.ts` (NOVO — Prioridade Média)

**Rota:** `/api/providers` (expansão de raio + distância)
**Base:** `providers-route.test.ts` + `providers-radius-expansion.test.ts` já existem

**Testes adicionais:**

| #   | Teste                                           | Tipo       |
| --- | ----------------------------------------------- | ---------- |
| 1   | sort=distance retorna providers ordenados       | Happy path |
| 2   | sort=distance sem lat/lng → 400                 | Validação  |
| 3   | radius retorna `distanceKm` em cada item        | Campo      |
| 4   | `radiusKm` retornado em cada item               | Campo      |
| 5   | Paginação com sort=distance mantém ordem        | Paginação  |
| 6   | `expandedRadius` presente quando houve expansão | Campo      |

**Estimativa:** ~60 linhas, 6 testes

---

## Fase 5 — Testes de Mapa e Raio

### 5.1 `radius-preview-map.test.tsx` (NOVO — Prioridade Média)

**Componente:** `src/components/shared/radius-preview-map.tsx` + `radius-map-inner.tsx`
**Funcionalidades:** Mapa com círculo de raio (1-100km) + slider

**Testes:**

| #   | Teste                                     | Tipo        |
| --- | ----------------------------------------- | ----------- |
| 1   | Renderiza com lat/lng válidos             | Happy path  |
| 2   | Slider de raio (1-100km) funciona         | Interação   |
| 3   | Círculo no mapa atualiza quando raio muda | Efeito      |
| 4   | Não renderiza sem lat/lng                 | Condicional |
| 5   | GPS button → chama onLocationChange       | Callback    |
| 6   | Mapa é SSR-safe (dynamic import)          | SSR         |

**Estimativa:** ~100 linhas, 6 testes

---

## Fase 6 — Testes de Cache e Performance

### 6.1 `geo-cache.test.ts` (NOVO — Prioridade Média)

**Funcionalidade:** Cache in-memory do AddressAutocomplete (`GLOBAL_CACHE`)

**Testes:**

| #   | Teste                                                      | Tipo         |
| --- | ---------------------------------------------------------- | ------------ |
| 1   | `cacheSet` + `cacheGet` → hit                              | Happy path   |
| 2   | `cacheGet` retorna null para chave inexistente             | Miss         |
| 3   | `cacheGet` retorna null após TTL expirar                   | TTL          |
| 4   | `cacheSet` remove entrada mais velha quando cheio (max 50) | Eviction     |
| 5   | Chaves são case-insensitive                                | Normalização |
| 6   | Cache threadsafe (chamadas simultâneas)                    | Concorrência |

**Estimativa:** ~50 linhas, 6 testes

### 6.2 `health-geo.test.ts` (MELHORIA — Prioridade Baixa)

**Base:** `src/app/api/__tests__/health.test.ts` já existe com 3 testes

**Testes adicionais:**

| #   | Teste                                             | Tipo        |
| --- | ------------------------------------------------- | ----------- |
| 1   | Health check ViaCEP mockado retorna ok            | Happy path  |
| 2   | Health check Nominatim mockado retorna ok         | Happy path  |
| 3   | Sentry alert dispara quando geo API falha         | Alerta      |
| 4   | Timeout no geo health não quebra o health geral   | Resiliência |
| 5   | Geo APIs lentas (>5s) são reportadas como warning | Performance |

**Estimativa:** ~40 linhas, 5 testes

---

## Fase 7 — Testes E2E de Geo

### 7.1 `e2e/geo-address-flow.spec.ts` (NOVO — Prioridade Média)

**Fluxo:** AddressAutocomplete → CEP → Structured Search → Seleção → Store

| #   | Teste                                                  | Tipo      |
| --- | ------------------------------------------------------ | --------- |
| 1   | Digitar CEP → ver resultado ViaCEP com badge           | Interação |
| 2   | Selecionar CEP → store atualizada com cep/address/city | Fluxo     |
| 3   | Digitar "São Paulo" → ver resultados Nominatim         | API       |
| 4   | GPS locate → store atualizada com lat/lng              | GPS       |
| 5   | Limpar input → resultados desaparecem                  | Interação |

**Estimativa:** ~80 linhas, 5 testes

### 7.2 `e2e/geo-nearby.spec.ts` (NOVO — Prioridade Média)

**Fluxo:** Vitrine → NearbyProviders → Expandir → Grid

| #   | Teste                                           | Tipo        |
| --- | ----------------------------------------------- | ----------- |
| 1   | Vitrine com GPS → seção "Perto de você" visível | Render      |
| 2   | Clicar "Mostrar mais" → grid expansível         | Interação   |
| 3   | Clicar em card → perfil do provider             | Navegação   |
| 4   | Sem GPS → seção não aparece                     | Condicional |
| 5   | ProviderSpotlightGeo visível com GPS ativo      | Render      |

**Estimativa:** ~60 linhas, 5 testes

### 7.3 `e2e/geo-compare.spec.ts` (NOVO — Prioridade Baixa)

**Fluxo:** ProviderCard comparar → bar → modal com distância

| #   | Teste                                            | Tipo      |
| --- | ------------------------------------------------ | --------- |
| 1   | Adicionar 2 providers à comparação → bar aparece | Interação |
| 2   | Bar mostra distância nos chips                   | UI        |
| 3   | Clicar "Comparar" → modal com linha de distância | Modal     |
| 4   | Badge "Mais próximo" destaca corretamente        | Dados     |
| 5   | Remover provider → modal atualiza                | Interação |

**Estimativa:** ~80 linhas, 5 testes

---

## Resumo do Plano

### Matriz de Prioridades

|  Prioridade  |   Fase    | Componente                        |  Testes  |   Linhas   | Esforço  |
| :----------: | :-------: | :-------------------------------- | :------: | :--------: | :------: |
| 🔴 **Alta**  |     1     | Corrigir 3 falhas existentes      |    3     |    +10     |  30 min  |
| 🔴 **Alta**  |    2.1    | `nearby-providers`                |    15    |    120     |    2h    |
| 🔴 **Alta**  |    2.2    | `provider-spotlight-geo`          |    12    |    100     |   1.5h   |
| 🔴 **Alta**  |    4.2    | `providers-detail-distance`       |    7     |     80     |    1h    |
| 🟡 **Média** |    2.3    | `provider-card-geo`               |    5     |     50     |  45 min  |
| 🟡 **Média** |    2.4    | `address-autocomplete-structured` |    6     |     80     |    1h    |
| 🟡 **Média** |    3.1    | `compare-bar-geo`                 |    7     |     80     |    1h    |
| 🟡 **Média** |    3.2    | `compare-modal-distance`          |    7     |    100     |    1h    |
| 🟡 **Média** |    4.1    | `geo-search-structured`           |    6     |     60     |  45 min  |
| 🟡 **Média** |    4.3    | `providers-list-radius`           |    6     |     60     |  45 min  |
| 🟡 **Média** |    5.1    | `radius-preview-map`              |    6     |    100     |   1.5h   |
| 🟡 **Média** |    6.1    | `geo-cache`                       |    6     |     50     |  30 min  |
| 🟢 **Baixa** |    3.3    | `compare-store`                   |    8     |     60     |  30 min  |
| 🟢 **Baixa** |    6.2    | `health-geo` (melhoria)           |    5     |     40     |  30 min  |
| 🟢 **Baixa** |    7.1    | E2E `geo-address-flow`            |    5     |     80     |    1h    |
| 🟢 **Baixa** |    7.2    | E2E `geo-nearby`                  |    5     |     60     |  45 min  |
| 🟢 **Baixa** |    7.3    | E2E `geo-compare`                 |    5     |     80     |    1h    |
|              | **Total** | **17 áreas**                      | **~104** | **~1.150** | **~16h** |

### Estimativa de Esforço

| Fase                         |  Testes  |   Linhas   |  Esforço  |
| :--------------------------- | :------: | :--------: | :-------: |
| Fase 1 — Corrigir existentes |    3     |    +10     |  30 min   |
| Fase 2 — Componentes vitrine |    38    |    350     | 5h 15 min |
| Fase 3 — Comparador          |    22    |    240     | 2h 30 min |
| Fase 4 — API Geo             |    19    |    200     | 2h 30 min |
| Fase 5 — Mapa e Raio         |    6     |    100     | 1h 30 min |
| Fase 6 — Cache e Performance |    11    |     90     |    1h     |
| Fase 7 — E2E                 |    15    |    220     | 2h 45 min |
| **Total**                    | **~114** | **~1.210** | **~16h**  |

### Ordem de Execução Recomendada

```
Fase 1 (corrigir 3 falhas) → impacto imediato nos 17 testes existentes
    ↓
Fase 2.1 + 2.2 (nearby + spotlight) → componentes mais visíveis, maior impacto
    ↓
Fase 4.2 (providers detail distance) → valida que distância funciona no modal
    ↓
Fase 3.1 + 3.2 (compare bar + modal) → validar distância + badge "Mais próximo"
    ↓
Fase 2.3 + 2.4 + 4.1 + 4.3 (complementares) → preencher lacunas restantes
    ↓
Fase 5 + 6 (mapa + cache) → testes de infraestrutura
    ↓
Fase 7 (E2E) → validação integrada final
```

### Métricas de Sucesso

- [ ] **Fase 1**: 0 falhas nos 17 testes de CEP+cache (hoje 3 falham)
- [ ] **Fase 2**: 38 novos testes para componentes vitrine geo
- [ ] **Fase 3**: 22 novos testes para comparador com distância
- [ ] **Fase 4**: 19 novos testes para API geo
- [ ] **Fase 5**: 6 novos testes para mapa e raio
- [ ] **Fase 6**: 11 novos testes para cache e performance
- [ ] **Fase 7**: 15 testes E2E de fluxos geo
- [ ] **Métrica**: `bun test` → 0 falhas
- [ ] **Métrica**: `tsc --noEmit` → 0 erros nos arquivos de teste
- [ ] **Bônus**: Cobertura > 60% nos módulos geo da vitrine
