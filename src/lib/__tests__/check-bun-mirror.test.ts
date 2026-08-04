/**
 * check-bun-mirror.test.ts
 *
 * Testes das funções PURAS do scripts/check-bun-mirror.mjs — guard da FONTE
 * ÚNICA da versão do Bun (repository variable vars.BUN_VERSION) + do mirror
 * GHCR (.github/workflows/sync-bun-mirror.yml).
 *
 * O guard garante 9 invariantes:
 *   1. O workflow do mirror existe (sync-bun-mirror.yml).
 *   2. env.BUN_VERSION do mirror referencia ${{ vars.BUN_VERSION }} (não literal).
 *   3. O action.yml NÃO tem default literal para bun-version (metadata não
 *      avalia ${{ }}) — a versão resolve em runtime de input || vars.
 *   4. O action.yml referencia ${{ vars.BUN_VERSION }} (step de resolve).
 *   5. O action.yml (tier 3) referencia o mirror GHCR.
 *   6. O Dockerfile.bun-mirror existe.
 *   7. Toda cache key bun-/prisma- referencia ${{ vars.BUN_VERSION }} (literal = violação).
 *   8. Nenhuma versão literal do Bun em workflows (bun-version: 1.3.14, etc).
 *   9. O .actrc define BUN_VERSION (act local).
 *
 * ATENÇÃO (esbuild): dentro de template literals, `${{` do GitHub Actions
 * precisa de escape (`\${{`) — senão o esbuild lê `${` como início de
 * interpolação e o arquivo nem compila (erro de transform no vitest).
 *
 * Cobre:
 *   - extractEnvVersion / extractActionDefault (parsing de YAML minimalista)
 *   - hasVarsBunVersionRef / hasGhcrMirrorRef
 *   - validateMirror (arquivos ausentes, literais, ref ausente)
 *   - checkCacheKeys (cache keys com literal vs. referência à variável)
 *   - checkNoLiteralBunVersion (caça literais em workflows)
 *   - checkActrc (arquivo local do act)
 */

import { describe, it, expect, afterAll } from "vitest"
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  extractEnvVersion,
  extractActionDefault,
  hasVarsBunVersionRef,
  hasBunVersionInputRef,
  hasGhcrMirrorRef,
  validateMirror,
  checkCacheKeys,
  checkNoLiteralBunVersion,
  checkSetupBunCallSites,
  checkActrc,
  checkCacheKeyLine,
  checkLiteralBunLine,
  checkDockerfileBunLine,
  checkDockerfiles,
  checkNoForeignLockfiles,
  DOCKERFILES,
  FOREIGN_LOCKFILES,
  parseDiffAddedLines,
  parseDiffLines,
  checkStagedSetupBunCallSites,
  checkStagedRemovedBunVersion,
  checkStagedRemovedCacheBlockFields,
  checkStagedRemovedLiterals,
  checkSetupBunCallSite,
  normalizeBunVersionValue,
  checkStagedCacheKeys,
  checkStagedLiterals,
  checkCachePaths,
  checkCachePathBlock,
  checkStagedCachePaths,
  parseCacheBlock,
  extractCacheKeyPrefix,
  isValidGitRef,
  DEFAULT_CACHE_KEY_RULES,
  BUN_VERSION_VAR,
} from "../../../scripts/check-bun-mirror.mjs"

const tmpDirs: string[] = []

function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "bun-mirror-"))
  tmpDirs.push(dir)
  return dir
}

afterAll(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

// ── BUN_VERSION_VAR ────────────────────────────────────────────────────────

describe("BUN_VERSION_VAR", () => {
  it("é a referência da repository variable (fonte única)", () => {
    expect(BUN_VERSION_VAR).toBe("${{ vars.BUN_VERSION }}")
  })
})

// ── extractEnvVersion ─────────────────────────────────────────────────────

describe("extractEnvVersion", () => {
  it("extrai a referência ${{ vars.BUN_VERSION }} do env do workflow", () => {
    const content = `name: Sync Bun Mirror\nenv:\n  BUN_VERSION: \${{ vars.BUN_VERSION }}\njobs:\n  mirror:\n    runs-on: ubuntu-latest\n`
    expect(extractEnvVersion(content)).toBe("${{ vars.BUN_VERSION }}")
  })

  it("suporta aspas simples e sem aspas", () => {
    expect(extractEnvVersion(`env:\n  BUN_VERSION: '\${{ vars.BUN_VERSION }}'`)).toBe(
      "${{ vars.BUN_VERSION }}",
    )
    expect(extractEnvVersion(`env:\n  BUN_VERSION: \${{ vars.BUN_VERSION }}`)).toBe(
      "${{ vars.BUN_VERSION }}",
    )
  })

  it("descarta comentário inline após o valor", () => {
    expect(extractEnvVersion(`env:\n  BUN_VERSION: \${{ vars.BUN_VERSION }} # nota`)).toBe(
      "${{ vars.BUN_VERSION }}",
    )
  })

  it("retorna o valor literal (estado ANTI-consenso — usado pelo validateMirror p/ detectar)", () => {
    expect(extractEnvVersion(`env:\n  BUN_VERSION: "1.3.14"`)).toBe("1.3.14")
  })

  it("retorna null se BUN_VERSION ausente", () => {
    expect(extractEnvVersion(`env:\n  OTHER: "x"`)).toBeNull()
  })
})

// ── extractActionDefault ──────────────────────────────────────────────────

describe("extractActionDefault", () => {
  it("retorna null quando NÃO há default (estado correto — metadata não avalia ${{ }})", () => {
    const content = `inputs:\n  bun-version:\n    required: false\n`
    expect(extractActionDefault(content)).toBeNull()
  })

  it("detecta um default LITERAL (estado ANTI-consenso — validateMirror reporta)", () => {
    const content = `inputs:\n  bun-version:\n    default: "1.3.14"\n`
    expect(extractActionDefault(content)).toBe("1.3.14")
  })

  it("não captura o default de OUTRO input no mesmo arquivo", () => {
    const content = `inputs:\n  other:\n    default: "9.9.9"\n  bun-version:\n    required: false\n`
    expect(extractActionDefault(content)).toBeNull()
  })

  it("retorna null se o input bun-version não existir", () => {
    expect(extractActionDefault(`inputs:\n  x:\n    default: "1"\n`)).toBeNull()
  })
})

// ── hasVarsBunVersionRef ──────────────────────────────────────────────────

describe("hasVarsBunVersionRef", () => {
  it("detecta a referência pura ${{ vars.BUN_VERSION }} no action", () => {
    const content = `VERSION="\${{ vars.BUN_VERSION }}"`
    expect(hasVarsBunVersionRef(content)).toBe(true)
  })

  it("detecta a forma runtime ${{ inputs.bun-version || vars.BUN_VERSION }}", () => {
    const content = `VERSION="\${{ inputs.bun-version || vars.BUN_VERSION }}"`
    expect(hasVarsBunVersionRef(content)).toBe(true)
  })

  it("detecta em env:", () => {
    const content = `env:\n  VARS_BUN_VERSION: \${{ vars.BUN_VERSION }}`
    expect(hasVarsBunVersionRef(content)).toBe(true)
  })

  it("não casa string parecida (ex.: variável diferente)", () => {
    expect(hasVarsBunVersionRef(`\${{ vars.OTHER }}`)).toBe(false)
  })

  it("não casa texto vazio", () => {
    expect(hasVarsBunVersionRef("")).toBe(false)
  })
})

// ── hasBunVersionInputRef ─────────────────────────────────────────────────

describe("hasBunVersionInputRef", () => {
  it("detecta a referência ao input no step de resolve (novo contrato)", () => {
    const content = `VERSION="\${{ inputs.bun-version }}"`
    expect(hasBunVersionInputRef(content)).toBe(true)
  })

  it("a antiga forma runtime (com || vars) TAMBÉM casa — contém inputs.bun-version", () => {
    // A forma `inputs.bun-version || vars.BUN_VERSION` contém a substring
    // `inputs.bun-version`, então o validateMirror passa — o guard NÃO
    // força a migração do operador || (gap documentado; a enforceção real
    // do contrato é o checkSetupBunCallSites + a documentação no action).
    const content = `VERSION="\${{ inputs.bun-version || vars.BUN_VERSION }}"`
    expect(hasBunVersionInputRef(content)).toBe(true)
  })

  it("não casa texto sem referência ao input", () => {
    expect(hasBunVersionInputRef(`VERSION="\${{ vars.BUN_VERSION }}"`)).toBe(false)
    expect(hasBunVersionInputRef("echo hello")).toBe(false)
    expect(hasBunVersionInputRef("")).toBe(false)
  })
})

// ── checkSetupBunCallSites ────────────────────────────────────────────────

describe("checkSetupBunCallSites", () => {
  function makeWorkflowsDir(files: Record<string, string>): string {
    const dir = join(makeDir(), "workflows")
    mkdirSync(dir)
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(dir, name), content)
    }
    return dir
  }

  const okCallSite = `      - uses: ./.github/actions/setup-bun\n        with:\n          bun-version: \${{ vars.BUN_VERSION }}\n`

  it("call site com bun-version: ${{ vars.BUN_VERSION }} → zero violações", () => {
    const dir = makeWorkflowsDir({ "a.yml": okCallSite })
    expect(checkSetupBunCallSites(dir)).toEqual([])
  })

  it("call site SEM input bun-version → violação (fail-closed)", () => {
    const dir = makeWorkflowsDir({ "a.yml": `      - uses: ./.github/actions/setup-bun\n` })
    const v = checkSetupBunCallSites(dir)
    expect(v.length).toBe(1)
    expect(v[0]).toContain("a.yml:1")
    expect(v[0]).toContain("SEM input bun-version")
    expect(v[0]).toContain("vars.BUN_VERSION")
  })

  it("call site com literal (bun-version: 1.3.14) → violação (use a variável)", () => {
    const dir = makeWorkflowsDir({
      "a.yml": `      - uses: ./.github/actions/setup-bun\n        with:\n          bun-version: 1.3.14\n`,
    })
    const v = checkSetupBunCallSites(dir)
    expect(v.length).toBe(1)
    expect(v[0]).toContain("a.yml:1")
    expect(v[0]).toContain("bun-version='1.3.14'")
    expect(v[0]).toContain("vars.BUN_VERSION")
  })

  it("múltiplos call sites: um bom + um sem input → só o mau é reportado", () => {
    // okCallSite ocupa linhas 1-3 (uses, with, bun-version); o `\n` extra
    // cria a linha 4 vazia; o segundo uses fica na linha 5.
    const dir = makeWorkflowsDir({
      "a.yml": okCallSite + `\n      - uses: ./.github/actions/setup-bun\n`,
    })
    const v = checkSetupBunCallSites(dir)
    expect(v.length).toBe(1)
    expect(v[0]).toContain("a.yml:5")
  })

  it("ignora outros usos de action (não setup-bun)", () => {
    const dir = makeWorkflowsDir({
      "a.yml": `      - uses: actions/checkout@v4\n`,
    })
    expect(checkSetupBunCallSites(dir)).toEqual([])
  })

  it("ignora comentários que citam o uses em prosa (falso positivo)", () => {
    const dir = makeWorkflowsDir({
      "a.yml": `# usamos ./.github/actions/setup-bun em todos os jobs\n`,
    })
    expect(checkSetupBunCallSites(dir)).toEqual([])
  })

  it('aceita bun-version com aspas (ex.: "${{ vars.BUN_VERSION }}")', () => {
    const dir = makeWorkflowsDir({
      "a.yml": `      - uses: ./.github/actions/setup-bun\n        with:\n          bun-version: "\${{ vars.BUN_VERSION }}"\n`,
    })
    expect(checkSetupBunCallSites(dir)).toEqual([])
  })

  it("aceita comentário inline no bun-version (# nota)", () => {
    const dir = makeWorkflowsDir({
      "a.yml":
        `      - uses: ./.github/actions/setup-bun\n` +
        `        with:\n` +
        `          bun-version: \${{ vars.BUN_VERSION }} # fonte única\n`,
    })
    expect(checkSetupBunCallSites(dir)).toEqual([])
  })

  it("diretório inexistente → zero violações", () => {
    expect(checkSetupBunCallSites(join(makeDir(), "nope"))).toEqual([])
  })

  it("escaneia arquivos .yaml (extensão alternativa) — call site sem input → violação", () => {
    const dir = makeWorkflowsDir({ "a.yaml": `      - uses: ./.github/actions/setup-bun\n` })
    const v = checkSetupBunCallSites(dir)
    expect(v.length).toBe(1)
    expect(v[0]).toContain("a.yaml:1")
    expect(v[0]).toContain("SEM input bun-version")
  })
})

