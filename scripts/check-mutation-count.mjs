#!/usr/bin/env node
// =============================================================================
// check-mutation-count.mjs — Guard do Nº de sub-tests do mutation-guards
// =============================================================================
//
// Usage:
//   node scripts/check-mutation-count.mjs            # repo atual (default)
//   node scripts/check-mutation-count.mjs --staged   # o INDICE (o pre-commit)
//   node scripts/check-mutation-count.mjs --root X   # fixture (testes/mutation)
//   node scripts/check-mutation-count.mjs --json     # output JSON estruturado
//
// Exit codes:
//   0 — o nº derivado da matriz bate com todas as refs (pass)
//   1 — drift: alguma ref diverge do nº derivado (fail — mensagem com o par)
//   2 — infra: arquivo ausente/ilegível (fail-closed); `--staged` sem git (ou
//       sem índice legível) também é 2 — nunca um verde por não saber
//
// `--staged`: O CONTEÚDO DO ÍNDICE, NÃO O DA ÁRVORE.
//
// POR QUE ELE EXISTE (o defeito medido): o N da matriz e as refs dele (o
// summary e o comentário do job no pr-check.yml, o header do master, as refs do
// README e a contagem declarada na doc das metades) são UM NÚMERO em SEIS
// arquivos. Commitar a MATRIZ num commit e as REFS no seguinte abre a janela: o
// primeiro commit sozinho está INCONSISTENTE, e quem o aprova na forja (ou
// rebaseia em cima dele) recebe um CI vermelho por um número que o commit
// seguinte ia consertar — ou, pior, o `git rebase`/`cherry-pick` do primeiro
// sozinho leva um count partido para outro ramo. O hook não rodava este guard:
// a contagem podia ser partida em dois commits LOCAIS e o defeito só aparecia no
// CI. Aqui ele roda no índice, e o índice é o conteúdo do commit.
//
// O QUE ELE JULGA: o mesmo `run()` de sempre, sobre uma ÁRVORE DO ÍNDICE
// materializada em diretório temporário (`git show :path` de cada arquivo que o
// veredito lê: o master, as suítes que o master cita, o pr-check.yml, o README e
// a doc). NÃO julga o working tree — a diferença é de ESCOPO, e é o ponto.
//
// LIMITES DECLARADOS:
//   - arquivo que o veredito lê e NÃO está no índice é VIOLAÇÃO nomeada (nunca
//     "nada a julgar"): o caso real é a suíte nova do sub-test novo, escrita na
//     árvore e ainda não estagiada — o commit da matriz apontaria para um
//     arquivo que ele não carrega, e é exatamente isso que este recorte fecha;
//   - a RÉGUA das metades (`scripts/metades.mjs`) é lida da ÁRVORE, não do
//     índice: ela não é o que este recorte julga (a contagem é), e quem a julga
//     inteira são as duas pipelines;
//   - `git show :path` lê o índice do REPOSITÓRIO em que ele roda: fora de um
//     repositório git o modo sai 2 (fail-closed), nunca 0.
//
// POR QUE: o nº de sub-tests da matriz `scripts/test-mutation-guards.sh`
// (array SUBTESTS) é derivável e aparece em VÁRIOS lugares — o summary do job
// `mutation-guards` no pr-check.yml, o header do próprio master e 4 refs no
// README (tabelas de overhead). Cada bump de sub-test exigia atualizar TODOS
// manualmente — e o drift aconteceu de verdade (12→13 em 08/2026, corrigido à
// mão). Este guard deriva N do SUBTESTS e falha (exit 1) se QUALQUER ref viva
// divergir — o drift de counts vira erro de CI, não tarefa manual.
//
// O `name:` DO JOB É PROIBIDO DE CARREGAR O COUNT (e isso é metade do guard).
// O nome de um job é o CONTEXTO do status check na forja, e o branch protection
// exige esse contexto (`ci/required-checks.json`, aplicado por
// scripts/apply-required-checks.mjs). Enquanto o nome dizia
// "Mutation guards master (N node-pure mutation tests)", CADA bump da matriz
// reescrevia o contexto protegido: a proteção aplicada na forja passava a
// exigir um check que já não existe e o PR travava — um sub-test novo virava
// mudança de contrato de merge. O count é DIAGNÓSTICO e vive onde não é
// contrato: summary, comentário, header do master e README. Aqui o guard
// exige o nome EXATO e sem número.
//
// O QUE é derivado:
//   N = nº de entradas do array SUBTESTS=( ... ) no test-mutation-guards.sh
//       (cada linha "id|script" = 1 sub-test; linhas de comentário dentro do
//       array são ignoradas).
//
//   E, DESDE A DERIVAÇÃO DAS METADES, também:
//   - a FORMA das entradas: `id|script`, sem descrição. Um terceiro campo é a
//     prosa à mão renascendo — a descrição de cada sub-test é DERIVADA (ver
//     abaixo), e é por isso que acrescentar uma mutação não deixa o master
//     desatualizado em silêncio: não há texto do master para envelhecer;
//   - as METADES de cada suíte: o bloco `METADES=(...)` do PRÓPRIO script
//     granular (a régua vive em `scripts/metades.mjs`, a mesma que o master
//     chama para imprimir a descrição). Um sub-test cuja suíte não declara o
//     bloco é violação (fail-closed), e o mesmo vale para bloco vazio, linha
//     fora do formato `"id|descrição"` e id repetido;
//   - a DOC contra esse bloco: no parágrafo que cita a suíte, (a) a contagem
//     declarada na forma canônica (`em N direções`, `declara N metades`) tem de
//     bater com o número declarado — MUITA E VINTE E QUATRO estão no mapa da
//     régua, e uma contagem que ela não sabe ler vira violação, não omissão —
//     e (b) um id citado da MESMA FAMÍLIA dos declarados (`M25` num bloco que vai
//     até `M24`) tem de existir no bloco. LIMITE DECLARADO: a prosa fala de
//     SUBCONJUNTOS e de CONTROLES com as mesmas palavras ("as duas direções são
//     exigidas em cada rodada", "o controle H1"); a régua confere a forma da
//     DECLARAÇÃO do total e ignora o id de um controle, de propósito — cobrar
//     toda ocorrência daria falso positivo em texto correto.
//
// O QUE é validado (refs VIVAS — devem usar EXATAMENTE N, salvo o name):
//   1. pr-check.yml:
//      - name do job mutation-guards: "Mutation guards master" EXATO e SEM
//        número (o CONTEXTO do required check não pode depender do tamanho da
//        matriz; um count de volta = exit 1 apontando o acoplamento)
//      - summary: "All N node-pure mutation tests passed"
//      - comentário do job: "Roda os N mutation tests node-puro"
//   2. test-mutation-guards.sh (header): "Roda os N mutation tests node-puro"
//   3. README.md — TODA ocorrência de "<M> sub-tests" e "<M> sub-tests
//      node-puro" deve ter M == N, EXCETO refs HISTÓRICAS (linhas com
//      marcador de passado: "era de", "após a medição", "foi adicionado
//      após" — ex.: a nota de overhead cita "era de 5 sub-tests... depois
//      de 10" como histórico da medição, não como count atual).
//
//   4. O ATO QUE VERSIONA A MATRIZ (`docs/benchmarks/guard-timing-baseline.json`,
//      família `mutations`) — a defasagem que a PROSA sozinha não vê. Todo
//      sub-test do SUBTESTS tem de ter a FORMA dele no registro (a medição por
//      sub-test que o modelo de latência deriva), o count GRAVADO tem de ser o
//      da matriz e o número de formas tem de bater com ela; `measured` ≠ true
//      também acusa (não medido não é versionado). E a COLUNA de metades de cada
//      forma é julgada contra a UNIDADE QUE A MATRIZ DECLARA HOJE (`scripts/
//      metades.mjs`, a mesma leitura da doc): a coluna é DERIVADA da matriz, não
//      herdada do ato — uma unidade que entrou na suíte DEPOIS da medição deixa
//      a forma descrevendo a unidade anterior, e isso passa a ser violação
//      nomeada. O remédio sai no veredito: o ato `--only mutations --json
//      --baseline --merge` com a árvore JÁ COMMITADA (é ele que reescreve a
//      coluna a partir da matriz). NÃO julga a forma que SOBRA (ela existe até o
//      próximo ato, e sai listada como `sobrando` no relatório/JSON), nem a
//      coluna cuja suíte a derivação não conseguiu medir ("não medido" ≠ "zero
//      metades": listado em `metadesNaoMedidas`); o registro AUSENTE da árvore
//      sai declarado (`bench.present: false`) — e no recorte `--staged` o caminho
//      entra na materialização do índice, então o que o commit carrega é o que é
//      julgado.
//
// --json: { ok, derivedCount, derivedMetades, metades, bench, refs: { prCheck:
// [...] }, violations: [...] } — exit 0 mesmo com violações (modo report).
//
// CONTRATO DE FRASE: o guard exige a string EXATA "Roda os N mutation tests
// node-puro" no header do master E no comentário do job do pr-check.yml —
// renomear a frase (sem mudar o count) falha de propósito: é o texto que o
// guard ancora. Edite os DOIS juntos se precisar reformular.
// =============================================================================

