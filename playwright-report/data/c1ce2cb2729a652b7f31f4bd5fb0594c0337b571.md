# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: quote-flow.spec.ts >> QuoteModal — Cliente Autenticado >> 10. fluxo completo — step 1 até envio do orçamento
- Location: e2e\quote-flow.spec.ts:326:7

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
    - element is not stable
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
  2 × retrying click action
      - waiting 100ms
      - waiting for element to be visible, enabled and stable
      - element is visible, enabled and stable
      - scrolling into view if needed
      - done scrolling
      - <nextjs-portal></nextjs-portal> from <script data-nextjs-dev-overlay="true">…</script> subtree intercepts pointer events
  2 × retrying click action
      - waiting 500ms
      - waiting for element to be visible, enabled and stable
      - element is visible, enabled and stable
      - scrolling into view if needed
      - done scrolling
      - <nextjs-portal></nextjs-portal> from <script data-nextjs-dev-overlay="true">…</script> subtree intercepts pointer events
  - retrying click action
    - waiting 500ms
    - waiting for element to be visible, enabled and stable
    - element is not stable
  - retrying click action
    - waiting 500ms
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
    2 × waiting for element to be visible, enabled and stable
      - element is visible, enabled and stable
      - scrolling into view if needed
      - done scrolling
      - <nextjs-portal></nextjs-portal> from <script data-nextjs-dev-overlay="true">…</script> subtree intercepts pointer events
    - retrying click action
      - waiting 100ms
    5 × waiting for element to be visible, enabled and stable
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
            - paragraph [ref=e220]: Serviços verificados perto de você — 0 categorias disponíveis
          - generic [ref=e221]:
            - img [ref=e223]
            - generic [ref=e226]:
              - paragraph [ref=e227]: Nenhuma categoria disponível
              - paragraph [ref=e228]: As categorias aparecerão aqui assim que estiverem disponíveis. Tente recarregar a página.
            - button "Tentar carregar categorias novamente" [ref=e229]:
              - img
              - text: Tentar novamente
      - region "Resultados da busca" [ref=e230]:
        - generic [ref=e231]:
          - complementary [ref=e232]:
            - generic [ref=e234]:
              - generic [ref=e235]:
                - heading "Filtros" [level=2] [ref=e236]:
                  - img [ref=e237]
                  - text: Filtros
                - button "Limpar filtros" [ref=e238]
              - generic [ref=e239]:
                - generic [ref=e240]: Buscar
                - generic [ref=e241]:
                  - img [ref=e242]
                  - textbox "Buscar" [ref=e245]:
                    - /placeholder: Serviço, prestador…
              - generic [ref=e246]:
                - generic [ref=e247]:
                  - generic [ref=e248]: Raio de busca
                  - generic [ref=e249]: 15 km
                - generic "Raio de busca em quilômetros" [ref=e250]:
                  - slider [ref=e254]
                - generic [ref=e255]:
                  - generic [ref=e256]: 1 km
                  - generic [ref=e257]: 50 km
              - generic [ref=e258]:
                - generic [ref=e259]: Categoria
                - combobox [ref=e260]:
                  - generic: Todas as categorias
                  - img
              - generic [ref=e261]:
                - generic [ref=e262]: Ordenar por
                - radiogroup "Ordenar por" [ref=e263]:
                  - radio "Melhor avaliação" [checked] [ref=e264]
                  - radio "Mais próximos" [ref=e265]
              - generic [ref=e266]:
                - generic [ref=e267]: Avaliação mínima
                - radiogroup [ref=e268]:
                  - generic [ref=e269] [cursor=pointer]:
                    - radio "Todas" [checked] [ref=e270]:
                      - img [ref=e271]
                    - generic [ref=e273]: Todas
                  - generic [ref=e274] [cursor=pointer]:
                    - radio "3+" [ref=e275]
                    - generic [ref=e276]: 3+
                  - generic [ref=e277] [cursor=pointer]:
                    - radio "4+" [ref=e278]
                    - generic [ref=e279]: 4+
                  - generic [ref=e280] [cursor=pointer]:
                    - radio "5" [ref=e281]
                    - generic [ref=e282]: "5"
              - generic [ref=e283] [cursor=pointer]:
                - generic [ref=e284]:
                  - img [ref=e285]
                  - generic [ref=e287]: Somente verificados
                - switch "Somente verificados" [ref=e288]
              - button "Ver 3 resultados" [disabled]
          - generic [ref=e289]:
            - generic [ref=e291]:
              - generic [ref=e292]:
                - heading "3 prestadores encontrados" [level=2] [ref=e293]
                - paragraph [ref=e294]: Exibindo 1–3 de 3
              - generic [ref=e295]:
                - generic [ref=e296]:
                  - text: "Ordenado por:"
                  - generic [ref=e297]: Melhor avaliação
                - tablist "Visualização" [ref=e298]:
                  - tab "Lista" [selected] [ref=e299]:
                    - img [ref=e300]
                    - generic [ref=e301]: Lista
                  - tab "Mapa" [ref=e302]:
                    - img [ref=e303]
                    - generic [ref=e305]: Mapa
            - generic [ref=e307]:
              - generic [ref=e309]:
                - generic [ref=e310]:
                  - img "Capa de Maria Silva" [ref=e311]
                  - generic [ref=e313]:
                    - img [ref=e314]
                    - text: Verificado
                  - generic [ref=e317]:
                    - button "Adicionar Maria Silva à comparação" [ref=e318]:
                      - img [ref=e319]
                    - button "Adicionar Maria Silva aos favoritos" [ref=e324]:
                      - img [ref=e325]
                  - img "Maria Silva" [ref=e329]
                - generic [ref=e330]:
                  - generic [ref=e331]:
                    - button "Ver perfil de Maria Silva" [ref=e332]:
                      - heading "Maria Silva" [level=3] [ref=e333]:
                        - generic [ref=e334]: Maria Silva
                        - img [ref=e335]
                    - generic "Avaliação média" [ref=e337]:
                      - img [ref=e338]
                      - text: "4.8"
                      - generic [ref=e340]: (42)
                  - paragraph [ref=e341]: a partir de R$ 120,00
                  - generic [ref=e342]:
                    - generic [ref=e343]:
                      - img [ref=e344]
                      - text: 2,5 km
                    - generic [ref=e347]:
                      - img [ref=e348]
                      - text: São Paulo
                  - paragraph [ref=e351]: Especialista em instalações elétricas residenciais com mais de 10 anos de experiência.
                  - generic [ref=e352]:
                    - generic "Serviços concluídos com sucesso" [ref=e353]:
                      - img [ref=e354]
                      - text: 230 serviços concluídos
                    - generic "Na plataforma desde" [ref=e357]:
                      - img [ref=e358]
                      - text: desde jan. de 2023
                - generic [ref=e362]:
                  - generic [ref=e363]:
                    - img [ref=e364]
                    - generic [ref=e366]: Instalação Elétrica · a partir de R$ 120,00
                  - heading "Elétrica 1 serviço" [level=3] [ref=e369]:
                    - button "Elétrica 1 serviço" [ref=e370]:
                      - generic [ref=e372]:
                        - paragraph [ref=e373]: Elétrica
                        - paragraph [ref=e374]: 1 serviço
                      - img
                - generic [ref=e375]:
                  - button "Orçamento" [ref=e376]:
                    - img
                    - text: Orçamento
                  - button "Agendar" [ref=e377]:
                    - img
                    - text: Agendar
              - generic [ref=e379]:
                - generic [ref=e380]:
                  - img "Capa de João Pedreiro" [ref=e381]
                  - generic [ref=e383]:
                    - img [ref=e384]
                    - text: Verificado
                  - generic [ref=e387]:
                    - button "Adicionar João Pedreiro à comparação" [ref=e388]:
                      - img [ref=e389]
                    - button "Adicionar João Pedreiro aos favoritos" [ref=e394]:
                      - img [ref=e395]
                  - img "João Pedreiro" [ref=e399]
                - generic [ref=e400]:
                  - generic [ref=e401]:
                    - button "Ver perfil de João Pedreiro" [ref=e402]:
                      - heading "João Pedreiro" [level=3] [ref=e403]:
                        - generic [ref=e404]: João Pedreiro
                        - img [ref=e405]
                    - generic "Avaliação média" [ref=e407]:
                      - img [ref=e408]
                      - text: "4.8"
                      - generic [ref=e410]: (42)
                  - paragraph [ref=e411]: a partir de R$ 120,00
                  - generic [ref=e412]:
                    - generic [ref=e413]:
                      - img [ref=e414]
                      - text: 2,5 km
                    - generic [ref=e417]:
                      - img [ref=e418]
                      - text: São Paulo
                  - paragraph [ref=e421]: Especialista em instalações elétricas residenciais com mais de 10 anos de experiência.
                  - generic [ref=e422]:
                    - generic "Serviços concluídos com sucesso" [ref=e423]:
                      - img [ref=e424]
                      - text: 230 serviços concluídos
                    - generic "Na plataforma desde" [ref=e427]:
                      - img [ref=e428]
                      - text: desde jan. de 2023
                - generic [ref=e432]:
                  - generic [ref=e433]:
                    - img [ref=e434]
                    - generic [ref=e436]: Instalação Elétrica · a partir de R$ 120,00
                  - heading "Construção 1 serviço" [level=3] [ref=e439]:
                    - button "Construção 1 serviço" [ref=e440]:
                      - generic [ref=e442]:
                        - paragraph [ref=e443]: Construção
                        - paragraph [ref=e444]: 1 serviço
                      - img
                - generic [ref=e445]:
                  - button "Orçamento" [ref=e446]:
                    - img
                    - text: Orçamento
                  - button "Agendar" [ref=e447]:
                    - img
                    - text: Agendar
              - generic [ref=e449]:
                - generic [ref=e450]:
                  - img "Capa de Ana Pintora" [ref=e451]
                  - generic [ref=e453]:
                    - img [ref=e454]
                    - text: Verificado
                  - generic [ref=e457]:
                    - button "Adicionar Ana Pintora à comparação" [ref=e458]:
                      - img [ref=e459]
                    - button "Adicionar Ana Pintora aos favoritos" [ref=e464]:
                      - img [ref=e465]
                  - img "Ana Pintora" [ref=e469]
                - generic [ref=e470]:
                  - generic [ref=e471]:
                    - button "Ver perfil de Ana Pintora" [ref=e472]:
                      - heading "Ana Pintora" [level=3] [ref=e473]:
                        - generic [ref=e474]: Ana Pintora
                        - img [ref=e475]
                    - generic "Avaliação média" [ref=e477]:
                      - img [ref=e478]
                      - text: "4.8"
                      - generic [ref=e480]: (42)
                  - paragraph [ref=e481]: a partir de R$ 120,00
                  - generic [ref=e482]:
                    - generic [ref=e483]:
                      - img [ref=e484]
                      - text: 2,5 km
                    - generic [ref=e487]:
                      - img [ref=e488]
                      - text: São Paulo
                  - paragraph [ref=e491]: Especialista em instalações elétricas residenciais com mais de 10 anos de experiência.
                  - generic [ref=e492]:
                    - generic "Serviços concluídos com sucesso" [ref=e493]:
                      - img [ref=e494]
                      - text: 230 serviços concluídos
                    - generic "Na plataforma desde" [ref=e497]:
                      - img [ref=e498]
                      - text: desde jan. de 2023
                - generic [ref=e502]:
                  - generic [ref=e503]:
                    - img [ref=e504]
                    - generic [ref=e506]: Instalação Elétrica · a partir de R$ 120,00
                  - heading "Pintura 1 serviço" [level=3] [ref=e509]:
                    - button "Pintura 1 serviço" [ref=e510]:
                      - generic [ref=e512]:
                        - paragraph [ref=e513]: Pintura
                        - paragraph [ref=e514]: 1 serviço
                      - img
                - generic [ref=e515]:
                  - button "Orçamento" [ref=e516]:
                    - img
                    - text: Orçamento
                  - button "Agendar" [ref=e517]:
                    - img
                    - text: Agendar
      - region "Como funciona" [ref=e518]:
        - generic [ref=e523]:
          - generic [ref=e524]:
            - link "Pular para resultados" [ref=e525] [cursor=pointer]:
              - /url: "#vitrine-resultados"
              - img [ref=e526]
              - text: Pular para resultados
            - generic [ref=e530]:
              - img [ref=e531]
              - generic [ref=e533]: "4"
              - text: passos simples
            - heading "Como funciona" [level=2] [ref=e534]
            - paragraph [ref=e535]: Sem surpresas — do início ao fim, você tem o controle.
            - generic [ref=e536]:
              - img [ref=e537]
              - text: Sem compromisso
          - generic [ref=e543]:
            - img [ref=e545]
            - generic [ref=e546]:
              - 'button "1 Busque o serviço Encontre prestadores verificados perto de você. 50 + categorias encanador em São Paulo | Verificados < 5 km Mais filtros Ex: Busque ''encanador em São Paulo'' Buscar prestadores" [ref=e547] [cursor=pointer]':
                - generic [ref=e549]:
                  - generic [ref=e551]: "1"
                  - generic [ref=e552]:
                    - img [ref=e554]
                    - img [ref=e558]
                  - heading "Busque o serviço" [level=3] [ref=e561]
                  - paragraph [ref=e562]: Encontre prestadores verificados perto de você.
                  - generic [ref=e564]:
                    - generic [ref=e565]: "50"
                    - text: +
                    - generic [ref=e566]: categorias
                  - generic [ref=e568]:
                    - generic [ref=e569]:
                      - img [ref=e570]
                      - generic [ref=e573]: encanador em São Paulo
                      - generic [ref=e574]: "|"
                    - generic [ref=e575]:
                      - generic [ref=e576]: Verificados
                      - generic [ref=e577]: < 5 km
                      - generic [ref=e578]:
                        - img [ref=e579]
                        - text: Mais filtros
                  - paragraph [ref=e581]: "Ex: Busque 'encanador em São Paulo'"
                  - button "Buscar prestadores" [ref=e582]:
                    - text: Buscar prestadores
                    - img
              - 'button "2 Compare orçamentos Receba e compare propostas lado a lado. 3 orçamentos em 24h João S. R$ 180 Maria L. R$ 150 Melhor avaliação Compare lado a lado Ex: Compare 3 orçamentos em 24h Sem compromisso Pedir orçamento" [ref=e583] [cursor=pointer]':
                - generic [ref=e585]:
                  - generic [ref=e587]: "2"
                  - generic [ref=e588]:
                    - img [ref=e590]
                    - img [ref=e596]
                  - heading "Compare orçamentos" [level=3] [ref=e599]
                  - paragraph [ref=e600]: Receba e compare propostas lado a lado.
                  - generic [ref=e602]:
                    - generic [ref=e603]: "3"
                    - generic [ref=e604]: orçamentos em 24h
                  - generic [ref=e606]:
                    - generic [ref=e607]:
                      - generic [ref=e608]:
                        - generic [ref=e611]: João S.
                        - generic [ref=e612]:
                          - img [ref=e613]
                          - img [ref=e615]
                          - img [ref=e617]
                          - img [ref=e619]
                          - img [ref=e621]
                        - generic [ref=e623]: R$ 180
                      - generic [ref=e624]:
                        - generic [ref=e627]: Maria L.
                        - generic [ref=e628]:
                          - img [ref=e629]
                          - img [ref=e631]
                          - img [ref=e633]
                          - img [ref=e635]
                          - img [ref=e637]
                        - generic [ref=e639]: R$ 150
                        - generic [ref=e640]: Melhor avaliação
                    - generic [ref=e641]:
                      - img [ref=e642]
                      - text: Compare lado a lado
                  - paragraph [ref=e647]: "Ex: Compare 3 orçamentos em 24h"
                  - generic [ref=e648]:
                    - img [ref=e649]
                    - text: Sem compromisso
                  - button "Pedir orçamento" [ref=e654]:
                    - text: Pedir orçamento
                    - img
              - 'button "3 Agende com confiança Solicite um orçamento ou agende diretamente. 24 h para confirmar Março 2025 S T Q Q S S D 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 12 Mar, 14:00 — Confirmado Ex: Agende para amanhã às 14h Agendar agora" [ref=e655] [cursor=pointer]':
                - generic [ref=e657]:
                  - generic [ref=e659]: "3"
                  - generic [ref=e660]:
                    - img [ref=e662]
                    - img [ref=e666]
                  - heading "Agende com confiança" [level=3] [ref=e669]
                  - paragraph [ref=e670]: Solicite um orçamento ou agende diretamente.
                  - generic [ref=e672]:
                    - generic [ref=e673]: "24"
                    - text: h
                    - generic [ref=e674]: para confirmar
                  - generic [ref=e677]:
                    - generic [ref=e678]: Março 2025
                    - generic [ref=e679]:
                      - generic [ref=e680]: S
                      - generic [ref=e681]: T
                      - generic [ref=e682]: Q
                      - generic [ref=e683]: Q
                      - generic [ref=e684]: S
                      - generic [ref=e685]: S
                      - generic [ref=e686]: D
                      - generic [ref=e687]: "1"
                      - generic [ref=e688]: "2"
                      - generic [ref=e689]: "3"
                      - generic [ref=e690]: "4"
                      - generic [ref=e691]: "5"
                      - generic [ref=e692]: "6"
                      - generic [ref=e693]: "7"
                      - generic [ref=e694]: "8"
                      - generic [ref=e695]: "9"
                      - generic [ref=e696]: "10"
                      - generic [ref=e697]: "11"
                      - generic [ref=e698]: "12"
                      - generic [ref=e699]: "13"
                      - generic [ref=e700]: "14"
                      - generic [ref=e701]: "15"
                    - generic [ref=e702]:
                      - img [ref=e703]
                      - generic [ref=e706]: 12 Mar, 14:00 — Confirmado
                  - paragraph [ref=e707]: "Ex: Agende para amanhã às 14h"
                  - button "Agendar agora" [ref=e708]:
                    - text: Agendar agora
                    - img
              - 'button "4 Avalie o resultado Sua opinião mantém a qualidade da comunidade. 98 % satisfação 4.0 \"Excelente trabalho, recomendo!\" Avaliação verificada Ex: Avalie de 1 a 5 estrelas com comentário Cadastrar grátis" [ref=e709] [cursor=pointer]':
                - generic [ref=e711]:
                  - generic [ref=e713]: "4"
                  - generic [ref=e714]:
                    - img [ref=e716]
                    - img [ref=e719]
                  - heading "Avalie o resultado" [level=3] [ref=e722]
                  - paragraph [ref=e723]: Sua opinião mantém a qualidade da comunidade.
                  - generic [ref=e725]:
                    - generic [ref=e726]: "98"
                    - text: "%"
                    - generic [ref=e727]: satisfação
                  - generic [ref=e729]:
                    - generic [ref=e730]:
                      - generic [ref=e731]:
                        - img [ref=e732]
                        - img [ref=e734]
                        - img [ref=e736]
                        - img [ref=e738]
                        - img [ref=e740]
                        - generic [ref=e742]: "4.0"
                      - paragraph [ref=e745]: "\"Excelente trabalho, recomendo!\""
                    - generic [ref=e746]:
                      - img [ref=e747]
                      - text: Avaliação verificada
                  - paragraph [ref=e750]: "Ex: Avalie de 1 a 5 estrelas com comentário"
                  - button "Cadastrar grátis" [ref=e751]:
                    - text: Cadastrar grátis
                    - img
          - generic [ref=e752]:
            - generic [ref=e753]:
              - img [ref=e754]
              - generic [ref=e757]: Garantia Severinno
            - generic [ref=e758]:
              - generic [ref=e759]:
                - img [ref=e760]
                - generic [ref=e763]: Prestadores verificados
              - generic [ref=e764]:
                - img [ref=e765]
                - generic [ref=e768]: Resposta rápida
              - generic [ref=e769]:
                - img [ref=e770]
                - generic [ref=e772]: Satisfação garantida
              - generic [ref=e773]:
                - img [ref=e774]
                - generic [ref=e779]: Compare antes de contratar
          - generic [ref=e780]:
            - button "Começar agora" [ref=e781]:
              - text: Começar agora
              - img
            - link "Buscar prestadores" [ref=e782] [cursor=pointer]:
              - /url: "#vitrine-resultados"
              - img
              - text: Buscar prestadores
          - button "Voltar ao topo" [ref=e784]:
            - img [ref=e785]
            - text: Voltar ao topo
      - generic [ref=e788]:
        - generic [ref=e789]:
          - generic [ref=e790]:
            - img
            - text: Simulador de preços
          - heading "Quanto custa? Simule agora" [level=2] [ref=e791]
          - paragraph [ref=e792]: Estime o valor do serviço em 3 passos rápidos. Sem compromisso, sem cadastro.
        - generic [ref=e793]:
          - generic [ref=e794]: "1"
          - generic [ref=e796]: "2"
          - generic [ref=e798]: "3"
        - generic [ref=e801]:
          - heading "1. Qual serviço você precisa?" [level=3] [ref=e802]
          - paragraph [ref=e803]: Selecione a categoria do serviço
          - generic [ref=e804]:
            - button "Elétrica" [ref=e805]:
              - img [ref=e807]
              - generic [ref=e809]: Elétrica
            - button "Hidráulica" [ref=e810]:
              - img [ref=e812]
              - generic [ref=e815]: Hidráulica
            - button "Pintura" [ref=e816]:
              - img [ref=e818]
              - generic [ref=e822]: Pintura
            - button "Alvenaria" [ref=e823]:
              - img [ref=e825]
              - generic [ref=e827]: Alvenaria
            - button "Pisos" [ref=e828]:
              - img [ref=e830]
              - generic [ref=e832]: Pisos
            - button "Pós-obra" [ref=e833]:
              - img [ref=e835]
              - generic [ref=e840]: Pós-obra
            - button "Residencial" [ref=e841]:
              - img [ref=e843]
              - generic [ref=e846]: Residencial
      - region "Parceiros e imprensa" [ref=e847]:
        - generic [ref=e848]:
          - paragraph [ref=e850]: Referência no mercado
          - generic [ref=e852]:
            - generic [ref=e855]: G1
            - generic [ref=e858]: Folha de S.Paulo
            - generic [ref=e861]: Valor Econômico
            - generic [ref=e864]: Exame
            - generic [ref=e867]: InfoMoney
            - generic [ref=e870]: Startups
            - generic [ref=e873]: Sebrae
            - generic [ref=e876]: ABES
          - paragraph [ref=e877]: + de 6.000 prestadores confiam no Severinno
      - region "Avaliações de clientes" [ref=e878]:
        - generic:
          - generic:
            - img
        - generic [ref=e879]:
          - generic [ref=e880]:
            - generic [ref=e881]:
              - img [ref=e882]
              - text: Avaliações reais
            - heading "O que nossos clientes dizem" [level=2] [ref=e884]
            - paragraph [ref=e885]: Avaliações de clientes após a conclusão do serviço.
          - generic [ref=e886]:
            - img [ref=e888]
            - heading "Não foi possível carregar as avaliações" [level=3] [ref=e893]
            - paragraph [ref=e894]: Ocorreu um erro ao buscar as avaliações. Tente novamente.
            - button "Tentar novamente" [ref=e895]:
              - img
              - text: Tentar novamente
      - generic [ref=e896]:
        - generic [ref=e899]:
          - generic [ref=e900]:
            - img [ref=e902]
            - generic [ref=e907]: "0"
            - paragraph [ref=e908]: Prestadores verificados
          - generic [ref=e909]:
            - img [ref=e911]
            - generic [ref=e913]: "0"
            - paragraph [ref=e914]: Serviços cadastrados
          - generic [ref=e915]:
            - img [ref=e917]
            - generic [ref=e920]: "0"
            - paragraph [ref=e921]: Serviços concluídos
          - generic [ref=e922]:
            - img [ref=e924]
            - generic [ref=e927]: 0.0/5
            - paragraph [ref=e928]: Nota média
        - generic [ref=e930]:
          - generic [ref=e931]:
            - generic [ref=e932]:
              - img [ref=e933]
              - text: Por que Severinno?
            - heading "Confiança em cada agendamento" [level=2] [ref=e936]
            - paragraph [ref=e937]: Mais que um diretório de serviços — um ecossistema pensado para proteger você e o prestador. Da verificação ao pagamento, cada etapa foi desenhada para a sua tranquilidade.
            - link "Pular para FAQ" [ref=e939] [cursor=pointer]:
              - /url: "#faq"
              - img [ref=e940]
              - text: Pular para FAQ
          - generic [ref=e943]:
            - generic [ref=e946]:
              - generic [ref=e947]:
                - img [ref=e949]
                - button "Saiba mais sobre Prestadores verificados" [ref=e952]:
                  - img [ref=e953]
              - heading "Prestadores verificados" [level=3] [ref=e956]
              - paragraph [ref=e957]: João verificou 3 documentos antes de aprovar o prestador. Você só vê profissionais validados.
              - button "Saiba mais" [ref=e958]:
                - text: Saiba mais
                - img [ref=e959]
            - generic [ref=e963]:
              - generic [ref=e964]:
                - img [ref=e966]
                - button "Saiba mais sobre Pagamento protegido" [ref=e969]:
                  - img [ref=e970]
              - heading "Pagamento protegido" [level=3] [ref=e973]
              - paragraph [ref=e974]: O valor só é liberado ao prestador após você confirmar que ficou satisfeito com o serviço.
              - button "Saiba mais" [ref=e975]:
                - text: Saiba mais
                - img [ref=e976]
            - generic [ref=e980]:
              - generic [ref=e981]:
                - img [ref=e983]
                - button "Saiba mais sobre Resposta rápida" [ref=e986]:
                  - img [ref=e987]
              - heading "Resposta rápida" [level=3] [ref=e990]
              - paragraph [ref=e991]: Prestadores comprometidos a responder em até 24h. Acompanhe o status em tempo real.
              - button "Saiba mais" [ref=e992]:
                - text: Saiba mais
                - img [ref=e993]
            - generic [ref=e997]:
              - generic [ref=e998]:
                - img [ref=e1000]
                - button "Saiba mais sobre Avaliações reais" [ref=e1002]:
                  - img [ref=e1003]
              - heading "Avaliações reais" [level=3] [ref=e1006]
              - paragraph [ref=e1007]: Apenas clientes que concluíram o serviço podem avaliar. Sem falsas avaliações.
              - button "Saiba mais" [ref=e1008]:
                - text: Saiba mais
                - img [ref=e1009]
            - generic [ref=e1013]:
              - generic [ref=e1014]:
                - img [ref=e1016]
                - button "Saiba mais sobre Próximo de você" [ref=e1019]:
                  - img [ref=e1020]
              - heading "Próximo de você" [level=3] [ref=e1023]
              - paragraph [ref=e1024]: Geolocalização inteligente mostra os melhores prestadores na sua região.
              - button "Saiba mais" [ref=e1025]:
                - text: Saiba mais
                - img [ref=e1026]
            - generic [ref=e1030]:
              - generic [ref=e1031]:
                - img [ref=e1033]
                - button "Saiba mais sobre Suporte humano" [ref=e1035]:
                  - img [ref=e1036]
              - heading "Suporte humano" [level=3] [ref=e1039]
              - paragraph [ref=e1040]: Equipe disponível para mediar disputas, tirar dúvidas e garantir uma experiência justa.
              - button "Saiba mais" [ref=e1041]:
                - text: Saiba mais
                - img [ref=e1042]
        - generic [ref=e1045]:
          - img [ref=e1046]
          - paragraph [ref=e1048]: "Garantia Severinno: seu dinheiro de volta se o serviço não for bem-feito."
          - link "Saiba mais" [ref=e1049] [cursor=pointer]:
            - /url: "#faq"
            - text: Saiba mais
            - img [ref=e1050]
      - generic [ref=e1053]:
        - generic [ref=e1054]:
          - generic [ref=e1055]:
            - img [ref=e1056]
            - text: Destaque da semana
          - heading "Profissional em destaque" [level=2] [ref=e1062]
          - paragraph [ref=e1063]: Conheça um dos nossos prestadores mais bem avaliados.
        - generic [ref=e1067]:
          - generic [ref=e1068]:
            - generic [ref=e1069]:
              - img [ref=e1072]
              - img [ref=e1076]
              - generic [ref=e1080]:
                - img [ref=e1081]
                - text: Top
            - generic [ref=e1083]:
              - generic [ref=e1084]:
                - heading "Maria Silva" [level=3] [ref=e1085]
                - generic [ref=e1086]:
                  - generic [ref=e1087]:
                    - img [ref=e1088]
                    - text: São Paulo
                  - generic [ref=e1091]: 3 km
                  - generic [ref=e1092]:
                    - img [ref=e1093]
                    - text: Membro desde 2023
              - generic [ref=e1095]:
                - generic [ref=e1096]:
                  - img [ref=e1097]
                  - generic [ref=e1099]: "4.8"
                - generic [ref=e1100]: (42 avaliações)
              - generic [ref=e1101]:
                - generic [ref=e1102]:
                  - img
                  - text: 230 serviços concluídos
                - generic [ref=e1103]:
                  - img
                  - text: Responde em ~30min
              - generic [ref=e1104]:
                - paragraph [ref=e1105]: Serviços
                - generic [ref=e1107]:
                  - generic [ref=e1108]: Instalação Elétrica
                  - generic [ref=e1109]: R$ 120,00
              - paragraph [ref=e1111]: Especialista em instalações elétricas residenciais com mais de 10 anos de experiência.
              - generic [ref=e1112]:
                - generic [ref=e1113]:
                  - generic "Maria S." [ref=e1114]: M
                  - generic "João P." [ref=e1115]: J
                  - generic "Ana L." [ref=e1116]: A
                - generic [ref=e1117]: Clientes recentes
          - generic [ref=e1118]:
            - generic [ref=e1119]:
              - button "Pedir orçamento" [ref=e1120]:
                - img
                - text: Pedir orçamento
              - button "Ver perfil completo" [ref=e1121]:
                - text: Ver perfil completo
                - img
            - button "Enviar mensagem" [ref=e1123]:
              - img
              - text: Enviar mensagem
      - generic [ref=e1127]:
        - generic [ref=e1128]:
          - generic [ref=e1129]:
            - generic [ref=e1130]:
              - img [ref=e1131]
              - text: Perguntas frequentes
            - heading "Tire suas dúvidas antes de contratar" [level=2] [ref=e1134]
            - paragraph [ref=e1135]: Reunimos as perguntas mais comuns sobre como o Severinno funciona — do cadastro ao pagamento.
          - generic [ref=e1136]:
            - img [ref=e1137]
            - textbox "Buscar nas perguntas frequentes" [ref=e1140]:
              - /placeholder: Buscar nas dúvidas…
          - generic [ref=e1141]:
            - paragraph [ref=e1142]: Filtrar por categoria
            - generic [ref=e1143]:
              - button "Filtrar por Geral" [ref=e1144]:
                - img [ref=e1145]
                - text: Geral
                - generic [ref=e1148]: (2)
              - button "Filtrar por Pagamento" [ref=e1149]:
                - img [ref=e1150]
                - text: Pagamento
                - generic [ref=e1152]: (2)
              - button "Filtrar por Agendamento" [ref=e1153]:
                - img [ref=e1154]
                - text: Agendamento
                - generic [ref=e1156]: (2)
              - button "Filtrar por Prestadores" [ref=e1157]:
                - img [ref=e1158]
                - text: Prestadores
                - generic [ref=e1162]: (2)
              - button "Filtrar por Segurança" [ref=e1163]:
                - img [ref=e1164]
                - text: Segurança
                - generic [ref=e1167]: (2)
          - generic [ref=e1168]:
            - paragraph [ref=e1169]: Perguntas mais frequentes
            - list [ref=e1170]:
              - listitem [ref=e1171]:
                - button "Como funciona o Severinno?" [ref=e1172]:
                  - img [ref=e1173]
                  - generic [ref=e1175]: Como funciona o Severinno?
              - listitem [ref=e1176]:
                - button "Preciso pagar para me cadastrar?" [ref=e1177]:
                  - img [ref=e1178]
                  - generic [ref=e1180]: Preciso pagar para me cadastrar?
              - listitem [ref=e1181]:
                - button "Como faço para agendar um serviço?" [ref=e1182]:
                  - img [ref=e1183]
                  - generic [ref=e1185]: Como faço para agendar um serviço?
              - listitem [ref=e1186]:
                - button "E se o serviço não for bem-feito?" [ref=e1187]:
                  - img [ref=e1188]
                  - generic [ref=e1190]: E se o serviço não for bem-feito?
          - generic [ref=e1192]:
            - img [ref=e1194]
            - generic [ref=e1196]:
              - paragraph [ref=e1197]: Ainda tem dúvidas?
              - paragraph [ref=e1198]: Cadastre-se grátis e converse diretamente com prestadores verificados. Sem compromisso.
              - generic [ref=e1199]:
                - button "Cadastrar grátis" [ref=e1200]
                - link "Fale conosco" [ref=e1201] [cursor=pointer]:
                  - /url: "#faq"
                  - img
                  - text: Fale conosco
        - generic [ref=e1202]:
          - generic [ref=e1204]:
            - generic [ref=e1206]:
              - heading "01 Como funciona o Severinno? Geral" [level=3] [ref=e1207]:
                - button "01 Como funciona o Severinno? Geral" [expanded] [ref=e1208]:
                  - generic [ref=e1209]:
                    - generic [ref=e1210]: "01"
                    - generic [ref=e1211]: Como funciona o Severinno?
                    - generic [ref=e1212]:
                      - img
                      - text: Geral
                  - img
              - region "01 Como funciona o Severinno? Geral" [ref=e1213]:
                - generic [ref=e1215]:
                  - paragraph [ref=e1216]: O Severinno conecta você a prestadores de serviço verificados próximos à sua localização. Você busca o serviço, compara avaliações reais de outros clientes, pede orçamento grátis e agenda — tudo pela plataforma. O pagamento só é liberado após você confirmar a conclusão do serviço.
                  - paragraph [ref=e1217]: "Ex: Maria precisava de um eletricista. Buscou na plataforma, comparou 3 profissionais e contratou o mais bem avaliado — tudo em 5 minutos."
            - heading "02 Preciso pagar para me cadastrar? Geral" [level=3] [ref=e1220]:
              - button "02 Preciso pagar para me cadastrar? Geral" [ref=e1221]:
                - generic [ref=e1222]:
                  - generic [ref=e1223]: "02"
                  - generic [ref=e1224]: Preciso pagar para me cadastrar?
                  - generic [ref=e1225]:
                    - img
                    - text: Geral
                - img
            - heading "03 Como os prestadores são verificados? Prestadores" [level=3] [ref=e1228]:
              - button "03 Como os prestadores são verificados? Prestadores" [ref=e1229]:
                - generic [ref=e1230]:
                  - generic [ref=e1231]: "03"
                  - generic [ref=e1232]: Como os prestadores são verificados?
                  - generic [ref=e1233]:
                    - img
                    - text: Prestadores
                - img
            - heading "04 Posso me tornar um prestador no Severinno? Prestadores" [level=3] [ref=e1236]:
              - button "04 Posso me tornar um prestador no Severinno? Prestadores" [ref=e1237]:
                - generic [ref=e1238]:
                  - generic [ref=e1239]: "04"
                  - generic [ref=e1240]: Posso me tornar um prestador no Severinno?
                  - generic [ref=e1241]:
                    - img
                    - text: Prestadores
                - img
            - heading "05 Como faço para agendar um serviço? Agendamento" [level=3] [ref=e1244]:
              - button "05 Como faço para agendar um serviço? Agendamento" [ref=e1245]:
                - generic [ref=e1246]:
                  - generic [ref=e1247]: "05"
                  - generic [ref=e1248]: Como faço para agendar um serviço?
                  - generic [ref=e1249]:
                    - img
                    - text: Agendamento
                - img
            - heading "06 Posso remarcar ou cancelar um agendamento? Agendamento" [level=3] [ref=e1252]:
              - button "06 Posso remarcar ou cancelar um agendamento? Agendamento" [ref=e1253]:
                - generic [ref=e1254]:
                  - generic [ref=e1255]: "06"
                  - generic [ref=e1256]: Posso remarcar ou cancelar um agendamento?
                  - generic [ref=e1257]:
                    - img
                    - text: Agendamento
                - img
            - heading "07 Como funciona o pagamento? Pagamento" [level=3] [ref=e1260]:
              - button "07 Como funciona o pagamento? Pagamento" [ref=e1261]:
                - generic [ref=e1262]:
                  - generic [ref=e1263]: "07"
                  - generic [ref=e1264]: Como funciona o pagamento?
                  - generic [ref=e1265]:
                    - img
                    - text: Pagamento
                - img
            - heading "08 O orçamento tem compromisso? Pagamento" [level=3] [ref=e1268]:
              - button "08 O orçamento tem compromisso? Pagamento" [ref=e1269]:
                - generic [ref=e1270]:
                  - generic [ref=e1271]: "08"
                  - generic [ref=e1272]: O orçamento tem compromisso?
                  - generic [ref=e1273]:
                    - img
                    - text: Pagamento
                - img
            - heading "09 E se o serviço não for bem-feito? Segurança" [level=3] [ref=e1276]:
              - button "09 E se o serviço não for bem-feito? Segurança" [ref=e1277]:
                - generic [ref=e1278]:
                  - generic [ref=e1279]: "09"
                  - generic [ref=e1280]: E se o serviço não for bem-feito?
                  - generic [ref=e1281]:
                    - img
                    - text: Segurança
                - img
            - heading "10 Meus dados pessoais estão seguros? Segurança" [level=3] [ref=e1284]:
              - button "10 Meus dados pessoais estão seguros? Segurança" [ref=e1285]:
                - generic [ref=e1286]:
                  - generic [ref=e1287]: "10"
                  - generic [ref=e1288]: Meus dados pessoais estão seguros?
                  - generic [ref=e1289]:
                    - img
                    - text: Segurança
                - img
          - generic [ref=e1290]:
            - paragraph [ref=e1291]: 10 de 10 dúvidas
            - button "Voltar ao topo da seção" [ref=e1292]:
              - img [ref=e1293]
              - text: Topo
      - generic [ref=e1297]:
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
        - generic [ref=e1302]:
          - generic [ref=e1303]:
            - generic [ref=e1305]:
              - img [ref=e1306]
              - text: Comece agora mesmo
            - heading "Encontre o serviço que você precisa" [level=2] [ref=e1308]
            - paragraph [ref=e1309]: Navegue pela vitrine, salve seus favoritos e agende com confiança. Tudo em um só lugar.
            - list [ref=e1310]:
              - generic [ref=e1311]:
                - listitem [ref=e1312]:
                  - img [ref=e1313]
                  - text: Cadastro gratuito
                - listitem [ref=e1316]:
                  - img [ref=e1317]
                  - text: Sem taxa de serviço
                - listitem [ref=e1320]:
                  - img [ref=e1321]
                  - text: Orçamento sem compromisso
            - button "Buscar prestadores" [ref=e1329]:
              - img
              - text: Buscar prestadores
              - generic [ref=e1330]:
                - img
          - generic [ref=e1331]:
            - generic [ref=e1332]:
              - heading "O que vem depois?" [level=3] [ref=e1333]
              - paragraph [ref=e1334]: Três passos simples e você estará agendando
              - generic [ref=e1335]:
                - img [ref=e1336]
                - generic [ref=e1337]:
                  - generic [ref=e1338]:
                    - generic [ref=e1340]: "1"
                    - generic [ref=e1341]:
                      - paragraph [ref=e1342]: Cadastre-se grátis
                      - paragraph [ref=e1343]: ~30s
                  - generic [ref=e1344]:
                    - generic [ref=e1346]: "2"
                    - generic [ref=e1347]:
                      - paragraph [ref=e1348]: Busque e compare
                      - paragraph [ref=e1349]: ~2 min
                  - generic [ref=e1350]:
                    - generic [ref=e1352]: "3"
                    - generic [ref=e1353]:
                      - paragraph [ref=e1354]: Agende com confiança
                      - paragraph [ref=e1355]: ~5 min
              - generic [ref=e1356]:
                - generic [ref=e1357]:
                  - img [ref=e1358]
                  - text: Sem compromisso
                - generic [ref=e1362]:
                  - img [ref=e1363]
                  - text: Cancele quando quiser
                - generic [ref=e1366]:
                  - img [ref=e1367]
                  - text: Suporte 24h
              - link "Saiba mais sobre pagamento protegido" [ref=e1370] [cursor=pointer]:
                - /url: "#faq"
                - img [ref=e1371]
                - text: Saiba mais sobre pagamento protegido
            - generic [ref=e1375]:
              - generic [ref=e1379]: Cliente
              - generic [ref=e1380]:
                - img [ref=e1384]
                - generic [ref=e1386]: Prestador
              - img [ref=e1391]
              - img [ref=e1393]
              - img [ref=e1397]
              - img [ref=e1400]
              - img [ref=e1404]
        - generic [ref=e1408]:
          - img [ref=e1409]
          - generic [ref=e1412]:
            - paragraph [ref=e1413]: “Encontrei um encanador em 10 minutos, paguei menos do que esperava e ainda pude avaliar o serviço. Recomendo demais!”
            - paragraph [ref=e1414]: — Ana P., Cliente, São Paulo
        - generic [ref=e1415]:
          - generic [ref=e1416]:
            - img [ref=e1417]
            - text: Sem compromisso
          - generic [ref=e1421]:
            - img [ref=e1422]
            - text: Cancele quando quiser
          - generic [ref=e1425]:
            - img [ref=e1426]
            - text: Pagamento protegido
    - contentinfo [ref=e1428]:
      - generic [ref=e1430]:
        - generic [ref=e1431]:
          - paragraph [ref=e1432]: Receba novidades e dicas de serviços
          - paragraph [ref=e1433]: Cadastre-se e receba ofertas exclusivas. Cancele quando quiser.
        - generic [ref=e1434]:
          - generic [ref=e1435]:
            - img [ref=e1436]
            - textbox "E-mail para newsletter" [ref=e1439]:
              - /placeholder: Seu e-mail
          - button "Assinar" [disabled]:
            - img
            - text: Assinar
      - generic [ref=e1440]:
        - generic [ref=e1441]:
          - generic [ref=e1442]:
            - generic [ref=e1443]:
              - img [ref=e1445]
              - generic [ref=e1448]: Severinno
            - paragraph [ref=e1449]: Marketplace de serviços com geolocalização. Encontre prestadores verificados, próximos e bem avaliados.
            - list "Redes sociais" [ref=e1450]:
              - listitem [ref=e1451]:
                - link "GitHub" [ref=e1452] [cursor=pointer]:
                  - /url: https://github.com
                  - img [ref=e1453]
              - listitem [ref=e1456]:
                - link "Twitter" [ref=e1457] [cursor=pointer]:
                  - /url: https://twitter.com
                  - img [ref=e1458]
              - listitem [ref=e1460]:
                - link "Instagram" [ref=e1461] [cursor=pointer]:
                  - /url: https://instagram.com
                  - img [ref=e1462]
              - listitem [ref=e1465]:
                - link "LinkedIn" [ref=e1466] [cursor=pointer]:
                  - /url: https://linkedin.com
                  - img [ref=e1467]
              - listitem [ref=e1471]:
                - link "E-mail" [ref=e1472] [cursor=pointer]:
                  - /url: mailto:contato@severinno.com
                  - img [ref=e1473]
          - navigation "Sobre" [ref=e1476]:
            - heading "Sobre" [level=3] [ref=e1477]:
              - img [ref=e1478]
              - text: Sobre
            - list [ref=e1481]:
              - listitem [ref=e1482]:
                - button "Como funciona" [ref=e1483]
              - listitem [ref=e1484]:
                - button "Quem somos" [ref=e1485]
              - listitem [ref=e1486]:
                - button "Termos de uso" [ref=e1487]
              - listitem [ref=e1488]:
                - button "Privacidade" [ref=e1489]
          - navigation "Para profissionais" [ref=e1490]:
            - heading "Para profissionais" [level=3] [ref=e1491]:
              - img [ref=e1492]
              - text: Para profissionais
            - list [ref=e1495]:
              - listitem [ref=e1496]:
                - button "Cadastre-se" [ref=e1497]
              - listitem [ref=e1498]:
                - button "Meu painel" [ref=e1499]
              - listitem [ref=e1500]:
                - button "Central de ajuda" [ref=e1501]
          - navigation "Precisa de ajuda?" [ref=e1502]:
            - heading "Precisa de ajuda?" [level=3] [ref=e1503]:
              - img [ref=e1504]
              - text: Precisa de ajuda?
            - list [ref=e1506]:
              - listitem [ref=e1507]:
                - button "Perguntas frequentes" [ref=e1508]
              - listitem [ref=e1509]:
                - button "Segurança" [ref=e1510]
              - listitem [ref=e1511]:
                - button "Reportar problema" [ref=e1512]
          - generic [ref=e1513]:
            - heading "Contato" [level=3] [ref=e1514]:
              - img [ref=e1515]
              - text: Contato
            - list [ref=e1520]:
              - listitem [ref=e1521]:
                - img [ref=e1522]
                - link "contato@severinno.com" [ref=e1525] [cursor=pointer]:
                  - /url: mailto:contato@severinno.com
              - listitem [ref=e1526]:
                - img [ref=e1527]
                - text: São Paulo, Brasil
            - button "Fale conosco" [ref=e1530]:
              - img
              - text: Fale conosco
        - generic [ref=e1531]:
          - paragraph [ref=e1532]: © 2026 Severinno Marketplace. Todos os direitos reservados.
          - paragraph [ref=e1533]:
            - text: Feito com
            - img [ref=e1534]
            - text: usando tecnologia Open Source (
            - link "MapLibre" [ref=e1536] [cursor=pointer]:
              - /url: https://maplibre.org/
            - text: ·
            - link "OpenStreetMap" [ref=e1537] [cursor=pointer]:
              - /url: https://www.openstreetmap.org/copyright
            - text: )
      - button "Voltar ao topo" [ref=e1538]:
        - img [ref=e1539]
    - button "Voltar ao topo" [ref=e1542]:
      - img
    - button "Abrir assistente virtual" [ref=e1543]:
      - img [ref=e1544]
    - generic [ref=e1548]:
      - generic [ref=e1549]:
        - img [ref=e1551]
        - generic [ref=e1553]:
          - paragraph [ref=e1554]: Usamos cookies para melhorar sua experiência
          - paragraph [ref=e1555]:
            - text: Utilizamos cookies essenciais para o funcionamento do site e cookies de análise para melhorar nossos serviços.
            - button "Política de privacidade" [ref=e1556]
      - generic [ref=e1557]:
        - button "Recusar" [ref=e1558]
        - button "Aceitar" [ref=e1559]:
          - img
          - text: Aceitar
        - button "Dispensar" [ref=e1560]:
          - img [ref=e1561]
  - region "Notifications alt+T"
  - generic [active]:
    - generic [ref=e1566]:
      - generic [ref=e1567]:
        - generic [ref=e1568]:
          - navigation [ref=e1569]:
            - button "previous" [disabled] [ref=e1570]:
              - img "previous" [ref=e1571]
            - generic [ref=e1573]:
              - generic [ref=e1574]: 1/
              - text: "1"
            - button "next" [disabled] [ref=e1575]:
              - img "next" [ref=e1576]
          - img
        - generic [ref=e1578]:
          - link "Next.js 16.1.3 (stale) Turbopack" [ref=e1579] [cursor=pointer]:
            - /url: https://nextjs.org/docs/messages/version-staleness
            - img [ref=e1580]
            - generic "There is a newer version (16.2.11) available, upgrade recommended!" [ref=e1582]: Next.js 16.1.3 (stale)
            - generic [ref=e1583]: Turbopack
          - img
      - dialog "Build Error" [ref=e1585]:
        - generic [ref=e1588]:
          - generic [ref=e1589]:
            - generic [ref=e1590]:
              - generic [ref=e1592]: Build Error
              - generic [ref=e1593]:
                - button "Copy Error Info" [ref=e1594] [cursor=pointer]:
                  - img [ref=e1595]
                - button "No related documentation found" [disabled] [ref=e1597]:
                  - img [ref=e1598]
                - button "Attach Node.js inspector" [ref=e1600] [cursor=pointer]:
                  - img [ref=e1601]
            - generic [ref=e1610]: Reading source code for parsing failed
          - generic [ref=e1612]:
            - generic [ref=e1614]:
              - img [ref=e1616]
              - generic [ref=e1620]: ./.freebuff/worktrees/thmrzp9vv9y86o/src/lib/api-server.ts
              - button "Open in editor" [ref=e1621] [cursor=pointer]:
                - img [ref=e1623]
            - generic [ref=e1627]: "Reading source code for parsing failed An unexpected error happened while trying to read the source code to parse: failed to convert rope into string Caused by: - invalid utf-8 sequence of 1 bytes from index 5415 Import trace: App Route: ./.freebuff/worktrees/thmrzp9vv9y86o/src/lib/api-server.ts ./.freebuff/worktrees/thmrzp9vv9y86o/src/app/api/auth/me/route.ts"
        - generic [ref=e1628]: "1"
        - generic [ref=e1629]: "2"
    - generic [ref=e1634] [cursor=pointer]:
      - button "Open Next.js Dev Tools" [ref=e1635]:
        - img [ref=e1636]
      - button "Open issues overlay" [ref=e1640]:
        - generic [ref=e1641]:
          - generic [ref=e1642]: "0"
          - generic [ref=e1643]: "1"
        - generic [ref=e1644]: Issue
  - alert [ref=e1645]
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