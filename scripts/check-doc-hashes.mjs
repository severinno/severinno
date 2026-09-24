#!/usr/bin/env node

// =============================================================================
// check-doc-hashes.mjs
//
// Um hash de commit CITADO na prosa versionada tem de pertencer à história do
// HEAD. Quando não pertence, a doc mente: o texto descreve um ato medido num
// commit que ninguém consegue `git show`.
//
// POR QUE EXISTE (a classe, medida)
//
// Rewrite de pilha (rebase, `--amend`, "dobra" de um conserto dentro do commit
// que invalidou a expectativa) troca o NOME dos commits preservando o assunto —
// e toda citação em prosa que apontava para o nome antigo fica ÓRFÃ: o objeto
// continua no repositório (o reflog e os branches antigos o seguram), então um
// `git cat-file -e` diz "existe" e o link quebrado passa despercebido. O caso
// medido em 22/09/2026: a dobra da proveniência reescreveu 12 commits citados em
// 12 arquivos (o `eee4f65e` da contagem no índice virou `2757e3a5`, o `fa75f732`
// do ato do bench virou `6125c9da`, ...) — 21 citações órfãs no total, e nenhuma
// delas falhava nada.
//
// O que o guard NÃO é: um catálogo de hashes. Ele julga a PROSA contra a
// HISTÓRIA, viva — o hash certo muda a cada rewrite e a régua não muda com ele.
//
// O ESCOPO (os diretórios que carregam prosa versionada)
//
//   README.md · docs/ · ci/ · scripts/ · .husky/ · .github/workflows/ · .gitea/workflows/
//
// Fora do escopo, por construção: `src/` (payload de teste e código do app — a
// mesma régua do `check-github-dependencies`, onde o TEXTO do defeito é dado de
// prova, não afirmação de doc), `node_modules/`, os binários (`osrm-data/`) e os
// artefatos de build (`.next/`).
//
// AS EXCLUSÕES DECLARADAS (arquivo → por que o hash dele não é commit)
//
//   docs/security/secret-leaks-baseline.json — fingerprint de CONTEÚDO (sha1 de
//     linha/arquivo na baseline de vazamento), não de revisão do git;
//   docs/benchmarks/.benchmark-cache.json    — cache GERADO pelo instrumento: o
//     `commitHash` é a origem do ato e o arquivo é reescrito pela medição.
//
// E as NÃO-CITAÇÕES declaradas (literal → por que): os exemplos didáticos de
// FORMATO (`abc1234`, `a1b2c3d`) e o `ed25519` do `ssh-keygen` são hex que não
// pretendem ser commit nenhum. Um literal novo aqui é DECISÃO, com motivo.
//
// Fora por EXTENSÃO ficam os arquivos de CÓDIGO/FIXTURE do `scripts/` (`.ts`):
// id de seed em formato ObjectId (`c64695cc6952`) e exemplo sintético de 24 hex
// são DADO de prova, não afirmação de doc — a mesma régua que já deixa o `src/`
// fora do escopo. O que fica dentro é a prosa: `md`, `json`, `yml/yaml`, `sh`,
// `mjs` e os hooks do `.husky/` (que não têm extensão nenhuma).
//
// A REGRA
//
//   1. um token `[0-9a-f]{7,40}` no escopo é CITAÇÃO DE COMMIT — salvo se (a) for
//      NÚMERO PURO (timestamps, ms, telefone, TTL: `[0-9a-f]` sem nenhuma letra
//      cobre a classe inteira — um commit não tem 7+ dígitos e zero letras, e
//      exigir a letra é o que separa `86400000` de `eee4f65e`), (b) vier
//      precedido de um prefixo de digest (`sha256:`/`sha512:`/`md5:`: aí é o
//      digest do ARTEFATO) ou (c) estiver na lista de não-citações;
//   2. toda citação tem de ser ancestral do HEAD (ou o próprio HEAD);
//   3. `git cat-file` separa os dois defeitos, porque o remédio difere:
//      - EXISTE e está fora da história → ÓRFÃO de reescrita (o guard nomeia o
//        commit de MESMO ASSUNTO na história — é o nome que a rewrite deixou);
//      - NÃO existe → hash sem commit nenhum (typo, cópia truncada de outro
//        identificador, prosa inventada).
//
// O veredito é FAIL-CLOSED: git sem resposta, `HEAD` ilegível ou arquivo do
// escopo que não abre valem exit 2 — "não consegui julgar" nunca vira "está
// tudo na história".
//
// APOSENTAR A DÍVIDA (`--fix`): a citação órfã TEM remédio mecânico
//
// O órfão de rewrite não é um enigma: o guard já sabe QUAL é o nome que a dobra
// deixou (o commit de MESMO assunto que está na história — é o `candidato` que o
// relatório nomeia). O `--fix` faz exatamente essa troca, e SÓ ela: o token hex
// é substituído pelo nome vivo, na linha onde ele está, e nada mais do texto é
// tocado. O que NÃO tem remédio sai nomeado, nunca sumindo:
//
//   - o órfão SEM commit de mesmo assunto na história (o remédio não inventa um
//     nome), e o token que não existe como commit nenhum (typo/cópia truncada) —
//     os dois vão para as RECUSAS, com o motivo, e pedem mão humana;
//   - o arquivo que a varredura não conseguiu ler: sem medição não há remédio
//     (`indisponível`), nunca "nada a remendar";
//   - a reescrita que não remove o token (o arquivo mudou desde a medição) NÃO é
//     gravada: o remendo prova o efeito antes de escrever.
//
// `--fix --dry-run` é a PREVISÃO do remédio: imprime o PATCH exato (unificado,
// com contexto) e NADA é gravado — é o mesmo patch que o `remedyPatch` deste
// módulo entrega ao canal do PR (`pr-remedy-comment.mjs`, pelo par declarativo
// `remedy-classes/doc-hashes.mjs` + `remedy-canal/doc-hashes.mjs`). Um remendo
// que se aplicasse no preview tornaria o "não" da pergunta uma mentira.
//
// O `--fix` GRAVA depois de CONFIRMAÇÃO EXPLÍCITA: a pergunta vai ao TERMINAL DE
// CONTROLE (`/dev/tty` — o `git commit` liga o fd 0 em `/dev/null`, e é por isso
// que a pergunta não usa o stdin), e sem terminal NADA é gravado (fail-closed:
// quem não pode responder não autoriza). `--yes` é a confirmação DECLARADA por
// quem chama (o remédio do pre-commit já perguntou).
//
// Usage:
//   node scripts/check-doc-hashes.mjs             # julga a árvore (HEAD)
//   node scripts/check-doc-hashes.mjs --json      # o relatório estruturado
//   node scripts/check-doc-hashes.mjs --all       # inclui as não-citações no relatório
//   node scripts/check-doc-hashes.mjs --fix       # troca o órfão pelo nome que a dobra deixou (pede confirmação)
//   node scripts/check-doc-hashes.mjs --fix --yes # a confirmação já foi dada por quem chama
//   node scripts/check-doc-hashes.mjs --fix --dry-run        # o PATCH exato, sem gravar
//   node scripts/check-doc-hashes.mjs --fix --dry-run --json # idem, estruturado
//   node scripts/check-doc-hashes.mjs --root X    # outro checkout (fixture)
//   node scripts/check-doc-hashes.mjs -h
//
// Exit codes:
//   0 — toda citação na prosa pertence à história do HEAD (ou o preview do `--fix`)
//   1 — violação: citação ÓRFÃ (fora da história) ou hash sem commit — e também
//       quando o remédio foi RECUSADO ou não havia o que remendar mecanicamente
//   2 — infra: git indisponível, HEAD ilegível, arquivo do escopo ilegível, entrada
//       inválida nas listas declaradas ou uso inválido das flags do remédio
//       (fail-closed)
// =============================================================================

