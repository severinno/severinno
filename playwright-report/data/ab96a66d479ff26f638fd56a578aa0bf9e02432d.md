# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: booking-flow.spec.ts >> Fluxo Completo de Agendamento — Visitante (não logado) >> 6. booking step 3 — seleção de forma de pagamento PIX
- Location: e2e\booking-flow.spec.ts:233:7

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.click: Test timeout of 30000ms exceeded.
Call log:
  - waiting for locator('button:has-text("Agendar")').first()
    - locator resolved to <button data-slot="button" class="inline-flex items-center justify-center whitespace-nowrap transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive border bg-background shadow-xs hover:text-accent-foreground dark:…>…</button>
  - attempting click action
    2 × waiting for element to be visible, enabled and stable
      - element is visible, enabled and stable
      - scrolling into view if needed
      - done scrolling
      - <nextjs-portal></nextjs-portal> from <script data-nextjs-dev-overlay="true">…</script> subtree intercepts pointer events
    - retrying click action
    - waiting 20ms
    - waiting for element to be visible, enabled and stable
    - element is not stable
  2 × retrying click action
      - waiting 100ms
      - waiting for element to be visible, enabled and stable
      - element is visible, enabled and stable
      - scrolling into view if needed
      - done scrolling
      - <nextjs-portal></nextjs-portal> from <script data-nextjs-dev-overlay="true">…</script> subtree intercepts pointer events
  16 × retrying click action
       - waiting 500ms
       - waiting for element to be visible, enabled and stable
       - element is visible, enabled and stable
       - scrolling into view if needed
       - done scrolling
       - <nextjs-portal></nextjs-portal> from <script data-nextjs-dev-overlay="true">…</script> subtree intercepts pointer events
  - retrying click action
    - waiting 500ms
    - waiting for element to be visible, enabled and stable
    - element is visible, enabled and stable
    - scrolling into view if needed
    - done scrolling

