#!/usr/bin/env node

// =============================================================================
// check-commit-import-exports.mjs — a CLASSE DA PILHA: import de nome que a
// árvore do commit ainda NÃO exporta
// =============================================================================
//
// Usage:
//   node scripts/check-commit-import-exports.mjs                  # a SÉRIE (--base/CI/origin/main)
//   node scripts/check-commit-import-exports.mjs --base REF        # a série é merge-base(REF,HEAD)..HEAD
//   node scripts/check-commit-import-exports.mjs --head REF        # o head medido (no PR: o sha real, não o merge)
//   node scripts/check-commit-import-exports.mjs --only SHA        # UM commit, varredura da árvore inteira
//   node scripts/check-commit-import-exports.mjs --json            # saída estruturada
//   node scripts/check-commit-import-exports.mjs --repo DIR        # fixture (testes)
//   node scripts/check-commit-import-exports.mjs --no-baseline     # ignora a dívida declarada
//
// Exit codes:
//   0 — a série não tem violação NOVA (a dívida declarada, se houver, vai no relatório)
//   1 — violação nova (commit + arquivo + nome + alvo), ou entrada de baseline OBSOLETA (catraca)
//   2 — infra: base não resolve / repo inválido (fail-closed)
//   3 — uso inválido
//
// A CLASSE QUE ELE FECHA
//
// Um commit que importa um nome que a SUA PRÓPRIA ÁRVORE ainda não exporta é um
// commit que NÃO CARREGA: o topo da pilha passa (o `export` entra num commit
// acima) e o commit do MEIO quebra no `import`, antes de qualquer asserção. O
// vermelho só aparece quando alguém RE-MEDE a pilha commit a commit
// (`prove-stack-per-commit.mjs`) — ~43 commits, ~11 minutos, e o relatório diz
// "o commit X reprovou" sem dizer que a causa é um import sem export.
//
// MEDIDO nesta árvore (26/09/2026), na série de 43 commits acima de `30447a57`:
//   · `8dd4f5e5` (`scripts/pre-commit-proof.mjs`) importa `{ BENCH_PATH }` de
//     `scripts/check-mutation-count.mjs` e o alvo só passa a exportar BENCH_PATH
//     num commit ACIMA — no commit, o módulo não carrega.
//   · a régua tem de ser CONSERVADORA nos dois sentidos, e o protótipo mediu os
//     dois erros: (a) `git show rev:dir` devolve a LISTAGEM do diretório em vez
//     de erro — o alvo precisa ser provado BLOB (`git cat-file -t`) antes de ser
//     lido como módulo, senão um diretório vira "módulo sem o export"; (b) um
//     `import … from "./x.mjs"` escrito DENTRO de um comentário de bloco, e um
//     `export function f()` na MESMA linha do fechamento do bloco, são os dois
//     lados do mesmo defeito de lexer — por isso a sintaxe é lida por LINHA, com
//     regras explícitas, e não por regex que atravessa o arquivo.
//
// A RÉGUA DA SÉRIE É A MESMA DO PROVER DA PILHA (régua única): `--base`,
// `GITHUB_BASE_REF` do CI, ou `origin/main`; o recorte é
// `merge-base(base, HEAD)..HEAD`. SEM base resolvida o guard NÃO inventa uma: ele
// falha (exit 2) e diz o que falta — um recorte chutado mediria a coisa errada.
//
// COMO LÊ A SINTAXE (as regras, por linha)
//   · instrução: a linha (sem `*\/` de fechamento de bloco na frente) começa com
//     `import` ou `export`;
//   · a cláusula pode continuar nas linhas seguintes (o prettier quebra listas de
//     import longas) — a busca pelo `from "…"` para em linha em branco, em `;`,
//     em linha que comece com comentário, ou depois de 200 linhas (lista que não
//     fecha no limite = NÃO-JULGÁVEL declarada, nunca ignorada);
//   · specifier: o que vem depois de `from` precisa ser string literal e NÃO pode
//     ser seguido de `.`, `+` ou `[` — `from "./x.js".replace(…)` é specifier
//     COMPUTADO (medido em `scripts/search-reindex.mjs`), não import estático;
//   · export: `export <decl …> NOME`, `export { … }` (lista, multilinha, com
//     `as`), `export default`, `export * from` (OPACO) e `export * as ns from`;
//   · um `export` DENTRO de comentário não conta: a linha tem de começar com o
//     keyword (comentário começa com `//`, `*` ou `/*`) — foi esta a regra que
//     fechou o falso positivo do `x.mjs` citado num doc-comment.
//
// O QUE ELE NÃO JULGA (declarado, e o relatório CONTA cada um)
//   · alvo com `export * from`: o conjunto de nomes é OPACO (import não-julgável);
//   · specifier externo (bare, `node:`, `bun:`, subpath de pacote) — não é árvore;
//   · alvo de ASSET (`.css`, `.json`, `.svg`, `.md`, …): não promete export nomeado;
//   · import de namespace (`import * as ns`) e de efeito (`import "x"`): só o
//     módulo precisa existir;
//   · a invariante no PAI do primeiro commit da série é ASSUMIDA (o que já está na
//     base passou pela régua na época em que foi medido);
//   · a classe ao CONTRÁRIO (o commit TIRA um export que outro módulo importa) é
//     julgada para os importadores achados por `git grep` — a busca é por
//     specifier textual, então um import escrito de forma exótica não é achado.
//
// A DÍVIDA DECLARADA E A CATRACA
//
// A classe pode já existir em commits ANTIGOS da série (história não se reescreve
// por gate). Essas ficam em `ci/commit-import-exports-baseline.json`, nomeadas uma
// a uma com o motivo, e são PUBLICADAS no relatório — nunca escondidas. Duas
// catracas: (1) violação que não está na baseline reprova; (2) entrada da baseline
// que NÃO reproduz na série medida reprova — dívida declarada que já não existe é
// dívida que ninguém apagou, e a lista não pode virar cemitério.
// =============================================================================

