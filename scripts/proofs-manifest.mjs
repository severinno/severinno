#!/usr/bin/env node
/**
 * proofs-manifest.mjs - o REGISTRY das provas vivas por classe de guard
 * (2026-08-11, sec 11.60 do gates-proofs.md).
 *
 * WHY: o pedido "avalie uma prova" re-propos 2x uma prova JA registrada -
 * a Prova 39 (sec 8.34, o PAR CURE+stale) e o caso do hook-proof-run (sec
 * 11.58, ja automatizado). A classe: 're-derivar o que ja esta pinado'.
 * ESTE modulo e o consultavel: PROOF_CLASSES mapeia cada classe de guard a
 * sua prova viva (Prova N + run do CI ou null = local + secao do doc), no
 * padrao EXIT_CLAIMS da sec 11.42 - o "avalie uma prova" do futuro
 * consulta o registry ANTES de propor.
 *
 * O CONTRATO (o que a suite pina contra o doc real):
 *   - ABS PIN: o conteudo do manifest (prova + classe + secao + run) -
 *     editar o registry exige editar o snapshot conscientemente.
 *   - DOC COVERAGE doc -> manifest: toda secao com 'Prova N' no doc (os
 *     headers `## N Prova M` + a linha da tabela `(Prova N, sec X)` que
 *     registra a Prova 20) tem entrada no manifest - uma Prova nova no doc
 *     sem registro falha (o growth contract).
 *   - manifest -> doc (stale): toda entrada tem secao detectada no doc.
 *   - PIN REALITY: o module da classe existe (o padrao manifest-registry).
 *   - RUN REALITY: todo run nao-nulo aparece no texto do doc.
 *   - WIRED SURFACE (2026-08-12): a direcao wired -> registry - o lado
 *     inverso do growth contract. deriveWiredGuards() deriva a superficie
 *     viva dos guards wired (spawns `node|bash scripts/` dos hooks +
 *     imports do batch runner + steps `node scripts/scan-*.mjs --ci` dos
 *     workflows do net) e checkWiredSurface() falha se um guard wired
 *     nao tiver classe no PROOF_CLASSES nem entrada no WIRED_ALLOWLIST
 *     (o padrao TARGET_DIRS aplicado ao registry - medido 2026-08-12:
 *     21 wired = 13 classes + 8 allowlist: o scan-proof-helpers da sec
 *     11.93 entrou no allowlist em 2026-08-12 e o scan-unit-config (sec
 *     11.96) GRADUOU do allowlist para classe com a Prova 49 (sec 8.44 -
 *     a prova viva da nota SERIALIZED POOL removida do config real). A direcao registry -> wired
 *     NAO existe por desenho: classes helper (ci-proof-run, hook-proof-run,
 *     doc-revalidate, run-all-fuzz) tem Prova mas nao sao guard de hook.
 *
 * OUT OF SHAPE (como scan-exit-claims/FRONTIERS, sec 11.40): SEM
 * superficie --print-* (CLI = --check), entao a LIVE TREE check do
 * manifest-registry nao o flagra. Roda via test:unit (o MESMO canal do
 * scan-exit-claims) - NAO no test:guard, cuja lista e pinada pela Prova 35
 * (sec 8.30; 13 suites NA EPOCA - hoje 14, com a doc-revalidate no HEAD
 * desde o commit 1bb18de; a re-mediacao 2026-08-12 da sec 8.1 mediu 14
 * suites / 297 testes no run 31559349720).
 *
 * Exit codes do CLI: 0 = clean (registry coberto pelo doc) - 1 =
 * violacoes listadas no stderr - 2 = uso errado.
 *
 * Re-validacao: `npx vitest run scripts/__tests__/proofs-manifest.test.ts --config vitest.config.unit.ts`
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

/** DOC - o doc real, com override por env (o padrao EXIT_CLAIMS_DOC). */
const DOC = process.env.PROOFS_DOC || path.join(process.cwd(), "docs", "gates-proofs.md")

/** SCAN_ROOT - a raiz da superficie wired (hooks + batch + net), override por env. */
const SCAN_ROOT = path.resolve(process.env.PROOFS_SCAN_ROOT || process.cwd())

