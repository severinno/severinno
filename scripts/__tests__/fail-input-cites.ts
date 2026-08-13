/**
 * fail-input-cites.ts - a derivada COMPARTILHADA das citacoes de input em
 * mensagens de fail dos DOIS helpers de prova (hook-proof-run.mjs +
 * ci-proof-run.mjs). A fonte unica da regra dos 2 usos da sec 11.115: as
 * suites do ci (11.105) e do hook (11.115) importam DAQUI - nunca uma copia
 * que pudesse driftar.
 *
 * WHY (a secao 11.115): a derivada original do ci NAO era portavel para o
 * hook - o regex so pegava a forma simples `${opts.X}`, e o hook usa
 * ternarios (`${opts.cleanupOnFail ? ...}`) e args de funcao (`opts.branch,`
 * dentro do cleanupOnFailSuffix(...)); alem disso, o fail sem-template do
 * hook (fail(1, check.message)) faria a derivada agarrar o backtick errado
 * (um console.log como falso-positivo). A versao corrigida usa o regex AMPLO
 * (opts.X + o alias ${b}) e o skip do fail sem-template via paren-matching
 * (o template abre DENTRO do fail(...)): reproduz EXATAMENTE as mesmas 17
 * citacoes do ci (o ABS PIN da 11.105 intacto, comparado 2026-08-13) e
 * produz 31 no hook com 0 offenders em plan/log.
 */

export interface InputCite {
  line: number
  key: string
}

/**
 * As citacoes de input (opts.X / o alias b) dentro dos templates das
 * mensagens de fail(...), com a linha 1-based de CADA citacao. O skip do
 * fail sem-template (fail(1, check.message)) usa paren-matching: o template
 * DEVE abrir dentro dos parens do fail(...) - se o proximo backtick cai
 * DEPOIS do fechamento, ele pertence a outro call (um console.log).
 */
export function failMsgInputCites(src: string): InputCite[] {
  const out: InputCite[] = []
  const lineOf = (idx: number) => src.slice(0, idx).split("\n").length
  let from = 0
  while (true) {
    const fIdx = src.indexOf("fail(", from)
    if (fIdx < 0) break
    const btIdx = src.indexOf("`", fIdx)
    let skip = btIdx < 0
    if (!skip) {
      let depth = 0
      let closeParen = -1
      for (let i = fIdx + 4; i < src.length; i++) {
        const ch = src[i]
        if (ch === "(") depth++
        else if (ch === ")") {
          depth--
          if (depth === 0) {
            closeParen = i
            break
          }
        }
      }
      skip = btIdx > closeParen
    }
    if (skip) {
      from = fIdx + 5
      continue
    }
    // O span do template pode ter MULTIPLAS partes concatenadas
    // (`fail(N, `parte1` + `parte2`)` - como os fails de 563-566 e
    // 726-730 do ci): caminha as continuacoes `+ `...`` para o text cobrir o
    // fail INTEIRO (a classe do RESIDUAL da sec 11.105 - fechada aqui; o
    // parser e simples porque as expressoes ${...} do source usam aspas
    // duplas, sem backtick aninhado).
    let spanEnd = btIdx + 1
    let partEnd: number
    while (true) {
      partEnd = spanEnd
      while (partEnd < src.length) {
        if (src[partEnd] === "\\") {
          partEnd += 2
          continue
        }
        if (src[partEnd] === "`") break
        partEnd++
      }
      // apos o backtick de fechamento: espacos + `+` + espacos + backtick
      // = proxima parte concatenada do MESMO fail(
      let k = partEnd + 1
      while (k < src.length && /\s/.test(src[k])) k++
      if (src[k] === "+") {
        k++
        while (k < src.length && /\s/.test(src[k])) k++
        if (src[k] === "`") {
          spanEnd = k + 1
          continue
        }
      }
      break
    }
    const text = src.slice(btIdx + 1, partEnd)
    const startLine = lineOf(btIdx + 1)
    const re = /opts\.([a-zA-Z][a-zA-Z0-9]*)|(\$\{b\})/g
    let m
    while ((m = re.exec(text)) !== null) {
      const citeLine = startLine + text.slice(0, m.index).split("\n").length - 1
      out.push({ line: citeLine, key: m[1] ? `opts.${m[1]}` : "b (alias de opts.branch)" })
    }
    from = partEnd + 1
  }
  return out
}

/** As keys do parseArgs derivadas mecanicamente: os `out.X =` do body. */
export function parseArgsKeys(src: string): string[] {
  const keys = new Set<string>()
  const re = /out\.([a-zA-Z][a-zA-Z0-9]*)\s*=/g
  let m
  while ((m = re.exec(src)) !== null) keys.add(m[1])
  return [...keys].sort()
}
