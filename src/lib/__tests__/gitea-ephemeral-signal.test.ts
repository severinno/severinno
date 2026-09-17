/**
 * gitea-ephemeral-signal.test.ts
 *
 * Prova que o SWEEP do helper efêmero (`helpers/gitea-ephemeral.ts`) sobrevive a
 * um sinal — matando, de verdade, o processo que está rodando um Gitea efêmero.
 *
 * POR QUE ESTE TESTE EXISTE: o `cleanup()` que o helper devolve ao teste é o
 * caminho NORMAL, e ele não roda quando o processo é ABORTADO (SIGTERM do runner
 * por timeout, Ctrl-C, crash do worker). Foi assim que os containers vazaram: o
 * registro `liveContainers` + os handlers de SIGINT/SIGTERM são o `trap EXIT` do
 * helper, e até agora só existia a promessa — nenhum teste matava um processo
 * para ver o sweep acontecer.
 *
 * COMO PROVA (e por que não é um teste de mentira):
 *   1. o FILHO (`helpers/gitea-ephemeral-signal-child.ts`) sobe o Gitea pelo
 *      caminho REAL do helper e fica vivo; quem mata é este teste, com um sinal
 *      de verdade (o kernel entrega, o handler roda);
 *   2. o sinal é seguido de `expect(signalCode).toBeNull()` +
 *      `expect(code).toBe(130)`: um SIGTERM SEM handler encerra com
 *      `signal="SIGTERM"` e `code=null`, então o 130 é a prova de que o HANDLER
 *      do helper executou — não de que o processo morreu;
 *   3. o filho também sobe um container de CONTROLE pelo `docker run` cru — o
 *      mesmo container, com a mesma imagem, SEM estar no registro do sweep. Ele
 *      recebe o MESMO sinal no MESMO processo. Sem esse controle, "o container
 *      desapareceu" admitiria qualquer explicação (docker caiu, outra suíte
 *      removeu); com ele, a única diferença entre os dois é o registro.
 *   4. DUAS testemunhas para o mesmo fato, porque o AMBIENTE nem sempre permite
 *      a primeira: onde o container PODE ser removido, a testemunha é o
 *      RESULTADO (o do helper some, o controle fica); onde nem o caminho por
 *      dentro do teardown consegue tirá-lo (sandbox com docker restrito), é o
 *      RELATÓRIO do sweep — e aí o teste exige que a falha tenha sido REPORTADA
 *      e que o código de saída o denuncie (131), para um container que fica
 *      vivo nunca passar em silêncio. A sonda de remoção usa a MESMA porta do
 *      teardown de produção (`removerContainer`), com o caminho por dentro
 *      junto: medir a capacidade do host com um `rm -f` cru acusaria de
 *      "indeterminado" um host em que o helper limpa tudo.
 *   5. as duas JANELAS em que o vazamento acontecia: durante o SETUP (o
 *      `cleanup()` ainda nem voltou para o teste) e durante a CORRIDA (servidor
 *      no ar, teste de integração rodando).
 *
 * REQUER: docker + a imagem gitea/gitea:1.22 (o arquivo é pulado sem docker, no
 * mesmo padrão dos outros testes de integração Gitea) e o `tsx` do repositório
 * para rodar o filho em TypeScript.
 */

import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import { randomBytes } from "node:crypto"
import { once } from "node:events"
import { resolve } from "node:path"
import { createInterface } from "node:readline"

import { afterEach, describe, expect, it } from "vitest"

import {
  EXIT_SINAL_COM_TEARDOWN_FALHO,
  isDockerAvailable,
  removerContainer,
} from "./helpers/gitea-ephemeral"

const ROOT = process.cwd()
const FILHO = resolve(ROOT, "src", "lib", "__tests__", "helpers", "gitea-ephemeral-signal-child.ts")
/** O carregador de TypeScript do próprio repositório (devDependency `tsx`). */
const CARREGADOR_TS = "tsx"
const IMAGEM = "gitea/gitea:1.22"

/** O que o filho publica na stdout, uma linha JSON por fase. */
type Fase = { fase: "container" | "pronto"; helper: string; controle: string }

function dockerTem(nome: string): boolean {
  return spawnSync("docker", ["inspect", nome], { encoding: "utf8" }).status === 0
}

/**
 * O AMBIENTE consegue remover um container? Não é retórica: há sandboxes em que
 * o daemon nega o `kill` (docker restrito) e NENHUM container é removível, por
 * mais correto que o código esteja. Sem separar isso, o teste acusaria o helper
 * por uma limitação da plataforma.
 *
 * A pergunta é feita à PORTA DO TEARDOWN (`removerContainer`, com o caminho por
 * dentro junto), não a um `rm -f` cru: num host que nega o kill mas cujo
 * container para por dentro — este — o teardown de produção FUNCIONA, e medir
 * com o caminho cru daria "indeterminado" para uma capacidade que existe.
 */
