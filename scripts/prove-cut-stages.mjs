#!/usr/bin/env node
/**
 * scripts/prove-cut-stages.mjs — a prova por EXECUÇÃO das etapas do corte do
 * GitHub (`docs/GITHUB_CUT.md` §3).
 *
 * O que ele responde, para cada PASSO do plano (etapa 1..5, aplicadas em
 * sequência sobre uma cópia da árvore rastreada):
 *
 *   1. a forja DONA DO MERGE continua com os MESMOS gates? (invariante dura:
 *      nenhuma etapa pode tocar a pipeline que decide o merge)
 *   2. o contrato de merge (`ci/required-checks.json`) continua resolvendo os
 *      MESMOS contextos na dona do merge? (a proteção da forja é o que trava o
 *      PR — perder um contexto ali é perder o portão)
 *   3. o veredito do `check-forge-parity` fica o DECLARADO para o passo?
 *      (uma etapa pode legitimamente mudar o espelho — mas só o que ela
 *      DECLARA; qualquer outro delta é quebra)
 *   4. o espelho (a pipeline que a etapa desliga) perde exatamente os gates que
 *      a etapa declara perder? — e nada além disso.
 *
 * Por que EXECUÇÃO e não leitura: o plano afirma que "cada etapa é shippable".
 * A afirmação é sobre o efeito das transformações na árvore, e a única forma de
 * medir isso é APLICAR cada transformação numa cópia e ler o veredito dos
 * guards reais (as mesmas funções puras que as pipelines executam: a derivação
 * de gates do `doctor`, o `discoverGates`/`findParityViolations` da paridade e a
 * resolução de contextos do `check-required-checks`). Nada é reimplementado
 * aqui: o harness é um MEDIDOR dos guards existentes.
 *
 * As transformações são MECÂNICAS e declaradas (`STAGES`), e cada uma tem a
 * regra escrita: um `sed` de valor, a remoção de um bloco de chave YAML (`schedule:`),
 * a remoção de um bloco de passo, a substituição de um `uses:`, e a remoção dos
 * arquivos do espelho. O que o harness NÃO é: uma execução das pipelines nas
 * forjas (isso é o `prove-forge-runtime`, que roda os gates de verdade dentro da
 * imagem) — aqui o veredito é o dos CONTRATOS da árvore.
 *
 * Usage:
 *   node scripts/prove-cut-stages.mjs            # todas as etapas, tabela legível
 *   node scripts/prove-cut-stages.mjs --json     # saída estruturada
 *   node scripts/prove-cut-stages.mjs --medir    # só MEDE (nunca falha; imprime as linhas)
 *   node scripts/prove-cut-stages.mjs --only etapa-3
 *   node scripts/prove-cut-stages.mjs --keep     # mantém as cópias (para inspeção)
 *   node scripts/prove-cut-stages.mjs --root DIR # mede outra árvore (default: repo)
 *
 * Exit codes:
 *   0 — cada etapa ficou no que DECLARA (a outra forja, intacta)
 *   1 — alguma etapa mudou algo que ela não declara (quebra)
 *   2 — não foi possível medir (INDETERMINADO — nunca verde por não saber)
 *   3 — uso
 */

import { spawnSync } from "node:child_process"
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import {
  PIPELINES,
  defaultReadFile,
  discoverGates,
  findParityViolations,
} from "./check-forge-parity.mjs"
import {
  isAllowlistedThirdParty,
  isCommentLine,
  stripInlineComment,
} from "./check-registry-source.mjs"
import { defaultIo, loadManifest, resolveManifestContexts } from "./check-required-checks.mjs"
import { GITHUB_WORKFLOW_DIR, isSlashComment, workflowFileNames } from "./forge-workflows.mjs"
import { forgeGatesForRuntime } from "./prove-forge-runtime.mjs"

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")

/** Exit codes — o contrato da CLI. */
export const EXIT = {
  OK: 0,
  BROKEN: 1,
  UNAVAILABLE: 2,
  USAGE: 3,
}

/** A pipeline do espelho (a que o corte desliga) e o template do registry. */
export const MIRROR_PIPELINE = PIPELINES.find((p) => !p.mergeOwner).file
export const MIRROR_FORGE = PIPELINES.find((p) => !p.mergeOwner).forge
export const OWNER_FORGE = PIPELINES.find((p) => p.mergeOwner).forge

/** O template que DECLARA o registry (fonte única do flip da etapa 1). */
export const REGISTRY_TEMPLATE = "deploy/env.gitea.example"

/** O valor de ANTES da etapa 1 — o que a transformação do flip substitui. */
export const REGISTRY_ANTES = "ghcr.io"

/** Prosa: o flip não reescreve documentação (o rollback fica escrito nela). */
const PROSA_RE = /\.md$/i

