// =============================================================================
// check-runner-labels.test.ts
//
// Testes do scripts/check-runner-labels.mjs — o guard que prova que o REGISTRO
// do act_runner (`/data/.runner`) é o que o compose da forja declara.
//
// O que precisa ser provado sobre o guard (e é o ponto todo):
//   1. os analisadores puros (label → entrada, registro → labels, comparação)
//      distinguem as três divergências que têm remédios distintos: label
//      ausente, label com IMAGEM diferente (o caso invisível) e label a mais;
//   2. o caminho completo, com docker dublê, FALHA quando o registro está velho
//      — e aponta qual label aponta para qual imagem;
//   3. "não consegui olhar" (sem compose, sem container, registro ilegível) NUNCA
//      vira "provado": é `unavailable`, com exit 3;
//   4. o container e o arquivo de registro saem do COMPOSE (nada é cravado).
//
// SEM docker e SEM a forja no ar: o `run` é injetado (mesmo padrão do
// prove-runner-image-gate). O único teste que toca no docker real é o do render
// declarado, e ele é pulado quando o plugin `compose` não existe na máquina.
// =============================================================================

import { spawnSync } from "node:child_process"

import { describe, expect, it } from "vitest"

import {
  EXIT,
  checkRunnerLabels,
  compareLabelSets,
  declaredLabels,
  exitCodeFor,
  parseArgs,
  parseLabelEntries,
  parseRunnerState,
  renderReport,
  resolveRunnerContainer,
  stateFilePath,
  stateMountTarget,
} from "../../../scripts/check-runner-labels.mjs"

// ── dublês ──────────────────────────────────────────────────────────────────

/** A forma que o `spawnSync` devolve — é o que o guard consome. */
type RunResult = { status: number; stdout: string; stderr: string; error?: Error }

const ok = (stdout = ""): RunResult => ({ status: 0, stdout, stderr: "" })

/**
 * `run` dublê: registra as chamadas e responde por ARGUMENTO, não por ordem —
 * assim um teste pode trocar só a resposta do `exec` sem reescrever o resto.
 */
function makeRun(handlers: {
  composeVersion?: RunResult
  render?: RunResult
  exec?: RunResult
  ps?: RunResult
}) {
  const calls: string[] = []
  const run = (_cmd: string, args: string[]) => {
    calls.push(args.join(" "))
    if (args[0] === "compose" && args[1] === "version") {
      return handlers.composeVersion ?? ok("Docker Compose version v2.24.0")
    }
    if (args[0] === "compose" && args.includes("config")) {
      return handlers.render ?? ok(JSON.stringify(RENDER))
    }
    if (args[0] === "exec") return handlers.exec ?? ok(JSON.stringify({ labels: REGISTERED }))
    if (args[0] === "ps") return handlers.ps ?? ok("gitea-runner\n")
    return ok()
  }
  return { run: run as unknown as typeof spawnSync, calls }
}

/** O `docker compose config --format json` da forja, na forma real. */
const RENDER = {
  services: {
    runner: {
      container_name: "gitea-runner",
      environment: {
        GITEA_RUNNER_LABELS:
          "ubuntu-latest:docker://ghcr.io/severinno/ubuntu-bun:1.3.14,ubuntu-22.04:docker://ghcr.io/severinno/ubuntu-bun:1.3.14",
      },
      volumes: [
        { type: "bind", source: "/var/run/docker.sock", target: "/var/run/docker.sock" },
        { type: "volume", source: "runner-data", target: "/data" },
      ],
    },
  },
}

/** Os labels que o compose declara (o lado "certo"). */
const DECLARED = [
  "ubuntu-latest:docker://ghcr.io/severinno/ubuntu-bun:1.3.14",
  "ubuntu-22.04:docker://ghcr.io/severinno/ubuntu-bun:1.3.14",
]

/** O que o runner registrou numa subida SAUDÁVEL. */
const REGISTERED = [...DECLARED]

/** Registro VELHO: o nome casa, a imagem é a antiga — o caso invisível. */
const REGISTERED_STALE = [
  "ubuntu-latest:docker://ghcr.io/severinno/ubuntu-bun:1.3.13",
  "ubuntu-22.04:docker://ghcr.io/severinno/ubuntu-bun:1.3.13",
]

/** Registro do estado ANTERIOR à imagem custom (a `node:20-bullseye`). */
const REGISTERED_LEGACY = [
  "ubuntu-latest:docker://node:20-bullseye",
  "ubuntu-22.04:docker://node:20-bullseye",
]

