#!/usr/bin/env node

// =============================================================================
// check-actrc-sync.mjs
//
// Guard PERIÓDICO (semanal) dos DOIS espelhos da repository variable
// BUN_VERSION que o guard estático não consegue comparar: o `.actrc` (espelho
// local do act) e `deploy/env.gitea.example` (espelho do runner da forja).
//
// O guard estático scripts/check-bun-mirror.mjs valida que cada espelho DEFINE
// BUN_VERSION (existe a linha `--var BUN_VERSION=...` / `BUN_VERSION=...`), mas
// NÃO pode conferir se o VALOR bate com a variável do GitHub — isso é
// impossível estaticamente (a variável remota só existe em runtime no
// Actions). Este script compara os DOIS: o job semanal `actrc-sync` do
// benchmark-weekly.yml passa o valor real de vars.BUN_VERSION via `--expected`
// e o script lê os espelhos do working tree.
//
// POR QUE DOIS: cada espelho governa um caminho de execução diferente, e os
// dois falham em SILÊNCIO quando divergem.
//   - `.actrc` — o act local não lê as variables do repositório sem `--var`
//     (ver header do .actrc): trocar a variável no GitHub e esquecer o .actrc
//     faz o act local testar uma versão DIFERENTE da produção.
//   - `deploy/env.gitea.example` — é ele que alimenta GITEA_RUNNER_LABELS (a
//     imagem que roda os jobs da forja). Divergir NÃO quebra nada visível: o
//     setup-bun funciona igual com ou sem Bun pré-instalado, então o runner
//     roda a versão errada e o fast path de 0s do tier-1 desliga em silêncio
//     (todo job passa a pagar o download).
//
// Este aviso semanal fecha o loop com `::warning::` (NÃO-bloqueante: é
// desalinhamento de configuração, não um bug de CI).
//
// QUEM LÊ O AVISO, POR LADO (o canal muda, a regra não):
//   - GITHUB: `scripts/actrc-sync-issue.mjs`, no step `if: always()` do mesmo
//     job — transforma ESTE mesmo diagnóstico (a função `mirrorDriftReport`
//     abaixo é a fonte única dos dois) em issue com label `actrc-sync-drift` e
//     dedup por assinatura. Sem isso o aviso ficava só como anotação dentro de
//     um run verde, e a documentação prometia uma issue que não existia;
//   - FORJA: não há canal de issue — o job roda com `--fail`, porque o único
//     sinal lido lá é o status do run.
//
// A extração de `mirrorDriftReport` existe para os dois lados não divergirem:
// a issue e o log saem da MESMA decisão de "o que é drift".
//
// Exit codes:
//   0 — os dois espelhos em sincronia com --expected; OU divergência/variável
//       ausente reportada como ::warning:: sem falhar (modo aviso — o job
//       semanal não quebra; a ausência da variável é drift de config, não bug
//       de CI)
//   1 — (modo --fail) divergência OU variável ausente — para validação
//       local/CI estrito (a ausência é o drift mais grave)
//   2 — uso inválido (--expected ausente / .actrc ilegível)
//
// Usage:
//   node scripts/check-actrc-sync.mjs --expected 1.3.14
//   node scripts/check-actrc-sync.mjs --expected "${{ vars.BUN_VERSION }}" --fail
//   node scripts/check-actrc-sync.mjs --expected 1.3.14 --actrc /tmp/.actrc
//   node scripts/check-actrc-sync.mjs --expected 1.3.14 --gitea-env /tmp/env.gitea
//
// Escopo: lê o .actrc e os arquivos de env da forja. Os de env são DESCOBERTOS
// no workspace: o template comitado (deploy/env.gitea.example) sempre que
// existe, mais os arquivos do host (deploy/.env.gitea) — que é o que o compose
// lê de verdade no VPS. `--gitea-env <caminho>` substitui a descoberta para
// apontar um arquivo específico (ex.: /opt/gitea/.env). Um espelho AUSENTE é
// ignorado — a ausência do arquivo não é o drift que este guard caça (o
// estático é que exige a linha).
// Node puro, sem deps, <1s.
// =============================================================================

import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"

/**
 * Espelho da variável para o runner da forja — caminho relativo à raiz do
 * repositório. É o arquivo COMITADO (o template/estado desejado).
 */
export const GITEA_ENV_MIRROR = "deploy/env.gitea.example"

/**
 * Espelhos do HOST — gitignored, existem só onde a stack roda (o checkout do
 * VPS, a máquina do dev). É ESTE arquivo que o compose lê (`--env-file`) e que
 * define a tag da imagem do runner; o template acima é a origem dele.
 */
export const GITEA_ENV_DEPLOYED = ["deploy/.env.gitea"]

