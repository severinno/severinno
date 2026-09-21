#!/usr/bin/env node
/**
 * scripts/prove-tla-cycle.mjs — a prova por EXECUÇÃO da régua do fecho de TLA
 * (`scripts/check-tla-closure.mjs`).
 *
 * A régua diz (e agora julga): "nenhum módulo com top-level await pode ser
 * ALCANÇÁVEL a partir de uma declaração de classe ou de canal". O que ela NÃO
 * diz sozinha é o porquê — e o porquê é uma MEDIÇÃO: quando o alcance fecha o
 * CICLO, o `node` mata o loader com **exit 13 e ZERO bytes** (nem stdout nem
 * stderr), ou seja, o hook do pre-commit perde a oferta do remédio em SILÊNCIO,
 * sem imprimir causa nenhuma.
 *
 * Este script reproduz isso de ponta a ponta, em quatro casos, contra uma CÓPIA
 * da árvore (`scripts/` + `package.json`, com `node_modules` por symlink):
 *
 *   1. CONTROLE (árvore intacta) — o loader carrega e o guard fica VERDE.
 *      Sem este caso, um `rc≠0` dos outros não diria nada sobre o ciclo.
 *   2. TLA ALCANÇÁVEL SEM VOLTA — a declaração importa um TLA que NÃO alcança
 *      o loader: CARREGA (medido rc=0) e o guard RECUSA mesmo assim (a decisão
 *      conservadora está escrita na cabeça do guard, e aqui ela é medida).
 *   3. CICLO pela CLASSE — a declaração importa o loader das classes: o
 *      `await import()` do loader espera a declaração que espera o loader.
 *      MEDIDO: rc=13, stdout 0B, stderr 0B. O guard tem de NOMEAR a cadeia.
 *   4. CICLO pelo CANAL — o mesmo pelo loader do canal (a outra metade da
 *      régua: as declarações de `remedy-canal/`).
 *
 * POR QUE CÓPIA, e não injeção na árvore: o caso 3 e o 4 são defeitos
 * DELIBERADOS. Eles nascem e morrem num diretório temporário DESTA árvore (dentro
 * do repo, para o `node_modules` do repositório resolver os bare imports dos
 * guards reais), removido no fim — nunca na árvore rastreada. Sem `--keep`, o
 * diretório não sobrevive ao processo.
 *
 * O QUE ESTA PROVA **NÃO** MEDE (declarado para não virar verde por omissão):
 *   - o loader real é o das CLASSES (`scripts/remedy-classes.mjs`) e o do CANAL
 *     (`scripts/pr-fixers.mjs`), copiados inteiros; o que é INJETADO é a aresta
 *     de volta, que é o defeito sob prova.
 *   - a escolha do alvo e do módulo "sem volta" é DERIVADA do próprio guard
 *     (`declaracoesDoRemedio`, `modulosComTLA`, `fechoEstatico`) — nunca de uma
 *     lista à mão. Se não houver módulo TLA sem volta na árvore, o caso sai
 *     INDETERMINADO nomeando o motivo (nunca verde).
 *   - a detecção de TLA é a do guard (léxica), não um parser: esta prova mede o
 *     EFEITO do ciclo, não a extensão da régua — quem mede a régua é o guard.
 *
 * Usage:
 *   node scripts/prove-tla-cycle.mjs            # os quatro casos, tabela legível
 *   node scripts/prove-tla-cycle.mjs --json     # saída estruturada
 *   node scripts/prove-tla-cycle.mjs --medir    # só MEDE (nunca falha)
 *   node scripts/prove-tla-cycle.mjs --keep     # mantém as cópias (inspeção)
 *   node scripts/prove-tla-cycle.mjs -h         # esta ajuda
 *
 * Exit codes:
 *   0 — os quatro casos ficaram no que DECLARAM (inclui o rc=13 de morte muda)
 *   1 — algum caso REFUTADO (a régua ou a premissa não se sustenta)
 *   2 — não foi possível medir (INDETERMINADO — nunca verde por não saber)
 *   3 — uso
 */

