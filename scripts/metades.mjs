#!/usr/bin/env node
// =============================================================================
// metades.mjs — A régua das METADES de uma suíte de mutação
// =============================================================================
//
// Usage:
//   node scripts/metades.mjs <script-da-suíte>            # resumo legível
//   node scripts/metades.mjs <script-da-suíte> --json     # { ok, metades, ... }
//   node scripts/metades.mjs --anunciadas <arquivo|-|>    # só os anúncios
//   node scripts/metades.mjs --resumo <script1> <script2> ...
//
// Exit codes:
//   0 — a suíte DECLARA as suas metades (o bloco foi lido)
//   1 — o bloco METADES está ausente, vazio, ilegível ou com id repetido
//   2 — uso inválido (arquivo ausente, flag desconhecida)
//
// POR QUE: a descrição das metades de uma suíte de mutação vivia à mão em TRÊS
// lugares — no array `SUBTESTS` do master, no bloco de prosa do cabeçalho dele e
// na doc (`docs/GUARDS.md`) —, e acrescentar uma mutação deixava os três
// desatualizados em silêncio (os counts por extenso, então, envelheciam sem
// ninguém ver). Aqui a fonte única é a PRÓPRIA suíte: um bloco `METADES=(...)`
// no topo do script, com uma linha por metade (`"id|descrição"`). O master lê a
// descrição daqui em vez de tê-la escrita, e a doc é conferida CONTRA este
// mesmo parser — uma régua só, num lugar só.
//
// A SEGUNDA metade desta régua é a testemunha: `metadesAnunciadas` lê o TEXTO
// (o arquivo da suíte por leitura, ou a SAÍDA dela quando quem chama é o master)
// e extrai as metades que o script ANUNCIA — `MUTAÇÃO M9: …`, `M1 (a régua …)`,
// `C1: …`, `STEP 4: …` (→ id `S4`). É ela que prova, por execução, que toda
// metade DECLARADA foi anunciada de verdade: uma declaração que não roda é uma
// promessa, e uma metade que some do script sem sair da declaração acende.
//
// O BLOCO (formato exato, fail-closed):
//
//   METADES=(
//     'M1|a regra que a metade tira do lugar'
//   )
//
// - uma linha por metade, `'id|descrição'`, em ASPAS SIMPLES;
// - comentário (`#`) e linha vazia dentro do bloco são permitidos;
// - QUALQUER outra linha dentro do bloco é violação (fail-closed: um bloco que
//   o parser não entende não pode virar "nenhuma metade");
// - id único dentro da suíte e descrição com pelo menos DESCRICAO_MIN caracteres
//   (uma metade sem descrição legível é a mesma prosa que este parser veio
//   substituir, só que agora dentro do array).
//
// POR QUE ASPAS SIMPLES (não é estilo: é o que impede a suíte de morrer): o
// bloco é um ARRAY DE BASH no corpo de um script com `set -euo pipefail`. Em
// aspas DUPLAS, o shell EXPANDE o conteúdo antes de guardá-lo — e uma descrição
// que cite o código da mutação (`echo $OUT | grep -Fq`, `${{ ... }}`,
// `SCRIPT_DIR=$(dirname $0)`) faz a suíte estourar com `variável não associada`
// (medido: 4 suítes morreram assim, com a descrição virando o defeito). Em
// aspas simples nada é expandido: a descrição é PROSA, e a declaração continua
// inerte por construção. Uma entrada em aspas duplas é recusada aqui, com a
// razão — e a régua não aceita o `'` no meio da descrição (fecharia o literal).
// =============================================================================

import { existsSync, readFileSync } from "node:fs"

/** O prefixo da declaração, no script da suíte. */
export const BLOCO_ABRE = "METADES=("
export const BLOCO_FECHA = ")"
/** Descrição curta o bastante para caber numa linha de relatório. */
export const DESCRICAO_MIN = 8
/** O id do idioma `STEP n` (a suíte que não numera as metades com M/C/A). */
export const PREFIXO_PASSO = "S"

/** A linha é comentário (dentro do bloco, permitido)? */
function ehComentario(linha) {
  return /^\s*#/.test(linha)
}

/**
 * A linha é uma entrada em ASPAS DUPLAS (a forma que o shell expandiria)? É a
 * distinção que separa "formato errado" de "esta linha mata a suíte": a segunda
 * merece a razão escrita, não um "fora do formato" genérico.
 */
function ehAspasDuplas(linha) {
  return /^\s*"[^"|]+\|/.test(linha) || /^\s*"[^"|]+\|.*"\s*$/.test(linha)
}

