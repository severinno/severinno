#!/usr/bin/env node

// =============================================================================
// forge-workflows.mjs
//
// FONTE UNICA dos diretorios de workflow/actions das forjas do projeto.
//
// POR QUE: os guards do repositorio cravavam `.github/workflows` no escopo. No
// momento em que a forja self-hosted (Gitea/Forgejo) passou a ser DONA DO MERGE,
// esse escopo virou ponto cego: a pipeline que decide o merge ficou FORA da
// cobertura dos invariantes (versao unica do Bun, proibicao do
// oven-sh/setup-bun, hooks de seed, referencias workflow->script, sentinels...).
//
// Nao e hipotetico — foi assim que viveram na forja, sem nenhum guard reclamar:
//   - `BUN_VERSION: "1.4.0"` literal em 2 workflows (o repo proibe literais);
//   - `oven-sh/setup-bun@v2` em 3 call sites (o repo migrou para o composite
//     local justamente para eliminar esse action);
//   - `check:ts-nocheck` ausente da pipeline dona do merge.
//
// REGRA: um guard NUNCA escreve `.github/workflows` (como DIRETORIO) nem
// `.gitea/workflows`. Importe daqui. Quem fiscaliza essa regra e o
// `scripts/check-forge-workflow-scope.mjs`.
//
// A SEGUNDA FONTE UNICA: a leitura de `defaults: run: shell:`.
//
// Todo guard que extrai um `run:` de YAML de workflow precisa saber que a
// declaracao `defaults:` NAO e um passo. Sem isso, um workflow que declara o
// shell (`defaults: {run: {shell: bash}}`, ou a forma que o YAML aceita
// `defaults:\n  run: bash`) produz um passo FANTASMA — e o pior caso nao e o
// ruido: e o gate FALSO. `defaults:\n  run: node scripts/check-x.mjs` faz
// `runCommands`/`discoverGates`/`firstRunLine` relatarem um gate que a pipeline
// nao executa, e o guard de paridade satisfaz a invariante com uma declaracao
// de shell.
//
//   defaultsBlocks(content)   → as declaracoes de shell (escopo e valor)
//   defaultsRunLines(content) → as LINHAS da declaracao (`defaults.run`), que
//                               nenhum guard pode tratar como passo
//
// Usage:
//   import { existingWorkflowDirs, allWorkflowFiles } from "./forge-workflows.mjs"
//   for (const dir of existingWorkflowDirs(process.cwd())) { ... }
//
// Exit codes:
//   (modulo puro — nao possui CLI nem exit code proprio)
// =============================================================================

