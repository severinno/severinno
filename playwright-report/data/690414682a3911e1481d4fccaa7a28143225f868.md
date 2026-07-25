# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: quote-flow.spec.ts >> QuoteModal — Cliente Autenticado >> 6. step 2 — seleciona serviço
- Location: e2e\quote-flow.spec.ts:239:7

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
    10 × waiting for element to be visible, enabled and stable
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
            - generic [ref=e993]: "0"
            - paragraph [ref=e994]: Prestadores verificados
          - generic [ref=e995]:
            - img [ref=e997]
            - generic [ref=e999]: "0"
            - paragraph [ref=e1000]: Serviços cadastrados
          - generic [ref=e1001]:
            - img [ref=e1003]
            - generic [ref=e1006]: "0"
            - paragraph [ref=e1007]: Serviços concluídos
          - generic [ref=e1008]:
            - img [ref=e1010]
            - generic [ref=e1013]: 0.0/5
            - paragraph [ref=e1014]: Nota média
        - generic [ref=e1016]:
          - generic [ref=e1017]:
            - generic [ref=e1018]:
              - img [ref=e1019]
              - text: Por que Severinno?
            - heading "Confiança em cada agendamento" [level=2] [ref=e1022]
            - paragraph [ref=e1023]: Mais que um diretório de serviços — um ecossistema pensado para proteger você e o prestador. Da verificação ao pagamento, cada etapa foi desenhada para a sua tranquilidade.
            - link "Pular para FAQ" [ref=e1025] [cursor=pointer]:
              - /url: "#faq"
              - img [ref=e1026]
              - text: Pular para FAQ
          - generic [ref=e1029]:
            - generic [ref=e1032]:
              - generic [ref=e1033]:
                - img [ref=e1035]
                - button "Saiba mais sobre Prestadores verificados" [ref=e1038]:
                  - img [ref=e1039]
              - heading "Prestadores verificados" [level=3] [ref=e1042]
              - paragraph [ref=e1043]: João verificou 3 documentos antes de aprovar o prestador. Você só vê profissionais validados.
              - button "Saiba mais" [ref=e1044]:
                - text: Saiba mais
                - img [ref=e1045]
            - generic [ref=e1049]:
              - generic [ref=e1050]:
                - img [ref=e1052]
                - button "Saiba mais sobre Pagamento protegido" [ref=e1055]:
                  - img [ref=e1056]
              - heading "Pagamento protegido" [level=3] [ref=e1059]
              - paragraph [ref=e1060]: O valor só é liberado ao prestador após você confirmar que ficou satisfeito com o serviço.
              - button "Saiba mais" [ref=e1061]:
                - text: Saiba mais
                - img [ref=e1062]
            - generic [ref=e1066]:
              - generic [ref=e1067]:
                - img [ref=e1069]
                - button "Saiba mais sobre Resposta rápida" [ref=e1072]:
                  - img [ref=e1073]
              - heading "Resposta rápida" [level=3] [ref=e1076]
              - paragraph [ref=e1077]: Prestadores comprometidos a responder em até 24h. Acompanhe o status em tempo real.
              - button "Saiba mais" [ref=e1078]:
                - text: Saiba mais
                - img [ref=e1079]
            - generic [ref=e1083]:
              - generic [ref=e1084]:
                - img [ref=e1086]
                - button "Saiba mais sobre Avaliações reais" [ref=e1088]:
                  - img [ref=e1089]
              - heading "Avaliações reais" [level=3] [ref=e1092]
              - paragraph [ref=e1093]: Apenas clientes que concluíram o serviço podem avaliar. Sem falsas avaliações.
              - button "Saiba mais" [ref=e1094]:
                - text: Saiba mais
                - img [ref=e1095]
            - generic [ref=e1099]:
              - generic [ref=e1100]:
                - img [ref=e1102]
                - button "Saiba mais sobre Próximo de você" [ref=e1105]:
                  - img [ref=e1106]
              - heading "Próximo de você" [level=3] [ref=e1109]
              - paragraph [ref=e1110]: Geolocalização inteligente mostra os melhores prestadores na sua região.
              - button "Saiba mais" [ref=e1111]:
                - text: Saiba mais
                - img [ref=e1112]
            - generic [ref=e1116]:
              - generic [ref=e1117]:
                - img [ref=e1119]
                - button "Saiba mais sobre Suporte humano" [ref=e1121]:
                  - img [ref=e1122]
              - heading "Suporte humano" [level=3] [ref=e1125]
              - paragraph [ref=e1126]: Equipe disponível para mediar disputas, tirar dúvidas e garantir uma experiência justa.
              - button "Saiba mais" [ref=e1127]:
                - text: Saiba mais
                - img [ref=e1128]
        - generic [ref=e1131]:
          - img [ref=e1132]
          - paragraph [ref=e1134]: "Garantia Severinno: seu dinheiro de volta se o serviço não for bem-feito."
          - link "Saiba mais" [ref=e1135] [cursor=pointer]:
            - /url: "#faq"
            - text: Saiba mais
            - img [ref=e1136]
      - generic [ref=e1139]:
        - generic [ref=e1140]:
          - generic [ref=e1141]:
            - img [ref=e1142]
            - text: Destaque da semana
          - heading "Profissional em destaque" [level=2] [ref=e1148]
          - paragraph [ref=e1149]: Conheça um dos nossos prestadores mais bem avaliados.
        - generic [ref=e1153]:
          - generic [ref=e1154]:
            - generic [ref=e1155]:
              - img [ref=e1158]
              - img [ref=e1162]
              - generic [ref=e1166]:
                - img [ref=e1167]
                - text: Top
            - generic [ref=e1169]:
              - generic [ref=e1170]:
                - heading "Maria Silva" [level=3] [ref=e1171]
                - generic [ref=e1172]:
                  - generic [ref=e1173]:
                    - img [ref=e1174]
                    - text: São Paulo
                  - generic [ref=e1177]: 3 km
                  - generic [ref=e1178]:
                    - img [ref=e1179]
                    - text: Membro desde 2023
              - generic [ref=e1181]:
                - generic [ref=e1182]:
                  - img [ref=e1183]
                  - generic [ref=e1185]: "4.8"
                - generic [ref=e1186]: (42 avaliações)
              - generic [ref=e1187]:
                - generic [ref=e1188]:
                  - img
                  - text: 230 serviços concluídos
                - generic [ref=e1189]:
                  - img
                  - text: Responde em ~30min
              - generic [ref=e1190]:
                - paragraph [ref=e1191]: Serviços
                - generic [ref=e1193]:
                  - generic [ref=e1194]: Instalação Elétrica
                  - generic [ref=e1195]: R$ 120,00
              - paragraph [ref=e1197]: Especialista em instalações elétricas residenciais com mais de 10 anos de experiência.
              - generic [ref=e1198]:
                - generic [ref=e1199]:
                  - generic "Maria S." [ref=e1200]: M
                  - generic "João P." [ref=e1201]: J
                  - generic "Ana L." [ref=e1202]: A
                - generic [ref=e1203]: Clientes recentes
          - generic [ref=e1204]:
            - generic [ref=e1205]:
              - button "Pedir orçamento" [ref=e1206]:
                - img
                - text: Pedir orçamento
              - button "Ver perfil completo" [ref=e1207]:
                - text: Ver perfil completo
                - img
            - button "Enviar mensagem" [ref=e1209]:
              - img
              - text: Enviar mensagem
      - generic [ref=e1213]:
        - generic [ref=e1214]:
          - generic [ref=e1215]:
            - generic [ref=e1216]:
              - img [ref=e1217]
              - text: Perguntas frequentes
            - heading "Tire suas dúvidas antes de contratar" [level=2] [ref=e1220]
            - paragraph [ref=e1221]: Reunimos as perguntas mais comuns sobre como o Severinno funciona — do cadastro ao pagamento.
          - generic [ref=e1222]:
            - img [ref=e1223]
            - textbox "Buscar nas perguntas frequentes" [ref=e1226]:
              - /placeholder: Buscar nas dúvidas…
          - generic [ref=e1227]:
            - paragraph [ref=e1228]: Filtrar por categoria
            - generic [ref=e1229]:
              - button "Filtrar por Geral" [ref=e1230]:
                - img [ref=e1231]
                - text: Geral
                - generic [ref=e1234]: (2)
              - button "Filtrar por Pagamento" [ref=e1235]:
                - img [ref=e1236]
                - text: Pagamento
                - generic [ref=e1238]: (2)
              - button "Filtrar por Agendamento" [ref=e1239]:
                - img [ref=e1240]
                - text: Agendamento
                - generic [ref=e1242]: (2)
              - button "Filtrar por Prestadores" [ref=e1243]:
                - img [ref=e1244]
                - text: Prestadores
                - generic [ref=e1248]: (2)
              - button "Filtrar por Segurança" [ref=e1249]:
                - img [ref=e1250]
                - text: Segurança
                - generic [ref=e1253]: (2)
          - generic [ref=e1254]:
            - paragraph [ref=e1255]: Perguntas mais frequentes
            - list [ref=e1256]:
              - listitem [ref=e1257]:
                - button "Como funciona o Severinno?" [ref=e1258]:
                  - img [ref=e1259]
                  - generic [ref=e1261]: Como funciona o Severinno?
              - listitem [ref=e1262]:
                - button "Preciso pagar para me cadastrar?" [ref=e1263]:
                  - img [ref=e1264]
                  - generic [ref=e1266]: Preciso pagar para me cadastrar?
              - listitem [ref=e1267]:
                - button "Como faço para agendar um serviço?" [ref=e1268]:
                  - img [ref=e1269]
                  - generic [ref=e1271]: Como faço para agendar um serviço?
              - listitem [ref=e1272]:
                - button "E se o serviço não for bem-feito?" [ref=e1273]:
                  - img [ref=e1274]
                  - generic [ref=e1276]: E se o serviço não for bem-feito?
          - generic [ref=e1278]:
            - img [ref=e1280]
            - generic [ref=e1282]:
              - paragraph [ref=e1283]: Ainda tem dúvidas?
              - paragraph [ref=e1284]: Cadastre-se grátis e converse diretamente com prestadores verificados. Sem compromisso.
              - generic [ref=e1285]:
                - button "Cadastrar grátis" [ref=e1286]
                - link "Fale conosco" [ref=e1287] [cursor=pointer]:
                  - /url: "#faq"
                  - img
                  - text: Fale conosco
        - generic [ref=e1288]:
          - generic [ref=e1290]:
            - generic [ref=e1292]:
              - heading "01 Como funciona o Severinno? Geral" [level=3] [ref=e1293]:
                - button "01 Como funciona o Severinno? Geral" [expanded] [ref=e1294]:
                  - generic [ref=e1295]:
                    - generic [ref=e1296]: "01"
                    - generic [ref=e1297]: Como funciona o Severinno?
                    - generic [ref=e1298]:
                      - img
                      - text: Geral
                  - img
              - region "01 Como funciona o Severinno? Geral" [ref=e1299]:
                - generic [ref=e1301]:
                  - paragraph [ref=e1302]: O Severinno conecta você a prestadores de serviço verificados próximos à sua localização. Você busca o serviço, compara avaliações reais de outros clientes, pede orçamento grátis e agenda — tudo pela plataforma. O pagamento só é liberado após você confirmar a conclusão do serviço.
                  - paragraph [ref=e1303]: "Ex: Maria precisava de um eletricista. Buscou na plataforma, comparou 3 profissionais e contratou o mais bem avaliado — tudo em 5 minutos."
            - heading "02 Preciso pagar para me cadastrar? Geral" [level=3] [ref=e1306]:
              - button "02 Preciso pagar para me cadastrar? Geral" [ref=e1307]:
                - generic [ref=e1308]:
                  - generic [ref=e1309]: "02"
                  - generic [ref=e1310]: Preciso pagar para me cadastrar?
                  - generic [ref=e1311]:
                    - img
                    - text: Geral
                - img
            - heading "03 Como os prestadores são verificados? Prestadores" [level=3] [ref=e1314]:
              - button "03 Como os prestadores são verificados? Prestadores" [ref=e1315]:
                - generic [ref=e1316]:
                  - generic [ref=e1317]: "03"
                  - generic [ref=e1318]: Como os prestadores são verificados?
                  - generic [ref=e1319]:
                    - img
                    - text: Prestadores
                - img
            - heading "04 Posso me tornar um prestador no Severinno? Prestadores" [level=3] [ref=e1322]:
              - button "04 Posso me tornar um prestador no Severinno? Prestadores" [ref=e1323]:
                - generic [ref=e1324]:
                  - generic [ref=e1325]: "04"
                  - generic [ref=e1326]: Posso me tornar um prestador no Severinno?
                  - generic [ref=e1327]:
                    - img
                    - text: Prestadores
                - img
            - heading "05 Como faço para agendar um serviço? Agendamento" [level=3] [ref=e1330]:
              - button "05 Como faço para agendar um serviço? Agendamento" [ref=e1331]:
                - generic [ref=e1332]:
                  - generic [ref=e1333]: "05"
                  - generic [ref=e1334]: Como faço para agendar um serviço?
                  - generic [ref=e1335]:
                    - img
                    - text: Agendamento
                - img
            - heading "06 Posso remarcar ou cancelar um agendamento? Agendamento" [level=3] [ref=e1338]:
              - button "06 Posso remarcar ou cancelar um agendamento? Agendamento" [ref=e1339]:
                - generic [ref=e1340]:
                  - generic [ref=e1341]: "06"
                  - generic [ref=e1342]: Posso remarcar ou cancelar um agendamento?
                  - generic [ref=e1343]:
                    - img
                    - text: Agendamento
                - img
            - heading "07 Como funciona o pagamento? Pagamento" [level=3] [ref=e1346]:
              - button "07 Como funciona o pagamento? Pagamento" [ref=e1347]:
                - generic [ref=e1348]:
                  - generic [ref=e1349]: "07"
                  - generic [ref=e1350]: Como funciona o pagamento?
                  - generic [ref=e1351]:
                    - img
                    - text: Pagamento
                - img
            - heading "08 O orçamento tem compromisso? Pagamento" [level=3] [ref=e1354]:
              - button "08 O orçamento tem compromisso? Pagamento" [ref=e1355]:
                - generic [ref=e1356]:
                  - generic [ref=e1357]: "08"
                  - generic [ref=e1358]: O orçamento tem compromisso?
                  - generic [ref=e1359]:
                    - img
                    - text: Pagamento
                - img
            - heading "09 E se o serviço não for bem-feito? Segurança" [level=3] [ref=e1362]:
              - button "09 E se o serviço não for bem-feito? Segurança" [ref=e1363]:
                - generic [ref=e1364]:
                  - generic [ref=e1365]: "09"
                  - generic [ref=e1366]: E se o serviço não for bem-feito?
                  - generic [ref=e1367]:
                    - img
                    - text: Segurança
                - img
            - heading "10 Meus dados pessoais estão seguros? Segurança" [level=3] [ref=e1370]:
              - button "10 Meus dados pessoais estão seguros? Segurança" [ref=e1371]:
                - generic [ref=e1372]:
                  - generic [ref=e1373]: "10"
                  - generic [ref=e1374]: Meus dados pessoais estão seguros?
                  - generic [ref=e1375]:
                    - img
                    - text: Segurança
                - img
          - generic [ref=e1376]:
            - paragraph [ref=e1377]: 10 de 10 dúvidas
            - button "Voltar ao topo da seção" [ref=e1378]:
              - img [ref=e1379]
              - text: Topo
      - generic [ref=e1383]:
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
        - generic [ref=e1388]:
          - generic [ref=e1389]:
            - generic [ref=e1391]:
              - img [ref=e1392]
              - text: Comece agora mesmo
            - heading "Encontre o serviço que você precisa" [level=2] [ref=e1394]
            - paragraph [ref=e1395]: Navegue pela vitrine, salve seus favoritos e agende com confiança. Tudo em um só lugar.
            - list [ref=e1396]:
              - generic [ref=e1397]:
                - listitem [ref=e1398]:
                  - img [ref=e1399]
                  - text: Cadastro gratuito
                - listitem [ref=e1402]:
                  - img [ref=e1403]
                  - text: Sem taxa de serviço
                - listitem [ref=e1406]:
                  - img [ref=e1407]
                  - text: Orçamento sem compromisso
            - button "Buscar prestadores" [ref=e1415]:
              - img
              - text: Buscar prestadores
              - generic [ref=e1416]:
                - img
          - generic [ref=e1417]:
            - generic [ref=e1418]:
              - heading "O que vem depois?" [level=3] [ref=e1419]
              - paragraph [ref=e1420]: Três passos simples e você estará agendando
              - generic [ref=e1421]:
                - img [ref=e1422]
                - generic [ref=e1423]:
                  - generic [ref=e1424]:
                    - generic [ref=e1426]: "1"
                    - generic [ref=e1427]:
                      - paragraph [ref=e1428]: Cadastre-se grátis
                      - paragraph [ref=e1429]: ~30s
                  - generic [ref=e1430]:
                    - generic [ref=e1432]: "2"
                    - generic [ref=e1433]:
                      - paragraph [ref=e1434]: Busque e compare
                      - paragraph [ref=e1435]: ~2 min
                  - generic [ref=e1436]:
                    - generic [ref=e1438]: "3"
                    - generic [ref=e1439]:
                      - paragraph [ref=e1440]: Agende com confiança
                      - paragraph [ref=e1441]: ~5 min
              - generic [ref=e1442]:
                - generic [ref=e1443]:
                  - img [ref=e1444]
                  - text: Sem compromisso
                - generic [ref=e1448]:
                  - img [ref=e1449]
                  - text: Cancele quando quiser
                - generic [ref=e1452]:
                  - img [ref=e1453]
                  - text: Suporte 24h
              - link "Saiba mais sobre pagamento protegido" [ref=e1456] [cursor=pointer]:
                - /url: "#faq"
                - img [ref=e1457]
                - text: Saiba mais sobre pagamento protegido
            - generic [ref=e1461]:
              - generic [ref=e1465]: Cliente
              - generic [ref=e1466]:
                - img [ref=e1470]
                - generic [ref=e1472]: Prestador
              - img [ref=e1477]
              - img [ref=e1479]
              - img [ref=e1483]
              - img [ref=e1486]
              - img [ref=e1490]
        - generic [ref=e1494]:
          - img [ref=e1495]
          - generic [ref=e1498]:
            - paragraph [ref=e1499]: “Encontrei um encanador em 10 minutos, paguei menos do que esperava e ainda pude avaliar o serviço. Recomendo demais!”
            - paragraph [ref=e1500]: — Ana P., Cliente, São Paulo
        - generic [ref=e1501]:
          - generic [ref=e1502]:
            - img [ref=e1503]
            - text: Sem compromisso
          - generic [ref=e1507]:
            - img [ref=e1508]
            - text: Cancele quando quiser
          - generic [ref=e1511]:
            - img [ref=e1512]
            - text: Pagamento protegido
    - contentinfo [ref=e1514]:
      - generic [ref=e1516]:
        - generic [ref=e1517]:
          - paragraph [ref=e1518]: Receba novidades e dicas de serviços
          - paragraph [ref=e1519]: Cadastre-se e receba ofertas exclusivas. Cancele quando quiser.
        - generic [ref=e1520]:
          - generic [ref=e1521]:
            - img [ref=e1522]
            - textbox "E-mail para newsletter" [ref=e1525]:
              - /placeholder: Seu e-mail
          - button "Assinar" [disabled]:
            - img
            - text: Assinar
      - generic [ref=e1526]:
        - generic [ref=e1527]:
          - generic [ref=e1528]:
            - generic [ref=e1529]:
              - img [ref=e1531]
              - generic [ref=e1534]: Severinno
            - paragraph [ref=e1535]: Marketplace de serviços com geolocalização. Encontre prestadores verificados, próximos e bem avaliados.
            - list "Redes sociais" [ref=e1536]:
              - listitem [ref=e1537]:
                - link "GitHub" [ref=e1538] [cursor=pointer]:
                  - /url: https://github.com
                  - img [ref=e1539]
              - listitem [ref=e1542]:
                - link "Twitter" [ref=e1543] [cursor=pointer]:
                  - /url: https://twitter.com
                  - img [ref=e1544]
              - listitem [ref=e1546]:
                - link "Instagram" [ref=e1547] [cursor=pointer]:
                  - /url: https://instagram.com
                  - img [ref=e1548]
              - listitem [ref=e1551]:
                - link "LinkedIn" [ref=e1552] [cursor=pointer]:
                  - /url: https://linkedin.com
                  - img [ref=e1553]
              - listitem [ref=e1557]:
                - link "E-mail" [ref=e1558] [cursor=pointer]:
                  - /url: mailto:contato@severinno.com
                  - img [ref=e1559]
          - navigation "Sobre" [ref=e1562]:
            - heading "Sobre" [level=3] [ref=e1563]:
              - img [ref=e1564]
              - text: Sobre
            - list [ref=e1567]:
              - listitem [ref=e1568]:
                - button "Como funciona" [ref=e1569]
              - listitem [ref=e1570]:
                - button "Quem somos" [ref=e1571]
              - listitem [ref=e1572]:
                - button "Termos de uso" [ref=e1573]
              - listitem [ref=e1574]:
                - button "Privacidade" [ref=e1575]
          - navigation "Para profissionais" [ref=e1576]:
            - heading "Para profissionais" [level=3] [ref=e1577]:
              - img [ref=e1578]
              - text: Para profissionais
            - list [ref=e1581]:
              - listitem [ref=e1582]:
                - button "Cadastre-se" [ref=e1583]
              - listitem [ref=e1584]:
                - button "Meu painel" [ref=e1585]
              - listitem [ref=e1586]:
                - button "Central de ajuda" [ref=e1587]
          - navigation "Precisa de ajuda?" [ref=e1588]:
            - heading "Precisa de ajuda?" [level=3] [ref=e1589]:
              - img [ref=e1590]
              - text: Precisa de ajuda?
            - list [ref=e1592]:
              - listitem [ref=e1593]:
                - button "Perguntas frequentes" [ref=e1594]
              - listitem [ref=e1595]:
                - button "Segurança" [ref=e1596]
              - listitem [ref=e1597]:
                - button "Reportar problema" [ref=e1598]
          - generic [ref=e1599]:
            - heading "Contato" [level=3] [ref=e1600]:
              - img [ref=e1601]
              - text: Contato
            - list [ref=e1606]:
              - listitem [ref=e1607]:
                - img [ref=e1608]
                - link "contato@severinno.com" [ref=e1611] [cursor=pointer]:
                  - /url: mailto:contato@severinno.com
              - listitem [ref=e1612]:
                - img [ref=e1613]
                - text: São Paulo, Brasil
            - button "Fale conosco" [ref=e1616]:
              - img
              - text: Fale conosco
        - generic [ref=e1617]:
          - paragraph [ref=e1618]: © 2026 Severinno Marketplace. Todos os direitos reservados.
          - paragraph [ref=e1619]:
            - text: Feito com
            - img [ref=e1620]
            - text: usando tecnologia Open Source (
            - link "MapLibre" [ref=e1622] [cursor=pointer]:
              - /url: https://maplibre.org/
            - text: ·
            - link "OpenStreetMap" [ref=e1623] [cursor=pointer]:
              - /url: https://www.openstreetmap.org/copyright
            - text: )
      - button "Voltar ao topo" [ref=e1624]:
        - img [ref=e1625]
    - button "Voltar ao topo" [ref=e1628]:
      - img
    - button "Abrir assistente virtual" [ref=e1629]:
      - img [ref=e1630]
    - generic [ref=e1634]:
      - generic [ref=e1635]:
        - img [ref=e1637]
        - generic [ref=e1639]:
          - paragraph [ref=e1640]: Usamos cookies para melhorar sua experiência
          - paragraph [ref=e1641]:
            - text: Utilizamos cookies essenciais para o funcionamento do site e cookies de análise para melhorar nossos serviços.
            - button "Política de privacidade" [ref=e1642]
      - generic [ref=e1643]:
        - button "Recusar" [ref=e1644]
        - button "Aceitar" [ref=e1645]:
          - img
          - text: Aceitar
        - button "Dispensar" [ref=e1646]:
          - img [ref=e1647]
  - region "Notifications alt+T"
  - generic [active]:
    - generic [ref=e1652]:
      - generic [ref=e1653]:
        - generic [ref=e1654]:
          - navigation [ref=e1655]:
            - button "previous" [disabled] [ref=e1656]:
              - img "previous" [ref=e1657]
            - generic [ref=e1659]:
              - generic [ref=e1660]: 1/
              - text: "1"
            - button "next" [disabled] [ref=e1661]:
              - img "next" [ref=e1662]
          - img
        - generic [ref=e1664]:
          - link "Next.js 16.1.3 (stale) Turbopack" [ref=e1665] [cursor=pointer]:
            - /url: https://nextjs.org/docs/messages/version-staleness
            - img [ref=e1666]
            - generic "There is a newer version (16.2.11) available, upgrade recommended!" [ref=e1668]: Next.js 16.1.3 (stale)
            - generic [ref=e1669]: Turbopack
          - img
      - dialog "Build Error" [ref=e1671]:
        - generic [ref=e1674]:
          - generic [ref=e1675]:
            - generic [ref=e1676]:
              - generic [ref=e1678]: Build Error
              - generic [ref=e1679]:
                - button "Copy Error Info" [ref=e1680] [cursor=pointer]:
                  - img [ref=e1681]
                - button "No related documentation found" [disabled] [ref=e1683]:
                  - img [ref=e1684]
                - button "Attach Node.js inspector" [ref=e1686] [cursor=pointer]:
                  - img [ref=e1687]
            - generic [ref=e1696]: Reading source code for parsing failed
          - generic [ref=e1698]:
            - generic [ref=e1700]:
              - img [ref=e1702]
              - generic [ref=e1706]: ./.freebuff/worktrees/thmrzp9vv9y86o/src/lib/api-server.ts
              - button "Open in editor" [ref=e1707] [cursor=pointer]:
                - img [ref=e1709]
            - generic [ref=e1713]: "Reading source code for parsing failed An unexpected error happened while trying to read the source code to parse: failed to convert rope into string Caused by: - invalid utf-8 sequence of 1 bytes from index 5415 Import trace: App Route: ./.freebuff/worktrees/thmrzp9vv9y86o/src/lib/api-server.ts ./.freebuff/worktrees/thmrzp9vv9y86o/src/app/api/auth/me/route.ts"
        - generic [ref=e1714]: "1"
        - generic [ref=e1715]: "2"
    - generic [ref=e1720] [cursor=pointer]:
      - button "Open Next.js Dev Tools" [ref=e1721]:
        - img [ref=e1722]
      - button "Open issues overlay" [ref=e1726]:
        - generic [ref=e1727]:
          - generic [ref=e1728]: "0"
          - generic [ref=e1729]: "1"
        - generic [ref=e1730]: Issue
  - alert [ref=e1731]
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