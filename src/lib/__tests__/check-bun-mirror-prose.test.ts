/**
 * check-bun-mirror-prose.test.ts
 *
 * Testes da INVARIANTE 17 do scripts/check-bun-mirror.mjs: os EXEMPLOS de versão
 * que vivem em PROSA (cabeçalho de script, README, docs) contra o valor
 * DECLARADO nos espelhos (`.actrc` / `deploy/env.gitea.example`).
 *
 * A metade que faltava: as invariantes 15/16 julgam a LINHA DE CÓDIGO (lá um
 * literal é violação sempre — a versão só pode ser derivada) e excluem o
 * comentário de propósito. Depois do bump a doc continuava imprimindo a versão
 * antiga, e nada ficava vermelho: o comando copiado da doc mede/roda a versão
 * errada. A regra nova é a INVERSÃO: na prosa, a menção ANCORADA tem de ser o
 * valor vigente (ou ter o PAPEL declarado — `[divergente]` / `[próxima]`), e um
 * semver solto (`act 0.2.89`, `lodash 4.17.21`, `release/v0.4.0`) não é exemplo
 * da versão do Bun.
 *
 * Cobre:
 *   - findProseVersionMentions: as formas ancoradas (env, bun-version, flag,
 *     prefixado, setup-arg, bump-arg, transição) e os NEGATIVOS (semver que não
 *     fala do Bun);
 *   - judgeProseMention: vigente, sentinela, papel declarado (nos DOIS sentidos)
 *     e cenário declarado (vigente OU alvo MAIOR);
 *   - compareSemver / isProseSentinel / proseMarkerOf / proseTextsOfScriptLine;
 *   - checkProseVersionExamples em fixture (prosa limpa, exemplo desatualizado,
 *     marcador indevido, sem valor declarado, piso do doc canônico);
 *   - checkStagedProseExamples (só o que o diff introduz);
 *   - o REPOSITÓRIO REAL: a prosa do repo bate com o espelho hoje.
 *
 * ATENÇÃO (esbuild): dentro de template literals, `${{` do GitHub Actions
 * precisa de escape (`\${{`) — senão o esbuild lê `${` como início de
 * interpolação e o arquivo nem compila.
 *
 * Usage:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/check-bun-mirror-prose.test.ts
 */

import { describe, it, expect, afterAll } from "vitest"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  PROSE_IGNORED_DIRS,
  PROSE_MARKERS,
  PROSE_REQUIRED_SOURCES,
  PROSE_SCENARIO_DOCS,
  checkProseVersionExamples,
  checkStagedProseExamples,
  compareSemver,
  declaredBunVersion,
  findProseVersionMentions,
  isProseSentinel,
  isSlashScriptPath,
  judgeProseMention,
  proseDocFiles,
  proseMarkerOf,
  proseSourceFiles,
  proseTextsOfScriptLine,
} from "../../../scripts/check-bun-mirror.mjs"

const ROOT_TMP = mkdtempSync(join(tmpdir(), "cbun-prose-"))
afterAll(() => rmSync(ROOT_TMP, { recursive: true, force: true }))

/** Um repo de fixture com os docs e os scripts que a varredura lê. */
function makeFixture(name: string, files: Record<string, string>): string {
  const dir = join(ROOT_TMP, name)
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel)
    mkdirSync(join(abs, ".."), { recursive: true })
    writeFileSync(abs, content, "utf8")
  }
  return dir
}

/** Um par (doc, conteúdo) que satisfaz o piso de cobertura da fixture. */
const CANONICOS = {
  "README.md": "# Fixture\n\nO setup recebe a versão: `BUN_VERSION=1.3.14`.\n",
  "docs/GUARDS.md": "# Guards\n\nO guard roda com `--expected 1.3.14`.\n",
}

const DECLARADO = "1.3.14"

