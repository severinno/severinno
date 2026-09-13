#!/usr/bin/env node

// =============================================================================
// forge-doctor.mjs
//
// Usage:
//   node scripts/forge-doctor.mjs                 # relatório de prontidão da forja
//   node scripts/forge-doctor.mjs --json          # o mesmo, como dados
//   node scripts/forge-doctor.mjs --no-guards     # pula a bateria (só contrato + imagem)
//   node scripts/forge-doctor.mjs --no-proof      # pula a prova do bloqueio (mais rápido)
//   node scripts/forge-doctor.mjs --no-protection # pula a leitura da forja (branch protection)
//   node scripts/forge-doctor.mjs --no-runner-labels # pula o registro do runner (as duas forjas)
//   node scripts/forge-doctor.mjs --no-image-contract # pula o contrato da imagem PUBLICADA
//   node scripts/forge-doctor.mjs --no-registry-probe # offline: nao consulta o registry
//   node scripts/forge-doctor.mjs --no-open-debt  # offline: nao le o board (as issues abertas)
//   node scripts/forge-doctor.mjs --expected 1.3.14 # valor de vars.BUN_VERSION
//   node scripts/forge-doctor.mjs --gitea-env deploy/.env.gitea
//   node scripts/forge-doctor.mjs --timeout 300   # segundos por guard (default 120)
//
// Exit codes:
//   0 — PRONTA: tudo o que dá para provar localmente foi provado, e a imagem do
//       runner existe e é puxável
//   1 — BLOQUEADA: alguma invariante falhou, OU a imagem do runner não está no
//       registry (sem ela NENHUM job inicia), OU a branch protection REGISTRADA
//       na forja diverge do manifesto (o merge é bloqueado pelo motivo errado, ou
//       não é bloqueado), OU uma referência em config NÃO VERSIONADA foi provada
//       errada (variável da forja divergindo dos espelhos, env do host da app
//       divergindo do template, default do compose divergindo do declarado, tag
//       re-tagada/ausente no registry), OU o REGISTRO do act_runner não é o do
//       compose (label gravado apontando para outra imagem: o job roda o que não
//       foi revisado), OU a imagem PUBLICADA não executa o contrato do build
//       (sem o plugin `compose`, com OUTRA versão do Bun, ou com o Bun fora de
//       /usr/local/bin) — o merge não pode ser confiado
//   2 — INDETERMINADA: nada falhou, mas algo não pôde ser provado (registry
//       inacessível, pacote privado sem credencial, ferramenta ausente) OU há
//       dívida ABERTA no board (uma issue de drift que ninguém fechou: o
//       repositório já sabe do problema, e o veredito não pode ignorá-lo)
//   3 — uso/erro interno (argumento inválido, pipeline ilegível)
//
// POR QUE EXISTE: os guards da forja passavam VERDES e a forja ainda não
// bloqueava o merge. Cada peça tem seu guard, mas ninguém respondia a pergunta
// inteira — e as respostas parciais alinhavam num sentido falso:
//
//   - `check:forge-parity` prova que a pipeline da forja CONTÉM as invariantes
//     do CORE. Ele não prova que elas PASSAM agora, nem que a branch protection
//     as exige, nem que o runner consegue iniciar um job;
//   - `check:required-checks` prova que o manifesto aponta para jobs que
//     EXISTEM. Ele não prova que a forja aplicou aquele manifesto;
//   - `runner-image:ensure` prova a imagem. Ele não sabe nada sobre os guards.
//
// E a garantia da imagem tinha um buraco próprio: `runner-image:check` diz se a
// tag existe AGORA, mas não prova que a subida da stack depende dela. Quem prova
// isso é uma seção a mais — a PROVA DO BLOQUEIO (seção 4): ela executa o
// `deploy/gitea-up.sh` real contra um registry de TESTE em 127.0.0.1, com a tag
// ausente e com a tag presente, e afirma sobre o LOG do docker dublê. Sem ela, o
// relatório afirmaria "a imagem está garantida" sem nunca ter visto o bloqueio
// acontecer.
//
// QUEM O CHAMA, E POR QUE ISSO IMPORTA: o `deploy/gitea-up.sh` executa este
// doctor como PRÉ-REQUISITO da subida da stack — veredito BLOQUEADA (e "não
// consegui rodar": sem veredito não há prontidão) RECUSA a subida, e
// INDETERMINADA avisa e segue, porque "não consegui provar agora" não é
// violação. Ele o chama com `--no-proof`: a prova do bloqueio (seção 4) EXECUTA
// aquele script, então chamá-la de dentro dele seria recursão — o `--no-proof`
// é consequência do desenho, não uma escolha de quem sobe a forja.
//
// Com todos eles verdes, um runner sem a imagem publicada, ou um gate quebrado
// no momento do merge, ainda travava o PR — e o diagnóstico chegava pelo
// sintoma mais distante da causa. Este comando junta as peças num veredito, e
// — igual de importante — DIZ O QUE NÃO PROVOU.
//
// DE ONDE VEM A LISTA DE GUARDS (o ponto central do desenho): de LUGAR NENHUM
// escrita à mão. A forja é dona do merge, então quem define "os guards da
// forja" é o próprio job `guards` de `.gitea/workflows/ci.yml`. O doctor fatia
// esse job e executa os gates que estão lá, com a mesma classificação que o
// `check-forge-parity` usa (`discoverGates`). Consequência: um guard novo na
// pipeline entra no doctor SOZINHO, e um guard removido de lá some daqui — não
// existe lista paralela para envelhecer.
//
// A branch protection REGISTRADA na forja ele AGORA lê (seção 1, o outro lado do
// contrato): quem lê é `scripts/apply-required-checks.mjs --check --json`, a
// mesma comparação que o cron de drift usa — sem uma segunda implementação que
// pudesse divergir da primeira justamente no dia do drift. Sem token de
// administração (ou sem rede), o estado é "não lida" — NUNCA "em sincronia".
//
// Os ESPELHOS do BUN_VERSION têm as duas metades: a de sempre (os arquivos
// existem e concordam entre si, sem rede) e a que faltava — cada um bate com o
// VALOR de `vars.BUN_VERSION`, via `--expected`, pela MESMA função que o guard
// periódico usa (`mirrorDriftReport`). Sem o valor, o doctor não inventa "em
// sincronia": ele diz que o valor não foi comparado (e o veredito fica parcial),
// porque dois espelhos que concordam entre si podem estar os DOIS velhos.
//
// As REFERÊNCIAS que não estão no repositório (invariante 9 do
// `check-registry-source`) entram pela MESMA função do gate — repository
// variables, env do host da aplicação e o que o registry serve para a tag. Ele
// não reimplementa nada: um segundo comparador divergiria do primeiro justamente
// no dia do drift. Violação bloqueia; INDETERMINADO nunca vira "pronta"; e um
// arquivo gitignored ausente (`absent`) não é pendência — é "não aplicável aqui".
//
// O CONTRATO DA IMAGEM PUBLICADA (seção 3) fecha o buraco que o build não
// alcança: as provas do build (o pin por digest, o bloco fail-closed, as
// mutações) continuam verdadeiras se a imagem que o registry serve for OUTRA
// build — e o job baixa essa. Quem responde é `checkPublishedImageContract`:
// resolve o DIGEST que a tag serve hoje e RODA o bloco do contrato DENTRO do
// artefato (`docker run <repo>@<digest>`), lendo plugin `compose`, versão do Bun
// e o caminho resolvido. Violação BLOQUEIA (o runner roda uma imagem que não
// cumpre a promessa); "não conseguiu rodar" (sem daemon, sem credencial, pull
// negado) é INDETERMINADA — e o custo é dito: o primeiro run baixa a imagem.
//
// O REGISTRO do act_runner (`/data/.runner`, seção 3) entra pela função do guard
// da Prova 5 do smoke (`checkRunnerLabels`, o mesmo exit code) — existe para o
// veredito não dizer "o compose PEDE a imagem certa" e ficar em silêncio sobre o
// que o runner GRAVOU, que é o que decide a imagem de cada job. Registro velho,
// vazio (runner órfão) ou compose sem os labels BLOQUEIAM; sem docker/container
// ou registro ilegível é INDETERMINADA — "não consegui ler" nunca é "está certo".
//
// O REGISTRO do runner do GITHUB (`--forge github` do MESMO guard, seção 3) é o
// fato irmão: lá o registro não tem arquivo (o `.runner` do actions/runner não
// guarda label nenhum), então quem decide é a API — e o declarado é o
// `RUNNER_LABELS` de `deploy/setup-github-runner.sh`. Mesmos pesos (violação
// bloqueia; sem token/API é INDETERMINADA), porque o sintoma é o mesmo: o
// workflow que pede um label que não está registrado não falha — ele ESPERA.
//
// A DÍVIDA ABERTA NO BOARD (seção 6) é o outro lado da moeda: tudo acima mede a
// forja AGORA, e nada disso enxerga a issue que um cron já abriu e ninguém
// fechou. Quem lê o board é `listIssuesByLabel`, a MESMA consulta dos
// publicadores, e o assunto tem de ser NOSSO (o marcador, não só a label).
// Dívida aberta NÃO bloqueia (não prova que o merge pode ser furado), mas
// impede PRONTA — e as duas labels cujo assunto o doctor mede por conta própria
// (`required-checks-drift` → proteção registrada, `actrc-sync-drift` → espelhos)
// vêm com a medição ao lado, para a issue velha não passar por problema vivo.
//
// O que ele NÃO pode provar daqui, e por isso sai escrito no relatório:
//   - a PERMISSÃO do token sobre a forja (sem ela, "não lida");
//   - o smoke (tier-1 em runtime — é um job da própria forja);
//   - o `.env.gitea` do VPS, que não existe neste checkout.
// =============================================================================

import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import process from "node:process"
import { spawnSync } from "node:child_process"
import { fileURLToPath, pathToFileURL } from "node:url"

import { discoverGates } from "./check-forge-parity.mjs"
import { checkPublishedImageContract } from "./check-runner-base.mjs"
import { credentialsFromEnv, ensureRunnerImage, DEFAULT_ENV_FILE } from "./ensure-runner-image.mjs"
import { GITHUB_RUNNER_SCRIPT, checkGithubRunnerLabels } from "./check-runner-labels.mjs"
import { proveRunnerImageGate } from "./prove-runner-image-gate.mjs"
import { checkComposeInterpolation, checkNonVersionedImageRefs } from "./check-registry-source.mjs"
import { checkRunnerLabels } from "./check-runner-labels.mjs"
import { GITEA_COMPOSE } from "./check-bun-mirror.mjs"
import { GITEA_WORKFLOW_DIR } from "./forge-workflows.mjs"
import { issueHasAnyMarker, listIssuesByLabel } from "./issue-publish.mjs"
import {
  extractActrcBunVersion,
  extractEnvMirrorBunVersion,
  GITEA_ENV_MIRROR,
  mirrorDriftReport,
} from "./check-actrc-sync.mjs"

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")

/** O manifesto do contrato de merge (fonte única dos checks obrigatórios). */
export const REQUIRED_CHECKS_MANIFEST = "ci/required-checks.json"

/** A pipeline DONA DO MERGE — de onde a bateria de guards é derivada. */
export const MERGE_OWNER_PIPELINE = `${GITEA_WORKFLOW_DIR}/ci.yml`

/** O job dessa pipeline cujos gates formam a bateria da forja. */
export const FORGE_GUARDS_JOB = "guards"

/**
 * O APLICADOR do contrato — a única implementação da comparação
 * manifesto ↔ branch protection registrada (ver `readProtection`).
 */
export const REQUIRED_CHECKS_APPLIER = "scripts/apply-required-checks.mjs"

/** Exit code do `runner-image:check` quando a tag NÃO existe (a única falha da forja). */
const IMAGE_MISSING = 4
/** Exit code do `runner-image:check` quando o env está ausente/inválido. */
const IMAGE_ENV_BAD = 2

const C = {
  reset: "\u001b[0m",
  red: "\u001b[0;31m",
  green: "\u001b[0;32m",
  yellow: "\u001b[1;33m",
  cyan: "\u001b[0;36m",
  gray: "\u001b[0;90m",
}
const color = (c, s) => (process.stdout.isTTY ? `${c}${s}${C.reset}` : s)

/** Marcadores de status do relatório — um só vocabulário para todas as seções. */
// Sem espaço à direita: o template sempre põe um depois do marcador.
const MARK = {
  ok: () => color(C.green, "✅"),
  fail: () => color(C.red, "❌"),
  warn: () => color(C.yellow, "⚠️"),
  info: () => color(C.cyan, "▸"),
  skip: () => color(C.gray, "·"),
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Descoberta (derivada da pipeline, nunca escrita à mão)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fatia UM job da pipeline, pela indentação de 2 espaços sob `jobs:`.
 *
 * POR QUE parser caseiro: o doctor roda com `node` puro, sem node_modules
 * (mesma restrição declarada em check-required-checks.mjs). A fidelidade é
 * garantida pelo teste que compara o resultado com a pipeline REAL.
 *
 * @param {string} content  conteúdo da pipeline
 * @param {string} jobId    id do job (ex.: 'guards')
 * @returns {string|null}   o bloco do job, ou null se ele não existir
 */
export function sliceJob(content, jobId) {
  const lines = content.split(/\r?\n/)
  const start = lines.findIndex((line) => new RegExp(`^  ${jobId}:\\s*$`).test(line))
  if (start === -1) return null

  const body = []
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]
    // Próximo job (mesmo nível) ou fim do bloco `jobs:` (coluna 0).
    // Comentário em coluna 0 NÃO encerra: ele pode estar no meio do job, e o
    // descobridor de gates já ignora comentários por conta própria.
    if (/^ {2}\S/.test(line)) break
    if (/^\S/.test(line) && line.trim() !== "" && !line.startsWith("#")) break
    body.push(line)
  }
  return body.join("\n")
}

