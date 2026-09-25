/**
 * prove-stack-per-commit.test.ts
 *
 * Testes de scripts/prove-stack-per-commit.mjs — a régua do commit que nasce
 * vermelho, e o RECORTE que a leva para o caminho do push.
 *
 * POR QUE o recorte precisa de prova própria: o pre-push passou a medir os
 * commits do MEIO que o push leva, e o que faz isso caber no caminho do push é a
 * AMOSTRA. Uma amostra mal escolhida não é um detalhe de custo — ela é um
 * veredito: sorteada, o MESMO push mede commits diferentes a cada vez (o vermelho
 * aparece e some sem ninguém mudar nada); sem o mais antigo, o commit que ficou
 * mais tempo na pilha — e mais longe de quem lê o diff — nunca é medido; e se ela
 * devolvesse "tudo verde" sem dizer o que pulou, "não medido" viraria "passa",
 * que é exatamente a classe de defeito que o harness existe para fechar.
 *
 * O teste trava o que decide o veredito, em três camadas:
 *
 *   1. a leitura do PROTOCOLO do pre-push (o stdin que o git escreve): linha
 *      malformada é IGNORADA e CONTADA — o parser não derruba um push por um
 *      formato inesperado, e também não inventa ref que o git não mandou;
 *   2. a derivação dos commits que o push LEVA: a união `remote_sha..local_sha`,
 *      com o ref NOVO (sha do remoto todo zero) dependendo da BASE declarada —
 *      e `null` (INDETERMINADO), nunca "a história inteira", quando não há base;
 *   3. a AMOSTRA determinística: o mais antigo sempre dentro, os pulados
 *      NOMEADOS, e `medidos + pulados = o recorte` (nada inventado, nada perdido).
 *
 * A última unidade é a CLI no caminho COMUM (um push de um commit só não tem
 * MEIO): o recorte é vazio, e "nada a medir" é um FATO medido — não um silêncio.
 *
 * A VARREDURA do resíduo tem prova própria, e ela é a que fecha o defeito MEDIDO
 * neste repositório (151 worktrees e ~11 GB em `/tmp/pilha-*`): uma execução MORTA
 * nunca chega ao `rmSync` do fim. O que a suíte trava aqui não é "o código apaga
 * diretórios" — apagar por padrão de nome mataria a medição de outro processo — é
 * que o DONO declarado decide: pid vivo no mesmo host fica, `--keep` fica e é dito,
 * marcador alheio ou ilegível NÃO é tocado, e o resto é varrido. As duas metades
 * de execução são complementares: o SINAL (SIGTERM) impede o resíduo de NASCER, e
 * o `kill -9` deixa o resíduo que a varredura da execução seguinte recolhe.

 * Execução focada:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/prove-stack-per-commit.test.ts
 */

import { spawn, spawnSync } from "node:child_process"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterAll, describe, expect, it } from "vitest"

import {
  AMOSTRA_PADRAO,
  EXIT,
  FERRAMENTA,
  MARCADOR_DO_DONO,
  WORKTREE_PREFIXO,
  amostrar,
  commitsDoPush,
  criarWorktree,
  hostAtual,
  limparResiduos,
  limparWorktreeAtual,
  pidVivo,
  recorteVazio,
  refsDoPush,
  registrarWorktreeAtual,
  removerWorktree,
  renderLimpeza,
  renderRecorteVazio,
  worktreeEmCurso,
} from "../../../scripts/prove-stack-per-commit.mjs"

/**
 * A raiz do repositório medido. A suíte roda do root (é o mesmo `cwd` de que a
 * CLI abaixo depende): o módulo é resolvido por caminho ABSOLUTO porque o filho
 * da prova de execução o importa de outro processo.
 */
const RAIZ = process.cwd()
/** O módulo REAL — o filho da prova de execução importa este caminho. */
const MODULO = join(RAIZ, "scripts/prove-stack-per-commit.mjs")

/** O sha que o git manda para um ref que o remoto ainda não tem. */
const ZERO = "0".repeat(40)
/** Shas de verdade de mentira: o parser exige a FORMA do sha (40 ou 64 hex). */
const A = "a".repeat(40)
const B = "b".repeat(40)
const C = "c".repeat(40)

/** Um `git` de mentira que REGISTRA os argumentos e devolve o que for dito. */
function gitStub(saida: string, registro: string[][] = []) {
  const git = (args: string[]) => {
    registro.push(args)
    return saida
  }
  return { git, registro }
}

const linha = (localSha: string, remoteSha: string) =>
  `refs/heads/x ${localSha} refs/heads/x ${remoteSha}`

