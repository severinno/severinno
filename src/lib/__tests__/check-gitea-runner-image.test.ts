// =============================================================================
// check-gitea-runner-image.test.ts
//
// Testes do checkGiteaRunnerImage (scripts/check-bun-mirror.mjs): a label do
// runner da forja tem de apontar para a imagem que EMBARCA o Bun na versão da
// variável. Sem isso o tier-1 (fast path, 0s) do setup NUNCA engaja e todo job
// paga o download do tier 3 — em SILÊNCIO, porque o setup funciona nos dois
// casos; só muda a velocidade.
//
// Padrão do repo: funções PURAS testadas com conteúdo sintético + uma asserção
// contra os arquivos REAIS do repositório (o que vale é o guard que roda aqui).
// =============================================================================

import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import {
  ENV_MIRROR_SCRIPT,
  FORGE_DOCTOR,
  GITEA_BRING_UP,
  GITEA_COMPOSE,
  GITEA_DOC,
  GITEA_ENV_MIRROR,
  GITEA_SETUP,
  PROOF_SCRIPT,
  checkDoctorCycleCut,
  checkGiteaBringUp,
  checkGiteaRunnerImage,
  checkReRegisterPath,
} from "../../../scripts/check-bun-mirror.mjs"

const ROOT = process.cwd()
// '$' montado por código — um '$' seguido de '{' no fonte viraria interpolação.
const D = String.fromCharCode(36)
const VAR = D + "{BUN_VERSION"

/** Compose mínimo com a label do runner. */
function compose(labels: string): string {
  return `services:\n  runner:\n    image: gitea/act_runner:latest\n    environment:\n      - GITEA_RUNNER_LABELS=${labels}\n`
}

const OK_LABELS = `ubuntu-latest:docker://ghcr.io/severinno/ubuntu-bun:${VAR}`
const OK_ENV = "IMAGE_REGISTRY=ghcr.io\nIMAGE_NAMESPACE=severinno\nBUN_VERSION=1.3.14\n"

describe("checkGiteaRunnerImage — forma da label do runner", () => {
  it("label para a imagem ubuntu-bun com a variável da versão → zero violações", () => {
    expect(checkGiteaRunnerImage(compose(OK_LABELS), OK_ENV)).toEqual([])
  })

  it("label apontando para imagem SEM Bun (node:20-bullseye) → violação", () => {
    const v = checkGiteaRunnerImage(compose("ubuntu-latest:docker://node:20-bullseye"), OK_ENV)
    expect(v.some((x) => x.includes("ubuntu-bun"))).toBe(true)
    expect(v.some((x) => x.includes("tier-1"))).toBe(true)
  })

  it("tag LITERAL (sem a variável) → violação (segundo ponto de verdade)", () => {
    const v = checkGiteaRunnerImage(
      compose("ubuntu-latest:docker://ghcr.io/severinno/ubuntu-bun:1.3.14"),
      OK_ENV,
    )
    expect(v.length).toBe(1)
    expect(v[0]).toContain("TAG")
  })

  it("labels ausentes no compose → violação", () => {
    const v = checkGiteaRunnerImage("services:\n  runner:\n    image: gitea/act_runner\n", OK_ENV)
    expect(v.length).toBe(1)
    expect(v[0]).toContain("GITEA_RUNNER_LABELS ausente")
  })

  it("espelho sem BUN_VERSION → violação (a tag resolveria vazia)", () => {
    const v = checkGiteaRunnerImage(compose(OK_LABELS), "RUNNER_TOKEN=x\n")
    expect(v.length).toBe(1)
    expect(v[0]).toContain("BUN_VERSION não definido")
  })

  it("as três quebras somam (imagem sem Bun + tag literal + espelho sem versão)", () => {
    const v = checkGiteaRunnerImage(compose("ubuntu-latest:docker://node:20-bullseye"), "")
    expect(v.length).toBe(3)
  })
})

