#!/usr/bin/env node
/**
 * scan-push-full-suite.mjs - guard de CONTRATOS dos gates de custo nos hooks
 * (2026-08): Gate 3 mapeado + fuzz:ci pre-push-only + encoding unico.
 *
 * WHY: as decisoes de custo medidas no gates-proofs.md vivem nos .sh/.hooks
 * e podem regredir silenciosamente. Este guard trava cada uma com um
 * CONTRATO BIDIRECIONAL (mesmo padrao do par positivo/negativo do Gate 3):
 *
 * 1. GATE 3 MAPEADO (secao 8.4, medido 18s vs 178s ~10x): o Gate 3 do
 *    pre-push roda os testes das AREAS TOCADAS via pre-commit-tests.mjs
 *    --scope push, NAO a suite completa (test:unit, test:run, vitest run
 *    sem arquivos mapeados, bun run test em watch) - o CI roda a suite
 *    inteira em checkout fresco como rede. NEGATIVO: FULL_SUITE_RES em
 *    scripts/pre-push-gates.sh + .husky/pre-push. POSITIVO: o marcador
 *    pre-commit-tests.mjs --scope push em scripts/pre-push-gates.sh
 *    (deletar o Gate 3 = push sem testes = falha 'GATE 3 MISSING').
 *
 * 2. FUZZ MAPEADO PRE-PUSH-ONLY (secao 11.11, adotado 2026-08-10): o gate
 *    de fuzz do pre-push roda o runner mapeado (run-mapped-fuzz.mjs
 *    --since, o MESMO diff do Gate 3, suites batched ~6-14s tipico vs
 *    ~40.4s do fuzz:ci de 6 spawns; primeiro push = fallback fuzz completo
 *    batched) - o CI continua rodando fuzz:ci completo em checkout fresco
 *    como autoridade. NEGATIVO: fuzz:ci/run-mapped-fuzz NAO pode aparecer
 *    no .husky/pre-commit. POSITIVO: run-mapped-fuzz.mjs --since DEVE
 *    existir no .husky/pre-push (remover/trocar o gate = push sem fuzz que
 *    o CI rodaria = falha 'FUZZ GATE MISSING').
 *    NOTA hard-lock (interacao com o scan-fuzz-precommit.mjs): este
 *    NEGATIVO e INCONDICIONAL - uma secao ADOTADO datada no gates-proofs.md
 *    (a trilha de reversao do scan-fuzz-precommit, padrao 11.7) NAO satisfaz
 *    este contrato; reverter a 11.11 (fuzz no commit) exige EDItAR este
 *    guard (a rede estrutural), nao so documentar. Os dois guards se
 *    sobrepoem de proposito: o scan-fuzz-precommit e a camada doc-aware que
 *    diagnostica a classe especifica --scope cached com a trilha documentada;
 *    este e o lock duro que nenhuma nota contorna.
 *
 * 3. ENCODING GATE UNICO (medido ~1.4s): verify-encoding.sh (UTF-8 + VPS
 *    ASCII + proof + baseline) roda EM AMBOS os hooks - NAO pode ser
 *    trocado por check-utf8.sh (o bloco VPS_ASCII_FILES duplicado, que
 *    divergiu da surface real e foi removido) nem removido. NEGATIVO:
 *    check-utf8.sh fora de check-docs-encoding.sh nos hooks. POSITIVO:
 *    verify-encoding.sh DEVE existir em .husky/pre-commit E .husky/pre-push.
 *
 * 4. GUARDS NODE BATCHADOS (secao 11.13, medido 2026-08): os 7 guards node
 *    do pre-commit (check-node-modules-integrity, scan-push-full-suite,
 *    scan-lint-staged-loader, scan-guard-gates, scan-fuzz-precommit,
 *    scan-batch-coverage, scan-prepush-batch) rodam em UMA invocacao node
 *    (run-precommit-guards.mjs, ~0.22-0.26s - o boot node ~0.14s dominava
 *    cada spawn; 4 sequenciais custavam ~0.54-0.81s). NEGATIVO: um spawn
 *    INDIVIDUAL de qualquer um dos 7 no .husky/pre-commit (7 boots = a
 *    regressao de custo que o batch existe para matar). POSITIVO:
 *    run-precommit-guards.mjs wired no .husky/pre-commit (remover o batch =
 *    guards voltam a custar 7 boots = falha 'MISSING').
 *    NOTA (sec 11.16): o scan-batch-coverage e o guard de CRESCIMENTO deste
 *    contrato - a lista FIXA aqui nao pega um 8o guard novo; o batch-coverage
 *    deriva a lista dos imports vivos do runner e falha todo guard fora do
 *    batch com o caminho exato. Os dois se sobrepoem de proposito: este pina
 *    os 7 conhecidos, aquele deriva o futuro.
 *    NOTA (sec 11.17): o scan-prepush-batch e o 7o guard - ele guarda o
 *    PRE-PUSH (nao o pre-commit): o pre-push NAO e batchado por design, e o
 *    guard trava a condicao 'se um 2o node guard aparecer, o batch passa a
 *    valer' contra regressao futura. O spawn individual do integrity no
 *    pre-push fica FORA da superficie deste contrato (a asimetria da 11.17),
 *    e o guard roda NO BATCH do pre-commit validando o working tree do
 *    pre-push (mesmo padrao dos demais).
 *
 * 5. GATE 3 MAPEADO POR CO-LOCATION (secao 11.15, RE-MEDICAO 2026-08-10
 *    77.58s vs 20.8s): o custo do Gate 3 depende do que o diff toca - o
 *    pior caso (~75-77.58s) so ocorre quando suites de teste sao tocadas
 *    DIRETAMENTE (correto: voce editou o teste, ele roda). Um push de
 *    GATE FILES (.sh/.yml, os arquivos que esta thread protege) deve
 *    mapear pouca ou nenhuma suite. A classe de regressao: adicionar
 *    '.sh' ao SOURCE_RE do mapper (pre-commit-tests.mjs) - tocar
 *    scripts/verify-encoding.sh passaria a mapear
 *    scripts/__tests__/verify-encoding.test.ts (~36.5s, a suite que
 *    spawna o gate completo - secao 11.14) em TODO push de gate files,
 *    transformando o custo comum em ~77s. NEGATIVO: SOURCE_RE sem
 *    .sh/.yml/.yaml (gate files nunca mapeiam suite co-localizada).
 *    POSITIVO: o pin exato 'SOURCE_RE = /\.(ts|tsx|mjs)$/' (mudar a
 *    superficie = falha 'MISSING'). Travado nos dois sentidos, mesmo
 *    padrao dos contratos 1-4.
 *
 * 6. DIVISAO COMMIT/PUSH (secao 11.11, adotado 2026-08-10): o teste
 *    unitario DETERMINISTICO do commit roda via pre-commit:test
 *    (package.json -> pre-commit-tests.mjs SEM --scope, default cached =
 *    git diff --cached/staged) - a rede ESTOCASTICA do push roda via
 *    run-mapped-fuzz.mjs --since (o runner SO aceita --since; parseSince
 *    nao tem modo cached, impossivel invoca-lo num commit). NEGATIVO:
 *    pre-commit-tests.mjs --scope push no package.json (o pre-commit:test
 *    viraria push = commit estocastico, quebra o determinismo medido da
 *    11.11). POSITIVO: (a) pre-commit:test wired no package.json (node
 *    scripts/pre-commit-tests.mjs), (b) `bun run pre-commit:test` no
 *    .husky/pre-commit (remover = commit sem teste deterministico), (c) o
 *    parseSince do runner lendo --since (perder o escopo do push = fuzz
 *    sem diff). O --scope push LEGITIMO do pre-push (pre-push-gates.sh)
 *    segue coberto pelo REQUIRED_MARKERS - este contrato so trava o lado
 *    do COMMIT.
 *
 * Linhas de comentario (primeiro char nao-branco = '#') sao ignoradas no
 * scan NEGATIVO: os headers dos hooks mencionam "suite completa"/"fuzz" em
 * prosa (o header do pre-push explica POR QUE o bash runner ficou fora).
 * O scan POSITIVO varre o arquivo inteiro (o marcador pode estar em
 * qualquer linha).
 *
 * Env override PUSH_SUITE_SCAN_ROOT (repo sintetico p/ o vitest - espelha o
 * FRAGILE_SCAN_ROOT do fragile-range). Saida ASCII pura (gate file).
 * Puro node, sem deps, <10ms.
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(process.env.PUSH_SUITE_SCAN_ROOT || process.cwd())
const FILES = ["scripts/pre-push-gates.sh", ".husky/pre-push", ".husky/pre-commit"]

/** Full-suite invocation patterns (the section-8.4 regression class). */
const FULL_SUITE_RES = [
  /test:unit\b/,
  /test:run\b/,
  /\bbun\s+run\s+test(?!:guard)\b/,
  /\bvitest\s+run\b/,
  /\bnpx\s+vitest\b/,
  /\bbunx\s+vitest\b/,
]

