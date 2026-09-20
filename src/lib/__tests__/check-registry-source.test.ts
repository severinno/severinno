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

import { spawn, spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterAll, describe, expect, it } from "vitest"

import {
  APP_COMPOSE,
  APP_ENV_HOSTS,
  APP_ENV_TEMPLATE,
  COMPOSE_SENTINELS,
  COMPOSE_VALUE_DEFAULTS,
  DEPLOY_DIR,
  OUT_OF_SCOPE_ALLOWLIST,
  OUT_OF_SCOPE_REVIEW_DAYS,
  REGISTRY_VARIABLES,
  SECRET_ENV_VARIABLES,
  THIRD_PARTY_ALLOWLIST,
  THIRD_PARTY_REVIEW_DAYS,
  analyzeDeclaredRender,
  analyzeSentinelRender,
  analyzeUnsetVersionRender,
  checkActrc,
  checkComposeImageDefaults,
  checkComposeImageDefaultsForRepo,
  checkComposeValueDefaults,
  checkComposeImageLine,
  checkComposeInterpolation,
  checkLiteralImageTag,
  checkNonVersionedImageRefs,
  checkOutOfScopeTargets,
  checkRegistryLine,
  classifyEnvVariable,
  collectFiles,
  compareAppHostImageDeclarations,
  compareEnvMirrorDeclarations,
  compareImageTemplates,
  compareRenderedLabels,
  composeAvailable,
  composeEnvDefaults,
  composeEnvVariables,
  controlledEnv,
  declaredImageValues,
  findViolations,
  forgeVariableRefs,
  imageDefaultFixtureRule,
  sweepImageDefaultValues,
  imageRefsIn,
  isCommentLine,
  isComposeFile,
  isRegistryVariableForm,
  labelImageRefs,
  matchesScanTarget,
  outOfScopeViolations,
  parseAddedAt,
  parseComposeRender,
  parseEnvAssignments,
  stripInlineComment,
  sweepOutOfScope,
  sweepThirdPartyAllowlist,
  thirdPartyAllowlistViolations,
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
  "      - GITEA__registry__ENABLED=${GITEA__registry__ENABLED:-true}\n" +
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
    const line = `    image: ${THIRD_PARTY_ALLOWLIST[0].prefix}:latest`
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
      THIRD_PARTY_ALLOWLIST[0].prefix +
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

  // `--no-registry-probe`: esta bateria testa a varredura ESTATICA. O fato das
  // referencias nao versionadas tem os proprios testes (acima, com o probe
  // injetado, e abaixo, contra um registry de TESTE) — aqui uma consulta a rede
  // so tornaria o teste lento e dependente de DNS.
  function runIn(
    tree: Record<string, string>,
    args: string[] = ["--no-compose-render", "--no-registry-probe"],
  ) {
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

  /**
   * "Hoje" FIXO da bateria de registro/revisão: a data da decisão e a janela
   * têm de ser comparadas contra um relógio INJETADO — uma prova que dependesse
   * do dia em que a suíte roda envelheceria sozinha 180 dias depois.
   */
  const NOW = Date.parse("2026-09-13T00:00:00Z")
  const TODAY = "2026-09-13"

  it("arquivo novo num diretório não varrido → VIOLAÇÃO (o buraco que a invariante fecha)", () => {
    const root = treeOf({ "ci-tools/Dockerfile.build": IMAGE })
    const v = checkOutOfScopeTargets(root, { allowlist: [] })
    expect(v.length).toBe(1)
    expect(v[0]).toContain("ci-tools/Dockerfile.build")
    expect(v[0]).toContain("sem decisao escrita")
    expect(v[0]).toContain("/severinno/ubuntu-bun:1.3.14")
  })

  it("com a decisão escrita (motivo + data), passa", () => {
    const root = treeOf({ "ci-tools/Dockerfile.build": IMAGE })
    expect(
      checkOutOfScopeTargets(root, {
        allowlist: [
          {
            path: "ci-tools/Dockerfile.build",
            reason: "build da imagem de teste",
            addedAt: TODAY,
          },
        ],
        now: NOW,
      }),
    ).toEqual([])
  })

  it("decisão VELHA (o arquivo existe e deixou de referenciar a imagem) → violação", () => {
    const root = treeOf({ "ci-tools/Dockerfile.build": "FROM alpine:3.20\n" })
    const v = checkOutOfScopeTargets(root, {
      allowlist: [{ path: "ci-tools/Dockerfile.build", reason: "era um alvo", addedAt: TODAY }],
      now: NOW,
    })
    expect(v.length).toBe(1)
    expect(v[0]).toContain("decisao velha")
  })

  it("decisão de um arquivo AUSENTE na raiz é ignorada (a allowlist descreve o repo, não a árvore sintética)", () => {
    // É o que permite `findViolations(root)` rodar em checkout parcial/temp tree
    // sem acusar as decisões do repositório como velhas.
    const root = treeOf({ "ci-tools/Dockerfile.build": IMAGE })
    const v = checkOutOfScopeTargets(root, {
      allowlist: [
        { path: "scripts/check-registry-source.mjs", reason: "x".repeat(50), addedAt: TODAY },
      ],
      now: NOW,
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
// INVARIANTE 8 (registro + revisão) — `addedAt` e a decisão SEM REVISÃO
// ═══════════════════════════════════════════════════════════════════════════
//
// POR QUE ESTES TESTES EXISTEM: uma allowlist sem data de entrada não tem como
// envelhecer — e "esqueci de registrar" seria o jeito de nunca precisar
// revisar. Aqui se prova (a) que a data é obrigatória e validada, (b) que a
// janela é MEDIDA contra um relógio injetado e (c) que o modo `--review` (o
// canal do job semanal) escala a decisão vencida a violação, enquanto o run
// normal NÃO bloqueia pre-commit nem PR.

describe("registro da decisão (addedAt) e revisão vencida (--review)", () => {
  const IMAGE = "FROM ghcr.io/severinno/ubuntu-bun:1.3.14\n"
  const NOW = Date.parse("2026-09-13T00:00:00Z")
  const entryFor = (addedAt?: string) => [
    {
      path: "ci-tools/Dockerfile.build",
      reason: "build da imagem de teste (motivo longo o bastante para o contrato)",
      ...(addedAt === undefined ? {} : { addedAt }),
    },
  ]
  const root = () => treeOf({ "ci-tools/Dockerfile.build": IMAGE })

  it("parseAddedAt — aceita data civil ISO e rejeita o que não é", () => {
    expect(parseAddedAt("2026-09-13")).toBe(NOW)
    expect(parseAddedAt("2026-02-30")).toBeNull() // transborda para 2026-03-02
    expect(parseAddedAt("13/09/2026")).toBeNull()
    expect(parseAddedAt("2026-9-13")).toBeNull()
    expect(parseAddedAt(20260913)).toBeNull()
    expect(parseAddedAt(undefined)).toBeNull()
  })

  it("entrada SEM addedAt → VIOLAÇÃO nos dois modos (a isenção não foge da revisão)", () => {
    const v = checkOutOfScopeTargets(root(), { allowlist: entryFor(), now: NOW })
    expect(v.length).toBe(1)
    expect(v[0]).toContain("sem `addedAt`")
    expect(v[0]).toContain("esqueci de registrar")
    // Modo --review: registro ausente não é "vencido", é INVÁLIDO — a mesma lista.
    expect(
      checkOutOfScopeTargets(root(), { allowlist: entryFor(), now: NOW, failAged: true }),
    ).toEqual(v)
  })

  it("addedAt malformada, transbordada ou NO FUTURO → violação (data que o autor não digitou)", () => {
    for (const [value, marker] of [
      ["13/09/2026", "invalido"],
      ["2026-02-30", "invalido"],
      ["2026-12-31", "no FUTURO"],
    ] as const) {
      const v = checkOutOfScopeTargets(root(), { allowlist: entryFor(value), now: NOW })
      expect(v.length, `addedAt=${value}`).toBe(1)
      expect(v[0]).toContain(marker)
    }
  })

  it("dentro da janela → sem aged e sem violação (o limite é INCLUSIVO)", () => {
    const noLimite = new Date(NOW - OUT_OF_SCOPE_REVIEW_DAYS * 86_400_000)
      .toISOString()
      .slice(0, 10)
    const sweep = sweepOutOfScope(root(), { allowlist: entryFor(noLimite), now: NOW })
    expect(sweep.aged).toEqual([])
    expect(sweep.invalid).toEqual([])
    expect(checkOutOfScopeTargets(root(), { allowlist: entryFor(noLimite), now: NOW })).toEqual([])
  })

  it("PASSADA a janela → aged[] (o modo normal NÃO bloqueia; o --review FALHA)", () => {
    const velha = new Date(NOW - (OUT_OF_SCOPE_REVIEW_DAYS + 20) * 86_400_000)
      .toISOString()
      .slice(0, 10)
    const sweep = sweepOutOfScope(root(), { allowlist: entryFor(velha), now: NOW })
    expect(sweep.aged).toHaveLength(1)
    expect(sweep.aged[0]).toMatchObject({
      path: "ci-tools/Dockerfile.build",
      addedAt: velha,
      limit: OUT_OF_SCOPE_REVIEW_DAYS,
    })
    expect(sweep.aged[0].days).toBeGreaterThan(OUT_OF_SCOPE_REVIEW_DAYS)

    // Modo normal: o aviso é do CLI (::warning::) — a lista de violações fica vazia.
    expect(checkOutOfScopeTargets(root(), { allowlist: entryFor(velha), now: NOW })).toEqual([])
    // Modo --review: a MESMA decisão vira violação (o canal do job semanal).
    const v = checkOutOfScopeTargets(root(), {
      allowlist: entryFor(velha),
      now: NOW,
      failAged: true,
    })
    expect(v).toHaveLength(1)
    expect(v[0]).toContain("SEM REVISAO")
    expect(v[0]).toContain(velha)
    expect(v[0]).toContain("permanente por esquecimento")
  })

  it("outOfScopeViolations — failAged SÓ acrescenta as vencidas, sem duplicar as demais", () => {
    const sweep = sweepOutOfScope(root(), { allowlist: entryFor("2020-01-01"), now: NOW })
    expect(outOfScopeViolations(sweep, { failAged: false })).toEqual([])
    expect(outOfScopeViolations(sweep, { failAged: true })).toHaveLength(sweep.aged.length)
  })

  it("no REPO REAL: toda entrada tem addedAt válido e está DENTRO da janela", () => {
    const sweep = sweepOutOfScope(REPO_ROOT)
    expect(sweep.invalid, "entrada sem data / data inválida / no futuro").toEqual([])
    expect(sweep.aged, "entrada sem revisão dentro da janela").toEqual([])
    for (const entry of OUT_OF_SCOPE_ALLOWLIST) {
      expect(parseAddedAt(entry.addedAt), `addedAt inválido em ${entry.path}`).not.toBeNull()
    }
  })

  it("o comando do job semanal (--review, offline) roda no repo real e sai 0 hoje", () => {
    const r = spawnSync(
      process.execPath,
      [
        join(process.cwd(), "scripts", "check-registry-source.mjs"),
        "--review",
        "--no-compose-render",
        "--no-registry-probe",
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    )
    expect(r.status).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// A OUTRA ALLOWLIST — imagens de TERCEIROS envelhecem pela MESMA regra
// ═══════════════════════════════════════════════════════════════════════════
//
// A decisão é outra ("esta imagem não é nossa e o consumo é consciente"), mas o
// defeito é o mesmo: uma isenção concedida há muito tempo continua valendo
// porque ninguém voltou nela. O que NÃO pode ser copiado é a REGRA — ela vem de
// `allowlist-review.mjs`, o mesmo módulo das decisões de escopo.

describe("a allowlist de imagens de TERCEIROS (registro + revisão)", () => {
  const NOW = Date.parse("2026-09-13T00:00:00Z")
  const listFor = (addedAt?: string) => [
    {
      prefix: "ghcr.io/algum-terceiro/coisa",
      reason: "imagem comunitaria consumida de proposito (motivo longo o bastante)",
      ...(addedAt === undefined ? {} : { addedAt }),
    },
  ]
  const diasAtras = (d: number) => new Date(NOW - d * 86_400_000).toISOString().slice(0, 10)

  it("a data é obrigatória e validada fail-closed (ausente / malformada / no futuro)", () => {
    for (const [value, marker] of [
      [undefined, "sem `addedAt`"],
      ["13/09/2026", "invalido"],
      ["2026-02-30", "invalido"],
      ["2026-12-31", "no FUTURO"],
    ] as const) {
      const sweep = sweepThirdPartyAllowlist({ allowlist: listFor(value), now: NOW })
      const v = thirdPartyAllowlistViolations(sweep, { failAged: false })
      expect(v.length, `addedAt=${String(value)}`).toBe(1)
      expect(v[0]).toContain("THIRD_PARTY_ALLOWLIST")
      expect(v[0]).toContain(marker)
      // Registro inválido é violação nos DOIS modos — o `--review` não muda isso.
      expect(thirdPartyAllowlistViolations(sweep, { failAged: true })).toEqual(v)
    }
  })

  it("dentro da janela → nada; PASSADA a janela → aged (aviso) e o --review FALHA", () => {
    const naJanela = sweepThirdPartyAllowlist({
      allowlist: listFor(diasAtras(THIRD_PARTY_REVIEW_DAYS)),
      now: NOW,
    })
    expect(naJanela).toEqual({ invalid: [], aged: [] })

    const velha = diasAtras(THIRD_PARTY_REVIEW_DAYS + 20)
    const sweep = sweepThirdPartyAllowlist({ allowlist: listFor(velha), now: NOW })
    expect(sweep.invalid).toEqual([])
    expect(sweep.aged).toHaveLength(1)
    expect(sweep.aged[0]).toMatchObject({
      id: "ghcr.io/algum-terceiro/coisa",
      addedAt: velha,
      limit: THIRD_PARTY_REVIEW_DAYS,
    })
    expect(sweep.aged[0].days).toBeGreaterThan(THIRD_PARTY_REVIEW_DAYS)

    // Run normal: o aviso é do CLI (`::warning::`), não uma violação.
    expect(thirdPartyAllowlistViolations(sweep, { failAged: false })).toEqual([])
    // Modo --review (o job semanal): a mesma decisão vira violação.
    const v = thirdPartyAllowlistViolations(sweep, { failAged: true })
    expect(v).toHaveLength(1)
    expect(v[0]).toContain("SEM REVISAO")
    expect(v[0]).toContain(velha)
    expect(v[0]).toContain("permanente por esquecimento")
  })

  it("o fio gate→violação está LIGADO (findViolations consome o sweep de terceiros)", () => {
    // Sem isto a função existiria e o guard não a chamaria — a isenção de
    // terceiros envelheceria em silêncio, que é o defeito que ela fecha.
    const velha = diasAtras(THIRD_PARTY_REVIEW_DAYS + 20)
    const injetado = sweepThirdPartyAllowlist({ allowlist: listFor(velha), now: NOW })
    const v = findViolations(REPO_ROOT, { thirdPartySweep: injetado, failAged: true })
    expect(v.some((m) => m.includes("THIRD_PARTY_ALLOWLIST"))).toBe(true)
    // Sem `failAged`, o vencido NÃO entra (é o run normal: avisa, não bloqueia).
    const semFail = findViolations(REPO_ROOT, { thirdPartySweep: injetado, failAged: false })
    expect(semFail.some((m) => m.includes(velha))).toBe(false)
  })

  it("no REPO REAL: toda entrada tem addedAt válido, motivo escrito e está DENTRO da janela", () => {
    const sweep = sweepThirdPartyAllowlist()
    expect(sweep.invalid, "entrada sem data / data inválida / no futuro").toEqual([])
    expect(sweep.aged, "entrada sem revisão dentro da janela").toEqual([])
    for (const entry of THIRD_PARTY_ALLOWLIST) {
      expect(parseAddedAt(entry.addedAt), `addedAt inválido em ${entry.prefix}`).not.toBeNull()
      // O motivo é a decisão escrita — uma lista sem ele é uma isenção anônima
      // (a mesma exigência das decisões de escopo).
      expect(entry.reason.length, `motivo curto em ${entry.prefix}`).toBeGreaterThan(40)
    }
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

// ── INVARIANTE 7b: o env do HOST x o template COMITADO ────────────────────
//
// O buraco que estes testes prendem: as três fases provam que o env da forja é
// AUTO-CONSISTENTE. Onde o arquivo do host existe (o VPS), ninguém provava que
// ele era o MESMO que o repositório declara — o gate verde com o runner
// registrando outra imagem.

/** Nomes que o compose da forja realmente consome (derivados, não listados). */
const CONSUMED = [
  "BUN_VERSION",
  "GITEA__registry__ENABLED",
  "IMAGE_NAMESPACE",
  "IMAGE_REGISTRY",
  "RUNNER_TOKEN",
]

/** Template COMITADO: o token é o placeholder, como no arquivo real. */
function templateEnv(): Map<string, string> {
  return new Map([
    ["RUNNER_TOKEN", "COLE_O_TOKEN_AQUI"],
    ["IMAGE_REGISTRY", "ghcr.io"],
    ["IMAGE_NAMESPACE", "severinno"],
    ["BUN_VERSION", "1.3.14"],
    // O par declarado do registry embutido (a etapa 1 do corte): o template o
    // declara e o compose o consome com o MESMO valor como default.
    ["GITEA__registry__ENABLED", "true"],
  ])
}

/** Env do HOST: o mesmo, com o token de VERDADE (é o único valor que difere). */
function hostEnv(): Map<string, string> {
  const env = templateEnv()
  env.set("RUNNER_TOKEN", "TOKEN_REAL_DO_VPS")
  return env
}

const TEMPLATE_LABEL = "deploy/env.gitea.example"
const HOST_LABEL = "deploy/.env.gitea"

describe("composeEnvVariables — as consumidas vêm do COMPOSE, não de uma lista à mão", () => {
  it("deriva `${NOME}` e `${NOME:-default}` de linhas de código", () => {
    expect(composeEnvVariables(COMPOSE_FIXTURE_CORRECT)).toEqual(CONSUMED)
  })

  it("prosa não é configuração: comentário de linha e inline não inventam variável", () => {
    expect(
      composeEnvVariables("# cita ${BUN_VERSION} e ${NAO_EXISTE}\nkey: valor # ${OUTRA}\n"),
    ).toEqual([])
  })

  it("uma variável NOVA no compose entra na comparação sozinha (não há lista para envelhecer)", () => {
    const comNova = `${COMPOSE_FIXTURE_CORRECT}      - NOVA_VAR=\${VARIAVEL_NOVA}\n`
    expect(composeEnvVariables(comNova)).toContain("VARIAVEL_NOVA")
  })

  it("no compose REAL do repositório: as CINCO variáveis do deploy, e só elas", () => {
    const real = readFileSync(join(REPO_ROOT, "deploy", COMPOSE_BASENAME), "utf8")
    expect(composeEnvVariables(real)).toEqual(CONSUMED)
  })
})

describe("parseEnvAssignments — o mesmo que o `--env-file` do docker lê", () => {
  it("lê NOME=valor, com `export` e com aspas", () => {
    const env = parseEnvAssignments('export BUN_VERSION=1.3.14\nIMAGE_REGISTRY="ghcr.io"\n')
    expect(env.get("BUN_VERSION")).toBe("1.3.14")
    expect(env.get("IMAGE_REGISTRY")).toBe("ghcr.io")
  })

  it("descarta comentário de linha e inline (fora de aspas)", () => {
    const env = parseEnvAssignments("# BUN_VERSION=0.0.0\nBUN_VERSION=1.3.14 # fixado\n")
    expect(env.get("BUN_VERSION")).toBe("1.3.14")
    expect(env.size).toBe(1)
  })

  it("valor com `#` DENTRO de aspas não é comentário", () => {
    expect(parseEnvAssignments('X="a#b"\n').get("X")).toBe("a#b")
  })

  it("a ÚLTIMA ocorrência vence (semântica do `--env-file`) — comparar com o parser do docker", () => {
    expect(parseEnvAssignments("X=1\nX=2\n").get("X")).toBe("2")
  })
})

describe("classifyEnvVariable — o default é COMPARAR o valor", () => {
  it("só o segredo é isento (nomeado, um por um)", () => {
    expect(SECRET_ENV_VARIABLES).toEqual(["RUNNER_TOKEN"])
    expect(classifyEnvVariable("RUNNER_TOKEN")).toBe("secret")
  })

  it("variável NOVA (não classificada) é conferida por valor — não existe isenção silenciosa", () => {
    expect(classifyEnvVariable("QUALQUER_OUTRA")).toBe("value")
  })
})

describe("compareEnvMirrorDeclarations — o que o VPS interpola x o que o repo declara", () => {
  function compare(template: Map<string, string>, host: Map<string, string> | null) {
    return compareEnvMirrorDeclarations({
      template,
      host,
      templateLabel: TEMPLATE_LABEL,
      hostLabel: HOST_LABEL,
      consumed: CONSUMED,
    })
  }

  it("em sincronia (token do host DIFERENTE do placeholder) → nenhuma violação", () => {
    expect(compare(templateEnv(), hostEnv())).toEqual([])
  })

  it("valor divergente → violação que nomeia a variável e os DOIS valores", () => {
    const host = hostEnv()
    host.set("BUN_VERSION", "1.2.0")
    const v = compare(templateEnv(), host)
    expect(v).toHaveLength(1)
    expect(v[0]).toContain("'BUN_VERSION'")
    expect(v[0]).toContain("='1.3.14'")
    expect(v[0]).toContain("host='1.2.0'")
  })

  it("variável do template AUSENTE no host → violação (o VPS cairia no DEFAULT do compose)", () => {
    const host = hostEnv()
    host.delete("IMAGE_NAMESPACE")
    const v = compare(templateEnv(), host)
    expect(v.join(" ")).toContain("'IMAGE_NAMESPACE'")
    expect(v.join(" ")).toContain("default embutido")
  })

  it("variável SOBRANDO no host → violação (o estado do VPS não é reproduzível)", () => {
    const host = hostEnv()
    host.set("SO_BRASA", "1")
    expect(compare(templateEnv(), host).join(" ")).toContain("'SO_BRASA'")
  })

  it("segredo VAZIO no host → violação (o container recebe string vazia)", () => {
    const host = hostEnv()
    host.set("RUNNER_TOKEN", "")
    expect(compare(templateEnv(), host).join(" ")).toContain("VAZIA")
  })

  it("segredo IGUAL ao template → violação (placeholder não preenchido OU segredo versionado)", () => {
    const host = hostEnv()
    host.set("RUNNER_TOKEN", "COLE_O_TOKEN_AQUI")
    const v = compare(templateEnv(), host)
    expect(v).toHaveLength(1)
    expect(v[0]).toContain("MESMO valor do template")
  })

  it("sem o arquivo do host → confere só o CONTRATO do repositório (a metade que roda no CI)", () => {
    expect(compare(templateEnv(), null)).toEqual([])
    const semImagem = templateEnv()
    semImagem.delete("IMAGE_REGISTRY")
    expect(compare(semImagem, null).join(" ")).toContain("nao esta declarada no template comitado")
  })

  it("no REPO REAL o template comitado declara TUDO o que o compose consome", () => {
    const content = readFileSync(join(REPO_ROOT, "deploy", "env.gitea.example"), "utf8")
    expect(compare(parseEnvAssignments(content), null)).toEqual([])
  })
})

describe("compareRenderedLabels — o label renderizado dos dois lados", () => {
  it("mesmo label → nenhuma violação", () => {
    expect(
      compareRenderedLabels({
        templateRendered: rendered(["ghcr.io/severinno/ubuntu-bun:1.3.14"]),
        hostRendered: rendered(["ghcr.io/severinno/ubuntu-bun:1.3.14"]),
        templateLabel: TEMPLATE_LABEL,
        hostLabel: HOST_LABEL,
      }),
    ).toEqual([])
  })

  it("label diferente → violação com as DUAS imagens (a que o VPS registra e a declarada)", () => {
    const v = compareRenderedLabels({
      templateRendered: rendered(["ghcr.io/severinno/ubuntu-bun:1.3.14"]),
      hostRendered: rendered(["ghcr.io/outro-ns/ubuntu-bun:1.3.14"]),
      templateLabel: TEMPLATE_LABEL,
      hostLabel: HOST_LABEL,
    })
    expect(v).toHaveLength(1)
    expect(v[0]).toContain("ghcr.io/outro-ns/ubuntu-bun:1.3.14")
    expect(v[0]).toContain("ghcr.io/severinno/ubuntu-bun:1.3.14")
    expect(v[0]).toContain("INTERPOLA diferente")
  })

  it("label ausente num dos lados → nada aqui (as fases 1 e 2 cobrem, com mensagem própria)", () => {
    expect(
      compareRenderedLabels({
        templateRendered: null,
        hostRendered: rendered(["ghcr.io/severinno/ubuntu-bun:1.3.14"]),
        templateLabel: TEMPLATE_LABEL,
        hostLabel: HOST_LABEL,
      }),
    ).toEqual([])
  })
})

/**
 * A comparação de ARQUIVOS não depende do docker: ela tem de falhar mesmo onde
 * o plugin `compose` falta — senão o "não provei" do render esconderia o drift
 * justamente na máquina onde ele importa.
 */
describe("checkComposeInterpolation — host x template SEM docker", () => {
  const TEMPLATE =
    "RUNNER_TOKEN=COLE_O_TOKEN_AQUI\nIMAGE_REGISTRY=ghcr.io\nIMAGE_NAMESPACE=severinno\nBUN_VERSION=1.3.14\n" +
    "GITEA__registry__ENABLED=true\n"

  function tree(hostContent: string | null): string {
    const dir = mkdtempSync(join(tmpdir(), "registry-source-host-"))
    const files: Record<string, string> = {
      [`${DEPLOY_DIR}/${COMPOSE_BASENAME}`]: COMPOSE_FIXTURE_CORRECT,
      [`${DEPLOY_DIR}/env.gitea.example`]: TEMPLATE,
    }
    if (hostContent !== null) files[`${DEPLOY_DIR}/.env.gitea`] = hostContent
    for (const [rel, content] of Object.entries(files)) {
      const full = join(dir, rel)
      mkdirSync(join(full, ".."), { recursive: true })
      writeFileSync(full, content, "utf8")
    }
    return dir
  }

  const noDocker = (() => ({ error: new Error("spawn docker ENOENT") })) as never

  it("host DIVERGENTE falha mesmo sem docker (a comparação é de arquivos)", () => {
    const dir = tree(TEMPLATE.replace("1.3.14", "1.2.0"))
    try {
      const r = checkComposeInterpolation({ cwd: dir, run: noDocker })
      expect(r.state).toBe("violated")
      expect(r.violations.join(" ")).toContain("'BUN_VERSION' DIVERGE")
      expect(r.hostCompare.state).toBe("diverged")
      expect(r.phases).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("host em sincronia: sem docker o render fica INDETERMINADO, mas a comparação já está provada", () => {
    const dir = tree(TEMPLATE.replace("COLE_O_TOKEN_AQUI", "REAL"))
    try {
      const r = checkComposeInterpolation({ cwd: dir, run: noDocker })
      expect(r.state).toBe("unavailable")
      expect(r.violations).toEqual([])
      expect(r.hostCompare.state).toBe("in-sync")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("sem o arquivo do host: 'absent' no campo (nunca 'em sincronia' por omissão)", () => {
    const dir = tree(null)
    try {
      const r = checkComposeInterpolation({ cwd: dir, run: noDocker })
      expect(r.hostCompare.state).toBe("absent")
      expect(r.hostCompare.detail).toContain("deploy/.env.gitea")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
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
    // O template declara TUDO o que o compose consome: um template incompleto
    // viraria 'violated' pelo CONTRATO (e com razão — é a metade que roda no
    // CI). Aqui a intenção é medir só a ausência do docker.
    const dir = tree({
      [`${DEPLOY_DIR}/${COMPOSE_BASENAME}`]: COMPOSE_FIXTURE_CORRECT + "\n",
      [`${DEPLOY_DIR}/env.gitea.example`]:
        "RUNNER_TOKEN=COLE_O_TOKEN_AQUI\nIMAGE_REGISTRY=ghcr.io\nIMAGE_NAMESPACE=severinno\nBUN_VERSION=1.3.14\n" +
        "GITEA__registry__ENABLED=true\n",
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
    "RUNNER_TOKEN=TOKEN_REAL\nIMAGE_REGISTRY=ghcr.io\nIMAGE_NAMESPACE=severinno\nBUN_VERSION=1.3.14\n" +
    "GITEA__registry__ENABLED=true\n"

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

  // ── invariante 7b, com o docker REAL: o VPS x o repositório ──────────────

  const TEMPLATE_ENV =
    "RUNNER_TOKEN=COLE_O_TOKEN_AQUI\nIMAGE_REGISTRY=ghcr.io\nIMAGE_NAMESPACE=severinno\nBUN_VERSION=1.3.14\n" +
    "GITEA__registry__ENABLED=true\n"

  /** Árvore da forja com o par template + host (host `null` = só o template). */
  function forgeTree(hostContent: string | null): string {
    const files: Record<string, string> = {
      [`${DEPLOY_DIR}/${COMPOSE_BASENAME}`]: COMPOSE_FIXTURE_CORRECT,
      [`${DEPLOY_DIR}/env.gitea.example`]: TEMPLATE_ENV,
      ".actrc": "--var IMAGE_REGISTRY=ghcr.io\n",
    }
    if (hostContent !== null) files[`${DEPLOY_DIR}/.env.gitea`] = hostContent
    return tree(files)
  }

  it("host em SINCRONIA com o template → provado, e o par ganha o render do template", () => {
    const dir = forgeTree(TEMPLATE_ENV.replace("COLE_O_TOKEN_AQUI", "TOKEN_REAL_DO_VPS"))
    try {
      const r = checkComposeInterpolation({ cwd: dir })
      expect(r.violations, r.violations.join("\n")).toEqual([])
      expect(r.state).toBe("proven")
      expect(r.hostCompare.state).toBe("in-sync")
      // O render do template entra na lista: são QUATRO renderizações quando há
      // os dois arquivos (a fase 1 já é o host).
      expect(r.phases).toContain("template=ok")
      expect(r.phases).toHaveLength(4)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("host DIVERGENTE → 'violated' nas DUAS metades (declaração e label), e o CLI sai 1", () => {
    const dir = forgeTree(
      TEMPLATE_ENV.replace("IMAGE_NAMESPACE=severinno", "IMAGE_NAMESPACE=outro-ns").replace(
        "COLE_O_TOKEN_AQUI",
        "TOKEN_REAL_DO_VPS",
      ),
    )
    try {
      const r = checkComposeInterpolation({ cwd: dir })
      expect(r.state).toBe("violated")
      expect(r.hostCompare.state).toBe("diverged")
      const text = r.violations.join("\n")
      expect(text).toContain("'IMAGE_NAMESPACE' DIVERGE")
      expect(text).toContain("INTERPOLA diferente")

      const run = spawnSync(
        process.execPath,
        [join(REPO_ROOT, "scripts", "check-registry-source.mjs")],
        { cwd: dir, encoding: "utf8" },
      )
      expect(run.status).toBe(1)
      expect(run.stderr).toContain("nao e o que o repositorio declara")
      expect(run.stderr).toContain("--re-register")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("--gitea-env compara o env APONTADO, e um caminho inexistente falha o uso (exit 2)", () => {
    const dir = forgeTree(null)
    const SCRIPT = join(REPO_ROOT, "scripts", "check-registry-source.mjs")
    try {
      writeFileSync(
        join(dir, "host.env"),
        TEMPLATE_ENV.replace("COLE_O_TOKEN_AQUI", "TOKEN_REAL_DO_VPS"),
        "utf8",
      )
      const ok = spawnSync(process.execPath, [SCRIPT, "--gitea-env", "host.env"], {
        cwd: dir,
        encoding: "utf8",
      })
      expect(ok.status, ok.stderr).toBe(0)
      expect(ok.stdout).toContain("host x template em sincronia")

      const missing = spawnSync(process.execPath, [SCRIPT, "--gitea-env", "nao-existe.env"], {
        cwd: dir,
        encoding: "utf8",
      })
      expect(missing.status).toBe(2)
      expect(missing.stderr).toContain("inexistente")
    } finally {
      rmSync(dir, { recursive: true, force: true })
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
    "RUNNER_TOKEN=TOKEN_REAL\nIMAGE_REGISTRY=ghcr.io\nIMAGE_NAMESPACE=severinno\nBUN_VERSION=1.3.14\n" +
    "GITEA__registry__ENABLED=true\n"

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

// ═══════════════════════════════════════════════════════════════════════════
// INVARIANTE 9 — as referências que vivem FORA do repositório
//
// Três fontes que o repositório não contém: repository variables (`vars.*`), o
// env do HOST da aplicação (gitignored) e o que o REGISTRY serve hoje para a
// tag. Nos três, presumir é o defeito — o fato devolve tri-estado e o guard só
// falha quando PROVOU que está errado; o resto sai escrito como não provado.
//
// O `probe` é injetado em TODOS estes testes: nenhum deles toca a rede, e é a
// única fronteira de dependência da função (o resto é leitura de arquivos).
// ═══════════════════════════════════════════════════════════════════════════

/** Resposta falsa do `probeImageIdentity` — o formato que a função consome. */
function probeStub(state: string, extra: Record<string, unknown> = {}) {
  return async () => ({ state, detail: `stub:${state}`, digest: null, version: null, ...extra })
}

/** Árvore sintética com as DUAS stacks declaradas (o formato real dos arquivos). */
function refsTree(
  extra: Record<string, string> = {},
  { forgeHost = null, appHost = null }: { forgeHost?: string | null; appHost?: string | null } = {},
): string {
  const dir = mkdtempSync(join(tmpdir(), "registry-refs-"))
  const files: Record<string, string> = {
    "deploy/env.gitea.example":
      "RUNNER_TOKEN=COLE_O_TOKEN_AQUI\nIMAGE_REGISTRY=ghcr.io\nIMAGE_NAMESPACE=severinno\nBUN_VERSION=1.3.14\n" +
      "GITEA__registry__ENABLED=true\n",
    [APP_ENV_TEMPLATE]: "IMAGE_REGISTRY=ghcr.io\nIMAGE_NAMESPACE=severinno\n",
    ".gitea/workflows/ci.yml":
      "jobs:\n  guards:\n    steps:\n      - run: echo ${{ vars.IMAGE_REGISTRY }}\n" +
      "      - run: echo ${{ vars.IMAGE_NAMESPACE }}\n      - run: echo ${{ vars.BUN_VERSION }}\n",
    [`${DEPLOY_DIR}/docker-compose.gitea.yml`]:
      "services:\n  runner:\n    image: gitea/act_runner:latest\n    environment:\n" +
      "      - GITEA__registry__ENABLED=${GITEA__registry__ENABLED:-true}\n" +
      buildRunnerLabel("${BUN_VERSION}") +
      "\n",
    [APP_COMPOSE]:
      "services:\n  realtime:\n    build:\n      args:\n        BUN_VERSION: ${BUN_VERSION:-1.3.14}\n" +
      "    image: ${IMAGE_REGISTRY:-ghcr.io}/${IMAGE_NAMESPACE:-severinno}/realtime:latest\n",
    ...extra,
  }
  if (forgeHost !== null) files["deploy/.env.gitea"] = forgeHost
  if (appHost !== null) files[APP_ENV_HOSTS[0]] = appHost
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel)
    mkdirSync(join(full, ".."), { recursive: true })
    writeFileSync(full, content, "utf8")
  }
  return dir
}

describe("invariante 9 — defaults do compose x o template comitado", () => {
  const treeOf = (files: Record<string, string>) => {
    const dir = mkdtempSync(join(tmpdir(), "registry-defaults-"))
    for (const [rel, content] of Object.entries(files)) {
      const full = join(dir, rel)
      mkdirSync(join(full, ".."), { recursive: true })
      writeFileSync(full, content, "utf8")
    }
    return dir
  }

  it("composeEnvDefaults lê `${NOME:-valor}` e ignora comentário", () => {
    const content = [
      "# IMAGE_REGISTRY:-antigo (prosa)",
      "image: ${IMAGE_REGISTRY:-ghcr.io}/${IMAGE_NAMESPACE:-severinno}/x:latest  # inline",
      "tag: ${BUN_VERSION}",
    ].join("\n")
    expect(composeEnvDefaults(content)).toEqual([
      { name: "IMAGE_REGISTRY", value: "ghcr.io" },
      { name: "IMAGE_NAMESPACE", value: "severinno" },
    ])
  })

  it("default igual ao declarado não é violação (o caso do repositório)", () => {
    const dir = treeOf({
      [APP_COMPOSE]:
        "services:\n  x:\n    image: ${IMAGE_REGISTRY:-ghcr.io}/${IMAGE_NAMESPACE:-severinno}/x:latest\n",
      [APP_ENV_TEMPLATE]: "IMAGE_REGISTRY=ghcr.io\nIMAGE_NAMESPACE=severinno\n",
    })
    try {
      expect(
        checkComposeImageDefaults(dir, { compose: APP_COMPOSE, template: APP_ENV_TEMPLATE }),
      ).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("default DIVERGENTE do declarado é violação — é ele que vale onde a variável não existe", () => {
    const dir = treeOf({
      [APP_COMPOSE]:
        "services:\n  x:\n    image: ${IMAGE_REGISTRY:-ghcr.io}/${IMAGE_NAMESPACE:-severinno}/x:latest\n",
      [APP_ENV_TEMPLATE]: "IMAGE_REGISTRY=git.severinno.cloud\nIMAGE_NAMESPACE=severinno\n",
    })
    try {
      const v = checkComposeImageDefaults(dir, { compose: APP_COMPOSE, template: APP_ENV_TEMPLATE })
      expect(v).toHaveLength(1)
      expect(v[0]).toContain("ghcr.io")
      expect(v[0]).toContain("git.severinno.cloud")
      expect(v[0]).toContain("a imagem que roda nao e a que o repositorio declara")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("default de variável que o template NÃO declara é violação (o default vira a única fonte)", () => {
    const dir = treeOf({
      [APP_COMPOSE]:
        "services:\n  x:\n    image: ${IMAGE_REGISTRY:-git.severinno.cloud}/x:latest\n",
      // O template NAO declara IMAGE_REGISTRY: o default passa a ser a unica
      // fonte do que roda naquele host.
      [APP_ENV_TEMPLATE]: "NODE_ENV=production\n",
    })
    try {
      const v = checkComposeImageDefaults(dir, { compose: APP_COMPOSE, template: APP_ENV_TEMPLATE })
      expect(v).toHaveLength(1)
      expect(v[0]).toContain("nao declara essa variavel")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("BUN_VERSION no compose da aplicação é BUILD ARG, não referência de imagem: fora do escopo", () => {
    const dir = treeOf({
      [APP_COMPOSE]:
        "services:\n  realtime:\n    build:\n      args:\n        BUN_VERSION: ${BUN_VERSION:-1.3.14}\n",
      [APP_ENV_TEMPLATE]: "IMAGE_REGISTRY=ghcr.io\n",
    })
    try {
      expect(
        checkComposeImageDefaults(dir, { compose: APP_COMPOSE, template: APP_ENV_TEMPLATE }),
      ).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("as duas stacks são cobertas (o repo real não gera violação)", () => {
    // O repositório de verdade: se isto quebrar, o guard está acusando o
    // próprio commit — e um guard vermelho no default é um guard desligado.
    expect(checkComposeImageDefaultsForRepo(REPO_ROOT)).toEqual([])
  })
})

// ── invariante 9(b): os DEMAIS defaults declarados do compose ──────────────

const PAIR_COMPOSE = "deploy/docker-compose.gitea.yml"
const PAIR_TEMPLATE = "deploy/env.gitea.example"
const linha = (valor: string) =>
  `      - GITEA__registry__ENABLED=\${GITEA__registry__ENABLED:-${valor}}\n`

function parDeclarado(template: string, compose: string): string {
  return treeOf({ [PAIR_TEMPLATE]: template, [PAIR_COMPOSE]: compose })
}

describe("defaults declarados do compose (o par default × valor do template)", () => {
  it("declarado nos dois lados com o MESMO valor não é violação", () => {
    const dir = parDeclarado(
      "GITEA__registry__ENABLED=true\n",
      `services:\n  gitea:\n    image: gitea/gitea:1.22\n    environment:\n${linha("true")}`,
    )
    expect(checkComposeValueDefaults(dir)).toEqual([])
  })

  it("o template sem a linha é violação — o default da SÉRIE vira a única fonte", () => {
    const dir = parDeclarado(
      "IMAGE_REGISTRY=git.severinno.cloud\n",
      `services:\n  gitea:\n    image: gitea/gitea:1.22\n    environment:\n${linha("true")}`,
    )
    const v = checkComposeValueDefaults(dir)
    expect(v).toHaveLength(1)
    expect(v[0]).toContain("não declara GITEA__registry__ENABLED")
    expect(v[0]).toContain(PAIR_TEMPLATE)
    // O diagnóstico traz o REMÉDIO (o valor a declarar, lido do default do
    // compose) e o PORQUÊ declarado pela tabela.
    expect(v[0]).toContain("`GITEA__registry__ENABLED=true`")
    expect(v[0]).toMatch(/etapa 1 do corte do GitHub/)
  })

  it("literal no compose (sem `${NOME:-…}`) é violação — o env do host não chega ao container", () => {
    const dir = parDeclarado(
      "GITEA__registry__ENABLED=true\n",
      "services:\n  gitea:\n    image: gitea/gitea:1.22\n    environment:\n      - GITEA__registry__ENABLED=true\n",
    )
    const v = checkComposeValueDefaults(dir)
    expect(v).toHaveLength(1)
    expect(v[0]).toContain("não consome GITEA__registry__ENABLED")
    expect(v[0]).toContain("literal no compose ignora o env do host")
  })

  it("default DIVERGENTE do declarado é violação (o host sem a variável sobe outro valor)", () => {
    const dir = parDeclarado(
      "GITEA__registry__ENABLED=true\n",
      `services:\n  gitea:\n    image: gitea/gitea:1.22\n    environment:\n${linha("false")}`,
    )
    const v = checkComposeValueDefaults(dir)
    expect(v).toHaveLength(1)
    expect(v[0]).toContain("o default de GITEA__registry__ENABLED é 'false'")
    expect(v[0]).toContain("declara 'true'")
  })

  it("o par do repositório REAL fecha: o registry embutido está DECLARADO, não herdado", () => {
    expect(COMPOSE_VALUE_DEFAULTS.length).toBeGreaterThan(0)
    expect(COMPOSE_VALUE_DEFAULTS.some((e) => e.name === "GITEA__registry__ENABLED")).toBe(true)
    expect(checkComposeValueDefaults(REPO_ROOT)).toEqual([])
    // E cada par da tabela aponta para arquivos que EXISTEM: uma tabela que
    // aponta para um caminho com erro de digitação seria uma declaração que
    // nenhuma guarda lê (o `continue` silencioso da função).
    for (const e of COMPOSE_VALUE_DEFAULTS) {
      expect(readFileSync(join(REPO_ROOT, e.compose), "utf8").length).toBeGreaterThan(0)
      expect(readFileSync(join(REPO_ROOT, e.template), "utf8").length).toBeGreaterThan(0)
      expect(e.why.length).toBeGreaterThan(30)
    }
  })
})

describe("invariante 9 — env do host da APLICAÇÃO x o template comitado", () => {
  it("host com os mesmos valores não gera violação (e diz quantas comparou)", () => {
    const dir = refsTree({}, { appHost: "IMAGE_REGISTRY=ghcr.io\nIMAGE_NAMESPACE=severinno\n" })
    try {
      const r = compareAppHostImageDeclarations(dir)
      expect(r.host).toBe(APP_ENV_HOSTS[0])
      expect(r.checked).toBe(2)
      expect(r.violations).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("host DIVERGENTE do template é violação (a app puxa de outro registry)", () => {
    const dir = refsTree({}, { appHost: "IMAGE_REGISTRY=git.severinno.cloud\n" })
    try {
      const r = compareAppHostImageDeclarations(dir)
      expect(r.violations).toHaveLength(1)
      expect(r.violations[0]).toContain("git.severinno.cloud")
      expect(r.violations[0]).toContain("ghcr.io")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("host que declara variável AUSENTE no template é violação (estado não reproduzível)", () => {
    // O template so declara o registry; o host declara tambem o namespace. Um
    // host novo (a partir do repositorio) nao teria essa variavel — o estado do
    // VPS deixa de ser reproduzivel.
    const dir = refsTree(
      { [APP_ENV_TEMPLATE]: "IMAGE_REGISTRY=ghcr.io\n" },
      { appHost: "IMAGE_REGISTRY=ghcr.io\nIMAGE_NAMESPACE=severinno\n" },
    )
    try {
      const r = compareAppHostImageDeclarations(dir)
      expect(r.violations).toHaveLength(1)
      expect(r.violations[0]).toContain("IMAGE_NAMESPACE")
      expect(r.violations[0]).toContain("reproduzivel")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("o host NAO declarar uma variavel do template NAO e violacao (o default do compose cobre, e ele e conferido)", () => {
    const dir = refsTree({}, { appHost: "IMAGE_REGISTRY=ghcr.io\n" })
    try {
      const r = compareAppHostImageDeclarations(dir)
      expect(r.violations).toEqual([])
      expect(r.checked).toBe(1)
      expect(r.declared).toEqual(["IMAGE_REGISTRY"])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("host que NÃO declara nenhuma das variáveis: nada a comparar (checked = 0, sem violação)", () => {
    const dir = refsTree({}, { appHost: "NODE_ENV=production\n" })
    try {
      const r = compareAppHostImageDeclarations(dir)
      expect(r.checked).toBe(0)
      expect(r.declared).toEqual([])
      expect(r.violations).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("sem arquivo de host (.env.production.local nem .env) não há o que comparar", () => {
    const dir = refsTree()
    try {
      expect(compareAppHostImageDeclarations(dir)).toEqual({
        violations: [],
        host: null,
        checked: 0,
        declared: [],
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("invariante 9 — o fato das referências não versionadas (sem rede)", () => {
  const run = (dir: string, opts: Record<string, unknown> = {}) =>
    checkNonVersionedImageRefs({ root: dir, env: {}, ...opts })

  it("os usos de `vars.*` saem do YAML das duas forjas, com o fallback anotado", () => {
    const dir = refsTree({
      [".github/workflows/x.yml"]:
        "jobs:\n  a:\n    steps:\n      - run: echo ${{ vars.IMAGE_REGISTRY || 'ghcr.io' }}\n      # - run: echo ${{ vars.IMAGE_NAMESPACE }} (comentário)\n",
    })
    try {
      const refs = forgeVariableRefs(dir)
      expect(
        refs.some((r) => r.file === ".github/workflows/x.yml" && r.variable === "IMAGE_REGISTRY"),
      ).toBe(true)
      // O fallback é registrado como o que o REPOSITÓRIO declara — nunca como o valor.
      expect(refs.find((r) => r.fallback !== null)?.fallback).toBe("ghcr.io")
      expect(refs.every((r) => !r.file.endsWith("(comentário)"))).toBe(true)
      expect(
        refs.some((r) => r.variable === "IMAGE_NAMESPACE" && r.file === ".github/workflows/x.yml"),
      ).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("o valor VIVO no ambiente confere com o declarado → proven", async () => {
    const dir = refsTree()
    try {
      const r = await run(dir, {
        env: { IMAGE_REGISTRY: "ghcr.io", BUN_VERSION: "1.3.14" },
        probe: probeStub("no-label"),
      })
      const registry = r.items.find((i) => i.source.includes("variable IMAGE_REGISTRY"))!
      expect(registry.state).toBe("proven")
      expect(registry.detail).toContain("confere com")
      // IMAGE_NAMESPACE não foi exportado: continua NÃO PROVADO (nunca por omissão).
      expect(r.items.find((i) => i.source.includes("variable IMAGE_NAMESPACE"))!.state).toBe(
        "indeterminate",
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("o valor do ambiente DIVERGINDO do declarado é violação, e nomeia o arquivo", async () => {
    const dir = refsTree()
    try {
      const r = await run(dir, { env: { IMAGE_REGISTRY: "git.severinno.cloud" } })
      expect(r.state).toBe("violated")
      expect(
        r.violations.some(
          (v) => v.includes("git.severinno.cloud") && v.includes("deploy/env.gitea.example"),
        ),
      ).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("sem o valor no ambiente: INDETERMINADO com o remédio escrito (nunca 'conforme')", async () => {
    const dir = refsTree()
    try {
      const r = await run(dir, { env: {} })
      const item = r.items.find((i) => i.source.includes("variable BUN_VERSION"))!
      expect(item.state).toBe("indeterminate")
      expect(item.detail).toContain("Settings -> Variables")
      expect(item.detail).toContain("rode onde a variavel existe")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("env do host AUSENTE é `absent` (não aplicável), e NÃO conta como não provado", async () => {
    const dir = refsTree()
    try {
      const r = await run(dir, { env: {}, probe: probeStub("proven") })
      const host = r.items.find((i) => i.source === "env do host deploy/.env.gitea")!
      expect(host.state).toBe("absent")
      expect(host.detail).toContain("NAO APLICAVEL")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("com o env da forja no checkout a tag sai DELE (o host manda); sem ele, do template comitado", async () => {
    const seen: string[] = []
    const dir = refsTree(
      {},
      { forgeHost: "IMAGE_REGISTRY=git.severinno.cloud\nIMAGE_NAMESPACE=ns\nBUN_VERSION=9.9.9\n" },
    )
    try {
      const r = await run(dir, {
        env: {},
        probe: async (ref: string) => {
          seen.push(ref)
          return { state: "proven", detail: "ok", digest: "sha256:x", version: "9.9.9" }
        },
      })
      expect(seen).toEqual(["git.severinno.cloud/ns/ubuntu-bun:9.9.9"])
      expect(r.items.some((i) => i.source.includes("registry") && i.state === "proven")).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
    const dir2 = refsTree()
    try {
      const seen2: string[] = []
      await run(dir2, {
        env: {},
        probe: async (ref: string) => {
          seen2.push(ref)
          return { state: "proven", detail: "ok", digest: null, version: "1.3.14" }
        },
      })
      expect(seen2).toEqual(["ghcr.io/severinno/ubuntu-bun:1.3.14"])
    } finally {
      rmSync(dir2, { recursive: true, force: true })
    }
  })

  it("o estado do registry é traduzido: proven → conforme, mismatch/missing → VIOLADO", async () => {
    const dir = refsTree()
    try {
      for (const state of ["mismatch", "missing"] as const) {
        const r = await run(dir, { env: {}, probe: probeStub(state) })
        expect(r.state, state).toBe("violated")
        expect(r.items.find((i) => i.source.includes("registry"))!.state, state).toBe("violated")
      }
      const missing = await run(dir, { env: {}, probe: probeStub("missing") })
      expect(missing.violations.join(" ")).toContain("runner-image:ensure")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("não-saber NUNCA vira violação: no-label/unauthorized/unreachable são NÃO PROVADOS", async () => {
    const dir = refsTree()
    try {
      for (const state of ["no-label", "unauthorized", "unreachable", "error"]) {
        const r = await run(dir, { env: {}, probe: probeStub(state) })
        expect(r.state, state).toBe("indeterminate")
        expect(r.violations, state).toEqual([])
        expect(r.items.find((i) => i.source.includes("registry"))!.detail, state).toContain(
          `[${state}]`,
        )
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("`probeRegistry: false` pula a consulta (o probe NÃO é chamado) e o passo vira ausente", async () => {
    const dir = refsTree()
    try {
      let called = 0
      const r = await run(dir, {
        probeRegistry: false,
        probe: async () => {
          called += 1
          return { state: "proven", detail: "nunca deveria rodar", digest: null, version: null }
        },
      })
      expect(called).toBe(0)
      const registry = r.items.find((i) => i.source.includes("registry"))!
      expect(registry.state).toBe("absent")
      expect(registry.detail).toContain("--no-registry-probe")
      // A tag declarada continua NOMEADA: pular a consulta não esconde qual era.
      expect(registry.detail).toContain("ghcr.io/severinno/ubuntu-bun:1.3.14")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("o env da app divergente entra na MESMA lista de violações", async () => {
    const dir = refsTree({}, { appHost: "IMAGE_REGISTRY=git.severinno.cloud\n" })
    try {
      const r = await run(dir, { env: {}, probe: probeStub("proven") })
      expect(r.state).toBe("violated")
      expect(r.violations.some((v) => v.startsWith("IMAGE_REGISTRY divergente"))).toBe(true)
      expect(r.items.find((i) => i.source.startsWith("env do host da aplicacao"))!.state).toBe(
        "violated",
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("o default do compose divergente entra na MESMA lista (é fato, não varredura estática)", async () => {
    const dir = refsTree({
      [APP_COMPOSE]: "services:\n  x:\n    image: ${IMAGE_REGISTRY:-ghcr.io}/x:latest\n",
      [APP_ENV_TEMPLATE]: "IMAGE_REGISTRY=git.severinno.cloud\nIMAGE_NAMESPACE=severinno\n",
    })
    try {
      const r = await run(dir, { env: {}, probe: probeStub("proven") })
      expect(r.state).toBe("violated")
      expect(r.violations.some((v) => v.includes(APP_COMPOSE))).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("os dois templates comitados discordando é violação (vale em qualquer checkout)", () => {
    const dir = refsTree({
      [APP_ENV_TEMPLATE]: "IMAGE_REGISTRY=git.severinno.cloud\nIMAGE_NAMESPACE=severinno\n",
    })
    try {
      expect(compareImageTemplates(dir)).toHaveLength(1)
      expect(compareImageTemplates(dir)[0]).toContain("git.severinno.cloud")
      expect(declaredImageValues(dir).map((d) => d.label)).toContain(APP_ENV_TEMPLATE)
      expect(REGISTRY_VARIABLES).toEqual(["IMAGE_REGISTRY", "IMAGE_NAMESPACE"])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// ── --require-image: contra um REGISTRY de TESTE (HTTP de verdade) ────────

/**
 * A pergunta que a flag responde: "o registro da imagem foi PROVADO?" — e a
 * única prova possível sobre a tag ser um apelido mutável vem do próprio
 * registry. Por isso o teste sobe um registry OCI mínimo em 127.0.0.1 e roda o
 * CLI de verdade: um dublê de `probe` provaria a função, não o gate.
 */
describe("--require-image (registry de TESTE, HTTP de verdade)", () => {
  const SCRIPT = join(REPO_ROOT, "scripts", "check-registry-source.mjs")

  /**
   * Registry mínimo: manifesto (200 só para a tag `tag`) + config blob com a
   * label OCI da versão SERVIDA (`version`). Os dois são SEPARADOS de propósito:
   * é a diferença entre eles que caracteriza um RE-TAG (a tag existe, mas aponta
   * para outra build). `null` → tudo 404 (a tag não existe).
   */
  function startRegistry(
    served: { tag: string; version?: string } | null,
  ): Promise<{ url: string; hits: string[]; close: () => Promise<void> }> {
    const hits: string[] = []
    const server = createServer((req, res) => {
      const url = req.url ?? ""
      hits.push(url)
      const manifest = url.match(/^\/v2\/(.+)\/manifests\/(.+)$/)
      if (manifest && served !== null && manifest[2] === served.tag) {
        res.writeHead(200, {
          "content-type": "application/json",
          "docker-content-digest": "sha256:MANIFEST",
        })
        res.end(JSON.stringify({ schemaVersion: 2, config: { digest: "sha256:CONFIG" } }))
        return
      }
      if (manifest) {
        res.writeHead(404, { "content-type": "application/json" })
        res.end("{}")
        return
      }
      if (/^\/v2\/.+\/blobs\/sha256:CONFIG$/.test(url)) {
        res.writeHead(200, { "content-type": "application/json" })
        res.end(
          JSON.stringify({
            config: {
              Labels: { "org.opencontainers.image.version": served?.version ?? served?.tag ?? "" },
            },
          }),
        )
        return
      }
      res.writeHead(500)
      res.end()
    })
    return new Promise((resolve, reject) => {
      server.on("error", reject)
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address()
        const port = typeof addr === "object" && addr ? addr.port : 0
        resolve({
          url: `http://127.0.0.1:${port}`,
          hits,
          close: () => new Promise((done) => server.close(() => done())),
        })
      })
    })
  }

  /** Árvore mínima: as referências da imagem vivem no env da forja (nenhum `vars.*`). */
  function imageTree(registryUrl: string): string {
    const dir = mkdtempSync(join(tmpdir(), "registry-image-"))
    const files: Record<string, string> = {
      "deploy/env.gitea.example": `IMAGE_REGISTRY=${registryUrl}\nIMAGE_NAMESPACE=ns\nBUN_VERSION=1.3.14\n`,
      ".actrc": `--var IMAGE_REGISTRY=${registryUrl}\n--var BUN_VERSION=1.3.14\n`,
    }
    for (const [rel, content] of Object.entries(files)) {
      const full = join(dir, rel)
      mkdirSync(join(full, ".."), { recursive: true })
      writeFileSync(full, content, "utf8")
    }
    return dir
  }

  /**
   * SPAWN ASSÍNCRONO, não `spawnSync` — e isso não é estilo.
   *
   * O registry de teste roda NESTE processo. Com `spawnSync` o event loop do
   * pai fica bloqueado enquanto o filho espera resposta: o servidor não atende,
   * o `fetch` do guard estoura o timeout e o resultado vira `unreachable` — o
   * teste mediria o bloqueio, não a regra. (A mesma armadilha já está
   * documentada em `prove-runner-image-gate.mjs`, medida lá com `spawn`+await.)
   */
  function runGuard(
    dir: string,
    args: string[],
    env: Record<string, string> = {},
  ): Promise<{ status: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      const child = spawn(process.execPath, [SCRIPT, "--no-compose-render", ...args], {
        cwd: dir,
        env: { ...process.env, ...env },
      })
      let stdout = ""
      let stderr = ""
      child.stdout.on("data", (d) => (stdout += String(d)))
      child.stderr.on("data", (d) => (stderr += String(d)))
      child.on("close", (status) => resolve({ status, stdout, stderr }))
    })
  }

  it("a tag declarada, servida na versão esperada → exit 0 (e o registry FOI consultado)", async () => {
    const reg = await startRegistry({ tag: "1.3.14" })
    const dir = imageTree(reg.url)
    try {
      const r = await runGuard(dir, ["--require-image"])
      expect(r.status, r.stderr).toBe(0)
      expect(r.stdout).toContain("serve a build que declara 1.3.14")
      expect(reg.hits.some((h) => h.includes("/manifests/1.3.14"))).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
      await reg.close()
    }
  })

  it("RE-TAG: a tag serve OUTRA versão → exit 1 (o que roda não é o que foi revisado)", async () => {
    const reg = await startRegistry({ tag: "1.3.14", version: "1.3.13" })
    const dir = imageTree(reg.url)
    try {
      const r = await runGuard(dir, ["--require-image"])
      expect(r.status).toBe(1)
      expect(r.stderr).toContain("re-tag")
      expect(r.stderr).toContain("1.3.13")
    } finally {
      rmSync(dir, { recursive: true, force: true })
      await reg.close()
    }
  })

  it("tag AUSENTE no registry → exit 1, com o remédio nomeado", async () => {
    const reg = await startRegistry(null)
    const dir = imageTree(reg.url)
    try {
      const r = await runGuard(dir, ["--require-image"])
      expect(r.status).toBe(1)
      expect(r.stderr).toContain("HTTP 404")
      expect(r.stderr).toContain("runner-image:ensure")
    } finally {
      rmSync(dir, { recursive: true, force: true })
      await reg.close()
    }
  })

  it("com credencial ausente o registry responde 401: NÃO PROVADO — portátil sai 0, a flag falha", async () => {
    // Um registry que exige Bearer sem credencial no ambiente: o guard não pode
    // chamar isso de "errado" (não sabe), mas com --require-image não pode
    // chamar de provado tampouco.
    const hits: string[] = []
    const server = createServer((req, res) => {
      hits.push(req.url ?? "")
      res.writeHead(401, {
        "content-type": "application/json",
        "www-authenticate": 'Bearer realm="http://127.0.0.1:1/token"',
      })
      res.end("{}")
    })
    const reg = await new Promise<{ url: string; close: () => Promise<void> }>(
      (resolve, reject) => {
        server.on("error", reject)
        server.listen(0, "127.0.0.1", () => {
          const addr = server.address()
          const port = typeof addr === "object" && addr ? addr.port : 0
          resolve({
            url: `http://127.0.0.1:${port}`,
            close: () => new Promise((done) => server.close(() => done())),
          })
        })
      },
    )
    const dir = imageTree(reg.url)
    // Sem credencial NENHUMA: um 401 aqui tem de ser "não sei", não "está
    // errado" — e o ambiente do runner pode ter token, então o teste o limpa.
    const noCreds = {
      GHCR_TOKEN: "",
      GITHUB_TOKEN: "",
      GH_TOKEN: "",
      GHCR_USER: "",
      GITHUB_ACTOR: "",
    }
    try {
      const portable = await runGuard(dir, [], noCreds)
      expect(portable.status, portable.stderr).toBe(0)
      expect(portable.stdout).toContain("NAO PROVADA")
      expect(portable.stdout).toContain("[unauthorized]")

      const strict = await runGuard(dir, ["--require-image"], noCreds)
      expect(strict.status).toBe(1)
      expect(strict.stderr).toContain("--require-image")
      expect(strict.stderr).toContain("pior que um vermelho")
    } finally {
      rmSync(dir, { recursive: true, force: true })
      await reg.close()
    }
  })

  it("--require-image com --no-registry-probe é uso inválido (exit 3, sem precedência silenciosa)", async () => {
    const dir = imageTree("ghcr.io")
    try {
      const r = await runGuard(dir, ["--require-image", "--no-registry-probe"])
      expect(r.status).toBe(3)
      expect(r.stderr).toContain("contraditorias")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// ── invariante 9: a VARREDURA (todo compose, shell e script JS) ─────────────
//
// A comparação por PAR sabe QUAL template é a fonte de cada stack declarada; a
// varredura cobre o que NÃO tem par — um compose novo, um shell, um script JS,
// o fallback de um workflow. Sem ela, uma stack que ninguém cadastrou entra com
// o default velho e nada fica vermelho (a imagem velha continua existindo no
// registry velho: o pull funciona, só puxa do lugar errado).

describe("invariante 9 — a VARREDURA dos defaults embutidos", () => {
  /** Árvore sintética com os arquivos que a varredura lê. */
  const sweepTree = (files: Record<string, string>) => {
    const dir = mkdtempSync(join(tmpdir(), "registry-sweep-"))
    for (const [rel, content] of Object.entries(files)) {
      const full = join(dir, rel)
      mkdirSync(join(full, ".."), { recursive: true })
      writeFileSync(full, content, "utf8")
    }
    return dir
  }

  /** Os dois valores declarados, no template que a leitura do espelho encontra. */
  const DECLARADO = {
    [APP_ENV_TEMPLATE]: "IMAGE_REGISTRY=ghcr.io\nIMAGE_NAMESPACE=severinno\n",
  }

  /** Um compose de stack NÃO declarada (não tem par) — o caso que vivia fora. */
  const COMPOSE_SEM_PAR = "services:\n  x:\n    image: ${IMAGE_REGISTRY:-ghcr.io}/x/y:latest\n"

  const withTree = <T>(files: Record<string, string>, fn: (dir: string) => T): T => {
    const dir = sweepTree(files)
    try {
      return fn(dir)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  it("um compose SEM PAR entra na varredura — e o default divergente acusa", () => {
    withTree(
      {
        ...DECLARADO,
        "docker-compose.hostinger.yml": COMPOSE_SEM_PAR.replace("ghcr.io", "registry.velho"),
      },
      (dir) => {
        const r = sweepImageDefaultValues(dir)
        expect(r.violations).toHaveLength(1)
        expect(r.violations[0]).toContain("docker-compose.hostinger.yml")
        expect(r.violations[0]).toContain("registry.velho")
        expect(r.violations[0]).toContain("ghcr.io")
        expect(r.files).toContain("docker-compose.hostinger.yml")
      },
    )
  })

  it("o mesmo compose com o valor DECLARADO não acusa (e conta como comparado)", () => {
    withTree({ ...DECLARADO, "docker-compose.hostinger.yml": COMPOSE_SEM_PAR }, (dir) => {
      const r = sweepImageDefaultValues(dir)
      expect(r.violations).toEqual([])
      expect(r.compared).toBeGreaterThan(0)
    })
  })

  it("os dois pares DECLARADOS não são relatados duas vezes (é a comparação por par que os julga)", () => {
    withTree(
      {
        ...DECLARADO,
        [APP_COMPOSE]: COMPOSE_SEM_PAR.replace("ghcr.io", "registry.velho"),
      },
      (dir) => {
        // A varredura não acusa: quem acusa este arquivo é o guard do par (que
        // sabe qual template é a fonte dele) — o mesmo defeito em duas listas
        // faria o relatório mentir sobre quantos arquivos estão errados.
        expect(sweepImageDefaultValues(dir).violations).toEqual([])
        expect(
          checkComposeImageDefaults(dir, { compose: APP_COMPOSE, template: APP_ENV_TEMPLATE }),
        ).toHaveLength(1)
      },
    )
  })

  it("um SCRIPT SHELL entra pela mesma régua de valor", () => {
    withTree(
      { ...DECLARADO, "deploy/pull.sh": "docker pull ${IMAGE_REGISTRY:-ghcr.io}/x/y:1\n" },
      (dir) => {
        expect(sweepImageDefaultValues(dir).violations).toEqual([])
      },
    )
    withTree(
      { ...DECLARADO, "deploy/pull.sh": "docker pull ${IMAGE_REGISTRY:-registry.velho}/x/y:1\n" },
      (dir) => {
        const r = sweepImageDefaultValues(dir)
        expect(r.violations).toHaveLength(1)
        expect(r.violations[0]).toContain("deploy/pull.sh")
      },
    )
  })

  it("um SCRIPT JS com default literal é violação MESMO com o valor certo (há resolvedor)", () => {
    withTree(
      {
        ...DECLARADO,
        "scripts/x.mjs": 'const r = process.env.IMAGE_REGISTRY || "ghcr.io"\n',
      },
      (dir) => {
        const r = sweepImageDefaultValues(dir)
        expect(r.violations).toHaveLength(1)
        expect(r.violations[0]).toContain("use o RESOLVEDOR")
        expect(r.violations[0]).toContain("registry-source.mjs")
        // O valor está CERTO (confere com o declarado): a violação é a existência
        // do literal — ele é o que envelhece no dia da próxima migração.
        expect(r.violations[0]).not.toContain("já diverge")
      },
    )
  })

  it("o mesmo literal divergente diz as duas coisas (a forma E o valor)", () => {
    withTree(
      {
        ...DECLARADO,
        "scripts/x.mjs": 'const r = process.env.IMAGE_REGISTRY || "registry.velho"\n',
      },
      (dir) => {
        expect(sweepImageDefaultValues(dir).violations[0]).toContain("já diverge")
      },
    )
  })

  it("COMENTÁRIO em script JS não é código: nem `//`, nem o `*` de doc", () => {
    withTree(
      {
        ...DECLARADO,
        "scripts/x.mjs": [
          '// o default antigo era process.env.IMAGE_REGISTRY || "registry.velho"',
          "/*",
          " * e o compose usava ${IMAGE_REGISTRY:-registry.velho}",
          " */",
          'const ok = 1 // process.env.IMAGE_REGISTRY || "outro"',
        ].join("\n"),
      },
      (dir) => {
        const r = sweepImageDefaultValues(dir)
        expect(r.violations).toEqual([])
        expect(r.prose).toBe(0) // prosa não é default NEM prosa contada: é comentário
      },
    )
  })

  it("`${NOME:-x}` dentro de MENSAGEM de script JS é PROSA — contada, não comparada", () => {
    withTree(
      {
        ...DECLARADO,
        "scripts/x.mjs":
          "console.error(`declare IMAGE_REGISTRY (ex.: ${IMAGE_REGISTRY:-ghcr.io})`)\n",
      },
      (dir) => {
        const r = sweepImageDefaultValues(dir)
        // Não é default (não há valor rodando para envelhecer) e também não é
        // silêncio: o relatório diz quantas ocorrências ficaram fora.
        expect(r.violations).toEqual([])
        expect(r.prose).toBe(1)
        expect(r.compared).toBe(0)
      },
    )
  })

  it("uma URL `//` numa string NÃO engole o código que vem depois", () => {
    // O falso NEGATIVO é a classe proibida: cortar a linha no `//` de uma URL
    // esconderia o default que vive no resto dela.
    withTree(
      {
        ...DECLARADO,
        "scripts/x.mjs":
          'const u = "https://exemplo/x" + (process.env.IMAGE_REGISTRY || "registry.velho")\n',
      },
      (dir) => {
        const r = sweepImageDefaultValues(dir)
        expect(r.violations).toHaveLength(1)
        expect(r.violations[0]).toContain("registry.velho")
      },
    )
  })

  it("literal VAZIO não é default (não há valor para envelhecer)", () => {
    withTree(
      {
        ...DECLARADO,
        "scripts/x.mjs": 'const r = process.env.IMAGE_REGISTRY || ""\n',
        "deploy/y.sh": "docker pull ${IMAGE_REGISTRY:-}/x:1\n",
      },
      (dir) => {
        const r = sweepImageDefaultValues(dir)
        expect(r.violations).toEqual([])
        expect(r.compared).toBe(0)
      },
    )
  })

  it("sem espelho declarando a variável o default é INDETERMINADO (nunca um ✅ por omissão)", () => {
    withTree({ "docker-compose.hostinger.yml": COMPOSE_SEM_PAR }, (dir) => {
      const r = sweepImageDefaultValues(dir)
      expect(r.violations).toEqual([])
      expect(r.indeterminate).toHaveLength(1)
      expect(r.indeterminate[0]).toContain("não há contra o que comparar")
      expect(r.indeterminate[0]).toContain(".env.production.example")
    })
  })

  it("o fallback LITERAL de workflow é comparado por valor; o DINÂMICO é contado, não julgado", () => {
    const workflow = (expr: string) => "jobs:\n  x:\n    steps:\n      - run: echo " + expr + "\n"
    withTree(
      {
        ...DECLARADO,
        ".gitea/workflows/ci.yml": workflow("${{ vars.IMAGE_REGISTRY || 'ghcr.io' }}"),
      },
      (dir) => {
        expect(sweepImageDefaultValues(dir).violations).toEqual([])
      },
    )
    withTree(
      {
        ...DECLARADO,
        ".gitea/workflows/ci.yml": workflow("${{ vars.IMAGE_REGISTRY || 'registry.velho' }}"),
      },
      (dir) => {
        const r = sweepImageDefaultValues(dir)
        expect(r.violations).toHaveLength(1)
        expect(r.violations[0]).toContain("registry.velho")
      },
    )
    withTree(
      {
        ...DECLARADO,
        ".gitea/workflows/ci.yml": workflow(
          "${{ vars.IMAGE_REGISTRY || github.repository_owner }}",
        ),
      },
      (dir) => {
        const r = sweepImageDefaultValues(dir)
        // Não é afirmação de valor: é CONTADO como fora da comparação.
        expect(r.violations).toEqual([])
        expect(r.dynamic).toBe(1)
      },
    )
  })

  it("a GRAFIA do fallback não é julgada: `\"x\"` vale o MESMO que `'x'`", () => {
    // A sintaxe do arquivo de CI não decide o veredito — o VALOR decide. Antes,
    // a alternativa do token cru engolia as aspas duplas e o item saía
    // `fallback: null` (contado como DINÂMICO): o default divergente passava em
    // silêncio, e o pior é que o relatório dizia "dinâmico", não "não julguei".
    const workflow = (grafo: string) =>
      "jobs:\n  x:\n    steps:\n      - run: echo $" +
      "{{ vars.IMAGE_REGISTRY || " +
      grafo +
      " }}\n"
    withTree(
      {
        ...DECLARADO,
        ".gitea/workflows/ci.yml": workflow('"registry.velho"'),
      },
      (dir) => {
        const r = sweepImageDefaultValues(dir)
        expect(r.violations).toHaveLength(1)
        expect(r.violations[0]).toContain("registry.velho")
        expect(r.violations[0]).toContain("ghcr.io")
        // Julgado por VALOR: não sobra nenhum "dinâmico" a que atribuir o verde.
        expect(r.compared).toBe(1)
        expect(r.dynamic).toBe(0)
      },
    )
    withTree(
      {
        ...DECLARADO,
        ".gitea/workflows/ci.yml": workflow('"ghcr.io"'),
      },
      (dir) => {
        // A MESMA grafia com o valor declarado é verde — a régua não acusa a
        // forma, e é essa metade que impede a correção de virar falso positivo.
        expect(sweepImageDefaultValues(dir).violations).toEqual([])
      },
    )
    withTree(
      {
        ...DECLARADO,
        ".gitea/workflows/ci.yml": workflow("'ghcr.io'"),
      },
      (dir) => {
        // E a grafia já vista continua valendo o mesmo: as duas são o MESMO caso.
        expect(sweepImageDefaultValues(dir).violations).toEqual([])
      },
    )
  })

  it("a varredura julga os TIPOS da TABELA — um nome fora dela não é inventado", () => {
    // O tipo novo não entra por adivinhação: entra pela TABELA
    // (`NON_VERSIONED_IMAGE_VARIABLES`). Um nome que ela não declara fica FORA
    // do julgamento — nem acusado por um valor que não é dele, nem contado como
    // dinâmico (a contagem é de fallback de variável CONHECIDA): o escopo é
    // declarado, e quem o estende é a tabela. A metade positiva (o tipo que
    // entra só pela tabela e passa a ser julgado) é medida por execução na
    // prova por mutação, que é onde a tabela pode ser estendida sem mentir.
    withTree(
      {
        ...DECLARADO,
        ".gitea/workflows/ci.yml":
          "jobs:\n  x:\n    steps:\n      - run: echo $" + '{{ vars.IMAGE_TAG || "1.3.14" }}\n',
        // O arquivo que DECLARA a tag existe: não é a ausência de espelho que
        // deixa o ref fora — é o tipo não estar na tabela.
        ".env.tag.example": "IMAGE_TAG=1.4.0\n",
      },
      (dir) => {
        const r = sweepImageDefaultValues(dir)
        expect(r.violations).toEqual([])
        expect(r.compared).toBe(0)
        expect(r.dynamic).toBe(0)
      },
    )
  })

  it("a forma de default vale por FAMÍLIA: o texto de outra família é prosa, não valor", () => {
    // As quatro famílias, cada uma com o SEU defeito (a mesma divergência), e
    // depois a versão CRUZADA: o texto de uma família dentro do arquivo de
    // outra. Cruzado não é default — é prosa (o payload de um teste, a mensagem
    // de um erro) — e contá-lo como valor foi um defeito REAL do guard: ele
    // acusava o `printf` de um script shell como se fosse o fallback do YAML.
    withTree(
      {
        ...DECLARADO,
        "docker-compose.hostinger.yml": COMPOSE_SEM_PAR.replace("ghcr.io", "registry.velho"),
        "deploy/pull.sh": "docker pull ${IMAGE_REGISTRY:-registry.velho}/x/y:1\n",
        "scripts/x.mjs": 'const r = process.env.IMAGE_REGISTRY || "registry.velho"\n',
        ".gitea/workflows/ci.yml":
          "jobs:\n  x:\n    steps:\n      - run: echo ${{ vars.IMAGE_REGISTRY || 'registry.velho' }}\n",
      },
      (dir) => {
        expect(sweepImageDefaultValues(dir).violations).toHaveLength(4)
      },
    )
    withTree(
      {
        ...DECLARADO,
        // `${NOME:-valor}` num `.mjs` (mensagem) e `vars.NOME || 'valor'` num
        // `.sh` (payload de prova): nenhum dos dois é default daquela família.
        "scripts/x.mjs": "console.error(`declare ${IMAGE_REGISTRY:-registry.velho}`)\n",
        "deploy/y.sh": "printf 'echo ${{ vars.IMAGE_REGISTRY || 'registry.velho' }}'\n",
      },
      (dir) => {
        const r = sweepImageDefaultValues(dir)
        expect(r.violations).toEqual([])
        expect(r.compared).toBe(0)
        expect(r.prose).toBe(2)
      },
    )
  })

  it("o repositório REAL não tem nenhum default divergente (e o verde não vem por vazio)", () => {
    const r = sweepImageDefaultValues(REPO_ROOT)
    expect(r.violations).toEqual([])
    expect(r.compared).toBeGreaterThan(0)
    expect(r.files.length).toBeGreaterThan(0)
  })

  it("os arquivos de PROVA POR MUTAÇÃO são fixture DECLARADO — e a exclusão é estreita", () => {
    // O texto de uma prova por mutação é o PAYLOAD que alimenta o guard: julgá-lo
    // seria o guard acusando o teste que o exercita — e a saída do autor seria
    // mutar o fixture para escapar da régua (cegando o guard onde ele é medido).
    expect(imageDefaultFixtureRule("scripts/test-mutation-registry-defaults.sh")).not.toBeNull()
    expect(imageDefaultFixtureRule("scripts/test-mutation-registry-defaults.sh")!.reason).toContain(
      "PAYLOAD",
    )
    // ESTREITA: um `deploy/*.sh` ou um `scripts/*.mjs` com o mesmo texto é
    // julgado (é o CONTROLE B3/B2 da prova por mutação).
    expect(imageDefaultFixtureRule("deploy/pull.sh")).toBeNull()
    expect(imageDefaultFixtureRule("scripts/check-registry-source.mjs")).toBeNull()
    expect(imageDefaultFixtureRule("scripts/test-mutation-registry-defaults.mjs")).toBeNull()

    const r = sweepImageDefaultValues(REPO_ROOT)
    expect(r.fixtures.length).toBeGreaterThan(0)
    // As duas listas são DISJUNTAS: o que foi varrido não é o que foi excluído.
    expect(r.fixtures.filter((f) => r.files.includes(f))).toEqual([])
  })
})
