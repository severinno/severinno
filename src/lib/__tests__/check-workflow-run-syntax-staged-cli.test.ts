/**
 * check-workflow-run-syntax-staged-cli.test.ts
 *
 * Teste de INTEGRAÇÃO do main() do guard scripts/check-workflow-run-syntax.mjs
 * no modo `--staged` — o recorte do pre-commit, DECLARADO em `HOOK_DECLARED` do
 * check-hook-ci-parity: spawna a CLI REAL (process.execPath — robusto no
 * Windows) contra um repositório git TEMPORÁRIO REAL (git init + git add),
 * validando o CONTRATO DE EXIT CODES do main() no caminho staged:
 *
 *   exit 0  — nenhum workflow no ÍNDICE (nada a julgar neste commit), ou todos
 *             os corpos do ÍNDICE passam em `bash -n`
 *   exit 1  — um corpo `run:` do ÍNDICE não faz parsing (ERRO) ou o parser
 *             avisou (heredoc sem terminador, que o bash reporta como AVISO e
 *             sai 0)
 *   exit 2  — infra: fora de um repositório git (sem índice não há recorte) ou
 *             um workflow do índice ilegível — fail-closed, jamais "0 violações"
 *             por não ter conseguido ler
 *
 * O QUE ESTE TESTE PROVA (e é o motivo de o modo existir): o que o recorte julga
 * é o CONTEÚDO DO ÍNDICE (`git show :path`), não o working tree. As duas
 * direções estão cobertas, porque só uma delas seria um teste fraco:
 *   - corpo quebrado NO ÍNDICE + árvore já corrigida  → REPROVA (o commit é
 *     quem carrega o defeito, mesmo que o editor já tenha consertado o arquivo);
 *   - corpo quebrado SÓ NA ÁRVORE (índice são)        → PASSA, e o gate da
 *     árvore (o do CI) reprova o MESMO repositório — a diferença é o ESCOPO,
 *     não a cegueira do gate.
 *
 * Diferente do check-workflow-run-syntax.test.ts (que cobre as funções puras e
 * o modo global), aqui o `git add` é REAL e o veredito é o exit code da CLI.
 *
 * ATENÇÃO (esbuild): `${{` e `${...}` do GitHub Actions precisam de escape
 * (`\${{`, `\${...}`) dentro de template literals — senão o esbuild lê `${`
 * como interpolação e o arquivo nem compila.
 *
 * Usage:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/check-workflow-run-syntax-staged-cli.test.ts
 */

import { execFileSync, spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { EXIT } from "../../../scripts/check-workflow-run-syntax.mjs"

const SCRIPT = resolve(process.cwd(), "scripts/check-workflow-run-syntax.mjs")
const tmpDirs: string[] = []

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** Cria um repo git REAL temporário (autocrlf=false — bytes crus). */
function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "crs-staged-cli-"))
  tmpDirs.push(dir)
  execFileSync("git", ["init", "-q"], { cwd: dir })
  execFileSync("git", ["config", "user.email", "t@t"], { cwd: dir })
  execFileSync("git", ["config", "user.name", "t"], { cwd: dir })
  execFileSync("git", ["config", "core.autocrlf", "false"], { cwd: dir })
  return dir
}

/** Um diretório SEM `git init` (o caso fail-closed do --staged). */
function makeDirWithoutGit(): string {
  const dir = mkdtempSync(join(tmpdir(), "crs-staged-nogit-"))
  tmpDirs.push(dir)
  return dir
}

const WF = ".github/workflows/pr-check.yml"
const WF_GITEA = ".gitea/workflows/ci.yml"

/** Um corpo `run:` que o bash RECUSA (if sem fi). */
const CORPO_QUEBRADO = [
  "jobs:",
  "  a:",
  "    steps:",
  "      - run: |",
  "          if [ -f x ]; then",
  "            echo sem-fi",
  "",
].join("\n")

/** Um corpo `run:` são, com a expressão do runner dentro. */
const CORPO_SAO = [
  "jobs:",
  "  a:",
  "    steps:",
  "      - name: ok",
  '        run: echo "\\${{ github.sha }}"',
  "",
].join("\n")