/**
 * PROOF_CLASSES - o registry: classe de guard -> provas vivas.
 * class: id curto da classe (o consultavel do "avalie uma prova").
 * module: o arquivo da classe (PIN REALITY - precisa existir).
 * proofs: [{ prova, section, run, what }] - prova = numero da Prova;
 * section = secao do doc onde a Prova e registrada (o header `## N Prova
 * M`, exceto a Prova 20 cujo registro vive na linha da tabela); run = o
 * run do CI (null = prova local, sem run dedicado); what = descricao curta.
 */
export const PROOF_CLASSES = [
  {
    class: "verify-encoding",
    module: "scripts/verify-encoding.sh",
    proofs: [
      { prova: 1, section: "2", run: "31298436074", what: "utf8-byte" },
      { prova: 2, section: "3", run: "31306797327", what: "fragile-range" },
      { prova: 4, section: "5", run: "31312427503", what: "FRAGILE_SCAN_ROOT sentinel" },
      { prova: 5, section: "6", run: null, what: ".zscripts fixed-dir 0x97" },
      { prova: 6, section: "7", run: "31331423557", what: "SPREAD CONTRACT" },
    ],
  },
  {
    class: "check-js-budget",
    module: "scripts/check-js-budget.mjs",
    proofs: [
      { prova: 3, section: "4", run: null, what: "budget sentinel" },
    ],
  },
  {
    class: "guard-gates-push-net",
    module: ".github/workflows/guard-gates.yml",
    proofs: [
      { prova: 7, section: "8", run: "31336318902", what: "push net guard vitest" },
      { prova: 35, section: "8.30", run: "31526224328", what: "test:guard 13 suites" },
    ],
  },
  {
    class: "scan-surfaces-contract",
    module: "scripts/__tests__/scan-surfaces-contract.test.ts",
    proofs: [
      { prova: 8, section: "8.2", run: "31342311844", what: "Type D HERMETIC" },
    ],
  },
  {
    class: "check-next-types",
    module: "scripts/check-next-types.mjs",
    proofs: [
      { prova: 9, section: "8.3", run: null, what: "auto-heal .next/types" },
    ],
  },
  {
    class: "scan-push-full-suite",
    module: "scripts/scan-push-full-suite.mjs",
    proofs: [
      { prova: 10, section: "8.7", run: "31354308733", what: "REAL-REPO CONTRACT do Gate 3" },
    ],
  },
  {
    class: "run-mapped-fuzz",
    module: "scripts/run-mapped-fuzz.mjs",
    proofs: [
      { prova: 11, section: "8.8", run: null, what: "Gate 2 fuzz MAPEADO (pre-push real)" },
    ],
  },
  {
    class: "run-all-fuzz",
    module: "scripts/run-all-fuzz.mjs",
    proofs: [
      { prova: 12, section: "8.9", run: "31397642499", what: "fuzz:ci BATCHADO" },
      { prova: 13, section: "8.10", run: "31411254090", what: "pr-check completo do estado atual" },
    ],
  },
  {
    class: "check-node-modules-integrity",
    module: "scripts/check-node-modules-integrity.mjs",
    proofs: [
      { prova: 14, section: "8.11", run: null, what: "SPEC-FORMAT contract" },
    ],
  },
  {
    class: "scan-guard-gates",
    module: "scripts/scan-guard-gates.mjs",
    proofs: [
      { prova: 15, section: "8.12", run: null, what: "FRAGILE GUARD NEEDS local" },
      { prova: 16, section: "8.13", run: "31430040398", what: "FRAGILE GUARD NEEDS via CI" },
      { prova: 17, section: "8.14", run: null, what: "multi-violacao AGREGADA local" },
      { prova: 19, section: "8.15", run: "31439238631", what: "GUARD GATES JOB NEEDS via push real" },
      { prova: 21, section: "8.16", run: "31444762608", what: "FUZZ JOB NEEDS + FUZZ STEP MISSING" },
      { prova: 22, section: "8.17", run: "31446588931", what: "multi-violacao AGREGADA via CI" },
      { prova: 24, section: "8.19", run: "31461526068", what: "agregacao lado PUSH NET" },
      { prova: 28, section: "8.23", run: "31488081528", what: "rule 11 DANGLING NEEDS (inconclusiva)" },
      { prova: 36, section: "8.31", run: "31533234250", what: "sufixo --since no test:guard" },
      { prova: 45, section: "8.40", run: null, what: "11.73/11.82 ao vivo: hook-proof-run.test.ts no test:guard real -> suite falha com o caminho exato" },
    ],
  },
  {
    class: "check-exit-claims-push",
    module: "scripts/check-exit-claims-push.mjs",
    proofs: [
      { prova: 37, section: "8.32", run: null, what: "claim fake 11.99 bloqueia o push" },
      { prova: 38, section: "8.33", run: null, what: "CURE como ultima saida" },
    ],
  },
  {
    class: "prepush-order",
    module: ".husky/pre-push",
    proofs: [
      { prova: 18, section: "11.19", run: null, what: "integrity ANTES do fuzz mapeado" },
    ],
  },
  {
    class: "ci-proof-run",
    module: "scripts/ci-proof-run.mjs",
    proofs: [
      { prova: 20, section: "11.20", run: "31442006152", what: "--only-jobs EARLY-EXIT" },
      { prova: 32, section: "8.27", run: "31511149307", what: "--stash-uncommitted positivo" },
      { prova: 48, section: "8.43", run: null, what: "MUTATION do guard 11.72 ao vivo: docblock Exit codes mutado no ci-proof-run real (suite falha com o path exato - o irmao da Prova 44 no lado ci)" },
      { prova: 52, section: "8.47", run: null, what: "prova viva LOCAL do guard 11.102 (par das Provas 44/50): gate de um uso do stashLeftNote no ci-proof-run.mjs real hardcodado num scratch -> a suite 11.102 falha com a linha 633 exata (true ? stashLeftNote); revertido" },
      { prova: 53, section: "8.48", run: null, what: "prova viva LOCAL do guard 11.105 (par das Provas 48/52): citacao do fail (673) mutada de ${opts.mutateSelfDelete} para ${selfDel} no ci-proof-run.mjs real num scratch -> a suite 11.105 falha com a entrada 673:opts.mutateSelfDelete exata no ABS PIN (1 teste em 92); revertido" },
      { prova: 54, section: "8.49", run: null, what: "prova agregada viva do PAR da 11.102 (gate stashedDelta + logPath): AMBAS as citacoes mutadas de uma vez no ci-proof-run.mjs real (633 gate hardcoded + 899 DONE literal) num scratch -> 6 testes da 11.102 falham (3 gate + 3 logPath) + CITED REALITY 11.106 + DERIVED PIN 11.107; 11.70/11.105/E2Es verdes; revertido" },
      { prova: 55, section: "8.50", run: null, what: "prova viva LOCAL do guard 11.107 (par das Provas 44/50): gate fake novoDelta ? stashLeftNote injetado no ci-proof-run.mjs real (linha 965) num scratch -> DERIVED PIN (expected [4] toEqual [3] com + novoDelta) + COMPLETENESS (o gate ci-proof-run:novoDelta primeiro uso 965 sem entrada no CONSUMED_FACTS) falham; 30 passed incl. MUTATIONs + FRONTIER 11.111; revertido byte-identical" },
      { prova: 57, section: "8.52", run: null, what: "prova viva LOCAL da FRONTIER 11.110 (par das Provas 44/50): a derivada compartilhada fail-input-cites mutada num scratch (scan target fail( -> steps.push() -> as citacoes caem nas linhas do plano) -> 3 testes do ci falham incl. o FRONTIER com a linha exata 335 (b (alias de opts.branch)); o irmao 11.115 do hook falha com a 342 (opts.safetyDiff); revertido byte-identical" },
    ],
  },
  {
    class: "scan-prepush-batch",
    module: "scripts/scan-prepush-batch.mjs",
    proofs: [
      { prova: 23, section: "8.18", run: null, what: "SEGUNDO NODE GUARD live" },
    ],
  },
  {
    class: "scan-eol-anchor",
    module: "scripts/scan-eol-anchor.mjs",
    proofs: [
      { prova: 25, section: "8.20", run: "31480438465", what: "eol-anchor BASELINE live" },
    ],
  },
  {
    class: "scan-curl-timeouts",
    module: "scripts/scan-curl-timeouts.mjs",
    proofs: [
      { prova: 26, section: "8.21", run: "31485163704", what: "eval falso-negativo observado" },
      { prova: 27, section: "8.22", run: "31487497462", what: "--connect-timeout sozinho" },
      { prova: 29, section: "8.24", run: "31492035257", what: "tripwire eval+curl lado PR" },
      { prova: 30, section: "8.25", run: "31496492582", what: "split-form residual exit 0" },
      { prova: 31, section: "8.26", run: "31506284327", what: "continuation-form exit 1" },
      { prova: 34, section: "8.29", run: "31518328191", what: "tri-caso AGREGADO" },
    ],
  },
  {
    class: "scan-exit-claims",
    module: "scripts/scan-exit-claims.mjs",
    proofs: [
      { prova: 33, section: "8.28", run: "31516054686", what: "DOC COVERAGE com a secao exata" },
      { prova: 39, section: "8.34", run: null, what: "PAR CURE+stale no CLI real" },
    ],
  },
  {
    class: "hook-proof-run",
    module: "scripts/hook-proof-run.mjs",
    proofs: [
      { prova: 40, section: "8.35", run: null, what: "renumber CURE+0stale via helper" },
      { prova: 41, section: "8.36", run: null, what: "colisao de target fail-loud exit 3" },
      { prova: 43, section: "8.38", run: null, what: "revert-fail apply exit 3 fail-loud (patch corrompido)" },
      { prova: 44, section: "8.39", run: null, what: "MUTATION do guard 11.72 ao vivo: docblock 3=falha removido no hook-proof-run real (suite falha com o path)" },
      { prova: 46, section: "8.41", run: null, what: "status-divergente ao vivo: mutate com o flip do .gitignore -> stray.tmp sobrevive ao revert -> git status diverge -> exit 3 com a CURE do snapshot" },
      { prova: 47, section: "8.42", run: null, what: "safety-diff ao vivo: mutate corrompe o delta.patch do backup -> exit 3 com a CURE citando o safety diff; git apply <sd> recupera o delta TRACKED byte-identical, untracked restaurados do backup/untracked (a classe que o --safety-backup da 11.89 fecha)" },
      { prova: 50, section: "8.45", run: null, what: "revert-fail apply ao vivo com delta.patch do backup INTEGRO (sem knob): poison commit no branch original -> apply-fail exit 3; 'git apply <backup>/delta.patch' (nivel 1) recupera byte-identical" },
      { prova: 51, section: "8.46", run: "31642157987", what: "prova viva do irmao CI do status-divergente (sec 11.98): ciclo hook-proof-run --mutate-untracked no guard-gates real, run 31642157987 - exit 3 + CURE do snapshot no log do job" },
    ],
  },
  {
    class: "doc-revalidate",
    module: "scripts/doc-revalidate.mjs",
    proofs: [
      { prova: 42, section: "8.37", run: null, what: "caminho de escrita real: upsert datado + idempotencia do mesmo dia (ACHADO: suite cmd quebrada no Windows)" },
    ],
  },
  {
    class: "scan-unit-config",
    module: "scripts/scan-unit-config.mjs",
    proofs: [
      { prova: 49, section: "8.44", run: null, what: "nota SERIALIZED POOL removida do config real -> suite 11.80/11.95 falha com o path (graduacao do allowlist para classe)" },
    ],
  },
  {
    class: "scan-derived-inventory",
    module: "scripts/scan-derived-inventory.mjs",
    proofs: [
      { prova: 56, section: "8.51", run: null, what: "prova viva LOCAL do ANCHOR da 11.109 (par das Provas 44/50): 'linha 625' reintroduzida na fact safetyDiff do CONSUMED_FACTS real num scratch -> 5 testes falham incl. o ANCHOR com a fact exata + CONFINEMENT 11.114 no CLI; revertido byte-identical (graduacao do allowlist para classe, o padrao da Prova 49)" },
    ],
  },
  {
    class: "wired-guards-contract",
    module: "scripts/__tests__/wired-guards-contract.test.ts",
    proofs: [
      { prova: 58, section: "8.53", run: null, what: "prova viva LOCAL do sweep inverso da 11.117 (par das Provas 44/57): nota datada (2026-08-13) com modulo fake citado na sec 11.119 real num scratch -> os 4 testes do describe 11.117 falham (REAL-REPO 9 vs 8) com o path exato no diff; revertido byte-identical (a classe nasce da suite, o padrao da scan-surfaces-contract)" },
    ],
  },
  {
    class: "proof-helpers-contract",
    module: "scripts/__tests__/proof-helpers-contract.test.ts",
    proofs: [
      { prova: 59, section: "8.54", run: null, what: "prova viva LOCAL do ABS PIN da 11.118 (par das Provas 44/50): nota datada (2026-08-13) com o scripts/guard-remeasure.mjs (um helper real SEM entrada no PROOF_HELPERS, coberto so pela exclusao) citado na sec 11.121 real -> o REAL-REPO da 11.118 falha (deriveHelperEvidenceCited [] vs [guard-remeasure]) com o path exato no diff + 5 colaterais na suite do guard (REAL-REPO CONTRACT, MUTATION 11.117, CLI exit 1, FRONTEIRAS C e D); revertido byte-identical (a classe nasce da suite, o padrao da scan-surfaces-contract)" },
    ],
  },
]

