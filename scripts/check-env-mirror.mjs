#!/usr/bin/env node
// =============================================================================
// check-env-mirror.mjs
//
// Usage:
//   node scripts/check-env-mirror.mjs                       # descobre host e template no checkout
//   node scripts/check-env-mirror.mjs --host deploy/.env.gitea
//   node scripts/check-env-mirror.mjs --host <env do VPS> --template deploy/env.gitea.example
//   node scripts/check-env-mirror.mjs --json
//   node scripts/check-env-mirror.mjs --patch > fix.patch    # o diff que reconcilia o host (stdout = so o patch)
//   node scripts/check-env-mirror.mjs --fix                  # aplica o diff ao host (atomico; nunca toca no segredo)
//
// Exit codes:
//   0 — em SINCRONIA: o env do host espelha o template comitado
//   1 — DIVERGE (ou nao havia o que comparar): subir a stack interpolaria outra
//       coisa que o repositorio declara (imagem, versao, segredo)
//   2 — uso invalido (flag desconhecida, --host/--template sem valor, --patch
//       junto com --fix, --json junto com um deles)
//
// Com --patch/--fix o exit code responde a pergunta do OPERADOR ("depois disto o
// host espelha?"): 0 quando nao sobra nada, 1 quando o que sobra depende de
// decisao humana (o valor real de um segredo, uma variavel a mais no host, o
// template comitado). O veredito dos dois modos e sempre o estado DEPOIS.
//
// STREAMS: o relatorio e o diagnostico sao STDERR; o PATCH (de `--patch` e de
// `--fix`) e STDOUT — `node scripts/check-env-mirror.mjs --patch > fix.patch`
// escreve um arquivo que so contem o diff.
//
// O patch e BYTE-EXATO (aplicavel com `git apply -p0`) enquanto nenhum valor de
// segredo aparecer no diff. Quando o CONTEXTO de uma correcao alcanca a linha de
// um segredo, o valor sai MASCARADO e o patch passa a ser artefato de REVISAO —
// mascarar o contexto e o que preserva o segredo, e custa a aplicabilidade
// literal. Nos dois casos quem aplica e o `--fix`, que escreve direto (sem git).
//
// O QUE --fix CORRIGE, E O QUE ELE RECUSA (o limite e o desenho)
//
// Corrige SO o que e mecanico e do lado do HOST:
//   • variavel COMUM que diverge do template -> passa a valer o valor do template;
//   • variavel declarada no template que nao existe no host -> acrescentada no FIM
//     (de onde o `--env-file` a le; inserir no meio poderia ficar sombreada pela
//     ultima ocorrencia, que e a que vence).
//
// RECUSA, por escrito, tudo o que exige decisao ou um valor que nao esta no
// repositorio:
//   • SEGREDO (RUNNER_TOKEN): nunca e escrito no host, nunca e copiado do template
//     e NUNCA aparece em claro na saida — no patch o valor sai MASCARADO;
//   • variavel a MAIS no host: apagar configuracao do operador nao e reconciliar
//     (declarar no template ou remover do host e decisao de quem opera);
//   • nome que o compose consome e o template NAO declara: o lado a corrigir e o
//     TEMPLATE comitado, nao o host.
//
// O `--fix` so escreve quando consegue PROVAR que o plano fecha a conta: reaplica
// a MESMA regra (`compareEnvMirrorDeclarations`) ao conteudo corrigido e exige que
// a violacao restante seja exatamente a que ele declarou como manual. Uma
// divergencia que o plano nao explique NAO vira escrita silenciosa — o comando
// recusa e nao toca no arquivo. A escrita e ATOMICA (tmp + rename no mesmo
// diretorio) e idempotente: rodar de novo nao muda nada.
//
// POR QUE EXISTE
//
// O guard `check:registry-source` (invariante 7b) ja compara o env do HOST
// (`deploy/.env.gitea`, no VPS) com o template comitado
// (`deploy/env.gitea.example`) — mas ele e um gate de CI: quem sobe a stack com
// `deploy/gitea-up.sh` tinha de LEMBRAR de roda-lo. Este comando e a mesma regra
// num passo que o bring-up executa sozinho, para o pre-requisito ser mecanico.
//
// E a mesma comparacao, nao uma segunda: as funcoes vem do
// `check-registry-source.mjs` (`parseEnvAssignments`, `composeEnvVariables`,
// `compareEnvMirrorDeclarations`), que continua sendo a fonte unica da regra —
// inclusive a ASSIMETRIA dos segredos (numa variavel comum DIVERGIR e o defeito;
// num segredo, IGUALAR e o defeito, porque o template e comitado e o host tem o
// valor real).
//
// POR QUE ANTES DA GARANTIA DA IMAGEM (a ordem importa)
//
// O `ensure-runner-image.mjs` resolve IMAGE_REGISTRY/IMAGE_NAMESPACE/BUN_VERSION
// DESTE arquivo para decidir qual tag garantir. Com um env divergente ele
// garantiria a imagem ERRADA — e a stack subiria apontando para ela. Conferir o
// espelho primeiro faz a subida recusar ANTES de resolver a imagem errada.
//
// POR QUE NAO E UM GATE DE CI PROPRIO
//
// Ele nao prova nada sobre o repositorio em si (isso e o `check:registry-source`)
// nem sobre a imagem (isso e o `ensure-runner-image`): ele responde "ESTE arquivo
// do host e o que o repositorio declara?" — uma pergunta que so existe onde a
// stack roda, e cuja resposta tem de ser dada no momento de subir. Por isso o
// unico chamador e o `deploy/gitea-up.sh`.
//
// O que NAO cobre: o valor RENDERIZADO do compose (variavel que nao vem de
// nenhum arquivo, literal no compose) e o RENDER com docker — esses ficam com o
// `check:registry-source`, que precisa do plugin `compose`. Aqui e comparacao de
// ARQUIVOS: roda em qualquer host, inclusive sem docker.
// =============================================================================

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { isAbsolute, join } from "node:path"
import process from "node:process"
import { pathToFileURL } from "node:url"

