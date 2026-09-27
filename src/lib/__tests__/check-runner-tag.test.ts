// =============================================================================
// check-runner-tag.test.ts
//
// Testes do guard da TAG da imagem do act_runner (scripts/check-runner-tag.mjs):
// a declaração do compose tem de Pinar — tag de versão (`0.6.1`) ou digest.
//
// Padrão do repo: funções PURAS testadas com conteúdo sintético + asserções
// contra o arquivo REAL do repositório (o que vale é o guard que roda aqui).
//
// A régua ("a tag declara versão?") NÃO é reimplementada aqui: ela é do
// `check-runner-labels.mjs`, e o que este arquivo prende é a DECISÃO do guard
// novo sobre ela (o vocabulário dos estados, os limites e o fail-closed).
// =============================================================================

import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { GITEA_COMPOSE } from "../../../scripts/check-bun-mirror.mjs"
import {
  EXIT,
  checkRunnerTag,
  exitCodeFor,
  judgeDeclaration,
  parseArgs,
  runnerServiceImage,
} from "../../../scripts/check-runner-tag.mjs"

const ROOT = process.cwd()
const COMPOSE_TEXT = readFileSync(join(ROOT, GITEA_COMPOSE), "utf8")

/** Um compose mínimo com o serviço do runner e a imagem dada. */
function compose(image: string): string {
  return [
    "services:",
    "  gitea:",
    "    image: gitea/gitea:1.22",
    "  runner:",
    "    image: " + image,
    "    container_name: gitea-runner",
    "  outro:",
    "    image: outro/servico:9.9.9",
    "",
  ].join("\n")
}

describe("runnerServiceImage — o bloco do serviço delimitado pela indentação", () => {
  it("lê o `image:` do runner, e não o do vizinho", () => {
    const found = runnerServiceImage(compose("gitea/act_runner:0.6.1"))
    expect(found.ok).toBe(true)
    expect(found.image).toBe("gitea/act_runner:0.6.1")
    expect(found.line).toBe(5)
  })

  it("desconta comentário de fim de linha e NÃO responde por linha comentada", () => {
    const comComentario = [
      "services:",
      "  runner:",
      "    # image: gitea/act_runner:latest",
      "    image: gitea/act_runner:0.6.1 # pin medido",
      "",
    ].join("\n")
    expect(runnerServiceImage(comComentario).image).toBe("gitea/act_runner:0.6.1")
  })

  it("não atravessa o fim do bloco (o `image:` de outro serviço não responde)", () => {
    const semImagem = [
      "services:",
      "  runner:",
      "    container_name: gitea-runner",
      "  gitea:",
      "    image: gitea/gitea:1.22",
      "",
    ].join("\n")
    const found = runnerServiceImage(semImagem)
    expect(found.ok).toBe(false)
    expect(found.detail).toContain("não declara `image:`")
  })

  it("serviço ausente é dito, não presumido", () => {
    const found = runnerServiceImage("services:\n  gitea:\n    image: gitea/gitea:1.22\n")
    expect(found.ok).toBe(false)
    expect(found.detail).toContain("runner")
  })
})

describe("judgeDeclaration — o vocabulário, e o que NÃO é violação", () => {
  it("tag de versão (com e sem `v`) é `proven`", () => {
    expect(judgeDeclaration("gitea/act_runner:0.6.1").state).toBe("proven")
    expect(judgeDeclaration("gitea/act_runner:v0.6.1").state).toBe("proven")
    expect(judgeDeclaration("git.severinno.cloud/ns/runner:1.2").state).toBe("proven")
  })

  // O título é ÂNCORA do mutation test (`test-mutation-runner-tag.sh`): a metade
  // M1 desliga esta régua e exige este caso VERMELHO pelo nome.
  it("UMA TAG QUE NÃO É VERSÃO É VIOLAÇÃO: `latest`/`stable`/`main` e a imagem SEM tag", () => {
    expect(judgeDeclaration("gitea/act_runner:latest").state).toBe("floating")
    expect(judgeDeclaration("gitea/act_runner:stable").state).toBe("floating")
    expect(judgeDeclaration("gitea/act_runner:main").state).toBe("floating")
    const semTag = judgeDeclaration("gitea/act_runner")
    expect(semTag.state).toBe("floating")
    expect(semTag.detail).toContain("latest")
  })

  it("um registry com PORTA não vira tag (a régua do `imageTag` é reusada)", () => {
    // `localhost:5000/runner` não tem tag: o `:` do host não separa tag.
    expect(judgeDeclaration("localhost:5000/runner").state).toBe("floating")
    expect(judgeDeclaration("localhost:5000/runner:0.6.1").state).toBe("proven")
  })

  it("digest é `digest` (imutável) — e NÃO é acusado de não declarar versão", () => {
    const julgado = judgeDeclaration(`gitea/act_runner@sha256:${"a".repeat(64)}`)
    expect(julgado.state).toBe("digest")
    expect(julgado.digest).toBe(`sha256:${"a".repeat(64)}`)
  })

  it("valor interpolado é `interpolated`: o pin sairia do texto do repositório", () => {
    const julgado = judgeDeclaration("gitea/act_runner:${ACT_RUNNER_VERSION}")
    expect(julgado.state).toBe("interpolated")
    expect(julgado.detail).toContain("declare a versão aqui")
  })

  it("imagem vazia é `no-image`", () => {
    expect(judgeDeclaration("").state).toBe("no-image")
    expect(judgeDeclaration("   ").state).toBe("no-image")
  })
})

