/**
 * prove-smoke-render-gate.test.ts
 *
 * Testes da prova por mutação da Prova 4 do smoke — as funções PURAS de
 * `scripts/prove-smoke-render-gate.mjs` e o FLUXO inteiro com o `docker`
 * injetado (sem subir container).
 *
 * O que está sob teste não é o render (isso é a prova executada, que exige
 * docker): é o CONTRATO da prova — a extração ancorada no passo (não na prosa),
 * o planejamento do container read-only, a leitura do desfecho pelo TEXTO do
 * gate e o veredito, que só é `proven` quando o CONTROLE prova e o MUTANTE
 * morde.
 *
 * Caso de regressão que este arquivo tranca: o cabeçalho do `forge-smoke.yml`
 * CITA "Prova 4" ao explicar por que o `--require-compose` existe. Ancorar a
 * extração na primeira ocorrência do marcador mediria o comentário — e o
 * fail-closed devolveu `unavailable` em vez de aprovar em silêncio.
 *
 * Usage:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/prove-smoke-render-gate.test.ts
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  COMPOSE_RENDER_PROVEN_MARK,
  REQUIRE_COMPOSE_FAIL_MARK,
} from "../../../scripts/check-registry-source.mjs"
import { declaredImageValue } from "../../../scripts/registry-source.mjs"
import {
  DEFAULT_ENV_FILE,
  EXIT,
  PLUGIN_DIRS,
  SMOKE_WORKFLOW,
  classifyRenderRun,
  containerArgs,
  exitCodeFor,
  extractStepScript,
  mutantScript,
  parseArgs,
  proveSmokeRenderGate,
  renderCommand,
  summarizeProof,
} from "../../../scripts/prove-smoke-render-gate.mjs"

const REPO_ROOT = process.cwd()

// ── fixtures ─────────────────────────────────────────────────────────────

/** A citação do marcador ANTES do passo — é o que a âncora `- name:` ignora. */
const YAML_WITH_PROSE = `# =============================================================================
# a Prova 4 EXIGE o render (--require-compose), entao "nao provei" fica vermelho
# =============================================================================
jobs:
  smoke:
    steps:
      - name: "Prova 3 — runtime"
        run: |
          echo tres
      - name: "Prova 4 — install congelado (render EXIGIDO)"
        run: |
          bun install --frozen-lockfile
          bun run check:registry-source --require-compose
      - name: "Prova 5 — registro"
        run: |
          echo cinco
`

const CONTROL_OUT = `$ node scripts/check-registry-source.mjs --require-compose
check-registry-source: ✅ ${COMPOSE_RENDER_PROVEN_MARK} — 3 fases ok (declarado=deploy/env.gitea.example · sentinela=ok · sem-versao=renderizou)`

const MUTANT_OUT = `$ node scripts/check-registry-source.mjs --require-compose
check-registry-source: ❌ --require-compose: o render do deploy/docker-compose.gitea.yml ${REQUIRE_COMPOSE_FAIL_MARK} (unavailable) — docker compose indisponivel: docker: unknown command: docker compose.
error: script "check:registry-source" exited with code 1`

/** Um `docker` falso: distingue a passada do MUTANTE pelo `rm -f` do script. */
function fakeRun({
  inspect = { status: 0, stdout: "", stderr: "" },
  control = { status: 0, stdout: CONTROL_OUT, stderr: "" },
  mutant = { status: 1, stdout: "", stderr: MUTANT_OUT },
  onCall = null as ((args: string[]) => void) | null,
} = {}) {
  const calls: { cmd: string; args: string[] }[] = []
  const run = (cmd: string, args: string[]) => {
    calls.push({ cmd, args })
    onCall?.(args)
    if (args[0] === "image" && args[1] === "inspect") return inspect
    const script = args[args.length - 1] ?? ""
    return script.includes("rm -f") ? mutant : control
  }
  return { run, calls }
}

// ── extração ancorada no passo ───────────────────────────────────────────

