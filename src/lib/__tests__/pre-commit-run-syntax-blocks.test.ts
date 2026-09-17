/**
 * pre-commit-run-syntax-blocks.test.ts
 *
 * Prova, EXECUTANDO o arquivo real do hook `.husky/pre-commit`, que um corpo
 * `run:` quebrado no ÍNDICE derruba o commit — em vez de medir isso por leitura
 * do hook (`.toContain("--staged")`), que é o que existia até aqui.
 *
 * O que a prova monta (e o que ela NÃO monta):
 *
 *   - o hook é o ARQUIVO REAL, somado (`. "$HOOK_UNDER_TEST"`), então a
 *     agregação (`wait_all`), a fase e a LINHA DE COMANDO são as de produção;
 *   - o repositório é um `git init` de verdade, com o defeito `git add`ado, e o
 *     guard roda com o `node` REAL: o recorte `--staged` lê o índice de verdade
 *     (`git diff --cached` + `git show :path`), o que um fixture em memória não
 *     reproduziria;
 *   - o FECHO TRANSITIVO real do guard (ele + o que ele importa) é copiado para
 *     o fixture — nenhum stub substitui o parser sob teste.
 *
 * O que é DUBLÊ, e por quê: um repositório temporário não tem `node_modules`
 * nem os outros guards, e um hook que falhasse por "script não encontrado"
 * provaria nada (não-zero pelo motivo errado — o falso positivo clássico). Os
 * irmãos de fase (que não são o assunto) e o `bun` (fases B e C) devolvem 0 por
 * FUNÇÃO no wrapper. Quem impede que o dublê esconda um falso positivo é o
 * CONTROLE: com o corpo válido o hook tem de sair 0 **e** imprimir a manchete do
 * guard no modo `--staged` — se o guard não rodasse de verdade, não haveria
 * manchete e o controle ficaria vermelho.
 *
 * A MESMA régua (repositório, dublê, fecho e linhas de comando) vive em
 * `helpers/pre-commit-fixture.ts` e é compartilhada com
 * `pre-commit-git-commit-blocks.test.ts` — o irmão onde o GIT invoca o hook por
 * `core.hooksPath` e o veredito é medido no OBJETO de commit. Duas cópias da
 * régua divergem no dia em que uma delas for ajustada; por isso os defeitos e o
 * fecho são importados, e a completude do fecho é ASSERIDA aqui.
 *
 * O defeito medido era invisível porque o hook só era conferido por leitura: a
 * prova por leitura acha a linha, não prova que ela roda nem que o exit code sai
 * diferente de zero. As mutações abaixo mostram as duas metades que a leitura
 * não vê — o guard não ser chamado, e o recorte perder o `--staged`.
 *
 * Usage:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/pre-commit-run-syntax-blocks.test.ts
 */

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { afterAll, describe, expect, it } from "vitest"
// A máquina de simular o hook (repo git temporário, dublê declarado, medições) e
// as CONSTANTES do hook sob teste vêm de camadas diferentes de propósito: o
// simulador é genérico e o compartilham os dois hooks; a camada de baixo conhece
// o `.husky/pre-commit` (o guard, o remédio e o fecho transitivo).
import {
  COMPLETOU,
  MODULES,
  REPO_ROOT,
  cleanupFixtures,
  shellParses,
  stage,
  touch,
} from "@/lib/__tests__/helpers/hook-simulator"
import {
  GUARD,
  GUARD_COMMAND,
  HOOK_SOURCE,
  REMEDY,
  REMEDY_COMMAND,
  SHELL_QUEBRADO,
  SHELL_SCRIPT,
  WORKFLOW,
  WORKFLOW_CICATRIZ,
  WORKFLOW_QUEBRADO,
  WORKFLOW_VALIDO,
  closureProblems,
  naoRelativos,
  novoRepo,
  runHook,
} from "@/lib/__tests__/helpers/pre-commit-fixture"
import { EXIT } from "../../../scripts/check-workflow-run-syntax.mjs"

afterAll(() => {
  cleanupFixtures()
})

// ── premissa ─────────────────────────────────────────────────────────────

