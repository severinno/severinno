/**
 * runner-shells.test.ts
 *
 * Testes do `scripts/runner-shells.mjs` — o módulo dono da MEDIÇÃO dos shells
 * da imagem do runner, que o gate importa e o cron semanal re-executa.
 *
 * O que precisa ser provado (a medição é a régua do veredito do gate, e uma
 * medição mentirosa é pior que um gate nenhum):
 *   1. o comando DECLARADO é GERADO do mesmo probe que a medição executa (não
 *      existe cópia: o `--shells` do gate imprime o que o cron roda);
 *   2. o PARSER não engole o que não entende — a linha ilegível fica contada, e
 *      um nome que o probe não perguntou é desvio, não resposta;
 *   3. FAIL-CLOSED: sem docker, sem `docker run` OK, sem ref ou sem saída, o
 *      estado é `unavailable` com o MOTIVO — nunca "a imagem não tem nada", que
 *      abriria issue de tudo;
 *   4. as CINCO CLASSES de drift, cada uma com a direção do erro dita (a
 *      perigosa é "declarado presente, medido ausente": o gate PASSARIA um passo
 *      que morre com `command not found`);
 *   5. a COBERTURA nos dois sentidos: o que a declaração afirma tem de ser
 *      perguntado, e o que é perguntado tem de ser usado por alguma declaração;
 *   6. a assinatura é ESTÁVEL na ordem (o dedup do ticket não vira ruído).
 *
 * Sem docker: a medição recebe um dublê de `spawnSync` — o único caminho que um
 * teste unitário não pode exercitar é o binário real, e é ele que o job semanal
 * roda de verdade.
 */

import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { describe, expect, it } from "vitest"

import {
  ABSENT_TOKEN,
  RUNNER_IMAGE,
  RUNNER_SHELLS,
  RUNNER_SHELLS_MISSING,
  SHELLS_PROBED,
  measureShells,
  parseArgs,
  parseProbeOutput,
  probeArgv,
  probeCommandText,
  probeScript,
  runnerImageRef,
  shellsDriftReport,
} from "../../../scripts/runner-shells.mjs"
// A ref da imagem é DERIVADA do declarado: cravar o registry aqui faria este
// teste medir o valor de ontem (e verde é o que ele não pode dar por engano).
import { declaredImageValue } from "../../../scripts/registry-source.mjs"

const ROOT = process.cwd()
const DECLARED_REGISTRY = declaredImageValue(ROOT, "IMAGE_REGISTRY")?.value ?? ""
const DECLARED_NAMESPACE = declaredImageValue(ROOT, "IMAGE_NAMESPACE")?.value ?? ""

const SCRIPT = resolve(process.cwd(), "scripts/runner-shells.mjs")
const DECLARED = RUNNER_SHELLS as Record<string, string>

/**
 * O MOTIVO de uma medição que não aconteceu — com a afirmação de que ela de fato
 * NÃO mediu (o estado é o que separa "não consegui" de "a imagem não tem nada"),
 * e devolvido como string para o teste poder citá-lo.
 */
function motivoDe(medicao: { state: string; detail?: string }): string {
  expect(medicao.state).toBe("unavailable")
  return medicao.detail ?? ""
}

/** O probe respondendo exatamente a declaração vigente (o caso verde). */
function declaredProbeOutput(): string {
  const linhas = SHELLS_PROBED.map((nome) => {
    const caminho = Object.prototype.hasOwnProperty.call(DECLARED, nome)
      ? DECLARED[nome]
      : ABSENT_TOKEN
    return `${nome.padEnd(12)} ${caminho}`
  })
  return `${linhas.join("\n")}\n`
}

/**
 * O dublê do `docker`: responde por SUBCOMANDO (`run` = o probe, `image
 * inspect` = o digest). `spawnError` simula o docker AUSENTE (o que o
 * `spawnSync` devolve com ENOENT) e `throwOn` o erro de spawn cru.
 */
function dockerDouble({
  probe = declaredProbeOutput(),
  probeStatus = 0,
  probeStderr = "",
  digest = RUNNER_IMAGE.digest,
  digestStatus = 0,
  spawnError,
  throwOn = false,
}: {
  probe?: string
  probeStatus?: number
  probeStderr?: string
  digest?: string
  digestStatus?: number
  spawnError?: { code: string }
  throwOn?: boolean
} = {}) {
  const calls: { cmd: string; args: string[] }[] = []
  const run = (cmd: string, args: string[]) => {
    calls.push({ cmd, args })
    if (throwOn) throw Object.assign(new Error("spawn docker ENOENT"), { code: "ENOENT" })
    if (spawnError) return { status: null, stdout: "", stderr: "", error: spawnError }
    if (args[0] === "run") return { status: probeStatus, stdout: probe, stderr: probeStderr }
    if (args[0] === "image") {
      return { status: digestStatus, stdout: digest === "" ? "" : `repo@${digest}\n`, stderr: "" }
    }
    return { status: 0, stdout: "", stderr: "" }
  }
  return { run, calls }
}

