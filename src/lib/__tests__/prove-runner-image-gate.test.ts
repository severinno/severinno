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
 * compose e os scripts que ele invoca. É o que permite mutar o bloqueio sem
 * tocar no repositório.
 *
 * O diretório `scripts/` INTEIRO é copiado (e não só o ensure): o passo 0 do
 * bring-up invoca `check-env-mirror.mjs`, que importa `check-registry-source`,
 * `check-actrc-sync` e `check-bun-mirror` — copiar um subconjunto deixaria a
 * raiz mutada sem o script, e TODOS os casos sairiam 1 pelo motivo errado.
 *
 * @param {(content: string) => string} mutate  recebe o gitea-up.sh e devolve o mutado
 */
function mutatedRoot(mutate: (content: string) => string): string {
  const dir = makeDir()
  mkdirSync(join(dir, "deploy"), { recursive: true })
  cpSync(
    join(ROOT, "deploy", "docker-compose.gitea.yml"),
    join(dir, "deploy", "docker-compose.gitea.yml"),
  )
  cpSync(join(ROOT, "scripts"), join(dir, "scripts"), { recursive: true })
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
  it("a prova se sustenta: sem a imagem o runner NÃO sobe (subida e re-registro) e com ela sobe", async () => {
    const result = await proveRunnerImageGate({ cwd: ROOT })
    expect(result.status).toBe("holds")
    expect(result.ok).toBe(true)
    expect(result.cases.map((c) => c.id)).toEqual([
      "check-only",
      "ausente",
      "presente",
      "re-register-sem-imagem",
      "re-register",
      "re-register-primeira-vez",
      "re-register-registro-preso",
    ])

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

    // ── FAMÍLIA B: sem a imagem, o re-registro não pode DESTRUIR nada ──────
    expect(byId["re-register-sem-imagem"]).toMatchObject({
      exit: 5,
      ok: true,
      runnerUp: false,
      composeCalls: 0,
      published: true,
      removal: false,
      volumeRm: false,
    })
    // CONTROLE: com a imagem, apaga ANTES de subir (a ordem é o que faz valer).
    expect(byId["re-register"]).toMatchObject({
      exit: 0,
      ok: true,
      runnerUp: true,
      removal: true,
      volumeRm: true,
      orderOk: true,
    })
    // Primeira subida: não há registro a apagar — e o comando não inventa um.
    expect(byId["re-register-primeira-vez"]).toMatchObject({
      exit: 0,
      ok: true,
      runnerUp: true,
      removal: true,
      volumeRm: false,
      orderOk: true,
    })
    // O registro que NÃO sai: o runner não sobe com os labels velhos.
    expect(byId["re-register-registro-preso"]).toMatchObject({
      exit: 1,
      ok: true,
      runnerUp: false,
      removal: true,
      volumeRm: true,
    })
  }, 60000)

  it("PROOF_CASES cobre os dois sentidos nas DUAS famílias (bloqueio e contra-prova)", () => {
    // A subida simples.
    const plain = PROOF_CASES.filter((c) => c.expectRemoval === undefined)
    expect(plain.filter((c) => c.expectRunnerUp).length).toBe(1)
    expect(plain.filter((c) => !c.expectRunnerUp).length).toBe(2)

    // O re-registro: 4 casos, dos quais 2 controles (o runner SOBE) — é o
    // contraste que faz do "não subiu" uma prova, e não um script quebrado.
    const reRegister = PROOF_CASES.filter((c) => c.expectRemoval !== undefined)
    expect(reRegister.length).toBe(4)
    expect(reRegister.filter((c) => c.expectRunnerUp).length).toBe(2)

    // Sem a imagem, o re-registro não pode destruir o registro que funciona.
    expect(reRegister.find((c) => c.registry === "missing")).toMatchObject({
      expectRunnerUp: false,
      expectRemoval: false,
      expectVolumeRm: false,
    })
    // Com a imagem, a ORDEM (apagar antes de subir) é parte do contrato do caso.
    expect(reRegister.filter((c) => c.expectOrder).length).toBe(2)
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

  it("bring-up quebrado (nunca sobe o runner) → os CONTROLES falham: 'não subiu' não basta", async () => {
    // Sem os controles este caso seria reportado como "prova OK" — o runner não
    // subiu em nenhum caso, e um script quebrado também não sobe nada. Os dois
    // controles do re-registro entram na mesma conta.
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
    expect(byId["re-register"].ok).toBe(false)
    expect(byId["re-register-primeira-vez"].ok).toBe(false)
    // Os casos de ausência continuam "ok" (o runner realmente não subiu).
    expect(byId["check-only"].ok).toBe(true)
    expect(byId.ausente.ok).toBe(true)
  }, 60000)
})

// ── o RE-REGISTRO também é provado por COMPORTAMENTO, não por asserção de texto ──
//
// A subida simples (`up -d runner` depois do ensure) já era provada. O
// re-registro acrescenta duas promessas que só o comportamento entrega: ele
// APAGA o registro gravado antes de subir, e ele se RECUSA a subir quando esse
// registro sobrevive. As mutações abaixo mostram que cada promessa tem uma
// asserção que cai junto com ela.

describe("proveRunnerImageGate — as promessas do re-registro", () => {
  it("bring-up que IGNORA o registro preso → o runner subiria com os labels velhos (pego)", async () => {
    const dir = mutatedRoot((content) => {
      const block =
        "      fail \"o volume '$RUNNER_VOLUME' ainda existe — o registro antigo sobreviveria e os labels NÃO seriam aplicados\"\n" +
        '      fail "Remédio: docker volume rm $RUNNER_VOLUME (com o container parado) e rode de novo."\n' +
        "      exit 1"
      expect(content, "o bloco do volume mudou de forma — atualize a mutação").toContain(block)
      return content.replace(block, "      true # mutação: ignoro o registro preso")
    })

    const result = await proveRunnerImageGate({ cwd: dir })
    expect(result.status).toBe("violated")
    const preso = Object.fromEntries(result.cases.map((c) => [c.id, c]))[
      "re-register-registro-preso"
    ]
    expect(preso.ok).toBe(false)
    expect(preso.runnerUp).toBe(true)
    expect(preso.failures.join(" | ")).toContain("runner SUBIU")
  }, 60000)

  it("bring-up que sobe o runner ANTES de apagar o registro → a ORDEM é pega", async () => {
    const dir = mutatedRoot((content) => {
      const anchor = 'if [ "$RE_REGISTER" -eq 1 ]; then'
      expect(content, "o bloco do re-registro mudou de forma — atualize a mutação").toContain(
        anchor,
      )
      return content.replace(
        anchor,
        '"${DOCKER_COMPOSE[@]}" up -d runner # mutação: sobe ANTES de apagar o registro\n' + anchor,
      )
    })

    const result = await proveRunnerImageGate({ cwd: dir })
    expect(result.status).toBe("violated")
    const control = Object.fromEntries(result.cases.map((c) => [c.id, c]))["re-register"]
    expect(control.ok).toBe(false)
    expect(control.orderOk).toBe(false)
    expect(control.failures.join(" | ")).toContain("subiu ANTES de o registro ser apagado")
  }, 60000)

  it("bring-up que apaga o registro ANTES de garantir a imagem → proteger o registro é pego", async () => {
    const dir = mutatedRoot((content) => {
      const anchor = "# ── 1. PRÉ-REQUISITO: a imagem do runner existe no registry ────────────────"
      expect(content, "o passo 1 mudou de forma — atualize a mutação").toContain(anchor)
      return content.replace(
        anchor,
        "# mutação: apago o registro ANTES de conferir a imagem\n" +
          'docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" rm -sf runner\n' +
          "docker volume rm gitea-runner-data >/dev/null 2>&1 || true\n" +
          anchor,
      )
    })

    const result = await proveRunnerImageGate({ cwd: dir })
    expect(result.status).toBe("violated")
    const semImagem = Object.fromEntries(result.cases.map((c) => [c.id, c]))[
      "re-register-sem-imagem"
    ]
    expect(semImagem.ok).toBe(false)
    expect(semImagem.removal).toBe(true)
    expect(semImagem.failures.join(" | ")).toContain("APAGADO")
  }, 60000)
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
    // No re-registro o relatório diz o que foi APAGADO, não só o exit.
    expect(text).toContain("registro apagado (rm -sf runner)")
    expect(text).toContain("registro INTACTO")
    expect(text).toContain("'volume rm' não emitido")
  }, 60000)

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
