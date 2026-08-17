-- Severinno Marketplace — add User.plan (tenant/plano do usuário)
--
-- O realtime mini-service lê o plano no join e resolve o limite de sessões
-- simultâneas por plano (REALTIME_MAX_SESSIONS_PER_PLAN) com fallback ao
-- per-role atual (REALTIME_MAX_SESSIONS_PER_ROLE) e ao default global.
-- Default FREE — todos os usuários existentes herdam o plano gratuito.
-- Valores: "FREE" | "PREMIUM" (String, igual ao role — SQLite/Postgres não
-- usam enum nativo neste repo; validação é documental).

ALTER TABLE "User" ADD COLUMN "plan" TEXT NOT NULL DEFAULT 'FREE';