describe("extractStepScript", () => {
  it("extrai o script do passo REAL do smoke — o comando sob prova vem do workflow", () => {
    const yaml = readFileSync(join(REPO_ROOT, SMOKE_WORKFLOW), "utf8")
    const step = extractStepScript(yaml)
    expect(step.ok).toBe(true)
    expect(step.script).toContain("bun run check:registry-source --require-compose")
    expect(renderCommand(step.script ?? "")).toBe("bun run check:registry-source --require-compose")
  })

  it("não confunde a CITAÇÃO do marcador no cabeçalho com o passo", () => {
    const step = extractStepScript(YAML_WITH_PROSE)
    expect(step.ok).toBe(true)
    // se ancorasse na prosa, o script seria vazio e o run: do passo 3 viria junto
    expect(step.script).toBe(
      "bun install --frozen-lockfile\nbun run check:registry-source --require-compose",
    )
    expect(step.script).not.toContain("echo tres")
  })

  it("para no fim do passo — não engole o run: do passo seguinte", () => {
    expect(extractStepScript(YAML_WITH_PROSE).script).not.toContain("echo cinco")
  })

  it("passo ausente, sem 'run:' ou com bloco vazio são FALHA (nunca aprovação)", () => {
    expect(extractStepScript("jobs:\n  smoke:\n    steps: []\n").ok).toBe(false)
    expect(
      extractStepScript('      - name: "Prova 4 x"\n        uses: actions/checkout@v4\n').ok,
    ).toBe(false)
    expect(extractStepScript('      - name: "Prova 4 x"\n        run: |\n').ok).toBe(false)
  })
})

// ── o comando e a injeção ────────────────────────────────────────────────

describe("renderCommand", () => {
  it("devolve a linha que carrega a exigência do render", () => {
    expect(
      renderCommand(
        "bun install --frozen-lockfile\nbun run check:registry-source --require-compose",
      ),
    ).toBe("bun run check:registry-source --require-compose")
  })

  it("sem a exigência devolve null — a prova não tem sujeito", () => {
    expect(renderCommand("bun run check:registry-source")).toBeNull()
    expect(renderCommand("")).toBeNull()
  })
})

describe("mutantScript", () => {
  it("remove o plugin de TODOS os diretórios conhecidos e mantém o comando", () => {
    const script = mutantScript("bun run check:registry-source --require-compose")
    for (const dir of PLUGIN_DIRS) expect(script).toContain(`${dir}/docker-compose`)
    expect(script).toContain("rm -f")
    expect(script.endsWith("bun run check:registry-source --require-compose")).toBe(true)
  })
})

describe("containerArgs", () => {
  const args = containerArgs({
    ref: "ghcr.io/x/ubuntu-bun:1.2.3",
    script: "eco",
    cwd: "/repo",
    version: "1.2.3",
    registry: "ghcr.io",
    namespace: "x",
  })

  it("monta o checkout READ-ONLY (a prova não altera o que mede)", () => {
    expect(args).toContain("/repo:/workspace:ro")
    const mount = args[args.indexOf("-v") + 1]
    expect(mount.endsWith(":ro")).toBe(true)
  })

  it("usa o bash da imagem e o workspace como cwd, com o safe.directory do git", () => {
    expect(args.slice(args.indexOf("--entrypoint"), args.indexOf("--entrypoint") + 2)).toEqual([
      "--entrypoint",
      "bash",
    ])
    expect(args[args.indexOf("-w") + 1]).toBe("/workspace")
    expect(args).toContain("GIT_CONFIG_KEY_0=safe.directory")
    expect(args).toContain("GIT_CONFIG_VALUE_0=/workspace")
  })

  it("passa as variáveis do passo e a ref antes do -c", () => {
    expect(args).toContain("BUN_VERSION=1.2.3")
    expect(args).toContain("IMAGE_REGISTRY=ghcr.io")
    expect(args).toContain("IMAGE_NAMESPACE=x")
    expect(args[args.length - 3]).toBe("ghcr.io/x/ubuntu-bun:1.2.3")
    expect(args[args.length - 1]).toBe("eco")
  })
})

// ── leitura do desfecho pelo TEXTO do gate ───────────────────────────────

