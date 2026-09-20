#!/usr/bin/env node

// =============================================================================
// check-archived-pipeline.mjs
//
// Usage:
//   node scripts/check-archived-pipeline.mjs
//   node scripts/check-archived-pipeline.mjs --tabela   # passo → contraparte → condição
//   node scripts/check-archived-pipeline.mjs --json
//   node scripts/check-archived-pipeline.mjs --root X   # fixture (mutation test)
//
// Exit code:
//   0 — todo passo do retrato declara a SUA condição, e ela é a que a forja
//       aplica à contraparte do passo
//   1 — violação: passo sem `when:`, contraparte ausente/inexistente, condição
//       que não casa com a da forja, marcador que não resolve
//   2 — NÃO JULGÁVEL: o retrato (ou um workflow da forja) não existe/não abre/
//       não é UTF-8/não faz parsing em YAML, um evento da forja não tem
//       tradução declarada, ou um `if:` da contraparte sai da gramática: sem
//       ler a condição dos dois lados não há veredito a cunhar (a mesma
//       doutrina do `EXIT_UNJUDGEABLE` da casa: `1` é violação, `3` é uso).
//
// O QUE ESTE GUARD MEDE (e por que ele existe)
//
// `.woodpecker.yml` é o RETRATO ARQUIVADO da alternativa que não foi adotada
// (a forja é o Gitea/Forgejo). Ele continua no repositório como registro — e
// um registro que MENTE sobre QUANDO cada passo roda é pior que registro
// nenhum: quem o ler para entender a pipeline aprende um gatilho que a forja
// não usa mais. Havia só duas coisas julgando esse arquivo: a invariante 19 do
// `check-bun-mirror` (o VALOR da versão do Bun) e o `check:registry-source` (o
// host do registry). As CONDIÇÕES — `when:` de cada passo — não eram julgadas
// por ninguém, e é exatamente o campo que envelhece sozinho: a forja muda o
// `on:` do workflow, o retrato não.
//
// A régua: cada passo do retrato declara a SUA condição, em cláusulas
// (`when:` como LISTA — a semântica do Woodpecker é "qualquer entrada que case
// dispara o passo"), e essa condição tem de ser IGUAL à condição que a forja
// aplica ao trabalho daquele passo. Nada de "parecido": igual, por conjunto de
// cláusulas, depois de traduzidas.
//
// DE ONDE VEM A CONDIÇÃO DA FORJA (derivada, nunca uma lista à mão)
//
//   1. os gatilhos do WORKFLOW (`.gitea/workflows/*.yml`, chave `on:`) — cada
//      evento vira uma cláusula, com o filtro de `branches:` quando existe;
//   2. o `if:` do JOB, estreitando as cláusulas dos gatilhos quando ele fala de
//      evento ou de branch (`github.event_name == 'push'`, `github.ref ==
//      'refs/heads/main'`, `&&`, `||`). Um `if:` que sai da gramática declarada
//      (função de STATUS como `failure()`, `startsWith`, contexto que o guard
//      não conhece) NÃO é adivinhado: se aquele job for a contraparte de um
//      passo, o guard sai `2` nomeando o workflow, o job e a expressão.
//
// A TRADUÇÃO (declarada, uma vez, aqui — e escrita no cabeçalho do retrato)
//
//   retrato (Woodpecker)  →  forja (Gitea/Forgejo Actions)
//   push                  →  push
//   pull_request          →  pull_request
//   cron                  →  schedule
//   manual                →  workflow_dispatch
//
//   `branch:` do retrato casa com `branches:` da forja (e é o branch ALVO num
//   `pull_request`), como no Woodpecker. Os dois eventos sem filtro de branch
//   (`cron`/`schedule`, `manual`/`workflow_dispatch`) são declarados sem
//   `branch:` — um branch ali seria uma restrição que a forja não tem.
//
// COMO UM PASSO ENCONTRA A SUA CONTRAPARTE (descoberta, não lista à mão)
//
//   1. por COMANDO: o passo roda `bun run check:x`/`node scripts/y.mjs`/`tsc
//      --noEmit`; o guard canonicaliza os dois lados (uma entrada do
//      `package.json` que resolve para UMA invocação vale pela invocação —
//      `bun run check:registry-source` ≡ `node scripts/check-registry-source.mjs`)
//      e casa o passo com o JOB da forja que roda o mesmo comando. Um único job
//      casando: é a contraparte. DOIS jobs casando (`check:registry-source` roda
//      no `guards` do PR e no `smoke` manual): ambíguo — o passo precisa
//      DECLARAR a contraparte;
//   2. por MARCADOR EXPLÍCITO, em comentário (o arquivo continua YAML válido
//      para o Woodpecker, que nunca lê comentário):
//        # espelha: .gitea/workflows/deploy.yml#build
//      O alvo é verificado: o arquivo existe, o job existe, e — quando o job
//      tem comandos — ele roda ao menos um comando do passo (um marcador que
//      aponta para o job que não faz aquele trabalho é violação, não desempate);
//   3. SEM CONTRAPARTE, declarada com motivo:
//        # fora da forja: <motivo escrito>
//      É a classe `GITHUB_ONLY` desta régua: existe com razão DITA, e o passo
//      pela metade não some em silêncio. A declaração é conferida no lado
//      conferível: um passo com comandos que a forja RODA não pode se declarar
//      fora dela.
//
//   4. nada disso → VIOLAÇÃO. Um passo novo no retrato não passa por omissão:
//      ele entra no veredito ou é declarado.
//
// O QUE ELE **NÃO** JULGA (limites declarados, cada um com o dono)
//
//   - o CONJUNTO de passos: que a forja tenha um job sem passo correspondente
//     no retrato (o `migrate` do deploy, o `bring-up-proof` do CI) NÃO é
//     julgado aqui — esta régua é das CONDIÇÕES de quem existe. Quem cobra a
//     cobertura do conjunto é o guard de completude do retrato;
//   - `needs:` não é condição: dependência não é gatilho (um `needs` que pula
//     o job por causa de um `if:` fica fora; seria outra régua);
//   - o espelho do GitHub: a régua é contra a forja DONA DO MERGE (Gitea); a
//     paridade dele com o GitHub é do `check:forge-parity`;
//   - `when` nos DOIS níveis (pipeline e passo): o guard não combina os dois
//     (interseção silenciosa) — se acontecer, é violação nomeada;
//   - passo cujo bloco usa `settings:` (plugin) não tem comando: a contraparte
//     dele só existe por marcador, e o guard diz isso no relatório.
//
// A LEITURA É FAIL-CLOSED, pelas portas da casa (`readJudgedFile`): arquivo que
// não abre, byte que não é UTF-8 e YAML que não faz parsing são `2` NOMEADO —
// "não conseguir ler" nunca vira "nada a julgar" (o verde de não saber). E a
// leitura ESTRUTURAL usa o parser único do repositório (`parseYamlDocument`):
// a condição é estrutura, não texto, e uma segunda leitura linha-a-linha
// divergiria no dia em que o formato mudasse.
// =============================================================================

