/**
 * audit-blob-crlf-history.test.ts
 *
 * Testes do auditor scripts/audit_blob_crlf_history.py (wrapper
 * scripts/audit-blob-crlf-history.sh) — varre TODO o histórico alcançável
 * (`git rev-list --all --objects` + `git cat-file --batch`) e detecta
 * blobs cujo conteúdo contém CR (0x0D).
 *
 * Escopo (extendido 2026-08): por padrão o gate audita apenas .sh/.bash
 * (CRLF QUEBRA bash em containers Linux). `--all-text` audita os tipos com
 * `text eol=lf` no .gitattributes em modo REPORT (exit 0 sempre) — a
 * LISTA É DERIVADA do arquivo em runtime (scripts/audit_blob_crlf_history
 * .py load_all_text_patterns parseia as linhas `text eol=lf` — sufixos
 * `*.ext` E nomes exatos/globs sem extensão: Makefile, Caddyfile*,
 * Dockerfile*, .prettierrc, .husky/*), não hardcoded: um tipo novo
 * adicionado ao .gitattributes entra na auditoria sem editar o script (sem
 * risco de drift). Mapeia o alcance real de CRLF em blobs commitados ANTES
 * do .gitattributes sem virar gate (CRLF nesses tipos não quebra
 * toolchain). Fail-closed: sem .gitattributes, --all-text sai com exit 2
 * (nunca audita '0 blobs' de fonte ausente). `--extensions ext1,ext2,...`
 * força uma lista explícita de sufixos (não requer .gitattributes).
 *
 * Cobre:
 *   - gate default: .sh CRLF commitado → exit 1 + listado
 *   - gate default: repo limpo → exit 0
 *   - --all-text: .md/.ts/.yml CRLF commitados → exit 0 (REPORT) + listados
 *   - --all-text: repo limpo → exit 0
 *   - DERIVAÇÃO: tipo novo (.toml) no .gitattributes auditado sem editar o script
 *   - DERIVAÇÃO: `*.png binary` / `* text=auto` NÃO entram na lista derivada
 *   - NOME EXATO: Makefile/.prettierrc (sem extensão) são auditados (basename)
 *   - GLOB: Dockerfile* casa Dockerfile.worker; .husky/* casa .husky/pre-commit
 *   - COMPLEMENTO: foo.bash auditado pelo glob *.bash (não declarado no arquivo)
 *   - FORA: arquivo sem extensão NÃO declarado no .gitattributes fica fora
 *   - FAIL-CLOSED: --all-text sem .gitattributes → exit 2
 *   - --extensions .md: detecta .md CRLF em modo GATE (exit 1)
 *   - escopo: .ts CRLF NÃO aparece no gate default (.sh/.bash apenas)
 */

import { describe, it, expect, afterEach } from "vitest"
import { spawnSync } from "node:child_process"
import { resolve } from "node:path"
import { resolveBash } from "@/lib/__tests__/helpers/bash-resolver"
import {
  makeRepo,
  commitCrlfFile,
  commitLfFile,
  writeGitattributes,
  cleanupTmpDirs,
} from "@/lib/__tests__"

const AUDIT = resolve(process.cwd(), "scripts/audit-blob-crlf-history.sh")

function run(repoDir: string, args: string[] = []) {
  return spawnSync(resolveBash(), [AUDIT, ...args], {
    cwd: repoDir,
    encoding: "utf8",
    env: { ...process.env, CHECK_CRLF_ROOT: repoDir },
  })
}

afterEach(() => {
  cleanupTmpDirs()
})

// ── Gate default (.sh/.bash) ─────────────────────────────────────────────

describe("audit-blob-crlf-history.sh (gate default .sh/.bash)", () => {
  it("exit 1 e lista o .sh quando blob histórico tem CRLF", () => {
    const dir = makeRepo()
    commitCrlfFile(dir, "bad.sh")

    const res = run(dir)
    expect(res.status).toBe(1)
    expect(res.stdout).toContain("bad.sh")
    expect(res.stdout).toContain("1 bloco(s) com CRLF")
  })

  it("exit 0 quando o histórico é limpo (LF)", () => {
    const dir = makeRepo()
    commitLfFile(dir, "ok.sh")

    const res = run(dir)
    expect(res.status).toBe(0)
    expect(res.stdout).toContain("OK")
  })

  it("ESCOPO: .ts com CRLF NÃO aparece no gate default (só .sh/.bash)", () => {
    const dir = makeRepo()
    commitCrlfFile(dir, "component.ts", "export const a = 1;\r\n")
    commitLfFile(dir, "ok.sh")

    const res = run(dir)
    expect(res.status).toBe(0) // gate .sh/.bash não vê .ts
    expect(res.stdout).not.toContain("component.ts")
  })
})

// ── --all-text (REPORT: todos os tipos do .gitattributes) ───────────────

