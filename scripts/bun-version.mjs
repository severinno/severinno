#!/usr/bin/env node

// =============================================================================
// bun-version.mjs
//
// A resolução da versão do Bun PARA OS SCRIPTS — o único caminho pelo qual um
// script do repositório descobre a versão sem cravar um literal.
//
// A CADEIA da fonte única (nesta ordem, e é ela que este módulo deixa escrita):
//
//   1. repository variable `vars.BUN_VERSION` (a FONTE ÚNICA, fora do repo);
//   2. os ESPELHOS DECLARADOS dela no repositório — `.actrc` (o `--var` do act
//      local) e `deploy/env.gitea.example` (o env do runner da forja). Os dois
//      são ESCRITOS por `scripts/bump-bun.sh` e COMPARADOS com a variável pelo
//      guard periódico `scripts/check-actrc-sync.mjs` — é isso que faz de um
//      arquivo versionado uma derivação legítima da variável, e não um segundo
//      ponto de verdade;
//   3. o ambiente do processo (`BUN_VERSION`), que é como o CI entrega a
//      variável resolvida aos passos que a recebem por `env:`.
//
// Quem NÃO encontra nenhuma das três NÃO recebe um default silencioso: recebe
// uma exceção que nomeia os arquivos onde a versão deveria estar. Um literal de
// reserva (`process.env.BUN_VERSION || "1.3.14"`) é exatamente o defeito que
// este módulo existe para eliminar — ele sobrevive ao bump e ninguém percebe,
// porque o script continua funcionando, só medindo/rodando o Bun errado.
//
// POR QUE ESTA ORDEM (env antes dos espelhos): no CI a variável chega ao
// processo pelo `env:` do passo — é a fonte única resolvida. Os espelhos valem
// fora do CI (act local, máquina do operador), onde a variável não existe.
//
// Usage:
//   import { requireBunVersion, resolveBunVersion, readMirrorValues } from "./bun-version.mjs"
//
//   const { version, source } = requireBunVersion({ root: process.cwd() })
//   console.log(`medindo com o Bun ${version} (de ${source})`)
//
// Exit codes:
//   (nenhum) — este módulo NÃO é uma CLI: não chama process.exit nem imprime.
//   Quem decide o que fazer com a ausência da versão é o CONSUMIDOR:
//     - `resolveBunVersion` devolve `version: null` (o chamador decide);
//     - `requireBunVersion` LANÇA — o script que o usa traduz para o próprio
//       código de saída (a convenção dos scripts deste repo: 2 = uso/infra).
//
// O módulo é node-puro e não importa nada do repositório: ele é a FOLHA da
// árvore de imports do guard e dos consumidores.
// =============================================================================

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

/** A referência da repository variable — a FONTE ÚNICA da versão do Bun. */
export const BUN_VERSION_VAR = "${{ vars.BUN_VERSION }}"

/**
 * Os espelhos DECLARADOS da variável, na ordem em que são lidos.
 *
 * A lista é a fonte única de "onde a versão está declarada": o resolvedor (leitura),
 * o guard estático (`check-bun-mirror.mjs`) e o bump (`bump-bun.sh`) têm de
 * concordar sobre ela — dois espelhos declarados num lugar e comparados noutro é
 * a assimetria silenciosa que o `checkMirrorWriters` existe para pegar.
 *
 * Cada espelho carrega a REGEX da própria linha: elas não são iguais (o `.actrc`
 * usa a flag `--var` do act; o env da forja usa `KEY=valor`).
 *
 * E cada espelho carrega a DECISÃO DE RECORTE (`recorte`/`motivo`): o contrato
 * que o `check-mirror-coverage.mjs` mede. `recorte: null` com motivo é a ausência
 * DECLARADA — o que não pode existir é espelho sem decisão, que é o espelho novo
 * que ninguém decidiu como o commit julga (fail-closed).
 */
