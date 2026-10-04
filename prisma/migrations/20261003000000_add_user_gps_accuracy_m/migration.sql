-- Item 7 — persistir a última accuracy do GPS no perfil do prestador.
--
-- A coluna alimenta o círculo pontilhado de incerteza (± m) no mini-map do
-- modal do prestador mesmo quando a localização vem salva (sem nova fix).
-- Payload público via PUBLIC_PROVIDER_SELECT / USER_PUBLIC_SELECT; escrita
-- pelo PATCH /api/users/me (providerProfileSchema).
ALTER TABLE "User" ADD COLUMN "gpsAccuracyM" DOUBLE PRECISION;