import {
  GITEA_ENV_DEPLOYED,
  MIRROR_VARIABLE_RULES,
  discoverEnvMirrors,
} from "./check-actrc-sync.mjs"
import { GITEA_COMPOSE, GITEA_ENV_MIRROR } from "./check-bun-mirror.mjs"
import {
  COMPOSE_VALUE_DEFAULTS,
  classifyEnvVariable,
  compareEnvMirrorDeclarations,
  composeEnvVariables,
  parseEnvAssignments,
} from "./check-registry-source.mjs"

/** A raiz do checkout — o processo roda da raiz do repositorio. */
export const ROOT = process.cwd()

/** Exit codes — o contrato da CLI. */
export const EXIT = { OK: 0, DIVERGED: 1, USAGE: 2 }

/** O script do bring-up que consome este comando (o unico chamador). */
export const BRING_UP = "deploy/gitea-up.sh"

/**
 * O PLANO: cada achado da regra com o destino que ele recebeu.
 *
 * @typedef {{name: string, action: "add"|"set", value: string, why: string}} PlanEdit
 * @typedef {{name: string, kind: "segredo"|"decisao"|"template", why: string}} PlanManual
 * @typedef {{consumed: string[], edits: PlanEdit[], manual: PlanManual[], reconciled: string}} Plan
 * @typedef {Plan & {patch: string, patchMasked: boolean}} PlannedMirror
 */

/**
 * O veredito da comparacao, mais o que fazer a respeito.
 *
 * `plan.patch` e o diff que reconcilia o host. Ele e BYTE-EXATO quando nenhum
 * valor de segredo apareceria nele (o caso comum — o segredo costuma estar longe
 * das linhas corrigidas, e ai `git apply -p0` funciona); quando um segredo cair
 * no CONTEXTO do diff, o valor sai MASCARADO e `plan.patchMasked` fica true — o
 * patch entao e artefato de REVISAO e quem aplica e o `--fix`.
 *
 * `remaining` e o que a mesma regra ainda acusaria depois de aplicar o plano — a
 * conta que o `--fix` exige fechar antes de escrever.
 *
 * @typedef {{state: "in-sync"|"diverged"|"absent", violations: string[], consumed: string[], host: string|null, template: string|null, detail: string, plan: PlannedMirror, remaining: string[]}} MirrorResult
 */

/**
 * Uma comparacao pura: dois conteudos de env + o compose que diz QUAIS nomes
 * importam. Sem filesystem e sem docker — e o que o teste exercita.
 *
 * @param {{templateContent: string, hostContent: string, composeContent: string, templateLabel: string, hostLabel: string}} args
 * @returns {{violations: string[], consumed: string[]}}
 */
export function compareMirrors({
  templateContent,
  hostContent,
  composeContent,
  templateLabel,
  hostLabel,
}) {
  const consumed = composeEnvVariables(composeContent)
  const violations = compareEnvMirrorDeclarations({
    template: parseEnvAssignments(templateContent),
    host: parseEnvAssignments(hostContent),
    templateLabel,
    hostLabel,
    consumed,
  })
  return { violations, consumed }
}

/**
 * A TABELA DE ESPELHOS desta guarda, com a DECISÃO DE COBERTURA do recorte do
 * commit para cada um — o que o `check-mirror-coverage.mjs` mede.
 *
 * O defeito que ela existe para não esconder: o par (template comitado ↔ env do
 * host) é um espelho, e o lado VERSIONADO dele é um arquivo que um commit muda.
 * Nenhum guard `--staged` do hook julga as linhas deste template: quem o julga
 * precisa do HOST (que não está no commit) ou roda na varredura GLOBAL do PR.
 * Sem esta tabela, uma variável que o compose consome e o `check-actrc-sync` NÃO
 * cobre — o segredo, por exemplo — não tinha dono nenhum na conta do recorte.
 *
 * A DERIVAÇÃO É DO COMPOSE (`composeEnvVariables`), e não uma lista à mão: uma
 * variável nova que o compose passe a consumir entra na tabela no mesmo commit,
 * e a ausência de decisão para ela é violação (fail-closed no `check-mirror-coverage`).
 * Uma variável da lista que o TEMPLATE não declara não vira espelho medível: o
 * defeito ali é a ausência da linha — assunto do `check-registry-source`, que já
 * a julga — e não um recorte a medir. Ela fica declarada, com o motivo, em vez de
 * sumir da contagem.
 *
 * A REGRA DE VALOR de quem já a tem NÃO é reescrita aqui: as três variáveis da
 * imagem leem a decisão de `MIRROR_VARIABLE_RULES[name].env` (o dono da
 * comparação de valor), porque duas listas divergiriam no primeiro dia. Só quem
 * não tem regra ganha decisão própria — e o raciocínio dela é OUTRO: no segredo,
 * o valor do template é um PLACEHOLDER por desenho, então trocá-lo nunca é
 * defeito; a mutação que morde é a REMOÇÃO da linha.
 *
 * @param {{cwd?: string, read?: (p: string) => string, exists?: (p: string) => boolean}} [args]
 * @returns {{tabela: string, variavel: string, arquivo: string, medivel: boolean,
 *            motivoNaoMedivel?: string, recorte: {comando: string, regra: string}|null,
 *            motivo: string|null, mutacoesIgnoradas?: Record<string, string>}[]}
 */
