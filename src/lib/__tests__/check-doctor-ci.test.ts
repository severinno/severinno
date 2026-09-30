// =============================================================================
// check-doctor-ci.test.ts
//
// Testes do scripts/check-doctor-ci.mjs — o GATE de PR que roda o
// forge-doctor.mjs no perfil `--ci` com o valor das repository variables
// chegando pelo ambiente.
//
// O que precisa ser provado (a régua pode virar decoração de três jeitos):
//   1. a lista de variáveis NÃO é escrita à mão: ela sai de `MIRROR_VARIABLES`
//      (as mesmas que o compose da forja consome e que o guard semanal
//      compara) — uma variável nova no compose não pode ficar sem conferência
//      aqui em silêncio;
//   2. uma variável AUSENTE não vira flag com valor vazio: régua vazia é lida
//      como "não perguntado", e o gate ficaria verde sem ter conferido nada —
//      a ausência é NOMEADA em vez de silenciada;
//   3. a tradução do veredito: 1 (BLOQUEADA) bloqueia o PR; o INDETERMINADA que
//      o perfil declara (2) NÃO bloqueia (senão todo PR nasceria vermelho por
//      seções que o cron cobre); 3 (sem veredito) bloqueia;
//   4. o ciclo completo ponta a ponta, contra um checkout de verdade: espelhos
//      em sincronia → 0; valor divergente → 1.
//
// Sem rede: o doctor roda no perfil `--ci` (o recorte local), com dublês de
// fixture em diretório temporário.
// =============================================================================

import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterAll, describe, expect, it } from "vitest"

import {
  DOCTOR_PROFILE_FLAG,
  doctorFlags,
  gateExitCode,
  missingValueWarning,
} from "../../../scripts/check-doctor-ci.mjs"
import { MIRROR_VARIABLES } from "../../../scripts/check-actrc-sync.mjs"
import { MERGE_OWNER_PIPELINE, REQUIRED_CHECKS_MANIFEST } from "../../../scripts/forge-doctor.mjs"
// O VALOR DECLARADO do repositório: o doctor que o gate roda mede o REPO (não o
// `cwd` da fixture), então a expectativa tem de vir da mesma declaração que o
// espelho — cravar o host aqui mediria o valor de ontem.
import { declaredImageValue } from "../../../scripts/registry-source.mjs"

const ROOT = process.cwd()
const MODULE_PATH = join(ROOT, "scripts", "check-doctor-ci.mjs")
const tmpDirs: string[] = []

afterAll(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** Um checkout em miniatura, com o que o doctor lê no perfil `--ci`. */
function makeRepo(opts: { ns?: string; registry?: string } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "check-doctor-ci-"))
  tmpDirs.push(dir)
  mkdirSync(join(dir, ".gitea", "workflows"), { recursive: true })
  mkdirSync(join(dir, "ci"), { recursive: true })
  mkdirSync(join(dir, "deploy"), { recursive: true })

  writeFileSync(
    join(dir, MERGE_OWNER_PIPELINE),
    [
      "on:",
      "  pull_request:",
      "jobs:",
      "  guards:",
      "    steps:",
      "      - run: bun run lint",
    ].join("\n"),
  )
  writeFileSync(
    join(dir, REQUIRED_CHECKS_MANIFEST),
    JSON.stringify({
      version: 1,
      branches: ["main"],
      forges: {
        gitea: { workflow: MERGE_OWNER_PIPELINE, jobs: ["guards"] },
        github: { workflow: MERGE_OWNER_PIPELINE, jobs: ["guards"] },
      },
    }),
  )

  const registry = opts.registry ?? declaredImageValue(ROOT, "IMAGE_REGISTRY")?.value ?? ""
  const ns = opts.ns ?? "severinno"
  // Os TRÊS espelhos que o doctor compara no perfil (o do act local, o template
  // comitado e o do host — este último é gitignored no repo real e aqui existe
  // de propósito, para a comparação mais estrita ser a exercitada).
  writeFileSync(join(dir, ".actrc"), `--var BUN_VERSION=1.3.14\n--var IMAGE_REGISTRY=${registry}\n`)
  const env = `IMAGE_REGISTRY=${registry}\nIMAGE_NAMESPACE=${ns}\nBUN_VERSION=1.3.14\n`
  writeFileSync(join(dir, "deploy", "env.gitea.example"), env)
  writeFileSync(join(dir, "deploy", ".env.gitea"), env)
  return dir
}

