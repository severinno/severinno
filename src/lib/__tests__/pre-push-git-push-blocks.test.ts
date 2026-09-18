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
 * O simulador é o COMPARTILHADO (`helpers/hook-simulator.ts`) e as CONSTANTES do
 * hook + o fixture vêm da CAMADA do `.husky/pre-push`
 * (`scripts/pre-push-proof.mjs` → `helpers/pre-push-fixture.ts`) — o MESMO módulo
 * de onde o `forge-doctor` executa `provePushBlocks()` para publicar o fato. O
 * que mora aqui é só o que é do TESTE: as mutações e a âncora da linha do
 * typecheck.
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
 *     para qualquer coisa que não seja o typecheck. Nenhum deles é o assunto, e a
 *     razão de cada um está escrita no dublê (`WRAPPER_SOURCE`).
 *
 * Usage:
 *   bunx vitest run --config vitest.config.unit.ts src/lib/__tests__/pre-push-git-push-blocks.test.ts
 */

import { chmodSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { afterAll, describe, expect, it } from "vitest"
// A máquina de simular o hook (repo git temporário, dublê declarado, medições no
// banco do git E no do REMOTO) vem do simulador COMPARTILHADO; as CONSTANTES do
// hook sob teste e o fixture vêm da camada do `.husky/pre-push`.
import {
  COMPLETOU,
  HOOK_UNDER_TEST,
  cleanupFixtures,
  commitObjects,
  contentAtRef,
  countObjects,
  gitConfig,
  gitConfigSet,
  isExecutable,
  refsOf,
  runGit,
  shellParses,
  stage,
  wrapperSource,
} from "@/lib/__tests__/helpers/hook-simulator"
import {
  ARVORE_BOA,
  ARVORE_RUIM,
  FRASE_DA_REPROVACAO,
  HOOK_SOURCE,
  HOOKS_DIR,
  TYPECHECK_COMMAND,
  WRAPPER_SOURCE,
  invocacoesDoPayload,
  montaPushFixture,
} from "@/lib/__tests__/helpers/pre-push-fixture"

/**
 * A invocação ISOLADA da fase 2 — a linha canônica, âncora de M1/M1b/M1c. Ela é
 * asserida contra o arquivo REAL do hook: se a linha mudar de forma, a mutação
 * deixa de casar e passaria a medir um no-op.
 *
 * O fast path NÃO é uma linha solta: ele CAPTURA a saída para que o veredito
 * seja o do typecheck (antes era `… 2>&1 | head -5`, e o status da pipeline era
 * o do `head` — o gate era um no-op). As duas formas são âncoras declaradas
 * abaixo, e o par é o que torna a FORMA do fast path mensurável.
 */
const TYPECHECK_LINE = `\n${TYPECHECK_COMMAND}\n`

/**
 * O trecho do fast path que torna o typecheck um GATE: a captura com o `exit 1`.
 * Presente uma única vez no hook real.
 */
const FASTPATH_GUARD = `    if ! TYPE_OUT=$(bun run typecheck 2>&1); then
      head -5 <<< "$TYPE_OUT"
      echo ""
      echo "❌ typecheck FALHOU — o push está bloqueado (o MESMO comando do CI)"
      exit 1
    fi
    head -5 <<< "$TYPE_OUT"
`

/**
 * A forma que ENGOLE o não-zero (o defeito medido): numa pipeline o status é o do
 * último comando, então `… | head -5` devolve 0 com o tsc reprovando.
 */
const FASTPATH_ENGOLINDO = `    bun run typecheck 2>&1 | head -5\n`

afterAll(() => {
  cleanupFixtures()
})

/** Quantas vezes um trecho aparece (a checagem de que a mutação é cirúrgica). */
function ocorrencias(texto: string, alvo: string): number {
  return texto.split(alvo).length - 1
}

// ── premissa: o git PROCURA, HONRA e executa o hook do repositório ────────

describe("a premissa do git: o `pre-push` é encontrado, é executável e é o arquivo real", () => {
  it("o `core.hooksPath` do fixture aponta para os hooks, e o hook ali é EXECUTÁVEL", () => {
    const { dir, hook } = montaPushFixture({ arvore: "verde" })
    // Sem o caminho apontado o git procura em `.git/hooks` (vazio) e o push
    // entra com o defeito; sem o bit de execução o git IGNORA o arquivo e faz o
    // mesmo. As duas metades são a premissa desta prova — medidas, não supostas.
    expect(gitConfig(dir, "core.hooksPath")).toBe(HOOKS_DIR)
    expect(isExecutable(hook)).toBe(true)
  })

  it("o hook que o git executa é o ARQUIVO REAL do repositório (byte a byte)", () => {
    const { dir, hook } = montaPushFixture({ arvore: "verde" })
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
    const { dir, remoto } = montaPushFixture({ arvore: "vermelha" })
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
    const { dir, remoto } = montaPushFixture({ arvore: "verde" })

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
    const { dir, remoto } = montaPushFixture({ arvore: "vermelha" })
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
  it("M1 — a fase 2 sai e o FAST PATH segura o defeito (defesa em profundidade)", () => {
    // O VEREDITO MUDOU COM O CONSERTO. Antes, remover a fase 2 deixava o push
    // ENTRAR: o fast path re-invocava o typecheck, mas com `… | head -5` o status
    // era o do `head` — um gate decorativo. Agora o fast path CAPTURA a saída, o
    // veredito é o do typecheck e o defeito continua barrado por ele.
    //
    // Cirúrgica: a linha isolada da fase 2 aparece uma única vez (o fast path é
    // um bloco, com a captura), então remover uma não toca na outra.
    expect(ocorrencias(HOOK_SOURCE, TYPECHECK_LINE)).toBe(1)
    expect(ocorrencias(HOOK_SOURCE, FASTPATH_GUARD)).toBe(1)
    expect(ocorrencias(HOOK_SOURCE, FASTPATH_ENGOLINDO)).toBe(0)
    const mutado = HOOK_SOURCE.replace(TYPECHECK_LINE, "\n")
    expect(mutado).not.toBe(HOOK_SOURCE)
    expect(shellParses(mutado)).toBe(true)

    const { dir, remoto } = montaPushFixture({ arvore: "vermelha", hookSourceTexto: mutado })

    const res = runGit(dir, ["push", "origin", "main"])

    // O push é RECUSADO e o remoto fica SEM nada — e a recusa é atribuída: a
    // saída cita a reprovação do payload (não um erro de ambiente) e o fast path
    // aparece como o caminho que correu.
    expect(res.status).not.toBe(0)
    expect(res.output).toContain(FRASE_DA_REPROVACAO)
    expect(res.output).toContain("Nenhum teste afetado")
    expect(res.output).toContain("typecheck FALHOU")
    expect(refsOf(remoto)).toEqual([])
    expect(countObjects(remoto)).toBe(0)
    // Exatamente UMA invocação: a do fast path. É ela que barrou — medido no
    // processo real, não deduzido de "o push falhou".
    expect(invocacoesDoPayload(dir)).toBe(1)
  })

  it("M1b — a fase 2 sai E o fast path volta a ENGOLIR: o defeito ENTRA", () => {
    // A FORMA do fast path é load-bearing: o único delta contra M1 é voltar à
    // pipeline que mascara o não-zero — e o resultado inverte. Sem esta metade,
    // "o fast path segura" (M1) seria compatível com um conserto que não é o
    // conserto: aqui é o `| head` que reabre o buraco.
    expect(ocorrencias(HOOK_SOURCE, FASTPATH_GUARD)).toBe(1)
    const mutado = HOOK_SOURCE.replace(TYPECHECK_LINE, "\n").replace(
      FASTPATH_GUARD,
      FASTPATH_ENGOLINDO,
    )
    expect(mutado).not.toBe(HOOK_SOURCE)
    expect(ocorrencias(mutado, FASTPATH_ENGOLINDO)).toBe(1)
    expect(shellParses(mutado)).toBe(true)

    const { dir, remoto } = montaPushFixture({ arvore: "vermelha", hookSourceTexto: mutado })

    const res = runGit(dir, ["push", "origin", "main"])

    expect(res.status).toBe(0)
    // O conteúdo VERMELHO gravado no ref remoto: é o defeito na forja, não
    // "houve push".
    expect(contentAtRef(remoto, "refs/heads/main", "src/foo.ts")).toBe(ARVORE_RUIM)
    // E o payload REPROVOU de verdade (o rastro está lá): o não-zero existiu e foi
    // MASCARADO pelo filtro — é exatamente o defeito, medido.
    expect(res.output).toContain(FRASE_DA_REPROVACAO)
    expect(invocacoesDoPayload(dir)).toBe(1)
  })

  it("M1c — sem NENHUMA invocação do typecheck o defeito ENTRA", () => {
    // A metade que o M1 original media, preservada: o gate do typecheck — na
    // fase 2 e no fast path — é load-bearing. Removido por inteiro, a árvore
    // vermelha atravessa o hook.
    const mutado = HOOK_SOURCE.replace(TYPECHECK_LINE, "\n").replace(
      FASTPATH_GUARD,
      '    echo "⚡ (typecheck removido pela mutação)"\n',
    )
    expect(mutado).not.toBe(HOOK_SOURCE)
    // Nenhuma linha EXECUTÁVEL invoca o typecheck (a prosa do hook ainda cita o
    // comando — é dela que o comentário tira a explicação do defeito).
    const executaveis = mutado.split("\n").filter((linha) => !/^\s*#/.test(linha))
    expect(executaveis.some((linha) => linha.includes(TYPECHECK_COMMAND))).toBe(false)
    expect(shellParses(mutado)).toBe(true)

    const { dir, remoto } = montaPushFixture({ arvore: "vermelha", hookSourceTexto: mutado })

    const res = runGit(dir, ["push", "origin", "main"])

    expect(res.status).toBe(0)
    expect(contentAtRef(remoto, "refs/heads/main", "src/foo.ts")).toBe(ARVORE_RUIM)
    // Nenhuma invocação: o comando não foi chamado nenhuma vez — o defeito
    // entrou sem veredito nenhum sobre a árvore.
    expect(invocacoesDoPayload(dir)).toBeNull()
  })

  it("M2 — o `hooksPath` aponta para OUTRO diretório: o hook não é procurado e o defeito ENTRA", () => {
    // A premissa da premissa: se o caminho não apontasse para os hooks, nenhuma
    // asserção acima mediria o hook — mediriam o git ignorando-o em silêncio.
    const { dir, remoto } = montaPushFixture({ arvore: "vermelha" })
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
      const { dir, remoto, hook } = montaPushFixture({ arvore: "vermelha" })
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
    const { dir, remoto } = montaPushFixture({
      arvore: "vermelha",
      wrapper: wrapperSource([{ tool: "bun" }, { tool: "bash" }, { tool: "curl", code: 1 }]),
    })

    const res = runGit(dir, ["push", "origin", "main"])

    expect(res.status).toBe(0)
    expect(invocacoesDoPayload(dir)).toBeNull()
    expect(contentAtRef(remoto, "refs/heads/main", "src/foo.ts")).toBe(ARVORE_RUIM)
  })
})