describe("findProseVersionMentions — as formas ANCORADAS", () => {
  const casos: [string, string, string][] = [
    ["env `=`", "rode `BUN_VERSION=1.3.14`", "1.3.14"],
    ['env `: "..."`', '`BUN_VERSION: "1.3.14"` literal', "1.3.14"],
    ["env `${:-}`", "`${BUN_VERSION:-1.3.14}` resolve para literal", "1.3.14"],
    ["env `||`", 'process.env.BUN_VERSION || "1.3.14"', "1.3.14"],
    ["gh variable set", "gh variable set BUN_VERSION 1.3.14", "1.3.14"],
    ["bun-version", "key: bun-version: 1.3.14", "1.3.14"],
    ["--expected", "node scripts/check-actrc-sync.mjs --expected 1.3.14", "1.3.14"],
    ["--bun-version", "prove-forge-runtime.mjs --bun-version 1.3.14", "1.3.14"],
    ["prefixado bun-", "bun-1.3.14-... na cache key", "1.3.14"],
    ["prefixado bun@", "npm install -g bun@1.3.14", "1.3.14"],
    ["prefixado bun-v", "download bun-v1.3.14/bun-linux-x64.zip", "1.3.14"],
    ["prefixado oven/bun", "FROM oven/bun:1.3.14-alpine", "1.3.14"],
    ["tag do runner", "ghcr.io/severinno/ubuntu-bun:1.3.14", "1.3.14"],
    ["setup-arg", "bash scripts/setup-bun-ci.sh 1.3.14", "1.3.14"],
  ]
  for (const [nome, line, valor] of casos) {
    it(`${nome} → ${valor}`, () => {
      const ms = findProseVersionMentions(line)
      expect(ms.map((m) => m.value)).toContain(valor)
    })
  }

  it("o ARGUMENTO do bump é a PRÓXIMA versão (papel da própria forma)", () => {
    const [m] = findProseVersionMentions("./scripts/bump-bun.sh 1.3.15 --dry-run")
    expect(m).toMatchObject({ form: "bump-arg", role: "proxima", value: "1.3.15" })
  })

  it("a TRANSIÇÃO declara dois papéis: o antes vigente, o depois próximo", () => {
    const ms = findProseVersionMentions("Fluxo de bump do Bun (ex.: 1.3.14 → 1.3.15)")
    expect(ms.map((m) => [m.role, m.value])).toEqual([
      ["vigente", "1.3.14"],
      ["proxima", "1.3.15"],
    ])
  })

  it("a transição SÓ conta em linha que fala do Bun (a versão do projeto não é a dele)", () => {
    // O `release.sh` sobe a versão do PROJETO — o mesmo `→` ali não é exemplo
    // da versão do Bun e não pode ser julgado contra o espelho.
    expect(findProseVersionMentions("#   ./scripts/release.sh patch # 0.2.0 → 0.2.1")).toEqual([])
  })

  it("semver que NÃO fala do Bun não é menção (act, docker, deps, branch de release)", () => {
    for (const line of [
      "O act 0.2.89 consome os workflow commands",
      "| **act 0.2.89 não resolve `vars`** | ... |",
      '"lodash": "^4.17.0"',
      "(`release/v0.4.0` — este branch não foi mergeado)",
      "Docker version 29.7.2 sob snap",
      "openapi: 3.1.0",
    ]) {
      expect(findProseVersionMentions(line)).toEqual([])
    }
  })

  it("a prosa que EXPLICA a forma não vira exemplo da forma", () => {
    // O doc descreve `bump-bun.sh` e a transição na MESMA frase: a crase é a
    // barreira que impede o argumento do bump de capturar o valor da transição
    // (sem ela, o texto que ensina a regra era reprovado por ela).
    const ms = findProseVersionMentions(
      "o argumento do `bump-bun.sh` e a transição `1.3.14 → 1.3.15`",
    )
    expect(ms.map((m) => [m.form, m.value])).toEqual([
      ["transition", "1.3.14"],
      ["transition", "1.3.15"],
    ])
  })

  it("uma linha pode carregar VÁRIAS menções (a lista de formas)", () => {
    const ms = findProseVersionMentions("(`bun-1.3.14`, `bun@1.3.14`, `bun-v1.3.14`)")
    expect(ms).toHaveLength(3)
    expect(new Set(ms.map((m) => m.form))).toEqual(new Set(["prefixed"]))
  })
})

