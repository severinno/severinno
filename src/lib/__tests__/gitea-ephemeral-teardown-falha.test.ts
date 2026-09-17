/**
 * gitea-ephemeral-teardown-falha.test.ts
 *
 * Prova que o teardown dos suites efêmeros de Gitea é um FATO do veredito: um
 * container que não pôde ser removido REPROVA, em vez de deixar a suíte verde
 * com o lixo acumulando fora do log.
 *
 * O DEFEITO (medido, não hipotético): o teardown era `docker rm -f` + uma linha
 * de aviso no stderr. Quando o daemon recusava o kill — e neste host ele recusa
 * para QUALQUER container ("could not kill container: permission denied", até
 * num container recém-criado por ele mesmo) — o container ficava de pé e o
 * teste terminava VERDE. Resultado: 669 containers `gitea-ephemeral-*` Up de uma
 * vez (~33GB de RAM, swap esgotado) e o vermelho aparecendo LONGE da causa, como
 * um worker do vitest saindo inesperadamente, sem nenhum teste reprovado.
 *
 * AS QUATRO METADES, todas por execução do caminho real do helper:
 *
 *   1. os TRÊS desfechos do teardown, com um docker dublê que roteiriza o que o
 *      host real faz: `rm -f` negado + container que PARA por dentro ⇒ SUCESSO;
 *      container que não para ⇒ falha com o MOTIVO do daemon; e a falha que
 *      LANÇA (`removerOuFalhar`) em vez de só escrever no log;
 *   2. o CONTROLE do caminho por dentro: quando o `rm -f` funciona, a remoção
 *      sai pelo caminho normal e nada é reportado — a falha não é genérica;
 *   3. o CÓDIGO DE SAÍDA: um PROCESSO que termina com teardown falho não pode
 *      sair 0 (filho real, `helpers/gitea-ephemeral-teardown-child.ts`);
 *   4. a MUTAÇÃO: silenciar o veredito de remoção numa CÓPIA do helper faz a
 *      metade (3) perder o efeito (o processo volta a sair 0) — é isso que
 *      mostra que ela mede o veredito, e não outra coisa qualquer.
 *
 * E a premissa do host é MEDIDA, não presumida: o teste do docker REAL separa
 * "o daemon nega o kill aqui" de "o daemon coopera", e exige o caminho por
 * dentro exatamente onde ele é necessário.
 *
 * REQUER: docker para o último bloco (pulado sem docker, no mesmo padrão dos
 * outros testes de integração Gitea) e o `tsx` do repositório para o filho.
 *
 * Usage:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/gitea-ephemeral-teardown-falha.test.ts
 */

import { spawnSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import { afterAll, describe, expect, it } from "vitest"

import {
  EXIT_TEARDOWN_FALHOU,
  isDockerAvailable,
  removerContainer,
  removerOuFalhar,
  teardownFalhou,
  type DockerRunner,
} from "./helpers/gitea-ephemeral"

const ROOT = process.cwd()
const FILHO = resolve(
  ROOT,
  "src",
  "lib",
  "__tests__",
  "helpers",
  "gitea-ephemeral-teardown-child.ts",
)
/** O helper sob teste — o REAL, e (na mutação) uma cópia com o veredito calado. */
const HELPER = resolve(ROOT, "src", "lib", "__tests__", "helpers", "gitea-ephemeral.ts")
const IMAGEM = "gitea/gitea:1.22"
const CARREGADOR_TS = "tsx"

/** O erro LITERAL que este host devolve para qualquer `docker rm -f` — medido. */
const MOTIVO_DO_DAEMON =
  'Error response from daemon: cannot remove container "x": could not kill container: permission denied'

const dirs: string[] = []

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

// ── o docker dublê: o host real, roteirizado ─────────────────────────────

interface DockerFalso {
  run: DockerRunner
  chamadas: string[]
  /** O container ainda existe para o daemon? */
  existe: () => boolean
}

/**
 * Um daemon que NÃO consegue matar (`rm -f` sempre falha, como neste host) e um
 * container que só sai se o SIGTERM do PID 1 (enviado por DENTRO, via `exec`)
 * for obedecido — que é o que o `s6-svscan` da imagem do gitea faz.
 *
 * `obedeceAoSigterm: false` é o outro container: aquele que não sai nem por
 * dentro, e que portanto é FALHA de teardown.
 */
function dockerFalso(opts: { obedeceAoSigterm: boolean }): DockerFalso {
  const chamadas: string[] = []
  let existe = true
  let rodando = true

  const run: DockerRunner = (args) => {
    chamadas.push(args.join(" "))
    const cmd = args[0]
    if (cmd === "inspect") {
      if (!existe) return { status: 1, stdout: "", stderr: `No such container: ${args[1]}` }
      // `-f {{.State.Running}}` responde pelo ESTADO (é assim que o teardown
      // decide se já pode remover sem forçar).
      return { status: 0, stdout: args.includes("-f") ? `${rodando}\n` : "[]\n", stderr: "" }
    }
    if (cmd === "rm") {
      if (!existe) return { status: 1, stdout: "", stderr: `No such container: ${args[1]}` }
      // `rm -f` passa pelo KILL do daemon (o que este host nega); o `rm` sem
      // `-f` só remove container PARADO — a razão de o caminho por dentro existir.
      if (args.includes("-f")) {
        return { status: 1, stdout: "", stderr: MOTIVO_DO_DAEMON }
      }
      if (rodando) {
        return { status: 1, stdout: "", stderr: "cannot remove a running container" }
      }
      existe = false
      return { status: 0, stdout: `${args[1]}\n`, stderr: "" }
    }
    if (cmd === "exec" && opts.obedeceAoSigterm) rodando = false
    return { status: 0, stdout: "", stderr: "" }
  }

  return { run, chamadas, existe: () => existe }
}

/** O fake do caminho normal: o `rm -f` do daemon funciona (host saudável). */
function dockerQueSolta(chamadas: string[] = []): DockerRunner {
  return (args) => {
    chamadas.push(args.join(" "))
    if (args[0] === "rm") return { status: 0, stdout: `${args[args.length - 1]}\n`, stderr: "" }
    if (args[0] === "inspect") return { status: 1, stdout: "", stderr: "No such container" }
    return { status: 0, stdout: "", stderr: "" }
  }
}

function nomeDeSonda(): string {
  return `gitea-ephemeral-sonda-${randomBytes(4).toString("hex")}`
}

// ── 1. os três desfechos do teardown ─────────────────────────────────────

describe("o teardown do container efêmero é veredito — nenhum desfecho em silêncio", () => {
  it("1) o daemon nega o kill, mas o container PARA por dentro ⇒ a remoção é SUCESSO", () => {
    const nome = nomeDeSonda()
    const fake = dockerFalso({ obedeceAoSigterm: true })

    const remocao = removerContainer(nome, { docker: fake.run })

    expect(remocao.ok, `não removeu: ${remocao.motivo}`).toBe(true)
    expect(remocao.motivo).toBe("")
    expect(fake.existe(), "o container ficou de pé").toBe(false)
    // A ORDEM é o que prova o caminho: `rm -f` (negado) → parada por DENTRO →
    // `rm` sem `-f` (o container já parou, então o daemon não precisa matar).
    expect(fake.chamadas[0]).toBe(`rm -f ${nome}`)
    expect(fake.chamadas).toContain(`exec ${nome} sh -c kill -TERM 1`)
    expect(fake.chamadas.at(-1)).toBe(`rm ${nome}`)
    expect(fake.chamadas.indexOf(`exec ${nome} sh -c kill -TERM 1`)).toBeLessThan(
      fake.chamadas.length - 1,
    )
  })

  it("2) o container não sai nem por dentro ⇒ FALHA com o motivo do daemon, e o alvo segue vivo", () => {
    const nome = nomeDeSonda()
    const fake = dockerFalso({ obedeceAoSigterm: false })

    const remocao = removerContainer(nome, { docker: fake.run, esperaMs: 0, esperaFinalMs: 0 })

    expect(remocao.ok).toBe(false)
    // O motivo é o do DAEMON (literal), não um genérico do helper: é ele que diz
    // a quem lê POR QUE o container não saiu.
    expect(remocao.motivo).toContain("could not kill container: permission denied")
    expect(fake.existe()).toBe(true)
    // A tentativa foi COMPLETA (os dois caminhos foram exercitados) — um
    // veredito de falha sobre um caminho pulado provaria nada.
    expect(fake.chamadas.some((c) => c.startsWith("rm -f "))).toBe(true)
    expect(fake.chamadas).toContain(`exec ${nome} sh -c kill -TERM 1`)
  })

  it("3) `removerOuFalhar` LANÇA nomeando container, motivo e receita — o teste não termina verde", () => {
    const nome = nomeDeSonda()
    const fake = dockerFalso({ obedeceAoSigterm: false })

    expect(() =>
      removerOuFalhar(nome, { docker: fake.run, esperaMs: 0, esperaFinalMs: 0 }),
    ).toThrow(/FALHA ao remover/)
    let mensagem = ""
    try {
      removerOuFalhar(nome, { docker: fake.run, esperaMs: 0, esperaFinalMs: 0 })
    } catch (err) {
      mensagem = err instanceof Error ? err.message : String(err)
    }
    expect(mensagem).toContain(nome)
    expect(mensagem).toContain("could not kill container: permission denied")
    // A RECEITA está no relatório: o caminho que funciona aqui (`kill -TERM 1`
    // por dentro) não é óbvio para quem só vê o container de pé.
    expect(mensagem).toContain(`docker exec ${nome} kill -TERM 1`)
  })

  it("3b) a mesma falha é reportada UMA vez, mesmo com o sweep passando por ela de novo", () => {
    const nome = nomeDeSonda()
    const fake = dockerFalso({ obedeceAoSigterm: false })

    for (let i = 0; i < 2; i++) {
      try {
        removerOuFalhar(nome, { docker: fake.run, esperaMs: 0, esperaFinalMs: 0 })
      } catch {
        // esperado: a segunda passada é o cenário (sweep + cleanup juntos)
      }
    }
    expect(teardownFalhou().filter((f) => f.container === nome)).toHaveLength(1)
  })

  it("CONTROLE: quando a remoção funciona, `removerOuFalhar` NÃO lança e nada é registrado", () => {
    const nome = nomeDeSonda()
    const chamadas: string[] = []

    expect(() => removerOuFalhar(nome, { docker: dockerQueSolta(chamadas) })).not.toThrow()

    expect(chamadas[0]).toBe(`rm -f ${nome}`)
    // Um caminho só: com o `rm -f` funcionando, o teardown não inventa uma
    // segunda remoção nem passa pelo `exec`.
    expect(chamadas).toHaveLength(1)
    expect(teardownFalhou().map((f) => f.container)).not.toContain(nome)
  })
})

// ── 2. o código de saída: a falha não fica verde ─────────────────────────

interface SaidaDoFilho {
  code: number | null
  reprovou: boolean
  mensagem: string
  chamadas: string[]
  stderr: string
}

/**
 * Roda o filho contra um caminho de helper (o real, ou a cópia mutada).
 *
 * Sem `timeout` generoso: o filho não espera nada (o roteiro dele é imortal por
 * construção), então um travamento aqui é defeito, e o timeout do vitest o pega.
 */
function rodarFilho(helperPath: string): SaidaDoFilho {
  const res = spawnSync(process.execPath, ["--import", CARREGADOR_TS, FILHO], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 60_000,
    env: { ...process.env, GITEA_HELPER_UNDER_TEST: helperPath },
  })
  const stdout = res.stdout ?? ""
  const linha = stdout
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("{"))
    .pop()
  const json = linha
    ? (JSON.parse(linha) as { reprovou?: boolean; mensagem?: string; chamadas?: string[] })
    : {}
  return {
    code: res.status,
    reprovou: json.reprovou === true,
    mensagem: json.mensagem ?? "",
    chamadas: json.chamadas ?? [],
    // Sem misturar com a stdout: o relatório do teardown é do canal dele
    // (`process.stderr.write`), e ler o JSON como "relatório" esconderia uma
    // falha que não foi escrita em lugar nenhum.
    stderr: res.stderr ?? "",
  }
}