import { existsSync, readFileSync, readdirSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"

/** Workflows do GitHub (espelho / origem historica). */
export const GITHUB_WORKFLOW_DIR = ".github/workflows"

/**
 * Workflows da forja self-hosted (Gitea/Forgejo) — a DONA DO MERGE.
 * O Gitea e o Forgejo compartilham o diretorio `.gitea/workflows`.
 */
export const GITEA_WORKFLOW_DIR = ".gitea/workflows"

/**
 * Diretorios de workflow das forjas, na ORDEM canonica (dona do merge primeiro).
 * Este array e a unica declaracao de "quais forjas existem" no repositorio.
 */
export const FORGE_WORKFLOW_DIRS = [GITHUB_WORKFLOW_DIR, GITEA_WORKFLOW_DIR]

/**
 * Diretorios de composite actions locais, VARRIDOS pelos guards para que uma
 * action local em qualquer forja deixe de ser invisivel. Hoje so
 * `.github/actions` e referenciado.
 *
 * NAO use esta lista para "consertar" resolucao de action local. O act_runner
 * resolve `uses: ./<path>` como `filepath.Join(Config.Workdir, <path>)`
 * (gitea/act, pkg/runner/step_action_local.go) — o NOME do diretorio nao entra
 * na conta. Ou seja: `.gitea/actions/setup-bun` NAO resolve onde
 * `.github/actions/setup-bun` falha; com o mesmo Workdir, ambos resolvem ou
 * nenhum resolve. A lista existe para COBERTURA dos guards, nao como plano B de
 * resolucao. Remedios reais em deploy/GITEA.md, secao "Smoke test da forja".
 */
export const FORGE_ACTIONS_DIRS = [".github/actions", ".gitea/actions"]

/** Arquivo de workflow: `.yml`/`.yaml` (mesmo contrato dos guards atuais). */
export const WORKFLOW_FILE_RE = /\.ya?ml$/

/**
 * Diretorios de workflow que EXISTEM no checkout, na ordem canonica. Um repo
 * sem `.gitea/` simplesmente nao devolve essa entrada — ausencia de forja nao
 * e violacao.
 *
 * @param {string} root  raiz do repositorio
 * @returns {string[]} ex.: [".github/workflows", ".gitea/workflows"]
 */
export function existingWorkflowDirs(root) {
  return FORGE_WORKFLOW_DIRS.filter((dir) => existsSync(join(root, dir)))
}

/**
 * Nomes de workflow (apenas o basename, ordenados) de UM diretorio de forja.
 * O basename e o que o allowlist dos guards usa (ex.:
 * ALLOWED_SEED_TEST_WORKFLOWS lista `seed-guards.yml`).
 *
 * @param {string} root
 * @param {string} dir
 * @returns {string[]}
 */
export function workflowFileNames(root, dir) {
  const abs = join(root, dir)
  if (!existsSync(abs)) return []
  return readdirSync(abs)
    .filter((f) => WORKFLOW_FILE_RE.test(f))
    .sort()
}

/**
 * Todos os workflows de todas as forjas, com o caminho RELATIVO a raiz (que e
 * o que a mensagem de violacao deve mostrar, para o leitor saber em qual
 * pipeline o problema esta).
 *
 * @param {string} root
 * @returns {{ dir: string, name: string, path: string }[]}
 */
export function allWorkflowFiles(root) {
  const out = []
  for (const dir of existingWorkflowDirs(root)) {
    for (const name of workflowFileNames(root, dir)) {
      out.push({ dir, name, path: `${dir}/${name}` })
    }
  }
  return out
}

/**
 * O caminho relativo e um workflow de alguma forja? Usado pelo guard de escopo
 * e por quem precisa decidir se um arquivo entra na varredura.
 *
 * @param {string} relPath  caminho relativo a raiz
 * @returns {boolean}
 */
export function isForgeWorkflowPath(relPath) {
  if (!WORKFLOW_FILE_RE.test(relPath)) return false
  return FORGE_WORKFLOW_DIRS.some((dir) => relPath.startsWith(`${dir}/`))
}

/**
 * Um caminho e um DIRETORIO de forja (nao um arquivo dentro dele)? Usado pelo
 * guard de escopo para distinguir `".github/workflows"` (proibido cravar) de
 * `".github/workflows/pr-check.yml"` (referencia a um arquivo especifico, que e
 * legitima quando o guard fala de UM workflow).
 *
 * @param {string} relPath
 * @returns {boolean}
 */
export function isForgeWorkflowDir(relPath) {
  return FORGE_WORKFLOW_DIRS.includes(relPath)
}

// ── Layout de YAML: as primitivas de linha (indentacao MEDIDA, nao presumida)

/**
 * O LAYOUT de `jobs:` de um workflow: onde comeca e qual a indentacao das
 * chaves de job.
 *
 * A indentacao e MEDIDA, nao presumida `2`: um workflow escrito com outro
 * recuo faria o guard classificar passos no job errado — e a classificacao e o
 * que decide se um `| grep -q` e a classe SIGPIPE.
 *
 * @param {string[]} lines
 * @returns {{jobsIdx: number, jobIndent: number | null}}
 */
export function jobsLayout(lines) {
  const jobsIdx = lines.findIndex((l) => /^jobs:\s*$/.test(l))
  if (jobsIdx === -1) return { jobsIdx: -1, jobIndent: null }
  for (let k = jobsIdx + 1; k < lines.length; k++) {
    const l = lines[k]
    if (l.trim() === "" || l.trim().startsWith("#")) continue
    if (!/^\s/.test(l)) return { jobsIdx, jobIndent: null }
    return { jobsIdx, jobIndent: l.match(/^[ \t]*/)[0].length }
  }
  return { jobsIdx, jobIndent: null }
}

/** O nome do job que uma linha de CHAVE de job (`  guardas:`) declara. */
export function jobKeyName(line, jobIndent) {
  const m = new RegExp(`^\\s{${jobIndent}}([^\\s:#][^:]*):\\s*(?:#.*)?$`).exec(line)
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : null
}

/**
 * A CHAVE filha direta de um bloco YAML (o primeiro nivel abaixo do cabecalho).
 *
 * @param {string[]} lines
 * @param {number} headIdx
 * @param {number} headIndent
 * @param {string} key
 * @returns {number | null}
 */
export function yamlChildKey(lines, headIdx, headIndent, key) {
  let childIndent = null
  for (let k = headIdx + 1; k < lines.length; k++) {
    const l = lines[k]
    if (l.trim() === "" || l.trim().startsWith("#")) continue
    const ind = l.match(/^[ \t]*/)[0].length
    if (ind <= headIndent) return null
    const m = /^\s*([A-Za-z_][A-Za-z0-9_.-]*):/.exec(l)
    if (!m) continue
    if (childIndent === null) childIndent = ind
    if (ind !== childIndent) continue
    if (m[1] === key) return k
  }
  return null
}

// ── `defaults: run: shell:` — o que e declaracao nao pode ser lido como passo

/** A indentacao da linha (a coluna, nao a largura do recuo do arquivo). */
const indentOf = (line) => /^[ \t]*/.exec(line)[0].length

/**
 * As DECLARACOES de `defaults:` de um workflow — o shell default no nivel do
 * ARQUIVO e no nivel de cada JOB.
 *
 * Tres formas chegam aqui, e as tres sao DECLARACAO (nunca passo):
 *
 *   1. em bloco (`defaults:\n  run:\n    shell: bash`) — o `shell:` e lido;
 *   2. em linha (`defaults: {run: {shell: bash}}`) — o guard NAO a le, e diz
 *      `unparsed`: nao ler NAO e o mesmo que nao haver, e presumir "sem shell
 *      declarado" ali seria a aposta que este modulo existe para acabar;
 *   3. valor escalar no `run:` (`defaults:\n  run: bash`) — NAO e YAML valido
 *      como `defaults.run` (que e um mapa de `shell`/`working-directory`), mas
 *      e a forma que os scaners de `run:` por regex leem como COMANDO: e a
 *      origem do passo fantasma, e por isso tambem sai `unparsed`.
 *
 * @param {string} content
 * @returns {{scope: "workflow"|"job", job: string | null, shell: string,
 *   line: number, runLine: number | null, inline: boolean, unparsed?: true}[]}
 */
export function defaultsBlocks(content) {
  const lines = String(content ?? "").split(/\r?\n/)
  const { jobsIdx, jobIndent } = jobsLayout(lines)
  const out = []
  let jobAtual = null
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (l.trim() === "" || l.trim().startsWith("#")) continue
    const indent = indentOf(l)
    const escopo = indent === 0 ? "workflow" : "job"
    const dono = indent === 0 ? null : jobAtual
    if (jobsIdx !== -1 && jobIndent !== null && i > jobsIdx && indent === jobIndent) {
      jobAtual = jobKeyName(l, jobIndent) ?? jobAtual
      continue
    }
    const inline = /^(\s*)defaults:\s*(\S.*)$/.exec(l)
    if (inline) {
      out.push({
        scope: escopo,
        job: dono,
        shell: inline[2].trim(),
        line: i + 1,
        runLine: i + 1,
        inline: true,
        unparsed: true,
      })
      continue
    }
    const header = /^(\s*)defaults:\s*$/.exec(l)
    if (!header) continue
    const dup = header[1].length
    const runIdx = yamlChildKey(lines, i, dup, "run")
    if (runIdx === null) continue
    const runIndent = indentOf(lines[runIdx])
    const restoRun = lines[runIdx]
      .replace(/^\s*run:\s*/, "")
      .replace(/\s+#.*$/, "")
      .trim()
    if (restoRun !== "" && !/^[|>]/.test(restoRun)) {
      out.push({
        scope: escopo,
        job: dono,
        shell: restoRun,
        line: runIdx + 1,
        runLine: runIdx + 1,
        inline: false,
        unparsed: true,
      })
      continue
    }
    const shellIdx = yamlChildKey(lines, runIdx, runIndent, "shell")
    if (shellIdx === null) continue
    const shell = lines[shellIdx]
      .replace(/^\s*shell:\s*/, "")
      .replace(/\s+#.*$/, "")
      .trim()
      .replace(/^['"]|['"]$/g, "")
    out.push({
      scope: escopo,
      job: dono,
      shell,
      line: shellIdx + 1,
      runLine: runIdx + 1,
      inline: false,
    })
  }
  return out
}

/**
 * As LINHAS (1-based) da declaracao `defaults.run` — a chave `run:`, o valor
 * escalar dela, e os filhos diretos (`shell:`, `working-directory:`).
 *
 * E o que TODO guard que extrai `run:` de YAML consulta antes de ler a linha
 * como passo. Um workflow que declara o shell deixa de produzir:
 *
 *   - passo FANTASMA (o `run: bash` de `defaults:` virando comando);
 *   - gate FALSO (`defaults: run: node scripts/check-x.mjs` satisfazendo uma
 *     invariante que a pipeline nao executa);
 *   - ref FALSA para `check-workflow-refs` (o nome de um script que nunca roda).
 *
 * O escopo terminado no PRIMEIRO nivel abaixo do `run:` e de proposito: as
 * duas unicas chaves validas de `defaults.run` sao `shell` e
 * `working-directory`, entao nada executavel vive mais fundo que isso.
 *
 * @param {string} content
 * @returns {Set<number>} linhas 1-based da declaracao
 */
export function defaultsRunLines(content) {
  const lines = String(content ?? "").split(/\r?\n/)
  const out = new Set()
  for (const bloco of defaultsBlocks(content)) {
    if (bloco.runLine === null) continue
    if (bloco.inline) {
      out.add(bloco.runLine)
      continue
    }
    out.add(bloco.runLine)
    const runIndent = indentOf(lines[bloco.runLine - 1])
    for (let k = bloco.runLine; k < lines.length; k++) {
      const l = lines[k]
      if (l.trim() === "" || l.trim().startsWith("#")) continue
      if (indentOf(l) <= runIndent) break
      out.add(k + 1)
    }
  }
  return out
}

// ── A REGUA DE LINHA: o que EXECUTA (comentario fora, expressao mascarada)

/**
 * A expressao DINAMICA do runner (`${{ ... }}`) — resolvida pelo runner ANTES
 * de o shell existir. Ela nao e codigo do repositorio: um literal lido de
 * dentro dela (`${{ vars.CMD }}` apontando para um script) nao esta na pipeline,
 * e o nome de um alvo pode ate vir dela (`${{ matrix.script }}`), que o guard
 * nao tem como resolver estaticamente.
 */
export const DYNAMIC_EXPR_RE = /\$\{\{[^}]*\}\}/g

/**
 * Remove o comentario de YAML de uma linha: a linha INTEIRA (so comentario) e o
 * de FIM DE LINHA (`chave: v # ...`). O `#` so inicia comentario precedido de
 * espaco (ou no inicio da linha) — e por isso que `echo "a#b"` sobrevive: o `#`
 * de dentro das aspas nao tem espaco antes.
 *
 * As duas formas sao a MESMA pergunta ("esta linha executa algo?") e por isso
 * moram numa funcao so: quando cada guard tinha a sua, a correcao do comentario
 * de fim de linha teve de ser aplicada DUAS VEZES, e o `check-workflow-refs`
 * ficou validando referencia de comentario enquanto o `check-forge-parity` ja a
 * ignorava.
 *
 * @param {string} line
 * @returns {string} a linha sem o comentario de fim de linha
 */
export function stripTrailingComment(line) {
  // O `trimEnd` e parte da regra: cortar ` # prosa` deixa um espaco pendurado,
  // e as DUAS implementacoes que existiam (o `executableLines` daqui/parity e o
  // `stripInlineComment` do `check-registry-source`) ja o aplicavam — unificar
  // sem ele mudaria a linha devolvida a quem so quer o codigo.
  return String(line ?? "")
    .replace(/(^|\s)#.*$/, "$1")
    .trimEnd()
}

/**
 * A linha e um comentario de `#` (YAML, shell, Python, Makefile, Dockerfile)?
 *
 * E o comentario das LINGUAGENS DE DADO/E SCRIPT que este repositorio varre nos
 * guards de workflow. Quem le JS/TS pede `isCommentLine(line, {slash:true})`.
 *
 * @param {string} line
 * @returns {boolean}
 */
export function isHashComment(line) {
  return String(line ?? "")
    .trim()
    .startsWith("#")
}

/**
 * A linha e um comentario de `//`, `/*` ou `*` (JS/TS/C, e o `*` de um bloco de
 * doc)?
 *
 * @param {string} line
 * @returns {boolean}
 */
export function isSlashComment(line) {
  const t = String(line ?? "").trim()
  return t.startsWith("//") || t.startsWith("/*") || t.startsWith("*")
}

/**
 * A REGUA DE COMENTARIO — uma so, com a SINTAXE declarada no call site.
 *
 * `slash` e o que separa os guards, e a escolha agora e ESCRITA em cada um: um
 * guard que varre YAML/shell/Python (dado e script) nao pode tratar `*anchor`
 * (alias de YAML) como comentario, e um que varre JS/TS precisa tratar `//`.
 *
 * POR QUE EXISTE: havia QUATRO definicoes desta mesma funcao no repositorio —
 * `check-crlf-scope` (`#`/`//`/`*`), `check-forge-workflow-scope` (`//`/`/*`/
 * `*`/`#`), `check-registry-source` (so `#`) e `check-utf8-scope` (`#`/`//`/
 * `*`) — e um QUINTO lugar com a regra do comentario de FIM DE LINHA
 * (`check-registry-source.stripInlineComment`, o mesmo regex). A pergunta era
 * uma; as respostas, tres. Aqui a resposta e uma e o que varia fica visivel.
 *
 * @param {string} line
 * @param {{slash?: boolean}} [opts]  `slash:true` = tambem `//`, `/*` e `*`
 * @returns {boolean}
 */
export function isCommentLine(line, { slash = false } = {}) {
  return isHashComment(line) || (slash && isSlashComment(line))
}

/**
 * A linha como o runner a executaria: sem comentario (de linha ou de fim de
 * linha) e sem expressao dinamica. Devolve `""` quando nao sobra nada.
 *
 * A COLUNA e preservada (o recuo faz parte do dado: `run:` e encontrado por
 * posicao em quem le passo a passo), e a linha sai com `trimEnd`, nunca
 * `trim` — quem julga coluna nao pode receber uma linha remendada.
 *
 * @param {string} line
 * @returns {string}
 */
export function executableLine(line) {
  return codeLine(line).replace(DYNAMIC_EXPR_RE, "").trimEnd()
}

/**
 * O que nesta linha e CODIGO: comentario de linha e de FIM DE LINHA fora, e a
 * EXPRESSAO do runner PRESERVADA.
 *
 * POR QUE UMA SEGUNDA PORTA (e nao so o `executableLine`): o mascaramento de
 * `${{ }}` responde "esta linha EXECUTA algo?", e ha consumidor que precisa da
 * EXPRESSAO INTEIRA como VALOR — o `checkSetupBunRunLine` compara o argumento
 * com `${{ vars.BUN_VERSION }}` para reconhecer a forma canonica e passaria a
 * ver um token qualquer. A pergunta "o que e comentario?" continua sendo UMA
 * (`isHashComment` + `stripTrailingComment`); o mascaramento e um passo a mais,
 * so de quem pergunta por execucao.
 *
 * A COLUNA vem preservada (so `stripTrailingComment` aplica `trimEnd`): quem
 * julga recuo recebe a linha como ela esta.
 *
 * @param {string} line
 * @returns {string} o codigo da linha (`""` quando nao sobra nada)
 */
export function codeLine(line) {
  const raw = String(line ?? "")
  if (isHashComment(raw)) return ""
  return stripTrailingComment(raw)
}

/**
 * As linhas EXECUTAVEIS de um texto de YAML: comentario fora, expressao
 * dinamica mascarada, vazias fora.
 *
 * `skipLines` (1-based) sao linhas cujo CONTEUDO nao e um passo — hoje as
 * declaracoes de `defaults.run` (`defaultsRunLines`), que sao SHELL DEFAULT:
 * ler `defaults: {run: bash}` como comando fabrica um passo que a pipeline nao
 * executa, e ler `defaults: run: node scripts/check-x.mjs` fabrica um GATE — a
 * invariante seria satisfeita por uma declaracao de shell.
 *
 * @param {string[]} lines
 * @param {Set<number>|null} [skipLines]
 * @returns {string[]}
 */
export function executableLines(lines, skipLines = null) {
  return lines
    .map((line, i) => {
      if (skipLines !== null && skipLines.has(i + 1)) return ""
      return executableLine(line)
    })
    .filter((line) => line.trim() !== "")
}

// ── A REGUA DE CORPO: os PASSOS de um workflow e o corpo do `run:`

/**
 * Os PASSOS de um workflow COM `run:` — um item de lista (`- `) por passo, com
 * o corpo do `run:` ja montado (escalar dobrado ou bloco literal/dobrado).
 *
 * POR QUE AQUI: um passo e uma unidade ESTRUTURAL do YAML (item de lista,
 * coluna da chave, recuo do corpo), nao uma linha. Cada guard que precisou
 * dela construiu a sua: o `check-pipefail-sigpipe` (para julgar o shell), o
 * `check-mutation-jobs` (para achar refs de mutation test), o
 * `check-forge-parity` (para os comandos) e o `check-workflow-run-syntax` (para
 * o `bash -n`). Quatro leituras do mesmo YAML divergem no primeiro ajuste — e a
 * que ninguem confere e a que decide o veredito. Medido antes da unificacao:
 * oito workflows tinham gate invocado DENTRO de `run: |` que a regua de comando
 * do `check-forge-parity` nao via, enquanto a regua de rotulo do MESMO arquivo
 * via (o mesmo YAML, dois vereditos).
 *
 * O QUE ELA MEDE (e nao presume):
 *   - o item comeca em `- ` e vai ate o proximo `- ` no mesmo nivel (ou mais
 *     raso) — o recuo e COMPARADO, nunca presumido `2`;
 *   - a chave na MESMA linha do item (`- run: cmd`, forma comum no repositorio)
 *     e reconhecida: sem isso o passo fica INVISIVEL;
 *   - bloco (`|`, `>`, com indicador de chomping) × escalar: no bloco o corpo e
 *     o trecho mais indentado que a chave, e as linhas vazias sao PARAGRAFO (o
 *     YAML mantem a quebra); no escalar o YAML DOBRA a continuacao no mesmo
 *     escalar (a quebra vira espaco) e o `\` final some na dobra — ler so a
 *     primeira linha julgaria o passo por METADE;
 *   - `shell:` do passo, ANTES ou DEPOIS do `run:` (a ordem das chaves e livre);
 *   - `bodyEndLine`/`line` — a ULTIMA linha do corpo e a primeira, em numero
 *     1-based, para quem precisa ESCREVER de volta na linha certa.
 *
 * O QUE ELA NAO FALA: se o shell liga o pipefail (isso e o
 * `check-pipefail-sigpipe`) e o que e declaracao de `defaults:` (isso e
 * `defaultsRunLines`).
 *
 * @param {string} content
 * @returns {{line: number, runLine: number, bodyEndLine: number, body: string,
 *   job: string | null, shell: string | null}[]}
 */
export function workflowRunBodies(content) {
  const lines = String(content ?? "").split(/\r?\n/)
  const steps = []
  const { jobsIdx, jobIndent } = jobsLayout(lines)
  let jobAtual = null
  for (let i = 0; i < lines.length; i++) {
    if (jobsIdx !== -1 && jobIndent !== null && i > jobsIdx && indentOf(lines[i]) === jobIndent) {
      const nome = jobKeyName(lines[i], jobIndent)
      if (nome !== null) jobAtual = nome
    }
    const item = lines[i].match(/^(\s*)-\s/)
    if (!item) continue
    const itemIndent = item[1].length
    const keyIndentMin = itemIndent + 2
    // O item vai ate o proximo `- ` no MESMO nivel (ou uma linha menos profunda).
    let end = lines.length
    for (let k = i + 1; k < lines.length; k++) {
      const l = lines[k]
      if (l.trim() === "") continue
      const indent = indentOf(l)
      if (indent < keyIndentMin && !/^\s*-\s/.test(l)) {
        end = k
        break
      }
      if (/^\s*-\s/.test(l) && indent <= itemIndent) {
        end = k
        break
      }
    }
    const bloco = lines.slice(i, end)
    let shell = null
    let runIdx = -1
    let runInline = null
    for (let k = 0; k < bloco.length; k++) {
      // O item pode trazer a CHAVE na propria linha (`- run: ...`).
      const chave = bloco[k].replace(/^(\s*)-\s+/, "$1")
      const s = chave.match(/^\s*shell:\s*(.+)$/)
      if (s) shell = s[1].trim().replace(/^['"]|['"]$/g, "")
      const r = chave.match(/^\s*run:\s*(.*)$/)
      if (r) {
        runIdx = k
        runInline = r[1].trim()
        break
      }
    }
    if (runIdx === -1) continue
    let body
    let bodyEnd = runIdx + 1
    const bodyLine = i + runIdx + 1
    // A COLUNA da chave, nao a do item: em `- run: |` o corpo e indentado em
    // relacao ao `run:`, dois espacos depois do `- `.
    const runIndent = indentOf(bloco[runIdx]) + (/^\s*-\s+/.test(bloco[runIdx]) ? 2 : 0)
    if (/^[|>][-+]?\d*$/.test(runInline)) {
      const corpo = []
      let k = runIdx + 1
      for (; k < bloco.length; k++) {
        const l = bloco[k]
        if (l.trim() === "") {
          corpo.push("")
          continue
        }
        if (indentOf(l) <= runIndent) break
        corpo.push(l.replace(new RegExp(`^\\s{0,${runIndent + 2}}`), ""))
      }
      bodyEnd = k
      body = corpo.join("\n")
    } else {
      const partes = [runInline]
      let k = runIdx + 1
      for (; k < bloco.length; k++) {
        const l = bloco[k]
        // Linha em BRANCO dentro do escalar e um PARAGRAFO: o YAML mantem a
        // quebra ali (nao dobra), entao ela nao vira espaco.
        if (l.trim() === "") {
          partes.push("\n")
          continue
        }
        if (indentOf(l) <= runIndent) break
        partes.push(l.trim())
      }
      bodyEnd = k
      body = partes
        .map((p) => p.replace(/\\\s*$/, "").trimEnd())
        .join(" ")
        .replace(/ *\n */g, "\n")
        .trim()
    }
    // `shell:` pode vir DEPOIS do `run:`. Olhar so ate o `run:` faria o gate
    // ler o shell do RUNNER onde o workflow declara o contrario.
    for (let k = bodyEnd; k < bloco.length; k++) {
      const s = bloco[k].replace(/^(\s*)-\s+/, "$1").match(/^\s*shell:\s*(.+)$/)
      if (s) {
        shell = s[1].trim().replace(/^['"]|['"]$/g, "")
        break
      }
    }
    steps.push({
      line: bodyLine,
      runLine: i + runIdx + 1,
      bodyEndLine: i + bodyEnd,
      body,
      job: jobAtual,
      shell,
    })
    i = end - 1
  }
  return steps
}

// ── A LEITURA DA VARREDURA: lido, ou NOMEADO (nunca "nada a julgar")

/**
 * Exit code de CLI quando o escopo NAO PODE SER JULGADO (codigo da casa para
 * infra: 1 e violacao, 3 e uso incorreto).
 */
export const EXIT_UNJUDGEABLE = 2

/**
 * O parser de YAML do repositorio — o MESMO `js-yaml` que os testes ja usam.
 * Carregado sob demanda porque a validade so e' perguntada a workflow (o
 * modulo tambem serve a quem le hook, script e action, que nao sao YAML).
 */
const require = createRequire(import.meta.url)

/** @type {object | null | undefined} */
let yamlParserCache

/**
 * O `js-yaml` disponivel, ou `null` — NUNCA uma excecao que derrube o guard:
 * a ausencia do parser e' um estado NOMEADO (ver `workflowYamlValidity`).
 *
 * @returns {object | null}
 */
function yamlParser() {
  if (yamlParserCache !== undefined) return yamlParserCache
  try {
    yamlParserCache = require("js-yaml")
  } catch {
    yamlParserCache = null
  }
  return yamlParserCache
}

/**
 * O workflow e' YAML VALIDO — e um MAPA de chaves (nao um escalar, uma lista ou
 * um documento vazio)?
 *
 * POR QUE ESTA PERGUNTA EXISTE: os guards deste repositorio leem LINHA (o YAML
 * e a unica fonte, mas o parser nao participa). Um arquivo que nao faz parsing
 * em YAML tem linhas que o runner NUNCA executa — e julgar essas linhas, sem
 * dizer que o arquivo nao e' um workflow, e' a mesma falsa seguranca do arquivo
 * ilegivel: o verde de nao saber. Sem a validacao, os OITO guards que varrem
 * workflow aprovavam um YAML invalido com "0 violacoes" (medido: a suite de
 * cobertura reprova isso em guard por guard).
 *
 * O desfecho e' um OBJETO, nao um booleano: `{ok:true}` ou `{ok:false, motivo}`
 * com o motivo NOMEADO (linha do erro, quando o parser a da'). A indisponibilidade
 * do parser tambem e' `ok:false` — "nao pude provar que o YAML e' valido" NAO e'
 * "o YAML e' valido", e o guard prefere o vermelho explicado ao verde presumido.
 *
 * @param {string} text
 * @returns {{ok: boolean, motivo?: string}}
 */
export function workflowYamlValidity(text) {
  const yaml = yamlParser()
  if (yaml === null) {
    return {
      ok: false,
      motivo:
        "YAML NAO VALIDADO — o parser (`js-yaml`) nao pode ser carregado: este workflow nao " +
        "pode ser julgado (rode `bun install`)",
    }
  }
  let doc
  try {
    doc = yaml.load(String(text ?? ""), { json: true })
  } catch (err) {
    const linha = err?.mark?.line
    const onde = typeof linha === "number" ? ` (linha ${linha + 1})` : ""
    const razao = String(err?.reason ?? err?.message ?? err).split("\n")[0]
    return { ok: false, motivo: `YAML INVALIDO${onde}: ${razao}` }
  }
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
    return {
      ok: false,
      motivo:
        "YAML sem DOCUMENTO de workflow — o topo nao e' um mapa de chaves (`on:`, `jobs:`), " +
        "entao nenhum passo pode ser lido",
    }
  }
  return { ok: true }
}

/**
 * O arquivo EXISTE e nao pode ser julgado (nao abre, ou nao e' UTF-8 valido).
 *
 * E a distincao que sustenta o contrato: "nao consegui ler" NAO e "nao ha o que
 * julgar". Quem devolve `""` para um arquivo ilegivel faz o guard aprovar por
 * ausencia — o veredito verde de nao saber, que e' pior que uma violacao.
 */
export class WorkflowReadError extends Error {
  /**
   * @param {string} rel    caminho relativo a raiz
   * @param {string} motivo o que impediu o julgamento (nomeado)
   * @param {unknown} [cause]
   */
  constructor(rel, motivo, cause) {
    super(`${rel}: ${motivo}`)
    this.name = "WorkflowReadError"
    this.rel = rel
    this.motivo = motivo
    this.cause = cause
  }
}

/**
 * O texto de UM arquivo do escopo (workflow, action, script), fail-closed em I/O
 * e em ENCODING — quem julga não pode receber `""` de um arquivo ilegivel.
 *
 * O `TextDecoder` FATAL e' parte do contrato: `readFileSync(..., "utf8")` NAO
 * falha com byte invalido — ele o troca por U+FFFD. Com isso um workflow com
 * encoding quebrado entrava na varredura como mojibake, e "0 violacoes" era uma
 * afirmacao sobre um texto que ninguem escreveu.
 *
 * @param {string} root
 * @param {string} rel
 * @returns {string}
 * @throws {WorkflowReadError}
 */
export function readJudgedText(root, rel) {
  return readJudgedFile(join(root, rel), rel)
}

/**
 * A mesma leitura fail-closed, para quem ja' tem o caminho ABSOLUTO (ex.: quem
 * varre UM diretorio). `label` e' o nome que aparece no diagnostico.
 *
 * @param {string} abs
 * @param {string} [label]
 * @returns {string}
 * @throws {WorkflowReadError}
 */
export function readJudgedFile(abs, label = abs) {
  let bytes
  try {
    bytes = readFileSync(abs)
  } catch (cause) {
    const codigo = cause?.code ?? cause?.message ?? String(cause)
    throw new WorkflowReadError(label, `não foi possível ler (${codigo})`, cause)
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch (cause) {
    throw new WorkflowReadError(label, "não é UTF-8 válido", cause)
  }
}

/**
 * A VARREDURA dos workflows das forjas: o que foi LIDO e o que NAO PODE ser
 * julgado — este ultimo NOMEADO, nunca sumido do denominador.
 *
 * O escopo continua sendo o que o diretorio DECLARA (`allWorkflowFiles`): por
 * isso um arquivo com nome de workflow que nao abre sai em `unjudgeable` em vez
 * de desaparecer. `vazios` sai NOMEADO tambem (um workflow sem conteudo nunca
 * roda: o guard nao pode dizer "verde" sobre ele, mas tambem nao ha o que
 * julgar — a diferenca entre os dois casos fica escrita na saida).
 *
 * @param {string} root
 * @param {{read?: (root: string, rel: string) => string}} [opts]
 * @returns {{
 *   files: {dir: string, name: string, path: string, text: string}[],
 *   unjudgeable: {path: string, motivo: string}[],
 *   vazios: {path: string, motivo: string}[],
 * }}
 */
export function readWorkflowScan(root, { read = readJudgedText } = {}) {
  const files = []
  const unjudgeable = []
  const vazios = []
  for (const w of allWorkflowFiles(root)) {
    let text
    try {
      text = read(root, w.path)
    } catch (err) {
      unjudgeable.push({ path: w.path, motivo: err?.motivo ?? String(err?.message ?? err) })
      continue
    }
    if (text.trim() === "") {
      vazios.push({ path: w.path, motivo: "arquivo VAZIO — nenhuma linha a julgar" })
      continue
    }
    // O texto LEGÍVEL não basta: um workflow que não faz parsing em YAML não é
    // julgado por ninguém aqui — os guards leem LINHA, e as linhas de um YAML
    // inválido são um texto que o runner nunca chega a executar. Sem esta
    // metade, "0 violações" seria cunhado sobre um arquivo que nenhum gate leu
    // de fato (a mesma classe do arquivo ilegível, por outra porta).
    const yaml = workflowYamlValidity(text)
    if (!yaml.ok) {
      unjudgeable.push({ path: w.path, motivo: yaml.motivo })
      continue
    }
    files.push({ ...w, text })
  }
  return { files, unjudgeable, vazios }
}

/**
 * O bloco NOMEADO do que nao pode ser julgado — UMA redacao para todos os
 * guards (antes so' o `check-workflow-run-syntax` tinha a sua frase; a classe
 * existe em todos os que varrem workflow).
 *
 * @param {{path: string, motivo: string}[]} unjudgeable
 * @param {(linha: string) => void} [log]
 */
export function reportUnjudgeable(unjudgeable, log = console.error) {
  log("❌ workflow(s) NÃO JULGÁVEL(is) — não conseguir julgar NÃO é não haver nada a julgar:")
  log("")
  for (const u of unjudgeable) log(`     ${u.path}: ${u.motivo}`)
  log("")
  log("   Um veredito verde sobre um arquivo que o guard não julgou é pior que uma violação:")
  log("   ele afirma cobertura sobre nada. Corrija a leitura (permissão, encoding, arquivo")
  log("   removido) ou o YAML (um arquivo que não faz parsing não é lido por nenhum gate)")
  log("   — ou tire o arquivo do diretório de workflows.")
}

/**
 * Nomeia os workflows VAZIOS: nao ha o que julgar, mas eles NAO somem do
 * escopo em silencio (a mesma doutrina dos `skipped` do
 * `check-workflow-run-syntax`) — e' a diferenca entre "nada a julgar" e "nao
 * consegui julgar", escrita na saida.
 *
 * @param {{path: string}[]} vazios
 * @param {(linha: string) => void} [log]
 */
export function reportEmptyWorkflows(vazios, log = console.log) {
  if (vazios.length === 0) return
  log("ℹ️  workflow(s) VAZIO(s) — nada a julgar (nomeados para não sumirem do escopo):")
  for (const v of vazios) log(`     ${v.path}`)
}

/**
 * O contrato de CLI: sem poder julgar TODO o escopo declarado, o guard NAO
 * cunha veredito — imprime o bloco NOMEADO e sai `EXIT_UNJUDGEABLE`.
 *
 * @param {{path: string, motivo: string}[]} unjudgeable
 * @param {(linha: string) => void} [log]
 * @returns {boolean} `true` quando havia algo nao julgavel (o chamador ja saiu)
 */
export function exitOnUnjudgeable(unjudgeable, log = console.error) {
  if (unjudgeable.length === 0) return false
  reportUnjudgeable(unjudgeable, log)
  process.exit(EXIT_UNJUDGEABLE)
}
