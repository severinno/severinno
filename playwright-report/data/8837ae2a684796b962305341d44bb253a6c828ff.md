# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: reset-password.spec.ts >> Reset Password — Página >> exibe formulário de nova senha com token válido
- Location: e2e\reset-password.spec.ts:94:7

# Error details

```
Test timeout of 30000ms exceeded.
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e3]:
    - generic [ref=e4]:
      - img [ref=e6]
      - heading "Redefinir senha" [level=1] [ref=e9]
      - paragraph [ref=e10]: Escolha uma nova senha para sua conta
    - generic [ref=e11]:
      - generic [ref=e12]:
        - text: Nova senha
        - generic [ref=e13]:
          - img
          - textbox "Nova senha" [ref=e14]:
            - /placeholder: Mínimo 6 caracteres
          - button "Mostrar senha" [ref=e15]:
            - img [ref=e16]
      - generic [ref=e19]:
        - text: Confirmar senha
        - generic [ref=e20]:
          - img
          - textbox "Confirmar senha" [ref=e21]:
            - /placeholder: Repita a senha
      - button "Redefinir senha" [disabled] [ref=e22]
  - region "Notifications alt+T"
```