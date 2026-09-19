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

import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterAll, describe, expect, it } from "vitest"

import {
  DEFAULT_GITHUB_API_URL,
  EXIT,
  checkGithubRunnerLabels,
  checkRunnerLabels,
  compareLabelSets,
  declaredLabels,
  exitCodeFor,
  fetchGithubRunners,
  normalizeLabelEntries,
  parseArgs,
  parseGithubRunnerSetup,
  parseGithubRunners,
  parseLabelEntries,
  parseRunnerState,
  renderReport,
  repoFromUrl,
  resolveRunnerContainer,
  selectGithubRunner,
  shellAssignment,
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

  /**
   * O render do compose com o `GITEA_RUNNER_LABELS` que o teste quiser: uma
   * string (o caso normal), `""` (a variável sobrou VAZIA) ou `null` (a variável
   * não existe no serviço) — os três casos que o guard precisa distinguir.
   */
  const renderWith = (labels: string | null) =>
    ok(
      JSON.stringify({
        services: {
          runner: {
            container_name: "gitea-runner",
            environment: labels === null ? {} : { GITEA_RUNNER_LABELS: labels },
            volumes: [
              { type: "bind", source: "/var/run/docker.sock", target: "/var/run/docker.sock" },
              { type: "volume", source: "runner-data", target: "/data" },
            ],
          },
        },
      }),
    )

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

  it("runner RODANDO sem NENHUM label registrado → DIVERGENTE, numa violação só (runner órfão)", () => {
    // O caso que passava por "2 labels faltando" — e que na verdade é UM
    // problema com causa própria: o registro subiu vazio. Listar os dois labels
    // do compose como problemas separados esconde a causa raiz.
    const { run } = makeRun({ exec: ok(JSON.stringify({ labels: [] })) })
    const res = checkRunnerLabels({ cwd, run })
    expect(res.state).toBe("violated")
    expect(exitCodeFor(res)).toBe(EXIT.MISMATCH)
    expect(res.violations).toHaveLength(1)
    expect(res.violations[0]).toContain("NENHUM label registrado")
    expect(res.violations[0]).toContain("órfão")
    expect(res.violations[0]).toContain("nenhum job é atribuído")
    expect(res.registered).toEqual([])
    expect(res.remedies.join("\n")).toContain("--re-register")
    // O relatório mostra os DOIS lados — um lado vazio é informação, não omissão.
    expect(renderReport(res)).toContain("registrado no runner   : <nenhum>")
    expect(renderReport(res)).toContain("ubuntu-latest:docker://")
  })

  it("registro sem o campo 'labels' (arquivo válido) → o MESMO runner órfão", () => {
    const { run } = makeRun({ exec: ok(JSON.stringify({ id: 1, name: "vps-runner" })) })
    const res = checkRunnerLabels({ cwd, run })
    expect(res.state).toBe("violated")
    expect(res.violations).toHaveLength(1)
    expect(res.violations[0]).toContain("órfão")
  })

  it("compose SEM GITEA_RUNNER_LABELS e registro vazio → DIVERGENTE (prova vácua nunca é ✅)", () => {
    // O verde falso que este teste tranca: "0 label(s) registrados idênticos ao
    // compose" com ZERO dos dois lados. Sem objeto, não há prova nenhuma — e o
    // runner, do mesmo jeito, não recebe job algum.
    const { run } = makeRun({ render: renderWith(null), exec: ok(JSON.stringify({ labels: [] })) })
    const res = checkRunnerLabels({ cwd, run })
    expect(res.state).toBe("violated")
    expect(exitCodeFor(res)).toBe(EXIT.MISMATCH)
    expect(res.declared).toEqual([])
    expect(res.registered).toEqual([])
    expect(res.violations).toHaveLength(1)
    expect(res.violations[0]).toContain("NÃO declara GITEA_RUNNER_LABELS")
    expect(res.violations[0]).toContain("runner órfão")
    expect(res.remedies.join("\n")).toContain("declare GITEA_RUNNER_LABELS")
    expect(res.detail).toContain("não tem labels a comparar")
    expect(renderReport(res)).not.toContain("✅")
  })

  it("compose com a variável VAZIA e registro com labels → DIVERGENTE pelo COMPOSE (não 'resíduo')", () => {
    const { run } = makeRun({
      render: renderWith(""),
      exec: ok(JSON.stringify({ labels: [REGISTERED[0]] })),
    })
    const res = checkRunnerLabels({ cwd, run })
    expect(res.state).toBe("violated")
    expect(res.violations).toHaveLength(1)
    expect(res.violations[0]).toContain("declara GITEA_RUNNER_LABELS VAZIO")
    // O diagnóstico antigo dizia "resíduo de um registro anterior ou label
    // adicionado à mão" — a causa aqui é a variável vazia, e o remédio muda.
    expect(res.violations.join("\n")).not.toContain("resíduo")
    expect(res.remedies[0]).toContain("declare GITEA_RUNNER_LABELS")
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
      forge: "gitea",
      envFile: "/x/.env",
      container: null,
      stateFile: null,
      ghRepo: null,
      runnerName: null,
      json: true,
      help: false,
    })
    expect(parseArgs(["--nope"]).error).toContain("--nope")
    expect(parseArgs(["-h"]).help).toBe(true)
  })

  it("a forja default é a do act_runner (o smoke continua sendo o mesmo comando)", () => {
    expect(parseArgs([]).forge).toBe("gitea")
    expect(parseArgs(["--forge", "github", "--runner-name", "x"]).runnerName).toBe("x")
  })

  it("flag de uma forja na outra é ERRO — ignorar compararia outra coisa que a pedida", () => {
    expect(parseArgs(["--forge", "github", "--gitea-env", "/x"]).error).toContain("--gitea-env")
    expect(parseArgs(["--gh-repo", "a/b"]).error).toContain("--gh-repo")
    expect(parseArgs(["--forge", "gitlab"]).error).toContain("--forge aceita")
  })

  it("flag de valor ENGOLIDA como valor é erro (senão ela vira o próprio valor)", () => {
    expect(parseArgs(["--gh-repo", "--json"]).error).toContain("--gh-repo exige um valor")
    expect(parseArgs(["--runner-name"]).error).toContain("--runner-name exige um valor")
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// O runner auto-hospedado do GitHub: o registro vive no SERVIDOR, não em
// arquivo — e é por isso que a comparação precisa da API.
// ═══════════════════════════════════════════════════════════════════════════

const tmpDirs: string[] = []

afterAll(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** Um checkout sintético com o script de setup que o teste quiser. */
function githubRepo(script: string): string {
  const dir = mkdtempSync(join(tmpdir(), "github-runner-"))
  tmpDirs.push(dir)
  mkdirSync(join(dir, "deploy"), { recursive: true })
  writeFileSync(join(dir, "deploy", "setup-github-runner.sh"), script)
  return dir
}

/** O script REAL do repositório (a fonte única dos labels, do nome e do repo). */
const REAL_SETUP = `
RUNNER_NAME="hostinger-runner"
RUNNER_LABELS="self-hosted,linux,x64,docker"
REPO_URL="https://github.com/severinno/severinno"
`

/** Um runner como a API devolve: os labels `read-only` vêm com a caixa do GitHub. */
const RUNNER_ONLINE = {
  id: 7,
  name: "hostinger-runner",
  status: "online",
  labels: ["self-hosted", "Linux", "X64", "docker"].map((name) => ({
    id: 1,
    name,
    type: "custom",
  })),
}

/**
 * O runner na forma que a DECISÃO usa: `parseGithubRunners` é quem converte
 * `labels: [{name}]` (a API) em `labels: [nome]`. Os testes de seleção falam
 * essa língua, para não testar um tipo que o guard nunca vê.
 */
function parsedRunner(
  over: Partial<{ id: number; name: string; status: string; labels: string[] }> = {},
) {
  return {
    id: 7,
    name: "hostinger-runner",
    status: "online",
    labels: ["self-hosted", "Linux", "X64", "docker"],
    ...over,
  }
}

/** Um `fetch` dublê que devolve um payload do endpoint de runners. */
function fetchWith(runners: unknown[], extra: { status?: number; body?: string } = {}) {
  const calls: string[] = []
  const fetchImpl = async (url: string) => {
    calls.push(url)
    if (extra.status && extra.status !== 200) {
      return {
        ok: false,
        status: extra.status,
        text: async () => extra.body ?? "nope",
        json: async () => ({}),
      }
    }
    return {
      ok: true,
      status: 200,
      text: async () => "",
      json: async () => ({ total_count: runners.length, runners }),
    }
  }
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls }
}

describe("shellAssignment / repoFromUrl — a fonte única do lado declarado", () => {
  it("lê a atribuição de shell (com e sem aspas), e ignora a menção em comentário", () => {
    expect(shellAssignment(REAL_SETUP, "RUNNER_LABELS")).toBe("self-hosted,linux,x64,docker")
    expect(shellAssignment("RUNNER_NAME=hostinger-runner\n", "RUNNER_NAME")).toBe(
      "hostinger-runner",
    )
    expect(shellAssignment("RUNNER_NAME='x y'\n", "RUNNER_NAME")).toBe("x y")
    // A linha INTEIRA importa: um `echo "RUNNER_LABELS=..."` num comentário não
    // pode virar a declaração (o guard leria um valor que ninguém registra).
    expect(shellAssignment('# RUNNER_LABELS="a,b"\n', "RUNNER_LABELS")).toBeNull()
    expect(shellAssignment("RUNNER_LABELS=\n", "RUNNER_LABELS")).toBe("")
    expect(shellAssignment("", "RUNNER_LABELS")).toBeNull()
  })

  it("deriva owner/repo da URL do repositório (e recusa o que não é URL)", () => {
    expect(repoFromUrl("https://github.com/severinno/severinno")).toBe("severinno/severinno")
    expect(repoFromUrl("https://github.com/severinno/severinno.git")).toBe("severinno/severinno")
    expect(repoFromUrl("https://github.com/severinno/severinno/")).toBe("severinno/severinno")
    expect(repoFromUrl("severinno/severinno")).toBeNull()
    expect(repoFromUrl("")).toBeNull()
  })

  it("o script REAL do repositório declara 4 labels, um nome e um repo", () => {
    const setup = parseGithubRunnerSetup(
      readFileSync(join(process.cwd(), "deploy", "setup-github-runner.sh"), "utf8"),
    )
    expect(setup.entries.map((e) => e.raw)).toEqual(["self-hosted", "linux", "x64", "docker"])
    expect(setup.name).toBe("hostinger-runner")
    expect(setup.repo).toBe("severinno/severinno")
  })
})

describe("normalizeLabelEntries — caixa é irrelevante (e o raw continua o original)", () => {
  it("`linux` × `Linux` NÃO é divergência; o relatório mostra o original", () => {
    const declared = normalizeLabelEntries(parseLabelEntries("self-hosted,linux,x64"))
    const registered = normalizeLabelEntries(parseLabelEntries("self-hosted,Linux,X64"))
    expect(compareLabelSets(declared, registered)).toEqual({ missing: [], mismatch: [], extra: [] })
    expect(registered.map((e) => e.raw)).toEqual(["self-hosted", "Linux", "X64"])
  })

  it("um label de HOST tem o texto normalizado como valor comparável", () => {
    // Sem isso, `linux` × `Linux` cairia em `mismatch` (o valor de um label sem
    // `docker://` é o TEXTO — `compareLabelSets` usa `image ?? raw`).
    expect(normalizeLabelEntries(parseLabelEntries("Linux"))[0].image).toBe("linux")
  })
})

describe("parseGithubRunners / selectGithubRunner", () => {
  it("lê nome, status e labels do payload da API", () => {
    const parsed = parseGithubRunners({ runners: [RUNNER_ONLINE] })
    expect(parsed.ok).toBe(true)
    expect(parsed.runners?.[0].name).toBe("hostinger-runner")
    expect(parsed.runners?.[0].status).toBe("online")
    expect(parsed.runners?.[0].labels).toEqual(["self-hosted", "Linux", "X64", "docker"])
  })

  it("payload sem a lista 'runners' NÃO é lista vazia (é resposta que não entendemos)", () => {
    expect(parseGithubRunners({ total_count: 0 }).ok).toBe(false)
    expect(parseGithubRunners(null).ok).toBe(false)
  })

  it("escolhe pelo NOME declarado, sem diferenciar caixa", () => {
    const runners = [parsedRunner({ name: "HOSTINGER-RUNNER" })]
    expect(selectGithubRunner(runners, "hostinger-runner").runner?.name).toBe("HOSTINGER-RUNNER")
  })

  it("nome declarado que não existe → divergente, nomeando o que EXISTE", () => {
    const sel = selectGithubRunner([parsedRunner({ name: "outro" })], "hostinger-runner")
    expect(sel.ok).toBe(false)
    expect(sel.state).toBe("missing")
    expect(sel.detail).toContain("outro")
  })

  it("nenhum runner registrado → estado próprio (não é 'nome não encontrado')", () => {
    expect(selectGithubRunner([], "x").state).toBe("none")
  })

  it("AMBIGUIDADE É FALHA: vários runners e sem RUNNER_NAME o guard não escolhe", () => {
    const sel = selectGithubRunner([parsedRunner({ name: "a" }), parsedRunner({ name: "b" })], null)
    expect(sel.ok).toBe(false)
    expect(sel.state).toBe("ambiguous")
    expect(sel.detail).toContain("RUNNER_NAME")
  })

  it("com UM runner registrado e sem nome declarado, ele é o escolhido", () => {
    expect(selectGithubRunner([parsedRunner()], null).runner?.name).toBe("hostinger-runner")
  })
})

describe("fetchGithubRunners — a leitura é a API, e ela pode NÃO acontecer", () => {
  it("200 → o payload, e a URL montada a partir do repo", async () => {
    const { fetchImpl, calls } = fetchWith([RUNNER_ONLINE])
    const res = await fetchGithubRunners({
      repo: "o/r",
      token: "t",
      apiUrl: DEFAULT_GITHUB_API_URL,
      fetchImpl,
    })
    expect(res.ok).toBe(true)
    expect(calls[0]).toBe("https://api.github.com/repos/o/r/actions/runners")
  })

  it("erro de rede → 'não olhei' (nunca 'está certo')", async () => {
    const fetchImpl = (async () => {
      throw new Error("getaddrinfo ENOTFOUND")
    }) as unknown as typeof fetch
    const res = await fetchGithubRunners({ repo: "o/r", token: "t", fetchImpl })
    expect(res.ok).toBe(false)
    expect(res.detail).toContain("ENOTFOUND")
  })

  it("403 → diz POR QUE (a permissão que o GITHUB_TOKEN de um run não tem)", async () => {
    const { fetchImpl } = fetchWith([], {
      status: 403,
      body: "Resource not accessible by integration",
    })
    const res = await fetchGithubRunners({ repo: "o/r", token: "t", fetchImpl })
    expect(res.ok).toBe(false)
    expect(res.detail).toContain("403")
    expect(res.detail).toContain("SELF-HOSTED RUNNERS")
  })

  it("corpo que não é JSON → não olhei (não inventa lista vazia)", async () => {
    const fetchImpl = (async () => ({
      ok: true,
      status: 200,
      text: async () => "<html>",
      json: async () => {
        throw new Error("Unexpected token <")
      },
    })) as unknown as typeof fetch
    expect((await fetchGithubRunners({ repo: "o/r", token: "t", fetchImpl })).ok).toBe(false)
  })
})

describe("checkGithubRunnerLabels — a decisão", () => {
  const cwd = githubRepo(REAL_SETUP)
  const ENV = { GH_TOKEN: "token" }

  it("registro == setup → PROVADO (com a caixa do GitHub no registro)", async () => {
    const { fetchImpl } = fetchWith([RUNNER_ONLINE])
    const res = await checkGithubRunnerLabels({ cwd, env: ENV, fetchImpl })
    expect(res.state).toBe("proven")
    expect(res.violations).toEqual([])
    expect(exitCodeFor(res)).toBe(EXIT.OK)
    expect(res.runner).toBe("hostinger-runner")
    expect(res.status).toBe("online")
    // O relatório mostra os DOIS lados, cada um com a caixa ORIGINAL.
    const report = renderReport(res)
    expect(report).toContain("self-hosted , Linux , X64 , docker")
    expect(report).toContain("self-hosted , linux , x64 , docker")
  })

  it("registro VELHO (sem o label 'docker') → DIVERGENTE, e diz que o job ESPERA", async () => {
    const { fetchImpl } = fetchWith([{ ...RUNNER_ONLINE, labels: [{ name: "self-hosted" }] }])
    const res = await checkGithubRunnerLabels({ cwd, env: ENV, fetchImpl })
    expect(res.state).toBe("violated")
    expect(exitCodeFor(res)).toBe(EXIT.MISMATCH)
    expect(res.violations.join("\n")).toContain("docker")
    expect(res.violations.join("\n")).toContain("ESPERA")
    expect(res.remedies.join("\n")).toContain("setup-github-runner.sh")
  })

  it("label a mais no registro → DIVERGENTE (resíduo de um config.sh à mão)", async () => {
    const { fetchImpl } = fetchWith([
      { ...RUNNER_ONLINE, labels: [...RUNNER_ONLINE.labels, { name: "gpu" }] },
    ])
    const res = await checkGithubRunnerLabels({ cwd, env: ENV, fetchImpl })
    expect(res.state).toBe("violated")
    expect(res.violations.join("\n")).toContain("gpu")
    expect(res.violations.join("\n")).toContain("resíduo")
  })

  it("registro VAZIO → UMA violação (runner órfão), não quatro 'faltando'", async () => {
    const { fetchImpl } = fetchWith([{ ...RUNNER_ONLINE, labels: [] }])
    const res = await checkGithubRunnerLabels({ cwd, env: ENV, fetchImpl })
    expect(res.state).toBe("violated")
    expect(res.violations).toHaveLength(1)
    expect(res.violations[0]).toContain("órfão")
    expect(res.registered).toEqual([])
  })

  it("OFFLINE é divergente com remédio PRÓPRIO (existe no painel, não pega job)", async () => {
    const { fetchImpl } = fetchWith([{ ...RUNNER_ONLINE, status: "offline" }])
    const res = await checkGithubRunnerLabels({ cwd, env: ENV, fetchImpl })
    expect(res.state).toBe("violated")
    expect(res.violations).toHaveLength(1)
    expect(res.violations[0]).toContain("offline")
    expect(res.violations[0]).toContain("no runner available")
    expect(res.remedies.join("\n")).toContain("systemctl restart")
  })

  it("offline E sem label → DOIS problemas, dois remédios (violations.length = problemas)", async () => {
    const { fetchImpl } = fetchWith([{ ...RUNNER_ONLINE, status: "offline", labels: [] }])
    const res = await checkGithubRunnerLabels({ cwd, env: ENV, fetchImpl })
    expect(res.violations).toHaveLength(2)
    expect(res.remedies.join("\n")).toContain("systemctl restart")
    expect(res.remedies.join("\n")).toContain("setup-github-runner.sh")
  })

  it("NENHUM runner registrado → DIVERGENTE (o workflow espera para sempre)", async () => {
    const { fetchImpl } = fetchWith([])
    const res = await checkGithubRunnerLabels({ cwd, env: ENV, fetchImpl })
    expect(res.state).toBe("violated")
    expect(res.violations.join("\n")).toContain("nenhum runner auto-hospedado registrado")
    expect(res.violations.join("\n")).toContain("ESPERANDO")
    expect(res.remedies.join("\n")).toContain("setup-github-runner.sh")
  })

  it("runner com OUTRO nome → divergente nomeando o que existe", async () => {
    const { fetchImpl } = fetchWith([{ ...RUNNER_ONLINE, name: "outro" }])
    const res = await checkGithubRunnerLabels({ cwd, env: ENV, fetchImpl })
    expect(res.state).toBe("violated")
    expect(res.violations.join("\n")).toContain("outro")
  })

  it("--runner-name manda sobre o nome do script (para inquirir outro runner)", async () => {
    const { fetchImpl } = fetchWith([{ ...RUNNER_ONLINE, name: "outro" }])
    const res = await checkGithubRunnerLabels({ cwd, env: ENV, runnerName: "outro", fetchImpl })
    expect(res.state).toBe("proven")
  })

  it("script SEM RUNNER_LABELS → DIVERGENTE sem tocar na rede (a declaração é legível aqui)", async () => {
    const dir = githubRepo('RUNNER_NAME="r"\nREPO_URL="https://github.com/a/b"\n')
    const { fetchImpl, calls } = fetchWith([RUNNER_ONLINE])
    const res = await checkGithubRunnerLabels({ cwd: dir, env: ENV, fetchImpl })
    expect(res.state).toBe("violated")
    expect(exitCodeFor(res)).toBe(EXIT.MISMATCH)
    expect(res.violations[0]).toContain("NÃO declara RUNNER_LABELS")
    expect(res.remedies.join("\n")).toContain("declare RUNNER_LABELS")
    expect(calls).toEqual([])
  })

  it("RUNNER_LABELS VAZIO → o mesmo problema, com o diagnóstico próprio", async () => {
    const dir = githubRepo('RUNNER_LABELS=""\nREPO_URL="https://github.com/a/b"\n')
    const res = await checkGithubRunnerLabels({ cwd: dir, env: ENV, ...fetchWith([RUNNER_ONLINE]) })
    expect(res.state).toBe("violated")
    expect(res.violations[0]).toContain("VAZIO")
  })

  it("script ausente no checkout → env (não há runner do GitHub declarado aqui)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "github-runner-"))
    tmpDirs.push(dir)
    const res = await checkGithubRunnerLabels({ cwd: dir, env: ENV })
    expect(res.state).toBe("env-missing")
    expect(exitCodeFor(res)).toBe(EXIT.ENV)
  })

  it("repo DESCONHECIDO (script sem REPO_URL e sem GITHUB_REPOSITORY) → env, não palpite", async () => {
    const dir = githubRepo('RUNNER_LABELS="self-hosted"\n')
    const res = await checkGithubRunnerLabels({ cwd: dir, env: ENV, ...fetchWith([RUNNER_ONLINE]) })
    expect(res.state).toBe("env-missing")
    expect(res.detail).toContain("--gh-repo")
  })

  it("SEM TOKEN → INDETERMINADO (3), nunca 'em sincronia'", async () => {
    const { fetchImpl, calls } = fetchWith([RUNNER_ONLINE])
    const res = await checkGithubRunnerLabels({ cwd, env: {}, fetchImpl })
    expect(res.state).toBe("unavailable")
    expect(exitCodeFor(res)).toBe(EXIT.UNKNOWN)
    expect(res.detail).toContain("GITHUB_TOKEN")
    expect(calls).toEqual([])
    expect(renderReport(res)).toContain("NÃO PROVADO")
  })

  it("HTTP 403 → INDETERMINADO com o escopo que falta", async () => {
    const res = await checkGithubRunnerLabels({
      cwd,
      env: ENV,
      ...fetchWith([], { status: 403, body: "Resource not accessible by integration" }),
    })
    expect(res.state).toBe("unavailable")
    expect(exitCodeFor(res)).toBe(EXIT.UNKNOWN)
    expect(res.detail).toContain("SELF-HOSTED RUNNERS")
  })

  it("GITHUB_REPOSITORY do ambiente serve quando o script não declara REPO_URL", async () => {
    const dir = githubRepo('RUNNER_LABELS="self-hosted"\n')
    const res = await checkGithubRunnerLabels({
      cwd: dir,
      env: { ...ENV, GITHUB_REPOSITORY: "o/r" },
      ...fetchWith([{ ...RUNNER_ONLINE, name: "a", labels: [{ name: "self-hosted" }] }]),
    })
    expect(res.state).toBe("proven")
    expect(res.repo).toBe("o/r")
  })
})

describe("CLI — `--forge github` contra uma API dublada de verdade", () => {
  type CliResult = { status: number | null; stdout: string; stderr: string }

  /**
   * O CLI em processo SEPARADO e de forma ASSÍNCRONA: com `spawnSync` o event
   * loop ficaria bloqueado e o servidor desta mesma suíte não conseguiria
   * responder — o teste travaria até o timeout (o deadlock que esta suíte já
   * cometeu uma vez).
   */
  function runCli(apiUrl: string, extraEnv: Record<string, string> = {}): Promise<CliResult> {
    return new Promise((resolve) => {
      // O env do filho sai do ambiente REAL (NODE_ENV etc. são tipados como
      // obrigatórios), sem as credenciais — cada caso pede as suas.
      const base: NodeJS.ProcessEnv = { ...process.env }
      delete base.GITHUB_TOKEN
      delete base.GH_TOKEN
      const child: ChildProcess = spawn(
        "node",
        ["scripts/check-runner-labels.mjs", "--forge", "github"],
        {
          cwd: process.cwd(),
          env: { ...base, GITHUB_TOKEN: "t", GITHUB_API_URL: apiUrl, ...extraEnv },
        },
      )
      let stdout = ""
      let stderr = ""
      child.stdout?.on("data", (d: Buffer) => (stdout += String(d)))
      child.stderr?.on("data", (d: Buffer) => (stderr += String(d)))
      child.on("close", (status: number | null) => resolve({ status, stdout, stderr }))
    })
  }

  /**
   * Um servidor HTTP no loopback no lugar da API do GitHub: é o MESMO caminho
   * que o CLI usa (fetch → GITHUB_API_URL), e é o que torna a prova repetível
   * sem tocar em github.com.
   */
  async function withApi(runners: unknown[], fn: (apiUrl: string) => Promise<void>) {
    const server = createServer((req, res) => {
      if (!String(req.url).includes("/actions/runners")) {
        res.writeHead(404).end("nope")
        return
      }
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify({ total_count: runners.length, runners }))
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const port = (server.address() as { port: number }).port
    try {
      await fn(`http://127.0.0.1:${port}`)
    } finally {
      server.close()
    }
  }

  it("registro igual ao setup → exit 0, e o relatório é o do GitHub", async () => {
    await withApi([RUNNER_ONLINE], async (apiUrl) => {
      const res = await runCli(apiUrl)
      expect(res.status).toBe(0)
      expect(res.stdout).toContain("check-runner-labels[github]: ✅")
      expect(res.stdout).toContain("repos/severinno/severinno/actions/runners")
    })
  })

  it("registro velho → exit 1, com o remédio do script de setup", async () => {
    await withApi([{ ...RUNNER_ONLINE, labels: [{ name: "self-hosted" }] }], async (apiUrl) => {
      const res = await runCli(apiUrl)
      expect(res.status).toBe(1)
      expect(res.stdout).toContain("check-runner-labels[github]: ❌")
      expect(res.stdout).toContain("setup-github-runner.sh")
    })
  })

  it("sem token → exit 3 (a API nem é chamada)", async () => {
    await withApi([RUNNER_ONLINE], async (apiUrl) => {
      const res = await runCli(apiUrl, { GITHUB_TOKEN: "" })
      expect(res.status).toBe(3)
      expect(res.stdout).toContain("NÃO PROVADO")
    })
  })
})

describe("CLI — uso inválido (sem rede, sem servidor)", () => {
  it("flag da forja no check do GitHub → exit 2, e o erro diz qual flag", () => {
    const res = spawnSync(
      "node",
      ["scripts/check-runner-labels.mjs", "--forge", "github", "--gitea-env", "/x"],
      { cwd: process.cwd(), encoding: "utf8", timeout: 60_000 },
    )
    expect(res.status).toBe(2)
    expect(res.stderr).toContain("--gitea-env")
    expect(res.stderr).toContain("Uso:")
  })

  it("`--forge github` no repositório real sem token → 3 (e o texto diz o escopo que falta)", () => {
    // Um ambiente SEM credencial: as variáveis de token são REMOVIDAS do
    // ambiente do processo, senão o teste passaria a depender da máquina.
    const env: NodeJS.ProcessEnv = { ...process.env, PATH: process.env.PATH ?? "" }
    delete env.GITHUB_TOKEN
    delete env.GH_TOKEN
    const res = spawnSync("node", ["scripts/check-runner-labels.mjs", "--forge", "github"], {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 60_000,
      env,
    })
    expect(res.status).toBe(3)
    expect(res.stdout).toContain("SELF-HOSTED RUNNERS")
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
