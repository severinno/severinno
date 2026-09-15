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
  MASK,
  ROOT,
  applyFix,
  applyPlan,
  checkEnvMirror,
  compareMirrors,
  maskSecrets,
  parseArgs,
  planMirror,
  unifiedDiff,
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

// ── 4. O PLANO: toda violação tem UM destino ──────────────────────────────
//
// A invariante que carrega o desenho inteiro: a regra não pode acusar nada que o
// plano não trate. Cada violação ou vira UMA edição mecânica, ou é nomeada como
// decisão humana — nunca fica sem destino, que é como uma divergência sumiria de
// um `--fix` sem ninguém notar.

describe("planMirror — o destino de cada violação", () => {
  const COMPOSE_TINY = [
    "services:",
    "  runner:",
    "    environment:",
    "      - IMAGE_REGISTRY=${IMAGE_REGISTRY}",
    "      - IMAGE_NAMESPACE=${IMAGE_NAMESPACE}",
    "      - BUN_VERSION=${BUN_VERSION}",
    "      - REGISTRATION_TOKEN=${RUNNER_TOKEN}",
    "",
  ].join("\n")

  const TEMPLATE_TINY = [
    "RUNNER_TOKEN=COLE_O_TOKEN_AQUI",
    "IMAGE_REGISTRY=ghcr.io",
    "IMAGE_NAMESPACE=severinno",
    "BUN_VERSION=1.3.14",
    "",
  ].join("\n")

  const HOST_OK = [
    "RUNNER_TOKEN=token-real",
    "IMAGE_REGISTRY=ghcr.io",
    "IMAGE_NAMESPACE=severinno",
    "BUN_VERSION=1.3.14",
    "",
  ].join("\n")

  /**
   * Um cenário: a regra (violações), o plano (edições/manual) e o que sobraria.
   * A conta é conferida em TODO cenário — inclusive nos que só têm decisão humana.
   */
  function scenario(hostContent: string, templateContent = TEMPLATE_TINY) {
    const args = {
      templateContent,
      hostContent,
      composeContent: COMPOSE_TINY,
      templateLabel: GITEA_ENV_MIRROR,
      hostLabel: "deploy/.env.gitea",
    }
    const violations = compareMirrors(args).violations
    const plan = planMirror(args)
    const remaining = compareMirrors({ ...args, hostContent: plan.reconciled }).violations
    // Cada edição fecha exatamente UMA violação e nenhuma cria: o plano não pode
    // "consertar" duas de uma vez (a segunda sumiria sem rastro) nem abrir uma
    // nova que ninguém revisou.
    expect(violations.length - plan.edits.length).toBe(remaining.length)
    // E o que sobra é EXATAMENTE o que ele declarou como manual.
    expect(remaining.length).toBe(plan.manual.length)
    // Mais forte que a contagem: o plano só pode FAZER SUMIR violação, nunca
    // trocar uma por outra. Uma edição que conserta a contagem substituindo
    // "não existe" por "igual ao placeholder" passaria na conta acima e estaria
    // errada — aqui ela cai, porque a violação nova não estava na lista.
    for (const v of remaining) expect(violations).toContain(v)
    return { violations, plan, remaining }
  }

  it("em sincronia → nada a fazer (nem edição, nem decisão)", () => {
    const { violations, plan } = scenario(HOST_OK)
    expect(violations).toEqual([])
    expect(plan.edits).toEqual([])
    expect(plan.manual).toEqual([])
    expect(plan.reconciled).toBe(HOST_OK)
  })

  it("variável comum DIVERGINDO → UMA edição `set` com o valor do template", () => {
    const { plan } = scenario(HOST_OK.replace("IMAGE_NAMESPACE=severinno", "IMAGE_NAMESPACE=outro"))
    expect(plan.edits).toHaveLength(1)
    expect(plan.edits[0]).toMatchObject({
      name: "IMAGE_NAMESPACE",
      action: "set",
      value: "severinno",
    })
    expect(plan.manual).toEqual([])
    expect(plan.reconciled).toContain("IMAGE_NAMESPACE=severinno")
  })

  it("variável comum AUSENTE no host → UMA edição `add` (acrescentada no fim)", () => {
    const host = HOST_OK.split("\n")
      .filter((l) => !l.startsWith("BUN_VERSION="))
      .join("\n")
    const { plan } = scenario(host)
    expect(plan.edits).toHaveLength(1)
    expect(plan.edits[0]).toMatchObject({ name: "BUN_VERSION", action: "add", value: "1.3.14" })
    expect(plan.reconciled.trimEnd().endsWith("BUN_VERSION=1.3.14")).toBe(true)
  })

  it("SEGREDO ausente/vazio/igual ao template → manual nos três, nunca edição", () => {
    const cases: [string, string][] = [
      [
        "ausente",
        HOST_OK.split("\n")
          .filter((l) => !l.startsWith("RUNNER_TOKEN="))
          .join("\n"),
      ],
      ["vazio", HOST_OK.replace("RUNNER_TOKEN=token-real", "RUNNER_TOKEN=")],
      [
        "igual ao placeholder",
        HOST_OK.replace("RUNNER_TOKEN=token-real", "RUNNER_TOKEN=COLE_O_TOKEN_AQUI"),
      ],
    ]
    for (const [label, host] of cases) {
      const { plan } = scenario(host)
      expect(plan.edits, label).toEqual([])
      expect(
        plan.manual.map((m: { name: string }) => m.name),
        label,
      ).toEqual(["RUNNER_TOKEN"])
      expect(plan.reconciled, label).toBe(host) // o segredo não é reescrito nem movido
    }
  })

  it("variável a MAIS no host → manual (decisão: template ou remoção), nunca remoção automática", () => {
    const { plan } = scenario(`${HOST_OK}EXTRA=1\n`)
    expect(plan.edits).toEqual([])
    expect(plan.manual.map((m: { name: string }) => m.name)).toEqual(["EXTRA"])
    expect(plan.reconciled).toBe(`${HOST_OK}EXTRA=1\n`) // nada foi apagado
  })

  it("consumida que o TEMPLATE não declara → manual apontando o template, não o host", () => {
    const { plan } = scenario(HOST_OK, TEMPLATE_TINY.replace("BUN_VERSION=1.3.14\n", ""))
    const manual = plan.manual.find((m: { name: string }) => m.name === "BUN_VERSION")
    expect(manual?.kind).toBe("template")
    expect(manual?.why).toContain(GITEA_ENV_MIRROR)
  })

  it("tudo junto: cada violação tem destino, e a conta fecha", () => {
    const host = [
      "RUNNER_TOKEN=COLE_O_TOKEN_AQUI", // segredo com o placeholder do template
      "IMAGE_REGISTRY=errado", // set
      "SO_NO_HOST=1", // decisão
      "",
    ].join("\n")
    const { violations, plan, remaining } = scenario(host)
    // faltando: IMAGE_NAMESPACE e BUN_VERSION (add) · divergindo: IMAGE_REGISTRY (set)
    // manual: RUNNER_TOKEN (placeholder), SO_NO_HOST (a mais)
    expect(plan.edits.map((e: { action: string }) => e.action).sort()).toEqual([
      "add",
      "add",
      "set",
    ])
    expect(plan.manual.map((m: { name: string }) => m.name).sort()).toEqual([
      "RUNNER_TOKEN",
      "SO_NO_HOST",
    ])
    // A conta já é conferida dentro do `scenario`; aqui o resumo explícito.
    expect(violations.length).toBe(5)
    expect(remaining.length).toBe(2)
  })
})