/**
 * Os arquivos de env da forja a comparar, na ordem canônica: o template
 * primeiro (existe em qualquer checkout), depois os do host que estiverem
 * presentes.
 *
 * POR QUE DESCOBRIR EM VEZ DE EXIGIR `--gitea-env`: o arquivo do host é
 * gitignored, então num clone ele não existe e não há o que comparar (ausência
 * de ARQUIVO não é o drift que este guard caça — o estático check-bun-mirror é
 * que exige a linha BUN_VERSION dentro dele). Mas num checkout do VPS ele
 * EXISTE, e era justamente ali que ele ficava invisível: o guard olhava só o
 * template e dizia "espelhos em sincronia" enquanto a versão que o runner usa
 * de verdade podia estar outra. O silêncio era pior que o aviso.
 *
 * @param {string} cwd
 * @returns {{path: string, label: string, deployed: boolean}[]}
 */
export function discoverEnvMirrors(cwd = process.cwd()) {
  const candidates = [
    { path: GITEA_ENV_MIRROR, label: GITEA_ENV_MIRROR, deployed: false },
    ...GITEA_ENV_DEPLOYED.map((p) => ({ path: p, label: p, deployed: true })),
  ]
  return candidates
    .filter((c) => existsSync(join(cwd, c.path)))
    .map((c) => ({ ...c, path: join(cwd, c.path) }))
}

/**
 * Extrai o valor de BUN_VERSION de um .actrc (ex.: `--var BUN_VERSION=1.3.14`
 * → '1.3.14'). Tolera aspas e descarta comentário inline. Retorna null se o
 * .actrc não definir BUN_VERSION.
 *
 * A regex é ANCOORADA ao início da linha e linhas de comentário (`#`) são
 * descartadas ANTES do match — um comentário como `# --var BUN_VERSION=2.0`
 * NÃO pode gerar falso divergência (o primeiro match ganharia e extrairia o
 * valor errado).
 *
 * @param {string} content  conteúdo do .actrc
 * @returns {string|null}
 */
export function extractActrcBunVersion(content) {
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed === "" || trimmed.startsWith("#")) continue
    const m = trimmed.match(/^--var\s+BUN_VERSION\s*=\s*"?([^"\s#]+)"?/)
    if (m) return m[1]
  }
  return null
}

/**
 * Extrai o valor de BUN_VERSION de um arquivo de env da forja (o espelho do
 * runner — `deploy/env.gitea.example` e, no VPS, o `deploy/.env.gitea` que
 * dele deriva). Formato shell: `BUN_VERSION=1.3.14`, opcionalmente com
 * `export ` e/ou aspas. Retorna null se o arquivo não definir BUN_VERSION.
 *
 * Mesma defesa do .actrc: linha ancorada + comentários descartados ANTES do
 * match — o arquivo é quase todo prosa, e um comentário do tipo
 * `# BUN_VERSION=1.4.0` (exemplo desatualizado no header) não pode gerar falso
 * drift pegando o valor errado.
 *
 * @param {string} content  conteúdo do arquivo de env
 * @returns {string|null}
 */
export function extractEnvMirrorBunVersion(content) {
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed === "" || trimmed.startsWith("#")) continue
    const m = trimmed.match(/^(?:export\s+)?BUN_VERSION\s*=\s*"?([^"\s#]+)"?/)
    if (m) return m[1]
  }
  return null
}

/**
 * Compara o valor de UM espelho com o valor REAL da repository variable
 * (passado via --expected, resolvido de vars.BUN_VERSION no workflow).
 * Retorna a lista de avisos (vazia = em sincronia).
 *
 * `consequencia` entra na mensagem — cada espelho falha de um jeito próprio, e
 * o aviso só é acionável se disser QUAL. Sem isso, os dois avisos virariam o
 * mesmo texto genérico e quem lê não saberia o que o drift custa.
 *
 * @param {string} mirror           rótulo do espelho (ex.: '.actrc')
 * @param {string} linha            a linha que o arquivo deveria ter
 * @param {string} consequencia     o que quebra quando diverge
 * @param {string|null} mirrorVersion  valor lido (null = não definido)
 * @param {string} expected         valor da repository variable
 * @returns {string[]}
 */
function driftWarnings(mirror, linha, consequencia, mirrorVersion, expected) {
  if (mirrorVersion === null) {
    return [
      `${mirror} NÃO define BUN_VERSION — adicione '${linha}' em sincronia com a repository variable (vars.BUN_VERSION='${expected}'); ${consequencia}`,
    ]
  }
  if (mirrorVersion !== expected) {
    return [
      `${mirror} define BUN_VERSION='${mirrorVersion}' mas a repository variable do GitHub é vars.BUN_VERSION='${expected}'. Consequência: ${consequencia}. (O guard estático check-bun-mirror só valida a EXISTÊNCIA da linha, não o valor.)`,
    ]
  }
  return []
}