import { existsSync } from "node:fs"
import { join } from "node:path"
import {
  EXIT_UNJUDGEABLE,
  GITEA_WORKFLOW_DIR,
  parseYamlDocument,
  readJudgedFile,
  workflowFileNames,
} from "./forge-workflows.mjs"

/** O retrato arquivado (a alternativa avaliada e não adotada). */
export const RETRATO_REL = ".woodpecker.yml"

/** A forja DONA DO MERGE — é contra ela que o retrato é provado. */
export const FORJA_DIR = GITEA_WORKFLOW_DIR

/**
 * A tradução de evento, uma vez: retrato (Woodpecker) → forja (Actions).
 * Um evento que não esteja aqui NÃO é adivinhado: é violação nomeada.
 */
export const EVENTO_RETRATO_PARA_FORJA = {
  push: "push",
  pull_request: "pull_request",
  cron: "schedule",
  manual: "workflow_dispatch",
}

/** A volta da tradução (para a mensagem dizer o que a forja faz). */
export const EVENTO_FORJA_PARA_RETRATO = Object.fromEntries(
  Object.entries(EVENTO_RETRATO_PARA_FORJA).map(([retrato, forja]) => [forja, retrato]),
)

/** O que o guard reconhece como DECLARAÇÃO de topo (nunca pipeline). */
const DECLARACOES_DE_TOPO = new Set([
  "variables",
  "labels",
  "services",
  "clone",
  "skip_clone",
  "when",
  "depends_on",
  "runs_on",
  "platform",
  "workspace",
  "matrix",
  "steps",
])

/** As chaves que fazem de um mapa um PASSO (e não uma declaração qualquer). */
const CHAVES_DE_PASSO = ["image", "commands", "settings", "uses", "name", "pull"]

/** A chave que declara a contraparte de um passo (em comentário). */
const MARCADOR_ESPELHA_RE = /#\s*espelha:\s*(\S+?)#(\S+)\s*$/
/** A chave que declara um passo fora do contrato da forja (com motivo). */
const MARCADOR_FORA_RE = /#\s*fora da forja:\s*(.*?)\s*$/

// ── a condição canônica: uma LISTA de cláusulas, comparada por conjunto

/**
 * Uma cláusula é o que decide se um passo roda: `{evento, ramos?}` (o evento e
 * o filtro de branch, como nas duas pontas) — sem campos a mais, para a
 * comparação ser por IGUALDADE e não por semelhança.
 *
 * @typedef {{evento: string, ramos?: string[]}} Clausula
 */

/** A chave estável de uma cláusula (a comparação é por conjunto de chaves). */
export function chaveDaClausula(c) {
  return `${c.evento}${c.ramos ? `@[${[...c.ramos].sort().join(",")}]` : ""}`
}

/** A mesma lista em chaves ordenadas — a forma comparável. */
export function chavesDaCondicao(clausulas) {
  return [...new Set((clausulas ?? []).map(chaveDaClausula))].sort()
}

/** A redação humana de uma cláusula (`push@[main, develop]`). */
export function textoDaClausula(c) {
  return c.ramos ? `${c.evento}@[${[...c.ramos].sort().join(", ")}]` : c.evento
}

/** A redação humana de uma condição inteira. */
export function textoDaCondicao(clausulas) {
  if (!clausulas || clausulas.length === 0) return "(nenhuma — o passo NUNCA roda)"
  return [...new Set(clausulas.map(textoDaClausula))].sort().join(" ∪ ")
}

const lista = (v) => (Array.isArray(v) ? v.map(String) : [String(v)])

/**
 * As entradas de um `when:` — a forma do Woodpecker é `when` como LISTA de
 * mapas (qualquer entrada que case dispara o passo), mas o mapa único também é
 * aceito. Nada aqui passa por `String()`: o que entra é estrutura.
 */
const entradasDoWhen = (when) =>
  when === null || when === undefined ? [] : Array.isArray(when) ? when : [when]

/**
 * As cláusulas DECLARADAS por um `when:` do retrato. Aceita as duas formas do
 * Woodpecker (mapa e lista de mapas) e traduz cada entrada para a condição
 * canônica. Chave desconhecida (`path:`, `platform:`, `event: tag` sem
 * tradução) é violação NOMEADA — traduzir só o que se conhece, e dizer o
 * resto, é o que impede um `when` novo de virar condição presumida.
 *
 * @param {any} when
 * @param {{arquivo: string, linha: number|null, onde: string}} ctx
 * @returns {{clausulas: Clausula[], status: string[], violacoes: string[]}}
 */
