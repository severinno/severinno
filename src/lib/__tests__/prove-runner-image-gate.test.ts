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
//      reportada como prova;
//   5. ela FALHA quando o PRÉ-REQUISITO 0 deixa de RECUSAR (bring-up mutado que
//      ignora a divergência do env) — e é isto que faz do job `bring-up-proof`
//      das duas forjas um GATE, e não um relatório: quem editar o `gitea-up.sh`
//      e tirar o bloqueio derruba a prova, e o CI junto.
//   6. a CADEIA bring-up → doctor → prova → bring-up é FINITA, e quem a torna
//      finita é a DUBLAGEM do doctor na prova. Sem esta prova, o único jeito
//      "seguro" de o bring-up chamar o doctor seria pedir-lhe `--no-proof` — que
//      devolve o veredito parcial POR CONSTRUÇÃO (a subida acontece sem que o
//      portão de bloqueio tenha sido provado). O teste mede o CORTE, não o
//      promete: o doctor real é envolvido por um contador e a contagem tem de
//      ser EXATAMENTE 1.
//
// SEM docker e SEM rede externa: o registry é um node:http em 127.0.0.1 e o
// `docker`/`gh` são dublês no PATH. O `bash` é o real (a prova executa o script
// de verdade).
// =============================================================================

import { spawn } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, join } from "node:path"

import { afterAll, describe, expect, it } from "vitest"

