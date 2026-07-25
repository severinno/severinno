# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: quote-response.spec.ts >> Quote Response — Cliente aprova orcamento respondido >> 6. cliente ve acoes disponiveis no card do orcamento
- Location: e2e\quote-response.spec.ts:320:7

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.click: Test timeout of 30000ms exceeded.
Call log:
  - waiting for getByRole('button', { name: /criar conta|cadastrar/i }).first()
    - locator resolved to <button data-slot="button" class="inline-flex items-center justify-center gap-2 whitespace-nowrap transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive has-[>svg]:px-4 h-11 rounded-xl bg-white px-6 text-base fon…>…</button>
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
    2 × waiting for element to be visible, enabled and stable
      - element is not stable
    - retrying click action
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
      - <nextjs-portal></nextjs-portal> from <script data-nextjs-dev-overlay="true">…</script> subtree intercepts pointer events
    - retrying click action
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
          - textbox "Buscar prestadores" [ref=e25]:
            - /placeholder: Buscar serviço ou prestador…
          - generic: ⌘K
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
        - generic [ref=e119]: Atividade ao vivo
      - region "Atividade recente na plataforma" [ref=e147]:
        - generic [ref=e148]:
          - generic [ref=e150]: Atividade recente
          - generic [ref=e154]:
            - generic [ref=e156]:
              - generic [ref=e157]:
                - generic [ref=e158]: ⚡
                - text: Maria contratou um eletricista em São Paulo
              - generic [ref=e160]:
                - generic [ref=e161]: ⭐
                - text: João avaliou ★★★★★ o prestador Ricardo
              - generic [ref=e163]:
                - generic [ref=e164]: 🎨
                - text: "Nova avaliação: 4.9 para Serviços de Pintura"
              - generic [ref=e166]:
                - generic [ref=e167]: 🔧
                - text: Ana pediu orçamento para encanador
              - generic [ref=e169]:
                - generic [ref=e170]: ✅
                - text: Pedro se cadastrou como prestador verificado
              - generic [ref=e172]:
                - generic [ref=e173]: 📋
                - text: 12 orçamentos enviados hoje
              - generic [ref=e175]:
                - generic [ref=e176]: ⚡
                - text: Maria contratou um eletricista em São Paulo
              - generic [ref=e178]:
                - generic [ref=e179]: ⭐
                - text: João avaliou ★★★★★ o prestador Ricardo
              - generic [ref=e181]:
                - generic [ref=e182]: 🎨
                - text: "Nova avaliação: 4.9 para Serviços de Pintura"
              - generic [ref=e184]:
                - generic [ref=e185]: 🔧
                - text: Ana pediu orçamento para encanador
              - generic [ref=e187]:
                - generic [ref=e188]: ✅
                - text: Pedro se cadastrou como prestador verificado
              - generic [ref=e190]:
                - generic [ref=e191]: 📋
                - text: 12 orçamentos enviados hoje
            - generic [ref=e195]:
              - generic [ref=e196]:
                - generic [ref=e197]: 🧹
                - text: Carlos agendou limpeza de quintal em Belo Horizonte
              - generic [ref=e199]:
                - generic [ref=e200]: ⭐
                - text: Fernanda avaliou ★★★★★ o prestador José
              - generic [ref=e202]:
                - generic [ref=e203]: 🛡️
                - text: 8 novos prestadores verificados esta semana
              - generic [ref=e205]:
                - generic [ref=e206]: 🎨
                - text: Luciana contratou um pintor no Rio de Janeiro
              - generic [ref=e208]:
                - generic [ref=e209]: 🚿
                - text: "Orçamento aceito: reforma de banheiro em Curitiba"
              - generic [ref=e211]:
                - generic [ref=e212]: 🏆
                - text: 5.200 serviços concluídos este mês
              - generic [ref=e214]:
                - generic [ref=e215]: 🧹
                - text: Carlos agendou limpeza de quintal em Belo Horizonte
              - generic [ref=e217]:
                - generic [ref=e218]: ⭐
                - text: Fernanda avaliou ★★★★★ o prestador José
              - generic [ref=e220]:
                - generic [ref=e221]: 🛡️
                - text: 8 novos prestadores verificados esta semana
              - generic [ref=e223]:
                - generic [ref=e224]: 🎨
                - text: Luciana contratou um pintor no Rio de Janeiro
              - generic [ref=e226]:
                - generic [ref=e227]: 🚿
                - text: "Orçamento aceito: reforma de banheiro em Curitiba"
              - generic [ref=e229]:
                - generic [ref=e230]: 🏆
                - text: 5.200 serviços concluídos este mês
      - region "Categorias de serviços" [ref=e232]:
        - generic [ref=e233]:
          - generic:
            - img
          - generic [ref=e235]:
            - generic [ref=e236]:
              - img [ref=e237]
              - text: Explore categorias
            - heading "Encontre o serviço ideal" [level=2] [ref=e240]
            - paragraph [ref=e241]: Serviços verificados perto de você — … carregando categorias
          - generic "Carregando categorias" [ref=e242]
      - region "Resultados da busca" [ref=e283]:
        - generic [ref=e284]:
          - complementary [ref=e285]:
            - generic [ref=e287]:
              - generic [ref=e288]:
                - heading "Filtros" [level=2] [ref=e289]:
                  - img [ref=e290]
                  - text: Filtros
                - button "Limpar filtros" [ref=e291]
              - generic [ref=e292]:
                - generic [ref=e293]: Buscar
                - generic [ref=e294]:
                  - img [ref=e295]
                  - textbox "Buscar" [ref=e298]:
                    - /placeholder: Serviço, prestador…
              - generic [ref=e299]:
                - generic [ref=e300]:
                  - generic [ref=e301]: Raio de busca
                  - generic [ref=e302]: 15 km
                - generic "Raio de busca em quilômetros" [ref=e303]:
                  - slider [ref=e307]
                - generic [ref=e308]:
                  - generic [ref=e309]: 1 km
                  - generic [ref=e310]: 50 km
              - generic [ref=e311]:
                - generic [ref=e312]: Categoria
                - combobox [ref=e313]:
                  - generic: Todas as categorias
                  - img
              - generic [ref=e314]:
                - generic [ref=e315]: Ordenar por
                - radiogroup "Ordenar por" [ref=e316]:
                  - radio "Melhor avaliação" [checked] [ref=e317]
                  - radio "Mais próximos" [ref=e318]
              - generic [ref=e319]:
                - generic [ref=e320]: Avaliação mínima
                - radiogroup [ref=e321]:
                  - generic [ref=e322] [cursor=pointer]:
                    - radio "Todas" [checked] [ref=e323]:
                      - img [ref=e324]
                    - generic [ref=e326]: Todas
                  - generic [ref=e327] [cursor=pointer]:
                    - radio "3+" [ref=e328]
                    - generic [ref=e329]: 3+
                  - generic [ref=e330] [cursor=pointer]:
                    - radio "4+" [ref=e331]
                    - generic [ref=e332]: 4+
                  - generic [ref=e333] [cursor=pointer]:
                    - radio "5" [ref=e334]
                    - generic [ref=e335]: "5"
              - generic [ref=e336] [cursor=pointer]:
                - generic [ref=e337]:
                  - img [ref=e338]
                  - generic [ref=e340]: Somente verificados
                - switch "Somente verificados" [ref=e341]
              - button "Ver 3 resultados" [disabled]
          - generic [ref=e342]:
            - generic [ref=e344]:
              - generic [ref=e345]:
                - heading "3 prestadores encontrados" [level=2] [ref=e346]
                - paragraph [ref=e347]: Exibindo 1–3 de 3
              - generic [ref=e348]:
                - generic [ref=e349]:
                  - text: "Ordenado por:"
                  - generic [ref=e350]: Melhor avaliação
                - tablist "Visualização" [ref=e351]:
                  - tab "Lista" [selected] [ref=e352]:
                    - img [ref=e353]
                    - generic [ref=e354]: Lista
                  - tab "Mapa" [ref=e355]:
                    - img [ref=e356]
                    - generic [ref=e358]: Mapa
            - generic [ref=e360]:
              - generic [ref=e362]:
                - generic [ref=e363]:
                  - img "Capa de Maria Silva" [ref=e364]
                  - generic [ref=e366]:
                    - img [ref=e367]
                    - text: Verificado
                  - generic [ref=e370]:
                    - button "Adicionar Maria Silva à comparação" [ref=e371]:
                      - img [ref=e372]
                    - button "Adicionar Maria Silva aos favoritos" [ref=e377]:
                      - img [ref=e378]
                  - img "Maria Silva" [ref=e382]
                - generic [ref=e383]:
                  - generic [ref=e384]:
                    - button "Ver perfil de Maria Silva" [ref=e385]:
                      - heading "Maria Silva" [level=3] [ref=e386]:
                        - generic [ref=e387]: Maria Silva
                        - img [ref=e388]
                    - generic "Avaliação média" [ref=e390]:
                      - img [ref=e391]
                      - text: "4.8"
                      - generic [ref=e393]: (42)
                  - paragraph [ref=e394]: a partir de R$ 120,00
                  - generic [ref=e395]:
                    - generic [ref=e396]:
                      - img [ref=e397]
                      - text: 2,5 km
                    - generic [ref=e400]:
                      - img [ref=e401]
                      - text: São Paulo
                  - paragraph [ref=e404]: Especialista em instalações elétricas residenciais com mais de 10 anos de experiência.
                  - generic [ref=e405]:
                    - generic "Serviços concluídos com sucesso" [ref=e406]:
                      - img [ref=e407]
                      - text: 230 serviços concluídos
                    - generic "Na plataforma desde" [ref=e410]:
                      - img [ref=e411]
                      - text: desde jan. de 2023
                - generic [ref=e415]:
                  - generic [ref=e416]:
                    - img [ref=e417]
                    - generic [ref=e419]: Instalação Elétrica · a partir de R$ 120,00
                  - heading "Elétrica 1 serviço" [level=3] [ref=e422]:
                    - button "Elétrica 1 serviço" [ref=e423]:
                      - generic [ref=e425]:
                        - paragraph [ref=e426]: Elétrica
                        - paragraph [ref=e427]: 1 serviço
                      - img
                - generic [ref=e428]:
                  - button "Orçamento" [ref=e429]:
                    - img
                    - text: Orçamento
                  - button "Agendar" [ref=e430]:
                    - img
                    - text: Agendar
              - generic [ref=e432]:
                - generic [ref=e433]:
                  - img "Capa de João Pedreiro" [ref=e434]
                  - generic [ref=e436]:
                    - img [ref=e437]
                    - text: Verificado
                  - generic [ref=e440]:
                    - button "Adicionar João Pedreiro à comparação" [ref=e441]:
                      - img [ref=e442]
                    - button "Adicionar João Pedreiro aos favoritos" [ref=e447]:
                      - img [ref=e448]
                  - img "João Pedreiro" [ref=e452]
                - generic [ref=e453]:
                  - generic [ref=e454]:
                    - button "Ver perfil de João Pedreiro" [ref=e455]:
                      - heading "João Pedreiro" [level=3] [ref=e456]:
                        - generic [ref=e457]: João Pedreiro
                        - img [ref=e458]
                    - generic "Avaliação média" [ref=e460]:
                      - img [ref=e461]
                      - text: "4.8"
                      - generic [ref=e463]: (42)
                  - paragraph [ref=e464]: a partir de R$ 120,00
                  - generic [ref=e465]:
                    - generic [ref=e466]:
                      - img [ref=e467]
                      - text: 2,5 km
                    - generic [ref=e470]:
                      - img [ref=e471]
                      - text: São Paulo
                  - paragraph [ref=e474]: Especialista em instalações elétricas residenciais com mais de 10 anos de experiência.
                  - generic [ref=e475]:
                    - generic "Serviços concluídos com sucesso" [ref=e476]:
                      - img [ref=e477]
                      - text: 230 serviços concluídos
                    - generic "Na plataforma desde" [ref=e480]:
                      - img [ref=e481]
                      - text: desde jan. de 2023
                - generic [ref=e485]:
                  - generic [ref=e486]:
                    - img [ref=e487]
                    - generic [ref=e489]: Instalação Elétrica · a partir de R$ 120,00
                  - heading "Construção 1 serviço" [level=3] [ref=e492]:
                    - button "Construção 1 serviço" [ref=e493]:
                      - generic [ref=e495]:
                        - paragraph [ref=e496]: Construção
                        - paragraph [ref=e497]: 1 serviço
                      - img
                - generic [ref=e498]:
                  - button "Orçamento" [ref=e499]:
                    - img
                    - text: Orçamento
                  - button "Agendar" [ref=e500]:
                    - img
                    - text: Agendar
              - generic [ref=e502]:
                - generic [ref=e503]:
                  - img "Capa de Ana Pintora" [ref=e504]
                  - generic [ref=e506]:
                    - img [ref=e507]
                    - text: Verificado
                  - generic [ref=e510]:
                    - button "Adicionar Ana Pintora à comparação" [ref=e511]:
                      - img [ref=e512]
                    - button "Adicionar Ana Pintora aos favoritos" [ref=e517]:
                      - img [ref=e518]
                  - img "Ana Pintora" [ref=e522]
                - generic [ref=e523]:
                  - generic [ref=e524]:
                    - button "Ver perfil de Ana Pintora" [ref=e525]:
                      - heading "Ana Pintora" [level=3] [ref=e526]:
                        - generic [ref=e527]: Ana Pintora
                        - img [ref=e528]
                    - generic "Avaliação média" [ref=e530]:
                      - img [ref=e531]
                      - text: "4.8"
                      - generic [ref=e533]: (42)
                  - paragraph [ref=e534]: a partir de R$ 120,00
                  - generic [ref=e535]:
                    - generic [ref=e536]:
                      - img [ref=e537]
                      - text: 2,5 km
                    - generic [ref=e540]:
                      - img [ref=e541]
                      - text: São Paulo
                  - paragraph [ref=e544]: Especialista em instalações elétricas residenciais com mais de 10 anos de experiência.
                  - generic [ref=e545]:
                    - generic "Serviços concluídos com sucesso" [ref=e546]:
                      - img [ref=e547]
                      - text: 230 serviços concluídos
                    - generic "Na plataforma desde" [ref=e550]:
                      - img [ref=e551]
                      - text: desde jan. de 2023
                - generic [ref=e555]:
                  - generic [ref=e556]:
                    - img [ref=e557]
                    - generic [ref=e559]: Instalação Elétrica · a partir de R$ 120,00
                  - heading "Pintura 1 serviço" [level=3] [ref=e562]:
                    - button "Pintura 1 serviço" [ref=e563]:
                      - generic [ref=e565]:
                        - paragraph [ref=e566]: Pintura
                        - paragraph [ref=e567]: 1 serviço
                      - img
                - generic [ref=e568]:
                  - button "Orçamento" [ref=e569]:
                    - img
                    - text: Orçamento
                  - button "Agendar" [ref=e570]:
                    - img
                    - text: Agendar
      - region "Como funciona" [ref=e571]:
        - generic [ref=e576]:
          - generic [ref=e577]:
            - link "Pular para resultados" [ref=e578] [cursor=pointer]:
              - /url: "#vitrine-resultados"
              - img [ref=e579]
              - text: Pular para resultados
            - generic [ref=e583]:
              - img [ref=e584]
              - generic [ref=e586]: "4"
              - text: passos simples
            - heading "Como funciona" [level=2] [ref=e587]
            - paragraph [ref=e588]: Sem surpresas — do início ao fim, você tem o controle.
            - generic [ref=e589]:
              - img [ref=e590]
              - text: Sem compromisso
          - generic [ref=e596]:
            - img [ref=e598]
            - generic [ref=e599]:
              - 'button "1 Busque o serviço Encontre prestadores verificados perto de você. 50 + categorias encanador em São Paulo | Verificados < 5 km Mais filtros Ex: Busque ''encanador em São Paulo'' Buscar prestadores" [ref=e600] [cursor=pointer]':
                - generic [ref=e602]:
                  - generic [ref=e604]: "1"
                  - img [ref=e607]
                  - heading "Busque o serviço" [level=3] [ref=e610]
                  - paragraph [ref=e611]: Encontre prestadores verificados perto de você.
                  - generic [ref=e613]:
                    - generic [ref=e614]: "50"
                    - text: +
                    - generic [ref=e615]: categorias
                  - generic [ref=e617]:
                    - generic [ref=e618]:
                      - img [ref=e619]
                      - generic [ref=e622]: encanador em São Paulo
                      - generic [ref=e623]: "|"
                    - generic [ref=e624]:
                      - generic [ref=e625]: Verificados
                      - generic [ref=e626]: < 5 km
                      - generic [ref=e627]:
                        - img [ref=e628]
                        - text: Mais filtros
                  - paragraph [ref=e630]: "Ex: Busque 'encanador em São Paulo'"
                  - button "Buscar prestadores" [ref=e631]:
                    - text: Buscar prestadores
                    - img
              - 'button "2 Compare orçamentos Receba e compare propostas lado a lado. 3 orçamentos em 24h João S. R$ 180 Maria L. R$ 150 Melhor avaliação Compare lado a lado Ex: Compare 3 orçamentos em 24h Sem compromisso Pedir orçamento" [ref=e632] [cursor=pointer]':
                - generic [ref=e634]:
                  - generic [ref=e636]: "2"
                  - img [ref=e639]
                  - heading "Compare orçamentos" [level=3] [ref=e644]
                  - paragraph [ref=e645]: Receba e compare propostas lado a lado.
                  - generic [ref=e647]:
                    - generic [ref=e648]: "3"
                    - generic [ref=e649]: orçamentos em 24h
                  - generic [ref=e651]:
                    - generic [ref=e652]:
                      - generic [ref=e653]:
                        - generic [ref=e656]: João S.
                        - generic [ref=e657]:
                          - img [ref=e658]
                          - img [ref=e660]
                          - img [ref=e662]
                          - img [ref=e664]
                          - img [ref=e666]
                        - generic [ref=e668]: R$ 180
                      - generic [ref=e669]:
                        - generic [ref=e672]: Maria L.
                        - generic [ref=e673]:
                          - img [ref=e674]
                          - img [ref=e676]
                          - img [ref=e678]
                          - img [ref=e680]
                          - img [ref=e682]
                        - generic [ref=e684]: R$ 150
                        - generic [ref=e685]: Melhor avaliação
                    - generic [ref=e686]:
                      - img [ref=e687]
                      - text: Compare lado a lado
                  - paragraph [ref=e692]: "Ex: Compare 3 orçamentos em 24h"
                  - generic [ref=e693]:
                    - img [ref=e694]
                    - text: Sem compromisso
                  - button "Pedir orçamento" [ref=e699]:
                    - text: Pedir orçamento
                    - img
              - 'button "3 Agende com confiança Solicite um orçamento ou agende diretamente. 24 h para confirmar Março 2025 S T Q Q S S D 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 12 Mar, 14:00 — Confirmado Ex: Agende para amanhã às 14h Agendar agora" [ref=e700] [cursor=pointer]':
                - generic [ref=e702]:
                  - generic [ref=e704]: "3"
                  - img [ref=e707]
                  - heading "Agende com confiança" [level=3] [ref=e710]
                  - paragraph [ref=e711]: Solicite um orçamento ou agende diretamente.
                  - generic [ref=e713]:
                    - generic [ref=e714]: "24"
                    - text: h
                    - generic [ref=e715]: para confirmar
                  - generic [ref=e718]:
                    - generic [ref=e719]: Março 2025
                    - generic [ref=e720]:
                      - generic [ref=e721]: S
                      - generic [ref=e722]: T
                      - generic [ref=e723]: Q
                      - generic [ref=e724]: Q
                      - generic [ref=e725]: S
                      - generic [ref=e726]: S
                      - generic [ref=e727]: D
                      - generic [ref=e728]: "1"
                      - generic [ref=e729]: "2"
                      - generic [ref=e730]: "3"
                      - generic [ref=e731]: "4"
                      - generic [ref=e732]: "5"
                      - generic [ref=e733]: "6"
                      - generic [ref=e734]: "7"
                      - generic [ref=e735]: "8"
                      - generic [ref=e736]: "9"
                      - generic [ref=e737]: "10"
                      - generic [ref=e738]: "11"
                      - generic [ref=e739]: "12"
                      - generic [ref=e740]: "13"
                      - generic [ref=e741]: "14"
                      - generic [ref=e742]: "15"
                    - generic [ref=e743]:
                      - img [ref=e744]
                      - generic [ref=e747]: 12 Mar, 14:00 — Confirmado
                  - paragraph [ref=e748]: "Ex: Agende para amanhã às 14h"
                  - button "Agendar agora" [ref=e749]:
                    - text: Agendar agora
                    - img
              - 'button "4 Avalie o resultado Sua opinião mantém a qualidade da comunidade. 98 % satisfação 4.0 \"Excelente trabalho, recomendo!\" Avaliação verificada Ex: Avalie de 1 a 5 estrelas com comentário Cadastrar grátis" [ref=e750] [cursor=pointer]':
                - generic [ref=e752]:
                  - generic [ref=e754]: "4"
                  - img [ref=e757]
                  - heading "Avalie o resultado" [level=3] [ref=e759]
                  - paragraph [ref=e760]: Sua opinião mantém a qualidade da comunidade.
                  - generic [ref=e762]:
                    - generic [ref=e763]: "98"
                    - text: "%"
                    - generic [ref=e764]: satisfação
                  - generic [ref=e766]:
                    - generic [ref=e767]:
                      - generic [ref=e768]:
                        - img [ref=e769]
                        - img [ref=e771]
                        - img [ref=e773]
                        - img [ref=e775]
                        - img [ref=e777]
                        - generic [ref=e779]: "4.0"
                      - paragraph [ref=e782]: "\"Excelente trabalho, recomendo!\""
                    - generic [ref=e783]:
                      - img [ref=e784]
                      - text: Avaliação verificada
                  - paragraph [ref=e787]: "Ex: Avalie de 1 a 5 estrelas com comentário"
                  - button "Cadastrar grátis" [ref=e788]:
                    - text: Cadastrar grátis
                    - img
          - generic [ref=e789]:
            - generic [ref=e790]:
              - img [ref=e791]
              - generic [ref=e794]: Garantia Severinno
            - generic [ref=e795]:
              - generic [ref=e796]:
                - img [ref=e797]
                - generic [ref=e800]: Prestadores verificados
              - generic [ref=e801]:
                - img [ref=e802]
                - generic [ref=e805]: Resposta rápida
              - generic [ref=e806]:
                - img [ref=e807]
                - generic [ref=e809]: Satisfação garantida
              - generic [ref=e810]:
                - img [ref=e811]
                - generic [ref=e816]: Compare antes de contratar
          - generic [ref=e817]:
            - button "Começar agora" [ref=e818]:
              - text: Começar agora
              - img
            - link "Buscar prestadores" [ref=e819] [cursor=pointer]:
              - /url: "#vitrine-resultados"
              - img
              - text: Buscar prestadores
          - button "Voltar ao topo" [ref=e821]:
            - img [ref=e822]
            - text: Voltar ao topo
      - generic [ref=e825]:
        - generic [ref=e826]:
          - generic [ref=e827]:
            - img
            - text: Simulador de preços
          - heading "Quanto custa? Simule agora" [level=2] [ref=e828]
          - paragraph [ref=e829]: Estime o valor do serviço em 3 passos rápidos. Sem compromisso, sem cadastro.
        - generic [ref=e830]:
          - generic [ref=e831]: "1"
          - generic [ref=e833]: "2"
          - generic [ref=e835]: "3"
        - generic [ref=e838]:
          - heading "1. Qual serviço você precisa?" [level=3] [ref=e839]
          - paragraph [ref=e840]: Selecione a categoria do serviço
          - generic [ref=e841]:
            - button "Elétrica" [ref=e842]:
              - img [ref=e844]
              - generic [ref=e846]: Elétrica
            - button "Hidráulica" [ref=e847]:
              - img [ref=e849]
              - generic [ref=e852]: Hidráulica
            - button "Pintura" [ref=e853]:
              - img [ref=e855]
              - generic [ref=e859]: Pintura
            - button "Alvenaria" [ref=e860]:
              - img [ref=e862]
              - generic [ref=e864]: Alvenaria
            - button "Pisos" [ref=e865]:
              - img [ref=e867]
              - generic [ref=e869]: Pisos
            - button "Pós-obra" [ref=e870]:
              - img [ref=e872]
              - generic [ref=e877]: Pós-obra
            - button "Residencial" [ref=e878]:
              - img [ref=e880]
              - generic [ref=e883]: Residencial
      - region "Parceiros e imprensa" [ref=e884]:
        - generic [ref=e885]:
          - paragraph [ref=e887]: Referência no mercado
          - generic [ref=e889]:
            - generic [ref=e892]: G1
            - generic [ref=e895]: Folha de S.Paulo
            - generic [ref=e898]: Valor Econômico
            - generic [ref=e901]: Exame
            - generic [ref=e904]: InfoMoney
            - generic [ref=e907]: Startups
            - generic [ref=e910]: Sebrae
            - generic [ref=e913]: ABES
          - paragraph [ref=e914]: + de 6.000 prestadores confiam no Severinno
      - region "Avaliações de clientes" [ref=e915]:
        - generic:
          - generic:
            - img
        - generic [ref=e917]:
          - generic [ref=e918]:
            - img [ref=e919]
            - text: Avaliações reais
          - heading "O que nossos clientes dizem" [level=2] [ref=e921]
          - paragraph [ref=e922]: Avaliações de clientes após a conclusão do serviço.
      - generic [ref=e987]:
        - generic [ref=e990]:
          - generic [ref=e991]:
            - img [ref=e993]
            - paragraph [ref=e1000]: Prestadores verificados
          - generic [ref=e1001]:
            - img [ref=e1003]
            - paragraph [ref=e1007]: Serviços cadastrados
          - generic [ref=e1008]:
            - img [ref=e1010]
            - paragraph [ref=e1015]: Serviços concluídos
          - generic [ref=e1016]:
            - img [ref=e1018]
            - paragraph [ref=e1022]: Nota média
        - generic [ref=e1024]:
          - generic [ref=e1025]:
            - generic [ref=e1026]:
              - img [ref=e1027]
              - text: Por que Severinno?
            - heading "Confiança em cada agendamento" [level=2] [ref=e1030]
            - paragraph [ref=e1031]: Mais que um diretório de serviços — um ecossistema pensado para proteger você e o prestador. Da verificação ao pagamento, cada etapa foi desenhada para a sua tranquilidade.
            - link "Pular para FAQ" [ref=e1033] [cursor=pointer]:
              - /url: "#faq"
              - img [ref=e1034]
              - text: Pular para FAQ
          - generic [ref=e1037]:
            - generic [ref=e1040]:
              - generic [ref=e1041]:
                - img [ref=e1043]
                - button "Saiba mais sobre Prestadores verificados" [ref=e1046]:
                  - img [ref=e1047]
              - heading "Prestadores verificados" [level=3] [ref=e1050]
              - paragraph [ref=e1051]: João verificou 3 documentos antes de aprovar o prestador. Você só vê profissionais validados.
              - button "Saiba mais" [ref=e1052]:
                - text: Saiba mais
                - img [ref=e1053]
            - generic [ref=e1057]:
              - generic [ref=e1058]:
                - img [ref=e1060]
                - button "Saiba mais sobre Pagamento protegido" [ref=e1063]:
                  - img [ref=e1064]
              - heading "Pagamento protegido" [level=3] [ref=e1067]
              - paragraph [ref=e1068]: O valor só é liberado ao prestador após você confirmar que ficou satisfeito com o serviço.
              - button "Saiba mais" [ref=e1069]:
                - text: Saiba mais
                - img [ref=e1070]
            - generic [ref=e1074]:
              - generic [ref=e1075]:
                - img [ref=e1077]
                - button "Saiba mais sobre Resposta rápida" [ref=e1080]:
                  - img [ref=e1081]
              - heading "Resposta rápida" [level=3] [ref=e1084]
              - paragraph [ref=e1085]: Prestadores comprometidos a responder em até 24h. Acompanhe o status em tempo real.
              - button "Saiba mais" [ref=e1086]:
                - text: Saiba mais
                - img [ref=e1087]
            - generic [ref=e1091]:
              - generic [ref=e1092]:
                - img [ref=e1094]
                - button "Saiba mais sobre Avaliações reais" [ref=e1096]:
                  - img [ref=e1097]
              - heading "Avaliações reais" [level=3] [ref=e1100]
              - paragraph [ref=e1101]: Apenas clientes que concluíram o serviço podem avaliar. Sem falsas avaliações.
              - button "Saiba mais" [ref=e1102]:
                - text: Saiba mais
                - img [ref=e1103]
            - generic [ref=e1107]:
              - generic [ref=e1108]:
                - img [ref=e1110]
                - button "Saiba mais sobre Próximo de você" [ref=e1113]:
                  - img [ref=e1114]
              - heading "Próximo de você" [level=3] [ref=e1117]
              - paragraph [ref=e1118]: Geolocalização inteligente mostra os melhores prestadores na sua região.
              - button "Saiba mais" [ref=e1119]:
                - text: Saiba mais
                - img [ref=e1120]
            - generic [ref=e1124]:
              - generic [ref=e1125]:
                - img [ref=e1127]
                - button "Saiba mais sobre Suporte humano" [ref=e1129]:
                  - img [ref=e1130]
              - heading "Suporte humano" [level=3] [ref=e1133]
              - paragraph [ref=e1134]: Equipe disponível para mediar disputas, tirar dúvidas e garantir uma experiência justa.
              - button "Saiba mais" [ref=e1135]:
                - text: Saiba mais
                - img [ref=e1136]
        - generic [ref=e1139]:
          - img [ref=e1140]
          - paragraph [ref=e1142]: "Garantia Severinno: seu dinheiro de volta se o serviço não for bem-feito."
          - link "Saiba mais" [ref=e1143] [cursor=pointer]:
            - /url: "#faq"
            - text: Saiba mais
            - img [ref=e1144]
      - generic [ref=e1147]:
        - generic [ref=e1148]:
          - generic [ref=e1149]:
            - img [ref=e1150]
            - text: Destaque da semana
          - heading "Profissional em destaque" [level=2] [ref=e1156]
          - paragraph [ref=e1157]: Conheça um dos nossos prestadores mais bem avaliados.
        - generic [ref=e1161]:
          - generic [ref=e1162]:
            - generic [ref=e1163]:
              - img [ref=e1166]
              - img [ref=e1170]
              - generic [ref=e1174]:
                - img [ref=e1175]
                - text: Top
            - generic [ref=e1177]:
              - generic [ref=e1178]:
                - heading "Maria Silva" [level=3] [ref=e1179]
                - generic [ref=e1180]:
                  - generic [ref=e1181]:
                    - img [ref=e1182]
                    - text: São Paulo
                  - generic [ref=e1185]: 3 km
                  - generic [ref=e1186]:
                    - img [ref=e1187]
                    - text: Membro desde 2023
              - generic [ref=e1189]:
                - generic [ref=e1190]:
                  - img [ref=e1191]
                  - generic [ref=e1193]: "4.8"
                - generic [ref=e1194]: (42 avaliações)
              - generic [ref=e1195]:
                - generic [ref=e1196]:
                  - img
                  - text: 230 serviços concluídos
                - generic [ref=e1197]:
                  - img
                  - text: Responde em ~30min
              - generic [ref=e1198]:
                - paragraph [ref=e1199]: Serviços
                - generic [ref=e1201]:
                  - generic [ref=e1202]: Instalação Elétrica
                  - generic [ref=e1203]: R$ 120,00
              - paragraph [ref=e1205]: Especialista em instalações elétricas residenciais com mais de 10 anos de experiência.
              - generic [ref=e1206]:
                - generic [ref=e1207]:
                  - generic "Maria S." [ref=e1208]: M
                  - generic "João P." [ref=e1209]: J
                  - generic "Ana L." [ref=e1210]: A
                - generic [ref=e1211]: Clientes recentes
          - generic [ref=e1212]:
            - generic [ref=e1213]:
              - button "Pedir orçamento" [ref=e1214]:
                - img
                - text: Pedir orçamento
              - button "Ver perfil completo" [ref=e1215]:
                - text: Ver perfil completo
                - img
            - button "Enviar mensagem" [ref=e1217]:
              - img
              - text: Enviar mensagem
      - generic [ref=e1221]:
        - generic [ref=e1222]:
          - generic [ref=e1223]:
            - generic [ref=e1224]:
              - img [ref=e1225]
              - text: Perguntas frequentes
            - heading "Tire suas dúvidas antes de contratar" [level=2] [ref=e1228]
            - paragraph [ref=e1229]: Reunimos as perguntas mais comuns sobre como o Severinno funciona — do cadastro ao pagamento.
          - generic [ref=e1230]:
            - img [ref=e1231]
            - textbox "Buscar nas perguntas frequentes" [ref=e1234]:
              - /placeholder: Buscar nas dúvidas…
          - generic [ref=e1235]:
            - paragraph [ref=e1236]: Filtrar por categoria
            - generic [ref=e1237]:
              - button "Filtrar por Geral" [ref=e1238]:
                - img [ref=e1239]
                - text: Geral
                - generic [ref=e1242]: (2)
              - button "Filtrar por Pagamento" [ref=e1243]:
                - img [ref=e1244]
                - text: Pagamento
                - generic [ref=e1246]: (2)
              - button "Filtrar por Agendamento" [ref=e1247]:
                - img [ref=e1248]
                - text: Agendamento
                - generic [ref=e1250]: (2)
              - button "Filtrar por Prestadores" [ref=e1251]:
                - img [ref=e1252]
                - text: Prestadores
                - generic [ref=e1256]: (2)
              - button "Filtrar por Segurança" [ref=e1257]:
                - img [ref=e1258]
                - text: Segurança
                - generic [ref=e1261]: (2)
          - generic [ref=e1262]:
            - paragraph [ref=e1263]: Perguntas mais frequentes
            - list [ref=e1264]:
              - listitem [ref=e1265]:
                - button "Como funciona o Severinno?" [ref=e1266]:
                  - img [ref=e1267]
                  - generic [ref=e1269]: Como funciona o Severinno?
              - listitem [ref=e1270]:
                - button "Preciso pagar para me cadastrar?" [ref=e1271]:
                  - img [ref=e1272]
                  - generic [ref=e1274]: Preciso pagar para me cadastrar?
              - listitem [ref=e1275]:
                - button "Como faço para agendar um serviço?" [ref=e1276]:
                  - img [ref=e1277]
                  - generic [ref=e1279]: Como faço para agendar um serviço?
              - listitem [ref=e1280]:
                - button "E se o serviço não for bem-feito?" [ref=e1281]:
                  - img [ref=e1282]
                  - generic [ref=e1284]: E se o serviço não for bem-feito?
          - generic [ref=e1286]:
            - img [ref=e1288]
            - generic [ref=e1290]:
              - paragraph [ref=e1291]: Ainda tem dúvidas?
              - paragraph [ref=e1292]: Cadastre-se grátis e converse diretamente com prestadores verificados. Sem compromisso.
              - generic [ref=e1293]:
                - button "Cadastrar grátis" [ref=e1294]
                - link "Fale conosco" [ref=e1295] [cursor=pointer]:
                  - /url: "#faq"
                  - img
                  - text: Fale conosco
        - generic [ref=e1296]:
          - generic [ref=e1298]:
            - generic [ref=e1300]:
              - heading "01 Como funciona o Severinno? Geral" [level=3] [ref=e1301]:
                - button "01 Como funciona o Severinno? Geral" [expanded] [ref=e1302]:
                  - generic [ref=e1303]:
                    - generic [ref=e1304]: "01"
                    - generic [ref=e1305]: Como funciona o Severinno?
                    - generic [ref=e1306]:
                      - img
                      - text: Geral
                  - img
              - region "01 Como funciona o Severinno? Geral" [ref=e1307]:
                - generic [ref=e1309]:
                  - paragraph [ref=e1310]: O Severinno conecta você a prestadores de serviço verificados próximos à sua localização. Você busca o serviço, compara avaliações reais de outros clientes, pede orçamento grátis e agenda — tudo pela plataforma. O pagamento só é liberado após você confirmar a conclusão do serviço.
                  - paragraph [ref=e1311]: "Ex: Maria precisava de um eletricista. Buscou na plataforma, comparou 3 profissionais e contratou o mais bem avaliado — tudo em 5 minutos."
            - heading "02 Preciso pagar para me cadastrar? Geral" [level=3] [ref=e1314]:
              - button "02 Preciso pagar para me cadastrar? Geral" [ref=e1315]:
                - generic [ref=e1316]:
                  - generic [ref=e1317]: "02"
                  - generic [ref=e1318]: Preciso pagar para me cadastrar?
                  - generic [ref=e1319]:
                    - img
                    - text: Geral
                - img
            - heading "03 Como os prestadores são verificados? Prestadores" [level=3] [ref=e1322]:
              - button "03 Como os prestadores são verificados? Prestadores" [ref=e1323]:
                - generic [ref=e1324]:
                  - generic [ref=e1325]: "03"
                  - generic [ref=e1326]: Como os prestadores são verificados?
                  - generic [ref=e1327]:
                    - img
                    - text: Prestadores
                - img
            - heading "04 Posso me tornar um prestador no Severinno? Prestadores" [level=3] [ref=e1330]:
              - button "04 Posso me tornar um prestador no Severinno? Prestadores" [ref=e1331]:
                - generic [ref=e1332]:
                  - generic [ref=e1333]: "04"
                  - generic [ref=e1334]: Posso me tornar um prestador no Severinno?
                  - generic [ref=e1335]:
                    - img
                    - text: Prestadores
                - img
            - heading "05 Como faço para agendar um serviço? Agendamento" [level=3] [ref=e1338]:
              - button "05 Como faço para agendar um serviço? Agendamento" [ref=e1339]:
                - generic [ref=e1340]:
                  - generic [ref=e1341]: "05"
                  - generic [ref=e1342]: Como faço para agendar um serviço?
                  - generic [ref=e1343]:
                    - img
                    - text: Agendamento
                - img
            - heading "06 Posso remarcar ou cancelar um agendamento? Agendamento" [level=3] [ref=e1346]:
              - button "06 Posso remarcar ou cancelar um agendamento? Agendamento" [ref=e1347]:
                - generic [ref=e1348]:
                  - generic [ref=e1349]: "06"
                  - generic [ref=e1350]: Posso remarcar ou cancelar um agendamento?
                  - generic [ref=e1351]:
                    - img
                    - text: Agendamento
                - img
            - heading "07 Como funciona o pagamento? Pagamento" [level=3] [ref=e1354]:
              - button "07 Como funciona o pagamento? Pagamento" [ref=e1355]:
                - generic [ref=e1356]:
                  - generic [ref=e1357]: "07"
                  - generic [ref=e1358]: Como funciona o pagamento?
                  - generic [ref=e1359]:
                    - img
                    - text: Pagamento
                - img
            - heading "08 O orçamento tem compromisso? Pagamento" [level=3] [ref=e1362]:
              - button "08 O orçamento tem compromisso? Pagamento" [ref=e1363]:
                - generic [ref=e1364]:
                  - generic [ref=e1365]: "08"
                  - generic [ref=e1366]: O orçamento tem compromisso?
                  - generic [ref=e1367]:
                    - img
                    - text: Pagamento
                - img
            - heading "09 E se o serviço não for bem-feito? Segurança" [level=3] [ref=e1370]:
              - button "09 E se o serviço não for bem-feito? Segurança" [ref=e1371]:
                - generic [ref=e1372]:
                  - generic [ref=e1373]: "09"
                  - generic [ref=e1374]: E se o serviço não for bem-feito?
                  - generic [ref=e1375]:
                    - img
                    - text: Segurança
                - img
            - heading "10 Meus dados pessoais estão seguros? Segurança" [level=3] [ref=e1378]:
              - button "10 Meus dados pessoais estão seguros? Segurança" [ref=e1379]:
                - generic [ref=e1380]:
                  - generic [ref=e1381]: "10"
                  - generic [ref=e1382]: Meus dados pessoais estão seguros?
                  - generic [ref=e1383]:
                    - img
                    - text: Segurança
                - img
          - generic [ref=e1384]:
            - paragraph [ref=e1385]: 10 de 10 dúvidas
            - button "Voltar ao topo da seção" [ref=e1386]:
              - img [ref=e1387]
              - text: Topo
      - generic [ref=e1391]:
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
        - generic [ref=e1396]:
          - generic [ref=e1397]:
            - generic [ref=e1399]:
              - img [ref=e1400]
              - text: Comece agora mesmo
            - heading "Encontre o serviço que você precisa" [level=2] [ref=e1402]
            - paragraph [ref=e1403]: Navegue pela vitrine, salve seus favoritos e agende com confiança. Tudo em um só lugar.
            - list [ref=e1404]:
              - generic [ref=e1405]:
                - listitem [ref=e1406]:
                  - img [ref=e1407]
                  - text: Cadastro gratuito
                - listitem [ref=e1410]:
                  - img [ref=e1411]
                  - text: Sem taxa de serviço
                - listitem [ref=e1414]:
                  - img [ref=e1415]
                  - text: Orçamento sem compromisso
            - button "Buscar prestadores" [ref=e1423]:
              - img
              - text: Buscar prestadores
              - generic [ref=e1424]:
                - img
          - generic [ref=e1425]:
            - generic [ref=e1426]:
              - heading "O que vem depois?" [level=3] [ref=e1427]
              - paragraph [ref=e1428]: Três passos simples e você estará agendando
              - generic [ref=e1429]:
                - img [ref=e1430]
                - generic [ref=e1431]:
                  - generic [ref=e1432]:
                    - generic [ref=e1434]: "1"
                    - generic [ref=e1435]:
                      - paragraph [ref=e1436]: Cadastre-se grátis
                      - paragraph [ref=e1437]: ~30s
                  - generic [ref=e1438]:
                    - generic [ref=e1440]: "2"
                    - generic [ref=e1441]:
                      - paragraph [ref=e1442]: Busque e compare
                      - paragraph [ref=e1443]: ~2 min
                  - generic [ref=e1444]:
                    - generic [ref=e1446]: "3"
                    - generic [ref=e1447]:
                      - paragraph [ref=e1448]: Agende com confiança
                      - paragraph [ref=e1449]: ~5 min
              - generic [ref=e1450]:
                - generic [ref=e1451]:
                  - img [ref=e1452]
                  - text: Sem compromisso
                - generic [ref=e1456]:
                  - img [ref=e1457]
                  - text: Cancele quando quiser
                - generic [ref=e1460]:
                  - img [ref=e1461]
                  - text: Suporte 24h
              - link "Saiba mais sobre pagamento protegido" [ref=e1464] [cursor=pointer]:
                - /url: "#faq"
                - img [ref=e1465]
                - text: Saiba mais sobre pagamento protegido
            - generic [ref=e1469]:
              - generic [ref=e1473]: Cliente
              - generic [ref=e1474]:
                - img [ref=e1478]
                - generic [ref=e1480]: Prestador
              - img [ref=e1485]
              - img [ref=e1487]
              - img [ref=e1491]
              - img [ref=e1494]
              - img [ref=e1498]
        - generic [ref=e1502]:
          - img [ref=e1503]
          - generic [ref=e1506]:
            - paragraph [ref=e1507]: “Encontrei um encanador em 10 minutos, paguei menos do que esperava e ainda pude avaliar o serviço. Recomendo demais!”
            - paragraph [ref=e1508]: — Ana P., Cliente, São Paulo
        - generic [ref=e1509]:
          - generic [ref=e1510]:
            - img [ref=e1511]
            - text: Sem compromisso
          - generic [ref=e1515]:
            - img [ref=e1516]
            - text: Cancele quando quiser
          - generic [ref=e1519]:
            - img [ref=e1520]
            - text: Pagamento protegido
    - contentinfo [ref=e1522]:
      - generic [ref=e1524]:
        - generic [ref=e1525]:
          - paragraph [ref=e1526]: Receba novidades e dicas de serviços
          - paragraph [ref=e1527]: Cadastre-se e receba ofertas exclusivas. Cancele quando quiser.
        - generic [ref=e1528]:
          - generic [ref=e1529]:
            - img [ref=e1530]
            - textbox "E-mail para newsletter" [ref=e1533]:
              - /placeholder: Seu e-mail
          - button "Assinar" [disabled]:
            - img
            - text: Assinar
      - generic [ref=e1534]:
        - generic [ref=e1535]:
          - generic [ref=e1536]:
            - generic [ref=e1537]:
              - img [ref=e1539]
              - generic [ref=e1542]: Severinno
            - paragraph [ref=e1543]: Marketplace de serviços com geolocalização. Encontre prestadores verificados, próximos e bem avaliados.
            - list "Redes sociais" [ref=e1544]:
              - listitem [ref=e1545]:
                - link "GitHub" [ref=e1546] [cursor=pointer]:
                  - /url: https://github.com
                  - img [ref=e1547]
              - listitem [ref=e1550]:
                - link "Twitter" [ref=e1551] [cursor=pointer]:
                  - /url: https://twitter.com
                  - img [ref=e1552]
              - listitem [ref=e1554]:
                - link "Instagram" [ref=e1555] [cursor=pointer]:
                  - /url: https://instagram.com
                  - img [ref=e1556]
              - listitem [ref=e1559]:
                - link "LinkedIn" [ref=e1560] [cursor=pointer]:
                  - /url: https://linkedin.com
                  - img [ref=e1561]
              - listitem [ref=e1565]:
                - link "E-mail" [ref=e1566] [cursor=pointer]:
                  - /url: mailto:contato@severinno.com
                  - img [ref=e1567]
          - navigation "Sobre" [ref=e1570]:
            - heading "Sobre" [level=3] [ref=e1571]:
              - img [ref=e1572]
              - text: Sobre
            - list [ref=e1575]:
              - listitem [ref=e1576]:
                - button "Como funciona" [ref=e1577]
              - listitem [ref=e1578]:
                - button "Quem somos" [ref=e1579]
              - listitem [ref=e1580]:
                - button "Termos de uso" [ref=e1581]
              - listitem [ref=e1582]:
                - button "Privacidade" [ref=e1583]
          - navigation "Para profissionais" [ref=e1584]:
            - heading "Para profissionais" [level=3] [ref=e1585]:
              - img [ref=e1586]
              - text: Para profissionais
            - list [ref=e1589]:
              - listitem [ref=e1590]:
                - button "Cadastre-se" [ref=e1591]
              - listitem [ref=e1592]:
                - button "Meu painel" [ref=e1593]
              - listitem [ref=e1594]:
                - button "Central de ajuda" [ref=e1595]
          - navigation "Precisa de ajuda?" [ref=e1596]:
            - heading "Precisa de ajuda?" [level=3] [ref=e1597]:
              - img [ref=e1598]
              - text: Precisa de ajuda?
            - list [ref=e1600]:
              - listitem [ref=e1601]:
                - button "Perguntas frequentes" [ref=e1602]
              - listitem [ref=e1603]:
                - button "Segurança" [ref=e1604]
              - listitem [ref=e1605]:
                - button "Reportar problema" [ref=e1606]
          - generic [ref=e1607]:
            - heading "Contato" [level=3] [ref=e1608]:
              - img [ref=e1609]
              - text: Contato
            - list [ref=e1614]:
              - listitem [ref=e1615]:
                - img [ref=e1616]
                - link "contato@severinno.com" [ref=e1619] [cursor=pointer]:
                  - /url: mailto:contato@severinno.com
              - listitem [ref=e1620]:
                - img [ref=e1621]
                - text: São Paulo, Brasil
            - button "Fale conosco" [ref=e1624]:
              - img
              - text: Fale conosco
        - generic [ref=e1625]:
          - paragraph [ref=e1626]: © 2026 Severinno Marketplace. Todos os direitos reservados.
          - paragraph [ref=e1627]:
            - text: Feito com
            - img [ref=e1628]
            - text: usando tecnologia Open Source (
            - link "MapLibre" [ref=e1630] [cursor=pointer]:
              - /url: https://maplibre.org/
            - text: ·
            - link "OpenStreetMap" [ref=e1631] [cursor=pointer]:
              - /url: https://www.openstreetmap.org/copyright
            - text: )
    - button "Voltar ao topo" [ref=e1633]:
      - img
    - button "Abrir assistente virtual" [ref=e1634]:
      - img [ref=e1635]
    - generic [ref=e1639]:
      - generic [ref=e1640]:
        - img [ref=e1642]
        - generic [ref=e1644]:
          - paragraph [ref=e1645]: Usamos cookies para melhorar sua experiência
          - paragraph [ref=e1646]:
            - text: Utilizamos cookies essenciais para o funcionamento do site e cookies de análise para melhorar nossos serviços.
            - button "Política de privacidade" [ref=e1647]
      - generic [ref=e1648]:
        - button "Recusar" [ref=e1649]
        - button "Aceitar" [ref=e1650]:
          - img
          - text: Aceitar
        - button "Dispensar" [ref=e1651]:
          - img [ref=e1652]
  - region "Notifications alt+T"
  - generic [active]:
    - generic [ref=e1657]:
      - generic [ref=e1658]:
        - generic [ref=e1659]:
          - navigation [ref=e1660]:
            - button "previous" [disabled] [ref=e1661]:
              - img "previous" [ref=e1662]
            - generic [ref=e1664]:
              - generic [ref=e1665]: 1/
              - text: "1"
            - button "next" [disabled] [ref=e1666]:
              - img "next" [ref=e1667]
          - img
        - generic [ref=e1669]:
          - link "Next.js 16.1.3 (stale) Turbopack" [ref=e1670] [cursor=pointer]:
            - /url: https://nextjs.org/docs/messages/version-staleness
            - img [ref=e1671]
            - generic "There is a newer version (16.2.11) available, upgrade recommended!" [ref=e1673]: Next.js 16.1.3 (stale)
            - generic [ref=e1674]: Turbopack
          - img
      - dialog "Build Error" [ref=e1676]:
        - generic [ref=e1679]:
          - generic [ref=e1680]:
            - generic [ref=e1681]:
              - generic [ref=e1683]: Build Error
              - generic [ref=e1684]:
                - button "Copy Error Info" [ref=e1685] [cursor=pointer]:
                  - img [ref=e1686]
                - button "No related documentation found" [disabled] [ref=e1688]:
                  - img [ref=e1689]
                - button "Attach Node.js inspector" [ref=e1691] [cursor=pointer]:
                  - img [ref=e1692]
            - generic [ref=e1701]: Reading source code for parsing failed
          - generic [ref=e1703]:
            - generic [ref=e1705]:
              - img [ref=e1707]
              - generic [ref=e1711]: ./.freebuff/worktrees/thmrzp9vv9y86o/src/lib/api-server.ts
              - button "Open in editor" [ref=e1712] [cursor=pointer]:
                - img [ref=e1714]
            - generic [ref=e1718]: "Reading source code for parsing failed An unexpected error happened while trying to read the source code to parse: failed to convert rope into string Caused by: - invalid utf-8 sequence of 1 bytes from index 5415 Import trace: App Route: ./.freebuff/worktrees/thmrzp9vv9y86o/src/lib/api-server.ts ./.freebuff/worktrees/thmrzp9vv9y86o/src/app/api/auth/me/route.ts"
        - generic [ref=e1719]: "1"
        - generic [ref=e1720]: "2"
    - generic [ref=e1725] [cursor=pointer]:
      - button "Open Next.js Dev Tools" [ref=e1726]:
        - img [ref=e1727]
      - button "Open issues overlay" [ref=e1731]:
        - generic [ref=e1732]:
          - generic [ref=e1733]: "0"
          - generic [ref=e1734]: "1"
        - generic [ref=e1735]: Issue
  - alert [ref=e1736]