/** Spawn do gate REAL, no diretório pedido, com o ambiente das variables. */
function runGate(
  env: Record<string, string>,
  cwd: string,
): { status: number | null; stdout: string; stderr: string } {
  const res = spawnSync(process.execPath, [MODULE_PATH], {
    cwd,
    encoding: "utf8",
    // 180s (medido na forja em 30/09/2026): o gate roda o doctor INTEIRO no
    // perfil --ci sobre um container de 4 vCPU compartilhado com a suíte em
    // paralelo — o teto de 60s do spawn ficou atrás do custo real.
    timeout: 180_000,
    env: { ...process.env, ...env },
  })
  return { status: res.status, stdout: res.stdout, stderr: res.stderr }
}

const VALUES = {
  BUN_VERSION: "1.3.14",
  IMAGE_REGISTRY: declaredImageValue(ROOT, "IMAGE_REGISTRY")?.value ?? "",
  IMAGE_NAMESPACE: declaredImageValue(ROOT, "IMAGE_NAMESPACE")?.value ?? "",
}

// ── doctorFlags — a régua vem do registro, não de uma lista à mão ─────────

describe("doctorFlags — as flags saem de MIRROR_VARIABLES", () => {
  it("cobre TODAS as variáveis do registro (nenhuma fica de fora em silêncio)", () => {
    const { flags, missing } = doctorFlags(VALUES)
    expect(missing).toEqual([])
    for (const name of MIRROR_VARIABLES) {
      // BUN_VERSION tem o atalho histórico (`--expected <valor>`); as demais
      // entram por `--expected-var NOME=<valor>`. Nos dois casos o VALOR da
      // variável tem de estar presente — é isso que prova que nenhuma ficou de
      // fora (a régua ausente é o defeito, não a flag ausente).
      const value = VALUES[name as keyof typeof VALUES]
      expect(flags.join(" ")).toContain(name === "BUN_VERSION" ? value : `${name}=${value}`)
    }
    expect(flags).toEqual([
      "--expected",
      "1.3.14",
      "--expected-var",
      `IMAGE_REGISTRY=${VALUES.IMAGE_REGISTRY}`,
      "--expected-var",
      `IMAGE_NAMESPACE=${VALUES.IMAGE_NAMESPACE}`,
    ])
  })

  it("variável AUSENTE não vira flag vazia — sai NOMEADA (régua vazia = não perguntado)", () => {
    const { flags, missing } = doctorFlags({ BUN_VERSION: "1.3.14" })
    expect(missing).toEqual(["IMAGE_REGISTRY", "IMAGE_NAMESPACE"])
    expect(flags).toEqual(["--expected", "1.3.14"])
    // O veneno que o teste guarda: uma flag com valor vazio faria o doctor
    // comparar contra '' e o relatório não diria que a pergunta não aconteceu.
    expect(flags.join(" ")).not.toMatch(/IMAGE_REGISTRY=|IMAGE_NAMESPACE=/)
  })

  it("valor em branco conta como ausente (espaço não é valor)", () => {
    const { flags, missing } = doctorFlags({ BUN_VERSION: "1.3.14", IMAGE_REGISTRY: "   " })
    expect(missing).toEqual(["IMAGE_REGISTRY", "IMAGE_NAMESPACE"])
    expect(flags).toEqual(["--expected", "1.3.14"])
  })

  it("o aviso nomeia cada variável e diz o remédio (não é um 'sem valores' genérico)", () => {
    const w = missingValueWarning(["IMAGE_REGISTRY", "IMAGE_NAMESPACE"])
    expect(w).toContain("::warning::")
    expect(w).toContain("IMAGE_REGISTRY, IMAGE_NAMESPACE")
    expect(w).toContain("actrc-sync")
  })
})

