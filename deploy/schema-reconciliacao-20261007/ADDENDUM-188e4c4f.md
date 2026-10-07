# Addendum — reconciliação interpretando o commit citado (07/10/2026)

O turno anterior reconciliou DB → schema do **HEAD local** (114509a2). Depois,
o mesmo método foi re-executado alinhado ao **commit citado 188e4c4f** (que é
o HEAD da forja/nas imagens de pipeline e não contém as 5 migrations nem o
re-doc das famílias C9+):

## Delta remanescente DB(HED) → schema(188e4c4f) — medido, não presumido

- `IdempotencyRecord` (tabela de idempotency) removida (só existe no HEAD);
- `soundEnabled/vibrateEnabled` (User) removidas (só no HEAD);
- 8 colunas monetárias de `numeric` → `double precision` (o SQL canônico
  dinheiro=Floating só entra na migration C9 `20260930120000_money_decimal`);
- 2 índices GIN de `search_vector` marcados como "removed" pelo prisma
  (hand-made; eles permanecem ATIVOS no banco — prisma não os conhece).

## Execução (mesmo protocolo)

- Backup B prévio: `/root/pre-reconc-B-20261007-103026` (127053 bytes,
  sha256sums);
- SQL: DROP/ALTER do diff + preservação dos GIN (re-criados no próprio SQL,
  não-dependentes do conhecimento do prisma) + desarme/rearme dos 11 triggers
  (snapshot prévio) — aplicado em transação única, exit 0;
- Pós-check: amount=float8×2, prefs_user=0, idem=0, GIN=2, triggers=11/11;
- **Ledger re-baseado 2×**: wipe das 26 → 26 registros das migrations de
  **188e4c4f** (25 + XX_add_postgis) — `migrate status` = **"up to date"**;
- Runtime: purge 200, density rings, health 200, vitrine 200, 0 erros de
  schema nos logs.

## Divergência declarada (intencional)

O banco agora replica o **188e4c4f**. O HEAD local (C9+) tem **mais 5
migrations** e re-meda dinheiro/decimal; quando esses commits forem
pushados, `prisma migrate deploy` aplicará as 5 sobre o estado grande e
completo (a diff QUITOU contra esse estado — o baseline até o 188e4c4f).