export function envMirrors({
  cwd = ROOT,
  read = (p) => readFileSync(p, "utf8"),
  exists = existsSync,
} = {}) {
  const composePath = join(cwd, GITEA_COMPOSE)
  if (!exists(composePath)) return []
  const consumed = [...composeEnvVariables(read(composePath))].sort()
  const declaradasNoTemplate = parseEnvAssignments(read(join(cwd, GITEA_ENV_MIRROR)))
  return consumed.map((variavel) => {
    const base = { tabela: ENV_MIRROR_TABELA, variavel, arquivo: GITEA_ENV_MIRROR }
    if (!declaradasNoTemplate.has(variavel)) {
      return {
        ...base,
        medivel: false,
        motivoNaoMedivel: `o compose consome '${variavel}' e o template comitado não o declara — não há linha para mutar. Quem acusa essa ausência é o \`check-registry-source\` (o par template↔host), não o recorte do commit.`,
        recorte: null,
        motivo: `não é um espelho do commit: o nome que o compose lê nem aparece no template. Declarar a linha é a correção, e ela é do \`check-registry-source\`.`,
      }
    }
    // OS PARES DECLARADOS que não são variáveis de imagem (a tabela
    // `COMPOSE_VALUE_DEFAULTS`, do guard dono do par): o default do compose e o
    // valor do template são a mesma declaração, e quem os compara POR VALOR é o
    // `check-registry-source` na varredura GLOBAL — o recorte do commit não tem
    // este template em pathspec nenhuma. A decisão não é reescrita aqui: ela é
    // LIDA do mesmo lugar que declara o par (duas listas divergiriam no primeiro
    // dia, e um par novo entraria na conta sem ninguém decidir o recorte dele).
    const parDeclarado = COMPOSE_VALUE_DEFAULTS.find(
      (e) => e.name === variavel && e.template === GITEA_ENV_MIRROR,
    )
    if (parDeclarado) {
      return {
        ...base,
        medivel: true,
        recorte: null,
        motivo:
          "o recorte do commit não julga este par: nenhum guard `--staged` tem o template do env nas pathspecs. Quem o cobre é o `check-registry-source` na varredura GLOBAL (a troca do default do compose e a remoção da linha declarada) — o hook roda esse guard no modo global, julgando o REPO inteiro —, e o CI no PR. O porquê da igualdade: " +
          parDeclarado.why,
      }
    }
    const regraDoValor = MIRROR_VARIABLE_RULES[variavel]?.env
    if (regraDoValor) {
      return {
        ...base,
        medivel: true,
        recorte: regraDoValor.recorte ?? null,
        motivo: regraDoValor.motivo ?? null,
      }
    }
    if (classifyEnvVariable(variavel) === "secret") {
      return {
        ...base,
        medivel: true,
        recorte: null,
        motivo:
          "o recorte não julga o SEGREDO: no template o valor é um PLACEHOLDER e no host é o valor real — a comparação exige o host (o bring-up a faz, antes de garantir a imagem), e o que o commit não pode julgar é um valor que não está nele. A EXISTÊNCIA da linha é do `check-registry-source` (varredura global do PR).",
        mutacoesIgnoradas: {
          swap: "trocar o PLACEHOLDER do segredo por outro não é defeito nenhum (divergir do host é o comportamento correto de um segredo). A mutação que morde a linha do template é a REMOÇÃO.",
        },
      }
    }
    return {
      ...base,
      medivel: true,
      recorte: null,
      motivo: null,
    }
  })
}

/** O nome da tabela nos relatórios (o mesmo que o `check-mirror-coverage` publica). */
export const ENV_MIRROR_TABELA = "env-mirror"

/**
 * A mascara com que um valor de SEGREDO aparece em qualquer saida (patch, JSON,
 * relatorio). O valor real nunca sai do host — nem quando o operador pede o
 * patch para colar num PR ou num chat.
 */
export const MASK = "<valor real oculto>"

/**
 * Quebra o conteudo em linhas, guardando o EOL observado. Preservar o EOL
 * importa: o env do host pode ser CRLF, e o `--fix` nao pode reescrever o
 * arquivo inteiro so porque o gerador assumiu `\n`.
 *
 * @param {string} text
 * @returns {{lines: string[], eol: string, endsWithEol: boolean}}
 */
