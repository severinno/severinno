/**
 * Teste estrutural do guard money-decimal — seção 37 do GUARDS.md.
 *
 * O guard real (scripts/check-money-decimal.sh) precisa de um banco
 * Postgres para rodar — aqui validamos o CONTRATO estrutural que o mantém
 * são no tempo:
 *
 *   1. shell bash com `set -euo pipefail` (a seção 20 do GUARDS.md exige
 *      pipefail em todo script de verificação — sem ele, um psql falho no
 *      meio de um pipe sanciona violação silenciosamente);
 *   2. cabeçalho com Usage e exit codes documentados (padrão check-script-headers);
 *   3. as 11 colunas monetárias da migration money_decimal declaradas com
 *      a precisão esperada — a lista do guard É a fonte da verdade do
 *      escopo, e não pode encolher silenciosamente;
 *   4. a fiação no CI: o passo "Money decimal guard" existe no job
 *      prisma-migrations do infra-guards.yml, DEPOIS do guard de migrations
 *      (ordem que garante schema completo + banco efêmero) e no padrão de
 *      transporte do job (psql de DENTRO do service container).
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = join(__dirname, "../../..")
const GUARD = readFileSync(join(ROOT, "scripts/check-money-decimal.sh"), "utf8")
const WORKFLOW = readFileSync(join(ROOT, ".github/workflows/infra-guards.yml"), "utf8")

describe("check-money-decimal.sh — contrato estrutural (seção 37)", () => {
  it("é bash com pipefail obrigatório (seção 20 do GUARDS.md)", () => {
    expect(GUARD).toContain("#!/usr/bin/env bash")
    expect(GUARD).toContain("set -euo pipefail")
  })

  it("documenta Usage e exit codes no cabeçalho", () => {
    expect(GUARD).toContain("# Usage:")
    expect(GUARD).toContain("#   0 —")
    expect(GUARD).toContain("#   1 —")
    expect(GUARD).toContain("#   2 —")
  })

  it("declara as 11 colunas monetárias com a precisão da migration money_decimal", () => {
    const expected = [
      "Service.basePrice=10,2",
      "QuoteItem.price=10,2",
      "Booking.amount=10,2",
      "Payment.amount=10,2",
      "SettlementPeriod.totalCommission=12,2",
      "SettlementPeriod.totalNet=12,2",
      "SettlementPeriod.totalAmount=12,2",
      "ProviderSettlement.totalAmount=12,2",
      "ProviderSettlement.commission=12,2",
      "ProviderSettlement.netAmount=12,2",
      "WalletTransaction.amount=10,2",
    ]
    for (const entry of expected) {
      expect(GUARD, `coluna ausente da régua: ${entry}`).toContain(`'${entry}'`)
    }
  })

  it("julga os objetos canônicos que a migration derruba e recria", () => {
    expect(GUARD).toContain("mv_provider_stats")
    expect(GUARD).toContain("trg_refresh_mv_on_booking")
    expect(GUARD).toContain("trg_search_reindex_service")
  })

  it("prova o round-trip exato que motiva a conversão (0.1+0.2)", () => {
    expect(GUARD).toContain("0.1")
    expect(GUARD).toContain("0.30")
    expect(GUARD).toContain("numeric")
  })

  it("--ephemeral tem intertravamento: só banco de nome descartável", () => {
    expect(GUARD).toContain("--ephemeral")
    expect(GUARD).toMatch(/severinno_test\|\*_test\|money_check/)
  })

  it("transporte docker-exec (padrão do job) e fallback psql $DATABASE_URL", () => {
    expect(GUARD).toContain("PG_CONTAINER")
    expect(GUARD).toContain("docker exec")
    expect(GUARD).toContain("DATABASE_URL")
  })
})

describe("fiação no CI — job prisma-migrations do infra-guards.yml", () => {
  const jobStart = WORKFLOW.indexOf("prisma-migrations:")
  const nextJob = WORKFLOW.indexOf("security-headers:")
  const jobBody = jobStart !== -1 && nextJob > jobStart ? WORKFLOW.slice(jobStart, nextJob) : ""

  it("o passo Money decimal guard existe dentro do job prisma-migrations", () => {
    expect(jobStart).toBeGreaterThan(-1)
    expect(nextJob).toBeGreaterThan(jobStart)
    expect(jobBody).toContain("Money decimal guard")
  })

  it("roda DEPOIS do guard de migrations (ordem: migrate deploy → migrations guard → money guard)", () => {
    const migrationsGuard = jobBody.indexOf("check-prisma-migrations.sh")
    const moneyGuard = jobBody.indexOf("check-money-decimal.sh")
    expect(migrationsGuard).toBeGreaterThan(-1)
    expect(moneyGuard).toBeGreaterThan(migrationsGuard)
  })

  it("usa --ephemeral (banco do job é descartável) e o transporte docker-exec do job", () => {
    const moneyStep = jobBody.indexOf("Money decimal guard")
    const stepTail = jobBody.slice(moneyStep)
    expect(stepTail).toContain("--ephemeral")
    expect(stepTail).toContain("PG_CONTAINER")
    expect(stepTail).toContain("job.services.postgres.id")
    expect(stepTail).toContain("PGUSER: severinno")
    expect(stepTail).toContain("PGDATABASE: severinno_test")
  })

  it("o header do workflow declara o guard (documento = comportamento)", () => {
    expect(WORKFLOW).toContain("money-decimal")
    expect(WORKFLOW).toContain("check-money-decimal.sh")
  })
})
