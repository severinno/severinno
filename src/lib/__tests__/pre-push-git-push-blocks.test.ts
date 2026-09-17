/**
 * pre-push-git-push-blocks.test.ts
 *
 * A prova de EXECUÇÃO do hook `.husky/pre-push`: um `git push` de VERDADE contra
 * um remoto BARE, com `core.hooksPath` apontando para os hooks do repo. O
 * veredito é medido onde ele é pago — no OBJETO que chegou (ou não) ao remoto
 * (`git cat-file --batch-all-objects`), e não no stdout de ninguém.
 *
 * Por que existe um elo aqui que o `pre-commit` não cobria: o `pre-commit` mede
 * "o objeto de commit não foi criado"; no push, o git CONSULTA o remoto antes de
 * rodar o hook e só manda o pack DEPOIS dele — então a promessa a medir é outra:
 * um `pre-push` que reprova não pode deixar **objeto nenhum** do outro lado.
 * (Medido: remoto sem ref e sem objeto, `refsOf` e `commitObjects` = 0.)
 *
 * O simulador é o COMPARTILHADO (`helpers/hook-simulator.ts`) — o mesmo repo git
 * temporário, o mesmo dublê com passthrough e as mesmas medições que as duas
 * provas do `pre-commit` usam. Só as CONSTANTES deste hook moram aqui, porque
 * este é o único consumidor delas.
 *
 * O que é REAL e o que é DUBLÊ (declarado, nunca implícito):
 *
 *   - REAL: `bun run typecheck` — o comando do hook, executado pelo binário
 *     verdadeiro, e o desfecho vem do CONTEÚDO versionado do `src/foo.ts` do
 *     fixture (`ERRO_DE_TIPO`), não de um arquivo fora do git. O `package.json`
 *     do fixture aponta o script para um payload que REGISTRA cada invocação: é
 *     assim que se prova que o processo real rodou (M4 mede o contrário);
 *   - DUBLÊ: `bash scripts/run-encoding-guards.sh` (irmão de fase), `curl` do
 *     bloco advisory do Lighthouse (devolve 1 ⇒ "Server not running") e o `bun`
 *     para qualquer coisa que não seja o typecheck. Nenhum deles é o assunto.
 *
 * Usage:
 *   bunx vitest run --config vitest.config.unit.ts src/lib/__tests__/pre-push-git-push-blocks.test.ts
 */