/**
 * scanProvaSections - o DETECTOR das registracoes de Prova no doc (a
 * direcao doc -> manifest, o mesmo padrao do scanDocExitClaims). Duas
 * fontes:
 *   1. HEADER: `## <sec> Prova <N>` (a forma autoritativa - as Provas
 *      1-6 nos headers `## 2.`-`## 7.`, a 7 no `## 8.`, 8-39 nos `## 8.x`,
 *      a 18 no `## 11.19 Prova 18`). O first-match do titulo (a Prova do
 *      titulo, nao referencias cruzadas no corpo do titulo).
 *   2. TABELA: a linha `(Prova N, sec X` - a registracao da Prova 20,
 *      cuja secao 11.20 NAO tem 'Prova N' no titulo (`## 11.20
 *      ci-proof-run -- custo real do ciclo...`; a linha real e `(Prova
 *      20, sec 11.20; o poll...` - o greedy para no ';'). A tabela e
 *      REDUNDANTE para as demais (mesmo valor do header) - um conflito
 *      (valor diferente do header) DEFERE ao header como autoridade
 *      (continue): a tabela referencia secoes de OUTRAS provas em
 *      prosa, entao o header e o unico que pode decidir.
 *
 * @returns {Map<string, number>} secao -> prova.
 */
export function scanProvaSections(docPath = DOC) {
  const lines = fs.readFileSync(docPath, "utf8").split(/\r?\n/)
  const sections = new Map()
  for (const line of lines) {
    const m = line.match(/^## (\d+(?:\.\d+)?)\.?\s+Prova (\d+)/)
    if (m) sections.set(m[1], Number(m[2]))
  }
  for (const line of lines) {
    // Lenienta por design: a linha real da Prova 20 e
    // `(Prova 20, sec 11.20; o poll termina no JOB...)` - a secao nao fecha
    // parenteses (segue com ';'). O greedy `([0-9.]+)` para no ';' (ou ')'
    // na forma sintetica `(Prova 20, sec 11.20)` da MUTATION).
    const m = line.match(/\(Prova (\d+), sec ([0-9.]+)/)
    if (m) {
      const sec = m[2]
      const prova = Number(m[1])
      if (sections.has(sec) && sections.get(sec) !== prova) continue // o header e a autoridade
      sections.set(sec, prova)
    }
  }
  return sections
}

/**
 * checkProofs - a validacao completa do contrato sobre o doc real.
 * @returns {{ unregistered: string[], stale: string[], brokenPins: string[], brokenRuns: string[] }}
 *   unregistered: secao/Prova detectada no doc sem entrada no manifest
 *                 (ou com secao divergente) - o growth contract.
 *   stale: entrada do manifest cuja secao NAO esta no doc (secao
 *          renumerada/removida = drift - a direcao manifest -> doc).
 *   brokenPins: module da classe nao existe (PIN REALITY).
 *   brokenRuns: run nao-nulo que nao aparece no texto do doc (RUN
 *               REALITY - o run nunca e inventado).
 */
export function checkProofs(docPath = DOC) {
  const detected = scanProvaSections(docPath)
  const byProva = new Map()
  for (const c of PROOF_CLASSES) {
    for (const p of c.proofs) byProva.set(p.prova, { class: c.class, section: p.section, run: p.run })
  }
  const unregistered = []
  for (const [sec, prova] of detected) {
    const e = byProva.get(prova)
    if (!e) unregistered.push(`Prova ${prova} (secao ${sec}) sem entrada no PROOF_CLASSES`)
    else if (e.section !== sec) unregistered.push(`Prova ${prova}: manifest secao ${e.section} != doc secao ${sec}`)
  }
  const stale = []
  for (const c of PROOF_CLASSES) {
    for (const p of c.proofs) {
      if (!detected.has(p.section)) stale.push(`entrada ${c.class} / Prova ${p.prova} (secao ${p.section}) sem secao no doc`)
      else if (detected.get(p.section) !== p.prova) stale.push(`entrada ${c.class} / Prova ${p.prova}: doc secao ${p.section} -> Prova ${detected.get(p.section)}`)
    }
  }
  const brokenPins = []
  for (const c of PROOF_CLASSES) {
    if (!fs.existsSync(path.join(process.cwd(), c.module))) brokenPins.push(`${c.class}: module ${c.module} nao existe`)
  }
  const brokenRuns = []
  const docText = fs.readFileSync(docPath, "utf8")
  for (const c of PROOF_CLASSES) {
    for (const p of c.proofs) {
      if (p.run && !docText.includes(p.run)) brokenRuns.push(`${c.class} / Prova ${p.prova}: run ${p.run} ausente no doc`)
    }
  }
  return { unregistered, stale, brokenPins, brokenRuns }
}

/**
 * WIRED_ALLOWLIST - as 9 excecoes deliberadas da direcao wired -> registry
 * (2026-08-12, sec 11.60): guards wired na superficie viva SEM classe no
 * PROOF_CLASSES porque NAO tem Prova viva dedicada - seus contratos vivem
 * nas proprias suites (suite-pinned), nao em um evento de Prova. Um guard
 * wired novo exige: registrar a classe (com Prova viva) OU entrar AQUI
 * com rationale - nunca silencio (o ABS PIN do teste pina esta lista).
 *   - scan-lint-staged-loader.mjs: guard do batch (sec 11.7), contrato
 *     pinado pela propria suite, sem Prova dedicada.
 *   - scan-fuzz-precommit.mjs: guard do batch (sec 11.11), idem.
 *   - scan-batch-coverage.mjs: guard do batch (sec 11.16), idem (o proprio
 *     contrato de crescimento do batch).
 *   - check-push-deletion.mjs: atalho de delecao pura do pre-push (sec
 *     11.21), contrato pinado pela suite, sem Prova dedicada.
 *   - scan-timeouts.mjs: step do net (sec 11.31), suite-pinned.
 *   - scan-evidence-sweep.mjs: guard do batch (sec 11.120, 2026-08-13), o
 *     contrato dos DOIS sweeps de evidencia datada (sec 11.117/11.118)
 *     suite-pinned - a fronteira e as derivadas vivem no guard (a regra
 *     dos 2 usos que as suites importam).
 *   - scan-lucide-icons.mjs: guard de geracao (HOOK_ALLOWLIST da sec
 *     11.16), sem Prova dedicada.
 *   - check-docs-encoding.sh: auditoria informativa de docs (nunca
 *     bloqueia), sem Prova dedicada.
 *   - scan-proof-helpers.mjs: o 9o guard do batch (sec 11.93) - o
 *     CONTRATO de fail-loud dos helpers de prova (sec 11.72) executado
 *     no pre-commit; o contrato e pinado pela propria suite
 *     (proof-helpers-contract.test.ts, a fonte unica dos regexes/derivada
 *     da 11.79), sem Prova dedicada - o padrao do scan-batch-coverage.
 *   - O scan-derived-inventory GRADUOU do allowlist para CLASSE no
 *     PROOF_CLASSES com a Prova 56 (sec 8.51, 2026-08-13: o ANCHOR da
 *     sec 11.109 provado ao vivo - 'linha 625' reintroduzida na fact
 *     safetyDiff do CONSUMED_FACTS real -> a suite 11.109/11.113/11.114
 *     falha com a fact exata + a CONFINEMENT no CLI do guard) - o MESMO
 *     padrao do scan-unit-config: o allowlist so mantem guard SEM Prova
 *     dedicada.
 *   - O scan-unit-config GRADUOU do allowlist para CLASSE no PROOF_CLASSES
 *     com a Prova 49 (sec 8.44, a prova viva: nota SERIALIZED POOL removida
 *     do vitest.config.unit.ts real -> a suite da 11.80/11.95 falha com o
 *     path exato) - o allowlist so mantem guard SEM Prova dedicada.
 */
export const WIRED_ALLOWLIST = [
  "check-docs-encoding.sh",
  "check-push-deletion.mjs",
  "scan-batch-coverage.mjs",
  "scan-evidence-sweep.mjs",
  "scan-fuzz-precommit.mjs",
  "scan-lint-staged-loader.mjs",
  "scan-lucide-icons.mjs",
  "scan-proof-helpers.mjs",
  "scan-timeouts.mjs",
]

/** Spawns de guard nos hooks: `node|bash scripts/X.mjs|sh`. */
const WIRED_SPAWN_RE = /(?:node|bash)\s+scripts\/([A-Za-z0-9._-]+\.(?:mjs|sh))/g

/** Imports do batch runner: `import { main as X } from "./Y.mjs"`. */
const WIRED_BATCH_IMPORT_RE = /^import\s+[^;]+?\s+from\s+"\.\/([A-Za-z0-9._-]+\.mjs)"/gm

/** Steps de guard do net (guard-gates.yml + pr-check.yml): `node scripts/scan-*.mjs --ci`. */
const WIRED_NET_STEP_RE = /node\s+scripts\/(scan-[A-Za-z0-9._-]+\.mjs)\s+--ci/g

/** A camada de composicao (nao classes de guard): o runner do batch, o
 * wrapper do pre-push e o mapper de testes. O runner do batch E recusrido
 * (WIRED_BATCH_IMPORT_RE deriva os imports dele); pre-push-gates.sh e
 * pre-commit-tests.mjs sao excluidos SEM recursao - os guards internos
 * deles (check-js-budget registrado, o mapper) ficam fora da superficie
 * derivada por desenho (a fronteira documentada na sec 11.60). */
const WIRED_COMPOSITION = ["run-precommit-guards.mjs", "pre-push-gates.sh", "pre-commit-tests.mjs"]

/** True quando a linha e comentario (prosa nao deriva). */
function isWiredComment(line) {
  return /^\s*#/.test(line)
}

/**
 * deriveWiredGuards - a SUPERFICIE VIVA dos guards wired (o padrao
 * TARGET_DIRS aplicado ao registry): os spawns `node|bash scripts/` dos
 * hooks .husky/pre-commit e .husky/pre-push + os imports do batch runner
 * run-precommit-guards.mjs + os steps `node scripts/scan-*.mjs --ci` dos
 * workflows do net (guard-gates.yml + pr-check.yml). Comentarios nao
 * derivam. A camada de composicao e excluida (os guards dela sao os
 * imports/spawns derivados das fontes acima). Retorna lista unica e
 * ordenada. Exportada para os testes.
 */
export function deriveWiredGuards(root = SCAN_ROOT) {
  const wired = new Set()
  for (const rel of [".husky/pre-commit", ".husky/pre-push"]) {
    const p = path.join(root, rel)
    if (!fs.existsSync(p)) continue
    for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      if (isWiredComment(line)) continue
      for (const m of line.matchAll(WIRED_SPAWN_RE)) {
        if (!WIRED_COMPOSITION.includes(m[1])) wired.add(m[1])
      }
    }
  }
  const runnerPath = path.join(root, "scripts", "run-precommit-guards.mjs")
  if (fs.existsSync(runnerPath)) {
    for (const m of fs.readFileSync(runnerPath, "utf8").matchAll(WIRED_BATCH_IMPORT_RE)) wired.add(m[1])
  }
  for (const rel of [".github/workflows/guard-gates.yml", ".github/workflows/pr-check.yml"]) {
    const p = path.join(root, rel)
    if (!fs.existsSync(p)) continue
    // Comentarios nao derivam (os workflows sao prose-heavy e citam as
    // formas de comando em prosa - o MESMO isWiredComment dos hooks).
    for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      if (isWiredComment(line)) continue
      for (const m of line.matchAll(WIRED_NET_STEP_RE)) wired.add(m[1])
    }
  }
  return [...wired].sort()
}

