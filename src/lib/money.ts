/**
 * money.ts — conversão na fronteira Prisma (Decimal) → aplicação (number).
 *
 * Com a migração dos campos monetários para Decimal @db.Decimal(10,2),
 * o Prisma devolve `Prisma.Decimal` (preciso em base 10) em vez de `number`.
 * Para NÃO quebrar o contrato JSON que o frontend consome (sempre foi
 * `number`), toda leitura de campo monetário passa por `toMoneyNumber()`
 * logo na fronteira da rota/lib — a aritmética de negócio continua em
 * `number` com arredondamento a 2 casas já existente (ROUND2/Math.round*100).
 *
 * Regras da casa:
 *   - Dinheiro entra/existe como Decimal no BANCO (exato).
 *   - Conversão para number só na LEITURA (serialização), nunca no
 *     acumulo de settlement no banco (SQL SUM em numeric é exato).
 *   - `null`/`undefined`/valor inválido → fallback explícito do call site.
 */

import { Prisma } from "@prisma/client"
import DecimalJS from "decimal.js"
import { FEE_RATE } from "./constants"

// A classe Decimal do domínio: a MESMA instância de decimal.js que o client
// do Prisma usa (Prisma.Decimal === runtime.Decimal). O import direto é o que
// funciona tanto no runtime da aplicação quanto sob o transform SSR do Vitest
// (onde o namespace Prisma perde o Decimal — descoberto neste módulo).
const DecimalCtor = DecimalJS as unknown as typeof Prisma.Decimal

// Modos de arredondamento da spec decimal.js (Prisma.Decimal.ROUND_* não é
// acessível sob o transform SSR do Vitest — usamos os valores literais, que
// são estáveis na spec: 4 = ROUND_HALF_UP).
const ROUND_HALF_UP = 4

/** Aceita Decimal do Prisma, number, string numérica ou null/undefined. */
export type MoneyInput = Prisma.Decimal | number | string | null | undefined

/**
 * Converte um valor monetário do Prisma (Decimal) para `number` com no
 * máximo 2 casas decimais. Uso:
 *
 *   const amount = toMoneyNumber(booking.amount)
 *   const price  = toMoneyNumber(item.price, 0)      // nullable → 0
 *
 * O arredondamento final (round half away from zero, via toFixed→Number)
 * elimina resíduo binário da conversão decimal→double; valores vêm do
 * banco com 2 casas, então o round é no-op de segurança.
 */
export function toMoneyNumber(value: MoneyInput, fallback = 0): number {
  if (value === null || value === undefined || value === "") return fallback
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number(value.toString())
  if (!Number.isFinite(n)) return fallback
  return Math.round(n * 100) / 100
}

// ---------------------------------------------------------------------------
// Camada de DOMÍNIO (Decimal puro) — comissão, settlement e saldos.
//
// O objetivo é NÃO passar por `number` em NENHUM ponto do cálculo: Decimal
// entra (campo Prisma), Decimal é acumulado, Decimal sai (gravação no banco).
// A conversão para `number` acontece UMA vez, na fronteira de serialização
// (toMoneyNumber), exatamente como manda o contrato deste módulo.
// ---------------------------------------------------------------------------

/**
 * Converte qualquer MoneyInput para `Prisma.Decimal` (decimal.js).
 * `null`/`undefined`/string inválida → `fallback` (default "0").
 */
export function toDecimal(value: MoneyInput, fallback = "0"): Prisma.Decimal {
  if (value === null || value === undefined || value === "") return new DecimalCtor(fallback)
  if (typeof value === "string") {
    const d = new DecimalCtor(value)
    return d.isFinite() ? d : new DecimalCtor(fallback)
  }
  // Decimal | number — construtor preserva a exatidão do Decimal original.
  return new DecimalCtor(value)
}

/**
 * Arredonda para 2 casas (centavos), round half AWAY FROM ZERO — o mesmo
 * comportamento do `Math.round(x * 100) / 100` legado, agora em base 10
 * exata. Valores monetários são não-negativos no domínio; para negativos o
 * half-away-from-zero mantém a simetria (−1.005 → −1.01).
 */
export function roundMoney(value: MoneyInput): Prisma.Decimal {
  return toDecimal(value).toDecimalPlaces(2, ROUND_HALF_UP)
}

/**
 * Comissão da plataforma sobre `gross` — round2(gross × rate) em Decimal.
 * É o valor que aparece na linha do extrato/settlement: por isso é
 * arredondado isoladamente (fee + net === gross, ver `netOf`).
 */
export function feeOf(gross: MoneyInput, rate: number = FEE_RATE): Prisma.Decimal {
  return roundMoney(toDecimal(gross).mul(rate))
}

/**
 * Líquido do prestador — gross (round2) MENOS a comissão já arredondada.
 * Subtrair em vez de recalcular garante a identidade contábil por linha:
 * fee + net === gross EXATAMENTE (sem centavos fantasmas de arredondamento
 * duplo), e a soma das linhas fecha com o total do período.
 */
export function netOf(gross: MoneyInput, rate: number = FEE_RATE): Prisma.Decimal {
  return roundMoney(gross).minus(feeOf(gross, rate))
}

/** Totais de um settlement — todos em Decimal, escala ≤ 2. */
export type SettlementTotals = {
  gross: Prisma.Decimal
  fee: Prisma.Decimal
  net: Prisma.Decimal
  count: number
}

/**
 * Acumulador de settlement em Decimal puro.
 *
 * Uso tipado nos call sites (cron/admin de settlements, relatórios de
 * comissão):
 *
 *   const totals = new MoneySettlement()
 *   for (const p of payments) totals.add(p.amount)       // Decimal in
 *   await db.settlementPeriod.create({ data: {
 *     totalAmount: totals.gross,                         // Decimal out
 *     totalCommission: totals.fee,
 *     totalNet: totals.net,
 *   }})
 *
 * `addLine` soma sub-totais já computados (por provider → período).
 * Todas as operações são em base 10: ZERO drift binário entre a soma das
 * linhas e o total — a identidade gross = fee + net vale no agregado.
 */
export class MoneySettlement {
  private _gross = new DecimalCtor(0)
  private _fee = new DecimalCtor(0)
  private _net = new DecimalCtor(0)
  private _count = 0

  /** Adiciona uma transação: gross = round2(amount), fee e net derivados. */
  add(amount: MoneyInput, rate: number = FEE_RATE): void {
    const gross = roundMoney(amount)
    const fee = feeOf(gross, rate)
    this._gross = this._gross.plus(gross)
    this._fee = this._fee.plus(fee)
    this._net = this._net.plus(gross.minus(fee))
    this._count += 1
  }

  /** Soma um sub-total (ex.: acumulado de um provider) no total do período. */
  addLine(line: {
    gross: Prisma.Decimal
    fee: Prisma.Decimal
    net: Prisma.Decimal
    count: number
  }): void {
    this._gross = this._gross.plus(line.gross)
    this._fee = this._fee.plus(line.fee)
    this._net = this._net.plus(line.net)
    this._count += line.count
  }

  get gross(): Prisma.Decimal {
    return this._gross
  }

  get fee(): Prisma.Decimal {
    return this._fee
  }

  get net(): Prisma.Decimal {
    return this._net
  }

  get count(): number {
    return this._count
  }

  /** Snapshot imutável dos totais (Decimal puro — nada convertido). */
  get totals(): SettlementTotals {
    return { gross: this._gross, fee: this._fee, net: this._net, count: this._count }
  }
}
