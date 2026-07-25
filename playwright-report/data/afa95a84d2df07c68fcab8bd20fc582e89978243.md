# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: quote-flow.spec.ts >> QuoteModal — Visitante (não logado) >> 3. mostra as 5 etapas do wizard
- Location: e2e\quote-flow.spec.ts:173:7

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.click: Test timeout of 30000ms exceeded.
Call log:
  - waiting for locator('[class*="Card"], [class*="card"]').first()
    - locator resolved to <footer class="border-t bg-card px-4 py-12">…</footer>
  - attempting click action
    2 × waiting for element to be visible, enabled and stable
      - element is visible, enabled and stable
      - scrolling into view if needed
      - done scrolling
      - <nextjs-portal></nextjs-portal> from <script data-nextjs-dev-overlay="true">…</script> subtree intercepts pointer events
    - retrying click action
    - waiting 20ms
    2 × waiting for element to be visible, enabled and stable
      - element is visible, enabled and stable
      - scrolling into view if needed
      - done scrolling
      - <nextjs-portal></nextjs-portal> from <script data-nextjs-dev-overlay="true">…</script> subtree intercepts pointer events
    - retrying click action
      - waiting 100ms
    6 × waiting for element to be visible, enabled and stable
      - element is visible, enabled and stable
      - scrolling into view if needed
      - done scrolling
      - <nextjs-portal></nextjs-portal> from <script data-nextjs-dev-overlay="true">…</script> subtree intercepts pointer events
    - retrying click action
      - waiting 500ms
    - waiting for element to be visible, enabled and stable
  - element was detached from the DOM, retrying
    - locator resolved to <div class="flex flex-col items-center gap-3 rounded-2xl border bg-card p-5">…</div>
  - attempting click action
    2 × waiting for element to be visible, enabled and stable
      - element is visible, enabled and stable
      - scrolling into view if needed
      - done scrolling
      - <nextjs-portal></nextjs-portal> from <script data-nextjs-dev-overlay="true">…</script> subtree intercepts pointer events
    - retrying click action
    - waiting 20ms
    2 × waiting for element to be visible, enabled and stable
      - element is visible, enabled and stable
      - scrolling into view if needed
      - done scrolling
      - <nextjs-portal></nextjs-portal> from <script data-nextjs-dev-overlay="true">…</script> subtree intercepts pointer events
    - retrying click action
      - waiting 100ms
    2 × waiting for element to be visible, enabled and stable
      - element is visible, enabled and stable
      - scrolling into view if needed
      - done scrolling
      - <nextjs-portal></nextjs-portal> from <script data-nextjs-dev-overlay="true">…</script> subtree intercepts pointer events
    - retrying click action
      - waiting 500ms
    - waiting for element to be visible, enabled and stable

