# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: quote-flow.spec.ts >> QuoteModal — UX e Navegação >> 16. fechar e reabrir modal preserva estado inicial
- Location: e2e\quote-flow.spec.ts:572:7

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
    2 × waiting for element to be visible, enabled and stable
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
    - waiting for element to be visible, enabled and stable
    - element is visible, enabled and stable
    - scrolling into view if needed
    - done scrolling
    - <nextjs-portal></nextjs-portal> from <script data-nextjs-dev-overlay="true">…</script> subtree intercepts pointer events
  - retrying click action
    - waiting for element to be visible, enabled and stable
    - element is visible, enabled and stable
    - scrolling into view if needed
    - done scrolling

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
              - button "Ver 3 resultados" [disabled]
          - generic [ref=e353]:
            - generic [ref=e355]:
              - generic [ref=e356]:
                - heading "3 prestadores encontrados" [level=2] [ref=e357]
                - paragraph [ref=e358]: Exibindo 1–3 de 3
              - generic [ref=e359]:
                - generic [ref=e360]:
                  - text: "Ordenado por:"
                  - generic [ref=e361]: Melhor avaliação
                - tablist "Visualização" [ref=e362]:
                  - tab "Lista" [selected] [ref=e363]:
                    - img [ref=e364]
                    - generic [ref=e365]: Lista
                  - tab "Mapa" [ref=e366]:
                    - img [ref=e367]
                    - generic [ref=e369]: Mapa
            - generic [ref=e371]:
              - generic [ref=e373]:
                - generic [ref=e374]:
                  - img "Capa de Maria Silva" [ref=e375]
                  - generic [ref=e377]:
                    - img [ref=e378]
                    - text: Verificado
                  - generic [ref=e381]:
                    - button "Adicionar Maria Silva à comparação" [ref=e382]:
                      - img [ref=e383]
                    - button "Adicionar Maria Silva aos favoritos" [ref=e388]:
                      - img [ref=e389]
                  - img "Maria Silva" [ref=e393]
                - generic [ref=e394]:
                  - generic [ref=e395]:
                    - button "Ver perfil de Maria Silva" [ref=e396]:
                      - heading "Maria Silva" [level=3] [ref=e397]:
                        - generic [ref=e398]: Maria Silva
                        - img [ref=e399]
                    - generic "Avaliação média" [ref=e401]:
                      - img [ref=e402]
                      - text: "4.8"
                      - generic [ref=e404]: (42)
                  - paragraph [ref=e405]: a partir de R$ 120,00
                  - generic [ref=e406]:
                    - generic [ref=e407]:
                      - img [ref=e408]
                      - text: 2,5 km
                    - generic [ref=e411]:
                      - img [ref=e412]
                      - text: São Paulo
                  - paragraph [ref=e415]: Especialista em instalações elétricas residenciais com mais de 10 anos de experiência.
                  - generic [ref=e416]:
                    - generic "Serviços concluídos com sucesso" [ref=e417]:
                      - img [ref=e418]
                      - text: 230 serviços concluídos
                    - generic "Na plataforma desde" [ref=e421]:
                      - img [ref=e422]
                      - text: desde jan. de 2023
                - generic [ref=e426]:
                  - generic [ref=e427]:
                    - img [ref=e428]
                    - generic [ref=e430]: Instalação Elétrica · a partir de R$ 120,00
                  - heading "Elétrica 1 serviço" [level=3] [ref=e433]:
                    - button "Elétrica 1 serviço" [ref=e434]:
                      - generic [ref=e436]:
                        - paragraph [ref=e437]: Elétrica
                        - paragraph [ref=e438]: 1 serviço
                      - img
                - generic [ref=e439]:
                  - button "Orçamento" [ref=e440]:
                    - img
                    - text: Orçamento
                  - button "Agendar" [ref=e441]:
                    - img
                    - text: Agendar
              - generic [ref=e443]:
                - generic [ref=e444]:
                  - img "Capa de João Pedreiro" [ref=e445]
                  - generic [ref=e447]:
                    - img [ref=e448]
                    - text: Verificado
                  - generic [ref=e451]:
                    - button "Adicionar João Pedreiro à comparação" [ref=e452]:
                      - img [ref=e453]
                    - button "Adicionar João Pedreiro aos favoritos" [ref=e458]:
                      - img [ref=e459]
                  - img "João Pedreiro" [ref=e463]
                - generic [ref=e464]:
                  - generic [ref=e465]:
                    - button "Ver perfil de João Pedreiro" [ref=e466]:
                      - heading "João Pedreiro" [level=3] [ref=e467]:
                        - generic [ref=e468]: João Pedreiro
                        - img [ref=e469]
                    - generic "Avaliação média" [ref=e471]:
                      - img [ref=e472]
                      - text: "4.8"
                      - generic [ref=e474]: (42)
                  - paragraph [ref=e475]: a partir de R$ 120,00
                  - generic [ref=e476]:
                    - generic [ref=e477]:
                      - img [ref=e478]
                      - text: 2,5 km
                    - generic [ref=e481]:
                      - img [ref=e482]
                      - text: São Paulo
                  - paragraph [ref=e485]: Especialista em instalações elétricas residenciais com mais de 10 anos de experiência.
                  - generic [ref=e486]:
                    - generic "Serviços concluídos com sucesso" [ref=e487]:
                      - img [ref=e488]
                      - text: 230 serviços concluídos
                    - generic "Na plataforma desde" [ref=e491]:
                      - img [ref=e492]
                      - text: desde jan. de 2023
                - generic [ref=e496]:
                  - generic [ref=e497]:
                    - img [ref=e498]
                    - generic [ref=e500]: Instalação Elétrica · a partir de R$ 120,00
                  - heading "Construção 1 serviço" [level=3] [ref=e503]:
                    - button "Construção 1 serviço" [ref=e504]:
                      - generic [ref=e506]:
                        - paragraph [ref=e507]: Construção
                        - paragraph [ref=e508]: 1 serviço
                      - img
                - generic [ref=e509]:
                  - button "Orçamento" [ref=e510]:
                    - img
                    - text: Orçamento
                  - button "Agendar" [ref=e511]:
                    - img
                    - text: Agendar
              - generic [ref=e513]:
                - generic [ref=e514]:
                  - img "Capa de Ana Pintora" [ref=e515]
                  - generic [ref=e517]:
                    - img [ref=e518]
                    - text: Verificado
                  - generic [ref=e521]:
                    - button "Adicionar Ana Pintora à comparação" [ref=e522]:
                      - img [ref=e523]
                    - button "Adicionar Ana Pintora aos favoritos" [ref=e528]:
                      - img [ref=e529]
                  - img "Ana Pintora" [ref=e533]
                - generic [ref=e534]:
                  - generic [ref=e535]:
                    - button "Ver perfil de Ana Pintora" [ref=e536]:
                      - heading "Ana Pintora" [level=3] [ref=e537]:
                        - generic [ref=e538]: Ana Pintora
                        - img [ref=e539]
                    - generic "Avaliação média" [ref=e541]:
                      - img [ref=e542]
                      - text: "4.8"
                      - generic [ref=e544]: (42)
                  - paragraph [ref=e545]: a partir de R$ 120,00
                  - generic [ref=e546]:
                    - generic [ref=e547]:
                      - img [ref=e548]
                      - text: 2,5 km
                    - generic [ref=e551]:
                      - img [ref=e552]
                      - text: São Paulo
                  - paragraph [ref=e555]: Especialista em instalações elétricas residenciais com mais de 10 anos de experiência.
                  - generic [ref=e556]:
                    - generic "Serviços concluídos com sucesso" [ref=e557]:
                      - img [ref=e558]
                      - text: 230 serviços concluídos
                    - generic "Na plataforma desde" [ref=e561]:
                      - img [ref=e562]
                      - text: desde jan. de 2023
                - generic [ref=e566]:
                  - generic [ref=e567]:
                    - img [ref=e568]
                    - generic [ref=e570]: Instalação Elétrica · a partir de R$ 120,00
                  - heading "Pintura 1 serviço" [level=3] [ref=e573]:
                    - button "Pintura 1 serviço" [ref=e574]:
                      - generic [ref=e576]:
                        - paragraph [ref=e577]: Pintura
                        - paragraph [ref=e578]: 1 serviço
                      - img
                - generic [ref=e579]:
                  - button "Orçamento" [ref=e580]:
                    - img
                    - text: Orçamento
                  - button "Agendar" [ref=e581]:
                    - img
                    - text: Agendar
      - region "Como funciona" [ref=e582]:
        - generic [ref=e587]:
          - generic [ref=e588]:
            - link "Pular para resultados" [ref=e589] [cursor=pointer]:
              - /url: "#vitrine-resultados"
              - img [ref=e590]
              - text: Pular para resultados
            - generic [ref=e594]:
              - img [ref=e595]
              - generic [ref=e597]: "4"
              - text: passos simples
            - heading "Como funciona" [level=2] [ref=e598]
            - paragraph [ref=e599]: Sem surpresas — do início ao fim, você tem o controle.
            - generic [ref=e600]:
              - img [ref=e601]
              - text: Sem compromisso
          - generic [ref=e607]:
            - img [ref=e609]
            - generic [ref=e610]:
              - 'button "1 Busque o serviço Encontre prestadores verificados perto de você. 50 + categorias encanador em São Paulo | Verificados < 5 km Mais filtros Ex: Busque ''encanador em São Paulo'' Buscar prestadores" [ref=e611] [cursor=pointer]':
                - generic [ref=e613]:
                  - generic [ref=e615]: "1"
                  - img [ref=e618]
                  - heading "Busque o serviço" [level=3] [ref=e621]
                  - paragraph [ref=e622]: Encontre prestadores verificados perto de você.
                  - generic [ref=e624]:
                    - generic [ref=e625]: "50"
                    - text: +
                    - generic [ref=e626]: categorias
                  - generic [ref=e628]:
                    - generic [ref=e629]:
                      - img [ref=e630]
                      - generic [ref=e633]: encanador em São Paulo
                      - generic [ref=e634]: "|"
                    - generic [ref=e635]:
                      - generic [ref=e636]: Verificados
                      - generic [ref=e637]: < 5 km
                      - generic [ref=e638]:
                        - img [ref=e639]
                        - text: Mais filtros
                  - paragraph [ref=e641]: "Ex: Busque 'encanador em São Paulo'"
                  - button "Buscar prestadores" [ref=e642]:
                    - text: Buscar prestadores
                    - img
              - 'button "2 Compare orçamentos Receba e compare propostas lado a lado. 3 orçamentos em 24h João S. R$ 180 Maria L. R$ 150 Melhor avaliação Compare lado a lado Ex: Compare 3 orçamentos em 24h Sem compromisso Pedir orçamento" [ref=e643] [cursor=pointer]':
                - generic [ref=e645]:
                  - generic [ref=e647]: "2"
                  - img [ref=e650]
                  - heading "Compare orçamentos" [level=3] [ref=e655]
                  - paragraph [ref=e656]: Receba e compare propostas lado a lado.
                  - generic [ref=e658]:
                    - generic [ref=e659]: "3"
                    - generic [ref=e660]: orçamentos em 24h
                  - generic [ref=e662]:
                    - generic [ref=e663]:
                      - generic [ref=e664]:
                        - generic [ref=e667]: João S.
                        - generic [ref=e668]:
                          - img [ref=e669]
                          - img [ref=e671]
                          - img [ref=e673]
                          - img [ref=e675]
                          - img [ref=e677]
                        - generic [ref=e679]: R$ 180
                      - generic [ref=e680]:
                        - generic [ref=e683]: Maria L.
                        - generic [ref=e684]:
                          - img [ref=e685]
                          - img [ref=e687]
                          - img [ref=e689]
                          - img [ref=e691]
                          - img [ref=e693]
                        - generic [ref=e695]: R$ 150
                        - generic [ref=e696]: Melhor avaliação
                    - generic [ref=e697]:
                      - img [ref=e698]
                      - text: Compare lado a lado
                  - paragraph [ref=e703]: "Ex: Compare 3 orçamentos em 24h"
                  - generic [ref=e704]:
                    - img [ref=e705]
                    - text: Sem compromisso
                  - button "Pedir orçamento" [ref=e710]:
                    - text: Pedir orçamento
                    - img
              - 'button "3 Agende com confiança Solicite um orçamento ou agende diretamente. 24 h para confirmar Março 2025 S T Q Q S S D 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 12 Mar, 14:00 — Confirmado Ex: Agende para amanhã às 14h Agendar agora" [ref=e711] [cursor=pointer]':
                - generic [ref=e713]:
                  - generic [ref=e715]: "3"
                  - img [ref=e718]
                  - heading "Agende com confiança" [level=3] [ref=e721]
                  - paragraph [ref=e722]: Solicite um orçamento ou agende diretamente.
                  - generic [ref=e724]:
                    - generic [ref=e725]: "24"
                    - text: h
                    - generic [ref=e726]: para confirmar
                  - generic [ref=e729]:
                    - generic [ref=e730]: Março 2025
                    - generic [ref=e731]:
                      - generic [ref=e732]: S
                      - generic [ref=e733]: T
                      - generic [ref=e734]: Q
                      - generic [ref=e735]: Q
                      - generic [ref=e736]: S
                      - generic [ref=e737]: S
                      - generic [ref=e738]: D
                      - generic [ref=e739]: "1"
                      - generic [ref=e740]: "2"
                      - generic [ref=e741]: "3"
                      - generic [ref=e742]: "4"
                      - generic [ref=e743]: "5"
                      - generic [ref=e744]: "6"
                      - generic [ref=e745]: "7"
                      - generic [ref=e746]: "8"
                      - generic [ref=e747]: "9"
                      - generic [ref=e748]: "10"
                      - generic [ref=e749]: "11"
                      - generic [ref=e750]: "12"
                      - generic [ref=e751]: "13"
                      - generic [ref=e752]: "14"
                      - generic [ref=e753]: "15"
                    - generic [ref=e754]:
                      - img [ref=e755]
                      - generic [ref=e758]: 12 Mar, 14:00 — Confirmado
                  - paragraph [ref=e759]: "Ex: Agende para amanhã às 14h"
                  - button "Agendar agora" [ref=e760]:
                    - text: Agendar agora
                    - img
              - 'button "4 Avalie o resultado Sua opinião mantém a qualidade da comunidade. 98 % satisfação 4.0 \"Excelente trabalho, recomendo!\" Avaliação verificada Ex: Avalie de 1 a 5 estrelas com comentário Cadastrar grátis" [ref=e761] [cursor=pointer]':
                - generic [ref=e763]:
                  - generic [ref=e765]: "4"
                  - img [ref=e768]
                  - heading "Avalie o resultado" [level=3] [ref=e770]
                  - paragraph [ref=e771]: Sua opinião mantém a qualidade da comunidade.
                  - generic [ref=e773]:
                    - generic [ref=e774]: "98"
                    - text: "%"
                    - generic [ref=e775]: satisfação
                  - generic [ref=e777]:
                    - generic [ref=e778]:
                      - generic [ref=e779]:
                        - img [ref=e780]
                        - img [ref=e782]
                        - img [ref=e784]
                        - img [ref=e786]
                        - img [ref=e788]
                        - generic [ref=e790]: "4.0"
                      - paragraph [ref=e793]: "\"Excelente trabalho, recomendo!\""
                    - generic [ref=e794]:
                      - img [ref=e795]
                      - text: Avaliação verificada
                  - paragraph [ref=e798]: "Ex: Avalie de 1 a 5 estrelas com comentário"
                  - button "Cadastrar grátis" [ref=e799]:
                    - text: Cadastrar grátis
                    - img
          - generic [ref=e800]:
            - generic [ref=e801]:
              - img [ref=e802]
              - generic [ref=e805]: Garantia Severinno
            - generic [ref=e806]:
              - generic [ref=e807]:
                - img [ref=e808]
                - generic [ref=e811]: Prestadores verificados
              - generic [ref=e812]:
                - img [ref=e813]
                - generic [ref=e816]: Resposta rápida
              - generic [ref=e817]:
                - img [ref=e818]
                - generic [ref=e820]: Satisfação garantida
              - generic [ref=e821]:
                - img [ref=e822]
                - generic [ref=e827]: Compare antes de contratar
          - generic [ref=e828]:
            - button "Começar agora" [ref=e829]:
              - text: Começar agora
              - img
            - link "Buscar prestadores" [ref=e830] [cursor=pointer]:
              - /url: "#vitrine-resultados"
              - img
              - text: Buscar prestadores
          - button "Voltar ao topo" [ref=e832]:
            - img [ref=e833]
            - text: Voltar ao topo
      - generic [ref=e836]:
        - generic [ref=e837]:
          - generic [ref=e838]:
            - img
            - text: Simulador de preços
          - heading "Quanto custa? Simule agora" [level=2] [ref=e839]
          - paragraph [ref=e840]: Estime o valor do serviço em 3 passos rápidos. Sem compromisso, sem cadastro.
        - generic [ref=e841]:
          - generic [ref=e842]: "1"
          - generic [ref=e844]: "2"
          - generic [ref=e846]: "3"
        - generic [ref=e849]:
          - heading "1. Qual serviço você precisa?" [level=3] [ref=e850]
          - paragraph [ref=e851]: Selecione a categoria do serviço
          - generic [ref=e852]:
            - button "Elétrica" [ref=e853]:
              - img [ref=e855]
              - generic [ref=e857]: Elétrica
            - button "Hidráulica" [ref=e858]:
              - img [ref=e860]
              - generic [ref=e863]: Hidráulica
            - button "Pintura" [ref=e864]:
              - img [ref=e866]
              - generic [ref=e870]: Pintura
            - button "Alvenaria" [ref=e871]:
              - img [ref=e873]
              - generic [ref=e875]: Alvenaria
            - button "Pisos" [ref=e876]:
              - img [ref=e878]
              - generic [ref=e880]: Pisos
            - button "Pós-obra" [ref=e881]:
              - img [ref=e883]
              - generic [ref=e888]: Pós-obra
            - button "Residencial" [ref=e889]:
              - img [ref=e891]
              - generic [ref=e894]: Residencial
      - region "Parceiros e imprensa" [ref=e895]:
        - generic [ref=e896]:
          - paragraph [ref=e898]: Referência no mercado
          - generic [ref=e900]:
            - generic [ref=e903]: G1
            - generic [ref=e906]: Folha de S.Paulo
            - generic [ref=e909]: Valor Econômico
            - generic [ref=e912]: Exame
            - generic [ref=e915]: InfoMoney
            - generic [ref=e918]: Startups
            - generic [ref=e921]: Sebrae
            - generic [ref=e924]: ABES
          - paragraph [ref=e925]: + de 6.000 prestadores confiam no Severinno
      - region "Avaliações de clientes" [ref=e926]:
        - generic:
          - generic:
            - img
        - generic [ref=e928]:
          - generic [ref=e929]:
            - img [ref=e930]
            - text: Avaliações reais
          - heading "O que nossos clientes dizem" [level=2] [ref=e932]
          - paragraph [ref=e933]: Avaliações de clientes após a conclusão do serviço.
      - generic [ref=e998]:
        - generic [ref=e1001]:
          - generic [ref=e1002]:
            - img [ref=e1004]
            - paragraph [ref=e1011]: Prestadores verificados
          - generic [ref=e1012]:
            - img [ref=e1014]
            - paragraph [ref=e1018]: Serviços cadastrados
          - generic [ref=e1019]:
            - img [ref=e1021]
            - paragraph [ref=e1026]: Serviços concluídos
          - generic [ref=e1027]:
            - img [ref=e1029]
            - paragraph [ref=e1033]: Nota média
        - generic [ref=e1035]:
          - generic [ref=e1036]:
            - generic [ref=e1037]:
              - img [ref=e1038]
              - text: Por que Severinno?
            - heading "Confiança em cada agendamento" [level=2] [ref=e1041]
            - paragraph [ref=e1042]: Mais que um diretório de serviços — um ecossistema pensado para proteger você e o prestador. Da verificação ao pagamento, cada etapa foi desenhada para a sua tranquilidade.
            - link "Pular para FAQ" [ref=e1044] [cursor=pointer]:
              - /url: "#faq"
              - img [ref=e1045]
              - text: Pular para FAQ
          - generic [ref=e1048]:
            - generic [ref=e1051]:
              - generic [ref=e1052]:
                - img [ref=e1054]
                - button "Saiba mais sobre Prestadores verificados" [ref=e1057]:
                  - img [ref=e1058]
              - heading "Prestadores verificados" [level=3] [ref=e1061]
              - paragraph [ref=e1062]: João verificou 3 documentos antes de aprovar o prestador. Você só vê profissionais validados.
              - button "Saiba mais" [ref=e1063]:
                - text: Saiba mais
                - img [ref=e1064]
            - generic [ref=e1068]:
              - generic [ref=e1069]:
                - img [ref=e1071]
                - button "Saiba mais sobre Pagamento protegido" [ref=e1074]:
                  - img [ref=e1075]
              - heading "Pagamento protegido" [level=3] [ref=e1078]
              - paragraph [ref=e1079]: O valor só é liberado ao prestador após você confirmar que ficou satisfeito com o serviço.
              - button "Saiba mais" [ref=e1080]:
                - text: Saiba mais
                - img [ref=e1081]
            - generic [ref=e1085]:
              - generic [ref=e1086]:
                - img [ref=e1088]
                - button "Saiba mais sobre Resposta rápida" [ref=e1091]:
                  - img [ref=e1092]
              - heading "Resposta rápida" [level=3] [ref=e1095]
              - paragraph [ref=e1096]: Prestadores comprometidos a responder em até 24h. Acompanhe o status em tempo real.
              - button "Saiba mais" [ref=e1097]:
                - text: Saiba mais
                - img [ref=e1098]
            - generic [ref=e1102]:
              - generic [ref=e1103]:
                - img [ref=e1105]
                - button "Saiba mais sobre Avaliações reais" [ref=e1107]:
                  - img [ref=e1108]
              - heading "Avaliações reais" [level=3] [ref=e1111]
              - paragraph [ref=e1112]: Apenas clientes que concluíram o serviço podem avaliar. Sem falsas avaliações.
              - button "Saiba mais" [ref=e1113]:
                - text: Saiba mais
                - img [ref=e1114]
            - generic [ref=e1118]:
              - generic [ref=e1119]:
                - img [ref=e1121]
                - button "Saiba mais sobre Próximo de você" [ref=e1124]:
                  - img [ref=e1125]
              - heading "Próximo de você" [level=3] [ref=e1128]
              - paragraph [ref=e1129]: Geolocalização inteligente mostra os melhores prestadores na sua região.
              - button "Saiba mais" [ref=e1130]:
                - text: Saiba mais
                - img [ref=e1131]
            - generic [ref=e1135]:
              - generic [ref=e1136]:
                - img [ref=e1138]
                - button "Saiba mais sobre Suporte humano" [ref=e1140]:
                  - img [ref=e1141]
              - heading "Suporte humano" [level=3] [ref=e1144]
              - paragraph [ref=e1145]: Equipe disponível para mediar disputas, tirar dúvidas e garantir uma experiência justa.
              - button "Saiba mais" [ref=e1146]:
                - text: Saiba mais
                - img [ref=e1147]
        - generic [ref=e1150]:
          - img [ref=e1151]
          - paragraph [ref=e1153]: "Garantia Severinno: seu dinheiro de volta se o serviço não for bem-feito."
          - link "Saiba mais" [ref=e1154] [cursor=pointer]:
            - /url: "#faq"
            - text: Saiba mais
            - img [ref=e1155]
      - generic [ref=e1158]:
        - generic [ref=e1159]:
          - generic [ref=e1160]:
            - img [ref=e1161]
            - text: Destaque da semana
          - heading "Profissional em destaque" [level=2] [ref=e1167]
          - paragraph [ref=e1168]: Conheça um dos nossos prestadores mais bem avaliados.
        - generic [ref=e1172]:
          - generic [ref=e1173]:
            - generic [ref=e1174]:
              - img [ref=e1177]
              - img [ref=e1181]
              - generic [ref=e1185]:
                - img [ref=e1186]
                - text: Top
            - generic [ref=e1188]:
              - generic [ref=e1189]:
                - heading "Maria Silva" [level=3] [ref=e1190]
                - generic [ref=e1191]:
                  - generic [ref=e1192]:
                    - img [ref=e1193]
                    - text: São Paulo
                  - generic [ref=e1196]: 3 km
                  - generic [ref=e1197]:
                    - img [ref=e1198]
                    - text: Membro desde 2023
              - generic [ref=e1200]:
                - generic [ref=e1201]:
                  - img [ref=e1202]
                  - generic [ref=e1204]: "4.8"
                - generic [ref=e1205]: (42 avaliações)
              - generic [ref=e1206]:
                - generic [ref=e1207]:
                  - img
                  - text: 230 serviços concluídos
                - generic [ref=e1208]:
                  - img
                  - text: Responde em ~30min
              - generic [ref=e1209]:
                - paragraph [ref=e1210]: Serviços
                - generic [ref=e1212]:
                  - generic [ref=e1213]: Instalação Elétrica
                  - generic [ref=e1214]: R$ 120,00
              - paragraph [ref=e1216]: Especialista em instalações elétricas residenciais com mais de 10 anos de experiência.
              - generic [ref=e1217]:
                - generic [ref=e1218]:
                  - generic "Maria S." [ref=e1219]: M
                  - generic "João P." [ref=e1220]: J
                  - generic "Ana L." [ref=e1221]: A
                - generic [ref=e1222]: Clientes recentes
          - generic [ref=e1223]:
            - generic [ref=e1224]:
              - button "Pedir orçamento" [ref=e1225]:
                - img
                - text: Pedir orçamento
              - button "Ver perfil completo" [ref=e1226]:
                - text: Ver perfil completo
                - img
            - button "Enviar mensagem" [ref=e1228]:
              - img
              - text: Enviar mensagem
      - generic [ref=e1232]:
        - generic [ref=e1233]:
          - generic [ref=e1234]:
            - generic [ref=e1235]:
              - img [ref=e1236]
              - text: Perguntas frequentes
            - heading "Tire suas dúvidas antes de contratar" [level=2] [ref=e1239]
            - paragraph [ref=e1240]: Reunimos as perguntas mais comuns sobre como o Severinno funciona — do cadastro ao pagamento.
          - generic [ref=e1241]:
            - img [ref=e1242]
            - textbox "Buscar nas perguntas frequentes" [ref=e1245]:
              - /placeholder: Buscar nas dúvidas…
          - generic [ref=e1246]:
            - paragraph [ref=e1247]: Filtrar por categoria
            - generic [ref=e1248]:
              - button "Filtrar por Geral" [ref=e1249]:
                - img [ref=e1250]
                - text: Geral
                - generic [ref=e1253]: (2)
              - button "Filtrar por Pagamento" [ref=e1254]:
                - img [ref=e1255]
                - text: Pagamento
                - generic [ref=e1257]: (2)
              - button "Filtrar por Agendamento" [ref=e1258]:
                - img [ref=e1259]
                - text: Agendamento
                - generic [ref=e1261]: (2)
              - button "Filtrar por Prestadores" [ref=e1262]:
                - img [ref=e1263]
                - text: Prestadores
                - generic [ref=e1267]: (2)
              - button "Filtrar por Segurança" [ref=e1268]:
                - img [ref=e1269]
                - text: Segurança
                - generic [ref=e1272]: (2)
          - generic [ref=e1273]:
            - paragraph [ref=e1274]: Perguntas mais frequentes
            - list [ref=e1275]:
              - listitem [ref=e1276]:
                - button "Como funciona o Severinno?" [ref=e1277]:
                  - img [ref=e1278]
                  - generic [ref=e1280]: Como funciona o Severinno?
              - listitem [ref=e1281]:
                - button "Preciso pagar para me cadastrar?" [ref=e1282]:
                  - img [ref=e1283]
                  - generic [ref=e1285]: Preciso pagar para me cadastrar?
              - listitem [ref=e1286]:
                - button "Como faço para agendar um serviço?" [ref=e1287]:
                  - img [ref=e1288]
                  - generic [ref=e1290]: Como faço para agendar um serviço?
              - listitem [ref=e1291]:
                - button "E se o serviço não for bem-feito?" [ref=e1292]:
                  - img [ref=e1293]
                  - generic [ref=e1295]: E se o serviço não for bem-feito?
          - generic [ref=e1297]:
            - img [ref=e1299]
            - generic [ref=e1301]:
              - paragraph [ref=e1302]: Ainda tem dúvidas?
              - paragraph [ref=e1303]: Cadastre-se grátis e converse diretamente com prestadores verificados. Sem compromisso.
              - generic [ref=e1304]:
                - button "Cadastrar grátis" [ref=e1305]
                - link "Fale conosco" [ref=e1306] [cursor=pointer]:
                  - /url: "#faq"
                  - img
                  - text: Fale conosco
        - generic [ref=e1307]:
          - generic [ref=e1309]:
            - generic [ref=e1311]:
              - heading "01 Como funciona o Severinno? Geral" [level=3] [ref=e1312]:
                - button "01 Como funciona o Severinno? Geral" [expanded] [ref=e1313]:
                  - generic [ref=e1314]:
                    - generic [ref=e1315]: "01"
                    - generic [ref=e1316]: Como funciona o Severinno?
                    - generic [ref=e1317]:
                      - img
                      - text: Geral
                  - img
              - region "01 Como funciona o Severinno? Geral" [ref=e1318]:
                - generic [ref=e1320]:
                  - paragraph [ref=e1321]: O Severinno conecta você a prestadores de serviço verificados próximos à sua localização. Você busca o serviço, compara avaliações reais de outros clientes, pede orçamento grátis e agenda — tudo pela plataforma. O pagamento só é liberado após você confirmar a conclusão do serviço.
                  - paragraph [ref=e1322]: "Ex: Maria precisava de um eletricista. Buscou na plataforma, comparou 3 profissionais e contratou o mais bem avaliado — tudo em 5 minutos."
            - heading "02 Preciso pagar para me cadastrar? Geral" [level=3] [ref=e1325]:
              - button "02 Preciso pagar para me cadastrar? Geral" [ref=e1326]:
                - generic [ref=e1327]:
                  - generic [ref=e1328]: "02"
                  - generic [ref=e1329]: Preciso pagar para me cadastrar?
                  - generic [ref=e1330]:
                    - img
                    - text: Geral
                - img
            - heading "03 Como os prestadores são verificados? Prestadores" [level=3] [ref=e1333]:
              - button "03 Como os prestadores são verificados? Prestadores" [ref=e1334]:
                - generic [ref=e1335]:
                  - generic [ref=e1336]: "03"
                  - generic [ref=e1337]: Como os prestadores são verificados?
                  - generic [ref=e1338]:
                    - img
                    - text: Prestadores
                - img
            - heading "04 Posso me tornar um prestador no Severinno? Prestadores" [level=3] [ref=e1341]:
              - button "04 Posso me tornar um prestador no Severinno? Prestadores" [ref=e1342]:
                - generic [ref=e1343]:
                  - generic [ref=e1344]: "04"
                  - generic [ref=e1345]: Posso me tornar um prestador no Severinno?
                  - generic [ref=e1346]:
                    - img
                    - text: Prestadores
                - img
            - heading "05 Como faço para agendar um serviço? Agendamento" [level=3] [ref=e1349]:
              - button "05 Como faço para agendar um serviço? Agendamento" [ref=e1350]:
                - generic [ref=e1351]:
                  - generic [ref=e1352]: "05"
                  - generic [ref=e1353]: Como faço para agendar um serviço?
                  - generic [ref=e1354]:
                    - img
                    - text: Agendamento
                - img
            - heading "06 Posso remarcar ou cancelar um agendamento? Agendamento" [level=3] [ref=e1357]:
              - button "06 Posso remarcar ou cancelar um agendamento? Agendamento" [ref=e1358]:
                - generic [ref=e1359]:
                  - generic [ref=e1360]: "06"
                  - generic [ref=e1361]: Posso remarcar ou cancelar um agendamento?
                  - generic [ref=e1362]:
                    - img
                    - text: Agendamento
                - img
            - heading "07 Como funciona o pagamento? Pagamento" [level=3] [ref=e1365]:
              - button "07 Como funciona o pagamento? Pagamento" [ref=e1366]:
                - generic [ref=e1367]:
                  - generic [ref=e1368]: "07"
                  - generic [ref=e1369]: Como funciona o pagamento?
                  - generic [ref=e1370]:
                    - img
                    - text: Pagamento
                - img
            - heading "08 O orçamento tem compromisso? Pagamento" [level=3] [ref=e1373]:
              - button "08 O orçamento tem compromisso? Pagamento" [ref=e1374]:
                - generic [ref=e1375]:
                  - generic [ref=e1376]: "08"
                  - generic [ref=e1377]: O orçamento tem compromisso?
                  - generic [ref=e1378]:
                    - img
                    - text: Pagamento
                - img
            - heading "09 E se o serviço não for bem-feito? Segurança" [level=3] [ref=e1381]:
              - button "09 E se o serviço não for bem-feito? Segurança" [ref=e1382]:
                - generic [ref=e1383]:
                  - generic [ref=e1384]: "09"
                  - generic [ref=e1385]: E se o serviço não for bem-feito?
                  - generic [ref=e1386]:
                    - img
                    - text: Segurança
                - img
            - heading "10 Meus dados pessoais estão seguros? Segurança" [level=3] [ref=e1389]:
              - button "10 Meus dados pessoais estão seguros? Segurança" [ref=e1390]:
                - generic [ref=e1391]:
                  - generic [ref=e1392]: "10"
                  - generic [ref=e1393]: Meus dados pessoais estão seguros?
                  - generic [ref=e1394]:
                    - img
                    - text: Segurança
                - img
          - generic [ref=e1395]:
            - paragraph [ref=e1396]: 10 de 10 dúvidas
            - button "Voltar ao topo da seção" [ref=e1397]:
              - img [ref=e1398]
              - text: Topo
      - generic [ref=e1402]:
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
        - generic [ref=e1407]:
          - generic [ref=e1408]:
            - generic [ref=e1410]:
              - img [ref=e1411]
              - text: Comece agora mesmo
            - heading "Encontre o serviço que você precisa" [level=2] [ref=e1413]
            - paragraph [ref=e1414]: Navegue pela vitrine, salve seus favoritos e agende com confiança. Tudo em um só lugar.
            - list [ref=e1415]:
              - generic [ref=e1416]:
                - listitem [ref=e1417]:
                  - img [ref=e1418]
                  - text: Cadastro gratuito
                - listitem [ref=e1421]:
                  - img [ref=e1422]
                  - text: Sem taxa de serviço
                - listitem [ref=e1425]:
                  - img [ref=e1426]
                  - text: Orçamento sem compromisso
            - button "Buscar prestadores" [ref=e1434]:
              - img
              - text: Buscar prestadores
              - generic [ref=e1435]:
                - img
          - generic [ref=e1436]:
            - generic [ref=e1437]:
              - heading "O que vem depois?" [level=3] [ref=e1438]
              - paragraph [ref=e1439]: Três passos simples e você estará agendando
              - generic [ref=e1440]:
                - img [ref=e1441]
                - generic [ref=e1442]:
                  - generic [ref=e1443]:
                    - generic [ref=e1445]: "1"
                    - generic [ref=e1446]:
                      - paragraph [ref=e1447]: Cadastre-se grátis
                      - paragraph [ref=e1448]: ~30s
                  - generic [ref=e1449]:
                    - generic [ref=e1451]: "2"
                    - generic [ref=e1452]:
                      - paragraph [ref=e1453]: Busque e compare
                      - paragraph [ref=e1454]: ~2 min
                  - generic [ref=e1455]:
                    - generic [ref=e1457]: "3"
                    - generic [ref=e1458]:
                      - paragraph [ref=e1459]: Agende com confiança
                      - paragraph [ref=e1460]: ~5 min
              - generic [ref=e1461]:
                - generic [ref=e1462]:
                  - img [ref=e1463]
                  - text: Sem compromisso
                - generic [ref=e1467]:
                  - img [ref=e1468]
                  - text: Cancele quando quiser
                - generic [ref=e1471]:
                  - img [ref=e1472]
                  - text: Suporte 24h
              - link "Saiba mais sobre pagamento protegido" [ref=e1475] [cursor=pointer]:
                - /url: "#faq"
                - img [ref=e1476]
                - text: Saiba mais sobre pagamento protegido
            - generic [ref=e1480]:
              - generic [ref=e1484]: Cliente
              - generic [ref=e1485]:
                - img [ref=e1489]
                - generic [ref=e1491]: Prestador
              - img [ref=e1496]
              - img [ref=e1498]
              - img [ref=e1502]
              - img [ref=e1505]
              - img [ref=e1509]
        - generic [ref=e1513]:
          - img [ref=e1514]
          - generic [ref=e1517]:
            - paragraph [ref=e1518]: “Encontrei um encanador em 10 minutos, paguei menos do que esperava e ainda pude avaliar o serviço. Recomendo demais!”
            - paragraph [ref=e1519]: — Ana P., Cliente, São Paulo
        - generic [ref=e1520]:
          - generic [ref=e1521]:
            - img [ref=e1522]
            - text: Sem compromisso
          - generic [ref=e1526]:
            - img [ref=e1527]
            - text: Cancele quando quiser
          - generic [ref=e1530]:
            - img [ref=e1531]
            - text: Pagamento protegido
    - contentinfo [ref=e1533]:
      - generic [ref=e1535]:
        - generic [ref=e1536]:
          - paragraph [ref=e1537]: Receba novidades e dicas de serviços
          - paragraph [ref=e1538]: Cadastre-se e receba ofertas exclusivas. Cancele quando quiser.
        - generic [ref=e1539]:
          - generic [ref=e1540]:
            - img [ref=e1541]
            - textbox "E-mail para newsletter" [ref=e1544]:
              - /placeholder: Seu e-mail
          - button "Assinar" [disabled]:
            - img
            - text: Assinar
      - generic [ref=e1545]:
        - generic [ref=e1546]:
          - generic [ref=e1547]:
            - generic [ref=e1548]:
              - img [ref=e1550]
              - generic [ref=e1553]: Severinno
            - paragraph [ref=e1554]: Marketplace de serviços com geolocalização. Encontre prestadores verificados, próximos e bem avaliados.
            - list "Redes sociais" [ref=e1555]:
              - listitem [ref=e1556]:
                - link "GitHub" [ref=e1557] [cursor=pointer]:
                  - /url: https://github.com
                  - img [ref=e1558]
              - listitem [ref=e1561]:
                - link "Twitter" [ref=e1562] [cursor=pointer]:
                  - /url: https://twitter.com
                  - img [ref=e1563]
              - listitem [ref=e1565]:
                - link "Instagram" [ref=e1566] [cursor=pointer]:
                  - /url: https://instagram.com
                  - img [ref=e1567]
              - listitem [ref=e1570]:
                - link "LinkedIn" [ref=e1571] [cursor=pointer]:
                  - /url: https://linkedin.com
                  - img [ref=e1572]
              - listitem [ref=e1576]:
                - link "E-mail" [ref=e1577] [cursor=pointer]:
                  - /url: mailto:contato@severinno.com
                  - img [ref=e1578]
          - navigation "Sobre" [ref=e1581]:
            - heading "Sobre" [level=3] [ref=e1582]:
              - img [ref=e1583]
              - text: Sobre
            - list [ref=e1586]:
              - listitem [ref=e1587]:
                - button "Como funciona" [ref=e1588]
              - listitem [ref=e1589]:
                - button "Quem somos" [ref=e1590]
              - listitem [ref=e1591]:
                - button "Termos de uso" [ref=e1592]
              - listitem [ref=e1593]:
                - button "Privacidade" [ref=e1594]
          - navigation "Para profissionais" [ref=e1595]:
            - heading "Para profissionais" [level=3] [ref=e1596]:
              - img [ref=e1597]
              - text: Para profissionais
            - list [ref=e1600]:
              - listitem [ref=e1601]:
                - button "Cadastre-se" [ref=e1602]
              - listitem [ref=e1603]:
                - button "Meu painel" [ref=e1604]
              - listitem [ref=e1605]:
                - button "Central de ajuda" [ref=e1606]
          - navigation "Precisa de ajuda?" [ref=e1607]:
            - heading "Precisa de ajuda?" [level=3] [ref=e1608]:
              - img [ref=e1609]
              - text: Precisa de ajuda?
            - list [ref=e1611]:
              - listitem [ref=e1612]:
                - button "Perguntas frequentes" [ref=e1613]
              - listitem [ref=e1614]:
                - button "Segurança" [ref=e1615]
              - listitem [ref=e1616]:
                - button "Reportar problema" [ref=e1617]
          - generic [ref=e1618]:
            - heading "Contato" [level=3] [ref=e1619]:
              - img [ref=e1620]
              - text: Contato
            - list [ref=e1625]:
              - listitem [ref=e1626]:
                - img [ref=e1627]
                - link "contato@severinno.com" [ref=e1630] [cursor=pointer]:
                  - /url: mailto:contato@severinno.com
              - listitem [ref=e1631]:
                - img [ref=e1632]
                - text: São Paulo, Brasil
            - button "Fale conosco" [ref=e1635]:
              - img
              - text: Fale conosco
        - generic [ref=e1636]:
          - paragraph [ref=e1637]: © 2026 Severinno Marketplace. Todos os direitos reservados.
          - paragraph [ref=e1638]:
            - text: Feito com
            - img [ref=e1639]
            - text: usando tecnologia Open Source (
            - link "MapLibre" [ref=e1641] [cursor=pointer]:
              - /url: https://maplibre.org/
            - text: ·
            - link "OpenStreetMap" [ref=e1642] [cursor=pointer]:
              - /url: https://www.openstreetmap.org/copyright
            - text: )
    - button "Voltar ao topo" [ref=e1644]:
      - img
    - button "Abrir assistente virtual" [ref=e1645]:
      - img [ref=e1646]
    - generic [ref=e1650]:
      - generic [ref=e1651]:
        - img [ref=e1653]
        - generic [ref=e1655]:
          - paragraph [ref=e1656]: Usamos cookies para melhorar sua experiência
          - paragraph [ref=e1657]:
            - text: Utilizamos cookies essenciais para o funcionamento do site e cookies de análise para melhorar nossos serviços.
            - button "Política de privacidade" [ref=e1658]
      - generic [ref=e1659]:
        - button "Recusar" [ref=e1660]
        - button "Aceitar" [ref=e1661]:
          - img
          - text: Aceitar
        - button "Dispensar" [ref=e1662]:
          - img [ref=e1663]
  - region "Notifications alt+T"
  - generic [active]:
    - generic [ref=e1668]:
      - generic [ref=e1669]:
        - generic [ref=e1670]:
          - navigation [ref=e1671]:
            - button "previous" [disabled] [ref=e1672]:
              - img "previous" [ref=e1673]
            - generic [ref=e1675]:
              - generic [ref=e1676]: 1/
              - text: "1"
            - button "next" [disabled] [ref=e1677]:
              - img "next" [ref=e1678]
          - img
        - generic [ref=e1680]:
          - link "Next.js 16.1.3 (stale) Turbopack" [ref=e1681] [cursor=pointer]:
            - /url: https://nextjs.org/docs/messages/version-staleness
            - img [ref=e1682]
            - generic "There is a newer version (16.2.11) available, upgrade recommended!" [ref=e1684]: Next.js 16.1.3 (stale)
            - generic [ref=e1685]: Turbopack
          - img
      - dialog "Build Error" [ref=e1687]:
        - generic [ref=e1690]:
          - generic [ref=e1691]:
            - generic [ref=e1692]:
              - generic [ref=e1694]: Build Error
              - generic [ref=e1695]:
                - button "Copy Error Info" [ref=e1696] [cursor=pointer]:
                  - img [ref=e1697]
                - button "No related documentation found" [disabled] [ref=e1699]:
                  - img [ref=e1700]
                - button "Attach Node.js inspector" [ref=e1702] [cursor=pointer]:
                  - img [ref=e1703]
            - generic [ref=e1712]: Reading source code for parsing failed
          - generic [ref=e1714]:
            - generic [ref=e1716]:
              - img [ref=e1718]
              - generic [ref=e1722]: ./.freebuff/worktrees/thmrzp9vv9y86o/src/lib/api-server.ts
              - button "Open in editor" [ref=e1723] [cursor=pointer]:
                - img [ref=e1725]
            - generic [ref=e1729]: "Reading source code for parsing failed An unexpected error happened while trying to read the source code to parse: failed to convert rope into string Caused by: - invalid utf-8 sequence of 1 bytes from index 5415 Import trace: App Route: ./.freebuff/worktrees/thmrzp9vv9y86o/src/lib/api-server.ts ./.freebuff/worktrees/thmrzp9vv9y86o/src/app/api/auth/me/route.ts"
        - generic [ref=e1730]: "1"
        - generic [ref=e1731]: "2"
    - generic [ref=e1736] [cursor=pointer]:
      - button "Open Next.js Dev Tools" [ref=e1737]:
        - img [ref=e1738]
      - button "Open issues overlay" [ref=e1742]:
        - generic [ref=e1743]:
          - generic [ref=e1744]: "0"
          - generic [ref=e1745]: "1"
        - generic [ref=e1746]: Issue
  - alert [ref=e1747]
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