# Cache Strategy — Severinno Marketplace

> **Three layers of caching** working together to deliver fast responses while
> keeping data fresh: Redis (server-side compute cache), HTTP Cache-Control
> (CDN/edge), and Browser cache (private per-user state).

## Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Browser/Disk Cache                    │
│                (private, per-user, max-age)              │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│              CDN / Edge Cache (s-maxage)                 │
│             (shared, Vary-separated copies)              │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│              Next.js API Route (handler)                 │
│         ┌─────────────────────────────────────┐         │
│         │   cacheControlPublic / Private       │         │
│         └─────────────────────────────────────┘         │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│              Redis Cache (withCache)                     │
│   ┌──────────┬───────────┬────────────┬──────────┐      │
│   │ PostGIS  │  Category │ User Auth  │ Distance │      │
│   │ ~60s TTL │ ~600s TTL │  ~300s TTL │  ~60s TTL│      │
│   └──────────┴───────────┴────────────┴──────────┘      │
└─────────────────────────────────────────────────────────┘
```

---

## Layer 1: Redis (Server-Side Compute Cache)

**File:** `src/lib/redis.ts`

Redis caches the **result of expensive computations** (spatial queries, category
tree traversal, user auth lookups) so the same DB query is not repeated within
the TTL window. Redis is **optional** — all operations fail silent if Redis is
unavailable, and the app falls back to direct DB queries.

### Cache Patterns

| Pattern | Function | Use Case |
|---------|----------|----------|
| Cache-aside | `withCache(key, fn, ttl)` | Generic: return cached value or compute + store |
| Get | `cacheGet<T>(key)` | Manual read |
| Set | `cacheSet(key, value, ttl?)` | Manual write |
| Invalidate | `cacheInvalidate(pattern)` | Glob-pattern delete (e.g. `cat:desc:*`) |

### Cache Keys and TTLs

| Key Pattern | Description | TTL | Source File |
|-------------|-------------|:---:|-------------|
| `proximity:{lat}:{lng}:{radiusKm}` | PostGIS provider proximity query | **60s** | `src/lib/postgis.ts` |
| `distance:{uid1}:{uid2}` | Distance between two users | **60s** | `src/lib/postgis.ts` |
| `postgis:available` | PostGIS extension presence check | **300s (5m)** | `src/lib/postgis.ts` |
| `cat:desc:{categoryId}` | Category tree descendants | **600s (10m)** | `src/lib/api-server.ts` |
| `user:active:{userId}` | User active status (auth guard) | **300s (5m)** | `src/lib/auth.ts` |

### Graceful Degradation

If Redis is down or unreachable:
- `cacheGet` returns `null` (cache miss)
- `cacheSet` / `cacheInvalidate` silently no-op
- The app continues to work — responses are computed fresh from PostgreSQL
- No error propagation to the API response

---

## Layer 2: HTTP Cache-Control (CDN / Edge)

**File:** `src/lib/api-server.ts`

HTTP headers control **what can be cached, for how long, and by whom**:
- **CDN/proxy caches** observe `s-maxage`
- **Browser caches** observe `max-age`
- Both use `Vary` to separate cached copies by request properties

### Two Cache Functions

#### `cacheControlPublic(response, maxAge, staleWhileRevalidate?)`

For **public, non-personalized data**. Both CDN and browser may cache.

```typescript
// Sets:
Cache-Control: public, max-age=60, s-maxage=60
Vary: Accept-Encoding, Accept, Origin
```

| Parameter | Default | Description |
|-----------|---------|-------------|
| `maxAge` | — | `max-age` in seconds (browser cache) |
| `staleWhileRevalidate` | `= maxAge` | `s-maxage` in seconds (CDN cache). If omitted, `s-maxage` = `maxAge` |

**Vary values:**
- `Accept-Encoding` — separate copies for gzip vs uncompressed
- `Accept` — separate copies for JSON vs future content types
- `Origin` — separate copies per CORS origin (future-proofing)

#### `cacheControlPrivate(response, maxAge)`

For **user-personalized data** (e.g. the `favorited` flag on provider details).
Only the browser may cache; CDN/proxies must not.

```typescript
// Sets:
Cache-Control: private, max-age=60        // ← NO s-maxage!
Vary: Cookie, Accept-Encoding, Accept
```

**Key differences from public:**
- No `s-maxage` — shared caches must not store private responses
- `Vary: Cookie` — different users get separate cached copies by session cookie

### Common Rules

| Rule | Applies To | Reason |
|------|------------|--------|
| Never apply cache headers to error responses | All routes | `handleError` paths are excluded from caching |
| Always apply cache headers on 200, even if data is empty | Public routes | CDN should cache "empty" to avoid DDoS on DB |
| Apply cache headers only on 200 for personalized routes | Private routes | 404 errors go through `handleError` — no cache |
| `s-maxage` >= `max-age` for public routes | All public routes | CDN should be at least as permissive as browser |

---

## Layer 3: Client-Side (React Query)

**File:** `src/lib/query-client.ts`

React Query provides client-side caching with:

```typescript
// Defaults (set in QueryClient configuration):
staleTime: 30_000        // 30s — data is fresh (no refetch)
gcTime:  300_000         // 5min — unused data stays in cache
retry: 2                 // retry twice on failure
refetchOnWindowFocus: true  // auto-refresh when user returns to tab
```

Individual queries can override these defaults as needed.

### Interaction with HTTP Cache

```
Browser cache (HTTP)        React Query cache
─────────────────           ────────────────
max-age=60                  staleTime: 30s
                            gcTime: 5min

  First request:
    HTTP miss → React Query fetches → HTTP response cached for 60s
  Next request (within 60s):
    HTTP cache hit → instant response
  After 60s, after 30s staleTime:
    React Query serves stale data + refetches in background