/** Uma medição sintética (o dublê devolvendo o conjunto que o teste quer). */
function medicao(present: Record<string, string>, missing: string[], unparsed: string[] = []) {
  return {
    state: "measured" as const,
    image: "ghcr.io/org/ubuntu-bun:tag",
    digest: RUNNER_IMAGE.digest,
    present,
    missing,
    unparsed,
  }
}

/** A medição que reproduz a declaração vigente. */
function declaredMeasurement() {
  return medicao({ ...DECLARED }, [...RUNNER_SHELLS_MISSING])
}

/** A declaração SEM um nome na lista dos presentes (o caso REMOVIDO). */
function semPresente(nome: string): Record<string, string> {
  return Object.fromEntries(Object.entries(DECLARED).filter(([n]) => n !== nome))
}

// ── o probe: uma fonte, dois consumidores ────────────────────────────────

describe("o probe — o comando declarado é gerado do mesmo que a medição executa", () => {
  it("o comando publicado CONTÉM o script que o argv executa (sem cópia que envelhece)", () => {
    expect(RUNNER_IMAGE.command).toContain(probeScript())
    expect(probeArgv("ghcr.io/org/ubuntu-bun:tag").at(-1)).toBe(probeScript())
    expect(probeCommandText("ghcr.io/org/ubuntu-bun:tag")).toBe(
      `docker run --rm --entrypoint /bin/sh ghcr.io/org/ubuntu-bun:tag -c '${probeScript()}'`,
    )
    // O comando de referência cita a ref GENÉRICA (a tag é derivada, não literal).
    expect(RUNNER_IMAGE.command).toContain("<ref>")
  })

  it("o script não tem aspa simples — o comando o cita com `'...'`", () => {
    // Uma aspa simples dentro do script quebraria a citação do `-c`, e o probe
    // declarado deixaria de ser re-executável (que é o que a issue manda fazer).
    expect(probeScript()).not.toContain("'")
    expect(probeArgv("x")).toHaveLength(7)
  })

  it("pergunta EXATAMENTE os nomes declarados — a régua da cobertura", () => {
    const declarados = [...Object.keys(DECLARED), ...RUNNER_SHELLS_MISSING].sort()
    expect([...SHELLS_PROBED].sort()).toEqual(declarados)
    expect(new Set(SHELLS_PROBED).size).toBe(SHELLS_PROBED.length)
    // A declaração é disjunta: um nome não pode estar presente E ausente.
    expect(Object.keys(DECLARED).filter((s) => RUNNER_SHELLS_MISSING.includes(s))).toEqual([])
  })
})

// ── o parser ─────────────────────────────────────────────────────────────

describe("parseProbeOutput — o que o parser não entende fica CONTADO", () => {
  it("lê nome + caminho, e a marca AUSENTE vira a lista dos que não têm", () => {
    const r = parseProbeOutput("bash         /usr/bin/bash\nzsh          AUSENTE\n")
    expect(r.present).toEqual({ bash: "/usr/bin/bash" })
    expect(r.missing).toEqual(["zsh"])
    expect(r.unparsed).toEqual([])
  })

  it("linha sem coluna de valor, nome não perguntado e valor vazio são `unparsed`", () => {
    const r = parseProbeOutput(
      ["bash", "bash  /usr/bin/bash", "cobol  /usr/bin/cobol", "perl    "].join("\n"),
    )
    expect(r.present).toEqual({ bash: "/usr/bin/bash" })
    expect(r.unparsed).toEqual(["bash", "cobol  /usr/bin/cobol", "perl"])
  })

  it("o mesmo nome repetido não vira duas entradas", () => {
    const r = parseProbeOutput("zsh  AUSENTE\nzsh  AUSENTE\n")
    expect(r.missing).toEqual(["zsh"])
  })
})

// ── fail-closed ──────────────────────────────────────────────────────────