describe("refsDoPush — o protocolo do pre-push", () => {
  it("lê as quatro colunas de cada ref que sai", () => {
    const { refs, ignoradas } = refsDoPush(
      `${linha(B, A)}\nrefs/heads/y ${C} refs/heads/y ${ZERO}\n`,
    )
    expect(refs).toHaveLength(2)
    expect(refs[0]).toEqual({
      localRef: "refs/heads/x",
      localSha: B,
      remoteRef: "refs/heads/x",
      remoteSha: A,
    })
    expect(refs[1].remoteSha).toBe(ZERO)
    expect(ignoradas).toEqual([])
  })

  it("linha malformada é IGNORADA e CONTADA — nunca derruba o push por formato", () => {
    const { refs, ignoradas } = refsDoPush(
      `lixo no meio\nrefs/heads/x ${B} refs/heads/x ${A}\nrefs/heads/x ${B} refs/heads/x\n`,
    )
    expect(refs).toHaveLength(1)
    expect(ignoradas).toEqual(
      ["lixo no meio", "refs/heads/x b refs/heads/x"].map((l, i) =>
        i === 1 ? l.replace(/\bb\b/, B) : l,
      ),
    )
  })

  it("quatro colunas SEM sha não são um ref — senão um dado estranho viraria 'nada a medir'", () => {
    // A linha tem quatro tokens e NENHUM sha: o git nunca manda isso, e aceitá-la
    // faria o recorte sair VAZIO (um verde por um dado que não é do protocolo).
    const { refs, ignoradas } = refsDoPush("algo com tres campos\n")
    expect(refs).toEqual([])
    expect(ignoradas).toEqual(["algo com tres campos"])
  })

  it("sem protocolo (hook rodado à mão) não há ref nenhuma — e nada é inventado", () => {
    expect(refsDoPush("").refs).toEqual([])
    expect(refsDoPush("\n   \n").refs).toEqual([])
  })
})

describe("commitsDoPush — os commits que ESTE push leva", () => {
  it("é a união `remote_sha..local_sha`, do mais antigo ao mais novo", () => {
    const { git, registro } = gitStub("c1\nc2\nc3")
    const r = commitsDoPush({ git, refs: refsDoPush(linha(B, A)).refs, base: null })
    expect(r.commits).toEqual(["c1", "c2", "c3"])
    expect(r.origem).toBe("remote_sha..local_sha")
    // O `--not` NEGATIVA o que o remoto já tem: é a diferença entre "a pilha do
    // push" e "a história do branch".
    expect(registro[0]).toEqual(["rev-list", "--reverse", "--topo-order", B, "--not", A])
  })

  it("ref NOVO: a base DECLARADA delimita (o remoto não tem o que negativar)", () => {
    const { git, registro } = gitStub("c1")
    const r = commitsDoPush({
      git,
      refs: refsDoPush(linha(B, ZERO)).refs,
      base: { ref: "origin/main", origem: "--base" },
    })
    expect(r.commits).toEqual(["c1"])
    expect(r.origem).toContain("1 ref(s) NOVO(s): base origin/main")
    expect(registro[0]).toEqual([
      "rev-list",
      "--reverse",
      "--topo-order",
      B,
      "--not",
      "origin/main",
    ])
  })

  it("ref NOVO SEM base resolvida: INDETERMINADO (`null`), nunca a história inteira", () => {
    const { git } = gitStub("c1\nc2")
    const r = commitsDoPush({
      git,
      refs: refsDoPush(linha(B, ZERO)).refs,
      base: { ref: null, origem: "nenhuma" },
    })
    expect(r.commits).toBeNull()
    expect(r.origem).toBe("ref NOVO sem base resolvida")
  })

  it("push de remoção (só o sha do local zerado) não tem o que medir", () => {
    const { git, registro } = gitStub("")
    const r = commitsDoPush({ git, refs: refsDoPush(linha(ZERO, A)).refs, base: null })
    expect(r.commits).toEqual([])
    expect(r.origem).toContain("só remoções")
    expect(registro).toHaveLength(0)
  })

  it("git que não responde devolve lista VAZIA — e não um verde inventado", () => {
    const { git } = gitStub("")
    expect(commitsDoPush({ git, refs: refsDoPush(linha(B, A)).refs, base: null }).commits).toEqual(
      [],
    )
  })
})

