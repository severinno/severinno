/**
 * validate-all-text-alert.test.ts
 *
 * Trava em TESTE o fluxo DOCUMENTADO do docs/TESTING.md — seção "Auditoria de
 * CRLF no histórico — run manual do alerta (--all-text)" — o MESMO
 * procedimento de fixture que o script scripts/validate-all-text-alert.sh
 * automatiza para CI/devs (job `all-text-alert-validation` do pr-check.yml),
 * mas como teste unitário vitest no padrão do audit-blob-crlf-history.test.ts:
 * spawn do wrapper REAL (scripts/audit-blob-crlf-history.sh) com
 * CHECK_CRLF_ROOT num repo git temporário.
 *
 * O que este teste trava é a SEMÂNTICA DO ALERTA (não a mecânica do audit —
 * a mecânica do cat-file/derivação vive no audit-blob-crlf-history.test.ts):
 *
 *   - Cenário 1 (CONTROLE — histórico limpo): fixture `.md` LF +
 *     `.gitattributes` → o REPORT `--all-text` NÃO pode imprimir o sentinel
 *     'com CRLF' (senão o job CI acenderia em FALSO — falso positivo) e DEVE
 *     imprimir o discriminador ASCII 'sem CRLF' (o MSYS/Git Bash corrompe
 *     não-ASCII do output capturado via pipe — 'ó' → '�'; por isso o assert
 *     usa o ASCII, igual ao script).
 *
 *   - Cenário 2 (ACHADO — blob .md CRLF): blob CRLF commitado ANTES do
 *     `.gitattributes` (com o atributo no working tree antes, o git
 *     normaliza CRLF→LF no check-in e o blob sairia LF — o exato cenário que
 *     o audit existe para pegar) → o REPORT DEVE imprimir o sentinel
 *     'com CRLF' (o grep do job CI acharia → found_crlf=true); sem o
 *     sentinel o job estaria CEGO ('não achou' viraria falso positivo de
 *     'limpo').
 *
 *   - fail-fast do blob: verifica via `git cat-file blob HEAD:fake.md` que o
 *     blob commitado REALMENTE tem bytes CRLF (0x0D) antes de rodar o audit —
 *     garantindo que a mutação aplicou (core.autocrlf=false preserva os
 *     bytes crus no blob). Espelho do `git show ... | od -An -c | grep -Fq
 *     '\r'` do script, mas com byte-check Node (portável, sem pipe do MSYS).
 *
 * Por que existe: o bash script roda no CI mas devs não rodam um bash script
 * a cada PR; este teste roda no pre-push/suite unitária junto com os demais
 * vitests, mantendo o contrato do alerta verde SEM depender do script nem do
 * cron semanal.
 *
 * Usage:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/validate-all-text-alert.test.ts
 */

import { describe, it, expect, afterEach } from "vitest"
import { spawnSync } from "node:child_process"
import { resolve } from "node:path"
import {
  makeRepo,
  commitCrlfFile,
  commitLfFile,
  writeGitattributes,
  blobHasCr,
  cleanupTmpDirs,
} from "@/lib/__tests__"

/**
 * Wrapper auditado — DEFAULT é o real do repo; override por AUDIT_SCRIPT
 * permite o mutation test (test-mutation-producer-sentinel.sh) rodar ESTE
 * teste contra uma CÓPIA MUTADA do produtor (sentinel removido) e provar a
 * regressão com o próprio vitest, sem tocar no arquivo real. O default
 * preserva o comportamento atual (zero mudança p/ CI/hooks).
 */
const AUDIT =
  process.env.AUDIT_SCRIPT ?? resolve(process.cwd(), "scripts/audit-blob-crlf-history.sh")
/** Sentinel do job CI blob-crlf-all-text-alert (grep -Fq 'com CRLF'). */
const SENTINEL = "com CRLF"

/** Roda o wrapper real --all-text contra o fixture via CHECK_CRLF_ROOT. */
function runReport(repoDir: string) {
  return spawnSync("bash", [AUDIT, "--all-text"], {
    cwd: repoDir,
    encoding: "utf8",
    env: { ...process.env, CHECK_CRLF_ROOT: repoDir },
  })
}

afterEach(() => {
  cleanupTmpDirs()
})

// ── Cenário 1 — CONTROLE: histórico limpo (LF) → sentinel NÃO aparece ────

describe("validate-all-text-alert (Cenário 1 — CONTROLE: histórico limpo)", () => {
  it("REPORT --all-text NÃO imprime o sentinel 'com CRLF' nem lista o .md (sem falso positivo)", () => {
    const dir = makeRepo()
    // .gitattributes + fake.md LF commitados juntos (igual ao script — LF
    // não há nada a normalizar; blob fica LF).
    writeGitattributes(dir, "*.md text eol=lf\n")
    commitLfFile(dir, "fake.md", "# Titulo\n\nCorpo LF\n")

    // Fail-fast do CONTROLE: o blob é LF (nada de CR) — a mutação NÃO aplicou.
    expect(blobHasCr(dir, "fake.md")).toBe(false)

    const res = runReport(dir)
    expect(res.status).toBe(0) // REPORT: exit 0 sempre (mesmo com achados)
    // Discriminador ASCII do caminho limpo (portável Linux/Windows/MSYS)
    expect(res.stdout).toContain("sem CRLF")
    // O sentinel NÃO pode aparecer — senão o job CI alertaria em falso
    expect(res.stdout).not.toContain(SENTINEL)
    expect(res.stdout).not.toContain("fake.md")
  })
})

// ── Cenário 2 — ACHADO: blob .md CRLF commitado ANTES do .gitattributes ──

describe("validate-all-text-alert (Cenário 2 — ACHADO: blob .md CRLF)", () => {
  it("REPORT imprime o sentinel 'com CRLF' e lista o blob — o gate do job acharia (found_crlf=true)", () => {
    const dir = makeRepo()
    // Blob CRLF commitado ANTES do .gitattributes (o cenário real do audit:
    // CRLF commitado no passado com autocrlf off, atributo adicionado DEPOIS).
    commitCrlfFile(dir, "fake.md", "# Titulo\r\n\r\nCorpo CRLF\r\n")
    // .gitattributes no working tree = fonte da derivação do --all-text
    writeGitattributes(dir, "*.md text eol=lf\n")

    // Fail-fast: o blob commitado REALMENTE tem bytes CRLF (mutação aplicou)
    expect(blobHasCr(dir, "fake.md")).toBe(true)

    const res = runReport(dir)
    expect(res.status).toBe(0) // REPORT: exit 0 SEMPRE — o gatilho é o grep

    // ── Réplica do gate do job blob-crlf-all-text-alert: ─────────────
    // if grep -Fq 'com CRLF' report; then found_crlf=true
    const foundCrlf = res.stdout.includes(SENTINEL)
    expect(foundCrlf).toBe(true) // senão o job estaria CEGO (guard cega)
    expect(res.stdout).toContain("fake.md")
    expect(res.stdout).toContain("1 bloco(s) com CRLF")
  })
})