describe("checkGiteaRunnerImage — repositório real", () => {
  it("o compose e o espelho da forja fecham a invariante (tier-1 de pé)", () => {
    const v = checkGiteaRunnerImage(
      readFileSync(join(ROOT, GITEA_COMPOSE), "utf8"),
      readFileSync(join(ROOT, GITEA_ENV_MIRROR), "utf8"),
    )
    expect(v, v.join("\n")).toEqual([])
  })
})

// ── Pré-requisito da subida: a imagem garantida ANTES do runner ──────────

/** Bring-up MÍNIMO no formato real (com o comentário que a ordem exige). */
function bringUp(
  ensureLine: string,
  runnerLine: string,
  mirrorLine?: string,
  doctorLine?: string,
): string {
  return [
    "#!/usr/bin/env bash",
    "# o `up -d runner` NAO pode vir antes da garantia da imagem",
    'TEMPLATE_FILE="${TEMPLATE_FILE:-$SCRIPT_DIR/env.gitea.example}"',
    'MIRROR_SCRIPT="${MIRROR_SCRIPT:-$REPO_DIR/scripts/check-env-mirror.mjs}"',
    DOCTOR_DEFAULT,
    mirrorLine ?? OK_MIRROR,
    ensureLine,
    doctorLine ?? OK_DOCTOR,
    '"${DOCKER_COMPOSE[@]}" up -d gitea caddy',
    runnerLine,
  ].join("\n")
}

const OK_MIRROR = 'node "$MIRROR_SCRIPT" --host "$ENV_FILE" --template "$TEMPLATE_FILE"'
const OK_ENSURE = 'node "$ENSURE_SCRIPT" --gitea-env "$ENV_FILE"'
const DOCTOR_DEFAULT = 'DOCTOR_SCRIPT="${DOCTOR_SCRIPT:-$REPO_DIR/scripts/forge-doctor.mjs}"'
// O doctor roda INTEIRO (sem `--no-proof`): quem corta o ciclo bring-up → doctor
// → prova é a dublagem do doctor dentro da prova (ver `checkDoctorCycleCut`).
const OK_DOCTOR = 'node "$DOCTOR_SCRIPT" --gitea-env "$ENV_FILE" "${DOCTOR_ARGS[@]}"'
const OK_RUNNER = '"${DOCKER_COMPOSE[@]}" up -d runner'
const OK_SETUP = 'echo "  bash $REPO_DIR/deploy/gitea-up.sh"'