describe("audit-blob-crlf-history.sh --all-text (REPORT, lista derivada do .gitattributes)", () => {
  it("exit 0 (REPORT) mas lista .md/.ts/.yml CRLF commitados", () => {
    const dir = makeRepo()
    // ORDEM IMPORTANTE: os blobs CRLF são commitados ANTES do .gitattributes
    // (com `*.md text eol=lf` no working tree, o git NORMALIZA CRLF→LF no
    // check-in e o blob sairia LF — o cenário do audit é exatamente o blob
    // CRLF commitado ANTES da proteção, que reproduz CRLF em checkouts).
    commitCrlfFile(dir, "old.md", "# Título\r\n\r\nCorpo\r\n")
    commitCrlfFile(dir, "old.ts", "export const a = 1;\r\n")
    commitCrlfFile(dir, "old.yml", "key: value\r\n")
    commitLfFile(dir, "ok.sh")
    writeGitattributes(dir) // .md/.ts/.yml/.sh — fonte da derivação (depois)

    const res = run(dir, ["--all-text"])
    // REPORT: exit 0 sempre (CRLF em tipos benignos não é gate)
    expect(res.status).toBe(0)
    expect(res.stdout).toContain("old.md")
    expect(res.stdout).toContain("old.ts")
    expect(res.stdout).toContain("old.yml")
    expect(res.stdout).toContain("3 bloco(s) com CRLF")
    expect(res.stdout).toContain("Modo REPORT")
  })

  it("exit 0 quando o histórico está limpo em todos os tipos", () => {
    const dir = makeRepo()
    writeGitattributes(dir)
    commitLfFile(dir, "ok.sh")
    commitLfFile(dir, "doc.md", "# Título\n\nCorpo\n")
    commitLfFile(dir, "mod.ts", "export const a = 1;\n")

    const res = run(dir, ["--all-text"])
    expect(res.status).toBe(0)
    expect(res.stdout).toContain("OK")
  })

  it("DERIVAÇÃO: tipo novo no .gitattributes é auditado sem editar o script", () => {
    const dir = makeRepo()
    // Blob CRLF commitado ANTES do .gitattributes (mesma ordem do cenário
    // real — com o .toml declarado antes, o git normalizaria no check-in).
    commitCrlfFile(dir, "conf.toml", 'key = "value"\r\n')
    commitLfFile(dir, "ok.sh")
    // Adiciona um tipo NOVO (ex.: .toml) ao .gitattributes — a lista do
    // --all-text deve incluí-lo automaticamente (era constante hardcoded;
    // agora é derivada — sem risco de drift).
    writeGitattributes(dir, "*.md text eol=lf\n*.toml text eol=lf\n")

    const res = run(dir, ["--all-text"])
    expect(res.status).toBe(0)
    expect(res.stdout).toContain("conf.toml")
    expect(res.stdout).toContain("1 bloco(s) com CRLF")
  })

  it("DERIVAÇÃO: extensão sem 'text eol=lf' (ex.: binary) NÃO entra na lista", () => {
    const dir = makeRepo()
    writeGitattributes(dir, "*.md text eol=lf\n*.png binary\n* text=auto\n")
    commitCrlfFile(dir, "img.png", "\x89PNG\r\nnot-text")
    commitLfFile(dir, "ok.sh")

    const res = run(dir, ["--all-text"])
    expect(res.status).toBe(0)
    // .png é binary (não text eol=lf) → fora da derivação → não auditado
    expect(res.stdout).not.toContain("img.png")
  })

  it("FAIL-CLOSED: --all-text sem .gitattributes → exit 2 (nunca audita '0 blobs' de fonte ausente)", () => {
    const dir = makeRepo()
    commitCrlfFile(dir, "old.md", "# Título\r\n\r\nCorpo\r\n")

    const res = run(dir, ["--all-text"])
    expect(res.status).toBe(2)
    expect(res.stderr).toContain(".gitattributes")
  })

  it("NOME EXATO: Makefile (sem extensão) declarado no .gitattributes é auditado (basename)", () => {
    const dir = makeRepo()
    // Blobs CRLF ANTES do .gitattributes (senão `Makefile text eol=lf`
    // normalizaria no check-in e o blob sairia LF).
    commitCrlfFile(dir, "Makefile", "all:\r\n\techo hi\r\n")
    commitCrlfFile(dir, "doc.md", "# Título\r\n")
    writeGitattributes(dir, "*.md text eol=lf\nMakefile text eol=lf\n")

    const res = run(dir, ["--all-text"])
    expect(res.status).toBe(0)
    expect(res.stdout).toContain("doc.md")
    expect(res.stdout).toContain("Makefile")
    expect(res.stdout).toContain("2 bloco(s) com CRLF")
  })

  it("NOME EXATO EM PROFUNDIDADE: sub/dir/Makefile (basename sem extensão em qualquer nível)", () => {
    const dir = makeRepo()
    // Makefile em subdiretório — o match de nome exato do .gitattributes é
    // por BASENAME em qualquer profundidade (mesma semântica do git attrs:
    // padrão sem '/' casa a última componente do path). O teste da raiz não
    // prova isso — este fecha a lacuna.
    commitCrlfFile(dir, "sub/dir/Makefile", "all:\r\n\techo hi\r\n")
    writeGitattributes(dir, "Makefile text eol=lf\n")

    const res = run(dir, ["--all-text"])
    expect(res.status).toBe(0)
    expect(res.stdout).toContain("sub/dir/Makefile")
    expect(res.stdout).toContain("1 bloco(s) com CRLF")
  })

  it("CASE-INSENSITIVE: Foo.MD é casado pelo padrão *.md (matcher IGNORECASE)", () => {
    const dir = makeRepo()
    // O matcher é case-insensitive (re.IGNORECASE) — Foo.MD casa `*.md`.
    // Justifica manter o filtro Python: o pathspec do git é case-sensitive
    // e NÃO casaria Foo.MD (ver docstring do audit — 'WHY NOT git-side').
    commitCrlfFile(dir, "Foo.MD", "# Título\r\n\r\nCorpo\r\n")
    writeGitattributes(dir, "*.md text eol=lf\n")

    const res = run(dir, ["--all-text"])
    expect(res.status).toBe(0)
    expect(res.stdout).toContain("Foo.MD")
    expect(res.stdout).toContain("1 bloco(s) com CRLF")
  })

  it("GLOB de prefixo: Dockerfile* casa Dockerfile.worker (sem extensão)", () => {
    const dir = makeRepo()
    commitCrlfFile(dir, "Dockerfile.worker", "FROM node:20\r\n")
    writeGitattributes(dir, "Dockerfile* text eol=lf\n")

    const res = run(dir, ["--all-text"])
    expect(res.status).toBe(0)
    expect(res.stdout).toContain("Dockerfile.worker")
  })

  it("COMPLEMENTO: foo.bash (sufixo .bash não declarado no .gitattributes) é auditado pelo glob *.bash", () => {
    const dir = makeRepo()
    commitCrlfFile(dir, "foo.bash", "#!/usr/bin/env bash\r\necho hi\r\n")
    writeGitattributes(dir, "*.sh text eol=lf\n")

    const res = run(dir, ["--all-text"])
    expect(res.status).toBe(0)
    expect(res.stdout).toContain("foo.bash")
  })

  it("PATH-ANCHORED: .husky/* casa .husky/pre-commit (não só basename)", () => {
    const dir = makeRepo()
    commitCrlfFile(dir, ".husky/pre-commit", "set -e\r\n")
    writeGitattributes(dir, ".husky/* text eol=lf\n")

    const res = run(dir, ["--all-text"])
    expect(res.status).toBe(0)
    expect(res.stdout).toContain(".husky/pre-commit")
  })

  it("FORA: arquivo sem extensão NÃO declarado no .gitattributes não é auditado", () => {
    const dir = makeRepo()
    commitCrlfFile(dir, "NOTES", "sem extensão e sem declaração\r\n")
    commitCrlfFile(dir, "doc.md", "# Título\r\n")
    writeGitattributes(dir, "*.md text eol=lf\n")

    const res = run(dir, ["--all-text"])
    expect(res.status).toBe(0)
    expect(res.stdout).toContain("doc.md")
    expect(res.stdout).not.toContain("NOTES")
  })
})