describe("amostrar — o RECORTE que cabe no push", () => {
  const commits = Array.from({ length: 12 }, (_, i) => `c${String(i).padStart(2, "0")}`)

  it("amostra maior que o recorte mede TUDO (não há o que cortar)", () => {
    const { medidos, pulados } = amostrar(commits, 12)
    expect(medidos).toEqual(commits)
    expect(pulados).toEqual([])
    expect(amostrar(commits, 99).medidos).toEqual(commits)
  })

  it("12 commits com amostra 6: o mais ANTIGO dentro, os outros espaçados, os pulados NOMEADOS", () => {
    const { medidos, pulados } = amostrar(commits, 6)
    // As posições são as do arredondamento da fração (0, 2,4, 6,6→7, 8,8→9, 11):
    // a régua é determinística, e é ela que o teste trava — não uma lista escolhida.
    expect(medidos).toEqual(["c00", "c02", "c04", "c07", "c09", "c11"])
    expect(pulados).toEqual(["c01", "c03", "c05", "c06", "c08", "c10"])
    // NADA inventado e nada perdido: o recorte é exatamente a união das duas listas.
    expect([...medidos, ...pulados].sort()).toEqual([...commits].sort())
  })

  it("a amostra é DETERMINÍSTICA — o mesmo push mede os MESMOS commits", () => {
    expect(amostrar(commits, 5)).toEqual(amostrar(commits, 5))
    expect(AMOSTRA_PADRAO).toBe(6)
  })

  it("amostra 1 mede só o MAIS ANTIGO — o commit que ficou mais tempo na pilha", () => {
    const { medidos } = amostrar(commits, 3)
    expect(medidos[0]).toBe("c00")
    expect(amostrar(commits, 1)).toEqual({ medidos: ["c00"], pulados: commits.slice(1) })
  })

  it("amostra inválida (0, negativa, não-inteira) não corta nada — nunca um recorte vazio por acidente", () => {
    expect(amostrar(commits, 0).medidos).toEqual(commits)
    expect(amostrar(commits, -3).medidos).toEqual(commits)
    expect(amostrar(commits, 2.5).medidos).toEqual(commits)
  })
})

describe("o recorte VAZIO — o caminho comum, MEDIDO", () => {
  it("diz por que não havia o que medir, e que isso foi medido (não presumido)", () => {
    const texto = renderRecorteVazio({
      recorte: {
        refs: 1,
        ignoradas: 0,
        noRecorte: 1,
        semTopo: true,
        amostra: AMOSTRA_PADRAO,
        medidos: 0,
        pulados: [],
        origem: "remote_sha..local_sha",
        negativos: ["aaa"],
      },
    })
    expect(texto).toContain("NADA A MEDIR")
    expect(texto).toContain("MEDIDO, não presumido")
    expect(texto).toContain("refs: 1")
  })

  it("o JSON do recorte vazio tem a MESMA forma do relatório cheio (um parser, não dois)", () => {
    const j = recorteVazio({ pulados: [], noRecorte: 0 }, "remote_sha..local_sha", "bbb")
    expect(j.commits).toBe(0)
    expect(j.veredito).toBe("ok")
    expect(j.resultados).toEqual([])
    expect(j.recorte.noRecorte).toBe(0)
  })

  it("a CLI sai 0 com o recorte vazio (um push de um commit não tem MEIO)", () => {
    const head = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim()
    const cli = spawnSync(
      "node",
      ["scripts/prove-stack-per-commit.mjs", "--pushed", "--sem-topo", "--refs", linha(head, head)],
      { encoding: "utf8" },
    )
    expect(cli.status).toBe(EXIT.OK)
    expect(cli.stdout).toContain("NADA A MEDIR")
  })
})

