// =============================================================================
// check-env-mirror.test.ts
//
// Testes do `scripts/check-env-mirror.mjs` — o pré-requisito 0 do
// `deploy/gitea-up.sh`: o env do HOST tem de ESPELHAR o template comitado, e a
// subida recusa quando não espelha.
//
// A regra não é nova (é a invariante 7b do `check:registry-source`) — o que se
// prova aqui é que ela roda SEM docker, no momento de subir a stack, com o
// contrato de exit codes que o bring-up usa.
//
// Três camadas, como no resto do repo: a função PURA (`compareMirrors`), a
// resolução de caminhos (`checkEnvMirror`, com um root sintético) e a CLI real
// (exit codes + JSON) num diretório de verdade.
// =============================================================================

import { spawnSync } from "node:child_process"
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterAll, describe, expect, it } from "vitest"

import { ENV_MIRROR_SCRIPT, GITEA_ENV_MIRROR } from "../../../scripts/check-bun-mirror.mjs"
import {
  EXIT,
  ROOT,
  checkEnvMirror,
  compareMirrors,
  parseArgs,
} from "../../../scripts/check-env-mirror.mjs"

const SCRIPT = join(ROOT, "scripts", "check-env-mirror.mjs")
const COMPOSE = "deploy/docker-compose.gitea.yml"

const tmpDirs: string[] = []

function makeTmp(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `env-mirror-${name}-`))
  tmpDirs.push(dir)
  return dir
}

