/**
 * doc-hashes-fixture.ts
 *
 * O FIXTURE da citação órfã — um repositório git DE VERDADE onde a prosa cita um
 * commit que uma DROBRA reescreveu. Compartilhado pelas três suítes que medem
 * esse defeito (o guard, o remédio e o canal do PR): a construção do estado é a
 * única coisa que elas têm em comum, e três cópias dela divergiriam na primeira
 * correção.
 *
 * O QUE A DROBRA É, aqui: `git commit --amend` com o MESMO assunto. O nome antigo
 * fica ÓRFÃO (o objeto continua no repositório — é o estado que um rebase, um
 * `--amend` ou a dobra de um conserto deixam) e o de MESMO assunto entra na
 * história. É esse par que o guard nomeia como candidato e o remédio troca.
 *
 * E O HASH CITADO É PROVADO COMO CITAÇÃO. `pareceCommit` exige ao menos uma letra
 * `a-f` (um número puro não é citação — a régua que evita os 78 falsos positivos
 * medidos em 22/09/2026), e um hash curto de 7 dígitos sai SÓ com algarismos em
 * ~2% das vezes. Sem repetir, o fixture deixaria de citar o que quer que fosse em
 * ~2% das execuções e mediria o remédio contra o vazio: medido, 2 falhas em 10
 * rodadas da suíte do remédio, com o guard julgando `citacoes: 0` sobre um
 * README.md que citava `2415416`. Um fixture que às vezes não tem o defeito é um
 * teste que às vezes não testa.
 */

import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { pareceCommit } from "../../../../scripts/check-doc-hashes.mjs"

/** O assunto do ato citado: é por ELE que o remédio acha o nome que a dobra deixou. */
export const ASSUNTO_DO_ATO = "feat(doc): o ato que a prosa cita"

const tmpDirs: string[] = []
const GIT_IDENTITY = [
  ["user.email", "hook@test.local"],
  ["user.name", "hook test"],
]

/**
 * A DATA de TODOS os commits do fixture, PINADA.
 *
 * O hash de um commit é função do CONTEÚDO + do autor/committer + do RELÓGIO —
 * e as suítes que usam este fixture constroem repositorios INDEPENDENTES e
 * exigem byte-igualdade entre eles (o remédio via `patch` de um e via `--fix`
 * de outro têm de produzir a mesma prosa). Com a data vindo do relógio, dois
 * repos construídos em segundos diferentes têm hashes diferentes — o teste
 * passa onde a construção cabe no MESMO segundo (máquina rápida, medido) e
 * reprova onde ela atravessa o segundo (medido na forja em 30/09/2026: o patch
 * do preview trouxe `faede52` enquanto o `--fix` gravava `5f87f3c` — a MESMA
 * construção, um segundo de diferença). Pinar a data torna o estado de partida
 * REPRODUÍVEL por construção, e não por sorte do relógio.
 */
const DATA_FIXA = "2026-01-01T00:00:00+0000"

/** Um `git` no diretório dado — erro ALTO: num fixture, git que não responde é o medidor quebrado. */
export function gitEm(dir: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: dir,
    encoding: "utf8",
    // A data pinada vai em TODAS as chamadas (inofensiva para as que não
    // commitam): um `--amend` define committer date AGORA quando ninguém a passa,
    // e a dobra do fixture é um `--amend` — sem o pin, ela re-introduz o relógio.
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: DATA_FIXA,
      GIT_COMMITTER_DATE: DATA_FIXA,
    },
  }).trim()
}

/** Um diretório temporário, registrado para a limpeza da suíte (`limparTmpDirs`). */
export function tmpDir(prefixo = "doc-hashes-"): string {
  const dir = mkdtempSync(join(tmpdir(), prefixo))
  tmpDirs.push(dir)
  return dir
}

/** A limpeza — chame no `afterEach`/`afterAll` da suíte. */
export function limparTmpDirs(): void {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
}

/** Garante o repositório git com identidade e um commit base (idempotente). */
export function garantirRepoComBase(dir: string): void {
  gitEm(dir, ["init", "-q"])
  for (const [chave, valor] of GIT_IDENTITY) gitEm(dir, ["config", chave, valor])
  if (!existsSync(join(dir, "README.md"))) writeFileSync(join(dir, "README.md"), "base\n", "utf8")
  try {
    gitEm(dir, ["rev-parse", "--verify", "--quiet", "HEAD"])
    return
  } catch {
    // Sem `HEAD` ainda: o base é o que dá HISTÓRIA ao fixture (e é a régua do guard).
  }
  gitEm(dir, ["add", "-A"])
  gitEm(dir, ["commit", "-qm", "base"])
}

/**
 * Um commit cujo nome fica ÓRFÃO depois de uma DROBRA de mesmo assunto — e com o
 * hash de 7 dígitos GARANTIDAMENTE uma citação (`pareceCommit`).
 *
 * As tentativas variam o conteúdo do arquivo de marca: o hash muda, o assunto não.
 * O commit abandonado (sem letra) fica no repositório e não é citado por ninguém —
 * exatamente como o reflog deixa o de uma rewrite real.
 */
