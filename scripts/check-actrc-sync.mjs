#!/usr/bin/env node

// =============================================================================
// check-actrc-sync.mjs
//
// Guard PERIÓDICO (semanal) dos ESPELHOS das variáveis que o compose da forja
// consome: o `.actrc` (espelho local do act) e os arquivos de env da forja
// (`deploy/env.gitea.example`, o template comitado, e o `deploy/.env.gitea` do
// HOST, que é o que o compose lê de verdade).
//
// DUAS PERGUNTAS, UMA RÉGUA POR VARIÁVEL. O guard estático
// (`scripts/check-bun-mirror.mjs`, `scripts/check-registry-source.mjs`) valida a
// EXISTÊNCIA: que cada espelho DEFINE a variável (a linha `--var BUN_VERSION=`,
// a flag `--var IMAGE_REGISTRY=`, o template declarando o NOME). O VALOR não é
// verificável estaticamente — a repository variable só existe em runtime (no
// Actions, na forja) — e é este script que o compara, para TODAS as variáveis
// que o compose consome: `BUN_VERSION`, `IMAGE_REGISTRY` e `IMAGE_NAMESPACE`.
// O job semanal `actrc-sync` do benchmark-weekly.yml passa os valores reais via
// `--expected` (o atalho de `BUN_VERSION`) e `--expected-var NOME=VALOR`.
//
// DUAS PERGUNTAS, UMA RÉGUA POR VARIÁVEL. O guard estático
// (`scripts/check-bun-mirror.mjs`, `scripts/check-registry-source.mjs`) valida a
// EXISTÊNCIA: que cada espelho DEFINE a variável (a linha `--var BUN_VERSION=`,
// a flag `--var IMAGE_REGISTRY=`, o template declarando o NOME). O VALOR não é
// verificável estaticamente — a repository variable só existe em runtime (no
// Actions, na forja) — e é este script que o compara, para TODAS as variáveis
// que o compose consome: `BUN_VERSION`, `IMAGE_REGISTRY` e `IMAGE_NAMESPACE`.
// O job semanal `actrc-sync` do benchmark-weekly.yml passa os valores reais via
// `--expected` (o atalho de `BUN_VERSION`) e `--expected-var NOME=VALOR`.
//
// POR QUE TODAS (e não só a versão): até esta extensão, `IMAGE_REGISTRY` e
// `IMAGE_NAMESPACE` ficavam com a checagem de existência do guard estático — um
// valor trocado (registry ou namespace) passava por tudo em silêncio.
//   - `.actrc` — o act local não lê as variables do repositório sem `--var`
//     (ver header do .actrc): trocar a variável no GitHub e esquecer o espelho
//     faz o act local testar outro caminho (versão DIFERENTE, registry
//     DIFERENTE) do que a produção usa.
//   - env da forja — é ele que alimenta GITEA_RUNNER_LABELS (a imagem que roda
//     os jobs da forja). Divergir NÃO quebra nada visível: o setup-bun funciona
//     igual com ou sem Bun pré-instalado, e o pull da imagem só falha quando um
//     job tenta iniciar — então o runner roda a versão/registry errados e o
//     fast path de 0s do tier-1 desliga em silêncio (todo job passa a pagar o
//     download).
//
// O SEGREDO FICA FORA, e a exclusão é DECLARADA (`SECRET_MIRROR_VARIABLES`):
// `RUNNER_TOKEN` no template é um placeholder e no host é o token real —
// comparar valor exigiria versioná-lo. Presença e diferença do template são do
// `check-env-mirror.mjs` (a assimetria dos segredos da invariante 7b), no
// bring-up. Um teste compara o conjunto comparado com o do compose, para nenhum
// nome novo ficar de fora em silêncio.
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
//   0 — os espelhos em sincronia com os valores passados; OU divergência/
//       variável ausente reportada como ::warning:: sem falhar (modo aviso — o
//       job semanal não quebra; a ausência da variável é drift de config, não
//       bug de CI)
//   1 — (modo --fail) divergência OU variável ausente — para validação
//       local/CI estrito (a ausência é o drift mais grave)
//   2 — uso inválido (--expected ausente / .actrc ilegível / NOME desconhecido
//       ou valor conflitante em --expected-var)
//
// Usage:
//   node scripts/check-actrc-sync.mjs --expected 1.3.14 \
//     --expected-var IMAGE_REGISTRY=git.severinno.cloud --expected-var IMAGE_NAMESPACE=severinno
//   node scripts/check-actrc-sync.mjs --expected "${{ vars.BUN_VERSION }}" --fail
//   node scripts/check-actrc-sync.mjs --expected 1.3.14 --actrc /tmp/.actrc
//   node scripts/check-actrc-sync.mjs --expected 1.3.14 --gitea-env /tmp/env.gitea
//   node scripts/check-actrc-sync.mjs --expected 1.3.14 --json /tmp/report.json
//
// Escopo: lê o .actrc e os arquivos de env da forja. Os de env são DESCOBERTOS
// no workspace: o template comitado (deploy/env.gitea.example) sempre que
// existe, mais os arquivos do host (deploy/.env.gitea) — que é o que o compose
// lê de verdade no VPS. `--gitea-env <caminho>` substitui a descoberta para
// apontar um arquivo específico (ex.: /opt/gitea/.env). Um espelho AUSENTE é
// ignorado — a ausência do arquivo não é o drift que este guard caça (o
// estático é que exige a linha). Uma variável cujo valor NÃO foi passado não é
// comparada, e o script DIZ isso (nunca a apresenta como conferida). Node puro,
// sem deps, <1s.
// =============================================================================

