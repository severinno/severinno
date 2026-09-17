/**
 * gitea-ephemeral-teardown-child.ts
 *
 * Processo FILHO do teste `gitea-ephemeral-teardown-falha.test.ts`. NÃO é um
 * teste: o vitest não o coleta (o `include` é `src/**\/*.test.{ts,tsx}`) e a
 * cobertura o ignora (`src/**\/__tests__/**` está no exclude).
 *
 * POR QUE UM PROCESSO SEPARADO: o veredito que se quer medir é o CÓDIGO DE SAÍDA
 * da execução — e código de saída só existe no fim de um processo. Rodar isso
 * dentro do vitest mediria o processo da suíte inteira (e derrubaria a suíte que
 * está medindo). Aqui o filho faz o mesmo caminho da produção:
 *
 *   1. carrega o helper pelo CAMINHO que o pai manda (`GITEA_HELPER_UNDER_TEST`)
 *      — é assim que a MESMA prova roda contra o helper real e contra uma cópia
 *      MUTADA (a mutação silencia o veredito de remoção);
 *   2. registra o sweep (`registrarSweepDeTeardown`, a porta da produção);
 *   3. tenta remover um container com um docker DUBLÊ que se recusa a soltar:
 *      `rm` falha com o erro real do daemon deste host e o container segue
 *      rodando — o desfecho (3) do teardown, o único que REPROVA;
 *   4. imprime o desfecho na stdout e SAI SOZINHO: quem decide o código de saída
 *      é o handler `exit` do helper, que é exatamente o que se quer medir.
 *
 * A stdout leva UMA linha JSON (`{reprovou, mensagem, chamadas}`) para o pai
 * separar "o teardown reprovou" de "o filho morreu por outro motivo" — um
 * não-zero de crash provaria qualquer coisa, menos o teardown.
 *
 * Uso (só o teste faz isso):
 *   GITEA_HELPER_UNDER_TEST=<caminho do helper.ts> \
 *     node --import tsx src/lib/__tests__/helpers/gitea-ephemeral-teardown-child.ts
 *
 * Exit codes:
 *   1  — teardown FALHOU (o esperado; constante `EXIT_TEARDOWN_FALHOU` do helper)
 *   3  — infra: `GITEA_HELPER_UNDER_TEST` ausente/não carrega (falha do harness)
 *   0  — o teardown NÃO reprovou: com o helper real isso é a falha que este filho
 *        existe para medir; contra a cópia mutada, é o resultado esperado (e é
 *        ele que mostra que a prova do pai depende do veredito).
 */

import { pathToFileURL } from "node:url"

import type { DockerRunner, RemocaoDoContainer } from "./gitea-ephemeral"

const HELPER = process.env.GITEA_HELPER_UNDER_TEST
const CONTAINER = process.env.GITEA_CONTAINER_FALSO ?? "gitea-ephemeral-test-morto"

function morrer(code: number, mensagem: string): never {
  process.stderr.write(`gitea-ephemeral-teardown-child: ${mensagem}\n`)
  process.exit(code)
}

/**
 * O docker DUBLÊ: um daemon que não consegue matar (o erro literal que este
 * host devolve, medido) e um container que não sai.
 *
 * Ele registra as chamadas para o pai poder afirmar que a FALHA veio de uma
 * TENTATIVA completa — `rm -f`, parada por dentro (`exec … kill -TERM 1`) e
 * `rm` — e não de um caminho pulado.
 */
function dockerQueNaoSolta(chamadas: string[]): DockerRunner {
  return (args) => {
    chamadas.push(args.join(" "))
    if (args[0] === "rm") {
      return {
        status: 1,
        stdout: "",
        stderr:
          `Error response from daemon: cannot remove container "${CONTAINER}": ` +
          `could not kill container: permission denied`,
      }
    }
    if (args[0] === "inspect") {
      // `-f {{.State.Running}}` responde "segue rodando"; o `inspect` sem filtro
      // responde "existe" (é por ele que o teardown decide se ainda há alvo).
      return { status: 0, stdout: args.includes("-f") ? "true\n" : "[]\n", stderr: "" }
    }
    return { status: 0, stdout: "", stderr: "" }
  }
}

interface OpcoesDeRemocao {
  docker?: DockerRunner
  esperaMs?: number
  esperaFinalMs?: number
}

interface HelperSobTeste {
  registrarSweepDeTeardown: () => void
  removerOuFalhar: (container: string, opts?: OpcoesDeRemocao) => void
  removerContainer: (container: string, opts?: OpcoesDeRemocao) => RemocaoDoContainer
}

async function main(): Promise<void> {
  if (!HELPER) morrer(3, "GITEA_HELPER_UNDER_TEST não foi definido pelo teste")

  let helper: HelperSobTeste
  try {
    // O `tsx` resolve este arquivo como CJS (o package.json do repo não declara
    // `type: module`), e um `import()` de um módulo CJS pode entregar os nomes
    // só por `default`. As duas formas são aceitas — mas NENHUMA é presumida: a
    // checagem abaixo reprova (exit 3, falha de harness) em vez de deixar um
    // "módulo vazio" virar veredito de teardown.
    const mod = (await import(pathToFileURL(HELPER).href)) as Record<string, unknown>
    helper =
      typeof mod.removerOuFalhar === "function"
        ? (mod as unknown as HelperSobTeste)
        : ((mod.default ?? {}) as HelperSobTeste)
  } catch (err) {
    morrer(3, `não carregou o helper em ${HELPER}: ${String(err)}`)
    throw err
  }
  for (const nome of ["registrarSweepDeTeardown", "removerOuFalhar"] as const) {
    if (typeof helper[nome] !== "function") {
      morrer(3, `o helper em ${HELPER} não expõe ${nome} (interop do carregador?)`)
    }
  }

  // A MESMA porta que a produção registra — o código de saída que o pai mede é
  // o do handler do helper, não o de um handler escrito aqui.
  helper.registrarSweepDeTeardown()

  const chamadas: string[] = []
  const docker = dockerQueNaoSolta(chamadas)

  let reprovou = false
  let mensagem = ""
  try {
    // `esperaMs: 0` e `esperaFinalMs: 0` porque o roteiro não tem espera
    // nenhuma: o container é imortal por construção, então poll nenhum mudaria
    // o desfecho — o que se mede aqui é o veredito, não o relógio.
    helper.removerOuFalhar(CONTAINER, { docker, esperaMs: 0, esperaFinalMs: 0 })
  } catch (err) {
    reprovou = true
    mensagem = err instanceof Error ? err.message : String(err)
  }

  process.stdout.write(`${JSON.stringify({ reprovou, mensagem, chamadas })}\n`)
  // Sem `process.exit()`: o processo sai sozinho e o handler `exit` do helper
  // decide o código (é esse o fato sob teste).
}

void main()

// O `main` é assíncrono: uma rejeição que faltar vira erro visível em vez de um
// código de saída que o pai leria como veredito do teardown.
process.on("unhandledRejection", (err) => {
  process.stderr.write(`unhandledRejection no filho: ${String(err)}\n`)
})