import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join, resolve as resolvePath } from "node:path"
import process from "node:process"

/** Exit codes — o contrato da CLI. */
export const EXIT = {
  OK: 0,
  VIOLATIONS: 1,
  UNAVAILABLE: 2,
  USAGE: 3,
}

/** Onde a dívida declarada mora (relativo à raiz do repo medido). */
export const BASELINE_FILE = "ci/commit-import-exports-baseline.json"

/** Extensões que são módulo (têm imports/exports). */
export const MODULE_EXT_RE = /\.(ts|tsx|mts|cts|mjs|cjs|js|jsx)$/

/** Extensões de ASSET: import válido, sem promessa de export nomeado. */
export const ASSET_EXT_RE =
  /\.(css|scss|sass|less|json|svg|png|jpe?g|gif|webp|ico|md|mdx|txt|ya?ml|toml|wasm|html|xml|graphql|gql|csv|woff2?|ttf|mp4|webm)$/

/** Aliases de tsconfig que apontam para dentro da árvore (`@/x` → `src/x`). */
export const PATH_ALIASES = [["@/", "src/"]]

/** Extensões tentadas ao resolver um specifier sem extensão, na ordem. */
export const EXT_CANDIDATES = [
  "",
  ".ts",
  ".tsx",
  ".mts",
  ".mjs",
  ".js",
  ".jsx",
  "/index.ts",
  "/index.tsx",
  "/index.mjs",
  "/index.js",
]

/**
 * Quantas linhas a cláusula de um import/export pode ocupar (o prettier quebra
 * listas). MEDIDO: o limite de 8 truncava listas REAIS desta árvore — a lista de
 * `src/components/ui/select.tsx` tem 11 linhas e perdia o último nome
 * (`SelectValue`), e a de `src/components/admin/_shared.ts` passa de 40 — o corte
 * virava falso positivo ("importa nome que o alvo não exporta" quando o alvo
 * exporta SIM, na linha seguinte). Limite folgado: 200 linhas cobrem qualquer
 * lista gerada por prettier com printWidth 100.
 */
export const MAX_LINHAS_CLAUSULA = 200

/**
 * O mapeamento do mundo NodeNext: um import de `./x.js` pode ser o arquivo
 * `./x.ts` na árvore (o `.js` é o que o emitido vai gerar). Sem isto o resolver
 * diria "módulo ausente" e o guard acusaria um defeito que não existe (medido em
 * `scripts/geo-benchmark-real.mjs`, que importa `../src/lib/geo-shared.mjs`).
 */
export const NODENEXT_REWRITE = [
  [/\.js$/, ".ts"],
  [/\.jsx$/, ".tsx"],
  [/\.mjs$/, ".mts"],
  [/\.cjs$/, ".cts"],
]

/** Normaliza `a/b/../c` sem tocar no disco. */
export function normalizar(p) {
  const out = []
  for (const seg of p.split("/")) {
    if (seg === "" || seg === ".") continue
    if (seg === "..") out.pop()
    else out.push(seg)
  }
  return out.join("/")
}

/**
 * O estado de bloco de comentário de cada linha. Não é um lexer: é a informação
 * mínima para não ler código DENTRO de comentário de bloco — e para não perder o
 * `export` que divide a linha com o FECHAMENTO do bloco (o par `*` `/` antes do
 * `export function f`), que é export de verdade — medido em `measure-mutation-trend`.
 */
export function estadoDeComentario(linhas) {
  const dentro = []
  let estado = "code"
  for (const linha of linhas) {
    dentro.push(estado === "bloco")
    let i = 0
    while (i < linha.length) {
      const c = linha[i]
      const d = linha[i + 1]
      if (estado === "code") {
        if (c === "/" && d === "*") {
          estado = "bloco"
          i += 2
          continue
        }
        if (c === "/" && d === "/") break // resto da linha é comentário
        // STRINGS CONTAM: um `"/*"` ou um template com `*/` dentro abria um bloco
        // que nunca fechava e CEGAVA o resto do arquivo — medido: 209 falsos
        // positivos no topo, todos "o alvo não exporta o nome" (o topo compila).
        if (c === '"') estado = "aspas2"
        else if (c === "'") estado = "aspas1"
        else if (c === "`") estado = "template"
        i++
        continue
      }
      if (estado === "bloco") {
        if (c === "*" && d === "/") {
          estado = "code"
          i += 2
          continue
        }
        i++
        continue
      }
      if (estado === "template") {
        if (c === "\\") {
          i += 2
          continue
        }
        if (c === "`") estado = "code"
        i++
        continue
      }
      // aspas simples/duplas: não atravessam linha (uma aspa não fechada dentro da
      // linha é tratada como fechada no fim dela — conservador e declarado)
      if (c === "\\") {
        i += 2
        continue
      }
      if ((estado === "aspas2" && c === '"') || (estado === "aspas1" && c === "'")) estado = "code"
      i++
    }
    if (estado === "aspas1" || estado === "aspas2") estado = "code"
  }
  return { dentro, abertoNoFim: estado === "bloco" }
}