import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import {
  AFFIRMATIVE,
  OFFER_MARKER,
  TIMEOUT,
  TTY_WAIT_MS,
  ask,
  noPromptEnv,
  openTerminal,
} from "./confirm-prompt.mjs"
import { linhasDe, patchPorArquivo } from "./unified-patch.mjs"

/**
 * O caminho DESTE arquivo. `fileURLToPath` (e não `new URL(...).pathname`) é o que
 * sobrevive ao carregador do vitest: sob ele o `import.meta.url` vem com o
 * esquema interno do Vite (`/@fs/...`) e o `pathname` cru daria uma raiz que não
 * existe — o `ROOT` sai do MESMO caminho, então os dois não podem divergir.
 */
const AQUI = fileURLToPath(import.meta.url)

/** A raiz do repositório (este arquivo vive em `scripts/`). */
export const ROOT = resolve(dirname(AQUI), "..")

/** O caminho DESTE arquivo, relativo à raiz — o auditor não se conta. */
export const AUDITOR = `scripts/${basename(AQUI)}`

/**
 * O arquivo é o PRÓPRIO auditor?
 *
 * O cabeçalho acima CITA os nomes órfãos (`eee4f65e`, `fa75f732`) para descrever
 * a classe — é a prosa que DESCREVE o defeito, não uma citação de doc. Contar o
 * auditor faria o guard reprovar a si mesmo pelo exemplo que ele usa para
 * explicar a regra: a mesma régua do `ARQUIVOS_DO_AUDITOR` do
 * `check-github-dependencies`.
 *
 * @param {string} rel
 * @returns {boolean}
 */
export function ehArquivoDoAuditor(rel) {
  return rel === AUDITOR
}

/** Exit codes — o contrato da CLI. */
export const EXIT = { OK: 0, VIOLACAO: 1, USO: 2 }

/** Os diretórios/arquivos que carregam PROSA versionada (o escopo da varredura). */
export const ESCOPO = [
  "README.md",
  "docs/",
  "ci/",
  "scripts/",
  ".husky/",
  ".github/workflows/",
  ".gitea/workflows/",
]

/**
 * As EXTENSÕES que ficam fora do escopo dentro dos diretórios acima (
 * código/fixture): o `scripts/*.ts` carrega id de seed e exemplo sintético, e o
 * valor ali é DADO de prova — a mesma régua que deixa o `src/` de fora.
 */
export const FORA_POR_EXTENSAO = [
  {
    extensoes: [".ts", ".tsx"],
    porque:
      "código/fixture: id de seed (ObjectId), exemplo sintético de 24 hex — dado de prova, não doc",
  },
]

/**
 * Os arquivos do escopo em que o hash NÃO é citação de commit — cada um com o
 * MOTIVO. Uma exclusão sem motivo é uma exclusão que esconde um defeito: o
 * guard recusa a lista inteira (exit 2) quando alguma entrada vem sem `porque`.
 */
