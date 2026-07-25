# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: booking-flow.spec.ts >> Fluxo de Agendamento — Casos de Erro e Validação >> 13. quantidade de serviços com valor inválido
- Location: e2e\booking-flow.spec.ts:627:7

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
    2 × waiting for element to be visible, enabled and stable
      - element is not stable
    - retrying click action
      - waiting 100ms
    7 × waiting for element to be visible, enabled and stable
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
        - generic [ref=e118]:
          - generic [ref=e124]: Atividade ao vivo
          - generic [ref=e126]:
            - img [ref=e127]
            - paragraph [ref=e129]: Carregando atividades…
      - region "Atividade recente na plataforma" [ref=e131]:
        - generic [ref=e132]:
          - generic [ref=e134]: Atividade recente
          - generic [ref=e138]:
            - generic [ref=e140]:
              - generic [ref=e141]:
                - generic [ref=e142]: ⚡
                - text: Maria contratou um eletricista em São Paulo
              - generic [ref=e144]:
                - generic [ref=e145]: ⭐
                - text: João avaliou ★★★★★ o prestador Ricardo
              - generic [ref=e147]:
                - generic [ref=e148]: 🎨
                - text: "Nova avaliação: 4.9 para Serviços de Pintura"
              - generic [ref=e150]:
                - generic [ref=e151]: 🔧
                - text: Ana pediu orçamento para encanador
              - generic [ref=e153]:
                - generic [ref=e154]: ✅
                - text: Pedro se cadastrou como prestador verificado
              - generic [ref=e156]:
                - generic [ref=e157]: 📋
                - text: 12 orçamentos enviados hoje
              - generic [ref=e159]:
                - generic [ref=e160]: ⚡
                - text: Maria contratou um eletricista em São Paulo
              - generic [ref=e162]:
                - generic [ref=e163]: ⭐
                - text: João avaliou ★★★★★ o prestador Ricardo
              - generic [ref=e165]:
                - generic [ref=e166]: 🎨
                - text: "Nova avaliação: 4.9 para Serviços de Pintura"
              - generic [ref=e168]:
                - generic [ref=e169]: 🔧
                - text: Ana pediu orçamento para encanador
              - generic [ref=e171]:
                - generic [ref=e172]: ✅
                - text: Pedro se cadastrou como prestador verificado
              - generic [ref=e174]:
                - generic [ref=e175]: 📋
                - text: 12 orçamentos enviados hoje
            - generic [ref=e179]:
              - generic [ref=e180]:
                - generic [ref=e181]: 🧹
                - text: Carlos agendou limpeza de quintal em Belo Horizonte
              - generic [ref=e183]:
                - generic [ref=e184]: ⭐
                - text: Fernanda avaliou ★★★★★ o prestador José
              - generic [ref=e186]:
                - generic [ref=e187]: 🛡️
                - text: 8 novos prestadores verificados esta semana
              - generic [ref=e189]:
                - generic [ref=e190]: 🎨
                - text: Luciana contratou um pintor no Rio de Janeiro
              - generic [ref=e192]:
                - generic [ref=e193]: 🚿
                - text: "Orçamento aceito: reforma de banheiro em Curitiba"
              - generic [ref=e195]:
                - generic [ref=e196]: 🏆
                - text: 5.200 serviços concluídos este mês
              - generic [ref=e198]:
                - generic [ref=e199]: 🧹
                - text: Carlos agendou limpeza de quintal em Belo Horizonte
              - generic [ref=e201]:
                - generic [ref=e202]: ⭐
                - text: Fernanda avaliou ★★★★★ o prestador José
              - generic [ref=e204]:
                - generic [ref=e205]: 🛡️
                - text: 8 novos prestadores verificados esta semana
              - generic [ref=e207]:
                - generic [ref=e208]: 🎨
                - text: Luciana contratou um pintor no Rio de Janeiro
              - generic [ref=e210]:
                - generic [ref=e211]: 🚿
                - text: "Orçamento aceito: reforma de banheiro em Curitiba"
              - generic [ref=e213]:
                - generic [ref=e214]: 🏆
                - text: 5.200 serviços concluídos este mês
      - region "Categorias de serviços" [ref=e216]:
        - generic [ref=e217]:
          - generic:
            - img
          - generic [ref=e219]:
            - generic [ref=e220]:
              - img [ref=e221]
              - text: Explore categorias
            - heading "Encontre o serviço ideal" [level=2] [ref=e224]
            - paragraph [ref=e225]: Serviços verificados perto de você — 0 categorias disponíveis
          - generic [ref=e226]:
            - img [ref=e228]
            - generic [ref=e231]:
              - paragraph [ref=e232]: Nenhuma categoria disponível
              - paragraph [ref=e233]: As categorias aparecerão aqui assim que estiverem disponíveis. Tente recarregar a página.
            - button "Tentar carregar categorias novamente" [ref=e234]:
              - img
              - text: Tentar novamente
      - region "Resultados da busca" [ref=e235]:
        - generic [ref=e236]:
          - complementary [ref=e237]:
            - generic [ref=e239]:
              - generic [ref=e240]:
                - heading "Filtros" [level=2] [ref=e241]:
                  - img [ref=e242]
                  - text: Filtros
                - button "Limpar filtros" [ref=e243]
              - generic [ref=e244]:
                - generic [ref=e245]: Buscar
                - generic [ref=e246]:
                  - img [ref=e247]
                  - textbox "Buscar" [ref=e250]:
                    - /placeholder: Serviço, prestador…
              - generic [ref=e251]:
                - generic [ref=e252]:
                  - generic [ref=e253]: Raio de busca
                  - generic [ref=e254]: 15 km
                - generic "Raio de busca em quilômetros" [ref=e255]:
                  - slider [ref=e259]
                - generic [ref=e260]:
                  - generic [ref=e261]: 1 km
                  - generic [ref=e262]: 50 km
              - generic [ref=e263]:
                - generic [ref=e264]: Categoria
                - combobox [ref=e265]:
                  - generic: Todas as categorias
                  - img
              - generic [ref=e266]:
                - generic [ref=e267]: Ordenar por
                - radiogroup "Ordenar por" [ref=e268]:
                  - radio "Melhor avaliação" [checked] [ref=e269]
                  - radio "Mais próximos" [ref=e270]
              - generic [ref=e271]:
                - generic [ref=e272]: Avaliação mínima
                - radiogroup [ref=e273]:
                  - generic [ref=e274] [cursor=pointer]:
                    - radio "Todas" [checked] [ref=e275]:
                      - img [ref=e276]
                    - generic [ref=e278]: Todas
                  - generic [ref=e279] [cursor=pointer]:
                    - radio "3+" [ref=e280]
                    - generic [ref=e281]: 3+
                  - generic [ref=e282] [cursor=pointer]:
                    - radio "4+" [ref=e283]
                    - generic [ref=e284]: 4+
                  - generic [ref=e285] [cursor=pointer]:
                    - radio "5" [ref=e286]
                    - generic [ref=e287]: "5"
              - generic [ref=e288] [cursor=pointer]:
                - generic [ref=e289]:
                  - img [ref=e290]
                  - generic [ref=e292]: Somente verificados
                - switch "Somente verificados" [ref=e293]
              - button "Ver 3 resultados" [disabled]
          - generic [ref=e294]:
            - generic [ref=e296]:
              - generic [ref=e297]:
                - heading "3 prestadores encontrados" [level=2] [ref=e298]
                - paragraph [ref=e299]: Exibindo 1–3 de 3
              - generic [ref=e300]:
                - generic [ref=e301]:
                  - text: "Ordenado por:"
                  - generic [ref=e302]: Melhor avaliação
                - tablist "Visualização" [ref=e303]:
                  - tab "Lista" [selected] [ref=e304]:
                    - img [ref=e305]
                    - generic [ref=e306]: Lista
                  - tab "Mapa" [ref=e307]:
                    - img [ref=e308]
                    - generic [ref=e310]: Mapa
            - generic [ref=e312]:
              - generic [ref=e314]:
                - generic [ref=e315]:
                  - img "Capa de Maria Silva" [ref=e316]
                  - generic [ref=e318]:
                    - img [ref=e319]
                    - text: Verificado
                  - generic [ref=e322]:
                    - button "Adicionar Maria Silva à comparação" [ref=e323]:
                      - img [ref=e324]
                    - button "Adicionar Maria Silva aos favoritos" [ref=e329]:
                      - img [ref=e330]
                  - img "Maria Silva" [ref=e334]
                - generic [ref=e335]:
                  - generic [ref=e336]:
                    - button "Ver perfil de Maria Silva" [ref=e337]:
                      - heading "Maria Silva" [level=3] [ref=e338]:
                        - generic [ref=e339]: Maria Silva
                        - img [ref=e340]
                    - generic "Avaliação média" [ref=e342]:
                      - img [ref=e343]
                      - text: "4.8"
                      - generic [ref=e345]: (42)
                  - paragraph [ref=e346]: a partir de R$ 120,00
                  - generic [ref=e347]:
                    - generic [ref=e348]:
                      - img [ref=e349]
                      - text: 2,5 km
                    - generic [ref=e352]:
                      - img [ref=e353]
                      - text: São Paulo
                  - paragraph [ref=e356]: Especialista em instalações elétricas residenciais com mais de 10 anos de experiência.
                  - generic [ref=e357]:
                    - generic "Serviços concluídos com sucesso" [ref=e358]:
                      - img [ref=e359]
                      - text: 230 serviços concluídos
                    - generic "Na plataforma desde" [ref=e362]:
                      - img [ref=e363]
                      - text: desde jan. de 2023
                - generic [ref=e367]:
                  - generic [ref=e368]:
                    - img [ref=e369]
                    - generic [ref=e371]: Instalação Elétrica · a partir de R$ 120,00
                  - heading "Elétrica 1 serviço" [level=3] [ref=e374]:
                    - button "Elétrica 1 serviço" [ref=e375]:
                      - generic [ref=e377]:
                        - paragraph [ref=e378]: Elétrica
                        - paragraph [ref=e379]: 1 serviço
                      - img
                - generic [ref=e380]:
                  - button "Orçamento" [ref=e381]:
                    - img
                    - text: Orçamento
                  - button "Agendar" [ref=e382]:
                    - img
                    - text: Agendar
              - generic [ref=e384]:
                - generic [ref=e385]:
                  - img "Capa de João Pedreiro" [ref=e386]
                  - generic [ref=e388]:
                    - img [ref=e389]
                    - text: Verificado
                  - generic [ref=e392]:
                    - button "Adicionar João Pedreiro à comparação" [ref=e393]:
                      - img [ref=e394]
                    - button "Adicionar João Pedreiro aos favoritos" [ref=e399]:
                      - img [ref=e400]
                  - img "João Pedreiro" [ref=e404]
                - generic [ref=e405]:
                  - generic [ref=e406]:
                    - button "Ver perfil de João Pedreiro" [ref=e407]:
                      - heading "João Pedreiro" [level=3] [ref=e408]:
                        - generic [ref=e409]: João Pedreiro
                        - img [ref=e410]
                    - generic "Avaliação média" [ref=e412]:
                      - img [ref=e413]
                      - text: "4.8"
                      - generic [ref=e415]: (42)
                  - paragraph [ref=e416]: a partir de R$ 120,00
                  - generic [ref=e417]:
                    - generic [ref=e418]:
                      - img [ref=e419]
                      - text: 2,5 km
                    - generic [ref=e422]:
                      - img [ref=e423]
                      - text: São Paulo
                  - paragraph [ref=e426]: Especialista em instalações elétricas residenciais com mais de 10 anos de experiência.
                  - generic [ref=e427]:
                    - generic "Serviços concluídos com sucesso" [ref=e428]:
                      - img [ref=e429]
                      - text: 230 serviços concluídos
                    - generic "Na plataforma desde" [ref=e432]:
                      - img [ref=e433]
                      - text: desde jan. de 2023
                - generic [ref=e437]:
                  - generic [ref=e438]:
                    - img [ref=e439]
                    - generic [ref=e441]: Instalação Elétrica · a partir de R$ 120,00
                  - heading "Construção 1 serviço" [level=3] [ref=e444]:
                    - button "Construção 1 serviço" [ref=e445]:
                      - generic [ref=e447]:
                        - paragraph [ref=e448]: Construção
                        - paragraph [ref=e449]: 1 serviço
                      - img
                - generic [ref=e450]:
                  - button "Orçamento" [ref=e451]:
                    - img
                    - text: Orçamento
                  - button "Agendar" [ref=e452]:
                    - img
                    - text: Agendar
              - generic [ref=e454]:
                - generic [ref=e455]:
                  - img "Capa de Ana Pintora" [ref=e456]
                  - generic [ref=e458]:
                    - img [ref=e459]
                    - text: Verificado
                  - generic [ref=e462]:
                    - button "Adicionar Ana Pintora à comparação" [ref=e463]:
                      - img [ref=e464]
                    - button "Adicionar Ana Pintora aos favoritos" [ref=e469]:
                      - img [ref=e470]
                  - img "Ana Pintora" [ref=e474]
                - generic [ref=e475]:
                  - generic [ref=e476]:
                    - button "Ver perfil de Ana Pintora" [ref=e477]:
                      - heading "Ana Pintora" [level=3] [ref=e478]:
                        - generic [ref=e479]: Ana Pintora
                        - img [ref=e480]
                    - generic "Avaliação média" [ref=e482]:
                      - img [ref=e483]
                      - text: "4.8"
                      - generic [ref=e485]: (42)
                  - paragraph [ref=e486]: a partir de R$ 120,00
                  - generic [ref=e487]:
                    - generic [ref=e488]:
                      - img [ref=e489]
                      - text: 2,5 km
                    - generic [ref=e492]:
                      - img [ref=e493]
                      - text: São Paulo
                  - paragraph [ref=e496]: Especialista em instalações elétricas residenciais com mais de 10 anos de experiência.
                  - generic [ref=e497]:
                    - generic "Serviços concluídos com sucesso" [ref=e498]:
                      - img [ref=e499]
                      - text: 230 serviços concluídos
                    - generic "Na plataforma desde" [ref=e502]:
                      - img [ref=e503]
                      - text: desde jan. de 2023
                - generic [ref=e507]:
                  - generic [ref=e508]:
                    - img [ref=e509]
                    - generic [ref=e511]: Instalação Elétrica · a partir de R$ 120,00
                  - heading "Pintura 1 serviço" [level=3] [ref=e514]:
                    - button "Pintura 1 serviço" [ref=e515]:
                      - generic [ref=e517]:
                        - paragraph [ref=e518]: Pintura
                        - paragraph [ref=e519]: 1 serviço
                      - img
                - generic [ref=e520]:
                  - button "Orçamento" [ref=e521]:
                    - img
                    - text: Orçamento
                  - button "Agendar" [ref=e522]:
                    - img
                    - text: Agendar
      - region "Como funciona" [ref=e523]:
        - generic [ref=e528]:
          - generic [ref=e529]:
            - link "Pular para resultados" [ref=e530] [cursor=pointer]:
              - /url: "#vitrine-resultados"
              - img [ref=e531]
              - text: Pular para resultados
            - generic [ref=e535]:
              - img [ref=e536]
              - generic [ref=e538]: "4"
              - text: passos simples
            - heading "Como funciona" [level=2] [ref=e539]
            - paragraph [ref=e540]: Sem surpresas — do início ao fim, você tem o controle.
            - generic [ref=e541]:
              - img [ref=e542]
              - text: Sem compromisso
          - generic [ref=e548]:
            - img [ref=e550]
            - generic [ref=e551]:
              - 'button "1 Busque o serviço Encontre prestadores verificados perto de você. 50 + categorias encanador em São Paulo | Verificados < 5 km Mais filtros Ex: Busque ''encanador em São Paulo'' Buscar prestadores" [ref=e552] [cursor=pointer]':
                - generic [ref=e554]:
                  - generic [ref=e556]: "1"
                  - generic [ref=e557]:
                    - img [ref=e559]
                    - img [ref=e563]
                  - heading "Busque o serviço" [level=3] [ref=e566]
                  - paragraph [ref=e567]: Encontre prestadores verificados perto de você.
                  - generic [ref=e569]:
                    - generic [ref=e570]: "50"
                    - text: +
                    - generic [ref=e571]: categorias
                  - generic [ref=e573]:
                    - generic [ref=e574]:
                      - img [ref=e575]
                      - generic [ref=e578]: encanador em São Paulo
                      - generic [ref=e579]: "|"
                    - generic [ref=e580]:
                      - generic [ref=e581]: Verificados
                      - generic [ref=e582]: < 5 km
                      - generic [ref=e583]:
                        - img [ref=e584]
                        - text: Mais filtros
                  - paragraph [ref=e586]: "Ex: Busque 'encanador em São Paulo'"
                  - button "Buscar prestadores" [ref=e587]:
                    - text: Buscar prestadores
                    - img
              - 'button "2 Compare orçamentos Receba e compare propostas lado a lado. 3 orçamentos em 24h João S. R$ 180 Maria L. R$ 150 Melhor avaliação Compare lado a lado Ex: Compare 3 orçamentos em 24h Sem compromisso Pedir orçamento" [ref=e588] [cursor=pointer]':
                - generic [ref=e590]:
                  - generic [ref=e592]: "2"
                  - generic [ref=e593]:
                    - img [ref=e595]
                    - img [ref=e601]
                  - heading "Compare orçamentos" [level=3] [ref=e604]
                  - paragraph [ref=e605]: Receba e compare propostas lado a lado.
                  - generic [ref=e607]:
                    - generic [ref=e608]: "3"
                    - generic [ref=e609]: orçamentos em 24h
                  - generic [ref=e611]:
                    - generic [ref=e612]:
                      - generic [ref=e613]:
                        - generic [ref=e616]: João S.
                        - generic [ref=e617]:
                          - img [ref=e618]
                          - img [ref=e620]
                          - img [ref=e622]
                          - img [ref=e624]
                          - img [ref=e626]
                        - generic [ref=e628]: R$ 180
                      - generic [ref=e629]:
                        - generic [ref=e632]: Maria L.
                        - generic [ref=e633]:
                          - img [ref=e634]
                          - img [ref=e636]
                          - img [ref=e638]
                          - img [ref=e640]
                          - img [ref=e642]
                        - generic [ref=e644]: R$ 150
                        - generic [ref=e645]: Melhor avaliação
                    - generic [ref=e646]:
                      - img [ref=e647]
                      - text: Compare lado a lado
                  - paragraph [ref=e652]: "Ex: Compare 3 orçamentos em 24h"
                  - generic [ref=e653]:
                    - img [ref=e654]
                    - text: Sem compromisso
                  - button "Pedir orçamento" [ref=e659]:
                    - text: Pedir orçamento
                    - img
              - 'button "3 Agende com confiança Solicite um orçamento ou agende diretamente. 24 h para confirmar Março 2025 S T Q Q S S D 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 12 Mar, 14:00 — Confirmado Ex: Agende para amanhã às 14h Agendar agora" [ref=e660] [cursor=pointer]':
                - generic [ref=e662]:
                  - generic [ref=e664]: "3"
                  - generic [ref=e665]:
                    - img [ref=e667]
                    - img [ref=e671]
                  - heading "Agende com confiança" [level=3] [ref=e674]
                  - paragraph [ref=e675]: Solicite um orçamento ou agende diretamente.
                  - generic [ref=e677]:
                    - generic [ref=e678]: "24"
                    - text: h
                    - generic [ref=e679]: para confirmar
                  - generic [ref=e682]:
                    - generic [ref=e683]: Março 2025
                    - generic [ref=e684]:
                      - generic [ref=e685]: S
                      - generic [ref=e686]: T
                      - generic [ref=e687]: Q
                      - generic [ref=e688]: Q
                      - generic [ref=e689]: S
                      - generic [ref=e690]: S
                      - generic [ref=e691]: D
                      - generic [ref=e692]: "1"
                      - generic [ref=e693]: "2"
                      - generic [ref=e694]: "3"
                      - generic [ref=e695]: "4"
                      - generic [ref=e696]: "5"
                      - generic [ref=e697]: "6"
                      - generic [ref=e698]: "7"
                      - generic [ref=e699]: "8"
                      - generic [ref=e700]: "9"
                      - generic [ref=e701]: "10"
                      - generic [ref=e702]: "11"
                      - generic [ref=e703]: "12"
                      - generic [ref=e704]: "13"
                      - generic [ref=e705]: "14"
                      - generic [ref=e706]: "15"
                    - generic [ref=e707]:
                      - img [ref=e708]
                      - generic [ref=e711]: 12 Mar, 14:00 — Confirmado
                  - paragraph [ref=e712]: "Ex: Agende para amanhã às 14h"
                  - button "Agendar agora" [ref=e713]:
                    - text: Agendar agora
                    - img
              - 'button "4 Avalie o resultado Sua opinião mantém a qualidade da comunidade. 98 % satisfação 4.0 \"Excelente trabalho, recomendo!\" Avaliação verificada Ex: Avalie de 1 a 5 estrelas com comentário Cadastrar grátis" [ref=e714] [cursor=pointer]':
                - generic [ref=e716]:
                  - generic [ref=e718]: "4"
                  - generic [ref=e719]:
                    - img [ref=e721]
                    - img [ref=e724]
                  - heading "Avalie o resultado" [level=3] [ref=e727]
                  - paragraph [ref=e728]: Sua opinião mantém a qualidade da comunidade.
                  - generic [ref=e730]:
                    - generic [ref=e731]: "98"
                    - text: "%"
                    - generic [ref=e732]: satisfação
                  - generic [ref=e734]:
                    - generic [ref=e735]:
                      - generic [ref=e736]:
                        - img [ref=e737]
                        - img [ref=e739]
                        - img [ref=e741]
                        - img [ref=e743]
                        - img [ref=e745]
                        - generic [ref=e747]: "4.0"
                      - paragraph [ref=e750]: "\"Excelente trabalho, recomendo!\""
                    - generic [ref=e751]:
                      - img [ref=e752]
                      - text: Avaliação verificada
                  - paragraph [ref=e755]: "Ex: Avalie de 1 a 5 estrelas com comentário"
                  - button "Cadastrar grátis" [ref=e756]:
                    - text: Cadastrar grátis
                    - img
          - generic [ref=e757]:
            - generic [ref=e758]:
              - img [ref=e759]
              - generic [ref=e762]: Garantia Severinno
            - generic [ref=e763]:
              - generic [ref=e764]:
                - img [ref=e765]
                - generic [ref=e768]: Prestadores verificados
              - generic [ref=e769]:
                - img [ref=e770]
                - generic [ref=e773]: Resposta rápida
              - generic [ref=e774]:
                - img [ref=e775]
                - generic [ref=e777]: Satisfação garantida
              - generic [ref=e778]:
                - img [ref=e779]
                - generic [ref=e784]: Compare antes de contratar
          - generic [ref=e785]:
            - button "Começar agora" [ref=e786]:
              - text: Começar agora
              - img
            - link "Buscar prestadores" [ref=e787] [cursor=pointer]:
              - /url: "#vitrine-resultados"
              - img
              - text: Buscar prestadores
          - button "Voltar ao topo" [ref=e789]:
            - img [ref=e790]
            - text: Voltar ao topo
      - generic [ref=e793]:
        - generic [ref=e794]:
          - generic [ref=e795]:
            - img
            - text: Simulador de preços
          - heading "Quanto custa? Simule agora" [level=2] [ref=e796]
          - paragraph [ref=e797]: Estime o valor do serviço em 3 passos rápidos. Sem compromisso, sem cadastro.
        - generic [ref=e798]:
          - generic [ref=e799]: "1"
          - generic [ref=e801]: "2"
          - generic [ref=e803]: "3"
        - generic [ref=e806]:
          - heading "1. Qual serviço você precisa?" [level=3] [ref=e807]
          - paragraph [ref=e808]: Selecione a categoria do serviço
          - generic [ref=e809]:
            - button "Elétrica" [ref=e810]:
              - img [ref=e812]
              - generic [ref=e814]: Elétrica
            - button "Hidráulica" [ref=e815]:
              - img [ref=e817]
              - generic [ref=e820]: Hidráulica
            - button "Pintura" [ref=e821]:
              - img [ref=e823]
              - generic [ref=e827]: Pintura
            - button "Alvenaria" [ref=e828]:
              - img [ref=e830]
              - generic [ref=e832]: Alvenaria
            - button "Pisos" [ref=e833]:
              - img [ref=e835]
              - generic [ref=e837]: Pisos
            - button "Pós-obra" [ref=e838]:
              - img [ref=e840]
              - generic [ref=e845]: Pós-obra
            - button "Residencial" [ref=e846]:
              - img [ref=e848]
              - generic [ref=e851]: Residencial
      - region "Parceiros e imprensa" [ref=e852]:
        - generic [ref=e853]:
          - paragraph [ref=e855]: Referência no mercado
          - generic [ref=e857]:
            - generic [ref=e860]: G1
            - generic [ref=e863]: Folha de S.Paulo
            - generic [ref=e866]: Valor Econômico
            - generic [ref=e869]: Exame
            - generic [ref=e872]: InfoMoney
            - generic [ref=e875]: Startups
            - generic [ref=e878]: Sebrae
            - generic [ref=e881]: ABES
          - paragraph [ref=e882]: + de 6.000 prestadores confiam no Severinno
      - region "Avaliações de clientes" [ref=e883]:
        - generic:
          - generic:
            - img
        - generic [ref=e884]:
          - generic [ref=e885]:
            - generic [ref=e886]:
              - img [ref=e887]
              - text: Avaliações reais
            - heading "O que nossos clientes dizem" [level=2] [ref=e889]
            - paragraph [ref=e890]: Avaliações de clientes após a conclusão do serviço.
          - generic [ref=e891]:
            - img [ref=e893]
            - heading "Não foi possível carregar as avaliações" [level=3] [ref=e898]
            - paragraph [ref=e899]: Ocorreu um erro ao buscar as avaliações. Tente novamente.
            - button "Tentar novamente" [ref=e900]:
              - img
              - text: Tentar novamente
      - generic [ref=e901]:
        - generic [ref=e904]:
          - generic [ref=e905]:
            - img [ref=e907]
            - generic [ref=e912]: "0"
            - paragraph [ref=e913]: Prestadores verificados
          - generic [ref=e914]:
            - img [ref=e916]
            - generic [ref=e918]: "0"
            - paragraph [ref=e919]: Serviços cadastrados
          - generic [ref=e920]:
            - img [ref=e922]
            - generic [ref=e925]: "0"
            - paragraph [ref=e926]: Serviços concluídos
          - generic [ref=e927]:
            - img [ref=e929]
            - generic [ref=e932]: 0.0/5
            - paragraph [ref=e933]: Nota média
        - generic [ref=e935]:
          - generic [ref=e936]:
            - generic [ref=e937]:
              - img [ref=e938]
              - text: Por que Severinno?
            - heading "Confiança em cada agendamento" [level=2] [ref=e941]
            - paragraph [ref=e942]: Mais que um diretório de serviços — um ecossistema pensado para proteger você e o prestador. Da verificação ao pagamento, cada etapa foi desenhada para a sua tranquilidade.
            - link "Pular para FAQ" [ref=e944] [cursor=pointer]:
              - /url: "#faq"
              - img [ref=e945]
              - text: Pular para FAQ
          - generic [ref=e948]:
            - generic [ref=e951]:
              - generic [ref=e952]:
                - img [ref=e954]
                - button "Saiba mais sobre Prestadores verificados" [ref=e957]:
                  - img [ref=e958]
              - heading "Prestadores verificados" [level=3] [ref=e961]
              - paragraph [ref=e962]: João verificou 3 documentos antes de aprovar o prestador. Você só vê profissionais validados.
              - button "Saiba mais" [ref=e963]:
                - text: Saiba mais
                - img [ref=e964]
            - generic [ref=e968]:
              - generic [ref=e969]:
                - img [ref=e971]
                - button "Saiba mais sobre Pagamento protegido" [ref=e974]:
                  - img [ref=e975]
              - heading "Pagamento protegido" [level=3] [ref=e978]
              - paragraph [ref=e979]: O valor só é liberado ao prestador após você confirmar que ficou satisfeito com o serviço.
              - button "Saiba mais" [ref=e980]:
                - text: Saiba mais
                - img [ref=e981]
            - generic [ref=e985]:
              - generic [ref=e986]:
                - img [ref=e988]
                - button "Saiba mais sobre Resposta rápida" [ref=e991]:
                  - img [ref=e992]
              - heading "Resposta rápida" [level=3] [ref=e995]
              - paragraph [ref=e996]: Prestadores comprometidos a responder em até 24h. Acompanhe o status em tempo real.
              - button "Saiba mais" [ref=e997]:
                - text: Saiba mais
                - img [ref=e998]
            - generic [ref=e1002]:
              - generic [ref=e1003]:
                - img [ref=e1005]
                - button "Saiba mais sobre Avaliações reais" [ref=e1007]:
                  - img [ref=e1008]
              - heading "Avaliações reais" [level=3] [ref=e1011]
              - paragraph [ref=e1012]: Apenas clientes que concluíram o serviço podem avaliar. Sem falsas avaliações.
              - button "Saiba mais" [ref=e1013]:
                - text: Saiba mais
                - img [ref=e1014]
            - generic [ref=e1018]:
              - generic [ref=e1019]:
                - img [ref=e1021]
                - button "Saiba mais sobre Próximo de você" [ref=e1024]:
                  - img [ref=e1025]
              - heading "Próximo de você" [level=3] [ref=e1028]
              - paragraph [ref=e1029]: Geolocalização inteligente mostra os melhores prestadores na sua região.
              - button "Saiba mais" [ref=e1030]:
                - text: Saiba mais
                - img [ref=e1031]
            - generic [ref=e1035]:
              - generic [ref=e1036]:
                - img [ref=e1038]
                - button "Saiba mais sobre Suporte humano" [ref=e1040]:
                  - img [ref=e1041]
              - heading "Suporte humano" [level=3] [ref=e1044]
              - paragraph [ref=e1045]: Equipe disponível para mediar disputas, tirar dúvidas e garantir uma experiência justa.
              - button "Saiba mais" [ref=e1046]:
                - text: Saiba mais
                - img [ref=e1047]
        - generic [ref=e1050]:
          - img [ref=e1051]
          - paragraph [ref=e1053]: "Garantia Severinno: seu dinheiro de volta se o serviço não for bem-feito."
          - link "Saiba mais" [ref=e1054] [cursor=pointer]:
            - /url: "#faq"
            - text: Saiba mais
            - img [ref=e1055]
      - generic [ref=e1058]:
        - generic [ref=e1059]:
          - generic [ref=e1060]:
            - img [ref=e1061]
            - text: Destaque da semana
          - heading "Profissional em destaque" [level=2] [ref=e1067]
          - paragraph [ref=e1068]: Conheça um dos nossos prestadores mais bem avaliados.
        - generic [ref=e1072]:
          - generic [ref=e1073]:
            - generic [ref=e1074]:
              - img [ref=e1077]
              - img [ref=e1081]
              - generic [ref=e1085]:
                - img [ref=e1086]
                - text: Top
            - generic [ref=e1088]:
              - generic [ref=e1089]:
                - heading "Maria Silva" [level=3] [ref=e1090]
                - generic [ref=e1091]:
                  - generic [ref=e1092]:
                    - img [ref=e1093]
                    - text: São Paulo
                  - generic [ref=e1096]: 3 km
                  - generic [ref=e1097]:
                    - img [ref=e1098]
                    - text: Membro desde 2023
              - generic [ref=e1100]:
                - generic [ref=e1101]:
                  - img [ref=e1102]
                  - generic [ref=e1104]: "4.8"
                - generic [ref=e1105]: (42 avaliações)
              - generic [ref=e1106]:
                - generic [ref=e1107]:
                  - img
                  - text: 230 serviços concluídos
                - generic [ref=e1108]:
                  - img
                  - text: Responde em ~30min
              - generic [ref=e1109]:
                - paragraph [ref=e1110]: Serviços
                - generic [ref=e1112]:
                  - generic [ref=e1113]: Instalação Elétrica
                  - generic [ref=e1114]: R$ 120,00
              - paragraph [ref=e1116]: Especialista em instalações elétricas residenciais com mais de 10 anos de experiência.
              - generic [ref=e1117]:
                - generic [ref=e1118]:
                  - generic "Maria S." [ref=e1119]: M
                  - generic "João P." [ref=e1120]: J
                  - generic "Ana L." [ref=e1121]: A
                - generic [ref=e1122]: Clientes recentes
          - generic [ref=e1123]:
            - generic [ref=e1124]:
              - button "Pedir orçamento" [ref=e1125]:
                - img
                - text: Pedir orçamento
              - button "Ver perfil completo" [ref=e1126]:
                - text: Ver perfil completo
                - img
            - button "Enviar mensagem" [ref=e1128]:
              - img
              - text: Enviar mensagem
      - generic [ref=e1132]:
        - generic [ref=e1133]:
          - generic [ref=e1134]:
            - generic [ref=e1135]:
              - img [ref=e1136]
              - text: Perguntas frequentes
            - heading "Tire suas dúvidas antes de contratar" [level=2] [ref=e1139]
            - paragraph [ref=e1140]: Reunimos as perguntas mais comuns sobre como o Severinno funciona — do cadastro ao pagamento.
          - generic [ref=e1141]:
            - img [ref=e1142]
            - textbox "Buscar nas perguntas frequentes" [ref=e1145]:
              - /placeholder: Buscar nas dúvidas…
          - generic [ref=e1146]:
            - paragraph [ref=e1147]: Filtrar por categoria
            - generic [ref=e1148]:
              - button "Filtrar por Geral" [ref=e1149]:
                - img [ref=e1150]
                - text: Geral
                - generic [ref=e1153]: (2)
              - button "Filtrar por Pagamento" [ref=e1154]:
                - img [ref=e1155]
                - text: Pagamento
                - generic [ref=e1157]: (2)
              - button "Filtrar por Agendamento" [ref=e1158]:
                - img [ref=e1159]
                - text: Agendamento
                - generic [ref=e1161]: (2)
              - button "Filtrar por Prestadores" [ref=e1162]:
                - img [ref=e1163]
                - text: Prestadores
                - generic [ref=e1167]: (2)
              - button "Filtrar por Segurança" [ref=e1168]:
                - img [ref=e1169]
                - text: Segurança
                - generic [ref=e1172]: (2)
          - generic [ref=e1173]:
            - paragraph [ref=e1174]: Perguntas mais frequentes
            - list [ref=e1175]:
              - listitem [ref=e1176]:
                - button "Como funciona o Severinno?" [ref=e1177]:
                  - img [ref=e1178]
                  - generic [ref=e1180]: Como funciona o Severinno?
              - listitem [ref=e1181]:
                - button "Preciso pagar para me cadastrar?" [ref=e1182]:
                  - img [ref=e1183]
                  - generic [ref=e1185]: Preciso pagar para me cadastrar?
              - listitem [ref=e1186]:
                - button "Como faço para agendar um serviço?" [ref=e1187]:
                  - img [ref=e1188]
                  - generic [ref=e1190]: Como faço para agendar um serviço?
              - listitem [ref=e1191]:
                - button "E se o serviço não for bem-feito?" [ref=e1192]:
                  - img [ref=e1193]
                  - generic [ref=e1195]: E se o serviço não for bem-feito?
          - generic [ref=e1197]:
            - img [ref=e1199]
            - generic [ref=e1201]:
              - paragraph [ref=e1202]: Ainda tem dúvidas?
              - paragraph [ref=e1203]: Cadastre-se grátis e converse diretamente com prestadores verificados. Sem compromisso.
              - generic [ref=e1204]:
                - button "Cadastrar grátis" [ref=e1205]
                - link "Fale conosco" [ref=e1206] [cursor=pointer]:
                  - /url: "#faq"
                  - img
                  - text: Fale conosco
        - generic [ref=e1207]:
          - generic [ref=e1209]:
            - generic [ref=e1211]:
              - heading "01 Como funciona o Severinno? Geral" [level=3] [ref=e1212]:
                - button "01 Como funciona o Severinno? Geral" [expanded] [ref=e1213]:
                  - generic [ref=e1214]:
                    - generic [ref=e1215]: "01"
                    - generic [ref=e1216]: Como funciona o Severinno?
                    - generic [ref=e1217]:
                      - img
                      - text: Geral
                  - img
              - region "01 Como funciona o Severinno? Geral" [ref=e1218]:
                - generic [ref=e1220]:
                  - paragraph [ref=e1221]: O Severinno conecta você a prestadores de serviço verificados próximos à sua localização. Você busca o serviço, compara avaliações reais de outros clientes, pede orçamento grátis e agenda — tudo pela plataforma. O pagamento só é liberado após você confirmar a conclusão do serviço.
                  - paragraph [ref=e1222]: "Ex: Maria precisava de um eletricista. Buscou na plataforma, comparou 3 profissionais e contratou o mais bem avaliado — tudo em 5 minutos."
            - heading "02 Preciso pagar para me cadastrar? Geral" [level=3] [ref=e1225]:
              - button "02 Preciso pagar para me cadastrar? Geral" [ref=e1226]:
                - generic [ref=e1227]:
                  - generic [ref=e1228]: "02"
                  - generic [ref=e1229]: Preciso pagar para me cadastrar?
                  - generic [ref=e1230]:
                    - img
                    - text: Geral
                - img
            - heading "03 Como os prestadores são verificados? Prestadores" [level=3] [ref=e1233]:
              - button "03 Como os prestadores são verificados? Prestadores" [ref=e1234]:
                - generic [ref=e1235]:
                  - generic [ref=e1236]: "03"
                  - generic [ref=e1237]: Como os prestadores são verificados?
                  - generic [ref=e1238]:
                    - img
                    - text: Prestadores
                - img
            - heading "04 Posso me tornar um prestador no Severinno? Prestadores" [level=3] [ref=e1241]:
              - button "04 Posso me tornar um prestador no Severinno? Prestadores" [ref=e1242]:
                - generic [ref=e1243]:
                  - generic [ref=e1244]: "04"
                  - generic [ref=e1245]: Posso me tornar um prestador no Severinno?
                  - generic [ref=e1246]:
                    - img
                    - text: Prestadores
                - img
            - heading "05 Como faço para agendar um serviço? Agendamento" [level=3] [ref=e1249]:
              - button "05 Como faço para agendar um serviço? Agendamento" [ref=e1250]:
                - generic [ref=e1251]:
                  - generic [ref=e1252]: "05"
                  - generic [ref=e1253]: Como faço para agendar um serviço?
                  - generic [ref=e1254]:
                    - img
                    - text: Agendamento
                - img
            - heading "06 Posso remarcar ou cancelar um agendamento? Agendamento" [level=3] [ref=e1257]:
              - button "06 Posso remarcar ou cancelar um agendamento? Agendamento" [ref=e1258]:
                - generic [ref=e1259]:
                  - generic [ref=e1260]: "06"
                  - generic [ref=e1261]: Posso remarcar ou cancelar um agendamento?
                  - generic [ref=e1262]:
                    - img
                    - text: Agendamento
                - img
            - heading "07 Como funciona o pagamento? Pagamento" [level=3] [ref=e1265]:
              - button "07 Como funciona o pagamento? Pagamento" [ref=e1266]:
                - generic [ref=e1267]:
                  - generic [ref=e1268]: "07"
                  - generic [ref=e1269]: Como funciona o pagamento?
                  - generic [ref=e1270]:
                    - img
                    - text: Pagamento
                - img
            - heading "08 O orçamento tem compromisso? Pagamento" [level=3] [ref=e1273]:
              - button "08 O orçamento tem compromisso? Pagamento" [ref=e1274]:
                - generic [ref=e1275]:
                  - generic [ref=e1276]: "08"
                  - generic [ref=e1277]: O orçamento tem compromisso?
                  - generic [ref=e1278]:
                    - img
                    - text: Pagamento
                - img
            - heading "09 E se o serviço não for bem-feito? Segurança" [level=3] [ref=e1281]:
              - button "09 E se o serviço não for bem-feito? Segurança" [ref=e1282]:
                - generic [ref=e1283]:
                  - generic [ref=e1284]: "09"
                  - generic [ref=e1285]: E se o serviço não for bem-feito?
                  - generic [ref=e1286]:
                    - img
                    - text: Segurança
                - img
            - heading "10 Meus dados pessoais estão seguros? Segurança" [level=3] [ref=e1289]:
              - button "10 Meus dados pessoais estão seguros? Segurança" [ref=e1290]:
                - generic [ref=e1291]:
                  - generic [ref=e1292]: "10"
                  - generic [ref=e1293]: Meus dados pessoais estão seguros?
                  - generic [ref=e1294]:
                    - img
                    - text: Segurança
                - img
          - generic [ref=e1295]:
            - paragraph [ref=e1296]: 10 de 10 dúvidas
            - button "Voltar ao topo da seção" [ref=e1297]:
              - img [ref=e1298]
              - text: Topo
      - generic [ref=e1302]:
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
        - generic [ref=e1307]:
          - generic [ref=e1308]:
            - generic [ref=e1310]:
              - img [ref=e1311]
              - text: Comece agora mesmo
            - heading "Pronto para encontrar o prestador ideal?" [level=2] [ref=e1313]
            - paragraph [ref=e1314]: Comece em 30 segundos — é como pedir um Uber, mas para serviços. Cadastre-se gratuitamente e tenha acesso a prestadores verificados.
            - generic [ref=e1315]:
              - button "Para clientes" [ref=e1316]: Para clientes
              - button "Para prestadores" [ref=e1318]
            - list [ref=e1319]:
              - generic [ref=e1320]:
                - listitem [ref=e1321]:
                  - img [ref=e1322]
                  - text: Cadastro gratuito
                - listitem [ref=e1325]:
                  - img [ref=e1326]
                  - text: Sem taxa de serviço
                - listitem [ref=e1329]:
                  - img [ref=e1330]
                  - text: Orçamento sem compromisso
            - generic [ref=e1333]:
              - button "Cadastrar grátis" [ref=e1338]:
                - text: Cadastrar grátis
                - generic [ref=e1339]:
                  - img
              - button "Sou prestador" [ref=e1341]:
                - img
                - text: Sou prestador
            - generic [ref=e1342]:
              - img [ref=e1343]
              - text: Comece em 30 segundos
            - button "Já tenho conta · Entrar" [ref=e1347]:
              - img [ref=e1348]
              - text: Já tenho conta · Entrar
            - generic [ref=e1351]:
              - generic [ref=e1352]:
                - generic [ref=e1353]: AL
                - generic [ref=e1354]: RM
                - generic [ref=e1355]: JS
                - generic [ref=e1356]: PF
                - generic [ref=e1357]: CM
                - generic [ref=e1358]: "+5"
              - generic [ref=e1359]:
                - paragraph [ref=e1360]: 527+ cadastrados
                - paragraph [ref=e1361]: na plataforma
          - generic [ref=e1362]:
            - generic [ref=e1363]:
              - heading "O que vem depois?" [level=3] [ref=e1364]
              - paragraph [ref=e1365]: Três passos simples e você estará agendando
              - generic [ref=e1366]:
                - img [ref=e1367]
                - generic [ref=e1368]:
                  - generic [ref=e1369]:
                    - generic [ref=e1371]: "1"
                    - generic [ref=e1372]:
                      - paragraph [ref=e1373]: Cadastre-se grátis
                      - paragraph [ref=e1374]: ~30s
                  - generic [ref=e1375]:
                    - generic [ref=e1377]: "2"
                    - generic [ref=e1378]:
                      - paragraph [ref=e1379]: Busque e compare
                      - paragraph [ref=e1380]: ~2 min
                  - generic [ref=e1381]:
                    - generic [ref=e1383]: "3"
                    - generic [ref=e1384]:
                      - paragraph [ref=e1385]: Agende com confiança
                      - paragraph [ref=e1386]: ~5 min
              - generic [ref=e1387]:
                - generic [ref=e1388]:
                  - img [ref=e1389]
                  - text: Sem compromisso
                - generic [ref=e1393]:
                  - img [ref=e1394]
                  - text: Cancele quando quiser
                - generic [ref=e1397]:
                  - img [ref=e1398]
                  - text: Suporte 24h
              - link "Saiba mais sobre pagamento protegido" [ref=e1401] [cursor=pointer]:
                - /url: "#faq"
                - img [ref=e1402]
                - text: Saiba mais sobre pagamento protegido
            - generic [ref=e1406]:
              - generic [ref=e1410]: Cliente
              - generic [ref=e1411]:
                - img [ref=e1415]
                - generic [ref=e1417]: Prestador
              - img [ref=e1422]
              - img [ref=e1424]
              - img [ref=e1428]
              - img [ref=e1431]
              - img [ref=e1435]
        - generic [ref=e1439]:
          - img [ref=e1440]
          - generic [ref=e1443]:
            - paragraph [ref=e1444]: “Encontrei um encanador em 10 minutos, paguei menos do que esperava e ainda pude avaliar o serviço. Recomendo demais!”
            - paragraph [ref=e1445]: — Ana P., Cliente, São Paulo
        - generic [ref=e1446]:
          - generic [ref=e1447]:
            - img [ref=e1448]
            - text: Sem compromisso
          - generic [ref=e1452]:
            - img [ref=e1453]
            - text: Cancele quando quiser
          - generic [ref=e1456]:
            - img [ref=e1457]
            - text: Pagamento protegido
    - contentinfo [ref=e1459]:
      - generic [ref=e1461]:
        - generic [ref=e1462]:
          - paragraph [ref=e1463]: Receba novidades e dicas de serviços
          - paragraph [ref=e1464]: Cadastre-se e receba ofertas exclusivas. Cancele quando quiser.
        - generic [ref=e1465]:
          - generic [ref=e1466]:
            - img [ref=e1467]
            - textbox "E-mail para newsletter" [ref=e1470]:
              - /placeholder: Seu e-mail
          - button "Assinar" [disabled]:
            - img
            - text: Assinar
      - generic [ref=e1471]:
        - generic [ref=e1472]:
          - generic [ref=e1473]:
            - generic [ref=e1474]:
              - img [ref=e1476]
              - generic [ref=e1479]: Severinno
            - paragraph [ref=e1480]: Marketplace de serviços com geolocalização. Encontre prestadores verificados, próximos e bem avaliados.
            - list "Redes sociais" [ref=e1481]:
              - listitem [ref=e1482]:
                - link "GitHub" [ref=e1483] [cursor=pointer]:
                  - /url: https://github.com
                  - img [ref=e1484]
              - listitem [ref=e1487]:
                - link "Twitter" [ref=e1488] [cursor=pointer]:
                  - /url: https://twitter.com
                  - img [ref=e1489]
              - listitem [ref=e1491]:
                - link "Instagram" [ref=e1492] [cursor=pointer]:
                  - /url: https://instagram.com
                  - img [ref=e1493]
              - listitem [ref=e1496]:
                - link "LinkedIn" [ref=e1497] [cursor=pointer]:
                  - /url: https://linkedin.com
                  - img [ref=e1498]
              - listitem [ref=e1502]:
                - link "E-mail" [ref=e1503] [cursor=pointer]:
                  - /url: mailto:contato@severinno.com
                  - img [ref=e1504]
          - navigation "Sobre" [ref=e1507]:
            - heading "Sobre" [level=3] [ref=e1508]:
              - img [ref=e1509]
              - text: Sobre
            - list [ref=e1512]:
              - listitem [ref=e1513]:
                - button "Como funciona" [ref=e1514]
              - listitem [ref=e1515]:
                - button "Quem somos" [ref=e1516]
              - listitem [ref=e1517]:
                - button "Termos de uso" [ref=e1518]
              - listitem [ref=e1519]:
                - button "Privacidade" [ref=e1520]
          - navigation "Para profissionais" [ref=e1521]:
            - heading "Para profissionais" [level=3] [ref=e1522]:
              - img [ref=e1523]
              - text: Para profissionais
            - list [ref=e1526]:
              - listitem [ref=e1527]:
                - button "Cadastre-se" [ref=e1528]
              - listitem [ref=e1529]:
                - button "Meu painel" [ref=e1530]
              - listitem [ref=e1531]:
                - button "Central de ajuda" [ref=e1532]
          - navigation "Precisa de ajuda?" [ref=e1533]:
            - heading "Precisa de ajuda?" [level=3] [ref=e1534]:
              - img [ref=e1535]
              - text: Precisa de ajuda?
            - list [ref=e1537]:
              - listitem [ref=e1538]:
                - button "Perguntas frequentes" [ref=e1539]
              - listitem [ref=e1540]:
                - button "Segurança" [ref=e1541]
              - listitem [ref=e1542]:
                - button "Reportar problema" [ref=e1543]
          - generic [ref=e1544]:
            - heading "Contato" [level=3] [ref=e1545]:
              - img [ref=e1546]
              - text: Contato
            - list [ref=e1551]:
              - listitem [ref=e1552]:
                - img [ref=e1553]
                - link "contato@severinno.com" [ref=e1556] [cursor=pointer]:
                  - /url: mailto:contato@severinno.com
              - listitem [ref=e1557]:
                - img [ref=e1558]
                - text: São Paulo, Brasil
            - button "Fale conosco" [ref=e1561]:
              - img
              - text: Fale conosco
        - generic [ref=e1562]:
          - paragraph [ref=e1563]: © 2026 Severinno Marketplace. Todos os direitos reservados.
          - paragraph [ref=e1564]:
            - text: Feito com
            - img [ref=e1565]
            - text: usando tecnologia Open Source (
            - link "MapLibre" [ref=e1567] [cursor=pointer]:
              - /url: https://maplibre.org/
            - text: ·
            - link "OpenStreetMap" [ref=e1568] [cursor=pointer]:
              - /url: https://www.openstreetmap.org/copyright
            - text: )
      - button "Voltar ao topo" [ref=e1569]:
        - img [ref=e1570]
    - button "Voltar ao topo" [ref=e1573]:
      - img
    - button "Abrir assistente virtual" [ref=e1574]:
      - img [ref=e1575]
    - generic [ref=e1579]:
      - generic [ref=e1580]:
        - img [ref=e1582]
        - generic [ref=e1584]:
          - paragraph [ref=e1585]: Usamos cookies para melhorar sua experiência
          - paragraph [ref=e1586]:
            - text: Utilizamos cookies essenciais para o funcionamento do site e cookies de análise para melhorar nossos serviços.
            - button "Política de privacidade" [ref=e1587]
      - generic [ref=e1588]:
        - button "Recusar" [ref=e1589]
        - button "Aceitar" [ref=e1590]:
          - img
          - text: Aceitar
        - button "Dispensar" [ref=e1591]:
          - img [ref=e1592]
  - region "Notifications alt+T"
  - generic [active]:
    - generic [ref=e1597]:
      - generic [ref=e1598]:
        - generic [ref=e1599]:
          - navigation [ref=e1600]:
            - button "previous" [disabled] [ref=e1601]:
              - img "previous" [ref=e1602]
            - generic [ref=e1604]:
              - generic [ref=e1605]: 1/
              - text: "1"
            - button "next" [disabled] [ref=e1606]:
              - img "next" [ref=e1607]
          - img
        - generic [ref=e1609]:
          - link "Next.js 16.1.3 (stale) Turbopack" [ref=e1610] [cursor=pointer]:
            - /url: https://nextjs.org/docs/messages/version-staleness
            - img [ref=e1611]
            - generic "There is a newer version (16.2.11) available, upgrade recommended!" [ref=e1613]: Next.js 16.1.3 (stale)
            - generic [ref=e1614]: Turbopack
          - img
      - dialog "Build Error" [ref=e1616]:
        - generic [ref=e1619]:
          - generic [ref=e1620]:
            - generic [ref=e1621]:
              - generic [ref=e1623]: Build Error
              - generic [ref=e1624]:
                - button "Copy Error Info" [ref=e1625] [cursor=pointer]:
                  - img [ref=e1626]
                - button "No related documentation found" [disabled] [ref=e1628]:
                  - img [ref=e1629]
                - button "Attach Node.js inspector" [ref=e1631] [cursor=pointer]:
                  - img [ref=e1632]
            - generic [ref=e1641]: Reading source code for parsing failed
          - generic [ref=e1643]:
            - generic [ref=e1645]:
              - img [ref=e1647]
              - generic [ref=e1651]: ./.freebuff/worktrees/thmrzp9vv9y86o/src/lib/api-server.ts
              - button "Open in editor" [ref=e1652] [cursor=pointer]:
                - img [ref=e1654]
            - generic [ref=e1658]: "Reading source code for parsing failed An unexpected error happened while trying to read the source code to parse: failed to convert rope into string Caused by: - invalid utf-8 sequence of 1 bytes from index 5415 Import trace: App Route: ./.freebuff/worktrees/thmrzp9vv9y86o/src/lib/api-server.ts ./.freebuff/worktrees/thmrzp9vv9y86o/src/app/api/auth/me/route.ts"
        - generic [ref=e1659]: "1"
        - generic [ref=e1660]: "2"
    - generic [ref=e1665] [cursor=pointer]:
      - button "Open Next.js Dev Tools" [ref=e1666]:
        - img [ref=e1667]
      - button "Open issues overlay" [ref=e1671]:
        - generic [ref=e1672]:
          - generic [ref=e1673]: "0"
          - generic [ref=e1674]: "1"
        - generic [ref=e1675]: Issue
  - alert [ref=e1676]
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