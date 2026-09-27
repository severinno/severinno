#!/usr/bin/env node
// =============================================================================
// check-runner-tag.mjs — a imagem do act_runner DECLARA uma versão?
//
// Usage:
//   node scripts/check-runner-tag.mjs            # o compose da forja (default)
//   node scripts/check-runner-tag.mjs --root X   # fixture (mutation test)
//   node scripts/check-runner-tag.mjs --json     # saída estruturada
//   node scripts/check-runner-tag.mjs -h
//
// Exit codes:
//   0 — a imagem declarada para o serviço do runner PINA: tag de versão
//       (`0.6.1`, `v0.6.1`) ou DIGEST (`repo@sha256:…`, imutável)
//   1 — VIOLAÇÃO: tag que não é versão (`latest`, `stable`, …), imagem sem tag
//       (o `latest` implícito do docker), imagem que não é literal (`${…}`),
//       serviço do runner sem `image:` — ou o serviço ausente do compose
//   2 — INFRA (fail-closed): o compose ausente ou ilegível — sem o artefato não
//       há veredito a cunhar
//
// POR QUE EXISTE
//
// O `runner-labels:check` (o veredito de runtime) já julga esta declaração — mas
// só ONDE A FORJA RODA: ele compara a tag com a versão que o binário do container
// reporta, e por isso exige docker + container no ar. A pergunta desta guarda é
// mais estreita e não precisa de nada disso: o TEXTO do compose declara uma
// versão? Ela é a metade que pode rodar em qualquer lugar (node puro, offline) e
// é ela que entra no CI das duas forjas.
//
// A CLASSE, medida em 22/09/2026: o compose declarava `gitea/act_runner:latest`,
// e `latest` NÃO é uma versão — é o nome de uma PROMESSA do registry. O
// act_runner NÃO se auto-atualiza (ao contrário do runner auto-hospedado do
// GitHub, cujo serviço pega o update no meio do primeiro job): quem decide a
// versão do binário é a IMAGEM que o compose declara. Com uma tag flutuante, o
// `docker compose pull` de um dia qualquer troca a versão que a forja RODA sem
// uma linha do repositório mudar e SEM SINTOMA — o setup do Bun funciona, os
// testes passam, e o único sinal seria o dia em que algo quebrar. No mesmo dia a
// tag virou `gitea/act_runner:0.6.1` (o MESMO digest que o `latest` servia,
// medido: sha256:b5c35d6d…; e `v0.6.1` NÃO existe no registry — o `v` seria um
// pin quebrado). O que faltava era a guarda que impede a volta em SILÊNCIO — e é
// esta.
//
// A RÉGUA É UMA SÓ, e vem de quem já a mede: `isVersionTag`/`imageTag`/
// `imageDigest` são importados do `check-runner-labels.mjs`. Uma segunda
// implementação de "a tag declara versão?" divergiria no primeiro caso de borda
// (tag sem tag, digest, `v` de prefixo) e os dois vereditos passariam a falar de
// coisas diferentes com o mesmo nome.
//
// O QUE ESTE GUARD NÃO FAZ (limites declarados)
//
//   · não julga a imagem do Gitea nem a da imagem dos jobs: uma regra geral de
//     "declara versão" acusaria tags LEGÍTIMAS com sufixo (`postgres:16-alpine`,
//     `node:20-bullseye`) — um alarme falso é o que ensina a ignorar o guard. A
//     classe que ele cobre é a do runner, onde a versão decide o que a forja
//     executa;
//   · não consulta o registry: o que a tag serve hoje é do `check-runner-base`
//     (que prova a tag contra o digest) e do `runner-labels:check` (que prova a
//     tag contra o binário no ar). Aqui a pergunta é sobre a DECLARAÇÃO;
//   · não lê o render do compose (`docker compose config`): a declaração é
//     literal por desenho, e um valor que só existe no render é o caso que ele
//     RECUSA — a imagem com `${…}` é violação, porque o pin que a stack sobe
//     deixaria de estar no texto do repositório.
//
// WIRING: roda nas DUAS pipelines (o job `guards` da forja dona do merge e o
// `workflow-refs-guard` do espelho), ao lado do irmão `check-runner-base`, e no
// PRE-COMMIT (fase B do `.husky/pre-commit`) — e é um invariante do CORE
// (`check-forge-parity`), então uma pipeline que o perca fica vermelha por
// paridade. A linha do hook é a MESMA do CI (o comando canônico do invariante),
// reconhecida por IGUALDADE no `check-hook-ci-parity`: sem recorte, e por isso
// sem entrada em `HOOK_DECLARED`.
//
// POR QUE SEM `--staged` (declarado, e não descuido): (a) a linha do hook é a do
// CI, então não existe uma segunda semântica para divergir da primeira; e (b) o
// `check-mirror-coverage` DERIVA o recorte do hook — toda linha `--staged` dele —
// e esta guarda não julga espelho nenhum (julga a declaração de UMA imagem):
// marcar `--staged` a poria, por construção, no conjunto de comandos que decide
// se cada espelho é julgado. O hook lê o ARTEFATO da ÁRVORE e o CI lê o conteúdo
// mergeado; o caso que escapa do local é um `git add -p` que deixasse no ÍNDICE
// uma tag diferente da árvore — janela estreita, e nomeada em vez de escondida.
//
// O ARTEFATO NA CÓPIA DO FIXTURE: a guarda abre o compose por CAMINHO, e um
// compose ausente é INFRA (fail-closed). O fixture do hook passou a MATERIALIZAR
// os artefatos que os guards do hook LEEM — a lista é DERIVADA por execução
// (`scripts/artefatos-do-hook.mjs`), e não declarada à mão: sem o arquivo na cópia
// a guarda leria INFRA e o vermelho seria do FIXTURE, não do defeito — era essa a
// razão de ela estar declarada em `HOOK_NOT_RUN`, e é ela que deixou de valer.
// =============================================================================

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import process from "node:process"