function splitLines(text) {
  const eol = text.includes("\r\n") ? "\r\n" : "\n"
  const endsWithEol = text.endsWith("\n")
  const lines = text.split(/\r?\n/)
  if (endsWithEol) lines.pop()
  return { lines, eol, endsWithEol }
}

/** O prefixo de uma linha que atribui um nome (`export ` opcional + indentacao). */
const ASSIGN = /^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_]*)\s*=/

/**
 * Aplica o plano ao CONTEUDO do host (texto -> texto, sem filesystem) — e o que
 * o `--fix` grava e o que o teste confere sem tocar em disco.
 *
 * @param {string} hostContent
 * @param {{name: string, action: "add"|"set", value: string}[]} edits
 * @returns {string}
 */
export function applyPlan(hostContent, edits) {
  const { lines, eol, endsWithEol } = splitLines(hostContent)
  for (const edit of edits) {
    if (edit.action !== "set") continue
    // Da ULTIMA para a PRIMEIRA: a leitura e "ultima ocorrencia vence" (a
    // semantica do `--env-file`), entao corrigir uma ocorrencia sombreada
    // deixaria o valor antigo valendo — o arquivo mudaria e nada seria corrigido.
    for (let i = lines.length - 1; i >= 0; i--) {
      const m = lines[i].match(ASSIGN)
      if (m && m[2] === edit.name) {
        lines[i] = `${m[1]}${edit.name}=${edit.value}`
        break
      }
    }
  }
  for (const edit of edits) {
    if (edit.action === "add") lines.push(`${edit.name}=${edit.value}`)
  }
  return lines.join(eol) + (endsWithEol ? eol : "")
}

/**
 * O plano de reconciliacao do HOST com o template: as edicoes MECANICAS
 * (`edits`) e o que depende de decisao humana (`manual`).
 *
 * Nao ha regra nova aqui: e a MESMA `compareEnvMirrorDeclarations`, lida ao
 * contrario — cada violacao ou vira uma edicao, ou e nomeada como manual. O
 * teste prende essa equivalencia (nenhuma violacao pode ficar sem destino).
 *
 * @param {{templateContent: string, hostContent: string, composeContent: string, templateLabel: string, hostLabel: string}} args
 * @returns {Plan}
 */
export function planMirror({
  templateContent,
  hostContent,
  composeContent,
  templateLabel,
  hostLabel,
}) {
  const consumed = composeEnvVariables(composeContent)
  const template = parseEnvAssignments(templateContent)
  const host = parseEnvAssignments(hostContent)
  /** @type {PlanEdit[]} */
  const edits = []
  /** @type {PlanManual[]} */
  const manual = []

  // 1. O CONTRATO DO REPOSITORIO: nome que o compose consome e o template nao
  // declara. Nao ha edicao possivel no host — inventar o valor seria declarar
  // pelo repositorio o que ele nao declara.
  for (const name of consumed) {
    const declared = template.get(name)
    if (declared === undefined || declared.trim() === "") {
      manual.push({
        name,
        kind: "template",
        why: `${templateLabel} nao declara '${name}', que o compose consome — o lado a corrigir e o TEMPLATE comitado, nao o host`,
      })
    }
  }

  // 2. Nome declarado no template e AUSENTE no host: o compose cairia no default.
  for (const name of [...template.keys()].sort()) {
    if (host.has(name)) continue
    if (classifyEnvVariable(name) === "secret") {
      manual.push({
        name,
        kind: "segredo",
        why: `'${name}' (segredo) nao existe em ${hostLabel} — o valor real so o operador tem, e o plano NUNCA copia o placeholder do template nem inventa um`,
      })
    } else {
      edits.push({
        name,
        action: "add",
        value: template.get(name),
        why: `declarada em ${templateLabel} e ausente no host: acrescentada no fim com o valor do template`,
      })
    }
  }

  // 3. Nome que existe no host e o template nao declara: e DECISAO (declarar no
  // template ou remover do host), nao valor. Apagar configuracao de quem opera
  // nao e reconciliar — o plano nomeia e devolve a decisao.
  for (const name of [...host.keys()].sort()) {
    if (template.has(name)) continue
    manual.push({
      name,
      kind: "decisao",
      why: `'${name}' existe no host e nao em ${templateLabel}: declare-a no template (se este VPS precisa dela) ou remova-a do host — o plano nao apaga configuracao por conta propria`,
    })
  }

  // 4. O VALOR das variaveis que os dois lados declaram.
  for (const name of consumed) {
    const hostValue = host.get(name)
    if (hostValue === undefined) continue // ja contado no passo 2
    if (classifyEnvVariable(name) === "secret") {
      // Segredo: o defeito e TER o mesmo valor do template (ou nenhum). Nos dois
      // casos falta um valor que nao esta no repositorio -> manual.
      if (hostValue.trim() === "") {
        manual.push({
          name,
          kind: "segredo",
          why: `'${name}' (segredo) esta VAZIA em ${hostLabel} — o container receberia string vazia`,
        })
      } else if (hostValue === template.get(name)) {
        manual.push({
          name,
          kind: "segredo",
          why: `'${name}' (segredo) tem em ${hostLabel} o MESMO valor do template comitado (o placeholder) — cole o valor real`,
        })
      }
      continue
    }
    const templateValue = template.get(name)
    if (templateValue !== undefined && hostValue !== templateValue) {
      edits.push({
        name,
        action: "set",
        value: templateValue,
        why: `host='${hostValue}' diverge de ${templateLabel}='${templateValue}' — passa a valer o valor do template`,
      })
    }
  }

  return { consumed, edits, manual, reconciled: applyPlan(hostContent, edits) }
}

