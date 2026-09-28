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
//   5. OS ORDINAIS DA MATRIZ — a suíte identificada pela POSIÇÃO na prosa, em
//      TODAS as formas que a afirmam: ancoradas em `da matriz` / `do master` /
//      `de número N` (e as mesmas POR EXTENSO, `a quadragésima entrada da
//      matriz`) e a forma NUA (`a 42.ª entrada`), que é julgada só com o
//      CONTEXTO da matriz na frase e nunca quando ela narra um ATO PASSADO (a
//      classe declarada de `marcadorDeAtoPassado` — data explícita, `naquela
//      rodada`, `entrou na matriz`, `era`, `medido em`, `custava`…). As duas
//      grafias afirmam o mesmo número, e todas envelhecem igual: o que a régua
//      PULA sai dito no relatório (`historico` / `foraDeEscopo` /
//      `blocoDerivado`). E o PULO é DECLARADO e travado: a doc carrega a linha
//      `**A régua do ordinal: N referência(s) JULGADA(S) e M PULADA(S)**`, o
//      veredito verde publica os dois números (o `--json` em
//      `ordinaisCobertura`) e o pulo medido tem de ser IGUAL ao declarado nas
//      DUAS direções — subir é a cobertura PIORANDO (a mensagem nomeia a
//      referência e a classe), descer é o teto que ENVELHECEU e a declaração
//      tem de BAIXAR junto (é a igualdade que faz o pulo só poder DIMINUIR). As
//      JULGADAS são um PISO: a régua pode julgar mais e não pode julgar menos
//      sem que a perda esteja numa decisão. O
//      número tem de bater com a ordem REAL do SUBTESTS, e a referência tem de
//      NOMEAR a suíte (o `id` entre crases ou o caminho do script) na MESMA
//      frase — um ordinal sem a suíte ao lado é VIOLAÇÃO, nunca omissão: é o
//      número que ninguém confere, e ele envelhece quando uma entrada nasce
//      ANTES (o caso medido: a `stack-per-commit` era a 38.ª e é a 40.ª). O
//      escopo é a posição de HOJE — as ordens do histórico de custo do README
//      (o tamanho da matriz daquele ato) não trazem o `da matriz`.
//      A PROSA julgada é DERIVADA (o README mais todos os `.md` da árvore de
//      docs, recursivo): uma referência num terceiro doc era invisível enquanto
//      o escopo era um par escrito no fonte, e o que a régua não lê envelhece
//      igual ao que ela lê.
//
// --json: { ok, derivedCount, derivedMetades, metades, prova, ordinais,
// ordinaisCobertura, bench, refs: { prCheck: [...] }, violations: [...] } — exit
// 0 mesmo com violações (modo report).
//
// CONTRATO DE FRASE: o guard exige a string EXATA "Roda os N mutation tests
// node-puro" no header do master E no comentário do job do pr-check.yml —
// renomear a frase (sem mudar o count) falha de propósito: é o texto que o
// guard ancora. Edite os DOIS juntos se precisar reformular.
// =============================================================================

import { execFileSync } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
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

// ── OS ORDINAIS DA MATRIZ (a suíte identificada pela POSIÇÃO) ─────────────

/**
 * OS ORDINAIS POR EXTENSO que a prosa usa — normalizados (minúsculos, sem
 * acento). O masculino e o feminino são chaves DISTINTAS porque a palavra é o que
 * está ESCRITO (`quadragésimo` e `quadragésima` são a MESMA posição), e a prosa
 * do repositório escreve as duas formas (`decima` sem acento inclusive).
 *
 * Unidades, dezenas e a centena: é o que a prosa precisa para escrever uma
 * posição desta matriz (47 entradas hoje, e as dezenas compostas saem da soma de
 * duas palavras — `quadragésima primeira`).
 */
const PALAVRAS_ORDINAIS = new Map([
  ["primeiro", 1],
  ["primeira", 1],
  ["segundo", 2],
  ["segunda", 2],
  ["terceiro", 3],
  ["terceira", 3],
  ["quarto", 4],
  ["quarta", 4],
  ["quinto", 5],
  ["quinta", 5],
  ["sexto", 6],
  ["sexta", 6],
  ["setimo", 7],
  ["setima", 7],
  ["oitavo", 8],
  ["oitava", 8],
  ["nono", 9],
  ["nona", 9],
  ["decimo", 10],
  ["decima", 10],
  ["vigesimo", 20],
  ["vigesima", 20],
  ["trigesimo", 30],
  ["trigesima", 30],
  ["quadragesimo", 40],
  ["quadragesima", 40],
  ["quinquagesimo", 50],
  ["quinquagesima", 50],
  ["sexagesimo", 60],
  ["sexagesima", 60],
  ["septuagesimo", 70],
  ["septuagesima", 70],
  ["octogesimo", 80],
  ["octogesima", 80],
  ["nonagesimo", 90],
  ["nonagesima", 90],
  ["centesimo", 100],
  ["centesima", 100],
])

/** Sem acento, minúsculo: é a forma em que as duas grafias coincidem. */
function semAcento(texto) {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
}

/**
 * OS MARCADORES DE UM ATO PASSADO — a classe DECLARADA que separa a posição de
 * hoje da ordem de um momento. São marcas de TEMPO ou de MOVIMENTO na matriz, e
 * não adjetivos soltos: uma DATA explícita, `naquela rodada`, `no ato de`,
 * `entrou na/na matriz`, `era/eram`, `medido em`, `custava`, `ganhou a`,
 * `passou de`, `deixou de ser`. A frase que os carrega está narrando um ato — a
 * matriz daquele ato não é a de hoje, e conferir o número contra ela seria a
 * acusação ao que não foi medido.
 *
 * A LISTA É DECLARADA, e o que ela pula sai NOMEADO no relatório: se um marcador
 * for largo demais, isso aparece como uma referência `historico` que não devia
 * ser, e não como um número que ninguém confere.
 */
const MARCADORES_DE_ATO_PASSADO = [
  ["uma data explícita", /\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2}/],
  [
    "'naquela rodada'/'no ato de'",
    /naquela rodada|naquele ato|no ato de|num ato de|numa rodada de/,
  ],
  ["'entrou' na matriz", /entrou (na|como)|quando entrou/],
  ["o verbo no passado ('era')", /\bera\b|\beram\b/],
  ["'medido em'/'custava'", /medi[do]a? em|custava/],
  ["'ganhou a'/'passou de'/'deixou de'", /ganhou a|passou de|deixou de ser/],
]

/**
 * O marcador de ATO PASSADO da frase, ou `null` se ela fala da posição de hoje.
 *
 * @param {string} frase
 * @returns {string | null}
 */
export function marcadorDeAtoPassado(frase) {
  for (const [nome, re] of MARCADORES_DE_ATO_PASSADO) if (re.test(frase)) return nome
  return null
}

