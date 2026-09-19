// =============================================================================
// gitea-bring-up-recursion.test.ts
//
// O CORTE DO CICLO QUANDO A DUBLAGEM FALTA — medido na cadeia REAL, com o doctor
// de VERDADE e SEM dublê nenhum.
//
// POR QUE ESTE TESTE EXISTE (e por que o irmão dele não basta): o
// `prove-runner-image-gate.test.ts` prova a cadeia `bring-up → doctor → prova →
// bring-up` FINITA **com a dublagem no lugar** — o doctor real é invocado uma vez
// e todas as descidas vão para o dublê da prova. Isso mede o CORTE PRIMÁRIO. O
// que ficava sem prova de execução é o outro caso, que é o que dá nome à defesa
// em profundidade: **a dublagem falhou/foi removida** e o doctor de verdade está
// do outro lado. Sem o guard, essa é a receita da exaustão de processos
// (`bring-up → doctor → prova → bring-up → …`); com ele, o doctor RECUSA antes
// de coletar e EMITE o relatório da recursão — o mesmo canal do veredito.
//
// O QUE ESTE TESTE EXECUTA: o `deploy/gitea-up.sh` REAL, em sandbox, com o
// `docker` dublado (nada toca o daemon), um registry de teste HTTP no
// `127.0.0.1` e o doctor **COMITADO** — sem `DOCTOR_SCRIPT`, que é literalmente
// a variável cuja ausência define "sem dublê". A marca que a prova grava
// (`FORGE_DOCTOR_NESTED`) está no ambiente, como está no env que a prova passa
// ao bring-up: é ela que diz ao doctor que ele está DENTRO da própria prova.
//
// O QUE ELE AFIRMA, e cada afirmação responde a uma pergunta diferente:
//   1. a cadeia TERMINA com um código real (não foi morta pelo watchdog) — a
//      resposta a "em vez de exaustão de processos";
//   2. o RELATÓRIO DE RECURSÃO está no **stdout** — não só no stderr, e não só
//      como exit code: o `exit 3` é o MESMO código de uso inválido;
//   3. o corte foi ANTES de coletar: nenhuma seção do veredito saiu (é o que
//      separa "recusou" de "mediu e não gostou");
//   4. o corte foi no PRIMEIRO nível: o bring-up não desceu uma segunda vez
//      (um segundo nível repetiria as linhas — é a contagem que prova o corte,
//      e não a impressão de que "terminou");
//   5. a stack NÃO se moveu (nenhum `up` no docker dublado);
//   6. nenhum sintoma de exaustão (`EAGAIN`, `ENOMEM`, `Maximum call stack`,
//      `fork: retry`, `Cannot fork`…) no output combinado.
//
// E o CONTROLE, que é o que impede a leitura vácua: com o guard DESLIGADO na
// cópia do doctor, a MESMA invocação marcada **não recusa** — ela segue para a
// coleta. Sem ele, "não recusou" e "recusou por outro motivo" seriam
// indistinguíveis, e o verde do teste principal poderia vir do ambiente errado.
//
// SEM docker e SEM rede externa: registry é `node:http` em `127.0.0.1` e o
// `docker` é dublê no PATH. O `bash` é o real — é a cadeia de verdade.
//
// Usage:
//   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/gitea-bring-up-recursion.test.ts
// =============================================================================

import { spawn } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, join } from "node:path"

import { afterAll, describe, expect, it } from "vitest"

import {
  BRING_UP,
  RUNBOOK,
  SETUP_SCRIPT,
  makeFakeBin,
  startTestRegistry,
  writeProofEnv,
} from "../../../scripts/prove-runner-image-gate.mjs"
import {
  NESTED_GUARD_ENV,
  NESTED_GUARD_EXIT,
  NESTED_GUARD_FLAG,
} from "../../../scripts/forge-doctor.mjs"

const ROOT = process.cwd()
const tmpDirs: string[] = []

function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "bring-up-recursion-"))
  tmpDirs.push(dir)
  return dir
}

