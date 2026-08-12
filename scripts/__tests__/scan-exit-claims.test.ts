/**
 * scan-exit-claims.test.ts - o CONTRATO da classe 'claim de doc sem pin
 * no codigo' (2026-08-11, sec 11.42 do gates-proofs.md).
 *
 * WHY THIS SUITE EXISTS: o SUPERSEDED da sec 11.30 virou padrao - uma
 * decisao documentada como exit code 0 que uma mudanca posterior (sec
 * 11.36) inverteu silenciosamente na doc. Um leitor da sec 11.30 confiava
 * numa premissa morta. Este suite torna a classe um CONTRATO:
 *
 *   - ABS PIN (content, sec 11.50): o teste pina o CONTEUDO do manifest
 *     (o snapshot ABS_PIN_SNAPSHOT: section + kind + claim das 27
 *     entradas) - a lista de secoes e DERIVADA do EXIT_CLAIMS no assert
 *     (o padrao dos fatos consumidos, nao uma copia que driftara). Uma
 *     claim nova (ou reescrita / kind trocado) exige editar o snapshot
 *     conscientemente - registrar e a decisao, nunca o silencio (o growth
 *     contract aplicado ao conteudo, nao so ao numero).
 *   - MANIFEST SHAPE: kinds validos (current/superseded/measurement),
 *     superseded tem supersededBy, measurement tem note.
 *   - PIN REALITY (manifest-registry pattern): toda entrada current tem
 *     pin REAL (arquivo de suite existe + marker presente no conteudo,
 *     lido do disco - nao prosa).
 *   - SUPERSEDED CHAIN: toda entrada superseded aponta para um sucessor
 *     que E current com pin real - o leitor da secao antiga e
 *     redirecionado para a verdade atual PINADA (o caso 11.30 -> 11.36).
 *   - DOC COVERAGE bidirecional (doc -> manifest E manifest -> doc): o
 *     detector honesto varre o doc real; toda claim detectada tem
 *     entrada, e toda entrada tem claim detectada.
 *   - MUTATION: o detector/checker pegam a classe real (claim em secao
 *     nao registrada; superseded sem sucessor) - nao e assert que passa
 *     por acaso.
 *   - REAL-REPO CONTRACT: o CLI real (node scripts/scan-exit-claims.mjs)
 *     sai exit 0 no doc real.
 *
 * Subprocess-heavy (o CLI REAL-REPO CONTRACT spawna node via
 * runSubprocess) -> timeout explicito nesse it (o scan-timeouts guard
 * exige).
 */