/**
 * O NÚMERO de um ordinal escrito por extenso (`quadragésima primeira` → 41), ou
 * `null` quando o trecho NÃO é um ordinal composto válido.
 *
 * A forma composta é DEZENA + UNIDADE (`trigésima oitava` = 38, `quadragésima
 * primeira` = 41); duas dezenas seguidas (`vigésima trigésima`) não são um ordinal
 * e caem no `null` — o trecho que não é ordinal não é referência nenhuma, e
 * inventar um número ali seria acusar a prosa que não fala de posição.
 *
 * @param {string} trecho
 * @returns {number | null}
 */
export function ordinalDeExtenso(trecho) {
  const palavras = semAcento(trecho).split(/\s+/).filter(Boolean)
  // O ARTIGO da frente (`a quadragésima`, `o quadragésimo`) faz parte da frase,
  // não do número: a janela do casamento o captura junto com o ordinal.
  if (palavras[0] === "a" || palavras[0] === "o") palavras.shift()
  if (palavras.length === 0 || palavras.length > 2) return null
  const valores = palavras.map((p) => PALAVRAS_ORDINAIS.get(p))
  if (valores.some((v) => v === undefined)) return null
  if (valores.length === 1) return valores[0]
  const [dezena, unidade] = valores
  if (dezena >= 10 && dezena % 10 === 0 && unidade >= 1 && unidade <= 9) return dezena + unidade
  return null
}

/**
 * O ORDINAL da suíte × a ORDEM real do `SUBTESTS` (a posição de HOJE).
 *
 * O DEFEITO MEDIDO (27/09/2026): a prosa identifica uma suíte pela POSIÇÃO que
 * ela ocupa na matriz (`a 38.ª entrada da matriz`, `a 40.ª sub-test da matriz`),
 * e a posição NÃO é um identificador estável — cada entrada inserida ANTES
 * empurra o número de todas as seguintes. A `stack-per-commit` era a 38.ª quando
 * a doc a escreveu e é a 40.ª hoje, e a prosa seguiu dizendo 38, apontando para a
 * suíte errada: o count derivado não vê posição, e o drift passou em silêncio.
 *
 * A RÉGUA: uma referência posicional tem de bater com a POSIÇÃO (1-based) do id
 * que a PRÓPRIA FRASE nomeia (o `id` entre crases ou o caminho do script). As
 * FORMAS que ela lê:
 *   · ANCORADAS — `<N>ª entrada da matriz` / `<N>ª sub-test da matriz` / `<N>ª da
 *     matriz` / `<N>ª … do master` / `a suíte de número N`, e as mesmas escritas
 *     POR EXTENSO (`a quadragésima entrada da matriz`). A âncora é a afirmação
 *     da posição de HOJE: quem a escreve está falando da matriz de agora;
 *   · NUA — `<N>ª entrada` / `<N>ª sub-test` sem âncora: julgada só quando a
 *     MESMA frase traz o CONTEXTO da matriz (senão o número é de outra lista) e
 *     não é um ATO PASSADO (a classe declarada de `marcadorDeAtoPassado`).
 * O que a régua pula, ela DIZ no relatório (`historico: <marcador>` ou
 * `foraDeEscopo: true`), porque um número que ninguém confere é assim que ele
 * envelhece — e o que sai do escopo é uma DECISÃO, nunca uma omissão. E ela é
 * FAIL-CLOSED na direção que o defeito exige: uma referência posicional JULGADA
 * que NÃO nomeia a suíte é VIOLAÇÃO, não omissão.
 *
 * O EXTENSO NÃO É UMA RÉGUA À PARTE: a posição escrita em palavras envelhece
 * IGUAL (`a quadragésima` deixa de ser a mesma suíte no dia em que uma entrada
 * nasce antes), e uma forma que o guard não lesse seria o lugar onde o número
 * errado passa — a régua lê as duas grafias e confere o MESMO número.
 *
 * O ESCOPO: as menções que identificam a suíte na matriz de HOJE. As ordens do
 * histórico de custo do README (`a 33ª custando 9.0s`, num ato de 33 sub-tests)
 * descrevem o TAMANHO da matriz daquele ato — são instantâneos do momento, não a
 * posição de agora, e por isso não trazem o `da matriz` que esta régua ancora.
 *
 * A prosa é hard-wrapped e a linha NÃO é a unidade: uma referência partida
 * (`42ª entrada da\nmatriz`) tem de ser lida como uma frase, então o texto é
 * NORMALIZADO (a quebra vira espaço) e a janela de conferência é a FRASE — o id
 * no parágrafo inteiro validaria por engano um número citado longe dele.
 *
 * O ESCOPO É DERIVADO, NUNCA UMA DUPLA À MÃO: a prosa julgada é a ÁRVORE DE
 * DOCS (todos os `.md` sob `docs/`, recursivo) mais o README. Enquanto era um par
 * escrito no fonte (`docs/GUARDS.md` e `README.md`), uma referência posicional
 * num TERCEIRO doc era invisível — e uma referência que a régua não lê
 * envelhece exatamente como a que ela lê: em silêncio. Com a varredura, o doc
 * novo entra na régua sozinho.
 *
 * A COBERTURA SAI JUNTO, e é ela que a declaração da doc trava (a regra 4d):
 * quantas referências foram JULGADAS e quantas foram PULADAS, com a classe de
 * cada pulo. Uma régua que pula não tem como impedir que uma referência nova caia
 * no pulo — mas o número do pulo é CONFERÍVEL, e é isso que transforma "a régua
 * encolheu" em vermelho em vez de silêncio.
 *
 * @param {string} root
 * @param {{id: string, script: string}[]} entries
 * @returns {{refs: {arquivo: string, linha: number, ordinal: number, citada: string, candidatos: string[], forma: string, historico?: string, foraDeEscopo?: boolean, blocoDerivado?: boolean}[], cobertura: {julgadas: number, puladas: number, porClasse: {historico: number, foraDeEscopo: number, blocoDerivado: number}}, violations: string[]}}
 */
/**
 * A PROSA que a régua do ordinal lê: o README e TODOS os `.md` da árvore de
 * docs (recursivo) — ordenados, para o relatório ser estável.
 *
 * Diretório oculto e `node_modules` ficam de fora (scratch e dependência não são
 * a prosa do repositório), e o MESMO conjunto é o que o recorte `--staged`
 * materializa — a régua lê o que o commit carrega, doc a doc.
 *
 * @param {string} root
 * @returns {string[]} caminhos relativos à raiz
 */
export function docsDaProsa(root) {
  const rels = ["README.md"]
  const dir = join(root, "docs")
  const anda = (d) => {
    if (!existsSync(d)) return
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith(".") || e.name === "node_modules") continue
      const p = join(d, e.name)
      if (e.isDirectory()) anda(p)
      else if (e.name.endsWith(".md")) rels.push(relative(root, p))
    }
  }
  anda(dir)
  return rels.sort()
}

