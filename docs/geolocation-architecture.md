# Geolocation Architecture

> Documentação completa do ecossistema de geolocalização do Severinno Marketplace — o **diferencial competitivo** do produto.

---

## 1. Visão Geral

O Severinno usa geolocalização como seu principal diferencial: busca por proximidade, mapa interativo de prestadores, auto-completar de endereços e rastreamento em tempo real de prestadores durante serviços.

```
┌──────────────────────────────────────────────────────────┐
│                     CLIENT (Browser)                      │
│  ┌──────────┐  ┌──────────────┐  ┌────────────────────┐  │
│  │ Address  │  │ ProvidersMap │  │ Geo Tracking       │  │
│  │AutoComp. │  │ (MapLibre GL)│  │ (WebSocket)        │  │
│  └────┬─────┘  └──────┬───────┘  └─────────┬──────────┘  │
│       │               │                    │             │
│  ┌────▼───────────────▼────────────────────▼──────────┐  │
│  │              Zustand Store (geo.ts)                │  │
│  │          Persist: localStorage "severinno:geo"     │  │
│  └───────────────────────┬────────────────────────────┘  │
│                          │                               │
│                    ┌─────▼──────┐                        │
│                    │  api.ts    │                        │
│                    │ fetchGeo*  │                        │
│                    └─────┬──────┘                        │
└──────────────────────────┼───────────────────────────────┘
                           │ HTTP
┌──────────────────────────┼───────────────────────────────┐
│                   API (Next.js)                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │geo/search│  │geo/reverse│  │geo/cep   │              │
│  │Nominatim │  │Nominatim  │  │ViaCEP    │              │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘              │
│       │              │             │                     │
│  ┌────▼──────────────▼─────────────▼──────────────┐     │
│  │           rateLimitedNominatim (1 req/s)       │     │
│  └──────────────────────┬─────────────────────────┘     │
│                         │                                │
│  ┌──────────────────────▼──────────────────────────┐    │
│  │       lib/geo.ts (server-side only)             │    │
│  └──────────────────────┬──────────────────────────┘    │
│                         │                                │
│  ┌──────────────────────▼──────────────────────────┐    │
│  │     lib/postgis.ts (ST_DWithin, ST_Distance)    │    │
│  └──────────────────────┬──────────────────────────┘    │
│                         │                                │
│  ┌──────────────────────▼──────────────────────────┐    │
│  │  lib/distance-fallback.ts (PostGIS→Haversine→null)│  │
│  └──────────────────────┬──────────────────────────┘    │
│                         │                                │
│  ┌──────────────────────▼──────────────────────────┐    │
│  │  lib/radius-expansion.ts (expansão progressiva) │    │
│  └──────────────────────┬──────────────────────────┘    │
└──────────────────────────┼───────────────────────────────┘
                           │ SQL / $queryRaw
┌──────────────────────────▼───────────────────────────────┐
│                PostgreSQL + PostGIS                       │
│  ┌─────────────┐  ┌─────────────┐  ┌───────────────┐   │
│  │ User        │  │ Booking     │  │ QuoteRequest  │   │
│  │ location    │  │ location    │  │ location      │   │
│  │ geography   │  │ geography   │  │ geography     │   │
│  │ (Point,4326)│  │ (Point,4326)│  │ (Point,4326)  │   │
│  │ GiST index  │  │             │  │               │   │
│  └─────────────┘  └─────────────┘  └───────────────┘   │
│                                                          │
│  Triggers: trg_sync_{user,booking,quoterequest}_location │
│  (auto-sync location when lat/lng change)               │
└──────────────────────────────────────────────────────────┘
```

---

## 2. Arquitetura em Camadas

### 2.1. Store (Client-side)

| Arquivo | Descrição |
|---------|-----------|
| `src/store/geo.ts` | Zustand store com persistência em localStorage. Estados: `idle → locating → geocoding → ready \| error \| denied`. Expira após 24h sem atualização. |

**Ações:**
- `setFromGPS()` — `navigator.geolocation.getCurrentPosition` + reverse geocode
- `setFromCoords(lat, lng, address?)` — definição manual de coordenadas
- `setFromCEP(cep)` — busca CEP via API → popula street/district/city/state
- `clear()` — reseta tudo para valores iniciais

**Persistência:**
- Chave: `severinno:geo`
- `partialize`: salva lat, lng, address, cep, district, city, state, status, updatedAt
- `onRehydrateStorage`: se `updatedAt` > 24h, limpa estado automaticamente

### 2.2. API Routes (Server-side)

| Rota | Serviço | Cache | Rate Limit | Descrição |
|------|---------|-------|------------|-----------|
| `GET /api/geo/search` | Nominatim Search | Redis 24h | 1 req/s (compartilhado) | Forward geocode: free-form (`?q=...`) ou estruturado (`?street=&city=`) |
| `GET /api/geo/reverse` | Nominatim Reverse | Redis 1h | 1 req/s (compartilhado) | Reverse geocode: lat/lng → endereço |
| `GET /api/geo/cep` | ViaCEP | Redis 24h | rate limit geo | CEP brasileiro → endereço |

