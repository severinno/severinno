# Memory Index

## Project
- [project] Always create a new dedicated branch for major code changes → project-conventions.md
- [project] AG Kit only supports Gemini CLI and Google Antigravity (not other AI coding tools) → project-conventions.md
- [session: 2026-07-24] Batch 2 optimizations completed in a single session without package manager (npm/bun installs timeout on this machine) → use config-only + raw SQL approaches when packages are unavailable

## Decisions
- [notification-preferences] Use raw SQL (`$queryRawUnsafe`) for NotificationPreference queries because Prisma client cannot be regenerated with `bunx prisma generate` when packages are not fully installed. The migration SQL was applied directly via `psql`.
- [docker] Worker Dockerfile restructured to 3-stage (deps → builder → runner). Prisma generation moved to builder stage, removing `bunx prisma generate` from runtime.
- [docker] HEALTHCHECK added to both Dockerfile and Dockerfile.worker.
- [dockerignore] Extended with test files, coverage, turbo, cypress/playwright — reduces build context.
- [category-cache] GET /api/categories now uses `withCache()` Redis cache-aside with 120s TTL. Cache key includes all query params. POST/PATCH/DELETE invalidate both `categories:*` and `cat:desc:*` patterns.
- [dark-mode] Dark mode `--border` token bumped from 10% to 15% opacity, `--input` from 15% to 20%, sidebar border from 10% to 15% — improves WCAG AA compliance for non-text UI elements.
- [dark-mode] Replaced `dark:border-slate-800` with `dark:border-slate-700/60` in loading.tsx — slate-800 was nearly invisible against card background.

## Technical Constraints
- Registry is reachable but `npm install`, `bun add`, `pnpm add` all timeout/fail — cannot add new npm dependencies. Peer dependency conflict with `@sentry/nextjs` prevents `npm install`. All work avoids new packages.
- Prisma CLI not in `node_modules`. New models are created via raw `.sql` migration files and applied via `psql`.

## Decisions (session 2026-07-24 batch-3 — improvements)
- [cache] Services, reviews/recent, geo/cep, geo/reverse now use `withCache()` Redis. TTLs: services=30s, service-detail=60s, reviews=60s, cep=3600s, reverse-geo=300s.
- [error-handling] Standardized 7 routes to use `handleError()`: chat, newsletter, geo/reverse, stats/public, stats/activity, notifications/preferences (GET+PATCH), geo/cep (added cache but kept custom 404/400 catch for ViaCEP semantics).
- [error-handling] stats/public and stats/activity maintain silent-fail pattern (return zeros on error) but now log via logger instead of silent catch.
- [indexes] Created `20260724160000_add_missing_composite_indexes` migration with 7 new composite indexes for: client bookings, notification read status, message timeline, wallet history, quote items, service price sort, review booking lookup.
- [workers] Created test files for all 3 queue consumers (notification, email, search-index) following existing `queue.test.ts` mocking pattern.
- [security] Added HSTS (63072000s), X-Content-Type-Options, X-Frame-Options (DENY), Referrer-Policy (strict-origin), Permissions-Policy to middleware. CSP already existed with nonces.
- [a11y] Created `notification-preferences.accessibility.test.tsx` for new NotificationPreferences component.
- [docker] `.dockerignore` extended with test/coverage/turbo patterns.