export function analisaOrdinais(root, entries) {
  const posicao = new Map(entries.map((e, i) => [e.id, i + 1]))
  const idDoScript = new Map(entries.map((e) => [e.script, e.id]))
  const docs = docsDaProsa(root)
  // AS ÂNCORAS DA POSIÇÃO DE HOJE. O `da matriz` é a matriz de hoje; o
  // `do master` também (o master É a matriz), e o `de número` afirma a posição
  // sem rodeio (`a suíte de número 38`). Quem carrega uma âncora está afirmando a
  // posição de AGORA — a ordem de um ato do PASSADO se narra contando o TAMANHO
  // daquele ato, e não traz âncora nenhuma (o histórico de custo do README).
  const ANCORA_MATRIZ = "entrada\\s+da\\s+matriz|sub-tests?\\s+da\\s+matriz|da\\s+matriz"
  const ANCORA_MASTER = "entrada\\s+do\\s+master|sub-tests?\\s+do\\s+master|do\\s+master"
  const ORDINAL_ANCORADO = new RegExp(
    `(\\d{1,3})\\s*\\.?ª\\s+(?:${ANCORA_MATRIZ}|${ANCORA_MASTER})\\b`,
    "gi",
  )
  const ORDINAL_DE_NUMERO = /(?:entrada|sub-tests?|suíte|forma)\s+de\s+n[úu]mero\s+(\d{1,3})\b/gi
  // A FORMA NUA — `a 42.ª entrada`, sem âncora nenhuma. Ela NÃO é julgada por
  // si: a referência só é conferível quando a MESMA frase traz o CONTEXTO da
  // matriz (senão o número é de outra lista qualquer) e não é um ATO PASSADO
  // (classe declarada abaixo). Quando ela é julgada, é com a régua de sempre — e
  // sem o contexto, ou num passado, ela sai DITA no relatório, nunca em silêncio.
  const ORDINAL_NU = /(\d{1,3})\s*\.?ª\s+(?:entrada|sub-tests?|suíte|forma)\b/gi
  const CONTEXTO_DA_MATRIZ = /matriz|SUBTESTS|do master|da régua|mutation tests|mutation-count/i
  // A MESMA referência escrita POR EXTENSO: uma ou duas palavras antes da âncora
  // (`quadragésima primeira entrada da matriz`). Quem decide se o trecho é um
  // ordinal é o `ordinalDeExtenso` — a regex é só a JANELA, e uma palavra que
  // não seja ordinal (`a última metade da matriz`) cai fora ali.
  const REF_EXTENSO = new RegExp(
    `([A-Za-zÀ-ÿ]+(?:\\s+[A-Za-zÀ-ÿ]+)?)\\s+(?:${ANCORA_MATRIZ}|${ANCORA_MASTER})\\b`,
    "gi",
  )
  const refs = []
  const violations = []
  // A COBERTURA: o que a régua JULGA e o que ela PULA (por classe). O pulo é a
  // única parte da régua que cresce sem ninguém decidir — e é por isso que ele é
  // contado aqui e declarado na doc (a regra 4d).
  const cobertura = {
    julgadas: 0,
    puladas: 0,
    porClasse: { historico: 0, foraDeEscopo: 0, blocoDerivado: 0 },
  }

  for (const rel of docs) {
    const p = join(root, rel)
    if (!existsSync(p)) continue
    const texto = readFileSync(p, "utf8")
    // Os BLOCOS DERIVADOS ficam FORA: a régua deles é a da derivação (regra 6) e
    // o ato os reescreve — cobrá-los aqui seria uma segunda opinião sobre a mesma
    // prosa.
    // A lista dos blocos derivados vem de `DOCS` (a fonte única da folha): cada
    // um diz o ARQUIVO e o par de marcadores, e aqui se usa a parte do arquivo.
    const blocos = []
    for (const { arquivo, bloco: marcadores } of DOCS) {
      if (arquivo !== rel) continue
      const bloco = blocoDoTexto(texto, marcadores)
      if (bloco) blocos.push([bloco.linhaDoInicio, bloco.linhaDoFim])
    }
    const dentroDoBloco = (n) => blocos.some(([i, f]) => n >= i && n <= f)

    // O texto NORMALIZADO (a quebra de linha vira espaço) com o mapa de
    // offset → linha, para a mensagem apontar a linha ORIGINAL da referência.
    const linhas = texto.split("\n")
    let norm = ""
    const inicios = []
    for (const [i, l] of linhas.entries()) {
      inicios.push(norm.length)
      norm += `${l}\n`
    }
    // A ÊNFASE sai SEM MUDAR O COMPRIMENTO (`**` vira dois espaços): `**40.ª**
    // da matriz` é uma referência quebrada pela marcação de negrito, e manter os
    // offsets é o que permite usar o ÍNDICE do casamento sobre o texto SEM os
    // `*` e ainda assim achar a linha original exata.
    const limpo = norm.replace(/\*\*/g, "  ")
    const linhaDe = (idx) => {
      let lo = 0
      let hi = inicios.length - 1
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2)
        if (inicios[mid] <= idx) lo = mid
        else hi = mid - 1
      }
      return lo + 1
    }
    // A FRASE que contém a referência — os limites saem da pontuação (`[.!?]`
    // seguida de espaço ou do fim).
    const fraseEm = (idx) => {
      let ini = 0
      for (let i = idx - 1; i > 0; i--) {
        if (/[.!?]/.test(limpo[i]) && /\s/.test(limpo[i + 1])) {
          ini = i + 1
          break
        }
      }
      let fim = limpo.length
      for (let i = idx; i < limpo.length; i++) {
        if (/[.!?]/.test(limpo[i]) && (i + 1 >= limpo.length || /\s/.test(limpo[i + 1]))) {
          fim = i + 1
          break
        }
      }
      return limpo.slice(ini, fim)
    }

    // As GRAFIAS e as FORMAS viram o MESMO casamento (a posição e o número que
    // ele afirma), e a conferência é UMA só: o que muda entre `<N>ª`, o extenso
    // e a forma nua é como a prosa escreve o número, não a régua que o julga.
    // A ORDEM da coleta é a precedência: a forma ANCORADA reivindica o índice
    // (`40.ª entrada da matriz` também casa a forma nua), e a nua só pega o que
    // sobrou — uma referência, um casamento.
    const casamentos = []
    const jaVisto = new Set()
    const coleta = (re, forma) => {
      re.lastIndex = 0
      let m
      while ((m = re.exec(limpo)) !== null) {
        if (jaVisto.has(m.index)) continue
        jaVisto.add(m.index)
        casamentos.push({ idx: m.index, ordinal: Number(m[1]), citada: m[0], forma })
      }
    }
    coleta(ORDINAL_ANCORADO, "ancorada")
    coleta(ORDINAL_DE_NUMERO, "de-numero")
    coleta(ORDINAL_NU, "nua")
    REF_EXTENSO.lastIndex = 0
    let m
    while ((m = REF_EXTENSO.exec(limpo)) !== null) {
      const ordinal = ordinalDeExtenso(m[1])
      if (ordinal === null) continue
      if (jaVisto.has(m.index)) continue
      jaVisto.add(m.index)
      casamentos.push({ idx: m.index, ordinal, citada: m[0], forma: "ancorada" })
    }
    casamentos.sort((a, b) => a.idx - b.idx)

    for (const { idx, ordinal, citada, forma } of casamentos) {
      const linha = linhaDe(idx)
      const frase = fraseEm(idx)
      // Os CANDIDATOS: as suítes que a própria frase nomeia — o `id` entre crases
      // ou o caminho do script dela. É assim que a régua sabe DE QUEM é o número.
      const candidatos = []
      for (const c of frase.matchAll(/`([^`]+)`/g)) {
        const nome = c[1].trim()
        if (posicao.has(nome)) candidatos.push(nome)
        else if (idDoScript.has(nome)) candidatos.push(idDoScript.get(nome))
      }
      for (const [script, id] of idDoScript) {
        if (!candidatos.includes(id) && frase.includes(script)) candidatos.push(id)
      }
      const referencia = citada.replace(/\s+/g, " ")

      // O BLOCO DERIVADO é uma classe de PULO como as outras, e não um
      // `continue` mudo: a régua daquela prosa é a da DERIVAÇÃO (o ato a
      // reescreve do registro), mas a referência foi VISTA — e o que a régua vê e
      // não julga entra na contagem e sai DITO no relatório.
      if (dentroDoBloco(linha)) {
        cobertura.puladas += 1
        cobertura.porClasse.blocoDerivado += 1
        refs.push({
          arquivo: rel,
          linha,
          ordinal,
          citada: referencia,
          candidatos,
          forma,
          blocoDerivado: true,
        })
        continue
      }

      if (forma === "nua") {
        // O ATO PASSADO é uma classe DECLARADA (a lista dos marcadores está no
        // `marcadorDeAtoPassado`): a ordem daquele momento é história do
        // instrumento, e a régua não a julga contra a matriz de hoje — mas DIZ
        // que a pulou e por quê.
        const marca = marcadorDeAtoPassado(frase)
        if (marca !== null) {
          cobertura.puladas += 1
          cobertura.porClasse.historico += 1
          refs.push({
            arquivo: rel,
            linha,
            ordinal,
            citada: referencia,
            candidatos,
            forma,
            historico: marca,
          })
          continue
        }
        // Sem o CONTEXTO da matriz na frase, o número é de OUTRA lista (a suíte,
        // um passo, uma fila): fica fora do escopo, e também sai DITO.
        if (!CONTEXTO_DA_MATRIZ.test(frase)) {
          cobertura.puladas += 1
          cobertura.porClasse.foraDeEscopo += 1
          refs.push({
            arquivo: rel,
            linha,
            ordinal,
            citada: referencia,
            candidatos,
            forma,
            foraDeEscopo: true,
          })
          continue
        }
      }

      cobertura.julgadas += 1
      refs.push({ arquivo: rel, linha, ordinal, citada: referencia, candidatos, forma })

      if (candidatos.length === 0) {
        violations.push(
          `${rel}:${linha}: o ordinal '${referencia}' NÃO nomeia a suíte — um número sozinho não é conferível contra a matriz, e é assim que ele envelhece em silêncio. Ancore-o no \`id\` do sub-test (ou no caminho do script): a matriz tem ${entries.length} entradas hoje`,
        )
        continue
      }
      if (!candidatos.some((id) => posicao.get(id) === ordinal)) {
        const real = candidatos.map((id) => `\`${id}\` é a ${posicao.get(id)}.ª`).join(", ")
        violations.push(
          `${rel}:${linha}: o ordinal '${referencia}' NÃO bate com a ordem do SUBTESTS (${real}) — uma entrada inserida ANTES move a suíte, e a prosa passa a identificar a errada. O número é a POSIÇÃO de hoje; ou cite a suíte só pelo \`id\``,
        )
      }
    }
  }
  return { refs, cobertura, violations }
}

