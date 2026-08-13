/**
 * scan-derived-inventory.mjs - o 11o guard do batch do pre-commit: a
 * COMPLETUDE do registry dos fatos consumidos (sec 11.107) executada no
 * pre-commit (2026-08-13, sec 11.112 do gates-proofs.md).
 *
 * WHY: a derivada da 11.107 (o DERIVED INVENTORY - todo fato derivado
 * mecanicamente dos helpers de prova, notas \w+LeftNote + gates
 * \w+Delta ? LeftNote + paths citados em output, tem entrada no registry
 * CONSUMED_FACTS 11.104 / RESOLVED_PATHS 11.106) vivia so na suite
 * proof-helpers-contract.test.ts (test:unit, no CI/push). A edicao
 * acidental de um helper .mjs (uma nota nova esquecida no registry)
 * passava o commit local e so falhava no push. Este guard fecha a classe:
 * a falha vem ANTES do commit, no batch do pre-commit (o padrao do
 * tripwire do scan-exit-claims, sec 11.42/11.56, e do scan-proof-helpers,
 * sec 11.93).
 *
 * INVARIANTE do batch (sec 11.42): guards baratos NAO ganham condicao. O
 * pedido original avaliou 'rodar quando hook-proof-run.mjs/ci-proof-run.mjs
 * mudarem' (a condicao por arquivo) - mas a premisa e supersedida pela
 * invariante (o MESMO racional documentado no scan-proof-helpers, sec
 * 11.93): o guard roda INCONDICIONALMENTE, custo ~15-25ms (fs + regex
 * puros, boot compartilhado do batch). A condicao por diff seria furavel
 * (a edicao acidental nao avisa o hook de nada) e quebraria o
 * determinismo da agregacao (uma falha nunca esconde as demais).
 *
 * A FONTE UNICA (a regra dos 2 usos): os registries CONSUMED_FACTS e
 * RESOLVED_PATHS + as derivadas (deriveNotes/deriveGates/derivePathDefs/
 * citesOf) vivem AQUI - a suite da sec 11.107 importa DAQUI, nunca os
 * redefine (o mesmo padrao do EXIT_CLAIMS importado pelo scan-exit-claims
 * e dos regexes do scan-proof-helpers). A suite pina o CONTENT (ABS PINs +
 * MUTATIONs + REAL-REPO CONTRACT); este guard executa o check no
 * pre-commit.
 *
 * Exit codes do CLI: 0 = completude OK (todo fato derivado tem registro) -
 * 1 = violacoes listadas no stderr - 2 = uso errado.
 *
 * A sec 11.114 fechou o elo da forma: a LINE_NUM_RE e o lineNumField (a
 * CONFINEMENT da sec 11.113) migraram para AQUI - o guard agora EXECUTA
 * a CONFINEMENT no batch (um numero fantasma injetado num registry falha
 * antes do commit, nao so no push onde a suite roda). A suite da sec
 * 11.113 importa DAQUI (a regra dos 2 usos no padrao do EXIT_CODES_RE).
 *
 * Re-validacao: `node scripts/scan-derived-inventory.mjs --check` + a
 * suite da sec 11.107 (importa DAQUI a fonte unica).
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { deriveProofHelpers } from "./scan-proof-helpers.mjs"

/** ROOT - a raiz do repo, com override por env (o padrao dos guards:
 * PROOF_HELPERS_ROOT, NODE_MODULES_ROOT...). O teste de isolacao aponta
 * DERIVED_INVENTORY_ROOT para um repo sintetico com um helper ganhando
 * uma nota sem registro. */
const ROOT = path.resolve(process.env.DERIVED_INVENTORY_ROOT || process.cwd())

/**
 * CONSUMED_FACTS (sec 11.104) - o registro curado: cada fato consumido dos
 * 2 helpers do ciclo mapeia para o seu guard (o marcador estavel: titulo
 * do describe ou nome da funcao-guard) e a secao. A fronteira selfDel tem
 * guard '' por desenho - o pin cobre a FINDABILIDADE do RECUSADO (o
 * addendum da sec 11.102), nao um guard. FONTE UNICA: a suite da sec
 * 11.107 importa DAQUI.
 */
