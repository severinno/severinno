#!/usr/bin/env node

// =============================================================================
// check-required-checks.mjs
//
// Guard que mantém `ci/required-checks.json` HONESTO em relação aos workflows.
//
// Por que existe: um required status check que não corresponde a nenhum job
// real não falha — ele ESPERA. O PR fica travado para sempre num check que
// nunca vai rodar, e o diagnóstico (do lado da forja) não diz o porquê. O
// inverso também dói: um job obrigatório que seja CONDICIONAL (`if:`) pode
// pular num PR, e um check que não roda não protege nada.
//
// Este guard falha o PR, cedo e barato (node puro, sem deps), quando o
// manifesto:
//   1. aponta para workflow inexistente;
//   2. lista um job que não existe naquele workflow;
//   3. lista um job com `if:` (obrigatório não pode ser condicional);
//   4. produz dois checks com o MESMO contexto (contexto é a chave do
//      branch protection — duplicata deixa um deles órfão);
//   5. tem um required check cujo CONTEXTO carrega uma CONTAGEM — "(27
//      node-pure mutation tests)", ", 5 cenários", "(40 guards)".
//
// E o OUTRO LADO DO MESMO DEFEITO (a metade que o manifesto sozinho não vê):
// quem bloqueia o merge NÃO é o manifesto, é a proteção APLICADA na forja. Uma
// mudança que renomeia o `name:` de um job required — ou entra/sai da lista —
// muda o contexto exigido, e a forja continua exigindo o contexto ANTIGO: o PR
// trava num check que nunca mais vai rodar, sem nenhuma linha de gate parecer
// errada. Por isso a reaplicação é DECLARADA no repositório, em
// `ci/required-checks-applied.json` (escrito por `apply-required-checks.mjs
// --apply`, que é quem de fato reaplica): este guard compara a declaração com os
// contextos que o manifesto/workflows derivam AGORA e falha nomeando o job, o
// contexto velho e o novo. Renomear sem reaplicar deixa de ser um commit que
// passa e vira um PR vermelho — a mesma lei do count, aplicada ao que já está
// aplicado.
//
//   6. `ci/required-checks-applied.json` ausente, ilegível ou com `version`
//      errada (fail-closed: sem a declaração não há como distinguir
//      "reaplicado" de "esquecido");
//   7. um contexto derivado que a proteção aplicada NÃO declara (o rename, o
//      job novo, o job que voltou) — com o remédio nomeado;
//   8. um contexto declarado como aplicado que o manifesto não produz mais (a
//      forja exige um check órfão) e uma forja do manifesto sem entrada na
//      declaração.
//
// Os itens do manifesto são IDs DE JOB, mas o CONTEXTO que a forja exige é o
// `name:` do job (ou o id, quando não há `name:`). Logo renomear um job MUDA o
// contrato de merge — e um nome com CONTAGEM o muda quando o número muda. Esses
// números neste repositório são DERIVADOS e crescem (a matriz de mutation tests
// ganhou a 27ª sub-test numa sessão; o contrato coordenado ganha um cenário por
// release): a proteção da forja passa a exigir um check que já não existe e o
// PR trava para sempre, sem nenhuma linha de gate parecer errada. A regra 5
// recusa o padrão; o count continua no summary/comentário/README, onde é
// diagnóstico, e nos guards que o comparam com o derivado.
//
// NOTA: parser de YAML deliberadamente caseiro (indentação de 2 níveis).
// Este job do CI NÃO instala node_modules, então `node scripts/...` não pode
// importar `yaml`. A fidelidade do parser é verificada por
// `src/lib/__tests__/required-checks-manifest.test.ts`, que compara o
// resultado com o do parser real nas MESMAS duas workflows.
//
// Usage:
//   node scripts/check-required-checks.mjs            # repo atual (default)
//   node scripts/check-required-checks.mjs --root X   # fixture (mutation test)
// Exit codes:
//   0 — manifesto consistente com os workflows (pass)
//   1 — divergência encontrada (fail)
//   2 — uso inválido (flag desconhecida)
// =============================================================================

import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import process from "node:process"
import { fileURLToPath, pathToFileURL } from "node:url"

