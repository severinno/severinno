// =============================================================================
// prove-runner-image-gate.test.ts
//
// Testes do scripts/prove-runner-image-gate.mjs — a PROVA, contra um registry de
// TESTE, de que o runner NÃO sobe quando a tag da imagem não existe.
//
// O que precisa ser provado sobre a prova (e é o ponto todo):
//   1. ela PASSA no repositório real — com o registry de teste ausente/presente,
//      o `deploy/gitea-up.sh` real comporta-se como o contrato manda;
//   2. ela FALHA quando o bloqueio deixa de existir (bring-up mutado que ignora a
//      falha do ensure) — e aponta o caso culpado;
//   3. ela FALHA quando o CONTROLE não sobe — senão "não subiu" seria satisfeito
//      por um script quebrado, e a prova seria vácua (é a contra-prova que
//      transforma "não subiu" em "não subiu PORQUE a tag faltava");
//   4. sem o bring-up o resultado é `unavailable` — ausência de prova nunca é
//      reportada como prova.
//
// SEM docker e SEM rede externa: o registry é um node:http em 127.0.0.1 e o
// `docker`/`gh` são dublês no PATH. O `bash` é o real (a prova executa o script
// de verdade).
// =============================================================================

import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterAll, describe, expect, it } from "vitest"

import {
  BRING_UP,
  PROOF_CASES,
  PROOF_VERSION,
  parseArgs,
  proveRunnerImageGate,
  renderProof,
  startTestRegistry,
} from "../../../scripts/prove-runner-image-gate.mjs"

const ROOT = process.cwd()
const tmpDirs: string[] = []

function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "prove-gate-"))
  tmpDirs.push(dir)
  return dir
}