/** O sha que a suíte mede: o HEAD do repositório real (a base do fixture). */
const shaDoHead = () =>
  spawnSync("git", ["-C", RAIZ, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim()

/** Todos os `tmp` que os casos criaram — o `afterAll` limpa o que sobrou. */
const TMP_DO_TESTE: string[] = []

/** Um diretório temporário DO TESTE — a varredura enumera SÓ o `tmp` injetado. */
function tmpDoTeste() {
  const dir = mkdtempSync(join(tmpdir(), "residuo-teste-"))
  TMP_DO_TESTE.push(dir)
  return dir
}

/**
 * A suíte limpa o que CRIOU — inclusive quando um caso FALHA (o `rmSync` do fim
 * de cada caso não roda num vermelho, e os `criarWorktree` registram no git do
 * repositório REAL, porque é ele que a prova de execução mede). Sem isto, uma
 * execução vermelha da suíte vira... o resíduo que esta suíte existe para medir.
 */
afterAll(() => {
  for (const tmp of TMP_DO_TESTE) {
    for (const dir of worktreesRegistrados().filter((d) => d.startsWith(`${tmp}/`))) {
      spawnSync("git", ["-C", RAIZ, "worktree", "remove", "--force", dir], { encoding: "utf8" })
    }
    try {
      // O caso da remoção NEGADA deixa o `tmp` sem o bit de escrita.
      chmodSync(tmp, 0o700)
    } catch {
      // Diretório já removido: nada a restaurar.
    }
    rmSync(tmp, { recursive: true, force: true })
  }
  // O metadado de um worktree cujo diretório sumiu fica listado para sempre.
  spawnSync("git", ["-C", RAIZ, "worktree", "prune", "--expire", "now"], { encoding: "utf8" })
})

/** Um `pilha-*` de mentira, com o dono declarado (ou sem marcador nenhum). */
function residuo(tmp: string, nome: string, dono: Record<string, unknown> | null) {
  const base = join(tmp, `${WORKTREE_PREFIXO}${nome}`)
  mkdirSync(join(base, "w"), { recursive: true })
  if (dono) writeFileSync(join(base, MARCADOR_DO_DONO), `${JSON.stringify(dono, null, 2)}\n`)
  return base
}

/**
 * Um pid que NÃO existe. O número sai do `pid_max` do kernel (onde nada é
 * agendado) e é CONFERIDO com o próprio `pidVivo` — um teste que presumisse
 * "999999 está morto" ficaria verde por coincidência de host.
 */
function pidMorto() {
  let max = 4194304
  try {
    max = Number(readFileSync("/proc/sys/kernel/pid_max", "utf8").trim()) || max
  } catch {
    // Sem /proc: o teto de fallback já está acima de qualquer pid vivo.
  }
  for (let p = max - 1; p > max - 64; p--) if (!pidVivo(p)) return p
  return max - 1
}

/** Os diretórios que o GIT registra como worktree do repositório. */
function worktreesRegistrados(root = RAIZ) {
  const out = spawnSync("git", ["-C", root, "worktree", "list", "--porcelain"], {
    encoding: "utf8",
  }).stdout
  return (out || "")
    .split("\n")
    .filter((l) => l.startsWith("worktree "))
    .map((l) => l.slice("worktree ".length))
}

describe("pidVivo — a vida do dono é medida, não presumida", () => {
  it("o pid DESTA execução está vivo; um pid fora da tabela de processos está morto", () => {
    expect(pidVivo(process.pid)).toBe(true)
    expect(pidVivo(pidMorto())).toBe(false)
  })

  it("pid inválido (0, negativo, NaN, ausente) NÃO é dono vivo — e não varre nada por engano", () => {
    // A direção importa: `pidVivo(0)` é FALSO, então um marcador com `pid: 0`
    // libera a varredura em vez de fingir uma execução em curso.
    for (const p of [0, -1, Number.NaN, undefined, null, "1", 1.5])
      expect(pidVivo(p as number)).toBe(false)
  })
})

describe("criarWorktree — o dono vai DECLARADO ao lado do worktree", () => {
  it("declara ferramenta, pid, host, sha e keep, e o fim remove o diretório E o metadado", () => {
    const tmp = tmpDoTeste()
    const sha = shaDoHead()
    const wt = criarWorktree({ root: RAIZ, sha, tmp })
    expect("erro" in wt).toBe(false)
    const w = wt as { base: string; dir: string; dono: Record<string, unknown> }

    const dono = JSON.parse(readFileSync(join(w.base, MARCADOR_DO_DONO), "utf8")) as Record<
      string,
      unknown
    >
    expect(dono.ferramenta).toBe(FERRAMENTA)
    expect(dono.pid).toBe(process.pid)
    expect(dono.host).toBe(hostAtual())
    expect(dono.sha).toBe(sha)
    expect(dono.keep).toBe(false)
    expect(dono.dir).toBe(w.dir)
    expect(existsSync(join(w.dir, ".git"))).toBe(true)
    expect(worktreesRegistrados()).toContain(w.dir)

    removerWorktree({ root: RAIZ, base: w.base, dir: w.dir })
    expect(existsSync(w.base)).toBe(false)
    expect(worktreesRegistrados()).not.toContain(w.dir)
    rmSync(tmp, { recursive: true, force: true })
  })

  it("um `--keep` declara a intenção no marcador (o que a varredura seguinte lê)", () => {
    const tmp = tmpDoTeste()
    const wt = criarWorktree({ root: RAIZ, sha: shaDoHead(), keep: true, tmp })
    const w = wt as { base: string; dir: string }
    const dono = JSON.parse(readFileSync(join(w.base, MARCADOR_DO_DONO), "utf8")) as Record<
      string,
      unknown
    >
    expect(dono.keep).toBe(true)
    if (w) removerWorktree({ root: RAIZ, base: w.base, dir: w.dir })
    rmSync(tmp, { recursive: true, force: true })
  })
})

describe("limparResiduos — o DONO decide, nunca o nome do diretório", () => {
  it("dono MORTO: varrido por inteiro — o diretório E o metadado órfão do git", () => {
    const tmp = tmpDoTeste()
    const wt = criarWorktree({ root: RAIZ, sha: shaDoHead(), tmp })
    const w = wt as { base: string; dir: string; dono: Record<string, unknown> }
    // A execução MORREU (timeout, kill -9): o que fica é o marcador apontando
    // para um pid que já não existe. É o único dado que autoriza a varredura.
    writeFileSync(
      join(w.base, MARCADOR_DO_DONO),
      `${JSON.stringify({ ...w.dono, pid: pidMorto() }, null, 2)}\n`,
    )

    const r = limparResiduos({ root: RAIZ, tmp })
    expect(r.varridos.map((v) => v.nome)).toEqual([w.base.split("/").pop()])
    expect(existsSync(w.base)).toBe(false)
    // O metadado do git vai junto: um diretório que sumiu sem `prune` deixa o
    // repositório listando um worktree que não existe.
    expect(worktreesRegistrados()).not.toContain(w.dir)
    rmSync(tmp, { recursive: true, force: true })
  })

  it("pid VIVO no MESMO host: preservado (é outra medição em curso, não resíduo)", () => {
    const tmp = tmpDoTeste()
    const base = residuo(tmp, "viva", {
      ferramenta: FERRAMENTA,
      pid: process.pid,
      host: hostAtual(),
      sha: "a".repeat(40),
      keep: false,
    })
    const r = limparResiduos({ root: RAIZ, tmp })
    expect(r.varridos).toEqual([])
    expect(r.emUso).toHaveLength(1)
    expect(existsSync(base)).toBe(true)
    rmSync(tmp, { recursive: true, force: true })
  })

  it("o pid de OUTRO host não é evidência de vida AQUI — o marcador de fora é varrido", () => {
    // O número do pid só é comparável dentro do mesmo host: um pid vivo local que
    // o marcador diz ser de outro host NÃO é prova de que alguém está medindo.
    const tmp = tmpDoTeste()
    const base = residuo(tmp, "outrohost", {
      ferramenta: FERRAMENTA,
      pid: process.pid,
      host: "outro-host",
      sha: "b".repeat(40),
      keep: false,
    })
    const r = limparResiduos({ root: RAIZ, tmp })
    expect(r.emUso).toEqual([])
    expect(r.varridos.map((v) => v.host)).toEqual(["outro-host"])
    expect(existsSync(base)).toBe(false)
    rmSync(tmp, { recursive: true, force: true })
  })

  it("`--keep` do dono: preservado, e DITO (o `--keep` deixa de ser letra morta)", () => {
    const tmp = tmpDoTeste()
    const base = residuo(tmp, "keep", {
      ferramenta: FERRAMENTA,
      pid: pidMorto(),
      host: hostAtual(),
      sha: "c".repeat(40),
      keep: true,
    })
    const r = limparResiduos({ root: RAIZ, tmp })
    expect(r.preservados).toHaveLength(1)
    expect(r.varridos).toEqual([])
    expect(existsSync(base)).toBe(true)
    rmSync(tmp, { recursive: true, force: true })
  })

  it("sem marcador legível ou de OUTRA ferramenta: NÃO É TOCADO, e o motivo é nomeado", () => {
    const tmp = tmpDoTeste()
    const semMarcador = residuo(tmp, "semmarcador", null)
    const deOutra = residuo(tmp, "deoutra", { ferramenta: "outra-ferramenta", pid: pidMorto() })
    const ilegivel = join(tmp, `${WORKTREE_PREFIXO}ilegivel`)
    mkdirSync(join(ilegivel, "w"), { recursive: true })
    writeFileSync(join(ilegivel, MARCADOR_DO_DONO), "{ isto não é JSON")
    // Um diretório que NÃO é `pilha-*` nem entra na enumeração.
    const alheio = join(tmp, "outro-temp")
    mkdirSync(alheio, { recursive: true })

    const r = limparResiduos({ root: RAIZ, tmp })
    expect(r.varridos).toEqual([])
    expect(r.naoMeus.map((n) => n.nome).sort()).toEqual(
      [
        `${WORKTREE_PREFIXO}deoutra`,
        `${WORKTREE_PREFIXO}ilegivel`,
        `${WORKTREE_PREFIXO}semmarcador`,
      ].sort(),
    )
    expect(r.naoMeus.map((n) => n.motivo).join(" ")).toContain("outra-ferramenta")
    expect(r.naoMeus.map((n) => n.motivo).join(" ")).toContain("sem marcador legível")
    for (const d of [semMarcador, deOutra, ilegivel, alheio]) expect(existsSync(d)).toBe(true)
    rmSync(tmp, { recursive: true, force: true })
  })

  it("tmp ilegível: nenhuma varredura e nenhum crash — a varredura nunca derruba a medição", () => {
    const r = limparResiduos({ root: RAIZ, tmp: join(tmpdir(), "nao-existe-" + Date.now()) })
    expect(r).toEqual({
      varridos: [],
      naoRemovidos: [],
      preservados: [],
      emUso: [],
      naoMeus: [],
      podados: null,
    })
  })

  it("host que NEGA a remoção: o resíduo NÃO entra como varrido — ele é dito, e fica", () => {
    // A leitura falsa que este caso fecha: `remove` que falha em silêncio com o
    // relatório dizendo "varrido" — o resíduo continua no disco e ninguém sabe.
    // (Como root o bit de escrita é ignorado: aí não há host que negue.)
    if (process.getuid?.() === 0) return
    const tmp = tmpDoTeste()
    const base = residuo(tmp, "teimoso", {
      ferramenta: FERRAMENTA,
      pid: pidMorto(),
      host: hostAtual(),
      sha: "f".repeat(40),
      keep: false,
    })
    chmodSync(tmp, 0o500)
    const r = limparResiduos({ root: RAIZ, tmp })
    expect(r.varridos).toEqual([])
    expect(r.naoRemovidos.map((v) => v.nome)).toEqual([`${WORKTREE_PREFIXO}teimoso`])
    expect(existsSync(base)).toBe(true)
    // A varredura que FALHA também é DITA — em texto, não só no dado.
    expect(renderLimpeza(r).join("\n")).toContain("NÃO pôde ser varrido")
    chmodSync(tmp, 0o700)
    rmSync(tmp, { recursive: true, force: true })
  })
})

describe("a limpeza da medição EM CURSO — o sinal e o registro", () => {
  it("o worktree registrado é removido por inteiro, e o registro fica VAZIO (idempotente)", () => {
    const tmp = tmpDoTeste()
    const wt = criarWorktree({ root: RAIZ, sha: shaDoHead(), tmp })
    const w = wt as { base: string; dir: string }
    registrarWorktreeAtual(w as unknown as Record<string, unknown>)
    expect(worktreeEmCurso()).toBe(w)

    limparWorktreeAtual({ root: RAIZ })
    expect(existsSync(w.base)).toBe(false)
    expect(worktreesRegistrados()).not.toContain(w.dir)
    // Idempotente: um segundo sinal (ou o `finally`) não pode explodir.
    limparWorktreeAtual({ root: RAIZ })
    expect(worktreeEmCurso()).toBeNull()
    rmSync(tmp, { recursive: true, force: true })
  })
})

describe("a interrupção REAL: o SINAL impede o resíduo de nascer, o `kill -9` deixa o que a varredura recolhe", () => {
  /**
   * O filho é o processo de VERDADE: ele instala a limpeza no sinal, cria o
   * worktree pelo caminho do módulo, registra e fica vivo. Publicar o caminho
   * antes de morrer é o que permite medir o disco DEPOIS da morte — de fora.
   */
  const FILHO = `
import { criarWorktree, instalarLimpezaNoSinal, registrarWorktreeAtual } from ${JSON.stringify(MODULO)}
instalarLimpezaNoSinal({ root: ${JSON.stringify(RAIZ)} })
const wt = criarWorktree({ root: ${JSON.stringify(RAIZ)}, sha: ${JSON.stringify(shaDoHead())} })
if (wt.erro) { console.error("ERRO " + wt.erro); process.exit(3) }
registrarWorktreeAtual(wt)
console.log("WORKTREE " + wt.base)
setInterval(() => {}, 1000)
`

  function filhoNoWorktree(tmp: string) {
    const filho = spawn(process.execPath, ["--input-type=module", "-e", FILHO], {
      // O `TMPDIR` do filho é o do TESTE: o resíduo dele nasce num lugar que a
      // varredura do teste enumera, nunca o `/tmp` compartilhado deste host.
      env: { ...process.env, TMPDIR: tmp },
      stdio: ["ignore", "pipe", "pipe"],
    })
    let erro = ""
    filho.stderr.on("data", (d) => (erro += String(d)))
    const pronto = new Promise<string>((resolve, reject) => {
      let saida = ""
      const prazo = setTimeout(
        () => reject(new Error(`o filho não publicou o worktree: ${saida} ${erro}`)),
        60_000,
      )
      filho.stdout.on("data", (d) => {
        saida += String(d)
        const m = /^WORKTREE (.*)$/m.exec(saida)
        if (m) {
          clearTimeout(prazo)
          resolve(m[1].trim())
        }
      })
      filho.on("error", reject)
    })
    const saida = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
      filho.on("exit", (code, signal) => resolve({ code, signal }))
    })
    return { filho, pronto, saida }
  }

  it(
    "SIGTERM (o timeout e o ^C): a execução interrompida NÃO deixa o worktree dela",
    {
      timeout: 120_000,
    },
    async () => {
      const tmp = tmpDoTeste()
      const { filho, pronto, saida } = filhoNoWorktree(tmp)
      const base = await pronto
      expect(existsSync(base)).toBe(true)

      filho.kill("SIGTERM")
      const r = await saida
      expect(r.code).toBe(143)
      expect(existsSync(base)).toBe(false)
      expect(worktreesRegistrados()).not.toContain(join(base, "w"))
      expect(limparResiduos({ root: RAIZ, tmp }).varridos).toEqual([])
      rmSync(tmp, { recursive: true, force: true })
    },
  )

  it(
    "`kill -9` (o sinal que não dá para tratar): o resíduo NASCE, e a varredura seguinte o recolhe",
    {
      timeout: 120_000,
    },
    async () => {
      const tmp = tmpDoTeste()
      const { filho, pronto, saida } = filhoNoWorktree(tmp)
      const base = await pronto

      filho.kill("SIGKILL")
      const r = await saida
      expect(r.signal).toBe("SIGKILL")
      // O resíduo existe de verdade — é o defeito medido (151 worktrees, ~11 GB).
      expect(existsSync(base)).toBe(true)
      expect(worktreesRegistrados()).toContain(join(base, "w"))

      const limpeza = limparResiduos({ root: RAIZ, tmp })
      expect(limpeza.varridos.map((v) => v.nome)).toEqual([base.split("/").pop()])
      expect(existsSync(base)).toBe(false)
      expect(worktreesRegistrados()).not.toContain(join(base, "w"))
      rmSync(tmp, { recursive: true, force: true })
    },
  )
})