```

# Test source

```ts
  4   |  * Wait for the vitrine (app shell) to be fully loaded and hydrated.
  5   |  * The app shows a "Carregando Severinno…" text during SSR/hydration.
  6   |  *
  7   |  * Dev mode is slower than production, so timeout is generous.
  8   |  */
  9   | export async function waitForVitrine(page: Page) {
  10  |   // Wait for the "Carregando" text to disappear (hydration complete)
  11  |   await page.waitForFunction(
  12  |     () => {
  13  |       const loadingEl = document.querySelector('[class*="animate-spin"]')
  14  |       const hasLoadingText = document.body?.innerText?.includes("Carregando")
  15  |       return !loadingEl && !hasLoadingText
  16  |     },
  17  |     { timeout: 30000 },
  18  |   )
  19  |   // Wait for a post-hydration element to confirm the app is interactive
  20  |   await page
  21  |     .locator(
  22  |       'button:has-text(/entrar|login/i), [class*="Card"], [class*="search"], h1, h2',
  23  |     )
  24  |     .first()
  25  |     .waitFor({ state: "visible", timeout: 10000 })
  26  |     .catch(() => {})
  27  | }
  28  | 
  29  | /**
  30  |  * Fill in the CEP field in the address form (Step 2 - Details).
  31  |  * Uses a real CEP to trigger the auto-fill behavior.
  32  |  */
  33  | export async function fillCEP(page: Page, cep: string) {
  34  |   const cepInput = page.locator('input[placeholder*="CEP"], input[name*="cep"]').first()
  35  |   await cepInput.fill(cep)
  36  |   // Wait for address auto-fill (ViaCEP typically responds in < 500ms)
  37  |   await page.waitForTimeout(1000)
  38  | }
  39  | 
  40  | /**
  41  |  * Select a date in the calendar (Step 1 - Schedule).
  42  |  * Clicks a date cell that's not disabled.
  43  |  */
  44  | export async function selectDate(page: Page, day: number) {
  45  |   // Find a day cell in the calendar that matches and is not disabled
  46  |   const dayButton = page.locator(
  47  |     `button[role="gridcell"]:not([disabled]) button:has-text("${day}"), button:not([disabled]):has-text("${day}")`,
  48  |   ).first()
  49  |   await dayButton.click()
  50  |   await page.waitForTimeout(300)
  51  | }
  52  | 
  53  | /**
  54  |  * Select a time slot (Step 1 - Schedule).
  55  |  * Clicks a time button in the available slots.
  56  |  */
  57  | export async function selectTimeSlot(page: Page) {
  58  |   // Click the first available time slot (buttons with HH:MM text pattern)
  59  |   const slot = page.getByRole("button").filter({ hasText: /\d{2}:\d{2}/ }).first()
  60  |   await slot.click()
  61  |   await page.waitForTimeout(300)
  62  | }
  63  | 
  64  | /**
  65  |  * Click "Continuar" button to advance to the next booking step.
  66  |  */
  67  | export async function clickContinue(page: Page) {
  68  |   const btn = page.locator('button:has-text("Continuar")')
  69  |   await btn.click()
  70  |   await page.waitForTimeout(500)
  71  | }
  72  | 
  73  | /**
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
> 104 |     await criarBtn.click()
      |                    ^ Error: locator.click: Test timeout of 30000ms exceeded.
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
  174 |   await agendarBtn.click()
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
```