#!/usr/bin/env node
// =============================================================================
// prove-forge-smoke-ephemeral.mjs
//
// Usage:
//   node scripts/prove-forge-smoke-ephemeral.mjs                  # ensaio completo
//   node scripts/prove-forge-smoke-ephemeral.mjs --json           # mesmo veredito, plano
//   node scripts/prove-forge-smoke-ephemeral.mjs --keep           # não derruba a stack
//   node scripts/prove-forge-smoke-ephemeral.mjs --source HEAD    # empurra o commit, não o worktree
//   node scripts/prove-forge-smoke-ephemeral.mjs --timeout 1200   # espera por prova (s)
//   node scripts/prove-forge-smoke-ephemeral.mjs --mutacao-labels # 2ª fase: label a mais ⇒ Prova 5 vermelha
//   node scripts/prove-forge-smoke-ephemeral.mjs --no-sentinela   # pula o controle negativo
//   node scripts/prove-forge-smoke-ephemeral.mjs --sem-no-new-privileges  # ver "O host" abaixo
//
// Exit codes:
//   0 — PROVADO: as 5 provas do smoke rodaram num act_runner EFÊMERO, a bateria
//       fechou VERDE e o canal de veredito provou que vê vermelho (sentinela)
//   1 — VIOLADO: alguma prova não deixou o desfecho positivo (ou o canal não viu
//       a sentinela vermelha, ou a mutação de labels NÃO deixou o smoke vermelho)
//   2 — INDETERMINADO: sem docker/compose, imagem ausente, produção no host, o
//       Gitea não subiu, o runner não registrou ou o job não terminou a tempo
//       — ausência de prova, nunca "a forja está pronta"
//   3 — uso inválido
//
// POR QUE EXISTE (o que os guards estáticos e o `forge-runtime:prove` NÃO provam)
//
// O `forge-runtime:prove` roda o job `guards` DENTRO da imagem do runner, na
// MÁQUINA de quem roda. Ele fecha o runtime do container — e deixa de fora
// exatamente a peça que o smoke existe para provar: o **act_runner**. Ninguém
// no repositório prova, hoje, que os cinco pressupostos do `forge-smoke.yml`
// valem num runner de verdade:
//
//   1. o contexto `vars` HIDRATA (repository variable → `vars.BUN_VERSION`);
//   2. o setup por `run:` engaja o tier-1 (a imagem do runner EMBARCA o Bun);
//   3. o runtime em uso é o da variable;
//   4. a imagem do job roda os guards por inteiro — inclusive o render do
//      compose (`--require-compose`);
//   5. o REGISTRO do runner (`/data/.runner`) é o que o compose declara.
//
// E o smoke é `workflow_dispatch`: num PR ele NÃO roda (um dispatch não reporta
// status — viraria um required check que ESPERA para sempre). Ou seja, as cinco
// provas ficam dependendo de alguém lembrar de clicar "Run workflow" na forja de
// PRODUÇÃO, com o resultado lido a olho no log. Este comando tira o operador do
// laço e a produção do caminho.
//
// COMO (a stack é DERIVADA, não uma segunda declaração)
//
//   - o compose é o MESMO `deploy/docker-compose.gitea.yml` que a forja usa,
//     sobreposto por um arquivo GERADO que muda só o que precisa ser efêmero:
//     nomes de volume próprios e a porta local do Gitea (bind em 127.0.0.1,
//     porta livre). Nada de labels, imagens ou serviços é redeclarado aqui;
//   - o env sai do template comitado (`deploy/env.gitea.example`), com o
//     `RUNNER_TOKEN` trocado pelo token que o PRÓPRIO Gitea efêmero gerou. As
//     variáveis que o smoke usa (`vars.BUN_VERSION` & cia) saem do mesmo
//     template, e a lista delas é DERIVADA do workflow (um `vars.X` novo no
//     smoke entra sozinho — e falha se não existir no template);
//   - o repositório do ensaio é um snapshot do worktree (ou de `HEAD`, com
//     `--source`), com o smoke COMITADO e o gatilho `push` ACRESCENTADO — ver
//     "O gatilho" abaixo;
//   - o veredito não vem de texto: vem de `action_task.status` do banco do
//     Gitea (1 = sucesso, 2 = falha) e o log COMPLETO do job, que o Gitea
//     guarda (`actions_log/<log_filename>`), traz as linhas `✅`/`::error::`.
//
// O gatilho (a única diferença entre o arquivo empurrado e o comitado)
//
// O Gitea 1.22 não tem `workflow_dispatch`: nem UI, nem API (medido — 404 em
// todas as rotas de dispatch, e nenhuma delas existe no swagger da instância).
// Um workflow cujo único gatilho é `workflow_dispatch` NUNCA dispara nessa
// forja. Por isso o ensaio ACRESCENTA
//
//   push:
//     branches: [<branch do ensaio>]
//
// ao bloco `on:` do smoke — restrito ao branch do ensaio, para o push não
// acender mais nada — e o arquivo empurrado é comparado com o comitado linha a
// linha: a ÚNICA diferença aceita são essas duas linhas. O que se prova é o
// CORPO do smoke (as cinco provas), não o gatilho; e o relatório DIZ isso, em
// vez de deixar a impressão de que o dispatch foi exercitado.
//
// A prova de que a prova não é cega (a sentinela)
//
// Antes do smoke, o ensaio empurra um workflow SENTINELA (num branch próprio)
// cujo job FALHA de propósito, e exige que o canal de veredito o veja como
// falha (`action_task.status = 2`) com a linha de falha no log. Sem isso, um
// "PROVADO" poderia ser só "eu li um log e ele não era vazio" — o mesmo defeito
// que o resto da família combate. Com `--mutacao-labels` há uma segunda fase:
// o runner é re-registrado com um label A MAIS que o compose declara (o defeito
// invisível da Prova 5) e o ensaio exige o smoke VERMELHO, com as provas 1–4
// ainda verdes — o raio de alcance que a mutação deve ter.
//
// O host (e o único ponto em que a stack do ensaio pode diferir da produção)
//
// `no-new-privileges:true` é hardening do serviço `runner` no compose. Em hosts
// com confinamento do daemon (medido: Docker 29.6.1 sob snap), esse hardening
// impede QUALQUER exec dentro do container — inclusive `sh` e `tini`, em imagens
// diferentes (alpine puro e a do runner) — e o runner nunca sobe: o job nunca é
// atribuído e nenhuma prova roda. Sem a flag, o ensaio DIZ isso (o estado do
// container e a última linha do log do runner entram no veredito) e sai
// INDETERMINADO: o host não roda a stack declarada, e "não deu para ensaiar"
// nunca é "a forja está pronta". Com `--sem-no-new-privileges` o ensaio gera o
// texto do compose SEM essa única linha do serviço `runner` (conferido linha a
// linha: é a ÚNICA diferença), roda o ensaio e DECLARA no relatório que a stack
// do ensaio difere da produção nesse ponto.
//
// O QUE NÃO COBRE (dito, não escondido)
//
//   - o gatilho `workflow_dispatch` (não existe na série 1.22; ver acima);
//   - a forja de PRODUÇÃO: o ensaio RECUSA rodar se houver uma stack da forja
//     neste host (containers `gitea`/`gitea-runner` ou projeto `deploy` do
//     compose), em vez de dividir recurso com ela;
//   - TLS/Caddy (a stack sobe só `gitea` + `runner`), o DNS e o firewall;
//   - os jobs `guards`/CI reais: aqui roda o smoke, que é o que ele se propõe.
//
// Onde roda: manual/operador (`bun run forge-smoke:prove`) e no CI com docker
// disponível. Sem docker ele é INDETERMINADO — nunca verde.
// =============================================================================

import { spawnSync } from "node:child_process"
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import process from "node:process"
import { fileURLToPath, pathToFileURL } from "node:url"

import { GITEA_COMPOSE } from "./check-bun-mirror.mjs"
import { parseEnvFile } from "./ensure-runner-image.mjs"

/** A raiz do repositório — este script mora em `scripts/`. */
export const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

/** O workflow que este ensaio executa (a fonte do corpo e das expectativas). */
export const SMOKE_WORKFLOW = ".gitea/workflows/forge-smoke.yml"

/** O env comitado que serve de baseline (o mesmo template do resto da família). */
export const DEFAULT_ENV_FILE = "deploy/env.gitea.example"

/** O serviço do Gitea e o do runner no compose da forja (fonte única). */
export const GITEA_SERVICE = "gitea"
export const RUNNER_SERVICE = "runner"

/** O prefixo do projeto compose efêmero (o sufixo aleatório evita colisão). */
export const PROJECT_PREFIX = "prova-forge-smoke"

/** O branch em que o smoke é empurrado — e a branch do gatilho acrescentado. */
export const SMOKE_BRANCH = "prova/smoke"

/** O branch (e o arquivo) da sentinela: o controle negativo do canal. */
export const SENTINELA_BRANCH = "prova/sentinela"
export const SENTINELA_WORKFLOW = ".gitea/workflows/prova-sentinela.yml"
export const SENTINELA_MARKER = "SENTINELA: esta falha e proposital"

/** O usuário/repo criados DENTRO do Gitea efêmero (nada a ver com a forja). */
export const OWNER = "prova"
export const REPO_NAME = "ensaio"
const ADMIN_PASSWORD = "Prova!12345x"

/** O label A MAIS que a mutação registra (`--mutacao-labels`). */
export const MUTATION_LABEL_NAME = "prova-extra"

/** Exit codes — o contrato da CLI (a mesma escala da família). */
export const EXIT = { OK: 0, FAILED: 1, UNAVAILABLE: 2, USAGE: 3 }

/**
 * Os códigos de `action_task.status` que DECIDEM o veredito.
 *
 * Medido no Gitea 1.22 (a série da forja): 1 = sucesso, 2 = falha. Todo outro
 * código é "ainda não terminou" — 6 aparece com o job rodando, por exemplo.
 * A escala NÃO é reimplementada aqui de propósito: o ensaio espera um estado
 * TERMINAL (1 ou 2) com timeout e, se não chegar, é INDETERMINADO com o código
 * cru no relatório. Assim uma mudança de enumeração no Gitea não vira "verde".
 */
export const SUCCESS_STATUS = 1
export const FAILURE_STATUS = 2

/** O teto de espera (segundos) por desfecho terminal de cada prova. */
export const DEFAULT_TIMEOUT_S = 900

