#!/usr/bin/env node
// =============================================================================
// artefatos-do-hook.mjs — QUAIS ARTEFATOS DO REPOSITÓRIO OS GUARDS DO HOOK LEEM
// =============================================================================
//
// Usage:
//   node scripts/artefatos-do-hook.mjs                  # a lista, um caminho por linha
//   node scripts/artefatos-do-hook.mjs --json           # a derivação como dados
//                                                       # (com QUEM lê cada artefato)
//   node scripts/artefatos-do-hook.mjs --root <dir>     # deriva o hook de outra raiz
//   node scripts/artefatos-do-hook.mjs -h
//
// Exit codes:
//   0 — a lista foi derivada
//   1 — a derivação NÃO FECHA: o fecho de um comando do hook não resolve, um
//       comando citado pelo hook não existe no checkout, ou um guard não pôde ser
//       EXECUTADO — quem monta o fixture NÃO segue com uma lista pela metade
//   2 — uso inválido
//
// O DEFEITO QUE ELE FECHA (medido em 27/09/2026)
//
// O fixture do pre-commit materializava os arquivos do repositório que os guards
// abrem por lista A MÃO (`ARTEFATOS_DO_FIXTURE = [GITEA_COMPOSE]`), e uma lista à
// mão não sabe de guard novo: um guard fail-closed sobre um artefato do repositório
// lia o ramo de INFRA na CÓPIA, e o vermelho passava a ser do FIXTURE, não do
// defeito. O caso real foi o `check-runner-tag` (o compose ausente = exit 2), que
// por isso ficou declarado em `HOOK_NOT_RUN` até alguém acrescentar o caminho à mão.
// É o MESMO defeito que o `fecho-imports.mjs` fechou para as ARESTAS de import.
//
// A RÉGUA: MEDIDA, e por isso ela vê o que o fonte não diz
//
// O fecho de imports responde "que MÓDULOS a cópia precisa", e quem responde é o
// grafo. Ele NÃO responde por um arquivo que o guard abre por CAMINHO CALCULADO — e
// é isso que um artefato é: o `check-runner-tag` monta o caminho do compose em
// runtime, então não há aresta de import a derivar.
//
// O que existe é a EXECUÇÃO: monta-se o fixture com o fecho dos comandos do hook e
// NENHUM artefato, roda-se cada comando atrás de um pré-carregador que registra
// todo caminho que ele TENTA abrir, e o artefato é o que o guard ABRIU, não achou na
// cópia e EXISTE no repositório. O guard diz por si o que lê — inclusive quando o
// caminho é montado em runtime. E cada entrada sai com o DONO: o comando que a
// abriu (`porComando`), então uma sobra sem leitor aparece nomeada.
//
// O QUE ELE RECUSA (fail-closed)
//
//   · o fecho de um comando do hook que não resolve (aresta relativa quebrada, bare
//     de PACOTE, comando citado e ausente do checkout) — a cópia não se monta, e a
//     derivação LEVANTA em vez de devolver uma lista parcial;
//   · um guard que não pôde ser EXECUTADO (binário ausente, timeout): sem o
//     processo não há leitura a medir, e "não mediu" não é "não lê".
//
// O QUE ELE NÃO VÊ (limites declarados)
//
//   · só comanda processos de NODE. Os comandos `bun`/`bash` do hook operam sobre a
//     própria cópia (o `bun run` roda o projeto do fixture; o
//     `run-encoding-guards.sh` julga o ÍNDICE, não o repositório), então um caminho
//     de repositório aberto por eles não entraria na lista;
//   · um processo FILHO de um guard não é rastreado (o pré-carregador entra no
//     comando, não na árvore dele): um guard que delegue a leitura a um subprocesso
//     de node não aparece. O recorte é declarado, e a consequência é a mesma de
//     antes — o guard leria INFRA na cópia, o que a prova do hook MEDE.
// =============================================================================

import { spawnSync } from "node:child_process"
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { dirname, join, relative } from "node:path"

