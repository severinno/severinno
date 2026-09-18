/**
 * prove-pre-commit-in-runner.test.ts
 *
 * Testes do LUGAR-ESCOLHEDOR da prova do pre-commit — `prove-pre-commit-in-runner.mjs`.
 *
 * O que está sob teste NÃO é a prova do bloqueio (isso é `pre-commit-proof.mjs`,
 * medido pelo doctor e pelos testes dos hooks, e executado de verdade com docker
 * e a imagem do runner): é a decisão de ONDE a prova roda e o contrato com quem
 * a invoca. Três coisas que precisam valer:
 *
 *   1. `--in-image` NÃO é uma promessa que quem chama faz de si mesmo: fora do
 *      runtime do CI ele RECUSA (exit 2, nomeando o marcador que faltou). Sem
 *      isso, um `--in-image` numa máquina hospedeira devolveria `proven` para
 *      uma medição feita na máquina errada — e o relatório diria "dentro da
 *      imagem";
 *   2. o job da forja NÃO tem socket de docker (o act_runner roda o job NO
 *      container da imagem, sem montar o socket): quando os marcadores estão lá,
 *      o modo `docker run` nem pode ser consultado — um `dockerAvailable()` no
 *      caminho faria a prova depender de uma capacidade que ela não tem ali;
 *   3. onde não dá para provar, o desfecho é INDETERMINADO (exit 2) NOMEANDO o
 *      remédio — imagem sem ref, pull que falhou sem credencial, docker ausente.
 *      Ausência de prova nunca vira verde.
 *
 * Usage:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/prove-pre-commit-in-runner.test.ts
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"

import {
  CONTAINER_MARKERS,
  EVIDENCE_PREFIX,
  EXIT,
  IMAGE_BASE_MARKER,
  IMAGE_REF_ENV,
  dockerRunArgv,
  evidenceLines,
  exitCodeFor,
  innerCommand,
  innerReport,
  markersInImage,
  parseArgs,
  parseInImage,
  placeReport,
  renderReport,
  runtimeEvidence,
  stateFromExit,
} from "../../../scripts/prove-pre-commit-in-runner.mjs"

const SCRIPT = join(process.cwd(), "scripts", "prove-pre-commit-in-runner.mjs")

/** Um `exists` de mentira: só os caminhos declarados existem. */
const existsOf = (paths: string[]) => (p: string) => paths.includes(p)

const PROVA_PROVADA = {
  state: "proven",
  detail: "um 'git commit' de verdade com o corpo quebrado é RECUSADO e o controle ENTRA",
  evidence: {
    defeito: {
      status: 1,
      output: ".github/workflows/ci.yml",
      objetosDeCommit: 0,
      headExiste: false,
    },
    controle: { status: 0, output: "commit do fixture", objetosDeCommit: 1 },
  },
}

/** Os dublês de runtime: nada aqui toca git, node ou docker de verdade. */
const depsBase = (over = {}) => ({
  exists: existsOf([]),
  runtime: () => ({
    node: "/usr/bin/node",
    nodeVersion: "v20.20.2",
    git: "git version 2.43.0",
    bash: "bash",
  }),
  prove: () => PROVA_PROVADA,
  ...over,
})

describe("a régua do lugar — as DUAS metades dos marcadores", () => {
  it("sem marcador nenhum: NÃO estamos dentro da imagem", () => {
    expect(markersInImage({ exists: existsOf([]) })).toEqual({
      container: null,
      base: null,
      inside: false,
    })
  })

  it("container SEM a base do runner não basta (um container qualquer não é o runtime do CI)", () => {
    const m = markersInImage({ exists: existsOf([CONTAINER_MARKERS[0]]) })
    expect(m.container).toBe(CONTAINER_MARKERS[0])
    expect(m.base).toBeNull()
    expect(m.inside).toBe(false)
  })

  it("a base do runner SEM container não basta (uma máquina hospedeira com o toolcache)", () => {
    const m = markersInImage({ exists: existsOf([IMAGE_BASE_MARKER]) })
    expect(m.container).toBeNull()
    expect(m.base).toBe(IMAGE_BASE_MARKER)
    expect(m.inside).toBe(false)
  })

  it("os dois juntos: estamos dentro — e o `podman` serve tanto quanto o docker", () => {
    expect(
      markersInImage({ exists: existsOf([CONTAINER_MARKERS[0], IMAGE_BASE_MARKER]) }).inside,
    ).toBe(true)
    expect(
      markersInImage({ exists: existsOf([CONTAINER_MARKERS[1], IMAGE_BASE_MARKER]) }).inside,
    ).toBe(true)
  })
})

