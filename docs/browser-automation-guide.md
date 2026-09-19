# Browser Automation Guide — React Controlled Components

## O Problema

React controlled components (`<input value={x} onChange={fn}>`) ignoram `nativeValueSetter` do DOM.
O valor muda visualmente, mas o state do React não atualiza → na re-render, o valor volta ao original.

## A Solução

### Abordagem 1: `preview_type` (Recomendada)

A ferramenta `preview_type` simula digitação real com eventos de teclado que o React captura:

```
preview_type(uid, "35020-460")
```

- Gera `keyDown`, `keyPress`, `input`, `keyUp` events
- React processa via seu event delegation system
- `onChange` dispara corretamente
- Funciona 100% dos casos

**Para triggerar blur:** clique em outro campo depois de digitar.

### Abordagem 2: `preview_evaluate` com React Hack

Quando `preview_type` não é suficiente (ex: selects customizados, campos com mask):

```javascript
// 1. Setar valor via native setter
const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set
nativeSetter.call(input, "novo valor")

// 2. Disparar eventos que React captura
input.dispatchEvent(new Event("input", { bubbles: true }))
input.dispatchEvent(new Event("change", { bubbles: true }))

// 3. Triggerar blur se necessário
input.dispatchEvent(new Event("blur", { bubbles: true }))
```

### Abordagem 3: `preview_click` em opções de dropdown

Para `<Select>` (Radix UI), que não é um `<input>`:

```javascript
// 1. Clicar no trigger pra abrir
preview_click(selectTriggerUid)

// 2. Clicar na opção
preview_click(optionUid)
```

## Select UF (Radix UI) — Guia Específico

O `<Select>` do Radix não aceita `type`. O fluxo correto é:

1. `preview_click(comboUid)` — abre o dropdown
2. `preview_snapshot` — pega os UIDs das opções
3. `preview_click(optionUid)` — seleciona

Se o dropdown não abrir com `click`, use:

```javascript
const btn = document.querySelector('button[role="combobox"]')
btn.focus()
btn.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }))
```

## Campos do Booking Modal — Mapeamento

| Campo           | ID                       | Tipo                      |
| --------------- | ------------------------ | ------------------------- |
| Buscar endereço | `combobox "Localização"` | Radix Combobox            |
| CEP             | `gaf-cep`                | Input (auto-fill no blur) |
| Rua / Avenida   | `gaf-street`             | Input                     |
| Número          | `gaf-number`             | Input                     |
| Complemento     | `gaf-complement`         | Input                     |
| Bairro          | `gaf-district`           | Input                     |
| Cidade          | `gaf-city`               | Input                     |
| UF              | `gaf-state`              | Radix Select              |

## Exemplo: Preencher Endereço Completo

```javascript
// 1. Digitar CEP
await preview_type(cepUid, "35020-460")

// 2. Clicar em outro campo pra disparar blur → ViaCEP auto-fill
await preview_click(streetUid)

// 3. Aguardar lookup (2-3s)
await new Promise((r) => setTimeout(r, 3000))

// 4. Digitar número
await preview_type(numberUid, "500")

// 5. Selecionar UF (se ViaCEP não preencheu)
// Clicar no trigger, depois na opção MG
```