import { fechoDeImports } from "./fecho-imports.mjs"
import { REPO_ROOT, novoRepo, stage, wrapperSource } from "./hook-simulator.mjs"

/** O contrato da CLI. */
export const EXIT = { OK: 0, DERIVACAO_ABERTA: 1, USO: 2 }

/** O caminho do hook — a lista de comandos a executar sai DELE. */
export const HOOK = ".husky/pre-commit"

/**
 * O pré-carregador que registra as TENTATIVAS de abertura.
 *
 * Ele é injetado com `--require` (e não por `NODE_OPTIONS`): a flag vai no argv do
 * processo que nós mesmos spawnamos, então o caminho do fixture (que no Windows
 * pode ter espaço) não depende de parsing de variável de ambiente.
 *
 * O registro vai para um BUFFER e só é escrito no `exit`: um `appendFileSync` por
 * tentativa fazia os guards que varrem a árvore pagarem uma syscall por stat — e o
 * custo do instrumento aparecia no preço da derivação (medido: 9,9s contra 1,4s).
 *
 * As funções são trocadas no objeto `node:fs` ANTES do módulo principal carregar,
 * e é isso que faz o `import { readFileSync } from "node:fs"` do guard já enxergar
 * a versão instrumentada (medido: as três formas — named, default e o `require`).
 */
export const TRACEADOR = [
  "// pré-carregador da derivação: registra o que cada guard TENTA abrir.",
  'const fs = require("node:fs")',
  "const { appendFileSync } = fs",
  "const LOG = process.env.ARTEFATOS_LOG",
  "const buffer = []",
  "function note(p) {",
  '  if (!LOG || typeof p !== "string") return',
  "  buffer.push(p)",
  "}",
  'process.on("exit", () => {',
  "  if (!LOG || buffer.length === 0) return",
  "  try {",
  '    appendFileSync(LOG, buffer.join("\\n") + "\\n")',
  "  } catch {",
  "    /* sem log não há medição: quem deriva trata a ausência */",
  "  }",
  "})",
  "for (const nome of [",
  '  "readFileSync",',
  '  "openSync",',
  '  "readFile",',
  '  "createReadStream",',
  '  "existsSync",',
  "]) {",
  "  const original = fs[nome]",
  '  if (typeof original !== "function") continue',
  "  fs[nome] = function (p, ...resto) {",
  "    note(p)",
  "    return original.call(this, p, ...resto)",
  "  }",
  "}",
  "",
].join("\n")

/** O nome do pré-carregador dentro do fixture. */
export const TRACEADOR_FILE = "fs-trace.cjs"

/**
 * O que a derivação NÃO leva, com o motivo — e a lista é DECLARADA, como a
 * exclusão da cópia do simulador: um filtro silencioso esconderia justamente o
 * artefato que alguém tentou abrir e não veio.
 *
 * Cada prefixo responde por uma razão diferente, e nenhuma é "não interessa":
 *
 *   · `scripts/` — os MÓDULOS entram pela régua do grafo (`fecho-imports.mjs` +
 *     as sementes declaradas de quem monta o fixture). Uma segunda régua aqui não
 *     acrescentaria um caminho: ela esconderia uma ARESTA faltante, que é
 *     exatamente o defeito que o fecho existe para acusar;
 *   · `.husky/` — o hook é a FONTE SOB TESTE: o fixture grava o dele (e as provas
 *     de mutação o trocam). Copiar o canônico faria um guard julgar o hook ERRADO;
 *   · `.git/` e `node_modules/` — não são conteúdo do repositório: o fixture cria o
 *     próprio git e linka o `node_modules` da instalação.
 */
export const FORA_DO_ESCOPO = [
  { prefixo: "scripts/", porque: "os módulos entram pelo GRAFO (fecho + sementes)" },
  { prefixo: ".husky/", porque: "o hook é a fonte sob teste — o fixture grava o dele" },
  { prefixo: ".git/", porque: "o fixture cria o próprio repositório" },
  { prefixo: "node_modules/", porque: "o fixture linka o node_modules da instalação" },
]