import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs"
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
 * As variáveis que o compose da forja consome e cujo VALOR este guard compara
 * com a repository variable correspondente.
 *
 * POR QUE NÃO É UMA LISTA ESCRITA À MÃO: o conjunto é o dos nomes que o compose
 * consome (`COMPOSE_ENV_VARIABLES`, que o `check-registry-source.mjs` deriva das
 * referências `${NOME}` de `deploy/docker-compose.gitea.yml`) MENOS o segredo
 * (`SECRET_MIRROR_VARIABLES`) — e um teste compara os três arrays, de modo que
 * uma variável NOVA no compose FALHA o teste até alguém decidir como ela é
 * comparada. Sem esse contrato, a variável nova entraria apenas com a checagem
 * estática de existência, que é exatamente o buraco que esta extensão fecha.
 */
export const MIRROR_VARIABLES = ["BUN_VERSION", "IMAGE_REGISTRY", "IMAGE_NAMESPACE"]

/**
 * A variável que o compose consome e que NÃO entra na comparação de valor.
 *
 * `RUNNER_TOKEN` é SEGREDO: no template comitado o valor é um placeholder e no
 * host é o token real — comparar valor exigiria versionar o segredo (o oposto
 * do que se quer). Quem confere presença (não vazio) e diferença do template é
 * o `check-env-mirror.mjs` (a assimetria dos segredos da invariante 7b), no
 * bring-up. A exclusão é DECLARADA — e não um `continue` silencioso — porque é
 * ela que o teste de contrato usa para provar que nenhum nome do compose ficou
 * de fora.
 */
export const SECRET_MIRROR_VARIABLES = ["RUNNER_TOKEN"]

/**
 * A TERCEIRA classe do mesmo contrato — e por que ela NÃO é lida daqui.
 *
 * Um nome que o compose consome pode não ter repository variable com que
 * comparar: é o caso dos DEFAULTS DECLARADOS da stack (`COMPOSE_VALUE_DEFAULTS`,
 * no `check-registry-source.mjs`), em que a régua é entre DOIS ARQUIVOS
 * VERSIONADOS — o default embutido do compose (`${NOME:-<valor>}`) e a linha do
 * template —, comparados POR VALOR pelo guard dono do par.
 *
 * A classe mora lá, e não aqui, porque é lá que o par e o PORQUÊ da igualdade
 * são declarados: uma segunda lista nesta guarda divergiria no primeiro dia. O
 * que este arquivo NÃO faz com esses nomes é compará-los com `--expected-var`:
 * não existe variável remota para eles — comparar aqui seria comparar o arquivo
 * com ele mesmo. Quem cobra a classificação completa é o teste de contrato, que
 * importa a tabela do dono e exige a união das TRÊS classes = o que o compose
 * consome (`check-actrc-sync.test.ts`, "os nomes do contrato").
 */

/**
 * O CUSTO do drift, por variável, no env da forja (o arquivo que o compose lê).
 *
 * Exportado porque o DOCTOR classifica o mesmo drift em BLOQUEIO e precisa do
 * MESMO texto: duas prosas para o mesmo defeito divergiriam no dia do drift.
 */
