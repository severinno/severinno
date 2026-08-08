# HSTS Preload — severinno.com.br

> Guia completo para submeter `severinno.com.br` à **HSTS Preload List**
> ([hstspreload.org](https://hstspreload.org/)), com verificação pré-submissão
> e procedimento de remoção.
>
> **⚠️ Aviso crítico:** a inclusão na lista de preload é **praticamente
> irreversível** — o domínio fica "HTTPS-forçado" em todos os browsers por
> **anos**, e a remoção leva **meses** (depende de ciclos de release do Chrome).
> Só submeter quando **toda** a verificação abaixo passar e houver certeza de
> que **nenhum** subdomínio HTTP-only será criado no futuro.

---

## 1. O que é o HSTS preload

O HSTS informa ao browser "só acesse este domínio via HTTPS" enquanto o header
estiver em cache (`max-age`). O **preload** vai além: a lista é embutida no
código-fonte dos browsers (Chrome, Firefox, Safari, Edge), então o browser
**nunca** faz a primeira conexão via HTTP — elimina o ataque de *downgrade*
(SSLStrip) mesmo na primeira visita.

| Browser | Suporte a preload |
|---|---|
| Chrome / Edge | Desde 2015 (Chrome 50+) |
| Firefox | Desde 2015 |
| Safari | Desde 2017 |
| Opera | Sim |

---

## 2. Requisitos do hstspreload.org (atualizados)

Fonte: [hstspreload.org](https://hstspreload.org/) e
[Chromium Wiki — Preload List Processes](https://github.com/chromium/hstspreload.org/wiki/Preload-List-Processes).

### 2.1 Header obrigatório

Todas as respostas **HTTPS** do domínio (página principal **e redirects**)
devem enviar:

```
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
```

| Diretiva | Requisito |
|---|---|
| `max-age` | **≥ 31536000** (1 ano) |
| `includeSubDomains` | Obrigatório |
| `preload` | Obrigatório |

### 2.2 Subdomínios

- **Todo** subdomínio **com registro DNS** deve servir HTTPS válido — inclusive
  internos (ex.: `glitchtip.severinno.com.br`, `www.severinno.com.br`).
- Subdomínios **sem registro DNS** (não resolvem) **não** precisam de HTTPS
  (são isentos).
- O `www`, se tiver registro DNS, **deve** servir HTTPS.

### 2.3 Verificação automática

O site hstspreload.org escaneia o domínio antes de aceitar. Se o scanner não
alcançar o domínio (WAF bloqueando, região bloqueada, DNS não propagado), a
submissão não é aceita.

### 2.4 Prazos

- Inclusão: algumas semanas (a lista é atualizada a cada release do Chrome,
  ~4 semanas).
- **Remoção: meses** — precisa remover a diretiva `preload` do header, esperar
  a remoção do cache HSTS, e então solicitar no
  [hstspreload.org/removal/](https://hstspreload.org/removal/).

---

## 3. Estado atual do repositório (config já em vigor)

O header **já está configurado com a diretiva `preload`** em 3 camadas — a
configuração não precisa de mudança, apenas **verificação em produção**:

| Camada | Arquivo | Linha | Valor |
|---|---|---|---|
| Reverse proxy (prod) | `Caddyfile.prod` | 43 (domínio principal) | `Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"` |
| Reverse proxy (prod) | `Caddyfile.prod` | 182 (glitchtip) | idem |
| Middleware (API/dashboard) | `src/middleware.ts` | 179 | idem |
| Headers estáticos (app) | `next.config.ts` | 97 | idem |

O gate de segurança `scripts/test-security-headers.sh` já valida HSTS
(max-age ≥ 1 ano, `includeSubDomains`, `preload`) em CI.

> ⚠️ **Nota de auditoria (2026-08-07):** a probe ao vivo mostrou que o site
> em produção **não emite o header HSTS ainda** (responde 200 sem o header) e
> que `www.severinno.com.br` resolve para um CDN Hostinger com IPs diferentes
> do apex. **Ambos os pontos devem ser resolvidos antes de submeter** — o
> `www` precisará emitir o header HSTS idêntico ou o scanner rejeitará.

---

## 4. Verificação pré-submissão (obrigatório)

### 4.1 Script automatizado

```bash
# A partir do repo (descobre os hosts do Caddyfile.prod):
./scripts/verify-hsts-preload.sh --ci

# Lista customizada (se quiser checar hosts fora do Caddy):
./scripts/verify-hsts-preload.sh --hosts "severinno.com.br www.severinno.com.br glitchtip.severinno.com.br"
```

O script verifica, por host:
1. DNS resolve?
2. `http://` → redirect 301/302/307/308 para `https://`
3. `https://` responde (HTTP 200)
4. Header `Strict-Transport-Security` presente com `max-age ≥ 31536000`,
   `includeSubDomains` e `preload`

**Exit code 0 = apto a submeter. Qualquer FAIL = não submeter.**

### 4.2 Checklist manual (auditoria final)

- [ ] `./scripts/verify-hsts-preload.sh --ci` → exit 0 para todos os hosts
- [ ] `curl -sI https://severinno.com.br/ | grep -i strict-transport` retorna o
      header com `preload`
- [ ] `curl -sI http://severinno.com.br/` retorna `301/302/308 → https://`
- [ ] **`www.severinno.com.br`** (CDN Hostinger) também emite HSTS idêntico —
      caso contrário, apontar o `www` para o mesmo servidor do apex **antes**
      de submeter
- [ ] `glitchtip.severinno.com.br` (se com DNS) emite HSTS idêntico
- [ ] Nenhum subdomínio HTTP-only ativo (auditar DNS: `dig +short
      severinno.com.br ANY` e cada subdomínio conhecido)
- [ ] Certificado TLS válido (não expirado) e cadeia completa
- [ ] Sem WAF/proxy que bloqueie o scanner do hstspreload.org
- [ ] Confirmar com o time que **não** há planos de subdomínio HTTP-only no
      futuro (ex.: ambiente de staging público em subdomínio)

### 4.3 Resultado da verificação pré-submissão (2026-08-08)

**Veredito: ❌ NÃO SUBMETER — 4 bloqueadores.** Verificação executada com
`scripts/verify-hsts-preload.sh --ci` (exit code **1**) + probes live + API do
hstspreload.org:

| Host | DNS | http → https | https | HSTS | Veredito |
|---|---|---|---|---|---|
| `severinno.com.br` (apex) | ✅ resolve | ✅ 301 → https | 200 OK | ❌ **ausente** | 🔴 Bloqueador |
| `www.severinno.com.br` | ✅ resolve | ✅ 301 → https | 301 (CDN) | ❌ **ausente** | 🔴 Bloqueador |
| `glitchtip.severinno.com.br` | ⚠️ inconsistente¹ | ❌ inalcançável | inalcançável | ❌ ausente | 🔴 Bloqueador |

¹ `nslookup` → NXDOMAIN; o script (via `getent`) reportou resolve. Inconsistência de
resolver — precisa decidir se o subdomínio existe (isento) ou não antes de submeter.

**Achados além dos bloqueadores (auditoria live, 2026-08-08):**

1. 🔴 **O apex serve WordPress da Hostinger, não o app Severinno.** A resposta de
   `https://severinno.com.br` é PHP 8.3.31 / litespeed-cache / `platform: hostinger`
   — **o reverse proxy Caddy (Caddyfile.prod) não está atrás do DNS atual**.
   Corrigir o apontamento/roteamento do domínio **antes** de pensar em submeter.
2. 🔴 **Nenhum host emite HSTS** — o scanner do hstspreload.org rejeitaria a submissão
   na hora. A config em 3 camadas (§3) existe no repo, mas não está servida em prod.
3. ✅ **Redirect http→https correto** no apex e no `www` (301 → https).
4. ✅ **Status oficial da API:** `{"status": "unknown"}` para apex e `www` — o
   domínio **nunca foi submetido** (nem está pending).

**Passos antes de submeter (nesta ordem):**
1. Apontar `severinno.com.br` para o servidor do app (Caddy atrás do DNS) e
   confirmar que o header HSTS completo (`max-age=31536000; includeSubDomains;
   preload`) sai em todas as respostas HTTPS, inclusive redirects.
2. Resolver o `www`: ou apontar para o mesmo servidor do apex (preferido — emite
   HSTS idêntico), ou **remover o registro DNS** (fica isento). Hoje o `www` é CDN
   WordPress Hostinger sem HSTS — os dois casos bloqueiam.
3. Decidir o destino de `glitchtip.severinno.com.br` (subir com HSTS ou remover DNS).
4. Re-rodar `bash scripts/verify-hsts-preload.sh --ci` até **exit 0** (8/8 asserções
   dos 2 hosts ativos) e então seguir o §5.

---

## 5. Procedimento de submissão

1. **Rode a verificação** (seção 4) e confirme todos os PASS.
2. Acesse **https://hstspreload.org/**.
3. Digite `severinno.com.br` no campo e clique **Check HSTS preload status**.
   - Deve aparecer *"The domain is eligible for preloading"* (ou o scanner
     mostra o que falta).
4. Clique em **Submit severinno.com.br** (o formulário só aparece se elegível).
5. Confirme o formulário (aceite os termos — a submissão é irreversível).
6. Acompanhe o status em https://hstspreload.org/ — *"Pending Submission"*
   pode persistir por **semanas** (aguarda o próximo release do Chrome).
7. Após inclusão, o domínio passa a ser HTTPS-forçado em todos os browsers.

> Não submeter `www.severinno.com.br` como domínio separado: o preload do apex
> com `includeSubDomains` cobre o `www`. Submeter os dois seria redundante.

---

## 6. Pós-submissão

- Manter o header **permanentemente** (não remover `preload`).
- O `test-security-headers.sh` em CI já garante que o header nunca regrida.
- Monitorar erros de conexão: se um usuário relatar "conexão bloqueada", quase
  sempre é um host HTTP-only não previsto — o preload **não permite fallback**.

---

## 7. Remoção (só se absolutamente necessário)

1. Remova a diretiva `preload` do header (mantendo `max-age` +
   `includeSubDomains`).
2. Aguarde o cache HSTS expirar (`max-age` atual) e o header ser propagado.
3. Solicite a remoção em https://hstspreload.org/removal/.
4. A remoção da lista **global** leva meses (depende dos releases do Chrome).

---

## 8. Referências

- [hstspreload.org](https://hstspreload.org/)
- [hstspreload.org/removal/](https://hstspreload.org/removal/)
- [Chromium Wiki — Preload List Processes](https://github.com/chromium/hstspreload.org/wiki/Preload-List-Processes)
- [MDN — Strict-Transport-Security](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security)
- [OWASP — HTTP Strict Transport Security](https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Strict_Transport_Security_Cheat_Sheet.html)
