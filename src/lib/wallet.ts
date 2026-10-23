import "server-only"
import { db } from "./db"
import { FEE_RATE } from "./constants"
import { toDecimal, feeOf } from "./money"
import { Prisma } from "@prisma/client"
import DecimalJS from "decimal.js"

const DecimalCtor = DecimalJS as unknown as typeof Prisma.Decimal

export { FEE_RATE }

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Transaction = {
  id: string
  bookingId: string
  amount: number
  fee: number
  netAmount: number
  status: "paid" | "pending" | "refunded" | "withdrawn"
  description: string
  clientName: string
  date: string
}

export type SimulatedWallet = {
  balance: number
  pendingBalance: number
  totalReceived: number
  totalBookings: number
  avgTicket: number
  totalWithdrawn: number
  pendingWithdrawalsAmount: number
  pendingWithdrawalsCount: number
  escrowInCustody: number
  escrowReleased: number
  transactions: Transaction[]
}

// ---------------------------------------------------------------------------
// Balance computation — acumulação em Decimal puro (comissão em base 10
// exata, sem roundtrip por number); conversão para `number` acontece só na
// montagem do payload (fronteira de serialização, contrato da API).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Saldo do prestador — FONTE ÚNICA no banco.
//
// Regra da casa (incidente 10/2026): saldo NUNCA é somado a partir de uma
// página de linhas carregadas para a tela. A versão anterior usava
// `findMany({ take: 1000 })` e `take: 200`, o que subestimava o saldo de
// qualquer prestador acima do teto — sem erro, sem log, silenciosamente.
//
// A soma agora é uma agregação SQL: exata por LINHA (ROUND por booking, a
// mesma semântica de `netOf`), independente do volume e com o filtro de
// soft delete explícito (SQL bruto NÃO passa pela extensão Prisma).
// ---------------------------------------------------------------------------

/**
 * Cliente mínimo da agregação: só `$queryRaw`. O client do app é ESTENDIDO
 * (`$extends` para soft delete), e a extensão não é atribuível a
 * `Prisma.TransactionClient` — pedir apenas o método que usamos mantém a
 * assinatura compatível com `db` e com `tx`.
 */
type RawQueryClient = Pick<Prisma.TransactionClient, "$queryRaw">

/** Linha única devolvida pela agregação. `numeric` → Prisma.Decimal. */
type ProviderBalanceRow = {
  earnedNet: Prisma.Decimal | string | number | null
  grossReceived: Prisma.Decimal | string | number | null
  grossCompleted: Prisma.Decimal | string | number | null
  completedCount: bigint | number | string | null
  pendingNet: Prisma.Decimal | string | number | null
  totalWithdrawn: Prisma.Decimal | string | number | null
  totalPending: Prisma.Decimal | string | number | null
  pendingCount: bigint | number | string | null
}

export type ProviderBalanceSnapshot = {
  /** Líquido (gross − comissão por linha) de bookings PAID + COMPLETED. */
  earnedNet: Prisma.Decimal
  /** Bruto recebido (PAID, qualquer status). */
  grossReceived: Prisma.Decimal
  /** Bruto concluído (PAID + COMPLETED). */
  grossCompleted: Prisma.Decimal
  completedCount: number
  /** Líquido em custódia (PAID ainda não concluído). */
  pendingNet: Prisma.Decimal
  totalWithdrawn: Prisma.Decimal
  totalPending: Prisma.Decimal
  pendingCount: number
  /** earnedNet − saques concluídos − saques pendentes (nunca negativo). */
  available: Prisma.Decimal
}

/**
 * Snapshot contábil do prestador em UMA ida ao banco.
 *
 * `client` aceita uma transação Prisma: o saque precisa calcular e gravar o
 * mesmo saldo sob o mesmo snapshot (isolationLevel Serializable).
 */