function commitOrfao(dir: string, assunto: string): string {
  const marca = join(dir, "marca.txt")
  // As tentativas variam o CONTEÚDO do arquivo de marca: o hash muda, o assunto
  // não. O commit abandonado (sem letra) fica no repositório e não é citado por
  // ninguém — exatamente como o reflog deixa o de uma rewrite real.
  let orfao = ""
  for (let i = 0; i < 40; i++) {
    writeFileSync(marca, `v1-${i}\n`, "utf8")
    gitEm(dir, ["add", "-A"])
    gitEm(dir, ["commit", "-qm", assunto])
    orfao = gitEm(dir, ["rev-parse", "--short", "HEAD"])
    if (pareceCommit(orfao)) break
    gitEm(dir, ["reset", "-q", "--hard", "HEAD~1"])
  }
  if (!pareceCommit(orfao)) {
    throw new Error(`não consegui um hash de commit com letra em 40 tentativas: ${orfao}`)
  }
  return orfao
}

/**
 * A DROBRA de mesmo assunto: o nome antigo fica órfão e o novo entra na história
 * com o MESMO assunto — é o par que o remédio usa como candidato.
 */
function drobraDeMesmoAssunto(dir: string, orfao: string): string {
  writeFileSync(join(dir, "marca.txt"), "v2\n", "utf8")
  gitEm(dir, ["add", "-A"])
  gitEm(dir, ["commit", "-q", "--amend", "-m", ASSUNTO_DO_ATO])
  const vivo = gitEm(dir, ["rev-parse", "--short", "HEAD"])
  if (vivo === orfao) throw new Error("a dobra não reescreveu o nome do commit")
  return vivo
}

/** A prosa que cita um nome (o defeito: a doc descreve o ato que ninguém abre). */
export function citaProsa(dir: string, texto: string, arquivo = "README.md"): string {
  const path = join(dir, arquivo)
  writeFileSync(path, `${texto}\n`, "utf8")
  return path
}

/**
 * O fixture completo: um repo com HISTÓRIA onde a prosa cita o nome que a dobra
 * deixou morto. O `dir` sai com o base commitado e a citação NÃO commitada (a
 * árvore é o que o guard e o remédio leem).
 *
 * @param {{prefixo?: string, arquivo?: string, conteudo?: (hash: string) => string}} [opts]
 * @returns {{dir: string, orfao: string, vivo: string}}
 */
export function repoComCitacaoOrfaa(
  opts: { prefixo?: string; arquivo?: string; conteudo?: (hash: string) => string } = {},
): { dir: string; orfao: string; vivo: string } {
  const dir = tmpDir(opts.prefixo ?? "doc-hashes-orfao-")
  garantirRepoComBase(dir)
  const { orfao, vivo } = criarParDeReescrita(dir)
  citaProsa(dir, (opts.conteudo ?? ((h: string) => `o ato foi no \`${h}\``))(orfao), opts.arquivo)
  return { dir, orfao, vivo }
}

/**
 * O PAR de uma rewrite, no repo já preparado: o commit que a dobra vai reescrever
 * (o nome que fica ÓRFÃO) e o de MESMO assunto que entra na história (o nome vivo,
 * com o hash de 7 dígitos GARANTIDAMENTE uma citação).
 *
 * É a peça que a suíte do GUARD usa quando quer escrever a prosa por conta própria.
 */
export function criarParDeReescrita(
  dir: string,
  assunto = ASSUNTO_DO_ATO,
): { orfao: string; vivo: string } {
  const orfao = commitOrfao(dir, assunto)
  return { orfao, vivo: drobraDeMesmoAssunto(dir, orfao) }
}

/**
 * O OUTRO lado do mesmo defeito: a citação órfã SEM commit de mesmo assunto na
 * história. Não há nome que a dobra tenha deixado — o remédio mecânico não sabe
 * para onde trocar, e o caso pede a decisão de quem escreveu a citação.
 */
export function repoComCitacaoSemCandidato(
  opts: { prefixo?: string; arquivo?: string; conteudo?: (hash: string) => string } = {},
): { dir: string; orfao: string } {
  const dir = tmpDir(opts.prefixo ?? "doc-hashes-sem-candidato-")
  garantirRepoComBase(dir)
  const orfao = commitOrfao(dir, "um assunto que some")
  // O assunto sai da história inteira: nada casa com ele em `HEAD`.
  // O assunto sai da história inteira: nada casa com ele em `HEAD`.
  gitEm(dir, ["reset", "-q", "--hard", "HEAD~1"])
  citaProsa(dir, (opts.conteudo ?? ((h: string) => `o ato foi no \`${h}\``))(orfao), opts.arquivo)
  return { dir, orfao }
}

/** Um repo git com história e SEM defeito nenhum (o CONTROLE). */
export function repoLimpo(opts: { prefixo?: string } = {}): string {
  const dir = tmpDir(opts.prefixo ?? "doc-hashes-limpo-")
  garantirRepoComBase(dir)
  citaProsa(dir, "a prosa sem citação nenhuma")
  return dir
}

/** Um repo git SEM commit nenhum: não há história contra a qual julgar uma citação. */
export function repoSemHistoria(opts: { prefixo?: string } = {}): string {
  const dir = tmpDir(opts.prefixo ?? "doc-hashes-sem-historia-")
  gitEm(dir, ["init", "-q"])
  return dir
}