export const ENV_MIRROR_COSTS = {
  BUN_VERSION:
    "a label do runner aponta para uma imagem que embarca OUTRA versão do Bun, e o fast path de 0s do tier-1 desliga em silêncio (todo job da forja volta a pagar o download)",
  IMAGE_REGISTRY:
    "a label do runner aponta para uma imagem em OUTRO registry — o job puxa de um lugar que o repositório não declara (ou não a encontra lá), e trocar a variável deixa de ser o que roda",
  IMAGE_NAMESPACE:
    "a label do runner aponta para uma imagem em OUTRO namespace — o job puxa de um lugar que o repositório não declara (ou não a encontra lá), e trocar a variável deixa de ser o que roda",
}

/**
 * Onde cada variável é ESPELHADA, e como o drift dela se anuncia.
 *
 * A AUSÊNCIA de um tipo aqui NÃO é omissão: é a decisão escrita de que a
 * variável não vive naquele espelho. `IMAGE_NAMESPACE` não está no `.actrc`
 * porque os workflows a usam com fallback (`vars.IMAGE_NAMESPACE ||
 * github.repository_owner`) e o act local resolve pelo fallback — exigir a flag
 * ali seria pedir um espelho que o desenho não usa (e criar um aviso permanente
 * que o procedimento documentado não consegue silenciar).
 *
 * `consequence(label, deployed)` é o remédio + o custo: cada variável e cada
 * espelho falham de um jeito próprio, e um aviso só é acionável se disser QUAL
 * (sem isso os avisos virariam o mesmo texto genérico).
 * `staticGuard` nomeia o guard que checa APENAS a existência daquela variável —
 * a frase que diz ao leitor de onde vem o buraco que este guard fecha.
 *
 * E cada entrada carrega a DECISÃO DE RECORTE (`recorte`/`motivo`): o contrato
 * que o `check-mirror-coverage.mjs` MEDE. Aqui a ausência de regra no recorte tem o
 * mesmo desenho dos outros espelhos: quem compara o VALOR precisa do valor
 * declarado (a variável da forja), que não existe num commit — o que o commit
 * pode julgar é a EXISTÊNCIA da linha, e essa é da varredura global do guard
 * dono de cada arquivo. Estar escrito assim é o que torna a lacuna revisável.
 */
const SLICE_MOTIVO =
  "o recorte não compara o VALOR deste espelho: a régua do valor precisa do valor DECLARADO (a repository variable), que não existe num commit — o que o recorte poderia julgar é a EXISTÊNCIA da linha, e essa é da varredura global do guard dono do arquivo (`check-bun-mirror`/`check-registry-source`), que roda no PR."

export const MIRROR_VARIABLE_RULES = {
  BUN_VERSION: {
    actrc: {
      linha: "--var BUN_VERSION=<versão>",
      consequence: () =>
        "atualize o .actrc (Settings → Secrets and variables → Actions é a fonte; o act local lê o espelho, não a variável)",
      staticGuard:
        "O guard estático check-bun-mirror só valida a EXISTÊNCIA da linha, não o valor.",
      recorte: null,
      motivo: SLICE_MOTIVO,
    },
    env: {
      linha: "BUN_VERSION=<versão>",
      consequence: (label, deployed) =>
        envDriftRemedy(label, deployed) + ENV_MIRROR_COSTS.BUN_VERSION,
      staticGuard:
        "O guard estático check-bun-mirror só valida a EXISTÊNCIA da linha, não o valor.",
      recorte: null,
      motivo: SLICE_MOTIVO,
    },
  },
  IMAGE_REGISTRY: {
    actrc: {
      linha: "--var IMAGE_REGISTRY=<host>",
      consequence: () =>
        "atualize o .actrc (o act local resolveria o default do workflow e deixaria de provar o caminho DECLARADO do registry)",
      staticGuard:
        "O guard estático check-registry-source só exige a EXISTÊNCIA da flag (--var IMAGE_REGISTRY) e a declaração do nome no template — o valor nunca foi conferido.",
      recorte: null,
      motivo: SLICE_MOTIVO,
    },
    env: {
      linha: "IMAGE_REGISTRY=<host>",
      consequence: (label, deployed) =>
        envDriftRemedy(label, deployed) + ENV_MIRROR_COSTS.IMAGE_REGISTRY,
      staticGuard:
        "O guard estático check-registry-source só exige a EXISTÊNCIA da flag (--var IMAGE_REGISTRY) e a declaração do nome no template — o valor nunca foi conferido.",
      recorte: null,
      motivo: SLICE_MOTIVO,
    },
  },
  IMAGE_NAMESPACE: {
    env: {
      linha: "IMAGE_NAMESPACE=<namespace>",
      consequence: (label, deployed) =>
        envDriftRemedy(label, deployed) + ENV_MIRROR_COSTS.IMAGE_NAMESPACE,
      staticGuard:
        "O guard estático check-registry-source só exige a DECLARAÇÃO do nome no template (a variável não é espelhada no .actrc) — o valor nunca foi conferido.",
      recorte: null,
      motivo: SLICE_MOTIVO,
    },
  },
}

