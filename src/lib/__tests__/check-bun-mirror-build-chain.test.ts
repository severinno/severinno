/**
 * check-bun-mirror-build-chain.test.ts
 *
 * Testes da INVARIANTE 18 do scripts/check-bun-mirror.mjs: a CADEIA DE BUILD
 * (Dockerfile ↔ build site). É a metade que liga as duas pontas que nenhuma
 * outra varredura via:
 *
 *   (a) o Dockerfile não declara VALOR para a versão — nem o default do ARG
 *       (`ARG BUN_VERSION=<v>`) nem um default embutido na referência
 *       (`${BUN_VERSION:-<v>}`). O default é o valor que todo build que NÃO
 *       passa o arg herda em SILÊNCIO, e nenhum bump da variável o alcança.
 *   (b) todo build site (compose) de um Dockerfile que declara
 *       `ARG BUN_VERSION` tem de PASSAR o arg — um build site sem o arg não tem
 *       valor escrito NENHUM, então as invariantes 13/15/16 não tinham o que
 *       julgar enquanto ele rodava o Bun do default.
 *   (c) a declaração de TOOLCHAIN (`packageManager` do package.json) diz o
 *       valor declarado.
 *
 * O CASO QUE ORIGINOU A REGRA: o serviço `web-staging` do
 * docker-compose.staging.yml buildava o `Dockerfile` sem `BUN_VERSION` no
 * `args:` e herdava o default do arquivo — a auditoria das invariantes 15/16
 * tinha "alinhado" os dois workers da MESMA stack e deixado o app no default,
 * de modo que a stack passou a buildar com dois Buns e nada ficou vermelho.
 *
 * Cobre: embeddedVersionDefault, a régua do ARG/referência em
 * checkDockerfileBunLine, composeBuildSites, checkComposeBuildArgs (incluindo o
 * recorte `addedLines` e o mapa inline), checkStagedComposeBuildArgs (índice,
 * incluindo o "não consegui ler"), checkPackageManagerVersion,
 * checkStagedPackageManagerVersion (a 18c no recorte: o campo REMOVIDO pelo
 * commit e a linha que ele ADICIONA) e judgePackageManager (a régua do valor
 * que o global e o recorte compartilham) — mais o
 * REPOSITÓRIO REAL (o piso: hoje as quatro regras fecham verdes, e a remoção do
 * arg de um build site real reprova NOMEANDO o serviço).
 *
 * ATENÇÃO (esbuild): dentro de template literals, `${` precisa de escape
 * (`\${`) — senão o esbuild lê como interpolação e o arquivo nem compila.
 *
 * Usage:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/check-bun-mirror-build-chain.test.ts
 */

import { describe, it, expect, afterAll } from "vitest"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import {
  PACKAGE_JSON_PATHS,
  SINGLE_SOURCE_PATHS,
  ancoraDoRemendo,
  bunDockerfilesWithArg,
  checkComposeBuildArgs,
  checkDockerfileBunLine,
  checkPackageManagerVersion,
  checkStagedComposeBuildArgs,
  checkStagedPackageManagerVersion,
  checkStagedRemovedBuildArgs,
  composeBuildSites,
  declaredBunVersion,
  embeddedVersionDefault,
  fixRemovedMirrors,
  gitDiffPaths,
  gitPathInHead,
  judgePackageManager,
} from "../../../scripts/check-bun-mirror.mjs"

const ROOT_TMP = mkdtempSync(join(tmpdir(), "cbun-build-chain-"))
afterAll(() => rmSync(ROOT_TMP, { recursive: true, force: true }))

/** Um repo de fixture com os arquivos que a régua lê. */
function makeFixture(name: string, files: Record<string, string>): string {
  const dir = join(ROOT_TMP, name)
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel)
    mkdirSync(join(abs, ".."), { recursive: true })
    writeFileSync(abs, content, "utf8")
  }
  return dir
}

// ── embeddedVersionDefault ───────────────────────────────────────────────

describe("embeddedVersionDefault — o valor embutido numa referência", () => {
  it("`${BUN_VERSION:-v}` é DEFAULT (o valor que roda onde a variável não existe)", () => {
    expect(embeddedVersionDefault("${BUN_VERSION:-1.4.0}")).toEqual({
      kind: "default",
      value: "1.4.0",
    })
    expect(embeddedVersionDefault("${BUN_VERSION:-1.4.0}-alpine")).toEqual({
      kind: "default",
      value: "1.4.0",
    })
  })

  it("default VAZIO não afirma valor — não é violação", () => {
    expect(embeddedVersionDefault("${BUN_VERSION:-}")).toBeNull()
    expect(embeddedVersionDefault("${BUN_VERSION:- }")).toBeNull()
  })

  it("`:?msg` (falha ALTO sem a variável) é o oposto de um default silencioso", () => {
    expect(embeddedVersionDefault("${BUN_VERSION:?declare BUN_VERSION}")).toBeNull()
  })

  it("os operadores que carregam valor próprio (`:+`) são violação", () => {
    expect(embeddedVersionDefault("${BUN_VERSION:+1.4.0}")).toEqual({
      kind: "operador próprio",
      value: "1.4.0",
    })
  })

  it("a referência simples e o `$BUN_VERSION` não têm valor embutido", () => {
    expect(embeddedVersionDefault("${BUN_VERSION}")).toBeNull()
    expect(embeddedVersionDefault("$BUN_VERSION")).toBeNull()
  })
})

// ── a régua do Dockerfile (invariante 18a) ───────────────────────────────