import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { pathToFileURL } from "node:url"

import {
  BLOCO_README,
  DOCS,
  blocoDoTexto,
  divergencia,
  estadoDaMatriz,
  linhasDoBloco,
} from "./bench-table.mjs"
import { metadesDeclaradas } from "./metades.mjs"

// ── Helpers ────────────────────────────────────────────────────────────────

function readOrDie(root, rel) {
  const p = join(root, rel)
  if (!existsSync(p)) {
    const err = new Error(`arquivo ausente: ${rel}`)
    err.code = "INFRA"
    throw err
  }
  return readFileSync(p, "utf8")
}

/**
 * Deriva as ENTRADAS do array SUBTESTS do master: `id|script`, sem descrição.
 *
 * O campo de descrição NÃO pode voltar: ela é derivada do bloco METADES da
 * própria suíte, e uma entrada de três campos é a prosa à mão renascendo (o
 * texto que envelhecia em silêncio a cada mutação nova).
 *
 * @param {string} masterSrc
 * @returns {{count: number, ids: string[], entries: {id: string, script: string}[],
 *            comDescricao: {linha: number, id: string}[]}}
 */
export function deriveSubtestCount(masterSrc) {
  const start = masterSrc.indexOf("SUBTESTS=(")
  if (start === -1) {
    const err = new Error("array SUBTESTS=( não encontrado no master")
    err.code = "INFRA"
    throw err
  }
  const block = masterSrc.slice(start)
  const end = block.indexOf("\n)")
  const arrayBody = block.slice("SUBTESTS=(".length, end)
  const linhaBase = masterSrc.slice(0, start).split("\n").length

  const ids = []
  const entries = []
  const comDescricao = []
  for (const [i, rawLine] of arrayBody.split("\n").entries()) {
    // A FORMA ANTIGA (`id|descrição|script`) vem PRIMEIRO: o formato de 2 campos
    // casaria `Desc 0|scripts/...` como se fosse o caminho, e a prosa à mão
    // entraria como um script inexistente em vez de ser nomeada como ela é.
    const velho = rawLine.match(/^\s*"([^"|]+)\|([^"|]+)\|([^"]+)"\s*$/)
    if (velho) {
      ids.push(velho[1].trim())
      comDescricao.push({ id: velho[1].trim(), linha: linhaBase + i })
      entries.push({ id: velho[1].trim(), script: velho[3].trim() })
      continue
    }
    const m = rawLine.match(/^\s*"([^"|]+)\|([^"]+)"\s*$/)
    if (m) {
      ids.push(m[1].trim())
      entries.push({ id: m[1].trim(), script: m[2].trim() })
    }
  }
  return { count: ids.length, ids, entries, comDescricao }
}

/**
 * Os números por EXTENSO que a prosa da casa usa (1..40), para a contagem
 * escrita à mão na doc poder ser conferida contra o bloco da suíte.
 *
 * Só as formas que aparecem de verdade (`uma`, `três`, `vinte e quatro`) — e a
 * régua é FAIL-CLOSED no resto: uma contagem escrita de um jeito que este mapa
 * não conhece vira violação, nunca "conferido por omissão".
 */
const NUMEROS = {
  um: 1,
  uma: 1,
  dois: 2,
  duas: 2,
  tres: 3,
  três: 3,
  quatro: 4,
  cinco: 5,
  seis: 6,
  sete: 7,
  oito: 8,
  nove: 9,
  dez: 10,
  onze: 11,
  doze: 12,
  treze: 13,
  catorze: 14,
  quatorze: 14,
  quinze: 15,
  dezesseis: 16,
  dezassete: 17,
  dezessete: 17,
  dezoito: 18,
  dezenove: 19,
  vinte: 20,
  trinta: 30,
  quarenta: 40,
}