/**
 * As marcas que o próprio act_runner escreve no log do job. Derivar delas é o
 * que permite exigir "cada passo RODOU" sem cravar a lista de passos aqui.
 */
export const RUN_MARKER = "⭐ Run Main "
export const JOB_FAILED_MARKER = "🏁  Job failed"
export const ERROR_ANNOTATION = "::error::"

// ═══════════════════════════════════════════════════════════════════════════
// 1. O plano do ensaio (puro — sem docker, sem Gitea, sem fs)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Acrescenta o gatilho `push` (restrito ao branch do ensaio) ao bloco `on:`.
 *
 * O `push` é ACRESCENTADO, não trocado: o `workflow_dispatch` comitado continua
 * lá, e a única diferença entre o arquivo empurrado e o comitado são as linhas
 * devolvidas em `added` — o chamador confere isso (`assertOnlyAddition`) antes
 * de empurrar. Um `on:` que não esteja no formato esperado (bloco de nível
 * raiz) faz o ensaio falhar alto: emitir um YAML inválido e "provar" sobre ele
 * seria pior que não provar.
 *
 * @param {string} text conteúdo do workflow comitado
 * @param {{branch?: string}} [opts]
 * @returns {{ok: boolean, text: string|null, added: string[], detail: string}}
 */
export function addPushTrigger(text, { branch = SMOKE_BRANCH } = {}) {
  const lines = String(text).split("\n")
  const at = lines.findIndex((line) => /^on:\s*$/.test(line))
  if (at === -1) {
    return {
      ok: false,
      text: null,
      added: [],
      detail:
        "o workflow não tem um bloco `on:` de nível raiz — sem ele não sei onde acrescentar o gatilho",
    }
  }
  const hasPush = lines.slice(at + 1).some((line) => /^ {2}push:\s*$/.test(line))
  if (hasPush) {
    return {
      ok: false,
      text: null,
      added: [],
      detail: "o workflow já tem um gatilho `push:` — o ensaio não sobrescreve gatilho declarado",
    }
  }
  const added = ["  push:", `    branches: [${branch}]`]
  const out = [...lines.slice(0, at + 1), ...added, ...lines.slice(at + 1)]
  return { ok: true, text: out.join("\n"), added, detail: `acrescentado: ${added.join(" ")}` }
}

/**
 * Confere que o gatilho é a ÚNICA diferença entre o comitado e o empurrado.
 *
 * Sem esta checagem, uma edição acidental (um `run:` mexido, um comentário
 * apagado) viraria "o smoke", e o ensaio provaria outro arquivo sem dizer.
 *
 * @param {string} original
 * @param {string} modified
 * @param {string[]} added
 */
export function assertOnlyAddition(original, modified, added) {
  const originalLines = String(original).split("\n")
  const modifiedLines = [...String(modified).split("\n")]
  for (const line of added) {
    const at = modifiedLines.indexOf(line)
    if (at === -1)
      return {
        ok: false,
        detail: `a linha acrescentada não está no arquivo empurrado: ${JSON.stringify(line)}`,
      }
    modifiedLines.splice(at, 1)
  }
  if (modifiedLines.length !== originalLines.length) {
    return {
      ok: false,
      detail: `o arquivo empurrado tem ${modifiedLines.length} linhas e o comitado ${originalLines.length} — a diferença NÃO é só o gatilho`,
    }
  }
  for (let i = 0; i < originalLines.length; i += 1) {
    if (originalLines[i] !== modifiedLines[i]) {
      return {
        ok: false,
        detail: `linha ${i + 1} divergiu além do gatilho:\n  comitado: ${JSON.stringify(originalLines[i])}\n  empurrado: ${JSON.stringify(modifiedLines[i])}`,
      }
    }
  }
  return { ok: true, detail: `a única diferença são ${added.length} linha(s) de gatilho` }
}

/**
 * O texto do compose sem o hardening do serviço `runner` (opt-in, medido).
 *
 * Em hosts cujo confinamento do daemon quebra o `exec` sob
 * `no-new-privileges:true`, o runner não sobe e NENHUMA prova roda. A remoção é
 * cirúrgica e verificada (`assertOnlyRemoval`): o ensaio não pode "consertar" o
 * compose — ele pode, DECLARANDO, rodar uma cópia com uma linha a menos.
 *
 * Devolve o ÍNDICE (no texto original) e as linhas removidas — a assertiva usa os
 * índices de propósito: casar por conteúdo erraria o alvo quando a mesma linha
 * aparece em outro serviço (o compose tem `security_opt` em três).
 *
 * @param {string} text conteúdo de `GITEA_COMPOSE`
 * @param {{service?: string, option?: string}} [opts]
 * @returns {{ok: boolean, text: string|null, removal: {at: number, lines: string[]}|null, detail: string}}
 */
export function stripRunnerHardening(
  text,
  { service = RUNNER_SERVICE, option = "no-new-privileges:true" } = {},
) {
  const lines = String(text).split("\n")
  const start = lines.findIndex((line) => line === `  ${service}:`)
  if (start === -1)
    return {
      ok: false,
      text: null,
      removal: null,
      detail: `o compose não tem o serviço '${service}' na indentação esperada`,
    }
  let end = lines.length
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^ {2}[A-Za-z0-9_-]+:\s*$/.test(lines[i])) {
      end = i
      break
    }
  }
  const block = lines.slice(start, end)
  const at = block.findIndex((line) => /^ {4}security_opt:\s*$/.test(line))
  if (at === -1)
    return {
      ok: false,
      text: null,
      removal: null,
      detail: `o serviço '${service}' não declara 'security_opt' — nada a remover`,
    }
  const entry = block.findIndex((line, i) => i > at && line.trim() === `- ${option}`)
  if (entry === -1)
    return {
      ok: false,
      text: null,
      removal: null,
      detail: `'security_opt' do serviço '${service}' não tem '${option}' — a flag não teria efeito medido`,
    }
  const removal = { at: start + at, lines: [block[at], block[entry]] }
  const out = [
    ...lines.slice(0, start),
    ...block.filter((_, i) => i !== at && i !== entry),
    ...lines.slice(end),
  ]
  return {
    ok: true,
    text: out.join("\n"),
    removal,
    detail: `removido do serviço '${service}': ${removal.lines.map((l) => l.trim()).join(" ")}`,
  }
}

/**
 * Confere que as linhas removidas são a ÚNICA diferença entre os dois textos.
 *
 * @param {string} original
 * @param {string} modified
 * @param {{at: number, lines: string[]}} removal
 */
export function assertOnlyRemoval(original, modified, removal) {
  const originalLines = String(original).split("\n")
  const expected = [
    ...originalLines.slice(0, removal.at),
    ...originalLines.slice(removal.at + removal.lines.length),
  ]
  const modifiedLines = String(modified).split("\n")
  if (modifiedLines.length !== expected.length) {
    return {
      ok: false,
      detail: `o texto gerado tem ${modifiedLines.length} linhas e o esperado ${expected.length} — a diferença NÃO são só as linhas removidas`,
    }
  }
  for (let i = 0; i < expected.length; i += 1) {
    if (expected[i] !== modifiedLines[i]) {
      return {
        ok: false,
        detail: `linha ${i + 1} divergiu além do que foi removido:\n  comitado: ${JSON.stringify(expected[i])}\n  gerado: ${JSON.stringify(modifiedLines[i])}`,
      }
    }
  }
  return { ok: true, detail: `a única diferença são ${removal.lines.length} linha(s) removida(s)` }
}

/**
 * O workflow da sentinela: um job que FALHA de propósito, num branch próprio.
 *
 * Ele não faz parte do repositório — é artefato do ensaio, e o relatório diz
 * isso. Existe para o veredito ser falsificável: se o ensaio não vir a
 * sentinela VERMELHA, um "sucesso" do smoke não vale nada.
 *
 * @param {{branch?: string, marker?: string}} [opts]
 */
export function sentinelWorkflow({ branch = SENTINELA_BRANCH, marker = SENTINELA_MARKER } = {}) {
  return `# Workflow da SENTINELA do ensaio (artefato do ensaio, não do repositório).
# O job falha de propósito: o ensaio exige que o canal de veredito o veja como
# falha, senão o "verde" do smoke não seria falsificável.
name: Sentinela do ensaio (falha declarada)
on:
  push:
    branches: [${branch}]
jobs:
  sentinela:
    runs-on: ubuntu-latest
    steps:
      - name: "Sentinela — falha declarada"
        run: |
          echo "${marker}"
          exit 1
`
}

/**
 * O override do compose: o que PRECISA ser efêmero, e só isso.
 *
 * Três pontos e nada mais:
 *   1. os volumes ganham nomes do projeto efêmero — sem isso a stack
 *      escreveria nos volumes da forja de produção;
 *   2. o Gitea ganha uma porta local livre (bind em 127.0.0.1) para a API ser
 *      consultada do host;
 *   3. o CONTAINER do Gitea é renomeado. O nome declarado (`gitea`) pode estar
 *      ocupado por um container parado da produção no mesmo host, e o ensaio
 *      não remove container alheio para reusar um nome. O runner NÃO é
 *      renomeado de propósito: é o nome dele que a Prova 5 procura
 *      (`container_name` do render) — renomeá-lo faria o smoke acusar
 *      "NÃO PROVADO" por culpa do ensaio, e não da forja.
 *
 * Labels, imagens e serviços continuam vindo do compose real.
 *
 * @param {{project: string, port: number, volumeKeys: string[], giteaContainerName?: string}} args
 */
export function renderOverrideCompose({
  project,
  port,
  volumeKeys,
  giteaContainerName = `${project}-${GITEA_SERVICE}`,
}) {
  const volumes = [...volumeKeys].map((key) => `  ${key}:\n    name: ${project}-${key}`)
  return [
    "# GERADO pelo ensaio efêmero (prove-forge-smoke-ephemeral.mjs). Não editar.",
    "services:",
    `  ${GITEA_SERVICE}:`,
    `    container_name: ${giteaContainerName}`,
    "    ports:",
    `      - '127.0.0.1:${port}:3000'`,
    "volumes:",
    ...volumes,
    "",
  ].join("\n")
}

/**
 * O env do ensaio: o template comitado com o token trocado.
 *
 * O resto é preservado LITERALMENTE (registry, namespace, versão do Bun) — é o
 * que faz o runner efêmero registrar os MESMOS labels que o compose da forja
 * declara, e é o que dá sentido à Prova 5 (que compara registro × declaração).
 *
 * @param {string} template conteúdo de `deploy/env.gitea.example`
 * @param {{token: string}} args
 */