export const CONSUMED_FACTS = [
  // hook-proof-run.mjs - a nota + o trio (secs 11.65/11.84/11.100/11.101)
  { helper: "hook-proof-run", fact: "scratchLeftNote (a nota em todo fail pos-scratch)", guard: "o guard de forma do fail silencioso (sec 11.65)", section: "11.65", kind: "pin" },
  { helper: "hook-proof-run", fact: "stage (o retorno do revertCycle no dispatch)", guard: "stageFromReturn", section: "11.84", kind: "pin" },
  { helper: "hook-proof-run", fact: "safetyDiff (o path resolvido-uma-vez)", guard: "safetyDiffFromVar", section: "11.100", kind: "pin" },
  { helper: "hook-proof-run", fact: "backupDir (o path criado-uma-vez)", guard: "backupDirFromVar", section: "11.101", kind: "pin" },
  // ci-proof-run.mjs - o placement + o par (secs 11.70/11.102)
  { helper: "ci-proof-run", fact: "stashLeftNote (o placement nos fail sites)", guard: "o guard de forma do fail silencioso (sec 11.70)", section: "11.70", kind: "pin" },
  { helper: "ci-proof-run", fact: "stashedDelta (o gate VARIAVEL)", guard: "gatedOnVar", section: "11.102", kind: "pin" },
  { helper: "ci-proof-run", fact: "logPath (resolvido-uma-vez)", guard: "logUses", section: "11.102", kind: "pin" },
  { helper: "ci-proof-run", fact: "inputs citados (as citacoes de opts.X/b em mensagens)", guard: "o guard irmao do INPUT citado (sec 11.105)", section: "11.105", kind: "pin" },
  // a fronteira RECUSADA da sec 11.102 (o addendum do selfDel)
  { helper: "ci-proof-run", fact: "selfDel (resolvido-uma-vez - nao citado em output)", guard: "", section: "11.102", kind: "boundary" },
]

/**
 * RESOLVED_PATHS (sec 11.106) - o inventario curado: 12 pins + 1 boundary
 * (o selfDel do RECUSADO 11.102). A varredura ampla (2026-08-12) derivou
 * todos os `const X = path-API` dos 5 helpers de prova e cruzou com as
 * citacoes em output (fail/notes/DONE/logs) - o logPath do ci-proof-run
 * era o UNICO pinado (11.102). FONTE UNICA: a suite da sec 11.107 importa
 * DAQUI.
 */
export const RESOLVED_PATHS = [
  // hook-proof-run.mjs - 5 paths citados (2 pre-pinados + 3 gaps)
  { helper: "hook-proof-run", varName: "docPath", defLine: 619, citedAt: [715, 719], guard: "RESOLVED PATHS (sec 11.106)", section: "11.106", kind: "pin" },
  { helper: "hook-proof-run", varName: "backupDir", defLine: 621, citedAt: [419, 510, 512, 515, 551, 553, 567, 570, 594, 704], guard: "backupDirFromVar", section: "11.101", kind: "pin" },
  { helper: "hook-proof-run", varName: "safetyDiff", defLine: 625, citedAt: [484, 567, 644], guard: "safetyDiffFromVar", section: "11.100", kind: "pin" },
  { helper: "hook-proof-run", varName: "safetyBackup", defLine: 628, citedAt: [694], guard: "RESOLVED PATHS (sec 11.106)", section: "11.106", kind: "pin" },
  { helper: "hook-proof-run", varName: "logPath", defLine: 768, citedAt: [770, 797], guard: "RESOLVED PATHS (sec 11.106)", section: "11.106", kind: "pin" },
  // ci-proof-run.mjs - 1 pin (11.102) + 1 boundary (o RECUSADO)
  { helper: "ci-proof-run", varName: "logPath", defLine: 822, citedAt: [827, 899], guard: "logUses", section: "11.102", kind: "pin" },
  { helper: "ci-proof-run", varName: "selfDel", defLine: 659, citedAt: [], guard: "", section: "11.102", kind: "boundary" },
  // guard-remeasure.mjs - 2 pins (282 path.resolve + 303 a forma CURADA done.log.replace)
  { helper: "guard-remeasure", varName: "logPath", defLine: 282, citedAt: [283], guard: "RESOLVED PATHS (sec 11.106)", section: "11.106", kind: "pin" },
  { helper: "guard-remeasure", varName: "logPath", defLine: 303, citedAt: [304], guard: "RESOLVED PATHS (sec 11.106)", section: "11.106", kind: "pin" },
  // doc-revalidate.mjs - 1 pin
  { helper: "doc-revalidate", varName: "docPath", defLine: 284, citedAt: [269, 285, 335, 341], guard: "RESOLVED PATHS (sec 11.106)", section: "11.106", kind: "pin" },
  // proof-register.mjs - 3 pins (a forma CURADA env||DEFAULT)
  // (re-bumped 2026-08-13: o docblock do helper cresceu ~9 linhas no recipe
  // das Provas 59-61, deslocando as defs 365-367 -> 374-376 e a citacao
  // 437 -> 446; o ABS PIN da sec 11.106 exige o bump consciente)
  { helper: "proof-register", varName: "manifestPath", defLine: 374, citedAt: [446], guard: "RESOLVED PATHS (sec 11.106)", section: "11.106", kind: "pin" },
  { helper: "proof-register", varName: "testPath", defLine: 375, citedAt: [446], guard: "RESOLVED PATHS (sec 11.106)", section: "11.106", kind: "pin" },
  { helper: "proof-register", varName: "docPath", defLine: 376, citedAt: [446], guard: "RESOLVED PATHS (sec 11.106)", section: "11.106", kind: "pin" },
]