describe("checkDockerfileBunLine — o default do Dockerfile", () => {
  it("`ARG BUN_VERSION=<v>` é o valor que TODO build que não passa o arg herda", () => {
    const v = checkDockerfileBunLine("Dockerfile", 12, "ARG BUN_VERSION=1.4.0")
    expect(v).toContain("DEFAULT")
    expect(v).toContain("--build-arg")
  })

  it("`ARG BUN_VERSION` sem valor passa (o padrão dos quatro Dockerfiles)", () => {
    expect(checkDockerfileBunLine("Dockerfile", 12, "ARG BUN_VERSION")).toBeNull()
    expect(checkDockerfileBunLine("Dockerfile", 12, "ARG BUN_VERSION=")).toBeNull()
  })

  it("um ARG que DERIVA da variável passa; derivar com fallback não", () => {
    expect(checkDockerfileBunLine("Dockerfile", 12, "ARG BUN_VERSION=${BUN_VERSION}")).toBeNull()
    expect(
      checkDockerfileBunLine("Dockerfile", 12, "ARG BUN_VERSION=${BUN_VERSION:-1.4.0}"),
    ).toContain("DEFAULT")
  })

  it("a REFERÊNCIA com default embutido reprova (antes a régua a aceitava)", () => {
    const v = checkDockerfileBunLine(
      "Dockerfile",
      23,
      "FROM oven/bun:${BUN_VERSION:-1.4.0}-alpine AS base",
    )
    expect(v).toContain("embute")
    expect(v).toContain("1.4.0")
  })

  it("a referência sem valor continua passando (com sufixo e sem chaves)", () => {
    expect(
      checkDockerfileBunLine("Dockerfile", 23, "FROM oven/bun:${BUN_VERSION}-alpine AS base"),
    ).toBeNull()
    expect(
      checkDockerfileBunLine("Dockerfile.worker", 11, "FROM oven/bun:${BUN_VERSION} AS deps"),
    ).toBeNull()
    expect(
      checkDockerfileBunLine("Dockerfile", 23, "FROM oven/bun:${BUN_VERSION:-}-alpine AS base"),
    ).toBeNull()
    expect(
      checkDockerfileBunLine("Dockerfile", 23, "FROM oven/bun:${BUN_VERSION:?declare a versão}"),
    ).toBeNull()
  })

  it("COMENTÁRIO de Dockerfile continua fora (é onde o exemplo aparece)", () => {
    expect(checkDockerfileBunLine("Dockerfile", 1, "# ARG BUN_VERSION=1.4.0 era drift")).toBeNull()
  })
})

// ── composeBuildSites ────────────────────────────────────────────────────

describe("composeBuildSites — os build sites de um compose", () => {
  const COMPOSE = [
    "services:",
    "  app:",
    "    build: .",
    "  web:",
    "    build:",
    "      context: .",
    "      dockerfile: Dockerfile.worker",
    "      args:",
    "        BUN_VERSION: ${BUN_VERSION:-1.3.14}",
    "  other:",
    "    build:",
    "      context: ./mini-services/realtime",
    "      dockerfile: Dockerfile",
    "      args:",
    "        NODE_ENV: production",
    "  mapa:",
    "    build: { context: . }",
    "",
  ].join("\n")

  it("resolve o serviço, o Dockerfile a partir da RAIZ e se o arg é passado", () => {
    const sites = composeBuildSites("docker-compose.yml", COMPOSE)
    expect(sites.map((s) => [s.service, s.dockerfile, s.passArg])).toEqual([
      ["app", "Dockerfile", false],
      ["web", "Dockerfile.worker", true],
      ["other", "mini-services/realtime/Dockerfile", false],
      ["mapa", null, false],
    ])
  })

  it("o bloco de `deploy/` resolve o caminho relativo ao próprio arquivo", () => {
    const sites = composeBuildSites(
      "deploy/docker-compose.gitea.yml",
      [
        "services:",
        "  r:",
        "    build:",
        "      context: ..",
        "      dockerfile: Dockerfile",
        "",
      ].join("\n"),
    )
    expect(sites[0].dockerfile).toBe("Dockerfile")
  })

  it("o intervalo de linhas cobre o bloco (o recorte do --staged depende dele)", () => {
    const sites = composeBuildSites("docker-compose.yml", COMPOSE)
    expect(sites[0].lineNo).toBe(3)
    expect(sites[0].endLineNo).toBe(3)
    expect(sites[1].lineNo).toBe(5)
    expect(sites[1].endLineNo).toBe(9)
  })
})

// ── checkComposeBuildArgs (invariante 18b) ───────────────────────────────