describe("a varredura entra na CLI e é DITA — no caminho comum e no dado de máquina", () => {
  const donoMorto = (sha: string) => ({
    ferramenta: FERRAMENTA,
    pid: pidMorto(),
    host: hostAtual(),
    sha,
    keep: false,
  })

  it("o relatório nomeia a varredura: silêncio num resíduo limpo seria o defeito, mais discreto", () => {
    const tmp = tmpDoTeste()
    const base = residuo(tmp, "morta", donoMorto("d".repeat(40)))
    const head = shaDoHead()
    const cli = spawnSync(
      "node",
      ["scripts/prove-stack-per-commit.mjs", "--pushed", "--sem-topo", "--refs", linha(head, head)],
      { encoding: "utf8", env: { ...process.env, TMPDIR: tmp } },
    )
    expect(cli.status).toBe(EXIT.OK)
    expect(cli.stdout).toContain("resíduo de execuções MORTAS: 1 varrido(s)")
    expect(cli.stdout).toContain(base.split("/").pop() as string)
    expect(existsSync(base)).toBe(false)
    rmSync(tmp, { recursive: true, force: true })
  })

  it("o `--json` leva a varredura como DADO (quem lê a máquina vê o que foi limpo)", () => {
    const tmp = tmpDoTeste()
    residuo(tmp, "morta2", donoMorto("e".repeat(40)))
    // Um preservado e um fora do escopo para provar que o JSON distingue os três.
    residuo(tmp, "viva2", { ferramenta: FERRAMENTA, pid: process.pid, host: hostAtual() })
    residuo(tmp, "alheio2", null)
    const head = shaDoHead()
    const cli = spawnSync(
      "node",
      [
        "scripts/prove-stack-per-commit.mjs",
        "--pushed",
        "--sem-topo",
        "--json",
        "--refs",
        linha(head, head),
      ],
      { encoding: "utf8", env: { ...process.env, TMPDIR: tmp } },
    )
    const j = JSON.parse(cli.stdout) as {
      limpeza: { varridos: Array<{ nome: string }>; emUso: unknown[]; naoMeus: unknown[] }
    }
    expect(j.limpeza.varridos.map((v) => v.nome)).toEqual([`${WORKTREE_PREFIXO}morta2`])
    expect(j.limpeza.emUso).toHaveLength(1)
    expect(j.limpeza.naoMeus).toHaveLength(1)
    rmSync(tmp, { recursive: true, force: true })
  })
})

