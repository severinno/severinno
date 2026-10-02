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
//      THIRD_PARTY_ALLOWLIST (explicitamente, uma por uma, com motivo e a DATA
//      da decisao — a regra de envelhecimento e a MESMA da invariante 8, vinda
//      do modulo compartilhado `allowlist-review.mjs`).
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
//   7b. No VPS o env da forja e o arquivo do HOST (`deploy/.env.gitea`), e as
//      tres fases acima provam que ELE e auto-consistente — nao que ele e o
//      MESMO que o repositorio declara (`deploy/env.gitea.example`). A
//      comparacao HOST x TEMPLATE fecha a diferenca: mesmo conjunto de nomes,
//      mesmos valores nas variaveis que o compose CONSOME, e o label
//      renderizado identico dos dois lados. Divergir e violacao (o gate
//      FALHA). Sem o arquivo do host no checkout a metade do host fica "nao
//      aplicavel" — mas a do REPOSITORIO (o template declara tudo o que o
//      compose consome) vale em qualquer checkout, inclusive no CI.
//   8. O escopo declarado (SCAN_TARGETS) e cego em diretorio NOVO. Todo arquivo
//      FORA dele que referencie imagem NOSSA exige DECISAO ESCRITA
//      (OUT_OF_SCOPE_ALLOWLIST, um arquivo por entrada, com o motivo); nao
//      decidir e violacao, e decisao velha tambem — ver "INVARIANTE 8".
//
//      As CLASSES cujo texto NAO e site de resolucao (prosa, fixture de teste e
//      o PAYLOAD das provas por mutacao) ficam fora da varredura por REGRA
//      DECLARADA, com a razao escrita (SWEEP_RULES). O fixture das provas por
//      mutacao e a MESMA constante consultada pela varredura de VALOR (uma
//      constante, duas varreduras): excluir num lugar so deixaria a outra
//      metade cega. A exclusao e ESTREITA e NOMEADA — o relatorio diz quantos
//      arquivos cada regra deixou de fora.
//   9. Tudo o que a invariante 7 cobre vive em ARQUIVO comitado. Mas a
//      referencia da imagem tambem vive em tres lugares que o repositorio NAO
//      contem — repository variables (`vars.*`), o env do HOST da aplicacao
//      (`.env.production.local`/`.env`, gitignored) e o que o REGISTRY serve
//      hoje para a tag (a tag e um apelido mutavel: um re-tag troca a imagem
//      de todos os jobs sem mudar uma linha). Nos tres, PRESUMIR e o defeito:
//      o guard le quando pode e diz INDETERMINADO quando nao pode (nunca
//      "conforme" por omissao) — ver "INVARIANTE 9".
//
//      A COMPARACAO e por VALOR e nao julga a sintaxe do arquivo: as duas
//      grafias de aspas (`|| 'x'` e `|| "x"`) entregam o mesmo valor (a forma
//      entre aspas duplas era lida como token CRU e sumia como "dinamica" —
//      default divergente passando em silencio), e os TIPOS sao da TABELA
//      (NON_VERSIONED_IMAGE_VARIABLES), nao da regua: um tipo novo entra pela
//      tabela e e julgado pela mesma comparacao (Controle C da prova por
//      mutacao, que mede a soma do corpo de `defaultValueVerdict` antes e
//      depois do remendo — igual byte a byte).
//
// Usage:
//   node scripts/check-registry-source.mjs
//   node scripts/check-registry-source.mjs --no-compose-render   # so a varredura estatica
//   node scripts/check-registry-source.mjs --require-compose     # o render e OBRIGATORIO (job da forja)
//   node scripts/check-registry-source.mjs --gitea-env <caminho> # o env do HOST a comparar com o template
//   node scripts/check-registry-source.mjs --require-image       # as referencias nao versionadas sao OBRIGATORIAS
//   node scripts/check-registry-source.mjs --no-registry-probe   # nao consulta o registry (offline)
//   node scripts/check-registry-source.mjs --review              # decisoes (escopo e TERCEIROS) SEM REVISAO viram violacao (job semanal)
//
// --gitea-env: sem a flag o arquivo do host e DESCOBERTO (`deploy/.env.gitea`,
// que so existe onde a stack roda — o VPS). Com a flag o operador diz onde ele
// esta (ex.: `/opt/gitea/.env`), e um caminho INEXISTENTE falha (exit 2): quem
// pediu aquele arquivo precisa saber que a comparacao NAO aconteceu, em vez de
// ler "em sincronia" de uma comparacao que nao houve.
//
// --review: cada entrada das DUAS allowlists deste guard (OUT_OF_SCOPE_ALLOWLIST
// e THIRD_PARTY_ALLOWLIST) carrega `addedAt` (a data da decisao) — as duas
// isencoes envelhecem igual: uma e "este arquivo pode referenciar imagem nossa
// fora do escopo", a outra e "esta imagem de terceiros pode ser consumida do
// GHCR". Passada a janela (OUT_OF_SCOPE_REVIEW_DAYS / THIRD_PARTY_REVIEW_DAYS,
// o mesmo numero do modulo compartilhado), a decisao esta SEM REVISAO: no run
// normal o guard AVISA (`::warning::`, para nao bloquear o pre-commit/PR de todo
// mundo por uma data) e com --review ela vira VIOLACAO (exit 1). O job semanal
// usa o modo estrito porque um aviso dentro de um run verde e alerta mudo —
// ninguem abre o log de um cron que passou. Sem o registro da data (`addedAt`
// ausente/invalida/no futuro) a entrada e violacao nos DOIS modos: uma isencao
// sem data nao tem como envelhecer, e "esqueci de registrar" seria o jeito de
// nunca precisar revisar.
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
//       com variavel vazia / valor literal (invariante 7), env do HOST
//       divergindo do template comitado (invariante 7b), alvo FORA do escopo
//       sem decisao escrita / com decisao velha / SEM o registro da data
//       `addedAt` (invariante 8), decisao SEM REVISAO com --review (invariante
//       8 e a allowlist de TERCEIROS, que envelhece pela mesma regra),
//       referencia nao versionada VIOLADA — default do compose divergindo
//       do template, env do host da app divergindo, tag ausente/re-tagada no
//       registry (invariante 9) —, ou --require-compose / --require-image sem
//       a prova (inclui as flags contraditorias)
//   2 — uso invalido (`--gitea-env` sem caminho, ou apontando um arquivo que
//       nao existe — a pergunta era explicita)
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
import { basename, isAbsolute, join, relative } from "node:path"
import { tmpdir } from "node:os"

import {
  FORGE_ACTIONS_DIRS,
  FORGE_WORKFLOW_DIRS,
  DYNAMIC_EXPR_RE,
  // As réguas de comentário deste guard vêm da FONTE ÚNICA, e a SINTAXE é
  // declarada no call site porque este guard varre DUAS linguagens:
  //
  //   - YAML/compose/shell — `#` sozinho (aqui com o nome local que o veredito
  //     já usa): nestas linguagens `*` é ancoragem de YAML, não comentário;
  //   - `.mjs` — `//`, `/*` e `*` de doc, via `isCommentLine(line,{slash:true})`
  //     e o `stripSlashComment` do fim de linha. Varrer JS com a régua do `#`
  //     fazia o guard acusar a PRÓPRIA prosa que ensina o resolvedor.
  exitOnUnjudgeable,
  isCommentLine as isCommentLineOf,
  isHashComment as isCommentLine,
  readWorkflowScan,
  stripSlashComment as stripJsInlineComment,
  stripTrailingComment as stripInlineComment,
} from "./forge-workflows.mjs"
import { credentialsFromEnv, probeImageIdentity, resolveImageRef } from "./ensure-runner-image.mjs"
import { GITEA_COMPOSE } from "./check-bun-mirror.mjs"
// A COMPARAÇÃO DE VALOR e a leitura do valor DECLARADO vivem no resolvedor
// (`registry-source.mjs`), não aqui: o guard, os scripts e o doctor têm de
// comparar contra o MESMO valor, pela MESMA régua.
import {
  DEFAULT_FORMS_BY_FAMILY,
  IMAGE_VARIABLES,
  defaultValueVerdict,
  defaultsInLine,
} from "./registry-source.mjs"
import {
  GITEA_ENV_DEPLOYED,
  GITEA_ENV_MIRROR,
  discoverEnvMirrors,
  extractEnvMirrorBunVersion,
} from "./check-actrc-sync.mjs"
import {
  DEFAULT_REVIEW_DAYS,
  agedAddedAtViolation,
  invalidAddedAtViolation,
  parseAddedAt,
  reviewAddedAtEntries,
} from "./allowlist-review.mjs"

// A REGRA da data e da janela mora em UM lugar (`allowlist-review.mjs`), e as
// TRES allowlists do repositorio a usam. `parseAddedAt` continua exportado
// daqui porque era a porta de entrada dos consumidores (testes e o teste do
// job semanal) — mover a implementacao sem mover a porta nao quebra quem
// importa, e o dono da regra fica dito no import acima.
export { parseAddedAt }

const ROOT = process.cwd()

/**
 * Imagens de TERCEIROS que consumimos do GHCR de proposito. Cada entrada e um
 * prefixo de repositorio (sem tag). Adicionar aqui e uma decisao consciente:
 * significa "esta imagem nao e nossa e nao segue o IMAGE_REGISTRY".
 */
export const THIRD_PARTY_ALLOWLIST = [
  {
    // Prefixo de repositorio (sem tag) — e ele que `isAllowlistedThirdParty`
    // casa na linha.
    prefix: "ghcr.io/project-osrm/osrm-backend",
    // Data em que a decisao foi tomada (ISO `YYYY-MM-DD`). REVISAR antes de
    // reafirmar: se a imagem continua sendo de terceiros (e o projeto continua
    // sem espelho proprio), atualize a data; se nao, remova a entrada.
    addedAt: "2026-09-13",
    reason:
      "OSRM (roteamento) — imagem comunitaria do proprio projeto, sem espelho nosso no registry: o backend de roteamento nao e construido por nos, entao ele nao segue o IMAGE_REGISTRY. Consumir do GHCR publico e a decisao; o que precisa ser revisto de tempo em tempo e ela, nao o consumo",
  },
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
 * A IMPLEMENTACAO e a REGUA DE COMENTARIO unica (`forge-workflows.mjs`). Aqui
 * a SINTAXE e declarada: este guard varre YAML/compose/shell, onde `*` e alias
 * (nao comentario) — por isso `#` sozinho, e nao a variante `{slash:true}` que
 * os guards de JS/TS usam.
 *
 * @param {string} line
 * @returns {boolean}
 */
export { isCommentLine }

/**
 * Remove comentario INLINE de YAML (`key: valor # prosa`) — em YAML o `#` so
 * inicia comentario precedido de espaco (ou no inicio da linha). Sem isso, uma
 * anotacao como `packages: read # pull da imagem privada ghcr.io/<owner>/...`
 * seria lida como referencia de codigo (foi exatamente o caso real que este
 * guard encontrou).
 *
 * A IMPLEMENTACAO e a REGUA de `forge-workflows.mjs` (`stripTrailingComment`):
 * a regra do comentario de FIM DE LINHA estava escrita aqui E no
 * `check-forge-parity` (`executableLine`), com o MESMO regex copiado.
 *
 * @param {string} line
 * @returns {string} a linha sem a parte comentada
 */
export { stripInlineComment }

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
  return THIRD_PARTY_ALLOWLIST.some((entry) => line.includes(entry.prefix))
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
  // A primeira substituicao e a expressao do runner — o PADRAO vem da fonte
  // unica (`DYNAMIC_EXPR_RE`). A segunda e o `${VAR}` de shell/compose, que e
  // outro construto (uma chave, nao duas) e por isso vive aqui.
  const withoutVars = code.replace(DYNAMIC_EXPR_RE, "\u0000").replace(/\$\{[^}]*\}/g, "\u0000")
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
 * outro literal (`quay.io/severinno/...`, `git.severinno.com` cravado).
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
// de uma linha em OUT_OF_SCOPE_ALLOWLIST com o MOTIVO escrito E A DATA em que a
// decisao foi tomada (`addedAt`). Nao decidir e violacao. Decisao velha (o
// arquivo deixou de referenciar a imagem, ou sumiu) TAMBEM e violacao — senao a
// lista envelhece escondendo arquivos que sairam de cena, exatamente o defeito
// que o `check:forge-parity` descreve na classificacao GITHUB_ONLY. E a mesma
// lista envelhece pelo OUTRO lado quando ninguem revisa: uma isencao tomada ha
// muito tempo (janela de OUT_OF_SCOPE_REVIEW_DAYS) precisa ser REAFIRMADA — o
// run normal avisa (`::warning::`) e o job semanal roda `--review` e fica
// VERMELHO (o canal acionavel), para a isencao nao virar permanente por
// esquecimento.
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
 * A classe dos arquivos cujo TEXTO e FIXTURE das provas por mutacao: o literal
 * da imagem ali e o PAYLOAD que a prova entrega ao guard — nao um site de
 * resolucao.
 *
 * A classe e declarada UMA vez e consultada pelas DUAS varreduras deste guard
 * (os defaults da imagem e as referencias FORA do escopo): a razao e a mesma, e
 * um matcher escrito em dois lugares divergiria no dia em que a convencao do
 * nome mudasse — deixando metade da classe invisivel sem que nada acusasse.
 *
 * A exclusao e ESTREITA de proposito: `scripts/test-mutation/sub/x.sh` (um
 * subdiretorio) e `scripts/test-mutation-x.mjs` (outra extensao) continuam
 * sendo julgados.
 *
 * @param {string} rel
 * @returns {boolean}
 */
