#!/usr/bin/env node

// =============================================================================
// runner-shells.mjs
//
// A MEDIÇÃO dos shells que a imagem do runner embarca — e o veredito de DRIFT
// dela contra o que o gate DECLARA.
//
// POR QUE ISTO EXISTE (a dívida que ele fecha): o `--shells` do
// `check-workflow-run-syntax.mjs` imprime o conjunto declarado e o comando que o
// mediu — mas quem RE-MEDE é uma PESSOA, e ninguém lembra. A declaração vira
// presunção com data: se a base da imagem mudar (re-sync do mirror, rebuild,
// troca de base), `RUNNER_SHELLS`/`RUNNER_SHELLS_MISSING` passam a MENTIR e
// nenhum gate fica vermelho. E as duas direções da mentira são caras, em
// direções opostas:
//
//   - o declarado diz que a imagem TEM e ela NÃO tem → o gate PASSA um passo
//     `shell: zsh` que morre com `command not found` DEPOIS do setup (o defeito
//     que o gate existe para pegar, agora escondido por dentro dele);
//   - o declarado diz que a imagem NÃO tem e ela TEM → o gate REPROVA um passo
//     legítimo, e a saída para quem esbarra nisso é "mexer na lista", que é
//     exatamente a erosão que esta casa recusa.
//
// É a mesma classe de "medição que envelhece em silêncio" que já custou caro
// aqui. Aqui ela vira fato de CRON: o job periódico re-mede, compara com o
// declarado e abre issue acionável quando diverge (e a fecha quando volta a
// bater).
//
// FONTE ÚNICA: este módulo é o dono do PROBE — a lista de nomes perguntados
// (`SHELLS_PROBED`), o texto do comando, o parser e o veredito. O comando
// declarado (`RUNNER_IMAGE.command`) é GERADO pela MESMA função que a medição
// executa, e o gate importa a declaração daqui em vez de manter a sua cópia:
// duas cópias divergem no dia em que alguém ajustar uma — e aí a issue passa a
// julgar um conjunto que o gate não usa.
//
// O QUE NÃO VIROU ALERTA, E POR QUÊ (decidido, não esquecido): o DIGEST da
// imagem medida é um FATO do relatório, mas a divergência dele **não** abre
// dívida sozinha. A tag é um apelido mutável: um re-sync do mirror muda o
// digest sem mudar nada do que a declaração AFIRMA (o conjunto de shells), e um
// cron que abre issue a cada rebuild é o alerta que sempre acende — o ruído que
// este repositório recusa. Quem manda no veredito é o CONJUNTO; o digest e a
// data vão no corpo do ticket como proveniência.
//
// Usage:
//   node scripts/runner-shells.mjs                # mede, compara e diz o veredito
//   node scripts/runner-shells.mjs --json         # saída estruturada (STDOUT)
//   node scripts/runner-shells.mjs --report /tmp/runner-shells.json   # grava o JSON
//   node scripts/runner-shells.mjs --image REF    # mede outra ref (default: derivada do env)
//   node scripts/runner-shells.mjs --docker PODMAN  # outro cliente de container
//   node scripts/runner-shells.mjs --help
//
// Exit codes:
//   0 — a medição CONCORDA com o declarado (nenhum aviso)
//   1 — DRIFT: o que a imagem tem diverge do que o gate declara (o ticket é
//       publicado pelo `runner-shells-issue.mjs` com ESTE relatório)
//   2 — INDETERMINADO: não foi possível medir (docker ausente, imagem não
//       puxável, `BUN_VERSION` sem valor) — NUNCA confundido com "sem drift",
//       porque um verde que não mediu é a garantia decorativa que este repo
//       recusa
//   3 — uso inválido (flag desconhecida, `--image`/`--report`/`--docker` sem valor)
// =============================================================================

import { spawnSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import process from "node:process"
import { pathToFileURL } from "node:url"

import { resolveImageRef } from "./ensure-runner-image.mjs"

/** A marca que o probe imprime quando o `command -v` não resolve o nome. */
export const ABSENT_TOKEN = "AUSENTE"

/**
 * Os nomes que a medição PERGUNTA, na ordem em que o probe os percorre.
 *
 * É a régua da COBERTURA: todo nome declarado tem de estar aqui (senão a
 * declaração afirma um fato que ninguém mede) e todo nome aqui tem de estar
 * declarado (senão a medição responde algo que nenhum veredito usa). O veredito
 * acusa as duas pontas em vez de deixá-las em silêncio.
 *
 * @type {string[]}
 */
export const SHELLS_PROBED = [
  "bash",
  "sh",
  "dash",
  "zsh",
  "fish",
  "ksh",
  "python",
  "python3",
  "pwsh",
  "node",
  "cmd",
  "powershell",
  "perl",
  "ruby",
]

/**
 * O veredito da medição — as duas formas do relatório num tipo só.
 *
 * `state: "unavailable"` tem `detail` e listas vazias (não mediu ≠ não tem): os
 * campos da medição ficam vazios de propósito, para um consumidor descuidado não
 * ler `present: {}` como "a imagem não tem nada".
 *
 * @typedef {object} RunnerShellsReport
 * @property {"measured"|"unavailable"} state
 * @property {"in-sync"|"drift"|"unavailable"} verdict
 * @property {string|null} image
 * @property {string|null} digest
 * @property {boolean|null} digestChanged
 * @property {string|null} detail
 * @property {string[]} probed
 * @property {{present: Record<string,string>, missing: string[]}} declared
 * @property {string|null} declaredDigest
 * @property {string|null} declaredMeasuredAt
 * @property {Record<string,string>} [present]
 * @property {string[]} [missing]
 * @property {string[]} [unparsed]
 * @property {string[]} [added]
 * @property {string[]} [removed]
 * @property {string[]} [moved]
 * @property {string[]} [unprobed]
 * @property {string[]} [unused]
 * @property {string[]} [unanswered]
 * @property {{probed: number, present: number, missing: number, declaredPresent: number, declaredMissing: number}} [counts]
 * @property {string[]} warnings
 */

/** Teto do `docker run` da medição (uma imagem já local responde em ms). */
export const PROBE_TIMEOUT_MS = 120_000

const DOCKER_HINT =
  "sem docker no PATH não há medição: rode onde o socket existe (o job da forja " +
  "monta `/var/run/docker.sock`) ou passe --docker <cliente>."

const PULL_HINT =
  "a ref não está local e o pull falhou: confira o login no registry " +
  "(o mirror é privado) e se a tag existe (`vars.BUN_VERSION` re-sincronizado)."

/**
 * O TEXTO do probe — a única cópia dele no repositório.
 *
 * Ele roda DENTRO da imagem (`--entrypoint /bin/sh`), então só pode usar o que
 * a base POSIX garante: `for`, `command -v` e `printf`. O nome é impresso com
 * largura fixa para o parser ter uma coluna estável, e `AUSENTE` é uma MARCA
 * (não um caminho) para que "o shell não está lá" não seja confundido com "o
 * comando imprimiu outra coisa".
 *
 * Sem aspas simples no corpo de propósito: o comando declarado o envolve em
 * `'...'` (a forma mais portável de citar um `-c`), e uma aspa simples dentro
 * do script quebraria a citação. Há teste para isso.
 *
 * @returns {string}
 */
export function probeScript() {
  return (
    `for s in ${SHELLS_PROBED.join(" ")}; do ` +
    `printf "%-12s %s\\n" "$s" "$(command -v "$s" 2>/dev/null || echo ${ABSENT_TOKEN})"; done`
  )
}

/**
 * O argv do probe — o que a medição EXECUTA. Sem o NOME do cliente: ele é o
 * comando do `spawnSync` (e `--docker` troca por outro), não um argumento.
 *
 * @param {string} ref
 * @returns {string[]}
 */
export function probeArgv(ref) {
  return ["run", "--rm", "--entrypoint", "/bin/sh", ref, "-c", probeScript()]
}

/**
 * O comando do probe por EXTENSO — o que o relatório cita e o `--shells` do
 * gate imprime. É GERADO do mesmo `probeScript()`: o comando publicado não pode
 * ser uma cópia que envelheceu.
 *
 * @param {string} [ref]
 * @param {string} [docker]
 * @returns {string}
 */
export function probeCommandText(ref = "<ref>", docker = "docker") {
  return `${docker} run --rm --entrypoint /bin/sh ${ref} -c '${probeScript()}'`
}

/**
 * A IMAGEM DO RUNNER — e o comando que MEDIU o que ela embarca.
 *
 * O conjunto de shells abaixo é uma MEDIÇÃO, não uma presunção: a alternativa
 * (presumir do documentado, ou perguntar ao `command -v` de quem roda o gate)
 * publicaria como fato do repositório uma propriedade da MÁQUINA — a mesma
 * classe de erro que já custou caro aqui (um tamanho de heap lido do host virou
 * "o runner estoura a memória"). A ref e o digest ficam escritos para o dia em
 * que a base mudar: aí o caminho é RE-MEDIR com o comando abaixo, não ajustar o
 * número no olho.
 *
 * O `command` é DERIVADO (`probeCommandText`), nunca um literal.
 */
export const RUNNER_IMAGE = {
  digest: "sha256:fd027ee77b520fbc4eed1e24091bbe277cb242c1c04ea9ccfd62cc6903dbb852",
  measuredAt: "2026-09-16",
  command: probeCommandText("<ref>"),
}

/**
 * A REF (com tag) da imagem do runner — DERIVADA, nunca literal.
 *
 * A tag é `.../ubuntu-bun:<BUN_VERSION>`: escrevê-la aqui seria um espelho de
 * `BUN_VERSION` envelhecendo em silêncio — exatamente a classe que o
 * `check:registry-source` persegue (e ele ACUSA o literal: foi assim que esta
 * linha nasceu). O resolver é o MESMO do `ensure-runner-image` e do compose
 * (`IMAGE_REGISTRY`/`IMAGE_NAMESPACE` com os defaults do compose, e
 * `BUN_VERSION` sem default).
 *
 * Sem `BUN_VERSION` no ambiente NÃO há ref: devolve `null`, e o relatório diz
 * INDETERMINADO em vez de presumir qual imagem foi medida. O que não se deriva
 * fica registrado: o DIGEST (a tag é um apelido mutável; o digest identifica o
 * artefato que a medição tocou), a data e o comando.
 *
 * @param {Record<string, string|undefined>} [env]
 * @returns {string|null}
 */
export function runnerImageRef(env = process.env) {
  const r = resolveImageRef({
    IMAGE_REGISTRY: env.IMAGE_REGISTRY,
    IMAGE_NAMESPACE: env.IMAGE_NAMESPACE,
    BUN_VERSION: env.BUN_VERSION,
  })
  return typeof r.ref === "string" ? r.ref : null
}

/**
 * Os interpretadores que a imagem do runner TEM — com o CAMINHO medido.
 *
 * O caminho não é decorativo: ele é o que o relatório cita quando o passo declara
 * o shell, e é o que prova que a medição foi feita (em vez de "deve ter").
 *
 * @type {Record<string, string>}
 */
export const RUNNER_SHELLS = {
  bash: "/usr/bin/bash",
  sh: "/usr/bin/sh",
  dash: "/usr/bin/dash",
  python: "/usr/local/bin/python",
  python3: "/usr/bin/python3",
  node: "/opt/acttoolcache/node/24.19.0/x64/bin/node",
  perl: "/usr/bin/perl",
}

/**
 * Os que a MESMA medição achou AUSENTES. Fica declarado porque é o lado que o
 * gate REPROVA: quando um passo declara `pwsh`, a mensagem precisa poder dizer
 * "medido: ausente nesta imagem" em vez de "o gate acha que não tem".
 *
 * @type {string[]}
 */
export const RUNNER_SHELLS_MISSING = ["zsh", "fish", "ksh", "pwsh", "powershell", "cmd", "ruby"]

/**
 * O PARSER da saída do probe: `nome <espaços> caminho|AUSENTE`.
 *
 * Linha que ele NÃO entende vira `unparsed` — nunca é descartada em silêncio
 * (uma medição que "parece" certa e lê menos do que diz é pior que uma
 * vermelha), e um nome que o probe não perguntou também é desvio: o parser não
 * aceita a resposta de uma pergunta que a régua não fez.
 *
 * @param {string} text
 * @returns {{present: Record<string,string>, missing: string[], unparsed: string[]}}
 */
export function parseProbeOutput(text) {
  const present = {}
  const missing = []
  const unparsed = []
  for (const rawLine of String(text ?? "").split("\n")) {
    const line = rawLine.trimEnd()
    if (line.trim() === "") continue
    const match = /^(\S+)\s+(\S.*)$/.exec(line)
    if (match === null) {
      unparsed.push(line)
      continue
    }
    const [, name, rest] = match
    const value = rest.trim()
    if (!SHELLS_PROBED.includes(name) || value === "") {
      unparsed.push(line)
      continue
    }
    if (value === ABSENT_TOKEN) {
      if (!missing.includes(name)) missing.push(name)
      continue
    }
    present[name] = value
  }
  missing.sort()
  return { present, missing, unparsed }
}

/**
 * O DIGEST do que foi medido (proveniência), quando o cliente sabe dizer.
 *
 * `null` é "não consegui perguntar" e não "não tem digest": o veredito não
 * depende dele (só o corpo do ticket o cita), então a ausência não vira aviso —
 * vira `null` dito.
 *
 * @param {string} ref
 * @param {{docker?: string, run?: Function}} [deps]
 * @returns {string|null}
 */
export function probeDigest(ref, { docker = "docker", run = spawnSync } = {}) {
  const res = run(docker, ["image", "inspect", "--format", "{{index .RepoDigests 0}}", ref], {
    encoding: "utf8",
    timeout: 60_000,
  })
  if (res?.status !== 0) return null
  const out = String(res?.stdout ?? "")
  const m = /sha256:[0-9a-f]{64}/.exec(out)
  return m ? m[0] : null
}

/**
 * MEDE o conjunto de shells dentro da imagem.
 *
 * FAIL-CLOSED: todo caminho que não produz uma medição de verdade devolve
 * `state: "unavailable"` com o MOTIVO nomeado — docker ausente, `docker run`
 * diferente de zero, ref sem versão, saída vazia. Nunca um objeto vazio que o
 * comparador leria como "a imagem não tem nada" (que abriria issue de tudo).
 *
 * @param {{ref?: string|null, docker?: string, run?: Function}} [deps]
 * @returns {{state: "measured", image: string, digest: string|null, present: Record<string,string>, missing: string[], unparsed: string[]}|{state: "unavailable", image: string|null, detail: string}}
 */
export function measureShells({
  ref = runnerImageRef(process.env),
  docker = "docker",
  run = spawnSync,
} = {}) {
  const image = typeof ref === "string" && ref.trim() !== "" ? ref.trim() : null
  if (image === null) {
    return {
      state: "unavailable",
      image: null,
      detail:
        "sem ref da imagem: defina BUN_VERSION (IMAGE_REGISTRY/IMAGE_NAMESPACE completam a ref)." +
        " Sem ela o cron não sabe QUAL imagem medir — e presumi-la publicaria como fato algo que ninguém mediu.",
    }
  }

  let res
  try {
    res = run(docker, probeArgv(image), {
      encoding: "utf8",
      timeout: PROBE_TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024,
    })
  } catch (error) {
    return {
      state: "unavailable",
      image,
      detail: `'${docker}' não pôde ser executado (${error?.code ?? error?.message}) — ${DOCKER_HINT}`,
    }
  }
  if (res?.error) {
    return {
      state: "unavailable",
      image,
      detail: `'${docker} run' não executou (${res.error.code ?? res.error.message}) — ${DOCKER_HINT}`,
    }
  }
  if (res?.status !== 0) {
    const stderr = String(res?.stderr ?? "")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l !== "")
    return {
      state: "unavailable",
      image,
      detail: `'${docker} run' saiu ${res?.status ?? "?"}${stderr.length > 0 ? `: ${stderr[0]}` : ""} — ${PULL_HINT}`,
    }
  }

  const parsed = parseProbeOutput(res?.stdout)
  const answered = Object.keys(parsed.present).length + parsed.missing.length
  if (answered === 0) {
    return {
      state: "unavailable",
      image,
      detail:
        `a medição não respondeu sobre NENHUM dos ${SHELLS_PROBED.length} nomes perguntados` +
        ` (saída de ${String(res?.stdout ?? "").length} byte(s)) — uma saída vazia não é "a imagem não tem nada".`,
    }
  }

  return {
    state: "measured",
    image,
    digest: probeDigest(image, { docker, run }),
    present: parsed.present,
    missing: parsed.missing,
    unparsed: parsed.unparsed,
  }
}