export function ephemeralEnvFile(template, { token }) {
  const lines = String(template).split("\n")
  let replaced = false
  const out = lines.map((line) => {
    if (/^\s*RUNNER_TOKEN\s*=/.test(line)) {
      replaced = true
      return `RUNNER_TOKEN=${token}`
    }
    return line
  })
  return { text: out.join("\n"), replaced }
}

/**
 * O desfecho de um `action_task.status`. Só 1 e 2 são TERMINAIS.
 *
 * @param {number|null|undefined} code
 */
export function classifyTaskStatus(code) {
  if (code === SUCCESS_STATUS) return "success"
  if (code === FAILURE_STATUS) return "failure"
  if (code === null || code === undefined) return "absent"
  return "pending"
}

/**
 * Interpreta a saída do `sqlite3 -json` do Gitea. Saída ilegível NÃO é "sem
 * tarefas": é `ok: false`, e o chamador trata como INDETERMINADO.
 *
 * @param {string} stdout
 * @returns {{ok: boolean, rows: object[], detail: string}}
 */
export function parseActionTasks(stdout) {
  const text = String(stdout ?? "").trim()
  // Com `-json`, um resultado SEM linhas imprime NADA (não "[]"). Saída vazia
  // com exit 0 é "nenhuma tarefa ainda" — o erro de verdade (tabela ausente,
  // banco ilegível) sai por exit code, e é o chamador quem o distingue.
  if (text === "") return { ok: true, rows: [], detail: "nenhuma tarefa (saída vazia)" }
  if (text === "[]") return { ok: true, rows: [], detail: "nenhuma tarefa" }
  try {
    const parsed = JSON.parse(text)
    if (!Array.isArray(parsed))
      return { ok: false, rows: [], detail: "a saída não é uma lista JSON" }
    return { ok: true, rows: parsed, detail: `${parsed.length} tarefa(s)` }
  } catch (error) {
    return { ok: false, rows: [], detail: `saída não é JSON (${error.message})` }
  }
}

/**
 * As expectativas DERIVADAS do próprio smoke. O arquivo é a fonte: um passo
 * novo entra sozinho na exigência, e um `✅` sem `echo` correspondente deixa de
 * ser exigido sem que ninguém precise lembrar de atualizar esta lista.
 *
 * Três vocabulários saem daqui:
 *   - `steps`   — os `- name:` do job (o log traz `⭐ Run Main <nome>`);
 *   - `success` — as linhas `echo "✅ …"`, truncadas na primeira interpolação
 *                 (`$`), porque a parte literal é o que dá para exigir;
 *   - `failure` — as linhas `echo "::error::…"`, o mesmo truncamento. É o que
 *                 NÃO pode aparecer num run verde.
 *   - `variables` — os `vars.<NAME>` usados pelo workflow: são exatamente as
 *                 repository variables que o ensaio precisa criar.
 *
 * @param {string} text conteúdo de `SMOKE_WORKFLOW`
 */
export function smokeExpectations(text) {
  const lines = String(text).split("\n")

  const named = lines
    .map((line) => ({
      indent: line.match(/^\s*/)[0].length,
      name: line.match(/^\s*- name:\s*(.+)$/)?.[1],
    }))
    .filter((entry) => entry.name !== undefined)
  const stepIndent = named.length > 0 ? Math.min(...named.map((entry) => entry.indent)) : -1
  const steps = named
    .filter((entry) => entry.indent === stepIndent)
    .map((entry) => entry.name.trim().replace(/^"(.*)"$/, "$1"))

  const literals = (prefix) => {
    const found = []
    for (const line of lines) {
      const m = line.match(new RegExp(`echo\\s+"${prefix}([^"$]*)`))
      if (!m) continue
      const value = `${prefix}${m[1]}`.trimEnd()
      if (value !== prefix && !found.includes(value)) found.push(value)
    }
    return found
  }

  const variables = [
    ...new Set([...String(text).matchAll(/vars\.([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1])),
  ]

  return {
    steps,
    success: literals("✅"),
    failure: literals("::error::"),
    variables,
    required: [...steps.map((name) => `${RUN_MARKER}${name}`)],
  }
}

/**
 * O veredito de um log de job, a partir das expectativas derivadas.
 *
 * Puro: recebe o texto do log e o status da tarefa, devolve o que faltou. Um
 * run verde exige TUDO: cada passo rodou, cada `✅` apareceu, nenhum `::error::`
 * apareceu e o status é sucesso. Cada uma dessas condições é reclamada
 * separadamente no relatório, para um vermelho apontar o que faltou.
 *
 * @param {{log: string, status: number|null, expectations: ReturnType<typeof smokeExpectations>}} args
 */
export function evaluateSmokeLog({ log, status, expectations }) {
  const text = String(log ?? "")
  const missingSteps = expectations.required.filter((line) => !text.includes(line))
  const missingSuccess = expectations.success.filter((line) => !text.includes(line))
  const hitFailure = [
    ...expectations.failure.filter((line) => text.includes(line)),
    ...(text.includes(ERROR_ANNOTATION) ? [ERROR_ANNOTATION] : []),
    ...(text.includes(JOB_FAILED_MARKER) ? [JOB_FAILED_MARKER] : []),
  ]
  const state = classifyTaskStatus(status)
  return {
    state,
    missingSteps,
    missingSuccess,
    hitFailure: [...new Set(hitFailure)],
    ok:
      state === "success" &&
      missingSteps.length === 0 &&
      missingSuccess.length === 0 &&
      hitFailure.length === 0,
  }
}

/**
 * Os bloqueios de SEGURANÇA do ensaio: nada de rodar em cima da forja de
 * produção.
 *
 * Duas condições, com motivos distintos:
 *   - o nome do RUNNER (declarado no compose) tem de estar livre: é esse nome
 *     que a Prova 5 usa para ler o registro, e adotar o container alheio seria
 *     ler o registro da produção;
 *   - uma stack da produção RODANDO no mesmo host é motivo para não ensaiar
 *     aqui: o ensaio não divide recurso com produção (containers PARADOS de
 *     outro projeto são tolerados — o nome do Gitea do ensaio é renomeado por
 *     isso mesmo, e container parado não executa nada).
 *
 * @param {{containers: {name: string, project?: string, running?: boolean}[], runnerName: string, ownPrefix: string, prodProject: string}} args
 * @returns {string|null}
 */
export function safetyBlocker({ containers, runnerName, ownPrefix, prodProject }) {
  const foreign = containers.filter((c) => !String(c.project ?? "").startsWith(ownPrefix))
  const collision = foreign.find((c) => c.name === runnerName)
  if (collision) {
    return `o container '${runnerName}' já existe neste host (projeto '${collision.project || "<sem projeto>"}', ${collision.running ? "RODANDO" : "parado"}) — é o nome que a Prova 5 lê, e o ensaio não adota container alheio. Remova-o (bash deploy/gitea-up.sh --check-only para inspecionar) ou rode noutro host.`
  }
  const liveProd = foreign.find((c) => c.project === prodProject && c.running)
  if (liveProd) {
    return `a stack da forja (projeto compose '${prodProject}') está RODANDO neste host (container '${liveProd.name}') — o ensaio não divide recurso com a produção. Rode-o no VPS de ensaio ou pare a stack antes.`
  }
  return null
}

/**
 * O teardown que FUNCIONA mesmo em host cujo daemon não consegue sinalizar
 * container: `docker stop`/`rm -f` respondem `permission denied` (medido: Docker
 * 29 sob snap), o container fica no ar e o ensaio seguinte encontra o nome
 * ocupado — um verde que deixa lixo para trás é pior que um vermelho.
 *
 * O recurso é o MESMO sinal que o `docker stop` mandaria (SIGTERM ao PID 1),
 * pedido de dentro do próprio container: `docker exec <nome> kill 1`. Se ainda
 * assim sobrar, o nome entra no relatório — nunca é presumido removido.
 *
 * @param {{names: string[], run?: Function, sleep?: Function, attempts?: number}} args
 * @returns {Array<{name: string, detail: string}>} o que NÃO saiu
 */
export function removeContainers({ names, run: runFn = run, sleep, attempts = 3 }) {
  const remaining = []
  for (const name of names) {
    let gone = false
    for (let i = 0; i < attempts && !gone; i += 1) {
      // A verdade é o `inspect`, NÃO o exit code do `rm -f`: neste host o docker
      // responde "Removed container" e o container continua lá. Julgar pelo exit
      // code seria declarar removido o que ficou.
      runFn("docker", ["rm", "-f", name], { timeout: 90_000 })
      const inspect = runFn("docker", ["inspect", name, "--format", "{{.State.Status}}"], {
        timeout: 30_000,
      })
      gone = inspect.status !== 0
      if (gone) break
      runFn("docker", ["exec", name, "kill", "1"], { timeout: 60_000 })
      if (typeof sleep === "function") sleep(3_000)
    }
    if (!gone)
      remaining.push({
        name,
        detail: "o daemon não conseguiu parar nem o próprio container pôde se encerrar",
      })
  }
  return remaining
}

/** Uma porta local livre (o ensaio nunca disputa uma porta fixa). */
export function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.on("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

/** O nome do projeto efêmero (prefixo + sufixo aleatório). */
export function ephemeralProject(rand = Math.random) {
  return `${PROJECT_PREFIX}-${Math.floor(rand() * 0xffffffff).toString(16)}`
}

/** A URL do repositório do ensaio no Gitea efêmero (com credencial). */
export function repoUrl({ port, owner = OWNER, repo = REPO_NAME }) {
  return `http://${owner}:${encodeURIComponent(ADMIN_PASSWORD)}@127.0.0.1:${port}/${owner}/${repo}.git`
}

/** O marcador textual do veredito (o resto da família usa a mesma escala). */
export function exitCodeFor(verdict) {
  if (verdict === "proven") return EXIT.OK
  if (verdict === "violated") return EXIT.FAILED
  if (verdict === "unavailable") return EXIT.UNAVAILABLE
  return EXIT.USAGE
}

export const USAGE = `prove-forge-smoke-ephemeral — roda o smoke da forja contra um act_runner efêmero

Usage:
  node scripts/prove-forge-smoke-ephemeral.mjs [opções]

Opções:
  --json                 mesmo veredito em JSON plano
  --keep                 não derruba a stack efêmera no fim (para inspeção)
  --source HEAD|worktree o que é empurrado (default: worktree, o que você vai comitar)
  --timeout <s>          espera por prova antes de INDETERMINADO (default: ${DEFAULT_TIMEOUT_S})
  --gitea-image <ref>    força a imagem do Gitea (default: a do compose da forja)
  --branch <nome>        branch do ensaio (default: ${SMOKE_BRANCH})
  --no-sentinela         pula o controle negativo do canal
  --sem-no-new-privileges  gera o compose do ensaio sem o hardening 'no-new-privileges' do
                         serviço runner (hosts cujo confinamento quebra o exec — o relatório diz)
  --mutacao-labels       fase 2: registra um label A MAIS e exige o smoke VERMELHO
  --help, -h             esta ajuda

Exit codes:
  0 — PROVADO: as 5 provas fecharam verdes num runner de verdade
  1 — VIOLADO: alguma prova não deixou o desfecho positivo
  2 — INDETERMINADO: sem docker/compose/imagem, produção no host, ou tempo esgotado
  3 — uso inválido
`

/**
 * @param {string[]} argv
 */
export function parseArgs(argv) {
  const opts = {
    json: false,
    keep: false,
    source: "worktree",
    timeoutS: DEFAULT_TIMEOUT_S,
    giteaImage: null,
    branch: SMOKE_BRANCH,
    sentinela: true,
    mutation: false,
    semNoNewPrivileges: false,
    help: false,
    error: null,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const value = () => {
      const v = argv[i + 1]
      if (v === undefined || v.startsWith("--")) {
        opts.error = `${arg} exige um valor`
        return null
      }
      i += 1
      return v
    }
    switch (arg) {
      case "--json":
        opts.json = true
        break
      case "--keep":
        opts.keep = true
        break
      case "--source": {
        const v = value()
        if (v === null) break
        if (v !== "HEAD" && v !== "worktree")
          opts.error = `--source aceita HEAD ou worktree (recebi '${v}')`
        else opts.source = v
        break
      }
      case "--timeout": {
        const v = value()
        if (v === null) break
        const n = Number(v)
        if (!Number.isFinite(n) || n <= 0)
          opts.error = `--timeout exige um número de segundos (recebi '${v}')`
        else opts.timeoutS = n
        break
      }
      case "--gitea-image": {
        const v = value()
        if (v !== null) opts.giteaImage = v
        break
      }
      case "--branch": {
        const v = value()
        if (v !== null) opts.branch = v
        break
      }
      case "--no-sentinela":
        opts.sentinela = false
        break
      case "--mutacao-labels":
        opts.mutation = true
        break
      case "--sem-no-new-privileges":
        opts.semNoNewPrivileges = true
        break
      case "--help":
      case "-h":
        opts.help = true
        break
      default:
        opts.error = `argumento desconhecido: ${arg}`
    }
    if (opts.error) break
  }
  return opts
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. IO — docker, compose, git e a API do Gitea efêmero
// ═══════════════════════════════════════════════════════════════════════════

/** Roda um comando e devolve o resultado cru (nunca lança). */
export function run(
  command,
  args,
  { cwd = REPO_ROOT, env = process.env, timeout = 120_000, input } = {},
) {
  const res = spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    timeout,
    maxBuffer: 64 * 1024 * 1024,
    ...(input === undefined ? {} : { input }),
  })
  return {
    status: res.status,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
    error: res.error ?? null,
  }
}

/** As strings de serviço do compose efêmero, na ordem certa (base + override). */
export function composeArgs({ project, files, envFile, rest }) {
  const args = ["compose", "-p", project]
  for (const file of files) args.push("-f", file)
  args.push("--env-file", envFile, ...rest)
  return args
}

/** O docker do host (a prova inteira é sobre ele). */
export function dockerFacts({ run: runFn = run } = {}) {
  const version = runFn("docker", ["version", "--format", "{{.Server.Version}}"], {
    timeout: 25_000,
  })
  if (version.error || version.status !== 0) {
    return {
      ok: false,
      version: null,
      detail: `docker indisponível: ${(version.error?.message ?? version.stderr ?? "").trim().split("\n")[0] || "sem resposta"}`,
    }
  }
  const compose = runFn("docker", ["compose", "version"], { timeout: 25_000 })
  if (compose.error || compose.status !== 0) {
    return {
      ok: false,
      version: version.stdout.trim(),
      detail: `docker compose indisponível: ${(compose.error?.message ?? compose.stderr ?? "").trim().split("\n")[0] || "sem resposta"}`,
    }
  }
  return {
    ok: true,
    version: version.stdout.trim(),
    compose: compose.stdout.trim(),
    detail: `docker ${version.stdout.trim()} / ${compose.stdout.trim()}`,
  }
}

/** A imagem existe LOCALMENTE? (o ensaio não baixa imagem por conta própria) */
export function imagePresent(ref, { run: runFn = run } = {}) {
  const res = runFn("docker", ["image", "inspect", ref, "--format", "{{.Id}}"], { timeout: 30_000 })
  return res.status === 0 && !res.error
}

/** O render do compose como JSON (a fonte de containers, volumes e env). */
export function renderCompose({ project, files, envFile, run: runFn = run }) {
  const res = runFn(
    "docker",
    composeArgs({ project, files, envFile, rest: ["config", "--format", "json"] }),
    { timeout: 60_000 },
  )
  if (res.error || res.status !== 0) {
    return {
      ok: false,
      config: null,
      detail: `docker compose config falhou: ${(res.stderr || res.stdout || res.error?.message || "").trim().split("\n").slice(-1)[0]}`,
    }
  }
  try {
    return { ok: true, config: JSON.parse(res.stdout), detail: "render ok" }
  } catch (error) {
    return { ok: false, config: null, detail: `o render não é JSON (${error.message})` }
  }
}

/** Uma chamada à API do Gitea efêmero (basic auth do admin do ensaio). */
export async function api({ port, method = "GET", path, body = null, timeoutMs = 20_000 }) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${OWNER}:${ADMIN_PASSWORD}`).toString("base64")}`,
        ...(body === null ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === null ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
    })
    const text = await res.text()
    return { ok: res.ok, status: res.status, text, detail: `HTTP ${res.status}` }
  } catch (error) {
    return { ok: false, status: null, text: "", detail: `sem resposta (${error.message})` }
  } finally {
    clearTimeout(timer)
  }
}

