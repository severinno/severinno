#!/usr/bin/env node

// =============================================================================
// check-forge-parity.mjs
//
// Usage:
//   node scripts/check-forge-parity.mjs
//   node scripts/check-forge-parity.mjs --gates      # lista os gates descobertos
//
// Exit code:
//   0 — classificacao completa e paridade do CORE mantida
//   1 — gate nao classificado, invariante do CORE ausente ou classificacao stale
//
// Guard da PARIDADE DE GATES entre a forja que e dona do merge (Gitea/Forgejo,
// .gitea/workflows/ci.yml) e o espelho no GitHub (.github/workflows/pr-check.yml)
// — E, principalmente, da COMPLETUDE da classificacao.
//
// POR QUE: o projeto migra o contrato de bloqueio para a forja self-hosted,
// mantendo o GitHub como espelho. Nesse desenho, um gate que existe em UMA
// pipeline e nao na outra e um BURACO SILENCIOSO: o PR passa verde pela pipeline
// que roda e ninguem percebe que a invariante nao foi verificada.
//
// A PRIMEIRA VERSAO DESTE GUARD TINHA UM DEFEITO DE RACIOCINIO, e ele vale
// ficar registrado porque e o que este arquivo passou a impedir: o guard
// comparava as pipelines contra uma lista CORE escrita A MAO. A lista tinha 10
// itens; o pr-check.yml executava ~30 gates. Os ~20 restantes eram invisiveis
// ao guard — e ele passava VERDE, dando a impressao de que a forja bloqueava o
// merge. Na pratica faltavam na forja, entre outros, a auditoria de dependencias
// (`check-bun-audit-baseline`), a baseline de segredos (`rotate-secrets --check`)
// e o guard de hooks de seed. Um guard que da falsa seguranca e pior que guard
// nenhum: converte "nao verificado" em "parece verificado".
//
// CORRECAO: o guard DESCOBRE os gates das duas pipelines e exige que cada um
// esteja classificado. Tres desfechos possiveis para um gate:
//   - CORE         → precisa rodar nas DUAS pipelines;
//   - GITHUB_ONLY  → isento, COM RAZAO ESCRITA (nao pode rodar na forja);
//   - nada         → VIOLACAO. Um gate novo adicionado ao pr-check.yml Nao
//                    consegue pular a forja em silencio: o PR falha ate alguem
//                    classifica-lo. E a mesma logica do check:required-checks
//                    (um required check inexistente nao falha, ele ESPERA).
//
// O QUE CONTA COMO GATE (regra declarada, nao lista a mao):
//   1. `scripts/<nome>` cujo basename comeca com check-, validate-, audit-,
//      test-mutation- ou run-;
//   2. qualquer comando com `--check`/`--ci` (modo de verificacao explicito) —
//      cobre `rotate-secrets.mjs --check`, que nao segue o prefixo;
//   3. `bun run <entry>` com entry check:/validate:/test-mutation:/lint/test:*;
//   4. `tsc --noEmit` (typecheck);
//   5. `uses: ./<forge>/workflows/<arquivo>.yml` (workflow reutilizavel local =
//      ponto de entrada de gates);
//   6. `bun run <x>:prove` / `node scripts/prove-*.mjs` — a familia das PROVAS
//      por EXECUCAO ("o comportamento e este", medido rodando o caminho real).
//      Entram pelo mesmo motivo das outras: uma prova que roda numa forja e nao
//      na outra deixa o PR verde por onde rodou.
// Plumbing (install, db:generate, build, docker ...) NAO e gate: nao declara
// verificacao. Se um comando de verificacao nao se encaixa, ele entra por
// `--check` ou por um novo prefixo aqui — nunca por uma excecao ad hoc.
//
// Invariantes:
//   1. Todo gate descoberto esta classificado (nada de gate invisivel).
//   2. Todo invariante do CORE roda nas DUAS pipelines.
//   3. Um gate classificado como GITHUB_ONLY nao roda na forja (classificacao
//      que envelheceu e vira ruido/mentira — tem que ser corrigida).
//   4. Comentarios sao ignorados (o guard protege o que EXECUTA).
// =============================================================================

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = process.cwd()

