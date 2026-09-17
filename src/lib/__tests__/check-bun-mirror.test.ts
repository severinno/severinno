/**
 * check-bun-mirror.test.ts
 *
 * Testes das funções PURAS do scripts/check-bun-mirror.mjs — guard da FONTE
 * ÚNICA da versão do Bun (repository variable vars.BUN_VERSION) + do mirror
 * GHCR (.github/workflows/sync-bun-mirror.yml).
 *
 * O guard garante 9 invariantes (o setup saiu do composite action para
 * `scripts/setup-bun-ci.sh`, chamado por `run:` — as checagens que eram do
 * action.yml recaem hoje sobre o script):
 *   1. O workflow do mirror existe (sync-bun-mirror.yml).
 *   2. env.BUN_VERSION do mirror referencia ${{ vars.BUN_VERSION }} (não literal).
 *   3. O SCRIPT do setup NÃO tem default literal de versão — a versão entra SÓ
 *      pelo ARGUMENTO (findBunLiteralDefaultInScript).
 *   4. O SCRIPT lê a versão do primeiro argumento posicional.
 *   5. O SCRIPT (tier 3) referencia o mirror OCI (hasGhcrMirrorRef).
 *   6. O Dockerfile.bun-mirror existe.
 *   7. Toda cache key bun-/prisma- referencia ${{ vars.BUN_VERSION }} (literal = violação).
 *   8. Nenhuma versão literal do Bun em workflows (bun-version: 1.3.14, etc —
 *      o formato do action EXTERNO continua caçado, para ele não voltar com
 *      versão pinada).
 *   9. O .actrc define BUN_VERSION (act local).
 *  15. Nenhum SCRIPT (`scripts/**` + hooks do `.husky/**`) carrega espelho
 *      LITERAL da versão do Bun nem da tag da imagem do runner.
 *  16. Nenhum COMPOSE com valor de BUN_VERSION que não derive (literal puro, ou
 *      default divergente do declarado nos espelhos).
 *
 * ATENÇÃO (esbuild): dentro de template literals, `${{` do GitHub Actions
 * precisa de escape (`\${{`) — senão o esbuild lê `${` como início de
 * interpolação e o arquivo nem compila (erro de transform no vitest).
 *
 * Cobre:
 *   - extractEnvVersion (parsing de YAML minimalista)
 *   - findBunLiteralDefaultInScript / hasGhcrMirrorRef (contrato do SCRIPT)
 *   - validateMirror (arquivos ausentes, literais, ref ausente)
 *   - checkCacheKeys (cache keys com literal vs. referência à variável)
 *   - checkNoLiteralBunVersion (caça literais em workflows)
 *   - checkActrc (arquivo local do act)
 *   - findBunLiteralInLine / checkScriptLiterals (invariante 15)
 *   - findComposeVersionLiteral / checkComposeVersionLiterals (invariante 16)
 *   - checkStagedSingleSourceLiterals (o recorte do commit das duas)
 */

import { describe, it, expect, afterAll } from "vitest"
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  extractEnvVersion,
  hasGhcrMirrorRef,
  findBunLiteralDefaultInScript,
  findBunLiteralInScript,
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
  checkStagedRemovedSetupBunCall,
  checkStagedRemovedCacheBlockFields,
  checkStagedRemovedLiterals,
  checkSetupBunRunLine,
  setupBunInvocationArgs,
  hasScriptVersionArg,
  hasPreinstalledMarker,
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
  findBunLiteralInLine,
  findComposeVersionLiteral,
  checkScriptLiterals,
  checkComposeVersionLiterals,
  checkStagedSingleSourceLiterals,
  singleSourceFiles,
  declaredBunVersion,
  isSingleSourcePath,
  COMPLETE_SEMVER_RE,
  COMPOSE_FILE_RE,
  SCRIPT_FILE_RE,
  SINGLE_SOURCE_PATHS,
} from "../../../scripts/check-bun-mirror.mjs"
import { mirrorFiles } from "../../../scripts/bun-version.mjs"

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

// ── findBunLiteralDefaultInScript (default literal NO SCRIPT = 2º ponto de verdade) ──

describe("findBunLiteralDefaultInScript", () => {
  it('aprova o script canônico (sem default: VERSION="${1:-}")', () => {
    expect(findBunLiteralDefaultInScript('VERSION="${1:-}"\n')).toBeNull()
  })

  it("detecta o default LITERAL na substituição — a regressão desta invariante", () => {
    expect(findBunLiteralDefaultInScript('VERSION="${1:-1.3.14}"\n')).toBe("1.3.14")
    expect(findBunLiteralDefaultInScript('VERSION="${1:-"1.3.14"}"\n')).toBe("1.3.14")
  })

  it("detecta atribuição direta com literal", () => {
    expect(findBunLiteralDefaultInScript("VERSION=1.3.14\n")).toBe("1.3.14")
    expect(findBunLiteralDefaultInScript('BUN_VERSION="1.4.0"\n')).toBe("1.4.0")
  })

  it("ignora COMENTÁRIO que cita a versão (prosa não é default)", () => {
    expect(findBunLiteralDefaultInScript('# ex.: VERSION="${1:-1.3.14}"\n')).toBeNull()
  })

  it("NÃO confunde a URL de download (bun-v<versão>) — isso é findBunLiteralInScript", () => {
    expect(
      findBunLiteralDefaultInScript('URL="https://.../bun-v1.3.14/bun-linux-x64.zip"\n'),
    ).toBeNull()
  })
})