describe("checkComposeBuildArgs — o build site tem de PASSAR o arg", () => {
  const BUN_DFS = ["Dockerfile", "Dockerfile.worker"]

  const compose = (args: string) =>
    [
      "services:",
      "  web-staging:",
      "    build:",
      "      context: .",
      "      dockerfile: Dockerfile",
      ...(args ? ["      args:", ...args.split("\n").map((l) => `        ${l}`)] : []),
      "    container_name: severinno-web-staging",
      "",
    ].join("\n")

  it("um serviço que builda um Dockerfile com ARG e NÃO passa o arg reprova NOMEANDO o serviço", () => {
    const v = checkComposeBuildArgs(
      "docker-compose.staging.yml",
      compose("NODE_ENV: production"),
      BUN_DFS,
    )
    expect(v).toHaveLength(1)
    expect(v[0]).toContain("web-staging")
    expect(v[0]).toContain("SEM passar o arg")
  })

  it("o arg derivado da variável passa (o fallback é julgado por VALOR pela 16)", () => {
    expect(
      checkComposeBuildArgs(
        "docker-compose.staging.yml",
        compose("NODE_ENV: production\nBUN_VERSION: ${BUN_VERSION:-1.3.14}"),
        BUN_DFS,
      ),
    ).toEqual([])
  })

  it("um Dockerfile SEM `ARG BUN_VERSION` não exige arg nenhum", () => {
    expect(
      checkComposeBuildArgs("docker-compose.yml", compose(""), [
        "mini-services/realtime/Dockerfile",
      ]),
    ).toEqual([])
  })

  it("o mapa INLINE não é adivinhado — o serviço é NOMEADO no veredito", () => {
    const c = ["services:", "  x:", "    build: { context: . }", ""].join("\n")
    const v = checkComposeBuildArgs("docker-compose.yml", c, BUN_DFS)
    expect(v).toHaveLength(1)
    expect(v[0]).toContain("MAPA INLINE")
    expect(v[0]).toContain("'x'")
  })

  it("o recorte `addedLines` só julga o bloco que o diff TOCA", () => {
    const content = [
      "services:",
      "  app:",
      "    build: .",
      "  web:",
      "    build:",
      "      context: .",
      "      dockerfile: Dockerfile.worker",
      "",
    ].join("\n")
    // As únicas linhas adicionadas são as do bloco do `web` (5-8): o `build:`
    // do `app` está no arquivo desde antes e NÃO é julgado de novo.
    const v = checkComposeBuildArgs("docker-compose.yml", content, BUN_DFS, { addedLines: [5] })
    expect(v).toHaveLength(1)
    expect(v[0]).toContain("'web'")
    expect(
      checkComposeBuildArgs("docker-compose.yml", content, BUN_DFS, { addedLines: [99] }),
    ).toEqual([])
  })
})

// ── checkStagedComposeBuildArgs (o recorte do commit) ────────────────────

describe("checkStagedComposeBuildArgs — o índice, não o disco", () => {
  const DIFF = [
    "diff --git a/docker-compose.yml b/docker-compose.yml",
    "--- a/docker-compose.yml",
    "+++ b/docker-compose.yml",
    "@@ -1,1 +1,4 @@",
    " services:",
    "+  app:",
    "+    build: .",
    "+",
    "",
  ].join("\n")

  it("lê o conteúdo do ÍNDICE e reporta o build site que o diff introduz", () => {
    const lido: string[] = []
    const out = checkStagedComposeBuildArgs(DIFF, ["Dockerfile"], (file) => {
      lido.push(file)
      return ["services:", "  app:", "    build: .", ""].join("\n")
    })
    expect(lido).toEqual(["docker-compose.yml"])
    expect(out.unreadable).toEqual([])
    expect(out.violations).toHaveLength(1)
    expect(out.violations[0]).toContain("'app'")
  })

  it("um arquivo que não pôde ser lido não vira 'nada a julgar' — sai em `unreadable`", () => {
    const out = checkStagedComposeBuildArgs(DIFF, ["Dockerfile"], () => null)
    expect(out.violations).toEqual([])
    expect(out.unreadable).toEqual(["docker-compose.yml"])
  })

  it("um arquivo fora do recorte não é lido", () => {
    const lido: string[] = []
    const out = checkStagedComposeBuildArgs(
      ["diff --git a/scripts/x.mjs b/scripts/x.mjs", "+const a = 1", ""].join("\n"),
      ["Dockerfile"],
      (file) => {
        lido.push(file)
        return ""
      },
    )
    expect(lido).toEqual([])
    expect(out).toEqual({ violations: [], unreadable: [] })
  })
})

// ── checkStagedRemovedBuildArgs (a direção que faltava) ──────────────────
//
// O recorte das linhas ADICIONADAS não vê uma remoção pura: um bloco que só
// PERDE o `BUN_VERSION` não ganha linha nenhuma. A régua compara o bloco do
// ÍNDICE (o que o commit vai gravar) com o de HEAD.

