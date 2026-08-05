# Payments Architecture (Lytex Integration)

> Documentação completa da camada de pagamentos do Severinno Marketplace — integração com Lytex (PIX e Cartão de Crédito), carteira de prestadores, repasses e finanças do admin.

---

## 1. Visão Geral

O Severinno usa a [Lytex](https://pay.lytex.com.br) como gateway de pagamentos, processando PIX e Cartão de Crédito. A camada de pagamentos inclui:

- **Checkout**: Fluxo completo de agendamento → pagamento (PIX/Cartão)
- **Webhook**: Notificações em tempo real da Lytex
- **Carteira (Wallet)**: Saldo simulado do prestador (baseado em bookings)
- **Repasses**: Períodos de settlement administrados pelo admin
- **Finanças**: Dashboard financeiro do admin com MRR, métricas por provedor

```
┌─────────────────────────────────────────────────────────────────────┐
│                        CLIENT (Browser)                              │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────────────────┐  │
│  │ useCheckout  │  │ BookingModal │  │ Provider Finance Page  │  │
│  │ (XState)     │  │ (PIX QR /    │  │ (Wallet, splits,       │  │
│  │              │  │  Card form)  │  │  withdraw)              │  │
│  └──────┬───────┘  └──────┬───────┘  └───────────┬─────────────┘  │
│         │                 │                      │                 │
│         └─────────────────┼──────────────────────┘                 │
│                           │ HTTP                                 │
└───────────────────────────┼───────────────────────────────────────┘
                            │
┌───────────────────────────┼───────────────────────────────────────┐
│                     API (Next.js)                                  │
│                                                                     │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────────┐  │
│  │ POST /bookings│ │POST /bookings│ │ GET /api/provider/lytex │  │
│  │ (criar pedido)│ │/[id]/pay     │ │ (wallet view)           │  │
│  └──────┬───────┘ │ (PIX/Card)   │ └──────────┬───────────────┘  │
│         │         └──────┬───────┘            │                   │
│         │                │                    │                   │
│  ┌──────▼────────────────▼────────────────────▼──────────────┐   │
│  │                    lib/lytex.ts                           │   │
│  │  createPixCharge  createCardCharge  getCharge            │   │
│  │  cancelCharge     refundCharge     pollChargeStatus      │   │
│  │  verifyWebhookSignature  getWallet  listSplits           │   │
│  └─────────────────────────┬────────────────────────────────┘   │
│                            │                                     │
│  ┌──────▼──────────────────▼─────────────────────────┐          │
│  │             lib/wallet.ts                          │          │
│  │  computeBaseBalance  computeAvailableBalance      │          │
│  │  getWithdrawals  buildWallet (FEE_RATE = 0.15)    │          │
│  └─────────────────────┬──────────────────────────────┘          │
│                        │                                         │
│  ┌──────▼──────────────▼──────────────────────────────┐         │
│  │         API Routes (Admin)                         │         │
│  │  /api/admin/finance  — dashboard financeiro        │         │
│  │  /api/admin/settlements — períodos de repasse      │         │
│  │  /api/admin/gateway/invoices — faturas Lytex       │         │
│  └─────────────────────┬──────────────────────────────┘         │
│                        │                                         │
│  ┌──────▼──────────────▼──────────────────────────────┐         │
│  │         Webhooks (Lytex)                            │         │
│  │  POST /api/webhooks/lytex                          │         │
│  │  → confirmBookingPayment (paid)                    │         │
│  │  → refundBookingPayment (refunded)                 │         │
│  └─────────────────────────────────────────────────────┘         │
└──────────────────────────────────────────────────────────────────┘
                            │
┌───────────────────────────▼───────────────────────────────────────┐
│                     Lytex API (external)                           │
│  Sandbox: https://sandbox-api.lytex.com.br/v1                     │
│  Produção: https://api.lytex.com.br/v1                            │
│  Auth: Basic (clientId:clientSecret)                              │
└───────────────────────────────────────────────────────────────────┘
```

---

## 2. Fluxo de Pagamento

### 2.1. PIX

```
Cliente                          API                           Lytex
   │                              │                              │
   │  1. POST /bookings           │                              │
   │  { serviceId, providerId,    │                              │
   │    paymentMethod: "PIX" }    │                              │
   │ ──────────────────────────►  │                              │
   │                              │  2. Cria booking + payment   │
   │                              │     (status: PENDING)        │
   │  3. 201 { booking }          │                              │
   │ ◄──────────────────────────  │                              │
   │                              │                              │
   │  4. POST /bookings/[id]/pay  │                              │
   │ ──────────────────────────►  │                              │
   │                              │  5. createPixCharge()        │
   │                              │ ───────────────────────────► │
   │                              │  6. QR code + txid           │
   │                              │ ◄─────────────────────────── │
   │                              │  7. Salva dados no payment   │
   │  8. { qrCode, qrCodeImage }  │                              │
   │ ◄──────────────────────────  │                              │
   │                              │                              │
   │  9. Cliente escaneia QR      │                              │
   │     e paga via PIX           │                              │
   │                              │                              │
   │                              │ 10. POST /api/webhooks/lytex │
   │                              │     { status: "paid" }       │
   │                              │ ◄─────────────────────────── │
   │                              │ 11. confirmBookingPayment()  │
   │                              │     payment → PAID           │
   │                              │     booking → PAID           │
```

### 2.2. Cartão de Crédito

```
Cliente                          API                           Lytex
   │                              │                              │
   │  1. POST /bookings/[id]/pay  │                              │
   │  { card: { number,           │                              │
   │    holderName, cvv, ... } }  │                              │
   │ ──────────────────────────►  │                              │
   │                              │  2. createCardCharge()       │
   │                              │ ───────────────────────────► │
   │                              │                              │
   │  ┌── Síncrono (aprovado) ──┐ │                              │
   │  │  3a. status = "paid"    │ │                              │
   │  │  4a. $transaction        │ │                              │
   │  │      payment → PAID     │ │                              │
   │  │      booking → PAID     │ │                              │
   │  │  5a. { status: "PAID" } │ │                              │
   │  │ ◄───────────────────────┘ │                              │
   │  │                           │                              │
   │  └───────────────────────────┘                              │
   │                              │                              │
   │  ┌── Assíncrono (waiting) ─┐ │                              │
   │  │  3b. status =           │ │                              │
   │  │      "waitingPayment"   │ │                              │
   │  │  4b. Salva como PENDING │ │                              │
   │  │  5b. Inicia polling     │ │                              │
   │  │      pollChargeStatus() │ │                              │
   │  │  6b. { status:          │ │                              │
   │  │       "waitingPayment" }│ │                              │
   │  │ ◄───────────────────────┘ │                              │
   │  │                           │                              │
   │  └───────────────────────────┘                              │
```

---

## 3. Lytex HTTP Client

`src/lib/lytex.ts` — Cliente HTTP completo para API Lytex.

### 3.1. Funções Exportadas

| Função                              | Endpoint                      | Descrição                   |
| ----------------------------------- | ----------------------------- | --------------------------- |
| `createPixCharge(req)`              | `POST /charges/pix`           | Criar cobrança PIX          |
| `createCardCharge(req)`             | `POST /charges/card`          | Criar cobrança cartão       |
| `getCharge(chargeId)`               | `GET /charges/{id}`           | Consultar status            |
| `cancelCharge(chargeId)`            | `POST /charges/{id}/cancel`   | Cancelar cobrança           |
| `refundCharge(chargeId, amount?)`   | `POST /charges/{id}/refund`   | Reembolsar                  |
| `getChargeByExternalReference(ref)` | `GET /charges/external/{ref}` | Buscar por ref externa      |
| `verifyWebhookSignature(payload)`   | —                             | Validar assinatura webhook  |
| `parseExternalReference(ref)`       | —                             | Extrair booking ID          |
| `mapLytexStatus(status)`            | —                             | Mapear status Lytex → nosso |
| `pollChargeStatus(chargeId)`        | —                             | Polling waiting→paid        |
| `getWallet(recipientId)`            | `GET /recipients/{id}/wallet` | Saldo do recebedor          |
| `listSplits(recipientId)`           | `GET /recipients/{id}/splits` | Repasses ao recebedor       |

### 3.2. Configuração

| Variável              | Descrição             | Default                               |
| --------------------- | --------------------- | ------------------------------------- |
| `LYTEX_CLIENT_ID`     | Client ID do gateway  | **obrigatório**                       |
| `LYTEX_CLIENT_SECRET` | Client Secret         | **obrigatório**                       |
| `LYTEX_ENV`           | Ambiente              | `sandbox`                             |
| `LYTEX_API_URL`       | URL produção (custom) | `https://api.lytex.com.br/v1`         |
| `LYTEX_SANDBOX_URL`   | URL sandbox (custom)  | `https://sandbox-api.lytex.com.br/v1` |

### 3.3. Webhook

A Lytex envia POST para `POST /api/webhooks/lytex` com payload assinado via **HMAC-SHA256** (client_secret como chave).

**Status processados:**

| Status                 | Ação                                                                |
| ---------------------- | ------------------------------------------------------------------- |
| `paid`                 | `confirmBookingPayment()` → atualiza payment + booking              |
| `refunded`             | `refundBookingPayment()` → marca payment + booking como reembolsado |
| `canceled` / `expired` | Apenas log                                                          |
| `waitingPayment`       | Apenas log                                                          |
| desconhecido           | Apenas log                                                          |

---

## 4. Carteira do Prestador (Wallet)

### 4.1. Simulated Wallet

Quando a Lytex não está configurada ou o prestador não tem `lytexRecipientId`, o sistema calcula valores simulados baseados nos bookings:

```
GET /api/provider/lytex → { wallet, splits }
```

**Regras:**

- `balance`: Soma de bookings COMPLETED + PAID, menos 15% de taxa
- `pendingBalance`: Bookings CONFIRMED/IN_PROGRESS + PAID, menos 15%
- `totalReceived`: Soma de TODOS os bookings PAID (sem taxa)
- `splits`: Gerados de bookings COMPLETED (simula repasses)

### 4.2. Wallet Functions

`src/lib/wallet.ts`:

| Função                                | Descrição                                           |
| ------------------------------------- | --------------------------------------------------- |
| `computeBaseBalance(providerId)`      | Calcula saldo base, pendente, transações            |
| `computeAvailableBalance(providerId)` | Saldo disponível para saque (COMPLETED - withdraws) |
| `getWithdrawals(providerId)`          | Retiradas já realizadas                             |
| `buildWallet(base, withdrawals)`      | Monta objeto SimulatedWallet completo               |

### 4.3. Taxa da Plataforma

`FEE_RATE = 0.15` (15%) — definido em `src/lib/constants.ts`.

---

## 5. Admin Financeiro

### 5.1. Dashboard

`GET /api/admin/finance?period=30d`

Retorna:

- **summary**: Agregação por status (PAID/PENDING/REFUNDED)
- **monthlyRevenue**: Receita mensal
- **paymentMethods**: Estatísticas por método (PIX vs CARD)
- **transactions**: Lista paginada de transações recentes
- **mrr**: MRR atual, anterior, crescimento, histórico (3 meses)
- **averageTicket**: Ticket médio
- **providerStats**: Agregação por prestador com comissão

### 5.2. Repasses

`GET /api/admin/settlements` — Lista períodos de repasse
`POST /api/admin/settlements/generate` — Gera novo período

Campos do período:

- `type`: WEEKLY | MONTHLY
- `startDate` / `endDate`
- `totalAmount`, `totalCommission`, `totalNet`
- `providerCount`, `transactionCount`
- `providers[]`: Detalhe por prestador (status, amount, commission, net)

### 5.3. Faturas Lytex

`GET /api/admin/gateway/invoices?page=1&perPage=20&search=`

Proxy para API v2 da Lytex (requer `LYTEX_BASE_URL`). Usa token cacheado (expira a cada ~58 minutos).

---

## 6. Constantes

| Constante       | Valor                               | Arquivo                |
| --------------- | ----------------------------------- | ---------------------- |
| `FEE_RATE`      | 0.15 (15%)                          | `src/lib/constants.ts` |
| `PaymentMethod` | `"CARD" \| "PIX"`                   | `src/lib/constants.ts` |
| `PaymentStatus` | `"PENDING" \| "PAID" \| "REFUNDED"` | `src/lib/constants.ts` |

---

## 7. Testes

| Suite              | Arquivo                                                      | Testes                   |
| ------------------ | ------------------------------------------------------------ | ------------------------ |
| Lytex HTTP Client  | `src/lib/__tests__/lytex.test.ts`                            | 30+ (inline replication) |
| Webhook Lytex      | `src/app/api/__tests__/webhooks-lytex-route.test.ts`         | 15+                      |
| Pay Route          | `src/app/api/__tests__/bookings-pay-route.test.ts`           | 18+                      |
| Wallet Route       | `src/app/api/__tests__/wallet-route.test.ts`                 | 12                       |
| Wallet Withdraw    | `src/app/api/__tests__/wallet-withdraw-route.test.ts`        | 10                       |
| Wallet History     | `src/app/api/__tests__/wallet-history-route.test.ts`         | 14                       |
| Wallet Export CSV  | `src/app/api/__tests__/wallet-history-export-route.test.ts`  | 9                        |
| **Wallet Library** | `src/lib/__tests__/wallet.test.ts`                           | **15+ (novo)**           |
| **Provider Lytex** | `src/app/api/__tests__/provider-lytex-route.test.ts`         | **7 (novo)**             |
| **Admin Invoices** | `src/app/api/__tests__/admin-gateway-invoices-route.test.ts` | **7 (novo)**             |
| Checkout Machine   | `src/machines/__tests__/checkout.test.ts`                    | 4                        |
| Admin Finance      | `src/app/api/__tests__/admin-finance-route.test.ts`          | 7+                       |
| Admin Settlements  | `src/app/api/__tests__/admin-settlements-route.test.ts`      | Testes existentes        |

---

## 8. Variáveis de Ambiente

```env
# Obrigatório para processar pagamentos
LYTEX_CLIENT_ID=seu_client_id
LYTEX_CLIENT_SECRET=seu_client_secret

# Opcional
LYTEX_ENV=sandbox                          # sandbox | production
LYTEX_API_URL=https://api.lytex.com.br/v1   # produção (custom)
LYTEX_SANDBOX_URL=https://sandbox-api.lytex.com.br/v1  # sandbox
LYTEX_BASE_URL=https://api-pay.lytex.com.br            # admin invoices
```

---

## 9. Convenções

1. **externalReference**: Sempre no formato `booking:{bookingId}` — usado para vincular webhooks ao booking correto
2. **Idempotência**: Se o webhook receber um `paid` duplicado, apenas metadados são atualizados (não duplica confirmação)
3. **Webhook sempre retorna 200**: Mesmo em caso de erro, retorna `{ received: true }` para evitar reenvios desnecessários da Lytex
4. **Polling**: `pollChargeStatus` faz polling a cada 7s por até 20 tentativas (~2.5h máximo). Resultado é tratado em background (fire-and-forget)
5. **Simulação**: Sem Lytex configurada, o wallet usa bookings como fonte de dados simulados — permitindo desenvolvimento sem gateway real
