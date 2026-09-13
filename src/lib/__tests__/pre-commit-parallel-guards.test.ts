/**
 * pre-commit-parallel-guards.test.ts
 *
 * Prova, executando o ARQUIVO REAL do hook `.husky/pre-commit`, que QUALQUER
 * guard das fases paralelas derruba o commit — não só o último.
 *
 * O defeito medido: `wait pid1 pid2 ...` devolve o status de APENAS UM dos
 * PIDs (o último da lista) tanto no dash (via `sh -e`, que é como o husky
 * invoca o hook) quanto no bash (Git for Windows). Um guard que não seja o
 * último podia reprovar e o commit seguia.
 *
 * Como a prova roda o hook de verdade sem exigir bun/node/git reais: o hook
 * é SOMADO num wrapper que substitui os binários que ele chama por FUNÇÕES
 * (node/bun/bash/git). Os comandos de guard continuam sendo os do arquivo
 * real, o `wait_all` é o do arquivo real, e o que se mede é o comportamento
 * do hook — não o de um fixture paralelo que poderia divergir dele.
 *
 * A mutação (`^wait_all ` → `wait `) é aplicada sobre o mesmo arquivo real:
 * revertida a agregação, o guard não-último volta a passar batido e o hook
 * termina 0 — se alguém reintroduzir `wait $PIDS`, este teste falha.
 *
 * Usage:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/pre-commit-parallel-guards.test.ts
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { afterAll, describe, expect, it } from "vitest"
import { resolveBash } from "@/lib/__tests__/helpers/bash-resolver"

const REPO_ROOT = process.cwd()
const HOOK = join(REPO_ROOT, ".husky", "pre-commit")
const HOOK_SOURCE = readFileSync(HOOK, "utf8")

/**
 * Wrapper que SOMA o hook real (`. "$HOOK_UNDER_TEST"`) depois de trocar os
 * binários por funções. `_stub` reprova (code configurável) quando qualquer
 * argumento contém `$STUB_FAIL`; sem `STUB_FAIL`, tudo passa.
 *
 * `return` e não `exit`: o hook chama `bun x lint-staged` DIRETO (não em
 * background), e um `exit` dentro do stub encerraria o wrapper ali — foi
 * assim que a primeira versão deste harness mentiu (a mutação "passava"
 * porque o hook morria antes de terminar, não porque a fase foi engolida).
 */
const WRAPPER = `set -eu

_stub() {
  if [ -n "\${STUB_FAIL:-}" ]; then
    for _a in "$@"; do
      case "$_a" in
        *"$STUB_FAIL"*) return "\${STUB_CODE:-3}" ;;
      esac
    done
  fi
  return 0
}
node() { _stub "$@"; }
bun() { _stub "$@"; }
bash() { _stub "$@"; }
git() { return 0; }

. "$HOOK_UNDER_TEST"
echo "HOOK_COMPLETOU"
`

const dirs: string[] = []

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

interface RunResult {
  status: number | null
  stdout: string
  stderr: string
}

/** Roda o hook (real ou mutado) com um guard escolhido reprovando. */
function runHook(opts: { hookSource: string; fail?: string; code?: number }): RunResult {
  const dir = mkdtempSync(join(tmpdir(), "pre-commit-guards-"))
  dirs.push(dir)
  const hookPath = join(dir, "hook-under-test")
  writeFileSync(hookPath, opts.hookSource, "utf8")
  const wrapperPath = join(dir, "wrapper.sh")
  writeFileSync(wrapperPath, WRAPPER, "utf8")

  const res = spawnSync(resolveBash(), [wrapperPath], {
    encoding: "utf8",
    timeout: 30_000,
    env: {
      ...process.env,
      HOOK_UNDER_TEST: hookPath,
      STUB_FAIL: opts.fail ?? "",
      STUB_CODE: String(opts.code ?? 3),
    },
  })
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" }
}

/** Trecho da função `wait_all` do hook real, para rodá-la nas duas cascas. */
function extractWaitAll(source: string): string {
  const match = source.match(/^wait_all\(\) \{[\s\S]*?^\}/m)
  if (!match) throw new Error("wait_all() não encontrada em .husky/pre-commit")
  return match[0]
}