/**
 * As metades DECLARADAS por uma suíte de mutação — o bloco `METADES=(...)`.
 *
 * Nunca lança: devolve `{ok: false, motivo}` para o chamador decidir (o guard
 * transforma em violação, o master em falha do sub-test). Um bloco ausente NÃO é
 * "nenhuma metade": é uma suíte que ainda fala por prosa à mão.
 *
 * @param {string} texto conteúdo do script da suíte
 * @returns {{ok: true, metades: {id: string, descricao: string, linha: number}[]}
 *          |{ok: false, motivo: string}}
 */
export function metadesDeclaradas(texto) {
  const linhas = texto.split("\n")
  const abre = linhas.findIndex((l) => l.trim() === BLOCO_ABRE)
  if (abre === -1)
    return {
      ok: false,
      motivo: `sem bloco \`${BLOCO_ABRE}...)\` (as metades não estão declaradas)`,
    }
  let fecha = -1
  for (let i = abre + 1; i < linhas.length; i++) {
    if (linhas[i].trim() === BLOCO_FECHA) {
      fecha = i
      break
    }
  }
  if (fecha === -1) return { ok: false, motivo: `bloco \`${BLOCO_ABRE}\` sem fechamento \`)\`` }

  const metades = []
  const vistos = new Set()
  for (let i = abre + 1; i < fecha; i++) {
    const linha = linhas[i]
    if (linha.trim() === "" || ehComentario(linha)) continue
    const m = /^\s*'([^'|]+)\|([^']*)'\s*$/.exec(linha)
    if (m === null) {
      const motivo = ehAspasDuplas(linha)
        ? `linha ${i + 1} do bloco METADES em ASPAS DUPLAS: ${linha.trim()} — aspas duplas deixam o shell EXPANDIR a descrição, e uma descrição que cita o código da mutação (cifrão, crase) mata a suíte com 'variável não associada'. Use aspas SIMPLES: \`'id|descrição'\``
        : `linha ${i + 1} do bloco METADES fora do formato \`'id|descrição'\`: ${linha.trim()}`
      return { ok: false, motivo }
    }
    const id = m[1].trim()
    const descricao = m[2].trim()
    if (id === "") return { ok: false, motivo: `linha ${i + 1} do bloco METADES com id vazio` }
    if (descricao.length < DESCRICAO_MIN)
      return {
        ok: false,
        motivo: `metade '${id}' (linha ${i + 1}) com descrição curta demais (${descricao.length} < ${DESCRICAO_MIN})`,
      }
    if (vistos.has(id))
      return { ok: false, motivo: `metade '${id}' declarada MAIS DE UMA VEZ (linha ${i + 1})` }
    vistos.add(id)
    metades.push({ id, descricao, linha: i + 1 })
  }
  if (metades.length === 0) return { ok: false, motivo: "bloco METADES vazio" }
  return { ok: true, metades }
}

// ── A testemunha: as metades que o script ANUNCIA ──────────────────────────

/**
 * O FORMATO do id de uma metade: `M22`, `E1`, `S4`, `A` — letras maiúsculas (até
 * 3) seguidas de 1-2 dígitos, OU uma LETRA só (as suítes que numeram por
 * cenário). Um token de prosa (`DA`, `NÃO`, `POR`) NÃO é id: sem os dígitos, a
 * letra tem de estar SOZINHA — é o que separa `C1` de "CENÁRIO" e `A` de "DA".
 */
const ID = "(?:[A-Z]{1,3}\\d{1,2}|[A-Z])"
/** O id do idioma `MUTAÇÃO <id>`/`MUTACAO <id>` (aceita também `MUTAÇÃO 3`). */
const RE_MUTACAO = new RegExp(
  `(?:^|[^\\p{L}\\p{N}_])MUTA(?:ÇÃO|CAO)\\s+(${ID}|\\d{1,2})\\b\\s*[:\\u2014\\u2013(.-]?\\s*(.*)$`,
  "u",
)
/** O id nu no começo do anúncio: `M9: …`, `M1 — …`, `M2 (a régua …)`, `C1: …`. */
const RE_ID_NU = new RegExp(`^\\s*[^\\p{L}\\p{N}_]*(${ID})\\s*[:\\u2014\\u2013(]\\s*(.*)$`, "u")
/** O idioma `STEP n` (a suíte sem ids próprios): o id declarado é `S<n>`. */
const RE_PASSO = /\bSTEP\s+(\d{1,2})\b[:.]?\s*(.*)$/u
/**
 * Tokens que casam o formato de id mas são PREFIXO/palavra da casa, não id de
 * metade: `M`/`S` sozinhos (o `M1`/`S4` de verdade traz o dígito) e o `N` que
 * abre um veredito de asserção ("NÃO MORDEU", "NÃO APLICOU").
 */
const NAO_E_ID = new Set(["M", "S", "N"])

