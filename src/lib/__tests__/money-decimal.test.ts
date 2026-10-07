/**
 * Tests for the Decimal domain layer in src/lib/money.ts.
 *
 * Contratos provados aqui:
 *  - fee + net === gross EXATAMENTE por linha e no agregado (identidade
 *    contábil do settlement — a razão de existir da camada Decimal);
 *  - arredondamento half-up EXATO em base 10 (o caso 150.015 → 150.02,
 *    onde o float do padrão legado arredondava 150.01);
 *  - soma em Decimal não herda o drift binário (0.1 + 0.2 = 0.3);
 *  - MoneySettlement é associativo: addLine (por provider → período) fecha
 *    com a soma transação a transação;
 *  - entrada aceita Decimal do Prisma, number e string numérica; inválido →
 *    fallback determinístico.
 */

import { describe, it, expect } from "vitest"
import { Prisma } from "@prisma/client"
import DecimalJS from "decimal.js"
import { toDecimal, roundMoney, feeOf, netOf, MoneySettlement } from "../money"

const D = DecimalJS as unknown as typeof Prisma.Decimal

function expectMoney(actual: { toString(): string }, expected: string | number) {
  // decimal.js direto: o namespace Prisma perde o Decimal sob o SSR do Vitest
  expect(D(actual.toString()).equals(D(expected))).toBe(true)
}

describe("toDecimal", () => {
  it("preserva a exatidão de um Decimal do Prisma (sem roundtrip por number)", () => {
    const original = new D("150.015") // tipo que o Prisma devolve (Decimal.js)
    expectMoney(toDecimal(original), "150.015")
  })

  it("converte number e string numérica", () => {
    expectMoney(toDecimal(123.45), "123.45")
    expectMoney(toDecimal("99.99"), "99.99")
  })

  it("null/undefined/inválido → fallback", () => {
    expectMoney(toDecimal(null), "0")
    expectMoney(toDecimal(undefined), "0")
    expectMoney(toDecimal(null, "10.5"), "10.5")
  })
})

describe("roundMoney (half-up em base 10)", () => {
  it("150.015 → 150.02 (o float legado produzia 150.01)", () => {
    expectMoney(roundMoney("150.015"), "150.02")
  })

  it("meio centavo para cima em valores típicos", () => {
    expectMoney(roundMoney("10.005"), "10.01")
    expectMoney(roundMoney("0.125"), "0.13")
    expectMoney(roundMoney("2.675"), "2.68")
  })

  it("não arredonda o que já está em 2 casas", () => {
    expectMoney(roundMoney("123.45"), "123.45")
    expectMoney(roundMoney(0.1), "0.1")
  })
})

describe("feeOf / netOf (identidade contábil por linha)", () => {
  it("fee + net === gross EXATAMENTE para valores com meio centavo", () => {
    for (const gross of ["150.015", "99.995", "0.075", "1234.565"]) {
      const fee = feeOf(gross)
      const net = netOf(gross)
      expectMoney(fee.plus(net), roundMoney(gross).toString())
    }
  })

  it("15% de 200 = 30 e líquido 170 (caso do extrato)", () => {
    expectMoney(feeOf("200"), "30")
    expectMoney(netOf("200"), "170")
  })

  it("o fee NUNCA é calculado sobre o gross já arredondado duas vezes", () => {
    // 33.335 → gross 33.34 (half-up); fee = round2(33.335×0.15) = 5.00
    const gross = "33.335"
    expectMoney(feeOf(gross), "5.00")
    expectMoney(netOf(gross), "28.34") // 33.34 − 5.00 (não 28.33)
  })
})

describe("soma em Decimal (sem drift binário)", () => {
  it("0.1 + 0.2 = 0.3 (number daria 0.30000000000000004)", () => {
    const sum = toDecimal("0.1").plus(toDecimal("0.2"))
    expectMoney(sum, "0.3")
    expect(sum.toString()).toBe("0.3")
  })

  it("soma de 1.005 dez vezes fecha com 10.05", () => {
    let acc = toDecimal(0)
    for (let i = 0; i < 10; i++) acc = acc.plus("1.005")
    expectMoney(roundMoney(acc), "10.05")
  })
})

describe("MoneySettlement", () => {
  it("acumula transação a transação com identidade gross = fee + net", () => {
    const s = new MoneySettlement()
    s.add("200")
    s.add("350.10")
    s.add("0.075")

    expectMoney(s.gross, "550.18") // 200 + 350.10 + 0.08 (round do 0.075)
    expectMoney(s.fee, "82.53") // 30 + 52.52 (350.10×0.15 = 52.515 → 52.52) + 0.01
    expectMoney(s.net, "467.65")
    expectMoney(s.fee.plus(s.net), s.gross.toString())
    expect(s.count).toBe(3)
  })

  it("addLine é associativo: soma por provider fecha com o total", () => {
    // Provider A: 3 transações; Provider B: 2 transações
    const a = new MoneySettlement()
    a.add("100")
    a.add("200.05")
    a.add("50.55")

    const b = new MoneySettlement()
    b.add("1000")
    b.add("0.005")

    const grand = new MoneySettlement()
    grand.addLine({ ...a.totals, count: 3 })
    grand.addLine({ ...b.totals, count: 2 })

    // Transação a transação, na ordem oposta de agrupamento
    const direct = new MoneySettlement()
    direct.add("1000")
    direct.add("0.005")
    direct.add("100")
    direct.add("200.05")
    direct.add("50.55")

    expectMoney(grand.gross, direct.gross.toString())
    expectMoney(grand.fee, direct.fee.toString())
    expectMoney(grand.net, direct.net.toString())
    expectMoney(grand.fee.plus(grand.net), grand.gross.toString())
    expect(grand.count).toBe(5)
  })

  it("aceita MoneyInput do Prisma (Decimal) direto em add()", () => {
    const s = new MoneySettlement()
    s.add(new D("88.88"))
    expectMoney(s.gross, "88.88")
    expectMoney(s.fee, "13.33") // 88.88 × 0.15 = 13.332 → 13.33
    expectMoney(s.net, "75.55")
  })

  it("settlement vazio é zero em tudo", () => {
    const s = new MoneySettlement()
    expectMoney(s.gross, "0")
    expectMoney(s.fee, "0")
    expectMoney(s.net, "0")
    expect(s.count).toBe(0)
  })

  it("totals devolve snapshot com os mesmos valores", () => {
    const s = new MoneySettlement()
    s.add("123.45")
    const t = s.totals
    expectMoney(t.gross, "123.45")
    expectMoney(t.fee, "18.52") // 123.45 × 0.15 = 18.5175 → 18.52
    expectMoney(t.net, "104.93")
    expect(t.count).toBe(1)
  })
})