export function clausulasDoWhen(when, ctx) {
  const violacoes = []
  const clausulas = []
  const status = []
  const onde = `${ctx.arquivo}${ctx.linha ? `:${ctx.linha}` : ""} (${ctx.onde})`
  for (const entrada of entradasDoWhen(when)) {
    if (entrada === null || typeof entrada !== "object" || Array.isArray(entrada)) {
      violacoes.push(
        `${onde}: \`when\` com entrada que não é um mapa de condições (${JSON.stringify(entrada)}) — o guard não sabe o que ela declara`,
      )
      continue
    }
    const chaves = Object.keys(entrada)
    const desconhecidas = chaves.filter((k) => !["event", "branch", "status"].includes(k))
    if (desconhecidas.length > 0) {
      violacoes.push(
        `${onde}: \`when\` usa ${desconhecidas.map((k) => `\`${k}:\``).join(", ")} — sem tradução declarada para a forja. Traduza para \`event:\`/\`branch:\` (a tabela do cabeçalho deste guard) ou declare o passo como fora da forja.`,
      )
      continue
    }
    // `status:` é um eixo DIFERENTE de evento: a forja deste contrato não tem
    // passo que rode por status, então a cláusula é LIDA e devolvida à parte
    // (nunca descartada em silêncio) — quem a carrega tem de se declarar fora
    // da forja, com motivo, e o veredito disso é do `julgaRetrato`.
    if (chaves.includes("status")) {
      const juntoComEvento = chaves.some((k) => k === "event" || k === "branch")
      if (juntoComEvento) {
        violacoes.push(
          `${onde}: \`when\` mistura \`status:\` com ${chaves
            .filter((k) => k === "event" || k === "branch")
            .map((k) => `\`${k}:\``)
            .join(
              "/",
            )} na MESMA entrada — o guard não combina os dois eixos (o status não é evento); separe em entradas distintas ou declare o passo fora da forja`,
        )
        continue
      }
      status.push(...lista(entrada.status))
      continue
    }
    if (!chaves.includes("event")) {
      violacoes.push(
        `${onde}: \`when\` sem \`event:\` (só ${chaves.map((k) => `\`${k}:\``).join(", ")}) — um filtro de branch sem evento não é uma condição: declare o evento.`,
      )
      continue
    }
    const eventos = lista(entrada.event)
    for (const evento of eventos) {
      const traduzido = EVENTO_RETRATO_PARA_FORJA[evento]
      if (!traduzido) {
        violacoes.push(
          `${onde}: evento \`${evento}\` do retrato não tem tradução declarada para a forja (conhecidos: ${Object.keys(
            EVENTO_RETRATO_PARA_FORJA,
          ).join(", ")}). Ou o guard aprende a tradução, ou o passo se declara fora da forja.`,
        )
        continue
      }
      const semBranch = traduzido === "schedule" || traduzido === "workflow_dispatch"
      if (entrada.branch !== undefined && semBranch) {
        violacoes.push(
          `${onde}: \`branch:\` junto de \`event: ${evento}\` — na forja o evento \`${traduzido}\` não tem filtro de branch; um branch aqui seria uma restrição inventada.`,
        )
        continue
      }
      clausulas.push({
        evento: traduzido,
        ...(entrada.branch !== undefined ? { ramos: lista(entrada.branch).sort() } : {}),
      })
    }
  }
  return { clausulas, status, violacoes }
}

/**
 * As cláusulas-base de um `on:` de workflow da forja — os gatilhos, com o
 * filtro de `branches:` de cada evento. Evento sem tradução (`tags`, `release`,
 * …) é violação: o guard não sabe o que ele significa na linguagem do retrato,
 * e presumir é a porta do verde falso.
 *
 * @param {any} on
 * @param {{arquivo: string, linha: number|null}} ctx
 * @returns {{clausulas: Clausula[], violacoes: string[]}}
 */
export function clausulasDoOn(on, ctx) {
  const violacoes = []
  const clausulas = []
  const onde = `${ctx.arquivo}${ctx.linha ? `:${ctx.linha}` : ""} (\`on:\`)`
  if (on === null || on === undefined) {
    violacoes.push(
      `${onde}: workflow sem \`on:\` — não há gatilho de onde derivar condição nenhuma`,
    )
    return { clausulas, violacoes }
  }
  if (typeof on === "string") {
    return clausulasDoOn({ [on]: null }, ctx)
  }
  if (Array.isArray(on)) {
    const obj = {}
    for (const e of on) obj[String(e)] = null
    return clausulasDoOn(obj, ctx)
  }
  if (typeof on !== "object") {
    violacoes.push(`${onde}: \`on:\` com forma que o guard não lê (${JSON.stringify(on)})`)
    return { clausulas, violacoes }
  }
  for (const [evento, valor] of Object.entries(on)) {
    if (!Object.hasOwn(EVENTO_FORJA_PARA_RETRATO, evento)) {
      violacoes.push(
        `${onde}: evento \`${evento}:\` sem tradução declarada para a linguagem do retrato (conhecidos: ${Object.keys(
          EVENTO_FORJA_PARA_RETRATO,
        ).join(", ")}). Ou o guard aprende a tradução, ou o evento sai do contrato.`,
      )
      continue
    }
    const ramos =
      valor && typeof valor === "object" && !Array.isArray(valor) && valor.branches
        ? lista(valor.branches).sort()
        : null
    clausulas.push({ evento, ...(ramos ? { ramos } : {}) })
  }
  return { clausulas, violacoes }
}

// ── o `if:` do job: a gramática declarada, com três valores (true/false/?)

const TERMOS = [
  { re: /^github\.event_name\s*==\s*['"]([^'"]+)['"]$/, tipo: "eventoIgual", negado: false },
  { re: /^github\.event_name\s*!=\s*['"]([^'"]+)['"]$/, tipo: "eventoIgual", negado: true },
  { re: /^github\.ref\s*==\s*['"]refs\/heads\/([^'"]+)['"]$/, tipo: "ramoIgual", negado: false },
  { re: /^github\.ref\s*!=\s*['"]refs\/heads\/([^'"]+)['"]$/, tipo: "ramoIgual", negado: true },
  { re: /^github\.ref_name\s*==\s*['"]([^'"]+)['"]$/, tipo: "ramoIgual", negado: false },
  { re: /^github\.ref_name\s*!=\s*['"]([^'"]+)['"]$/, tipo: "ramoIgual", negado: true },
]