describe("a DÍVIDA da pilha — o veredito separa dívida declarada de regressão", () => {
  const VERMELHO_A = "fix(count): o ato de 39 formas entra JUNTO da matriz"
  const VERMELHO_A_CONTINUADO = VERMELHO_A + " (a segunda metade da fila)"
  const VERMELHO_NOVO = "feat(z): nenhum registro declara este assunto"

  /** Um resultado vermelho, no formato que `main` produz. */
  const vermelho = (sha: string, assunto: string) => ({
    sha,
    assunto,
    veredito: "vermelho",
    escopo: "ambos",
    sempre: [{ id: "mutation-count", ok: false, ms: 1, motivo: "quebrou" }],
    testes: { testes: [], porNome: [], porGrafo: [] },
    motivo: "mutation-count: a contagem não fecha",
    ms: 1,
  })

  it("a separação vem do MÓDULO DONO do registro (uma implementação só)", async () => {
    const { separarDividaDeRegressao } = await import("../../../scripts/doctor-unproven.mjs")
    const secao = {
      entrada: {
        base: null,
        declaredAt: "2026-09-25",
        reviewAfterDays: 90,
        commits: [
          {
            subject: VERMELHO_A,
            reason: "o helper nasce 3 commits depois",
            declaredAt: "2026-09-25",
          },
        ],
      },
      erro: null,
    }
    const r = separarDividaDeRegressao({
      vermelhos: [
        { sha: "a".repeat(40), assunto: VERMELHO_A, motivo: "vitest: import quebrado" },
        { sha: "b".repeat(40), assunto: VERMELHO_A_CONTINUADO, motivo: "vitest: import quebrado" },
        { sha: "c".repeat(40), assunto: VERMELHO_NOVO, motivo: "guard: quebrou" },
      ],
      secao,
    })
    expect(r.estado).toBe("medido")
    expect(r.divida.map((d: { assunto: string }) => d.assunto)).toEqual([VERMELHO_A])
    expect(r.reancorar.map((d: { assunto: string }) => d.assunto)).toEqual([VERMELHO_A_CONTINUADO])
    expect(r.regressao.map((d: { assunto: string }) => d.assunto)).toEqual([VERMELHO_NOVO])
    expect(r.alheios).toEqual([])
  })

  it("registro AUSENTE não acusa regressão: não classificado, com a causa nomeada", async () => {
    const { separarDividaDeRegressao } = await import("../../../scripts/doctor-unproven.mjs")
    const r = separarDividaDeRegressao({
      vermelhos: [{ sha: "a".repeat(40), assunto: VERMELHO_NOVO, motivo: "x" }],
      secao: { entrada: null, erro: "o registro não existe: ci/unproven.json" },
    })
    expect(r.estado).toBe("registro-ilegivel")
    expect(r.regressao).toEqual([])
    expect(r.naoClassificados).toHaveLength(1)
    expect(r.erro).toContain("não existe")
  })

  it("a declaração que a pilha NÃO alcança é DITA (nem dívida queimada, nem regressão)", async () => {
    const { separarDividaDeRegressao } = await import("../../../scripts/doctor-unproven.mjs")
    const r = separarDividaDeRegressao({
      vermelhos: [],
      secao: {
        entrada: {
          base: null,
          declaredAt: "2026-09-25",
          reviewAfterDays: 90,
          commits: [
            { subject: VERMELHO_A, reason: "x", declaredAt: "2026-09-25" },
            {
              subject: "fix(outro): já fechado noutra história",
              reason: "y",
              declaredAt: "2026-09-25",
            },
          ],
        },
        erro: null,
      },
    })
    expect(r.estado).toBe("medido")
    expect(r.divida).toEqual([])
    expect(r.alheios).toEqual([VERMELHO_A, "fix(outro): já fechado noutra história"])
  })

  it("o RELATÓRIO nomeia dívida, reancoragem e regressão com palavras diferentes", async () => {
    const { renderRelatorio } = await import("../../../scripts/prove-stack-per-commit.mjs")
    const relatorio = renderRelatorio({
      base: "origin/main",
      origemBase: "test",
      head: "a".repeat(40),
      teto: 150,
      sempre: [],
      commits: ["a".repeat(40), "c".repeat(40)],
      recorte: null,
      limpeza: null,
      resultados: [vermelho("a".repeat(40), VERMELHO_A), vermelho("c".repeat(40), VERMELHO_NOVO)],
      dividaPilha: {
        estado: "medido",
        divida: [
          {
            sha: "a".repeat(40),
            assunto: VERMELHO_A,
            motivo: "m",
            declaredAt: "2026-09-25",
            reason: "o helper nasce 3 commits depois",
          },
        ],
        reancorar: [],
        regressao: [
          {
            sha: "c".repeat(40),
            assunto: VERMELHO_NOVO,
            motivo: "m",
            pista: "nenhuma dívida da seção `pilha` do registro declara este assunto",
          },
        ],
        alheios: [],
        naoClassificados: [],
        erro: null,
      },
      custoMs: 1,
      veredito: "broken",
      exit: 1,
      vermelhos: 2,
      indeterminados: 0,
    })
    expect(relatorio).toContain("⚪ dívida declarada:")
    expect(relatorio).toContain("o helper nasce 3 commits depois [declarado em 2026-09-25]")
    expect(relatorio).toContain("🔴 REGRESSÃO:")
    expect(relatorio).not.toContain("re-ancore a seção")
  })

  it("o RELATÓRIO com registro ILEGÍVEL não acusa regressão — e diz por quê", async () => {
    const { renderRelatorio } = await import("../../../scripts/prove-stack-per-commit.mjs")
    const relatorio = renderRelatorio({
      base: "origin/main",
      origemBase: "test",
      head: "a".repeat(40),
      teto: 150,
      sempre: [],
      commits: ["a".repeat(40)],
      recorte: null,
      limpeza: null,
      resultados: [vermelho("a".repeat(40), VERMELHO_NOVO)],
      dividaPilha: {
        estado: "registro-ilegivel",
        divida: [],
        reancorar: [],
        regressao: [],
        alheios: [],
        naoClassificados: [{ sha: "a".repeat(40), assunto: VERMELHO_NOVO, motivo: "m" }],
        erro: "o registro não é JSON válido",
      },
      custoMs: 1,
      veredito: "broken",
      exit: 1,
      vermelhos: 1,
      indeterminados: 0,
    })
    expect(relatorio).toContain("NÃO classificado(s)")
    expect(relatorio).toContain("não a transforma em regressão")
    expect(relatorio).not.toContain("🔴 REGRESSÃO")
  })

  it("o `--json` da CLI leva a separação como DADO (o recorte vazio publica `null`)", () => {
    const head = shaDoHead()
    const cli = spawnSync(
      "node",
      [
        "scripts/prove-stack-per-commit.mjs",
        "--pushed",
        "--sem-topo",
        "--json",
        "--refs",
        linha(head, head),
      ],
      { encoding: "utf8" },
    )
    const j = JSON.parse(cli.stdout) as { dividaPilha: unknown; recorte: { noRecorte: number } }
    expect(j.recorte.noRecorte).toBe(0)
    expect(j.dividaPilha).toBeNull()
  })
})
