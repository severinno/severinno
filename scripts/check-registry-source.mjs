#!/usr/bin/env node

// =============================================================================
// check-registry-source.mjs
//
// Guard da FONTE ÚNICA do registry OCI (imagens da aplicacao + mirrors de
// toolchain: bun, ubuntu-bun, postgis).
//
// POR QUE: as imagens eram referenciadas com o host HARDCODED (`ghcr.io/...`)
// em compose, workflows e no composite action do Bun. Isso acoplava o projeto
// ao GHCR — registry proprietario, com cota de armazenamento/egress no plano
// free — e transformava "trocar de registry" numa cacada em ~85 referencias.
// A fonte unica agora e `IMAGE_REGISTRY`:
//   - workflows (GitHub/Gitea): repository variable, `${{ vars.IMAGE_REGISTRY }}`
//   - compose (VPS):            `${IMAGE_REGISTRY:-ghcr.io}` do .env.production
//   - act local:                `--var IMAGE_REGISTRY=...` no .actrc
//   - Woodpecker:               secret `image_registry`
//
// REGRA: `ghcr.io` so pode aparecer como DEFAULT de IMAGE_REGISTRY — isto e,
// na mesma linha da variavel. Qualquer `ghcr.io` solto e regressao: volta a
// fixar o projeto no GHCR e quebra o flip de uma variavel.
//
// Invariantes:
//   1. Nenhum `ghcr.io` fora da forma de default da variavel (compose,
//      workflows, composite actions, woodpecker, setup scripts).
//   2. Imagens de TERCEIROS consumidas do GHCR vivem em
//      THIRD_PARTY_ALLOWLIST (explicitamente, uma por uma).
//   3. O .actrc define `--var IMAGE_REGISTRY=...` (espelho local do act — o
//      act nao le as variables do repositorio sem --var).
//   4. Todo `image:` de compose cujo path e nosso referencia `${IMAGE_REGISTRY`.
//   5. COMENTARIO (linha inteira e inline) e ignorado: e onde a documentacao
//      explica o default. O guard protege o codigo que resolve o registry,
//      nao a prosa — um guard que reclamasse da propria documentacao da
//      invariante seria desligado pela equipe.
//   6. Em `deploy/` (config de deploy da forja), referencia NOSSA de imagem
//      com TAG LITERAL (`ubuntu-bun:1.3.14`, `:latest`) e violacao: a tag tem
//      de vir da variavel (a MESMA que o resto do repo usa — BUN_VERSION).
//      Por que SO em deploy/: e o arquivo que o compose do VPS resolve para
//      decidir QUAL imagem roda TODOS os jobs; um literal ali e um segundo
//      ponto de verdade para a versao, e o sintoma aparece longe da causa
//      (jobs morrendo ao iniciar o container, ou rodando Bun de outra
//      versao). Nos composes de aplicacao a tag da imagem NOSSA segue o
//      default do compose (`:latest`) — invariante 4, nao esta.
//   7. A INVARIANTE 6 e estatica: ela prova que a linha REFERENCIA a variavel,
//      nao o que a interpolacao RESOLVE. Por isso o gate renderiza o compose
//      com o proprio docker (`docker compose config --format json`) em tres
//      fases controladas (declarado / sentinela / versao ausente) e falha se
//      alguma variavel ficar VAZIA ou se o registry/tag resolver para um
//      LITERAL. Sem o docker no ambiente, o passo fica INDETERMINADO (avisa,
//      nao falha) — ver a secao "INVARIANTE 7" mais abaixo.
//   8. O escopo declarado (SCAN_TARGETS) e cego em diretorio NOVO. Todo arquivo
//      FORA dele que referencie imagem NOSSA exige DECISAO ESCRITA
//      (OUT_OF_SCOPE_ALLOWLIST, um arquivo por entrada, com o motivo); nao
//      decidir e violacao, e decisao velha tambem — ver "INVARIANTE 8".
//
// Usage:
//   node scripts/check-registry-source.mjs
//   node scripts/check-registry-source.mjs --no-compose-render   # so a varredura estatica
//   node scripts/check-registry-source.mjs --require-compose     # o render e OBRIGATORIO (job da forja)
//
// --require-compose: por padrao, "nao consegui renderizar" e INDETERMINADO —
// avisa e sai 0, para o gate nao ficar vermelho numa maquina sem docker (um gate
// assim e desligado pela equipe). Mas ha UM lugar onde o render nao e opcional:
// o job da FORJA, cuja imagem embarca o plugin `compose` (e isso e contrato do
// Dockerfile.ubuntu-bun, verificado no build). Ali, "nao provei" nao pode sair
// verde: sem a flag, a invariante 7 degradaria para um `::warning::` dentro de
// um job verde — exatamente a classe de falha que o resto deste repositorio
// persegue. Com a flag, so `proven` passa; `unavailable`/`absent`/`skipped`
// falham, e a mensagem diz o que fazer. Onde o plugin nao esta garantido (dev,
// GitHub, pre-commit), a flag NAO e usada — a portabilidade do gate continua.
//
// Exit codes:
//   0 — fonte unica respeitada (e, quando ha docker, composicao provada)
//   1 — referencia hardcoded, espelho local ausente, compose sem a variavel,
//       TAG LITERAL na imagem nossa em `deploy/` (invariante 6), interpolacao
//       com variavel vazia / valor literal (invariante 7), alvo FORA do
//       escopo sem decisao escrita / com decisao velha (invariante 8), ou
//       --require-compose sem o render provado (inclui as flags contraditorias)
// =============================================================================