describe("a premissa do harness", () => {
  it("o hook chama o guard de sintaxe com --staged, e o fixture torna esse comando real", () => {
    expect(HOOK_SOURCE).toContain(GUARD_COMMAND)
    expect(existsSync(join(REPO_ROOT, "scripts", GUARD))).toBe(true)
  })

  it("o hook chama o REMÉDIO depois do guard, e o fixture torna esse comando real", () => {
    expect(HOOK_SOURCE).toContain(REMEDY_COMMAND)
    expect(HOOK_SOURCE.indexOf(REMEDY_COMMAND)).toBeGreaterThan(
      HOOK_SOURCE.indexOf(`${GUARD} --staged`),
    )
    expect(existsSync(join(REPO_ROOT, "scripts", REMEDY))).toBe(true)
  })

  it("o fecho copiado é COMPLETO: toda referência local (import E spawn) está nele", () => {
    // Sem o fecho completo o script morre com "module not found" (ou o spawn do
    // guard falha) e o não-zero do hook seria do fixture, não do defeito. Uma
    // referência nova — `from "./x.mjs"` OU `new URL("./x.mjs", ...)` — aparece
    // AQUI, nomeada, em vez de virar um controle verde por acidente.
    expect(closureProblems()).toEqual([])
  })

  it("o fixture RESOLVE as dependências não relativas do fecho — senão o guard não JULGA nada", () => {
    // A premissa é MEDIDA, não presumida: o probe roda com o `node` real, no
    // diretório do fixture, e exige que cada especificador não relativo do
    // fecho resolva E que o parser de YAML de fato parseie. Sem isso o guard
    // sairia `2` ("não julgável") em TODO caso — inclusive no CONTROLE — e
    // todos os vereditos abaixo seriam do fixture, não do defeito.
    const pacotes = naoRelativos()
    // Declarado: hoje o fecho tem UM pacote (o parser). Se ele perder o parser,
    // esta linha cai antes de qualquer veredito — o mecanismo é load-bearing.
    expect(pacotes).toContain("js-yaml")
    expect(existsSync(MODULES)).toBe(true)

    const dir = novoRepo()
    const probe = [
      `const alvos = ${JSON.stringify(pacotes)}`,
      `for (const m of alvos) require.resolve(m)`,
      `const yaml = require("js-yaml")`,
      `if (typeof yaml.load !== "function") throw new Error("js-yaml sem load()")`,
      `if (yaml.load("a: 1") === null) throw new Error("js-yaml não parseia")`,
      `process.stdout.write("RESOLVEU")`,
    ].join("\n")
    const r = spawnSync(process.execPath, ["-e", probe], { cwd: dir, encoding: "utf8" })
    expect(`${r.status} ${r.stdout ?? ""}${r.stderr ?? ""}`).toContain("0 RESOLVEU")
  })
})

// ── o hook real ──────────────────────────────────────────────────────────