describe("modo interno (`--in-image`): a flag não dispensa a verificação", () => {
  it("fora do runtime do CI, RECUSA nomeando os DOIS marcadores que faltaram", () => {
    const r = innerReport({ deps: depsBase() })
    expect(r.state).toBe("unavailable")
    expect(r.markers?.inside).toBe(false)
    expect(r.proof).toBeNull()
    expect(r.detail).toContain(CONTAINER_MARKERS[0])
    expect(r.detail).toContain(IMAGE_BASE_MARKER)
  })

  it("com UM marcador só, RECUSA nomeando exatamente o que faltou", () => {
    const r = innerReport({
      deps: depsBase({ exists: existsOf([CONTAINER_MARKERS[0]]) }),
    })
    expect(r.state).toBe("unavailable")
    expect(r.detail).toContain(IMAGE_BASE_MARKER)
    expect(r.detail).not.toContain("marcador de container")
  })

  it("dentro do runtime: a prova roda e o estado dela é o veredito (sem reinvenção)", () => {
    const prove = vi.fn(() => PROVA_PROVADA)
    const r = innerReport({
      deps: depsBase({ exists: existsOf([CONTAINER_MARKERS[0], IMAGE_BASE_MARKER]), prove }),
    })
    expect(r.state).toBe("proven")
    expect(r.proof).toEqual(PROVA_PROVADA)
    expect(prove).toHaveBeenCalledTimes(1)
  })

  it("os TRÊS estados da prova passam sem serem reinterpretados", () => {
    const exists = existsOf([CONTAINER_MARKERS[0], IMAGE_BASE_MARKER])
    for (const state of ["proven", "violated", "unavailable"]) {
      const r = innerReport({
        deps: depsBase({
          exists,
          prove: () => ({ state, detail: `detalhe ${state}`, evidence: null }),
        }),
      })
      expect(r.state).toBe(state)
    }
  })
})

