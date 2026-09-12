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
  GITEA_BRING_UP,
  GITEA_COMPOSE,
  GITEA_DOC,
  GITEA_ENV_MIRROR,
  GITEA_SETUP,
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
function bringUp(ensureLine: string, runnerLine: string): string {
  return [
    "#!/usr/bin/env bash",
    "# o `up -d runner` NAO pode vir antes da garantia da imagem",
    ensureLine,
    '"${DOCKER_COMPOSE[@]}" up -d gitea caddy',
    runnerLine,
  ].join("\n")
}

const OK_ENSURE = 'node "$ENSURE_SCRIPT" --gitea-env "$ENV_FILE"'
const OK_RUNNER = '"${DOCKER_COMPOSE[@]}" up -d runner'
const OK_SETUP = 'echo "  bash $REPO_DIR/deploy/gitea-up.sh"'

describe("checkGiteaBringUp — a imagem é pré-requisito da subida", () => {
  it("garantia antes do runner + instalador apontando para o bring-up → zero violações", () => {
    expect(checkGiteaBringUp(bringUp(OK_ENSURE, OK_RUNNER), OK_SETUP)).toEqual([])
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
    const v = checkGiteaBringUp(bringUp(OK_RUNNER, OK_ENSURE), OK_SETUP)
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