describe("parseLabelEntries", () => {
  it("separa nome e imagem de um label de container", () => {
    expect(parseLabelEntries("ubuntu-latest:docker://ghcr.io/o/img:1.0")).toEqual([
      {
        name: "ubuntu-latest",
        image: "ghcr.io/o/img:1.0",
        raw: "ubuntu-latest:docker://ghcr.io/o/img:1.0",
      },
    ])
  })

  it("quebra no `docker://` e NÃO no primeiro `:` (registry com porta)", () => {
    const [entry] = parseLabelEntries("ubuntu-latest:docker://127.0.0.1:5000/ns/img:1.0")
    expect(entry.name).toBe("ubuntu-latest")
    expect(entry.image).toBe("127.0.0.1:5000/ns/img:1.0")
  })

  it("aceita lista do .runner e string do compose", () => {
    expect(parseLabelEntries(DECLARED)).toHaveLength(2)
    expect(parseLabelEntries(DECLARED.join(","))).toHaveLength(2)
  })

  it("label de HOST entra sem imagem, comparável pelo texto", () => {
    expect(parseLabelEntries("my-host-label")).toEqual([
      { name: "my-host-label", image: null, raw: "my-host-label" },
    ])
  })

  it("ignora espaços e entradas vazias (o `,` final não vira label)", () => {
    expect(parseLabelEntries(" a:docker://x:1 , ").map((e) => e.name)).toEqual(["a"])
    expect(parseLabelEntries("")).toEqual([])
    expect(parseLabelEntries(null)).toEqual([])
  })
})

describe("parseRunnerState", () => {
  it("lê o arquivo de registro (com o campo WARNING do act_runner)", () => {
    const content = JSON.stringify({
      WARNING: "This file is generated by act-runner. Do not edit.",
      id: 1,
      name: "vps-runner",
      labels: REGISTERED_STALE,
    })
    expect(parseRunnerState(content)).toEqual({
      ok: true,
      labels: REGISTERED_STALE,
      detail: "2 label(s)",
    })
  })

  it("registro SEM 'labels' é válido e vazio — não é erro de leitura", () => {
    const state = parseRunnerState(JSON.stringify({ id: 1, token: "x" }))
    expect(state.ok).toBe(true)
    expect(state.labels).toEqual([])
  })

  it("JSON inválido e 'labels' que não é lista são erro de LEITURA (não viram divergência)", () => {
    expect(parseRunnerState("não é json").ok).toBe(false)
    expect(parseRunnerState(JSON.stringify({ labels: "ubuntu-latest" })).ok).toBe(false)
    expect(parseRunnerState("null").ok).toBe(false)
  })
})

describe("compareLabelSets", () => {
  const cmp = (registered: string[]) =>
    compareLabelSets(parseLabelEntries(DECLARED), parseLabelEntries(registered))

  it("idêntico → nenhuma divergência", () => {
    expect(cmp(REGISTERED)).toEqual({ missing: [], mismatch: [], extra: [] })
  })

  it("mesmo NOME com imagem diferente → mismatch (o caso invisível)", () => {
    const diff = cmp(REGISTERED_STALE)
    expect(diff.mismatch).toHaveLength(2)
    expect(diff.mismatch[0].name).toBe("ubuntu-latest")
    expect(diff.mismatch[0].registered).toContain("1.3.13")
    expect(diff.mismatch[0].declared).toContain("1.3.14")
    expect(diff.missing).toEqual([])
    expect(diff.extra).toEqual([])
  })

  it("label declarado ausente do registro → missing", () => {
    const diff = cmp([REGISTERED[0]])
    expect(diff.missing.map((m) => m.name)).toEqual(["ubuntu-22.04"])
    expect(diff.mismatch).toEqual([])
  })

  it("label no registro que o compose não declara → extra", () => {
    const diff = cmp([...REGISTERED, "ubuntu-24.04:docker://ghcr.io/o/img:1.0"])
    expect(diff.extra.map((e) => e.name)).toEqual(["ubuntu-24.04"])
  })

  it("registro VAZIO (runner sem label) → tudo missing", () => {
    const diff = cmp([])
    // A ordem é a do COMPOSE (o que foi declarado), não uma ordenação nossa.
    expect(diff.missing.map((m) => m.name)).toEqual(["ubuntu-latest", "ubuntu-22.04"])
  })

  it("nome repetido com duas imagens não é 'o último vence' — é divergência", () => {
    const diff = compareLabelSets(
      parseLabelEntries("a:docker://x:1,a:docker://x:2"),
      parseLabelEntries("a:docker://x:1"),
    )
    expect(diff.mismatch).toHaveLength(1)
    expect(diff.mismatch[0].declared).toContain("x:2")
  })

  it("label de host é comparado pelo texto cru", () => {
    const diff = compareLabelSets(parseLabelEntries("h"), parseLabelEntries("h2"))
    expect(diff.missing.map((m) => m.name)).toEqual(["h"])
    expect(diff.extra.map((e) => e.name)).toEqual(["h2"])
  })
})