/** Required Gate-3 marker per guard file (the section-8.4 mapped invocation). */
const REQUIRED_MARKERS = [
  { file: "scripts/pre-push-gates.sh", re: /pre-commit-tests\.mjs\s+--scope\s+push/ },
]

/**
 * Gate-placement contracts (the bidirectional extension, 2026-08):
 * - negative: per-file patterns that MUST NOT appear (skip comments).
 * - positive: per-file markers that MUST exist somewhere (whole-file scan).
 */
const GATE_CONTRACTS = [
  {
    name: "fuzz mapeado pre-push-only",
    negative: [{ file: ".husky/pre-commit", re: /fuzz:ci\b|run-mapped-fuzz/ }],
    positive: [{ file: ".husky/pre-push", re: /run-mapped-fuzz\.mjs\s+--since/ }],
  },
  {
    name: "encoding gate unico",
    negative: [
      { file: ".husky/pre-commit", re: /check-utf8\.sh/ },
      { file: ".husky/pre-push", re: /check-utf8\.sh/ },
    ],
    positive: [
      { file: ".husky/pre-commit", re: /verify-encoding\.sh/ },
      { file: ".husky/pre-push", re: /verify-encoding\.sh/ },
    ],
  },
  {
    name: "guards node batchados (1 invocacao)",
    negative: [
      // Os 7 guards node NAO podem voltar a ser spawns INDIVIDUAIS no
      // pre-commit (7 boots node ~0.54-0.81s vs 1 boot do batch ~0.22-0.26s,
      // secao 11.13) - o caminho e o batch runner run-precommit-guards.mjs.
      // O scan NEGATIVO ignora comentarios: o header do pre-commit menciona
      // os nomes dos guards em prosa (o batch), so o SPAWN individual conta.
      {
        file: ".husky/pre-commit",
        re: /node\s+scripts\/(?:check-node-modules-integrity|scan-push-full-suite|scan-lint-staged-loader|scan-guard-gates|scan-fuzz-precommit|scan-batch-coverage|scan-prepush-batch)\.mjs/,
      },
    ],
    positive: [
      // O batch runner DEVE estar wired no pre-commit (remover/trocar o batch
      // = os guards voltam a custar 5 boots - falha 'MISSING').
      { file: ".husky/pre-commit", re: /run-precommit-guards\.mjs/ },
    ],
  },
  {
    // Secao 11.15: o Gate 3 mapeia por CO-LOCATION - a superficie de
    // ORIGEM do mapper e ts/tsx/mjs, entao um gate file (.sh/.yml) tocado
    // mapeia NADA (nao ha suite co-localizada p/ ele). Adicionar '.sh' ao
    // SOURCE_RE faria scripts/verify-encoding.sh mapear
    // scripts/__tests__/verify-encoding.test.ts (~36.5s) em todo push de
    // gate files - o custo comum viraria o pior caso (~77s). O NEGATIVO
    // detecta .sh/.yml/.yaml DENTRO da declaracao SOURCE_RE; o POSITIVO
    // pina a declaracao exata (renomear/mudar a superficie = MISSING).
    name: "gate 3 mapeado por co-location (SOURCE_RE ts/tsx/mjs, sem gate files)",
    negative: [
      {
        file: "scripts/pre-commit-tests.mjs",
        re: /SOURCE_RE\s*=\s*\/[^/]*\b(?:sh|ya?ml)\b[^/]*\//,
      },
    ],
    positive: [
      {
        file: "scripts/pre-commit-tests.mjs",
        re: /SOURCE_RE\s*=\s*\/\\\.\(ts\|tsx\|mjs\)\$\//,
      },
    ],
  },
  {
    // Secao 11.11: divisao deliberada commit/push - teste unitario
    // DETERMINISTICO no commit (pre-commit:test = pre-commit-tests.mjs SEM
    // --scope, default cached/staged) vs rede ESTOCASTICA no push
    // (run-mapped-fuzz.mjs --since - o runner SO aceita --since, sem modo
    // cached). O NEGATIVO detecta `--scope push` no script pre-commit:test
    // do package.json (vazaria o escopo do push para dentro do commit); o
    // POSITIVO pina os tres fios: o script wired no package.json, o hook
    // rodando pre-commit:test, e o parseSince do runner lendo --since.
    name: "divisao commit/push 11.11 (pre-commit:test cached deterministico; run-mapped-fuzz --since so)",
    negative: [
      // O pre-commit:test NAO pode virar --scope push (o default cached -
      // staged - e o escopo deterministico do commit, sec 11.11). O scan
      // NEGATIVO varre linha a linha; o package.json nao tem linhas de
      // comentario, entao a declaracao do script e o alvo.
      { file: "package.json", re: /pre-commit-tests\.mjs\s+--scope\s+push/ },
    ],
    positive: [
      // (a) o script pre-commit:test wired: node scripts/pre-commit-tests.mjs
      // (prefix - um `--scope cached` explicito equivalente nao quebra o pin;
      // o `--scope push` e o que o NEGATIVO pega).
      {
        file: "package.json",
        re: /"pre-commit:test"\s*:\s*"node scripts\/pre-commit-tests\.mjs/,
      },
      // (b) o hook do commit roda o teste deterministico das areas tocadas.
      { file: ".husky/pre-commit", re: /bun\s+run\s+pre-commit:test/ },
      // (c) o runner do fuzz mapeado SO le --since (o escopo do push) -
      // um runner sem --since perderia o diff e o fallback FULL rodaria em
      // todo push.
      {
        file: "scripts/run-mapped-fuzz.mjs",
        re: /argv\[i\]\s*===\s*"--since"/,
      },
    ],
  },
]

