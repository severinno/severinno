# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: quote-flow.spec.ts >> QuoteModal — Casos de Erro e Validação >> 11. tentar avançar sem selecionar prestador mostra validação
- Location: e2e\quote-flow.spec.ts:400:7

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
    15 × waiting for element to be visible, enabled and stable
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
    - waiting for element to be visible, enabled and stable
    - element is not stable
  - retrying click action
    - waiting 100ms
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
        - paragraph [ref=e11]: 120 prestadores disponíveis na sua região
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
          - button "Notificações" [ref=e44]:
            - img
          - button "Favoritos" [ref=e45]:
            - img
          - button "Menu da conta" [ref=e46]:
            - generic [ref=e49]: TU
            - generic [ref=e51]: Test
            - img [ref=e52]
    - main [ref=e54]:
      - generic [ref=e61]:
        - generic [ref=e62]:
          - generic [ref=e64]:
            - img [ref=e65]
            - text: Marketplace de serviços verificados
          - heading "Prestadores de serviço verificados, perto de você." [level=1] [ref=e68]
          - paragraph [ref=e69]: Compare avaliações reais, peça orçamento grátis e agende — encanador, eletricista, pintor e mais. Você escolhe o profissional.
          - generic [ref=e71]:
            - generic [ref=e72]:
              - img [ref=e73]
              - textbox "Serviço buscado" [ref=e76]:
                - /placeholder: "O que você precisa? Ex.: encanador, pintura…"
            - generic [ref=e77]:
              - img [ref=e78]
              - textbox "Localização" [ref=e81]:
                - /placeholder: CEP ou cidade
            - button "Buscar" [ref=e82]:
              - img
              - text: Buscar
          - generic [ref=e83]:
            - generic [ref=e84]: "Mais buscados:"
            - button "Encanador" [ref=e85]:
              - generic [ref=e86]: 🔧
              - text: Encanador
            - button "Eletricista" [ref=e87]:
              - generic [ref=e88]: 💡
              - text: Eletricista
            - button "Pintor" [ref=e89]:
              - generic [ref=e90]: 🎨
              - text: Pintor
            - button "Diarista" [ref=e91]:
              - generic [ref=e92]: 🧹
              - text: Diarista
            - button "Pedreiro" [ref=e93]:
              - generic [ref=e94]: 🧱
              - text: Pedreiro
            - button "Jardineiro" [ref=e95]:
              - generic [ref=e96]: 🌿
              - text: Jardineiro
          - button "Usar minha localização" [ref=e97]:
            - img [ref=e98]
            - text: Usar minha localização
          - generic [ref=e101]:
            - button "Cadastrar grátis" [ref=e102]:
              - text: Cadastrar grátis
              - img
            - button "Ver como funciona" [ref=e103]
          - paragraph [ref=e104]: Cadastro grátis · Orçamento sem compromisso · Você escolhe o profissional
          - list [ref=e105]:
            - listitem "Documentos validados e identidade confirmada" [ref=e106]:
              - img [ref=e108]
              - generic [ref=e111]: Prestadores verificados
            - listitem "Avaliações de clientes após a conclusão do serviço" [ref=e112]:
              - img [ref=e114]
              - generic [ref=e116]: Avaliações reais
            - listitem "Pagamento só é liberado após você marcar como concluído" [ref=e117]:
              - img [ref=e119]
              - generic [ref=e122]: Pagamento seguro
        - generic [ref=e125]:
          - generic [ref=e131]: Atividade ao vivo
          - generic [ref=e133]:
            - img [ref=e134]
            - paragraph [ref=e136]: Carregando atividades…
      - region "Atividade recente na plataforma" [ref=e138]:
        - generic [ref=e139]:
          - generic [ref=e141]: Atividade recente
          - generic [ref=e145]:
            - generic [ref=e147]:
              - generic [ref=e148]:
                - generic [ref=e149]: ⚡
                - text: Maria contratou um eletricista em São Paulo
              - generic [ref=e151]:
                - generic [ref=e152]: ⭐
                - text: João avaliou ★★★★★ o prestador Ricardo
              - generic [ref=e154]:
                - generic [ref=e155]: 🎨
                - text: "Nova avaliação: 4.9 para Serviços de Pintura"
              - generic [ref=e157]:
                - generic [ref=e158]: 🔧
                - text: Ana pediu orçamento para encanador
              - generic [ref=e160]:
                - generic [ref=e161]: ✅
                - text: Pedro se cadastrou como prestador verificado
              - generic [ref=e163]:
                - generic [ref=e164]: 📋
                - text: 12 orçamentos enviados hoje
              - generic [ref=e166]:
                - generic [ref=e167]: ⚡
                - text: Maria contratou um eletricista em São Paulo
              - generic [ref=e169]:
                - generic [ref=e170]: ⭐
                - text: João avaliou ★★★★★ o prestador Ricardo
              - generic [ref=e172]:
                - generic [ref=e173]: 🎨
                - text: "Nova avaliação: 4.9 para Serviços de Pintura"
              - generic [ref=e175]:
                - generic [ref=e176]: 🔧
                - text: Ana pediu orçamento para encanador
              - generic [ref=e178]:
                - generic [ref=e179]: ✅
                - text: Pedro se cadastrou como prestador verificado
              - generic [ref=e181]:
                - generic [ref=e182]: 📋
                - text: 12 orçamentos enviados hoje
            - generic [ref=e186]:
              - generic [ref=e187]:
                - generic [ref=e188]: 🧹
                - text: Carlos agendou limpeza de quintal em Belo Horizonte
              - generic [ref=e190]:
                - generic [ref=e191]: ⭐
                - text: Fernanda avaliou ★★★★★ o prestador José
              - generic [ref=e193]:
                - generic [ref=e194]: 🛡️
                - text: 8 novos prestadores verificados esta semana
              - generic [ref=e196]:
                - generic [ref=e197]: 🎨
                - text: Luciana contratou um pintor no Rio de Janeiro
              - generic [ref=e199]:
                - generic [ref=e200]: 🚿
                - text: "Orçamento aceito: reforma de banheiro em Curitiba"
              - generic [ref=e202]:
                - generic [ref=e203]: 🏆
                - text: 5.200 serviços concluídos este mês
              - generic [ref=e205]:
                - generic [ref=e206]: 🧹
                - text: Carlos agendou limpeza de quintal em Belo Horizonte
              - generic [ref=e208]:
                - generic [ref=e209]: ⭐
                - text: Fernanda avaliou ★★★★★ o prestador José
              - generic [ref=e211]:
                - generic [ref=e212]: 🛡️
                - text: 8 novos prestadores verificados esta semana
              - generic [ref=e214]:
                - generic [ref=e215]: 🎨
                - text: Luciana contratou um pintor no Rio de Janeiro
              - generic [ref=e217]:
                - generic [ref=e218]: 🚿
                - text: "Orçamento aceito: reforma de banheiro em Curitiba"
              - generic [ref=e220]:
                - generic [ref=e221]: 🏆
                - text: 5.200 serviços concluídos este mês
      - region "Categorias de serviços" [ref=e223]:
        - generic [ref=e224]:
          - generic:
            - img
          - generic [ref=e226]:
            - generic [ref=e227]:
              - img [ref=e228]
              - text: Explore categorias
            - heading "Encontre o serviço ideal" [level=2] [ref=e231]
            - paragraph [ref=e232]: Serviços verificados perto de você — … carregando categorias
          - generic "Carregando categorias" [ref=e233]
      - region "Resultados da busca" [ref=e274]:
        - generic [ref=e275]:
          - complementary [ref=e276]:
            - generic [ref=e278]:
              - generic [ref=e279]:
                - heading "Filtros" [level=2] [ref=e280]:
                  - img [ref=e281]
                  - text: Filtros
                - button "Limpar filtros" [ref=e282]
              - generic [ref=e283]:
                - generic [ref=e284]: Buscar
                - generic [ref=e285]:
                  - img [ref=e286]
                  - textbox "Buscar" [ref=e289]:
                    - /placeholder: Serviço, prestador…
              - generic [ref=e290]:
                - generic [ref=e291]:
                  - generic [ref=e292]: Raio de busca
                  - generic [ref=e293]: 15 km
                - generic "Raio de busca em quilômetros" [ref=e294]:
                  - slider [ref=e298]
                - generic [ref=e299]:
                  - generic [ref=e300]: 1 km
                  - generic [ref=e301]: 50 km
              - generic [ref=e302]:
                - generic [ref=e303]: Categoria
                - combobox [ref=e304]:
                  - generic: Todas as categorias
                  - img
              - generic [ref=e305]:
                - generic [ref=e306]: Ordenar por
                - radiogroup "Ordenar por" [ref=e307]:
                  - radio "Melhor avaliação" [checked] [ref=e308]
                  - radio "Mais próximos" [ref=e309]
              - generic [ref=e310]:
                - generic [ref=e311]: Avaliação mínima
                - radiogroup [ref=e312]:
                  - generic [ref=e313] [cursor=pointer]:
                    - radio "Todas" [checked] [ref=e314]:
                      - img [ref=e315]
                    - generic [ref=e317]: Todas
                  - generic [ref=e318] [cursor=pointer]:
                    - radio "3+" [ref=e319]
                    - generic [ref=e320]: 3+
                  - generic [ref=e321] [cursor=pointer]:
                    - radio "4+" [ref=e322]
                    - generic [ref=e323]: 4+
                  - generic [ref=e324] [cursor=pointer]:
                    - radio "5" [ref=e325]
                    - generic [ref=e326]: "5"
              - generic [ref=e327] [cursor=pointer]:
                - generic [ref=e328]:
                  - img [ref=e329]
                  - generic [ref=e331]: Somente verificados
                - switch "Somente verificados" [ref=e332]
              - button "Ver 3 resultados" [disabled]
          - generic [ref=e333]:
            - generic [ref=e335]:
              - generic [ref=e336]:
                - heading "3 prestadores encontrados" [level=2] [ref=e337]
                - paragraph [ref=e338]: Exibindo 1–3 de 3
              - generic [ref=e339]:
                - generic [ref=e340]:
                  - text: "Ordenado por:"
                  - generic [ref=e341]: Melhor avaliação
                - tablist "Visualização" [ref=e342]:
                  - tab "Lista" [selected] [ref=e343]:
                    - img [ref=e344]
                    - generic [ref=e345]: Lista
                  - tab "Mapa" [ref=e346]:
                    - img [ref=e347]
                    - generic [ref=e349]: Mapa
            - generic [ref=e351]:
              - generic [ref=e353]:
                - generic [ref=e354]:
                  - img "Capa de Maria Silva" [ref=e355]
                  - generic [ref=e357]:
                    - img [ref=e358]
                    - text: Verificado
                  - generic [ref=e361]:
                    - button "Adicionar Maria Silva à comparação" [ref=e362]:
                      - img [ref=e363]
                    - button "Adicionar Maria Silva aos favoritos" [ref=e368]:
                      - img [ref=e369]
                  - img "Maria Silva" [ref=e373]
                - generic [ref=e374]:
                  - generic [ref=e375]:
                    - button "Ver perfil de Maria Silva" [ref=e376]:
                      - heading "Maria Silva" [level=3] [ref=e377]:
                        - generic [ref=e378]: Maria Silva
                        - img [ref=e379]
                    - generic "Avaliação média" [ref=e381]:
                      - img [ref=e382]
                      - text: "4.8"
                      - generic [ref=e384]: (42)
                  - paragraph [ref=e385]: a partir de R$ 120,00
                  - generic [ref=e386]:
                    - generic [ref=e387]:
                      - img [ref=e388]
                      - text: 2,5 km
                    - generic [ref=e391]:
                      - img [ref=e392]
                      - text: São Paulo
                  - paragraph [ref=e395]: Especialista em instalações elétricas residenciais com mais de 10 anos de experiência.
                  - generic [ref=e396]:
                    - generic "Serviços concluídos com sucesso" [ref=e397]:
                      - img [ref=e398]
                      - text: 230 serviços concluídos
                    - generic "Na plataforma desde" [ref=e401]:
                      - img [ref=e402]
                      - text: desde jan. de 2023
                - generic [ref=e406]:
                  - generic [ref=e407]:
                    - img [ref=e408]
                    - generic [ref=e410]: Instalação Elétrica · a partir de R$ 120,00
                  - heading "Elétrica 1 serviço" [level=3] [ref=e413]:
                    - button "Elétrica 1 serviço" [ref=e414]:
                      - generic [ref=e416]:
                        - paragraph [ref=e417]: Elétrica
                        - paragraph [ref=e418]: 1 serviço
                      - img
                - generic [ref=e419]:
                  - button "Orçamento" [ref=e420]:
                    - img
                    - text: Orçamento
                  - button "Agendar" [ref=e421]:
                    - img
                    - text: Agendar
              - generic [ref=e423]:
                - generic [ref=e424]:
                  - img "Capa de João Pedreiro" [ref=e425]
                  - generic [ref=e427]:
                    - img [ref=e428]
                    - text: Verificado
                  - generic [ref=e431]:
                    - button "Adicionar João Pedreiro à comparação" [ref=e432]:
                      - img [ref=e433]
                    - button "Adicionar João Pedreiro aos favoritos" [ref=e438]:
                      - img [ref=e439]
                  - img "João Pedreiro" [ref=e443]
                - generic [ref=e444]:
                  - generic [ref=e445]:
                    - button "Ver perfil de João Pedreiro" [ref=e446]:
                      - heading "João Pedreiro" [level=3] [ref=e447]:
                        - generic [ref=e448]: João Pedreiro
                        - img [ref=e449]
                    - generic "Avaliação média" [ref=e451]:
                      - img [ref=e452]
                      - text: "4.8"
                      - generic [ref=e454]: (42)
                  - paragraph [ref=e455]: a partir de R$ 120,00
                  - generic [ref=e456]:
                    - generic [ref=e457]:
                      - img [ref=e458]
                      - text: 2,5 km
                    - generic [ref=e461]:
                      - img [ref=e462]
                      - text: São Paulo
                  - paragraph [ref=e465]: Especialista em instalações elétricas residenciais com mais de 10 anos de experiência.
                  - generic [ref=e466]:
                    - generic "Serviços concluídos com sucesso" [ref=e467]:
                      - img [ref=e468]
                      - text: 230 serviços concluídos
                    - generic "Na plataforma desde" [ref=e471]:
                      - img [ref=e472]
                      - text: desde jan. de 2023
                - generic [ref=e476]:
                  - generic [ref=e477]:
                    - img [ref=e478]
                    - generic [ref=e480]: Instalação Elétrica · a partir de R$ 120,00
                  - heading "Construção 1 serviço" [level=3] [ref=e483]:
                    - button "Construção 1 serviço" [ref=e484]:
                      - generic [ref=e486]:
                        - paragraph [ref=e487]: Construção
                        - paragraph [ref=e488]: 1 serviço
                      - img
                - generic [ref=e489]:
                  - button "Orçamento" [ref=e490]:
                    - img
                    - text: Orçamento
                  - button "Agendar" [ref=e491]:
                    - img
                    - text: Agendar
              - generic [ref=e493]:
                - generic [ref=e494]:
                  - img "Capa de Ana Pintora" [ref=e495]
                  - generic [ref=e497]:
                    - img [ref=e498]
                    - text: Verificado
                  - generic [ref=e501]:
                    - button "Adicionar Ana Pintora à comparação" [ref=e502]:
                      - img [ref=e503]
                    - button "Adicionar Ana Pintora aos favoritos" [ref=e508]:
                      - img [ref=e509]
                  - img "Ana Pintora" [ref=e513]
                - generic [ref=e514]:
                  - generic [ref=e515]:
                    - button "Ver perfil de Ana Pintora" [ref=e516]:
                      - heading "Ana Pintora" [level=3] [ref=e517]:
                        - generic [ref=e518]: Ana Pintora
                        - img [ref=e519]
                    - generic "Avaliação média" [ref=e521]:
                      - img [ref=e522]
                      - text: "4.8"
                      - generic [ref=e524]: (42)
                  - paragraph [ref=e525]: a partir de R$ 120,00
                  - generic [ref=e526]:
                    - generic [ref=e527]:
                      - img [ref=e528]
                      - text: 2,5 km
                    - generic [ref=e531]:
                      - img [ref=e532]
                      - text: São Paulo
                  - paragraph [ref=e535]: Especialista em instalações elétricas residenciais com mais de 10 anos de experiência.
                  - generic [ref=e536]:
                    - generic "Serviços concluídos com sucesso" [ref=e537]:
                      - img [ref=e538]
                      - text: 230 serviços concluídos
                    - generic "Na plataforma desde" [ref=e541]:
                      - img [ref=e542]
                      - text: desde jan. de 2023
                - generic [ref=e546]:
                  - generic [ref=e547]:
                    - img [ref=e548]
                    - generic [ref=e550]: Instalação Elétrica · a partir de R$ 120,00
                  - heading "Pintura 1 serviço" [level=3] [ref=e553]:
                    - button "Pintura 1 serviço" [ref=e554]:
                      - generic [ref=e556]:
                        - paragraph [ref=e557]: Pintura
                        - paragraph [ref=e558]: 1 serviço
                      - img
                - generic [ref=e559]:
                  - button "Orçamento" [ref=e560]:
                    - img
                    - text: Orçamento
                  - button "Agendar" [ref=e561]:
                    - img
                    - text: Agendar
      - region "Como funciona" [ref=e562]:
        - generic [ref=e567]:
          - generic [ref=e568]:
            - link "Pular para resultados" [ref=e569] [cursor=pointer]:
              - /url: "#vitrine-resultados"
              - img [ref=e570]
              - text: Pular para resultados
            - generic [ref=e574]:
              - img [ref=e575]
              - generic [ref=e577]: "4"
              - text: passos simples
            - heading "Como funciona" [level=2] [ref=e578]
            - paragraph [ref=e579]: Sem surpresas — do início ao fim, você tem o controle.
            - generic [ref=e580]:
              - img [ref=e581]
              - text: Sem compromisso
          - generic [ref=e587]:
            - img [ref=e589]
            - generic [ref=e590]:
              - 'button "1 Busque o serviço Encontre prestadores verificados perto de você. 50 + categorias encanador em São Paulo | Verificados < 5 km Mais filtros Ex: Busque ''encanador em São Paulo'' Buscar prestadores" [ref=e591] [cursor=pointer]':
                - generic [ref=e593]:
                  - generic [ref=e595]: "1"
                  - generic [ref=e596]:
                    - img [ref=e598]
                    - img [ref=e602]
                  - heading "Busque o serviço" [level=3] [ref=e605]
                  - paragraph [ref=e606]: Encontre prestadores verificados perto de você.
                  - generic [ref=e608]:
                    - generic [ref=e609]: "50"
                    - text: +
                    - generic [ref=e610]: categorias
                  - generic [ref=e612]:
                    - generic [ref=e613]:
                      - img [ref=e614]
                      - generic [ref=e617]: encanador em São Paulo
                      - generic [ref=e618]: "|"
                    - generic [ref=e619]:
                      - generic [ref=e620]: Verificados
                      - generic [ref=e621]: < 5 km
                      - generic [ref=e622]:
                        - img [ref=e623]
                        - text: Mais filtros
                  - paragraph [ref=e625]: "Ex: Busque 'encanador em São Paulo'"
                  - button "Buscar prestadores" [ref=e626]:
                    - text: Buscar prestadores
                    - img
              - 'button "2 Compare orçamentos Receba e compare propostas lado a lado. 3 orçamentos em 24h João S. R$ 180 Maria L. R$ 150 Melhor avaliação Compare lado a lado Ex: Compare 3 orçamentos em 24h Sem compromisso Pedir orçamento" [ref=e627] [cursor=pointer]':
                - generic [ref=e629]:
                  - generic [ref=e631]: "2"
                  - generic [ref=e632]:
                    - img [ref=e634]
                    - img [ref=e640]
                  - heading "Compare orçamentos" [level=3] [ref=e643]
                  - paragraph [ref=e644]: Receba e compare propostas lado a lado.
                  - generic [ref=e646]:
                    - generic [ref=e647]: "3"
                    - generic [ref=e648]: orçamentos em 24h
                  - generic [ref=e650]:
                    - generic [ref=e651]:
                      - generic [ref=e652]:
                        - generic [ref=e655]: João S.
                        - generic [ref=e656]:
                          - img [ref=e657]
                          - img [ref=e659]
                          - img [ref=e661]
                          - img [ref=e663]
                          - img [ref=e665]
                        - generic [ref=e667]: R$ 180
                      - generic [ref=e668]:
                        - generic [ref=e671]: Maria L.
                        - generic [ref=e672]:
                          - img [ref=e673]
                          - img [ref=e675]
                          - img [ref=e677]
                          - img [ref=e679]
                          - img [ref=e681]
                        - generic [ref=e683]: R$ 150
                        - generic [ref=e684]: Melhor avaliação
                    - generic [ref=e685]:
                      - img [ref=e686]
                      - text: Compare lado a lado
                  - paragraph [ref=e691]: "Ex: Compare 3 orçamentos em 24h"
                  - generic [ref=e692]:
                    - img [ref=e693]
                    - text: Sem compromisso
                  - button "Pedir orçamento" [ref=e698]:
                    - text: Pedir orçamento
                    - img
              - 'button "3 Agende com confiança Solicite um orçamento ou agende diretamente. 24 h para confirmar Março 2025 S T Q Q S S D 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 12 Mar, 14:00 — Confirmado Ex: Agende para amanhã às 14h Agendar agora" [ref=e699] [cursor=pointer]':
                - generic [ref=e701]:
                  - generic [ref=e703]: "3"
                  - generic [ref=e704]:
                    - img [ref=e706]
                    - img [ref=e710]
                  - heading "Agende com confiança" [level=3] [ref=e713]
                  - paragraph [ref=e714]: Solicite um orçamento ou agende diretamente.
                  - generic [ref=e716]:
                    - generic [ref=e717]: "24"
                    - text: h
                    - generic [ref=e718]: para confirmar
                  - generic [ref=e721]:
                    - generic [ref=e722]: Março 2025
                    - generic [ref=e723]:
                      - generic [ref=e724]: S
                      - generic [ref=e725]: T
                      - generic [ref=e726]: Q
                      - generic [ref=e727]: Q
                      - generic [ref=e728]: S
                      - generic [ref=e729]: S
                      - generic [ref=e730]: D
                      - generic [ref=e731]: "1"
                      - generic [ref=e732]: "2"
                      - generic [ref=e733]: "3"
                      - generic [ref=e734]: "4"
                      - generic [ref=e735]: "5"
                      - generic [ref=e736]: "6"
                      - generic [ref=e737]: "7"
                      - generic [ref=e738]: "8"
                      - generic [ref=e739]: "9"
                      - generic [ref=e740]: "10"
                      - generic [ref=e741]: "11"
                      - generic [ref=e742]: "12"
                      - generic [ref=e743]: "13"
                      - generic [ref=e744]: "14"
                      - generic [ref=e745]: "15"
                    - generic [ref=e746]:
                      - img [ref=e747]
                      - generic [ref=e750]: 12 Mar, 14:00 — Confirmado
                  - paragraph [ref=e751]: "Ex: Agende para amanhã às 14h"
                  - button "Agendar agora" [ref=e752]:
                    - text: Agendar agora
                    - img
              - 'button "4 Avalie o resultado Sua opinião mantém a qualidade da comunidade. 98 % satisfação 4.0 \"Excelente trabalho, recomendo!\" Avaliação verificada Ex: Avalie de 1 a 5 estrelas com comentário Cadastrar grátis" [ref=e753] [cursor=pointer]':
                - generic [ref=e755]:
                  - generic [ref=e757]: "4"
                  - generic [ref=e758]:
                    - img [ref=e760]
                    - img [ref=e763]
                  - heading "Avalie o resultado" [level=3] [ref=e766]
                  - paragraph [ref=e767]: Sua opinião mantém a qualidade da comunidade.
                  - generic [ref=e769]:
                    - generic [ref=e770]: "98"
                    - text: "%"
                    - generic [ref=e771]: satisfação
                  - generic [ref=e773]:
                    - generic [ref=e774]:
                      - generic [ref=e775]:
                        - img [ref=e776]
                        - img [ref=e778]
                        - img [ref=e780]
                        - img [ref=e782]
                        - img [ref=e784]
                        - generic [ref=e786]: "4.0"
                      - paragraph [ref=e789]: "\"Excelente trabalho, recomendo!\""
                    - generic [ref=e790]:
                      - img [ref=e791]
                      - text: Avaliação verificada
                  - paragraph [ref=e794]: "Ex: Avalie de 1 a 5 estrelas com comentário"
                  - button "Cadastrar grátis" [ref=e795]:
                    - text: Cadastrar grátis
                    - img
          - generic [ref=e796]:
            - generic [ref=e797]:
              - img [ref=e798]
              - generic [ref=e801]: Garantia Severinno
            - generic [ref=e802]:
              - generic [ref=e803]:
                - img [ref=e804]
                - generic [ref=e807]: Prestadores verificados
              - generic [ref=e808]:
                - img [ref=e809]
                - generic [ref=e812]: Resposta rápida
              - generic [ref=e813]:
                - img [ref=e814]
                - generic [ref=e816]: Satisfação garantida
              - generic [ref=e817]:
                - img [ref=e818]
                - generic [ref=e823]: Compare antes de contratar
          - generic [ref=e824]:
            - button "Começar agora" [ref=e825]:
              - text: Começar agora
              - img
            - link "Buscar prestadores" [ref=e826] [cursor=pointer]:
              - /url: "#vitrine-resultados"
              - img
              - text: Buscar prestadores
          - button "Voltar ao topo" [ref=e828]:
            - img [ref=e829]
            - text: Voltar ao topo
      - generic [ref=e832]:
        - generic [ref=e833]:
          - generic [ref=e834]:
            - img
            - text: Simulador de preços
          - heading "Quanto custa? Simule agora" [level=2] [ref=e835]
          - paragraph [ref=e836]: Estime o valor do serviço em 3 passos rápidos. Sem compromisso, sem cadastro.
        - generic [ref=e837]:
          - generic [ref=e838]: "1"
          - generic [ref=e840]: "2"
          - generic [ref=e842]: "3"
        - generic [ref=e845]:
          - heading "1. Qual serviço você precisa?" [level=3] [ref=e846]
          - paragraph [ref=e847]: Selecione a categoria do serviço
          - generic [ref=e848]:
            - button "Elétrica" [ref=e849]:
              - img [ref=e851]
              - generic [ref=e853]: Elétrica
            - button "Hidráulica" [ref=e854]:
              - img [ref=e856]
              - generic [ref=e859]: Hidráulica
            - button "Pintura" [ref=e860]:
              - img [ref=e862]
              - generic [ref=e866]: Pintura
            - button "Alvenaria" [ref=e867]:
              - img [ref=e869]
              - generic [ref=e871]: Alvenaria
            - button "Pisos" [ref=e872]:
              - img [ref=e874]
              - generic [ref=e876]: Pisos
            - button "Pós-obra" [ref=e877]:
              - img [ref=e879]
              - generic [ref=e884]: Pós-obra
            - button "Residencial" [ref=e885]:
              - img [ref=e887]
              - generic [ref=e890]: Residencial
      - region "Parceiros e imprensa" [ref=e891]:
        - generic [ref=e892]:
          - paragraph [ref=e894]: Referência no mercado
          - generic [ref=e896]:
            - generic [ref=e899]: G1
            - generic [ref=e902]: Folha de S.Paulo
            - generic [ref=e905]: Valor Econômico
            - generic [ref=e908]: Exame
            - generic [ref=e911]: InfoMoney
            - generic [ref=e914]: Startups
            - generic [ref=e917]: Sebrae
            - generic [ref=e920]: ABES
          - paragraph [ref=e921]: + de 6.000 prestadores confiam no Severinno
      - region "Avaliações de clientes" [ref=e922]:
        - generic:
          - generic:
            - img
        - generic [ref=e924]:
          - generic [ref=e925]:
            - img [ref=e926]
            - text: Avaliações reais
          - heading "O que nossos clientes dizem" [level=2] [ref=e928]
          - paragraph [ref=e929]: Avaliações de clientes após a conclusão do serviço.
      - generic [ref=e994]:
        - generic [ref=e997]:
          - generic [ref=e998]:
            - img [ref=e1000]
            - generic [ref=e1005]: "0"
            - paragraph [ref=e1006]: Prestadores verificados
          - generic [ref=e1007]:
            - img [ref=e1009]
            - generic [ref=e1011]: "0"
            - paragraph [ref=e1012]: Serviços cadastrados
          - generic [ref=e1013]:
            - img [ref=e1015]
            - generic [ref=e1018]: "0"
            - paragraph [ref=e1019]: Serviços concluídos
          - generic [ref=e1020]:
            - img [ref=e1022]
            - generic [ref=e1025]: 0.0/5
            - paragraph [ref=e1026]: Nota média
        - generic [ref=e1028]:
          - generic [ref=e1029]:
            - generic [ref=e1030]:
              - img [ref=e1031]
              - text: Por que Severinno?
            - heading "Confiança em cada agendamento" [level=2] [ref=e1034]
            - paragraph [ref=e1035]: Mais que um diretório de serviços — um ecossistema pensado para proteger você e o prestador. Da verificação ao pagamento, cada etapa foi desenhada para a sua tranquilidade.
            - link "Pular para FAQ" [ref=e1037] [cursor=pointer]:
              - /url: "#faq"
              - img [ref=e1038]
              - text: Pular para FAQ
          - generic [ref=e1041]:
            - generic [ref=e1044]:
              - generic [ref=e1045]:
                - img [ref=e1047]
                - button "Saiba mais sobre Prestadores verificados" [ref=e1050]:
                  - img [ref=e1051]
              - heading "Prestadores verificados" [level=3] [ref=e1054]
              - paragraph [ref=e1055]: João verificou 3 documentos antes de aprovar o prestador. Você só vê profissionais validados.
              - button "Saiba mais" [ref=e1056]:
                - text: Saiba mais
                - img [ref=e1057]
            - generic [ref=e1061]:
              - generic [ref=e1062]:
                - img [ref=e1064]
                - button "Saiba mais sobre Pagamento protegido" [ref=e1067]:
                  - img [ref=e1068]
              - heading "Pagamento protegido" [level=3] [ref=e1071]
              - paragraph [ref=e1072]: O valor só é liberado ao prestador após você confirmar que ficou satisfeito com o serviço.
              - button "Saiba mais" [ref=e1073]:
                - text: Saiba mais
                - img [ref=e1074]
            - generic [ref=e1078]:
              - generic [ref=e1079]:
                - img [ref=e1081]
                - button "Saiba mais sobre Resposta rápida" [ref=e1084]:
                  - img [ref=e1085]
              - heading "Resposta rápida" [level=3] [ref=e1088]
              - paragraph [ref=e1089]: Prestadores comprometidos a responder em até 24h. Acompanhe o status em tempo real.
              - button "Saiba mais" [ref=e1090]:
                - text: Saiba mais
                - img [ref=e1091]
            - generic [ref=e1095]:
              - generic [ref=e1096]:
                - img [ref=e1098]
                - button "Saiba mais sobre Avaliações reais" [ref=e1100]:
                  - img [ref=e1101]
              - heading "Avaliações reais" [level=3] [ref=e1104]
              - paragraph [ref=e1105]: Apenas clientes que concluíram o serviço podem avaliar. Sem falsas avaliações.
              - button "Saiba mais" [ref=e1106]:
                - text: Saiba mais
                - img [ref=e1107]
            - generic [ref=e1111]:
              - generic [ref=e1112]:
                - img [ref=e1114]
                - button "Saiba mais sobre Próximo de você" [ref=e1117]:
                  - img [ref=e1118]
              - heading "Próximo de você" [level=3] [ref=e1121]
              - paragraph [ref=e1122]: Geolocalização inteligente mostra os melhores prestadores na sua região.
              - button "Saiba mais" [ref=e1123]:
                - text: Saiba mais
                - img [ref=e1124]
            - generic [ref=e1128]:
              - generic [ref=e1129]:
                - img [ref=e1131]
                - button "Saiba mais sobre Suporte humano" [ref=e1133]:
                  - img [ref=e1134]
              - heading "Suporte humano" [level=3] [ref=e1137]
              - paragraph [ref=e1138]: Equipe disponível para mediar disputas, tirar dúvidas e garantir uma experiência justa.
              - button "Saiba mais" [ref=e1139]:
                - text: Saiba mais
                - img [ref=e1140]
        - generic [ref=e1143]:
          - img [ref=e1144]
          - paragraph [ref=e1146]: "Garantia Severinno: seu dinheiro de volta se o serviço não for bem-feito."
          - link "Saiba mais" [ref=e1147] [cursor=pointer]:
            - /url: "#faq"
            - text: Saiba mais
            - img [ref=e1148]
      - generic [ref=e1151]:
        - generic [ref=e1152]:
          - generic [ref=e1153]:
            - img [ref=e1154]
            - text: Destaque da semana
          - heading "Profissional em destaque" [level=2] [ref=e1160]
          - paragraph [ref=e1161]: Conheça um dos nossos prestadores mais bem avaliados.
        - generic [ref=e1165]:
          - generic [ref=e1166]:
            - generic [ref=e1167]:
              - img [ref=e1170]
              - img [ref=e1174]
              - generic [ref=e1178]:
                - img [ref=e1179]
                - text: Top
            - generic [ref=e1181]:
              - generic [ref=e1182]:
                - heading "Maria Silva" [level=3] [ref=e1183]
                - generic [ref=e1184]:
                  - generic [ref=e1185]:
                    - img [ref=e1186]
                    - text: São Paulo
                  - generic [ref=e1189]: 3 km
                  - generic [ref=e1190]:
                    - img [ref=e1191]
                    - text: Membro desde 2023
              - generic [ref=e1193]:
                - generic [ref=e1194]:
                  - img [ref=e1195]
                  - generic [ref=e1197]: "4.8"
                - generic [ref=e1198]: (42 avaliações)
              - generic [ref=e1199]:
                - generic [ref=e1200]:
                  - img
                  - text: 230 serviços concluídos
                - generic [ref=e1201]:
                  - img
                  - text: Responde em ~30min
              - generic [ref=e1202]:
                - paragraph [ref=e1203]: Serviços
                - generic [ref=e1205]:
                  - generic [ref=e1206]: Instalação Elétrica
                  - generic [ref=e1207]: R$ 120,00
              - paragraph [ref=e1209]: Especialista em instalações elétricas residenciais com mais de 10 anos de experiência.
              - generic [ref=e1210]:
                - generic [ref=e1211]:
                  - generic "Maria S." [ref=e1212]: M
                  - generic "João P." [ref=e1213]: J
                  - generic "Ana L." [ref=e1214]: A
                - generic [ref=e1215]: Clientes recentes
          - generic [ref=e1216]:
            - generic [ref=e1217]:
              - button "Pedir orçamento" [ref=e1218]:
                - img
                - text: Pedir orçamento
              - button "Ver perfil completo" [ref=e1219]:
                - text: Ver perfil completo
                - img
            - button "Enviar mensagem" [ref=e1221]:
              - img
              - text: Enviar mensagem
      - generic [ref=e1225]:
        - generic [ref=e1226]:
          - generic [ref=e1227]:
            - generic [ref=e1228]:
              - img [ref=e1229]
              - text: Perguntas frequentes
            - heading "Tire suas dúvidas antes de contratar" [level=2] [ref=e1232]
            - paragraph [ref=e1233]: Reunimos as perguntas mais comuns sobre como o Severinno funciona — do cadastro ao pagamento.
          - generic [ref=e1234]:
            - img [ref=e1235]
            - textbox "Buscar nas perguntas frequentes" [ref=e1238]:
              - /placeholder: Buscar nas dúvidas…
          - generic [ref=e1239]:
            - paragraph [ref=e1240]: Filtrar por categoria
            - generic [ref=e1241]:
              - button "Filtrar por Geral" [ref=e1242]:
                - img [ref=e1243]
                - text: Geral
                - generic [ref=e1246]: (2)
              - button "Filtrar por Pagamento" [ref=e1247]:
                - img [ref=e1248]
                - text: Pagamento
                - generic [ref=e1250]: (2)
              - button "Filtrar por Agendamento" [ref=e1251]:
                - img [ref=e1252]
                - text: Agendamento
                - generic [ref=e1254]: (2)
              - button "Filtrar por Prestadores" [ref=e1255]:
                - img [ref=e1256]
                - text: Prestadores
                - generic [ref=e1260]: (2)
              - button "Filtrar por Segurança" [ref=e1261]:
                - img [ref=e1262]
                - text: Segurança
                - generic [ref=e1265]: (2)
          - generic [ref=e1266]:
            - paragraph [ref=e1267]: Perguntas mais frequentes
            - list [ref=e1268]:
              - listitem [ref=e1269]:
                - button "Como funciona o Severinno?" [ref=e1270]:
                  - img [ref=e1271]
                  - generic [ref=e1273]: Como funciona o Severinno?
              - listitem [ref=e1274]:
                - button "Preciso pagar para me cadastrar?" [ref=e1275]:
                  - img [ref=e1276]
                  - generic [ref=e1278]: Preciso pagar para me cadastrar?
              - listitem [ref=e1279]:
                - button "Como faço para agendar um serviço?" [ref=e1280]:
                  - img [ref=e1281]
                  - generic [ref=e1283]: Como faço para agendar um serviço?
              - listitem [ref=e1284]:
                - button "E se o serviço não for bem-feito?" [ref=e1285]:
                  - img [ref=e1286]
                  - generic [ref=e1288]: E se o serviço não for bem-feito?
          - generic [ref=e1290]:
            - img [ref=e1292]
            - generic [ref=e1294]:
              - paragraph [ref=e1295]: Ainda tem dúvidas?
              - paragraph [ref=e1296]: Cadastre-se grátis e converse diretamente com prestadores verificados. Sem compromisso.
              - generic [ref=e1297]:
                - button "Cadastrar grátis" [ref=e1298]
                - link "Fale conosco" [ref=e1299] [cursor=pointer]:
                  - /url: "#faq"
                  - img
                  - text: Fale conosco
        - generic [ref=e1300]:
          - generic [ref=e1302]:
            - generic [ref=e1304]:
              - heading "01 Como funciona o Severinno? Geral" [level=3] [ref=e1305]:
                - button "01 Como funciona o Severinno? Geral" [expanded] [ref=e1306]:
                  - generic [ref=e1307]:
                    - generic [ref=e1308]: "01"
                    - generic [ref=e1309]: Como funciona o Severinno?
                    - generic [ref=e1310]:
                      - img
                      - text: Geral
                  - img
              - region "01 Como funciona o Severinno? Geral" [ref=e1311]:
                - generic [ref=e1313]:
                  - paragraph [ref=e1314]: O Severinno conecta você a prestadores de serviço verificados próximos à sua localização. Você busca o serviço, compara avaliações reais de outros clientes, pede orçamento grátis e agenda — tudo pela plataforma. O pagamento só é liberado após você confirmar a conclusão do serviço.
                  - paragraph [ref=e1315]: "Ex: Maria precisava de um eletricista. Buscou na plataforma, comparou 3 profissionais e contratou o mais bem avaliado — tudo em 5 minutos."
            - heading "02 Preciso pagar para me cadastrar? Geral" [level=3] [ref=e1318]:
              - button "02 Preciso pagar para me cadastrar? Geral" [ref=e1319]:
                - generic [ref=e1320]:
                  - generic [ref=e1321]: "02"
                  - generic [ref=e1322]: Preciso pagar para me cadastrar?
                  - generic [ref=e1323]:
                    - img
                    - text: Geral
                - img
            - heading "03 Como os prestadores são verificados? Prestadores" [level=3] [ref=e1326]:
              - button "03 Como os prestadores são verificados? Prestadores" [ref=e1327]:
                - generic [ref=e1328]:
                  - generic [ref=e1329]: "03"
                  - generic [ref=e1330]: Como os prestadores são verificados?
                  - generic [ref=e1331]:
                    - img
                    - text: Prestadores
                - img
            - heading "04 Posso me tornar um prestador no Severinno? Prestadores" [level=3] [ref=e1334]:
              - button "04 Posso me tornar um prestador no Severinno? Prestadores" [ref=e1335]:
                - generic [ref=e1336]:
                  - generic [ref=e1337]: "04"
                  - generic [ref=e1338]: Posso me tornar um prestador no Severinno?
                  - generic [ref=e1339]:
                    - img
                    - text: Prestadores
                - img
            - heading "05 Como faço para agendar um serviço? Agendamento" [level=3] [ref=e1342]:
              - button "05 Como faço para agendar um serviço? Agendamento" [ref=e1343]:
                - generic [ref=e1344]:
                  - generic [ref=e1345]: "05"
                  - generic [ref=e1346]: Como faço para agendar um serviço?
                  - generic [ref=e1347]:
                    - img
                    - text: Agendamento
                - img
            - heading "06 Posso remarcar ou cancelar um agendamento? Agendamento" [level=3] [ref=e1350]:
              - button "06 Posso remarcar ou cancelar um agendamento? Agendamento" [ref=e1351]:
                - generic [ref=e1352]:
                  - generic [ref=e1353]: "06"
                  - generic [ref=e1354]: Posso remarcar ou cancelar um agendamento?
                  - generic [ref=e1355]:
                    - img
                    - text: Agendamento
                - img
            - heading "07 Como funciona o pagamento? Pagamento" [level=3] [ref=e1358]:
              - button "07 Como funciona o pagamento? Pagamento" [ref=e1359]:
                - generic [ref=e1360]:
                  - generic [ref=e1361]: "07"
                  - generic [ref=e1362]: Como funciona o pagamento?
                  - generic [ref=e1363]:
                    - img
                    - text: Pagamento
                - img
            - heading "08 O orçamento tem compromisso? Pagamento" [level=3] [ref=e1366]:
              - button "08 O orçamento tem compromisso? Pagamento" [ref=e1367]:
                - generic [ref=e1368]:
                  - generic [ref=e1369]: "08"
                  - generic [ref=e1370]: O orçamento tem compromisso?
                  - generic [ref=e1371]:
                    - img
                    - text: Pagamento
                - img
            - heading "09 E se o serviço não for bem-feito? Segurança" [level=3] [ref=e1374]:
              - button "09 E se o serviço não for bem-feito? Segurança" [ref=e1375]:
                - generic [ref=e1376]:
                  - generic [ref=e1377]: "09"
                  - generic [ref=e1378]: E se o serviço não for bem-feito?
                  - generic [ref=e1379]:
                    - img
                    - text: Segurança
                - img
            - heading "10 Meus dados pessoais estão seguros? Segurança" [level=3] [ref=e1382]:
              - button "10 Meus dados pessoais estão seguros? Segurança" [ref=e1383]:
                - generic [ref=e1384]:
                  - generic [ref=e1385]: "10"
                  - generic [ref=e1386]: Meus dados pessoais estão seguros?
                  - generic [ref=e1387]:
                    - img
                    - text: Segurança
                - img
          - generic [ref=e1388]:
            - paragraph [ref=e1389]: 10 de 10 dúvidas
            - button "Voltar ao topo da seção" [ref=e1390]:
              - img [ref=e1391]
              - text: Topo
      - generic [ref=e1395]:
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
        - generic [ref=e1400]:
          - generic [ref=e1401]:
            - generic [ref=e1403]:
              - img [ref=e1404]
              - text: Comece agora mesmo
            - heading "Encontre o serviço que você precisa" [level=2] [ref=e1406]
            - paragraph [ref=e1407]: Navegue pela vitrine, salve seus favoritos e agende com confiança. Tudo em um só lugar.
            - list [ref=e1408]:
              - generic [ref=e1409]:
                - listitem [ref=e1410]:
                  - img [ref=e1411]
                  - text: Cadastro gratuito
                - listitem [ref=e1414]:
                  - img [ref=e1415]
                  - text: Sem taxa de serviço
                - listitem [ref=e1418]:
                  - img [ref=e1419]
                  - text: Orçamento sem compromisso
            - button "Buscar prestadores" [ref=e1427]:
              - img
              - text: Buscar prestadores
              - generic [ref=e1428]:
                - img
          - generic [ref=e1429]:
            - generic [ref=e1430]:
              - heading "O que vem depois?" [level=3] [ref=e1431]
              - paragraph [ref=e1432]: Três passos simples e você estará agendando
              - generic [ref=e1433]:
                - img [ref=e1434]
                - generic [ref=e1435]:
                  - generic [ref=e1436]:
                    - generic [ref=e1438]: "1"
                    - generic [ref=e1439]:
                      - paragraph [ref=e1440]: Cadastre-se grátis
                      - paragraph [ref=e1441]: ~30s
                  - generic [ref=e1442]:
                    - generic [ref=e1444]: "2"
                    - generic [ref=e1445]:
                      - paragraph [ref=e1446]: Busque e compare
                      - paragraph [ref=e1447]: ~2 min
                  - generic [ref=e1448]:
                    - generic [ref=e1450]: "3"
                    - generic [ref=e1451]:
                      - paragraph [ref=e1452]: Agende com confiança
                      - paragraph [ref=e1453]: ~5 min
              - generic [ref=e1454]:
                - generic [ref=e1455]:
                  - img [ref=e1456]
                  - text: Sem compromisso
                - generic [ref=e1460]:
                  - img [ref=e1461]
                  - text: Cancele quando quiser
                - generic [ref=e1464]:
                  - img [ref=e1465]
                  - text: Suporte 24h
              - link "Saiba mais sobre pagamento protegido" [ref=e1468] [cursor=pointer]:
                - /url: "#faq"
                - img [ref=e1469]
                - text: Saiba mais sobre pagamento protegido
            - generic [ref=e1473]:
              - generic [ref=e1477]: Cliente
              - generic [ref=e1478]:
                - img [ref=e1482]
                - generic [ref=e1484]: Prestador
              - img [ref=e1489]
              - img [ref=e1491]
              - img [ref=e1495]
              - img [ref=e1498]
              - img [ref=e1502]
        - generic [ref=e1506]:
          - img [ref=e1507]
          - generic [ref=e1510]:
            - paragraph [ref=e1511]: “Encontrei um encanador em 10 minutos, paguei menos do que esperava e ainda pude avaliar o serviço. Recomendo demais!”
            - paragraph [ref=e1512]: — Ana P., Cliente, São Paulo
        - generic [ref=e1513]:
          - generic [ref=e1514]:
            - img [ref=e1515]
            - text: Sem compromisso
          - generic [ref=e1519]:
            - img [ref=e1520]
            - text: Cancele quando quiser
          - generic [ref=e1523]:
            - img [ref=e1524]
            - text: Pagamento protegido
    - contentinfo [ref=e1526]:
      - generic [ref=e1528]:
        - generic [ref=e1529]:
          - paragraph [ref=e1530]: Receba novidades e dicas de serviços
          - paragraph [ref=e1531]: Cadastre-se e receba ofertas exclusivas. Cancele quando quiser.
        - generic [ref=e1532]:
          - generic [ref=e1533]:
            - img [ref=e1534]
            - textbox "E-mail para newsletter" [ref=e1537]:
              - /placeholder: Seu e-mail
          - button "Assinar" [disabled]:
            - img
            - text: Assinar
      - generic [ref=e1538]:
        - generic [ref=e1539]:
          - generic [ref=e1540]:
            - generic [ref=e1541]:
              - img [ref=e1543]
              - generic [ref=e1546]: Severinno
            - paragraph [ref=e1547]: Marketplace de serviços com geolocalização. Encontre prestadores verificados, próximos e bem avaliados.
            - list "Redes sociais" [ref=e1548]:
              - listitem [ref=e1549]:
                - link "GitHub" [ref=e1550] [cursor=pointer]:
                  - /url: https://github.com
                  - img [ref=e1551]
              - listitem [ref=e1554]:
                - link "Twitter" [ref=e1555] [cursor=pointer]:
                  - /url: https://twitter.com
                  - img [ref=e1556]
              - listitem [ref=e1558]:
                - link "Instagram" [ref=e1559] [cursor=pointer]:
                  - /url: https://instagram.com
                  - img [ref=e1560]
              - listitem [ref=e1563]:
                - link "LinkedIn" [ref=e1564] [cursor=pointer]:
                  - /url: https://linkedin.com
                  - img [ref=e1565]
              - listitem [ref=e1569]:
                - link "E-mail" [ref=e1570] [cursor=pointer]:
                  - /url: mailto:contato@severinno.com
                  - img [ref=e1571]
          - navigation "Sobre" [ref=e1574]:
            - heading "Sobre" [level=3] [ref=e1575]:
              - img [ref=e1576]
              - text: Sobre
            - list [ref=e1579]:
              - listitem [ref=e1580]:
                - button "Como funciona" [ref=e1581]
              - listitem [ref=e1582]:
                - button "Quem somos" [ref=e1583]
              - listitem [ref=e1584]:
                - button "Termos de uso" [ref=e1585]
              - listitem [ref=e1586]:
                - button "Privacidade" [ref=e1587]
          - navigation "Para profissionais" [ref=e1588]:
            - heading "Para profissionais" [level=3] [ref=e1589]:
              - img [ref=e1590]
              - text: Para profissionais
            - list [ref=e1593]:
              - listitem [ref=e1594]:
                - button "Cadastre-se" [ref=e1595]
              - listitem [ref=e1596]:
                - button "Meu painel" [ref=e1597]
              - listitem [ref=e1598]:
                - button "Central de ajuda" [ref=e1599]
          - navigation "Precisa de ajuda?" [ref=e1600]:
            - heading "Precisa de ajuda?" [level=3] [ref=e1601]:
              - img [ref=e1602]
              - text: Precisa de ajuda?
            - list [ref=e1604]:
              - listitem [ref=e1605]:
                - button "Perguntas frequentes" [ref=e1606]
              - listitem [ref=e1607]:
                - button "Segurança" [ref=e1608]
              - listitem [ref=e1609]:
                - button "Reportar problema" [ref=e1610]
          - generic [ref=e1611]:
            - heading "Contato" [level=3] [ref=e1612]:
              - img [ref=e1613]
              - text: Contato
            - list [ref=e1618]:
              - listitem [ref=e1619]:
                - img [ref=e1620]
                - link "contato@severinno.com" [ref=e1623] [cursor=pointer]:
                  - /url: mailto:contato@severinno.com
              - listitem [ref=e1624]:
                - img [ref=e1625]
                - text: São Paulo, Brasil
            - button "Fale conosco" [ref=e1628]:
              - img
              - text: Fale conosco
        - generic [ref=e1629]:
          - paragraph [ref=e1630]: © 2026 Severinno Marketplace. Todos os direitos reservados.
          - paragraph [ref=e1631]:
            - text: Feito com
            - img [ref=e1632]
            - text: usando tecnologia Open Source (
            - link "MapLibre" [ref=e1634] [cursor=pointer]:
              - /url: https://maplibre.org/
            - text: ·
            - link "OpenStreetMap" [ref=e1635] [cursor=pointer]:
              - /url: https://www.openstreetmap.org/copyright
            - text: )
      - button "Voltar ao topo" [ref=e1636]:
        - img [ref=e1637]
    - button "Voltar ao topo" [ref=e1640]:
      - img
    - button "Abrir assistente virtual" [ref=e1641]:
      - img [ref=e1642]
    - generic [ref=e1646]:
      - generic [ref=e1647]:
        - img [ref=e1649]
        - generic [ref=e1651]:
          - paragraph [ref=e1652]: Usamos cookies para melhorar sua experiência
          - paragraph [ref=e1653]:
            - text: Utilizamos cookies essenciais para o funcionamento do site e cookies de análise para melhorar nossos serviços.
            - button "Política de privacidade" [ref=e1654]
      - generic [ref=e1655]:
        - button "Recusar" [ref=e1656]
        - button "Aceitar" [ref=e1657]:
          - img
          - text: Aceitar
        - button "Dispensar" [ref=e1658]:
          - img [ref=e1659]
  - region "Notifications alt+T"
  - generic [active]:
    - generic [ref=e1664]:
      - generic [ref=e1665]:
        - generic [ref=e1666]:
          - navigation [ref=e1667]:
            - button "previous" [disabled] [ref=e1668]:
              - img "previous" [ref=e1669]
            - generic [ref=e1671]:
              - generic [ref=e1672]: 1/
              - text: "1"
            - button "next" [disabled] [ref=e1673]:
              - img "next" [ref=e1674]
          - img
        - generic [ref=e1676]:
          - link "Next.js 16.1.3 (stale) Turbopack" [ref=e1677] [cursor=pointer]:
            - /url: https://nextjs.org/docs/messages/version-staleness
            - img [ref=e1678]
            - generic "There is a newer version (16.2.11) available, upgrade recommended!" [ref=e1680]: Next.js 16.1.3 (stale)
            - generic [ref=e1681]: Turbopack
          - img
      - dialog "Build Error" [ref=e1683]:
        - generic [ref=e1686]:
          - generic [ref=e1687]:
            - generic [ref=e1688]:
              - generic [ref=e1690]: Build Error
              - generic [ref=e1691]:
                - button "Copy Error Info" [ref=e1692] [cursor=pointer]:
                  - img [ref=e1693]
                - button "No related documentation found" [disabled] [ref=e1695]:
                  - img [ref=e1696]
                - button "Attach Node.js inspector" [ref=e1698] [cursor=pointer]:
                  - img [ref=e1699]
            - generic [ref=e1708]: Reading source code for parsing failed
          - generic [ref=e1710]:
            - generic [ref=e1712]:
              - img [ref=e1714]
              - generic [ref=e1718]: ./.freebuff/worktrees/thmrzp9vv9y86o/src/lib/api-server.ts
              - button "Open in editor" [ref=e1719] [cursor=pointer]:
                - img [ref=e1721]
            - generic [ref=e1725]: "Reading source code for parsing failed An unexpected error happened while trying to read the source code to parse: failed to convert rope into string Caused by: - invalid utf-8 sequence of 1 bytes from index 5415 Import trace: App Route: ./.freebuff/worktrees/thmrzp9vv9y86o/src/lib/api-server.ts ./.freebuff/worktrees/thmrzp9vv9y86o/src/app/api/auth/me/route.ts"
        - generic [ref=e1726]: "1"
        - generic [ref=e1727]: "2"
    - generic [ref=e1732] [cursor=pointer]:
      - button "Open Next.js Dev Tools" [ref=e1733]:
        - img [ref=e1734]
      - button "Open issues overlay" [ref=e1738]:
        - generic [ref=e1739]:
          - generic [ref=e1740]: "0"
          - generic [ref=e1741]: "1"
        - generic [ref=e1742]: Issue
  - alert [ref=e1743]
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