import { spawnSync } from "node:child_process"
import {
  readFileSync,
  existsSync,
  readdirSync,
  statSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { basename, join, relative } from "node:path"
import { tmpdir } from "node:os"

import { FORGE_ACTIONS_DIRS, FORGE_WORKFLOW_DIRS } from "./forge-workflows.mjs"
import { GITEA_COMPOSE } from "./check-bun-mirror.mjs"
import {
  GITEA_ENV_DEPLOYED,
  GITEA_ENV_MIRROR,
  discoverEnvMirrors,
  extractEnvMirrorBunVersion,
} from "./check-actrc-sync.mjs"

const ROOT = process.cwd()

/**
 * Imagens de TERCEIROS que consumimos do GHCR de proposito. Cada entrada e um
 * prefixo de repositorio (sem tag). Adicionar aqui e uma decisao consciente:
 * significa "esta imagem nao e nossa e nao segue o IMAGE_REGISTRY".
 */
export const THIRD_PARTY_ALLOWLIST = [
  // OSRM (roteamento) — imagem comunitaria, sem espelho proprio.
  "ghcr.io/project-osrm/osrm-backend",
]

/**
 * Alvos varridos: os SITES DE RESOLUCAO do registry (onde o host e escolhido e
 * o deploy/imagem nasce). Sao todos YAML, onde comentario e inequivoco
 * (linha iniciada por `#`) — por isso o guard consegue ignorar prosa sem
 * falso positivo.
 *
 * Escopo CONSCIENTE: `scripts/*.mjs` ficam FORA. Neles a mesma string aparece
 * dentro de comentarios E de template strings de mensagem de erro ("imagem
 * ghcr.io/<owner>/ubuntu-bun nao publicada?"), e distinguir prosa de codigo
 * linha a linha exige heuristica — um guard com falso positivo e desligado
 * pela equipe, o que e pior que um guard com escopo declarado. O caminho de
 * CODIGO real dos scripts honra `process.env.IMAGE_REGISTRY` (ver
 * bench-setup-bun.mjs) e o que resolve o host para o deploy/pull esta aqui.
 */
export const SCAN_TARGETS = [
  { dir: ".", match: /^docker-compose.*\.ya?ml$/ },
  // Config de deploy da forja (`deploy/docker-compose.gitea.yml` e afins). O
  // alvo importa porque e AQUI que a imagem do runner e escolhida: um literal
  // neste arquivo nao quebra o repositorio — quebra a subida da stack no VPS
  // (ver invariante 6 e o comando `scripts/ensure-runner-image.mjs`).
  { dir: "deploy", match: /\.ya?ml$/ },
  // Uma entrada por FORJA, vindas da fonte unica (scripts/forge-workflows.mjs)
  // — cravar os diretorios aqui deixaria a forja DONA DO MERGE fora da
  // varredura sem que nada acusasse.
  ...FORGE_WORKFLOW_DIRS.map((dir) => ({ dir, match: /\.ya?ml$/ })),
  // Uma entrada por DIRETORIO de actions locais (nao so o indice 0): se uma
  // action local nascer em `.gitea/actions`, ela cai sob a mesma invariante —
  // o espelho do GitHub e a forja compartilham o `action.yml` que puxa imagem.
  ...FORGE_ACTIONS_DIRS.map((dir) => ({ dir, match: /^action\.ya?ml$/, recursive: true })),
  { dir: ".woodpecker.yml", match: /.*/ },
]

/**
 * Uma linha e comentario quando seu conteudo (trim) comeca com `#`. Linhas
 * comentadas sao ignoradas: e onde a documentacao explica o default do
 * registry, e um guard que reclamasse de prosa bloquearia a propria
 * documentacao da invariante.
 *
 * @param {string} line
 * @returns {boolean}
 */
export function isCommentLine(line) {
  return line.trim().startsWith("#")
}

/**
 * Remove comentario INLINE de YAML (`key: valor # prosa`) — em YAML o `#` so
 * inicia comentario precedido de espaco (ou no inicio da linha). Sem isso, uma
 * anotacao como `packages: read # pull da imagem privada ghcr.io/<owner>/...`
 * seria lida como referencia de codigo (foi exatamente o caso real que este
 * guard encontrou).
 *
 * @param {string} line
 * @returns {string} a linha sem a parte comentada
 */
export function stripInlineComment(line) {
  return line.replace(/(^|\s)#.*$/, "$1").trimEnd()
}

/**
 * A linha usa o registry pela variavel (default embutido)? As duas formas
 * canonicas contem `IMAGE_REGISTRY` e `ghcr.io` na MESMA linha:
 *   `${{ vars.IMAGE_REGISTRY || 'ghcr.io' }}`   (workflows)
 *   `${IMAGE_REGISTRY:-ghcr.io}`                (compose / shell)
 * Uma linha sem `IMAGE_REGISTRY` que cite `ghcr.io` esta fixando o registry.
 *
 * @param {string} line
 * @returns {boolean}
 */
export function isRegistryVariableForm(line) {
  return /IMAGE_REGISTRY/.test(line)
}

/**
 * A referencia `ghcr.io/...` da linha esta na allowlist de terceiros?
 *
 * @param {string} line
 * @returns {boolean}
 */
export function isAllowlistedThirdParty(line) {
  return THIRD_PARTY_ALLOWLIST.some((prefix) => line.includes(prefix))
}

/**
 * Valida UMA linha quanto a invariante 1/2 (nenhum `ghcr.io` hardcoded).
 * Retorna a mensagem de violacao, ou null quando a linha esta correta.
 *
 * @param {string} file   caminho relativo (para a mensagem)
 * @param {number} lineNo 1-indexado
 * @param {string} line
 * @returns {string|null}
 */
export function checkRegistryLine(file, lineNo, line) {
  if (isCommentLine(line)) return null
  const code = stripInlineComment(line)
  if (!code.includes("ghcr.io")) return null
  if (isRegistryVariableForm(code)) return null
  if (isAllowlistedThirdParty(code)) return null
  return `${file}:${lineNo}: 'ghcr.io' hardcoded — use a fonte unica IMAGE_REGISTRY (compose: \`\${IMAGE_REGISTRY:-ghcr.io}\`; workflow: \`\${{ vars.IMAGE_REGISTRY || 'ghcr.io' }}\`). Se for uma imagem de TERCEIROS consumida do GHCR de proposito, adicione ao THIRD_PARTY_ALLOWLIST deste guard.`
}

/**
 * O arquivo e um COMPOSE (independente do diretorio)? A invariante 4 fala de
 * `image:` de compose, e o compose da forja vive em `deploy/` — decidir pelo
 * BASENAME cobre `docker-compose.prod.yml`, `deploy/docker-compose.gitea.yml` e
 * `deploy/woodpecker-compose.yml` sem uma lista de caminhos que envelhece.
 *
 * @param {string} file  caminho relativo
 * @returns {boolean}
 */
export function isComposeFile(file) {
  // O segmento `compose` antes da extensao, em QUALQUER diretorio:
  // `docker-compose.yml`, `docker-compose.prod.yml`,
  // `deploy/docker-compose.gitea.yml`, `deploy/woodpecker-compose.yml`.
  // (Ancorar no inicio deixava o compose da forja de fora: o nome dele NAO
  // comeca com `docker-compose`.)
  return /(?:^|[-.])compose(?:[-.][\w.-]+)?\.ya?ml$/i.test(basename(file))
}

/**
 * Diretorio de deploy da forja — onde a invariante 6 (proibido tag literal)
 * vale. Constante e nao string solta para o teste poder afirmar o escopo.
 */
export const DEPLOY_DIR = "deploy"

/**
 * Invariante 6: em `deploy/`, uma referencia NOSSA de imagem com TAG LITERAL.
 *
 * POR QUE: a tag da imagem do runner e uma VARIAVEL (BUN_VERSION) — o label do
 * runner, o smoke (Prova 3) e o guard `checkGiteaRunnerImage` giram em torno
 * disso. Um literal aqui cria um segundo ponto de verdade: a troca da variavel
 * nao invalidaria a imagem, e o runner passaria a rodar uma imagem que nao
 * corresponde a versao declarada (com o fast path do setup silenciosamente
 * desligado — o setup funciona dos dois jeitos, so muda a velocidade).
 *
 * Como distingue tag de caminho: as VARIAVEIS sao removidas primeiro (o
 * `${IMAGE_REGISTRY:-ghcr.io}` tem um `:` interno, e `${IMAGE_NAMESPACE:-...}`
 * tambem), e so entao se procura `/<nome>:<algo>`. Sem remover as variaveis,
 * todo default embutido pareceria uma tag.
 *
 * Escopo: SO faz sentido para linha que resolve o registry pela variavel (a
 * imagem e NOSSA) — uma imagem de terceiros nao segue a convencao do repo.
 *
 * @param {string} file
 * @param {number} lineNo
 * @param {string} line
 * @returns {string|null}
 */
export function checkLiteralImageTag(file, lineNo, line) {
  if (isCommentLine(line)) return null
  const code = stripInlineComment(line)
  if (!isRegistryVariableForm(code)) return null
  if (isAllowlistedThirdParty(code)) return null
  const withoutVars = code.replace(/\$\{\{[^}]*\}\}/g, "\u0000").replace(/\$\{[^}]*\}/g, "\u0000")
  const m = withoutVars.match(/\/([A-Za-z0-9][A-Za-z0-9._-]*):([A-Za-z0-9][A-Za-z0-9._-]*)/)
  if (!m) return null
  return (
    `${file}:${lineNo}: TAG LITERAL '${m[1]}:${m[2]}' na imagem nossa — ` +
    "em deploy/ a tag tem de vir da variavel (ex.: `ubuntu-bun:${BUN_VERSION}`), " +
    "senao a troca da versao nao invalida a imagem e o runner roda outra versao (tier-1 desligado em silencio)."
  )
}

