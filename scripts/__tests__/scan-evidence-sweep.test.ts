/**
 * scan-evidence-sweep.test.ts - a suite do 12o guard do batch (sec 11.120):
 * o check dos DOIS sweeps de evidencia datada (sec 11.117 nos guards + sec
 * 11.118 nos helpers) executado no pre-commit.
 *
 * O CONTRATO (o que esta suite pina):
 *   - REAL-REPO CONTRACT: o check do guard no repo real -> 0 violacoes (a
 *     superficie viva dos dois sweeps, o mesmo dado que as suites das secs
 *     11.117/11.118 pinam pelos describes delas).
 *   - MUTATION (11.117): um modulo fake em evidencia sintetica -> a
 *     violacao com o caminho exato (a derivada do guard, a fonte unica).
 *   - MUTATION (11.118): um helper fake em evidencia sintetica -> a
 *     violacao (o sweep irmao do PROOF_HELPERS).
 *   - CLI REAL: exit 0 com 'clean' (o guard no batch).
 *   - CLI exit 1: EVIDENCE_SWEEP_DOC aponta um doc sintetico com modulo
 *     fake -> exit 1 com o caminho no stderr (o fail-loud exercitado pelo
 *     CLI real).
 *   - CLI usage: flag desconhecida -> exit 2.
 *   - FRONTEIRAS (sec 11.121): a assimetria pinada como DECISAO - a orfa
 *     da 11.118 usa o home ADOTADO (citacao em QUALQUER secao 11.x), a
 *     11.117 so evidencia (4 camadas: o contraste das derivadas, a heranca
 *     da direcao helper, o contraste comportamental das orfas, a
 *     distribuicao viva do doc real que justifica a decisao).
 *
 * A fronteira e as derivadas vivem NO GUARD (../scan-evidence-sweep.mjs) -
 * esta suite importa DAQUI (a regra dos 2 usos, o padrao das suites das
 * secs 11.117/11.118 que importam a mesma fonte unica).
 */