export const isMutationProofFixture = (rel) => /^scripts\/test-mutation-[^/]+\.sh$/.test(rel)

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
  {
    id: "mutation-proof",
    matches: isMutationProofFixture,
    reason:
      "prova por mutacao: a referencia cravada ali e o PAYLOAD que a prova entrega ao guard (e o SUJEITO da assercao dela) — julga-la seria o guard acusando o teste que o exercita, e a saida obvia seria mutar o fixture para escapar da regua",
  },
]

/**
 * Arquivos FORA do escopo que referenciam imagem nossa e por isso carregam uma
 * DECISAO ESCRITA. Uma entrada por arquivo (nunca um prefixo de diretorio:
 * um glob esconderia o proximo alvo no mesmo diretorio) e com a DATA em que a
 * decisao foi tomada.
 *
 * Se o arquivo deixar de referenciar a imagem, a entrada tem de SAIR — entrada
 * ociosa e violacao (ver `checkOutOfScopeTargets`). E uma isencao que ninguem
 * revisa tambem: passada a janela de `OUT_OF_SCOPE_REVIEW_DAYS`, ela aparece no
 * run normal como aviso e VIRA VIOLACAO no modo `--review` (o canal do job
 * semanal). Sem a data, uma isencao nao tem como envelhecer — e "esqueci de
 * registrar" seria o jeito de nunca precisar revisar.
 */
export const OUT_OF_SCOPE_ALLOWLIST = [
  {
    path: "scripts/check-registry-source.mjs",
    // Data em que a decisao foi tomada (ISO `YYYY-MM-DD`). REVISAR antes de
    // reafirmar: se o motivo abaixo continua valendo, atualize a data; se nao,
    // remova a entrada.
    addedAt: "2026-09-13",
    reason:
      "e ESTE guard: o arquivo contem o proprio matcher (`imageRefsIn`) e a prosa que explica o defeito que a invariante 8 fechou (o literal que vivia em scripts/). Nao e um site de resolucao — e onde a forma da referencia e DEFINIDA. Fica aqui para o guard nao se dar uma isencao implicita: ele passa pela mesma regra que exige dos outros",
  },
  {
    path: "deploy/log-health.sh",
    addedAt: "2026-10-01",
    reason:
      "script de CRON no HOST da forja (nao compoe stack): o probe do SQLite roda `docker run` com a MESMA imagem pinada do runner (`severinno/ubuntu-bun:<BUN_VERSION>`), cujo contrato vive no render do `deploy/docker-compose.gitea.yml` (invariante 6) — o literal espelha esse contrato de proposito, e `${IMAGE_REGISTRY:-...}` no cron do host seria cosmetica: a variavel nao existe no ambiente do cron, o default resolve sempre para o registry local. E monitor de leitura (volume gitea-data readonly), nao site de resolucao de imagem",
  },
  {
    path: "deploy/runner-janitor.sh",
    addedAt: "2026-10-02",
    reason:
      "script de CRON no HOST da forja (`17 * * * *`, nao compoe stack): a remocao cirurgica de orfaos roda um probe em batch `docker run` com a MESMA imagem pinada do runner (`git.severinno.com/severinno/ubuntu-bun:1.3.14`), cujo contrato vive no render do `deploy/docker-compose.gitea.yml` (invariante 6) — o literal espelha esse contrato de proposito, e `${IMAGE_REGISTRY:-...}` no cron do host seria cosmetica: a variavel nao existe no ambiente do cron, o default resolveria sempre para o registry local. O container e efemero e so le o banco (volume gitea-data ro); a decisao de imagem permanece no compose",
  },
]

/**
 * Janela de REVISAO de uma decisao de escopo, em dias. Passado esse tempo, a
 * entrada precisa de uma revisao EXPLICITA (reafirmar, atualizando `addedAt`,
 * ou remover): o modo `--review` escala as decisoes vencidas a violacao (o
 * canal do job semanal), e o run normal as reporta como `::warning::`. O aviso
 * nao pode ser mudo (`check:periodic-alerts`); a violacao nao pode morder o
 * pre-commit e o PR de todo mundo — por isso o mesmo fato tem os dois modos.
 */
export const OUT_OF_SCOPE_REVIEW_DAYS = DEFAULT_REVIEW_DAYS

/**
 * Janela de REVISAO do consumo de imagem de TERCEIROS (`THIRD_PARTY_ALLOWLIST`),
 * em dias. Mesmo numero da janela das decisoes de escopo — e mesma regra, do
 * mesmo modulo (`allowlist-review.mjs`): passada a janela, a isencao precisa
 * ser REAFIRMADA. O nome e proprio (e nao um alias solto no uso) porque a
 * pergunta das duas listas e diferente: aqui e "esta imagem ainda e de
 * terceiros e o consumo ainda e consciente?", e uma lista que precise de outra
 * janela muda UMA linha.
 */
export const THIRD_PARTY_REVIEW_DAYS = DEFAULT_REVIEW_DAYS

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
 * as situacoes — decidido, nao decidido, decisao velha, registro ausente,
 * registro invalido, registro no futuro e decisao sem revisao — sem tocar na
 * constante do guard.
 *
 * `now`/`reviewDays` tambem sao injetaveis: uma prova de envelhecimento nao
 * pode depender do relogio da maquina que roda a suite (nem do dia em que ela
 * roda).
 *
 * @param {string} root
 * @param {{allowlist?: {path: string, reason: string, addedAt?: string}[], now?: number, reviewDays?: number}} [options]
 * @returns {{found: Map<string, string>, undecided: string[], stale: string[], invalid: {path: string, why: string}[], aged: {path: string, addedAt: string, days: number, limit: number}[], excluded: {total: number, byRule: {id: string, count: number, example: string, reason: string}[]}}}
 */
// A data e a janela sao do modulo compartilhado: esta funcao so diz QUAL campo
// identifica a entrada aqui (`path`) e reescreve o resultado na forma que os
// consumidores ja conhecem (`{path, why}` / `{path, ...}`).
export function sweepOutOfScope(
  root = ROOT,
  {
    allowlist = OUT_OF_SCOPE_ALLOWLIST,
    now = Date.now(),
    reviewDays = OUT_OF_SCOPE_REVIEW_DAYS,
  } = {},
) {
  const decided = new Map(allowlist.map((e) => [e.path, e.reason]))
  const found = new Map()
  // O que as REGRAS deixam fora da varredura, contado POR REGRA. Uma exclusao
  // por classe e declarada — mas uma classe que ninguem ve e indistinguivel de
  // um alvo invisivel, que e o defeito que esta varredura existe para fechar.
  // Por isso o relatorio a NOMEIA (mesma regua dos `IMAGE_DEFAULT_FIXTURE_RULES`).
  const foraPorRegra = new Map()

  for (const rel of walkRepo(root)) {
    if (matchesScanTarget(rel, root)) continue
    const regra = SWEEP_RULES.find((rule) => rule.matches(rel))
    if (regra) {
      const atual = foraPorRegra.get(regra.id) ?? {
        id: regra.id,
        count: 0,
        example: rel,
        reason: regra.reason,
      }
      atual.count += 1
      foraPorRegra.set(regra.id, atual)
      continue
    }
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

  // REGISTRO da decisao e REVISAO: cada entrada carrega QUANDO foi tomada.
  // Sem isso, uma isencao nao tem como envelhecer — e "nao registrei" viraria o
  // jeito de nunca precisar revisar. Data ausente/malformada/no futuro e
  // violacao HARD (fail-closed, como nao decidir); data dentro da janela passa;
  // passada a janela (`reviewDays`), a decisao esta SEM REVISAO.
  const dated = reviewAddedAtEntries(allowlist, { idOf: (e) => e.path, now, reviewDays })
  const invalid = dated.invalid.map((e) => ({ path: e.id, why: e.why }))
  const aged = dated.aged.map((e) => ({
    path: e.id,
    addedAt: e.addedAt,
    days: e.days,
    limit: e.limit,
  }))

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
    invalid,
    aged,
    // A conta das exclusoes por classe (e o EXEMPLO de cada uma): e o que o
    // relatorio usa para dizer, em voz alta, o que a varredura NAO julgou.
    excluded: {
      total: [...foraPorRegra.values()].reduce((n, r) => n + r.count, 0),
      byRule: [...foraPorRegra.values()].sort(
        (a, b) => b.count - a.count || a.id.localeCompare(b.id),
      ),
    },
  }
}

/**
 * Converte um sweep em violacoes legiveis.
 *
 * `failAged` escala a decisao SEM REVISAO a violacao — e o modo `--review`, cujo
 * exit 1 e o CANAL do job semanal (um `::warning::` dentro de um run verde e
 * alerta mudo, como o `check:periodic-alerts` exige). Sem `failAged` ela fica
 * FORA das violacoes de proposito: uma decisao vencida nao pode bloquear o
 * pre-commit e o PR de todo mundo — o run normal a reporta como aviso, e o modo
 * `--review` a cobra.
 *
 * @param {{found: Map<string, string>, undecided: string[], stale: string[], invalid: {path: string, why: string}[], aged: {path: string, addedAt: string, days: number, limit: number}[]}} sweep
 * @param {{failAged?: boolean}} [options]
 * @returns {string[]}
 */
export function outOfScopeViolations(sweep, { failAged = false } = {}) {
  const { found, undecided, stale, invalid, aged } = sweep
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
  for (const { path, why } of invalid) {
    violations.push(
      invalidAddedAtViolation({ label: path, listName: "OUT_OF_SCOPE_ALLOWLIST", why }),
    )
  }
  if (failAged) {
    for (const { path, addedAt, days, limit } of aged) {
      violations.push(
        agedAddedAtViolation({
          label: path,
          listName: "OUT_OF_SCOPE_ALLOWLIST",
          addedAt,
          days,
          limit,
          remedy: "reafirme a decisao (revise o motivo e atualize o `addedAt`) ou remova a entrada",
        }),
      )
    }
  }
  return violations
}

/**
 * O mesmo veredito de DATA para a allowlist de imagens de TERCEIROS.
 *
 * A decisao aqui e outra ("esta imagem nao e nossa e o consumo e consciente"),
 * mas o defeito e o mesmo: uma isencao concedida numa terceira-feira de 2024
 * continua valendo porque ninguem voltou nela. `now`/`reviewDays` sao
 * injetaveis pelo mesmo motivo das decisoes de escopo (provar envelhecimento
 * sem depender do relogio da maquina).
 *
 * @param {{allowlist?: {prefix: string, reason: string, addedAt?: string}[], now?: number, reviewDays?: number}} [options]
 * @returns {{invalid: {id: string, why: string}[], aged: {id: string, addedAt: string, days: number, limit: number}[]}}
 */
export function sweepThirdPartyAllowlist({
  allowlist = THIRD_PARTY_ALLOWLIST,
  now = Date.now(),
  reviewDays = THIRD_PARTY_REVIEW_DAYS,
} = {}) {
  return reviewAddedAtEntries(allowlist, { idOf: (e) => e.prefix, now, reviewDays })
}

/**
 * Converte o sweep de terceiros em violacoes. `failAged` e o modo `--review`:
 * o mesmo contrato das decisoes de escopo (aviso no run normal, exit 1 no job
 * semanal), porque um aviso dentro de um run verde e alerta mudo.
 *
 * @param {{invalid: {id: string, why: string}[], aged: {id: string, addedAt: string, days: number, limit: number}[]}} sweep
 * @param {{failAged?: boolean}} [options]
 * @returns {string[]}
 */
export function thirdPartyAllowlistViolations(sweep, { failAged = false } = {}) {
  const violations = []
  for (const { id, why } of sweep.invalid) {
    violations.push(invalidAddedAtViolation({ label: id, listName: "THIRD_PARTY_ALLOWLIST", why }))
  }
  if (failAged) {
    for (const { id, addedAt, days, limit } of sweep.aged) {
      violations.push(
        agedAddedAtViolation({
          label: id,
          listName: "THIRD_PARTY_ALLOWLIST",
          addedAt,
          days,
          limit,
          remedy:
            "reafirme a decisao (confirme que a imagem continua sendo de TERCEIROS, sem espelho nosso, e atualize o `addedAt`) ou remova a entrada",
        }),
      )
    }
  }
  return violations
}

/**
 * Invariante 8: violacoes de escopo (alvo novo invisivel / decisao velha /
 * decisao sem o registro da data). `failAged` (modo `--review`) inclui tambem
 * as decisoes sem revisao — ver `outOfScopeViolations`.
 *
 * @param {string} root
 * @param {{allowlist?: {path: string, reason: string, addedAt?: string}[], now?: number, reviewDays?: number, failAged?: boolean}} [options]
 * @returns {string[]}
 */