```

---

## Cached Routes Manifest

### Public Routes (10) — `cacheControlPublic`

| Route | max-age | s-maxage | Vary |
|-------|:-------:|:--------:|:----:|
| `GET /api/categories` | **120s** | **600s** | `Accept-Encoding, Accept, Origin` |
| `GET /api/geo/cep` | **60s** | **60s** | `Accept-Encoding, Accept, Origin` |
| `GET /api/geo/reverse` | **60s** | **60s** | `Accept-Encoding, Accept, Origin` |
| `GET /api/providers` | **60s** | **60s** | `Accept-Encoding, Accept, Origin` |
| `GET /api/reviews/recent` | **60s** | **300s** | `Accept-Encoding, Accept, Origin` |
| `GET /api/search` | **30s** | **30s** | `Accept-Encoding, Accept, Origin` |
| `GET /api/search/providers` | **30s** | **30s** | `Accept-Encoding, Accept, Origin` |
| `GET /api/search/services` | **30s** | **30s** | `Accept-Encoding, Accept, Origin` |
| `GET /api/services` | **30s** | **120s** | `Accept-Encoding, Accept, Origin` |
| `GET /api/stats/public` | **30s** | **120s** | `Accept-Encoding, Accept, Origin` |

### Private Route (1) — `cacheControlPrivate`

| Route | max-age | s-maxage | Vary |
|-------|:-------:|:--------:|:----:|
| `GET /api/providers/[id]` | **60s** | — | `Cookie, Accept-Encoding, Accept` |

### Rationale Per Route

| Route | Why This TTL | Notes |
|-------|--------------|-------|
| `/api/categories` | Category tree changes rarely (admins only). Highest TTL. | 404 on empty tree — no cache |
| `/api/geo/cep` | CEP → address is stable. Conservative 60s. | 404 on unknown CEP — no cache |
| `/api/geo/reverse` | lat/lng → address via external API. 60s absorbs repeated lookups. | 400/502 errors — no cache |
| `/api/providers` | Provider listing with geo + filters. 60s is a good balance. | 400 on `sort=distance` without coords — no cache |
| `/api/providers/[id]` | **Private** — contains `favorited` flag per user. Vary:Cookie separates sessions. | 404 — no cache |
| `/api/reviews/recent` | Reviews change slowly. s-maxage=300s for CDN resilience. | — |
| `/api/search` | Text search results. Short TTL for freshness. | 400 on missing `q` — no cache |
| `/api/search/providers` | Geolocated provider search. Same TTL as `/api/search`. | All errors via `handleError` |
| `/api/search/services` | Textual service search. Short TTL. | 400 on missing `q` — no cache |
| `/api/services` | Service listing. s-maxage=120s longer than max-age=30s for CDN resilience. | — |
| `/api/stats/public` | Aggregate counters (providers, bookings, etc.). s-maxage=120s. | Fallback returns zeros on error (no cache) |

---

## Vary Policy

The `Vary` header tells caches which request properties affect the response,
so the cache stores separate copies for each variant.

### Public Routes

```
Vary: Accept-Encoding, Accept, Origin
```

| Vary Value | Why |
|------------|-----|
| `Accept-Encoding` | Separate cached copies for compressed vs uncompressed responses. Without this, a CDN might serve a gzip response to a client that doesn't support it. |
| `Accept` | Separate copies for different content types (`application/json` vs `text/html`). Safety net for future content negotiation. |
| `Origin` | Separate copies per CORS origin. Future-proofing — if the API is consumed by multiple origins, cached responses won't leak across them. |

### Private Route

```
Vary: Cookie, Accept-Encoding, Accept
```

| Vary Value | Why |
|------------|-----|
| `Cookie` | **Key difference from public.** Different users have different session cookies, so each gets their own cached copy. Prevents user A from seeing user B's `favorited` state. |
| `Accept-Encoding` | Same as public — compression safety. |
| `Accept` | Same as public — content type safety. |

> **Important:** `Vary: Cookie` is not a security boundary — it only separates
> cache keys in shared caches. The `private` directive in `Cache-Control` is
> the actual mechanism that prevents CDN storage.

---

## How to Add a New Cached Route

Adding cache to a new route is a **4-step process**:

### Step 1: Import the cache function

```typescript
// For public data:
import { handleError, cacheControlPublic } from "@/lib/api-server"

