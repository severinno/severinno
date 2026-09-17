#!/usr/bin/env node

// =============================================================================
// check-hook-ci-parity.mjs
//
// Usage:
//   node scripts/check-hook-ci-parity.mjs
//   node scripts/check-hook-ci-parity.mjs --root X   # fixture (mutation test)
//   node scripts/check-hook-ci-parity.mjs --json
//
// Exit code:
//   0 — todo comando dos hooks locais e o MESMO comando do CI, ou um recorte/
//       comando local DECLARADO com razao escrita
//   1 — comando sem declaracao, declaracao stale, recorte sem razao, recorte
//       que nao deriva do comando canonico, invariante do CORE nem rodando no
//       hook nem declarado em HOOK_NOT_RUN
//   2 — infra: hook, package.json ou pipeline ausente (fail-closed)
//
// POR QUE ESTE GUARD EXISTE: o veredito LOCAL e o do MERGE sao dados por dois
// conjuntos de comandos escritos em dois lugares. Enquanto essa duplicacao for
// invisivel, ela diverge em silencio — e o sintoma e sempre o mesmo: "passou
// aqui e quebrou la" (ou pior, "travou aqui e nem era o gate do CI"). Os casos
// REAIS que este guard existe para impedir:
//
//   - `.husky/pre-push` rodava `bunx tsc --noEmit` SEM o heap de 4GB que o
//     script `typecheck` do package.json carrega: o tsc estourava a memoria
//     (SIGABRT exit 134) e o push ficava vermelho por um motivo que o CI nunca
//     veria. Os dois lados citavam "o typecheck" — com duas reguas;
//   - a forja rodava `bun run check:registry-source` e o espelho
//     `node scripts/check-registry-source.mjs`: mesma verificacao, dois
//     caminhos — e um terceiro no hook.
//
// O QUE O GUARD MEDE: para cada comando que um hook EXECUTA, o veredito e
// obtido resolvendo a entrada do package.json (`bun run X` -> o script real) e
// comparando com o comando CANONICO do CI (o `command` de cada invariante do
// CORE, do `check-forge-parity` — a MESMA fonte que o doctor usa):
//
//   MESMO COMANDO  o hook executa exatamente o comando do CI (apos resolver a
//                  entrada e normalizar redirecionamento/pipe). O veredito nao
//                  PODE divergir: e o mesmo comando. Nao precisa declaracao.
//   RECORTE        o hook executa o MESMO instrumento com argumentos a mais ou
//                  a menos (ex.: `--staged`). O veredito PODE divergir — e por
//                  isso a decisao tem de estar ESCRITA em HOOK_DECLARED, com a
//                  razao. Um recorte nao declarado deixa o hook reprovando (ou
//                  aprovando) onde o CI faz o contrario, em silencio.
//   LOCAL          o hook roda algo que o CI NAO roda (ou roda por outro
//                  caminho, ex.: um reusable). Tambem exige declaracao.
//
// E a COBERTURA, na direcao oposta: um invariante do CORE que o hook NAO roda
// precisa estar em HOOK_NOT_RUN com a razao. Sem isso, um gate novo do CORE
// entra no contrato de merge e o hook simplesmente nao o ve — o commit passa
// local e o PR nasce vermelho, que e o oposto do que o hook existe para fazer.
//
// O QUE ESTE GUARD NAO PROMETE: o recorte declarado CONTINUA sendo um recorte
// (o hook mede menos que o CI — `--staged` ve o indice, nao a arvore inteira).
// A declaracao nao torna os dois vereditos iguais; torna a DIFERENCA VISIVEL e
// revisavel, que e o que uma decisao de escopo precisa ser.
// =============================================================================

import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join, resolve } from "node:path"

import { CORE_INVARIANTS, canonicalCommandOf, executedCommands } from "./check-forge-parity.mjs"
import {
  WORKFLOW_FILE_RE,
  existingWorkflowDirs,
  exitOnUnjudgeable,
  readJudgedText,
  readWorkflowScan,
} from "./forge-workflows.mjs"

const ROOT = process.cwd()