/** O número de uma frase por extenso: `vinte e quatro` → 24, `uma` → 1. */
function numeroPorExtenso(texto) {
  const t = texto.toLowerCase().replace(/\s+/g, " ".trim())
  const m = /^(\w+)(?: e (\w+))?$/.exec(t)
  if (m === null) return null
  const a = NUMEROS[m[1]]
  if (a === undefined) return null
  if (m[2] === undefined) return a
  const b = NUMEROS[m[2]]
  return b === undefined ? null : a + b
}

/**
 * A contagem declarada na prosa de um parágrafo: `24 metades`, `VINTE E QUATRO
 * direções`, `as três metades`, `DUAS mutações`.
 *
 * Devolve TODAS as ocorrências (para o veredito citar a linha) — o chamador
 * compara com o número de metades declaradas pelo bloco da suíte.
 *
 * A ÊNFASE DO MARKDOWN É RETIRADA ANTES DE LER (`**8 metades**`), e isso não é
 * cosmética: com o negrito no meio, a contagem escrita no documento saía do
 * alcance da régua e a prosa ficava VELHA EM SILÊNCIO — o laço MEDIDO: a doc
 * dizia `a suíte declara **8 metades**` com a suíte declarando dez, e o guard da
 * contagem passava verde. Uma contagem que a régua não lê é a mesma coisa que a
 * contagem que ninguém confere, e é justamente o que este guard veio fechar.
 *
 * @param {string} texto
 * @returns {{trecho: string, valor: number|null}[]}
 */
export function contagensNaProsa(texto) {
  const achados = []
  // `**negrito**` sai por inteiro (é a forma de DUAS marcas) e o `*`/`_` solto
  // que abre uma palavra sai com o espaço que vem antes — o que sobra é o texto
  // que o operador lê no documento, sem a marcação que o formatador inseriu.
  const limpo = String(texto ?? "")
    .replace(/\*\*/g, "")
    .replace(/(^|\s)[*_]/g, "$1")
  // O substantivo vai no PLURAL: é onde uma contagem mora (`DUAS metades`,
  // `VINTE E QUATRO direções`). O singular é determinante (`cada metade`, `uma
  // metade do arquivo`) e uma régua que o cobrasse produziria ruído em prosa
  // que não declara número nenhum.
  // A FORMA que a régua confere é a da DECLARAÇÃO do total da suíte —
  // `muta o guard em <N> direções`, `declara <N> metades`, `são <N> metades do
  // julgamento`. A prosa fala de SUBCONJUNTOS e de CONTROLES com as mesmas
  // palavras ("as duas direções são exigidas em cada rodada", "as DUAS metades
  // do M8/M14"), e uma régua que cobrasse toda ocorrência produziria falso
  // positivo em texto correto — o limite declarado desta metade do guard.
  const NUM = "([\\p{L}]+(?:\\s+e\\s+[\\p{L}]+)?|\\d{1,3})"
  const NOMES = "(metades|dire[çc][õo]es|muta[çc][õo]es)"
  const formas = [
    new RegExp(`\\bem\\s+${NUM}\\s+${NOMES}\\b`, "giu"),
    new RegExp(`\\b(?:declara|mede|tem|são|sao)\\s+${NUM}\\s+${NOMES}\\b`, "giu"),
  ]
  const vistos = new Set()
  for (const re of formas) {
    let m
    while ((m = re.exec(limpo)) !== null) {
      if (vistos.has(m[0])) continue
      vistos.add(m[0])
      const bruto = m[1].toLowerCase()
      const valor = /^\d+$/.test(bruto) ? Number(bruto) : numeroPorExtenso(bruto)
      if (valor === null && !QUANTIFICADORES_VAGOS.test(bruto)) continue
      achados.push({ trecho: m[0].replace(/\s+/g, " "), valor })
    }
  }
  return achados
}

/**
 * Quantificadores que a régua NÃO sabe ler e que prometem uma contagem — vago
 * numa prosa que declara cobertura é a contagem que ninguém confere.
 */
const QUANTIFICADORES_VAGOS =
  /^(muitas|muitos|v[aá]rias|v[aá]rios|poucas|poucos|todas|todos|algumas|alguns|dezenas|centenas)$/

/**
 * As FRASES de um parágrafo que CITAM a suíte (o nome do script granular).
 *
 * O count é conferido AQUI, não no parágrafo inteiro: a mesma prosa fala de
 * subconjuntos ("as QUATRO metades da invariante 18") e uma régua de parágrafo
 * cobraria o subconjunto como se fosse o total.
 */
