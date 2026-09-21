#!/usr/bin/env node

// =============================================================================
// pr-remedy-comment.mjs
//
// O REMENDO vai ao PR como COMENTÁRIO. Quando o gate `bash -n` dos corpos
// `run:` (`check-workflow-run-syntax`) reprova, este script publica o PATCH
// exato do remendo no PR — em vez de deixar quem abriu o PR caçar no log do job
// QUAL linha caiu e reescrever à mão a cicatriz que o próprio repositório já
// sabe remendar (é o mesmo defeito mecânico que o `--fix` remenda e que o
// remédio do pre-commit já oferece, com confirmação, no momento do commit).
//
// A DISTÂNCIA QUE ELE FECHA (o PR é a OUTRA ponta do hook)
//
// O pre-commit oferece o remédio onde há terminal e operador. No PR não há nem
// um nem outro: quem abriu o PR está lendo o check vermelho no navegador, e a
// única coisa que o log dá é a mensagem do bash. Este script leva até ali o
// PATCH — o mesmo que o `--fix` gravaria — e o RECONCILIA: quando a cicatriz
// some, o comentário é RETIRADO sozinho, em vez de ficar aberto mentindo sobre
// um defeito que já não existe.
//
// POR QUE UM PATCH (e não um "Apply suggestion")
//
// O botão "Apply suggestion" do GitHub e do Gitea só existe em comentário de
// REVISÃO ancorado na linha do diff, e uma âncora errada aplicaria uma edição
// ERRADA com um clique — o pior modo de falha deste caminho, porque é
// silencioso. O patch (a) sai do MESMO fixer que a gravação usa
// (`remedyPatch`, de `check-workflow-run-syntax.mjs`: uma régua, dois
// consumidores), (b) se aplica IDENTICAMENTE nas duas forjas (`git apply`) e
// (c) é o que o `git apply -` do operador consome sem parsing nosso no meio.
// O botão de COPIAR do bloco de código é o clique: copiar o bloco e colar no
// terminal aplica o remendo inteiro.
//
// O QUE ELE NÃO PUBLICA
//
// O patch cobre o que o fixer remenda. As RECUSAS (heredoc, forma dobrada
// `run: >`, arquivo de shell, shell embutido) vão no MESMO comentário com o
// motivo de cada uma — um comentário que só mostrasse o patch esconderia o que
// ele não cobre. E quando a varredura NÃO conseguiu medir (sem `bash`, arquivo
// ilegível, YAML inválido), ele NÃO retira o comentário anterior: ausência de
// medição nunca vira "não há nada aqui".
//
// CANAL AUSENTE x CANAL QUEBRADO
//
// Sem token, sem número de PR ou sem forja reconhecida o canal não existe — e
// isso é AVISO nomeado (`::notice::`), não falha: o GATE é o veredito, este
// comentário é um canal A MAIS. Token sem permissão de escrita (PR de fork, por
// exemplo) é o mesmo caso, dito. Já um canal que EXISTE e a API recusou (5xx,
// 422) é publicação quebrada: vira `::error::` e o passo falha — um canal que
// existe e não publica é pior que a ausência dele, porque parece que publicou.
//
// O PASSO DO CI INVOCA O REGISTRO (e é isso que faz um fixer novo herdar o canal)
//
// As duas pipelines rodam UM passo deste script com `--all`: o conjunto de
// fixers sai de `FIXERS`, e nao de uma lista escrita no YAML. A enumeracao à
// mao tinha o custo de sempre — um fixer novo só chegaria ao PR se alguém
// lembrasse de copiar o passo nas DUAS pontas, e o passo copiado de uma forja
// para a outra publicaria no canal errado, com o token errado, sem veredito
// nenhum (este canal nao é um gate, entao as regras de classificacao do
// `check-forge-parity` nao o alcancavam). Quem mede isso agora é a QUINTA regra
// daquele guard: exatamente um passo por pipeline, `--all`, cobertura igual à
// do registro (o fixer que ficar de fora sai NOMEADO) e o `--backend` da
// propria forja.
//
// E O REGISTRO TAMBÉM É DERIVADO (`pr-fixers.mjs`): a lista de fixers saiu daqui
// (era um objeto escrito à mão, com a prosa do comentário de cada um) e passou a
// sair das DECLARAÇÕES de `scripts/remedy-classes/<id>.mjs` — as MESMAS que o
// pre-commit oferece. Um defeito mecânico novo entra nos DOIS canais no commit em
// que é declarado; o que o canal exige a mais é o `remedyPatch` do guard dono (o
// comentário publica o patch que o `--fix` gravaria), e uma declaração que
// declare `canal` sem esse produtor RECUSA a rodada.
//
// Usage:
//   node scripts/pr-remedy-comment.mjs --backend gitea               # na forja (merge)
//   node scripts/pr-remedy-comment.mjs --backend github              # no espelho
//   node scripts/pr-remedy-comment.mjs --backend gitea --all         # o REGISTRO inteiro (o que a pipeline roda)
//   node scripts/pr-remedy-comment.mjs --backend gitea --fixer X     # UM fixer (inspecao local; com --all e uso inválido)
//   node scripts/pr-remedy-comment.mjs --backend gitea --pr 123      # PR explícito
//   node scripts/pr-remedy-comment.mjs --dry-run                     # imprime o corpo e a decisão, sem tocar a API
//   node scripts/pr-remedy-comment.mjs --root X                      # outro repositório (fixture/testes)
//   node scripts/pr-remedy-comment.mjs --json                        # saída estruturada
//   node scripts/pr-remedy-comment.mjs -h                            # esta ajuda
//
// Ambiente (o MESMO dos outros publicadores): no Gitea `GITEA_TOKEN`,
// `GITEA_URL` e `GITEA_REPOSITORY`; no GitHub `GH_TOKEN` e `GH_REPOSITORY`
// (`GH_API_URL` opcional). O número do PR vem de `--pr`, de `PR_NUMBER` ou do
// payload do evento (`GITHUB_EVENT_PATH`) / de `GITHUB_REF` (`refs/pull/N/…`).
// `REMEDY_RUN_URL` é opcional e entra no rodapé do comentário.
//
// Exit codes:
//   0 — o canal foi reconciliado (comentário criado, atualizado ou RETIRADO),
//       ou não havia o que fazer; e também quando o CANAL está AUSENTE ou sem
//       permissão de escrita, dito com `::notice::` (o GATE é o veredito)
//   2 — canal presente e a API recusou (publicação quebrada), ou uso do
//       ambiente inconsistente que o script não pode contornar em silêncio
//   3 — uso inválido (`--backend` desconhecido, `--pr` sem número, flag
//       desconhecida)
// =============================================================================