describe("checkStagedRemovedBuildArgs — o arg que o commit APAGA", () => {
  const BUN_DFS = ["Dockerfile", "Dockerfile.worker"]
  const DIFF = [
    "diff --git a/docker-compose.yml b/docker-compose.yml",
    "--- a/docker-compose.yml",
    "+++ b/docker-compose.yml",
    "@@ -1,8 +1,7 @@",
    " services:",
    "-",
    "",
  ].join("\n")
  /** O bloco ACIMA é o de HEAD; a única diferença do índice é o arg. */
  const comArg = [
    "services:",
    "  web-staging:",
    "    build:",
    "      context: .",
    "      dockerfile: Dockerfile.worker",
    "      args:",
    "        BUN_VERSION: \\${BUN_VERSION:-1.3.14}",
    "",
  ].join("\n")
  const semArg = comArg.split("\n").slice(0, 5).join("\n") + "\n"

  it("o serviço que PASSAVA o arg e não passa mais reprova, nomeando arquivo, linha e serviço", () => {
    const out = checkStagedRemovedBuildArgs(DIFF, BUN_DFS, {
      readIndex: () => semArg,
      readHead: () => comArg,
      inHead: () => true,
    })
    expect(out.unreadable).toEqual([])
    expect(out.violations).toHaveLength(1)
    expect(out.violations[0]).toContain("docker-compose.yml:")
    expect(out.violations[0]).toContain("'web-staging'")
    expect(out.violations[0]).toContain("Dockerfile.worker")
    expect(out.violations[0]).toContain("REMOVE o arg")
  })

  it("a direção INVERSA não é desta régua: o bloco que só GANHA o arg passa", () => {
    const out = checkStagedRemovedBuildArgs(DIFF, BUN_DFS, {
      readIndex: () => comArg,
      readHead: () => semArg,
      inHead: () => true,
    })
    expect(out).toEqual({ violations: [], unreadable: [] })
  })

  it("o SERVIÇO removido não é violação (outra decisão, outro veredito)", () => {
    const out = checkStagedRemovedBuildArgs(DIFF, BUN_DFS, {
      readIndex: () => ["services:", "  outra-coisa:", "    image: nginx", ""].join("\n"),
      readHead: () => comArg,
      inHead: () => true,
    })
    expect(out).toEqual({ violations: [], unreadable: [] })
  })

  it("o bloco que deixou de buildar um Dockerfile que EXIGE o arg não é violação", () => {
    const out = checkStagedRemovedBuildArgs(DIFF, BUN_DFS, {
      readIndex: () =>
        [
          "services:",
          "  web-staging:",
          "    build:",
          "      context: .",
          "      dockerfile: Dockerfile.sem-arg",
          "",
        ].join("\n"),
      readHead: () => comArg,
      inHead: () => true,
    })
    expect(out).toEqual({ violations: [], unreadable: [] })
  })

  it("arquivo NOVO não tem de onde remover — e não é lido em HEAD", () => {
    let leuHead = false
    const out = checkStagedRemovedBuildArgs(DIFF, BUN_DFS, {
      readIndex: () => comArg,
      readHead: () => {
        leuHead = true
        return null
      },
      inHead: () => false,
    })
    expect(out).toEqual({ violations: [], unreadable: [] })
    expect(leuHead).toBe(false)
  })

  it("índice ilegível é `unreadable` (o commit PARA com 2 — nunca 'nada a julgar')", () => {
    const out = checkStagedRemovedBuildArgs(DIFF, BUN_DFS, {
      readIndex: () => null,
      readHead: () => comArg,
      inHead: () => true,
    })
    expect(out.violations).toEqual([])
    expect(out.unreadable).toEqual(["docker-compose.yml"])
  })

  it("HEAD ilegível num arquivo que EXISTE lá também é `unreadable`", () => {
    const out = checkStagedRemovedBuildArgs(DIFF, BUN_DFS, {
      readIndex: () => semArg,
      readHead: () => null,
      inHead: () => true,
    })
    expect(out.violations).toEqual([])
    expect(out.unreadable).toEqual(["docker-compose.yml"])
  })

  it("um arquivo fora do recorte nem é lido", () => {
    let leu = false
    const out = checkStagedRemovedBuildArgs(
      ["diff --git a/scripts/x.mjs b/scripts/x.mjs", "+const a = 1", ""].join("\n"),
      BUN_DFS,
      {
        readIndex: () => {
          leu = true
          return null
        },
      },
    )
    expect(out).toEqual({ violations: [], unreadable: [] })
    expect(leu).toBe(false)
  })

  it("o probe do HEAD responde por EXIT CODE no repositório real (sem depender de texto de erro)", () => {
    expect(gitPathInHead("docker-compose.yml")).toBe(true)
    expect(gitPathInHead("nao-existe.yml")).toBe(false)
  })
})

// ── checkPackageManagerVersion (invariante 18c) ──────────────────────────

describe("checkPackageManagerVersion — o toolchain diz o valor declarado", () => {
  const MIRRORS = {
    ".actrc": ["--var BUN_VERSION=1.3.14", ""].join("\n"),
    "deploy/env.gitea.example": ["BUN_VERSION=1.3.14", ""].join("\n"),
  }

  const fixture = (pkg: string) =>
    makeFixture(`pm-${Math.random().toString(36).slice(2)}`, { ...MIRRORS, "package.json": pkg })

  it("o mesmo valor do espelho passa", () => {
    expect(
      checkPackageManagerVersion(fixture('{"name": "x", "packageManager": "bun@1.3.14"}')),
    ).toEqual([])
  })

  it("um valor diferente reprova citando o declarado e os espelhos", () => {
    const v = checkPackageManagerVersion(fixture('{"name": "x", "packageManager": "bun@1.4.0"}'))
    expect(v).toHaveLength(1)
    expect(v[0]).toContain("1.4.0")
    expect(v[0]).toContain("1.3.14")
    expect(v[0]).toContain(".actrc")
  })

  it("o campo ausente reprova (a declaração do toolchain não pode sumir em silêncio)", () => {
    const v = checkPackageManagerVersion(fixture('{"name": "x"}'))
    expect(v).toHaveLength(1)
    expect(v[0]).toContain("packageManager")
  })

  it("um packageManager que não é do Bun fica fora (a régua é do Bun)", () => {
    expect(
      checkPackageManagerVersion(fixture('{"name": "x", "packageManager": "npm@10.0.0"}')),
    ).toEqual([])
  })
})

// ── judgePackageManager (a régua que os dois modos compartilham) ─────────

