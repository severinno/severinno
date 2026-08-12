/**
 * scan-exit-claims.mjs - o CONTRATO da classe 'claim de doc sem pin no
 * codigo' (2026-08-11, sec 11.42 do gates-proofs.md).
 *
 * WHY: o SUPERSEDED da sec 11.30 virou padrao - uma decisao documentada
 * como exit code 0 que uma mudanca posterior (sec 11.36) inverteu
 * silenciosamente na doc. Um leitor da sec 11.30 confiava numa premissa
 * morta (ex.: o pedido original da thread usava a 11.30 como base). Este
 * modulo torna a classe um CONTRATO:
 *
 *   - DOC COVERAGE: toda secao 11.x do gates-proofs.md com uma claim de
 *     exit code (o detector honesto: `exit N`, `exit code N`, `exit
 *     status N` ou `exit-code N` por linha, N in 0-3) DEVE ter uma
 *     entrada no manifest EXIT_CLAIMS. Uma claim nova sem registro falha
 *     alto (o growth contract - registrar e a decisao consciente, nunca o
 *     silencio).
 *   - SELF-GUARD: a propria sec 11.42 (este registro) menciona exit code
 *     0/1 do CLI - e portanto UMA claim registrada, pinned pela propria
 *     suite (REAL-REPO CONTRACT do CLI + a mutacao exit-1). O guard
 *     guarda a si mesmo: nenhuma secao 11.x escapa, nem a que o descreve.
 *   - PIN REALITY: toda entrada kind=current DEVE apontar um pin real
 *     (arquivo de suite existe + marker presente no arquivo, o padrao
 *     manifest-registry) - a claim de doc tem contraparte no codigo.
 *   - SUPERSEDED CHAIN: toda entrada kind=superseded DEVE apontar um
 *     supersededBy que e current + pin real - o leitor da secao antiga e
 *     redirecionado para a verdade atual PINADA (o caso 11.30 -> 11.36).
 *   - MEASUREMENT HONESTY: entradas kind=measurement (estado upstream /
 *     lever RECUSADO medido uma vez) carregam um note explicando por que
 *     nao ha pin - classificacao consciente, nunca silenciosa.
 *
 * FRONTIERS-pattern: export do manifest + detector + main() IS_MAIN
 * guardado. OUT OF SHAPE (como FRONTIERS/fuzz-targets, registrados como
 * tal no manifest-registry): SEM superficie --print-*, entao a LIVE TREE
 * check do manifest-registry nao o flagra (o mesmo tratamento do
 * FRONTIERS da sec 11.40).
 *
 * Exit codes do CLI: 0 = doc coberto (toda claim registrada) - 1 = claims
 * nao registradas (listadas no stderr) - 2 = uso errado.
 *
 * Re-validacao: `npx vitest run scripts/__tests__/scan-exit-claims.test.ts --config vitest.config.unit.ts`
 * (roda via test:unit, o mesmo canal do gates-proofs-ordering - contrato
 * de doc, nao guard de hook).
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

/** DOC - o doc real, com override por env (o padrao dos guards: NODE_MODULES_ROOT,
 * GUARD_GATES_SCAN_ROOT...). O teste do exit-1 do CLI usa EXIT_CLAIMS_DOC para
 * rodar o CLI REAL contra um doc sintetico - a claim da propria sec 11.42
 * (exit code 0 no repo, exit code 1 com violacoes listadas) fica pinada pelos
 * DOIS lados: exit-0 real no repo (REAL-REPO CONTRACT) + exit-1 real no doc
 * sintetico (este override). */
const DOC = process.env.EXIT_CLAIMS_DOC || path.join(process.cwd(), "docs", "gates-proofs.md")