/** Os hooks locais cujos comandos sao comparados com o CI. */
export const HOOKS = [".husky/pre-commit", ".husky/pre-push"]

/** As pipelines do contrato de merge (o CI que decide o merge e o espelho). */
export const PIPELINES = [".gitea/workflows/ci.yml", ".github/workflows/pr-check.yml"]

/**
 * DECLARACAO dos comandos que os hooks rodam e que NAO sao o comando do CI
 * (recorte ou local). Cada entrada e um par `match` (regex ANCORADA sobre o
 * comando do hook) + o que ela e:
 *
 *   of         id de um invariante do CORE. O comando do hook tem de usar o
 *              MESMO instrumento do `command` canonico (mesmo script/binario)
 *              — um recorte de OUTRA ferramenta nao e recorte, e outro gate.
 *   ciMirror   a invocacao do CI que este comando espelha (fora das duas
 *              pipelines: um reusable). O guard exige que ela exista de fato
 *              em algum workflow — um `ciMirror` inventado nao passa.
 *   why        a razao ESCRITA. Obrigatoria sempre que o comando nao e
 *              literalmente o do CI: e ela que transforma "o hook mede outra
 *              coisa" em decisao revisavel.
 *
 * Adicionar um comando a um hook = adicionar uma entrada AQUI (ou usar o
 * comando do CI, que nao precisa declaracao nenhuma).
 *
 * @type {{match: RegExp, of: string|null, ciMirror?: string|null, why?: string}[]}
 */
