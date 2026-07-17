# Task 3 — Backend API routes (full-stack-developer)

Built ALL backend API route handlers for the Severinno Marketplace SaaS
(Fase 1 / MVP) under `src/app/api/**` using Next.js 16 App Router route
handlers + Prisma (SQLite) + Zod.

## Critical context discovered while working

The foundation `src/lib/api.ts` is a **client-side typed fetch wrapper**
(`apiGet/apiPost/apiPatch/apiDelete` + types `ProviderCard`,
`ProviderDetail`, `ProviderService`, `Category`, `PagedResult`,
`FavoriteResponse`, `CepResult`, etc.) consumed by UI components in
`src/components/vitrine/**` and `src/components/modals/**`.

To avoid touching the foundation lib, my **server-side helpers live in
`src/lib/api-server.ts`** (HttpError, handleError, badRequest, unauthorized,
forbidden, notFound, conflict, parsePagination, USER_PUBLIC_SELECT,
publicUser, getCategoryDescendants). All API route handlers import from
`@/lib/api-server`, NOT `@/lib/api`.

## Route response shapes — aligned with UI contract

To match what `apiGet<T>` consumers expect (T is the JSON body directly):

- `/api/categories` GET → `Category[]` (flat array, NOT `{items,total}`)
- `/api/providers` GET → `PagedResult<ProviderCard>` = `{items,total,page,limit}`
- `/api/providers/[id]` GET → `ProviderDetail` (flat, NOT `{provider:…}`);
  reviews mapped with `author: {id,name,avatarUrl}` (alias for `client`)
- `/api/providers/[id]/favorite` POST → `{favorited: boolean}` (HTTP 201 on add, 200 on remove)
- `/api/services` GET → `ProviderService[]` (flat array)
- `/api/favorites` GET → `ProviderCard[]` (flat array)
- `/api/geo/cep` GET → flat `CepResult` `{cep,street,district,city,state}`
- `/api/geo/reverse` GET → flat `{street,district,city,state,cep,displayName}`
- `/api/quotes` POST → `{quote}` ; GET → `{items,total,page,limit}`
- `/api/quotes/[id]` GET → `{quote}` ; PATCH → `{quote}`
- `/api/quotes/[id]/items/[itemId]` PATCH → `{item}`
- `/api/bookings` POST → `{booking}` ; GET → `{items,total,page,limit}`
- `/api/bookings/[id]` GET/PATCH → `{booking}`
- `/api/bookings/[id]/pay` POST → `{ok,booking}`
- `/api/reviews` POST → `{review}` ; GET → `{items,total}`
- `/api/messages` GET → conversation `{peer,items}` OR list `{items}`;
  POST → `{message}` (also creates a `MESSAGE` notification)
- `/api/notifications` GET → `{items,total,page,limit,unreadCount}`
- `/api/notifications/[id]/read` PATCH → `{notification}`
- `/api/admin/stats` GET → aggregate object
- `/api/admin/users` GET → `{items,total,page,limit}`
- `/api/admin/users/[id]` PATCH → `{user}` ; DELETE → `{ok:true}`
- `/api/admin/settings` GET → `{items,total}` ; POST → `{items}`
- `/api/upload` POST → `{url}` (saves a webp-optimized image under `public/uploads/`)

## Key behaviors

- **Auth**: `requireUser()` / `requireRole("ADMIN")` from `@/lib/auth`; on
  missing/inactive user → throws `UNAUTHORIZED` (401), wrong role →
  `FORBIDDEN` (403). The `handleError` helper maps both to JSON responses
  and also maps ZodError → 400 with `details`, and HttpError → its `status`.
- **passwordHash** is stripped from every public response (via destructure
  or `USER_PUBLIC_SELECT`).
- **Provider catalog** (`/api/providers`): filters by role=PROVIDER + active
  + verified; optional `q` (name/bio/city), `categoryId` (matches any
  service in the category subtree via `getCategoryDescendants` BFS),
  `radius` (post-fetch haversine). Sort `rating` (default) or `distance`
  (requires lat/lng). Computes `rating`, `reviewCount`, `favoriteCount`,
  `distanceKm` in JS (small dataset).
- **Provider detail**: includes services (with category), availability
  (ordered by dayOfWeek), top-20 reviews with `author`. Returns
  `favorited: boolean` if logged-in client.
- **Services**: `basePrice` can only increase on PATCH (business rule).
- **Quotes**: items validated to belong to the chosen provider; status
  `PENDING` → `RESPONDED` automatically when a provider responds to any
  item; expiresAt defaults to now+7d.