import { chmodSync, existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import {
  COMPLETOU,
  HOOK_UNDER_TEST,
  REPO_ROOT,
  bareRemote,
  cleanupFixtures,
  commitObjects,
  contentAtRef,
  countObjects,
  gitConfig,
  gitConfigSet,
  isExecutable,
  novoRepo,
  refsOf,
  runGit,
  shellParses,
  stage,
  wrapperSource,
  writeHook,
} from "@/lib/__tests__/helpers/hook-simulator"

/** O hook sob teste: o ARQUIVO REAL do repositório, lido (não uma cópia). */
const HOOK = join(REPO_ROOT, ".husky", "pre-push")
const HOOK_SOURCE = readFileSync(HOOK, "utf8")
const HOOK_NAME = "pre-push"
const HOOKS_DIR = ".husky"

/**
 * A linha do hook que o dublê tem de liberar para o processo REAL. Ela é
 * asserida contra o arquivo real: se o comando do hook mudar, o `match` deixa de
 * casar e o fixture passa a medir um dublê que devolve 0 — o verde falso que o
 * passthrough existe para evitar.
 */
const TYPECHECK_COMMAND = "bun run typecheck"
/** A invocação ISOLADA da fase 2 (a do fast path é `… 2>&1 | head -5`). */
const TYPECHECK_LINE = `\n${TYPECHECK_COMMAND}\n`

/** O payload do comando real: o veredito vem do conteúdo, e a linha é o rastro. */
const PAYLOAD = `// O PAYLOAD declarado do \`bun run typecheck\` do fixture.
import { appendFileSync, readFileSync } from "node:fs"

// A linha é o rastro de que o PROCESSO REAL rodou (e quantas vezes): sem ela,
// "não chegou nada ao remoto" seria compatível com um dublê que mentiu.
appendFileSync("typecheck-invocado.log", "typecheck\\n")

const fonte = readFileSync("src/foo.ts", "utf8")
if (fonte.includes("ERRO_DE_TIPO")) {
  console.error("src/foo.ts(1,8): error TS2322: TYPECHECK_DO_FIXTURE_REPROVOU")
  process.exit(1)
}
console.log("typecheck do fixture: OK")
`

const PACKAGE_JSON = `${JSON.stringify(
  {
    name: "fixture-hook",
    private: true,
    scripts: { typecheck: "node scripts/typecheck-fixture.mjs" },
  },
  null,
  2,
)}\n`

const ARVORE_BASE = 'export const oi = "base"\n'
const ARVORE_BOA = 'export const oi = "verde"\n'
/** A árvore VERMELHA: o defeito é o CONTEÚDO versionado, não o ambiente. */
const ARVORE_RUIM = 'export const oi: number = "ERRO_DE_TIPO"\n'

/**
 * O dublê do `pre-push`. `node` não aparece porque o hook não o chama direto (o
 * typecheck o spawna como processo de verdade, fora do dublê).
 */
const WRAPPER_SOURCE = wrapperSource([
  {
    tool: "bun",
    match: "typecheck",
    why: "o comando sob teste é REAL: o dublê só o reconhece para liberar `command bun`",
  },
  // Os irmãos de fase: o runner dos encoding guards (não existe no fixture) e o
  // `curl` do bloco advisory do Lighthouse — 1 = "Server not running", o que
  // mantém o push determinístico mesmo com um dev server de pé na máquina.
  { tool: "bash", code: 0 },
  { tool: "curl", code: 1 },
])

afterAll(() => {
  cleanupFixtures()
})

/** Quantas vezes o payload rodou; `null` = o processo real NUNCA foi executado. */
function invocacoesDoPayload(dir: string): number | null {
  const caminho = join(dir, "typecheck-invocado.log")
  if (!existsSync(caminho)) return null
  return readFileSync(caminho, "utf8").split("\n").filter(Boolean).length
}

/** Quantas vezes um trecho aparece (a checagem de que a mutação é cirúrgica). */
function ocorrencias(texto: string, alvo: string): number {
  return texto.split(alvo).length - 1
}

interface Fixture {
  dir: string
  remoto: string
  hook: string
}

/**
 * Monta o fixture: o repo de trabalho, o remoto BARE e o `pre-push` escrito por
 * ÚLTIMO.
 *
 * A base é comitada ANTES de o hook existir — ela não é o assunto, e um hook que
 * bloqueasse o próprio setup faria a prova medir o fixture. O commit sob teste
 * muda `src/foo.ts`: o smart-skip do hook precisa de um arquivo que NÃO seja
 * doc/config (`SKIP_PATTERN`) e que não mapeie para nenhum teste afetado — é
 * assim que ele chega no `else` do fast path.
 *
 * O `HEAD~1` do smart-skip vem daí: no primeiro push não há `@{u}`, e a base
 * comitada é o que dá ao hook um ponto de comparação real.
 */
function montaFixture(opts: {
  arvore: "verde" | "vermelha"
  hookSource?: string
  wrapper?: string
}): Fixture {
  const dir = novoRepo({
    prefix: "pre-push-push-",
    wrapper: opts.wrapper ?? WRAPPER_SOURCE,
    dirs: ["scripts", "src"],
  })
  stage(dir, "package.json", PACKAGE_JSON)
  stage(dir, "scripts/typecheck-fixture.mjs", PAYLOAD)
  stage(dir, "src/foo.ts", ARVORE_BASE)
  expect(runGit(dir, ["commit", "-q", "-m", "base"]).status).toBe(0)
  runGit(dir, ["branch", "-M", "main"])
  const remoto = bareRemote()
  runGit(dir, ["remote", "add", "origin", remoto])
  stage(dir, "src/foo.ts", opts.arvore === "vermelha" ? ARVORE_RUIM : ARVORE_BOA)
  expect(runGit(dir, ["commit", "-q", "-m", "mudança sob teste"]).status).toBe(0)
  const hook = writeHook(dir, {
    name: HOOK_NAME,
    source: opts.hookSource ?? HOOK_SOURCE,
    hooksPath: HOOKS_DIR,
  })
  return { dir, remoto, hook }
}

// ── premissa: o git PROCURA, HONRA e executa o hook do repositório ────────

describe("a premissa do git: o `pre-push` é encontrado, é executável e é o arquivo real", () => {
  it("o `core.hooksPath` do fixture aponta para os hooks, e o hook ali é EXECUTÁVEL", () => {
    const { dir, hook } = montaFixture({ arvore: "verde" })
    // Sem o caminho apontado o git procura em `.git/hooks` (vazio) e o push
    // entra com o defeito; sem o bit de execução o git IGNORA o arquivo e faz o
    // mesmo. As duas metades são a premissa desta prova — medidas, não supostas.
    expect(gitConfig(dir, "core.hooksPath")).toBe(HOOKS_DIR)
    expect(isExecutable(hook)).toBe(true)
  })

  it("o hook que o git executa é o ARQUIVO REAL do repositório (byte a byte)", () => {
    const { dir, hook } = montaFixture({ arvore: "verde" })
    expect(readFileSync(join(dir, HOOK_UNDER_TEST), "utf8")).toBe(HOOK_SOURCE)
    const shim = readFileSync(hook, "utf8")
    expect(shim).toContain(`. "$HOOK_UNDER_TEST"`)
    expect(shim.startsWith("#!")).toBe(true)
    // A passagem do dublê cobre EXATAMENTE o comando que o hook executa.
    expect(HOOK_SOURCE).toContain(TYPECHECK_COMMAND)
    expect(WRAPPER_SOURCE).toContain("*typecheck*")
    expect(shellParses(HOOK_SOURCE)).toBe(true)
  })
})

// ── a prova: push recusado ⇒ NADA chega ao remoto ────────────────────────

describe("`git push` de verdade com o typecheck vermelho: ZERO objeto no remoto", () => {
  it("PROVA: o push falha, o remoto fica sem ref e sem objeto, e o comando real parou nele", () => {
    const { dir, remoto } = montaFixture({ arvore: "vermelha" })
    expect(refsOf(remoto)).toEqual([])
    expect(commitObjects(remoto)).toBe(0)

    const res = runGit(dir, ["push", "origin", "main"])

    expect(res.status).not.toBe(0)
    // O veredito veio de um PROCESSO REAL (a saída é a do payload)…
    expect(res.output).toContain("TYPECHECK_DO_FIXTURE_REPROVOU")
    // …e o hook morreu ANTES de atravessar as fases (o sentinela não sai).
    expect(res.output).not.toContain(COMPLETOU)
    // A prova é a medida do OBJETO no REMOTO: nem ref, nem objeto de nenhum tipo.
    expect(refsOf(remoto)).toEqual([])
    expect(commitObjects(remoto)).toBe(0)
    expect(countObjects(remoto)).toBe(0)
    // Exatamente UMA invocação: a da fase 2. Sem esta metade, "nada chegou"
    // seria compatível com um dublê que devolveu 1 sem executar nada.
    expect(invocacoesDoPayload(dir)).toBe(1)
    // O histórico LOCAL segue íntegro: o hook barra o push, não o commit.
    expect(commitObjects(dir)).toBe(2)
  })

  it("o CONTROLE: a árvore VERDE atravessa o hook e o commit CHEGA ao remoto", () => {
    const { dir, remoto } = montaFixture({ arvore: "verde" })

    const res = runGit(dir, ["push", "origin", "main"])

    // As três metades do controle: o push sai 0, o hook ATRAVESSOU as fases
    // (sentinela) e o objeto chegou ao remoto com o conteúdo da árvore boa.
    expect(res.status).toBe(0)
    expect(res.output).toContain(COMPLETOU)
    expect(res.output).toContain("Nenhum teste afetado")
    expect(res.output).toContain("Server not running")
    expect(refsOf(remoto)).toEqual(["refs/heads/main"])
    // Dois commits no remoto, não um: no primeiro push a HISTÓRIA INTEIRA viaja
    // (a base comitada + a mudança sob teste). O que a prova mede é a diferença
    // contra o zero anterior ao push — `countObjects` do remoto contava 0.
    expect(commitObjects(remoto)).toBe(2)
    expect(contentAtRef(remoto, "refs/heads/main", "src/foo.ts")).toBe(ARVORE_BOA)
    // As DUAS invocações do typecheck (a da fase 2 e a do fast path) rodaram de
    // verdade: é o passthrough medido no processo, e não prometido em prosa.
    expect(invocacoesDoPayload(dir)).toBe(2)
  })

  it("o MESMO repo aceita o push quando o defeito é corrigido — a recusa era do hook", () => {
    // Se a recusa viesse do ambiente (identidade, remoto, hooks) o push
    // corrigido também falharia — e é esse o falso positivo que uma prova de
    // "não chegou nada" corre o risco de medir.
    const { dir, remoto } = montaFixture({ arvore: "vermelha" })
    expect(runGit(dir, ["push", "origin", "main"]).status).not.toBe(0)
    expect(commitObjects(remoto)).toBe(0)

    stage(dir, "src/foo.ts", ARVORE_BOA)
    expect(runGit(dir, ["commit", "--amend", "-q", "--no-edit"]).status).toBe(0)
    const res = runGit(dir, ["push", "origin", "main"])

    expect(res.status).toBe(0)
    expect(commitObjects(remoto)).toBe(2)
    expect(contentAtRef(remoto, "refs/heads/main", "src/foo.ts")).toBe(ARVORE_BOA)
  })
})

// ── mutação: o bloqueio é do HOOK (e do processo REAL), não do git ───────

describe("mutação: sem a chamada, sem o `hooksPath`, sem o bit ou sem a passagem, o defeito ENTRA", () => {
  it("M1 — o hook deixa de CHAMAR o typecheck: o push entra com a árvore vermelha", () => {
    // Cirúrgica: a linha isolada da fase 2 aparece uma única vez (o fast path é
    // outra linha, com o `| head -5`), então remover uma não toca na outra.
    expect(ocorrencias(HOOK_SOURCE, TYPECHECK_LINE)).toBe(1)
    const mutado = HOOK_SOURCE.replace(TYPECHECK_LINE, "\n")
    expect(mutado).not.toBe(HOOK_SOURCE)
    expect(shellParses(mutado)).toBe(true)

    const { dir, remoto } = montaFixture({ arvore: "vermelha", hookSource: mutado })

    const res = runGit(dir, ["push", "origin", "main"])

    expect(res.status).toBe(0)
    // O defeito CHEGOU à forja: não é "houve push", é o conteúdo vermelho
    // gravado no ref remoto (o que o hook existe para impedir).
    expect(contentAtRef(remoto, "refs/heads/main", "src/foo.ts")).toBe(ARVORE_RUIM)
    // ACHADO MEDIDO (declarado, não consertado aqui): sobrou a invocação do
    // `else` do smart-skip (`bun run typecheck 2>&1 | head -5`), que também
    // REPROVOU — o payload registrou o rastro e devolveu 1 — e mesmo assim o
    // push entrou: sem `pipefail` o status da pipeline é o do `head`, então o
    // não-zero dela é MASCARADO e não bloqueia nada. O que segurava o push era
    // só a linha da fase 2, e é esta a metade que a mutação prova ser
    // load-bearing.
    expect(invocacoesDoPayload(dir)).toBe(1)
    expect(res.output).toContain("Nenhum teste afetado")
  })

  it("M2 — o `hooksPath` aponta para OUTRO diretório: o hook não é procurado e o defeito ENTRA", () => {
    // A premissa da premissa: se o caminho não apontasse para os hooks, nenhuma
    // asserção acima mediria o hook — mediriam o git ignorando-o em silêncio.
    const { dir, remoto } = montaFixture({ arvore: "vermelha" })
    gitConfigSet(dir, "core.hooksPath", ".git/hooks")

    const res = runGit(dir, ["push", "origin", "main"])

    expect(res.status).toBe(0)
    // O hook real NÃO rodou: nem o sentinela, nem o comando do typecheck.
    expect(res.output).not.toContain(COMPLETOU)
    expect(invocacoesDoPayload(dir)).toBeNull()
    expect(contentAtRef(remoto, "refs/heads/main", "src/foo.ts")).toBe(ARVORE_RUIM)
  })

  it.skipIf(process.platform === "win32")(
    "M3 — SEM o bit de execução o git IGNORA o hook: o push entra com o defeito",
    () => {
      // O falso positivo mais perigoso desta camada: um hook não-executável não
      // falha, ele SOME (o git avisa num `hint:` e segue) — e é por isso que o
      // simulador aplica o modo e a premissa o confere.
      const { dir, remoto, hook } = montaFixture({ arvore: "vermelha" })
      chmodSync(hook, 0o644)

      const res = runGit(dir, ["push", "origin", "main"])

      expect(isExecutable(hook)).toBe(false)
      expect(res.status).toBe(0)
      expect(invocacoesDoPayload(dir)).toBeNull()
      expect(contentAtRef(remoto, "refs/heads/main", "src/foo.ts")).toBe(ARVORE_RUIM)
    },
  )

  it("M4 — o dublê deixa de LIBERAR o processo real: a árvore vermelha PASSA", () => {
    // A mutação da própria PASSAGEM: `bun` vira um dublê que devolve 0 para tudo.
    // Mede que liberar o processo real é load-bearing — sem isso, o hook
    // "passaria" verificando um dublê, e o verde não teria nada a ver com o
    // comando que o CI executa.
    const { dir, remoto } = montaFixture({
      arvore: "vermelha",
      wrapper: wrapperSource([{ tool: "bun" }, { tool: "bash" }, { tool: "curl", code: 1 }]),
    })

    const res = runGit(dir, ["push", "origin", "main"])

    expect(res.status).toBe(0)
    expect(invocacoesDoPayload(dir)).toBeNull()
    expect(contentAtRef(remoto, "refs/heads/main", "src/foo.ts")).toBe(ARVORE_RUIM)
  })
})