export const MANIFEST_PATH = "ci/required-checks.json"

/**
 * A DECLARAÇÃO da reaplicação — o que a forja exige HOJE, por forja.
 *
 * Ele existe porque a pergunta "o branch protection foi reaplicado depois do
 * rename?" não se responde offline: quem responde é o `apply-required-checks
 * --check` (com token, no cron de drift) e o efeito dele é DEPOIS do merge. Este
 * arquivo é a metade que o PR consegue cobrar: a mudança de contexto tem de vir
 * ACOMPANHADA da declaração de que a proteção foi reaplicada — e quem a escreve
 * é o próprio applier (nunca a mão), para que "declarado" signifique
 * "aplicado".
 */
export const APPLIED_PATH = "ci/required-checks-applied.json"

const SUPPORTED_VERSION = 1

/** O porquê do arquivo, escrito no próprio arquivo (ele é lido no PR, sem contexto). */
const APPLIED_COMMENT = [
  "DECLARAÇÃO da proteção APLICADA nas forjas — escrita por",
  "scripts/apply-required-checks.mjs --apply, nunca a mão.",
  "",
  "O que bloqueia o merge não é este repositório: é o branch protection da forja,",
  "que exige o CONTEXTO de status (o `name:` do job, ou o id sem `name:`). Uma",
  "mudança que renomeia o `name:` de um required check — ou que põe/tira um job",
  "da lista — muda o contexto exigido, e a forja segue exigindo o ANTIGO: o PR",
  "trava esperando um check que nunca vai rodar, sem nenhuma linha de gate",
  "parecer errada.",
  "",
  "Por isso a reaplicação é DECLARADA aqui: `scripts/check-required-checks.mjs`",
  "compara esta lista com os contextos que o manifesto e os workflows derivam",
  "AGORA e falha o PR quando a mudança veio sem a reaplicação (nomeando o job, o",
  "contexto que a forja exigia e o que ela passaria a exigir). Depois do merge, o",
  "cron de drift (`required-checks-drift.yml` → `apply-required-checks --check`)",
  "confere a forja DE VERDADE contra o manifesto, e a divergência vira issue.",
  "",
  "Ele entra em sincronia com: `bun run ci:required-checks -- --apply` (escreve",
  "este arquivo e commite-o junto da mudança que mexeu no contexto).",
]

// ---------------------------------------------------------------------------
// Parser mínimo de `jobs:` (sem deps)
// ---------------------------------------------------------------------------

/** Remove aspas de um escalar YAML simples (`"x"`, `'x'`, `x`). */
function scalar(value) {
  const trimmed = String(value ?? "").trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2)
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

/**
 * Extrai os jobs de um workflow: `Map<jobId, { name: string|null, if: string|null }>`.
 *
 * Assume a indentação convencional destes workflows (jobs em 2 espaços,
 * propriedades do job em 4). Um job sem `name:` tem contexto = jobId na forja,
 * e é assim que o applier o resolve.
 */
export function parseWorkflowJobs(content) {
  const jobs = new Map()
  let inJobs = false
  let current = null

  for (const line of content.split(/\r?\n/)) {
    if (!inJobs) {
      if (/^jobs:\s*$/.test(line)) inJobs = true
      continue
    }
    if (line.trim() === "" || /^\s*#/.test(line)) continue

    // Voltou ao nível 0 (outra chave raiz do documento) → fim do bloco jobs.
    if (/^\S/.test(line)) {
      inJobs = false
      current = null
      continue
    }

    const jobId = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line)
    if (jobId) {
      current = jobId[1]
      jobs.set(current, { name: null, if: null, uses: null })
      continue
    }

    if (current === null) continue

    const name = /^ {4}name:\s*(.+)$/.exec(line)
    if (name) {
      jobs.get(current).name = scalar(name[1])
      continue
    }

    // `if:` do JOB (4 espaços). O `if:` de um step vive em 8 — ignorado.
    const condition = /^ {4}if:\s*(.+)$/.exec(line)
    if (condition) {
      jobs.get(current).if = scalar(condition[1])
      continue
    }

    // `uses:` — job que chama um reusable workflow.
    // Quando um job usa `uses:`, os checks que aparecem são dos jobs
    // DENTRO do reusable workflow, não deste job. O validator precisa
    // seguir a referência para resolver os nomes reais.
    const uses = /^ {4}uses:\s*(.+)$/.exec(line)
    if (uses) jobs.get(current).uses = scalar(uses[1])
  }

  return jobs
}