/**
 * LINE_NUM_RE - a forma dos numeros de linha (sec 11.109/11.113/11.114): o
 * regex compartilhado entre o ANCHOR da 11.109 (fact strings), os
 * CONFINEMENTs da 11.113 (todos os campos dos dois registries) e este
 * guard (a CONFINEMENT executada no batch, sec 11.114) - a regra dos 2
 * usos no padrao do EXIT_CODES_RE do scan-proof-helpers: a forma vive
 * AQUI (a fonte unica), a suite da sec 11.113 importa DAQUI. O \d+ cobre
 * linhas de qualquer tamanho; o contexto virgula-espaco-travessao
 * desambigua de numeros em prosa ("sec 11.100" nao tem a moldura
 * virgula-travessao).
 */
export const LINE_NUM_RE = /linha \d+|, \d+ -/

/**
 * lineNumField - o predicado da CONFINEMENT (sec 11.113/11.114): o campo
 * string que embute numero de linha, ou null. Os campos numericos por
 * desenho (defLine/citedAt do RESOLVED_PATHS - a fonte mecanica da
 * 11.106) sao isentos; qualquer outro campo com numero de linha e um
 * 'numero fantasma' (sem derivada que o respalde). Exportada: a suite da
 * sec 11.113 importa DAQUI (a fonte unica da regra dos 2 usos - o guard
 * executa no batch, a suite pina).
 */
export function lineNumField(entry) {
  for (const [k, v] of Object.entries(entry)) {
    // A isencao e o acoplamento explicito com o RESOLVED_PATHS: defLine/
    // citedAt sao os UNICOS campos numericos por desenho (o ABS PIN da
    // 11.106) - um 3o campo numerico no registry exige editar aqui em
    // conjunto (o growth contract do ABS PIN ja forca a edicao consciente).
    if (k === "defLine" || k === "citedAt") continue
    if (LINE_NUM_RE.test(String(v))) return k
  }
  return null
}

/**
 * derivePathDefs - a derivacao mecanica (sec 11.106): os `const X =
 * path-API` do source (path.resolve/path.join/path.relative/
 * fs.mkdtempSync). A classe e de paths RESOLVIDOS-UMA-VEZ - o regex exige
 * nome camelCase (uma maiuscula apos a primeira letra), o que exclui os
 * locals de loop (`s`, `d`, `src`, `rel`, `dst`, `gi` - a colisao do
 * probe 2026-08-12). As formas CURADAS (o done.log.replace do
 * guard-remeasure 303 e o env||DEFAULT do proof-register 365-367) NAO sao
 * derivaveis por regex e entram no registro explicitamente (DEF REALITY +
 * CITED REALITY pinam as linhas reais).
 */