/**
 * O que TESTA ou GRAVA o valor não é flipado.
 *
 * Em `src/` (testes e snapshots), em `docs/benchmarks/` (o registro do que foi
 * medido) e nos fixtures de mutation test, o literal do registry é a EXPECTATIVA
 * medida ou a evidência registrada — reescrevê-lo não faz parte de publicar a
 * imagem no registry próprio, e apagaria a evidência que diz que o flip
 * aconteceu. As declarações de verdade (composes, workflows, `.actrc`, os
 * templates de env e os scripts de setup) continuam no escopo.
 */
const FLIP_FORA_RE = /^(src\/|docs\/benchmarks\/)|(^|\/)test-mutation-.*\.sh$/

const USAGE = `prove-cut-stages — prova por execução das etapas do corte do GitHub

Uso: node scripts/prove-cut-stages.mjs [--json] [--medir] [--only <id>] [--root DIR] [--keep]

  --json    saída estruturada (para consumo por outro script)
  --medir   só mede e imprime (não julga: útil para congelar a declaração de uma etapa nova)
  --only    mede só as etapas com o id dado (repetível, ou lista separada por vírgula)
  --root    mede outra árvore (default: a raiz do repositório)
  --keep    mantém as cópias temporárias e imprime os caminhos
  -h        esta ajuda

Exit: 0 declarado · 1 mudança não declarada · 2 não foi possível medir · 3 uso`

// ═══════════════════════════════════════════════════════════════════════════
// As transformações — cada uma MECÂNICA, idempotente e declarada em `STAGES`
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Os arquivos de FONTE da árvore — rastreados MAIS os não rastreados que o
 * `.gitignore` não exclui, sempre sem `node_modules` (a cópia é feita disto: os
 * guards aqui são funções puras sobre dados).
 *
 * O escopo é declarado pelo `git`, não por uma varredura própria:
 * `--exclude-standard` é a declaração do REPOSITÓRIO sobre o que é fonte, então
 * um arquivo ainda não commitado (o trabalho em curso) entra na medição e um
 * artefato ignorado (`.next/`, `node_modules/`) não. Medir só os RASTREADOS
 * deixaria o passo "shippable" cego justamente para o que está prestes a ser
 * commitado — foi assim que um cron do espelho ficou fora da primeira medição.
 *
 * @param {string} root
 * @returns {string[]}
 */
