# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: quote-flow.spec.ts >> QuoteModal — Cliente Autenticado >> 5. step 1 — seleciona prestador via combobox
- Location: e2e\quote-flow.spec.ts:219:7

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
    7 × waiting for element to be visible, enabled and stable
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
    8 × waiting for element to be visible, enabled and stable
      - element is visible, enabled and stable
      - scrolling into view if needed
      - done scrolling
      - <nextjs-portal></nextjs-portal> from <script data-nextjs-dev-overlay="true">…</script> subtree intercepts pointer events
    - retrying click action
      - waiting 500ms

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
          - button "Notificações" [ref=e32]:
            - img
          - button "Favoritos" [ref=e33]:
            - img
          - button "Menu da conta" [ref=e34]:
            - generic [ref=e37]: TU
            - generic [ref=e39]: Test
            - img [ref=e40]
    - main [ref=e42]:
      - generic [ref=e49]:
        - generic [ref=e50]:
          - generic [ref=e52]:
            - img [ref=e53]
            - text: Marketplace de serviços verificados
          - heading "Prestadores de serviço verificados, perto de você." [level=1] [ref=e56]
          - paragraph [ref=e57]: Compare avaliações reais, peça orçamento grátis e agende — encanador, eletricista, pintor e mais. Você escolhe o profissional.
          - generic [ref=e59]:
            - generic [ref=e60]:
              - img [ref=e61]
              - textbox "Serviço buscado" [ref=e64]:
                - /placeholder: "O que você precisa? Ex.: encanador, pintura…"
            - generic [ref=e65]:
              - img [ref=e66]
              - textbox "Localização" [ref=e69]:
                - /placeholder: CEP ou cidade
            - button "Buscar" [ref=e70]:
              - img
              - text: Buscar
          - generic [ref=e71]:
            - generic [ref=e72]: "Mais buscados:"
            - button "Encanador" [ref=e73]:
              - generic [ref=e74]: 🔧
              - text: Encanador
            - button "Eletricista" [ref=e75]:
              - generic [ref=e76]: 💡
              - text: Eletricista
            - button "Pintor" [ref=e77]:
              - generic [ref=e78]: 🎨
              - text: Pintor
            - button "Diarista" [ref=e79]:
              - generic [ref=e80]: 🧹
              - text: Diarista
            - button "Pedreiro" [ref=e81]:
              - generic [ref=e82]: 🧱
              - text: Pedreiro
            - button "Jardineiro" [ref=e83]:
              - generic [ref=e84]: 🌿
              - text: Jardineiro
          - button "Usar minha localização" [ref=e85]:
            - img [ref=e86]
            - text: Usar minha localização
          - generic [ref=e89]:
            - button "Cadastrar grátis" [ref=e90]:
              - text: Cadastrar grátis
              - img
            - button "Ver como funciona" [ref=e91]
          - paragraph [ref=e92]: Cadastro grátis · Orçamento sem compromisso · Você escolhe o profissional
          - list [ref=e93]:
            - listitem "Documentos validados e identidade confirmada" [ref=e94]:
              - img [ref=e96]
              - generic [ref=e99]: Prestadores verificados
            - listitem "Avaliações de clientes após a conclusão do serviço" [ref=e100]:
              - img [ref=e102]
              - generic [ref=e104]: Avaliações reais
            - listitem "Pagamento só é liberado após você marcar como concluído" [ref=e105]:
              - img [ref=e107]
              - generic [ref=e110]: Pagamento seguro
        - generic [ref=e113]:
          - generic [ref=e119]: Atividade ao vivo
          - generic [ref=e121]:
            - img [ref=e122]
            - paragraph [ref=e124]: Carregando atividades…
      - region "Atividade recente na plataforma" [ref=e126]:
        - generic [ref=e127]:
          - generic [ref=e129]: Atividade recente
          - generic [ref=e133]:
            - generic [ref=e135]:
              - generic [ref=e136]:
                - generic [ref=e137]: ⚡
                - text: Maria contratou um eletricista em São Paulo
              - generic [ref=e139]:
                - generic [ref=e140]: ⭐
                - text: João avaliou ★★★★★ o prestador Ricardo
              - generic [ref=e142]:
                - generic [ref=e143]: 🎨
                - text: "Nova avaliação: 4.9 para Serviços de Pintura"
              - generic [ref=e145]:
                - generic [ref=e146]: 🔧
                - text: Ana pediu orçamento para encanador
              - generic [ref=e148]:
                - generic [ref=e149]: ✅
                - text: Pedro se cadastrou como prestador verificado
              - generic [ref=e151]:
                - generic [ref=e152]: 📋
                - text: 12 orçamentos enviados hoje
              - generic [ref=e154]:
                - generic [ref=e155]: ⚡
                - text: Maria contratou um eletricista em São Paulo
              - generic [ref=e157]:
                - generic [ref=e158]: ⭐
                - text: João avaliou ★★★★★ o prestador Ricardo
              - generic [ref=e160]:
                - generic [ref=e161]: 🎨
                - text: "Nova avaliação: 4.9 para Serviços de Pintura"
              - generic [ref=e163]:
                - generic [ref=e164]: 🔧
                - text: Ana pediu orçamento para encanador
              - generic [ref=e166]:
                - generic [ref=e167]: ✅
                - text: Pedro se cadastrou como prestador verificado
              - generic [ref=e169]:
                - generic [ref=e170]: 📋
                - text: 12 orçamentos enviados hoje
            - generic [ref=e174]:
              - generic [ref=e175]:
                - generic [ref=e176]: 🧹
                - text: Carlos agendou limpeza de quintal em Belo Horizonte
              - generic [ref=e178]:
                - generic [ref=e179]: ⭐
                - text: Fernanda avaliou ★★★★★ o prestador José
              - generic [ref=e181]:
                - generic [ref=e182]: 🛡️
                - text: 8 novos prestadores verificados esta semana
              - generic [ref=e184]:
                - generic [ref=e185]: 🎨
                - text: Luciana contratou um pintor no Rio de Janeiro
              - generic [ref=e187]:
                - generic [ref=e188]: 🚿
                - text: "Orçamento aceito: reforma de banheiro em Curitiba"
              - generic [ref=e190]:
                - generic [ref=e191]: 🏆
                - text: 5.200 serviços concluídos este mês
              - generic [ref=e193]:
                - generic [ref=e194]: 🧹
                - text: Carlos agendou limpeza de quintal em Belo Horizonte
              - generic [ref=e196]:
                - generic [ref=e197]: ⭐
                - text: Fernanda avaliou ★★★★★ o prestador José
              - generic [ref=e199]:
                - generic [ref=e200]: 🛡️
                - text: 8 novos prestadores verificados esta semana
              - generic [ref=e202]:
                - generic [ref=e203]: 🎨
                - text: Luciana contratou um pintor no Rio de Janeiro
              - generic [ref=e205]:
                - generic [ref=e206]: 🚿
                - text: "Orçamento aceito: reforma de banheiro em Curitiba"
              - generic [ref=e208]:
                - generic [ref=e209]: 🏆
                - text: 5.200 serviços concluídos este mês
      - region "Categorias de serviços" [ref=e211]:
        - generic [ref=e212]:
          - generic:
            - img
          - generic [ref=e214]:
            - generic [ref=e215]:
              - img [ref=e216]
              - text: Explore categorias
            - heading "Encontre o serviço ideal" [level=2] [ref=e219]
            - paragraph [ref=e220]: Serviços verificados perto de você — … carregando categorias
          - generic "Carregando categorias" [ref=e221]
      - region "Resultados da busca" [ref=e262]:
        - generic [ref=e263]:
          - complementary [ref=e264]:
            - generic [ref=e266]:
              - generic [ref=e267]:
                - heading "Filtros" [level=2] [ref=e268]:
                  - img [ref=e269]
                  - text: Filtros
                - button "Limpar filtros" [ref=e270]
              - generic [ref=e271]:
                - generic [ref=e272]: Buscar
                - generic [ref=e273]:
                  - img [ref=e274]
                  - textbox "Buscar" [ref=e277]:
                    - /placeholder: Serviço, prestador…
              - generic [ref=e278]:
                - generic [ref=e279]:
                  - generic [ref=e280]: Raio de busca
                  - generic [ref=e281]: 15 km
                - generic "Raio de busca em quilômetros" [ref=e282]:
                  - slider [ref=e286]
                - generic [ref=e287]:
                  - generic [ref=e288]: 1 km
                  - generic [ref=e289]: 50 km
              - generic [ref=e290]:
                - generic [ref=e291]: Categoria
                - combobox [ref=e292]:
                  - generic: Todas as categorias
                  - img
              - generic [ref=e293]:
                - generic [ref=e294]: Ordenar por
                - radiogroup "Ordenar por" [ref=e295]:
                  - radio "Melhor avaliação" [checked] [ref=e296]
                  - radio "Mais próximos" [ref=e297]
              - generic [ref=e298]:
                - generic [ref=e299]: Avaliação mínima
                - radiogroup [ref=e300]:
                  - generic [ref=e301] [cursor=pointer]:
                    - radio "Todas" [checked] [ref=e302]:
                      - img [ref=e303]
                    - generic [ref=e305]: Todas
                  - generic [ref=e306] [cursor=pointer]:
                    - radio "3+" [ref=e307]
                    - generic [ref=e308]: 3+
                  - generic [ref=e309] [cursor=pointer]:
                    - radio "4+" [ref=e310]
                    - generic [ref=e311]: 4+
                  - generic [ref=e312] [cursor=pointer]:
                    - radio "5" [ref=e313]
                    - generic [ref=e314]: "5"
              - generic [ref=e315] [cursor=pointer]:
                - generic [ref=e316]:
                  - img [ref=e317]
                  - generic [ref=e319]: Somente verificados
                - switch "Somente verificados" [ref=e320]
              - button "Ver 3 resultados" [disabled]
          - generic [ref=e321]:
            - generic [ref=e323]:
              - generic [ref=e324]:
                - heading "3 prestadores encontrados" [level=2] [ref=e325]
                - paragraph [ref=e326]: Exibindo 1–3 de 3
              - generic [ref=e327]:
                - generic [ref=e328]:
                  - text: "Ordenado por:"
                  - generic [ref=e329]: Melhor avaliação
                - tablist "Visualização" [ref=e330]:
                  - tab "Lista" [selected] [ref=e331]:
                    - img [ref=e332]
                    - generic [ref=e333]: Lista
                  - tab "Mapa" [ref=e334]:
                    - img [ref=e335]
                    - generic [ref=e337]: Mapa
            - generic [ref=e339]:
              - generic [ref=e341]:
                - generic [ref=e342]:
                  - img "Capa de Maria Silva" [ref=e343]
                  - generic [ref=e345]:
                    - img [ref=e346]
                    - text: Verificado
                  - generic [ref=e349]:
                    - button "Adicionar Maria Silva à comparação" [ref=e350]:
                      - img [ref=e351]
                    - button "Adicionar Maria Silva aos favoritos" [ref=e356]:
                      - img [ref=e357]
                  - img "Maria Silva" [ref=e361]
                - generic [ref=e362]:
                  - generic [ref=e363]:
                    - button "Ver perfil de Maria Silva" [ref=e364]:
                      - heading "Maria Silva" [level=3] [ref=e365]:
                        - generic [ref=e366]: Maria Silva
                        - img [ref=e367]
                    - generic "Avaliação média" [ref=e369]:
                      - img [ref=e370]
                      - text: "4.8"
                      - generic [ref=e372]: (42)
                  - paragraph [ref=e373]: a partir de R$ 120,00
                  - generic [ref=e374]:
                    - generic [ref=e375]:
                      - img [ref=e376]
                      - text: 2,5 km
                    - generic [ref=e379]:
                      - img [ref=e380]
                      - text: São Paulo
                  - paragraph [ref=e383]: Especialista em instalações elétricas residenciais com mais de 10 anos de experiência.
                  - generic [ref=e384]:
                    - generic "Serviços concluídos com sucesso" [ref=e385]:
                      - img [ref=e386]
                      - text: 230 serviços concluídos
                    - generic "Na plataforma desde" [ref=e389]:
                      - img [ref=e390]
                      - text: desde jan. de 2023
                - generic [ref=e394]:
                  - generic [ref=e395]:
                    - img [ref=e396]
                    - generic [ref=e398]: Instalação Elétrica · a partir de R$ 120,00
                  - heading "Elétrica 1 serviço" [level=3] [ref=e401]:
                    - button "Elétrica 1 serviço" [ref=e402]:
                      - generic [ref=e404]:
                        - paragraph [ref=e405]: Elétrica
                        - paragraph [ref=e406]: 1 serviço
                      - img
                - generic [ref=e407]:
                  - button "Orçamento" [ref=e408]:
                    - img
                    - text: Orçamento
                  - button "Agendar" [ref=e409]:
                    - img
                    - text: Agendar
              - generic [ref=e411]:
                - generic [ref=e412]:
                  - img "Capa de João Pedreiro" [ref=e413]
                  - generic [ref=e415]:
                    - img [ref=e416]
                    - text: Verificado
                  - generic [ref=e419]:
                    - button "Adicionar João Pedreiro à comparação" [ref=e420]:
                      - img [ref=e421]
                    - button "Adicionar João Pedreiro aos favoritos" [ref=e426]:
                      - img [ref=e427]
                  - img "João Pedreiro" [ref=e431]
                - generic [ref=e432]:
                  - generic [ref=e433]:
                    - button "Ver perfil de João Pedreiro" [ref=e434]:
                      - heading "João Pedreiro" [level=3] [ref=e435]:
                        - generic [ref=e436]: João Pedreiro
                        - img [ref=e437]
                    - generic "Avaliação média" [ref=e439]:
                      - img [ref=e440]
                      - text: "4.8"
                      - generic [ref=e442]: (42)
                  - paragraph [ref=e443]: a partir de R$ 120,00
                  - generic [ref=e444]:
                    - generic [ref=e445]:
                      - img [ref=e446]
                      - text: 2,5 km
                    - generic [ref=e449]:
                      - img [ref=e450]
                      - text: São Paulo
                  - paragraph [ref=e453]: Especialista em instalações elétricas residenciais com mais de 10 anos de experiência.
                  - generic [ref=e454]:
                    - generic "Serviços concluídos com sucesso" [ref=e455]:
                      - img [ref=e456]
                      - text: 230 serviços concluídos
                    - generic "Na plataforma desde" [ref=e459]:
                      - img [ref=e460]
                      - text: desde jan. de 2023
                - generic [ref=e464]:
                  - generic [ref=e465]:
                    - img [ref=e466]
                    - generic [ref=e468]: Instalação Elétrica · a partir de R$ 120,00
                  - heading "Construção 1 serviço" [level=3] [ref=e471]:
                    - button "Construção 1 serviço" [ref=e472]:
                      - generic [ref=e474]:
                        - paragraph [ref=e475]: Construção
                        - paragraph [ref=e476]: 1 serviço
                      - img
                - generic [ref=e477]:
                  - button "Orçamento" [ref=e478]:
                    - img
                    - text: Orçamento
                  - button "Agendar" [ref=e479]:
                    - img
                    - text: Agendar
              - generic [ref=e481]:
                - generic [ref=e482]:
                  - img "Capa de Ana Pintora" [ref=e483]
                  - generic [ref=e485]:
                    - img [ref=e486]
                    - text: Verificado
                  - generic [ref=e489]:
                    - button "Adicionar Ana Pintora à comparação" [ref=e490]:
                      - img [ref=e491]
                    - button "Adicionar Ana Pintora aos favoritos" [ref=e496]:
                      - img [ref=e497]
                  - img "Ana Pintora" [ref=e501]
                - generic [ref=e502]:
                  - generic [ref=e503]:
                    - button "Ver perfil de Ana Pintora" [ref=e504]:
                      - heading "Ana Pintora" [level=3] [ref=e505]:
                        - generic [ref=e506]: Ana Pintora
                        - img [ref=e507]
                    - generic "Avaliação média" [ref=e509]:
                      - img [ref=e510]
                      - text: "4.8"
                      - generic [ref=e512]: (42)
                  - paragraph [ref=e513]: a partir de R$ 120,00
                  - generic [ref=e514]:
                    - generic [ref=e515]:
                      - img [ref=e516]
                      - text: 2,5 km
                    - generic [ref=e519]:
                      - img [ref=e520]
                      - text: São Paulo
                  - paragraph [ref=e523]: Especialista em instalações elétricas residenciais com mais de 10 anos de experiência.
                  - generic [ref=e524]:
                    - generic "Serviços concluídos com sucesso" [ref=e525]:
                      - img [ref=e526]
                      - text: 230 serviços concluídos
                    - generic "Na plataforma desde" [ref=e529]:
                      - img [ref=e530]
                      - text: desde jan. de 2023
                - generic [ref=e534]:
                  - generic [ref=e535]:
                    - img [ref=e536]
                    - generic [ref=e538]: Instalação Elétrica · a partir de R$ 120,00
                  - heading "Pintura 1 serviço" [level=3] [ref=e541]:
                    - button "Pintura 1 serviço" [ref=e542]:
                      - generic [ref=e544]:
                        - paragraph [ref=e545]: Pintura
                        - paragraph [ref=e546]: 1 serviço
                      - img
                - generic [ref=e547]:
                  - button "Orçamento" [ref=e548]:
                    - img
                    - text: Orçamento
                  - button "Agendar" [ref=e549]:
                    - img
                    - text: Agendar
      - region "Como funciona" [ref=e550]:
        - generic [ref=e555]:
          - generic [ref=e556]:
            - link "Pular para resultados" [ref=e557] [cursor=pointer]:
              - /url: "#vitrine-resultados"
              - img [ref=e558]
              - text: Pular para resultados
            - generic [ref=e562]:
              - img [ref=e563]
              - generic [ref=e565]: "4"
              - text: passos simples
            - heading "Como funciona" [level=2] [ref=e566]
            - paragraph [ref=e567]: Sem surpresas — do início ao fim, você tem o controle.
            - generic [ref=e568]:
              - img [ref=e569]
              - text: Sem compromisso
          - generic [ref=e575]:
            - img [ref=e577]
            - generic [ref=e578]:
              - 'button "1 Busque o serviço Encontre prestadores verificados perto de você. 50 + categorias encanador em São Paulo | Verificados < 5 km Mais filtros Ex: Busque ''encanador em São Paulo'' Buscar prestadores" [ref=e579] [cursor=pointer]':
                - generic [ref=e581]:
                  - generic [ref=e583]: "1"
                  - generic [ref=e584]:
                    - img [ref=e586]
                    - img [ref=e590]
                  - heading "Busque o serviço" [level=3] [ref=e593]
                  - paragraph [ref=e594]: Encontre prestadores verificados perto de você.
                  - generic [ref=e596]:
                    - generic [ref=e597]: "50"
                    - text: +
                    - generic [ref=e598]: categorias
                  - generic [ref=e600]:
                    - generic [ref=e601]:
                      - img [ref=e602]
                      - generic [ref=e605]: encanador em São Paulo
                      - generic [ref=e606]: "|"
                    - generic [ref=e607]:
                      - generic [ref=e608]: Verificados
                      - generic [ref=e609]: < 5 km
                      - generic [ref=e610]:
                        - img [ref=e611]
                        - text: Mais filtros
                  - paragraph [ref=e613]: "Ex: Busque 'encanador em São Paulo'"
                  - button "Buscar prestadores" [ref=e614]:
                    - text: Buscar prestadores
                    - img
              - 'button "2 Compare orçamentos Receba e compare propostas lado a lado. 3 orçamentos em 24h João S. R$ 180 Maria L. R$ 150 Melhor avaliação Compare lado a lado Ex: Compare 3 orçamentos em 24h Sem compromisso Pedir orçamento" [ref=e615] [cursor=pointer]':
                - generic [ref=e617]:
                  - generic [ref=e619]: "2"
                  - generic [ref=e620]:
                    - img [ref=e622]
                    - img [ref=e628]
                  - heading "Compare orçamentos" [level=3] [ref=e631]
                  - paragraph [ref=e632]: Receba e compare propostas lado a lado.
                  - generic [ref=e634]:
                    - generic [ref=e635]: "3"
                    - generic [ref=e636]: orçamentos em 24h
                  - generic [ref=e638]:
                    - generic [ref=e639]:
                      - generic [ref=e640]:
                        - generic [ref=e643]: João S.
                        - generic [ref=e644]:
                          - img [ref=e645]
                          - img [ref=e647]
                          - img [ref=e649]
                          - img [ref=e651]
                          - img [ref=e653]
                        - generic [ref=e655]: R$ 180
                      - generic [ref=e656]:
                        - generic [ref=e659]: Maria L.
                        - generic [ref=e660]:
                          - img [ref=e661]
                          - img [ref=e663]
                          - img [ref=e665]
                          - img [ref=e667]
                          - img [ref=e669]
                        - generic [ref=e671]: R$ 150
                        - generic [ref=e672]: Melhor avaliação
                    - generic [ref=e673]:
                      - img [ref=e674]
                      - text: Compare lado a lado
                  - paragraph [ref=e679]: "Ex: Compare 3 orçamentos em 24h"
                  - generic [ref=e680]:
                    - img [ref=e681]
                    - text: Sem compromisso
                  - button "Pedir orçamento" [ref=e686]:
                    - text: Pedir orçamento
                    - img
              - 'button "3 Agende com confiança Solicite um orçamento ou agende diretamente. 24 h para confirmar Março 2025 S T Q Q S S D 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 12 Mar, 14:00 — Confirmado Ex: Agende para amanhã às 14h Agendar agora" [ref=e687] [cursor=pointer]':
                - generic [ref=e689]:
                  - generic [ref=e691]: "3"
                  - generic [ref=e692]:
                    - img [ref=e694]
                    - img [ref=e698]
                  - heading "Agende com confiança" [level=3] [ref=e701]
                  - paragraph [ref=e702]: Solicite um orçamento ou agende diretamente.
                  - generic [ref=e704]:
                    - generic [ref=e705]: "24"
                    - text: h
                    - generic [ref=e706]: para confirmar
                  - generic [ref=e709]:
                    - generic [ref=e710]: Março 2025
                    - generic [ref=e711]:
                      - generic [ref=e712]: S
                      - generic [ref=e713]: T
                      - generic [ref=e714]: Q
                      - generic [ref=e715]: Q
                      - generic [ref=e716]: S
                      - generic [ref=e717]: S
                      - generic [ref=e718]: D
                      - generic [ref=e719]: "1"
                      - generic [ref=e720]: "2"
                      - generic [ref=e721]: "3"
                      - generic [ref=e722]: "4"
                      - generic [ref=e723]: "5"
                      - generic [ref=e724]: "6"
                      - generic [ref=e725]: "7"
                      - generic [ref=e726]: "8"
                      - generic [ref=e727]: "9"
                      - generic [ref=e728]: "10"
                      - generic [ref=e729]: "11"
                      - generic [ref=e730]: "12"
                      - generic [ref=e731]: "13"
                      - generic [ref=e732]: "14"
                      - generic [ref=e733]: "15"
                    - generic [ref=e734]:
                      - img [ref=e735]
                      - generic [ref=e738]: 12 Mar, 14:00 — Confirmado
                  - paragraph [ref=e739]: "Ex: Agende para amanhã às 14h"
                  - button "Agendar agora" [ref=e740]:
                    - text: Agendar agora
                    - img
              - 'button "4 Avalie o resultado Sua opinião mantém a qualidade da comunidade. 98 % satisfação 4.0 \"Excelente trabalho, recomendo!\" Avaliação verificada Ex: Avalie de 1 a 5 estrelas com comentário Cadastrar grátis" [ref=e741] [cursor=pointer]':
                - generic [ref=e743]:
                  - generic [ref=e745]: "4"
                  - generic [ref=e746]:
                    - img [ref=e748]
                    - img [ref=e751]
                  - heading "Avalie o resultado" [level=3] [ref=e754]
                  - paragraph [ref=e755]: Sua opinião mantém a qualidade da comunidade.
                  - generic [ref=e757]:
                    - generic [ref=e758]: "98"
                    - text: "%"
                    - generic [ref=e759]: satisfação
                  - generic [ref=e761]:
                    - generic [ref=e762]:
                      - generic [ref=e763]:
                        - img [ref=e764]
                        - img [ref=e766]
                        - img [ref=e768]
                        - img [ref=e770]
                        - img [ref=e772]
                        - generic [ref=e774]: "4.0"
                      - paragraph [ref=e777]: "\"Excelente trabalho, recomendo!\""
                    - generic [ref=e778]:
                      - img [ref=e779]
                      - text: Avaliação verificada
                  - paragraph [ref=e782]: "Ex: Avalie de 1 a 5 estrelas com comentário"
                  - button "Cadastrar grátis" [ref=e783]:
                    - text: Cadastrar grátis
                    - img
          - generic [ref=e784]:
            - generic [ref=e785]:
              - img [ref=e786]
              - generic [ref=e789]: Garantia Severinno
            - generic [ref=e790]:
              - generic [ref=e791]:
                - img [ref=e792]
                - generic [ref=e795]: Prestadores verificados
              - generic [ref=e796]:
                - img [ref=e797]
                - generic [ref=e800]: Resposta rápida
              - generic [ref=e801]:
                - img [ref=e802]
                - generic [ref=e804]: Satisfação garantida
              - generic [ref=e805]:
                - img [ref=e806]
                - generic [ref=e811]: Compare antes de contratar
          - generic [ref=e812]:
            - button "Começar agora" [ref=e813]:
              - text: Começar agora
              - img
            - link "Buscar prestadores" [ref=e814] [cursor=pointer]:
              - /url: "#vitrine-resultados"
              - img
              - text: Buscar prestadores
          - button "Voltar ao topo" [ref=e816]:
            - img [ref=e817]
            - text: Voltar ao topo
      - generic [ref=e820]:
        - generic [ref=e821]:
          - generic [ref=e822]:
            - img
            - text: Simulador de preços
          - heading "Quanto custa? Simule agora" [level=2] [ref=e823]
          - paragraph [ref=e824]: Estime o valor do serviço em 3 passos rápidos. Sem compromisso, sem cadastro.
        - generic [ref=e825]:
          - generic [ref=e826]: "1"
          - generic [ref=e828]: "2"
          - generic [ref=e830]: "3"
        - generic [ref=e833]:
          - heading "1. Qual serviço você precisa?" [level=3] [ref=e834]
          - paragraph [ref=e835]: Selecione a categoria do serviço
          - generic [ref=e836]:
            - button "Elétrica" [ref=e837]:
              - img [ref=e839]
              - generic [ref=e841]: Elétrica
            - button "Hidráulica" [ref=e842]:
              - img [ref=e844]
              - generic [ref=e847]: Hidráulica
            - button "Pintura" [ref=e848]:
              - img [ref=e850]
              - generic [ref=e854]: Pintura
            - button "Alvenaria" [ref=e855]:
              - img [ref=e857]
              - generic [ref=e859]: Alvenaria
            - button "Pisos" [ref=e860]:
              - img [ref=e862]
              - generic [ref=e864]: Pisos
            - button "Pós-obra" [ref=e865]:
              - img [ref=e867]
              - generic [ref=e872]: Pós-obra
            - button "Residencial" [ref=e873]:
              - img [ref=e875]
              - generic [ref=e878]: Residencial
      - region "Parceiros e imprensa" [ref=e879]:
        - generic [ref=e880]:
          - paragraph [ref=e882]: Referência no mercado
          - generic [ref=e884]:
            - generic [ref=e887]: G1
            - generic [ref=e890]: Folha de S.Paulo
            - generic [ref=e893]: Valor Econômico
            - generic [ref=e896]: Exame
            - generic [ref=e899]: InfoMoney
            - generic [ref=e902]: Startups
            - generic [ref=e905]: Sebrae
            - generic [ref=e908]: ABES
          - paragraph [ref=e909]: + de 6.000 prestadores confiam no Severinno
      - region "Avaliações de clientes" [ref=e910]:
        - generic:
          - generic:
            - img
        - generic [ref=e912]:
          - generic [ref=e913]:
            - img [ref=e914]
            - text: Avaliações reais
          - heading "O que nossos clientes dizem" [level=2] [ref=e916]
          - paragraph [ref=e917]: Avaliações de clientes após a conclusão do serviço.
      - generic [ref=e982]:
        - generic [ref=e985]:
          - generic [ref=e986]:
            - img [ref=e988]
            - paragraph [ref=e995]: Prestadores verificados
          - generic [ref=e996]:
            - img [ref=e998]
            - paragraph [ref=e1002]: Serviços cadastrados
          - generic [ref=e1003]:
            - img [ref=e1005]
            - paragraph [ref=e1010]: Serviços concluídos
          - generic [ref=e1011]:
            - img [ref=e1013]
            - paragraph [ref=e1017]: Nota média
        - generic [ref=e1019]:
          - generic [ref=e1020]:
            - generic [ref=e1021]:
              - img [ref=e1022]
              - text: Por que Severinno?
            - heading "Confiança em cada agendamento" [level=2] [ref=e1025]
            - paragraph [ref=e1026]: Mais que um diretório de serviços — um ecossistema pensado para proteger você e o prestador. Da verificação ao pagamento, cada etapa foi desenhada para a sua tranquilidade.
            - link "Pular para FAQ" [ref=e1028] [cursor=pointer]:
              - /url: "#faq"
              - img [ref=e1029]
              - text: Pular para FAQ
          - generic [ref=e1032]:
            - generic [ref=e1035]:
              - generic [ref=e1036]:
                - img [ref=e1038]
                - button "Saiba mais sobre Prestadores verificados" [ref=e1041]:
                  - img [ref=e1042]
              - heading "Prestadores verificados" [level=3] [ref=e1045]
              - paragraph [ref=e1046]: João verificou 3 documentos antes de aprovar o prestador. Você só vê profissionais validados.
              - button "Saiba mais" [ref=e1047]:
                - text: Saiba mais
                - img [ref=e1048]
            - generic [ref=e1052]:
              - generic [ref=e1053]:
                - img [ref=e1055]
                - button "Saiba mais sobre Pagamento protegido" [ref=e1058]:
                  - img [ref=e1059]
              - heading "Pagamento protegido" [level=3] [ref=e1062]
              - paragraph [ref=e1063]: O valor só é liberado ao prestador após você confirmar que ficou satisfeito com o serviço.
              - button "Saiba mais" [ref=e1064]:
                - text: Saiba mais
                - img [ref=e1065]
            - generic [ref=e1069]:
              - generic [ref=e1070]:
                - img [ref=e1072]
                - button "Saiba mais sobre Resposta rápida" [ref=e1075]:
                  - img [ref=e1076]
              - heading "Resposta rápida" [level=3] [ref=e1079]
              - paragraph [ref=e1080]: Prestadores comprometidos a responder em até 24h. Acompanhe o status em tempo real.
              - button "Saiba mais" [ref=e1081]:
                - text: Saiba mais
                - img [ref=e1082]
            - generic [ref=e1086]:
              - generic [ref=e1087]:
                - img [ref=e1089]
                - button "Saiba mais sobre Avaliações reais" [ref=e1091]:
                  - img [ref=e1092]
              - heading "Avaliações reais" [level=3] [ref=e1095]
              - paragraph [ref=e1096]: Apenas clientes que concluíram o serviço podem avaliar. Sem falsas avaliações.
              - button "Saiba mais" [ref=e1097]:
                - text: Saiba mais
                - img [ref=e1098]
            - generic [ref=e1102]:
              - generic [ref=e1103]:
                - img [ref=e1105]
                - button "Saiba mais sobre Próximo de você" [ref=e1108]:
                  - img [ref=e1109]
              - heading "Próximo de você" [level=3] [ref=e1112]
              - paragraph [ref=e1113]: Geolocalização inteligente mostra os melhores prestadores na sua região.
              - button "Saiba mais" [ref=e1114]:
                - text: Saiba mais
                - img [ref=e1115]
            - generic [ref=e1119]:
              - generic [ref=e1120]:
                - img [ref=e1122]
                - button "Saiba mais sobre Suporte humano" [ref=e1124]:
                  - img [ref=e1125]
              - heading "Suporte humano" [level=3] [ref=e1128]
              - paragraph [ref=e1129]: Equipe disponível para mediar disputas, tirar dúvidas e garantir uma experiência justa.
              - button "Saiba mais" [ref=e1130]:
                - text: Saiba mais
                - img [ref=e1131]
        - generic [ref=e1134]:
          - img [ref=e1135]
          - paragraph [ref=e1137]: "Garantia Severinno: seu dinheiro de volta se o serviço não for bem-feito."
          - link "Saiba mais" [ref=e1138] [cursor=pointer]:
            - /url: "#faq"
            - text: Saiba mais
            - img [ref=e1139]
      - generic [ref=e1142]:
        - generic [ref=e1143]:
          - generic [ref=e1144]:
            - img [ref=e1145]
            - text: Destaque da semana
          - heading "Profissional em destaque" [level=2] [ref=e1151]
          - paragraph [ref=e1152]: Conheça um dos nossos prestadores mais bem avaliados.
        - generic [ref=e1156]:
          - generic [ref=e1157]:
            - generic [ref=e1158]:
              - img [ref=e1161]
              - img [ref=e1165]
              - generic [ref=e1169]:
                - img [ref=e1170]
                - text: Top
            - generic [ref=e1172]:
              - generic [ref=e1173]:
                - heading "Maria Silva" [level=3] [ref=e1174]
                - generic [ref=e1175]:
                  - generic [ref=e1176]:
                    - img [ref=e1177]
                    - text: São Paulo
                  - generic [ref=e1180]: 3 km
                  - generic [ref=e1181]:
                    - img [ref=e1182]
                    - text: Membro desde 2023
              - generic [ref=e1184]:
                - generic [ref=e1185]:
                  - img [ref=e1186]
                  - generic [ref=e1188]: "4.8"
                - generic [ref=e1189]: (42 avaliações)
              - generic [ref=e1190]:
                - generic [ref=e1191]:
                  - img
                  - text: 230 serviços concluídos
                - generic [ref=e1192]:
                  - img
                  - text: Responde em ~30min
              - generic [ref=e1193]:
                - paragraph [ref=e1194]: Serviços
                - generic [ref=e1196]:
                  - generic [ref=e1197]: Instalação Elétrica
                  - generic [ref=e1198]: R$ 120,00
              - paragraph [ref=e1200]: Especialista em instalações elétricas residenciais com mais de 10 anos de experiência.
              - generic [ref=e1201]:
                - generic [ref=e1202]:
                  - generic "Maria S." [ref=e1203]: M
                  - generic "João P." [ref=e1204]: J
                  - generic "Ana L." [ref=e1205]: A
                - generic [ref=e1206]: Clientes recentes
          - generic [ref=e1207]:
            - generic [ref=e1208]:
              - button "Pedir orçamento" [ref=e1209]:
                - img
                - text: Pedir orçamento
              - button "Ver perfil completo" [ref=e1210]:
                - text: Ver perfil completo
                - img
            - button "Enviar mensagem" [ref=e1212]:
              - img
              - text: Enviar mensagem
      - generic [ref=e1216]:
        - generic [ref=e1217]:
          - generic [ref=e1218]:
            - generic [ref=e1219]:
              - img [ref=e1220]
              - text: Perguntas frequentes
            - heading "Tire suas dúvidas antes de contratar" [level=2] [ref=e1223]
            - paragraph [ref=e1224]: Reunimos as perguntas mais comuns sobre como o Severinno funciona — do cadastro ao pagamento.
          - generic [ref=e1225]:
            - img [ref=e1226]
            - textbox "Buscar nas perguntas frequentes" [ref=e1229]:
              - /placeholder: Buscar nas dúvidas…
          - generic [ref=e1230]:
            - paragraph [ref=e1231]: Filtrar por categoria
            - generic [ref=e1232]:
              - button "Filtrar por Geral" [ref=e1233]:
                - img [ref=e1234]
                - text: Geral
                - generic [ref=e1237]: (2)
              - button "Filtrar por Pagamento" [ref=e1238]:
                - img [ref=e1239]
                - text: Pagamento
                - generic [ref=e1241]: (2)
              - button "Filtrar por Agendamento" [ref=e1242]:
                - img [ref=e1243]
                - text: Agendamento
                - generic [ref=e1245]: (2)
              - button "Filtrar por Prestadores" [ref=e1246]:
                - img [ref=e1247]
                - text: Prestadores
                - generic [ref=e1251]: (2)
              - button "Filtrar por Segurança" [ref=e1252]:
                - img [ref=e1253]
                - text: Segurança
                - generic [ref=e1256]: (2)
          - generic [ref=e1257]:
            - paragraph [ref=e1258]: Perguntas mais frequentes
            - list [ref=e1259]:
              - listitem [ref=e1260]:
                - button "Como funciona o Severinno?" [ref=e1261]:
                  - img [ref=e1262]
                  - generic [ref=e1264]: Como funciona o Severinno?
              - listitem [ref=e1265]:
                - button "Preciso pagar para me cadastrar?" [ref=e1266]:
                  - img [ref=e1267]
                  - generic [ref=e1269]: Preciso pagar para me cadastrar?
              - listitem [ref=e1270]:
                - button "Como faço para agendar um serviço?" [ref=e1271]:
                  - img [ref=e1272]
                  - generic [ref=e1274]: Como faço para agendar um serviço?
              - listitem [ref=e1275]:
                - button "E se o serviço não for bem-feito?" [ref=e1276]:
                  - img [ref=e1277]
                  - generic [ref=e1279]: E se o serviço não for bem-feito?
          - generic [ref=e1281]:
            - img [ref=e1283]
            - generic [ref=e1285]:
              - paragraph [ref=e1286]: Ainda tem dúvidas?
              - paragraph [ref=e1287]: Cadastre-se grátis e converse diretamente com prestadores verificados. Sem compromisso.
              - generic [ref=e1288]:
                - button "Cadastrar grátis" [ref=e1289]
                - link "Fale conosco" [ref=e1290] [cursor=pointer]:
                  - /url: "#faq"
                  - img
                  - text: Fale conosco
        - generic [ref=e1291]:
          - generic [ref=e1293]:
            - generic [ref=e1295]:
              - heading "01 Como funciona o Severinno? Geral" [level=3] [ref=e1296]:
                - button "01 Como funciona o Severinno? Geral" [expanded] [ref=e1297]:
                  - generic [ref=e1298]:
                    - generic [ref=e1299]: "01"
                    - generic [ref=e1300]: Como funciona o Severinno?
                    - generic [ref=e1301]:
                      - img
                      - text: Geral
                  - img
              - region "01 Como funciona o Severinno? Geral" [ref=e1302]:
                - generic [ref=e1304]:
                  - paragraph [ref=e1305]: O Severinno conecta você a prestadores de serviço verificados próximos à sua localização. Você busca o serviço, compara avaliações reais de outros clientes, pede orçamento grátis e agenda — tudo pela plataforma. O pagamento só é liberado após você confirmar a conclusão do serviço.
                  - paragraph [ref=e1306]: "Ex: Maria precisava de um eletricista. Buscou na plataforma, comparou 3 profissionais e contratou o mais bem avaliado — tudo em 5 minutos."
            - heading "02 Preciso pagar para me cadastrar? Geral" [level=3] [ref=e1309]:
              - button "02 Preciso pagar para me cadastrar? Geral" [ref=e1310]:
                - generic [ref=e1311]:
                  - generic [ref=e1312]: "02"
                  - generic [ref=e1313]: Preciso pagar para me cadastrar?
                  - generic [ref=e1314]:
                    - img
                    - text: Geral
                - img
            - heading "03 Como os prestadores são verificados? Prestadores" [level=3] [ref=e1317]:
              - button "03 Como os prestadores são verificados? Prestadores" [ref=e1318]:
                - generic [ref=e1319]:
                  - generic [ref=e1320]: "03"
                  - generic [ref=e1321]: Como os prestadores são verificados?
                  - generic [ref=e1322]:
                    - img
                    - text: Prestadores
                - img
            - heading "04 Posso me tornar um prestador no Severinno? Prestadores" [level=3] [ref=e1325]:
              - button "04 Posso me tornar um prestador no Severinno? Prestadores" [ref=e1326]:
                - generic [ref=e1327]:
                  - generic [ref=e1328]: "04"
                  - generic [ref=e1329]: Posso me tornar um prestador no Severinno?
                  - generic [ref=e1330]:
                    - img
                    - text: Prestadores
                - img
            - heading "05 Como faço para agendar um serviço? Agendamento" [level=3] [ref=e1333]:
              - button "05 Como faço para agendar um serviço? Agendamento" [ref=e1334]:
                - generic [ref=e1335]:
                  - generic [ref=e1336]: "05"
                  - generic [ref=e1337]: Como faço para agendar um serviço?
                  - generic [ref=e1338]:
                    - img
                    - text: Agendamento
                - img
            - heading "06 Posso remarcar ou cancelar um agendamento? Agendamento" [level=3] [ref=e1341]:
              - button "06 Posso remarcar ou cancelar um agendamento? Agendamento" [ref=e1342]:
                - generic [ref=e1343]:
                  - generic [ref=e1344]: "06"
                  - generic [ref=e1345]: Posso remarcar ou cancelar um agendamento?
                  - generic [ref=e1346]:
                    - img
                    - text: Agendamento
                - img
            - heading "07 Como funciona o pagamento? Pagamento" [level=3] [ref=e1349]:
              - button "07 Como funciona o pagamento? Pagamento" [ref=e1350]:
                - generic [ref=e1351]:
                  - generic [ref=e1352]: "07"
                  - generic [ref=e1353]: Como funciona o pagamento?
                  - generic [ref=e1354]:
                    - img
                    - text: Pagamento
                - img
            - heading "08 O orçamento tem compromisso? Pagamento" [level=3] [ref=e1357]:
              - button "08 O orçamento tem compromisso? Pagamento" [ref=e1358]:
                - generic [ref=e1359]:
                  - generic [ref=e1360]: "08"
                  - generic [ref=e1361]: O orçamento tem compromisso?
                  - generic [ref=e1362]:
                    - img
                    - text: Pagamento
                - img
            - heading "09 E se o serviço não for bem-feito? Segurança" [level=3] [ref=e1365]:
              - button "09 E se o serviço não for bem-feito? Segurança" [ref=e1366]:
                - generic [ref=e1367]:
                  - generic [ref=e1368]: "09"
                  - generic [ref=e1369]: E se o serviço não for bem-feito?
                  - generic [ref=e1370]:
                    - img
                    - text: Segurança
                - img
            - heading "10 Meus dados pessoais estão seguros? Segurança" [level=3] [ref=e1373]:
              - button "10 Meus dados pessoais estão seguros? Segurança" [ref=e1374]:
                - generic [ref=e1375]:
                  - generic [ref=e1376]: "10"
                  - generic [ref=e1377]: Meus dados pessoais estão seguros?
                  - generic [ref=e1378]:
                    - img
                    - text: Segurança
                - img
          - generic [ref=e1379]:
            - paragraph [ref=e1380]: 10 de 10 dúvidas
            - button "Voltar ao topo da seção" [ref=e1381]:
              - img [ref=e1382]
              - text: Topo
      - generic [ref=e1386]:
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
        - generic [ref=e1391]:
          - generic [ref=e1392]:
            - generic [ref=e1394]:
              - img [ref=e1395]
              - text: Comece agora mesmo
            - heading "Encontre o serviço que você precisa" [level=2] [ref=e1397]
            - paragraph [ref=e1398]: Navegue pela vitrine, salve seus favoritos e agende com confiança. Tudo em um só lugar.
            - list [ref=e1399]:
              - generic [ref=e1400]:
                - listitem [ref=e1401]:
                  - img [ref=e1402]
                  - text: Cadastro gratuito
                - listitem [ref=e1405]:
                  - img [ref=e1406]
                  - text: Sem taxa de serviço
                - listitem [ref=e1409]:
                  - img [ref=e1410]
                  - text: Orçamento sem compromisso
            - button "Buscar prestadores" [ref=e1418]:
              - img
              - text: Buscar prestadores
              - generic [ref=e1419]:
                - img
          - generic [ref=e1420]:
            - generic [ref=e1421]:
              - heading "O que vem depois?" [level=3] [ref=e1422]
              - paragraph [ref=e1423]: Três passos simples e você estará agendando
              - generic [ref=e1424]:
                - img [ref=e1425]
                - generic [ref=e1426]:
                  - generic [ref=e1427]:
                    - generic [ref=e1429]: "1"
                    - generic [ref=e1430]:
                      - paragraph [ref=e1431]: Cadastre-se grátis
                      - paragraph [ref=e1432]: ~30s
                  - generic [ref=e1433]:
                    - generic [ref=e1435]: "2"
                    - generic [ref=e1436]:
                      - paragraph [ref=e1437]: Busque e compare
                      - paragraph [ref=e1438]: ~2 min
                  - generic [ref=e1439]:
                    - generic [ref=e1441]: "3"
                    - generic [ref=e1442]:
                      - paragraph [ref=e1443]: Agende com confiança
                      - paragraph [ref=e1444]: ~5 min
              - generic [ref=e1445]:
                - generic [ref=e1446]:
                  - img [ref=e1447]
                  - text: Sem compromisso
                - generic [ref=e1451]:
                  - img [ref=e1452]
                  - text: Cancele quando quiser
                - generic [ref=e1455]:
                  - img [ref=e1456]
                  - text: Suporte 24h
              - link "Saiba mais sobre pagamento protegido" [ref=e1459] [cursor=pointer]:
                - /url: "#faq"
                - img [ref=e1460]
                - text: Saiba mais sobre pagamento protegido
            - generic [ref=e1464]:
              - generic [ref=e1468]: Cliente
              - generic [ref=e1469]:
                - img [ref=e1473]
                - generic [ref=e1475]: Prestador
              - img [ref=e1480]
              - img [ref=e1482]
              - img [ref=e1486]
              - img [ref=e1489]
              - img [ref=e1493]
        - generic [ref=e1497]:
          - img [ref=e1498]
          - generic [ref=e1501]:
            - paragraph [ref=e1502]: “Encontrei um encanador em 10 minutos, paguei menos do que esperava e ainda pude avaliar o serviço. Recomendo demais!”
            - paragraph [ref=e1503]: — Ana P., Cliente, São Paulo
        - generic [ref=e1504]:
          - generic [ref=e1505]:
            - img [ref=e1506]
            - text: Sem compromisso
          - generic [ref=e1510]:
            - img [ref=e1511]
            - text: Cancele quando quiser
          - generic [ref=e1514]:
            - img [ref=e1515]
            - text: Pagamento protegido
    - contentinfo [ref=e1517]:
      - generic [ref=e1519]:
        - generic [ref=e1520]:
          - paragraph [ref=e1521]: Receba novidades e dicas de serviços
          - paragraph [ref=e1522]: Cadastre-se e receba ofertas exclusivas. Cancele quando quiser.
        - generic [ref=e1523]:
          - generic [ref=e1524]:
            - img [ref=e1525]
            - textbox "E-mail para newsletter" [ref=e1528]:
              - /placeholder: Seu e-mail
          - button "Assinar" [disabled]:
            - img
            - text: Assinar
      - generic [ref=e1529]:
        - generic [ref=e1530]:
          - generic [ref=e1531]:
            - generic [ref=e1532]:
              - img [ref=e1534]
              - generic [ref=e1537]: Severinno
            - paragraph [ref=e1538]: Marketplace de serviços com geolocalização. Encontre prestadores verificados, próximos e bem avaliados.
            - list "Redes sociais" [ref=e1539]:
              - listitem [ref=e1540]:
                - link "GitHub" [ref=e1541] [cursor=pointer]:
                  - /url: https://github.com
                  - img [ref=e1542]
              - listitem [ref=e1545]:
                - link "Twitter" [ref=e1546] [cursor=pointer]:
                  - /url: https://twitter.com
                  - img [ref=e1547]
              - listitem [ref=e1549]:
                - link "Instagram" [ref=e1550] [cursor=pointer]:
                  - /url: https://instagram.com
                  - img [ref=e1551]
              - listitem [ref=e1554]:
                - link "LinkedIn" [ref=e1555] [cursor=pointer]:
                  - /url: https://linkedin.com
                  - img [ref=e1556]
              - listitem [ref=e1560]:
                - link "E-mail" [ref=e1561] [cursor=pointer]:
                  - /url: mailto:contato@severinno.com
                  - img [ref=e1562]
          - navigation "Sobre" [ref=e1565]:
            - heading "Sobre" [level=3] [ref=e1566]:
              - img [ref=e1567]
              - text: Sobre
            - list [ref=e1570]:
              - listitem [ref=e1571]:
                - button "Como funciona" [ref=e1572]
              - listitem [ref=e1573]:
                - button "Quem somos" [ref=e1574]
              - listitem [ref=e1575]:
                - button "Termos de uso" [ref=e1576]
              - listitem [ref=e1577]:
                - button "Privacidade" [ref=e1578]
          - navigation "Para profissionais" [ref=e1579]:
            - heading "Para profissionais" [level=3] [ref=e1580]:
              - img [ref=e1581]
              - text: Para profissionais
            - list [ref=e1584]:
              - listitem [ref=e1585]:
                - button "Cadastre-se" [ref=e1586]
              - listitem [ref=e1587]:
                - button "Meu painel" [ref=e1588]
              - listitem [ref=e1589]:
                - button "Central de ajuda" [ref=e1590]
          - navigation "Precisa de ajuda?" [ref=e1591]:
            - heading "Precisa de ajuda?" [level=3] [ref=e1592]:
              - img [ref=e1593]
              - text: Precisa de ajuda?
            - list [ref=e1595]:
              - listitem [ref=e1596]:
                - button "Perguntas frequentes" [ref=e1597]
              - listitem [ref=e1598]:
                - button "Segurança" [ref=e1599]
              - listitem [ref=e1600]:
                - button "Reportar problema" [ref=e1601]
          - generic [ref=e1602]:
            - heading "Contato" [level=3] [ref=e1603]:
              - img [ref=e1604]
              - text: Contato
            - list [ref=e1609]:
              - listitem [ref=e1610]:
                - img [ref=e1611]
                - link "contato@severinno.com" [ref=e1614] [cursor=pointer]:
                  - /url: mailto:contato@severinno.com
              - listitem [ref=e1615]:
                - img [ref=e1616]
                - text: São Paulo, Brasil
            - button "Fale conosco" [ref=e1619]:
              - img
              - text: Fale conosco
        - generic [ref=e1620]:
          - paragraph [ref=e1621]: © 2026 Severinno Marketplace. Todos os direitos reservados.
          - paragraph [ref=e1622]:
            - text: Feito com
            - img [ref=e1623]
            - text: usando tecnologia Open Source (
            - link "MapLibre" [ref=e1625] [cursor=pointer]:
              - /url: https://maplibre.org/
            - text: ·
            - link "OpenStreetMap" [ref=e1626] [cursor=pointer]:
              - /url: https://www.openstreetmap.org/copyright
            - text: )
      - button "Voltar ao topo" [ref=e1627]:
        - img [ref=e1628]
    - button "Voltar ao topo" [ref=e1631]:
      - img
    - button "Abrir assistente virtual" [ref=e1632]:
      - img [ref=e1633]
    - generic [ref=e1637]:
      - generic [ref=e1638]:
        - img [ref=e1640]
        - generic [ref=e1642]:
          - paragraph [ref=e1643]: Usamos cookies para melhorar sua experiência
          - paragraph [ref=e1644]:
            - text: Utilizamos cookies essenciais para o funcionamento do site e cookies de análise para melhorar nossos serviços.
            - button "Política de privacidade" [ref=e1645]
      - generic [ref=e1646]:
        - button "Recusar" [ref=e1647]
        - button "Aceitar" [ref=e1648]:
          - img
          - text: Aceitar
        - button "Dispensar" [ref=e1649]:
          - img [ref=e1650]
  - region "Notifications alt+T"
  - generic [active]:
    - generic [ref=e1655]:
      - generic [ref=e1656]:
        - generic [ref=e1657]:
          - navigation [ref=e1658]:
            - button "previous" [disabled] [ref=e1659]:
              - img "previous" [ref=e1660]
            - generic [ref=e1662]:
              - generic [ref=e1663]: 1/
              - text: "1"
            - button "next" [disabled] [ref=e1664]:
              - img "next" [ref=e1665]
          - img
        - generic [ref=e1667]:
          - link "Next.js 16.1.3 (stale) Turbopack" [ref=e1668] [cursor=pointer]:
            - /url: https://nextjs.org/docs/messages/version-staleness
            - img [ref=e1669]
            - generic "There is a newer version (16.2.11) available, upgrade recommended!" [ref=e1671]: Next.js 16.1.3 (stale)
            - generic [ref=e1672]: Turbopack
          - img
      - dialog "Build Error" [ref=e1674]:
        - generic [ref=e1677]:
          - generic [ref=e1678]:
            - generic [ref=e1679]:
              - generic [ref=e1681]: Build Error
              - generic [ref=e1682]:
                - button "Copy Error Info" [ref=e1683] [cursor=pointer]:
                  - img [ref=e1684]
                - button "No related documentation found" [disabled] [ref=e1686]:
                  - img [ref=e1687]
                - button "Attach Node.js inspector" [ref=e1689] [cursor=pointer]:
                  - img [ref=e1690]
            - generic [ref=e1699]: Reading source code for parsing failed
          - generic [ref=e1701]:
            - generic [ref=e1703]:
              - img [ref=e1705]
              - generic [ref=e1709]: ./.freebuff/worktrees/thmrzp9vv9y86o/src/lib/api-server.ts
              - button "Open in editor" [ref=e1710] [cursor=pointer]:
                - img [ref=e1712]
            - generic [ref=e1716]: "Reading source code for parsing failed An unexpected error happened while trying to read the source code to parse: failed to convert rope into string Caused by: - invalid utf-8 sequence of 1 bytes from index 5415 Import trace: App Route: ./.freebuff/worktrees/thmrzp9vv9y86o/src/lib/api-server.ts ./.freebuff/worktrees/thmrzp9vv9y86o/src/app/api/auth/me/route.ts"
        - generic [ref=e1717]: "1"
        - generic [ref=e1718]: "2"
    - generic [ref=e1723] [cursor=pointer]:
      - button "Open Next.js Dev Tools" [ref=e1724]:
        - img [ref=e1725]
      - button "Open issues overlay" [ref=e1729]:
        - generic [ref=e1730]:
          - generic [ref=e1731]: "0"
          - generic [ref=e1732]: "1"
        - generic [ref=e1733]: Issue
  - alert [ref=e1734]
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