// ── 5. applyPlan: a semântica do --env-file, não a do editor de texto ─────

describe("applyPlan — o arquivo muda como quem o lê espera", () => {
  it("`set` edita a ÚLTIMA ocorrência (é ela que vence na leitura)", () => {
    const out = applyPlan("A=1\nA=2\n", [{ name: "A", action: "set", value: "9" }])
    expect(out).toBe("A=1\nA=9\n")
  })

  it("`add` vai para o FIM (no meio ficaria sombreada pela ocorrência posterior)", () => {
    const out = applyPlan("A=1\n", [{ name: "B", action: "add", value: "2" }])
    expect(out).toBe("A=1\nB=2\n")
  })

  it("preserva o EOL do arquivo (CRLF continua CRLF)", () => {
    const out = applyPlan("A=1\r\nB=2\r\n", [{ name: "B", action: "set", value: "9" }])
    expect(out).toBe("A=1\r\nB=9\r\n")
  })

  it("preserva a AUSÊNCIA de newline final — inclusive quando acrescenta", () => {
    expect(applyPlan("A=1", [{ name: "A", action: "set", value: "2" }])).toBe("A=2")
    expect(applyPlan("A=1", [{ name: "B", action: "add", value: "2" }])).toBe("A=1\nB=2")
  })

  it("preserva `export ` e a indentação da linha corrigida", () => {
    const out = applyPlan("export A=1\n", [{ name: "A", action: "set", value: "2" }])
    expect(out).toBe("export A=2\n")
  })
})