import { afterEach, describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { cleanupTempDirs, createTempDir, runSubprocess } from "./golden-copy-utils"
import { EVIDENCE_EXCLUSIONS, HELPER_EVIDENCE_EXCLUSIONS, checkEvidenceSweep, derive11xCited, deriveEvidenceCited, deriveHelperEvidenceCited, evidenceCitedViolations, helperEvidenceViolations } from "../scan-evidence-sweep.mjs"

const ROOT = process.cwd()
const DOC = path.join(ROOT, "docs", "gates-proofs.md")

/** Um doc sintetico com uma secao 11.x de evidencia datada (o mesmo shape
 * que a 11.117 usa nos MUTATIONs). */
function writeSyntheticDoc(dir: string, extra: string) {
  const docPath = path.join(dir, "gates-proofs.md")
  const base = "## 12. Referencias\n"
  fs.writeFileSync(docPath, base + extra)
  return docPath
}

/** Roda o CLI do guard (o entry-point real) com env override. */
function runGuard(env: Record<string, string> = {}) {
  return runSubprocess({
    command: process.execPath,
    args: [path.join(ROOT, "scripts", "scan-evidence-sweep.mjs"), "--check"],
    env,
  })
}

afterEach(() => cleanupTempDirs())

describe("scan-evidence-sweep.mjs - o check dos DOIS sweeps de evidencia datada (sec 11.120)", () => {
  it("REAL-REPO CONTRACT: o check do guard no repo real -> 0 violacoes (a superficie viva dos dois sweeps - secs 11.117/11.118)", () => {
    const { violations } = checkEvidenceSweep()
    expect(violations).toEqual([])
  }, 60000)

  it("MUTATION (11.117): um modulo fake citado em evidencia sintetica -> a violacao com o caminho exato (a derivada do guard)", () => {
    const docText = fs.readFileSync(DOC, "utf8")
    const mutated = docText + "\n## 11.999 placeholder (2026-08-13)\n**prova viva (2026-08-13)**: o `scripts/fake-evidence-mod.mjs` rodou e o guard pegou.\n"
    expect(mutated).not.toBe(docText)
    const viol = evidenceCitedViolations({ docText: mutated })
    expect(viol).toHaveLength(1)
    expect(viol[0][0]).toBe("scripts/fake-evidence-mod.mjs")
    expect(viol[0][1]).toEqual(["classe no PROOF_CLASSES nem allowlist nem exclusao documentada"])
  }, 60000)

  it("MUTATION (11.118): o guard-remeasure (uma exclusao REAL) citado em evidencia sintetica -> flagra quando a exclusao sai do mapa (o load-bearing do sweep irmao: o universo deriva do PROOF_HELPERS + exclusoes, um fake fora do universo e filtrado por desenho)", () => {
    const docText = fs.readFileSync(DOC, "utf8")
    const mutated = docText + "\n## 11.999 placeholder (2026-08-13)\n**nota datada (2026-08-13)**: o `scripts/guard-remeasure.mjs` rodou e o guard pegou.\n"
    expect(mutated).not.toBe(docText)
    const { ["scripts/guard-remeasure.mjs"]: _dropped, ...exclusions } = HELPER_EVIDENCE_EXCLUSIONS
    const viol = helperEvidenceViolations({ docText: mutated, exclusions })
    expect(viol).toHaveLength(1)
    expect(viol[0][0]).toBe("scripts/guard-remeasure.mjs")
    expect(viol[0][1]).toEqual(["entrada no PROOF_HELPERS (o manifest derivado) nem exclusao documentada"])
  }, 60000)

  it("CLI REAL: node scripts/scan-evidence-sweep.mjs --check no repo real -> exit 0 com 'clean'", () => {
    const r = runGuard()
    expect(r.status).toBe(0)
    expect(r.stdout ?? "").toContain("evidence-sweep: clean")
  }, 60000)

  it("CLI exit 1: EVIDENCE_SWEEP_DOC aponta um doc sintetico com modulo fake -> exit 1 com o caminho exato no stderr", () => {
    const dir = createTempDir("evidence-sweep-")
    const docPath = writeSyntheticDoc(dir, "\n## 11.999 placeholder (2026-08-13)\n**prova viva (2026-08-13)**: o `scripts/fake-evidence-mod.mjs` rodou e o guard pegou.\n")
    const r = runGuard({ EVIDENCE_SWEEP_DOC: docPath })
    expect(r.status).toBe(1)
    expect(r.stderr ?? "").toContain("scripts/fake-evidence-mod.mjs")
    expect(r.stderr ?? "").toContain("CURE")
  }, 60000)

  it("CLI usage: flag desconhecida -> exit 2", () => {
    const r = runSubprocess({
      command: process.execPath,
      args: [path.join(ROOT, "scripts", "scan-evidence-sweep.mjs"), "--bogus"],
    })
    expect(r.status).toBe(2)
    expect(r.stderr ?? "").toContain("usage")
  }, 60000)
})

describe("FRONTEIRAS (sec 11.121): evidencia vs home ADOTADO - a assimetria da sec 11.118 pinada como decisao explicita", () => {
  it("A derivada da 11.117 ignora citacao em secao 11.x SEM marcador; a da orfa da 11.118 conta - a MESMA citacao, veredito oposto (o contraste da assimetria)", () => {
    const docText = fs.readFileSync(DOC, "utf8")
    const nonEv = docText + "\n## 11.900 secao de decisao\nprosa historica: o `scripts/fake-frontier-120.mjs` rodou num ensaio passado (sem marcador datado).\n"
    expect(nonEv).not.toBe(docText)
    // A fronteira da 11.117 e a EVIDENCIA: a citacao em prosa nao entra no conjunto.
    expect(deriveEvidenceCited(nonEv)).not.toContain("scripts/fake-frontier-120.mjs")
    // A fronteira da orfa da 11.118 e o home ADOTADO (QUALQUER secao 11.x): a mesma citacao entra.
    expect(derive11xCited(nonEv)).toContain("scripts/fake-frontier-120.mjs")
    // O flip: com o marcador a citacao entra nas DUAS - a assimetria so existe na ausencia do marcador.
    const ev = docText + "\n## 11.900 secao de decisao\n**prova viva (2026-08-13)**: o `scripts/fake-frontier-120.mjs` rodou.\n"
    expect(deriveEvidenceCited(ev)).toContain("scripts/fake-frontier-120.mjs")
    expect(derive11xCited(ev)).toContain("scripts/fake-frontier-120.mjs")
  }, 60000)

  it("A direcao citacao->home da 11.118 herda a fronteira da EVIDENCIA (o filtro do deriveEvidenceCited) - um helper citado em prosa nao entra no deriveHelperEvidenceCited", () => {
    const docText = fs.readFileSync(DOC, "utf8")
    const nonEv = docText + "\n## 11.900 secao de decisao\nprosa historica: o `scripts/ci-proof-run.mjs` rodou num ensaio (sem marcador).\n"
    expect(nonEv).not.toBe(docText)
    expect(deriveHelperEvidenceCited(nonEv)).not.toContain("scripts/ci-proof-run.mjs")
    const ev = docText + "\n## 11.900 secao de decisao\n**prova viva (2026-08-13)**: o `scripts/ci-proof-run.mjs` rodou.\n"
    expect(deriveHelperEvidenceCited(ev)).toContain("scripts/ci-proof-run.mjs")
  }, 60000)

  it("A direcao ORFA difere por registro: exclusao de guard citada so fora da evidencia e ORFA (11.117); a de helper NAO e (11.118, o home ADOTADO) - o mesmo shape, veredito oposto, o pin da assimetria", () => {
    const docText = fs.readFileSync(DOC, "utf8")
    const nonEv = docText + "\n## 11.900 secao de decisao\nprosa historica: o `scripts/fake-orphan-120.mjs` citado em secao sem marcador.\n"
    expect(nonEv).not.toBe(docText)
    // 11.117: a fronteira da orfa e a EVIDENCIA -> a exclusao citada so fora dela e lixo acumulado.
    const viol117 = evidenceCitedViolations({ docText: nonEv, exclusions: { ...EVIDENCE_EXCLUSIONS, "scripts/fake-orphan-120.mjs": "nao-guard fake" } })
    expect(viol117).toHaveLength(1)
    expect(viol117[0][0]).toBe("scripts/fake-orphan-120.mjs")
    expect(viol117[0][1]).toEqual(["exclusao orfa (o modulo nao e citado em secao de evidencia)"])
    // 11.118: a fronteira da orfa e o home ADOTADO (qualquer 11.x) -> a exclusao citada numa secao de decisao resolve.
    const viol118 = helperEvidenceViolations({ docText: nonEv, exclusions: { ...HELPER_EVIDENCE_EXCLUSIONS, "scripts/fake-orphan-120.mjs": "helper fake" } })
    expect(viol118).toEqual([])
  }, 60000)

  it("REAL-REPO: a distribuicao viva que justifica a assimetria - as EVIDENCE_EXCLUSIONS vivem em evidencia, as HELPER em secoes de decisao (o home ADOTADO 11.81/11.94)", () => {
    const docText = fs.readFileSync(DOC, "utf8")
    const evCited = deriveEvidenceCited(docText)
    const all11x = derive11xCited(docText)
    for (const k of Object.keys(EVIDENCE_EXCLUSIONS)) {
      expect(evCited).toContain(k)
    }
    for (const k of Object.keys(HELPER_EVIDENCE_EXCLUSIONS)) {
      expect(evCited).not.toContain(k)
      expect(all11x).toContain(k)
    }
  }, 60000)
})