/** Espera o Gitea responder na porta local. */
export async function waitForGitea({ port, timeoutS, sleep }) {
  const deadline = Date.now() + timeoutS * 1000
  for (;;) {
    const res = await api({ port, path: "/api/healthz", timeoutMs: 5_000 })
    if (res.status === 200) return { ok: true, detail: `HTTP 200 em 127.0.0.1:${port}` }
    if (Date.now() > deadline)
      return { ok: false, detail: `o Gitea não respondeu em ${timeoutS}s (último: ${res.detail})` }
    await sleep(2_000)
  }
}

/**
 * A consulta das tarefas do ensaio no banco do Gitea, já com o workflow dono.
 *
 * Por que pelo BANCO: o Gitea 1.22 não expõe `/actions/tasks` na API (404), e
 * o que decide o veredito é o estado que a instância registrou. A leitura é de
 * um banco EFÊMERO, criado por este ensaio — nunca o da produção.
 *
 * @param {{port: number, container: string, dbPath: string, workflowFile: string, run: Function, exec: Function}} args
 */
export function readTasks({ container, dbPath, workflowFile, run: runFn = run }) {
  const sql =
    "select t.id as id, t.status as status, t.log_filename as log_filename, r.workflow_id as workflow_id, r.status as run_status " +
    "from action_task t join action_run_job j on t.job_id = j.id join action_run r on r.id = j.run_id " +
    `where r.workflow_id like '%${workflowFile}%' order by t.id;`
  // `.timeout` porque o Gitea ESCREVE nesse banco a cada transição de tarefa: sem
  // espera, a leitura morre com 'database is locked (5)' no meio de um run — e
  // um "não consegui ler" transitório não pode virar "a forja não tem runner".
  const res = runFn(
    "docker",
    ["exec", container, "sqlite3", "-cmd", ".timeout 10000", "-json", dbPath, sql],
    { timeout: 30_000 },
  )
  if (res.error || res.status !== 0) {
    return {
      ok: false,
      rows: [],
      detail: `não consegui ler as tarefas (${(res.stderr || res.error?.message || "").trim().split("\n")[0] || `exit ${res.status}`})`,
    }
  }
  return parseActionTasks(res.stdout)
}

