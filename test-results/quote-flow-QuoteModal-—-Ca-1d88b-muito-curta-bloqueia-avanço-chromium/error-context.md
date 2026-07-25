# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: quote-flow.spec.ts >> QuoteModal — Casos de Erro e Validação >> 12. descrição muito curta bloqueia avanço
- Location: e2e\quote-flow.spec.ts:422:7

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
    3 × waiting for element to be visible, enabled and stable
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
  - element was detached from the DOM, retrying
    - locator resolved to <div class="sticky top-32 max-h-[calc(100vh-9rem)] overflow-y-auto rounded-xl border bg-card p-4 shadow-sm">…</div>
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
        - generic [ref=e124]:
          - generic [ref=e130]: Atividade ao vivo
          - generic [ref=e132]:
            - img [ref=e133]
            - paragraph [ref=e135]: Carregando atividades…
      - region "Atividade recente na plataforma" [ref=e137]:
        - generic [ref=e138]:
          - generic [ref=e140]: Atividade recente
          - generic [ref=e144]:
            - generic [ref=e146]:
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
              - generic [ref=e165]:
                - generic [ref=e166]: ⚡
                - text: Maria contratou um eletricista em São Paulo
              - generic [ref=e168]:
                - generic [ref=e169]: ⭐
                - text: João avaliou ★★★★★ o prestador Ricardo
              - generic [ref=e171]:
                - generic [ref=e172]: 🎨
                - text: "Nova avaliação: 4.9 para Serviços de Pintura"
              - generic [ref=e174]:
                - generic [ref=e175]: 🔧
                - text: Ana pediu orçamento para encanador
              - generic [ref=e177]:
                - generic [ref=e178]: ✅
                - text: Pedro se cadastrou como prestador verificado
              - generic [ref=e180]:
                - generic [ref=e181]: 📋
                - text: 12 orçamentos enviados hoje
            - generic [ref=e185]:
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
              - generic [ref=e204]:
                - generic [ref=e205]: 🧹
                - text: Carlos agendou limpeza de quintal em Belo Horizonte
              - generic [ref=e207]:
                - generic [ref=e208]: ⭐
                - text: Fernanda avaliou ★★★★★ o prestador José
              - generic [ref=e210]:
                - generic [ref=e211]: 🛡️
                - text: 8 novos prestadores verificados esta semana
              - generic [ref=e213]:
                - generic [ref=e214]: 🎨
                - text: Luciana contratou um pintor no Rio de Janeiro
              - generic [ref=e216]:
                - generic [ref=e217]: 🚿
                - text: "Orçamento aceito: reforma de banheiro em Curitiba"
              - generic [ref=e219]:
                - generic [ref=e220]: 🏆
                - text: 5.200 serviços concluídos este mês
      - region "Categorias de serviços" [ref=e222]:
        - generic [ref=e223]:
          - generic:
            - img
          - generic [ref=e225]:
            - generic [ref=e226]:
              - img [ref=e227]
              - text: Explore categorias
            - heading "Encontre o serviço ideal" [level=2] [ref=e230]
            - paragraph [ref=e231]: Serviços verificados perto de você — 0 categorias disponíveis
          - generic [ref=e232]:
            - img [ref=e234]
            - generic [ref=e237]:
              - paragraph [ref=e238]: Nenhuma categoria disponível
              - paragraph [ref=e239]: As categorias aparecerão aqui assim que estiverem disponíveis. Tente recarregar a página.
            - button "Tentar carregar categorias novamente" [ref=e240]:
              - img
              - text: Tentar novamente
      - region "Resultados da busca" [ref=e241]:
        - generic [ref=e242]:
          - complementary [ref=e243]:
            - generic [ref=e245]:
              - generic [ref=e246]:
                - heading "Filtros" [level=2] [ref=e247]:
                  - img [ref=e248]
                  - text: Filtros
                - button "Limpar filtros" [ref=e249]
              - generic [ref=e250]:
                - generic [ref=e251]: Buscar
                - generic [ref=e252]:
                  - img [ref=e253]
                  - textbox "Buscar" [ref=e256]:
                    - /placeholder: Serviço, prestador…
              - generic [ref=e257]:
                - generic [ref=e258]:
                  - generic [ref=e259]: Raio de busca
                  - generic [ref=e260]: 15 km
                - generic "Raio de busca em quilômetros" [ref=e261]:
                  - slider [ref=e265]
                - generic [ref=e266]:
                  - generic [ref=e267]: 1 km
                  - generic [ref=e268]: 50 km
              - generic [ref=e269]:
                - generic [ref=e270]: Categoria
                - combobox [ref=e271]:
                  - generic: Todas as categorias
                  - img
              - generic [ref=e272]:
                - generic [ref=e273]: Ordenar por
                - radiogroup "Ordenar por" [ref=e274]:
                  - radio "Melhor avaliação" [checked] [ref=e275]
                  - radio "Mais próximos" [ref=e276]
              - generic [ref=e277]:
                - generic [ref=e278]: Avaliação mínima
                - radiogroup [ref=e279]:
                  - generic [ref=e280] [cursor=pointer]:
                    - radio "Todas" [checked] [ref=e281]:
                      - img [ref=e282]
                    - generic [ref=e284]: Todas
                  - generic [ref=e285] [cursor=pointer]:
                    - radio "3+" [ref=e286]
                    - generic [ref=e287]: 3+
                  - generic [ref=e288] [cursor=pointer]:
                    - radio "4+" [ref=e289]
                    - generic [ref=e290]: 4+
                  - generic [ref=e291] [cursor=pointer]:
                    - radio "5" [ref=e292]
                    - generic [ref=e293]: "5"
              - generic [ref=e294] [cursor=pointer]:
                - generic [ref=e295]:
                  - img [ref=e296]
                  - generic [ref=e298]: Somente verificados
                - switch "Somente verificados" [ref=e299]
              - button "Ver 3 resultados" [disabled]
          - generic [ref=e300]:
            - generic [ref=e302]:
              - generic [ref=e303]:
                - heading "3 prestadores encontrados" [level=2] [ref=e304]
                - paragraph [ref=e305]: Exibindo 1–3 de 3
              - generic [ref=e306]:
                - generic [ref=e307]:
                  - text: "Ordenado por:"
                  - generic [ref=e308]: Melhor avaliação
                - tablist "Visualização" [ref=e309]:
                  - tab "Lista" [selected] [ref=e310]:
                    - img [ref=e311]
                    - generic [ref=e312]: Lista
                  - tab "Mapa" [ref=e313]:
                    - img [ref=e314]
                    - generic [ref=e316]: Mapa
            - generic [ref=e318]:
              - generic [ref=e320]:
                - generic [ref=e321]:
                  - img "Capa de Maria Silva" [ref=e322]
                  - generic [ref=e324]:
                    - img [ref=e325]
                    - text: Verificado
                  - generic [ref=e328]:
                    - button "Adicionar Maria Silva à comparação" [ref=e329]:
                      - img [ref=e330]
                    - button "Adicionar Maria Silva aos favoritos" [ref=e335]:
                      - img [ref=e336]
                  - img "Maria Silva" [ref=e340]
                - generic [ref=e341]:
                  - generic [ref=e342]:
                    - button "Ver perfil de Maria Silva" [ref=e343]:
                      - heading "Maria Silva" [level=3] [ref=e344]:
                        - generic [ref=e345]: Maria Silva
                        - img [ref=e346]
                    - generic "Avaliação média" [ref=e348]:
                      - img [ref=e349]
                      - text: "4.8"
                      - generic [ref=e351]: (42)
                  - paragraph [ref=e352]: a partir de R$ 120,00
                  - generic [ref=e353]:
                    - generic [ref=e354]:
                      - img [ref=e355]
                      - text: 2,5 km
                    - generic [ref=e358]:
                      - img [ref=e359]
                      - text: São Paulo
                  - paragraph [ref=e362]: Especialista em instalações elétricas residenciais com mais de 10 anos de experiência.
                  - generic [ref=e363]:
                    - generic "Serviços concluídos com sucesso" [ref=e364]:
                      - img [ref=e365]
                      - text: 230 serviços concluídos
                    - generic "Na plataforma desde" [ref=e368]:
                      - img [ref=e369]
                      - text: desde jan. de 2023
                - generic [ref=e373]:
                  - generic [ref=e374]:
                    - img [ref=e375]
                    - generic [ref=e377]: Instalação Elétrica · a partir de R$ 120,00
                  - heading "Elétrica 1 serviço" [level=3] [ref=e380]:
                    - button "Elétrica 1 serviço" [ref=e381]:
                      - generic [ref=e383]:
                        - paragraph [ref=e384]: Elétrica
                        - paragraph [ref=e385]: 1 serviço
                      - img
                - generic [ref=e386]:
                  - button "Orçamento" [ref=e387]:
                    - img
                    - text: Orçamento
                  - button "Agendar" [ref=e388]:
                    - img
                    - text: Agendar
              - generic [ref=e390]:
                - generic [ref=e391]:
                  - img "Capa de João Pedreiro" [ref=e392]
                  - generic [ref=e394]:
                    - img [ref=e395]
                    - text: Verificado
                  - generic [ref=e398]:
                    - button "Adicionar João Pedreiro à comparação" [ref=e399]:
                      - img [ref=e400]
                    - button "Adicionar João Pedreiro aos favoritos" [ref=e405]:
                      - img [ref=e406]
                  - img "João Pedreiro" [ref=e410]
                - generic [ref=e411]:
                  - generic [ref=e412]:
                    - button "Ver perfil de João Pedreiro" [ref=e413]:
                      - heading "João Pedreiro" [level=3] [ref=e414]:
                        - generic [ref=e415]: João Pedreiro
                        - img [ref=e416]
                    - generic "Avaliação média" [ref=e418]:
                      - img [ref=e419]
                      - text: "4.8"
                      - generic [ref=e421]: (42)
                  - paragraph [ref=e422]: a partir de R$ 120,00
                  - generic [ref=e423]:
                    - generic [ref=e424]:
                      - img [ref=e425]
                      - text: 2,5 km
                    - generic [ref=e428]:
                      - img [ref=e429]
                      - text: São Paulo
                  - paragraph [ref=e432]: Especialista em instalações elétricas residenciais com mais de 10 anos de experiência.
                  - generic [ref=e433]:
                    - generic "Serviços concluídos com sucesso" [ref=e434]:
                      - img [ref=e435]
                      - text: 230 serviços concluídos
                    - generic "Na plataforma desde" [ref=e438]:
                      - img [ref=e439]
                      - text: desde jan. de 2023
                - generic [ref=e443]:
                  - generic [ref=e444]:
                    - img [ref=e445]
                    - generic [ref=e447]: Instalação Elétrica · a partir de R$ 120,00
                  - heading "Construção 1 serviço" [level=3] [ref=e450]:
                    - button "Construção 1 serviço" [ref=e451]:
                      - generic [ref=e453]:
                        - paragraph [ref=e454]: Construção
                        - paragraph [ref=e455]: 1 serviço
                      - img
                - generic [ref=e456]:
                  - button "Orçamento" [ref=e457]:
                    - img
                    - text: Orçamento
                  - button "Agendar" [ref=e458]:
                    - img
                    - text: Agendar
              - generic [ref=e460]:
                - generic [ref=e461]:
                  - img "Capa de Ana Pintora" [ref=e462]
                  - generic [ref=e464]:
                    - img [ref=e465]
                    - text: Verificado
                  - generic [ref=e468]:
                    - button "Adicionar Ana Pintora à comparação" [ref=e469]:
                      - img [ref=e470]
                    - button "Adicionar Ana Pintora aos favoritos" [ref=e475]:
                      - img [ref=e476]
                  - img "Ana Pintora" [ref=e480]
                - generic [ref=e481]:
                  - generic [ref=e482]:
                    - button "Ver perfil de Ana Pintora" [ref=e483]:
                      - heading "Ana Pintora" [level=3] [ref=e484]:
                        - generic [ref=e485]: Ana Pintora
                        - img [ref=e486]
                    - generic "Avaliação média" [ref=e488]:
                      - img [ref=e489]
                      - text: "4.8"
                      - generic [ref=e491]: (42)
                  - paragraph [ref=e492]: a partir de R$ 120,00
                  - generic [ref=e493]:
                    - generic [ref=e494]:
                      - img [ref=e495]
                      - text: 2,5 km
                    - generic [ref=e498]:
                      - img [ref=e499]
                      - text: São Paulo
                  - paragraph [ref=e502]: Especialista em instalações elétricas residenciais com mais de 10 anos de experiência.
                  - generic [ref=e503]:
                    - generic "Serviços concluídos com sucesso" [ref=e504]:
                      - img [ref=e505]
                      - text: 230 serviços concluídos
                    - generic "Na plataforma desde" [ref=e508]:
                      - img [ref=e509]
                      - text: desde jan. de 2023
                - generic [ref=e513]:
                  - generic [ref=e514]:
                    - img [ref=e515]
                    - generic [ref=e517]: Instalação Elétrica · a partir de R$ 120,00
                  - heading "Pintura 1 serviço" [level=3] [ref=e520]:
                    - button "Pintura 1 serviço" [ref=e521]:
                      - generic [ref=e523]:
                        - paragraph [ref=e524]: Pintura
                        - paragraph [ref=e525]: 1 serviço
                      - img
                - generic [ref=e526]:
                  - button "Orçamento" [ref=e527]:
                    - img
                    - text: Orçamento
                  - button "Agendar" [ref=e528]:
                    - img
                    - text: Agendar
      - region "Como funciona" [ref=e529]:
        - generic [ref=e534]:
          - generic [ref=e535]:
            - link "Pular para resultados" [ref=e536] [cursor=pointer]:
              - /url: "#vitrine-resultados"
              - img [ref=e537]
              - text: Pular para resultados
            - generic [ref=e541]:
              - img [ref=e542]
              - generic [ref=e544]: "4"
              - text: passos simples
            - heading "Como funciona" [level=2] [ref=e545]
            - paragraph [ref=e546]: Sem surpresas — do início ao fim, você tem o controle.
            - generic [ref=e547]:
              - img [ref=e548]
              - text: Sem compromisso
          - generic [ref=e554]:
            - img [ref=e556]
            - generic [ref=e557]:
              - 'button "1 Busque o serviço Encontre prestadores verificados perto de você. 50 + categorias encanador em São Paulo | Verificados < 5 km Mais filtros Ex: Busque ''encanador em São Paulo'' Buscar prestadores" [ref=e558] [cursor=pointer]':
                - generic [ref=e560]:
                  - generic [ref=e562]: "1"
                  - generic [ref=e563]:
                    - img [ref=e565]
                    - img [ref=e569]
                  - heading "Busque o serviço" [level=3] [ref=e572]
                  - paragraph [ref=e573]: Encontre prestadores verificados perto de você.
                  - generic [ref=e575]:
                    - generic [ref=e576]: "50"
                    - text: +
                    - generic [ref=e577]: categorias
                  - generic [ref=e579]:
                    - generic [ref=e580]:
                      - img [ref=e581]
                      - generic [ref=e584]: encanador em São Paulo
                      - generic [ref=e585]: "|"
                    - generic [ref=e586]:
                      - generic [ref=e587]: Verificados
                      - generic [ref=e588]: < 5 km
                      - generic [ref=e589]:
                        - img [ref=e590]
                        - text: Mais filtros
                  - paragraph [ref=e592]: "Ex: Busque 'encanador em São Paulo'"
                  - button "Buscar prestadores" [ref=e593]:
                    - text: Buscar prestadores
                    - img
              - 'button "2 Compare orçamentos Receba e compare propostas lado a lado. 3 orçamentos em 24h João S. R$ 180 Maria L. R$ 150 Melhor avaliação Compare lado a lado Ex: Compare 3 orçamentos em 24h Sem compromisso Pedir orçamento" [ref=e594] [cursor=pointer]':
                - generic [ref=e596]:
                  - generic [ref=e598]: "2"
                  - generic [ref=e599]:
                    - img [ref=e601]
                    - img [ref=e607]
                  - heading "Compare orçamentos" [level=3] [ref=e610]
                  - paragraph [ref=e611]: Receba e compare propostas lado a lado.
                  - generic [ref=e613]:
                    - generic [ref=e614]: "3"
                    - generic [ref=e615]: orçamentos em 24h
                  - generic [ref=e617]:
                    - generic [ref=e618]:
                      - generic [ref=e619]:
                        - generic [ref=e622]: João S.
                        - generic [ref=e623]:
                          - img [ref=e624]
                          - img [ref=e626]
                          - img [ref=e628]
                          - img [ref=e630]
                          - img [ref=e632]
                        - generic [ref=e634]: R$ 180
                      - generic [ref=e635]:
                        - generic [ref=e638]: Maria L.
                        - generic [ref=e639]:
                          - img [ref=e640]
                          - img [ref=e642]
                          - img [ref=e644]
                          - img [ref=e646]
                          - img [ref=e648]
                        - generic [ref=e650]: R$ 150
                        - generic [ref=e651]: Melhor avaliação
                    - generic [ref=e652]:
                      - img [ref=e653]
                      - text: Compare lado a lado
                  - paragraph [ref=e658]: "Ex: Compare 3 orçamentos em 24h"
                  - generic [ref=e659]:
                    - img [ref=e660]
                    - text: Sem compromisso
                  - button "Pedir orçamento" [ref=e665]:
                    - text: Pedir orçamento
                    - img
              - 'button "3 Agende com confiança Solicite um orçamento ou agende diretamente. 24 h para confirmar Março 2025 S T Q Q S S D 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 12 Mar, 14:00 — Confirmado Ex: Agende para amanhã às 14h Agendar agora" [ref=e666] [cursor=pointer]':
                - generic [ref=e668]:
                  - generic [ref=e670]: "3"
                  - generic [ref=e671]:
                    - img [ref=e673]
                    - img [ref=e677]
                  - heading "Agende com confiança" [level=3] [ref=e680]
                  - paragraph [ref=e681]: Solicite um orçamento ou agende diretamente.
                  - generic [ref=e683]:
                    - generic [ref=e684]: "24"
                    - text: h
                    - generic [ref=e685]: para confirmar
                  - generic [ref=e688]:
                    - generic [ref=e689]: Março 2025
                    - generic [ref=e690]:
                      - generic [ref=e691]: S
                      - generic [ref=e692]: T
                      - generic [ref=e693]: Q
                      - generic [ref=e694]: Q
                      - generic [ref=e695]: S
                      - generic [ref=e696]: S
                      - generic [ref=e697]: D
                      - generic [ref=e698]: "1"
                      - generic [ref=e699]: "2"
                      - generic [ref=e700]: "3"
                      - generic [ref=e701]: "4"
                      - generic [ref=e702]: "5"
                      - generic [ref=e703]: "6"
                      - generic [ref=e704]: "7"
                      - generic [ref=e705]: "8"
                      - generic [ref=e706]: "9"
                      - generic [ref=e707]: "10"
                      - generic [ref=e708]: "11"
                      - generic [ref=e709]: "12"
                      - generic [ref=e710]: "13"
                      - generic [ref=e711]: "14"
                      - generic [ref=e712]: "15"
                    - generic [ref=e713]:
                      - img [ref=e714]
                      - generic [ref=e717]: 12 Mar, 14:00 — Confirmado
                  - paragraph [ref=e718]: "Ex: Agende para amanhã às 14h"
                  - button "Agendar agora" [ref=e719]:
                    - text: Agendar agora
                    - img
              - 'button "4 Avalie o resultado Sua opinião mantém a qualidade da comunidade. 98 % satisfação 4.0 \"Excelente trabalho, recomendo!\" Avaliação verificada Ex: Avalie de 1 a 5 estrelas com comentário Cadastrar grátis" [ref=e720] [cursor=pointer]':
                - generic [ref=e722]:
                  - generic [ref=e724]: "4"
                  - generic [ref=e725]:
                    - img [ref=e727]
                    - img [ref=e730]
                  - heading "Avalie o resultado" [level=3] [ref=e733]
                  - paragraph [ref=e734]: Sua opinião mantém a qualidade da comunidade.
                  - generic [ref=e736]:
                    - generic [ref=e737]: "98"
                    - text: "%"
                    - generic [ref=e738]: satisfação
                  - generic [ref=e740]:
                    - generic [ref=e741]:
                      - generic [ref=e742]:
                        - img [ref=e743]
                        - img [ref=e745]
                        - img [ref=e747]
                        - img [ref=e749]
                        - img [ref=e751]
                        - generic [ref=e753]: "4.0"
                      - paragraph [ref=e756]: "\"Excelente trabalho, recomendo!\""
                    - generic [ref=e757]:
                      - img [ref=e758]
                      - text: Avaliação verificada
                  - paragraph [ref=e761]: "Ex: Avalie de 1 a 5 estrelas com comentário"
                  - button "Cadastrar grátis" [ref=e762]:
                    - text: Cadastrar grátis
                    - img
          - generic [ref=e763]:
            - generic [ref=e764]:
              - img [ref=e765]
              - generic [ref=e768]: Garantia Severinno
            - generic [ref=e769]:
              - generic [ref=e770]:
                - img [ref=e771]
                - generic [ref=e774]: Prestadores verificados
              - generic [ref=e775]:
                - img [ref=e776]
                - generic [ref=e779]: Resposta rápida
              - generic [ref=e780]:
                - img [ref=e781]
                - generic [ref=e783]: Satisfação garantida
              - generic [ref=e784]:
                - img [ref=e785]
                - generic [ref=e790]: Compare antes de contratar
          - generic [ref=e791]:
            - button "Começar agora" [ref=e792]:
              - text: Começar agora
              - img
            - link "Buscar prestadores" [ref=e793] [cursor=pointer]:
              - /url: "#vitrine-resultados"
              - img
              - text: Buscar prestadores
          - button "Voltar ao topo" [ref=e795]:
            - img [ref=e796]
            - text: Voltar ao topo
      - generic [ref=e799]:
        - generic [ref=e800]:
          - generic [ref=e801]:
            - img
            - text: Simulador de preços
          - heading "Quanto custa? Simule agora" [level=2] [ref=e802]
          - paragraph [ref=e803]: Estime o valor do serviço em 3 passos rápidos. Sem compromisso, sem cadastro.
        - generic [ref=e804]:
          - generic [ref=e805]: "1"
          - generic [ref=e807]: "2"
          - generic [ref=e809]: "3"
        - generic [ref=e812]:
          - heading "1. Qual serviço você precisa?" [level=3] [ref=e813]
          - paragraph [ref=e814]: Selecione a categoria do serviço
          - generic [ref=e815]:
            - button "Elétrica" [ref=e816]:
              - img [ref=e818]
              - generic [ref=e820]: Elétrica
            - button "Hidráulica" [ref=e821]:
              - img [ref=e823]
              - generic [ref=e826]: Hidráulica
            - button "Pintura" [ref=e827]:
              - img [ref=e829]
              - generic [ref=e833]: Pintura
            - button "Alvenaria" [ref=e834]:
              - img [ref=e836]
              - generic [ref=e838]: Alvenaria
            - button "Pisos" [ref=e839]:
              - img [ref=e841]
              - generic [ref=e843]: Pisos
            - button "Pós-obra" [ref=e844]:
              - img [ref=e846]
              - generic [ref=e851]: Pós-obra
            - button "Residencial" [ref=e852]:
              - img [ref=e854]
              - generic [ref=e857]: Residencial
      - region "Parceiros e imprensa" [ref=e858]:
        - generic [ref=e859]:
          - paragraph [ref=e861]: Referência no mercado
          - generic [ref=e863]:
            - generic [ref=e866]: G1
            - generic [ref=e869]: Folha de S.Paulo
            - generic [ref=e872]: Valor Econômico
            - generic [ref=e875]: Exame
            - generic [ref=e878]: InfoMoney
            - generic [ref=e881]: Startups
            - generic [ref=e884]: Sebrae
            - generic [ref=e887]: ABES
          - paragraph [ref=e888]: + de 6.000 prestadores confiam no Severinno
      - region "Avaliações de clientes" [ref=e889]:
        - generic:
          - generic:
            - img
        - generic [ref=e891]:
          - generic [ref=e892]:
            - img [ref=e893]
            - text: Avaliações reais
          - heading "O que nossos clientes dizem" [level=2] [ref=e895]
          - paragraph [ref=e896]: Avaliações de clientes após a conclusão do serviço.
      - generic [ref=e961]:
        - generic [ref=e964]:
          - generic [ref=e965]:
            - img [ref=e967]
            - generic [ref=e972]: "0"
            - paragraph [ref=e973]: Prestadores verificados
          - generic [ref=e974]:
            - img [ref=e976]
            - generic [ref=e978]: "0"
            - paragraph [ref=e979]: Serviços cadastrados
          - generic [ref=e980]:
            - img [ref=e982]
            - generic [ref=e985]: "0"
            - paragraph [ref=e986]: Serviços concluídos
          - generic [ref=e987]:
            - img [ref=e989]
            - generic [ref=e992]: 0.0/5
            - paragraph [ref=e993]: Nota média
        - generic [ref=e995]:
          - generic [ref=e996]:
            - generic [ref=e997]:
              - img [ref=e998]
              - text: Por que Severinno?
            - heading "Confiança em cada agendamento" [level=2] [ref=e1001]
            - paragraph [ref=e1002]: Mais que um diretório de serviços — um ecossistema pensado para proteger você e o prestador. Da verificação ao pagamento, cada etapa foi desenhada para a sua tranquilidade.
            - link "Pular para FAQ" [ref=e1004] [cursor=pointer]:
              - /url: "#faq"
              - img [ref=e1005]
              - text: Pular para FAQ
          - generic [ref=e1008]:
            - generic [ref=e1011]:
              - generic [ref=e1012]:
                - img [ref=e1014]
                - button "Saiba mais sobre Prestadores verificados" [ref=e1017]:
                  - img [ref=e1018]
              - heading "Prestadores verificados" [level=3] [ref=e1021]
              - paragraph [ref=e1022]: João verificou 3 documentos antes de aprovar o prestador. Você só vê profissionais validados.
              - button "Saiba mais" [ref=e1023]:
                - text: Saiba mais
                - img [ref=e1024]
            - generic [ref=e1028]:
              - generic [ref=e1029]:
                - img [ref=e1031]
                - button "Saiba mais sobre Pagamento protegido" [ref=e1034]:
                  - img [ref=e1035]
              - heading "Pagamento protegido" [level=3] [ref=e1038]
              - paragraph [ref=e1039]: O valor só é liberado ao prestador após você confirmar que ficou satisfeito com o serviço.
              - button "Saiba mais" [ref=e1040]:
                - text: Saiba mais
                - img [ref=e1041]
            - generic [ref=e1045]:
              - generic [ref=e1046]:
                - img [ref=e1048]
                - button "Saiba mais sobre Resposta rápida" [ref=e1051]:
                  - img [ref=e1052]
              - heading "Resposta rápida" [level=3] [ref=e1055]
              - paragraph [ref=e1056]: Prestadores comprometidos a responder em até 24h. Acompanhe o status em tempo real.
              - button "Saiba mais" [ref=e1057]:
                - text: Saiba mais
                - img [ref=e1058]
            - generic [ref=e1062]:
              - generic [ref=e1063]:
                - img [ref=e1065]
                - button "Saiba mais sobre Avaliações reais" [ref=e1067]:
                  - img [ref=e1068]
              - heading "Avaliações reais" [level=3] [ref=e1071]
              - paragraph [ref=e1072]: Apenas clientes que concluíram o serviço podem avaliar. Sem falsas avaliações.
              - button "Saiba mais" [ref=e1073]:
                - text: Saiba mais
                - img [ref=e1074]
            - generic [ref=e1078]:
              - generic [ref=e1079]:
                - img [ref=e1081]
                - button "Saiba mais sobre Próximo de você" [ref=e1084]:
                  - img [ref=e1085]
              - heading "Próximo de você" [level=3] [ref=e1088]
              - paragraph [ref=e1089]: Geolocalização inteligente mostra os melhores prestadores na sua região.
              - button "Saiba mais" [ref=e1090]:
                - text: Saiba mais
                - img [ref=e1091]
            - generic [ref=e1095]:
              - generic [ref=e1096]:
                - img [ref=e1098]
                - button "Saiba mais sobre Suporte humano" [ref=e1100]:
                  - img [ref=e1101]
              - heading "Suporte humano" [level=3] [ref=e1104]
              - paragraph [ref=e1105]: Equipe disponível para mediar disputas, tirar dúvidas e garantir uma experiência justa.
              - button "Saiba mais" [ref=e1106]:
                - text: Saiba mais
                - img [ref=e1107]
        - generic [ref=e1110]:
          - img [ref=e1111]
          - paragraph [ref=e1113]: "Garantia Severinno: seu dinheiro de volta se o serviço não for bem-feito."
          - link "Saiba mais" [ref=e1114] [cursor=pointer]:
            - /url: "#faq"
            - text: Saiba mais
            - img [ref=e1115]
      - generic [ref=e1118]:
        - generic [ref=e1119]:
          - generic [ref=e1120]:
            - img [ref=e1121]
            - text: Destaque da semana
          - heading "Profissional em destaque" [level=2] [ref=e1127]
          - paragraph [ref=e1128]: Conheça um dos nossos prestadores mais bem avaliados.
        - generic [ref=e1132]:
          - generic [ref=e1133]:
            - generic [ref=e1134]:
              - img [ref=e1137]
              - img [ref=e1141]
              - generic [ref=e1145]:
                - img [ref=e1146]
                - text: Top
            - generic [ref=e1148]:
              - generic [ref=e1149]:
                - heading "Maria Silva" [level=3] [ref=e1150]
                - generic [ref=e1151]:
                  - generic [ref=e1152]:
                    - img [ref=e1153]
                    - text: São Paulo
                  - generic [ref=e1156]: 3 km
                  - generic [ref=e1157]:
                    - img [ref=e1158]
                    - text: Membro desde 2023
              - generic [ref=e1160]:
                - generic [ref=e1161]:
                  - img [ref=e1162]
                  - generic [ref=e1164]: "4.8"
                - generic [ref=e1165]: (42 avaliações)
              - generic [ref=e1166]:
                - generic [ref=e1167]:
                  - img
                  - text: 230 serviços concluídos
                - generic [ref=e1168]:
                  - img
                  - text: Responde em ~30min
              - generic [ref=e1169]:
                - paragraph [ref=e1170]: Serviços
                - generic [ref=e1172]:
                  - generic [ref=e1173]: Instalação Elétrica
                  - generic [ref=e1174]: R$ 120,00
              - paragraph [ref=e1176]: Especialista em instalações elétricas residenciais com mais de 10 anos de experiência.
              - generic [ref=e1177]:
                - generic [ref=e1178]:
                  - generic "Maria S." [ref=e1179]: M
                  - generic "João P." [ref=e1180]: J
                  - generic "Ana L." [ref=e1181]: A
                - generic [ref=e1182]: Clientes recentes
          - generic [ref=e1183]:
            - generic [ref=e1184]:
              - button "Pedir orçamento" [ref=e1185]:
                - img
                - text: Pedir orçamento
              - button "Ver perfil completo" [ref=e1186]:
                - text: Ver perfil completo
                - img
            - button "Enviar mensagem" [ref=e1188]:
              - img
              - text: Enviar mensagem
      - generic [ref=e1192]:
        - generic [ref=e1193]:
          - generic [ref=e1194]:
            - generic [ref=e1195]:
              - img [ref=e1196]
              - text: Perguntas frequentes
            - heading "Tire suas dúvidas antes de contratar" [level=2] [ref=e1199]
            - paragraph [ref=e1200]: Reunimos as perguntas mais comuns sobre como o Severinno funciona — do cadastro ao pagamento.
          - generic [ref=e1201]:
            - img [ref=e1202]
            - textbox "Buscar nas perguntas frequentes" [ref=e1205]:
              - /placeholder: Buscar nas dúvidas…
          - generic [ref=e1206]:
            - paragraph [ref=e1207]: Filtrar por categoria
            - generic [ref=e1208]:
              - button "Filtrar por Geral" [ref=e1209]:
                - img [ref=e1210]
                - text: Geral
                - generic [ref=e1213]: (2)
              - button "Filtrar por Pagamento" [ref=e1214]:
                - img [ref=e1215]
                - text: Pagamento
                - generic [ref=e1217]: (2)
              - button "Filtrar por Agendamento" [ref=e1218]:
                - img [ref=e1219]
                - text: Agendamento
                - generic [ref=e1221]: (2)
              - button "Filtrar por Prestadores" [ref=e1222]:
                - img [ref=e1223]
                - text: Prestadores
                - generic [ref=e1227]: (2)
              - button "Filtrar por Segurança" [ref=e1228]:
                - img [ref=e1229]
                - text: Segurança
                - generic [ref=e1232]: (2)
          - generic [ref=e1233]:
            - paragraph [ref=e1234]: Perguntas mais frequentes
            - list [ref=e1235]:
              - listitem [ref=e1236]:
                - button "Como funciona o Severinno?" [ref=e1237]:
                  - img [ref=e1238]
                  - generic [ref=e1240]: Como funciona o Severinno?
              - listitem [ref=e1241]:
                - button "Preciso pagar para me cadastrar?" [ref=e1242]:
                  - img [ref=e1243]
                  - generic [ref=e1245]: Preciso pagar para me cadastrar?
              - listitem [ref=e1246]:
                - button "Como faço para agendar um serviço?" [ref=e1247]:
                  - img [ref=e1248]
                  - generic [ref=e1250]: Como faço para agendar um serviço?
              - listitem [ref=e1251]:
                - button "E se o serviço não for bem-feito?" [ref=e1252]:
                  - img [ref=e1253]
                  - generic [ref=e1255]: E se o serviço não for bem-feito?
          - generic [ref=e1257]:
            - img [ref=e1259]
            - generic [ref=e1261]:
              - paragraph [ref=e1262]: Ainda tem dúvidas?
              - paragraph [ref=e1263]: Cadastre-se grátis e converse diretamente com prestadores verificados. Sem compromisso.
              - generic [ref=e1264]:
                - button "Cadastrar grátis" [ref=e1265]
                - link "Fale conosco" [ref=e1266] [cursor=pointer]:
                  - /url: "#faq"
                  - img
                  - text: Fale conosco
        - generic [ref=e1267]:
          - generic [ref=e1269]:
            - generic [ref=e1271]:
              - heading "01 Como funciona o Severinno? Geral" [level=3] [ref=e1272]:
                - button "01 Como funciona o Severinno? Geral" [expanded] [ref=e1273]:
                  - generic [ref=e1274]:
                    - generic [ref=e1275]: "01"
                    - generic [ref=e1276]: Como funciona o Severinno?
                    - generic [ref=e1277]:
                      - img
                      - text: Geral
                  - img
              - region "01 Como funciona o Severinno? Geral" [ref=e1278]:
                - generic [ref=e1280]:
                  - paragraph [ref=e1281]: O Severinno conecta você a prestadores de serviço verificados próximos à sua localização. Você busca o serviço, compara avaliações reais de outros clientes, pede orçamento grátis e agenda — tudo pela plataforma. O pagamento só é liberado após você confirmar a conclusão do serviço.
                  - paragraph [ref=e1282]: "Ex: Maria precisava de um eletricista. Buscou na plataforma, comparou 3 profissionais e contratou o mais bem avaliado — tudo em 5 minutos."
            - heading "02 Preciso pagar para me cadastrar? Geral" [level=3] [ref=e1285]:
              - button "02 Preciso pagar para me cadastrar? Geral" [ref=e1286]:
                - generic [ref=e1287]:
                  - generic [ref=e1288]: "02"
                  - generic [ref=e1289]: Preciso pagar para me cadastrar?
                  - generic [ref=e1290]:
                    - img
                    - text: Geral
                - img
            - heading "03 Como os prestadores são verificados? Prestadores" [level=3] [ref=e1293]:
              - button "03 Como os prestadores são verificados? Prestadores" [ref=e1294]:
                - generic [ref=e1295]:
                  - generic [ref=e1296]: "03"
                  - generic [ref=e1297]: Como os prestadores são verificados?
                  - generic [ref=e1298]:
                    - img
                    - text: Prestadores
                - img
            - heading "04 Posso me tornar um prestador no Severinno? Prestadores" [level=3] [ref=e1301]:
              - button "04 Posso me tornar um prestador no Severinno? Prestadores" [ref=e1302]:
                - generic [ref=e1303]:
                  - generic [ref=e1304]: "04"
                  - generic [ref=e1305]: Posso me tornar um prestador no Severinno?
                  - generic [ref=e1306]:
                    - img
                    - text: Prestadores
                - img
            - heading "05 Como faço para agendar um serviço? Agendamento" [level=3] [ref=e1309]:
              - button "05 Como faço para agendar um serviço? Agendamento" [ref=e1310]:
                - generic [ref=e1311]:
                  - generic [ref=e1312]: "05"
                  - generic [ref=e1313]: Como faço para agendar um serviço?
                  - generic [ref=e1314]:
                    - img
                    - text: Agendamento
                - img
            - heading "06 Posso remarcar ou cancelar um agendamento? Agendamento" [level=3] [ref=e1317]:
              - button "06 Posso remarcar ou cancelar um agendamento? Agendamento" [ref=e1318]:
                - generic [ref=e1319]:
                  - generic [ref=e1320]: "06"
                  - generic [ref=e1321]: Posso remarcar ou cancelar um agendamento?
                  - generic [ref=e1322]:
                    - img
                    - text: Agendamento
                - img
            - heading "07 Como funciona o pagamento? Pagamento" [level=3] [ref=e1325]:
              - button "07 Como funciona o pagamento? Pagamento" [ref=e1326]:
                - generic [ref=e1327]:
                  - generic [ref=e1328]: "07"
                  - generic [ref=e1329]: Como funciona o pagamento?
                  - generic [ref=e1330]:
                    - img
                    - text: Pagamento
                - img
            - heading "08 O orçamento tem compromisso? Pagamento" [level=3] [ref=e1333]:
              - button "08 O orçamento tem compromisso? Pagamento" [ref=e1334]:
                - generic [ref=e1335]:
                  - generic [ref=e1336]: "08"
                  - generic [ref=e1337]: O orçamento tem compromisso?
                  - generic [ref=e1338]:
                    - img
                    - text: Pagamento
                - img
            - heading "09 E se o serviço não for bem-feito? Segurança" [level=3] [ref=e1341]:
              - button "09 E se o serviço não for bem-feito? Segurança" [ref=e1342]:
                - generic [ref=e1343]:
                  - generic [ref=e1344]: "09"
                  - generic [ref=e1345]: E se o serviço não for bem-feito?
                  - generic [ref=e1346]:
                    - img
                    - text: Segurança
                - img
            - heading "10 Meus dados pessoais estão seguros? Segurança" [level=3] [ref=e1349]:
              - button "10 Meus dados pessoais estão seguros? Segurança" [ref=e1350]:
                - generic [ref=e1351]:
                  - generic [ref=e1352]: "10"
                  - generic [ref=e1353]: Meus dados pessoais estão seguros?
                  - generic [ref=e1354]:
                    - img
                    - text: Segurança
                - img
          - generic [ref=e1355]:
            - paragraph [ref=e1356]: 10 de 10 dúvidas
            - button "Voltar ao topo da seção" [ref=e1357]:
              - img [ref=e1358]
              - text: Topo
      - generic [ref=e1362]:
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
        - generic [ref=e1367]:
          - generic [ref=e1368]:
            - generic [ref=e1370]:
              - img [ref=e1371]
              - text: Comece agora mesmo
            - heading "Encontre o serviço que você precisa" [level=2] [ref=e1373]
            - paragraph [ref=e1374]: Navegue pela vitrine, salve seus favoritos e agende com confiança. Tudo em um só lugar.
            - list [ref=e1375]:
              - generic [ref=e1376]:
                - listitem [ref=e1377]:
                  - img [ref=e1378]
                  - text: Cadastro gratuito
                - listitem [ref=e1381]:
                  - img [ref=e1382]
                  - text: Sem taxa de serviço
                - listitem [ref=e1385]:
                  - img [ref=e1386]
                  - text: Orçamento sem compromisso
            - button "Buscar prestadores" [ref=e1394]:
              - img
              - text: Buscar prestadores
              - generic [ref=e1395]:
                - img
          - generic [ref=e1396]:
            - generic [ref=e1397]:
              - heading "O que vem depois?" [level=3] [ref=e1398]
              - paragraph [ref=e1399]: Três passos simples e você estará agendando
              - generic [ref=e1400]:
                - img [ref=e1401]
                - generic [ref=e1402]:
                  - generic [ref=e1403]:
                    - generic [ref=e1405]: "1"
                    - generic [ref=e1406]:
                      - paragraph [ref=e1407]: Cadastre-se grátis
                      - paragraph [ref=e1408]: ~30s
                  - generic [ref=e1409]:
                    - generic [ref=e1411]: "2"
                    - generic [ref=e1412]:
                      - paragraph [ref=e1413]: Busque e compare
                      - paragraph [ref=e1414]: ~2 min
                  - generic [ref=e1415]:
                    - generic [ref=e1417]: "3"
                    - generic [ref=e1418]:
                      - paragraph [ref=e1419]: Agende com confiança
                      - paragraph [ref=e1420]: ~5 min
              - generic [ref=e1421]:
                - generic [ref=e1422]:
                  - img [ref=e1423]
                  - text: Sem compromisso
                - generic [ref=e1427]:
                  - img [ref=e1428]
                  - text: Cancele quando quiser
                - generic [ref=e1431]:
                  - img [ref=e1432]
                  - text: Suporte 24h
              - link "Saiba mais sobre pagamento protegido" [ref=e1435] [cursor=pointer]:
                - /url: "#faq"
                - img [ref=e1436]
                - text: Saiba mais sobre pagamento protegido
            - generic [ref=e1440]:
              - generic [ref=e1444]: Cliente
              - generic [ref=e1445]:
                - img [ref=e1449]
                - generic [ref=e1451]: Prestador
              - img [ref=e1456]
              - img [ref=e1458]
              - img [ref=e1462]
              - img [ref=e1465]
              - img [ref=e1469]
        - generic [ref=e1473]:
          - img [ref=e1474]
          - generic [ref=e1477]:
            - paragraph [ref=e1478]: “Encontrei um encanador em 10 minutos, paguei menos do que esperava e ainda pude avaliar o serviço. Recomendo demais!”
            - paragraph [ref=e1479]: — Ana P., Cliente, São Paulo
        - generic [ref=e1480]:
          - generic [ref=e1481]:
            - img [ref=e1482]
            - text: Sem compromisso
          - generic [ref=e1486]:
            - img [ref=e1487]
            - text: Cancele quando quiser
          - generic [ref=e1490]:
            - img [ref=e1491]
            - text: Pagamento protegido
    - contentinfo [ref=e1493]:
      - generic [ref=e1495]:
        - generic [ref=e1496]:
          - paragraph [ref=e1497]: Receba novidades e dicas de serviços
          - paragraph [ref=e1498]: Cadastre-se e receba ofertas exclusivas. Cancele quando quiser.
        - generic [ref=e1499]:
          - generic [ref=e1500]:
            - img [ref=e1501]
            - textbox "E-mail para newsletter" [ref=e1504]:
              - /placeholder: Seu e-mail
          - button "Assinar" [disabled]:
            - img
            - text: Assinar
      - generic [ref=e1505]:
        - generic [ref=e1506]:
          - generic [ref=e1507]:
            - generic [ref=e1508]:
              - img [ref=e1510]
              - generic [ref=e1513]: Severinno
            - paragraph [ref=e1514]: Marketplace de serviços com geolocalização. Encontre prestadores verificados, próximos e bem avaliados.
            - list "Redes sociais" [ref=e1515]:
              - listitem [ref=e1516]:
                - link "GitHub" [ref=e1517] [cursor=pointer]:
                  - /url: https://github.com
                  - img [ref=e1518]
              - listitem [ref=e1521]:
                - link "Twitter" [ref=e1522] [cursor=pointer]:
                  - /url: https://twitter.com
                  - img [ref=e1523]
              - listitem [ref=e1525]:
                - link "Instagram" [ref=e1526] [cursor=pointer]:
                  - /url: https://instagram.com
                  - img [ref=e1527]
              - listitem [ref=e1530]:
                - link "LinkedIn" [ref=e1531] [cursor=pointer]:
                  - /url: https://linkedin.com
                  - img [ref=e1532]
              - listitem [ref=e1536]:
                - link "E-mail" [ref=e1537] [cursor=pointer]:
                  - /url: mailto:contato@severinno.com
                  - img [ref=e1538]
          - navigation "Sobre" [ref=e1541]:
            - heading "Sobre" [level=3] [ref=e1542]:
              - img [ref=e1543]
              - text: Sobre
            - list [ref=e1546]:
              - listitem [ref=e1547]:
                - button "Como funciona" [ref=e1548]
              - listitem [ref=e1549]:
                - button "Quem somos" [ref=e1550]
              - listitem [ref=e1551]:
                - button "Termos de uso" [ref=e1552]
              - listitem [ref=e1553]:
                - button "Privacidade" [ref=e1554]
          - navigation "Para profissionais" [ref=e1555]:
            - heading "Para profissionais" [level=3] [ref=e1556]:
              - img [ref=e1557]
              - text: Para profissionais
            - list [ref=e1560]:
              - listitem [ref=e1561]:
                - button "Cadastre-se" [ref=e1562]
              - listitem [ref=e1563]:
                - button "Meu painel" [ref=e1564]
              - listitem [ref=e1565]:
                - button "Central de ajuda" [ref=e1566]
          - navigation "Precisa de ajuda?" [ref=e1567]:
            - heading "Precisa de ajuda?" [level=3] [ref=e1568]:
              - img [ref=e1569]
              - text: Precisa de ajuda?
            - list [ref=e1571]:
              - listitem [ref=e1572]:
                - button "Perguntas frequentes" [ref=e1573]
              - listitem [ref=e1574]:
                - button "Segurança" [ref=e1575]
              - listitem [ref=e1576]:
                - button "Reportar problema" [ref=e1577]
          - generic [ref=e1578]:
            - heading "Contato" [level=3] [ref=e1579]:
              - img [ref=e1580]
              - text: Contato
            - list [ref=e1585]:
              - listitem [ref=e1586]:
                - img [ref=e1587]
                - link "contato@severinno.com" [ref=e1590] [cursor=pointer]:
                  - /url: mailto:contato@severinno.com
              - listitem [ref=e1591]:
                - img [ref=e1592]
                - text: São Paulo, Brasil
            - button "Fale conosco" [ref=e1595]:
              - img
              - text: Fale conosco
        - generic [ref=e1596]:
          - paragraph [ref=e1597]: © 2026 Severinno Marketplace. Todos os direitos reservados.
          - paragraph [ref=e1598]:
            - text: Feito com
            - img [ref=e1599]
            - text: usando tecnologia Open Source (
            - link "MapLibre" [ref=e1601] [cursor=pointer]:
              - /url: https://maplibre.org/
            - text: ·
            - link "OpenStreetMap" [ref=e1602] [cursor=pointer]:
              - /url: https://www.openstreetmap.org/copyright
            - text: )
    - button "Voltar ao topo" [ref=e1604]:
      - img
    - button "Abrir assistente virtual" [ref=e1605]:
      - img [ref=e1606]
    - generic [ref=e1610]:
      - generic [ref=e1611]:
        - img [ref=e1613]
        - generic [ref=e1615]:
          - paragraph [ref=e1616]: Usamos cookies para melhorar sua experiência
          - paragraph [ref=e1617]:
            - text: Utilizamos cookies essenciais para o funcionamento do site e cookies de análise para melhorar nossos serviços.
            - button "Política de privacidade" [ref=e1618]
      - generic [ref=e1619]:
        - button "Recusar" [ref=e1620]
        - button "Aceitar" [ref=e1621]:
          - img
          - text: Aceitar
        - button "Dispensar" [ref=e1622]:
          - img [ref=e1623]
  - region "Notifications alt+T"
  - generic [active]:
    - generic [ref=e1628]:
      - generic [ref=e1629]:
        - generic [ref=e1630]:
          - navigation [ref=e1631]:
            - button "previous" [disabled] [ref=e1632]:
              - img "previous" [ref=e1633]
            - generic [ref=e1635]:
              - generic [ref=e1636]: 1/
              - text: "1"
            - button "next" [disabled] [ref=e1637]:
              - img "next" [ref=e1638]
          - img
        - generic [ref=e1640]:
          - link "Next.js 16.1.3 (stale) Turbopack" [ref=e1641] [cursor=pointer]:
            - /url: https://nextjs.org/docs/messages/version-staleness
            - img [ref=e1642]
            - generic "There is a newer version (16.2.11) available, upgrade recommended!" [ref=e1644]: Next.js 16.1.3 (stale)
            - generic [ref=e1645]: Turbopack
          - img
      - dialog "Build Error" [ref=e1647]:
        - generic [ref=e1650]:
          - generic [ref=e1651]:
            - generic [ref=e1652]:
              - generic [ref=e1654]: Build Error
              - generic [ref=e1655]:
                - button "Copy Error Info" [ref=e1656] [cursor=pointer]:
                  - img [ref=e1657]
                - button "No related documentation found" [disabled] [ref=e1659]:
                  - img [ref=e1660]
                - button "Attach Node.js inspector" [ref=e1662] [cursor=pointer]:
                  - img [ref=e1663]
            - generic [ref=e1672]: Reading source code for parsing failed
          - generic [ref=e1674]:
            - generic [ref=e1676]:
              - img [ref=e1678]
              - generic [ref=e1682]: ./.freebuff/worktrees/thmrzp9vv9y86o/src/lib/api-server.ts
              - button "Open in editor" [ref=e1683] [cursor=pointer]:
                - img [ref=e1685]
            - generic [ref=e1689]: "Reading source code for parsing failed An unexpected error happened while trying to read the source code to parse: failed to convert rope into string Caused by: - invalid utf-8 sequence of 1 bytes from index 5415 Import trace: App Route: ./.freebuff/worktrees/thmrzp9vv9y86o/src/lib/api-server.ts ./.freebuff/worktrees/thmrzp9vv9y86o/src/app/api/auth/me/route.ts"
        - generic [ref=e1690]: "1"
        - generic [ref=e1691]: "2"
    - generic [ref=e1696] [cursor=pointer]:
      - button "Open Next.js Dev Tools" [ref=e1697]:
        - img [ref=e1698]
      - button "Open issues overlay" [ref=e1702]:
        - generic [ref=e1703]:
          - generic [ref=e1704]: "0"
          - generic [ref=e1705]: "1"
        - generic [ref=e1706]: Issue
  - alert [ref=e1707]
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