describe("measureShells — todo caminho que não mede diz POR QUE", () => {
  it("sem ref (BUN_VERSION ausente) não mede — e não presume a imagem", () => {
    expect(motivoDe(measureShells({ ref: null }))).toContain("BUN_VERSION")
  })

  it("docker ausente (erro de spawn) e docker que não executa", () => {
    expect(
      motivoDe(
        measureShells({
          ref: "img:tag",
          run: dockerDouble({ spawnError: { code: "ENOENT" } }).run,
        }),
      ),
    ).toContain("ENOENT")
    expect(
      motivoDe(measureShells({ ref: "img:tag", run: dockerDouble({ throwOn: true }).run })),
    ).toContain("ENOENT")
  })

  it("`docker run` diferente de zero nomeia o stderr (o pull é o caso comum)", () => {
    expect(
      motivoDe(
        measureShells({
          ref: "img:tag",
          run: dockerDouble({ probeStatus: 125, probeStderr: "manifest unknown\n" }).run,
        }),
      ),
    ).toContain("manifest unknown")
  })

  it("saída vazia NÃO é 'a imagem não tem nada'", () => {
    expect(
      motivoDe(measureShells({ ref: "img:tag", run: dockerDouble({ probe: "" }).run })),
    ).toContain("NENHUM")
  })

  it("mede de verdade: as duas listas + o digest perguntado ao cliente", () => {
    const d = dockerDouble()
    const r = measureShells({ ref: "ghcr.io/org/ubuntu-bun:tag", run: d.run })
    expect(r.state).toBe("measured")
    if (r.state !== "measured") return
    expect(Object.keys(r.present).sort()).toEqual(Object.keys(DECLARED).sort())
    expect(r.missing).toEqual([...RUNNER_SHELLS_MISSING].sort())
    expect(r.digest).toBe(RUNNER_IMAGE.digest)
    // O argv do probe é o que o comando declarado promete.
    expect(d.calls[0].args).toEqual(probeArgv("ghcr.io/org/ubuntu-bun:tag"))
  })

  it("o digest é proveniência: quando o cliente não sabe dizer, é `null` (não um aviso)", () => {
    const r = measureShells({ ref: "img:tag", run: dockerDouble({ digestStatus: 1 }).run })
    expect(r.state).toBe("measured")
    const report = shellsDriftReport({ measurement: r })
    expect(report.digest).toBeNull()
    expect(report.warnings).toEqual([])
    expect(report.digestChanged).toBeNull()
  })
})

// ── o veredito: as cinco classes ─────────────────────────────────────────

describe("shellsDriftReport — cada divergência com a DIREÇÃO do erro dita", () => {
  it("a declaração vigente, medida igual a si mesma, não tem aviso", () => {
    const r = shellsDriftReport({ measurement: declaredMeasurement() })
    expect(r.verdict).toBe("in-sync")
    expect(r.warnings).toEqual([])
    expect(r.counts).toMatchObject({ probed: SHELLS_PROBED.length, present: 7, missing: 7 })
  })

  it("REMOVIDO (declarado presente, medido ausente) — a direção perigosa", () => {
    const r = shellsDriftReport({
      measurement: medicao(semPresente("bash"), [...RUNNER_SHELLS_MISSING, "bash"]),
    })
    expect(r.removed).toEqual(["bash"])
    expect(r.verdict).toBe("drift")
    const texto = r.warnings.join("\n")
    expect(texto).toContain("PASSARIA")
    expect(texto).toContain("command not found")
  })

  it("ADICIONADO (declarado ausente, medido presente) — o gate reprovaria um passo legítimo", () => {
    const r = shellsDriftReport({
      measurement: medicao(
        { ...DECLARED, zsh: "/usr/bin/zsh" },
        RUNNER_SHELLS_MISSING.filter((n) => n !== "zsh"),
      ),
    })
    expect(r.added).toEqual(["zsh"])
    expect(r.warnings.join("\n")).toContain("REPROVA")
  })

  it("MOVIDO (o caminho mudou) — a proveniência do relatório envelheceu", () => {
    const r = shellsDriftReport({
      measurement: medicao({ ...DECLARED, node: "/opt/x/node" }, [...RUNNER_SHELLS_MISSING]),
    })
    expect(r.moved).toEqual(["node"])
    expect(r.warnings.join("\n")).toContain("mudou de caminho")
  })

  it("NÃO RESPONDIDO (declarado, e a medição ficou muda) — buraco, não fato", () => {
    const r = shellsDriftReport({
      measurement: medicao(semPresente("bash"), [...RUNNER_SHELLS_MISSING]),
    })
    expect(r.unanswered).toEqual(["bash"])
    expect(r.warnings.join("\n")).toContain("NÃO respondeu")
  })

  it("COBERTURA: declarado que ninguém pergunta, e pergunta que ninguém usa", () => {
    const soBash = shellsDriftReport({
      measurement: medicao({ bash: "/usr/bin/bash" }, []),
      declared: { bash: "/usr/bin/bash" },
      missing: [],
    })
    // Todos os outros nomes são perguntados pela medição e nenhuma declaração usa.
    expect((soBash.unused ?? []).length).toBe(SHELLS_PROBED.length - 1)
    expect(soBash.warnings.join("\n")).toContain("PERGUNTADO")

    const declaradoFora = shellsDriftReport({
      measurement: medicao({ bash: "/usr/bin/bash" }, []),
      declared: { bash: "/usr/bin/bash", cobol: "/usr/bin/cobol" },
      missing: [],
    })
    expect(declaradoFora.unprobed).toEqual(["cobol"])
    expect(declaradoFora.warnings.join("\n")).toContain("DECLARADO mas a medição nunca o PERGUNTA")
  })

  it("linha ilegível do probe derruba o verde (a varredura lê o que imprime)", () => {
    const r = shellsDriftReport({
      measurement: { ...declaredMeasurement(), unparsed: ["??? lixo"] },
    })
    expect(r.verdict).toBe("drift")
    expect(r.warnings.join("\n")).toContain("não leu")
  })

  it("a assinatura é ESTÁVEL: a mesma divergência em qualquer ordem dá o MESMO conjunto", () => {
    const a = shellsDriftReport({
      measurement: medicao(semPresente("perl"), [...RUNNER_SHELLS_MISSING, "perl"]),
    })
    const b = shellsDriftReport({
      measurement: medicao(semPresente("python"), [
        "python",
        ...[...RUNNER_SHELLS_MISSING].reverse(),
      ]),
    })
    // Divergências diferentes → assinaturas diferentes (comentar é o certo).
    expect(a.warnings.join("\n")).not.toBe(b.warnings.join("\n"))
    // A MESMA divergência, com a lista em outra ordem → assinatura idêntica.
    const c = shellsDriftReport({
      measurement: medicao(semPresente("perl"), ["perl", ...[...RUNNER_SHELLS_MISSING].reverse()]),
    })
    expect(c.warnings).toEqual(a.warnings)
  })

  it("`unavailable` não tem aviso nem veredito de sincronia (não medido ≠ resolvido)", () => {
    const r = shellsDriftReport({ measurement: measureShells({ ref: null }) })
    expect(r.state).toBe("unavailable")
    expect(r.verdict).toBe("unavailable")
    expect(r.warnings).toEqual([])
    expect(r.detail).toContain("BUN_VERSION")
    // As chaves da MEDIÇÃO não existem neste relatório (em vez de virem vazias):
    // um consumidor não pode ler `present: {}` como "a imagem não tem nada" —
    // quem ler `report.present[nome]` quebra ALTO, que é o desfecho certo.
    expect(r.present).toBeUndefined()
    expect(r.missing).toBeUndefined()
    expect(r.counts).toBeUndefined()
    expect(r.detail).toContain("BUN_VERSION")
  })
})