/**
 * checkWiredSurface - o contrato wired -> registry: todo guard wired deve
 * ter classe no PROOF_CLASSES (module basename) OU entrada no
 * WIRED_ALLOWLIST. missing = os guards wired fora dos dois (a classe de
 * crescimento inversa: um guard novo wired sem registro falha).
 */
export function checkWiredSurface(root = SCAN_ROOT) {
  const wired = deriveWiredGuards(root)
  const registered = new Set(PROOF_CLASSES.map((c) => path.basename(c.module)))
  const missing = wired.filter((g) => !registered.has(g) && !WIRED_ALLOWLIST.includes(g))
  return { wired, missing }
}

/** CLI: `node scripts/proofs-manifest.mjs [--check]` - exit 0/1/2. */
export function main() {
  const args = process.argv.slice(2)
  const unknown = args.filter((a) => a.startsWith("--") && a !== "--check")
  if (unknown.length > 0) {
    process.stderr.write("proofs-manifest: usage: node scripts/proofs-manifest.mjs [--check]\n")
    return 2
  }
  const { unregistered, stale, brokenPins, brokenRuns } = checkProofs()
  const { wired, missing: wiredMissing } = checkWiredSurface()
  const total = PROOF_CLASSES.reduce((n, c) => n + c.proofs.length, 0)
  if (
    unregistered.length === 0 &&
    stale.length === 0 &&
    brokenPins.length === 0 &&
    brokenRuns.length === 0 &&
    wiredMissing.length === 0
  ) {
    process.stdout.write(
      `proofs-manifest: clean (${PROOF_CLASSES.length} classes / ${total} provas registradas; ${wired.length} guards wired cobertos - sec 11.60)\n`,
    )
    return 0
  }
  if (unregistered.length > 0) {
    process.stderr.write(`proofs-manifest: ${unregistered.length} Prova(s) no doc SEM registro no PROOF_CLASSES (sec 11.60):\n`)
    for (const u of unregistered) process.stderr.write(`  ${u}\n`)
    process.stderr.write("  registre a Prova no PROOF_CLASSES de scripts/proofs-manifest.mjs (sec 11.60) e confirme com: node scripts/proofs-manifest.mjs --check\n")
  }
  if (stale.length > 0) {
    process.stderr.write(`proofs-manifest: ${stale.length} entrada(s) do manifest SEM secao detectada no doc (secao renumerada/removida - sec 11.60):\n`)
    for (const s of stale) process.stderr.write(`  ${s}\n`)
    process.stderr.write("  stale nao tem registro de cura - a secao foi renumerada/removida: atualize a secao no PROOF_CLASSES ou remova a entrada (sec 11.60)\n")
  }
  if (brokenPins.length > 0) {
    process.stderr.write(`proofs-manifest: ${brokenPins.length} module(s) de classe inexistente(s) (PIN REALITY - sec 11.60):\n`)
    for (const b of brokenPins) process.stderr.write(`  ${b}\n`)
  }
  if (brokenRuns.length > 0) {
    process.stderr.write(`proofs-manifest: ${brokenRuns.length} run(s) ausente(s) no doc (RUN REALITY - sec 11.60):\n`)
    for (const r of brokenRuns) process.stderr.write(`  ${r}\n`)
  }
  if (wiredMissing.length > 0) {
    process.stderr.write(`proofs-manifest: ${wiredMissing.length} guard(s) wired SEM classe no PROOF_CLASSES nem no WIRED_ALLOWLIST (sec 11.60):\n`)
    for (const w of wiredMissing) process.stderr.write(`  ${w}\n`)
    process.stderr.write(
      "  registre a classe no PROOF_CLASSES (com uma Prova viva) OU adicione ao WIRED_ALLOWLIST com rationale (sec 11.60)\n",
    )
  }
  return 1
}

// Entry-point guard: so roda o CLI quando executado direto (vitest importa
// o modulo para os testes das funcoes puras sem efeitos colaterais).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main()
}