/**
 * Gera um diff unificado entre dois conteudos (linha a linha, LCS).
 *
 * Escrito aqui em vez de shell out para `git diff`: o comando roda em qualquer
 * host (inclusive sem docker/git) e o teste valida a SAIDA contra um parser
 * independente — o `git aplicar --check`. Um gerador de diff erra em silencio
 * (contagem de linhas do `@@`), e e exatamente isso que a validacao pega.
 *
 * @param {string} before
 * @param {string} after
 * @param {{fromLabel?: string, toLabel?: string, context?: number}} [opts]
 * @returns {string} vazio quando nao ha diferenca
 */
export function unifiedDiff(before, after, { fromLabel = "a", toLabel = "b", context = 3 } = {}) {
  const a = splitLines(before).lines
  const b = splitLines(after).lines
  const ops = lineOps(a, b)
  const changed = ops.map((op, k) => (op.type === "eq" ? -1 : k)).filter((k) => k >= 0)
  if (changed.length === 0) return ""

  // Agrupa em hunks: uma mudanca entra no hunk anterior enquanto os contextos
  // nao se sobrepoem (dois blocos de contexto contiguos seriam um so).
  /** @type {number[][]} */
  const groups = []
  for (const k of changed) {
    const last = groups.at(-1)
    if (last && k - last[last.length - 1] <= context * 2) last.push(k)
    else groups.push([k])
  }

  const aPos = new Array(ops.length)
  const bPos = new Array(ops.length)
  let ai = 0
  let bi = 0
  ops.forEach((op, k) => {
    aPos[k] = ai
    bPos[k] = bi
    if (op.type !== "add") ai += 1
    if (op.type !== "del") bi += 1
  })

  const out = [`--- ${fromLabel}`, `+++ ${toLabel}`]
  for (const group of groups) {
    const from = Math.max(0, group[0] - context)
    const to = Math.min(ops.length - 1, group[group.length - 1] + context)
    const span = ops.slice(from, to + 1)
    const aCount = span.filter((op) => op.type !== "add").length
    const bCount = span.filter((op) => op.type !== "del").length
    // A contagem 0 e a insercao pura: a faixa vazia se ancora na linha ANTERIOR
    // (a convencao do `diff -u`, que o `git apply` tambem le).
    const aStart = aCount === 0 ? aPos[from] : aPos[from] + 1
    const bStart = bCount === 0 ? bPos[from] : bPos[from] + 1
    out.push(`@@ -${aStart},${aCount} +${bStart},${bCount} @@`)
    for (const op of span) {
      out.push(`${op.type === "eq" ? " " : op.type === "del" ? "-" : "+"}${op.text}`)
    }
  }
  return `${out.join("\n")}\n`
}

/**
 * As operacoes de edicao entre duas listas de linhas, via LCS.
 *
 * @param {string[]} a
 * @param {string[]} b
 * @returns {{type: "eq"|"del"|"add", text: string}[]}
 */
function lineOps(a, b) {
  const n = a.length
  const m = b.length
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const ops = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: "eq", text: a[i] })
      i += 1
      j += 1
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: "del", text: a[i] })
      i += 1
    } else {
      ops.push({ type: "add", text: b[j] })
      j += 1
    }
  }
  while (i < n) ops.push({ type: "del", text: a[i++] })
  while (j < m) ops.push({ type: "add", text: b[j++] })
  return ops
}

/**
 * Mascara o VALOR de toda linha de SEGREDO que apareca no patch.
 *
 * O plano nunca edita um segredo, entao nenhuma linha `+`/`-` carrega um. O que
 * vaza e o CONTEXTO: um segredo que fique a tres linhas de uma correcao entra no
 * diff como linha ` ` (inalterada) e levaria o valor real junto. Mascarar o
 * contexto custa a aplicabilidade literal com `git apply` — o patch e o artefato
 * de REVISAO, e quem aplica e o `--fix` (que escreve direto, sem `git`).
 *
 * @param {string} patch
 * @returns {string}
 */
export function maskSecrets(patch) {
  return String(patch ?? "")
    .split("\n")
    .map((line) => {
      const m = line.match(/^([ +-])(.*)$/)
      if (!m) return line
      const assign = m[2].match(ASSIGN)
      if (!assign || classifyEnvVariable(assign[2]) !== "secret") return line
      return `${m[1]}${assign[1]}${assign[2]}=${MASK}`
    })
    .join("\n")
}