describe("judgeProseMention — os estados do veredito", () => {
  const julgar = (line: string, declared = DECLARADO, scenario = false) => {
    const [mention] = findProseVersionMentions(line)
    expect(mention).toBeDefined()
    return judgeProseMention({ mention, line, declared, scenario })
  }

  it("valor vigente → vigente", () => {
    expect(julgar("`BUN_VERSION=1.3.14`").verdict).toBe("vigente")
  })

  it("valor divergente SEM papel → violação (o exemplo que mente)", () => {
    const r = julgar("`BUN_VERSION=1.4.0`")
    expect(r.verdict).toBe("violacao")
    expect(r.why).toContain(PROSE_MARKERS.divergente)
    expect(r.why).toContain(PROSE_MARKERS.proxima)
  })

  it("[divergente] com valor diferente → papel declarado", () => {
    expect(julgar("`BUN_VERSION=1.4.0` [divergente]").verdict).toBe("papel")
  })

  it("[divergente] no valor VIGENTE → violação (marcador indevido)", () => {
    const r = julgar("`BUN_VERSION=1.3.14` [divergente]")
    expect(r.verdict).toBe("violacao")
    expect(r.why).toContain("É o valor vigente")
  })

  it("[próxima] maior que o vigente → papel declarado", () => {
    expect(julgar("`BUN_VERSION=1.3.15` [próxima]").verdict).toBe("papel")
  })

  it("[próxima] igual ou menor que o vigente → violação (alvo que não faz nada)", () => {
    for (const line of ["`BUN_VERSION=1.3.14` [próxima]", "`BUN_VERSION=1.3.13` [próxima]"]) {
      const r = julgar(line)
      expect(r.verdict).toBe("violacao")
      expect(r.why).toContain("não é MAIOR que o vigente")
    }
  })

  it("o argumento do bump já É o papel (sem marcador) e também exige MAIOR", () => {
    expect(julgar("./scripts/bump-bun.sh 1.3.15").verdict).toBe("papel")
    expect(julgar("./scripts/bump-bun.sh 1.3.13").verdict).toBe("violacao")
  })

  it("sentinela (sufixo não-numérico) não é afirmação de versão", () => {
    expect(julgar("`BUN_VERSION=9.9.9-sentinel`").verdict).toBe("sentinela")
  })

  it("cenário declarado: vigente OU valor MAIOR — nada mais", () => {
    expect(julgar("`--expected 1.3.15`", DECLARADO, true).verdict).toBe("cenario")
    expect(julgar("`--expected 1.3.14`", DECLARADO, true).verdict).toBe("vigente")
    const r = julgar("`--expected 1.3.13`", DECLARADO, true)
    expect(r.verdict).toBe("violacao")
    expect(r.why).toContain("nem um alvo MAIOR")
  })
})

describe("helpers da invariante 17", () => {
  it("compareSemver compara os três campos", () => {
    expect(compareSemver("1.3.15", "1.3.14")).toBe(1)
    expect(compareSemver("1.3.14", "1.3.14")).toBe(0)
    expect(compareSemver("1.3.13", "1.3.14")).toBe(-1)
    expect(compareSemver("2.0.0", "1.99.99")).toBe(1)
  })

  it("isProseSentinel exige o sufixo ALFABÉTICO logo depois do valor", () => {
    const sent = (line: string) => {
      const [m] = findProseVersionMentions(line)
      return m ? isProseSentinel(line, m) : null
    }
    expect(sent("`BUN_VERSION=9.9.9-sentinel`")).toBe(true)
    expect(sent("`BUN_VERSION=1.3.14-${{ hashFiles('bun.lock') }}`")).toBe(false)
    expect(sent("`BUN_VERSION=1.3.14`")).toBe(false)
  })

  it("proseMarkerOf lê o papel declarado JUNTO do valor", () => {
    const marcar = (line: string) => {
      const [m] = findProseVersionMentions(line)
      return m ? proseMarkerOf(line, m) : null
    }
    expect(marcar("`BUN_VERSION=1.4.0` [divergente]")).toBe("divergente")
    expect(marcar("`${BUN_VERSION:-1.4.0}` [divergente] (default literal)")).toBe("divergente")
    expect(marcar("`BUN_VERSION=1.3.15` [próxima]")).toBe("proxima")
    expect(marcar("`BUN_VERSION=1.3.14` sem marcador")).toBeNull()
    // O doc que EXPLICA a convenção cita o token e a versão na mesma linha —
    // isso NÃO pode virar uma declaração de papel para o exemplo descrito.
    expect(marcar("valor + `[próxima]` = o alvo do bump; ex.: `BUN_VERSION=1.4.0`")).toBeNull()
  })

  it("proseTextsOfScriptLine: linha inteira, comentário de FIM DE LINHA — ou nada", () => {
    expect(proseTextsOfScriptLine("# BUN_VERSION=1.3.14", { slash: false })).toEqual([
      "# BUN_VERSION=1.3.14",
    ])
    expect(
      proseTextsOfScriptLine('VERSION="${BUN_VERSION:-1.3.14}" # exemplo', { slash: false }),
    ).toEqual([" # exemplo"])
    expect(proseTextsOfScriptLine('const v = "1.3.14" // comentario', { slash: true })).toEqual([
      " // comentario",
    ])
    expect(proseTextsOfScriptLine('const v = "1.3.14"', { slash: true })).toEqual([])
  })

  it("isSlashScriptPath separa a sintaxe do comentário (// vs #)", () => {
    expect(isSlashScriptPath("scripts/x.mjs")).toBe(true)
    expect(isSlashScriptPath("scripts/x.ts")).toBe(true)
    expect(isSlashScriptPath("scripts/x.sh")).toBe(false)
    expect(isSlashScriptPath(".husky/pre-commit")).toBe(false)
  })

  it("as listas declaradas não podem ser esvaziadas em silêncio", () => {
    expect(PROSE_MARKERS.divergente).toBe("[divergente]")
    expect(PROSE_MARKERS.proxima).toBe("[próxima]")
    expect(PROSE_IGNORED_DIRS).toContain("node_modules")
    expect(PROSE_REQUIRED_SOURCES).toEqual(["README.md", "docs/GUARDS.md"])
    expect(PROSE_SCENARIO_DOCS.every((s) => s.file && s.why && s.addedAt)).toBe(true)
  })
})