/** Tira o fechamento de bloco que ficou na frente da linha, se houver. */
export function semFechamentoDeBloco(linha) {
  return linha.replace(/^\s*(?:\*\/\s*)+/, "")
}

/** A linha é um comentário (não pode iniciar instrução)? */
function ehComentario(linha) {
  const t = linha.trim()
  return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")
}

/** Um identificador válido de nome exportado/importado. */
function ehIdentificador(s) {
  return /^[A-Za-z_$][\w$]*$/.test(s)
}

/**
 * Separa o conteúdo de uma lista `{ … }` (aceita `a as b`, `type A`, multilinha).
 *
 * A DIREÇÃO DO `as` É O CONTRÁRIO NOS DOIS SENTIDOS, e trocar isso é o erro mais
 * caro desta régua: em `import { run as runCountGuard }` o nome exigido do alvo é
 * `run` (o apelido é LOCAL); em `export { x as y }` o nome publicado é `y`.
 * Medido: o helper usando o lado errado acusou `runCountGuard` dezenas de vezes.
 */
export function nomesDaLista(conteudo, direcao = "import") {
  const nomes = []
  for (const parte of conteudo.split(",")) {
    const t = parte
      .replace(/\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .trim()
    if (!t) continue
    const semType = t.replace(/^type\s+/, "")
    const as = /^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/.exec(semType)
    const nome = as ? (direcao === "export" ? as[2] : as[1]) : semType
    if (ehIdentificador(nome.trim())) nomes.push(nome.trim())
  }
  return nomes
}

/**
 * A linha PESQUISA um `from`? (`import <cláusula>` que não seja de efeito puro,
 * `export { … }` ou `export * …`.)
 *
 * A checagem é SINTÁTICA de propósito: `export const X = { … }` e
 * `export type T = { … }` têm `{` no CORPO e NÃO prometem `from` — tratá-las como
 * cláusula (só porque contêm `{`) declarou 3252 não-julgáveis falsos nesta árvore.
 */
function pareceClausulaComFrom(t) {
  if (/^import\s/.test(t) && !/^import\s*["']/.test(t)) return true
  // Na CLASSE de caracteres o `{` já é literal: o escape não faz nada (e o lint
  // o acusa como `no-useless-escape`).
  if (/^export\s+(?:type\s+)?[{*]/.test(t)) return true
  return false
}

/** A instrução PROMETE um `from` e não achou nenhum: só `import` de cláusula e `export *`. */
function prometeFrom(t) {
  if (/^import\s/.test(t) && !/^import\s*["']/.test(t)) return true
  return /^export\s+(?:type\s+)?\*/.test(t)
}

/**
 * Os nomes de `@typedef` do JSDoc contam como export de TIPO do módulo JS: é assim
 * que `scripts/hook-simulator.mjs` publica `StubSpec`/`RunResult`/`RepoOptions`/
 * `HookFile` (o wrapper tipado os re-exporta, e o tsc resolve com allowJs). O nome
 * vem DEPOIS do `}` que fecha a anotação, que pode atravessar linhas.
 */
export function typedefsDeJSDoc(source) {
  const linhas = source.split("\n")
  const nomes = []
  for (let i = 0; i < linhas.length; i++) {
    const abre = /@typedef\s+\{/.exec(linhas[i])
    if (!abre) continue
    let saldo = 0
    let achou = false
    for (let k = i; k < linhas.length && k - i < 40 && !achou; k++) {
      const trecho = k === i ? linhas[k].slice(abre.index + abre[0].length - 1) : linhas[k]
      for (let j = 0; j < trecho.length; j++) {
        if (trecho[j] === "{") saldo++
        else if (trecho[j] === "}") {
          saldo--
          if (saldo === 0) {
            const nome = /^\s*([A-Za-z_$][\w$]*)/.exec(trecho.slice(j + 1))
            if (nome) nomes.push(nome[1])
            achou = true
            break
          }
        }
      }
    }
  }
  return nomes
}

/** Saldo de `{` menos `}` — decide se a cláusula ainda está aberta (lista quebrada). */
function saldoDeChaves(s) {
  let n = 0
  for (const c of s) {
    if (c === "{") n++
    else if (c === "}") n--
  }
  return n
}

/**
 * Extrai imports e re-exports por LINHA. Devolve `{spec, nomes, namespace,
 * padrao, efeito, reexport}` — os mesmos campos para o `export … from`.
 */
export function parseImports(source) {
  const linhas = source.split("\n")
  const { dentro: dentroDeBloco } = estadoDeComentario(linhas)
  const out = []
  for (let i = 0; i < linhas.length; i++) {
    // A linha que COMEÇA dentro de bloco mas contém o `*/` de fechamento pode
    // carregar código depois dele (` */ export function f…` — medido em
    // measure-mutation-trend/seed-e2e-count). Só o conteúdo de comentário puro é pulado.
    if (dentroDeBloco[i] && !linhas[i].includes("*/")) continue
    const linha = semFechamentoDeBloco(linhas[i])
    const t = linha.trim()
    const m = /^(import|export)\b/.exec(t)
    if (!m) continue
    if (ehComentario(linha) && !/^(import|export)\b/.test(linha.trim())) continue

    // efeito puro: `import "./x"` (sem `from`)
    const soEfeito = /^(import)\s*(["'])([^"']+)\2\s*;?$/.exec(t)
    if (soEfeito) {
      out.push({
        spec: soEfeito[3],
        nomes: [],
        namespace: false,
        padrao: false,
        efeito: true,
        reexport: false,
      })
      continue
    }
    if (!pareceClausulaComFrom(t)) continue // declaração com `{` no corpo, `import.meta`, …

    // junta a cláusula nas linhas seguintes (listas quebradas pelo prettier). A
    // CONTINUAÇÃO É JULGADA: só continua com a lista `{ … }` ABERTA (saldo > 0) ou
    // quando a próxima linha começa com `from` (quebra depois do `}` fechado). Sem
    // isso um `export { a }` LOCAL colaria no `from` de uma instrução SEGUINTE e
    // exigiria do alvo errado um nome local — o limite de 200 linhas tornaria isso
    // provável em vez de raro.
    let clausula = t
    let finais = null
    for (let k = 0; k <= MAX_LINHAS_CLAUSULA; k++) {
      const mm = /^(.*?)\s*from\s*(["'])([^"']+)\2\s*([^\n]?)/.exec(clausula)
      if (mm) {
        finais = mm
        break
      }
      const proxima = linhas[i + k + 1]
      if (proxima === undefined) break
      const tprox = proxima.trim()
      if (tprox === "" || tprox.startsWith(";")) break
      if (ehComentario(proxima) || dentroDeBloco[i + k + 1]) break
      if (saldoDeChaves(clausula) <= 0 && !/^from\b/.test(tprox)) break
      clausula += " " + tprox
    }

    if (!finais) {
      // FAIL-CLOSED: instrução que PROMETE um `from` e não fecha um dentro do
      // limite é NÃO-JULGÁVEL (declarada), nunca silenciosamente ignorada.
      if (prometeFrom(t))
        out.push({
          spec: null,
          nomes: [],
          namespace: false,
          padrao: false,
          efeito: false,
          reexport: false,
          naoJulgavel: "cláusula sem `from` dentro do limite",
        })
      continue
    }
    if (/[.+[]/.test(finais[4] ?? "")) continue // specifier computado

    const antes = finais[1].replace(/^(import|export)\b/, "").trim()
    const nomes = []
    let namespace = false
    let padrao = false
    const lista = antes.match(/\{([\s\S]*)\}/)
    // A DIREÇÃO DO `as` AQUI É SEMPRE A DO LADO "ORIGEM" DO ALVO, inclusive no
    // RE-EXPORT: `export { activeTier as currentTier } from "./client"` exige que
    // `./client` exporte `activeTier` (e PUBLICA currentTier — quem lê isso é o
    // parseExports). Medido: usar o lado publicado aqui acusou `currentTier`
    // contra um alvo que só tem `activeTier`.
    if (lista) nomes.push(...nomesDaLista(lista[1], "import"))
    if (/\*\s+as\s+[A-Za-z_$][\w$]*/.test(antes) || /\*\s*$/.test(antes)) namespace = true
    // `import type { … }` / `export type { … }` / `import type Foo` / `export type *`:
    // o `type` é MODIFICADOR da cláusula, não binding — tirá-lo ANTES do corte da lista
    // (depois do corte sobra só a palavra `type`, que passava como identificador e virava
    // um default import exigido do alvo: foi esse o bug dos 209 falsos "default de X").
    const semTypeAntes = /^type\s/.test(antes) ? antes.replace(/^type\s+/, "") : antes
    const semLista = semTypeAntes
      .replace(/\{[\s\S]*\}/g, "")
      .replace(/,\s*$/, "")
      .trim()
    // default de verdade: UM ÚNICO token identificador depois de tirar lista/namespace
    // (exige token único: `* as ns` e sobras de cláusulas compostas não são default)
    const tokens = semLista ? semLista.split(/\s+/) : []
    if (tokens.length === 1 && ehIdentificador(tokens[0])) padrao = true
    out.push({
      spec: finais[3],
      nomes,
      namespace,
      padrao,
      efeito: false,
      reexport: m[1] === "export",
    })
  }
  return out
}

/**
 * Extrai o CONJUNTO de nomes exportados por LINHA. `opaque` marca o
 * `export * from` (o conjunto deixa de ser conhecível e o import do alvo passa
 * como não-julgável).
 */
export function parseExports(source) {
  const linhas = source.split("\n")
  const { dentro: dentroDeBloco, abertoNoFim } = estadoDeComentario(linhas)
  const names = new Set(typedefsDeJSDoc(source))
  let opaque = abertoNoFim
  for (let i = 0; i < linhas.length; i++) {
    // idem parseImports: `*/ export function f…` é código, não conteúdo de comentário
    if (dentroDeBloco[i] && !linhas[i].includes("*/")) continue
    const linha = semFechamentoDeBloco(linhas[i])
    const t = linha.trim()
    if (!/^export\b/.test(t)) continue

    if (/^export\s+default\b/.test(t)) {
      names.add("default")
      const nome = /^export\s+default\s+(?:async\s+)?(?:function|class)\s+([A-Za-z_$][\w$]*)/.exec(
        t,
      )
      if (nome) names.add(nome[1])
      continue
    }
    if (/^export\s+(?:type\s+)?\*\s+from\b/.test(t)) {
      // `export type * from` também deixa o conjunto (dos tipos) desconhecível
      opaque = true
      continue
    }
    const starAs = /^export\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\b/.exec(t)
    if (starAs) {
      names.add(starAs[1])
      continue
    }
    const decl =
      /^export\s+(?:declare\s+)?(?:async\s+)?(?:abstract\s+)?(?:const|let|var|function|class|type|interface|enum|namespace|module)\s+([A-Za-z_$][\w$]*)/.exec(
        t,
      )
    if (decl) {
      names.add(decl[1])
      // `export const a = 1, b = 2` — os seguintes da mesma declaração
      if (/^(?:export\s+)?const|let|var/.test(t) || /^export\s+const/.test(t)) {
        for (const parte of t.split(",").slice(1)) {
          const outro = /^\s*([A-Za-z_$][\w$]*)\s*=/.exec(parte)
          if (outro) names.add(outro[1])
        }
      }
      continue
    }
    // lista `export { … }` (pode abrir e fechar em linhas diferentes)
    const abre = /^export\s*(?:type\s*)?\{/.exec(t)
    if (abre) {
      let conteudo = t.slice(abre[0].length)
      let k = i
      while (!conteudo.includes("}") && k < linhas.length - 1 && k - i <= MAX_LINHAS_CLAUSULA) {
        k++
        if (dentroDeBloco[k]) continue
        conteudo += "\n" + linhas[k]
      }
      // FAIL-CLOSED: lista que não fecha dentro do limite deixa o conjunto
      // desconhecível → OPACO (o alvo vira não-julgável em vez de falso positivo).
      if (!conteudo.includes("}")) {
        opaque = true
        continue
      }
      const fechado = conteudo.slice(0, conteudo.indexOf("}"))
      for (const nome of nomesDaLista(fechado, "export")) names.add(nome)
      continue
    }
  }
  return { names, opaque }
}

/**
 * Resolve um specifier ao caminho DENTRO da árvore, ou `null` quando não é
 * julgável (externo/asset). `stat(caminho)` devolve "file" | "dir" | null — é o
 * ponto de injeção do teste (mapa em memória) e da CLI (`git cat-file -t`).
 */
export function resolveSpecifier(spec, fromPath, stat) {
  if (!spec) return null
  if (ASSET_EXT_RE.test(spec)) return null
  const alias = PATH_ALIASES.find(([a]) => spec.startsWith(a))
  const relativo = spec.startsWith(".")
  if (!relativo && !alias) return null // bare/node:/bun: = pacote, não árvore
  const base = relativo
    ? normalizar(`${dirname(fromPath)}/${spec}`)
    : normalizar(`${alias[1]}${spec.slice(alias[0].length)}`)

  const rewrite = NODENEXT_REWRITE.find(([re]) => re.test(base))
  const semExtBase = rewrite ? base.replace(rewrite[0], "") : base
  const candidatos = []
  if (rewrite) {
    candidatos.push(base) // o arquivo como escrito (`x.js` pode existir mesmo)
    candidatos.push(`${semExtBase}${rewrite[1]}`) // o equivalente TS (`x.ts`)
  }
  for (const e of EXT_CANDIDATES) candidatos.push(`${semExtBase}${e}`)

  for (const c of candidatos) if (MODULE_EXT_RE.test(c) && stat(c) === "file") return c
  for (const c of candidatos) if (stat(c) === "file") return c // existe e não é módulo (asset)
  return candidatos[0] ?? null
}

/**
 * O núcleo puro: dado um commit e um leitor de árvore, devolve as violações.
 *
 *   commit  : { sha, arquivos: [{ path, source }], arquivosAntes?: Map }
 *   ler     : (path) => source | null                  — a árvore DO COMMIT
 *   stat    : (path) => "file" | "dir" | null
 *   importadoresDe : (alvo) => [paths]                  — quem importa o alvo no commit
 *
 * Só os arquivos mudados precisam ser varridos: a invariante em C^1 é assumida, e
 * a única forma de quebrá-la é (a) mudar um IMPORTADOR — os imports dele são
 * re-julgados aqui — ou (b) mudar um EXPORTADOR — e aí os importadores de FORA
 * entram pelo `importadoresDe` (na CLI, um `git grep`).
 */
export function violacoesDoCommit({ commit, ler, stat, importadoresDe }) {
  const violacoes = []
  const naoJulgaveis = []
  const exportadosAntes = new Map()
  for (const arq of commit.arquivos) {
    const antes = commit.arquivosAntes?.get?.(arq.path)
    if (antes !== undefined && antes !== null)
      exportadosAntes.set(arq.path, parseExports(antes).names)
  }

  for (const arq of commit.arquivos) {
    for (const imp of parseImports(arq.source)) {
      if (imp.naoJulgavel) {
        naoJulgaveis.push({
          sha: commit.sha,
          arquivo: arq.path,
          alvo: "?",
          motivo: imp.naoJulgavel,
        })
        continue
      }
      const alvo = resolveSpecifier(imp.spec, arq.path, stat)
      if (!alvo) continue
      if (!MODULE_EXT_RE.test(alvo)) continue // asset: não promete export nomeado
      const fonteAlvo = ler(alvo)
      if (fonteAlvo === null || fonteAlvo === undefined) {
        violacoes.push({
          sha: commit.sha,
          arquivo: arq.path,
          nome: "(módulo ausente)",
          alvo,
          spec: imp.spec,
        })
        continue
      }
      const { names, opaque } = parseExports(fonteAlvo)
      if (opaque) {
        naoJulgaveis.push({ sha: commit.sha, arquivo: arq.path, alvo, motivo: "export * no alvo" })
        continue
      }
      for (const nome of imp.nomes) {
        if (!names.has(nome))
          violacoes.push({ sha: commit.sha, arquivo: arq.path, nome, alvo, spec: imp.spec })
      }
      if (imp.padrao && !names.has("default")) {
        violacoes.push({
          sha: commit.sha,
          arquivo: arq.path,
          nome: "default",
          alvo,
          spec: imp.spec,
        })
      }
    }
  }

  // (b) o commit TIRA (ou renomeia) um export de um módulo que ele mudou → quem
  // importa aquele módulo de FORA do commit tem de continuar achando o nome.
  for (const arq of commit.arquivos) {
    const antes = exportadosAntes.get(arq.path)
    if (!antes) continue
    const { names, opaque } = parseExports(arq.source)
    if (opaque) continue
    const saiu = [...antes].filter((n) => !names.has(n))
    if (saiu.length === 0) continue
    for (const importador of importadoresDe ? importadoresDe(arq.path) : []) {
      if (commit.arquivos.some((a) => a.path === importador)) continue // já julgado acima
      const fonte = ler(importador)
      if (fonte === null || fonte === undefined) continue
      for (const imp of parseImports(fonte)) {
        const alvo = resolveSpecifier(imp.spec, importador, stat)
        if (alvo !== arq.path) continue
        for (const nome of imp.nomes) {
          if (saiu.includes(nome)) {
            violacoes.push({
              sha: commit.sha,
              arquivo: importador,
              nome,
              alvo: arq.path,
              spec: imp.spec,
              via: "export removido",
            })
          }
        }
        if (imp.padrao && saiu.includes("default")) {
          violacoes.push({
            sha: commit.sha,
            arquivo: importador,
            nome: "default",
            alvo: arq.path,
            spec: imp.spec,
            via: "export removido",
          })
        }
      }
    }
  }

  return { violacoes, naoJulgaveis }
}

/** Chave estável de uma violação, para a baseline e o relatório. */
export function chaveDa(v) {
  return `${v.sha}\t${v.arquivo}\t${v.nome}\t${v.alvo}`
}

/**
 * Separa o que a série mediu do que a baseline declara:
 *   · novas      — reprovam
 *   · declaradas — publicadas (nunca escondidas)
 *   · obsoletas  — entradas da baseline que NÃO reproduzem (reprovam: catraca)
 */
export function separar({ violacoes, baseline }) {
  const doBaseline = new Set()
  const declaradas = []
  const obsoletas = []
  for (const e of baseline) {
    const chave = `${e.commit}\t${e.arquivo}\t${e.nome}\t${e.alvo}`
    doBaseline.add(chave)
    const bate = violacoes.find((v) => chaveDa(v) === chave)
    if (bate) declaradas.push(bate)
    else obsoletas.push(e)
  }
  const novas = violacoes.filter((v) => !doBaseline.has(chaveDa(v)))
  return { novas, declaradas, obsoletas }
}

/** A baseline, lida da árvore medida (ausente = lista vazia). */
export function lerBaseline(repo) {
  const caminho = join(repo, BASELINE_FILE)
  if (!existsSync(caminho)) return { entradas: [], origem: null }
  const bruto = JSON.parse(readFileSync(caminho, "utf8"))
  const entradas = Array.isArray(bruto) ? bruto : (bruto.entradas ?? [])
  return { entradas, origem: `${BASELINE_FILE} (version ${bruto.version ?? "?"})` }
}

/**
 * Resolve a BASE com a MESMA régua do prover da pilha (régua única): `--base`,
 * o env do CI de cada forja, ou `origin/main`. A ORDEM é declarada e o relatório
 * publica qual régua valeu — a base errada mediria outro recorte em silêncio.
 */
export function resolveBase({ base, env, existeRef, git }) {
  if (base) return { ref: base, origem: "--base" }
  const doGithub = env.GITHUB_BASE_REF
  if (doGithub) return { ref: `origin/${doGithub}`, origem: "GITHUB_BASE_REF" }
  const doGitea = env.CI_MERGE_REQUEST_TARGET_BRANCH_NAME
  if (doGitea) return { ref: `origin/${doGitea}`, origem: "CI_MERGE_REQUEST_TARGET_BRANCH_NAME" }
  if (existeRef("origin/main")) return { ref: "origin/main", origem: "default (origin/main)" }
  const main = git(["branch", "--list", "main", "--format=%(refname:short)"])
  if (main.trim()) return { ref: "main", origem: "default (main local)" }
  return null
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function gitEm(repo) {
  return (args) =>
    execFileSync("git", args, { cwd: repo, encoding: "utf8", maxBuffer: 128 * 1024 * 1024 })
}

/**
 * O git da leitura de árvore: a ausência de `sha:path` é RESPOSTA (o arquivo não
 * está naquele commit), não erro — o `fatal: path … does not exist` é silenciado
 * para o relatório não virar ruído. Fail-closed no que importa: `null` = não há.
 */
function gitQuieto(repo) {
  return (args) =>
    execFileSync("git", args, {
      cwd: repo,
      encoding: "utf8",
      maxBuffer: 128 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    })
}

function parseArgs(argv) {
  const cfg = {
    base: null,
    only: null,
    head: null,
    json: false,
    repo: process.cwd(),
    baseline: true,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--base") cfg.base = argv[++i]
    else if (a === "--only") cfg.only = argv[++i]
    else if (a === "--head") cfg.head = argv[++i]
    else if (a === "--json") cfg.json = true
    else if (a === "--repo") cfg.repo = argv[++i]
    else if (a === "--no-baseline") cfg.baseline = false
    else if (a === "-h" || a === "--help") return { ajuda: true }
    else return { erro: `argumento desconhecido: ${a}` }
  }
  return cfg
}

/** O leitor da árvore de UM commit: blob provado, conteúdo silencioso. */
function lerArvore(repo, sha) {
  const quieto = gitQuieto(repo)
  const stat = (p) => {
    try {
      const t = quieto(["cat-file", "-t", `${sha}:${p}`]).trim()
      return t === "blob" ? "file" : t === "tree" ? "dir" : null
    } catch {
      return null
    }
  }
  const ler = (p) => {
    try {
      return quieto(["show", `${sha}:${p}`])
    } catch {
      return null
    }
  }
  return { stat, ler }
}

/** Os módulos mudados por um commit. */
export function arquivosMudados(git, sha) {
  const out = git(["diff-tree", "-r", "--no-commit-id", "--name-only", sha])
  return out.trim().split("\n").filter(Boolean)
}

/** Todos os módulos da árvore do commit (varredura completa do `--only`). */
export function listarModulos(git, sha) {
  const out = git(["ls-tree", "-r", "--name-only", sha])
  return out
    .trim()
    .split("\n")
    .filter((f) => f && MODULE_EXT_RE.test(f))
}

/** Os módulos que importam `alvo` NAQUELE commit (uma passada de `git grep`). */
export function importadoresDe(repo, sha) {
  const cache = new Map()
  const quieto = gitQuieto(repo)
  return (alvo) => {
    if (cache.has(alvo)) return cache.get(alvo)
    const semExt = alvo.replace(MODULE_EXT_RE, "").replace(/\/index$/, "")
    const base = alvo.split("/").pop().replace(MODULE_EXT_RE, "")
    const saida = new Set()
    for (const padrao of [`from "${semExt}"`, `from './${base}'`, `from "../${base}"`]) {
      try {
        const out = quieto([
          "grep",
          "-l",
          "-F",
          "-e",
          padrao,
          sha,
          "--",
          "*.ts",
          "*.tsx",
          "*.mts",
          "*.mjs",
          "*.js",
        ])
        for (const linha of out.trim().split("\n")) {
          const arq = linha.replace(new RegExp(`^${sha}:`), "")
          if (arq) saida.add(arq)
        }
      } catch {
        /* nenhum casamento */
      }
    }
    const lista = [...saida]
    cache.set(alvo, lista)
    return lista
  }
}

/**
 * A varredura de um commit. `completo` varre a árvore inteira (usada no
 * `--only SHA`, onde não há incrementalidade para explorar).
 */
export function varrerCommit({ sha, repo, git, completo = false, arquivosAntes }) {
  const { stat, ler } = lerArvore(repo, sha)
  const quieto = gitQuieto(repo)
  const alvos = completo
    ? listarModulos(git, sha)
    : arquivosMudados(git, sha).filter((f) => MODULE_EXT_RE.test(f))
  const arquivos = []
  for (const f of alvos) {
    const source = ler(f)
    if (source === null) continue
    arquivos.push({ path: f, source })
  }
  if (arquivosAntes === undefined) {
    const antes = new Map()
    for (const f of arquivos.map((a) => a.path)) {
      try {
        antes.set(f, quieto(["show", `${sha}^:${f}`]))
      } catch {
        /* arquivo novo no commit */
      }
    }
    arquivosAntes = antes
  }
  return violacoesDoCommit({
    commit: { sha, arquivos, arquivosAntes },
    ler,
    stat,
    importadoresDe: importadoresDe(repo, sha),
  })
}

const USO =
  "uso: node scripts/check-commit-import-exports.mjs [--base REF] [--head REF] [--only SHA] [--repo DIR] [--json] [--no-baseline]"

function main(argv) {
  const cfg = parseArgs(argv)
  if (cfg.ajuda) {
    console.log(USO)
    return EXIT.OK
  }
  if (cfg.erro) {
    console.error(`❌ uso inválido: ${cfg.erro}`)
    console.error(USO)
    return EXIT.USAGE
  }
  const repo = resolvePath(cfg.repo)
  const git = gitEm(repo)
  try {
    git(["rev-parse", "--git-dir"])
  } catch {
    console.error(`❌ não é um repositório git: ${repo}`)
    return EXIT.UNAVAILABLE
  }

  let commits = []
  let baseUsada = "—"
  if (cfg.only) {
    commits = [git(["rev-parse", cfg.only]).trim()]
    baseUsada = `--only ${cfg.only} (varredura completa da árvore do commit)`
  } else {
    // O HEAD medido: `--head`, o env do job (`PILHA_HEAD` — no PR o checkout é o
    // commit de MERGE, e medir a série a partir dele mediria outra série: a mesma
    // régua do prover da pilha), ou o HEAD do checkout.
    const headBruto = cfg.head || process.env.PILHA_HEAD || "HEAD"
    let head = ""
    try {
      head = git(["rev-parse", "--verify", "--quiet", `${headBruto}^{commit}`]).trim()
    } catch {
      head = ""
    }
    if (!head) {
      console.error(
        `❌ não consegui resolver o HEAD '${headBruto}' neste repositório — sem o head, o recorte mediria outra série`,
      )
      return EXIT.UNAVAILABLE
    }
    const base = resolveBase({
      base: cfg.base,
      env: process.env,
      existeRef: (r) => {
        try {
          git(["rev-parse", "--verify", "--quiet", r])
          return true
        } catch {
          return false
        }
      },
      git,
    })
    if (!base) {
      console.error(
        "❌ SEM BASE resolvida: passe --base REF (ou defina GITHUB_BASE_REF) — um recorte chutado mediria a coisa errada",
      )
      return EXIT.UNAVAILABLE
    }
    const origemHead = cfg.head
      ? "--head"
      : process.env.PILHA_HEAD
        ? "PILHA_HEAD"
        : "HEAD do checkout"
    baseUsada = `${base.ref} (${base.origem}) · head ${head.slice(0, 8)} (${origemHead})`
    const mb = git(["merge-base", base.ref, head]).trim()
    commits = git(["rev-list", "--reverse", `${mb}..${head}`])
      .trim()
      .split("\n")
      .filter(Boolean)
  }

  const violacoes = []
  const naoJulgaveis = []
  for (const sha of commits) {
    const r = varrerCommit({ sha, repo, git, completo: Boolean(cfg.only) })
    violacoes.push(...r.violacoes)
    naoJulgaveis.push(...r.naoJulgaveis)
  }

  const { entradas: baseline, origem: origemBaseline } = cfg.baseline
    ? lerBaseline(repo)
    : { entradas: [], origem: null }
  const { novas, declaradas, obsoletas } = separar({ violacoes, baseline })

  const relatorio = {
    base: baseUsada,
    commits: commits.length,
    violacoes: violacoes.length,
    novas,
    declaradas,
    obsoletas,
    naoJulgaveis,
    baseline: origemBaseline,
  }

  if (cfg.json) {
    console.log(JSON.stringify(relatorio, null, 2))
  } else {
    const curto = (s) => (s ?? "").slice(0, 8)
    console.log(`régua: ${baseUsada}`)
    console.log(
      `commits medidos: ${commits.length} · violações: ${violacoes.length} (novas: ${novas.length})`,
    )
    if (origemBaseline)
      console.log(
        `dívida declarada: ${origemBaseline} — ${declaradas.length} entrada(s) reproduzida(s), ${obsoletas.length} obsoleta(s)`,
      )
    for (const v of novas)
      console.log(
        `  ❌ ${curto(v.sha)}  ${v.arquivo}  importa "${v.nome}" de ${v.alvo}${v.via ? ` (${v.via})` : ""}`,
      )
    for (const v of declaradas)
      console.log(`  ⚠️ declarada: ${curto(v.sha)}  ${v.arquivo}  importa "${v.nome}" de ${v.alvo}`)
    for (const o of obsoletas)
      console.log(
        `  ❌ entrada OBSOLETA na baseline: ${curto(o.commit)} ${o.arquivo} "${o.nome}" de ${o.alvo} — não reproduz`,
      )
    if (naoJulgaveis.length)
      console.log(`  ⊘ não-julgáveis: ${naoJulgaveis.length} (alvo com \`export *\`)`)
    if (novas.length === 0 && obsoletas.length === 0) {
      console.log("✅ nenhum módulo importa nome que a árvore do seu commit não exporta")
    }
  }

  if (novas.length > 0 || obsoletas.length > 0) return EXIT.VIOLATIONS
  return EXIT.OK
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main(process.argv.slice(2)))