/**
 * O comando declara MODO DE VERIFICAÇÃO? É a trava que impede o doctor de
 * executar um script na sua modalidade de EFEITO.
 *
 * POR QUE ISSO PRECISA EXISTIR (defeito real, cometido e depois corrigido): o
 * rótulo que o descobridor devolve para uma invocação direta é só o CAMINHO —
 * `bun scripts/rotate-secrets.mjs --check` vira o rótulo
 * `scripts/rotate-secrets.mjs`, com a flag descartada. Executar o rótulo como
 * comando roda o script SEM `--check`: no caso do rotate-secrets isso significa
 * PREPARAR UMA ROTAÇÃO DE SEGREDOS como efeito de rodar um relatório. O
 * comando tem de vir da LINHA da pipeline (que preserva as flags) e ainda
 * passar por esta trava.
 *
 * As marcas são as MESMAS que o check-forge-parity usa para chamar algo de
 * gate (`--check`/`--ci`, entrada `check:`/`validate:`/`test-mutation:`, script
 * com prefixo check-/validate-/audit-/test-mutation-/run-, `tsc`).
 *
 * @param {string} command
 * @returns {boolean}
 */
export function isVerificationCommand(command) {
  return [
    /--(?:check|ci|dry-run)\b/,
    /\b(?:check|validate|test-mutation):[a-z0-9-]+/,
    /(?:^|\/)(?:check|validate|audit|test-mutation|run)-[a-z0-9-]+\.(?:mjs|cjs|js|sh|bash)\b/,
    /(?:^|\s)tsc(?:\s|$)/,
  ].some((re) => re.test(command))
}

/**
 * Converte um COMANDO (a linha `run:` da pipeline, não o rótulo) no processo a
 * executar.
 *
 * Recusa comando com metacaracteres de shell em vez de "executar mesmo assim":
 * o doctor executa por lista de argumentos, não por shell, e adivinhar a
 * intenção seria pior que falhar alto.
 *
 * @param {string} command
 * @returns {{cmd: string, args: string[]}|{error: string}}
 */
