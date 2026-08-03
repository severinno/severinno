/**
 * check-sentinel-producer.test.ts
 *
 * Testes UNITÁRIOS do guard GENERALIZADO da consistência produtor↔job de
 * sentinels (scripts/check-sentinel-producer.mjs).
 *
 * Contexto: o teste específico benchmark-weekly-all-text-crlf-workflow.test.ts
 * travava a consistência do sentinel 'com CRLF' (produtor audit_blob_crlf_history.py
 * → grep do benchmark-weekly.yml). Este guard GENERALIZA o contrato: TODO
 * `grep -Fq '<sentinel>' <file>` nos workflows precisa ter o sentinel emitido
 * pelo produtor do <file> (script .sh/.mjs/.ts/.py — com chase de delegação
 * .sh→.py) OU inline no próprio workflow — cobrindo FUTUROS sentinels sem
 * teste novo por sentinel.
 *
 * Cobre as funções puras:
 *   extractSentinelGreps          — parse de grep -Fq/-qF/-F (aspas, $, comentários)
 *   normalizeTargetToken          — token limpo ("$REPORT_FILE" → REPORT_FILE)
 *   lineProducesTarget            — `> FILE`, `>> FILE`, `2> FILE`, `| tee FILE`
 *   extractScriptRefsFromRun      — scripts/X + bun run <entry> (dedupe)
 *   resolvePkgEntryRefs           — entry package.json → refs scripts/X
 *   extractDelegatedScripts       — chase .sh → .py/.mjs/.ts/.sh (BFS)
 *   sentinelInProducer            — substring literal (grep -Fq é literal)
 *   resolveProducerChain          — cadeia de delegação com root/exists/read injetáveis
 *   findSentinelViolations        — veredicto agregado (script produtor / inline / ausente)
 *
 * Usage:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/check-sentinel-producer.test.ts
 */