/**
 * O remédio do drift de uma variável no env da forja — e o arquivo do HOST pede
 * outro: mexer no template comitado não conserta a máquina que já está
 * rodando. Sugerir o arquivo errado é um aviso que ninguém consegue seguir.
 */
function envDriftRemedy(label, deployed) {
  return deployed
    ? `atualize ${label} (o arquivo que o compose lê) e suba o runner de novo com 'bash deploy/gitea-up.sh' — `
    : `atualize ${label} — `
}

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
 * Extrai o valor de UMA variavel de um `.actrc` (ex.: `--var BUN_VERSION=1.3.14`
 * → '1.3.14'). Tolera aspas e descarta comentário inline. Retorna null se o
 * .actrc não definir a variável.
 *
 * A regex é ANCOORADA ao início da linha e linhas de comentário (`#`) são
 * descartadas ANTES do match — um comentário como `# --var BUN_VERSION=2.0`
 * NÃO pode gerar falso divergência (o primeiro match ganharia e extrairia o
 * valor errado).
 *
 * O nome é validado antes de virar regex: os nomes comparados são fixos
 * (`MIRROR_VARIABLES`), e a validação é a segunda linha de defesa (nenhum
 * metacaractere, nenhuma regex montada de entrada de CLI).
 *
 * @param {string} content  conteúdo do .actrc
 * @param {string} name     a variável (ex.: 'BUN_VERSION')
 * @returns {string|null}
 */
export function extractActrcVar(content, name) {
  if (!/^[A-Z_][A-Z0-9_]*$/.test(name)) return null
  const re = new RegExp(`^--var\\s+${name}\\s*=\\s*"?([^"\\s#]+)"?`)
  for (const line of String(content ?? "").split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed === "" || trimmed.startsWith("#")) continue
    const m = trimmed.match(re)
    if (m) return m[1]
  }
  return null
}

/** O atalho do BUN_VERSION (o `.actrc` espelha as variáveis da imagem). */
export function extractActrcBunVersion(content) {
  return extractActrcVar(content, "BUN_VERSION")
}

/**
 * Extrai o valor de UMA variável de um arquivo de env da forja (o espelho do
 * runner — `deploy/env.gitea.example` e, no VPS, o `deploy/.env.gitea` que dele
 * deriva). Formato shell: `BUN_VERSION=1.3.14`, opcionalmente com `export `
 * e/ou aspas. Retorna null se o arquivo não definir a variável.
 *
 * Mesma defesa do .actrc: linha ancorada + comentários descartados ANTES do
 * match — o arquivo é quase todo prosa, e um comentário do tipo
 * `# BUN_VERSION=1.4.0` [divergente] (exemplo desatualizado no header) não pode gerar falso
 * drift pegando o valor errado.
 *
 * @param {string} content  conteúdo do arquivo de env
 * @param {string} name     a variável (ex.: 'IMAGE_NAMESPACE')
 * @returns {string|null}
 */
export function extractEnvVar(content, name) {
  if (!/^[A-Z_][A-Z0-9_]*$/.test(name)) return null
  const re = new RegExp(`^(?:export\\s+)?${name}\\s*=\\s*"?([^"\\s#]+)"?`)
  for (const line of String(content ?? "").split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed === "" || trimmed.startsWith("#")) continue
    const m = trimmed.match(re)
    // Aspas simples em volta do valor são toleradas (a comparação de VALOR não
    // pode acusar drift por causa do estilo de aspas — agora que três variáveis
    // dependem desta leitura, um `'ghcr.io'` lido cru viraria violação falsa).
    if (m) return m[1].replace(/^'+|'+$/g, "")
  }
  return null
}