/**
 * Pipelines comparadas. `mergeOwner` marca a forja que deve BLOQUEAR o merge
 * (ela e a referencia do desenho; o GitHub e espelho).
 */
export const PIPELINES = [
  {
    forge: "gitea",
    file: ".gitea/workflows/ci.yml",
    mergeOwner: true,
  },
  {
    forge: "github",
    file: ".github/workflows/pr-check.yml",
    mergeOwner: false,
  },
]

// ── Descoberta de gates ────────────────────────────────────────────────────

const SCRIPT_INVOCATION_RE =
  /\b(?:node|bun|bash|sh|python3?)\s+(scripts\/[A-Za-z0-9_./-]+\.(?:mjs|sh|py))/g
const ENTRY_RE = /\bbun\s+run\s+([a-z0-9][a-z0-9:_-]*)/g
const REUSABLE_RE = /uses:\s*(\.\/\.[A-Za-z0-9_.-]+\/workflows\/[A-Za-z0-9_.-]+\.ya?ml)/g

/** Prefixos de basename de script que declaram verificacao. */
export const GATE_SCRIPT_PREFIX_RE = /^(check|validate|audit|test-mutation|run|prove)-/

/** Prefixos de entry do package.json que declaram verificacao. */
export const GATE_ENTRY_PREFIX_RE = /^(check|validate|test-mutation):/

/**
 * Entries de PROVA POR EXECUCAO (`<contexto>:prove`).
 *
 * O prefixo NAO pode ser `check:`: `runner-image:prove` nomeia o CONTEXTO que a
 * prova exercita, nao a familia do comando — renomea-lo para caber na lista
 * anterior seria ajustar o nome ao guard, e nao o guard ao nome.
 */
export const GATE_ENTRY_PROVE_RE = /^[a-z0-9][a-z0-9-]*:prove$/

/** Entries estruturais (as tres invariantes basicas de qualquer projeto). */
export const STRUCTURAL_ENTRIES = ["lint", "test:unit", "test:run", "test:ci"]

/** Modo de verificacao explicito — promove o comando a gate. */
const CHECK_FLAG_RE = /--(?:check|ci)\b/

/** Typecheck: `bunx tsc --noEmit` / `tsc --noEmit`. */
const TSC_RE = /\btsc\s+--noEmit\b/

/**
 * Remove comentario de YAML: linha inteira (`# ...`) e inline (`chave: v # ...`).
 * O `#` so inicia comentario precedido de espaco (ou no inicio da linha).
 *
 * @param {string[]} lines
 * @returns {string[]} as linhas executaveis
 */