/**
 * Invariante 4: todo `image:` de compose cujo path e o NOSSO precisa vir da
 * variavel. Pega o caso em que alguem mantem o caminho mas troca o host por
 * outro literal (`quay.io/severinno/...`, `git.severinno.cloud` cravado).
 */
export function checkComposeImageLine(file, lineNo, line) {
  if (!/^\s*image:\s*\S/.test(line)) return null
  if (!/\/severinno\//.test(line) && !/\$\{IMAGE_NAMESPACE/.test(line)) return null
  if (line.includes("${IMAGE_REGISTRY")) return null
  return `${file}:${lineNo}: imagem nossa sem IMAGE_REGISTRY — use \`\${IMAGE_REGISTRY:-ghcr.io}/\${IMAGE_NAMESPACE:-severinno}/...\` (trocar de registry deve ser UMA variavel, nao uma cacada).`
}

/**
 * Invariante 3: o `.actrc` precisa espelhar a variavel (o act nao le as
 * variables do repositorio sem `--var`). Sem a linha, o act local resolve a
 * variavel como string vazia e para de exercitar o caminho do registry.
 *
 * @param {string} content
 * @returns {string|null}
 */
export function checkActrc(content) {
  for (const line of content.split(/\r?\n/)) {
    if (isCommentLine(line)) continue
    if (/^--var\s+IMAGE_REGISTRY\s*=\s*\S/.test(line.trim())) return null
  }
  return ".actrc: falta `--var IMAGE_REGISTRY=<host>` — o espelho local do act precisa da variavel (o act nao le as variables do repositorio sem --var)"
}

// ═══════════════════════════════════════════════════════════════════════════
// INVARIANTE 8 — alvo FORA do escopo exige DECISAO ESCRITA
// ═══════════════════════════════════════════════════════════════════════════
//
// O PROBLEMA (e ele e estrutural, nao hipotetico): o escopo declarado em
// SCAN_TARGETS e bom — YAML, onde comentario e inequivoco —, e por isso mesmo
// ele e CEGO em qualquer diretorio novo. Um arquivo que monte uma imagem NOSSA
// num diretorio nao varrido fica invisivel ate alguem lembrar dele: o guard
// passa verde e ninguem sabe que existe um alvo ali.
//
// Foi assim que este guard deixou passar, por tempo indeterminado, um
// `ghcr.io/severinno/ubuntu-bun:$ACTRC_BUN` CRAVADO em codigo (o harness de
// benchmark do act, em `scripts/` — que o escopo exclui de proposito, por causa
// da prosa das mensagens de erro). O literal so apareceu quando a decisao
// passou a ser exigida.
//
// A REGRA: todo arquivo FORA do escopo que referencie uma imagem NOSSA precisa
// de uma linha em OUT_OF_SCOPE_ALLOWLIST com o MOTIVO escrito. Nao decidir e
// violacao. Decisao velha (o arquivo deixou de referenciar a imagem, ou sumiu)
// TAMBEM e violacao — senao a lista envelhece escondendo arquivos que sairam de
// cena, exatamente o defeito que o `check:forge-parity` descreve na
// classificacao GITHUB_ONLY.
//
// Exclusoes por REGRA (com razao escrita), e nao por lista de arquivo: prosa e
// fixture de teste. As duas tem o mesmo traco — a string da imagem NAO e um
// site de resolucao. Uma entrada por arquivo de teste viraria uma lista que
// envelhece a cada teste novo, e um guard que reclama de fixture acaba
// desligado pela equipe (o mesmo motivo pelo qual `scripts/*.mjs` saem do
// escopo estrito).

/**
 * Diretorios NUNCA varridos pela decisao: artefato gerado/vendor, nao fonte
 * versionada. Lista de diretorios (e nao padrao de caminho) de proposito: um
 * padrao amplo demais esconderia um diretorio de fonte legitimo.
 */
export const SWEEP_IGNORED_DIRS = [
  "node_modules",
  ".git",
  ".next",
  ".turbo",
  ".swc",
  "dist",
  "build",
  "out",
  "coverage",
  "tool-results",
  "playwright-report",
  "test-results",
  ".vercel",
  ".freebuff",
  "backups",
  "logs",
]

/**
 * Classes de arquivo excluidas da decisao POR REGRA — cada uma com a razao
 * escrita. O criterio: a string da imagem ali nao RESOLVE imagem nenhuma.
 */
export const SWEEP_RULES = [
  {
    id: "prose",
    matches: (rel) => /\.(md|mdx|txt|log|snap)$/i.test(rel),
    reason:
      "documentacao/prosa: um `ghcr.io/...` num README e EXEMPLO, nao configuracao — e e justamente onde a invariante e explicada",
  },
  {
    id: "test-fixture",
    matches: (rel) =>
      /(^|\/)(__tests__|__mocks__|fixtures)\//.test(rel) ||
      /\.(test|spec)\.[cm]?[jt]sx?$/.test(rel) ||
      /^e2e\//.test(rel) ||
      /^tests\//.test(rel),
    reason:
      "fixture de teste: a string da imagem e o SUJEITO da assercao (o teste existe para afirmar sobre ela), nao um site de resolucao",
  },
]

/**
 * Arquivos FORA do escopo que referenciam imagem nossa e por isso carregam uma
 * DECISAO ESCRITA. Uma entrada por arquivo (nunca um prefixo de diretorio:
 * um glob esconderia o proximo alvo no mesmo diretorio).
 *
 * Se o arquivo deixar de referenciar a imagem, a entrada tem de SAIR — entrada
 * ociosa e violacao (ver `checkOutOfScopeTargets`).
 */
export const OUT_OF_SCOPE_ALLOWLIST = [
  {
    path: "scripts/check-registry-source.mjs",
    reason:
      "e ESTE guard: o arquivo contem o proprio matcher (`imageRefsIn`) e a prosa que explica o defeito que a invariante 8 fechou (o literal que vivia em scripts/). Nao e um site de resolucao — e onde a forma da referencia e DEFINIDA. Fica aqui para o guard nao se dar uma isencao implicita: ele passa pela mesma regra que exige dos outros",
  },
]

/**
 * A referencia da linha casa uma IMAGEM NOSSA?
 *
 * O marcador exige NAMESPACE + TAG/digest (`<host>/severinno/<imagem>:<tag>`),
 * e nao apenas `/severinno/`: sem a tag, o mesmo texto aparece em CAMINHO de
 * arquivo (`/home/severinno/severinno/scripts/...`), URL de repositorio
 * (`github.com/severinno/severinno`) e ate assercao de UI — e a varredura
 * viraria uma lista de falsos positivos, que e o pior estado possivel para um
 * guard (falso positivo é desligado pela equipe).
 */
export function imageRefsIn(content) {
  const re = /\/severinno\/[A-Za-z0-9._-]+:(?:[A-Za-z0-9._-]+|\$\{?[A-Za-z_]|\$[A-Za-z_])/g
  const refs = new Set()
  for (const line of String(content ?? "").split(/\r?\n/)) {
    for (const m of line.matchAll(re)) refs.add(m[0])
  }
  return [...refs]
}

/**
 * O caminho RELATIVO esta coberto pelo escopo declarado (SCAN_TARGETS)?
 *
 * Reproduz a mesma regra de `collectFiles`, mas a partir do caminho — e o que
 * permite perguntar "este arquivo esta em escopo?" sem varrer o diretorio.
 *
 * @param {string} relPath
 * @param {string} root
 * @returns {boolean}
 */
export function matchesScanTarget(relPath, root = ROOT) {
  for (const target of SCAN_TARGETS) {
    const full = join(root, target.dir)
    if (!existsSync(full)) continue
    // Alvo que e um ARQUIVO (ex.: `.woodpecker.yml`).
    if (statSync(full).isFile()) {
      if (relPath === target.dir) return true
      continue
    }
    if (target.dir === ".") {
      // Raiz: so o primeiro nivel, como em collectFiles.
      if (!relPath.includes("/") && target.match.test(relPath)) return true
      continue
    }
    if (!relPath.startsWith(`${target.dir}/`)) continue
    const rest = relPath.slice(target.dir.length + 1)
    if (target.recursive) {
      // Um nivel de subdiretorio, e o nome do arquivo casa o padrao.
      const parts = rest.split("/")
      if (parts.length !== 2) continue
      if (target.match.test(parts[1])) return true
      continue
    }
    if (rest.includes("/")) continue
    if (target.match.test(rest)) return true
  }
  return false
}

/**
 * Remove do conjunto os caminhos que o git IGNORA.
 *
 * Fail-open consciente: se o git nao estiver disponivel, ou o root nao for um
 * repositorio (exit 128), ou nada estiver ignorado (exit 1), a lista volta
 * intacta — a varredura continua valendo, e o custo de um eventual falso
 * positivo e menor que o de um alvo invisivel.
 *
 * @param {string[]} paths  caminhos relativos
 * @param {string} root
 * @returns {string[]}
 */
export function withoutGitIgnored(paths, root = ROOT) {
  if (paths.length === 0) return paths
  const res = spawnSync("git", ["check-ignore", "-z", "--stdin"], {
    cwd: root,
    input: paths.join("\0"),
    encoding: "utf8",
    timeout: 10_000,
  })
  if (res.error || res.status !== 0 || !res.stdout) return paths
  const ignored = new Set(res.stdout.split("\0").filter(Boolean))
  return paths.filter((rel) => !ignored.has(rel))
}

/** Todos os arquivos versionados do repo (sem os diretorios ignorados). */
function walkRepo(root) {
  const out = []
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (SWEEP_IGNORED_DIRS.includes(entry.name)) continue
        visit(full)
        continue
      }
      if (!entry.isFile()) continue
      out.push(relative(root, full))
    }
  }
  visit(root)
  return out
}

