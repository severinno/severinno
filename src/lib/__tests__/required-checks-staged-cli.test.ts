/**
 * required-checks-staged-cli.test.ts
 *
 * Prova por EXECUÇÃO do `--staged` do `check-required-checks.mjs` — o recorte
 * que o pre-commit roda. Roda o CLI REAL contra um repositório git de verdade
 * (temporário), porque o que está sob teste é justamente de ONDE o veredito lê:
 * o ÍNDICE (`git show :path`), não a árvore de trabalho.
 *
 * POR QUE ESTE ARQUIVO EXISTE: o rename do `name:` de um required check é o
 * modo de falha mais caro desta família — a forja segue exigindo o contexto
 * ANTIGO e o PR passa a esperar para sempre por um check que nunca mais roda. O
 * guard já reprovava isso no CI, mas o hook não o rodava: `required-checks`
 * estava em HOOK_NOT_RUN com a justificativa de que a paridade de gates pegaria
 * o efeito, e ela NÃO pega (a classificação de um gate é pelo job/comando;
 * renomear o `name:` não muda classificação nenhuma). Sem o recorte, o commit
 * saía daqui e a divergência só aparecia no CI — ou, num PR cuja base não é
 * `main`, no cron semanal.
 *
 * AS QUATRO METADES, todas medidas contra um git real:
 *   1. rename STAGED sem a declaração da reaplicação → exit 1, nomeando o job,
 *      o contexto NOVO e o contexto ÓRFÃO;
 *   2. o MESMO rename com a declaração reaplicada e commitada junto → exit 0;
 *   3. o veredito lê o ÍNDICE: com o índice carregando o rename e a ÁRVORE já
 *      revertida, ele AINDA reprova (o inverso — rename só na árvore — passa);
 *   4. o índice ilegível (fora de um repositório) é exit 2, não "nada a julgar".
 *
 * Usage:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/required-checks-staged-cli.test.ts
 */

import { spawnSync } from "node:child_process"
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import { afterAll, describe, expect, it } from "vitest"

import {
  MANIFEST_PATH,
  APPLIED_PATH,
  stagedContractPaths,
} from "../../../scripts/check-required-checks.mjs"

const ROOT = process.cwd()
const SCRIPT = resolve(ROOT, "scripts", "check-required-checks.mjs")

/** O job required e o `name:` dele no fixture (o rename é feito em cima disto). */
const JOB = "mutation-guards"
const CONTEXTO = "Mutation guards master"
const RENOMEADO = "Mutation guards master (renomeado)"

const dirs: string[] = []

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

function git(cwd: string, args: string[]) {
  return spawnSync("git", args, { cwd, encoding: "utf8" })
}

/**
 * Um repositório git de verdade com o CONTRATO INTEIRO do repositório (o
 * manifesto, a declaração da reaplicação e os workflows que eles derivam) —
 * copiado da árvore real, para o fixture não ser uma segunda régua do contrato.
 */
function novoRepo() {
  const dir = mkdtempSync(join(tmpdir(), "req-checks-staged-"))
  dirs.push(dir)
  mkdirSync(join(dir, "ci"), { recursive: true })
  mkdirSync(join(dir, ".github", "workflows"), { recursive: true })
  mkdirSync(join(dir, ".gitea", "workflows"), { recursive: true })
  copyFileSync(join(ROOT, MANIFEST_PATH), join(dir, MANIFEST_PATH))
  copyFileSync(join(ROOT, APPLIED_PATH), join(dir, APPLIED_PATH))
  for (const w of ["pr-check.yml", "seed-guards.yml"]) {
    copyFileSync(join(ROOT, ".github/workflows", w), join(dir, ".github/workflows", w))
  }
  copyFileSync(join(ROOT, ".gitea/workflows/ci.yml"), join(dir, ".gitea/workflows/ci.yml"))
  git(dir, ["init", "-q", "."])
  git(dir, ["add", "-A"])
  git(dir, ["-c", "user.email=a@b", "-c", "user.name=t", "commit", "-qm", "base"])
  return dir
}