export function derivePathDefs(src) {
  const re = /const ([a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*) = [^;\n]*(?:path\.(?:resolve|join|relative)\(|fs\.mkdtempSync\()/
  const out = []
  for (const [i, line] of src.split("\n").entries()) {
    const m = line.match(re)
    if (m) out.push({ varName: m[1], defLine: i + 1 })
  }
  return out
}

/** citesOf - a derivacao da citacao: as linhas do source que citam
 * `${varName}` em template (a forma do output - fail/note/DONE). */
export function citesOf(src, varName) {
  const token = `\${${varName}}`
  const out = []
  for (const [i, line] of src.split("\n").entries()) {
    if (line.includes(token)) out.push(i + 1)
  }
  return out
}

/** deriveNotes - a derivacao das NOTAS (sec 11.107): as consts
 * `\w+LeftNote =` - a parte 2 do contrato 11.72 (a nota de limpeza que os
 * guards 11.65/11.70 consomem). A classe mecanica: a DEFINICAO da nota,
 * nunca um uso. */
export function deriveNotes(src) {
  const re = /const ([a-zA-Z]+LeftNote) =/
  const out = []
  for (const [i, line] of src.split("\n").entries()) {
    const m = line.match(re)
    if (m) out.push({ varName: m[1], defLine: i + 1 })
  }
  return out
}

/** deriveGates - a derivacao dos GATES (sec 11.107): os ternarios
 * `\w+Delta ? \w+LeftNote` - o gate VARIAVEL que decide se a nota de
 * limpeza entra no fail (a classe da 11.102, o stashedDelta). Fronteira
 * honesta: os status vars stDelta/stMut do hook NAO sao gates - nao
 * consomem nota; a classe e o gate que alimenta a nota. Dedupe por
 * varName (o primeiro uso e a linha da derivada). */
export function deriveGates(src) {
  const re = /([a-zA-Z]+Delta) \? [a-zA-Z]+LeftNote/
  const seen = new Map()
  for (const [i, line] of src.split("\n").entries()) {
    const m = line.match(re)
    if (m && !seen.has(m[1])) seen.set(m[1], i + 1)
  }
  return [...seen].map(([varName, defLine]) => ({ varName, defLine }))
}

/** O escopo da derivacao (sec 11.111): a UNIAO dos helpers de prova - os
 * stems do deriveProofHelpers (*-proof:run, os 2 do ciclo) + os helpers do
 * RESOLVED_PATHS (o sweep da 11.106 cobre os 5) - DERIVADA, nunca
 * hardcoded (o padrao TARGET_DIRS consumido). Os 3 irmaos utilitarios
 * (guard-remeasure, doc-revalidate, proof-register) derivam ZERO notas e
 * ZERO gates - a ausencia e o desenho, PINADA pela FRONTIER do check.
 * Exportada: a suite da sec 11.107 consome AQUI (fonte unica). */
export function deriveHelperStems(pkg, root = ROOT) {
  const fromScripts = deriveProofHelpers(pkg, root).map((h) => h.mjs.replace(/\.mjs$/, ""))
  const fromResolved = RESOLVED_PATHS.map((e) => e.helper)
  return [...new Set([...fromScripts, ...fromResolved])].sort()
}

/**
 * checkDerivedInventory - o check real (o que o CLI roda): deriva notas +
 * gates + paths citados em output dos 5 helpers do root e verifica a
 * completude do registry nos DOIS lados:
 *   - COMPLETENESS: todo fato derivado do source (nota/gate/path citado)
 *     tem entrada no registry (CONSUMED_FACTS 11.104 / RESOLVED_PATHS
 *     11.106) - um fato novo sem registro diverge;
 *   - FRONTIER (sec 11.111): os 3 irmaos utilitarios derivam ZERO notas e
 *     ZERO gates - a ausencia e o desenho (a classe nota/gate e do ciclo);
 *     um LeftNote/gate futuro num irmao divergiria.
 * Arquivo ausente => o helper e pulado (o read nunca crasha o guard - o
 * sintetico dos testes de isolamento pode ter helper sem source). Retorna
 * array de violacoes prontas para o stderr.
 */
export function checkDerivedInventory(root = ROOT) {
  const pkgPath = path.join(root, "package.json")
  if (!fs.existsSync(pkgPath)) return ["package.json ausente em " + root]
  const pkg = fs.readFileSync(pkgPath, "utf8")
  const violations = []
  const stems = deriveHelperStems(pkg, root)
  const cycleStems = deriveProofHelpers(pkg, root).map((h) => h.mjs.replace(/\.mjs$/, ""))
  const siblings = stems.filter((s) => !cycleStems.includes(s))
  for (const stem of stems) {
    const srcPath = path.join(root, "scripts", `${stem}.mjs`)
    if (!fs.existsSync(srcPath)) continue
    const src = fs.readFileSync(srcPath, "utf8")
    for (const n of deriveNotes(src)) {
      const isSibling = siblings.includes(stem)
      if (isSibling) {
        violations.push(`a nota ${stem}:${n.varName} (def ${n.defLine}) num irmao utilitario - a classe nota/gate e do ciclo (sec 11.111)`)
      } else if (!CONSUMED_FACTS.some((f) => f.helper === stem && f.fact.includes(n.varName))) {
        violations.push(`a nota ${stem}:${n.varName} (def ${n.defLine}) derivada do source nao tem entrada no CONSUMED_FACTS`)
      }
    }
    for (const g of deriveGates(src)) {
      const isSibling = siblings.includes(stem)
      if (isSibling) {
        // A paridade com o loop de notas (sec 11.111): um gate num irmao
        // utilitario e violacao de FRONTIER (a classe nota/gate e do
        // ciclo), nao um 'esqueceu de registrar' - o diagnostico separa.
        violations.push(`o gate ${stem}:${g.varName} (primeiro uso ${g.defLine}) num irmao utilitario - a classe nota/gate e do ciclo (sec 11.111)`)
      } else if (!CONSUMED_FACTS.some((f) => f.helper === stem && f.fact.includes(g.varName))) {
        violations.push(`o gate ${stem}:${g.varName} (primeiro uso ${g.defLine}) derivado do source nao tem entrada no CONSUMED_FACTS`)
      }
    }
    for (const d of derivePathDefs(src)) {
      if (citesOf(src, d.varName).length === 0) continue
      if (!RESOLVED_PATHS.some((e) => e.helper === stem && e.varName === d.varName && e.defLine === d.defLine && e.kind === "pin")) {
        violations.push(`o path ${stem}:${d.varName} (def ${d.defLine}) citado em output nao esta no RESOLVED_PATHS como pin`)
      }
    }
  }
  // A CONFINEMENT (sec 11.113/11.114): os numeros embutidos nos registries
  // vivem so nos campos com derivada mecanica (defLine/citedAt - a fonte
  // mecanica da 11.106). Um numero de linha num campo string e um 'numero
  // fantasma' - a classe da 11.109 generalizada ao registro inteiro, e a
  // MESMA classe que a 11.112 fechou para a completude: a falha vem ANTES
  // do commit, no batch (nao so no push/CI, onde a suite da 11.113 roda).
  for (const [regName, reg] of [
    ["CONSUMED_FACTS", CONSUMED_FACTS],
    ["RESOLVED_PATHS", RESOLVED_PATHS],
  ]) {
    for (const e of reg) {
      const phantom = lineNumField(e)
      if (phantom !== null) {
        violations.push(`o campo ${phantom} de ${regName}:${e.helper}:${e.fact ?? e.varName} embute numero de linha - a fronteira do numero fantasma (sec 11.113/11.114)`)
      }
    }
  }
  return violations
}

/** CLI: `node scripts/scan-derived-inventory.mjs [--check]` - exit 0/1/2. */
export function main() {
  const args = process.argv.slice(2)
  const unknown = args.filter((a) => a.startsWith("--") && a !== "--check")
  if (unknown.length > 0) {
    process.stderr.write("derived-inventory: usage: node scripts/scan-derived-inventory.mjs [--check]\n")
    return 2
  }
  const violations = checkDerivedInventory()
  if (violations.length === 0) {
    process.stdout.write(`derived-inventory: clean (completude do registry dos fatos consumidos - sec 11.107/11.112; confinamento numerico - sec 11.113/11.114)\n`)
    return 0
  }
  process.stderr.write(`derived-inventory: ${violations.length} violacao(oes) da completude/confinamento do registry (sec 11.107/11.112/11.113/11.114):\n`)
  for (const v of violations) process.stderr.write(`  ${v}\n`)
  process.stderr.write(
    "  CURE: registre o fato novo no registry do scan-derived-inventory.mjs (CONSUMED_FACTS sec 11.104 / RESOLVED_PATHS sec 11.106 - ou documente a fronteira no gates-proofs.md) e confirme com: node scripts/scan-derived-inventory.mjs --check\n",
  )
  return 1
}

// Entry-point guard: so roda o CLI quando executado direto (o batch runner
// importa main() e o chama no MESMO processo - importar NAO executa).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main()
}