### 2.3. Rate Limiter Compartilhado

`src/lib/nominatim-rate-limit.ts` — garante **1 req/s** para TODAS as chamadas ao Nominatim (OSM policy). Anteriormente cada rota tinha seu próprio controle, o que permitia 2 req/s combinados — violando a política da OSM.

### 2.4. Server Libraries

| Arquivo | Descrição |
|---------|-----------|
| `src/lib/geo.ts` | `server-only` — viaCEP, reverseGeocode, geocodeSearch, geocodeSearchStructured |
| `src/lib/geo-shared.ts` | Pure math: `haversineKm`, `formatDistance` — seguro para server e client |
| `src/lib/geo-client.ts` | Re-exporta `geo-shared.ts` para uso em componentes client |
| `src/lib/geo-server.ts` | Barrel que re-exporta `distance-fallback.ts` + `geo-shared.ts` |
| `src/lib/postgis.ts` | Wrappers PostGIS: `findProvidersWithinRadius`, `getDistanceBetween`, `isPostGISAvailable` |
| `src/lib/distance-fallback.ts` | Cadeia: PostGIS ST_Distance → Haversine JS → null |
| `src/lib/radius-expansion.ts` | Expansão progressiva de raio: 5→10→25→50→100 km |
| `src/lib/geo-circle.ts` | Gerador de círculo GeoJSON + helpers MapLibre GL (fill, outline, edge dots) |

### 2.5. React Components

| Componente | Descrição |
|------------|-----------|
| `providers-map.tsx` | Mapa MapLibre GL com clustering (20+), círculo de raio, slider, marcadores |
| `address-autocomplete.tsx` | Campo de endereço com debounce 300ms, dropdown Nominatim, navegação por teclado, GPS locate |
| `provider-mini-map.tsx` | Mapa compacto para modal de perfil, fallback para imagem estática OSM |

### 2.6. Hooks

| Hook | Descrição |
|------|-----------|
| `use-geo-tracking.ts` | Rastreamento GPS em tempo real via WebSocket (watchPosition + sendTrackingPosition) |

---

## 3. Providers Route — Busca com Geografia

O fluxo completo de busca no `GET /api/providers`:

```
  ┌─ Request: lat, lng, radius, q, categoryId, sort
  │
  ├─ PostGIS available?
  │   ├─ Sim → Phase 1a: Expansão de raio com ST_DWithin
  │   │         (tenta radius → 5km → 10km → 25km → 50km → 100km)
  │   │         ├─ found → Phase 1b: IDs paginados com ordenação
  │   │         └─ not found → unrestricted (expandedRadius = -1)
  │   └─ Não → Phase 1b: IDs sem filtro espacial
  │
  ├─ Phase 2: fetchProvidersData (paralelo)
  │   ├─ services (findMany)
  │   ├─ bookings (groupBy)
  │   ├─ users (findMany)
  │   └─ distances (computeDistanceMap → PostGIS → Haversine → null)
  │
  └─ Response: { items, total, expandedRadius (null|5|10|...|-1) }
```

### 3.1. Distância

A cadeia de fallback para cálculo de distância:

1. **PostGIS ST_Distance** — batch query para todos os provider IDs em 1 round-trip
2. **Haversine (JS)** — por provedor se PostGIS falhar ou retornar vazio
3. **null** — quando nem PostGIS nem coordenadas do provider estão disponíveis

### 3.2. Expansão de Raio

Quando PostGIS está disponível e o raio do usuário retorna 0 provedores:

| Passo | Raio | Descrição |
|-------|------|-----------|
| 1º | user radius | Tenta o raio solicitado |
| 2º | 5 km | Expansão mínima |
| 3º | 10 km | |
| 4º | 25 km | |
| 5º | 50 km | |
| 6º | 100 km | Máximo |

**Resposta:**
- `expandedRadius: null` → encontrou no raio do usuário
- `expandedRadius: 25` → encontrou após expandir para 25km
- `expandedRadius: -1` → existe provedor mas além de 100km (sem filtro de raio)

---

## 4. PostGIS — Banco de Dados Espacial

### 4.1. Colunas Espaciais

| Tabela | Coluna | Tipo | Trigger |
|--------|--------|------|---------|
| User | `location` | `geography(Point, 4326)` | `trg_sync_user_location` |
| Booking | `location` | `geography(Point, 4326)` | `trg_sync_booking_location` |
| QuoteRequest | `location` | `geography(Point, 4326)` | `trg_sync_quoterequest_location` |

> As triggers sincronizam `location` automaticamente quando `lat`/`lng` são alterados via Prisma.

### 4.2. Índices

- `idx_user_location_gist` — GiST index na coluna `location` do User
- `idx_booking_location_gist` — GiST index na coluna `location` do Booking
- `idx_quoterequest_location_gist` — GiST index na coluna `location` do QuoteRequest

### 4.3. Cache

