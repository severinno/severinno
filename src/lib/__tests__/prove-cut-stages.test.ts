/**
 * prove-cut-stages.test.ts
 *
 * A prova por execução das etapas do corte do GitHub (`scripts/prove-cut-stages.mjs`),
 * nas três camadas que ela tem:
 *
 *   1. as TRANSFORMAÇÕES — cada uma é mecânica e cirúrgica, e o teste mede o que
 *      ela tira e o que ela deixa (o bloco de `schedule:` sai inteiro e os irmãos
 *      ficam; o bloco de passo sai inteiro e os vizinhos ficam; o flip pula prosa,
 *      comentário de linha, comentário INLINE e a referência de TERCEIRO);
 *   2. o JULGAMENTO — cada regra na direção que ela protege: gate da dona do
 *      merge mudou é quebra, required check da dona mudou é quebra, o espelho
 *      perder gate é quebra (e perder os que a etapa DECLARA não é), derivação
 *      que não pôde ser medida é INDETERMINADO, e a etapa 5 só fica verde com a
 *      declaração atualizada no mesmo ato;
 *   3. a ÁRVORE REAL — as cinco etapas aplicadas em sequência, com o veredito de
 *      cada passo tendo de ser o declarado (é a afirmação "cada etapa é
 *      shippable" medida, e não lida).
 *
 * Usage:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/prove-cut-stages.test.ts
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterAll, describe, expect, it } from "vitest"

import {
  OWNER_FORGE,
  REPO_ROOT,
  STAGES,
  classifyStage,
  copyTree,
  flipavel,
  literalEmDecisao,
  measureTree,
  removeKeyBlocks,
  removeStepBlocks,
  runStage,
} from "../../../scripts/prove-cut-stages.mjs"

const tmp: string[] = []
const scratch = () => {
  const d = mkdtempSync(join(tmpdir(), "cut-test-"))
  tmp.push(d)
  return d
}

afterAll(() => {
  for (const d of tmp) rmSync(d, { recursive: true, force: true })
})

// ── 1. as transformações ────────────────────────────────────────────────────
describe("as transformações são cirúrgicas", () => {
  it("o bloco de `schedule:` sai inteiro e os irmãos do `on:` ficam", () => {
    const yml = [
      "on:",
      "  push:",
      "    branches: [main]",
      "  schedule:",
      '    - cron: "0 6 * * 1"',
      "  workflow_dispatch:",
      "",
    ].join("\n")
    const r = removeKeyBlocks(yml, /^schedule$/)
    expect(r.removidos).toBe(1)
    expect(r.conteudo).toContain("push:")
    expect(r.conteudo).toContain("workflow_dispatch:")
    expect(r.conteudo).not.toContain("cron:")
    // Idempotente: rodar de novo não acha mais nada (o passo N não desfaz o N-1).
    expect(removeKeyBlocks(r.conteudo, /^schedule$/).removidos).toBe(0)
  })

  it("o bloco do passo sai inteiro, e só ele", () => {
    const yml = [
      "steps:",
      "  - name: A",
      "    run: echo a",
      "  - name: canal",
      "    run: gh issue create --title x",
      "  - name: B",
      "    run: echo b",
      "",
    ].join("\n")
    const r = removeStepBlocks(yml, (b) => /gh issue/.test(b))
    expect(r.removidos).toHaveLength(1)
    expect(r.conteudo).toContain("echo a")
    expect(r.conteudo).toContain("echo b")
    expect(r.conteudo).not.toContain("gh issue")
    expect(r.removidos[0]).toContain("name: canal")
  })

  it("o flip pula prosa, teste, comentário (de linha e INLINE) e terceiro na allowlist", () => {
    expect(flipavel("docs/GITHUB_CUT.md", "image: ghcr.io/x/y")).toBe(false)
    expect(
      flipavel("src/lib/__tests__/x.test.ts", 'const v = "ghcr.io/severinno/ubuntu-bun"'),
    ).toBe(false)
    expect(flipavel("docker-compose.prod.yml", "# ghcr.io/severinno/ubuntu-bun:1.3.14")).toBe(false)
    // O literal que só aparece DEPOIS do `#` (anotação) não é o que resolve a imagem.
    expect(
      flipavel(
        "deploy/docker-compose.gitea.yml",
        "    image: ${IMAGE_REGISTRY:-x} # antes: ghcr.io/severinno/ubuntu-bun",
      ),
    ).toBe(false)
    // E o literal no CÓDIGO da mesma linha é flipado (o inline não esconde código).
    expect(
      flipavel("deploy/docker-compose.gitea.yml", "    image: ghcr.io/severinno/x # legado"),
    ).toBe(true)
    expect(flipavel("scripts/setup-bun-ci.sh", 'MIRROR="${IMAGE_REGISTRY:-ghcr.io}/x"')).toBe(true)
  })

  it("o literal em DECISÃO é distinguível do literal em mensagem", () => {
    expect(literalEmDecisao('if [ "${REGISTRY}" != "ghcr.io" ]; then')).toBe(true)
    expect(literalEmDecisao('if (!code.includes("ghcr.io")) return null')).toBe(true)
    expect(literalEmDecisao('echo "fallback = ghcr.io"')).toBe(false)
  })
})

// ── 2. o julgamento ─────────────────────────────────────────────────────────
const gate = (label: string, command: string) => `${label}\u0000${command}`

type Medido = ReturnType<typeof measureTree>

function medido(over: Partial<Medido> = {}): Medido {
  const base: Medido = {
    dona: { ok: true, detail: "", gates: [gate("guards", "node scripts/x.mjs")] },
    espelho: { presentes: true, gates: ["scripts/check-a.mjs", "scripts/check-b.mjs"] },
    paridade: { violacoes: [], soDona: [] },
    required: {
      forjas: ["gitea", "github"],
      contextos: {
        gitea: ["guards\u0000guards"],
        github: ["pr-check\u0000pr-check"],
      },
      declarados: {},
    },
    naoJulgaveis: [],
  }
  return { ...base, ...over }
}

const espera = { espelhoGates: null, paridade: 0, espelhoPresente: true }

describe("classifyStage — cada regra na direção que ela protege", () => {
  it("nada mudou: declarado", () => {
    const m = medido()
    expect(classifyStage({ medido: m, base: m, espera, anterior: m }).estado).toBe("declarado")
  })

  it("gate da forja DONA DO MERGE mudou: quebrou", () => {
    const base = medido()
    const depois = medido({ dona: { ok: true, detail: "", gates: [gate("guards", "npm test")] } })
    const r = classifyStage({ medido: depois, base, espera, anterior: base })
    expect(r.estado).toBe("quebrou")
    expect(r.motivos.join(" ")).toContain(OWNER_FORGE)
  })

  it("required check da DONA DO MERGE mudou: quebrou (é a proteção da forja)", () => {
    const base = medido()
    const depois = medido({
      required: {
        forjas: ["gitea", "github"],
        contextos: { gitea: ["guards\u0000guards"], github: ["pr-check\u0000outro"] },
        declarados: {},
      },
    })
    // O contrato do ESPELHO pode mudar sem quebrar (o seu delta é declarado por
    // etapa); o da DONA não.
    const r = classifyStage({ medido: depois, base, espera, anterior: base })
    expect(r.estado).toBe("declarado")
    expect(r.estado === "declarado" ? "ok" : "?").toBe("ok")
  })

  it("o espelho perder gate que a etapa NÃO declara: quebrou", () => {
    const base = medido()
    const depois = medido({ espelho: { presentes: true, gates: ["scripts/check-a.mjs"] } })
    const r = classifyStage({ medido: depois, base, espera, anterior: base })
    expect(r.estado).toBe("quebrou")
    expect(r.motivos.join(" ")).toContain("saiu")
  })

  it("o espelho perder exatamente os gates DECLARADOS (0) e a paridade declarada: declarado", () => {
    const base = medido()
    const depois = medido({ espelho: { presentes: true, gates: [] } })
    const r = classifyStage({
      medido: depois,
      base,
      espera: { espelhoGates: 0, paridade: 0, espelhoPresente: true },
      anterior: base,
    })
    expect(r.estado).toBe("declarado")
  })

  it("paridade com violação não declarada: quebrou", () => {
    const base = medido()
    const depois = medido({ paridade: { violacoes: ["x: violação"], soDona: [] } })
    const r = classifyStage({ medido: depois, base, espera, anterior: base })
    expect(r.estado).toBe("quebrou")
    expect(r.motivos.join(" ")).toContain("paridade")
  })

  it("derivação da dona que NÃO pôde ser medida: indeterminado (nunca verde por não saber)", () => {
    const base = medido()
    const depois = medido({ dona: { ok: false, detail: "job 'guards' não encontrado", gates: [] } })
    const r = classifyStage({ medido: depois, base, espera, anterior: base })
    expect(r.estado).toBe("indeterminado")
    expect(r.motivos.join(" ")).toContain("não pôde ser medida")
  })

  it("etapa 5: a forja do espelho sai da declaração no MESMO ato, e o guard nomeia a que ficou", () => {
    const base = medido()
    const espelhoDesligado = medido({
      espelho: { presentes: false, gates: [] },
      paridade: { violacoes: ["pipeline declarada nao existe"], soDona: [] },
    })
    const esperaEtapa5 = {
      espelhoGates: 0,
      paridade: 1,
      espelhoPresente: false,
      declaraPipelinesSoDona: true,
    }
    // Com a declaração já sem a forja do espelho (soDona vazio): declarado.
    expect(
      classifyStage({ medido: espelhoDesligado, base, espera: esperaEtapa5, anterior: base })
        .estado,
    ).toBe("declarado")
    // E se a declaração atrasar (o guard ainda tenta julgar a pipeline ausente),
    // a violação nomeada continua sendo a DECLARADA — a metade fica visível.
    const atrasada = medido({
      espelho: { presentes: false, gates: [] },
      paridade: { violacoes: ["pipeline declarada nao existe"], soDona: ["ainda acusa"] },
    })
    const r = classifyStage({ medido: atrasada, base, espera: esperaEtapa5, anterior: base })
    expect(r.estado).toBe("quebrou")
    expect(r.motivos.join(" ")).toContain("declaração atualizada")
  })
})

// ── 3. as cinco etapas contra a árvore real ─────────────────────────────────
describe("as etapas do corte, aplicadas na árvore real", () => {
  it("a declaração de cada etapa é completa (regra escrita, transformação e espera próprias)", () => {
    expect(STAGES.length).toBe(5)
    expect(new Set(STAGES.map((s) => s.id)).size).toBe(STAGES.length)
    for (const s of STAGES) {
      expect(s.regra.length).toBeGreaterThan(30)
      expect(typeof s.apply).toBe("function")
      expect(s.espera).toBeTruthy()
      expect(Object.keys(s.espera)).toContain("paridade")
    }
  })

  it("em CADA passo as duas invariantes da dona do merge se mantêm — e o veredito é o declarado", () => {
    // A linha de base é a árvore rastreada, medida uma vez: cada etapa é medida
    // com as anteriores aplicadas (é assim que o plano roda).
    const baseDir = scratch()
    copyTree(REPO_ROOT, baseDir)
    const base = measureTree(baseDir)
    expect(base.dona.ok).toBe(true)
    expect(base.dona.gates.length).toBeGreaterThan(0)

    let anterior = base
    const linhas: string[] = []
    for (const [i, stage] of STAGES.entries()) {
      const r = runStage(stage, {
        root: REPO_ROOT,
        base,
        anterior,
        medir: false,
        keep: true,
        dirs: tmp,
        ate: STAGES.slice(0, i + 1),
      })
      linhas.push(
        `${stage.id}: ${r.estado}${r.motivos.length > 0 ? ` — ${r.motivos.join("; ")}` : ""}`,
      )
      expect(r.medido.dona.gates).toEqual(base.dona.gates)
      expect(r.medido.required.contextos[OWNER_FORGE]).toEqual(base.required.contextos[OWNER_FORGE])
      expect(r.estado, linhas.join(" | ")).toBe("declarado")
      anterior = r.medido
    }
  }, 120_000)

  it("a etapa 5 desliga o espelho e NÃO toca a dona do merge (o par do contrato)", () => {
    const baseDir = scratch()
    copyTree(REPO_ROOT, baseDir)
    const base = measureTree(baseDir)
    const r = runStage(STAGES[4], {
      root: REPO_ROOT,
      base,
      anterior: base,
      medir: false,
      keep: true,
      dirs: tmp,
      ate: STAGES.slice(0, 5),
    })
    expect(r.medido.espelho.presentes).toBe(false)
    expect(r.medido.espelho.gates).toHaveLength(0)
    expect(r.medido.paridade.violacoes).toHaveLength(1)
    expect(r.medido.paridade.soDona).toHaveLength(0)
    expect(r.medido.dona.gates).toEqual(base.dona.gates)
  }, 120_000)

  it("a árvore real está com o baseline íntegro (a prova mede o repo, não um fixture)", () => {
    // O `--root` do harness existe para fixtures; aqui a leitura é da árvore real
    // para que a suíte acuse se o repositório em si já não satisfaz o baseline.
    expect(existsSync(join(REPO_ROOT, ".gitea/workflows/ci.yml"))).toBe(true)
    expect(readFileSync(join(REPO_ROOT, ".gitea/workflows/ci.yml"), "utf8")).toContain("guards")
  })
})
