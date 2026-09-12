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
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import {
  THIRD_PARTY_ALLOWLIST,
  checkActrc,
  checkComposeImageLine,
  checkRegistryLine,
  collectFiles,
  findViolations,
  isCommentLine,
  isRegistryVariableForm,
  stripInlineComment,
} from "../../../scripts/check-registry-source.mjs"

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

  it("varre os sites de resolução (compose, workflows, actions, woodpecker)", () => {
    const files = collectFiles(ROOT)
    for (const expected of [
      "docker-compose.prod.yml",
      "docker-compose.hostinger.yml",
      ".github/workflows/deploy.yml",
      ".github/workflows/release-deploy.yml",
      ".github/actions/setup-bun/action.yml",
      ".woodpecker.yml",
    ]) {
      expect(files).toContain(expected)
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
 */
describe("CLI (exit code)", () => {
  const SCRIPT = join(process.cwd(), "scripts", "check-registry-source.mjs")

  function runIn(tree: Record<string, string>) {
    const dir = mkdtempSync(join(tmpdir(), "registry-source-"))
    try {
      for (const [rel, content] of Object.entries(tree)) {
        const full = join(dir, rel)
        mkdirSync(join(full, ".."), { recursive: true })
        writeFileSync(full, content)
      }
      return spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: "utf8" })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

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
