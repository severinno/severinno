-- Migration: add_password_changed_at
-- Created: 2026-08-16
-- Description: Track last password change so the revoke-inactive-sessions cron
-- can revoke stale sockets of users who changed their password N days ago
-- (extra defense after suspected leaks), plus a once-only marker
-- (revokedByCronAt) that prevents the cron from re-revoking the same users
-- every day (passwordChangedAt does not change on login).

ALTER TABLE "User" ADD COLUMN "passwordChangedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "revokedByCronAt" TIMESTAMP(3);