export const HOOK_DECLARED = [
  {
    match: /^node scripts\/check-bun-mirror\.mjs --staged$/,
    of: "bun-mirror",
    why: "recorte --staged: a ARVORE de trabalho pode carregar WIP que NAO faz parte deste commit; o indice e o conteudo do commit. O CI roda o comando inteiro sobre o conteudo mergeado — a diferenca e de ESCOPO, e o comando (mesmo script, mesmos argumentos obrigatorios) e o do CI.",
  },
  {
    match: /^node scripts\/check-mutation-jobs\.mjs --staged$/,
    of: null,
    ciMirror: "node scripts/check-mutation-jobs.mjs --staged --base origin/main",
    why: "recorte sem o `--base`: no pre-commit o diff relevante e o do INDICE, e `origin/main` pode nao existir (clone novo, branch sem upstream). O CI tem a base garantida e compara contra ela.",
  },
  {
    match: /^node scripts\/check-unused-deps\.mjs --staged$/,
    of: null,
    ciMirror: "node scripts/check-unused-deps.mjs",
    why: "recorte --staged: mesmo motivo do bun-mirror (o indice e o commit). O comando inteiro roda no job unused-deps-guard do pr-check.yml.",
  },
  {
    match: /^node scripts\/check-mutation-timing-contract\.mjs --staged$/,
    of: null,
    ciMirror: "node scripts/check-mutation-timing-contract.mjs",
    why: "recorte --staged: o contrato e do repo, mas a violacao tem de estar no COMMIT para bloquea-lo. O comando inteiro roda no reusable utf8-check.yml.",
  },
  {
    match: /^node scripts\/check-workflow-run-syntax\.mjs --staged$/,
    of: "workflow-run-syntax",
    why: "recorte --staged: julga o INDICE (com o CONTEUDO do commit, via `git show :path`), nao a arvore de trabalho — os workflows, os scripts de shell E o shell embutido (o `RUN` de um Dockerfile e o payload de um `sh -c`) que o commit carrega. O corpo quebrado nasce de uma reescrita mecanica em massa ANTES do commit e e o commit que o carrega; a arvore pode ter WIP que nao faz parte dele. O CI roda o comando inteiro sobre o conteudo mergeado (482 corpos, 124 scripts e 33 textos embutidos das duas forjas) — a diferenca e de ESCOPO, e o instrumento (o mesmo script) e o do CI.",
  },
  {
    // A cauda e o CAPTURA do veredito (`&& REMEDIO=0`): o hook precisa
    // distinguir o remedio que provou o indice da chamada que sumiu, e o
    // extrator nao descarta o `&&` — entao a declaracao o reconhece em vez de
    // fingir que o comando e outro.
    match: /^node scripts\/pre-commit-run-syntax-remedy\.mjs(?: && REMEDIO=0)?$/,
    of: null,
    ciMirror: null,
    why: "LOCAL: o remedio INTERATIVO do gate acima — quando o recorte --staged reprova, ele OFERECE o remendo da cicatriz mecanica com confirmacao explicita (o fixer do gate ja o prova antes de gravar), re-estagia os arquivos e REVALIDA rodando o proprio guard. Nao existe no CI porque la nao ha operador para confirmar: sem terminal ele nao pergunta e o commit segue bloqueado (fail-closed). O CI cobra o MESMO veredito pelo gate de sintaxe; este comando nao acrescenta gate nenhum, so o caminho de quem opera.",
  },
  {
    match: /^bash scripts\/run-encoding-guards\.sh$/,
    of: null,
    ciMirror: null,
    why: "LOCAL: e o runner compartilhado dos dois hooks (fonte unica da lista). Os guards que ele executa rodam no CI pelo reusable utf8-check.yml; o RUNNER nao existe no CI porque la cada guard e um step com o seu proprio nome.",
  },
  {
    match: /^bun run barrel-lint$/,
    of: null,
    ciMirror: "node scripts/barrel-lint.mjs",
    why: "MESMO COMANDO do CI (job barrel-lint do reusable quality-gate.yml), fora das duas pipelines — por isso nao aparece no `--gates` do check-forge-parity, e por isso a declaracao nomeia o espelho.",
  },
  {
    match: /^bun x prettier --check --ignore-unknown \$(?:STAGED_FORMAT|\{?STAGED)/,
    of: "lint",
    why: "recorte do lint: o CI roda o invariante `lint` inteiro (prettier --check + eslint --max-warnings 0) sobre a ARVORE; aqui e so o prettier, so do que esta no indice, para o feedback ser antes do lint-staged (que conserta). O eslint do commit e feito pelo lint-staged.",
  },
  {
    match: /^bun x lint-staged$/,
    of: null,
    ciMirror: null,
    why: "LOCAL e MUTANTE: roda prettier --write + eslint --fix sobre o indice. Nao tem espelho no CI porque o CI nao conserta — ele REPROVA (`bun run lint`). Roda aqui para o commit ja sair formatado.",
  },
  {
    match: /^bun run check:direct-rtl-import$/,
    of: null,
    ciMirror: null,
    why: "LOCAL: import direto de @testing-library/react em arquivo .test (em vez de @/__tests__/test-utils) so aparece no trabalho em andamento; o CI cobre a classe pelo typecheck e pelo lint do commit. Nao existe gate equivalente nas duas pipelines.",
  },
  {
    match: /^bun test:snapshots$/,
    of: "tests",
    why: "recorte CONDICIONAL do `tests` (so quando .snap/snapshot testes mudam): roda o subconjunto de snapshots, nao a suite. O CI roda `bun run test:run` inteiro — o hook antecipa o unico caso em que o commit deixa um snapshot obsoleto.",
  },
  {
    match: /^bun run vitest run --reporter=verbose \$(?:AFFECTED_TESTS|\{?AFFECTED)/,
    of: "tests",
    why: "recorte por ARQUIVOS AFETADOS (smart-skip do pre-push): roda os testes mapeados dos arquivos que mudaram, nao a suite. E o caminho rapido do push; o CI roda `bun run test:run` inteiro.",
  },
  {
    match: /^bun run fuzz:ci$/,
    of: null,
    ciMirror: "bun run fuzz:ci",
    why: "MESMO COMANDO do job fuzz do pr-check.yml, declarado porque o hook o roda apenas sob `CI=1` (o fuzz e longo demais para todo push local).",
  },
  {
    match: /^bun run fuzz$/,
    of: null,
    ciMirror: null,
    why: "LOCAL: fuzz interativo de longa duracao (scripts/run-fuzz.sh). O CI roda a variante `fuzz:ci` (JSON, com teto) — a interativa fica para quem esta depurando.",
  },
]

/**
 * Invariantes do CORE que os HOOKS NAO rodam, cada grupo com a razao escrita.
 *
 * Regra (a mesma do `GITHUB_ONLY` e do `HOOK_NOT_RUN` do doctor): um invariante
 * do CORE que nao roda no hook precisa de DECISAO ESCRITA — senao um gate novo
 * do contrato de merge entra em silencio e o commit local passa sem ele.
 *
 * @type {{ids: string[], why: string}[]}
 */
export const HOOK_NOT_RUN = [
  {
    ids: ["bring-up-env-gate-proof", "runner-base", "prove-docs"],
    why: "exigem DOCKER e/ou REDE (a imagem do runner, o registry, a execucao real do bring-up): nao cabem num hook local. Rodam nas DUAS pipelines (jobs bring-up-proof e workflow-refs-guard).",
  },
  {
    ids: ["bun-audit"],
    why: "`bun audit` consulta o registry de advisory (rede) e leva 10-30s por execucao. O hook roda `check:unused-deps` (le package.json + codigo, sem rede) no lugar do audit completo.",
  },
  {
    ids: ["doctor-ci"],
    why: "compara os espelhos com as repository variables: `vars.*` SO existem no runner do CI — localmente nao ha valor contra o que comparar (e o doctor sai INDETERMINADA, nunca verde).",
  },
  {
    ids: ["pipefail-sigpipe"],
    why: "varre TODOS os scripts do repositorio (nao o commit): o defeito e intermitente e nao muda por commit de codigo; ~1s no CI, ruido no caminho de cada commit.",
  },
  {
    ids: ["merge-latency"],
    why: "mede a pipeline INTEIRA (o grafo de `needs:` + o modelo de duracao), nao o commit: um commit que nao toca a pipeline nem o modelo nao muda o veredito — e nao existe recorte dele, porque o `--check` le os dois arquivos fixos de qualquer jeito. Quem muda o veredito e exatamente o commit de CI/pipeline, e esse o hook ja cobre pelo gate de paridade de gates.",
  },
  {
    ids: ["required-checks", "workflow-refs"],
    why: "relacao entre WORKFLOWS e scripts/package.json (referencia pendurada, check exigido inexistente): so um commit de CI a muda — e nesse caso o hook ja roda o check de PARIDADE DE GATES, que e o gate que pega o efeito.",
  },
  {
    ids: [
      "ts-nocheck",
      "script-headers",
      "hooks-symmetry",
      "secret-leaks",
      "seed-hooks",
      "sentinel-producer",
      "no-setup-bun",
      "pii-gate-self-test",
    ],
    why: "LACUNA DECLARADA, nao impossibilidade: sao node-puros e baratos (<1s cada) e o CI os roda em TODO PR. O hook nao os roda porque esta no caminho de CADA commit — ele e um FILTRO RAPIDO do que o commit muda, nao uma copia do CI. Estar escrito aqui e o que torna a lacuna uma decisao revisavel em vez de um esquecimento.",
  },
]

/** Launchers reconhecidos na extracao (o comando comeca por um deles). */
const LAUNCHER_RE = /^(?:node|bash|sh|bun|bunx|npx|pnpm|yarn|python3?|tsc|prettier|eslint|vitest)\b/

/**
 * Normaliza um comando: tira redirecionamento (`2>&1`, `> arquivo`) e o resto
 * de um pipe. O CI escreve `bun run fuzz:ci > fuzz-results.json` e o hook
 * `bun run fuzz:ci`: sem normalizar, seriam "comandos diferentes" quando sao o
 * mesmo comando com a saida redirecionada.
 *
 * @param {string} command
 * @returns {string}
 */
export function normalizeCommand(command) {
  return command
    .replace(/\s*\d?>\s*\S+/g, " ") // 2>&1, > fuzz-results.json, >> log
    .replace(/\s*\|\s*.*$/, "") // | tail -5, | head -5
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Os comandos que um hook EXECUTA, normalizados. Ignora comentario, linha
 * vazia e continuacao de shell que nao chama ferramenta (`if`, `for`, `echo`,
 * `local`, atribuicao) — o alvo e o comando, nao o controle de fluxo.
 *
 * @param {string} content  conteudo do hook
 * @returns {string[]}
 */
export function hookCommands(content) {
  const commands = []
  for (const raw of content.split(/\r?\n/)) {
    const trimmed = raw.trim()
    if (trimmed === "" || trimmed.startsWith("#")) continue
    // `( ... ) &` (subshell em background) e `cmd &` → o comando esta dentro.
    const core = trimmed
      .replace(/^\(\s*/, "")
      .replace(/\)\s*&$/, "")
      .replace(/\s*&\s*$/, "")
      .trim()
    if (core === "" || !LAUNCHER_RE.test(core)) continue
    const cmd = normalizeCommand(core)
    if (cmd !== "") commands.push(cmd)
  }
  return commands
}

/**
 * Resolve a ENTRADA do package.json de um comando (`bun run X` / `bun X` -> o
 * script real). E o que torna `bun run check:registry-source` comparavel com
 * `node scripts/check-registry-source.mjs`: sem resolver, os dois lados
 * pareceriam diferentes e a unica saida seria exigir a mesma sintaxe no hook
 * (que tem custo de leitura, nao de veredito — a entrada e um alias).
 *
 * `bun x <pkg>` / `bunx <pkg>` NAO sao entradas (executam um binario): ficam
 * como estao. Profundidade limitada a 3 para uma entrada que aponte para outra
 * nao virar laco.
 *
 * @param {string} command
 * @param {Record<string, string>} scripts  scripts do package.json
 * @param {number} [depth]
 * @returns {string}
 */
export function resolveCommand(command, scripts, depth = 0) {
  const cmd = normalizeCommand(command)
  if (depth > 3) return cmd
  if (/^bun(x)?\s+x\s/.test(cmd)) return cmd
  const m = cmd.match(/^bun\s+(?:run\s+)?([a-z0-9][a-z0-9:_-]*)(\s+.*)?$/)
  if (!m) return cmd
  const alias = scripts[m[1]]
  if (!alias || alias === cmd) return cmd
  return resolveCommand(`${alias}${m[2] ?? ""}`, scripts, depth + 1)
}

/**
 * O INSTRUMENTO de um comando resolvido: o binario ou o script que ele executa
 * (`scripts/check-bun-mirror.mjs`, `prettier`, `vitest`, `tsc`). E o que
 * permite dizer "este recorte e do MESMO gate" — dois comandos com
 * instrumentos diferentes sao dois gates, nao um recorte do outro.
 *
 * @param {string} command  ja resolvido
 * @returns {string}
 */
export function subjectOf(command) {
  const withoutEnv = command.replace(/^[A-Z_][A-Z0-9_]*=\S+\s+/, "")
  const tokens = withoutEnv.split(/\s+/).filter((t) => t !== "")
  if (tokens.length === 0) return ""
  // `bun x <pkg>` e `bunx <pkg>` executam um binario: o instrumento e o pacote.
  if (tokens[0] === "bun" && tokens[1] === "x") return tokens[2] ?? "bun"
  if (tokens[0] === "bunx") return tokens[1] ?? "bunx"
  const LAUNCHERS = new Set([
    "node",
    "bash",
    "sh",
    "bun",
    "bunx",
    "npx",
    "pnpm",
    "yarn",
    "python3",
    "python",
  ])
  let rest = LAUNCHERS.has(tokens[0]) ? tokens.slice(1) : tokens
  // `bun run <binario>`: `run` e o lancador, nao o instrumento. Sem pular os
  // dois, `bun run vitest run` teria por instrumento "run" — e o canonico
  // `vitest run` teria "vitest", o que faria dois comandos do MESMO gate
  // parecerem gates diferentes.
  if (rest[0] === "run") rest = rest.slice(1)
  return rest[0] ?? tokens[0]
}

/** Le um arquivo do root, ou null quando ausente. */
function readOrNull(root, path) {
  const full = join(root, path)
  return existsSync(full) ? readFileSync(full, "utf8") : null
}

/** Os scripts do package.json do root. */
function readScripts(root) {
  const raw = readOrNull(root, "package.json")
  if (raw === null) return null
  try {
    return JSON.parse(raw).scripts ?? {}
  } catch {
    return null
  }
}

/**
 * Todos os comandos de `run:` dos workflows do root (inclui os reusables, que
 * nao estao nas duas pipelines). Usado para PROVAR um `ciMirror`: um espelho
 * declarado que nao existe em workflow nenhum e uma afirmacao sem lastro.
 *
 * @param {string} root
 * @returns {string[]}
 */
export function allWorkflowCommands(root) {
  const commands = []
  // Os diretorios vem da FONTE UNICA (scripts/forge-workflows.mjs): cravar um
  // literal aqui deixaria as outras forjas fora da varredura — foi assim que a
  // pipeline dona do merge ficou fora da cobertura dos guards.
  for (const dir of existingWorkflowDirs(root)) {
    const full = join(root, dir)
    for (const name of readdirSync(full)) {
      if (!WORKFLOW_FILE_RE.test(name)) continue
      // Leitura fail-closed (fonte única): o arquivo que não abre LANÇA com o
      // nome dele, em vez de contribuir zero comando para a comparação.
      const content = readJudgedText(root, `${dir}/${name}`)
      commands.push(...executedCommands(content))
    }
  }
  return commands
}

/**
 * Analisa a paridade hook ↔ CI. Pura em relacao ao filesystem (recebe o root),
 * para poder ser testada contra um fixture.
 *
 * @param {{root?: string}} [args]
 * @returns {{rows: object[], violations: string[], notRun: string[], missing: string[]}}
 */
export function analyze({ root = ROOT } = {}) {
  const violations = []
  const scripts = readScripts(root)
  if (scripts === null) {
    return {
      rows: [],
      violations: ["package.json ausente/ilegivel — sem ele nao da para resolver `bun run X`"],
      notRun: [],
      missing: [],
    }
  }

  // ── Os comandos REAIS dos hooks ────────────────────────────────────────
  const occurrences = new Map() // comando → hooks onde aparece
  for (const hook of HOOKS) {
    const content = readOrNull(root, hook)
    if (content === null) {
      violations.push(`${hook}: hook declarado nao existe — se ele foi removido, remova de HOOKS`)
      continue
    }
    for (const cmd of hookCommands(content)) {
      const arr = occurrences.get(cmd) ?? []
      arr.push(hook)
      occurrences.set(cmd, arr)
    }
  }

  // ── Os comandos CANONICOS do CI (as duas pipelines) ───────────────────
  // Duas formas do MESMO comando: o LITERAL (como o workflow o escreve) e a
  // ENTRADA RESOLVIDA. A comparacao tem de ser feita na MESMA base dos dois
  // lados — comparar o comando do hook JA resolvido contra o workflow ainda
  // nao resolvido faz `bun run check:pii-allowlist` (hook) parecer diferente
  // de `bun run check:pii-allowlist` (CI), que sao a mesma linha.
  const rawPipeline = new Set()
  for (const file of PIPELINES) {
    const content = readOrNull(root, file)
    if (content === null) {
      violations.push(`${file}: pipeline do contrato ausente — sem ela nao ha com o que comparar`)
      continue
    }
    for (const c of executedCommands(content).map(normalizeCommand)) rawPipeline.add(c)
  }
  const resolvedPipeline = new Set([...rawPipeline].map((c) => resolveCommand(c, scripts)))
  const isPipeline = (raw, resolved) => rawPipeline.has(raw) || resolvedPipeline.has(resolved)

  const rows = []
  const coveredIds = new Set()

  const canonicalOf = (id) => {
    const inv = CORE_INVARIANTS.find((i) => i.id === id)
    if (!inv) return null
    return resolveCommand(canonicalCommandOf(inv), scripts)
  }

  // Cobertura por IGUALDADE: um invariante cujo comando canonico e executado
  // (resolvido) por algum hook esta coberto sem precisar de declaracao — e a
  // forma mais forte de paridade, porque nao ha dois comandos para divergir.
  const hookResolved = new Set([...occurrences.keys()].map((c) => resolveCommand(c, scripts)))
  for (const inv of CORE_INVARIANTS) {
    if (hookResolved.has(canonicalOf(inv.id))) coveredIds.add(inv.id)
  }

  // 1. Todo comando do hook tem a sua decisao (declaracao OU o comando do CI).
  const matched = new Set()
  for (const [cmd, hooks] of occurrences) {
    const resolved = resolveCommand(cmd, scripts)
    const entry = HOOK_DECLARED.find((d) => d.match.test(cmd))
    const isPipelineCommand = isPipeline(cmd, resolved)

    if (entry) {
      matched.add(entry)
      const why = (entry.why ?? "").trim()
      let status = "local"
      let of = null

      if (entry.of) {
        const inv = CORE_INVARIANTS.find((i) => i.id === entry.of)
        if (!inv) {
          violations.push(
            `${cmd}: declarado como recorte do invariante '${entry.of}', que NAO existe no CORE — a declaracao aponta para o vazio`,
          )
        } else {
          coveredIds.add(inv.id)
          of = inv.id
          const canonical = canonicalOf(inv.id)
          if (resolved === canonical) {
            status = "mesmo-comando"
          } else if (subjectOf(resolved) === subjectOf(canonical)) {
            status = "recorte"
          } else {
            violations.push(
              `${cmd}: declarado como recorte de '${inv.id}', mas o INSTRUMENTO e outro — o canonico e \`${canonical}\` (${subjectOf(canonical)}) e este comando usa ${subjectOf(resolved)}. Um recorte executa o MESMO instrumento com outro escopo; outro instrumento e outro gate.`,
            )
          }
        }
      } else if (entry.ciMirror) {
        const mirror = resolveCommand(entry.ciMirror, scripts)
        const exists = allWorkflowCommands(root)
          .map(normalizeCommand)
          .some((c) => c.includes(entry.ciMirror))
        if (!exists) {
          violations.push(
            `${cmd}: ciMirror '${entry.ciMirror}' nao aparece como comando em workflow nenhum — espelho declarado sem lastro`,
          )
        }
        if (resolved === mirror) status = "mesmo-comando"
        else if (subjectOf(resolved) === subjectOf(mirror)) status = "recorte"
        else
          violations.push(
            `${cmd}: ciMirror '${entry.ciMirror}' usa outro instrumento (${subjectOf(mirror)} vs ${subjectOf(resolved)}) — nao e o mesmo gate`,
          )
      }

      if (status !== "mesmo-comando") {
        if (why.length < 40) {
          violations.push(
            `${cmd}: ${status} SEM razao escrita (ou curta demais) — o hook mede outra coisa que o CI e ninguem sabe por que. Escreva o por que no campo 'why' de HOOK_DECLARED.`,
          )
        }
        if (status === "local" && isPipelineCommand) {
          violations.push(
            `${cmd}: declarado como LOCAL, mas o CI executa EXATAMENTE este comando — a declaracao mente. Use o comando do CI (sem declaracao) ou declare o invariante.`,
          )
        }
      }
      rows.push({ cmd, hooks, resolved, status, of, why: entry.why ?? null })
    } else if (isPipelineCommand) {
      // O hook roda o MESMO comando do CI: nao ha veredito a divergir.
      rows.push({ cmd, hooks, resolved, status: "mesmo-comando", of: null, why: null })
    } else {
      rows.push({ cmd, hooks, resolved, status: "nao-declarado", of: null, why: null })
      violations.push(
        `${cmd} (${hooks.join(", ")}): comando NAO DECLARADO e diferente do CI. Um hook que roda outra coisa que o CI tem dois vereditos: declare em HOOK_DECLARED (recorte com razao) ou use o comando do CI.`,
      )
    }
  }

  // 2. Declaracao STALE: entrada que nao casa com nenhum comando do hook.
  for (const entry of HOOK_DECLARED) {
    if (matched.has(entry)) continue
    violations.push(
      `${entry.match}: entrada de HOOK_DECLARED que NAO casa com nenhum comando dos hooks — ou o comando saiu do hook (remova a decisao), ou mudou de forma (a declaracao envelheceu e nao mede mais nada)`,
    )
  }

  // 3. COBERTURA: invariante do CORE no hook ou em HOOK_NOT_RUN — nunca nos dois.
  const notRunIds = new Set()
  for (const group of HOOK_NOT_RUN) {
    for (const id of group.ids) {
      if (!CORE_INVARIANTS.some((i) => i.id === id)) {
        violations.push(`HOOK_NOT_RUN: id '${id}' nao existe no CORE`)
        continue
      }
      if (notRunIds.has(id)) {
        violations.push(`HOOK_NOT_RUN: id '${id}' listado duas vezes`)
        continue
      }
      notRunIds.add(id)
      if (coveredIds.has(id)) {
        violations.push(
          `HOOK_NOT_RUN: '${id}' esta declarado como NAO rodando no hook, mas um comando do hook o executa — a classificacao mente`,
        )
      }
    }
  }

  const missing = []
  for (const inv of CORE_INVARIANTS) {
    if (!coveredIds.has(inv.id) && !notRunIds.has(inv.id)) missing.push(inv.id)
  }
  for (const id of missing) {
    violations.push(
      `invariante do CORE '${id}' nao roda em nenhum hook e nao esta declarado em HOOK_NOT_RUN — decida: o hook roda este gate (HOOK_DECLARED) ou nao roda (HOOK_NOT_RUN, com a razao). Um gate do contrato de merge nao pode entrar em silencio.`,
    )
  }

  return { rows, violations, notRun: [...notRunIds].sort(), missing }
}

// ── modo CLI (so quando invocado diretamente, nao quando importado) ────────
const isMain =
  !!process.argv[1] && process.argv[1].split(/[\\/]/).pop() === "check-hook-ci-parity.mjs"

if (isMain) {
  const rootIdx = process.argv.indexOf("--root")
  if (rootIdx !== -1 && !process.argv[rootIdx + 1]) {
    console.error("check-hook-ci-parity: ❌ --root exige um diretorio (fail-closed)")
    process.exit(2)
  }
  const root = rootIdx !== -1 ? resolve(process.argv[rootIdx + 1]) : ROOT
  // Um workflow que não abre NÃO vira "nenhum comando": a varredura é a
  // compartilhada (fonte única), o arquivo sai NOMEADO e o guard para com 2
  // antes de comparar hook × CI — comparar contra um escopo que não foi lido
  // produziria "comando não encontrado no CI" por um motivo que não é do autor.
  exitOnUnjudgeable(readWorkflowScan(root).unjudgeable)
  const json = process.argv.includes("--json")
  const report = analyze({ root })

  if (json) {
    console.log(JSON.stringify({ ...report, hookCount: HOOKS.length }, null, 2))
    process.exit(report.violations.length === 0 ? 0 : 1)
  }

  const ICON = {
    "mesmo-comando": "✅",
    recorte: "◐",
    local: "○",
    "nao-declarado": "❌",
  }
  console.log("\n  Hooks locais x CI — o veredito de cada comando:\n")
  for (const row of report.rows) {
    const tag = row.of ? ` [${row.of}]` : ""
    console.log(`  ${ICON[row.status] ?? "?"} ${row.status.padEnd(14)}${tag.padEnd(18)} ${row.cmd}`)
    for (const h of row.hooks) console.log(`        em ${h}`)
  }
  console.log(
    `\n  ${CORE_INVARIANTS.length - report.missing.length - report.notRun.length}/${CORE_INVARIANTS.length} invariantes do CORE rodam no hook (os demais declarados em HOOK_NOT_RUN).`,
  )

  if (report.violations.length === 0) {
    console.log(
      "check-hook-ci-parity: ✅ todo comando dos hooks e o MESMO do CI, ou um recorte/local com decisao escrita.\n",
    )
    process.exit(0)
  }
  console.error("check-hook-ci-parity: ❌ os comandos dos hooks divergem do CI:")
  for (const v of report.violations) console.error(`  - ${v}`)
  console.error(
    "\nDois conjuntos de comandos para o mesmo merge divergem em silencio: o sintoma e 'passou aqui e quebrou la' — ou 'travou aqui e nem era o gate do CI'.",
  )
  process.exit(1)
}