// ── 6. O PATCH: gerado aqui, validado por um parser independente ──────────

describe("unifiedDiff e maskSecrets", () => {
  it("sem diferença → string vazia", () => {
    expect(unifiedDiff("A=1\n", "A=1\n")).toBe("")
  })

  it("mudanças distantes viram dois hunks", () => {
    const before = `${Array.from({ length: 20 }, (_, i) => `L${i}=${i}`).join("\n")}\n`
    const after = before.replace("L1=1", "L1=x").replace("L18=18", "L18=x")
    const patch = unifiedDiff(before, after)
    expect(patch.match(/^@@ /gm)).toHaveLength(2)
  })

  it("inserção pura no fim: a faixa vazia se ancora corretamente", () => {
    const patch = unifiedDiff("A=1\n", "A=1\nB=2\n")
    expect(patch).toContain("@@ -1,1 +1,2 @@")
  })

  it("mascara o valor de um segredo que caia no CONTEXTO, e só o do segredo", () => {
    const patch = "--- a/b\n+++ b/b\n@@ -1,2 +1,2 @@\n RUNNER_TOKEN=token-real\n-B=2\n+B=9\n"
    const masked = maskSecrets(patch)
    expect(masked).toContain(`RUNNER_TOKEN=${MASK}`)
    expect(masked).not.toContain("token-real")
    expect(masked).toContain("-B=2")
    expect(masked).toContain("+B=9")
    expect(maskSecrets("--- a/b\n@@ -1 +1 @@\n-A=1\n+A=2\n")).not.toContain(MASK)
  })
})

// ── 7. applyFix: escreve só quando o plano fecha a conta ──────────────────