// ── --extensions (lista explícita em modo GATE) ──────────────────────────

describe("audit-blob-crlf-history.sh --extensions (gate explícito)", () => {
  it("--extensions .md detecta .md CRLF com exit 1 (gate)", () => {
    const dir = makeRepo()
    commitCrlfFile(dir, "old.md", "# Título\r\n\r\nCorpo\r\n")

    const res = run(dir, ["--extensions", ".md"])
    expect(res.status).toBe(1)
    expect(res.stdout).toContain("old.md")
  })

  it("--extensions ignora extensões fora da lista", () => {
    const dir = makeRepo()
    commitCrlfFile(dir, "old.md", "# Título\r\n\r\nCorpo\r\n")
    commitCrlfFile(dir, "bad.sh")

    const res = run(dir, ["--extensions", ".md"])
    expect(res.status).toBe(1)
    expect(res.stdout).toContain("old.md")
    expect(res.stdout).not.toContain("bad.sh")
  })

  it("--extensions= (forma com sinal de igual) também funciona", () => {
    const dir = makeRepo()
    commitCrlfFile(dir, "old.md", "# Título\r\n\r\nCorpo\r\n")

    const res = run(dir, ["--extensions=.md"])
    expect(res.status).toBe(1)
    expect(res.stdout).toContain("old.md")
  })

  it("--extensions sem valor → exit 2 (fail-closed)", () => {
    const dir = makeRepo()
    const res = run(dir, ["--extensions"])
    expect(res.status).toBe(2)
  })

  it("argumento desconhecido → exit 2", () => {
    const dir = makeRepo()
    const res = run(dir, ["--bogus"])
    expect(res.status).toBe(2)
  })
})
