/**
 * audit-secret-leaks.test.ts
 *
 * Testes do script scripts/audit-secret-leaks.mjs — auditoria de segredos
 * vazados no histórico do git (git log -p --all + regex).
 *
 * Cobre:
 *   - parseDiffPath: extrai o caminho de `diff --git a/... b/...` (com e sem
 *     aspas para paths com espaço)
 *   - parseHunkHeader: extrai a linha inicial do arquivo NOVO de `@@ -a,b +c,d @@`
 *   - scanHistory (função pura):
 *       - detecta chave privada (BEGIN RSA PRIVATE KEY)
 *       - detecta token com prefixo (sk-, ghp_, AKIA)
 *       - detecta atribuição de secret (.env: SESSION_SECRET=, API_KEY=)
 *       - SÓ linhas ADICIONADAS ('+') são candidatas (remoção não conta)
 *       - NÃO conta secrets de fixtures (sk-test-..., __tests__) por padrão,
 *         e conta quando --include-tests
 *       - lineNo acompanha os hunks (linha correta no arquivo novo)
 *   - CLI real (spawnSync + temp git repo com secrets FAKE commitados):
 *       - exit 1 com --check quando encontra (e 0 sem --check)
 *       - output mascarada (nunca imprime o segredo completo)
 *       - exit 2 fora de repo git
 *
 * ATENÇÃO: os "segredos" usados nos fixtures são FAKES (sk-test-...,
 * ghp_TEST_...), nunca valores reais — o próprio padrão de fixture garante
 * que o script os ignore por padrão.
 *
 * Usage:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/audit-secret-leaks.test.ts
 */

import { describe, it, expect, afterEach } from "vitest"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import {
  parseDiffPath,
  parseHunkHeader,
  scanHistory,
} from "../../../scripts/audit-secret-leaks.mjs"

const SCRIPT = resolve(process.cwd(), "scripts/audit-secret-leaks.mjs")
const tmpDirs: string[] = []

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "sec-audit-"))
  tmpDirs.push(dir)
  execFileSync("git", ["init", "-q"], { cwd: dir })
  execFileSync("git", ["config", "user.email", "t@t"], { cwd: dir })
  execFileSync("git", ["config", "user.name", "t"], { cwd: dir })
  return dir
}

function commitFile(dir: string, file: string, content: string, msg: string) {
  const full = join(dir, file)
  mkdirSync(dirname(full), { recursive: true }) // subpastas (ex.: test-fixtures/)
  writeFileSync(full, content, "utf8")
  execFileSync("git", ["add", file], { cwd: dir })
  execFileSync("git", ["commit", "-qm", msg], { cwd: dir })
}

function runAudit(dir: string, args: string[] = []) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: dir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

// ── parseDiffPath ─────────────────────────────────────────────────────────

describe("parseDiffPath", () => {
  it("extrai o caminho do arquivo novo de diff --git", () => {
    expect(parseDiffPath("diff --git a/src/a.ts b/src/a.ts")).toBe("src/a.ts")
  })

  it("lida com paths entre aspas (espaços)", () => {
    expect(parseDiffPath('diff --git "a/my file.sh" "b/my file.sh"')).toBe("my file.sh")
  })

  it("retorna null para linha que não é diff --git", () => {
    expect(parseDiffPath("index 123..456 100644")).toBeNull()
  })
})

// ── parseHunkHeader ───────────────────────────────────────────────────────

describe("parseHunkHeader", () => {
  it("extrai a primeira linha do arquivo novo", () => {
    expect(parseHunkHeader("@@ -12,4 +15,6 @@")).toBe(15)
  })

  it("aceita hunk sem contagem", () => {
    expect(parseHunkHeader("@@ -1 +1 @@")).toBe(1)
  })

  it("retorna null para linha que não é hunk", () => {
    expect(parseHunkHeader("+line")).toBeNull()
  })
})

// ── scanHistory (função pura) ─────────────────────────────────────────────