/** True when the line is a full-line comment (first non-space char is #). */
function isComment(line) {
  return /^\s*#/.test(line)
}

/**
 * Scan the guard files. Returns { fullSuite, missingMarker, gateViolations }
 * where fullSuite is [{ file, line, text }] of full-suite invocations,
 * missingMarker is [{ file }] for guard files lacking their required Gate-3
 * marker, and gateViolations is [{ kind, file, line, text }] of gate
 * contract violations (kind: 'negative' | 'positive-missing'). All empty =
 * clean. Exported for unit tests.
 */
export function scanPushFullSuite(root = ROOT, files = FILES) {
  const fullSuite = []
  for (const rel of files) {
    const abs = path.join(root, rel)
    if (!fs.existsSync(abs)) continue
    const lines = fs.readFileSync(abs, "utf8").split(/\r?\n/)
    lines.forEach((line, i) => {
      if (isComment(line)) return
      for (const re of FULL_SUITE_RES) {
        if (re.test(line)) {
          fullSuite.push({ file: rel, line: i + 1, text: line.trim() })
          return
        }
      }
    })
  }
  const missingMarker = []
  for (const { file: rel, re } of REQUIRED_MARKERS) {
    const abs = path.join(root, rel)
    if (!fs.existsSync(abs)) continue // synthetic roots may omit the file
    if (!re.test(fs.readFileSync(abs, "utf8"))) missingMarker.push({ file: rel })
  }
  const gateViolations = []
  for (const contract of GATE_CONTRACTS) {
    for (const { file: rel, re } of contract.negative) {
      const abs = path.join(root, rel)
      if (!fs.existsSync(abs)) continue
      const lines = fs.readFileSync(abs, "utf8").split(/\r?\n/)
      lines.forEach((line, i) => {
        if (isComment(line)) return
        if (re.test(line)) {
          gateViolations.push({
            kind: "negative",
            contract: contract.name,
            file: rel,
            line: i + 1,
            text: line.trim(),
          })
        }
      })
    }
    for (const { file: rel, re } of contract.positive) {
      const abs = path.join(root, rel)
      if (!fs.existsSync(abs)) continue
      if (!re.test(fs.readFileSync(abs, "utf8"))) {
        gateViolations.push({
          kind: "positive-missing",
          contract: contract.name,
          file: rel,
          line: 0,
          text: re.source,
        })
      }
    }
  }
  return { fullSuite, missingMarker, gateViolations }
}