/** Um corpo com heredoc SEM terminador — o bash sai 0 e SÓ avisa. */
const CORPO_AVISO = [
  "jobs:",
  "  a:",
  "    steps:",
  "      - run: |",
  "          cat <<'EOF'",
  "          conteudo",
  "",
].join("\n")

/** Escreve um workflow no repo (sem staged). */
function writeWorkflow(dir: string, rel: string, conteudo: string): void {
  mkdirSync(join(dir, rel, ".."), { recursive: true })
  writeFileSync(join(dir, rel), conteudo, "utf8")
}

/** git add <file> — deixa o arquivo STAGED (o objeto do teste). */
function stage(dir: string, file: string): void {
  execFileSync("git", ["add", "--", file], { cwd: dir })
}

/** Roda a CLI REAL no cwd do repo (o uso real do hook) — `--staged` + args. */
function cli(
  dir: string,
  extra: string[] = [],
  staged = true,
): { status: number; out: string; err: string } {
  const args = staged ? ["--staged", ...extra] : extra
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: dir, encoding: "utf8" })
  return { status: r.status ?? -1, out: r.stdout ?? "", err: r.stderr ?? "" }
}

describe("--staged — o recorte julga o ÍNDICE (o commit), não a árvore", () => {
  it("corpo quebrado NO ÍNDICE reprova MESMO com a árvore já corrigida", () => {
    const dir = makeRepo()
    writeWorkflow(dir, WF, CORPO_QUEBRADO)
    stage(dir, WF)
    // O editor já consertou o arquivo — mas o COMMIT ainda carrega o defeito.
    writeWorkflow(dir, WF, CORPO_SAO)

    const r = cli(dir)
    expect(r.status).toBe(EXIT.VIOLATIONS)
    expect(r.err).toContain(WF)
    expect(r.err).toContain("ERRO de sintaxe")
    // O relatório DIZ de onde veio o veredito (o recorte é visível, não mudo) —
    // e nomeia as TRÊS fontes do recorte, não só os workflows.
    expect(r.err).toContain("recorte --staged")
    expect(r.err).toContain("1 workflow(s) + 0 script(s) + 0 Dockerfile(s)/compose(s) do ÍNDICE")
  })

  it("o MESMO defeito só na ÁRVORE passa o recorte — e o gate da árvore reprova (o escopo é o índice)", () => {
    const dir = makeRepo()
    writeWorkflow(dir, WF, CORPO_SAO)
    stage(dir, WF)
    // Agora o defeito existe SÓ no working tree (não é deste commit).
    writeWorkflow(dir, WF, CORPO_QUEBRADO)

    const staged = cli(dir)
    expect(staged.status).toBe(EXIT.OK)
    expect(staged.out).toContain("DO ÍNDICE")

    // A contraprova: o gate da ÁRVORE (o que o CI roda) reprova o mesmo repo —
    // a diferença entre os dois vereditos é ESCOPO, não cegueira.
    const arvore = cli(dir, [], false)
    expect(arvore.status).toBe(EXIT.VIOLATIONS)
  })

  it("depois do `git add` da correção o mesmo recorte passa (o índice mudou, não o gate)", () => {
    const dir = makeRepo()
    writeWorkflow(dir, WF, CORPO_QUEBRADO)
    stage(dir, WF)
    expect(cli(dir).status).toBe(EXIT.VIOLATIONS)

    writeWorkflow(dir, WF, CORPO_SAO)
    stage(dir, WF)
    const r = cli(dir)
    expect(r.status).toBe(EXIT.OK)
    expect(r.out).toContain("1 corpo(s)")
  })

  it("o AVISO do heredoc conta no recorte também (o bash sai 0 e o gate reprova)", () => {
    const dir = makeRepo()
    writeWorkflow(dir, WF, CORPO_AVISO)
    stage(dir, WF)

    const r = cli(dir)
    expect(r.status).toBe(EXIT.VIOLATIONS)
    expect(r.err).toContain("com AVISO")
  })

  it("julga as DUAS forjas: um workflow da forja (dona do merge) no índice entra na varredura", () => {
    const dir = makeRepo()
    writeWorkflow(dir, WF_GITEA, CORPO_QUEBRADO)
    stage(dir, WF_GITEA)

    const r = cli(dir)
    expect(r.status).toBe(EXIT.VIOLATIONS)
    expect(r.err).toContain(WF_GITEA)
  })

  it("passo com `shell:` não-bash do índice é PULADO e NOMEADO (nunca contado como conferido)", () => {
    const dir = makeRepo()
    writeWorkflow(
      dir,
      WF,
      ["jobs:", "  a:", "    steps:", "      - run: print(1)", "        shell: python", ""].join(
        "\n",
      ),
    )
    stage(dir, WF)

    const r = cli(dir)
    expect(r.status).toBe(EXIT.OK)
    expect(r.out).toContain("shell NÃO-bash PRESENTE no runner")
    expect(r.out).toContain("python")
  })

  it("nada de workflow no índice → passa DIZENDO que não julgou nada (o vazio é visível)", () => {
    const dir = makeRepo()
    writeWorkflow(dir, WF, CORPO_QUEBRADO)
    // Um arquivo STAGED que não é workflow de forja: o recorte não se distrai.
    writeFileSync(join(dir, "notas.md"), "texto\n", "utf8")
    stage(dir, "notas.md")

    const r = cli(dir)
    expect(r.status).toBe(EXIT.OK)
    expect(r.out).toContain("nenhum workflow, script NEM Dockerfile/compose no ÍNDICE")
    expect(r.out).toContain("0 workflow(s) + 0 script(s) + 0 Dockerfile(s)/compose(s) do commit")
  })

  it("script de shell quebrado NO ÍNDICE reprova o recorte (a segunda fonte entra no commit)", () => {
    const dir = makeRepo()
    writeWorkflow(dir, "scripts/quebrado.sh", "#!/usr/bin/env bash\nif [ -f x ]; then\n")
    stage(dir, "scripts/quebrado.sh")

    const r = cli(dir)
    expect(r.status).toBe(EXIT.VIOLATIONS)
    expect(r.err).toContain("scripts/quebrado.sh")
    expect(r.err).toContain("interpretador: `bash`")
  })

  it("o hook do `.husky/` (SEM extensão) também é julgado — o recorte usa o mesmo `isShellScript`", () => {
    const dir = makeRepo()
    writeWorkflow(dir, ".husky/pre-commit", "set -eu\nif [ -f x ]; then\n")
    stage(dir, ".husky/pre-commit")

    const r = cli(dir)
    expect(r.status).toBe(EXIT.VIOLATIONS)
    expect(r.err).toContain(".husky/pre-commit")
    // E o `fonte` DIZ de onde veio a declaração: o hook não tem shebang, então a
    // premissa é a de quem o executa — nunca "fora do escopo" em silêncio.
    expect(r.err).toContain("premissa")
  })

  it("um `.sh` com shebang de OUTRA linguagem é PULADO e NOMEADO (o gate não julga o que não é bash)", () => {
    const dir = makeRepo()
    writeWorkflow(dir, "scripts/nao-bash.sh", "#!/usr/bin/env python3\nprint(1)\n")
    stage(dir, "scripts/nao-bash.sh")

    const r = cli(dir)
    expect(r.status).toBe(EXIT.OK)
    expect(r.out).toContain("fora do parsing")
    expect(r.out).toContain("scripts/nao-bash.sh")
  })

  it("um YAML fora de diretório de forja NÃO entra na varredura do recorte", () => {
    const dir = makeRepo()
    writeWorkflow(dir, ".github/notas.yml", CORPO_QUEBRADO)
    stage(dir, ".github/notas.yml")

    const r = cli(dir)
    expect(r.status).toBe(EXIT.OK)
    expect(r.out).toContain("0 workflow(s) + 0 script(s) + 0 Dockerfile(s)/compose(s) do commit")
  })

  it("um `.sh` quebrado só NA ÁRVORE não reprova o recorte (o escopo é o índice)", () => {
    const dir = makeRepo()
    writeWorkflow(dir, "scripts/bom.sh", "#!/usr/bin/env bash\necho oi\n")
    stage(dir, "scripts/bom.sh")
    // O defeito passa a existir SÓ no working tree: não é deste commit.
    writeWorkflow(dir, "scripts/bom.sh", "#!/usr/bin/env bash\nif [ -f x ]; then\n")

    expect(cli(dir).status).toBe(EXIT.OK)
    // A contraprova: o gate da ÁRVORE reprova o mesmo repositório (escopo, não cegueira).
    expect(cli(dir, [], false).status).toBe(EXIT.VIOLATIONS)
  })

  it("fora de um repositório git → exit 2 (fail-closed: sem índice não há recorte)", () => {
    const dir = makeDirWithoutGit()
    writeWorkflow(dir, WF, CORPO_SAO)

    const r = cli(dir)
    expect(r.status).toBe(EXIT.UNAVAILABLE)
    expect(r.err).toContain("ÍNDICE")
    expect(r.err).toContain("git diff --cached")
  })

  it("--json traz o recorte: `staged: true` e os arquivos do índice", () => {
    const dir = makeRepo()
    writeWorkflow(dir, WF, CORPO_SAO)
    stage(dir, WF)

    const r = cli(dir, ["--json"])
    expect(r.status).toBe(EXIT.OK)
    const data = JSON.parse(r.out) as { staged: boolean; arquivos: string[]; passos: number }
    expect(data.staged).toBe(true)
    expect(data.arquivos).toEqual([WF])
    expect(data.passos).toBe(1)
  })

  it("--root aponta o recorte para outro repo (o índice julgado é o do root)", () => {
    const dir = makeRepo()
    writeWorkflow(dir, WF, CORPO_QUEBRADO)
    stage(dir, WF)
    // cwd é OUTRO lugar (o repo do teste), e o root é o fixture.
    const r = spawnSync(process.execPath, [SCRIPT, "--staged", "--root", dir], { encoding: "utf8" })
    expect(r.status).toBe(EXIT.VIOLATIONS)
    expect(r.stderr).toContain(WF)
  })

  // ── A TERCEIRA FONTE (o shell EMBUTIDO) no recorte ──────────────────────
  //
  // O `RUN` de um Dockerfile e o payload de um `sh -c` entram no MESMO recorte
  // que os workflows e os scripts: o commit é quem carrega o texto quebrado, e
  // o escopo do pre-commit não pode ficar cego justamente na classe que a
  // reescrita mecânica produz com mais frequência (o `&& \` engolido).

  it("`RUN` de Dockerfile quebrado NO ÍNDICE reprova — mesmo com a árvore corrigida", () => {
    const dir = makeRepo()
    writeWorkflow(dir, "Dockerfile", "FROM alpine\nRUN set -euo pipefail && \\\n  echo dois &&\n")
    stage(dir, "Dockerfile")
    // A árvore é corrigida DEPOIS do `git add`: o que vai ao commit é o índice.
    writeWorkflow(dir, "Dockerfile", "FROM alpine\nRUN echo ok\n")

    const r = cli(dir)
    expect(r.status).toBe(EXIT.VIOLATIONS)
    expect(r.err).toContain("instrução(ões) EMBUTIDA(s)")
    expect(r.err).toContain("Dockerfile:2")
  })

  it("payload de `sh -c` quebrado num SCRIPT do índice reprova (e o `bash -n` do arquivo passaria)", () => {
    const dir = makeRepo()
    writeWorkflow(
      dir,
      "scripts/quebra.sh",
      '#!/usr/bin/env bash\nset -euo pipefail\nsh -c "if [ 1 = 1 ]; then echo sem fi"\n',
    )
    stage(dir, "scripts/quebra.sh")

    const r = cli(dir)
    expect(r.status).toBe(EXIT.VIOLATIONS)
    expect(r.err).toContain("payload(s) de `sh -c`/`bash -c`")
    expect(r.err).toContain("scripts/quebra.sh:3")
  })

  it("um Dockerfile de fora dos diretórios varridos entra pela NOME (nenhum alvo invisível no recorte)", () => {
    const dir = makeRepo()
    writeWorkflow(dir, "servicos/novo/Dockerfile.svc", "FROM alpine\nRUN echo ok\n")
    stage(dir, "servicos/novo/Dockerfile.svc")

    const r = cli(dir, ["--json"])
    expect(r.status).toBe(EXIT.OK)
    const data = JSON.parse(r.out) as {
      arquivosEmbutidos: string[]
      instrucoesEmbutidas: unknown[]
    }
    expect(data.arquivosEmbutidos).toEqual(["servicos/novo/Dockerfile.svc"])
    expect(data.instrucoesEmbutidas).toHaveLength(1)
  })
})