/**
 * Uma POSSIBILIDADE é uma cláusula aberta num par (evento, branch): é o que
 * faz o `if:` ESTREITAR bem — uma cláusula `push@[main, develop]` com o `if`
 * `github.ref == 'refs/heads/main'` não vira `push@[main, develop]` (o
 * `includes` diria "sim" e deixaria a cláusula inteira) nem some: vira
 * `push@[main]`, o conjunto de branches que sobrou.
 *
 * O branch `null` é "a forja NÃO filtra" (schedule/dispatch, ou um push sem
 * `branches:`) — e é ele que faz um termo sobre `github.ref` ser INDECIDÍVEL em
 * vez de falso: sem filtro, o ref pode ser qualquer um.
 */
export function possibilidadesDe(clausula) {
  if (clausula.ramos && clausula.ramos.length > 0) {
    return clausula.ramos.map((ramo) => ({ evento: clausula.evento, ramo }))
  }
  return [{ evento: clausula.evento, ramo: null }]
}

/**
 * O valor de um termo para UMA possibilidade: `true`, `false` ou `undefined`
 * ("não decidível"). `undefined` é o que impede a adivinhação — e é ele que
 * faz o guard sair `2` em vez de incluir ou descartar a cláusula no escuro.
 */
export function avaliaTermo(termo, possibilidade) {
  const t = termo
    .trim()
    .replace(/^\((.*)\)$/s, "$1")
    .trim()
  for (const { re, tipo, negado } of TERMOS) {
    const m = re.exec(t)
    if (!m) continue
    const valor =
      tipo === "eventoIgual"
        ? possibilidade.evento === m[1]
        : possibilidade.ramo === null
          ? undefined
          : possibilidade.ramo === m[1]
    if (valor === undefined) return undefined
    return negado ? !valor : valor
  }
  return undefined
}

/** A divisão por `||` (a mais frouxa) — o topo da expressão. */
const divide = (expr, op) => {
  const partes = []
  let nivel = 0
  let atual = ""
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i]
    if (c === "(") nivel++
    if (c === ")") nivel--
    if (nivel === 0 && expr.slice(i, i + op.length) === op) {
      partes.push(atual)
      atual = ""
      i += op.length - 1
      continue
    }
    atual += c
  }
  partes.push(atual)
  return partes
}

/**
 * Avalia uma expressão `if:` para uma cláusula, com `&&`/`||` e os termos da
 * gramática. Um `${{ ... }}` em volta é removido (é a forma do runner, não da
 * expressão). `undefined` = não decidível.
 */
export function avaliaExpressao(expr, possibilidade) {
  const bruta = String(expr ?? "")
    .replace(/^\s*\$\{\{/, "")
    .replace(/\}\}\s*$/, "")
    .trim()
  if (bruta === "") return true
  return avaliaOu(bruta, possibilidade)
}

function avaliaOu(expr, possibilidade) {
  const partes = divide(expr, "||")
  const valores = partes.map((p) => avaliaE(p, possibilidade))
  if (valores.includes(true)) return true
  if (valores.every((v) => v === false)) return false
  return undefined
}

function avaliaE(expr, possibilidade) {
  const partes = divide(expr, "&&")
  const valores = partes.map((p) => avaliaTermo(p, possibilidade))
  if (valores.includes(false)) return false
  if (valores.every((v) => v === true)) return true
  return undefined
}

/**
 * A condição de UM job da forja: as cláusulas-base do workflow, ESTREITADAS
 * pelo `if:` do job. Uma cláusula que o `if` descarta sai; a que ele deixa
 * entra; a que ele deixa em dúvida torna a condição NÃO JULGÁVEL (o guard
 * prefere o `2` explicado ao veredito por palpite).
 *
 * @param {Clausula[]} base
 * @param {any} ifExpr
 * @returns {{clausulas: Clausula[], indecidivel: string|null}}
 */
export function condicaoDoJob(base, ifExpr) {
  if (ifExpr === undefined || ifExpr === null || String(ifExpr).trim() === "") {
    return { clausulas: base, indecidivel: null }
  }
  const clausulas = []
  for (const c of base) {
    const passageiras = []
    for (const p of possibilidadesDe(c)) {
      const v = avaliaExpressao(ifExpr, p)
      if (v === undefined) {
        return {
          clausulas: [],
          indecidivel: `\`if: ${String(ifExpr).trim()}\` não é decidível para a cláusula \`${textoDaClausula(
            c,
          )}\` — a expressão sai da gramática que o guard declara (evento/branch; STATUS como \`failure()\` fica de fora de propósito)`,
        }
      }
      if (v === true) passageiras.push(p)
    }
    if (passageiras.length === 0) continue
    const ramos = passageiras.map((p) => p.ramo)
    clausulas.push(
      ramos.every((r) => r === null)
        ? { evento: c.evento }
        : { evento: c.evento, ramos: [...new Set(ramos.filter((r) => r !== null))].sort() },
    )
  }
  return { clausulas, indecidivel: null }
}

// ── os RÓTULOS de comando: um comando, uma chave comum às duas pontas

