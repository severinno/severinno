#!/usr/bin/env node

// =============================================================================
// check-bun-mirror.mjs
//
// CI guard do mirror GHCR do Bun (.github/workflows/sync-bun-mirror.yml) +
// da FONTE ÚNICA da versão do Bun (repository variable BUN_VERSION).
//
// FONTE ÚNICA: a versão pinada do Bun vive na repository variable
// vars.BUN_VERSION (Settings → Secrets and variables → Actions). Todos os
// workflows passam a versão como ARGUMENTO do script do setup
// (`run: bash scripts/setup-bun-ci.sh "${{ vars.BUN_VERSION }}"`) e o
// sync-bun-mirror usa a mesma variável no env. Trocar o Bun = alterar a
// variável em UM lugar.
//
// HISTÓRICO: o setup foi um composite action local
// (`.github/actions/setup-bun`) e a versão entrava por input. Ele saiu para
// `scripts/setup-bun-ci.sh` — chamado por `run:`, que NÃO passa pelo
// resolvedor de actions locais do runner — e o contrato virou "a versão é o
// ARGUMENTO". As checagens abaixo foram retargetadas para o script junto com
// ele (nada de validador de YAML aplicado a shell: ver
// findBunLiteralDefaultInScript).
//
// Usage:
//   node scripts/check-bun-mirror.mjs                  # invariantes globais
//   node scripts/check-bun-mirror.mjs --staged         # git diff --cached (local/pre-commit)
//   node scripts/check-bun-mirror.mjs --staged --base origin/main   # diff do PR vs base (CI)
//
// Exit codes:
//   0 — invariantes ok (pass)
//   1 — pelo menos uma violação (fail)
//   2 — falha de infra (git diff indisponível)
//
// Este guard garante os invariantes:
//
//   1. O workflow do mirror EXISTE (sync-bun-mirror.yml).
//   2. env.BUN_VERSION do mirror referencia ${{ vars.BUN_VERSION }} (não um
//      literal — um literal criaria um segundo ponto de verdade).
//   3. O SCRIPT do setup (scripts/setup-bun-ci.sh) NÃO tem default literal de
//      versão — a versão entra SÓ pelo argumento (um default no script seria
//      o segundo ponto de verdade, e o `bun-v<semver>` da URL de download não
//      o pegaria).
//   4. O SCRIPT lê a versão do PRIMEIRO ARGUMENTO posicional (é o único
//      caminho pelo qual a versão entra na implementação).
//   5. O SCRIPT (tier 3, cold cache) referencia o mirror OCI
//      (<registry>/<owner>/bun:<versão>) — sem reverter para download direto.
//      (invariantes 3-5 valiam para o action.yml do composite removido; os
//      mesmos contratos recaem hoje sobre o script.)
//   6. O Dockerfile.bun-mirror existe (senão o mirror quebra no cron/CI).
//   7. Toda cache key bun-/prisma- nos workflows referencia
//      ${{ vars.BUN_VERSION }} (ex.: key: bun-${{ vars.BUN_VERSION }}-${{ hashFiles('bun.lock') }}).
//      Um literal (bun-1.3.14-...) é VIOLAÇÃO — a troca da variável não
//      invalidaria esse cache.
//
//      A lista de prefixos é CONFIGURÁVEL (DEFAULT_CACHE_KEY_RULES):
//      adicione { prefix, version, paths } para validar cache keys de
//      OUTRAS toolchains com o mesmo padrão — ex.: um futuro cache keyed em
//      'next-' entra como { prefix: "next", version: "15", paths: [".next"] },
//      forçando next-15-... na key E o path .next no bloco.
//   7b. TODO bloco actions/cache com key de toolchain configurada FECHA o
//      par key↔path (nas DUAS direções): o `path:` declarado precisa casar
//      com a toolchain da key (bun → node_modules / ~/.bun; prisma →
//      node_modules/.prisma + node_modules/@prisma/client), E o
//      `restore-keys:` também — um restore-keys com prefixo de OUTRA
//      toolchain configurada (ex.: key bun-... + restore-keys prisma-...)
//      buscaria o cache da toolchain errada. Um path de OUTRA toolchain
//      (ex.: node_modules/.prisma com key bun-...) ou um path desconhecido é
//      VIOLAÇÃO — a key sem o path certo quebraria o cache (restore de
//      toolchain errada). No modo --staged, a REMOÇÃO do path:/key: de um
//      bloco actions/cache que SOBREVIVE no novo arquivo é violação de
//      regressão (checkStagedRemovedCacheBlockFields) — espelha o
//      checkStagedRemovedSetupBunCall: remover o path/key deixa o bloco sem o
//      par key↔path, quebrando o cache no restore.
//   8. NENHUM literal de versão do Bun nos workflows (bun-version: 1.3.14,
//      BUN_VERSION: "1.3.14", bun-1.3.14-...) — o guard caça versões
//      hardcoded para que a variável continue sendo a única fonte.
//   9. O .actrc local define BUN_VERSION (sem ele, o act local roda com
//      vars.BUN_VERSION vazia e o setup-bun falha em runtime).
//  10. (modo --staged) Cache keys, literais e CALL SITES do setup-bun
//      INTRODUZIDOS pelo diff em questão (git diff --cached local, ou PR
//      base...HEAD no CI) seguem a fonte única — uma key antiga
//      (bun-1.3.14-...), uma key de OUTRA toolchain configurada (ex.:
//      next-14-... se 'next' entrar no DEFAULT_CACHE_KEY_RULES) ou um call
//      site sem bun-version adicionado pelo próprio PR falha antes do merge,
//      mesmo que o working tree global já esteja certo. Só linhas ADICIONADAS
//      (+ no diff) são avaliadas — violações pré-existentes do base não
//      poluem o PR (a chamada pode estar CAPTURADA, em `$(...)`, ou com
//      `# nota` no fim — por isso o check extrai o ARGUMENTO, não o resto da
//      linha).
//      REGRESSÃO INVERSA (checkStagedRemovedLiterals): um literal REMOVIDO
//      pelo diff (linha `-` — o PR está migrando aquele literal para a fonte
//      única) com OUTRO literal SOBREVIVENTE na mesma região (janela
//      CACHE_BLOCK_WINDOW) é violação — a migração ficou incompleta: o PR
//      tocou a família de literais mas deixou um para trás. O checkStagedLiterals
//      (só linhas +) não pega um literal de CONTEXTO; este check espelha o
//      checkStagedRemovedCacheBlockFields para a família de literais.
//  11. TODO call site do setup passa a versão como argumento do SCRIPT
//      (`bash scripts/setup-bun-ci.sh "${{ vars.BUN_VERSION }}"`; omitir o
//      argumento ou usar literal é violação). No modo --staged, chamadas
//      introduzidas pelo diff são avaliadas — E a REMOÇÃO da chamada de um
//      job que SOBREVIVEU é violação de regressão
//      (checkStagedRemovedSetupBunCall): o job ficaria sem Bun.
//  12. Arquivos de workflow são escaneados nas DUAS extensões (.yml E .yaml)
//      — um workflow com extensão alternativa não escapa dos checks de
//      cache key/literal/call site/par key↔path (global E staged).
//  13. NENHUM Dockerfile do repo pinava versão LITERAL do Bun (bun@1.2,
//      FROM oven/bun:1, bun@1.3.14, bun-v1.3.14 na URL de download do
//      Dockerfile.ubuntu-bun) — a versão nos Dockerfiles só pode vir
//      do build-arg BUN_VERSION (mesmo padrão do Dockerfile.ubuntu-bun:
//      ARG BUN_VERSION + \${BUN_VERSION}; o workflow passa
//      --build-arg BUN_VERSION=${{ vars.BUN_VERSION }}). Um literal criaria
//      um segundo ponto de verdade quando a variável for trocada.
//      O checkDockerfileBunLine cobre as TRÊS formas: npm install -g bun@,
//      FROM oven/bun: e o curl bun-v<ver> (releases/download).
//  14. O repo usa APENAS bun.lock como lockfile — package-lock.json e
//      pnpm-lock.yaml (raiz e mini-services/*) são proibidos (a unificação
//      é travada: um `npm install` acidental regenera o npm lockfile e o
//      guard falha no PR).
//  15. NENHUM SCRIPT do repositório (`scripts/**` + os hooks do `.husky/**`)
//      carrega espelho LITERAL da versão do Bun nem da TAG da imagem do runner
//      — as duas formas que sobrevivem ao bump em silêncio, porque o script
//      continua FUNCIONANDO (só roda/mede outra versão):
//        a. a versão PREFIXADA pelo nome — `bun-1.3.14`, `bun@1.2.3`,
//           `bun-v1.3.14`, `oven/bun:1.3.14`, `<...>/ubuntu-bun:1.3.14`;
//        b. um semver COMPLETO (X.Y.Z) numa linha de CÓDIGO que fala do Bun
//           (`process.env.BUN_VERSION || "1.3.14"`, `ACTRC_BUN="${ACTRC_BUN:-1.3.14}"`,
//           `bunVersion = "1.3.14"`).
//      Linhas de COMENTÁRIO ficam de fora (é onde o comportamento aparece como
//      exemplo) e a SENTINELA fica de fora: um valor com sufixo não-numérico
//      (`9.9.9-sentinel`) não é uma AFIRMAÇÃO de versão — é o escape hatch
//      declarado para fixtures que precisam de um valor falso, a mesma
//      convenção do COMPOSE_SENTINELS do check-registry-source. Um literal que
//      não se pode derivar (uma fixture, por exemplo) usa sentinela; o que não
//      pode é um número que se parece com a versão da vez.
//      A varredura roda no modo global E no `--staged` (linhas ADICIONADAS): o
//      literal nasce numa EDIÇÃO, e é no commit que ele precisa ser barrado.
//  16. O MESMO para os COMPOSES (`docker-compose*.yml` da raiz e de `deploy/`),
//      onde o `BUN_VERSION` é um build arg/env: um valor LITERAL puro
//      (`BUN_VERSION: "1.4.0"`, sem `${...}`) é violação SEMPRE — não é
//      espelho, é um segundo valor, e nenhum bump o alcança; um default
//      (`${BUN_VERSION:-<x>}`) é violação quando DIVERGE do valor declarado nos
//      espelhos. O default é o que vale onde a variável não existe, então ele
//      não pode ser a única fonte do que roda (o mesmo raciocínio do
//      checkComposeImageDefaults do check-registry-source, aplicado à versão).
//      O DIAGNÓSTICO desta rodada (a auditoria que criou 15/16): três arquivos
//      tinham derivado — `docker-compose.hostinger.yml` (1.4.0) e
//      `docker-compose.staging.yml` (literal puro, em dois serviços) — enquanto
//      o repositório declara 1.3.14.
//
// Escopo: lê .github/workflows/sync-bun-mirror.yml + .github/actions/
// setup-bun/action.yml + Dockerfile.bun-mirror + os workflows de TODAS as
// forjas (scripts/forge-workflows.mjs)
// E *.yaml (cache keys + literais) + .actrc + Dockerfiles (Dockerfile,
// Dockerfile.worker, Dockerfile.ubuntu-bun, mini-services/realtime/Dockerfile)
// + os SCRIPTS e os COMPOSES (invariantes 15/16) + lockfiles estrangeiros.
// Node puro, sem deps, <1s.
// =============================================================================

import { readFileSync, existsSync, readdirSync } from "node:fs"

import { BUN_MIRRORS, mirrorListText, readMirrorValues } from "./bun-version.mjs"
import {
  FORGE_WORKFLOW_DIRS,
  codeLine,
  existingWorkflowDirs,
  exitOnUnjudgeable,
  isCommentLine,
  readWorkflowScan,
  workflowFileNames,
} from "./forge-workflows.mjs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { execFileSync } from "node:child_process"

/** Referência da repository variable — a FONTE ÚNICA da versão do Bun. */
export const BUN_VERSION_VAR = "${{ vars.BUN_VERSION }}"

/**
 * Script que SUBSTITUIU o composite action local como setup do Bun. É chamado
 * por `run:` — que NÃO passa pelo resolvedor de actions locais do runner — e
 * recebe a versão como ARGUMENTO (ver o header do próprio script).
 */
export const SETUP_BUN_SCRIPT = "scripts/setup-bun-ci.sh"

/**
 * Janela (em linhas) do bloco `with:` de um actions/cache — cobre o caso
 * multi-path (`path: |` + linhas indentadas) seguido de key/restore-keys.
 * Compartilhada entre o scan global (checkCachePaths) e o scan de diff
 * (checkStagedCachePaths), sem drift entre as duas janelas.
 */
export const CACHE_BLOCK_WINDOW = 14

/**
 * Contexto de linhas pedido ao `git diff` (flag -U) no modo --staged/--base.
 * O default do git é 3 linhas — INSUFICIENTE para os checks de REMOÇÃO com
 * janela (checkStagedRemovedLiterals, checkStagedRemovedCacheBlockFields,
 * checkStagedRemovedSetupBunCall): um literal/path/input SOBREVIVENTE a poucas
 * linhas de distância da mudança não apareceria no diff como contexto e o
 * check não o enxergaria (falso negativo — a migração incompleta passaria
 * despercebida). -U20 garante que QUALQUER linha dentro da janela
 * CACHE_BLOCK_WINDOW (14) ao redor de uma mudança esteja visível no diff,
 * tanto antes (sobreviventes que precedem a remoção) quanto depois.
 */
export const DIFF_CONTEXT = 20

/**
 * Regex de detecção da linha `uses: actions/cache` — casa AMBAS as formas
 * reais: o item de lista `- uses: actions/cache@v4` (padrão em todos os
 * workflows) e a forma aninhada `        uses: actions/cache@v4` (sem dash,
 * dentro de um step com name). Compartilhada entre o scan global
 * (checkCachePaths) e o scan de diff (checkStagedCachePaths), sem drift
 * entre as duas — um fix aqui vale para ambas.
 */
export const CACHE_USES_RE = /^\s*(?:-\s+)?uses:\s+actions\/cache/

/**
 * Regex de arquivo de workflow do GitHub Actions — casa AMBAS as extensões
 * válidas (.yml e .yaml). Compartilhada entre o scan global (checkCacheKeys,
 * checkCachePaths, checkNoLiteralBunVersion, checkSetupBunCallSites) e o
 * parser de diff (parseDiffLines) — um workflow com extensão alternativa
 * não escapa dos checks, e um fix aqui vale para todos os scans, sem drift.
 */
export const WORKFLOW_FILE_RE = /\.ya?ml$/

/** O predicado de "é um workflow" — o default do parser de diff. */
const isWorkflowPath = (path) => WORKFLOW_FILE_RE.test(path)

/**
 * Dockerfiles do repo que PINAM/instalam o Bun — todos escaneados por
 * versões LITERAIS (invariante 13). O Dockerfile.ubuntu-bun usa o padrão
 * correto (ARG BUN_VERSION + \${BUN_VERSION}); os demais são obrigados ao
 * mesmo padrão pelo guard. Se um Dockerfile NOVO pinar bun, ADICIONE-O aqui
 * (lista explícita — um Dockerfile fora da lista escaparia do check).
 */
export const DOCKERFILES = [
  "Dockerfile",
  "Dockerfile.worker",
  "Dockerfile.ubuntu-bun",
  "Dockerfile.bun-mirror",
  "mini-services/realtime/Dockerfile",
]

/**
 * Lockfiles ESTRANGEIROS proibidos — o repo usa APENAS bun.lock (fonte
 * única de deps). Se um lockfile npm/pnpm aparecer (ex.: `npm install`
 * acidental na raiz ou num mini-service), o guard falha (invariante 14).
 */
export const FOREIGN_LOCKFILES = [
  "package-lock.json",
  "pnpm-lock.yaml",
  "mini-services/realtime/package-lock.json",
  // pnpm-workspace.yaml NÃO é lockfile, mas é config pnpm — foi removido na
  // unificação em bun.lock; incluído aqui para o guard pegar a re-introdução
  // (um `pnpm install` acidental regenera o lockfile E o workspace config).
  "pnpm-workspace.yaml",
]

