-- Auditabilidade do agendamento: quantidade e unidade contratadas.
-- amount já reflete basePrice × quantity (calculado no servidor); estas
-- colunas preservam os fatores para relatórios/financeiro.
ALTER TABLE "Booking" ADD COLUMN "quantity" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Booking" ADD COLUMN "unit" "ServiceUnit" NOT NULL DEFAULT 'UNIDADE';