// ── contrato do SCRIPT do setup (as três checagens que o validateMirror usa) ──
// Elas estavam importadas e SEM teste neste arquivo (só o import) — o contrato
// do script que substituiu o composite precisa da mesma cobertura que o
// action.yml tinha.

describe("contrato do script do setup (arg posicional, marcador tier-1, URL de download)", () => {
  it("hasScriptVersionArg exige a leitura do PRIMEIRO argumento posicional", () => {
    expect(hasScriptVersionArg('VERSION="${1:-}"\n')).toBe(true)
    expect(hasScriptVersionArg("VERSION=$1\n")).toBe(true)
    // Ler de uma variável de ambiente NÃO é o contrato: a versão chega pelo
    // argumento (a fonte única é resolvida no workflow, não no runner).
    expect(hasScriptVersionArg('VERSION="${BUN_VERSION}"\n')).toBe(false)
  })

  it("hasPreinstalledMarker exige o marcador que o guard periódico casa no log do act", () => {
    expect(
      hasPreinstalledMarker('echo "  ✅ Usando Bun pré-instalado: ${VERSION} (0s, sem download)"'),
    ).toBe(true)
    // Sem o marcador exato o guard periódico fica CEGO para a regressão do
    // tier-1 (ele casa essa string no log).
    expect(hasPreinstalledMarker('echo "bun pronto"')).toBe(false)
  })

  it("findBunLiteralInScript pega o literal da URL de download (bun-v<versão>)", () => {
    expect(
      findBunLiteralInScript('curl -fsSL "/releases/download/bun-v1.3.14/bun-linux-x64.zip"'),
    ).toBe("1.3.14")
    expect(findBunLiteralInScript('curl -fsSL "$BUN_RELEASE/bun-linux-x64.zip"')).toBeNull()
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

  // O setup é um SCRIPT chamado por run: — o ARGUMENTO da linha é o call
  // site. O contrato do composite (input bun-version) foi substituído.
  const OK_RUN = '        run: bash scripts/setup-bun-ci.sh "${{ vars.BUN_VERSION }}"' + "\n"

  it("chamada com a fonte única → zero violações", () => {
    const dir = makeWorkflowsDir({ "a.yml": OK_RUN })
    expect(checkSetupBunCallSites(dir)).toEqual([])
  })

  it("chamada SEM a versão → violação (fail-closed)", () => {
    const dir = makeWorkflowsDir({ "a.yml": "        run: bash scripts/setup-bun-ci.sh\n" })
    const v = checkSetupBunCallSites(dir)
    expect(v.length).toBe(1)
    expect(v[0]).toContain("a.yml:1")
    expect(v[0]).toContain("SEM a versão")
    expect(v[0]).toContain("vars.BUN_VERSION")
  })

  it("chamada com literal → violação (use a variável)", () => {
    const dir = makeWorkflowsDir({
      "a.yml": '        run: bash scripts/setup-bun-ci.sh "1.3.14"' + "\n",
    })
    const v = checkSetupBunCallSites(dir)
    expect(v.length).toBe(1)
    expect(v[0]).toContain("a.yml:1")
    expect(v[0]).toContain("1.3.14")
    expect(v[0]).toContain("fonte única")
  })

  it("chamada CAPTURADA com redirect → zero violações (lê o ARGUMENTO, não o fim da linha)", () => {
    // Regressão real: a primeira versão do guard lia o RESTO da linha e via
    // '${{ vars.BUN_VERSION }}" 2>&1)' como literal — pegou o próprio smoke.
    const dir = makeWorkflowsDir({
      "a.yml":
        '          OUT="$(bash scripts/setup-bun-ci.sh "${{ vars.BUN_VERSION }}" 2>&1)"' + "\n",
    })
    expect(checkSetupBunCallSites(dir)).toEqual([])
  })

  it("múltiplas chamadas: uma boa + uma ruim → só a má é reportada", () => {
    const dir = makeWorkflowsDir({
      "a.yml": OK_RUN + "\n" + '        run: bash scripts/setup-bun-ci.sh "1.3.14"' + "\n",
    })
    const v = checkSetupBunCallSites(dir)
    expect(v.length).toBe(1)
    expect(v[0]).toContain("a.yml:3")
  })

  it("ignora outros comandos e comentários em prosa", () => {
    const dir = makeWorkflowsDir({
      "a.yml": "        run: bun install --frozen-lockfile\n# usamos scripts/setup-bun-ci.sh\n",
    })
    expect(checkSetupBunCallSites(dir)).toEqual([])
  })

  it("diretório inexistente → zero violações", () => {
    expect(checkSetupBunCallSites(join(makeDir(), "nope"))).toEqual([])
  })

  it("escaneia arquivos .yaml (extensão alternativa)", () => {
    const dir = makeWorkflowsDir({ "a.yaml": "        run: bash scripts/setup-bun-ci.sh\n" })
    const v = checkSetupBunCallSites(dir)
    expect(v.length).toBe(1)
    expect(v[0]).toContain("a.yaml:1")
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
  const implName = "setup-bun-ci.sh"
  // Estado CONSENSO: o mirror referencia a variável e a IMPLEMENTAÇÃO (o
  // script que substituiu o composite) lê a versão do ARGUMENTO, puxa do
  // mirror OCI e mantém o marcador do tier-1.
  const wfContent = "env:" + "\n  BUN_VERSION: ${{ vars.BUN_VERSION }}" + "\n"
  const implContent = [
    "set -euo pipefail",
    'VERSION="${1:-}"',
    'echo "Usando Bun pré-instalado: ${FOUND} (0s, sem download)"',
    'MIRROR="ghcr.io/${GITHUB_REPOSITORY_OWNER}/bun:${VERSION}"',
    'docker pull "$MIRROR"',
    "",
  ].join("\n")

  function writeBoth(impl: string, wf = wfContent): string {
    const dir = makeDir()
    writeFileSync(join(dir, wfName), wf)
    writeFileSync(join(dir, implName), impl)
    return dir
  }

  it("repositório íntegro (mirror + script do repo) → zero violações", () => {
    const dir = writeBoth(implContent)
    expect(validateMirror(join(dir, wfName), join(dir, implName))).toEqual([])
  })

  it("workflow do mirror ausente → violação (fail-closed)", () => {
    const dir = makeDir()
    writeFileSync(join(dir, implName), implContent)
    const v = validateMirror(join(dir, wfName), join(dir, implName))
    expect(v.length).toBeGreaterThan(0)
    expect(v[0]).toContain("ausente")
  })

  it("implementação do setup ausente → violação", () => {
    const dir = makeDir()
    writeFileSync(join(dir, wfName), wfContent)
    const v = validateMirror(join(dir, wfName), join(dir, implName))
    expect(v.length).toBeGreaterThan(0)
    expect(v[0]).toContain("implementação do setup")
  })

  it("mirror com versão LITERAL → violação", () => {
    const dir = writeBoth(implContent, "env:" + "\n  BUN_VERSION: " + '"1.3.14"' + "\n")
    const v = validateMirror(join(dir, wfName), join(dir, implName))
    expect(v.some((x) => x.includes("LITERAL"))).toBe(true)
  })

  it("script que NÃO lê a versão do argumento → violação", () => {
    const dir = writeBoth(
      "set -euo pipefail" +
        "\n" +
        'MIRROR="ghcr.io/${GITHUB_REPOSITORY_OWNER}/bun:${VERSION}"' +
        "\n" +
        'docker pull "$MIRROR"',
    )
    const v = validateMirror(join(dir, wfName), join(dir, implName))
    expect(v.some((x) => x.includes("ARGUMENTO"))).toBe(true)
  })

  it("tier 3 sem ref ao mirror OCI → violação", () => {
    const dir = writeBoth(
      'VERSION="${1:-}"' +
        "\n" +
        'curl -fsSL "https://github.com/oven-sh/bun/releases/download/bun-v${VERSION}/bun.zip"',
    )
    const v = validateMirror(join(dir, wfName), join(dir, implName))
    expect(v.some((x) => x.includes("não referencia o mirror"))).toBe(true)
  })

  it("script SEM o marcador tier-1 → violação (o guard periódico ficaria cego)", () => {
    const dir = writeBoth(
      'VERSION="${1:-}"' +
        "\n" +
        'MIRROR="ghcr.io/${GITHUB_REPOSITORY_OWNER}/bun:${VERSION}"' +
        "\n" +
        'docker pull "$MIRROR"',
    )
    const v = validateMirror(join(dir, wfName), join(dir, implName))
    expect(v.some((x) => x.includes("marcador tier-1"))).toBe(true)
  })

  it("script com versão LITERAL → violação", () => {
    const dir = writeBoth(
      'VERSION="${1:-}"' +
        "\n" +
        'echo "Usando Bun pré-instalado: 1"' +
        "\n" +
        'curl -fsSL "https://github.com/oven-sh/bun/releases/download/bun-v1.3.14/bun.zip"',
    )
    const v = validateMirror(join(dir, wfName), join(dir, implName))
    expect(v.some((x) => x.includes("versão literal"))).toBe(true)
  })

  it("Dockerfile.bun-mirror ausente → violação (guard pega no PR)", () => {
    const dir = writeBoth(implContent)
    const v = validateMirror(
      join(dir, wfName),
      join(dir, implName),
      join(dir, "Dockerfile.bun-mirror"),
    )
    expect(v.some((x) => x.includes("Dockerfile do mirror ausente"))).toBe(true)
  })

  it("repositório íntegro com Dockerfile presente → zero violações", () => {
    const dir = writeBoth(implContent)
    writeFileSync(join(dir, "Dockerfile.bun-mirror"), "FROM scratch\nCOPY bun /bun\n")
    expect(
      validateMirror(join(dir, wfName), join(dir, implName), join(dir, "Dockerfile.bun-mirror")),
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

  it("a prosa de fim de linha não vira PATH (a régua única decide o código)", () => {
    // O QUE MUDA NO VEREDITO: a regra local só descartava a linha INTEIRA de
    // comentário, então um `# nota` no fim de um path entrava na comparação de
    // toolchain como se a pipeline declarasse aquele caminho — o guard acusava
    // um path inexistente.
    const { paths } = parseCacheBlock([
      `        with:`,
      `          path: |`,
      `            node_modules # harness local só`,
      `          key: bun-\${{ vars.BUN_VERSION }}-ok`,
    ])
    expect(paths).toEqual(["node_modules"])
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
      "a.yml": `      - uses: actions/checkout@v4\n        with:\n          fetch-depth: 0\n`,
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
  const diffDe = (linha: string) =>
    [
      "diff --git a/wf.yml b/wf.yml",
      "--- a/wf.yml",
      "+++ b/wf.yml",
      "@@ -1,1 +1,1 @@",
      "+" + linha,
      "",
    ].join("\n")

  it("chamada NOVA com a fonte única → zero violações", () => {
    expect(
      checkStagedSetupBunCallSites(
        diffDe('        run: bash scripts/setup-bun-ci.sh "${{ vars.BUN_VERSION }}"'),
      ),
    ).toEqual([])
  })

  it("chamada NOVA sem a versão → violação", () => {
    const v = checkStagedSetupBunCallSites(diffDe("        run: bash scripts/setup-bun-ci.sh"))
    expect(v.length).toBe(1)
    expect(v[0]).toContain("SEM a versão")
  })

  it("chamada NOVA com literal → violação", () => {
    const v = checkStagedSetupBunCallSites(
      diffDe('        run: bash scripts/setup-bun-ci.sh "1.3.14"'),
    )
    expect(v.length).toBe(1)
    expect(v[0]).toContain("1.3.14")
  })

  it("linha de CONTEXTO (não adicionada) também é avaliada", () => {
    const diff = [
      "diff --git a/wf.yml b/wf.yml",
      "--- a/wf.yml",
      "+++ b/wf.yml",
      "@@ -1,2 +1,2 @@",
      "-        run: echo antigo",
      "+        run: echo novo",
      " " + '        run: bash scripts/setup-bun-ci.sh "1.3.14"',
      "",
    ].join("\n")
    const v = checkStagedSetupBunCallSites(diff)
    expect(v.length).toBe(1)
    expect(v[0]).toContain("1.3.14")
  })

  it("arquivo não-.yml → zero violações", () => {
    const diff = [
      "diff --git a/x.txt b/x.txt",
      "--- a/x.txt",
      "+++ b/x.txt",
      "@@ -1,1 +1,1 @@",
      "+" + '        run: bash scripts/setup-bun-ci.sh "1.3.14"',
      "",
    ].join("\n")
    expect(checkStagedSetupBunCallSites(diff)).toEqual([])
  })

  it("diff vazio → zero violações", () => {
    expect(checkStagedSetupBunCallSites("")).toEqual([])
  })
})

// ── checkStagedRemovedSetupBunCall (REMOÇÃO da chamada de setup sobrevivente) ─

describe("checkStagedRemovedSetupBunCall", () => {
  const diffRemovendo = (extra: string) =>
    [
      "diff --git a/wf.yml b/wf.yml",
      "--- a/wf.yml",
      "+++ b/wf.yml",
      "@@ -1,2 +1,1 @@",
      "-" + '        run: bash scripts/setup-bun-ci.sh "${{ vars.BUN_VERSION }}"',
      "+        run: echo outro",
      extra,
      "",
    ].join("\n")

  it("chamada REMOVIDA sem substituta → violação (o job ficaria sem Bun)", () => {
    const v = checkStagedRemovedSetupBunCall(diffRemovendo(""))
    expect(v.length).toBe(1)
    expect(v[0]).toContain("REMOÇÃO da chamada")
    expect(v[0]).toContain("sem substituta")
  })

  it("chamada REMOVIDA com substituta no mesmo arquivo → zero violações (migração)", () => {
    const v = checkStagedRemovedSetupBunCall(
      diffRemovendo("+" + '        run: bash scripts/setup-bun-ci.sh "${{ vars.BUN_VERSION }}"'),
    )
    expect(v).toEqual([])
  })

  it("nada removido → zero violações", () => {
    const diff = [
      "diff --git a/wf.yml b/wf.yml",
      "--- a/wf.yml",
      "+++ b/wf.yml",
      "@@ -1,1 +1,2 @@",
      "+" + '        run: bash scripts/setup-bun-ci.sh "${{ vars.BUN_VERSION }}"',
      "+        run: echo ok",
      "",
    ].join("\n")
    expect(checkStagedRemovedSetupBunCall(diff)).toEqual([])
  })

  it("diff vazio → zero violações", () => {
    expect(checkStagedRemovedSetupBunCall("")).toEqual([])
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
})

// ── checkStagedRemovedLiterals (REMOÇÃO de literal + literal sobrevivente = migração incompleta)

describe("checkStagedRemovedLiterals", () => {
  it("literal REMOVIDO (key bun-1.3.14-...) + literal SOBREVIVENTE (bun-version) na janela → violação", () => {
    // O PR migrou a key literal para a fonte única, mas o literal de
    // BUN_VERSION no env SOBREVIVE como contexto — a migração ficou incompleta.
    const diff =
      `+++ b/.github/workflows/a.yml\n` +
      `@@ -1,8 +1,8 @@\n` +
      `       - run: bash scripts/setup-bun-ci.sh "\${{ vars.BUN_VERSION }}"\n` +
      `         env:\n` +
      `           BUN_VERSION: 1.3.14\n` +
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
    // O BUN_VERSION literal é CONTEXTO pré-existente, mas NENHUM literal foi
    // removido pelo diff — o PR não está migrando esta região.
    const diff =
      `+++ b/.github/workflows/a.yml\n` +
      `@@ -1,5 +1,5 @@\n` +
      `       - run: bash scripts/setup-bun-ci.sh "\${{ vars.BUN_VERSION }}"\n` +
      `         env:\n` +
      `           BUN_VERSION: 1.3.14\n` +
      `+          extra: true\n`
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

// ── checkSetupBunRunLine / normalizeBunVersionValue (nível de call site) ──
describe("checkSetupBunRunLine", () => {
  it("linha com a fonte única (entre aspas) → null", () => {
    expect(
      checkSetupBunRunLine(
        "a.yml",
        1,
        '        run: bash scripts/setup-bun-ci.sh "${{ vars.BUN_VERSION }}"',
      ),
    ).toBeNull()
  })

  it("linha SEM o script → null (não é call site)", () => {
    expect(
      checkSetupBunRunLine("a.yml", 1, "        run: bun install --frozen-lockfile"),
    ).toBeNull()
  })

  it("linha com o script SEM versão → mensagem apontando a ausência", () => {
    const v = checkSetupBunRunLine("a.yml", 7, "        run: bash scripts/setup-bun-ci.sh")
    expect(v).toContain("a.yml:7")
    expect(v).toContain("SEM a versão")
  })

  it("linha com literal → mensagem apontando o literal", () => {
    const v = checkSetupBunRunLine("a.yml", 3, '        run: bash scripts/setup-bun-ci.sh "1.3.14"')
    expect(v).toContain("1.3.14")
    expect(v).toContain("fonte única")
  })

  it("ignora o que vem DEPOIS do argumento (redirect, # nota)", () => {
    expect(
      checkSetupBunRunLine(
        "a.yml",
        1,
        '          OUT="$(bash scripts/setup-bun-ci.sh "${{ vars.BUN_VERSION }}" 2>&1)"',
      ),
    ).toBeNull()
    expect(
      checkSetupBunRunLine(
        "a.yml",
        2,
        '        run: bash scripts/setup-bun-ci.sh "${{ vars.BUN_VERSION }}" # nota',
      ),
    ).toBeNull()
  })

  it("MENÇÃO em prosa (echo de resumo do job) → null (não é call site)", () => {
    // Regressão real: o guard acusava o echo do job `summary` de ter uma
    // "versão (cached)." — exigir a variável de um TEXTO é falso positivo.
    expect(
      checkSetupBunRunLine(
        "a.yml",
        264,
        '        run: echo "✅ All workflows use scripts/setup-bun-ci.sh (cached)."',
      ),
    ).toBeNull()
    expect(checkSetupBunRunLine("a.yml", 1, "        # veja scripts/setup-bun-ci.sh")).toBeNull()
  })

  it("chamada REAL continua sendo violação, mesmo com caminho relativo ou cadeia", () => {
    expect(
      checkSetupBunRunLine("a.yml", 1, "        run: ./scripts/setup-bun-ci.sh 1.3.14"),
    ).toContain("1.3.14")
    expect(
      checkSetupBunRunLine("a.yml", 1, "        run: cd x && bash scripts/setup-bun-ci.sh 1.3.14"),
    ).toContain("1.3.14")
    // Nome nu (sem `scripts/`): o escape antigo do `includes(SETUP_BUN_SCRIPT)`
    // deixaria esta chamada passar em silêncio.
    expect(checkSetupBunRunLine("a.yml", 1, "        run: bash setup-bun-ci.sh 1.3.14")).toContain(
      "1.3.14",
    )
  })
})

describe("setupBunInvocationArgs", () => {
  it("devolve o ARGUMENTO quando o script está em posição de comando", () => {
    expect(
      setupBunInvocationArgs('        run: bash scripts/setup-bun-ci.sh "${{ vars.BUN_VERSION }}"'),
    ).toBe(' "${{ vars.BUN_VERSION }}"')
    expect(setupBunInvocationArgs("        run: ./scripts/setup-bun-ci.sh")).toBe("")
  })

  it("devolve null para menção em prosa", () => {
    expect(
      setupBunInvocationArgs('        run: echo "use scripts/setup-bun-ci.sh (cached)."'),
    ).toBeNull()
    expect(setupBunInvocationArgs("linha sem o script")).toBeNull()
  })

  it("reconhece as formas reais de invocação (capturada, bash -lc, nome nu)", () => {
    expect(setupBunInvocationArgs('OUT="$(bash scripts/setup-bun-ci.sh "$V" 2>&1)"')).toContain(
      '"$V"',
    )
    expect(
      setupBunInvocationArgs('          bash -lc "bash scripts/setup-bun-ci.sh "$V""'),
    ).toContain('"$V"')
    expect(setupBunInvocationArgs("bash setup-bun-ci.sh 1.3.14")).toBe(" 1.3.14")
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

  it("literal SÓ na prosa de fim de linha → null (antes era violação)", () => {
    // O QUE MUDA NO VEREDITO com a régua única: a regra local só olhava o
    // INÍCIO da linha, então a prosa de um `#` no fim valia como declaração do
    // workflow — o guard acusava uma versão literal que a pipeline não usa. A
    // régua da casa (comentário de fim de linha fora) já era a dos outros
    // guards; aqui ela virou a mesma.
    expect(
      checkLiteralBunLine(
        "a.yml",
        2,
        `          bun-version: \${{ vars.BUN_VERSION }} # legado: 1.3.14`,
      ),
    ).toBeNull()
    // E o literal no CÓDIGO da mesma linha continua sendo violação (a régua
    // tira a prosa, não a linha).
    expect(checkLiteralBunLine("a.yml", 3, `          bun-version: 1.3.14 # nota`)).toContain(
      "1.3.14",
    )
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

// ── Dockerfile.ubuntu-bun: o contrato da IMAGEM DO RUNNER ────────────────

/**
 * A imagem do runner não precisa só embarcar o Bun — ela precisa rodar os
 * guards da PRÓPRIA forja por inteiro. O job `guards` roda
 * `check:registry-source`, cuja INVARIANTE 7 renderiza o compose da forja com
 * o docker do job para provar que a interpolação resolve para a versão da
 * variável. Sem o plugin `compose` esse render fica INDETERMINADO — e, dentro
 * de um job verde, a invariante deixa de ser verificada em silêncio.
 *
 * Medido em 09/2026: a base `catthehacker/ubuntu:act-latest` JÁ entrega o
 * plugin (`/usr/libexec/docker/cli-plugins/docker-compose`). O que faltava não
 * era o binário — era o CONTRATO: a base é uma tag FLUTUANTE, e o projeto dela
 * já fechou como "not planned" o pedido de incluir o plugin
 * (catthehacker/docker_images#70). Estes testes prendem a asserção que
 * transforma o acidente em contrato, e prendem a ORDEM dela.
 */
describe("Dockerfile.ubuntu-bun — contrato da imagem do runner", () => {
  const dockerfile = readFileSync(join(process.cwd(), "Dockerfile.ubuntu-bun"), "utf8")

  it("exige o plugin `compose` no BUILD (a invariante 7 depende dele)", () => {
    expect(dockerfile).toContain("docker compose version")
    // A falha tem de NOMEAR a consequência, senão o próximo leitor remove a
    // asserção achando que é ruído de build.
    expect(dockerfile).toContain("INDETERMINADA dentro do runner da forja")
    expect(dockerfile).toContain("FONTE ÚNICA")
  })

  it("reconfere o Bun DEPOIS do compose — o tier-1 tem de sair INTACTO", () => {
    // O risco real de "embarcar mais uma coisa" na imagem é mexer no PATH e
    // desligar o fast path de 0s sem sintoma. Por isso a asserção do Bun vem
    // DEPOIS, e checa também DE ONDE ele é resolvido.
    const atCompose = dockerfile.indexOf("if ! docker compose version")
    const atBun = dockerfile.lastIndexOf('test "$(bun --version)" = "${BUN_VERSION}"')
    expect(atCompose).toBeGreaterThan(-1)
    expect(atBun).toBeGreaterThan(atCompose)
    expect(dockerfile).toContain('test "$(command -v bun)" = "/usr/local/bin/bun"')
  })

  it("NÃO instala o plugin com versão literal (seria um segundo ponto de verdade)", () => {
    // Enquanto a base entrega o plugin, o certo é VERIFICAR. Se um dia ela
    // parar, a versão tem de vir de uma fonte única (repo variable), nunca de
    // um literal — a mesma regra do BUN_VERSION.
    expect(dockerfile).not.toMatch(/docker-compose-plugin=[0-9]/)
    expect(dockerfile).not.toMatch(/docker\/compose\/releases\/download\/v[0-9]/)
  })
})

// ── Invariantes 15/16: literais FORA dos workflows ───────────────────────
//
// A classe que a auditoria de espelhos abriu: o workflow já era caçado, mas o
// SCRIPT e o COMPOSE não — e o sintoma deles é o pior possível, porque nada
// fica vermelho. O script continua funcionando (só com a versão antiga); o
// compose continua subindo (só com o build arg errado).

describe("as formas e o escopo das invariantes 15/16", () => {
  it("COMPLETE_SEMVER_RE: X.Y.Z completo sim, sentinela e versão curta não", () => {
    // É a régua que separa "afirmação de versão" de "valor falso declarado".
    expect(COMPLETE_SEMVER_RE.test("1.3.14")).toBe(true)
    expect(COMPLETE_SEMVER_RE.test("9.9.9-sentinel")).toBe(false)
    expect(COMPLETE_SEMVER_RE.test("1.3")).toBe(false)
    expect(COMPLETE_SEMVER_RE.test("24.19.0")).toBe(true) // vizinho sem bun: quem filtra é a menção
  })

  it("SCRIPT_FILE_RE / COMPOSE_FILE_RE / isSingleSourcePath: o escopo é o declarado", () => {
    expect(SCRIPT_FILE_RE.test("scripts/check-bun-mirror.mjs")).toBe(true)
    expect(SCRIPT_FILE_RE.test("scripts/x.sh")).toBe(true)
    expect(SCRIPT_FILE_RE.test(".husky/pre-commit")).toBe(true)
    expect(SCRIPT_FILE_RE.test(".husky/_/husky.sh")).toBe(false) // runtime do husky
    expect(COMPOSE_FILE_RE.test("docker-compose.prod.yml")).toBe(true)
    expect(COMPOSE_FILE_RE.test("deploy/docker-compose.gitea.yml")).toBe(true)
    expect(COMPOSE_FILE_RE.test("docker-compose.staging.yaml")).toBe(true)
    expect(COMPOSE_FILE_RE.test(".woodpecker.yml")).toBe(false)
    expect(isSingleSourcePath("scripts/x.mjs")).toBe(true)
    expect(isSingleSourcePath("docker-compose.yml")).toBe(true)
    expect(isSingleSourcePath("package.json")).toBe(false)
    expect(isSingleSourcePath("src/index.ts")).toBe(false)
  })

  it("SINGLE_SOURCE_PATHS cobre os dois diretórios e os composes (glob, não lista à mão)", () => {
    // O pathspec do --staged sai daqui: perder um caminho aqui seria o modo
    // silencioso de o recorte do commit deixar de ver uma classe inteira.
    expect(SINGLE_SOURCE_PATHS).toContain("scripts")
    expect(SINGLE_SOURCE_PATHS).toContain(".husky")
    expect(SINGLE_SOURCE_PATHS.some((p) => p.startsWith("docker-compose*"))).toBe(true)
    expect(SINGLE_SOURCE_PATHS.some((p) => p.startsWith("deploy/docker-compose*"))).toBe(true)
  })
})

describe("findComposeVersionLiteral (invariante 16)", () => {
  const declared = "1.3.14"

  it("literal puro → violação; default igual ao declarado → ok", () => {
    expect(findComposeVersionLiteral('BUN_VERSION: "1.4.0"', declared)).toEqual({
      kind: "literal",
      value: "1.4.0",
    })
    expect(findComposeVersionLiteral("BUN_VERSION: ${BUN_VERSION:-1.3.14}", declared)).toBeNull()
  })

  it("default divergente → violação; forma de variável e comentário → ok", () => {
    expect(findComposeVersionLiteral("BUN_VERSION: ${BUN_VERSION:-1.4.0}", declared)).toEqual({
      kind: "default",
      value: "1.4.0",
    })
    expect(findComposeVersionLiteral("BUN_VERSION: ${BUN_VERSION}", declared)).toBeNull()
    expect(findComposeVersionLiteral("L=ubuntu-bun:${BUN_VERSION}", declared)).toBeNull()
    expect(findComposeVersionLiteral("# BUN_VERSION: 1.4.0", declared)).toBeNull()
    expect(findComposeVersionLiteral("IMAGE_REGISTRY: ghcr.io", declared)).toBeNull()
  })
})

describe("findBunLiteralInLine (invariante 15)", () => {
  it("pega a versão PREFIXADA pelo nome: cache key, npm, release e imagem", () => {
    expect(findBunLiteralInLine("key: bun-1.3.14-hash")?.hit).toBe("bun-1.3.14")
    expect(findBunLiteralInLine("RUN npm install -g bun@1.2.3")?.hit).toBe("bun@1.2.3")
    expect(findBunLiteralInLine("curl .../download/bun-v1.3.14/bun.zip")?.hit).toBe("bun-v1.3.14")
    expect(findBunLiteralInLine("FROM oven/bun:1.3.14")?.hit).toBe("bun:1.3.14")
    // A TAG da imagem do runner — o alvo que a auditoria encontrou em compose.
    expect(findBunLiteralInLine("IMG=ghcr.io/x/ubuntu-bun:1.3.14")?.hit).toBe("bun:1.3.14")
  })

  it("pega o semver COMPLETO emparelhado com o nome do Bun (o fallback que envelhece)", () => {
    expect(findBunLiteralInLine('const v = process.env.BUN_VERSION || "1.3.14"')?.hit).toBe(
      "1.3.14",
    )
    expect(findBunLiteralInLine('ACTRC_BUN="${ACTRC_BUN:-1.3.14}"')?.hit).toBe("1.3.14")
    expect(findBunLiteralInLine('bunVersion = "1.3.14"')?.hit).toBe("1.3.14")
  })

  it("NÃO pega comentário, SENTINELA, versão via ARG nem linha sem bun", () => {
    // Comentário é onde o comportamento aparece como exemplo.
    expect(findBunLiteralInLine("# ex.: bun-v1.3.14")).toBeNull()
    expect(findBunLiteralInLine("// x = 1.3.14 com bun")).toBeNull()
    expect(findBunLiteralInLine(" * bun 1.3.14")).toBeNull()
    // O escape hatch declarado para fixtures: o sufixo prova que não é versão.
    expect(findBunLiteralInLine('BUN_VERSION: "9.9.9-sentinel"')).toBeNull()
    // Forma derivada e vizinhos sem relação.
    expect(findBunLiteralInLine('MIRROR="ghcr.io/x/bun:${BUN_VERSION}"')).toBeNull()
    expect(findBunLiteralInLine('echo "Docker version 29.7.2"')).toBeNull()
  })
})

describe("checkScriptLiterals (invariante 15)", () => {
  it("flagra o literal num script, nomeando ARQUIVO e LINHA", () => {
    const dir = makeDir()
    mkdirSync(join(dir, "scripts"))
    writeFileSync(join(dir, "scripts/x.sh"), 'set -eu\nVERSION="${BUN_VERSION:-1.3.14}"\n')
    const violations = checkScriptLiterals(dir)
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain("scripts/x.sh:2")
    expect(violations[0]).toContain("1.3.14")
    // A mensagem tem de apontar as DUAS saídas (derivar ou sentinela) — uma
    // violação sem remédio é a que a equipe aprende a ignorar.
    expect(violations[0]).toContain("bun-version.mjs")
    expect(violations[0]).toContain("9.9.9-sentinel")
  })

  it("pega o literal nos HOOKS do .husky/ (sem extensão) e ignora o runtime `_`", () => {
    const dir = makeDir()
    mkdirSync(join(dir, ".husky", "_"), { recursive: true })
    writeFileSync(join(dir, ".husky", "pre-commit"), 'BUN_VERSION="1.3.14" bun test\n')
    writeFileSync(join(dir, ".husky", "_", "husky.sh"), "BUN_VERSION=1.3.14\n")
    const violations = checkScriptLiterals(dir)
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain(".husky/pre-commit:1")
    expect(violations.join("\n")).not.toContain("husky.sh")
  })

  it("script que DERIVA da fonte única não é violação", () => {
    const dir = makeDir()
    mkdirSync(join(dir, "scripts"))
    writeFileSync(
      join(dir, "scripts/x.mjs"),
      "import { requireBunVersion } from './bun-version.mjs'\n",
    )
    expect(checkScriptLiterals(dir)).toEqual([])
  })
})

describe("checkComposeVersionLiterals (invariante 16)", () => {
  const declared = "1.3.14"

  it("literal PURO é violação (não é espelho, é um segundo valor)", () => {
    const dir = makeDir()
    writeFileSync(join(dir, "docker-compose.a.yml"), '        BUN_VERSION: "1.4.0"\n')
    const violations = checkComposeVersionLiterals(dir, declared)
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain("docker-compose.a.yml:1")
    expect(violations[0]).toContain("1.4.0")
    expect(violations[0]).toContain("SEGUNDO valor")
  })

  it("default DIVERGENTE do declarado é violação; IGUAL passa", () => {
    const dir = makeDir()
    writeFileSync(join(dir, "docker-compose.a.yml"), "BUN_VERSION: ${BUN_VERSION:-1.4.0}\n")
    writeFileSync(join(dir, "docker-compose.b.yml"), "BUN_VERSION: ${BUN_VERSION:-1.3.14}\n")
    const violations = checkComposeVersionLiterals(dir, declared)
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain("docker-compose.a.yml")
    expect(violations[0]).toContain("diverge do declarado")
  })

  it("a forma de VARIÁVEL pura passa, e `deploy/` está no escopo", () => {
    const dir = makeDir()
    mkdirSync(join(dir, "deploy"))
    writeFileSync(join(dir, "docker-compose.yml"), "BUN_VERSION: ${BUN_VERSION}\n")
    writeFileSync(join(dir, "deploy", "docker-compose.gitea.yml"), "L=ubuntu-bun:${BUN_VERSION}\n")
    expect(checkComposeVersionLiterals(dir, declared)).toEqual([])
  })
})

describe("a varredura 15/16 no REPOSITÓRIO real", () => {
  it("nenhum literal nos scripts nem nos composes (a auditoria fecha verde)", () => {
    expect(checkScriptLiterals(process.cwd())).toEqual([])
    expect(checkComposeVersionLiterals(process.cwd())).toEqual([])
  })

  it("o escopo é o declarado: scripts + hooks + composes (e nada mais)", () => {
    const alvos = singleSourceFiles(process.cwd())
    expect(alvos).toContain(".husky/pre-commit")
    expect(alvos).toContain("scripts/check-bun-mirror.mjs")
    expect(alvos).toContain("scripts/bun-version.mjs")
    expect(alvos).toContain("docker-compose.prod.yml")
    expect(alvos).not.toContain("package.json")
    expect(alvos.some((f) => f.startsWith(".husky/_/"))).toBe(false)
  })

  it("o valor declarado é lido dos espelhos (a mesma lista do resolvedor)", () => {
    expect(declaredBunVersion(process.cwd())).toBe("1.3.14")
    expect(mirrorFiles()).toEqual([".actrc", "deploy/env.gitea.example"])
  })
})

describe("o recorte --staged das invariantes 15/16", () => {
  it("julga as linhas ADICIONADAS de um script", () => {
    const diff = [
      "diff --git a/scripts/x.sh b/scripts/x.sh",
      "--- /dev/null",
      "+++ b/scripts/x.sh",
      "@@ -0,0 +1,2 @@",
      '+BUN_VERSION="1.3.14"',
      "+# bun 1.3.14 (comentário: fora)",
    ].join("\n")
    const violations = checkStagedSingleSourceLiterals(diff, "1.3.14")
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain("scripts/x.sh:1")
  })

  it("julga um compose adicionado e ignora workflow (escopo próprio)", () => {
    const diff = [
      "diff --git a/docker-compose.novo.yml b/docker-compose.novo.yml",
      "+++ b/docker-compose.novo.yml",
      "@@ -0,0 +1 @@",
      '+        BUN_VERSION: "9.9.14"',
      "diff --git a/.github/workflows/x.yml b/.github/workflows/x.yml",
      "+++ b/.github/workflows/x.yml",
      "@@ -0,0 +1 @@",
      "+      - run: bun-version: 1.3.14",
    ].join("\n")
    const violations = checkStagedSingleSourceLiterals(diff, "1.3.14")
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain("docker-compose.novo.yml:1")
  })
})