export async function computeProviderBalance(
  providerId: string,
  client: RawQueryClient = db,
): Promise<ProviderBalanceSnapshot> {
  // A taxa vai como TEXTO e é convertida para numeric no banco: passar
  // number faria o Postgres promover `numeric * float8`, reintroduzindo erro
  // binário justamente na conta que o Decimal existe para proteger.
  const rate = FEE_RATE.toString()

  const rows = await client.$queryRaw<ProviderBalanceRow[]>`
    SELECT
      COALESCE((SELECT SUM(b."amount" - ROUND(b."amount" * ${rate}::numeric, 2))
        FROM "Booking" b
        WHERE b."providerId" = ${providerId}
          AND b."status" = 'COMPLETED'
          AND b."paymentStatus" = 'PAID'
          AND b."deletedAt" IS NULL), 0) AS "earnedNet",
      COALESCE((SELECT SUM(b."amount") FROM "Booking" b
        WHERE b."providerId" = ${providerId}
          AND b."paymentStatus" = 'PAID'
          AND b."deletedAt" IS NULL), 0) AS "grossReceived",
      COALESCE((SELECT SUM(b."amount") FROM "Booking" b
        WHERE b."providerId" = ${providerId}
          AND b."status" = 'COMPLETED'
          AND b."paymentStatus" = 'PAID'
          AND b."deletedAt" IS NULL), 0) AS "grossCompleted",
      COALESCE((SELECT COUNT(*) FROM "Booking" b
        WHERE b."providerId" = ${providerId}
          AND b."status" = 'COMPLETED'
          AND b."paymentStatus" = 'PAID'
          AND b."deletedAt" IS NULL), 0) AS "completedCount",
      COALESCE((SELECT SUM(b."amount" - ROUND(b."amount" * ${rate}::numeric, 2))
        FROM "Booking" b
        WHERE b."providerId" = ${providerId}
          AND b."paymentStatus" = 'PAID'
          AND b."status" IN ('CONFIRMED', 'IN_PROGRESS')
          AND b."deletedAt" IS NULL), 0) AS "pendingNet",
      COALESCE((SELECT SUM(w."amount") FROM "WalletTransaction" w
        WHERE w."providerId" = ${providerId}
          AND w."status" = 'completed'), 0) AS "totalWithdrawn",
      COALESCE((SELECT SUM(w."amount") FROM "WalletTransaction" w
        WHERE w."providerId" = ${providerId}
          AND w."status" = 'pending'), 0) AS "totalPending",
      COALESCE((SELECT COUNT(*) FROM "WalletTransaction" w
        WHERE w."providerId" = ${providerId}
          AND w."status" = 'pending'), 0) AS "pendingCount"
  `

  const row = rows[0]
  const earnedNet = toDecimal(row?.earnedNet)
  const totalWithdrawn = toDecimal(row?.totalWithdrawn)
  const totalPending = toDecimal(row?.totalPending)
  const available = earnedNet.minus(totalWithdrawn).minus(totalPending)

  return {
    earnedNet: earnedNet.toDecimalPlaces(2),
    grossReceived: toDecimal(row?.grossReceived).toDecimalPlaces(2),
    grossCompleted: toDecimal(row?.grossCompleted).toDecimalPlaces(2),
    completedCount: Number(row?.completedCount ?? 0),
    pendingNet: toDecimal(row?.pendingNet).toDecimalPlaces(2),
    totalWithdrawn: totalWithdrawn.toDecimalPlaces(2),
    totalPending: totalPending.toDecimalPlaces(2),
    pendingCount: Number(row?.pendingCount ?? 0),
    available: available.isNegative() ? new DecimalCtor(0) : available.toDecimalPlaces(2),
  }
}

/**
 * Tamanho da página de TRANSAÇÕES exibidas no extrato. É paginação de tela —
 * nunca foi (e não é) base de soma: os totais vêm de `computeProviderBalance`.
 */
const TRANSACTIONS_PAGE_SIZE = 200

/**
 * Compute the base balance from PAID bookings, returning detailed breakdown
 * with transactions grouped by status.
 *
 * Totais: agregação no banco (sem teto). `transactions`: página de exibição.
 * `snapshot` opcional evita repetir a agregação quando o caller já a tem
 * (GET /api/provider/wallet precisa do mesmo snapshot em duas funções).
 */