export const EXCECOES = [
  {
    path: "docs/security/secret-leaks-baseline.json",
    porque:
      "fingerprint de CONTEÚDO (sha1 de linha/arquivo na baseline de vazamento de segredo), não revisão do git",
  },
  {
    path: "docs/benchmarks/.benchmark-cache.json",
    porque:
      "cache GERADO pelo instrumento de medição: o `commitHash` é a origem do ato e o arquivo é reescrito a cada medição",
  },
]

/**
 * Os literais hex que NÃO são citação de commit — cada um com o motivo. Aqui a
 * entrada é a DECISÃO de que aquele texto não descreve um ato do repositório.
 */
export const NAO_CITACOES = [
  { literal: "abc1234", porque: "exemplo didático do FORMATO do arquivo de cache (não um commit)" },
  { literal: "a1b2c3d", porque: "exemplo didático da key de cache do Prisma (não um commit)" },
  { literal: "ed25519", porque: "nome do ALGORITMO de chave do `ssh-keygen` (não um commit)" },
]

/** O token de um hash: 7 a 40 hexadecimais isolados (o `\b` protege de runs maiores). */
export const HASH_RE = /\b[0-9a-f]{7,40}\b/g

/**
 * O token PARECE um commit? Precisar de ao menos uma letra `a-f` é o que separa a
 * citação do número puro: `86400000` (ms de um dia), `31536000` (um ano de cache),
 * `1581578731548` (timestamp) e `11999999999` (celular de fixture) são hex
 * VÁLIDOS e nada têm a ver com revisão — sem esta régua eles viravam 78 falsos
 * positivos medidos em 22/09/2026.
 *
 * @param {string} token
 * @returns {boolean}
 */
export function pareceCommit(token) {
  return /[a-f]/.test(token)
}

/** O arquivo está fora do escopo pela EXTENSÃO declarada? */
export function foraPorExtensao(arquivo) {
  return FORA_POR_EXTENSAO.some((e) => e.extensoes.some((ext) => arquivo.endsWith(ext)))
}

/** Os prefixos que denunciam um digest de ARTEFATO (não de revisão). */
export const DIGEST_PREFIXOS = ["sha256:", "sha512:", "sha1:", "md5:"]

/**
 * O hash no texto é um DIGEST de artefato?
 *
 * `sha256:fd027ee7…` descreve a IMAGEM servida pelo registry, não um commit. A
 * régua lê os caracteres ANTERIORES ao token (o prefixo é colado nele).
 *
 * @param {string} linha
 * @param {number} inicio  índice do token na linha
 * @returns {boolean}
 */
export function temPrefixoDeDigest(linha, inicio) {
  const antes = linha.slice(Math.max(0, inicio - 8), inicio).toLowerCase()
  return DIGEST_PREFIXOS.some((p) => antes.endsWith(p))
}

/**
 * As citações de um conteúdo: cada token hex com o arquivo e a LINHA.
 *
 * Um token precedido de prefixo de digest sai da lista (é digest de artefato) —
 * a decisão fica REGISTRADA em `digests` para que o relatório possa dizê-la, em
 * vez de sumir com o token.
 *
 * @param {string} conteudo
 * @param {string} arquivo
 * @returns {{citacoes: {file: string, line: number, token: string}[], digests: number}}
 */
export function extrairCitacoes(conteudo, arquivo) {
  const citacoes = []
  let digests = 0
  conteudo.split(/\r?\n/).forEach((linha, i) => {
    for (const m of linha.matchAll(new RegExp(HASH_RE.source, "g"))) {
      if (temPrefixoDeDigest(linha, m.index)) {
        digests += 1
        continue
      }
      // Número puro não é citação: `86400000` e `eee4f65e` são hex os dois, e só
      // o segundo descreve um ato do repositório.
      if (!pareceCommit(m[0])) continue
      citacoes.push({ file: arquivo, line: i + 1, token: m[0] })
    }
  })
  return { citacoes, digests }
}

/**
 * O JULGAMENTO das citações, com a verificação INJETADA.
 *
 * É aqui que o guard tem as duas metades da casa: o dado (as citações, medidas no
 * texto) e o veredito contra a história (`verificar`, que o CLI liga ao git e o
 * teste liga a um dublê). O remédio de um órfão sai da MESMA derivación do
 * veredito — o commit de mesmo ASSUNTO na história, quando ele existe.
 *
 * @param {{citacoes: {file: string, line: number, token: string}[],
 *          naoCitacoes?: {literal: string, porque: string}[],
 *          verificar: (token: string) => {existe: boolean, naHistoria: boolean, assunto: string|null, candidato: string|null}}} args
 * @returns {{citacoes: object[], orfaos: object[], inexistentes: object[], naoCitacoes: object[],
 *            naHistoria: number, digests?: number}}
 */
export function avaliarCitacoes({ citacoes, naoCitacoes = NAO_CITACOES, verificar }) {
  const declarados = new Set(naoCitacoes.map((n) => n.literal))
  const orfaos = []
  const inexistentes = []
  const ignorados = []
  let naHistoria = 0
  for (const c of citacoes) {
    if (declarados.has(c.token)) {
      ignorados.push(c)
      continue
    }
    const v = verificar(c.token)
    if (v.existe && v.naHistoria) {
      naHistoria += 1
      continue
    }
    if (v.existe) orfaos.push({ ...c, candidato: v.candidato, assunto: v.assunto })
    else inexistentes.push(c)
  }
  return { citacoes, orfaos, inexistentes, naoCitacoes: ignorados, naHistoria }
}