import { GITEA_COMPOSE } from "./check-bun-mirror.mjs"
// A régua do pin vive no dono dela (o veredito de runtime a usa desde a primeira
// versão): aqui ela é IMPORTADA, nunca reescrita.
import { RUNNER_SERVICE, imageDigest, imageTag, isVersionTag } from "./check-runner-labels.mjs"

export const EXIT = {
  OK: 0,
  VIOLATION: 1,
  INFRA: 2,
}

const MARK = { ok: "✅", fail: "❌", warn: "⚠️", info: "▸" }

/**
 * O `image:` do serviço do runner, lido do TEXTO do compose.
 *
 * O bloco é delimitado pela INDENTAÇÃO (a chave do serviço abre em 2 espaços; o
 * bloco termina no próximo irmão) porque é assim que o YAML o delimita. Nada de
 * `js-yaml`: os guards desta família são node puro (rodam sem `node_modules`), e
 * a leitura é de UMA linha do bloco.
 *
 * Um `image:` com comentário de fim de linha é descontado (o valor é o que o
 * docker lê) — e uma linha comentada (`# image: …`) NÃO responde pela chave.
 *
 * @param {string} text conteúdo de `${GITEA_COMPOSE}`
 * @returns {{ok: boolean, image: string|null, line: number|null, detail: string}}
 */