describe("stateMountTarget / stateFilePath", () => {
  it("deriva o diretório do ÚNICO volume nomeado (o socket é bind, não conta)", () => {
    expect(stateMountTarget(RENDER)).toEqual({ ok: true, target: "/data", detail: "/data" })
    expect(stateFilePath("/data")).toBe("/data/.runner")
    expect(stateFilePath("/data/")).toBe("/data/.runner")
  })

  it("dois volumes nomeados → NÃO escolhe: falha alto", () => {
    const two = {
      services: {
        runner: {
          volumes: [
            { type: "volume", source: "runner-data", target: "/data" },
            { type: "volume", source: "cache", target: "/cache" },
          ],
        },
      },
    }
    const mount = stateMountTarget(two)
    expect(mount.ok).toBe(false)
    expect(mount.detail).toContain("/cache")
  })

  it("sem volume nomeado e sem mounts → falha alto (não há onde ler)", () => {
    expect(stateMountTarget({ services: { runner: { volumes: [] } } }).ok).toBe(false)
    expect(stateMountTarget({ services: { runner: {} } }).ok).toBe(false)
    expect(stateMountTarget(null).ok).toBe(false)
  })
})

describe("resolveRunnerContainer", () => {
  it("usa o container_name do COMPOSE (nada cravado no guard)", () => {
    const { run, calls } = makeRun({})
    const res = resolveRunnerContainer({ cwd: "/repo", run, rendered: RENDER })
    expect(res).toEqual({
      ok: true,
      container: "gitea-runner",
      detail: "container_name do compose",
    })
    expect(calls).toEqual([])
  })

  it("sem container_name, procura pelo service label do compose", () => {
    const { run, calls } = makeRun({ ps: ok("vps-runner-1\n") })
    const res = resolveRunnerContainer({
      cwd: "/repo",
      run,
      rendered: { services: { runner: {} } },
    })
    expect(res.container).toBe("vps-runner-1")
    expect(calls[0]).toContain("com.docker.compose.service=runner")
  })

  it("nenhum container rodando → indeterminado, com a razão", () => {
    const { run } = makeRun({ ps: ok("") })
    const res = resolveRunnerContainer({
      cwd: "/repo",
      run,
      rendered: { services: { runner: {} } },
    })
    expect(res.ok).toBe(false)
    expect(res.detail).toContain("nenhum container")
  })
})

