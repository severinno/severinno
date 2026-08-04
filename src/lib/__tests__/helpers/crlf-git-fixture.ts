/**
 * crlf-git-fixture.ts
 *
 * Helpers compartilhados de fixture git para testes de CRLF em blobs —
 * extraídos de audit-blob-crlf-history.test.ts e validate-all-text-alert
 * .test.ts (mesmo padrão de fixture nos dois; antes duplicado).
 *
 * O contrato central: `core.autocrlf=false` — `git add` NÃO normaliza, então
 * o blob guarda os bytes crus (arquivo CRLF vira blob CRLF; arquivo LF vira
 * blob LF). `commitCrlfFile` cria o dir pai (recursive) para paths aninhados
 * (ex.: .husky/pre-commit, sub/dir/Makefile) — no-op seguro para raiz.
 *
 * `makeRepo()` registra todo dir criado num registry module-level; chame
 * `cleanupTmpDirs()` no `afterEach` do arquivo de teste para removê-los.
 * (Vitest roda com singleFork — registry compartilhado entre arquivos de
 * teste é seguro porque o cleanup é splice-based e roda após cada teste.)
 *
 * Usage:
 *   import { makeRepo, commitCrlfFile, blobHasCr, cleanupTmpDirs } from "@/lib/__tests__"
 *
 *   afterEach(() => cleanupTmpDirs())
 *   const dir = makeRepo()
 *   commitCrlfFile(dir, "bad.sh")
 *   expect(blobHasCr(dir, "bad.sh")).toBe(true)
 */

import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

const tmpDirs: string[] = []

const DEFAULT_CRLF_CONTENT = "#!/usr/bin/env bash\r\necho hi\r\n"
const DEFAULT_LF_CONTENT = "#!/usr/bin/env bash\necho hi\n"

/** autocrlf=false: `git add` NÃO normaliza — blob guarda os bytes crus (CRLF). */
export function makeRepo(prefix = "crlf-git-"): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tmpDirs.push(dir)
  execFileSync("git", ["init", "-q"], { cwd: dir })
  execFileSync("git", ["config", "user.email", "t@t"], { cwd: dir })
  execFileSync("git", ["config", "user.name", "t"], { cwd: dir })
  execFileSync("git", ["config", "core.autocrlf", "false"], { cwd: dir })
  return dir
}

/** Remove todos os fixtures temporários registrados por makeRepo(). */
export function cleanupTmpDirs(): void {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
}

/** Cria um arquivo com bytes CRLF e commita (blob fica CRLF com autocrlf=false). */
export function commitCrlfFile(dir: string, name: string, content = DEFAULT_CRLF_CONTENT): void {
  // mkdir do pai (ex.: .husky/pre-commit precisa do dir .husky) — path
  // ancorado do .gitattributes casa o caminho completo, não só o basename.
  // recursive:true num dir já existente é no-op — seguro para nomes na raiz.
  mkdirSync(join(dir, dirname(name)), { recursive: true })
  writeFileSync(join(dir, name), content)
  execFileSync("git", ["add", name], { cwd: dir })
  execFileSync("git", ["commit", "-qm", `add ${name}`], { cwd: dir })
}

/** Cria um arquivo LF e commita (controle limpo). */
export function commitLfFile(dir: string, name: string, content = DEFAULT_LF_CONTENT): void {
  writeFileSync(join(dir, name), content)
  execFileSync("git", ["add", name], { cwd: dir })
  execFileSync("git", ["commit", "-qm", `add ${name}`], { cwd: dir })
}

/**
 * Escreve um .gitattributes na raiz do fixture (não precisa de commit — o
 * --all-text DERIVA a lista lendo o arquivo do working tree via cwd).
 * Conteúdo default espelha o padrão `*.ext text eol=lf` do repo real.
 */
export function writeGitattributes(
  dir: string,
  content = "*.md text eol=lf\n*.ts text eol=lf\n*.yml text eol=lf\n*.sh text eol=lf\n",
): void {
  writeFileSync(join(dir, ".gitattributes"), content)
}

/** Byte-check direto do blob: tem CR (0x0D)? (git cat-file — sem pipe MSYS). */
export function blobHasCr(dir: string, path: string): boolean {
  // execFileSync já retorna Buffer — .includes(0x0d) é o byte-check do CR
  const blob = execFileSync("git", ["cat-file", "blob", `HEAD:${path}`], { cwd: dir })
  return blob.includes(0x0d)
}