describe("a falha de teardown sai como CÓDIGO DE SAÍDA — o processo não fica verde", () => {
  it("helper REAL com container imortal: o processo termina não-zero e nomeia o container", () => {
    const saida = rodarFilho(HELPER)

    // 3 é o código de falha do HARNESS (helper que não carrega): separar isso de
    // um veredito é o que impede o teste de passar medindo outra coisa.
    expect(saida.code, "o filho morreu por infra, não pelo teardown").not.toBe(3)
    expect(saida.reprovou).toBe(true)
    expect(saida.code).toBe(EXIT_TEARDOWN_FALHOU)
    expect(saida.stderr).toContain("FALHA ao remover")
    expect(saida.stderr).toContain("docker exec")
    // A tentativa completa do roteiro: o vermelho não veio de um caminho pulado.
    expect(saida.chamadas).toContain("exec gitea-ephemeral-test-morto sh -c kill -TERM 1")
  })

  it("MUTAÇÃO: com o veredito silenciado o processo sai 0 — a prova acima é load-bearing", () => {
    const dir = mkdtempSync(join(tmpdir(), "gitea-teardown-mut-"))
    dirs.push(dir)
    const mutado = join(dir, "gitea-ephemeral-MUTADO.ts")

    // A mutação é CIRÚRGICA: o retorno de falha da remoção vira "sucesso". O
    // alvo é asserido antes de aplicar — uma refatoração que mude a linha faria
    // o teste rodar o helper ORIGINAL e passar em silêncio (o falso positivo
    // clássico de toda prova por mutação).
    const original = readFileSync(HELPER, "utf8")
    const alvo = "  return {\n    ok: false,\n    motivo: motivoDoDaemon(segundo, primeiro),"
    const mutada =
      '  return {\n    ok: true,\n    motivo: "", // MUTACAO: veredito de remocao silenciado'
    expect(original, "o alvo da mutação não existe mais no helper").toContain(alvo)
    writeFileSync(mutado, original.replace(alvo, mutada), "utf8")

    const saida = rodarFilho(mutado)

    // O fato que a prova do `it` acima mede DEIXA de existir: sem veredito, o
    // processo volta a sair verde com o container vivo — exatamente o defeito
    // original (suíte verde, lixo acumulando). É por isso que a prova morde.
    expect(saida.reprovou).toBe(false)
    expect(saida.code).toBe(0)
    // E o caminho foi o MESMO: o que mudou foi só o veredito, não a tentativa.
    expect(saida.chamadas).toContain("exec gitea-ephemeral-test-morto sh -c kill -TERM 1")
  })
})