/**
 * EXIT_CLAIMS - o manifest das claims de exit code das secoes 11.x.
 * kind: "current" (comportamento atual, precisa de pin real) |
 *       "superseded" (invertida por uma secao posterior, precisa de
 *                     supersededBy apontando para a verdade atual) |
 *       "measurement" (medicao de estado externo / lever RECUSADO, sem
 *                      pin - com note da classificacao).
 */
export const EXIT_CLAIMS = [
  {
    section: "11.2",
    claim: "eslint_d aplica --fix (exit code 0, arquivo preservado)",
    kind: "measurement",
    note: "estado UPSTREAM do eslint_d (verificacao manual via API, receita de re-verificacao na propria secao 11.2) - nao e claim de comportamento do repo, nao ha pin",
    ref: "gates-proofs.md sec 11.2 (L2598)",
  },
  {
    section: "11.6",
    claim: "pre-commit com o shim eslintd flippado roda verde (exit code 0)",
    kind: "current",
    pin: { file: "scripts/__tests__/scan-lint-staged-loader.test.ts", marker: "11.6" },
    ref: "gates-proofs.md sec 11.6 (L2986/L3013)",
  },
  {
    section: "11.7",
    claim: "paridade de loader: exit code 0 nos tres (veredito RECUSADO do bun)",
    kind: "current",
    pin: { file: "scripts/__tests__/scan-lint-staged-loader.test.ts", marker: "11.7" },
    ref: "gates-proofs.md sec 11.7 (L3043)",
  },
  {
    section: "11.8",
    claim: "o par paralelo lint-staged | tsc: race materializada -> exit code 1",
    kind: "current",
    pin: { file: "scripts/__tests__/scan-hook-parallel-race.test.ts", marker: "11.8" },
    ref: "gates-proofs.md sec 11.8 (L3125)",
  },
  {
    section: "11.10",
    claim: "paridade do tsc nos loaders: exit code 0 em todos os runs (A/B)",
    kind: "measurement",
    note: "lever RECUSADO medido uma vez (o loader do bun e irrelevante no tsc) - nenhum guard depende deste veredito, nao ha pin",
    ref: "gates-proofs.md sec 11.10 (L3237)",
  },
  {
    section: "11.11",
    claim: "run-mapped-fuzz --since: zero suites -> skip com exit code 0",
    kind: "current",
    pin: { file: "scripts/__tests__/fuzz-mapped.test.ts", marker: "11.11" },
    ref: "gates-proofs.md sec 11.11 (L3326/L3422)",
  },
  {
    section: "11.12",
    claim: "REAL-REPO CONTRACT do runner --only: exit code 0 e o ARRAY shape",
    kind: "current",
    pin: { file: "scripts/__tests__/fuzz-mapped.test.ts", marker: "11.12" },
    ref: "gates-proofs.md sec 11.12 (L3492)",
  },
  {
    section: "11.17",
    claim: "scan-prepush-batch: 2o node guard -> exit code 1; lista editada -> exit code 0",
    kind: "current",
    pin: { file: "scripts/__tests__/scan-prepush-batch.test.ts", marker: "11.17" },
    ref: "gates-proofs.md sec 11.17 (L3818-3845)",
  },
  {
    section: "11.18",
    claim: "checker de delecao: pura -> exit code 0 (skip); mista/stdin vazio -> exit code 1",
    kind: "current",
    pin: { file: "scripts/__tests__/check-push-deletion.test.ts", marker: "pure deletion" },
    ref: "gates-proofs.md sec 11.18 (L3864-3871)",
  },
  {
    section: "11.19",
    claim: "integrity falha ANTES do fuzz mapeado (exit code 1, sem gastar ~6-14s)",
    kind: "current",
    pin: { file: "scripts/__tests__/check-node-modules-integrity.test.ts", marker: "DIVERGENT" },
    ref: "gates-proofs.md sec 11.19 (L3922/L3955)",
  },
  {
    section: "11.20",
    claim: "ci-proof-run: job concluido no 1o poll -> exit code 0; job nao encontrado/timeout -> exit code 3",
    kind: "current",
    pin: { file: "scripts/__tests__/ci-proof-run.test.ts", marker: "11.20" },
    ref: "gates-proofs.md sec 11.20 (L4095-4097)",
  },
  {
    section: "11.21",
    claim: "contrato de saida do checker: delecao pura -> exit code 0 com [skip]",
    kind: "current",
    pin: { file: "scripts/__tests__/check-push-deletion.test.ts", marker: "11.21" },
    ref: "gates-proofs.md sec 11.21 (L4157-4163)",
  },
  {
    section: "11.27",
    claim: "--mutate: runner remove o script -> exit code 0; path inexistente -> exit code 3; sem --mutate -> exit code 2",
    kind: "current",
    pin: { file: "scripts/__tests__/ci-proof-run.test.ts", marker: "11.27" },
    ref: "gates-proofs.md sec 11.27 (L4259-4273)",
  },
  {
    section: "11.28",
    claim: "runner-owned (flag + auto-delete) -> exit code 3; SCRIPT-OWNED (sem flag) -> exit code 0",
    kind: "current",
    pin: { file: "scripts/__tests__/ci-proof-run.test.ts", marker: "11.28" },
    ref: "gates-proofs.md sec 11.28 (L4304-4332)",
  },
  {
    section: "11.30",
    claim: "eval-built curl passa pelo detector (exit code 0 ACEITO)",
    kind: "superseded",
    supersededBy: "11.36",
    ref: "gates-proofs.md sec 11.30 (L4400-4424) - SUPERSEDED pela 11.36 (tripwire)",
  },
  {
    section: "11.31",
    claim: "connect-timeout sozinho -> fail-loud exit code 2; health-check.sh:57 sem --max-time -> exit code 1",
    kind: "current",
    pin: { file: "scripts/__tests__/scan-curl-timeouts.test.ts", marker: "11.31" },
    ref: "gates-proofs.md sec 11.31 (L4506/L4553)",
  },
  {
    section: "11.33",
    claim: "CLI do guard-gates: exit code 0 cobrindo 18 workflows (0 dangling)",
    kind: "current",
    pin: { file: "scripts/__tests__/scan-guard-gates.test.ts", marker: "11.33" },
    ref: "gates-proofs.md sec 11.33 (L4688-4694)",
  },
  {
    section: "11.36",
    claim: "tripwire eval+curl na mesma linha logica -> exit code 1 (agregado por arquivo:linha)",
    kind: "current",
    pin: { file: "scripts/__tests__/scan-curl-timeouts.test.ts", marker: "11.36" },
    ref: "gates-proofs.md sec 11.36 (L4806-4872) - o SUPERSEDER da 11.30",
  },
  {
    section: "11.38",
    claim: "case-variante --MAX-TIME: erro do curl -> fail-loud exit code 2 (matriz)",
    kind: "current",
    pin: { file: "scripts/__tests__/scan-curl-timeouts.test.ts", marker: "case-variant" },
    ref: "gates-proofs.md sec 11.38 (L5053)",
  },
  {
    section: "11.39",
    claim: "dangling needs no ci.yml -> exit code 1 (DANGLING NEEDS)",
    kind: "current",
    pin: { file: "scripts/__tests__/scan-guard-gates.test.ts", marker: "11.39" },
    ref: "gates-proofs.md sec 11.39 (L5145)",
  },
  {
    section: "11.41",
    claim: "guard da arvore suja: sem flag -> exit code 3; --stash-uncommitted -> exit code 0/3 (pop conflitante)",
    kind: "current",
    pin: { file: "scripts/__tests__/ci-proof-run.test.ts", marker: "11.41" },
    ref: "gates-proofs.md sec 11.41 (L5245-5270)",
  },
  {
    section: "11.42",
    claim: "o CLI scan-exit-claims sai exit code 0 no doc real (REAL-REPO CONTRACT) e exit code 1 com violacoes listadas",
    kind: "current",
    pin: { file: "scripts/__tests__/scan-exit-claims.test.ts", marker: "REAL-REPO CONTRACT do CLI" },
    ref: "gates-proofs.md sec 11.42 (L5282/L5334-5335) - a SELF-GUARD: este registro tambem e uma claim, pinned pela propria suite",
  },
  {
    section: "11.43",
    claim: "ci-proof-run --expect-success-implies-clean: 0 warning-lines no log -> exit code 0; warning-lines (canal ::warning::/##[warning]) -> exit code 1",
    kind: "current",
    pin: { file: "scripts/__tests__/ci-proof-run.test.ts", marker: "11.43" },
    ref: "gates-proofs.md sec 11.43 (decisao 2026-08-11)",
  },
  {
    section: "11.44",
    claim: "ci-proof-run revert do stash do ciclo PELA MENSAGEM (findStashRef + git stash pop <ref>): restaurado -> exit code 0; pop conflitante (com CURE no AVISO) ou stash nao encontrado -> exit code 3",
    kind: "current",
    pin: { file: "scripts/__tests__/ci-proof-run.test.ts", marker: "11.44" },
    ref: "gates-proofs.md sec 11.44 (decisao 2026-08-11)",
  },
  {
    section: "11.45",
    claim: "utf8-check.yml roda o gate consolidado verify-encoding.sh --ci src/ (o comando unico cujo layer 5 e o scan-non-ascii --report sobre scripts/*.mjs - a classe 'acento em gate .mjs' ja esta no CI): step interno regredido para check-utf8 puro -> exit code 1 do contrato; o gate real com byte nao-ASCII num .mjs -> exit code 1 (probe 2026-08-11)",
    kind: "current",
    pin: { file: "scripts/__tests__/workflow-utf8-check-contract.test.ts", marker: "11.45" },
    ref: "gates-proofs.md sec 11.45 (avaliacao 2026-08-11) - premissa invertida: o mjs-gate ja roda no CI via layer 5 do verify-encoding.sh",
  },
  {
    section: "11.47",
    claim: "scan-guard-gates: um sufixo --since/--scope no step test:guard (push net guard-gates.yml OU twin pr-check.yml fragile-guard) -> exit code 1 do guard com 'TEST GUARD STEP MISSING' no caminho exato (o regex EXATO rejeita qualquer sufixo - o lock da recalibracao 8.1, sem trilha de doc)",
    kind: "current",
    pin: { file: "scripts/__tests__/scan-guard-gates.test.ts", marker: "11.47" },
    ref: "gates-proofs.md sec 11.47 (avaliacao 2026-08-11) - a classe do filtro ja travada pelo regex exato; as mutacoes irma --since/--scope pinam o sufixo nos DOIS lados da rede",
  },
  {
    section: "11.49",
    claim: "check-exit-claims-push (o guard git-based do doc commitado): doc commitado com claim nao-registrada -> exit code 1 com as secoes; doc commitado limpo (ou apenas claims pre-existentes no base) -> exit code 0; git show HEAD falhou -> exit code 3",
    kind: "current",
    pin: { file: "scripts/__tests__/check-exit-claims-push.test.ts", marker: "11.49" },
    ref: "gates-proofs.md sec 11.49 (avaliacao 2026-08-11) - a classe 'commit com HUSKY=0/--no-verify esconde claim nova' fechada no push net (Gate 3 mapeia docs -> nada; direcao unica .unregistered - o stale e ruido de delta)",
  },
  {
    section: "11.58",
    claim: "hook-proof-run (o ciclo de prova de hook local num comando): esperado observado + revertido -> exit code 0; exit code divergiu (revert mesmo assim) -> exit code 1; usage errado -> exit code 2; infra (checkout/commit/doc ausente/revert incompleto) -> exit code 3",
    kind: "current",
    pin: { file: "scripts/__tests__/hook-proof-run.test.ts", marker: "11.58" },
    ref: "gates-proofs.md sec 11.58 (decisao 2026-08-11) - o espelho local do ci-proof-run: o ciclo manual das Provas 37/38 num comando",
  },
]

