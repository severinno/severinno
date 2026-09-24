# Foundation — Task 1 (full-stack-developer)

Built the **pré-requisito técnico** do Severinno Marketplace SaaS para que
demais agentes possam construir UI/API/features em paralelo.

## Entregáveis

### 1. Prisma schema — `prisma/schema.prisma`

Modelos marketplace completos (SQLite-safe, sem `enum` nativo):

- `User` (role String "CLIENT"|"PROVIDER"|"ADMIN", lat/lng, radiusKm, endereço BR completo, verified/active)
- `Category` (árvore 3 níveis via self-relation `parent/children`)
- `Service` (providerId, categoryId=subcategoria, basePrice, unit String, photos Json array)
- `ProviderAvailability` (dayOfWeek 0-6, startTime/endTime "HH:mm")
- `QuoteRequest` + `QuoteItem` (status Strings, prices, photos Json)
- `Booking` (status, paymentMethod, paymentStatus, amount, scheduledAt, geoloc)
- `Review` (bookingId unique, rating 1-5, comment)
- `Favorite` (compound unique [clientId, providerId])
- `Message` (from/to, read, bookingId opcional)
- `Notification` (type, title, body, read)
- `Payment` (bookingId unique, method, status, transactionId)
- `Setting` (key unique, value, updatedBy)

Indexes em campos de busca/relacionamento (`role`, `city`, `[lat,lng]`,
`parentId`, `slug`, `level`, `providerId`, `serviceId`, `status`, `dayOfWeek`,
`read`, `bookingId`, `[clientId, providerId]`).

**Enum-policy**: todos os campos enum-like são `String` + comentário com valores
permitidos. Validação runtime via Zod em `src/lib/validators.ts`.

Schema pushed e Prisma Client gerado com sucesso.

### 2. Seed — `prisma/seed.ts` (+ script `db:seed` no package.json)

- **1 Admin**: admin@severinno.com / admin123
- **2 Clients**: cliente@severinno.com / cliente123, maria@severinno.com / cliente123
- **6 Providers** (encanador, eletricista, pintor, diarista, jardineiro, pedreiro):
  - lat/lng jitter em torno de São Paulo (-23.55, -46.63)
  - avatarUrl: `https://i.pravatar.cc/150?img=N`
  - coverUrl: `https://picsum.photos/seed/X/800/300`
  - radiusKm, bio realista em pt-BR
  - password: provider123 (cada provider usa `[profession]@severinno.com`)
- **Disponibilidade**: Seg-Sex 08:00-18:00, Sáb 08:00-12:00 (36 registros)
- **27 Categorias** em árvore 3-nível: Reparos/Limpeza/Reforma → filhas → subcategorias (inclui Tomadas, Curto-circuito, Quadro elétrico, Desentupimento, Vazamento, Caixa de descarga, Pintura interna/externa, Textura, Limpeza geral, Pós-obra, Assentamento, Rejunte, Contrapiso, Poda de árvores etc.)
- **13 Services** com basePrice BRL, unit, 2 fotos picsum
- **4 Bookings COMPLETED** + 4 Reviews (ratings 4-5) + 4 Payments PAID (PIX)
- **2 Favorites** + **9 Notifications** (welcome) + **9 Settings**

Senha hash via `crypto.scryptSync` (`src/lib/crypto.ts`) — N=16384, salt 16 bytes,
formato `saltHex:hashHex`, compare timing-safe.

### 3. Design System — `src/app/globals.css`

- Primary = **emerald** `oklch(0.55 0.15 160)` (light), `oklch(0.7 0.16 160)` (dark)
- `--ring`, `--sidebar-primary`, `--accent`, `--chart-1` alinhados ao emerald
- Resto da paleta neutral mantido
- Scrollbar custom thin/rounded com thumb em muted-foreground e hover em primary
- Estilos `.map-popup` (MapLibre) para próximos agentes (mínimo)

### 4. Layout + Providers — `src/app/layout.tsx` + `src/components/providers.tsx`

- Metadata pt-BR: título "Severinno Marketplace", descrição de serviços com geolocalização, locale pt_BR
- `<html lang="pt-BR" suppressHydrationWarning>`
- Wrapper `Providers` combinando: `next-themes` (ThemeProvider attribute="class",
  defaultTheme="light", enableSystem) + `@tanstack/react-query` (QueryClient com
  staleTime 30s, retry 1) + Sonner Toaster (theme-aware via useTheme)
- `useEffect`/`useState` pattern para instanciar QueryClient sem SSR rehydrate bug

### 5. Lib utilities — `src/lib/`

- **`crypto.ts`** — `hashPassword(pw)`, `verifyPassword(pw, hash)` (scrypt)
- **`auth.ts`** (server-only) — `createSession(userId, role)`, `getSession()`,
  `destroySession()`, `requireUser()`, `requireRole(role)`, `getOptionalSession()`.
  Cookie `severinno_session` httpOnly com payload HMAC-SHA256
  (`userId.role.expiresAt.signature`), secret de `SESSION_SECRET` ou dev fallback.
  Usa `next/headers` `cookies()`. Verifica se user ainda existe e está active.