// ── hasGhcrMirrorRef ──────────────────────────────────────────────────────

describe("hasGhcrMirrorRef", () => {
  it("detecta a construção ghcr.io/${GHCR_OWNER}/bun:${BUN_VERSION} no tier 3", () => {
    const content = `MIRROR="ghcr.io/\${GHCR_OWNER}/bun:\${BUN_VERSION}"\ndocker pull "$MIRROR"\n`
    expect(hasGhcrMirrorRef(content)).toBe(true)
  })

  it("detecta referência hardcoded ghcr.io/<owner>/bun:<ver>", () => {
    expect(hasGhcrMirrorRef(`docker pull ghcr.io/severinno/bun:1.3.14`)).toBe(true)
  })

  it("não casa download direto do GitHub releases", () => {
    const content = `URL="https://github.com/oven-sh/bun/releases/download/bun-v\${BUN_VERSION}/bun-\${OS}-\${ARCH}.zip"\ncurl -fsSL "$URL"\n`
    expect(hasGhcrMirrorRef(content)).toBe(false)
  })

  it("não casa texto vazio", () => {
    expect(hasGhcrMirrorRef("")).toBe(false)
  })
})

// ── validateMirror ────────────────────────────────────────────────────────

describe("validateMirror", () => {
  const wfName = "sync-bun-mirror.yml"
  const actName = "action.yml"
  // Estado CONSENSO: mirror referencia a variável, action SEM default, com
  // resolve de vars + ref ao mirror GHCR no tier 3.
  const wfContent = `env:\n  BUN_VERSION: \${{ vars.BUN_VERSION }}\n`
  const actContent = `inputs:\n  bun-version:\n    required: false\nruns:\n  using: composite\n  steps:\n    - name: Resolve Bun version\n      run: |\n        VERSION="\${{ inputs.bun-version || vars.BUN_VERSION }}"\n    - name: Download Bun release (cold cache)\n      run: |\n        MIRROR="ghcr.io/\${GHCR_OWNER}/bun:\${BUN_VERSION}"\n        docker pull "$MIRROR"\n`

  it("repositório íntegro (mirror vars ref + action sem default + ref) → zero violações", () => {
    const dir = makeDir()
    writeFileSync(join(dir, wfName), wfContent)
    writeFileSync(join(dir, actName), actContent)
    expect(validateMirror(join(dir, wfName), join(dir, actName))).toEqual([])
  })

  it("workflow do mirror ausente → violação (fail-closed)", () => {
    const dir = makeDir()
    writeFileSync(join(dir, actName), actContent)
    const v = validateMirror(join(dir, wfName), join(dir, actName))
    expect(v.length).toBeGreaterThan(0)
    expect(v[0]).toContain("ausente")
  })

  it("action ausente → violação", () => {
    const dir = makeDir()
    writeFileSync(join(dir, wfName), wfContent)
    expect(validateMirror(join(dir, wfName), join(dir, actName)).length).toBeGreaterThan(0)
  })

  it("mirror com versão LITERAL → violação (deve usar ${{ vars.BUN_VERSION }})", () => {
    const dir = makeDir()
    writeFileSync(join(dir, wfName), `env:\n  BUN_VERSION: "1.3.14"\n`)
    writeFileSync(join(dir, actName), actContent)
    const v = validateMirror(join(dir, wfName), join(dir, actName))
    expect(v.some((x) => x.includes("LITERAL"))).toBe(true)
    expect(v.some((x) => x.includes("vars.BUN_VERSION"))).toBe(true)
  })

  it("action com default LITERAL → violação (metadata não avalia ${{ }})", () => {
    const dir = makeDir()
    writeFileSync(join(dir, wfName), wfContent)
    writeFileSync(
      join(dir, actName),
      `inputs:\n  bun-version:\n    default: "1.3.14"\nruns:\n  using: composite\n  steps:\n    - name: Resolve Bun version\n      run: |\n        VERSION="\${{ inputs.bun-version || vars.BUN_VERSION }}"\n`,
    )
    const v = validateMirror(join(dir, wfName), join(dir, actName))
    expect(v.some((x) => x.includes("default"))).toBe(true)
  })

  it("action sem referência a vars.BUN_VERSION → violação", () => {
    const dir = makeDir()
    writeFileSync(join(dir, wfName), wfContent)
    writeFileSync(
      join(dir, actName),
      `inputs:\n  bun-version:\n    required: false\nruns:\n  using: composite\n  steps:\n    - run: echo hello\n`,
    )
    const v = validateMirror(join(dir, wfName), join(dir, actName))
    expect(v.some((x) => x.includes("não referencia"))).toBe(true)
  })

  it("tier 3 sem ref ao mirror GHCR → violação", () => {
    const dir = makeDir()
    writeFileSync(join(dir, wfName), wfContent)
    writeFileSync(
      join(dir, actName),
      `inputs:\n  bun-version:\n    required: false\nruns:\n  using: composite\n  steps:\n    - name: Resolve Bun version\n      run: |\n        VERSION="\${{ inputs.bun-version || vars.BUN_VERSION }}"\n    - run: curl -fsSL https://github.com/oven-sh/bun/releases/download/bun-v\${BUN_VERSION}/bun.zip\n`,
    )
    const v = validateMirror(join(dir, wfName), join(dir, actName))
    expect(v.some((x) => x.includes("não referencia o mirror"))).toBe(true)
  })

  it("Dockerfile.bun-mirror ausente → violação (guard pega no PR)", () => {
    const dir = makeDir()
    writeFileSync(join(dir, wfName), wfContent)
    writeFileSync(join(dir, actName), actContent)
    const v = validateMirror(
      join(dir, wfName),
      join(dir, actName),
      join(dir, "Dockerfile.bun-mirror"),
    )
    expect(v.some((x) => x.includes("Dockerfile do mirror ausente"))).toBe(true)
  })

  it("repositório íntegro com Dockerfile presente → zero violações", () => {
    const dir = makeDir()
    writeFileSync(join(dir, wfName), wfContent)
    writeFileSync(join(dir, actName), actContent)
    writeFileSync(join(dir, "Dockerfile.bun-mirror"), "FROM scratch\nCOPY bun /bun\n")
    expect(
      validateMirror(join(dir, wfName), join(dir, actName), join(dir, "Dockerfile.bun-mirror")),
    ).toEqual([])
  })
})

// ── DEFAULT_CACHE_KEY_RULES ──────────────────────────────────────────────

describe("DEFAULT_CACHE_KEY_RULES", () => {
  it("usa a referência da repository variable (não literal) para bun e prisma, com os paths da toolchain", () => {
    expect(DEFAULT_CACHE_KEY_RULES()).toEqual([
      { prefix: "bun", version: "${{ vars.BUN_VERSION }}", paths: ["node_modules", "~/.bun"] },
      {
        prefix: "prisma",
        version: "${{ vars.BUN_VERSION }}",
        paths: ["node_modules/.prisma", "node_modules/@prisma/client"],
      },
    ])
  })

  it("é uma lista CONFIGURÁVEL — novas toolchains entram como { prefix, version, paths }", () => {
    const rules = [
      { prefix: "bun", version: "${{ vars.BUN_VERSION }}", paths: ["node_modules"] },
      { prefix: "prisma", version: "${{ vars.BUN_VERSION }}", paths: ["node_modules/.prisma"] },
      { prefix: "next", version: "15", paths: [".next"] },
    ]
    expect(rules).toHaveLength(3)
    expect(rules[2]).toEqual({ prefix: "next", version: "15", paths: [".next"] })
  })
})

// ── extractCacheKeyPrefix ────────────────────────────────────────────────

describe("extractCacheKeyPrefix", () => {
  it("extrai o prefixo de uma key com referência à variável", () => {
    expect(extractCacheKeyPrefix("bun-${{ vars.BUN_VERSION }}-...")).toBe("bun")
    expect(extractCacheKeyPrefix("prisma-${{ vars.BUN_VERSION }}-...")).toBe("prisma")
  })

  it("extrai o prefixo mesmo de key literal (o literal é violação de OUTRO check)", () => {
    expect(extractCacheKeyPrefix("bun-1.3.14-${{ hashFiles('bun.lock') }}")).toBe("bun")
    expect(extractCacheKeyPrefix("prisma-1.3.14-foo")).toBe("prisma")
  })

  it("retorna null sem o formato '<prefixo>-'", () => {
    expect(extractCacheKeyPrefix("node_modules")).toBeNull()
    expect(extractCacheKeyPrefix("")).toBeNull()
  })
})

// ── parseCacheBlock ──────────────────────────────────────────────────────

describe("parseCacheBlock", () => {
  it("path simples + key → paths e keyPrefix", () => {
    const { paths, keyPrefix } = parseCacheBlock([
      `        with:`,
      `          path: node_modules`,
      `          key: bun-\${{ vars.BUN_VERSION }}-\${{ hashFiles('bun.lock') }}`,
      `          restore-keys: bun-\${{ vars.BUN_VERSION }}-`,
    ])
    expect(paths).toEqual(["node_modules"])
    expect(keyPrefix).toBe("bun")
  })

  it("path multi-linha (prisma client) → todos os paths e keyPrefix prisma", () => {
    const { paths, keyPrefix } = parseCacheBlock([
      `        with:`,
      `          path: |`,
      `            node_modules/.prisma`,
      `            node_modules/@prisma/client`,
      `          key: prisma-\${{ vars.BUN_VERSION }}-\${{ hashFiles('prisma/schema.prisma') }}`,
      `          restore-keys: prisma-\${{ vars.BUN_VERSION }}-`,
    ])
    expect(paths).toEqual(["node_modules/.prisma", "node_modules/@prisma/client"])
    expect(keyPrefix).toBe("prisma")
  })

  it("ignora comentários e linhas vazias dentro do bloco", () => {
    const { paths, keyPrefix } = parseCacheBlock([
      `        # comentário`,
      ``,
      `          path: node_modules`,
      `          key: bun-\${{ vars.BUN_VERSION }}-ok`,
    ])
    expect(paths).toEqual(["node_modules"])
    expect(keyPrefix).toBe("bun")
  })

  it("sem key → keyPrefix null", () => {
    const { paths, keyPrefix } = parseCacheBlock([`        with:`, `          path: node_modules`])
    expect(paths).toEqual(["node_modules"])
    expect(keyPrefix).toBeNull()
  })

  it("restore-keys simples → restorePrefixes com o prefixo da toolchain", () => {
    const { restorePrefixes } = parseCacheBlock([
      `        with:`,
      `          path: node_modules`,
      `          key: bun-\${{ vars.BUN_VERSION }}-x`,
      `          restore-keys: bun-\${{ vars.BUN_VERSION }}-`,
    ])
    expect(restorePrefixes).toEqual(["bun"])
  })

  it("restore-keys de OUTRA toolchain (prisma sob key bun) → prefixo capturado (o check do par decide)", () => {
    const { keyPrefix, restorePrefixes } = parseCacheBlock([
      `        with:`,
      `          path: node_modules`,
      `          key: bun-\${{ vars.BUN_VERSION }}-x`,
      `          restore-keys: prisma-\${{ vars.BUN_VERSION }}-`,
    ])
    expect(keyPrefix).toBe("bun")
    expect(restorePrefixes).toEqual(["prisma"])
  })

  it("restore-keys multi-linha (|) → todos os prefixos (lista de fallbacks)", () => {
    const { restorePrefixes } = parseCacheBlock([
      `        with:`,
      `          path: node_modules`,
      `          key: bun-\${{ vars.BUN_VERSION }}-x`,
      `          restore-keys: |`,
      `            bun-\${{ vars.BUN_VERSION }}-`,
      `            prisma-\${{ vars.BUN_VERSION }}-`,
    ])
    expect(restorePrefixes).toEqual(["bun", "prisma"])
  })

  it("restore-keys sem prefixo de toolchain reconhecível → ignorado", () => {
    const { restorePrefixes } = parseCacheBlock([
      `        with:`,
      `          path: node_modules`,
      `          key: bun-\${{ vars.BUN_VERSION }}-x`,
      `          restore-keys: \${{ hashFiles('bun.lock') }}-`,
    ])
    expect(restorePrefixes).toEqual([])
  })

  it("sem restore-keys → restorePrefixes vazio", () => {
    const { restorePrefixes } = parseCacheBlock([`        with:`, `          path: node_modules`])
    expect(restorePrefixes).toEqual([])
  })
})

