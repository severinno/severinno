#!/usr/bin/env node

// =============================================================================
// check-doctor-ci.mjs
//
// O GATE de PR que responde "o VALOR das repository variables continua sendo o
// que o repositório declara?" — rodando o `forge-doctor.mjs` no PERFIL `--ci`,
// com os valores chegando pelo AMBIENTE (o workflow exporta `vars.*`).
//
// POR QUE ELE EXISTE (e por que não é o doctor direto na pipeline): o doctor
// exige que todo gate da pipeline dona do merge seja uma linha `run: <cmd>`
// executável por LISTA DE ARGUMENTOS — não por shell (`gateRunLine`/`gateCommand`
// o recompõem para rodá-lo na bateria e na prova). O gate precisa de lógica
// (montar as flags a partir de variáveis que podem não existir, e traduzir o
// veredito do doctor em sucesso/fracasso de pipeline), e essa lógica num
// `run: |` deixaria a linha invisível para o próprio doctor. Este script é o
// caminho: `run: bun scripts/check-doctor-ci.mjs` é uma linha, e a lógica mora
// aqui, testável sem pipeline.
//
// O QUE ELE FAZ, nesta ordem:
//   1. monta as flags `--expected`/`--expected-var` a partir do AMBIENTE, para
//      CADA variável de `MIRROR_VARIABLES` (a fonte única do conjunto: as
//      mesmas que o compose da forja consome e que o guard semanal compara);
//   2. uma variável AUSENTE não vira flag vazia: uma régua vazia é lida como
//      "não perguntado" e o relatório ficaria verde sem ter conferido nada — o
//      passo NOMEIA a ausência (`::warning::`) em vez de silenciá-la;
//   3. roda o doctor com `--ci` e traduz o veredito em exit code de pipeline.
//
// A TRADUÇÃO DO VEREDITO (o coração do gate): o perfil `--ci` é INDETERMINADA
// por DESENHO — as seções que exigem rede, credencial de administração ou o
// estado do HOST ficam para o cron semanal, e o doctor as NOMEIA no relatório.
// Tratá-las como fracasso faria todo PR nascer vermelho (o "gate que sempre
// acende" que este repositório recusa). Então:
//   0 (PRONTA) e 2 (INDETERMINADA) → 0 — nenhuma violação DENTRO do recorte;
//   1 (BLOQUEADA)                  → 1 — violação real (o valor diverge);
//   3 (uso/erro interno) e outros  → 3 — sem veredito não há gate (falha).
//
// O que este gate NÃO prova (e não finge provar): a imagem publicada, a branch
// protection registrada, o registro do runner, o board e o próprio bloqueio da
// subida. Quem cobre é `.gitea/workflows/forge-doctor.yml` (cron) e o
// `deploy/gitea-up.sh` (pré-requisito da stack).
//
// Usage:
//   node scripts/check-doctor-ci.mjs                 # o gate (usa o ambiente)
//   node scripts/check-doctor-ci.mjs --json          # o relatório, como dados
//   BUN_VERSION=1.3.14 IMAGE_REGISTRY=git.severinno.com IMAGE_NAMESPACE=severinno \
//     node scripts/check-doctor-ci.mjs               # local, com os valores
//
// Exit codes:
//   0 — nenhuma violação no recorte local (inclui o INDETERMINADA que o perfil
//       declara: o que ficou fora está NOMEADO no relatório)
//   1 — BLOQUEADA: o valor de uma repository variable diverge do que os
//       espelhos declaram (ou o contrato/env/render falhou). O relatório acima
//       nomeia cada bloqueio e o remédio
//   3 — o doctor não conseguiu medir (uso/erro interno) — sem veredito o gate
//       falha em vez de parecer verde
// Node puro, sem deps; o doctor é chamado pelo MESMO interpretador deste
// processo (`process.execPath`), então vale tanto `node` quanto `bun`.
// =============================================================================

import { spawnSync } from "node:child_process"
import { dirname, join } from "node:path"
import process from "node:process"
import { fileURLToPath, pathToFileURL } from "node:url"

import { MIRROR_VARIABLES } from "./check-actrc-sync.mjs"

const HERE = dirname(fileURLToPath(import.meta.url))
const DOCTOR = join(HERE, "forge-doctor.mjs")