// ── A COBERTURA DA RÉGUA DO ORDINAL: publicada e TRAVADA ───────────────────

/**
 * A LINHA da doc que declara a cobertura — a forma canônica, usada pela doc e
 * pelas mensagens de violação (o remédio é sempre a MESMA linha, com o número de
 * agora).
 *
 * @param {{julgadas: number, puladas: number}} c
 * @returns {string}
 */
export function linhaDaCobertura({ julgadas, puladas }) {
  return `**A régua do ordinal: ${julgadas} referência(s) JULGADA(S) e ${puladas} PULADA(S)**`
}

/** A forma canônica da linha da cobertura, lida da prosa. */
export const COBERTURA_ORDINAL_RE =
  /\*\*A régua do ordinal:\s*(\d+)\s*referência\(s\)\s*JULGADA\(S\)\s*e\s*(\d+)\s*PULADA\(S\)\*\*/

/**
 * A COBERTURA da régua do ordinal × a declaração da doc.
 *
 * O DEFEITO: a régua pula referências por três classes (a forma NUA num ATO
 * PASSADO, a forma nua sem o CONTEXTO da matriz e o que vive dentro de um BLOCO
 * DERIVADO) e o pulo não tinha número nenhum. Uma referência nova escrita de
 * forma que cai no pulo — um `era a 42.ª entrada` numa prosa de hoje — encolhia a
 * régua sem deixar rastro: o veredito continuava verde, e a cobertura caía em
 * silêncio. Declarar "quantas são julgadas e quantas são puladas" é o que torna
 * a queda um vermelho.
 *
 * As DUAS DIREÇÕES do pulo, e a razão de NÃO haver folga:
 *   · o pulo medido SOBE (acima do declarado) → a cobertura PIOROU: a mensagem
 *     nomeia a referência e a classe que escaparam;
 *   · o pulo medido DESCE → o teto ENVELHECEU: a declaração tem de BAIXAR junto.
 *     Sem esta direção, o número declarado seria um teto frouxo, e uma folga
 *     deixada para trás é exatamente o que deixa a próxima piora passar verde —
 *     é a igualdade que faz o pulo **só poder diminuir**.
 *
 * As JULGADAS entram como PISO: a régua pode julgar MAIS (uma referência nova na
 * prosa é bem-vinda, e o número declarado é o que não se perde) e NÃO pode julgar
 * menos sem que a perda esteja numa decisão — a referência que saiu da prosa, o
 * doc que sumiu, o escopo que alguém estreitou.
 *
 * A doc AUSENTE não vira violação (é o `DOC_OPCIONAL` da lista, e o fixture
 * mínimo não a tem): sem doc não há onde declarar, e o relatório diz isso
 * (`declarado: null`) em vez de inventar.
 *
 * @param {string | null} docSrc a doc das metades (null = não existe)
 * @param {{julgadas: number, puladas: number, porClasse: Record<string, number>}} cobertura
 * @param {{refs: {arquivo: string, linha: number, forma: string, citada: string, historico?: string, foraDeEscopo?: boolean, blocoDerivado?: boolean}[]}} ordinais
 * @returns {{declarado: {julgadas: number, puladas: number} | null, violations: string[]}}
 */