describe("scanHistory", () => {
  const LOG = `commit 1111111aaaaaaaaa
Author: T <t@t>
Date:   ...
    feat: adiciona config

diff --git a/config/settings.json b/config/settings.json
index 000..111
--- a/config/settings.json
+++ b/config/settings.json
@@ -0,0 +1,2 @@
+{
+  "apiKey": "sk-test-deadbeefcafe0000"
+}
`

  it("detecta token com prefixo sk- (linha adicionada)", () => {
    const f = scanHistory(LOG)
    expect(f.length).toBeGreaterThan(0)
    expect(f[0].id).toBe("token com prefixo")
    expect(f[0].masked.startsWith("sk-t")).toBe(true)
    expect(f[0].masked).toContain("chars")
    expect(f[0].file).toBe("config/settings.json")
    expect(f[0].line).toBe(2)
    expect(f[0].commit).toBe("1111111aaaaaaaaa")
  })

  it("detecta chave privada PEM", () => {
    const log = `commit 2222222bbbbbbbbb
diff --git a/secrets/id_rsa b/secrets/id_rsa
@@ -0,0 +1,3 @@
+-----BEGIN RSA PRIVATE KEY-----
+MIIEowIBAAKCAQEA1234567890
+-----END RSA PRIVATE KEY-----
`
    const f = scanHistory(log)
    expect(f.length).toBeGreaterThan(0)
    expect(f[0].id).toBe("chave privada")
  })

  it("detecta atribuição de secret estilo .env", () => {
    const log = `commit 3333333cccccccc
diff --git a/.env b/.env
@@ -1,1 +1,2 @@
 SESSION_SECRET=old
+DB_PASSWORD=supersecretpassword123
`
    const f = scanHistory(log)
    expect(f.length).toBe(1)
    expect(f[0].id).toBe("atribuição de secret")
    expect(f[0].key).toBe("DB_PASSWORD")
  })

  it("SÓ linhas ADICIONADAS contam (remoção não é achado)", () => {
    const log = `commit 4444444dddddddd
diff --git a/.env b/.env
@@ -1,2 +1,1 @@
-DB_PASSWORD=supersecretpassword123
`
    expect(scanHistory(log)).toEqual([])
  })

  it("NÃO expõe o segredo no campo key de padrões de 1 grupo (token/privada)", () => {
    // PREFIX_TOKEN_RE tem 1 grupo — o valor inteiro está em m[1]. Antes do
    // fix, key = m[1] vazava o token completo no output (regressão travada).
    const log = `commit 7777777abcdef123
diff --git a/token.txt b/token.txt
@@ -0,0 +1,1 @@
+sk-test-superlongsecretvalue123456789
`
    const f = scanHistory(log)
    expect(f.length).toBe(1)
    expect(f[0].key).toBeNull() // key NULL para padrão de 1 grupo — não vaza
    expect(f[0].masked).not.toContain("superlongsecretvalue")
  })

  it("ignora fixtures (sk-test-...) por padrão e conta com --include-tests", () => {
    const log = `commit 5555555eeeeeeee
diff --git a/test-fixtures/fake.env b/test-fixtures/fake.env
@@ -0,0 +1,1 @@
+API_KEY=sk-test-deadbeefcafe0000
`
    expect(scanHistory(log)).toEqual([])
    const withTests = scanHistory(log, { includeTests: true })
    expect(withTests.length).toBe(1)
  })

  it("acompanha lineNo entre hunks (linha correta no arquivo novo)", () => {
    const log = `commit 6666666ffffffff
diff --git a/app.ts b/app.ts
@@ -0,0 +1,1 @@
+import x from "x"
@@ -5,1 +6,1 @@
 const y = 1
+const z = 2
`
    const f = scanHistory(log)
    expect(f.length).toBe(0) // nada sensível — apenas não quebra
  })
})

// ── CLI real (temp git repo com secrets FAKE) ─────────────────────────────

describe("audit-secret-leaks.mjs — CLI real", () => {
  it("detecta secret commitado: exit 1 com --check, 0 sem", () => {
    const dir = makeRepo()
    commitFile(dir, "config.json", '{"apiKey": "sk-test-deadbeefcafe0000"}\n', "adds token")

    const plain = runAudit(dir)
    expect(plain.status).toBe(0)
    expect(plain.stdout).toContain("config.json")

    const check = runAudit(dir, ["--check"])
    expect(check.status).toBe(1)
  })

  it("output mascarada — nunca imprime o segredo completo", () => {
    const dir = makeRepo()
    const secret = "sk-test-superlongsecretvalue123456789"
    commitFile(dir, "app.env", `API_KEY=${secret}\n`, "adds env secret")

    const res = runAudit(dir)
    expect(res.status).toBe(0)
    expect(res.stdout).not.toContain(secret) // só os 4 primeiros chars + tamanho
    expect(res.stdout).toContain(secret.slice(0, 4))
  })

  it("ignora fixtures por padrão (sk-test-... em test-fixtures)", () => {
    const dir = makeRepo()
    commitFile(dir, "test-fixtures/dummy.env", "TOKEN=sk-test-fakefakefakefake\n", "fixture")

    const res = runAudit(dir)
    expect(res.status).toBe(0)
    expect(res.stdout).toContain("nenhum segredo")
  })

  it("exit 2 fora de repo git", () => {
    const dir = mkdtempSync(join(tmpdir(), "sec-audit-nogit-"))
    tmpDirs.push(dir)
    const res = runAudit(dir)
    expect(res.status).toBe(2)
  })

  it("--json devolve count e findings parseáveis", () => {
    const dir = makeRepo()
    commitFile(dir, "secrets.json", '{"token": "sk-test-jsonvalue000011112222"}\n', "adds")

    const res = runAudit(dir, ["--json"])
    expect(res.status).toBe(0)
    const parsed = JSON.parse(res.stdout)
    expect(parsed.count).toBeGreaterThan(0)
    expect(parsed.findings[0].file).toBe("secrets.json")
  })
})