afterAll(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** Um env no formato do template, com o segredo controlado por quem chama. */
function envContent(overrides: Record<string, string> = {}): string {
  const values: Record<string, string> = {
    IMAGE_REGISTRY: "ghcr.io",
    IMAGE_NAMESPACE: "severinno",
    BUN_VERSION: "1.3.14",
    RUNNER_TOKEN: "token-de-verdade",
    ...overrides,
  }
  return `${Object.entries(values)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n")}\n`
}

const TEMPLATE = envContent({ RUNNER_TOKEN: "COLE_O_TOKEN_AQUI" })

/**
 * Um root sintético com o compose REAL (as variáveis que ele consome são a
 * fonte da comparação) e os dois lados do espelho.
 *
 * `writeHost: false` omite o `deploy/.env.gitea` — o caso "não havia o que
 * comparar". O template pode ser trocado por caminho próprio.
 */
function makeRoot(opts: { host?: string | null; template?: string | null } = {}): string {
  const dir = makeTmp("root")
  mkdirSync(join(dir, "deploy"), { recursive: true })
  cpSync(join(ROOT, COMPOSE), join(dir, COMPOSE))
  if (opts.template !== null) {
    writeFileSync(join(dir, GITEA_ENV_MIRROR), opts.template ?? TEMPLATE)
  }
  if (opts.host !== null) {
    writeFileSync(join(dir, "deploy", ".env.gitea"), opts.host ?? envContent())
  }
  return dir
}

// ── 1. A regra pura ───────────────────────────────────────────────────────

describe("compareMirrors — a regra (a mesma do check:registry-source)", () => {
  const run = (hostContent: string) =>
    compareMirrors({
      templateContent: TEMPLATE,
      hostContent,
      composeContent: readCompose(),
      templateLabel: GITEA_ENV_MIRROR,
      hostLabel: "deploy/.env.gitea",
    })

  it("todo valor declarado bate e o segredo é o valor real → zero violações", () => {
    const { violations, consumed } = run(envContent())
    expect(violations).toEqual([])
    expect(consumed).toEqual(["BUN_VERSION", "IMAGE_NAMESPACE", "IMAGE_REGISTRY", "RUNNER_TOKEN"])
  })

  it("variável comum DIVERGINDO → violação nomeando os dois lados", () => {
    const { violations } = run(envContent({ BUN_VERSION: "9.9.9" }))
    expect(violations.length).toBe(1)
    expect(violations[0]).toContain("BUN_VERSION")
    expect(violations[0]).toContain("DIVERGE")
  })

  it("SEGREDO IGUAL ao template → violação (o template é comitado; igualar é o defeito)", () => {
    const { violations } = run(envContent({ RUNNER_TOKEN: "COLE_O_TOKEN_AQUI" }))
    expect(violations.length).toBe(1)
    expect(violations[0]).toContain("RUNNER_TOKEN")
    expect(violations[0]).toContain("MESMO valor do template")
  })

  it("SEGREDO VAZIO → violação (o container recebe string vazia)", () => {
    const { violations } = run(envContent({ RUNNER_TOKEN: "" }))
    expect(violations.length).toBe(1)
    expect(violations[0]).toContain("VAZIA")
  })

  it("variável do template AUSENTE no host → violação (o compose cairia no default)", () => {
    const { violations } = run("IMAGE_REGISTRY=ghcr.io\nRUNNER_TOKEN=x\n")
    expect(
      violations.some((v) => v.includes("IMAGE_NAMESPACE") && v.includes("NAO no env do host")),
    ).toBe(true)
  })

  it("variável a MAIS no host → violação (o estado do VPS não é reproduzível)", () => {
    const { violations } = run(`${envContent()}EXTRA=1\n`)
    expect(violations.some((v) => v.includes("EXTRA") && v.includes("nao e reproduzivel"))).toBe(
      true,
    )
  })

  it("o CONJUNTO de variáveis vem do compose (uma nova entra sozinha)", () => {
    const { consumed } = compareMirrors({
      templateContent: TEMPLATE,
      hostContent: envContent(),
      composeContent: "services:\n  x:\n    environment:\n      - A=${NOVA_VAR}\n",
      templateLabel: "t",
      hostLabel: "h",
    })
    expect(consumed).toEqual(["NOVA_VAR"])
  })
})

/** O compose REAL: as variáveis que ele consome são a fonte da comparação. */
function readCompose(): string {
  return readFileSync(join(ROOT, COMPOSE), "utf8")
}

// ── 2. A resolução de caminhos ────────────────────────────────────────────

describe("checkEnvMirror — resolução dos dois lados", () => {
  it("root com host e template coerentes → in-sync, com as variáveis conferidas", () => {
    const r = checkEnvMirror({ cwd: makeRoot() })
    expect(r.state).toBe("in-sync")
    expect(r.host).toBe("deploy/.env.gitea")
    expect(r.template).toBe(GITEA_ENV_MIRROR)
    expect(r.consumed.length).toBe(4)
  })

  it("host divergente → diverged, com a violação", () => {
    const r = checkEnvMirror({ cwd: makeRoot({ host: envContent({ IMAGE_NAMESPACE: "outro" }) }) })
    expect(r.state).toBe("diverged")
    expect(r.violations[0]).toContain("IMAGE_NAMESPACE")
  })

  it("sem o env do host → absent (não é 'conforme': não havia o que comparar)", () => {
    const r = checkEnvMirror({ cwd: makeRoot({ host: null }) })
    expect(r.state).toBe("absent")
    expect(r.detail).toContain("nao havia o que comparar")
  })

  it("sem o template comitado → absent (não há 'o que o repositório declara')", () => {
    const r = checkEnvMirror({ cwd: makeRoot({ template: null }) })
    expect(r.state).toBe("absent")
    expect(r.template).toBeNull()
  })

  it("--host/--template explícitos valem sobre a descoberta", () => {
    // O root NÃO tem os arquivos no lugar canônico: só os explícitos existem.
    const root = makeRoot({ host: null, template: null })
    const hostPath = join(root, "outro.env")
    const templatePath = join(root, "outro.template")
    writeFileSync(hostPath, envContent())
    writeFileSync(templatePath, TEMPLATE)
    const r = checkEnvMirror({ cwd: root, host: hostPath, template: templatePath })
    expect(r.state).toBe("in-sync")
    expect(r.host).toBe(hostPath)
    expect(r.template).toBe(templatePath)
  })
})

// ── 3. O contrato da CLI ──────────────────────────────────────────────────

describe("parseArgs", () => {
  it("defaults: descoberta, sem JSON", () => {
    expect(parseArgs([])).toMatchObject({ json: false, help: false, host: null, template: null })
  })

  it("aceita --host/--template/--json/--help", () => {
    expect(parseArgs(["--host", "a.env", "--template", "b.env", "--json"])).toMatchObject({
      host: "a.env",
      template: "b.env",
      json: true,
    })
    expect(parseArgs(["-h"]).help).toBe(true)
  })

  it("--host/--template sem valor e flag desconhecida → erro", () => {
    expect(parseArgs(["--host"]).error).toContain("--host")
    expect(parseArgs(["--template"]).error).toContain("--template")
    expect(parseArgs(["--turbo"]).error).toContain("flag desconhecida")
  })
})

describe("a CLI real (exit codes e JSON)", () => {
  function runCli(args: string[], cwd: string = ROOT) {
    const res = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: "utf8" })
    return { status: res.status, out: `${res.stdout ?? ""}${res.stderr ?? ""}` }
  }

  it("o script existe no caminho que o guard do bring-up exige", () => {
    expect(existsSync(join(ROOT, ENV_MIRROR_SCRIPT))).toBe(true)
    expect(SCRIPT).toBe(join(ROOT, ENV_MIRROR_SCRIPT))
  })

  it("em sincronia → exit 0 com o relatório", () => {
    const { status, out } = runCli([], makeRoot())
    expect(status).toBe(EXIT.OK)
    expect(out).toContain("EM SINCRONIA")
  })

  it("divergente → exit 1 e a violação na saída", () => {
    const { status, out } = runCli([], makeRoot({ host: envContent({ BUN_VERSION: "0.0.1" }) }))
    expect(status).toBe(EXIT.DIVERGED)
    expect(out).toContain("DIVERGE")
    expect(out).toContain("BUN_VERSION")
  })

  it("sem o env do host → exit 1 (a subida exige a comparação, não a presume)", () => {
    const { status, out } = runCli([], makeRoot({ host: null }))
    expect(status).toBe(EXIT.DIVERGED)
    expect(out).toContain("NAO APLICAVEL")
  })

  it("--json tem o mesmo shape nos três estados", () => {
    const root = makeRoot()
    const shapes = [
      runCli(["--json"], root),
      runCli(["--json"], makeRoot({ host: envContent({ BUN_VERSION: "0.0.1" }) })),
      runCli(["--json"], makeRoot({ host: null })),
    ].map(({ status, out }) => {
      const parsed = JSON.parse(out)
      return { status, keys: Object.keys(parsed).sort(), state: parsed.state }
    })
    expect(shapes[0]).toMatchObject({ status: EXIT.OK, state: "in-sync" })
    expect(shapes[1]).toMatchObject({ status: EXIT.DIVERGED, state: "diverged" })
    expect(shapes[2]).toMatchObject({ status: EXIT.DIVERGED, state: "absent" })
    expect(shapes[0].keys).toEqual(shapes[1].keys)
    expect(shapes[1].keys).toEqual(shapes[2].keys)
  })

  it("flag explícita apontando para o nada → exit 2 (não compara outro arquivo em silêncio)", () => {
    const { status, out } = runCli(["--host", "nao/existe.env"], makeRoot())
    expect(status).toBe(EXIT.USAGE)
    expect(out).toContain("nao/existe.env")
  })

  it("flag desconhecida → exit 2, e --help → exit 0", () => {
    const root = makeRoot()
    expect(runCli(["--turbo"], root).status).toBe(EXIT.USAGE)
    const help = runCli(["--help"], root)
    expect(help.status).toBe(EXIT.OK)
    expect(help.out).toContain("Exit codes")
  })
})
