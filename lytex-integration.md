# Plan: Lytex Integration & Wallet / Live Tracking Enhancements

## Overview
Enable simulated wallet view for local providers, live tracking navigation for clients, and fix critical compile-time TypeScript errors.

## Success Criteria
- Providers without a Lytex ID can view simulated balances and split histories on the finance dashboard.
- Clients can click "Rastrear" on active bookings, opening the live tracking screen in a new tab.
- TypeScript compiler errors in webhooks/tracking APIs and push-subscriber components are resolved.

## Tech Stack
- Next.js 16 + React 19
- Tailwind v4 + shadcn/ui
- Prisma + PostgreSQL/SQLite
- Socket.io 4 + MapLibre GL JS

## Proposed Changes

### Task 1: Simulated Lytex Wallet View
- **File**: `src/app/api/provider/lytex/route.ts`
- **Logic**: If Lytex credentials or `user.lytexRecipientId` are missing, compute simulated metrics:
  - `balance`: `0.85` * sum of completed and paid bookings.
  - `pendingBalance`: `0.85` * sum of confirmed/in-progress paid bookings.
  - `totalReceived`: total earned.
  - `splits`: generated from completed bookings.

### Task 2: Live Tracking Navigation
- **File**: `src/components/client/client-bookings.tsx`
- **Logic**: Add "Rastrear" button for client bookings in status `IN_PROGRESS`, opening `/tracking/[id]` in `_blank`.
- **File**: `src/app/api/tracking/[id]/route.ts`
- **Logic**: Fix implicit null typecheck error on `routeInfo`.

### Task 3: TypeScript Compile Fixes
- **File**: `src/components/shared/push-subscriber.tsx`
- **Logic**: Fix `applicationServerKey` type incompatibility using `as any`.

## Verification
- `powershell -ExecutionPolicy Bypass -Command "bun run vitest run src/lib/__tests__/lytex.test.ts src/app/api/__tests__/webhooks-lytex-route.test.ts"`
- `powershell -ExecutionPolicy Bypass -Command "bun run tsc --noEmit"`