/**
 * Alvos FORA do escopo que referenciam imagem nossa: o que foi decidido, o que
 * nao foi, e as decisoes que envelheceram.
 *
 * A allowlist e PARAMETRO (com o default sendo a do repo) para o teste exercitar
 * as tres situacoes — decidido, nao decidido, decisao velha — sem tocar na
 * constante do guard.
 *
 * @param {string} root
 * @param {{allowlist?: {path: string, reason: string}[]}} [options]
 * @returns {{found: Map<string, string>, undecided: string[], stale: string[]}}
 */
export function sweepOutOfScope(root = ROOT, { allowlist = OUT_OF_SCOPE_ALLOWLIST } = {}) {
  const decided = new Map(allowlist.map((e) => [e.path, e.reason]))
  const found = new Map()

  for (const rel of walkRepo(root)) {
    if (matchesScanTarget(rel, root)) continue
    if (SWEEP_RULES.some((rule) => rule.matches(rel))) continue
    let content
    try {
      content = readFileSync(join(root, rel), "utf8")
    } catch {
      continue
    }
    // Binario/artefato: nao e fonte. (A string da imagem nao mora num blob.)
    if (content.includes("\u0000")) continue
    const refs = imageRefsIn(content)
    if (refs.length > 0) found.set(rel, refs[0])
  }

  // Arquivos IGNORADOS pelo git saem da conta: a decisao descreve o que e
  // VERSIONADO. Um `.env` local com a imagem cravada e assunto de quem tem o
  // arquivo — exigir uma entrada no repositorio para ele seria um falso
  // positivo que so aparece na maquina do dev, e falso positivo e o caminho
  // mais curto para o guard ser desligado.
  const kept = new Set(withoutGitIgnored([...found.keys()], root))
  for (const rel of [...found.keys()]) {
    if (!kept.has(rel)) found.delete(rel)
  }

  return {
    found,
    undecided: [...found.keys()].filter((rel) => !decided.has(rel)).sort(),
    // Decisao VELHA: o arquivo EXISTE e nao referencia mais imagem nossa.
    //
    // O `existsSync` no filtro tem razao de ser: a allowlist descreve ESTE
    // repositorio, e `sweepOutOfScope`/`findViolations` aceitam qualquer raiz
    // (os testes CLI rodam em arvore sintetica, sem `scripts/`). Sem ele, toda
    // arvore de teste acusaria as decisoes do repo como "velhas" — falso
    // positivo em serie, que e o defeito que os testes de CLI pegaram aqui.
    stale: allowlist
      .filter((e) => existsSync(join(root, e.path)) && !found.has(e.path))
      .map((e) => e.path)
      .sort(),
  }
}

