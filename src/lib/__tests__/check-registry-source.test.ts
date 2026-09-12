/**
 * check-registry-source.test.ts
 *
 * Testes unitários das funções PURAS de scripts/check-registry-source.mjs, mais
 * uma asserção sobre o REPOSITÓRIO REAL — a que importa de fato: enquanto
 * alguém não reintroduzir um `ghcr.io` solto, o gate `check:registry-source`
 * não pega a regressão.
 *
 * POR QUE existe o guard: as imagens eram referenciadas com o host hardcoded
 * (~85 ocorrências de `ghcr.io`), acoplando o projeto ao GHCR — registry
 * proprietário, com cota de armazenamento/egress no plano free. A fonte única
 * agora é IMAGE_REGISTRY. Este teste trava as DUAS direções:
 *   - a forma correta (variável, incluindo default) é aceita;
 *   - a forma hardcoded é rejeitada, com a mensagem que aponta o conserto.
 *
 * Execução focada:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/check-registry-source.test.ts
 */

import { spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterAll, describe, expect, it } from "vitest"

import {
  COMPOSE_SENTINELS,
  DEPLOY_DIR,
  OUT_OF_SCOPE_ALLOWLIST,
  THIRD_PARTY_ALLOWLIST,
  analyzeDeclaredRender,
  analyzeSentinelRender,
  analyzeUnsetVersionRender,
  checkActrc,
  checkComposeImageLine,
  checkComposeInterpolation,
  checkLiteralImageTag,
  checkOutOfScopeTargets,
  checkRegistryLine,
  collectFiles,
  composeAvailable,
  controlledEnv,
  findViolations,
  imageRefsIn,
  isCommentLine,
  isComposeFile,
  isRegistryVariableForm,
  labelImageRefs,
  matchesScanTarget,
  parseComposeRender,
  stripInlineComment,
  sweepOutOfScope,
  unsetVariables,
  withoutGitIgnored,
} from "../../../scripts/check-registry-source.mjs"

/**
 * Linha REAL do compose da forja (deploy/docker-compose.gitea.yml): a imagem do
 * runner é montada da variável e a TAG também. `buildRunnerLabel(tag)` devolve
 * a mesma linha com a tag que o teste quiser — é o formato do arquivo, não uma
 * aproximação.
 */
function buildRunnerLabel(tag: string): string {
  return (
    "      - GITEA_RUNNER_LABELS=ubuntu-latest:docker://${IMAGE_REGISTRY:-ghcr.io}/${IMAGE_NAMESPACE:-severinno}/ubuntu-bun:" +
    tag +
    ",ubuntu-22.04:docker://${IMAGE_REGISTRY:-ghcr.io}/${IMAGE_NAMESPACE:-severinno}/ubuntu-bun:" +
    tag
  )
}

/** Basename do compose da forja (a mesma cena que o guard resolve via GITEA_COMPOSE). */
const COMPOSE_BASENAME = "docker-compose.gitea.yml"

/**
 * Compose mínimo no formato REAL: o serviço `runner` existe (senão o
 * `docker compose config` recusa renderizar) e a imagem vem das variáveis.
 */
const COMPOSE_FIXTURE_CORRECT =
  "services:\n" +
  "  runner:\n" +
  "    image: gitea/act_runner:latest\n" +
  "    environment:\n" +
  "      - GITEA_RUNNER_REGISTRATION_TOKEN=${RUNNER_TOKEN}\n" +
  "      - GITEA_RUNNER_LABELS=ubuntu-latest:docker://${IMAGE_REGISTRY:-ghcr.io}/${IMAGE_NAMESPACE:-severinno}/ubuntu-bun:${BUN_VERSION}\n"

/** Raiz do repositório real (o `ROOT` local de outro describe não vale aqui). */
const REPO_ROOT = process.cwd()

/**
 * O plugin `compose` está disponível NESTA máquina? Os testes do passo dinâmico
 * são pulados sem ele — é o mesmo comportamento do gate (INDETERMINADO, nunca
 * "passou"). Ver o header do guard.
 */
const HAS_COMPOSE =
  spawnSync("docker", ["compose", "version"], { encoding: "utf8", timeout: 10_000 }).status === 0

describe("isCommentLine", () => {
  it("reconhece comentário de YAML (linha inteira, com indentação)", () => {
    expect(isCommentLine("# ghcr.io/severinno/x")).toBe(true)
    expect(isCommentLine("      # ghcr.io/severinno/x")).toBe(true)
  })

  it("não confunde código com comentário", () => {
    expect(isCommentLine("    image: ghcr.io/severinno/x")).toBe(false)
  })
})

describe("stripInlineComment", () => {
  it("remove comentário inline e preserva o código", () => {
    expect(stripInlineComment("  packages: read # pull de ghcr.io/x/y")).toBe("  packages: read")
  })

  it("não corta `#` que não inicia comentário (sem espaço antes)", () => {
    expect(stripInlineComment("  key: a#b")).toBe("  key: a#b")
  })

  it("cobre a linha que é só comentário (vira vazia)", () => {
    expect(stripInlineComment("# ghcr.io/x")).toBe("")
  })
})

describe("isRegistryVariableForm", () => {
  it("aceita as duas formas canônicas (workflow e shell)", () => {
    expect(isRegistryVariableForm("REGISTRY: ${{ vars.IMAGE_REGISTRY || 'ghcr.io' }}")).toBe(true)
    expect(isRegistryVariableForm("image: ${IMAGE_REGISTRY:-ghcr.io}/x/y:tag")).toBe(true)
  })

  it("rejeita `ghcr.io` sem a variável", () => {
    expect(isRegistryVariableForm("image: ghcr.io/x/y:tag")).toBe(false)
  })
})

