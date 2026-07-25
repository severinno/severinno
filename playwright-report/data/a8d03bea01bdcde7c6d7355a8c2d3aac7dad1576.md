# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: reset-password.spec.ts >> Reset Password — Página >> mostra erro para senhas que não conferem
- Location: e2e\reset-password.spec.ts:114:7

# Error details

```
Test timeout of 30000ms exceeded.
```

# Page snapshot

```yaml
- generic [ref=e1]:
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
            - text: senha123
          - button "Mostrar senha" [ref=e15]:
            - img [ref=e16]
      - generic [ref=e19]:
        - text: Confirmar senha
        - generic [ref=e20]:
          - img
          - textbox "Confirmar senha" [active] [ref=e21]:
            - /placeholder: Repita a senha
            - text: senha456
        - paragraph [ref=e22]: As senhas não conferem
      - button "Redefinir senha" [disabled] [ref=e23]
  - region "Notifications alt+T"
  - generic:
    - generic [ref=e26]:
      - generic [ref=e27]:
        - generic [ref=e28]:
          - navigation [ref=e29]:
            - button "previous" [disabled] [ref=e30]:
              - img "previous" [ref=e31]
            - generic [ref=e33]:
              - generic [ref=e34]: 1/
              - text: "1"
            - button "next" [disabled] [ref=e35]:
              - img "next" [ref=e36]
          - img
        - generic [ref=e38]:
          - link "Next.js 16.1.3 (stale) Turbopack" [ref=e39] [cursor=pointer]:
            - /url: https://nextjs.org/docs/messages/version-staleness
            - img [ref=e40]
            - generic "There is a newer version (16.2.11) available, upgrade recommended!" [ref=e42]: Next.js 16.1.3 (stale)
            - generic [ref=e43]: Turbopack
          - img
      - dialog "Build Error" [ref=e45]:
        - generic [ref=e48]:
          - generic [ref=e49]:
            - generic [ref=e50]:
              - generic [ref=e52]: Build Error
              - generic [ref=e53]:
                - button "Copy Error Info" [ref=e54] [cursor=pointer]:
                  - img [ref=e55]
                - button "No related documentation found" [disabled] [ref=e57]:
                  - img [ref=e58]
                - button "Attach Node.js inspector" [ref=e60] [cursor=pointer]:
                  - img [ref=e61]
            - generic [ref=e70]: Reading source code for parsing failed
          - generic [ref=e72]:
            - generic [ref=e74]:
              - img [ref=e76]
              - generic [ref=e80]: ./.freebuff/worktrees/thmrzp9vv9y86o/src/lib/api-server.ts
              - button "Open in editor" [ref=e81] [cursor=pointer]:
                - img [ref=e83]
            - generic [ref=e87]: "Reading source code for parsing failed An unexpected error happened while trying to read the source code to parse: failed to convert rope into string Caused by: - invalid utf-8 sequence of 1 bytes from index 5415 Import trace: App Route: ./.freebuff/worktrees/thmrzp9vv9y86o/src/lib/api-server.ts ./.freebuff/worktrees/thmrzp9vv9y86o/src/app/api/auth/me/route.ts"
        - generic [ref=e88]: "1"
        - generic [ref=e89]: "2"
    - generic [ref=e94] [cursor=pointer]:
      - button "Open Next.js Dev Tools" [ref=e95]:
        - img [ref=e96]
      - button "Open issues overlay" [ref=e100]:
        - generic [ref=e101]:
          - generic [ref=e102]: "0"
          - generic [ref=e103]: "1"
        - generic [ref=e104]: Issue
  - alert [ref=e105]
```