describe("checkGiteaBringUp — a imagem é pré-requisito da subida", () => {
  it("garantia antes do runner + instalador apontando para o bring-up → zero violações", () => {
    expect(checkGiteaBringUp(bringUp(OK_ENSURE, OK_RUNNER), OK_SETUP)).toEqual([])
  })

  it("sem a conferência do espelho (só menção em comentário) → violação nomeando o script", () => {
    const v = checkGiteaBringUp(
      bringUp(OK_ENSURE, OK_RUNNER, "# conferimos o env com scripts/check-env-mirror.mjs"),
      OK_SETUP,
    )
    expect(v.length).toBe(1)
    expect(v[0]).toContain(ENV_MIRROR_SCRIPT)
  })

  it("conferência do espelho sem --host/--template → violação (a comparação mediria outro arquivo)", () => {
    const v = checkGiteaBringUp(bringUp(OK_ENSURE, OK_RUNNER, 'node "$MIRROR_SCRIPT"'), OK_SETUP)
    expect(v.length).toBe(1)
    expect(v[0]).toContain("--host")
    expect(v[0]).toContain("--template")
  })

  it("TEMPLATE_FILE default que NÃO é o template comitado → violação", () => {
    const content = bringUp(OK_ENSURE, OK_RUNNER).replace(
      'TEMPLATE_FILE="${TEMPLATE_FILE:-$SCRIPT_DIR/env.gitea.example}"',
      'TEMPLATE_FILE="${TEMPLATE_FILE:-$SCRIPT_DIR/outro.env}"',
    )
    const v = checkGiteaBringUp(content, OK_SETUP)
    expect(v.length).toBe(1)
    expect(v[0]).toContain("TEMPLATE_FILE")
  })

  it("a conferência do espelho DEPOIS da garantia da imagem → violação de ORDEM", () => {
    // O ensure resolve a imagem DO ENV: conferir o espelho depois garantiria a
    // imagem de um env que pode não ser o do repositório.
    const content = [
      "#!/usr/bin/env bash",
      'TEMPLATE_FILE="${TEMPLATE_FILE:-$SCRIPT_DIR/env.gitea.example}"',
      DOCTOR_DEFAULT,
      OK_ENSURE,
      OK_MIRROR,
      OK_DOCTOR,
      OK_RUNNER,
    ].join("\n")
    const v = checkGiteaBringUp(content, OK_SETUP)
    expect(v.length).toBe(1)
    expect(v[0]).toContain("DEPOIS da garantia")
  })

  // ── o doctor: a prontidão como pré-requisito, não como lembrete ──────────

  it("sem invocar o doctor (só menção em comentário) → violação nomeando o script", () => {
    const v = checkGiteaBringUp(
      bringUp(OK_ENSURE, OK_RUNNER, undefined, "# o doctor responde a prontidão"),
      OK_SETUP,
    )
    expect(v.length).toBe(1)
    expect(v[0]).toContain(FORGE_DOCTOR)
  })

  it("doctor chamado COM --no-proof → violação (o veredito fica parcial POR CONSTRUÇÃO)", () => {
    const v = checkGiteaBringUp(
      bringUp(
        OK_ENSURE,
        OK_RUNNER,
        undefined,
        'node "$DOCTOR_SCRIPT" --gitea-env "$ENV_FILE" --no-proof',
      ),
      OK_SETUP,
    )
    expect(v.length).toBe(1)
    expect(v[0]).toContain("--no-proof")
    // A mensagem aponta o REMÉDIO (a dublagem), e não só o defeito.
    expect(v[0]).toContain("dublagem do doctor na prova")
  })

  it('doctor sem --gitea-env "$ENV_FILE" → violação (ele leria outro env)', () => {
    const v = checkGiteaBringUp(
      bringUp(OK_ENSURE, OK_RUNNER, undefined, 'node "$DOCTOR_SCRIPT"'),
      OK_SETUP,
    )
    expect(v.length).toBe(1)
    expect(v[0]).toContain("--gitea-env")
  })

  it("default de DOCTOR_SCRIPT que NÃO é o doctor comitado → violação", () => {
    const content = bringUp(OK_ENSURE, OK_RUNNER).replace(
      DOCTOR_DEFAULT,
      'DOCTOR_SCRIPT="${DOCTOR_SCRIPT:-$REPO_DIR/scripts/meu-doctor.mjs}"',
    )
    const v = checkGiteaBringUp(content, OK_SETUP)
    expect(v.length).toBe(1)
    expect(v[0]).toContain("DOCTOR_SCRIPT")
  })

  it("doctor ANTES da garantia da imagem → violação de ORDEM", () => {
    const content = [
      "#!/usr/bin/env bash",
      'TEMPLATE_FILE="${TEMPLATE_FILE:-$SCRIPT_DIR/env.gitea.example}"',
      DOCTOR_DEFAULT,
      OK_MIRROR,
      OK_DOCTOR,
      OK_ENSURE,
      OK_RUNNER,
    ].join("\n")
    const v = checkGiteaBringUp(content, OK_SETUP)
    expect(v.length).toBe(1)
    expect(v[0]).toContain("ANTES da garantia da imagem")
  })

  it("doctor DEPOIS do 'up -d gitea' → violação (a stack subiria com BLOQUEADA)", () => {
    const content = [
      "#!/usr/bin/env bash",
      'TEMPLATE_FILE="${TEMPLATE_FILE:-$SCRIPT_DIR/env.gitea.example}"',
      DOCTOR_DEFAULT,
      OK_MIRROR,
      OK_ENSURE,
      '"${DOCKER_COMPOSE[@]}" up -d gitea caddy',
      OK_DOCTOR,
      OK_RUNNER,
    ].join("\n")
    const v = checkGiteaBringUp(content, OK_SETUP)
    expect(v.length).toBe(1)
    expect(v[0]).toContain("ANTES do veredito de prontidão")
  })

  it("o COMENTÁRIO que menciona a ordem não conta como comando (prosa não satisfaz guard)", () => {
    // O fixture tem a linha '# ... `up -d runner` ...' ANTES do ensure: se a
    // regex casasse comentário, a ordem apareceria invertida.
    expect(checkGiteaBringUp(bringUp(OK_ENSURE, OK_RUNNER), OK_SETUP)).toEqual([])
  })

  it("bring-up ausente → violação apontando o caminho", () => {
    const v = checkGiteaBringUp("", OK_SETUP)
    expect(v.length).toBe(1)
    expect(v[0]).toContain(GITEA_BRING_UP)
    expect(v[0]).toContain("ausente")
  })

  it("sem invocar o ensure (só menção em comentário) → violação", () => {
    const v = checkGiteaBringUp(
      bringUp("# rode scripts/ensure-runner-image.mjs antes", OK_RUNNER),
      OK_SETUP,
    )
    expect(v.length).toBe(1)
    expect(v[0]).toContain("ensure-runner-image")
  })

  it("'up -d runner' ANTES da garantia → violação de ORDEM", () => {
    // Conteúdo explícito: aqui o que está fora de ordem é o RUNNER x o ENSURE,
    // e o doctor fica no lugar certo (depois do ensure) para a violação ser uma
    // só e nomear exatamente esse contrato.
    const content = [
      "#!/usr/bin/env bash",
      'TEMPLATE_FILE="${TEMPLATE_FILE:-$SCRIPT_DIR/env.gitea.example}"',
      DOCTOR_DEFAULT,
      OK_MIRROR,
      OK_RUNNER,
      OK_ENSURE,
      OK_DOCTOR,
    ].join("\n")
    const v = checkGiteaBringUp(content, OK_SETUP)
    expect(v.length).toBe(1)
    expect(v[0]).toContain("ANTES da garantia")
  })

  it("bring-up que nem sobe o runner → violação", () => {
    const v = checkGiteaBringUp(
      bringUp(OK_ENSURE, '"${DOCKER_COMPOSE[@]}" up -d gitea caddy'),
      OK_SETUP,
    )
    expect(v.length).toBe(1)
    expect(v[0]).toContain("não sobe o runner")
  })

  it("instalador que não aponta para o bring-up → violação", () => {
    const v = checkGiteaBringUp(bringUp(OK_ENSURE, OK_RUNNER), 'echo "docker compose up -d runner"')
    expect(v.length).toBe(1)
    expect(v[0]).toContain(GITEA_SETUP)
    expect(v[0]).toContain("gitea-up.sh")
  })

  it("setupContent undefined → a checagem do instalador é pulada", () => {
    expect(checkGiteaBringUp(bringUp(OK_ENSURE, OK_RUNNER), undefined)).toEqual([])
  })
})