export function executableLines(lines) {
  return lines
    .map((line) => (line.trim().startsWith("#") ? "" : line.replace(/(^|\s)#.*$/, "$1").trimEnd()))
    .filter((line) => line.trim() !== "")
}

/**
 * Descobre os gates executados por uma pipeline. Retorna rotulos legiveis (o
 * proprio comando normalizado), que sao o que a classificacao casa.
 *
 * @param {string} content  conteudo do arquivo de workflow
 * @returns {string[]} rotulos ordenados e unicos
 */
export function discoverGates(content) {
  const gates = new Set()
  for (const line of executableLines(content.split(/\r?\n/))) {
    for (const m of line.matchAll(SCRIPT_INVOCATION_RE)) {
      const path = m[1]
      const base = path.split("/").pop()
      // Gate por convencao de nome OU por modo de verificacao explicito.
      if (GATE_SCRIPT_PREFIX_RE.test(base) || CHECK_FLAG_RE.test(line)) gates.add(path)
    }
    for (const m of line.matchAll(ENTRY_RE)) {
      const entry = m[1]
      if (
        GATE_ENTRY_PREFIX_RE.test(entry) ||
        STRUCTURAL_ENTRIES.includes(entry) ||
        GATE_ENTRY_PROVE_RE.test(entry)
      ) {
        gates.add(`bun run ${entry}`)
      }
    }
    for (const m of line.matchAll(REUSABLE_RE)) gates.add(`uses: ${m[1]}`)
    if (TSC_RE.test(line)) gates.add("tsc --noEmit")
  }
  return [...gates].sort()
}

// ── Classificacao ──────────────────────────────────────────────────────────

/**
 * Invariantes que DEVEM rodar nas duas pipelines: agnosticas de forja e capazes
 * de quebrar o software (correcao) ou a seguranca se puladas.
 *
 * `matches` e testado contra o ROTULO do gate descoberto (ex.:
 * "scripts/check-bun-mirror.mjs", "bun run lint", "tsc --noEmit"), por isso as
 * regexes aceitam as duas sintaxes (`check-x.mjs` e `check:x`).
 *
 * @type {{ id: string, matches: RegExp, why: string }[]}
 */
/**
 * Invariantes que DEVEM rodar nas duas pipelines: agnosticas de forja e capazes
 * de quebrar o software (correcao) ou a seguranca se puladas.
 *
 * `matches` é testado contra o ROTULO do gate descoberto (ex.:
 * "scripts/check-bun-mirror.mjs", "bun run lint", "tsc --noEmit"), por isso as
 * regexes aceitam as duas sintaxes (`check-x.mjs` e `check:x`).
 *
 * `jobIds` mapeia a invariante ao(s) job(s)对应的 no manifesto de merge
 * (`ci/required-checks.json`), por forja. Quando um job é composto (ex.:
 * o `guards` da Gitea que roda vários scripts), a invariante aponta para esse
 * job e o doctor confere se o COMANDO do gate aparece na linha `run:` dele.
 * Invariantes sem `jobIds` (ex.: as que rodam só no GitHub como mutation tests)
 * são verificadas apenas pelo classifyGate — o contrato de merge não as lista
 * como jobs individuais.
 *
 * @type {{ id: string, matches: RegExp, why: string,
 *   jobIds?: Record<string, string> }[]}
 */
export const CORE_INVARIANTS = [
  {
    id: "typecheck",
    matches: /tsc --noEmit/,
    why: "tipo errado que compila e o modo classico de bug silencioso em producao",
    jobIds: { gitea: "typecheck", github: "typecheck" },
  },
  {
    id: "lint",
    // Flag `m`: o mesmo regex e testado contra o ROTULO de um gate (linha unica)
    // E contra o conteudo inteiro da pipeline (multi-linha) em missingInvariants.
    matches: /^bun run lint$/m,
    why: "regra de lint que so existe no editor deixa o repositorio divergir do padrao",
    jobIds: { gitea: "lint", github: "lint-guard" },
  },
  {
    id: "tests",
    matches: /^bun run test:(unit|run|ci)$/m,
    why: "a suite e a rede de seguranca das outras invariantes",
    jobIds: { gitea: "test", github: "check" },
  },
  {
    id: "ts-nocheck",
    matches: /check[:-]ts[:-]nocheck/,
    why: "@ts-nocheck desliga a verificacao de tipos do arquivo — a porta dos fundos do typecheck",
    jobIds: { gitea: "guards" },
  },
  {
    id: "pii-allowlist",
    matches: /check[:-]pii[:-]allowlist/,
    why: "vazamento de campo sensivel em payload de usuario (CPF/e-mail/endereco)",
    jobIds: { github: "pii-allowlist-guard" },
  },
  {
    id: "pii-gate-self-test",
    matches: /check[:-]pii[:-]gate/,
    why: "sem a auto-prova, o guard de PII pode estar verde por nunca ter disparado",
    jobIds: { github: "pii-allowlist-guard" },
  },
  {
    id: "required-checks",
    matches: /check[:-]required[:-]checks/,
    why: "required check inexistente NAO falha: faz o PR esperar para sempre",
    jobIds: { gitea: "guards" },
  },
  {
    id: "bring-up-env-gate-proof",
    // O PRÉ-REQUISITO 0 do bring-up (o env do host espelha o template comitado),
    // provado por EXECUÇÃO: o `gitea-up.sh` real roda contra um env divergente e
    // tem de RECUSAR antes de qualquer docker. O `checkGiteaBringUp` prende a
    // ORDEM no texto do script — e texto não distingue bloquear de estar
    // quebrado (um script que aborta por qualquer motivo também não sobe nada).
    matches: /runner-image:prove|prove-runner-image-gate/,
    why: "sem a prova executada, 'o passo 0 recusa' volta a ser uma afirmação sobre o TEXTO do gitea-up.sh",
    jobIds: { gitea: "bring-up-proof", github: "bring-up-proof" },
  },
  {
    id: "registry-source",
    matches: /check[:-]registry[:-]source/,
    why: "registry hardcoded reacopla o projeto a um registry proprietario com cota",
    jobIds: { gitea: "guards" },
  },
  {
    id: "doctor-ci",
    // O GATE de PR (`check-doctor-ci.mjs`), não o doctor em si: o doctor é o
    // motor, e o publicador da issue (`forge-doctor-issue.mjs`) é do cron.
    matches: /check[:-]doctor[:-]ci/,
    why: "o VALOR das repository variables nos espelhos e nas referencias nao versionadas é o que um PR esquece de acompanhar: o espelho velho nao quebra nada visivel (o setup-bun funciona igual, só mais lento, e o pull da imagem só falha quando um job inicia). O doctor no perfil --ci compara esse valor a CADA PR e BLOQUEIA na divergencia, em vez de deixar a pergunta para o cron semanal",
    jobIds: { github: "doctor-mirrors-guard" },
  },
  {
    id: "runner-base",
    matches: /check[:-]runner[:-]base/,
    why: "a base do Dockerfile do runner e uma tag FLUTUANTE: um rebuild troca a imagem (e o plugin `compose` que a invariante 7 usa) sem nenhuma linha do repositorio mudar",
    jobIds: { gitea: "guards" },
  },
  {
    id: "workflow-refs",
    matches: /check[:-]workflow[:-]refs/,
    why: "referencia pendurada entre workflow e script quebra a pipeline em runtime",
    jobIds: { github: "workflow-refs-guard" },
  },
  {
    id: "forge-workflow-scope",
    matches: /check[:-]forge[:-]workflow[:-]scope/,
    why: "cravar um diretorio de forja deixa as OUTRAS forjas fora da varredura dos guards",
    jobIds: { gitea: "guards" },
  },
  {
    id: "bun-audit",
    // Ancorado em `check-...`/`check:`: o test-mutation-bun-audit-baseline.sh é
    // o TESTE do guard (roda só onde o mutation roda), não o guard em si.
    matches: /check[:-]bun[:-]audit/,
    why: "dependencia com vulnerabilidade conhecida entrando pelo merge",
  },
  {
    id: "forge-parity",
    matches: /check[:-]forge[:-]parity/,
    why: "o proprio contrato de merge (esta lista) precisa ser verificado onde o merge acontece, senao a forja bloqueia por um contrato que ninguem audita",
    jobIds: { gitea: "guards" },
  },
  {
    id: "hooks-symmetry",
    matches: /check[:-]hooks[:-]symmetry/,
    why: "hook/guard documentado que nao existe no repositorio e uma protecao FANTASMA: o README promete o que o codigo nao faz",
    jobIds: { github: "hooks-symmetry-guard" },
  },
  {
    id: "secret-leaks",
    matches: /rotate-secrets/,
    why: "segredo versionado por engano (.env, chave, token) — vazamento permanente no historico",
    jobIds: { github: "secrets-guard" },
  },
  {
    id: "seed-hooks",
    matches: /check[:-]seed[:-]hooks/,
    why: "SEED_SPEC_PATCH/PROD_SEED_ALLOW_DEV sao TEST-ONLY: vazando para o caminho de DEPLOY, o seed de producao roda com spec patchado",
    jobIds: { github: "seed-hooks-guard" },
  },
  {
    id: "sentinel-producer",
    matches: /check[:-]sentinel[:-]producer/,
    why: "sentinel orfao cria guarda CEGA: o grep nunca acende e 'nao achou' vira falso positivo de 'limpo'",
    jobIds: { github: "sentinel-producer-guard" },
  },
  {
    id: "bun-mirror",
    matches: /check[:-]bun[:-]mirror/,
    why: "versao do Bun com multiplos pontos de verdade faz duas pipelines construirem runtimes diferentes",
    jobIds: { github: "bun-mirror-guard" },
  },
  {
    id: "no-setup-bun",
    matches: /check[:-]no[:-]setup[:-]bun/,
    why: "o action externo re-baixa o release do Bun em todo job (~25-35s) — regressao ja corrigida que nao pode voltar",
    jobIds: { github: "no-setup-bun-guard" },
  },
  {
    id: "script-headers",
    matches: /check-script-headers/,
    why: "script sem Usage/Exit code no cabecalho e operacao por adivinhacao: quem chama nao sabe o que ele devolve nem o que ele faz de efeito — e os gates que decidem o merge nao podem depender disso",
    jobIds: { gitea: "guards" },
  },
  {
    id: "prove-docs",
    matches: /check[:-]prove[:-]docs/,
    why: "a familia prove-*/doctor e o que responde 'a forja pode confiar o merge a este gate?': uma doc que descreve a saida de ANTES mente com aparencia de rigor, e quem opera a forja decide sobre ela — o guard e hermetico (~1s) e roda com o docker ausente de proposito nas provas que exigem docker",
    jobIds: { gitea: "guards" },
  },
]

/**
 * Gates que NAO devem rodar na forja, cada um com a razao escrita. A razao tem
 * que ser sobre a FORJA (o gate depende de um servico/API que so o GitHub tem),
 * nunca sobre conveniencia — "da trabalho" nao e razao.
 *
 * @type {{ id: string, matches: RegExp, reason: string }[]}
 */
export const GITHUB_ONLY = [
  {
    id: "actionlint",
    matches: /actionlint/,
    reason:
      "valida a SINTAXE dos workflows do GitHub com o binario actionlint — a forja tem o proprio validador de YAML",
  },
  {
    id: "dependency-review",
    matches: /dependency-review/,
    reason:
      "action do GitHub que consulta o advisory database da plataforma pelo diff do PR; a CAPACIDADE equivalente na forja e o bun-audit (CORE)",
  },
  {
    id: "gist-crossover",
    matches: /gist[:-]crossover/,
    reason: "gist e recurso exclusivo do GitHub — o gate inteiro nao tem equivalente fora dele",
  },
  {
    id: "github-script",
    matches: /github-script/,
    reason: "usa actions/github-script (API do GitHub) para comentar/resumir no PR",
  },
  {
    id: "mutation-coord-timing-act",
    matches: /mutation-coord-timing-act/,
    reason:
      "mede o tempo do mutation test SOB o act com a imagem ubuntu-bun — benchmarking do runner do GitHub, nao uma invariante de codigo",
  },
  {
    id: "mutation-suite",
    matches: /test-mutation|check[:-]mutation[:-](count|jobs)/,
    reason:
      "o SUJEITO do gate sao os jobs de mutation test, que existem apenas no pipeline do GitHub (custo/duracao); a forja nao os executa, entao nao ha o que conferir lá",
  },
  {
    id: "e2e-counts",
    matches: /check[:-]e2e[:-]counts/,
    reason:
      "confere os counts de checks DOCUMENTADOS nos comentarios de pr-check.yml/seed-guards.yml — o sujeito e o proprio pipeline do GitHub",
  },
  {
    id: "seed-count-literals",
    matches: /check[:-]seed[:-]count[:-]literals/,
    reason:
      "confere literais de contagem nos arquivos de seed/CI do pipeline do GitHub (sujeito = pipeline, nao o produto)",
  },
  {
    id: "seed-e2e",
    matches: /Seed E2E|seed-guards/,
    reason:
      "E2E de seed (prod+dev) com PostGIS efemero — so roda no GitHub self-hosted com service containers; a forja nao tem o cenario",
  },
  {
    id: "jsdom-baseline",
    matches: /check[:-]jsdom[:-]baseline/,
    reason:
      "roda a suite jsdom de componentes (que o test:unit EXCLUI) e compara com um BASELINE de falhas: mede DRIFT, nao bloqueia defeito novo — e a forja já roda o test:run, mais amplo",
  },
  {
    id: "unused-deps",
    matches: /check[:-]unused[:-]deps/,
    reason:
      "dependencia nao usada e DIVIDA de manutencao, nao defeito que chega ao main; fica no pipeline que tem folga de tempo",
  },
  {
    id: "readme-integrity",
    matches: /check[:-]readme/,
    reason:
      "integridade de links/anchors/TOC da DOCUMENTACAO — nao e o que entra no main; roda onde a documentacao e publicada",
  },
  {
    id: "seed-guards-reusable",
    matches: /uses:.*seed-guards\.yml/,
    reason:
      "workflow reutilizavel dos E2Es de seed: depende da topologia de servicos efemeros (PostGIS) provisionada pelo runner do GitHub",
  },
  {
    id: "tier1-fastpath",
    matches: /tier1[:-]fastpath|check-tier1/,
    reason:
      "mede o fastpath do setup-bun sob o act; a forja roda o mesmo composite, mas a medicao e do runner do GitHub (nao bloqueia correcao)",
  },
  {
    id: "tier2-cache-restore",
    matches: /tier2[:-]cache|check-tier2/,
    reason:
      "mede o restore do actions/cache — a forja nao usa actions/cache (o cache e do runner), entao o gate nao tem o que medir la",
  },
  {
    id: "benchmark",
    matches: /^bun run bench|bench|validate-gist/,
    reason:
      "jobs de benchmark/cron publicam no GitHub (gist, comentario de PR) — saida especifica da plataforma",
  },
  {
    id: "security-headers",
    matches: /security-headers/,
    reason:
      "verifica as headers de seguranca via actions/upload-artifact + resumo do PR; a assercao e GitHub-flavored (a forja valida o mesmo via teste de codigo)",
  },
  {
    id: "all-text-alert",
    matches: /validate-all-text-alert|all-text-alert/,
    reason:
      "valida o alerta automatico de texto puro, que existe nos workflows do GitHub (deprecacao da plataforma)",
  },
  {
    id: "blob-crlf-history",
    matches: /blob-crlf-history/,
    reason:
      "varre o HISTORICO de blobs do repositorio do GitHub (API/historico remoto); o equivalente local roda no pre-commit de quem tem o clone",
  },
  {
    id: "fuzz",
    matches: /(^|\s)fuzz|fuzz[:-]ci/,
    reason: "job de fuzz de longa duracao agendado como cron/reusable no GitHub",
  },
  {
    id: "encoding-recheck",
    matches: /check-utf8\.sh|audit-blob-crlf-history\.sh|check-blob-crlf\.sh/,
    reason:
      "roteiro de encoding que o pre-commit ja roda em TODO commit local (barato); a forja cobre a invariante pelo run-encoding-guards do proprio commit",
  },
]

/**
 * Classifica um gate descoberto.
 *
 * @param {string} gate  rotulo retornado por discoverGates
 * @returns {"core"|"github-only"|null} null = NAO CLASSIFICADO (violacao)
 */
export function classifyGate(gate) {
  if (CORE_INVARIANTS.some((i) => i.matches.test(gate))) return "core"
  if (GITHUB_ONLY.some((g) => g.matches.test(gate))) return "github-only"
  return null
}

/**
 * Invariantes do CORE ausentes numa pipeline (mantida por compatibilidade com o
 * contrato anterior do guard/testes).
 *
 * @param {string} content
 * @param {{ id: string, matches: RegExp }[]} invariants
 * @returns {string[]} ids ausentes
 */
export function missingInvariants(content, invariants = CORE_INVARIANTS) {
  // Presenca e definida pelos GATES DESCOBERTOS, nao pelo texto cru: o mesmo
  // regex e testado contra o rotulo normalizado ("bun run lint") e o rotulo nao
  // carrega o `- run: ` do YAML. Testar contra o conteudo cru obrigaria a
  // regex a casar indentacao e prefixo — e foi assim que `lint`/`tests`
  // apareceram como ausentes nas duas pipelines ao mesmo tempo.
  const gates = discoverGates(content)
  return invariants.filter((inv) => !gates.some((g) => inv.matches.test(g))).map((inv) => inv.id)
}

/**
 * Compara as pipelines declaradas e devolve as violacoes (vazio = ok).
 * Pura em relacao ao filesystem: recebe um leitor para poder ser testada sem
 * tocar o disco.
 *
 * @param {(path: string) => string|null} readFile
 * @param {{ forge: string, file: string, mergeOwner: boolean }[]} pipelines
 * @returns {string[]}
 */
export function findParityViolations(readFile, pipelines = PIPELINES) {
  const violations = []
  const discovered = new Map()

  for (const pipeline of pipelines) {
    const content = readFile(pipeline.file)
    if (content === null) {
      violations.push(
        `${pipeline.file}: pipeline declarada nao existe — se a forja foi removida, remova-a de PIPELINES (nao deixe o guard cobrindo um arquivo fantasma)`,
      )
      continue
    }
    const role = pipeline.mergeOwner ? "dona do merge" : "espelho"
    const gates = discoverGates(content)
    discovered.set(pipeline.forge, gates)

    // 1. Completude: nenhum gate pode ficar sem classificacao.
    for (const gate of gates) {
      const kind = classifyGate(gate)
      if (kind === null) {
        violations.push(
          `${pipeline.file} (${pipeline.forge}, ${role}): gate '${gate}' NAO CLASSIFICADO — decida e registre: CORE (roda nas duas pipelines) ou GITHUB_ONLY (isento, com razao escrita em GITHUB_ONLY). Um gate novo nao pode pular a forja em silencio.`,
        )
      }
      if (kind === "github-only" && pipeline.mergeOwner) {
        const entry = GITHUB_ONLY.find((g) => g.matches.test(gate))
        violations.push(
          `${pipeline.file} (${pipeline.forge}, ${role}): gate '${gate}' esta classificado como GITHUB_ONLY mas RODA aqui — classificacao stale (razao registrada: ${entry?.reason ?? "?"}). O gate roda na forja ou a classificacao mente: escolha um.`,
        )
      }
    }

    // 2. Obrigacao: todo invariante do CORE roda aqui.
    for (const id of missingInvariants(content)) {
      const inv = CORE_INVARIANTS.find((i) => i.id === id)
      violations.push(
        `${pipeline.file} (${pipeline.forge}, ${role}): invariante do CORE '${id}' NAO roda aqui — ${inv?.why ?? "invariante do CORE"}`,
      )
    }
  }

  return violations
}

/** Leitor padrão: lê do repositório, devolvendo null para arquivo ausente. */
export function defaultReadFile(root = ROOT) {
  return (path) => {
    const full = join(root, path)
    return existsSync(full) ? readFileSync(full, "utf8") : null
  }
}

// ── modo CLI (so quando invocado diretamente, nao quando importado) ────────
const isMain =
  !!process.argv[1] && process.argv[1].split(/[\\/]/).pop() === "check-forge-parity.mjs"

if (isMain) {
  const read = defaultReadFile()

  // Modo inventario: mostra o que o guard enxerga, para a classificacao ser
  // revisavel de fato (e nao um ato de fe).
  if (process.argv.includes("--gates")) {
    for (const pipeline of PIPELINES) {
      const content = read(pipeline.file)
      if (content === null) continue
      const gates = discoverGates(content)
      console.log(`\n${pipeline.file} (${pipeline.forge}) — ${gates.length} gate(s):`)
      for (const gate of gates) {
        const kind = classifyGate(gate)
        console.log(`  [${kind ?? "NAO CLASSIFICADO"}] ${gate}`)
      }
    }
    process.exit(0)
  }

  const violations = findParityViolations(read)
  if (violations.length === 0) {
    console.log(
      `check-forge-parity: ✅ ${CORE_INVARIANTS.length} invariantes do CORE nas ${PIPELINES.length} pipelines e todos os gates classificados (${GITHUB_ONLY.length} isencoes GitHub-only com razao).`,
    )
    process.exit(0)
  }
  console.error("check-forge-parity: ❌ contrato de merge divergente:")
  for (const v of violations) console.error(`  - ${v}`)
  console.error(
    "\nUm gate que roda em UMA pipeline e nao na outra e um buraco silencioso: o PR passa verde por onde rodou e ninguem ve a invariante que ficou de fora.",
  )
  process.exit(1)
}