import process from "node:process"
import { pathToFileURL } from "node:url"

// O REGISTRO de fixers vem DA DESCOBERTA (`pr-fixers.mjs`), que lê as MESMAS
// declarações do remédio do pre-commit (`scripts/remedy-classes/<id>.mjs`) e
// importa o produtor do patch (`remedyPatch`) do guard DONO de cada uma. Não há
// lista de fixers neste arquivo — ver o cabeçalho de `pr-fixers.mjs`.
import { CANAL_PROBLEMAS, DEFAULT_FIXER, FIXERS } from "./pr-fixers.mjs"
// A MECÂNICA DO CANAL vem de um módulo sem gate nenhum (`pr-comment-channel.mjs`):
// o ciclo do comentário no PR é o MESMO para o remendo e para o veredito do
// merge gate, e deixá-lo aqui obrigaria quem só quer o canal a importar os
// parsers de YAML dos gates (dependência de `node_modules` num job que não
// instala — o `check-job-deps` trata isso como custo, e é).
import {
  ChannelDenied,
  backendChannel,
  decideComment,
  prNumberFrom,
  reconcileComment,
  selectBackend,
} from "./pr-comment-channel.mjs"

// A API PÚBLICA deste módulo não mudou com a extração: os nomes seguem saindo
// daqui (os testes e os irmãos importam DAQUI, não do módulo novo).
export { ChannelDenied, backendChannel, decideComment, prNumberFrom, selectBackend }