function remocaoDisponivel(): boolean {
  const nome = `gitea-ephemeral-sonda-${randomBytes(4).toString("hex")}`
  const criado = spawnSync("docker", ["run", "-d", "--name", nome, IMAGEM], { encoding: "utf8" })
  if (criado.status !== 0) return false
  const remocao = removerContainer(nome)
  const sumiu = spawnSync("docker", ["inspect", nome], { encoding: "utf8" }).status !== 0
  return remocao.ok && sumiu
}

/** Espera o container sumir (folga contra corrida do daemon, não a prova em si). */
async function esperarSumir(nome: string, timeoutMs = 10_000): Promise<boolean> {
  const fim = Date.now() + timeoutMs
  while (Date.now() < fim) {
    if (!dockerTem(nome)) return true
    await new Promise((r) => setTimeout(r, 200))
  }
  return !dockerTem(nome)
}

interface FilhoEmPe {
  proc: ChildProcess
  esperarFase: (fase: Fase["fase"], timeoutMs?: number) => Promise<Fase>
  /** `[exitCode, signalCode]` — o par que separa "handler" de "sinal default". */
  saiu: Promise<[number | null, NodeJS.Signals | null]>
  stderr: () => string
}

function subirFilho(): FilhoEmPe {
  const proc = spawn(process.execPath, ["--import", CARREGADOR_TS, FILHO], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  })
  let stderr = ""
  proc.stderr?.on("data", (d) => {
    stderr += String(d)
  })

  const vistos = new Map<string, Fase>()
  const rl = createInterface({ input: proc.stdout! })
  rl.on("line", (linha) => {
    try {
      const fase = JSON.parse(linha) as Fase
      if (fase?.fase) vistos.set(fase.fase, fase)
    } catch {
      // linha que não é o JSON de fase (log do helper, aviso do docker)
    }
  })

  // `close` (não `exit`): garante que stdout/stderr foram DRENADOS antes de o
  // teste ler o relatório do sweep.
  const saiu = once(proc, "close") as Promise<[number | null, NodeJS.Signals | null]>
  void saiu.then(() => rl.close())

  const esperarFase = async (fase: Fase["fase"], timeoutMs = 120_000): Promise<Fase> => {
    const fim = Date.now() + timeoutMs
    while (Date.now() < fim) {
      const visto = vistos.get(fase)
      if (visto) return visto
      if (proc.exitCode !== null || proc.signalCode !== null) {
        throw new Error(
          `o filho terminou (code=${proc.exitCode}, signal=${proc.signalCode}) antes da fase "${fase}". stderr: ${stderr}`,
        )
      }
      await new Promise((r) => setTimeout(r, 100))
    }
    throw new Error(`a fase "${fase}" não chegou em ${timeoutMs}ms. stderr: ${stderr}`)
  }

  return { proc, esperarFase, saiu, stderr: () => stderr }
}

const dockerDisponivel = isDockerAvailable()
const remocaoOk = dockerDisponivel ? remocaoDisponivel() : false
const describeReal = dockerDisponivel ? describe : describe.skip