function frasesQueCitam(paragrafo, arquivo) {
  return paragrafo.split(/(?<=[.!?])\s+|\n(?=[-*|#])/).filter((f) => f.includes(arquivo))
}

/** A FAMÍLIA de um id (`M22` → `M`): um id citado só é conferido na própria família. */
function familia(id) {
  return /^([A-Za-z]+)/.exec(id)?.[1] ?? id
}

/**
 * As METADES declaradas por cada suíte da matriz + a conferência da doc.
 *
 * Três regras, e todas são fail-closed:
 *   1. a suíte da matriz DECLARA as metades (`METADES=(...)` no próprio script);
 *   2. a contagem escrita na doc, no parágrafo que cita o script da suíte, bate
 *      com o número declarado (e uma contagem que a régua não sabe ler é
 *      violação, não omissão);
 *   3. um id citado na doc com a FAMÍLIA dos ids declarados existe no bloco.
 *
 * @param {string} root
 * @param {{id: string, script: string}[]} entries
 * @returns {{metades: {id: string, script: string, count: number, ids: string[]}[], violations: string[]}}
 */
function analisaMetades(root, entries) {
  const violations = []
  const metades = []
  const docs = ["docs/GUARDS.md", "README.md"]
  const textos = new Map()
  for (const rel of docs) {
    if (existsSync(join(root, rel))) textos.set(rel, readFileSync(join(root, rel), "utf8"))
  }

  for (const { id, script } of entries) {
    if (!existsSync(join(root, script))) {
      violations.push(`SUBTESTS: '${id}' aponta para ${script}, que não existe`)
      metades.push({ id, script, count: 0, ids: [] })
      continue
    }
    const declaradas = metadesDeclaradas(readFileSync(join(root, script), "utf8"))
    if (!declaradas.ok) {
      violations.push(
        `SUBTESTS:${id}: ${script} não DECLARA as metades — ${declaradas.motivo}. A descrição do sub-test e a prosa da doc derivam do bloco \`METADES=(...)\` da própria suíte (acrescentar uma mutação = UMA linha lá).`,
      )
      metades.push({ id, script, count: 0, ids: [] })
      continue
    }
    const ids = declaradas.metades.map((m) => m.id)
    metades.push({ id, script, count: ids.length, ids })

    const arquivo = script.split("/").pop()
    const familias = new Set(ids.map(familia))
    for (const [rel, texto] of textos) {
      const paragrafos = texto.split(/\n\s*\n/)
      let linha = 1
      for (const p of paragrafos) {
        const linhasDoParagrafo = p.split("\n").length
        if (p.includes(arquivo)) {
          const frases = frasesQueCitam(p, arquivo)
          for (const c of contagensNaProsa(frases.join(" "))) {
            if (c.valor === null) {
              violations.push(
                `${rel}:${linha}: a contagem '${c.trecho}' no parágrafo que cita ${arquivo} não é legível pela régua — escreva o número (ex.: '${ids.length} metades') ou uma forma que ela conheça; um count que ninguém confere é o que este guard veio fechar`,
              )
            } else if (c.valor !== ids.length) {
              violations.push(
                `${rel}:${linha}: '${c.trecho}' ≠ ${ids.length} — ${arquivo} declara ${ids.length} metade(s) (${ids.join(", ")}); a contagem escrita envelheceu quando a suíte mudou`,
              )
            }
          }
          // Um id citado num CONTROLE não é uma metade: a doc nomeia os dois
          // lados (a mutação e o controle que a cerca), e cobrar o controle
          // como se fosse metade seria falso positivo em prosa correta.
          const frasesDeId = frases.filter((f) => !/controle/i.test(f)).join(" ")
          for (const m of frasesDeId.matchAll(/\b([A-Z]{1,3}\d{1,2})\b/g)) {
            const citado = m[1]
            if (!familias.has(familia(citado))) continue
            if (!ids.includes(citado)) {
              violations.push(
                `${rel}:${linha}: a doc cita '${citado}', que ${arquivo} NÃO declara (declara: ${ids.join(", ")}) — ou a metade saiu da suíte e a prosa ficou, ou o id está errado`,
              )
            }
          }
        }
        linha += linhasDoParagrafo + 1
      }
    }
  }
  return { metades, violations }
}

/** True se a linha tem marcador de contexto HISTÓRICO (não é count atual). */
function isHistoricalLine(line) {
  return /era de\b|após a medição|foi adicionado após|medição de \d/.test(line)
}

/** Coleta refs vivas de count num texto: { lineNo, match, historical }[] */
function collectCountRefs(text, patterns, ignorar = []) {
  const refs = []
  const lines = text.split("\n")
  const dentro = (n) => ignorar.some(([i, f]) => n >= i && n <= f)
  for (let i = 0; i < lines.length; i++) {
    if (dentro(i + 1)) continue
    const line = lines[i]
    for (const pat of patterns) {
      const re = new RegExp(pat, "g")
      let m
      while ((m = re.exec(line)) !== null) {
        refs.push({
          lineNo: i + 1,
          number: Number(m[1]),
          match: m[0],
          historical: isHistoricalLine(line),
        })
      }
    }
  }
  return refs
}

// ── A MATRIZ × O ATO QUE A VERSIONA ───────────────────────────────────────

/** O REGISTRO VERSIONADO do custo da matriz — a família `mutations` do bench. */
export const BENCH_PATH = "docs/benchmarks/guard-timing-baseline.json"

/** A família cujas FORMAS são os sub-tests da matriz, um por um. */
export const BENCH_FAMILY = "mutations"

/** O ato que re-ancora a família (o remédio diz o comando inteiro). */
export const BENCH_ACT =
  "node scripts/bench-guard-timing.mjs --only mutations --json --baseline --merge"

/**
 * A MATRIZ de agora × o ATO que versiona o custo dela.
 *
 * POR QUE ESTA METADE EXISTE (a defasagem real, medida em 22/09/2026): a matriz
 * ganhou o `doc-hashes` e o `stack-per-commit` e o registro versionado
 * (`${BENCH_PATH}`, família `mutations`) seguiu com as 37 formas do ato anterior
 * — o número declarado do job `mutation-guards` (e o PISO do job `guards`, que a
 * ele se soma) passou a descrever uma matriz que já não existia, e NADA no
 * repositório olhava isso: o `check:mutation-count` cobrava o count na PROSA
 * (README, summary, header, doc), e a prosa pode estar toda certa enquanto o
 * ato — a única medição POR sub-test — ficou para trás. Aqui a ligação passa a
 * ser julgada: todo sub-test da matriz tem de ter a FORMA dele no ato, e o count
 * GRAVADO tem de ser o da matriz.
 *
 * A COLUNA DE METADES É DERIVADA DA MATRIZ, NÃO HERDADA DO ATO.
 *
 * Até 23/09/2026 a coluna era declarável como "a do ATO": ela saía da rodada que
 * mediu o custo, e uma unidade acrescentada à suíte DEPOIS daquela medição ficava
 * invisível — o registro dizia `8 metades` para uma suíte que já declarava dez, e
 * o número sobrevivia porque ninguém o comparava com a matriz. Aqui a coluna
 * passa a ser conferida contra a UNIDADE QUE A MATRIZ DECLARA HOJE (a mesma
 * `scripts/metades.mjs` que a doc e o master leem, por suíte citada): uma forma
 * cujo `metades` divergiu do declarado, ou que não declara número nenhum, é
 * violação nomeada — e o remédio é o ato, que reescreve a coluna a partir da
 * matriz.
 *
 * O QUE ELA NÃO JULGA (declarado, e de propósito):
 *   - a COBERTURA das metades (quais ids cada forma protege): o registro guarda a
 *     contagem por forma, não a lista — quem lista os ids é o bloco `METADES=(...)`
 *     da suíte, e é ele que a doc confere;
 *   - a forma que SOBRA (um sub-test que saiu da matriz e continua no registro):
 *     ela existe até o próximo ato, e é ele que a remove — o resultado a lista
 *     em `sobrando` para o relatório poder dizê-lo, sem virar violação;
 *   - o ARQUIVO ausente da árvore: aí não há ligação a julgar e o resultado sai
 *     com `present: false` (a ligação NÃO julgada fica DITA, nunca silenciosa).
 *     No recorte `--staged` o caminho entra na materialização do índice: se o
 *     commit carrega o registro, é o conteúdo DELE que é julgado.
 *
 * @param {unknown} bench conteúdo JÁ PARSEADO do arquivo do bench (null = ausente)
 * @param {string[]} ids os ids do `SUBTESTS` do master, na ordem da matriz
 * @param {{metades?: {id: string, count: number}[]}} [opts]
 *   `metades` é a derivação da MATRIZ (o que cada suíte da matriz declara hoje),
 *   como `analisaMetades` a calcula. Sem ela a coluna não é julgada (e o
 *   resultado DIZ que não foi, em `metadesJulgadas: false`) — ausência de
 *   derivação não pode virar "a coluna está certa".
 * @returns {{present: boolean, ok: boolean, versionados: string[], faltando: string[],
 *            sobrando: string[], gravado: number|null, motivo: string|null,
 *            metadesJulgadas: boolean, metadesDivergentes: {id: string, gravado: number|null, derivado: number}[],
 *            metadesNaoMedidas: string[], violations: string[]}}
 */
export function comparaComOAto(bench, ids, { metades = [] } = {}) {
  const nomes = Array.isArray(ids) ? ids.map((i) => String(i)) : []
  const derivadas = new Map(
    (Array.isArray(metades) ? metades : []).map((m) => [String(m.id), Number(m.count)]),
  )
  const metadesJulgadas = derivadas.size > 0
  if (bench === null || bench === undefined) {
    return {
      present: false,
      ok: true,
      versionados: [],
      faltando: [],
      sobrando: [],
      gravado: null,
      motivo: `o registro versionado (\`${BENCH_PATH}\`) não está nesta árvore — a ligação matriz ↔ ato NÃO foi julgada aqui`,
      metadesJulgadas: false,
      metadesDivergentes: [],
      metadesNaoMedidas: [],
      violations: [],
    }
  }
  const familia = bench?.[BENCH_FAMILY]
  if (familia === undefined || familia === null) {
    return {
      present: true,
      ok: false,
      versionados: [],
      faltando: [...nomes],
      sobrando: [],
      gravado: null,
      motivo: `sem a família \`${BENCH_FAMILY}\``,
      metadesJulgadas,
      metadesDivergentes: [],
      metadesNaoMedidas: [],
      violations: [
        `${BENCH_PATH}: o registro versionado do bench não tem a família \`${BENCH_FAMILY}\` — nenhum ato versionou o custo da matriz (sem ela, o ms por sub-test que o modelo de latência deriva não existe). Rode, com a árvore JÁ COMMITADA: \`${BENCH_ACT}\``,
      ],
    }
  }
  const forms = Array.isArray(familia.forms) ? familia.forms : []
  const versionados = [
    ...new Set(
      forms.map((f) => (typeof f?.role === "string" ? f.role.trim() : "")).filter(Boolean),
    ),
  ]
  const faltando = nomes.filter((id) => !versionados.includes(id))
  const sobrando = versionados.filter((id) => !nomes.includes(id))
  const gravado = Number.isFinite(familia.subtests) ? familia.subtests : null

  const violations = []
  if (familia.measured !== true) {
    violations.push(
      `${BENCH_PATH}: a família \`${BENCH_FAMILY}\` está no registro e NÃO foi medida (\`measured\` ≠ true) — "não medido" não é "versionado", e o custo do job ficaria sem a medição por sub-test. Rode, com a árvore JÁ COMMITADA: \`${BENCH_ACT}\``,
    )
  }
  if (faltando.length > 0) {
    violations.push(
      `${BENCH_PATH}: a matriz tem ${faltando.length} sub-test(s) que o ATO não versionou (${faltando.join(", ")}) — o registro segue com as formas do ato anterior, então o número declarado do job descreve uma matriz que já não existe. Rode, com a árvore JÁ COMMITADA: \`${BENCH_ACT}\``,
    )
  }
  if (gravado !== null && gravado !== nomes.length) {
    violations.push(
      `${BENCH_PATH}: a família \`${BENCH_FAMILY}\` GRAVOU ${gravado} sub-test(s) e a matriz tem ${nomes.length} — o count do ato envelheceu junto com as formas (rode o mesmo ato: \`${BENCH_ACT}\`)`,
    )
  }
  if (gravado !== null && forms.length !== nomes.length) {
    violations.push(
      `${BENCH_PATH}: a família \`${BENCH_FAMILY}\` tem ${forms.length} forma(s) e a matriz tem ${nomes.length} sub-test(s) — as formas e o count do ato têm de descrever a MESMA matriz (rode o mesmo ato: \`${BENCH_ACT}\`)`,
    )
  }

  // A COLUNA DE METADES, forma a forma, contra a UNIDADE QUE A MATRIZ DECLARA
  // HOJE. A comparação é por id (o `role` da forma é o id do sub-test no master),
  // e uma unidade acrescentada à suíte depois da medição cai aqui: a forma segue
  // dizendo o número antigo, e é isso que ninguém via.
  const metadesDivergentes = []
  const metadesNaoMedidas = []
  if (metadesJulgadas) {
    for (const form of forms) {
      const id = typeof form?.role === "string" ? form.role.trim() : ""
      if (!id || !derivadas.has(id)) continue
      const derivado = derivadas.get(id)
      // A derivação que NÃO conseguiu medir a suíte (ela sumiu da árvore, o bloco
      // `METADES` está ilegível) devolve 0 — e 0 não é "a matriz declara zero
      // metades", é "não medida". Acusar a coluna aqui seria acusar a leitura que
      // falhou; o guard já nomeia essa falta na metade das METADES, e o que fica
      // é DITO (`metadesNaoMedidas`) em vez de virar silêncio ou falso positivo.
      if (!(derivado > 0)) {
        metadesNaoMedidas.push(id)
        continue
      }
      const anotado = Number.isFinite(form?.metades) ? Number(form.metades) : null
      if (anotado === null || anotado <= 0) {
        metadesDivergentes.push({ id, gravado: anotado, derivado })
        violations.push(
          `${BENCH_PATH}: a forma '${id}' NÃO declara metades (a matriz declara ${derivado}) — o custo dela entra no job sem que o registro diga o que ela protege. Rode, com a árvore JÁ COMMITADA: \`${BENCH_ACT}\``,
        )
        continue
      }
      if (anotado !== derivado) {
        metadesDivergentes.push({ id, gravado: anotado, derivado })
        violations.push(
          `${BENCH_PATH}: a forma '${id}' GRAVOU ${anotado} metade(s) e a matriz declara ${derivado} — a coluna de metades é DERIVADA da matriz, não herdada do ato: uma unidade entrou na suíte depois daquela medição e o registro ficou descrevendo a unidade anterior (rode o mesmo ato: \`${BENCH_ACT}\`)`,
        )
      }
    }
    // O TOTAL da família × a COLUNA do MESMO registro: as duas leituras da mesma
    // medição têm de fechar. Contra a MATRIZ quem confere é a COLUNA, forma a
    // forma (acima), e a lista de faltantes — comparar o total com a soma da
    // derivação acusaria a forma que SOBRA (ela é tolerada até o próximo ato, e
    // as metades dela entram no total do registro).
    const totalFormas = forms.reduce(
      (s, f) => s + (Number.isFinite(f?.metades) ? Number(f.metades) : 0),
      0,
    )
    const totalFamilia = Number.isFinite(familia.metades) ? Number(familia.metades) : null
    if (totalFamilia !== null && totalFamilia !== totalFormas) {
      violations.push(
        `${BENCH_PATH}: a família \`${BENCH_FAMILY}\` GRAVOU ${totalFamilia} metade(s) e as formas dela somam ${totalFormas} — o total e a coluna do mesmo registro têm de descrever a MESMA medição (rode o mesmo ato: \`${BENCH_ACT}\`)`,
      )
    }
  }

  return {
    present: true,
    ok: violations.length === 0,
    versionados,
    faltando,
    sobrando,
    gravado,
    motivo: null,
    metadesJulgadas,
    metadesDivergentes,
    metadesNaoMedidas,
    violations,
  }
}

// ── Guard principal ────────────────────────────────────────────────────────

export function run(root) {
  const masterPath = "scripts/test-mutation-guards.sh"
  const workflowPath = ".github/workflows/pr-check.yml"
  const readmePath = "README.md"

  const masterSrc = readOrDie(root, masterPath)
  const workflowSrc = readOrDie(root, workflowPath)
  const readmeSrc = readOrDie(root, readmePath)

  const { count: N, entries, comDescricao } = deriveSubtestCount(masterSrc)

  const violations = []

  // 0. A DESCRIÇÃO NÃO VOLTA À MÃO. Um terceiro campo na entrada do SUBTESTS é
  //    a prosa que este guard veio aposentar: a descrição de cada sub-test é
  //    DERIVADA do bloco METADES da suíte (ver `descricao_de` no master).
  for (const e of comDescricao) {
    violations.push(
      `test-mutation-guards.sh:${e.linha}: a entrada '${e.id}' voltou a ter descrição escrita à mão (id|descrição|script) — a descrição do sub-test é DERIVADA do bloco METADES da própria suíte: use 'id|script'`,
    )
  }

  // 1. pr-check.yml — o NAME do job mutation-guards é o CONTEXTO do required
  //    check: tem de ser estável e COUNT-FREE.
  const contextName = "Mutation guards master"
  const nameMatch = /(?:^|\n)[ \t]*name:[ \t]*Mutation guards master([^\n]*)/.exec(workflowSrc)
  if (!nameMatch) {
    violations.push(
      `pr-check.yml: name do job 'mutation-guards' não é '${contextName}' — o CONTEXTO do required check mudou (aplique a proteção de novo: scripts/apply-required-checks.mjs) ou o job sumiu`,
    )
  } else {
    const sufixo = nameMatch[1].trim()
    if (sufixo !== "") {
      // Um número (ou qualquer sufixo) aqui re-acopla o tamanho da matriz ao
      // contrato de merge: o contexto protegido passa a mudar a cada bump.
      violations.push(
        `pr-check.yml: name do job 'mutation-guards' tem sufixo '${sufixo}' além de '${contextName}' — o CONTEXTO do required check é derivado do workflow; um count aqui faz o branch protection da forja apontar para um check inexistente a cada bump de matriz. O count vai no summary/comentário/header/README.`,
      )
    }
  }
  // summary do job
  const summaryRe = new RegExp(`All ${N} node-pure mutation tests passed`)
  if (!summaryRe.test(workflowSrc)) {
    violations.push(
      `pr-check.yml: summary do job não usa 'All ${N} node-pure mutation tests passed'`,
    )
  }
  // comentário do job
  const commentRe = new RegExp(`Roda os ${N} mutation tests node-puro`)
  if (!commentRe.test(workflowSrc)) {
    violations.push(
      `pr-check.yml: comentário do job não usa 'Roda os ${N} mutation tests node-puro'`,
    )
  }

  // 2. master (header) — "Roda os N mutation tests node-puro"
  if (!new RegExp(`Roda os ${N} mutation tests node-puro`).test(masterSrc)) {
    violations.push(
      `test-mutation-guards.sh: header não usa 'Roda os ${N} mutation tests node-puro'`,
    )
  }

  // 3. README.md — toda ocorrência viva deve ter M == N
  // Um padrão ÚNICO (sub-tests com opcional node-puro) evita ref duplicada por linha.
  // O bloco DERIVADO do README responde à DERIVAÇÃO (a regra 6), não a esta: o
  // número dele descreve a RODADA versionada, e a matriz pode ter sub-test que
  // o ato ainda não versionou — essa divergência é da matriz × o ato, e quem a
  // nomeia é a regra 5. Fora do bloco, a ref segue sendo do autor.
  const blocoDoReadme = blocoDoTexto(readmeSrc, BLOCO_README)
  const readmeRefs = collectCountRefs(
    readmeSrc,
    ["(\\d+) sub-tests( node-puro)?"],
    blocoDoReadme ? [[blocoDoReadme.linhaDoInicio, blocoDoReadme.linhaDoFim]] : [],
  )
  for (const ref of readmeRefs) {
    if (ref.number !== N && !ref.historical) {
      violations.push(`README.md:${ref.lineNo}: '${ref.match}' ≠ ${N} (ref viva divergente)`)
    }
  }
  // O README deve ter PELO MENOS uma ref viva com o count atual (prova que a
  // doc acompanha — sem nenhuma, o count sumiu da doc).
  if (!readmeRefs.some((r) => r.number === N && !r.historical)) {
    violations.push(`README.md: nenhuma ref viva com '${N} sub-tests' (a doc perdeu o count)`)
  }

  // 4. AS METADES DE CADA SUÍTE (a descrição derivada, e a doc conferida contra ela)
  const metades = analisaMetades(root, entries)
  violations.push(...metades.violations)

  // 5. A MATRIZ × O ATO QUE A VERSIONA (a defasagem que o count sozinho não vê).
  //    O registro é LIDO, não exigido: um fixture (ou um checkout sem o bench)
  //    não tem a ligação a julgar, e é o `present: false` que o diz.
  const bench = julgaOAto(root, N, idsDoMaster(masterSrc), metades.metades)
  violations.push(...bench.violations)

  // 6. AS DUAS PROSAS DERIVADAS — a TABELA por sub-test do GUARDS e o PARÁGRAFO
  //    de custo do README. A prosa declarava números que o registro não
  //    sustentava (medido: `524.0s`/`238 metades` na prosa contra os
  //    `404.9s`/`240 metades` do arquivo) e quem a reescrevia era o OPERADOR, a
  //    cada ato. Agora quem a reescreve é o ato (o `--baseline` chama o
  //    `escreverDocs`) e este guard a recusa quando ela divirge do registro —
  //    linha a linha, porque um número trocado à mão não muda a contagem.
  violations.push(...julgaAsProsas(root))

  return {
    ok: violations.length === 0,
    derivedCount: N,
    derivedMetades: metades.metades.reduce((s, m) => s + m.count, 0),
    metades: metades.metades,
    bench,
    refs: {
      prCheck: {
        context: contextName,
        summary: `All ${N} node-pure mutation tests passed`,
      },
      masterHeader: `Roda os ${N} mutation tests node-puro`,
      readmeLive: readmeRefs.filter((r) => !r.historical),
      readmeHistorical: readmeRefs.filter((r) => r.historical),
    },
    violations,
  }
}

/**
 * AS DUAS PROSAS DERIVADAS × o registro versionado (a tabela do GUARDS e o
 * parágrafo do README).
 *
 * O bloco tem de existir UMA vez entre os marcadores (fail-closed): um marcador
 * APAGADO ou DUPLICADO não é "nada a julgar" — é a prosa saindo do julgamento,
 * que é o defeito que esta regra existe para impedir. A divergência é nomeada
 * na LINHA do arquivo, com o renderizado e o vivo lado a lado: a régua é a
 * folha `scripts/bench-table.mjs`, e o remédio é o mesmo ato de sempre.
 *
 * @param {string} root
 * @returns {string[]}
 */
function julgaAsProsas(root) {
  const caminho = join(root, BENCH_PATH)
  // O registro é LIDO, não exigido — a mesma régua da regra 5: um fixture (ou um
  // checkout sem o bench) não tem prosa derivada a julgar. Sem o registro NÃO
  // existe o que a prosa declare; exigir o marcador aí seria julgar o nada.
  if (!existsSync(caminho)) return []
  let registro = null
  try {
    registro = JSON.parse(readFileSync(caminho, "utf8"))
  } catch {
    // A corrupção do registro é INFRA na regra 5 (fail-closed lá): aqui não
    // se inventa uma segunda opinião sobre o mesmo arquivo ilegível.
    return []
  }
  const estado = estadoDaMatriz(registro)
  const violations = []
  const curto = (t) => (t.length > 110 ? `${t.slice(0, 107)}...` : t)
  for (const { arquivo, bloco, render, nome } of DOCS) {
    const p = join(root, arquivo)
    // A doc das metades é o ÚNICO opcional da lista (`DOC_OPCIONAL`): ausente do
    // fixture = não haver o que julgar. O README não chega aqui ausente (o
    // `run()` o lê com `readOrDie`).
    if (!existsSync(p)) continue
    const vivo = blocoDoTexto(readFileSync(p, "utf8"), bloco)
    if (!vivo) {
      violations.push(
        `${arquivo}: o bloco de ${nome} não está entre os marcadores ('${bloco.abre}' … '${bloco.fecha}') — o bloco derivado existe UMA vez, e sem ele a prosa sai do julgamento`,
      )
      continue
    }
    const esperado = render(estado)
    if (esperado === null) {
      violations.push(
        `${arquivo}: ${nome} não pôde ser renderizado — a família 'mutations' não está medida no registro (${BENCH_PATH})`,
      )
      continue
    }
    const d = divergencia(vivo.conteudo, linhasDoBloco(esperado))
    if (d) {
      violations.push(
        `${arquivo}:${vivo.linhaDoInicio + d.linha}: ${nome} DIVERGE do registro versionado (${d.motivo}) — rode o mesmo ato: \`${BENCH_ACT}\`; renderizado: '${curto(d.esperado)}' · no arquivo: '${curto(d.vivo)}'`,
      )
    }
  }
  return violations
}

/**
 * O julgamento do ATO a partir da ÁRVORE julgada: lê o registro versionado (se
 * ele estiver lá) e entrega matriz e registro à régua pura.
 *
 * Um arquivo PRESENTE e ilegível é INFRA (exit 2): um registro corrompido não
 * pode virar "nenhuma ligação a julgar" — a ausência é declarada, a corrupção
 * não. É a mesma distinção do `readOrDie`.
 */
function julgaOAto(root, count, ids, metadesDaMatriz = []) {
  const caminho = join(root, BENCH_PATH)
  if (!existsSync(caminho)) return comparaComOAto(null, ids, { metades: metadesDaMatriz })
  let json
  try {
    json = JSON.parse(readFileSync(caminho, "utf8"))
  } catch (e) {
    const err = new Error(`${BENCH_PATH} ilegível: ${e.message}`)
    err.code = "INFRA"
    throw err
  }
  const resultado = comparaComOAto(json, ids, { metades: metadesDaMatriz })
  // O `count` derivado entra na mensagem de quem lê o relatório: a régua pura
  // trabalha com os IDS (é deles que a comparação é feita).
  return { ...resultado, derivedCount: count }
}

/** Os ids do SUBTESTS — derivados uma vez, para a régua do ato. */
function idsDoMaster(masterSrc) {
  return deriveSubtestCount(masterSrc).ids
}

// ── O MODO --staged (a ÁRVORE DO ÍNDICE) ──────────────────────────────────

/** O master — a fonte das ENTRIES e do N (é dele que saem os outros caminhos). */
const MASTER = "scripts/test-mutation-guards.sh"

/**
 * O conteúdo de UM arquivo no ÍNDICE (`git show :path`) — o que o COMMIT vai
 * conter. Devolve `null` quando o arquivo NÃO está no índice (com o motivo),
 * porque as duas situações são diferentes: ``ilegível'' (infra) e ``não faz
 * parte do commit'' (o defeito que este modo existe para pegar).
 *
 * @param {string} root
 * @param {string} rel
 * @returns {{ok: true, conteudo: string} | {ok: false, motivo: string}}
 */
export function lerDoIndice(root, rel) {
  try {
    const conteudo = execFileSync("git", ["show", `:${rel}`], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    })
    return { ok: true, conteudo }
  } catch (e) {
    const stderr = String(e?.stderr ?? "")
      .trim()
      .split("\n")
      .pop()
    return { ok: false, motivo: stderr === "" ? `git show :${rel} falhou` : stderr }
  }
}

/**
 * Os caminhos que o VEREDITO lê: o master, o pr-check.yml, o README, a doc das
 * metades e CADA suíte que o master cita. Derivados (nunca uma lista à mão): a
 * suíte nova de um sub-test novo entra na materialização no mesmo commit em que
 * entra na matriz.
 *
 * A DOC (`docs/GUARDS.md`) é o ÚNICO opcional da lista, e pela mesma régua do
 * `run()`: ele a lê com `existsSync` (o fixture mínimo não tem doc). Ausente do
 * ÍNDICE = ausente da árvore, e o veredito segue — o resto da lista é obrigatório.
 *
 * @param {string} masterSrc conteúdo do master (do ÍNDICE)
 * @returns {string[]}
 */
export const DOC_OPCIONAL = "docs/GUARDS.md"

/**
 * Os caminhos que o recorte `--staged` materializa mas NÃO exige: os que o
 * veredito lê com `existsSync` (a doc das metades e o registro do ato). Ausente
 * do índice = ausente da árvore (não há veredito a dar sobre ele), e o `run()`
 * o DIZ (`present: false` / sem doc) em vez de o inventar.
 */
export const CAMINHOS_OPCIONAIS = [DOC_OPCIONAL, BENCH_PATH]

/**
 * @param {string} masterSrc
 * @returns {string[]}
 */
export function caminhosDoVeredito(masterSrc) {
  const { entries } = deriveSubtestCount(masterSrc)
  const rels = [MASTER, ".github/workflows/pr-check.yml", "README.md", ...CAMINHOS_OPCIONAIS]
  for (const { script } of entries) if (!rels.includes(script)) rels.push(script)
  return rels
}

/**
 * O JULGAMENTO DO ÍNDICE: materializa a ÁRVORE DO ÍNDICE (o master, as suítes
 * que ele cita, o pr-check.yml, o README e a doc) num diretório temporário e roda
 * o MESMO `run()` sobre ela. O working tree não entra: o que se julga é o que o
 * commit vai conter.
 *
 * Um caminho que o veredito lê e NÃO está no índice é VIOLAÇÃO nomeada — nunca
 * "nada a julgar": o caso real é a suíte nova escrita na árvore e ainda não
 * estagiada, e o commit da matriz apontaria para um arquivo que ele não carrega.
 *
 * @param {string} root
 * @param {{ler?: (root: string, rel: string) => {ok: true, conteudo: string} | {ok: false, motivo: string}}} [opts]
 *   `ler` é injetável para o teste medir a orquestração sem um repositório git.
 * @returns {ReturnType<typeof run> & {indice: string, ausentesNoIndice: string[]}}
 */
export function runStaged(root, { ler = lerDoIndice } = {}) {
  const master = ler(root, MASTER)
  if (!master.ok) {
    const err = new Error(`não consegui ler o master ${MASTER} do índice — ${master.motivo}`)
    err.code = "INFRA"
    throw err
  }

  const rels = caminhosDoVeredito(master.conteudo)
  const dir = mkdtempSync(join(tmpdir(), "mutation-count-indice-"))
  const ausentes = []
  try {
    for (const rel of rels) {
      // O master JÁ foi lido (e é ele que decide a lista): não gasta outro
      // `git show` no mesmo blob.
      const r = rel === MASTER ? master : ler(root, rel)
      if (!r.ok) {
        // O caminho OPCIONAL ausente do índice é o ausente da árvore (o `run()`
        // o lê com existsSync): não é violação, é não haver o que conferir.
        if (CAMINHOS_OPCIONAIS.includes(rel)) continue
        ausentes.push(`${rel}: ${r.motivo}`)
        continue
      }
      const destino = join(dir, rel)
      mkdirSync(dirname(destino), { recursive: true })
      writeFileSync(destino, r.conteudo)
    }
    const result = run(dir)
    const violacoes = [...result.violations]
    for (const a of ausentes) {
      violacoes.push(
        `o veredito lê '${a.split(":")[0]}' e o ÍNDICE não o tem (${a.split(":").slice(1).join(":").trim()}) — o COMMIT apontaria para um arquivo que ele não carrega: estague-o junto ('git add') ou tire a referência`,
      )
    }
    return {
      ...result,
      ok: violacoes.length === 0,
      violations: violacoes,
      indice: dir,
      ausentesNoIndice: ausentes,
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// ── CLI ────────────────────────────────────────────────────────────────────

function main() {
  const argv = process.argv.slice(2)
  let root = process.cwd()
  let json = false
  let staged = false

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--root") {
      root = resolve(argv[++i])
    } else if (argv[i] === "--json") {
      json = true
    } else if (argv[i] === "--staged") {
      staged = true
    } else {
      console.error(`flag desconhecida: ${argv[i]} (use --staged | --root X | --json)`)
      process.exit(2)
    }
  }

  const escopo = staged ? "no ÍNDICE" : "na árvore"

  let result
  try {
    result = staged ? runStaged(root) : run(root)
  } catch (e) {
    console.error(`❌ check-mutation-count: ${e.message}`)
    process.exit(2)
  }

  if (json) {
    console.log(JSON.stringify(result, null, 2))
    process.exit(0)
  }

  // O ATO entra no veredito VERDE também: "as refs batem" não diz que a matriz
  // está versionada, e é a diferença entre os dois que este guard veio fechar
  // (a prosa pode estar toda certa com o registro do ato descrevendo a matriz
  // anterior).
  const ato = result.bench?.present
    ? ` O ATO versionou a matriz: ${result.bench.versionados.length} forma(s) na família \`${BENCH_FAMILY}\` de ${BENCH_PATH}${result.bench.sobrando.length > 0 ? ` — fora da matriz (até o próximo ato): ${result.bench.sobrando.join(", ")}` : ""}.`
    : ` ⚠️ a ligação matriz ↔ ato NÃO foi julgada aqui: ${result.bench?.motivo}`

  if (result.ok) {
    console.log(
      `✅ check-mutation-count: ${result.derivedCount} sub-tests da matriz (${result.derivedMetades} metades declaradas) ${escopo} — pr-check.yml, master, README e a doc das metades consistentes.${ato}`,
    )
    process.exit(0)
  }

  console.error(
    `❌ check-mutation-count: drift de count/metades ${escopo} (derivado=${result.derivedCount} sub-tests, ${result.derivedMetades} metades) — refs divergentes:`,
  )
  for (const v of result.violations) console.error(`   - ${v}`)
  process.exit(1)
}

const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (IS_DIRECT_RUN) main()