// ── checkCachePathBlock ──────────────────────────────────────────────────

describe("checkCachePathBlock", () => {
  const rules = DEFAULT_CACHE_KEY_RULES()

  it("bloco bun com path node_modules → zero violações (par fecha)", () => {
    const block = [
      `        with:`,
      `          path: node_modules`,
      `          key: bun-\${{ vars.BUN_VERSION }}-\${{ hashFiles('bun.lock') }}`,
    ]
    expect(checkCachePathBlock("a.yml", 1, block, rules)).toEqual([])
  })

  it("bloco prisma com path multi-linha (client) → zero violações", () => {
    const block = [
      `        with:`,
      `          path: |`,
      `            node_modules/.prisma`,
      `            node_modules/@prisma/client`,
      `          key: prisma-\${{ vars.BUN_VERSION }}-\${{ hashFiles('prisma/schema.prisma') }}`,
    ]
    expect(checkCachePathBlock("a.yml", 1, block, rules)).toEqual([])
  })

  it("bloco prisma com path multi-linha INCOMPLETO (só .prisma) → zero violações (pelo menos um casa)", () => {
    const block = [
      `        with:`,
      `          path: |`,
      `            node_modules/.prisma`,
      `          key: prisma-\${{ vars.BUN_VERSION }}-x`,
    ]
    expect(checkCachePathBlock("a.yml", 1, block, rules)).toEqual([])
  })

  it("path de OUTRA toolchain (prisma path com key bun) → violação fechando o par", () => {
    const block = [
      `        with:`,
      `          path: |`,
      `            node_modules/.prisma`,
      `            node_modules/@prisma/client`,
      `          key: bun-\${{ vars.BUN_VERSION }}-\${{ hashFiles('bun.lock') }}`,
    ]
    const v = checkCachePathBlock("a.yml", 1, block, rules)
    expect(v.length).toBe(1)
    expect(v[0]).toContain("a.yml:1")
    expect(v[0]).toContain("node_modules/.prisma")
    expect(v[0]).toContain("'prisma'")
  })

  it("bloco bun com path correto + path de OUTRA toolchain (node_modules + .prisma) → violação mesmo com own match (fecha o par)", () => {
    const block = [
      `        with:`,
      `          path: |`,
      `            node_modules`,
      `            node_modules/.prisma`,
      `          key: bun-\${{ vars.BUN_VERSION }}-x`,
    ]
    const v = checkCachePathBlock("a.yml", 1, block, rules)
    expect(v.length).toBe(1)
    expect(v[0]).toContain("node_modules/.prisma")
    expect(v[0]).toContain("'prisma'")
  })

  it("path desconhecido com key de toolchain configurada → violação (esperado: paths da regra)", () => {
    const block = [
      `        with:`,
      `          path: ~/.cache/something`,
      `          key: bun-\${{ vars.BUN_VERSION }}-x`,
    ]
    const v = checkCachePathBlock("a.yml", 1, block, rules)
    expect(v.length).toBe(1)
    expect(v[0]).toContain("~/.cache/something")
    expect(v[0]).toContain("node_modules, ~/.bun")
  })

  it("bloco SEM path declarado → violação", () => {
    const block = [`        with:`, `          key: bun-\${{ vars.BUN_VERSION }}-x`]
    const v = checkCachePathBlock("a.yml", 1, block, rules)
    expect(v.length).toBe(1)
    expect(v[0]).toContain("SEM path declarado")
  })

  it("key com prefixo NÃO configurado → zero violações (regra não existe)", () => {
    const block = [
      `        with:`,
      `          path: whatever`,
      `          key: other-\${{ github.sha }}`,
    ]
    expect(checkCachePathBlock("a.yml", 1, block, rules)).toEqual([])
  })

  it("regra SEM paths (toolchain custom) → valida só a key, não o path", () => {
    const custom = [{ prefix: "next", version: "15" }]
    const block = [`        with:`, `          path: .next/cache`, `          key: next-15-x`]
    expect(checkCachePathBlock("a.yml", 1, block, custom)).toEqual([])
  })

  it("regras vazias → zero violações (scan desligado)", () => {
    const block = [`        with:`, `          path: node_modules`, `          key: bun-x`]
    expect(checkCachePathBlock("a.yml", 1, block, [])).toEqual([])
  })

  // ── Restore-keys: o par key↔path fecha TAMBÉM na direção do restore ────

  it("restore-keys de OUTRA toolchain (key bun + restore-keys prisma) → violação fechando o par", () => {
    const block = [
      `        with:`,
      `          path: node_modules`,
      `          key: bun-\${{ vars.BUN_VERSION }}-\${{ hashFiles('bun.lock') }}`,
      `          restore-keys: prisma-\${{ vars.BUN_VERSION }}-`,
    ]
    const v = checkCachePathBlock("a.yml", 1, block, rules)
    expect(v.length).toBe(1)
    expect(v[0]).toContain("a.yml:1")
    expect(v[0]).toContain("restore-keys 'prisma-...'")
    expect(v[0]).toContain("feche o par key↔path")
  })

  it("restore-keys da MESMA toolchain da key (bun+bun) → zero violações", () => {
    const block = [
      `        with:`,
      `          path: node_modules`,
      `          key: bun-\${{ vars.BUN_VERSION }}-\${{ hashFiles('bun.lock') }}`,
      `          restore-keys: bun-\${{ vars.BUN_VERSION }}-`,
    ]
    expect(checkCachePathBlock("a.yml", 1, block, rules)).toEqual([])
  })

  it("restore-keys com prefixo NÃO configurado → zero violações (sem contrato)", () => {
    const block = [
      `        with:`,
      `          path: node_modules`,
      `          key: bun-\${{ vars.BUN_VERSION }}-x`,
      `          restore-keys: other-\${{ github.sha }}`,
    ]
    expect(checkCachePathBlock("a.yml", 1, block, rules)).toEqual([])
  })

  it("restore-keys multi-linha: um prefixo de outra toolchain entre os fallbacks → violação", () => {
    const block = [
      `        with:`,
      `          path: node_modules`,
      `          key: bun-\${{ vars.BUN_VERSION }}-x`,
      `          restore-keys: |`,
      `            bun-\${{ vars.BUN_VERSION }}-`,
      `            prisma-\${{ vars.BUN_VERSION }}-`,
    ]
    const v = checkCachePathBlock("a.yml", 1, block, rules)
    expect(v.length).toBe(1)
    expect(v[0]).toContain("restore-keys 'prisma-...'")
  })

  it("restore-keys de outra toolchain + path de outra toolchain → AMBAS as violações (0º e 1º)", () => {
    const block = [
      `        with:`,
      `          path: |`,
      `            node_modules`,
      `            node_modules/.prisma`,
      `          key: bun-\${{ vars.BUN_VERSION }}-x`,
      `          restore-keys: prisma-\${{ vars.BUN_VERSION }}-`,
    ]
    const v = checkCachePathBlock("a.yml", 1, block, rules)
    expect(v.length).toBe(2)
    expect(v.some((x) => x.includes("restore-keys 'prisma-...'"))).toBe(true)
    expect(v.some((x) => x.includes("path(s)"))).toBe(true)
  })

  it("regra custom SEM paths: restore-keys de outra toolchain configurada AINDA é violação (0º vale sem paths)", () => {
    // Regra custom (next) SEM paths + DEFAULT (bun/prisma CONFIGURADAS) — o
    // restore-keys prisma sob key next é violação mesmo sem contrato de path
    // para a regra next (a 0º roda antes do early-return custom).
    const rules = [...DEFAULT_CACHE_KEY_RULES(), { prefix: "next", version: "15" }]
    const block = [
      `        with:`,
      `          path: .next/cache`,
      `          key: next-15-x`,
      `          restore-keys: prisma-\${{ vars.BUN_VERSION }}-`,
    ]
    const v = checkCachePathBlock("a.yml", 1, block, rules)
    expect(v.length).toBe(1)
    expect(v[0]).toContain("restore-keys 'prisma-...'")
  })

  it("regra custom SEM paths: restore-keys da MESMA toolchain → zero violações", () => {
    const custom = [{ prefix: "next", version: "15" }]
    const block = [
      `        with:`,
      `          path: .next/cache`,
      `          key: next-15-x`,
      `          restore-keys: next-15-`,
    ]
    expect(checkCachePathBlock("a.yml", 1, block, custom)).toEqual([])
  })
})

// ── checkCachePaths (scan global de blocos) ─────────────────────────────

describe("checkCachePaths", () => {
  function makeWorkflowsDir(files: Record<string, string>): string {
    const dir = join(makeDir(), "workflows")
    mkdirSync(dir)
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(dir, name), content)
    }
    return dir
  }

  it("todos os blocos com par key↔path fechado → zero violações", () => {
    const dir = makeWorkflowsDir({
      "a.yml": `      - uses: actions/cache@v4\n        with:\n          path: node_modules\n          key: bun-\${{ vars.BUN_VERSION }}-\${{ hashFiles('bun.lock') }}\n          restore-keys: bun-\${{ vars.BUN_VERSION }}-\n`,
      "b.yml": `      - uses: actions/cache@v4\n        with:\n          path: |\n            node_modules/.prisma\n            node_modules/@prisma/client\n          key: prisma-\${{ vars.BUN_VERSION }}-\${{ hashFiles('prisma/schema.prisma') }}\n          restore-keys: prisma-\${{ vars.BUN_VERSION }}-\n`,
    })
    expect(checkCachePaths(dir, DEFAULT_CACHE_KEY_RULES())).toEqual([])
  })

  it("bloco com path de outra toolchain → violação com arquivo:linha", () => {
    const dir = makeWorkflowsDir({
      "a.yml": `      - uses: actions/cache@v4\n        with:\n          path: |\n            node_modules/.prisma\n            node_modules/@prisma/client\n          key: bun-\${{ vars.BUN_VERSION }}-\${{ hashFiles('bun.lock') }}\n          restore-keys: bun-\${{ vars.BUN_VERSION }}-\n`,
    })
    const v = checkCachePaths(dir, DEFAULT_CACHE_KEY_RULES())
    expect(v.length).toBe(1)
    expect(v[0]).toContain("a.yml:1")
  })

  it("ignora uses de OUTRAS actions (não actions/cache)", () => {
    const dir = makeWorkflowsDir({
      "a.yml": `      - uses: actions/checkout@v4\n      - uses: ./.github/actions/setup-bun\n        with:\n          bun-version: \${{ vars.BUN_VERSION }}\n`,
    })
    expect(checkCachePaths(dir, DEFAULT_CACHE_KEY_RULES())).toEqual([])
  })

  it("ignora comentários que citam actions/cache em prosa", () => {
    const dir = makeWorkflowsDir({
      "a.yml": `# usamos actions/cache em todos os jobs\n`,
    })
    expect(checkCachePaths(dir, DEFAULT_CACHE_KEY_RULES())).toEqual([])
  })

  it("diretório inexistente → zero violações", () => {
    expect(checkCachePaths(join(makeDir(), "nope"), DEFAULT_CACHE_KEY_RULES())).toEqual([])
  })

  it("escaneia arquivos .yaml — bloco com path de outra toolchain → violação com arquivo:linha", () => {
    const dir = makeWorkflowsDir({
      "a.yaml": `      - uses: actions/cache@v4\n        with:\n          path: |\n            node_modules/.prisma\n            node_modules/@prisma/client\n          key: bun-\${{ vars.BUN_VERSION }}-\${{ hashFiles('bun.lock') }}\n          restore-keys: bun-\${{ vars.BUN_VERSION }}-\n`,
    })
    const v = checkCachePaths(dir, DEFAULT_CACHE_KEY_RULES())
    expect(v.length).toBe(1)
    expect(v[0]).toContain("a.yaml:1")
  })
})

// ── checkStagedCachePaths (blocos introduzidos pelo diff) ───────────────