describeReal("gitea-ephemeral — o sweep sobrevive a um sinal no meio do teste", () => {
  const paraLimpar = new Set<string>()
  let filho: ChildProcess | null = null

  afterEach(() => {
    // Se o teste falhou antes do sinal, o filho (e o container dele) ainda estão
    // de pé: o teste que mede vazamento não pode vazar.
    if (filho && filho.exitCode === null && filho.signalCode === null) filho.kill("SIGKILL")
    filho = null
    if (remocaoOk) {
      // A mesma porta do teardown de produção: se ela falhar aqui, o relatório
      // nomeia o container e o `afterEach` de um teste que mede vazamento não
      // vaza em silêncio.
      for (const nome of paraLimpar) removerContainer(nome)
    } else if (paraLimpar.size > 0) {
      // Retentar uma remoção que o daemon já recusou custa 10s por container
      // (o timeout de stop do `docker rm -f`) e não muda o resultado. O que
      // NÃO pode acontecer é o container ficar de pé sem ninguém saber.
      console.warn(
        `⚠️  ${paraLimpar.size} container(s) de teste FICARAM de pé neste ambiente ` +
          `(sem remoção possível): ${[...paraLimpar].join(", ")}`,
      )
    }
    paraLimpar.clear()
  })

  /**
   * O fato sob teste, em duas testemunhas:
   *   - o sweep mirou EXATAMENTE o container registrado (nunca o controle);
   *   - e, onde o daemon permite remover, o resultado colhe o efeito.
   */
  async function provarSweep(alvo: {
    helper: string
    controle: string
    stderr: string
    exitCode: number | null
    signalCode: NodeJS.Signals | null
  }): Promise<void> {
    // ── 1. O HANDLER rodou (sem handler, um SIGTERM encerra por sinal) ──────
    expect(
      alvo.signalCode,
      "o processo morreu pelo sinal default: nenhum handler de sinal do helper rodou",
    ).toBeNull()
    // 130 = abortado com o teardown LIMPO; 131 = abortado E com teardown FALHO
    // (o helper soma 1 para o vermelho do teardown não se confundir com o do
    // sinal). Sem handler o processo encerraria por SINAL, com `code` nulo —
    // então os dois códigos provam que o handler rodou.
    expect(
      [130, EXIT_SINAL_COM_TEARDOWN_FALHO],
      `exit inesperado. stderr: ${alvo.stderr}`,
    ).toContain(alvo.exitCode)

    // ── 2. O ESCOPO: só o registro é alvo ──────────────────────────────────
    if (remocaoOk) {
      expect(await esperarSumir(alvo.helper), "o container do helper FICOU vivo").toBe(true)
      // O CONTROLE: mesmo container, mesma imagem, MESMO sinal, no MESMO
      // processo — e sobrevive, porque não está no registro. É esta diferença
      // que faz a asserção acima medir o sweep, e não o acaso.
      expect(
        dockerTem(alvo.controle),
        "o controle sumiu junto: a remoção NÃO foi do sweep (o sinal sozinho derrubou os containers)",
      ).toBe(true)
      return
    }

    // ── 2'. Sem remoção possível, a testemunha é o RELATÓRIO do sweep ──────
    // O ambiente recusa a remoção até pelo caminho por dentro, então "sumiu"
    // não é mensurável aqui. O que continua mensurável — e é o que o helper
    // controla — é que o sweep TENTOU remover o container registrado, e SÓ ele,
    // e que a falha foi REPORTADA (e denunciada no código de saída) em vez de
    // virar silêncio.
    console.warn(
      "⚠️  INDETERMINADO: este ambiente não consegue remover containers nem pelo caminho por dentro — " +
        "a metade de RESULTADO do teste não é mensurável aqui; a prova usada é o relatório do sweep.",
    )
    expect(alvo.exitCode, "o teardown falhou e o processo saiu como se tivesse limpado").toBe(
      EXIT_SINAL_COM_TEARDOWN_FALHO,
    )
    expect(alvo.stderr).toContain(`FALHA ao remover ${alvo.helper}`)
    expect(alvo.stderr, "o sweep tocou um container que NÃO está no registro dele").not.toContain(
      alvo.controle,
    )
  }

  it("SIGTERM com o servidor NO AR: o handler roda e o sweep mira só o container registrado", async () => {
    const pe = subirFilho()
    filho = pe.proc

    const cedo = await pe.esperarFase("container")
    paraLimpar.add(cedo.helper).add(cedo.controle)
    // Fase "pronto" = `makeEphemeralGitea` resolveu: o servidor está no ar e um
    // teste de integração estaria rodando contra ele. O `cleanup()` já voltou e
    // continua sem ser chamado — o container vive SÓ pelo registro do sweep.
    const pronto = await pe.esperarFase("pronto")
    expect(pronto.helper).toBe(cedo.helper)
    expect(dockerTem(pronto.helper), "o container do helper devia estar vivo").toBe(true)

    pe.proc.kill("SIGTERM")
    const [code, signal] = await pe.saiu

    await provarSweep({
      helper: pronto.helper,
      controle: pronto.controle,
      stderr: pe.stderr(),
      exitCode: code,
      signalCode: signal,
    })
  }, 240_000)

  it("SIGINT durante o SETUP: o registro já cobre o container antes de o cleanup voltar ao teste", async () => {
    const pe = subirFilho()
    filho = pe.proc

    // A janela mais cedo possível: o container existe e o sweep já foi
    // registrado, mas o helper ainda está criando admin/token/repo — o
    // `cleanup()` ainda NÃO foi devolvido para ninguém. Era exatamente aqui que
    // um SIGTERM do runner vazava container para sempre.
    const cedo = await pe.esperarFase("container")
    paraLimpar.add(cedo.helper).add(cedo.controle)
    expect(dockerTem(cedo.helper), "o container do helper devia estar vivo").toBe(true)

    pe.proc.kill("SIGINT")
    const [code, signal] = await pe.saiu

    await provarSweep({
      helper: cedo.helper,
      controle: cedo.controle,
      stderr: pe.stderr(),
      exitCode: code,
      signalCode: signal,
    })
  }, 120_000)
})