export function main() {
  const { fullSuite, missingMarker, gateViolations } = scanPushFullSuite()
  if (fullSuite.length === 0 && missingMarker.length === 0 && gateViolations.length === 0) {
    console.log(
      `push-suite: clean (${FILES.length} guard files + ${GATE_CONTRACTS.length} gate contracts over the full surface incl. package.json/runner, mapped Gate 3 present, no full-suite invocations)`,
    )
    return 0
  }
  for (const o of fullSuite) {
    console.log(`push-suite: FULL-SUITE in ${o.file}:${o.line}: ${o.text}`)
  }
  for (const m of missingMarker) {
    console.log(`push-suite: GATE 3 MISSING in ${m.file} (pre-commit-tests.mjs --scope push required, sec 8.4)`)
  }
  for (const v of gateViolations) {
    if (v.kind === "negative") {
      console.log(`push-suite: CONTRACT '${v.contract}' VIOLATED in ${v.file}:${v.line}: ${v.text}`)
    } else {
      console.log(`push-suite: CONTRACT '${v.contract}' MISSING in ${v.file} (${v.text})`)
    }
  }
  console.log(
    "push-suite: Gate 3 must run the MAPPED tests (pre-commit-tests.mjs --scope push), not the full suite (sec 8.4); the fuzz gate is the MAPPED runner in the pre-push only (run-mapped-fuzz.mjs --since, sec 11.11); verify-encoding.sh is the single encoding gate in both hooks; the Gate 3 mapper surface stays ts/tsx/mjs (gate files .sh never map a co-located heavy suite - sec 11.15); pre-commit:test stays the deterministic CACHED scope and run-mapped-fuzz only accepts --since (commit/push division, sec 11.11)",
  )
  return 1
}

// Entry-point guard: only run the CLI when executed directly (vitest imports
// the file for unit tests of scanPushFullSuite without side effects).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main()
}