/**
 * O VEREDITO: o que a imagem tem × o que o gate declara.
 *
 * Cinco classes de aviso, e cada uma é uma direção diferente de erro:
 *   - `removed`   — declarado PRESENTE, medido ausente: o gate PASSA o passo que
 *                   morre com `command not found` (a direção perigosa);
 *   - `added`     — declarado AUSENTE, medido presente: o gate REPROVA um passo
 *                   legítimo;
 *   - `moved`     — o caminho mudou: o relatório do gate cita um caminho que não
 *                   existe mais (a proveniência envelheceu);
 *   - `unanswered`— o probe não respondeu sobre o nome (nem presente nem
 *                   ausente): buraco na medição, não fato;
 *   - `unparsed`  — linhas que o parser não leu, e `unprobed`/`unused` — nomes
 *                   declarados que a medição não pergunta, e nomes perguntados
 *                   que nenhuma declaração usa (a COBERTURA, nos dois sentidos).
 *
 * A ORDEM dos avisos é ORDENADA (a assinatura do ticket é o conjunto deles): a
 * mesma divergência em duas runs produz a MESMA assinatura, e é isso que faz o
 * cron semanal comentar uma vez em vez de abrir issue por semana.
 *
 * @param {{measurement?: object, declared?: Record<string,string>, missing?: string[], declaredDigest?: string|null, declaredMeasuredAt?: string|null}} [deps]
 * @returns {RunnerShellsReport}
 */
