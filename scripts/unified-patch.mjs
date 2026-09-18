#!/usr/bin/env node

// =============================================================================
// unified-patch.mjs
//
// O DIFF UNIFICADO de uma lista de reescritas, com CONTEXTO — a construção que
// os dois fixers mecânicos do repositório compartilham (o `--fix` do
// `check-workflow-run-syntax` e o do `check-pipefail-sigpipe`), e que o
// `pr-remedy-comment.mjs` publica no PR.
//
// POR QUE CONTEXTO (medido, não suposto)
//
// Um hunk SEM contexto é recusado pelo `git apply` — ele exige contexto, e a
// única exceção é o hunk que COMEÇA no fim do arquivo (medido nesta máquina com
// git 2.43: `@@ -1,1 +1,1 @@` e `@@ -3,1 +3,1 @@` falham com "patch does not
// apply"; o mesmo patch na ÚLTIMA linha aplica; e `--unidiff-zero` aplica
// qualquer um, mas é uma flag que quem cola o bloco no terminal não vai
// lembrar). Um patch que só aplica quando o defeito cai na última linha do
// arquivo é um remendo que falha em SILÊNCIO em todo o resto — exatamente o
// modo de falha que o comentário do PR existe para não ter.
//
// AS TRÊS REGRAS DA CONSTRUÇÃO
//
//   1. UM cabeçalho de arquivo (`--- a/`/`+++ b/`) por ARQUIVO, com TODOS os
//      hunks dele abaixo — repetir o cabeçalho a cada reescrita parece
//      funcionar e não funciona (o `git apply` lê a sequência como arquivos
//      distintos e recusa);
//   2. o DESLOCAMENTO acumulado: a coluna `-` conta na numeração do arquivo de
//      origem e a `+` na do arquivo novo, então a segunda reescrita de um
//      arquivo que comprimiu uma linha aponta para `linha + delta`;
//   3. janelas de reescrita que se TOCAM viram UM hunk — dois hunks adjacentes
//      dividiriam as mesmas linhas de contexto, e o `git apply` recusaria o
//      segundo.
//
// Nada aqui lê o disco nem decide o que é remendo: entra a lista de reescritas
// (linha de origem + linhas antigas + linha nova) e as linhas do arquivo; sai o
// diff. Quem decide é o fixer — esta é a grafia do diff, uma só.
//
// Usage:
//   import { unifiedPatch, linhasDe } from "./unified-patch.mjs"
//
//   const patch = unifiedPatch(linhasDe(content), fixadas, { file: "a/b.sh" })
//
// Exit codes: N/A (módulo — sem CLI).
// =============================================================================

/** As linhas de um arquivo, SEM o elemento vazio que o `\n` final produz. */
export function linhasDe(content) {
  const linhas = String(content).split("\n")
  if (linhas.length > 0 && linhas[linhas.length - 1] === "") linhas.pop()
  return linhas
}

/**
 * O diff unificado dos remendos de UM arquivo, com contexto.
 *
 * @param {string[]} linhasArquivo  as linhas do arquivo (de `linhasDe`)
 * @param {{line: number, linhasAntes: string[], linhaDepois: string}[]} fixadas
 *        `line` é 1-based e aponta a PRIMEIRA linha antiga da reescrita
 * @param {{file: string, contexto?: number}} opts
 * @returns {string} o diff (uma string vazia se não há o que remendar)
 */
export function unifiedPatch(linhasArquivo, fixadas, { file, contexto = 3 } = {}) {
  const fixes = [...(fixadas ?? [])].sort((a, b) => a.line - b.line)
  if (fixes.length === 0) return ""

  // ── 1. As JANELAS: o trecho do arquivo que cada hunk mostra ──────────────
  // Elas se FUNDEM quando se tocam (`j.ini <= ultima.fim`): dois hunks que
  // dividissem as mesmas linhas de contexto seriam dois hunks inválidos.
  const janelas = []
  for (const f of fixes) {
    const ini = f.line - 1
    const fim = ini + f.linhasAntes.length
    const j = {
      ini: Math.max(0, ini - contexto),
      fim: Math.min(linhasArquivo.length, fim + contexto),
    }
    const ultima = janelas[janelas.length - 1]
    if (ultima && j.ini <= ultima.fim) ultima.fim = Math.max(ultima.fim, j.fim)
    else janelas.push(j)
  }

  // ── 2. Os HUNKS, com a contagem e o deslocamento de cada um ──────────────
  const saida = [`--- a/${file}`, `+++ b/${file}`]
  let delta = 0
  for (const j of janelas) {
    const corpo = []
    let antes = 0
    let depois = 0
    let i = j.ini
    while (i < j.fim) {
      const f = fixes.find((x) => x.line - 1 === i)
      if (f) {
        for (const l of f.linhasAntes) {
          corpo.push(`-${l}`)
          antes++
        }
        corpo.push(`+${f.linhaDepois}`)
        depois++
        i += f.linhasAntes.length
        continue
      }
      corpo.push(` ${linhasArquivo[i] ?? ""}`)
      antes++
      depois++
      i++
    }
    // O deslocamento é da coluna NOVA (`+`): a `-` numera o arquivo de ORIGEM,
    // e ali nada foi aplicado ainda. Trocar os lados passa despercebido no
    // primeiro hunk (delta 0) e mente em todos os seguintes — o `git apply`
    // busca o texto por linha, então o patch errado ou falha ou aplica no lugar
    // errado.
    saida.push(`@@ -${j.ini + 1},${antes} +${j.ini + 1 + delta},${depois} @@`)
    saida.push(...corpo)
    delta += depois - antes
  }
  return saida.join("\n") + "\n"
}

/**
 * O diff unificado de TODOS os remendos, agrupados por arquivo.
 *
 * `ler` devolve as LINHAS de cada arquivo (o fixer já leu o conteúdo para
 * decidir; esta é a segunda leitura, e ela é fail-closed: um arquivo que não
 * abre depois de ter sido julgado sai como `ilegiveis`, nunca como patch vazio
 * silencioso).
 *
 * @param {{file: string, line: number, linhasAntes: string[], linhaDepois: string}[]} fixed
 * @param {{ler: (file: string) => string[]}} opts
 * @returns {{patch: string, ilegiveis: {file: string, motivo: string}[]}}
 */
export function patchPorArquivo(fixed, { ler }) {
  const porArquivo = new Map()
  for (const f of fixed) {
    if (!porArquivo.has(f.file)) porArquivo.set(f.file, [])
    porArquivo.get(f.file).push(f)
  }
  const partes = []
  const ilegiveis = []
  for (const file of [...porArquivo.keys()].sort()) {
    let linhas
    try {
      linhas = ler(file)
    } catch (e) {
      ilegiveis.push({ file, motivo: e?.message ?? String(e) })
      continue
    }
    partes.push(unifiedPatch(linhas, porArquivo.get(file), { file }))
  }
  return { patch: partes.join(""), ilegiveis }
}