// ── gateExitCode — o veredito do doctor vira decisão de pipeline ──────────

describe("gateExitCode — o INDETERMINADA do perfil não bloqueia, a violação bloqueia", () => {
  it("0 (PRONTA) e 2 (INDETERMINADA do perfil) → 0: nenhuma violação no recorte", () => {
    expect(gateExitCode(0)).toBe(0)
    // Se 2 bloqueasse, TODO PR nasceria vermelho: o perfil nunca é PRONTA (ele
    // declara o que deixou para o cron), e um gate sempre vermelho é ignorado.
    expect(gateExitCode(2)).toBe(0)
  })

  it("1 (BLOQUEADA) → 1: o PR não passa com o espelho velho", () => {
    expect(gateExitCode(1)).toBe(1)
  })

  it("3 (uso/erro) e null (nem executou) → 3: sem veredito não há gate", () => {
    expect(gateExitCode(3)).toBe(3)
    expect(gateExitCode(null)).toBe(3)
    expect(gateExitCode(137)).toBe(3)
  })
})

// ── o ciclo completo: o gate contra um checkout de verdade ────────────────

describe("o gate ponta a ponta (checkout de fixture, sem rede)", () => {
  // 180s (medido na forja em 30/09/2026): CADA teste aqui spawn do gate, que
  // roda o doctor inteiro no perfil --ci — o default de 30s do vitest morreu
  // sob a carga da suíte em paralelo (timeout, não regressão).
  const GATE_E2E_TIMEOUT = 180_000

  it(
    "espelhos em sincronia com as variables → exit 0",
    () => {
      const res = runGate(VALUES, makeRepo())
      expect(res.status, `${res.stdout}\n${res.stderr}`).toBe(0)
      expect(res.stdout).toContain("nenhuma violação no recorte local")
      // O perfil aparece no relatório: quem lê o run sabe que o escopo foi local.
      expect(res.stdout).toContain("PERFIL --ci")
    },
    GATE_E2E_TIMEOUT,
  )

  it(
    "valor DIVERGENTE do que o espelho declara → exit 1 (e o bloqueio nomeia a variável)",
    () => {
      const res = runGate({ ...VALUES, IMAGE_NAMESPACE: "outro" }, makeRepo())
      expect(res.status).toBe(1)
      expect(res.stdout).toContain("IMAGE_NAMESPACE")
      expect(res.stdout).toContain("env.gitea.example")
      expect(res.stderr).toContain("BLOQUEOU")
      expect(res.stderr).toContain("::error::")
    },
    GATE_E2E_TIMEOUT,
  )

  it(
    "variável não configurada → exit 0, mas o run DIZ qual valor não foi conferido",
    () => {
      const res = runGate(
        { BUN_VERSION: "1.3.14", IMAGE_REGISTRY: "", IMAGE_NAMESPACE: "" },
        makeRepo(),
      )
      expect(res.status).toBe(0)
      expect(res.stdout).toContain("::warning::")
      expect(res.stdout).toContain("IMAGE_REGISTRY, IMAGE_NAMESPACE")
      // E o doctor também diz, no próprio relatório, que aquele valor não entrou.
      expect(res.stdout).toContain("nao foi comparado")
    },
    GATE_E2E_TIMEOUT,
  )

  it("argumento desconhecido → exit 3 (uso inválido não pode passar por veredito)", () => {
    const res = spawnSync(process.execPath, [MODULE_PATH, "--tudo"], {
      cwd: makeRepo(),
      encoding: "utf8",
      timeout: 60_000,
    })
    expect(res.status).toBe(3)
    expect(res.stderr).toContain("argumento desconhecido")
  })

  it("o perfil usado é o `--ci` (o gate não roda a bateria nem a prova)", () => {
    // O próprio gate declara a flag: se alguém a trocar por `--no-guards` e
    // esquecer as outras, o recorte deixa de ser o desenhado — e este teste é o
    // que prende a flag ao contrato.
    expect(DOCTOR_PROFILE_FLAG).toBe("--ci")
  })
})