- **`geo.ts`** (server-only) — `haversineKm`, `formatDistance` (m/km pt-BR),
  `geocodeCEP` (ViaCEP, cache 24h), `reverseGeocode` (Nominatim com User-Agent
  "SeverinnoMarketplace/1.0"), `formatCurrencyBRL`.
- **`format.ts`** — `formatBRL`, `formatDate`, `formatDateTime`, `formatTime`,
  `formatRelative` (date-fns + locale ptBR), `formatHHmm`.
- **`constants.ts`** — labels/cores pt-BR para: roles, service units (Unidade,
  Metro linear, m², m³ + short), quote status, quote item status, booking
  status, payment method/status, weekdays (long/short), notification types,
  APP_NAME, DEFAULT_SEARCH_RADIUS_KM.
- **`validators.ts`** — Zod schemas (zod 4 API): loginSchema, registerSchema
  (com refine de senhas + refine provider obriga cpfCnpj/whatsapp/city),
  providerProfileSchema, serviceSchema (max 4 fotos), categorySchema (slug
  regex), quoteSchema (com items array), quoteItemResponseSchema,
  bookingSchema, reviewSchema, messageSchema, settingSchema,
  availabilitySchema.

### 6. Zustand stores — `src/store/`

- **`auth.ts`** — `useAuthStore`: user/status/error/initialized, `login`,
  `register`, `logout`, `fetchMe`, `setUser`, `clearError`. Persistido em
  localStorage (`severinno:auth`), partializa só user/status/initialized.
  Chama `/api/auth/{login,register,logout,me}`.
- **`geo.ts`** — `useGeoStore`: lat/lng/address/cep/city/state/status/error,
  `setFromGPS` (navigator.geolocation), `setFromCoords`, `setFromCEP`
  (chama `/api/geo/cep?cep=`), `clear`. Persistido (`severinno:geo`).
- **`view.ts`** — `useViewStore`: view/params/history[], `navigate(view,params)`,
  `back()`, `reset()`, `canGoBack()`. Persiste só view+params (não o histórico).
  Default view: `vitrine`.
- **`ui.ts`** — `useUIStore`: 4 modais (quote/booking/provider/auth) com
  open + opt fields, + `sidebarOpen` para app shell. Ações open/close/switch.
- **`index.ts`** — re-export centralizado.

## Como rodar

```bash
# 1. Schema → DB
bunx prisma db push --accept-data-loss
bun run db:generate

# 2. Seed
bun run db:seed
# (idempotente: limpa tudo na ordem de FKs e recria)

# 3. Login (qualquer um dos abaixo)
# admin@severinno.com / admin123
# cliente@severinno.com / cliente123
# maria@severinno.com / cliente123
# carlos@severinno.com / provider123  (e demais providers)
```

## Verificações executadas

- `bunx prisma db push --accept-data-loss` → ✅ "database is now in sync"
- `bun run db:generate` → ✅ Generated Prisma Client v6.19.2
- `bun run db:seed` → ✅ 9 users / 27 categorias / 13 services / 36 avail /
  4 bookings / 4 reviews / 2 favorites / 9 notifications / 4 payments / 9 settings
- `bunx tsc --noEmit` → ✅ sem erros nos meus arquivos
- `bunx eslint src/lib src/store src/components/providers.tsx src/app/layout.tsx prisma/seed.ts`
  → ✅ zero erros/warnings

## Caveats / notas para próximos agentes

1. **SQLite sem `enum`**: todos os campos de status são `String`. Sempre validar
   com os Zod schemas em `src/lib/validators.ts` antes de gravar, e usar os
   labels/cores de `src/lib/constants.ts` na UI.
2. **`reviews` em `Service`**: há relação `Service.reviews Review[]` ↔
   `Review.service Service?` (serviceId opcional). Mantido para queries
   "serviços mais avaliados".
3. **`src/lib/geo.ts`** marca `import "server-only"` — não importar em
   componentes client. Para uso client (ex: haversine em filtros do mapa),
   duplicar a função haversine em um arquivo client-safe ou mover para
   `src/lib/geo-client.ts`.
4. **`SESSION_SECRET`**: dev fallback hardcoded. Em produção setar env var.
5. **Nominatim**: User-Agent fixo "SeverinnoMarketplace/1.0 (admin@severinno.com)"
   — respeita policy OSM (1 req/s). Não usar para geocoding em massa.
6. **Persist Zustand**: stores auth/geo/view persistem em localStorage. O `ui`
   (modais) não persiste — sempre começa fechado, evita abrir modal em estado
   fantasma após refresh.
7. **`src/hooks/use-realtime.ts`** (não meu) tem erro de lint `react-hooks/refs`
   no return. Quem for usar/modificar deve corrigir. Não está no escopo Task 1.
8. **Cookie `severinno_session`**: httpOnly, sameSite=lax, secure em produção,
   maxAge 30 dias. Payload = `${userId}.${role}.${expiresAt}.${hmac}`.
9. **Layout**: troquei `<Toaster />` (radix) por `<SonnerToaster />` via
   Providers. Se preferir manter ambos, adicionar `<Toaster />` de volta em
   `layout.tsx` (radix toaster ainda existe em `src/components/ui/toaster.tsx`).
10. **`page.tsx`** NÃO foi modificado (escopo de outro agente). Continua com o
    scaffold placeholder do Z.ai.