/** Exit codes — o contrato da CLI. */
export const EXIT = {
  OK: 0,
  UNPUBLISHED: 2,
  USAGE: 3,
}

/**
 * Teto de recusas listadas no corpo (o excedente é CONTADO, nunca omitido).
 */
export const MAX_REFUSED = 20

/**
 * Os campos que a medição de QUALQUER fixer tem de devolver.
 *
 * `unread` e `yamlInvalido` são a metade honesta do contrato: sem elas, "não há
 * nada a remendar" seria uma afirmação sobre o que o fixer não leu. Um fixer que
 * esquecesse uma delas declararia um veredito que ninguém mediu — e o erro seria
 * INVISÍVEL, porque um campo ausente não estoura nada.
 */
export const FORMA_DO_RESULTADO = [
  "patch",
  "fixed",
  "refused",
  "unread",
  "yamlInvalido",
  "indisponivel",
]

/**
 * OS FIXERS MECÂNICOS que têm este canal — DERIVADOS das declarações
 * (`scripts/remedy-classes/<id>.mjs`, via `pr-fixers.mjs`), cada um com o SEU
 * marcador, o seu nome de gate e a SUA medição.
 *
 * Um fixer por DEFEITO, e não um script por remédio: a mecânica é a mesma (medir
 * o que o `--fix` gravaria, publicar o patch como comentário, reconciliar quando
 * o defeito some) e o que muda é o defeito e como descrevê-lo. Dois scripts
 * irmãos divergiriam na primeira correção que um recebesse — e a reconciliação, a
 * decisão e o tratamento de canal são justamente onde isso dói.
 *
 * A FONTE é a declaração da classe (a mesma que o pre-commit oferece): o `canal`
 * dela traz a prosa do comentário, o `fixer` dela é o `comandoFix` daqui, e o
 * `medir` é o `remedyPatch` do guard DONO, importado pela descoberta — um preview
 * com régua própria prometeria um remendo que a gravação recusaria. Um fixer novo
 * entra por AQUI no commit em que a declaração dele é escrita.
 *
 * O marcador é POR FIXER de propósito: os remédios podem estar no MESMO PR (um
 * passo com a cicatriz E um `| grep -q`), e um marcador comum faria a
 * reconciliação de um retirar o comentário do outro.
 */
export { FIXERS, DEFAULT_FIXER }

/**
 * As declarações que NÃO entraram no canal (com o motivo): a rodada é RECUSADA.
 *
 * O canal não é um gate, mas o REGISTRO dele é a cobertura do remendo no PR: uma
 * declaração quebrada não pode virar "aquele fixer não existe" — quem publica
 * menos do que o repositório sabe remendar, em silêncio, é pior que não publicar.
 */
export { CANAL_PROBLEMAS }

/**
 * O marcador do fixer DEFAULT.
 *
 * Mantido exportado porque é o contrato de quem já lia este módulo (testes,
 * docs) — o marcador de CADA fixer está em `FIXERS`.
 */
export const MARKER = FIXERS[DEFAULT_FIXER].marker

/** O rodapé cita o job; o nome do gate é o que quem lê o PR vê no check. */
export const GATE_JOB = FIXERS[DEFAULT_FIXER].gateJob

const USAGE = `pr-remedy-comment — o patch do remendo de um gate mecânico publica-se no PR

Usage:
  node scripts/pr-remedy-comment.mjs --backend <gitea|github> [--all | --fixer <id>] [--pr N] [--dry-run] [--json] [--root X]
  node scripts/pr-remedy-comment.mjs -h

\`--all\` publica/reconcilia UM comentário por fixer do REGISTRO — é o que as duas
pipelines usam, e a razão é de desenho: um fixer NOVO entra lá sozinho, sem
edição de workflow (o \`check-forge-parity\` exige que o passo das duas forjas
seja exatamente este comando). \`--fixer\` publica UM (operador); os dois juntos
são uso inválido.

Fixers (--fixer, default \`${DEFAULT_FIXER}\`):
${Object.entries(FIXERS)
  .map(([id, f]) => `  ${id.padEnd(18)} ${f.gateJob}`)
  .join("\n")}

O patch sai do MESMO fixer do \`--fix\` (\`remedyPatch\`) — o comentário publica o que
o \`--fix\` GRAVARIA, e o RECONCILIA: quando o defeito some, ele é retirado sozinho.
Cada fixer tem o SEU marcador, então os dois podem conviver no mesmo PR.

Exit codes:
  0 — canal reconciliado (criado/atualizado/retirado) ou nada a fazer; e também
      com o canal AUSENTE ou sem permissão de escrita, dito com \`::notice::\`
  2 — a API recusou a publicação (canal existe e não publica)
  3 — uso inválido (--backend desconhecido, --pr sem número, flag desconhecida)`

