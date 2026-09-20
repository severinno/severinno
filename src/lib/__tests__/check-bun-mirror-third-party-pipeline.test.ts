/**
 * check-bun-mirror-third-party-pipeline.test.ts
 *
 * Testes da INVARIANTE 19 do scripts/check-bun-mirror.mjs: os USOS da versão do
 * Bun num pipeline de CI de TERCEIRO versionado (`.woodpecker.yml`).
 *
 * É a classe que as invariantes 15/16 (scripts e composes) e 18 (a cadeia de
 * build do repositório) deixavam de fora — por não ser script, nem compose, nem
 * Dockerfile. Nesse arquivo a versão aparece como TAG DE IMAGEM
 * (`image: oven/bun:<v>`, uma vez por passo) e como BUILD ARG
 * (`BUN_VERSION=<v>`), e foi por isso que ele acabou com uma ISENÇÃO escrita no
 * próprio cabeçalho ("arquivado — não copie os literais daqui"): fora da
 * varredura, os treze usos envelheceram SETE versões atrás do repositório
 * (1.4.0 contra o 1.3.14 declarado) sem que nada ficasse vermelho.
 *
 * A régua é a MESMA da invariante 16 (comparação por VALOR):
 *   - um valor LITERAL tem de ser o DECLARADO;
 *   - `${BUN_VERSION}` é DERIVAÇÃO (nada a comparar, passa);
 *   - `${BUN_VERSION:-<x>}` passa quando o fallback é o declarado.
 *
 * A diferença que o FORMATO impõe, e que fica provada aqui: num `image:` de
 * pipeline de terceiro o literal IGUAL ao declarado PASSA (não existe a
 * variável do operador que a 16 protege — o valor tem de estar escrito); o que
 * não pode é ser OUTRO número.
 *
 * Cobre: findPipelineVersionUse (as formas e os não-usos), a enumeração
 * (raiz + `.woodpecker/`, symlink), checkThirdPartyPipelineVersions (por valor,
 * fail-closed na leitura, ausência de espelho) e o recorte
 * checkStagedThirdPartyPipelineVersions — mais o REPOSITÓRIO REAL como PISO:
 * hoje zero violações, os treze usos no valor declarado, e um único número
 * trocado derruba o guard NOMEANDO arquivo e linha.
 *
 * ATENÇÃO (esbuild): dentro de template literals, `${` precisa de escape
 * (`\${`) — senão o esbuild lê como interpolação e o arquivo nem compila.
 *
 * Usage:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/check-bun-mirror-third-party-pipeline.test.ts
 */

import { describe, it, expect, afterAll } from "vitest"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  THIRD_PARTY_CI_CANDIDATES,
  THIRD_PARTY_PIPELINE_PATHS,
  THIRD_PARTY_PIPELINE_RE,
  THIRD_PARTY_PIPELINE_TYPES,
  checkStagedThirdPartyPipelineVersions,
  checkThirdPartyPipelineVersions,
  declaredBunVersion,
  findPipelineVersionUse,
  isSingleSourcePath,
  thirdPartyPipelineCoverage,
  thirdPartyPipelineFiles,
} from "../../../scripts/check-bun-mirror.mjs"

const DECLARED = "1.3.14"
/** O espelho que dá o valor declarado — sem ele não há o que comparar. */
const ACTRC = `# espelho da variável\n--var BUN_VERSION=${DECLARED}\n`

const ROOT_TMP = mkdtempSync(join(tmpdir(), "cbun-third-party-"))
afterAll(() => rmSync(ROOT_TMP, { recursive: true, force: true }))

/** Um repo de fixture com os arquivos que a régua lê. */
function makeFixture(name: string, files: Record<string, string>): string {
  const dir = join(ROOT_TMP, name)
  mkdirSync(dir, { recursive: true })
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel)
    mkdirSync(join(abs, ".."), { recursive: true })
    writeFileSync(abs, content, "utf8")
  }
  return dir
}