describe("checkProseVersionExamples — fixture", () => {
  it("prosa alinhada com o espelho → 0 violações (e as contagens batem)", () => {
    const dir = makeFixture("ok", {
      ...CANONICOS,
      "docs/BUN_BUMP.md": "# Bump\n\n`--expected 1.3.15` [próxima] no walkthrough.\n",
      "scripts/tool.sh":
        '#!/usr/bin/env bash\nVERSION="${BUN_VERSION:-1.3.14}" # exemplo: BUN_VERSION=1.3.14\n',
    })
    const r = checkProseVersionExamples(dir, DECLARADO)
    expect(r.violations).toEqual([])
    expect(r.counts.mencoes).toBeGreaterThan(3)
    expect(r.counts.vigentes).toBeGreaterThan(0)
    expect(r.counts.papel).toBeGreaterThan(0)
  })

  it("exemplo DESATUALIZADO num doc → violação com arquivo, linha e o remédio", () => {
    const dir = makeFixture("stale", {
      ...CANONICOS,
      "docs/VELHO.md": "# Como rodar\n\npasse a versão: `--expected 1.4.0`\n",
    })
    const r = checkProseVersionExamples(dir, DECLARADO)
    expect(r.violations).toHaveLength(1)
    expect(r.violations[0]).toContain("docs/VELHO.md:3")
    expect(r.violations[0]).toContain("exemplo de versão desatualizado")
    expect(r.violations[0]).toContain(PROSE_MARKERS.divergente)
  })

  it("exemplo desatualizado no COMENTÁRIO de um script (inclusive de fim de linha)", () => {
    const dir = makeFixture("script-stale", {
      ...CANONICOS,
      "scripts/tool.sh":
        '#!/usr/bin/env bash\nVERSION="1.4.0" # exemplo historico: BUN_VERSION=1.4.0\n',
    })
    const r = checkProseVersionExamples(dir, DECLARADO)
    expect(r.violations).toHaveLength(1)
    expect(r.violations[0]).toContain("scripts/tool.sh:2")
    expect(r.violations[0]).toContain("linha de COMENTÁRIO")
  })

  it("com o papel declarado, o mesmo valor divergente passa", () => {
    const dir = makeFixture("marcado", {
      ...CANONICOS,
      "docs/VELHO.md": "O defeito era `BUN_VERSION=1.4.0` [divergente].\n",
    })
    expect(checkProseVersionExamples(dir, DECLARADO).violations).toEqual([])
  })

  it("sem valor declarado nos espelhos a varredura NÃO fica verde", () => {
    const dir = makeFixture("sem-espelho", { ...CANONICOS })
    const r = checkProseVersionExamples(dir, null)
    expect(r.violations).toHaveLength(1)
    expect(r.violations[0]).toContain("nenhum espelho declara a versão")
  })

  it("doc canônico que EXISTE e não cita a versão → piso de cobertura violado", () => {
    const dir = makeFixture("piso", {
      "README.md": "# Fixture sem versão\n",
      "docs/GUARDS.md": "# Guards\n\n`--expected 1.3.14`\n",
    })
    const r = checkProseVersionExamples(dir, DECLARADO)
    expect(r.violations).toHaveLength(1)
    expect(r.violations[0]).toContain("README.md")
    expect(r.violations[0]).toContain("não cita NENHUMA versão")
  })

  it("repo sem os docs canônicos não é violação de piso (o fixture mínimo continua válido)", () => {
    const dir = makeFixture("minimo", { "docs/QUALQUER.md": "# nada\n" })
    expect(checkProseVersionExamples(dir, DECLARADO).violations).toEqual([])
    expect(checkProseVersionExamples(dir, DECLARADO).counts.docs).toBe(1)
  })

  it("o doc de CENÁRIO declarado aceita o alvo maior (o walkthrough do bump)", () => {
    const cenário = PROSE_SCENARIO_DOCS[0].file
    const dir = makeFixture("cenario", {
      ...CANONICOS,
      [cenário]: "# Bump\n\nBUN_VERSION=1.3.15\n",
    })
    expect(checkProseVersionExamples(dir, DECLARADO).violations).toEqual([])

    const terceiro = makeFixture("cenario-terceiro", {
      ...CANONICOS,
      [cenário]: "# Bump\n\nBUN_VERSION=1.3.13\n",
    })
    const r = checkProseVersionExamples(terceiro, DECLARADO)
    expect(r.violations).toHaveLength(1)
    expect(r.violations[0]).toContain(cenário)
  })

  it("os diretórios declarados ficam fora (saída de build não é doc do repo)", () => {
    const dir = makeFixture("artefatos", {
      ...CANONICOS,
      "tool-results/relatorio.md": "`--expected 1.4.0`\n",
      "node_modules/pkg/LEIAME.md": "`--expected 1.4.0`\n",
    })
    const r = checkProseVersionExamples(dir, DECLARADO)
    expect(r.violations).toEqual([])
    expect(proseDocFiles(dir).some((f) => f.startsWith("tool-results/"))).toBe(false)
  })

  it("proseSourceFiles lê os docs do worktree e os scripts do recorte das 15/16", () => {
    const dir = makeFixture("fontes", { ...CANONICOS, "scripts/tool.sh": "#!/bin/sh\n" })
    const { docs, scripts } = proseSourceFiles(dir)
    expect(docs).toContain("README.md")
    expect(docs).toContain("docs/GUARDS.md")
    expect(scripts).toContain("scripts/tool.sh")
  })
})