/**
 * As violações em TEXTO, já com o remédio de cada uma.
 *
 * @param {ReturnType<typeof avaliarCitacoes>} aval
 * @returns {string[]}
 */
export function violacoesDeCitacoes(aval) {
  const violacoes = []
  for (const o of aval.orfaos) {
    const remedio = o.candidato
      ? `o commit de MESMO assunto na história é \`${o.candidato}\``
      : "não há commit de mesmo assunto no HEAD — confira o ato que a citação descreve"
    violacoes.push(
      `${o.file}:${o.line}: \`${o.token}\` está ÓRFÃO — existe como objeto e NÃO pertence à história do HEAD (rewrite/rebase trocou o nome do commit). ${remedio}.`,
    )
  }
  for (const i of aval.inexistentes) {
    violacoes.push(
      `${i.file}:${i.line}: \`${i.token}\` não existe como commit. Se o texto descreve um ATO, cite um commit da história; se é exemplo de formato, declare em NAO_CITACOES com o motivo.`,
    )
  }
  return violacoes
}

/** O relatório em texto (o que a CLI imprime e o que o `--json` estrutura). */
export function renderRelatorio(aval, { escopoArquivos }) {
  const linhas = []
  linhas.push(
    `citações na prosa: ${aval.citacoes.length} token(s) em ${escopoArquivos} arquivo(s) do escopo`,
  )
  linhas.push(`  na história do HEAD: ${aval.naHistoria}`)
  linhas.push(`  órfãs (rewrite):     ${aval.orfaos.length}`)
  linhas.push(`  sem commit:          ${aval.inexistentes.length}`)
  linhas.push(`  não-citações declaradas: ${aval.naoCitacoes.length}`)
  if (aval.orfaos.length > 0) {
    linhas.push("")
    linhas.push("órfãs — o mesmo assunto na história é o nome que a rewrite deixou:")
    for (const o of aval.orfaos) {
      linhas.push(`  ${o.token} → ${o.candidato ?? "?"}   (${o.file}:${o.line})`)
    }
  }
  return linhas.join("\n")
}

// ── a medição na árvore ─────────────────────────────────────────────────────

/** O git do repositório, fail-closed: sem resposta, o guard NÃO julga. */
function git(root, args) {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 1 << 28 })
  } catch (err) {
    throw new Error(`git ${args.join(" ")} falhou: ${err?.message ?? err}`)
  }
}

/**
 * Os arquivos do escopo, versionados. `git ls-files` é a fonte (um arquivo não
 * versionado não é doc do repositório) e as exclusões declaradas saem nomeadas.
 *
 * @param {string} root
 * @returns {string[]}
 */
export function arquivosDoEscopo(root) {
  const excluidos = new Set(EXCECOES.map((e) => e.path))
  return git(root, ["ls-files", "-z"])
    .split("\0")
    .filter((f) => f !== "")
    .filter((f) => ESCOPO.some((prefixo) => f === prefixo || f.startsWith(prefixo)))
    .filter((f) => !excluidos.has(f))
    .filter((f) => !foraPorExtensao(f))
    .filter((f) => !ehArquivoDoAuditor(f))
    .sort()
}

/**
 * O verificador ligado ao git: existe? está na história? qual o mesmo assunto?
 *
 * @param {string} root
 * @returns {(token: string) => {existe: boolean, naHistoria: boolean, assunto: string|null, candidato: string|null}}
 */
export function verificadorGit(root) {
  const assuntos = new Map()
  for (const linha of git(root, ["log", "--format=%h\t%s", "HEAD"]).split("\n")) {
    const [sha, assunto] = linha.split("\t")
    if (sha && assunto && !assuntos.has(assunto)) assuntos.set(assunto, sha)
  }
  return (token) => {
    let existe = false
    try {
      execFileSync("git", ["cat-file", "-e", `${token}^{commit}`], { cwd: root, stdio: "ignore" })
      existe = true
    } catch {
      existe = false
    }
    if (!existe) return { existe: false, naHistoria: false, assunto: null, candidato: null }
    let naHistoria = false
    try {
      execFileSync("git", ["merge-base", "--is-ancestor", token, "HEAD"], {
        cwd: root,
        stdio: "ignore",
      })
      naHistoria = true
    } catch {
      naHistoria = false
    }
    const assunto = git(root, ["log", "-1", "--format=%s", token]).trim()
    return {
      existe,
      naHistoria,
      assunto,
      candidato: naHistoria ? null : (assuntos.get(assunto) ?? null),
    }
  }
}

/**
 * O guard completo sobre uma árvore: lê o escopo, extrai e julga.
 *
 * @param {{root?: string, verificar?: Function}} [opts]
 */