import { spawnSync } from "node:child_process"
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { basename, dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import {
  CLASSES_DIR,
  LOADER_CANAL,
  LOADER_CLASSES,
  declaracoesDoRemedio,
  fechoEstatico,
  modulosComTLA,
} from "./check-tla-closure.mjs"
// O diretório do CANAL vem do leitor folha (fonte única do nome), não do guard.
import { CANAL_DIR } from "./remedy-canal.mjs"

const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)))
const GUARD = join(RAIZ, "scripts", "check-tla-closure.mjs")

const EXIT = { OK: 0, REFUTED: 1, UNAVAILABLE: 2, USAGE: 3 }

/** A LINHA do achado de ciclo no relatório do guard (`       CICLO · a → b`). */
const LINHA_CICLO = /^\s+(?:CICLO · )/m

/** A LINHA do mesmo achado quando o TLA alcançado NÃO volta ao loader. */
const LINHA_SEM_VOLTA = /^\s+sem volta · /m

// ─────────────────────────────────────────────────────────────────────────────
// A BANCADA
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Uma cópia mínima da árvore onde o defeito pode ser injetado sem tocar no
 * repositório: `scripts/` inteiro (o loader real e TODAS as declarações reais),
 * o `package.json` e o `node_modules` do repositório por SYMLINK — os guards
 * reais importam dependências bare, e sem elas o loader morreria por outro
 * motivo (e a prova mediria a ausência de `node_modules`, não o ciclo).
 *
 * O diretório nasce DENTRO do repositório de propósito: é o que faz o
 * `node_modules` do projeto resolver para a cópia.
 *
 * @returns {string} o caminho da cópia
 */
function arena() {
  const dir = mkdtempSync(join(RAIZ, ".prova-tla-"))
  cpSync(join(RAIZ, "scripts"), join(dir, "scripts"), { recursive: true })
  cpSync(join(RAIZ, "package.json"), join(dir, "package.json"))
  const nm = join(RAIZ, "node_modules")
  if (existsSync(nm)) symlinkSync(nm, join(dir, "node_modules"))
  return dir
}

/** O caminho do módulo REAL dentro da cópia. */
function naArena(dir, caminhoReal) {
  return join(dir, relative(RAIZ, caminhoReal))
}

/** Injeta uma linha no TOPO de um arquivo da cópia (a aresta sob prova). */
function injetar(caminho, linha) {
  writeFileSync(caminho, `${linha}\n${readFileSync(caminho, "utf8")}`)
}

/** O specifier que liga `de` a `para`, os dois caminhos ABSOLUTOS dentro da cópia. */
function specifier(de, para) {
  const rel = relative(dirname(de), para).replace(/\\/g, "/")
  return rel.startsWith(".") ? rel : `./${rel}`
}

/**
 * Roda um LOADER (o arquivo que faz o `await import()` das declarações) e mede
 * o que o processo devolve: o exit code e os DOIS fluxos separados — a morte
 * muda é "zero bytes nos dois", e somá-los esconderia justamente isso.
 *
 * @param {string} dir cópia
 * @param {string} loader caminho absoluto do loader AINDA na árvore real
 * @returns {{rc: number|null, out: string, err: string, sinal: string|null}}
 */
function rodarLoader(dir, loader) {
  const r = spawnSync(process.execPath, [basename(loader)], {
    cwd: join(dir, "scripts"),
    encoding: "utf8",
  })
  return { rc: r.status, out: r.stdout ?? "", err: r.stderr ?? "", sinal: r.signal ?? null }
}

/**
 * Roda o GUARD contra a cópia — o veredito tem de acompanhar a medição do node:
 * um ciclo que mata e um guard verde seriam a régua cega.
 *
 * @param {string} dir
 * @returns {{rc: number|null, saida: string}}
 */