/**
 * Invariante 8: violacoes de escopo (alvo novo invisivel / decisao velha).
 *
 * @param {string} root
 * @param {{allowlist?: {path: string, reason: string}[]}} [options]
 * @returns {string[]}
 */
export function checkOutOfScopeTargets(root = ROOT, options = {}) {
  const { found, undecided, stale } = sweepOutOfScope(root, options)
  const violations = []
  for (const rel of undecided) {
    violations.push(
      `${rel}: referencia a imagem NOSSA '${found.get(rel)}' e esta FORA do escopo varrido, sem decisao escrita — traga o arquivo para o escopo (SCAN_TARGETS) ou registre o motivo em OUT_OF_SCOPE_ALLOWLIST deste guard. Um alvo fora do escopo nao e guardado: ele fica invisivel ate alguem lembrar dele.`,
    )
  }
  for (const rel of stale) {
    violations.push(
      `${rel}: esta em OUT_OF_SCOPE_ALLOWLIST mas nao referencia mais imagem nossa (ou nao existe) — decisao velha esconde que o arquivo saiu de cena; remova a entrada.`,
    )
  }
  return violations
}

/**
 * Coleta os arquivos a varrer. Arquivo ausente e silenciosamente ignorado (o
 * repo pode nao ter `.gitea/` em alguns checkouts) — a ausencia de um alvo nao
 * e uma violacao.
 *
 * @returns {string[]} caminhos relativos a raiz
 */
export function collectFiles(root = ROOT) {
  const files = []
  for (const target of SCAN_TARGETS) {
    const full = join(root, target.dir)
    if (!existsSync(full)) continue
    const st = statSync(full)
    if (st.isFile()) {
      files.push(relative(root, full))
      continue
    }
    if (!st.isDirectory()) continue
    if (target.recursive) {
      for (const entry of readdirSync(full)) {
        const sub = join(full, entry)
        if (!statSync(sub).isDirectory()) continue
        for (const inner of readdirSync(sub)) {
          if (target.match.test(inner)) files.push(relative(root, join(sub, inner)))
        }
      }
      continue
    }
    for (const entry of readdirSync(full)) {
      if (!target.match.test(entry)) continue
      if (!statSync(join(full, entry)).isFile()) continue
      files.push(relative(root, join(full, entry)))
    }
  }
  return files
}

/**
 * Varre tudo e devolve a lista de violacoes. Pura (recebe root e a lista de
 * arquivos) para poder ser testada com uma arvore temporaria.
 *
 * @param {string} root
 * @returns {string[]}
 */
export function findViolations(root = ROOT) {
  const violations = []
  for (const file of collectFiles(root)) {
    const isCompose = isComposeFile(file)
    // Invariante 6 so vale no diretorio de deploy da forja (ver o doc da funcao).
    const isDeploy = file.startsWith(`${DEPLOY_DIR}/`)
    const lines = readFileSync(join(root, file), "utf8").split(/\r?\n/)
    lines.forEach((line, idx) => {
      const hardcoded = checkRegistryLine(file, idx + 1, line)
      if (hardcoded) violations.push(hardcoded)
      if (isCompose) {
        const compose = checkComposeImageLine(file, idx + 1, line)
        if (compose) violations.push(compose)
      }
      if (isDeploy) {
        const literalTag = checkLiteralImageTag(file, idx + 1, line)
        if (literalTag) violations.push(literalTag)
      }
    })
  }

  const actrc = join(root, ".actrc")
  if (existsSync(actrc)) {
    const v = checkActrc(readFileSync(actrc, "utf8"))
    if (v) violations.push(v)
  }

  // Invariante 8: nenhum alvo FORA do escopo pode referenciar imagem nossa sem
  // decisao escrita (ver o bloco do bloco acima).
  violations.push(...checkOutOfScopeTargets(root))
  return violations
}

// ═══════════════════════════════════════════════════════════════════════════
// INVARIANTE 7 — a INTERPOLACAO do compose da forja (`docker compose config`)
// ═══════════════════════════════════════════════════════════════════════════
//
// POR QUE A INVARIANTE 6 (varredura estatica) NAO BASTA: ela prova que a linha
// do label REFERENCIA `${BUN_VERSION}`. Nao prova o que a interpolacao resolve —
// e os dois modos de falha que sobram sao invisiveis no texto:
//
//   1. a variavel NAO EXISTE com esse nome (`${BUN_VERSIO}`, ou uma variavel
//      que ninguem criou): o compose avisa "variable is not set. Defaulting to a
//      blank string" e SEGUE. O label vira
//      `docker://ghcr.io/severinno/ubuntu-bun:` e o runner registra uma imagem
//      que nao existe — o sintoma aparece so quando um job tenta iniciar;
//   2. a versao ganha um DEFAULT LITERAL (`${BUN_VERSION:-1.3.14}`): o texto
//      continua parecendo CORRETO (tem "BUN_VERSION") e a variavel deixa de ser
//      fonte unica — trocar a variavel nao invalida mais a imagem, e o runner
//      roda outra versao com o tier-1 desligado em silencio.
//
// COMO: o compose e renderizado pelo PROPRIO docker (`docker compose config
// --format json`) — quem interpola em producao e ele, nao uma reimplementacao.
// Tres fases, com ambiente CONTROLADO (nada herdado da maquina de quem roda: um
// BUN_VERSION exportado no shell NAO pode mudar o resultado):
//
//   1. DECLARADO  — env da forja (`deploy/.env.gitea` se existir, senao o
//      template): NENHUMA variavel pode ficar vazia, e a tag tem de ser a
//      versao declarada;
//   2. SENTINELA  — registry/namespace/versao/token trocados por valores
//      sentinela: o label TEM de carregar as sentinelas. Se ele mostrar
//      qualquer outra coisa, ha um literal no caminho;
//   3. SEM VERSAO — a versao ausente tem de dar tag VAZIA (a variavel e de fato
//      obrigatoria, nao "tem default"). Se uma versao aparecer, existe default
//      literal.
//
// AUSENCIA DE DOCKER NAO E FALHA: o runner da forja roda a imagem act, que pode
// nao embarcar o plugin `compose`. Ali o passo fica INDETERMINADO — avisa e NAO
// falha (`--no-compose-render` existe pelo mesmo motivo) —, e o relatorio do
// doctor registra "nao provado". Ausencia de prova nao e prova de falha: a
// mesma regra que o doctor aplica ao registry inacessivel.

export const IMAGE_ENV_VARIABLES = ["IMAGE_REGISTRY", "IMAGE_NAMESPACE", "BUN_VERSION"]