/** Lê o log completo de um job (o Gitea o guarda dentro do volume de dados). */
export function readJobLog({ container, logPath, run: runFn = run }) {
  const res = runFn("docker", ["exec", container, "cat", logPath], { timeout: 60_000 })
  if (res.error || res.status !== 0) {
    return {
      ok: false,
      log: "",
      detail: `não consegui ler ${logPath} (${(res.stderr || res.error?.message || "").trim().split("\n")[0] || `exit ${res.status}`})`,
    }
  }
  return { ok: true, log: res.stdout, detail: `${res.stdout.length} bytes` }
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. O snapshot empurrado para o Gitea efêmero
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Os arquivos do snapshot: o worktree (default) ou o commit `HEAD`.
 *
 * O worktree é o default porque o ensaio serve para ANTES de comitar: o que
 * será comitado é o que deve ser provado. `git ls-files -co --exclude-standard`
 * dá exatamente o conteúdo do worktree (rastreados + não rastreados fora do
 * .gitignore) — o mesmo critério que o CI usaria num checkout limpo.
 *
 * @param {{cwd?: string, source?: string, run?: Function}} [args]
 */
export function snapshotFiles({ cwd = REPO_ROOT, source = "worktree", run: runFn = run } = {}) {
  const args =
    source === "HEAD"
      ? ["ls-tree", "-r", "--name-only", "-z", "HEAD"]
      : ["ls-files", "-co", "--exclude-standard", "-z"]
  const res = runFn("git", args, { cwd, timeout: 60_000 })
  if (res.error || res.status !== 0) {
    return {
      ok: false,
      files: [],
      detail: `git ${args[0]} falhou: ${(res.stderr || res.error?.message || "").trim().split("\n")[0]}`,
    }
  }
  const files = res.stdout.split("\0").filter((f) => f !== "")
  const existing = source === "HEAD" ? files : files.filter((f) => existsSync(join(cwd, f)))
  const dirty =
    source === "worktree"
      ? (runFn("git", ["status", "--porcelain"], { cwd, timeout: 30_000 }).stdout ?? "")
          .trim()
          .split("\n")
          .filter(Boolean).length
      : 0
  return {
    ok: true,
    files: existing,
    detail: `${existing.length} arquivo(s) (${source}${dirty > 0 ? `, ${dirty} entrada(s) do worktree` : ""})`,
  }
}

/** O mesmo arquivo, com o gatilho acrescentado, e sem nada mais diferente. */
export function prepareSmokeWorkflow({
  repoRoot = REPO_ROOT,
  branch = SMOKE_BRANCH,
  workflow = SMOKE_WORKFLOW,
} = {}) {
  const abs = join(repoRoot, workflow)
  if (!existsSync(abs))
    return { ok: false, detail: `${workflow} não existe — sem ele não há smoke para provar` }
  const original = readFileSync(abs, "utf8")
  const added = addPushTrigger(original, { branch })
  if (!added.ok) return { ok: false, detail: added.detail }
  const check = assertOnlyAddition(original, added.text, added.added)
  if (!check.ok) return { ok: false, detail: check.detail }
  const expectations = smokeExpectations(original)
  if (expectations.steps.length === 0) {
    return {
      ok: false,
      detail: `${workflow}: nenhum passo com nome — as expectativas deste ensaio são derivadas deles`,
    }
  }
  return {
    ok: true,
    original,
    text: added.text,
    added: added.added,
    expectations,
    detail: `${expectations.steps.length} passo(s), ${expectations.success.length} ✅, ${expectations.failure.length} mensagem(ns) de falha derivadas`,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. O ensaio
// ═══════════════════════════════════════════════════════════════════════════

/** Acumula os fatos do ensaio (a mesma forma do resto da família). */
export function newResult(partial = {}) {
  return {
    verdict: "unavailable",
    blockers: [],
    steps: [],
    facts: {},
    project: null,
    port: null,
    source: null,
    smoke: null,
    sentinela: null,
    mutation: null,
    images: {},
    deviations: [],
    residue: [],
    log: null,
    durationMs: 0,
    ...partial,
  }
}

/**
 * @param {object} [deps]
 */
export async function proveForgeSmokeEphemeral(deps = {}) {
  const {
    repoRoot = REPO_ROOT,
    opts = parseArgs([]),
    run: runFn = run,
    docker = dockerFacts({ run: runFn }),
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    now = () => Date.now(),
    apiFn = api,
    log = (line) => console.log(line),
  } = deps

  const started = now()
  const result = newResult({ source: opts.source })
  const step = (name, state, detail) => {
    const entry = { name, state, detail }
    result.steps.push(entry)
    log(`  ${state === "ok" ? "✅" : state === "skip" ? "⏭️ " : "❌"} ${name}: ${detail}`)
    return entry
  }
  const finish = (verdict, detail, blockers = []) => {
    result.verdict = verdict
    result.detail = detail
    result.blockers = [...result.blockers, ...blockers.filter(Boolean)]
    result.durationMs = now() - started
    return result
  }

  if (!docker.ok) {
    step("docker", "fail", docker.detail)
    return finish("unavailable", docker.detail, [docker.detail])
  }
  step("docker", "ok", docker.detail)

  // ── o plano: tudo derivado do repositório, nada redeclarado aqui ─────────
  const prepared = prepareSmokeWorkflow({ repoRoot, branch: opts.branch })
  if (!prepared.ok) {
    step("smoke comitado", "fail", prepared.detail)
    return finish("unavailable", prepared.detail, [prepared.detail])
  }
  step("smoke comitado", "ok", `${SMOKE_WORKFLOW}: ${prepared.detail}`)
  result.facts.expectations = {
    steps: prepared.expectations.steps,
    success: prepared.expectations.success,
    failure: prepared.expectations.failure,
    variables: prepared.expectations.variables,
  }

  const envTemplate = join(repoRoot, DEFAULT_ENV_FILE)
  if (!existsSync(envTemplate)) {
    const detail = `${DEFAULT_ENV_FILE} não existe — sem o template não há fonte única da versão nem dos labels`
    step("env da forja", "fail", detail)
    return finish("unavailable", detail, [detail])
  }
  const declared = parseEnvFile(readFileSync(envTemplate, "utf8"))
  const missingVars = prepared.expectations.variables.filter((name) => !(name in declared))
  if (missingVars.length > 0) {
    const detail = `o smoke usa ${missingVars.map((v) => `vars.${v}`).join(", ")}, que não está em ${DEFAULT_ENV_FILE} — o ensaio não inventa valor de variável`
    step("variáveis do smoke", "fail", detail)
    return finish("unavailable", detail, [detail])
  }
  step(
    "env da forja",
    "ok",
    `${DEFAULT_ENV_FILE}: ${prepared.expectations.variables.map((v) => `${v}=${declared[v]}`).join(", ")}`,
  )

  const composePath = join(repoRoot, GITEA_COMPOSE)
  if (!existsSync(composePath)) {
    const detail = `${GITEA_COMPOSE} não existe — o ensaio sobe a stack a partir DELE`
    step("compose da forja", "fail", detail)
    return finish("unavailable", detail, [detail])
  }

  const project = ephemeralProject()
  result.project = project
  const base = renderCompose({ project, files: [composePath], envFile: envTemplate, run: runFn })
  if (!base.ok) {
    step("render do compose", "fail", base.detail)
    return finish("unavailable", base.detail, [base.detail])
  }
  const baseServices = base.config.services ?? {}
  const giteaService = baseServices[GITEA_SERVICE]
  const runnerService = baseServices[RUNNER_SERVICE]
  if (!giteaService || !runnerService) {
    const detail = `${GITEA_COMPOSE}: falta o serviço '${GITEA_SERVICE}' ou '${RUNNER_SERVICE}' — o ensaio não sobe uma stack que a forja não declara`
    step("render do compose", "fail", detail)
    return finish("unavailable", detail, [detail])
  }

  const giteaImage = opts.giteaImage ?? giteaService.image
  const runnerImage = runnerService.image
  result.images = {
    gitea: giteaImage,
    runner: runnerImage,
    job:
      String(runnerService.environment?.GITEA_RUNNER_LABELS ?? "")
        .split("docker://")[1]
        ?.split(",")[0] ?? null,
  }
  step("imagens do compose", "ok", `gitea=${giteaImage} runner=${runnerImage}`)

  if (!imagePresent(giteaImage, { run: runFn })) {
    const detail = `a imagem '${giteaImage}' não existe localmente — o ensaio não baixa imagem por conta própria (docker pull ${giteaImage})`
    step("imagem do Gitea", "fail", detail)
    return finish("unavailable", detail, [detail])
  }
  if (!imagePresent(runnerImage, { run: runFn })) {
    const detail = `a imagem '${runnerImage}' não existe localmente (docker pull ${runnerImage})`
    step("imagem do runner", "fail", detail)
    return finish("unavailable", detail, [detail])
  }
  if (!imagePresent(result.images.job, { run: runFn })) {
    const detail = `a imagem do job ('${result.images.job}', o alvo do label do runner) não existe localmente: sem ela nenhum job inicia (bun run runner-image:ensure)`
    step("imagem do job", "fail", detail)
    return finish("unavailable", detail, [detail])
  }
  step(
    "imagem do job",
    "ok",
    `o label do runner aponta para ${result.images.job} — é a imagem que roda o smoke`,
  )

  // ── segurança: nada de produção ──────────────────────────────────────────
  const runnerName =
    typeof runnerService.container_name === "string" && runnerService.container_name !== ""
      ? runnerService.container_name
      : `${RUNNER_SERVICE}`
  const prodProject = dirname(GITEA_COMPOSE).split("/").filter(Boolean).pop() ?? "deploy"
  const listContainers = () => {
    const ps = runFn(
      "docker",
      ["ps", "-a", "--format", '{{.Names}}\t{{.State}}\t{{.Label "com.docker.compose.project"}}'],
      { timeout: 30_000 },
    )
    return String(ps.stdout ?? "")
      .split("\n")
      .map((line) => line.split("\t"))
      .filter((parts) => parts[0])
      .map((parts) => ({
        name: parts[0].trim(),
        running: (parts[1] ?? "").trim() === "running",
        project: (parts[2] ?? "").trim(),
      }))
  }
  const containers = listContainers()
  const leftovers = containers.filter((c) => String(c.project ?? "").startsWith(PROJECT_PREFIX))
  if (leftovers.length > 0) {
    const stuck = removeContainers({ names: leftovers.map((c) => c.name), run: runFn, sleep })
    step(
      "resíduo de ensaio anterior",
      stuck.length === 0 ? "ok" : "fail",
      stuck.length === 0
        ? `${leftovers.length} container(es) do prefixo '${PROJECT_PREFIX}' removido(s) (são deste ensaio)`
        : `${stuck.length} container(es) do prefixo '${PROJECT_PREFIX}' NÃO puderam ser removidos (${stuck.map((s) => s.name).join(", ")}) — reinicie o docker deste host`,
    )
    if (stuck.length > 0) {
      const detail = `há resíduo de ensaio anterior que este host não deixa remover (${stuck.map((s) => s.name).join(", ")}) — sem o nome '${runnerName}' livre, o ensaio não consegue provar a Prova 5`
      return finish("unavailable", detail, [detail])
    }
  }
  const afterCleanup = listContainers()
  const blocker = safetyBlocker({
    containers: afterCleanup,
    runnerName,
    ownPrefix: PROJECT_PREFIX,
    prodProject,
  })
  if (blocker) {
    step("segurança (produção)", "fail", blocker)
    return finish("unavailable", blocker, [blocker])
  }
  step(
    "segurança (produção)",
    "ok",
    `'${runnerName}' livre e nenhuma stack de '${prodProject}' rodando neste host`,
  )

  // ── o material do ensaio (efêmero, fora do repositório) ─────────────────
  const snapshot = snapshotFiles({ cwd: repoRoot, source: opts.source, run: runFn })
  if (!snapshot.ok) {
    step("snapshot", "fail", snapshot.detail)
    return finish("unavailable", snapshot.detail, [snapshot.detail])
  }
  step("snapshot", "ok", snapshot.detail)

  const work = mkdtempSync(join(tmpdir(), `${PROJECT_PREFIX}-`))
  const repoDir = join(work, "ensaio")
  const overridePath = join(work, "override.compose.yml")
  const mutationPath = join(work, "override.mutacao.yml")
  const envPath = join(work, "env.gitea")
  const stackComposePath = join(work, "compose.sem-hardening.yml")
  const volumeKeys = Object.keys(base.config.volumes ?? {})
  const port = await freePort()
  result.port = port
  const giteaContainer = `${project}-${GITEA_SERVICE}`

  // O texto do compose que a STACK do ensaio usa. Sem a flag, é o comitado, byte
  // a byte. Com `--sem-no-new-privileges`, é uma cópia com uma linha a menos no
  // serviço `runner` — verificada linha a linha e DECLARADA no relatório.
  let stackBase = { path: composePath, detail: "compose comitado, sem alteração" }
  if (opts.semNoNewPrivileges) {
    const strip = stripRunnerHardening(readFileSync(composePath, "utf8"))
    if (!strip.ok) {
      step("compose do ensaio", "fail", strip.detail)
      return finish("unavailable", strip.detail, [strip.detail])
    }
    const only = assertOnlyRemoval(readFileSync(composePath, "utf8"), strip.text, strip.removal)
    if (!only.ok) {
      step("compose do ensaio", "fail", only.detail)
      return finish("unavailable", only.detail, [only.detail])
    }
    writeFileSync(stackComposePath, strip.text)
    stackBase = { path: stackComposePath, detail: `${strip.detail} (${only.detail})` }
    step("compose do ensaio", "ok", stackBase.detail)
  }
  const stackFiles = [stackBase.path, overridePath]

  const projectContainers = () => {
    const ps2 = runFn(
      "docker",
      ["ps", "-a", "--format", '{{.Names}}\t{{.Label "com.docker.compose.project"}}'],
      { timeout: 30_000 },
    )
    return String(ps2.stdout ?? "")
      .split("\n")
      .map((line) => line.split("\t"))
      .filter((parts) => parts[0])
      .map((parts) => ({ name: parts[0].trim(), project: (parts[1] ?? "").trim() }))
      .filter((c) => c.project === project || c.name.startsWith(`${project}-`))
  }

  const cleanupFn = ({ keep = opts.keep } = {}) => {
    if (keep) {
      log(`  ⏭️  stack mantida (--keep): projeto ${project}, Gitea em 127.0.0.1:${port}`)
      return
    }
    runFn(
      "docker",
      composeArgs({
        project,
        files: stackFiles,
        envFile: envPath,
        rest: ["down", "-v", "--remove-orphans"],
      }),
      { timeout: 180_000 },
    )
    // O teardown é REPORTADO, não presumido: em host cujo daemon não consegue
    // parar o container (medido: 'permission denied' no stop), o `down` não
    // remove nada e um ensaio "verde" deixaria a stack para trás em silêncio.
    const jobNames = String(
      runFn("docker", ["ps", "-a", "--format", "{{.Names}}"], { timeout: 30_000 }).stdout ?? "",
    )
      .split("\n")
      .map((n) => n.trim())
      .filter((n) => n.startsWith("GITEA-ACTIONS-TASK-"))
    const stuck = removeContainers({
      names: [...projectContainers().map((c) => c.name), ...jobNames],
      run: runFn,
      sleep,
    })
    if (stuck.length > 0) {
      log(
        `  ⚠️  resíduo: ${stuck.length} container(es) não puderam ser removidos neste host — remova à mão: ${stuck.map((c) => c.name).join(", ")}`,
      )
      result.residue = stuck.map((c) => c.name)
    }
    rmSync(work, { recursive: true, force: true })
  }

  try {
    mkdirSync(repoDir, { recursive: true })
    for (const rel of snapshot.files) {
      const dst = join(repoDir, rel)
      mkdirSync(dirname(dst), { recursive: true })
      copyFileSync(join(repoRoot, rel), dst)
    }
    writeFileSync(join(repoDir, SMOKE_WORKFLOW), prepared.text)
    if (opts.sentinela)
      writeFileSync(
        join(repoDir, SENTINELA_WORKFLOW),
        sentinelWorkflow({ branch: SENTINELA_BRANCH }),
      )
    writeFileSync(
      overridePath,
      renderOverrideCompose({ project, port, volumeKeys, giteaContainerName: giteaContainer }),
    )
    writeFileSync(
      envPath,
      `${ephemeralEnvFile(readFileSync(envTemplate, "utf8"), { token: "PLACEHOLDER" }).text}\n`,
    )

    const gitEnv = {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      GIT_AUTHOR_NAME: "prova",
      GIT_AUTHOR_EMAIL: "prova@example.com",
      GIT_COMMITTER_NAME: "prova",
      GIT_COMMITTER_EMAIL: "prova@example.com",
    }
    const gitSteps = [
      ["init", "-q", "-b", opts.branch, "."],
      ["add", "-A"],
      ["commit", "-q", "-m", "ensaio do smoke da forja"],
    ]
    for (const args of gitSteps) {
      const res = runFn("git", args, { cwd: repoDir, env: gitEnv, timeout: 120_000 })
      if (res.error || res.status !== 0)
        throw new Error(
          `git ${args[0]} falhou: ${(res.stderr || res.error?.message || "").trim().split("\n")[0]}`,
        )
    }
    step(
      "material do ensaio",
      "ok",
      `${snapshot.files.length} arquivo(s) + gatilho; projeto ${project}, porta ${port}`,
    )

    // ── a stack, em duas fases (o token do runner nasce NO Gitea) ──────────
    const upGitea = runFn(
      "docker",
      composeArgs({
        project,
        files: stackFiles,
        envFile: envPath,
        rest: ["up", "-d", GITEA_SERVICE],
      }),
      { timeout: 300_000 },
    )
    if (upGitea.error || upGitea.status !== 0)
      throw new Error(
        `docker compose up -d ${GITEA_SERVICE} falhou: ${(upGitea.stderr || upGitea.stdout || upGitea.error?.message || "").trim().split("\n").slice(-1)[0]}`,
      )
    const healthy = await waitForGitea({ port, timeoutS: 180, sleep })
    if (!healthy.ok) throw new Error(healthy.detail)
    step("Gitea efêmero", "ok", healthy.detail)

    const createUser = runFn(
      "docker",
      [
        "exec",
        "-u",
        "git",
        giteaContainer,
        "gitea",
        "admin",
        "user",
        "create",
        "--username",
        OWNER,
        "--password",
        ADMIN_PASSWORD,
        "--email",
        `${OWNER}@example.com`,
        "--admin",
        "--must-change-password=false",
      ],
      { timeout: 120_000 },
    )
    if (createUser.error || createUser.status !== 0)
      throw new Error(
        `não consegui criar o admin do ensaio: ${(createUser.stderr || createUser.stdout || createUser.error?.message || "").trim().split("\n")[0]}`,
      )
    const tokenRes = runFn(
      "docker",
      ["exec", "-u", "git", giteaContainer, "gitea", "actions", "generate-runner-token"],
      { timeout: 120_000 },
    )
    const token =
      String(tokenRes.stdout ?? "")
        .trim()
        .split("\n")
        .filter(Boolean)
        .pop() ?? ""
    if (tokenRes.error || tokenRes.status !== 0 || token === "")
      throw new Error(
        `não consegui gerar o token do runner: ${(tokenRes.stderr || tokenRes.error?.message || "").trim().split("\n")[0] || "saída vazia"}`,
      )
    writeFileSync(
      envPath,
      `${ephemeralEnvFile(readFileSync(envTemplate, "utf8"), { token }).text}\n`,
    )
    step(
      "credenciais do ensaio",
      "ok",
      "admin criado e token do runner gerado pelo próprio Gitea efêmero",
    )

    const createRepo = await apiFn({
      port,
      method: "POST",
      path: "/api/v1/user/repos",
      body: { name: REPO_NAME, auto_init: false, default_branch: opts.branch },
    })
    if (!createRepo.ok)
      throw new Error(
        `não consegui criar o repositório do ensaio: ${createRepo.detail} ${createRepo.text.slice(0, 200)}`,
      )
    for (const name of prepared.expectations.variables) {
      const setVar = await apiFn({
        port,
        method: "POST",
        path: `/api/v1/repos/${OWNER}/${REPO_NAME}/actions/variables/${name}`,
        body: { value: declared[name] },
      })
      if (!setVar.ok)
        throw new Error(
          `não consegui criar a repository variable ${name}: ${setVar.detail} ${setVar.text.slice(0, 200)}`,
        )
    }
    step(
      "repositório do ensaio",
      "ok",
      `${OWNER}/${REPO_NAME} + ${prepared.expectations.variables.length} variável(is): ${prepared.expectations.variables.join(", ")}`,
    )

    const url = repoUrl({ port })
    const push = (branch) =>
      runFn("git", ["push", "-q", url, `HEAD:refs/heads/${branch}`], {
        cwd: repoDir,
        env: gitEnv,
        timeout: 300_000,
      })
    if (opts.sentinela) {
      const res = push(SENTINELA_BRANCH)
      if (res.error || res.status !== 0)
        throw new Error(
          `git push (sentinela) falhou: ${(res.stderr || res.error?.message || "").trim().split("\n").slice(-1)[0]}`,
        )
    }
    const resSmoke = push(opts.branch)
    if (resSmoke.error || resSmoke.status !== 0)
      throw new Error(
        `git push (${opts.branch}) falhou: ${(resSmoke.stderr || resSmoke.error?.message || "").trim().split("\n").slice(-1)[0]}`,
      )
    step(
      "push",
      "ok",
      `branch '${opts.branch}'${opts.sentinela ? ` + '${SENTINELA_BRANCH}'` : ""} empurrado(s) para o Gitea efêmero`,
    )

    const upRunner = runFn(
      "docker",
      composeArgs({
        project,
        files: stackFiles,
        envFile: envPath,
        rest: ["up", "-d", RUNNER_SERVICE],
      }),
      { timeout: 300_000 },
    )
    if (upRunner.error || upRunner.status !== 0)
      throw new Error(
        `docker compose up -d ${RUNNER_SERVICE} falhou: ${(upRunner.stderr || upRunner.stdout || upRunner.error?.message || "").trim().split("\n").slice(-1)[0]}`,
      )

    // A espera é por REGISTRO, não por "o compose não deu erro": um container
    // que morre no exec do entrypoint (`exec /sbin/tini: operation not
    // permitted`) sobe e cai em silêncio, e o único sintoma seria "nenhum job
    // roda" — que é exatamente o diagnóstico que este ensaio não pode deixar
    // vago. Aqui o estado do container e a última linha do log entram no
    // veredito, com o remédio quando ele é conhecido.
    const runnerReady = await (async () => {
      const deadline = now() + Math.max(60, Math.round(opts.timeoutS / 4)) * 1000
      for (;;) {
        const inspect = runFn("docker", ["inspect", runnerName, "--format", "{{.State.Status}}"], {
          timeout: 30_000,
        })
        const state = inspect.status === 0 ? String(inspect.stdout).trim() : null
        const logs = runFn("docker", ["logs", runnerName], { timeout: 30_000 })
        const tail = String(logs.stderr ?? "") + String(logs.stdout ?? "")
        if (tail.includes("Runner registered successfully."))
          return { ok: true, state, detail: `container '${runnerName}' registrado (${state})` }
        if (
          state !== null &&
          state !== "running" &&
          state !== "created" &&
          state !== "restarting"
        ) {
          const last = tail.trim().split("\n").filter(Boolean).slice(-1)[0] ?? "<sem log>"
          const execBlocked = /operation not permitted/i.test(tail)
          const hint =
            execBlocked && !opts.semNoNewPrivileges
              ? ` A causa medida é o hardening 'no-new-privileges:true' do serviço ${RUNNER_SERVICE} neste host: rode com --sem-no-new-privileges (o relatório diz o que isso muda).`
              : ""
          return {
            ok: false,
            state,
            detail: `o runner '${runnerName}' não ficou no ar (estado '${state}'): ${last}.${hint}`,
          }
        }
        if (now() > deadline) {
          const last = tail.trim().split("\n").filter(Boolean).slice(-1)[0] ?? "<sem log>"
          return {
            ok: false,
            state,
            detail: `o runner '${runnerName}' não registrou em ${Math.round(Math.max(60, opts.timeoutS / 4))}s (estado '${state}'): ${last}`,
          }
        }
        await sleep(3_000)
      }
    })()
    if (!runnerReady.ok) {
      step("runner efêmero", "fail", runnerReady.detail)
      return finish("unavailable", runnerReady.detail, [runnerReady.detail])
    }
    step("runner efêmero", "ok", runnerReady.detail)
    if (!opts.sentinela)
      step("segurança (sentinela)", "skip", "controle negativo pulado (--no-sentinela)")

    // ── o banco do ensaio: onde o veredito de cada tarefa vive ─────────────
    const dbPath = String(giteaService.environment?.GITEA__database__PATH ?? "/data/gitea/gitea.db")
    const dataVolume = (giteaService.volumes ?? []).find(
      (m) => m && m.type === "volume" && String(m.target).startsWith("/data"),
    )
    if (!dataVolume)
      throw new Error(
        `${GITEA_COMPOSE}: o serviço '${GITEA_SERVICE}' não monta o volume de dados (/data) — sem ele não há banco nem log para ler`,
      )
    const logDir = join(dirname(dbPath), "actions_log")

    /**
     * Espera uma tarefa TERMINAL do workflow, ignorando o que já existia.
     *
     * `afterId` é o que torna a segunda volta possível (a mutação): sem ele, a
     * leitura acharia imediatamente a tarefa da PRIMEIRA execução e o ensaio
     * compararia o log velho — um verde por acidente é pior que um vermelho.
     */
    const waitTask = async ({ workflowFile, timeoutS, afterId = 0 }) => {
      const deadline = now() + timeoutS * 1000
      let lastReadError = null
      for (;;) {
        const tasks = readTasks({ container: giteaContainer, dbPath, workflowFile, run: runFn })
        if (tasks.ok) {
          lastReadError = null
          const rows = tasks.rows.filter((row) => Number(row.id) > afterId)
          const done =
            rows
              .filter((row) => classifyTaskStatus(Number(row.status)) !== "pending")
              .slice(-1)[0] ?? null
          if (done) return { ok: true, task: done, rows: tasks.rows }
          if (now() > deadline) {
            const running = rows.slice(-1)[0]
            return {
              ok: false,
              detail: `o job não terminou em ${timeoutS}s (última tarefa: status ${running ? running.status : "<nenhuma>"})`,
            }
          }
        } else {
          // Erro TRANSITÓRIO de leitura (banco travado por uma escrita do Gitea,
          // por exemplo) não encerra a espera: só o prazo encerra, e aí o último
          // erro entra no veredito em vez de sumir.
          lastReadError = tasks.detail
          if (now() > deadline)
            return {
              ok: false,
              detail: `não consegui ler as tarefas até ${timeoutS}s: ${lastReadError}`,
            }
        }
        await sleep(5_000)
      }
    }

    if (opts.sentinela) {
      const sent = await waitTask({
        workflowFile: "prova-sentinela",
        timeoutS: Math.max(120, Math.round(opts.timeoutS / 3)),
      })
      if (!sent.ok) throw new Error(`a sentinela não deu desfecho: ${sent.detail}`)
      const sentLog = readJobLog({
        container: giteaContainer,
        logPath: join(logDir, String(sent.task.log_filename)),
        run: runFn,
      })
      const sentState = classifyTaskStatus(Number(sent.task.status))
      const marker = sentLog.ok && sentLog.log.includes(SENTINELA_MARKER)
      const tail = sentLog.log.trim().split("\n").slice(-1)[0] ?? "<log vazio>"
      result.sentinela = {
        status: Number(sent.task.status),
        state: sentState,
        marker,
        log: String(sent.task.log_filename),
        detail: sentLog.detail,
      }
      if (sentState !== "failure" || !marker) {
        // FALHA SEM PASSO RODADO não é a sentinela funcionando: é o runner que
        // não executou o job (o act_runner marca a tarefa como falha e o log não
        // tem nenhum `⭐ Run Main`). Tratar isso como "o canal vê vermelho"
        // seria tomar um problema de HOST por prova de rigor.
        if (!sentLog.log.includes(RUN_MARKER)) {
          const detail = `a sentinela terminou em falha (status ${sent.task.status}) SEM rodar nenhum passo — o runner não executou o job. Log: ${String(sent.task.log_filename)} (${sentLog.detail}). Últimas linhas: ${tail.slice(0, 300)}`
          step("sentinela (canal vê vermelho)", "fail", detail)
          return finish("unavailable", detail, [
            "o runner efêmero não executou job algum neste host",
          ])
        }
        step(
          "sentinela (canal vê vermelho)",
          "fail",
          `esperava falha com a linha da sentinela; veio status ${sent.task.status} (${sentState}), marcador=${marker}, log=${sentLog.detail}, última linha: ${tail.slice(0, 200)}`,
        )
        return finish(
          "violated",
          "o canal de veredito NÃO viu a sentinela vermelha — um verde do smoke não seria falsificável",
          ["a sentinela não foi vista como falha"],
        )
      }
      step(
        "sentinela (canal vê vermelho)",
        "ok",
        `job que falha é visto como status ${sent.task.status} com a linha da sentinela no log — o canal não é cego`,
      )
    }

    const smokeTask = await waitTask({
      workflowFile: "forge-smoke",
      timeoutS: opts.timeoutS,
      afterId: 0,
    })
    if (!smokeTask.ok) throw new Error(`o smoke não deu desfecho: ${smokeTask.detail}`)
    const logText = readJobLog({
      container: giteaContainer,
      logPath: join(logDir, String(smokeTask.task.log_filename)),
      run: runFn,
    })
    if (!logText.ok) throw new Error(`não consegui ler o log do smoke: ${logText.detail}`)
    result.log = logText.log
    const evaluation = evaluateSmokeLog({
      log: logText.log,
      status: Number(smokeTask.task.status),
      expectations: prepared.expectations,
    })
    result.smoke = {
      status: Number(smokeTask.task.status),
      state: evaluation.state,
      missingSteps: evaluation.missingSteps,
      missingSuccess: evaluation.missingSuccess,
      hitFailure: evaluation.hitFailure,
      log: String(smokeTask.task.log_filename),
      durationMs: null,
    }
    step(
      "smoke (5 provas)",
      evaluation.ok ? "ok" : "fail",
      `status ${smokeTask.task.status} (${evaluation.state}), ${prepared.expectations.steps.length - evaluation.missingSteps.length}/${prepared.expectations.steps.length} passo(s), ${prepared.expectations.success.length - evaluation.missingSuccess.length}/${prepared.expectations.success.length} ✅`,
    )

    // Falha do job SEM nenhum passo rodado: é o runner que não executou o job
    // (host), e não o smoke que ficou vermelho. A distinção é a diferença entre
    // "a forja reprovou" e "eu não consegui medir" — e ela decide o exit code.
    if (!logText.log.includes(RUN_MARKER)) {
      const detail = `o job do smoke terminou com status ${smokeTask.task.status} (${evaluation.state}) SEM rodar nenhum passo — o runner efêmero não executou o job neste host. Log: ${String(smokeTask.task.log_filename)} (${logText.detail})`
      step("smoke executou?", "fail", detail)
      return finish("unavailable", detail, [
        "o runner efêmero não executou o job do smoke neste host",
      ])
    }

    if (!evaluation.ok) {
      for (const line of evaluation.missingSteps) step("passo ausente no log", "fail", line)
      for (const line of evaluation.missingSuccess)
        step("desfecho positivo ausente no log", "fail", line)
      for (const line of evaluation.hitFailure) step("marca de falha no log", "fail", line)
      return finish(
        "violated",
        "o smoke não fechou verde no runner efêmero — cada linha acima diz o que faltou ou o que apareceu",
        evaluation.hitFailure,
      )
    }

    for (const name of prepared.expectations.steps)
      step(`prova: ${name}`, "ok", "rodou e deixou o desfecho positivo no log")

    // ── fase 2 (opcional): a mutação que a Prova 5 tem de pegar ────────────
    if (opts.mutation) {
      // A mutação é do REGISTRO, não do arquivo: o runner é re-registrado
      // declarando um label a MAIS que o compose não tem — exatamente o defeito
      // que a Prova 5 existe para ver (label que ninguém usa, invisível para as
      // provas 2 e 3 porque nenhum job pediu esse label).
      const declaredLabels = String(runnerService.environment?.GITEA_RUNNER_LABELS ?? "")
      if (declaredLabels === "")
        throw new Error(
          `${GITEA_COMPOSE}: não consegui ler GITEA_RUNNER_LABELS do render — a mutação seria adivinhação`,
        )
      const jobImage = declaredLabels.split("docker://")[1]?.split(",")[0]
      if (!jobImage)
        throw new Error(
          `${GITEA_COMPOSE}: o label declarado não tem imagem (docker://…) — a mutação não teria para onde apontar`,
        )
      writeFileSync(
        mutationPath,
        [
          "# GERADO pelo ensaio efêmero: a mutação do label a mais. Não editar.",
          `# O runner passa a declarar '${MUTATION_LABEL_NAME}', que o compose NÃO declara.`,
          "services:",
          `  ${RUNNER_SERVICE}:`,
          "    environment:",
          `      - GITEA_RUNNER_LABELS=${declaredLabels},${MUTATION_LABEL_NAME}:docker://${jobImage}`,
          "",
        ].join("\n"),
      )
      const runnerVolumeMount = (runnerService.volumes ?? []).find((m) => m && m.type === "volume")
      if (!runnerVolumeMount)
        throw new Error(
          `${GITEA_COMPOSE}: o runner não monta volume nomeado — sem ele o registro velho sobreviveria e a mutação não valeria nada`,
        )
      const rmRunner = runFn(
        "docker",
        composeArgs({
          project,
          files: stackFiles,
          envFile: envPath,
          rest: ["rm", "-sf", RUNNER_SERVICE],
        }),
        { timeout: 180_000 },
      )
      if (rmRunner.error || rmRunner.status !== 0)
        throw new Error(
          `não consegui remover o runner para a mutação: ${(rmRunner.stderr || "").trim().split("\n").slice(-1)[0]}`,
        )
      runFn("docker", ["volume", "rm", `${project}-${runnerVolumeMount.source ?? "runner-data"}`], {
        timeout: 120_000,
      })
      const freshToken = runFn(
        "docker",
        ["exec", "-u", "git", giteaContainer, "gitea", "actions", "generate-runner-token"],
        { timeout: 120_000 },
      )
      const mutationToken =
        String(freshToken.stdout ?? "")
          .trim()
          .split("\n")
          .filter(Boolean)
          .pop() ?? ""
      if (freshToken.status !== 0 || mutationToken === "")
        throw new Error("não consegui gerar um token novo para o re-registro da mutação")
      writeFileSync(
        envPath,
        `${ephemeralEnvFile(readFileSync(envTemplate, "utf8"), { token: mutationToken }).text}\n`,
      )
      const upMutated = runFn(
        "docker",
        composeArgs({
          project,
          files: [...stackFiles, mutationPath],
          envFile: envPath,
          rest: ["up", "-d", RUNNER_SERVICE],
        }),
        { timeout: 300_000 },
      )
      if (upMutated.error || upMutated.status !== 0)
        throw new Error(
          `não consegui subir o runner mutado: ${(upMutated.stderr || upMutated.stdout || "").trim().split("\n").slice(-1)[0]}`,
        )
      await sleep(10_000)
      const emptyCommit = runFn(
        "git",
        ["commit", "-q", "--allow-empty", "-m", "ensaio: mutacao do label"],
        { cwd: repoDir, env: gitEnv, timeout: 60_000 },
      )
      if (emptyCommit.error || emptyCommit.status !== 0)
        throw new Error("não consegui criar o commit da mutação")
      const pushMutated = push(opts.branch)
      if (pushMutated.error || pushMutated.status !== 0)
        throw new Error(
          `git push (mutação) falhou: ${(pushMutated.stderr || "").trim().split("\n").slice(-1)[0]}`,
        )
      const mutatedTask = await waitTask({
        workflowFile: "forge-smoke",
        timeoutS: opts.timeoutS,
        afterId: Number(smokeTask.task.id),
      })
      if (!mutatedTask.ok)
        throw new Error(`a fase de mutação não deu desfecho: ${mutatedTask.detail}`)
      const mutatedLog = readJobLog({
        container: giteaContainer,
        logPath: join(logDir, String(mutatedTask.task.log_filename)),
        run: runFn,
      })
      const mutatedEval = evaluateSmokeLog({
        log: mutatedLog.log,
        status: Number(mutatedTask.task.status),
        expectations: prepared.expectations,
      })
      const pro5 = prepared.expectations.failure.find((line) => /REGISTRO VELHO/.test(line))
      result.mutation = {
        status: Number(mutatedTask.task.status),
        state: mutatedEval.state,
        missingSuccess: mutatedEval.missingSuccess,
        hitFailure: mutatedEval.hitFailure,
        pro5Caught: pro5
          ? mutatedEval.hitFailure.includes(pro5)
          : mutatedEval.hitFailure.length > 0,
      }
      if (mutatedEval.state !== "failure" || !result.mutation.pro5Caught) {
        step(
          "mutação do label a mais",
          "fail",
          `esperava um smoke VERMELHO apontando o registro; veio status ${mutatedTask.task.status} (${mutatedEval.state})`,
        )
        return finish(
          "violated",
          "a Prova 5 NÃO mordeu a mutação de label — o guard contra registro velho passaria numa stack divergente",
          ["mutação de label não deixou o smoke vermelho"],
        )
      }
      step(
        "mutação do label a mais",
        "ok",
        `o smoke ficou VERMELHO (status ${mutatedTask.task.status}) e a Prova 5 acusou o registro; ${mutatedEval.missingSuccess.length} desfecho(s) positivo(s) deixaram de aparecer`,
      )
    }

    return finish(
      "proven",
      `as ${prepared.expectations.steps.length} provas do smoke rodaram num act_runner efêmero e fecharam verdes${opts.mutation ? "; a mutação de label deixou o smoke vermelho na Prova 5" : ""}`,
    )
  } catch (error) {
    const detail = error?.message ?? String(error)
    step("ensaio", "fail", detail)
    const unavailable =
      /não terminou|não subiu|não respondeu|não existe localmente|não consegui ler/.test(detail)
    return finish(unavailable ? "unavailable" : "violated", detail, [detail])
  } finally {
    cleanupFn()
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. Relatório e CLI
// ═══════════════════════════════════════════════════════════════════════════

export function renderReport(result, { emit = console.log } = {}) {
  const line = (s = "") => emit(s)
  const badge =
    result.verdict === "proven"
      ? "✅ PROVADO"
      : result.verdict === "violated"
        ? "❌ VIOLADO"
        : "⚠️  INDETERMINADO"
  line("")
  line("═".repeat(78))
  line(`  prove-forge-smoke-ephemeral — ${badge}`)
  line("═".repeat(78))
  line(`  projeto efêmero : ${result.project ?? "<não subiu>"}`)
  line(`  Gitea local     : 127.0.0.1:${result.port ?? "?"} (efêmero; nada de produção foi tocado)`)
  line(`  snapshot        : ${result.source}`)
  line(
    `  imagens         : gitea=${result.images.gitea ?? "?"} runner=${result.images.runner ?? "?"} job=${result.images.job ?? "?"}`,
  )
  line(`  duração         : ${(result.durationMs / 1000).toFixed(1)}s`)
  line("")
  for (const s of result.steps)
    line(`  ${s.state === "ok" ? "✅" : s.state === "skip" ? "⏭️ " : "❌"} ${s.name}: ${s.detail}`)
  if (result.smoke) {
    line("")
    line(`  smoke: status=${result.smoke.status} (${result.smoke.state}) log=${result.smoke.log}`)
  }
  if (result.sentinela) {
    line(
      `  sentinela: status=${result.sentinela.status} (${result.sentinela.state}) marcador=${result.sentinela.marker}`,
    )
  }
  if (result.mutation) {
    line(
      `  mutação de label: status=${result.mutation.status} (${result.mutation.state}) Prova 5 acusou=${result.mutation.pro5Caught}`,
    )
  }
  line("")
  line(`  VEREDITO: ${badge} — ${result.detail ?? ""}`)
  if (result.deviations.length > 0) {
    line("")
    line("  Desvios declarados:")
    for (const d of result.deviations) line(`   • ${d}`)
  }
  if (result.residue && result.residue.length > 0) {
    line("")
    line(`  Resíduo (o host recusou remover): ${result.residue.join(", ")}`)
  }
  if (result.blockers.length > 0) {
    line("")
    line("  Bloqueios:")
    for (const b of result.blockers) line(`   • ${b}`)
  }
  line("═".repeat(78))
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.error) {
    console.error(`❌ ${opts.error}`)
    console.error(USAGE)
    process.exit(EXIT.USAGE)
  }
  if (opts.help) {
    console.log(USAGE)
    process.exit(EXIT.OK)
  }

  const prepared = prepareSmokeWorkflow({ branch: opts.branch })
  const deviations = []
  if (prepared.ok) {
    deviations.push(
      `gatilho: ${prepared.added.join(" / ")} ACRESCENTADO ao \`on:\` do smoke (o Gitea 1.22 não tem workflow_dispatch — medido). A única diferença entre o arquivo empurrado e o comitado são essas linhas.`,
    )
  }
  if (opts.sentinela) {
    deviations.push(
      `a sentinela (${SENTINELA_WORKFLOW} em '${SENTINELA_BRANCH}') é artefato do ensaio, não do repositório.`,
    )
  }
  deviations.push(
    "container do Gitea: renomeado para '<projeto>-gitea' no ensaio (o nome declarado no compose pode estar ocupado por um container PARADO no host, e o ensaio não remove container alheio). O runner mantém o nome declarado de propósito — é o nome que a Prova 5 usa para ler o registro.",
  )
  if (opts.semNoNewPrivileges) {
    deviations.push(
      "STACK DO ENSAIO DIFERE DA PRODUÇÃO: 'no-new-privileges:true' foi removido do serviço runner (a única diferença no texto do compose). Sem isso, neste host, o hardening quebra qualquer exec dentro do container e o runner não sobe — medido com o próprio gitea/act_runner, com alpine puro e com sh/tini.",
    )
  }

  if (!opts.json) {
    console.log("")
    console.log("═".repeat(78))
    console.log("  prove-forge-smoke-ephemeral — smoke da forja num act_runner EFÊMERO")
    console.log("═".repeat(78))
    console.log(
      "  stack: o MESMO deploy/docker-compose.gitea.yml, efêmero (volumes e porta próprios)",
    )
    console.log("  veredito: action_task.status do Gitea efêmero + o log completo do job")
  }

  const result = await proveForgeSmokeEphemeral({ opts })
  result.deviations = deviations
  if (opts.json) console.log(JSON.stringify(result, null, 2))
  else renderReport(result)
  process.exit(exitCodeFor(result.verdict))
}

const IS_DIRECT_RUN = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url
if (IS_DIRECT_RUN) {
  main().catch((error) => {
    console.error(`❌ erro fatal no ensaio: ${error?.message ?? error}`)
    process.exit(EXIT.UNAVAILABLE)
  })
}