describe("checkGiteaBringUp — repositório real", () => {
  it("o bring-up real garante a imagem antes de subir o runner", () => {
    const v = checkGiteaBringUp(
      readFileSync(join(ROOT, GITEA_BRING_UP), "utf8"),
      readFileSync(join(ROOT, GITEA_SETUP), "utf8"),
    )
    expect(v, v.join("\n")).toEqual([])
  })
})

// ── Re-registro: trocar a label é quando a tag pode faltar ────────────────

/**
 * Bring-up mínimo na forma real. `rm` diz ONDE a remoção do runner acontece:
 * "none" = o script sobe o runner e nunca o remove (a forma anterior ao modo de
 * re-registro); "before"/"after" = a posição em relação ao `up -d runner`.
 */
function bringUpReReg(rm: "none" | "before" | "after"): string {
  const REMOVE = '"${DOCKER_COMPOSE[@]}" rm -sf runner'
  const UP = '"${DOCKER_COMPOSE[@]}" up -d runner'
  return [
    "#!/usr/bin/env bash",
    'node "$ENSURE_SCRIPT" --gitea-env "$ENV_FILE"',
    '"${DOCKER_COMPOSE[@]}" up -d gitea caddy',
    rm === "after" ? UP : "",
    rm === "none" ? UP : REMOVE,
    rm === "before" ? UP : "",
  ]
    .filter((l) => l !== "")
    .join("\n")
}