/** Contexto de status que a forja usa para um job: o `name:` ou, sem ele, o id. */
export function contextFor(jobId, job) {
  return job.name && job.name.length > 0 ? job.name : jobId
}

// ── CONTEXTO ESTÁVEL: nenhum required check carrega uma CONTAGEM no nome ────
//
// O contexto de um status check é o `name:` do job (ou o id), e é ele que o
// branch protection exige. Um número que descreve uma CONTAGEM no nome — "27
// node-pure mutation tests", "5 cenários", "40 guards" — faz o CONTRATO DE
// MERGE mudar quando o número muda. E neste repositório esses números são
// DERIVADOS e crescem: a matriz de mutation tests ganhou a 27ª sub-test numa
// única sessão. A proteção aplicada na forja passa então a exigir um check que
// já não existe e o PR trava para sempre — sem nenhuma linha de workflow
// parecer errada, porque o defeito não está no gate e sim no NOME dele.
//
// O count continua onde é DIAGNÓSTICO (summary do job, comentário, header,
// README) e onde um guard o compara com o derivado; o CONTEXTO fica estável.
// `TypeCheck (tsc --noEmit)` passa de propósito: o parêntese não é contagem.
const CONTAGEM_NO_CONTEXTO =
  /\([^)]*\b\d+\s*(?:node-pure|mutation|sub-?tests?|testes?|tests?|cen[aá]rios?|guards?|jobs?|checks?|passos?|steps?)[^)]*\)/i

/**
 * Trecho de CONTAGEM dentro de um contexto, ou null se o contexto é estável.
 *
 * @param {string} context contexto de status (o `name:` do job, ou o id).
 * @returns {string|null}
 */
export function contagemNoContexto(context) {
  const m = CONTAGEM_NO_CONTEXTO.exec(context ?? "")
  return m ? m[0] : null
}

// ---------------------------------------------------------------------------
// Validação do manifesto
// ---------------------------------------------------------------------------

/**
 * Valida o manifesto contra os workflows reais.
 *
 * @param {any} manifest           conteúdo de `ci/required-checks.json`
 * @param {{ readFile: (p: string) => string|null }} io  leitor (injável p/ teste)
 * @returns {{ forge: string, problem: string }[]} violações (vazio = ok)
 */