afterAll(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/**
 * A raiz sintética com o que o bring-up resolve: ele mesmo, o compose e os
 * scripts que ele invoca (INCLUSIVE o doctor COMITADO — é ele que roda aqui,
 * porque este teste não passa `DOCTOR_SCRIPT`).
 *
 * Copiar o diretório `scripts/` INTEIRO (e não só o doctor) é o mesmo cuidado do
 * teste irmão: os passos 0 e 1 invocam `check-env-mirror.mjs` e
 * `ensure-runner-image.mjs`, que importam outros guards — um subconjunto faria a
 * cadeia parar antes do doctor, e o teste passaria a medir o motivo errado.
 */
function makeSandbox(): string {
  const dir = makeDir()
  mkdirSync(join(dir, "deploy"), { recursive: true })
  cpSync(
    join(ROOT, "deploy", "docker-compose.gitea.yml"),
    join(dir, "deploy", "docker-compose.gitea.yml"),
  )
  cpSync(join(ROOT, "scripts"), join(dir, "scripts"), { recursive: true })
  for (const rel of [BRING_UP, SETUP_SCRIPT, RUNBOOK]) {
    cpSync(join(ROOT, rel), join(dir, rel))
  }
  return dir
}

/** Quantas vezes `needle` aparece — a contagem é o que mede o corte. */
function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

/** O que uma execução deixa: o código (null = morta pelo watchdog) e o output. */
interface RunResult {
  code: number | null
  out: string
}

/**
 * Executa um comando e junta stdout+stderr — o mesmo canal que o runner tem.
 *
 * O watchdog (`SIGKILL`) é a REDE, e não uma asserção de relógio: se a cadeia
 * não terminasse, `code` viria `null` e as asserções caem — sem transformar o
 * teste numa medida de tempo (um limiar de segundos numa suíte é flake; o guard
 * de bomba-relógio do repositório, com razão, proíbe relógio em asserção).
 */
function run(
  cmd: string,
  args: string[],
  opts: { cwd: string; env: NodeJS.ProcessEnv },
): Promise<RunResult> {
  return new Promise((done) => {
    let out = ""
    const child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env })
    child.stdout?.on("data", (c) => (out += c))
    child.stderr?.on("data", (c) => (out += c))
    const killer = setTimeout(() => child.kill("SIGKILL"), 120_000)
    child.on("close", (code) => {
      clearTimeout(killer)
      done({ code, out })
    })
    child.on("error", (err) => {
      clearTimeout(killer)
      done({ code: null, out: `${out}\n${err.message}` })
    })
  })
}

/**
 * Os sintomas de que a proteção falhou — a lista é o CONTRATO de "isto não
 * pode aparecer": cada padrão é o que a máquina imprime quando o ciclo cresce
 * (fork falhando, memória acabando, pilha estourando).
 */
const EXHAUSTION =
  /EAGAIN|ENOMEM|Resource temporarily unavailable|Cannot allocate memory|Maximum call stack|fork: retry|EMFILE|Cannot fork|pthread_create|No space left on device/i