const INVOCACOES = [
  /(?:^|[\s|&;(])(?:node|bun)\s+(scripts\/[A-Za-z0-9_./@-]+\.(?:mjs|js|cjs|ts|sh|py|bash))/g,
  /\bbun(?:x)?\s+run\s+([A-Za-z0-9_:@./-]+)/g,
  /\btsc\s+--noEmit\b/g,
]

/**
 * Os rótulos que um TEXTO de comandos invoca. A canonicalização é o que faz o
 * casamento ser por trabalho, e não por forma: uma entrada do `package.json`
 * que resolve para UMA invocação vale pela invocação
 * (`bun run check:registry-source` ≡ `node scripts/check-registry-source.mjs`,
 * `bun run typecheck` ≡ `tsc --noEmit`), e uma entrada que resolve para uma
 * cadeia (`lint` = prettier + eslint) vale por ela mesma.
 *
 * @param {string} texto
 * @param {Record<string,string>} entradas  scripts do package.json
 * @returns {Set<string>}
 */
export function rotulosDeTexto(texto, entradas = {}) {
  const out = new Set()
  const add = (t, { expandir = true } = {}) => {
    const s = String(t)
    const achados = new Set()
    for (const re of INVOCACOES) {
      re.lastIndex = 0
      for (const m of s.matchAll(re)) achados.add(m[1] ? m[1] : "tsc --noEmit")
    }
    if (achados.size === 0) return
    for (const a of achados) {
      if (a === "tsc --noEmit" || a.startsWith("scripts/")) {
        out.add(a)
        continue
      }
      // A entrada vale pelo que ela RODA (uma invocação) ou por si mesma (uma
      // cadeia de shell como o `lint`, que não é uma invocação só): expandir e
      // não achar invocação nenhuma NÃO pode fazer o rótulo sumir — o comando
      // existe, e o casamento é por ele.
      const resolvido = expandir ? entradas[a] : undefined
      if (resolvido !== undefined) {
        const antes = out.size
        add(resolvido, { expandir: false })
        if (out.size > antes) continue
      }
      out.add(`bun run ${a}`)
    }
  }
  add(texto)
  return out
}

// ── a leitura do retrato

/** Acha a linha de uma chave aninhada (para o diagnóstico nomear arquivo:linha). */
export function linhaDaChave(linhas, nome, { apos = 0, indent = null } = {}) {
  for (let i = apos; i < linhas.length; i++) {
    const l = linhas[i]
    if (l.trim() === "" || l.trim().startsWith("#")) continue
    const ind = /^[ \t]*/.exec(l)[0].length
    if (indent !== null && ind !== indent) continue
    const m = new RegExp(`^\\s*${escapar(nome)}:\\s*(?:#.*)?$`).exec(l)
    if (m) return i + 1
  }
  return null
}

/** O recuo do primeiro filho de um bloco (medido, nunca presumido `2`). */
export function recuoDosFilhos(linhas, indicePai) {
  const recuoPai = /^[ \t]*/.exec(linhas[indicePai] ?? "")[0].length
  for (let i = indicePai + 1; i < linhas.length; i++) {
    const l = linhas[i]
    if (l.trim() === "" || l.trim().startsWith("#")) continue
    const ind = /^[ \t]*/.exec(l)[0].length
    if (ind <= recuoPai) return null
    return ind
  }
  return null
}

const escapar = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** O bloco de um passo: da chave até a próxima chave do mesmo nível. */
function blocoDoPasso(linhas, idx, recuo) {
  const out = [linhas[idx]]
  for (let i = idx + 1; i < linhas.length; i++) {
    const l = linhas[i]
    if (l.trim() === "") {
      out.push(l)
      continue
    }
    const ind = /^[ \t]*/.exec(l)[0].length
    if (ind <= recuo) break
    out.push(l)
  }
  return out
}

/**
 * Lê o retrato: pipelines, passos, comandos, condições declaradas e os
 * marcadores. O topo tem de ser um MAPA; uma chave que não é pipeline nem
 * declaração conhecida é violação (uma pipeline nova não pode entrar muda).
 *
 * @param {string} root
 * @returns {{
 *   passos: any[], violacoes: string[], naoJulgavel: string|null,
 *   pipelines: string[],
 * }}
 */
export function lerRetrato(root) {
  const rel = RETRATO_REL
  const abs = join(root, rel)
  if (!existsSync(abs)) {
    return {
      passos: [],
      violacoes: [],
      pipelines: [],
      naoJulgavel: `${rel}: o retrato arquivado não existe — não há condição nenhuma a provar (se a alternativa arquivada foi apagada de vez, este guard sai do pipeline junto com ela)`,
    }
  }
  let texto
  try {
    texto = readJudgedFile(abs, rel)
  } catch (err) {
    return {
      passos: [],
      violacoes: [],
      pipelines: [],
      naoJulgavel: `${rel}: ${err?.motivo ?? String(err?.message ?? err)}`,
    }
  }
  const parsed = parseYamlDocument(texto)
  if (!parsed.ok) {
    return { passos: [], violacoes: [], pipelines: [], naoJulgavel: `${rel}: ${parsed.motivo}` }
  }
  const doc = parsed.doc
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
    return {
      passos: [],
      violacoes: [],
      pipelines: [],
      naoJulgavel: `${rel}: o topo não é um mapa de pipelines — nenhum passo pode ser lido`,
    }
  }
  const linhas = texto.split(/\r?\n/)
  const passos = []
  const violacoes = []
  const pipelines = []
  const idxDe = (nome) =>
    linhas.findIndex((l) => new RegExp(`^${escapar(nome)}:\\s*(?:#.*)?$`).test(l))
  for (const [nome, valor] of Object.entries(doc)) {
    if (valor === null || typeof valor !== "object" || Array.isArray(valor)) {
      if (!DECLARACOES_DE_TOPO.has(nome)) {
        violacoes.push(
          `${rel}: chave de topo \`${nome}:\` não é pipeline nem declaração conhecida — o guard não julga o que não classificou`,
        )
      }
      continue
    }
    // `when` no nível do PIPELINE é declaração (o default dos passos), nunca
    // passo: ele sai da classificação — e o guard julga os DOIS níveis, em vez
    // de deixar um `when` de pipeline passar por "passo estranho".
    const filhos = Object.entries(valor).filter(([k]) => k !== "when")
    const ehPipeline =
      filhos.length > 0 &&
      filhos.every(
        ([, passo]) =>
          passo !== null &&
          typeof passo === "object" &&
          !Array.isArray(passo) &&
          Object.keys(passo).some((k) => CHAVES_DE_PASSO.includes(k)),
      )
    if (!ehPipeline) {
      if (!DECLARACOES_DE_TOPO.has(nome)) {
        violacoes.push(
          `${rel}: chave de topo \`${nome}:\` não parece pipeline (nenhum passo com \`image:\`/\`commands:\`) nem é declaração conhecida — classifique-a ou tire-a do arquivo`,
        )
      }
      continue
    }
    pipelines.push(nome)
    const idxPipeline = idxDe(nome)
    const recuoPasso = idxPipeline === -1 ? null : recuoDosFilhos(linhas, idxPipeline)
    const whenDoPipeline = valor.when ?? doc.when
    for (const [nomePasso, passo] of Object.entries(valor)) {
      if (nomePasso === "when") continue
      if (passo === null || typeof passo !== "object" || Array.isArray(passo)) continue
      const idxPasso =
        recuoPasso === null
          ? null
          : linhas.findIndex(
              (l, i) =>
                i > idxPipeline &&
                new RegExp(`^\\s{${recuoPasso}}${escapar(nomePasso)}:\\s*(?:#.*)?$`).test(l),
            )
      const linha = idxPasso === undefined || idxPasso === -1 ? null : idxPasso + 1
      const bloco = idxPasso === -1 ? [] : blocoDoPasso(linhas, idxPasso, recuoPasso)
      // O marcador pode estar DENTRO do bloco do passo ou nas linhas de
      // comentário imediatamente ACIMA da chave dele (a forma como o arquivo
      // agrupa `# espelha:`/`# fora da forja:`): as duas contam, e as duas
      // param no primeiro comentário que o passo não escreveu.
      const acima = []
      for (let i = idxPasso - 1; i >= 0; i--) {
        const l = linhas[i]
        if (!/^[ \t]*#/.test(l)) break
        if (/^[ \t]*/.exec(l)[0].length < recuoPasso) break
        acima.unshift(l)
      }
      const marcadores = [...acima, ...bloco]
        .map((l) => MARCADOR_ESPELHA_RE.exec(l) ?? MARCADOR_FORA_RE.exec(l))
        .filter(Boolean)
      const espelha = marcadores.find((m) => m.length === 3) ?? null
      const fora = marcadores.find((m) => m.length === 2) ?? null
      const comandos = Array.isArray(passo.commands)
        ? passo.commands
        : typeof passo.commands === "string"
          ? [passo.commands]
          : []
      const comandosNaoTexto = comandos.filter((c) => typeof c !== "string")
      if (comandosNaoTexto.length > 0) {
        violacoes.push(
          `${rel}${linha ? `:${linha}` : ""}: passo \`${nomePasso}\` tem comando que não é texto (${JSON.stringify(
            comandosNaoTexto[0],
          )}) — o guard não lê o que ele executa`,
        )
      }
      const whenProprio = passo.when
      const whenEfetivo = whenProprio !== undefined ? whenProprio : whenDoPipeline
      const doisNiveis = whenProprio !== undefined && whenDoPipeline !== undefined
      let clausulas = []
      let status = []
      if (doisNiveis) {
        violacoes.push(
          `${rel}${linha ? `:${linha}` : ""}: passo \`${nomePasso}\` tem \`when\` no passo E no pipeline — o guard não combina os dois (interseção silenciosa). Deixe a condição num lugar só.`,
        )
      } else if (whenEfetivo === undefined) {
        violacoes.push(
          `${rel}${linha ? `:${linha}` : ""}: passo \`${nomePasso}\` NÃO declara \`when:\` — sem a condição escrita, o retrato não diz quando o passo roda, e o silêncio vira uma promessa que ninguém conferiu`,
        )
      } else {
        const r = clausulasDoWhen(whenEfetivo, {
          arquivo: `${rel}${linha ? `:${linha}` : ""}`,
          linha: null,
          onde: `passo ${nomePasso}${whenProprio === undefined ? ` (herdado do pipeline \`${nome}\`)` : ""}`,
        })
        clausulas = r.clausulas
        status = r.status
        violacoes.push(...r.violacoes)
      }
      passos.push({
        rel,
        pipeline: nome,
        nome: nomePasso,
        linha,
        comandos: comandos.filter((c) => typeof c === "string"),
        clausulas,
        status,
        declarada: whenEfetivo !== undefined && !doisNiveis,
        espelha: espelha ? { arquivo: espelha[1], job: espelha[2] } : null,
        fora: fora ? fora[1] : null,
      })
    }
  }
  return { passos, violacoes, pipelines, naoJulgavel: null }
}

// ── a leitura da forja

/**
 * Lê a forja: para cada workflow, as cláusulas dos gatilhos e a condição de
 * cada JOB. Job cuja condição sai da gramática sai com `indecidivel` (não
 * some: vira `2` se for contraparte de alguém, e informação se não for).
 *
 * @param {string} root
 * @returns {{
 *   jobs: any[], violacoes: string[], naoJulgaveis: string[], entradas: Record<string,string>,
 * }}
 */
export function lerForja(root) {
  const violacoes = []
  const naoJulgaveis = []
  const jobs = []
  const entradas = lerEntradas(root)
  for (const nome of workflowFileNames(root, FORJA_DIR)) {
    const rel = `${FORJA_DIR}/${nome}`
    let texto
    try {
      texto = readJudgedFile(join(root, rel), rel)
    } catch (err) {
      naoJulgaveis.push(`${rel}: ${err?.motivo ?? String(err?.message ?? err)}`)
      continue
    }
    const parsed = parseYamlDocument(texto)
    if (!parsed.ok) {
      naoJulgaveis.push(`${rel}: ${parsed.motivo}`)
      continue
    }
    const doc = parsed.doc
    if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
      naoJulgaveis.push(`${rel}: o topo não é um mapa de workflow`)
      continue
    }
    const linhas = texto.split(/\r?\n/)
    const idxJobs = linhas.findIndex((l) => /^jobs:\s*(?:#.*)?$/.test(l))
    const recuoJob = idxJobs === -1 ? null : recuoDosFilhos(linhas, idxJobs)
    const linhaOn = linhaDaChave(linhas, "on")
    const base = clausulasDoOn(doc.on, { arquivo: rel, linha: linhaOn })
    violacoes.push(...base.violacoes)
    for (const [nomeJob, job] of Object.entries(doc.jobs ?? {})) {
      if (job === null || typeof job !== "object" || Array.isArray(job)) continue
      const linha =
        recuoJob === null
          ? null
          : (() => {
              const i = linhas.findIndex(
                (l, k) =>
                  k > idxJobs &&
                  new RegExp(`^\\s{${recuoJob}}${escapar(nomeJob)}:\\s*(?:#.*)?$`).test(l),
              )
              return i === -1 ? null : i + 1
            })()
      const { clausulas, indecidivel } = condicaoDoJob(base.clausulas, job.if)
      const rotulos = new Set()
      for (const passo of job.steps ?? []) {
        if (typeof passo?.run === "string")
          for (const r of rotulosDeTexto(passo.run, entradas)) rotulos.add(r)
      }
      jobs.push({
        arquivo: rel,
        job: nomeJob,
        linha,
        condicao: clausulas,
        indecidivel,
        ifExibido: job.if === undefined ? null : String(job.if).trim(),
        rotulos,
      })
    }
  }
  return { jobs, violacoes, naoJulgaveis, entradas }
}

/**
 * As entradas do `package.json` — a tabela que deixa `bun run check:x` valer
 * pelo script que ele roda. Ausente ou inválido é `null` (o guard segue, e a
 * canonicalização simplesmente não expande: o casamento continua correto,
 * porque a MESMA função é aplicada nas duas pontas).
 */
export function lerEntradas(root) {
  const abs = join(root, "package.json")
  if (!existsSync(abs)) return {}
  try {
    const doc = JSON.parse(readJudgedFile(abs, "package.json"))
    return doc?.scripts && typeof doc.scripts === "object" ? doc.scripts : {}
  } catch {
    return {}
  }
}

// ── o veredito: passo por passo

/**
 * Julga o retrato contra a forja. Devolve o que foi PROVADO (passo →
 * contraparte → condição), as violações e o que não pode ser julgado.
 *
 * @param {string} root
 * @returns {any}
 */
export function julgaRetrato(root) {
  const retrato = lerRetrato(root)
  const forja = lerForja(root)
  const violacoes = [...retrato.violacoes, ...forja.violacoes]
  const naoJulgaveis = [...forja.naoJulgaveis]
  if (retrato.naoJulgavel) naoJulgaveis.push(retrato.naoJulgavel)
  const provados = []
  const foraDaForja = []
  const ambiguos = []

  for (const passo of retrato.passos) {
    const onde = `${passo.rel}${passo.linha ? `:${passo.linha}` : ""} (\`${passo.pipeline}.${passo.nome}\`)`
    const rotulos = new Set()
    for (const c of passo.comandos)
      for (const r of rotulosDeTexto(c, forja.entradas)) rotulos.add(r)
    const pontuados = forja.jobs
      .map((j) => ({ job: j, comum: [...rotulos].filter((r) => j.rotulos.has(r)).length }))
      .filter((p) => p.comum > 0)
    const maximo = pontuados.reduce((m, p) => Math.max(m, p.comum), 0)
    const casados = pontuados.filter((p) => p.comum === maximo).map((p) => p.job)

    if (passo.fora !== null) {
      if (passo.fora.trim() === "") {
        violacoes.push(
          `${onde}: \`# fora da forja:\` sem motivo escrito — a classe existe com a razão DITA`,
        )
        continue
      }
      if (casados.length > 0) {
        violacoes.push(
          `${onde}: declara-se FORA DA FORJA, mas a forja RODA os comandos deste passo em ${casados
            .map((j) => `\`${j.arquivo}#${j.job}\``)
            .join(", ")} — a declaração é contradita pelo disco`,
        )
        continue
      }
      foraDaForja.push({ passo, motivo: passo.fora.trim() })
      continue
    }

    // O eixo STATUS não casa com job nenhum deste contrato (a forja não tem
    // passo que rode por status): quem o usa precisa DIZER por que ele fica
    // fora — e é o que o marcador faz. Sem a declaração, o passo não é julgado
    // por ninguém, que é a única coisa que esta régua não admite.
    if (passo.status.length > 0) {
      violacoes.push(
        `${onde}: declara \`when\` por \`status: [${passo.status.join(", ")}]\` — a forja deste contrato não tem passo de status, então não há condição de evento para comparar. Declare \`# fora da forja: <motivo>\` (é o que diz, em voz alta, que este passo não tem contraparte).`,
      )
      continue
    }

    if (passo.espelha) {
      const { arquivo, job } = passo.espelha
      if (!existsSync(join(root, arquivo))) {
        violacoes.push(
          `${onde}: marcador \`# espelha: ${arquivo}#${job}\` aponta para um arquivo que NÃO existe — a contraparte declarada é um passo que nunca é julgado`,
        )
        continue
      }
      const alvo = forja.jobs.find((j) => j.arquivo === arquivo && j.job === job)
      if (!alvo) {
        const existentes = forja.jobs
          .filter((j) => j.arquivo === arquivo)
          .map((j) => j.job)
          .join(", ")
        violacoes.push(
          `${onde}: marcador \`# espelha: ${arquivo}#${job}\` aponta para um job que NÃO existe em ${arquivo} — jobs lidos ali: ${existentes || "nenhum"}`,
        )
        continue
      }
      if (alvo.rotulos.size > 0 && rotulos.size > 0) {
        const comum = [...rotulos].filter((r) => alvo.rotulos.has(r))
        if (comum.length === 0) {
          violacoes.push(
            `${onde}: marcador \`# espelha: ${arquivo}#${job}\`, mas aquele job não roda nenhum comando deste passo (${[
              ...rotulos,
            ].join(", ")}) — a contraparte declarada é outro trabalho`,
          )
          continue
        }
      }
      if (alvo.indecidivel) {
        naoJulgaveis.push(`${onde}: a contraparte \`${arquivo}#${job}\` tem ${alvo.indecidivel}`)
        continue
      }
      compara(onde, passo, alvo, provados, violacoes)
      continue
    }

    if (casados.length === 0) {
      const porque =
        passo.comandos.length === 0
          ? "o passo não roda comando de repositório: é plugin (`settings:`)"
          : `os comandos dele não são invocações de repositório reconhecidas (${[...rotulos].join(", ") || "nenhuma"})`
      violacoes.push(
        `${onde}: sem contraparte na forja — nenhum job de ${FORJA_DIR}/ casa com este passo (${porque}). Declare \`# espelha: ${FORJA_DIR}/<arquivo>.yml#<job>\` ou \`# fora da forja: <motivo>\`.`,
      )
      continue
    }
    if (casados.length > 1) {
      ambiguos.push({ passo, casados })
      violacoes.push(
        `${onde}: o comando casa com ${casados.length} jobs com a MESMA sobreposição (${casados
          .map((j) => `\`${j.arquivo}#${j.job}\`: ${textoDaCondicao(j.condicao)}`)
          .join("; ")}) — ambíguo: declare a contraparte com \`# espelha:\``,
      )
      continue
    }
    const indecidivel = casados.find((j) => j.indecidivel)
    if (indecidivel) {
      naoJulgaveis.push(
        `${onde}: a contraparte \`${indecidivel.arquivo}#${indecidivel.job}\` tem ${indecidivel.indecidivel}`,
      )
      continue
    }
    compara(onde, passo, casados[0], provados, violacoes)
  }

  return {
    passos: retrato.passos,
    pipelines: retrato.pipelines,
    provados,
    foraDaForja,
    ambiguos,
    violacoes,
    naoJulgaveis,
    jobs: forja.jobs,
  }
}