export function validateManifest(manifest, io) {
  const violations = []
  const fail = (forge, problem) => violations.push({ forge, problem })

  if (manifest?.version !== SUPPORTED_VERSION) {
    fail("-", `version deve ser ${SUPPORTED_VERSION} (encontrado: ${manifest?.version})`)
  }

  const branches = manifest?.branches
  if (!Array.isArray(branches) || branches.length === 0) {
    fail("-", "branches deve ser uma lista não-vazia")
  }

  const forges = manifest?.forges
  if (!forges || typeof forges !== "object" || Object.keys(forges).length === 0) {
    fail("-", "forges deve declarar ao menos uma forja")
    return violations
  }

  for (const [forge, config] of Object.entries(forges)) {
    if (typeof config?.workflow !== "string" || config.workflow.length === 0) {
      fail(forge, "workflow ausente")
      continue
    }
    const content = io.readFile(config.workflow)
    if (content === null) {
      fail(forge, `workflow "${config.workflow}" não existe`)
      continue
    }
    if (!Array.isArray(config.jobs) || config.jobs.length === 0) {
      fail(forge, "jobs deve ser uma lista não-vazia")
      continue
    }

    const workflowJobs = parseWorkflowJobs(content)
    const seenContexts = new Map()

    for (const jobId of config.jobs) {
      const job = workflowJobs.get(jobId)
      if (!job) {
        fail(
          forge,
          `job "${jobId}" não existe em ${config.workflow} — ` +
            `um required check inexistente FARIA o PR esperar para sempre`,
        )
        continue
      }

      // Job com `uses:` (reusable workflow): valida os jobs DENTRO do
      // reusable workflow, não o job pai (que não produz check próprio).
      if (job.uses) {
        const reusablePath = job.uses.replace(/^\.\//, "")
        const reusableContent = io.readFile(reusablePath)
        if (reusableContent === null) {
          fail(forge, `reusable workflow "${reusablePath}" (job "${jobId}") não existe`)
          continue
        }
        const reusableJobs = parseWorkflowJobs(reusableContent)
        for (const [rJobId, rJob] of reusableJobs) {
          if (rJob.if) {
            fail(
              forge,
              `job "${rJobId}" em ${reusablePath} é condicional (\`if: ${rJob.if}\`) — ` +
                `um check obrigatório que pode pular não protege nada`,
            )
          }
          const context = contextFor(rJobId, rJob)
          const contagem = contagemNoContexto(context)
          if (contagem) {
            fail(
              forge,
              `contexto "${context}" (job "${jobId}/${rJobId}") carrega uma CONTAGEM ("${contagem}") — ` +
                `o contrato de merge passaria a mudar quando o número mudar, e a forja exigiria um ` +
                `check inexistente (o PR trava). Tire o count do \`name:\`; ele vai no summary/comentário/README`,
            )
          }
          if (seenContexts.has(context)) {
            fail(
              forge,
              `contexto duplicado "${context}" (jobs "${seenContexts.get(context)}" e "${jobId}/${rJobId}")`,
            )
          } else {
            seenContexts.set(context, `${jobId}/${rJobId}`)
          }
        }
        continue
      }

      if (job.if) {
        fail(
          forge,
          `job "${jobId}" é condicional (\`if: ${job.if}\`) — ` +
            `um check obrigatório que pode pular não protege nada`,
        )
      }
      const context = contextFor(jobId, job)
      const contagem = contagemNoContexto(context)
      if (contagem) {
        fail(
          forge,
          `contexto "${context}" (job "${jobId}") carrega uma CONTAGEM ("${contagem}") — ` +
            `o contrato de merge passaria a mudar quando o número mudar, e a forja exigiria um ` +
            `check inexistente (o PR trava). Tire o count do \`name:\`; ele vai no summary/comentário/README`,
        )
      }
      if (seenContexts.has(context)) {
        fail(
          forge,
          `contexto duplicado "${context}" (jobs "${seenContexts.get(context)}" e "${jobId}")`,
        )
      } else {
        seenContexts.set(context, jobId)
      }
    }
  }

  return violations
}

/** Resolve os contextos de status por forja a partir do manifesto. */
export function resolveManifestContexts(manifest, io) {
  const resolved = {}
  for (const [forge, config] of Object.entries(manifest?.forges ?? {})) {
    const content = io.readFile(config.workflow)
    if (content === null) continue
    const workflowJobs = parseWorkflowJobs(content)
    const contexts = []

    for (const jobId of config.jobs ?? []) {
      const job = workflowJobs.get(jobId)
      if (!job) continue

      // Job com `uses:` (reusable workflow): os checks que aparecem na
      // forja são dos jobs DENTRO do reusable workflow, não deste job.
      // Seguimos a referência e resolvemos os nomes reais.
      if (job.uses) {
        const reusablePath = job.uses.replace(/^\.\//, "")
        const reusableContent = io.readFile(reusablePath)
        if (reusableContent) {
          const reusableJobs = parseWorkflowJobs(reusableContent)
          for (const [rJobId, rJob] of reusableJobs) {
            // Pula jobs condicionais do reusable workflow
            if (rJob.if) continue
            contexts.push({
              jobId: `${jobId}/${rJobId}`,
              context: contextFor(rJobId, rJob),
            })
          }
        } else {
          // Reusable workflow não encontrado — mantém o job pai como fallback
          contexts.push({ jobId, context: contextFor(jobId, job) })
        }
        continue
      }

      contexts.push({ jobId, context: contextFor(jobId, job) })
    }

    resolved[forge] = {
      workflow: config.workflow,
      branches: manifest.branches ?? [],
      contexts,
    }
  }
  return resolved
}

// ---------------------------------------------------------------------------
// A outra METADE: a proteção APLICADA (a que a forja exige de verdade)
// ---------------------------------------------------------------------------

/**
 * Lê a declaração da reaplicação. Falha ALTO (throw) quando ela não existe ou
 * não é JSON — "não consegui ler" nunca pode ser lido como "nada a comparar",
 * que é o verde por acidente desta classe.
 *
 * @param {string} root
 * @param {{ readFile: (p: string) => string|null }} io
 * @returns {any}
 */
export function loadApplied(root, io) {
  const raw = io.readFile(APPLIED_PATH)
  if (raw === null) {
    throw new Error(
      `${APPLIED_PATH} não existe — sem a DECLARAÇÃO da proteção aplicada não há como ` +
        `distinguir "reaplicado" de "esquecido" (e é isso que deixa a forja exigindo um ` +
        `check que já não existe). Reaplique e commite: ` +
        `bun run ci:required-checks -- --apply`,
    )
  }
  try {
    return JSON.parse(raw)
  } catch (error) {
    throw new Error(`${APPLIED_PATH}: JSON inválido (${error.message})`)
  }
}

/**
 * Compara a declaração da reaplicação com os contextos derivados AGORA.
 *
 * A comparação é pelo CONTEXTO (o que a forja exibe), não pelo id do job: é o
 * contexto que o branch protection exige, e é ele que muda quando alguém
 * renomeia o `name:` — no caso de um rename, id igual e contexto diferente.
 *
 * @param {any} applied
 * @param {Record<string, {workflow: string, branches: string[], contexts: {jobId: string, context: string}[]}>} resolved
 * @returns {{ forge: string, problem: string }[]} violações (vazio = ok)
 */
export function validateApplied(applied, resolved) {
  const violations = []
  const fail = (forge, problem) => violations.push({ forge, problem })

  if (applied === null || typeof applied !== "object") {
    fail("-", `${APPLIED_PATH} ausente ou não é um objeto — a reaplicação precisa ser DECLARADA`)
    return violations
  }
  if (applied.version !== SUPPORTED_VERSION) {
    fail(
      "-",
      `${APPLIED_PATH}: version deve ser ${SUPPORTED_VERSION} (encontrado: ${applied?.version})`,
    )
  }
  const forges = applied.forges
  if (!forges || typeof forges !== "object" || Object.keys(forges).length === 0) {
    fail("-", `${APPLIED_PATH}: forges deve declarar ao menos uma forja`)
    return violations
  }

  const reaplicar =
    `Reaplique e commite a declaração: bun run ci:required-checks -- --apply ` +
    `(ele reescreve ${APPLIED_PATH})`

  for (const [forge, declarado] of Object.entries(forges)) {
    const derivado = resolved[forge]
    if (!derivado) {
      fail(
        forge,
        `${APPLIED_PATH} declara a forja "${forge}", que o manifesto não declara — ` +
          `uma declaração a mais esconde uma reaplicação esquecida`,
      )
      continue
    }
    if (typeof declarado?.workflow === "string" && declarado.workflow !== derivado.workflow) {
      fail(
        forge,
        `${APPLIED_PATH} diz workflow "${declarado.workflow}", mas o manifesto diz ` +
          `"${derivado.workflow}" — a declaração é de OUTRA pipeline`,
      )
    }

    // As BRANCHES fazem parte do mesmo fato: uma branch nova no manifesto tem de
    // ter a proteção dela aplicada, senão o merge NAQUELA branch não exige gate
    // nenhum — o invisível da mesma família.
    const branches = declarado?.branches
    if (!Array.isArray(branches)) {
      fail(forge, `${APPLIED_PATH}: branches de "${forge}" deve ser uma lista`)
    } else {
      const aplicadas = new Set(branches)
      for (const branch of derivado.branches) {
        if (aplicadas.has(branch)) continue
        fail(
          forge,
          `a branch "${branch}" é protegida pelo manifesto e NÃO está na declaração aplicada — ` +
            `a proteção dela não foi reaplicada (o merge ali não exige os checks). ` +
            reaplicar,
        )
      }
      for (const branch of branches) {
        if (derivado.branches.includes(branch)) continue
        fail(
          forge,
          `a declaração aplicada cobre a branch "${branch}", que o manifesto não protege mais — ` +
            `o applier reescreve a declaração: ${reaplicar}`,
        )
      }
    }

    const contextos = declarado?.contexts
    if (!Array.isArray(contextos)) {
      fail(forge, `${APPLIED_PATH}: contexts de "${forge}" deve ser uma lista`)
      continue
    }
    const repetidos = contextos.filter((c, i) => contextos.indexOf(c) !== i)
    for (const dup of new Set(repetidos)) {
      fail(forge, `${APPLIED_PATH}: contexto "${dup}" declarado duas vezes`)
    }

    const aplicados = new Set(contextos)
    const derivados = new Map(derivado.contexts.map((c) => [c.context, c.jobId]))

    for (const { jobId, context } of derivado.contexts) {
      if (aplicados.has(context)) continue
      fail(
        forge,
        `o check "${context}" (job "${jobId}") é exigido pelo manifesto e NÃO está na proteção ` +
          `aplicada — a forja seguiria exigindo o contexto ANTIGO e o PR travaria num check que ` +
          `nunca roda (renomear um \`name:\`, ou entrar/sair da lista, MUDA o contrato de merge). ` +
          reaplicar,
      )
    }
    for (const context of contextos) {
      if (derivados.has(context)) continue
      fail(
        forge,
        `a proteção aplicada exige "${context}", que o manifesto/workflows não produzem mais — ` +
          `a forja travaria o PR esperando um check órfão. ` +
          reaplicar,
      )
    }
  }

  for (const forge of Object.keys(resolved)) {
    if (forges[forge] === undefined) {
      fail(
        forge,
        `a forja "${forge}" do manifesto não tem entrada em ${APPLIED_PATH} — sem ela, ` +
          `"nada declarado" passaria por "nada a reaplicar". ` +
          reaplicar,
      )
    }
  }

  return violations
}

/**
 * O conteúdo da declaração com os contextos que a forja passou a exigir.
 *
 * `forges` diz QUAIS forjas foram reaplicadas nesta rodada: uma forja que não foi
 * (ex.: `--forge gitea`) mantém a declaração ANTERIOR, porque a proteção dela
 * não mudou — reescrevê-la com o derivado seria declarar como aplicado algo que
 * ninguém aplicou.
 *
 * @param {any} atual                   a declaração anterior (ou null)
 * @param {Record<string, {workflow: string, branches: string[], contexts: {jobId: string, context: string}[]}>} resolved
 *                                      os contextos derivados agora
 * @param {string[]} forges             as forjas reaplicadas nesta rodada
 * @param {string} hoje                 a data da reaplicação (YYYY-MM-DD)
 */
export function buildAppliedRecord(atual, resolved, forges, hoje) {
  const record = {
    $comment: APPLIED_COMMENT,
    version: SUPPORTED_VERSION,
    appliedAt: hoje,
    forges: {},
  }
  for (const [forge, data] of Object.entries(resolved)) {
    const aplicadaAgora = forges.includes(forge)
    const anterior = atual?.forges?.[forge]
    const contextos = aplicadaAgora
      ? data.contexts.map((c) => c.context)
      : (anterior?.contexts ?? data.contexts.map((c) => c.context))
    record.forges[forge] = { workflow: data.workflow, branches: data.branches, contexts: contextos }
  }
  // O carimbo de data não gera churn: uma reaplicação sem mudança de CONTEXTO
  // (rodar `--apply` de novo, num repo já em sincronia) não deve sujar a árvore —
  // um diff de uma linha em cada apply ensina o operador a ignorar este arquivo,
  // e um arquivo ignorado não declara nada.
  const mudou =
    JSON.stringify(record.forges) !== JSON.stringify(atual?.forges ?? null) ||
    atual?.version !== SUPPORTED_VERSION
  return { record: mudou ? record : { ...atual }, mudou }
}

/**
 * Escreve a declaração da reaplicação. Devolve o que aconteceu (para o relatório
 * do applier dizer, sem ambiguidade, se há algo para commitar).
 *
 * @param {string} root
 * @param {Record<string, {workflow: string, branches: string[], contexts: {jobId: string, context: string}[]}>} resolved
 * @param {{forges: string[], hoje?: string}} opts
 * @returns {{ escrito: boolean, path: string }}
 */
export function writeAppliedRecord(
  root,
  resolved,
  { forges, hoje = new Date().toISOString().slice(0, 10) },
) {
  const io = defaultIo(root)
  let atual = null
  try {
    atual = loadApplied(root, io)
  } catch {
    atual = null
  }
  const { record, mudou } = buildAppliedRecord(atual, resolved, forges, hoje)
  if (mudou) writeFileSync(join(root, APPLIED_PATH), `${JSON.stringify(record, null, 2)}\n`, "utf8")
  return { escrito: mudou, path: APPLIED_PATH }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function defaultIo(root) {
  return {
    readFile: (relativePath) => {
      const absolute = join(root, relativePath)
      return existsSync(absolute) ? readFileSync(absolute, "utf8") : null
    },
  }
}

export function loadManifest(root, io) {
  const raw = io.readFile(MANIFEST_PATH)
  if (raw === null) throw new Error(`${MANIFEST_PATH} não encontrado`)
  return JSON.parse(raw)
}

function main() {
  // `--root X` existe para o mutation test: o guard julgava só a árvore real e a
  // regra do contexto (abaixo) não tinha como ser provada por EXECUÇÃO contra um
  // fixture — mesma convenção do check-mutation-count. Sem flag, o root é o repo.
  const argv = process.argv.slice(2)
  let root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--root") {
      root = resolve(argv[++i] ?? "")
    } else {
      console.error(`flag desconhecida: ${argv[i]} (use --root X)`)
      process.exit(2)
    }
  }
  const io = defaultIo(root)

  let manifest
  try {
    manifest = loadManifest(root, io)
  } catch (error) {
    console.error(`❌ ${error.message}`)
    process.exit(1)
  }

  const violations = validateManifest(manifest, io)

  // O OUTRO LADO: a proteção APLICADA (a que bloqueia o merge de verdade). As
  // duas metades são o mesmo fato visto do repositório e da forja, e são julgadas
  // juntas: um manifesto perfeito sobre uma proteção que exige o contexto antigo
  // deixa o PR travado para sempre — que é o modo de falha desta família.
  const resolved = resolveManifestContexts(manifest, io)
  let applied = null
  try {
    applied = loadApplied(root, io)
  } catch (error) {
    violations.push({ forge: "-", problem: error.message })
  }
  if (applied !== null) violations.push(...validateApplied(applied, resolved))

  if (violations.length > 0) {
    console.error(`❌ ci/required-checks.json divergiu dos workflows OU da proteção aplicada:\n`)
    for (const v of violations) console.error(`   - [${v.forge}] ${v.problem}`)
    console.error(
      `\n   Ação: corrija o manifesto OU restaure/renomeie o job. ` +
        `Os itens do manifesto são IDs de job, mas o CONTEXTO exigido na forja é o ` +
        `\`name:\` do job — renomear muda o contrato de merge, e um nome com ` +
        `CONTAGEM muda o contrato quando o número muda (por isso ele é recusado). ` +
        `E uma mudança de contexto só está em dia quando a proteção aplicada foi ` +
        `REAPLICADA e declarada em ${APPLIED_PATH}.`,
    )
    process.exit(1)
  }

  console.log(`✅ Required checks consistentes com os workflows:`)
  for (const [forge, data] of Object.entries(resolved)) {
    console.log(`   ${forge} (${data.workflow}) — branch: ${data.branches.join(", ")}`)
    for (const { context } of data.contexts) console.log(`     • ${context}`)
  }
  console.log(
    `\n   Proteção APLICADA declarada em ${APPLIED_PATH} (aplicada em ${applied?.appliedAt ?? "data desconhecida"}): ` +
      Object.entries(applied?.forges ?? {})
        .map(([forge, d]) => `${forge}=${(d.contexts ?? []).length}`)
        .join(" ") +
      ` — em sincronia com os contextos acima.`,
  )
  process.exit(0)
}

const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (IS_DIRECT_RUN) main()