describe("checkRunnerLabels — a decisão", () => {
  // A raiz REAL: o guard exige o compose da forja no checkout (e o run é
  // injetado, então nada de docker é executado por causa disso).
  const cwd = process.cwd()

  it("registro == compose → PROVADO, e o cat é o do caminho derivado", () => {
    const { run, calls } = makeRun({ exec: ok(JSON.stringify({ labels: REGISTERED })) })
    const res = checkRunnerLabels({ cwd, run })
    expect(res.state).toBe("proven")
    expect(res.violations).toEqual([])
    expect(res.container).toBe("gitea-runner")
    expect(res.stateFile).toBe("/data/.runner")
    expect(calls).toContain("exec gitea-runner cat /data/.runner")
    expect(exitCodeFor(res)).toBe(EXIT.OK)
  })

  it("registro VELHO (versão anterior) → DIVERGENTE nomeando a imagem de cada lado", () => {
    const { run } = makeRun({ exec: ok(JSON.stringify({ labels: REGISTERED_STALE })) })
    const res = checkRunnerLabels({ cwd, run })
    expect(res.state).toBe("violated")
    expect(exitCodeFor(res)).toBe(EXIT.MISMATCH)
    expect(res.violations).toHaveLength(2)
    expect(res.violations.join("\n")).toContain("1.3.13")
    expect(res.violations.join("\n")).toContain("1.3.14")
    // O remédio NÃO conta como divergência: `violations.length` tem de
    // significar "quantos problemas existem".
    expect(res.remedies.join("\n")).toContain("--re-register")
    expect(renderReport(res)).toContain("não engaja")
  })

  it("registro da imagem LEGADA (node:xx) → DIVERGENTE — o mesmo remédio, outra causa", () => {
    const { run } = makeRun({ exec: ok(JSON.stringify({ labels: REGISTERED_LEGACY })) })
    const res = checkRunnerLabels({ cwd, run })
    expect(res.state).toBe("violated")
    expect(res.violations.join("\n")).toContain("node:20-bullseye")
  })

  it("registro sem o label que o compose declara → DIVERGENTE (runs-on não acha o runner)", () => {
    const { run } = makeRun({ exec: ok(JSON.stringify({ labels: [REGISTERED[0]] })) })
    const res = checkRunnerLabels({ cwd, run })
    expect(res.state).toBe("violated")
    expect(res.violations.join("\n")).toContain("ubuntu-22.04")
  })

  it("registro sem arquivo (runner não registrado) → DIVERGENTE, não indeterminado", () => {
    const { run } = makeRun({
      exec: { status: 1, stdout: "", stderr: "cat: /data/.runner: No such file or directory" },
    })
    const res = checkRunnerLabels({ cwd, run })
    expect(res.state).toBe("violated")
    expect(res.violations.join("\n")).toContain("não tem registro")
    expect(res.remedies.join("\n")).toContain("--re-register")
  })

  it("registro ILEGÍVEL → indeterminado (não é divergência: é não-prova)", () => {
    const { run } = makeRun({ exec: ok("isso não é json") })
    const res = checkRunnerLabels({ cwd, run })
    expect(res.state).toBe("unavailable")
    expect(exitCodeFor(res)).toBe(EXIT.UNKNOWN)
    expect(renderReport(res)).toContain("NÃO PROVADO")
  })

  it("sem docker compose → indeterminado (o guard não inventa um render)", () => {
    const { run } = makeRun({ composeVersion: { status: 1, stdout: "", stderr: "no plugin" } })
    const res = checkRunnerLabels({ cwd, run })
    expect(res.state).toBe("unavailable")
    expect(res.detail).toContain("docker compose indisponível")
    expect(res.declared).toEqual([])
  })

  it("container não encontrado (sem stack no ar) → indeterminado, e NÃO 'sem registro'", () => {
    const { run } = makeRun({
      exec: {
        status: 1,
        stdout: "",
        stderr: "Error response from daemon: No such container: gitea-runner",
      },
    })
    const res = checkRunnerLabels({ cwd, run })
    expect(res.state).toBe("unavailable")
    expect(res.detail).toContain("No such container")
  })

  it("compose sem render do serviço runner → env (não há o que comparar)", () => {
    const { run } = makeRun({ render: ok(JSON.stringify({ services: {} })) })
    const res = checkRunnerLabels({ cwd, run })
    expect(res.state).toBe("env-missing")
    expect(exitCodeFor(res)).toBe(EXIT.ENV)
  })

  it("--container e --state-file permitem olhar fora do derivado do compose", () => {
    const { run, calls } = makeRun({ exec: ok(JSON.stringify({ labels: REGISTERED })) })
    const res = checkRunnerLabels({
      cwd,
      run,
      container: "outro-runner",
      stateFile: "/var/lib/runner/.runner",
    })
    expect(res.container).toBe("outro-runner")
    expect(res.stateFile).toBe("/var/lib/runner/.runner")
    expect(calls).toContain("exec outro-runner cat /var/lib/runner/.runner")
  })
})

describe("parseArgs", () => {
  it("lê as flags e reporta argumento desconhecido", () => {
    expect(parseArgs(["--json", "--gitea-env", "/x/.env"])).toEqual({
      envFile: "/x/.env",
      container: null,
      stateFile: null,
      json: true,
      help: false,
    })
    expect(parseArgs(["--nope"]).error).toContain("--nope")
    expect(parseArgs(["-h"]).help).toBe(true)
  })
})

/**
 * O docker REAL desta máquina, quando o plugin `compose` existe. É o único
 * teste que depende do ambiente — e ele prova que o lado DECLARADO sai do
 * compose do repositório (não de uma fixture).
 */
const HAS_COMPOSE =
  spawnSync("docker", ["compose", "version"], { encoding: "utf8", timeout: 10_000 }).status === 0

describe.skipIf(!HAS_COMPOSE)("o lado declarado, no repositório real", () => {
  it("sai do render do compose: dois labels e a MESMA tag nos dois", () => {
    const declared = declaredLabels({ cwd: process.cwd(), run: spawnSync })
    expect(declared.ok).toBe(true)
    const entries = parseLabelEntries(declared.labels)
    expect(entries.map((e) => e.name)).toEqual(["ubuntu-latest", "ubuntu-22.04"])
    const tags = entries.map((e) => String(e.image).split(":").pop())
    expect(tags.every((t) => t && t !== "null")).toBe(true)
    expect(new Set(tags).size).toBe(1)
  })

  it("no repositório o registro não é comparável (sem a forja no ar) — e isso é indeterminado, nunca 'provado'", () => {
    const res = checkRunnerLabels({ cwd: process.cwd() })
    expect(["proven", "violated", "unavailable"]).toContain(res.state)
    if (res.state !== "proven") expect(exitCodeFor(res)).toBe(EXIT.UNKNOWN)
  })
})