describe("classifyRenderRun", () => {
  it("proven exige a MARCA do render, não o exit 0", () => {
    expect(classifyRenderRun({ code: 0, output: CONTROL_OUT }).state).toBe("proven")
    // saída 0 sem a marca = o passo deixou de conferir: NÃO é prova
    expect(classifyRenderRun({ code: 0, output: "$ bun run check:registry-source" }).state).toBe(
      "other",
    )
  })

  it("not-provable lê a marca do --require-compose (mesmo com o comando ecoado na saída)", () => {
    expect(classifyRenderRun({ code: 1, output: MUTANT_OUT }).state).toBe("not-provable")
    // a saída do sucesso TAMBÉM ecoa o comando com a flag — por isso a marca de
    // sucesso é conferida PRIMEIRO (senão o controle viraria "não provado")
    expect(classifyRenderRun({ code: 0, output: CONTROL_OUT }).state).toBe("proven")
  })

  it("outra saída e docker ausente não viram prova", () => {
    expect(classifyRenderRun({ code: 1, output: "panic: something" }).state).toBe("other")
    expect(classifyRenderRun({ code: null, output: "spawn docker ENOENT" }).state).toBe(
      "unavailable",
    )
  })
})

// ── o veredito ───────────────────────────────────────────────────────────

describe("summarizeProof", () => {
  const ok = { state: "proven", detail: "contro" }
  const red = { state: "not-provable", code: 1, detail: "mut" }

  it("proven só quando o CONTROLE prova E o MUTANTE fica vermelho", () => {
    const v = summarizeProof({ control: ok, mutant: red })
    expect(v.verdict).toBe("proven")
    expect(v.blockers).toEqual([])
  })

  it("MUTANTE verde = gate decorativo (a Prova 4 passaria sem o plugin)", () => {
    const v = summarizeProof({ control: ok, mutant: { state: "proven", detail: "passou" } })
    expect(v.verdict).toBe("violated")
    expect(v.blockers.join(" ")).toContain("SEM o plugin")
    expect(v.blockers.join(" ")).toContain("--require-compose")
  })

  it("CONTROLE sem o render = atribuição impossível (o vermelho não seria do plugin)", () => {
    const v = summarizeProof({ control: { state: "other", detail: "quebrou" }, mutant: red })
    expect(v.verdict).toBe("violated")
    expect(v.blockers.join(" ")).toContain("CONTROLE")
  })

  it("sem docker é INDETERMINADO, nunca 'está certo'", () => {
    const v = summarizeProof({
      control: { state: "unavailable", detail: "sem docker" },
      mutant: red,
    })
    expect(v.verdict).toBe("unavailable")
  })
})

describe("exitCodeFor", () => {
  it("mapeia o tri-estado da família", () => {
    expect(exitCodeFor("proven")).toBe(EXIT.OK)
    expect(exitCodeFor("violated")).toBe(EXIT.FAILED)
    expect(exitCodeFor("unavailable")).toBe(EXIT.UNAVAILABLE)
  })
})

// ── CLI ──────────────────────────────────────────────────────────────────

describe("parseArgs", () => {
  it("defaults: sem flags, renderiza o relatório humano com o env de referência", () => {
    expect(parseArgs([])).toMatchObject({
      json: false,
      build: false,
      help: false,
      envFile: DEFAULT_ENV_FILE,
      bunVersion: null,
      timeoutS: 600,
    })
  })

  it("aceita as flags documentadas", () => {
    expect(parseArgs(["--json", "--build"])).toMatchObject({ json: true, build: true })
    expect(parseArgs(["--gitea-env", "deploy/.env.gitea"])).toMatchObject({
      envFile: "deploy/.env.gitea",
    })
    expect(parseArgs(["--bun-version", "1.3.14", "--timeout", "30"])).toMatchObject({
      bunVersion: "1.3.14",
      timeoutS: 30,
    })
  })

  it("falha em flag desconhecida, argumento solto e valor inválido", () => {
    expect(parseArgs(["--nope"]).error).toContain("flag desconhecida")
    expect(parseArgs(["limbo"]).error).toContain("argumento inesperado")
    expect(parseArgs(["--timeout", "zero"]).error).toContain("--timeout invalido")
    expect(parseArgs(["--gitea-env"]).error).toContain("--gitea-env")
  })
})

