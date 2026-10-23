-- Auditabilidade do agendamento: quantidade e unidade contratadas.
-- amount já reflete basePrice × quantity (calculado no servidor); estas
-- colunas preservam os fatores para relatórios/financeiro.
-- Idempotente (IF NOT EXISTS): retry após falha parcial converge em vez de
-- travar em 42701 — mesma classe da 20261010150000 (travada em 2026-10-10).
ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "quantity" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "unit" "ServiceUnit" NOT NULL DEFAULT 'UNIDADE';