describe("applyFix — o portão antes da escrita", () => {
  const plan = {
    consumed: ["A"],
    edits: [{ name: "A", action: "set" as const, value: "2", why: "diverge do template" }],
    manual: [],
    reconciled: "A=2\n",
  }

  it("plano que fecha a conta → escreve o conteúdo reconciliado", () => {
    const written: string[] = []
    const out = applyFix({ plan, remaining: [], write: (c) => written.push(c) })
    expect(out).toEqual({ applied: true })
    expect(written).toEqual(["A=2\n"])
  })

  it("violação que o plano NÃO explicou → recusa e não escreve nada", () => {
    const written: string[] = []
    const out = applyFix({
      plan,
      remaining: ["algo que este reconciliador nao entende"],
      write: (c) => written.push(c),
    })
    expect(out.applied).toBe(false)
    expect(out.reason).toContain("nao fecha a conta")
    expect(out.reason).toContain("NADA foi escrito")
    expect(written).toEqual([])
  })

  it("plano sem edição mecânica → nada a escrever (o que resta é humano)", () => {
    const written: string[] = []
    const out = applyFix({
      plan: {
        consumed: [],
        edits: [],
        manual: [{ name: "RUNNER_TOKEN", kind: "segredo", why: "x" }],
        reconciled: "A=1\n",
      },
      remaining: ["v"],
      write: (c) => written.push(c),
    })
    expect(out).toMatchObject({ applied: false, unchanged: true })
    expect(written).toEqual([])
  })

  it("defesa em profundidade: plano que tentaria escrever um SEGREDO é recusado", () => {
    const written: string[] = []
    const out = applyFix({
      plan: {
        consumed: ["RUNNER_TOKEN"],
        edits: [{ name: "RUNNER_TOKEN", action: "set", value: "valor", why: "x" }],
        manual: [],
        reconciled: "RUNNER_TOKEN=valor\n",
      },
      remaining: [],
      write: (c) => written.push(c),
    })
    expect(out.applied).toBe(false)
    expect(out.reason).toContain("SEGREDO")
    expect(written).toEqual([])
  })
})

// ── 8. A CLI nos modos novos: streams, exit codes e o que NÃO sai ─────────

const GIT_DISPONIVEL = spawnSync("git", ["--version"], { encoding: "utf8" }).status === 0

/** O template REAL e um host que diverge dele — o cenário de verdade do VPS. */
function makeRealRoot(opts: { host?: string } = {}) {
  const dir = makeTmp("real")
  mkdirSync(join(dir, "deploy"), { recursive: true })
  cpSync(join(ROOT, COMPOSE), join(dir, COMPOSE))
  const template = readFileSync(join(ROOT, GITEA_ENV_MIRROR), "utf8")
  writeFileSync(join(dir, GITEA_ENV_MIRROR), template)
  const host =
    opts.host ??
    template
      .replace(/^RUNNER_TOKEN=.*$/m, "RUNNER_TOKEN=token-real-do-vps")
      .replace(/^IMAGE_NAMESPACE=.*$/m, "IMAGE_NAMESPACE=errado")
  writeFileSync(join(dir, "deploy", ".env.gitea"), host)
  return { dir, host }
}

function runCliSplit(args: string[], cwd: string) {
  const res = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: "utf8" })
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" }
}

const HOST_PATH = "deploy/.env.gitea"

function readHost(dir: string): string {
  return readFileSync(join(dir, HOST_PATH), "utf8")
}

describe("a CLI: --patch", () => {
  it("STDOUT leva só o patch; o relatório vai para STDERR (dá para redirecionar)", () => {
    const { dir } = makeRealRoot()
    const { status, stdout, stderr } = runCliSplit(["--patch"], dir)
    expect(status).toBe(EXIT.OK)
    expect(stdout.startsWith("--- ")).toBe(true)
    expect(stdout).not.toContain("check-env-mirror —")
    expect(stderr).toContain("check-env-mirror —")
    expect(stderr).toContain("O QUE MUDA NO HOST")
  })

  it("em sincronia → patch vazio, aviso nomeado e exit 0", () => {
    const { dir } = makeRealRoot({
      host: readFileSync(join(ROOT, GITEA_ENV_MIRROR), "utf8").replace(
        /^RUNNER_TOKEN=.*$/m,
        "RUNNER_TOKEN=real",
      ),
    })
    const { status, stdout, stderr } = runCliSplit(["--patch"], dir)
    expect(status).toBe(EXIT.OK)
    expect(stdout).toBe("")
    expect(stderr).toContain("nada a mudar no host")
  })

  it("diverge com decisão humana pendente → exit 1 (o patch sozinho não espelha)", () => {
    const { dir } = makeRealRoot()
    writeFileSync(join(dir, HOST_PATH), `${readHost(dir)}EXTRA_DO_VPS=1\n`)
    const { status, stderr } = runCliSplit(["--patch"], dir)
    expect(status).toBe(EXIT.DIVERGED)
    expect(stderr).toContain("dependem de decisao humana")
  })

  it("o segredo NUNCA aparece na saída — nem mascarado por acidente, nem em claro", () => {
    // Segredo na PRIMEIRA linha e divergência na segunda: o contexto do diff
    // alcança o segredo, então o patch tem de sair mascarado.
    const { dir } = makeRealRoot({
      host: "RUNNER_TOKEN=token-super-secreto\nIMAGE_NAMESPACE=errado\n",
    })
    const { status, stdout, stderr } = runCliSplit(["--patch"], dir)
    expect(`${stdout}${stderr}`).not.toContain("token-super-secreto")
    expect(stderr).toContain("REVISAO")
    expect(stdout).toContain(MASK)
    // A máscara não muda o veredito: o patch fecha o que é fechável.
    expect(status).toBe(EXIT.OK)
  })
})