export function checkOutOfScopeTargets(root = ROOT, options = {}) {
  return outOfScopeViolations(sweepOutOfScope(root, options), options)
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
 * `options.sweep` injeta o resultado da varredura de escopo (o CLI ja o calcula
 * para reportar a revisao vencida — assim o repo e varrido UMA vez, nao duas);
 * `options.failAged` escala as decisoes sem revisao a violacao (modo `--review`).
 *
 * @param {string} root
 * @param {{sweep?: object, failAged?: boolean, thirdPartySweep?: object, thirdPartyReviewDays?: number, now?: number, reviewDays?: number, imageDefaults?: object}} [options]
 * @returns {string[]}
 */
export function findViolations(root = ROOT, options = {}) {
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
  violations.push(...outOfScopeViolations(options.sweep ?? sweepOutOfScope(root, options), options))
  // A OUTRA allowlist deste guard tem o MESMO defeito de envelhecimento (uma
  // imagem de terceiros consumida ha anos porque ninguem voltou na decisao) e
  // por isso passa pela MESMA regra de data. As opcoes das decisoes de escopo
  // NAO vazam para ca por padrao (`now`/`reviewDays`) — deixá-las vazar faria um
  // teste de envelhecimento de escopo acusar a lista de terceiros por tabela —,
  // mas o sweep pode ser INJETADO (`thirdPartySweep`) para o fio gate→violacao
  // ser provavel sem tocar na constante do guard.
  violations.push(
    ...thirdPartyAllowlistViolations(
      options.thirdPartySweep ??
        sweepThirdPartyAllowlist({ reviewDays: options.thirdPartyReviewDays }),
      options,
    ),
  )
  // INVARIANTE 9: o default embutido das variáveis da imagem tem de ser o valor
  // DECLARADO (e, em script JS, vir do resolvedor). Injetável para o CLI varrer
  // UMA vez e usar o MESMO resultado no relatório do indeterminado.
  violations.push(...(options.imageDefaults ?? sweepImageDefaultValues(root)).violations)
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
 * As MARCAS textuais do veredito da invariante 7 — o que o smoke (Prova 4) e a
 * prova por mutacao (`smoke-render:prove`) procuram na saida para decidir se o
 * render foi provado ou se a exigencia (`--require-compose`) mordeu.
 *
 * Exportadas para o consumidor nao REESCREVER a frase: quem mede o gate
 * procurando um texto que o gate nao imprime mais passa a medir o vazio — e
 * "nao achei a marca" viraria "esta tudo certo".
 */
export const COMPOSE_RENDER_PROVEN_MARK = "interpolacao do compose da forja provada"
/** A marca da FALHA exigida por `--require-compose` (render nao provado). */
export const REQUIRE_COMPOSE_FAIL_MARK = "NAO foi provado"

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

// ── HOST x TEMPLATE: o que o VPS interpola x o que o repositorio declara ────
//
// O buraco desta metade: as tres fases usam o env da forja — que e o arquivo do
// HOST quando ele existe no checkout (`deploy/.env.gitea`, no VPS). Elas provam
// que esse arquivo e AUTO-CONSISTENTE. Nao provam que ele e o MESMO que o
// repositorio declara (`deploy/env.gitea.example`) — e onde o arquivo do host
// existe, o template comitado deixava de ser renderizado por ninguem: o gate
// dizia "interpolacao provada" enquanto a imagem que o runner registra podia
// ser outra (namespace trocado, versao velha, variavel que o template ja nao
// declara). Modo de falha favorito deste repositorio: verde, com o sintoma
// longe da causa (o tier-1 desligado — so mais lento).
//
// DUAS COMPARACOES, com fontes diferentes de proposito:
//   a. DECLARACOES (sem docker) — o conjunto de NOMES e os VALORES das
//      variaveis que o COMPOSE CONSOME. A lista de consumidas e DERIVADA do
//      proprio compose (`${NOME}` em linha de codigo), nao escrita a mao: uma
//      variavel nova no compose entra na comparacao sozinha. Isentar exige uma
//      linha em SECRET_ENV_VARIABLES — e o default e COMPARAR, porque o
//      inverso (default isentar) deixaria a proxima variavel fora em silencio;
//   b. O RENDER (com docker) — o label que o runner REGISTRA, renderizado com o
//      env do host e com o template: e literalmente "o que o VPS interpola" x
//      "o que o repositorio declara", e vale ate para um valor que a analise
//      (a) nao saiba classificar.
//
// ASSIMETRIA DOS SEGREDOS (o desenho, nao um caso especial): numa variavel
// comum DIVERGIR e o defeito; num SEGREDO, IGUALAR e o defeito — o template e
// comitado e o host tem de ter o valor real. Comparar o valor de um segredo
// exigiria versiona-lo (o oposto do que se quer), e um host que ficou com o
// placeholder do template sobe um runner que nao se registra. Por isso o
// segredo e conferido por PRESENCA (nao vazio) e por DIFERENCA do template.

/**
 * Variaveis cujo valor no template comitado e um PLACEHOLDER (o valor real e um
 * segredo do host). O default do comparador e conferir o VALOR; nomear uma
 * variavel aqui e uma decisao explicita de conferir so a presenca.
 */
export const SECRET_ENV_VARIABLES = ["RUNNER_TOKEN"]

/**
 * A variavel carrega segredo? `"secret"` (confere presenca) ou `"value"`
 * (confere o valor — o default, que vale para qualquer variavel nova).
 *
 * @param {string} name
 * @returns {"secret"|"value"}
 */
export function classifyEnvVariable(name) {
  return SECRET_ENV_VARIABLES.includes(name) ? "secret" : "value"
}

/**
 * As variaveis que o compose CONSOME, derivadas do PROPRIO compose.
 *
 * Por que derivar em vez de listar: uma lista escrita a mao envelhece — uma
 * variavel nova no compose ficaria fora da comparacao host x template sem que
 * nada acusasse, que e a classe de falha que o resto deste guard persegue.
 * Linha de comentario e ignorada (e onde a prosa cita `${BUN_VERSION}`) e o
 * default embutido (`${VAR:-valor}`) e descartado: o NOME e o que importa.
 *
 * @param {string} content  conteudo do compose
 * @returns {string[]} nomes unicos, ordenados
 */
export function composeEnvVariables(content) {
  const names = new Set()
  for (const raw of String(content ?? "").split(/\r?\n/)) {
    if (isCommentLine(raw)) continue
    for (const m of stripInlineComment(raw).matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)/g)) {
      names.add(m[1])
    }
  }
  return [...names].sort()
}

/**
 * Parser de um arquivo de env (formato shell, que e o que o `--env-file` do
 * docker le): `NOME=valor`, `export` opcional, aspas envolvendo o valor, e `#`
 * iniciando comentario (linha inteira, ou inline fora de aspas).
 *
 * ULTIMA ocorrencia vence — a semantica do `--env-file`: a comparacao tem de
 * ler o arquivo do mesmo jeito que quem o consome.
 *
 * @param {string} content
 * @returns {Map<string,string>}
 */
export function parseEnvAssignments(content) {
  const out = new Map()
  for (const raw of String(content ?? "").split(/\r?\n/)) {
    const line = raw.trim()
    if (line === "" || line.startsWith("#")) continue
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!m) continue
    let value = m[2].trim()
    const quoted =
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    if (quoted) {
      value = value.slice(1, -1)
    } else {
      value = value.replace(/\s+#.*$/, "").trim()
    }
    out.set(m[1], value)
  }
  return out
}

/**
 * HOST x TEMPLATE — as DECLARACOES. Puro (nao precisa de docker).
 *
 * `host` ausente/null compara so o lado do REPOSITORIO: toda variavel que o
 * compose consome tem de estar declarada no template comitado — o repositorio
 * nao pode depender do default embutido do compose para dizer o que o VPS usa.
 * Essa metade vale em QUALQUER checkout (inclusive no CI), porque o template e
 * comitado; a metade do host so existe onde a stack roda.
 *
 * @param {{template: Map<string,string>, host: Map<string,string>|null, templateLabel: string, hostLabel?: string|null, consumed?: string[]}} args
 * @returns {string[]}
 */
export function compareEnvMirrorDeclarations({
  template,
  host = null,
  templateLabel,
  hostLabel = null,
  consumed = [],
}) {
  const violations = []

  // CONTRATO DO REPOSITORIO: o que o compose consome tem de estar declarado no
  // template. Sem isso, trocar o template nao muda nada do que roda — o compose
  // resolve o default embutido e "o que o repositorio declara" deixa de existir.
  for (const name of consumed) {
    const declared = template.get(name)
    if (declared === undefined || declared.trim() === "") {
      violations.push(
        `${templateLabel}: a variavel '${name}' do compose nao esta declarada no template comitado — o repositorio nao declara o que o VPS interpola (a interpolacao cairia no default embutido do compose, e trocar o template nao mudaria o que roda)`,
      )
    }
  }

  if (!host) return violations

  // CONJUNTO de nomes, nas DUAS direcoes: faltando no host, o VPS roda o
  // default do compose; sobrando, o estado do VPS nao e reproduzivel a partir
  // do repositorio (um host novo nao teria aquela variavel).
  for (const name of [...template.keys()].filter((n) => !host.has(n)).sort()) {
    violations.push(
      `${hostLabel}: a variavel '${name}' esta declarada em ${templateLabel} mas NAO no env do host — no VPS o compose resolve o default embutido (ou string vazia), e o que roda deixa de ser o que o repositorio declara`,
    )
  }
  for (const name of [...host.keys()].filter((n) => !template.has(n)).sort()) {
    violations.push(
      `${hostLabel}: a variavel '${name}' existe no env do host e NAO em ${templateLabel} — o estado do VPS nao e reproduzivel a partir do repositorio (um host novo nao teria '${name}'); declare-a no template ou remova-a do host`,
    )
  }

  for (const name of consumed) {
    const hostValue = host.get(name)
    if (hostValue === undefined) continue // ja reportado como ausente acima
    const templateValue = template.get(name)
    if (classifyEnvVariable(name) === "secret") {
      if (hostValue.trim() === "") {
        violations.push(
          `${hostLabel}: a variavel '${name}' (segredo) esta VAZIA no env do host — o compose segue e o container recebe string vazia`,
        )
      } else if (hostValue === templateValue) {
        violations.push(
          `${hostLabel}: a variavel '${name}' (segredo) no host tem o MESMO valor do template comitado — ou o host ficou com o placeholder do template (e o recurso que depende dela nao funciona), ou um segredo de verdade foi versionado em ${templateLabel}`,
        )
      }
      continue
    }
    if (templateValue !== undefined && hostValue !== templateValue) {
      violations.push(
        `${hostLabel}: '${name}' DIVERGE do template comitado: ${templateLabel}='${templateValue}' e host='${hostValue}' — o que o VPS interpola nao e o que o repositorio declara`,
      )
    }
  }

  return violations
}

/**
 * HOST x TEMPLATE — o RENDER. Compara o que cada env INTERPOLA no label do
 * runner (a imagem que o container recebe e que o runner REGISTRA).
 *
 * Complementa a comparacao de declaracoes: la a comparacao e por NOME de
 * variavel, aqui e pelo EFEITO. Um valor que nao venha de variavel nenhuma
 * (literal no compose) nao aparece na lista de consumidas, mas aparece aqui.
 *
 * Label ausente/vazio de um dos lados NAO gera violacao propria: quem cobre
 * isso sao as fases 1 e 2, com mensagem mais especifica.
 *
 * @param {{templateRendered: object|null, hostRendered: object|null, templateLabel: string, hostLabel: string}} args
 * @returns {string[]}
 */
export function compareRenderedLabels({
  templateRendered,
  hostRendered,
  templateLabel,
  hostLabel,
}) {
  const templateRefs = labelImageRefs(runnerEnvironment(templateRendered)?.GITEA_RUNNER_LABELS)
  const hostRefs = labelImageRefs(runnerEnvironment(hostRendered)?.GITEA_RUNNER_LABELS)
  if (templateRefs.length === 0 || hostRefs.length === 0) return []
  if (templateRefs.join(",") === hostRefs.join(",")) return []
  return [
    `${GITEA_COMPOSE}: o label do runner INTERPOLA diferente com o env do host (${hostLabel}) e com o template comitado (${templateLabel}): host -> '${hostRefs.join(", ")}' vs template -> '${templateRefs.join(", ")}'. A imagem que o VPS registra nao e a imagem que o repositorio declara`,
  ]
}

/**
 * Um espelho APONTADO pelo operador (`--gitea-env`), que passa a ser o arquivo
 * do host. Ausente devolve `null`: quem decide se a ausencia e erro de uso e o
 * CLI (pergunta explicita), nao a analise.
 */
function mirrorAt(cwd, relPath, deployed) {
  // Caminho ABSOLUTO (ex.: `/opt/gitea/.env`): `join` o grudaria na raiz do
  // checkout e a ausencia seria reportada como drift — o arquivo existe, so nao
  // onde o `join` procurou.
  const path = isAbsolute(relPath) ? relPath : join(cwd, relPath)
  return existsSync(path) ? { path, label: relPath, deployed } : null
}

/**
 * O veredito da comparacao HOST x TEMPLATE como campo proprio do resultado: o
 * doctor reporta "conferido e em sincronia" de "nao havia o que conferir" — a
 * mesma distincao que separa `proven` de `unavailable` no resto do guard.
 */
