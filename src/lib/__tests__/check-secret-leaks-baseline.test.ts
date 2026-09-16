/**
 * check-secret-leaks-baseline.test.ts
 *
 * Testes do guard semanal scripts/check-secret-leaks-baseline.mjs — falha
 * SOMENTE se CONTEÚDO novo de segredo aparecer no histórico do git, comparando
 * por assinatura de CONTEÚDO (file:line:id:key:masked — o commit NÃO entra)
 * contra um baseline commitado (docs/security/secret-leaks-baseline.json).
 *
 * Cobre:
 *   - signatureOf: assinatura por CONTEÚDO; o commit não a altera (o motivo da
 *     mudança); valor diferente no mesmo arquivo:linha não colide via masked
 *   - buildBaseline: estrutura do arquivo (version, count, updatedAt, findings)
 *   - parseBaseline: valida JSON + findings
 *   - findNewFindings: achado novo detectado; achado removido NÃO falha;
 *     mesmo conteúdo em N commits = UM achado novo (dedup) com commits[]
 *   - historyProvenance / renderProvenance: intacta | reescrita | raso |
 *     indeterminado, e a MENSAGEM que nomeia a reescrita como motivo próprio
 *   - CLI real (spawnSync + temp git repo com secrets FAKE):
 *       - exit 0 quando nenhum achado novo além do baseline
 *       - exit 1 quando um secret NOVO é commitado (mutation)
 *       - MUTAÇÃO PRINCIPAL: história reescrita (amend) → exit 0, nenhum achado
 *         acusado e a reescrita reportada como motivo próprio
 *       - CLONE RASSO (git clone --depth 1 real): a proveniência ausente vira
 *         CLONE RASSO, não HISTÓRIA REESCRITA — o diagnóstico que não manda
 *         ninguém caçar uma reescrita inexistente; e git fetch --unshallow
 *         devolve o estado a intacta
 *       - controle: DEPOIS da reescrita, um segredo novo ainda falha (o guard
 *         não ficou cego)
 *       - --update regenera o baseline (count atual)
 *       - exit 2 quando o baseline está ausente (fail-closed)
 *
 * ATENÇÃO: os "segredos" usados nos fixtures são FAKES (sk-test-...,
 * ghp_TEST_...), nunca valores reais — o mesmo padrão do audit-secret-leaks.
 *
 * Usage:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/check-secret-leaks-baseline.test.ts
 */

import { describe, it, expect, afterEach } from "vitest"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, copyFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import {
  signatureOf,
  buildBaseline,
  parseBaseline,
  findNewFindings,
  historyProvenance,
  reachableCommits,
  renderProvenance,
  severityRank,
  splitBySeverity,
  SEVERITY_ORDER,
} from "../../../scripts/check-secret-leaks-baseline.mjs"

/** Forma mínima dos achados do baseline (props restantes opcionais). */
type LeakFinding = {
  commit?: string
  file?: string
  line?: number
  id?: string
  key?: string | null
  masked?: string
  /** Anexados pelo dedup de `findNewFindings`. */
  signature?: string
  commits?: string[]
}

const SCRIPT = resolve(process.cwd(), "scripts/check-secret-leaks-baseline.mjs")
const tmpDirs: string[] = []

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "sec-base-"))
  tmpDirs.push(dir)
  execFileSync("git", ["init", "-q"], { cwd: dir })
  execFileSync("git", ["config", "user.email", "t@t"], { cwd: dir })
  execFileSync("git", ["config", "user.name", "t"], { cwd: dir })
  return dir
}

function commitFile(dir: string, file: string, content: string, msg: string) {
  const full = join(dir, file)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, content, "utf8")
  execFileSync("git", ["add", file], { cwd: dir })
  execFileSync("git", ["commit", "-qm", msg], { cwd: dir })
}

function runCheck(dir: string, args: string[] = []) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: dir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

// ── signatureOf (assinatura por CONTEÚDO) ─────────────────────────────────