/**
 * Aplica o plano ao arquivo do host — e RECUSA quando o plano nao fecha a conta.
 *
 * Puro na escrita: recebe o `write` (o `main` injeta tmp+rename; o teste injeta
 * um espião). Devolve o desfecho em vez de decidir exit code.
 *
 * O portao do meio e o ponto: `remaining` e o que a MESMA regra ainda acusa
 * depois de aplicar o plano em memoria. Se sobrar violacao que o plano nao
 * explicou como manual, aquilo e uma divergencia que este reconciliador NAO
 * entende — e escrever assim seria apagar a duvida em vez de mostra-la.
 *
 * @param {{plan: Plan, remaining: string[], write: (content: string) => void}} args
 * @returns {{applied: boolean, reason?: string, unchanged?: boolean}}
 */
export function applyFix({ plan, remaining, write }) {
  const unexplained = remaining.length - plan.manual.length
  if (unexplained !== 0) {
    return {
      applied: false,
      reason: `o plano nao fecha a conta: ${remaining.length} violacao(oes) restante(s) para ${plan.manual.length} decisao(oes) manual(is) — ${unexplained} sem explicacao. NADA foi escrito`,
    }
  }
  if (plan.edits.length === 0) {
    return {
      applied: false,
      unchanged: true,
      reason: "nada no host e corrigivel mecanicamente — o que resta depende de decisao humana",
    }
  }
  // Defesa em profundidade: o plano nunca edita segredo, e se algum dia editar
  // (uma variavel nova entrando em SECRET_ENV_VARIABLES, por exemplo) o unico
  // valor que o host poderia receber seria o placeholder comitado.
  const forbidden = plan.edits.filter((e) => classifyEnvVariable(e.name) === "secret")
  if (forbidden.length > 0) {
    return {
      applied: false,
      reason: `o plano tentaria escrever o SEGREDO '${forbidden.map((e) => e.name).join(", ")}' no host — recusado. NADA foi escrito`,
    }
  }
  write(plan.reconciled)
  return { applied: true }
}

/**
 * O caminho absoluto de um env apontado por flag, com o label para a mensagem.
 * `null` quando o arquivo nao existe — o CLI decide se a ausencia e erro de uso
 * (a flag foi dada e aponta para o nada) ou apenas "nao aplicavel".
 *
 * @param {string} cwd
 * @param {string} path
 * @returns {{path: string, label: string}|null}
 */
function at(cwd, path) {
  const full = isAbsolute(path) ? path : join(cwd, path)
  return existsSync(full) ? { path: full, label: path } : null
}

/**
 * A comparacao completa: resolve os dois lados (flags primeiro, descoberta
 * depois) e aplica a regra. Nao decide exit code — devolve o estado.
 *
 * `absent` NAO e "conforme": e "nao havia o que comparar". O bring-up trata os
 * dois como recusa (ele exige a comparacao); um relatorio solto pode querer
 * distinguir — por isso o estado existe em vez de um booleano.
 *
 * @param {{cwd?: string, host?: string|null, template?: string|null, read?: (p: string) => string, exists?: (p: string) => boolean}} [args]
 * @returns {MirrorResult}
 */
export function checkEnvMirror({
  cwd = ROOT,
  host = null,
  template = null,
  read = (p) => readFileSync(p, "utf8"),
  exists = existsSync,
} = {}) {
  // O template: a flag EXPLICITA primeiro; senao o comitado. Uma flag que aponta
  // para o nada nao vira o template comitado em silencio (isso faria a
  // comparacao medir outro arquivo sem avisar) — o CLI recusa antes de chegar aqui.
  const templateSide = template
    ? at(cwd, template)
    : exists(join(cwd, GITEA_ENV_MIRROR))
      ? { path: join(cwd, GITEA_ENV_MIRROR), label: GITEA_ENV_MIRROR }
      : null
  // O host: a flag explicita primeiro; senao os espelhos do HOST descobertos
  // (gitignored — existem so onde a stack roda).
  const hostSide = host ? at(cwd, host) : (discoverEnvMirrors(cwd).find((m) => m.deployed) ?? null)

  if (!templateSide || !hostSide) {
    const missing = [
      !templateSide ? `o template (${template ?? GITEA_ENV_MIRROR})` : null,
      !hostSide ? `o env do host (${host ?? GITEA_ENV_DEPLOYED.join(", ")})` : null,
    ].filter(Boolean)
    return {
      state: "absent",
      violations: [],
      consumed: [],
      host: hostSide?.label ?? null,
      template: templateSide?.label ?? null,
      detail: `nao havia o que comparar: ${missing.join(" e ")} nao existe(m) — a subida exige a comparacao, nao a presume`,
      // Sem os dois lados nao ha plano: nao se reconcilia com um arquivo que nao
      // existe (criar o host a partir do template gravaria o placeholder do
      // segredo — o `--fix` recusa em vez de inventar estado).
      plan: {
        consumed: [],
        edits: [],
        manual: [],
        reconciled: "",
        patch: "",
        patchMasked: false,
      },
      remaining: [],
    }
  }

  const templateContent = read(templateSide.path)
  const hostContent = read(hostSide.path)
  const composeContent = read(join(cwd, GITEA_COMPOSE))
  const { violations, consumed } = compareMirrors({
    templateContent,
    hostContent,
    composeContent,
    templateLabel: templateSide.label,
    hostLabel: hostSide.label,
  })
  const plan = planMirror({
    templateContent,
    hostContent,
    composeContent,
    templateLabel: templateSide.label,
    hostLabel: hostSide.label,
  })
  // O que a MESMA regra acusa no conteudo ja corrigido — a conta do `--fix`.
  const remaining = plan.edits.length
    ? compareMirrors({
        templateContent,
        hostContent: plan.reconciled,
        composeContent,
        templateLabel: templateSide.label,
        hostLabel: hostSide.label,
      }).violations
    : violations

  // O patch que reconcilia o host. Labels VERBATIM (sem o prefixo `a/`/`b/`): o
  // host pode vir por caminho absoluto numa invocacao e relativo noutra, e o
  // patch tem de ser lido do mesmo jeito nos dois — `git apply -p0`.
  const rawPatch = plan.edits.length
    ? unifiedDiff(hostContent, plan.reconciled, {
        fromLabel: hostSide.label,
        toLabel: hostSide.label,
      })
    : ""
  // `maskSecrets` so muda o texto quando um valor de segredo REALMENTE apareceu
  // no diff. Sem diferenca, o patch fica byte-exato e aplicavel (`git apply -p0`);
  // com diferenca, ele vira artefato de REVISAO e quem aplica e o `--fix`.
  const maskedPatch = maskSecrets(rawPatch)
  const patchMasked = maskedPatch !== rawPatch

  return {
    state: violations.length > 0 ? "diverged" : "in-sync",
    violations,
    consumed,
    host: hostSide.label,
    template: templateSide.label,
    detail:
      violations.length > 0
        ? `${violations.length} divergencia(s) entre o env do HOST (${hostSide.label}) e o template comitado (${templateSide.label})`
        : `host x template em sincronia: ${consumed.length} variavel(is) que o compose consome conferidas (${hostSide.label} x ${templateSide.label})`,
    plan: {
      ...plan,
      patch: patchMasked ? maskedPatch : rawPatch,
      patchMasked,
    },
    remaining,
  }
}