describe("checkRunnerTag — a decisão sobre o texto", () => {
  it("compose com tag de versão: `proven`, sem violação", () => {
    const r = checkRunnerTag({ text: compose("gitea/act_runner:0.6.1") })
    expect(r.state).toBe("proven")
    expect(r.violations).toEqual([])
    expect(r.info.tag).toBe("0.6.1")
    expect(exitCodeFor(r)).toBe(EXIT.OK)
  })

  it("`latest` é VIOLAÇÃO com o remédio ESCRITO (a classe medida)", () => {
    const r = checkRunnerTag({ text: compose("gitea/act_runner:latest") })
    expect(r.state).toBe("violated")
    expect(r.violations).toHaveLength(1)
    // O texto do remédio é o que o operador lê: tem de nomear o comando.
    expect(r.violations[0]).toContain("gitea-up.sh --re-register")
    expect(r.violations[0]).toContain("docker compose pull")
    expect(exitCodeFor(r)).toBe(EXIT.VIOLATION)
  })

  it("imagem sem tag também é violação (o `latest` implícito)", () => {
    const r = checkRunnerTag({ text: compose("gitea/act_runner") })
    expect(r.state).toBe("violated")
    expect(r.violations[0]).toContain("latest")
  })

  it("digest PASSA com aviso: o pin é mais forte, mas não declara versão", () => {
    const r = checkRunnerTag({ text: compose(`gitea/act_runner@sha256:${"b".repeat(64)}`) })
    expect(r.state).toBe("proven")
    expect(r.warnings).toHaveLength(1)
    expect(r.warnings[0]).toContain("runner-labels:check")
  })

  it("serviço do runner sem imagem é violação (não é verde por omissão)", () => {
    const r = checkRunnerTag({
      text: ["services:", "  runner:", "    container_name: gitea-runner", ""].join("\n"),
    })
    expect(r.state).toBe("violated")
    expect(r.info.verdict).toBe("no-image")
  })

  it("o render não é consultado: sem o compose, o estado é INFRA (fail-closed)", () => {
    const r = checkRunnerTag({ root: "/tmp/nao-existe-check-runner-tag" })
    expect(r.state).toBe("infra")
    expect(exitCodeFor(r)).toBe(EXIT.INFRA)
  })
})

describe("o compose REAL deste repositório", () => {
  it("a imagem do runner PINA uma versão (a guarda contra a volta do `latest`)", () => {
    const r = checkRunnerTag({ root: ROOT })
    expect(r.state).toBe("proven")
    expect(r.info.image).toBe("gitea/act_runner:0.6.1")
    expect(r.info.verdict).toBe("proven")
    expect(r.violations).toEqual([])
  })

  it("o relatório diz a LINHA certa do compose (o diagnóstico é verificável)", () => {
    const r = checkRunnerTag({ root: ROOT })
    expect(r.info.line).toBeGreaterThan(0)
    // A linha publicada é a que o arquivo REAL tem (não uma contagem de memória).
    const linhas = COMPOSE_TEXT.split("\n")
    expect(linhas[(r.info.line ?? 0) - 1].trim()).toBe(`image: ${r.info.image}`)
  })
})

describe("parseArgs / exitCodeFor — o contrato da CLI", () => {
  it("defaults e as flags", () => {
    expect(parseArgs([]).root).toBe(process.cwd())
    expect(parseArgs(["--json"]).json).toBe(true)
    expect(parseArgs(["--root", "/tmp/x"]).root).toBe("/tmp/x")
    expect(parseArgs(["--root"]).error).toContain("--root")
    expect(parseArgs(["--banana"]).error).toContain("desconhecido")
  })

  it("a escala da família", () => {
    expect(exitCodeFor({ state: "proven" })).toBe(EXIT.OK)
    expect(exitCodeFor({ state: "violated" })).toBe(EXIT.VIOLATION)
    expect(exitCodeFor({ state: "infra" })).toBe(EXIT.INFRA)
  })
})