```

# Page snapshot

```yaml
- generic [ref=e1]:
  - generic [ref=e3]:
    - generic [ref=e5]:
      - img [ref=e7]
      - generic [ref=e9]:
        - paragraph [ref=e10]: Bem-vindo ao Severinno!
        - paragraph [ref=e11]: 3 prestadores disponíveis na sua região
      - button "Dispensar notificação" [ref=e12]:
        - img [ref=e13]
    - banner [ref=e16]:
      - generic [ref=e18]:
        - button "Severinno — página inicial" [ref=e19]:
          - generic [ref=e20]:
            - img [ref=e22]
            - img [ref=e26]
          - generic [ref=e28]: Severinno
          - generic [ref=e29]:
            - img [ref=e30]
            - generic [ref=e33]: Verificado
        - generic [ref=e36]:
          - img
          - textbox "Buscar prestadores (compacto)" [ref=e37]:
            - /placeholder: Buscar…
        - button "Usar minha localização" [ref=e39]:
          - img
          - generic [ref=e40]: Definir localização
        - generic [ref=e41]:
          - button "Alternar tema" [ref=e42]:
            - generic [ref=e43]:
              - img
          - generic [ref=e44]:
            - button "Entrar" [ref=e45]
            - button "Cadastrar" [ref=e46]
    - main [ref=e47]:
      - generic [ref=e54]:
        - generic [ref=e55]:
          - generic [ref=e57]:
            - img [ref=e58]
            - text: Marketplace de serviços verificados
          - heading "Prestadores de serviço verificados, perto de você." [level=1] [ref=e61]
          - paragraph [ref=e62]: Compare avaliações reais, peça orçamento grátis e agende — encanador, eletricista, pintor e mais. Você escolhe o profissional.
          - generic [ref=e64]:
            - generic [ref=e65]:
              - img [ref=e66]
              - textbox "Serviço buscado" [ref=e69]:
                - /placeholder: "O que você precisa? Ex.: encanador, pintura…"
            - generic [ref=e70]:
              - img [ref=e71]
              - textbox "Localização" [ref=e74]:
                - /placeholder: CEP ou cidade
            - button "Buscar" [ref=e75]:
              - img
              - text: Buscar
          - generic [ref=e76]:
            - generic [ref=e77]: "Mais buscados:"
            - button "Encanador" [ref=e78]:
              - generic [ref=e79]: 🔧
              - text: Encanador
            - button "Eletricista" [ref=e80]:
              - generic [ref=e81]: 💡
              - text: Eletricista
            - button "Pintor" [ref=e82]:
              - generic [ref=e83]: 🎨
              - text: Pintor
            - button "Diarista" [ref=e84]:
              - generic [ref=e85]: 🧹
              - text: Diarista
            - button "Pedreiro" [ref=e86]:
              - generic [ref=e87]: 🧱
              - text: Pedreiro
            - button "Jardineiro" [ref=e88]:
              - generic [ref=e89]: 🌿
              - text: Jardineiro
          - button "Usar minha localização" [ref=e90]:
            - img [ref=e91]
            - text: Usar minha localização
          - generic [ref=e94]:
            - button "Cadastrar grátis" [ref=e95]:
              - text: Cadastrar grátis
              - img
            - button "Ver como funciona" [ref=e96]
          - paragraph [ref=e97]: Cadastro grátis · Orçamento sem compromisso · Você escolhe o profissional
          - list [ref=e98]:
            - listitem "Documentos validados e identidade confirmada" [ref=e99]:
              - img [ref=e101]
              - generic [ref=e104]: Prestadores verificados
            - listitem "Avaliações de clientes após a conclusão do serviço" [ref=e105]:
              - img [ref=e107]
              - generic [ref=e109]: Avaliações reais
            - listitem "Pagamento só é liberado após você marcar como concluído" [ref=e110]:
              - img [ref=e112]
              - generic [ref=e115]: Pagamento seguro
        - generic [ref=e124]: Atividade ao vivo
      - region "Atividade recente na plataforma" [ref=e152]:
        - generic [ref=e153]:
          - generic [ref=e155]: Atividade recente
          - generic [ref=e159]:
            - generic [ref=e161]:
              - generic [ref=e162]:
                - generic [ref=e163]: ⚡
                - text: Maria contratou um eletricista em São Paulo
              - generic [ref=e165]:
                - generic [ref=e166]: ⭐
                - text: João avaliou ★★★★★ o prestador Ricardo
              - generic [ref=e168]:
                - generic [ref=e169]: 🎨
                - text: "Nova avaliação: 4.9 para Serviços de Pintura"
              - generic [ref=e171]:
                - generic [ref=e172]: 🔧
                - text: Ana pediu orçamento para encanador
              - generic [ref=e174]:
                - generic [ref=e175]: ✅
                - text: Pedro se cadastrou como prestador verificado
              - generic [ref=e177]:
                - generic [ref=e178]: 📋
                - text: 12 orçamentos enviados hoje
              - generic [ref=e180]:
                - generic [ref=e181]: ⚡
                - text: Maria contratou um eletricista em São Paulo
              - generic [ref=e183]:
                - generic [ref=e184]: ⭐
                - text: João avaliou ★★★★★ o prestador Ricardo
              - generic [ref=e186]:
                - generic [ref=e187]: 🎨
                - text: "Nova avaliação: 4.9 para Serviços de Pintura"
              - generic [ref=e189]:
                - generic [ref=e190]: 🔧
                - text: Ana pediu orçamento para encanador
              - generic [ref=e192]:
                - generic [ref=e193]: ✅
                - text: Pedro se cadastrou como prestador verificado
              - generic [ref=e195]:
                - generic [ref=e196]: 📋
                - text: 12 orçamentos enviados hoje
            - generic [ref=e200]:
              - generic [ref=e201]:
                - generic [ref=e202]: 🧹
                - text: Carlos agendou limpeza de quintal em Belo Horizonte
              - generic [ref=e204]:
                - generic [ref=e205]: ⭐
                - text: Fernanda avaliou ★★★★★ o prestador José
              - generic [ref=e207]:
                - generic [ref=e208]: 🛡️
                - text: 8 novos prestadores verificados esta semana
              - generic [ref=e210]:
                - generic [ref=e211]: 🎨
                - text: Luciana contratou um pintor no Rio de Janeiro
              - generic [ref=e213]:
                - generic [ref=e214]: 🚿
                - text: "Orçamento aceito: reforma de banheiro em Curitiba"
              - generic [ref=e216]:
                - generic [ref=e217]: 🏆
                - text: 5.200 serviços concluídos este mês
              - generic [ref=e219]:
                - generic [ref=e220]: 🧹
                - text: Carlos agendou limpeza de quintal em Belo Horizonte
              - generic [ref=e222]:
                - generic [ref=e223]: ⭐
                - text: Fernanda avaliou ★★★★★ o prestador José
              - generic [ref=e225]:
                - generic [ref=e226]: 🛡️
                - text: 8 novos prestadores verificados esta semana
              - generic [ref=e228]:
                - generic [ref=e229]: 🎨
                - text: Luciana contratou um pintor no Rio de Janeiro
              - generic [ref=e231]:
                - generic [ref=e232]: 🚿
                - text: "Orçamento aceito: reforma de banheiro em Curitiba"
              - generic [ref=e234]:
                - generic [ref=e235]: 🏆
                - text: 5.200 serviços concluídos este mês
      - region "Categorias de serviços" [ref=e237]:
        - generic [ref=e238]:
          - generic:
            - img
          - generic [ref=e240]:
            - generic [ref=e241]:
              - img [ref=e242]
              - text: Explore categorias
            - heading "Encontre o serviço ideal" [level=2] [ref=e245]
            - paragraph [ref=e246]: Serviços verificados perto de você — … carregando categorias
          - generic "Carregando categorias" [ref=e247]
      - region "Resultados da busca" [ref=e288]:
        - generic [ref=e289]:
          - complementary [ref=e290]:
            - generic [ref=e292]:
              - generic [ref=e293]:
                - heading "Filtros" [level=2] [ref=e294]:
                  - img [ref=e295]
                  - text: Filtros
                - button "Limpar filtros" [ref=e296]
              - generic [ref=e297]:
                - generic [ref=e298]: Buscar
                - generic [ref=e299]:
                  - img [ref=e300]
                  - textbox "Buscar" [ref=e303]:
                    - /placeholder: Serviço, prestador…
              - generic [ref=e304]:
                - generic [ref=e305]:
                  - generic [ref=e306]: Raio de busca
                  - generic [ref=e307]: 15 km
                - generic "Raio de busca em quilômetros" [ref=e308]:
                  - slider [ref=e312]
                - generic [ref=e313]:
                  - generic [ref=e314]: 1 km
                  - generic [ref=e315]: 50 km
              - generic [ref=e316]:
                - generic [ref=e317]: Categoria
                - combobox [ref=e318]:
                  - generic: Todas as categorias
                  - img
              - generic [ref=e319]:
                - generic [ref=e320]: Ordenar por
                - radiogroup "Ordenar por" [ref=e321]:
                  - radio "Melhor avaliação" [checked] [ref=e322]
                  - radio "Mais próximos" [ref=e323]
              - generic [ref=e324]:
                - generic [ref=e325]: Avaliação mínima
                - radiogroup [ref=e326]:
                  - generic [ref=e327] [cursor=pointer]:
                    - radio "Todas" [checked] [ref=e328]:
                      - img [ref=e329]
                    - generic [ref=e331]: Todas
                  - generic [ref=e332] [cursor=pointer]:
                    - radio "3+" [ref=e333]
                    - generic [ref=e334]: 3+
                  - generic [ref=e335] [cursor=pointer]:
                    - radio "4+" [ref=e336]
                    - generic [ref=e337]: 4+
                  - generic [ref=e338] [cursor=pointer]:
                    - radio "5" [ref=e339]
                    - generic [ref=e340]: "5"
              - generic [ref=e341] [cursor=pointer]:
                - generic [ref=e342]:
                  - img [ref=e343]
                  - generic [ref=e345]: Somente verificados
                - switch "Somente verificados" [ref=e346]
              - button "Ver 3 resultados" [disabled]
          - generic [ref=e347]:
            - generic [ref=e349]:
              - generic [ref=e350]:
                - heading "3 prestadores encontrados" [level=2] [ref=e351]
                - paragraph [ref=e352]: Exibindo 1–3 de 3
              - generic [ref=e353]:
                - generic [ref=e354]:
                  - text: "Ordenado por:"
                  - generic [ref=e355]: Melhor avaliação
                - tablist "Visualização" [ref=e356]:
                  - tab "Lista" [selected] [ref=e357]:
                    - img [ref=e358]
                    - generic [ref=e359]: Lista
                  - tab "Mapa" [ref=e360]:
                    - img [ref=e361]
                    - generic [ref=e363]: Mapa
            - generic [ref=e365]:
              - generic [ref=e367]:
                - generic [ref=e368]:
                  - img "Capa de Maria Silva" [ref=e369]
                  - generic [ref=e371]:
                    - img [ref=e372]
                    - text: Verificado
                  - generic [ref=e375]:
                    - button "Adicionar Maria Silva à comparação" [ref=e376]:
                      - img [ref=e377]
                    - button "Adicionar Maria Silva aos favoritos" [ref=e382]:
                      - img [ref=e383]
                  - img "Maria Silva" [ref=e387]
                - generic [ref=e388]:
                  - generic [ref=e389]:
                    - button "Ver perfil de Maria Silva" [ref=e390]:
                      - heading "Maria Silva" [level=3] [ref=e391]:
                        - generic [ref=e392]: Maria Silva
                        - img [ref=e393]
                    - generic "Avaliação média" [ref=e395]:
                      - img [ref=e396]
                      - text: "4.8"
                      - generic [ref=e398]: (42)
                  - paragraph [ref=e399]: a partir de R$ 120,00
                  - generic [ref=e400]:
                    - generic [ref=e401]:
                      - img [ref=e402]
                      - text: 2,5 km
                    - generic [ref=e405]:
                      - img [ref=e406]
                      - text: São Paulo
                  - paragraph [ref=e409]: Especialista em instalações elétricas residenciais com mais de 10 anos de experiência.
                  - generic [ref=e410]:
                    - generic "Serviços concluídos com sucesso" [ref=e411]:
                      - img [ref=e412]
                      - text: 230 serviços concluídos
                    - generic "Na plataforma desde" [ref=e415]:
                      - img [ref=e416]
                      - text: desde jan. de 2023
                - generic [ref=e420]:
                  - generic [ref=e421]:
                    - img [ref=e422]
                    - generic [ref=e424]: Instalação Elétrica · a partir de R$ 120,00
                  - heading "Elétrica 1 serviço" [level=3] [ref=e427]:
                    - button "Elétrica 1 serviço" [ref=e428]:
                      - generic [ref=e430]:
                        - paragraph [ref=e431]: Elétrica
                        - paragraph [ref=e432]: 1 serviço
                      - img
                - generic [ref=e433]:
                  - button "Orçamento" [ref=e434]:
                    - img
                    - text: Orçamento
                  - button "Agendar" [ref=e435]:
                    - img
                    - text: Agendar
              - generic [ref=e437]:
                - generic [ref=e438]:
                  - img "Capa de João Pedreiro" [ref=e439]
                  - generic [ref=e441]:
                    - img [ref=e442]
                    - text: Verificado
                  - generic [ref=e445]:
                    - button "Adicionar João Pedreiro à comparação" [ref=e446]:
                      - img [ref=e447]
                    - button "Adicionar João Pedreiro aos favoritos" [ref=e452]:
                      - img [ref=e453]
                  - img "João Pedreiro" [ref=e457]
                - generic [ref=e458]:
                  - generic [ref=e459]:
                    - button "Ver perfil de João Pedreiro" [ref=e460]:
                      - heading "João Pedreiro" [level=3] [ref=e461]:
                        - generic [ref=e462]: João Pedreiro
                        - img [ref=e463]
                    - generic "Avaliação média" [ref=e465]:
                      - img [ref=e466]
                      - text: "4.8"
                      - generic [ref=e468]: (42)
                  - paragraph [ref=e469]: a partir de R$ 120,00
                  - generic [ref=e470]:
                    - generic [ref=e471]:
                      - img [ref=e472]
                      - text: 2,5 km
                    - generic [ref=e475]:
                      - img [ref=e476]
                      - text: São Paulo
                  - paragraph [ref=e479]: Especialista em instalações elétricas residenciais com mais de 10 anos de experiência.
                  - generic [ref=e480]:
                    - generic "Serviços concluídos com sucesso" [ref=e481]:
                      - img [ref=e482]
                      - text: 230 serviços concluídos
                    - generic "Na plataforma desde" [ref=e485]:
                      - img [ref=e486]
                      - text: desde jan. de 2023
                - generic [ref=e490]:
                  - generic [ref=e491]:
                    - img [ref=e492]
                    - generic [ref=e494]: Instalação Elétrica · a partir de R$ 120,00
                  - heading "Construção 1 serviço" [level=3] [ref=e497]:
                    - button "Construção 1 serviço" [ref=e498]:
                      - generic [ref=e500]:
                        - paragraph [ref=e501]: Construção
                        - paragraph [ref=e502]: 1 serviço
                      - img
                - generic [ref=e503]:
                  - button "Orçamento" [ref=e504]:
                    - img
                    - text: Orçamento
                  - button "Agendar" [ref=e505]:
                    - img
                    - text: Agendar
              - generic [ref=e507]:
                - generic [ref=e508]:
                  - img "Capa de Ana Pintora" [ref=e509]
                  - generic [ref=e511]:
                    - img [ref=e512]
                    - text: Verificado
                  - generic [ref=e515]:
                    - button "Adicionar Ana Pintora à comparação" [ref=e516]:
                      - img [ref=e517]
                    - button "Adicionar Ana Pintora aos favoritos" [ref=e522]:
                      - img [ref=e523]
                  - img "Ana Pintora" [ref=e527]
                - generic [ref=e528]:
                  - generic [ref=e529]:
                    - button "Ver perfil de Ana Pintora" [ref=e530]:
                      - heading "Ana Pintora" [level=3] [ref=e531]:
                        - generic [ref=e532]: Ana Pintora
                        - img [ref=e533]
                    - generic "Avaliação média" [ref=e535]:
                      - img [ref=e536]
                      - text: "4.8"
                      - generic [ref=e538]: (42)
                  - paragraph [ref=e539]: a partir de R$ 120,00
                  - generic [ref=e540]:
                    - generic [ref=e541]:
                      - img [ref=e542]
                      - text: 2,5 km
                    - generic [ref=e545]:
                      - img [ref=e546]
                      - text: São Paulo
                  - paragraph [ref=e549]: Especialista em instalações elétricas residenciais com mais de 10 anos de experiência.
                  - generic [ref=e550]:
                    - generic "Serviços concluídos com sucesso" [ref=e551]:
                      - img [ref=e552]
                      - text: 230 serviços concluídos
                    - generic "Na plataforma desde" [ref=e555]:
                      - img [ref=e556]
                      - text: desde jan. de 2023
                - generic [ref=e560]:
                  - generic [ref=e561]:
                    - img [ref=e562]
                    - generic [ref=e564]: Instalação Elétrica · a partir de R$ 120,00
                  - heading "Pintura 1 serviço" [level=3] [ref=e567]:
                    - button "Pintura 1 serviço" [ref=e568]:
                      - generic [ref=e570]:
                        - paragraph [ref=e571]: Pintura
                        - paragraph [ref=e572]: 1 serviço
                      - img
                - generic [ref=e573]:
                  - button "Orçamento" [ref=e574]:
                    - img
                    - text: Orçamento
                  - button "Agendar" [ref=e575]:
                    - img
                    - text: Agendar
      - region "Como funciona" [ref=e576]:
        - generic [ref=e581]:
          - generic [ref=e582]:
            - link "Pular para resultados" [ref=e583] [cursor=pointer]:
              - /url: "#vitrine-resultados"
              - img [ref=e584]
              - text: Pular para resultados
            - generic [ref=e588]:
              - img [ref=e589]
              - generic [ref=e591]: "4"
              - text: passos simples
            - heading "Como funciona" [level=2] [ref=e592]
            - paragraph [ref=e593]: Sem surpresas — do início ao fim, você tem o controle.
            - generic [ref=e594]:
              - img [ref=e595]
              - text: Sem compromisso
          - generic [ref=e601]:
            - img [ref=e603]
            - generic [ref=e604]:
              - 'button "1 Busque o serviço Encontre prestadores verificados perto de você. 50 + categorias encanador em São Paulo | Verificados < 5 km Mais filtros Ex: Busque ''encanador em São Paulo'' Buscar prestadores" [ref=e605] [cursor=pointer]':
                - generic [ref=e607]:
                  - generic [ref=e609]: "1"
                  - generic [ref=e610]:
                    - img [ref=e612]
                    - img [ref=e616]
                  - heading "Busque o serviço" [level=3] [ref=e619]
                  - paragraph [ref=e620]: Encontre prestadores verificados perto de você.
                  - generic [ref=e622]:
                    - generic [ref=e623]: "50"
                    - text: +
                    - generic [ref=e624]: categorias
                  - generic [ref=e626]:
                    - generic [ref=e627]:
                      - img [ref=e628]
                      - generic [ref=e631]: encanador em São Paulo
                      - generic [ref=e632]: "|"
                    - generic [ref=e633]:
                      - generic [ref=e634]: Verificados
                      - generic [ref=e635]: < 5 km
                      - generic [ref=e636]:
                        - img [ref=e637]
                        - text: Mais filtros
                  - paragraph [ref=e639]: "Ex: Busque 'encanador em São Paulo'"
                  - button "Buscar prestadores" [ref=e640]:
                    - text: Buscar prestadores
                    - img
              - 'button "2 Compare orçamentos Receba e compare propostas lado a lado. 3 orçamentos em 24h João S. R$ 180 Maria L. R$ 150 Melhor avaliação Compare lado a lado Ex: Compare 3 orçamentos em 24h Sem compromisso Pedir orçamento" [ref=e641] [cursor=pointer]':
                - generic [ref=e643]:
                  - generic [ref=e645]: "2"
                  - generic [ref=e646]:
                    - img [ref=e648]
                    - img [ref=e654]
                  - heading "Compare orçamentos" [level=3] [ref=e657]
                  - paragraph [ref=e658]: Receba e compare propostas lado a lado.
                  - generic [ref=e660]:
                    - generic [ref=e661]: "3"
                    - generic [ref=e662]: orçamentos em 24h
                  - generic [ref=e664]:
                    - generic [ref=e665]:
                      - generic [ref=e666]:
                        - generic [ref=e669]: João S.
                        - generic [ref=e670]:
                          - img [ref=e671]
                          - img [ref=e673]
                          - img [ref=e675]
                          - img [ref=e677]
                          - img [ref=e679]
                        - generic [ref=e681]: R$ 180
                      - generic [ref=e682]:
                        - generic [ref=e685]: Maria L.
                        - generic [ref=e686]:
                          - img [ref=e687]
                          - img [ref=e689]
                          - img [ref=e691]
                          - img [ref=e693]
                          - img [ref=e695]
                        - generic [ref=e697]: R$ 150
                        - generic [ref=e698]: Melhor avaliação
                    - generic [ref=e699]:
                      - img [ref=e700]
                      - text: Compare lado a lado
                  - paragraph [ref=e705]: "Ex: Compare 3 orçamentos em 24h"
                  - generic [ref=e706]:
                    - img [ref=e707]
                    - text: Sem compromisso
                  - button "Pedir orçamento" [ref=e712]:
                    - text: Pedir orçamento
                    - img
              - 'button "3 Agende com confiança Solicite um orçamento ou agende diretamente. 24 h para confirmar Março 2025 S T Q Q S S D 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 12 Mar, 14:00 — Confirmado Ex: Agende para amanhã às 14h Agendar agora" [ref=e713] [cursor=pointer]':
                - generic [ref=e715]:
                  - generic [ref=e717]: "3"
                  - generic [ref=e718]:
                    - img [ref=e720]
                    - img [ref=e724]
                  - heading "Agende com confiança" [level=3] [ref=e727]
                  - paragraph [ref=e728]: Solicite um orçamento ou agende diretamente.
                  - generic [ref=e730]:
                    - generic [ref=e731]: "24"
                    - text: h
                    - generic [ref=e732]: para confirmar
                  - generic [ref=e735]:
                    - generic [ref=e736]: Março 2025
                    - generic [ref=e737]:
                      - generic [ref=e738]: S
                      - generic [ref=e739]: T
                      - generic [ref=e740]: Q
                      - generic [ref=e741]: Q
                      - generic [ref=e742]: S
                      - generic [ref=e743]: S
                      - generic [ref=e744]: D
                      - generic [ref=e745]: "1"
                      - generic [ref=e746]: "2"
                      - generic [ref=e747]: "3"
                      - generic [ref=e748]: "4"
                      - generic [ref=e749]: "5"
                      - generic [ref=e750]: "6"
                      - generic [ref=e751]: "7"
                      - generic [ref=e752]: "8"
                      - generic [ref=e753]: "9"
                      - generic [ref=e754]: "10"
                      - generic [ref=e755]: "11"
                      - generic [ref=e756]: "12"
                      - generic [ref=e757]: "13"
                      - generic [ref=e758]: "14"
                      - generic [ref=e759]: "15"
                    - generic [ref=e760]:
                      - img [ref=e761]
                      - generic [ref=e764]: 12 Mar, 14:00 — Confirmado
                  - paragraph [ref=e765]: "Ex: Agende para amanhã às 14h"
                  - button "Agendar agora" [ref=e766]:
                    - text: Agendar agora
                    - img
              - 'button "4 Avalie o resultado Sua opinião mantém a qualidade da comunidade. 98 % satisfação 4.0 \"Excelente trabalho, recomendo!\" Avaliação verificada Ex: Avalie de 1 a 5 estrelas com comentário Cadastrar grátis" [ref=e767] [cursor=pointer]':
                - generic [ref=e769]:
                  - generic [ref=e771]: "4"
                  - generic [ref=e772]:
                    - img [ref=e774]
                    - img [ref=e777]
                  - heading "Avalie o resultado" [level=3] [ref=e780]
                  - paragraph [ref=e781]: Sua opinião mantém a qualidade da comunidade.
                  - generic [ref=e783]:
                    - generic [ref=e784]: "98"
                    - text: "%"
                    - generic [ref=e785]: satisfação
                  - generic [ref=e787]:
                    - generic [ref=e788]:
                      - generic [ref=e789]:
                        - img [ref=e790]
                        - img [ref=e792]
                        - img [ref=e794]
                        - img [ref=e796]
                        - img [ref=e798]
                        - generic [ref=e800]: "4.0"
                      - paragraph [ref=e803]: "\"Excelente trabalho, recomendo!\""
                    - generic [ref=e804]:
                      - img [ref=e805]
                      - text: Avaliação verificada
                  - paragraph [ref=e808]: "Ex: Avalie de 1 a 5 estrelas com comentário"
                  - button "Cadastrar grátis" [ref=e809]:
                    - text: Cadastrar grátis
                    - img
          - generic [ref=e810]:
            - generic [ref=e811]:
              - img [ref=e812]
              - generic [ref=e815]: Garantia Severinno
            - generic [ref=e816]:
              - generic [ref=e817]:
                - img [ref=e818]
                - generic [ref=e821]: Prestadores verificados
              - generic [ref=e822]:
                - img [ref=e823]
                - generic [ref=e826]: Resposta rápida
              - generic [ref=e827]:
                - img [ref=e828]
                - generic [ref=e830]: Satisfação garantida
              - generic [ref=e831]:
                - img [ref=e832]
                - generic [ref=e837]: Compare antes de contratar
          - generic [ref=e838]:
            - button "Começar agora" [ref=e839]:
              - text: Começar agora
              - img
            - link "Buscar prestadores" [ref=e840] [cursor=pointer]:
              - /url: "#vitrine-resultados"
              - img
              - text: Buscar prestadores
          - button "Voltar ao topo" [ref=e842]:
            - img [ref=e843]
            - text: Voltar ao topo
      - generic [ref=e846]:
        - generic [ref=e847]:
          - generic [ref=e848]:
            - img
            - text: Simulador de preços
          - heading "Quanto custa? Simule agora" [level=2] [ref=e849]
          - paragraph [ref=e850]: Estime o valor do serviço em 3 passos rápidos. Sem compromisso, sem cadastro.
        - generic [ref=e851]:
          - generic [ref=e852]: "1"
          - generic [ref=e854]: "2"
          - generic [ref=e856]: "3"
        - generic [ref=e859]:
          - heading "1. Qual serviço você precisa?" [level=3] [ref=e860]
          - paragraph [ref=e861]: Selecione a categoria do serviço
          - generic [ref=e862]:
            - button "Elétrica" [ref=e863]:
              - img [ref=e865]
              - generic [ref=e867]: Elétrica
            - button "Hidráulica" [ref=e868]:
              - img [ref=e870]
              - generic [ref=e873]: Hidráulica
            - button "Pintura" [ref=e874]:
              - img [ref=e876]
              - generic [ref=e880]: Pintura
            - button "Alvenaria" [ref=e881]:
              - img [ref=e883]
              - generic [ref=e885]: Alvenaria
            - button "Pisos" [ref=e886]:
              - img [ref=e888]
              - generic [ref=e890]: Pisos
            - button "Pós-obra" [ref=e891]:
              - img [ref=e893]
              - generic [ref=e898]: Pós-obra
            - button "Residencial" [ref=e899]:
              - img [ref=e901]
              - generic [ref=e904]: Residencial
      - region "Parceiros e imprensa" [ref=e905]:
        - generic [ref=e906]:
          - paragraph [ref=e908]: Referência no mercado
          - generic [ref=e910]:
            - generic [ref=e913]: G1
            - generic [ref=e916]: Folha de S.Paulo
            - generic [ref=e919]: Valor Econômico
            - generic [ref=e922]: Exame
            - generic [ref=e925]: InfoMoney
            - generic [ref=e928]: Startups
            - generic [ref=e931]: Sebrae
            - generic [ref=e934]: ABES
          - paragraph [ref=e935]: + de 6.000 prestadores confiam no Severinno
      - region "Avaliações de clientes" [ref=e936]:
        - generic:
          - generic:
            - img
        - generic [ref=e938]:
          - generic [ref=e939]:
            - img [ref=e940]
            - text: Avaliações reais
          - heading "O que nossos clientes dizem" [level=2] [ref=e942]
          - paragraph [ref=e943]: Avaliações de clientes após a conclusão do serviço.
      - generic [ref=e1008]:
        - generic [ref=e1011]:
          - generic [ref=e1012]:
            - img [ref=e1014]
            - paragraph [ref=e1021]: Prestadores verificados
          - generic [ref=e1022]:
            - img [ref=e1024]
            - paragraph [ref=e1028]: Serviços cadastrados
          - generic [ref=e1029]:
            - img [ref=e1031]
            - paragraph [ref=e1036]: Serviços concluídos
          - generic [ref=e1037]:
            - img [ref=e1039]
            - paragraph [ref=e1043]: Nota média
        - generic [ref=e1045]:
          - generic [ref=e1046]:
            - generic [ref=e1047]:
              - img [ref=e1048]
              - text: Por que Severinno?
            - heading "Confiança em cada agendamento" [level=2] [ref=e1051]
            - paragraph [ref=e1052]: Mais que um diretório de serviços — um ecossistema pensado para proteger você e o prestador. Da verificação ao pagamento, cada etapa foi desenhada para a sua tranquilidade.
            - link "Pular para FAQ" [ref=e1054] [cursor=pointer]:
              - /url: "#faq"
              - img [ref=e1055]
              - text: Pular para FAQ
          - generic [ref=e1058]:
            - generic [ref=e1061]:
              - generic [ref=e1062]:
                - img [ref=e1064]
                - button "Saiba mais sobre Prestadores verificados" [ref=e1067]:
                  - img [ref=e1068]
              - heading "Prestadores verificados" [level=3] [ref=e1071]
              - paragraph [ref=e1072]: João verificou 3 documentos antes de aprovar o prestador. Você só vê profissionais validados.
              - button "Saiba mais" [ref=e1073]:
                - text: Saiba mais
                - img [ref=e1074]
            - generic [ref=e1078]:
              - generic [ref=e1079]:
                - img [ref=e1081]
                - button "Saiba mais sobre Pagamento protegido" [ref=e1084]:
                  - img [ref=e1085]
              - heading "Pagamento protegido" [level=3] [ref=e1088]
              - paragraph [ref=e1089]: O valor só é liberado ao prestador após você confirmar que ficou satisfeito com o serviço.
              - button "Saiba mais" [ref=e1090]:
                - text: Saiba mais
                - img [ref=e1091]
            - generic [ref=e1095]:
              - generic [ref=e1096]:
                - img [ref=e1098]
                - button "Saiba mais sobre Resposta rápida" [ref=e1101]:
                  - img [ref=e1102]
              - heading "Resposta rápida" [level=3] [ref=e1105]
              - paragraph [ref=e1106]: Prestadores comprometidos a responder em até 24h. Acompanhe o status em tempo real.
              - button "Saiba mais" [ref=e1107]:
                - text: Saiba mais
                - img [ref=e1108]
            - generic [ref=e1112]:
              - generic [ref=e1113]:
                - img [ref=e1115]
                - button "Saiba mais sobre Avaliações reais" [ref=e1117]:
                  - img [ref=e1118]
              - heading "Avaliações reais" [level=3] [ref=e1121]
              - paragraph [ref=e1122]: Apenas clientes que concluíram o serviço podem avaliar. Sem falsas avaliações.
              - button "Saiba mais" [ref=e1123]:
                - text: Saiba mais
                - img [ref=e1124]
            - generic [ref=e1128]:
              - generic [ref=e1129]:
                - img [ref=e1131]
                - button "Saiba mais sobre Próximo de você" [ref=e1134]:
                  - img [ref=e1135]
              - heading "Próximo de você" [level=3] [ref=e1138]
              - paragraph [ref=e1139]: Geolocalização inteligente mostra os melhores prestadores na sua região.
              - button "Saiba mais" [ref=e1140]:
                - text: Saiba mais
                - img [ref=e1141]
            - generic [ref=e1145]:
              - generic [ref=e1146]:
                - img [ref=e1148]
                - button "Saiba mais sobre Suporte humano" [ref=e1150]:
                  - img [ref=e1151]
              - heading "Suporte humano" [level=3] [ref=e1154]
              - paragraph [ref=e1155]: Equipe disponível para mediar disputas, tirar dúvidas e garantir uma experiência justa.
              - button "Saiba mais" [ref=e1156]:
                - text: Saiba mais
                - img [ref=e1157]
        - generic [ref=e1160]:
          - img [ref=e1161]
          - paragraph [ref=e1163]: "Garantia Severinno: seu dinheiro de volta se o serviço não for bem-feito."
          - link "Saiba mais" [ref=e1164] [cursor=pointer]:
            - /url: "#faq"
            - text: Saiba mais
            - img [ref=e1165]
      - generic [ref=e1168]:
        - generic [ref=e1169]:
          - generic [ref=e1170]:
            - img [ref=e1171]
            - text: Destaque da semana
          - heading "Profissional em destaque" [level=2] [ref=e1177]
          - paragraph [ref=e1178]: Conheça um dos nossos prestadores mais bem avaliados.
        - generic [ref=e1182]:
          - generic [ref=e1183]:
            - generic [ref=e1184]:
              - img [ref=e1187]
              - img [ref=e1191]
              - generic [ref=e1195]:
                - img [ref=e1196]
                - text: Top
            - generic [ref=e1198]:
              - generic [ref=e1199]:
                - heading "Maria Silva" [level=3] [ref=e1200]
                - generic [ref=e1201]:
                  - generic [ref=e1202]:
                    - img [ref=e1203]
                    - text: São Paulo
                  - generic [ref=e1206]: 3 km
                  - generic [ref=e1207]:
                    - img [ref=e1208]
                    - text: Membro desde 2023
              - generic [ref=e1210]:
                - generic [ref=e1211]:
                  - img [ref=e1212]
                  - generic [ref=e1214]: "4.8"
                - generic [ref=e1215]: (42 avaliações)
              - generic [ref=e1216]:
                - generic [ref=e1217]:
                  - img
                  - text: 230 serviços concluídos
                - generic [ref=e1218]:
                  - img
                  - text: Responde em ~30min
              - generic [ref=e1219]:
                - paragraph [ref=e1220]: Serviços
                - generic [ref=e1222]:
                  - generic [ref=e1223]: Instalação Elétrica
                  - generic [ref=e1224]: R$ 120,00
              - paragraph [ref=e1226]: Especialista em instalações elétricas residenciais com mais de 10 anos de experiência.
              - generic [ref=e1227]:
                - generic [ref=e1228]:
                  - generic "Maria S." [ref=e1229]: M
                  - generic "João P." [ref=e1230]: J
                  - generic "Ana L." [ref=e1231]: A
                - generic [ref=e1232]: Clientes recentes
          - generic [ref=e1233]:
            - generic [ref=e1234]:
              - button "Pedir orçamento" [ref=e1235]:
                - img
                - text: Pedir orçamento
              - button "Ver perfil completo" [ref=e1236]:
                - text: Ver perfil completo
                - img
            - button "Enviar mensagem" [ref=e1238]:
              - img
              - text: Enviar mensagem
      - generic [ref=e1242]:
        - generic [ref=e1243]:
          - generic [ref=e1244]:
            - generic [ref=e1245]:
              - img [ref=e1246]
              - text: Perguntas frequentes
            - heading "Tire suas dúvidas antes de contratar" [level=2] [ref=e1249]
            - paragraph [ref=e1250]: Reunimos as perguntas mais comuns sobre como o Severinno funciona — do cadastro ao pagamento.
          - generic [ref=e1251]:
            - img [ref=e1252]
            - textbox "Buscar nas perguntas frequentes" [ref=e1255]:
              - /placeholder: Buscar nas dúvidas…
          - generic [ref=e1256]:
            - paragraph [ref=e1257]: Filtrar por categoria
            - generic [ref=e1258]:
              - button "Filtrar por Geral" [ref=e1259]:
                - img [ref=e1260]
                - text: Geral
                - generic [ref=e1263]: (2)
              - button "Filtrar por Pagamento" [ref=e1264]:
                - img [ref=e1265]
                - text: Pagamento
                - generic [ref=e1267]: (2)
              - button "Filtrar por Agendamento" [ref=e1268]:
                - img [ref=e1269]
                - text: Agendamento
                - generic [ref=e1271]: (2)
              - button "Filtrar por Prestadores" [ref=e1272]:
                - img [ref=e1273]
                - text: Prestadores
                - generic [ref=e1277]: (2)
              - button "Filtrar por Segurança" [ref=e1278]:
                - img [ref=e1279]
                - text: Segurança
                - generic [ref=e1282]: (2)
          - generic [ref=e1283]:
            - paragraph [ref=e1284]: Perguntas mais frequentes
            - list [ref=e1285]:
              - listitem [ref=e1286]:
                - button "Como funciona o Severinno?" [ref=e1287]:
                  - img [ref=e1288]
                  - generic [ref=e1290]: Como funciona o Severinno?
              - listitem [ref=e1291]:
                - button "Preciso pagar para me cadastrar?" [ref=e1292]:
                  - img [ref=e1293]
                  - generic [ref=e1295]: Preciso pagar para me cadastrar?
              - listitem [ref=e1296]:
                - button "Como faço para agendar um serviço?" [ref=e1297]:
                  - img [ref=e1298]
                  - generic [ref=e1300]: Como faço para agendar um serviço?
              - listitem [ref=e1301]:
                - button "E se o serviço não for bem-feito?" [ref=e1302]:
                  - img [ref=e1303]
                  - generic [ref=e1305]: E se o serviço não for bem-feito?
          - generic [ref=e1307]:
            - img [ref=e1309]
            - generic [ref=e1311]:
              - paragraph [ref=e1312]: Ainda tem dúvidas?
              - paragraph [ref=e1313]: Cadastre-se grátis e converse diretamente com prestadores verificados. Sem compromisso.
              - generic [ref=e1314]:
                - button "Cadastrar grátis" [ref=e1315]
                - link "Fale conosco" [ref=e1316] [cursor=pointer]:
                  - /url: "#faq"
                  - img
                  - text: Fale conosco
        - generic [ref=e1317]:
          - generic [ref=e1319]:
            - generic [ref=e1321]:
              - heading "01 Como funciona o Severinno? Geral" [level=3] [ref=e1322]:
                - button "01 Como funciona o Severinno? Geral" [expanded] [ref=e1323]:
                  - generic [ref=e1324]:
                    - generic [ref=e1325]: "01"
                    - generic [ref=e1326]: Como funciona o Severinno?
                    - generic [ref=e1327]:
                      - img
                      - text: Geral
                  - img
              - region "01 Como funciona o Severinno? Geral" [ref=e1328]:
                - generic [ref=e1330]:
                  - paragraph [ref=e1331]: O Severinno conecta você a prestadores de serviço verificados próximos à sua localização. Você busca o serviço, compara avaliações reais de outros clientes, pede orçamento grátis e agenda — tudo pela plataforma. O pagamento só é liberado após você confirmar a conclusão do serviço.
                  - paragraph [ref=e1332]: "Ex: Maria precisava de um eletricista. Buscou na plataforma, comparou 3 profissionais e contratou o mais bem avaliado — tudo em 5 minutos."
            - heading "02 Preciso pagar para me cadastrar? Geral" [level=3] [ref=e1335]:
              - button "02 Preciso pagar para me cadastrar? Geral" [ref=e1336]:
                - generic [ref=e1337]:
                  - generic [ref=e1338]: "02"
                  - generic [ref=e1339]: Preciso pagar para me cadastrar?
                  - generic [ref=e1340]:
                    - img
                    - text: Geral
                - img
            - heading "03 Como os prestadores são verificados? Prestadores" [level=3] [ref=e1343]:
              - button "03 Como os prestadores são verificados? Prestadores" [ref=e1344]:
                - generic [ref=e1345]:
                  - generic [ref=e1346]: "03"
                  - generic [ref=e1347]: Como os prestadores são verificados?
                  - generic [ref=e1348]:
                    - img
                    - text: Prestadores
                - img
            - heading "04 Posso me tornar um prestador no Severinno? Prestadores" [level=3] [ref=e1351]:
              - button "04 Posso me tornar um prestador no Severinno? Prestadores" [ref=e1352]:
                - generic [ref=e1353]:
                  - generic [ref=e1354]: "04"
                  - generic [ref=e1355]: Posso me tornar um prestador no Severinno?
                  - generic [ref=e1356]:
                    - img
                    - text: Prestadores
                - img
            - heading "05 Como faço para agendar um serviço? Agendamento" [level=3] [ref=e1359]:
              - button "05 Como faço para agendar um serviço? Agendamento" [ref=e1360]:
                - generic [ref=e1361]:
                  - generic [ref=e1362]: "05"
                  - generic [ref=e1363]: Como faço para agendar um serviço?
                  - generic [ref=e1364]:
                    - img
                    - text: Agendamento
                - img
            - heading "06 Posso remarcar ou cancelar um agendamento? Agendamento" [level=3] [ref=e1367]:
              - button "06 Posso remarcar ou cancelar um agendamento? Agendamento" [ref=e1368]:
                - generic [ref=e1369]:
                  - generic [ref=e1370]: "06"
                  - generic [ref=e1371]: Posso remarcar ou cancelar um agendamento?
                  - generic [ref=e1372]:
                    - img
                    - text: Agendamento
                - img
            - heading "07 Como funciona o pagamento? Pagamento" [level=3] [ref=e1375]:
              - button "07 Como funciona o pagamento? Pagamento" [ref=e1376]:
                - generic [ref=e1377]:
                  - generic [ref=e1378]: "07"
                  - generic [ref=e1379]: Como funciona o pagamento?
                  - generic [ref=e1380]:
                    - img
                    - text: Pagamento
                - img
            - heading "08 O orçamento tem compromisso? Pagamento" [level=3] [ref=e1383]:
              - button "08 O orçamento tem compromisso? Pagamento" [ref=e1384]:
                - generic [ref=e1385]:
                  - generic [ref=e1386]: "08"
                  - generic [ref=e1387]: O orçamento tem compromisso?
                  - generic [ref=e1388]:
                    - img
                    - text: Pagamento
                - img
            - heading "09 E se o serviço não for bem-feito? Segurança" [level=3] [ref=e1391]:
              - button "09 E se o serviço não for bem-feito? Segurança" [ref=e1392]:
                - generic [ref=e1393]:
                  - generic [ref=e1394]: "09"
                  - generic [ref=e1395]: E se o serviço não for bem-feito?
                  - generic [ref=e1396]:
                    - img
                    - text: Segurança
                - img
            - heading "10 Meus dados pessoais estão seguros? Segurança" [level=3] [ref=e1399]:
              - button "10 Meus dados pessoais estão seguros? Segurança" [ref=e1400]:
                - generic [ref=e1401]:
                  - generic [ref=e1402]: "10"
                  - generic [ref=e1403]: Meus dados pessoais estão seguros?
                  - generic [ref=e1404]:
                    - img
                    - text: Segurança
                - img
          - generic [ref=e1405]:
            - paragraph [ref=e1406]: 10 de 10 dúvidas
            - button "Voltar ao topo da seção" [ref=e1407]:
              - img [ref=e1408]
              - text: Topo
      - generic [ref=e1412]:
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
        - generic [ref=e1417]:
          - generic [ref=e1418]:
            - generic [ref=e1420]:
              - img [ref=e1421]
              - text: Comece agora mesmo
            - heading "Pronto para encontrar o prestador ideal?" [level=2] [ref=e1423]
            - paragraph [ref=e1424]: Comece em 30 segundos — é como pedir um Uber, mas para serviços. Cadastre-se gratuitamente e tenha acesso a prestadores verificados.
            - generic [ref=e1425]:
              - button "Para clientes" [ref=e1426]: Para clientes
              - button "Para prestadores" [ref=e1428]
            - list [ref=e1429]:
              - generic [ref=e1430]:
                - listitem [ref=e1431]:
                  - img [ref=e1432]
                  - text: Cadastro gratuito
                - listitem [ref=e1435]:
                  - img [ref=e1436]
                  - text: Sem taxa de serviço
                - listitem [ref=e1439]:
                  - img [ref=e1440]
                  - text: Orçamento sem compromisso
            - generic [ref=e1443]:
              - button "Cadastrar grátis" [ref=e1448]:
                - text: Cadastrar grátis
                - generic [ref=e1449]:
                  - img
              - button "Sou prestador" [ref=e1451]:
                - img
                - text: Sou prestador
            - generic [ref=e1452]:
              - img [ref=e1453]
              - text: Comece em 30 segundos
            - button "Já tenho conta · Entrar" [ref=e1457]:
              - img [ref=e1458]
              - text: Já tenho conta · Entrar
            - generic [ref=e1461]:
              - generic [ref=e1462]:
                - generic [ref=e1463]: AL
                - generic [ref=e1464]: RM
                - generic [ref=e1465]: JS
                - generic [ref=e1466]: PF
                - generic [ref=e1467]: CM
                - generic [ref=e1468]: "+5"
              - generic [ref=e1469]:
                - paragraph [ref=e1470]: 527+ cadastrados
                - paragraph [ref=e1471]: na plataforma
          - generic [ref=e1472]:
            - generic [ref=e1473]:
              - heading "O que vem depois?" [level=3] [ref=e1474]
              - paragraph [ref=e1475]: Três passos simples e você estará agendando
              - generic [ref=e1476]:
                - img [ref=e1477]
                - generic [ref=e1478]:
                  - generic [ref=e1479]:
                    - generic [ref=e1481]: "1"
                    - generic [ref=e1482]:
                      - paragraph [ref=e1483]: Cadastre-se grátis
                      - paragraph [ref=e1484]: ~30s
                  - generic [ref=e1485]:
                    - generic [ref=e1487]: "2"
                    - generic [ref=e1488]:
                      - paragraph [ref=e1489]: Busque e compare
                      - paragraph [ref=e1490]: ~2 min
                  - generic [ref=e1491]:
                    - generic [ref=e1493]: "3"
                    - generic [ref=e1494]:
                      - paragraph [ref=e1495]: Agende com confiança
                      - paragraph [ref=e1496]: ~5 min
              - generic [ref=e1497]:
                - generic [ref=e1498]:
                  - img [ref=e1499]
                  - text: Sem compromisso
                - generic [ref=e1503]:
                  - img [ref=e1504]
                  - text: Cancele quando quiser
                - generic [ref=e1507]:
                  - img [ref=e1508]
                  - text: Suporte 24h
              - link "Saiba mais sobre pagamento protegido" [ref=e1511] [cursor=pointer]:
                - /url: "#faq"
                - img [ref=e1512]
                - text: Saiba mais sobre pagamento protegido
            - generic [ref=e1516]:
              - generic [ref=e1520]: Cliente
              - generic [ref=e1521]:
                - img [ref=e1525]
                - generic [ref=e1527]: Prestador
              - img [ref=e1532]
              - img [ref=e1534]
              - img [ref=e1538]
              - img [ref=e1541]
              - img [ref=e1545]
        - generic [ref=e1549]:
          - img [ref=e1550]
          - generic [ref=e1553]:
            - paragraph [ref=e1554]: “Encontrei um encanador em 10 minutos, paguei menos do que esperava e ainda pude avaliar o serviço. Recomendo demais!”
            - paragraph [ref=e1555]: — Ana P., Cliente, São Paulo
        - generic [ref=e1556]:
          - generic [ref=e1557]:
            - img [ref=e1558]
            - text: Sem compromisso
          - generic [ref=e1562]:
            - img [ref=e1563]
            - text: Cancele quando quiser
          - generic [ref=e1566]:
            - img [ref=e1567]
            - text: Pagamento protegido
    - contentinfo [ref=e1569]:
      - generic [ref=e1571]:
        - generic [ref=e1572]:
          - paragraph [ref=e1573]: Receba novidades e dicas de serviços
          - paragraph [ref=e1574]: Cadastre-se e receba ofertas exclusivas. Cancele quando quiser.
        - generic [ref=e1575]:
          - generic [ref=e1576]:
            - img [ref=e1577]
            - textbox "E-mail para newsletter" [ref=e1580]:
              - /placeholder: Seu e-mail
          - button "Assinar" [disabled]:
            - img
            - text: Assinar
      - generic [ref=e1581]:
        - generic [ref=e1582]:
          - generic [ref=e1583]:
            - generic [ref=e1584]:
              - img [ref=e1586]
              - generic [ref=e1589]: Severinno
            - paragraph [ref=e1590]: Marketplace de serviços com geolocalização. Encontre prestadores verificados, próximos e bem avaliados.
            - list "Redes sociais" [ref=e1591]:
              - listitem [ref=e1592]:
                - link "GitHub" [ref=e1593] [cursor=pointer]:
                  - /url: https://github.com
                  - img [ref=e1594]
              - listitem [ref=e1597]:
                - link "Twitter" [ref=e1598] [cursor=pointer]:
                  - /url: https://twitter.com
                  - img [ref=e1599]
              - listitem [ref=e1601]:
                - link "Instagram" [ref=e1602] [cursor=pointer]:
                  - /url: https://instagram.com
                  - img [ref=e1603]
              - listitem [ref=e1606]:
                - link "LinkedIn" [ref=e1607] [cursor=pointer]:
                  - /url: https://linkedin.com
                  - img [ref=e1608]
              - listitem [ref=e1612]:
                - link "E-mail" [ref=e1613] [cursor=pointer]:
                  - /url: mailto:contato@severinno.com
                  - img [ref=e1614]
          - navigation "Sobre" [ref=e1617]:
            - heading "Sobre" [level=3] [ref=e1618]:
              - img [ref=e1619]
              - text: Sobre
            - list [ref=e1622]:
              - listitem [ref=e1623]:
                - button "Como funciona" [ref=e1624]
              - listitem [ref=e1625]:
                - button "Quem somos" [ref=e1626]
              - listitem [ref=e1627]:
                - button "Termos de uso" [ref=e1628]
              - listitem [ref=e1629]:
                - button "Privacidade" [ref=e1630]
          - navigation "Para profissionais" [ref=e1631]:
            - heading "Para profissionais" [level=3] [ref=e1632]:
              - img [ref=e1633]
              - text: Para profissionais
            - list [ref=e1636]:
              - listitem [ref=e1637]:
                - button "Cadastre-se" [ref=e1638]
              - listitem [ref=e1639]:
                - button "Meu painel" [ref=e1640]
              - listitem [ref=e1641]:
                - button "Central de ajuda" [ref=e1642]
          - navigation "Precisa de ajuda?" [ref=e1643]:
            - heading "Precisa de ajuda?" [level=3] [ref=e1644]:
              - img [ref=e1645]
              - text: Precisa de ajuda?
            - list [ref=e1647]:
              - listitem [ref=e1648]:
                - button "Perguntas frequentes" [ref=e1649]
              - listitem [ref=e1650]:
                - button "Segurança" [ref=e1651]
              - listitem [ref=e1652]:
                - button "Reportar problema" [ref=e1653]
          - generic [ref=e1654]:
            - heading "Contato" [level=3] [ref=e1655]:
              - img [ref=e1656]
              - text: Contato
            - list [ref=e1661]:
              - listitem [ref=e1662]:
                - img [ref=e1663]
                - link "contato@severinno.com" [ref=e1666] [cursor=pointer]:
                  - /url: mailto:contato@severinno.com
              - listitem [ref=e1667]:
                - img [ref=e1668]
                - text: São Paulo, Brasil
            - button "Fale conosco" [ref=e1671]:
              - img
              - text: Fale conosco
        - generic [ref=e1672]:
          - paragraph [ref=e1673]: © 2026 Severinno Marketplace. Todos os direitos reservados.
          - paragraph [ref=e1674]:
            - text: Feito com
            - img [ref=e1675]
            - text: usando tecnologia Open Source (
            - link "MapLibre" [ref=e1677] [cursor=pointer]:
              - /url: https://maplibre.org/
            - text: ·
            - link "OpenStreetMap" [ref=e1678] [cursor=pointer]:
              - /url: https://www.openstreetmap.org/copyright
            - text: )
      - button "Voltar ao topo" [ref=e1679]:
        - img [ref=e1680]
    - button "Voltar ao topo" [ref=e1683]:
      - img
    - button "Abrir assistente virtual" [ref=e1684]:
      - img [ref=e1685]
    - generic [ref=e1689]:
      - generic [ref=e1690]:
        - img [ref=e1692]
        - generic [ref=e1694]:
          - paragraph [ref=e1695]: Usamos cookies para melhorar sua experiência
          - paragraph [ref=e1696]:
            - text: Utilizamos cookies essenciais para o funcionamento do site e cookies de análise para melhorar nossos serviços.
            - button "Política de privacidade" [ref=e1697]
      - generic [ref=e1698]:
        - button "Recusar" [ref=e1699]
        - button "Aceitar" [ref=e1700]:
          - img
          - text: Aceitar
        - button "Dispensar" [ref=e1701]:
          - img [ref=e1702]
  - region "Notifications alt+T"
  - generic [active]:
    - generic [ref=e1707]:
      - generic [ref=e1708]:
        - generic [ref=e1709]:
          - navigation [ref=e1710]:
            - button "previous" [disabled] [ref=e1711]:
              - img "previous" [ref=e1712]
            - generic [ref=e1714]:
              - generic [ref=e1715]: 1/
              - text: "1"
            - button "next" [disabled] [ref=e1716]:
              - img "next" [ref=e1717]
          - img
        - generic [ref=e1719]:
          - link "Next.js 16.1.3 (stale) Turbopack" [ref=e1720] [cursor=pointer]:
            - /url: https://nextjs.org/docs/messages/version-staleness
            - img [ref=e1721]
            - generic "There is a newer version (16.2.11) available, upgrade recommended!" [ref=e1723]: Next.js 16.1.3 (stale)
            - generic [ref=e1724]: Turbopack
          - img
      - dialog "Build Error" [ref=e1726]:
        - generic [ref=e1729]:
          - generic [ref=e1730]:
            - generic [ref=e1731]:
              - generic [ref=e1733]: Build Error
              - generic [ref=e1734]:
                - button "Copy Error Info" [ref=e1735] [cursor=pointer]:
                  - img [ref=e1736]
                - button "No related documentation found" [disabled] [ref=e1738]:
                  - img [ref=e1739]
                - button "Attach Node.js inspector" [ref=e1741] [cursor=pointer]:
                  - img [ref=e1742]
            - generic [ref=e1751]: Reading source code for parsing failed
          - generic [ref=e1753]:
            - generic [ref=e1755]:
              - img [ref=e1757]
              - generic [ref=e1761]: ./.freebuff/worktrees/thmrzp9vv9y86o/src/lib/api-server.ts
              - button "Open in editor" [ref=e1762] [cursor=pointer]:
                - img [ref=e1764]
            - generic [ref=e1768]: "Reading source code for parsing failed An unexpected error happened while trying to read the source code to parse: failed to convert rope into string Caused by: - invalid utf-8 sequence of 1 bytes from index 5415 Import trace: App Route: ./.freebuff/worktrees/thmrzp9vv9y86o/src/lib/api-server.ts ./.freebuff/worktrees/thmrzp9vv9y86o/src/app/api/auth/me/route.ts"
        - generic [ref=e1769]: "1"
        - generic [ref=e1770]: "2"
    - generic [ref=e1775] [cursor=pointer]:
      - button "Open Next.js Dev Tools" [ref=e1776]:
        - img [ref=e1777]
      - button "Open issues overlay" [ref=e1781]:
        - generic [ref=e1782]:
          - generic [ref=e1783]: "0"
          - generic [ref=e1784]: "1"
        - generic [ref=e1785]: Issue
  - alert [ref=e1786]