/** Mutação: o defeito antigo — `wait_all $P1 $P2` volta a ser `wait $P1 $P2`. */
function mutate(hookSource: string): string {
  return hookSource.replace(/^wait_all /gm, "wait ")
}

// ── estrutura do hook ────────────────────────────────────────────────────

describe("a agregação dos guards paralelos", () => {
  it("define wait_all e o chama nas duas fases paralelas", () => {
    expect(HOOK_SOURCE).toMatch(/^wait_all\(\) \{/m)
    const calls = HOOK_SOURCE.match(/^wait_all /gm) ?? []
    expect(calls).toHaveLength(2) // fase A + fase B
  })

  it("nunca volta a `wait` com mais de um PID (o defeito)", () => {
    // `wait $PID_A $PID_B ...` = status só do último; `wait "$_pid"` da
    // função é o único uso legítimo e não casa este padrão.
    expect(HOOK_SOURCE).not.toMatch(/^\s*wait\s+\$PID_[A-Z_]*\s+\$PID_/m)
  })

  it("a agregação é POSIX: derruba nas duas cascas que o husky usa", () => {
    const fn = extractWaitAll(HOOK_SOURCE)
    const script = `${fn}\n(exit 3) & a=$!\n(exit 0) & b=$!\nwait_all $a $b\n`
    const run = (shell: string) => spawnSync(shell, ["-c", script], { encoding: "utf8" })

    expect(run(resolveBash()).status).toBe(3)
    // `/bin/sh` é o dash no Linux (é o `sh -e` que o husky usa); no Windows
    // não existe e o bash acima já cobre a casca real do Git for Windows.
    if (existsSync("/bin/sh")) expect(run("/bin/sh").status).toBe(3)
  })
})

// ── o hook real (stubs) ──────────────────────────────────────────────────

describe("o hook real bloqueia por qualquer guard da fase", () => {
  it("controle: com tudo verde o hook chega ao fim (exit 0)", () => {
    const res = runHook({ hookSource: HOOK_SOURCE })
    expect(res.stderr).not.toContain("wait_all")
    expect(res.status).toBe(0)
    expect(res.stdout).toContain("HOOK_COMPLETOU")
  })

  it("guard NÃO-ÚLTIMO da fase A (primeiro de quatro) derruba o hook", () => {
    const res = runHook({ hookSource: HOOK_SOURCE, fail: "check-bun-mirror", code: 3 })
    expect(res.status).toBe(3)
    expect(res.stdout).not.toContain("HOOK_COMPLETOU")
  })

  it("guard NÃO-ÚLTIMO da fase B (primeiro de sete) derruba o hook", () => {
    const res = runHook({ hookSource: HOOK_SOURCE, fail: "barrel-lint", code: 5 })
    expect(res.status).toBe(5)
    expect(res.stdout).not.toContain("HOOK_COMPLETOU")
  })

  it("o ÚLTIMO guard da fase B também derruba (não-regressão)", () => {
    const res = runHook({
      hookSource: HOOK_SOURCE,
      fail: "check:forge-workflow-scope",
      code: 7,
    })
    expect(res.status).toBe(7)
    expect(res.stdout).not.toContain("HOOK_COMPLETOU")
  })
})

// ── mutação ──────────────────────────────────────────────────────────────

describe("mutação: o defeito antigo volta a engolir o guard não-último", () => {
  it("`wait $PIDS` (sem agregação) deixa o commit passar com a fase A reprovada", () => {
    const mutated = mutate(HOOK_SOURCE)
    expect(mutated).not.toBe(HOOK_SOURCE) // a mutação precisa aplicar de fato

    const res = runHook({ hookSource: mutated, fail: "check-bun-mirror", code: 3 })
    // O status do último PID (0) sobrevive ao do primeiro (3) — é exatamente
    // o defeito. Como o teste acima exige 3 para o hook real, esta é a prova
    // de que a expectativa detecta a regressão.
    expect(res.status).toBe(0)
    expect(res.stdout).toContain("HOOK_COMPLETOU")
  })
})