/** Um diff mínimo no formato que o guard lê (`+++ b/<arquivo>` + hunk). */
function diffOf(file: string, startLine: number, added: string[]): string {
  return [
    `diff --git a/${file} b/${file}`,
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -1,0 +${startLine},${added.length} @@`,
    ...added.map((l) => `+${l}`),
    "",
  ].join("\n")
}

// ── findPipelineVersionUse — o extrator ──────────────────────────────────

describe("findPipelineVersionUse — o uso da versão numa linha do pipeline", () => {
  it("a TAG DE IMAGEM literal é um uso (com e sem aspas)", () => {
    expect(findPipelineVersionUse("    image: oven/bun:1.4.0")).toEqual({
      field: "imagem",
      kind: "literal",
      value: "1.4.0",
    })
    expect(findPipelineVersionUse('    image: "oven/bun:1.4.0"')).toEqual({
      field: "imagem",
      kind: "literal",
      value: "1.4.0",
    })
  })

  it("o BUILD ARG literal é um uso (a forma de `build_args:`)", () => {
    expect(findPipelineVersionUse("        - BUN_VERSION=1.4.0")).toEqual({
      field: "build-arg",
      kind: "literal",
      value: "1.4.0",
    })
  })

  it("`${BUN_VERSION}` é DERIVAÇÃO: não carrega número próprio", () => {
    expect(findPipelineVersionUse("    image: oven/bun:${BUN_VERSION}")).toEqual({
      field: "imagem",
      kind: "derived",
      value: null,
    })
  })

  it("`${BUN_VERSION:-<x>}` é FALLBACK: o valor é o que a invariante compara", () => {
    expect(findPipelineVersionUse("    image: oven/bun:${BUN_VERSION:-1.4.0}")).toEqual({
      field: "imagem",
      kind: "default",
      value: "1.4.0",
    })
    expect(findPipelineVersionUse("        - BUN_VERSION=${BUN_VERSION:-1.4.0}")).toEqual({
      field: "build-arg",
      kind: "default",
      value: "1.4.0",
    })
  })

  it("COMENTÁRIO fica fora — inclusive o passo COMENTADO e a prosa que nomeia a forma", () => {
    // As três formas de comentário que o arquivo real tem (e que, sem a
    // exclusão, virariam uso): a prosa que explica, a prosa que nomeia a FORMA
    // (`BUN_VERSION=<v>`, `image: oven/bun:<v>`) e o passo comentado.
    expect(
      findPipelineVersionUse("# As imagens `oven/bun:1.4.0` deste rascunho não são um pin."),
    ).toBeNull()
    expect(findPipelineVersionUse("#   - BUN_VERSION=<v>   ← a forma esperada")).toBeNull()
    expect(findPipelineVersionUse("#    image: oven/bun:1.4.0")).toBeNull()
    expect(findPipelineVersionUse("#        - BUN_VERSION=1.4.0")).toBeNull()
  })

  it("o NOME solto não afirma versão nenhuma (um `ARG BUN_VERSION` sem valor)", () => {
    expect(findPipelineVersionUse("ARG BUN_VERSION")).toBeNull()
    expect(findPipelineVersionUse("      BUN_VERSION:")).toBeNull()
    expect(findPipelineVersionUse('        - "BUN_VERSION"')).toBeNull()
  })

  it("linha alheia ao Bun não é uso (o extrator não é um caça-semver)", () => {
    expect(findPipelineVersionUse("    image: plugins/docker")).toBeNull()
    expect(findPipelineVersionUse("      - redis:7-alpine")).toBeNull()
    expect(findPipelineVersionUse("        - actions/checkout@v4")).toBeNull()
  })
})

// ── a enumeração e o escopo ──────────────────────────────────────────────

describe("thirdPartyPipelineFiles — o alvo é o pipeline de terceiro", () => {
  it("pega a raiz e a versão em pasta (`.woodpecker/*.yml`)", () => {
    const dir = makeFixture("enum", {
      ".woodpecker.yml": "pipeline: {}\n",
      ".woodpecker/steps.yml": "pipeline: {}\n",
      ".woodpecker.yml.bak": "pipeline: {}\n",
      "docker-compose.yml": "services: {}\n",
    })
    expect(thirdPartyPipelineFiles(dir)).toEqual([".woodpecker.yml", ".woodpecker/steps.yml"])
  })

  it("o pathspec do `--staged` cobre as duas formas (glob, não lista à mão)", () => {
    expect(THIRD_PARTY_PIPELINE_PATHS.some((p) => p.startsWith(".woodpecker*"))).toBe(true)
    expect(THIRD_PARTY_PIPELINE_PATHS).toContain(".woodpecker/*.yml")
  })

  it("o escopo NÃO se confunde com o dos scripts/composes (régua diferente)", () => {
    // A 15/16 RECUSA qualquer literal (num compose a variável do operador
    // existe e seria ignorada); a 19 aceita o literal IGUAL ao declarado,
    // porque num `image:` o valor tem de estar escrito. Escopos separados de
    // propósito: `.woodpecker.yml` não é alvo de `isSingleSourcePath`.
    expect(THIRD_PARTY_PIPELINE_RE.test(".woodpecker.yml")).toBe(true)
    expect(isSingleSourcePath(".woodpecker.yml")).toBe(false)
  })
})

// ── checkThirdPartyPipelineVersions — o julgamento por valor ─────────────

describe("checkThirdPartyPipelineVersions — o valor tem de ser o declarado", () => {
  it("o literal IGUAL ao declarado passa (o formato exige valor escrito)", () => {
    const dir = makeFixture("igual", {
      ".actrc": ACTRC,
      ".woodpecker.yml": "pipeline:\n  lint:\n    image: oven/bun:1.3.14\n",
    })
    expect(checkThirdPartyPipelineVersions(dir)).toEqual([])
  })

  it("um OUTRO número reprova, citando o valor usado, o declarado e a linha", () => {
    const dir = makeFixture("divergente", {
      ".actrc": ACTRC,
      ".woodpecker.yml": "pipeline:\n  lint:\n    image: oven/bun:1.4.0\n",
    })
    const v = checkThirdPartyPipelineVersions(dir)
    expect(v).toHaveLength(1)
    expect(v[0]).toContain(".woodpecker.yml:3")
    expect(v[0]).toContain("1.4.0")
    expect(v[0]).toContain("1.3.14")
    expect(v[0]).toContain(".actrc")
  })

  it("o build arg reprova pelo mesmo motivo (e o `build_args:` inteiro é julgado)", () => {
    const dir = makeFixture("buildarg", {
      ".actrc": ACTRC,
      ".woodpecker.yml": [
        "deploy:",
        "  docker-build:",
        "    settings:",
        "      build_args:",
        "        - BUN_VERSION=1.4.0",
        "        - OUTRA=1.4.0",
        "",
      ].join("\n"),
    })
    const v = checkThirdPartyPipelineVersions(dir)
    expect(v).toHaveLength(1)
    expect(v[0]).toContain(".woodpecker.yml:5")
    expect(v[0]).toContain("build arg")
  })

  it("a DERIVAÇÃO passa e o FALLBACK é comparado por valor (como nos composes)", () => {
    const ok = makeFixture("derivada", {
      ".actrc": ACTRC,
      ".woodpecker.yml": "steps:\n  - image: oven/bun:${BUN_VERSION}\n",
    })
    expect(checkThirdPartyPipelineVersions(ok)).toEqual([])

    const comFallbackIgual = makeFixture("fallback-igual", {
      ".actrc": ACTRC,
      ".woodpecker.yml": "steps:\n  - image: oven/bun:${BUN_VERSION:-1.3.14}\n",
    })
    expect(checkThirdPartyPipelineVersions(comFallbackIgual)).toEqual([])

    const comFallbackVelho = makeFixture("fallback-velho", {
      ".actrc": ACTRC,
      ".woodpecker.yml": "steps:\n  - image: oven/bun:${BUN_VERSION:-1.4.0}\n",
    })
    const v = checkThirdPartyPipelineVersions(comFallbackVelho)
    expect(v).toHaveLength(1)
    expect(v[0]).toContain("fallback")
    expect(v[0]).toContain("1.3.14")
  })

  it("o comentário do cabeçalho não é julgado (a prosa e o passo COMENTADO ficam fora)", () => {
    const dir = makeFixture("comentario", {
      ".actrc": ACTRC,
      ".woodpecker.yml": [
        "# As imagens `oven/bun:1.4.0` deste rascunho não são um pin.",
        "# A tag `oven/bun:<v>` e os `BUN_VERSION=<v>` de build_args dizem o declarado.",
        "#    image: oven/bun:1.4.0   ← passo comentado (não roda)",
        "pipeline:",
        "  lint:",
        "    image: oven/bun:1.3.14",
        "",
      ].join("\n"),
    })
    expect(checkThirdPartyPipelineVersions(dir)).toEqual([])
  })

  it("sem espelho declarado NÃO passa: aponta a ausência em vez de comparar com nada", () => {
    const dir = makeFixture("sem-espelho", {
      ".woodpecker.yml": "pipeline:\n  lint:\n    image: oven/bun:1.4.0\n",
    })
    const v = checkThirdPartyPipelineVersions(dir)
    expect(v).toHaveLength(1)
    expect(v[0]).toContain("nenhum espelho declara")
  })

  it("um pipeline que NÃO pode ser lido reprova (fail-closed, não 'nada a julgar')", () => {
    const dir = makeFixture("ilegivel", { ".actrc": ACTRC })
    symlinkSync(join(dir, "ausente.yml"), join(dir, ".woodpecker.yml"))
    const v = checkThirdPartyPipelineVersions(dir)
    expect(v).toHaveLength(1)
    expect(v[0]).toContain(".woodpecker.yml: existe e não pôde ser lido")
    expect(v[0]).toContain("NÃO é")
  })

  it("a AUSÊNCIA do arquivo não é violação (a alternativa arquivada pode ser apagada)", () => {
    const dir = makeFixture("sem-arquivo", { ".actrc": ACTRC })
    expect(checkThirdPartyPipelineVersions(dir)).toEqual([])
  })
})

// ── o recorte do commit ──────────────────────────────────────────────────

describe("checkStagedThirdPartyPipelineVersions — o número nasce na edição", () => {
  it("a linha ADICIONADA com outro número reprova", () => {
    const diff = diffOf(".woodpecker.yml", 32, ["    image: oven/bun:1.4.0"])
    const v = checkStagedThirdPartyPipelineVersions(diff, DECLARED)
    expect(v).toHaveLength(1)
    expect(v[0]).toContain(".woodpecker.yml:32")
    expect(v[0]).toContain("1.4.0")
  })

  it("a linha adicionada com o valor declarado (ou derivada) passa", () => {
    const diff = diffOf(".woodpecker.yml", 32, [
      "    image: oven/bun:1.3.14",
      "    image: oven/bun:${BUN_VERSION}",
    ])
    expect(checkStagedThirdPartyPipelineVersions(diff, DECLARED)).toEqual([])
  })

  it("um arquivo FORA do escopo não é julgado nem empresta a régua", () => {
    const diff = diffOf("docker-compose.dev.yml", 10, ["      - BUN_VERSION=1.4.0"])
    expect(checkStagedThirdPartyPipelineVersions(diff, DECLARED)).toEqual([])
  })
})

// ── o PISO: o repositório real ───────────────────────────────────────────

// ── thirdPartyPipelineCoverage — a COBERTURA (o ALCANCE, não o resultado) ──
//
// A invariante 19 diz o RESULTADO dela (nenhum uso da versão divergindo do
// declarado) e não dizia o ALCANCE: quantos tipos ela conhece, quais, e se
// algum CI de terceiro presente no repositório está fora deles. Sem esta
// metade, um `.gitlab-ci.yml` que entra no repositório fica cego para sempre e o
// verde da invariante 19 continua idêntico — a varredura responde sobre o que
// olhou, e nada pergunta o que ela não olhou.

describe("thirdPartyPipelineCoverage — a cobertura da varredura de terceiro", () => {
  const REPO_ROOT = process.cwd()

  it("declara os tipos da TABELA e os arquivos que cada um cobre", () => {
    const dir = makeFixture("cov-tipos", {
      ".woodpecker.yml": "steps: []\n",
      ".woodpecker/extra.yaml": "steps: []\n",
    })
    const cov = thirdPartyPipelineCoverage({ root: dir })
    expect(cov.tipos.map((t) => t.id)).toEqual(["woodpecker"])
    expect(cov.tipos[0].arquivos).toEqual([".woodpecker.yml", ".woodpecker/extra.yaml"])
    expect(cov.fora).toEqual([])
    expect(cov.cobertos).toBe(2)
  })

  it("a tabela aponta para o MESMO padrão da varredura (a cobertura não pode divergir dela)", () => {
    // Duas regexes (uma na tabela, outra no sweep) divergiriam no primeiro
    // pipeline novo — e o veredito passaria a declarar uma cobertura que não
    // existe, que é pior que não declarar nenhuma.
    expect(THIRD_PARTY_PIPELINE_TYPES.map((t) => t.padrao)).toEqual([THIRD_PARTY_PIPELINE_RE])
    // E o padrão continua sendo o mesmo que a ENUMERAÇÃO usa (a varredura): o
    // que a tabela declara como coberto é o que o guard de fato lê.
    const dir = makeFixture("cov-tabela", { ".woodpecker/ci.yml": "steps: []\n" })
    expect(thirdPartyPipelineFiles(dir)).toEqual([".woodpecker/ci.yml"])
    expect(thirdPartyPipelineCoverage({ root: dir }).cobertos).toBe(1)
  })

  it("um CI detectado FORA dos tipos declarados sai nomeado", () => {
    const dir = makeFixture("cov-fora", {
      ".woodpecker.yml": "steps: []\n",
      ".gitlab-ci.yml": "stages: [x]\n",
      ".circleci/config.yml": "version: 2\n",
    })
    const cov = thirdPartyPipelineCoverage({ root: dir })
    expect(cov.fora).toEqual([
      { id: "circleci", file: ".circleci/config.yml" },
      { id: "gitlab", file: ".gitlab-ci.yml" },
    ])
    expect(cov.cobertos).toBe(1)
    // O arquivo COBERTO não aparece como lacuna: a cobertura é a relação entre
    // os dois conjuntos, e um arquivo que a varredura julga não é buraco dela.
    expect(cov.fora.some((f) => f.file === ".woodpecker.yml")).toBe(false)
  })

  it("o `Jenkinsfile` ANINHADO entra (a varredura é recursiva) e o `node_modules` NÃO", () => {
    // Um Jenkinsfile aninhado é um pipeline de verdade — procurar só na raiz
    // deixaria a lacuna invisível justamente onde ela é mais comum. E a lista de
    // diretórios ignorados é a DECLARADA (`PROSE_IGNORED_DIRS`): dependência
    // instalada não é CI do repositório.
    const dir = makeFixture("cov-aninhado", {
      "sub/app/Jenkinsfile": "pipeline {}\n",
      "node_modules/pacote/Jenkinsfile": "dependencia instalada\n",
    })
    const cov = thirdPartyPipelineCoverage({ root: dir })
    expect(cov.fora).toEqual([{ id: "jenkins", file: "sub/app/Jenkinsfile" }])
  })

  it("detecção por NOME do arquivo: a prosa que cita um CI não é um pipeline", () => {
    const dir = makeFixture("cov-prosa", {
      "docs/CI.md": "o `.gitlab-ci.yml` foi descartado; o Jenkinsfile também\n",
    })
    expect(thirdPartyPipelineCoverage({ root: dir }).fora).toEqual([])
  })

  it("a lista de candidatos reconhece os CI canônicos (e cada id é único)", () => {
    const ids = THIRD_PARTY_CI_CANDIDATES.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    // Nenhum candidato pode ser também um tipo DECLARADO: um CI que a varredura
    // julga e que a lista de fora acusa seria contradição.
    for (const c of THIRD_PARTY_CI_CANDIDATES) {
      for (const t of THIRD_PARTY_PIPELINE_TYPES) expect(t.id).not.toBe(c.id)
    }
    const dir = makeFixture("cov-canonicos", {
      ".drone.yml": "kind: pipeline\n",
      ".travis.yml": "language: node_js\n",
      "azure-pipelines.yml": "trigger: [main]\n",
      "bitbucket-pipelines.yml": "pipelines: {}\n",
    })
    // A ordem é a dos ARQUIVOS (a lista é uma varredura, não uma taxonomia):
    // `.drone.yml`, `.travis.yml`, `azure-pipelines.yml`, `bitbucket-pipelines.yml`.
    expect(thirdPartyPipelineCoverage({ root: dir }).fora).toEqual([
      { id: "drone", file: ".drone.yml" },
      { id: "travis", file: ".travis.yml" },
      { id: "azure-pipelines", file: "azure-pipelines.yml" },
      { id: "bitbucket", file: "bitbucket-pipelines.yml" },
    ])
  })

  it("o repositório REAL: um tipo varrido (woodpecker) e nenhum CI fora dos tipos", () => {
    const cov = thirdPartyPipelineCoverage({ root: REPO_ROOT })
    expect(cov.tipos.map((t) => t.id)).toEqual(["woodpecker"])
    expect(cov.tipos[0].arquivos).toContain(".woodpecker.yml")
    expect(cov.fora).toEqual([])
    expect(cov.ilegiveis).toEqual([])
    expect(cov.cobertos).toBeGreaterThan(0)
  })
})

describe("os usos da versão no pipeline de terceiro do REPOSITÓRIO real", () => {
  const ROOT = process.cwd()
  const REL = ".woodpecker.yml"

  it("hoje o guard fecha verde (zero usos divergindo do declarado)", () => {
    expect(checkThirdPartyPipelineVersions(ROOT)).toEqual([])
  })

  it("o arquivo existe, é enumerado e TODOS os usos dizem o valor declarado", () => {
    const declared = declaredBunVersion(ROOT)
    expect(declared).not.toBeNull()
    expect(thirdPartyPipelineFiles(ROOT)).toContain(REL)

    const usos = readFileSync(join(ROOT, REL), "utf8")
      .split(/\r?\n/)
      .map((line) => findPipelineVersionUse(line))
      .filter((hit) => hit !== null)
    // Treze usos hoje (onze imagens + dois build args): o piso numérico existe
    // para o arquivo não "melhorar" ficando sem uso nenhum — zerar a lista
    // deixaria a régua verde por vacuidade.
    expect(usos.length).toBeGreaterThanOrEqual(13)
    for (const uso of usos) {
      expect(uso.kind).toBe("literal")
      expect(uso.value).toBe(declared)
    }
  })

  it("a regressão que originou a regra: UM número trocado derruba o guard nomeando arquivo e linha", () => {
    const real = readFileSync(join(ROOT, REL), "utf8")
    const mangled = real.replace(/^(\s*image:\s*oven\/bun:)1\.3\.14$/m, "$11.4.0")
    expect(mangled).not.toBe(real) // a mutação precisa ter mordido o arquivo real

    const dir = makeFixture("regressao", {
      ".actrc": readFileSync(join(ROOT, ".actrc"), "utf8"),
      ".woodpecker.yml": mangled,
    })
    const v = checkThirdPartyPipelineVersions(dir)
    expect(v).toHaveLength(1)
    expect(v[0]).toContain(`${REL}:`)
    expect(v[0]).toContain("1.4.0")
  })
})