/** Todas as variaveis que o compose da forja le do env (a imagem + o token). */
export const COMPOSE_ENV_VARIABLES = [...IMAGE_ENV_VARIABLES, "RUNNER_TOKEN"]

/**
 * Valores SENTINELA: nenhum deles existe no repositorio. Aparecer no render
 * significa que foi a VARIAVEL que os levou ate la — que e exatamente a prova
 * que a fase 2 precisa (o oposto de um literal fixo no compose).
 */
export const COMPOSE_SENTINELS = {
  IMAGE_REGISTRY: "127.0.0.1:5000",
  IMAGE_NAMESPACE: "ns-sentinel",
  BUN_VERSION: "9.9.9-sentinel",
  RUNNER_TOKEN: "sentinel-runner-token",
}

/**
 * O aviso textual do docker para uma variavel referenciada e nao definida.
 *
 * A REGEX NAO EXIGE ASPAS LITERAIS porque o log estruturado do compose ESCAPA
 * as aspas internas da mensagem — o stderr real traz
 * `msg="The \"BUN_VERSIO\" variable is not set. Defaulting to a blank string."`,
 * com a barra invertida antes de cada aspa. (Defeito real desta implementacao:
 * a primeira versao procurava `"` e por isso NUNCA acusava variavel vazia — ela
 * so aparecia pelo efeito colateral da tag vazia.) O nome e entao limpo de
 * aspas/barras e validado como identificador, para uma linha de prosa do log
 * nao virar "nome de variavel".
 */
export const UNSET_VAR_WARNING_RE = /The\s+(.+?)\s+variable is not set/i

/**
 * Nomes das variaveis que o docker reportou como NAO DEFINIDAS. E a deteccao
 * GENERICA de "variavel ficou vazia": vale para qualquer variavel que o compose
 * venha a referenciar, inclusive uma que este guard nao conhece.
 *
 * @param {string} stderr
 * @returns {string[]} nomes unicos, ordenados
 */