/**
 * Compara o valor do .actrc (espelho local do act) com o valor REAL da
 * repository variable. Retorna a lista de avisos (vazia = em sincronia).
 *
 * @param {string|null} actrcVersion  valor do .actrc (null = não definido)
 * @param {string} expected           valor da repository variable (--expected)
 * @returns {string[]}
 */
export function actrcSyncWarnings(actrcVersion, expected) {
  return driftWarnings(
    ".actrc",
    "--var BUN_VERSION=<versão>",
    "atualize o .actrc (Settings → Secrets and variables → Actions é a fonte; o act local lê o espelho, não a variável)",
    actrcVersion,
    expected,
  )
}

/**
 * Compara o valor do espelho do RUNNER da forja (deploy/env.gitea.example, e o
 * deploy/.env.gitea que dele deriva no VPS) com a repository variable.
 *
 * É o irmão do aviso do .actrc: ele governa a imagem que roda TODOS os jobs da
 * forja, então divergir não quebra o CI — deixa-o lento. O setup-bun funciona
 * igual com ou sem Bun pré-instalado; o que muda é o fast path (tier-1, 0s)
 * engajar ou não.
 *
 * @param {string|null} envVersion  valor do env (null = não definido)
 * @param {string} expected         valor da repository variable (--expected)
 * @param {string} [mirror]         rótulo do arquivo lido (default: o do repo)
 * @param {boolean} [deployed]      é o arquivo do HOST (não o template comitado)?
 * @returns {string[]}
 */
export function envMirrorSyncWarnings(
  envVersion,
  expected,
  mirror = GITEA_ENV_MIRROR,
  deployed = false,
) {
  const custo =
    "a label do runner aponta para uma imagem que embarca OUTRA versão do Bun, e o fast path de 0s do tier-1 desliga em silêncio (todo job da forja volta a pagar o download)"
  // O arquivo do HOST merece um remédio diferente: mexer no template comitado
  // não conserta a máquina que já está rodando. Quem tem de mudar é o arquivo
  // que o compose lê. Sugerir o arquivo errado é um aviso que ninguém consegue
  // seguir.
  const remedio = deployed
    ? `atualize ${mirror} (o arquivo que o compose lê) e suba o runner de novo com 'bash deploy/gitea-up.sh' — ${custo}`
    : `atualize ${mirror} — ${custo}`
  return driftWarnings(mirror, "BUN_VERSION=<versão>", remedio, envVersion, expected)
}

/**
 * O DIAGNÓSTICO inteiro num objeto: quais espelhos foram comparados (com o
 * valor de cada um) e TODOS os avisos de drift.
 *
 * É a fonte única das DUAS metades do guard periódico:
 *   - o CLI (abaixo) imprime os avisos e decide o exit code;
 *   - o `actrc-sync-issue.mjs` transforma O MESMO diagnóstico em issue
 *     acionável no lado GitHub.
 *
 * Por que a extração: com a lógica duplicada, os dois divergiriam justamente no
 * dia do drift — a issue diria uma coisa e o log outra, e um dos dois estaria
 * errado sem que nenhum teste percebesse.
 *
 * @param {{cwd?: string, expected: string, actrcPath?: string, envPath?: string|null}} options
 * @returns {{expected: string, actrcVersion: string|null, mirrors: {label: string, deployed: boolean, version: string|null}[], warnings: string[]}}
 */
export function mirrorDriftReport({
  cwd = process.cwd(),
  expected,
  actrcPath = join(cwd, ".actrc"),
  envPath = null,
} = {}) {
  const actrcVersion = existsSync(actrcPath)
    ? extractActrcBunVersion(readFileSync(actrcPath, "utf8"))
    : null

  // Variável AUSENTE no repositório (ex.: `${{ vars.BUN_VERSION }}` vazio —
  // GitHub renderiza expressão não definida como string vazia). NÃO é erro de
  // uso do script — é drift de config do repositório (a variável nem existe).
  // É o caso mais GRAVE do mesmo drift, e por isso entra como aviso em vez de
  // saída silenciosa: o repo histórico rodou sem a variável criada.
  if (!expected) {
    return {
      expected,
      actrcVersion,
      mirrors: [],
      warnings: [
        "repository variable vars.BUN_VERSION NÃO configurada no repositório (Settings → Secrets and variables → Actions) — o setup-bun falharia em runtime e o runner da forja rodaria a versão que estiver na imagem; crie a variável e mantenha os DOIS espelhos (.actrc e deploy/env.gitea.example) em sincronia com ela",
      ],
    }
  }

  const warnings = [...actrcSyncWarnings(actrcVersion, expected)]

  // Espelhos do runner da forja: o template comitado E os arquivos do host
  // presentes no workspace (o `deploy/.env.gitea` do VPS é um deles). Cada um é
  // comparado e NOMEADO — um aviso que não diz QUAL arquivo drifta não é
  // acionável. `--gitea-env <caminho>` aponta um arquivo do HOST (o compose lê
  // ESSE arquivo); só o caminho exato do template comitado é tratado como
  // template.
  const candidates = envPath
    ? [{ path: envPath, label: envPath, deployed: !envPath.endsWith(GITEA_ENV_MIRROR) }]
    : discoverEnvMirrors(cwd)

  const mirrors = []
  for (const mirror of candidates) {
    const version = extractEnvMirrorBunVersion(readFileSync(mirror.path, "utf8"))
    warnings.push(...envMirrorSyncWarnings(version, expected, mirror.label, mirror.deployed))
    mirrors.push({ label: mirror.label, deployed: mirror.deployed, version })
  }

  return { expected, actrcVersion, mirrors, warnings }
}

