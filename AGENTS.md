<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Testes exigem `bun` no PATH

As meta-suítes (doctor-ci, forge-doctor, pre-push-blocks, prove-runner-image,
pre-commit-real-proof) rodam **provas reais** que invocam `bun` por `spawnSync`.
Sem o binário no PATH, a prova sai `unavailable` **fail-closed** (nunca falseia
veredito) e a suíte falha com `spawnSync bun ENOENT`.

O instalador do Bun edita o `~/.bashrc`, mas o guard interativo do arquivo
(`case $- in *i*) ;; *) return;; esac`) faz shells **não-interativos** (testes,
hooks, act) retornarem antes de alcançá-lo. Fix permanente — symlink em
`~/.local/bin` (já no PATH de shells não-interativos; sobrevive a self-updates):

```bash
ln -sf ~/.bun/bin/bun  ~/.local/bin/bun
ln -sf ~/.bun/bin/bunx ~/.local/bin/bunx
```

No CI a imagem oficial já resolve o binário — a exigência vale para shells locais.