// ── o fluxo inteiro, com o docker injetado ───────────────────────────────

describe("proveSmokeRenderGate — fluxo com o docker dublê", () => {
  const opts = () => ({ cwd: REPO_ROOT, envFile: DEFAULT_ENV_FILE, docker: "docker" })

  it("roda as DUAS passadas no mesmo alvo e conclui PROVEN", async () => {
    const { run, calls } = fakeRun()
    const result = await proveSmokeRenderGate({ ...opts(), run })

    expect(result.verdict).toBe("proven")
    expect(exitCodeFor(result.verdict)).toBe(0)
    // A ref do repositório REAL vem do espelho DECLARADO (a mesma fonte que o
    // resolvedor lê) — cravar o registry faz o teste envelhecer na virada do
    // registry (etapa 1 do corte) e acusar o repositório por estar certo.
    expect(result.ref).toBe(
      `${declaredImageValue(REPO_ROOT, "IMAGE_REGISTRY")?.value}/${declaredImageValue(REPO_ROOT, "IMAGE_NAMESPACE")?.value}/ubuntu-bun:1.3.14`,
    )
    expect(result.command).toBe("bun run check:registry-source --require-compose")

    const runs = calls.filter((c) => c.args[0] === "run")
    expect(runs).toHaveLength(2)
    // CONTROLE: sem o `rm -f`; MUTAÇÃO: com — o mesmo alvo nas duas
    const scriptOf = (i: number) => runs[i].args[runs[i].args.length - 1]
    const targetOf = (i: number) => runs[i].args[runs[i].args.length - 3]
    expect(scriptOf(0)).not.toContain("rm -f")
    expect(scriptOf(1)).toContain("rm -f")
    expect(targetOf(0)).toBe(targetOf(1))
  })

  it("MUTANTE verde vira VIOLATED — é o modo silencioso que a prova existe para pegar", async () => {
    const { run } = fakeRun({ mutant: { status: 0, stdout: CONTROL_OUT, stderr: "" } })
    const result = await proveSmokeRenderGate({ ...opts(), run })
    expect(result.verdict).toBe("violated")
    expect(result.mutant?.state).toBe("proven")
  })

  it("CONTROLE vermelho vira VIOLATED (o ambiente não entrega o verde da forja)", async () => {
    const { run } = fakeRun({ control: { status: 1, stdout: "", stderr: MUTANT_OUT } })
    const result = await proveSmokeRenderGate({ ...opts(), run })
    expect(result.verdict).toBe("violated")
    expect(result.blockers.join(" ")).toContain("CONTROLE")
  })

  it("imagem ausente sem --build é INDETERMINADO, com o remédio escrito", async () => {
    const { run } = fakeRun({ inspect: { status: 1, stdout: "", stderr: "No such image" } })
    const result = await proveSmokeRenderGate({ ...opts(), run })
    expect(result.verdict).toBe("unavailable")
    expect(result.detail).toContain("--build")
  })

  it("passo que deixou de exigir o render é INDETERMINADO (sem sujeito não há prova)", async () => {
    const { run } = fakeRun()
    const result = await proveSmokeRenderGate({
      ...opts(),
      run,
      readFile: (p: string) =>
        p.endsWith("forge-smoke.yml")
          ? '      - name: "Prova 4 x"\n        run: |\n          bun run check:registry-source\n'
          : readFileSync(p, "utf8"),
    })
    expect(result.verdict).toBe("unavailable")
    expect(result.detail).toContain("--require-compose")
  })

  it("workflow ausente é INDETERMINADO — nunca silêncio verde", async () => {
    const { run } = fakeRun()
    const result = await proveSmokeRenderGate({
      ...opts(),
      run,
      exists: (p: string) => !p.endsWith("forge-smoke.yml"),
    })
    expect(result.verdict).toBe("unavailable")
    expect(result.detail).toContain(SMOKE_WORKFLOW)
  })
})