describe("signatureOf", () => {
  const base = {
    file: ".env",
    line: 3,
    id: "atribuição de secret",
    key: "DB_PASSWORD",
    masked: "post…57 chars",
  }

  it("é o CONTEÚDO: file:line:id:key:masked (sem commit)", () => {
    expect(signatureOf({ ...base, commit: "abc123" })).toBe(
      ".env:3:atribuição de secret:DB_PASSWORD:post…57 chars",
    )
  })

  it("o COMMIT não altera a assinatura — é o que torna a reescrita de história inofensiva", () => {
    // A mesma linha em dois commits quaisquer dá a MESMA assinatura. Sem isto,
    // um `git commit --amend` renomeia todos os achados conhecidos e o guard
    // acusa o baseline inteiro como novo (o falso alarme em massa que motivou
    // esta mudança).
    const a = signatureOf({ ...base, commit: "1111111111111111111111111111111111111111" })
    const b = signatureOf({ ...base, commit: "ffffffffffffffffffffffffffffffffffffffff" })
    expect(a).toBe(b)
  })

  it("valor DIFERENTE no mesmo arquivo:linha NÃO colide (o masked participa)", () => {
    expect(signatureOf({ ...base, masked: "post…57 chars" })).not.toBe(
      signatureOf({ ...base, masked: "post…61 chars" }),
    )
  })

  it("normaliza key/masked null-undefined para string vazia (padrão de 1 grupo)", () => {
    expect(signatureOf({ file: "t", line: 1, id: "token com prefixo", key: null })).toBe(
      "t:1:token com prefixo::",
    )
    expect(signatureOf({ file: "t", line: 1, id: "chave privada" })).toBe("t:1:chave privada::")
  })
})

// ── buildBaseline / parseBaseline ─────────────────────────────────────────