/** Roda o CLI REAL no modo `--staged`, com o `--root` do fixture. */
function runStaged(dir: string) {
  const r = spawnSync(process.execPath, [SCRIPT, "--root", dir, "--staged"], {
    cwd: dir,
    encoding: "utf8",
  })
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` }
}

/** Renomeia o `name:` do job required no WORKFLOW, devolvendo o antigo. */
function renomeiaNoWorkflow(dir: string, novo = RENOMEADO) {
  const path = join(dir, ".github/workflows/pr-check.yml")
  const antes = readFileSync(path, "utf8")
  expect(antes).toContain(`name: ${CONTEXTO}\n`)
  writeFileSync(path, antes.replace(`name: ${CONTEXTO}\n`, `name: ${novo}\n`), "utf8")
}

/** Reescreve a DECLARAÇÃO da reaplicação como o `--apply` faria (só o contexto). */
function reaplicaDeclaracao(dir: string, de = CONTEXTO, para = RENOMEADO) {
  const path = join(dir, APPLIED_PATH)
  const record = JSON.parse(readFileSync(path, "utf8"))
  for (const forge of Object.values(record.forges) as { contexts: string[] }[]) {
    forge.contexts = forge.contexts.map((c) => (c === de ? para : c))
  }
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, "utf8")
}

// ── O recorte: quais caminhos fazem o veredito ser relevante ──────────────

describe("stagedContractPaths — o recorte é da RELEVÂNCIA do commit", () => {
  it("aceita o manifesto, a declaração da reaplicação e qualquer YAML", () => {
    expect(
      stagedContractPaths([
        MANIFEST_PATH,
        APPLIED_PATH,
        ".github/workflows/pr-check.yml",
        ".gitea/workflows/ci.yml",
        "deploy/docker-compose.gitea.yml",
      ]),
    ).toEqual([
      MANIFEST_PATH,
      APPLIED_PATH,
      ".github/workflows/pr-check.yml",
      ".gitea/workflows/ci.yml",
      "deploy/docker-compose.gitea.yml",
    ])
  })

  it("um commit que não toca o contrato fica FORA (o guard não roda à toa)", () => {
    expect(stagedContractPaths(["src/app.ts", "README.md", "ci/merge-latency.json"])).toEqual([])
  })
})

// ── O veredito, contra um git de verdade ──────────────────────────────────

describe("check-required-checks --staged (CLI real, contra um git de verdade)", () => {
  it("nada staged: exit 0 e o aviso de que o veredito completo é do CI", () => {
    const dir = novoRepo()
    const r = runStaged(dir)
    expect(r.out).toContain("nada no índice que mude o contrato de merge")
    expect(r.code).toBe(0)
  })

  it("REGRESSÃO: o rename STAGED sem a declaração da reaplicação REPROVA o commit", () => {
    const dir = novoRepo()
    renomeiaNoWorkflow(dir)
    git(dir, ["add", "-A"])

    const r = runStaged(dir)

    expect(r.code).toBe(1)
    // Nomeia o JOB e os DOIS contextos: o que passou a existir e o órfão.
    expect(r.out).toContain(`"${RENOMEADO}" (job "${JOB}")`)
    expect(r.out).toContain(`"${CONTEXTO}"`)
    expect(r.out).toContain("MUDA o contrato de merge")
    // E o remédio é a reaplicação declarada, não "renomeie de volta".
    expect(r.out).toContain("bun run ci:required-checks -- --apply")
  })

  it("o MESMO rename com a declaração reaplicada junto PASSA (é o fluxo do rename)", () => {
    const dir = novoRepo()
    renomeiaNoWorkflow(dir)
    reaplicaDeclaracao(dir)
    git(dir, ["add", "-A"])

    const r = runStaged(dir)

    expect(r.code, r.out).toBe(0)
    expect(r.out).toContain("recorte --staged")
    expect(r.out).toContain(RENOMEADO)
  })

  it("LÊ O ÍNDICE: com o índice carregando o rename e a ÁRVORE revertida, ainda reprova", () => {
    const dir = novoRepo()
    renomeiaNoWorkflow(dir)
    git(dir, ["add", "-A"])
    // A árvore volta ao HEAD (o commit vai gravar o ÍNDICE, não o working tree).
    const doHead = spawnSync("git", ["show", `HEAD:.github/workflows/pr-check.yml`], {
      cwd: dir,
      encoding: "utf8",
    })
    writeFileSync(join(dir, ".github/workflows/pr-check.yml"), doHead.stdout, "utf8")
    expect(readFileSync(join(dir, ".github/workflows/pr-check.yml"), "utf8")).not.toContain(
      RENOMEADO,
    )

    const r = runStaged(dir)

    expect(r.code, r.out).toBe(1)
    expect(r.out).toContain(RENOMEADO)
  })

  it("e o INVERSO: rename só na ÁRVORE (índice limpo) não é deste commit", () => {
    const dir = novoRepo()
    renomeiaNoWorkflow(dir, "Mutation guards master (arvore)")

    const r = runStaged(dir)

    expect(r.code, r.out).toBe(0)
    expect(r.out).toContain("nada no índice que mude o contrato de merge")
  })

  it("índice ILEGÍVEL é exit 2 — não pode passar por 'nada a julgar'", () => {
    const dir = mkdtempSync(join(tmpdir(), "req-checks-nogit-"))
    dirs.push(dir)

    const r = runStaged(dir)

    expect(r.code).toBe(2)
    expect(r.out).toContain("git diff --cached indisponível")
  })
})
