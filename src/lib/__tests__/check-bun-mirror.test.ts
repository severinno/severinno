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
  parseDiffAddedLines,
  parseDiffLines,
  checkStagedSetupBunCallSites,
  checkSetupBunCallSite,
  normalizeBunVersionValue,
  checkStagedCacheKeys,
  checkStagedLiterals,
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
  it("usa a referência da repository variable (não literal) para bun e prisma", () => {
    expect(DEFAULT_CACHE_KEY_RULES()).toEqual([
      { prefix: "bun", version: "${{ vars.BUN_VERSION }}" },
      { prefix: "prisma", version: "${{ vars.BUN_VERSION }}" },
    ])
  })

  it("é uma lista CONFIGURÁVEL — novas toolchains entram como { prefix, version }", () => {
    const rules = [
      { prefix: "bun", version: "${{ vars.BUN_VERSION }}" },
      { prefix: "prisma", version: "${{ vars.BUN_VERSION }}" },
      { prefix: "next", version: "15" },
    ]
    expect(rules).toHaveLength(3)
    expect(rules[2]).toEqual({ prefix: "next", version: "15" })
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

  it("diff vazio → mapa vazio", () => {
    expect(parseDiffAddedLines("")).toEqual(new Map())
  })
})

// ── parseDiffLines (parser rico: adicionadas + contexto) ────────────────

describe("parseDiffLines", () => {
  it("inclui linhas ADICIONADAS e de CONTEXTO com flag added", () => {
    const diff =
      `+++ b/.github/workflows/a.yml\n` +
      `@@ -1,3 +1,3 @@\n` +
      `-          removed: true\n` +
      `           context: true\n` +
      `+          added: true\n`
    const lines = parseDiffLines(diff).get(".github/workflows/a.yml")!
    expect(lines).toHaveLength(2)
    expect(lines[0]).toEqual({ lineNo: 1, content: "          context: true", added: false })
    expect(lines[1]).toEqual({ lineNo: 2, content: "          added: true", added: true })
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
})

// ── isValidGitRef / gitDiffWorkflows (validação de ref do --base) ───────

describe("isValidGitRef", () => {
  it("aceita refs normais (origin/main, main, v1.3.14)", () => {
    expect(isValidGitRef("origin/main")).toBe(true)
    expect(isValidGitRef("main")).toBe(true)
    expect(isValidGitRef("refs/tags/v1.3.14")).toBe(true)
  })

  it("rejeita metacharacters de shell e refs perigosas", () => {
    expect(isValidGitRef("main; rm -rf /")).toBe(false)
    expect(isValidGitRef("$(whoami)")).toBe(false)
    expect(isValidGitRef("-f")).toBe(false)
    expect(isValidGitRef("main..other")).toBe(false)
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