export const USAGE = `check-env-mirror — o env do HOST espelha o template comitado?

  node scripts/check-env-mirror.mjs [opcoes]

  --host <caminho>       o env do HOST (default: descoberto — ${GITEA_ENV_DEPLOYED.join(", ")})
  --template <caminho>   o template comitado (default: ${GITEA_ENV_MIRROR})
  --patch                imprime o diff que reconcilia o host (segredo mascarado)
  --fix                  aplica o diff ao host (atomico; nunca toca no segredo)
  --json                 imprime o resultado em JSON (ja inclui o plano e o patch)
  -h, --help             esta ajuda

Exit codes: 0 em sincronia · 1 diverge (ou nao havia o que comparar) · 2 uso invalido`

/**
 * O uso dos argumentos — puro, para o teste exercitar o contrato da CLI.
 *
 * @param {string[]} argv
 * @returns {{error?: string, help?: boolean, json?: boolean, patch?: boolean, fix?: boolean, host?: string|null, template?: string|null}}
 */
export function parseArgs(argv) {
  const opts = { json: false, help: false, patch: false, fix: false, host: null, template: null }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--json") opts.json = true
    else if (arg === "--patch") opts.patch = true
    else if (arg === "--fix") opts.fix = true
    else if (arg === "-h" || arg === "--help") opts.help = true
    else if (arg === "--host" || arg === "--template") {
      const value = argv[i + 1]
      if (!value) return { error: `${arg} exige um caminho` }
      i += 1
      if (arg === "--host") opts.host = value
      else opts.template = value
    } else return { error: `flag desconhecida: ${arg}` }
  }
  // Os modos sao EXCLUSIVOS de proposito: `--patch` e `--fix` respondem a mesma
  // pergunta por caminhos diferentes (revisar x aplicar) e `--json` ja entrega o
  // patch e o plano — misturar deixaria a saida com dois donos.
  if (opts.patch && opts.fix) return { error: "--patch e --fix sao alternativas: escolha uma" }
  if (opts.json && (opts.patch || opts.fix))
    return { error: "--json ja traz o plano e o patch: nao combine com --patch/--fix" }
  return opts
}