export function analisaCoberturaOrdinal(docSrc, cobertura, ordinais) {
  const violations = []
  if (docSrc === null) return { declarado: null, violations }
  const m = COBERTURA_ORDINAL_RE.exec(docSrc)
  if (!m) {
    violations.push(
      `${DOC_OPCIONAL}: não DECLARA a cobertura da régua do ordinal — a linha '${linhaDaCobertura(cobertura)}' (com o número de AGORA) é o que TRAVA a régua: sem ela, uma referência que caia no pulo encolhe a cobertura sem deixar rastro, e o veredito segue verde sobre uma régua menor`,
    )
    return { declarado: null, violations }
  }
  const declarado = { julgadas: Number(m[1]), puladas: Number(m[2]) }
  const classe = (r) =>
    r.historico ? `historico: ${r.historico}` : r.foraDeEscopo ? "foraDeEscopo" : "blocoDerivado"
  const puladas = ordinais.refs.filter((r) => r.historico || r.foraDeEscopo || r.blocoDerivado)
  if (cobertura.puladas > declarado.puladas) {
    const listadas = puladas.slice(0, 6).map((r) => `${r.arquivo}:${r.linha} (${classe(r)})`)
    violations.push(
      `${DOC_OPCIONAL}: a COBERTURA da régua do ordinal PIOROU — ${cobertura.puladas} referência(s) PULADA(S) contra ${declarado.puladas} declarada(s) (julgadas: ${cobertura.julgadas}). O que saiu do julgamento: ${listadas.join(" · ")}${puladas.length > listadas.length ? ` (+${puladas.length - listadas.length})` : ""} — se o pulo é LEGÍTIMO (um ato passado, um bloco derivado, um número que não é da matriz), atualize a declaração para '${linhaDaCobertura(cobertura)}' e diga por quê; se não é, a referência se ancora na suíte`,
    )
  } else if (cobertura.puladas < declarado.puladas) {
    violations.push(
      `${DOC_OPCIONAL}: o TETO da cobertura da régua do ordinal ENVELHECEU — o pulo caiu para ${cobertura.puladas} e a declaração diz ${declarado.puladas}. BAIXE o número ('${linhaDaCobertura(cobertura)}'): a declaração acompanha o pulo para baixo, e uma folga deixada para trás é o que deixa a próxima piora passar sem vermelho`,
    )
  }
  if (cobertura.julgadas < declarado.julgadas) {
    violations.push(
      `${DOC_OPCIONAL}: a COBERTURA da régua do ordinal PERDEU JULGAMENTO — julgaria ${declarado.julgadas} referência(s) e julga ${cobertura.julgadas} (o piso é o que não se perde): a referência que saiu da prosa — ou o doc que sumiu, ou o escopo que alguém estreitou — tem de estar numa decisão. Se a perda é mesmo a decisão, baixe o PISO junto ('${linhaDaCobertura(cobertura)}')`,
    )
  }
  return { declarado, violations }
}

// ── A PROVA-DE-APLICAÇÃO (a régua única × as suítes que a chamam) ─────────

/** A régua ÚNICA de "a mutação APLICOU" — a biblioteca SOURCED pelas suítes. */
export const PROVA_LIB = "scripts/mutacao-prova.sh"

/**
 * O GABARITO da régua: a suíte que MEDE a prova-de-aplicação (o marcador, o
 * conteúdo e a cirurgia desligados um por vez). Ela é do bloco SUBTESTS como
 * qualquer outra, mas fica FORA desta regra — a cópia que se muta ali é o
 * OBJETO da medição, não uma cópia privada da prova.
 */
export const PROVA_GABARITO = "scripts/test-mutation-mutacao-prova.sh"

/**
 * O bloco DECLARADO no master — as suítes que chamam a régua única:
 *
 *   PROVA_DE_APLICACAO=(
 *     "artefatos-do-hook"
 *     ...
 *   )
 *
 * A lista é conferida NOS DOIS SENTIDOS (uma entrada sem a chamada e uma
 * chamada sem a entrada são violação) e o número dela é declarado na doc. O
 * que ela NÃO pode ser é dispensável: sem uma declaração viva, tirar a chamada
 * de uma suíte não deixa rastro.
 *
 * @param {string} masterSrc
 * @returns {{presente: boolean, ids: string[]}}
 */
export function deriveProvaDeAplicacao(masterSrc) {
  const marca = "PROVA_DE_APLICACAO=("
  const start = masterSrc.indexOf(marca)
  if (start === -1) return { presente: false, ids: [] }
  const bloco = masterSrc.slice(start + marca.length)
  const end = bloco.indexOf("\n)")
  const corpo = end === -1 ? bloco : bloco.slice(0, end)
  const ids = []
  for (const linha of corpo.split("\n")) {
    const m = linha.match(/^\s*"([^"]+)"\s*$/)
    if (m) ids.push(m[1])
  }
  return { presente: true, ids }
}

/**
 * Deriva um bloco DECLARADO do master no formato `MARCA=( "chave|motivo" ... )`.
 *
 * Dois blocos usam esta forma: `SEM_MARCADOR` (quem chama o caminho DECLARADO da
 * régua — o payload não pode carregar o marcador) e `FORA_DA_REGUA` (quem não
 * chama a régua nenhuma, com o motivo). O `motivo` é o que separa uma DECLARAÇÃO
 * de um silêncio com aparência de lista: vazio é violação.
 */
function derivaBlocoDeMotivos(masterSrc, marca) {
  const start = masterSrc.indexOf(marca)
  if (start === -1) return { presente: false, entradas: [] }
  const bloco = masterSrc.slice(start + marca.length)
  const fim = bloco.indexOf("\n)")
  const corpo = fim === -1 ? bloco : bloco.slice(0, fim)
  const entradas = []
  for (const linha of corpo.split("\n")) {
    // ASPAS SIMPLES OU DUPLAS: o master usa SIMPLES nas listas com PROSA (a
    // prosa cita `sed -i` e `$TMP_DIR`, e dentro de aspas duplas o shell expande
    // as duas — medido: a matriz morria com "run:: comando não encontrado").
    const m = /^\s*(?:"([^"]*)"|'([^']*)')\s*$/.exec(linha)
    if (!m) continue
    const valor = m[1] ?? m[2]
    const corte = valor.indexOf("|")
    entradas.push(
      corte === -1
        ? { chave: valor.trim(), motivo: "" }
        : { chave: valor.slice(0, corte).trim(), motivo: valor.slice(corte + 1).trim() },
    )
  }
  return { presente: true, entradas }
}