describe("checkRegistryLine", () => {
  it("aprova o default embutido da variável (não é hardcode)", () => {
    expect(
      checkRegistryLine("w.yml", 1, "REGISTRY: ${{ vars.IMAGE_REGISTRY || 'ghcr.io' }}"),
    ).toBeNull()
    expect(checkRegistryLine("c.yml", 2, "image: ${IMAGE_REGISTRY:-ghcr.io}/x/y:tag")).toBeNull()
  })

  it("aprova comentário (incluindo inline) — prosa não é configuração", () => {
    expect(checkRegistryLine("w.yml", 1, "# default: ghcr.io")).toBeNull()
    expect(
      checkRegistryLine("w.yml", 2, "  packages: read # pull de ghcr.io/severinno/ubuntu-bun"),
    ).toBeNull()
  })

  it("reprova a regressão que reacopla ao GHCR", () => {
    const v = checkRegistryLine(
      "docker-compose.prod.yml",
      7,
      "    image: ghcr.io/severinno/severinno:latest",
    )
    expect(v).toContain("docker-compose.prod.yml:7")
    expect(v).toContain("IMAGE_REGISTRY")
    // A mensagem precisa ENSINAR o conserto — guard sem instrução vira ruído.
    expect(v).toContain("${IMAGE_REGISTRY:-ghcr.io}")
  })

  it("aprova imagem de terceiros explicitamente allowlistada", () => {
    const line = `    image: ${THIRD_PARTY_ALLOWLIST[0]}:latest`
    expect(checkRegistryLine("docker-compose.dev.yml", 1, line)).toBeNull()
  })

  it("ignora linhas sem registry", () => {
    expect(checkRegistryLine("w.yml", 1, "    runs-on: self-hosted")).toBeNull()
  })
})

describe("isComposeFile — o compose da forja vive em deploy/", () => {
  it("reconhece os composes do repo (inclusive o da forja, cujo nome não começa com docker-compose)", () => {
    for (const file of [
      "docker-compose.yml",
      "docker-compose.prod.yml",
      "docker-compose.hostinger.yml",
      "deploy/docker-compose.gitea.yml",
      "deploy/woodpecker-compose.yml",
      "deploy/compose.yml",
    ]) {
      expect(isComposeFile(file), file).toBe(true)
    }
  })

  it("um workflow chamado deploy.yml NÃO é compose", () => {
    expect(isComposeFile(".github/workflows/deploy.yml")).toBe(false)
    expect(isComposeFile(".gitea/workflows/ci.yml")).toBe(false)
  })
})

describe("checkLiteralImageTag (invariante 6 — deploy/ sem tag literal)", () => {
  it("aprova a tag vinda da variável (a forma real do compose da forja)", () => {
    expect(
      checkLiteralImageTag(
        "deploy/docker-compose.gitea.yml",
        1,
        buildRunnerLabel("${BUN_VERSION}"),
      ),
    ).toBeNull()
  })

  it("o DEFAULT embutido da variável não é lido como tag (`${IMAGE_REGISTRY:-ghcr.io}` tem `:` dentro)", () => {
    // Sem remover as variáveis antes de procurar `:tag`, o `:-ghcr.io` e o
    // `:-severinno` pareceriam tags — e o guard acusaria o próprio padrão
    // canônico que ele exige.
    expect(
      checkLiteralImageTag(
        "deploy/docker-compose.gitea.yml",
        1,
        "    image: ${IMAGE_REGISTRY:-ghcr.io}/${IMAGE_NAMESPACE:-severinno}/ubuntu-bun:${BUN_VERSION}",
      ),
    ).toBeNull()
  })

  it("reprova a tag LITERAL na imagem do runner (a regressão que reacopla a versão)", () => {
    const v = checkLiteralImageTag("deploy/docker-compose.gitea.yml", 3, buildRunnerLabel("1.3.14"))
    expect(v).toContain("deploy/docker-compose.gitea.yml:3")
    expect(v).toContain("TAG LITERAL")
    expect(v).toContain("ubuntu-bun:1.3.14")
    // A mensagem ensina o conserto (guard sem instrução vira ruído).
    expect(v).toContain("${BUN_VERSION}")
  })

  it("reprova `:latest` também — o problema é a tag não vir da variável, não o valor dela", () => {
    expect(
      checkLiteralImageTag(
        "deploy/docker-compose.gitea.yml",
        1,
        "    image: ${IMAGE_REGISTRY:-ghcr.io}/${IMAGE_NAMESPACE:-severinno}/severinno:latest",
      ),
    ).toContain("TAG LITERAL")
  })

  it("não opina sobre imagem de terceiros (sem a variável do registry na linha)", () => {
    expect(
      checkLiteralImageTag("deploy/docker-compose.gitea.yml", 1, "    image: caddy:2-alpine"),
    ).toBeNull()
    expect(
      checkLiteralImageTag(
        "deploy/docker-compose.gitea.yml",
        2,
        "    image: gitea/act_runner:latest",
      ),
    ).toBeNull()
  })

  it("prosa não é configuração (comentário de linha e inline)", () => {
    expect(
      checkLiteralImageTag(
        "deploy/docker-compose.gitea.yml",
        1,
        "# troque ubuntu-bun:1.3.14 por ${BUN_VERSION}",
      ),
    ).toBeNull()
    expect(
      checkLiteralImageTag(
        "deploy/docker-compose.gitea.yml",
        2,
        "    runner: x # antes era ubuntu-bun:1.3.14",
      ),
    ).toBeNull()
  })

  it("respeita a allowlist de terceiros (mesma porta de saída do resto do guard)", () => {
    // Linha SINTÉTICA com os dois: a variável do registry (imagem nossa, que
    // seria violação pelo `/x/bun:latest`) e uma imagem de terceiros já
    // declarada fora de escopo. A allowlist vence.
    const line =
      "      - MIRROR=${IMAGE_REGISTRY:-ghcr.io}/x/bun:latest,extra=" +
      THIRD_PARTY_ALLOWLIST[0] +
      ":latest"
    expect(checkLiteralImageTag("deploy/docker-compose.gitea.yml", 1, line)).toBeNull()
  })
})