describe("judgePackageManager — uma régua só para o global e para o recorte", () => {
  it("julga o arquivo inteiro e julga UMA linha (o recorte) com o mesmo valor de referência", () => {
    const arquivo = '{\n  "name": "x",\n  "packageManager": "bun@1.4.0"\n}'
    const linha = '  "packageManager": "bun@1.4.0",'
    expect(judgePackageManager(arquivo, "1.3.14")).toEqual(judgePackageManager(linha, "1.3.14"))
    expect(judgePackageManager(arquivo, "1.3.14")).toHaveLength(1)
  })

  it("o rótulo diz onde julgar (arquivo inteiro vs linha do arquivo)", () => {
    expect(
      judgePackageManager('  "packageManager": "bun@1.4.0",', "1.3.14", "package.json:3")[0],
    ).toContain("package.json:3")
    expect(judgePackageManager("{", null)[0]).toContain("package.json:")
    expect(judgePackageManager("{", null)[0]).not.toContain("package.json:0")
  })
})

// ── checkStagedPackageManagerVersion (a última ponta da 18 no commit) ────
//
// O `package.json` não era alvo de NENHUMA pathspec do `--staged`, então a
// 18(c) só existia na varredura global: remover o `packageManager` passava o
// commit e só encontrava o PR. É a mesma cegueira que a 18(b) tinha — o que o
// commit TIRA não aparece em linha adicionada nenhuma.

describe("checkStagedPackageManagerVersion — a declaração que o commit APAGA ou MUDA", () => {
  /** O diff do `package.json` com uma linha REMOVIDA (sem nenhuma adicionada). */
  const DIFF_REMOVE = [
    "diff --git a/package.json b/package.json",
    "--- a/package.json",
    "+++ b/package.json",
    "@@ -2,4 +2,3 @@",
    '   "name": "x",',
    '-  "packageManager": "bun@1.3.14",',
    "",
  ].join("\n")
  /** O diff que ADICIONA a declaração (o valor nasce na edição). */
  const DIFF_ADD = [
    "diff --git a/package.json b/package.json",
    "--- a/package.json",
    "+++ b/package.json",
    "@@ -1,3 +1,4 @@",
    " {",
    '   "name": "x",',
    '+  "packageManager": "bun@1.4.0",',
    '   "version": "1.0.0"',
    "",
  ].join("\n")
  /** O mesmo diff, mas o valor da linha adicionada é o DECLARADO. */
  const DIFF_ADD_OK = DIFF_ADD.replace("bun@1.4.0", "bun@1.3.14")

  const comCampo = '{\n  "name": "x",\n  "packageManager": "bun@1.3.14",\n  "version": "1.0.0"\n}'
  const semCampo = '{\n  "name": "x",\n  "version": "1.0.0"\n}'
  const comValorVelho = comCampo.replace("bun@1.3.14", "bun@1.4.0")
  const declared = "1.3.14"

  it("o campo REMOVIDO pelo commit reprova, dizendo que o ÍNDICE não tem e o HEAD tinha", () => {
    const out = checkStagedPackageManagerVersion(DIFF_REMOVE, {
      declared,
      readIndex: () => semCampo,
      readHead: () => comCampo,
      inHead: () => true,
    })
    expect(out.unreadable).toEqual([])
    expect(out.violations).toHaveLength(1)
    expect(out.violations[0]).toContain("package.json")
    expect(out.violations[0]).toContain("REMOVIDA")
    expect(out.violations[0]).toContain("packageManager")
    // A mensagem NOMEIA o remédio com o valor declarado — não deixa o operador adivinhar.
    expect(out.violations[0]).toContain("bun@1.3.14")
  })

  it("o campo que SOBREVIVE ao commit não é desta régua (quem julga o valor é o global)", () => {
    const out = checkStagedPackageManagerVersion(DIFF_REMOVE, {
      declared,
      readIndex: () => comValorVelho,
      readHead: () => comValorVelho,
      inHead: () => true,
    })
    expect(out).toEqual({ violations: [], unreadable: [] })
  })

  it("o arquivo que NUNCA teve o campo não vira violação aqui (o commit não introduz a ausência)", () => {
    const out = checkStagedPackageManagerVersion(DIFF_REMOVE, {
      declared,
      readIndex: () => semCampo,
      readHead: () => semCampo,
      inHead: () => true,
    })
    expect(out).toEqual({ violations: [], unreadable: [] })
  })

  it("a linha que o diff ADICIONA com outro valor reprova, nomeando a linha do arquivo novo", () => {
    const out = checkStagedPackageManagerVersion(DIFF_ADD, {
      declared,
      readIndex: () => comValorVelho,
      readHead: () => semCampo,
      inHead: () => true,
    })
    expect(out.violations).toHaveLength(1)
    expect(out.violations[0]).toContain("package.json:3")
    expect(out.violations[0]).toContain("1.4.0")
    expect(out.violations[0]).toContain("1.3.14")
  })

  it("a linha ADICIONADA com o valor declarado passa", () => {
    const out = checkStagedPackageManagerVersion(DIFF_ADD_OK, {
      declared,
      readIndex: () => comCampo,
      readHead: () => semCampo,
      inHead: () => true,
    })
    expect(out).toEqual({ violations: [], unreadable: [] })
  })

  it("arquivo NOVO com o valor errado é pego pela linha adicionada (e o HEAD nem é lido)", () => {
    let leuHead = false
    const out = checkStagedPackageManagerVersion(DIFF_ADD, {
      declared,
      readIndex: () => comValorVelho,
      readHead: () => {
        leuHead = true
        return null
      },
      inHead: () => false,
    })
    expect(out.violations).toHaveLength(1)
    expect(out.violations[0]).toContain("package.json:3")
    expect(leuHead).toBe(false)
  })

  it("índice ilegível é `unreadable` (o commit PARA com 2 — nunca 'nada a julgar')", () => {
    const out = checkStagedPackageManagerVersion(DIFF_REMOVE, {
      declared,
      readIndex: () => null,
      readHead: () => comCampo,
      inHead: () => true,
    })
    expect(out.violations).toEqual([])
    expect(out.unreadable).toEqual(["package.json"])
  })

  it("HEAD ilegível num arquivo que EXISTE lá também é `unreadable`", () => {
    const out = checkStagedPackageManagerVersion(DIFF_REMOVE, {
      declared,
      readIndex: () => semCampo,
      readHead: () => null,
      inHead: () => true,
    })
    expect(out.violations).toEqual([])
    expect(out.unreadable).toEqual(["package.json"])
  })

  it("um arquivo fora do recorte nem é lido (a pathspec é declarada, não herdada)", () => {
    let leu = false
    const out = checkStagedPackageManagerVersion(
      [
        "diff --git a/scripts/x.mjs b/scripts/x.mjs",
        "--- a/scripts/x.mjs",
        "+++ b/scripts/x.mjs",
        "@@ -1 +1,2 @@",
        "+const a = 1",
        "",
      ].join("\n"),
      {
        declared,
        readIndex: () => {
          leu = true
          return null
        },
      },
    )
    expect(out).toEqual({ violations: [], unreadable: [] })
    expect(leu).toBe(false)
  })

  it("o toolchain SEM valor de referência julga contra a ausência de espelho (fail-closed, não 'passou')", () => {
    const out = checkStagedPackageManagerVersion(DIFF_ADD, {
      declared: null,
      readIndex: () => comValorVelho,
      readHead: () => semCampo,
      inHead: () => true,
    })
    expect(out.violations).toHaveLength(1)
    expect(out.violations[0]).toContain("nenhum espelho declara a vigente")
  })

  it("o repositório REAL está verde neste recorte (o piso)", () => {
    expect(checkPackageManagerVersion(process.cwd())).toEqual([])
  })
})