import { describe, it, expect } from "vitest"
import { mkdtempSync, writeFileSync, rmSync, readFileSync, mkdirSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import {
  extractSentinelGreps,
  normalizeTargetToken,
  lineProducesTarget,
  extractScriptRefsFromRun,
  resolvePkgEntryRefs,
  extractDelegatedScripts,
  sentinelInProducer,
  resolveProducerChain,
  findSentinelViolations,
} from "../../../scripts/check-sentinel-producer.mjs"

// ── extractSentinelGreps ─────────────────────────────────────────────────

describe("extractSentinelGreps", () => {
  it("extrai grep -Fq 'sentinel' <file> com linha correta", () => {
    const content = [
      "name: x",
      "  - run: |",
      "      if grep -Fq 'com CRLF' all-text-report.txt; then",
    ].join("\n")
    const greps = extractSentinelGreps(content)
    expect(greps).toEqual([{ line: 3, sentinel: "com CRLF", target: "all-text-report.txt" }])
  })

  it("cobre variantes -qF e -F (ordem dos flags não importa)", () => {
    const content = [
      "grep -qF 'a b' out1.txt",
      "grep -F 'x y' out2.txt",
      "grep -nF 'z w' out3.txt",
    ].join("\n")
    const greps = extractSentinelGreps(content)
    expect(greps.map((g) => g.sentinel)).toEqual(["a b", "x y", "z w"])
    expect(greps.map((g) => g.target)).toEqual(["out1.txt", "out2.txt", "out3.txt"])
  })

  it("normaliza tokens com aspas e $ (variável de arquivo)", () => {
    const content = `grep -Fq 'achado' "$REPORT_FILE"`
    const greps = extractSentinelGreps(content)
    expect(greps[0].target).toBe("REPORT_FILE")
  })

  it("ignora linhas de comentário (#) — grep comentado não é contrato vivo", () => {
    const content = [
      "# grep -Fq 'com CRLF' all-text-report.txt",
      "grep -Fq 'vivo' report.txt",
    ].join("\n")
    const greps = extractSentinelGreps(content)
    expect(greps).toHaveLength(1)
    expect(greps[0].sentinel).toBe("vivo")
  })

  it("não acende para grep sem -F (regex grep -E não é sentinel literal)", () => {
    const content = "grep -E 'com .*' report.txt"
    expect(extractSentinelGreps(content)).toEqual([])
  })
})

// ── normalizeTargetToken ─────────────────────────────────────────────────

describe("normalizeTargetToken", () => {
  it("remove aspas simples, duplas e $ prefix", () => {
    expect(normalizeTargetToken('"$REPORT_FILE"')).toBe("REPORT_FILE")
    expect(normalizeTargetToken("'report.txt'")).toBe("report.txt")
    expect(normalizeTargetToken("$OUT")).toBe("OUT")
    expect(normalizeTargetToken("plain.txt")).toBe("plain.txt")
  })
})

// ── lineProducesTarget ───────────────────────────────────────────────────

describe("lineProducesTarget", () => {
  const target = "all-text-report.txt"
  it("detecta > FILE, >> FILE, 2> FILE e | tee FILE", () => {
    expect(lineProducesTarget(`bash audit.sh | tee ${target}`, target)).toBe(true)
    expect(lineProducesTarget(`audit.sh > ${target}`, target)).toBe(true)
    expect(lineProducesTarget(`audit.sh >> ${target} 2>&1`, target)).toBe(true)
    expect(lineProducesTarget(`audit.sh 2> ${target}`, target)).toBe(true)
  })
  it("suporta aspas e $ no target", () => {
    expect(lineProducesTarget(`audit.sh | tee "${target}"`, target)).toBe(true)
    expect(lineProducesTarget(`audit.sh > "$OUT"`, "OUT")).toBe(true)
  })
  it("não acende para linha sem produção do target", () => {
    expect(lineProducesTarget(`echo "com CRLF" `, target)).toBe(false)
    expect(lineProducesTarget(`grep -Fq 'com CRLF' ${target}`, target)).toBe(false)
  })
})

// ── extractScriptRefsFromRun ─────────────────────────────────────────────

describe("extractScriptRefsFromRun", () => {
  it("extrai scripts/X de bash/node/bun/python e deduplica", () => {
    const run = [
      "bash scripts/audit-blob-crlf-history.sh --all-text | tee all-text-report.txt",
      "node scripts/check-bun-mirror.mjs",
      "bun scripts/x.ts",
    ].join("\n")
    const refs = extractScriptRefsFromRun(run)
    expect(refs).toEqual([
      { kind: "script", ref: "scripts/audit-blob-crlf-history.sh" },
      { kind: "script", ref: "scripts/check-bun-mirror.mjs" },
      { kind: "script", ref: "scripts/x.ts" },
    ])
  })

  it("extrai bun run <entry> como ref pkg e deduplica repetidas", () => {
    const run =
      "bun run audit:blob-crlf-history:all-text | tee report.txt\nbun run audit:blob-crlf-history:all-text"
    const refs = extractScriptRefsFromRun(run)
    expect(refs).toEqual([{ kind: "pkg", ref: "audit:blob-crlf-history:all-text" }])
  })

  it("normaliza prefixo ./", () => {
    expect(extractScriptRefsFromRun("./scripts/a.sh")).toEqual([
      { kind: "script", ref: "scripts/a.sh" },
    ])
  })
})

// ── resolvePkgEntryRefs ──────────────────────────────────────────────────

describe("resolvePkgEntryRefs", () => {
  it("resolve entry que invoca bash scripts/X", () => {
    const pkg = { scripts: { "audit:x": "bash scripts/audit-blob-crlf-history.sh --all-text" } }
    expect(resolvePkgEntryRefs(pkg, "audit:x")).toEqual(["scripts/audit-blob-crlf-history.sh"])
  })
  it("retorna [] para entry inexistente ou sem script do repo", () => {
    expect(resolvePkgEntryRefs({ scripts: {} }, "nope")).toEqual([])
    expect(resolvePkgEntryRefs({ scripts: { x: "echo hi" } }, "x")).toEqual([])
  })
})

// ── extractDelegatedScripts ──────────────────────────────────────────────

describe("extractDelegatedScripts", () => {
  it("extrai nomes de arquivo .py/.mjs/.ts/.sh referenciados no wrapper", () => {
    const sh = [
      'PY_SCRIPT="$SCRIPT_DIR/audit_blob_crlf_history.py"',
      'OTHER="$(dirname "$0")/helper.mjs"',
    ].join("\n")
    expect(extractDelegatedScripts(sh)).toEqual(["audit_blob_crlf_history.py", "helper.mjs"])
  })
  it("deduplica e ignora referências a outros tipos de arquivo", () => {
    const sh = 'PY="$SCRIPT_DIR/a.py"\nPY2="$SCRIPT_DIR/a.py"\nLOG="$SCRIPT_DIR/log.txt"'
    expect(extractDelegatedScripts(sh)).toEqual(["a.py"])
  })
})

// ── sentinelInProducer ───────────────────────────────────────────────────

describe("sentinelInProducer", () => {
  it("substring literal — o sentinel pode estar EMBUTIDO em frase maior", () => {
    expect(sentinelInProducer(["OK — 0 bloco(s) com CRLF no histórico."], "com CRLF")).toBe(true)
  })
  it("não acende para substring parcial/ausente", () => {
    expect(sentinelInProducer(["OK — sem CRLF no histórico."], "com CRLF")).toBe(false)
    expect(sentinelInProducer(["foo"], "com CRLF")).toBe(false)
  })
})

// ── resolveProducerChain ─────────────────────────────────────────────────

describe("resolveProducerChain", () => {
  it("chaceia wrapper .sh → .py delegado (BFS com visited) e retorna os paths existentes", () => {
    const root = "/repo"
    // Keys via join() para casar com o join() da implementação em TODAS as
    // plataformas (Windows usa \ — `/repo/...` literal não casaria).
    const sh = join(root, "scripts", "audit-blob-crlf-history.sh")
    const py = join(root, "scripts", "audit_blob_crlf_history.py")
    const files = new Map([
      [sh, 'PY_SCRIPT="$SCRIPT_DIR/audit_blob_crlf_history.py"'],
      [py, "print('com CRLF')"],
    ])
    const exists = (p: string) => files.has(p)
    const read = (p: string) => files.get(p) as string
    const chain = resolveProducerChain(
      "scripts/audit-blob-crlf-history.sh",
      root,
      exists as unknown as typeof existsSync,
      read as unknown as typeof readFileSync,
    )
    expect(chain).toEqual([sh, py])
  })

  it("retorna [] quando a ref inicial não existe (fail-closed no caller)", () => {
    const exists = () => false
    expect(resolveProducerChain("scripts/nope.sh", "/repo", exists)).toEqual([])
  })

  it("evita ciclos (wrapper que se referencia) com visited", () => {
    const root = "/repo"
    const a = join(root, "scripts", "a.sh")
    const b = join(root, "scripts", "b.sh")
    const files = new Map([
      [a, 'X="$SCRIPT_DIR/b.sh"'],
      [b, 'X="$SCRIPT_DIR/a.sh"'],
    ])
    const exists = (p: string) => files.has(p)
    const read = (p: string) => files.get(p) as string
    const chain = resolveProducerChain(
      "scripts/a.sh",
      root,
      exists as unknown as typeof existsSync,
      read as unknown as typeof readFileSync,
    )
    expect(chain).toHaveLength(2)
    expect(new Set(chain).size).toBe(2)
  })
})

// ── findSentinelViolations (veredicto agregado) ──────────────────────────

describe("findSentinelViolations", () => {
  // helper: cria um repo fixture em disco (precisa de fs para
  // scanWorkflowFiles) — mkdtemp + writeFileSync (mesmo padrão dos testes
  // CLI do repo).
  const repoDirs: string[] = []
  function makeRepo(files: Record<string, string>) {
    const dir = mkdtempSync(join(tmpdir(), "csp-unit-"))
    repoDirs.push(dir)
    for (const [rel, content] of Object.entries(files)) {
      const abs = join(dir, rel)
      mkdirSync(dirname(abs), { recursive: true }) // dirs aninhados (.github/workflows)
      writeFileSync(abs, content, "utf8")
    }
    return dir
  }
  function cleanup() {
    for (const d of repoDirs.splice(0)) rmSync(d, { recursive: true, force: true })
  }

  it("PASS: sentinel emitido pelo produtor .sh→.py (cadeia resolvida)", () => {
    const root = makeRepo({
      ".github/workflows/wf.yml": [
        "jobs:",
        "  x:",
        "    steps:",
        "      - run: |",
        "          bash scripts/audit-blob-crlf-history.sh --all-text | tee all-text-report.txt",
        "          if grep -Fq 'com CRLF' all-text-report.txt; then",
        "            echo found",
        "          fi",
      ].join("\n"),
      "scripts/audit-blob-crlf-history.sh":
        'PY_SCRIPT="$SCRIPT_DIR/audit_blob_crlf_history.py"\nexec "$PY" "$PY_SCRIPT"',
      "scripts/audit_blob_crlf_history.py": 'print("bloco(s) com CRLF no histórico")',
    })
    try {
      const violations = findSentinelViolations(root)
      expect(violations).toEqual([])
    } finally {
      cleanup()
    }
  })

  it("FAIL: sentinel ausente do produtor (frase reformulada) — guard cego detectado", () => {
    const root = makeRepo({
      ".github/workflows/wf.yml": [
        "jobs:",
        "  x:",
        "    steps:",
        "      - run: |",
        "          bash scripts/audit-blob-crlf-history.sh --all-text | tee all-text-report.txt",
        "          if grep -Fq 'com CRLF' all-text-report.txt; then",
        "            echo found",
        "          fi",
      ].join("\n"),
      "scripts/audit-blob-crlf-history.sh":
        'PY_SCRIPT="$SCRIPT_DIR/audit_blob_crlf_history.py"\nexec "$PY" "$PY_SCRIPT"',
      "scripts/audit_blob_crlf_history.py": 'print("blocos afetados no histórico")', // sentinel SUMIU
    })
    try {
      const violations = findSentinelViolations(root)
      expect(violations).toHaveLength(1)
      expect(violations[0].sentinel).toBe("com CRLF")
      expect(violations[0].reason).toBe("sentinel ausente do produtor")
    } finally {
      cleanup()
    }
  })

  it("PASS: produtor inline no próprio workflow (echo 'S' > file + grep)", () => {
    const root = makeRepo({
      ".github/workflows/wf.yml": [
        "jobs:",
        "  x:",
        "    steps:",
        "      - run: |",
        "          echo 'achado fantasma' > report.txt",
        "          if grep -Fq 'achado fantasma' report.txt; then",
        "            echo found",
        "          fi",
      ].join("\n"),
    })
    try {
      const violations = findSentinelViolations(root)
      expect(violations).toEqual([])
    } finally {
      cleanup()
    }
  })

  it("PASS (3a): script produtor SEM o sentinel + echo inline na MESMA produção satisfaz", () => {
    const root = makeRepo({
      ".github/workflows/wf.yml": [
        "jobs:",
        "  x:",
        "    steps:",
        "      - run: |",
        "          bash scripts/ok.sh > report.txt",
        "          echo 'achado fantasma' >> report.txt",
        "          if grep -Fq 'achado fantasma' report.txt; then",
        "            echo found",
        "          fi",
      ].join("\n"),
      "scripts/ok.sh": 'echo "outro texto"', // script NÃO emite o sentinel
    })
    try {
      const violations = findSentinelViolations(root)
      expect(violations).toEqual([])
    } finally {
      cleanup()
    }
  })

  it("FAIL (3a): linha com script que PASSA o sentinel como ARGUMENTO não é produtor inline", () => {
    const root = makeRepo({
      ".github/workflows/wf.yml": [
        "jobs:",
        "  x:",
        "    steps:",
        "      - run: |",
        "          bash scripts/ok.sh 'achado fantasma' > report.txt",
        "          if grep -Fq 'achado fantasma' report.txt; then",
        "            echo found",
        "          fi",
      ].join("\n"),
      "scripts/ok.sh": 'echo "$1"', // o arg é ecoado, mas o guard não pode provar — fail-closed
    })
    try {
      const violations = findSentinelViolations(root)
      expect(violations).toHaveLength(1)
      expect(violations[0].sentinel).toBe("achado fantasma")
      expect(violations[0].reason).toBe("sentinel ausente do produtor")
    } finally {
      cleanup()
    }
  })

  it("FAIL: sem produtor de script NEM inline — grep não tem como acender", () => {
    const root = makeRepo({
      ".github/workflows/wf.yml": [
        "jobs:",
        "  x:",
        "    steps:",
        "      - run: |",
        "          cat algo.txt > report.txt",
        "          if grep -Fq 'com CRLF' report.txt; then",
        "            echo found",
        "          fi",
      ].join("\n"),
    })
    try {
      const violations = findSentinelViolations(root)
      expect(violations).toHaveLength(1)
      expect(violations[0].reason).toBe("produtor não resolvível (script) nem inline")
    } finally {
      cleanup()
    }
  })

  it("FAIL: bun run <entry> que resolve para script cujo sentinel não existe", () => {
    const root = makeRepo({
      "package.json": JSON.stringify({ scripts: { "audit:x": "bash scripts/audit.sh" } }),
      ".github/workflows/wf.yml": [
        "jobs:",
        "  x:",
        "    steps:",
        "      - run: |",
        "          bun run audit:x | tee report.txt",
        "          if grep -Fq 'nunca emitido' report.txt; then",
        "            echo found",
        "          fi",
      ].join("\n"),
      "scripts/audit.sh": 'echo "outro texto"',
    })
    try {
      const pkgJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
      const violations = findSentinelViolations(root, { pkgJson })
      expect(violations).toHaveLength(1)
      expect(violations[0].sentinel).toBe("nunca emitido")
      expect(violations[0].reason).toBe("sentinel ausente do produtor")
    } finally {
      cleanup()
    }
  })
})