import {
  BRING_UP,
  PROOF_CASES,
  PROOF_VERSION,
  RUNBOOK,
  SETUP_SCRIPT,
  installerInstructions,
  makeFakeBin,
  parseArgs,
  proveRunnerImageGate,
  renderProof,
  resolveInstruction,
  runbookInvocation,
  startTestRegistry,
  writeProofEnv,
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
 * @param {{setup?: (content: string) => string, runbook?: (content: string) => string}} [also]
 *   mutações do INSTALADOR e do RUNBOOK (a FAMÍLIA D tira as instruções deles)
 */
function mutatedRoot(
  mutate: (content: string) => string,
  also: { setup?: (content: string) => string; runbook?: (content: string) => string } = {},
): string {
  const dir = makeDir()
  mkdirSync(join(dir, "deploy"), { recursive: true })
  cpSync(
    join(ROOT, "deploy", "docker-compose.gitea.yml"),
    join(dir, "deploy", "docker-compose.gitea.yml"),
  )
  cpSync(join(ROOT, "scripts"), join(dir, "scripts"), { recursive: true })
  // O INSTALADOR e o RUNBOOK também entram: a FAMÍLIA D extrai as instruções
  // DELES — sem os arquivos, os três casos daquela família sairiam vermelhos por
  // "documento ausente" em TODA mutação (inclusive nas que não têm nada a ver com
  // eles), e a mutação certa ficaria escondida no meio do ruído.
  for (const rel of [SETUP_SCRIPT, RUNBOOK]) cpSync(join(ROOT, rel), join(dir, rel))
  const bringUp = readFileSync(join(ROOT, BRING_UP), "utf8")
  writeFileSync(join(dir, BRING_UP), mutate(bringUp))
  for (const [rel, fn] of [
    [SETUP_SCRIPT, also.setup],
    [RUNBOOK, also.runbook],
  ] as const) {
    if (fn) writeFileSync(join(dir, rel), fn(readFileSync(join(dir, rel), "utf8")))
  }
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
  it("a prova se sustenta: sem a imagem o runner NÃO sobe (subida e re-registro), e com o env divergente a stack não sobe, e com a imagem e o env em sincronia sobe", async () => {
    const result = await proveRunnerImageGate({ cwd: ROOT })
    expect(result.status).toBe("holds")
    expect(result.ok).toBe(true)
    expect(result.cases.map((c) => c.id)).toEqual([
      "env-divergente",
      "env-divergente-check-only",
      "env-segredo-igual-ao-template",
      "check-only",
      "ausente",
      "presente",
      "re-register-sem-imagem",
      "re-register",
      "re-register-primeira-vez",
      "re-register-registro-preso",
      "installer-check-only",
      "installer-subida",
      "runbook-re-register",
      "no-runner",
      "re-register-check-only",
      "re-register-no-runner",
    ])

    const byId = Object.fromEntries(result.cases.map((c) => [c.id, c]))

    // ── FAMÍLIA C: o PRÉ-REQUISITO 0 — a imagem EXISTE e a stack não sobe ────
    // As três rodam com o registry em `exists` de propósito: se a stack não sobe
    // com a imagem presente, a causa só pode ser o passo 0. E o ZERO de chamadas
    // ao docker e de idas ao registry é o que prova a ORDEM (a recusa veio ANTES
    // do ensure, não depois).
    for (const id of [
      "env-divergente",
      "env-divergente-check-only",
      "env-segredo-igual-ao-template",
    ]) {
      expect(byId[id]).toMatchObject({
        exit: 1,
        ok: true,
        runnerUp: false,
        composeCalls: 0,
        dockerCalls: 0,
        registryHits: 0,
        mirrorRefused: true,
        family: "env-mirror",
      })
    }

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

    // ── AS FLAGS RECEBIDAS: o argv do processo que rodou, não a linha do script ──
    // Cada filho recebeu o arquivo DESTA subida (o mesmo `--env-file`/template do
    // caso) — é o que faz de "o bring-up passa --gitea-env" uma medida.
    expect(byId.presente.mirrorArgs?.slice(0, 4)).toEqual([
      "--host",
      expect.stringContaining("gitea.env"),
      "--template",
      expect.stringContaining("env.gitea.example"),
    ])
    expect(byId.presente.ensureArgs).toContain("--gitea-env")
    expect(byId.presente.ensureArgs).not.toContain("--env-file")
    expect(byId.presente.doctorArgs).toContain("--gitea-env")
    expect(byId.presente.doctorArgs).not.toContain("--no-proof")
    // O `--no-runner-labels` é do REMÉDIO, não da subida normal.
    expect(byId.presente.doctorArgs).not.toContain("--no-runner-labels")
    expect(byId["re-register"].doctorArgs).toContain("--no-runner-labels")
    expect(byId["re-register"].doctorBeforeStack).toBe(true)
    // A recusa do passo 0 acontece ANTES do passo 1: o espião do ensure não foi
    // chamado (e é isso que a "ordem" quer dizer em execução).
    for (const id of [
      "env-divergente",
      "env-divergente-check-only",
      "env-segredo-igual-ao-template",
    ]) {
      expect(byId[id].ensureArgs).toBeNull()
    }
    expect(byId["check-only"].ensureArgs).toContain("--check")
    expect(byId.ausente.ensureArgs).not.toContain("--check")

    // ── FAMÍLIA D: as INSTRUÇÕES, extraídas e EXECUTADAS ───────────────────
    expect(byId["installer-check-only"]).toMatchObject({
      exit: 0,
      ok: true,
      runnerUp: false,
      composeCalls: 0,
    })
    expect(byId["installer-subida"]).toMatchObject({ exit: 0, ok: true, runnerUp: true })
    expect(byId["runbook-re-register"]).toMatchObject({
      exit: 0,
      ok: true,
      runnerUp: true,
      removal: true,
      volumeRm: true,
      orderOk: true,
    })
    // A instrução executada é DITA no relatório (é o que torna a evidência
    // legível: quem lê sabe qual comando do documento produziu aquele exit).
    expect(byId["installer-check-only"].invokedAs).toContain("installer-check-only")
    expect(byId["installer-check-only"].invokedAs).toContain("gitea-up.sh --check-only")
    expect(byId["runbook-re-register"].invokedAs).toBe("runbook --re-register")

    // ── FAMÍLIA: --no-runner — sobe Gitea+Caddy, pula pré-requisitos do runner ─
    expect(byId["no-runner"]).toMatchObject({
      exit: 0,
      ok: true,
      runnerUp: false,
      composeCalls: 1,
      dockerCalls: 1,
      registryHits: 0,
      mirrorRefused: false,
    })
    // O espelho NÃO foi invocado: o --no-runner pula o passo 0.
    expect(byId["no-runner"].mirrorArgs).toBeNull()
    // O ensure NÃO foi invocado: o --no-runner pula o passo 1.
    expect(byId["no-runner"].ensureArgs).toBeNull()

    // ── FAMÍLIA: combinações contraditórias — ZERO docker, ZERO registry ──────
    expect(byId["re-register-check-only"]).toMatchObject({
      exit: 1,
      ok: true,
      runnerUp: false,
      composeCalls: 0,
      dockerCalls: 0,
      registryHits: 0,
    })
    expect(byId["re-register-no-runner"]).toMatchObject({
      exit: 1,
      ok: true,
      runnerUp: false,
      composeCalls: 0,
      dockerCalls: 0,
      registryHits: 0,
    })
  }, 60000)

  it("PROOF_CASES cobre os dois sentidos nas TRÊS famílias (bloqueio e contra-prova)", () => {
    // A subida simples (família `image`).
    const plain = PROOF_CASES.filter((c) => c.family === "image")
    expect(plain.filter((c) => c.expectRunnerUp).length).toBe(1)
    expect(plain.filter((c) => !c.expectRunnerUp).length).toBe(2)

    // O passo 0 (família `env-mirror`): a imagem EXISTE em todos e a stack não
    // sobe — nenhum deles toca no docker nem vai ao registry.
    const envMirror = PROOF_CASES.filter((c) => c.family === "env-mirror")
    expect(envMirror.length).toBe(3)
    expect(envMirror.every((c) => !c.expectRunnerUp)).toBe(true)
    expect(envMirror.every((c) => c.expectMirrorMsg === true)).toBe(true)
    expect(envMirror.every((c) => c.expectDockerCalls === 0)).toBe(true)
    expect(envMirror.every((c) => c.expectRegistryHits === 0)).toBe(true)
    expect(envMirror.every((c) => c.registry === "exists")).toBe(true)
    // A CONTRA-PROVA do passo 0 mora na família `image` (o caso `presente`): é o
    // caso com o env EM SINCRONIA que faz do "não subiu" um bloqueio, e não um
    // bring-up que aborta por qualquer motivo.
    expect(
      PROOF_CASES.filter((c) => c.family === "image" && c.expectMirrorMsg === false),
    ).toHaveLength(1)

    // O re-registro: 4 casos, dos quais 2 controles (o runner SOBE) — é o
    // contraste que faz do "não subiu" uma prova, e não um script quebrado.
    const reRegister = PROOF_CASES.filter((c) => c.family === "re-register")
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

    // As INSTRUÇÕES (família `instructions`): 3 casos, e TODOS tiram o comando de
    // um documento (é `invocation` que os distingue dos que rodam o bring-up
    // direto) — sem isso, um caso "de instrução" que na verdade rodasse o
    // bring-up passaria sem provar nada sobre o que o operador copia.
    const instructions = PROOF_CASES.filter((c) => c.family === "instructions")
    expect(instructions.length).toBe(3)
    expect(instructions.every((c) => c.invocation)).toBe(true)
    expect(instructions.filter((c) => c.expectRunnerUp).length).toBe(2)
    expect(instructions.filter((c) => c.expectDoctorBeforeStack).length).toBe(2)

    // TODA família tem os dois sentidos quando ela decide a subida: um caso de
    // CONTROLE (a stack sobe) e um de BLOQUEIO — é o contraste que faz do "não
    // subiu" uma prova em vez de um script quebrado.
    for (const id of ["image", "re-register", "instructions"]) {
      const cases = PROOF_CASES.filter((c) => c.family === id)
      expect(
        cases.some((c) => c.expectRunnerUp),
        `${id}: falta o controle`,
      ).toBe(true)
      expect(
        cases.some((c) => !c.expectRunnerUp),
        `${id}: falta o bloqueio`,
      ).toBe(true)
    }

    // TODOS os casos recebem o env do host conferido pelo espelho: a asserção é
    // declarada caso a caso (não herdada), para um caso novo sem ela aparecer no
    // diff em vez de passar em silêncio. O --no-runner e as combinações
    // contraditórias NÃO conferem o espelho (o passo 0 é pulado).
    expect(
      PROOF_CASES.filter((c) => c.family !== "no-runner" && c.family !== "contradiction").every(
        (c) => c.expectMirrorFlags === true,
      ),
    ).toBe(true)
    expect(PROOF_CASES.every((c) => c.why)).toBe(true)
    // O --no-runner pula os TRÊS pré-requisitos do runner.
    expect(
      PROOF_CASES.filter((c) => c.family === "no-runner").every(
        (c) => c.expectMirrorFlags === false,
      ),
    ).toBe(true)
    expect(
      PROOF_CASES.filter((c) => c.family === "no-runner").every(
        (c) => c.expectEnsureFlags === "not",
      ),
    ).toBe(true)
    // As combinações contraditórias recusam ANTES de qualquer docker.
    expect(
      PROOF_CASES.filter((c) => c.family === "contradiction").every(
        (c) => c.expectDockerCalls === 0,
      ),
    ).toBe(true)
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

// ── o PRÉ-REQUISITO 0 também é provado por COMPORTAMENTO, não por texto ──
//
// O `checkGiteaBringUp` prende a ORDEM no TEXTO do `gitea-up.sh` (o passo 0 roda
// antes do ensure). Texto não distingue "recusa" de "está quebrado" — um
// bring-up que aborta por qualquer outro motivo também não sobe o runner e
// passaria. A mutação abaixo TIRA o bloqueio do passo 0 e a prova tem de cair:
// é o que sustenta o job `bring-up-proof` como gate de merge.

describe("proveRunnerImageGate — o PRÉ-REQUISITO 0 (o env do host)", () => {
  it("bring-up que IGNORA a divergência do env → violada: a stack subiria com o env errado", async () => {
    const dir = mutatedRoot((content) => {
      const anchor = '  if [ "$MIRROR_CODE" -ne 0 ]; then'
      expect(content, "o passo 0 mudou de forma — atualize a mutação").toContain(anchor)
      return content.replace(anchor, "  if false; then # mutação: ignoro a divergência do env")
    })

    const result = await proveRunnerImageGate({ cwd: dir })
    expect(result.status).toBe("violated")
    const byId = Object.fromEntries(result.cases.map((c) => [c.id, c]))

    // Nenhum dos três casos do passo 0 RECUSA mais — a recusa deixou de acontecer.
    for (const id of [
      "env-divergente",
      "env-divergente-check-only",
      "env-segredo-igual-ao-template",
    ]) {
      expect(byId[id].ok).toBe(false)
      expect(byId[id].mirrorRefused).toBe(false)
      expect(byId[id].failures.length).toBeGreaterThan(0)
    }
    // O pior desfecho, nomeado: o runner SOBE com o env divergente — exatamente o
    // que o passo 0 existe para impedir.
    expect(byId["env-divergente"].runnerUp).toBe(true)
    expect(byId["env-divergente"].failures.join(" | ")).toContain("o runner SUBIU")
    expect(byId["env-segredo-igual-ao-template"].runnerUp).toBe(true)
    // O `--check-only` não sobe, mas deixou de recusar: ele passou a CONSULTAR o
    // registry (a ida que o passo 0 existia para evitar) e termina em 0.
    expect(byId["env-divergente-check-only"].exit).toBe(0)
    expect(byId["env-divergente-check-only"].registryHits).toBeGreaterThan(0)

    // O CONTROLE continua passando: a falha é do bloqueio, não da prova.
    expect(byId.presente.ok).toBe(true)
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

// ── o CICLO: bring-up → doctor → prova → bring-up é FINITO ────────────────
//
// POR QUE ESTE TESTE EXISTE: o `deploy/gitea-up.sh` roda o doctor (passo 2), o
// doctor executa ESTA prova (seção 4 dele) e a prova executa o bring-up. A
// cadeia só é finita porque a prova DUBLA o doctor — e é isso que este teste
// MEDE, em vez de prometer: o doctor real é envolvido por um contador, e a
// contagem tem de ser EXATAMENTE 1 (o de cima). Se a dublagem sumir, a contagem
// cresce — e o contador RECUSA a reentrada (exit 99) em vez de deixar a máquina
// forkar, o que é o que torna a mutação executável.
//
describe("o ciclo bring-up → doctor → prova termina (a dublagem do doctor o corta)", () => {
  it("bring-up com o doctor REAL (sem --no-proof) termina, a prova RODA dentro dele e o doctor real é invocado 1x", async () => {
    // A mutação NÃO tira o ciclo: ela tira o `--no-proof` (que é o estado que o
    // repositório passou a exigir) e desliga as seções que NÃO são o ciclo — o
    // teste mede o CICLO, não a bateria de guards, e a seção da PROVA (a que
    // fecha o ciclo) é justamente a que fica ligada.
    const dir = mutatedRoot((content) => {
      const anchor = '--gitea-env "$ENV_FILE" "${DOCTOR_ARGS[@]}"'
      expect(content, "a linha do doctor mudou de forma — atualize a mutação").toContain(anchor)
      return content.replace(
        anchor,
        '--gitea-env "$ENV_FILE" --no-guards --no-protection --no-registry-probe --no-image-contract --no-runner-labels --no-open-debt --no-compose-render "${DOCTOR_ARGS[@]}"',
      )
    })
    // A INVOCAÇÃO (não o arquivo): o header do gitea-up.sh explica POR QUE o
    // `--no-proof` está ausente, então a asserção tem de olhar a linha que roda.
    const bringUpText = readFileSync(join(dir, BRING_UP), "utf8")
    const doctorLine = bringUpText
      .split("\n")
      .find((l) => l.trimStart().startsWith("node") && l.includes("DOCTOR_SCRIPT"))
    expect(doctorLine, "a linha de invocação do doctor não foi encontrada").toBeTruthy()
    expect(doctorLine).not.toContain("--no-proof")
    expect(doctorLine).toContain("--no-compose-render")

    const reg = await startTestRegistry("exists")
    const fake = makeFakeBin(dir, { volume: "removable" })
    const { envFile, templateFile } = writeProofEnv(dir, reg.url, "sync")

    // O contador: cada invocação do doctor REAL entra no log, e a partir da 2ª o
    // dublê recusa em vez de reentrar. É o que transforma "sumiu a dublagem" de
    // forca de processos em um vermelho legível.
    const doctorLog = join(dir, "doctor-depth.log")
    writeFileSync(doctorLog, "")
    const wrapper = join(dir, "doctor-wrapper.mjs")
    writeFileSync(
      wrapper,
      [
        'import { appendFileSync, readFileSync } from "node:fs"',
        'import { spawnSync } from "node:child_process"',
        `const LOG = ${JSON.stringify(doctorLog)}`,
        // O doctor REAL do repositório (e não a cópia da raiz mutada): é ele que
        // responde pelo contrato/manifesto, que a raiz sintética não tem — e a
        // prova dentro dele executa o bring-up REAL, que é o que queremos medir.
        `const REAL = ${JSON.stringify(join(ROOT, "scripts", "forge-doctor.mjs"))}`,
        'const runs = readFileSync(LOG, "utf8").split("\\n").filter(Boolean)',
        "if (runs.length >= 1) {",
        '  console.error("CICLO DETECTADO: o doctor real seria reentrado — a dublagem da prova sumiu")',
        "  process.exit(99)",
        "}",
        'appendFileSync(LOG, JSON.stringify(process.argv.slice(2)) + "\\n")',
        'const res = spawnSync(process.execPath, [REAL, ...process.argv.slice(2)], { stdio: "inherit" })',
        "process.exit(res.status ?? 1)",
        "",
      ].join("\n"),
    )

    let out = ""
    let status: number | null = null
    try {
      status = await new Promise<number | null>((done) => {
        const child = spawn("bash", [join(dir, BRING_UP), "--env-file", envFile, "--check-only"], {
          cwd: dir,
          env: {
            ...process.env,
            PATH: `${fake.binDir}${delimiter}${process.env.PATH ?? ""}`,
            TEMPLATE_FILE: templateFile,
            // O contador NO LUGAR do doctor: o bring-up de cima o invoca, e a
            // prova (lá dentro) troca `DOCTOR_SCRIPT` pelo dublê dela.
            DOCTOR_SCRIPT: wrapper,
            HEALTH_TIMEOUT: "1",
          },
        })
        child.stdout?.on("data", (c) => (out += c))
        child.stderr?.on("data", (c) => (out += c))
        // A REDE: sem ela um ciclo sem fim penduraria a suíte em vez de falhar.
        const killer = setTimeout(() => child.kill("SIGKILL"), 120000)
        child.on("close", (code) => {
          clearTimeout(killer)
          done(code)
        })
        child.on("error", (err) => {
          clearTimeout(killer)
          out += `\n${err.message}`
          done(null)
        })
      })
    } finally {
      await reg.close()
    }

    // O LIMITE não vira asserção de relógio (o guard de bomba-relógio, com razão,
    // proíbe `Date.now()` em asserção — e um limiar de segundos numa suíte é
    // flake): quem prende o ciclo é o `SIGKILL` acima. Se a cadeia não terminasse,
    // `status` viria `null` e a asserção abaixo cai.
    expect(status, out).toBe(0)
    // A PROVA RODOU dentro do doctor: sem isto, o bring-up poderia estar
    // "terminando" por ter pulado justamente a seção que fecha o ciclo.
    expect(out).toContain("Prova do bloqueio")
    expect(out).toMatch(/\d+ caso\(s\):/)
    expect(out).not.toContain("pulada por --no-proof")
    // O CORTE medido: o doctor REAL rodou UMA vez (o de cima). Todas as descidas
    // foram para o DUBLÊ da prova — é isto que torna a cadeia finita, e é isto
    // que permite ao bring-up rodar o doctor INTEIRO em vez de `--no-proof`.
    const runs = readFileSync(doctorLog, "utf8").split("\n").filter(Boolean)
    expect(runs, out).toHaveLength(1)
  }, 130000)
})

// ── AS FLAGS: o que o bring-up PASSA é medido no argv, não lido no texto ──
//
// O guard `checkGiteaBringUp` prende as flags no TEXTO do `gitea-up.sh` ("a linha
// do espelho tem --host/--template", "a do doctor tem --gitea-env"). Estas
// mutações preservam a MENÇÃO (o guard de texto continuaria verde) e tiram a
// FLAG: quem pega é o argv que o espião do filho gravou — o processo que rodou.

describe("proveRunnerImageGate — as flags recebidas por cada filho", () => {
  it("espelho invocado SEM --host/--template → violada, e o caso diz qual flag sumiu", async () => {
    const dir = mutatedRoot((content) => {
      const anchor = 'node "$MIRROR_SCRIPT" --host "$ENV_FILE" --template "$TEMPLATE_FILE"'
      expect(content, "a invocação do espelho mudou de forma — atualize a mutação").toContain(
        anchor,
      )
      // A menção ao script FICA (o guard de texto passaria): o que morre é a flag,
      // e só o argv medido a denuncia.
      return content.replace(anchor, 'node "$MIRROR_SCRIPT"')
    })

    const result = await proveRunnerImageGate({ cwd: dir })
    expect(result.status).toBe("violated")
    const presente = result.cases.find((c) => c.id === "presente")
    expect(presente?.ok).toBe(false)
    expect(presente?.mirrorArgs).toEqual([])
    expect(presente?.failures.join(" | ")).toContain("--host")
  }, 60000)

  it("ensure lendo OUTRO arquivo (--gitea-env trocado) → violada, mesmo com o desfecho igual", async () => {
    const dir = mutatedRoot((content) => {
      const anchor = 'ENSURE_ARGS=(--gitea-env "$ENV_FILE" --source "$SOURCE")'
      expect(content, "os argumentos do ensure mudaram de forma — atualize a mutação").toContain(
        anchor,
      )
      // A flag continua lá e o desfecho do caso continua VERDE (o template aponta
      // para o mesmo registry): é a medida do argv — e só ela — que pega isto.
      return content.replace(
        anchor,
        'ENSURE_ARGS=(--gitea-env "$TEMPLATE_FILE" --source "$SOURCE")',
      )
    })

    const result = await proveRunnerImageGate({ cwd: dir })
    expect(result.status).toBe("violated")
    const presente = result.cases.find((c) => c.id === "presente")
    expect(presente?.exit).toBe(0)
    expect(presente?.runnerUp).toBe(true)
    expect(presente?.failures.join(" | ")).toContain("OUTRO env")
  }, 60000)

  it("doctor SEM --gitea-env → violada (o veredito mediria outro arquivo)", async () => {
    const dir = mutatedRoot((content) => {
      const anchor = 'node "$DOCTOR_SCRIPT" --gitea-env "$ENV_FILE" "${DOCTOR_ARGS[@]}"'
      expect(content, "a linha do doctor mudou de forma — atualize a mutação").toContain(anchor)
      return content.replace(anchor, 'node "$DOCTOR_SCRIPT" "${DOCTOR_ARGS[@]}"')
    })

    const result = await proveRunnerImageGate({ cwd: dir })
    expect(result.status).toBe("violated")
    const presente = result.cases.find((c) => c.id === "presente")
    expect(presente?.ok).toBe(false)
    expect(presente?.failures.join(" | ")).toContain("--gitea-env")
  }, 60000)

  it("--no-runner-labels fora do --re-register → violada (o remédio ficaria travado pelo registro que ele cura)", async () => {
    const dir = mutatedRoot((content) => {
      const anchor = '[ "$RE_REGISTER" -eq 1 ] && DOCTOR_ARGS+=(--no-runner-labels)'
      expect(content, "a isenção do re-registro mudou de forma — atualize a mutação").toContain(
        anchor,
      )
      return content.replace(
        anchor,
        ": # mutação: o re-registro passa ao doctor o MESMO argv da subida normal",
      )
    })

    const result = await proveRunnerImageGate({ cwd: dir })
    expect(result.status).toBe("violated")
    const byId = Object.fromEntries(result.cases.map((c) => [c.id, c]))
    for (const id of [
      "re-register",
      "re-register-primeira-vez",
      "re-register-registro-preso",
      "runbook-re-register",
    ]) {
      expect(byId[id].ok, id).toBe(false)
      expect(byId[id].failures.join(" | "), id).toContain("--no-runner-labels")
    }
    // O CONTROLE segue verde: a falha é da ISENÇÃO, não da prova.
    expect(byId.presente.ok).toBe(true)
    // E o contrário também é contrato: na subida normal a flag NÃO pode aparecer.
    expect(PROOF_CASES.find((c) => c.id === "presente")?.expectDoctorArgs?.noRunnerLabels).toBe(
      false,
    )
  }, 60000)
})

// ── FAMÍLIA D: as instruções saem do documento e são EXECUTADAS ────────────

describe("installerInstructions / resolveInstruction — a instrução se lê do que se imprime", () => {
  const SETUP_SRC = [
    "#!/bin/bash",
    'echo "  4. Para ativar o Runner (CI/CD):"',
    'echo "     c) Execute:"',
    "echo \"        sed -i 's|COLE_O_TOKEN_AQUI|SEU_TOKEN|' $GITEA_DIR/.env\"",
    'echo "        ENV_FILE=$GITEA_DIR/.env COMPOSE_FILE=$GITEA_DIR/docker-compose.yml \\\\"',
    'echo "          bash $REPO_DIR/deploy/gitea-up.sh"',
    'echo ""',
    'echo "        ENV_FILE=$GITEA_DIR/.env bash $REPO_DIR/deploy/gitea-up.sh --check-only"',
    "",
  ].join("\n")

  it("tira o comando de dentro dos echo e junta a continuação", () => {
    const { full, checkOnly, missing } = installerInstructions(SETUP_SRC)
    expect(missing).toEqual({ full: "", checkOnly: "" })
    expect(full?.env).toEqual({
      ENV_FILE: "$GITEA_DIR/.env",
      COMPOSE_FILE: "$GITEA_DIR/docker-compose.yml",
    })
    expect(full?.script).toBe("$REPO_DIR/deploy/gitea-up.sh")
    expect(full?.flags).toEqual([])
    expect(checkOnly?.flags).toEqual(["--check-only"])
  })

  it("prosa que MENCIONA o gitea-up.sh não vira instrução executável", () => {
    const { instructions, missing } = installerInstructions(
      'echo "  c) Execute (o gitea-up.sh GARANTE a imagem do runner antes de subir)"',
    )
    expect(instructions).toEqual([])
    expect(missing.full).toContain("SEM --check-only")
    expect(missing.checkOnly).toContain("--check-only")
  })

  it("instalador sem a instrução --check-only → a ausência é dita POR INSTRUÇÃO", () => {
    const { full, checkOnly, missing } = installerInstructions(
      'echo "ENV_FILE=$GITEA_DIR/.env bash $REPO_DIR/deploy/gitea-up.sh"',
    )
    expect(checkOnly).toBeNull()
    expect(missing.checkOnly).toContain("--check-only")
    // A OUTRA instrução existe e não é acusada: quem responde pelo `--check-only`
    // é o caso do `--check-only`.
    expect(full).toBeTruthy()
    expect(missing.full).toBe("")
  })

  it("resolve $GITEA_DIR/$REPO_DIR nos diretórios do caso", () => {
    const { full } = installerInstructions(SETUP_SRC)
    const r = resolveInstruction(full!, { giteaDir: "/tmp/g", repoDir: "/tmp/r" })
    expect(r.errors).toEqual([])
    expect(r.env).toEqual({ ENV_FILE: "/tmp/g/.env", COMPOSE_FILE: "/tmp/g/docker-compose.yml" })
    expect(r.script).toBe("/tmp/r/deploy/gitea-up.sh")
  })

  it("variável que o instalador NÃO define → erro, não execução com um '$' literal", () => {
    const { full } = installerInstructions(
      'echo "ENV_FILE=$OUTRO/.env bash $REPO_DIR/deploy/gitea-up.sh"',
    )
    const r = resolveInstruction(full!, { giteaDir: "/tmp/g", repoDir: "/tmp/r" })
    expect(r.errors.join(" | ")).toContain("ENV_FILE")
  })
})

describe("runbookInvocation — as flags saem do bloco CERCADO (o que se copia)", () => {
  it("extrai as flags do comando cercado, juntando a continuação", () => {
    const r = runbookInvocation(
      [
        "prosa: `bash deploy/gitea-up.sh --re-register`",
        "```bash",
        "cd /opt/gitea",
        "ENV_FILE=/opt/gitea/.env COMPOSE_FILE=/opt/gitea/docker-compose.yml \\",
        "  bash $REPO/deploy/gitea-up.sh --re-register",
        "```",
      ].join("\n"),
    )
    expect(r.errors).toEqual([])
    expect(r.flags).toEqual(["--re-register"])
  })

  it("a PROSA que cita a flag não conta — o que vale é o bloco copiável", () => {
    const r = runbookInvocation("Use `bash deploy/gitea-up.sh --re-register` para trocar o label.")
    expect(r.flags).toEqual([])
    expect(r.errors.join(" | ")).toContain("--re-register")
  })
})

describe("proveRunnerImageGate — as instruções dos DOCUMENTOS são executadas", () => {
  it("instalador que deixa de imprimir a instrução --check-only → violada, e só ela", async () => {
    const dir = mutatedRoot((c) => c, {
      setup: (content) => {
        const anchor = "bash $REPO_DIR/deploy/gitea-up.sh --check-only"
        expect(content, "a instrução --check-only mudou de forma — atualize a mutação").toContain(
          anchor,
        )
        return content.replace(anchor, "docker compose up -d runner --check-only")
      },
    })

    const result = await proveRunnerImageGate({ cwd: dir })
    expect(result.status).toBe("violated")
    const byId = Object.fromEntries(result.cases.map((c) => [c.id, c]))
    expect(byId["installer-check-only"].ok).toBe(false)
    expect(byId["installer-check-only"].failures.join(" | ")).toContain("--check-only")
    // As outras duas instruções continuam sendo executadas: a falha é da que
    // sumiu, não do extrator.
    expect(byId["installer-subida"].ok).toBe(true)
    expect(byId["runbook-re-register"].ok).toBe(true)
  }, 60000)

  it("runbook que ensina uma flag que o bring-up RECUSA → violada (o comando copiável não funciona)", async () => {
    const dir = mutatedRoot((c) => c, {
      runbook: (content) => {
        const anchor = "gitea-up.sh --re-register"
        expect(content, "o comando do runbook mudou de forma — atualize a mutação").toContain(
          anchor,
        )
        // O guard de TEXTO continuaria passando (a string `gitea-up.sh
        // --re-register` sobrevive): o que cai é a execução.
        return content.replace(anchor, "gitea-up.sh --re-register --turbo")
      },
    })

    const result = await proveRunnerImageGate({ cwd: dir })
    expect(result.status).toBe("violated")
    const runbook = result.cases.find((c) => c.id === "runbook-re-register")
    expect(runbook?.ok).toBe(false)
    expect(runbook?.invokedAs).toBe("runbook --re-register --turbo")
    expect(runbook?.failures.join(" | ")).toContain("runbook --re-register --turbo")
  }, 60000)
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