export function auditar({ root = ROOT, verificar = null } = {}) {
  for (const e of EXCECOES) {
    if (!e.porque || e.porque.trim() === "") {
      throw new Error(
        `exclusão sem motivo declarado (${e.path}) — uma exclusão muda é um defeito escondido`,
      )
    }
  }
  for (const e of FORA_POR_EXTENSAO) {
    if (!e.porque || e.porque.trim() === "") {
      throw new Error(
        `extensão fora do escopo sem motivo declarado (${e.extensoes.join(", ")}) — fora sem motivo é fora cego`,
      )
    }
  }
  for (const n of NAO_CITACOES) {
    if (!n.porque || n.porque.trim() === "") {
      throw new Error(`não-citação sem motivo declarado (${n.literal})`)
    }
  }
  const arquivos = arquivosDoEscopo(root)
  const citacoes = []
  let digests = 0
  for (const f of arquivos) {
    const abs = join(root, f)
    if (!existsSync(abs)) continue
    let texto
    try {
      texto = readFileSync(abs, "utf8")
    } catch (err) {
      throw new Error(`arquivo do escopo ilegível (${f}): ${err?.message ?? err}`)
    }
    const r = extrairCitacoes(texto, f)
    citacoes.push(...r.citacoes)
    digests += r.digests
  }
  // O auditor ENTRA na lista de arquivos (é um arquivo do escopo) mas sai da
  // varredura de citações: `arquivosDoEscopo` filtra ele, e o número relatado é
  // o do escopo EFETIVO — o que o veredito realmente cobriu.
  const aval = avaliarCitacoes({ citacoes, verificar: verificar ?? verificadorGit(root) })
  return { ...aval, digests, escopoArquivos: arquivos.length, root }
}

// ── o remédio mecânico ──────────────────────────────────────────────────────

/**
 * A troca dos TOKENS numa linha: o nome órfão vira o nome que a dobra deixou.
 *
 * Nada mais da linha é tocado — o remendo é a troca do IDENTIFICADOR, não uma
 * reescrita de prosa. A substituição é por TOKEN (não por posição de coluna): a
 * mesma citação pode aparecer mais de uma vez na linha, e as duas descrevem o
 * mesmo ato (o mesmo commit), então as duas recebem o mesmo nome.
 *
 * @param {string} linha
 * @param {{token: string, candidato: string}[]} trocas
 * @returns {string}
 */
export function trocarTokens(linha, trocas) {
  let nova = linha
  for (const t of trocas) nova = nova.split(t.token).join(t.candidato)
  return nova
}

/**
 * O REMÉDIO da citação órfã — a troca do nome antigo pelo nome que a rewrite
 * deixou, com o desfecho MEDIDO antes de gravar.
 *
 * `dry` decide SÓ se o arquivo é gravado: o que entra em `fixed` e o que sobra em
 * `refused`/`recusados` é idêntico nos dois modos (é o que permite o preview do
 * `--fix --dry-run` e o patch do PR serem o MESMO remendo que a gravação faria).
 *
 * @param {string} root
 * @param {{dry?: boolean}} [opts]
 * @returns {{fixed: {file: string, line: number, before: string, after: string,
 *   linhasAntes: string[], linhaDepois: string}[],
 *   refused: {file: string, line: number|null, reason: string}[],
 *   recusados: {file: string, motivo: string}[], unread: {path: string, motivo: string}[],
 *   indisponivel: string|null}}
 */
export function fixAll(root, { dry = false } = {}) {
  let aval
  try {
    aval = auditar({ root })
  } catch (e) {
    // O guard recusa cunhar veredito sem ter lido todo o escopo — o remédio segue
    // a mesma régua: sem medição não há remendo (e não é "nada a remendar").
    return {
      fixed: [],
      refused: [],
      recusados: [],
      unread: [],
      indisponivel: e?.message ?? String(e),
    }
  }
  const fixed = []
  const refused = []
  const recusados = []
  // Agrupa por ARQUIVO e, dentro dele, por LINHA: o patch é por linha (um hunk
  // cobre a linha inteira), e duas citações na mesma linha viram UMA troca.
  const porArquivo = new Map()
  for (const o of aval.orfaos) {
    if (!o.candidato) {
      refused.push({
        file: o.file,
        line: o.line,
        reason:
          "não há commit de MESMO assunto na história do HEAD — o remédio mecânico não sabe qual nome a rewrite deixou",
      })
      continue
    }
    if (!porArquivo.has(o.file)) porArquivo.set(o.file, new Map())
    const porLinha = porArquivo.get(o.file)
    const lista = porLinha.get(o.line) ?? []
    lista.push(o)
    porLinha.set(o.line, lista)
  }
  // O token que não existe como commit NÃO tem nome para onde reescrever: ele sai
  // nomeado (com o arquivo e a linha), e não desaparece do relatório do remédio.
  for (const i of aval.inexistentes) {
    refused.push({
      file: i.file,
      line: i.line,
      reason:
        "o token não existe como commit nenhum — não há nome vivo para onde reescrever (o remédio não inventa um hash)",
    })
  }

  for (const [file, porLinha] of porArquivo) {
    let conteudo
    try {
      conteudo = readFileSync(join(root, file), "utf8")
    } catch (e) {
      recusados.push({ file, motivo: `ilegível na hora do remendo: ${e?.message ?? e}` })
      continue
    }
    const linhas = conteudo.split("\n")
    const doArquivo = []
    for (const [line, lista] of porLinha) {
      const original = linhas[line - 1]
      if (original === undefined) {
        recusados.push({ file, motivo: `a linha ${line} não existe mais no arquivo` })
        continue
      }
      // O CR do fim da linha fica FORA da troca (um `--fix` que convertesse
      // terminador seria uma mudança que ninguém pediu).
      const cr = original.endsWith("\r") ? "\r" : ""
      const crua = cr === "" ? original : original.slice(0, -1)
      const nova = trocarTokens(crua, lista)
      if (nova === crua) {
        recusados.push({
          file,
          motivo: `a linha ${line} não contém mais \`${lista.map((o) => o.token).join("`, `")}\` (o arquivo mudou desde a medição)`,
        })
        continue
      }
      linhas[line - 1] = `${nova}${cr}`
      doArquivo.push({
        file,
        line,
        before: lista.map((o) => o.token).join(", "),
        after: lista.map((o) => o.candidato).join(", "),
        linhasAntes: [crua],
        linhaDepois: nova,
      })
    }
    if (doArquivo.length === 0) continue
    const novoConteudo = linhas.join("\n")
    // O remédio PROVA o efeito antes de escrever: um token que sobrevivesse à
    // troca deixaria o arquivo com o defeito E a alegação de que foi remendado.
    const sobraram = doArquivo.filter((f) => novoConteudo.includes(f.before.split(", ")[0]))
    if (sobraram.length > 0) {
      recusados.push({
        file,
        motivo: `a reescrita NÃO removeu ${sobraram.map((f) => `${f.before} (linha ${f.line})`).join(", ")} — NÃO gravado`,
      })
      continue
    }
    if (!dry) writeFileSync(join(root, file), novoConteudo)
    fixed.push(...doArquivo)
  }

  return { fixed, refused, recusados, unread: [], indisponivel: null }
}

