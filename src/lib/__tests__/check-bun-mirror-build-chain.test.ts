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
 * incluindo o "não consegui ler") e checkPackageManagerVersion — mais o
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
import { join } from "node:path"
import {
  bunDockerfilesWithArg,
  checkComposeBuildArgs,
  checkDockerfileBunLine,
  checkPackageManagerVersion,
  checkStagedComposeBuildArgs,
  composeBuildSites,
  declaredBunVersion,
  embeddedVersionDefault,
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