/**
 * O bloco `SEM_MARCADOR=( "scripts/test-mutation-x.sh|motivo" ... )`: as suítes
 * que chamam `mutacao_aplicar_sem_marcador`. A chave é o CAMINHO do script (não
 * o id da matriz): o `forge-parity` é uma suíte de mutação FORA do `SUBTESTS`, e
 * uma declaração que só olhasse a matriz deixaria metade dele sem conferência.
 */
export function deriveSemMarcador(masterSrc) {
  return derivaBlocoDeMotivos(masterSrc, "SEM_MARCADOR=(")
}

/**
 * O bloco `FORA_DA_REGUA=( "id|motivo" ... )`: as suítes da matriz que NÃO
 * chamam a régua, cada uma com o PORQUÊ. A régua é a cópia única da
 * prova-de-aplicação; uma suíte fora dela tem de dizer o que a substitui.
 */
export function deriveForaDaRegua(masterSrc) {
  return derivaBlocoDeMotivos(masterSrc, "FORA_DA_REGUA=(")
}

/**
 * Os caminhos de `scripts/test-mutation-*.sh` que CHAMAM `<token>` no próprio
 * fonte (a conferência do caminho declarado é do DIRETÓRIO, não da matriz).
 */
function caminhosQueChamam(root, token) {
  const dir = join(root, "scripts")
  if (!existsSync(dir)) return []
  return (
    readdirSync(dir)
      .filter((f) => /^test-mutation-.*\.sh$/.test(f))
      // A CHAMADA, não a prosa: o master (e alguns cabeçalhos) CITAM o nome do
      // caminho declarado em comentário — citar não é chamar.
      .filter((f) =>
        readFileSync(join(dir, f), "utf8")
          .split("\n")
          .some((l) => !/^\s*#/.test(l) && new RegExp(`\\b${token}\\b`).test(l)),
      )
      .map((f) => `scripts/${f}`)
      .sort()
  )
}

/**
 * A PROVA-DE-APLICAÇÃO — a régua ÚNICA (`PROVA_LIB`) e as suítes que a chamam.
 *
 * O DEFEITO MEDIDO (27/09/2026): a prova de que a mutação APLICOU vivia COPIADA
 * em cada suíte — a mesma dezena de linhas (`mutar` com a cirurgia em python, o
 * `grep` do marcador `MUTACAO` e a conferência do checksum) reimplementada
 * dezenove vezes, com uma variação a cada cópia. Das 44 suítes que injetam uma
 * mutação cujo payload CARREGA o marcador, só 18 verificavam que ele chegou ao
 * arquivo; e uma cópia que simplesmente SUMISSE não deixava rastro: a suíte
 * seguia verde, medindo o alvo ÍNTEGRO — o verde em VÁCUO.
 *
 * A prova foi HOISTED para `scripts/mutacao-prova.sh` (uma cópia só, com um
 * sítio único para cada uma das três provas) e quem mede a régua é o gabarito
 * (`PROVA_GABARITO`, com as três metades dele). Esta regra fecha o outro lado,
 * e são três as conferências:
 *
 *   1. NENHUMA cópia PRIVADA: uma linha com `grep` e o marcador `MUTACAO` numa
 *      suíte é a prova reimplementada — e uma cópia que nasce não é medida por
 *      gabarito nenhum;
 *   2. A LISTA DECLARADA está NO MASTER (`PROVA_DE_APLICACAO`), conferida nos
 *      DOIS sentidos contra as suítes que chamam `mutacao_aplicar`;
 *   3. O NÚMERO DECLARADO na doc — `**N suítes** provam a aplicação pela régua
 *      única` — bate com o tamanho da lista.
 *
 * Sem (2) e (3), tirar a chamada de uma suíte (e a prova com ela) seria um
 * verde: a suíte deixaria de provar que a mutação aplicou, e nada diria.
 *
 * @param {string} root
 * @param {string} masterSrc
 * @param {{id: string, script: string}[]} entries
 * @returns {{comProva: {id: string, script: string}[], declaradas: string[], presente: boolean,
 *            violations: string[]}}
 */
export function analisaProvaDeAplicacao(root, masterSrc, entries) {
  const violations = []
  const comProva = []
  const { presente, ids: declaradas } = deriveProvaDeAplicacao(masterSrc)

  for (const { id, script } of entries) {
    // O gabarito muta a PRÓPRIA régua: a "cópia" que ele desliga é o objeto da
    // medição dele, e a régua o mede por outro caminho (o checksum do arquivo).
    if (script === PROVA_GABARITO) continue
    const p = join(root, script)
    if (!existsSync(p)) continue // ausente = violação da regra das metades
    const src = readFileSync(p, "utf8")

    // 1. a cópia PRIVADA da prova do marcador: um `grep` cujo PRIMEIRO argumento
    //    citado é o próprio marcador (`grep -qF 'MUTACAO M' "$GUARD"`). A forma
    //    é a do `mutacao_carregou_marcador`; a prosa que CITA o marcador (um
    //    `header`, um comentário do cabeçalho) não é prova de nada e não entra.
    for (const [i, linha] of src.split("\n").entries()) {
      if (/^\s*#/.test(linha)) continue
      const copia = /\bgrep\b[^\n]*?(["'])(MUTACAO|MUTAÇÃO)[^"']*\1/.exec(linha)
      if (copia) {
        violations.push(
          `${script}:${i + 1}: cópia PRIVADA da prova-de-aplicação (o \`grep\` do marcador MUTACAO) — a prova é da régua ÚNICA (${PROVA_LIB}): chame \`mutacao_aplicar\`, que traz a cirurgia, o MARCADOR e o CONTEÚDO juntos; uma cópia que nasce não é medida por gabarito nenhum, e uma que some não deixa rastro (a suíte passaria a medir o alvo íntegro)`,
        )
      }
    }

    if (/\bmutacao_aplicar\b/.test(src)) {
      comProva.push({ id, script })
      if (!src.includes(PROVA_LIB)) {
        violations.push(
          `${script}: chama \`mutacao_aplicar\` e NÃO sourceia ${PROVA_LIB} — a régua tem de estar carregada na suíte (sem o \`. \"$SCRIPT_DIR/${PROVA_LIB}\"\` a chamada sai com 'command not found' e o erro não é o da prova)`,
        )
      }
    }
  }

  // 2. a LISTA DECLARADA × as suítes que chamam a régua (nos DOIS sentidos).
  const derivadas = comProva.map((c) => c.id).sort()
  const ordenadas = [...declaradas].sort()
  if (presente) {
    const faltando = derivadas.filter((id) => !ordenadas.includes(id))
    const sobrando = ordenadas.filter((id) => !derivadas.includes(id))
    for (const id of faltando) {
      violations.push(
        `test-mutation-guards.sh: a suíte '${id}' CHAMA a régua única (\`mutacao_aplicar\`) e NÃO está em PROVA_DE_APLICACAO — a prova-de-aplicação que ninguém declara é a que some em silêncio: acrescente a linha lá`,
      )
    }
    for (const id of sobrando) {
      violations.push(
        `test-mutation-guards.sh: PROVA_DE_APLICACAO declara '${id}' e a suíte NÃO chama \`mutacao_aplicar\` — ou a suíte perdeu a prova-de-aplicação (o \`mutar\` voltou a escrever por conta própria), ou a linha da lista ficou. A régua única é a única cópia da prova: ${PROVA_LIB}`,
      )
    }
  } else if (derivadas.length > 0) {
    violations.push(
      `test-mutation-guards.sh: não DECLARA as suítes da prova-de-aplicação (${derivadas.length} chamam \`mutacao_aplicar\`): o bloco \`PROVA_DE_APLICACAO=( \"id\" ... )\` é a lista viva — sem ele, tirar a chamada de uma suíte não deixa rastro`,
    )
  }

  // 3. o NÚMERO declarado na doc — só quando há lista a declarar.
  const docPath = join(root, DOC_OPCIONAL)
  if (presente && existsSync(docPath)) {
    const docSrc = readFileSync(docPath, "utf8")
    const m = /\*\*(\d+)\s+suítes\*\*\s+provam\s+a\s+aplicação\s+pela\s+régua\s+única/.exec(docSrc)
    if (!m) {
      violations.push(
        `${DOC_OPCIONAL}: não declara quantas suítes provam a aplicação pela régua única — a linha \`**N suítes** provam a aplicação pela régua única\` é a declaração histórica do tamanho desta lista (o que uma suíte que perde a prova derruba)`,
      )
    } else if (Number(m[1]) !== declaradas.length) {
      violations.push(
        `${DOC_OPCIONAL}: a doc declara ${m[1]} suíte(s) provando a aplicação pela régua única e PROVA_DE_APLICACAO declara ${declaradas.length} (${ordenadas.join(", ")}) — a contagem envelheceu com a lista`,
      )
    }
  }

  // 4. AS SUÍTES FORA DA RÉGUA — TODA suíte da matriz DECLARA a sua relação com
  //    a régua: ou chama `mutacao_aplicar` (`PROVA_DE_APLICACAO`), ou é o
  //    gabarito, ou está em `FORA_DA_REGUA` COM o motivo. Sem esta metade, "não
  //    usa a régua" e "perdeu a régua" seriam a mesma coisa em silêncio.
  const gabaritoId = (entries.find((e) => e.script === PROVA_GABARITO) ?? {}).id
  const { presente: foraPresente, entradas: fora } = deriveForaDaRegua(masterSrc)
  const idsFora = fora.map((f) => f.chave)
  if (foraPresente) {
    for (const f of fora) {
      if (f.motivo === "") {
        violations.push(
          `test-mutation-guards.sh: FORA_DA_REGUA declara '${f.chave}' e NÃO diz o MOTIVO — a linha sem motivo é um silêncio com aparência de declaração: escreva POR QUE a suíte não chama a régua (o alvo é a CÓPIA do fixture? a mutação é a CONSTRUÇÃO do fixture? a troca é na ÁRVORE por helper privado?)`,
        )
      }
    }
    for (const id of idsFora) {
      if (ordenadas.includes(id)) {
        violations.push(
          `test-mutation-guards.sh: '${id}' está em PROVA_DE_APLICACAO e em FORA_DA_REGUA — as duas listas dizem coisas opostas sobre a mesma suíte: ou ela chama a régua, ou ela está fora dela`,
        )
      }
      if (derivadas.includes(id)) {
        violations.push(
          `test-mutation-guards.sh: FORA_DA_REGUA declara '${id}' e a suíte JÁ chama a régua única — a lista envelheceu: tire a linha de FORA_DA_REGUA (e declare-a em PROVA_DE_APLICACAO se a chamada ficou)`,
        )
      }
    }
    const declaradasTodas = new Set([...ordenadas, ...idsFora, gabaritoId])
    for (const { id, script } of entries) {
      if (!declaradasTodas.has(id)) {
        violations.push(
          `${script}: a suíte '${id}' NÃO declara a sua relação com a régua única (${PROVA_LIB}) — toda suíte da matriz é ou da régua (\`PROVA_DE_APLICACAO\`), ou o gabarito, ou uma linha de \`FORA_DA_REGUA\` com o motivo. Sem a declaração, uma suíte que perca a prova-de-aplicação não deixa rastro`,
        )
      }
    }
  }

  // 5. O CAMINHO DECLARADO (`mutacao_aplicar_sem_marcador`) — nos DOIS sentidos,
  //    contra o DIRETÓRIO das suítes (não a matriz: o `forge-parity` não é
  //    sub-test, e a declaração tem de cobri-lo também); e o MOTIVO declarado
  //    tem de estar no FONTE da suíte (é ele que a chamada passa — a dispensa da
  //    prova do marcador é justificada onde ela acontece, não só na lista).
  const semMarcador = deriveSemMarcador(masterSrc)
  const chamamSemMarcador = caminhosQueChamam(root, "mutacao_aplicar_sem_marcador")
  const declaradosSemMarcador = semMarcador.entradas.map((e) => e.chave)
  for (const e of semMarcador.entradas) {
    if (e.motivo === "") {
      violations.push(
        `test-mutation-guards.sh: SEM_MARCADOR declara '${e.chave}' e NÃO diz o MOTIVO — o caminho declarado dispensa a prova do MARCADOR, e o que o dispensa tem de ser DITO (o payload é uma remoção? entra numa linha que o guard lê crua?)`,
      )
    } else {
      // O MOTIVO VIVE NOS DOIS LUGARES: a lista declara a dispensa e a suíte a
      // JUSTIFICA na própria chamada (o motivo é argumento OBRIGATÓRIO de
      // `mutacao_aplicar_sem_marcador`, fail-closed). Sem esta conferência, o
      // texto da lista podia descrever uma razão que o fonte não carrega — a
      // justificativa envelheceria no lugar onde ela não acontece.
      const suite = join(root, e.chave)
      const suiteSrc = existsSync(suite) ? readFileSync(suite, "utf8") : ""
      if (
        suiteSrc !== "" &&
        !suiteSrc.includes(`'${e.motivo}'`) &&
        !suiteSrc.includes(`"${e.motivo}"`)
      ) {
        violations.push(
          `${e.chave}: SEM_MARCADOR declara a dispensa com um MOTIVO que a suíte NÃO carrega — o mesmo texto tem de estar no FONTE dela (entre aspas), onde a chamada o passa: a justificativa que fica só na lista não é a que o atalho usa, e uma segunda forma de aplicar mutação sem prova nasceria sem que nada acusasse`,
        )
      }
    }
  }
  for (const c of chamamSemMarcador) {
    if (!declaradosSemMarcador.includes(c)) {
      violations.push(
        `${c}: chama \`mutacao_aplicar_sem_marcador\` e NÃO está em SEM_MARCADOR — o caminho declarado dispensa a prova do marcador, e quem o usa é declarado no master COM o motivo: sem a linha, o atalho vira o caminho de sempre`,
      )
    }
  }
  for (const c of declaradosSemMarcador) {
    if (!chamamSemMarcador.includes(c)) {
      violations.push(
        `test-mutation-guards.sh: SEM_MARCADOR declara '${c}' e o script NÃO chama \`mutacao_aplicar_sem_marcador\` — ou a suíte voltou ao caminho estrito (a linha ficou), ou o arquivo não existe`,
      )
    }
  }

  return {
    comProva,
    declaradas: ordenadas,
    presente,
    fora: { presente: foraPresente, ids: idsFora },
    semMarcador: { presente: semMarcador.presente, ids: declaradosSemMarcador },
    violations,
  }
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

  // 4b. A PROVA-DE-APLICAÇÃO — a régua ÚNICA da prova de que a mutação aplicou:
  //     nenhuma cópia privada do `grep` do marcador, a lista DECLARADA no master
  //     conferida nos dois sentidos, e o número dela declarado na doc. É o que
  //     impede uma suíte de perder a prova (e passar a medir o alvo íntegro) em
  //     silêncio.
  const prova = analisaProvaDeAplicacao(root, masterSrc, entries)
  violations.push(...prova.violations)

  // 4c. OS ORDINAIS DA MATRIZ — a suíte identificada pela POSIÇÃO (`a N.ª
  //     entrada da matriz`). Um número que ninguém confere envelhece em silêncio
  //     quando uma entrada nasce ANTES dele, e a prosa passa a apontar para a
  //     suíte errada: aqui o ordinal bate com a ordem do SUBTESTS (ou a suíte é
  //     nomeada ao lado dele).
  const ordinais = analisaOrdinais(root, entries)
  violations.push(...ordinais.violations)

  // 4d. A COBERTURA da régua do ordinal — PUBLICADA e TRAVADA: a doc declara
  //     quantas referências são julgadas e quantas são puladas, e o pulo só pode
  //     DIMINUIR (uma direção é a cobertura piorando; a outra é o teto que
  //     envelheceu e tem de baixar). Sem a declaração, uma referência que caia no
  //     pulo encolhe a régua e o veredito continua verde.
  const docDaCobertura = join(root, DOC_OPCIONAL)
  const coberturaOrdinal = analisaCoberturaOrdinal(
    existsSync(docDaCobertura) ? readFileSync(docDaCobertura, "utf8") : null,
    ordinais.cobertura,
    ordinais,
  )
  violations.push(...coberturaOrdinal.violations)

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
    prova: {
      comProva: prova.comProva.map((c) => c.id),
      declaradas: prova.declaradas,
    },
    ordinais: ordinais.refs,
    // A COBERTURA publicada: o que a régua julga, o que ela pula (com a classe) e
    // o que a doc declara. É o par que a regra 4d trava.
    ordinaisCobertura: { ...ordinais.cobertura, declarado: coberturaOrdinal.declarado },
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
 * veredito lê com `existsSync` (a doc das metades, o registro do ato e a PROSA
 * que a régua do ordinal varre). Ausente do índice = ausente da árvore (não há
 * veredito a dar sobre ele), e o `run()` o DIZ (`present: false` / sem doc) em
 * vez de o inventar.
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
  // E OS CHAMADORES DO CAMINHO DECLARADO (`SEM_MARCADOR`): a chave do bloco é o
  // CAMINHO do script, e ele pode NÃO SER sub-test da matriz (o `forge-parity`
  // não é) — sem materializá-lo, a conferência do índice lê um diretório onde o
  // arquivo não existe e acusa "o script NÃO chama" sobre um fonte que ela nunca
  // leu (medido: o pre-commit recusou o commit da régua por isso).
  for (const { chave } of deriveSemMarcador(masterSrc).entradas) {
    if (!rels.includes(chave)) rels.push(chave)
  }
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
  // A PROSA julgada pela régua do ordinal entra na materialização: o escopo dela
  // é DERIVADO (a árvore de docs + README), e sem isto o recorte julgaria a prosa
  // num diretório onde os docs não estão — "nenhum doc a ler" disfarçado de
  // "nenhuma referência a conferir". Ausente do índice = ausente da árvore: só a
  // doc das metades é obrigatória.
  const docs = docsDaProsa(root)
  for (const d of docs) if (!rels.includes(d)) rels.push(d)
  const dir = mkdtempSync(join(tmpdir(), "mutation-count-indice-"))
  const ausentes = []
  try {
    for (const rel of rels) {
      // O master JÁ foi lido (e é ele que decide a lista): não gasta outro
      // `git show` no mesmo blob.
      const r = rel === MASTER ? master : ler(root, rel)
      if (!r.ok) {
        // O caminho OPCIONAL ausente do índice é o ausente da árvore (o `run()`
        // o lê com existsSync): não é violação, é não haver o que conferir. A
        // PROSA entra aqui pelo mesmo motivo — cada `.md` é opcional, e um deles
        // ausente do índice é um doc que o commit não carrega (nada a julgar).
        if (CAMINHOS_OPCIONAIS.includes(rel) || docs.includes(rel)) continue
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

  // A COBERTURA da régua do ordinal entra no veredito VERDE também: "as refs
  // batem" não diz QUANTO da prosa a régua leu, e é a diferença entre a régua
  // inteira e a régua que encolheu que a declaração trava.
  const cob = result.ordinaisCobertura
  const cobertura =
    cob && cob.declarado
      ? ` A RÉGUA DO ORDINAL: ${cob.julgadas} julgada(s) · ${cob.puladas} pulada(s) (historico ${cob.porClasse.historico} · foraDeEscopo ${cob.porClasse.foraDeEscopo} · blocoDerivado ${cob.porClasse.blocoDerivado}) — declarado ${cob.declarado.julgadas} / ${cob.declarado.puladas}.`
      : ""

  if (result.ok) {
    console.log(
      `✅ check-mutation-count: ${result.derivedCount} sub-tests da matriz (${result.derivedMetades} metades declaradas) ${escopo} — pr-check.yml, master, README e a doc das metades consistentes.${ato}${cobertura}`,
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