export function runnerServiceImage(text) {
  const linhas = String(text ?? "").split(/\r?\n/)
  let indent = null
  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i]
    if (indent === null) {
      const abre = /^(\s*)runner:\s*(?:#.*)?$/.exec(linha)
      if (abre) indent = abre[1].length
      continue
    }
    const atual = linha.match(/^(\s*)\S/)
    if (atual && atual[1].length <= indent) break // irmão (outro serviço) — o bloco acabou
    if (/^\s*#/.test(linha)) continue
    const imagem = /^\s+image:\s*(.+?)\s*$/.exec(linha)
    if (!imagem) continue
    const valor = imagem[1].replace(/\s+#.*$/, "").trim()
    const desquoted = valor
      .replace(/^"(.*)"$/, "$1")
      .replace(/^'(.*)'$/, "$1")
      .trim()
    return { ok: true, image: desquoted, line: i + 1, detail: `image (linha ${i + 1})` }
  }
  return {
    ok: false,
    image: null,
    line: null,
    detail: `${GITEA_COMPOSE}: o serviço '${RUNNER_SERVICE}' não declara \`image:\` (ou não existe no arquivo) — sem imagem declarada não há pin a julgar, e nenhum job encontra runner`,
  }
}

/**
 * O veredito de UMA referência de imagem do runner. Puro.
 *
 * Estados (o vocabulário é o do `runner-labels:check`, para os dois vereditos
 * falarem a mesma língua):
 *   - `proven`       — a tag declara uma versão;
 *   - `digest`       — a imagem é pinada por digest: imutável. O pin é MAIS
 *                      forte que uma tag, mas ele não declara VERSÃO — a
 *                      comparação com o binário não se aplica (é o mesmo
 *                      `digest` do `compareActRunnerVersion`), e por isso este
 *                      estado não é violação nem "proven por versão";
 *   - `floating`     — a tag NÃO é versão (ou não existe tag alguma: o docker
 *                      assume `latest`);
 *   - `interpolated` — o valor não é literal (`${…}`): o pin que a stack sobe
 *                      deixaria de estar no texto do repositório;
 *   - `no-image`     — o serviço não declara imagem.
 *
 * @param {unknown} ref
 * @returns {{state: string, tag: string|null, digest: string|null, detail: string}}
 */
export function judgeDeclaration(ref) {
  const texto = String(ref ?? "").trim()
  if (texto === "")
    return {
      state: "no-image",
      tag: null,
      digest: null,
      detail: `o serviço '${RUNNER_SERVICE}' não declara \`image:\``,
    }
  const digest = imageDigest(texto)
  const tag = imageTag(texto)
  if (/\$\{|\$[A-Za-z_(]/.test(texto))
    return {
      state: "interpolated",
      tag,
      digest,
      detail: `a imagem '${texto}' NÃO é literal (interpolação): o pin que a stack sobe deixa de estar no texto do repositório — declare a versão aqui`,
    }
  if (digest !== null)
    return {
      state: "digest",
      tag,
      digest,
      detail: `a imagem '${texto}' é pinada por DIGEST (${digest}): imutável — um digest não declara versão, e a comparação com o binário não se aplica`,
    }
  if (tag === null)
    return {
      state: "floating",
      tag: null,
      digest: null,
      detail: `a imagem '${texto}' não tem tag — o docker assume \`latest\``,
    }
  if (!isVersionTag(tag))
    return {
      state: "floating",
      tag,
      digest: null,
      detail: `a tag '${tag}' não é uma versão`,
    }
  return {
    state: "proven",
    tag,
    digest: null,
    detail: `a tag '${tag}' declara a versão que a stack roda`,
  }
}

/**
 * A decisão: a declaração do compose PINA a imagem do runner?
 *
 * `text` é injetável para o fixture/mutation test ler o veredito de um compose
 * MUTADO sem escrever no repositório.
 *
 * @param {{root?: string, text?: string|null}} [args]
 * @returns {{state: "proven"|"violated"|"infra", violations: string[], warnings: string[], info: {image?: string|null, line?: number|null, tag?: string|null, digest?: string|null, verdict?: string|null}, detail: string}}
 */
export function checkRunnerTag({ root = process.cwd(), text = null } = {}) {
  const vazio = { violations: [], warnings: [], info: {} }
  let fonte = text
  if (fonte === null) {
    const caminho = join(root, GITEA_COMPOSE)
    if (!existsSync(caminho))
      return {
        ...vazio,
        state: "infra",
        detail: `${GITEA_COMPOSE} não existe em ${root} — sem o artefato não há veredito a cunhar`,
      }
    try {
      fonte = readFileSync(caminho, "utf8")
    } catch (err) {
      return {
        ...vazio,
        state: "infra",
        detail: `${GITEA_COMPOSE} ilegível: ${err?.message ?? String(err)}`,
      }
    }
  }

  const declarado = runnerServiceImage(fonte)
  if (!declarado.ok) {
    return {
      state: "violated",
      violations: [declarado.detail],
      warnings: [],
      info: { image: null, line: null, tag: null, digest: null, verdict: "no-image" },
      detail: `a imagem do runner não foi encontrada em ${GITEA_COMPOSE}`,
    }
  }

  const julgado = judgeDeclaration(declarado.image)
  const info = {
    image: declarado.image,
    line: declarado.line,
    tag: julgado.tag,
    digest: julgado.digest,
    verdict: julgado.state,
  }
  if (julgado.state === "proven")
    return {
      state: "proven",
      violations: [],
      warnings: [],
      info,
      detail: `a imagem do runner PINA uma versão (${declarado.image})`,
    }
  if (julgado.state === "digest")
    return {
      state: "proven",
      violations: [],
      warnings: [
        `a imagem do runner é pinada por DIGEST (${julgado.digest}): imutável, mas sem versão declarada — a comparação com o binário do container é do \`runner-labels:check\` (estado \`digest\`)`,
      ],
      info,
      detail: `a imagem do runner está pinada por digest (${declarado.image})`,
    }

  const remedio =
    julgado.state === "interpolated"
      ? "declare a tag LITERAL aqui (o pin julga o texto do compose, e um valor que só existe no render não está no repositório)"
      : `pine a tag à versão que a stack roda hoje — \`bash deploy/gitea-up.sh --re-register\` garante a imagem, apaga o registro e sobe o runner (ver deploy/GITEA.md § Runner)`
  return {
    state: "violated",
    violations: [
      `${GITEA_COMPOSE}:${declarado.line} — ${julgado.detail}: o \`docker compose pull\` de outro dia troca a versão que a forja RODA sem uma linha do repositório mudar e sem sintoma nenhum (o act_runner NÃO se auto-atualiza: quem decide a versão do binário é esta imagem — MEDIDO em 22/09/2026: \`latest\` reportava \`v0.6.1\`). Remédio: ${remedio}.`,
    ],
    warnings: [],
    info,
    detail: `a imagem do runner NÃO pina versão (${julgado.state})`,
  }
}

/** O relatório legível — o MESMO texto na CLI e no log do CI. */
export function renderReport(result) {
  const head =
    result.state === "proven"
      ? `${MARK.ok} ${result.detail}`
      : result.state === "infra"
        ? `${MARK.warn} INDETERMINADO — ${result.detail}`
        : `${MARK.fail} ${result.detail}`
  const lines = [`check-runner-tag: ${head}`]
  if (result.info?.image)
    lines.push(
      `  imagem    : ${result.info.image} (linha ${result.info.line} de ${GITEA_COMPOSE}, serviço '${RUNNER_SERVICE}')`,
    )
  if (result.info?.verdict) lines.push(`  veredito  : ${result.info.verdict}`)
  for (const v of result.violations) lines.push(`  ${MARK.fail} ${v}`)
  for (const w of result.warnings) lines.push(`  ${MARK.warn} ${w}`)
  return lines.join("\n")
}

export const USAGE = `check-runner-tag — a imagem do act_runner declara uma versão?

Usage:
  node scripts/check-runner-tag.mjs [opções]

Opções:
  --root <dir>            raiz do checkout (default: o cwd) — o fixture o usa
  --json                  saída estruturada
  -h, --help              esta ajuda

O que ele prova:
  · o serviço '${RUNNER_SERVICE}' de ${GITEA_COMPOSE} declara \`image:\`;
  · a referência declara uma VERSÃO (\`0.6.1\`, \`v0.6.1\`) ou um DIGEST imutável;
  · tudo o mais é VIOLAÇÃO — \`latest\`/\`stable\`, imagem sem tag, valor
    interpolado (\`\${…}\`) e serviço sem imagem — porque nesses estados o
    \`docker compose pull\` de outro dia troca a versão que a forja RODA sem
    uma linha do repositório mudar e sem sintoma.

A régua ("a tag declara versão?") é importada do \`check-runner-labels.mjs\` — a
MESMA que o \`runner-labels:check\` usa contra o binário do container. Aqui ela
julga só a DECLARAÇÃO (node puro, offline): não consulta o registry e não lê o
render do compose.

Exit codes:
  0 — pina (versão ou digest)   1 — violação   2 — infra (compose ausente/ilegível)`

/**
 * @param {string[]} argv
 * @returns {{root: string, json: boolean, help: boolean, error?: string}}
 */
export function parseArgs(argv) {
  const opts = { root: process.cwd(), json: false, help: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--json") opts.json = true
    else if (arg === "-h" || arg === "--help") opts.help = true
    else if (arg === "--root") {
      const next = argv[++i]
      if (next === undefined || next.startsWith("--"))
        return { ...opts, error: "--root exige um diretório" }
      opts.root = next
    } else if (arg.startsWith("-")) return { ...opts, error: `argumento desconhecido: ${arg}` }
  }
  return opts
}

/** O exit code de um resultado — o CONTRATO da CLI. */
export function exitCodeFor(result) {
  if (result.state === "proven") return EXIT.OK
  if (result.state === "infra") return EXIT.INFRA
  return EXIT.VIOLATION
}

const isMain = !!process.argv[1] && process.argv[1].split(/[\\/]/).pop() === "check-runner-tag.mjs"

if (isMain) {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.error) {
    console.error(`check-runner-tag: ${opts.error}`)
    console.error(USAGE)
    process.exit(EXIT.INFRA)
  }
  if (opts.help) {
    console.log(USAGE)
    process.exit(EXIT.OK)
  }
  const result = checkRunnerTag({ root: opts.root })
  if (opts.json) {
    console.log(JSON.stringify({ ...result, exitCode: exitCodeFor(result) }, null, 2))
  } else {
    console.log(renderReport(result))
  }
  process.exit(exitCodeFor(result))
}