export async function computeBaseBalance(providerId: string, snapshot?: ProviderBalanceSnapshot) {
  const [balance, bookings] = await Promise.all([
    snapshot ?? computeProviderBalance(providerId),
    db.booking.findMany({
      where: { providerId, paymentStatus: "PAID" },
      select: {
        id: true,
        amount: true,
        status: true,
        paymentStatus: true,
        createdAt: true,
        service: { select: { title: true } },
        client: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: TRANSACTIONS_PAGE_SIZE,
    }),
  ])

  const transactions: Transaction[] = []

  for (const b of bookings) {
    const amountD = toDecimal(b.amount)
    const feeD = feeOf(amountD)
    const netD = amountD.minus(feeD) // gross − fee já arredondado: soma exata

    if (b.paymentStatus === "PAID") {
      if (b.status === "COMPLETED") {
        transactions.push({
          id: `SIM-TXN-${b.id.slice(0, 8).toUpperCase()}`,
          bookingId: b.id,
          amount: amountD.toNumber(),
          fee: feeD.toNumber(),
          netAmount: netD.toNumber(),
          status: "paid",
          description: b.service.title,
          clientName: b.client.name,
          date: b.createdAt.toISOString(),
        })
      } else if (b.status === "CONFIRMED" || b.status === "IN_PROGRESS") {
        transactions.push({
          id: `SIM-TXN-${b.id.slice(0, 8).toUpperCase()}`,
          bookingId: b.id,
          amount: amountD.toNumber(),
          fee: feeD.toNumber(),
          netAmount: netD.toNumber(),
          status: "pending",
          description: b.service.title,
          clientName: b.client.name,
          date: b.createdAt.toISOString(),
        })
      }
    }
  }

  return {
    balance: balance.earnedNet,
    pendingBalance: balance.pendingNet,
    totalReceived: balance.grossReceived,
    completedCount: balance.completedCount,
    completedSum: balance.grossCompleted,
    transactions,
  }
}

/**
 * Fetch the most recent completed and pending withdrawals for a provider.
 *
 * Totais vêm da agregação (`computeProviderBalance`), não da página — a lista
 * é só o extrato exibido (últimos 100 de cada status).
 */
export async function getWithdrawals(providerId: string, snapshot?: ProviderBalanceSnapshot) {
  const [balance, completedWithdrawals, pendingWithdrawalsList] = await Promise.all([
    snapshot ?? computeProviderBalance(providerId),
    db.walletTransaction.findMany({
      where: { providerId, status: "completed" },
      select: { id: true, amount: true, description: true, createdAt: true, status: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    db.walletTransaction.findMany({
      where: { providerId, status: "pending" },
      select: { id: true, amount: true, description: true, createdAt: true, status: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ])

  // Backward compatible filtering in case generic mocks returned all records
  const actualCompleted = completedWithdrawals.filter((w) => !w.status || w.status === "completed")
  const actualPending = pendingWithdrawalsList.filter((w) => w.status === "pending")

  const withdrawalTxns: Transaction[] = []

  for (const w of actualCompleted) {
    const amountD = toDecimal(w.amount)
    withdrawalTxns.push({
      id: `SIM-WTH-${w.id.slice(0, 8).toUpperCase()}`,
      bookingId: "",
      amount: amountD.toNumber(),
      fee: 0,
      netAmount: amountD.toNumber(),
      status: "withdrawn",
      description: w.description ?? "Saque PIX realizado",
      clientName: "—",
      date: w.createdAt.toISOString(),
    })
  }

  for (const pw of actualPending) {
    const amountD = toDecimal(pw.amount)
    withdrawalTxns.push({
      id: `SIM-WTH-PEND-${pw.id.slice(0, 8).toUpperCase()}`,
      bookingId: "",
      amount: amountD.toNumber(),
      fee: 0,
      netAmount: amountD.toNumber(),
      status: "pending",
      description: pw.description ?? "Saque PIX em processamento",
      clientName: "—",
      date: pw.createdAt.toISOString(),
    })
  }

  return {
    totalWithdrawn: balance.totalWithdrawn,
    pendingWithdrawalsAmount: balance.totalPending,
    pendingWithdrawalsCount: balance.pendingCount,
    withdrawalTxns,
  }
}

/**
 * Compute the current available balance for a provider (used by POST withdraw
 * to validate if there's enough balance). Only considers COMPLETED + PAID
 * bookings minus total completed AND pending withdrawals (prevents double-spending).
 *
 * O cálculo é uma agregação no banco — NUNCA uma página de linhas. O teto
 * `take: 1000` da versão anterior truncava o saldo de prestadores grandes sem
 * nenhum sinal de erro.
 *
 * Decimal puro de ponta a ponta — o retorno é `Prisma.Decimal`.
 */
export async function computeAvailableBalance(providerId: string): Promise<Prisma.Decimal> {
  const { available } = await computeProviderBalance(providerId)
  return available
}

/**
 * Build the full SimulatedWallet object from base balance + withdrawals.
 * ÚNICA fronteira de conversão Decimal → number do módulo (payload JSON).
 */
export function buildWallet(
  base: Awaited<ReturnType<typeof computeBaseBalance>>,
  withdrawals: {
    totalWithdrawn: Prisma.Decimal
    pendingWithdrawalsAmount?: Prisma.Decimal
    pendingWithdrawalsCount?: number
    withdrawalTxns: Transaction[]
  },
): SimulatedWallet {
  const adjustedBalance = base.balance.minus(withdrawals.totalWithdrawn)
  const adjusted = adjustedBalance.isNegative() ? new DecimalCtor(0) : adjustedBalance

  const allTxns = [...withdrawals.withdrawalTxns, ...base.transactions].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  )

  const round2 = (d: Prisma.Decimal) => d.toDecimalPlaces(2).toNumber()
  const pendingWithdrawn = withdrawals.pendingWithdrawalsAmount ?? new DecimalCtor(0)

  return {
    balance: round2(adjusted),
    pendingBalance: round2(base.pendingBalance),
    totalReceived: round2(base.totalReceived),
    totalBookings: base.completedCount,
    avgTicket:
      base.completedCount > 0
        ? base.completedSum.dividedBy(base.completedCount).toDecimalPlaces(2).toNumber()
        : 0,
    totalWithdrawn: round2(withdrawals.totalWithdrawn),
    pendingWithdrawalsAmount: round2(pendingWithdrawn),
    pendingWithdrawalsCount: withdrawals.pendingWithdrawalsCount ?? 0,
    escrowInCustody: round2(base.pendingBalance),
    escrowReleased: round2(base.balance),
    transactions: allTxns,
  }
}