describe("checkComposeImageLine (invariante do compose)", () => {
  it("reprova imagem NOSSA sem a variável (host trocado por outro literal)", () => {
    const v = checkComposeImageLine(
      "docker-compose.prod.yml",
      3,
      "    image: quay.io/severinno/severinno:latest",
    )
    expect(v).toContain("IMAGE_REGISTRY")
  })

  it("aprova imagem nossa via IMAGE_REGISTRY", () => {
    expect(
      checkComposeImageLine(
        "docker-compose.prod.yml",
        3,
        "    image: ${IMAGE_REGISTRY:-ghcr.io}/${IMAGE_NAMESPACE:-severinno}/severinno:latest",
      ),
    ).toBeNull()
  })

  it("não opina sobre imagem de terceiros", () => {
    expect(
      checkComposeImageLine(
        "docker-compose.prod.yml",
        4,
        "    image: postgis/postgis:16-3.4-alpine",
      ),
    ).toBeNull()
  })
})

describe("checkActrc (espelho local do act)", () => {
  it("aprova com a linha --var IMAGE_REGISTRY", () => {
    expect(checkActrc("--var BUN_VERSION=1.3.14\n--var IMAGE_REGISTRY=ghcr.io\n")).toBeNull()
  })

  it("reprova a ausência (o act resolve a variável vazia sem --var)", () => {
    const v = checkActrc("--var BUN_VERSION=1.3.14\n")
    expect(v).toContain("IMAGE_REGISTRY")
  })

  it("não se deixa enganar por linha COMENTADA", () => {
    expect(checkActrc("# --var IMAGE_REGISTRY=ghcr.io\n")).not.toBeNull()
  })
})