/**
 * Os que um comando ABRE e que NÃO entram — a decisão, com o motivo, no lugar de um
 * filtro mudo.
 *
 * `package.json` é o caso medido (27/09/2026): três leitores o abrem (as classes do
 * remédio e dois guards de fase A), e materializá-lo no fixture o faz o guard
 * `hook-commands` julgar o hook DA CÓPIA — que é o DUBÊ do harness, e não o hook do
 * repositório. O remédio passa a acusar o harness (medido: a suíte do pty, com
 * terminal de verdade, sai 1 em três casos em que a resposta é "nada a remendar"),
 * e "o harness é o defeito" é exatamente o falso positivo que a materialização
 * existe para evitar. O par (.husky/, package.json) responde pelo mesmo motivo: o
 * hook da cópia é a FONTE SOB TESTE, e quem o julga é a prova da mutação, não a
 * prontidão do commit.
 */
export const NAO_SAO_ARTEFATOS = [
  {
    rel: "package.json",
    porque: "o par (.husky/, package.json) faria o remédio julgar o HOOK DUBÊ da cópia",
  },
]

/** A raiz de um caminho relativo, em POSIX (a régua dos artefatos é a do git). */
function posix(rel) {
  return rel.split(/[\\/]/).join("/")
}

/**
 * Os comandos de NODE que o hook executa, lidos do TEXTO do hook.
 *
 * A leitura é de LINHA (`node <caminho> [flags]`) porque é assim que o hook os
 * escreve: cada guard é uma linha, e o texto é a fonte única de "o que o hook
 * roda" — a mesma que o `check-hook-commands` julga. Um comando que não case a
 * forma declarada fica FORA da derivação em silêncio, e é por isso que o recorte é
 * publicado (`comandos`, no `--json`): quem lê vê o que foi comandado.
 *
 * @param {string} hookText
 * @returns {{script: string, flags: string[], linha: string}[]}
 */
export function extrairComandos(hookText) {
  const vistos = new Set()
  const comandos = []
  for (const linha of String(hookText ?? "").split(/\r?\n/)) {
    const m = /^\s*node\s+(\S+\.mjs)((?:\s+--?[A-Za-z0-9_-]+)*)\s*/.exec(linha)
    if (!m) continue
    const flags = (m[2] ?? "").trim() === "" ? [] : m[2].trim().split(/\s+/)
    const chave = `${m[1]} ${flags.join(" ")}`.trim()
    if (vistos.has(chave)) continue
    vistos.add(chave)
    comandos.push({ script: posix(m[1]), flags, linha: linha.trim() })
  }
  return comandos
}

/**
 * Os artefatos do repositório que os guards do hook LEEM — derivados por execução.
 *
 * O fixture da derivação leva o fecho dos comandos do hook (grafo + `comRaiz`) e
 * NENHUM artefato; cada comando roda atrás do pré-carregador, e cada comando
 * devolve os caminhos que TENTOU abrir. Um caminho entra na lista quando as quatro
 * condições valem: foi aberto por um guard, NÃO existe na cópia, EXISTE no
 * repositório e é um ARQUIVO (um diretório aberto não é artefato a materializar).
 *
 * @param {{root?: string, hook?: string,
 *   staged?: {rel: string, content: string}[], timeoutMs?: number}} [opts]
 *   `hook` permite derivar um hook MUTADO (a prova do artefato novo o usa); o
 *   default é o do checkout. `staged` é o que o fixture escreve no ÍNDICE: os
 *   guards de `--staged` só fazem o trabalho deles com algo no índice, e sem isso a
 *   derivação mediria um caminho em que eles saem cedo (e o artefato que eles leem
 *   nunca seria aberto).
 * @returns {{artefatos: string[], porComando: Record<string, string[]>,
 *   recusados: {rel: string, porque: string, comandos: string[]}[],
 *   comandos: string[], problemas: string[]}}
 */