// ── a ref e a CLI ────────────────────────────────────────────────────────

describe("a ref da imagem é DERIVADA do env (nunca literal)", () => {
  it("monta a ref do registry/namespace/versão", () => {
    expect(
      runnerImageRef({ IMAGE_REGISTRY: "reg.io", IMAGE_NAMESPACE: "org", BUN_VERSION: "9.9.9" }),
    ).toBe("reg.io/org/ubuntu-bun:9.9.9")
    expect(runnerImageRef({ BUN_VERSION: "1.2.3" })).toBe(
      `${DECLARED_REGISTRY}/${DECLARED_NAMESPACE}/ubuntu-bun:1.2.3`,
    )
    expect(runnerImageRef({})).toBeNull()
    expect(runnerImageRef({ BUN_VERSION: "  " })).toBeNull()
  })
})

describe("a CLI — uso inválido é exit 3, e o contrato do script está no header", () => {
  it("recusa flag desconhecida e flag sem valor", () => {
    expect(() => parseArgs(["--nada"])).toThrow(/Argumento desconhecido/)
    expect(() => parseArgs(["--image"])).toThrow(/--image exige um valor/)
    expect(() => parseArgs(["--report"])).toThrow(/--report exige um valor/)
  })

  it("o header do script documenta Usage e os exit codes (o guard de cabeçalho)", () => {
    const fonte = readFileSync(SCRIPT, "utf8")
    expect(fonte).toContain("Usage:")
    expect(fonte).toContain("Exit codes:")
    // Exit 2 é o INDETERMINADO — o desfecho que NÃO pode passar por verde.
    expect(fonte).toMatch(/2 — INDETERMINADO/)
  })

  it("o módulo é o DONO da declaração (o gate o importa, não o copia)", () => {
    const gate = readFileSync(
      resolve(process.cwd(), "scripts/check-workflow-run-syntax.mjs"),
      "utf8",
    )
    expect(gate).toContain('from "./runner-shells.mjs"')
    expect(gate).not.toContain("export const RUNNER_SHELLS = {")
    expect(gate).not.toContain("export const RUNNER_IMAGE = {")
  })
})