describe("checkStagedCachePaths", () => {
  it("bloco NOVO com par key↔path quebrado → violação", () => {
    const diff =
      `+++ b/.github/workflows/a.yml\n` +
      `@@ -1,4 +1,4 @@\n` +
      `+      - uses: actions/cache@v4\n` +
      `+        with:\n` +
      `+          path: node_modules/.prisma\n` +
      `+          key: bun-\${{ vars.BUN_VERSION }}-\${{ hashFiles('bun.lock') }}\n`
    const v = checkStagedCachePaths(diff, DEFAULT_CACHE_KEY_RULES())
    expect(v.length).toBe(1)
    expect(v[0]).toContain("a.yml:1")
  })

  it("bloco NOVO com par key↔path fechado → zero violações", () => {
    const diff =
      `+++ b/.github/workflows/a.yml\n` +
      `@@ -1,4 +1,4 @@\n` +
      `+      - uses: actions/cache@v4\n` +
      `+        with:\n` +
      `+          path: node_modules\n` +
      `+          key: bun-\${{ vars.BUN_VERSION }}-\${{ hashFiles('bun.lock') }}\n`
    expect(checkStagedCachePaths(diff, DEFAULT_CACHE_KEY_RULES())).toEqual([])
  })

  it("bloco PRÉ-EXISTENTE (uses é contexto, não adicionado) não polui o diff", () => {
    const diff =
      `+++ b/.github/workflows/a.yml\n` +
      `@@ -1,2 +1,2 @@\n` +
      `       - uses: actions/cache@v4\n` +
      `+          other: true\n`
    expect(checkStagedCachePaths(diff, DEFAULT_CACHE_KEY_RULES())).toEqual([])
  })

  it("migração de bloco: uses ADICIONADO + path/key em CONTEXTO → valida com o parser rico", () => {
    const diff =
      `+++ b/.github/workflows/a.yml\n` +
      `@@ -1,3 +1,3 @@\n` +
      `-      - uses: oven-sh/setup-bun@v2\n` +
      `+      - uses: actions/cache@v4\n` +
      `        with:\n` +
      `          path: node_modules\n` +
      `          key: bun-\${{ vars.BUN_VERSION }}-\${{ hashFiles('bun.lock') }}\n`
    expect(checkStagedCachePaths(diff, DEFAULT_CACHE_KEY_RULES())).toEqual([])
  })

  it("arquivo não-.yml → zero violações", () => {
    const diff =
      `+++ b/src/lib/foo.ts\n` + `@@ -1,3 +1,3 @@\n` + `+      - uses: actions/cache@v4\n`
    expect(checkStagedCachePaths(diff, DEFAULT_CACHE_KEY_RULES())).toEqual([])
  })

  it("bloco NOVO com par key↔path quebrado em arquivo .yaml → violação", () => {
    const diff =
      `+++ b/.github/workflows/a.yaml\n` +
      `@@ -1,4 +1,4 @@\n` +
      `+      - uses: actions/cache@v4\n` +
      `+        with:\n` +
      `+          path: node_modules/.prisma\n` +
      `+          key: bun-\${{ vars.BUN_VERSION }}-\${{ hashFiles('bun.lock') }}\n`
    const v = checkStagedCachePaths(diff, DEFAULT_CACHE_KEY_RULES())
    expect(v.length).toBe(1)
    expect(v[0]).toContain("a.yaml:1")
  })

  it("bloco NOVO com key bun + restore-keys prisma → violação (0º fecha o par no diff)", () => {
    const diff =
      `+++ b/.github/workflows/a.yml\n` +
      `@@ -1,5 +1,5 @@\n` +
      `+      - uses: actions/cache@v4\n` +
      `+        with:\n` +
      `+          path: node_modules\n` +
      `+          key: bun-\${{ vars.BUN_VERSION }}-\${{ hashFiles('bun.lock') }}\n` +
      `+          restore-keys: prisma-\${{ vars.BUN_VERSION }}-\n`
    const v = checkStagedCachePaths(diff, DEFAULT_CACHE_KEY_RULES())
    expect(v.length).toBe(1)
    expect(v[0]).toContain("a.yml:1")
    expect(v[0]).toContain("restore-keys 'prisma-...'")
    expect(v[0]).toContain("feche o par key↔path")
  })

  it("bloco NOVO com key bun + restore-keys bun → zero violações (par fecha nas duas direções)", () => {
    const diff =
      `+++ b/.github/workflows/a.yml\n` +
      `@@ -1,5 +1,5 @@\n` +
      `+      - uses: actions/cache@v4\n` +
      `+        with:\n` +
      `+          path: node_modules\n` +
      `+          key: bun-\${{ vars.BUN_VERSION }}-\${{ hashFiles('bun.lock') }}\n` +
      `+          restore-keys: bun-\${{ vars.BUN_VERSION }}-\n`
    expect(checkStagedCachePaths(diff, DEFAULT_CACHE_KEY_RULES())).toEqual([])
  })

  it("bloco NOVO com key de toolchain CUSTOM (next) + path de OUTRA toolchain → violação (regra configurada)", () => {
    // path: node_modules pertence à toolchain bun (DEFAULT) — sob key next-15
    // é path estranho → violação do par. A mensagem usa 'cache next-...'
    // (keyPrefix + '...'), nunca a key completa.
    const rules = [
      ...DEFAULT_CACHE_KEY_RULES(),
      { prefix: "next", version: "15", paths: [".next"] },
    ]
    const diff =
      `+++ b/.github/workflows/a.yml\n` +
      `@@ -1,5 +1,5 @@\n` +
      `+      - uses: actions/cache@v4\n` +
      `+        with:\n` +
      `+          path: node_modules\n` +
      `+          key: next-15-\${{ hashFiles('next.lock') }}\n`
    const v = checkStagedCachePaths(diff, rules)
    expect(v.length).toBe(1)
    expect(v[0]).toContain("a.yml:1")
    expect(v[0]).toContain("cache 'next-...'")
    expect(v[0]).toContain("node_modules")
  })

  it("bloco NOVO com key de toolchain CUSTOM (next) + path certo (.next) → zero violações", () => {
    // path match é EXATO (expected.includes(p) após trim) — '.next' casa,
    // '.next/cache' NÃO (cairia no passo 3 como path desconhecido).
    const rules = [
      ...DEFAULT_CACHE_KEY_RULES(),
      { prefix: "next", version: "15", paths: [".next"] },
    ]
    const diff =
      `+++ b/.github/workflows/a.yml\n` +
      `@@ -1,5 +1,5 @@\n` +
      `+      - uses: actions/cache@v4\n` +
      `+        with:\n` +
      `+          path: .next\n` +
      `+          key: next-15-\${{ hashFiles('next.lock') }}\n`
    expect(checkStagedCachePaths(diff, rules)).toEqual([])
  })

  it("diff vazio → zero violações", () => {
    expect(checkStagedCachePaths("", DEFAULT_CACHE_KEY_RULES())).toEqual([])
  })
})

// ── checkCacheKeys ────────────────────────────────────────────────────────

describe("checkCacheKeys", () => {
  function makeWorkflowsDir(files: Record<string, string>): string {
    const dir = join(makeDir(), "workflows")
    mkdirSync(dir)
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(dir, name), content)
    }
    return dir
  }

  // ATENÇÃO: dentro de template literals o `${{` do GitHub Actions precisa
  // de escape (`\${{`) — senão o esbuild lê `${` como início de interpolação
  // e o arquivo nem compila.
  const varsRefKey = `      - uses: actions/cache@v4\n        with:\n          path: node_modules\n          key: bun-\${{ vars.BUN_VERSION }}-\${{ hashFiles('bun.lock') }}\n          restore-keys: bun-\${{ vars.BUN_VERSION }}-\n`
  const literalKey = `      - uses: actions/cache@v4\n        with:\n          path: node_modules\n          key: bun-1.3.14-\${{ hashFiles('bun.lock') }}\n          restore-keys: bun-1.3.14-\n`
  const noVersionKey = `      - uses: actions/cache@v4\n        with:\n          path: node_modules\n          key: bun-\${{ hashFiles('bun.lock') }}\n          restore-keys: bun-\n`

  it("key/restore-keys com referência vars.BUN_VERSION → zero violações", () => {
    const dir = makeWorkflowsDir({ "a.yml": varsRefKey })
    expect(checkCacheKeys(dir, DEFAULT_CACHE_KEY_RULES())).toEqual([])
  })

  it("key/restore-keys com versão LITERAL → violação (use a variável)", () => {
    const dir = makeWorkflowsDir({ "a.yml": literalKey })
    const v = checkCacheKeys(dir, DEFAULT_CACHE_KEY_RULES())
    expect(v.length).toBe(2)
    expect(v[0]).toContain("a.yml:4")
    expect(v[0]).toContain("bun-1.3.14-")
    expect(v[0]).toContain("vars.BUN_VERSION")
  })

  it("key/restore-keys SEM versão → violação", () => {
    const dir = makeWorkflowsDir({ "a.yml": noVersionKey })
    const v = checkCacheKeys(dir, DEFAULT_CACHE_KEY_RULES())
    expect(v.length).toBe(2)
    expect(v[0]).toContain("key de cache 'bun-")
    expect(v[0]).toContain("sem a fonte única")
  })

  it("prisma cache key com referência → zero violações; com literal → violação", () => {
    const withRef = makeWorkflowsDir({
      "b.yml": `          key: prisma-\${{ vars.BUN_VERSION }}-\${{ hashFiles('prisma/schema.prisma') }}-\${{ hashFiles('bun.lock') }}\n          restore-keys: prisma-\${{ vars.BUN_VERSION }}-\n`,
    })
    expect(checkCacheKeys(withRef, DEFAULT_CACHE_KEY_RULES())).toEqual([])

    const withLiteral = makeWorkflowsDir({
      "c.yml": `          key: prisma-1.3.14-\${{ hashFiles('prisma/schema.prisma') }}\n`,
    })
    const v = checkCacheKeys(withLiteral, DEFAULT_CACHE_KEY_RULES())
    expect(v.length).toBe(1)
    expect(v[0]).toContain("prisma-1.3.14-")
  })

  it("cache keys sem prefixo configurado são ignoradas", () => {
    const dir = makeWorkflowsDir({
      "a.yml": `          key: other-\${{ hashFiles('lock') }}\n`,
    })
    expect(checkCacheKeys(dir, DEFAULT_CACHE_KEY_RULES())).toEqual([])
  })

  it("suporta regras de OUTRAS toolchains (ex.: next-15-...)", () => {
    const rules = [
      { prefix: "bun", version: "${{ vars.BUN_VERSION }}" },
      { prefix: "prisma", version: "${{ vars.BUN_VERSION }}" },
      { prefix: "next", version: "15" },
    ]

    // next com a versão correta (15) → zero violações
    const okDir = makeWorkflowsDir({
      "a.yml": `          key: next-15-\${{ hashFiles('next.lock') }}\n`,
    })
    expect(checkCacheKeys(okDir, rules)).toEqual([])

    // next com versão errada (14) → violação apontando a regra certa
    const badDir = makeWorkflowsDir({
      "b.yml": `          key: next-14-\${{ hashFiles('next.lock') }}\n`,
    })
    const v = checkCacheKeys(badDir, rules)
    expect(v.length).toBe(1)
    expect(v[0]).toContain("next-14-")
    expect(v[0]).toContain("fonte única 15")
  })

  it("lista de regras vazia → zero violações (scan desligado)", () => {
    const dir = makeWorkflowsDir({
      "a.yml": `          key: bun-\${{ hashFiles('bun.lock') }}\n`,
    })
    expect(checkCacheKeys(dir, [])).toEqual([])
  })

  it("diretório inexistente → zero violações (fail-open no scan, fail-closed no mirror)", () => {
    expect(checkCacheKeys(join(makeDir(), "nope"), DEFAULT_CACHE_KEY_RULES())).toEqual([])
  })

  it("escaneia arquivos .yaml — key literal em .yaml → violação com arquivo:linha", () => {
    const dir = makeWorkflowsDir({ "a.yaml": literalKey })
    const v = checkCacheKeys(dir, DEFAULT_CACHE_KEY_RULES())
    expect(v.length).toBe(2)
    expect(v[0]).toContain("a.yaml:4")
    expect(v[0]).toContain("bun-1.3.14-")
  })

  it("regras de OUTRAS toolchains valem em .yaml (next-14 → violação)", () => {
    const rules = [
      { prefix: "bun", version: "${{ vars.BUN_VERSION }}" },
      { prefix: "prisma", version: "${{ vars.BUN_VERSION }}" },
      { prefix: "next", version: "15" },
    ]
    const dir = makeWorkflowsDir({
      "a.yaml": `          key: next-14-\${{ hashFiles('next.lock') }}\n`,
    })
    const v = checkCacheKeys(dir, rules)
    expect(v.length).toBe(1)
    expect(v[0]).toContain("a.yaml:1")
    expect(v[0]).toContain("next-14-")
    expect(v[0]).toContain("fonte única 15")
  })
})

// ── checkNoLiteralBunVersion ─────────────────────────────────────────────