- **Bookings**: status transition table enforced
  (PROVIDER: PENDING→CONFIRMED/IN_PROGRESS/CANCELLED; CLIENT:
  PENDING/CONFIRMED→CANCELLED, CONFIRMED/IN_PROGRESS→COMPLETED). CONFIRM
  sets `paymentStatus=PAID` (simulated capture). CANCEL on PAID booking
  sets `paymentStatus=REFUNDED` and syncs the Payment record.
- **Reviews**: one per booking; booking must be COMPLETED and owned by the
  client.
- **Messages**: when `with=userId` query is provided, returns the
  conversation and marks inbound unread messages as read. Without `with`,
  returns the conversations list (last message + unread count per peer).
  Sending a message also creates a `MESSAGE` notification.
- **Notifications**: unread first, then by date desc. `unreadCount`
  returned alongside paginated items.
- **Admin stats**: `usersByRole`, `providers` (verified+active count),
  `services`, `bookingsByStatus`, `quotesByStatus`, `revenue`
  (`{total, paymentsPaid}`), `recentBookings` (5), `topProviders` (5 by
  rating then reviewCount).
- **Upload**: multipart `file` field → optimized webp (max 1200px, q80)
  saved as `public/uploads/<uuid>.webp`. Validates type (jpeg/png/webp/gif)
  and size (≤8MB). Graceful 400 on missing/invalid file or non-multipart
  request.

## Verification

- `bunx tsc --noEmit` — **0 errors** in `src/app/api/**` and
  `src/lib/api-server.ts`. (Remaining tsc errors are in
  `src/components/modals/{auth-modal,quote-modal}.tsx` and
  `src/components/vitrine/providers-map.tsx` — UI agent's scope.)
- `bunx eslint src/app/api src/lib/api-server.ts` — **0 errors**.
- `bun run lint` — only the pre-existing `react-hooks/refs` errors in
  `src/hooks/use-realtime.ts` (Task 2 agent; not my scope).
- Live smoke tests via curl against the dev server (port 3000):
  - `/api/categories` → flat array ✓
  - `/api/providers?limit=2` → `{items,total,page,limit}` with
    `rating`/`reviewCount`/`favoriteCount`/`distanceKm`/`services` (no
    `passwordHash`) ✓
  - `/api/providers?lat=-23.55&lng=-46.63&sort=distance` → ordered by
    haversine asc ✓
  - `/api/providers?categoryId=<Reparos>` → 3 providers in the Reparos
    subtree ✓
  - `/api/providers/[id]` → flat `ProviderDetail` with
    `reviews[].author` ✓
  - `/api/providers/[id]/favorite` POST (as client) → `{favorited:true}`
    201 ✓
  - `/api/auth/login` + `/api/auth/me` with cookie ✓
  - `/api/favorites` (401 without cookie; flat array with cookie) ✓
  - `/api/geo/cep?cep=01001000` → flat CepResult ✓
  - `/api/quotes` POST (as client) → creates request + items with
    `status=PENDING`, `expiresAt=now+7d` ✓
  - `/api/bookings` GET (as client) ✓
  - `/api/reviews` POST on already-reviewed booking → 400
    "Este agendamento já foi avaliado" ✓
  - `/api/messages` POST (client→provider) → 201 + creates notification ✓
  - `/api/notifications` GET → items + unreadCount ✓
  - `/api/admin/stats` (admin) → full aggregate object ✓
  - `/api/admin/users` (admin) → paginated users (no passwordHash) ✓
  - `/api/upload` (no auth → 401; no file → 400; corrupt image → 400;
    real image → 201 + webp saved) ✓

## Caveats for next agents

1. **`src/lib/api.ts` is the client-side typed fetch wrapper** (foundation).
   Do NOT import server-only helpers from it. Use `@/lib/api-server` for
   route handlers.
2. **Some routes return flat arrays** (categories, services, favorites) and
   some return wrapped objects (quotes/bookings/reviews/admin) — the
   difference is intentional, matching what the UI's `apiGet<T>` calls
   expect. Check the consumer's expected type before changing any
   response shape.
3. **Reviews on `/api/providers/[id]`** are mapped with `author` (not
   `client`) because the UI's `ProviderReview` type uses `author`.
4. **Booking status transitions** are enforced server-side; if you need to
   add new transitions (e.g. provider marks COMPLETED), update
   `PROVIDER_NEXT` / `CLIENT_NEXT` in `src/app/api/bookings/[id]/route.ts`.
5. **Payment is simulated** — `/api/bookings/[id]/pay` and booking CONFIRM
   both set `paymentStatus=PAID` with a fake `transactionId`. Real gateway
   integration is out of MVP scope.
6. **Upload** writes to `public/uploads/<uuid>.webp` (not committed to git
   in production; would need a CDN/object storage swap later).
7. **Quote items** only support a single primary provider (the outer
   `providerId`); the per-item `providerId` sent by the UI is currently
   stripped by Zod. Multi-provider quotes are a future feature.