function compara(onde, passo, alvo, provados, violacoes) {
  const declarada = chavesDaCondicao(passo.clausulas)
  const daForja = chavesDaCondicao(alvo.condicao)
  const contraparte = `${alvo.arquivo}#${alvo.job}`
  if (declarada.join(" ") !== daForja.join(" ")) {
    violacoes.push(
      `${onde}: o retrato declara ${textoDaCondicao(passo.clausulas)}, mas a forja roda a contraparte \`${contraparte}\` em ${textoDaCondicao(
        alvo.condicao,
      )} — o retrato mente sobre QUANDO este passo roda. Atualize \`when:\` (ou a forja).`,
    )
    return
  }
  provados.push({
    passo,
    contraparte,
    condicao: textoDaCondicao(alvo.condicao),
    clausulas: passo.clausulas,
  })
}

// ── CLI

const USAGE = `check-archived-pipeline.mjs — as CONDIÇÕES de cada passo do retrato arquivado, provadas contra a forja

Usage:
  node scripts/check-archived-pipeline.mjs                 # veredito
  node scripts/check-archived-pipeline.mjs --tabela        # passo → contraparte → condição
  node scripts/check-archived-pipeline.mjs --json          # saída estruturada
  node scripts/check-archived-pipeline.mjs --root <dir>    # raiz alternativa (fixture)

Exit codes:
  0 — provado (todo passo declara a condição que a forja aplica à sua contraparte)
  1 — violação (passo sem \`when:\`, contraparte ausente/inexistente/ambígua, condição divergente)
  2 — não julgável (retrato/workflow ilegível, YAML inválido, evento sem tradução, \`if:\` fora da gramática)
`