describe("checkNoLiteralBunVersion", () => {
  function makeWorkflowsDir(files: Record<string, string>): string {
    const dir = join(makeDir(), "workflows")
    mkdirSync(dir)
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(dir, name), content)
    }
    return dir
  }

  it("workflows com referência vars.BUN_VERSION → zero violações", () => {
    const dir = makeWorkflowsDir({
      "a.yml": `        with:\n          bun-version: \${{ vars.BUN_VERSION }}\n          key: bun-\${{ vars.BUN_VERSION }}-foo\n`,
    })
    expect(checkNoLiteralBunVersion(dir)).toEqual([])
  })

  it("bun-version: <literal> → violação", () => {
    const dir = makeWorkflowsDir({
      "a.yml": `        with:\n          bun-version: 1.3.14\n`,
    })
    const v = checkNoLiteralBunVersion(dir)
    expect(v.length).toBe(1)
    expect(v[0]).toContain("1.3.14")
    expect(v[0]).toContain("a.yml:2")
    expect(v[0]).toContain("bun-version: 1.3.14")
  })

  it("BUN_VERSION: <literal> → violação", () => {
    const dir = makeWorkflowsDir({
      "a.yml": `env:\n  BUN_VERSION: "1.3.14"\n`,
    })
    const v = checkNoLiteralBunVersion(dir)
    expect(v.length).toBe(1)
    expect(v[0]).toContain("BUN_VERSION")
  })

  it("cache key com literal → violação (bun-1.3.14-...)", () => {
    const dir = makeWorkflowsDir({
      "a.yml": `          key: bun-1.3.14-\${{ hashFiles('bun.lock') }}\n`,
    })
    const v = checkNoLiteralBunVersion(dir)
    expect(v.length).toBe(1)
    expect(v[0]).toContain("bun-1.3.14-")
  })

  it("ignora comentários e linhas que citam a versão em prosa", () => {
    const dir = makeWorkflowsDir({
      "a.yml": `# pinar 1.3.14 (comentário — ignorado)\n          key: bun-\${{ vars.BUN_VERSION }}-ok\n`,
    })
    expect(checkNoLiteralBunVersion(dir)).toEqual([])
  })

  it("diretório inexistente → zero violações", () => {
    expect(checkNoLiteralBunVersion(join(makeDir(), "nope"))).toEqual([])
  })

  it("escaneia arquivos .yaml — literal bun-version em .yaml → violação", () => {
    const dir = makeWorkflowsDir({
      "a.yaml": `        with:\n          bun-version: 1.3.14\n`,
    })
    const v = checkNoLiteralBunVersion(dir)
    expect(v.length).toBe(1)
    expect(v[0]).toContain("a.yaml:2")
    expect(v[0]).toContain("1.3.14")
  })
})

// ── checkActrc ────────────────────────────────────────────────────────────

describe("checkActrc", () => {
  it(".actrc com BUN_VERSION → zero violações", () => {
    const dir = makeDir()
    const p = join(dir, ".actrc")
    writeFileSync(p, "# config\n--var BUN_VERSION=1.3.14\n")
    expect(checkActrc(p)).toEqual([])
  })

  it(".actrc sem BUN_VERSION → violação", () => {
    const dir = makeDir()
    const p = join(dir, ".actrc")
    writeFileSync(p, "--var OTHER=1\n")
    const v = checkActrc(p)
    expect(v.length).toBe(1)
    expect(v[0]).toContain("BUN_VERSION")
  })

  it(".actrc ausente → violação (fail-closed — act local quebraria)", () => {
    const dir = makeDir()
    const v = checkActrc(join(dir, ".actrc"))
    expect(v.length).toBe(1)
    expect(v[0]).toContain("ausente")
  })
})

// ── parseDiffAddedLines ─────────────────────────────────────────────────

describe("parseDiffAddedLines", () => {
  it("extrai linhas adicionadas por arquivo com número de linha no NOVO arquivo", () => {
    const diff =
      `diff --git a/.github/workflows/a.yml b/.github/workflows/a.yml\n` +
      `--- a/.github/workflows/a.yml\n` +
      `+++ b/.github/workflows/a.yml\n` +
      `@@ -3,2 +3,2 @@\n` +
      `   - uses: actions/cache@v4\n` +
      `-          key: bun-1.3.14-\${{ hashFiles('bun.lock') }}\n` +
      `+          key: bun-\${{ vars.BUN_VERSION }}-\${{ hashFiles('bun.lock') }}\n` +
      `-          restore-keys: bun-1.3.14-\n` +
      `+          restore-keys: bun-\${{ vars.BUN_VERSION }}-\n`
    const added = parseDiffAddedLines(diff)
    expect(added.size).toBe(1)
    const lines = added.get(".github/workflows/a.yml")!
    expect(lines).toHaveLength(2)
    expect(lines[0].lineNo).toBe(4)
    expect(lines[0].content).toContain("key: bun-${{ vars.BUN_VERSION }}")
    expect(lines[1].lineNo).toBe(5)
    expect(lines[1].content).toContain("restore-keys:")
  })

  it("múltiplos hunks: reseta a numeração pela linha de partida do hunk", () => {
    const diff =
      `+++ b/.github/workflows/a.yml\n` +
      `@@ -1,1 +10,1 @@\n` +
      `+          first: true\n` +
      `@@ -20,1 +30,1 @@\n` +
      `+          second: true\n`
    const lines = parseDiffAddedLines(diff).get(".github/workflows/a.yml")!
    expect(lines[0]).toEqual({ lineNo: 10, content: "          first: true" })
    expect(lines[1]).toEqual({ lineNo: 30, content: "          second: true" })
  })

  it("ignora linhas removidas e de contexto (só '+' conta)", () => {
    const diff =
      `+++ b/.github/workflows/a.yml\n` +
      `@@ -1,3 +1,3 @@\n` +
      `-          removed: true\n` +
      `           context: true\n` +
      `+          added: true\n`
    const lines = parseDiffAddedLines(diff).get(".github/workflows/a.yml")!
    expect(lines).toHaveLength(1)
    // hunk +1,3 → nova linha começa em 1; a linha de contexto ocupa a 1,
    // então a linha adicionada fica na 2 (não na 3)
    expect(lines[0]).toEqual({ lineNo: 2, content: "          added: true" })
  })

  it("arquivo DELETADO (+++ /dev/null) não gera entrada", () => {
    const diff =
      `diff --git a/.github/workflows/a.yml b/.github/workflows/a.yml\n` +
      `deleted file mode 100644\n` +
      `--- a/.github/workflows/a.yml\n` +
      `+++ /dev/null\n` +
      `@@ -1,2 +0,0 @@\n` +
      `-          key: bun-1.3.14-\${{ hashFiles('bun.lock') }}\n`
    expect(parseDiffAddedLines(diff).size).toBe(0)
  })

  it("arquivo NOVO (@@ -0,0 +1,N @@) conta linhas a partir de 1", () => {
    const diff =
      `diff --git a/.github/workflows/new.yml b/.github/workflows/new.yml\n` +
      `new file mode 100644\n` +
      `--- /dev/null\n` +
      `+++ b/.github/workflows/new.yml\n` +
      `@@ -0,0 +1,2 @@\n` +
      `+name: Novo\n` +
      `+          key: bun-1.3.14-\${{ hashFiles('bun.lock') }}\n`
    const lines = parseDiffAddedLines(diff).get(".github/workflows/new.yml")!
    expect(lines).toHaveLength(2)
    expect(lines[0].lineNo).toBe(1)
    expect(lines[1].lineNo).toBe(2)
    // e o check staged detecta a violação da key no arquivo novo
    expect(checkStagedCacheKeys(diff, DEFAULT_CACHE_KEY_RULES())).toHaveLength(1)
  })

  it("ignora arquivos não-.yml no diff", () => {
    const diff =
      `+++ b/src/lib/foo.ts\n` +
      `@@ -1,1 +1,1 @@\n` +
      `+          key: bun-1.3.14-\${{ hashFiles('bun.lock') }}\n`
    expect(parseDiffAddedLines(diff).size).toBe(0)
  })

  it("aceita arquivos .yaml no diff (extensão alternativa não escapa)", () => {
    const diff =
      `+++ b/.github/workflows/a.yaml\n` +
      `@@ -1,1 +1,1 @@\n` +
      `+          key: bun-1.3.14-\${{ hashFiles('bun.lock') }}\n`
    const added = parseDiffAddedLines(diff)
    expect(added.size).toBe(1)
    expect(added.has(".github/workflows/a.yaml")).toBe(true)
    // e o check staged detecta a violação da key no .yaml
    expect(checkStagedCacheKeys(diff, DEFAULT_CACHE_KEY_RULES())).toHaveLength(1)
  })

  it("diff vazio → mapa vazio", () => {
    expect(parseDiffAddedLines("")).toEqual(new Map())
  })
})

// ── parseDiffLines (parser rico: adicionadas + contexto) ────────────────

describe("parseDiffLines", () => {
  it("inclui linhas ADICIONADAS, de CONTEXTO e REMOVIDAS com flags", () => {
    const diff =
      `+++ b/.github/workflows/a.yml\n` +
      `@@ -1,3 +1,3 @@\n` +
      `-          removed: true\n` +
      `           context: true\n` +
      `+          added: true\n`
    const lines = parseDiffLines(diff).get(".github/workflows/a.yml")!
    expect(lines).toHaveLength(3)
    // REMOVIDA não incrementa lineNo (não existe no arquivo novo) — fica no
    // mesmo lineNo do contexto seguinte.
    expect(lines[0]).toEqual({ lineNo: 1, content: "          removed: true", removed: true })
    expect(lines[1]).toEqual({ lineNo: 1, content: "          context: true", added: false })
    expect(lines[2]).toEqual({ lineNo: 2, content: "          added: true", added: true })
  })

  it("parseDiffAddedLines continua retornando SÓ adicionadas (delega no rico)", () => {
    const diff =
      `+++ b/.github/workflows/a.yml\n` +
      `@@ -1,3 +1,3 @@\n` +
      `           context: true\n` +
      `+          added: true\n`
    const lines = parseDiffAddedLines(diff).get(".github/workflows/a.yml")!
    expect(lines).toEqual([{ lineNo: 2, content: "          added: true" }])
  })

  it("arquivo não-.yml → zero linhas (nem contexto)", () => {
    const diff =
      `+++ b/src/lib/foo.ts\n` +
      `@@ -1,2 +1,2 @@\n` +
      `           context: true\n` +
      `+          added: true\n`
    expect(parseDiffLines(diff).size).toBe(0)
  })

  it("aceita arquivos .yaml no parser rico (adicionadas + contexto)", () => {
    const diff =
      `+++ b/.github/workflows/a.yaml\n` +
      `@@ -1,2 +1,2 @@\n` +
      `           context: true\n` +
      `+          added: true\n`
    const lines = parseDiffLines(diff).get(".github/workflows/a.yaml")!
    expect(lines).toHaveLength(2)
    expect(lines[1].added).toBe(true)
  })

  it("diff MULTI-arquivo: header '--- a/<próximo>' NÃO vira remoção espúria do arquivo anterior", () => {
    // Bug latente pego no review: sem o guard `--- `, num diff com DOIS
    // arquivos o header `--- a/b.yml` (que vem ANTES do `+++ b/b.yml` que
    // reseta currentFile) seria empurrado como `removed: true` do arquivo a.
    const diff =
      `diff --git a/.github/workflows/a.yml b/.github/workflows/a.yml\n` +
      `--- a/.github/workflows/a.yml\n` +
      `+++ b/.github/workflows/a.yml\n` +
      `@@ -1,2 +1,1 @@\n` +
      `-          removed: true\n` +
      `           context: true\n` +
      `diff --git a/.github/workflows/b.yml b/.github/workflows/b.yml\n` +
      `--- a/.github/workflows/b.yml\n` +
      `+++ b/.github/workflows/b.yml\n` +
      `@@ -1,1 +1,1 @@\n` +
      `+          added: true\n`
    const perFile = parseDiffLines(diff)
    // a.yml: só a REMOVIDA + o CONTEXTO (sem linhas espúrias do header b)
    const a = perFile.get(".github/workflows/a.yml")!
    expect(a).toHaveLength(2)
    expect(a[0]).toEqual({ lineNo: 1, content: "          removed: true", removed: true })
    expect(a[1]).toEqual({ lineNo: 1, content: "          context: true", added: false })
    // b.yml: só a ADICIONADA
    const b = perFile.get(".github/workflows/b.yml")!
    expect(b).toHaveLength(1)
    expect(b[0]).toEqual({ lineNo: 1, content: "          added: true", added: true })
  })
})