export function shellsDriftReport({
  measurement,
  declared = RUNNER_SHELLS,
  missing = RUNNER_SHELLS_MISSING,
  declaredDigest = RUNNER_IMAGE.digest,
  declaredMeasuredAt = RUNNER_IMAGE.measuredAt,
} = {}) {
  const probed = [...SHELLS_PROBED]
  const base = {
    probed,
    declared: { present: declared, missing: [...missing] },
    declaredDigest,
    declaredMeasuredAt,
  }

  if (!measurement || measurement.state !== "measured") {
    return {
      ...base,
      state: "unavailable",
      verdict: "unavailable",
      image: measurement?.image ?? null,
      digest: null,
      digestChanged: null,
      warnings: [],
      added: [],
      removed: [],
      moved: [],
      unprobed: [],
      unused: [],
      unanswered: [],
      unparsed: [],
      detail:
        measurement?.detail ??
        "medição ausente — rode `node scripts/runner-shells.mjs --report <arquivo>` antes do publicador",
    }
  }

  const measuredPresent = measurement.present ?? {}
  const measuredMissing = [...(measurement.missing ?? [])].sort()
  const warnings = []
  const added = []
  const removed = []
  const moved = []
  const unanswered = []

  for (const name of SHELLS_PROBED) {
    const declaredPresent = Object.prototype.hasOwnProperty.call(declared, name)
    const declaredAbsent = missing.includes(name)
    const got = Object.prototype.hasOwnProperty.call(measuredPresent, name)
    const gotAbsent = measuredMissing.includes(name)

    if (!got && !gotAbsent) {
      if (declaredPresent || declaredAbsent) {
        unanswered.push(name)
        warnings.push(
          `\`${name}\` \u00e9 declarado ${declaredPresent ? "PRESENTE" : "AUSENTE"} e a medi\u00e7\u00e3o N\u00c3O respondeu sobre ele` +
            " — nem presente nem ausente: o veredito do gate sobre esse shell n\u00e3o tem fato por tr\u00e1s.",
        )
      }
      continue
    }

    if (!declaredPresent && !declaredAbsent) continue

    if (declaredPresent && gotAbsent) {
      removed.push(name)
      warnings.push(
        `\`${name}\` est\u00e1 declarado como PRESENTE (\`${declared[name]}\`) e a imagem mediu AUSENTE` +
          ` — o gate PASSARIA um passo \`shell: ${name}\` que morre com \`command not found\` no runner.`,
      )
      continue
    }

    if (declaredAbsent && got) {
      added.push(name)
      warnings.push(
        `\`${name}\` est\u00e1 na imagem (\`${measuredPresent[name]}\`) e o gate o declara AUSENTE` +
          ` — o gate REPROVA um passo que declara \`shell: ${name}\` numa imagem que o tem.`,
      )
      continue
    }

    if (declaredPresent && got && declared[name] !== measuredPresent[name]) {
      moved.push(name)
      warnings.push(
        `\`${name}\` mudou de caminho: declarado \`${declared[name]}\`, medido \`${measuredPresent[name]}\`` +
          " — o relat\u00f3rio do gate cita um caminho que n\u00e3o existe mais.",
      )
    }
  }

  const unprobed = Object.keys(declared)
    .concat(missing)
    .filter((name) => !SHELLS_PROBED.includes(name))
  for (const name of [...new Set(unprobed)].sort()) {
    warnings.push(
      `\`${name}\` est\u00e1 DECLARADO mas a medi\u00e7\u00e3o nunca o PERGUNTA (fora de \`SHELLS_PROBED\`)` +
        " — o veredito do gate sobre ele \u00e9 presun\u00e7\u00e3o, n\u00e3o medi\u00e7\u00e3o.",
    )
  }

  const unused = SHELLS_PROBED.filter(
    (name) => !Object.prototype.hasOwnProperty.call(declared, name) && !missing.includes(name),
  )
  for (const name of unused) {
    warnings.push(
      `\`${name}\` \u00e9 PERGUNTADO pela medi\u00e7\u00e3o e nenhuma declara\u00e7\u00e3o o usa (nem presente nem ausente)` +
        " — o probe gasta uma pergunta cujo resultado ningu\u00e9m l\u00ea.",
    )
  }

  const unparsed = [...(measurement.unparsed ?? [])]
  if (unparsed.length > 0) {
    warnings.push(
      `a medi\u00e7\u00e3o devolveu ${unparsed.length} linha(s) que o parser n\u00e3o leu` +
        ` (ex.: \`${unparsed[0]}\`) — uma varredura que l\u00ea menos do que imprime n\u00e3o pode terminar em verde.`,
    )
  }

  warnings.sort()
  const sorted = (list) => [...list].sort()

  return {
    ...base,
    state: "measured",
    verdict: warnings.length === 0 ? "in-sync" : "drift",
    image: measurement.image,
    digest: measurement.digest ?? null,
    digestChanged:
      measurement.digest && declaredDigest ? measurement.digest !== declaredDigest : null,
    present: measuredPresent,
    missing: measuredMissing,
    unparsed,
    added: sorted(added),
    removed: sorted(removed),
    moved: sorted(moved),
    unprobed: [...new Set(unprobed)].sort(),
    unused: sorted(unused),
    unanswered: sorted(unanswered),
    counts: {
      probed: SHELLS_PROBED.length,
      present: Object.keys(measuredPresent).length,
      missing: measuredMissing.length,
      declaredPresent: Object.keys(declared).length,
      declaredMissing: missing.length,
    },
    warnings,
  }
}