/** Runbook mínimo: o procedimento de re-registro num bloco cercado. */
function docWith(block: string, prose = ""): string {
  return `# Runbook\n\nA troca de label exige re-registrar.\n${prose}\n\`\`\`bash\n${block}\n\`\`\`\n`
}

const DOC_OK = docWith("ENV_FILE=/opt/gitea/.env bash $REPO/deploy/gitea-up.sh --re-register")
const BOTH_OK = bringUpReReg("before")

describe("checkReRegisterPath — o re-registro é um caminho garantido", () => {
  it("script com rm antes do up + runbook chamando --re-register → zero violações", () => {
    expect(checkReRegisterPath(BOTH_OK, DOC_OK)).toEqual([])
  })

  it("script que sobe o runner mas nunca o remove → violação (não existe caminho de re-registro)", () => {
    const v = checkReRegisterPath(bringUpReReg("none"), DOC_OK)
    expect(v.length).toBe(1)
    expect(v[0]).toContain("rm -sf runner")
    expect(v[0]).toContain(GITEA_BRING_UP)
  })

  it("script com 'rm -sf runner' DEPOIS do up → violação de ORDEM", () => {
    const v = checkReRegisterPath(bringUpReReg("after"), DOC_OK)
    expect(v.length).toBe(1)
    expect(v[0]).toContain("DEPOIS do 'up -d runner'")
  })

  it("runbook que não invoca --re-register → violação (o re-registro ficaria sem garantia)", () => {
    const v = checkReRegisterPath(BOTH_OK, docWith("bash $REPO/deploy/gitea-up.sh"))
    expect(v.length).toBe(1)
    expect(v[0]).toContain("--re-register")
    expect(v[0]).toContain(GITEA_DOC)
  })

  it("runbook que ensina a sequência à mão → DUAS violações (falta o caminho garantido e a sequência crua é ensinada)", () => {
    const handRolled = [
      "docker compose rm -sf runner",
      "docker volume rm gitea-runner-data",
      "node $REPO/scripts/ensure-runner-image.mjs --check   # so confere",
      "docker compose up -d runner",
    ].join("\n")
    const v = checkReRegisterPath(BOTH_OK, docWith(handRolled))
    expect(v.length).toBe(2)
    expect(v.some((x) => x.includes("--re-register"))).toBe(true)
    expect(v.some((x) => x.includes("à mão"))).toBe(true)
  })

  it("runbook que chama o script E TAMBÉM ensina o caminho cru ao lado → violação do caminho à mão", () => {
    const mixed = [
      "bash $REPO/deploy/gitea-up.sh --re-register   # caminho certo",
      "docker compose rm -sf runner",
      "docker compose up -d runner                   # pula a garantia",
    ].join("\n")
    const v = checkReRegisterPath(BOTH_OK, docWith(mixed, "O caminho antigo era:"))
    expect(v.length).toBe(1)
    expect(v[0]).toContain("à mão")
  })

  it("comentário no bloco cita o comando antigo → tolerado (prosa não é o que se copia)", () => {
    const commented = [
      "bash $REPO/deploy/gitea-up.sh --re-register",
      "# antes: docker compose rm -sf runner e depois docker compose up -d runner",
    ].join("\n")
    expect(checkReRegisterPath(BOTH_OK, docWith(commented))).toEqual([])
  })

  it("a sequência crua em PROSA (fora de cerco) é tolerada — só o copiável é proibido", () => {
    const prose =
      "O caminho antigo fazia `docker compose rm -sf runner` e depois `docker compose up -d runner`; nao use."
    expect(
      checkReRegisterPath(BOTH_OK, docWith("bash deploy/gitea-up.sh --re-register", prose)),
    ).toEqual([])
  })
})

