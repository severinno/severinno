/**
 * scan-exit-claims.test.ts - o CONTRATO da classe 'claim de doc sem pin
 * no codigo' (2026-08-11, sec 11.42 do gates-proofs.md).
 *
 * WHY THIS SUITE EXISTS: o SUPERSEDED da sec 11.30 virou padrao - uma
 * decisao documentada como exit code 0 que uma mudanca posterior (sec
 * 11.36) inverteu silenciosamente na doc. Um leitor da sec 11.30 confiava
 * numa premissa morta. Este suite torna a classe um CONTRATO:
 *
 *   - ABS PIN (growth): o manifest EXIT_CLAIMS tem EXATAMENTE as 21
 *     secoes medidas. Uma claim nova sem registro (ou uma secao
 *     renumerada) falha alto - registrar e a decisao consciente.
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
import { cleanupTempDirs, createTempDir, runSubprocess } from "./golden-copy-utils"
import { EXIT_CLAIMS, checkExitClaims, resolveChain, resolvePin, scanDocExitClaims } from "../scan-exit-claims.mjs"

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

afterEach(() => {
  cleanupTempDirs()
})

describe("scripts/scan-exit-claims.mjs - EXIT CLAIMS MANIFEST (sec 11.42)", () => {
  it("ABS PIN: as 24 secoes medidas (21 + a SELF-GUARD 11.42 + a flag 11.43 + o revert 11.44) - uma claim nova deve ser registrada conscientemente", () => {
    expect(EXIT_CLAIMS.map((e) => e.section)).toEqual([
      "11.2",
      "11.6",
      "11.7",
      "11.8",
      "11.10",
      "11.11",
      "11.12",
      "11.17",
      "11.18",
      "11.19",
      "11.20",
      "11.21",
      "11.27",
      "11.28",
      "11.30",
      "11.31",
      "11.33",
      "11.36",
      "11.38",
      "11.39",
      "11.41",
      "11.42",
      "11.43",
      "11.44",
    ])
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
  }, 60000)
})
