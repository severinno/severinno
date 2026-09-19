/**
 * pre-commit-real-proof.test.ts
 *
 * A prova do bloqueio do pre-commit SEM O DUBLÊ (`proveRealHookBlocks`) contra um
 * CHECKOUT SINTÉTICO — o hook REAL é executado pelo GIT (`core.hooksPath`) sobre
 * um repositório de verdade, e o que está sob teste é a MÁQUINA da prova:
 *
 *   1. ela COPIA o checkout, roda o commit do defeito e o do controle, e mede o
 *      HEAD (não a contagem de objetos — na cópia a fase C roda de verdade e o
 *      `lint-staged` cria objetos por conta própria);
 *   2. ela ATRIBUI a recusa: um refutador só, e é o do gate, com os cinco guards
 *      de fase A aprovando o MESMO índice. Um irmão vermelho NÃO deixa a prova
 *      verde — ela sai INDETERMINADA nomeando o irmão;
 *   3. as condições de medição (o arquivo do defeito tem de ser NOVO, o hook tem
 *      de ser executável) são fail-closed: a premissa caída é dita, não ignorada.
 *
 * Os seis guards são STUBS de propósito: o que se mede aqui é a máquina da prova,
 * não o veredito dos guards reais (esse é medido no runtime do CI, com a imagem
 * do runner, pelo `--sem-duble`). Um stub do gate que recusa o corpo quebrado e
 * aprova o fechado é o mínimo para a prova ter metades distintas — e cada stub
 * imprime o próprio ✅/❌, que é o que a atribuição lê.
 *
 * Usage:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/pre-commit-real-proof.test.ts
 */

import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { afterAll, describe, expect, it } from "vitest"

import { cleanupFixtures, tempDir } from "@/lib/__tests__/helpers/hook-simulator"
import {
  FASE_A_GUARDS,
  FASE_A_RECORTE,
  GATE_MARCADOR,
  REAL_WORKFLOW,
  REAL_WORKFLOW_QUEBRADO,
  REAL_WORKFLOW_VALIDO,
  atribuicaoDaRecusa,
  proveRealHookBlocks,
  rodaGuardDeFaseA,
  shaDoHead,
  veredictosDoHook,
} from "../../../scripts/pre-commit-proof.mjs"

afterAll(() => cleanupFixtures())

/**
 * Um guard de fase A de mentira: imprime o próprio veredito e sai 0 (ou 1).
 *
 * `process.exitCode` no lugar de `process.exit()` NÃO é detalhe: o stdout de um
 * processo cujo destino é um PIPE é assíncrono, e um `process.exit()` no meio do
 * caminho TRUNCA a escrita — o stub perderia a própria linha e a atribuição
 * mediria um silêncio que não existe (o defeito do stub, não do guard).
 */
function guardStub(nome: string, vermelho: boolean): string {
  const marca = vermelho ? "❌" : "✅"
  return [
    `process.stdout.write(${JSON.stringify(`${marca} ${nome} ${FASE_A_RECORTE} ok`)})`,
    'process.stdout.write("\\n")',
    `process.exitCode = ${vermelho ? 1 : 0}`,
    "",
  ].join("\n")
}

/**
 * O GATE de mentira: recusa o corpo ABERTO (o `if` sem `fi`) com o marcador do
 * invariante real (`bash -n`) e citando o arquivo; aprova o corpo fechado.
 */