/**
 * O corpo do comentário — ou `null` quando não há remendo a publicar.
 *
 * `null` NÃO é "nada a fazer": é o sinal de que a cicatriz sumiu, e o que existe
 * (o comentário anterior) tem de ser RETIRADO. Quem decide o que fazer com ele é
 * a reconciliação.
 *
 * As recusas entram com o motivo de cada uma, e o excedente do teto é CONTADO
 * (um comentário que omitisse 12 casos silenciosamente diria que o remendo cobre
 * tudo o que o job achou).
 *
 * @param {object} result  o retorno do `remedyPatch`
 * @param {{now?: Date, runUrl?: string|null}} [args]
 * @returns {string|null}
 */
export function remedyBody(result, { now = new Date(), runUrl = null } = {}) {
  return corpoDoFixer(DEFAULT_FIXER, result, { now, runUrl })
}

/**
 * O corpo do comentário de UM fixer — ou `null` quando não há remendo a publicar
 * (o sinal de RETIRAR, ver `remedyBody`).
 *
 * O esqueleto é o mesmo para os dois fixers (marcador, o que o gate achou, o
 * patch, o bloco de aplicação, as recusas, o rodapé reconciliado) e o que muda é
 * a PROSA de cada um — o defeito, o que ele não cobre e o que o diff significa.
 * O que NÃO muda: o patch sai do `medir` do próprio fixer, e a linha do arquivo
 * no cabeçalho das recusas é `f.line`, que o `fixAll` de cada gate preenche.
 *
 * @param {string} fixerId
 * @param {object} result  o retorno do `remedyPatch` do fixer
 * @param {{now?: Date, runUrl?: string|null}} [args]
 * @returns {string|null}
 */
