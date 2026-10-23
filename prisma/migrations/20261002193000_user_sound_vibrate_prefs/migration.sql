-- Preferências de UI do painel do prestador: som e vibração.
-- O cliente lê/grava via PATCH /api/users/me (providerProfileSchema já aceita
-- os campos) — as colunas não existiam e o update quebrava com
-- PrismaClientValidationError (500 no passo 0 do onboarding).
ALTER TABLE "User" ADD COLUMN "soundEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN "vibrateEnabled" BOOLEAN NOT NULL DEFAULT true;
