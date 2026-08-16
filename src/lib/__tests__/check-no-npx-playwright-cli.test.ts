/**
 * check-no-npx-playwright-cli.test.ts
 *
 * Testes CLI do guard scripts/check-no-npx-playwright.mjs — falha se alguém
 * reintroduzir `npx playwright` em docs/scripts/package.json.
 *
 * Contexto: no Windows o `npx` resolve uma instância DIFERENTE de
 * @playwright/test no grafo de módulos (shims .cmd do npm vs symlinks do bun)
 * e `npx playwright test` falhava em TODOS os specs E2E com 'did not expect
 * test.describe() to be called here'. Runner oficial: `bunx playwright`.
 *
 * Cobre:
 *   - fixture limpo (tudo bunx) → exit 0
 *   - scripts/*.sh com `npx playwright test` → exit 1 + arquivo citado
 *   - docs com `npx playwright install` em bloco de código → exit 1
 *   - package.json com script `npx playwright test` → exit 1
 *   - prosa do Troubleshooting ("`npx playwright` quebra") → exit 0 (isenta)
 *   - test-mutation-*.sh excluídos do scan → exit 0
 */

import { describe, it, expect, afterEach } from "vitest"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const GUARD = resolve(process.cwd(), "scripts/check-no-npx-playwright.mjs")

const tmpDirs: string[] = []

/** Fixture limpo: docs/README.md + scripts/run.sh + package.json, tudo bunx. */
function makeFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "no-npx-playwright-"))
  tmpDirs.push(dir)
  mkdirSync(join(dir, "docs"))
  mkdirSync(join(dir, "scripts"))
  writeFileSync(join(dir, "package.json"), '{\n  "scripts": { "e2e": "bun run e2e" }\n}\n')
  writeFileSync(
    join(dir, "docs", "README.md"),
    "# Fixture\n\nRunner oficial: `bunx playwright test`.\n",
  )
  writeFileSync(
    join(dir, "scripts", "run.sh"),
    "#!/usr/bin/env bash\nbunx playwright test e2e/x.spec.ts\n",
  )
  return dir
}

/** Output combinado stdout+stderr — o guard escreve violações no stderr. */
function outputOf(res: ReturnType<typeof run>): string {
  return `${res.stdout ?? ""}${res.stderr ?? ""}`
}

function run(dir: string) {
  return spawnSync(process.execPath, [GUARD, "--root", dir], { encoding: "utf8" })
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe("check-no-npx-playwright.mjs (CLI)", () => {
  it("exit 0 quando o fixture está limpo (tudo bunx)", () => {
    const dir = makeFixture()
    const res = run(dir)
    expect(res.status).toBe(0)
    expect(outputOf(res)).toContain("bunx")
  })

  it("exit 1 e cita o arquivo quando .sh reintroduz 'npx playwright test'", () => {
    const dir = makeFixture()
    writeFileSync(
      join(dir, "scripts", "run.sh"),
      "#!/usr/bin/env bash\nnpx playwright test e2e/x.spec.ts\n",
    )
    const res = run(dir)
    expect(res.status).toBe(1)
    expect(outputOf(res)).toContain("run.sh")
    expect(outputOf(res)).toContain("bunx playwright")
  })

  it("exit 1 quando docs têm 'npx playwright install' em bloco de código", () => {
    const dir = makeFixture()
    writeFileSync(
      join(dir, "docs", "README.md"),
      "# Fixture\n\n```sh\nnpx playwright install\n```\n",
    )
    const res = run(dir)
    expect(res.status).toBe(1)
    expect(outputOf(res)).toContain("README.md")
  })

  it("exit 1 quando package.json tem script com 'npx playwright'", () => {
    const dir = makeFixture()
    writeFileSync(
      join(dir, "package.json"),
      '{\n  "scripts": { "e2e": "npx playwright test" }\n}\n',
    )
    const res = run(dir)
    expect(res.status).toBe(1)
    expect(outputOf(res)).toContain("package.json")
  })

  it("exit 0 para prosa do Troubleshooting (menção documental, não é comando)", () => {
    const dir = makeFixture()
    writeFileSync(
      join(dir, "docs", "README.md"),
      [
        "# Fixture",
        "",
        "### Troubleshooting — `npx playwright` quebra no Windows",
        "",
        "> Sempre que um comando deste doc mostrar `npx playwright`, substitua por",
        "> `bunx playwright`.",
        "",
      ].join("\n"),
    )
    const res = run(dir)
    expect(res.status).toBe(0)
  })

  it("exit 0 quando test-mutation-*.sh contém o padrão (excluídos do scan)", () => {
    const dir = makeFixture()
    writeFileSync(
      join(dir, "scripts", "test-mutation-no-npx-playwright.sh"),
      "#!/usr/bin/env bash\nnpx playwright test e2e/x.spec.ts # fixture de mutation\n",
    )
    const res = run(dir)
    expect(res.status).toBe(0)
  })
})