// ── 3. no docker REAL: a premissa do host é medida ───────────────────────

const dockerDisponivel = isDockerAvailable()
const imagemDisponivel = (): boolean =>
  dockerDisponivel &&
  spawnSync("docker", ["image", "inspect", IMAGEM], { encoding: "utf8" }).status === 0
const describeReal = dockerDisponivel ? describe : describe.skip

describeReal("no docker REAL deste host", () => {
  it("um container de verdade é removido mesmo quando o daemon nega o `rm -f`", () => {
    expect(imagemDisponivel(), `imagem ${IMAGEM} ausente: rode docker pull ${IMAGEM}`).toBe(true)
    const nome = nomeDeSonda()
    const subiu = spawnSync("docker", ["run", "-d", "--name", nome, IMAGEM], { encoding: "utf8" })
    expect(subiu.status, `docker run falhou: ${subiu.stderr}`).toBe(0)

    const remocao = removerContainer(nome)

    expect(remocao.ok, `não removeu: ${remocao.motivo}`).toBe(true)
    expect(spawnSync("docker", ["inspect", nome], { encoding: "utf8" }).status).not.toBe(0)
    // A premissa do host vem do PRÓPRIO veredito, sem sonda extra (uma sonda
    // custaria mais um `rm -f` negado = +10s de timeout do daemon): o caminho
    // "parada-por-dentro" só existe DEPOIS de o `rm -f` falhar com o container
    // ainda vivo — então, onde ele aparece, o sucesso só é explicável por ele.
    if (remocao.caminho === "parada-por-dentro") return
    expect(remocao.caminho).toBe("rm")
    console.warn(
      "⚠️  este host permite `docker rm -f`: o caminho por dentro não foi exercitado " +
        "aqui (a prova por roteiro cobre os dois desfechos).",
    )
  }, 60_000)
})