// ── o REPOSITÓRIO real (o piso) ──────────────────────────────────────────

describe("a cadeia de build no REPOSITÓRIO real", () => {
  it("os quatro Dockerfiles com ARG declaram o ARG SEM default", () => {
    const dfs = bunDockerfilesWithArg(process.cwd())
    expect(dfs).toEqual([
      "Dockerfile",
      "Dockerfile.ubuntu-bun",
      "Dockerfile.worker",
      "mini-services/realtime/Dockerfile",
    ])
    for (const rel of dfs) {
      const content = readFileSync(join(process.cwd(), rel), "utf8")
      expect(content).toMatch(/^ARG BUN_VERSION$/m)
      expect(content).not.toMatch(/^ARG BUN_VERSION=/m)
      expect(content).not.toMatch(/\$\{BUN_VERSION:-[^}]+\}/)
    }
  })

  it("todo build site de compose passa o arg (staging app, staging workers, dev, mini-service)", () => {
    const dfs = bunDockerfilesWithArg(process.cwd())
    for (const rel of [
      "docker-compose.yml",
      "docker-compose.staging.yml",
      "docker-compose.dev.yml",
      "docker-compose.test.yml",
      "docker-compose.prod.yml",
      "docker-compose.hostinger.yml",
    ]) {
      expect(
        checkComposeBuildArgs(rel, readFileSync(join(process.cwd(), rel), "utf8"), dfs),
      ).toEqual([])
    }
  })

  it("a regressão que originou a regra: sem o arg, o `web-staging` é NOMEADO", () => {
    const rel = "docker-compose.staging.yml"
    const real = readFileSync(join(process.cwd(), rel), "utf8")
    // A mutação: tirar do app da staging o arg que a rodada acrescentou.
    const mutado = real.replace(/^ {8}BUN_VERSION: \$\{BUN_VERSION:-1\.3\.14\}$/m, "")
    expect(mutado).not.toBe(real)
    const v = checkComposeBuildArgs(rel, mutado, bunDockerfilesWithArg(process.cwd()))
    expect(v).toHaveLength(1)
    expect(v[0]).toContain("'web-staging'")
    expect(v[0]).toContain("SEM passar o arg")
  })

  it("o toolchain do package.json diz o valor declarado nos espelhos", () => {
    expect(checkPackageManagerVersion(process.cwd())).toEqual([])
    const declared = declaredBunVersion(process.cwd())
    expect(declared).not.toBeNull()
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"))
    expect(pkg.packageManager).toBe(`bun@${declared}`)
  })
})

// ── o REMENDO (`--fix`): a declaração de espelho apagada volta do HEAD ────

const COMPOSE = "deploy/docker-compose.yml"
const COMPOSE_ANTES = `services:
  app:
    build:
      context: ..
      dockerfile: Dockerfile
      args:
        BUN_VERSION: \${BUN_VERSION:-1.3.14}
    command: echo oi
`
const COMPOSE_SEM_ARG = `services:
  app:
    build:
      context: ..
      dockerfile: Dockerfile
      args:
    command: echo oi
`
const PKG_ANTES = `{
  "name": "fixture",
  "version": "0.0.0",
  "packageManager": "bun@1.3.14",
  "private": true
}
`
const PKG_SEM_TOOLCHAIN = `{
  "name": "fixture",
  "version": "0.0.0",
  "private": true
}
`