export function trackedFiles(root) {
  const res = spawnSync(
    "git",
    ["-C", root, "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    },
  )
  if (res.status !== 0) {
    throw new Error(
      `git ls-files falhou em ${root}: ${(res.stderr ?? "").trim() || `exit ${res.status}`}`,
    )
  }
  return res.stdout.split("\0").filter(Boolean)
}

/**
 * Copia a árvore RASTREADA para `dest` (a transformação nunca roda na árvore
 * real — um passo do plano que apagasse arquivos de verdade seria irreversível).
 *
 * @param {string} root
 * @param {string} dest
 * @returns {{arquivos: number, files: string[]}} arquivos copiados e a lista deles
 */
export function copyTree(root, dest) {
  let n = 0
  const files = trackedFiles(root)
  for (const rel of files) {
    const origem = join(root, rel)
    if (!existsSync(origem) || !statSync(origem).isFile()) continue
    const alvo = join(dest, rel)
    mkdirSync(dirname(alvo), { recursive: true })
    cpSync(origem, alvo)
    n++
  }
  return { arquivos: n, files }
}

/** Leitura que devolve `null` (nunca lança) — arquivo ausente E binário. */
function readTextOrNull(path) {
  if (!existsSync(path)) return null
  const raw = readFileSync(path)
  if (raw.includes(0)) return null
  return raw.toString("utf8")
}

/** O registry DECLARADO (fonte única: o template do HOST). Fail-closed. */
export function declaredRegistry(root) {
  const raw = readTextOrNull(join(root, REGISTRY_TEMPLATE))
  if (raw === null)
    throw new Error(`${REGISTRY_TEMPLATE} ausente — sem ele o flip da etapa 1 não tem fonte única`)
  const m = /^[ \t]*IMAGE_REGISTRY[ \t]*=[ \t]*(\S+)[ \t]*$/m.exec(raw)
  if (!m)
    throw new Error(
      `${REGISTRY_TEMPLATE} não declara IMAGE_REGISTRY — o flip não pode inventar o valor`,
    )
  return m[1]
}

/** Aplica `fn` no conteúdo de um arquivo e grava só se mudou. */
function editText(path, fn) {
  const original = readTextOrNull(path)
  if (original === null) return false
  const novo = fn(original)
  if (novo === null || novo === original) return false
  writeFileSync(path, novo)
  return true
}

/**
 * Remove blocos de CHAVE YAML (`schedule:`) — a chave e tudo mais indentado
 * abaixo dela. Linhas vazias dentro do bloco são absorvidas; um bloco vazio no
 * fim do arquivo é o caso normal de `schedule` com um `cron:`.
 *
 * @param {string} conteudo
 * @param {RegExp} keyRe
 * @returns {{conteudo: string, removidos: number}}
 */
export function removeKeyBlocks(conteudo, keyRe) {
  const linhas = conteudo.split("\n")
  const out = []
  let removidos = 0
  for (let i = 0; i < linhas.length; i++) {
    const m = /^([ \t]*)([A-Za-z_][\w.-]*):/.exec(linhas[i])
    if (m && keyRe.test(m[2])) {
      const indent = m[1].length
      removidos++
      i++
      for (; i < linhas.length; i++) {
        if (linhas[i].trim() === "") continue
        const ind = /^[ \t]*/.exec(linhas[i])[0].length
        if (ind <= indent) break
      }
      i--
      continue
    }
    out.push(linhas[i])
  }
  return { conteudo: out.join("\n"), removidos }
}

/**
 * Remove blocos de PASSO (linhas `- ...` e tudo indentado abaixo) cujo texto
 * casa `pred`. O passo é a unidade do `run:`/`uses:` — remover meia linha
 * deixaria o workflow com YAML válido e semântica mentirosa.
 *
 * @param {string} conteudo
 * @param {(bloco: string) => boolean} pred
 * @returns {{conteudo: string, removidos: string[]}}
 */
export function removeStepBlocks(conteudo, pred) {
  const linhas = conteudo.split("\n")
  const out = []
  const removidos = []
  for (let i = 0; i < linhas.length; i++) {
    const m = /^([ \t]*)- /.exec(linhas[i])
    if (!m) {
      out.push(linhas[i])
      continue
    }
    const indent = m[1].length
    let j = i + 1
    for (; j < linhas.length; j++) {
      if (linhas[j].trim() === "") continue
      if (/^[ \t]*/.exec(linhas[j])[0].length <= indent) break
    }
    const bloco = linhas.slice(i, j)
    if (pred(bloco.join("\n"))) {
      removidos.push(bloco[0].trim().slice(0, 90))
      i = j - 1
      continue
    }
    out.push(...bloco)
    i = j - 1
  }
  return { conteudo: out.join("\n"), removidos }
}

/** Os caminhos RELATIVOS dos workflows do espelho (na cópia). */
function mirrorFiles(copy) {
  return workflowFileNames(copy, GITHUB_WORKFLOW_DIR).map(
    (name) => `${GITHUB_WORKFLOW_DIR}/${name}`,
  )
}

/**
 * Etapa 1 — o registry próprio. Todo arquivo RASTREADO (fora de prosa e fora de
 * LINHA DE COMENTÁRIO) que afirma o registry antigo passa a afirmar o declarado.
 */
/**
 * Uma linha pode ser flipada? A régua é a do guard do registry: LINHA DE
 * COMENTÁRIO (é onde a documentação explica o default) e referência de
 * TERCEIRO na allowlist (o `postgis` mora no GHCR de quem o publica — flipá-lo
 * quebraria o pull da imagem alheia em nome de uma etapa do nosso corte) ficam
 * de fora.
 *
 * @param {string} line
 * @returns {boolean}
 */
export function flipavel(rel, line) {
  if (PROSA_RE.test(rel) || FLIP_FORA_RE.test(rel)) return false
  if (isCommentLine(line) || isSlashComment(line)) return false
  // Comentário INLINE (YAML e shell) é prosa, pela régua do próprio guard do
  // registry (`stripInlineComment`): o texto ANOTADO depois do código não é o
  // que resolve a imagem.
  if (!stripInlineComment(line).includes(REGISTRY_ANTES)) return false
  return !isAllowlistedThirdParty(line)
}

/**
 * A linha usa o literal numa DECISÃO (`!==`, `includes(`), e não só numa
 * MENSAGEM? A distinção importa: um literal em mensagem é prosa dentro de
 * código; um literal que COMPARA pode ser (a) o host do GHCR, que é um fato do
 * caminho antigo, ou (b) um espelho velho que ficou para trás — quem decide é o
 * leitor, e o relatório entrega a linha em vez de opinar.
 *
 * @param {string} line
 * @returns {boolean}
 */
export function literalEmDecisao(line) {
  return /!==|!=|===|==|includes\(|startsWith\(|\.test\(/.test(line)
}

export function flipRegistry(copy, files, { antes = REGISTRY_ANTES } = {}) {
  const novo = declaredRegistry(copy)
  const alvos = []
  let terceirosPulados = 0
  for (const rel of files) {
    if (PROSA_RE.test(rel) || FLIP_FORA_RE.test(rel)) continue
    const raw = readTextOrNull(join(copy, rel))
    if (raw === null || !raw.includes(antes)) continue
    const linhas = raw.split("\n").filter((l) => l.includes(antes))
    terceirosPulados += linhas.filter((l) => isAllowlistedThirdParty(l)).length
    if (linhas.some((l) => flipavel(rel, l))) alvos.push(rel)
  }
  const alterados = []
  const linhas = []
  for (const rel of alvos) {
    const original = readTextOrNull(join(copy, rel)) ?? ""
    const mudou = editText(join(copy, rel), (raw) =>
      raw
        .split("\n")
        .map((l) => (flipavel(rel, l) ? l.split(antes).join(novo) : l))
        .join("\n"),
    )
    if (!mudou) continue
    alterados.push(rel)
    const antesLinhas = original.split("\n")
    const i = antesLinhas.findIndex((l) => flipavel(rel, l) && l.includes(antes))
    if (i >= 0)
      linhas.push({
        rel,
        n: i + 1,
        texto: antesLinhas[i].trim().slice(0, 140),
        decisao: literalEmDecisao(antesLinhas[i]),
      })
  }
  return {
    arquivos: alterados.length,
    alterados,
    linhas,
    decisoes: linhas.filter((l) => l.decisao).length,
    novo,
    candidatos: alvos.length,
    terceirosPulados,
  }
}

/** Etapa 2 — o espelho para de ser agendador: nenhum `schedule:` nos workflows dele. */
export function mirrorCronsOff(copy) {
  let crons = 0
  const arquivos = []
  for (const rel of mirrorFiles(copy)) {
    let nesta = 0
    editText(join(copy, rel), (raw) => {
      const r = removeKeyBlocks(raw, /^schedule$/)
      nesta = r.removidos
      return r.removidos > 0 ? r.conteudo : raw
    })
    crons += nesta
    if (nesta > 0) arquivos.push(`${rel} (${nesta})`)
  }
  return { crons, arquivos }
}

/** Um passo é do CANAL do GitHub quando invoca `gh` ou a action `github-script`. */
export const GH_STEP_RE =
  /\bgh\s+(?:issue|pr|api|release|repo|run|auth|gist|variable|secret|label|workflow)\b|actions\/github-script/

/** Etapa 3 — os canais só-GitHub do espelho: os passos que falam `gh` saem. */
export function mirrorGhChannelsOff(copy) {
  const removidos = []
  for (const rel of mirrorFiles(copy)) {
    let ultimo = []
    editText(join(copy, rel), (raw) => {
      const r = removeStepBlocks(raw, (bloco) => GH_STEP_RE.test(bloco))
      ultimo = r.removidos
      return r.removidos.length > 0 ? r.conteudo : raw
    })
    for (const b of ultimo) removidos.push(`${rel}: ${b}`)
  }
  return { passos: removidos }
}

/** Um `uses:` de TERCEIRO (não é o workflow local `.github/workflows/...`). */
export const THIRD_PARTY_USES_RE = /^([ \t]*)- uses:\s*([^.\s#][^\s#]*)\s*$/

/** Etapa 4 — serviço de terceiro resolvido por ferramenta do repositório. */
export function mirrorMarketplaceOff(copy) {
  const substituidos = []
  for (const rel of mirrorFiles(copy)) {
    editText(join(copy, rel), (raw) => {
      const linhas = raw.split("\n")
      let mudou = false
      const saida = linhas.map((l) => {
        const m = THIRD_PARTY_USES_RE.exec(l)
        if (!m) return l
        mudou = true
        substituidos.push(`${rel}: ${m[2]}`)
        return `${m[1]}- run: echo "passo resolvido por ferramenta do repositorio (etapa 4)"`
      })
      return mudou ? saida.join("\n") : raw
    })
  }
  return { usos: substituidos }
}

/** Etapa 5 — o espelho desligado: os workflows dele saem do repositório. */
export function mirrorOff(copy) {
  const removidos = []
  for (const rel of mirrorFiles(copy)) {
    unlinkSync(join(copy, rel))
    removidos.push(rel)
  }
  return { workflows: removidos }
}

// ═══════════════════════════════════════════════════════════════════════════
// A medição (só as funções dos guards REAIS)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * O que uma medição devolve — tudo sem caminho absoluto (a comparação entre
 * etapas é por CONTEÚDO, e um tmpdir diferente por cópia quebraria isso).
 *
 * @typedef {{
 *   dona: { ok: boolean, detail: string, gates: string[] },
 *   espelho: { presentes: boolean, gates: string[] },
 *   paridade: { violacoes: string[], soDona: string[] },
 *   required: { forjas: string[], contextos: Record<string, string[]>, declarados: Record<string, string> },
 *   naoJulgaveis: string[],
 * }} Medido
 */

/** Chave estável de um gate (rótulo + comando) — o que a comparação usa. */
function gateKeys(gates) {
  return gates.map((g) => `${g.label}\u0000${g.command ?? ""}`).sort()
}

function listKeys(items) {
  return [...items].map((x) => JSON.stringify(x)).sort()
}

/**
 * Mede o veredito dos CONTRATOS da árvore em `root`.
 *
 * @param {string} root
 * @returns {Medido} medido (só dados sem caminho absoluto: a comparação é por CONTEÚDO)
 */
export function measureTree(root) {
  const owner = forgeGatesForRuntime(root)

  const mirrorContent = readTextOrNull(join(root, MIRROR_PIPELINE))
  const mirrorGates = mirrorContent === null ? [] : discoverGates(mirrorContent)

  const unjudgeable = []
  const read = defaultReadFile(root, unjudgeable)
  const violations = findParityViolations(read)
  // A MESMA medição com a declaração já sem a forja do espelho: é o par da
  // etapa 5 (a pipeline sai de `PIPELINES` no mesmo ato) — sem ele, uma etapa
  // que "desliga a forja" sem tocar na declaração parecia indistinguível de uma
  // que toca (a violação nomeada é o que denuncia a metade).
  const soDona = findParityViolations(
    defaultReadFile(root, []),
    PIPELINES.filter((p) => p.mergeOwner),
  )

  const manifest = loadManifest(root, defaultIo(root))
  const resolved = resolveManifestContexts(manifest, defaultIo(root))
  const contextos = {}
  for (const [forge, cfg] of Object.entries(resolved)) {
    contextos[forge] = cfg.contexts.map((c) => `${c.jobId}\u0000${c.context}`).sort()
  }
  const contextosDeclarados = {}
  for (const [forge, cfg] of Object.entries(manifest?.forges ?? {})) {
    contextosDeclarados[forge] = `${cfg.workflow} :: ${(cfg.jobs ?? []).join(",")}`
  }

  return {
    dona: { ok: owner.ok, detail: owner.detail, gates: gateKeys(owner.gates) },
    espelho: { presentes: mirrorContent !== null, gates: [...mirrorGates].sort() },
    paridade: { violacoes: [...violations].sort(), soDona: [...soDona].sort() },
    required: { forjas: Object.keys(contextos).sort(), contextos, declarados: contextosDeclarados },
    naoJulgaveis: listKeys(unjudgeable.map((u) => `${u.path}: ${u.motivo}`)),
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// As etapas do plano (a DECLARAÇÃO) e o julgamento
// ═══════════════════════════════════════════════════════════════════════════

/**
 * As cinco etapas de `docs/GITHUB_CUT.md` §3.
 *
 * `espera` é a DECLARAÇÃO do passo: o que ele pode mudar. Duas regras são
 * invariantes em TODAS as etapas (e por isso não são declaráveis):
 *   · os gates da forja DONA DO MERGE ficam idênticos;
 *   · os contextos de required check da DONA DO MERGE ficam idênticos.
 * `espelhoGates: null` significa "fica igual à etapa anterior"; um número é o
 * total declarado para o passo. `paridade: n` é o nº de violações declarado.
 */
export const STAGES = [
  {
    id: "etapa-1",
    etapa: 1,
    titulo: "o registry próprio (o flip do valor declarado)",
    regra:
      "todo arquivo rastreado fora de prosa/caminho de comentário que afirma o registry antigo passa a afirmar o declarado (fonte única: deploy/env.gitea.example)",
    apply: flipRegistry,
    espera: { espelhoGates: null, paridade: 0, espelhoPresente: true },
  },
  {
    id: "etapa-2",
    etapa: 2,
    titulo: "os 9 crons do espelho desligados",
    regra:
      "todo bloco de chave `schedule:` dos workflows do espelho é removido (o espelho para de ser agendador)",
    apply: mirrorCronsOff,
    espera: { espelhoGates: null, paridade: 0, espelhoPresente: true },
  },
  {
    id: "etapa-3",
    etapa: 3,
    titulo: "os canais só-GitHub do espelho (o `gh` e o `github-script`)",
    regra:
      "todo bloco de passo dos workflows do espelho que invoca `gh <subcomando>` ou `actions/github-script` é removido",
    apply: mirrorGhChannelsOff,
    espera: { espelhoGates: null, paridade: 0, espelhoPresente: true },
  },
  {
    id: "etapa-4",
    etapa: 4,
    titulo: "os serviços acoplados a Actions resolvidos pelo repositório",
    regra:
      "todo `- uses: <terceiro>@ref` dos workflows do espelho vira um passo `run:` (a dependência some, o passo fica)",
    apply: mirrorMarketplaceOff,
    espera: { espelhoGates: null, paridade: 0, espelhoPresente: true },
  },
  {
    id: "etapa-5",
    etapa: 5,
    titulo: "o espelho desligado (o repositório vira espelho read-only)",
    regra:
      "os arquivos de workflow do espelho são removidos — e a pipeline sai da declaração de PIPELINES no mesmo ato",
    apply: mirrorOff,
    // A violação DECLARADA do passo: a pipeline sai de `PIPELINES` no MESMO ato,
    // e até a declaração acompanhar o guard nomeia a forja fantasma (é a
    // medição da metade: o corte não pode ser aplicado sem a declaração).
    espera: { espelhoGates: 0, paridade: 1, espelhoPresente: false, declaraPipelinesSoDona: true },
  },
]

/**
 * Julga o medido de uma etapa contra a linha de base e a sua declaração.
 *
 * @param {{medido: Medido, base: Medido, espera: object, anterior: Medido}} args
 * @returns {{estado: "declarado"|"quebrou"|"indeterminado", motivos: string[], fatos: string[]}}
 */
export function classifyStage({ medido, base, espera, anterior }) {
  const motivos = []
  const fatos = []

  // ── as duas invariantes duras ───────────────────────────────────────────
  if (!medido.dona.ok) {
    return {
      estado: "indeterminado",
      motivos: [
        `a derivação dos gates da dona do merge não pôde ser medida: ${medido.dona.detail}`,
      ],
      fatos,
    }
  }
  if (medido.dona.gates.join("|") !== base.dona.gates.join("|")) {
    motivos.push(
      `os gates da dona do merge (${OWNER_FORGE}) MUDARAM — o corte não pode tocar a pipeline que decide o merge`,
    )
  }
  const ctxtBase = (base.required.contextos[OWNER_FORGE] ?? []).join("|")
  const ctxtMed = (medido.required.contextos[OWNER_FORGE] ?? []).join("|")
  if (ctxtMed !== ctxtBase) {
    motivos.push(
      `os required checks da dona do merge (${OWNER_FORGE}) MUDARAM — é a proteção da forja`,
    )
  }

  // ── a paridade (o contrato das duas pipelines) ──────────────────────────
  const paridadeEsperada = espera.paridade
  if (medido.paridade.violacoes.length !== paridadeEsperada) {
    motivos.push(
      `paridade: ${medido.paridade.violacoes.length} violação(ões) — o passo declara ${paridadeEsperada}` +
        (medido.paridade.violacoes.length > 0 ? ` [${medido.paridade.violacoes[0]}]` : ""),
    )
  } else if (paridadeEsperada > 0) {
    fatos.push(`paridade: ${paridadeEsperada} violação(ões) DECLARADA(s) para o passo`)
  }
  if (espera.declaraPipelinesSoDona) {
    if (medido.paridade.soDona.length !== 0) {
      motivos.push(
        `com a declaração atualizada no mesmo ato, a paridade ainda acusa ${medido.paridade.soDona.length} violação(ões): ${medido.paridade.soDona[0]}`,
      )
    } else {
      fatos.push(
        `paridade com a declaração atualizada no mesmo ato (PIPELINES sem a forja do espelho): 0 violação — e a violação acima é a forja fantasma que a declaração atrasada nomeia`,
      )
    }
  }

  // ── o espelho ───────────────────────────────────────────────────────────
  if (medido.espelho.presentes !== espera.espelhoPresente) {
    motivos.push(
      `o espelho (${MIRROR_PIPELINE}) está ${medido.espelho.presentes ? "presente" : "ausente"} — o passo declara ${espera.espelhoPresente ? "presente" : "ausente"}`,
    )
  }
  if (espera.espelhoGates === null) {
    if (medido.espelho.gates.join("|") !== anterior.espelho.gates.join("|")) {
      motivos.push(
        `o espelho perdeu/ganhou gates que o passo não declara (${anterior.espelho.gates.length} → ${medido.espelho.gates.length}): ` +
          primeiraDiferenca(anterior.espelho.gates, medido.espelho.gates),
      )
    }
  } else if (medido.espelho.gates.length !== espera.espelhoGates) {
    motivos.push(
      `o espelho tem ${medido.espelho.gates.length} gates — o passo declara ${espera.espelhoGates}`,
    )
  } else {
    fatos.push(`espelho: ${espera.espelhoGates} gates (declarado)`)
  }

  // ── o que NÃO pôde ser julgado (nomeado, nunca silencioso) ──────────────
  if (medido.naoJulgaveis.length > 0) {
    fatos.push(`não julgáveis: ${medido.naoJulgaveis.join("; ")}`)
  }

  return { estado: motivos.length === 0 ? "declarado" : "quebrou", motivos, fatos }
}

function primeiraDiferenca(antes, depois) {
  const a = new Set(antes)
  const d = new Set(depois)
  const saiu = [...a].filter((x) => !d.has(x))
  const entrou = [...d].filter((x) => !a.has(x))
  if (saiu.length > 0) return `saiu '${saiu[0]}'`
  if (entrou.length > 0) return `entrou '${entrou[0]}'`
  return "ordem"
}

/**
 * Roda UMA etapa: copia a árvore, aplica as transformações até ela (o passo N
 * é medido com as etapas 1..N aplicadas — é assim que o plano é executado),
 * mede e julga.
 *
 * @param {{id: string, etapa: number, apply: (copy: string, files: string[]) => object}} stage
 * @param {{root: string, base: Medido, anterior: Medido, medir: boolean, keep: boolean, dirs: string[], ate: {id: string, apply: (copy: string, files: string[]) => object}[]}} args
 * @returns {{copy: string, arquivos: number, aplicadas: {id: string, efeito: object}[], medido: Medido, estado: string, motivos: string[], fatos: string[]}}
 */
export function runStage(stage, { root, base, anterior, medir, keep, dirs, ate }) {
  const copy = mkdtempSync(join(tmpdir(), "cut-stages-"))
  if (keep) dirs.push(copy)
  const { arquivos, files } = copyTree(root, copy)
  const aplicadas = []
  for (const s of ate) {
    const efeito = s.apply(copy, files)
    aplicadas.push({ id: s.id, efeito })
  }
  const medido = measureTree(copy)
  const julgado = medir
    ? { estado: "declarado", motivos: [], fatos: [] }
    : classifyStage({ medido, base, espera: stage.espera, anterior })
  return {
    copy,
    arquivos,
    aplicadas,
    medido,
    ...julgado,
    fatos: [...julgado.fatos, ...fatosDoEfeito(aplicadas)],
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CLI
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Os fatos que o EFEITO da transformação revela e que o veredito dos guards não
 * mostra sozinho: um passo removido com nome de VERIFICAÇÃO não é gate pela
 * régua do contrato (a verificação é shell inline, e o `discoverGates` só vê
 * script/entry com prefixo de gate) — se ele sair do espelho sem re-homem, o
 * veredito continua verde e a inspeção sumiu.
 *
 * @param {{id: string, efeito: object}[]} aplicadas
 * @returns {string[]}
 */
export function fatosDoEfeito(aplicadas) {
  const fatos = []
  for (const a of aplicadas) {
    if (a.efeito?.passos) {
      const verificacoes = a.efeito.passos.filter((p) => /valid|check|verif/i.test(p))
      if (verificacoes.length > 0) {
        fatos.push(
          `${a.id}: ${verificacoes.length} passo(s) removido(s) com nome de VERIFICAÇÃO que NÃO são gates pela régua do contrato ` +
            `(shell inline) — a etapa tem de re-homá-los ou declará-los, senão o espelho fica verde sem a inspeção: ${verificacoes.join(" | ")}`,
        )
      }
    }
    if (a.efeito?.terceirosPulados > 0) {
      fatos.push(
        `${a.id}: ${a.efeito.terceirosPulados} referência(s) de terceiro na allowlist preservadas (não são nossas)`,
      )
    }
    if (a.efeito?.decisoes > 0) {
      const decisoes = a.efeito.linhas.filter((l) => l.decisao).slice(0, 3)
      fatos.push(
        `${a.id}: ${a.efeito.decisoes} arquivo(s) usam o literal antigo numa DECISÃO (não só em mensagem) — decida se é o host do caminho GHCR ou um espelho velho: ` +
          decisoes.map((l) => `${l.rel}:${l.n} ${l.texto}`).join(" | "),
      )
    }
    if (a.efeito?.linhas?.length > 0) {
      const mensagens = a.efeito.linhas.filter((l) => !l.decisao).slice(0, 3)
      if (mensagens.length > 0) {
        fatos.push(
          `${a.id}: literal antigo em MENSAGEM/REGISTRO (não decide nada): ` +
            mensagens.map((l) => `${l.rel}:${l.n}`).join(", "),
        )
      }
    }
  }
  return fatos
}

/** Os efeitos, resumidos numa linha legível por etapa. */
function resumoEfeito(efeito) {
  const cap = (xs, n = 4) =>
    xs.length <= n ? xs.join(", ") : `${xs.slice(0, n).join(", ")} (+${xs.length - n})`
  if (efeito.crons !== undefined) {
    return `${efeito.crons} bloco(s) \`schedule:\` removido(s) em ${efeito.arquivos.length} arquivo(s): ${cap(efeito.arquivos)}`
  }
  if (efeito.passos !== undefined)
    return `${efeito.passos.length} passo(s) de canal removido(s): ${cap(efeito.passos)}`
  if (efeito.usos !== undefined)
    return `${efeito.usos.length} linha(s) \`uses:\` de terceiro substituída(s)`
  if (efeito.workflows !== undefined)
    return `${efeito.workflows.length} workflow(s) do espelho removido(s)`
  if (efeito.arquivos !== undefined) {
    return (
      `${efeito.arquivos} arquivo(s) flipados (candidatos: ${efeito.candidatos}; ${efeito.decisoes} em DECISÃO; ` +
      `terceiros na allowlist preservados: ${efeito.terceirosPulados})` +
      (efeito.alterados?.length > 0 ? ` — ${cap(efeito.alterados)}` : "")
    )
  }
  return ""
}

function render(results, { base }) {
  console.log(
    `prove-cut-stages — o corte do GitHub, passo a passo (dona do merge: ${OWNER_FORGE})\n`,
  )
  const linha = (r) =>
    console.log(
      `  Etapa ${r.etapa}  ${r.id.padEnd(9)} ${r.estado === "declarado" ? "✅" : r.estado === "quebrou" ? "❌" : "⚠️ "} ` +
        `dona:${r.medido.dona.gates.length} gates idênticos · espelho:${r.medido.espelho.gates.length} gates · ` +
        `paridade:${r.medido.paridade.violacoes.length} · required:${Object.keys(r.medido.required.contextos).length} forja(s)`,
    )
  console.log(
    `  Etapa 0  (linha de base) dona:${base.dona.gates.length} gates · espelho:${base.espelho.gates.length} gates · paridade:${base.paridade.violacoes.length}\n`,
  )
  for (const r of results) {
    linha(r)
    console.log(`           ${r.titulo}`)
    for (const a of r.aplicadas) console.log(`           · ${a.id}: ${resumoEfeito(a.efeito)}`)
    for (const f of r.fatos) console.log(`           · ${f}`)
    for (const m of r.motivos) console.log(`           ❌ ${m}`)
  }
  const quebradas = results.filter((r) => r.estado === "quebrou")
  const indeterminadas = results.filter((r) => r.estado === "indeterminado")
  console.log()
  if (quebradas.length === 0 && indeterminadas.length === 0) {
    console.log(
      `prove-cut-stages: ✅ ${results.length} etapa(s) — cada passo fica no que DECLARA, e a forja dona do merge (${OWNER_FORGE}) fica intacta nas duas invariantes (gates e required checks).`,
    )
  } else if (indeterminadas.length > 0) {
    console.log(
      `prove-cut-stages: ⚠️  ${indeterminadas.length} etapa(s) INDETERMINADA(s) — não foi possível medir.`,
    )
  } else {
    console.log(`prove-cut-stages: ❌ ${quebradas.length} etapa(s) mudaram algo que NÃO declaram.`)
  }
}

function main() {
  const argv = process.argv.slice(2)
  const opts = { json: false, medir: false, keep: false, root: REPO_ROOT, only: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--json") opts.json = true
    else if (a === "--medir") opts.medir = true
    else if (a === "--keep") opts.keep = true
    else if (a === "--root") opts.root = resolve(argv[++i] ?? "")
    else if (a === "--only") opts.only.push(...(argv[++i] ?? "").split(",").filter(Boolean))
    else if (a === "-h" || a === "--help") {
      console.log(USAGE)
      process.exit(EXIT.OK)
    } else {
      console.error(`prove-cut-stages: flag desconhecida '${a}'\n${USAGE}`)
      process.exit(EXIT.USAGE)
    }
  }
  if (!existsSync(join(opts.root, ".gitea/workflows/ci.yml"))) {
    console.error(
      `prove-cut-stages: ❌ ${opts.root} não é a raiz do repositório (sem .gitea/workflows/ci.yml)`,
    )
    process.exit(EXIT.UNAVAILABLE)
  }

  const selecionadas =
    opts.only.length > 0 ? STAGES.filter((s) => opts.only.includes(s.id)) : STAGES
  if (selecionadas.length === 0) {
    console.error(
      `prove-cut-stages: ❌ --only não casou nenhuma etapa (ids: ${STAGES.map((s) => s.id).join(", ")})`,
    )
    process.exit(EXIT.USAGE)
  }

  const dirs = []
  const baseDir = mkdtempSync(join(tmpdir(), "cut-base-"))
  if (opts.keep) dirs.push(baseDir)
  let base
  try {
    copyTree(opts.root, baseDir)
    // A árvore real precisa abrir como repositório: a cópia não tem `.git`, e a
    // transformação da etapa 1 (o flip) precisa da LISTA de rastreados.
    trackedFiles(opts.root)
    base = measureTree(baseDir)
  } catch (err) {
    console.error(
      `prove-cut-stages: ⚠️  não foi possível medir a linha de base: ${err?.message ?? err}`,
    )
    process.exit(EXIT.UNAVAILABLE)
  }

  const results = []
  let anterior = base
  for (const stage of selecionadas) {
    const ate = STAGES.slice(0, STAGES.indexOf(stage) + 1)
    let r
    try {
      r = runStage(stage, {
        root: opts.root,
        base,
        anterior,
        medir: opts.medir,
        keep: opts.keep,
        dirs,
        ate,
      })
    } catch (err) {
      results.push({
        ...stage,
        estado: "indeterminado",
        motivos: [`não foi possível medir: ${err?.message ?? err}`],
        fatos: [],
        medido: anterior,
      })
      continue
    }
    anterior = r.medido
    results.push({ ...stage, ...r })
  }

  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          dona: OWNER_FORGE,
          espelho: MIRROR_FORGE,
          base: {
            gates: base.dona.gates.length,
            espelho: base.espelho.gates.length,
            paridade: base.paridade.violacoes.length,
          },
          etapas: results.map((r) => ({
            id: r.id,
            etapa: r.etapa,
            titulo: r.titulo,
            estado: r.estado,
            motivos: r.motivos,
            fatos: r.fatos,
            efeito: r.aplicadas.map((a) => ({ id: a.id, ...a.efeito })),
            medido: {
              dona: r.medido.dona.gates.length,
              espelho: r.medido.espelho.gates.length,
              paridade: r.medido.paridade.violacoes.length,
              required: Object.keys(r.medido.required.contextos),
              naoJulgaveis: r.medido.naoJulgaveis,
            },
          })),
        },
        null,
        2,
      ),
    )
  } else {
    render(results, { base })
    if (opts.keep) console.log(`\n  cópias mantidas: ${dirs.join(" ")}`)
  }

  if (!opts.keep) for (const d of dirs) rmSync(d, { recursive: true, force: true })
  for (const d of [baseDir]) if (!opts.keep) rmSync(d, { recursive: true, force: true })

  if (results.some((r) => r.estado === "indeterminado")) process.exit(EXIT.UNAVAILABLE)
  if (results.some((r) => r.estado === "quebrou")) process.exit(EXIT.BROKEN)
  process.exit(EXIT.OK)
}

const IS_DIRECT_RUN =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (IS_DIRECT_RUN) main()