/**
 * O diff unificado de um remendo — a MESMA grafia do `--fix` do resto do
 * repositório (`unified-patch.mjs`), com o `root` do gate (não o `cwd` de quem
 * chamou: um fixture vive em `--root X`).
 *
 * @param {{file: string, line: number, linhasAntes: string[], linhaDepois: string}[]} fixed
 * @param {{root?: string, read?: Function}} [opts]
 * @returns {{patch: string, ilegiveis: {file: string, motivo: string}[]}}
 */
export function docPatch(fixed, { root = ROOT, read = readFileSync } = {}) {
  return patchPorArquivo(fixed, {
    ler: (file) => linhasDe(read(join(root, file), "utf8")),
  })
}

/**
 * O PATCH do remédio das citações — o que o `--fix` GRAVARIA, sem gravar nada.
 *
 * É o produtor que o CANAL DO PR consome (`remedyPatch`): o comentário publica o
 * MESMO patch que o `--fix --dry-run` imprime, e um preview com régua própria
 * prometeria um remendo que a gravação recusaria.
 *
 * As chaves que o publicador confere antes de dizer "mediu" (`patch`, `fixed`,
 * `refused`, `unread`, `yamlInvalido`, `indisponivel`) estão todas aqui — e as
 * seções que só existem para as outras fontes do publicador saem VAZIAS, em vez de
 * a régua ser duplicada para caber na forma.
 *
 * @param {string} [root]
 * @returns {{patch: string, fixed: object[], refused: {file: string, line: number|null, reason: string}[],
 *   recusados: {file: string, motivo: string}[], unread: {path: string, motivo: string}[],
 *   indisponivel: string|null, shellFailures: object[], embeddedFailures: object[],
 *   payloadFailures: object[], yamlInvalido: object[]}}
 */
export function remedyPatch(root = ROOT) {
  const r = fixAll(root, { dry: true })
  const { patch, ilegiveis } = docPatch(r.fixed, { root })
  return {
    ...r,
    shellFailures: [],
    embeddedFailures: [],
    payloadFailures: [],
    yamlInvalido: [],
    patch,
    // Um arquivo que abriu na varredura e não abre na hora de MONTAR o patch sai
    // aqui como NÃO LIDO: o patch sairia sem ele, e o publicador anunciaria um
    // remendo que não cobre o que ele não conseguiu ler.
    unread: [...r.unread, ...ilegiveis.map((i) => ({ path: i.file, motivo: i.motivo }))],
  }
}

/**
 * A CONFIRMAÇÃO EXPLÍCITA do remédio — o mesmo contrato de `check-hook-commands`.
 *
 * `--yes` é a confirmação DECLARADA por quem chama. Sem `--yes`, quem pergunta é
 * o TERMINAL DE CONTROLE (`/dev/tty`) quando o stdin não é um terminal — o caso
 * MEDIDO do `git commit` (o git liga o fd 0 em `/dev/null`). Sem terminal não se
 * pergunta e NADA é autorizado: um remédio que se aplicasse sozinho depois de uma
 * pergunta que ninguém leu seria pior que a ausência dele.
 *
 * @param {string} pergunta
 * @param {{isTTY?: boolean, askFn?: Function|null, openTty?: Function, noPrompt?: boolean,
 *   ttyWaitMs?: number, yes?: boolean, log?: Function}} [deps]
 * @returns {Promise<{autorizado: boolean, motivo: string|null}>}
 */
export async function confirma(
  pergunta,
  {
    isTTY = Boolean(process.stdin.isTTY),
    askFn = null,
    openTty = openTerminal,
    noPrompt = noPromptEnv(),
    ttyWaitMs = TTY_WAIT_MS,
    yes = false,
    log = (m) => process.stderr.write(`${m}\n`),
  } = {},
) {
  if (yes) return { autorizado: true, motivo: "--yes: a confirmação já foi dada por quem chama" }
  const tty = !isTTY && askFn === null && !noPrompt ? openTty() : null
  if (!isTTY && askFn === null && tty === null) {
    log(
      `\n❌ SEM TERMINAL: o remédio das citações exige confirmação explícita, e aqui não há a quem perguntar\n` +
        (noPrompt
          ? `   (a pergunta está DESLIGADA pelo ambiente)\n`
          : `   (/dev/tty não abriu: esta sessão não tem terminal de controle).\n`),
    )
    return { autorizado: false, motivo: "sem terminal" }
  }
  const alvo = { input: tty?.input ?? process.stdin, output: tty?.output ?? process.stderr }
  const resposta = await (
    askFn ?? ((q) => ask(q, { ...alvo, waitMs: tty === null ? 0 : ttyWaitMs }))
  )(pergunta)
  if (tty !== null) {
    tty.input.destroy()
    tty.output.destroy()
  }
  if (resposta === TIMEOUT) {
    log(
      `   ⏱  SEM RESPOSTA em ${Math.round(ttyWaitMs / 1000)}s — o remédio assume NÃO (o default).\n`,
    )
    return { autorizado: false, motivo: "sem resposta (timeout)" }
  }
  const ok = AFFIRMATIVE.test(String(resposta).trim())
  return { autorizado: ok, motivo: ok ? null : "resposta negativa" }
}