const GATE_STUB = [
  'import { readFileSync } from "node:fs"',
  `const alvo = ${JSON.stringify(REAL_WORKFLOW)}`,
  'let conteudo = ""',
  'try { conteudo = readFileSync(alvo, "utf8") } catch { conteudo = "" }',
  'const linhas = conteudo.split("\\n")',
  'const abriu = linhas.some((l) => l.includes("if [ -f x ]; then"))',
  'const fechou = linhas.some((l) => l.trim() === "fi")',
  "if (abriu && !fechou) {",
  `  process.stdout.write(${JSON.stringify(`❌ 1 corpo(s) \`run:\` NÃO passam em \`bash -n\` — 1 com ERRO de sintaxe,`)})`,
  '  process.stdout.write("\\n   ✖ " + alvo + ":7\\n")',
  "  process.exitCode = 1",
  "} else {",
  `  process.stdout.write(${JSON.stringify(`✅ 1 corpo(s) passam em \`bash -n\``)})`,
  '  process.stdout.write("\\n")',
  "}",
  "",
].join("\n")

/**
 * O hook de mentira com a ESTRUTURA do real: os cinco de fase A e o gate em
 * PARALELO (o gate imprime o veredito dele de qualquer modo), a fase A decidindo
 * primeiro — é essa ordem que deixa a atribuição ser medida.
 */
const HOOK_STUB = [
  "set -eu",
  "wait_all() {",
  "  _s=0",
  '  for _p in "$@"; do',
  "    _c=0",
  '    wait "$_p" || _c=$?',
  '    if [ "$_c" -ne 0 ] && [ "$_s" -eq 0 ]; then _s=$_c; fi',
  "  done",
  '  return "$_s"',
  "}",
  "PIDS=",
  "for _g in check-bun-mirror check-mutation-jobs check-unused-deps check-mutation-timing-contract check-required-checks; do",
  '  node "scripts/$_g.mjs" --staged &',
  '  PIDS="$PIDS $!"',
  "done",
  "node scripts/check-workflow-run-syntax.mjs --staged &",
  "PID_GATE=$!",
  "FASE_A=0",
  "wait_all $PIDS || FASE_A=$?",
  "SINTAXE=0",
  'wait "$PID_GATE" || SINTAXE=$?',
  '[ "$FASE_A" -eq 0 ] || exit "$FASE_A"',
  '[ "$SINTAXE" -eq 0 ] || exit "$SINTAXE"',
  'echo "FASE C do stub (o commit do controle chega até aqui)"',
  "",
].join("\n")

/** O GATE que aprova TUDO — o controle da própria atribuição (o gate é o refutador). */
const GATE_CEGO = [
  `process.stdout.write(${JSON.stringify(`✅ 1 corpo(s) passam em \`bash -n\``)})`,
  'process.stdout.write("\\n")',
  "",
].join("\n")

/** Um checkout sintético: os seis guards (stubs), o hook e o layout mínimo. */
function checkoutSintetico({
  irmaoVermelho = null,
  hookExecutavel = true,
  defeitoJaExiste = false,
  gateCego = false,
}: {
  irmaoVermelho?: string | null
  hookExecutavel?: boolean
  defeitoJaExiste?: boolean
  gateCego?: boolean
} = {}): string {
  const root = tempDir("checkout-sintetico-")
  mkdirSync(join(root, "scripts"), { recursive: true })
  mkdirSync(join(root, ".github", "workflows"), { recursive: true })
  mkdirSync(join(root, ".husky"), { recursive: true })
  // O `node_modules` só importa pela PRECONDIÇÃO: a cópia não o copia, ela o
  // LINK (o mesmo caminho de resolução do repositório).
  mkdirSync(join(root, "node_modules"), { recursive: true })
  for (const g of FASE_A_GUARDS) {
    writeFileSync(join(root, "scripts", g), guardStub(g, g === irmaoVermelho), "utf8")
  }
  writeFileSync(
    join(root, "scripts", "check-workflow-run-syntax.mjs"),
    gateCego ? GATE_CEGO : GATE_STUB,
    "utf8",
  )
  writeFileSync(join(root, ".husky", "pre-commit"), HOOK_STUB, "utf8")
  chmodSync(join(root, ".husky", "pre-commit"), hookExecutavel ? 0o755 : 0o644)
  if (defeitoJaExiste) writeFileSync(join(root, REAL_WORKFLOW), REAL_WORKFLOW_VALIDO, "utf8")
  return root
}

describe("a prova sem dublê — as três metades no mesmo checkout", () => {
  it("o GATE recusa o corpo quebrado, os cinco irmãos aprovam e o controle ENTRA", () => {
    const r = proveRealHookBlocks({ root: checkoutSintetico() })

    expect(r.state).toBe("proven")
    expect(r.detail).toContain("sem o dublê")
    expect(r.detail).toContain(GATE_MARCADOR)

    const defeito = (r.evidence as any).defeito
    // O RELATÓRIO do hook é EVIDÊNCIA, não veredito: a escrita de um processo num
    // PIPE é assíncrona e uma linha pode se perder (medido — os ✅ dos stubs
    // variam de 3 a 5 entre execuções). O que ele NÃO pode é trazer um refutador
    // que não seja o do gate: isso sim derruba a prova (fail-closed).
    expect(defeito.refutadores.every((l: string) => l.includes(GATE_MARCADOR))).toBe(true)
    expect(defeito.refutadores.length).toBeLessThanOrEqual(1)
    // A oposta da contagem de objetos: o HEAD não se move num commit recusado.
    expect(defeito.headDepois).toBe(defeito.headAntes)
    expect(defeito.status).not.toBe(0)

    // A ATRIBUIÇÃO por EXIT CODE: os CINCO irmãos, rodados de verdade sobre o
    // MESMO índice, saem 0 — e o gate, medido do mesmo jeito, sai não-zero.
    const irmaos = (r.evidence as any).irmaos
    expect(irmaos.map((i: any) => i.guard)).toEqual(FASE_A_GUARDS)
    expect(irmaos.every((i: any) => i.status === 0)).toBe(true)
    expect((r.evidence as any).gate.guard).toBe("check-workflow-run-syntax.mjs")
    expect((r.evidence as any).gate.status).not.toBe(0)

    // O CONTROLE: comitou, o HEAD avançou e o conteúdo em HEAD é o corpo válido.
    const controle = (r.evidence as any).controle
    expect(controle.status).toBe(0)
    expect(controle.headDepois).not.toBe(controle.headAntes)
    expect(controle.conteudoEmHead).toBe("igual ao corpo válido")
  })

  it("um IRMÃO vermelho NÃO deixa a prova verde: ela sai INDETERMINADA nomeando o guard", () => {
    const r = proveRealHookBlocks({
      root: checkoutSintetico({ irmaoVermelho: "check-unused-deps.mjs" }),
    })

    expect(r.state).toBe("unavailable")
    expect(r.detail).toContain("check-unused-deps.mjs")
    // O defeito é o mesmo, e o gate até recusou: o que impede o verde é a
    // ATRIBUIÇÃO. Ela chega por uma das DUAS metades — o TEXTO do irmão no
    // relatório do hook (`refutaram junto`) ou o exit code dele, medido direto
    // (`NÃO aprovaram o MESMO índice`) — e as duas são fail-closed. A segunda
    // existe justamente para o caso em que a linha do irmão se perde no pipe.
    expect(r.detail).toMatch(/refutaram junto|NÃO aprovaram o MESMO índice/)
  })

  it("com um GATE CEGO o defeito ENTRA: é a MUTAÇÃO que torna a recusa load-bearing", () => {
    // A contraprova da metade 2. Aqui o gate do fixture aprova o corpo quebrado
    // (a mutação: um gate que não vê o defeito), e com a fase A inteira verde o
    // commit ENTRA — que é exatamente o que prova que a recusa da metade 1 era
    // DELE e não do ambiente: sem o gate, o defeito viaja. Se este caso saísse
    // `unavailable` (em vez de `violated`), a prova estaria dizendo que o
    // ambiente não sabe commitar — e não que o gate é quem recusa.
    const r = proveRealHookBlocks({ root: checkoutSintetico({ gateCego: true }) })

    expect(r.state).toBe("violated")
    expect(r.detail).toContain("NÃO bloqueou")
    // A evidência para ANTES da metade 2 (o commit entrou): o que ela registra é
    // o HEAD avançando, que é a medida do defeito que viajou.
    expect((r.evidence as any).defeito.headDepois).not.toBe((r.evidence as any).defeito.headAntes)
  })

  it("hook SEM o bit de execução: INDETERMINADO (git o ignora em silêncio)", () => {
    const r = proveRealHookBlocks({ root: checkoutSintetico({ hookExecutavel: false }) })

    expect(r.state).toBe("unavailable")
    expect(r.detail).toContain("NÃO é executável")
    expect(r.detail).toContain("SILÊNCIO")
    expect(r.evidence).toBeNull()
  })

  it("o arquivo do defeito JÁ existindo no checkout: premissa caída é dita, não ignorada", () => {
    const r = proveRealHookBlocks({ root: checkoutSintetico({ defeitoJaExiste: true }) })

    expect(r.state).toBe("unavailable")
    expect(r.detail).toContain("JÁ EXISTE")
    expect(r.detail).toContain("refutador ser único")
  })

  it("sem um dos guards de fase A: INDETERMINADO nomeando o que faltou", () => {
    // Um irmão ausente é a outra ponta do mesmo fail-closed: a fase A não roda
    // inteira, e o não-zero (se houvesse) seria do ambiente, não do defeito.
    const root = checkoutSintetico()
    rmSync(join(root, "scripts", FASE_A_GUARDS[2]))
    const r = proveRealHookBlocks({ root })
    expect(r.state).toBe("unavailable")
    expect(r.detail).toContain(`scripts/${FASE_A_GUARDS[2]}`)
    expect(r.detail).toContain("faltou")
  })
})

describe("a ATRIBUIÇÃO da recusa — a régua pura", () => {
  it("conta os ✅ e separa os ❌ do gate dos ❌ dos outros", () => {
    const saida = [
      "✅ check-bun-mirror --staged ok",
      "  ✅ outro guard ok",
      "❌ 1 corpo(s) `run:` NÃO passam em `bash -n` — 1 com ERRO de sintaxe,",
      `   ✖ ${REAL_WORKFLOW}:7`,
      "❌ Tabela do README dessincronizada",
    ].join("\n")
    const r = atribuicaoDaRecusa(saida)
    expect(r.aprovados).toBe(2)
    expect(r.refutadores).toHaveLength(2)
    expect(r.doGate).toHaveLength(1)
    expect(r.outros).toHaveLength(1)
    expect(r.citouArquivo).toBe(true)
  })

  it("um refutador que NÃO é o do gate não é confundido com ele", () => {
    const r = atribuicaoDaRecusa("❌ another guard refused\n")
    expect(r.refutadores).toHaveLength(1)
    expect(r.doGate).toHaveLength(0)
    expect(r.outros).toHaveLength(1)
    expect(r.citouArquivo).toBe(false)
  })

  it("saída vazia: zero refutador — e nenhum deles inventado", () => {
    expect(veredictosDoHook("")).toEqual({ aprovados: 0, refutadores: [] })
  })
})

describe("o guard de fase A é rodado com o RECORTE do índice", () => {
  it("o argv leva `--staged` e o node que executa a prova", () => {
    const vistos: any[] = []
    const run = ((cmd: string, args: string[], opts: any) => {
      vistos.push({ cmd, args, opts })
      return { status: 0, stdout: "✅ ok\n", stderr: "" }
    }) as any

    const r = rodaGuardDeFaseA("/tmp/qualquer", "check-unused-deps.mjs", { run })

    expect(r).toEqual({ guard: "check-unused-deps.mjs", status: 0, linha: "✅ ok" })
    expect(vistos[0].cmd).toBe(process.execPath)
    expect(vistos[0].args).toEqual([join("scripts", "check-unused-deps.mjs"), FASE_A_RECORTE])
    expect(vistos[0].opts.cwd).toBe("/tmp/qualquer")
  })

  it("um guard que não termina sai como `null` (nunca como 0)", () => {
    const run = (() => ({ status: null, stdout: "", stderr: "" })) as any
    expect(rodaGuardDeFaseA("/tmp/x", "check-bun-mirror.mjs", { run }).status).toBeNull()
  })
})

describe("o SHA do HEAD — a medida que substitui a contagem de objetos", () => {
  it("um diretório que não é repositório devolve `null` (e não um sha inventado)", () => {
    expect(shaDoHead(tempDir("nao-e-repo-"))).toBeNull()
  })

  it("os corpos do defeito e do controle são DIFERENTES (o defeito é o `if` sem `fi`)", () => {
    expect(REAL_WORKFLOW_QUEBRADO).toContain("if [ -f x ]; then")
    expect(REAL_WORKFLOW_QUEBRADO).not.toContain("fi\n")
    expect(REAL_WORKFLOW_VALIDO).toContain("if [ -f x ]; then")
    expect(REAL_WORKFLOW_VALIDO).toContain("fi\n")
    expect(REAL_WORKFLOW_QUEBRADO).not.toBe(REAL_WORKFLOW_VALIDO)
  })
})