/** O atalho do BUN_VERSION (nome histórico, mantido para os dois chamadores). */
export function extractEnvMirrorBunVersion(content) {
  return extractEnvVar(content, "BUN_VERSION")
}

/**
 * Os valores de TODAS as variáveis comparadas num espelho.
 *
 * Lê sempre o conjunto inteiro (e não só as variáveis com valor passado): o
 * relatório imprime o que CADA espelho declara, mesmo para uma variável que
 * nesta run não foi comparada — é assim que a issue e o doctor mostram o estado
 * do arquivo em vez de só o veredito.
 *
 * @param {string} content
 * @param {"actrc"|"env"} kind
 * @returns {Record<string, string|null>}
 */
export function readMirrorVariableValues(content, kind) {
  const extract = kind === "actrc" ? extractActrcVar : extractEnvVar
  const out = {}
  for (const name of MIRROR_VARIABLES) out[name] = extract(content, name)
  return out
}

/**
 * O aviso de drift de UMA variável em UM espelho — a fonte ÚNICA dos dois lados
 * (o log do CLI e o corpo da issue saem daqui).
 *
 * `expected` ausente/null = NÃO PERGUNTADO (não há régua): nada é comparado nem
 * avisado — o chamador DECLARA o que ficou de fora (`unproven`), em vez de
 * fingir cobertura. `expected` vazio (`""`) = a repository variable não existe:
 * o aviso próprio disso é o de `notConfiguredWarning`, e repeti-lo por espelho
 * transformaria um problema em N.
 *
 * A ausência da REGRA (`MIRROR_VARIABLE_RULES[name][kind]`) é a decisão escrita
 * de que a variável não vive naquele espelho — e não um caminho esquecido.
 *
 * @param {{name: string, kind: "actrc"|"env", label: string, deployed?: boolean, value: string|null, expected: string|null|undefined}} args
 * @returns {string[]}
 */
function variableDriftWarnings({ name, kind, label, deployed = false, value, expected }) {
  const rule = MIRROR_VARIABLE_RULES[name]?.[kind]
  if (!rule) return []
  if (expected === null || expected === undefined || expected === "") return []
  if (value === null || value === undefined) {
    return [
      `${label} NÃO define ${name} — adicione '${rule.linha}' em sincronia com a repository variable (vars.${name}='${expected}'); ${rule.consequence(label, deployed)}`,
    ]
  }
  if (value !== expected) {
    return [
      `${label} define ${name}='${value}' mas a repository variable do GitHub é vars.${name}='${expected}'. Consequência: ${rule.consequence(label, deployed)}. (${rule.staticGuard})`,
    ]
  }
  return []
}

/**
 * A repository variable que NÃO existe no repositório (o workflow resolve a
 * expressão não definida como string vazia) é o caso mais GRAVE do drift, e
 * pede remédio próprio: não há "valor certo" para alinhar os espelhos — o que
 * falta é CRIAR a variável.
 *
 * @param {string} name
 * @returns {string}
 */
export function notConfiguredWarning(name) {
  if (name === "BUN_VERSION") {
    return "repository variable vars.BUN_VERSION NÃO configurada no repositório (Settings → Secrets and variables → Actions) — o setup-bun falharia em runtime e o runner da forja rodaria a versão que estiver na imagem; crie a variável e mantenha os DOIS espelhos (.actrc e deploy/env.gitea.example) em sincronia com ela"
  }
  return `repository variable vars.${name} NÃO configurada no repositório (Settings → Secrets and variables → Actions) — os workflows e a label do runner da forja cairiam no fallback escrito no YAML (intenção declarada, nunca valor); crie a variável com o valor que o repositório declara`
}

/**
 * O atalho histórico do BUN_VERSION no `.actrc` — mesma implementação do motor
 * (`variableDriftWarnings`): um segundo comparador divergiria no dia do drift.
 *
 * @param {string|null} actrcVersion  valor do .actrc (null = não definido)
 * @param {string} expected           valor da repository variable (--expected)
 * @returns {string[]}
 */
export function actrcSyncWarnings(actrcVersion, expected) {
  return variableDriftWarnings({
    name: "BUN_VERSION",
    kind: "actrc",
    label: ".actrc",
    value: actrcVersion,
    expected,
  })
}