import { afterEach, describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
import { cleanupTempDirs, createTempDir, runSubprocess, writeModuleCopy, type ModulePatchOp } from "./golden-copy-utils"
import { EXIT_CLAIMS, EXIT_CLAIM_RE, checkCitedCounts, checkDigestCounts, checkExitClaims, checkRevalCurrent, resolveChain, resolvePin, scanCitedCounts, scanDigestCounts, scanDocExitClaims, scanRevalCounts } from "../scan-exit-claims.mjs"

// O MESMO padrao do unit-surface-contract.test.ts: picomatch (o motor de
// glob do vitest, transitivo garantido ao lado do vitest) para casar globs
// do config contra arquivos reais - nao um regex manual reimplementado.
const require = createRequire(import.meta.url)
const picomatch = require("picomatch")

const ROOT = process.cwd()
const DOC = path.join(ROOT, "docs", "gates-proofs.md")

/** Synthetic doc: apenas as secoes passadas (header + body), para MUTATIONs. */
function writeSyntheticDoc(dir: string, sections: Array<{ header: string; body: string[] }>) {
  const lines: string[] = []
  for (const s of sections) {
    lines.push(s.header)
    for (const b of s.body) lines.push(b)
  }
  const docPath = path.join(dir, "gates-proofs.md")
  fs.writeFileSync(docPath, lines.join("\n") + "\n")
  return docPath
}

const CLAIM_LINES = [
  "alguma linha com exit 0 aqui",
  "outra com exit 1 e exit 3",
  "linha sem claim",
]

/**
 * O snapshot do CONTEUDO pinado (sec 11.50): section + kind + claim das 27
 * entradas do EXIT_CLAIMS, na ORDEM do manifest. A lista de secoes NAO e
 * mais uma copia separada no teste (o drift class que o pedido matou) - e
 * a projecao deste snapshot; editar o manifest (adicionar/re-escrever uma
 * claim, trocar kind) exige editar ESTE snapshot conscientemente (o growth
 * contract aplicado ao conteudo, nao so ao numero).
 */
const ABS_PIN_SNAPSHOT: Array<[string, string, string]> = [
  ["11.2", "measurement", "eslint_d aplica --fix (exit code 0, arquivo preservado)"],
  ["11.6", "current", "pre-commit com o shim eslintd flippado roda verde (exit code 0)"],
  ["11.7", "current", "paridade de loader: exit code 0 nos tres (veredito RECUSADO do bun)"],
  ["11.8", "current", "o par paralelo lint-staged | tsc: race materializada -> exit code 1"],
  ["11.10", "measurement", "paridade do tsc nos loaders: exit code 0 em todos os runs (A/B)"],
  ["11.11", "current", "run-mapped-fuzz --since: zero suites -> skip com exit code 0"],
  ["11.12", "current", "REAL-REPO CONTRACT do runner --only: exit code 0 e o ARRAY shape"],
  ["11.17", "current", "scan-prepush-batch: 2o node guard -> exit code 1; lista editada -> exit code 0"],
  ["11.18", "current", "checker de delecao: pura -> exit code 0 (skip); mista/stdin vazio -> exit code 1"],
  ["11.19", "current", "integrity falha ANTES do fuzz mapeado (exit code 1, sem gastar ~6-14s)"],
  ["11.20", "current", "ci-proof-run: job concluido no 1o poll -> exit code 0; job nao encontrado/timeout -> exit code 3"],
  ["11.21", "current", "contrato de saida do checker: delecao pura -> exit code 0 com [skip]"],
  ["11.27", "current", "--mutate: runner remove o script -> exit code 0; path inexistente -> exit code 3; sem --mutate -> exit code 2"],
  ["11.28", "current", "runner-owned (flag + auto-delete) -> exit code 3; SCRIPT-OWNED (sem flag) -> exit code 0"],
  ["11.30", "superseded", "eval-built curl passa pelo detector (exit code 0 ACEITO)"],
  ["11.31", "current", "connect-timeout sozinho -> fail-loud exit code 2; health-check.sh:57 sem --max-time -> exit code 1"],
  ["11.33", "current", "CLI do guard-gates: exit code 0 cobrindo 18 workflows (0 dangling)"],
  ["11.36", "current", "tripwire eval+curl na mesma linha logica -> exit code 1 (agregado por arquivo:linha)"],
  ["11.38", "current", "case-variante --MAX-TIME: erro do curl -> fail-loud exit code 2 (matriz)"],
  ["11.39", "current", "dangling needs no ci.yml -> exit code 1 (DANGLING NEEDS)"],
  ["11.41", "current", "guard da arvore suja: sem flag -> exit code 3; --stash-uncommitted -> exit code 0/3 (pop conflitante)"],
  ["11.42", "current", "o CLI scan-exit-claims sai exit code 0 no doc real (REAL-REPO CONTRACT) e exit code 1 com violacoes listadas"],
  ["11.43", "current", "ci-proof-run --expect-success-implies-clean: 0 warning-lines no log -> exit code 0; warning-lines (canal ::warning::/##[warning]) -> exit code 1"],
  ["11.44", "current", "ci-proof-run revert do stash do ciclo PELA MENSAGEM (findStashRef + git stash pop <ref>): restaurado -> exit code 0; pop conflitante (com CURE no AVISO) ou stash nao encontrado -> exit code 3"],
  ["11.45", "current", "utf8-check.yml roda o gate consolidado verify-encoding.sh --ci src/ (o comando unico cujo layer 5 e o scan-non-ascii --report sobre scripts/*.mjs - a classe 'acento em gate .mjs' ja esta no CI): step interno regredido para check-utf8 puro -> exit code 1 do contrato; o gate real com byte nao-ASCII num .mjs -> exit code 1 (probe 2026-08-11)"],
  ["11.47", "current", "scan-guard-gates: um sufixo --since/--scope no step test:guard (push net guard-gates.yml OU twin pr-check.yml fragile-guard) -> exit code 1 do guard com 'TEST GUARD STEP MISSING' no caminho exato (o regex EXATO rejeita qualquer sufixo - o lock da recalibracao 8.1, sem trilha de doc)"],
  ["11.49", "current", "check-exit-claims-push (o guard git-based do doc commitado): doc commitado com claim nao-registrada -> exit code 1 com as secoes; doc commitado limpo (ou apenas claims pre-existentes no base) -> exit code 0; git show HEAD falhou -> exit code 3"],
  ["11.58", "current", "hook-proof-run (o ciclo de prova de hook local num comando): esperado observado + revertido -> exit code 0; exit code divergiu (revert mesmo assim) -> exit code 1; usage errado -> exit code 2; infra (checkout/commit/doc ausente/revert incompleto) -> exit code 3"],
]

afterEach(() => {
  cleanupTempDirs()
})

describe("scripts/scan-exit-claims.mjs - EXIT CLAIMS MANIFEST (sec 11.42)", () => {
  it("ABS PIN (content, sec 11.50): o EXIT_CLAIMS pinado pelo CONTEUDO (section + kind + claim) - a lista de secoes e DERIVADA do manifest no assert (o padrao dos fatos consumidos, nao uma copia que driftara); editar uma claim exige editar o snapshot conscientemente", () => {
    expect(EXIT_CLAIMS.map((e) => [e.section, e.kind, e.claim])).toEqual(ABS_PIN_SNAPSHOT)
  })

  it("MANIFEST SHAPE: kinds validos + superseded tem supersededBy + measurement tem note + toda entrada tem ref", () => {
    for (const e of EXIT_CLAIMS) {
      expect(["current", "superseded", "measurement"], e.section).toContain(e.kind)
      expect(e.ref, e.section).toBeTruthy()
      expect(e.claim, e.section).toBeTruthy()
      if (e.kind === "superseded") {
        expect(e.supersededBy, e.section).toBeTruthy()
        expect(e.supersededBy, e.section).not.toBe(e.section)
      }
      if (e.kind === "measurement") {
        expect(e.note, e.section).toBeTruthy()
      }
    }
  })

  it("PIN REALITY: toda entrada current tem pin REAL (arquivo existe + marker no conteudo, lido do disco)", () => {
    const currents = EXIT_CLAIMS.filter((e) => e.kind === "current")
    expect(currents.length).toBeGreaterThan(0)
    for (const e of currents) {
      const resolved = resolvePin(e.pin)
      expect(resolved, `${e.section}: pin ${e.pin ? e.pin.file + " / " + e.pin.marker : "(ausente)"}`).toBeTruthy()
      // O marker precisa estar no ARQUIVO do pin, lido do disco (nao prosa).
      const content = fs.readFileSync(resolved!.filePath, "utf8")
      expect(content.includes(e.pin!.marker), `${e.section}: marker '${e.pin!.marker}' ausente em ${e.pin!.file}`).toBe(true)
    }
  })

  it("SUPERSEDED CHAIN: o sucessor de toda superseded e current COM pin real - o par canonico 11.30 -> 11.36", () => {
    const bySection = new Map(EXIT_CLAIMS.map((e) => [e.section, e]))
    const superseded = EXIT_CLAIMS.filter((e) => e.kind === "superseded")
    expect(superseded.length).toBeGreaterThan(0)
    for (const e of superseded) {
      const successor = bySection.get(e.supersededBy!)
      expect(successor, `${e.section}: sucessor ${e.supersededBy} ausente`).toBeTruthy()
      expect(successor!.kind, `${e.section}: sucessor ${e.supersededBy} precisa ser current`).toBe("current")
      expect(resolvePin(successor!.pin), `${e.section}: sucessor ${e.supersededBy} precisa de pin real`).toBeTruthy()
    }
    // O par canonico da classe (o SUPERSEDED que virou padrao): 11.30 foi
    // invertida pela 11.36 (tripwire) - o leitor da 11.30 e redirecionado.
    const s1130 = bySection.get("11.30")!
    expect(s1130.kind).toBe("superseded")
    expect(s1130.supersededBy).toBe("11.36")
    expect(bySection.get("11.36")!.kind).toBe("current")
    expect(resolvePin(bySection.get("11.36")!.pin)).toBeTruthy()
  })
})

describe("scripts/scan-exit-claims.mjs - DOC COVERAGE bidirecional (sec 11.42)", () => {
  it("doc -> manifest: toda claim de exit code detectada no doc REAL tem entrada no manifest", () => {
    const detected = scanDocExitClaims(DOC)
    const registered = new Set(EXIT_CLAIMS.map((e) => e.section))
    const unregistered = [...detected.keys()].filter((s) => !registered.has(s))
    expect(unregistered).toEqual([])
    // o detector acha pelo menos as 21 registradas (sanity)
    expect(detected.size).toBeGreaterThanOrEqual(EXIT_CLAIMS.length)
  })

  it("manifest -> doc: toda entrada do manifest tem claim detectada no doc REAL (entrada stale = drift)", () => {
    const detected = scanDocExitClaims(DOC)
    const missing = EXIT_CLAIMS.map((e) => e.section).filter((s) => !detected.has(s))
    expect(missing).toEqual([])
  })

  it("checkExitClaims: doc real -> zero problemas, incluindo o stale (REAL-REPO, a mesma logica do CLI)", () => {
    const { unregistered, stale, brokenPins, brokenChains } = checkExitClaims()
    expect(unregistered).toEqual([])
    expect(stale).toEqual([])
    expect(brokenPins).toEqual([])
    expect(brokenChains).toEqual([])
  })
})

describe("scripts/scan-exit-claims.mjs - SCOPE FRONTIER 11.x-only (sec 11.51)", () => {
  // A fronteira do escopo do detector: a sec 11.42 documenta a decisao
  // RECUSADO de estender as secoes 8.x (Provas = registros de evento, nao
  // claims de comportamento) - mas so em prosa. ESTE describe pina a
  // fronteira como contrato: o detector e 11.x-only POR ESCOPO, nao por
  // acidente. Tres direcoes: (1) NEGATIVO real (nenhuma chave 8.x no doc
  // real, com sanity de que o detector ACHA as 11.x); (2) NAO-VACUIDADE (a
  // regiao 8.x TEM citacoes exit-code-like - a exclusao e intencional, nao
  // um doc 8.x vazio); (3) MUTATION hermetico (a MESMA linha sob ## 8.99
  // nao e detectada e sob ## 11.98 e - a fronteira e o HEADER, nao o
  // conteudo).
  it("REAL-REPO: o detector NUNCA retorna chave 8.x no doc real (o escopo 11.x e estrutural - o reset ^## \\d zera em 8.x tambem)", () => {
    const detected = scanDocExitClaims(DOC)
    const eightX = [...detected.keys()].filter((s) => s.startsWith("8."))
    expect(eightX).toEqual([])
    // sanity: o detector ACHA as 11.x (nao e um detector vazio que passa
    // por acaso - a exclusao 8.x so e significativa porque ha 11.x vistas).
    expect(detected.size).toBeGreaterThanOrEqual(EXIT_CLAIMS.length)
  })

  it("REAL-REPO (nao-vacuidade): a regiao 8.x TEM citacoes exit-code-like no doc real (piso = o valor MEDIDO atual, probe 2026-08-11) - a exclusao e intencional, nao acidente de doc vazio", () => {
    const lines = fs.readFileSync(DOC, "utf8").split(/\r?\n/)
    // O MESMO regex do detector (importado - o modulo e a fonte unica, nao
    // uma copia inline que pode driftar se o EXIT_CLAIM_RE mudar de forma).
    let in8 = false
    let count = 0
    for (const line of lines) {
      if (/^## 8\./.test(line)) in8 = true
      else if (/^## [0-9]/.test(line) && !/^## 8\./.test(line) && in8) in8 = false
      if (in8 && EXIT_CLAIM_RE.test(line)) count++
    }
    // O piso e o valor MEDIDO atual (80 citacoes nas secoes 8.x, probe
    // 2026-08-11) - NAO um numero emprestado de outra contagem (a nota da
    // 11.42 dizia 54 para as secoes 8.2-8.28, medida em estado/contagem
    // diferente; a divergencia de metodo e exatamente por que o teto
    // nao e pinado). Adicoes de Prova nova (8.31+) SO SOBEM o count - o
    // piso nunca churn com o crescimento; so uma remocao abaixo do
    // medido (drift real) falha.
    expect(count).toBeGreaterThanOrEqual(80)
  })

  it("MUTATION hermetico: claim sob header ## 8.99 NAO e detectada (o reset ^## \\d zera em 8.x); a MESMA linha sob ## 11.98 E detectada - a fronteira e o header, nao o conteudo", () => {
    const dir8 = createTempDir("sec11-51-")
    const eightPath = writeSyntheticDoc(dir8, [{ header: "## 8.99 Prova ficticia", body: CLAIM_LINES }])
    expect(scanDocExitClaims(eightPath).has("8.99")).toBe(false)
    const dir11 = createTempDir("sec11-51-")
    const elevenPath = writeSyntheticDoc(dir11, [{ header: "## 11.98 Claim real", body: CLAIM_LINES }])
    expect(scanDocExitClaims(elevenPath).has("11.98")).toBe(true)
  })
})

describe("scripts/scan-exit-claims.mjs - DEFAULT CONFIG INCLUDE (sec 11.53)", () => {
  // A premissa do pedido da sec 11.53: "o ci.yml roda test:run (nao
  // test:unit) no push - a claim que escapar do guard 11.49 e do CI de PR
  // so e pega pelo pr-check". O fato (probe 2026-08-11): test:run =
  // `vitest run` com o config DEFAULT (vitest.config.ts), cujo include
  // cobre scripts/**/*.test.{ts,tsx} - o DOC COVERAGE desta suite (le o
  // doc REAL via scanDocExitClaims(DOC)) RODA no push do ci.yml. ESTE
  // describe pina a premissa: se alguem estreitar o include do config
  // default, o push do ci.yml perde o DOC COVERAGE silenciosamente e a
  // premissa do pedido vira verdade - o pin falha alto antes (o padrao do
  // unit-surface-contract aplicado ao config DEFAULT, nao ao unit).
  const DEFAULT_CONFIG = path.join(ROOT, "vitest.config.ts")

  /** O include TOP-LEVEL (test) do config default, lido do TEXTO (o mesmo
   *  padrao do unit-surface-contract - importar o config in-process quebra
   *  o invariante do vite; o texto e a fonte estavel).
   *  FIRST-MATCH: o regex casa o PRIMEIRO bloco `include:` do arquivo - o
   *  test-level (linha ~15, com os dois globs) PRECISA preceder o
   *  coverage-level (linha ~23, so src/**). Um reorder do config casaria o
   *  bloco errado e o assert do glob scripts falharia alto (seguro, mas o
   *  comentario evita a confusao de leitura). */
  function testLevelInclude(configText: string): string[] {
    const m = configText.match(/include:\s*\[([\s\S]*?)\]/)
    if (!m) {
      throw new Error("default-config: include: block not found in vitest.config.ts - update this extractor")
    }
    return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1])
  }

  it("REAL-REPO: o include do vitest.config.ts contem scripts/**/*.test.{ts,tsx} (o test:run do ci.yml roda o DOC COVERAGE no push - a premissa do pedido e FALSA)", () => {
    const include = testLevelInclude(fs.readFileSync(DEFAULT_CONFIG, "utf8"))
    expect(include).toContain("scripts/**/*.test.{ts,tsx}")
    expect(include).toContain("src/**/*.test.{ts,tsx}")
  })

  it("REAL-REPO: o proprio arquivo desta suite casa com o glob scripts/** via picomatch (o DOC COVERAGE real roda sob o config default - 18 testes, probe 2026-08-11)", () => {
    const include = testLevelInclude(fs.readFileSync(DEFAULT_CONFIG, "utf8"))
    const scriptsGlob = include.find((p) => p.includes("scripts"))!
    expect(picomatch(scriptsGlob)("scripts/__tests__/scan-exit-claims.test.ts")).toBe(true)
  })

  it("MUTATION: config default SEM o glob scripts/** (include estreitado para src apenas) -> o pin DETECTA a perda (a cobertura do push regrediria silenciosamente sem este contrato)", () => {
    const src = fs.readFileSync(DEFAULT_CONFIG, "utf8")
    const mutated = src.replace(', "scripts/**/*.test.{ts,tsx}"', "")
    expect(mutated).not.toBe(src)
    const include = testLevelInclude(mutated)
    expect(include).not.toContain("scripts/**/*.test.{ts,tsx}")
  })
})

describe("scripts/scan-exit-claims.mjs - 8.x COUNTS PIN (sec 11.62)", () => {
  it("REAL-REPO: secao 8.x SEM re-validacao datada cita somente o count atual; a 8.34 e coberta pela re-validacao (o wrap 'clean (27\\nclaims)' pego no doc real)", () => {
    const s = scanCitedCounts(DOC)
    expect(s.length).toBeGreaterThanOrEqual(2)
    const sec34 = s.find((x) => x.section === "8.34")
    expect(sec34).toBeDefined()
    expect(sec34.hasReval).toBe(true)
    // o 27 e a citacao EMBRULHADA do controle historico (2 linhas fisicas -
    // o wrap que o flatten por paragrafo resolve); o 28 e a re-validacao
    // datada - ambos coexistem na secao coberta (registros de evento)
    expect(sec34.counts).toEqual(expect.arrayContaining([27, 28]))
    const sec35 = s.find((x) => x.section === "8.35")
    expect(sec35).toBeDefined()
    expect(sec35.hasReval).toBe(false)
    // o pin do count ATUAL (28): a cada claim nova no EXIT_CLAIMS, este
    // assert muda de proposito (o padrao do ABS PIN) - e a 8.35 passa a
    // exigir uma re-validacao datada (node scripts/doc-revalidate.mjs --section 8.35)
    expect(sec35.counts).toEqual([28])
    expect(checkCitedCounts(DOC)).toEqual([])
  })

  it("MUTATION: secao 8.x sem re-validacao citando count antigo -> violacao (a classe da 27->28)", () => {
    const dir = createTempDir("sec11-62-")
    const docPath = writeSyntheticDoc(dir, [
      {
        header: "## 8.99 Prova X - controle sintetico",
        body: ["", "**Controle pos-ciclo**: CLI `clean (25 claims)` exit 0.", "", "## 9. Outra secao", ""],
      },
    ])
    expect(checkCitedCounts(docPath, 28)).toEqual([{ section: "8.99", counts: [25] }])
  })

  it("MUTATION: a re-validacao datada EXIME a secao (counts historicos sancionados, o mecanismo da 8.34)", () => {
    const dir = createTempDir("sec11-62-")
    const docPath = writeSyntheticDoc(dir, [
      {
        header: "## 8.99 Prova X - controle sintetico",
        body: [
          "",
          "**Controle pos-ciclo**: CLI `clean (25 claims)` exit 0.",
          "",
          "**Re-validação (2026-08-11, 28 claims)**: re-validado no estado atual.",
          "",
          "## 9. Outra secao",
          "",
        ],
      },
    ])
    expect(checkCitedCounts(docPath, 28)).toEqual([])
  })

  it("MUTATION: '**Re-validação**:' SEM data NAO exime (so o registro datado sanciona)", () => {
    const dir = createTempDir("sec11-62-")
    const docPath = writeSyntheticDoc(dir, [
      {
        header: "## 8.99 Prova X - controle sintetico",
        body: ["", "**Controle pos-ciclo**: CLI `clean (25 claims)` exit 0.", "", "**Re-validação**: `npx vitest run ...`", "", "## 9. Outra secao", ""],
      },
    ])
    expect(checkCitedCounts(docPath, 28)).toEqual([{ section: "8.99", counts: [25] }])
  })

  it("MUTATION: citacao EMBRULHADA em 2 linhas fisicas e pega (o caso real da 8.34)", () => {
    const dir = createTempDir("sec11-62-")
    const docPath = writeSyntheticDoc(dir, [
      {
        header: "## 8.99 Prova X - controle sintetico",
        body: ["", "**Controle pos-ciclo**: CLI `clean (25", "claims)` exit 0.", "", "## 9. Outra secao", ""],
      },
    ])
    expect(checkCitedCounts(docPath, 28)).toEqual([{ section: "8.99", counts: [25] }])
  })

  it("FRONTEIRA verbatim vs narrativa (sec 11.62): prosa natural citando count historico NAO e contract - o scanner so le o token verbatim `clean (N claims` do CLI; o MESMO numero em prosa nao gera record, em verbatim viola (a narrativa 'o manifest em 27 claims' da 8.34 e livre por desenho, nao drift)", () => {
    // (a) prosa narrativa: 'o controle acima foi capturado com o manifest em
    // 27 claims' - linguagem natural, SEM o token verbatim do stdout do CLI.
    // O CLEAN_COUNT_RE NAO le: nenhum record e criado na secao (nem counts
    // nem reval) e checkCitedCounts nao viola - a prosa historica e registro
    // livre do evento, nunca contract (a varredura ampla achou a narrativa
    // real na L2796 da reval da 8.34 - o leitor nao deve achar que e drift).
    const dirProse = createTempDir("sec11-62-")
    const prosePath = writeSyntheticDoc(dirProse, [
      {
        header: "## 8.99 Prova X - controle sintetico",
        body: [
          "",
          "**Controle pos-ciclo**: o controle acima foi capturado com o manifest em 27 claims; a 28a entrou depois.",
          "",
          "## 9. Outra secao",
          "",
        ],
      },
    ])
    expect(scanCitedCounts(prosePath).find((s) => s.section === "8.99")).toBeUndefined()
    expect(checkCitedCounts(prosePath, 28)).toEqual([])
    // (b) o CONTRAFACTUAL verbatim: o MESMO numero na forma exata do stdout
    // do CLI (`clean (27 claims`) E contract - viola sem re-validacao. A
    // fronteira e o FORMATO (o token do CLI), nao o numero citado.
    const dirVerbatim = createTempDir("sec11-62-")
    const verbatimPath = writeSyntheticDoc(dirVerbatim, [
      {
        header: "## 8.99 Prova X - controle sintetico",
        body: ["", "**Controle pos-ciclo**: CLI `clean (27 claims)` exit 0.", "", "## 9. Outra secao", ""],
      },
    ])
    expect(checkCitedCounts(verbatimPath, 28)).toEqual([{ section: "8.99", counts: [27] }])
  })
})

describe("scripts/scan-exit-claims.mjs - RE-MEDICAO COUNTS FRONTIER (sec 11.74)", () => {
  it("REAL-REPO: os counts de testes/suites das re-mediacoes da 8.1 ('14 suites / 304 testes') NAO geram record no scanCitedCounts - sao registro de evento run-pinned (run number + commit no bloco), nao claims do CLI; o detector so le o token verbatim 'clean (N claims' (o token class e a fronteira, nao o numero)", () => {
    const s = scanCitedCounts(DOC)
    expect(s.find((x) => x.section === "8.1")).toBeUndefined()
    // a doc REAL cita os counts (a prova de que a ausencia de record e o
    // TOKEN CLASS, nao a ausencia de citacao)
    const doc = fs.readFileSync(DOC, "utf8")
    expect(doc).toMatch(/\d+ testes/)
    // e o current truth e DERIVED (package.json test:guard, a fonte unica
    // pinada pela 8.4 REAL-REPO CONTRACT + sec 11.73), nunca doc-citado -
    // o doc so REGISTRA o que cada run mediu
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"))
    expect(pkg.scripts["test:guard"]).toContain("scan-push-full-suite.test.ts")
  })

  it("MUTATION: prosa de re-mediacao com counts de testes/suites NAO viola (registro historico imutavel); o MESMO numero no token verbatim do CLI na MESMA secao viola - a fronteira e o FORMATO, o contrafactual da 11.62 aplicado a classe de medidas", () => {
    // (a) prosa de re-mediacao: 'o run 31587061757 mediu 14 suites / 304
    // testes no HEAD e50a186' - linguagem natural de registro de evento,
    // SEM o token verbatim do stdout do CLI. Nenhum record e criado e
    // checkCitedCounts nao viola (a classe das re-mediacoes da 8.1).
    const dirProse = createTempDir("sec11-74-")
    const prosePath = writeSyntheticDoc(dirProse, [
      {
        header: "## 8.99 Prova X - controle sintetico",
        body: [
          "",
          "**Re-mediacao (5)**: o run 31587061757 mediu 14 suites / 304 testes no HEAD e50a186.",
          "",
          "## 9. Outra secao",
          "",
        ],
      },
    ])
    expect(scanCitedCounts(prosePath).find((s) => s.section === "8.99")).toBeUndefined()
    expect(checkCitedCounts(prosePath, 28)).toEqual([])
    // (b) o CONTRAFACTUAL verbatim: o MESMO tipo de secao com o token do
    // stdout do CLI (clean (27 claims) E contract - viola sem re-validacao.
    const dirVerbatim = createTempDir("sec11-74-")
    const verbatimPath = writeSyntheticDoc(dirVerbatim, [
      {
        header: "## 8.99 Prova X - controle sintetico",
        body: ["", "**Controle pos-ciclo**: CLI `clean (27 claims)` exit 0.", "", "## 9. Outra secao", ""],
      },
    ])
    expect(checkCitedCounts(verbatimPath, 28)).toEqual([{ section: "8.99", counts: [27] }])
  })
})

describe("scripts/scan-exit-claims.mjs - 8.x REVAL CURRENT PIN (sec 11.66)", () => {
  it("REAL-REPO: a secao de controle 8.34 tem reval datada citando o count ATUAL (28) - o par nao esta stale", () => {
    const s = scanRevalCounts(DOC)
    const sec34 = s.find((x) => x.section === "8.34")
    expect(sec34).toBeDefined()
    // o count ATUAL (28) citado na reval da 8.34 - o pin vivo: a cada claim
    // nova no EXIT_CLAIMS, a 8.34 precisa ser re-validada (doc-revalidate)
    expect(sec34!.counts).toContain(EXIT_CLAIMS.length)
    expect(checkRevalCurrent(DOC)).toEqual([])
  })

  it("MUTATION: reval citando count ANTIGO com o manifest crescido -> violacao (a classe do esquecimento do doc-revalidate)", () => {
    const dir = createTempDir("sec11-66-")
    const docPath = writeSyntheticDoc(dir, [
      {
        header: "## 8.99 Prova X - controle sintetico",
        body: ["", "**Re-validação (2026-08-11, 27 claims)**: re-validado quando o manifest tinha 27.", "", "## 9. Outra secao", ""],
      },
    ])
    // o manifest cresceu para 28 e a reval ficou citando 27 -> a secao precisa
    // ser re-validada (o doc-revalidate cita o count NOVO)
    expect(checkRevalCurrent(docPath, 28)).toEqual([{ section: "8.99", counts: [27] }])
  })

  it("MUTATION: reval citando o count ATUAL -> [] (a re-validacao cobre)", () => {
    const dir = createTempDir("sec11-66-")
    const docPath = writeSyntheticDoc(dir, [
      {
        header: "## 8.99 Prova X - controle sintetico",
        body: ["", "**Re-validação (2026-08-11, 28 claims)**: re-validado no estado atual.", "", "## 9. Outra secao", ""],
      },
    ])
    expect(checkRevalCurrent(docPath, 28)).toEqual([])
  })

  it("MUTATION: a linha MANUAL 'datada' TAMBEM e contada (o prefixo opcional do marcador - o caso real da 8.34)", () => {
    const dir = createTempDir("sec11-66-")
    const docPath = writeSyntheticDoc(dir, [
      {
        header: "## 8.99 Prova X - controle sintetico",
        body: ["", "**Re-validação datada (2026-08-11, 27 claims)**: linha manual existente.", "", "## 9. Outra secao", ""],
      },
    ])
    expect(checkRevalCurrent(docPath, 28)).toEqual([{ section: "8.99", counts: [27] }])
  })

  it("REAL-REPO CONTRACT do CLI (sec 11.66): EXIT_CLAIMS_DOC com a 8.99 de reval stale -> exit 1 com a secao exata e a CURE doc-revalidate --section (o guard roda no batch do pre-commit - o tripwire do esquecimento)", () => {
    const dir = createTempDir("sec11-66-")
    const docPath = writeSyntheticDoc(dir, [
      { header: "## 11.42 o CLI scan-exit-claims sai exit code 0 no doc real", body: ["", "**Exit codes**: exit code 0 (doc coberto) / exit code 1 (violacoes listadas).", ""] },
      { header: "## 8.99 Prova X - controle sintetico", body: ["", "**Re-validação (2026-08-11, 27 claims)**: re-validado quando o manifest tinha 27.", ""] },
      { header: "## 12. Referências", body: [""] },
    ])
    const res = runSubprocess({
      command: process.execPath,
      args: [path.join(ROOT, "scripts", "scan-exit-claims.mjs"), "--check"],
      env: { EXIT_CLAIMS_DOC: docPath },
    })
    expect(res.status).toBe(1)
    const stderr = res.stderr ?? ""
    expect(stderr).toContain("re-validacao datada DESATUALIZADA")
    expect(stderr).toContain("secao 8.99")
    expect(stderr).toContain("node scripts/doc-revalidate.mjs --section 8.99")
  }, 60000)
})

describe("scripts/scan-exit-claims.mjs - DIGEST TABLE PIN (sec 11.67)", () => {
  it("REAL-REPO: a TABELA ## 1 cita 2 counts (27 na row 38/sec 8.34 coberta por reval; 28 na row 39/sec 8.35 no count atual) e checkDigestCounts(DOC) e []", () => {
    const d = scanDigestCounts(DOC)
    const row38 = d.find((x) => x.row === 38)
    expect(row38).toBeDefined()
    // a row 38 (Prova 39) cita o 27 historico e referencia a secao de
    // origem 8.34 - que TEM re-validacao datada (a cobertura sanciona)
    expect(row38!.section).toBe("8.34")
    expect(row38!.counts).toContain(27)
    const row39 = d.find((x) => x.row === 39)
    expect(row39).toBeDefined()
    // a row 39 (Prova 40) cita o count ATUAL (28) - nunca viola, mesmo
    // sem reval na origem 8.35
    expect(row39!.section).toBe("8.35")
    expect(row39!.counts).toContain(EXIT_CLAIMS.length)
    expect(checkDigestCounts(DOC)).toEqual([])
  })

  it("MUTATION: row da tabela citando count ANTIGO com secao de origem SEM reval -> violacao (a classe do ponto cego fechado)", () => {
    const dir = createTempDir("sec11-67-")
    const docPath = writeSyntheticDoc(dir, [
      {
        header: "## 1. Tabela resumo",
        body: ["", "| # | Gate sob prova | Prova | Resultado |", "|---|---|---|---|", "| 99 | Guard X (sec 8.99) | `clean (25 claims)` |", ""],
      },
      { header: "## 8.99 Prova X - controle sintetico", body: ["", "**Controle pos-ciclo**: CLI `clean (25 claims)` exit 0.", ""] },
      { header: "## 12. Referências", body: [""] },
    ])
    expect(checkDigestCounts(docPath, 28)).toEqual([{ row: 99, section: "8.99", counts: [25] }])
  })

  it("MUTATION: row citando count ANTIGO mas a secao de origem TEM reval datada -> [] (a cobertura sanciona o historico, o caso real da row 38)", () => {
    const dir = createTempDir("sec11-67-")
    const docPath = writeSyntheticDoc(dir, [
      {
        header: "## 1. Tabela resumo",
        body: ["", "| # | Gate sob prova | Prova | Resultado |", "|---|---|---|---|", "| 99 | Guard X (sec 8.99) | `clean (25 claims)` |", ""],
      },
      {
        header: "## 8.99 Prova X - controle sintetico",
        body: ["", "**Controle pos-ciclo**: CLI `clean (25 claims)` exit 0.", "", "**Re-validação (2026-08-11, 28 claims)**: re-validado no estado atual.", ""],
      },
      { header: "## 12. Referências", body: [""] },
    ])
    expect(checkDigestCounts(docPath, 28)).toEqual([])
  })

  it("MUTATION: row citando o count ATUAL -> [] mesmo sem reval (o count certo nunca viola)", () => {
    const dir = createTempDir("sec11-67-")
    const docPath = writeSyntheticDoc(dir, [
      {
        header: "## 1. Tabela resumo",
        body: ["", "| # | Gate sob prova | Prova | Resultado |", "|---|---|---|---|", "| 99 | Guard X (sec 8.99) | `clean (28 claims)` |", ""],
      },
      { header: "## 8.99 Prova X - controle sintetico", body: ["", "**Controle pos-ciclo**: CLI `clean (28 claims)` exit 0.", ""] },
      { header: "## 12. Referências", body: [""] },
    ])
    expect(checkDigestCounts(docPath, 28)).toEqual([])
  })

  it("MUTATION: row SEM referencia de secao de origem citando count antigo -> violacao fail-loud (section null - a origem nao e verificavel)", () => {
    const dir = createTempDir("sec11-67-")
    const docPath = writeSyntheticDoc(dir, [
      {
        header: "## 1. Tabela resumo",
        body: ["", "| # | Gate sob prova | Prova | Resultado |", "|---|---|---|---|", "| 99 | Guard X sem referencia de secao | `clean (25 claims)` |", ""],
      },
      { header: "## 12. Referências", body: [""] },
    ])
    expect(checkDigestCounts(docPath, 28)).toEqual([{ row: 99, section: null, counts: [25] }])
  })

  it("REAL-REPO CONTRACT do CLI (sec 11.67): EXIT_CLAIMS_DOC com a row 99 do digest descalibrada -> exit 1 com a row exata e a CURE doc-revalidate --section (o guard roda no batch do pre-commit - o ultimo ponto cego da superficie)", () => {
    const dir = createTempDir("sec11-67-")
    const docPath = writeSyntheticDoc(dir, [
      { header: "## 11.42 o CLI scan-exit-claims sai exit code 0 no doc real", body: ["", "**Exit codes**: exit code 0 (doc coberto) / exit code 1 (violacoes listadas).", ""] },
      {
        header: "## 1. Tabela resumo",
        body: ["", "| # | Gate sob prova | Prova | Resultado |", "|---|---|---|---|", "| 99 | Guard X (sec 8.99) | `clean (25 claims)` |", ""],
      },
      { header: "## 8.99 Prova X - controle sintetico", body: ["", "**Controle pos-ciclo**: CLI `clean (25 claims)` exit 0.", ""] },
      { header: "## 12. Referências", body: [""] },
    ])
    const res = runSubprocess({
      command: process.execPath,
      args: [path.join(ROOT, "scripts", "scan-exit-claims.mjs"), "--check"],
      env: { EXIT_CLAIMS_DOC: docPath },
    })
    expect(res.status).toBe(1)
    const stderr = res.stderr ?? ""
    expect(stderr).toContain("TABELA ## 1")
    expect(stderr).toContain("row 99")
    expect(stderr).toContain("node scripts/doc-revalidate.mjs --section 8.99")
  }, 60000)
})

describe("scripts/scan-exit-claims.mjs - MUTATION (a classe real, sec 11.42)", () => {
  it("claim em secao NAO registrada -> checkExitClaims flagra (o growth contract)", () => {
    const dir = createTempDir("sec11-42-")
    const docPath = writeSyntheticDoc(dir, [
      { header: "## 11.99 Uma claim nova", body: CLAIM_LINES },
    ])
    const { unregistered } = checkExitClaims(docPath)
    expect(unregistered).toContain("11.99")
  })

  it("SUPERSEDED sem sucessor registrado -> resolveChain quebra (a cadeia nao pode apontar para o vazio)", () => {
    const bySection = new Map(EXIT_CLAIMS.map((e) => [e.section, e]))
    const s1130 = bySection.get("11.30")!
    expect(s1130.supersededBy).toBe("11.36")
    // Mutacao 1: sucessor AUSENTE do manifest -> a regra resolveChain
    // (o codigo REAL do contrato) quebra com a mensagem exata.
    const without1136 = new Map(bySection)
    without1136.delete("11.36")
    expect(resolveChain(s1130, without1136)).toContain("11.30 -> 11.36")
    // Mutacao 2: sucessor presente mas nao-current (vira measurement, sem
    // pin) -> a regra quebra: o leitor seria redirecionado para o vazio.
    const mutatedSuccessor = {
      ...bySection.get("11.36")!,
      kind: "measurement" as const,
      note: "mutado para teste",
      pin: undefined,
    } as (typeof EXIT_CLAIMS)[number]
    const nonCurrent: Map<string, (typeof EXIT_CLAIMS)[number]> = new Map(bySection)
    nonCurrent.set("11.36", mutatedSuccessor)
    expect(resolveChain(s1130, nonCurrent)).toContain("o sucessor precisa ser current + pin real")
    // E o par REAL confirma a premissa da validade: 11.30 -> 11.36 current pinada.
    expect(resolveChain(s1130, bySection)).toBeNull()
    expect(resolvePin(bySection.get("11.36")!.pin)).toBeTruthy()
  })

  it("stale: entrada do manifest sem claim no doc (secao renumerada/removida) -> flagra (o espelho do unregistered)", () => {
    const dir = createTempDir("sec11-42-")
    // Doc sintetico SEM claims (so headers, sem linhas com exit N): toda
    // entrada do manifest fica stale - a direcao manifest -> doc.
    const docPath = writeSyntheticDoc(dir, [
      { header: "## 11.2 cabeçalho", body: ["linha sem claim"] },
      { header: "## 11.30 cabeçalho", body: ["linha sem claim"] },
    ])
    const { stale } = checkExitClaims(docPath)
    expect(stale.length).toBeGreaterThan(0)
    expect(stale).toContain("11.6")
    expect(stale).toContain("11.36")
  })



  it("pin apontando para arquivo inexistente -> resolvePin null (o pin nunca e prosa)", () => {
    expect(resolvePin({ file: "scripts/__tests__/nao-existe.test.ts", marker: "x" })).toBeNull()
    expect(resolvePin(undefined)).toBeNull()
  })

  it("detector: re-frasear com palavra entre exit e o numero NAO escapa (exit code 0 / exit status 1 / exit-code 3)", () => {
    const dir = createTempDir("sec11-42-")
    const docPath = writeSyntheticDoc(dir, [
      {
        header: "## 11.98 Re-frase",
        body: ["o CLI sai exit code 0 aqui", "e exit status 1 ali", "com exit-code 3 la"],
      },
    ])
    const detected = scanDocExitClaims(docPath)
    expect(detected.has("11.98")).toBe(true)
    expect(detected.get("11.98")).toHaveLength(3)
  })

  it("ABS PIN MUTATION (sec 11.50): um manifest PATCHADO com a claim 11.50 diverge do ABS_PIN_SNAPSHOT (o pin le o EXIT_CLAIMS vivo - nao e copia estatica que passa por acaso)", () => {
    const dir = createTempDir("sec11-50-")
    // O scaffold compartilhado writeModuleCopy (o MESMO do patchModuleCopy /
    // runReverseMutation): le o modulo real, patcha na ancora estrutural do
    // fim do EXIT_CLAIMS e escreve uma copia temp. A ancora "  },\n]\n" e o
    // fechamento do array inteiro (o "}," da ultima entrada real + o "]") -
    // unica no modulo (nenhum outro bloco termina com entrada + "]"). O
    // replacement RE-EMITE o "  },\n" da ancora (fechando a 11.49) ANTES do
    // entry novo - a 1a tentativa consumia o fechamento da ultima entrada
    // sem re-emiti-lo e o patch quebrava o parse (probe 2026-08-11, o
    // blocker do reviewer): a 11.49 ficava com o "{" aberto.
    const ENTRY_1150 =
      '  {\n    section: "11.50",\n    claim: "claim fake da mutacao ABS PIN",\n    kind: "current",\n    pin: { file: "scripts/__tests__/scan-exit-claims.test.ts", marker: "sec 11.50" },\n    ref: "mutacao",\n  },\n'
    const ops: ModulePatchOp[] = [
      {
        anchor: "  },\n]\n",
        replace: () => "  },\n" + ENTRY_1150 + "]\n",
        onMissing: "ABS PIN MUTATION: fechamento do EXIT_CLAIMS (entrada + colchete) nao encontrado no modulo real — atualize o harness",
      },
    ]
    const modPath = writeModuleCopy(dir, path.join(ROOT, "scripts", "scan-exit-claims.mjs"), ops)
    // O probe importa a copia patchada num processo node REAL (o vitest nao
    // resolve imports fora da raiz - os.tmpdir) e imprime as triplas - o
    // mesmo padrao do runReverseMutation (runner + runSubprocess).
    const runnerPath = path.join(dir, "run-probe.mjs")
    fs.writeFileSync(
      runnerPath,
      [
        `import { EXIT_CLAIMS } from "./scan-exit-claims.mjs"`,
        `process.stdout.write(JSON.stringify(EXIT_CLAIMS.map((e) => [e.section, e.kind, e.claim])))`,
        "",
      ].join("\n"),
    )
    const r = runSubprocess({ command: process.execPath, args: [runnerPath] })
    expect(r.status).toBe(0)
    const triples = JSON.parse(r.stdout) as Array<[string, string, string]>
    expect(triples).toHaveLength(ABS_PIN_SNAPSHOT.length + 1)
    // As 27 reais continuam identicas ao snapshot (o patch so ACRESCENTA).
    expect(triples.slice(0, ABS_PIN_SNAPSHOT.length)).toEqual(ABS_PIN_SNAPSHOT)
    // A claim nova diverge do pin - o growth contract aplicado ao conteudo.
    expect(triples).not.toEqual(ABS_PIN_SNAPSHOT)
    expect(modPath).toContain("scan-exit-claims.mjs")
  }, 60000)
})

describe("scripts/scan-exit-claims.mjs - REAL-REPO CONTRACT do CLI (sec 11.42)", () => {
  // HERMETICO contra o shell do dev: se EXIT_CLAIMS_DOC estiver setado no
  // ambiente, este teste (exit-0 no repo REAL) falharia confusamente. O env
  // do subprocesso exclui a chave explicitamente - o override so vale onde
  // o teste do exit-1 o passa de proposito. O tipo e Record<string, string>
  // (a assinatura do runSubprocess) - os valores undefined do process.env
  // sao filtrados para o tipo bater.
  function cliEnv(): Record<string, string> {
    const env: Record<string, string> = {}
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined && k !== "EXIT_CLAIMS_DOC") env[k] = v
    }
    return env
  }

  it("node scripts/scan-exit-claims.mjs no repo real -> exit 0 com a contagem das 3 kinds", () => {
    const res = runSubprocess({
      command: process.execPath,
      args: [path.join(ROOT, "scripts", "scan-exit-claims.mjs"), "--check"],
      env: cliEnv(),
    })
    expect(res.status).toBe(0)
    const stdout = res.stdout ?? ""
    expect(stdout).toContain("exit-claims: clean")
    expect(stdout).toContain("current")
    expect(stdout).toContain("superseded")
    expect(stdout).toContain("measurement")
  }, 60000)

  it("CLI exit 1 REAL: EXIT_CLAIMS_DOC aponta o doc sintetico -> exit 1 com a claim listada no stderr (pina os DOIS lados da claim da 11.42)", () => {
    const dir = createTempDir("sec11-42-")
    const docPath = writeSyntheticDoc(dir, [
      { header: "## 11.99 Uma claim nova", body: CLAIM_LINES },
    ])
    // O CLI real contra o repo NAO sai 1 (o repo esta limpo); com o
    // override EXIT_CLAIMS_DOC (o padrao dos guards: NODE_MODULES_ROOT,
    // GUARD_GATES_SCAN_ROOT...), o CLI REAL lê o doc sintetico e a claim
    // 11.99 nao-registrada -> exit 1 + stderr com a secao listada. A claim
    // da propria sec 11.42 (exit code 1 com violacoes listadas) fica
    // pinada pelo CLI real, nao so pela condicao do checker.
    const res = runSubprocess({
      command: process.execPath,
      args: [path.join(ROOT, "scripts", "scan-exit-claims.mjs"), "--check"],
      env: { ...cliEnv(), EXIT_CLAIMS_DOC: docPath },
    })
    expect(res.status).toBe(1)
    const stderr = res.stderr ?? ""
    expect(stderr).toContain("claim na secao 11.99")
    expect(stderr).toContain("EXIT_CLAIMS")
    expect(stderr).toContain("CURE: registre a claim no EXIT_CLAIMS") // sec 11.54: o comando de cura compartilhado
    // O doc sintetico tem SO a 11.99 -> as 27 entradas do manifest viram
    // stale (secao renumerada/removida) e o bloco stale imprime o pointer
    // de desambiguacao (sec 11.55): a CURE de registrar NAO se aplica a
    // classe stale (a direcao e oposta - a entrada ja existe).
    expect(stderr).toContain("stale nao tem CURE de registrar")
  }, 60000)
})