function rodarGuard(dir) {
  const r = spawnSync(process.execPath, [GUARD, "--root", dir], { encoding: "utf8" })
  return { rc: r.status, saida: `${r.stdout ?? ""}${r.stderr ?? ""}` }
}

// ─────────────────────────────────────────────────────────────────────────────
// OS CASOS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Os quatro casos, com o que cada um ESPERA. Cada `checar` devolve as
 * expectativas que FALHARAM (vazio = o caso ficou no que declara) — a mensagem
 * nomeia o medido e o esperado, porque um veredito sem o número ao lado é um
 * relatório.
 *
 * @returns {{casos: object[], indeterminado: string|null}}
 */
function montarCasos() {
  const { declaracoes, problemas } = declaracoesDoRemedio({ root: RAIZ })
  if (problemas.length > 0) return { casos: [], indeterminado: problemas.join("; ") }
  const classe = declaracoes.filter((d) => d.tipo === "classe")[0]
  const canal = declaracoes.filter((d) => d.tipo === "canal")[0]
  if (!classe || !canal) {
    return {
      casos: [],
      indeterminado:
        "a árvore não tem uma declaração de CLASSE e uma de CANAL ao mesmo tempo — o alvo da injeção seria inventado",
    }
  }

  // O módulo TLA que NÃO volta: derivado (o primeiro, em ordem, cujo fecho
  // estático não alcança nenhum dos dois loaders e que não é ele mesmo uma
  // declaração). É o caso "recusado sem matar" — o conservadorismo declarado.
  const { modulos } = modulosComTLA({ root: RAIZ, dir: join(RAIZ, "scripts") })
  const loaders = [join(RAIZ, LOADER_CLASSES), join(RAIZ, LOADER_CANAL)]
  const semVolta = [...modulos.keys()].sort().find((p) => {
    if (loaders.includes(p)) return false
    if (p.startsWith(`${CLASSES_DIR}/`) || p.startsWith(`${CANAL_DIR}/`)) return false
    return !fechoEstatico(p).arquivos.some((a) => loaders.includes(a))
  })
  if (!semVolta) {
    return {
      casos: [],
      indeterminado:
        "nenhum módulo com TLA, fora dos loaders e das declarações, tem fecho SEM aresta de volta — o caso 'TLA alcançável sem voltar' não achou sujeito",
    }
  }

  /** @type {object[]} */
  const casos = [
    {
      nome: "controle",
      o_que: "a árvore INTACTA (o mesmo loader, sem aresta nenhuma injetada)",
      loader: join(RAIZ, LOADER_CLASSES),
      injetar: () => null,
      esperado:
        "o loader de classe CARREGA (rc=0) e o guard fica VERDE (rc=0) — é o par de referência dos outros três",
      checar: ({ node, guard }) => {
        const falhas = []
        if (node.rc !== 0) falhas.push(`node rc=${node.rc} (esperado 0)`)
        if (guard.rc !== 0) falhas.push(`guard rc=${guard.rc} (esperado 0)`)
        // A SENTENÇA, e não a palavra: a prosa do relatório cita "CICLO" nas
        // descrições das classes, então o que se procura é a LINHA do achado.
        if (!guard.saida.includes("Nenhum módulo com TLA é alcançável"))
          falhas.push("o guard não publicou a sentença de verde")
        if (LINHA_CICLO.test(guard.saida)) falhas.push("o guard achou um CICLO na árvore intacta")
        return falhas
      },
    },
    {
      nome: "tla-sem-volta",
      o_que: `a declaração de classe '${classe.id}' importa ${relative(RAIZ, semVolta)} (TLA, sem aresta de volta)`,
      loader: join(RAIZ, LOADER_CLASSES),
      alvo: classe.arquivo,
      modulo: semVolta,
      esperado:
        "CARREGA (rc=0 — o TLA alcançável sozinho não mata) e o guard RECUSA (rc=1) nomeando o ALCANCE — a decisão conservadora, medida",
      checar: ({ node, guard, linhas }) => {
        const falhas = []
        if (node.rc !== 0) falhas.push(`node rc=${node.rc} (esperado 0: sem ciclo não mata)`)
        if (guard.rc !== 1) falhas.push(`guard rc=${guard.rc} (esperado 1: a régua recusa)`)
        if (!guard.saida.includes("ALCANCE")) falhas.push("o guard não nomeou ALCANCE na recusa")
        if (!guard.saida.includes(linhas.moduloRel))
          falhas.push(`o guard não nomeou ${linhas.moduloRel} como alcançado`)
        if (!LINHA_SEM_VOLTA.test(guard.saida))
          falhas.push("o guard não marcou a aresta como 'sem volta'")
        if (LINHA_CICLO.test(guard.saida))
          falhas.push("o guard marcou CICLO num caso SEM aresta de volta")
        return falhas
      },
    },
    {
      nome: "ciclo-classe",
      o_que: `a declaração de classe '${classe.id}' importa o LOADER das classes (${LOADER_CLASSES})`,
      loader: join(RAIZ, LOADER_CLASSES),
      alvo: classe.arquivo,
      modulo: join(RAIZ, LOADER_CLASSES),
      esperado:
        "o node MATA a carga: rc=13 com stderr E stdout em ZERO bytes (a morte muda) — e o guard RECUSA nomeando a cadeia com CICLO",
      checar: ({ node, guard, linhas }) => {
        const falhas = []
        if (node.rc !== 13) falhas.push(`node rc=${node.rc} (esperado 13)`)
        if (node.err !== "")
          falhas.push(`stderr com ${node.err.length}B (esperado 0B: a morte é MUDA)`)
        if (node.out !== "") falhas.push(`stdout com ${node.out.length}B (esperado 0B)`)
        if (guard.rc !== 1) falhas.push(`guard rc=${guard.rc} (esperado 1: a régua recusa)`)
        if (!LINHA_CICLO.test(guard.saida)) falhas.push("o guard não marcou CICLO na cadeia")
        if (!guard.saida.includes(linhas.declaracaoRel))
          falhas.push(`o guard não nomeou a declaração ${linhas.declaracaoRel}`)
        return falhas
      },
    },
    {
      nome: "ciclo-canal",
      o_que: `a declaração de canal '${canal.id}' importa o LOADER do canal (${LOADER_CANAL})`,
      loader: join(RAIZ, LOADER_CANAL),
      alvo: canal.arquivo,
      modulo: join(RAIZ, LOADER_CANAL),
      esperado:
        "o node MATA a carga: rc=13 com ZERO bytes nos dois fluxos — e o guard RECUSA nomeando a cadeia com CICLO (a outra metade da régua, por execução)",
      checar: ({ node, guard, linhas }) => {
        const falhas = []
        if (node.rc !== 13) falhas.push(`node rc=${node.rc} (esperado 13)`)
        if (node.err !== "")
          falhas.push(`stderr com ${node.err.length}B (esperado 0B: a morte é MUDA)`)
        if (node.out !== "") falhas.push(`stdout com ${node.out.length}B (esperado 0B)`)
        if (guard.rc !== 1) falhas.push(`guard rc=${guard.rc} (esperado 1: a régua recusa)`)
        if (!LINHA_CICLO.test(guard.saida)) falhas.push("o guard não marcou CICLO na cadeia")
        if (!guard.saida.includes(linhas.declaracaoRel))
          falhas.push(`o guard não nomeou a declaração ${linhas.declaracaoRel}`)
        return falhas
      },
    },
  ]

  return { casos, indeterminado: null }
}