// ── CLI ─────────────────────────────────────────────────────────────────────

export const USAGE = `check-doc-hashes — toda citação de commit na prosa pertence à história do HEAD.

Rewrites (rebase/amend/dobra) trocam o NOME dos commits preservando o assunto: a
citação velha vira ÓRFÃ (o objeto existe, mas fora da história) e a doc passa a
descrever um ato que ninguém consegue abrir. O guard julga a prosa contra a
história e, no órfão, nomeia o commit de MESMO assunto — o nome que a rewrite
deixou.

Usage:
  node scripts/check-doc-hashes.mjs         # julga a árvore (escopo declarado)
  node scripts/check-doc-hashes.mjs --json  # relatório estruturado
  node scripts/check-doc-hashes.mjs --all   # + os tokens lidos como digest
  node scripts/check-doc-hashes.mjs --root X  # outro checkout (fixture)
  node scripts/check-doc-hashes.mjs -h

Exit codes: 0 tudo na história · 1 citação órfã ou hash sem commit · 2 infra`

const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (IS_DIRECT_RUN) {
  const args = process.argv.slice(2)
  if (args.includes("-h") || args.includes("--help")) {
    console.log(USAGE)
    process.exit(EXIT.OK)
  }
  const rootIdx = args.indexOf("--root")
  if (rootIdx !== -1 && !args[rootIdx + 1]) {
    console.error("❌ --root exige um diretório (fail-closed)")
    process.exit(EXIT.USO)
  }
  const root = rootIdx !== -1 ? resolve(args[rootIdx + 1]) : ROOT
  if (!existsSync(root)) {
    console.error(`❌ --root inexistente: ${root}`)
    process.exit(EXIT.USO)
  }
  const conhecidas = ["--root", "--json", "--all", "--fix", "--dry-run", "--yes", "-h", "--help"]
  const desconhecida = args.find((a) => a.startsWith("--") && !conhecidas.includes(a))
  if (desconhecida) {
    console.error(`❌ flag desconhecida: ${desconhecida}`)
    process.exit(EXIT.USO)
  }
  // `--dry-run` é a PREVISÃO do remédio e `--yes` a confirmação dele: sem o
  // `--fix` nenhum dos dois tem o que prever ou confirmar — tratar isso como uso
  // válido devolveria o veredito do gate com uma flag que ninguém leu.
  for (const [flag, porque] of [
    ["--dry-run", "é a previsão do remédio"],
    ["--yes", "confirma um remédio"],
  ]) {
    if (args.includes(flag) && !args.includes("--fix")) {
      console.error(`❌ ${flag} só tem efeito com --fix (${porque})`)
      process.exit(EXIT.USO)
    }
  }

  // ── O REMÉDIO (`--fix`): a troca do nome antigo pelo nome que a dobra deixou
  if (args.includes("--fix")) {
    const dryRun = args.includes("--dry-run")
    const json = args.includes("--json")
    const previa = fixAll(root, { dry: true })
    if (previa.indisponivel) {
      console.error(`❌ --fix indisponível: ${previa.indisponivel}`)
      process.exit(EXIT.USO)
    }
    const tot = previa.fixed.length + previa.refused.length + previa.recusados.length
    if (dryRun) {
      // ── PREVIEW: o patch que a gravação faria, e NADA é gravado ─────────
      const { patch, ilegiveis } = docPatch(previa.fixed, { root })
      // Um arquivo que não abre na hora de montar o patch não vira "nada a
      // remendar": o patch sairia sem ele e quem aplicasse o acharia completo.
      if (ilegiveis.length > 0) {
        console.error(
          `❌ --fix --dry-run: não consegui ler para montar o patch: ` +
            ilegiveis.map((i) => `${i.file} (${i.motivo})`).join(", "),
        )
        process.exit(EXIT.USO)
      }
      if (json) {
        console.log(
          JSON.stringify(
            {
              root,
              dryRun: true,
              patch,
              fixed: previa.fixed.map(({ file, line, before, after }) => ({
                file,
                line,
                before,
                after,
              })),
              refused: previa.refused,
              recusados: previa.recusados,
              unread: previa.unread,
            },
            null,
            2,
          ),
        )
        process.exit(EXIT.OK)
      }
      if (patch === "") {
        console.error(
          `── preview (--fix --dry-run): nada a remendar mecanicamente (${previa.refused.length} citação(ões) pedem mão); NADA foi gravado`,
        )
        for (const r of previa.refused) console.error(`   ⛔ ${r.file}:${r.line} — ${r.reason}`)
        for (const r of previa.recusados) console.error(`   ⛔ ${r.file} — ${r.motivo}`)
        process.exit(EXIT.OK)
      }
      console.error(
        `── preview (--fix --dry-run): ${previa.fixed.length} citação(ões) órfã(s) em ` +
          `${new Set(previa.fixed.map((f) => f.file)).size} arquivo(s); NADA foi gravado`,
      )
      if (previa.refused.length > 0) {
        console.error(`   ${previa.refused.length} citação(ões) NÃO cobertas pelo patch:`)
        for (const r of previa.refused) console.error(`     ${r.file}:${r.line}`)
      }
      process.stdout.write(patch)
      process.exit(EXIT.OK)
    }

    // ── O RELATÓRIO antes da pergunta: quem confirma precisa ver o que muda
    for (const f of previa.fixed) {
      console.error(`   ${f.file}:${f.line} — \`${f.before}\` → \`${f.after}\``)
    }
    for (const r of previa.refused) console.error(`   ⛔ ${r.file}:${r.line} — ${r.reason}`)
    for (const r of previa.recusados) console.error(`   ⛔ ${r.file} — ${r.motivo}`)
    // Sem caso mecânico a pergunta é uma porta que não leva a lugar nenhum: o
    // remédio diz o que sobrou (com o motivo) e devolve o veredito do gate.
    if (previa.fixed.length === 0) {
      console.error(
        `\n❌ há ${tot} violação(ões) e NENHUMA tem remédio mecânico — NADA foi gravado:\n` +
          `   o órfão sem commit de mesmo assunto na história e o hash que não existe\n` +
          `   pedem a decisão de quem escreveu a citação (ou uma não-citação declarada).\n`,
      )
      process.exit(tot > 0 ? EXIT.VIOLACAO : EXIT.OK)
    }
    const { autorizado, motivo } = await confirma(`\n   ${OFFER_MARKER} `, {
      yes: args.includes("--yes"),
    })
    if (!autorizado) {
      console.error(
        `   NADA foi gravado (${motivo}). O caminho à mão:\n` +
          `     node scripts/check-doc-hashes.mjs --fix --dry-run | git apply\n`,
      )
      process.exit(EXIT.VIOLACAO)
    }
    const aplicado = fixAll(root, { dry: false })
    if (aplicado.indisponivel) {
      console.error(`❌ --fix indisponível: ${aplicado.indisponivel}`)
      process.exit(EXIT.USO)
    }
    for (const f of aplicado.fixed) {
      console.error(`✔ ${f.file}:${f.line} — \`${f.before}\` → \`${f.after}\``)
    }
    for (const r of aplicado.recusados) console.error(`   ⛔ ${r.file} — ${r.motivo}`)
    // ── A REVALIDAÇÃO: a MESMA régua, depois do remendo ────────────────
    let depois
    try {
      depois = auditar({ root })
    } catch (e) {
      console.error(
        `❌ o guard não pôde ser re-medido depois do remendo: ${e?.message ?? e}\n` +
          `   o remendo está na ÁRVORE e o veredito é DESCONHECIDO.`,
      )
      process.exit(EXIT.USO)
    }
    const restam = depois.orfaos.length + depois.inexistentes.length
    console.error(
      `\n--fix: ${aplicado.fixed.length} citação(ões) trocada(s) em ` +
        `${new Set(aplicado.fixed.map((f) => f.file)).size} arquivo(s) — ` +
        `o guard caiu para ${restam} violação(ões).\n` +
        `   O remendo está na ÁRVORE; o COMMIT carrega o ÍNDICE:\n` +
        `     git add ${[...new Set(aplicado.fixed.map((f) => f.file))].join(" ")}\n`,
    )
    for (const o of depois.orfaos)
      console.error(`   ⚠️  ${o.file}:${o.line} ainda órfã \`${o.token}\``)
    for (const i of depois.inexistentes) {
      console.error(`   ⚠️  ${i.file}:${i.line} \`${i.token}\` não existe como commit`)
    }
    process.exit(restam === 0 ? EXIT.OK : EXIT.VIOLACAO)
  }

  let aval
  try {
    aval = auditar({ root })
  } catch (err) {
    console.error(`❌ ${err?.message ?? err}`)
    process.exit(EXIT.USO)
  }
  const violacoes = violacoesDeCitacoes(aval)
  if (args.includes("--json")) {
    console.log(
      JSON.stringify(
        {
          escopoArquivos: aval.escopoArquivos,
          citacoes: aval.citacoes.length,
          naHistoria: aval.naHistoria,
          orfaos: aval.orfaos,
          inexistentes: aval.inexistentes,
          naoCitacoes: aval.naoCitacoes,
          digests: aval.digests,
          violacoes,
        },
        null,
        2,
      ),
    )
    process.exit(violacoes.length === 0 ? EXIT.OK : EXIT.VIOLACAO)
  }
  console.log(renderRelatorio(aval, { escopoArquivos: aval.escopoArquivos }))
  if (args.includes("--all")) {
    console.log(`  digests de artefato (não citam commit): ${aval.digests}`)
    for (const n of aval.naoCitacoes)
      console.log(`  não-citação declarada: ${n.token} (${n.file}:${n.line})`)
  }
  for (const v of violacoes) console.error(`❌ ${v}`)
  if (violacoes.length === 0) {
    console.log("✅ toda citação de commit na prosa pertence à história do HEAD.")
  }
  process.exit(violacoes.length === 0 ? EXIT.OK : EXIT.VIOLACAO)
}