describe("a escolha do lugar", () => {
  it("JÁ dentro da imagem: modo `in-image` e o docker NÃO é consultado (o socket não existe ali)", () => {
    const available = vi.fn(() => true)
    const call = vi.fn(() => ({ code: 0, output: "" }))
    const r = placeReport({
      env: {},
      deps: depsBase({
        exists: existsOf([CONTAINER_MARKERS[0], IMAGE_BASE_MARKER]),
        available,
        call,
      }),
    })
    expect(r.modo).toBe("in-image")
    expect(r.state).toBe("proven")
    expect(available).not.toHaveBeenCalled()
    expect(call).not.toHaveBeenCalled()
  })

  it("fora da imagem COM docker: o MESMO comando roda no container da ref derivada", () => {
    const chamadas: Array<{ args: string[] }> = []
    const call = vi.fn(({ args }: { args: string[] }) => {
      chamadas.push({ args })
      if (args[0] === "image") return { code: 0, output: "sha256:abc" }
      return {
        code: EXIT.PROVEN,
        output: [
          `${EVIDENCE_PREFIX}MODO=in-image`,
          `${EVIDENCE_PREFIX}STATE=proven`,
          `${EVIDENCE_PREFIX}IMAGE=ghcr.io/ns/ubuntu-bun:1.3.14`,
          `${EVIDENCE_PREFIX}NODE=/opt/acttoolcache/node/24.19.0/x64/bin/node v24.19.0`,
          `${EVIDENCE_PREFIX}GIT=git version 2.55.0`,
          `${EVIDENCE_PREFIX}DEFEITO=exit:1 objetos:0 head:nao`,
          `${EVIDENCE_PREFIX}CONTROLE=exit:0 objetos:1`,
        ].join("\n"),
      }
    })
    const r = placeReport({
      root: "/w/repo",
      env: {
        IMAGE_REGISTRY: "ghcr.io",
        IMAGE_NAMESPACE: "ns",
        BUN_VERSION: "1.3.14",
      },
      deps: depsBase({ available: () => true, call, digest: () => "sha256:abc" }),
    })
    expect(r.modo).toBe("docker-run")
    expect(r.image).toBe("ghcr.io/ns/ubuntu-bun:1.3.14")
    expect(r.digest).toBe("sha256:abc")
    expect(r.state).toBe("proven")
    expect(r.detail).toContain("DENTRO da imagem 'ghcr.io/ns/ubuntu-bun:1.3.14'")
    expect(r.detail).toContain("git version 2.55.0")

    const run = chamadas.find((c) => c.args[0] === "run")?.args ?? []
    // O checkout é montado NO MESMO CAMINHO: o `node_modules` do fixture é um
    // link ABSOLUTO, e montar em outro caminho faria o guard morrer de
    // "module not found" (o não-zero seria do fixture, não do defeito).
    expect(run).toContain("/w/repo:/w/repo")
    expect(run[run.indexOf("-w") + 1]).toBe("/w/repo")
    // O comando do container é UM argumento (`bash -lc '<cmd>'`): o `--in-image`
    // vive dentro dele, junto do `--root` que o fixa no caminho montado.
    expect(run[run.length - 1]).toContain("--in-image")
    expect(run[run.length - 1]).toContain('--root "/w/repo"')
    expect(run).toContain(`${IMAGE_REF_ENV}=ghcr.io/ns/ubuntu-bun:1.3.14`)
    expect(run[run.indexOf("--entrypoint") + 1]).toBe("/bin/bash")
  })

  it("o pull que falhou é INDETERMINADO com a dica da credencial — nunca violação", () => {
    const call = vi.fn(({ args }: { args: string[] }) =>
      args[0] === "pull"
        ? { code: 1, output: "denied: requested access to the resource is denied" }
        : { code: 1, output: "No such image" },
    )
    const r = placeReport({
      env: { BUN_VERSION: "1.3.14" },
      deps: depsBase({ available: () => true, call }),
    })
    expect(r.state).toBe("unavailable")
    expect(r.modo).toBe("docker-run")
    expect(r.detail).toContain("não está local e o pull falhou")
    expect(r.detail).toContain("credencial")
  })

  it("sem ref (BUN_VERSION ausente): INDETERMINADO nomeando o remédio, sem chamar o docker", () => {
    const call = vi.fn(() => ({ code: 0, output: "" }))
    const r = placeReport({ env: {}, deps: depsBase({ available: () => true, call }) })
    expect(r.state).toBe("unavailable")
    expect(r.detail).toContain("BUN_VERSION")
    expect(call).not.toHaveBeenCalled()
  })

  it("nem dentro da imagem nem com docker: INDETERMINADO nomeando os DOIS caminhos", () => {
    const r = placeReport({ env: {}, deps: depsBase({ available: () => false }) })
    expect(r.state).toBe("unavailable")
    expect(r.modo).toBe("indefinido")
    expect(r.detail).toContain("docker não respondeu")
    expect(r.detail).toContain("label docker://")
  })

  it("`docker run` que NÃO terminou (timeout/sinal) não vira verde", () => {
    const call = vi.fn(({ args }: { args: string[] }) =>
      args[0] === "image" ? { code: 0, output: "x" } : { code: null, output: "" },
    )
    const r = placeReport({
      env: { BUN_VERSION: "1.3.14" },
      deps: depsBase({ available: () => true, call }),
    })
    expect(r.state).toBe("unavailable")
    expect(r.detail).toContain("não terminou")
  })

  it("exit code desconhecido (docker 125/127) é INDETERMINADO, não 'proven'", () => {
    const call = vi.fn(({ args }: { args: string[] }) =>
      args[0] === "image" ? { code: 0, output: "x" } : { code: 127, output: "node: not found" },
    )
    const r = placeReport({
      env: { BUN_VERSION: "1.3.14" },
      deps: depsBase({ available: () => true, call }),
    })
    expect(r.state).toBe("unavailable")
    expect(r.detail).toContain("node: not found")
  })
})