describe("o hook real bloqueia o commit pelo recorte --staged", () => {
  it("CONTROLE: corpo válido no índice ⇒ exit 0, o hook termina e o guard RODOU", () => {
    const dir = novoRepo()
    stage(dir, WORKFLOW, WORKFLOW_VALIDO)

    const res = runHook(dir)

    // As duas metades do controle: o hook atravessa tudo (0) E o guard real
    // executou no modo do índice. Sem a segunda, "0" poderia ser um hook que
    // nunca chamou o guard — que é justamente o defeito das mutações abaixo.
    expect(res.status).toBe(EXIT.OK)
    expect(res.output).toContain(COMPLETOU)
    expect(res.output).toContain("DO ÍNDICE")
    expect(res.output).toContain("1 workflow(s)")
  }, 60_000)

  it("corpo `run:` quebrado NO ÍNDICE ⇒ exit VIOLATIONS, nomeando arquivo e linha", () => {
    const dir = novoRepo()
    stage(dir, WORKFLOW, WORKFLOW_QUEBRADO)

    const res = runHook(dir)

    expect(res.status).toBe(EXIT.VIOLATIONS)
    expect(res.output).not.toContain(COMPLETOU)
    expect(res.output).toContain(`${WORKFLOW}:7`)
    expect(res.output).toContain("syntax error")
    // O veredito diz de onde veio a lista — o recorte é do commit.
    expect(res.output).toContain("recorte --staged")
  }, 60_000)

  it("o defeito que SÓ o commit carrega (índice quebrado, árvore consertada) bloqueia", () => {
    // É o caso que a árvore esconde: alguém conserta o arquivo e esquece de
    // re-adicionar. O commit leva o corpo quebrado; a árvore parece saudável.
    const dir = novoRepo()
    stage(dir, WORKFLOW, WORKFLOW_QUEBRADO)
    touch(dir, WORKFLOW, WORKFLOW_VALIDO)

    const res = runHook(dir)

    expect(res.status).toBe(EXIT.VIOLATIONS)
    expect(res.output).toContain(`${WORKFLOW}:7`)
  }, 60_000)

  it("o corpo quebrado que o commit NÃO carrega (só na árvore) passa — o recorte é o índice", () => {
    const dir = novoRepo()
    stage(dir, WORKFLOW, WORKFLOW_VALIDO)
    touch(dir, WORKFLOW, WORKFLOW_QUEBRADO)

    const res = runHook(dir)

    expect(res.status).toBe(EXIT.OK)
    expect(res.output).toContain(COMPLETOU)
  }, 60_000)

  it("a outra metade do guard também morde no hook: arquivo de shell quebrado no índice", () => {
    const dir = novoRepo()
    stage(dir, SHELL_SCRIPT, SHELL_QUEBRADO)

    const res = runHook(dir)

    expect(res.status).toBe(EXIT.VIOLATIONS)
    expect(res.output).not.toContain(COMPLETOU)
    expect(res.output).toContain(SHELL_SCRIPT)
    expect(res.output).toContain("arquivo(s) de shell")
  }, 60_000)
})

// ── o remédio dentro do hook ─────────────────────────────────────────────
//
// O hook não só reprova: quando a cicatriz é a MECÂNICA que o fixer do gate
// conhece, ele OFERECE o remendo. Aqui o stdin do hook é um PIPE (é o que o
// harness dá), então o remédio toma o caminho SEM TERMINAL — que é o que precisa
// ser provado neste nível: ele NÃO pergunta, NÃO trava e NÃO libera o commit.

describe("o hook oferece o remédio, e sem terminal o commit segue bloqueado", () => {
  it("o remédio que sai 0 LEVANTA a falha: o commit segue (a outra direção do veredito)", () => {
    // A direção que o harness NÃO alcança sozinho (stdin é pipe, então o remédio
    // real nunca sai 0): aqui o desfecho do remédio é AFIRMADO por dublê. O que
    // se mede é o fluxo do HOOK — quem levanta a falha do gate é o exit 0 dele, e
    // sem esta direção um `REMEDIO=1` que nunca virasse 0 passaria despercebido
    // (o commit continuaria bloqueado e os testes do outro lado ficariam verdes).
    const dir = novoRepo()
    stage(dir, WORKFLOW, WORKFLOW_CICATRIZ)

    const res = runHook(dir, HOOK_SOURCE, { REMEDY_STUB: "0" })

    expect(res.status).toBe(EXIT.OK)
    expect(res.output).toContain(COMPLETOU)
    expect(res.output).not.toContain("SEM TERMINAL")
  }, 60_000)

  it("cicatriz mecânica no índice, SEM terminal: exit 1, sem pergunta, com o caminho à mão", () => {
    const dir = novoRepo()
    stage(dir, WORKFLOW, WORKFLOW_CICATRIZ)

    const res = runHook(dir)

    expect(res.status).toBe(EXIT.VIOLATIONS)
    expect(res.output).not.toContain(COMPLETOU)
    // O remédio RODOU (o preview da cicatriz está no relatório) e NÃO perguntou.
    expect(res.output).toContain("operador pendente")
    expect(res.output).toContain("SEM TERMINAL")
    expect(res.output).toContain("git add")
    // E o arquivo do fixture continua com a cicatriz: nada foi remendado.
    expect(readFileSync(join(dir, WORKFLOW), "utf8")).toBe(WORKFLOW_CICATRIZ)
  }, 60_000)
})