describe("o bring-up REAL, com o doctor de VERDADE e SEM dublê, é cortado pelo guard", () => {
  it("a cadeia termina com o relatório de recursão no STDOUT, e não por exaustão de processos", async () => {
    const dir = makeSandbox()
    const reg = await startTestRegistry("exists")
    try {
      // O dublê do `docker` (nada toca o daemon) e o par env-do-host + template
      // GÊMEO em sincronia: é o cenário do caso "presente" da prova, que é o
      // ÚNICO em que a cadeia chega ao doctor com tudo em ordem. Sem isso o
      // teste mediria uma parada no passo 0/1, não o corte do ciclo.
      const fake = makeFakeBin(makeDir(), { volume: "removable" })
      const { envFile, templateFile } = writeProofEnv(dir, reg.url, "sync")

      const { code, out } = await run(
        "bash",
        [join(dir, BRING_UP), "--env-file", envFile, "--check-only"],
        {
          cwd: dir,
          env: {
            ...process.env,
            PATH: `${fake.binDir}${delimiter}${process.env.PATH ?? ""}`,
            TEMPLATE_FILE: templateFile,
            // A MARCA que a prova grava no env do bring-up que ela executa —
            // este teste entra na cadeia exatamente nesse ponto.
            [NESTED_GUARD_ENV]: "1",
            // E `DOCTOR_SCRIPT` AUSENTE de propósito: sem dublê nenhum, o
            // bring-up invoca o doctor COMITADO que acabou de ser copiado.
            // É a metade que define o cenário: a dublagem não chegou.
            HEALTH_TIMEOUT: "1",
          },
        },
      )

      // 1. A CADEIA TERMINOU — e com a recusa do bring-up (o doctor saiu 3, que
      //    não é veredito: sem veredito não há prontidão, e nada é subido).
      //    `code === null` significaria o watchdog: a exaustão que se quer evitar.
      expect(code, out).toBe(1)

      // 2. O RELATÓRIO DE RECURSÃO saiu no STDOUT (o canal do veredito), com o
      //    CANAL que marcou a invocação aninhada nomeado.
      expect(out).toContain("RECURSÃO DETECTADA (nenhuma seção coletada)")
      expect(out).toContain(`marcado por: ${NESTED_GUARD_ENV} (canal env)`)
      // O CANAL é o que marcou — e o relatório não acrescenta o outro: o argv
      // não tinha a flag, e o relatório dizer que tinha seria inventar canal
      // (o `--proof-nested` aparece no stderr como ALTERNATIVA, não como marca).
      expect(out).not.toContain(`marcado por: ${NESTED_GUARD_FLAG}`)
      expect(out).toContain("RECURSAO")
      expect(out).toContain(`(exit ${NESTED_GUARD_EXIT})`)

      // 3. O CORTE FOI ANTES DE COLETAR: nenhuma seção do veredito saiu. É a
      //    diferença entre "recusou" e "mediu e não gostou" — e a razão de o
      //    guard existir (o ciclo é cortado ANTES de avançar um passo).
      expect(out).not.toContain("1/7")
      expect(out).not.toContain("4/7")
      expect(out).not.toContain("Prova do bloqueio")

      // 4. O CORTE FOI NO PRIMEIRO NÍVEL: o bring-up não desceu uma segunda vez.
      //    Um segundo nível imprimiria as DUAS linhas de novo — é a contagem,
      //    e não a impressão de que "terminou", que prova o corte.
      expect(occurrences(out, "checando a prontidão da forja")).toBe(1)
      expect(occurrences(out, "RECURSÃO DETECTADA")).toBe(1)

      // 5. A STACK NÃO SE MOVEU: nenhum `up` chegou ao docker dublado.
      const calls = fake.dockerCalls()
      expect(calls.filter((c) => /(^|\s)up(\s|-d)/.test(c))).toEqual([])
      expect(out).toContain("NADA foi subido")

      // 6. NENHUM SINTOMA DE EXAUSTÃO: o desfecho é a recusa NOMEADA, não a
      //    máquina sem recursos.
      expect(out).not.toMatch(EXHAUSTION)
    } finally {
      await reg.close()
    }
  }, 130_000)

  it("CONTROLE: com o guard DESLIGADO, a MESMA invocação marcada não recusa — ela COLETA", async () => {
    // O controle isola a CAUSA. Ele muta o guard na cópia do doctor e mantém
    // tudo o mais idêntico (a marca no ambiente, o env do host, o registry): se
    // o doctor deixasse de recusar por qualquer outro motivo — ambiente, flag,
    // arquivo — o teste principal estaria medindo outra coisa.
    //
    // A PROVA também é dublada AQUI, e isso é deliberado: o que este controle
    // mede é o GUARD, não o custo de 16 casos da prova (que o doctor levaria
    // minutos para rodar). A dublagem é declarada no lugar da pergunta, e não
    // escondida no meio dela.
    const dir = makeSandbox()
    const doctorPath = join(dir, "scripts", "forge-doctor.mjs")
    const source = readFileSync(doctorPath, "utf8")
    // O texto da REGRA, como ela está no fonte (as constantes, não os valores:
    // é a linha do `isNestedDoctorInvocation` que está sendo mutada).
    const guard = "return Boolean(env[NESTED_GUARD_ENV]) || argv.includes(NESTED_GUARD_FLAG)"
    expect(source, "a regra do guard mudou de forma — atualize a mutação").toContain(guard)
    const proof = "const { prove = proveRunnerImageGate, ...rest } = deps"
    expect(source, "o ponto de injeção da prova mudou de forma — atualize a mutação").toContain(
      proof,
    )
    writeFileSync(
      doctorPath,
      source
        .replace(guard, "return false // CONTROLE: o guard desligado")
        .replace(
          proof,
          'const { prove = async () => ({ status: "holds", ok: true, cases: [] }), ...rest } = deps',
        ),
    )

    const reg = await startTestRegistry("exists")
    try {
      const { envFile } = writeProofEnv(dir, reg.url, "sync")
      const { code, out } = await run(
        process.execPath,
        [
          doctorPath,
          "--gitea-env",
          envFile,
          "--no-guards",
          "--no-protection",
          "--no-runner-labels",
          "--no-image-contract",
          "--no-compose-render",
          "--no-registry-probe",
          "--no-open-debt",
        ],
        {
          cwd: dir,
          env: { ...process.env, [NESTED_GUARD_ENV]: "1" },
        },
      )

      // NÃO recusou: nenhum relatório de recursão, e a coleta começou (o
      // cabeçalho NORMAL do veredito + a primeira seção). O veredito em si não
      // importa aqui — e ele vai ser BLOQUEADA/INDETERMINADA mesmo, porque a
      // raiz sintética não tem o manifesto: o que se mede é a RECUSA que NÃO
      // aconteceu.
      expect(out).not.toContain("RECURSÃO DETECTADA")
      expect(out).toContain("prontidão para bloquear o merge")
      expect(out).toContain("1/7")
      // A recusa do guard é exit 3; o veredito é 0/1/2.
      expect(code).not.toBe(NESTED_GUARD_EXIT)
    } finally {
      await reg.close()
    }
  }, 130_000)
})