| Função | Cache Key | TTL | Agrupamento |
|--------|-----------|-----|-------------|
| `findProvidersWithinRadius` | `proximity:{lat:.3f}:{lng:.3f}:{radius}` | 60s | ~110m precision |
| `getDistanceBetween` | `distance:{userIdA}:{userIdB}` (sorted) | 60s | Por par de usuários |
| `isPostGISAvailable` | `postgis:available` | 300s (5min) | Global |
| Radius count | `providers:count:{lat:.3f}:{lng:.3f}:{radius}:{cats}:{q}` | 120s | ~110m precision |

---

## 5. Serviços Externos

### 5.1. Nominatim (OpenStreetMap)

| Aspecto | Detalhe |
|---------|---------|
| URL base | `https://nominatim.openstreetmap.org` |
| Rate limit | 1 req/s (compartilhado via `rateLimitedNominatim`) |
| User-Agent | `SeverinnoMarketplace/1.0 (admin@severinno.com)` |
| Cache Redis | search: 24h, reverse: 1h |
| Endpoints | `/search` (forward), `/reverse` (reverse) |

### 5.2. ViaCEP

| Aspecto | Detalhe |
|---------|---------|
| URL base | `https://viacep.com.br/ws/{cep}/json/` |
| Rate limit | Via `assertRateLimit` (rate limit geo) |
| Cache Redis | 24h (dados raramente mudam) |

---

## 6. OpenStreetMap Tiles

O projeto usa tiles raster do OpenStreetMap diretamente (gratuito, sem API key):

```ts
const OSM_TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
```

Atribuição obrigatória: "© OpenStreetMap contributors" (já inclusa nos componentes).

**Fallback estático** (ProviderMiniMap): `https://staticmap.openstreetmap.de/staticmap.php`

---

## 7. Testes

| Suite | Arquivo | Testes |
|-------|---------|--------|
| Core geo | `src/lib/__tests__/geo.test.ts` | 23+ (geocodeSearch, structured, haversine, formatDistance) |
| Client geo | `src/lib/__tests__/geo-client.test.ts` | 7 (re-exports) |
| Geo circle | `src/lib/__tests__/geo-circle.test.ts` | 20+ + fuzzing 600 |
| Geo circle map | `src/lib/__tests__/geo-circle-map.test.ts` | 8 (syncRadiusCircle, removeRadiusCircle) |
| Distance fallback | `src/lib/__tests__/distance-fallback.test.ts` | 10 (computeDistanceMap) |
| Distance fallback fuzz | `src/lib/__tests__/distance-fallback-fuzz.test.ts` | 100 iterations + edge cases |
| Radius expansion | `src/lib/__tests__/radius-expansion.test.ts` | 12+ (buildRadiiToTry, findEffectiveRadius) |
| Radius expansion fuzz | `src/lib/__tests__/radius-expansion-fuzz.test.ts` | 1000 iterations |
| Radius expansion (route) | `src/app/api/__tests__/providers-radius-expansion.test.ts` | 10+ (integração providers route) |
| PostGIS | `src/lib/__tests__/postgis.test.ts` | 16 (findProvidersWithinRadius, getDistanceBetween, isPostGISAvailable) |
| Nominatim rate limit | `src/lib/__tests__/nominatim-rate-limit.test.ts` | 8 (rateLimitedNominatim, reset) |
| Geo store | `src/lib/__tests__/geo-store.test.ts` | 12+ (setFromCoords, setFromCEP, setFromGPS, clear) |
| CEP route | `src/app/api/__tests__/geo-cep-route.test.ts` | Rota CEP |
| Reverse route | `src/app/api/__tests__/geo-reverse-route.test.ts` | Rota reverse |
| Search route | `src/app/api/__tests__/geo-search-route.test.ts` | Rota search |
| Benchmarks | `src/lib/__tests__/geo-benchmark.bench.ts` | Performance |
| Performance regression | `src/lib/__tests__/geo-performance-regression.test.ts` | Regressão |

---

## 8. Benchmarking

O arquivo `geo-benchmark.json` contém resultados de benchmark para comparar performance entre PostGIS e Haversine.

Métricas chave:
- **PostGIS ST_DWithin** vs **Haversine JS** para raios de 1–100km
- **Tempo de resposta** médio para cada faixa de raio
- **Precisão** da aproximação equirectangular vs Haversine real

---

## 9. Convenções

1. **Server-only:** Tudo que chama API externa (Nominatim, ViaCEP) usa `import "server-only"` e está em `geo.ts`
2. **Client-safe:** Funções puras (haversine, formatDistance) em `geo-shared.ts`, re-exportadas por `geo-client.ts`
3. **Cache:** Toda consulta espacial usa Redis via `withCache()` — TTLs variam de 60s (proximidade) a 24h (CEP)
4. **Fallback:** A cadeia PostGIS → Haversine → null garante que a busca funcione mesmo sem PostGIS instalado
5. **Expansão:** A expansão progressiva de raio evita "zero results" para usuários em áreas com poucos prestadores
6. **Rate limiting:** O rate limiter compartilhado do Nominatim é **obrigatório** — violar a política OSM pode resultar em bloqueio de IP