/** O relatorio humano — os dois lados, as variaveis e cada divergencia. */
export function renderReport(result, { emit = console.log } = {}) {
  const line = (s = "") => emit(s)
  line()
  line("check-env-mirror — o env do host espelha o template comitado?")
  line(`  host     : ${result.host ?? "<nao encontrado>"}`)
  line(`  template : ${result.template ?? "<nao encontrado>"}`)
  if (result.state !== "absent") {
    line(`  conferido: ${result.consumed.join(", ")}`)
  }
  line()
  if (result.state === "in-sync") {
    line(`  ✅ EM SINCRONIA: ${result.detail}`)
  } else {
    for (const v of result.violations) line(`  ❌ ${v}`)
    line(
      `  ${result.state === "absent" ? "·" : "❌"} ${result.state === "absent" ? "NAO APLICAVEL" : "DIVERGE"}: ${result.detail}`,
    )
  }
  if (result.state !== "absent") {
    const { edits, manual } = result.plan ?? { edits: [], manual: [] }
    if (edits.length > 0 || manual.length > 0) {
      line("  O QUE MUDA NO HOST (bun run env-mirror:check --patch | --fix):")
      // `edits` nunca carrega segredo (o plano os recusa por desenho), entao
      // imprimir o valor aqui nao vaza nada: e o valor do template COMITADO.
      for (const e of edits) {
        line(`    - ${e.action === "add" ? "acrescentar" : "corrigir"} ${e.name}=${e.value}`)
      }
      for (const m of manual) line(`    ! ${m.name} (${m.kind}): ${m.why}`)
      line()
    }
    if (result.remaining?.length) {
      line(
        `  Depois do plano ainda restam ${result.remaining.length} violacao(oes) — todas dependem de decisao humana.`,
      )
      line(
        "  O --fix nao inventa segredo, nao apaga configuracao do operador nem corrige o template.",
      )
      line()
    }
  }
  line("  A regra e a mesma do `check:registry-source` (invariante 7b) — aqui ela roda")
  line("  no momento de subir a stack, para o pre-requisito nao depender de alguem lembrar.")
  line()
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.error) {
    console.error(`check-env-mirror: ${opts.error}`)
    console.error(USAGE)
    process.exit(EXIT.USAGE)
  }
  if (opts.help) {
    console.log(USAGE)
    process.exit(EXIT.OK)
  }
  // A flag EXPLICITA apontando para o nada e erro de uso (pergunta explicita):
  // comparar outro arquivo em silencio seria medir o que ninguem pediu.
  for (const [flag, value] of [
    ["--host", opts.host],
    ["--template", opts.template],
  ]) {
    if (value && !existsSync(isAbsolute(value) ? value : join(process.cwd(), value))) {
      console.error(`check-env-mirror: ${flag} aponta para um arquivo inexistente: ${value}`)
      console.error(USAGE)
      process.exit(EXIT.USAGE)
    }
  }

  const result = checkEnvMirror({ host: opts.host, template: opts.template })

  // ── --patch: o diff que reconcilia o host ────────────────────────────────
  // STDOUT leva SO o patch (para `--patch > fix.patch` funcionar); o relatorio e
  // o aviso vao para STDERR, que e onde diagnostico pertence.
  if (opts.patch) {
    renderReport(result, { emit: (s = "") => console.error(s) })
    if (result.plan.patch === "") {
      console.error("check-env-mirror: --patch: nada a mudar no host (o patch seria vazio)")
    } else if (result.plan.patchMasked) {
      console.error(
        "check-env-mirror: --patch: o CONTEXTO do diff tem um SEGREDO, mascarado — este patch e para REVISAO; aplique com --fix (git apply nao aceita o placeholder)",
      )
      process.stdout.write(result.plan.patch)
    } else {
      console.error("check-env-mirror: --patch: byte-exato — aplique com: git apply -p0")
      process.stdout.write(result.plan.patch)
    }
    // O exit responde "depois deste patch o host espelha?" — nao "o patch saiu?".
    process.exit(result.remaining.length === 0 ? EXIT.OK : EXIT.DIVERGED)
  }

  // ── --fix: aplica o plano ao arquivo do host ─────────────────────────────
  if (opts.fix) {
    if (result.state === "in-sync") {
      console.error(`check-env-mirror: --fix: ja em sincronia — nada a fazer (${result.host})`)
      process.exit(EXIT.OK)
    }
    if (result.state === "absent") {
      console.error(`check-env-mirror: --fix: nao havia o que reconciliar — ${result.detail}`)
      if (!result.host) {
        console.error(
          `  crie o env do host a partir do template e cole o segredo a mao: cp ${result.template ?? GITEA_ENV_MIRROR} <env do host>`,
        )
      }
      process.exit(EXIT.DIVERGED)
    }
    const hostPath = isAbsolute(result.host) ? result.host : join(process.cwd(), result.host)
    const write = (content) => {
      // ATOMICO: o rename no MESMO diretorio troca o arquivo de uma vez. Quem
      // subir a stack junto com o --fix nunca le metade do env.
      const tmp = `${hostPath}.env-mirror-fix.${process.pid}.tmp`
      writeFileSync(tmp, content, "utf8")
      renameSync(tmp, hostPath)
    }
    const outcome = applyFix({ plan: result.plan, remaining: result.remaining, write })
    if (outcome.applied) {
      console.error(
        `check-env-mirror: --fix aplicou ${result.plan.edits.length} correcao(oes) em ${result.host} (escrita atomica)`,
      )
      // O patch do que FOI aplicado sai no stdout (o artefato), como no --patch.
      process.stdout.write(result.plan.patch)
    } else {
      console.error(`check-env-mirror: --fix NAO escreveu nada — ${outcome.reason}`)
    }
    // O relatorio e do estado DEPOIS: e ele que responde "espelha agora?".
    const after = checkEnvMirror({ host: opts.host, template: opts.template })
    renderReport(after, { emit: (s = "") => console.error(s) })
    process.exit(after.state === "in-sync" ? EXIT.OK : EXIT.DIVERGED)
  }

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2))
  } else {
    renderReport(result)
  }
  // `absent` sai 1 pelo MESMO motivo de `diverged`: quem chamou pediu a garantia
  // do espelho (o bring-up), e "nao havia o que comparar" nao e a garantia.
  process.exit(result.state === "in-sync" ? EXIT.OK : EXIT.DIVERGED)
}

const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (IS_DIRECT_RUN) await main()
