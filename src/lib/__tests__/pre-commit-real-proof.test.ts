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

import { chmodSync, copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { afterAll, describe, expect, it } from "vitest"

import { REPO_ROOT, cleanupFixtures, tempDir } from "@/lib/__tests__/helpers/hook-simulator"
import {
  FASE_A_GUARDS,
  FASE_A_RECORTE,
  FASE_B_DEFEITOS,
  FASE_B_MEMBROS,
  GATE_MARCADOR,
  REAL_WORKFLOW,
  REAL_WORKFLOW_QUEBRADO,
  REAL_WORKFLOW_VALIDO,
  RUNNER_ENCODING,
  atribuicaoDaRecusa,
  descidaDoEncodingRunner,
  proveRealHookBlocks,
  rodaGuardDeFaseA,
  rodaMembroDeFaseB,
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
 * O batimento dos membros da fase B que o hook de mentira executa: o RUNNER do
 * encoding (o que recusa o encoding e o link) e um membro barato — o suficiente
 * para a ESTRUTURA (fase B em paralelo, agregada, com veredito) ser medida sem o
 * fixture ter de imitar os dez. A lista COMPLETA dos membros é outro assunto: a
 * atribuição da prova a mede por fora, membro a membro.
 */
const FASE_B_STUB_MEMBROS = [
  { id: "encoding-runner", linha: `bash ${RUNNER_ENCODING}` },
  { id: "hook-ci-parity", linha: "node scripts/check-hook-ci-parity.mjs" },
]

/**
 * O hook de mentira com a ESTRUTURA do real: os cinco de fase A e o gate em
 * PARALELO (o gate imprime o veredito dele de qualquer modo), a fase A decidindo
 * primeiro — é essa ordem que deixa a atribuição ser medida —, e a FASE B com os
 * membros acima, agregada pelo mesmo `wait_all`.
 *
 * `faseB: false` é a MUTAÇÃO que mede a metade nova: um hook que não roda a fase
 * B deixa o defeito de encoding/link ENTRAR, e é isso que separa "a prova mede a
 * fase B" de "a prova mede um hook que nunca a chamou".
 *
 * `controleRecusado: true` é a sabotagem do CONTROLE: o hook recusa TAMBÉM o
 * commit do corpo FECHADO (só ele: a condição é o `fi` presente no arquivo), e é
 * esse fixture que torna o PREDICADO do controle load-bearing — sem ele o
 * "não sabe commitar" do ambiente seria indistinguível de "recusou o defeito",
 * e a prova não teria como ficar vermelha por essa metade.
 */
function hookStub({ faseB = true, controleRecusado = false } = {}): string {
  const blocoB = faseB
    ? [
        "PIDS_B=",
        ...FASE_B_STUB_MEMBROS.flatMap((m) => [`  ${m.linha} &`, '  PIDS_B="$PIDS_B $!"']),
        "FASE_B=0",
        "wait_all $PIDS_B || FASE_B=$?",
        '[ "$FASE_B" -eq 0 ] || exit "$FASE_B"',
      ]
    : []
  return hookStubBase(blocoB, { controleRecusado })
}

/**
 * A SABOTAGEM do CONTROLE: um hook que recusa o commit do corpo FECHADO.
 *
 * A condição é o `fi` no arquivo do gate (`REAL_WORKFLOW`), e é por isso que ela
 * só morde o commit do CONTROLE: o commit do defeito carrega o corpo ABERTO. É o
 * cenário "o ambiente não sabe commitar" que o CONTROLE existe para não deixar
 * virar um verde — o de um hook que sabota até o que está certo.
 */
const SABOTAGEM_DO_CONTROLE = [
  `if grep -aq "^          fi$" ${REAL_WORKFLOW} 2>/dev/null; then`,
  '  echo "❌ o controle do stub: o hook recusou o commit do corpo FECHADO"',
  "  exit 1",
  "fi",
]

/** O corpo do hook de mentira, com o bloco da fase B que a mutação decide. */
function hookStubBase(blocoB: string[], { controleRecusado = false } = {}): string {
  return [
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
    ...blocoB,
    ...(controleRecusado ? SABOTAGEM_DO_CONTROLE : []),
    'echo "FASE C do stub (o commit do controle chega até aqui)"',
    "",
  ].join("\n")
}

/** O hook de mentira na forma completa — o que o fixture usa por padrão. */
const HOOK_STUB = hookStub()

/** O GATE que aprova TUDO — o controle da própria atribuição (o gate é o refutador). */
const GATE_CEGO = [
  `process.stdout.write(${JSON.stringify(`✅ 1 corpo(s) passam em \`bash -n\``)})`,
  'process.stdout.write("\\n")',
  "",
].join("\n")

/**
 * Um stub de guard de fase B: imprime o próprio veredito e sai 0 (ou 1) — a
 * mesma régua do stub da fase A, para o membro poder ser declarado vermelho.
 */
function membroStub(nome: string, vermelho = false): string {
  return [
    `process.stdout.write(${JSON.stringify(`${vermelho ? "❌" : "✅"} ${nome} ok`)})`,
    'process.stdout.write("\\n")',
    `process.exitCode = ${vermelho ? 1 : 0}`,
    "",
  ].join("\n")
}

/**
 * Um stub de fase B que recusa SÓ quando o DEFEITO de encoding está no índice.
 *
 * É o cenário REAL do membro de formatação: com o guard da classe cego, o
 * `prettier --check` (que o hook roda sobre a lista do índice) segue recusando o
 * byte inválido — o commit continua bloqueado, mas por OUTRO refutador. Um stub
 * sempre-vermelho não serve para medir esse braço: ele reprovaria também o
 * CONTROLE (metade 3) e a prova pararia antes, medindo outra coisa.
 */
function membroStubCondicional(nome: string): string {
  return [
    'import { existsSync, readFileSync } from "node:fs"',
    `const alvo = ${JSON.stringify(FASE_B_DEFEITOS[0].arquivo)}`,
    'let txt = ""',
    'try { txt = readFileSync(alvo, "utf8") } catch { txt = "" }',
    'if (existsSync(alvo) && !txt.includes("ok")) {',
    `  process.stdout.write("❌ ${nome} (recusa condicional) ok\\n")`,
    "  process.exitCode = 1",
    "} else {",
    `  process.stdout.write("✅ ${nome} ok\\n")`,
    "}",
    "",
  ].join("\n")
}

/**
 * O GUARD da classe LINK: recusa o doc com o link interno quebrado.
 *
 * O alvo aparece aqui por nome PRÓPRIO (e não importando a declaração do
 * módulo): o stub é um arquivo de verdade, e um stub que lesse a declaração
 * ficaria verde por acidente no dia em que ela mudasse. O que a prova usa da
 * declaração é escrever o defeito e CONFERIR a atribuição.
 */
const LINK_STUB = [
  'import { readFileSync } from "node:fs"',
  'let txt = ""',
  'try { txt = readFileSync("docs/prova-fase-b-link.md", "utf8") } catch { txt = "" }',
  'const quebrado = txt.includes("#ancora-que-nao-existe")',
  "if (quebrado) {",
  '  process.stdout.write("❌ 1 link(s) interno(s) apontando para âncora inexistente\\n")',
  "  process.exitCode = 1",
  "} else {",
  '  process.stdout.write("✅ âncoras internas ok\\n")',
  "}",
  "",
].join("\n")

/**
 * O RUNNER do encoding (stub) com a MESMA estrutura do real: `set -e` e a lista
 * de comandos DECLARADA no corpo — é dela que a descida da prova lê os comandos
 * que deve rodar (um stub que só imprimisse ✅ provaria a atribuição contra o
 * vazio).
 */
function runnerStub({ semComandos = false } = {}): string {
  if (semComandos) {
    return ["#!/usr/bin/env bash", "set -euo pipefail", 'echo "✅ runner sem comandos"', ""].join(
      "\n",
    )
  }
  return [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "",
    ...FASE_B_DEFEITOS.flatMap((d) => d.recusadoresEsperados.descida),
    'echo "✅ runner (stub)"',
    "",
  ].join("\n")
}

/** Um checkout sintético: os guards das duas fases (stubs), o hook e o layout. */
function checkoutSintetico({
  irmaoVermelho = null,
  hookExecutavel = true,
  defeitoJaExiste = false,
  gateCego = false,
  encodingCego = false,
  refutadorExtra = null,
  refutadorCondicional = null,
  runnerSemComandos = false,
  faseBCega = false,
  controleRecusado = false,
}: {
  irmaoVermelho?: string | null
  hookExecutavel?: boolean
  defeitoJaExiste?: boolean
  gateCego?: boolean
  encodingCego?: boolean
  refutadorExtra?: string | null
  refutadorCondicional?: string | null
  runnerSemComandos?: boolean
  faseBCega?: boolean
  controleRecusado?: boolean
} = {}): string {
  const root = tempDir("checkout-sintetico-")
  mkdirSync(join(root, "scripts"), { recursive: true })
  mkdirSync(join(root, ".github", "workflows"), { recursive: true })
  mkdirSync(join(root, "docs"), { recursive: true })
  mkdirSync(join(root, "src", "lib"), { recursive: true })
  mkdirSync(join(root, ".husky"), { recursive: true })
  // O `node_modules` só importa pela PRECONDIÇÃO: a cópia não o copia, ela o
  // LINK (o mesmo caminho de resolução do repositório).
  mkdirSync(join(root, "node_modules"), { recursive: true })
  // A CONFIG de formatação vem do repositório, porque o membro `prettier-format`
  // julga sob ela: sem o `.prettierrc`, o MESMO arquivo do defeito sai 1 em vez
  // de 0 (medido — o plugin/opções do repo mudam o veredito), e a prova passaria
  // a ATRIBUIR a outro membro uma recusa que é do fixture. Um checkout sintético
  // sem a config mede o fixture, não o gate.
  for (const cfg of [".prettierrc", ".prettierignore"]) {
    const origem = join(REPO_ROOT, cfg)
    if (existsSync(origem)) copyFileSync(origem, join(root, cfg))
  }
  for (const g of FASE_A_GUARDS) {
    writeFileSync(join(root, "scripts", g), guardStub(g, g === irmaoVermelho), "utf8")
  }
  writeFileSync(
    join(root, "scripts", "check-workflow-run-syntax.mjs"),
    gateCego ? GATE_CEGO : GATE_STUB,
    "utf8",
  )
  // A FASE B: os membros que o hook chama (pelo `package.json`), o runner do
  // encoding
  // com a lista DECLARADA nele, e os dois guards de classe que a descida roda.
  const scripts: Record<string, string> = {}
  for (const m of FASE_B_MEMBROS) {
    if (m.id === "encoding-runner" || m.estagio) continue
    const vermelho = refutadorExtra === m.id
    const corpo =
      refutadorCondicional === m.id ? membroStubCondicional(m.id) : membroStub(m.id, vermelho)
    if (m.cmd === "bun") {
      // O membro é `bun run <nome>`: o nome vive no `package.json` do fixture.
      const nome = m.args[1]
      const alvo = `scripts/${nome.replace(/[^a-z0-9-]/gi, "-")}.mjs`
      scripts[nome] = `node ${alvo}`
      writeFileSync(join(root, alvo), corpo, "utf8")
    } else {
      writeFileSync(join(root, m.args[0]), corpo, "utf8")
    }
  }
  writeFileSync(
    join(root, "package.json"),
    `${JSON.stringify({ name: "checkout-sintetico", private: true, scripts }, null, 2)}\n`,
    "utf8",
  )
  writeFileSync(join(root, RUNNER_ENCODING), runnerStub({ semComandos: runnerSemComandos }), "utf8")
  writeFileSync(
    join(root, "scripts", "check-utf8.sh"),
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      // O alvo do stub do encoding: o MESMO arquivo que a prova escreve.
      `if [ -f "${FASE_B_DEFEITOS[0].arquivo}" ] && ! grep -aq ok "${FASE_B_DEFEITOS[0].arquivo}"; then`,
      '  echo "❌ byte inválido (stub)"',
      encodingCego ? "  exit 0" : "  exit 1",
      "fi",
      'echo "✅ escopo UTF-8 ok (stub)"',
      "",
    ].join("\n"),
    "utf8",
  )
  writeFileSync(join(root, "scripts", "check-readme-anchors.mjs"), LINK_STUB, "utf8")
  writeFileSync(
    join(root, ".husky", "pre-commit"),
    faseBCega || controleRecusado ? hookStub({ faseB: !faseBCega, controleRecusado }) : HOOK_STUB,
    "utf8",
  )
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

  it("um hook que recusa TAMBÉM o commit do CONTROLE: INDETERMINADO, nunca um verde", () => {
    // O PREDICADO do CONTROLE é a metade que separa "o hook recusou o defeito" de
    // "o ambiente não sabe commitar": aqui o hook do fixture recusa os DOIS
    // commits (o do corpo aberto e o do corpo FECHADO) e o HEAD não se move em
    // nenhum. Sem esse predicado a prova sairia VERDE sobre um ambiente que
    // recusa tudo — o falso verde que ela existe para não produzir —, e é por
    // isso que este caso é a testemunha dele.
    const r = proveRealHookBlocks({ root: checkoutSintetico({ controleRecusado: true }) })

    expect(r.state).toBe("unavailable")
    expect(r.detail).toContain("o CONTROLE com o corpo válido não comitou")
    // O defeito FOI recusado (é a metade 1): o que não foi medido é se o ambiente
    // sabe commitar — e a prova diz isso, em vez de virar verde.
    expect((r.evidence as any).defeito.headDepois).toBe((r.evidence as any).defeito.headAntes)
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

// ── a FASE B real, com o defeito NO ÍNDICE ─────────────────────────────
//
// O que este bloco mede é a metade nova da prova: até aqui a fase B só era
// medida pelo lado que PASSA (o controle comita). Aqui os defeitos de
// encoding/link entram no índice, o commit tem de ser recusado, e a recusa tem de
// ser ATRIBUÍDA — os membros da fase B medidos um a um, no MESMO índice, com a
// descida do runner nomeando o guard da classe.

describe("a prova sem dublê — a FASE B real, com o defeito no índice", () => {
  const faseBDe = (r: any, posicao: number) => (r.evidence as any).faseB[posicao]

  it("CONTROLE do fixture: sem defeito, a fase B inteira passa (o vermelho é do defeito)", () => {
    // A metade que impede "a fase B reprovou" de ser confundida com um fixture
    // quebrado: o MESMO checkout, sem os arquivos do defeito, atravessa os membros
    // e a descida — todos verdes.
    const root = checkoutSintetico()
    // O membro de formatação fica fora: ele recebe a lista do ÍNDICE, e este
    // checkout não é um repositório (não há índice para ele).
    const membros = FASE_B_MEMBROS.filter((m) => !(m as { estagio?: boolean }).estagio).map((m) =>
      rodaMembroDeFaseB(root, m, { estagio: [] }),
    )
    expect(membros.every((m) => m.status === 0)).toBe(true)
    const descida = descidaDoEncodingRunner(root)
    expect(descida.indisponivel).toBeNull()
    expect(descida.recusadores).toEqual([])
  })

  it("o defeito de ENCODING é recusado e a recusa é atribuída ao guard NOMEADO", () => {
    const r = proveRealHookBlocks({ root: checkoutSintetico() })
    // O `detail` vai como MENSAGEM: quando esta metade cai, o veredito da prova é
    // o diagnóstico, e uma asserção que só diz "unavailable" esconde qual metade
    // não foi medida.
    expect(r.state, r.detail).toBe("proven")

    const utf8 = faseBDe(r, 0)
    expect(utf8.id).toBe(FASE_B_DEFEITOS[0].id)
    // Recusado, com o HEAD intacto (a mesma medida da metade 1).
    expect(utf8.defeito.status).not.toBe(0)
    expect(utf8.defeito.headDepois).toBe(utf8.defeito.headAntes)
    // A ATRIBUIÇÃO: o membro declarado vermelho, os OUTROS verdes — medidos com o
    // comando do hook, no MESMO índice.
    expect(utf8.membros.length).toBe(FASE_B_MEMBROS.length)
    const vermelhos = utf8.membros.filter((m: any) => m.status !== 0).map((m: any) => m.guard)
    expect(vermelhos).toEqual(FASE_B_DEFEITOS[0].recusadoresEsperados.membros)
    // ...e a DESCIDA nomeia o guard da classe (o runner sozinho devolve um código
    // só; quem diz QUAL guard recusou é a descida).
    expect(utf8.descida.recusadores.map((x: any) => x.comando)).toEqual(
      FASE_B_DEFEITOS[0].recusadoresEsperados.descida,
    )
    // O CONTROLE: o mesmo arquivo REMENDADO entra, com o conteúdo conferido.
    expect(utf8.controle.status).toBe(0)
    expect(utf8.controle.headDepois).not.toBe(utf8.controle.headAntes)
    expect(utf8.controle.conteudoEmHead).toBe("igual ao arquivo remendado")
    expect(r.detail).toContain("encoding")
  })

  it("o defeito de LINK é recusado e a recusa é atribuída ao guard NOMEADO", () => {
    const r = proveRealHookBlocks({ root: checkoutSintetico() })
    expect(r.state, r.detail).toBe("proven")

    const link = faseBDe(r, 1)
    expect(link.id).toBe(FASE_B_DEFEITOS[1].id)
    expect(link.defeito.status).not.toBe(0)
    expect(link.defeito.headDepois).toBe(link.defeito.headAntes)
    expect(link.membros.filter((m: any) => m.status !== 0).map((m: any) => m.guard)).toEqual(
      FASE_B_DEFEITOS[1].recusadoresEsperados.membros,
    )
    expect(link.descida.recusadores.map((x: any) => x.comando)).toEqual(
      FASE_B_DEFEITOS[1].recusadoresEsperados.descida,
    )
    expect(link.controle.status).toBe(0)
    expect(link.controle.conteudoEmHead).toBe("igual ao arquivo remendado")
  })

  it("MUTAÇÃO: sem a fase B no hook, o defeito de encoding ENTRA (a metade é load-bearing)", () => {
    const r = proveRealHookBlocks({ root: checkoutSintetico({ faseBCega: true }) })

    expect(r.state).toBe("violated")
    expect(r.detail).toContain(FASE_B_DEFEITOS[0].id)
    expect(r.detail).toContain("a fase B deixou passar")
    const utf8 = faseBDe(r, 0)
    expect(utf8.defeito.headDepois).not.toBe(utf8.defeito.headAntes)
  })

  it("um refutador DECLARADO que fica verde (com o commit ainda recusado): INDETERMINADO nomeando o guard", () => {
    // O guard do encoding parou de pegar a classe (a mutação) e OUTRO membro da
    // fase B continua recusando o MESMO índice (o condicional só recusa com o
    // defeito presente, como o `prettier` real — um sempre-vermelho reprovaria o
    // CONTROLE e a prova pararia antes). O commit ainda é recusado, mas não pelo
    // refutador que a prova DECLARA: ela sai INDETERMINADA nomeando o guard que
    // ficou verde, em vez de virar verde com a atribuição trocada.
    const r = proveRealHookBlocks({
      root: checkoutSintetico({ encodingCego: true, refutadorCondicional: "hook-ci-parity" }),
    })

    expect(r.state).toBe("unavailable")
    expect(r.detail).toContain("ficou(aram) verde(s)")
    expect(r.detail).toContain("encoding-runner")
  })

  it("MUTAÇÃO: com o guard do encoding cego e nenhum outro refutador, o defeito ENTRA (o membro é load-bearing)", () => {
    // A contraprova do membro: sem o guard da classe e sem nenhum outro refutador
    // no hook, o defeito de encoding viaja. Se este caso saísse `unavailable` (em
    // vez de `violated`), a prova estaria dizendo que o ambiente não sabe commitar
    // — e não que o guard do encoding é quem recusa.
    const r = proveRealHookBlocks({ root: checkoutSintetico({ encodingCego: true }) })

    expect(r.state).toBe("violated")
    expect(r.detail).toContain(FASE_B_DEFEITOS[0].id)
    expect(r.detail).toContain("a fase B deixou passar")
  })

  it("um refutador NÃO declarado: INDETERMINADO nomeando o guard de mais", () => {
    const r = proveRealHookBlocks({
      root: checkoutSintetico({ refutadorExtra: "barrel-lint" }),
    })

    expect(r.state).toBe("unavailable")
    expect(r.detail).toContain("NÃO declarado")
    expect(r.detail).toContain("barrel-lint")
  })

  it("o runner sem os comandos declarados: premissa caída é dita, não ignorada", () => {
    const r = proveRealHookBlocks({ root: checkoutSintetico({ runnerSemComandos: true }) })

    expect(r.state).toBe("unavailable")
    expect(r.detail).toContain("não declara")
    expect(r.detail).toContain(RUNNER_ENCODING)
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