/** O git de um fixture (config por `-c`: nada de config GLOBAL nesta máquina). */
function git(dir: string, ...args: string[]): string {
  const r = spawnSync("git", args, { cwd: dir, encoding: "utf8" })
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} falhou: ${r.stderr}`)
  return String(r.stdout ?? "")
}

/**
 * Um repositório de VERDADE com a remoção ESTAGIADA — o remendo lê o ÍNDICE
 * (`git show :f`) e o HEAD (`git show HEAD:f`), então um fixture de arquivos soltos
 * não o exercita.
 */
function repoComRemocao(
  name: string,
  antes: Record<string, string>,
  depois: Record<string, string>,
) {
  const dir = makeFixture(name, { Dockerfile: "FROM alpine\nARG BUN_VERSION\n", ...antes })
  git(dir, "init", "-q")
  git(dir, "add", "-A")
  git(dir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "base")
  for (const [rel, content] of Object.entries(depois))
    writeFileSync(join(dir, rel), content, "utf8")
  git(dir, "add", "-A")
  return dir
}

/** O git do repositório REAL (`scripts/check-bun-mirror.mjs`), rodado do fixture. */
function cliFix(dir: string, ...flags: string[]) {
  return spawnSync(
    process.execPath,
    [resolve(process.cwd(), "scripts/check-bun-mirror.mjs"), ...flags],
    {
      cwd: dir,
      encoding: "utf8",
    },
  )
}

describe("o remendo (`--fix`) da declaração de espelho apagada", () => {
  it("o preview mostra o que gravaria e NÃO grava", () => {
    const dir = repoComRemocao(
      "remendo-preview",
      { [COMPOSE]: COMPOSE_ANTES, "package.json": PKG_ANTES },
      { [COMPOSE]: COMPOSE_SEM_ARG, "package.json": PKG_SEM_TOOLCHAIN },
    )
    const r = fixRemovedMirrors(dir, { dry: true })
    expect(r.fixed.map((f) => f.file).sort()).toEqual([COMPOSE, "package.json"])
    expect(r.fixed.find((f) => f.file === COMPOSE)?.linhas[0]).toBe(
      `        BUN_VERSION: \${BUN_VERSION:-1.3.14}`,
    )
    // A ÂNCORA é dita no preview (e o preview não escreveu).
    expect(r.fixed.find((f) => f.file === COMPOSE)?.ancora).toBe("      args:")
    expect(readFileSync(join(dir, COMPOSE), "utf8")).toBe(COMPOSE_SEM_ARG)
    expect(readFileSync(join(dir, "package.json"), "utf8")).toBe(PKG_SEM_TOOLCHAIN)
  })

  it("o remendo restaura as duas declarações byte a byte e o recorte volta verde", () => {
    const dir = repoComRemocao(
      "remendo-aplica",
      { [COMPOSE]: COMPOSE_ANTES, "package.json": PKG_ANTES },
      { [COMPOSE]: COMPOSE_SEM_ARG, "package.json": PKG_SEM_TOOLCHAIN },
    )
    const r = fixRemovedMirrors(dir)
    expect(r.refused).toEqual([])
    expect(readFileSync(join(dir, COMPOSE), "utf8")).toBe(COMPOSE_ANTES)
    expect(readFileSync(join(dir, "package.json"), "utf8")).toBe(PKG_ANTES)

    // O remédio leva o remendo ao ÍNDICE (é o `git add` da classe) — e aí o
    // veredito do guard dono volta a passar, que é o que fecha o ciclo.
    git(dir, "add", "-A")
    const leitores = {
      readIndex: (f: string) => String(spawnSync("git", ["show", `:${f}`], { cwd: dir }).stdout),
      readHead: (f: string) => String(spawnSync("git", ["show", `HEAD:${f}`], { cwd: dir }).stdout),
      inHead: () => true,
    }
    const diffFonte = gitDiffPaths(null, SINGLE_SOURCE_PATHS, dir)
    const diffPacote = gitDiffPaths(null, PACKAGE_JSON_PATHS, dir)
    expect(diffFonte).not.toBeNull()
    expect(diffPacote).not.toBeNull()
    expect(
      checkStagedRemovedBuildArgs(diffFonte ?? "", bunDockerfilesWithArg(dir), leitores).violations,
    ).toEqual([])
    expect(checkStagedPackageManagerVersion(diffPacote ?? "", leitores).violations).toEqual([])
  })

  it("âncora AMBÍGUA: o fixer RECUSA em vez de adivinhar onde a declaração morava", () => {
    // O HEAD tem UM `      args:`; a árvore passou a ter DOIS (um serviço novo com
    // o MESMO bloco vazio) — inserir no primeiro ou no segundo seria adivinhar.
    const comDoisBlocos = `${COMPOSE_SEM_ARG}  extra:
    build:
      context: ..
      dockerfile: Dockerfile
      args:
`
    const dir = repoComRemocao(
      "remendo-ancora-ambigua",
      { [COMPOSE]: COMPOSE_ANTES },
      { [COMPOSE]: comDoisBlocos },
    )
    const r = fixRemovedMirrors(dir)
    expect(r.fixed).toEqual([])
    expect(r.refused).toHaveLength(1)
    expect(r.refused[0].reason).toContain("aparece 2x na árvore")
    expect(readFileSync(join(dir, COMPOSE), "utf8")).toBe(comDoisBlocos)
  })

  it("a ÁRVORE já declara o espelho: RECUSA com o caminho à mão (o que falta é `git add`)", () => {
    const dir = repoComRemocao(
      "remendo-ja-na-arvore",
      { [COMPOSE]: COMPOSE_ANTES },
      { [COMPOSE]: COMPOSE_SEM_ARG },
    )
    // Alguém repôs a linha na ÁRVORE sem estagiar: o ÍNDICE (que o guard julga)
    // continua sem ela, e o remendo não tem o que escrever.
    writeFileSync(join(dir, COMPOSE), COMPOSE_ANTES, "utf8")
    const r = fixRemovedMirrors(dir)
    expect(r.fixed).toEqual([])
    expect(r.refused[0].reason).toContain("já declara")
    expect(r.refused[0].reason).toContain("git add")
  })

  it("a DIVERGÊNCIA (valor trocado) não é remendada — o remendo restaura o APAGADO", () => {
    const pkgTrocado = PKG_ANTES.replace("bun@1.3.14", "bun@9.9.9")
    const dir = repoComRemocao(
      "remendo-divergencia",
      { "package.json": PKG_ANTES },
      { "package.json": pkgTrocado },
    )
    // Não há APAGAMENTO a restaurar…
    expect(fixRemovedMirrors(dir).fixed).toEqual([])
    expect(fixRemovedMirrors(dir).refused).toEqual([])
    // …e a régua do guard dono segue nomeando a divergência (outro veredito, outro remédio).
    const v = checkStagedPackageManagerVersion(gitDiffPaths(null, PACKAGE_JSON_PATHS, dir) ?? "", {
      readIndex: (f: string) => String(spawnSync("git", ["show", `:${f}`], { cwd: dir }).stdout),
      readHead: (f: string) => String(spawnSync("git", ["show", `HEAD:${f}`], { cwd: dir }).stdout),
      inHead: () => true,
    }).violations
    expect(v.join(" ")).toContain("9.9.9")
  })

  it("a CLI: `--fix --dry-run` não grava, e as combinações que o comando não promete são exit 2", () => {
    const dir = repoComRemocao(
      "remendo-cli",
      { [COMPOSE]: COMPOSE_ANTES },
      { [COMPOSE]: COMPOSE_SEM_ARG },
    )
    const preview = cliFix(dir, "--fix", "--dry-run")
    expect(preview.status).toBe(0)
    expect(preview.stdout).toContain("pré-visualizado")
    expect(readFileSync(join(dir, COMPOSE), "utf8")).toBe(COMPOSE_SEM_ARG)

    expect(cliFix(dir, "--dry-run").status).toBe(2)
    expect(cliFix(dir, "--fix", "--staged").status).toBe(2)
    expect(cliFix(dir, "--fix", "--json").status).toBe(2)

    const aplicado = cliFix(dir, "--fix")
    expect(aplicado.status).toBe(0)
    expect(aplicado.stdout).toContain("declaração restaurada do commit anterior")
    expect(readFileSync(join(dir, COMPOSE), "utf8")).toBe(COMPOSE_ANTES)
  })

  it("o bloco INTEIRO apagado (`args:` + o arg): o remendo devolve a CHAVE-PAI, não o YAML quebrado", () => {
    // O commit que apaga o bloco inteiro deixa a declaração sem o pai: restaurar
    // só a linha do arg produziria YAML INVÁLIDO. O remendo devolve o trecho que
    // ESTE commit apagou — e o veredito do dono volta a passar (o mesmo ciclo).
    const semBloco = `services:
  app:
    build:
      context: ..
      dockerfile: Dockerfile
    command: echo oi
`
    const dir = repoComRemocao(
      "remendo-bloco-inteiro",
      { [COMPOSE]: COMPOSE_ANTES },
      { [COMPOSE]: semBloco },
    )
    const preview = fixRemovedMirrors(dir, { dry: true })
    expect(preview.fixed[0]?.linhas).toEqual([
      "      args:",
      `        BUN_VERSION: \${BUN_VERSION:-1.3.14}`,
    ])
    expect(preview.fixed[0]?.declaracao).toBe(`        BUN_VERSION: \${BUN_VERSION:-1.3.14}`)
    // A âncora é medida do TOPO do remendo (`args:`), não da declaração solta.
    expect(preview.fixed[0]?.ancora).toBe("      dockerfile: Dockerfile")

    const r = fixRemovedMirrors(dir)
    expect(r.refused).toEqual([])
    expect(readFileSync(join(dir, COMPOSE), "utf8")).toBe(COMPOSE_ANTES)
  })

  it("a chave-pai que SOBREVIVEU no índice não é reescrita (o remendo é do que o commit apagou)", () => {
    const semLinha = `services:
  app:
    build:
      context: ..
      dockerfile: Dockerfile
      args:
    command: echo oi
`
    const dir = repoComRemocao(
      "remendo-pai-sobrevivente",
      { [COMPOSE]: COMPOSE_ANTES },
      { [COMPOSE]: semLinha },
    )
    const r = fixRemovedMirrors(dir, { dry: true })
    expect(r.fixed[0]?.linhas).toEqual([`        BUN_VERSION: \${BUN_VERSION:-1.3.14}`])
    expect(r.fixed[0]?.ancora).toBe("      args:")
  })

  it("a âncora: única na árvore é a única que serve (a função pura)", () => {
    expect(ancoraDoRemendo("a\nb\nc\n", "x\na\nb\nc\n", "b")).toEqual({ ok: true, ancora: "a" })
    const ambigua = ancoraDoRemendo("a\na\n", "x\na\nb\n", "b")
    expect(ambigua.ok).toBe(false)
    const sem = ancoraDoRemendo("z\n", "x\ny\nb\n", "b")
    expect(sem.ok).toBe(false)
  })
})