// For user-personalized data:
import { handleError, cacheControlPrivate } from "@/lib/api-server"
```

### Step 2: Wrap the success response

```typescript
// Public example (GET /api/my-route):
return cacheControlPublic(NextResponse.json(result), 60)

// With different CDN TTL (s-maxage = 300 for CDN, 30 for browser):
return cacheControlPublic(NextResponse.json(result), 30, 300)

// Private example (with user-specific data):
return cacheControlPrivate(NextResponse.json(result), 60)
```

**Rules:**
- Wrap **only the 200 OK** response path
- Error paths (400, 404, 500, etc.) go through `handleError` — **never cache errors**
- Early returns (e.g. validation failures) must stay uncached
- The response object is mutated in-place — `cacheControlPublic(res, maxAge)`
  returns the same `res` object

### Step 3: Update both manifests

The cache route configuration lives in **two places** that must be kept in sync:

1. **Test manifest** — `src/app/api/__tests__/all-cache-routes.test.ts`:

   ```typescript
   const CACHED_ROUTES = [
     // ... existing routes ...
     { path: "/api/my-route", method: "GET", type: "public",
       maxAge: 60, sMaxage: 60,
       vary: "Accept-Encoding, Accept, Origin" },
   ] as const
   ```

2. **Admin dashboard** — `src/app/api/admin/cache-routes/route.ts`:

   ```typescript
   // Add to the routes array in the admin manifest
   {
     method: "GET",
     path: "/api/my-route",
     type: "public",
     maxAge: 60,
     staleWhileRevalidate: 60,
     vary: ["Accept-Encoding", "Accept", "Origin"],
     cacheControl: "public, max-age=60, s-maxage=60",
     notes: ["Brief rationale for this route's cache config."],
   },
   ```

Then run the tests to confirm all numbers are consistent:

```bash
npx vitest run src/app/api/__tests__/all-cache-routes.test.ts
```

### Step 4: Verify with a route-specific test (optional but recommended)

For routes with non-trivial error paths, create a dedicated test following
the pattern in `src/app/api/__tests__/providers-cache-header.test.ts`.

---

## CI / Validation

### Fast CI Gate: `scripts/validate-cache-manifest.ts`

Before building or running any tests, a **fast validation gate** scans all
route handler files and cross-references them against the `CACHED_ROUTES`
manifest:

```bash
# Run locally (takes ~2s):
npx tsx scripts/validate-cache-manifest.ts
```

**What it detects:**

| Issue | Message | Cause |
|-------|---------|-------|
| Missing from manifest | `MISSING FROM MANIFEST` | Route has `cacheControlPublic`/`Private` but isn't in `CACHED_ROUTES` |
| Stale manifest entry | `STALE IN MANIFEST` | Route in `CACHED_ROUTES` but no longer uses cache functions |
| TTL mismatch | `TTL MISMATCH` | `maxAge`/`sMaxage` differ between route handler and manifest |
| Type mismatch | `TYPE MISMATCH` | `public` vs `private` differs between handler and manifest |

Excluded prefixes (auth-required, mutating, or internal routes) are not
validated: `/api/admin`, `/api/auth`, `/api/bookings`, `/api/cron`, and
~20 others.

### GitHub Actions: `e2e-cache.yml`

A dedicated workflow validates cache headers end-to-end on every PR that
touches cache-related files:

```yaml
Trigger: PR/push touching
  - src/lib/api-server.ts
  - src/lib/cache-manifest.ts
  - src/app/api/**/route.ts
  - e2e/*cache*.spec.ts
  - scripts/validate-cache-manifest.ts
  - .github/workflows/e2e-cache.yml

Pipeline:
  1. Start PostgreSQL (PostGIS) + Redis as service containers
  2. Push Prisma schema
  3. ⭐ Validate cache manifest (scripts/validate-cache-manifest.ts) — fast gate
  4. Build + start Next.js (production mode)
  5. Smoke test three critical routes
  6. Run Playwright cache E2E tests
  7. Upload report on failure
```

The validation step (#3) runs **before the build** — if the manifest is out
of sync with the route handlers, CI fails in ~2 seconds instead of waiting
for the full build + E2E pipeline.

### Local Validation Script: `scripts/test-e2e-cache.sh`

```bash
# Full pipeline (starts containers, runs tests, cleans up):
./scripts/test-e2e-cache.sh

# Options:
#   --skip-docker   Use already-running containers
#   --skip-cleanup  Keep containers running after test
#   --ui            Playwright UI mode (debug visually)
```

### Test Suites

| Test file | Tests | What it covers |
|-----------|:-----:|----------------|
| `scripts/validate-cache-manifest.ts` | — | **Fast gate**: scans 79 route files, cross-references against manifest. Exits 0/1 for CI. |
| `src/lib/__tests__/api-server.test.ts` | **31** | `cacheControlPublic`, `cacheControlPrivate`, `handleError` function correctness |
| `src/app/api/__tests__/all-cache-routes.test.ts` | **29** | Manifest integrity (counts, TTLs, Vary), function parameterization, no-cache-on-error edge cases |
| `src/app/api/__tests__/providers-cache-header.test.ts` | **4** | Route-level: `/api/providers` cache headers present on 200, absent on 400/empty |
| `src/app/api/__tests__/categories-cache-header.test.ts` | **3** | Route-level: `/api/categories` cache headers with `max-age=120, s-maxage=600` |
| `e2e/providers-cache.spec.ts` | **9** | E2E via Playwright: CDN headers, repeated-call consistency, edge cache detection |
| `e2e/all-cache-routes.spec.ts` | **23** | E2E via Playwright: HTTP headers for all 11 cached routes, dynamic ID resolution, auth-skip for blocked routes |
| **Total** | **99 + fast gate** | |

### Monitoring Dashboard

`GET /api/admin/cache-routes` (requires ADMIN role) returns the complete
cache route manifest as JSON:

```json
{
  "meta": {
    "generatedAt": "2026-07-25T...",
    "totalRoutes": 11,
    "cacheControlPublic": 10,
    "cacheControlPrivate": 1
  },
  "routes": [
    {
      "path": "/api/providers",
      "type": "public",
      "maxAge": 60,
      "staleWhileRevalidate": 60,
      "vary": ["Accept-Encoding", "Accept", "Origin"],
      "cacheControl": "public, max-age=60, s-maxage=60",
      "notes": ["..."]
    }
  ]
}
```

---

## Design Decisions

### Why hard-code the cache manifest instead of introspecting at runtime?

Cache configuration is determined at **compile time** in each route's handler.
It doesn't change between deploys. A hard-coded manifest is:
- **Simpler** — no runtime scanning of route handlers
- **Fail-safe** — the type-checked manifest is the source of truth
- **Self-documenting** — developers read the manifest to understand cache config

The manifest lives in two places:
1. `src/app/api/admin/cache-routes/route.ts` — runtime API for monitoring
2. `src/app/api/__tests__/all-cache-routes.test.ts` — test-time validation

Both must be kept in sync when adding/modifying cached routes. The tests will
fail if the counts, TTLs, or Vary headers don't match expectations.

### Why `s-maxage` >= `max-age` for all public routes?

The `s-maxage` directive controls CDN/proxy cache duration, while `max-age`
controls browser cache duration. Setting `s-maxage` >= `max-age` ensures the
CDN is at least as permissive as the browser. This is the recommended pattern:
- Users get fresh data (shorter `max-age`)
- CDN absorbs more traffic (equal or longer `s-maxage`)
- `stale-while-revalidate` allows CDN to serve stale data while fetching fresh

### Why no `s-maxage` on private routes?

Per the HTTP specification, `Cache-Control: private` means "may be stored by
browsers only, not by shared caches." Adding `s-maxage` to a private response
is meaningless because shared caches (CDNs) should not store it anyway.
Explicitly omitting `s-maxage` avoids ambiguity.

### Why `Vary: Origin` on public routes?

Included for **future CORS support**. If the API is served to different origins
(e.g., an embedded widget or a partner integration), `Vary: Origin` prevents
the CDN from serving a response cached for one origin to another. Today it's a
no-op (single origin), but adding it now avoids a cache-invalidation headache
later.

### Why Redis cache TTLs are relatively short (60s)?

The Redis cache layer is a **performance optimization**, not a correctness
requirement. Short TTLs ensure:
- Stale data is served for at most 60 seconds
- High-traffic areas (provider searches) avoid repeated PostGIS queries
- Fast-changing data (user active status, location lookups) stays reasonably fresh
- If Redis goes down, the app seamlessly falls through to PostgreSQL

---

## Lessons Learned

### Next.js App Router prepends its own Vary values

**Observation:** When testing cache headers via E2E Playwright tests, the
actual `Vary` header returned by Next.js contained extra values injected by
the App Router runtime:

```http
# Expected:
Vary: Accept-Encoding, Accept, Origin

# Actual:
Vary: rsc, next-router-state-tree, next-router-prefetch,
      next-router-segment-prefetch, Accept-Encoding, Accept, Origin
```

These values (`rsc`, `next-router-state-tree`, etc.) are added by Next.js after
the route handler runs. Our `cacheControlPublic()` / `cacheControlPrivate()`
functions correctly set `Vary: Accept-Encoding, Accept, Origin`, but Next.js
prepends its own internal headers.

**Impact on tests:**
- **Unit tests (Vitest):** Not affected — they test the function directly,
  bypassing Next.js's runtime pipeline.
- **E2E tests (Playwright):** Must use `toContain()` instead of `toBe()`
  when asserting Vary values, because Next.js injects its prefixes.

```typescript
// ✅ Correct for E2E:
expect(vary).toContain("Accept-Encoding, Accept, Origin")

// ❌ Would fail in E2E (Next.js prepends its own values):
expect(vary).toBe("Accept-Encoding, Accept, Origin")
```

The `Cache-Control` header is **not** affected — Next.js does not interfere
with it, so exact-match assertions (`toBe`) work correctly for
`Cache-Control` in both unit and E2E tests.

**Why this matters:** This behavior is specific to the Next.js App Router and
may change between versions. If migrating to a different framework, revisit
these Vary assertions. The underlying contract is that our Vary values are
**always present** — they may just be surrounded by framework-specific values.

### Windows-1252 byte 0x97 corruption in route files

**Observation:** During worktree synchronization (`cp` of route handler files
between the worktree and the main project folder), some `.ts` files developed
an **invalid UTF-8 sequence** that caused Turbopack to fail compilation:

```
./src/app/api/categories/route.ts
Reading source code for parsing failed
Caused by:
- invalid utf-8 sequence of 1 bytes from index 3224
```

The offending byte was `0x97`, which is a **Windows-1252 em dash** (`—`).
In UTF-8, an em dash must be encoded as the 3-byte sequence `\xe2\x80\x94`.
The byte `0x97` appears in the same comment in both `categories/route.ts` and
`services/route.ts`:

```typescript
// search reindex (non-critical — don't fail the request)
//                              ↑ byte 0x97 instead of UTF-8 em dash
```

**Root cause:** The files were originally created or edited in a tool that
saved Windows-1252 encoded characters (common on Brazilian Windows setups
where the system locale uses Windows-1252 as the default ANSI codepage).
When copied between worktrees, the raw byte was preserved but Next.js's
Turbopack parser strictly expects UTF-8.

**How to diagnose:**

```bash
# Find files with non-UTF-8 bytes in source:
grep -rl $'\x97' src/ --include='*.ts'

# Or with od/xxd on a specific file:
od -A x -t x1z -j 3200 -N 30 src/app/api/categories/route.ts
```

**How to fix:**

```bash
# Replace 0x97 with proper UTF-8 em dash (\xe2\x80\x94):
python3 -c "
with open('path/to/file.ts', 'rb') as f:
    data = f.read()
if b'\\x97' in data:
    data = data.replace(b'\\x97', b'\\xe2\\x80\\x94')
    with open('path/to/file.ts', 'wb') as f:
        f.write(data)
    print('Fixed!')
"
```

**Prevention:**
- Ensure your editor saves files as **UTF-8 without BOM**
- Configure VS Code to always use UTF-8: `"files.encoding": "utf8"`
- Avoid pasting rich text (Word, browser) into source code comments —
  smart quotes, em dashes, and other typographic characters are often
  pasted as Windows-1252 bytes
- If using a Brazilian Portuguese keyboard layout, the em dash key
  combination (`AltGr` + `-`) may produce Windows-1252 on some terminals
- Before committing, run a quick UTF-8 check on all staged files:

```bash
# Ensure no non-UTF-8 bytes in source files
find src/ -name '*.ts' -exec sh -c '
  iconv -f utf-8 "$1" > /dev/null 2>&1 || echo "NON-UTF8: $1"
' _ {} \;
```