afterAll(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/**
 * Raiz sintética com o MÍNIMO que o bring-up precisa resolver: ele mesmo, o
 * compose e o ensure. É o que permite mutar o bloqueio sem tocar no repositório.
 *
 * @param {(content: string) => string} mutate  recebe o gitea-up.sh e devolve o mutado
 */
function mutatedRoot(mutate: (content: string) => string): string {
  const dir = makeDir()
  mkdirSync(join(dir, "deploy"), { recursive: true })
  mkdirSync(join(dir, "scripts"), { recursive: true })
  cpSync(
    join(ROOT, "deploy", "docker-compose.gitea.yml"),
    join(dir, "deploy", "docker-compose.gitea.yml"),
  )
  cpSync(
    join(ROOT, "scripts", "ensure-runner-image.mjs"),
    join(dir, "scripts", "ensure-runner-image.mjs"),
  )
  const bringUp = readFileSync(join(ROOT, BRING_UP), "utf8")
  writeFileSync(join(dir, BRING_UP), mutate(bringUp))
  return dir
}

// ── o registry de teste é um registry de VERDADE (HTTP em 127.0.0.1) ───────

describe("startTestRegistry", () => {
  it("mode 'missing' responde 404 e 'exists' responde 200 — HTTP de verdade", async () => {
    for (const [mode, expected] of [
      ["missing", 404],
      ["exists", 200],
    ] as const) {
      const reg = await startTestRegistry(mode)
      try {
        const res = await fetch(`${reg.url}/v2/severinno/ubuntu-bun/manifests/${PROOF_VERSION}`, {
          method: "HEAD",
        })
        expect(res.status).toBe(expected)
        expect(reg.hits.length).toBe(1)
      } finally {
        await reg.close()
      }
    }
  })

  it("sobe em porta aleatória de loopback (duas instâncias não colidem)", async () => {
    const a = await startTestRegistry("missing")
    const b = await startTestRegistry("missing")
    try {
      expect(a.port).not.toBe(b.port)
      expect(a.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    } finally {
      await a.close()
      await b.close()
    }
  })
})

// ── a prova, no repositório REAL ──────────────────────────────────────────

describe("proveRunnerImageGate — no repositório real", () => {
  it("a prova se sustenta: com a tag ausente o runner NÃO sobe e com a presente sobe", async () => {
    const result = await proveRunnerImageGate({ cwd: ROOT })
    expect(result.status).toBe("holds")
    expect(result.ok).toBe(true)
    expect(result.cases.map((c) => c.id)).toEqual(["check-only", "ausente", "presente"])

    const byId = Object.fromEntries(result.cases.map((c) => [c.id, c]))
    // A ausência confirmada desliga o docker inteiro.
    expect(byId["check-only"]).toMatchObject({
      exit: 4,
      ok: true,
      runnerUp: false,
      composeCalls: 0,
    })
    // Nem um publisher que "dá certo" sobe o runner: a releitura é a garantia.
    expect(byId.ausente).toMatchObject({
      exit: 5,
      ok: true,
      runnerUp: false,
      composeCalls: 0,
      published: true,
    })
    // O CONTROLE: é ele que faz do "não subiu" uma prova.
    expect(byId.presente).toMatchObject({ exit: 0, ok: true, runnerUp: true })
  }, 30000)

  it("PROOF_CASES cobre os dois sentidos (bloqueio e contra-prova)", () => {
    expect(PROOF_CASES.filter((c) => c.expectRunnerUp).length).toBe(1)
    expect(PROOF_CASES.filter((c) => !c.expectRunnerUp).length).toBe(2)
    expect(PROOF_CASES.every((c) => c.why)).toBe(true)
  })
})

// ── a prova NÃO é vácua: mutações do bloqueio são detectadas ──────────────

describe("proveRunnerImageGate — detecta o bloqueio que deixou de existir", () => {
  it("bring-up que IGNORA a falha do ensure → violada, e o caso culpado é nomeado", async () => {
    const dir = mutatedRoot((content) => {
      const blocker =
        '  if [ "$ENSURE_CODE" -ne 0 ]; then\n' +
        '    fail "imagem do runner NÃO garantida (exit ${ENSURE_CODE}) — NADA foi subido."\n' +
        '    fail "O runner subiria e todos os jobs falhariam ao iniciar o container."\n' +
        '    exit "$ENSURE_CODE"\n' +
        "  fi"
      expect(content, "o bloco do bloqueio mudou de forma — atualize a mutação").toContain(blocker)
      return content.replace(blocker, '  warn "mutação: sigo em frente com a imagem não garantida"')
    })

    const result = await proveRunnerImageGate({ cwd: dir })
    expect(result.status).toBe("violated")
    expect(result.ok).toBe(false)

    const byId = Object.fromEntries(result.cases.map((c) => [c.id, c]))
    // A ausência passa a subir a stack: o runner aparece no log do docker.
    expect(byId.ausente.ok).toBe(false)
    expect(byId.ausente.runnerUp).toBe(true)
    expect(byId.ausente.failures.join(" | ")).toContain("runner SUBIU")
    // O controle CONTINUA passando — a falha é do bloqueio, não da prova.
    expect(byId.presente.ok).toBe(true)
  }, 30000)

  it("bring-up quebrado (nunca sobe o runner) → o CONTROLE falha: 'não subiu' não basta", async () => {
    // Sem o controle este caso seria reportado como "prova OK" — o runner não
    // subiu em nenhum dos três, e um script quebrado também não sobe nada.
    const dir = mutatedRoot((content) =>
      content.replace(
        '"${DOCKER_COMPOSE[@]}" up -d runner || { fail "docker compose up (runner) falhou"; exit 1; }',
        "true # mutação: o runner nunca sobe",
      ),
    )

    const result = await proveRunnerImageGate({ cwd: dir })
    expect(result.status).toBe("violated")
    const byId = Object.fromEntries(result.cases.map((c) => [c.id, c]))
    expect(byId.presente.ok).toBe(false)
    expect(byId.presente.failures.join(" | ")).toContain("faltou 'up -d runner'")
    // Os dois casos de ausência continuam "ok" (o runner realmente não subiu).
    expect(byId["check-only"].ok).toBe(true)
    expect(byId.ausente.ok).toBe(true)
  }, 30000)
})

// ── ausência de prova ≠ prova ─────────────────────────────────────────────

describe("proveRunnerImageGate — indisponível", () => {
  it("raiz sem o bring-up → 'unavailable' (nunca 'holds')", async () => {
    const dir = makeDir()
    const result = await proveRunnerImageGate({ cwd: dir })
    expect(result.status).toBe("unavailable")
    expect(result.ok).toBe(false)
    expect(result.detail).toContain(BRING_UP)
    expect(result.cases).toEqual([])
  })

  it("sem bash → 'unavailable', com o remédio na mensagem", async () => {
    const result = await proveRunnerImageGate({ cwd: ROOT, bash: "" })
    expect(result.status).toBe("unavailable")
    expect(result.detail).toContain("bash")
  })
})

// ── relatório e CLI ───────────────────────────────────────────────────────

describe("renderProof / parseArgs", () => {
  it("renderProof nomeia cada caso com exit, runner e 'compose'", async () => {
    const result = await proveRunnerImageGate({ cwd: ROOT })
    const lines: string[] = []
    renderProof(result, { emit: (s = "") => lines.push(s) })
    const text = lines.join("\n")
    expect(text).toContain("tag AUSENTE + --check-only")
    expect(text).toContain("runner não subiu")
    expect(text).toContain("runner SUBIU")
    expect(text).toMatch(/prova do bloqueio/)
  }, 30000)

  it("--cwd relativo vira absoluto; argumento desconhecido falha", () => {
    expect(parseArgs(["--cwd", "."]).cwd).toMatch(/^\//)
    expect(parseArgs(["--turbo"]).error).toContain("desconhecido")
    expect(parseArgs(["--cwd"]).error).toContain("--cwd exige")
    expect(parseArgs([]).cwd).toBe(ROOT)
  })
})

// ── a versão de teste não pode ser confundível com a da variável ──────────

describe("PROOF_VERSION", () => {
  it("é sintética e o fonte não a escreve numa linha com cara de default", () => {
    expect(PROOF_VERSION).toBe("9.9.9")
    const src = readFileSync(join(ROOT, "scripts", "prove-runner-image-gate.mjs"), "utf8")
    // O guard estático caça `^\s*(BUN_)?VERSION\s*=\s*<x.y.z>` no fonte: montar a
    // chave por código (como o check-bun-mirror faz com a tag) evita a armadilha.
    expect(src).not.toMatch(/^\s*(?:BUN_)?VERSION\s*=\s*["']?\d+\.\d+\.\d+/m)
  })
})