```

# Page snapshot

```yaml
- generic [ref=e1]:
  - generic [ref=e3]:
    - banner [ref=e4]:
      - generic [ref=e6]:
        - button "Severinno — página inicial" [ref=e7]:
          - generic [ref=e8]:
            - img [ref=e10]
            - img [ref=e14]
          - generic [ref=e16]: Severinno
          - generic [ref=e17]:
            - img [ref=e18]
            - generic [ref=e21]: Verificado
        - generic [ref=e24]:
          - img
          - textbox "Buscar prestadores (compacto)" [ref=e25]:
            - /placeholder: Buscar…
        - button "Usar minha localização" [ref=e27]:
          - img
          - generic [ref=e28]: Definir localização
        - generic [ref=e29]:
          - button "Alternar tema" [ref=e30]:
            - generic [ref=e31]:
              - img
          - generic [ref=e32]:
            - button "Entrar" [ref=e33]
            - button "Cadastrar" [ref=e34]
    - main [ref=e35]:
      - generic [ref=e42]:
        - generic [ref=e43]:
          - generic [ref=e45]:
            - img [ref=e46]
            - text: Marketplace de serviços verificados
          - heading "Prestadores de serviço verificados, perto de você." [level=1] [ref=e49]
          - paragraph [ref=e50]: Compare avaliações reais, peça orçamento grátis e agende — encanador, eletricista, pintor e mais. Você escolhe o profissional.
          - generic [ref=e52]:
            - generic [ref=e53]:
              - img [ref=e54]
              - textbox "Serviço buscado" [ref=e57]:
                - /placeholder: "O que você precisa? Ex.: encanador, pintura…"
            - generic [ref=e58]:
              - img [ref=e59]
              - textbox "Localização" [ref=e62]:
                - /placeholder: CEP ou cidade
            - button "Buscar" [ref=e63]:
              - img
              - text: Buscar
          - generic [ref=e64]:
            - generic [ref=e65]: "Mais buscados:"
            - button "Encanador" [ref=e66]:
              - generic [ref=e67]: 🔧
              - text: Encanador
            - button "Eletricista" [ref=e68]:
              - generic [ref=e69]: 💡
              - text: Eletricista
            - button "Pintor" [ref=e70]:
              - generic [ref=e71]: 🎨
              - text: Pintor
            - button "Diarista" [ref=e72]:
              - generic [ref=e73]: 🧹
              - text: Diarista
            - button "Pedreiro" [ref=e74]:
              - generic [ref=e75]: 🧱
              - text: Pedreiro
            - button "Jardineiro" [ref=e76]:
              - generic [ref=e77]: 🌿
              - text: Jardineiro
          - button "Usar minha localização" [ref=e78]:
            - img [ref=e79]
            - text: Usar minha localização
          - generic [ref=e82]:
            - button "Cadastrar grátis" [ref=e83]:
              - text: Cadastrar grátis
              - img
            - button "Ver como funciona" [ref=e84]
          - paragraph [ref=e85]: Cadastro grátis · Orçamento sem compromisso · Você escolhe o profissional
          - list [ref=e86]:
            - listitem "Documentos validados e identidade confirmada" [ref=e87]:
              - img [ref=e89]
              - generic [ref=e92]: Prestadores verificados
            - listitem "Avaliações de clientes após a conclusão do serviço" [ref=e93]:
              - img [ref=e95]
              - generic [ref=e97]: Avaliações reais
            - listitem "Pagamento só é liberado após você marcar como concluído" [ref=e98]:
              - img [ref=e100]
              - generic [ref=e103]: Pagamento seguro
        - generic [ref=e106]:
          - generic [ref=e112]: Atividade ao vivo
          - generic [ref=e114]:
            - img [ref=e115]
            - paragraph [ref=e117]: Carregando atividades…
      - region "Atividade recente na plataforma" [ref=e119]:
        - generic [ref=e120]:
          - generic [ref=e122]: Atividade recente
          - generic [ref=e126]:
            - generic [ref=e128]:
              - generic [ref=e129]:
                - generic [ref=e130]: ⚡
                - text: Maria contratou um eletricista em São Paulo
              - generic [ref=e132]:
                - generic [ref=e133]: ⭐
                - text: João avaliou ★★★★★ o prestador Ricardo
              - generic [ref=e135]:
                - generic [ref=e136]: 🎨
                - text: "Nova avaliação: 4.9 para Serviços de Pintura"
              - generic [ref=e138]:
                - generic [ref=e139]: 🔧
                - text: Ana pediu orçamento para encanador
              - generic [ref=e141]:
                - generic [ref=e142]: ✅
                - text: Pedro se cadastrou como prestador verificado
              - generic [ref=e144]:
                - generic [ref=e145]: 📋
                - text: 12 orçamentos enviados hoje
              - generic [ref=e147]:
                - generic [ref=e148]: ⚡
                - text: Maria contratou um eletricista em São Paulo
              - generic [ref=e150]:
                - generic [ref=e151]: ⭐
                - text: João avaliou ★★★★★ o prestador Ricardo
              - generic [ref=e153]:
                - generic [ref=e154]: 🎨
                - text: "Nova avaliação: 4.9 para Serviços de Pintura"
              - generic [ref=e156]:
                - generic [ref=e157]: 🔧
                - text: Ana pediu orçamento para encanador
              - generic [ref=e159]:
                - generic [ref=e160]: ✅
                - text: Pedro se cadastrou como prestador verificado
              - generic [ref=e162]:
                - generic [ref=e163]: 📋
                - text: 12 orçamentos enviados hoje
            - generic [ref=e167]:
              - generic [ref=e168]:
                - generic [ref=e169]: 🧹
                - text: Carlos agendou limpeza de quintal em Belo Horizonte
              - generic [ref=e171]:
                - generic [ref=e172]: ⭐
                - text: Fernanda avaliou ★★★★★ o prestador José
              - generic [ref=e174]:
                - generic [ref=e175]: 🛡️
                - text: 8 novos prestadores verificados esta semana
              - generic [ref=e177]:
                - generic [ref=e178]: 🎨
                - text: Luciana contratou um pintor no Rio de Janeiro
              - generic [ref=e180]:
                - generic [ref=e181]: 🚿
                - text: "Orçamento aceito: reforma de banheiro em Curitiba"
              - generic [ref=e183]:
                - generic [ref=e184]: 🏆
                - text: 5.200 serviços concluídos este mês
              - generic [ref=e186]:
                - generic [ref=e187]: 🧹
                - text: Carlos agendou limpeza de quintal em Belo Horizonte
              - generic [ref=e189]:
                - generic [ref=e190]: ⭐
                - text: Fernanda avaliou ★★★★★ o prestador José
              - generic [ref=e192]:
                - generic [ref=e193]: 🛡️
                - text: 8 novos prestadores verificados esta semana
              - generic [ref=e195]:
                - generic [ref=e196]: 🎨
                - text: Luciana contratou um pintor no Rio de Janeiro
              - generic [ref=e198]:
                - generic [ref=e199]: 🚿
                - text: "Orçamento aceito: reforma de banheiro em Curitiba"
              - generic [ref=e201]:
                - generic [ref=e202]: 🏆
                - text: 5.200 serviços concluídos este mês
      - region "Categorias de serviços" [ref=e204]:
        - generic [ref=e205]:
          - generic:
            - img
          - generic [ref=e207]:
            - generic [ref=e208]:
              - img [ref=e209]
              - text: Explore categorias
            - heading "Encontre o serviço ideal" [level=2] [ref=e212]
            - paragraph [ref=e213]: Serviços verificados perto de você — 0 categorias disponíveis
          - generic [ref=e214]:
            - img [ref=e216]
            - generic [ref=e219]:
              - paragraph [ref=e220]: Nenhuma categoria disponível
              - paragraph [ref=e221]: As categorias aparecerão aqui assim que estiverem disponíveis. Tente recarregar a página.
            - button "Tentar carregar categorias novamente" [ref=e222]:
              - img
              - text: Tentar novamente
      - region "Resultados da busca" [ref=e223]:
        - generic [ref=e224]:
          - complementary [ref=e225]:
            - generic [ref=e227]:
              - generic [ref=e228]:
                - heading "Filtros" [level=2] [ref=e229]:
                  - img [ref=e230]
                  - text: Filtros
                - button "Limpar filtros" [ref=e231]
              - generic [ref=e232]:
                - generic [ref=e233]: Buscar
                - generic [ref=e234]:
                  - img [ref=e235]
                  - textbox "Buscar" [ref=e238]:
                    - /placeholder: Serviço, prestador…
              - generic [ref=e239]:
                - generic [ref=e240]:
                  - generic [ref=e241]: Raio de busca
                  - generic [ref=e242]: 15 km
                - generic "Raio de busca em quilômetros" [ref=e243]:
                  - slider [ref=e247]
                - generic [ref=e248]:
                  - generic [ref=e249]: 1 km
                  - generic [ref=e250]: 50 km
              - generic [ref=e251]:
                - generic [ref=e252]: Categoria
                - combobox [ref=e253]:
                  - generic: Todas as categorias
                  - img
              - generic [ref=e254]:
                - generic [ref=e255]: Ordenar por
                - radiogroup "Ordenar por" [ref=e256]:
                  - radio "Melhor avaliação" [checked] [ref=e257]
                  - radio "Mais próximos" [ref=e258]
              - generic [ref=e259]:
                - generic [ref=e260]: Avaliação mínima
                - radiogroup [ref=e261]:
                  - generic [ref=e262] [cursor=pointer]:
                    - radio "Todas" [checked] [ref=e263]:
                      - img [ref=e264]
                    - generic [ref=e266]: Todas
                  - generic [ref=e267] [cursor=pointer]:
                    - radio "3+" [ref=e268]
                    - generic [ref=e269]: 3+
                  - generic [ref=e270] [cursor=pointer]:
                    - radio "4+" [ref=e271]
                    - generic [ref=e272]: 4+
                  - generic [ref=e273] [cursor=pointer]:
                    - radio "5" [ref=e274]
                    - generic [ref=e275]: "5"
              - generic [ref=e276] [cursor=pointer]:
                - generic [ref=e277]:
                  - img [ref=e278]
                  - generic [ref=e280]: Somente verificados
                - switch "Somente verificados" [ref=e281]
              - button "Ver 3 resultados" [disabled]
          - generic [ref=e282]:
            - generic [ref=e284]:
              - generic [ref=e285]:
                - heading "3 prestadores encontrados" [level=2] [ref=e286]
                - paragraph [ref=e287]: Exibindo 1–3 de 3
              - generic [ref=e288]:
                - generic [ref=e289]:
                  - text: "Ordenado por:"
                  - generic [ref=e290]: Melhor avaliação
                - tablist "Visualização" [ref=e291]:
                  - tab "Lista" [selected] [ref=e292]:
                    - img [ref=e293]
                    - generic [ref=e294]: Lista
                  - tab "Mapa" [ref=e295]:
                    - img [ref=e296]
                    - generic [ref=e298]: Mapa
            - generic [ref=e300]:
              - generic [ref=e302]:
                - generic [ref=e303]:
                  - img "Capa de Maria Silva" [ref=e304]
                  - generic [ref=e306]:
                    - img [ref=e307]
                    - text: Verificado
                  - generic [ref=e310]:
                    - button "Adicionar Maria Silva à comparação" [ref=e311]:
                      - img [ref=e312]
                    - button "Adicionar Maria Silva aos favoritos" [ref=e317]:
                      - img [ref=e318]
                  - img "Maria Silva" [ref=e322]
                - generic [ref=e323]:
                  - generic [ref=e324]:
                    - button "Ver perfil de Maria Silva" [ref=e325]:
                      - heading "Maria Silva" [level=3] [ref=e326]:
                        - generic [ref=e327]: Maria Silva
                        - img [ref=e328]
                    - generic "Avaliação média" [ref=e330]:
                      - img [ref=e331]
                      - text: "4.8"
                      - generic [ref=e333]: (42)
                  - paragraph [ref=e334]: a partir de R$ 120,00
                  - generic [ref=e335]:
                    - generic [ref=e336]:
                      - img [ref=e337]
                      - text: 2,5 km
                    - generic [ref=e340]:
                      - img [ref=e341]
                      - text: São Paulo
                  - paragraph [ref=e344]: Especialista em instalações elétricas residenciais com mais de 10 anos de experiência.
                  - generic [ref=e345]:
                    - generic "Serviços concluídos com sucesso" [ref=e346]:
                      - img [ref=e347]
                      - text: 230 serviços concluídos
                    - generic "Na plataforma desde" [ref=e350]:
                      - img [ref=e351]
                      - text: desde jan. de 2023
                - generic [ref=e355]:
                  - generic [ref=e356]:
                    - img [ref=e357]
                    - generic [ref=e359]: Instalação Elétrica · a partir de R$ 120,00
                  - heading "Elétrica 1 serviço" [level=3] [ref=e362]:
                    - button "Elétrica 1 serviço" [ref=e363]:
                      - generic [ref=e365]:
                        - paragraph [ref=e366]: Elétrica
                        - paragraph [ref=e367]: 1 serviço
                      - img
                - generic [ref=e368]:
                  - button "Orçamento" [ref=e369]:
                    - img
                    - text: Orçamento
                  - button "Agendar" [ref=e370]:
                    - img
                    - text: Agendar
              - generic [ref=e372]:
                - generic [ref=e373]:
                  - img "Capa de João Pedreiro" [ref=e374]
                  - generic [ref=e376]:
                    - img [ref=e377]
                    - text: Verificado
                  - generic [ref=e380]:
                    - button "Adicionar João Pedreiro à comparação" [ref=e381]:
                      - img [ref=e382]
                    - button "Adicionar João Pedreiro aos favoritos" [ref=e387]:
                      - img [ref=e388]
                  - img "João Pedreiro" [ref=e392]
                - generic [ref=e393]:
                  - generic [ref=e394]:
                    - button "Ver perfil de João Pedreiro" [ref=e395]:
                      - heading "João Pedreiro" [level=3] [ref=e396]:
                        - generic [ref=e397]: João Pedreiro
                        - img [ref=e398]
                    - generic "Avaliação média" [ref=e400]:
                      - img [ref=e401]
                      - text: "4.8"
                      - generic [ref=e403]: (42)
                  - paragraph [ref=e404]: a partir de R$ 120,00
                  - generic [ref=e405]:
                    - generic [ref=e406]:
                      - img [ref=e407]
                      - text: 2,5 km
                    - generic [ref=e410]:
                      - img [ref=e411]
                      - text: São Paulo
                  - paragraph [ref=e414]: Especialista em instalações elétricas residenciais com mais de 10 anos de experiência.
                  - generic [ref=e415]:
                    - generic "Serviços concluídos com sucesso" [ref=e416]:
                      - img [ref=e417]
                      - text: 230 serviços concluídos
                    - generic "Na plataforma desde" [ref=e420]:
                      - img [ref=e421]
                      - text: desde jan. de 2023
                - generic [ref=e425]:
                  - generic [ref=e426]:
                    - img [ref=e427]
                    - generic [ref=e429]: Instalação Elétrica · a partir de R$ 120,00
                  - heading "Construção 1 serviço" [level=3] [ref=e432]:
                    - button "Construção 1 serviço" [ref=e433]:
                      - generic [ref=e435]:
                        - paragraph [ref=e436]: Construção
                        - paragraph [ref=e437]: 1 serviço
                      - img
                - generic [ref=e438]:
                  - button "Orçamento" [ref=e439]:
                    - img
                    - text: Orçamento
                  - button "Agendar" [ref=e440]:
                    - img
                    - text: Agendar
              - generic [ref=e442]:
                - generic [ref=e443]:
                  - img "Capa de Ana Pintora" [ref=e444]
                  - generic [ref=e446]:
                    - img [ref=e447]
                    - text: Verificado
                  - generic [ref=e450]:
                    - button "Adicionar Ana Pintora à comparação" [ref=e451]:
                      - img [ref=e452]
                    - button "Adicionar Ana Pintora aos favoritos" [ref=e457]:
                      - img [ref=e458]
                  - img "Ana Pintora" [ref=e462]
                - generic [ref=e463]:
                  - generic [ref=e464]:
                    - button "Ver perfil de Ana Pintora" [ref=e465]:
                      - heading "Ana Pintora" [level=3] [ref=e466]:
                        - generic [ref=e467]: Ana Pintora
                        - img [ref=e468]
                    - generic "Avaliação média" [ref=e470]:
                      - img [ref=e471]
                      - text: "4.8"
                      - generic [ref=e473]: (42)
                  - paragraph [ref=e474]: a partir de R$ 120,00
                  - generic [ref=e475]:
                    - generic [ref=e476]:
                      - img [ref=e477]
                      - text: 2,5 km
                    - generic [ref=e480]:
                      - img [ref=e481]
                      - text: São Paulo
                  - paragraph [ref=e484]: Especialista em instalações elétricas residenciais com mais de 10 anos de experiência.
                  - generic [ref=e485]:
                    - generic "Serviços concluídos com sucesso" [ref=e486]:
                      - img [ref=e487]
                      - text: 230 serviços concluídos
                    - generic "Na plataforma desde" [ref=e490]:
                      - img [ref=e491]
                      - text: desde jan. de 2023
                - generic [ref=e495]:
                  - generic [ref=e496]:
                    - img [ref=e497]
                    - generic [ref=e499]: Instalação Elétrica · a partir de R$ 120,00
                  - heading "Pintura 1 serviço" [level=3] [ref=e502]:
                    - button "Pintura 1 serviço" [ref=e503]:
                      - generic [ref=e505]:
                        - paragraph [ref=e506]: Pintura
                        - paragraph [ref=e507]: 1 serviço
                      - img
                - generic [ref=e508]:
                  - button "Orçamento" [ref=e509]:
                    - img
                    - text: Orçamento
                  - button "Agendar" [ref=e510]:
                    - img
                    - text: Agendar
      - region "Como funciona" [ref=e511]:
        - generic [ref=e516]:
          - generic [ref=e517]:
            - link "Pular para resultados" [ref=e518] [cursor=pointer]:
              - /url: "#vitrine-resultados"
              - img [ref=e519]
              - text: Pular para resultados
            - generic [ref=e523]:
              - img [ref=e524]
              - generic [ref=e526]: "4"
              - text: passos simples
            - heading "Como funciona" [level=2] [ref=e527]
            - paragraph [ref=e528]: Sem surpresas — do início ao fim, você tem o controle.
            - generic [ref=e529]:
              - img [ref=e530]
              - text: Sem compromisso
          - generic [ref=e536]:
            - img [ref=e538]
            - generic [ref=e539]:
              - 'button "1 Busque o serviço Encontre prestadores verificados perto de você. 50 + categorias encanador em São Paulo | Verificados < 5 km Mais filtros Ex: Busque ''encanador em São Paulo'' Buscar prestadores" [ref=e540] [cursor=pointer]':
                - generic [ref=e542]:
                  - generic [ref=e544]: "1"
                  - generic [ref=e545]:
                    - img [ref=e547]
                    - img [ref=e551]
                  - heading "Busque o serviço" [level=3] [ref=e554]
                  - paragraph [ref=e555]: Encontre prestadores verificados perto de você.
                  - generic [ref=e557]:
                    - generic [ref=e558]: "50"
                    - text: +
                    - generic [ref=e559]: categorias
                  - generic [ref=e561]:
                    - generic [ref=e562]:
                      - img [ref=e563]
                      - generic [ref=e566]: encanador em São Paulo
                      - generic [ref=e567]: "|"
                    - generic [ref=e568]:
                      - generic [ref=e569]: Verificados
                      - generic [ref=e570]: < 5 km
                      - generic [ref=e571]:
                        - img [ref=e572]
                        - text: Mais filtros
                  - paragraph [ref=e574]: "Ex: Busque 'encanador em São Paulo'"
                  - button "Buscar prestadores" [ref=e575]:
                    - text: Buscar prestadores
                    - img
              - 'button "2 Compare orçamentos Receba e compare propostas lado a lado. 3 orçamentos em 24h João S. R$ 180 Maria L. R$ 150 Melhor avaliação Compare lado a lado Ex: Compare 3 orçamentos em 24h Sem compromisso Pedir orçamento" [ref=e576] [cursor=pointer]':
                - generic [ref=e578]:
                  - generic [ref=e580]: "2"
                  - generic [ref=e581]:
                    - img [ref=e583]
                    - img [ref=e589]
                  - heading "Compare orçamentos" [level=3] [ref=e592]
                  - paragraph [ref=e593]: Receba e compare propostas lado a lado.
                  - generic [ref=e595]:
                    - generic [ref=e596]: "3"
                    - generic [ref=e597]: orçamentos em 24h
                  - generic [ref=e599]:
                    - generic [ref=e600]:
                      - generic [ref=e601]:
                        - generic [ref=e604]: João S.
                        - generic [ref=e605]:
                          - img [ref=e606]
                          - img [ref=e608]
                          - img [ref=e610]
                          - img [ref=e612]
                          - img [ref=e614]
                        - generic [ref=e616]: R$ 180
                      - generic [ref=e617]:
                        - generic [ref=e620]: Maria L.
                        - generic [ref=e621]:
                          - img [ref=e622]
                          - img [ref=e624]
                          - img [ref=e626]
                          - img [ref=e628]
                          - img [ref=e630]
                        - generic [ref=e632]: R$ 150
                        - generic [ref=e633]: Melhor avaliação
                    - generic [ref=e634]:
                      - img [ref=e635]
                      - text: Compare lado a lado
                  - paragraph [ref=e640]: "Ex: Compare 3 orçamentos em 24h"
                  - generic [ref=e641]:
                    - img [ref=e642]
                    - text: Sem compromisso
                  - button "Pedir orçamento" [ref=e647]:
                    - text: Pedir orçamento
                    - img
              - 'button "3 Agende com confiança Solicite um orçamento ou agende diretamente. 24 h para confirmar Março 2025 S T Q Q S S D 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 12 Mar, 14:00 — Confirmado Ex: Agende para amanhã às 14h Agendar agora" [ref=e648] [cursor=pointer]':
                - generic [ref=e650]:
                  - generic [ref=e652]: "3"
                  - generic [ref=e653]:
                    - img [ref=e655]
                    - img [ref=e659]
                  - heading "Agende com confiança" [level=3] [ref=e662]
                  - paragraph [ref=e663]: Solicite um orçamento ou agende diretamente.
                  - generic [ref=e665]:
                    - generic [ref=e666]: "24"
                    - text: h
                    - generic [ref=e667]: para confirmar
                  - generic [ref=e670]:
                    - generic [ref=e671]: Março 2025
                    - generic [ref=e672]:
                      - generic [ref=e673]: S
                      - generic [ref=e674]: T
                      - generic [ref=e675]: Q
                      - generic [ref=e676]: Q
                      - generic [ref=e677]: S
                      - generic [ref=e678]: S
                      - generic [ref=e679]: D
                      - generic [ref=e680]: "1"
                      - generic [ref=e681]: "2"
                      - generic [ref=e682]: "3"
                      - generic [ref=e683]: "4"
                      - generic [ref=e684]: "5"
                      - generic [ref=e685]: "6"
                      - generic [ref=e686]: "7"
                      - generic [ref=e687]: "8"
                      - generic [ref=e688]: "9"
                      - generic [ref=e689]: "10"
                      - generic [ref=e690]: "11"
                      - generic [ref=e691]: "12"
                      - generic [ref=e692]: "13"
                      - generic [ref=e693]: "14"
                      - generic [ref=e694]: "15"
                    - generic [ref=e695]:
                      - img [ref=e696]
                      - generic [ref=e699]: 12 Mar, 14:00 — Confirmado
                  - paragraph [ref=e700]: "Ex: Agende para amanhã às 14h"
                  - button "Agendar agora" [ref=e701]:
                    - text: Agendar agora
                    - img
              - 'button "4 Avalie o resultado Sua opinião mantém a qualidade da comunidade. 98 % satisfação 4.0 \"Excelente trabalho, recomendo!\" Avaliação verificada Ex: Avalie de 1 a 5 estrelas com comentário Cadastrar grátis" [ref=e702] [cursor=pointer]':
                - generic [ref=e704]:
                  - generic [ref=e706]: "4"
                  - generic [ref=e707]:
                    - img [ref=e709]
                    - img [ref=e712]
                  - heading "Avalie o resultado" [level=3] [ref=e715]
                  - paragraph [ref=e716]: Sua opinião mantém a qualidade da comunidade.
                  - generic [ref=e718]:
                    - generic [ref=e719]: "98"
                    - text: "%"
                    - generic [ref=e720]: satisfação
                  - generic [ref=e722]:
                    - generic [ref=e723]:
                      - generic [ref=e724]:
                        - img [ref=e725]
                        - img [ref=e727]
                        - img [ref=e729]
                        - img [ref=e731]
                        - img [ref=e733]
                        - generic [ref=e735]: "4.0"
                      - paragraph [ref=e738]: "\"Excelente trabalho, recomendo!\""
                    - generic [ref=e739]:
                      - img [ref=e740]
                      - text: Avaliação verificada
                  - paragraph [ref=e743]: "Ex: Avalie de 1 a 5 estrelas com comentário"
                  - button "Cadastrar grátis" [ref=e744]:
                    - text: Cadastrar grátis
                    - img
          - generic [ref=e745]:
            - generic [ref=e746]:
              - img [ref=e747]
              - generic [ref=e750]: Garantia Severinno
            - generic [ref=e751]:
              - generic [ref=e752]:
                - img [ref=e753]
                - generic [ref=e756]: Prestadores verificados
              - generic [ref=e757]:
                - img [ref=e758]
                - generic [ref=e761]: Resposta rápida
              - generic [ref=e762]:
                - img [ref=e763]
                - generic [ref=e765]: Satisfação garantida
              - generic [ref=e766]:
                - img [ref=e767]
                - generic [ref=e772]: Compare antes de contratar
          - generic [ref=e773]:
            - button "Começar agora" [ref=e774]:
              - text: Começar agora
              - img
            - link "Buscar prestadores" [ref=e775] [cursor=pointer]:
              - /url: "#vitrine-resultados"
              - img
              - text: Buscar prestadores
          - button "Voltar ao topo" [ref=e777]:
            - img [ref=e778]
            - text: Voltar ao topo
      - generic [ref=e781]:
        - generic [ref=e782]:
          - generic [ref=e783]:
            - img
            - text: Simulador de preços
          - heading "Quanto custa? Simule agora" [level=2] [ref=e784]
          - paragraph [ref=e785]: Estime o valor do serviço em 3 passos rápidos. Sem compromisso, sem cadastro.
        - generic [ref=e786]:
          - generic [ref=e787]: "1"
          - generic [ref=e789]: "2"
          - generic [ref=e791]: "3"
        - generic [ref=e794]:
          - heading "1. Qual serviço você precisa?" [level=3] [ref=e795]
          - paragraph [ref=e796]: Selecione a categoria do serviço
          - generic [ref=e797]:
            - button "Elétrica" [ref=e798]:
              - img [ref=e800]
              - generic [ref=e802]: Elétrica
            - button "Hidráulica" [ref=e803]:
              - img [ref=e805]
              - generic [ref=e808]: Hidráulica
            - button "Pintura" [ref=e809]:
              - img [ref=e811]
              - generic [ref=e815]: Pintura
            - button "Alvenaria" [ref=e816]:
              - img [ref=e818]
              - generic [ref=e820]: Alvenaria
            - button "Pisos" [ref=e821]:
              - img [ref=e823]
              - generic [ref=e825]: Pisos
            - button "Pós-obra" [ref=e826]:
              - img [ref=e828]
              - generic [ref=e833]: Pós-obra
            - button "Residencial" [ref=e834]:
              - img [ref=e836]
              - generic [ref=e839]: Residencial
      - region "Parceiros e imprensa" [ref=e840]:
        - generic [ref=e841]:
          - paragraph [ref=e843]: Referência no mercado
          - generic [ref=e845]:
            - generic [ref=e848]: G1
            - generic [ref=e851]: Folha de S.Paulo
            - generic [ref=e854]: Valor Econômico
            - generic [ref=e857]: Exame
            - generic [ref=e860]: InfoMoney
            - generic [ref=e863]: Startups
            - generic [ref=e866]: Sebrae
            - generic [ref=e869]: ABES
          - paragraph [ref=e870]: + de 6.000 prestadores confiam no Severinno
      - region "Avaliações de clientes" [ref=e871]:
        - generic:
          - generic:
            - img
        - generic [ref=e872]:
          - generic [ref=e873]:
            - generic [ref=e874]:
              - img [ref=e875]
              - text: Avaliações reais
            - heading "O que nossos clientes dizem" [level=2] [ref=e877]
            - paragraph [ref=e878]: Avaliações de clientes após a conclusão do serviço.
          - generic [ref=e879]:
            - img [ref=e881]
            - heading "Não foi possível carregar as avaliações" [level=3] [ref=e886]
            - paragraph [ref=e887]: Ocorreu um erro ao buscar as avaliações. Tente novamente.
            - button "Tentar novamente" [ref=e888]:
              - img
              - text: Tentar novamente
      - generic [ref=e889]:
        - generic [ref=e892]:
          - generic [ref=e893]:
            - img [ref=e895]
            - generic [ref=e900]: "0"
            - paragraph [ref=e901]: Prestadores verificados
          - generic [ref=e902]:
            - img [ref=e904]
            - generic [ref=e906]: "0"
            - paragraph [ref=e907]: Serviços cadastrados
          - generic [ref=e908]:
            - img [ref=e910]
            - generic [ref=e913]: "0"
            - paragraph [ref=e914]: Serviços concluídos
          - generic [ref=e915]:
            - img [ref=e917]
            - generic [ref=e920]: 0.0/5
            - paragraph [ref=e921]: Nota média
        - generic [ref=e923]:
          - generic [ref=e924]:
            - generic [ref=e925]:
              - img [ref=e926]
              - text: Por que Severinno?
            - heading "Confiança em cada agendamento" [level=2] [ref=e929]
            - paragraph [ref=e930]: Mais que um diretório de serviços — um ecossistema pensado para proteger você e o prestador. Da verificação ao pagamento, cada etapa foi desenhada para a sua tranquilidade.
            - link "Pular para FAQ" [ref=e932] [cursor=pointer]:
              - /url: "#faq"
              - img [ref=e933]
              - text: Pular para FAQ
          - generic [ref=e936]:
            - generic [ref=e939]:
              - generic [ref=e940]:
                - img [ref=e942]
                - button "Saiba mais sobre Prestadores verificados" [ref=e945]:
                  - img [ref=e946]
              - heading "Prestadores verificados" [level=3] [ref=e949]
              - paragraph [ref=e950]: João verificou 3 documentos antes de aprovar o prestador. Você só vê profissionais validados.
              - button "Saiba mais" [ref=e951]:
                - text: Saiba mais
                - img [ref=e952]
            - generic [ref=e956]:
              - generic [ref=e957]:
                - img [ref=e959]
                - button "Saiba mais sobre Pagamento protegido" [ref=e962]:
                  - img [ref=e963]
              - heading "Pagamento protegido" [level=3] [ref=e966]
              - paragraph [ref=e967]: O valor só é liberado ao prestador após você confirmar que ficou satisfeito com o serviço.
              - button "Saiba mais" [ref=e968]:
                - text: Saiba mais
                - img [ref=e969]
            - generic [ref=e973]:
              - generic [ref=e974]:
                - img [ref=e976]
                - button "Saiba mais sobre Resposta rápida" [ref=e979]:
                  - img [ref=e980]
              - heading "Resposta rápida" [level=3] [ref=e983]
              - paragraph [ref=e984]: Prestadores comprometidos a responder em até 24h. Acompanhe o status em tempo real.
              - button "Saiba mais" [ref=e985]:
                - text: Saiba mais
                - img [ref=e986]
            - generic [ref=e990]:
              - generic [ref=e991]:
                - img [ref=e993]
                - button "Saiba mais sobre Avaliações reais" [ref=e995]:
                  - img [ref=e996]
              - heading "Avaliações reais" [level=3] [ref=e999]
              - paragraph [ref=e1000]: Apenas clientes que concluíram o serviço podem avaliar. Sem falsas avaliações.
              - button "Saiba mais" [ref=e1001]:
                - text: Saiba mais
                - img [ref=e1002]
            - generic [ref=e1006]:
              - generic [ref=e1007]:
                - img [ref=e1009]
                - button "Saiba mais sobre Próximo de você" [ref=e1012]:
                  - img [ref=e1013]
              - heading "Próximo de você" [level=3] [ref=e1016]
              - paragraph [ref=e1017]: Geolocalização inteligente mostra os melhores prestadores na sua região.
              - button "Saiba mais" [ref=e1018]:
                - text: Saiba mais
                - img [ref=e1019]
            - generic [ref=e1023]:
              - generic [ref=e1024]:
                - img [ref=e1026]
                - button "Saiba mais sobre Suporte humano" [ref=e1028]:
                  - img [ref=e1029]
              - heading "Suporte humano" [level=3] [ref=e1032]
              - paragraph [ref=e1033]: Equipe disponível para mediar disputas, tirar dúvidas e garantir uma experiência justa.
              - button "Saiba mais" [ref=e1034]:
                - text: Saiba mais
                - img [ref=e1035]
        - generic [ref=e1038]:
          - img [ref=e1039]
          - paragraph [ref=e1041]: "Garantia Severinno: seu dinheiro de volta se o serviço não for bem-feito."
          - link "Saiba mais" [ref=e1042] [cursor=pointer]:
            - /url: "#faq"
            - text: Saiba mais
            - img [ref=e1043]
      - generic [ref=e1046]:
        - generic [ref=e1047]:
          - generic [ref=e1048]:
            - img [ref=e1049]
            - text: Destaque da semana
          - heading "Profissional em destaque" [level=2] [ref=e1055]
          - paragraph [ref=e1056]: Conheça um dos nossos prestadores mais bem avaliados.
        - generic [ref=e1060]:
          - generic [ref=e1061]:
            - generic [ref=e1062]:
              - img [ref=e1065]
              - img [ref=e1069]
              - generic [ref=e1073]:
                - img [ref=e1074]
                - text: Top
            - generic [ref=e1076]:
              - generic [ref=e1077]:
                - heading "Maria Silva" [level=3] [ref=e1078]
                - generic [ref=e1079]:
                  - generic [ref=e1080]:
                    - img [ref=e1081]
                    - text: São Paulo
                  - generic [ref=e1084]: 3 km
                  - generic [ref=e1085]:
                    - img [ref=e1086]
                    - text: Membro desde 2023
              - generic [ref=e1088]:
                - generic [ref=e1089]:
                  - img [ref=e1090]
                  - generic [ref=e1092]: "4.8"
                - generic [ref=e1093]: (42 avaliações)
              - generic [ref=e1094]:
                - generic [ref=e1095]:
                  - img
                  - text: 230 serviços concluídos
                - generic [ref=e1096]:
                  - img
                  - text: Responde em ~30min
              - generic [ref=e1097]:
                - paragraph [ref=e1098]: Serviços
                - generic [ref=e1100]:
                  - generic [ref=e1101]: Instalação Elétrica
                  - generic [ref=e1102]: R$ 120,00
              - paragraph [ref=e1104]: Especialista em instalações elétricas residenciais com mais de 10 anos de experiência.
              - generic [ref=e1105]:
                - generic [ref=e1106]:
                  - generic "Maria S." [ref=e1107]: M
                  - generic "João P." [ref=e1108]: J
                  - generic "Ana L." [ref=e1109]: A
                - generic [ref=e1110]: Clientes recentes
          - generic [ref=e1111]:
            - generic [ref=e1112]:
              - button "Pedir orçamento" [ref=e1113]:
                - img
                - text: Pedir orçamento
              - button "Ver perfil completo" [ref=e1114]:
                - text: Ver perfil completo
                - img
            - button "Enviar mensagem" [ref=e1116]:
              - img
              - text: Enviar mensagem
      - generic [ref=e1120]:
        - generic [ref=e1121]:
          - generic [ref=e1122]:
            - generic [ref=e1123]:
              - img [ref=e1124]
              - text: Perguntas frequentes
            - heading "Tire suas dúvidas antes de contratar" [level=2] [ref=e1127]
            - paragraph [ref=e1128]: Reunimos as perguntas mais comuns sobre como o Severinno funciona — do cadastro ao pagamento.
          - generic [ref=e1129]:
            - img [ref=e1130]
            - textbox "Buscar nas perguntas frequentes" [ref=e1133]:
              - /placeholder: Buscar nas dúvidas…
          - generic [ref=e1134]:
            - paragraph [ref=e1135]: Filtrar por categoria
            - generic [ref=e1136]:
              - button "Filtrar por Geral" [ref=e1137]:
                - img [ref=e1138]
                - text: Geral
                - generic [ref=e1141]: (2)
              - button "Filtrar por Pagamento" [ref=e1142]:
                - img [ref=e1143]
                - text: Pagamento
                - generic [ref=e1145]: (2)
              - button "Filtrar por Agendamento" [ref=e1146]:
                - img [ref=e1147]
                - text: Agendamento
                - generic [ref=e1149]: (2)
              - button "Filtrar por Prestadores" [ref=e1150]:
                - img [ref=e1151]
                - text: Prestadores
                - generic [ref=e1155]: (2)
              - button "Filtrar por Segurança" [ref=e1156]:
                - img [ref=e1157]
                - text: Segurança
                - generic [ref=e1160]: (2)
          - generic [ref=e1161]:
            - paragraph [ref=e1162]: Perguntas mais frequentes
            - list [ref=e1163]:
              - listitem [ref=e1164]:
                - button "Como funciona o Severinno?" [ref=e1165]:
                  - img [ref=e1166]
                  - generic [ref=e1168]: Como funciona o Severinno?
              - listitem [ref=e1169]:
                - button "Preciso pagar para me cadastrar?" [ref=e1170]:
                  - img [ref=e1171]
                  - generic [ref=e1173]: Preciso pagar para me cadastrar?
              - listitem [ref=e1174]:
                - button "Como faço para agendar um serviço?" [ref=e1175]:
                  - img [ref=e1176]
                  - generic [ref=e1178]: Como faço para agendar um serviço?
              - listitem [ref=e1179]:
                - button "E se o serviço não for bem-feito?" [ref=e1180]:
                  - img [ref=e1181]
                  - generic [ref=e1183]: E se o serviço não for bem-feito?
          - generic [ref=e1185]:
            - img [ref=e1187]
            - generic [ref=e1189]:
              - paragraph [ref=e1190]: Ainda tem dúvidas?
              - paragraph [ref=e1191]: Cadastre-se grátis e converse diretamente com prestadores verificados. Sem compromisso.
              - generic [ref=e1192]:
                - button "Cadastrar grátis" [ref=e1193]
                - link "Fale conosco" [ref=e1194] [cursor=pointer]:
                  - /url: "#faq"
                  - img
                  - text: Fale conosco
        - generic [ref=e1195]:
          - generic [ref=e1197]:
            - generic [ref=e1199]:
              - heading "01 Como funciona o Severinno? Geral" [level=3] [ref=e1200]:
                - button "01 Como funciona o Severinno? Geral" [expanded] [ref=e1201]:
                  - generic [ref=e1202]:
                    - generic [ref=e1203]: "01"
                    - generic [ref=e1204]: Como funciona o Severinno?
                    - generic [ref=e1205]:
                      - img
                      - text: Geral
                  - img
              - region "01 Como funciona o Severinno? Geral" [ref=e1206]:
                - generic [ref=e1208]:
                  - paragraph [ref=e1209]: O Severinno conecta você a prestadores de serviço verificados próximos à sua localização. Você busca o serviço, compara avaliações reais de outros clientes, pede orçamento grátis e agenda — tudo pela plataforma. O pagamento só é liberado após você confirmar a conclusão do serviço.
                  - paragraph [ref=e1210]: "Ex: Maria precisava de um eletricista. Buscou na plataforma, comparou 3 profissionais e contratou o mais bem avaliado — tudo em 5 minutos."
            - heading "02 Preciso pagar para me cadastrar? Geral" [level=3] [ref=e1213]:
              - button "02 Preciso pagar para me cadastrar? Geral" [ref=e1214]:
                - generic [ref=e1215]:
                  - generic [ref=e1216]: "02"
                  - generic [ref=e1217]: Preciso pagar para me cadastrar?
                  - generic [ref=e1218]:
                    - img
                    - text: Geral
                - img
            - heading "03 Como os prestadores são verificados? Prestadores" [level=3] [ref=e1221]:
              - button "03 Como os prestadores são verificados? Prestadores" [ref=e1222]:
                - generic [ref=e1223]:
                  - generic [ref=e1224]: "03"
                  - generic [ref=e1225]: Como os prestadores são verificados?
                  - generic [ref=e1226]:
                    - img
                    - text: Prestadores
                - img
            - heading "04 Posso me tornar um prestador no Severinno? Prestadores" [level=3] [ref=e1229]:
              - button "04 Posso me tornar um prestador no Severinno? Prestadores" [ref=e1230]:
                - generic [ref=e1231]:
                  - generic [ref=e1232]: "04"
                  - generic [ref=e1233]: Posso me tornar um prestador no Severinno?
                  - generic [ref=e1234]:
                    - img
                    - text: Prestadores
                - img
            - heading "05 Como faço para agendar um serviço? Agendamento" [level=3] [ref=e1237]:
              - button "05 Como faço para agendar um serviço? Agendamento" [ref=e1238]:
                - generic [ref=e1239]:
                  - generic [ref=e1240]: "05"
                  - generic [ref=e1241]: Como faço para agendar um serviço?
                  - generic [ref=e1242]:
                    - img
                    - text: Agendamento
                - img
            - heading "06 Posso remarcar ou cancelar um agendamento? Agendamento" [level=3] [ref=e1245]:
              - button "06 Posso remarcar ou cancelar um agendamento? Agendamento" [ref=e1246]:
                - generic [ref=e1247]:
                  - generic [ref=e1248]: "06"
                  - generic [ref=e1249]: Posso remarcar ou cancelar um agendamento?
                  - generic [ref=e1250]:
                    - img
                    - text: Agendamento
                - img
            - heading "07 Como funciona o pagamento? Pagamento" [level=3] [ref=e1253]:
              - button "07 Como funciona o pagamento? Pagamento" [ref=e1254]:
                - generic [ref=e1255]:
                  - generic [ref=e1256]: "07"
                  - generic [ref=e1257]: Como funciona o pagamento?
                  - generic [ref=e1258]:
                    - img
                    - text: Pagamento
                - img
            - heading "08 O orçamento tem compromisso? Pagamento" [level=3] [ref=e1261]:
              - button "08 O orçamento tem compromisso? Pagamento" [ref=e1262]:
                - generic [ref=e1263]:
                  - generic [ref=e1264]: "08"
                  - generic [ref=e1265]: O orçamento tem compromisso?
                  - generic [ref=e1266]:
                    - img
                    - text: Pagamento
                - img
            - heading "09 E se o serviço não for bem-feito? Segurança" [level=3] [ref=e1269]:
              - button "09 E se o serviço não for bem-feito? Segurança" [ref=e1270]:
                - generic [ref=e1271]:
                  - generic [ref=e1272]: "09"
                  - generic [ref=e1273]: E se o serviço não for bem-feito?
                  - generic [ref=e1274]:
                    - img
                    - text: Segurança
                - img
            - heading "10 Meus dados pessoais estão seguros? Segurança" [level=3] [ref=e1277]:
              - button "10 Meus dados pessoais estão seguros? Segurança" [ref=e1278]:
                - generic [ref=e1279]:
                  - generic [ref=e1280]: "10"
                  - generic [ref=e1281]: Meus dados pessoais estão seguros?
                  - generic [ref=e1282]:
                    - img
                    - text: Segurança
                - img
          - generic [ref=e1283]:
            - paragraph [ref=e1284]: 10 de 10 dúvidas
            - button "Voltar ao topo da seção" [ref=e1285]:
              - img [ref=e1286]
              - text: Topo
      - generic [ref=e1290]:
        - generic:
          - img
        - generic:
          - img
        - generic:
          - img
        - generic:
          - img
        - generic:
          - img
        - generic [ref=e1295]:
          - generic [ref=e1296]:
            - generic [ref=e1298]:
              - img [ref=e1299]
              - text: Comece agora mesmo
            - heading "Pronto para encontrar o prestador ideal?" [level=2] [ref=e1301]
            - paragraph [ref=e1302]: Comece em 30 segundos — é como pedir um Uber, mas para serviços. Cadastre-se gratuitamente e tenha acesso a prestadores verificados.
            - generic [ref=e1303]:
              - button "Para clientes" [ref=e1304]: Para clientes
              - button "Para prestadores" [ref=e1306]
            - list [ref=e1307]:
              - generic [ref=e1308]:
                - listitem [ref=e1309]:
                  - img [ref=e1310]
                  - text: Cadastro gratuito
                - listitem [ref=e1313]:
                  - img [ref=e1314]
                  - text: Sem taxa de serviço
                - listitem [ref=e1317]:
                  - img [ref=e1318]
                  - text: Orçamento sem compromisso
            - generic [ref=e1321]:
              - button "Cadastrar grátis" [ref=e1326]:
                - text: Cadastrar grátis
                - generic [ref=e1327]:
                  - img
              - button "Sou prestador" [ref=e1329]:
                - img
                - text: Sou prestador
            - generic [ref=e1330]:
              - img [ref=e1331]
              - text: Comece em 30 segundos
            - button "Já tenho conta · Entrar" [ref=e1335]:
              - img [ref=e1336]
              - text: Já tenho conta · Entrar
            - generic [ref=e1339]:
              - generic [ref=e1340]:
                - generic [ref=e1341]: AL
                - generic [ref=e1342]: RM
                - generic [ref=e1343]: JS
                - generic [ref=e1344]: PF
                - generic [ref=e1345]: CM
                - generic [ref=e1346]: "+5"
              - generic [ref=e1347]:
                - paragraph [ref=e1348]: 527+ cadastrados
                - paragraph [ref=e1349]: na plataforma
          - generic [ref=e1350]:
            - generic [ref=e1351]:
              - heading "O que vem depois?" [level=3] [ref=e1352]
              - paragraph [ref=e1353]: Três passos simples e você estará agendando
              - generic [ref=e1354]:
                - img [ref=e1355]
                - generic [ref=e1356]:
                  - generic [ref=e1357]:
                    - generic [ref=e1359]: "1"
                    - generic [ref=e1360]:
                      - paragraph [ref=e1361]: Cadastre-se grátis
                      - paragraph [ref=e1362]: ~30s
                  - generic [ref=e1363]:
                    - generic [ref=e1365]: "2"
                    - generic [ref=e1366]:
                      - paragraph [ref=e1367]: Busque e compare
                      - paragraph [ref=e1368]: ~2 min
                  - generic [ref=e1369]:
                    - generic [ref=e1371]: "3"
                    - generic [ref=e1372]:
                      - paragraph [ref=e1373]: Agende com confiança
                      - paragraph [ref=e1374]: ~5 min
              - generic [ref=e1375]:
                - generic [ref=e1376]:
                  - img [ref=e1377]
                  - text: Sem compromisso
                - generic [ref=e1381]:
                  - img [ref=e1382]
                  - text: Cancele quando quiser
                - generic [ref=e1385]:
                  - img [ref=e1386]
                  - text: Suporte 24h
              - link "Saiba mais sobre pagamento protegido" [ref=e1389] [cursor=pointer]:
                - /url: "#faq"
                - img [ref=e1390]
                - text: Saiba mais sobre pagamento protegido
            - generic [ref=e1394]:
              - generic [ref=e1398]: Cliente
              - generic [ref=e1399]:
                - img [ref=e1403]
                - generic [ref=e1405]: Prestador
              - img [ref=e1410]
              - img [ref=e1412]
              - img [ref=e1416]
              - img [ref=e1419]
              - img [ref=e1423]
        - generic [ref=e1427]:
          - img [ref=e1428]
          - generic [ref=e1431]:
            - paragraph [ref=e1432]: “Encontrei um encanador em 10 minutos, paguei menos do que esperava e ainda pude avaliar o serviço. Recomendo demais!”
            - paragraph [ref=e1433]: — Ana P., Cliente, São Paulo
        - generic [ref=e1434]:
          - generic [ref=e1435]:
            - img [ref=e1436]
            - text: Sem compromisso
          - generic [ref=e1440]:
            - img [ref=e1441]
            - text: Cancele quando quiser
          - generic [ref=e1444]:
            - img [ref=e1445]
            - text: Pagamento protegido
    - contentinfo [ref=e1447]:
      - generic [ref=e1449]:
        - generic [ref=e1450]:
          - paragraph [ref=e1451]: Receba novidades e dicas de serviços
          - paragraph [ref=e1452]: Cadastre-se e receba ofertas exclusivas. Cancele quando quiser.
        - generic [ref=e1453]:
          - generic [ref=e1454]:
            - img [ref=e1455]
            - textbox "E-mail para newsletter" [ref=e1458]:
              - /placeholder: Seu e-mail
          - button "Assinar" [disabled]:
            - img
            - text: Assinar
      - generic [ref=e1459]:
        - generic [ref=e1460]:
          - generic [ref=e1461]:
            - generic [ref=e1462]:
              - img [ref=e1464]
              - generic [ref=e1467]: Severinno
            - paragraph [ref=e1468]: Marketplace de serviços com geolocalização. Encontre prestadores verificados, próximos e bem avaliados.
            - list "Redes sociais" [ref=e1469]:
              - listitem [ref=e1470]:
                - link "GitHub" [ref=e1471] [cursor=pointer]:
                  - /url: https://github.com
                  - img [ref=e1472]
              - listitem [ref=e1475]:
                - link "Twitter" [ref=e1476] [cursor=pointer]:
                  - /url: https://twitter.com
                  - img [ref=e1477]
              - listitem [ref=e1479]:
                - link "Instagram" [ref=e1480] [cursor=pointer]:
                  - /url: https://instagram.com
                  - img [ref=e1481]
              - listitem [ref=e1484]:
                - link "LinkedIn" [ref=e1485] [cursor=pointer]:
                  - /url: https://linkedin.com
                  - img [ref=e1486]
              - listitem [ref=e1490]:
                - link "E-mail" [ref=e1491] [cursor=pointer]:
                  - /url: mailto:contato@severinno.com
                  - img [ref=e1492]
          - navigation "Sobre" [ref=e1495]:
            - heading "Sobre" [level=3] [ref=e1496]:
              - img [ref=e1497]
              - text: Sobre
            - list [ref=e1500]:
              - listitem [ref=e1501]:
                - button "Como funciona" [ref=e1502]
              - listitem [ref=e1503]:
                - button "Quem somos" [ref=e1504]
              - listitem [ref=e1505]:
                - button "Termos de uso" [ref=e1506]
              - listitem [ref=e1507]:
                - button "Privacidade" [ref=e1508]
          - navigation "Para profissionais" [ref=e1509]:
            - heading "Para profissionais" [level=3] [ref=e1510]:
              - img [ref=e1511]
              - text: Para profissionais
            - list [ref=e1514]:
              - listitem [ref=e1515]:
                - button "Cadastre-se" [ref=e1516]
              - listitem [ref=e1517]:
                - button "Meu painel" [ref=e1518]
              - listitem [ref=e1519]:
                - button "Central de ajuda" [ref=e1520]
          - navigation "Precisa de ajuda?" [ref=e1521]:
            - heading "Precisa de ajuda?" [level=3] [ref=e1522]:
              - img [ref=e1523]
              - text: Precisa de ajuda?
            - list [ref=e1525]:
              - listitem [ref=e1526]:
                - button "Perguntas frequentes" [ref=e1527]
              - listitem [ref=e1528]:
                - button "Segurança" [ref=e1529]
              - listitem [ref=e1530]:
                - button "Reportar problema" [ref=e1531]
          - generic [ref=e1532]:
            - heading "Contato" [level=3] [ref=e1533]:
              - img [ref=e1534]
              - text: Contato
            - list [ref=e1539]:
              - listitem [ref=e1540]:
                - img [ref=e1541]
                - link "contato@severinno.com" [ref=e1544] [cursor=pointer]:
                  - /url: mailto:contato@severinno.com
              - listitem [ref=e1545]:
                - img [ref=e1546]
                - text: São Paulo, Brasil
            - button "Fale conosco" [ref=e1549]:
              - img
              - text: Fale conosco
        - generic [ref=e1550]:
          - paragraph [ref=e1551]: © 2026 Severinno Marketplace. Todos os direitos reservados.
          - paragraph [ref=e1552]:
            - text: Feito com
            - img [ref=e1553]
            - text: usando tecnologia Open Source (
            - link "MapLibre" [ref=e1555] [cursor=pointer]:
              - /url: https://maplibre.org/
            - text: ·
            - link "OpenStreetMap" [ref=e1556] [cursor=pointer]:
              - /url: https://www.openstreetmap.org/copyright
            - text: )
      - button "Voltar ao topo" [ref=e1557]:
        - img [ref=e1558]
    - button "Voltar ao topo" [ref=e1561]:
      - img
    - button "Abrir assistente virtual" [ref=e1562]:
      - img [ref=e1563]
    - generic [ref=e1567]:
      - generic [ref=e1568]:
        - img [ref=e1570]
        - generic [ref=e1572]:
          - paragraph [ref=e1573]: Usamos cookies para melhorar sua experiência
          - paragraph [ref=e1574]:
            - text: Utilizamos cookies essenciais para o funcionamento do site e cookies de análise para melhorar nossos serviços.
            - button "Política de privacidade" [ref=e1575]
      - generic [ref=e1576]:
        - button "Recusar" [ref=e1577]
        - button "Aceitar" [ref=e1578]:
          - img
          - text: Aceitar
        - button "Dispensar" [ref=e1579]:
          - img [ref=e1580]
  - region "Notifications alt+T"
  - generic [active]:
    - generic [ref=e1585]:
      - generic [ref=e1586]:
        - generic [ref=e1587]:
          - navigation [ref=e1588]:
            - button "previous" [disabled] [ref=e1589]:
              - img "previous" [ref=e1590]
            - generic [ref=e1592]:
              - generic [ref=e1593]: 1/
              - text: "1"
            - button "next" [disabled] [ref=e1594]:
              - img "next" [ref=e1595]
          - img
        - generic [ref=e1597]:
          - link "Next.js 16.1.3 (stale) Turbopack" [ref=e1598] [cursor=pointer]:
            - /url: https://nextjs.org/docs/messages/version-staleness
            - img [ref=e1599]
            - generic "There is a newer version (16.2.11) available, upgrade recommended!" [ref=e1601]: Next.js 16.1.3 (stale)
            - generic [ref=e1602]: Turbopack
          - img
      - dialog "Build Error" [ref=e1604]:
        - generic [ref=e1607]:
          - generic [ref=e1608]:
            - generic [ref=e1609]:
              - generic [ref=e1611]: Build Error
              - generic [ref=e1612]:
                - button "Copy Error Info" [ref=e1613] [cursor=pointer]:
                  - img [ref=e1614]
                - button "No related documentation found" [disabled] [ref=e1616]:
                  - img [ref=e1617]
                - button "Attach Node.js inspector" [ref=e1619] [cursor=pointer]:
                  - img [ref=e1620]
            - generic [ref=e1629]: Reading source code for parsing failed
          - generic [ref=e1631]:
            - generic [ref=e1633]:
              - img [ref=e1635]
              - generic [ref=e1639]: ./.freebuff/worktrees/thmrzp9vv9y86o/src/lib/api-server.ts
              - button "Open in editor" [ref=e1640] [cursor=pointer]:
                - img [ref=e1642]
            - generic [ref=e1646]: "Reading source code for parsing failed An unexpected error happened while trying to read the source code to parse: failed to convert rope into string Caused by: - invalid utf-8 sequence of 1 bytes from index 5415 Import trace: App Route: ./.freebuff/worktrees/thmrzp9vv9y86o/src/lib/api-server.ts ./.freebuff/worktrees/thmrzp9vv9y86o/src/app/api/auth/me/route.ts"
        - generic [ref=e1647]: "1"
        - generic [ref=e1648]: "2"
    - generic [ref=e1653] [cursor=pointer]:
      - button "Open Next.js Dev Tools" [ref=e1654]:
        - img [ref=e1655]
      - button "Open issues overlay" [ref=e1659]:
        - generic [ref=e1660]:
          - generic [ref=e1661]: "0"
          - generic [ref=e1662]: "1"
        - generic [ref=e1663]: Issue
  - alert [ref=e1664]