// ── mutação ──────────────────────────────────────────────────────────────

describe("mutação: o remédio só LEVANTA a falha — o bloqueio é do hook", () => {
  const REMEDY_LINHA = REMEDY_COMMAND
  const BLOCO_DO_GATE = HOOK_SOURCE.slice(
    HOOK_SOURCE.indexOf(`if [ "$SINTAXE" -ne 0 ]; then`),
    HOOK_SOURCE.indexOf(`[ "$FASE_A" -eq 0 ] || exit "$FASE_A"`),
  )

  it("M3 — o hook deixa de CHAMAR o remédio: o commit continua BLOQUEADO (fail-closed)", () => {
    // `REMEDIO` nasce 1 ("não provou nada"): sem a chamada, ninguém levantou a
    // falha do gate e o veredito explícito bloqueia. O remédio é CONVENIÊNCIA,
    // não o único caminho para o bloqueio — apagá-lo não cria um bypass.
    const mutado = HOOK_SOURCE.replace(REMEDY_LINHA, "")
    expect(mutado).not.toBe(HOOK_SOURCE) // a mutação precisa aplicar de fato
    // ...e deixar um shell VÁLIDO: uma mutação que quebrasse a sintaxe do hook
    // sairia vermelha por erro de PARSING, não pelo veredito que ela mede.
    expect(shellParses(mutado)).toBe(true)

    const dir = novoRepo()
    stage(dir, WORKFLOW, WORKFLOW_CICATRIZ)

    const res = runHook(dir, mutado)

    expect(res.status).toBe(EXIT.VIOLATIONS)
    expect(res.output).not.toContain(COMPLETOU)
    expect(res.output).not.toContain("SEM TERMINAL") // o remédio não rodou
  }, 60_000)

  it("M4 — o hook perde o VEREDITO do gate: o commit com a cicatriz mecânica passa", () => {
    // É a metade que importa: sem este bloco nada reergue a falha do guard, e o
    // commit entra com um corpo `run:` que não faz parsing.
    expect(BLOCO_DO_GATE).toContain(REMEDY_LINHA)
    const mutado = HOOK_SOURCE.replace(BLOCO_DO_GATE, "")
    expect(mutado).not.toBe(HOOK_SOURCE)
    expect(shellParses(mutado)).toBe(true)

    const dir = novoRepo()
    stage(dir, WORKFLOW, WORKFLOW_CICATRIZ)

    const res = runHook(dir, mutado)

    expect(res.status).toBe(EXIT.OK)
    expect(res.output).toContain(COMPLETOU)
  }, 60_000)
})

// ── mutação ──────────────────────────────────────────────────────────────

describe("mutação: as duas metades que a leitura do hook não vê", () => {
  it("M1 — o hook deixa de CHAMAR o guard: o commit com o corpo quebrado passa", () => {
    const mutado = HOOK_SOURCE.replace(GUARD_COMMAND, "true &")
    expect(mutado).not.toBe(HOOK_SOURCE) // a mutação precisa aplicar de fato

    const dir = novoRepo()
    stage(dir, WORKFLOW, WORKFLOW_QUEBRADO)

    const res = runHook(dir, mutado)

    expect(res.status).toBe(EXIT.OK)
    expect(res.output).toContain(COMPLETOU)
  }, 60_000)

  it("M2 — o recorte perde o `--staged`: o defeito que só o índice carrega passa", () => {
    const mutado = HOOK_SOURCE.replace(
      `node scripts/${GUARD} --staged &`,
      `node scripts/${GUARD} &`,
    )
    expect(mutado).not.toBe(HOOK_SOURCE)

    const dir = novoRepo()
    stage(dir, WORKFLOW, WORKFLOW_QUEBRADO)
    touch(dir, WORKFLOW, WORKFLOW_VALIDO)

    // Sem o recorte o guard julga a ÁRVORE (saudável) e aprova o commit que
    // carrega o corpo quebrado — a flag não é decoração.
    const res = runHook(dir, mutado)

    expect(res.status).toBe(EXIT.OK)
    expect(res.output).toContain(COMPLETOU)
  }, 60_000)
})