```

# Test source

```ts
  1   | import { test, expect, type Page } from "@playwright/test"
  2   | import { waitForVitrine, registerUser } from "./helpers"
  3   | import { setupApiMocks } from "./mocks"
  4   | 
  5   | // =========================================================================
  6   | // Helpers específicas da Quote
  7   | // =========================================================================
  8   | 
  9   | /**
  10  |  * Abre o QuoteModal clicando no botão "Pedir orçamento" ou similar.
  11  |  */
  12  | async function openQuoteModal(page: Page) {
  13  |   const orcamentoBtn = page.locator(
  14  |     'button:has-text(/orçamento|orçar|Pedir orçamento/i)',
  15  |   ).first()
  16  |   const visible = await orcamentoBtn.isVisible({ timeout: 10000 }).catch(() => false)
  17  |   if (visible) {
  18  |     await orcamentoBtn.click()
  19  |   } else {
  20  |     // Fallback: clica no primeiro card da vitrine
  21  |     const card = page.locator('[class*="Card"], [class*="card"]').first()
  22  |     if (await card.isVisible().catch(() => false)) {
> 23  |       await card.click()
      |                  ^ Error: locator.click: Test timeout of 30000ms exceeded.
  24  |     }
  25  |   }
  26  |   await page.waitForTimeout(1000)
  27  | 
  28  |   // Verifica se o modal de orçamento abriu
  29  |   const modal = page.locator('text=/Pedir orçamento|orçamento/i').first()
  30  |   await modal.waitFor({ state: "visible", timeout: 5000 }).catch(() => {})
  31  | }
  32  | 
  33  | /**
  34  |  * Navega para uma etapa específica do wizard de orçamento.
  35  |  * Clica "Continuar" múltiplas vezes até chegar na etapa desejada.
  36  |  */
  37  | async function navigateQuoteStep(page: Page, targetStep: number) {
  38  |   for (let i = 1; i < targetStep; i++) {
  39  |     const continuar = page.locator('button:has-text("Continuar")')
  40  |     if (await continuar.isVisible().catch(() => false)) {
  41  |       await continuar.click()
  42  |       await page.waitForTimeout(500)
  43  |     } else {
  44  |       return false
  45  |     }
  46  |   }
  47  |   return true
  48  | }
  49  | 
  50  | /**
  51  |  * No Step 1 (Prestador): abre o combobox e seleciona o primeiro prestador.
  52  |  */
  53  | async function selectProvider(page: Page) {
  54  |   // Abre o combobox de prestadores
  55  |   const comboboxTrigger = page.locator(
  56  |     'button[role="combobox"]:has-text(/Selecionar prestador/i)',
  57  |   ).first()
  58  |   if (await comboboxTrigger.isVisible().catch(() => false)) {
  59  |     await comboboxTrigger.click()
  60  |     await page.waitForTimeout(500)
  61  | 
  62  |     // Seleciona o primeiro item da lista
  63  |     const providerItem = page.locator('[role="option"], [role="menuitem"]').first()
  64  |     if (await providerItem.isVisible().catch(() => false)) {
  65  |       await providerItem.click()
  66  |       await page.waitForTimeout(300)
  67  |       return true
  68  |     }
  69  |   }
  70  |   return false
  71  | }
  72  | 
  73  | /**
  74  |  * No Step 2 (Serviço): seleciona o primeiro serviço disponível.
  75  |  */
  76  | async function selectService(page: Page) {
  77  |   // Espera os serviços carregarem e seleciona o primeiro
  78  |   // O shadcn SelectTrigger renderiza o placeholder dentro de <span> no botão
  79  |   const serviceSelect = page.locator(
  80  |     '[role="combobox"]:has-text(/Selecionar serviço/i)',
  81  |   ).first()
  82  |   if (await serviceSelect.isVisible().catch(() => false)) {
  83  |     await serviceSelect.click()
  84  |     await page.waitForTimeout(500)
  85  | 
  86  |     const serviceItem = page.locator('[role="option"]').first()
  87  |     if (await serviceItem.isVisible().catch(() => false)) {
  88  |       await serviceItem.click()
  89  |       await page.waitForTimeout(300)
  90  |       return true
  91  |     }
  92  |   }
  93  |   return false
  94  | }
  95  | 
  96  | /**
  97  |  * No Step 3 (Detalhes): preenche descrição e quantidade.
  98  |  */
  99  | async function fillDetails(page: Page) {
  100 |   const descInput = page.locator("#item-0-desc, textarea[placeholder*=\"Instalar\"]").first()
  101 |   if (await descInput.isVisible().catch(() => false)) {
  102 |     await descInput.fill("Preciso instalar 3 tomadas novas na sala. A fiação já está embutida, só preciso dos pontos.")
  103 |     await page.waitForTimeout(300)
  104 |   }
  105 | 
  106 |   const qtyInput = page.locator("#item-0-qty, input[type=\"number\"]").first()
  107 |   if (await qtyInput.isVisible().catch(() => false)) {
  108 |     await qtyInput.fill("3")
  109 |     await page.waitForTimeout(300)
  110 |   }
  111 | }
  112 | 
  113 | /**
  114 |  * No Step 4 (Endereço): preenche CEP para auto-preenchimento.
  115 |  */
  116 | async function fillQuoteAddress(page: Page) {
  117 |   const cepInput = page.getByPlaceholder(/CEP/i).first()
  118 |   if (await cepInput.isVisible().catch(() => false)) {
  119 |     await cepInput.fill("01310100")
  120 |     await page.waitForTimeout(1500)
  121 | 
  122 |     // Verifica se a rua foi preenchida automaticamente
  123 |     const streetInput = page.getByPlaceholder(/Rua|avenida/i).first()
```