export function artefatosDoHook({ root = REPO_ROOT, hook, staged = [], timeoutMs = 30000 } = {}) {
  const problemas = []
  const vazio = { artefatos: [], porComando: {}, recusados: [], comandos: [], problemas }

  let hookText = hook
  if (hookText === undefined) {
    const caminho = join(root, HOOK)
    if (!existsSync(caminho)) {
      problemas.push(
        `${HOOK}: não existe em ${root} — sem o texto do hook não há comando a comandar`,
      )
      return vazio
    }
    hookText = readFileSync(caminho, "utf8")
  }

  const comandos = extrairComandos(hookText)
  if (comandos.length === 0) {
    problemas.push(
      `${HOOK}: nenhum comando \`node <caminho>.mjs\` foi reconhecido — a derivação não tem o que executar`,
    )
    return vazio
  }

  for (const c of comandos) {
    if (!existsSync(join(root, c.script))) {
      problemas.push(
        `${c.script}: citado pelo hook e ausente do checkout — a cópia não se monta com um comando que não existe`,
      )
    }
  }
  if (problemas.length > 0) return vazio

  // O fecho é derivado por DIRETÓRIO do comando (hoje todos moram em `scripts/`),
  // para que um comando fora dele não fique sem as dependências dele.
  const porDiretorio = new Map()
  for (const c of comandos) {
    const dir = posix(dirname(c.script))
    const lista = porDiretorio.get(dir) ?? new Set()
    lista.add(c.script.slice(dir === "." ? 0 : dir.length + 1))
    porDiretorio.set(dir, lista)
  }
  const fechos = []
  for (const [dir, entradas] of porDiretorio) {
    const derivado = fechoDeImports([...entradas].sort(), {
      root: join(root, dir),
      comRaiz: true,
      permitirPacotes: true,
    })
    for (const p of derivado.problemas) problemas.push(`${dir}/: ${p}`)
    fechos.push({ dir, arquivos: derivado.fecho })
  }
  if (problemas.length > 0) return vazio

  const dir = novoRepo({
    prefix: "artefatos-do-hook-",
    wrapper: wrapperSource([]),
    artefatos: [],
  })
  try {
    for (const { dir: pasta, arquivos } of fechos) {
      for (const rel of arquivos) {
        const destino = join(dir, pasta, rel)
        mkdirSync(dirname(destino), { recursive: true })
        cpSync(join(root, pasta, rel), destino)
      }
    }
    for (const s of staged) {
      // O diretório do arquivo do ÍNDICE pode não existir na cópia (o fixture da
      // derivação leva só o fecho dos comandos): sem criá-lo o `stage` morre com
      // ENOENT do FIXTURE, que é um erro do instrumento e não do guard.
      mkdirSync(dirname(join(dir, s.rel)), { recursive: true })
      stage(dir, s.rel, s.content)
    }

    const traceador = join(dir, TRACEADOR_FILE)
    writeFileSync(traceador, TRACEADOR, "utf8")

    const porComando = {}
    let algumNaoExecutado = false
    for (const c of comandos) {
      const rotulo = [c.script, ...c.flags].join(" ")
      const log = join(dir, `.trace-${Buffer.from(rotulo).toString("hex").slice(0, 24)}.log`)
      const r = spawnSync(
        process.execPath,
        ["--require", traceador, join(dir, c.script), ...c.flags],
        {
          cwd: dir,
          encoding: "utf8",
          timeout: timeoutMs,
          input: "",
          env: { ...process.env, ARTEFATOS_LOG: log },
        },
      )
      if (r.error || r.status === null) {
        algumNaoExecutado = true
        problemas.push(
          `${rotulo}: NÃO foi possível EXECUTAR — ${r.error?.message ?? "o processo não terminou (timeout/sinal)"}. Sem o processo não há leitura a medir`,
        )
        continue
      }
      const linhas = existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : []
      const lidos = new Set()
      for (const abs of linhas) {
        const rel = posix(relative(dir, abs))
        if (rel.startsWith("..")) continue
        if (FORA_DO_ESCOPO.some((e) => rel === e.prefixo || rel.startsWith(e.prefixo))) continue
        if (existsSync(join(dir, rel))) continue
        const origem = join(root, rel)
        if (!existsSync(origem)) continue
        try {
          if (!statSync(origem).isFile()) continue
        } catch {
          continue
        }
        lidos.add(rel)
      }
      if (lidos.size > 0) porComando[rotulo] = [...lidos].sort()
    }
    if (algumNaoExecutado) return { ...vazio, comandos: comandos.map((c) => c.linha) }

    const todos = [...new Set(Object.values(porComando).flat())].sort()
    // A recusa é PUBLICADA por entrada: um guard que abre o caminho recusado sai com
    // o motivo no relatório, em vez de a lista simplesmente não o ter.
    const recusados = NAO_SAO_ARTEFATOS.filter((n) => todos.includes(n.rel)).map((n) => ({
      rel: n.rel,
      porque: n.porque,
      comandos: Object.keys(porComando).filter((c) => porComando[c].includes(n.rel)),
    }))
    const fora = new Set(NAO_SAO_ARTEFATOS.map((n) => n.rel))
    return {
      artefatos: todos.filter((rel) => !fora.has(rel)),
      porComando,
      recusados,
      comandos: comandos.map((c) => c.linha),
      problemas,
    }
  } finally {
    // O fixture é removido aqui (e não pelo `cleanupFixtures`, que esvazia a lista
    // COMPARTILHADA de quem chamou — a derivação não pode apagar o fixture alheio).
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * A derivação com MEMO por raiz+hook: montar o fixture e comandá-lo custa ~1,5s, e
 * o `novoRepo()` do pre-commit prova várias vezes na MESMA rodada.
 *
 * @param {{root?: string, hook?: string, staged?: object[]}} [opts]
 * @returns {{artefatos: string[], porComando: Record<string, string[]>,
 *   recusados: {rel: string, porque: string, comandos: string[]}[],
 *   comandos: string[], problemas: string[]}}
 */
let memo = null
export function artefatosDoHookMemo(opts = {}) {
  const chave = `${opts.root ?? REPO_ROOT}\u0000${opts.hook ?? ""}`
  if (memo && memo.chave === chave) return memo.valor
  const valor = artefatosDoHook(opts)
  memo = { chave, valor }
  return valor
}

/** A ajuda da CLI. */
export const USAGE = `artefatos-do-hook — que arquivos do repositório os guards do hook leem

Usage:
  node scripts/artefatos-do-hook.mjs                # um caminho por linha
  node scripts/artefatos-do-hook.mjs --json         # com o COMANDO que lê cada um
  node scripts/artefatos-do-hook.mjs --root <dir>   # o hook de outra raiz
  node scripts/artefatos-do-hook.mjs -h

Exit codes:
  0 — a lista foi derivada        1 — a derivação não fecha        2 — uso inválido`

const isMain = !!process.argv[1] && process.argv[1].split(/[\\/]/).pop() === "artefatos-do-hook.mjs"

if (isMain) {
  const argv = process.argv.slice(2)
  let root = REPO_ROOT
  let json = false
  let erro = null
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--json") json = true
    else if (arg === "-h" || arg === "--help") {
      console.log(USAGE)
      process.exit(EXIT.OK)
    } else if (arg === "--root") {
      const proximo = argv[++i]
      if (proximo === undefined || proximo.startsWith("--")) erro = "--root exige um diretório"
      else root = proximo
    } else erro = `argumento desconhecido: ${arg}`
  }
  if (erro) {
    console.error(`artefatos-do-hook: ${erro}`)
    console.error(USAGE)
    process.exit(EXIT.USO)
  }
  const resultado = artefatosDoHook({ root })
  if (json) console.log(JSON.stringify({ raiz: root, ...resultado }, null, 2))
  else for (const a of resultado.artefatos) console.log(a)
  if (resultado.problemas.length > 0) {
    for (const p of resultado.problemas) console.error(`  ❌ ${p}`)
    process.exit(EXIT.DERIVACAO_ABERTA)
  }
  if (!json) console.log(`artefatos-do-hook: ✅ ${resultado.artefatos.length} artefato(s)`)
  process.exit(EXIT.OK)
}