/**
 * Roda um caso: monta a cópia, injeta a aresta (quando há), roda o loader e o
 * guard, e devolve o medido + o que falhou.
 *
 * @param {object} caso
 * @param {boolean} keep
 */
function medirCaso(caso, keep) {
  const dir = arena()
  try {
    const linhas = {
      declaracaoRel: caso.alvo ? relative(RAIZ, caso.alvo) : "",
      moduloRel: caso.modulo ? relative(RAIZ, caso.modulo) : "",
    }
    if (caso.alvo && caso.modulo) {
      const alvo = naArena(dir, caso.alvo)
      const modulo = naArena(dir, caso.modulo)
      injetar(alvo, `import ${JSON.stringify(specifier(alvo, modulo))}`)
    }
    const node = rodarLoader(dir, caso.loader)
    const guard = rodarGuard(dir)
    const falhas = caso.checar({ node, guard, linhas })
    return {
      nome: caso.nome,
      o_que: caso.o_que,
      esperado: caso.esperado,
      medido: {
        nodeRc: node.rc,
        stdoutBytes: node.out.length,
        stderrBytes: node.err.length,
        guardRc: guard.rc,
      },
      estado: falhas.length === 0 ? "provado" : "refutado",
      falhas,
      dir: keep ? dir : null,
    }
  } finally {
    if (!keep) rmSync(dir, { recursive: true, force: true })
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// O RELATÓRIO
// ─────────────────────────────────────────────────────────────────────────────

/** @param {object} r */
function imprimir(r) {
  if (r.indeterminado) {
    console.log("⚠️  INDETERMINADO — não dá para medir com esta árvore:")
    console.log(`    ${r.indeterminado}`)
    return
  }
  console.log("prove-tla-cycle — a régua do fecho de TLA, medida por execução")
  console.log("──────────────────────────────────────────────────────────────────")
  for (const c of r.casos) {
    const icone = c.estado === "provado" ? "✅" : "❌"
    console.log(`${icone} ${c.nome}`)
    console.log(`   o que:   ${c.o_que}`)
    console.log(
      `   medido:  node rc=${c.medido.nodeRc} (stdout ${c.medido.stdoutBytes}B, stderr ${c.medido.stderrBytes}B) · guard rc=${c.medido.guardRc}`,
    )
    if (c.estado === "refutado") {
      console.log(`   esperado: ${c.esperado}`)
      for (const f of c.falhas) console.log(`   ✗ ${f}`)
    }
    if (c.dir) console.log(`   cópia:   ${relative(RAIZ, c.dir)} (--keep)`)
  }
  const provados = r.casos.filter((c) => c.estado === "provado").length
  console.log()
  if (provados === r.casos.length) {
    console.log(
      `✅ os ${provados} casos ficaram no que declaram: o CICLO mata com rc=13 e ZERO bytes (classe e canal), o TLA sem volta carrega mas é recusado, e a árvore intacta fica verde.`,
    )
  } else {
    console.log(`❌ ${r.casos.length - provados} de ${r.casos.length} casos REFUTADOS:`)
    for (const c of r.casos.filter((c) => c.estado === "refutado")) {
      console.log(`   · ${c.nome}: ${c.falhas.join("; ")}`)
    }
  }
}

function main(argv) {
  const flags = argv.slice(2)
  if (flags.includes("-h") || flags.includes("--help")) {
    console.log(
      readFileSync(fileURLToPath(import.meta.url), "utf8")
        .split("*/")[0]
        .slice(3),
    )
    return EXIT.USAGE
  }
  const json = flags.includes("--json")
  const keep = flags.includes("--keep")
  const medir = flags.includes("--medir")

  const { casos, indeterminado } = montarCasos()
  const r = { ok: true, indeterminado, casos: [] }
  if (indeterminado) {
    r.ok = false
    if (json) console.log(JSON.stringify(r, null, 2))
    else imprimir(r)
    return medir ? EXIT.OK : EXIT.UNAVAILABLE
  }

  for (const caso of casos) r.casos.push(medirCaso(caso, keep))
  const refutados = r.casos.filter((c) => c.estado === "refutado")
  r.ok = refutados.length === 0

  if (json) console.log(JSON.stringify(r, null, 2))
  else imprimir(r)

  if (medir) return EXIT.OK
  return r.ok ? EXIT.OK : EXIT.REFUTED
}

const IS_DIRECT_RUN =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (IS_DIRECT_RUN) process.exit(main(process.argv))
