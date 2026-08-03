#!/usr/bin/env python3
"""test_audit_blob_crlf_history.py — testes unitários do parser --all-text.

Usage:
  python3 scripts/test_audit_blob_crlf_history.py

Exit codes:
  0 = all tests pass; 1 = test failure (unittest).

Cobre `load_all_text_patterns` (parse do .gitattributes) DIRETAMENTE em
Python — além dos testes de integração vitest (audit-blob-crlf-history.test.ts),
que exercitam o parser via fixture de repo git real (blob CRLF commitado +
CHECK_CRLF_ROOT). Os casos aqui são unitários: um .gitattributes FAKE em
memória com linhas tricky — comentário, espaçamento múltiplo, ordem
invertida dos atributos, `*.MD` maiúsculo, `binary`/`text=auto` — travando
o comportamento do parser linha a linha.

FONTE ÚNICA: este script importa `load_all_text_patterns` do módulo real
(scripts/audit_blob_crlf_history.py) — se o parser mudar de semântica
(ex.: aceitar `binary`, quebrar com tab, duplicar o complemento), os
testes falham antes do merge.

CI:   job `blob-crlf-history-audit` no pr-check.yml (passo 'Testar parser').
"""

import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from audit_blob_crlf_history import ALL_TEXT_EXTS_COMPLEMENT, load_all_text_patterns

COMP = tuple(ALL_TEXT_EXTS_COMPLEMENT)  # ("*.bash",) — complemento fixo do --all-text


class LoadAllTextPatternsTest(unittest.TestCase):
    """Parse do .gitattributes — casos tricky linha a linha."""

    def _parse(self, content: str) -> tuple[str, ...]:
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, ".gitattributes")
            with open(path, "w", encoding="utf-8", newline="\n") as fh:
                fh.write(content)
            return load_all_text_patterns(path)

    # ── 1. comentário / linhas vazias ─────────────────────────────────
    def test_comentarios_e_vazias_ignorados(self):
        self.assertEqual(self._parse("# apenas comentário\n\n   \n# outro\n"), COMP)

    # ── 2. espaçamento múltiplo ───────────────────────────────────────
    def test_espacamento_multiplo_aceito(self):
        self.assertEqual(self._parse("*.md     text     eol=lf\n"), ("*.md",) + COMP)

    def test_tabs_aceitos(self):
        self.assertEqual(self._parse("*.md\ttext\teol=lf\n"), ("*.md",) + COMP)

    # ── 3. ordem invertida dos atributos ──────────────────────────────
    def test_ordem_invertida_eol_lf_primeiro(self):
        # 'eol=lf text' — a checagem é de MEMBRESIA no token set, não de
        # posição: qualquer ordem de text/eol=lf na linha é aceita.
        self.assertEqual(self._parse("*.md eol=lf text\n"), ("*.md",) + COMP)

    # ── 4. maiúscula ──────────────────────────────────────────────────
    def test_maiuscula_preservada_e_dedupe_case_sensitive(self):
        # O parser PRESERVA a forma do arquivo ('*.MD' não é baixado) e o
        # dedupe é case-sensitive — o MATCHING é que é case-insensitive
        # (re.IGNORECASE no _glob_to_regex). Comportamento documentado.
        self.assertEqual(
            self._parse("*.md text eol=lf\n*.MD text eol=lf\n"), ("*.md", "*.MD") + COMP
        )

    # ── 5. binary / text=auto ─────────────────────────────────────────
    def test_binary_excluido(self):
        self.assertEqual(self._parse("*.png binary\n"), COMP)

    def test_text_auto_excluido(self):
        # 'text=auto' é UM token — não o token 'text'. Fora do escopo.
        self.assertEqual(self._parse("* text=auto\n"), COMP)

    def test_text_sem_eol_lf_excluido(self):
        self.assertEqual(self._parse("*.txt text eol=crlf\n"), COMP)

    def test_linha_com_menos_de_3_tokens_ignorada(self):
        # '*.txt text' (2 tokens) nem chega à checagem de atributos.
        self.assertEqual(self._parse("*.txt text\n"), COMP)

    # ── 6. dedupe ─────────────────────────────────────────────────────
    def test_dedupe_linha_duplicada(self):
        self.assertEqual(self._parse("*.md text eol=lf\n*.md text eol=lf\n"), ("*.md",) + COMP)

    def test_complemento_bash_nao_duplica(self):
        # '*.bash' já declarado no arquivo → o complemento fixo não duplica.
        # Usa COMP (não o literal) — o que está em teste é o não-duplo, não
        # o valor da constante (que pode mudar num bump futuro).
        self.assertEqual(self._parse("*.bash text eol=lf\n"), COMP)

    # ── 7. ordem preservada + complemento no fim ──────────────────────
    def test_ordem_preservada_complemento_no_fim(self):
        content = "*.md text eol=lf\n*.ts eol=lf text\nMakefile text eol=lf\n"
        self.assertEqual(self._parse(content), ("*.md", "*.ts", "Makefile") + COMP)

    # ── 8. comentário inline tolerado ─────────────────────────────────
    def test_comentario_inline_tolerado(self):
        # Comentário no FIM da linha não quebra o parse (os tokens extras
        # não removem text/eol=lf do conjunto). Comportamento atual travado.
        self.assertEqual(self._parse("*.md text eol=lf # markdown\n"), ("*.md",) + COMP)

    # ── 9. fail-closed ────────────────────────────────────────────────
    def test_arquivo_ausente_raise(self):
        with self.assertRaises(FileNotFoundError):
            load_all_text_patterns("/nao-existe/.gitattributes")

    # ── 10. integração mista (todos os tricky juntos) ─────────────────
    def test_integracao_mista(self):
        content = (
            "# .gitattributes fake\n"
            "\n"
            "*.md    text    eol=lf\n"
            "*.ts eol=lf text\n"
            "*.MD text eol=lf\n"
            "*.png binary\n"
            "* text=auto\n"
            "Makefile text eol=lf\n"
            "Caddyfile* text eol=lf\n"
            ".husky/* text eol=lf\n"
            "*.sh text eol=lf\n"
        )
        # Além dos sufixos *.ext, a derivação captura nomes exatos (Makefile),
        # globs de prefixo (Caddyfile*) e padrões ancorados (.husky/*) — o
        # complemento *.bash só entra no fim (dedupe).
        expected = ("*.md", "*.ts", "*.MD", "Makefile", "Caddyfile*", ".husky/*", "*.sh") + COMP
        self.assertEqual(self._parse(content), expected)


if __name__ == "__main__":
    unittest.main(verbosity=2)