// ── isValidGitRef / gitDiffWorkflows (validação de ref do --base) ───────

describe("isValidGitRef", () => {
  it("aceita refs normais (origin/main, main, v1.3.14)", () => {
    expect(isValidGitRef("origin/main")).toBe(true)
    expect(isValidGitRef("main")).toBe(true)
    expect(isValidGitRef("refs/tags/v1.3.14")).toBe(true)
  })

  it("aceita operadores de REVISÃO git (HEAD~1, HEAD^, v1.0~2) — refs legítimas do --base", () => {
    // `~`/`^` são INOCUOS: o ref só entra numa range de `git diff` via
    // execFileSync (array, sem shell); a proteção real é o `..` e o `-`.
    expect(isValidGitRef("HEAD~1")).toBe(true)
    expect(isValidGitRef("HEAD~")).toBe(true)
    expect(isValidGitRef("HEAD^")).toBe(true)
    expect(isValidGitRef("HEAD^2")).toBe(true)
    expect(isValidGitRef("v1.0~2")).toBe(true)
  })

  it("rejeita metacharacters de shell e refs perigosas", () => {
    expect(isValidGitRef("main; rm -rf /")).toBe(false)
    expect(isValidGitRef("$(whoami)")).toBe(false)
    expect(isValidGitRef("-f")).toBe(false)
    expect(isValidGitRef("main..other")).toBe(false)
    expect(isValidGitRef("HEAD~1;rm -rf /")).toBe(false)
    expect(isValidGitRef("")).toBe(false)
  })
})

// ── checkStagedCacheKeys / checkStagedLiterals ──────────────────────────

describe("checkStagedCacheKeys", () => {
  const diffWithLiteral =
    `+++ b/.github/workflows/a.yml\n` +
    `@@ -1,2 +1,2 @@\n` +
    `+          key: bun-1.3.14-\${{ hashFiles('bun.lock') }}\n` +
    `+          restore-keys: bun-1.3.14-\n`
  const diffWithVars =
    `+++ b/.github/workflows/a.yml\n` +
    `@@ -1,2 +1,2 @@\n` +
    `+          key: bun-\${{ vars.BUN_VERSION }}-\${{ hashFiles('bun.lock') }}\n` +
    `+          restore-keys: bun-\${{ vars.BUN_VERSION }}-\n`

  it("key antiga (bun-1.3.14-) ADICIONADA pelo diff → violação", () => {
    const v = checkStagedCacheKeys(diffWithLiteral, DEFAULT_CACHE_KEY_RULES())
    expect(v.length).toBe(2)
    expect(v[0]).toContain("a.yml:1")
    expect(v[0]).toContain("bun-1.3.14-")
  })

  it("key com a referência vars.BUN_VERSION → zero violações", () => {
    expect(checkStagedCacheKeys(diffWithVars, DEFAULT_CACHE_KEY_RULES())).toEqual([])
  })

  it("violação PRÉ-EXISTENTE (linha de contexto, não adicionada) não polui o diff", () => {
    const diff =
      `+++ b/.github/workflows/a.yml\n` +
      `@@ -1,2 +1,2 @@\n` +
      `           key: bun-1.3.14-\${{ hashFiles('bun.lock') }}\n` +
      `+          other: true\n`
    const v = checkStagedCacheKeys(diff, DEFAULT_CACHE_KEY_RULES())
    expect(v).toEqual([])
  })

  it("violação em arquivo NÃO-workflow não é avaliada", () => {
    const diff =
      `+++ b/package.json\n` +
      `@@ -1,1 +1,1 @@\n` +
      `+          key: bun-1.3.14-\${{ hashFiles('bun.lock') }}\n`
    expect(checkStagedCacheKeys(diff, DEFAULT_CACHE_KEY_RULES())).toEqual([])
  })

  it("key literal em arquivo .yaml adicionado pelo diff → violação", () => {
    const diff =
      `+++ b/.github/workflows/a.yaml\n` +
      `@@ -1,1 +1,1 @@\n` +
      `+          key: bun-1.3.14-\${{ hashFiles('bun.lock') }}\n`
    const v = checkStagedCacheKeys(diff, DEFAULT_CACHE_KEY_RULES())
    expect(v.length).toBe(1)
    expect(v[0]).toContain("a.yaml:1")
  })

  // ── OUTRAS toolchains configuráveis (DEFAULT_CACHE_KEY_RULES) ─────────

  it("key prisma literal ADICIONADA pelo diff → violação (não só bun)", () => {
    const diff =
      `+++ b/.github/workflows/a.yml\n` +
      `@@ -1,1 +1,1 @@\n` +
      `+          key: prisma-1.3.14-\${{ hashFiles('prisma/schema.prisma') }}\n`
    const v = checkStagedCacheKeys(diff, DEFAULT_CACHE_KEY_RULES())
    expect(v.length).toBe(1)
    expect(v[0]).toContain("a.yml:1")
    expect(v[0]).toContain("prisma-1.3.14-")
    expect(v[0]).toContain("sem a fonte única")
  })

  it("key de toolchain CUSTOM (next-14) ADICIONADA pelo diff → violação pela regra configurada", () => {
    const rules = [...DEFAULT_CACHE_KEY_RULES(), { prefix: "next", version: "15" }]
    const diff =
      `+++ b/.github/workflows/a.yml\n` +
      `@@ -1,1 +1,1 @@\n` +
      `+          key: next-14-\${{ hashFiles('next.lock') }}\n`
    const v = checkStagedCacheKeys(diff, rules)
    expect(v.length).toBe(1)
    expect(v[0]).toContain("a.yml:1")
    expect(v[0]).toContain("next-14-")
    expect(v[0]).toContain("fonte única 15")
  })

  it("key de toolchain CUSTOM com a versão certa (next-15) → zero violações", () => {
    const rules = [...DEFAULT_CACHE_KEY_RULES(), { prefix: "next", version: "15" }]
    const diff =
      `+++ b/.github/workflows/a.yml\n` +
      `@@ -1,1 +1,1 @@\n` +
      `+          key: next-15-\${{ hashFiles('next.lock') }}\n`
    expect(checkStagedCacheKeys(diff, rules)).toEqual([])
  })

  it("sem regra para o prefixo (other-...) → zero violações (toolchain não configurada)", () => {
    const diff =
      `+++ b/.github/workflows/a.yml\n` +
      `@@ -1,1 +1,1 @@\n` +
      `+          key: other-\${{ hashFiles('lock') }}\n`
    expect(checkStagedCacheKeys(diff, DEFAULT_CACHE_KEY_RULES())).toEqual([])
  })

  it("key literal bun E prisma no MESMO diff → 2 violações (todas as toolchains configuradas)", () => {
    const diff =
      `+++ b/.github/workflows/a.yml\n` +
      `@@ -1,2 +1,2 @@\n` +
      `+          key: bun-1.3.14-\${{ hashFiles('bun.lock') }}\n` +
      `+          key: prisma-1.3.14-\${{ hashFiles('prisma/schema.prisma') }}\n`
    const v = checkStagedCacheKeys(diff, DEFAULT_CACHE_KEY_RULES())
    expect(v.length).toBe(2)
    expect(v.some((x) => x.includes("bun-1.3.14-"))).toBe(true)
    expect(v.some((x) => x.includes("prisma-1.3.14-"))).toBe(true)
  })
})

describe("checkStagedLiterals", () => {
  it("literal bun-version: 1.3.14 ADICIONADO → violação", () => {
    const diff =
      `+++ b/.github/workflows/a.yml\n` + `@@ -1,1 +1,1 @@\n` + `+          bun-version: 1.3.14\n`
    const v = checkStagedLiterals(diff)
    expect(v.length).toBe(1)
    expect(v[0]).toContain("a.yml:1")
    expect(v[0]).toContain("1.3.14")
  })

  it("literal em linha de CONTEXTO (pré-existente) não é violação", () => {
    const diff =
      `+++ b/.github/workflows/a.yml\n` +
      `@@ -1,1 +1,1 @@\n` +
      `           bun-version: 1.3.14\n` +
      `+          added: true\n`
    expect(checkStagedLiterals(diff)).toEqual([])
  })

  it("diff vazio → zero violações", () => {
    expect(checkStagedLiterals("")).toEqual([])
  })

  it("literal em arquivo .yaml adicionado → violação", () => {
    const diff =
      `+++ b/.github/workflows/a.yaml\n` + `@@ -1,1 +1,1 @@\n` + `+          bun-version: 1.3.14\n`
    const v = checkStagedLiterals(diff)
    expect(v.length).toBe(1)
    expect(v[0]).toContain("a.yaml:1")
    expect(v[0]).toContain("1.3.14")
  })
})

// ── checkStagedSetupBunCallSites (call sites introduzidos pelo diff) ────

describe("checkStagedSetupBunCallSites", () => {
  it("call site NOVO sem input bun-version → violação", () => {
    const diff =
      `+++ b/.github/workflows/a.yml\n` +
      `@@ -1,3 +1,3 @@\n` +
      `+      - uses: ./.github/actions/setup-bun\n` +
      `+        with:\n` +
      `+          cache: '~/.bun'\n`
    const v = checkStagedSetupBunCallSites(diff)
    expect(v.length).toBe(1)
    expect(v[0]).toContain("a.yml:1")
    expect(v[0]).toContain("SEM input bun-version")
  })

  it("call site NOVO com bun-version: ${{ vars.BUN_VERSION }} → zero violações", () => {
    const diff =
      `+++ b/.github/workflows/a.yml\n` +
      `@@ -1,3 +1,3 @@\n` +
      `+      - uses: ./.github/actions/setup-bun\n` +
      `+        with:\n` +
      `+          bun-version: \${{ vars.BUN_VERSION }}\n`
    expect(checkStagedSetupBunCallSites(diff)).toEqual([])
  })

  it("call site NOVO com literal bun-version: 1.3.14 → violação", () => {
    const diff =
      `+++ b/.github/workflows/a.yml\n` +
      `@@ -1,3 +1,3 @@\n` +
      `+      - uses: ./.github/actions/setup-bun\n` +
      `+        with:\n` +
      `+          bun-version: 1.3.14\n`
    const v = checkStagedSetupBunCallSites(diff)
    expect(v.length).toBe(1)
    expect(v[0]).toContain("a.yml:1")
    expect(v[0]).toContain("bun-version='1.3.14'")
  })

  it("call site PRÉ-EXISTENTE (uses é contexto, não adicionado) não polui o diff", () => {
    const diff =
      `+++ b/.github/workflows/a.yml\n` +
      `@@ -1,2 +1,2 @@\n` +
      `       - uses: ./.github/actions/setup-bun\n` +
      `+          other: true\n`
    expect(checkStagedSetupBunCallSites(diff)).toEqual([])
  })

  it("migração de action: uses ADICIONADO + bun-version em CONTEXTO → zero violações", () => {
    // oven-sh/setup-bun@v2 → ./.github/actions/setup-bun: o diff adiciona só
    // a linha uses; with:/bun-version: são CONTEXTO. Só o parser rico vê o
    // bun-version correto (sem ele, falso positivo 'SEM input').
    const diff =
      `+++ b/.github/workflows/a.yml\n` +
      `@@ -1,3 +1,3 @@\n` +
      `-      - uses: oven-sh/setup-bun@v2\n` +
      `+      - uses: ./.github/actions/setup-bun\n` +
      `        with:\n` +
      `          bun-version: \${{ vars.BUN_VERSION }}\n`
    expect(checkStagedSetupBunCallSites(diff)).toEqual([])
  })

  it("migração de action com bun-version LITERAL em contexto → violação", () => {
    const diff =
      `+++ b/.github/workflows/a.yml\n` +
      `@@ -1,3 +1,3 @@\n` +
      `-      - uses: oven-sh/setup-bun@v2\n` +
      `+      - uses: ./.github/actions/setup-bun\n` +
      `        with:\n` +
      `          bun-version: 1.3.14\n`
    const v = checkStagedSetupBunCallSites(diff)
    expect(v.length).toBe(1)
    expect(v[0]).toContain("a.yml:1")
    expect(v[0]).toContain("bun-version='1.3.14'")
  })

  it("ignora comentários que citam o uses em prosa", () => {
    const diff =
      `+++ b/.github/workflows/a.yml\n` +
      `@@ -1,1 +1,1 @@\n` +
      `+      # usamos ./.github/actions/setup-bun em todos os jobs\n`
    expect(checkStagedSetupBunCallSites(diff)).toEqual([])
  })

  it("múltiplos call sites: um com bun-version + um sem → só o mau é reportado", () => {
    const diff =
      `+++ b/.github/workflows/a.yml\n` +
      `@@ -1,6 +1,6 @@\n` +
      `+      - uses: ./.github/actions/setup-bun\n` +
      `+        with:\n` +
      `+          bun-version: \${{ vars.BUN_VERSION }}\n` +
      `+      - uses: ./.github/actions/setup-bun\n` +
      `+        with:\n` +
      `+          cache: '~/.bun'\n`
    const v = checkStagedSetupBunCallSites(diff)
    expect(v.length).toBe(1)
    expect(v[0]).toContain("a.yml:4")
  })

  it("arquivo não-.yml → zero violações", () => {
    const diff =
      `+++ b/src/lib/foo.ts\n` +
      `@@ -1,3 +1,3 @@\n` +
      `+      - uses: ./.github/actions/setup-bun\n`
    expect(checkStagedSetupBunCallSites(diff)).toEqual([])
  })

  it("call site NOVO sem input em arquivo .yaml → violação", () => {
    const diff =
      `+++ b/.github/workflows/a.yaml\n` +
      `@@ -1,3 +1,3 @@\n` +
      `+      - uses: ./.github/actions/setup-bun\n` +
      `+        with:\n` +
      `+          cache: '~/.bun'\n`
    const v = checkStagedSetupBunCallSites(diff)
    expect(v.length).toBe(1)
    expect(v[0]).toContain("a.yaml:1")
    expect(v[0]).toContain("SEM input bun-version")
  })

  it("arquivo NOVO inteiro (@@ -0,0 +1,N @@) com call site sem input → violação", () => {
    // Arquivo .yml criado do zero: TODAS as linhas são '+', incluindo o
    // call site sem bun-version — o staged check precisa pegar esse caso
    // (a numeração começa em 1 no arquivo novo).
    const diff =
      `diff --git a/.github/workflows/new.yml b/.github/workflows/new.yml\n` +
      `new file mode 100644\n` +
      `--- /dev/null\n` +
      `+++ b/.github/workflows/new.yml\n` +
      `@@ -0,0 +1,4 @@\n` +
      `+name: Novo\n` +
      `+jobs:\n` +
      `+      - uses: ./.github/actions/setup-bun\n` +
      `+        with:\n`
    const v = checkStagedSetupBunCallSites(diff)
    expect(v.length).toBe(1)
    expect(v[0]).toContain("new.yml:3")
    expect(v[0]).toContain("SEM input bun-version")
  })

  it("diff vazio → zero violações", () => {
    expect(checkStagedSetupBunCallSites("")).toEqual([])
  })
})