function hostComparison(state, detail, { template = null, host = null, checked = 0 } = {}) {
  return { state, detail, template, host, checked }
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
 * `hostCompare` diz o que a comparacao com o TEMPLATE COMITADO conseguiu:
 *   - `in-sync`  — o env do host bate com o template (declaracoes e label);
 *   - `diverged` — nao bate (BLOQUEIA: o VPS roda outra coisa que o repo declara);
 *   - `absent`   — nao havia o arquivo do host (ou o template) para comparar. E o
 *                  caso de TODO checkout que nao seja o VPS — por isso ele e
 *                  reportado em vez de sumir em silencio.
 *
 * @param {{cwd?: string, run?: Function, tmpRoot?: string, hostEnv?: string|null}} [args]
 * @returns {{state: string, violations: string[], detail: string, phases: string[], hostCompare: {state: string, detail: string, template: string|null, host: string|null, checked: number}}}
 */
export function checkComposeInterpolation({
  cwd = ROOT,
  run = spawnSync,
  tmpRoot = tmpdir(),
  hostEnv = null,
} = {}) {
  if (!existsSync(join(cwd, GITEA_COMPOSE))) {
    return {
      state: "absent",
      violations: [],
      phases: [],
      hostCompare: hostComparison("absent", `${GITEA_COMPOSE} nao existe neste checkout`),
      detail: `${GITEA_COMPOSE} nao existe neste checkout — nao ha stack da forja para interpolar`,
    }
  }

  const mirrors = discoverEnvMirrors(cwd)
  const template = mirrors.find((m) => !m.deployed) ?? null
  // `hostEnv` EXPLICITO substitui a descoberta do arquivo do host: o operador
  // sabe onde ele mora (ex.: /opt/gitea/.env). O template continua vindo do
  // repositorio — e ele que representa "o que o repositorio declara".
  const host = hostEnv ? mirrorAt(cwd, hostEnv, true) : (mirrors.find((m) => m.deployed) ?? null)
  const declared = host ?? template
  if (!declared) {
    return {
      state: "unavailable",
      violations: [],
      phases: [],
      hostCompare: hostComparison("absent", "nenhum env da forja no checkout"),
      detail: `nenhum env da forja no checkout (${GITEA_ENV_MIRROR} ou ${GITEA_ENV_DEPLOYED.join(", ")}) — sem o env nao ha o que comparar com o compose`,
    }
  }

  // A comparacao host x template roda ANTES do docker DE PROPOSITO: e uma
  // comparacao de ARQUIVOS, e uma divergencia tem de falhar mesmo onde o plugin
  // `compose` nao esta instalado — num host sem ele, o "nao provei" de hoje
  // esconderia justamente o drift que este gate existe para pegar.
  const consumed = composeEnvVariables(readFileSync(join(cwd, GITEA_COMPOSE), "utf8"))
  const comparisons = []
  let hostState
  let hostDetail
  if (template && host) {
    comparisons.push(
      ...compareEnvMirrorDeclarations({
        template: parseEnvAssignments(readFileSync(template.path, "utf8")),
        host: parseEnvAssignments(readFileSync(host.path, "utf8")),
        templateLabel: template.label,
        hostLabel: host.label,
        consumed,
      }),
    )
    hostState = comparisons.length > 0 ? "diverged" : "in-sync"
    hostDetail =
      comparisons.length > 0
        ? `${comparisons.length} divergencia(s) entre o env do HOST (${host.label}) e o template comitado (${template.label})`
        : `host x template em sincronia: ${consumed.length} variavel(is) que o compose consome conferidas (${host.label} x ${template.label})`
  } else if (template) {
    // Metade do REPOSITORIO: vale em qualquer checkout, porque o template e
    // comitado. Sem o host, e so ela que pode ser provada.
    comparisons.push(
      ...compareEnvMirrorDeclarations({
        template: parseEnvAssignments(readFileSync(template.path, "utf8")),
        host: null,
        templateLabel: template.label,
        consumed,
      }),
    )
    hostState = "absent"
    hostDetail = `o env do HOST (${GITEA_ENV_DEPLOYED.join(", ")}) nao existe neste checkout — e ele que o compose le onde a stack roda, entao a comparacao com o template comitado (${template.label}) so existe la`
  } else {
    hostState = "absent"
    hostDetail = `${GITEA_ENV_MIRROR} (o template comitado) nao existe neste checkout — sem ele nao ha "o que o repositorio declara" para comparar`
  }

  const docker = composeAvailable({ cwd, run })
  if (!docker.ok) {
    const unique = [...new Set(comparisons)]
    return {
      state: unique.length > 0 ? "violated" : "unavailable",
      violations: unique,
      phases: [],
      hostCompare: hostComparison(hostState, hostDetail, {
        template: template?.label ?? null,
        host: host?.label ?? null,
        checked: consumed.length,
      }),
      detail:
        unique.length > 0
          ? `docker compose indisponivel (${docker.detail}) e ${hostDetail}`
          : `docker compose indisponivel: ${docker.detail}`,
    }
  }

  const declaredVersion = extractEnvMirrorBunVersion(readFileSync(declared.path, "utf8"))
  const violations = []
  const phases = []
  let declaredRendered = null
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
      declaredRendered = parseComposeRender(declared_.stdout)
      violations.push(
        ...(declaredRendered
          ? analyzeDeclaredRender({
              rendered: declaredRendered,
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

    // 1b. O RENDER do TEMPLATE COMITADO, quando quem renderizou na fase 1 foi o
    // env do host: e o par "o que o VPS interpola" x "o que o repositorio
    // declara". Sem o arquivo do host este passo nao tem par (a fase 1 JA e o
    // template); sem o template nao ha o que comparar.
    if (host && template && host.path !== template.path) {
      const template_ = renderCompose({
        cwd,
        envFile: template.path,
        env: controlledEnv(process.env),
        run,
      })
      if (!template_.ok) {
        violations.push(
          `${GITEA_COMPOSE}: o template comitado (${template.label}) nao renderiza: ${template_.detail} — sem ele nao ha "o que o repositorio declara" para comparar com o env do host`,
        )
        phases.push("template=erro")
      } else {
        const templateRendered = parseComposeRender(template_.stdout)
        if (templateRendered && declaredRendered) {
          const labelViolations = compareRenderedLabels({
            templateRendered,
            hostRendered: declaredRendered,
            templateLabel: template.label,
            hostLabel: host.label,
          })
          violations.push(...labelViolations)
          // A divergencia daqui NAO passa pela comparacao de declaracoes: o
          // estado do campo tem de acompanhar o que de fato foi encontrado.
          if (labelViolations.length > 0) {
            hostState = "diverged"
            hostDetail += " · o RENDER do label tambem diverge"
          }
        }
        phases.push("template=ok")
      }
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
    // As divergencias host x template entram na MESMA lista: o estado, o exit
    // code e o veredito do doctor nao precisam conhecer duas classes de
    // problema — so quantas coisas ha para corrigir.
    const unique = [...new Set([...violations, ...comparisons])]

    return {
      state: unique.length > 0 ? "violated" : "proven",
      violations: unique,
      phases,
      hostCompare: hostComparison(hostState, hostDetail, {
        template: template?.label ?? null,
        host: host?.label ?? null,
        checked: consumed.length,
      }),
      detail:
        unique.length > 0
          ? `${unique.length} violacao(oes) na interpolacao`
          : hostState === "in-sync"
            ? // O número é o das fases MEDIDAS (3, ou 4 quando o par host ×
              // template existe): o "3" escrito à mão mentia justamente na
              // máquina que tem o `deploy/.env.gitea` — listava quatro
              // renderizações e dizia três.
              `${phases.length} fase(s) ok (${phases.join(" · ")}) via ${GITEA_COMPOSE} · ${hostDetail}`
            : `${phases.length} fase(s) ok (${phases.join(" · ")}) via ${GITEA_COMPOSE}`,
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 2b. Referencias em configuracao NAO VERSIONADA (o terceiro lugar da imagem)
// ═══════════════════════════════════════════════════════════════════════════
//
// O guard sempre soube ler o que esta NO REPOSITORIO (compose, Dockerfiles,
// .actrc, templates). Mas a referencia da imagem tambem vive em TRES lugares
// que o repositorio nao contem — e nos tres, presumir e o defeito:
//
//   1. REPOSITORY VARIABLES (`vars.IMAGE_REGISTRY`, `vars.IMAGE_NAMESPACE`,
//      `vars.BUN_VERSION`): os workflows usam a EXPRESSAO; o valor mora na
//      forja. Um fallback escrito no YAML (`|| 'ghcr.io'`) parece o valor e nao
//      e — e uma presuncao que pode estar errada em silencio. O guard le o
//      valor quando ele esta no AMBIENTE (que e o caso do CI, onde a variavel
//      existe) e COMPARA com o que o repositorio declara; sem valor, o estado e
//      INDETERMINADO, com o remedio escrito.
//   2. ENV DO HOST (`.env.production`, `deploy/.env.gitea`): gitignored, existem
//      so na VPS. Presentes, a comparacao com os templates comitados roda;
//      ausentes (todo checkout que nao seja o host), INDETERMINADO — a stack do
//      app e a da forja podem estar apontando para registries diferentes e
//      ninguem veria.
//   3. O QUE O REGISTRY SERVE HOJE PARA A TAG: tag e apelido mutavel; um
//      RE-TAG troca a imagem que todos os jobs rodam sem mudar o repositorio. A
//      prova vem do proprio registry (manifesto + label OCI `version` gravada no
//      `Dockerfile.ubuntu-bun`): `proven`, `mismatch` (re-tag) ou INDETERMINADO
//      quando nao ha rede/credencial/label.
//
// A agregacao tem a mesma gramatica do resto do guard: VIOLACAO quando provou e
// esta errado; INDETERMINADO quando nao pode provar (nunca "ok"); so `proven`
// quando de fato provou.

/** As variaveis da imagem cujo VALOR vive fora do repositorio. */
export const NON_VERSIONED_IMAGE_VARIABLES = ["IMAGE_REGISTRY", "IMAGE_NAMESPACE", "BUN_VERSION"]

/**
 * O ASSUNTO deste guard: ONDE a imagem mora (registry + namespace).
 *
 * `BUN_VERSION` fica de fora das comparacoes de ARQUIVO (template x template,
 * template x host, default do compose x template) de proposito, e por DUAS
 * razoes: (a) a versao do Bun tem guard proprio — o `check-bun-mirror` e o
 * espelho periodico do BUN_VERSION, que comparam o MESMO conjunto de arquivos
 * com a repository variable; e (b) no compose da APLICACAO o `BUN_VERSION` e um
 * BUILD ARG do Dockerfile do servico (`args: BUN_VERSION: ...`), nao uma
 * referencia de imagem — o valor que roda e o do builder, e acusa-lo aqui seria
 * este guard opinando sobre outro assunto por tabela. Ele continua no conjunto
 * acima porque o valor vive fora do repositorio e entra na comparacao com a
 * repository variable.
 */
export const REGISTRY_VARIABLES = [...IMAGE_VARIABLES]

/**
 * Env do HOST da stack da aplicacao (gitignored) — o irmao do forge env.
 *
 * A ORDEM e a do `scripts/deploy.sh` (`.env.production.local`, e `.env` como
 * fallback): o guard le os arquivos na mesma prioridade de quem SOBE a stack,
 * senao ele leria um arquivo que o docker nao usa. Um `.env.production` sem
 * sufixo nao existe em lugar nenhum do repositorio (o template manda copiar
 * para `.env.production.local`): apontar para ele faria este fato ficar
 * NAO APLICAVEL para sempre — um gate que nunca pode provar nada e um gate
 * que ninguem le.
 */
export const APP_ENV_HOSTS = [".env.production.local", ".env"]

/** O template COMITADO da stack da aplicacao (a fonte declarada dela). */
export const APP_ENV_TEMPLATE = ".env.production.example"

/**
 * O compose da stack da aplicacao — o CONSUMIDOR das mesmas tres variaveis da
 * imagem. E dele que sai a lista de nomes, nao de uma lista escrita a mao.
 */
export const APP_COMPOSE = "docker-compose.prod.yml"

/**
 * Os usos `vars.<VARIAVEL>` nos workflows DAS DUAS forjas.
 *
 * Por que ler os workflows em vez de sair do compose: e ali que a referencia
 * NASCE (a label do runner e interpolada do env, mas os jobs recebem a variavel
 * direto). O fallback (`|| 'ghcr.io'`) entra no item: e a unica coisa que o
 * repositorio sabe sobre o valor — e por isso mesmo ele NAO pode ser tratado
 * como valor.
 *
 * @param {string} [root]
 * @returns {{file: string, line: number, variable: string, fallback: string|null}[]}
 */
export function forgeVariableRefs(root = ROOT) {
  const refs = []
  // O FALLBACK pode ser um LITERAL (`|| 'ghcr.io'`) ou uma EXPRESSAO dinamica
  // (`|| github.repository_owner`). Os dois casam o padrao, de proposito: o
  // literal e comparado por valor e o dinamico e CONTADO como fora da
  // comparacao. Antes o dinamico nem casava — ele desaparecia da conta, e um
  // fallback que ninguem ve e exatamente o silencio que este guard existe para
  // fechar (o `IMAGE_NAMESPACE` dos workflows e desse tipo).
  //
  // AS DUAS GRAFIAS DE ASPAS valem o MESMO: `|| 'x'` e `|| "x"` entregam o
  // valor `x`, porque o que se compara e o VALOR — nao a sintaxe do arquivo de
  // CI. Uma grafia ainda nao vista no corpus (uma tag entre aspas duplas, por
  // exemplo) nao pode virar um fallback "dinamico": era exatamente o que
  // acontecia antes (o grupo do token cru engolia as aspas e o item saia
  // `fallback: null`, contado como dinamico) — o default divergente passava em
  // silencio, contado como fora da comparacao. O token CRU, sem aspas, segue
  // sendo o caso dinamico (`|| github.repository_owner`).
  const re = new RegExp(
    `\\$\\{\\{\\s*vars\\.(${NON_VERSIONED_IMAGE_VARIABLES.join("|")})\\s*(?:\\|\\|\\s*(?:'([^']*)'|"([^"]*)"|([^}\\s]+)))?\\s*\\}\\}?`,
    "g",
  )
  // A varredura COMPARTILHADA (fonte única): o rótulo é o mesmo `<dir>/<nome>`,
  // e um arquivo que não abre LANÇA com o nome dele (o CLI acrescenta a porta
  // fail-closed que transforma isso em exit 2 — sem ler o workflow não há como
  // afirmar de quais variáveis a pipeline depende).
  for (const w of readWorkflowScan(root).files) {
    w.text.split(/\r?\n/).forEach((line, i) => {
      if (isCommentLine(line)) return
      for (const m of line.matchAll(re)) {
        refs.push({
          file: w.path,
          line: i + 1,
          variable: m[1],
          // Os dois grupos de aspas sao o MESMO caso (o valor e o texto de
          // dentro); o grupo seguinte e o token CRU — esse e o dinamico.
          fallback: m[2] ?? m[3] ?? null,
        })
      }
    })
  }
  return refs
}

/**
 * Os valores DECLARADOS no repositorio para cada variavel da imagem, por
 * arquivo comitado. cobre os tres espelhos que o repositorio tem hoje:
 * `.actrc` (o act local), o template da forja e o template da aplicacao.
 *
 * @param {string} [root]
 * @returns {{label: string, values: Record<string, string>}[]}
 */
export function declaredImageValues(root = ROOT) {
  const out = []
  const actrc = join(root, ".actrc")
  if (existsSync(actrc)) {
    const values = {}
    for (const line of readFileSync(actrc, "utf8").split(/\r?\n/)) {
      const m = line.trim().match(/^--var\s+([A-Z_]+)\s*=\s*"?([^"\s#]+)"?/)
      if (m && NON_VERSIONED_IMAGE_VARIABLES.includes(m[1])) values[m[1]] = m[2]
    }
    out.push({ label: ".actrc", values })
  }
  for (const [label, relPath] of [
    [GITEA_ENV_MIRROR, GITEA_ENV_MIRROR],
    [APP_ENV_TEMPLATE, APP_ENV_TEMPLATE],
  ]) {
    const path = join(root, relPath)
    if (!existsSync(path)) continue
    // `parseEnvAssignments` devolve um Map (a ULTIMA ocorrencia vence, como o
    // `--env-file` do docker): ler como objeto daria `undefined` e faria o
    // guard dizer "confere com nenhum espelho" — pior que nao comparar.
    const raw = parseEnvAssignments(readFileSync(path, "utf8"))
    const values = {}
    for (const name of NON_VERSIONED_IMAGE_VARIABLES) {
      if (raw.has(name)) values[name] = raw.get(name)
    }
    out.push({ label, values })
  }
  return out
}

/**
 * A FONTE UNICA entre os templates COMITADOS (app x forja): os dois declaram o
 * registry e o namespace das imagens que rodam. Divergir nao quebra teste
 * nenhum — quebra a producao de um lado so: a app puxa do registry A e o runner
 * do registry B, cada arquivo "certo" no seu contexto.
 *
 * Vale em QUALQUER checkout (sao arquivos comitados), e e por isso que ele roda
 * sempre — inclusive no CI.
 *
 * @param {string} [root]
 * @returns {string[]} violacoes
 */
export function compareImageTemplates(root = ROOT) {
  return compareImageValues(root, GITEA_ENV_MIRROR, APP_ENV_TEMPLATE, {
    first: GITEA_ENV_MIRROR,
    second: APP_ENV_TEMPLATE,
    missingInFirst: `os dois puxam imagem pelo mesmo registry, e ${GITEA_ENV_MIRROR} nao declara qual — declare-a la (o compose da forja nao tem default para esta variavel)`,
    missingInSecond: `os dois puxam imagem pelo mesmo registry, e ${APP_ENV_TEMPLATE} nao declara qual — declare-a la`,
  })
}

/**
 * AS DUAS METADES que faltavam na comparacao entre DOIS arquivos.
 *
 * "Os dois concordam" so e uma prova se os dois lados DECLARAREM a variavel:
 * uma variavel ausente de um lado nao e concordancia, e sim um lado em que o
 * valor cai no default embutido do compose (ou em string vazia). Por isso a
 * assimetria e reportada, e nao ignorada — no sentido do arquivo LIDO, tanto
 * "nao declara" quanto "declara outro valor" tem o mesmo efeito: quem interpola
 * com aquele arquivo puxa uma imagem que o repositorio nao declara.
 *
 * AUSENTE NAO E SEMPRE VIOLACAO, e quem decide e o CONSUMIDOR: `missingInFirst`
 * e `missingInSecond` sao `null` quando aquele lado tem um DEFAULT embutido que
 * resolve a mesma coisa (e `checkComposeImageDefaults` prova que o default E o
 * valor declarado) — e sao um texto explicando a consequencia quando nao tem:
 * ali o que roda deixa de ser o que o repositorio declara.
 *
 * @param {string} root
 * @param {string} firstRel caminho do arquivo A (relativo a root)
 * @param {string} secondRel caminho do arquivo B
 * @param {{first: string, second: string, missingInFirst?: string|null, missingInSecond?: string|null}} labels
 * @returns {string[]} violacoes
 */
export function compareImageValues(
  root,
  firstRel,
  secondRel,
  { first, second, missingInFirst = null, missingInSecond = null },
) {
  const read = (rel) => {
    const abs = join(root, rel)
    if (!existsSync(abs)) return null
    const values = {}
    for (const [name, value] of parseEnvAssignments(readFileSync(abs, "utf8"))) {
      if (REGISTRY_VARIABLES.includes(name)) values[name] = value
    }
    return values
  }
  const a = read(firstRel)
  const b = read(secondRel)
  if (!a || !b) return []
  const violations = []
  for (const name of REGISTRY_VARIABLES) {
    const av = a[name]
    const bv = b[name]
    if (av === undefined && bv === undefined) continue
    if (av === undefined || bv === undefined) {
      const missingName = av === undefined ? first : second
      const rationale = av === undefined ? missingInFirst : missingInSecond
      if (rationale !== null) {
        violations.push(
          `${name} esta declarada em apenas um dos dois arquivos (${missingName}) — ${rationale}`,
        )
      }
      continue
    }
    if (av !== bv) {
      violations.push(
        `${name} divergente: ${first}='${av}' e ${second}='${bv}' — cada arquivo "certo" no seu contexto, e as imagens que rodam saem de registries/namespaces diferentes`,
      )
    }
  }
  return violations
}

/**
 * Os DEFAULTS embutidos do compose: `${NOME:-valor}` em linha de codigo.
 *
 * `composeEnvVariables` descarta o default DE PROPOSITO (ele quer o nome). Aqui
 * e o default que importa: ele e o valor que VALE quando o env nao declara o
 * nome — ou seja, e ele que decide o que roda num host que nao tem a variavel.
 *
 * @param {string} content conteudo do compose
 * @returns {{name: string, value: string}[]}
 */
export function composeEnvDefaults(content) {
  const out = []
  for (const raw of String(content ?? "").split(/\r?\n/)) {
    if (isCommentLine(raw)) continue
    for (const m of stripInlineComment(raw).matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*):-([^}]*)\}/g)) {
      out.push({ name: m[1], value: m[2].trim() })
    }
  }
  return out
}

/**
 * O DEFAULT embutido do compose x o valor que o TEMPLATE declara.
 *
 * POR QUE ISSO E UMA INVARIANTE, e nao um detalhe de estilo: o default e o que
 * vale onde a variavel NAO existe. Se o template declara `git.severinno.com`
 * e a linha do compose continua `${IMAGE_REGISTRY:-ghcr.io}`, entao o host que
 * nao declarar a variavel (o caso comum: `.env` sem a variavel) puxa do GHCR
 * enquanto o repositorio "declara" o registry do Gitea — os dois arquivos
 * certos, a imagem errada, e nada fica vermelho. E este projeto esta
 * MIGRANDO de registry: o default velho e exatamente o que fica para tras.
 *
 * Ele tambem e o que torna legitimo o `missingInSecond: null` da comparacao
 * host x template: se o default E o valor declarado, um host que nao declara a
 * variavel interpola o MESMO resultado — a ausencia nao muda o efeito.
 *
 * @param {string} root
 * @param {{compose: string, template: string}} files
 * @returns {string[]} violacoes
 */
export function checkComposeImageDefaults(root, { compose, template }) {
  const composePath = join(root, compose)
  const templatePath = join(root, template)
  if (!existsSync(composePath) || !existsSync(templatePath)) return []
  const declared = {}
  for (const [name, value] of parseEnvAssignments(readFileSync(templatePath, "utf8"))) {
    if (REGISTRY_VARIABLES.includes(name)) declared[name] = value
  }
  const violations = []
  for (const { name, value } of composeEnvDefaults(readFileSync(composePath, "utf8"))) {
    if (!REGISTRY_VARIABLES.includes(name)) continue
    if (declared[name] === undefined) {
      violations.push(
        `${compose} tem default '${value}' para ${name}, e o template ${template} nao declara essa variavel — o default passa a ser a unica fonte do que roda (declare-a em ${template})`,
      )
      continue
    }
    if (value !== declared[name]) {
      violations.push(
        `${compose}: o default de ${name} e '${value}' e o template ${template} declara '${declared[name]}' — onde a variavel nao existe (um env que nao a declara) o default vale, e a imagem que roda nao e a que o repositorio declara`,
      )
    }
  }
  return violations
}

/**
 * Os DEFAULTS das duas stacks (a da aplicacao e a da forja).
 *
 * @param {string} [root]
 * @returns {string[]} violacoes
 */
export function checkComposeImageDefaultsForRepo(root = ROOT) {
  return [
    ...checkComposeImageDefaults(root, { compose: APP_COMPOSE, template: APP_ENV_TEMPLATE }),
    ...checkComposeImageDefaults(root, { compose: GITEA_COMPOSE, template: GITEA_ENV_MIRROR }),
    ...checkComposeValueDefaults(root),
  ]
}

// ═══════════════════════════════════════════════════════════════════════════
// INVARIANTE 9 (b) — os DEMAIS defaults declarados do compose
// ═══════════════════════════════════════════════════════════════════════════
//
// A classe é a MESMA da invariante acima (o default é o que vale onde a
// variável não existe), e o que muda é só o CONJUNTO: um ajuste de stack que é
// pre-requisito de operação não pode depender do default da SÉRIE da imagem.
//
// O CASO QUE A CRIOU, medido: o registry embutido do Gitea (`registry__ENABLED`)
// é o substituto do GHCR da etapa 1 (`docs/GITHUB_CUT.md`), e o ensaio
// `gitea-registry:prove` tinha de LIGÁ-LO por override — porque nenhum arquivo
// do repositório o declarava. A stack que roda no VPS era a única que dependia
// de um default que não é promessa escrita: o sintoma disso não é um erro de
// configuração, é o runner não conseguir puxar a imagem dos jobs.
//
// POR QUE UMA TABELA (e não mais um `if`): a entrada declara o PAR (compose ×
// template) e o PORQUÊ da igualdade, e é a violação que cita o porquê. Um par
// novo entra aqui no commit em que é declarado, com a razão escrita.

/**
 * Os defaults de compose que têm de ser IGUAIS ao valor do template.
 *
 * @type {{compose: string, template: string, name: string, why: string}[]}
 */
export const COMPOSE_VALUE_DEFAULTS = [
  {
    compose: GITEA_COMPOSE,
    template: GITEA_ENV_MIRROR,
    name: "GITEA__registry__ENABLED",
    why: "é a etapa 1 do corte do GitHub (docs/GITHUB_CUT.md): as duas imagens (a `ubuntu-bun` dos jobs e o mirror do Bun) passam a ser servidas pelo registry EMBUTIDO da forja, e uma stack que dependa do default da série 1.22 pode subir com ele desligado — o sintoma não é erro de configuração, é o runner não conseguir puxar a imagem dos jobs",
  },
]

/**
 * Os NOMES dos pares de valor declarados — a TERCEIRA classe de variável que o
 * compose consome, ao lado das comparadas (`MIRROR_VARIABLES`) e do segredo
 * (`SECRET_MIRROR_VARIABLES`), no contrato do `check-actrc-sync`.
 *
 * POR QUE UMA CLASSE PRÓPRIA: esta não tem repository variable com que comparar
 * — a régua dela é entre DOIS ARQUIVOS VERSIONADOS (o default do compose e a
 * linha do template), e quem a aplica é o `checkComposeValueDefaults` acima.
 * Deixá-la fora do contrato faria dela exatamente o que o contrato proíbe: um
 * nome que entra no compose com a checagem de EXISTÊNCIA e mais nada.
 */
export const COMPOSE_VALUE_VARIABLES = COMPOSE_VALUE_DEFAULTS.map((e) => e.name)

/**
 * Todas as variaveis que o compose da forja le do env: a imagem, o token e os
 * pares de valor declarados.
 *
 * DERIVADA da tabela `COMPOSE_VALUE_DEFAULTS` (e não mais uma linha à mão): um
 * par novo entra aqui no commit em que é declarado, e o ambiente CONTROLADO do
 * render (`checkNonVersionedImageRefs`, fase 1) o dropa junto — uma variável que
 * escapasse do drop faria o render depender do shell de quem o roda.
 */
export const COMPOSE_ENV_VARIABLES = [
  ...IMAGE_ENV_VARIABLES,
  "RUNNER_TOKEN",
  ...COMPOSE_VALUE_VARIABLES,
]

/**
 * O default do compose x o valor declarado no template, para os pares da TABELA.
 *
 * Três exigências, todas derivadas do mesmo raciocínio:
 *
 *   1. o TEMPLATE declara o valor (é ele que o host espelha, e o
 *      `check-env-mirror` só compara nomes que o compose consome);
 *   2. o compose o CONSOME na forma `${NOME:-<default>}` — literal no compose
 *      ignora o env do host: o valor declarado não chegaria ao container, e a
 *      linha do template viraria decoração;
 *   3. o default é IGUAL ao declarado: onde a variável não existe, é ele que
 *      vale.
 *
 * @param {string} [root]
 * @param {{compose: string, template: string, name: string, why: string}[]} [entries]
 * @returns {string[]} violações
 */
export function checkComposeValueDefaults(root = ROOT, entries = COMPOSE_VALUE_DEFAULTS) {
  const violations = []
  for (const { compose, template, name, why } of entries) {
    const composePath = join(root, compose)
    const templatePath = join(root, template)
    if (!existsSync(composePath) || !existsSync(templatePath)) continue
    const pair = `(o par é ${compose} x ${template})`
    // O default do compose é lido PRIMEIRO: é ele que o diagnóstico cita quando
    // o template não declara a linha ("declare `NOME=<o default>`"), e ler nesta
    // ordem evita dizer ao operador para declarar um valor que o compose não
    // carrega.
    const defaults = composeEnvDefaults(readFileSync(composePath, "utf8")).filter(
      (d) => d.name === name,
    )
    const declared = parseEnvAssignments(readFileSync(templatePath, "utf8")).get(name)
    if (declared === undefined) {
      const sugerido = defaults[0]?.value ?? ""
      violations.push(
        `${template} não declara ${name} e o compose o consome ${pair} — ${why}. O valor passa a ser o default da SÉRIE da imagem, que não é promessa escrita: declare a linha no template (\`${name}=${sugerido}\` — é ela que o host espelha).`,
      )
      continue
    }
    if (defaults.length === 0) {
      violations.push(
        `${compose} não consome ${name} na forma \`\${${name}:-<valor>}\` ${pair} — literal no compose ignora o env do host (o valor declarado no template não chega ao container) e um default diferente do declarado vale onde a variável não existe. O valor declarado é '${declared}'.`,
      )
      continue
    }
    for (const { value } of defaults) {
      if (value === declared) continue
      violations.push(
        `${compose}: o default de ${name} é '${value}' e ${template} declara '${declared}' ${pair} — onde a variável não existe o default vale, e é ele que sobe a stack: ${why}.`,
      )
    }
  }
  return violations
}

// ═══════════════════════════════════════════════════════════════════════════
// INVARIANTE 9 — o DEFAULT de registry/namespace é o valor DECLARADO
// ═══════════════════════════════════════════════════════════════════════════
//
// O DEFEITO (e ele é silencioso por desenho): depois de trocar de registry, um
// default embutido que ficou para trás continua valendo onde a variável não
// existe — e como a imagem VELHA continua existindo no registry VELHO, nada
// fica vermelho: o pull funciona, só puxa do lugar errado. É a mesma classe do
// literal de versão do Bun (`process.env.BUN_VERSION || "1.3.14"`), com um
// agravante: aqui o host pode continuar respondendo (só com outra imagem).
//
// A RÉGUA é UMA (`defaultValueVerdict`, do `registry-source.mjs`): cada forma
// canônica de default é comparada por VALOR contra o que os arquivos comitados
// declaram — e o veredito tem três estados, nunca dois:
//
//   - `proven`        — o default é igual ao declarado (nomeia o arquivo);
//   - `violated`      — diverge: os dois valores são nomeados, e o efeito é dito;
//   - `indeterminate` — NENHUM arquivo comitado declara a variável: não há
//     contra o que comparar. O guard NÃO presume: isto vira `::warning::` com o
//     remédio (declarar a variável no espelho), nunca um ✅ por omissão.
//
// ONDE, e por que cada lugar tem a sua forma:
//
//   1. COMPOSE (`${IMAGE_REGISTRY:-ghcr.io}`) — o default é legítimo (é o que
//      vale num host que não declara a variável), mas o VALOR é comparado. A
//      varredura cobre TODO compose com default, inclusive os que não têm par
//      declarado (o `docker-compose.hostinger.yml` vivia fora da comparação por
//      par): uma stack nova entra sem lista à mão. Os dois pares declarados
//      (app × `.env.production.example`, forja × `deploy/env.gitea.example`)
//      seguem com a comparação por par, que é quem sabe QUAL template é a fonte;
//   2. SHELL (`${IMAGE_REGISTRY:-ghcr.io}` em `scripts/**` e `deploy/**`) — o
//      shell não importa módulo JS: a forma canônica é a do compose, e o que o
//      guard exige é o VALOR;
//   3. SCRIPT JS (`.mjs`) — o default literal é VIOLAÇÃO sempre, mesmo com o
//      valor certo: o repositório tem resolvedor (`requireImageSource` de
//      `scripts/registry-source.mjs`), e um literal aqui volta a envelhecer em
//      silêncio no dia da próxima migração. A mensagem nomeia o módulo.
//      Aqui a FORMA importa: só `X || "valor"` é default — o `${NOME:-x}` num
//      `.mjs` vive dentro de MENSAGEM (não é JS válido fora de string), e é
//      CONTADO e nomeado como prosa, não lido como valor. E a régua do
//      comentário é a da linguagem: `//`, `/*` e `*` de doc comentam (varrer JS
//      com a régua do `#` fazia o guard acusar a prosa que ensina o resolvedor);
//   4. WORKFLOW — o fallback LITERAL (`${{ vars.IMAGE_REGISTRY || 'ghcr.io' }}`)
//      é comparado por valor. O fallback DINÂMICO (`|| github.repository_owner`)
//      NÃO é afirmação de valor: ele é CONTADO como fora da comparação e o
//      relatório declara quantos são (tratá-lo como valor seria o guard
//      opinando sobre o que não leu; omiti-lo da conta seria pior — um fallback
//      que não aparece em lugar nenhum é o silêncio que este guard fecha).
//
// `.husky/**` fica fora: os hooks não montam referência de imagem (não há
// default a comparar) — e um escopo declarado é mais honesto que um glob largo
// que ninguém consegue justificar.

/** Os pares compose↔template com a comparação POR PAR (as duas stacks declaradas). */
export const COMPOSE_STACK_PAIRS = [APP_COMPOSE, GITEA_COMPOSE]

/** O escopo de SCRIPTS da invariante 9: onde um default embutido pode viver. */
export const IMAGE_DEFAULT_SCRIPT_RE = /^(?:scripts|deploy)\/[^/]+\.(?:sh|mjs)$/

/**
 * Os arquivos cujo TEXTO é FIXTURE da própria prova — não um site de resolução.
 *
 * Mesma classe (e mesmo raciocínio) do `SWEEP_RULES.test-fixture`: a string de
 * imagem (aqui, o `${NOME:-valor}`) é o SUJEITO da prova — o payload que a prova
 * por mutação entrega ao guard. Julgá-la seria o guard acusando o teste que o
 * exercita, e a saída óbvia seria mutar o fixture para escapar da régua (pior:
 * cegaria o guard exatamente onde ele é exercitado).
 *
 * A exclusão é DECLARADA (nomeada no relatório) e ESTREITA (um `deploy/*.sh`
 * com o mesmo texto continua sendo julgado — é o que o CONTROLE B3 da prova
 * por mutação mede).
 */
export const IMAGE_DEFAULT_FIXTURE_RULES = [
  {
    id: "mutation-proof",
    matches: isMutationProofFixture,
    reason: "prova por mutação: as linhas `${NOME:-valor}` ali são o PAYLOAD que alimenta o guard",
  },
]

/** A regra de fixture que cobre um caminho (ou `null`). */
export function imageDefaultFixtureRule(rel) {
  return IMAGE_DEFAULT_FIXTURE_RULES.find((rule) => rule.matches(rel)) ?? null
}

/**
 * A varredura da invariante 9: cada default embutido das variáveis da imagem,
 * comparado por VALOR contra o que o repositório declara.
 *
 * Pura em relação ao relógio e à rede (só lê arquivos), e devolve também o que
 * NÃO foi provado — um guard que só devolvesse violações faria o indeterminado
 * desaparecer no caminho.
 *
 * @param {string} [root]
 * @returns {{violations: string[], indeterminate: string[], compared: number, prose: number, fixtures: string[], files: string[], dynamic: number}}
 */
export function sweepImageDefaultValues(root = ROOT) {
  const violations = []
  const indeterminate = []
  const files = new Set()
  const fixtures = []
  let compared = 0
  let prose = 0
  let dynamic = 0

  /** O veredito de UM default, na forma que o guard reporta. */
  const judge = (file, lineNo, name, value) => {
    const verdict = defaultValueVerdict(name, value, { root })
    compared += 1
    files.add(file)
    if (verdict.state === "violated") {
      violations.push(`${file}:${lineNo}: ${verdict.detail}`)
      return
    }
    if (verdict.state === "indeterminate")
      indeterminate.push(`${file}:${lineNo}: ${verdict.detail}`)
  }

  for (const file of walkRepo(root)) {
    const isCompose = isComposeFile(file)
    const isScript = IMAGE_DEFAULT_SCRIPT_RE.test(file)
    if (!isCompose && !isScript) continue
    // Os dois pares declarados passam pela comparação por PAR (que sabe qual
    // template é a fonte); aqui eles sairiam duplicados na mesma lista.
    if (isCompose && COMPOSE_STACK_PAIRS.includes(file)) continue
    // Fixture da própria prova: DECLARADO (e nomeado no relatório), não varrido.
    if (imageDefaultFixtureRule(file) !== null) {
      fixtures.push(file)
      continue
    }
    const isJs = file.endsWith(".mjs")
    const family = isJs ? "js" : isCompose ? "compose" : "shell"
    const lines = readFileSync(join(root, file), "utf8").split(/\r?\n/)
    lines.forEach((line, idx) => {
      // A regua do comentario segue a LINGUAGEM do arquivo (a sintaxe e
      // escolhida aqui, e a funcao e a mesma): num `.mjs` o `//` e o `*` de doc
      // comentam; num compose/shell nao.
      if (isJs ? isCommentLineOf(line, { slash: true }) : isCommentLine(line)) return
      const code = isJs ? stripJsInlineComment(line) : stripInlineComment(line)
      for (const name of REGISTRY_VARIABLES) {
        for (const d of defaultsInLine(name, code)) {
          // A FORMA vale por FAMÍLIA de arquivo (`DEFAULT_FORMS_BY_FAMILY`): no
          // script JS só `X || "valor"` é default (o `${NOME:-x}` ali vive
          // dentro de MENSAGEM, não é JS válido fora de string), no shell só
          // `${NOME:-valor}`, no YAML do runner só `vars.NOME || 'valor'`.
          // O que casa uma forma de OUTRA família é prosa/fixture — CONTADO e
          // dito no relatório, nunca julgado como valor nem sumido.
          if (!DEFAULT_FORMS_BY_FAMILY[family].includes(d.form)) {
            prose += 1
            continue
          }
          if (isScript && isJs) {
            compared += 1
            files.add(file)
            violations.push(
              `${file}:${idx + 1}: default literal '${d.value}' para ${name} em script JS — use o RESOLVEDOR ` +
                "(`requireImageSource()` de `scripts/registry-source.mjs`): o literal sobrevive à troca de registry " +
                "(o script continua puxando do host VELHO, e como a imagem continua existindo lá, nada fica vermelho)." +
                (defaultValueVerdict(name, d.value, { root }).state === "violated"
                  ? " Aqui ele já diverge do valor declarado — os dois lados aparecem no relatório do guard."
                  : ""),
            )
            continue
          }
          judge(file, idx + 1, name, d.value)
        }
      }
    })
  }

  // 3. WORKFLOWS — os fallbacks literais das duas forjas (a leitura é a
  // COMPARTILHADA das workflows; o `fallback` já sai separado do nome).
  for (const ref of forgeVariableRefs(root)) {
    if (ref.fallback === null) {
      dynamic += 1
      continue
    }
    judge(ref.file, ref.line, ref.variable, ref.fallback)
  }

  return {
    violations,
    indeterminate,
    compared,
    prose,
    fixtures: fixtures.sort(),
    files: [...files].sort(),
    dynamic,
  }
}

/**
 * O env do HOST da APLICACAO x o template COMITADO dela.
 *
 * POR QUE ELE E UM GAP PROPRIO: a invariante 7b compara o env do host da FORJA
 * com o template da forja (todas as variaveis que o compose da forja consome).
 * Ninguem compara o env da APLICACAO com `.env.production.example` — e e ali
 * que vive o `IMAGE_REGISTRY` que decide de ONDE a app puxa as imagens. Um VPS
 * com `IMAGE_REGISTRY=git.severinno.com` no `.env.production.local` e
 * `ghcr.io` no template comitado tem os dois lados verdes: a app puxa de um
 * registry e o runner do outro, e trocar o template nao muda o que roda.
 *
 * ESCOPO DECLARADO: so as variaveis da IMAGEM entram. As outras ~49 que o
 * compose da aplicacao consome tem regra propria (o preflight de deploy, o
 * verify-env) — mistura-las aqui faria deste guard um segundo validador de env
 * inteiro, e o defeito deste arquivo e justamente o de nao ter uma segunda
 * implementacao que possa divergir da primeira.
 *
 * @param {string} [root]
 * @returns {{violations: string[], host: string|null, checked: number, declared: string[]}} violacoes, o host lido e quantas variaveis foram de fato comparadas
 */
export function compareAppHostImageDeclarations(root = ROOT) {
  const host = APP_ENV_HOSTS.map((rel) => ({ rel, abs: join(root, rel) })).find((c) =>
    existsSync(c.abs),
  )
  if (!host) return { violations: [], host: null, checked: 0, declared: [] }
  const declared = [...parseEnvAssignments(readFileSync(host.abs, "utf8")).keys()].filter((n) =>
    REGISTRY_VARIABLES.includes(n),
  )
  return {
    // `missingInSecond: null` — o compose da aplicacao TEM default para o
    // registry e o namespace (`${IMAGE_REGISTRY:-ghcr.io}/...`), e
    // `checkComposeImageDefaults` prova que esse default E o valor declarado no
    // template. Um host que nao declara a variavel interpola o mesmo resultado:
    // a ausencia nao muda o efeito, e acusa-la faria o guard reprovar todo `.env`
    // de desenvolvimento (que nao tem IMAGE_REGISTRY porque nao precisa).
    // `missingInFirst`: o host declarar uma variavel que o template nao tem e
    // outra coisa — o estado daquele host deixa de ser reproduzivel a partir do
    // repositorio (um host novo nao teria a variavel).
    violations: compareImageValues(root, APP_ENV_TEMPLATE, host.rel, {
      first: APP_ENV_TEMPLATE,
      second: host.rel,
      missingInFirst: `o que roda naquele host nao e reproduzivel a partir do repositorio: declare-a em ${APP_ENV_TEMPLATE} ou remova-a de ${host.rel}`,
      missingInSecond: null,
    }),
    host: host.rel,
    // QUANTAS variaveis foram de fato comparadas: um host que nao declara
    // nenhuma delas nao "confere" — nao havia o que comparar (o compose resolve
    // o default, e `checkComposeImageDefaults` prova que esse default E o valor
    // declarado). Confundir "nao divergiu" com "conferiu" e o alerta mudo.
    checked: declared.length,
    declared,
  }
}

/**
 * O FATO: o que da para provar sobre as referencias que vivem fora do repo.
 *
 * `env` e `probe` sao as fronteiras de dependencia (o ambiente do processo e a
 * consulta ao registry) — injetadas nos testes, nunca dubladas em producao.
 *
 * @param {{root?: string, env?: Record<string, string|undefined>, hostEnv?: string|null, probe?: Function, probeRegistry?: boolean, credentials?: object|null, timeoutMs?: number}} [args]
 * @returns {Promise<{state: "proven"|"violated"|"indeterminate"|"absent", items: {source: string, state: string, detail: string, digest?: string|null}[], violations: string[], detail: string}>}
 */
export async function checkNonVersionedImageRefs({
  root = ROOT,
  env = process.env,
  hostEnv = null,
  probe = probeImageIdentity,
  probeRegistry = true,
  credentials = credentialsFromEnv(env),
  timeoutMs = 20000,
} = {}) {
  const appDeclarations = compareAppHostImageDeclarations(root)
  const composeDefaults = checkComposeImageDefaultsForRepo(root)
  const composeValues = checkComposeValueDefaults(root)
  const violations = [
    ...compareImageTemplates(root),
    ...appDeclarations.violations,
    ...composeDefaults,
    // Invariante 9 (por VALOR, todo compose/script/workflow com default): um
    // default velho depois da migração BLOQUEIA a prontidão — ele é exatamente
    // o modo de falha silencioso que este fato existe para nomear.
    ...sweepImageDefaultValues(root).violations,
  ]
  const items = []
  // O FATO dos outros defaults declarados (a tabela `COMPOSE_VALUE_DEFAULTS`):
  // o default do compose E o valor do template, medido por VALOR e não por
  // prosa — a etapa 1 do corte depende do registry embutido, e este item é onde
  // a prontidão diz que ele está DECLARADO (ou nomeia qual par divergiu).
  if (COMPOSE_VALUE_DEFAULTS.length > 0) {
    // O nome do fato NAO cita a variavel de proposito: os fatos desta lista sao
    // consumidos por busca de substring em outros pontos (o item do registry
    // consultado, por exemplo) e um nome que contivesse 'registry' roubaria a
    // busca deles. O que a variavel e vai no `detail`.
    items.push({
      source: "defaults declarados do compose",
      state: composeValues.length === 0 ? "proven" : "violated",
      detail:
        composeValues.length === 0
          ? `${COMPOSE_VALUE_DEFAULTS.length} par(es) declarado(s) — ${COMPOSE_VALUE_DEFAULTS.map((e) => e.name).join(", ")}: o default embutido do compose E o valor do template (${COMPOSE_VALUE_DEFAULTS.map((e) => `${e.template} = ${e.compose}`).join(" · ")}), entao a stack nao depende do default da serie da imagem`
          : `divergente em ${composeValues.length} par(es): ${composeValues.join(" | ")}`,
    })
  }
  if (appDeclarations.host) {
    const diverged = appDeclarations.violations.length > 0
    items.push({
      source: `env do host da aplicacao ${appDeclarations.host}`,
      state: diverged ? "violated" : appDeclarations.checked > 0 ? "proven" : "absent",
      detail: diverged
        ? `divergente do template comitado (${APP_ENV_TEMPLATE}) nas variaveis da imagem`
        : appDeclarations.checked > 0
          ? `confere com ${APP_ENV_TEMPLATE} em ${appDeclarations.checked} variavel(is) da imagem (${appDeclarations.declared.join(", ")})`
          : `este host NAO declara nenhuma das variaveis da imagem (${REGISTRY_VARIABLES.join(", ")}) — o compose resolve o default, e o default x o template e conferido por \`checkComposeImageDefaults\`; aqui nao ha o que comparar`,
    })
  }

  // 1. Repository variables: o valor vem do AMBIENTE quando existe (o CI exporta
  //    a variable); sem ele, INDETERMINADO com o remedio — o fallback do YAML
  //    nao entra como valor, entra como o que o repo declara.
  const refs = forgeVariableRefs(root)
  const declarations = declaredImageValues(root)
  for (const name of NON_VERSIONED_IMAGE_VARIABLES) {
    const uses = refs.filter((r) => r.variable === name)
    if (uses.length === 0) continue
    const where = `${uses.length} uso(s), ex.: ${uses[0].file}:${uses[0].line}`
    const files = [...new Set(uses.map((u) => u.file))].length
    const fallback = uses.find((u) => u.fallback !== null)?.fallback ?? null
    const value = (env[name] ?? "").trim()
    if (!value) {
      items.push({
        source: `repository variable ${name}`,
        state: "indeterminate",
        detail: `${where} — o valor vive na forja (Settings -> Variables) e NAO esta no ambiente deste processo: nao ha como provar que ele e o que os arquivos comitados declaram${fallback !== null ? ` (o YAML tem fallback '${fallback}', que e intencao declarada, nao valor)` : ""}. Remedio: rode onde a variavel existe (o job exporta \`${name}\`) ou exporte-a aqui`,
      })
      continue
    }
    const mirrors = declarations.filter((d) => d.values[name] !== undefined)
    const divergent = mirrors.filter((d) => d.values[name] !== value)
    for (const d of divergent) {
      violations.push(
        `${name}='${value}' (variavel da forja, do ambiente) diverge de ${d.label}='${d.values[name]}' — os jobs e o que o repositorio declara nao apontam para a mesma imagem`,
      )
    }
    items.push({
      source: `repository variable ${name}`,
      state: divergent.length > 0 ? "violated" : mirrors.length > 0 ? "proven" : "indeterminate",
      detail:
        divergent.length > 0
          ? `${where} — divergente de ${divergent.map((d) => d.label).join(", ")}`
          : mirrors.length > 0
            ? `${where} em ${files} arquivo(s) — '${value}' confere com ${mirrors.map((d) => d.label).join(", ")}`
            : `${where} — o valor veio do ambiente, mas NENHUM arquivo comitado declara '${name}': sem espelho comitado nao ha o que comparar (declarar a variavel e o remedio)`,
    })
  }

  // 2. Env do HOST: presente -> vira o `declared` da consulta ao registry;
  //    ausente -> NAO APLICAVEL (gitignored por desenho).
  //
  //    So o env da FORJA resolve a imagem do RUNNER: `resolveImageRef` monta
  //    `<registry>/<namespace>/ubuntu-bun:<BUN_VERSION>`, e o env da APLICACAO
  //    nao declara BUN_VERSION nenhum (o template dela, conferido no repositorio,
  //    tambem nao) — resolve-lo ali viraria "violacao" por uma variavel que
  //    aquele arquivo nunca teve. As duas stacks entram na comparacao por
  //    caminhos proprios: a da app por DECLARACAO (`compareAppHostImageDeclarations`),
  //    a da forja pelo efeito (invariante 7b) e por esta consulta ao registry.
  const forgeHost = hostEnv || GITEA_ENV_DEPLOYED.find((p) => existsSync(join(root, p))) || null
  let hostRef = null
  for (const candidate of [
    ...GITEA_ENV_DEPLOYED.map((p) => ({ path: p, label: p })),
    ...(hostEnv && !GITEA_ENV_DEPLOYED.includes(hostEnv)
      ? [{ path: hostEnv, label: hostEnv }]
      : []),
    ...APP_ENV_HOSTS.map((p) => ({ path: p, label: p })),
  ]) {
    const abs = isAbsolute(candidate.path) ? candidate.path : join(root, candidate.path)
    if (!existsSync(abs)) {
      // AUSENTE nao e INDETERMINADO. Estes arquivos sao gitignored POR DESENHO:
      // existem no host que roda a stack, nao em qualquer checkout. Tratar a
      // ausencia como "nao provei" faria o fato ficar indeterminado em TODO
      // checkout que nao seja o VPS — inclusive no CI, onde a variavel que
      // importa (a da forja) esta ao alcance. E o mesmo vocabulario que a
      // invariante 7b ja usa para o env do host: `absent` = NAO APLICAVEL aqui,
      // reportado para nao sumir em silencio.
      items.push({
        source: `env do host ${candidate.label}`,
        state: "absent",
        detail: `nao existe neste checkout (gitignored por desenho) — NAO APLICAVEL aqui; onde a stack roda, e este arquivo que o compose le`,
      })
      continue
    }
    if (APP_ENV_HOSTS.includes(candidate.path)) {
      // O env da APLICACAO que existe ja e reportado pelo item proprio dele
      // (`compareAppHostImageDeclarations`): repetir aqui o mesmo arquivo como
      // "lido" so engordaria a lista com a mesma informacao duas vezes.
      continue
    }
    const values = Object.fromEntries(parseEnvAssignments(readFileSync(abs, "utf8")))
    const isForgeHost = candidate.path === forgeHost
    const resolved = isForgeHost ? resolveImageRef(values) : null
    if (resolved?.error) {
      violations.push(`${candidate.label}: ${resolved.error}`)
      items.push({
        source: `env do host ${candidate.label}`,
        state: "violated",
        detail: resolved.error,
      })
      continue
    }
    items.push({
      source: `env do host ${candidate.label}`,
      state: "proven",
      detail: resolved
        ? `lido (env da forja): a referencia do runner deste host e ${resolved.ref}`
        : `lido (env da aplicacao): registry='${(values.IMAGE_REGISTRY ?? "").trim() || "<ausente>"}' namespace='${(values.IMAGE_NAMESPACE ?? "").trim() || "<ausente>"}'`,
    })
    if (isForgeHost && !hostRef) hostRef = resolved
  }

  // 3. O que o registry SERVE para a tag DECLARADA (a unica prova possivel sobre
  //    a tag ser um apelido mutavel — um re-tag troca a imagem de todos os jobs
  //    sem mudar uma linha do repositorio).
  //
  //    A tag vem do env do host da forja quando ele existe (e ELE que o compose
  //    interpola onde a stack roda); sem ele, do TEMPLATE COMITADO — a imagem
  //    que o repositorio declara e consultavel de qualquer checkout, inclusive
  //    no CI. Sem essa segunda fonte, o fato ficaria NAO APLICAVEL em todo lugar
  //    menos no VPS: a prova da tag sumiria justamente onde o drift de tag passa.
  const declaredSource = hostRef
    ? forgeHost
    : existsSync(join(root, GITEA_ENV_MIRROR))
      ? GITEA_ENV_MIRROR
      : null
  let declaredRef = null
  let declaredVersion = null
  if (!hostRef && declaredSource) {
    const resolved = resolveImageRef(
      Object.fromEntries(parseEnvAssignments(readFileSync(join(root, declaredSource), "utf8"))),
    )
    if (resolved.error) {
      violations.push(`${declaredSource}: ${resolved.error}`)
      items.push({
        source: `env do host/template da forja ${declaredSource}`,
        state: "violated",
        detail: resolved.error,
      })
    } else {
      declaredRef = resolved.ref
      declaredVersion = resolved.version
    }
  }
  if (hostRef) {
    declaredRef = hostRef.ref
    declaredVersion = hostRef.version
  }

  if (!probeRegistry) {
    // `--no-registry-probe`: a consulta ao registry e a UNICA parte deste fato
    // que depende de rede. Quem a desliga (o ambiente offline, um teste que
    // isola as invariantes estaticas) declara-se aqui — o passo vira NAO
    // APLICAVEL, nunca "conforme".
    items.push({
      source: "registry (o que a tag serve hoje)",
      state: "absent",
      detail: `consulta pulada (--no-registry-probe) — sem a resposta do registry a tag nao foi conferida${declaredRef ? ` (a tag declarada e ${declaredRef})` : ""}`,
    })
  } else if (!declaredRef) {
    items.push({
      source: "registry (o que a tag serve hoje)",
      state: "indeterminate",
      detail: `sem o env da forja neste checkout E sem ${GITEA_ENV_MIRROR} nao ha tag declarada para consultar — o estado das tags no registry fica fora do alcance`,
    })
  } else {
    const probeResult = await probe(declaredRef, {
      expectedVersion: declaredVersion,
      credentials,
      timeoutMs,
    })
    // `missing` e `mismatch` sao VIOLACOES (o registry respondeu e provou que a
    // imagem que o repositorio declara nao esta la / nao e o que a tag aponta);
    // `no-label`, `unauthorized`, `unreachable` e `error` sao NAO PROVADO —
    // tratar "nao sei" como "esta errado" faria o gate acusar re-tag onde so
    // falta credencial (o mesmo raciocinio da Prova das imagens antigas).
    const state =
      probeResult.state === "proven"
        ? "proven"
        : probeResult.state === "mismatch" || probeResult.state === "missing"
          ? "violated"
          : "indeterminate"
    // O REMEDIO vai junto do veredito (na violacao E no item): uma tag que nao
    // existe tem conserto conhecido, e obrigar a procurar o comando certo no
    // runbook e o tipo de atrito que faz um gate ser desligado.
    const remedy =
      probeResult.state === "missing"
        ? " — a tag que o repositorio declara nao existe: `bun run runner-image:ensure` publica (o workflow canonico e o sync-ubuntu-bun-mirror.yml)"
        : ""
    if (state === "violated") {
      violations.push(
        `${declaredRef} (o que ${declaredSource ?? "o env do host"} declara): ${probeResult.detail}${remedy}`,
      )
    }
    items.push({
      source: `registry (o que ${declaredRef} serve hoje)`,
      state,
      detail: `${probeResult.detail}${state === "proven" || state === "violated" ? "" : ` [${probeResult.state}]`}${remedy}`,
      digest: probeResult.digest ?? null,
    })
  }

  const indet = items.filter((i) => i.state === "indeterminate").length
  const absent = items.filter((i) => i.state === "absent").length
  const proven = items.filter((i) => i.state === "proven").length
  const state =
    violations.length > 0
      ? "violated"
      : indet > 0
        ? "indeterminate"
        : proven > 0
          ? "proven"
          : "absent"
  return {
    state,
    items,
    violations,
    detail:
      violations.length > 0
        ? `${violations.length} violacao(oes) nas referencias nao versionadas`
        : indet > 0
          ? `${indet} referencia(s) NAO PROVADA(S) — nenhuma foi presumida${absent > 0 ? ` (${absent} nao aplicavel(is) neste checkout)` : ""}`
          : state === "proven"
            ? `${proven} referencia(s) nao versionada(s) provadas${absent > 0 ? `, ${absent} nao aplicavel(is) neste checkout` : ""}`
            : `NADA A PROVAR neste checkout: nenhuma das ${items.length} referencia(s) e aplicavel aqui (sem env do host e sem uso de \`vars.*\` nos workflows) — ausencia de prova, nunca "conforme"`,
  }
}

// ── modo CLI (so quando invocado diretamente, nao quando importado) ────────
const isMain =
  !!process.argv[1] && process.argv[1].split(/[\\/]/).pop() === "check-registry-source.mjs"

if (isMain) {
  const argv = process.argv.slice(2)
  const skipRender = argv.includes("--no-compose-render")
  const requireCompose = argv.includes("--require-compose")
  // `--require-image`: as referencias nao versionadas (variaveis da forja, env
  // do host, o que o registry serve) NAO podem ficar indeterminadas. Onde isso
  // e obrigatorio (o host que sobe a stack, um job com credencial) exigir a
  // prova e o ponto; onde nao e (a maquina do dev), exigi-la viraria ruido que
  // ninguem consegue silenciar.
  const requireImage = argv.includes("--require-image")
  // `--no-registry-probe`: nao consulta o registry (unica parte do fato que
  // depende de rede). `--require-image` + `--no-registry-probe` e contraditorio
  // — pedir a prova e pedir para nao prova-la —, e resolver a contradicao em
  // silencio escolheria por quem pediu (mesma regra do --require-compose).
  const skipProbe = argv.includes("--no-registry-probe")
  // `--review`: as decisoes de escopo SEM REVISAO (passada a janela de
  // OUT_OF_SCOPE_REVIEW_DAYS) viram VIOLACAO — o exit 1 e o CANAL do job
  // semanal, porque um aviso dentro de um run verde nao e lido por ninguem.
  // Fora do modo normal (pre-commit/PR) a decisao vencida so AVISA: ela nao
  // pode bloquear o trabalho de todo mundo por uma data.
  const reviewMode = argv.includes("--review")
  // `--gitea-env <caminho>`: o env do HOST a comparar com o template comitado.
  const hostEnvIdx = argv.indexOf("--gitea-env")
  const hostEnv = hostEnvIdx === -1 ? null : argv[hostEnvIdx + 1] || ""
  // Pergunta EXPLICITA ("compare ESTE arquivo"): um caminho ausente NAO pode
  // virar "em sincronia" — seria ler o resultado de uma comparacao que nao
  // houve. Mesmo contrato do --gitea-env do check-actrc-sync.
  const hostEnvExists =
    typeof hostEnv === "string" &&
    hostEnv !== "" &&
    existsSync(isAbsolute(hostEnv) ? hostEnv : join(process.cwd(), hostEnv))
  if (hostEnvIdx !== -1 && !hostEnvExists) {
    console.error(
      `check-registry-source: --gitea-env aponta para um arquivo inexistente: ${hostEnv || "<vazio>"}`,
    )
    console.error(
      "  Uso: node scripts/check-registry-source.mjs [--require-compose] [--no-compose-render] [--gitea-env <caminho>] [--require-image] [--no-registry-probe] [--review]",
    )
    process.exit(2)
  }
  if (requireImage && skipProbe) {
    console.error(
      "check-registry-source: ❌ --require-image com --no-registry-probe: pedir a prova das referencias nao versionadas E pedir para nao consultar o registry sao instrucoes contraditorias.",
    )
    console.error(
      "  Escolha uma: `--require-image` (a prova e obrigatoria; o registry tem de responder) ou `--no-registry-probe` (rode offline e leia o que ficou NAO PROVADO).",
    )
    process.exit(3)
  }
  // Um workflow de forja que não abre não vira "nenhuma referência": a fonte
  // única não pode ser AFIRMADA sobre um arquivo que o guard não leu. A
  // varredura é a COMPARTILHADA (fonte única) e o guard para com 2, nomeando o
  // arquivo (antes, o `readFileSync` de `forgeVariableRefs` estourava com stack
  // trace — exit 1, "violação", que aqui significa referência hardcoded).
  exitOnUnjudgeable(readWorkflowScan(ROOT).unjudgeable)
  const scopeSweep = sweepOutOfScope()
  // DECISAO SEM REVISAO: visivel em TODO run (o aviso sai mesmo quando outra
  // violacao ja derruba o guard) e escalada a violacao por `--review`.
  if (!reviewMode) {
    for (const a of scopeSweep.aged) {
      console.error(
        `::warning:: check-registry-source: a decisao de escopo de ${a.path} (OUT_OF_SCOPE_ALLOWLIST, tomada em ${a.addedAt}) esta SEM REVISAO ha ${a.days} dia(s) (janela de ${a.limit}).` +
          " Revise o motivo e, se ele continua valendo, atualize o `addedAt`; se nao, remova a entrada." +
          " Uma isencao que ninguem revisa vira permanente por esquecimento.",
      )
    }
    // A OUTRA allowlist deste guard envelhece igual: o aviso sai em TODO run
    // (mesmo quando outra violacao ja derruba o guard) e o job semanal o escala
    // a violacao por `--review`.
    for (const a of sweepThirdPartyAllowlist().aged) {
      console.error(
        `::warning:: check-registry-source: o consumo da imagem de TERCEIROS ${a.id} (THIRD_PARTY_ALLOWLIST, decidido em ${a.addedAt}) esta SEM REVISAO ha ${a.days} dia(s) (janela de ${a.limit}).` +
          " Confirme que a imagem continua sendo de terceiros (o projeto ainda nao publica espelho proprio) e atualize o `addedAt`; se o consumo acabou, remova a entrada." +
          " Uma isencao que ninguem revisa vira permanente por esquecimento.",
      )
    }
  }
  // INVARIANTE 9: a varredura por VALOR roda UMA vez — o mesmo resultado vai
  // para a lista de violações e para o relatório do que ficou INDETERMINADO.
  const imageDefaults = sweepImageDefaultValues(ROOT)
  for (const item of imageDefaults.indeterminate) {
    console.error(
      `::warning:: check-registry-source: default INDETERMINADO — ${item}.` +
        " O guard não presume: sem o valor declarado não há comparação, e um ✅ aqui seria pior que o aviso.",
    )
  }
  const staticViolations = [
    ...findViolations(ROOT, { sweep: scopeSweep, failAged: reviewMode, imageDefaults }),
    ...compareImageTemplates(),
  ]
  const interpolation = skipRender
    ? {
        state: "skipped",
        violations: [],
        phases: [],
        hostCompare: { state: "skipped", detail: "pulada por --no-compose-render" },
        detail: "pulada por --no-compose-render",
      }
    : checkComposeInterpolation({ hostEnv })

  const nonVersioned = await checkNonVersionedImageRefs({ hostEnv, probeRegistry: !skipProbe })
  // As violacoes do fato novo entram na MESMA lista (o `compareImageTemplates`
  // ja entrou acima por ser offline; aqui vem o resto: valor do ambiente que
  // diverge dos espelhos, env do host sem imagem, re-tag no registry).
  const violations = [
    ...staticViolations,
    ...interpolation.violations,
    ...nonVersioned.violations.filter((v) => !staticViolations.includes(v)),
  ]

  // Com --require-compose SO `proven` passa. `skipped` entra aqui de propósito:
  // pedir o render OBRIGATORIO e pedir para NAO renderizar sao instrucoes
  // contraditorias, e escolher uma precedencia em silencio seria pior que falhar.
  // `violated` NAO entra: uma interpolacao de fato violada (variavel vazia, valor
  // literal) tem o seu proprio relatorio, mais especifico, abaixo.
  const unprovenRequired = requireCompose && !["proven", "violated"].includes(interpolation.state)
  if (unprovenRequired) {
    console.error(
      `check-registry-source: ❌ --require-compose: o render do ${GITEA_COMPOSE} ${REQUIRE_COMPOSE_FAIL_MARK} (${interpolation.state}) — ${interpolation.detail}.`,
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

  // INDETERMINADO: o guard nao presume. Exigido (`--require-image`), falha; no
  // modo portatil, ele DIZ o que nao provou — e a diferenca entre os dois modos
  // e o ambiente, nao a regra.
  const unprovenImage = requireImage && nonVersioned.state !== "proven"
  if (unprovenImage) {
    console.error(
      `check-registry-source: ❌ --require-image: as referencias NAO VERSIONADAS da imagem NAO foram provadas (${nonVersioned.detail}).`,
    )
    // So o que NAO FOI PROVADO entra na lista de pendencias: um arquivo
    // gitignored que nao existe neste checkout e "nao aplicavel", e lista-lo
    // aqui faria a pendencia parecer maior do que e.
    for (const item of nonVersioned.items.filter(
      (i) => i.state === "indeterminate" || i.state === "violated",
    )) {
      console.error(`  - ${item.source} [${item.state}]: ${item.detail}`)
    }
    console.error(
      "  Aqui a prova e exigida: rode onde o valor existe (o CI exporta `vars.*`) ou exporte as variaveis/credencial" +
        " (IMAGE_REGISTRY, IMAGE_NAMESPACE, BUN_VERSION, GHCR_TOKEN). Sem isso a referencia da imagem fica NAO VERIFICADA —" +
        " e um gate verde sobre o que nao foi verificado e pior que um vermelho.",
    )
    process.exit(1)
  }

  if (violations.length === 0) {
    console.log("check-registry-source: ✅ registry com fonte unica (IMAGE_REGISTRY).")
    // O fato novo sai SEMPRE (nao so quando ha violacao): e ele que diz o que
    // ficou indeterminado — esconder isso num modo verboso seria o alerta mudo.
    // `absent` NAO e ✅ (nao se provou nada) nem ❌ (nao ha nada errado aqui): o
    // mesmo "·" dos outros nao aplicaveis, com o texto dizendo por que.
    for (const item of nonVersioned.items) {
      const mark = item.state === "proven" ? "✅" : item.state === "violated" ? "❌" : "·"
      console.log(`check-registry-source: ${mark} ${item.source}: ${item.detail}`)
    }
    console.log(
      `check-registry-source: ${nonVersioned.state === "proven" ? "✅" : "·"} referencias nao versionadas: ${nonVersioned.detail}`,
    )
    // O fato da invariante 9 sai SEMPRE (nao so quando ha violacao): e ele que
    // diz quantos defaults foram conferidos por valor, e quantos ficaram FORA da
    // comparação (dinâmicos) — esconder isso num modo verboso seria o alerta mudo.
    console.log(
      `check-registry-source: ✅ defaults de ${REGISTRY_VARIABLES.join("/")} conferidos por VALOR: ` +
        `${imageDefaults.compared} default(s) em ${imageDefaults.files.length} arquivo(s), nenhum divergente do declarado` +
        (imageDefaults.dynamic > 0
          ? ` (${imageDefaults.dynamic} fallback(s) DINAMICO(s) fora da comparacao: nao sao afirmacao de valor)`
          : "") +
        (imageDefaults.prose > 0
          ? ` (${imageDefaults.prose} ocorrencia(s) na forma de OUTRA familia (mensagem/fixture) — contadas, nao comparadas: nao ha valor rodando para envelhecer)`
          : "") +
        (imageDefaults.fixtures.length > 0
          ? ` (${imageDefaults.fixtures.length} arquivo(s) de FIXTURE fora da varredura pela regra ${IMAGE_DEFAULT_FIXTURE_RULES.map((r) => `\`${r.id}\``).join(", ")} — ex.: ${imageDefaults.fixtures[0]}: o texto deles e o PAYLOAD das provas por mutacao, nao um site de resolucao)`
          : "") +
        (imageDefaults.indeterminate.length > 0
          ? ` — ${imageDefaults.indeterminate.length} INDETERMINADO(s), nomeado(s) nos avisos`
          : ""),
    )
    // O que as REGRAS deixaram fora da varredura das referências. Mesma régua da
    // exclusão por fixture acima: uma exclusão por CLASSE que não se nomeia é um
    // alvo invisível com outro nome — e é justamente o que esta varredura fecha.
    if (scopeSweep.excluded.total > 0) {
      console.log(
        `check-registry-source: · referencias fora da varredura por REGRA: ${scopeSweep.excluded.total} arquivo(s) — ` +
          scopeSweep.excluded.byRule
            .map((r) => `${r.count} \`${r.id}\` (ex.: ${r.example})`)
            .join(", "),
      )
    }
    if (interpolation.state === "proven") {
      console.log(
        `check-registry-source: ✅ ${COMPOSE_RENDER_PROVEN_MARK} — ${interpolation.detail}`,
      )
      const hc = interpolation.hostCompare
      if (hc?.state === "in-sync") {
        console.log(`check-registry-source: ✅ ${hc.detail}`)
      } else if (hc?.state === "absent") {
        console.log(`check-registry-source: · host x template nao aplicavel: ${hc.detail}`)
      }
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
  if (interpolation.hostCompare?.state === "diverged") {
    console.error(
      `O env do HOST diverge do template comitado (${GITEA_ENV_MIRROR}) — o que o VPS interpola nao e o que o repositorio declara.` +
        " Corrija o lado errado (ou aponte --gitea-env para o env certo), suba a stack de novo e RE-REGISTRE o runner:" +
        " `bash deploy/gitea-up.sh --re-register` (os labels sao estado do registro, nao config do container).",
    )
  }
  process.exit(1)
}