export function corpoDoFixer(fixerId, result, { now = new Date(), runUrl = null } = {}) {
  const fixer = fixerOf(fixerId)
  const patch = String(result?.patch ?? "")
  if (patch.trim() === "") return null
  const remendados = result.fixed ?? []
  const recusas = result.refused ?? []
  const shell = result.shellFailures ?? []
  const embutido = [...(result.embeddedFailures ?? []), ...(result.payloadFailures ?? [])]
  const data = now.toISOString().replace("T", " ").slice(0, 16)
  const onde = (f) => `${f.file}:${f.linhaArquivo ?? f.line}`

  const linhas = [
    fixer.marker,
    `## ${fixer.titulo}`,
    "",
    fixer.achado(remendados.length),
    "",
    `O patch abaixo é **exatamente** o que \`${fixer.comandoFix}\``,
    "gravaria — ele sai do MESMO fixer (`remedyPatch`), e **nada foi gravado**.",
    "",
    `**Arquivos (${new Set(remendados.map((f) => f.file)).size}):** ${[...new Set(remendados.map(onde))].join(", ")}`,
    "",
    "### Aplicar (copiar o bloco, colar no terminal)",
    "",
    "```bash",
    "git apply - <<'REMEDY_PATCH'",
    patch.replace(/\n$/, ""),
    "REMEDY_PATCH",
    "```",
    "",
    `Alternativa sem copiar patch: \`${fixer.comandoFix}\` —`,
    "ele grava na árvore e **prova o efeito** (relê e re-julga; não grava o que não reduz).",
    "",
    fixer.rodape,
  ]

  if (recusas.length > 0) {
    const listadas = recusas.slice(0, MAX_REFUSED)
    linhas.push(
      "",
      `### O que este comentário NÃO cobre (${recusas.length} recusa(s))`,
      "",
      fixer.naoCobre,
      "",
      "| onde | por que não é remendado |",
      "| :-- | :-- |",
      ...listadas.map(
        (f) =>
          `| \`${f.line ? `${f.file}:${f.line}` : f.file}\` | ${String(f.reason ?? "")
            .replace(/\|/g, "\\|")
            .replace(/\n/g, " ")} |`,
      ),
    )
    if (recusas.length > listadas.length) {
      linhas.push(
        "",
        `… e mais **${recusas.length - listadas.length}** caso(s) — rode o gate localmente para a lista inteira.`,
      )
    }
  }

  const outras = [
    ...shell.map((f) => `${f.file}:${f.line} — ${f.error}`),
    ...embutido.map((f) => `${f.line ? `${f.file}:${f.line}` : f.file} — ${f.error}`),
  ]
  if (outras.length > 0) {
    linhas.push(
      "",
      `### Violações que NÃO são cicatriz remendável (${outras.length})`,
      "",
      ...outras.slice(0, MAX_REFUSED).map((l) => `- \`${l}\``),
      ...(outras.length > MAX_REFUSED
        ? ["", `… e mais **${outras.length - MAX_REFUSED}** caso(s).`]
        : []),
    )
  }

  linhas.push(
    ...[
      "",
      "---",
      "",
      `<sub>Comentário **reconciliado** pelo job \`${fixer.gateJob}\`: quando o defeito sumir, ele`,
      `é **retirado sozinho** — o ciclo é fechado, não deixado aberto. Gerado em ${data}.`,
      runUrl ? `Rodada: ${runUrl}.` : null,
      "</sub>",
    ].filter((l) => l !== null),
  )
  return linhas.join("\n")
}

/**
 * O fixer do id — ou LANÇA com os ids válidos na mensagem.
 *
 * Um id desconhecido é erro de USO (exit 3), e não "sem canal": quem escreveu
 * `--fixer pipefail` quer publicar AQUELE remédio, e seguir com o default
 * publicaria o comentário de outro gate num PR sobre este — o modo de falha que
 * a mensagem tem de tornar impossível.
 */
export function fixerOf(id) {
  const fixer = FIXERS[id]
  if (!fixer) {
    throw new Error(`fixer desconhecido: ${id} (válidos: ${Object.keys(FIXERS).join(", ")})`)
  }
  return fixer
}

/**
 * O ciclo do REMÉDIO: o mesmo `reconcileComment` do canal, com o marcador DO
 * FIXER como default.
 *
 * A casca existe para a API pública deste módulo não mudar quando a mecânica foi
 * extraída para `pr-comment-channel.mjs`: quem chamava `reconcileRemedy` sem
 * marcador continua reconciliando o canal do `bash -n` (e quem passa um marcador
 * segue podendo escolher o canal).
 *
 * `body === null` é o sinal de RETIRAR: um comentário do nosso canal que fica
 * aberto depois de o defeito sumir mente sobre o estado do PR.
 *
 * @param {Omit<Parameters<typeof reconcileComment>[0], "marker"> & {marker?: string}} [args]
 * @returns {Promise<{action: string, id: (number|null), detail: string}>}
 */
export function reconcileRemedy(args = {}) {
  return reconcileComment({ marker: MARKER, ...args })
}