// ── checkStagedRemovedBunVersion (REMOÇÃO do input de call site sobrevivente) ─

describe("checkStagedRemovedBunVersion", () => {
  it("REMOÇÃO do input bun-version de call site que SOBREVIVEU (uses contexto) → violação", () => {
    const diff =
      `+++ b/.github/workflows/a.yml\n` +
      `@@ -1,3 +1,2 @@\n` +
      `       - uses: ./.github/actions/setup-bun\n` +
      `         with:\n` +
      `-          bun-version: \${{ vars.BUN_VERSION }}\n`
    const v = checkStagedRemovedBunVersion(diff)
    expect(v.length).toBe(1)
    expect(v[0]).toContain("a.yml:3")
    expect(v[0]).toContain("REMOÇÃO")
    expect(v[0]).toContain("uses: linha 1")
  })

  it("call site INTEIRO removido (uses também é '-') → zero violações (step deletado)", () => {
    const diff =
      `+++ b/.github/workflows/a.yml\n` +
      `@@ -1,3 +0,0 @@\n` +
      `-      - uses: ./.github/actions/setup-bun\n` +
      `-        with:\n` +
      `-          bun-version: \${{ vars.BUN_VERSION }}\n`
    expect(checkStagedRemovedBunVersion(diff)).toEqual([])
  })

  it("migração literal→vars (removido + adicionado na janela) → zero violações (trocou o valor)", () => {
    const diff =
      `+++ b/.github/workflows/a.yml\n` +
      `@@ -1,3 +1,3 @@\n` +
      `       - uses: ./.github/actions/setup-bun\n` +
      `         with:\n` +
      `-          bun-version: 1.3.14\n` +
      `+          bun-version: \${{ vars.BUN_VERSION }}\n`
    expect(checkStagedRemovedBunVersion(diff)).toEqual([])
  })

  it("bun-version removido mas de OUTRA action (não setup-bun) → zero violações", () => {
    const diff =
      `+++ b/.github/workflows/a.yml\n` +
      `@@ -1,2 +1,1 @@\n` +
      `       - uses: actions/checkout@v4\n` +
      `-          bun-version: 1.3.14\n`
    expect(checkStagedRemovedBunVersion(diff)).toEqual([])
  })

  it("arquivo não-.yml → zero violações", () => {
    const diff =
      `+++ b/src/lib/foo.ts\n` +
      `@@ -1,2 +1,1 @@\n` +
      `       - uses: ./.github/actions/setup-bun\n` +
      `-          bun-version: 1.3.14\n`
    expect(checkStagedRemovedBunVersion(diff)).toEqual([])
  })

  it("REMOÇÃO em arquivo .yaml → violação", () => {
    const diff =
      `+++ b/.github/workflows/a.yaml\n` +
      `@@ -1,3 +1,2 @@\n` +
      `       - uses: ./.github/actions/setup-bun\n` +
      `         with:\n` +
      `-          bun-version: \${{ vars.BUN_VERSION }}\n`
    const v = checkStagedRemovedBunVersion(diff)
    expect(v.length).toBe(1)
    expect(v[0]).toContain("a.yaml:3")
    expect(v[0]).toContain("REMOÇÃO")
  })

  it("diff vazio → zero violações", () => {
    expect(checkStagedRemovedBunVersion("")).toEqual([])
  })
})

// ── checkStagedRemovedCacheBlockFields (REMOÇÃO do path:/key: de bloco sobrevivente) ─

describe("checkStagedRemovedCacheBlockFields", () => {
  it("REMOÇÃO do path: de bloco actions/cache que SOBREVIVEU (uses contexto) → violação", () => {
    const diff =
      `+++ b/.github/workflows/a.yml\n` +
      `@@ -1,3 +1,2 @@\n` +
      `       - uses: actions/cache@v4\n` +
      `         with:\n` +
      `-          path: node_modules\n`
    const v = checkStagedRemovedCacheBlockFields(diff)
    expect(v.length).toBe(1)
    expect(v[0]).toContain("a.yml:3")
    expect(v[0]).toContain("REMOÇÃO do campo path:")
    expect(v[0]).toContain("uses: linha 1")
  })

  it("REMOÇÃO da key: de bloco actions/cache que SOBREVIVEU → violação", () => {
    const diff =
      `+++ b/.github/workflows/a.yml\n` +
      `@@ -1,3 +1,2 @@\n` +
      `       - uses: actions/cache@v4\n` +
      `         with:\n` +
      `-          key: bun-\${{ vars.BUN_VERSION }}-\${{ hashFiles('bun.lock') }}\n`
    const v = checkStagedRemovedCacheBlockFields(diff)
    expect(v.length).toBe(1)
    expect(v[0]).toContain("a.yml:3")
    expect(v[0]).toContain("REMOÇÃO do campo key:")
    expect(v[0]).toContain("uses: linha 1")
  })

  it("bloco INTEIRO removido (uses também é '-') → zero violações (step deletado)", () => {
    const diff =
      `+++ b/.github/workflows/a.yml\n` +
      `@@ -1,3 +0,0 @@\n` +
      `-      - uses: actions/cache@v4\n` +
      `-        with:\n` +
      `-          path: node_modules\n` +
      `-          key: bun-\${{ vars.BUN_VERSION }}-\${{ hashFiles('bun.lock') }}\n`
    expect(checkStagedRemovedCacheBlockFields(diff)).toEqual([])
  })

  it("troca de path (removido + adicionado na janela) → zero violações (trocou o valor)", () => {
    const diff =
      `+++ b/.github/workflows/a.yml\n` +
      `@@ -1,4 +1,4 @@\n` +
      `       - uses: actions/cache@v4\n` +
      `         with:\n` +
      `-          path: node_modules\n` +
      `+          path: node_modules/.prisma\n`
    expect(checkStagedRemovedCacheBlockFields(diff)).toEqual([])
  })

  it("path removido mas de OUTRA action (não actions/cache) → zero violações", () => {
    const diff =
      `+++ b/.github/workflows/a.yml\n` +
      `@@ -1,2 +1,1 @@\n` +
      `       - uses: actions/checkout@v4\n` +
      `-          path: node_modules\n`
    expect(checkStagedRemovedCacheBlockFields(diff)).toEqual([])
  })

  it("arquivo não-.yml → zero violações", () => {
    const diff =
      `+++ b/src/lib/foo.ts\n` +
      `@@ -1,2 +1,1 @@\n` +
      `       - uses: actions/cache@v4\n` +
      `-          path: node_modules\n`
    expect(checkStagedRemovedCacheBlockFields(diff)).toEqual([])
  })

  it("REMOÇÃO em arquivo .yaml → violação", () => {
    const diff =
      `+++ b/.github/workflows/a.yaml\n` +
      `@@ -1,3 +1,2 @@\n` +
      `       - uses: actions/cache@v4\n` +
      `         with:\n` +
      `-          path: node_modules\n`
    const v = checkStagedRemovedCacheBlockFields(diff)
    expect(v.length).toBe(1)
    expect(v[0]).toContain("a.yaml:3")
    expect(v[0]).toContain("REMOÇÃO do campo path:")
  })

  it("restore-keys: removido NÃO é violação (campo opcional — fallback do cache)", () => {
    const diff =
      `+++ b/.github/workflows/a.yml\n` +
      `@@ -1,3 +1,2 @@\n` +
      `       - uses: actions/cache@v4\n` +
      `         with:\n` +
      `-          restore-keys: bun-\${{ vars.BUN_VERSION }}-\n`
    expect(checkStagedRemovedCacheBlockFields(diff)).toEqual([])
  })

  it("path e key removidos no mesmo bloco → 2 violações", () => {
    const diff =
      `+++ b/.github/workflows/a.yml\n` +
      `@@ -1,4 +1,2 @@\n` +
      `       - uses: actions/cache@v4\n` +
      `         with:\n` +
      `-          path: node_modules\n` +
      `-          key: bun-\${{ vars.BUN_VERSION }}-\${{ hashFiles('bun.lock') }}\n`
    const v = checkStagedRemovedCacheBlockFields(diff)
    expect(v.length).toBe(2)
    expect(v.some((x) => x.includes("REMOÇÃO do campo path:"))).toBe(true)
    expect(v.some((x) => x.includes("REMOÇÃO do campo key:"))).toBe(true)
  })

  it("diff vazio → zero violações", () => {
    expect(checkStagedRemovedCacheBlockFields("")).toEqual([])
  })
}) // ── checkStagedRemovedLiterals (REMOÇÃO de literal + literal sobrevivente = migração incompleta) ─