describe("checkStagedProseExamples — só o que o diff introduz", () => {
  const diff = (file: string, line: string) =>
    `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -1,1 +1,2 @@\n contexto\n+${line}\n`

  it("linha adicionada com exemplo desatualizado → violação", () => {
    const v = checkStagedProseExamples(diff("docs/NOVO.md", "passe `--expected 1.4.0`"), DECLARADO)
    expect(v).toHaveLength(1)
    expect(v[0]).toContain("docs/NOVO.md:2")
    expect(v[0]).toContain("introduzido por este diff")
  })

  it("linha adicionada com o valor vigente ou com papel declarado → passa", () => {
    expect(
      checkStagedProseExamples(diff("docs/NOVO.md", "`--expected 1.3.14`"), DECLARADO),
    ).toEqual([])
    expect(
      checkStagedProseExamples(diff("docs/NOVO.md", "`1.4.0` [divergente]"), DECLARADO),
    ).toEqual([])
    expect(checkStagedProseExamples(diff("docs/NOVO.md", "`1.3.15` [próxima]"), DECLARADO)).toEqual(
      [],
    )
  })

  it("no --staged o doc de CENÁRIO continua aceitando o alvo maior", () => {
    const cenário = PROSE_SCENARIO_DOCS[0].file
    expect(checkStagedProseExamples(diff(cenário, "BUN_VERSION=1.3.15"), DECLARADO)).toEqual([])
    expect(checkStagedProseExamples(diff(cenário, "BUN_VERSION=1.3.13"), DECLARADO)).toHaveLength(1)
  })
})

describe("o repositório REAL", () => {
  it("a prosa do repo bate com o valor declarado nos espelhos (0 violações)", () => {
    const declared = declaredBunVersion(process.cwd())
    expect(declared).not.toBeNull()
    const r = checkProseVersionExamples(process.cwd(), declared)
    expect(r.violations).toEqual([])
    // O verde não pode vir por vazio: os docs canônicos e os scripts entram.
    expect(r.counts.docs).toBeGreaterThan(10)
    expect(r.counts.vigentes).toBeGreaterThan(10)
  })
})