/**
 * Extrai o valor de uma env var no topo de um workflow (ex.: BUN_VERSION).
 * Retorna o valor cru (pode ser o literal "1.3.14" ou a referência
 * "${{ vars.BUN_VERSION }}").
 */
export function extractEnvVersion(content, name = "BUN_VERSION") {
  const m = content.match(new RegExp(`^\\s*${name}:\\s*["']?([^"'\\n]+)["']?`, "m"))
  if (!m) return null
  // Descarta comentário inline (ex.: `BUN_VERSION: ${{ vars.BUN_VERSION }} # nota`)
  return m[1].trim().replace(/\s*#.*$/, "")
}

/**
 * Versão LITERAL usada como DEFAULT no script do setup (ex.:
 * `VERSION="${1:-1.3.14}"` ou `VERSION=1.3.14`) — ou null.
 *
 * POR QUE: a versão entra pelo ARGUMENTO (a fonte única é resolvida no
 * workflow e chega por aqui). Um default literal no script é o mesmo segundo
 * ponto de verdade que o guard inteiro existe para impedir — só que num
 * artefato onde o `bun-v<semver>` (URL de download, visto por
 * findBunLiteralInScript) NÃO pega.
 *
 * HISTÓRICO (e o motivo desta função existir): a checagem era feita com
 * `extractActionDefault`, que procura a chave YAML `bun-version:` do antigo
 * composite action. Aplicada ao SCRIPT — que não tem YAML nenhum — ela
 * retornava null SEMPRE: o guard exibia a invariante "sem default literal",
 * com mensagem de violação e tudo, e nunca podia disparar. Checagem que não
 * PODE falhar é pior que checagem ausente: parece prova.
 */
export function findBunLiteralDefaultInScript(scriptContent) {
  // Comentários ficam de fora: é onde o comportamento aparece como exemplo. A
  // RÉGUA é a única do repositório (`codeLine`): comentário de LINHA e de FIM DE
  // LINHA fora — em shell, `#` precedido de espaço é comentário.
  //
  // O QUE MUDA NO VEREDITO: uma linha de código com `# ... 1.3.14` no fim
  // (`echo "${BUN_VERSION:-1.3.14}" # exemplo`) deixava o 1.3.14 do FIM DA LINHA
  // valer como default do script — prosa de fim de linha já era ignorada nos
  // guards de workflow, e este era o último lugar que a lia como código.
  const code = scriptContent
    .split(/\r?\n/)
    .map((line) => codeLine(line))
    .filter((line) => line.trim() !== "")
    .join("\n")
  const substitution = code.match(/\$\{1:-\s*["']?(\d+\.\d+\.\d+)/)
  if (substitution) return substitution[1]
  const assignment = code.match(/^\s*(?:BUN_)?VERSION\s*=\s*["']?(\d+\.\d+\.\d+)/m)
  return assignment ? assignment[1] : null
}

/* * O setup (o SCRIPT que substituiu o composite) referencia o mirror OCI no
 * tier 3? (<registry>/.../bun:<ver>)
 */
export function hasGhcrMirrorRef(actionContent) {
  // Tier 3 monta MIRROR="${IMAGE_REGISTRY:-ghcr.io}/${GHCR_OWNER}/bun:${BUN_VERSION}"
  // — o guard casa a construção do nome + o pull, não uma string hardcoded.
  //
  // O registry é configurável (repo variable IMAGE_REGISTRY), então o prefixo
  // aceito é 'ghcr.io' OU a expansão shell de IMAGE_REGISTRY. O que o guard
  // protege é a INVARIANTE: o tier 3 puxa o Bun do mirror, e nunca volta a
  // baixar o release direto (isso quebraria o objetivo do mirror).
  return (
    /(?:ghcr\.io|\$\{IMAGE_REGISTRY(?::-[^}]*)?\})\/\$\{GHCR_OWNER\}\/bun:\$\{BUN_VERSION\}/.test(
      actionContent,
    ) || /(?:ghcr\.io|\$\{IMAGE_REGISTRY(?::-[^}]*)?\})\/[^"']+\/bun:/m.test(actionContent)
  )
}

/**
 * O script lê a versão do PRIMEIRO argumento posicional? É o único caminho
 * pelo qual a versão entra no setup: a fonte única é resolvida no WORKFLOW e
 * chega por aqui. Sem isso, o script usaria outra versão ou falharia.
 */
export function hasScriptVersionArg(scriptContent) {
  return /\$\{1:-\}|\$1\b/.test(scriptContent)
}

/**
 * O script mantém o marcador do tier-1 ('Usando Bun pré-instalado: <versão>')?
 * É o literal que o guard periódico check:tier1-fastpath casa no log do act —
 * sem ele o guard não acha a evidência e fica CEGO para a regressão do fast
 * path. Este contrato entre o guard e a implementação é o que a função trava.
 */
export function hasPreinstalledMarker(scriptContent) {
  return scriptContent.includes("Usando Bun pré-instalado:")
}

/** Versão LITERAL do Bun dentro do script (ex.: bun-v<X.Y.Z>) — ou null. */
export function findBunLiteralInScript(scriptContent) {
  const m = scriptContent.match(/bun-v(\d+\.\d+\.\d+)/)
  return m ? m[1] : null
}

/** Compose da forja — onde os labels do runner apontam a imagem dos jobs. */
export const GITEA_COMPOSE = "deploy/docker-compose.gitea.yml"

/** Espelho da variável para o runner da forja (irmão do .actrc). */
export const GITEA_ENV_MIRROR = "deploy/env.gitea.example"

// Montados por código para não precisar de escape de '$' + '{' no fonte.
const DOLLAR = String.fromCharCode(36)
const BUN_VERSION_TAG = DOLLAR + "{BUN_VERSION"

/**
 * A forja roda os jobs numa imagem que EMBARCA o Bun na versão da variable?
 *
 * POR QUE (regressão silenciosa de performance): o tier-1 do setup é um
 * `command -v bun` + comparação de versão — ele só engaja se a IMAGEM DO
 * RUNNER já tiver o Bun. Com `node:20-bullseye` nos labels o tier-1 NUNCA
 * engajava e todo job pagava o tier 3 (download), sem nada acusar: o setup
 * funciona igual, só mais lento. Este guard prende a configuração ao desenho.
 *
 * A igualdade de VALOR entre o BUN_VERSION do runner e a repository variable
 * não é verificável estaticamente (a variável só existe em runtime no Gitea) —
 * quem a prova é o smoke da forja (Prova 3) e o guard periódico
 * check-actrc-sync.mjs. Aqui a invariante é a FORMA: a imagem é a custom, e a
 * tag vem da variável.
 *
 * @param {string} composeContent  conteúdo de GITEA_COMPOSE
 * @param {string} envContent      conteúdo de GITEA_ENV_MIRROR
 * @returns {string[]} violações (vazia = ok)
 */
export function checkGiteaRunnerImage(composeContent, envContent) {
  const violations = []
  const labels = composeContent.match(/GITEA_RUNNER_LABELS=.*$/m)?.[0] ?? ""

  if (!labels) {
    violations.push(
      `${GITEA_COMPOSE}: GITEA_RUNNER_LABELS ausente — sem o label, nenhum job encontra runner`,
    )
  } else {
    if (!labels.includes("ubuntu-bun:")) {
      violations.push(
        `${GITEA_COMPOSE}: GITEA_RUNNER_LABELS não aponta para a imagem ubuntu-bun — o tier-1 (0s) do setup-bun NUNCA engaja nesta forja e todo job paga o download do tier 3, em silêncio. Aponte o label para <registry>/<owner>/ubuntu-bun:<versão>.`,
      )
    }
    if (!labels.includes(BUN_VERSION_TAG)) {
      violations.push(
        `${GITEA_COMPOSE}: GITEA_RUNNER_LABELS sem a variável da versão — a TAG da imagem precisa vir dela (fonte única); uma tag literal não seria invalidada pela troca do Bun e criaria um segundo ponto de verdade.`,
      )
    }
  }

  if (!/^BUN_VERSION=/m.test(envContent)) {
    violations.push(
      `${GITEA_ENV_MIRROR}: BUN_VERSION não definido — é o espelho da variável para o runner da forja; sem ele o compose resolve a tag da imagem vazia e nenhum job inicia.`,
    )
  }

  return violations
}

/** O comando que sobe a stack da forja (garante a imagem antes do runner). */
export const GITEA_BRING_UP = "deploy/gitea-up.sh"

/** O instalador da forja — deve apontar para o bring-up, não subir o runner direto. */
export const GITEA_SETUP = "deploy/setup-gitea.sh"

/** O pré-requisito 0 do bring-up: o env do host espelha o template comitado. */
export const ENV_MIRROR_SCRIPT = "scripts/check-env-mirror.mjs"

/** O veredito de prontidão da forja — o terceiro pré-requisito da subida. */
export const FORGE_DOCTOR = "scripts/forge-doctor.mjs"

/**
 * A imagem do runner é PRÉ-REQUISITO da subida da stack?
 *
 * POR QUE (a falha mais cara da forja): o `depends_on` do compose ordena
 * containers, não o mundo externo. Se a tag da imagem não existir quando o
 * runner sobe, TODO job falha ao iniciar o container — e o erro aparece no
 * meio do job, longe da causa. O desenho é: deploy/gitea-up.sh GARANTE a
 * imagem (scripts/ensure-runner-image.mjs, que publica se faltar) e SÓ ENTÃO
 * sobe o runner. Este guard prende essa ORDEM e prende o instalador ao mesmo
 * caminho.
 *
 * A invariante é ESTRUTURAL (ordem das linhas que executam algo), não prosa:
 * só contam linhas de comando (linhas de comentário são ignoradas), para que
 * explicar a regra num comentário não a satisfaça.
 *
 * TRÊS PRÉ-REQUISITOS, nesta ordem (cada um foi acrescentado quando se
 * percebeu que a regra existia mas dependia de alguém lembrar de rodá-la: o
 * `check:registry-source` só rodava no CI, e o doctor — que responde a pergunta
 * inteira — só rodava por vontade própria):
 *
 *   0. o env do host ESPELHA o template comitado, via `check-env-mirror.mjs`
 *      com `--host` e `--template`, e com o `TEMPLATE_FILE` default apontando
 *      para o template COMITADO. A ordem importa: o ensure resolve
 *      BUN_VERSION do env, então conferir o espelho DEPOIS garantiria a imagem
 *      de um env que não é o do repositório;
 *   1. a imagem do runner existe no registry (`ensure-runner-image.mjs`);
 *   2. a PRONTIDÃO está provada (`forge-doctor.mjs`), lendo o MESMO env
 *      (`--gitea-env`) e com o doctor INTEIRO (sem flags --no-* que escondam
 *      fatos). A prova do bloqueio EXECUTA o bring-up, então a recursão é
 *      cortada pela DUBLAGEM que a prova faz do doctor — medida em cada caso
 *      (`expectDoctorStub`) e na cadeia completa, por execução. O guard
 *      `checkDoctorCycleCut` prende a dublagem (o que de fato sustenta o corte). O default de `DOCTOR_SCRIPT` precisa ser o do
 *      repositório, a checagem passa `--gitea-env "$ENV_FILE"`, e a ORDEM é
 *      contratual nos dois sentidos:
 *      DEPOIS da garantia da imagem (o doctor trata a tag ausente como
 *      violação, que é a condição que o passo 1 conserta — antes dele, o
 *      remédio ficaria travado pelo estado que cura) e ANTES de qualquer `up`
 *      (subir depois de um BLOQUEADA publicaria o estado que a checagem existe
 *      para recusar).
 *
 * O que NÃO é conferido aqui (e por quê): o tratamento dos exit codes do doctor
 * (0/1/2/>=3) é COMPORTAMENTO, provado por execução em
 * `src/lib/__tests__/gitea-bring-up.test.ts` — onde um doctor dublê devolve cada
 * código e o teste vê se a stack subiu ou não. Regex sobre `if/elif` provaria a
 * forma do texto, não a decisão.
 *
 * @param {string} bringUpContent  conteúdo de GITEA_BRING_UP ("" se ausente)
 * @param {string|undefined} setupContent  conteúdo de GITEA_SETUP
 * @returns {string[]} violações (vazia = ok)
 */
export function checkGiteaBringUp(bringUpContent, setupContent) {
  if (!bringUpContent) {
    return [
      `${GITEA_BRING_UP}: ausente — é o comando que garante a imagem do runner ANTES de subir a stack (ver deploy/GITEA.md § Runner)`,
    ]
  }

  const violations = []
  // Invocação REAL do mirror (não a menção num comentário) — mesmo desenho da
  // do ensure: `node ... MIRROR_SCRIPT` ou o caminho literal do script. A
  // regex pega a LINHA INTEIRA (`[^\n]*$`): `.*` pararia no nome da variável e
  // as flags (--host/--template) ficariam fora do texto conferido.
  const mirrorMatch = bringUpContent.match(
    /^\s*node\s+[^\n]*(?:MIRROR_SCRIPT|check-env-mirror\.mjs)[^\n]*$/m,
  )
  // Invocação REAL do ensure (não a menção num comentário): `node ... ENSURE_SCRIPT`
  // ou o caminho literal do script. `^\s*node` (sem `#`) descarta prosa.
  const ensureMatch = bringUpContent.match(
    /^\s*node\s+.*(?:ENSURE_SCRIPT|ensure-runner-image\.mjs)/m,
  )
  // Comando de subida do runner — `[^#\n]*` impede casar uma linha de comentário.
  const runnerMatch = bringUpContent.match(/^\s*[^#\n]*\bup\s+-d\s+runner\b/m)

  if (!mirrorMatch) {
    violations.push(
      `${GITEA_BRING_UP}: não invoca ${ENV_MIRROR_SCRIPT} — sem a conferência o env do host pode divergir do template comitado e a stack sobe interpolando outra coisa (imagem/versão/segredo), dependendo de alguém lembrar de rodar o check:registry-source.`,
    )
  } else {
    const invocation = mirrorMatch[0]
    if (!/--host\b/.test(invocation) || !/--template\b/.test(invocation)) {
      violations.push(
        `${GITEA_BRING_UP}: a conferência do espelho não passa --host E --template — sem --host a descoberta pode achar um arquivo que esta subida não usa, e sem --template não há "o que o repositório declara" a comparar.`,
      )
    }
  }
  // O default do template tem de ser o COMITADO (não um arquivo qualquer):
  // sobrescrever é teste, e um default que não é o do repositório faria a
  // comparação medir outra coisa em silêncio.
  if (!/^[^#\n]*TEMPLATE_FILE=.*env\.gitea\.example/m.test(bringUpContent)) {
    violations.push(
      `${GITEA_BRING_UP}: o default de TEMPLATE_FILE não aponta para ${GITEA_ENV_MIRROR} — a comparação mediria outro arquivo, e não "o que o repositório declara".`,
    )
  }
  if (!ensureMatch) {
    violations.push(
      `${GITEA_BRING_UP}: não invoca scripts/ensure-runner-image.mjs — sem a garantia, subir o runner depende de a tag já existir por sorte.`,
    )
  }
  // A ORDEM entre os dois pré-requisitos: o espelho PRIMEIRO. O ensure resolve
  // a imagem do env do host — com um env divergente ele garantiria a imagem
  // errada, e a stack subiria apontando para ela.
  if (mirrorMatch && ensureMatch && ensureMatch.index < mirrorMatch.index) {
    violations.push(
      `${GITEA_BRING_UP}: a conferência do espelho aparece DEPOIS da garantia da imagem — o ensure resolve BUN_VERSION/IMAGE_REGISTRY do env do host, então com um env divergente ele garante a imagem errada. Confira o espelho primeiro (${ENV_MIRROR_SCRIPT}).`,
    )
  }
  if (!runnerMatch) {
    violations.push(
      `${GITEA_BRING_UP}: não sobe o runner (esperado 'up -d runner' depois da garantia).`,
    )
  }
  if (ensureMatch && runnerMatch && runnerMatch.index < ensureMatch.index) {
    violations.push(
      `${GITEA_BRING_UP}: 'up -d runner' aparece ANTES da garantia da imagem — a stack subiria e os jobs falhariam ao iniciar o container. Garanta a imagem primeiro (scripts/ensure-runner-image.mjs).`,
    )
  }

  // ── 2. PRÉ-REQUISITO: a PRONTIDÃO (doctor) ────────────────────────────────
  // Invocação REAL do doctor (não a menção num comentário) — mesmo desenho das
  // outras duas: a linha inteira entra no texto conferido, para que as flags
  // exigidas abaixo sejam medidas no mesmo lugar em que o comando roda.
  const doctorMatch = bringUpContent.match(
    /^\s*node\s+[^\n]*(?:DOCTOR_SCRIPT|forge-doctor\.mjs)[^\n]*$/m,
  )
  const doctorInvocation = doctorMatch?.[0] ?? ""
  if (!doctorMatch) {
    violations.push(
      `${GITEA_BRING_UP}: não invoca ${FORGE_DOCTOR} — sem o veredito de prontidão a subida volta a depender de alguém lembrar de rodar o doctor, e a stack sobe num estado que pode não segurar o merge (branch protection furada, runner sem a imagem, espelho velho).`,
    )
  } else {
    if (!/--gitea-env\b/.test(doctorInvocation) || !/\$ENV_FILE/.test(doctorInvocation)) {
      violations.push(
        `${GITEA_BRING_UP}: o doctor não recebe --gitea-env "$ENV_FILE" — ele leria outro arquivo, e o veredito mediria um estado que esta subida não usa.`,
      )
    }
    // O doctor roda INTEIRO. O ciclo `bring-up → doctor → prova → bring-up` é
    // cortado pela DUBLAGEM que a prova faz do doctor — medida em cada caso da
    // prova (`expectDoctorStub`) e na cadeia completa, por execução, em
    // `src/lib/__tests__/prove-runner-image-gate.test.ts`. A flag --no-proof
    // foi removida: quem precisa de um recorte usa --ci (declaração explícita)
    // ou flags individuais (--no-guards, --no-protection, etc.).
    //
    // A regra FICA: uma flag REMOVIDA que volta ao bring-up é o mesmo defeito
    // por outro caminho — um texto antigo (runbook, cópia de outra máquina)
    // faria o veredito ficar parcial por construção; e, como a flag não existe
    // mais, o doctor a recusa em runtime e a subida morre por um comando
    // desatualizado. O remédio aponta o corte de verdade (a dublagem na prova).
    if (/--no-proof\b/.test(doctorInvocation)) {
      violations.push(
        `${GITEA_BRING_UP}: o doctor é invocado com --no-proof (flag REMOVIDA — o veredito ficaria parcial por construção, e o doctor a recusa em runtime). Rode o doctor INTEIRO: quem corta o ciclo bring-up → doctor → prova é a dublagem do doctor na prova (scripts/prove-runner-image-gate.mjs).`,
      )
    }
  }
  // O default tem de ser o doctor DO REPOSITÓRIO: sobrescrever é teste, e um
  // default que não é o do repositório faria a subida medir outra coisa.
  if (!/^[^#\n]*DOCTOR_SCRIPT=.*forge-doctor\.mjs/m.test(bringUpContent)) {
    violations.push(
      `${GITEA_BRING_UP}: o default de DOCTOR_SCRIPT não aponta para ${FORGE_DOCTOR} — a subida conferiria a prontidão com outro comando (ou com nenhum, na prática).`,
    )
  }
  // A ORDEM: depois da garantia da imagem (que é pré-requisito do que ele
  // prova) e antes de qualquer `up` — subir depois de um BLOQUEADA publicaria o
  // estado que a checagem recusa.
  if (doctorMatch && ensureMatch && doctorMatch.index < ensureMatch.index) {
    violations.push(
      `${GITEA_BRING_UP}: o doctor roda ANTES da garantia da imagem — a seção 1 (registry) ficaria por provar no momento do veredito, e o relatório diria BLOQUEADA/INDETERMINADA por um estado que esta própria subida ainda ia consertar.`,
    )
  }
  const composeUpMatch = bringUpContent.match(/^\s*[^#\n]*\bup\s+-d\s+gitea\b/m)
  if (doctorMatch && composeUpMatch && composeUpMatch.index < doctorMatch.index) {
    violations.push(
      `${GITEA_BRING_UP}: 'up -d gitea' aparece ANTES do veredito de prontidão — a stack subiria mesmo com o doctor dizendo BLOQUEADA.`,
    )
  }

  if (setupContent !== undefined && !setupContent.includes("gitea-up.sh")) {
    violations.push(
      `${GITEA_SETUP}: não aponta para ${GITEA_BRING_UP} — o instalador precisa levar o usuário pelo caminho que GARANTE a imagem, não por um 'docker compose up -d runner' seco.`,
    )
  }
  return violations
}

/** A prova do bloqueio — a que o doctor executa (seção 4) e que DUBLA o doctor. */
export const PROOF_SCRIPT = "scripts/prove-runner-image-gate.mjs"

/**
 * A DUBLAGEM do doctor na prova do bloqueio está de pé?
 *
 * POR QUE ISTO É UM GUARD DE TEXTO (e não só a prova de execução): o corte do
 * ciclo é UMA linha — `DOCTOR_SCRIPT` no env do filho que a prova monta — e,
 * com o bring-up rodando o doctor INTEIRO (o contrato de hoje), apagá-la faz a
 * cadeia
 *
 *     bring-up → doctor → prova → bring-up → doctor → prova → …
 *
 * não ter profundidade limite. Não é um erro que aparece num diff: é uma forca
 * de processos, e o sintoma chega tarde demais. A prova de execução mede o corte
 * a cada rodada; este guard existe para o caminho em que alguém apaga a linha
 * sem rodar a prova.
 *
 * @param {string} proofContent  conteúdo de PROOF_SCRIPT ("" se ausente)
 * @returns {string[]} violações (vazia = ok)
 */
export function checkDoctorCycleCut(proofContent) {
  if (!proofContent) {
    return [
      `${PROOF_SCRIPT}: ausente — é a prova que o doctor executa; sem ela não há o que dublar, e é a dublagem que torna o ciclo finito.`,
    ]
  }
  const violations = []
  // As DUAS metades do corte: o dublê tem de ser construído pela prova E
  // passado ao filho. Sem a primeira não há dublê; sem a segunda o bring-up
  // dublado cai no default (o doctor do repositório) e o ciclo volta a crescer.
  if (!/forge-doctor-stub\.mjs/.test(proofContent)) {
    violations.push(
      `${PROOF_SCRIPT}: não constrói o dublê do doctor ("forge-doctor-stub.mjs") — o bring-up que a prova executa chamaria o doctor REAL, que executa a própria prova, e a cadeia deixaria de ter profundidade limite.`,
    )
  }
  if (!/^\s*DOCTOR_SCRIPT:\s*\S+/m.test(proofContent)) {
    violations.push(
      `${PROOF_SCRIPT}: o env do FILHO não define DOCTOR_SCRIPT — é essa linha que aponta o bring-up dublado para o dublê. Sem ela o default do bring-up é o doctor do repositório, e o ciclo bring-up → doctor → prova não tem corte.`,
    )
  }
  // `DOCTOR_SCRIPT: ""` passaria a checagem acima sem apontar dublê NENHUM. Não
  // é o modo catastrófico (o bring-up falharia no `[ -f ]`), mas uma linha que
  // diz apontar e não aponta não pode passar por corte.
  if (/^\s*DOCTOR_SCRIPT:\s*["'`]\s*["'`]/m.test(proofContent)) {
    violations.push(
      `${PROOF_SCRIPT}: DOCTOR_SCRIPT aponta para uma string VAZIA no env do filho — sem dublê o ciclo bring-up → doctor → prova não tem corte.`,
    )
  }
  return violations
}

/** O runbook da forja — onde vive o procedimento de re-registro do runner. */
export const GITEA_DOC = "deploy/GITEA.md"

/**
 * O re-registro do runner é um caminho GARANTIDO (não uma sequência à mão)?
 *
 * POR QUE: o re-registro é o momento em que se TROCA a imagem do runner (label
 * ou `BUN_VERSION`), logo é quando a tag tem mais chance de não existir. O
 * act_runner guarda os labels que recebeu no registro em `/data/.runner` e
 * depois usa ESSES — então o procedimento precisa apagar container E volume, e
 * precisa passar pela garantia da imagem. Duas invariantes:
 *
 *   1. no SCRIPT: `rm -sf runner` antes de `up -d runner` (só apagar o
 *      container não basta para re-registrar; `restart` muito menos);
 *   2. no DOC: o bloco de re-registro tem de CHAMAR o script — um runbook que
 *      ensina a sequência crua faz o operador pular a garantia, e foi assim
 *      que a versão antiga ficou com um `--check` cujo exit code não decidia
 *      nada antes do `up -d runner`.
 *
 * A invariante 2 é textual e de propósito: o contrato une um .md e um .sh que
 * não se importam, então tem de ser lido das duas fontes. Linhas de comentário
 * são descartadas nas duas checagens — explicar a regra num comentário não
 * pode satisfazê-la.
 *
 * @param {string} bringUpContent  conteúdo de GITEA_BRING_UP ("" se ausente)
 * @param {string} docContent      conteúdo de GITEA_DOC ("" se ausente)
 * @returns {string[]} violações (vazia = ok)
 */
export function checkReRegisterPath(bringUpContent, docContent) {
  const violations = []
  // A MESMA régua do resto do guard (`codeLine`): comentário fora, inclusive
  // o de fim de linha — a prosa de um `#` no fim de uma linha de shell não é
  // codigo.
  const code = (s) =>
    s
      .split(/\r?\n/)
      .map((line) => codeLine(line))
      .filter((line) => line.trim() !== "")
      .join("\n")

  const bringsUp = /^\s*[^#\n]*\bup\s+-d\s+runner\b/m.test(bringUpContent)
  if (bringsUp && !/^\s*[^#\n]*\brm\s+-sf\s+runner\b/m.test(bringUpContent)) {
    violations.push(
      `${GITEA_BRING_UP}: sobe o runner mas nunca o remove ('rm -sf runner') — sem isso não existe caminho de re-registro, e trocar a label exigiria o procedimento à mão que pula a garantia da imagem`,
    )
  }
  // A ordem: remover ANTES de subir (subir e depois remover não re-registra).
  const rmIdx = bringUpContent.search(/^\s*[^#\n]*\brm\s+-sf\s+runner\b/m)
  const upIdx = bringUpContent.search(/^\s*[^#\n]*\bup\s+-d\s+runner\b/m)
  if (rmIdx >= 0 && upIdx >= 0 && rmIdx > upIdx) {
    violations.push(
      `${GITEA_BRING_UP}: 'rm -sf runner' aparece DEPOIS do 'up -d runner' — o container subiria com o registro antigo e os labels novos nunca seriam enviados`,
    )
  }

  if (!docContent) return violations // 2a. O runbook PRECISA mandar o operador pelo caminho garantido. Sem esta
  //     metade, um runbook que simplesmente não menciona o modo de re-registro
  //     passa calado — a instalação fica com um procedimento sem garantia.
  if (!/gitea-up\.sh\s+--re-register/.test(docContent)) {
    violations.push(
      `${GITEA_DOC}: o runbook não invoca '${GITEA_BRING_UP} --re-register' — o re-registro é justamente quando a tag tem mais chance de faltar (é a troca da versão/label), então ele não pode ficar sem a garantia`,
    )
  }

  // 2b. E não pode ENSINAR a alternativa: um cerco com `rm -sf runner` + um
  //     `docker compose ... up -d runner` cru é a sequência à mão. Estes dois
  //     juntos, num bloco, são o procedimento sem garantia — o operador copia o
  //     que executa, não a prosa em volta. A prosa pode (e deve) explicar por
  //     que a sequência antiga era errada; o que ela não pode é vir pronta para
  //     copiar.
  for (const fence of docContent.match(/```[a-z]*\n[\s\S]*?```/g) ?? []) {
    const handRolled =
      /rm\s+-sf\s+runner/.test(fence) &&
      /^\s*[^#\n]*\bdocker\s+compose\b[^#\n]*\bup\s+-d\s+runner\b/m.test(code(fence))
    if (handRolled) {
      violations.push(
        `${GITEA_DOC}: há um bloco que ensina o re-registro à mão ('rm -sf runner' + 'docker compose ... up -d runner') — isso sobe o runner sem passar pela garantia da imagem; o bloco tem de chamar ${GITEA_BRING_UP} --re-register`,
      )
    }
  }
  return violations
}

/** O script de bump — escreve a variável E os espelhos dela no working tree. */
export const BUN_BUMP_SCRIPT = "scripts/bump-bun.sh"

/** O guard SEMANAL — compara os VALORES dos espelhos com a variável remota. */
export const ACTRC_SYNC_SCRIPT = "scripts/check-actrc-sync.mjs"

/**
 * Todo espelho que o guard semanal COMPARA é escrito pelo script de bump?
 *
 * POR QUE (dois donos, um conjunto só): cada espelho da variável — `.actrc`
 * (o act local) e `deploy/env.gitea.example` (o runner da forja) — tem um
 * ESCRITOR (`bump-bun.sh`, no bump) e um LEITOR-VERIFICADOR
 * (`check-actrc-sync.mjs`, no job semanal). Os dois conjuntos têm de ser o
 * MESMO, e a assimetria silenciosa é o risco real:
 *   - leitor sem escritor → todo bump deixa um `::warning::` PERMANENTE. Um
 *     aviso que o procedimento documentado não consegue silenciar é como um
 *     aviso morre (o repo já tem esse diagnóstico no readme-reverse-issue);
 *   - escritor sem leitor → o valor escrito nunca é conferido, e divergir
 *     deixa de ter sintoma.
 *
 * A invariante é textual de propósito: ela liga DOIS arquivos que não se
 * importam (um é .sh, o outro .mjs), então o contrato tem de ser lido das
 * fontes. Cada espelho comparado precisa da DECLARAÇÃO
 * (`X_PATH="$REPO_ROOT/<espelho>"`) e da CHAMADA (`update_mirror "$X_PATH"`) —
 * uma declaração sem chamada seria um falso verde.
 *
 * @param {string} bumpContent  conteúdo de BUN_BUMP_SCRIPT ("" se ausente)
 * @param {string} syncContent  conteúdo de ACTRC_SYNC_SCRIPT ("" se ausente)
 * @returns {string[]} violações (vazia = ok)
 */
export function checkMirrorWriters(bumpContent, syncContent) {
  if (!bumpContent)
    return [`${BUN_BUMP_SCRIPT}: ausente — é ele que mantém os espelhos da variável no bump`]

  // 1. O conjunto COMPARADO, lido do próprio guard semanal.
  const compared = new Set()
  if (/join\(process\.cwd\(\), "\.actrc"\)/.test(syncContent)) compared.add(".actrc")
  const envConst = syncContent.match(/^export const GITEA_ENV_MIRROR = "([^"]+)"/m)
  if (envConst) compared.add(envConst[1])

  if (compared.size < 2) {
    return [
      `${ACTRC_SYNC_SCRIPT}: esperava comparar os DOIS espelhos da variável (.actrc e o env da forja), encontrei ${compared.size} — o espelho de fora divergiria sem nenhum aviso`,
    ]
  }

  // 2. Cada espelho comparado precisa de um ESCRITOR no bump.
  const declared = new Map() // espelho -> nome da variável no bump script
  for (const m of bumpContent.matchAll(/^(\w+)_PATH="\$REPO_ROOT\/([^"]+)"/gm)) {
    declared.set(m[2], `${m[1]}_PATH`)
  }

  const violations = []
  for (const mirror of compared) {
    const varName = declared.get(mirror)
    if (!varName) {
      violations.push(
        `${BUN_BUMP_SCRIPT}: não escreve o espelho '${mirror}', que ${ACTRC_SYNC_SCRIPT} compara — todo bump deixaria um ::warning:: permanente sem remédio no procedimento`,
      )
    } else if (!bumpContent.includes(`update_mirror "$${varName}"`)) {
      violations.push(
        `${BUN_BUMP_SCRIPT}: declara ${varName}='${mirror}' mas nunca chama update_mirror "$${varName}" — o espelho é comparado pelo guard semanal e o bump não o atualizaria`,
      )
    }
  }
  return violations
}

/**
 * Regras de cache key por toolchain: cada prefixo (ex.: bun, prisma) com a
 * versão que a key DEVE incluir E os paths que o bloco actions/cache DEVE
 * cachear (fecha o par key↔path). Para bun/prisma a "versão" é a REFERÊNCIA
 * da repository variable (${{ vars.BUN_VERSION }}) — um literal é violação.
 *
 * paths: caminhos que um bloco com key '<prefixo>-...' deve declarar em
 * `path:` (exata match após trim). Multi-path (`path: |`) é suportado — a
 * validação passa se PELO MENOS UM path da lista for um dos paths da regra.
 * A direção inversa também vale: um path que é de OUTRA toolchain com key de
 * outra é violação (ex.: path node_modules/.prisma com key bun-...).
 *
 * Lista CONFIGURÁVEL — para validar cache keys de outra toolchain, adicione
 * { prefix, version, paths } aqui (ex.: um futuro cache keyed em 'next-'
 * entraria como { prefix: "next", version: "15", paths: [".next"] }).
 *
 * @returns {{ prefix: string, version: string, paths: string[] }[]}
 */
export const DEFAULT_CACHE_KEY_RULES = () => [
  {
    prefix: "bun",
    version: BUN_VERSION_VAR,
    paths: ["node_modules", "~/.bun"],
  },
  {
    prefix: "prisma",
    version: BUN_VERSION_VAR,
    paths: ["node_modules/.prisma", "node_modules/@prisma/client"],
  },
]

/**
 * Varre .github/workflows/*.yml e falha se alguma cache key (key: ou
 * restore-keys:) com prefixo de uma toolchain CONFIGURADA (rules) não
 * incluir a versão daquela regra. Para bun/prisma a versão é a referência
 * `${{ vars.BUN_VERSION }}` — um literal (ex.: bun-1.3.14-) NÃO casa e é
 * reportado como violação (trocar a variável não invalidaria esse cache).
 *
 * @param {string} workflowsDir  diretório .github/workflows
 * @param {{ prefix: string, version: string }[]} rules  regras configuráveis
 * @returns {string[]} lista de violações (vazia = ok)
 */
/**
 * Checa UMA linha de cache key contra as regras. Retorna a violação como
 * string, ou null se a linha estiver correta. Função de NÍVEL DE LINHA
 * compartilhada entre o scan global (checkCacheKeys) e o scan de diff
 * (checkStagedCacheKeys) — uma única fonte da lógica, sem drift.
 *
 * @param {string} file     nome do arquivo (ex.: "pr-check.yml")
 * @param {number} lineNo   número da linha (1-based)
 * @param {string} content  conteúdo da linha
 * @param {{ prefix: string, version: string }[]} rules
 * @returns {string|null}
 */
export function checkCacheKeyLine(file, lineNo, content, rules) {
  if (rules.length === 0) return null

  // Escapa metacharacters de cada prefixo antes de montar a regex — o ponto
  // do design é ADICIONAR toolchains futuras, e nomes como 'next.js'/'bun.sh'
  // injetariam `.` como wildcard na regex (casaria keys erradas em silêncio).
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const prefixRe = rules.map((r) => escapeRe(r.prefix)).join("|")
  // `(.*)$` (não `(.+)`) — um `restore-keys: bun-` vazio também é violação
  const re = new RegExp(`^\\s*(key|restore-keys):\\s*(${prefixRe})-(.*)$`)

  const m = content.match(re)
  if (!m) return null
  const [, kind, prefixKind, rest] = m
  const rule = rules.find((r) => r.prefix === prefixKind)
  if (!rule) return null
  if (rest.startsWith(`${rule.version}-`)) return null
  // Mostra o token até o primeiro espaço, sem o resíduo '${{' (ex.:
  // '1.4.0-' em '1.4.0-${{ hashFiles(...) }}' ou vazio em
  // 'bun-${{ hashFiles(...) }}') — mensagem limpa no CI.
  const shown = rest.split(/\s/)[0].replace(/^\$\{\{.*/, "")
  return `${file}:${lineNo}: ${kind} de cache '${prefixKind}-${shown}' sem a fonte única ${rule.version} (use '${prefixKind}-${rule.version}-...')`
}

/**
 * Extrai o PREFIXO de uma cache key (ex.: 'bun' de 'bun-${{ vars.BUN_VERSION }}-...').
 * Usa match NÃO-guloso: em uma key literal ('prisma-1.3.14-...') o prefixo
 * é 'prisma' (o literal é violação de OUTRO check — aqui só identificamos
 * a toolchain). Retorna null se a key não tiver o formato '<prefixo>-...'.
 *
 * @param {string} keyValue  valor cru da key (ex.: 'bun-...')
 * @returns {string|null}
 */
export function extractCacheKeyPrefix(keyValue) {
  const m = String(keyValue).match(/^([a-zA-Z0-9_.-]+?)-/)
  return m ? m[1] : null
}

/**
 * Parseia as linhas do bloco `with:` de um actions/cache (após a linha
 * `uses: actions/cache`) e extrai os paths declarados, o prefixo da key E os
 * prefixos dos restore-keys. Suporta `path:` simples (ex.: 'path:
 * node_modules') e multi-linha ('path: |' seguido de linhas mais indentadas
 * — ex.: prisma client) — e o mesmo para `restore-keys: |` (lista de
 * fallbacks, cada linha um prefixo próprio). O restore-keys é lido para o
 * checkCachePathBlock fechar o par key↔path TAMBÉM na direção do restore
 * (ex.: key bun + restore-keys prisma = inconsistência).
 *
 * @param {string[]} blockLines  linhas do bloco (incluindo with:/path:/key:/restore-keys:)
 * @returns {{ paths: string[], keyPrefix: string|null, restorePrefixes: string[] }}
 */
export function parseCacheBlock(blockLines) {
  const paths = []
  const restorePrefixes = []
  let keyPrefix = null
  let multiIndent = -1
  let multiKind = null // "path" | "restore" — qual campo multi-linha está sendo coletado
  for (const line of blockLines) {
    const indent = line.match(/^\s*/)[0].length
    // A RÉGUA ÚNICA decide o conteúdo da linha do bloco.
    //
    // O QUE MUDA NO VEREDITO: um `path:` (ou `restore-keys:`) com `# nota` no
    // fim entrava INTEIRO na comparação de toolchain — o guard acusava um path
    // que a pipeline não declara. Agora a prosa de fim de linha sai.
    const trimmed = codeLine(line).trim()
    if (trimmed === "") continue
    if (multiIndent >= 0) {
      // coleciona linhas MAIS indentadas que o `path: |` / `restore-keys: |`
      // — até a indentação voltar ao nível do campo (mesmo nível do path:)
      if (indent <= multiIndent) {
        multiIndent = -1
        multiKind = null
      } else {
        if (multiKind === "path") {
          paths.push(trimmed)
        } else if (multiKind === "restore") {
          const p = extractCacheKeyPrefix(trimmed)
          if (p) restorePrefixes.push(p)
        }
        continue
      }
    }
    const pathM = line.match(/^\s*path:\s*(.+?)\s*$/)
    if (pathM) {
      const v = pathM[1].trim()
      if (v === "|" || v === ">" || v === ">-") {
        multiIndent = indent
        multiKind = "path"
        continue
      }
      paths.push(v.replace(/^["']|["']$/g, ""))
      continue
    }
    const keyM = line.match(/^\s*key:\s*(.+?)\s*$/)
    if (keyM) {
      keyPrefix = extractCacheKeyPrefix(keyM[1].trim())
      continue
    }
    const restM = line.match(/^\s*restore-keys:\s*(.+?)\s*$/)
    if (restM) {
      const v = restM[1].trim()
      if (v === "|" || v === ">" || v === ">-") {
        multiIndent = indent
        multiKind = "restore"
        continue
      }
      const p = extractCacheKeyPrefix(v)
      if (p) restorePrefixes.push(p)
    }
  }
  return { paths, keyPrefix, restorePrefixes }
}

/**
 * Valida UM bloco actions/cache (linhas após o `uses:`) contra as regras —
 * FECHA o par key↔path (nas DUAS direções: path E restore-keys):
 *   - a key tem prefixo de toolchain configurada → o bloco DEVE declarar
 *     pelo menos um path daquela toolchain;
 *   - um path declarado que pertence a OUTRA toolchain (ex.:
 *     node_modules/.prisma com key bun-...) é violação;
 *   - um path desconhecido de TODAS as toolchains com key configurada é
 *     violação (não é um path da toolchain);
 *   - um restore-keys com prefixo de OUTRA toolchain CONFIGURADA (ex.: key
 *     bun-... + restore-keys prisma-...) é violação — o restore buscaria o
 *     cache da toolchain errada; prefixos desconhecidos não têm contrato;
 *   - regra sem `paths` (toolchain custom) → só valida a key (não o path).
 *
 * @param {string} file         nome do arquivo
 * @param {number} usesLineNo   linha do `uses:` (1-based)
 * @param {string[]} blockLines linhas do bloco após o uses
 * @param {{ prefix: string, version: string, paths?: string[] }[]} rules
 * @returns {string[]} lista de violações (vazia = ok)
 */
export function checkCachePathBlock(file, usesLineNo, blockLines, rules) {
  if (rules.length === 0) return []
  const { paths, keyPrefix, restorePrefixes } = parseCacheBlock(blockLines)
  if (!keyPrefix) return [] // sem key reconhecível — o check de key/literal já cobre
  const rule = rules.find((r) => r.prefix === keyPrefix)
  if (!rule) return [] // toolchain não configurada — nada a validar
  const expected = rule.paths || []
  const violations = []

  // ── 0º: restore-keys de OUTRA toolchain → inconsistência do par (direção
  // do restore) — ex.: key bun-... + restore-keys prisma-... restaura o cache
  // da toolchain errada. Só prefixos de toolchains CONFIGURADAS são
  // reportados (um restore-keys com prefixo desconhecido não tem contrato).
  const foreignRestores = [
    ...new Set(restorePrefixes.filter((p) => p !== keyPrefix && rules.some((r) => r.prefix === p))),
  ]
  if (foreignRestores.length > 0) {
    violations.push(
      `${file}:${usesLineNo}: restore-keys '${foreignRestores
        .map((p) => `${p}-...`)
        .join(
          ", ",
        )}' de OUTRA toolchain — feche o par key↔path (restore-keys deve casar com a toolchain '${keyPrefix}-...' da key)`,
    )
  }

  // Regra custom SEM paths (ex.: { prefix: "next", version: "15" }) → valida
  // só a key (checkCacheKeys), nunca o path — sem paths declarados não há
  // contrato de path a impor. A violação do restore-keys (0º) ainda vale.
  if (expected.length === 0) return violations

  if (paths.length === 0) {
    violations.push(
      `${file}:${usesLineNo}: bloco actions/cache '${keyPrefix}-...' SEM path declarado — declare um dos paths da toolchain (${expected.join(", ")})`,
    )
    return violations
  }

  // 1º: path(s) de OUTRA toolchain → violação SEMPRE (fecha o par) — mesmo
  // quando o bloco também cacheia um path correto da toolchain da key (ex.:
  // bun key com node_modules + node_modules/.prisma: o .prisma sob key bun
  // derrota o keying por schema hash).
  const foreign = paths.filter(
    (p) => !expected.includes(p) && rules.some((r) => r !== rule && (r.paths || []).includes(p)),
  )
  if (foreign.length > 0) {
    // owners distintos (Set) — ex.: dois paths da mesma toolchain não
    // duplicam a sugestão 'use key prisma-... ou prisma-...'
    const owners = [
      ...new Set(foreign.map((p) => rules.find((r) => (r.paths || []).includes(p))?.prefix)),
    ].map((pfx) => `${pfx}-...`)
    violations.push(
      `${file}:${usesLineNo}: cache '${keyPrefix}-...' com path(s) [${foreign.join(", ")}] que pertence(m) à toolchain ${[
        ...new Set(
          rules
            .filter((r) => r !== rule && (r.paths || []).some((p) => foreign.includes(p)))
            .map((r) => r.prefix),
        ),
      ]
        .map((p) => `'${p}'`)
        .join(" e ")} — feche o par key↔path (use key '${owners.join(" ou ")}' ou mude o path)`,
    )
    return violations
  }

  // 2º: nenhum path de outra toolchain — passa se PELO MENOS UM path da
  // toolchain da key existir (multi-path parcial é ok). Se o restore-keys já
  // gerou violação (0º), ela é preservada mesmo com paths corretos.
  if (paths.some((p) => expected.includes(p))) return violations

  // 3º: path desconhecido de TODAS as toolchains com key configurada → violação.
  violations.push(
    `${file}:${usesLineNo}: cache '${keyPrefix}-...' com path(s) [${paths.join(", ")}] que não batem com a toolchain ${keyPrefix} (esperado: ${expected.join(", ")})`,
  )
  return violations
}

/**
 * Varre .github/workflows/*.yml e *.yaml e valida o par key↔path de TODO
 * bloco actions/cache cuja key tem prefixo de toolchain configurada — fecha
 * a conexão entre a key (que já é validada por checkCacheKeys) e o path que
 * o bloco realmente cacheia.
 *
 * @param {string} workflowsDir  diretório .github/workflows
 * @param {{ prefix: string, version: string, paths?: string[] }[]} rules
 * @returns {string[]} lista de violações (vazia = ok)
 */
export function checkCachePaths(workflowsDir, rules) {
  const violations = []
  if (!existsSync(workflowsDir) || rules.length === 0) return violations

  for (const file of readdirSync(workflowsDir).filter((f) => WORKFLOW_FILE_RE.test(f))) {
    const lines = readFileSync(join(workflowsDir, file), "utf8").split("\n")
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      // A RÉGUA ÚNICA: comentário de linha/fim de linha não é código. A COLUNA
      // continua vindo da linha crua (`usesIndent`), porque recuo é dado.
      if (codeLine(line).trim() === "") continue
      if (!codeLine(line).match(CACHE_USES_RE)) continue
      const usesIndent = line.match(/^\s*/)[0].length
      const block = []
      for (let j = i + 1; j < lines.length && block.length < CACHE_BLOCK_WINDOW; j++) {
        const l = lines[j]
        const indent = l.match(/^\s*/)[0].length
        const t = l.trim()
        if (t === "") continue
        // novo step no MESMO nível ou mais raso (indent <= uses) termina o bloco
        if (indent <= usesIndent && (/^\s*-\s+/.test(l) || !/^\s{2,}/.test(l))) break
        block.push(l)
      }
      const v = checkCachePathBlock(file, i + 1, block, rules)
      if (v.length > 0) violations.push(...v)
    }
  }
  return violations
}

/**
 * Varre .github/workflows/*.yml e *.yaml e falha se alguma cache key (key:
 * ou restore-keys:) com prefixo de uma toolchain CONFIGURADA (rules) não
 * incluir a versão daquela regra. Para bun/prisma a versão é a referência
 * `${{ vars.BUN_VERSION }}` — um literal (ex.: bun-1.3.14-) NÃO casa e é
 * reportado como violação (trocar a variável não invalidaria esse cache).
 *
 * @param {string} workflowsDir  diretório .github/workflows
 * @param {{ prefix: string, version: string }[]} rules  regras configuráveis
 * @returns {string[]} lista de violações (vazia = ok)
 */
export function checkCacheKeys(workflowsDir, rules) {
  const violations = []
  if (!existsSync(workflowsDir)) return violations

  for (const file of readdirSync(workflowsDir).filter((f) => WORKFLOW_FILE_RE.test(f))) {
    const lines = readFileSync(join(workflowsDir, file), "utf8").split("\n")
    lines.forEach((content, i) => {
      const v = checkCacheKeyLine(file, i + 1, content, rules)
      if (v) violations.push(v)
    })
  }
  return violations
}

/**
 * Caça versões LITERAIS do Bun nos workflows (bun-version: 1.3.14,
 * BUN_VERSION: "1.3.14", bun-1.3.14-...). A versão só pode vir da
 * repository variable — qualquer literal é um segundo ponto de verdade.
 *
 * @param {string} workflowsDir  diretório .github/workflows
 * @returns {string[]} lista de violações (vazia = ok)
 */
/**
 * Checa UMA linha contra versões LITERAIS do Bun (bun-version: 1.3.14,
 * BUN_VERSION: "1.3.14", bun-1.3.14-...). Retorna a violação ou null.
 * Função de NÍVEL DE LINHA compartilhada entre o scan global
 * (checkNoLiteralBunVersion) e o scan de diff (checkStagedLiterals).
 *
 * @param {string} file     nome do arquivo
 * @param {number} lineNo   número da linha (1-based)
 * @param {string} content  conteúdo da linha
 * @returns {string|null}
 */
export function checkLiteralBunLine(file, lineNo, content) {
  // A RÉGUA ÚNICA decide o código da linha (comentário de linha E de fim de
  // linha fora). O QUE MUDA NO VEREDITO: `bun-version: 1.3.14 # pinar` deixava
  // o literal da PROSA valer como declaração do workflow (a regra local só
  // olhava o INÍCIO da linha, e a casa já ignorava fim de linha nos outros
  // guards).
  const codigo = codeLine(content)
  if (codigo.trim() === "") return null
  // Versão semântica 1.x.y — casa bun-version: <ver>, BUN_VERSION: <ver> e
  // qualquer cache key com literal (bun-1.3.14-...).
  const literalRe =
    /\b(?:bun-version|BUN_VERSION):\s*["']?(\d+\.\d+\.\d+)|(?:bun|prisma)-(\d+\.\d+\.\d+)-/g
  literalRe.lastIndex = 0
  const m = literalRe.exec(codigo)
  if (!m) return null
  const literal = m[1] || m[2]
  const context = m[0].trim()
  return `${file}:${lineNo}: versão literal do Bun '${literal}' em '${context}' — a versão só pode vir da repository variable (use ${BUN_VERSION_VAR})`
}

/**
 * Caça versões LITERAIS do Bun nos workflows (bun-version: 1.3.14,
 * BUN_VERSION: "1.3.14", bun-1.3.14-...). A versão só pode vir da
 * repository variable — qualquer literal é um segundo ponto de verdade.
 *
 * @param {string} workflowsDir  diretório .github/workflows
 * @returns {string[]} lista de violações (vazia = ok)
 */
export function checkNoLiteralBunVersion(workflowsDir) {
  const violations = []
  if (!existsSync(workflowsDir)) return violations

  for (const file of readdirSync(workflowsDir).filter((f) => WORKFLOW_FILE_RE.test(f))) {
    const lines = readFileSync(join(workflowsDir, file), "utf8").split("\n")
    lines.forEach((content, i) => {
      const v = checkLiteralBunLine(file, i + 1, content)
      if (v) violations.push(v)
    })
  }
  return violations
}

/**
 * Normaliza o valor de um `bun-version:` (ex.: aceita aspas e descarta
 * comentário inline) — tratamento ÚNICO compartilhado entre o scan global
 * (checkSetupBunCallSites) e o scan de diff (checkStagedSetupBunCallSites).
 *
 * ORDEM IMPORTANTE: o comentário inline é removido ANTES das aspas — num
 * valor `"${{ vars.BUN_VERSION }}" # nota`, remover as aspas primeiro
 * deixaria a aspas final remanescente (`" # nota` impede o match `["']$`).
 *
 * @param {string} raw  valor cru do YAML (ex.: '"${{ vars.BUN_VERSION }}" # nota')
 * @returns {string} valor normalizado
 */
export function normalizeBunVersionValue(raw) {
  return raw
    .trim()
    .replace(/\s*#.*$/, "")
    .replace(/^["']|["']$/g, "")
    .trim()
}

/**
 * Palavras que podem vir ANTES do script e ainda caracterizam uma CHAMADA
 * (interpretador explícito, `env`, `time`...). É o que separa a chamada da
 * MENÇÃO em prosa: `run: bash scripts/setup-bun-ci.sh` é chamada;
 * `run: echo "... use scripts/setup-bun-ci.sh (cached)."` é texto.
 */
export const SHELL_INTRODUCERS = new Set([
  "bash",
  "sh",
  "source",
  "env",
  "time",
  "command",
  "xargs",
])

/** Qualquer forma de citar o script — `scripts/setup-bun-ci.sh`, `./x/y.sh`, `setup-bun-ci.sh`. */
export const SETUP_BUN_REF_RE = /(?:[\w.~/-]*\/)?setup-bun-ci\.sh/g

/**
 * Do token imediatamente anterior ao script, extrai a PALAVRA QUE O INVOCA:
 * descarta a chave YAML do step (`run:`, `-`), os separadores de shell
 * (`$(`, crase, `;`, `&`, `|`, `(`, `)`, `=`) e as aspas que cercam o comando
 * (`bash -lc "bash scripts/setup-bun-ci.sh"` → `bash`).
 *
 * O que NÃO é descartado importa tanto quanto: uma palavra qualquer
 * (`echo "... use scripts/setup-bun-ci.sh ..."` → `use`) sobrevive e
 * denuncia a linha como prosa.
 */
function invokerWord(rawWord) {
  return rawWord
    .replace(/["'`]/g, "")
    .replace(/^(?:-|run:)$/, "")
    .replace(/^.*(?:\$\(|`|[;&|()=])/, "")
}

/**
 * O script aparece em POSIÇÃO DE COMANDO nesta linha? Devolve o texto DEPOIS
 * do script (o argumento) quando sim, ou null quando a linha apenas o MENCIONA.
 *
 * Por que a distinção existe: um `run: echo "... scripts/setup-bun-ci.sh ..."`
 * (resumo de job, log) NÃO é um call site — exigir a variável de um texto é
 * falso positivo, e guard que acusa prosa vira guard que se aprende a ignorar.
 * A regra é a do shell: o token imediatamente anterior ao script precisa ser o
 * INÍCIO do comando (`bash scripts/...`, `./scripts/...`, `bash -lc "bash
 * scripts/..."`, `OUT="$(bash scripts/...)"`) — ou um interpretador explícito.
 * A intenção oposta segue coberta: uma chamada REAL sem a variável
 * (`run: bash scripts/setup-bun-ci.sh 1.3.14`) continua sendo violação, com ou
 * sem caminho e também capturada em `$(...)`/`OUT="$(...)"`.
 *
 * @param {string} content  conteúdo de UMA linha
 * @returns {string|null} argumento (possivelmente vazio) ou null se for menção
 */
export function setupBunInvocationArgs(content) {
  if (!content.includes("setup-bun-ci.sh")) return null
  SETUP_BUN_REF_RE.lastIndex = 0
  let m
  while ((m = SETUP_BUN_REF_RE.exec(content)) !== null) {
    const words = content.slice(0, m.index).trim().split(/\s+/).filter(Boolean)
    const invoker = words.length > 0 ? invokerWord(words[words.length - 1]) : ""
    if (invoker !== "" && !SHELL_INTRODUCERS.has(invoker)) continue
    return content.slice(m.index + m[0].length)
  }
  return null
}

/**
 * Checa UMA linha de invocação do setup do Bun. O setup é um SCRIPT chamado
 * por `run:` e recebe a versão como ARGUMENTO — a fonte única é a repository
 * variable. Retorna a violação como string, ou null se a linha estiver
 * correta.
 *
 * Substitui o antigo `checkSetupBunCallSite`, que varria a janela do input
 * `bun-version:` do composite action. O setup saiu do composite para
 * `SETUP_BUN_SCRIPT` (chamado por `run:`, que NÃO passa pelo resolvedor de
 * actions locais do runner) — o argumento da linha É o call site agora.
 *
 * @param {string} file      nome do arquivo
 * @param {number} lineNo    número da linha (1-based)
 * @param {string} content   conteúdo da linha
 * @returns {string|null}
 */
export function checkSetupBunRunLine(file, lineNo, content) {
  const rest = setupBunInvocationArgs(content)
  if (rest === null) return null
  // Extrai o ARGUMENTO, não o resto da linha: a chamada pode estar CAPTURADA
  // (`OUT="$(bash ... "${{ vars.BUN_VERSION }}" 2>&1)"`) ou ter `# nota` no
  // fim — ler o fim da linha fazia a versão canônica parecer um literal (o
  // próprio guard pegou esse caso no smoke). Ordem: aspas (forma canônica),
  // depois a EXPRESSÃO inteira (que tem espaço e escaparia de \S+) e por fim
  // um token simples.
  const m = rest.match(/^\s+("[^"]*"|'[^']*'|\$\{\{[^}]*\}\}|\S+)/)
  if (!m) {
    return `${file}:${lineNo}: chamada de ${SETUP_BUN_SCRIPT} SEM a versão — passe ${BUN_VERSION_VAR} como argumento (o script lê a versão SÓ do argumento; a fonte única é a repository variable)`
  }
  const arg = normalizeBunVersionValue(m[1])
  if (arg !== BUN_VERSION_VAR) {
    return `${file}:${lineNo}: chamada de ${SETUP_BUN_SCRIPT} com versão '${arg}' — use a fonte única ${BUN_VERSION_VAR} (literal é violação)`
  }
  return null
}

/**
 * Verifica que TODA invocação do setup do Bun passa a versão da fonte única
 * (${{ vars.BUN_VERSION }}) como argumento.
 *
 * Por que existe: substituiu a validação do input `bun-version:` do composite.
 * A INVARIANTE é a mesma — a versão do Bun tem UM ponto de verdade —, mas o
 * contrato mudou de forma: o setup agora é um script chamado por `run:`, e o
 * argumento é o único caminho por onde a versão entra. Um call site com
 * literal (ou sem argumento) usaria outra versão, e o mesmo commit geraria
 * artefatos diferentes conforme a pipeline que o construiu.
 *
 * @param {string} workflowsDir  diretório de workflows de UMA forja
 * @returns {string[]} lista de violações (vazia = ok)
 */
export function checkSetupBunCallSites(workflowsDir) {
  const violations = []
  if (!existsSync(workflowsDir)) return violations

  for (const file of readdirSync(workflowsDir).filter((f) => WORKFLOW_FILE_RE.test(f))) {
    const lines = readFileSync(join(workflowsDir, file), "utf8").split("\n")
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      // Ignora comentários — prosa que MENCIONA o script não é uma chamada
      // real. A régua é a MESMA do `check-no-setup-bun.mjs` (era um alinhamento
      // mantido à mão, e é isso que o próximo ajuste quebra): `codeLine`, e a
      // EXPRESSÃO fica inteira no conteúdo entregue ao `checkSetupBunRunLine`,
      // que compara o argumento com `${{ vars.BUN_VERSION }}`.
      if (codeLine(line).trim() === "") continue
      const v = checkSetupBunRunLine(file, i + 1, line)
      if (v) violations.push(v)
    }
  }
  return violations
}

/**
 * Parseia um diff unificado (git diff --cached local, ou PR base...HEAD no
 * CI) e devolve TODAS as linhas que aparecem no diff por arquivo de workflow
 * (.yml OU .yaml) do diretório .github/workflows — ADICIONADAS (prefixo '+'),
 * de CONTEXTO (prefixo ' ') e REMOVIDAS (prefixo '-') — com o número de linha
 * correspondente NO NOVO arquivo e as flags `added`/`removed`. O contexto é
 * necessário para o checkStagedSetupBunCallSites: na migração de action (ex.:
 * oven-sh/setup-bun@v2 → ./.github/actions/setup-bun) a linha `uses:` é
 * ADICIONADA mas `with:`/`bun-version:` ficam como CONTEXTO no diff — um
 * parser só-de-adicionadas veria o call site SEM o bun-version e geraria
 * falso positivo. As REMOVIDAS (sem incrementar lineNo — não existem no
 * arquivo novo) são necessárias para o checkStagedRemovedSetupBunCall detectar
 * a remoção do input bun-version de um call site que SOBREVIVEU. Headers
 * `--- a/<path>` do arquivo ANTIGO são ignorados (não são linhas removidas).
 * Arquivos sem extensão de workflow (.yml/.yaml) são ignorados.
 *
 * @param {string} diffText  saída de `git diff ... -- .github/workflows`
 * @returns {Map<string, {lineNo: number, content: string, added: boolean}[]>}
 */
export function parseDiffLines(diffText, isTarget = isWorkflowPath) {
  const perFile = new Map()
  let currentFile = null
  let lineNo = 0

  for (const line of diffText.split("\n")) {
    if (line.startsWith("+++ ")) {
      // "+++ b/.github/workflows/pr-check.yml" → caminho do arquivo NOVO
      // (aceita .yml E .yaml — extensão alternativa não escapa do scan)
      const path = line.slice(4).replace(/^b\//, "")
      currentFile = isTarget(path) ? path : null
      lineNo = 0
      continue
    }
    if (line.startsWith("@@ ")) {
      // "@@ -12,4 +15,6 @@" → linha de partida do arquivo NOVO no hunk
      const m = line.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
      lineNo = m ? Number(m[1]) : 0
      continue
    }
    if (line.startsWith("--- ")) {
      // "--- a/<path>" — header do arquivo ANTIGO no diff; NÃO é uma linha
      // REMOVIDA. Sem este guard, num diff multi-arquivo o `--- a/<próximo>`
      // (antes do `+++` que reseta currentFile) cairia como `removed: true`
      // espúrio do arquivo ANTERIOR.
      continue
    }
    if (!currentFile) continue
    const ch = line[0]
    if (ch === "+") {
      if (!perFile.has(currentFile)) perFile.set(currentFile, [])
      perFile.get(currentFile).push({ lineNo, content: line.slice(1), added: true })
      lineNo++
    } else if (ch === "-") {
      // linha REMOVIDA — não existe no arquivo novo; incluída com `removed:
      // true` SEM incrementar lineNo (ela não ocupa posição no arquivo novo)
      // para o checkStagedRemovedSetupBunCall detectar a remoção do input
      // bun-version de um call site que SOBREVIVEU no novo arquivo.
      if (!perFile.has(currentFile)) perFile.set(currentFile, [])
      perFile.get(currentFile).push({ lineNo, content: line.slice(1), removed: true })
    } else if (ch === " ") {
      if (!perFile.has(currentFile)) perFile.set(currentFile, [])
      perFile.get(currentFile).push({ lineNo, content: line.slice(1), added: false })
      lineNo++
    }
    // demais metadados (diff --git, index, \ No newline...) são ignorados
  }
  return perFile
}

/**
 * Parseia um diff e devolve apenas as linhas ADICIONADAS (prefixo '+') por
 * arquivo de workflow (.yml/.yaml) — camada fina sobre parseDiffLines (o
 * parser rico) para os checks por linha (cache keys e literais).
 *
 * @param {string} diffText  saída de `git diff ... -- .github/workflows`
 * @returns {Map<string, {lineNo: number, content: string}[]>}
 */
export function parseDiffAddedLines(diffText, isTarget = isWorkflowPath) {
  const perFile = new Map()
  for (const [file, lines] of parseDiffLines(diffText, isTarget)) {
    const added = lines.filter((l) => l.added).map(({ lineNo, content }) => ({ lineNo, content }))
    if (added.length > 0) perFile.set(file, added)
  }
  return perFile
}

/**
 * Checa as cache keys das linhas ADICIONADAS de um diff (git diff --cached
 * local, ou PR base...HEAD no CI) contra TODAS as toolchains configuradas
 * (rules — o DEFAULT_CACHE_KEY_RULES é a fonte: hoje bun + prisma, mas
 * qualquer { prefix, version } adicionado à lista vale TAMBÉM no staged, ex.:
 * um futuro 'next' com version '15') — detecta keys antigas (ex.:
 * bun-1.3.14-... ou next-14-...) introduzidas PELO PR antes do merge, mesmo
 * que o working tree global já esteja migrado. Só linhas ADICIONADAS são
 * avaliadas — violações pré-existentes do base não poluem o PR.
 *
 * @param {string} diffText  saída de git diff
 * @param {{ prefix: string, version: string }[]} rules  regras configuráveis
 * @returns {string[]} lista de violações (vazia = ok)
 */
export function checkStagedCacheKeys(diffText, rules) {
  const violations = []
  for (const [file, lines] of parseDiffAddedLines(diffText)) {
    for (const { lineNo, content } of lines) {
      const v = checkCacheKeyLine(file, lineNo, content, rules)
      if (v) violations.push(v)
    }
  }
  return violations
}

/**
 * Checa versões LITERAIS do Bun nas linhas ADICIONADAS de um diff — detecta
 * bun-version: 1.3.14 / bun-1.3.14-... introduzidos pelo próprio PR.
 *
 * @param {string} diffText  saída de git diff
 * @returns {string[]} lista de violações (vazia = ok)
 */
export function checkStagedLiterals(diffText) {
  const violations = []
  for (const [file, lines] of parseDiffAddedLines(diffText)) {
    for (const { lineNo, content } of lines) {
      const v = checkLiteralBunLine(file, lineNo, content)
      if (v) violations.push(v)
    }
  }
  return violations
}

/**
 * Valida o par key↔path dos blocos actions/cache nas linhas de um diff —
 * detecta blocos de cache NOVOS (linha `uses: actions/cache` ADICIONADA)
 * cujo path não bate com a toolchain da key. Só blocos cuja linha `uses:`
 * foi adicionada pelo diff são avaliados (violações pré-existentes do base
 * não poluem o PR). Usa o parser RICO (parseDiffLines): o path/key podem
 * estar em linhas de CONTEXTO do mesmo bloco.
 *
 * @param {string} diffText  saída de git diff
 * @param {{ prefix: string, version: string, paths?: string[] }[]} rules
 * @returns {string[]} lista de violações (vazia = ok)
 */
export function checkStagedCachePaths(diffText, rules) {
  const violations = []
  if (rules.length === 0) return violations
  for (const [file, lines] of parseDiffLines(diffText)) {
    for (let i = 0; i < lines.length; i++) {
      const { lineNo, content, added } = lines[i]
      if (!added) continue // só blocos INTRODUZIDOS por este diff
      if (codeLine(content).trim() === "") continue
      if (!codeLine(content).match(CACHE_USES_RE)) continue

      // Janela de até CACHE_BLOCK_WINDOW linhas depois do uses (mesma do
      // scan global) — varre adicionadas E contexto do mesmo arquivo. Linhas
      // REMOVIDAS são puladas — um path/key removido não pertence ao bloco
      // sobrevivente que está sendo validado.
      const following = []
      for (let j = i + 1; j < lines.length && lines[j].lineNo <= lineNo + CACHE_BLOCK_WINDOW; j++) {
        if (lines[j].removed) continue
        following.push(lines[j].content)
      }
      const v = checkCachePathBlock(file, lineNo, following, rules)
      if (v.length > 0) violations.push(...v)
    }
  }
  return violations
}

/**
 * Checa as invocações do setup do Bun nas linhas de um diff — pega uma linha
 * de `run:` com literal (ou SEM o argumento) INTRODUZIDA pelo próprio PR antes
 * do merge. Avalia as linhas que o diff MOSTRA (adicionadas E de contexto): a
 * chamada do script é UMA linha, então qualquer uma delas é o call site real
 * — não existe mais a janela do `bun-version:` do composite.
 *
 * @param {string} diffText  saída de git diff
 * @returns {string[]} lista de violações (vazia = ok)
 */
export function checkStagedSetupBunCallSites(diffText) {
  const violations = []
  for (const [file, lines] of parseDiffLines(diffText)) {
    for (const { lineNo, content, removed } of lines) {
      if (removed) continue // linha removida não existe no arquivo novo
      if (codeLine(content).trim() === "") continue
      const v = checkSetupBunRunLine(file, lineNo, content)
      if (v) violations.push(v)
    }
  }
  return violations
}

/**
 * Checa a REMOÇÃO da chamada do setup do Bun nas linhas de um diff — a
 * regressão OPOSTA à do checkStagedSetupBunCallSites: um PR que APAGA o setup
 * de um job sem pôr outro no lugar.
 *
 * NÃO reporta quando o mesmo arquivo TAMBÉM ganha uma chamada do script: aí é
 * a movimentação/migração legítima (a antiga sai, a nova entra).
 *
 * @param {string} diffText  saída de git diff
 * @returns {string[]} lista de violações (vazia = ok)
 */
export function checkStagedRemovedSetupBunCall(diffText) {
  const violations = []
  for (const [file, lines] of parseDiffLines(diffText)) {
    // Só CHAMADAS contam (menção em prosa/echo não é setup removido).
    const removed = lines.filter((l) => l.removed && setupBunInvocationArgs(l.content) !== null)
    if (removed.length === 0) continue
    const added = lines.filter((l) => !l.removed && setupBunInvocationArgs(l.content) !== null)
    if (added.length > 0) continue // o setup mudou de forma, não sumiu
    for (const l of removed) {
      violations.push(
        `${file}:${l.lineNo}: REMOÇÃO da chamada do setup do Bun (${SETUP_BUN_SCRIPT}) sem substituta neste arquivo — o job ficaria sem Bun na versão da fonte única ${BUN_VERSION_VAR}`,
      )
    }
  }
  return violations
}

/**
 * Checa a REMOÇÃO do path: OU da key: de blocos actions/cache nas linhas de
 * um diff — a regressão OPOSTA à do checkStagedCachePaths: um bloco que
 * SOBREVIVE no arquivo novo (linha `uses: actions/cache` presente como
 * contexto OU adicionada) mas que PERDEU o `path:` ou a `key:` — o campo foi
 * REMOVIDO pelo PR (linha `-` no diff). Sem este check, remover o path/key
 * de um bloco pré-existente passaria no guard: o check de adição só avalia
 * blocos cuja linha `uses:` foi ADICIONADA.
 *
 * NÃO reporta quando:
 *   - o bloco INTEIRO foi removido (a linha `uses:` também é `-` — o step
 *     deixou de existir, não há contrato a impor);
 *   - um `path:`/`key:` SOBREVIVE na janela (adicionado ou contexto) — ex.:
 *     troca de path node_modules → node_modules/.prisma (a linha antiga é
 *     `-`, a nova é `+`) — o bloco TROCOU o valor, não perdeu o campo.
 *
 * O `restore-keys:` NÃO é alvo: ele é opcional por natureza (fallback do
 * cache) — remover restore-keys não quebra o par key↔path; só path/key são
 * obrigatórios para o restore funcionar.
 *
 * LIMITAÇÃO (intencional): a REMOÇÃO só é detectada na linha `path:` em si —
 * remover apenas as sub-linhas indentadas de um `path: |` sobrevivente
 * (deixando `path: |` sem filhos, i.e. lista vazia de paths) escapa do
 * check, pois nenhuma linha REMOVIDA com prefixo `path:` existe na janela
 * para disparar a detecção (o header `path: |` sobrevive e não casa o
 * regex de remoção). Diferente do parseCacheBlock global, que coleta os
 * filhos indentados e detectaria a lista vazia como 'SEM path declarado' —
 * o scan de remoção é por linha-cabeçalho. Se um dia essa variante
 * aparecer, ampliar o regex para também exigir pelo menos um filho
 * indentado após um `path: |` removido.
 * @param {string} diffText  saída de git diff
 * @returns {string[]} lista de violações (vazia = ok)
 */
export function checkStagedRemovedCacheBlockFields(diffText) {
  const violations = []
  for (const [file, lines] of parseDiffLines(diffText)) {
    for (let i = 0; i < lines.length; i++) {
      const { lineNo, content, removed } = lines[i]
      // âncora: bloco actions/cache que SOBREVIVE no novo arquivo (uses
      // presente — contexto ou adicionado). `uses:` REMOVIDO = bloco inteiro
      // removido (step deletado) — sem contrato a impor.
      if (removed) continue
      if (codeLine(content).trim() === "") continue
      if (!codeLine(content).match(CACHE_USES_RE)) continue

      // Janela seguinte (mesma do checkStagedCachePaths) — procura um
      // `path:`/`key:` REMOVIDO e, na MESMA janela, um SOBREVIVENTE.
      const following = []
      for (let j = i + 1; j < lines.length && lines[j].lineNo <= lineNo + CACHE_BLOCK_WINDOW; j++) {
        following.push(lines[j])
      }

      // path removido sem path sobrevivente na janela → bloco sem path
      const removedPath = following.find((l) => l.removed && /^\s*path:/.test(l.content))
      if (removedPath) {
        const survivingPath = following.some((l) => !l.removed && /^\s*path:/.test(l.content))
        if (!survivingPath) {
          violations.push(
            `${file}:${removedPath.lineNo}: REMOÇÃO do campo path: do bloco actions/cache (uses: linha ${lineNo}) — o bloco SOBREVIVEU sem path; declare um dos paths da toolchain (ex.: node_modules) do par key↔path`,
          )
        }
      }

      // key removida sem key sobrevivente na janela → bloco sem key
      const removedKey = following.find((l) => l.removed && /^\s*key:/.test(l.content))
      if (removedKey) {
        const survivingKey = following.some((l) => !l.removed && /^\s*key:/.test(l.content))
        if (!survivingKey) {
          violations.push(
            `${file}:${removedKey.lineNo}: REMOÇÃO do campo key: do bloco actions/cache (uses: linha ${lineNo}) — o bloco SOBREVIVEU sem key; adicione de volta a key da toolchain (ex.: bun-${BUN_VERSION_VAR}-...) do par key↔path`,
          )
        }
      }
    }
  }
  return violations
}

/**
 * Checa a migração INCOMPLETA de literais nas linhas de um diff — a
 * regressão OPOSTA à do checkStagedLiterals (que só vê linhas ADICIONADAS):
 * um literal (bun-version: 1.3.14, BUN_VERSION: "1.3.14", bun-1.3.14-...)
 * REMOVIDO pelo diff (linha `-`) — o PR está migrando aquele literal para a
 * fonte única — enquanto OUTRO literal SOBREVIVE na mesma região (linha de
 * contexto ou adicionada, dentro da janela) — a migração ficou pela METADE:
 * o PR tocou a família de literais (removeu um) mas deixou outro para trás.
 *
 * Por que o checkStagedLiterals não basta: ele só avalia linhas ADICIONADAS
 * (+ no diff). Um bun-version literal que SOBREVIVE como CONTEXTO (não foi
 * adicionado pelo PR) escapa dele — e o PR claramente está migrando a região
 * (removeu a key literal ao lado), então o sobrevivente é um ponto esquecido.
 *
 * NÃO reporta quando:
 *   - NENHUM literal foi removido (um literal pré-existente de contexto, sem
 *     atividade de migração na região, não é responsabilidade do PR);
 *   - o literal removido e o sobrevivente estão LONGES (fora da janela
 *     CACHE_BLOCK_WINDOW) — sem evidência de que são a MESMA migração;
 *   - o bloco/step INTEIRO foi removido (sem literal sobrevivente na região).
 *
 * @param {string} diffText  saída de git diff
 * @returns {string[]} lista de violações (vazia = ok)
 */
export function checkStagedRemovedLiterals(diffText) {
  const violations = []
  for (const [file, lines] of parseDiffLines(diffText)) {
    for (let i = 0; i < lines.length; i++) {
      const anchor = lines[i]
      // âncora: literal REMOVIDO pelo diff (linha `-`) — o PR está migrando
      if (!anchor.removed) continue
      if (codeLine(anchor.content).trim() === "") continue
      if (checkLiteralBunLine(file, anchor.lineNo, anchor.content) === null) continue

      // região (mesma janela do cache block) em AMBAS as direções — um
      // literal SOBREVIVENTE na região = migração incompleta
      const surviving = lines.find(
        (l, j) =>
          j !== i &&
          !l.removed &&
          Math.abs((l.lineNo ?? anchor.lineNo) - anchor.lineNo) <= CACHE_BLOCK_WINDOW &&
          codeLine(l.content).trim() !== "" &&
          checkLiteralBunLine(file, l.lineNo ?? anchor.lineNo, l.content) !== null,
      )
      if (!surviving) continue

      violations.push(
        `${file}:${surviving.lineNo}: literal do Bun SOBREVIVE ao lado de literal REMOVIDO (linha ${anchor.lineNo}) — migração incompleta para a fonte única ${BUN_VERSION_VAR}; remova o literal sobrevivente ou migre para a variável`,
      )
    }
  }
  return violations
}

/**
 * Valida que um ref de git passado via --base é um nome de ref SEGURO
 * (charset refname do git + operadores de revisão: letras, dígitos, ., _, /,
 * -, ~ e ^ — ex.: origin/main, HEAD~1, v1.0^2). Proteção contra
 * metacharacters de shell: `~` e `^` são INOCUOS aqui porque o ref só entra
 * numa range de `git diff` via execFileSync (array de args, SEM shell), e a
 * proteção real contra ranges/injeção é o check `..` (ex.: main..other) e o
 * prefixo `-` (ex.: -f). Um valor malicioso como `main; rm -rf /` ou
 * `$(whoami)` falha o charset ANTES de chegar ao git.
 *
 * @param {string} ref
 * @returns {boolean}
 */
export function isValidGitRef(ref) {
  return /^[a-zA-Z0-9][a-zA-Z0-9._/~^-]*$/.test(ref) && !ref.includes("..") && !ref.startsWith("-")
}

/**
 * Roda `git diff --cached` (staged local) ou `git diff <base>...HEAD`
 * (CI — PR vs base) limitado a .github/workflows. Retorna null se git
 * indisponível / sem repositório / ref base inválida (o caller decide o
 * exit code). Usa execFileSync (array de args, SEM shell) — sem risco de
 * injeção a partir do valor de --base.
 *
 * Passa `-U${DIFF_CONTEXT}` para EXPANDIR o contexto do diff além do
 * default de 3 linhas — requisito dos checks de REMOÇÃO com janela (ver
 * DIFF_CONTEXT): um literal/path/input sobrevivente fora do contexto de 3
 * linhas não apareceria no diff e a regressão passaria despercebida.
 *
 * @param {string|null} base  ref base (ex.: "origin/main"); null = staged
 * @returns {string|null} texto do diff ou null (infra failure)
 */
export function gitDiffWorkflows(base) {
  return gitDiffPaths(base, FORGE_WORKFLOW_DIRS)
}

/**
 * O diff do recorte `--staged`/`--base` para um conjunto de PATHSPECS.
 *
 * Existe separado do `gitDiffWorkflows` porque a varredura da fonte única
 * passou a ter dois escopos com caminhos diferentes (os workflows das forjas e
 * os scripts/composes) — e a MESMA semântica de `-U` (DIFF_CONTEXT), de base
 * válida e de "git indisponível ⇒ null" tem de valer nos dois. Um `git diff`
 * por escopo, um só lugar que monta o comando.
 *
 * @param {string|null} base
 * @param {string[]} pathspecs
 * @returns {string|null}
 */
export function gitDiffPaths(base, pathspecs) {
  if (base !== null && !isValidGitRef(base)) return null
  // Pathspec de TODAS as forjas: no modo --staged/--base o guard precisa ver o
  // que o PR introduz em qualquer pipeline — limitar ao GitHub foi o que deixou
  // a forja dona do merge sem cobertura de fonte única.
  const args = base
    ? ["diff", `-U${DIFF_CONTEXT}`, `${base}...HEAD`, "--", ...pathspecs]
    : ["diff", `-U${DIFF_CONTEXT}`, "--cached", "--", ...pathspecs]
  try {
    return execFileSync("git", args, { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 })
  } catch {
    return null
  }
}

/** O diff do recorte para os scripts/composes (invariantes 15/16). */
export function gitDiffSingleSource(base) {
  return gitDiffPaths(base, SINGLE_SOURCE_PATHS)
}

/**
 * Verifica que o .actrc local define BUN_VERSION — sem ele, o act local roda
 * com vars.BUN_VERSION vazia e o setup-bun falha em runtime (mensagem
 * confusa de URL quebrado em vez do erro claro do resolve step).
 *
 * @param {string} actrcPath  caminho do .actrc
 * @returns {string[]} lista de violações (vazia = ok)
 */
export function checkActrc(actrcPath) {
  if (!existsSync(actrcPath)) {
    return [
      `${actrcPath} ausente — crie com '--var BUN_VERSION=<versão>' (espelho local da repository variable; sem ele o act local quebra)`,
    ]
  }
  const content = readFileSync(actrcPath, "utf8")
  if (!/BUN_VERSION\s*=/.test(content)) {
    return [
      `${actrcPath} não define BUN_VERSION — adicione '--var BUN_VERSION=<versão>' (mantenha em sincronia com a repository variable do GitHub)`,
    ]
  }
  return []
}

/**
 * Checa UMA linha de um Dockerfile contra versões LITERAIS do Bun — casa
 * `npm install -g bun@1.2`, `FROM oven/bun:1`, `FROM oven/bun:1.3.14` etc.
 * A versão nos Dockerfiles só pode vir do build-arg BUN_VERSION
 * (\${BUN_VERSION}) — um literal cria um segundo ponto de verdade.
 * Retorna a violação ou null.
 *
 * @param {string} file     nome do Dockerfile (ex.: "Dockerfile")
 * @param {number} lineNo   número da linha (1-based)
 * @param {string} content  conteúdo da linha
 * @returns {string|null}
 */
export function checkDockerfileBunLine(file, lineNo, content) {
  // A régua ÚNICA para o comentário de LINHA. Em Dockerfile o `#` só é
  // comentário no INÍCIO da linha, então a prosa de fim de linha NÃO sai daqui
  // (diferente do YAML/shell): `RUN echo bun-1.2 # nota` é comando inteiro, e
  // tratá-lo como comentário cegaria o guard.
  if (isCommentLine(content)) return null // ignora comentários
  // Casa bun@<tag>, FROM oven/bun:<tag> E o padrão curl de download
  // (bun-v<tag> — ex.: Dockerfile.ubuntu-bun baixa de
  // .../releases/download/bun-v${BUN_VERSION}/bun-linux-x64.zip) — a tag
  // literal (1.2, 1, 1.3.14, 1-slim) é violação; \${BUN_VERSION} é o padrão
  // correto. O padrão curl só casa versão semântica/dígitos (bun-v1.2,
  // bun-v1.3.14) — nunca \${BUN_VERSION} (não é dígito) nem prosa como
  // 'bun-vendor'.
  const m = content.match(/(?:npm install -g bun@|FROM oven\/bun:)([^\s"'\\]+)/)
  if (!m) {
    const curlM = content.match(/bun-v(\d+(?:\.\d+)*)/)
    if (!curlM) return null
    return `${file}:${lineNo}: versão do Bun '${curlM[1]}' em '${curlM[0].trim()}' é um LITERAL no Dockerfile — use a fonte única via ARG (ex.: 'bun-v\${BUN_VERSION}' na URL de download; o workflow passa --build-arg BUN_VERSION=${BUN_VERSION_VAR})`
  }
  const tag = m[1]
  // Permite a fonte única em TODAS as formas válidas do ARG: \${BUN_VERSION},
  // \${BUN_VERSION}-slim (sufixo — o prefixo exato \${BUN_VERSION} casa),
  // \${BUN_VERSION:-x} (DEFAULT — o prefixo \${BUN_VERSION: casa) e $BUN_VERSION
  // (sem chaves). Prefixos EXPLÍCITOS (não includes): um typo como
  // \${BUN_VERSIONX} é flagrado como literal (includes aceitaria silencioso).
  if (
    tag.startsWith("${BUN_VERSION}") ||
    tag.startsWith("${BUN_VERSION:") ||
    tag.startsWith("$BUN_VERSION")
  )
    return null
  return `${file}:${lineNo}: versão do Bun '${tag}' em '${m[0].trim()}' é um LITERAL no Dockerfile — use a fonte única via ARG (ex.: 'npm install -g bun@\${BUN_VERSION}' ou 'FROM oven/bun:\${BUN_VERSION}'; o workflow passa --build-arg BUN_VERSION=${BUN_VERSION_VAR})`
}

/**
 * Varre TODOS os Dockerfiles da lista DOCKERFILES por versões LITERAIS do
 * Bun (invariante 13) — o padrão correto é ARG BUN_VERSION + \${BUN_VERSION}
 * (como o Dockerfile.ubuntu-bun). Um Dockerfile novo que pinar bun sem
 * entrar na lista escaparia — a lista é explícita de propósito.
 *
 * @param {string} cwd  diretório do repo
 * @returns {string[]} lista de violações (vazia = ok)
 */
export function checkDockerfiles(cwd) {
  const violations = []
  for (const rel of DOCKERFILES) {
    const p = join(cwd, rel)
    if (!existsSync(p)) {
      violations.push(
        `Dockerfile ausente da lista DOCKERFILES: ${rel} (sem ele, um Dockerfile que pinar bun escaparia do guard)`,
      )
      continue
    }
    const lines = readFileSync(p, "utf8").split("\n")
    lines.forEach((l, i) => {
      const v = checkDockerfileBunLine(rel, i + 1, l)
      if (v) violations.push(v)
    })
  }
  return violations
}

/**
 * Verifica que NENHUM lockfile estrangeiro (npm/pnpm) existe no repo
 * (invariante 14) — a unificação em bun.lock é travada: um `npm install`
 * acidental na raiz ou num mini-service regenera o lockfile e o guard falha.
 *
 * @param {string} cwd  diretório do repo
 * @returns {string[]} lista de violações (vazia = ok)
 */
export function checkNoForeignLockfiles(cwd) {
  const violations = []
  for (const rel of FOREIGN_LOCKFILES) {
    if (existsSync(join(cwd, rel))) {
      violations.push(
        `${rel} presente — o repo usa APENAS bun.lock como fonte única de deps; remova o lockfile/config npm/pnpm (um 'npm install'/'pnpm install' acidental o regenera)`,
      )
    }
  }
  return violations
}

/**
 * Valida as invariantes a partir dos caminhos reais.
 * @returns {string[]} lista de violações (vazia = ok)
 */
export function validateMirror(workflowPath, implPath, dockerfilePath) {
  const violations = []

  if (!existsSync(workflowPath)) {
    violations.push(`workflow do mirror ausente: ${workflowPath} (crie sync-bun-mirror.yml)`)
    return violations
  }
  if (!existsSync(implPath)) {
    violations.push(
      `implementação do setup do Bun ausente: ${implPath} (esperado ${SETUP_BUN_SCRIPT})`,
    )
    return violations
  }
  if (dockerfilePath && !existsSync(dockerfilePath)) {
    violations.push(
      `Dockerfile do mirror ausente: ${dockerfilePath} (sem ele, o workflow do mirror quebra no cron/CI)`,
    )
  }

  const wf = readFileSync(workflowPath, "utf8")
  const impl = readFileSync(implPath, "utf8")

  // ── Invariante 2: mirror referencia a repository variable (não literal) ─
  const mirrorVersion = extractEnvVersion(wf)
  if (!mirrorVersion) {
    violations.push(`${workflowPath}: env.BUN_VERSION não encontrado`)
  } else if (mirrorVersion !== BUN_VERSION_VAR) {
    violations.push(
      `${workflowPath}: env.BUN_VERSION='${mirrorVersion}' é um LITERAL — use ${BUN_VERSION_VAR} (fonte única: repository variable)`,
    )
  }

  // ── Invariantes 3-6: a IMPLEMENTAÇÃO do setup (o script que substituiu o ─
  // composite action). Os mesmos contratos que o guard impunha ao action.yml
  // recaem agora sobre o script — outro artefato, a mesma invariante.
  // Checagem que PRECISA poder falhar: um default literal no script é o mesmo
  // segundo ponto de verdade que o guard existe para impedir (a antiga versão
  // desta checagem procurava YAML de action.yml e nunca casava — ver o doc de
  // findBunLiteralDefaultInScript).
  const implDefault = findBunLiteralDefaultInScript(impl)
  if (implDefault) {
    violations.push(
      `${implPath}: default='${implDefault}' é um LITERAL de versão — a versão entra SÓ pelo argumento (fonte única ${BUN_VERSION_VAR} no workflow). Use \`VERSION="${"${1:-}"}"\` e deixe o workflow passar a variável.`,
    )
  }

  if (!hasScriptVersionArg(impl)) {
    violations.push(
      `${implPath}: não lê a versão do primeiro ARGUMENTO posicional — é o único caminho pelo qual a versão entra (a fonte única é resolvida no workflow e chega por aqui).`,
    )
  }

  if (!hasGhcrMirrorRef(impl)) {
    violations.push(
      `${implPath}: tier 3 (cold cache) não referencia o mirror OCI (<registry>/<owner>/bun:<versão>)`,
    )
  }

  if (!hasPreinstalledMarker(impl)) {
    violations.push(
      `${implPath}: sem o marcador tier-1 'Usando Bun pré-instalado:' — é o sinal que o guard periódico check:tier1-fastpath casa no log do act; sem ele o guard fica cego para a regressão do fast path.`,
    )
  }

  const literal = findBunLiteralInScript(impl)
  if (literal) {
    violations.push(
      `${implPath}: versão literal '${literal}' — a versão só pode vir do ARGUMENTO (fonte única ${BUN_VERSION_VAR}).`,
    )
  }

  return violations
}

// ── Invariantes 15/16: espelhos literais FORA dos workflows ─────────────────

/** Onde os espelhos literais são caçados fora dos workflows (scripts e hooks). */
export const SCRIPT_SCAN_DIRS = ["scripts", ".husky"]

/**
 * Um arquivo de SCRIPT do repositório — o alvo da invariante 15. `.husky/_/**`
 * fica de fora: é o runtime do próprio husky, não código nosso.
 */
export const SCRIPT_FILE_RE = /^(?:scripts\/[^/]+|\.husky\/[^/]+)$/

/** Um compose do repositório — o alvo da invariante 16 (raiz e `deploy/`). */
export const COMPOSE_FILE_RE = /^(?:docker-compose[^/]*\.ya?ml|deploy\/docker-compose[^/]*\.ya?ml)$/

/**
 * A definição de "alvo" desta varredura — UMA só, usada pela enumeração global
 * e pelo recorte `--staged`: duas listas divergiriam, e o modo do commit veria
 * um conjunto diferente do modo do PR.
 */
export function isSingleSourcePath(rel) {
  return SCRIPT_FILE_RE.test(rel) || COMPOSE_FILE_RE.test(rel)
}

/**
 * O pathspec (git) da varredura nova — o irmão de `FORGE_WORKFLOW_DIRS`.
 * Globs de propósito: um compose novo na raiz cai na varredura sem editar nada.
 */
export const SINGLE_SOURCE_PATHS = [
  ...SCRIPT_SCAN_DIRS,
  "docker-compose*.yml",
  "docker-compose*.yaml",
  "deploy/docker-compose*.yml",
  "deploy/docker-compose*.yaml",
]

/**
 * Um SEMVER COMPLETO — a forma que se confunde com a versão da vez.
 *
 * O lookahead NEGATIVO é o coração da regra: `9.9.9-sentinel` NÃO casa (o `-`
 * logo depois), então uma SENTINELA nunca é acusada. Sem ele o escape hatch
 * declarado para fixtures seria impossível — o guard estaria exigindo que uma
 * fixture cravasse justamente o número que se parece com a versão real, que é
 * o defeito. Com ele, a distinção é estrutural: `X.Y.Z` é uma AFIRMAÇÃO de
 * versão; `X.Y.Z-<sufixo>` é um valor falso que se declara falso.
 */
export const COMPLETE_SEMVER_RE = /(?<![\d.])\d+\.\d+\.\d+(?![\dA-Za-z_.-])/

/**
 * A versão PREFIXADA pelo nome do Bun — casa `bun-1.3.14` (cache key),
 * `bun@1.2.3` (`npm install -g bun@`), `bun-v1.3.14` (release do GitHub),
 * `oven/bun:1.3.14` (imagem oficial) e `<…>/ubuntu-bun:1.3.14` (a imagem do
 * runner — a TAG literal que este guard existe para impedir).
 */
export const BUN_PREFIXED_VERSION_RE = /\bbun[-@:/]v?\d+\.\d+\.\d+/

/**
 * "Esta linha fala do Bun?"
 *
 * NÃO é `/\bbun/i`: o `\b` não existe entre `_` e `B`, então `ACTRC_BUN` — um
 * dos nomes reais desta classe — ficaria de fora (medido: foi o que a primeira
 * versão desta função deixou passar). E não é `/bun/i` solto: `bundle` (que
 * aparece em `analyze-bundle.mjs`, `check-bundle-size.sh` e num monte de prosa)
 * viraria falso positivo a cada dependência de front com versão própria.
 * O negativo `(?!dle)` é o que separa "fala do Bun" de "fala de bundle".
 */
export const BUN_MENTION_RE = /(?:^|[^A-Za-z0-9])bun(?!dle)/i

/** O default de `BUN_VERSION` num compose: `${BUN_VERSION:-<valor>}`. */
export const COMPOSE_VERSION_DEFAULT_RE = /\$\{BUN_VERSION:-([^}]*)\}/

/** A forma de VARIÁVEL do compose (com ou sem default/erro), sem literal. */
export const COMPOSE_VERSION_VAR_RE = /\$\{BUN_VERSION(?::[-?+][^}]*)?\}/

/** O valor LITERAL puro de `BUN_VERSION:` num compose (sem `${...}`). */
export const COMPOSE_VERSION_LITERAL_RE = /BUN_VERSION\s*:\s*["']?([^"'\s#]+)/

/**
 * Comentário de script: `#`, `//`, bloco `/*` e a continuação `*` do JSDoc.
 *
 * A SINTAXE vem declarada na régua única (`isCommentLine(…, { slash: true })`) —
 * esta era a quinta cópia da mesma função, e a única diferença entre as cópias
 * era ACIDENTAL (uma sem `//`, outra sem `/#`).
 */
const isCommentOrDocLine = (line) => isCommentLine(line, { slash: true })

/**
 * Os arquivos da varredura nova, ordenados.
 *
 * A enumeração usa os MESMOS predicados que o modo `--staged`
 * (`isSingleSourcePath`), então o modo do commit e o modo do PR não podem
 * divergir sobre o que é um alvo.
 *
 * @param {string} [root]
 * @returns {string[]}
 */
export function singleSourceFiles(root = process.cwd()) {
  const out = []
  for (const dir of ["", ...SCRIPT_SCAN_DIRS]) {
    const abs = dir === "" ? root : join(root, dir)
    if (!existsSync(abs)) continue
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      if (!entry.isFile()) continue
      const rel = dir === "" ? entry.name : `${dir}/${entry.name}`
      if (isSingleSourcePath(rel)) out.push(rel)
    }
  }
  return out.sort()
}

/** O valor que os espelhos DECLARAM hoje (`.actrc` / o env da forja) — ou null. */
export function declaredBunVersion(root = process.cwd()) {
  const declared = readMirrorValues(root, BUN_MIRRORS)
  return declared.length > 0 ? declared[0].value : null
}

/**
 * A linha de um SCRIPT carrega um literal do Bun? (invariante 15)
 *
 * @param {string} line
 * @returns {{kind: string, hit: string}|null}
 */
export function findBunLiteralInLine(line) {
  if (isCommentOrDocLine(line)) return null
  const prefixed = line.match(BUN_PREFIXED_VERSION_RE)
  if (prefixed) return { kind: "prefixada pelo nome do Bun", hit: prefixed[0] }
  const semver = line.match(COMPLETE_SEMVER_RE)
  if (semver && BUN_MENTION_RE.test(line)) {
    return { kind: "emparelhada com o nome do Bun", hit: semver[0] }
  }
  return null
}

/**
 * A linha de um COMPOSE carrega um valor que não deriva? (invariante 16)
 *
 * @param {string} line
 * @param {string|null} declared  valor declarado nos espelhos
 * @returns {{kind: string, value: string}|null}
 */
export function findComposeVersionLiteral(line, declared) {
  if (isCommentOrDocLine(line)) return null
  if (!/BUN_VERSION/.test(line)) return null
  const def = line.match(COMPOSE_VERSION_DEFAULT_RE)
  if (def) {
    const value = def[1].trim()
    if (declared !== null && value === declared) return null
    return { kind: "default", value }
  }
  if (COMPOSE_VERSION_VAR_RE.test(line)) return null
  const lit = line.match(COMPOSE_VERSION_LITERAL_RE)
  return lit ? { kind: "literal", value: lit[1] } : null
}

/**
 * Invariante 15 — nenhum SCRIPT com espelho literal da versão/tag.
 *
 * @param {string} [root]
 * @returns {string[]} violações
 */
export function checkScriptLiterals(root = process.cwd()) {
  const violations = []
  for (const rel of singleSourceFiles(root)) {
    if (!SCRIPT_FILE_RE.test(rel)) continue
    const content = readFileSync(join(root, rel), "utf8")
    content.split(/\r?\n/).forEach((line, i) => {
      const hit = findBunLiteralInLine(line)
      if (!hit) return
      violations.push(
        `${rel}:${i + 1}: versão LITERAL do Bun ('${hit.hit}', ${hit.kind}) — a versão vive em ` +
          `${BUN_VERSION_VAR} e os scripts a resolvem dos espelhos declarados (${mirrorListText(BUN_MIRRORS)}). ` +
          `Um literal aqui ENVELHECE em silêncio: o script continua funcionando depois do bump, só ` +
          `rodando/medindo a versão antiga. Derive com o módulo scripts/bun-version.mjs; numa FIXTURE, ` +
          `use uma sentinela (ex.: 9.9.9-sentinel — não é uma afirmação de versão).`,
      )
    })
  }
  return violations
}

/**
 * Invariante 16 — nenhum COMPOSE com valor de BUN_VERSION que não derive.
 *
 * @param {string} [root]
 * @param {string|null} [declared]  default: o declarado nos espelhos
 * @returns {string[]} violações
 */
export function checkComposeVersionLiterals(
  root = process.cwd(),
  declared = declaredBunVersion(root),
) {
  const violations = []
  const alvo = declared ?? "<o valor declarado nos espelhos>"
  for (const rel of singleSourceFiles(root)) {
    if (!COMPOSE_FILE_RE.test(rel)) continue
    const content = readFileSync(join(root, rel), "utf8")
    content.split(/\r?\n/).forEach((line, i) => {
      const hit = findComposeVersionLiteral(line, declared)
      if (!hit) return
      violations.push(
        hit.kind === "literal"
          ? `${rel}:${i + 1}: BUN_VERSION com valor LITERAL '${hit.value}' — não é espelho, é um ` +
              `SEGUNDO valor: nenhum bump da variável o alcança e o build usa o Bun que ficou escrito ` +
              `ali. Use \`\${BUN_VERSION:-${alvo}}\` (o default é o que vale onde a variável não existe).`
          : `${rel}:${i + 1}: o default '${hit.value}' de BUN_VERSION diverge do declarado ` +
              `(${declared ?? "nenhum espelho declara a versão"}) em ${mirrorListText(BUN_MIRRORS)} — ` +
              `onde a variável não existe o default é o que RODA, então o build sai com outra versão ` +
              `sem nada acusar. Alinhe com o espelho (ou remova o default).`,
      )
    })
  }
  return violations
}

/**
 * As duas invariantes sobre as linhas ADICIONADAS de um diff — é na EDIÇÃO que
 * o literal nasce, então é aí que ele tem de ser barrado.
 *
 * @param {string} diffText
 * @param {string|null} [declared]
 * @returns {string[]} violações
 */
export function checkStagedSingleSourceLiterals(diffText, declared = declaredBunVersion()) {
  const violations = []
  for (const [file, lines] of parseDiffAddedLines(diffText, isSingleSourcePath)) {
    const isCompose = COMPOSE_FILE_RE.test(file)
    for (const { lineNo, content } of lines) {
      if (isCompose) {
        const hit = findComposeVersionLiteral(content, declared)
        if (hit) {
          violations.push(
            hit.kind === "literal"
              ? `${file}:${lineNo}: BUN_VERSION com valor LITERAL '${hit.value}' introduzido por este diff — use a variável (\`\${BUN_VERSION:-<declarado>}\`).`
              : `${file}:${lineNo}: default '${hit.value}' de BUN_VERSION introduzido por este diff, divergindo do declarado (${declared ?? "nenhum espelho"}).`,
          )
        }
      } else {
        const hit = findBunLiteralInLine(content)
        if (hit) {
          violations.push(
            `${file}:${lineNo}: versão LITERAL do Bun ('${hit.hit}') introduzida por este diff — ` +
              `derive (scripts/bun-version.mjs) ou use uma sentinela (9.9.9-sentinel).`,
          )
        }
      }
    }
  }
  return violations
}

function main() {
  const args = process.argv.slice(2)
  const staged = args.includes("--staged")
  const baseIdx = args.indexOf("--base")
  const base = baseIdx !== -1 ? args[baseIdx + 1] : null

  // ── Modo --staged: só o que o diff em questão INTRODUZ ──────────────
  // Local/pre-commit: git diff --cached (o que está staged). CI: o job
  // passa --base origin/main → git diff origin/main...HEAD. Só linhas
  // ADICIONADAS são avaliadas — violações pré-existentes do base não
  // poluem o PR, e uma key antiga introduzida pelo PR falha ANTES do
  // merge mesmo que o working tree global já esteja migrado.
  if (base && !staged) {
    console.error(
      `⚠️  --base ${base} sem --staged — o --base só tem efeito no modo --staged (diff base...HEAD). Rodando o scan global.`,
    )
  }

  if (staged) {
    const diffText = gitDiffWorkflows(base)
    const diffFonte = gitDiffSingleSource(base)
    if (diffText === null || diffFonte === null) {
      console.error(
        `❌ Modo --staged: git diff indisponível` +
          (base ? ` (base ${base})` : ` (nada staged? rode 'git add' primeiro)`),
      )
      process.exit(2)
    }
    const violations = [
      ...checkStagedCacheKeys(diffText, DEFAULT_CACHE_KEY_RULES()),
      ...checkStagedLiterals(diffText),
      ...checkStagedSetupBunCallSites(diffText),
      ...checkStagedRemovedSetupBunCall(diffText),
      ...checkStagedCachePaths(diffText, DEFAULT_CACHE_KEY_RULES()),
      ...checkStagedRemovedCacheBlockFields(diffText),
      ...checkStagedRemovedLiterals(diffText),
      // Invariantes 15/16: a MESMA varredura, agora sobre os scripts e os
      // composes que o diff toca — é na EDIÇÃO que o literal nasce.
      ...checkStagedSingleSourceLiterals(diffFonte),
    ]
    if (violations.length > 0) {
      console.error(
        `❌ Diff com ${violations.length} violação(ões) de cache key/literal/chamada do setup/remoção da chamada/remoção de path-key/par key↔path do Bun:\n`,
      )
      for (const v of violations) console.error(`   - ${v}`)
      console.error(
        `\n   Cache keys, literais, chamadas do setup e pares key↔path introduzidos por este diff` +
          `\n   precisam usar a fonte única ${BUN_VERSION_VAR} — um literal` +
          `\n   (bun-X.Y.Z-...) não seria invalidado pela troca da variável, e um` +
          `\n   path de outra toolchain (ex.: node_modules/.prisma com key bun-...)` +
          `\n   quebraria o cache. E REMOVER a chamada do setup de um job é` +
          `\n   regressão — o job ficaria sem Bun.`,
      )
      process.exit(1)
    }
    console.log(
      `✅ Diff ok — nenhuma cache key/literal/chamada do setup/remoção da chamada/par key↔path do Bun introduzido` +
        (base ? ` (vs base ${base})` : ` (staged)`),
    )
    process.exit(0)
  }

  // ── Modo padrão: invariantes globais do repositório ─────────────────
  const cwd = process.cwd()
  const violations = validateMirror(
    join(cwd, ".github", "workflows", "sync-bun-mirror.yml"),
    join(cwd, SETUP_BUN_SCRIPT),
    join(cwd, "Dockerfile.bun-mirror"),
  )

  // Os invariantes globais rodam em TODAS as forjas. As funções puras rotulam
  // a violação com o BASENAME do workflow (contrato já testado); aqui o rótulo
  // é prefixado com o diretório da forja para que o diagnóstico diga em qual
  // pipeline a fonte única foi violada — foi essa ausência que deixou
  // `BUN_VERSION: "1.4.0"` literal viver na pipeline dona do merge.
  // Um workflow de forja que não abre NÃO vira "nenhuma violação": a varredura
  // aqui é a COMPARTILHADA (fonte única) e roda ANTES de qualquer veredito — o
  // arquivo sai NOMEADO e o guard para com 2. Sem esta porta, o
  // `readFileSync` cru dos checks abaixo estourava com stack trace (exit 1,
  // "violação") e o autor ia caçar literal de Bun onde o problema era leitura.
  exitOnUnjudgeable(readWorkflowScan(cwd).unjudgeable)
  for (const dir of existingWorkflowDirs(cwd)) {
    const workflowsDir = join(cwd, dir)
    const names = workflowFileNames(cwd, dir)
    const label = (v) => {
      for (const n of names) if (v.startsWith(`${n}:`)) return `${dir}/${v}`
      return v
    }
    violations.push(...checkCacheKeys(workflowsDir, DEFAULT_CACHE_KEY_RULES()).map(label))
    violations.push(...checkCachePaths(workflowsDir, DEFAULT_CACHE_KEY_RULES()).map(label))
    violations.push(...checkNoLiteralBunVersion(workflowsDir).map(label))
    violations.push(...checkSetupBunCallSites(workflowsDir).map(label))
  }
  violations.push(...checkActrc(join(cwd, ".actrc")))

  // ── Forja: a imagem dos jobs embarca o Bun da variable? ──────────────
  // A label do runner é a diferença entre o tier-1 de 0s e o download do
  // tier 3 em TODO job — e o sintoma é invisível (o setup funciona nos dois
  // casos). Só roda quando os dois arquivos existem (repo sem a forja não é
  // violação).
  const composePath = join(cwd, GITEA_COMPOSE)
  const envMirrorPath = join(cwd, GITEA_ENV_MIRROR)
  if (existsSync(composePath) && existsSync(envMirrorPath)) {
    violations.push(
      ...checkGiteaRunnerImage(
        readFileSync(composePath, "utf8"),
        readFileSync(envMirrorPath, "utf8"),
      ),
    )
    // ── Forja: a imagem é PRÉ-REQUISITO da subida da stack? ─────────
    // A label do runner aponta para uma imagem que pode não existir. O
    // bring-up (gitea-up.sh) tem de garantir a tag ANTES do `up -d runner`
    // — e o instalador tem de mandar o usuário por esse caminho.
    const bringUpPath = join(cwd, GITEA_BRING_UP)
    const setupPath = join(cwd, GITEA_SETUP)
    violations.push(
      ...checkGiteaBringUp(
        existsSync(bringUpPath) ? readFileSync(bringUpPath, "utf8") : "",
        existsSync(setupPath) ? readFileSync(setupPath, "utf8") : undefined,
      ),
    )
    // ── Forja: o ciclo bring-up → doctor → prova tem CORTE? ──────────
    // O bring-up roda o doctor inteiro (a regra acima); quem impede a cadeia de
    // crescer é a dublagem que a prova faz do doctor. É o único modo de falha
    // deste desenho sem sintoma antes de ser catastrófico.
    const proofPath = join(cwd, PROOF_SCRIPT)
    violations.push(
      ...checkDoctorCycleCut(existsSync(proofPath) ? readFileSync(proofPath, "utf8") : ""),
    )
    // ── Forja: o RE-REGISTRO também é um caminho garantido? ──────────
    // Trocar a label é justamente quando a tag pode faltar; o runbook não
    // pode ensinar uma sequência crua que pule a garantia.
    const docPath = join(cwd, GITEA_DOC)
    violations.push(
      ...checkReRegisterPath(
        existsSync(bringUpPath) ? readFileSync(bringUpPath, "utf8") : "",
        existsSync(docPath) ? readFileSync(docPath, "utf8") : "",
      ),
    )
  }

  // ── Espelhos da variável: quem compara e quem escreve ────────────────
  // Os espelhos têm dois donos em DOIS arquivos (o bump .sh escreve, o guard
  // semanal .mjs compara). Se um lado ganhar um espelho que o outro não tem, a
  // assimetria é silenciosa: aviso permanente ou valor nunca conferido.
  {
    const bumpPath = join(cwd, BUN_BUMP_SCRIPT)
    const syncPath = join(cwd, ACTRC_SYNC_SCRIPT)
    if (existsSync(syncPath)) {
      violations.push(
        ...checkMirrorWriters(
          existsSync(bumpPath) ? readFileSync(bumpPath, "utf8") : "",
          readFileSync(syncPath, "utf8"),
        ),
      )
    }
  }
  violations.push(...checkDockerfiles(cwd))
  violations.push(...checkNoForeignLockfiles(cwd))

  // ── Invariantes 15/16: os espelhos literais FORA dos workflows ────────
  // O defeito que estas duas caçam não aparece em nenhum diff de workflow:
  // o script/compose continua FUNCIONANDO com a versão antiga, então nada
  // fica vermelho — só o comportamento fica velho.
  const alvos = singleSourceFiles(cwd)
  violations.push(...checkScriptLiterals(cwd))
  violations.push(...checkComposeVersionLiterals(cwd))

  if (violations.length > 0) {
    console.error(`❌ Fonte única do Bun com ${violations.length} violação(ões):\n`)
    for (const v of violations) console.error(`   - ${v}`)
    console.error(
      `\n   A versão do Bun vive APENAS na repository variable vars.BUN_VERSION` +
        `\n   (Settings → Secrets and variables → Actions). O setup é um script` +
        `\n   chamado por 'run:' que recebe a versão como argumento` +
        `\n   ('bash ${SETUP_BUN_SCRIPT} "${BUN_VERSION_VAR}"'), o mirror usa a` +
        `\n   mesma variável e o cache key inclui a variável. Sem literais em` +
        `\n   lugar nenhum — trocar o Bun = alterar a variável em UM lugar. E o` +
        `\n   par key↔path de cada bloco actions/cache precisa fechar.`,
    )
    process.exit(1)
  }

  console.log(`✅ Fonte única do Bun ok (BUN_VERSION=${BUN_VERSION_VAR}).`)
  const nScripts = alvos.filter((f) => SCRIPT_FILE_RE.test(f)).length
  const nComposes = alvos.filter((f) => COMPOSE_FILE_RE.test(f)).length
  console.log(
    `   ${nScripts} script(s) e ${nComposes} compose(s) varridos — nenhum literal ` +
      `da versão do Bun nem da tag da imagem do runner (o valor declarado é ` +
      `${declaredBunVersion(cwd) ?? "<nenhum espelho>"}).`,
  )
  process.exit(0)
}

// True apenas quando executado diretamente (node ...) — permite importar as
// funções puras em testes unitários sem disparar o scan.
const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (IS_DIRECT_RUN) main()
