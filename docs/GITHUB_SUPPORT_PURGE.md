# GitHub Support — Pedido de Purge de Refs de Pull Request

> **Data**: 2026-09-07
> **Motivo**: após `git filter-repo` limpar o histórico de `main`, tags e
> branches, 16 **PRs fechados** ainda mantêm refs `refs/pull/N/head` no GitHub
> apontando para commits que continham `.env` / `.env.production` no histórico.
> Essas refs são ocultas ("hidden refs") e o GitHub **bloqueia** push/delete
> via git (`deny updating a hidden ref`) — a única via oficial é o suporte.

---

## Contexto do que já foi feito

1. **Rotação de secrets** (sessão anterior): os 5 valores expostos foram
   rotacionados (DB password, S3/WhatsApp dev, GLITCHTIP_SECRET) — os valores
   antigos **não funcionam mais**. A purga do histórico é defesa em profundidade.
2. **`git filter-repo`** (hoje): removidos `.env` e `.env.production` de todo o
   histórico do repositório local (424 → 326 commits). Validação: árvore do HEAD
   idêntica ao backup pré-purga (0 arquivos legítimos perdidos).
3. **Force push** já feito no GitHub:
   - `main` → reescrito limpo
   - 22 tags (`v0.3.0-cache-mvp`, `v0.4.0`, `v1.0.0`, 19 `freebuff-snapshot/*`)
   - `release/v0.4.0` → reescrita limpa
   - 7 branches `dependabot/*` → já não existiam no remote

## O que falta (pedido ao suporte)

16 PRs **fechados** mantêm refs que ainda apontam para histórico antigo com
secrets:

| PRs   | Head ref atual                                                             |
| ----- | -------------------------------------------------------------------------- |
| 1–8   | feature/merge PRs antigos (contêm `.env` + `.env.production` no histórico) |
| 9     | `release/v0.4.0` (pré-reescrita)                                           |
| 10–16 | dependabot bumps (contêm `.env` no histórico)                              |

### Template do pedido

Enviar em: **https://support.github.com/contact** (categoria: "Report abuse /
security" → "Security vulnerability" ou "Repository" → "Other")

```
Subject: Request to purge leaked secrets from closed pull request refs

Repo: github.com/severinno/severinno
Date: 2026-09-07

We ran `git filter-repo --path .env --path .env.production --invert-paths`
and force-pushed clean history to main, all tags, and release/v0.4.0.
However, 16 closed pull requests still expose old commits containing
`.env`/`.env.production` files with secrets via hidden refs:

  refs/pull/1/head  … refs/pull/16/head

Git rejects updates/deletes to these hidden refs
("deny updating a hidden ref"). Please purge/delete the above
`refs/pull/*/head` refs so the historical blobs are no longer reachable.

Affected secret values were already rotated and are no longer valid;
this request is defense-in-depth so old `.env` blobs are unreachable.

Thanks!
```

### Alternativas se o suporte não puder ajudar

1. **Recriar o repositório**: criar `severinno` novo, push do histórico limpo,
   fechar/abandonar os PRs antigos. Perde stars/issues/comentários dos PRs.
2. **Aceitar o risco**: valores já rotacionados + repo de acesso restrito.

---

## Notas operacionais

- Backup do estado pré-purga: `/tmp/severinno-mirror-backup` (mirror, local).
- O `.env` local atual (com os secrets rotacionados ativos) **não foi tocado**
  e continua gitignored (`mode 0600`).
- `docs/SECRET_ROTATION.md` já documentava este procedimento (checklist item:
  reescrever histórico com `git filter-repo`).