describe.skipIf(!GIT_DISPONIVEL)("a CLI: --patch byte-exato é aplicável", () => {
  it("o diff fecha com `git apply -p0` e o resultado é idêntico ao do --fix", () => {
    const a = makeRealRoot()
    const b = makeRealRoot()
    const viaGit = runCliSplit(["--patch"], a.dir)
    expect(viaGit.stderr).toContain("byte-exato")

    const applied = spawnSync("git", ["apply", "-p0", "--whitespace=nowarn"], {
      cwd: a.dir,
      input: viaGit.stdout,
      encoding: "utf8",
    })
    expect(applied.status, applied.stderr).toBe(0)

    // O `--fix` no MESMO host produz o MESMO arquivo: os dois caminhos não podem
    // divergir (seriam duas verdades sobre o que reconciliar).
    expect(runCliSplit(["--fix"], b.dir).status).toBe(EXIT.OK)
    expect(readHost(a.dir)).toBe(readHost(b.dir))
  })
})

describe("a CLI: --fix", () => {
  it("aplica, sai 0 e NÃO toca no segredo nem no que é decisão humana", () => {
    const { dir } = makeRealRoot()
    const before = readHost(dir)
    expect(before).toContain("IMAGE_NAMESPACE=errado")
    const { status, stderr } = runCliSplit(["--fix"], dir)
    expect(status).toBe(EXIT.OK)
    const after = readHost(dir)
    expect(after).toContain(`IMAGE_NAMESPACE=${readTemplateValue("IMAGE_NAMESPACE")}`)
    expect(after).toContain("RUNNER_TOKEN=token-real-do-vps")
    expect(stderr).toContain("aplicou")
  })

  it("é IDEMPOTENTE: o segundo run não muda o arquivo e sai 0", () => {
    const { dir } = makeRealRoot()
    expect(runCliSplit(["--fix"], dir).status).toBe(EXIT.OK)
    const afterFirst = readHost(dir)
    const second = runCliSplit(["--fix"], dir)
    expect(second.status).toBe(EXIT.OK)
    expect(second.stderr).toContain("ja em sincronia")
    expect(readHost(dir)).toBe(afterFirst)
  })

  it("com decisão humana pendente → exit 1 e o arquivo NÃO é reescrito", () => {
    const { dir } = makeRealRoot()
    writeFileSync(join(dir, HOST_PATH), `${readHost(dir)}EXTRA_DO_VPS=1\n`)
    expect(runCliSplit(["--fix"], dir).status).toBe(EXIT.DIVERGED)
    expect(readHost(dir)).toContain("EXTRA_DO_VPS=1")
  })

  it("só decisão humana (nada mecânico) → recusa por escrito, sem escrever", () => {
    // O host é o TEMPLATE (com o placeholder do segredo) mais uma variável a
    // mais: as duas coisas são `manual`, e NADA é corrigível mecanicamente.
    const { dir } = makeRealRoot({
      host: `${readFileSync(join(ROOT, GITEA_ENV_MIRROR), "utf8")}EXTRA=1\n`,
    })
    const before = readHost(dir)
    const { status, stderr } = runCliSplit(["--fix"], dir)
    expect(status).toBe(EXIT.DIVERGED)
    expect(stderr).toContain("NAO escreveu nada")
    expect(readHost(dir)).toBe(before)
  })

  it("sem o env do host → recusa e NÃO cria o arquivo (inventaria o segredo)", () => {
    const { dir } = makeRealRoot()
    rmSync(join(dir, HOST_PATH))
    const { status, stderr } = runCliSplit(["--fix"], dir)
    expect(status).toBe(EXIT.DIVERGED)
    expect(existsSync(join(dir, HOST_PATH))).toBe(false)
    expect(stderr).toContain("cp ")
  })

  it("o patch aplicado sai no STDOUT, o diagnóstico no STDERR", () => {
    const { dir } = makeRealRoot()
    const { stdout, stderr } = runCliSplit(["--fix"], dir)
    expect(stdout.startsWith("--- ")).toBe(true)
    expect(stderr).toContain("aplicou")
    expect(stdout).not.toContain("aplicou")
  })
})

