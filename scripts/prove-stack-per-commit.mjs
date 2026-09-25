#!/usr/bin/env node
/**
 * scripts/prove-stack-per-commit.mjs — cada commit da pilha passa SOZINHO?
 *
 * A classe que ele fecha, medida: um commit pode nascer VERMELHO e ninguém ver
 * até o topo. O `2757e3a5` pôs o `check-mutation-count` na bateria local e
 * invalidou a expectativa do teste da descida (`check-hook-ci-parity-subguards`)
 * — o vermelho viajou 12 commits acima, e o único lugar que o via era o topo da
 * pilha. O PR mede o TOPO; a pilha tem commits no meio.
 *
 * O que ele faz, por commit (do mais antigo ao mais novo):
 *
 *   1. materializa o commit num WORKTREE próprio (`git worktree add --detach`),
 *      com o `node_modules` do repo medido ligado por symlink, e DECLARA O DONO
 *      dele ao lado (`dono.json`: ferramenta, pid, host, sha) — o que permite
 *      varrer o resíduo sem ADIVINHAR de quem ele é;
 *   2. mede o que o commit sozinho quebra:
 *      a. os TESTES AFETADOS pelo diff do próprio commit — derivados por duas
 *         réguas (uma nomeada, uma medida): o GRAFO DE IMPORTS (um teste que
 *         importa um arquivo que o commit mudou) e a CONVENÇÃO DE NOME
 *         (`scripts/check-foo.mjs` → `check-foo*.test.ts`; `src/lib/foo.ts` →
 *         `foo.test.ts`);
 *      b. o CONJUNTO SEMPRE (declarado, `CONJUNTO_SEMPRE`): as invariantes de
 *         ÁRVORE que qualquer commit pode quebrar SEM tocar o guard que as
 *         possui — a contagem da matriz, a paridade das forjas e a prosa da
 *         versão. Rodar a bateria inteira (48 guards) por commit custaria horas;
 *         o que fica de fora está nomeado no limite 3 abaixo.
 *   3. remove o worktree e guarda o veredito.
 *   4. ANTES de qualquer medição, VARE o resíduo das execuções MORTAS (o
 *      `rmSync` do fim nunca roda num SIGKILL): cada `pilha-*` é julgado pelo
 *      MARCADOR do dono — pid VIVO no mesmo host fica (é outra medição em
 *      curso), `--keep` fica declarado, marcador ilegível ou de outra
 *      ferramenta NÃO É TOCADO, e o resto é varrido (worktree + diretório +
 *      metadado órfão do git). A varredura sai no relatório quando acontece —
 *      nada silencioso. E o worktree da medição EM CURSO é removido no SINAL
 *      (SIGINT/SIGTERM/SIGHUP): a execução interrompida não deixa o dela.
 *
 * O veredito é por commit e agregado:
 *   verde        — o commit passa sozinho (os testes afetados e o sempre, todos 0)
 *   vermelho     — algum gate reprovou SOZINHO neste commit (nomeia o gate)
 *   indeterminado— não foi possível medir (worktree, timeout, comando ausente):
 *                  NUNCA vale verde — "não consegui medir" não é "nada a julgar"
 *
 * O RECORTE DO PUSH (o pre-push mede os commits do MEIO que o push leva):
 *
 *   O pre-push chama este módulo com `--pushed`: as refs que saem chegam pelo
 *   stdin (o protocolo do git) e o recorte é a UNIÃO de `remote_sha..local_sha`
 *   dos refs que o push leva, SEM o topo (`--sem-topo` — a árvore do topo é o
 *   que as outras fases do hook e o PR já medem). Um ref NOVO (sha do remoto
 *   todo zero) não delimita nada: a base dele vem da BASE declarada, e sem base
 *   resolvida o recorte é INDETERMINADO (nunca "nada a julgar").
 *
 *   O que faz o recorte CABER no caminho do push é a AMOSTRA (`--amostra N`):
 *   no máximo N commits medidos, escolhidos DETERMINISTICAMENTE (o mais antigo
 *   sempre dentro, os outros espaçados por igual) e com os PULADOS NOMEADOS no
 *   relatório. Um push de UM commit não tem meio: o recorte é vazio, e o custo
 *   no caminho comum é o startup (~0,1s). A amostra NUNCA é silenciosa: o
 *   veredito diz quantos mediu e quantos pulou, e o pulado não vira verde —
 *   ele vira "não medido neste recorte", com o job `stack-per-commit` do CI
 *   (que mede a pilha inteira) nomeado como quem fecha a conta.
 *
 * Usage:
 *   node scripts/prove-stack-per-commit.mjs                  # a pilha do HEAD
 *   node scripts/prove-stack-per-commit.mjs --base origin/main
 *   node scripts/prove-stack-per-commit.mjs --medir           # só MEDE (nunca falha)
 *   node scripts/prove-stack-per-commit.mjs --only <sha>      # um commit só
 *   node scripts/prove-stack-per-commit.mjs --root DIR        # mede outra árvore
 *   node scripts/prove-stack-per-commit.mjs --sempre "node x.mjs"  # troca o sempre
 *   node scripts/prove-stack-per-commit.mjs --sem-sempre      # só os testes afetados
 *   node scripts/prove-stack-per-commit.mjs --sem-afetados    # só o CONJUNTO SEMPRE
 *   node scripts/prove-stack-per-commit.mjs --max-commits 40
 *   node scripts/prove-stack-per-commit.mjs --pushed --sem-topo --amostra 6   # o pre-push
 *   node scripts/prove-stack-per-commit.mjs --pushed --refs "refs/heads/x <sha> refs/heads/x <sha>"
 *   node scripts/prove-stack-per-commit.mjs --json --keep
 *
 * Exit codes:
 *   0 — cada commit da pilha passa sozinho ✅
 *   1 — algum commit NÃO passa sozinho (o veredito nomeia o commit e o gate) ❌
 *   2 — INDETERMINADO: a pilha não pôde ser medida (nunca verde por não saber)
 *   3 — uso (flag desconhecida, valor inválido)
 *
 * LIMITES DECLARADOS (o que este harness NÃO mede):
 *   1. as dependências são as do repo medido (symlink do `node_modules`): o
 *      `bun.lock` DO COMMIT não é instalado. Uma pilha que muda deps não é
 *      medida com as deps do commit;
 *   2. um teste que LÊ um arquivo por fs (sem importá-lo) e não carrega o nome
 *      dele no próprio nome não é alcançado pelo grafo — cada veredito diz
 *      quantos testes afetados achou, e "0" é leitura honesta, não cobertura;
 *   3. o CONJUNTO SEMPRE é uma lista DECLARADA (três invariantes de árvore), não
 *      a bateria inteira: uma expectativa que vive num guard fora dele só é
 *      pega se o commit tiver tocado o dono dela (aí o teste afetado a pega);
 *   4. acima do teto (`--max-commits`, default 150) o veredito é INDETERMINADO:
 *      o teto existe para o job não virar uma medição sem fim, e estourá-lo
 *      nunca vale verde;
 *   5. as medições são SEQUENCIAIS (determinismo): o custo é a soma, e o
 *      `--json` publica o custo de cada commit;
 *   6. o ESCOPO é DECLARADO, e `--sem-afetados` o encolhe para o CONJUNTO
 *      SEMPRE: os testes afetados são o custo DOMINANTE e ele é função do diff
 *      do commit (medido no tip desta própria prova: 25 arquivos, 201s) — um
 *      harness chamado de dentro de um gate precisa poder dizer "só a árvore".
 *      Nesse escopo `afetados 0` NÃO quer dizer "o diff não alcança teste
 *      nenhum": quer dizer NÃO MEDIDOS, e é isso que o relatório e o `--json`
 *      (`escopo: "sempre"`) escrevem.
 */

