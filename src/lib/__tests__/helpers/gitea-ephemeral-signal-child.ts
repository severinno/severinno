/**
 * gitea-ephemeral-signal-child.ts
 *
 * Processo FILHO do teste `gitea-ephemeral-signal.test.ts`. NÃO é um teste: o
 * vitest não o coleta (o `include` é `src/**\/*.test.{ts,tsx}`) e a cobertura o
 * ignora (`src/**\/__tests__/**` está no exclude).
 *
 * POR QUE UM PROCESSO SEPARADO: a única forma honesta de provar que o sweep do
 * helper sobrevive a um sinal é MATAR um processo de verdade. `process.kill` no
 * processo do vitest mataria a suíte inteira, e um teste que simula o sinal
 * (`process.emit("SIGTERM")`) não exercita o caminho do kernel — que é onde a
 * diferença mora. Então este filho sobe o Gitea efêmero pelo caminho REAL
 * (`makeEphemeralGitea`, o mesmo que os testes de integração usam, com os
 * handlers de sinal registrados) e FICA VIVO esperando o sinal.
 *
 * O CONTROLE (o que separa "o handler removeu" de "o container morreu sozinho"):
 * além do container do helper, este processo sobe um SEGUNDO container pelo
 * `docker run` cru — um container que o helper NÃO conhece e que, portanto,
 * NÃO está no registro do sweep. Se depois do sinal o container do helper
 * desaparece e o controle continua de pé, a remoção foi do handler. Sem o
 * controle, "o container sumiu" admitiria qualquer outra explicação.
 *
 * AS DUAS FASES publicadas na stdout (uma linha JSON cada):
 *   {"fase":"container", ...}  — o container do helper EXISTE e o sweep já está
 *                                registrado; o setup ainda está correndo (é a
 *                                janela em que o `cleanup()` ainda nem voltou
 *                                para o teste — foi por aqui que os containers
 *                                vazavam);
 *   {"fase":"pronto"}          — `makeEphemeralGitea` terminou: o servidor está
 *                                no ar e um teste de integração estaria rodando.
 *
 * Uso (só o teste faz isso):
 *   node --import tsx src/lib/__tests__/helpers/gitea-ephemeral-signal-child.ts
 *
 * Exit codes:
 *   3 — o container de controle não subiu · 4 — o container do helper não apareceu
 *   (os dois são falha do AMBIENTE, e o teste falha com o stderr)
 *   O caminho normal não tem exit code: quem termina este processo é o sinal,
 *   pelo handler do helper, com 130.
 */

import { spawnSync } from "node:child_process"
import { randomBytes } from "node:crypto"

import { makeEphemeralGitea } from "./gitea-ephemeral"

const IMAGE = "gitea/gitea:1.22"
/** Mesmo prefixo do helper: é por ele que o container dele é reconhecido. */
const PREFIXO = "gitea-ephemeral-test"

function containersVivos(): Set<string> {
  const res = spawnSync("docker", ["ps", "--format", "{{.Names}}"], { encoding: "utf8" })
  return new Set(
    res.stdout
      .split("\n")
      .map((linha) => linha.trim())
      .filter(Boolean),
  )
}

function morrer(code: number, mensagem: string): never {
  process.stderr.write(`gitea-ephemeral-signal-child: ${mensagem}\n`)
  process.exit(code)
}

// Nada de top-level `await`: o `tsx` resolve este arquivo como CJS (o
// package.json do repo não declara `type: module`), e `await` no topo quebra o
// transform. O `main()` assíncrono dá o mesmo resultado sem depender do formato
// de módulo que o carregador escolher.
async function main(): Promise<void> {
  const antes = containersVivos()

  // 1. O container do HELPER, pelo caminho real: `makeEphemeralGitea` cria o
  //    container, ADICIONA ao registro do sweep e só então começa a esperar o
  //    servidor responder. Não esperamos a promessa — o pai decide quando
  //    matar, e é justamente o "no meio" que se quer medir.
  const setup = makeEphemeralGitea({ timeoutMs: 240_000 })
  // O pai pode matar durante o setup: TRATAR a rejeição evita um unhandled
  // rejection que encerraria o processo ANTES do sinal (e o teste mediria outra
  // coisa que não o handler) — mas tratá-la EM SILÊNCIO esconderia a causa de a
  // fase "pronto" nunca chegar, então o motivo vai para o stderr.
  setup.catch((err: unknown) => {
    process.stderr.write(`gitea-ephemeral-signal-child: setup falhou: ${String(err)}\n`)
  })

  // 2. O CONTROLE: um container que o helper não conhece.
  const controle = `${PREFIXO}-controle-${randomBytes(4).toString("hex")}`
  const subiu = spawnSync("docker", ["run", "-d", "--name", controle, IMAGE], { encoding: "utf8" })
  if (subiu.status !== 0) morrer(3, `docker run do controle falhou: ${subiu.stderr}`)

  // 3. O container do helper é o nome NOVO com o prefixo dele (o controle é
  //    excluído explicitamente) — assim não dependemos de adivinhar o sufixo
  //    aleatório nem de não haver outra suíte rodando junto.
  let helper = ""
  for (let tentativa = 0; tentativa < 600 && helper === ""; tentativa++) {
    for (const nome of containersVivos()) {
      if (!antes.has(nome) && nome !== controle && nome.startsWith(PREFIXO)) {
        helper = nome
        break
      }
    }
    if (helper === "") await new Promise((r) => setTimeout(r, 50))
  }
  if (helper === "") morrer(4, "o container do helper não apareceu em 30s")

  process.stdout.write(`${JSON.stringify({ fase: "container", helper, controle })}\n`)

  // 4. A segunda fase: o servidor está no ar e um teste de integração estaria
  //    rodando contra ele. Aqui o `cleanup()` JÁ foi devolvido e continua sem
  //    ser chamado — o container vive só pelo registro do sweep.
  setup
    .then(() => {
      process.stdout.write(`${JSON.stringify({ fase: "pronto", helper, controle })}\n`)
    })
    .catch(() => {
      // o setup falhou (imagem, porta, timeout): a fase "pronto" não vem e o
      // pai falha com o timeout dele, que é o comportamento correto
    })

  // 5. Mantém o processo VIVO. Uma promessa pendente NÃO segura o event loop;
  //    um timer segura. Quem termina este processo é o sinal, pelo handler do
  //    helper — nenhum handler próprio é registrado aqui, de propósito: se o
  //    filho tratasse o sinal, o teste provaria a defesa DELE, não a do helper.
  setInterval(() => {}, 1000)
}

void main()

// O `main` acima é assíncrono e o processo não sai sozinho (o `setInterval`
// segura o loop): a rejeição que faltar vira erro visível em vez de silêncio.
process.on("unhandledRejection", (err) => {
  process.stderr.write(`unhandledRejection no filho: ${String(err)}\n`)
})