describe("a CLI: os modos novos no contrato de uso", () => {
  it("--patch e --fix juntos → exit 2 (são alternativas)", () => {
    const { dir } = makeRealRoot()
    const { status, stderr } = runCliSplit(["--patch", "--fix"], dir)
    expect(status).toBe(EXIT.USAGE)
    expect(stderr).toContain("alternativas")
  })

  it("--json com --patch/--fix → exit 2 (o JSON já traz o plano e o patch)", () => {
    const { dir } = makeRealRoot()
    expect(runCliSplit(["--json", "--patch"], dir).status).toBe(EXIT.USAGE)
    expect(runCliSplit(["--json", "--fix"], dir).status).toBe(EXIT.USAGE)
  })

  it("o JSON do modo normal já traz o plano, e o mesmo shape nos três estados", () => {
    const roots = [
      makeRealRoot({
        host: readFileSync(join(ROOT, GITEA_ENV_MIRROR), "utf8").replace(
          /^RUNNER_TOKEN=.*$/m,
          "RUNNER_TOKEN=real",
        ),
      }),
      makeRealRoot(),
      makeRealRoot(),
    ]
    rmSync(join(roots[2].dir, HOST_PATH))
    const parsed = roots.map(({ dir }) => JSON.parse(runCliSplit(["--json"], dir).stdout))
    for (const p of parsed) {
      expect(Object.keys(p.plan).sort()).toEqual([
        "consumed",
        "edits",
        "manual",
        "patch",
        "patchMasked",
        "reconciled",
      ])
    }
    expect(parsed[0].plan.edits).toEqual([])
    expect(parsed[1].plan.edits.length).toBeGreaterThan(0)
    expect(parsed[2].plan.edits).toEqual([])
  })

  it("parseArgs: as flags novas entram no contrato", () => {
    expect(parseArgs(["--patch"])).toMatchObject({ patch: true, fix: false })
    expect(parseArgs(["--fix"])).toMatchObject({ fix: true, patch: false })
    expect(parseArgs(["--patch", "--fix"]).error).toContain("alternativas")
    expect(parseArgs(["--json", "--fix"]).error).toContain("--json")
  })
})

/** O valor de uma variável no template REAL comitado. */
function readTemplateValue(name: string): string {
  const template = readFileSync(join(ROOT, GITEA_ENV_MIRROR), "utf8")
  const match = template.match(new RegExp(`^${name}=(.*)$`, "m"))
  return (match?.[1] ?? "").trim()
}