/** Exit codes que o contrato reconhece como claims (0-3, o padrao do repo).
 * Aceita as formas naturais de escrita: `exit 0`, `exit code 0`, `exit
 * status 0`, `exit-code 0` (o hyphen e coberto por [\\s-]+) - a classe
 * 'claim de exit code' nao pode escapar por re-frasear com uma palavra
 * entre `exit` e o numero (o gap que o reviewer da sec 11.42 apontou). */
export const EXIT_CLAIM_RE = /\bexit[\s-]+(code|status)?[\s-]*[0-3]\b/i

/**
 * EXIT_CLAIMS_CURE - o comando de cura da classe unregistered (sec 11.54):
 * o fix exato (registrar a claim no EXIT_CLAIMS) + a confirmacao (o CLI
 * --check sai limpo). O padrao do --check-lock da sec 8.5/8.6 (o integrity
 * imprime CURE: rm -rf node_modules && bun install --frozen-lockfile). A
 * string e COMPARTILHADA entre o CLI (scan-exit-claims.mjs, stderr) e o
 * guard do push (check-exit-claims-push.mjs, stdout) - a fonte unica da
 * regra dos 2 usos, para o fix nunca driftar entre os dois pontos de erro
 * da MESMA classe.
 */
export const EXIT_CLAIMS_CURE =
  "CURE: registre a claim no EXIT_CLAIMS de scripts/scan-exit-claims.mjs (sec 11.42) e confirme com: node scripts/scan-exit-claims.mjs --check"