// ── modo CLI (consumido pelo benchmark-weekly.yml) ─────────────────────────
// Só executa quando invocado diretamente (não quando importado pelo teste).
const isMain = !!process.argv[1] && process.argv[1].split(/[\\/]/).pop() === "check-actrc-sync.mjs"

if (isMain) {
  const args = process.argv.slice(2)
  let expected = ""
  let actrcPath = join(process.cwd(), ".actrc")
  // `--gitea-env` SOBRESCREVE a descoberta (um arquivo específico, ex.: o
  // /opt/gitea/.env do host). Sem a flag, o guard usa o template comitado MAIS
  // os arquivos do host que existirem no workspace.
  let envPath = null
  let failMode = false

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--expected") expected = args[i + 1] || ""
    if (args[i] === "--actrc") actrcPath = args[i + 1] || actrcPath
    if (args[i] === "--gitea-env") envPath = args[i + 1] || envPath
    if (args[i] === "--fail") failMode = true
  }

  if (args.indexOf("--expected") === -1) {
    console.error("check-actrc-sync: uso inválido — falta --expected <versão>")
    console.error(
      "  Uso: node scripts/check-actrc-sync.mjs --expected <versão> [--fail] [--actrc <path>] [--gitea-env <path>]",
    )
    process.exit(2)
  }
  if (!existsSync(actrcPath)) {
    console.error(`check-actrc-sync: .actrc não encontrado: ${actrcPath}`)
    process.exit(2)
  }
  // `--gitea-env` é uma pergunta EXPLÍCITA ("compare ESTE arquivo"). Um arquivo
  // ausente aqui NÃO é o mesmo caso dos espelhos descobertos (nesses, ausência
  // de arquivo não é drift): é uma checagem que o operador pediu e não
  // aconteceu — e uma checagem que não acontece sem avisar é pior que nenhuma.
  if (envPath && !existsSync(envPath)) {
    console.error(`check-actrc-sync: --gitea-env aponta para um arquivo inexistente: ${envPath}`)
    console.error(
      "  (nos espelhos DESCOBERTOS a ausência é ignorada; aqui você pediu este arquivo especificamente)",
    )
    process.exit(2)
  }

  const report = mirrorDriftReport({ expected, actrcPath, envPath })

  // Nem o template nem nenhum arquivo do host no workspace: a comparação de
  // env não aconteceu, e o relatório diz isso em vez de sugerir cobertura que
  // não existiu.
  const checkedLabels = report.mirrors.map((m) => m.label)
  if (checkedLabels.length === 0 && expected) {
    checkedLabels.push(`${GITEA_ENV_MIRROR} — ausente, ignorado`)
  }

  if (report.warnings.length === 0) {
    console.log(
      `check-actrc-sync: ✅ espelhos da variável em sincronia com vars.BUN_VERSION='${expected}' (${[
        ".actrc",
        ...checkedLabels,
      ].join(" + ")}).`,
    )
    process.exit(0)
  }

  // Aviso NÃO-bloqueante (modo padrão): o job semanal sinaliza o drift sem
  // quebrar o CI — nenhum dos dois espelhos governa corretude de CI (um é a dev
  // experience local do act, o outro é a velocidade do runner da forja). NO
  // GITHUB o alerta acionável é a ISSUE publicada por `actrc-sync-issue.mjs`
  // com ESTE mesmo diagnóstico (a anotação dentro de um run verde não é lida
  // por ninguém — ver docs/GUARDS.md §2).
  //
  // No modo `--fail` (a forja, que NÃO tem canal de issue) o mesmo diagnóstico
  // vira exit 1: lá o único canal visível é o status do run.
  for (const w of report.warnings) {
    console.log(`::warning::check-actrc-sync: ${w}`)
  }
  process.exit(failMode ? 1 : 0)
}