```

# Test source

```ts
  74  |  * Click "Confirmar agendamento" button to submit the booking.
  75  |  */
  76  | export async function clickConfirmBooking(page: Page) {
  77  |   const btn = page.locator('button:has-text("Confirmar agendamento")')
  78  |   await btn.click()
  79  |   await page.waitForTimeout(1000)
  80  | }
  81  | 
  82  | /**
  83  |  * Register a new user via the auth modal.
  84  |  * Returns the generated email so it can be used for login later.
  85  |  */
  86  | export async function registerUser(
  87  |   page: Page,
  88  |   options: { role?: "CLIENT" | "PROVIDER" } = {},
  89  | ) {
  90  |   const { role = "CLIENT" } = options
  91  |   const email = `e2e-${Date.now()}@test.com`
  92  |   const password = "test123456"
  93  | 
  94  |   // Open auth modal if not already open
  95  |   const entrarBtn = page.getByRole("button", { name: /entrar|login|criar conta/i }).first()
  96  |   if (await entrarBtn.isVisible()) {
  97  |     await entrarBtn.click()
  98  |     await page.waitForTimeout(500)
  99  |   }
  100 | 
  101 |   // Switch to register tab if needed
  102 |   const criarBtn = page.getByRole("button", { name: /criar conta|cadastrar/i }).first()
  103 |   if (await criarBtn.isVisible()) {
  104 |     await criarBtn.click()
  105 |     await page.waitForTimeout(300)
  106 |   }
  107 | 
  108 |   // Fill the registration form
  109 |   const nameInput = page.getByPlaceholder(/nome/i).first()
  110 |   await nameInput.fill(`Test User ${role}`)
  111 | 
  112 |   const emailInput = page.getByPlaceholder(/email/i).first()
  113 |   await emailInput.fill(email)
  114 | 
  115 |   const passwordInput = page.getByPlaceholder(/senha/i).first()
  116 |   await passwordInput.fill(password)
  117 | 
  118 |   const confirmInput = page.getByPlaceholder(/confirmar/i).first()
  119 |   await confirmInput.fill(password)
  120 | 
  121 |   // Select role
  122 |   const roleRadio = page.locator(`label:has-text("${role === "CLIENT" ? "Cliente" : "Prestador"}")`).first()
  123 |   if (await roleRadio.isVisible()) {
  124 |     await roleRadio.click()
  125 |   }
  126 | 
  127 |   // For provider, fill additional required fields
  128 |   if (role === "PROVIDER") {
  129 |     const cpfInput = page.getByPlaceholder(/cpf|cnpj/i).first()
  130 |     await cpfInput.fill("123.456.789-00")
  131 | 
  132 |     const whatsInput = page.getByPlaceholder(/whatsapp|telefone/i).first()
  133 |     await whatsInput.fill("11999999999")
  134 | 
  135 |     const cityInput = page.getByPlaceholder(/cidade/i).first()
  136 |     await cityInput.fill("São Paulo")
  137 |   }
  138 | 
  139 |   // Submit
  140 |   const submitBtn = page.locator('button[type="submit"]:has-text(/criar|cadastrar|registrar/i)').first()
  141 |   await submitBtn.click()
  142 |   await page.waitForTimeout(2000)
  143 | 
  144 |   return { email, password }
  145 | }
  146 | 
  147 | /**
  148 |  * Login via the auth modal.
  149 |  */
  150 | export async function loginUser(page: Page, email: string, password: string) {
  151 |   const entrarBtn = page.getByRole("button", { name: /entrar|login/i }).first()
  152 |   if (await entrarBtn.isVisible()) {
  153 |     await entrarBtn.click()
  154 |     await page.waitForTimeout(500)
  155 |   }
  156 | 
  157 |   const emailInput = page.getByPlaceholder(/email/i).first()
  158 |   await emailInput.fill(email)
  159 | 
  160 |   const passwordInput = page.getByPlaceholder(/senha/i).first()
  161 |   await passwordInput.fill(password)
  162 | 
  163 |   const submitBtn = page.locator('button[type="submit"]:has-text(/entrar|login/i)').first()
  164 |   await submitBtn.click()
  165 |   await page.waitForTimeout(2000)
  166 | }
  167 | 
  168 | /**
  169 |  * Open the booking modal by clicking "Agendar" on the first provider card.
  170 |  */
  171 | export async function openBookingModal(page: Page) {
  172 |   // Click the first "Agendar" button visible on a provider card
  173 |   const agendarBtn = page.locator('button:has-text("Agendar")').first()
> 174 |   await agendarBtn.click()
      |                    ^ Error: locator.click: Test timeout of 30000ms exceeded.
  175 |   await page.waitForTimeout(1000)
  176 | 
  177 |   // Check if booking modal opened
  178 |   const modalTitle = page.locator('h2:has-text("Agendar serviço"), h2:has-text("Agendar serviço")').first()
  179 |   await modalTitle.waitFor({ state: "visible", timeout: 5000 }).catch(() => {})
  180 | }
  181 | 
  182 | /**
  183 |  * Complete the full booking flow:
  184 |  * Step 1: Select date + time
  185 |  * Step 2: Set quantity + address
  186 |  * Step 3: Select PIX
  187 |  * Step 4: Confirm
  188 |  * Returns true if the booking was successfully created.
  189 |  */
  190 | export async function completeBookingFlow(page: Page) {
  191 |   // Step 1 - Schedule: select first available date and time
  192 |   const dayButton = page.locator('button[role="gridcell"]:not([disabled])').first()
  193 |   await dayButton.click()
  194 |   await page.waitForTimeout(300)
  195 | 
  196 |   // Select first available time slot
  197 |   const timeSlot = page.getByRole("button").filter({ hasText: /\d{2}:\d{2}/ }).first()
  198 |   await timeSlot.click()
  199 |   await page.waitForTimeout(300)
  200 | 
  201 |   // Click Continue
  202 |   await clickContinue(page)
  203 | 
  204 |   // Step 2 - Details: fill CEP to trigger address lookup
  205 |   const cepInput = page.getByPlaceholder(/CEP/i).first()
  206 |   if (await cepInput.isVisible()) {
  207 |     await cepInput.fill("01310100")
  208 |     await page.waitForTimeout(1500)
  209 |   }
  210 | 
  211 |   // Click Continue
  212 |   await clickContinue(page)
  213 | 
  214 |   // Step 3 - Payment: PIX is selected by default, just Continue
  215 |   await clickContinue(page)
  216 | 
  217 |   // Step 4 - Confirmation: click Confirmar agendamento
  218 |   await clickConfirmBooking(page)
  219 | 
  220 |   // Wait for success toast or navigation
  221 |   await page.waitForTimeout(2000)
  222 | 
  223 |   // Check if we got redirected or saw a success message
  224 |   const success = page.locator('text=/agendamento confirmado|confirmado com sucesso|Agendamento criado/i').first()
  225 |   return await success.isVisible().catch(() => false)
  226 | }
  227 | 
```