import { spawnSync } from "node:child_process"
import {
  existsSync,
  fstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { hostname, tmpdir } from "node:os"
import { basename, dirname, extname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { resolverLocal, specsDoModulo } from "./check-tla-closure.mjs"
import {
  UNPROVEN_REGISTRY_PATH as UNPROVEN_CAMINHO,
  lerSecaoPilha,
  separarDividaDeRegressao,
} from "./doctor-unproven.mjs"

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")

/** Exit codes — o contrato da CLI. */
export const EXIT = {
  OK: 0,
  BROKEN: 1,
  UNAVAILABLE: 2,
  USAGE: 3,
}

/**
 * O TETO de commits medidos. Ele não é uma régua de qualidade: é o limite do
 * que o job mede. Acima dele o veredito é INDETERMINADO (exit 2) e o relatório
 * nomeia o número — uma pilha que não cabe nunca sai verde por não ter sido
 * olhada.
 */
export const MAX_COMMITS_PADRAO = 150

/** O teto de tempo de CADA comando medido (ms). Timeout = indeterminado. */
export const TIMEOUT_GATE_MS = 300000

/**
 * A AMOSTRA padrão do recorte do push. Ela não é uma régua de qualidade: é o que
 * faz o recorte CABER no caminho do push. O custo por commit é medido (~5,4s no
 * ato da pilha de referência), então 6 commits ≈ 33s — e um push de um commit só
 * não tem MEIO (custo = o startup do node). O número é ajustável por `--amostra`
 * (o hook o expõe como `PILHA_PUSH_MAX`), e a amostra NUNCA é silenciosa: os
 * pulados saem nomeados no relatório.
 */
export const AMOSTRA_PADRAO = 6

/**
 * O CONJUNTO SEMPRE — as invariantes de ÁRVORE que qualquer commit pode
 * quebrar SEM tocar o guard que as possui (por isso não são alcançáveis pela
 * régua dos testes afetados). Cada comando roda no worktree do commit, com o
 * veredito do PRÓPRIO comando (nunca do filtro).
 */
export const CONJUNTO_SEMPRE = [
  {
    id: "mutation-count",
    cmd: ["node", "scripts/check-mutation-count.mjs"],
    o_que: "a contagem da matriz (master ↔ doc ↔ pipelines)",
  },
  {
    id: "forge-parity",
    cmd: ["node", "scripts/check-forge-parity.mjs"],
    o_que: "as duas forjas no mesmo contrato",
  },
  {
    id: "script-headers",
    cmd: ["node", "scripts/check-script-headers.mjs"],
    o_que: "a prosa dos cabeçalhos contra o valor declarado",
  },
]

/** Onde vivem os testes que o grafo anda (a mesma árvore do `test:run`). */
export const DIRS_DE_TESTE = [
  "src/lib/__tests__",
  "src/app/api/__tests__",
  "src/hooks/__tests__",
  "src/store/__tests__",
]

/** Extensões de teste consideradas pela convenção de nome. */
const SUFIXO_TESTE = /\.[jt]sx?$/

/**
 * Resolve a BASE da pilha: `--base`, o env do CI, ou `origin/main`.
 *
 * A ordem é DECLARADA e o relatório publica qual régua valeu — a base errada
 * mediria outra pilha em silêncio.
 *
 * @param {{base?: string, env?: Record<string, string|undefined>, git: (args: string[]) => string}} p
 * @returns {{ref: string|null, origem: string}}
 */
export function resolverBase({ base, env = process.env, git }) {
  if (base) return { ref: base, origem: "--base" }
  const doGithub = env.GITHUB_BASE_REF
  if (doGithub) return { ref: `origin/${doGithub}`, origem: "GITHUB_BASE_REF" }
  const doGitea = env.CI_MERGE_REQUEST_TARGET_BRANCH_NAME
  if (doGitea) return { ref: `origin/${doGitea}`, origem: "CI_MERGE_REQUEST_TARGET_BRANCH_NAME" }
  const existeMain = git(["rev-parse", "--verify", "--quiet", "origin/main"])
  if (existeMain) return { ref: "origin/main", origem: "default (origin/main)" }
  return { ref: null, origem: "nenhuma base resolvida" }
}

/**
 * A PILHA: os commits de `head` que não estão na base, do mais ANTIGO ao mais
 * novo (a ordem em que a pilha foi construída — é nela que se lê "nasceu
 * vermelho").
 *
 * @returns {string[]}
 */
export function pilha({ git, base, head }) {
  const mergeBase = git(["merge-base", base, head])
  if (!mergeBase) return []
  const saida = git(["rev-list", "--reverse", `${mergeBase}..${head}`])
  return saida ? saida.split("\n").filter(Boolean) : []
}

const ZEROS = /^0+$/

/** Um sha do git: 40 (SHA-1) ou 64 (SHA-256) hexadecimais. */
const SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/

/**
 * As linhas do PROTOCOLO DO PRE-PUSH (o que o git escreve no stdin do hook):
 * `<local ref> <local sha> <remote ref> <remote sha>` por ref que sai.
 *
 * Linha malformada é IGNORADA e CONTADA (`ignoradas`): o protocolo é do git e
 * um parser que estourasse num formato inesperado derrubaria um push por um
 * motivo que não é do repositório.
 *
 * @param {string} texto
 * @returns {{refs: Array<{localRef: string, localSha: string, remoteRef: string, remoteSha: string}>, ignoradas: string[]}}
 */
export function refsDoPush(texto) {
  const refs = []
  const ignoradas = []
  for (const linha of String(texto ?? "").split("\n")) {
    const t = linha.trim()
    if (!t) continue
    const p = t.split(/\s+/)
    // QUATRO colunas E dois shas: uma linha de quatro tokens que não é ref (a
    // saída de outro comando, um log colado por engano) viraria um ref, e um ref
    // sem sha viraria um recorte VAZIO — isto é, "nada a medir" por um dado que
    // não é do protocolo. O sha é a coluna que diz que a linha é do git.
    if (p.length !== 4 || !SHA.test(p[1]) || !SHA.test(p[3])) {
      ignoradas.push(t.slice(0, 120))
      continue
    }
    refs.push({ localRef: p[0], localSha: p[1], remoteRef: p[2], remoteSha: p[3] })
  }
  return { refs, ignoradas }
}

/**
 * Os commits que o PUSH LEVA: a UNIÃO dos `remote_sha..local_sha` dos refs que
 * saem, do mais antigo ao mais novo (a ordem em que se lê "nasceu vermelho").
 *
 * Um ref NOVO (sha do remoto todo zero) não delimita nada — o git manda o que o
 * remoto não tem, e o que ele não tem é delimitado pela BASE declarada (`--base`,
 * o env do CI, `origin/main`). SEM base resolvida o recorte é `null`
 * (INDETERMINADO): medir "tudo" seria medir a história inteira do repositório e
 * chamá-la de pilha deste push.
 *
 * @returns {{commits: string[]|null, negativos: string[], origem: string}}
 */
export function commitsDoPush({ git, refs, base }) {
  const locais = refs.map((r) => r.localSha).filter((sha) => !ZEROS.test(sha))
  if (!locais.length)
    return { commits: [], negativos: [], origem: "nenhum ref que saia (só remoções)" }
  const negativos = refs.map((r) => r.remoteSha).filter((sha) => !ZEROS.test(sha))
  const novos = refs.filter((r) => ZEROS.test(r.remoteSha)).length
  let origem = "remote_sha..local_sha"
  if (novos > 0) {
    if (!base?.ref) return { commits: null, negativos, origem: "ref NOVO sem base resolvida" }
    negativos.push(base.ref)
    origem = `${novos} ref(s) NOVO(s): base ${base.ref} (${base.origem})`
  }
  const args = ["rev-list", "--reverse", "--topo-order", ...locais]
  if (negativos.length) args.push("--not", ...negativos)
  const saida = git(args)
  return { commits: saida ? saida.split("\n").filter(Boolean) : [], negativos, origem }
}

/**
 * O RECORTE — a amostra DETERMINÍSTICA de uma lista de commits: no máximo `n`
 * medidos, com o mais ANTIGO sempre dentro e os outros espaçados por igual.
 *
 * Determinística de propósito: o MESMO push tem de medir os MESMOS commits (um
 * sorteio daria um veredito diferente para o mesmo conteúdo, e o vermelho
 * apareceria e sumiria sem ninguém mudar nada). `pulados` é o que o relatório
 * NOMEIA — a amostra não pode virar silêncio.
 *
 * @param {string[]} commits
 * @param {number} n
 * @returns {{medidos: string[], pulados: string[]}}
 */
export function amostrar(commits, n) {
  const L = commits.length
  if (!Number.isInteger(n) || n <= 0 || n >= L) return { medidos: [...commits], pulados: [] }
  if (n === 1) return { medidos: [commits[0]], pulados: commits.slice(1) }
  const idx = new Set()
  for (let i = 0; i < n; i++) idx.add(Math.round((i * (L - 1)) / (n - 1)))
  const medidos = [...idx].sort((a, b) => a - b).map((i) => commits[i])
  const pulados = commits.filter((_, i) => !idx.has(i))
  return { medidos, pulados }
}

/**
 * Os arquivos que o commit MUDOU (contra o pai), em caminhos relativos à raiz.
 * É a entrada das duas réguas dos testes afetados.
 */
export function arquivosDoCommit({ git, sha }) {
  const saida = git(["diff-tree", "--no-commit-id", "--name-only", "-r", "--root", sha])
  return saida ? saida.split("\n").filter(Boolean) : []
}

/** O nome do arquivo sem extensão — a chave da convenção de nome. */
export function haste(caminho) {
  const b = basename(caminho)
  const ext = extname(b)
  return ext ? b.slice(0, -ext.length) : b
}

/**
 * A CONVENÇÃO DE NOME (régua nomeada): o teste que carrega o nome do arquivo
 * mudado. `scripts/check-foo.mjs` alcança `check-foo.test.ts` e
 * `check-foo-<qualquer>.test.ts`; `src/lib/foo.ts` alcança `foo.test.ts`.
 *
 * Um nome curto (menos de 4 caracteres) é ignorado: casaria com meio diretório.
 *
 * @param {{arquivos: string[], testes: string[]}} p
 * @returns {string[]} os testes alcançados
 */
export function porConvencaoDeNome({ arquivos, testes }) {
  const fora = new Set()
  for (const arq of arquivos) {
    const h = haste(arq)
    if (h.length < 4) continue
    for (const t of testes) {
      const ht = haste(t)
      if (ht === h || ht.startsWith(`${h}-`) || ht.startsWith(`${h}.`)) fora.add(t)
    }
  }
  return [...fora].sort()
}

/**
 * O GRAFO DE IMPORTS (régua medida): o teste que IMPORTA um arquivo que o
 * commit mudou. Ele pega o caso que a convenção de nome NÃO pega — um
 * `check-hook-ci-parity-subguards.test.ts` que importa `check-hook-ci-parity.mjs`
 * (o nome não casa; o import sim).
 *
 * Os specifiers saem do `specsDoModulo` (a mesma régua de código-vs-string do
 * `check-tla-closure`), e só os RELATIVOS que resolvem para arquivo entram.
 *
 * @param {{arquivos: string[], testes: string[], root: string, lerArquivo: (p: string) => string}} p
 * @returns {string[]}
 */
export function porGrafoDeImports({ arquivos, testes, root, lerArquivo }) {
  const mudados = new Set(arquivos.map((a) => resolve(root, a)))
  const fora = new Set()
  for (const t of testes) {
    let src
    try {
      src = lerArquivo(join(root, t))
    } catch {
      continue
    }
    for (const { spec } of specsDoModulo(src)) {
      const alvo = resolverLocal(join(root, t), spec)
      if (alvo && mudados.has(resolve(alvo))) fora.add(t)
    }
  }
  return [...fora].sort()
}

/**
 * Os TESTES AFETADOS por um commit: as duas réguas juntas, com a ORIGEM de
 * cada um (para o relatório poder dizer qual alcançou quem).
 *
 * @returns {{testes: string[], porNome: string[], porGrafo: string[]}}
 */
export function testesAfetados({ arquivos, testes, root, lerArquivo }) {
  const porNome = porConvencaoDeNome({ arquivos, testes })
  const porGrafo = porGrafoDeImports({ arquivos, testes, root, lerArquivo })
  return { testes: [...new Set([...porNome, ...porGrafo])].sort(), porNome, porGrafo }
}

/**
 * O VEREDITO agregado da pilha. A régua: qualquer commit com gate reprovado faz
 * a pilha REPROVAR; um commit que não pôde ser medido faz a pilha ficar
 * INDETERMINADA (nunca verde), e isso vale mesmo que outro tenha reprovado —
 * quem lê precisa saber as duas coisas.
 *
 * @param {Array<{veredito: string}>} resultados
 * @returns {{veredito: "ok"|"broken"|"unavailable", exit: number, vermelhos: number, indeterminados: number}}
 */
export function agregar(resultados) {
  const vermelhos = resultados.filter((r) => r.veredito === "vermelho").length
  const indeterminados = resultados.filter((r) => r.veredito === "indeterminado").length
  if (vermelhos > 0) return { veredito: "broken", exit: EXIT.BROKEN, vermelhos, indeterminados }
  if (indeterminados > 0)
    return { veredito: "unavailable", exit: EXIT.UNAVAILABLE, vermelhos, indeterminados }
  return { veredito: "ok", exit: EXIT.OK, vermelhos, indeterminados }
}

/** Os arquivos de teste da árvore medida (as duas convenções de diretório). */
export function arquivosDeTeste({ root, dirs = DIRS_DE_TESTE }) {
  const fora = []
  const anda = (dir) => {
    let entradas
    try {
      entradas = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entradas) {
      const p = join(dir, e.name)
      if (e.isDirectory()) anda(p)
      else if (SUFIXO_TESTE.test(e.name) && /\.test\.[jt]sx?$/.test(e.name))
        fora.push(relative(root, p))
    }
  }
  for (const d of dirs) anda(join(root, d))
  return fora.sort()
}

/** O resultado de UM comando: o veredito é o do comando, nunca o do filtro. */
function roda(cmd, { cwd, timeout = TIMEOUT_GATE_MS }) {
  const inicio = Date.now()
  const r = spawnSync(cmd[0], cmd.slice(1), {
    cwd,
    timeout,
    encoding: "utf8",
    env: { ...process.env, CI: "1" },
  })
  const ms = Date.now() - inicio
  if (r.error && r.error.code === "ETIMEDOUT")
    return { ok: false, ms, motivo: `timeout (${timeout}ms)`, indisponivel: true }
  if (r.error && r.error.code === "ENOENT")
    return { ok: false, ms, motivo: `comando ausente: ${cmd[0]}`, indisponivel: true }
  if (r.status !== 0) {
    const saida = `${r.stdout || ""}${r.stderr || ""}`.trim().split("\n")
    const pista = saida
      .filter((l) => l.trim())
      .slice(-3)
      .join(" · ")
    return { ok: false, ms, motivo: `exit ${r.status}${pista ? ` · ${pista.slice(0, 300)}` : ""}` }
  }
  return { ok: true, ms, motivo: "" }
}

/**
 * ── O WORKTREE, O DONO e a VARREDURA DO RESÍDUO ──────────────────────────
 *
 * O defeito medido: uma execução MORTA (timeout, SIGTERM, `kill -9`, sessão que
 * cai) nunca chega ao `rmSync` do fim — e o resíduo se ACUMULA em silêncio.
 * Medido neste repositório: **151 worktrees** e ~11 GB em `/tmp/pilha-*`. O nome
 * do diretório não diz de quem ele é nem se o dono ainda vive, então um
 * `rm -rf /tmp/pilha-*` mataria a medição de OUTRO processo (o pre-push de outra
 * thread) — e não varrer nada é o que produziu o acúmulo.
 *
 * Por isso o dono é DECLARADO ao lado do worktree (`<tmp>/pilha-XXXX/dono.json`):
 * quem criou (ferramenta, pid, host), para que (sha, repo, início) e se a
 * execução pediu `--keep`. O julgamento da varredura é esse arquivo:
 *
 *   - pid VIVO no MESMO host       → fica (é outra execução medindo agora);
 *   - `keep: true`                 → fica, e é DITO (o `--keep` deixa de ser letra morta);
 *   - marcador de outra ferramenta → NÃO É MEU, não é tocado (dito no relatório);
 *   - marcador ilegível            → idem (fail-closed: sem dono, sem varredura);
 *   - o resto                      → varrido: `git worktree remove --force` + o diretório.
 *
 * Ninguém apaga um caminho LIDO DO ARQUIVO: o que sai é o diretório que a própria
 * enumeração de `tmpdir()` entregou (e o `w` dentro dele). O `dono.dir` serve ao
 * relatório, nunca a uma remoção.
 */
export const WORKTREE_PREFIXO = "pilha-"
export const MARCADOR_DO_DONO = "dono.json"
export const FERRAMENTA = "prove-stack-per-commit"

/** O host desta execução — um pid só é comparável dentro do mesmo host. */
export function hostAtual() {
  try {
    return hostname()
  } catch {
    return "?"
  }
}

/**
 * O pid está VIVO?
 *
 * `EPERM` conta como VIVO: o processo existe e é de outro usuário (não posso
 * sinalizá-lo) — chamá-lo de morto varreria a medição de alguém. Só `ESRCH`
 * (não existe) libera a varredura.
 *
 * @returns {boolean}
 */
export function pidVivo(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return Boolean(e && e.code === "EPERM")
  }
}

/**
 * Cria o worktree do commit e DECLARA o dono. O marcador é escrito DEPOIS de o
 * `worktree add` dar certo: um add que falha não deixa marcador de nada.
 *
 * @returns {{base: string, dir: string, dono: object} | {erro: string}}
 */
export function criarWorktree({ root, sha, keep = false, tmp = tmpdir() }) {
  const base = mkdtempSync(join(tmp, WORKTREE_PREFIXO))
  const dir = join(base, "w")
  const add = spawnSync("git", ["-C", root, "worktree", "add", "--detach", "--quiet", dir, sha], {
    encoding: "utf8",
  })
  if (add.status !== 0) {
    rmSync(base, { recursive: true, force: true })
    return { erro: (add.stderr || "").trim().split("\n")[0] }
  }
  const dono = {
    ferramenta: FERRAMENTA,
    pid: process.pid,
    host: hostAtual(),
    sha,
    repo: root,
    base,
    dir,
    iniciadoEm: new Date().toISOString(),
    keep: Boolean(keep),
  }
  writeFileSync(join(base, MARCADOR_DO_DONO), `${JSON.stringify(dono, null, 2)}\n`)
  return { base, dir, dono }
}

/**
 * Remove o worktree: o metadado do git, o diretório e o marcador.
 *
 * O `rmSync` é protegido: um host que NEGA a remoção (permissão, diretório em uso)
 * não pode derrubar a medição com uma exceção — a varredura confere no disco e
 * declara o que NÃO pôde sair (é `limparResiduos` que julga e reporta).
 */
export function removerWorktree({ root, base, dir }) {
  if (dir)
    spawnSync("git", ["-C", root, "worktree", "remove", "--force", dir], { encoding: "utf8" })
  if (!base) return
  try {
    rmSync(base, { recursive: true, force: true })
  } catch {
    // Silêncio AQUI é o certo: quem lê o disco e reporta é a varredura.
  }
}

/**
 * Varre o resíduo que as execuções MORTAS deixaram. O dono decide, nunca o nome:
 * é o que permite limpar sem matar a medição de outro processo.
 *
 * A remoção é CONFERIDA no disco: um host que nega a remoção (ou um diretório em
 * uso) não pode sair como "varrido" — seria a mesma leitura falsa do resíduo
 * silencioso, com o relatório dizendo limpo.
 *
 * @returns {{varridos: Array, naoRemovidos: Array, preservados: Array, emUso: Array, naoMeus: Array, podados: number|null}}
 */
export function limparResiduos({
  root,
  tmp = tmpdir(),
  pidVivoAqui = pidVivo,
  host = hostAtual(),
}) {
  const varridos = []
  const naoRemovidos = []
  const preservados = []
  const emUso = []
  const naoMeus = []
  let nomes = []
  try {
    nomes = readdirSync(tmp).filter((n) => n.startsWith(WORKTREE_PREFIXO))
  } catch {
    return { varridos, naoRemovidos, preservados, emUso, naoMeus, podados: null }
  }
  for (const nome of nomes) {
    const base = join(tmp, nome)
    let dono = null
    try {
      dono = JSON.parse(readFileSync(join(base, MARCADOR_DO_DONO), "utf8"))
    } catch {
      dono = null
    }
    if (!dono || typeof dono !== "object" || dono.ferramenta !== FERRAMENTA) {
      naoMeus.push({
        nome,
        motivo: dono
          ? `marcador de outra ferramenta (${dono.ferramenta ?? "?"})`
          : "sem marcador legível",
      })
      continue
    }
    if (dono.keep) {
      preservados.push({ nome, sha: dono.sha ?? null, pid: dono.pid ?? null })
      continue
    }
    if (dono.host === host && pidVivoAqui(dono.pid)) {
      emUso.push({ nome, sha: dono.sha ?? null, pid: dono.pid ?? null })
      continue
    }
    // O `dir` vem da ENUMERAÇÃO, nunca do arquivo.
    removerWorktree({ root, base, dir: join(base, "w") })
    if (existsSync(base)) {
      naoRemovidos.push({ nome, sha: dono.sha ?? null, motivo: "o host não deixou remover" })
      continue
    }
    varridos.push({ nome, sha: dono.sha ?? null, pid: dono.pid ?? null, host: dono.host ?? "?" })
  }
  // O diretório pode ter morrido por fora (kill -9 levou o `rmSync`): aí o que
  // sobra é o METADADO do git, e é ele que o `prune` recolhe.
  const podados = spawnSync("git", ["-C", root, "worktree", "prune", "--expire", "now"], {
    encoding: "utf8",
  })
  return { varridos, naoRemovidos, preservados, emUso, naoMeus, podados: podados.status ?? null }
}

/** O worktree da medição EM CURSO — o que a limpeza por sinal remove. */
let worktreeAtual = null

/** Registra (ou desregistra, com `null`) o worktree da medição em curso. */
export function registrarWorktreeAtual(w) {
  worktreeAtual = w
}

/** O worktree registrado agora (os testes leem para provar o ciclo cria→remove). */
export function worktreeEmCurso() {
  return worktreeAtual
}

/** Remove o worktree da medição em curso. Idempotente. */
export function limparWorktreeAtual({ root = REPO_ROOT } = {}) {
  const w = worktreeAtual
  worktreeAtual = null
  if (w) removerWorktree({ root, base: w.base, dir: w.dir })
}

/**
 * A limpeza que roda no SINAL: SIGTERM do timeout, ^C do operador, SIGHUP da
 * sessão que cai. É o que impede o resíduo de NASCER. Um `kill -9` não dá para
 * tratar — para ele existe a varredura do início da execução seguinte.
 *
 * @returns {() => void} desinstala (os testes usam para não vazar handler)
 */
export function instalarLimpezaNoSinal({
  root = REPO_ROOT,
  sinais = ["SIGINT", "SIGTERM", "SIGHUP"],
} = {}) {
  const handler = (sinal) => {
    limparWorktreeAtual({ root })
    process.exit(sinal === "SIGINT" ? 130 : 143)
  }
  for (const s of sinais) process.on(s, handler)
  return () => {
    for (const s of sinais) process.off(s, handler)
  }
}

/**
 * Mede UM commit sozinho, no worktree dele.
 *
 * @returns {{sha: string, assunto: string, veredito: string, escopo: string, sempre: Array, testes: object, motivo: string, ms: number}}
 */
export function medirCommit({
  root,
  sha,
  git,
  sempre,
  semSempre,
  semAfetados = false,
  lerArquivo,
  timeout = TIMEOUT_GATE_MS,
  dirsDeTeste = DIRS_DE_TESTE,
  keep = false,
}) {
  const inicio = Date.now()
  const assunto = git(["log", "-1", "--format=%s", sha]).split("\n")[0] || ""
  const arquivos = arquivosDoCommit({ git, sha })

  const wt = criarWorktree({ root, sha, keep })
  if (wt.erro) {
    return {
      sha,
      assunto,
      veredito: "indeterminado",
      sempre: [],
      testes: { testes: [], porNome: [], porGrafo: [] },
      motivo: `não consegui criar o worktree: ${wt.erro}`,
      ms: Date.now() - inicio,
    }
  }
  const { base, dir } = wt
  // O worktree EM CURSO fica registrado: é esse que a limpeza por sinal remove
  // quando a execução é interrompida no meio.
  registrarWorktreeAtual(wt)

  // A RÉGUA DOS TESTES É A ÁRVORE DO PRÓPRIO COMMIT — não a do HEAD.
  // Medido: com os candidatos lidos da árvore do HEAD, um commit ANTERIOR à
  // criação de um teste recebia esse nome na lista, e o vitest respondia
  // `No test files found` com exit 1 — um vermelho que o commit não tem (o
  // harness acusando o são). Candidato que o commit não tem não é candidato.
  const afetados = testesAfetados({
    arquivos,
    testes: arquivosDeTeste({ root: dir, dirs: dirsDeTeste }),
    root: dir,
    lerArquivo,
  })
  const semDirsDeTeste = !dirsDeTeste.some((d) => existsSync(join(dir, d)))

  // O `node_modules` do repo medido: sem ele nem o vitest nem os guards rodam.
  const nm = join(root, "node_modules")
  let semNodeModules = false
  if (existsSync(nm) && !existsSync(join(dir, "node_modules"))) {
    try {
      symlinkSync(nm, join(dir, "node_modules"), "dir")
    } catch {
      semNodeModules = true
    }
  } else if (!existsSync(nm)) {
    semNodeModules = true
  }

  const resultadosSempre = []
  let motivo = ""
  let veredito = "verde"

  // (a) o CONJUNTO SEMPRE — as invariantes de árvore.
  for (const g of semSempre ? [] : sempre) {
    const r = roda(g.cmd, { cwd: dir, timeout })
    resultadosSempre.push({ id: g.id, ok: r.ok, ms: r.ms, motivo: r.motivo })
    if (!r.ok) {
      if (r.indisponivel) {
        veredito = "indeterminado"
        motivo = `${g.id}: ${r.motivo}`
      } else {
        veredito = "vermelho"
        motivo = `${g.id}: ${r.motivo}`
        break
      }
    }
  }

  const escopo = semAfetados ? "sempre" : "ambos"

  // (b) os TESTES AFETADOS pelo diff deste commit (nada afetado = nada a rodar).
  if (semAfetados) {
    // ESCOPO DECLARADO pelo chamador: só o CONJUNTO SEMPRE. O veredito acima
    // continua valendo (o sempre reprovado é vermelho), mas NADA aqui pode ser
    // lido como "o diff não alcança teste nenhum".
    if (veredito === "verde")
      motivo = "escopo SEMPRE (--sem-afetados): os testes afetados não foram medidos"
  } else if (veredito !== "vermelho" && afetados.testes.length > 0) {
    const r = roda(["bun", "run", "vitest", "run", "--reporter=dot", ...afetados.testes], {
      cwd: dir,
      timeout,
    })
    const id = `vitest(${afetados.testes.length} arquivo(s))`
    resultadosSempre.push({ id, ok: r.ok, ms: r.ms, motivo: r.motivo })
    if (!r.ok) {
      if (r.indisponivel) {
        if (veredito === "verde") veredito = "indeterminado"
        motivo = `${id}: ${r.motivo}`
      } else {
        veredito = "vermelho"
        motivo = `${id}: ${r.motivo}`
      }
    }
  } else if (veredito === "verde" && afetados.testes.length === 0) {
    motivo = "nenhum teste afetado pelo diff deste commit"
  }

  if (semNodeModules && veredito !== "vermelho") {
    veredito = "indeterminado"
    motivo = "node_modules ausente no worktree — os gates não puderam rodar"
  }
  // A árvore do commit não declara os diretórios de teste: nada a alcançar não
  // pode virar verde (o commit seria julgado por um conjunto que não existe).
  // Com o escopo no SEMPRE a regra não se aplica: o que se mede ali não são os
  // testes, e um commit sem diretório de teste ainda tem invariantes de árvore.
  if (!semAfetados && semDirsDeTeste && veredito === "verde") {
    veredito = "indeterminado"
    motivo = `a árvore do commit não tem os diretórios de teste declarados (${dirsDeTeste.join(", ")})`
  }

  removerWorktree({ root, base, dir })
  registrarWorktreeAtual(null)

  return {
    sha,
    assunto,
    veredito,
    escopo,
    sempre: resultadosSempre,
    testes: afetados,
    motivo,
    ms: Date.now() - inicio,
  }
}

/** A régua de leitura usada por default (injetável para os testes unitários). */
export const lerArquivoPadrao = (p) => readFileSync(p, "utf8")

/** O relatório humano. */
export function renderRelatorio(r) {
  const L = []
  const rec = r.recorte
  L.push("")
  L.push(
    rec
      ? "  Os commits do MEIO que este push LEVA, sozinhos (worktree próprio) — o vermelho que o topo esconde"
      : "  Cada commit da pilha SOZINHO (worktree próprio) — o vermelho que nasce no meio",
  )
  L.push("  ──────────────────────────────────────────────────────────────────────────")
  L.push(`  base: ${r.base} (${r.origemBase}) · head: ${r.head}`)
  if (rec) {
    L.push(
      `  recorte: ${rec.noRecorte} commit(s) que o push leva${rec.semTopo ? " SEM o topo (a árvore dele é o que as outras fases do hook já medem)" : ""}`,
    )
    L.push(
      `  amostra ${rec.amostra}: ${r.commits.length} MEDIDO(s) · ${rec.pulados.length} PULADO(s)${
        rec.pulados.length
          ? ` (${rec.pulados
              .map((s) => s.slice(0, 8))
              .slice(0, 6)
              .join(" ")}${rec.pulados.length > 6 ? " …" : ""})`
          : ""
      } · ${rec.refs} ref(s) · origem: ${rec.origem}`,
    )
  } else {
    L.push(
      `  pilha: ${r.commits.length} commit(s) · teto ${r.teto}${r.commits.length > r.teto ? " ⚠️  ESTOURADO" : ""}`,
    )
  }
  L.push(`  sempre: ${r.sempre.map((s) => s.id).join(", ")}`)
  L.push(...renderLimpeza(r.limpeza))
  L.push("")
  for (const c of r.resultados) {
    const marca = c.veredito === "verde" ? "✅" : c.veredito === "vermelho" ? "❌" : "◐"
    const sempre = c.sempre
      .filter((s) => !s.id.startsWith("vitest"))
      .map((s) => (s.ok ? "·" : "✗"))
      .join("")
    const vit = c.sempre.find((s) => s.id.startsWith("vitest"))
    const afetados = c.testes.testes.length
    const naoMedidos = c.escopo === "sempre" && !vit
    L.push(
      `  ${marca} ${c.sha.slice(0, 8)}  ${c.veredito.padEnd(13)} sempre ${sempre || "—"}  afetados ${naoMedidos ? "—" : String(afetados).padStart(2)}${vit ? ` (${vit.ok ? "passa" : "REPROVA"})` : naoMedidos ? " (NÃO MEDIDOS: escopo --sem-afetados)" : " (nada a rodar)"}  ${(c.ms / 1000).toFixed(1)}s`,
    )
    L.push(`       ${c.assunto.slice(0, 92)}`)
    if (c.motivo) L.push(`       → ${c.motivo.slice(0, 200)}`)
    if (afetados > 0)
      L.push(
        `       ${naoMedidos ? "derivados (NÃO medidos)" : "testes"}: ${c.testes.testes.join(" ")}`,
      )
  }
  L.push("")
  const alvo = rec ? "do recorte do push" : "da pilha"
  L.push(
    `  Veredito ${alvo}: ${
      r.veredito === "ok"
        ? rec
          ? "OS COMMITS MEDIDOS PASSAM SOZINHOS ✅"
          : "CADA COMMIT PASSA SOZINHO ✅"
        : r.veredito === "broken"
          ? `${rec ? "REPROVADO" : "REPROVADA"} — ${r.vermelhos} commit(s) do ${rec ? "recorte" : "pilha"} NÃO passam sozinhos ❌`
          : `INDETERMINAD${rec ? "O" : "A"} — ${r.indeterminados} commit(s) não puderam ser medidos ◐`
    }`,
  )
  // A SEPARAÇÃO que o veredito publica: dívida DECLARADA (o registro conhece o
  // assunto e o motivo) NÃO é regressão — e a regressão é NOMEADA como tal. A
  // leitura honesta dos DOIS lados: registro ilegível não acusa ninguém (não
  // classificado), e declaração que a pilha não alcança é DITA (o registro de
  // outra história envelhece calado). O exit NÃO muda: dívida é dívida, e quem
  // barra o push é o vermelho — com o nome agora verdadeiro.
  const dp = r.dividaPilha
  if (dp) {
    if (dp.estado === "medido") {
      if (dp.divida.length)
        for (const d of dp.divida)
          L.push(
            `  ⚪ dívida declarada: ${d.sha.slice(0, 8)} — ${d.reason} [declarado em ${d.declaredAt}]`,
          )
      if (dp.reancorar.length)
        L.push(
          `  ⚠️  ${dp.reancorar.length} vermelho(s) continuam a declaração mas o ASSUNTO mudou — re-ancore a seção 'pilha' do ${UNPROVEN_CAMINHO} para o casamento exato voltar: ${dp.reancorar.map((d) => d.sha.slice(0, 8)).join(" ")}`,
        )
      if (dp.regressao.length)
        for (const g of dp.regressao)
          L.push(
            `  🔴 REGRESSÃO: ${g.sha.slice(0, 8)} — nenhum assunto da seção 'pilha' do ${UNPROVEN_CAMINHO} declara este vermelho`,
          )
      if (dp.alheios.length)
        L.push(
          `  · ${dp.alheios.length} declaração(ões) da seção 'pilha' não foram alcançadas por esta pilha (outra história ou já fechada): ${dp.alheios.map((s) => s.slice(0, 48) + (s.length > 48 ? "…" : "")).join(" | ")}`,
        )
    } else if (dp.naoClassificados.length) {
      L.push(
        `  ◐ ${dp.naoClassificados.length} vermelho(s) NÃO classificado(s) — o registro não pôde ser julgado (${dp.erro}): não conseguindo ler a dívida não a transforma em regressão`,
      )
    }
  }
  if (rec) {
    L.push(
      `  ⚠️  Isto NÃO é o veredito da pilha: ${r.commits.length} de ${rec.noRecorte} commit(s) que o push leva foram medidos${
        rec.pulados.length
          ? `, e ${rec.pulados.length} foram PULADOS pela amostra (listados no --json) — pulado não é verde, é NÃO MEDIDO`
          : ""
      }. O veredito da pilha INTEIRA é o job stack-per-commit do CI (mesmo comando, sem amostra).`,
    )
  }
  L.push("")
  return L.join("\n")
}

/** O dado de máquina (o custo por commit entra aqui). */
export function json(r) {
  return JSON.stringify(
    {
      base: r.base,
      origemBase: r.origemBase,
      head: r.head,
      teto: r.teto,
      sempre: r.sempre.map((s) => s.id),
      commits: r.commits.length,
      recorte: r.recorte ?? null,
      limpeza: r.limpeza ?? null,
      veredito: r.veredito,
      vermelhos: r.vermelhos,
      dividaPilha: r.dividaPilha ?? null,
      indeterminados: r.indeterminados,
      custoMs: r.custoMs,
      resultados: r.resultados.map((c) => ({
        sha: c.sha,
        assunto: c.assunto,
        veredito: c.veredito,
        escopo: c.escopo,
        sempre: c.sempre,
        afetados: c.testes.testes,
        afetadosPorNome: c.testes.porNome,
        afetadosPorGrafo: c.testes.porGrafo,
        motivo: c.motivo,
        ms: c.ms,
      })),
    },
    null,
    2,
  )
}

const USO = `uso: node scripts/prove-stack-per-commit.mjs [--base REF] [--root DIR] [--medir] [--only SHA]
       [--json] [--keep] [--sem-sempre] [--sem-afetados] [--sempre "CMD"] [--max-commits N]
       [--pushed [--refs "<linha do protocolo>"]] [--sem-topo] [--amostra N]`

/**
 * O protocolo do pre-push, direto do stdin. Lido SÓ no modo `--pushed` e só
 * quando o stdin é um PIPE ou um ARQUIVO: num terminal (hook rodado à mão) ler
 * ali bloquearia a sessão de quem o chamou, e não há protocolo nenhum para ler.
 *
 * @returns {string}
 */
function lerRefsDoStdin() {
  try {
    const modo = fstatSync(0)
    if (!modo.isFIFO() && !modo.isFile()) return ""
    return readFileSync(0, "utf8")
  } catch {
    return ""
  }
}

/**
 * O JSON do recorte VAZIO (o caminho comum) — a MESMA forma do relatório cheio,
 * para quem lê o `--json` não precisar de dois parsers: `commits: 0`, e o
 * recorte declara por que não havia o que medir.
 */
export function recorteVazio(recorte, base, head) {
  return {
    base,
    origemBase: "--pushed",
    head,
    teto: MAX_COMMITS_PADRAO,
    sempre: [],
    commits: 0,
    recorte,
    veredito: "ok",
    vermelhos: 0,
    indeterminados: 0,
    custoMs: 0,
    resultados: [],
  }
}

/** O relatório do recorte VAZIO — o caminho comum: um push sem MEIO a julgar. */
/**
 * A VARREDURA do resíduo, DITA — e nos DOIS relatórios, porque o caminho COMUM
 * (um push de um commit não tem MEIO) é justamente onde ela mais acontece. Uma
 * execução morta limpa em silêncio seria o mesmo defeito de antes, mais discreto.
 *
 * @returns {string[]} linhas (vazio quando não há o que dizer)
 */
export function renderLimpeza(limpeza) {
  const L = []
  if (!limpeza) return L
  const { varridos = [], naoRemovidos = [], preservados = [], emUso = [], naoMeus = [] } = limpeza
  if (varridos.length || preservados.length || naoMeus.length) {
    L.push(
      `  resíduo de execuções MORTAS: ${varridos.length} varrido(s)${
        varridos.length
          ? ` (${varridos
              .map((v) => v.nome)
              .slice(0, 4)
              .join(" ")}${varridos.length > 4 ? " …" : ""})`
          : ""
      }${preservados.length ? ` · ${preservados.length} preservado(s) por --keep` : ""}${
        naoMeus.length
          ? ` · ${naoMeus.length} fora do MEU escopo (NÃO TOCADO: ${[
              ...new Set(naoMeus.map((n) => n.motivo)),
            ].join("; ")})`
          : ""
      }`,
    )
  }
  // Uma varredura que FALHA também é dita: o resíduo fica no disco, e "não deu
  // para limpar" só pode ser lido se estiver escrito.
  if (naoRemovidos.length)
    L.push(
      `  ⚠️  resíduo que NÃO pôde ser varrido: ${naoRemovidos.length} (${naoRemovidos
        .map((v) => v.nome)
        .slice(0, 4)
        .join(" ")}) — o host negou a remoção, limpe à mão`,
    )
  if (emUso.length)
    L.push(`  em uso por outra execução VIVA: ${emUso.length} worktree(s) — preservado(s)`)
  return L
}

export function renderRecorteVazio({ recorte, limpeza = null }) {
  const L = []
  L.push("")
  L.push("  Recorte do push — os commits do MEIO (o vermelho que o topo esconde)")
  L.push("  ──────────────────────────────────────────────────────────────────────")
  L.push(`  refs: ${recorte.refs} · origem: ${recorte.origem}`)
  L.push(
    `  o push leva ${recorte.noRecorte} commit(s)${recorte.semTopo ? " e o TOPO fica fora do recorte (a árvore dele é o que as outras fases deste hook já medem)" : ""}`,
  )
  L.push(
    "  ✅ NADA A MEDIR: não há MEIO neste push — o recorte está vazio, e isso é MEDIDO, não presumido",
  )
  L.push(...renderLimpeza(limpeza))
  L.push("")
  return L.join("\n")
}

function main(argv) {
  const opcoes = {
    json: false,
    medir: false,
    keep: false,
    semSempre: false,
    semAfetados: false,
    sempre: [],
    pushed: false,
    semTopo: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const valor = () => {
      const v = argv[++i]
      if (v === undefined) {
        console.error(`❌ ${a} exige um valor\n${USO}`)
        process.exit(EXIT.USAGE)
      }
      return v
    }
    switch (a) {
      case "--base":
        opcoes.base = valor()
        break
      case "--head":
        opcoes.head = valor()
        break
      case "--root":
        opcoes.root = valor()
        break
      case "--only":
        opcoes.only = valor()
        break
      case "--pushed":
        opcoes.pushed = true
        break
      case "--sem-topo":
        opcoes.semTopo = true
        break
      case "--refs":
        opcoes.refs = valor()
        break
      case "--amostra": {
        const n = Number(valor())
        if (!Number.isInteger(n) || n <= 0) {
          console.error(`❌ --amostra exige um inteiro > 0\n${USO}`)
          process.exit(EXIT.USAGE)
        }
        opcoes.amostra = n
        break
      }
      case "--sempre":
        opcoes.sempre.push(valor())
        break
      case "--max-commits": {
        const n = Number(valor())
        if (!Number.isInteger(n) || n <= 0) {
          console.error(`❌ --max-commits exige um inteiro > 0\n${USO}`)
          process.exit(EXIT.USAGE)
        }
        opcoes.teto = n
        break
      }
      case "--json":
        opcoes.json = true
        break
      case "--medir":
        opcoes.medir = true
        break
      case "--keep":
        opcoes.keep = true
        break
      case "--sem-sempre":
        opcoes.semSempre = true
        break
      case "--sem-afetados":
        opcoes.semAfetados = true
        break
      case "-h":
      case "--help":
        console.log(USO)
        process.exit(EXIT.OK)
        break
      default:
        console.error(`❌ flag desconhecida: ${a}\n${USO}`)
        process.exit(EXIT.USAGE)
    }
  }

  const root = resolve(opcoes.root || REPO_ROOT)
  const gitDe = (cwd) => (args) => {
    const r = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" })
    return r.status === 0 ? (r.stdout || "").trim() : ""
  }
  const git = gitDe(root)
  // O HEAD medido: `--head`, o env do job (`PILHA_HEAD` — no PR o checkout é o
  // commit de MERGE, e medir a pilha a partir dele mediria outra pilha), ou o
  // HEAD do checkout.
  const head = opcoes.head || process.env.PILHA_HEAD || git(["rev-parse", "HEAD"])
  if (!head) {
    console.error(`❌ não consegui resolver o HEAD em ${root}`)
    process.exit(EXIT.UNAVAILABLE)
  }

  const sempre = opcoes.sempre.length
    ? opcoes.sempre.map((cmd) => ({ id: cmd, cmd: cmd.split(" ") }))
    : CONJUNTO_SEMPRE
  const teto = opcoes.teto || MAX_COMMITS_PADRAO

  // A limpeza nos SINAIS (para a execução interrompida não deixar o worktree
  // dela) e a VARREDURA do resíduo das mortas, com o dono lido do marcador.
  // As duas são DITAS no relatório — varredura silenciosa seria outro defeito.
  instalarLimpezaNoSinal({ root })
  const limpeza = limparResiduos({ root })

  if (opcoes.pushed && opcoes.only) {
    console.error(
      `❌ --pushed e --only são modos diferentes (um lê o protocolo, o outro mede um sha)\n${USO}`,
    )
    process.exit(EXIT.USAGE)
  }

  const baseDeclarada = resolverBase({ base: opcoes.base, git })
  let commits
  let relatorioBase
  let origemBase
  let recorte = null
  let headDoRelatorio = head
  if (opcoes.pushed) {
    const texto = opcoes.refs ?? lerRefsDoStdin()
    const { refs, ignoradas } = refsDoPush(texto)
    if (!refs.length) {
      console.error(
        `◐ nenhuma ref no protocolo do pre-push (${ignoradas.length} linha(s) malformada(s)) — nada a medir neste recorte. ` +
          "O hook foi rodado fora de um `git push`?",
      )
      process.exit(EXIT.OK)
    }
    const doPush = commitsDoPush({ git, refs, base: baseDeclarada })
    if (doPush.commits === null) {
      console.error(
        `❌ INDETERMINADO: ${doPush.origem} — sem base não há como delimitar a pilha deste push. ` +
          "Medir a história inteira e chamá-la de pilha deste push seria outro fato; o veredito da pilha é do job stack-per-commit do CI.",
      )
      process.exit(EXIT.UNAVAILABLE)
    }
    const noRecorte = doPush.commits.length
    const lista = opcoes.semTopo ? doPush.commits.slice(0, -1) : doPush.commits
    const amostra = opcoes.amostra ?? AMOSTRA_PADRAO
    const { medidos, pulados } = amostrar(lista, amostra)
    commits = medidos
    recorte = {
      refs: refs.length,
      ignoradas: ignoradas.length,
      noRecorte,
      semTopo: Boolean(opcoes.semTopo),
      amostra,
      medidos: medidos.length,
      pulados,
      origem: doPush.origem,
      negativos: doPush.negativos,
    }
    relatorioBase = doPush.origem
    origemBase = "--pushed"
    const locais = refs.map((ref) => ref.localSha).filter((sha) => !ZEROS.test(sha))
    if (locais.length) headDoRelatorio = locais[0]
    if (commits.length === 0) {
      if (opcoes.json)
        console.log(json({ ...recorteVazio(recorte, relatorioBase, headDoRelatorio), limpeza }))
      else console.log(renderRecorteVazio({ recorte, limpeza }))
      process.exit(EXIT.OK)
    }
  } else if (opcoes.only) {
    commits = [opcoes.only]
    relatorioBase = `--only ${String(opcoes.only).slice(0, 8)}`
    origemBase = "--only"
  } else {
    if (!baseDeclarada.ref) {
      console.error(
        `❌ nenhuma base resolvida (${baseDeclarada.origem}) — a pilha não pôde ser delimitada`,
      )
      process.exit(EXIT.UNAVAILABLE)
    }
    const mergeBase = git(["merge-base", baseDeclarada.ref, head])
    commits = pilha({ git, base: baseDeclarada.ref, head })
    relatorioBase = `${baseDeclarada.ref} @${(mergeBase || "").slice(0, 8)}`
    origemBase = baseDeclarada.origem
  }

  // O topo fora do recorte: a ÁRVORE dele é o que as outras fases do hook (e o
  // PR) já medem — o que vive sem medição é o MEIO.
  if (!recorte && opcoes.semTopo) commits = commits.slice(0, -1)

  if (!recorte && commits.length > teto) {
    console.error(
      `❌ INDETERMINADO: a pilha tem ${commits.length} commit(s) e o teto é ${teto}. ` +
        `Este job mede a pilha inteira, um worktree por commit — acima do teto ele não mede (nunca verde por não saber). ` +
        `Suba o teto com --max-commits se a medição couber no tempo.`,
    )
    process.exit(EXIT.UNAVAILABLE)
  }
  if (commits.length === 0) {
    console.error(
      `❌ INDETERMINADO: a pilha está vazia (${relatorioBase}..${head.slice(0, 8)}) — nada a medir`,
    )
    process.exit(EXIT.UNAVAILABLE)
  }

  const inicio = Date.now()
  const resultados = []
  for (const sha of commits) {
    const r = medirCommit({
      root,
      sha,
      git,
      sempre,
      semSempre: opcoes.semSempre,
      semAfetados: opcoes.semAfetados,
      lerArquivo: lerArquivoPadrao,
      keep: opcoes.keep,
    })
    resultados.push(r)
    if (!opcoes.json)
      process.stdout.write(
        `  ${r.veredito === "verde" ? "✅" : r.veredito === "vermelho" ? "❌" : "◐"} ${r.sha.slice(0, 8)} ${r.veredito}\n`,
      )
  }

  const ag = agregar(resultados)
  // A LEITURA do registro: os vermelhos medidos são separados entre DÍVIDA
  // DECLARADA (a seção `pilha` do `ci/unproven.json` declara o assunto e o
  // motivo medido) e REGRESSÃO (nenhuma declaração alcança). O registro
  // ausente/ilegível NUNCA vira regressão — "não consegui ler" não é "não
  // declarou" — e fica NÃO CLASSIFICADO, nomeado no veredito.
  const dividaPilha = separarDividaDeRegressao({
    vermelhos: resultados
      .filter((c) => c.veredito === "vermelho")
      .map((c) => ({ sha: c.sha, assunto: c.assunto, motivo: c.motivo })),
    secao: lerSecaoPilha({ root }),
  })
  const relatorio = {
    base: relatorioBase,
    origemBase,
    head: headDoRelatorio,
    teto,
    sempre,
    commits,
    recorte,
    limpeza,
    resultados,
    dividaPilha,
    custoMs: Date.now() - inicio,
    ...ag,
  }

  if (opcoes.json) console.log(json(relatorio))
  else console.log(renderRelatorio(relatorio))

  if (opcoes.medir) process.exit(EXIT.OK)
  process.exit(ag.exit)
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url)))
  main(process.argv.slice(2))
