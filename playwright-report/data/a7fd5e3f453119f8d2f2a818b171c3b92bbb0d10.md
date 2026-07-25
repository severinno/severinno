# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: quote-flow.spec.ts >> QuoteModal — Cliente Autenticado >> 8. step 4 — preenche endereço com CEP
- Location: e2e\quote-flow.spec.ts:282:7

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
    - waiting for element to be visible, enabled and stable
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

```

# Page snapshot

```yaml
- generic [ref=e1]:
  - generic [ref=e3]:
    - generic [ref=e5]:
      - img [ref=e7]
      - generic [ref=e9]:
        - paragraph [ref=e10]: Bem-vindo ao Severinno!
        - paragraph [ref=e11]: Carregando…
      - button "Dispensar notificação" [ref=e12]:
        - img [ref=e13]
    - banner [ref=e16]:
      - generic [ref=e17]:
        - button "Severinno — página inicial" [ref=e18]:
          - generic [ref=e19]:
            - img [ref=e21]
            - img [ref=e25]
          - generic [ref=e27]: Severinno
          - generic [ref=e28]:
            - img [ref=e29]
            - generic [ref=e32]: Verificado
        - generic [ref=e35]:
          - img
          - textbox "Buscar prestadores" [ref=e36]:
            - /placeholder: Buscar serviço ou prestador…
          - generic: ⌘K
        - button "Usar minha localização" [ref=e38]:
          - img
          - generic [ref=e39]: Definir localização
        - generic [ref=e40]:
          - button "Alternar tema" [ref=e41]:
            - generic [ref=e42]:
              - img
          - button "Notificações" [ref=e43]:
            - img
          - button "Favoritos" [ref=e44]:
            - img
          - button "Menu da conta" [ref=e45]:
            - generic [ref=e48]: TU
            - generic [ref=e50]: Test
            - img [ref=e51]
    - main [ref=e53]:
      - generic [ref=e60]:
        - generic [ref=e61]:
          - generic [ref=e63]:
            - img [ref=e64]
            - text: Marketplace de serviços verificados
          - heading "Prestadores de serviço verificados, perto de você." [level=1] [ref=e67]
          - paragraph [ref=e68]: Compare avaliações reais, peça orçamento grátis e agende — encanador, eletricista, pintor e mais. Você escolhe o profissional.
          - generic [ref=e70]:
            - generic [ref=e71]:
              - img [ref=e72]
              - textbox "Serviço buscado" [ref=e75]:
                - /placeholder: "O que você precisa? Ex.: encanador, pintura…"
            - generic [ref=e76]:
              - img [ref=e77]
              - textbox "Localização" [ref=e80]:
                - /placeholder: CEP ou cidade
            - button "Buscar" [ref=e81]:
              - img
              - text: Buscar
          - generic [ref=e82]:
            - generic [ref=e83]: "Mais buscados:"
            - button "Encanador" [ref=e84]:
              - generic [ref=e85]: 🔧
              - text: Encanador
            - button "Eletricista" [ref=e86]:
              - generic [ref=e87]: 💡
              - text: Eletricista
            - button "Pintor" [ref=e88]:
              - generic [ref=e89]: 🎨
              - text: Pintor
            - button "Diarista" [ref=e90]:
              - generic [ref=e91]: 🧹
              - text: Diarista
            - button "Pedreiro" [ref=e92]:
              - generic [ref=e93]: 🧱
              - text: Pedreiro
            - button "Jardineiro" [ref=e94]:
              - generic [ref=e95]: 🌿
              - text: Jardineiro
          - button "Usar minha localização" [ref=e96]:
            - img [ref=e97]
            - text: Usar minha localização
          - generic [ref=e100]:
            - button "Cadastrar grátis" [ref=e101]:
              - text: Cadastrar grátis
              - img
            - button "Ver como funciona" [ref=e102]
          - paragraph [ref=e103]: Cadastro grátis · Orçamento sem compromisso · Você escolhe o profissional
          - list [ref=e104]:
            - listitem "Documentos validados e identidade confirmada" [ref=e105]:
              - img [ref=e107]
              - generic [ref=e110]: Prestadores verificados
            - listitem "Avaliações de clientes após a conclusão do serviço" [ref=e111]:
              - img [ref=e113]
              - generic [ref=e115]: Avaliações reais
            - listitem "Pagamento só é liberado após você marcar como concluído" [ref=e116]:
              - img [ref=e118]
              - generic [ref=e121]: Pagamento seguro
        - generic [ref=e130]: Atividade ao vivo
      - region "Atividade recente na plataforma" [ref=e158]:
        - generic [ref=e159]:
          - generic [ref=e161]: Atividade recente
          - generic [ref=e165]:
            - generic [ref=e167]:
              - generic [ref=e168]:
                - generic [ref=e169]: ⚡
                - text: Maria contratou um eletricista em São Paulo
              - generic [ref=e171]:
                - generic [ref=e172]: ⭐
                - text: João avaliou ★★★★★ o prestador Ricardo
              - generic [ref=e174]:
                - generic [ref=e175]: 🎨
                - text: "Nova avaliação: 4.9 para Serviços de Pintura"
              - generic [ref=e177]:
                - generic [ref=e178]: 🔧
                - text: Ana pediu orçamento para encanador
              - generic [ref=e180]:
                - generic [ref=e181]: ✅
                - text: Pedro se cadastrou como prestador verificado
              - generic [ref=e183]:
                - generic [ref=e184]: 📋
                - text: 12 orçamentos enviados hoje
              - generic [ref=e186]:
                - generic [ref=e187]: ⚡
                - text: Maria contratou um eletricista em São Paulo
              - generic [ref=e189]:
                - generic [ref=e190]: ⭐
                - text: João avaliou ★★★★★ o prestador Ricardo
              - generic [ref=e192]:
                - generic [ref=e193]: 🎨
                - text: "Nova avaliação: 4.9 para Serviços de Pintura"
              - generic [ref=e195]:
                - generic [ref=e196]: 🔧
                - text: Ana pediu orçamento para encanador
              - generic [ref=e198]:
                - generic [ref=e199]: ✅
                - text: Pedro se cadastrou como prestador verificado
              - generic [ref=e201]:
                - generic [ref=e202]: 📋
                - text: 12 orçamentos enviados hoje
            - generic [ref=e206]:
              - generic [ref=e207]:
                - generic [ref=e208]: 🧹
                - text: Carlos agendou limpeza de quintal em Belo Horizonte
              - generic [ref=e210]:
                - generic [ref=e211]: ⭐
                - text: Fernanda avaliou ★★★★★ o prestador José
              - generic [ref=e213]:
                - generic [ref=e214]: 🛡️
                - text: 8 novos prestadores verificados esta semana
              - generic [ref=e216]:
                - generic [ref=e217]: 🎨
                - text: Luciana contratou um pintor no Rio de Janeiro
              - generic [ref=e219]:
                - generic [ref=e220]: 🚿
                - text: "Orçamento aceito: reforma de banheiro em Curitiba"
              - generic [ref=e222]:
                - generic [ref=e223]: 🏆
                - text: 5.200 serviços concluídos este mês
              - generic [ref=e225]:
                - generic [ref=e226]: 🧹
                - text: Carlos agendou limpeza de quintal em Belo Horizonte
              - generic [ref=e228]:
                - generic [ref=e229]: ⭐
                - text: Fernanda avaliou ★★★★★ o prestador José
              - generic [ref=e231]:
                - generic [ref=e232]: 🛡️
                - text: 8 novos prestadores verificados esta semana
              - generic [ref=e234]:
                - generic [ref=e235]: 🎨
                - text: Luciana contratou um pintor no Rio de Janeiro
              - generic [ref=e237]:
                - generic [ref=e238]: 🚿
                - text: "Orçamento aceito: reforma de banheiro em Curitiba"
              - generic [ref=e240]:
                - generic [ref=e241]: 🏆
                - text: 5.200 serviços concluídos este mês
      - region "Categorias de serviços" [ref=e243]:
        - generic [ref=e244]:
          - generic:
            - img
          - generic [ref=e246]:
            - generic [ref=e247]:
              - img [ref=e248]
              - text: Explore categorias
            - heading "Encontre o serviço ideal" [level=2] [ref=e251]
            - paragraph [ref=e252]: Serviços verificados perto de você — … carregando categorias
          - generic "Carregando categorias" [ref=e253]
      - region "Resultados da busca" [ref=e294]:
        - generic [ref=e295]:
          - complementary [ref=e296]:
            - generic [ref=e298]:
              - generic [ref=e299]:
                - heading "Filtros" [level=2] [ref=e300]:
                  - img [ref=e301]
                  - text: Filtros
                - button "Limpar filtros" [ref=e302]
              - generic [ref=e303]:
                - generic [ref=e304]: Buscar
                - generic [ref=e305]:
                  - img [ref=e306]
                  - textbox "Buscar" [ref=e309]:
                    - /placeholder: Serviço, prestador…
              - generic [ref=e310]:
                - generic [ref=e311]:
                  - generic [ref=e312]: Raio de busca
                  - generic [ref=e313]: 15 km
                - generic "Raio de busca em quilômetros" [ref=e314]:
                  - slider [ref=e318]
                - generic [ref=e319]:
                  - generic [ref=e320]: 1 km
                  - generic [ref=e321]: 50 km
              - generic [ref=e322]:
                - generic [ref=e323]: Categoria
                - combobox [ref=e324]:
                  - generic: Todas as categorias
                  - img
              - generic [ref=e325]:
                - generic [ref=e326]: Ordenar por
                - radiogroup "Ordenar por" [ref=e327]:
                  - radio "Melhor avaliação" [checked] [ref=e328]
                  - radio "Mais próximos" [ref=e329]
              - generic [ref=e330]:
                - generic [ref=e331]: Avaliação mínima
                - radiogroup [ref=e332]:
                  - generic [ref=e333] [cursor=pointer]:
                    - radio "Todas" [checked] [ref=e334]:
                      - img [ref=e335]
                    - generic [ref=e337]: Todas
                  - generic [ref=e338] [cursor=pointer]:
                    - radio "3+" [ref=e339]
                    - generic [ref=e340]: 3+
                  - generic [ref=e341] [cursor=pointer]:
                    - radio "4+" [ref=e342]
                    - generic [ref=e343]: 4+
                  - generic [ref=e344] [cursor=pointer]:
                    - radio "5" [ref=e345]
                    - generic [ref=e346]: "5"
              - generic [ref=e347] [cursor=pointer]:
                - generic [ref=e348]:
                  - img [ref=e349]
                  - generic [ref=e351]: Somente verificados
                - switch "Somente verificados" [ref=e352]
              - button "Ver 0 resultados" [disabled]
          - generic [ref=e355]:
            - generic [ref=e356]:
              - heading [level=2] [ref=e357]
              - paragraph [ref=e359]: Exibindo 0–0 de 0
            - generic [ref=e360]:
              - generic [ref=e361]:
                - text: "Ordenado por:"
                - generic [ref=e362]: Melhor avaliação
              - tablist "Visualização" [ref=e363]:
                - tab "Lista" [selected] [ref=e364]:
                  - img [ref=e365]
                  - generic [ref=e366]: Lista
                - tab "Mapa" [ref=e367]:
                  - img [ref=e368]
                  - generic [ref=e370]: Mapa
      - region "Como funciona" [ref=e457]:
        - generic [ref=e462]:
          - generic [ref=e463]:
            - link "Pular para resultados" [ref=e464] [cursor=pointer]:
              - /url: "#vitrine-resultados"
              - img [ref=e465]
              - text: Pular para resultados
            - generic [ref=e469]:
              - img [ref=e470]
              - generic [ref=e472]: "4"
              - text: passos simples
            - heading "Como funciona" [level=2] [ref=e473]
            - paragraph [ref=e474]: Sem surpresas — do início ao fim, você tem o controle.
            - generic [ref=e475]:
              - img [ref=e476]
              - text: Sem compromisso
          - generic [ref=e482]:
            - img [ref=e484]
            - generic [ref=e485]:
              - 'button "1 Busque o serviço Encontre prestadores verificados perto de você. 50 + categorias encanador em São Paulo | Verificados < 5 km Mais filtros Ex: Busque ''encanador em São Paulo'' Buscar prestadores" [ref=e486] [cursor=pointer]':
                - generic [ref=e488]:
                  - generic [ref=e490]: "1"
                  - img [ref=e493]
                  - heading "Busque o serviço" [level=3] [ref=e496]
                  - paragraph [ref=e497]: Encontre prestadores verificados perto de você.
                  - generic [ref=e499]:
                    - generic [ref=e500]: "50"
                    - text: +
                    - generic [ref=e501]: categorias
                  - generic [ref=e503]:
                    - generic [ref=e504]:
                      - img [ref=e505]
                      - generic [ref=e508]: encanador em São Paulo
                      - generic [ref=e509]: "|"
                    - generic [ref=e510]:
                      - generic [ref=e511]: Verificados
                      - generic [ref=e512]: < 5 km
                      - generic [ref=e513]:
                        - img [ref=e514]
                        - text: Mais filtros
                  - paragraph [ref=e516]: "Ex: Busque 'encanador em São Paulo'"
                  - button "Buscar prestadores" [ref=e517]:
                    - text: Buscar prestadores
                    - img
              - 'button "2 Compare orçamentos Receba e compare propostas lado a lado. 3 orçamentos em 24h João S. R$ 180 Maria L. R$ 150 Melhor avaliação Compare lado a lado Ex: Compare 3 orçamentos em 24h Sem compromisso Pedir orçamento" [ref=e518] [cursor=pointer]':
                - generic [ref=e520]:
                  - generic [ref=e522]: "2"
                  - img [ref=e525]
                  - heading "Compare orçamentos" [level=3] [ref=e530]
                  - paragraph [ref=e531]: Receba e compare propostas lado a lado.
                  - generic [ref=e533]:
                    - generic [ref=e534]: "3"
                    - generic [ref=e535]: orçamentos em 24h
                  - generic [ref=e537]:
                    - generic [ref=e538]:
                      - generic [ref=e539]:
                        - generic [ref=e542]: João S.
                        - generic [ref=e543]:
                          - img [ref=e544]
                          - img [ref=e546]
                          - img [ref=e548]
                          - img [ref=e550]
                          - img [ref=e552]
                        - generic [ref=e554]: R$ 180
                      - generic [ref=e555]:
                        - generic [ref=e558]: Maria L.
                        - generic [ref=e559]:
                          - img [ref=e560]
                          - img [ref=e562]
                          - img [ref=e564]
                          - img [ref=e566]
                          - img [ref=e568]
                        - generic [ref=e570]: R$ 150
                        - generic [ref=e571]: Melhor avaliação
                    - generic [ref=e572]:
                      - img [ref=e573]
                      - text: Compare lado a lado
                  - paragraph [ref=e578]: "Ex: Compare 3 orçamentos em 24h"
                  - generic [ref=e579]:
                    - img [ref=e580]
                    - text: Sem compromisso
                  - button "Pedir orçamento" [ref=e585]:
                    - text: Pedir orçamento
                    - img
              - 'button "3 Agende com confiança Solicite um orçamento ou agende diretamente. 24 h para confirmar Março 2025 S T Q Q S S D 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 12 Mar, 14:00 — Confirmado Ex: Agende para amanhã às 14h Agendar agora" [ref=e586] [cursor=pointer]':
                - generic [ref=e588]:
                  - generic [ref=e590]: "3"
                  - img [ref=e593]
                  - heading "Agende com confiança" [level=3] [ref=e596]
                  - paragraph [ref=e597]: Solicite um orçamento ou agende diretamente.
                  - generic [ref=e599]:
                    - generic [ref=e600]: "24"
                    - text: h
                    - generic [ref=e601]: para confirmar
                  - generic [ref=e604]:
                    - generic [ref=e605]: Março 2025
                    - generic [ref=e606]:
                      - generic [ref=e607]: S
                      - generic [ref=e608]: T
                      - generic [ref=e609]: Q
                      - generic [ref=e610]: Q
                      - generic [ref=e611]: S
                      - generic [ref=e612]: S
                      - generic [ref=e613]: D
                      - generic [ref=e614]: "1"
                      - generic [ref=e615]: "2"
                      - generic [ref=e616]: "3"
                      - generic [ref=e617]: "4"
                      - generic [ref=e618]: "5"
                      - generic [ref=e619]: "6"
                      - generic [ref=e620]: "7"
                      - generic [ref=e621]: "8"
                      - generic [ref=e622]: "9"
                      - generic [ref=e623]: "10"
                      - generic [ref=e624]: "11"
                      - generic [ref=e625]: "12"
                      - generic [ref=e626]: "13"
                      - generic [ref=e627]: "14"
                      - generic [ref=e628]: "15"
                    - generic [ref=e629]:
                      - img [ref=e630]
                      - generic [ref=e633]: 12 Mar, 14:00 — Confirmado
                  - paragraph [ref=e634]: "Ex: Agende para amanhã às 14h"
                  - button "Agendar agora" [ref=e635]:
                    - text: Agendar agora
                    - img
              - 'button "4 Avalie o resultado Sua opinião mantém a qualidade da comunidade. 98 % satisfação 4.0 \"Excelente trabalho, recomendo!\" Avaliação verificada Ex: Avalie de 1 a 5 estrelas com comentário Cadastrar grátis" [ref=e636] [cursor=pointer]':
                - generic [ref=e638]:
                  - generic [ref=e640]: "4"
                  - img [ref=e643]
                  - heading "Avalie o resultado" [level=3] [ref=e645]
                  - paragraph [ref=e646]: Sua opinião mantém a qualidade da comunidade.
                  - generic [ref=e648]:
                    - generic [ref=e649]: "98"
                    - text: "%"
                    - generic [ref=e650]: satisfação
                  - generic [ref=e652]:
                    - generic [ref=e653]:
                      - generic [ref=e654]:
                        - img [ref=e655]
                        - img [ref=e657]
                        - img [ref=e659]
                        - img [ref=e661]
                        - img [ref=e663]
                        - generic [ref=e665]: "4.0"
                      - paragraph [ref=e668]: "\"Excelente trabalho, recomendo!\""
                    - generic [ref=e669]:
                      - img [ref=e670]
                      - text: Avaliação verificada
                  - paragraph [ref=e673]: "Ex: Avalie de 1 a 5 estrelas com comentário"
                  - button "Cadastrar grátis" [ref=e674]:
                    - text: Cadastrar grátis
                    - img
          - generic [ref=e675]:
            - generic [ref=e676]:
              - img [ref=e677]
              - generic [ref=e680]: Garantia Severinno
            - generic [ref=e681]:
              - generic [ref=e682]:
                - img [ref=e683]
                - generic [ref=e686]: Prestadores verificados
              - generic [ref=e687]:
                - img [ref=e688]
                - generic [ref=e691]: Resposta rápida
              - generic [ref=e692]:
                - img [ref=e693]
                - generic [ref=e695]: Satisfação garantida
              - generic [ref=e696]:
                - img [ref=e697]
                - generic [ref=e702]: Compare antes de contratar
          - generic [ref=e703]:
            - button "Começar agora" [ref=e704]:
              - text: Começar agora
              - img
            - link "Buscar prestadores" [ref=e705] [cursor=pointer]:
              - /url: "#vitrine-resultados"
              - img
              - text: Buscar prestadores
          - button "Voltar ao topo" [ref=e707]:
            - img [ref=e708]
            - text: Voltar ao topo
      - generic [ref=e711]:
        - generic [ref=e712]:
          - generic [ref=e713]:
            - img
            - text: Simulador de preços
          - heading "Quanto custa? Simule agora" [level=2] [ref=e714]
          - paragraph [ref=e715]: Estime o valor do serviço em 3 passos rápidos. Sem compromisso, sem cadastro.
        - generic [ref=e716]:
          - generic [ref=e717]: "1"
          - generic [ref=e719]: "2"
          - generic [ref=e721]: "3"
        - generic [ref=e724]:
          - heading "1. Qual serviço você precisa?" [level=3] [ref=e725]
          - paragraph [ref=e726]: Selecione a categoria do serviço
          - generic [ref=e727]:
            - button "Elétrica" [ref=e728]:
              - img [ref=e730]
              - generic [ref=e732]: Elétrica
            - button "Hidráulica" [ref=e733]:
              - img [ref=e735]
              - generic [ref=e738]: Hidráulica
            - button "Pintura" [ref=e739]:
              - img [ref=e741]
              - generic [ref=e745]: Pintura
            - button "Alvenaria" [ref=e746]:
              - img [ref=e748]
              - generic [ref=e750]: Alvenaria
            - button "Pisos" [ref=e751]:
              - img [ref=e753]
              - generic [ref=e755]: Pisos
            - button "Pós-obra" [ref=e756]:
              - img [ref=e758]
              - generic [ref=e763]: Pós-obra
            - button "Residencial" [ref=e764]:
              - img [ref=e766]
              - generic [ref=e769]: Residencial
      - region "Parceiros e imprensa" [ref=e770]:
        - generic [ref=e771]:
          - paragraph [ref=e773]: Referência no mercado
          - generic [ref=e775]:
            - generic [ref=e778]: G1
            - generic [ref=e781]: Folha de S.Paulo
            - generic [ref=e784]: Valor Econômico
            - generic [ref=e787]: Exame
            - generic [ref=e790]: InfoMoney
            - generic [ref=e793]: Startups
            - generic [ref=e796]: Sebrae
            - generic [ref=e799]: ABES
          - paragraph [ref=e800]: + de 6.000 prestadores confiam no Severinno
      - region "Avaliações de clientes" [ref=e801]:
        - generic:
          - generic:
            - img
        - generic [ref=e803]:
          - generic [ref=e804]:
            - img [ref=e805]
            - text: Avaliações reais
          - heading "O que nossos clientes dizem" [level=2] [ref=e807]
          - paragraph [ref=e808]: Avaliações de clientes após a conclusão do serviço.
      - generic [ref=e873]:
        - generic [ref=e876]:
          - generic [ref=e877]:
            - img [ref=e879]
            - paragraph [ref=e886]: Prestadores verificados
          - generic [ref=e887]:
            - img [ref=e889]
            - paragraph [ref=e893]: Serviços cadastrados
          - generic [ref=e894]:
            - img [ref=e896]
            - paragraph [ref=e901]: Serviços concluídos
          - generic [ref=e902]:
            - img [ref=e904]
            - paragraph [ref=e908]: Nota média
        - generic [ref=e910]:
          - generic [ref=e911]:
            - generic [ref=e912]:
              - img [ref=e913]
              - text: Por que Severinno?
            - heading "Confiança em cada agendamento" [level=2] [ref=e916]
            - paragraph [ref=e917]: Mais que um diretório de serviços — um ecossistema pensado para proteger você e o prestador. Da verificação ao pagamento, cada etapa foi desenhada para a sua tranquilidade.
            - link "Pular para FAQ" [ref=e919] [cursor=pointer]:
              - /url: "#faq"
              - img [ref=e920]
              - text: Pular para FAQ
          - generic [ref=e923]:
            - generic [ref=e926]:
              - generic [ref=e927]:
                - img [ref=e929]
                - button "Saiba mais sobre Prestadores verificados" [ref=e932]:
                  - img [ref=e933]
              - heading "Prestadores verificados" [level=3] [ref=e936]
              - paragraph [ref=e937]: João verificou 3 documentos antes de aprovar o prestador. Você só vê profissionais validados.
              - button "Saiba mais" [ref=e938]:
                - text: Saiba mais
                - img [ref=e939]
            - generic [ref=e943]:
              - generic [ref=e944]:
                - img [ref=e946]
                - button "Saiba mais sobre Pagamento protegido" [ref=e949]:
                  - img [ref=e950]
              - heading "Pagamento protegido" [level=3] [ref=e953]
              - paragraph [ref=e954]: O valor só é liberado ao prestador após você confirmar que ficou satisfeito com o serviço.
              - button "Saiba mais" [ref=e955]:
                - text: Saiba mais
                - img [ref=e956]
            - generic [ref=e960]:
              - generic [ref=e961]:
                - img [ref=e963]
                - button "Saiba mais sobre Resposta rápida" [ref=e966]:
                  - img [ref=e967]
              - heading "Resposta rápida" [level=3] [ref=e970]
              - paragraph [ref=e971]: Prestadores comprometidos a responder em até 24h. Acompanhe o status em tempo real.
              - button "Saiba mais" [ref=e972]:
                - text: Saiba mais
                - img [ref=e973]
            - generic [ref=e977]:
              - generic [ref=e978]:
                - img [ref=e980]
                - button "Saiba mais sobre Avaliações reais" [ref=e982]:
                  - img [ref=e983]
              - heading "Avaliações reais" [level=3] [ref=e986]
              - paragraph [ref=e987]: Apenas clientes que concluíram o serviço podem avaliar. Sem falsas avaliações.
              - button "Saiba mais" [ref=e988]:
                - text: Saiba mais
                - img [ref=e989]
            - generic [ref=e993]:
              - generic [ref=e994]:
                - img [ref=e996]
                - button "Saiba mais sobre Próximo de você" [ref=e999]:
                  - img [ref=e1000]
              - heading "Próximo de você" [level=3] [ref=e1003]
              - paragraph [ref=e1004]: Geolocalização inteligente mostra os melhores prestadores na sua região.
              - button "Saiba mais" [ref=e1005]:
                - text: Saiba mais
                - img [ref=e1006]
            - generic [ref=e1010]:
              - generic [ref=e1011]:
                - img [ref=e1013]
                - button "Saiba mais sobre Suporte humano" [ref=e1015]:
                  - img [ref=e1016]
              - heading "Suporte humano" [level=3] [ref=e1019]
              - paragraph [ref=e1020]: Equipe disponível para mediar disputas, tirar dúvidas e garantir uma experiência justa.
              - button "Saiba mais" [ref=e1021]:
                - text: Saiba mais
                - img [ref=e1022]
        - generic [ref=e1025]:
          - img [ref=e1026]
          - paragraph [ref=e1028]: "Garantia Severinno: seu dinheiro de volta se o serviço não for bem-feito."
          - link "Saiba mais" [ref=e1029] [cursor=pointer]:
            - /url: "#faq"
            - text: Saiba mais
            - img [ref=e1030]
      - generic [ref=e1034]:
        - generic [ref=e1035]:
          - img [ref=e1036]
          - text: Destaque da semana
        - heading "Profissional em destaque" [level=2] [ref=e1042]
        - paragraph [ref=e1043]: Conheça um dos nossos prestadores mais bem avaliados.
      - generic [ref=e1076]:
        - generic [ref=e1077]:
          - generic [ref=e1078]:
            - generic [ref=e1079]:
              - img [ref=e1080]
              - text: Perguntas frequentes
            - heading "Tire suas dúvidas antes de contratar" [level=2] [ref=e1083]
            - paragraph [ref=e1084]: Reunimos as perguntas mais comuns sobre como o Severinno funciona — do cadastro ao pagamento.
          - generic [ref=e1085]:
            - img [ref=e1086]
            - textbox "Buscar nas perguntas frequentes" [ref=e1089]:
              - /placeholder: Buscar nas dúvidas…
          - generic [ref=e1090]:
            - paragraph [ref=e1091]: Filtrar por categoria
            - generic [ref=e1092]:
              - button "Filtrar por Geral" [ref=e1093]:
                - img [ref=e1094]
                - text: Geral
                - generic [ref=e1097]: (2)
              - button "Filtrar por Pagamento" [ref=e1098]:
                - img [ref=e1099]
                - text: Pagamento
                - generic [ref=e1101]: (2)
              - button "Filtrar por Agendamento" [ref=e1102]:
                - img [ref=e1103]
                - text: Agendamento
                - generic [ref=e1105]: (2)
              - button "Filtrar por Prestadores" [ref=e1106]:
                - img [ref=e1107]
                - text: Prestadores
                - generic [ref=e1111]: (2)
              - button "Filtrar por Segurança" [ref=e1112]:
                - img [ref=e1113]
                - text: Segurança
                - generic [ref=e1116]: (2)
          - generic [ref=e1117]:
            - paragraph [ref=e1118]: Perguntas mais frequentes
            - list [ref=e1119]:
              - listitem [ref=e1120]:
                - button "Como funciona o Severinno?" [ref=e1121]:
                  - img [ref=e1122]
                  - generic [ref=e1124]: Como funciona o Severinno?
              - listitem [ref=e1125]:
                - button "Preciso pagar para me cadastrar?" [ref=e1126]:
                  - img [ref=e1127]
                  - generic [ref=e1129]: Preciso pagar para me cadastrar?
              - listitem [ref=e1130]:
                - button "Como faço para agendar um serviço?" [ref=e1131]:
                  - img [ref=e1132]
                  - generic [ref=e1134]: Como faço para agendar um serviço?
              - listitem [ref=e1135]:
                - button "E se o serviço não for bem-feito?" [ref=e1136]:
                  - img [ref=e1137]
                  - generic [ref=e1139]: E se o serviço não for bem-feito?
          - generic [ref=e1141]:
            - img [ref=e1143]
            - generic [ref=e1145]:
              - paragraph [ref=e1146]: Ainda tem dúvidas?
              - paragraph [ref=e1147]: Cadastre-se grátis e converse diretamente com prestadores verificados. Sem compromisso.
              - generic [ref=e1148]:
                - button "Cadastrar grátis" [ref=e1149]
                - link "Fale conosco" [ref=e1150] [cursor=pointer]:
                  - /url: "#faq"
                  - img
                  - text: Fale conosco
        - generic [ref=e1151]:
          - generic [ref=e1153]:
            - generic [ref=e1155]:
              - heading "01 Como funciona o Severinno? Geral" [level=3] [ref=e1156]:
                - button "01 Como funciona o Severinno? Geral" [expanded] [ref=e1157]:
                  - generic [ref=e1158]:
                    - generic [ref=e1159]: "01"
                    - generic [ref=e1160]: Como funciona o Severinno?
                    - generic [ref=e1161]:
                      - img
                      - text: Geral
                  - img
              - region "01 Como funciona o Severinno? Geral" [ref=e1162]:
                - generic [ref=e1164]:
                  - paragraph [ref=e1165]: O Severinno conecta você a prestadores de serviço verificados próximos à sua localização. Você busca o serviço, compara avaliações reais de outros clientes, pede orçamento grátis e agenda — tudo pela plataforma. O pagamento só é liberado após você confirmar a conclusão do serviço.
                  - paragraph [ref=e1166]: "Ex: Maria precisava de um eletricista. Buscou na plataforma, comparou 3 profissionais e contratou o mais bem avaliado — tudo em 5 minutos."
            - heading "02 Preciso pagar para me cadastrar? Geral" [level=3] [ref=e1169]:
              - button "02 Preciso pagar para me cadastrar? Geral" [ref=e1170]:
                - generic [ref=e1171]:
                  - generic [ref=e1172]: "02"
                  - generic [ref=e1173]: Preciso pagar para me cadastrar?
                  - generic [ref=e1174]:
                    - img
                    - text: Geral
                - img
            - heading "03 Como os prestadores são verificados? Prestadores" [level=3] [ref=e1177]:
              - button "03 Como os prestadores são verificados? Prestadores" [ref=e1178]:
                - generic [ref=e1179]:
                  - generic [ref=e1180]: "03"
                  - generic [ref=e1181]: Como os prestadores são verificados?
                  - generic [ref=e1182]:
                    - img
                    - text: Prestadores
                - img
            - heading "04 Posso me tornar um prestador no Severinno? Prestadores" [level=3] [ref=e1185]:
              - button "04 Posso me tornar um prestador no Severinno? Prestadores" [ref=e1186]:
                - generic [ref=e1187]:
                  - generic [ref=e1188]: "04"
                  - generic [ref=e1189]: Posso me tornar um prestador no Severinno?
                  - generic [ref=e1190]:
                    - img
                    - text: Prestadores
                - img
            - heading "05 Como faço para agendar um serviço? Agendamento" [level=3] [ref=e1193]:
              - button "05 Como faço para agendar um serviço? Agendamento" [ref=e1194]:
                - generic [ref=e1195]:
                  - generic [ref=e1196]: "05"
                  - generic [ref=e1197]: Como faço para agendar um serviço?
                  - generic [ref=e1198]:
                    - img
                    - text: Agendamento
                - img
            - heading "06 Posso remarcar ou cancelar um agendamento? Agendamento" [level=3] [ref=e1201]:
              - button "06 Posso remarcar ou cancelar um agendamento? Agendamento" [ref=e1202]:
                - generic [ref=e1203]:
                  - generic [ref=e1204]: "06"
                  - generic [ref=e1205]: Posso remarcar ou cancelar um agendamento?
                  - generic [ref=e1206]:
                    - img
                    - text: Agendamento
                - img
            - heading "07 Como funciona o pagamento? Pagamento" [level=3] [ref=e1209]:
              - button "07 Como funciona o pagamento? Pagamento" [ref=e1210]:
                - generic [ref=e1211]:
                  - generic [ref=e1212]: "07"
                  - generic [ref=e1213]: Como funciona o pagamento?
                  - generic [ref=e1214]:
                    - img
                    - text: Pagamento
                - img
            - heading "08 O orçamento tem compromisso? Pagamento" [level=3] [ref=e1217]:
              - button "08 O orçamento tem compromisso? Pagamento" [ref=e1218]:
                - generic [ref=e1219]:
                  - generic [ref=e1220]: "08"
                  - generic [ref=e1221]: O orçamento tem compromisso?
                  - generic [ref=e1222]:
                    - img
                    - text: Pagamento
                - img
            - heading "09 E se o serviço não for bem-feito? Segurança" [level=3] [ref=e1225]:
              - button "09 E se o serviço não for bem-feito? Segurança" [ref=e1226]:
                - generic [ref=e1227]:
                  - generic [ref=e1228]: "09"
                  - generic [ref=e1229]: E se o serviço não for bem-feito?
                  - generic [ref=e1230]:
                    - img
                    - text: Segurança
                - img
            - heading "10 Meus dados pessoais estão seguros? Segurança" [level=3] [ref=e1233]:
              - button "10 Meus dados pessoais estão seguros? Segurança" [ref=e1234]:
                - generic [ref=e1235]:
                  - generic [ref=e1236]: "10"
                  - generic [ref=e1237]: Meus dados pessoais estão seguros?
                  - generic [ref=e1238]:
                    - img
                    - text: Segurança
                - img
          - generic [ref=e1239]:
            - paragraph [ref=e1240]: 10 de 10 dúvidas
            - button "Voltar ao topo da seção" [ref=e1241]:
              - img [ref=e1242]
              - text: Topo
      - generic [ref=e1246]:
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
        - generic [ref=e1251]:
          - generic [ref=e1252]:
            - generic [ref=e1254]:
              - img [ref=e1255]
              - text: Comece agora mesmo
            - heading "Encontre o serviço que você precisa" [level=2] [ref=e1257]
            - paragraph [ref=e1258]: Navegue pela vitrine, salve seus favoritos e agende com confiança. Tudo em um só lugar.
            - list [ref=e1259]:
              - generic [ref=e1260]:
                - listitem [ref=e1261]:
                  - img [ref=e1262]
                  - text: Cadastro gratuito
                - listitem [ref=e1265]:
                  - img [ref=e1266]
                  - text: Sem taxa de serviço
                - listitem [ref=e1269]:
                  - img [ref=e1270]
                  - text: Orçamento sem compromisso
            - button "Buscar prestadores" [ref=e1278]:
              - img
              - text: Buscar prestadores
              - generic [ref=e1279]:
                - img
          - generic [ref=e1280]:
            - generic [ref=e1281]:
              - heading "O que vem depois?" [level=3] [ref=e1282]
              - paragraph [ref=e1283]: Três passos simples e você estará agendando
              - generic [ref=e1284]:
                - img [ref=e1285]
                - generic [ref=e1286]:
                  - generic [ref=e1287]:
                    - generic [ref=e1289]: "1"
                    - generic [ref=e1290]:
                      - paragraph [ref=e1291]: Cadastre-se grátis
                      - paragraph [ref=e1292]: ~30s
                  - generic [ref=e1293]:
                    - generic [ref=e1295]: "2"
                    - generic [ref=e1296]:
                      - paragraph [ref=e1297]: Busque e compare
                      - paragraph [ref=e1298]: ~2 min
                  - generic [ref=e1299]:
                    - generic [ref=e1301]: "3"
                    - generic [ref=e1302]:
                      - paragraph [ref=e1303]: Agende com confiança
                      - paragraph [ref=e1304]: ~5 min
              - generic [ref=e1305]:
                - generic [ref=e1306]:
                  - img [ref=e1307]
                  - text: Sem compromisso
                - generic [ref=e1311]:
                  - img [ref=e1312]
                  - text: Cancele quando quiser
                - generic [ref=e1315]:
                  - img [ref=e1316]
                  - text: Suporte 24h
              - link "Saiba mais sobre pagamento protegido" [ref=e1319] [cursor=pointer]:
                - /url: "#faq"
                - img [ref=e1320]
                - text: Saiba mais sobre pagamento protegido
            - generic [ref=e1324]:
              - generic [ref=e1328]: Cliente
              - generic [ref=e1329]:
                - img [ref=e1333]
                - generic [ref=e1335]: Prestador
              - img [ref=e1340]
              - img [ref=e1342]
              - img [ref=e1346]
              - img [ref=e1349]
              - img [ref=e1353]
        - generic [ref=e1357]:
          - img [ref=e1358]
          - generic [ref=e1361]:
            - paragraph [ref=e1362]: “Encontrei um encanador em 10 minutos, paguei menos do que esperava e ainda pude avaliar o serviço. Recomendo demais!”
            - paragraph [ref=e1363]: — Ana P., Cliente, São Paulo
        - generic [ref=e1364]:
          - generic [ref=e1365]:
            - img [ref=e1366]
            - text: Sem compromisso
          - generic [ref=e1370]:
            - img [ref=e1371]
            - text: Cancele quando quiser
          - generic [ref=e1374]:
            - img [ref=e1375]
            - text: Pagamento protegido
    - contentinfo [ref=e1377]:
      - generic [ref=e1379]:
        - generic [ref=e1380]:
          - paragraph [ref=e1381]: Receba novidades e dicas de serviços
          - paragraph [ref=e1382]: Cadastre-se e receba ofertas exclusivas. Cancele quando quiser.
        - generic [ref=e1383]:
          - generic [ref=e1384]:
            - img [ref=e1385]
            - textbox "E-mail para newsletter" [ref=e1388]:
              - /placeholder: Seu e-mail
          - button "Assinar" [disabled]:
            - img
            - text: Assinar
      - generic [ref=e1389]:
        - generic [ref=e1390]:
          - generic [ref=e1391]:
            - generic [ref=e1392]:
              - img [ref=e1394]
              - generic [ref=e1397]: Severinno
            - paragraph [ref=e1398]: Marketplace de serviços com geolocalização. Encontre prestadores verificados, próximos e bem avaliados.
            - list "Redes sociais" [ref=e1399]:
              - listitem [ref=e1400]:
                - link "GitHub" [ref=e1401] [cursor=pointer]:
                  - /url: https://github.com
                  - img [ref=e1402]
              - listitem [ref=e1405]:
                - link "Twitter" [ref=e1406] [cursor=pointer]:
                  - /url: https://twitter.com
                  - img [ref=e1407]
              - listitem [ref=e1409]:
                - link "Instagram" [ref=e1410] [cursor=pointer]:
                  - /url: https://instagram.com
                  - img [ref=e1411]
              - listitem [ref=e1414]:
                - link "LinkedIn" [ref=e1415] [cursor=pointer]:
                  - /url: https://linkedin.com
                  - img [ref=e1416]
              - listitem [ref=e1420]:
                - link "E-mail" [ref=e1421] [cursor=pointer]:
                  - /url: mailto:contato@severinno.com
                  - img [ref=e1422]
          - navigation "Sobre" [ref=e1425]:
            - heading "Sobre" [level=3] [ref=e1426]:
              - img [ref=e1427]
              - text: Sobre
            - list [ref=e1430]:
              - listitem [ref=e1431]:
                - button "Como funciona" [ref=e1432]
              - listitem [ref=e1433]:
                - button "Quem somos" [ref=e1434]
              - listitem [ref=e1435]:
                - button "Termos de uso" [ref=e1436]
              - listitem [ref=e1437]:
                - button "Privacidade" [ref=e1438]
          - navigation "Para profissionais" [ref=e1439]:
            - heading "Para profissionais" [level=3] [ref=e1440]:
              - img [ref=e1441]
              - text: Para profissionais
            - list [ref=e1444]:
              - listitem [ref=e1445]:
                - button "Cadastre-se" [ref=e1446]
              - listitem [ref=e1447]:
                - button "Meu painel" [ref=e1448]
              - listitem [ref=e1449]:
                - button "Central de ajuda" [ref=e1450]
          - navigation "Precisa de ajuda?" [ref=e1451]:
            - heading "Precisa de ajuda?" [level=3] [ref=e1452]:
              - img [ref=e1453]
              - text: Precisa de ajuda?
            - list [ref=e1455]:
              - listitem [ref=e1456]:
                - button "Perguntas frequentes" [ref=e1457]
              - listitem [ref=e1458]:
                - button "Segurança" [ref=e1459]
              - listitem [ref=e1460]:
                - button "Reportar problema" [ref=e1461]
          - generic [ref=e1462]:
            - heading "Contato" [level=3] [ref=e1463]:
              - img [ref=e1464]
              - text: Contato
            - list [ref=e1469]:
              - listitem [ref=e1470]:
                - img [ref=e1471]
                - link "contato@severinno.com" [ref=e1474] [cursor=pointer]:
                  - /url: mailto:contato@severinno.com
              - listitem [ref=e1475]:
                - img [ref=e1476]
                - text: São Paulo, Brasil
            - button "Fale conosco" [ref=e1479]:
              - img
              - text: Fale conosco
        - generic [ref=e1480]:
          - paragraph [ref=e1481]: © 2026 Severinno Marketplace. Todos os direitos reservados.
          - paragraph [ref=e1482]:
            - text: Feito com
            - img [ref=e1483]
            - text: usando tecnologia Open Source (
            - link "MapLibre" [ref=e1485] [cursor=pointer]:
              - /url: https://maplibre.org/
            - text: ·
            - link "OpenStreetMap" [ref=e1486] [cursor=pointer]:
              - /url: https://www.openstreetmap.org/copyright
            - text: )
    - button "Voltar ao topo" [ref=e1488]:
      - img
    - button "Abrir assistente virtual" [ref=e1489]:
      - img [ref=e1490]
    - generic [ref=e1494]:
      - generic [ref=e1495]:
        - img [ref=e1497]
        - generic [ref=e1499]:
          - paragraph [ref=e1500]: Usamos cookies para melhorar sua experiência
          - paragraph [ref=e1501]:
            - text: Utilizamos cookies essenciais para o funcionamento do site e cookies de análise para melhorar nossos serviços.
            - button "Política de privacidade" [ref=e1502]
      - generic [ref=e1503]:
        - button "Recusar" [ref=e1504]
        - button "Aceitar" [ref=e1505]:
          - img
          - text: Aceitar
        - button "Dispensar" [ref=e1506]:
          - img [ref=e1507]
  - region "Notifications alt+T"
  - generic [active]:
    - generic [ref=e1512]:
      - generic [ref=e1513]:
        - generic [ref=e1514]:
          - navigation [ref=e1515]:
            - button "previous" [disabled] [ref=e1516]:
              - img "previous" [ref=e1517]
            - generic [ref=e1519]:
              - generic [ref=e1520]: 1/
              - text: "1"
            - button "next" [disabled] [ref=e1521]:
              - img "next" [ref=e1522]
          - img
        - generic [ref=e1524]:
          - link "Next.js 16.1.3 (stale) Turbopack" [ref=e1525] [cursor=pointer]:
            - /url: https://nextjs.org/docs/messages/version-staleness
            - img [ref=e1526]
            - generic "There is a newer version (16.2.11) available, upgrade recommended!" [ref=e1528]: Next.js 16.1.3 (stale)
            - generic [ref=e1529]: Turbopack
          - img
      - dialog "Build Error" [ref=e1531]:
        - generic [ref=e1534]:
          - generic [ref=e1535]:
            - generic [ref=e1536]:
              - generic [ref=e1538]: Build Error
              - generic [ref=e1539]:
                - button "Copy Error Info" [ref=e1540] [cursor=pointer]:
                  - img [ref=e1541]
                - button "No related documentation found" [disabled] [ref=e1543]:
                  - img [ref=e1544]
                - button "Attach Node.js inspector" [ref=e1546] [cursor=pointer]:
                  - img [ref=e1547]
            - generic [ref=e1556]: Reading source code for parsing failed
          - generic [ref=e1558]:
            - generic [ref=e1560]:
              - img [ref=e1562]
              - generic [ref=e1566]: ./.freebuff/worktrees/thmrzp9vv9y86o/src/lib/api-server.ts
              - button "Open in editor" [ref=e1567] [cursor=pointer]:
                - img [ref=e1569]
            - generic [ref=e1573]: "Reading source code for parsing failed An unexpected error happened while trying to read the source code to parse: failed to convert rope into string Caused by: - invalid utf-8 sequence of 1 bytes from index 5415 Import trace: App Route: ./.freebuff/worktrees/thmrzp9vv9y86o/src/lib/api-server.ts ./.freebuff/worktrees/thmrzp9vv9y86o/src/app/api/auth/me/route.ts"
        - generic [ref=e1574]: "1"
        - generic [ref=e1575]: "2"
    - generic [ref=e1580] [cursor=pointer]:
      - button "Open Next.js Dev Tools" [ref=e1581]:
        - img [ref=e1582]
      - button "Open issues overlay" [ref=e1586]:
        - generic [ref=e1587]:
          - generic [ref=e1588]: "0"
          - generic [ref=e1589]: "1"
        - generic [ref=e1590]: Issue
  - alert [ref=e1591]
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