/** O perfil do doctor que este gate usa (o recorte local, sem rede/credencial). */
export const DOCTOR_PROFILE_FLAG = "--ci"

/**
 * As flags do doctor a partir do AMBIENTE — o workflow exporta `vars.*` e o
 * valor chega por aqui. Uma variável AUSENTE (ou vazia) sai de `missing` em vez
 * de virar flag com valor vazio: o comparador do doctor trata `''` como um
 * estado próprio ("não configurada"), e passar a régua vazia adiante daria um
 * verde que não conferiu nada.
 *
 * @param {Record<string, string|undefined>} [env]
 * @returns {{flags: string[], missing: string[]}}
 */
export function doctorFlags(env = process.env) {
  const flags = []
  const missing = []
  for (const name of MIRROR_VARIABLES) {
    const value = String(env[name] ?? "").trim()
    if (value === "") {
      missing.push(name)
      continue
    }
    // `--expected` é o atalho histórico da versão; as demais entram por
    // `--expected-var NOME=VALOR` (duas formas de escrever o MESMO valor
    // criariam uma precedência silenciosa — o guard recusa o atalho duplicado).
    if (name === "BUN_VERSION") flags.push("--expected", value)
    else flags.push("--expected-var", `${name}=${value}`)
  }
  return { flags, missing }
}

/**
 * A tradução do veredito do doctor em exit code de pipeline.
 *
 * @param {number|null} doctorExit  o exit code do doctor (0/1/2/3)
 * @returns {number} 0 (segue), 1 (bloqueia) ou 3 (não mediu)
 */
export function gateExitCode(doctorExit) {
  if (doctorExit === 0 || doctorExit === 2) return 0
  if (doctorExit === 1) return 1
  return 3
}

/** Aviso anotável para as variáveis que não chegaram — nomeadas, uma a uma. */
export function missingValueWarning(missing) {
  return (
    `::warning::repository variable(s) NÃO configurada(s): ${missing.join(", ")} — ` +
    "o VALOR delas NÃO foi conferido (um comparador com régua vazia diria 'não perguntado'). " +
    "O repositório declara as três como fonte única da imagem do runner: crie a(s) variável(is) " +
    "com o valor que os espelhos declaram (o job semanal actrc-sync, em modo --fail, acusa o mesmo)."
  )
}

async function main() {
  const argv = process.argv.slice(2)
  const json = argv.includes("--json")
  const extra = argv.filter((a) => a !== "--json")
  if (extra.length > 0) {
    console.error(`check-doctor-ci: argumento desconhecido: ${extra.join(" ")}`)
    console.error("  Uso: node scripts/check-doctor-ci.mjs [--json]")
    process.exit(3)
  }

  const { flags, missing } = doctorFlags(process.env)
  if (missing.length > 0) console.log(missingValueWarning(missing))

  const args = [DOCTOR, DOCTOR_PROFILE_FLAG, ...(json ? ["--json"] : []), ...flags]
  // `process.execPath` (e não `node` nem `bun` cravado): na forja o gate roda por
  // bun, no GitHub por node, e o doctor é o MESMO arquivo — quem interpreta é
  // quem já está interpretando este script.
  const res = spawnSync(process.execPath, args, { stdio: "inherit" })
  if (res.error) {
    console.error(`check-doctor-ci: não foi possível executar o doctor: ${res.error.message}`)
    process.exit(3)
  }

  const code = gateExitCode(res.status)
  if (code === 0) {
    console.log(
      "✅ doctor (perfil --ci): nenhuma violação no recorte local — o relatório acima NOMEIA o que ficou fora dele (rede, credencial de administração e estado do HOST são do cron semanal).",
    )
  } else if (code === 1) {
    console.error(
      "::error::O doctor BLOQUEOU: o valor de uma repository variable diverge do que os espelhos declaram (ou o contrato/env/render falhou). O relatório acima nomeia cada bloqueio e o remédio.",
    )
  } else {
    console.error(
      `::error::O doctor não conseguiu medir (exit ${res.status}; 3 = uso/erro interno) — sem veredito não há gate.`,
    )
  }
  process.exit(code)
}

const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (IS_DIRECT_RUN) await main()