export function gateCommand(command) {
  if (/["'`$|&;<>()\\*?]/.test(command)) {
    return {
      error: `comando de gate com caractere de shell não suportado: '${command}' — o doctor executa por lista de argumentos, não por shell`,
    }
  }
  if (!isVerificationCommand(command)) {
    return {
      error: `comando sem modo de verificação ('--check'/'--ci', entrada check:, ou script check-/validate-/audit-/run-): '${command}' — o doctor NÃO executa um gate na modalidade de efeito`,
    }
  }
  const parts = command.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { error: `comando de gate vazio` }

  // Invocação direta de script vem sem interpretador (`scripts/x.mjs`) — o
  // comando da pipeline tem `bun scripts/x.mjs`, mas se a linha não for achada
  // o fallback é o caminho cru. Reconstrói pela EXTENSÃO, que é como as
  // pipelines chamam (bun para .mjs/.js, bash para .sh/.bash).
  if (/\.(mjs|cjs|js)$/.test(parts[0])) return { cmd: "bun", args: parts }
  if (/\.(sh|bash)$/.test(parts[0])) return { cmd: "bash", args: parts }

  return { cmd: parts[0], args: parts.slice(1) }
}

/**
 * A linha `run:` que PRODUZIU o rótulo (preserva flags que o rótulo descarta).
 * Só considera linhas executáveis: comentário que menciona o script não é
 * comando (mesma regra dos outros guards do repo).
 *
 * @param {string[]} lines  linhas do job
 * @param {string} label
 * @returns {string|null}
 */
export function gateRunLine(lines, label) {
  for (const raw of lines) {
    const line = raw.trim()
    if (line.startsWith("#") || !line.includes(label)) continue
    // `- run: <cmd>` ou `run: <cmd>` — pega o que vem depois do marcador.
    const m = line.match(/^(?:-\s*)?run:\s*(.+)$/)
    if (m) return m[1].trim()
  }
  return null
}

/**
 * Os gates da bateria da forja, derivados da pipeline dona do merge.
 *
 * O CONJUNTO vem do descobridor do `check-forge-parity` (mesma classificação,
 * uma fonte só), mas o COMANDO vem da linha `run:` que o gerou — porque o
 * rótulo é uma identidade para classificar, não um comando executável (ele
 * descarta as flags; ver `isVerificationCommand`).
 *
 * @param {string} content  conteúdo de `.gitea/workflows/ci.yml`
 * @returns {{gates: {label: string, command: string|null}[], error?: string}}
 */
export function forgeGates(content) {
  const job = sliceJob(content, FORGE_GUARDS_JOB)
  if (job === null) {
    return {
      gates: [],
      error: `job '${FORGE_GUARDS_JOB}' não encontrado em ${MERGE_OWNER_PIPELINE} — a bateria da forja não tem de onde ser derivada`,
    }
  }
  const labels = discoverGates(job)
  if (labels.length === 0) {
    return {
      gates: [],
      error: `job '${FORGE_GUARDS_JOB}' existe mas não declara nenhum gate — a forja não estaria bloqueando nada`,
    }
  }
  const lines = job.split(/\r?\n/)
  return { gates: labels.map((label) => ({ label, command: gateRunLine(lines, label) })) }
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. Execução de um gate
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Roda um gate da bateria e devolve o resultado cru. `code === null` significa
 * que o processo não terminou (timeout/sinal) ou não pôde ser executado — que
 * NÃO é "passou".
 *
 * @param {{label: string, command: string|null}} gate
 * @param {{cwd?: string, timeoutS?: number, run?: Function}} [deps]
 * @returns {{gate: string, code: number|null, seconds: number, error?: string, tail?: string}}
 */
export function runGate(gate, { cwd = REPO_ROOT, timeoutS = 120, run = spawnSync } = {}) {
  const label = gate.label
  if (!gate.command) {
    return {
      gate: label,
      code: null,
      seconds: 0,
      error: `não achei a linha 'run:' que executa este gate em ${MERGE_OWNER_PIPELINE} — não executo o rótulo cru (sem as flags ele roda em modo de efeito)`,
    }
  }
  const parsed = gateCommand(gate.command)
  if (parsed.error) return { gate: label, code: null, seconds: 0, error: parsed.error }

  const started = Date.now()
  const res = run(parsed.cmd, parsed.args, {
    cwd,
    encoding: "utf8",
    timeout: timeoutS * 1000,
    env: process.env,
  })
  const seconds = (Date.now() - started) / 1000

  if (res.error) {
    // ENOENT (binário ausente) chega aqui — é "não executado", não "falhou".
    return { gate: label, code: null, seconds, error: res.error.message }
  }
  if (res.signal || res.status === null) {
    return {
      gate: label,
      code: null,
      seconds,
      error: `não terminou em ${timeoutS}s (timeout) — trate como NÃO verificado`,
    }
  }
  const out = `${res.stdout ?? ""}\n${res.stderr ?? ""}`.trim()
  return {
    gate: label,
    code: res.status,
    seconds,
    tail: res.status === 0 ? undefined : out.split("\n").slice(-12).join("\n"),
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. O veredito
// ═══════════════════════════════════════════════════════════════════════════

export const VERDICT = {
  READY: "pronta",
  BLOCKED: "bloqueada",
  UNKNOWN: "indeterminada",
}

/**
 * Junta os fatos num veredito.
 *
 * A REGRA, e por que ela não é "tudo verde = pronto": a pergunta é se o merge
 * pode ser CONFIADO à forja. Três coisas quebram isso, em ordens diferentes de
 * gravidade:
 *   - uma invariante FALHA     → o gate que existe vai reprovar PRs bons ou
 *                                aprovar PRs ruins: BLOQUEADA; *   - a imagem do runner não   → nenhum job INICIA (não é um gate vermelho, é a
 *     está no registry            fila inteira parada): BLOQUEADA;
 *   - a PROVA do bloqueio é    → a garantia da imagem é DECORATIVA: a subida da
 *     VIOLADA                     stack leva o runner ao ar sem a tag. BLOQUEADA,
 *                                 e mais grave que a imagem ausente — ali o
 *                                 remédio é publicar a imagem, aqui é consertar
 *                                 a própria subida;
 *   - algo não deu para        → não é falha, é ausência de prova. Não pode
 *     determinar                  virar "pronta" (seria a falsa segurança que
 *                                 o check-forge-parity foi escrito para matar)
 *                                 nem "bloqueada" (mentiria para o outro lado)
 *                                 → INDETERMINADA.
 *
 * @param {{contract: object, guards: object, image: object, proof: object, mirrors: object, openDebt?: object, skippedGuards?: boolean, skippedProof?: boolean, skippedOpenDebt?: boolean}} facts
 * @returns {{verdict: string, blockers: string[], unknowns: string[], unproven: string[]}}
 */
export function summarize(facts) {
  const blockers = []
  const unknowns = []

  for (const f of facts.contract.failures) blockers.push(f)
  if (facts.contract.unknown) unknowns.push(facts.contract.unknown)

  if (facts.skippedGuards) {
    // Pular a bateria NÃO pode dar PRONTA: seria dizer "pode confiar o merge"
    // sem ter olhado um gate sequer. É a falsa segurança que este comando
    // existe para não produzir.
    unknowns.push("os guards da forja foram pulados (--no-guards): o veredito não cobre os gates")
  } else {
    for (const g of facts.guards.results) {
      if (g.code === null) unknowns.push(`gate '${g.gate}' não foi verificado: ${g.error}`)
      else if (g.code !== 0) blockers.push(`gate '${g.gate}' FALHOU (exit ${g.code})`)
    }
    if (facts.guards.error) blockers.push(facts.guards.error)
  }

  if (facts.image.code === IMAGE_MISSING) {
    blockers.push(
      "imagem do runner AUSENTE no registry (exit 4): sem ela NENHUM job inicia — nenhum gate chega a rodar, e o PR não é bloqueado por invariante nenhuma",
    )
  } else if (facts.image.code === IMAGE_ENV_BAD) {
    // Ausência do env NÃO é evidência sobre a forja: o arquivo é gitignored e
    // mora no host de deploy. Falta de prova, não prova de falha.
    unknowns.push(
      `imagem do runner não checada: o env não existe neste checkout (exit ${facts.image.code}) — aponte --gitea-env para o env da forja para que o veredito cubra a imagem`,
    )
  } else if (facts.image.code !== 0) {
    unknowns.push(`imagem do runner não confirmada (exit ${facts.image.code})`)
  }
  // A prova do bloqueio: só a VIOLAÇÃO é defeito (a garantia existe no texto e
  // não no comportamento). Não conseguir rodá-la é ausência de prova — nunca
  // "pronta", pelo mesmo motivo de sempre.
  if (facts.skippedProof) {
    unknowns.push(
      "a prova do bloqueio foi pulada (--no-proof): o veredito não cobre se a subida da stack realmente exige a imagem",
    )
  } else if (facts.proof.status === "violated") {
    blockers.push(
      `a PROVA do bloqueio da imagem FALHOU (${facts.proof.detail}): com a tag ausente o runner SOBE — o pré-requisito da imagem é decorativo`,
    )
  } else if (facts.proof.status === "unavailable") {
    unknowns.push(`prova do bloqueio não executada: ${facts.proof.detail}`)
  }

  // A DÍVIDA ABERTA NO BOARD: uma issue de drift ABERTA é dívida não resolvida.
  // Ela não PROVA que a forja falha em bloquear o merge (quem mede isso são os
  // fatos acima), então não bloqueia — mas também não deixa o veredito PRONTA:
  // é exatamente a informação que vivia só no board, e uma dívida esquecida não
  // pode ser confundida com ausência de dívida.
  if (facts.skippedOpenDebt) {
    unknowns.push(
      "a dívida aberta no board foi pulada (--no-open-debt): o veredito não cobre as issues de drift que os crons JÁ abriram",
    )
  } else {
    for (const u of openDebtUnknowns(facts.openDebt)) unknowns.push(u)
  }

  // A interpolação do compose: variável vazia / valor literal BLOQUEIA (o
  // runner roda uma imagem que não é a declarada). Não conseguir renderizar é
  // ausência de prova — nunca "pronta".
  const compose = facts.compose
  if (compose?.state === "violated") {
    for (const v of compose.violations) blockers.push(v)
  } else if (compose && compose.state !== "proven" && compose.state !== "absent") {
    unknowns.push(`a interpolacao do compose da forja nao foi provada: ${compose.detail}`)
  }

  // A outra metade da invariante 7: o env do HOST × o template comitado. Só
  // faz sentido perguntar quando o render foi PROVADO (aí o compose existe e a
  // comparação estava ao alcance); sem o arquivo do host ela não aconteceu — o
  // VPS pode estar interpolando outra coisa, e isso é ausência de prova, nunca
  // "pronta".
  if (compose?.state === "proven" && compose.hostCompare?.state === "absent") {
    unknowns.push(
      `o env do HOST nao foi comparado com o template comitado: ${compose.hostCompare.detail}`,
    )
  }

  // O contrato REGISTRADO na forja (o branch protection de verdade): o
  // manifesto é a INTENÇÃO; isto é o que bloqueia o merge. Drift em qualquer
  // forja BLOQUEIA — nos dois sentidos (check exigido que não existe trava todo
  // PR para sempre; check do manifesto que não é exigido deixa o merge passar).
  if (facts.skippedProtection) {
    unknowns.push(
      "a branch protection REGISTRADA na forja foi pulada (--no-protection): o veredito não cobre o que de fato bloqueia o merge",
    )
  } else if (facts.protection?.state === "drift") {
    for (const b of protectionBlockers(facts.protection)) blockers.push(b)
  } else if (facts.protection && facts.protection.state !== "in-sync") {
    unknowns.push(`a branch protection REGISTRADA nao foi lida: ${facts.protection.detail}`)
  }

  // As referencias em configuracao NAO VERSIONADA: o que o repositorio NAO
  // contem (repository variables, env do host, o que o registry serve). Uma
  // violacao bloqueia; nao conseguir provar nunca vira "pronto".
  // O skip da consulta ao registry é declarado: sem ele, um fato "proven" que
  // pulou a única parte que olha a tag diria "pronta" com a pergunta em aberto.
  if (facts.skippedRegistryProbe) {
    unknowns.push(
      "a consulta ao registry foi pulada (--no-registry-probe): a tag que o repositorio declara nao foi conferida",
    )
  }
  const refs = facts.imageRefs
  if (refs?.state === "violated") {
    for (const v of refs.violations) blockers.push(v)
  } else if (refs && refs.state !== "proven") {
    // `absent` fica FORA do "pendente": e um arquivo gitignored que nao existe
    // neste checkout, nao uma referencia que deixou de ser provada. Listar os
    // dois juntos faria a lista de pendencia parecer maior do que e (e o
    // operador procurar um problema onde nao ha).
    const pending = (refs.items ?? [])
      .filter((i) => i.state === "indeterminate" || i.state === "violated")
      .map((i) => i.source)
      .join(" · ")
    unknowns.push(
      `as referencias NAO VERSIONADAS da imagem nao foram provadas: ${refs.detail}${pending ? ` [${pending}]` : ""}`,
    )
  }

  // O CONTRATO da imagem PUBLICADA: o build promete, o artefato prova. Violação
  // BLOQUEIA — é o job rodando uma imagem que não cumpre a promessa (sem o
  // plugin `compose`, com OUTRA versão do Bun, ou com o Bun fora do PATH) —, e
  // "não consegui rodar" (sem daemon, sem credencial, pull negado) é
  // INDETERMINADA: não poder provar não é acusação nem atestado.
  if (facts.skippedImageContract) {
    unknowns.push(
      "o contrato da imagem PUBLICADA foi pulado (--no-image-contract): o veredito não cobre se o artefato que o job baixa cumpre o contrato do build",
    )
  } else if (facts.imageContract?.state === "violated") {
    blockers.push(
      `o contrato da imagem PUBLICADA FALHOU (${facts.imageContract.detail}) — o job roda uma imagem que NAO cumpre a promessa do build`,
    )
  } else if (facts.imageContract && facts.imageContract.state !== "proven") {
    if (facts.imageContract.state !== "skipped") {
      unknowns.push(
        `o contrato da imagem PUBLICADA nao foi provado (${facts.imageContract.state}): ${facts.imageContract.detail}`,
      )
    }
  }

  // O REGISTRO do act_runner: o que GRAVOU é o que decide a imagem de cada job.
  // Violação BLOQUEIA (a forja roda os jobs numa imagem que não é a revisada, ou
  // não os roda em imagem nenhuma); "não consegui ler" é INDETERMINADA — nunca
  // "o registro está certo".
  if (facts.skippedRunnerLabels) {
    unknowns.push(
      "o registro do runner foi pulado (--no-runner-labels): o veredito não cobre quais labels o act_runner GRAVOU nem os do runner auto-hospedado do GitHub",
    )
  } else {
    if (facts.runnerLabels?.state === "violated") {
      for (const b of runnerLabelBlockers(facts.runnerLabels)) blockers.push(b)
    } else if (facts.runnerLabels && facts.runnerLabels.state !== "proven") {
      unknowns.push(
        `o registro do act_runner nao foi comparado com o compose (${facts.runnerLabels.state}): ${facts.runnerLabels.detail}`,
      )
    }
    // A OUTRA forja: o mesmo registro velho, e no GitHub ele não tem arquivo —
    // quem decide é a API. Mesmos estados, mesmos pesos: violação BLOQUEIA (o
    // runner que existe pega os jobs numa configuração que o repositório não
    // declara, ou não pega job nenhum), e o que não deu para ler é INDETERMINADA
    // (sem token de self-hosted runners o doctor não finge "em sincronia").
    if (facts.githubRunnerLabels?.state === "violated") {
      for (const b of githubRunnerLabelBlockers(facts.githubRunnerLabels)) blockers.push(b)
    } else if (facts.githubRunnerLabels && facts.githubRunnerLabels.state !== "proven") {
      unknowns.push(
        `o registro do runner do GitHub nao foi comparado com ${GITHUB_RUNNER_SCRIPT} (${facts.githubRunnerLabels.state}): ${facts.githubRunnerLabels.detail}`,
      )
    }
  }

  for (const m of facts.mirrors.blockers) blockers.push(m)
  for (const m of facts.mirrors.unknowns) unknowns.push(m)

  const verdict =
    blockers.length > 0 ? VERDICT.BLOCKED : unknowns.length > 0 ? VERDICT.UNKNOWN : VERDICT.READY

  const unproven = [
    `a PERMISSAO do token sobre a forja: o doctor lê a branch protection com o aplicador (${REQUIRED_CHECKS_APPLIER}) e, sem token de administração, ele diz "não lida" — nunca "em sincronia"`,
    "o smoke da forja: que o runner usa a imagem com o Bun da variable (tier-1 em runtime) — é um job da própria forja",
    "o deploy/.env.gitea do VPS: o doctor COMPARA o env do host com o template comitado (invariante 7b) quando o arquivo existe — o que ele nao alcanca daqui e o env de um host DIFERENTE deste checkout (`--gitea-env` aponta outro)",
    `o render do compose com o DOCKER DO RUNNER da forja: aqui o render é feito com ESTE docker (${GITEA_COMPOSE}). A imagem do job da forja EMBARCA o plugin \`compose\` — medido: a base catthehacker/ubuntu:act-latest entrega /usr/libexec/docker/cli-plugins/docker-compose, e o build do Dockerfile.ubuntu-bun FALHA se isso mudar — e o smoke exige o render (--require-compose). O que segue fora do alcance daqui é o socket do job: é a Prova 4 do smoke que o exercita, no host.`,
  ]
  if (facts.skippedGuards) unproven.unshift("os guards da forja (pulados por --no-guards)")
  if (facts.skippedProof) unproven.unshift("a prova do bloqueio da imagem (pulada por --no-proof)")
  if (facts.skippedRunnerLabels) {
    unproven.unshift(
      "o registro do act_runner e o do runner auto-hospedado do GitHub (pulados por --no-runner-labels)",
    )
  }
  if (facts.skippedImageContract) {
    unproven.unshift("o contrato da imagem PUBLICADA (pulado por --no-image-contract)")
  }
  if (facts.skippedProtection) {
    unproven.unshift("a branch protection REGISTRADA na forja (pulada por --no-protection)")
  }
  if (facts.skippedOpenDebt) {
    unproven.unshift("a dívida aberta no board (pulada por --no-open-debt)")
  }

  return { verdict, blockers, unknowns, unproven }
}

/**
 * O que a dívida aberta ACRESCENTA ao veredito: uma linha por leitura que não
 * aconteceu e uma por assunto com issue aberta.
 *
 * Por que cada assunto tem a PRÓPRIA linha (em vez de uma "há dívida aberta"
 * agregada): o leitor precisa do número da issue e de há quanto tempo ela está
 * aberta para agir — e "dívida há 47 dias" e "dívida de hoje" pedem decisões
 * diferentes.
 *
 * @param {object|undefined} debt
 * @returns {string[]}
 */
export function openDebtUnknowns(debt) {
  const unknowns = []
  if (!debt || debt.state === "skipped") return unknowns
  for (const read of debt.reads ?? []) {
    if (read.state !== "read") unknowns.push(read.detail)
  }
  for (const item of debt.items ?? []) unknowns.push(item.detail)
  return unknowns
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. Coleta dos fatos
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Lê o contrato de merge: cada forja do manifesto, com workflow existente e a
 * contagem de jobs obrigatórios.
 */
export function readContract(cwd = REPO_ROOT) {
  const path = join(cwd, REQUIRED_CHECKS_MANIFEST)
  if (!existsSync(path)) {
    return { forges: [], failures: [`${REQUIRED_CHECKS_MANIFEST}: ausente`], unknown: null }
  }
  let manifest
  try {
    manifest = JSON.parse(readFileSync(path, "utf8"))
  } catch (err) {
    return {
      forges: [],
      failures: [`${REQUIRED_CHECKS_MANIFEST}: JSON inválido (${err.message})`],
      unknown: null,
    }
  }

  const failures = []
  const forges = []
  for (const [forge, cfg] of Object.entries(manifest.forges ?? {})) {
    const jobs = cfg.jobs ?? []
    const exists = existsSync(join(cwd, cfg.workflow))
    if (!exists) failures.push(`${forge}: workflow obrigatório ausente (${cfg.workflow})`)
    if (jobs.length === 0) failures.push(`${forge}: nenhum job obrigatório no manifesto`)
    forges.push({ forge, workflow: cfg.workflow, jobs: jobs.length, exists })
  }
  if (forges.length === 0) failures.push(`${REQUIRED_CHECKS_MANIFEST}: nenhuma forja declarada`)
  return { forges, failures, unknown: null }
}

/**
 * O OUTRO LADO do contrato de merge: o que a FORJA REGISTRA.
 *
 * POR QUE ESTE FATO EXISTE: a seção 1 prova que o manifesto é válido e aponta
 * para jobs que existem; ela NÃO prova que a forja exige aqueles checks. Quem
 * bloqueia o merge é a branch protection — estado da forja, invisível em review
 * —, e o modo de falha é o pior: o `name:` de um job renomeado muda o CONTEXTO
 * de status, o manifesto passa a exigir um check que nunca roda e o PR trava
 * PARA SEMPRE. Nenhum teste de PR enxerga isso: no PR o job novo existe e passa.
 *
 * DE ONDE VEM A VERDADE: de `scripts/apply-required-checks.mjs --check --json`,
 * o MESMO comando que o cron de drift usa nos dois lados
 * (`required-checks-drift.yml`). Nada de uma segunda comparação aqui: o
 * aplicador é o dono da regra (contextos resolvidos do manifesto, credencial por
 * forja, drift por branch) e devolve o relatório em JSON. Um segundo comparador
 * divergiria do primeiro justamente no dia do drift — o defeito que este
 * repositório persegue.
 *
 * O QUE O TOKEN PRECISA: permissão de ADMINISTRAÇÃO no repo (PAT clássico com
 * scope `repo`, ou fine-grained com 'Administration: read'). O `GITHUB_TOKEN`
 * padrão NÃO tem esse escopo — e por isso "não consegui ler" é estado PRÓPRIO
 * (`unavailable`), nunca "em sincronia". O cron semanal pula com um `::notice::`;
 * aqui não ler significa NÃO PROVADO.
 *
 * @param {{cwd?: string, forges?: string[], run?: Function, nodePath?: string}} [args]
 * @returns {{state: "in-sync"|"drift"|"unavailable", detail: string, forges: object[]}}
 */
export function readProtection({
  cwd = REPO_ROOT,
  forges = [],
  run = spawnSync,
  nodePath = process.execPath,
} = {}) {
  const reads = forges.map((forge) => readForgeProtection({ cwd, forge, run, nodePath }))
  return { ...summarizeProtection(reads), forges: reads }
}

/** Executa o aplicador para UMA forja e interpreta o relatório JSON. */
function readForgeProtection({ cwd, forge, run, nodePath }) {
  const args = [REQUIRED_CHECKS_APPLIER, "--check", "--forge", forge, "--json"]
  const res = run(nodePath, args, { cwd, encoding: "utf8", timeout: 60_000, env: process.env })
  const empty = { forge, state: "unavailable", desired: 0, branches: [], missing: [], extra: [] }

  if (res.error) {
    return { ...empty, detail: `nao consegui executar o aplicador (${res.error.message})` }
  }
  if (res.signal || res.status === null) {
    return { ...empty, detail: "o aplicador nao terminou em 60s — trate como NAO verificado" }
  }

  let report = null
  try {
    report = JSON.parse(String(res.stdout ?? ""))
  } catch {
    report = null
  }
  const errors = report?.errors ?? []
  if (errors.length > 0) {
    // Falta de credencial/rede NÃO é evidência sobre a forja: é ausência de prova.
    return { ...empty, detail: errors.map((e) => e.message).join("; ") }
  }
  const data = report?.forges?.[forge]
  if (!data) {
    return { ...empty, detail: `o aplicador nao reportou a forja '${forge}' (exit ${res.status})` }
  }

  const desired = data.desired?.length ?? 0
  const branches = (data.branches ?? []).map((b) => ({
    branch: b.branch,
    configured: b.configured === true,
    missing: b.missing ?? [],
    extra: b.extra ?? [],
  }))
  const missing = [...new Set(branches.flatMap((b) => b.missing))]
  const extra = [...new Set(branches.flatMap((b) => b.extra))]
  // O veredito do APLICADOR manda: se ele diz drift e a derivação acima não viu
  // nada, ainda é drift (e a mensagem diz que veio dele).
  const drift = missing.length > 0 || extra.length > 0 || report.drift === true
  return {
    forge,
    state: drift ? "drift" : "in-sync",
    desired,
    branches,
    missing,
    extra,
    detail: describeProtection({
      branches,
      desired,
      missing,
      extra,
      flagged: report.drift === true,
    }),
  }
}

/**
 * Uma frase por branch, dita em termos do que o operador precisa fazer. A
 * AUSÊNCIA de proteção é o caso mais grave (nenhum check bloqueia nada) e tem
 * mensagem própria — "0 de N exigidos" não é o mesmo que "falta um".
 */
function describeProtection({ branches, desired, missing, extra, flagged }) {
  if (branches.length === 0) return "nenhuma branch reportada pelo aplicador"
  const parts = branches.map((b) => {
    if (!b.configured) {
      return `${b.branch} NAO tem protecao registrada (0 de ${desired} check(s) exigidos) — nenhum check bloqueia o merge`
    }
    if (b.missing.length === 0 && b.extra.length === 0) {
      return `${b.branch} exige os ${desired} check(s) do manifesto`
    }
    const bits = []
    if (b.missing.length > 0) bits.push(`falta(m) ${b.missing.map((c) => `'${c}'`).join(", ")}`)
    if (b.extra.length > 0) bits.push(`sobra(m) ${b.extra.map((c) => `'${c}'`).join(", ")}`)
    return `${b.branch} exige ${desired - b.missing.length} de ${desired} check(s): ${bits.join(" · ")}`
  })
  if (flagged && missing.length === 0 && extra.length === 0) {
    parts.push("o aplicador reportou drift sem nomear contexto")
  }
  return parts.join(" · ")
}

/** O estado AGREGADO: um drift em qualquer forja domina; depois, falta de prova. */
function summarizeProtection(reads) {
  if (reads.length === 0) {
    return {
      state: "unavailable",
      detail: `${REQUIRED_CHECKS_MANIFEST} nao declara forja nenhuma — nao ha o que comparar com a forja`,
    }
  }
  const line = (r) => `${r.forge}: ${r.detail}`
  if (reads.some((r) => r.state === "drift")) {
    return { state: "drift", detail: reads.map(line).join(" · ") }
  }
  if (reads.some((r) => r.state !== "in-sync")) {
    return { state: "unavailable", detail: reads.map(line).join(" · ") }
  }
  return { state: "in-sync", detail: reads.map(line).join(" · ") }
}

/**
 * As mensagens de BLOQUEIO do contrato REGISTRADO — o que o veredito consome, e
 * por isso exportado (o teste trava a frase que o operador lê).
 */
export function protectionBlockers(protection) {
  return (protection?.forges ?? [])
    .filter((f) => f.state === "drift")
    .map(
      (f) =>
        `branch protection REGISTRADA no ${f.forge} divergiu de ${REQUIRED_CHECKS_MANIFEST}: ${f.detail}. Remédio: bun run ci:required-checks -- --apply (o manifesto é a fonte; a forja é quem obedece)`,
    )
}

/**
 * O bloqueio do REGISTRO do runner, com a localização do arquivo lido e o
 * remédio do próprio guard.
 *
 * Um bloqueio só, e não um por divergência: todas as linhas do guard descrevem o
 * MESMO problema (o registro não é o do compose) e o veredito lê melhor com uma
 * frase que nomeia onde o arquivo está do que com N repetições do mesmo juízo.
 *
 * @param {object} labels
 * @returns {string[]}
 */
export function runnerLabelBlockers(labels) {
  const where = labels?.container
    ? `${labels.container} · ${labels.stateFile}`
    : "o registro do runner"
  const remedies = (labels?.remedies ?? []).join(" ")
  return [
    `o registro do act_runner NAO é o do compose (${labels?.detail}): ${where} x ${GITEA_COMPOSE} — ${(labels?.violations ?? []).join(" · ")}${remedies ? ` ${remedies}` : ""}`,
  ]
}

/**
 * As referencias da imagem que vivem em configuracao NAO VERSIONADA
 * (repository variables, env do host, o que o registry serve para a tag).
 *
 * POR QUE E UM FATO PROPRIO: nenhuma delas esta no repositorio — e por isso
 * mesmo nao da para "ler e concluir". O guard devolve um tri-estado por
 * referencia (`proven` / `indeterminate` / `violated`), e este fato so o
 * transporta para o veredito: VIOLACAO bloqueia; INDETERMINADO nunca vira
 * "pronto" — e o que o doctor chama de nao provado.
 *
 * `deps` e a fronteira de dependencia do teste (`env` e `probe`: o ambiente do
 * processo e a consulta ao registry).
 *
 * @param {{cwd?: string, envFile?: string, deps?: object}} [args]
 * @returns {Promise<{state: string, items: {source: string, state: string, detail: string}[], violations: string[], detail: string}>}
 */
export async function readImageRefs({
  cwd = REPO_ROOT,
  envFile = DEFAULT_ENV_FILE,
  deps = {},
} = {}) {
  try {
    return await checkNonVersionedImageRefs({ root: cwd, hostEnv: envFile, ...deps })
  } catch (err) {
    // Um fato nunca derruba o doctor: se a propria avaliacao falhou, isso e
    // ausencia de prova (INDETERMINADA), nao "esta tudo certo".
    return {
      state: "unavailable",
      items: [],
      violations: [],
      detail: `nao foi possivel avaliar as referencias nao versionadas: ${err?.message ?? String(err)}`,
    }
  }
}

/**
 * Os espelhos da versão do Bun concordam com o que o repositório DECLARA?
 *
 * SÃO DUAS PERGUNTAS, e a segunda é a que faltava aqui:
 *   1. os arquivos locais existem e concordam entre si? (sem rede, sempre possível)
 *   2. cada um bate com o VALOR de `vars.BUN_VERSION`? (só com `--expected`: o
 *      valor da variável não existe no checkout, ele vive no Actions)
 *
 * A pergunta 2 é a MESMA do guard periódico (`check-actrc-sync.mjs`, job semanal
 * `actrc-sync`) — e por isso NÃO é reimplementada: este fato chama
 * `mirrorDriftReport`, a função que o guard, o CLI dele e o publicador de issue
 * já compartilham. A descoberta dos arquivos (template comitado + o `.env.gitea`
 * do host quando existe, ou o `--gitea-env` apontado) e a leitura dos valores
 * vêm de lá; uma segunda comparação aqui divergiria da primeira justamente no
 * dia do drift.
 *
 * SEM `--expected` o que resta é a pergunta 1 — e ela é MAIS FRACA do que
 * parece: dois espelhos que concordam entre si podem estar os DOIS velhos em
 * relação à variável. É exatamente assim que o fast path de 0s do tier-1
 * desliga na forja sem nenhum sintoma. Então, sem o valor, o doctor diz que o
 * VALOR não foi comparado — em vez de chamar de "em sincronia" o que só provou
 * existir.
 *
 * A GRAVIDADE É DIFERENTE PARA CADA ESPELHO, e misturar os dois seria mentir:
 *   - o env da forja (`deploy/env.gitea.example`, e o `.env.gitea` do host)
 *     alimenta a label do runner: ausente, a forja não sabe QUAL imagem rodar →
 *     BLOQUEIA (é config da forja); divergente do valor declarado, o runner
 *     roda OUTRA imagem → BLOQUEIA também (o tier-1 desliga em silêncio e o
 *     setup funciona igual, só mais lento);
 *   - `.actrc` é o espelho do act LOCAL: divergir dele não impede a forja de
 *     bloquear merge nenhum — incomoda quem roda act na máquina → NÃO PROVADO.
 *
 * @param {string} [cwd]
 * @param {{expected?: string|null, envPath?: string|null}} [options]
 *   `expected`: valor de `vars.BUN_VERSION` (null = não perguntado — o VERDITO
 *   do valor não foi feito); `envPath`: o env de um host específico
 *   (`--gitea-env`), que SUBSTITUI a descoberta como no CLI do guard (para
 *   inquirir OUTRO host). O doctor NÃO usa esta opção de propósito: ele quer o
 *   template comitado E o host do checkout, e passar um caminho largaria o
 *   template fora da comparação. O valor de outro host entra pela invariante
 *   7b (host x template), que compara o env inteiro.
 * @returns {{actrc: string|null, env: string|null, expected: string|null, mirrors: object[], warnings: string[], blockers: string[], unknowns: string[]}}
 */
export function readMirrors(cwd = REPO_ROOT, { expected = null, envPath = null } = {}) {
  const blockers = []
  const unknowns = []

  const envFile = join(cwd, GITEA_ENV_MIRROR)
  const env = existsSync(envFile) ? extractEnvMirrorBunVersion(readFileSync(envFile, "utf8")) : null
  if (env === null) {
    blockers.push(
      `${GITEA_ENV_MIRROR} ausente ou sem BUN_VERSION — é ele que alimenta a label do runner: sem ele a forja não sabe qual imagem rodar`,
    )
  }

  const actrcPath = join(cwd, ".actrc")
  const actrc = existsSync(actrcPath)
    ? extractActrcBunVersion(readFileSync(actrcPath, "utf8"))
    : null

  // Sem o valor da variável não há como dizer se o espelho está certo: o que se
  // pode dizer é que os dois entre si divergem (um dos dois está velho) e que a
  // pergunta do VALOR continua aberta.
  if (expected === null) {
    if (actrc === null) {
      unknowns.push(".actrc ausente ou sem BUN_VERSION — o act local rodaria sem versão")
    } else if (env !== null && actrc !== env) {
      unknowns.push(
        `os espelhos locais divergem: .actrc='${actrc}' vs ${GITEA_ENV_MIRROR}='${env}' — um dos dois está velho, e qual é o certo só a repository variable diz`,
      )
    }
    unknowns.push(
      `o VALOR dos espelhos NAO foi comparado com vars.BUN_VERSION: a variável vive no Actions, não no checkout — passe --expected <versão> (ou, com credencial: --expected "$(gh variable get BUN_VERSION)"). Existência e concordância local não provam que o runner roda a versão declarada`,
    )
    return { actrc, env, expected, mirrors: [], warnings: [], blockers, unknowns }
  }

  // O env de um host apontado só entra quando EXISTE: o `mirrorDriftReport` lê o
  // arquivo sem checar (o CLI do guard trata a ausência como erro de uso), e um
  // doctor que estoura num fato não é um doctor. A ausência do arquivo já é
  // reportada na seção da imagem, que lê o MESMO `--gitea-env`.
  const host = envPath && existsSync(envPath) ? envPath : null
  const report = mirrorDriftReport({ cwd, expected, ...(host ? { envPath: host } : {}) })

  for (const mirror of report.mirrors) {
    if (mirror.version === expected) continue
    const kind = mirror.deployed ? "o env DESTE host" : "o template comitado"
    blockers.push(
      `${mirror.label} define BUN_VERSION='${mirror.version ?? "ausente"}' mas vars.BUN_VERSION='${expected}' — é ${kind} que alimenta a label do runner: o runner roda uma imagem com OUTRA versão do Bun e o fast path de 0s do tier-1 desliga em silêncio (o setup funciona igual, só mais lento). Remédio: bash scripts/bump-bun.sh ${expected}${mirror.deployed ? ", e re-registre o runner: bash deploy/gitea-up.sh --re-register" : ""}`,
    )
  }

  if (report.actrcVersion !== expected) {
    unknowns.push(
      `.actrc define BUN_VERSION='${report.actrcVersion ?? "ausente"}' mas vars.BUN_VERSION='${expected}' — o act LOCAL testa outra versão (não é o merge, é a dev experience da máquina). Remédio: bash scripts/bump-bun.sh ${expected} (escreve a variável, o .actrc e o template de uma vez)`,
    )
  }

  return {
    actrc,
    env,
    expected,
    mirrors: report.mirrors,
    // Os avisos do GUARD, no texto dele: o log do doctor e a issue do job semanal
    // não podem discordar, e é isso que a fonte única garante.
    warnings: report.warnings,
    blockers,
    unknowns,
  }
}

/** Roda o check da imagem (NUNCA publica) e guarda as linhas que ele emitiu. */
export async function readImage({ envFile = DEFAULT_ENV_FILE, cwd = REPO_ROOT, deps = {} } = {}) {
  // (o `readImageContract` logo abaixo consome o `ref` resolvido aqui)
  const lines = []
  const emit = {
    pass: (m) => lines.push(`✅ ${m}`),
    fail: (m) => lines.push(`❌ ${m}`),
    warn: (m) => lines.push(`⚠️  ${m}`),
    info: (m) => lines.push(`▸  ${m}`),
    plain: (m = "") => lines.push(m),
  }
  // `emit` por ÚLTIMO: as dependências injetadas são para o fetch/exec, nunca
  // para trocar o coletor de linhas (senão a saída do check sumiria do relatório).
  const res = await ensureRunnerImage({ check: true, envFile, cwd, ...deps, emit })
  return { code: res.code, ref: res.ref, state: res.state, detail: res.detail, lines }
}

/**
 * O CONTRATO DA IMAGEM PUBLICADA — o que o build promete x o que a forja BAIXA.
 *
 * POR QUE O BUILD NÃO BASTA: o pin por digest, o bloco fail-closed e as mutações
 * falhando provam o ARQUIVO e o bloco dele. Todas seguem verdadeiras se a imagem
 * que o registry serve for OUTRA build — e é essa que o job baixa. Aqui o alvo é
 * o DIGEST que a tag serve hoje (não a tag: rodar por tag provaria o cache DESTA
 * máquina) e quem decide é o MESMO bloco do Dockerfile, executado DENTRO do
 * artefato: plugin `compose`, versão do Bun e o caminho resolvido.
 *
 * A RESOLUÇÃO DO DIGEST sai do MESMO probe do invariante 9
 * (`probeImageIdentity`), com a credencial do ambiente: sem ela o pacote privado
 * responde 401 e o fato é INDETERMINADA — nunca "o contrato está certo".
 *
 * O `expected` é o valor de `vars.BUN_VERSION` (`--expected`) e, sem ele, a TAG
 * que o compose declara (o env do runner é a fonte do ref): a comparação do
 * valor entre os dois é do fato dos espelhos; aqui a pergunta é se a IMAGEM roda
 * a versão que ela promete.
 *
 * @param {{image?: {ref?: string|null}, expected?: string|null, cwd?: string, env?: Record<string, string>, deps?: object}} [args]
 * @returns {Promise<{state: string, detail: string, ref: string|null, digest: string|null, target: string|null, expectedVersion: string|null, findings: object|null, remedies: string[]}>}
 */
export async function readImageContract({
  image = {},
  expected = null,
  cwd = REPO_ROOT,
  env = {},
  deps = {},
} = {}) {
  const ref = image?.ref ?? null
  if (!ref) {
    return {
      state: "unavailable",
      detail:
        "a imagem declarada nao foi resolvida (env do runner ausente/invalido): nao ha artefato a provar contra o registry",
      ref: null,
      digest: null,
      target: null,
      expectedVersion: expected,
      findings: null,
      remedies: [],
    }
  }
  const tag = ref.slice(ref.lastIndexOf(":") + 1)
  const expectedVersion = expected ?? tag
  const result = await checkPublishedImageContract({
    ref,
    expectedVersion,
    credentials: credentialsFromEnv(env),
    cwd,
    ...deps,
  })
  return { ...result, expectedVersion, ref }
}

/**

/**
 * A prova do bloqueio: EXECUTA o `deploy/gitea-up.sh` real contra um registry de
 * TESTE (127.0.0.1) e afirma sobre o log do docker dublê — com a tag ausente o
 * runner não sobe, com a tag presente sobe. Inclui a família do `--re-register`,
 * que tem um risco PRÓPRIO: ele apaga o registro gravado antes de subir, então a
 * prova exige que a falha da garantia não destrua nada, que a ordem seja
 * `rm` → `volume rm` → `up -d runner` e que um registro que não sai não deixe o
 * runner subir com os labels antigos.
 *
 * POR QUE ISTO É UM FATO DO VEREDITO e não uma nota de rodapé: o doctor podia
 * dizer "imagem garantida" com base apenas na EXISTÊNCIA da tag agora. Isso
 * responde "dá para puxar?", não "a subida depende disso?". A prova responde a
 * segunda — e se ela falhar, o remédio não é publicar imagem nenhuma: é
 * consertar a subida.
 *
 * Nunca lança: `unavailable` (sem bash, sem o bring-up) é um estado próprio,
 * distinto de falha, porque ausência de prova não é prova de falha.
 */
export async function readProof({ cwd = REPO_ROOT, deps = {} } = {}) {
  // `prove` é o ponto de injeção: o teste do doctor precisa dos TRÊS estados
  // (segura/violada/indisponível) sem montar um registry e um docker dublê
  // dentro do teste do AGREGADOR — a prova em si tem o próprio arquivo de teste.
  const { prove = proveRunnerImageGate, ...rest } = deps
  try {
    const res = await prove({ cwd, ...rest })
    return { status: res.status, ok: res.ok, detail: res.detail, cases: res.cases }
  } catch (err) {
    return {
      status: "unavailable",
      ok: false,
      detail: `a prova não pôde rodar: ${err?.message ?? String(err)}`,
      cases: [],
    }
  }
}

/**
 * O REGISTRO do act_runner (`/data/.runner`) × o que o compose declara.
 *
 * POR QUE É UM FATO DO VEREDITO e não uma nota de rodapé: o render prova o que o
 * compose PEDE; nada aqui prova o que o runner GRAVOU — e é o gravado que decide
 * a imagem de todo job. Os labels são ESTADO (vivem no volume, enviados à
 * instância no registro, nunca relidos do compose): um `up -d runner` recria o
 * container com o env novo e deixa o registro velho no lugar. O sintoma é o pior
 * tipo: o job roda, o setup funciona, os testes passam — na imagem antiga, sem o
 * tier-1. Um registro VAZIO é o caso extremo: runner órfão, nenhum job atribuído
 * a ele.
 *
 * NÃO reimplementa nada: chama `checkRunnerLabels` (o MESMO guard da Prova 5 do
 * smoke, com o mesmo exit code) — um segundo comparador divergiria do primeiro
 * justamente no dia do registro velho.
 *
 * Estados, e a diferença entre eles é o ponto: `proven` (é o do compose),
 * `violated` (registro velho/vazio, ou compose sem os labels ⇒ BLOQUEIA) e
 * `unavailable`/`env-missing` (sem docker, sem socket, sem container, registro
 * ilegível ⇒ NÃO PROVADO). Nunca lança: ausência de prova não é prova de falha.
 *
 * `deps` é a fronteira de dependência do teste (`check` e o `run` do guard).
 */
export function readRunnerLabels({ cwd = REPO_ROOT, envFile = null, deps = {} } = {}) {
  const { check = checkRunnerLabels, ...rest } = deps
  const empty = {
    violations: [],
    remedies: [],
    declared: [],
    registered: [],
    container: null,
    stateFile: null,
  }
  try {
    const res = check({ cwd, envFile, ...rest })
    return {
      state: res.state,
      violations: res.violations ?? [],
      remedies: res.remedies ?? [],
      detail: res.detail,
      declared: res.declared ?? [],
      registered: res.registered ?? [],
      container: res.container ?? null,
      stateFile: res.stateFile ?? null,
    }
  } catch (err) {
    return {
      ...empty,
      state: "unavailable",
      detail: `o registro do act_runner nao pode ser lido: ${err?.message ?? String(err)}`,
    }
  }
}

/**
 * O REGISTRO do runner AUTO-HOSPEDADO DO GITHUB — a outra forja, o MESMO
 * registro velho, e aqui ele é invisível por CONSTRUÇÃO.
 *
 * POR QUE É UM FATO PRÓPRIO E NÃO UMA VARIAÇÃO DO ANTERIOR: a leitura não tem
 * nada em comum com a da forja. O act_runner grava os labels no volume
 * (`/data/.runner`, aliás `docker exec`); o runner do GitHub NÃO grava label
 * nenhum (o `.runner` do actions/runner guarda AgentId/AgentName/PoolName/
 * ServerUrl — nenhum campo de labels): o registro vive no SERVIDOR, e quem o lê
 * é a API. Mesmos estados, mesmos remédios — a origem é outra.
 *
 * Não reimplementa nada: chama `checkGithubRunnerLabels` (o MESMO código do
 * CLI `--forge github`). `violated` BLOQUEIA (o runner registrado pega os jobs
 * numa configuração que o repositório não declara — ou não pega job nenhum, se
 * o registro está vazio, ou o runner declarado não existe/está offline) e
 * `unavailable`/`env-missing` são NÃO PROVADO (sem token de self-hosted runners
 * ou sem repo, o doctor não finge "em sincronia"). Nunca lança: ausência de
 * prova não é prova de falha.
 *
 * `deps` é a fronteira de dependência do teste (`check`).
 */
export async function readGithubRunnerLabels({
  cwd = REPO_ROOT,
  env = process.env,
  deps = {},
} = {}) {
  const { check = checkGithubRunnerLabels, ...rest } = deps
  const empty = {
    violations: [],
    remedies: [],
    declared: [],
    registered: [],
    runner: null,
    status: null,
    repo: null,
  }
  try {
    const res = await check({ cwd, env, ...rest })
    return {
      state: res.state,
      violations: res.violations ?? [],
      remedies: res.remedies ?? [],
      detail: res.detail,
      declared: res.declared ?? [],
      registered: res.registered ?? [],
      runner: res.runner ?? null,
      status: res.status ?? null,
      repo: res.repo ?? null,
    }
  } catch (err) {
    return {
      ...empty,
      state: "unavailable",
      detail: `o registro do runner do GitHub nao pode ser lido: ${err?.message ?? String(err)}`,
    }
  }
}

/**
 * O bloqueio do REGISTRO do runner do GitHub, com o runner lido e o remédio.
 *
 * Um bloqueio só, pelo mesmo motivo do `runnerLabelBlockers`: todas as linhas do
 * guard descrevem o MESMO problema (o registro não é o do setup) e
 * `violations.length` tem de continuar significando "quantos problemas existem".
 *
 * @param {object} labels
 * @returns {string[]}
 */
export function githubRunnerLabelBlockers(labels) {
  const where = labels?.runner
    ? `runner '${labels.runner}' (${labels.status}) · repos/${labels.repo}/actions/runners`
    : `repos/${labels?.repo}/actions/runners`
  const remedies = (labels?.remedies ?? []).join(" ")
  return [
    `o registro do runner do GITHUB NAO é o que o setup declara (${labels?.detail}): ${where} x ${GITHUB_RUNNER_SCRIPT} — ${(labels?.violations ?? []).join(" · ")}${remedies ? ` ${remedies}` : ""}`,
  ]
}

// ═══════════════════════════════════════════════════════════════════════════
// 4b. A dívida ABERTA no board
// ═══════════════════════════════════════════════════════════════════════════

/** As forjas cujo board pode carregar dívida (a forja primeiro: é ela a dona do merge). */
const DEBT_FORGES = ["gitea", "github"]

/** Um dia em ms — a IDADE da dívida é o que separa a ativa da esquecida. */
const MS_PER_DAY = 86_400_000

/**
 * Os ASSUNTOS de dívida que o board carrega: uma label por publicador de issue
 * deste repositório, com o marcador que identifica QUEM a escreveu.
 *
 * POR QUE UMA LISTA EXPLÍCITA (e não "toda issue aberta"): o board tem issue de
 * produto, de cliente, de ideia — lê-las como dívida de forja encheria o veredito
 * de ruído alheio, e um alerta que sempre acende é um alerta que ninguém lê. A
 * lista é a de quem ABRE alerta por cron, e o `markerId` é o que separa o que é
 * NOSSO do que ganhou a etiqueta à mão.
 *
 * A FONTE desta lista são os próprios publicadores (`ISSUE_LABEL` + o marcador de
 * cada um): um teste percorre `scripts/*-issue.mjs` e FALHA se uma label nova não
 * estiver aqui — a dívida de um cron novo não pode nascer invisível para a
 * prontidão (que é o defeito que este fato existe para matar).
 *
 * `crossCheck` diz se o doctor MEDE o mesmo assunto por conta própria (e então
 * pode dizer se a issue caducou, o outro lado da mesma moeda): `protection` e
 * `mirrors` são fatos deste relatório; `null` é assunto que só o publicador vê.
 * `forges` diz ONDE a label existe — ler a forja errada devolveria vazio e o
 * vazio passaria por "sem dívida".
 */
export const DEBT_SUBJECTS = [
  {
    label: "required-checks-drift",
    markerId: "required-checks-drift",
    subject: "a branch protection REGISTRADA divergiu do manifesto de required checks",
    forges: ["gitea", "github"],
    crossCheck: "protection",
  },
  {
    label: "actrc-sync-drift",
    markerId: "actrc-sync-drift",
    subject: "os espelhos do BUN_VERSION divergiram da repository variable",
    forges: ["github"],
    crossCheck: "mirrors",
  },
  {
    label: "readme-drift",
    markerId: "readme-drift",
    subject: "a auditoria reversa do README achou um alvo que o repositório não serve mais",
    forges: ["github"],
    crossCheck: null,
  },
  {
    label: "mutation-trend-drift",
    markerId: "mutation-trend-drift",
    subject: "o overhead da suíte passou do limiar (tendência ou timing)",
    forges: ["github"],
    crossCheck: null,
  },
]

/**
 * A label que fica FORA da leitura — e a razão, dita para não parecer esquecimento.
 *
 * É a saída DESTE comando: uma issue de veredito aberta existe porque o veredito
 * não é PRONTA. Lê-la como dívida faria o doctor alimentar o próprio alerta —
 * INDETERMINADA para sempre, por construção, e a decisão de publicar nunca mais
 * voltaria a ser PRONTA nem depois de tudo resolvido. O ciclo do veredito é
 * fechado pelo PUBLICADOR (que a abre e comenta), não pelo diagnóstico.
 */
export const DEBT_EXCLUDED = {
  label: "forge-doctor-verdict",
  why: "é a saída DESTE comando: ler o próprio veredito como dívida faria o doctor se alimentar",
}

/**
 * A idade da issue, em dias, a partir do `createdAt` que o backend devolve.
 *
 * `days: null` quando a forja não deu a data — e não `0`, que se confundiria com
 * "aberta hoje". O que não se sabe não vira número.
 */
function debtIssue(issue, nowMs) {
  const createdAt = issue?.createdAt ?? null
  const ts = createdAt ? Date.parse(createdAt) : Number.NaN
  return {
    number: issue?.number ?? null,
    title: issue?.title ?? "",
    createdAt,
    days: Number.isFinite(ts) ? Math.max(0, Math.floor((nowMs - ts) / MS_PER_DAY)) : null,
  }
}

/**
 * A CADUCIDADE da issue: o doctor mede o mesmo assunto por conta própria?
 *
 * Três respostas, e nenhuma delas é um palpite: `true` (o doctor mede o assunto
 * e ele está limpo AGORA — a issue provavelmente fala de um problema que já se
 * foi), `false` (o doctor mede e o problema CONTINUA — a issue está certa) e
 * `null` (o doctor NÃO mede esse assunto, ou não conseguiu medir nesta run: não
 * dá para declarar caducidade daqui). `null` nunca vira `true`: dizer "caducou"
 * sobre o que não se mediu é a dívida que mente, do outro lado.
 */
function debtStaleness(subject, forge, { protection, mirrors }) {
  if (subject.crossCheck === "protection") {
    const read = (protection?.forges ?? []).find((f) => f.forge === forge)
    if (!read) {
      return {
        stale: null,
        detail: `o doctor não leu a branch protection do ${forge} nesta run`,
      }
    }
    if (read.state === "in-sync") {
      return {
        stale: true,
        detail: `o doctor mede a branch protection do ${forge} EM SINCRONIA com ${REQUIRED_CHECKS_MANIFEST} — a issue fala de um problema que já não se vê (o publicador a fecha por assinatura quando o drift some)`,
      }
    }
    return {
      stale: false,
      detail: `o doctor também mede a branch protection do ${forge} e ela NÃO está em sincronia (${read.state}) — a issue fala de um problema VIVO`,
    }
  }

  if (subject.crossCheck === "mirrors") {
    if (!mirrors?.expected) {
      return {
        stale: null,
        detail:
          "o VALOR dos espelhos não foi comparado nesta run (sem --expected) — o doctor não pode declarar a issue caducada",
      }
    }
    const clean = (mirrors.blockers?.length ?? 0) === 0 && (mirrors.unknowns?.length ?? 0) === 0
    return clean
      ? {
          stale: true,
          detail: `o doctor mede os espelhos do BUN_VERSION em concordância com a variable '${mirrors.expected}'`,
        }
      : {
          stale: false,
          detail: "o doctor também mede os espelhos do BUN_VERSION e eles NÃO estão limpos agora",
        }
  }

  return {
    stale: null,
    detail: `o assunto não é medido pelo doctor — a caducidade não pode ser declarada daqui`,
  }
}

/** A frase de UM assunto com dívida aberta: quantas, quais, há quanto tempo, e se caducou. */
function describeOpenDebt({ forge, subject, ours, alien, staleness }) {
  const bits = []
  if (ours.length > 0) {
    bits.push(
      `aberta(s) por este publicador: ${ours
        .map((i) => `#${i.number}${i.days === null ? "" : ` (há ${i.days} dia(s))`}`)
        .join(", ")}`,
    )
  }
  if (alien.length > 0) {
    bits.push(
      `SEM o marcador do publicador: ${alien.map((i) => `#${i.number}`).join(", ")} — não foram os crons que as abriram, então um automatismo não pode fechá-las: revise à mão`,
    )
  }
  const stale =
    staleness.stale === true
      ? `Parece CADUCADA: ${staleness.detail}`
      : staleness.stale === false
        ? `Fala de um problema VIVO: ${staleness.detail}`
        : `Caducidade NÃO verificada: ${staleness.detail}`
  return `${ours.length + alien.length} dívida(s) ABERTA(S) no ${forge} com a label '${subject.label}' (assunto: ${subject.subject}) — ${bits.join(" · ")}. ${stale}`
}

/**
 * A DÍVIDA ABERTA NO BOARD — as issues que os crons deste repositório abriram e
 * ninguém fechou.
 *
 * POR QUE ISTO É UM FATO DO VEREDITO: o doctor mede a forja AGORA (proteção
 * registrada, registro do runner, tag no registry, espelhos). Nenhuma dessas
 * medições vê o BOARD — e é ali que vive a dívida que alguém já identificou e não
 * resolveu: um drift de README, um overhead que subiu, uma proteção que foi
 * consertada à mão e cuja issue o publicador não conseguiu fechar. Sem este fato,
 * "PRONTA PARA BLOQUEAR O MERGE" convive com uma issue aberta que diz o
 * contrário, e o veredito responde sobre o que ele mesmo mediu, não sobre o que o
 * repositório já sabe.
 *
 * POR QUE NÃO BLOQUEIA: uma issue aberta não prova que a forja falha em bloquear
 * o merge — prova que existe dívida PENDENTE. Bloquear por ticket transformaria
 * "alguém esqueceu de fechar" em "não confie o merge", e o operador aprenderia a
 * ignorar o veredito. Não poder PRONTA é o peso certo: vira INDETERMINADA, com o
 * número da issue e a idade para quem lê decidir.
 *
 * A LEITURA é a MESMA mecânica dos publicadores (`listIssuesByLabel`, de
 * `issue-publish.mjs`): o leitor e quem escreve enxergam o mesmo board, com o
 * mesmo marcador. Nunca lança — cada forja que não deu para ler vira `unread`, e
 * "não consegui ler" é reportado como tal, jamais como "sem dívida".
 *
 * @param {{cwd?: string, env?: Record<string,string|undefined>, deps?: {list?: Function, now?: () => number}, protection?: object|null, mirrors?: object|null}} [args]
 * @returns {Promise<{state: string, detail: string, reads: object[], items: object[], labels: string[], excluded: object}>}
 */
export async function readOpenDebt({
  cwd = REPO_ROOT,
  env = process.env,
  deps = {},
  protection = null,
  mirrors = null,
} = {}) {
  const { list = listIssuesByLabel, now = () => Date.now() } = deps
  const reads = []
  const items = []

  for (const forge of DEBT_FORGES) {
    const subjects = DEBT_SUBJECTS.filter((s) => s.forges.includes(forge))
    if (subjects.length === 0) continue
    const labels = subjects.map((s) => s.label)

    let listed
    try {
      listed = []
      for (const subject of subjects) {
        listed.push({
          subject,
          issues: (await list({ forge, label: subject.label, env, cwd })) ?? [],
        })
      }
    } catch (err) {
      // NÃO PODER LER NÃO É EVIDÊNCIA: é ausência de prova. O doctor diz isso com
      // todas as letras em vez de presumir "sem dívida" — que é a falsa segurança
      // que ele existe para não produzir.
      //
      // A mensagem vira UMA LINHA: o erro do `gh`/da API vem com quebras ("...\n
      // Alternatively, populate...") e, cru, partiria o relatório no meio de uma
      // frase — o log do doctor é lido em terminal e colado em issue.
      const why = String(err?.message ?? err)
        .replace(/\s+/g, " ")
        .trim()
      reads.push({
        forge,
        labels,
        state: "unread",
        open: 0,
        foreign: 0,
        detail: `a dívida aberta no ${forge} NÃO foi lida: ${why}`,
      })
      continue
    }

    let open = 0
    let foreign = 0
    const nowMs = now()
    for (const { subject, issues } of listed) {
      const ours = []
      const alien = []
      for (const issue of issues) {
        // O MARCADOR, e não a label: label é etiqueta de triagem — alguém pode
        // aplicá-la numa issue alheia, e lê-la como dívida NOSSA seria inventar um
        // alerta que nenhum publicador abriu (o mesmo critério do fechamento
        // automático, pelo mesmo motivo).
        if (issueHasAnyMarker(issue, subject.markerId)) ours.push(debtIssue(issue, nowMs))
        else alien.push({ number: issue?.number ?? null, title: issue?.title ?? "" })
      }
      if (ours.length === 0 && alien.length === 0) continue
      const staleness = debtStaleness(subject, forge, { protection, mirrors })
      open += ours.length + alien.length
      foreign += alien.length
      items.push({
        forge,
        label: subject.label,
        markerId: subject.markerId,
        subject: subject.subject,
        ours: ours.length,
        foreign: alien.length,
        open: ours.length + alien.length,
        issues: ours,
        stale: staleness.stale,
        staleDetail: staleness.detail,
        detail: describeOpenDebt({ forge, subject, ours, alien, staleness }),
      })
    }

    reads.push({
      forge,
      labels,
      state: "read",
      open,
      foreign,
      detail:
        open === 0
          ? `nenhuma dívida aberta (labels: ${labels.join(", ")})`
          : `${open} dívida(s) ABERTA(S) nas labels ${labels.join(", ")}`,
    })
  }

  const read = reads.filter((r) => r.state === "read")
  const unread = reads.filter((r) => r.state !== "read")
  const state =
    read.length === 0
      ? "unavailable"
      : unread.length > 0
        ? "partial"
        : items.length > 0
          ? "open"
          : "clear"
  const detail =
    state === "clear"
      ? `nenhuma dívida aberta nas labels ${DEBT_SUBJECTS.map((s) => s.label).join(", ")}`
      : state === "open"
        ? `${items.length} assunto(s) com dívida ABERTA no board`
        : state === "partial"
          ? `lida no ${read.map((r) => r.forge).join(" e ")}; NÃO lida no ${unread.map((r) => r.forge).join(" e ")}`
          : `nenhuma forja pôde ser lida (${unread.map((r) => r.forge).join(", ")})`

  return {
    state,
    detail,
    reads,
    items,
    labels: DEBT_SUBJECTS.map((s) => s.label),
    excluded: DEBT_EXCLUDED,
  }
}

/**
 * A INTERPOLAÇÃO do compose da forja: o que o `docker compose config` resolve
 * para o label do runner (invariante 7 do `check:registry-source`).
 *
 * POR QUE É UM FATO DO VEREDITO: a seção 3 mostra que a tag existe no registry,
 * e a seção 4 que a subida depende dela. Nenhuma das duas lê o que o compose
 * REALMENTE pede — um `${BUN_VERSIO}` (typo) resolve para string vazia e um
 * `${BUN_VERSION:-1.4.0}` resolve para um literal: nos dois casos a tag do
 * registry pode até existir, e o runner registra/puxa OUTRA imagem.
 *
 * `state: 'unavailable'` (sem docker/compose, sem env) NÃO falha aqui — vira
 * "não provado", a mesma regra do resto do doctor.
 *
 * A comparação HOST × TEMPLATE (invariante 7b) viaja como fato PRÓPRIO
 * (`hostCompare`): "conferido e em sincronia" não pode aparecer igual a "não
 * havia o que conferir".
 *
 * @param {{cwd?: string, hostEnv?: string|null, deps?: {check?: (args: {cwd?: string, hostEnv?: string|null}) => {state: string, violations?: string[], detail: string, hostCompare?: {state: string, detail: string}}}}} [args]
 */
export async function readComposeInterpolation({
  cwd = REPO_ROOT,
  hostEnv = null,
  deps = {},
} = {}) {
  const { check = checkComposeInterpolation } = deps
  try {
    const res = check({ cwd, hostEnv })
    return {
      state: res.state,
      violations: res.violations ?? [],
      detail: res.detail,
      // A comparação HOST × TEMPLATE é um fato PRÓPRIO: "conferido e em
      // sincronia" não pode aparecer igual a "não havia o que conferir".
      hostCompare: res.hostCompare ?? {
        state: "absent",
        detail: "a comparacao host x template nao devolveu estado",
      },
    }
  } catch (err) {
    return {
      state: "unavailable",
      violations: [],
      detail: `a interpolacao do compose nao pode ser avaliada: ${err?.message ?? String(err)}`,
      hostCompare: {
        state: "absent",
        detail: `a interpolacao nao pode ser avaliada: ${err?.message ?? String(err)}`,
      },
    }
  }
}

/** Executa a bateria de gates da forja. */
export function runGuards(gates, { cwd = REPO_ROOT, timeoutS = 120, run } = {}) {
  return gates.map((gate) => runGate(gate, { cwd, timeoutS, run: run ?? spawnSync }))
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. Relatório
// ═══════════════════════════════════════════════════════════════════════════

const VERDICT_LINE = {
  [VERDICT.READY]: () => `${MARK.ok()} PRONTA PARA BLOQUEAR O MERGE`,
  [VERDICT.BLOCKED]: () => `${MARK.fail()} NÃO ESTÁ PRONTA — o merge NÃO pode ser confiado à forja`,
  [VERDICT.UNKNOWN]: () => `${MARK.warn()} INDETERMINADA — nada falhou, mas há coisa não provada`,
}

/**
 * @param {object} report  { facts, verdict }
 * @param {{emit: Function}} deps
 */
export function renderReport(report, { emit = console.log } = {}) {
  const { facts, verdict } = report
  const line = (s = "") => emit(s)

  line()
  line("  ═════════════════════════════════════════════════════════════════")
  line("   🩺 DOCTOR DA FORJA — prontidão para bloquear o merge")
  line("  ═════════════════════════════════════════════════════════════════")
  line()
  line(`  ${MARK.info()} dona do merge : ${MERGE_OWNER_PIPELINE} (job '${FORGE_GUARDS_JOB}')`)
  line(`  ${MARK.info()} manifesto     : ${REQUIRED_CHECKS_MANIFEST}`)

  // ── 1. Contrato de merge ────────────────────────────────────────────────
  // Duas metades, lado a lado DE PROPÓSITO: o que o repositório DECLARA (o
  // manifesto + os workflows que ele cita) e o que a forja REGISTRA (a branch
  // protection). Um manifesto validado com a forja em drift é o modo de falha
  // que este comando existe para não deixar passar.
  line()
  line("  1/6  Contrato de merge (o que o repositório DECLARA × o que a forja REGISTRA)")
  for (const f of facts.contract.forges) {
    const mark = f.exists && f.jobs > 0 ? MARK.ok() : MARK.fail()
    line(
      `       ${mark} ${f.forge.padEnd(7)} ${f.workflow.padEnd(32)} ${f.jobs} job(s) obrigatório(s)`,
    )
  }
  for (const failure of facts.contract.failures) line(`       ${MARK.fail()} ${failure}`)

  if (facts.skippedProtection) {
    line(`       ${MARK.skip()} registrado: pulado por --no-protection`)
  } else {
    for (const f of facts.protection?.forges ?? []) {
      const mark =
        f.state === "in-sync" ? MARK.ok() : f.state === "drift" ? MARK.fail() : MARK.warn()
      line(`       ${mark} ${f.forge.padEnd(7)} registrado: ${f.detail}`)
    }
    if ((facts.protection?.forges ?? []).length === 0) {
      line(`       ${MARK.warn()} registrado: ${facts.protection?.detail ?? "nao lido"}`)
    }
  }

  // ── 2. Guards da forja ──────────────────────────────────────────────────
  line()
  line(`  2/6  Guards da forja (derivados de ${MERGE_OWNER_PIPELINE})`)
  if (facts.skippedGuards) {
    line(`       ${MARK.skip()} pulados por --no-guards (o veredito NÃO cobre os gates)`)
  } else if (facts.guards.error) {
    line(`       ${MARK.fail()} ${facts.guards.error}`)
  } else {
    const failed = facts.guards.results.filter((r) => r.code !== 0)
    const mark = failed.length === 0 ? MARK.ok() : MARK.fail()
    line(
      `       ${mark} ${facts.guards.results.length} gate(s) executado(s) — ${failed.length} com problema`,
    )
    for (const r of facts.guards.results) {
      const status = r.code === 0 ? MARK.ok() : r.code === null ? MARK.warn() : MARK.fail()
      const time = `${r.seconds.toFixed(1)}s`.padStart(6)
      const note = r.code === null ? `  ${r.error}` : r.code === 0 ? "" : `  exit ${r.code}`
      line(`       ${status} ${r.gate.padEnd(40)}${time}${note}`)
      if (r.tail) for (const l of r.tail.split("\n")) line(`           ${color(C.gray, l)}`)
    }
  }

  // ── 3. Imagem do runner ─────────────────────────────────────────────────
  line()
  line("  3/6  Imagem do runner (o que os jobs puxam para INICIAR)") // Só a AUSÊNCIA confirmada (exit 4) é falha da forja; o resto é falta de
  // prova (env ausente no checkout, registry inacessível, pacote privado).
  const imageMark =
    facts.image.code === 0
      ? MARK.ok()
      : facts.image.code === IMAGE_MISSING
        ? MARK.fail()
        : MARK.warn()
  line(`       ${imageMark} exit ${facts.image.code} · estado '${facts.image.state}'`)
  if (facts.image.ref) line(`           ${facts.image.ref}`)
  for (const l of facts.image.lines) line(`           ${color(C.gray, l)}`)

  // A tag existir no registry não prova que o compose PEDE a tag certa: aqui o
  // `docker compose config` resolve o label do runner de verdade (invariante 7).
  const ci = facts.compose
  if (ci) {
    const ciMark =
      ci.state === "proven"
        ? MARK.ok()
        : ci.state === "violated"
          ? MARK.fail()
          : ci.state === "absent"
            ? MARK.info()
            : MARK.warn()
    line(`       ${ciMark} interpolacao do compose: ${ci.detail}`)
    for (const v of ci.violations) line(`           ${color(C.gray, v)}`)
    // A outra metade: o env do HOST (o que o VPS interpola) contra o template
    // comitado (o que o repositorio declara).
    const hc = ci.hostCompare
    if (hc) {
      const hcMark =
        hc.state === "in-sync"
          ? MARK.ok()
          : hc.state === "diverged"
            ? MARK.fail()
            : hc.state === "absent" || hc.state === "skipped"
              ? MARK.skip()
              : MARK.warn()
      line(`       ${hcMark} host x template: ${hc.detail}`)
    }
  }

  // O CONTRATO DA IMAGEM PUBLICADA: a prova mais forte da seção. O build promete
  // (pin por digest + bloco fail-closed) — aqui o ARTEFATO que o job BAIXA é
  // executado e responde: plugin `compose`, versão do Bun e o caminho resolvido.
  const ic = facts.imageContract
  if (ic) {
    const icMark =
      ic.state === "proven"
        ? MARK.ok()
        : ic.state === "violated"
          ? MARK.fail()
          : ic.state === "skipped"
            ? MARK.skip()
            : MARK.warn()
    line(`       ${icMark} contrato da imagem PUBLICADA: ${ic.detail}`)
    if (ic.digest) line(`           ${color(C.gray, `alvo: ${ic.target}`)}`)
    if (ic.findings) {
      const f = ic.findings
      line(
        `           ${color(C.gray, `bun: ${f.bunPath ?? "?"} · versao: ${f.bunVersion ?? "?"} · compose: ${f.composeVersion ?? "?"}`)}`,
      )
    }
    for (const r of ic.remedies ?? []) line(`           ${color(C.gray, `→ ${r}`)}`)
  }

  // O que o runner GRAVOU (`/data/.runner`): os labels são ESTADO no volume, não
  // config do container — o `up -d runner` recria o container com o env novo e
  // deixa o registro velho no lugar, e o job cai na imagem antiga sem sintoma.
  const labels = facts.runnerLabels
  if (labels) {
    const labelsMark =
      labels.state === "proven"
        ? MARK.ok()
        : labels.state === "violated"
          ? MARK.fail()
          : labels.state === "skipped"
            ? MARK.skip()
            : MARK.warn()
    const where = labels.container ? ` (${labels.container} · ${labels.stateFile})` : ""
    line(`       ${labelsMark} registro do act_runner${where}: ${labels.detail}`)
    for (const v of labels.violations ?? []) line(`           ${color(C.gray, v)}`)
    for (const r of labels.remedies ?? []) line(`           ${color(C.gray, `→ ${r}`)}`)
  }

  // A OUTRA forja, na MESMA seção: aqui não há arquivo a ler — o registro do
  // runner do GitHub vive no servidor, e é a API que o revela. Mostrar as duas
  // lado a lado é o ponto: uma forja em sincronia e a outra não é drift, e o
  // relatório não pode deixar isso invisível.
  const ghLabels = facts.githubRunnerLabels
  if (ghLabels) {
    const ghMark =
      ghLabels.state === "proven"
        ? MARK.ok()
        : ghLabels.state === "violated"
          ? MARK.fail()
          : ghLabels.state === "skipped"
            ? MARK.skip()
            : MARK.warn()
    const ghWhere = ghLabels.repo
      ? ` (repos/${ghLabels.repo}/actions/runners${ghLabels.runner ? ` · ${ghLabels.runner} (${ghLabels.status})` : ""})`
      : ""
    line(`       ${ghMark} registro do runner (github)${ghWhere}: ${ghLabels.detail}`)
    for (const v of ghLabels.violations ?? []) line(`           ${color(C.gray, v)}`)
    for (const r of ghLabels.remedies ?? []) line(`           ${color(C.gray, `→ ${r}`)}`)
  }

  // As referencias que NAO estao no repositorio: o que ficou indeterminado
  // aparece aqui, item por item — esconder isso num modo verboso seria o alerta
  // mudo que este repo persegue.
  const refs = facts.imageRefs
  if (refs) {
    const refsMark =
      refs.state === "proven" ? MARK.ok() : refs.state === "violated" ? MARK.fail() : MARK.warn()
    line(`       ${refsMark} referencias nao versionadas: ${refs.detail}`)
    for (const item of refs.items ?? []) {
      const mark =
        item.state === "proven"
          ? MARK.ok()
          : item.state === "indeterminate" || item.state === "absent"
            ? MARK.skip()
            : MARK.fail()
      line(`           ${mark} ${color(C.gray, `${item.source} — ${item.detail}`)}`)
    }
  }

  // ── 4. Prova do bloqueio ────────────────────────────────────────────────
  // A tag existir AGORA não prova que a subida depende dela. Esta seção executa
  // o caminho real contra um registry de teste e mostra o que o docker viu.
  line()
  line("  4/6  Prova do bloqueio (registry de TESTE — o runner não sobe sem a imagem)")
  if (facts.skippedProof) {
    line(`       ${MARK.skip()} pulada por --no-proof (o veredito NÃO cobre o bloqueio)`)
  } else {
    const proofMark =
      facts.proof.status === "holds"
        ? MARK.ok()
        : facts.proof.status === "violated"
          ? MARK.fail()
          : MARK.warn()
    const cases = facts.proof.cases ?? []
    const summary =
      facts.proof.status === "holds"
        ? `${cases.length} caso(s): ${cases.map((c) => `${c.id}=exit ${c.exit}`).join(" · ")}`
        : facts.proof.detail
    line(`       ${proofMark} ${summary}`)
    if (facts.proof.status === "holds") {
      line(
        `           ${color(C.gray, "tag ausente ⇒ NENHUM 'compose up'; tag presente ⇒ 'up -d runner' (controle)")}`,
      )
      line(
        `           ${color(C.gray, "re-registro: sem a imagem NADA é apagado; com ela, 'rm -sf runner' → 'volume rm' → 'up'; registro preso ⇒ o runner não sobe")}`,
      )
    }
    for (const c of cases.filter((c) => !c.ok)) {
      line(`           ${MARK.fail()} ${c.title}`)
      for (const f of c.failures ?? []) line(`               ${color(C.gray, f)}`)
    }
  }

  // ── 5. Espelhos locais ─────────────────────────────────────────────────
  // A primeira linha diz CONTRA O QUE se comparou: sem o valor da variável, o
  // resto da seção só prova existência e concordância local — e o operador
  // precisa ver essa diferença sem ler o código.
  line()
  line("  5/6  Espelhos da versão do Bun (sem rede)")
  if (facts.mirrors.expected) {
    line(
      `       ${MARK.info()} comparados com vars.BUN_VERSION='${facts.mirrors.expected}' (--expected, mesma função do job semanal actrc-sync)`,
    )
  } else {
    line(
      `       ${MARK.info()} o VALOR não foi comparado: sem --expected (vars.BUN_VERSION só existe no Actions)`,
    )
  }
  if (facts.mirrors.blockers.length === 0 && facts.mirrors.unknowns.length === 0) {
    line(`       ${MARK.ok()} .actrc e ${GITEA_ENV_MIRROR} concordam (${facts.mirrors.actrc})`)
  }
  for (const m of facts.mirrors.mirrors ?? []) {
    const mark = m.version === facts.mirrors.expected ? MARK.ok() : MARK.fail()
    line(
      `           ${mark} ${m.label} (${m.deployed ? "host" : "template comitado"}): ${m.version ?? "<sem BUN_VERSION>"}`,
    )
  }
  // Os avisos do GUARD, no texto dele: é o que o job semanal publica na issue, e
  // vê-los aqui lado a lado com o bloqueio é o que faz o log do doctor e a issue
  // não poderem discordar (a comparação é uma função só).
  if ((facts.mirrors.warnings ?? []).length > 0) {
    line(
      `           ${color(C.gray, "aviso do guard periódico (o MESMO texto que o job semanal publica):")}`,
    )
    for (const w of facts.mirrors.warnings) line(`           ${color(C.gray, w)}`)
  }
  for (const p of facts.mirrors.blockers) line(`       ${MARK.fail()} ${p}`)
  for (const p of facts.mirrors.unknowns) line(`       ${MARK.warn()} ${p}`)

  // ── 6. Dívida aberta no board ───────────────────────────────────────────
  // A única seção que fala do que o repositório JÁ SABE, em vez do que ele mede
  // agora: as issues que os próprios crons abriram. Aqui uma dívida esquecida
  // aparece com o número e a idade, em vez de viver só no board — e as duas que
  // o doctor mede por conta própria vêm lado a lado com a MEDIÇÃO, para a issue
  // velha não passar por problema vivo (nem o contrário).
  line()
  line("  6/6  Dívida aberta no board (issues de drift abertas, por forja)")
  line(`       ${MARK.info()} labels lidas: ${(facts.openDebt?.labels ?? []).join(", ")}`)
  if (facts.openDebt?.excluded) {
    line(
      `       ${MARK.info()} fora da leitura: '${facts.openDebt.excluded.label}' — ${facts.openDebt.excluded.why}`,
    )
  }
  if (facts.skippedOpenDebt) {
    line(
      `       ${MARK.skip()} pulada por --no-open-debt (a dívida do board NÃO entra no veredito)`,
    )
  }
  for (const read of facts.openDebt?.reads ?? []) {
    const mark = read.state === "read" ? (read.open === 0 ? MARK.ok() : MARK.warn()) : MARK.warn()
    line(`       ${mark} ${read.forge}: ${read.detail}`)
  }
  for (const item of facts.openDebt?.items ?? []) {
    line(`           ${MARK.warn()} ${item.forge} · ${item.label} — ${item.subject}`)
    for (const issue of item.issues) {
      const when = issue.days === null ? "data desconhecida" : `aberta há ${issue.days} dia(s)`
      line(`               ${color(C.gray, `#${issue.number} (${when}) — ${issue.title}`)}`)
    }
    if (item.foreign > 0) {
      line(
        `               ${color(C.gray, `${item.foreign} issue(s) com a label e SEM o marcador do publicador — um automatismo não pode fechá-la(s)`)}`,
      )
    }
    const stale =
      item.stale === true ? MARK.info() : item.stale === false ? MARK.warn() : MARK.skip()
    line(`               ${stale} ${color(C.gray, item.staleDetail)}`)
  }

  // ── Veredito ────────────────────────────────────────────────────────────
  line()
  line("  ─────────────────────────────────────────────────────────────────")
  line(`  VEREDITO: ${VERDICT_LINE[verdict.verdict]()}`)
  line("  ─────────────────────────────────────────────────────────────────")

  if (verdict.blockers.length > 0) {
    line()
    line(`  ${color(C.red, "Bloqueios")} (corrigir antes de confiar o merge à forja):`)
    for (const b of verdict.blockers) line(`    ${MARK.fail()} ${b}`)
  }
  if (verdict.unknowns.length > 0) {
    line()
    line(`  ${color(C.yellow, "Não provado")}:`)
    for (const u of verdict.unknowns) line(`    ${MARK.warn()} ${u}`)
  }

  line()
  line(`  ${color(C.gray, "O veredito NÃO cobre:")}`)
  for (const u of verdict.unproven) line(`    ${color(C.gray, `· ${u}`)}`)
  line()
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. CLI
// ═══════════════════════════════════════════════════════════════════════════

export const USAGE = `forge-doctor — relatório de prontidão da forja para bloquear o merge

Usage:
  node scripts/forge-doctor.mjs [opções]

Opções:
  --no-guards            pula a bateria de guards (mais rápido; o veredito fica parcial)
  --no-proof             pula a prova do bloqueio da imagem (mais rápido; o veredito fica parcial)
  --no-protection        pula a leitura da branch protection registrada na forja
  --no-runner-labels     pula a comparação do registro do runner NAS DUAS forjas:
                         o act_runner (os labels são ESTADO no volume:
                         /data/.runner x o compose) e o runner auto-hospedado do
                         GitHub (o registro vive no SERVIDOR: a API x o
                         RUNNER_LABELS de deploy/setup-github-runner.sh, que
                         exige token de self-hosted runners — sem ele é 3)
  --no-image-contract    pula o contrato da imagem PUBLICADA: o doctor resolve o
                         DIGEST que a tag serve e roda o bloco do contrato DENTRO
                         do artefato (docker run <repo>@<digest>) — plugin
                         \`compose\`, versão do Bun e o caminho resolvido. É a
                         única prova do que o job REALMENTE baixa; o primeiro
                         run baixa a imagem (minutos) se ela nao estiver local
  --no-compose-render    pula a interpolação do compose (docker compose config)
  --no-registry-probe    não consulta o registry (offline): a tag que o repo
                         declara deixa de ser conferida — e o veredito não pode
                         fingir que foi
  --no-open-debt         não lê o BOARD (offline): as issues de drift ABERTAS
                         (required-checks-drift, actrc-sync-drift, readme-drift,
                         mutation-trend-drift) deixam de aparecer no veredito —
                         e a dívida que vive só no board volta a ser invisível
                         para a prontidão
  --expected <versão>    valor de vars.BUN_VERSION (a repository variable): com
                         ele os espelhos do Bun são comparados com o VALOR
                         declarado, pelo mesmo código do job semanal
                         actrc-sync. Sem ele o doctor só prova que os espelhos
                         existem e concordam entre si — e o veredito fica
                         INDETERMINADA por isso
  --gitea-env <path>     env do HOST (default: deploy/.env.gitea) — e ele que o
                         doctor compara com o template comitado
  --timeout <segundos>   limite por gate (default: 120)
  --json                 sai como JSON (mesma informação do relatório)
  -h, --help             esta ajuda

Exit codes (o veredito é o exit code — dá para usar em pipeline):
  0 — pronta   1 — bloqueada   2 — indeterminada   3 — uso/erro interno
`

export function parseArgs(argv) {
  const opts = {
    guards: true,
    proof: true,
    protection: true,
    runnerLabels: true,
    imageContract: true,
    composeRender: true,
    registryProbe: true,
    openDebt: true,
    envFile: DEFAULT_ENV_FILE,
    expected: null,
    timeoutS: 120,
    json: false,
    help: false,
    error: null,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--no-guards") opts.guards = false
    else if (arg === "--no-proof") opts.proof = false
    else if (arg === "--no-protection") opts.protection = false
    else if (arg === "--no-runner-labels") opts.runnerLabels = false
    else if (arg === "--no-image-contract") opts.imageContract = false
    else if (arg === "--no-compose-render") opts.composeRender = false
    else if (arg === "--no-registry-probe") opts.registryProbe = false
    else if (arg === "--no-open-debt") opts.openDebt = false
    else if (arg === "--json") opts.json = true
    else if (arg === "-h" || arg === "--help") opts.help = true
    else if (arg === "--expected") opts.expected = argv[++i] ?? ""
    else if (arg === "--gitea-env") opts.envFile = argv[++i] ?? ""
    else if (arg === "--timeout") opts.timeoutS = Number(argv[++i])
    else opts.error = `argumento desconhecido: ${arg}`
  }
  if (!opts.envFile) opts.error = "--gitea-env exige um caminho"
  // `--expected` SEM valor é erro de uso. A versão vazia (variável não criada) é
  // drift REAL, mas quem o reporta é o guard periódico — um flag que aceita
  // nada seria indistinguível de "não perguntei".
  if (opts.expected === "") opts.error = "--expected exige uma versão (ex.: --expected 1.3.14)"
  // Uma flag engolida como valor (`--expected --json`) seria comparada como se
  // fosse uma versão — o espelho "divergiria de '--json'" e a mensagem mandaria
  // o operador procurar um drift que não existe. Versão nenhuma começa com `--`.
  if (typeof opts.expected === "string" && opts.expected.startsWith("--")) {
    opts.error = `--expected exige uma versão, não uma flag (recebi '${opts.expected}')`
  }
  if (!Number.isFinite(opts.timeoutS) || opts.timeoutS < 1) {
    opts.error = "--timeout exige um número de segundos >= 1"
  }
  return opts
}

/**
 * Coleta os fatos e monta o veredito. Exportado para o teste exercitar o fluxo
 * inteiro com dependências dubladas (sem registry, sem rodar gate de verdade).
 *
 * @param {object} [options]
 * @param {string} [options.cwd]
 * @param {string} [options.envFile]   env do runner (o mesmo do compose)
 * @param {string|null} [options.expected] valor de `vars.BUN_VERSION` para
 * comparar os espelhos do Bun (null = não comparado: o veredito fica parcial)
 * @param {boolean} [options.guards]   executar a bateria da forja (default: true)
 * @param {boolean} [options.proof]    executar a prova do bloqueio (default: true)
 * @param {boolean} [options.protection] ler a branch protection registrada na forja (default: true)
 * @param {boolean} [options.runnerLabels] comparar o registro do act_runner com o compose (default: true)
 * @param {boolean} [options.imageContract] rodar o contrato DENTRO da imagem publicada (default: true)
 * @param {boolean} [options.composeRender] interpolar o compose da forja (default: true)
 * @param {boolean} [options.registryProbe] consultar o registry (default: true)
 * @param {boolean} [options.openDebt] ler o BOARD: as issues de drift abertas (default: true)
 * @param {number} [options.timeoutS]  limite por gate
 * @param {Function} [options.run]     `spawnSync` real ou dublê de teste
 * @param {object} [options.imageDeps] dependências repassadas ao check da imagem
 * @param {object} [options.imageRefsDeps] dependências do fato das referências
 * não versionadas (`env`/`probe`) — o ponto de injeção do teste
 * @param {object} [options.runnerLabelsDeps] dependências do fato do registro do
 * runner (`check`/`run`) — o ponto de injeção do teste
 * @param {object} [options.githubRunnerLabelsDeps] dependências do fato do
 * registro do runner do GitHub (`check`/`fetchImpl`/`env`) — o ponto de injeção do teste
 * @param {object} [options.proofDeps] dependências repassadas à prova do bloqueio
 * @param {object} [options.imageContractDeps] dependências do fato do contrato publicado
 * (`resolveIdentity`/`run`/`credentials`/`cwd`) — o ponto de injeção do teste
 * @param {object} [options.composeDeps] dependências repassadas à interpolação do compose
 * @param {object} [options.protectionDeps] dependências repassadas à leitura da branch protection
 * (`run` é o mesmo dublê dos gates: é por ele que a leitura da forja é injetada)
 * @param {object} [options.openDebtDeps] dependências do fato da dívida aberta
 * (`list` = a leitura do board, `now` = o relógio da idade) — o ponto de injeção
 * do teste, e o que mantém a suíte fora da rede
 * (`{prove}` substitui a prova inteira — é o ponto de injeção do teste)
 * (sem `@returns` declarado de propósito: o formato dos fatos é o que o
 * `summarize` consome, e descrevê-lo aqui de novo só criaria duas verdades)
 */
export async function diagnose({
  cwd = REPO_ROOT,
  envFile = DEFAULT_ENV_FILE,
  env = process.env,
  expected = null,
  guards = true,
  proof = true,
  protection = true,
  runnerLabels = true,
  imageContract = true,
  composeRender = true,
  registryProbe = true,
  openDebt = true,
  timeoutS = 120,
  run,
  imageDeps = {},
  imageRefsDeps = {},
  runnerLabelsDeps = {},
  githubRunnerLabelsDeps = {},
  proofDeps = {},
  composeDeps = {},
  protectionDeps = {},
  imageContractDeps = {},
  openDebtDeps = {},
} = {}) {
  const contractRun = runGate(
    { label: "check:required-checks", command: "bun run check:required-checks" },
    { cwd, timeoutS, run },
  )
  const contract = readContract(cwd)
  if (contractRun.code !== 0) {
    contract.failures.push(
      contractRun.code === null
        ? `check:required-checks não foi verificado: ${contractRun.error}`
        : `check:required-checks FALHOU (exit ${contractRun.code}) — o manifesto aponta para jobs que não existem, ou um obrigatório virou condicional`,
    )
  }

  const pipelinePath = join(cwd, MERGE_OWNER_PIPELINE)
  let gatesResult = { gates: [], error: null }
  if (existsSync(pipelinePath)) {
    gatesResult = forgeGates(readFileSync(pipelinePath, "utf8"))
  } else {
    gatesResult = { gates: [], error: `${MERGE_OWNER_PIPELINE}: ausente` }
  }

  const results = guards ? runGuards(gatesResult.gates, { cwd, timeoutS, run }) : []

  // O fato da imagem sai primeiro porque o CONTRATO PUBLICADO depende dele (o
  // `ref` resolvido pelo env é a fonte do alvo — uma leitura do env, não duas).
  const image = await readImage({ envFile, cwd, deps: imageDeps })

  // A proteção e os espelhos saem do literal porque o FATO DA DÍVIDA os consome:
  // o cruzamento (a issue aberta contra o que o doctor mede agora) precisa das
  // duas leituras, e recomputá-las para isso seriam DUAS medições do mesmo fato
  // — que é como duas verdades começam a divergir.
  const protectionFacts = protection
    ? readProtection({
        cwd,
        forges: contract.forges.map((f) => f.forge),
        run,
        ...protectionDeps,
      })
    : { state: "skipped", detail: "pulada por --no-protection", forges: [] }
  const mirrorsFacts = readMirrors(cwd, { expected })
  const openDebtFacts = openDebt
    ? await readOpenDebt({
        cwd,
        env,
        deps: openDebtDeps,
        protection: protectionFacts,
        mirrors: mirrorsFacts,
      })
    : {
        state: "skipped",
        detail: "pulada por --no-open-debt",
        reads: [],
        items: [],
        labels: DEBT_SUBJECTS.map((s) => s.label),
        excluded: DEBT_EXCLUDED,
      }

  const facts = {
    contract,
    guards: { results, error: gatesResult.error ?? null, gates: gatesResult.gates },
    image,
    // A imagem publicada: exige a MESMA leitura do registry que o
    // `--no-registry-probe` desliga (o digest da tag vem de lá) — a flag pula
    // as duas, e o relatório diz qual das duas razões o fez ficar de fora.
    imageContract:
      imageContract && registryProbe
        ? await readImageContract({ image, expected, cwd, env, deps: imageContractDeps })
        : {
            state: "skipped",
            detail: imageContract
              ? "pulada por --no-registry-probe (o digest que a tag serve vem do registry)"
              : "pulada por --no-image-contract",
            ref: image.ref ?? null,
            digest: null,
            target: null,
            expectedVersion: expected,
            findings: null,
            remedies: [],
          },
    proof: proof
      ? await readProof({ cwd, deps: proofDeps })
      : { status: "skipped", ok: false, detail: "pulada por --no-proof", cases: [] },
    compose: composeRender
      ? await readComposeInterpolation({ cwd, hostEnv: envFile, deps: composeDeps })
      : {
          state: "skipped",
          violations: [],
          detail: "pulada por --no-compose-render",
          hostCompare: { state: "skipped", detail: "pulada por --no-compose-render" },
        },
    // As forjas saem do MANIFESTO (uma fonte): um manifesto que ganhe uma
    // terceira forja entra na leitura sozinho.
    protection: protectionFacts,
    // SEM `envPath`: a DESCOBERTA do guard já cobre o template comitado E o
    // `deploy/.env.gitea` do checkout quando ele existe — que é o caso do VPS,
    // justamente onde os dois importam. Apontar um arquivo (`--gitea-env`)
    // SUBSTITUI a descoberta (semântica do CLI do guard, para perguntar por
    // OUTRO host), e aí o template sairia da comparação — regressão silenciosa
    // no host onde o valor mais importa.
    imageRefs: await readImageRefs({
      cwd,
      envFile,
      deps: { probeRegistry: registryProbe, ...imageRefsDeps },
    }),
    // O `envFile` só é repassado quando NÃO é o default: o default do doctor
    // (`deploy/.env.gitea`) significa "use a DESCOBERTA do guard" — e a
    // descoberta prefere o arquivo do host e cai no template comitado quando
    // ele não existe. Repassá-lo cru trocaria isso por `env-missing` em todo
    // checkout que não seja o VPS (o guard não inventa um baseline).
    runnerLabels: runnerLabels
      ? readRunnerLabels({
          cwd,
          envFile: envFile === DEFAULT_ENV_FILE ? null : envFile,
          deps: runnerLabelsDeps,
        })
      : {
          state: "skipped",
          detail: "pulada por --no-runner-labels",
          violations: [],
          remedies: [],
        },
    // A outra forja, com a MESMA flag: as duas são "o registro do runner", e
    // separá-las em duas flags faria a segunda ser esquecida.
    githubRunnerLabels: runnerLabels
      ? await readGithubRunnerLabels({ cwd, env, deps: githubRunnerLabelsDeps })
      : {
          state: "skipped",
          detail: "pulada por --no-runner-labels",
          violations: [],
          remedies: [],
        },
    mirrors: mirrorsFacts,
    openDebt: openDebtFacts,
    skippedGuards: !guards,
    skippedProof: !proof,
    skippedProtection: !protection,
    skippedRunnerLabels: !runnerLabels,
    skippedRegistryProbe: !registryProbe,
    skippedImageContract: !imageContract,
    skippedOpenDebt: !openDebt,
  }

  return { facts }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.error) {
    console.error(`forge-doctor: ${opts.error}`)
    console.error(USAGE)
    process.exit(3)
  }
  if (opts.help) {
    console.log(USAGE)
    process.exit(0)
  }

  const { facts } = await diagnose(opts)
  const verdict = summarize(facts)
  const report = { facts, verdict }

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    renderReport(report)
  }

  process.exit(verdict.verdict === VERDICT.READY ? 0 : verdict.verdict === VERDICT.BLOCKED ? 1 : 2)
}

const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (IS_DIRECT_RUN) await main()