describe("repositório real", () => {
  const ROOT = process.cwd()

  it("não fixa o registry fora da fonte única", () => {
    expect(findViolations(ROOT)).toEqual([])
  })

  it("varre os sites de resolução (compose, workflows, woodpecker) e o deploy da forja", () => {
    const files = collectFiles(ROOT)
    for (const expected of [
      "docker-compose.prod.yml",
      "docker-compose.hostinger.yml",
      ".github/workflows/deploy.yml",
      ".github/workflows/release-deploy.yml",
      ".woodpecker.yml",
      // O compose da FORJA entra no mesmo gate: é ele que decide qual imagem
      // roda TODOS os jobs (a tag tem de vir da variável — invariante 6).
      `${DEPLOY_DIR}/docker-compose.gitea.yml`,
    ]) {
      expect(files).toContain(expected)
    }
  })

  it("a linha da imagem do runner no compose REAL está sob a invariante 6 (tag da variável)", () => {
    const lines = readFileSync(join(ROOT, DEPLOY_DIR, "docker-compose.gitea.yml"), "utf8").split(
      /\r?\n/,
    )
    const labelLine = lines.findIndex((l) => l.includes("GITEA_RUNNER_LABELS"))
    expect(labelLine, "a label do runner existe no compose da forja").toBeGreaterThan(-1)
    // Nenhuma violação = a frase seguinte é o contrato: a tag vem da variável.
    expect(
      checkLiteralImageTag(
        `${DEPLOY_DIR}/docker-compose.gitea.yml`,
        labelLine + 1,
        lines[labelLine],
      ),
    ).toBeNull()
    expect(lines[labelLine]).toContain("ubuntu-bun:")
    expect(lines.join("\n")).toContain("BUN_VERSION")
  })

  it("varre os diretórios de ACTIONS das duas forjas (mesmo que hoje estejam vazios)", () => {
    // O setup do Bun saiu do composite para um `run:`, então .github/actions
    // pode estar vazio — a COBERTURA da varredura é o contrato (um action
    // novo que fixe o registry não pode escapar por estar num diretório que
    // o guard não lê).
    const dir = mkdtempSync(join(tmpdir(), "registry-source-actions-"))
    try {
      for (const rel of [
        ".github/actions/setup-bun/action.yml",
        ".gitea/actions/setup-bun/action.yml",
      ]) {
        const full = join(dir, rel)
        mkdirSync(join(full, ".."), { recursive: true })
        writeFileSync(full, "runs:\n  using: composite\n", "utf8")
      }
      const files = collectFiles(dir)
      expect(files).toContain(".github/actions/setup-bun/action.yml")
      expect(files).toContain(".gitea/actions/setup-bun/action.yml")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("os workflows de deploy leem o registry da variável, não de um literal", () => {
    const files = collectFiles(ROOT)
    // Se o arquivo for renomeado, o guard precisa continuar cobrindo o novo.
    expect(files.some((f) => f.startsWith(".gitea/workflows/"))).toBe(true)
  })
})

/**
 * Contrato de CLI: o teste unitário cobre as regras, mas não prova que o
 * script FALHA de verdade — um `process.exit(0)` no caminho errado deixaria o
 * gate verde para sempre. Aqui a árvore é sintética (cwd próprio), então o
 * repositório real nunca é tocado.
 *
 * As árvores sintéticas passam `--no-compose-render`: elas testam a varredura
 * ESTÁTICA e não têm (nem precisam de) docker. O passo DINÂMICO tem os próprios
 * testes, mais abaixo, sobre uma árvore com o formato REAL do compose.
 */
describe("CLI (exit code)", () => {
  const SCRIPT = join(process.cwd(), "scripts", "check-registry-source.mjs")

  function runIn(tree: Record<string, string>, args: string[] = ["--no-compose-render"]) {
    const dir = mkdtempSync(join(tmpdir(), "registry-source-"))
    try {
      for (const [rel, content] of Object.entries(tree)) {
        const full = join(dir, rel)
        mkdirSync(join(full, ".."), { recursive: true })
        writeFileSync(full, content)
      }
      return spawnSync(process.execPath, [SCRIPT, ...args], { cwd: dir, encoding: "utf8" })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  it("sai 1 quando o COMPOSE DA FORJA ganha tag literal de imagem (deploy/ não pode voltar)", () => {
    const r = runIn({
      [`${DEPLOY_DIR}/docker-compose.gitea.yml`]:
        "services:\n  runner:\n    environment:\n" +
        "      - GITEA_RUNNER_LABELS=ubuntu-latest:docker://${IMAGE_REGISTRY:-ghcr.io}/${IMAGE_NAMESPACE:-severinno}/ubuntu-bun:1.3.14\n",
      ".actrc": "--var IMAGE_REGISTRY=ghcr.io\n",
    })
    expect(r.status).toBe(1)
    expect(r.stderr).toContain(`${DEPLOY_DIR}/docker-compose.gitea.yml:4`)
    expect(r.stderr).toContain("TAG LITERAL")
  })

  it("sai 0 com a tag da variável no compose da forja", () => {
    const r = runIn({
      [`${DEPLOY_DIR}/docker-compose.gitea.yml`]:
        "services:\n  runner:\n    environment:\n" +
        "      - GITEA_RUNNER_LABELS=ubuntu-latest:docker://${IMAGE_REGISTRY:-ghcr.io}/${IMAGE_NAMESPACE:-severinno}/ubuntu-bun:${BUN_VERSION}\n",
      ".actrc": "--var IMAGE_REGISTRY=ghcr.io\n",
    })
    expect(r.status).toBe(0)
  })

  it("sai 1 quando o compose volta a fixar o registry (e aponta arquivo:linha)", () => {
    const r = runIn({
      "docker-compose.prod.yml":
        "services:\n  app:\n    image: ghcr.io/severinno/severinno:latest\n",
      ".actrc": "--var IMAGE_REGISTRY=ghcr.io\n",
    })
    expect(r.status).toBe(1)
    expect(r.stderr).toContain("docker-compose.prod.yml:3")
  })

  it("sai 1 quando o .actrc perde o espelho da variável", () => {
    const r = runIn({
      "docker-compose.prod.yml":
        "services:\n  app:\n    image: ${IMAGE_REGISTRY:-ghcr.io}/${IMAGE_NAMESPACE:-severinno}/severinno:latest\n",
      ".actrc": "--var BUN_VERSION=1.3.14\n",
    })
    expect(r.status).toBe(1)
    expect(r.stderr).toContain("IMAGE_REGISTRY")
  })

  it("sai 0 quando tudo vem da fonte única", () => {
    const r = runIn({
      "docker-compose.prod.yml":
        "services:\n  app:\n    image: ${IMAGE_REGISTRY:-ghcr.io}/${IMAGE_NAMESPACE:-severinno}/severinno:latest\n",
      ".actrc": "--var IMAGE_REGISTRY=ghcr.io\n",
    })
    expect(r.status).toBe(0)
  })

  it("sai 0 numa árvore vazia (ausência de alvo não é violação)", () => {
    const r = runIn({})
    expect(r.status).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// INVARIANTE 8 — alvo FORA do escopo exige DECISÃO ESCRITA
// ═══════════════════════════════════════════════════════════════════════════

/** Árvores temporárias criadas pelos testes de escopo (limpeza no afterAll). */
const scopeTmpDirs: string[] = []

afterAll(() => {
  for (const dir of scopeTmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** Árvore temporária com arquivos arbitrários (os caminhos precisam existir). */
function treeOf(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "registry-source-scope-"))
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel)
    mkdirSync(join(full, ".."), { recursive: true })
    writeFileSync(full, content, "utf8")
  }
  scopeTmpDirs.push(dir)
  return dir
}

describe("imageRefsIn — o que é uma IMAGEM nossa (e o que não é)", () => {
  it("reconhece namespace nosso com tag/digest em qualquer host", () => {
    expect(imageRefsIn("FROM ghcr.io/severinno/ubuntu-bun:1.3.14")).toContain(
      "/severinno/ubuntu-bun:1.3.14",
    )
    expect(imageRefsIn("image: git.severinno.cloud/severinno/app:latest")).toContain(
      "/severinno/app:latest",
    )
    expect(imageRefsIn("docker pull ${IMAGE_NAMESPACE:-severinno}/x:y")).toEqual([])
  })

  it("NÃO confunde caminho de arquivo, URL de repositório ou asserção de UI", () => {
    // Sem a tag, `/severinno/` aparece em caminho, URL e teste de UI — um guard
    // que reclamasse disso seria desligado pela equipe.
    expect(imageRefsIn("/home/severinno/severinno/scripts/backup-cron.sh")).toEqual([])
    expect(imageRefsIn("https://github.com/severinno/severinno/settings")).toEqual([])
    expect(imageRefsIn('expect(page.locator("footer")).toContainText(/severinno/i)')).toEqual([])
  })
})

describe("matchesScanTarget — o escopo declarado", () => {
  const root = treeOf({
    "docker-compose.prod.yml": "x",
    "deploy/docker-compose.gitea.yml": "x",
    "deploy/nota.txt": "x",
    ".gitea/workflows/ci.yml": "x",
    ".gitea/actions/setup/action.yml": "x",
    ".woodpecker.yml": "x",
    "scripts/check-x.mjs": "x",
    "ci-tools/Dockerfile": "x",
  })

  it("cobre compose da raiz, deploy/*.yml, workflows das duas forjas, actions locais e .woodpecker.yml", () => {
    expect(matchesScanTarget("docker-compose.prod.yml", root)).toBe(true)
    expect(matchesScanTarget("deploy/docker-compose.gitea.yml", root)).toBe(true)
    expect(matchesScanTarget(".gitea/workflows/ci.yml", root)).toBe(true)
    expect(matchesScanTarget(".gitea/actions/setup/action.yml", root)).toBe(true)
    expect(matchesScanTarget(".woodpecker.yml", root)).toBe(true)
  })

  it("deixa FORA o que o escopo declara fora (scripts, outros diretórios, não-YAML em deploy)", () => {
    expect(matchesScanTarget("scripts/check-x.mjs", root)).toBe(false)
    expect(matchesScanTarget("ci-tools/Dockerfile", root)).toBe(false)
    expect(matchesScanTarget("deploy/nota.txt", root)).toBe(false)
  })
})

describe("checkOutOfScopeTargets — nenhum alvo novo fica invisível", () => {
  const IMAGE = "FROM ghcr.io/severinno/ubuntu-bun:1.3.14\n"

  it("arquivo novo num diretório não varrido → VIOLAÇÃO (o buraco que a invariante fecha)", () => {
    const root = treeOf({ "ci-tools/Dockerfile.build": IMAGE })
    const v = checkOutOfScopeTargets(root, { allowlist: [] })
    expect(v.length).toBe(1)
    expect(v[0]).toContain("ci-tools/Dockerfile.build")
    expect(v[0]).toContain("sem decisao escrita")
    expect(v[0]).toContain("/severinno/ubuntu-bun:1.3.14")
  })

  it("com a decisão escrita, passa — e a decisão precisa ter MOTIVO no lugar", () => {
    const root = treeOf({ "ci-tools/Dockerfile.build": IMAGE })
    expect(
      checkOutOfScopeTargets(root, {
        allowlist: [{ path: "ci-tools/Dockerfile.build", reason: "build da imagem de teste" }],
      }),
    ).toEqual([])
  })

  it("decisão VELHA (o arquivo existe e deixou de referenciar a imagem) → violação", () => {
    const root = treeOf({ "ci-tools/Dockerfile.build": "FROM alpine:3.20\n" })
    const v = checkOutOfScopeTargets(root, {
      allowlist: [{ path: "ci-tools/Dockerfile.build", reason: "era um alvo" }],
    })
    expect(v.length).toBe(1)
    expect(v[0]).toContain("decisao velha")
  })

  it("decisão de um arquivo AUSENTE na raiz é ignorada (a allowlist descreve o repo, não a árvore sintética)", () => {
    // É o que permite `findViolations(root)` rodar em checkout parcial/temp tree
    // sem acusar as decisões do repositório como velhas.
    const root = treeOf({ "ci-tools/Dockerfile.build": IMAGE })
    const v = checkOutOfScopeTargets(root, {
      allowlist: [{ path: "scripts/check-registry-source.mjs", reason: "x".repeat(50) }],
    })
    expect(v.length).toBe(1)
    expect(v[0]).toContain("ci-tools/Dockerfile.build")
  })

  it("prosa e fixture de teste são excluídos POR REGRA (não geram entrada a cada teste novo)", () => {
    const root = treeOf({
      "docs/imagens.md": "use `ghcr.io/severinno/ubuntu-bun:1.3.14`\n",
      "src/lib/__tests__/x.test.ts": `expect(ref).toBe("ghcr.io/severinno/ubuntu-bun:1.3.14")\n`,
      "e2e/x.spec.ts": "const R = 'ghcr.io/severinno/app:1.0.0'\n",
    })
    expect(checkOutOfScopeTargets(root, { allowlist: [] })).toEqual([])
  })

  it("arquivo EM escopo não entra na conta (quem cuida dele são as invariantes 1-6)", () => {
    const root = treeOf({
      "docker-compose.all.yml": "image: ${IMAGE_REGISTRY:-ghcr.io}/severinno/app:latest\n",
    })
    expect(checkOutOfScopeTargets(root, { allowlist: [] })).toEqual([])
  })

  it("arquivo gitignorado sai da conta (o .env do host é de quem roda, não do repo)", () => {
    // `deploy/.env.gitea` é gitignored por contrato (o arquivo do VPS nunca é
    // versionado): exigir uma entrada de allowlist para ele seria um falso
    // positivo que só aparece na máquina do dev.
    expect(
      withoutGitIgnored(["ci-tools/Dockerfile.build", "deploy/.env.gitea"], REPO_ROOT),
    ).toEqual(["ci-tools/Dockerfile.build"])
    expect(withoutGitIgnored([], REPO_ROOT)).toEqual([])
  })

  it("o filtro é FAIL-OPEN fora de um repo git (árvore sintética não perde alvo)", () => {
    const root = treeOf({ "ci-tools/Dockerfile.build": IMAGE })
    expect(withoutGitIgnored(["ci-tools/Dockerfile.build"], root)).toEqual([
      "ci-tools/Dockerfile.build",
    ])
  })

  it("no REPO REAL: zero violação e a allowlist cobre EXATAMENTE o que a varredura acha", () => {
    // O invariante que fecha o buraco: se algum arquivo fora do escopo passasse a
    // referenciar imagem nossa, ele aparece em `found` sem decisão → violação. E
    // o contrário também é cobrado (entrada ociosa).
    const { found, undecided, stale } = sweepOutOfScope(REPO_ROOT)
    expect([...undecided], "alvo fora do escopo sem decisão escrita").toEqual([])
    expect(stale, "decisão escrita que virou ociosa").toEqual([])
    expect([...found.keys()].sort()).toEqual(OUT_OF_SCOPE_ALLOWLIST.map((e) => e.path).sort())
    for (const entry of OUT_OF_SCOPE_ALLOWLIST) {
      expect(entry.reason.length, `motivo escrito para ${entry.path}`).toBeGreaterThan(40)
    }
    expect(checkOutOfScopeTargets(REPO_ROOT)).toEqual([])
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// INVARIANTE 7 — a INTERPOLAÇÃO do compose da forja (`docker compose config`)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Log REAL do docker: o compose ESCAPA as aspas internas da mensagem
 * (`msg="The \"X\" variable is not set..."`). A primeira versão do detector
 * procurava aspas literais e por isso NUNCA acusava variável vazia — o defeito
 * fica preso por este fixture.
 */
function dockerLog(name: string): string {
  return `time="2026-01-01T00:00:00-03:00" level=warning msg="The \\"${name}\\" variable is not set. Defaulting to a blank string."\n`
}

/** Render mínimo do serviço `runner`, no formato de `config --format json`. */
function rendered(refs: string[], token: string | null = "TOKEN"): object {
  return {
    services: {
      runner: {
        environment: {
          GITEA_RUNNER_LABELS: refs.map((r, i) => `ubuntu-latest-${i}:docker://${r}`).join(","),
          ...(token === null ? {} : { GITEA_RUNNER_REGISTRATION_TOKEN: token }),
        },
      },
    },
  }
}

describe("unsetVariables — 'alguma variável ficou vazia' sem depender do nome", () => {
  it("lê o log ESCAPADO do compose (o defeito real desta implementação)", () => {
    expect(unsetVariables(dockerLog("BUN_VERSIO"))).toEqual(["BUN_VERSIO"])
  })

  it("lê também a forma sem escape (quando o docker não escapa)", () => {
    expect(unsetVariables('level=warning msg="The "BUN_VERSION" variable is not set."')).toEqual([
      "BUN_VERSION",
    ])
  })

  it("não inventa nome de variável a partir de prosa do log", () => {
    expect(unsetVariables('msg="The following services are not set"')).toEqual([])
  })
})

describe("parseComposeRender", () => {
  it("aceita o JSON do render", () => {
    expect(parseComposeRender('{"services":{}}')).toEqual({ services: {} })
  })

  it("JSON inválido devolve null (exit 0 com saída estranha NÃO vira 'passou')", () => {
    expect(parseComposeRender("não é json")).toBeNull()
    expect(parseComposeRender("")).toBeNull()
  })
})

describe("labelImageRefs", () => {
  it("extrai as imagens do label, na ordem", () => {
    expect(labelImageRefs("ubuntu-latest:docker://a/b:1,ubuntu-22.04:docker://a/b:1")).toEqual([
      "a/b:1",
      "a/b:1",
    ])
  })

  it("label ausente devolve lista vazia (que a análise trata como violação própria)", () => {
    expect(labelImageRefs(undefined)).toEqual([])
    expect(labelImageRefs("")).toEqual([])
  })
})

describe("analyzeDeclaredRender — o env da forja define tudo que o compose pede", () => {
  const args = {
    envLabel: "deploy/env.gitea.example",
    declaredVersion: "1.3.14",
    stderr: "",
  }

  it("tag = versão declarada + token presente → nenhuma violação", () => {
    expect(
      analyzeDeclaredRender({
        ...args,
        rendered: rendered(["ghcr.io/severinno/ubuntu-bun:1.3.14"]),
      }),
    ).toEqual([])
  })

  it("variável não definida no env → violação que nomeia a variável", () => {
    const v = analyzeDeclaredRender({
      ...args,
      rendered: rendered(["ghcr.io/severinno/ubuntu-bun:1.3.14"]),
      stderr: dockerLog("BUN_VERSIO"),
    })
    expect(v.length).toBe(1)
    expect(v[0]).toContain("'BUN_VERSIO'")
    expect(v[0]).toContain("deploy/env.gitea.example")
  })

  it("TAG vazia → violação própria (o compose segue porque a variável não tem default)", () => {
    const v = analyzeDeclaredRender({
      ...args,
      rendered: rendered(["ghcr.io/severinno/ubuntu-bun:"]),
    })
    expect(v.length).toBe(1)
    expect(v[0]).toContain("VAZIA")
  })

  it("tag diferente da declarada → violação (roda outra versão)", () => {
    const v = analyzeDeclaredRender({
      ...args,
      rendered: rendered(["ghcr.io/severinno/ubuntu-bun:1.4.0"]),
    })
    expect(v.length).toBe(1)
    expect(v[0]).toContain("nao e a declarada")
  })

  it("token vazio → violação (o runner não se registra)", () => {
    const v = analyzeDeclaredRender({
      ...args,
      rendered: rendered(["ghcr.io/severinno/ubuntu-bun:1.3.14"], null),
    })
    expect(v.length).toBe(1)
    expect(v[0]).toContain("TOKEN")
  })

  it("label sem imagem e render sem o serviço runner → violações próprias", () => {
    expect(analyzeDeclaredRender({ ...args, rendered: rendered([]) }).join(" ")).toContain(
      "nao renderiza nenhuma imagem",
    )
    expect(analyzeDeclaredRender({ ...args, rendered: {} }).join(" ")).toContain(
      "nao tem o servico 'runner'",
    )
  })

  it("imagem que não é ubuntu-bun → violação", () => {
    const v = analyzeDeclaredRender({
      ...args,
      rendered: rendered(["ghcr.io/severinno/outra-imagem:1.3.14"]),
    })
    expect(v.join(" ")).toContain("nao e uma imagem ubuntu-bun")
  })
})

describe("analyzeSentinelRender — a imagem e o token VÊM das variáveis", () => {
  const sentinelRef = `${COMPOSE_SENTINELS.IMAGE_REGISTRY}/${COMPOSE_SENTINELS.IMAGE_NAMESPACE}/ubuntu-bun:${COMPOSE_SENTINELS.BUN_VERSION}`

  it("label com as sentinelas → nenhuma violação", () => {
    expect(
      analyzeSentinelRender({
        rendered: rendered([sentinelRef, sentinelRef], COMPOSE_SENTINELS.RUNNER_TOKEN),
      }),
    ).toEqual([])
  })

  it("registry literal no caminho → violação (não veio da variável)", () => {
    const v = analyzeSentinelRender({
      rendered: rendered(
        ["ghcr.io/severinno/ubuntu-bun:9.9.9-sentinel"],
        COMPOSE_SENTINELS.RUNNER_TOKEN,
      ),
    })
    expect(v.length).toBe(1)
    expect(v[0]).toContain("LITERAL no compose")
  })

  it("token literal → violação (segredo versionado)", () => {
    const v = analyzeSentinelRender({
      rendered: rendered([sentinelRef], "token-no-compose"),
    })
    expect(v.length).toBe(1)
    expect(v[0]).toContain("segredo versionado")
  })
})

describe("analyzeUnsetVersionRender — sem BUN_VERSION não pode haver tag", () => {
  it("tag vazia → nenhuma violação (a variável é obrigatória de fato)", () => {
    expect(
      analyzeUnsetVersionRender({
        ok: true,
        rendered: rendered(["ghcr.io/severinno/ubuntu-bun:"]),
      }),
    ).toEqual([])
  })

  it("tag com versão → violação de DEFAULT LITERAL", () => {
    const v = analyzeUnsetVersionRender({
      ok: true,
      rendered: rendered(["ghcr.io/severinno/ubuntu-bun:1.4.0"]),
    })
    expect(v.length).toBe(1)
    expect(v[0]).toContain("DEFAULT LITERAL")
  })

  it("compose que RECUSA renderizar sem a variável → satisfaz a fase (sem fallback)", () => {
    expect(analyzeUnsetVersionRender({ ok: false, rendered: null })).toEqual([])
  })
})

describe("composeAvailable e controlledEnv", () => {
  it("docker ausente (ENOENT) → indisponível, com o motivo", () => {
    const r = composeAvailable({
      run: (() => ({ error: new Error("spawn docker ENOENT") })) as never,
    })
    expect(r.ok).toBe(false)
    expect(r.detail).toContain("ENOENT")
  })

  it("docker sem o plugin compose → indisponível, com a primeira linha do erro", () => {
    const r = composeAvailable({
      run: (() => ({
        status: 1,
        stderr: "docker: 'compose' is not a docker command.\n",
        stdout: "",
      })) as never,
    })
    expect(r.ok).toBe(false)
    expect(r.detail).toContain("is not a docker command")
  })

  it("o ambiente do filho NUNCA herda as variáveis do compose (um `export` no shell não muda o render)", () => {
    const env = controlledEnv({ PATH: "/usr/bin", BUN_VERSION: "9.9.9-do-shell" })
    expect(env.PATH).toBe("/usr/bin")
    expect(env.BUN_VERSION).toBeUndefined()
  })
})

/**
 * O passo dinâmico SEM docker (injeção): os estados que não dependem de
 * renderizar de verdade, e que o veredito do doctor consome.
 */
describe("checkComposeInterpolation — estados sem docker", () => {
  function tree(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), "registry-source-compose-"))
    for (const [rel, content] of Object.entries(files)) {
      const full = join(dir, rel)
      mkdirSync(join(full, ".."), { recursive: true })
      writeFileSync(full, content, "utf8")
    }
    return dir
  }

  it("checkout sem a stack da forja → 'absent' (nada a interpolar)", () => {
    const dir = tree({ ".actrc": "--var IMAGE_REGISTRY=ghcr.io\n" })
    try {
      const r = checkComposeInterpolation({ cwd: dir })
      expect(r.state).toBe("absent")
      expect(r.violations).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("docker indisponível → 'unavailable' e NENHUMA violação (ausência de prova ≠ prova de falha)", () => {
    const dir = tree({
      [`${DEPLOY_DIR}/${COMPOSE_BASENAME}`]: COMPOSE_FIXTURE_CORRECT + "\n",
      [`${DEPLOY_DIR}/env.gitea.example`]: "BUN_VERSION=1.3.14\n",
    })
    try {
      const r = checkComposeInterpolation({
        cwd: dir,
        run: (() => ({ error: new Error("spawn docker ENOENT") })) as never,
      })
      expect(r.state).toBe("unavailable")
      expect(r.violations).toEqual([])
      expect(r.detail).toContain("docker compose indisponivel")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("compose presente mas nenhum env da forja → 'unavailable' (sem o que comparar)", () => {
    const dir = tree({ [`${DEPLOY_DIR}/${COMPOSE_BASENAME}`]: COMPOSE_FIXTURE_CORRECT + "\n" })
    try {
      const r = checkComposeInterpolation({ cwd: dir })
      expect(r.state).toBe("unavailable")
      expect(r.detail).toContain("nenhum env da forja")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

/**
 * O passo dinâmico com o docker REAL, sobre uma árvore com o formato do compose
 * da forja. É a prova de que o gate FALHA (e não só de que a análise pura
 * devolve a frase certa): uma regressão de variável vazia ou de literal tem de
 * virar exit 1.
 *
 * `skipIf`: sem o plugin compose no ambiente, o passo fica INDETERMINADO (por
 * desenho) — e um teste que só passa com docker não pode virar o gate.
 */
describe.skipIf(!HAS_COMPOSE)("checkComposeInterpolation — docker real", () => {
  function tree(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), "registry-source-compose-real-"))
    for (const [rel, content] of Object.entries(files)) {
      const full = join(dir, rel)
      mkdirSync(join(full, ".."), { recursive: true })
      writeFileSync(full, content, "utf8")
    }
    return dir
  }

  const ENV =
    "RUNNER_TOKEN=TOKEN_REAL\nIMAGE_REGISTRY=ghcr.io\nIMAGE_NAMESPACE=severinno\nBUN_VERSION=1.3.14\n"

  it("o compose REAL do repositório é provado (3 fases)", () => {
    const r = checkComposeInterpolation({ cwd: REPO_ROOT })
    expect(r.violations, r.violations.join("\n")).toEqual([])
    expect(r.state).toBe("proven")
    expect(r.phases.length).toBe(3)
  })

  it("default LITERAL na versão (`${BUN_VERSION:-1.4.0}`) → 'violated'", () => {
    const dir = tree({
      [`${DEPLOY_DIR}/${COMPOSE_BASENAME}`]: COMPOSE_FIXTURE_CORRECT.replace(
        "ubuntu-bun:${BUN_VERSION}",
        "ubuntu-bun:${BUN_VERSION:-1.4.0}",
      ),
      [`${DEPLOY_DIR}/env.gitea.example`]: ENV,
    })
    try {
      const r = checkComposeInterpolation({ cwd: dir })
      expect(r.state).toBe("violated")
      expect(r.violations.join(" ")).toContain("DEFAULT LITERAL")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("typo na variável (`${BUN_VERSIO}`) → 'violated' e a variável é nomeada", () => {
    const dir = tree({
      [`${DEPLOY_DIR}/${COMPOSE_BASENAME}`]: COMPOSE_FIXTURE_CORRECT.replace(
        "ubuntu-bun:${BUN_VERSION}",
        "ubuntu-bun:${BUN_VERSIO}",
      ),
      [`${DEPLOY_DIR}/env.gitea.example`]: ENV,
    })
    try {
      const r = checkComposeInterpolation({ cwd: dir })
      expect(r.state).toBe("violated")
      expect(r.violations.join(" ")).toContain("'BUN_VERSIO'")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("o CLI (o gate) sai 1 com default literal e 0 com o compose correto", () => {
    const SCRIPT = join(REPO_ROOT, "scripts", "check-registry-source.mjs")
    const bad = tree({
      [`${DEPLOY_DIR}/${COMPOSE_BASENAME}`]: COMPOSE_FIXTURE_CORRECT.replace(
        "ubuntu-bun:${BUN_VERSION}",
        "ubuntu-bun:${BUN_VERSION:-1.4.0}",
      ),
      [`${DEPLOY_DIR}/env.gitea.example`]: ENV,
      ".actrc": "--var IMAGE_REGISTRY=ghcr.io\n",
    })
    const good = tree({
      [`${DEPLOY_DIR}/${COMPOSE_BASENAME}`]: COMPOSE_FIXTURE_CORRECT,
      [`${DEPLOY_DIR}/env.gitea.example`]: ENV,
      ".actrc": "--var IMAGE_REGISTRY=ghcr.io\n",
    })
    try {
      const badRun = spawnSync(process.execPath, [SCRIPT], { cwd: bad, encoding: "utf8" })
      expect(badRun.status).toBe(1)
      expect(badRun.stderr).toContain("DEFAULT LITERAL")

      const goodRun = spawnSync(process.execPath, [SCRIPT], { cwd: good, encoding: "utf8" })
      expect(goodRun.status, goodRun.stderr).toBe(0)
      expect(goodRun.stdout).toContain("interpolacao do compose da forja provada")
    } finally {
      rmSync(bad, { recursive: true, force: true })
      rmSync(good, { recursive: true, force: true })
    }
  })
})

// ── --require-compose: onde "não provei" TEM de doer ─────────────────────

/**
 * Por padrão o gate é PORTÁTIL: sem docker ele avisa (`::warning::`) e sai 0 —
 * um gate que fica vermelho por falta de ferramenta é desligado pela equipe.
 *
 * Mas há um lugar onde o render não é opcional: o job da FORJA, cuja imagem
 * embarca o plugin `compose` (contrato do Dockerfile.ubuntu-bun, verificado no
 * build). Ali, "não consegui renderizar" significa a INVARIANTE 7 não
 * verificada dentro de um job verde — a classe de falha que este repositório
 * persegue. A flag troca o silêncio pela falha; e é o smoke que a usa.
 */
describe("--require-compose", () => {
  const SCRIPT = join(REPO_ROOT, "scripts", "check-registry-source.mjs")
  const ENV_FIXTURE =
    "RUNNER_TOKEN=TOKEN_REAL\nIMAGE_REGISTRY=ghcr.io\nIMAGE_NAMESPACE=severinno\nBUN_VERSION=1.3.14\n"

  /** Árvore com o compose da forja e o env — o mínimo para o render ter objeto. */
  function forgeTree(): string {
    const dir = mkdtempSync(join(tmpdir(), "registry-source-req-"))
    for (const [rel, content] of Object.entries({
      [`${DEPLOY_DIR}/${COMPOSE_BASENAME}`]: COMPOSE_FIXTURE_CORRECT,
      [`${DEPLOY_DIR}/env.gitea.example`]: ENV_FIXTURE,
      ".actrc": "--var IMAGE_REGISTRY=ghcr.io\n",
    })) {
      const full = join(dir, rel)
      mkdirSync(join(full, ".."), { recursive: true })
      writeFileSync(full, content, "utf8")
    }
    return dir
  }

  /** PATH sem docker: o guard não encontra a ferramenta (é o que se quer medir). */
  function runWithoutDocker(args: string[], cwd: string) {
    const empty = mkdtempSync(join(tmpdir(), "registry-source-nodocker-"))
    try {
      return spawnSync(process.execPath, [SCRIPT, ...args], {
        cwd,
        encoding: "utf8",
        env: { ...process.env, PATH: empty },
      })
    } finally {
      rmSync(empty, { recursive: true, force: true })
    }
  }

  it("sem a flag, `não provei` continua PORTÁTIL (avisa e sai 0)", () => {
    const dir = forgeTree()
    try {
      const r = runWithoutDocker([], dir)
      expect(r.status).toBe(0)
      expect(r.stderr).toContain("::warning::")
      expect(r.stderr).toContain("NAO PROVADA")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("com a flag, `não provei` FALHA — e diz por que isso é pior que um aviso", () => {
    const dir = forgeTree()
    try {
      const r = runWithoutDocker(["--require-compose"], dir)
      expect(r.status).toBe(1)
      expect(r.stderr).toContain("--require-compose")
      expect(r.stderr).toContain("NAO foi provado")
      expect(r.stderr).toContain("NAO VERIFICADA")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("com a flag, as duas flags contraditórias falham (não há precedência silenciosa)", () => {
    const dir = forgeTree()
    try {
      const r = runWithoutDocker(["--require-compose", "--no-compose-render"], dir)
      expect(r.status).toBe(1)
      expect(r.stderr).toContain("skipped")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it.skipIf(!HAS_COMPOSE)("com o docker presente, a flag passa quando o render é provado", () => {
    const dir = forgeTree()
    try {
      const r = spawnSync(process.execPath, [SCRIPT, "--require-compose"], {
        cwd: dir,
        encoding: "utf8",
      })
      expect(r.status, r.stderr).toBe(0)
      expect(r.stdout).toContain("interpolacao do compose da forja provada")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