export const BUN_MIRRORS = [
  {
    file: ".actrc",
    line: /^--var BUN_VERSION=(.+)$/m,
    format: (v) => `--var BUN_VERSION=${v}`,
    recorte: null,
    motivo:
      "o recorte não julga o `.actrc`: ele não está em nenhuma pathspec de guard `--staged` (o hook roda o `check-bun-mirror --staged`, cujos alvos são `scripts/`, compose e Dockerfiles). Quem o cobre é a varredura GLOBAL do `check-bun-mirror` — que pega a troca E a remoção da flag —, e ela roda no PR, não no commit; o VALOR da flag é do `check-actrc-sync`/doctor, que precisam da variável da forja.",
  },
  {
    file: "deploy/env.gitea.example",
    line: /^BUN_VERSION=(.+)$/m,
    format: (v) => `BUN_VERSION=${v}`,
    recorte: null,
    motivo:
      "o recorte não julga o template do env: nenhum guard `--staged` o tem nas pathspecs. A REMOÇÃO da linha é da varredura GLOBAL do `check-bun-mirror` e do `check-registry-source` (o PR), e a TROCA do valor só é comparada pelo `check-actrc-sync` (que precisa do valor da variável da forja) e pelo doctor — ambas fora do commit.",
  },
]

/** Os nomes dos espelhos, para mensagens (nunca uma lista escrita à mão). */
export function mirrorFiles(mirrors = BUN_MIRRORS) {
  return mirrors.map((m) => m.file)
}

/** "`.actrc`, `deploy/env.gitea.example`" — para as mensagens de erro. */
export function mirrorListText(mirrors = BUN_MIRRORS) {
  return mirrorFiles(mirrors)
    .map((f) => `\`${f}\``)
    .join(", ")
}

/**
 * Lê o valor que cada espelho declara (na ordem de BUN_MIRRORS).
 *
 * Um espelho ausente ou sem a linha é OMITIDO em vez de virar erro: a leitura é
 * a parte de baixo do contrato (o guard estático é quem cobra a EXISTÊNCIA da
 * linha — `checkActrc`/`checkGiteaRunnerImage`).
 *
 * @param {string} [root]
 * @param {{file: string, line: RegExp}[]} [mirrors]
 * @returns {{file: string, value: string}[]}
 */
export function readMirrorValues(root = process.cwd(), mirrors = BUN_MIRRORS) {
  const out = []
  for (const mirror of mirrors) {
    const path = join(root, mirror.file)
    if (!existsSync(path)) continue
    const found = readFileSync(path, "utf8").match(mirror.line)
    if (found) out.push({ file: mirror.file, value: found[1].trim() })
  }
  return out
}

/**
 * A versão do Bun, resolvida. Nunca lança — devolve `version: null` quando não
 * há de onde tirá-la (quem decide o que fazer com isso é o consumidor).
 *
 * @param {{root?: string, env?: Record<string, string|undefined>, mirrors?: typeof BUN_MIRRORS}} [opts]
 * @returns {{version: string|null, source: string|null}}
 */
export function resolveBunVersion({
  root = process.cwd(),
  env = process.env,
  mirrors = BUN_MIRRORS,
} = {}) {
  const fromEnv = env?.BUN_VERSION
  if (typeof fromEnv === "string" && fromEnv.trim() !== "") {
    return { version: fromEnv.trim(), source: "a variável do ambiente (BUN_VERSION)" }
  }
  const declared = readMirrorValues(root, mirrors)
  if (declared.length > 0) {
    return { version: declared[0].value, source: `o espelho \`${declared[0].file}\`` }
  }
  return { version: null, source: null }
}

/**
 * Igual a `resolveBunVersion`, mas LANÇA quando não há versão declarada — a
 * forma que um script usa quando um default silencioso seria pior que falhar.
 *
 * A mensagem nomeia os espelhos e o motivo: quem lê o erro sabe ONDE declarar e
 * POR QUE não existe reserva.
 *
 * @param {{root?: string, env?: Record<string, string|undefined>, mirrors?: typeof BUN_MIRRORS}} [opts]
 * @returns {{version: string, source: string}}
 */
export function requireBunVersion(opts = {}) {
  const resolved = resolveBunVersion(opts)
  if (resolved.version !== null) return resolved
  const mirrors = opts.mirrors ?? BUN_MIRRORS
  throw new Error(
    `BUN_VERSION não declarado: nem na variável do ambiente nem nos espelhos do repositório (${mirrorListText(mirrors)}). ` +
      `Não existe default de reserva de propósito: um literal aqui envelheceria em silêncio — ` +
      `o script seguiria rodando/medindo a versão antiga depois do bump, sem nada acusar. ` +
      `Declare a versão no espelho mais próximo (ou passe \`${BUN_VERSION_VAR}\` pelo \`env:\` do passo).`,
  )
}