/**
 * @param {string[]} [argv]
 * @returns {number} exit code
 */
export function main(argv = process.argv.slice(2)) {
  if (argv.includes("-h") || argv.includes("--help")) {
    console.log(USAGE)
    return 0
  }
  const iRoot = argv.indexOf("--root")
  const root = iRoot === -1 ? process.cwd() : argv[iRoot + 1]
  const json = argv.includes("--json")
  const tabela = argv.includes("--tabela")
  const r = julgaRetrato(root)

  if (json) {
    console.log(
      JSON.stringify(
        {
          pipelines: r.pipelines,
          passos: r.passos.length,
          provados: r.provados.map((p) => ({
            passo: `${p.passo.pipeline}.${p.passo.nome}`,
            contraparte: p.contraparte,
            condicao: p.condicao,
          })),
          foraDaForja: r.foraDaForja.map((f) => ({
            passo: `${f.passo.pipeline}.${f.passo.nome}`,
            motivo: f.motivo,
          })),
          ambiguos: r.ambiguos.map((a) => ({
            passo: `${a.passo.pipeline}.${a.passo.nome}`,
            casados: a.casados.map((j) => `${j.arquivo}#${j.job}: ${textoDaCondicao(j.condicao)}`),
          })),
          violacoes: r.violacoes,
          naoJulgaveis: r.naoJulgaveis,
        },
        null,
        2,
      ),
    )
    return r.naoJulgaveis.length > 0 ? EXIT_UNJUDGEABLE : r.violacoes.length > 0 ? 1 : 0
  }

  if (r.naoJulgaveis.length > 0) {
    console.error("❌ NÃO JULGÁVEL — não conseguir ler a condição NÃO é não haver nada a julgar:")
    console.error("")
    for (const n of r.naoJulgaveis) console.error(`     ${n}`)
    console.error("")
    return EXIT_UNJUDGEABLE
  }

  if (tabela) {
    for (const p of r.provados) {
      console.log(`  ${p.passo.pipeline}.${p.passo.nome} → ${p.contraparte} · ${p.condicao}`)
    }
    for (const f of r.foraDaForja) {
      console.log(`  ${f.passo.pipeline}.${f.passo.nome} → fora da forja · ${f.motivo}`)
    }
    console.log("")
  }

  if (r.violacoes.length > 0) {
    console.error(
      "❌ retrato arquivado (.woodpecker.yml) x forja (.gitea/workflows/) — condições divergentes:",
    )
    console.error("")
    for (const v of r.violacoes) console.error(`     ${v}`)
    console.error("")
    console.error(
      `   ${r.passos.length} passo(s) no retrato, ${r.provados.length} provado(s), ${r.foraDaForja.length} fora da forja.`,
    )
    return 1
  }

  const pipelines = r.pipelines.length
  console.log(
    `✅ retrato arquivado: ${r.passos.length} passo(s) em ${pipelines} pipeline(s) — a condição de cada um é a que a forja aplica à sua contraparte`,
  )
  for (const p of r.provados) {
    console.log(`     ${p.passo.pipeline}.${p.passo.nome} → ${p.contraparte} · ${p.condicao}`)
  }
  for (const f of r.foraDaForja) {
    console.log(`     ${f.passo.pipeline}.${f.passo.nome} → fora da forja · ${f.motivo}`)
  }
  return 0
}

const invokedDirectly = process.argv[1] && /check-archived-pipeline\.mjs$/.test(process.argv[1])
if (invokedDirectly) process.exit(main())