/**
 * O atalho histórico do BUN_VERSION no env da forja.
 *
 * É o irmão do aviso do .actrc: ele governa a imagem que roda TODOS os jobs da
 * forja, então divergir não quebra o CI — deixa-o lento (e, no registry/
 * namespace errado, faz o job puxar de um lugar que o repositório não declara).
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
  return variableDriftWarnings({
    name: "BUN_VERSION",
    kind: "env",
    label: mirror,
    deployed,
    value: envVersion,
    expected,
  })
}

/**
 * A RÉGUA por variável: `--expected` é o atalho do BUN_VERSION (nome histórico)
 * e `--expected-var NOME=VALOR` traz as demais.
 *
 * `null` = NÃO PERGUNTADO (o chamador não passou valor: nada é comparado para
 * aquela variável), `""` = a repository variable não existe. Os dois são
 * estados DIFERENTES, e o guard não deixa um virar o outro em silêncio — o
 * primeiro é "não medi", o segundo é drift (a régua deveria existir e não
 * existe).
 *
 * @param {{expected?: string|null, expectedVars?: Record<string, string|null>}} [args]
 * @returns {Record<string, string|null>}
 */
export function normalizeExpectedVars({ expected = null, expectedVars = {} } = {}) {
  const wanted = {}
  for (const name of MIRROR_VARIABLES) wanted[name] = null
  if (expected !== null && expected !== undefined) wanted.BUN_VERSION = String(expected)
  for (const [name, value] of Object.entries(expectedVars ?? {})) {
    if (!MIRROR_VARIABLES.includes(name)) continue
    if (value === null || value === undefined) continue
    wanted[name] = String(value)
  }
  return wanted
}

/**
 * Uma divergência de VALOR: qual variável, em qual espelho, o valor lido e o
 * valor da repository variable (a régua).
 *
 * @typedef {object} MirrorDriftEntry
 * @property {string} name
 * @property {"actrc"|"env"} kind
 * @property {string} label
 * @property {boolean} deployed
 * @property {string|null} value
 * @property {string} expected
 */

/**
 * O DIAGNÓSTICO inteiro num objeto — o TIPO vive aqui porque os dois
 * consumidores (o CLI e o publicador de issue) leem o mesmo objeto: declarar a
 * forma duas vezes é como as duas prosas divergem.
 *
 * @typedef {object} MirrorDriftReport
 * @property {string|null} expected
 * @property {Record<string, string|null>} expectedVars
 * @property {string|null} actrcVersion
 * @property {Record<string, string|null>|null} actrcValues
 * @property {{label: string, deployed: boolean, values: Record<string, string|null>, version: string|null, drift: string[]}[]} mirrors
 * @property {MirrorDriftEntry[]} drift
 * @property {string[]} unproven
 * @property {string[]} warnings
 */

/**
 * O DIAGNÓSTICO inteiro num objeto: os valores de cada espelho, os avisos e o
 * que NÃO foi comparado.
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
 * `mirrors` fica VAZIO quando não há régua nenhuma (nenhum valor passado): nada
 * foi comparado, e uma lista de arquivos ali diria o contrário. `unproven`
 * nomeia exatamente as variáveis nessa situação — é o que torna "só existência"
 * impossível de esconder.
 *
 * @param {{cwd?: string, expected?: string|null, expectedVars?: Record<string, string|null>, actrcPath?: string, envPath?: string|null}} options
 * @returns {MirrorDriftReport}
 */