/**
 * As metades ANUNCIADAS num texto — o arquivo da suíte (leitura) ou a SAÍDA
 * dela (execução, no master).
 *
 * A ordem importa: o anúncio (`MUTAÇÃO M9: …`) vem antes do eco (`M9: cego`), e
 * o primeiro que casa fica (a descrição é a do anúncio, não a do eco). Um mesmo
 * id anunciado duas vezes é UMA metade.
 *
 * @param {string} texto
 * @returns {{id: string, descricao: string, linha: number, forma: "mutacao"|"id"|"passo"}[]}
 */
export function metadesAnunciadas(texto) {
  const porId = new Map()
  const linhas = texto.split("\n")
  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i]
    if (linha.trim() === "") continue
    const mut = RE_MUTACAO.exec(linha)
    if (mut !== null && !NAO_E_ID.has(mut[1].toUpperCase())) {
      acrescenta(porId, mut[1].toUpperCase(), limpa(mut[2]), i + 1, "mutacao")
      continue
    }
    const nu = RE_ID_NU.exec(linha)
    if (nu !== null && !NAO_E_ID.has(nu[1])) {
      acrescenta(porId, nu[1].toUpperCase(), limpa(nu[2]), i + 1, "id")
      continue
    }
    const passo = RE_PASSO.exec(linha)
    if (passo !== null) {
      acrescenta(porId, `${PREFIXO_PASSO}${passo[1]}`, limpa(passo[2]), i + 1, "passo")
    }
  }
  return [...porId.values()]
}

/** Registra o PRIMEIRO anúncio de cada id (e não o eco). */
function acrescenta(mapa, id, descricao, linha, forma) {
  if (mapa.has(id)) return
  mapa.set(id, { id, descricao, linha, forma })
}

/** A descrição de um anúncio: uma linha, sem separador à esquerda nem aspas soltas. */
function limpa(texto) {
  return texto
    .replace(/^[\s:\u2014\u2013().-]+/, "")
    .replace(/["'`\\]+$/, "")
    .trim()
}

// ── CLI ───────────────────────────────────────────────────────────────────

const isMain = !!process.argv[1] && process.argv[1].split(/[\\/]/).pop() === "metades.mjs"

if (isMain) {
  const args = process.argv.slice(2)
  const soAnunciadas = args.includes("--anunciadas")
  const json = args.includes("--json")
  // `--descricao`: a linha que o MASTER publica por sub-test (a descrição de
  // cada metade vem do bloco da própria suíte — o master não tem prosa).
  const soDescricao = args.includes("--descricao")
  const posicionais = args.filter((a) => !a.startsWith("--"))
  const arquivo = posicionais[0]

  if (arquivo === undefined) {
    console.error("metades.mjs: ❌ falta o script da suíte (ou `--anunciadas <arquivo|->`)")
    process.exit(2)
  }
  const usaStdin = arquivo === "-"
  if (!usaStdin && !existsSync(arquivo) && !soAnunciadas) {
    console.error(`metades.mjs: ❌ arquivo ausente: ${arquivo}`)
    process.exit(2)
  }
  const texto = usaStdin ? readFileSync(0, "utf8") : readFileSync(arquivo, "utf8")
  const anunciadas = metadesAnunciadas(texto)

  if (soAnunciadas) {
    if (json) console.log(JSON.stringify({ anunciadas }, null, 2))
    else for (const a of anunciadas) console.log(`${a.id}|${a.descricao}`)
    process.exit(0)
  }

  const declaradas = metadesDeclaradas(texto)
  if (!declaradas.ok) {
    if (json)
      console.log(JSON.stringify({ ok: false, arquivo, motivo: declaradas.motivo }, null, 2))
    else if (soDescricao) console.log("SEM METADES DECLARADAS")
    else console.error(`metades.mjs: ❌ ${arquivo}: ${declaradas.motivo}`)
    process.exit(1)
  }
  if (soDescricao) {
    const itens = declaradas.metades.map((m) => `${m.id} (${m.descricao})`).join(" · ")
    const linha = `${declaradas.metades.length} metade(s): ${itens}`
    console.log(linha.length > 240 ? `${linha.slice(0, 237)}...` : linha)
    process.exit(0)
  }
  const declarados = new Set(declaradas.metades.map((m) => m.id))
  const anunciados = new Set(anunciadas.map((a) => a.id))
  const semAnuncio = declaradas.metades.filter((m) => !anunciados.has(m.id)).map((m) => m.id)
  if (json) {
    console.log(
      JSON.stringify(
        { ok: true, arquivo, metades: declaradas.metades, anunciadas, semAnuncio },
        null,
        2,
      ),
    )
    process.exit(0)
  }
  console.log(`${arquivo}: ${declaradas.metades.length} metade(s) declarada(s)`)
  for (const m of declaradas.metades) console.log(`  ${m.id.padEnd(8)} ${m.descricao}`)
  if (semAnuncio.length > 0)
    console.log(
      `  (a confirmação por execução é do master: ${declarados.size - semAnuncio.length}/${declarados.size} já anunciadas no texto)`,
    )
  process.exit(0)
}