export function unsetVariables(stderr) {
  const names = new Set()
  for (const line of String(stderr ?? "").split(/\r?\n/)) {
    const m = line.match(UNSET_VAR_WARNING_RE)
    if (!m) continue
    const name = m[1].replace(/[\\"']/g, "").trim()
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) names.add(name)
  }
  return [...names].sort()
}

/**
 * JSON de `docker compose config --format json` — `null` quando nao e JSON
 * valido (exit 0 com saida estranha nao pode virar "passou").
 *
 * @param {string} stdout
 * @returns {object|null}
 */
export function parseComposeRender(stdout) {
  try {
    const parsed = JSON.parse(String(stdout ?? ""))
    return parsed && typeof parsed === "object" ? parsed : null
  } catch {
    return null
  }
}

/** O mapa `environment` do servico `runner` do render (o que o container recebe). */
export function runnerEnvironment(rendered) {
  const env = rendered?.services?.runner?.environment
  if (!env || typeof env !== "object" || Array.isArray(env)) return null
  return env
}

/**
 * As imagens pedidas pelo label (`ubuntu-latest:docker://<ref>`), na ordem do
 * label. Label ausente/vazio devolve `[]` — que a analise trata como violacao
 * propria (nao como "nada a conferir").
 *
 * @param {string|null|undefined} labels
 * @returns {string[]}
 */
export function labelImageRefs(labels) {
  return String(labels ?? "")
    .split(",")
    .map((entry) => (entry.includes("docker://") ? entry.split("docker://")[1] : ""))
    .map((ref) => ref.trim())
    .filter((ref) => ref !== "")
}

/**
 * Fase 1 (declarado): o env da forja define TUDO que o compose pede, e a tag
 * resolvida e a versao declarada. Pura — recebe o render e o stderr do docker.
 *
 * @param {{rendered: object|null, stderr: string, envLabel: string, declaredVersion: string|null}} args
 * @returns {string[]}
 */
export function analyzeDeclaredRender({ rendered, stderr, envLabel, declaredVersion }) {
  const violations = []
  for (const name of unsetVariables(stderr)) {
    violations.push(
      `${GITEA_COMPOSE}: a variavel '${name}' do compose nao esta definida no env da forja (${envLabel}) — dentro do container ela vira string VAZIA (o proprio docker avisa e segue), e o label do runner passa a apontar para uma imagem inexistente`,
    )
  }

  const env = runnerEnvironment(rendered)
  if (!env) {
    return [
      ...violations,
      `${GITEA_COMPOSE}: o render nao tem o servico 'runner' (ou o environment dele) — a stack da forja nao sobe sem ele`,
    ]
  }

  const refs = labelImageRefs(env.GITEA_RUNNER_LABELS)
  if (refs.length === 0) {
    violations.push(
      `${GITEA_COMPOSE}: GITEA_RUNNER_LABELS nao renderiza nenhuma imagem (docker://...) — sem o label, nenhum job encontra runner`,
    )
  }
  for (const ref of refs) {
    const m = ref.match(/^(.+)\/ubuntu-bun:(.*)$/)
    if (!m) {
      violations.push(
        `${GITEA_COMPOSE}: o label resolve para '${ref}', que nao e uma imagem ubuntu-bun — o runner rodaria a imagem errada (o tier-1 do setup-bun depende dela)`,
      )
      continue
    }
    const tag = m[2]
    if (tag === "") {
      violations.push(
        `${GITEA_COMPOSE}: a TAG do label resolveu VAZIA ('${ref}') — a imagem nunca existe no registry; o compose seguiu porque a variavel nao tem default`,
      )
    } else if (declaredVersion && tag !== declaredVersion) {
      violations.push(
        `${GITEA_COMPOSE}: o label resolve para a tag '${tag}', mas o env declarado (${envLabel}) diz BUN_VERSION='${declaredVersion}' — a versao que roda nao e a declarada`,
      )
    }
  }

  if (!env.GITEA_RUNNER_REGISTRATION_TOKEN) {
    violations.push(
      `${GITEA_COMPOSE}: GITEA_RUNNER_REGISTRATION_TOKEN resolve VAZIO — sem token o runner nao se registra (e a label nova nunca chega a valer)`,
    )
  }
  return violations
}

/**
 * Fase 2 (sentinela): o label TEM de carregar as sentinelas. Qualquer outro
 * valor significa que a imagem (ou o token) nao vem das variaveis.
 *
 * @param {{rendered: object|null}} args
 * @returns {string[]}
 */
export function analyzeSentinelRender({ rendered }) {
  const env = runnerEnvironment(rendered)
  if (!env) {
    return [`${GITEA_COMPOSE}: o render (valores sentinela) nao tem o servico 'runner'`]
  }

  const violations = []
  const expected = `${COMPOSE_SENTINELS.IMAGE_REGISTRY}/${COMPOSE_SENTINELS.IMAGE_NAMESPACE}/ubuntu-bun:${COMPOSE_SENTINELS.BUN_VERSION}`
  const refs = labelImageRefs(env.GITEA_RUNNER_LABELS)
  if (refs.length === 0) {
    violations.push(
      `${GITEA_COMPOSE}: o label nao renderiza imagem nenhuma com valores sentinela — a imagem nao vem das variaveis`,
    )
  }
  for (const ref of refs) {
    if (ref !== expected) {
      violations.push(
        `${GITEA_COMPOSE}: o label resolveu para '${ref}' com registry/namespace/versao sentinela — esperado '${expected}'. O que nao vem da variavel esta LITERAL no compose, e um literal nao e invalidado quando a variavel muda`,
      )
    }
  }
  const token = env.GITEA_RUNNER_REGISTRATION_TOKEN
  if (token !== COMPOSE_SENTINELS.RUNNER_TOKEN) {
    violations.push(
      `${GITEA_COMPOSE}: o token do runner resolveu para '${token ?? "<vazio>"}' em vez da variavel sentinela — token literal no compose e segredo versionado`,
    )
  }
  return violations
}

/**
 * Fase 3 (sem versao): com BUN_VERSION ausente, a tag tem de sair VAZIA — a
 * variavel e obrigatoria de fato. Uma versao aqui e um default literal.
 *
 * O compose RECUSAR renderizar sem a versao (exit != 0) satisfaz a fase: e a
 * forma mais estrita possivel de exigir a variavel — nao ha fallback nenhum.
 *
 * @param {{ok: boolean, rendered: object|null}} args
 * @returns {string[]}
 */
export function analyzeUnsetVersionRender({ ok, rendered }) {
  if (!ok || !rendered) return []
  const env = runnerEnvironment(rendered)
  if (!env) return []

  const violations = []
  for (const ref of labelImageRefs(env.GITEA_RUNNER_LABELS)) {
    const m = ref.match(/\/ubuntu-bun:(.*)$/)
    if (m && m[1] !== "") {
      violations.push(
        `${GITEA_COMPOSE}: com BUN_VERSION AUSENTE o label resolve para '${ref}' — ha um DEFAULT LITERAL para a versao no compose (ex.: \`\${BUN_VERSION:-${m[1]}}\`). A variavel deixou de ser fonte unica: troca-la nao invalida a imagem e o runner passa a rodar outra versao`,
      )
    }
  }
  return violations
}

/**
 * O `docker compose` existe e funciona? (distinto de "a pilha renderiza": aqui
 * so interessa se a FERRAMENTA esta disponivel — inclusive o plugin `compose`,
 * que o CLI `docker` sozinho nao garante).
 *
 * @param {{cwd?: string, run?: Function}} args
 * @returns {{ok: boolean, detail: string}}
 */
export function composeAvailable({ cwd = ROOT, run = spawnSync } = {}) {
  const res = run("docker", ["compose", "version"], { cwd, encoding: "utf8", timeout: 30_000 })
  if (res.error) return { ok: false, detail: res.error.message }
  if (res.status !== 0) {
    const first = String(res.stderr ?? res.stdout ?? "")
      .trim()
      .split(/\r?\n/)[0]
    return { ok: false, detail: first || `exit ${res.status}` }
  }
  return {
    ok: true,
    detail: String(res.stdout ?? "")
      .trim()
      .split(/\r?\n/)[0],
  }
}

/**
 * O ambiente do filho, SEM as variaveis do compose — o env declarado passa a ser
 * a UNICA fonte do render (um BUN_VERSION exportado no shell de quem roda o
 * guard nao pode mudar o resultado).
 *
 * @param {Record<string,string|undefined>} base
 * @param {Record<string,string>} [overrides]
 * @returns {Record<string,string>}
 */
export function controlledEnv(base = {}, overrides = {}) {
  const env = { ...base }
  for (const name of COMPOSE_ENV_VARIABLES) delete env[name]
  for (const [name, value] of Object.entries(overrides)) env[name] = value
  return env
}

/**
 * Roda UMA renderizacao: `docker compose -f <compose> --env-file <envFile>
 * config --format json`.
 *
 * @param {{cwd?: string, envFile: string, env: object, run?: Function}} args
 * @returns {{ok: boolean, stdout: string, stderr: string, detail: string}}
 */
export function renderCompose({ cwd = ROOT, envFile, env, run = spawnSync }) {
  const args = ["compose", "-f", GITEA_COMPOSE, "--env-file", envFile, "config", "--format", "json"]
  const res = run("docker", args, { cwd, encoding: "utf8", env, timeout: 60_000 })
  if (res.error) return { ok: false, stdout: "", stderr: "", detail: res.error.message }
  const stdout = String(res.stdout ?? "")
  const stderr = String(res.stderr ?? "")
  const detail =
    res.status === 0 ? "" : stderr.trim().split(/\r?\n/).slice(-3).join(" ") || `exit ${res.status}`
  return { ok: res.status === 0, stdout, stderr, detail }
}

/**
 * A INVARIANTE 7 completa: renderiza o compose da forja tres vezes (declarado,
 * sentinela, sem versao) e devolve o estado.
 *
 * Estados (o veredito do doctor depende deles):
 *   - `proven`      — as tres fases fecharam;
 *   - `violated`    — variavel vazia ou valor literal no caminho (BLOQUEIA);
 *   - `unavailable` — nao deu para provar (sem docker/compose, sem env) — nao
 *                     falha, mas tambem nao pode virar "provado";
 *   - `absent`      — o checkout nao tem a stack da forja (nada a interpolar);
 *   - `skipped`     — pulada por `--no-compose-render`.
 *
 * @param {{cwd?: string, run?: Function, tmpRoot?: string}} [args]
 * @returns {{state: string, violations: string[], detail: string, phases: string[]}}
 */
export function checkComposeInterpolation({
  cwd = ROOT,
  run = spawnSync,
  tmpRoot = tmpdir(),
} = {}) {
  if (!existsSync(join(cwd, GITEA_COMPOSE))) {
    return {
      state: "absent",
      violations: [],
      phases: [],
      detail: `${GITEA_COMPOSE} nao existe neste checkout — nao ha stack da forja para interpolar`,
    }
  }

  const mirrors = discoverEnvMirrors(cwd)
  const declared = mirrors.find((m) => m.deployed) ?? mirrors[0] ?? null
  if (!declared) {
    return {
      state: "unavailable",
      violations: [],
      phases: [],
      detail: `nenhum env da forja no checkout (${GITEA_ENV_MIRROR} ou ${GITEA_ENV_DEPLOYED.join(", ")}) — sem o env nao ha o que comparar com o compose`,
    }
  }

  const docker = composeAvailable({ cwd, run })
  if (!docker.ok) {
    return {
      state: "unavailable",
      violations: [],
      phases: [],
      detail: `docker compose indisponivel: ${docker.detail}`,
    }
  }

  const declaredVersion = extractEnvMirrorBunVersion(readFileSync(declared.path, "utf8"))
  const violations = []
  const phases = []
  const dir = mkdtempSync(join(tmpRoot, "registry-source-compose-"))

  try {
    const envFile = (name, pairs) => {
      const path = join(dir, name)
      writeFileSync(path, `${pairs.map(([k, v]) => `${k}=${v}`).join("\n")}\n`, "utf8")
      return path
    }

    // 1. DECLARADO — o env da forja como esta no repositorio/host.
    const declared_ = renderCompose({
      cwd,
      envFile: declared.path,
      env: controlledEnv(process.env),
      run,
    })
    if (!declared_.ok) {
      violations.push(
        `${GITEA_COMPOSE}: nao renderiza com o env da forja (${declared.label}): ${declared_.detail}`,
      )
      phases.push("declarado=erro")
    } else {
      const rendered = parseComposeRender(declared_.stdout)
      violations.push(
        ...(rendered
          ? analyzeDeclaredRender({
              rendered,
              stderr: declared_.stderr,
              envLabel: declared.label,
              declaredVersion,
            })
          : [
              `${GITEA_COMPOSE}: 'docker compose config --format json' devolveu JSON invalido (exit 0) — o render nao pode ser conferido`,
            ]),
      )
      phases.push(`declarado=${declared.label}`)
    }

    // 2. SENTINELA — prova que a imagem/token vem das VARIAVEIS.
    const sentinelFile = envFile("sentinel.env", Object.entries(COMPOSE_SENTINELS))
    const sentinel = renderCompose({
      cwd,
      envFile: sentinelFile,
      env: controlledEnv(process.env),
      run,
    })
    if (!sentinel.ok) {
      violations.push(`${GITEA_COMPOSE}: nao renderiza com valores sentinela: ${sentinel.detail}`)
      phases.push("sentinela=erro")
    } else {
      const rendered = parseComposeRender(sentinel.stdout)
      if (rendered) violations.push(...analyzeSentinelRender({ rendered }))
      else violations.push(`${GITEA_COMPOSE}: o render sentinela devolveu JSON invalido`)
      phases.push("sentinela=ok")
    }

    // 3. SEM VERSAO — prova que nao ha default literal para a versao.
    const noVersionFile = envFile(
      "no-version.env",
      Object.entries(COMPOSE_SENTINELS).filter(([name]) => name !== "BUN_VERSION"),
    )
    const noVersion = renderCompose({
      cwd,
      envFile: noVersionFile,
      env: controlledEnv(process.env),
      run,
    })
    const noVersionRendered = noVersion.ok ? parseComposeRender(noVersion.stdout) : null
    violations.push(...analyzeUnsetVersionRender({ ok: noVersion.ok, rendered: noVersionRendered }))
    phases.push(`sem-versao=${noVersion.ok ? "renderizou" : "recusou"}`)

    // DEDUPE: o label da forja tem DUAS entradas (ubuntu-latest e ubuntu-22.04)
    // apontando para a mesma imagem. Sem isso, uma violacao que vale para o
    // label inteiro aparece duas vezes e o relatorio vira eco — o numero de
    // violacoes deixa de significar "quantos problemas existem".
    const unique = [...new Set(violations)]

    return {
      state: unique.length > 0 ? "violated" : "proven",
      violations: unique,
      phases,
      detail:
        unique.length > 0
          ? `${unique.length} violacao(oes) na interpolacao`
          : `3 fases ok (${phases.join(" · ")}) via ${GITEA_COMPOSE}`,
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// ── modo CLI (so quando invocado diretamente, nao quando importado) ────────
const isMain =
  !!process.argv[1] && process.argv[1].split(/[\\/]/).pop() === "check-registry-source.mjs"

if (isMain) {
  const skipRender = process.argv.includes("--no-compose-render")
  const requireCompose = process.argv.includes("--require-compose")
  const staticViolations = findViolations()
  const interpolation = skipRender
    ? {
        state: "skipped",
        violations: [],
        phases: [],
        detail: "pulada por --no-compose-render",
      }
    : checkComposeInterpolation()

  const violations = [...staticViolations, ...interpolation.violations]

  // Com --require-compose SO `proven` passa. `skipped` entra aqui de propósito:
  // pedir o render OBRIGATORIO e pedir para NAO renderizar sao instrucoes
  // contraditorias, e escolher uma precedencia em silencio seria pior que falhar.
  // `violated` NAO entra: uma interpolacao de fato violada (variavel vazia, valor
  // literal) tem o seu proprio relatorio, mais especifico, abaixo.
  const unprovenRequired = requireCompose && !["proven", "violated"].includes(interpolation.state)
  if (unprovenRequired) {
    console.error(
      `check-registry-source: ❌ --require-compose: o render do ${GITEA_COMPOSE} NAO foi provado (${interpolation.state}) — ${interpolation.detail}.`,
    )
    console.error(
      "  Aqui o render nao e opcional: o job da forja roda numa imagem que EMBARCA o plugin `compose`" +
        " (contrato verificado no build do Dockerfile.ubuntu-bun).",
    )
    console.error(
      "  Se a imagem foi construida de outra base, ou o job nao tem o docker socket, o remedio nao e ignorar o aviso:" +
        " sem esta prova a invariante 7 fica NAO VERIFICADA, e um job verde aqui e pior que um vermelho.",
    )
    for (const v of violations) console.error(`  - ${v}`)
    process.exit(1)
  }

  if (violations.length === 0) {
    console.log("check-registry-source: ✅ registry com fonte unica (IMAGE_REGISTRY).")
    if (interpolation.state === "proven") {
      console.log(
        `check-registry-source: ✅ interpolacao do compose da forja provada — ${interpolation.detail}`,
      )
    } else if (interpolation.state === "skipped") {
      console.log(
        "check-registry-source: · interpolacao do compose da forja pulada (--no-compose-render)",
      )
    } else if (interpolation.state === "absent") {
      console.log(`check-registry-source: · interpolacao nao aplicavel: ${interpolation.detail}`)
    } else {
      console.error(
        `::warning:: check-registry-source: interpolacao do compose da forja NAO PROVADA — ${interpolation.detail}.` +
          ` Instale o plugin compose (\`docker-compose-plugin\`) ou rode onde o compose e interpolado de verdade (o VPS, via \`deploy/gitea-up.sh\`).` +
          ` No runner da forja o plugin VEM NA IMAGEM (contrato do Dockerfile.ubuntu-bun): se falta aqui, o problema e deste ambiente.`,
      )
    }
    process.exit(0)
  }

  console.error("check-registry-source: ❌ fonte unica / interpolacao violada:")
  for (const v of violations) console.error(`  - ${v}`)
  console.error(
    `\n${violations.length} violacao(oes). A fonte unica e IMAGE_REGISTRY (repo variable + .env.production + .actrc),` +
      ` e a imagem do runner e resolvida pelo \`docker compose config\` do ${GITEA_COMPOSE}.`,
  )
  process.exit(1)
}