/**
 * O relatório HUMANO — o que o job imprime e o `--shells` do gate resume.
 *
 * Ele ENUMERA as duas fontes (declarado × medido) e diz quantos nomes ficaram
 * fora da medição: um relatório que só dissesse "✅ em sincronia" esconderia a
 * cobertura, que é justamente o que envelhece.
 *
 * @param {RunnerShellsReport} report
 * @returns {string[]}
 */
export function reportLines(report) {
  const lines = []
  const mark = report.state === "unavailable" ? "·" : report.warnings.length === 0 ? "✅" : "❌"
  lines.push(
    `${mark} shells da imagem do runner: ${
      report.state === "unavailable"
        ? "INDETERMINADO"
        : report.warnings.length === 0
          ? "a medição concorda com o declarado"
          : `DRIFT (${report.warnings.length} aviso(s))`
    }`,
  )
  lines.push(`   imagem medida: ${report.image ?? "<sem ref — BUN_VERSION não resolvido>"}`)
  lines.push(
    `   digest:        ${report.digest ?? "<não perguntado>"}${
      report.digestChanged === true ? " (DIFERE do declarado — a tag foi reconstruída)" : ""
    }`,
  )
  lines.push(`   declarado em:  ${report.declaredMeasuredAt ?? "?"}`)
  if (report.state === "unavailable") {
    lines.push(`   motivo:        ${report.detail}`)
    return lines
  }
  const present = Object.entries(report.present ?? {})
  lines.push(`   TEM (${present.length}) — o gate PULA (com nome) um passo que os declare:`)
  for (const [nome, caminho] of present) lines.push(`     ${nome.padEnd(12)} ${caminho}`)
  lines.push(
    `   NÃO TEM (${(report.missing ?? []).length}) — o gate REPROVA um passo que os declare:`,
  )
  for (const nome of report.missing ?? []) lines.push(`     ${nome}`)
  lines.push(`   medição: ${report.counts?.probed ?? "?"} nome(s) perguntado(s)`)
  for (const aviso of report.warnings) lines.push(`   - ${aviso}`)
  lines.push(`   comando que mediu (re-executável):`)
  lines.push(`     ${probeCommandText(report.image ?? "<ref>")}`)
  return lines
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = `runner-shells — a medição dos shells da imagem do runner, comparada com a declaração do gate

Usage:
  node scripts/runner-shells.mjs                 # mede, compara e diz o veredito
  node scripts/runner-shells.mjs --json          # saída estruturada (STDOUT)
  node scripts/runner-shells.mjs --report /tmp/runner-shells.json
  node scripts/runner-shells.mjs --image <ref>   # mede outra ref (default: derivada do env)
  node scripts/runner-shells.mjs --docker <cliente>
  node scripts/runner-shells.mjs --help

Exit codes:
  0 — a medição concorda com o declarado
  1 — DRIFT (o ticket é o canal acionável: scripts/runner-shells-issue.mjs)
  2 — INDETERMINADO: não medi (docker ausente, imagem não puxável, BUN_VERSION sem valor)
  3 — uso inválido
`

/**
 * @param {string[]} argv
 * @returns {{json: boolean, report: string|null, image: string|null, docker: string, help: boolean}}
 */
export function parseArgs(argv) {
  const options = { json: false, report: null, image: null, docker: "docker", help: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--json") options.json = true
    else if (arg === "--help" || arg === "-h") options.help = true
    else if (arg === "--report" || arg === "--image" || arg === "--docker") {
      const value = argv[++i]
      if (value === undefined || value === "") {
        throw new Error(`${arg} exige um valor`)
      }
      if (arg === "--report") options.report = value
      else if (arg === "--image") options.image = value
      else options.docker = value
    } else {
      throw new Error(`Argumento desconhecido: ${arg}`)
    }
  }
  return options
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(USAGE)
    return 0
  }

  const report = shellsDriftReport({
    measurement: measureShells({
      ref: options.image ?? runnerImageRef(process.env),
      docker: options.docker,
    }),
  })

  if (options.report !== null) {
    writeFileSync(options.report, `${JSON.stringify(report, null, 2)}\n`)
  }
  if (options.json) {
    console.log(JSON.stringify(report, null, 2))
    for (const line of reportLines(report)) console.error(line)
  } else {
    for (const line of reportLines(report)) console.log(line)
    if (options.report !== null) console.log(`\nrelatório gravado: ${options.report}`)
  }

  if (report.state === "unavailable") return 2
  return report.warnings.length === 0 ? 0 : 1
}

const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (IS_DIRECT_RUN) {
  let code = 3
  try {
    code = await main()
  } catch (error) {
    console.error(`❌ ${error.message}`)
    code = 3
  }
  process.exit(code)
}