export function mirrorDriftReport({
  cwd = process.cwd(),
  expected = null,
  expectedVars = {},
  actrcPath = join(cwd, ".actrc"),
  envPath = null,
} = {}) {
  const wanted = normalizeExpectedVars({ expected, expectedVars })

  const actrcContent = existsSync(actrcPath) ? readFileSync(actrcPath, "utf8") : null
  const actrcVersion = actrcContent === null ? null : extractActrcBunVersion(actrcContent)
  const actrcValues = actrcContent === null ? null : readMirrorVariableValues(actrcContent, "actrc")

  const warnings = []
  // Variável AUSENTE no repositório (ex.: `${{ vars.BUN_VERSION }}` vazio —
  // GitHub renderiza expressão não definida como string vazia). NÃO é erro de
  // uso do script — é drift de config do repositório (a variável nem existe).
  // É o caso mais GRAVE do mesmo drift, e por isso entra como aviso (um por
  // variável ausente) em vez de saída silenciosa.
  for (const name of MIRROR_VARIABLES) {
    if (wanted[name] === "") warnings.push(notConfiguredWarning(name))
  }
  // Sem valor PERGUNTADO não há régua: a variável fica fora da comparação e o
  // relatório a NOMEIA — nunca a apresenta como conferida (é a diferença entre
  // "não medi" e "está certo", a mesma regra do resto do repositório).
  const unproven = MIRROR_VARIABLES.filter((name) => wanted[name] === null)

  const drift = []
  const collect = (args) => {
    const per = variableDriftWarnings(args)
    warnings.push(...per)
    if (per.length > 0) {
      drift.push({
        name: args.name,
        kind: args.kind,
        label: args.label,
        deployed: args.deployed ?? false,
        value: args.value ?? null,
        expected: args.expected,
      })
    }
  }

  if (actrcValues) {
    for (const name of MIRROR_VARIABLES) {
      collect({
        name,
        kind: "actrc",
        label: ".actrc",
        value: actrcValues[name],
        expected: wanted[name],
      })
    }
  }

  // Espelhos do runner da forja: o template comitado E os arquivos do host
  // presentes no workspace (o `deploy/.env.gitea` do VPS é um deles). Cada um é
  // comparado e NOMEADO — um aviso que não diz QUAL arquivo drifta não é
  // acionável. `--gitea-env <caminho>` aponta um arquivo do HOST (o compose lê
  // ESSE arquivo); só o caminho exato do template comitado é tratado como
  // template.
  const candidates = envPath
    ? [{ path: envPath, label: envPath, deployed: !envPath.endsWith(GITEA_ENV_MIRROR) }]
    : discoverEnvMirrors(cwd)

  const comparable = MIRROR_VARIABLES.some((name) => wanted[name] !== null && wanted[name] !== "")
  const mirrors = []
  for (const mirror of candidates) {
    const values = readMirrorVariableValues(readFileSync(mirror.path, "utf8"), "env")
    // Quais variáveis divergIRAM NESTE arquivo: o espelho carrega o seu próprio
    // veredito, e os dois consumidores (o doctor, que marca a linha, e o
    // publicador, que escolhe o remédio) não precisam recomparar valores para
    // descobrir — uma segunda comparação divergiria da primeira.
    const divergent = []
    for (const name of MIRROR_VARIABLES) {
      const before = warnings.length
      collect({
        name,
        kind: "env",
        label: mirror.label,
        deployed: mirror.deployed,
        value: values[name],
        expected: wanted[name],
      })
      if (warnings.length > before) divergent.push(name)
    }
    if (comparable) {
      mirrors.push({
        label: mirror.label,
        deployed: mirror.deployed,
        values,
        version: values.BUN_VERSION ?? null,
        drift: divergent,
      })
    }
  }

  return {
    expected,
    expectedVars: wanted,
    actrcVersion,
    actrcValues,
    mirrors,
    drift,
    unproven,
    warnings,
  }
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
  let jsonOutput = null
  const expectedVars = {}
  let usageError = null

  /**
   * O valor de `--expected-var NOME=VALOR`. Validação fail-closed: o nome tem de
   * ser uma variável COMPARADA (um typo viraria uma variável "comparada" que
   * nunca é lida de espelho nenhum — um verde falso), o BUN_VERSION não entra
   * aqui (tem flag própria, e duas formas de escrever o mesmo valor criariam uma
   * precedência silenciosa) e um valor iniciado por `--` é uma flag engolida,
   * não um valor (registry/namespace/versão nenhum começa com `--`).
   */
  const parseExpectedVar = (raw) => {
    const eq = raw.indexOf("=")
    if (eq <= 0) return `--expected-var exige NOME=VALOR (recebi '${raw}')`
    const name = raw.slice(0, eq)
    const value = raw.slice(eq + 1)
    if (!MIRROR_VARIABLES.includes(name)) {
      return `--expected-var: '${name}' nao e uma das variaveis comparadas (${MIRROR_VARIABLES.join(", ")})`
    }
    if (name === "BUN_VERSION") {
      return "--expected-var: BUN_VERSION entra por --expected (uma forma so de escrever o valor da versao)"
    }
    if (value.startsWith("--")) {
      return `--expected-var exige um valor, nao uma flag (recebi '${value}' para ${name})`
    }
    if (name in expectedVars && expectedVars[name] !== value) {
      return `--expected-var ${name} foi dado duas vezes com valores diferentes ('${expectedVars[name]}' e '${value}')`
    }
    expectedVars[name] = value
    return null
  }

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--expected") {
      expected = args[i + 1] ?? ""
      // Uma flag engolida como valor (`--expected --fail`) seria comparada como
      // se fosse uma versao — o espelho "divergiria de '--fail'` e a mensagem
      // mandaria o operador procurar um drift que nao existe.
      if (expected.startsWith("--")) {
        usageError = `--expected exige uma versao, nao uma flag (recebi '${expected}')`
      }
    }
    if (args[i] === "--expected-var") usageError ??= parseExpectedVar(args[i + 1] ?? "")
    if (args[i] === "--actrc") actrcPath = args[i + 1] || actrcPath
    if (args[i] === "--gitea-env") envPath = args[i + 1] || envPath
    if (args[i] === "--fail") failMode = true
    if (args[i] === "--json") jsonOutput = args[i + 1] || "/dev/stdout"
  }

  if (usageError) {
    console.error(`check-actrc-sync: ${usageError}`)
    console.error(
      "  Uso: node scripts/check-actrc-sync.mjs --expected <versão> [--expected-var NOME=VALOR]... [--fail] [--actrc <path>] [--gitea-env <path>] [--json]",
    )
    process.exit(2)
  }
  if (args.indexOf("--expected") === -1) {
    console.error("check-actrc-sync: uso inválido — falta --expected <versão>")
    console.error(
      "  Uso: node scripts/check-actrc-sync.mjs --expected <versão> [--expected-var NOME=VALOR]... [--fail] [--actrc <path>] [--gitea-env <path>] [--json]",
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

  const report = mirrorDriftReport({ expected, expectedVars, actrcPath, envPath })

  // Nem o template nem nenhum arquivo do host no workspace: a comparação de
  // env não aconteceu, e o relatório diz isso em vez de sugerir cobertura que
  // não existiu.
  const checkedLabels = report.mirrors.map((m) => m.label)
  if (checkedLabels.length === 0 && expected) {
    checkedLabels.push(`${GITEA_ENV_MIRROR} — ausente, ignorado`)
  }

  // O que NÃO foi comparado fica explícito — e fora do `::warning::` de
  // propósito: não passar um valor é "não medi", não divergência, e um aviso a
  // mais faria o leitor (e os testes) contarem como drift o que não é.
  if (report.unproven.length > 0) {
    console.log(
      `check-actrc-sync: · sem valor para comparar (${report.unproven.join(", ")}) — ` +
        report.unproven.map((n) => `--expected-var ${n}=<valor>`).join(" "),
    )
  }

  // ── JSON output (para automação / issue publisher) ──────────────────────
  if (jsonOutput) {
    const jsonReport = {
      ...report,
      hasDrift: report.warnings.length > 0,
      checkedLabels,
      exitCode: failMode && report.warnings.length > 0 ? 1 : 0,
    }
    try {
      if (jsonOutput !== "/dev/stdout") {
        const dir = jsonOutput.replace(/[/\\][^/\\]+$/, "")
        if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true })
        writeFileSync(jsonOutput, JSON.stringify(jsonReport, null, 2), "utf8")
        console.error(`check-actrc-sync: relatório JSON salvo em ${jsonOutput}`)
      } else {
        console.log(JSON.stringify(jsonReport, null, 2))
      }
    } catch (e) {
      console.error(`check-actrc-sync: falha ao salvar JSON: ${e.message}`)
    }
  }

  if (report.warnings.length === 0) {
    const compared = MIRROR_VARIABLES.filter(
      (n) => !report.unproven.includes(n) && report.expectedVars[n] !== "",
    )
    console.log(
      `check-actrc-sync: ✅ espelhos da variável em sincronia com vars.BUN_VERSION='${expected}' (${[
        ".actrc",
        ...checkedLabels,
      ].join(" + ")}).`,
    )
    if (compared.length > 0) {
      console.log(
        `check-actrc-sync: ${compared.length} variavel(is) com o VALOR conferido: ${compared.join(", ")}`,
      )
    }
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