describe("checkStagedRemovedLiterals", () => {
  it("literal REMOVIDO (key bun-1.3.14-...) + literal SOBREVIVENTE (bun-version) na janela → violação", () => {
    // O PR migrou a key literal para a fonte única, mas o bun-version literal
    // do call site SOBREVIVE como contexto — a migração ficou incompleta.
    const diff =
      `+++ b/.github/workflows/a.yml\n` +
      `@@ -1,8 +1,8 @@\n` +
      `       - uses: ./.github/actions/setup-bun\n` +
      `         with:\n` +
      `           bun-version: 1.3.14\n` +
      `-          key: bun-1.3.14-\${{ hashFiles('bun.lock') }}\n` +
      `+          key: bun-\${{ vars.BUN_VERSION }}-\${{ hashFiles('bun.lock') }}\n`
    const v = checkStagedRemovedLiterals(diff)
    expect(v.length).toBe(1)
    expect(v[0]).toContain("a.yml:3")
    expect(v[0]).toContain("SOBREVIVE ao lado de literal REMOVIDO")
    expect(v[0]).toContain("migração incompleta")
  })

  it("literal REMOVIDO sem nenhum sobrevivente na janela → zero violações (migração completa)", () => {
    // A key literal foi removida E o bun-version também foi migrado — nada
    // sobrevive na região.
    const diff =
      `+++ b/.github/workflows/a.yml\n` +
      `@@ -1,8 +1,8 @@\n` +
      `-          bun-version: 1.3.14\n` +
      `+          bun-version: \${{ vars.BUN_VERSION }}\n` +
      `-          key: bun-1.3.14-\${{ hashFiles('bun.lock') }}\n` +
      `+          key: bun-\${{ vars.BUN_VERSION }}-\${{ hashFiles('bun.lock') }}\n`
    expect(checkStagedRemovedLiterals(diff)).toEqual([])
  })

  it("literal SOBREVIVENTE sem literal removido (nenhuma migração na região) → zero violações", () => {
    // bun-version literal é CONTEXTO pré-existente, mas NENHUM literal foi
    // removido pelo diff — o PR não está migrando esta região.
    const diff =
      `+++ b/.github/workflows/a.yml\n` +
      `@@ -1,5 +1,5 @@\n` +
      `       - uses: ./.github/actions/setup-bun\n` +
      `         with:\n` +
      `           bun-version: 1.3.14\n` +
      `+          other: true\n`
    expect(checkStagedRemovedLiterals(diff)).toEqual([])
  })

  it("literal removido e sobrevivente FORA da janela (CACHE_BLOCK_WINDOW) → zero violações", () => {
    // Removido na linha 2, sobrevivente na linha 25 — distância > 14 (janela).
    const diff =
      `+++ b/.github/workflows/a.yml\n` +
      `@@ -1,30 +1,30 @@\n` +
      `-          key: bun-1.3.14-\${{ hashFiles('bun.lock') }}\n` +
      `+          key: bun-\${{ vars.BUN_VERSION }}-x\n` +
      `       # contexto\n`.repeat(20) +
      `           bun-version: 1.3.14\n`
    expect(checkStagedRemovedLiterals(diff)).toEqual([])
  })

  it("bloco INTEIRO removido (sem sobrevivente na região) → zero violações", () => {
    // O step inteiro (com a key literal) foi removido — sem literal que
    // sobreviva, não há migração incompleta.
    const diff =
      `+++ b/.github/workflows/a.yml\n` +
      `@@ -1,4 +0,0 @@\n` +
      `-      - uses: actions/cache@v4\n` +
      `-        with:\n` +
      `-          key: bun-1.3.14-\${{ hashFiles('bun.lock') }}\n`
    expect(checkStagedRemovedLiterals(diff)).toEqual([])
  })

  it("detecta REMOÇÃO de bun-version literal com key literal sobrevivente (direção inversa)", () => {
    // Inverso do cenário 1: o bun-version foi migrado, mas a key literal
    // sobrevive no bloco de cache — mesma migração incompleta.
    const diff =
      `+++ b/.github/workflows/a.yml\n` +
      `@@ -1,8 +1,8 @@\n` +
      `-          bun-version: 1.3.14\n` +
      `+          bun-version: \${{ vars.BUN_VERSION }}\n` +
      `       - uses: actions/cache@v4\n` +
      `         with:\n` +
      `           key: bun-1.3.14-\${{ hashFiles('bun.lock') }}\n`
    const v = checkStagedRemovedLiterals(diff)
    expect(v.length).toBe(1)
    expect(v[0]).toContain("a.yml")
    expect(v[0]).toContain("migração incompleta")
  })

  it("ignora comentários e linhas em prosa (não são literal)", () => {
    const diff =
      `+++ b/.github/workflows/a.yml\n` +
      `@@ -1,5 +1,5 @@\n` +
      `-          # key: bun-1.3.14-x (comentário — não é literal)\n` +
      `+          ok: true\n`
    expect(checkStagedRemovedLiterals(diff)).toEqual([])
  })

  it("diff vazio → zero violações", () => {
    expect(checkStagedRemovedLiterals("")).toEqual([])
  })

  it("arquivo não-.yml → zero violações", () => {
    const diff =
      `+++ b/src/lib/foo.ts\n` +
      `@@ -1,3 +1,3 @@\n` +
      `-          key: bun-1.3.14-\${{ hashFiles('bun.lock') }}\n` +
      `+          key: bun-\${{ vars.BUN_VERSION }}-x\n` +
      `           bun-version: 1.3.14\n`
    expect(checkStagedRemovedLiterals(diff)).toEqual([])
  })
})

// ── checkSetupBunCallSite / normalizeBunVersionValue (nível de call site) ─
describe("checkSetupBunCallSite", () => {
  it("following com bun-version correto → null", () => {
    expect(
      checkSetupBunCallSite("a.yml", 1, [
        `        with:`,
        `          bun-version: \${{ vars.BUN_VERSION }}`,
      ]),
    ).toBeNull()
  })

  it("following SEM bun-version → mensagem de violação", () => {
    const v = checkSetupBunCallSite("a.yml", 1, [`        with:`, `          cache: '~/.bun'`])
    expect(v).toContain("a.yml:1")
    expect(v).toContain("SEM input bun-version")
  })

  it("following com literal → mensagem apontando o literal", () => {
    const v = checkSetupBunCallSite("a.yml", 1, [`        with:`, `          bun-version: 1.3.14`])
    expect(v).toContain("bun-version='1.3.14'")
  })
})

describe("normalizeBunVersionValue", () => {
  it("remove aspas e comentário inline", () => {
    expect(normalizeBunVersionValue(`"\${{ vars.BUN_VERSION }}" # nota`)).toBe(
      "${{ vars.BUN_VERSION }}",
    )
    expect(normalizeBunVersionValue(`\${{ vars.BUN_VERSION }}`)).toBe("${{ vars.BUN_VERSION }}")
  })
})

// ── checkCacheKeyLine / checkLiteralBunLine (nível de linha) ────────────

describe("checkCacheKeyLine", () => {
  const rules = DEFAULT_CACHE_KEY_RULES()

  it("linha correta → null (sem violação)", () => {
    expect(
      checkCacheKeyLine(
        "a.yml",
        4,
        `          key: bun-\${{ vars.BUN_VERSION }}-\${{ hashFiles('bun.lock') }}`,
        rules,
      ),
    ).toBeNull()
  })

  it("linha com literal → mensagem de violação", () => {
    const v = checkCacheKeyLine(
      "a.yml",
      4,
      `          key: bun-1.3.14-\${{ hashFiles('bun.lock') }}`,
      rules,
    )
    expect(v).toContain("a.yml:4")
    expect(v).toContain("bun-1.3.14-")
  })

  it("linha sem prefixo configurado → null", () => {
    expect(
      checkCacheKeyLine("a.yml", 4, `          key: other-\${{ hashFiles('x') }}`, rules),
    ).toBeNull()
  })
})

describe("checkLiteralBunLine", () => {
  it("linha com literal → mensagem; linha com referência → null; comentário → null", () => {
    expect(checkLiteralBunLine("a.yml", 2, `          bun-version: 1.3.14`)).toContain("1.3.14")
    expect(
      checkLiteralBunLine("a.yml", 2, `          bun-version: \${{ vars.BUN_VERSION }}`),
    ).toBeNull()
    expect(checkLiteralBunLine("a.yml", 2, `# bun-version: 1.3.14`)).toBeNull()
  })
})

// ── checkDockerfileBunLine ───────────────────────────────────────────────

describe("checkDockerfileBunLine", () => {
  it("npm install -g bun@1.2 literal → violação (o drift que o guard caça)", () => {
    const v = checkDockerfileBunLine(
      "Dockerfile",
      17,
      "RUN npm install -g bun@1.2 && bun install --frozen-lockfile",
    )
    expect(v).toContain("1.2")
    expect(v).toContain("Dockerfile:17")
  })

  it("FROM oven/bun:1 (tag flutuante) → violação", () => {
    const v = checkDockerfileBunLine("Dockerfile.worker", 9, "FROM oven/bun:1 AS deps")
    expect(v).toContain("1")
  })

  it("FROM oven/bun:1.3.14 (literal completo) → violação", () => {
    const v = checkDockerfileBunLine("Dockerfile.worker", 9, "FROM oven/bun:1.3.14 AS deps")
    expect(v).toContain("1.3.14")
  })

  it("bun@${BUN_VERSION} (padrão correto via ARG) → null", () => {
    expect(
      checkDockerfileBunLine("Dockerfile", 22, "RUN npm install -g bun@${BUN_VERSION}"),
    ).toBeNull()
  })

  it("curl bun-v${BUN_VERSION} (padrão correto do Dockerfile.ubuntu-bun) → null", () => {
    expect(
      checkDockerfileBunLine(
        "Dockerfile.ubuntu-bun",
        9,
        `RUN curl -fsSL -o /tmp/bun.zip \\` +
          `"https://github.com/oven-sh/bun/releases/download/bun-v\${BUN_VERSION}/bun-linux-x64.zip"`,
      ),
    ).toBeNull()
  })

  it("curl bun-v1.3.14 literal → violação (padrão de download regredido)", () => {
    const v = checkDockerfileBunLine(
      "Dockerfile.ubuntu-bun",
      9,
      `RUN curl -fsSL -o /tmp/bun.zip \\` +
        `"https://github.com/oven-sh/bun/releases/download/bun-v1.3.14/bun-linux-x64.zip"`,
    )
    expect(v).toContain("1.3.14")
    expect(v).toContain("Dockerfile.ubuntu-bun:9")
  })

  it("curl bun-v1.2 (versão curta) literal → violação", () => {
    const v = checkDockerfileBunLine(
      "Dockerfile.ubuntu-bun",
      9,
      `https://github.com/oven-sh/bun/releases/download/bun-v1.2/bun-linux-x64.zip`,
    )
    expect(v).toContain("1.2")
  })

  it("prosa com 'bun-vendor' NÃO casa o padrão curl (sem dígitos) → null", () => {
    expect(
      checkDockerfileBunLine("Dockerfile", 5, "RUN apt-get install -y bun-vendor-lib"),
    ).toBeNull()
  })

  it("FROM oven/bun:${BUN_VERSION} → null (fonte única)", () => {
    expect(
      checkDockerfileBunLine("Dockerfile.worker", 11, "FROM oven/bun:${BUN_VERSION} AS deps"),
    ).toBeNull()
  })

  it("FROM oven/bun:${BUN_VERSION}-slim → null (sufixo da tag via ARG)", () => {
    expect(
      checkDockerfileBunLine(
        "Dockerfile.realtime",
        9,
        "FROM oven/bun:${BUN_VERSION}-slim AS runner",
      ),
    ).toBeNull()
  })

  it("tag com DEFAULT do ARG (${BUN_VERSION:-x}) → null (edge do startsWith exato)", () => {
    expect(
      checkDockerfileBunLine("Dockerfile", 5, "FROM oven/bun:${BUN_VERSION:-1.3.14} AS runner"),
    ).toBeNull()
  })

  it("comentário com literal → null (ignorado)", () => {
    expect(checkDockerfileBunLine("Dockerfile", 1, "# bun@1.2 era drift")).toBeNull()
  })

  it("linha sem bun → null", () => {
    expect(checkDockerfileBunLine("Dockerfile", 1, "FROM node:22-alpine AS deps")).toBeNull()
  })
})

// ── checkDockerfiles ─────────────────────────────────────────────────────

describe("checkDockerfiles", () => {
  it("repo real: NENHUM Dockerfile da lista tem literal (invariante 13)", () => {
    const violations = checkDockerfiles(process.cwd())
    expect(violations).toEqual([])
  })

  it("lista DOCKERFILES cobre os 4 Dockerfiles que pinam/instalam bun", () => {
    expect(DOCKERFILES).toContain("Dockerfile")
    expect(DOCKERFILES).toContain("Dockerfile.worker")
    expect(DOCKERFILES).toContain("Dockerfile.ubuntu-bun")
    expect(DOCKERFILES).toContain("mini-services/realtime/Dockerfile")
  })
})

// ── checkNoForeignLockfiles ──────────────────────────────────────────────

describe("checkNoForeignLockfiles", () => {
  it("repo real: NENHUM lockfile npm/pnpm presente (invariante 14 — só bun.lock)", () => {
    const violations = checkNoForeignLockfiles(process.cwd())
    expect(violations).toEqual([])
  })

  it("FOREIGN_LOCKFILES cobre raiz + mini-services/realtime + pnpm-workspace", () => {
    expect(FOREIGN_LOCKFILES).toContain("package-lock.json")
    expect(FOREIGN_LOCKFILES).toContain("pnpm-lock.yaml")
    expect(FOREIGN_LOCKFILES).toContain("mini-services/realtime/package-lock.json")
    expect(FOREIGN_LOCKFILES).toContain("pnpm-workspace.yaml")
  })
})