/**
 * O CICLO DO CANAL PARA UM FIXER — medir, decidir e reconciliar, sem sair do
 * processo.
 *
 * Não chama `process.exit`: quem chama decide o código. É o que permite o
 * `--all` publicar TODOS os fixers do registro e só depois cobrar o pior
 * desfecho — um `process.exit(2)` no meio de um fixer abortaria os seguintes, e
 * o PR cujo primeiro remédio não publicou perderia o aviso dos outros em
 * silêncio (exatamente o modo de falha que o canal existe para não ter).
 *
 * O desfecho de UM fixer é tri-estado, como no CLI de antes:
 *   · `publicado`    — o canal foi reconciliado (criado/atualizado/retirado);
 *   · `indeterminado`— nada a fazer: não mediu, sem canal, sem PR, ou canal sem
 *                      permissão de escrita (`::notice::`/`::warning::`);
 *   · `quebrado`     — o canal existe e a API recusou (`::error::`, exit 2).
 *
 * @param {{fixerId?: string, backendFlag?: string|null, prFlag?: string|null, root?: string,
 *   dryRun?: boolean, json?: boolean, env?: Record<string,string>, now?: Date,
 *   out?: (l: string) => void, err?: (l: string) => void}} [args]
 */
export async function publicarFixer({
  fixerId = DEFAULT_FIXER,
  backendFlag = null,
  prFlag = null,
  root = process.cwd(),
  dryRun = false,
  json = false,
  env = process.env,
  now = new Date(),
  out = (l) => console.log(l),
  err = (l) => console.error(l),
} = {}) {
  const fixer = fixerOf(fixerId)

  // ── 1. A MEDIÇÃO: o patch, pelo MESMO módulo do `--fix` DO FIXER ─────────
  const result = fixer.medir(root)
  const body = corpoDoFixer(fixerId, result, {
    now,
    runUrl: env.REMEDY_RUN_URL ?? null,
  })
  // A FORMA do resultado é conferida antes de ser lida: um fixer que devolvesse
  // `unread`/`yamlInvalido` AUSENTE faria `medido` dizer "mediu" sobre campos que
  // ninguém preencheu — a mesma falsa segurança que o `unread` existe para não
  // ter. Um slot faltando é "NÃO MEDIU", nomeado.
  const faltando = FORMA_DO_RESULTADO.filter((k) => !(k in result))
  const medido =
    faltando.length === 0 &&
    !result.indisponivel &&
    result.unread.length === 0 &&
    result.yamlInvalido.length === 0
  const resumo = {
    fixer: fixerId,
    gate: fixer.gateJob,
    medido,
    remendados: (result.fixed ?? []).length,
    recusas: (result.refused ?? []).length,
    indeterminado:
      result.indisponivel ??
      (faltando.length > 0 ? `a medição do fixer não devolveu: ${faltando.join(", ")}` : null),
  }

  // ── 2. O CANAL ────────────────────────────────────────────────────────────
  const canal = selectBackend({ flag: backendFlag, env })
  const pr = prNumberFrom({ env, flag: prFlag })
  const channel = canal.backend ? backendChannel(canal.backend, { env }) : null

  const semCanal = (linha, extra = {}) => ({
    resumo,
    backend: canal.backend,
    pr,
    body,
    action: null,
    detail: null,
    desfecho: "indeterminado",
    exit: EXIT.OK,
    ...extra,
    aviso: linha,
  })

  if (dryRun) {
    const decisaoDizivel =
      body === null
        ? "o comentário seria RETIRADO (sem cicatriz) ou nada havia a fazer"
        : `o comentário seria criado/atualizado com ${resumo.remendados} remendo(s)`
    if (json) {
      out(
        JSON.stringify(
          { ...resumo, backend: canal.backend, pr, dryRun: true, decisao: decisaoDizivel, body },
          null,
          2,
        ),
      )
    } else {
      err(
        `── pré-visualização (--dry-run): ${decisaoDizivel}; NADA foi gravado e a API não foi tocada`,
      )
      out((body ?? "(sem remendo: o comentário seria retirado)") + "\n")
    }
    return {
      resumo,
      backend: canal.backend,
      pr,
      body,
      dryRun: true,
      decisao: decisaoDizivel,
      action: null,
      detail: null,
      desfecho: "indeterminado",
      exit: EXIT.OK,
    }
  }

  if (!medido) {
    // Não medir não é "não há nada aqui": retirar o comentário com a varredura
    // quebrada apagaria o último aviso de um defeito que ninguém conseguiu ler.
    const aviso = `::warning::pr-remedy-comment: a varredura NÃO mediu (${resumo.indeterminado ?? "arquivo ilegível ou YAML inválido"}) — o comentário anterior NÃO é retirado e nada é publicado`
    err(aviso)
    return semCanal(aviso, { medido: false })
  }
  if (!canal.backend) {
    const aviso = `::notice::pr-remedy-comment: ${canal.why ?? "canal indisponível"} — o remendo NÃO foi publicado (o GATE segue sendo o veredito; este comentário é um canal a mais)`
    err(aviso)
    return semCanal(aviso)
  }
  if (!pr) {
    const aviso =
      "::notice::pr-remedy-comment: sem número de PR (--pr, PR_NUMBER, payload do evento ou GITHUB_REF) — nada a publicar"
    err(aviso)
    return semCanal(aviso)
  }
  if (channel.unavailable) {
    const aviso = `::notice::pr-remedy-comment: ${channel.unavailable} — o remendo NÃO foi publicado (o GATE segue sendo o veredito; este comentário é um canal a mais)`
    err(aviso)
    return semCanal(aviso)
  }

  try {
    const saida = await reconcileRemedy({
      request: channel.request,
      config: channel.config,
      kind: channel.kind,
      pr,
      body,
      marker: fixer.marker,
      log: (l) => err(l),
    })
    if (json) out(JSON.stringify({ ...resumo, backend: canal.backend, pr, ...saida }, null, 2))
    else
      out(`✅ pr-remedy-comment (${canal.backend}, PR #${pr}, fixer ${fixerId}): ${saida.detail}`)
    return {
      resumo,
      backend: canal.backend,
      pr,
      body,
      action: saida.action,
      detail: saida.detail,
      desfecho: "publicado",
      exit: EXIT.OK,
    }
  } catch (e) {
    if (e instanceof ChannelDenied) {
      const aviso = `::warning::pr-remedy-comment: ${e.message}`
      err(aviso)
      return semCanal(aviso, { action: null, detail: e.message })
    }
    const aviso = `::error::pr-remedy-comment (fixer ${fixerId}): ${e?.message ?? e}`
    err(aviso)
    return {
      resumo,
      backend: canal.backend,
      pr,
      body,
      action: null,
      detail: e?.message ?? String(e),
      desfecho: "quebrado",
      exit: EXIT.UNPUBLISHED,
    }
  }
}