describe("checkReRegisterPath — repositório real", () => {
  it("o bring-up e o runbook do repo fecham o re-registro garantido", () => {
    const v = checkReRegisterPath(
      readFileSync(join(ROOT, GITEA_BRING_UP), "utf8"),
      readFileSync(join(ROOT, GITEA_DOC), "utf8"),
    )
    expect(v, v.join("\n")).toEqual([])
  })

  it("o runbook real manda o operador pelo modo --re-register", () => {
    const doc = readFileSync(join(ROOT, GITEA_DOC), "utf8")
    expect(doc).toContain("gitea-up.sh --re-register")
  })
})

// ── o CORTE do ciclo bring-up → doctor → prova ────────────────────────────
//
// O bring-up roda o doctor INTEIRO (regra acima), e quem faz a cadeia
// `bring-up → doctor → prova → bring-up` terminar é a DUBLAGEM que a prova faz
// do doctor. Aqui o guard prende AS DUAS metades dela — o dublê construído e o
// `DOCTOR_SCRIPT` passado ao filho — porque apagar qualquer uma não dá erro:
// dá uma forca de processos.

describe("checkDoctorCycleCut — a dublagem que corta o ciclo", () => {
  const OK_PROOF = [
    'const doctorStub = join(binDir, "forge-doctor-stub.mjs")',
    "env: {",
    "  ...process.env,",
    "  DOCTOR_SCRIPT: doctorStub,",
    "},",
  ].join("\n")

  it("dublê construído + DOCTOR_SCRIPT no env do filho → zero violações", () => {
    expect(checkDoctorCycleCut(OK_PROOF)).toEqual([])
  })

  it("prova ausente → violação (sem ela não há o que dublar)", () => {
    const v = checkDoctorCycleCut("")
    expect(v.length).toBe(1)
    expect(v[0]).toContain(PROOF_SCRIPT)
  })

  it("prova que NÃO constrói o dublê → violação (o filho chamaria o doctor real)", () => {
    // A outra metade está de pé (DOCTOR_SCRIPT é passado); o que falta é o DUBLÊ.
    const v = checkDoctorCycleCut("  DOCTOR_SCRIPT: algumDoctor,")
    expect(v.length).toBe(1)
    expect(v[0]).toContain("forge-doctor-stub.mjs")
  })

  it("dublê construído mas NÃO passado ao filho → violação (o corte não existe)", () => {
    // É o modo de falha mais traiçoeiro: o dublê existe, a prova parece certa, e
    // o bring-up dublado cai no default (o doctor do repositório).
    const v = checkDoctorCycleCut('const doctorStub = "forge-doctor-stub.mjs"')
    expect(v.length).toBe(1)
    expect(v[0]).toContain("DOCTOR_SCRIPT")
  })

  it("DOCTOR_SCRIPT vazio no env do filho → violação (não aponta dublê nenhum)", () => {
    const v = checkDoctorCycleCut(
      'const doctorStub = "forge-doctor-stub.mjs"\n  DOCTOR_SCRIPT: "",',
    )
    expect(v.some((x) => x.includes("DOCTOR_SCRIPT"))).toBe(true)
  })
})

describe("checkDoctorCycleCut — repositório real", () => {
  it("a prova do repo dubla o doctor que ela passa ao bring-up", () => {
    const v = checkDoctorCycleCut(readFileSync(join(ROOT, PROOF_SCRIPT), "utf8"))
    expect(v, v.join("\n")).toEqual([])
  })

  it("e o bring-up do repo roda o doctor INTEIRO (o --no-proof não voltou)", () => {
    const bringUpText = readFileSync(join(ROOT, GITEA_BRING_UP), "utf8")
    const doctorLine = bringUpText
      .split("\n")
      .find((l) => l.trimStart().startsWith("node") && l.includes("DOCTOR_SCRIPT"))
    expect(doctorLine, "a linha de invocação do doctor não foi encontrada").toBeTruthy()
    expect(doctorLine).not.toContain("--no-proof")
    // E o guard concorda: o bring-up real do repo passa em zero violações.
    expect(checkGiteaBringUp(bringUpText, undefined)).toEqual([])
  })
})
