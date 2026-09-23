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
  RUNNER_CONTAINER_ENV,
  checkGithubRunnerLabels,
  checkRunnerLabels,
  compareActRunnerVersion,
  compareLabelSets,
  compareRunnerVersion,
  normalizeRunnerVersion,
  declaredLabels,
  exitCodeFor,
  fetchGithubRunners,
  imageDigest,
  imageTag,
  isVersionTag,
  normalizeLabelEntries,
  parseArgs,
  parseGithubRunnerSetup,
  parseGithubRunners,
  parseLabelEntries,
  parseRunnerBinaryVersion,
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
  version?: RunResult
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
    // O MESMO `docker exec` responde DUAS perguntas: o `cat` do registro e o
    // `act_runner --version`. Elas se distinguem pelo binário chamado, e é assim
    // que um teste estraga só uma delas.
    if (args[0] === "exec" && args.includes("act_runner")) {
      return handlers.version ?? ok("act_runner version v0.6.1")
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

  it("o DECLARADO vence o container_name do compose — e a FONTE sai dita", () => {
    // A SONDA: um container de teste, com o nome que o ensaio escolher. O nome
    // da stack (`gitea-runner`, no render) NÃO é tomado nem exigido.
    const { run, calls } = makeRun({})
    const res = resolveRunnerContainer({
      cwd: "/repo",
      run,
      rendered: RENDER,
      declarado: "sonda-do-ensaio",
    })
    expect(res).toEqual({
      ok: true,
      container: "sonda-do-ensaio",
      detail: `declarado por ${RUNNER_CONTAINER_ENV}`,
    })
    expect(calls).toEqual([]) // nem um `docker` foi chamado para descobrir o nome
  })

  it("o declarado em BRANCO (espaços, string vazia) cai para o compose: não é declaração", () => {
    const { run } = makeRun({})
    for (const vazio of ["", "   ", null, undefined]) {
      const res = resolveRunnerContainer({ cwd: "/repo", run, rendered: RENDER, declarado: vazio })
      expect(res.container).toBe("gitea-runner")
      expect(res.detail).toBe("container_name do compose")
    }
  })

  it("a variável declarada chega pelo `env` do guard, e `--container` ganha dela", () => {
    const { run } = makeRun({})
    // a variável sozinha (o caminho do doctor, que a herda do ambiente)
    const viaEnv = resolveRunnerContainer({
      cwd: "/repo",
      run,
      rendered: RENDER,
      declarado: "sonda-via-env",
    })
    expect(viaEnv.container).toBe("sonda-via-env")
    expect(viaEnv.detail).toContain(RUNNER_CONTAINER_ENV)
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

// ── A VERSÃO do binário × a TAG do compose (o irmão do pin do GitHub) ──────

describe("parseRunnerBinaryVersion — a saída do PRÓPRIO binário", () => {
  it("lê a versão da forma que o act_runner imprime, e normaliza o `v`", () => {
    expect(parseRunnerBinaryVersion("act_runner version v0.6.1")).toBe("0.6.1")
    expect(parseRunnerBinaryVersion("v0.2.11\n")).toBe("0.2.11")
  })

  it("tolera ruído na MESMA linha (é a linha do binário, não um formato nosso)", () => {
    expect(parseRunnerBinaryVersion("act_runner version v0.6.1 (build 48f4b0a)")).toBe("0.6.1")
  })

  it("saída sem versão → null (quem lê diz 'não li', nunca 'em sincronia')", () => {
    expect(parseRunnerBinaryVersion("")).toBeNull()
    expect(parseRunnerBinaryVersion(null)).toBeNull()
    expect(parseRunnerBinaryVersion("act_runner version dev")).toBeNull()
  })
})

describe("imageTag / imageDigest — o que a referência DECLARA", () => {
  it("a tag é o que vem DEPOIS da última barra (a porta do registry não confunde)", () => {
    expect(imageTag("gitea/act_runner:latest")).toBe("latest")
    expect(imageTag("git.severinno.cloud:3000/severinno/act_runner:0.6.1")).toBe("0.6.1")
    expect(imageTag("localhost:5000/gitea/act_runner")).toBeNull()
    expect(imageTag("gitea/act_runner")).toBeNull()
    expect(imageTag("")).toBeNull()
  })

  it("um DIGEST não é uma tag (o hash como 'tag' acusaria uma tag que não existe)", () => {
    const hash = `sha256:${"a".repeat(64)}`
    expect(imageDigest(`ghcr.io/severinno/act_runner@${hash}`)).toBe(hash)
    expect(imageTag(`ghcr.io/severinno/act_runner@${hash}`)).toBeNull()
    expect(imageTag(`ghcr.io/severinno/act_runner:0.6.1@${hash}`)).toBeNull()
    expect(imageDigest("ghcr.io/severinno/act_runner:0.6.1")).toBeNull()
  })

  it("`isVersionTag` é a FORMA, não uma lista de nomes flutuantes", () => {
    expect(isVersionTag("0.6.1")).toBe(true)
    expect(isVersionTag("v0.6.1")).toBe(true)
    expect(isVersionTag("latest")).toBe(false)
    expect(isVersionTag("stable")).toBe(false)
    expect(isVersionTag(null)).toBe(false)
  })
})

describe("compareActRunnerVersion — a versão do binário × a tag do compose", () => {
  const cmp = (declaredImage: string, reported: string | null = null) =>
    compareActRunnerVersion({ declaredImage, reported, container: "gitea-runner" })

  it("a tag pina a versão que o binário reporta → PROVADO (o `v` e espaço não são drift)", () => {
    expect(cmp("gitea/act_runner:0.6.1", "v0.6.1").state).toBe("proven")
    expect(cmp("gitea/act_runner:v0.6.1", " 0.6.1 ").state).toBe("proven")
    expect(cmp("git.severinno.cloud:3000/severinno/act_runner:0.6.1", "v0.6.1").state).toBe(
      "proven",
    )
  })

  it("o binário reporta OUTRA versão → DRIFT, nomeando os dois lados", () => {
    const r = cmp("gitea/act_runner:0.2.11", "v0.6.1")
    expect(r.state).toBe("drift")
    expect(r.tag).toBe("0.2.11")
    expect(r.reported).toBe("0.6.1")
    expect(r.detail).toContain("o que RODA nao e o que o repositorio declara")
  })

  it("`latest` NÃO pina versão → FLOATING: declaração pendente, nem verde nem divergência", () => {
    const r = cmp("gitea/act_runner:latest", "v0.6.1")
    expect(r.state).toBe("floating")
    expect(r.tag).toBe("latest")
    expect(r.reported).toBe("0.6.1")
    // O que a prosa DIZ: a versão que roda é a que o pull do dia tiver servido.
    expect(r.detail).toContain("docker pull do dia")
  })

  it("DIGEST: o conteúdo é imutável, mas um digest não declara VERSÃO → `digest` (não `floating`)", () => {
    const hash = `sha256:${"a".repeat(64)}`
    const r = cmp(`ghcr.io/severinno/act_runner@${hash}`, "v0.6.1")
    expect(r.state).toBe("digest")
    // A frase do `floating` seria FALSA aqui (num pin imutável não há "a versão
    // que roda é a que o pull do dia tiver servido"): o estado existe para o
    // relatório não afirmar isso, e a prova é a AUSÊNCIA da frase.
    expect(r.detail).not.toContain("tiver servido")
    expect(r.detail).toContain("IMUTAVEL")
    expect(r.detail).toContain("NAO declara VERSAO")
    // Com tag E digest, a tag continua sendo informação — mas não decide o estado.
    const ambos = cmp(`ghcr.io/severinno/act_runner:0.6.1@${hash}`, "0.6.1")
    expect(ambos.tag).toBe("0.6.1")
    expect(ambos.state).toBe("digest")
  })

  it("imagem SEM tag cai em `floating` (o docker assume `latest`) — e sem imagem é `no-image`", () => {
    expect(cmp("gitea/act_runner", "v0.6.1").state).toBe("floating")
    expect(cmp("gitea/act_runner", "v0.6.1").tag).toBeNull()
    expect(cmp("", "v0.6.1").state).toBe("no-image")
  })

  it("o que NÃO foi julgado tem estado próprio: `unread` (a versão não foi lida)", () => {
    const r = cmp("gitea/act_runner:0.6.1", null)
    expect(r.state).toBe("unread")
    expect(r.detail).toContain("NAO foi lida")
  })
})

describe("checkRunnerLabels — a VERSÃO do binário, ao lado do registro", () => {
  const cwd = process.cwd()

  /** O render com a IMAGEM do serviço: é ela que declara a versão a comparar. */
  const renderWith = (image: string | null) =>
    ok(
      JSON.stringify({
        services: {
          runner: {
            container_name: "gitea-runner",
            ...(image === null ? {} : { image }),
            environment: { GITEA_RUNNER_LABELS: DECLARED.join(",") },
            volumes: [
              { type: "bind", source: "/var/run/docker.sock", target: "/var/run/docker.sock" },
              { type: "volume", source: "runner-data", target: "/data" },
            ],
          },
        },
      }),
    )

  it("labels ÍNTEGROS e o binário em outra versão → DIVERGENTE com o remédio da IMAGEM", () => {
    // O drift do binário é um problema PRÓPRIO: `violations` (labels) fica vazio
    // — re-registrar não muda a versão de um milímetro —, e o remédio é o da tag.
    const { run } = makeRun({
      render: renderWith("gitea/act_runner:0.2.11"),
      version: ok("act_runner version v0.6.1"),
    })
    const res = checkRunnerLabels({ cwd, run })
    expect(res.state).toBe("violated")
    expect(exitCodeFor(res)).toBe(EXIT.MISMATCH)
    expect(res.violations).toEqual([])
    expect(res.versionViolations).toHaveLength(1)
    expect(res.versionViolations[0]).toContain("0.6.1")
    expect(res.versionViolations[0]).toContain("0.2.11")
    expect(res.remedies.join("\n")).toContain("alinhe a tag da imagem do runner")
    expect(res.detail).toContain("roda outra versao")
  })

  it("labels íntegros + tag flutuante (`latest`) → PROVADO, com a versão saindo como declaração pendente", () => {
    // O `latest` NÃO bloqueia: é uma declaração que o repositório ainda não fez.
    // Quem a publica como não-provado é o doctor; o guard não inventa um defeito.
    const { run } = makeRun({ render: renderWith("gitea/act_runner:latest") })
    const res = checkRunnerLabels({ cwd, run })
    expect(res.state).toBe("proven")
    expect(exitCodeFor(res)).toBe(EXIT.OK)
    expect(res.version?.state).toBe("floating")
    expect(res.versionViolations).toEqual([])
  })

  it("a SONDA declarada pela variável: a versão sai do container DELA, e o veredito diz a fonte", () => {
    // O defeito que isto fecha: o nome do container saía só do `container_name`
    // do compose, então medir a metade da VERSÃO exigia tomar o nome que a stack
    // usa — uma sonda (a imagem pinada num container de teste) não tinha como se
    // declarar. Aqui o compose DECLARA `gitea-runner` e a medição vai na sonda.
    const { run, calls } = makeRun({
      render: renderWith("gitea/act_runner:0.2.11"),
      version: ok("act_runner version v0.6.1"),
    })
    const res = checkRunnerLabels({ cwd, run, env: { GITEA_RUNNER_CONTAINER: "sonda-do-ensaio" } })
    expect(res.container).toBe("sonda-do-ensaio")
    // A versão foi lida do container DECLARADO (e não do `gitea-runner`)
    expect(calls).toContain("exec sonda-do-ensaio act_runner --version")
    expect(calls).not.toContain("exec gitea-runner act_runner --version")
    // O drift continua sendo o MESMO defeito (a tag declara 0.2.11, roda 0.6.1)...
    expect(res.version?.state).toBe("drift")
    // ...e a FONTE da sonda está dita no veredito: medir a sonda NÃO é medir a stack.
    expect(res.versionViolations[0]).toContain(`sonda-do-ensaio`)
    expect(res.versionViolations[0]).toContain(RUNNER_CONTAINER_ENV)
  })

  it("`--container` (a CLI) vence a variável: a declaração mais específica é a que mede", () => {
    const { run, calls } = makeRun({ render: renderWith("gitea/act_runner:0.6.1") })
    const res = checkRunnerLabels({
      cwd,
      run,
      container: "sonda-da-cli",
      env: { GITEA_RUNNER_CONTAINER: "sonda-do-ambiente" },
    })
    expect(res.container).toBe("sonda-da-cli")
    expect(calls).toContain("exec sonda-da-cli act_runner --version")
    expect(res.version?.state).toBe("proven")
  })

  it("o render SEM imagem → `no-image` (não há versão declarada a comparar)", () => {
    const { run } = makeRun({ render: renderWith(null) })
    const res = checkRunnerLabels({ cwd, run })
    expect(res.state).toBe("proven")
    expect(res.version?.state).toBe("no-image")
  })

  it("a versão é lida ANTES do registro: um registro ILEGÍVEL não esconde o drift", () => {
    const { run } = makeRun({
      render: renderWith("gitea/act_runner:0.2.11"),
      exec: ok("isso não é json"),
      version: ok("act_runner version v0.6.1"),
    })
    const res = checkRunnerLabels({ cwd, run })
    expect(res.state).toBe("unavailable")
    expect(res.version?.state).toBe("drift")
    expect(res.versionViolations).toHaveLength(1)
    expect(renderReport(res)).toContain("versao        : 0.6.1 != tag 0.2.11 (drift)")
  })

  it("o binário que não responde → `unread`, nunca 'em sincronia'", () => {
    const { run } = makeRun({
      render: renderWith("gitea/act_runner:0.6.1"),
      version: { status: 1, stdout: "", stderr: "Error response from daemon: No such container" },
    })
    const res = checkRunnerLabels({ cwd, run })
    expect(res.state).toBe("proven")
    expect(res.version?.state).toBe("unread")
    expect(res.versionViolations).toEqual([])
  })

  it("o relatório dita a versão nos DOIS desfechos (é ela que explica um vermelho sem label)", () => {
    const provado = makeRun({ render: renderWith("gitea/act_runner:0.6.1") })
    expect(renderReport(checkRunnerLabels({ cwd, run: provado.run }))).toContain(
      "versao        : 0.6.1 = tag 0.6.1 (proven)",
    )
    const drift = makeRun({
      render: renderWith("gitea/act_runner:0.2.11"),
      version: ok("act_runner version v0.6.1"),
    })
    const vermelho = renderReport(checkRunnerLabels({ cwd, run: drift.run }))
    expect(vermelho).toContain("❌")
    expect(vermelho).toContain("versao        : 0.6.1 != tag 0.2.11 (drift)")
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

/** A versão que o SERVIÇO aceitou — é ela que o pin do script tem de casar. */
const RUNNER_VERSION_OK = "2.337.0"

/**
 * O script REAL do repositório (a fonte única dos labels, do nome, do repo e do
 * PIN da versão). O pin entra aqui porque ele é a OUTRA declaração que o serviço
 * tem de aceitar: sem ele no fixture, a comparação da versão sairia `no-pin` em
 * todo teste do fluxo, e o caminho provado seria medido por omissão.
 */
const REAL_SETUP = `
RUNNER_NAME="hostinger-runner"
RUNNER_LABELS="self-hosted,linux,x64,docker"
REPO_URL="https://github.com/severinno/severinno"
RUNNER_VERSION="${RUNNER_VERSION_OK}"
`

/** Um runner como a API devolve: os labels `read-only` vêm com a caixa do GitHub. */
const RUNNER_ONLINE = {
  id: 7,
  name: "hostinger-runner",
  status: "online",
  version: RUNNER_VERSION_OK,
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
  over: Partial<{
    id: number
    name: string
    status: string
    labels: string[]
    version: string
  }> = {},
) {
  return {
    id: 7,
    name: "hostinger-runner",
    status: "online",
    version: "2.337.0",
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

  it("o script REAL do repositório declara 4 labels, um nome, um repo E o pin da versão", () => {
    const setup = parseGithubRunnerSetup(
      readFileSync(join(process.cwd(), "deploy", "setup-github-runner.sh"), "utf8"),
    )
    expect(setup.entries.map((e) => e.raw)).toEqual(["self-hosted", "linux", "x64", "docker"])
    expect(setup.name).toBe("hostinger-runner")
    expect(setup.repo).toBe("severinno/severinno")
    // O pin é lido do MESMO texto (a fonte única): o valor em si é bumpável, então
    // o que se prova aqui é a LEITURA — a forma da versão, e não um número cravado
    // que envelheceria a cada bump do runner.
    expect(setup.version).toMatch(/^\d+\.\d+\.\d+$/)
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

describe("compareRunnerVersion — a versão registrada × o PIN do script (a classe 2.320.0 → 2.337.0)", () => {
  it("o `v` de prefixo e o espaço NÃO são drift (compara por VALOR, nunca por texto)", () => {
    expect(normalizeRunnerVersion("v2.337.0")).toBe("2.337.0")
    expect(normalizeRunnerVersion(" 2.337.0 ")).toBe("2.337.0")
    expect(normalizeRunnerVersion("")).toBeNull()
    expect(normalizeRunnerVersion(null)).toBeNull()
    const ig = compareRunnerVersion({ pin: "v2.337.0", registered: "2.337.0" })
    expect(ig.state).toBe("proven")
    expect(ig.detail).toContain("= o pin")
  })

  it("pin RECUSADO (o registro está em outra versão) → drift, nomeando os DOIS lados", () => {
    // O defeito medido: o pin 2.320.0 registrou, pegou o primeiro job e se
    // auto-atualizou para 2.337.0 no meio dele.
    const d = compareRunnerVersion({ pin: "2.320.0", registered: "2.337.0" })
    expect(d.state).toBe("drift")
    expect(d.pin).toBe("2.320.0")
    expect(d.registered).toBe("2.337.0")
    expect(d.detail).toContain("RECUSOU o pin")
    expect(d.detail).toContain("'2.320.0'")
    expect(d.detail).toContain("'2.337.0'")
  })

  it("script SEM o pin, e API SEM o campo `version`: NENHUM dos dois vira 'em sincronia'", () => {
    // "Não deu para julgar" tem estado próprio — e é ele que o doctor publica como
    // não-provado. Sem esta distinção, um payload sem o campo passaria por ✅.
    const semPino = compareRunnerVersion({ pin: null, registered: "2.337.0" })
    expect(semPino.state).toBe("no-pin")
    expect(semPino.pin).toBeNull()
    expect(semPino.detail).toContain("NAO declara RUNNER_VERSION")

    const semCampo = compareRunnerVersion({ pin: "2.337.0", registered: null })
    expect(semCampo.state).toBe("unread")
    expect(semCampo.registered).toBeNull()
    expect(semCampo.detail).toContain("NAO foi julgada")

    expect(compareRunnerVersion({ pin: null, registered: null }).state).toBe("no-pin")
  })

  it("o nome do runner aparece na mensagem quando ele é conhecido", () => {
    const d = compareRunnerVersion({
      pin: "1.0.0",
      registered: "2.0.0",
      runnerName: "hostinger-runner",
    })
    expect(d.detail).toContain("hostinger-runner")
  })
})

describe("parseGithubRunners / selectGithubRunner", () => {
  it("lê nome, status e labels do payload da API", () => {
    const parsed = parseGithubRunners({ runners: [RUNNER_ONLINE] })
    expect(parsed.ok).toBe(true)
    expect(parsed.runners?.[0].name).toBe("hostinger-runner")
    expect(parsed.runners?.[0].status).toBe("online")
    expect(parsed.runners?.[0].version).toBe(RUNNER_VERSION_OK)
    expect(parsed.runners?.[0].labels).toEqual(["self-hosted", "Linux", "X64", "docker"])
  })

  it("payload SEM o campo `version` vira string vazia (não vira a versão do vizinho)", () => {
    const parsed = parseGithubRunners({ runners: [{ ...RUNNER_ONLINE, version: undefined }] })
    expect(parsed.runners?.[0].version).toBe("")
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

  it("a versão registrada = o PIN do script entra no relatório (o outro lado do registro)", async () => {
    const { fetchImpl } = fetchWith([RUNNER_ONLINE])
    const res = await checkGithubRunnerLabels({ cwd, env: ENV, fetchImpl })
    expect(res.state).toBe("proven")
    expect(res.version?.state).toBe("proven")
    expect(res.version?.pin).toBe(RUNNER_VERSION_OK)
    expect(res.version?.registered).toBe(RUNNER_VERSION_OK)
    const report = renderReport(res)
    expect(report).toContain("versao        : 2.337.0 = pin 2.337.0")
  })

  it("o serviço RECUSOU o pin (o registro está em outra versão) → DIVERGENTE, com remédio do PIN", async () => {
    // A classe medida em 22/09/2026: com o pin em 2.320.0 o runner registrou,
    // pegou o primeiro job e se AUTO-ATUALIZOU para 2.337.0 — o update derruba o
    // worker e o job fica PRESO segurando o runner. Aqui os LABELS estão certos:
    // quem acusa é a versão, e o remédio é outro (re-registrar com o mesmo pin
    // recusado reproduziria o defeito).
    const { fetchImpl } = fetchWith([{ ...RUNNER_ONLINE, version: "2.320.0" }])
    const res = await checkGithubRunnerLabels({ cwd, env: ENV, fetchImpl })
    expect(res.state).toBe("violated")
    expect(exitCodeFor(res)).toBe(EXIT.MISMATCH)
    // `violations` continua sendo a lista dos LABELS (zero aqui): somar as duas
    // faria `violations.length` deixar de significar o que ele diz.
    expect(res.violations).toEqual([])
    expect(res.versionViolations).toHaveLength(1)
    expect(res.versionViolations[0]).toContain("RECUSOU o pin")
    expect(res.versionViolations[0]).toContain("PRESO")
    expect(res.remedies.join("\n")).toContain("RUNNER_VERSION")
    expect(res.detail).toContain("PARADA")
    const report = renderReport(res)
    expect(report).toContain("2.320.0 != pin 2.337.0")
  })

  it("o pin do script em OUTRA versão também acusa (o drift não tem lado certo)", async () => {
    const dir = githubRepo(
      'RUNNER_NAME="hostinger-runner"\nRUNNER_LABELS="self-hosted,linux,x64,docker"\nREPO_URL="https://github.com/severinno/severinno"\nRUNNER_VERSION="2.300.0"\n',
    )
    const { fetchImpl } = fetchWith([RUNNER_ONLINE])
    const res = await checkGithubRunnerLabels({ cwd: dir, env: ENV, fetchImpl })
    expect(res.state).toBe("violated")
    expect(res.version?.pin).toBe("2.300.0")
    expect(res.version?.state).toBe("drift")
  })

  it("NENHUM runner registrado: a versão fica NÃO julgada (null), nunca 'em sincronia'", async () => {
    const { fetchImpl } = fetchWith([])
    const res = await checkGithubRunnerLabels({ cwd, env: ENV, fetchImpl })
    expect(res.state).toBe("violated")
    expect(res.version).toBeNull()
  })

  it("script sem o PIN: a versão não é julgada e o guard NÃO a dá por certa", async () => {
    const dir = githubRepo(
      'RUNNER_NAME="hostinger-runner"\nRUNNER_LABELS="self-hosted,linux,x64,docker"\nREPO_URL="https://github.com/severinno/severinno"\n',
    )
    const { fetchImpl } = fetchWith([RUNNER_ONLINE])
    const res = await checkGithubRunnerLabels({ cwd: dir, env: ENV, fetchImpl })
    // Os labels casam: o veredito segue PROVADO neles, e a versão sai com o
    // estado próprio (`no-pin`) para o doctor publicá-la como não-provada.
    expect(res.state).toBe("proven")
    expect(res.version?.state).toBe("no-pin")
    expect(res.versionViolations).toEqual([])
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

  it("repo DESCONHECIDO (script sem REPO_URL e sem o canal `GH_REPOSITORY`) → env, não palpite", async () => {
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

  it("`GH_REPOSITORY` (o CANAL) serve quando o script não declara REPO_URL", async () => {
    const dir = githubRepo('RUNNER_LABELS="self-hosted"\n')
    const res = await checkGithubRunnerLabels({
      cwd: dir,
      env: { ...ENV, GH_REPOSITORY: "o/r" },
      ...fetchWith([{ ...RUNNER_ONLINE, name: "a", labels: [{ name: "self-hosted" }] }]),
    })
    expect(res.state).toBe("proven")
    expect(res.repo).toBe("o/r")
  })

  it("o `GITHUB_REPOSITORY` COMPARTILHADO não serve — e o canal vence quando os dois estão no ambiente", async () => {
    // O runner da forja EMULA o contexto do GitHub: ali `GITHUB_REPOSITORY` é o
    // repositório DO GITEA. Lê-lo aqui consultaria o registro de outro
    // repositório (a resposta seria o registro vazio de um repo que não é o
    // nosso, publicada como se fosse o nosso) — e só continuaria correto
    // enquanto os dois slugs coincidissem.
    const dir = githubRepo('RUNNER_LABELS="self-hosted"\n')
    const { fetchImpl, calls } = fetchWith([
      { ...RUNNER_ONLINE, name: "a", labels: [{ name: "self-hosted" }] },
    ])
    const comCanal = await checkGithubRunnerLabels({
      cwd: dir,
      env: { ...ENV, GH_REPOSITORY: "canal/r", GITHUB_REPOSITORY: "forja-emulada/decoy" },
      fetchImpl,
    })
    expect(comCanal.state).toBe("proven")
    expect(comCanal.repo).toBe("canal/r")
    expect(calls.join(" ")).toContain("/repos/canal/r/actions/runners")
    expect(calls.join(" ")).not.toContain("decoy")

    // E com SÓ o compartilhado: falta de canal (2), nunca uma consulta ao repo
    // da forja emulada — e a mensagem NOMEIA a variável que falta.
    const soDecoy = await checkGithubRunnerLabels({
      cwd: dir,
      env: { ...ENV, GITHUB_REPOSITORY: "forja-emulada/decoy" },
      ...fetchWith([RUNNER_ONLINE]),
    })
    expect(soDecoy.state).toBe("env-missing")
    expect(exitCodeFor(soDecoy)).toBe(EXIT.ENV)
    expect(soDecoy.repo).toBeNull()
    expect(soDecoy.detail).toContain("GH_REPOSITORY")
    expect(soDecoy.detail).not.toContain("decoy")
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

  it("no repositório o veredito é o do ESTADO medido — e o exit sai dele, nunca de uma constante", () => {
    // O host decide o estado, e ele NÃO é sempre o mesmo: com a forja no ar e o
    // registro em sincronia sai `proven`; com um container sem registro (uma
    // sonda, ou o volume apagado) sai `violated`; sem container nenhum sai
    // `unavailable`. O que este teste cobra é a LIGAÇÃO: o exit é DERIVADO do
    // estado — afirmar um código fixo aqui passaria a mentir no dia em que o
    // host estivesse num dos outros dois.
    const res = checkRunnerLabels({ cwd: process.cwd() })
    expect(["proven", "violated", "unavailable"]).toContain(res.state)
    const esperado =
      res.state === "proven" ? EXIT.OK : res.state === "violated" ? EXIT.MISMATCH : EXIT.UNKNOWN
    expect(exitCodeFor(res)).toBe(esperado)
  })
})