async function main() {
  const argv = process.argv.slice(2)
  const conhecidas = [
    "--backend",
    "--fixer",
    "--all",
    "--pr",
    "--root",
    "--dry-run",
    "--json",
    "-h",
    "--help",
  ]
  const desconhecida = argv.find((a) => a.startsWith("--") && !conhecidas.includes(a))
  if (desconhecida) {
    console.error(`❌ flag desconhecida: ${desconhecida}`)
    console.error(USAGE)
    process.exit(EXIT.USAGE)
  }
  if (argv.includes("-h") || argv.includes("--help")) {
    console.log(USAGE)
    process.exit(EXIT.OK)
  }
  const valor = (flag) => {
    const i = argv.indexOf(flag)
    if (i === -1) return null
    const v = argv[i + 1]
    if (v === undefined || v.startsWith("--")) {
      console.error(`❌ ${flag} exige um valor`)
      console.error(USAGE)
      process.exit(EXIT.USAGE)
    }
    return v
  }
  const backendFlag = valor("--backend")
  if (backendFlag !== null && backendFlag !== "gitea" && backendFlag !== "github") {
    console.error(`❌ --backend desconhecido: ${backendFlag} (use gitea ou github)`)
    console.error(USAGE)
    process.exit(EXIT.USAGE)
  }
  // O FIXER: o default é o gate do `bash -n` (o canal nasceu com ele). Um id
  // desconhecido é erro de USO e para aqui — cair no default publicaria o
  // comentário de OUTRO gate, que é pior que não publicar nada.
  const fixerFlag = valor("--fixer")
  const todos = argv.includes("--all")
  // `--fixer` E `--all` juntos se CONTRADIZEM: um escolhe UM defeito, o outro
  // publica o registro inteiro. Escolher um dos dois em silêncio publicaria (ou
  // deixaria de publicar) um comentário que quem escreveu a linha não pediu.
  if (todos && fixerFlag !== null) {
    console.error(
      "❌ --all publica TODOS os fixers do registro; --fixer escolhe um — use um dos dois",
    )
    console.error(USAGE)
    process.exit(EXIT.USAGE)
  }
  if (!todos && fixerFlag !== null) {
    try {
      fixerOf(fixerFlag)
    } catch (e) {
      console.error(`❌ ${e.message}`)
      console.error(USAGE)
      process.exit(EXIT.USAGE)
    }
  }
  const prFlag = valor("--pr")
  // `--pr` com valor não-numérico é erro de USO e não "sem PR": quem escreveu
  // `--pr abc` quis publicar em algum PR, e tratar isso como "sem canal" faria o
  // passo seguir verde sobre um número que ninguém leu.
  if (prFlag !== null && prNumberFrom({ flag: prFlag }) === null) {
    console.error(`❌ --pr exige um número de PR: ${prFlag}`)
    console.error(USAGE)
    process.exit(EXIT.USAGE)
  }
  const root = valor("--root") ?? process.cwd()
  const dryRun = argv.includes("--dry-run")
  const json = argv.includes("--json")

  // O REGISTRO INCOMPLETO RECUSA A RODADA. O canal não é o gate, mas publicar
  // MENOS do que o repositório sabe remendar — com uma declaração quebrada
  // virando "aquele fixer não existe" — é o modo de falha que o registro
  // derivado existe para não ter. A mensagem nomeia o arquivo e o que falta.
  if (CANAL_PROBLEMAS.length > 0) {
    console.error(
      `❌ pr-remedy-comment: o REGISTRO de fixers está INCOMPLETO — nada é publicado nesta rodada (uma declaração quebrada publicaria menos remendo do que o repositório sabe remendar, em silêncio):`,
    )
    for (const problema of CANAL_PROBLEMAS) console.error(`   - ${problema}`)
    process.exit(EXIT.UNPUBLISHED)
  }

  // O CONJUNTO de fixers vem do REGISTRO — nunca de uma lista escrita na linha
  // de comando: é este `--all` que faz um fixer NOVO herdar o passo do CI (e o
  // `check-forge-parity` exige que o passo das duas forjas seja exatamente ele).
  const ids = todos ? Object.keys(FIXERS) : [fixerFlag ?? DEFAULT_FIXER]

  const saidas = []
  for (const id of ids) {
    if (todos && !json) console.error(`── fixer ${id} (${FIXERS[id].gateJob})`)
    saidas.push(await publicarFixer({ fixerId: id, backendFlag, prFlag, root, dryRun, json }))
  }

  if (todos && json) {
    console.log(JSON.stringify(saidas, null, 2))
  } else if (todos) {
    const publicados = saidas.filter((s) => s.desfecho === "publicado").length
    const quebrados = saidas.filter((s) => s.desfecho === "quebrado")
    const indeterminados = saidas.filter((s) => s.desfecho === "indeterminado").length
    console.log(
      `── --all: ${saidas.length} fixer(s) do registro · ${publicados} publicado(s) · ${indeterminados} indeterminado(s)${quebrados.length > 0 ? ` · ${quebrados.length} QUEBRADO(S): ${quebrados.map((s) => s.resumo.fixer).join(", ")}` : ""}`,
    )
  }

  // O exit é o PIOR desfecho da rodada, depois de TODOS terem sido tentados: um
  // canal que existe e não publica falha o passo (é pior que a ausência dele,
  // porque parece que publicou).
  process.exit(saidas.some((s) => s.exit !== EXIT.OK) ? EXIT.UNPUBLISHED : EXIT.OK)
}

// True apenas quando executado diretamente — permite importar as funções puras
// nos testes unitários sem disparar a medição nem a publicação.
const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (IS_DIRECT_RUN) {
  main().catch((e) => {
    console.error(`::error::pr-remedy-comment: ${e?.stack ?? e}`)
    process.exit(EXIT.UNPUBLISHED)
  })
}