describe("buildBaseline / parseBaseline", () => {
  const FINDINGS = [
    {
      commit: "abc",
      file: ".env",
      line: 2,
      id: "atribuição de secret",
      key: "SESSION_SECRET",
      masked: "SESS…17 chars",
    },
  ]

  it("buildBaseline gera count + updatedAt + findings (round-trip com parseBaseline)", () => {
    const bl = buildBaseline(FINDINGS)
    expect(bl.count).toBe(1)
    expect(bl.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect((bl.findings[0] as LeakFinding).key).toBe("SESSION_SECRET")
    expect((bl.findings[0] as LeakFinding).masked).toBe("SESS…17 chars")

    const parsed = parseBaseline(JSON.stringify(bl))
    expect(parsed.count).toBe(1)
    expect(parsed.findings).toHaveLength(1)
  })

  it("parseBaseline falha com JSON inválido / sem findings", () => {
    expect(() => parseBaseline("not json")).toThrow()
    expect(() => parseBaseline('{"count": 1}')).toThrow("findings")
  })
})

// ── severityRank / splitBySeverity (o filtro de severidade) ───────────────

describe("severityRank", () => {
  it("ordena baixa < média < alta", () => {
    expect(severityRank("baixa")).toBe(0)
    expect(severityRank("média")).toBe(1)
    expect(severityRank("alta")).toBe(2)
  })

  it("severidade desconhecida/ausente é tratada como ALTA (fail-closed — nunca escapa do gate)", () => {
    expect(severityRank(undefined)).toBe(2)
    expect(severityRank("??")).toBe(2)
  })

  it("SEVERITY_ORDER tem as 3 severidades", () => {
    expect(SEVERITY_ORDER).toEqual(["baixa", "média", "alta"])
  })
})

describe("splitBySeverity", () => {
  const alta = { commit: "a", id: "token com prefixo", severity: "alta" }
  const media = { commit: "b", id: "atribuição de secret", severity: "média" }
  const semSev = { commit: "c", id: "atribuição de secret" } // sem severity → média

  it("min=baixa (default): TODO achado novo bloqueia (comportamento histórico)", () => {
    const { blocking, warnings } = splitBySeverity([alta, media, semSev], "baixa")
    expect(blocking).toHaveLength(3)
    expect(warnings).toHaveLength(0)
  })

  it("min=alta: ALTA e desconhecida bloqueiam (fail-closed); só MÉDIA vira aviso", () => {
    const { blocking, warnings } = splitBySeverity([alta, media, semSev], "alta")
    expect(blocking).toHaveLength(2)
    expect(blocking[0]).toBe(alta)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toBe(media)
  })

  it("min=média: ALTA e MÉDIA bloqueiam, baixa vira aviso", () => {
    const baixa = { commit: "d", id: "x", severity: "baixa" }
    const { blocking, warnings } = splitBySeverity([alta, media, baixa], "média")
    expect(blocking).toHaveLength(2)
    expect(warnings).toHaveLength(1)
  })

  it("lista vazia → nada bloqueia", () => {
    expect(splitBySeverity([], "alta")).toEqual({ blocking: [], warnings: [] })
  })
})

// ── findNewFindings (a regra do guard) ────────────────────────────────────

describe("findNewFindings", () => {
  const baselineFindings = [
    { commit: "aaa", file: ".env", line: 1, id: "atribuição de secret", key: "DB_PASSWORD" },
    { commit: "bbb", file: "config.json", line: 5, id: "token com prefixo", key: null },
  ]

  it("nenhum novo quando tudo já está no baseline", () => {
    const current = [...baselineFindings]
    expect(findNewFindings(current, baselineFindings)).toEqual([])
  })

  it("detecta achado NOVO (assinatura ausente)", () => {
    const current = [
      ...baselineFindings,
      { commit: "ccc", file: ".env", line: 9, id: "atribuição de secret", key: "API_KEY" },
    ]
    const news = findNewFindings(current, baselineFindings)
    expect(news).toHaveLength(1)
    expect((news[0] as LeakFinding).key).toBe("API_KEY")
  })

  it("achado REMOVIDO (história reescrita) NÃO falha — só novos", () => {
    const current = [baselineFindings[0]] // o token bbb sumiu do histórico
    expect(findNewFindings(current, baselineFindings)).toEqual([])
  })

  it("REESCRITA DE HISTÓRIA não cria achado novo: mesmo conteúdo, commits diferentes", () => {
    // É o caso que motivou a mudança: o amend/filter-repo troca os hashes sem
    // tocar no conteúdo. Com o commit na assinatura, TODOS estes virariam
    // "novos"; por conteúdo, nenhum.
    const reescrito = baselineFindings.map((f, i) => ({ ...f, commit: `novo-commit-${i}` }))
    expect(findNewFindings(reescrito, baselineFindings)).toEqual([])
  })

  it("mesmo conteúdo em VÁRIOS commits = UM achado novo, com os commits em commits[]", () => {
    const current = [
      { commit: "c1", file: ".env", line: 9, id: "atribuição de secret", key: "API_KEY" },
      { commit: "c2", file: ".env", line: 9, id: "atribuição de secret", key: "API_KEY" },
      { commit: "c3", file: ".env", line: 9, id: "atribuição de secret", key: "API_KEY" },
    ]
    const news = findNewFindings(current, baselineFindings)
    expect(news).toHaveLength(1)
    expect((news[0] as LeakFinding).signature).toBe(".env:9:atribuição de secret:API_KEY:")
    expect((news[0] as LeakFinding).commits).toEqual(["c1", "c2", "c3"])
  })

  it("mesmo count mas linha/arquivo diferentes = achado novo (não compara count)", () => {
    // count igual (2), mas o achado do commit bbb está em OUTRA linha — a
    // assinatura muda → novo. É exatamente o caso que count-only perderia.
    const current = [
      baselineFindings[0],
      { commit: "bbb", file: "config.json", line: 6, id: "token com prefixo", key: null },
    ]
    const news = findNewFindings(current, baselineFindings)
    expect(news).toHaveLength(1)
    expect((news[0] as LeakFinding).line).toBe(6)
  })
})

// ── historyProvenance / renderProvenance (a reescrita como MOTIVO PRÓPRIO) ─

describe("historyProvenance", () => {
  const baseline = [
    { commit: "aaa", file: ".env", line: 1, id: "atribuição de secret", key: "K" },
    { commit: "aaa", file: ".env", line: 2, id: "atribuição de secret", key: "K2" },
    { commit: "bbb", file: "t.txt", line: 1, id: "token com prefixo", key: null },
  ]

  it("intacta: todo commit do baseline continua alcançável (e conta commits, não achados)", () => {
    const p = historyProvenance(baseline, { reachable: ["aaa", "bbb", "ccc"] })
    expect(p.state).toBe("intacta")
    expect(p.baselineCommits).toBe(2) // `aaa` aparece em 2 achados → 1 commit
    expect(p.reachable).toBe(2)
    expect(p.unreachable).toEqual([])
  })

  it("reescrita: UM commit do baseline que sumiu já muda o estado", () => {
    const p = historyProvenance(baseline, { reachable: ["bbb"] })
    expect(p.state).toBe("reescrita")
    expect(p.reachable).toBe(1)
    expect(p.unreachable).toEqual(["aaa"])
  })

  it("indeterminado quando não dá para listar (git ausente) — NUNCA presume reescrita", () => {
    expect(historyProvenance(baseline, { reachable: null }).state).toBe("indeterminado")
    expect(historyProvenance(baseline).state).toBe("indeterminado")
  })

  it("CLONE RASSO é estado PRÓPRIO: mesma falta de proveniência, diagnóstico e ação diferentes", () => {
    // `aaa` sumiu E o repo é raso → `raso` (a ação é `git fetch --unshallow`)
    const raso = historyProvenance(baseline, { reachable: ["bbb"], shallow: true })
    expect(raso.state).toBe("raso")
    expect(raso.unreachable).toEqual(["aaa"])

    // o mesmo conjunto alcançável num repo NÃO raso → `reescrita` (a ação é
    // procurar o filter-repo/rebase). O ambiente é o que separa os dois.
    expect(historyProvenance(baseline, { reachable: ["bbb"], shallow: false }).state).toBe(
      "reescrita",
    )
    // `shallow` desconhecido (null) é o default conservador: não inventa raso
    expect(historyProvenance(baseline, { reachable: ["bbb"], shallow: null }).state).toBe(
      "reescrita",
    )
  })

  it("clone raso SEM proveniência faltando não vira `raso` — não há fato a nomear", () => {
    const p = historyProvenance(baseline, { reachable: ["aaa", "bbb"], shallow: true })
    expect(p.state).toBe("intacta")
  })
})

describe("renderProvenance", () => {
  it("nomeia a reescrita como motivo PRÓPRIO e aponta a comparação por conteúdo", () => {
    const texto = renderProvenance(
      historyProvenance([{ commit: "aaa" }, { commit: "bbb" }], { reachable: [] }),
    ).join("\n")
    expect(texto).toContain("MOTIVO PRÓPRIO")
    expect(texto).toContain("HISTÓRIA REESCRITA")
    expect(texto).toContain("2 de 2 commit(s)")
    expect(texto).toContain("NÃO é vazamento")
    expect(texto).toContain("NÃO é achado novo")
    expect(texto).toContain("CONTEÚDO")
  })

  it("intacta e indeterminado têm texto próprio (nada de reescrita presumida)", () => {
    const intacta = renderProvenance({
      state: "intacta",
      baselineCommits: 24,
      reachable: 24,
      unreachable: [],
    }).join(" ")
    expect(intacta).toContain("24 commit(s) do baseline continuam alcançáveis")
    expect(intacta).not.toContain("REESCRITA")

    const indet = renderProvenance({
      state: "indeterminado",
      baselineCommits: 0,
      reachable: 0,
      unreachable: [],
    }).join(" ")
    expect(indet).toContain("INDETERMINADO")
    expect(indet).not.toContain("REESCRITA")
  })

  it("CLONE RASSO: nomeia o clone, manda --unshallow e NÃO acusa reescrita", () => {
    const texto = renderProvenance(
      historyProvenance([{ commit: "aaa" }, { commit: "bbb" }], {
        reachable: ["bbb"],
        shallow: true,
      }),
    ).join("\n")
    expect(texto).toContain("MOTIVO PRÓPRIO")
    expect(texto).toContain("CLONE RASSO")
    expect(texto).toContain("1 de 2 commit(s)")
    expect(texto).toContain("--unshallow")
    expect(texto).toContain("Nada foi acusado")
    // a distinção importa justamente aqui: o texto NÃO pode mandar caçar
    // reescrita de história quando o mais provável é histórico não baixado
    expect(texto).not.toContain("HISTÓRIA REESCRITA")
  })
})

describe("reachableCommits", () => {
  it("lista os commits do repo e devolve null FORA de um repo git (indeterminado)", () => {
    const dir = makeRepo()
    commitFile(dir, "a.env", "DB_PASSWORD=supersecretpassword123\n", "adds")
    const cs = reachableCommits(dir) ?? []
    expect(cs).toHaveLength(1)
    expect(cs[0]).toMatch(/^[0-9a-f]{40}$/)

    const semRepo = mkdtempSync(join(tmpdir(), "sec-base-sem-repo-"))
    tmpDirs.push(semRepo)
    expect(reachableCommits(semRepo)).toBeNull()
  })
})

// ── CLI real (temp git repo com secrets FAKE) ─────────────────────────────

describe("check-secret-leaks-baseline.mjs — CLI real", () => {
  it("exit 0: nenhum achado novo além do baseline gerado por --update", () => {
    const dir = makeRepo()
    commitFile(dir, "config.json", '{"apiKey": "sk-test-deadbeefcafe0000"}\n', "adds token")
    // baseline do estado atual (1 achado conhecido)
    const upd = runCheck(dir, ["--baseline", "baseline.json", "--update"])
    expect(upd.status).toBe(0)
    expect(JSON.parse(readFileSync(join(dir, "baseline.json"), "utf8")).count).toBe(1)

    // mesmo histórico → nenhum novo → exit 0 (e a proveniência é declarada)
    const check = runCheck(dir, ["--baseline", "baseline.json"])
    expect(check.status).toBe(0)
    expect(check.stdout).toContain("nenhum NOVO")
    expect(check.stdout).toContain("PROVENIÊNCIA DO BASELINE")
    expect(check.stdout).toContain("continuam alcançáveis")
  })

  it("MUTAÇÃO: história reescrita (amend) → exit 0 e a reescrita é o MOTIVO, não achado novo", () => {
    const dir = makeRepo()
    commitFile(dir, "config.json", '{"apiKey": "sk-test-deadbeefcafe0000"}\n', "adds token")
    runCheck(dir, ["--baseline", "baseline.json", "--update"])

    // MUTAÇÃO: reescreve a história SEM tocar no conteúdo. O commit do baseline
    // deixa de existir; o segredo, não. Antes desta mudança, o guard acusava o
    // achado conhecido como NOVO (exit 1) e só um --update apagava o sintoma.
    execFileSync("git", ["commit", "--amend", "-qm", "adds token (reescrito)"], { cwd: dir })

    const check = runCheck(dir, ["--baseline", "baseline.json"])
    expect(check.status, check.stdout + check.stderr).toBe(0)
    expect(check.stdout).toContain("nenhum NOVO")
    expect(check.stdout).toContain("HISTÓRIA REESCRITA")
    expect(check.stdout).toContain("1 de 1 commit(s)")
    expect(check.stdout).not.toContain("🔓")
  })

  it("CLONE RASSO de verdade (--depth 1): exit 0, diz CLONE RASSO e não HISTÓRIA REESCRITA", () => {
    const dir = makeRepo()
    commitFile(dir, "config.json", '{"apiKey": "sk-test-deadbeefcafe0000"}\n', "adds token")
    commitFile(dir, "outro.txt", "sem segredo aqui\n", "segundo commit")
    // baseline gerado no repo COMPLETO (a proveniência inclui o 1º commit)
    runCheck(dir, ["--baseline", "baseline.json", "--update"])

    // MUTAÇÃO DE AMBIENTE: um clone raso real. O commit do baseline existe no
    // remoto e simplesmente não foi baixado — nenhuma história foi reescrita.
    // Sem separar os dois, o relatório mandaria alguém caçar uma reescrita que
    // nunca aconteceu (diagnóstico errado é seguido, e custa caro).
    const cloneRaiz = mkdtempSync(join(tmpdir(), "sec-base-clone-"))
    tmpDirs.push(cloneRaiz)
    const repo = join(cloneRaiz, "raso")
    execFileSync("git", ["clone", "-q", "--depth", "1", `file://${dir}`, repo])
    copyFileSync(join(dir, "baseline.json"), join(repo, "baseline.json"))
    expect(
      execFileSync("git", ["rev-parse", "--is-shallow-repository"], {
        cwd: repo,
        encoding: "utf8",
      }).trim(),
    ).toBe("true")

    const raso = runCheck(repo, ["--baseline", "baseline.json"])
    expect(raso.status, raso.stdout + raso.stderr).toBe(0)
    expect(raso.stdout).toContain("CLONE RASSO")
    expect(raso.stdout).toContain("--unshallow")
    expect(raso.stdout).not.toContain("HISTÓRIA REESCRITA")
    expect(raso.stdout).not.toContain("🔓")

    // CONTROLE: com o histórico completo, o mesmo repo volta a `intacta` — a
    // diferença prova que o estado mede o ambiente, não um chute.
    execFileSync("git", ["fetch", "-q", "--unshallow"], { cwd: repo })
    const completo = runCheck(repo, ["--baseline", "baseline.json"])
    expect(completo.status, completo.stdout + completo.stderr).toBe(0)
    expect(completo.stdout).toContain("continuam alcançáveis")
    expect(completo.stdout).not.toContain("CLONE RASSO")
  })

  it("controle: DEPOIS da reescrita, um segredo NOVO ainda falha (o guard não ficou cego)", () => {
    const dir = makeRepo()
    commitFile(dir, "config.json", '{"apiKey": "sk-test-deadbeefcafe0000"}\n', "adds token")
    runCheck(dir, ["--baseline", "baseline.json", "--update"])
    execFileSync("git", ["commit", "--amend", "-qm", "reescrito"], { cwd: dir })

    // com a história já reescrita, entra um segredo NOVO de verdade
    commitFile(dir, "novo.env", "SESSION_SECRET=sk-test-brandnewsecret00\n", "novo segredo")
    const check = runCheck(dir, ["--baseline", "baseline.json"])
    expect(check.status).toBe(1)
    expect(check.stderr).toContain("novo.env")
    // o relatório diz as DUAS coisas: há conteúdo novo E a história mudou
    expect(check.stderr).toContain("HISTÓRIA REESCRITA")
  })

  it("exit 1: secret NOVO commitado após o baseline (a mutação que o guard pega)", () => {
    const dir = makeRepo()
    commitFile(dir, "config.json", '{"apiKey": "sk-test-deadbeefcafe0000"}\n', "adds token")
    runCheck(dir, ["--baseline", "baseline.json", "--update"])

    // MUTAÇÃO: um commit NOVO adiciona outro secret — assinatura nova
    commitFile(dir, "app.env", "SESSION_SECRET=sk-test-newsecret00001111\n", "adds another secret")
    const check = runCheck(dir, ["--baseline", "baseline.json"])
    expect(check.status).toBe(1)
    expect(check.stderr).toContain("NOVO")
    expect(check.stderr).toContain("app.env")
  })

  it("exit 2: baseline ausente sem --update (fail-closed com instrução)", () => {
    const dir = makeRepo()
    commitFile(dir, "config.json", '{"apiKey": "sk-test-deadbeefcafe0000"}\n', "adds token")
    const res = runCheck(dir, ["--baseline", "missing.json"])
    expect(res.status).toBe(2)
    expect(res.stderr).toContain("Baseline ausente")
    expect(res.stderr).toContain("--update")
  })

  it("--update regenera baseline com count atual e o guard passa", () => {
    const dir = makeRepo()
    commitFile(dir, "a.env", "DB_PASSWORD=supersecretpassword123\n", "adds")
    commitFile(dir, "b.env", "API_KEY=sk-test-secondsecret9999\n", "adds 2nd")

    const upd = runCheck(dir, ["--baseline", "base.json", "--update"])
    expect(upd.status).toBe(0)
    const bl = JSON.parse(readFileSync(join(dir, "base.json"), "utf8"))
    expect(bl.count).toBe(2)

    const check = runCheck(dir, ["--baseline", "base.json"])
    expect(check.status).toBe(0)
  })

  it("--min-severity alta: achado NOVO de severidade média NÃO falha (aviso)", () => {
    const dir = makeRepo()
    // atribuição de secret (severidade MÉDIA)
    commitFile(dir, "a.env", "DB_PASSWORD=supersecretpassword123\n", "adds")
    runCheck(dir, ["--baseline", "base.json", "--update"])

    // MUTAÇÃO: mais um secret de severidade MÉDIA
    commitFile(dir, "b.env", "SESSION_SECRET=anothersecretvalue999\n", "adds 2nd media")
    const check = runCheck(dir, ["--baseline", "base.json", "--min-severity", "alta"])
    expect(check.status).toBe(0)
    expect(check.stderr).toContain("severidade abaixo")
  })

  it("--min-severity alta: achado NOVO de severidade ALTA falha (exit 1)", () => {
    const dir = makeRepo()
    // atribuição de secret (severidade MÉDIA) no baseline
    commitFile(dir, "a.env", "DB_PASSWORD=supersecretpassword123\n", "adds")
    runCheck(dir, ["--baseline", "base.json", "--update"])

    // MUTAÇÃO: token sk- (severidade ALTA) commitado novo
    commitFile(dir, "tok.txt", "api key: sk-test-newsecrettoken000\n", "adds alta token")
    const check = runCheck(dir, ["--baseline", "base.json", "--min-severity", "alta"])
    expect(check.status).toBe(1)
    expect(check.stderr).toContain("NOVO")
    expect(check.stderr).toContain("(alta)")
    expect(check.stderr).toContain("tok.txt")
  })

  it("--min-severity inválido → exit 2 (flag inválida)", () => {
    const dir = makeRepo()
    commitFile(dir, "a.env", "DB_PASSWORD=supersecretpassword123\n", "adds")
    const res = runCheck(dir, ["--baseline", "base.json", "--min-severity", "crítica"])
    expect(res.status).toBe(2)
    expect(res.stderr).toContain("--min-severity")
  })
})