/**
 * scanDocExitClaims - o DETECTOR HONESTO das claims de exit code nas
 * secoes 11.x do gates-proofs.md. Varre o doc por headers `## 11.N` e
 * coleta as linhas do corpo que casam EXIT_CLAIM_RE. NAO infere
 * semantica: se a linha tem `exit 0`/`exit 1`/..., e uma claim de exit
 * code naquela secao. O contrato exige que toda claim detectada tenha
 * entrada no manifest (mesma direcao doc -> manifest do scan-surfaces).
 *
 * @param {string} docPath - caminho do gates-proofs.md (default o real).
 * @returns {Map<string, number[]>} secao -> linhas com claim.
 */
export function scanDocExitClaims(docPath = DOC) {
  const lines = fs.readFileSync(docPath, "utf8").split(/\r?\n/)
  const claims = new Map()
  let cur = null
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^## (11\.\d+)/)
    if (m) {
      cur = m[1]
      continue
    }
    if (/^## \d/.test(lines[i])) cur = null // saiu das secoes 11.x
    if (cur && EXIT_CLAIM_RE.test(lines[i])) {
      if (!claims.has(cur)) claims.set(cur, [])
      claims.get(cur).push(i + 1)
    }
  }
  return claims
}

// ---------------------------------------------------------------------------
// Sec 11.62 - o PIN dos counts citados nas 8.x: a UNICA leitura sancionada
// das secoes de evento (a excecao a fronteira da sec 11.51). Coleta as
// citacoes verbatim `clean (N claims` do CLI --check, PARAGRAFO a paragrafo
// (linhas embrulhadas unidas - o caso real da sec 8.34, onde `clean (27` e
// `claims)` estao em linhas fisicas distintas). NAO detecta exit-code
// claims - o scanDocExitClaims segue 11.x-only (o SCOPE FRONTIER test da
// sec 11.51 permanece intocado).
// ---------------------------------------------------------------------------
const REVAL_MARKER_RE = /^\*\*Re-valida[\u00e7c]\u00e3o (datada )?\(\d{4}-\d{2}-\d{2}/
const CLEAN_COUNT_RE = /clean \((\d+) claims/g

/**
 * scanCitedCounts - varre as secoes 8.x e retorna por secao:
 *   { section, hasReval, counts }
 * hasReval = a secao tem um paragrafo marcado como re-validacao datada
 * (`**Re-valida\u00e7\u00e3o (DATE` / `**Re-valida\u00e7\u00e3o datada (DATE`) -
 * o registro sancionado que cobre os counts historicos da secao (sec 8.34).
 * O marcador e setado MESMO sem citacoes no paragrafo (o sinal e o header).
 */
export function scanCitedCounts(docPath = DOC) {
  const lines = fs.readFileSync(docPath, "utf8").split(/\r?\n/)
  const sections = []
  let cur = null
  let para = []
  let paraFirst = null
  const flush = () => {
    if (cur && para.length > 0) {
      const isReval = !!(paraFirst && REVAL_MARKER_RE.test(paraFirst))
      const counts = []
      for (const m of para.join(" ").matchAll(CLEAN_COUNT_RE)) counts.push(Number(m[1]))
      if (counts.length > 0 || isReval) {
        const rec = sections.find((s) => s.section === cur)
        if (rec) {
          if (isReval) rec.hasReval = true
          rec.counts.push(...counts)
        } else {
          sections.push({ section: cur, hasReval: isReval, counts })
        }
      }
    }
    para = []
    paraFirst = null
  }
  for (const l of lines) {
    const m8 = l.match(/^## 8\.(\d+)/)
    if (m8) {
      flush()
      cur = `8.${m8[1]}`
      continue
    }
    if (/^## \d/.test(l)) {
      flush()
      cur = null
      continue
    }
    if (cur) {
      if (l.trim() === "") flush()
      else {
        if (para.length === 0) paraFirst = l
        para.push(l)
      }
    }
  }
  flush()
  return sections
}

/**
 * checkCitedCounts - o contrato da sec 11.62: toda secao 8.x que cita
 * counts deve, ou citar somente o count ATUAL do manifest (default
 * EXIT_CLAIMS.length), ou ter uma re-validacao datada (a excecao
 * sancionada que cobre os counts historicos). Retorna as violacoes:
 *   { section, counts }
 */
export function checkCitedCounts(docPath = DOC, current = EXIT_CLAIMS.length) {
  return scanCitedCounts(docPath)
    .filter((s) => !s.hasReval)
    .filter((s) => s.counts.some((c) => c !== current))
    .map((s) => ({ section: s.section, counts: s.counts }))
}

/** Resolve o pin de uma entrada do manifest (file real + marker no conteudo). */
export function resolvePin(pin) {
  if (!pin) return null
  const filePath = path.join(process.cwd(), pin.file)
  if (!fs.existsSync(filePath)) return null
  const content = fs.readFileSync(filePath, "utf8")
  return content.includes(pin.marker) ? { filePath, marker: pin.marker } : null
}

/**
 * resolveChain - a regra da cadeia SUPERSEDED (sec 11.42): uma secao
 * superseded precisa de um sucessor que E current COM pin real - o leitor
 * da secao antiga e redirecionado para a verdade atual PINADA. Retorna a
 * mensagem da violacao ou null quando a cadeia esta valida. Expor a regra
 * permite o teste de MUTATION exercitar o codigo real (nao uma copia).
 */
export function resolveChain(e, bySection) {
  const successor = bySection.get(e.supersededBy)
  if (!successor || successor.kind !== "current" || !resolvePin(successor.pin)) {
    return `${e.section} -> ${e.supersededBy}: o sucessor precisa ser current + pin real`
  }
  return null
}

/**
 * checkExitClaims - a validacao completa do contrato sobre o doc real.
 * @returns {{ unregistered: string[], stale: string[], brokenPins: string[], brokenChains: string[] }}
 *   unregistered: claim detectada no doc sem entrada no manifest.
 *   stale: entrada do manifest cuja secao NAO tem mais claim detectada no
 *          doc (secao renumerada/removida = drift - o espelho do
 *          unregistered, a direcao manifest -> doc que o reviewer pediu).
 */
export function checkExitClaims(docPath = DOC) {
  const detected = scanDocExitClaims(docPath)
  const bySection = new Map(EXIT_CLAIMS.map((e) => [e.section, e]))
  const unregistered = [...detected.keys()].filter((s) => !bySection.has(s))
  const stale = EXIT_CLAIMS.map((e) => e.section).filter((s) => !detected.has(s))
  const brokenPins = []
  const brokenChains = []
  for (const e of EXIT_CLAIMS) {
    if (e.kind === "current" && !resolvePin(e.pin)) {
      brokenPins.push(`${e.section}: pin ${e.pin ? e.pin.file + " / " + e.pin.marker : "(ausente)"}`)
    }
    if (e.kind === "superseded") {
      const chainMsg = resolveChain(e, bySection)
      if (chainMsg) brokenChains.push(chainMsg)
    }
  }
  return { unregistered, stale, brokenPins, brokenChains }
}

/** CLI: `node scripts/scan-exit-claims.mjs [--check]` - exit 0/1/2. */
export function main() {
  const args = process.argv.slice(2)
  const unknown = args.filter((a) => a.startsWith("--") && a !== "--check")
  if (unknown.length > 0) {
    process.stderr.write("exit-claims: usage: node scripts/scan-exit-claims.mjs [--check]\n")
    return 2
  }
  const { unregistered, stale, brokenPins, brokenChains } = checkExitClaims()
  const total = EXIT_CLAIMS.length
  if (unregistered.length === 0 && stale.length === 0 && brokenPins.length === 0 && brokenChains.length === 0) {
    process.stdout.write(
      `exit-claims: clean (${total} claims registradas em ${EXIT_CLAIMS.filter((e) => e.kind === "current").length} current + ${EXIT_CLAIMS.filter((e) => e.kind === "superseded").length} superseded + ${EXIT_CLAIMS.filter((e) => e.kind === "measurement").length} measurement - sec 11.42)\n`,
    )
    return 0
  }
  if (unregistered.length > 0) {
    process.stderr.write(`exit-claims: ${unregistered.length} claim(s) de exit code SEM registro no manifest (sec 11.42):\n`)
    for (const s of unregistered) process.stderr.write(`  claim na secao ${s} nao esta no EXIT_CLAIMS\n`)
    process.stderr.write(`  ${EXIT_CLAIMS_CURE}\n`)
  }
  if (stale.length > 0) {
    process.stderr.write(`exit-claims: ${stale.length} entrada(s) do manifest SEM claim detectada no doc (secao renumerada/removida - sec 11.42/11.55):\n`)
    for (const s of stale) process.stderr.write(`  entrada ${s} sem claim no doc atual\n`)
    process.stderr.write(`  stale nao tem CURE de registrar - a secao foi renumerada/removida: atualize a secao no EXIT_CLAIMS ou remova a entrada (sec 11.42/11.55)\n`)
  }
  if (brokenPins.length > 0) {
    process.stderr.write(`exit-claims: ${brokenPins.length} pin(s) de claim current quebrados (arquivo/marker ausente - sec 11.42):\n`)
    for (const p of brokenPins) process.stderr.write(`  ${p}\n`)
  }
  if (brokenChains.length > 0) {
    process.stderr.write(`exit-claims: ${brokenChains.length} cadeia(s) SUPERSEDED quebradas (sucessor sem pin real - sec 11.42):\n`)
    for (const c of brokenChains) process.stderr.write(`  ${c}\n`)
  }
  return 1
}

// Entry-point guard: so roda o CLI quando executado direto (vitest importa
// o modulo para os testes das funcoes puras sem efeitos colaterais).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main()
}