describe("o contrato com quem invoca (as linhas de evidência)", () => {
  it("o exit code é o veículo do veredito — e o que não é 0/1/2 é `null`", () => {
    expect(stateFromExit(EXIT.PROVEN)).toBe("proven")
    expect(stateFromExit(EXIT.VIOLATED)).toBe("violated")
    expect(stateFromExit(EXIT.UNAVAILABLE)).toBe("unavailable")
    expect(stateFromExit(null)).toBeNull()
    expect(stateFromExit(127)).toBeNull()
    expect(exitCodeFor("proven")).toBe(0)
    expect(exitCodeFor("violated")).toBe(1)
    expect(exitCodeFor("unavailable")).toBe(2)
    expect(exitCodeFor("qualquer-coisa")).toBe(2)
  })

  it("as linhas de evidência saem do relatório (e o parser as lê de volta)", () => {
    const r = innerReport({
      deps: depsBase({ exists: existsOf([CONTAINER_MARKERS[0], IMAGE_BASE_MARKER]) }),
    })
    const texto = evidenceLines(r).join("\n")
    const { facts, unparsed } = parseInImage(texto)
    expect(unparsed).toEqual([])
    expect(facts.MODO).toBe("in-image")
    expect(facts.STATE).toBe("proven")
    expect(facts.CONTAINER).toBe(CONTAINER_MARKERS[0])
    expect(facts.BASE).toBe(IMAGE_BASE_MARKER)
    expect(facts.DEFEITO).toBe("exit:1 objetos:0 head:nao")
    expect(facts.CONTROLE).toBe("exit:0 objetos:1")
    expect(facts.NODE).toContain("/usr/bin/node")
  })

  it("linha malformada vira `unparsed`, nunca um fato inventado", () => {
    const { facts, unparsed } = parseInImage(
      `${EVIDENCE_PREFIX}STATE=proven\n${EVIDENCE_PREFIX}QUEBRADA\nruído solto`,
    )
    expect(facts.STATE).toBe("proven")
    expect(unparsed).toEqual([`${EVIDENCE_PREFIX}QUEBRADA`])
  })

  it("o comando do container cita os caminhos (o workspace do runner tem caminho com espaço)", () => {
    const cmd = innerCommand({ root: "/home/runner/work/m r/m r", self: "/repo/scripts/p.mjs" })
    expect(cmd).toContain('"/home/runner/work/m r/m r"')
    expect(cmd).toContain("--in-image")
  })

  it("o argv do `docker run` monta o MESMO caminho e herda as variáveis da ref", () => {
    const argv = dockerRunArgv({
      ref: "img:1",
      root: "/w",
      env: { IMAGE_REGISTRY: "ghcr.io", BUN_VERSION: "1.3.14", IGNORADA: "x" },
    })
    expect(argv.slice(0, 2)).toEqual(["run", "--rm"])
    expect(argv).toContain("IMAGE_REGISTRY=ghcr.io")
    expect(argv).toContain("BUN_VERSION=1.3.14")
    expect(argv).not.toContain("IGNORADA=x")
    expect(argv).toContain("/w:/w")
    expect(argv).toContain(`${IMAGE_REF_ENV}=img:1`)
  })

  it("o runtime medido é o do PROCESSO que executa (não um `command -v` que poderia resolver outro)", () => {
    const run = vi.fn(() => ({ status: 0, stdout: "git version 2.55.0\n" }))
    const r = runtimeEvidence({
      run: run as unknown as typeof import("node:child_process").spawnSync,
      execPath: "/opt/acttoolcache/node/24.19.0/x64/bin/node",
      version: "v24.19.0",
      bash: () => "/usr/bin/bash",
    })
    expect(r.node).toBe("/opt/acttoolcache/node/24.19.0/x64/bin/node")
    expect(r.nodeVersion).toBe("v24.19.0")
    expect(r.git).toBe("git version 2.55.0")
    expect(r.bash).toBe("/usr/bin/bash")
  })

  it("`git` ausente sai como `null` (e o relatório o diz), sem inventar versão", () => {
    const run = vi.fn(() => ({ status: 127, stdout: "", stderr: "not found" }))
    const r = runtimeEvidence({
      run: run as unknown as typeof import("node:child_process").spawnSync,
      bash: () => "bash",
    })
    expect(r.git).toBeNull()
  })
})

describe("o relatório e o CLI", () => {
  it("o relatório diz o LUGAR e o que a prova NÃO cobre", () => {
    const linhas: string[] = []
    renderReport(
      placeReport({
        env: {},
        deps: depsBase({ exists: existsOf([CONTAINER_MARKERS[0], IMAGE_BASE_MARKER]) }),
      }),
      { emit: (s = "") => linhas.push(s) },
    )
    const texto = linhas.join("\n")
    expect(texto).toContain("em lugar (o job já roda no container da imagem do runner)")
    expect(texto).toContain("O que esta prova NÃO cobre")
    expect(texto).toContain("DUBLÊ DECLARADO")
    // O digest não é legível DE DENTRO: o relatório diz quem prova o mapeamento.
    expect(texto).toContain("o digest não é legível daqui")
  })

  it("as opções: `--in-image` é a única que troca o LUGAR", () => {
    expect(parseArgs([])).toMatchObject({ inImage: false, json: false, docker: "docker" })
    expect(parseArgs(["--in-image"]).inImage).toBe(true)
    expect(parseArgs(["--image", "x:1"]).image).toBe("x:1")
    expect(parseArgs(["--docker", "podman"]).docker).toBe("podman")
    expect(parseArgs(["--root", "/r"]).root).toBe("/r")
    expect((parseArgs(["--nada"]) as { unknown?: string }).unknown).toBe("--nada")
  })

  it("o script usa a MESMA prova do doctor e da suíte (uma régua só, dois lugares)", () => {
    const fonte = readFileSync(SCRIPT, "utf8")
    expect(fonte).toContain('import { proveCommitBlocks } from "./pre-commit-proof.mjs"')
    // O cliente do docker e o "o docker responde?" também vêm de um dono só.
    expect(fonte).toContain('from "./prove-image-contract.mjs"')
    expect(fonte).toContain('from "./runner-shells.mjs"')
  })
})
