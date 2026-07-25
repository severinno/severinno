# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: booking-flow.spec.ts >> Fluxo Completo de Agendamento — Visitante (não logado) >> 5. booking step 2 — endereço com CEP
- Location: e2e\booking-flow.spec.ts:200:7

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
    - waiting for element to be visible, enabled and stable
    - element is visible, enabled and stable
    - scrolling into view if needed
    - done scrolling
    - <nextjs-portal></nextjs-portal> from <script data-nextjs-dev-overlay="true">…</script> subtree intercepts pointer events
  - retrying click action
    - waiting for element to be visible, enabled and stable
    - element is not stable
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
          - generic [ref=e32]:
            - button "Entrar" [ref=e33]
            - button "Cadastrar" [ref=e34]
    - main [ref=e35]:
      - generic [ref=e42]:
        - generic [ref=e43]:
          - generic [ref=e45]:
            - img [ref=e46]
            - text: Marketplace de serviços verificados
          - heading "Prestadores de serviço verificados, perto de você." [level=1] [ref=e49]
          - paragraph [ref=e50]: Compare avaliações reais, peça orçamento grátis e agende — encanador, eletricista, pintor e mais. Você escolhe o profissional.
          - generic [ref=e52]:
            - generic [ref=e53]:
              - img [ref=e54]
              - textbox "Serviço buscado" [ref=e57]:
                - /placeholder: "O que você precisa? Ex.: encanador, pintura…"
            - generic [ref=e58]:
              - img [ref=e59]
              - textbox "Localização" [ref=e62]:
                - /placeholder: CEP ou cidade
            - button "Buscar" [ref=e63]:
              - img
              - text: Buscar
          - generic [ref=e64]:
            - generic [ref=e65]: "Mais buscados:"
            - button "Encanador" [ref=e66]:
              - generic [ref=e67]: 🔧
              - text: Encanador
            - button "Eletricista" [ref=e68]:
              - generic [ref=e69]: 💡
              - text: Eletricista
            - button "Pintor" [ref=e70]:
              - generic [ref=e71]: 🎨
              - text: Pintor
            - button "Diarista" [ref=e72]:
              - generic [ref=e73]: 🧹
              - text: Diarista
            - button "Pedreiro" [ref=e74]:
              - generic [ref=e75]: 🧱
              - text: Pedreiro
            - button "Jardineiro" [ref=e76]:
              - generic [ref=e77]: 🌿
              - text: Jardineiro
          - button "Usar minha localização" [ref=e78]:
            - img [ref=e79]
            - text: Usar minha localização
          - generic [ref=e82]:
            - button "Cadastrar grátis" [ref=e83]:
              - text: Cadastrar grátis
              - img
            - button "Ver como funciona" [ref=e84]
          - paragraph [ref=e85]: Cadastro grátis · Orçamento sem compromisso · Você escolhe o profissional
          - list [ref=e86]:
            - listitem "Documentos validados e identidade confirmada" [ref=e87]:
              - img [ref=e89]
              - generic [ref=e92]: Prestadores verificados
            - listitem "Avaliações de clientes após a conclusão do serviço" [ref=e93]:
              - img [ref=e95]
              - generic [ref=e97]: Avaliações reais
            - listitem "Pagamento só é liberado após você marcar como concluído" [ref=e98]:
              - img [ref=e100]
              - generic [ref=e103]: Pagamento seguro
        - generic [ref=e106]:
          - generic [ref=e112]: Atividade ao vivo
          - generic [ref=e114]:
            - img [ref=e115]
            - paragraph [ref=e117]: Carregando atividades…
      - region "Atividade recente na plataforma" [ref=e119]:
        - generic [ref=e120]:
          - generic [ref=e122]: Atividade recente
          - generic [ref=e126]:
            - generic [ref=e128]:
              - generic [ref=e129]:
                - generic [ref=e130]: ⚡
                - text: Maria contratou um eletricista em São Paulo
              - generic [ref=e132]:
                - generic [ref=e133]: ⭐
                - text: João avaliou ★★★★★ o prestador Ricardo
              - generic [ref=e135]:
                - generic [ref=e136]: 🎨
                - text: "Nova avaliação: 4.9 para Serviços de Pintura"
              - generic [ref=e138]:
                - generic [ref=e139]: 🔧
                - text: Ana pediu orçamento para encanador
              - generic [ref=e141]:
                - generic [ref=e142]: ✅
                - text: Pedro se cadastrou como prestador verificado
              - generic [ref=e144]:
                - generic [ref=e145]: 📋
                - text: 12 orçamentos enviados hoje
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
            - generic [ref=e167]:
              - generic [ref=e168]:
                - generic [ref=e169]: 🧹
                - text: Carlos agendou limpeza de quintal em Belo Horizonte
              - generic [ref=e171]:
                - generic [ref=e172]: ⭐
                - text: Fernanda avaliou ★★★★★ o prestador José
              - generic [ref=e174]:
                - generic [ref=e175]: 🛡️
                - text: 8 novos prestadores verificados esta semana
              - generic [ref=e177]:
                - generic [ref=e178]: 🎨
                - text: Luciana contratou um pintor no Rio de Janeiro
              - generic [ref=e180]:
                - generic [ref=e181]: 🚿
                - text: "Orçamento aceito: reforma de banheiro em Curitiba"
              - generic [ref=e183]:
                - generic [ref=e184]: 🏆
                - text: 5.200 serviços concluídos este mês
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
      - region "Categorias de serviços" [ref=e204]:
        - generic [ref=e205]:
          - generic:
            - img
          - generic [ref=e207]:
            - generic [ref=e208]:
              - img [ref=e209]
              - text: Explore categorias
            - heading "Encontre o serviço ideal" [level=2] [ref=e212]
            - paragraph [ref=e213]: Serviços verificados perto de você — 0 categorias disponíveis
          - generic [ref=e214]:
            - img [ref=e216]
            - generic [ref=e219]:
              - paragraph [ref=e220]: Nenhuma categoria disponível
              - paragraph [ref=e221]: As categorias aparecerão aqui assim que estiverem disponíveis. Tente recarregar a página.
            - button "Tentar carregar categorias novamente" [ref=e222]:
              - img
              - text: Tentar novamente
      - region "Resultados da busca" [ref=e223]:
        - generic [ref=e224]:
          - complementary [ref=e225]:
            - generic [ref=e227]:
              - generic [ref=e228]:
                - heading "Filtros" [level=2] [ref=e229]:
                  - img [ref=e230]
                  - text: Filtros
                - button "Limpar filtros" [ref=e231]
              - generic [ref=e232]:
                - generic [ref=e233]: Buscar
                - generic [ref=e234]:
                  - img [ref=e235]
                  - textbox "Buscar" [ref=e238]:
                    - /placeholder: Serviço, prestador…
              - generic [ref=e239]:
                - generic [ref=e240]:
                  - generic [ref=e241]: Raio de busca
                  - generic [ref=e242]: 15 km
                - generic "Raio de busca em quilômetros" [ref=e243]:
                  - slider [ref=e247]
                - generic [ref=e248]:
                  - generic [ref=e249]: 1 km
                  - generic [ref=e250]: 50 km
              - generic [ref=e251]:
                - generic [ref=e252]: Categoria
                - combobox [ref=e253]:
                  - generic: Todas as categorias
                  - img
              - generic [ref=e254]:
                - generic [ref=e255]: Ordenar por
                - radiogroup "Ordenar por" [ref=e256]:
                  - radio "Melhor avaliação" [checked] [ref=e257]
                  - radio "Mais próximos" [ref=e258]
              - generic [ref=e259]:
                - generic [ref=e260]: Avaliação mínima
                - radiogroup [ref=e261]:
                  - generic [ref=e262] [cursor=pointer]:
                    - radio "Todas" [checked] [ref=e263]:
                      - img [ref=e264]
                    - generic [ref=e266]: Todas
                  - generic [ref=e267] [cursor=pointer]:
                    - radio "3+" [ref=e268]
                    - generic [ref=e269]: 3+
                  - generic [ref=e270] [cursor=pointer]:
                    - radio "4+" [ref=e271]
                    - generic [ref=e272]: 4+
                  - generic [ref=e273] [cursor=pointer]:
                    - radio "5" [ref=e274]
                    - generic [ref=e275]: "5"
              - generic [ref=e276] [cursor=pointer]:
                - generic [ref=e277]:
                  - img [ref=e278]
                  - generic [ref=e280]: Somente verificados
                - switch "Somente verificados" [ref=e281]
              - button "Ver 0 resultados" [disabled]
          - generic [ref=e282]:
            - generic [ref=e284]:
              - generic [ref=e285]:
                - heading "0 prestadores encontrados" [level=2] [ref=e286]
                - paragraph [ref=e287]: Exibindo 0–0 de 0
              - generic [ref=e288]:
                - generic [ref=e289]:
                  - text: "Ordenado por:"
                  - generic [ref=e290]: Melhor avaliação
                - tablist "Visualização" [ref=e291]:
                  - tab "Lista" [selected] [ref=e292]:
                    - img [ref=e293]
                    - generic [ref=e294]: Lista
                  - tab "Mapa" [ref=e295]:
                    - img [ref=e296]
                    - generic [ref=e298]: Mapa
            - generic [ref=e300]:
              - img [ref=e302]
              - heading "Algo deu errado" [level=3] [ref=e305]
              - paragraph [ref=e306]: Não foi possível carregar os prestadores. Verifique sua conexão e tente novamente.
              - button "Tentar novamente" [ref=e307]
      - region "Como funciona" [ref=e308]:
        - generic [ref=e313]:
          - generic [ref=e314]:
            - link "Pular para resultados" [ref=e315] [cursor=pointer]:
              - /url: "#vitrine-resultados"
              - img [ref=e316]
              - text: Pular para resultados
            - generic [ref=e320]:
              - img [ref=e321]
              - generic [ref=e323]: "4"
              - text: passos simples
            - heading "Como funciona" [level=2] [ref=e324]
            - paragraph [ref=e325]: Sem surpresas — do início ao fim, você tem o controle.
            - generic [ref=e326]:
              - img [ref=e327]
              - text: Sem compromisso
          - generic [ref=e333]:
            - img [ref=e335]
            - generic [ref=e336]:
              - 'button "1 Busque o serviço Encontre prestadores verificados perto de você. 50 + categorias encanador em São Paulo | Verificados < 5 km Mais filtros Ex: Busque ''encanador em São Paulo'' Buscar prestadores" [ref=e337] [cursor=pointer]':
                - generic [ref=e339]:
                  - generic [ref=e341]: "1"
                  - generic [ref=e342]:
                    - img [ref=e344]
                    - img [ref=e348]
                  - heading "Busque o serviço" [level=3] [ref=e351]
                  - paragraph [ref=e352]: Encontre prestadores verificados perto de você.
                  - generic [ref=e354]:
                    - generic [ref=e355]: "50"
                    - text: +
                    - generic [ref=e356]: categorias
                  - generic [ref=e358]:
                    - generic [ref=e359]:
                      - img [ref=e360]
                      - generic [ref=e363]: encanador em São Paulo
                      - generic [ref=e364]: "|"
                    - generic [ref=e365]:
                      - generic [ref=e366]: Verificados
                      - generic [ref=e367]: < 5 km
                      - generic [ref=e368]:
                        - img [ref=e369]
                        - text: Mais filtros
                  - paragraph [ref=e371]: "Ex: Busque 'encanador em São Paulo'"
                  - button "Buscar prestadores" [ref=e372]:
                    - text: Buscar prestadores
                    - img
              - 'button "2 Compare orçamentos Receba e compare propostas lado a lado. 3 orçamentos em 24h João S. R$ 180 Maria L. R$ 150 Melhor avaliação Compare lado a lado Ex: Compare 3 orçamentos em 24h Sem compromisso Pedir orçamento" [ref=e373] [cursor=pointer]':
                - generic [ref=e375]:
                  - generic [ref=e377]: "2"
                  - generic [ref=e378]:
                    - img [ref=e380]
                    - img [ref=e386]
                  - heading "Compare orçamentos" [level=3] [ref=e389]
                  - paragraph [ref=e390]: Receba e compare propostas lado a lado.
                  - generic [ref=e392]:
                    - generic [ref=e393]: "3"
                    - generic [ref=e394]: orçamentos em 24h
                  - generic [ref=e396]:
                    - generic [ref=e397]:
                      - generic [ref=e398]:
                        - generic [ref=e401]: João S.
                        - generic [ref=e402]:
                          - img [ref=e403]
                          - img [ref=e405]
                          - img [ref=e407]
                          - img [ref=e409]
                          - img [ref=e411]
                        - generic [ref=e413]: R$ 180
                      - generic [ref=e414]:
                        - generic [ref=e417]: Maria L.
                        - generic [ref=e418]:
                          - img [ref=e419]
                          - img [ref=e421]
                          - img [ref=e423]
                          - img [ref=e425]
                          - img [ref=e427]
                        - generic [ref=e429]: R$ 150
                        - generic [ref=e430]: Melhor avaliação
                    - generic [ref=e431]:
                      - img [ref=e432]
                      - text: Compare lado a lado
                  - paragraph [ref=e437]: "Ex: Compare 3 orçamentos em 24h"
                  - generic [ref=e438]:
                    - img [ref=e439]
                    - text: Sem compromisso
                  - button "Pedir orçamento" [ref=e444]:
                    - text: Pedir orçamento
                    - img
              - 'button "3 Agende com confiança Solicite um orçamento ou agende diretamente. 24 h para confirmar Março 2025 S T Q Q S S D 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 12 Mar, 14:00 — Confirmado Ex: Agende para amanhã às 14h Agendar agora" [ref=e445] [cursor=pointer]':
                - generic [ref=e447]:
                  - generic [ref=e449]: "3"
                  - generic [ref=e450]:
                    - img [ref=e452]
                    - img [ref=e456]
                  - heading "Agende com confiança" [level=3] [ref=e459]
                  - paragraph [ref=e460]: Solicite um orçamento ou agende diretamente.
                  - generic [ref=e462]:
                    - generic [ref=e463]: "24"
                    - text: h
                    - generic [ref=e464]: para confirmar
                  - generic [ref=e467]:
                    - generic [ref=e468]: Março 2025
                    - generic [ref=e469]:
                      - generic [ref=e470]: S
                      - generic [ref=e471]: T
                      - generic [ref=e472]: Q
                      - generic [ref=e473]: Q
                      - generic [ref=e474]: S
                      - generic [ref=e475]: S
                      - generic [ref=e476]: D
                      - generic [ref=e477]: "1"
                      - generic [ref=e478]: "2"
                      - generic [ref=e479]: "3"
                      - generic [ref=e480]: "4"
                      - generic [ref=e481]: "5"
                      - generic [ref=e482]: "6"
                      - generic [ref=e483]: "7"
                      - generic [ref=e484]: "8"
                      - generic [ref=e485]: "9"
                      - generic [ref=e486]: "10"
                      - generic [ref=e487]: "11"
                      - generic [ref=e488]: "12"
                      - generic [ref=e489]: "13"
                      - generic [ref=e490]: "14"
                      - generic [ref=e491]: "15"
                    - generic [ref=e492]:
                      - img [ref=e493]
                      - generic [ref=e496]: 12 Mar, 14:00 — Confirmado
                  - paragraph [ref=e497]: "Ex: Agende para amanhã às 14h"
                  - button "Agendar agora" [ref=e498]:
                    - text: Agendar agora
                    - img
              - 'button "4 Avalie o resultado Sua opinião mantém a qualidade da comunidade. 98 % satisfação 4.0 \"Excelente trabalho, recomendo!\" Avaliação verificada Ex: Avalie de 1 a 5 estrelas com comentário Cadastrar grátis" [ref=e499] [cursor=pointer]':
                - generic [ref=e501]:
                  - generic [ref=e503]: "4"
                  - generic [ref=e504]:
                    - img [ref=e506]
                    - img [ref=e509]
                  - heading "Avalie o resultado" [level=3] [ref=e512]
                  - paragraph [ref=e513]: Sua opinião mantém a qualidade da comunidade.
                  - generic [ref=e515]:
                    - generic [ref=e516]: "98"
                    - text: "%"
                    - generic [ref=e517]: satisfação
                  - generic [ref=e519]:
                    - generic [ref=e520]:
                      - generic [ref=e521]:
                        - img [ref=e522]
                        - img [ref=e524]
                        - img [ref=e526]
                        - img [ref=e528]
                        - img [ref=e530]
                        - generic [ref=e532]: "4.0"
                      - paragraph [ref=e535]: "\"Excelente trabalho, recomendo!\""
                    - generic [ref=e536]:
                      - img [ref=e537]
                      - text: Avaliação verificada
                  - paragraph [ref=e540]: "Ex: Avalie de 1 a 5 estrelas com comentário"
                  - button "Cadastrar grátis" [ref=e541]:
                    - text: Cadastrar grátis
                    - img
          - generic [ref=e542]:
            - generic [ref=e543]:
              - img [ref=e544]
              - generic [ref=e547]: Garantia Severinno
            - generic [ref=e548]:
              - generic [ref=e549]:
                - img [ref=e550]
                - generic [ref=e553]: Prestadores verificados
              - generic [ref=e554]:
                - img [ref=e555]
                - generic [ref=e558]: Resposta rápida
              - generic [ref=e559]:
                - img [ref=e560]
                - generic [ref=e562]: Satisfação garantida
              - generic [ref=e563]:
                - img [ref=e564]
                - generic [ref=e569]: Compare antes de contratar
          - generic [ref=e570]:
            - button "Começar agora" [ref=e571]:
              - text: Começar agora
              - img
            - link "Buscar prestadores" [ref=e572] [cursor=pointer]:
              - /url: "#vitrine-resultados"
              - img
              - text: Buscar prestadores
          - button "Voltar ao topo" [ref=e574]:
            - img [ref=e575]
            - text: Voltar ao topo
      - generic [ref=e578]:
        - generic [ref=e579]:
          - generic [ref=e580]:
            - img
            - text: Simulador de preços
          - heading "Quanto custa? Simule agora" [level=2] [ref=e581]
          - paragraph [ref=e582]: Estime o valor do serviço em 3 passos rápidos. Sem compromisso, sem cadastro.
        - generic [ref=e583]:
          - generic [ref=e584]: "1"
          - generic [ref=e586]: "2"
          - generic [ref=e588]: "3"
        - generic [ref=e591]:
          - heading "1. Qual serviço você precisa?" [level=3] [ref=e592]
          - paragraph [ref=e593]: Selecione a categoria do serviço
          - generic [ref=e594]:
            - button "Elétrica" [ref=e595]:
              - img [ref=e597]
              - generic [ref=e599]: Elétrica
            - button "Hidráulica" [ref=e600]:
              - img [ref=e602]
              - generic [ref=e605]: Hidráulica
            - button "Pintura" [ref=e606]:
              - img [ref=e608]
              - generic [ref=e612]: Pintura
            - button "Alvenaria" [ref=e613]:
              - img [ref=e615]
              - generic [ref=e617]: Alvenaria
            - button "Pisos" [ref=e618]:
              - img [ref=e620]
              - generic [ref=e622]: Pisos
            - button "Pós-obra" [ref=e623]:
              - img [ref=e625]
              - generic [ref=e630]: Pós-obra
            - button "Residencial" [ref=e631]:
              - img [ref=e633]
              - generic [ref=e636]: Residencial
      - region "Parceiros e imprensa" [ref=e637]:
        - generic [ref=e638]:
          - paragraph [ref=e640]: Referência no mercado
          - generic [ref=e642]:
            - generic [ref=e645]: G1
            - generic [ref=e648]: Folha de S.Paulo
            - generic [ref=e651]: Valor Econômico
            - generic [ref=e654]: Exame
            - generic [ref=e657]: InfoMoney
            - generic [ref=e660]: Startups
            - generic [ref=e663]: Sebrae
            - generic [ref=e666]: ABES
          - paragraph [ref=e667]: + de 6.000 prestadores confiam no Severinno
      - region "Avaliações de clientes" [ref=e668]:
        - generic:
          - generic:
            - img
        - generic [ref=e669]:
          - generic [ref=e670]:
            - generic [ref=e671]:
              - img [ref=e672]
              - text: Avaliações reais
            - heading "O que nossos clientes dizem" [level=2] [ref=e674]
            - paragraph [ref=e675]: Avaliações de clientes após a conclusão do serviço.
          - generic [ref=e676]:
            - img [ref=e678]
            - heading "Não foi possível carregar as avaliações" [level=3] [ref=e683]
            - paragraph [ref=e684]: Ocorreu um erro ao buscar as avaliações. Tente novamente.
            - button "Tentar novamente" [ref=e685]:
              - img
              - text: Tentar novamente
      - generic [ref=e686]:
        - generic [ref=e689]:
          - generic [ref=e690]:
            - img [ref=e692]
            - generic [ref=e697]: "0"
            - paragraph [ref=e698]: Prestadores verificados
          - generic [ref=e699]:
            - img [ref=e701]
            - generic [ref=e703]: "0"
            - paragraph [ref=e704]: Serviços cadastrados
          - generic [ref=e705]:
            - img [ref=e707]
            - generic [ref=e710]: "0"
            - paragraph [ref=e711]: Serviços concluídos
          - generic [ref=e712]:
            - img [ref=e714]
            - generic [ref=e717]: 0.0/5
            - paragraph [ref=e718]: Nota média
        - generic [ref=e720]:
          - generic [ref=e721]:
            - generic [ref=e722]:
              - img [ref=e723]
              - text: Por que Severinno?
            - heading "Confiança em cada agendamento" [level=2] [ref=e726]
            - paragraph [ref=e727]: Mais que um diretório de serviços — um ecossistema pensado para proteger você e o prestador. Da verificação ao pagamento, cada etapa foi desenhada para a sua tranquilidade.
            - link "Pular para FAQ" [ref=e729] [cursor=pointer]:
              - /url: "#faq"
              - img [ref=e730]
              - text: Pular para FAQ
          - generic [ref=e733]:
            - generic [ref=e736]:
              - generic [ref=e737]:
                - img [ref=e739]
                - button "Saiba mais sobre Prestadores verificados" [ref=e742]:
                  - img [ref=e743]
              - heading "Prestadores verificados" [level=3] [ref=e746]
              - paragraph [ref=e747]: João verificou 3 documentos antes de aprovar o prestador. Você só vê profissionais validados.
              - button "Saiba mais" [ref=e748]:
                - text: Saiba mais
                - img [ref=e749]
            - generic [ref=e753]:
              - generic [ref=e754]:
                - img [ref=e756]
                - button "Saiba mais sobre Pagamento protegido" [ref=e759]:
                  - img [ref=e760]
              - heading "Pagamento protegido" [level=3] [ref=e763]
              - paragraph [ref=e764]: O valor só é liberado ao prestador após você confirmar que ficou satisfeito com o serviço.
              - button "Saiba mais" [ref=e765]:
                - text: Saiba mais
                - img [ref=e766]
            - generic [ref=e770]:
              - generic [ref=e771]:
                - img [ref=e773]
                - button "Saiba mais sobre Resposta rápida" [ref=e776]:
                  - img [ref=e777]
              - heading "Resposta rápida" [level=3] [ref=e780]
              - paragraph [ref=e781]: Prestadores comprometidos a responder em até 24h. Acompanhe o status em tempo real.
              - button "Saiba mais" [ref=e782]:
                - text: Saiba mais
                - img [ref=e783]
            - generic [ref=e787]:
              - generic [ref=e788]:
                - img [ref=e790]
                - button "Saiba mais sobre Avaliações reais" [ref=e792]:
                  - img [ref=e793]
              - heading "Avaliações reais" [level=3] [ref=e796]
              - paragraph [ref=e797]: Apenas clientes que concluíram o serviço podem avaliar. Sem falsas avaliações.
              - button "Saiba mais" [ref=e798]:
                - text: Saiba mais
                - img [ref=e799]
            - generic [ref=e803]:
              - generic [ref=e804]:
                - img [ref=e806]
                - button "Saiba mais sobre Próximo de você" [ref=e809]:
                  - img [ref=e810]
              - heading "Próximo de você" [level=3] [ref=e813]
              - paragraph [ref=e814]: Geolocalização inteligente mostra os melhores prestadores na sua região.
              - button "Saiba mais" [ref=e815]:
                - text: Saiba mais
                - img [ref=e816]
            - generic [ref=e820]:
              - generic [ref=e821]:
                - img [ref=e823]
                - button "Saiba mais sobre Suporte humano" [ref=e825]:
                  - img [ref=e826]
              - heading "Suporte humano" [level=3] [ref=e829]
              - paragraph [ref=e830]: Equipe disponível para mediar disputas, tirar dúvidas e garantir uma experiência justa.
              - button "Saiba mais" [ref=e831]:
                - text: Saiba mais
                - img [ref=e832]
        - generic [ref=e835]:
          - img [ref=e836]
          - paragraph [ref=e838]: "Garantia Severinno: seu dinheiro de volta se o serviço não for bem-feito."
          - link "Saiba mais" [ref=e839] [cursor=pointer]:
            - /url: "#faq"
            - text: Saiba mais
            - img [ref=e840]
      - generic [ref=e843]:
        - generic [ref=e844]:
          - generic [ref=e845]:
            - img [ref=e846]
            - text: Destaque da semana
          - heading "Profissional em destaque" [level=2] [ref=e852]
          - paragraph [ref=e853]: Conheça um dos nossos prestadores mais bem avaliados.
        - generic [ref=e854]:
          - img [ref=e855]
          - paragraph [ref=e858]: Nenhum prestador em destaque no momento.
          - paragraph [ref=e859]: Cadastre-se como prestador e apareça aqui!
      - generic [ref=e863]:
        - generic [ref=e864]:
          - generic [ref=e865]:
            - generic [ref=e866]:
              - img [ref=e867]
              - text: Perguntas frequentes
            - heading "Tire suas dúvidas antes de contratar" [level=2] [ref=e870]
            - paragraph [ref=e871]: Reunimos as perguntas mais comuns sobre como o Severinno funciona — do cadastro ao pagamento.
          - generic [ref=e872]:
            - img [ref=e873]
            - textbox "Buscar nas perguntas frequentes" [ref=e876]:
              - /placeholder: Buscar nas dúvidas…
          - generic [ref=e877]:
            - paragraph [ref=e878]: Filtrar por categoria
            - generic [ref=e879]:
              - button "Filtrar por Geral" [ref=e880]:
                - img [ref=e881]
                - text: Geral
                - generic [ref=e884]: (2)
              - button "Filtrar por Pagamento" [ref=e885]:
                - img [ref=e886]
                - text: Pagamento
                - generic [ref=e888]: (2)
              - button "Filtrar por Agendamento" [ref=e889]:
                - img [ref=e890]
                - text: Agendamento
                - generic [ref=e892]: (2)
              - button "Filtrar por Prestadores" [ref=e893]:
                - img [ref=e894]
                - text: Prestadores
                - generic [ref=e898]: (2)
              - button "Filtrar por Segurança" [ref=e899]:
                - img [ref=e900]
                - text: Segurança
                - generic [ref=e903]: (2)
          - generic [ref=e904]:
            - paragraph [ref=e905]: Perguntas mais frequentes
            - list [ref=e906]:
              - listitem [ref=e907]:
                - button "Como funciona o Severinno?" [ref=e908]:
                  - img [ref=e909]
                  - generic [ref=e911]: Como funciona o Severinno?
              - listitem [ref=e912]:
                - button "Preciso pagar para me cadastrar?" [ref=e913]:
                  - img [ref=e914]
                  - generic [ref=e916]: Preciso pagar para me cadastrar?
              - listitem [ref=e917]:
                - button "Como faço para agendar um serviço?" [ref=e918]:
                  - img [ref=e919]
                  - generic [ref=e921]: Como faço para agendar um serviço?
              - listitem [ref=e922]:
                - button "E se o serviço não for bem-feito?" [ref=e923]:
                  - img [ref=e924]
                  - generic [ref=e926]: E se o serviço não for bem-feito?
          - generic [ref=e928]:
            - img [ref=e930]
            - generic [ref=e932]:
              - paragraph [ref=e933]: Ainda tem dúvidas?
              - paragraph [ref=e934]: Cadastre-se grátis e converse diretamente com prestadores verificados. Sem compromisso.
              - generic [ref=e935]:
                - button "Cadastrar grátis" [ref=e936]
                - link "Fale conosco" [ref=e937] [cursor=pointer]:
                  - /url: "#faq"
                  - img
                  - text: Fale conosco
        - generic [ref=e938]:
          - generic [ref=e940]:
            - generic [ref=e942]:
              - heading "01 Como funciona o Severinno? Geral" [level=3] [ref=e943]:
                - button "01 Como funciona o Severinno? Geral" [expanded] [ref=e944]:
                  - generic [ref=e945]:
                    - generic [ref=e946]: "01"
                    - generic [ref=e947]: Como funciona o Severinno?
                    - generic [ref=e948]:
                      - img
                      - text: Geral
                  - img
              - region "01 Como funciona o Severinno? Geral" [ref=e949]:
                - generic [ref=e951]:
                  - paragraph [ref=e952]: O Severinno conecta você a prestadores de serviço verificados próximos à sua localização. Você busca o serviço, compara avaliações reais de outros clientes, pede orçamento grátis e agenda — tudo pela plataforma. O pagamento só é liberado após você confirmar a conclusão do serviço.
                  - paragraph [ref=e953]: "Ex: Maria precisava de um eletricista. Buscou na plataforma, comparou 3 profissionais e contratou o mais bem avaliado — tudo em 5 minutos."
            - heading "02 Preciso pagar para me cadastrar? Geral" [level=3] [ref=e956]:
              - button "02 Preciso pagar para me cadastrar? Geral" [ref=e957]:
                - generic [ref=e958]:
                  - generic [ref=e959]: "02"
                  - generic [ref=e960]: Preciso pagar para me cadastrar?
                  - generic [ref=e961]:
                    - img
                    - text: Geral
                - img
            - heading "03 Como os prestadores são verificados? Prestadores" [level=3] [ref=e964]:
              - button "03 Como os prestadores são verificados? Prestadores" [ref=e965]:
                - generic [ref=e966]:
                  - generic [ref=e967]: "03"
                  - generic [ref=e968]: Como os prestadores são verificados?
                  - generic [ref=e969]:
                    - img
                    - text: Prestadores
                - img
            - heading "04 Posso me tornar um prestador no Severinno? Prestadores" [level=3] [ref=e972]:
              - button "04 Posso me tornar um prestador no Severinno? Prestadores" [ref=e973]:
                - generic [ref=e974]:
                  - generic [ref=e975]: "04"
                  - generic [ref=e976]: Posso me tornar um prestador no Severinno?
                  - generic [ref=e977]:
                    - img
                    - text: Prestadores
                - img
            - heading "05 Como faço para agendar um serviço? Agendamento" [level=3] [ref=e980]:
              - button "05 Como faço para agendar um serviço? Agendamento" [ref=e981]:
                - generic [ref=e982]:
                  - generic [ref=e983]: "05"
                  - generic [ref=e984]: Como faço para agendar um serviço?
                  - generic [ref=e985]:
                    - img
                    - text: Agendamento
                - img
            - heading "06 Posso remarcar ou cancelar um agendamento? Agendamento" [level=3] [ref=e988]:
              - button "06 Posso remarcar ou cancelar um agendamento? Agendamento" [ref=e989]:
                - generic [ref=e990]:
                  - generic [ref=e991]: "06"
                  - generic [ref=e992]: Posso remarcar ou cancelar um agendamento?
                  - generic [ref=e993]:
                    - img
                    - text: Agendamento
                - img
            - heading "07 Como funciona o pagamento? Pagamento" [level=3] [ref=e996]:
              - button "07 Como funciona o pagamento? Pagamento" [ref=e997]:
                - generic [ref=e998]:
                  - generic [ref=e999]: "07"
                  - generic [ref=e1000]: Como funciona o pagamento?
                  - generic [ref=e1001]:
                    - img
                    - text: Pagamento
                - img
            - heading "08 O orçamento tem compromisso? Pagamento" [level=3] [ref=e1004]:
              - button "08 O orçamento tem compromisso? Pagamento" [ref=e1005]:
                - generic [ref=e1006]:
                  - generic [ref=e1007]: "08"
                  - generic [ref=e1008]: O orçamento tem compromisso?
                  - generic [ref=e1009]:
                    - img
                    - text: Pagamento
                - img
            - heading "09 E se o serviço não for bem-feito? Segurança" [level=3] [ref=e1012]:
              - button "09 E se o serviço não for bem-feito? Segurança" [ref=e1013]:
                - generic [ref=e1014]:
                  - generic [ref=e1015]: "09"
                  - generic [ref=e1016]: E se o serviço não for bem-feito?
                  - generic [ref=e1017]:
                    - img
                    - text: Segurança
                - img
            - heading "10 Meus dados pessoais estão seguros? Segurança" [level=3] [ref=e1020]:
              - button "10 Meus dados pessoais estão seguros? Segurança" [ref=e1021]:
                - generic [ref=e1022]:
                  - generic [ref=e1023]: "10"
                  - generic [ref=e1024]: Meus dados pessoais estão seguros?
                  - generic [ref=e1025]:
                    - img
                    - text: Segurança
                - img
          - generic [ref=e1026]:
            - paragraph [ref=e1027]: 10 de 10 dúvidas
            - button "Voltar ao topo da seção" [ref=e1028]:
              - img [ref=e1029]
              - text: Topo
      - generic [ref=e1033]:
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
        - generic [ref=e1038]:
          - generic [ref=e1039]:
            - generic [ref=e1041]:
              - img [ref=e1042]
              - text: Comece agora mesmo
            - heading "Pronto para encontrar o prestador ideal?" [level=2] [ref=e1044]
            - paragraph [ref=e1045]: Comece em 30 segundos — é como pedir um Uber, mas para serviços. Cadastre-se gratuitamente e tenha acesso a prestadores verificados.
            - generic [ref=e1046]:
              - button "Para clientes" [ref=e1047]: Para clientes
              - button "Para prestadores" [ref=e1049]
            - list [ref=e1050]:
              - generic [ref=e1051]:
                - listitem [ref=e1052]:
                  - img [ref=e1053]
                  - text: Cadastro gratuito
                - listitem [ref=e1056]:
                  - img [ref=e1057]
                  - text: Sem taxa de serviço
                - listitem [ref=e1060]:
                  - img [ref=e1061]
                  - text: Orçamento sem compromisso
            - generic [ref=e1064]:
              - button "Cadastrar grátis" [ref=e1069]:
                - text: Cadastrar grátis
                - generic [ref=e1070]:
                  - img
              - button "Sou prestador" [ref=e1072]:
                - img
                - text: Sou prestador
            - generic [ref=e1073]:
              - img [ref=e1074]
              - text: Comece em 30 segundos
            - button "Já tenho conta · Entrar" [ref=e1078]:
              - img [ref=e1079]
              - text: Já tenho conta · Entrar
            - generic [ref=e1082]:
              - generic [ref=e1083]:
                - generic [ref=e1084]: AL
                - generic [ref=e1085]: RM
                - generic [ref=e1086]: JS
                - generic [ref=e1087]: PF
                - generic [ref=e1088]: CM
                - generic [ref=e1089]: "+5"
              - generic [ref=e1090]:
                - paragraph [ref=e1091]: 527+ cadastrados
                - paragraph [ref=e1092]: na plataforma
          - generic [ref=e1093]:
            - generic [ref=e1094]:
              - heading "O que vem depois?" [level=3] [ref=e1095]
              - paragraph [ref=e1096]: Três passos simples e você estará agendando
              - generic [ref=e1097]:
                - img [ref=e1098]
                - generic [ref=e1099]:
                  - generic [ref=e1100]:
                    - generic [ref=e1102]: "1"
                    - generic [ref=e1103]:
                      - paragraph [ref=e1104]: Cadastre-se grátis
                      - paragraph [ref=e1105]: ~30s
                  - generic [ref=e1106]:
                    - generic [ref=e1108]: "2"
                    - generic [ref=e1109]:
                      - paragraph [ref=e1110]: Busque e compare
                      - paragraph [ref=e1111]: ~2 min
                  - generic [ref=e1112]:
                    - generic [ref=e1114]: "3"
                    - generic [ref=e1115]:
                      - paragraph [ref=e1116]: Agende com confiança
                      - paragraph [ref=e1117]: ~5 min
              - generic [ref=e1118]:
                - generic [ref=e1119]:
                  - img [ref=e1120]
                  - text: Sem compromisso
                - generic [ref=e1124]:
                  - img [ref=e1125]
                  - text: Cancele quando quiser
                - generic [ref=e1128]:
                  - img [ref=e1129]
                  - text: Suporte 24h
              - link "Saiba mais sobre pagamento protegido" [ref=e1132] [cursor=pointer]:
                - /url: "#faq"
                - img [ref=e1133]
                - text: Saiba mais sobre pagamento protegido
            - generic [ref=e1137]:
              - generic [ref=e1141]: Cliente
              - generic [ref=e1142]:
                - img [ref=e1146]
                - generic [ref=e1148]: Prestador
              - img [ref=e1153]
              - img [ref=e1155]
              - img [ref=e1159]
              - img [ref=e1162]
              - img [ref=e1166]
        - generic [ref=e1170]:
          - img [ref=e1171]
          - generic [ref=e1174]:
            - paragraph [ref=e1175]: “Encontrei um encanador em 10 minutos, paguei menos do que esperava e ainda pude avaliar o serviço. Recomendo demais!”
            - paragraph [ref=e1176]: — Ana P., Cliente, São Paulo
        - generic [ref=e1177]:
          - generic [ref=e1178]:
            - img [ref=e1179]
            - text: Sem compromisso
          - generic [ref=e1183]:
            - img [ref=e1184]
            - text: Cancele quando quiser
          - generic [ref=e1187]:
            - img [ref=e1188]
            - text: Pagamento protegido
    - contentinfo [ref=e1190]:
      - generic [ref=e1192]:
        - generic [ref=e1193]:
          - paragraph [ref=e1194]: Receba novidades e dicas de serviços
          - paragraph [ref=e1195]: Cadastre-se e receba ofertas exclusivas. Cancele quando quiser.
        - generic [ref=e1196]:
          - generic [ref=e1197]:
            - img [ref=e1198]
            - textbox "E-mail para newsletter" [ref=e1201]:
              - /placeholder: Seu e-mail
          - button "Assinar" [disabled]:
            - img
            - text: Assinar
      - generic [ref=e1202]:
        - generic [ref=e1203]:
          - generic [ref=e1204]:
            - generic [ref=e1205]:
              - img [ref=e1207]
              - generic [ref=e1210]: Severinno
            - paragraph [ref=e1211]: Marketplace de serviços com geolocalização. Encontre prestadores verificados, próximos e bem avaliados.
            - list "Redes sociais" [ref=e1212]:
              - listitem [ref=e1213]:
                - link "GitHub" [ref=e1214] [cursor=pointer]:
                  - /url: https://github.com
                  - img [ref=e1215]
              - listitem [ref=e1218]:
                - link "Twitter" [ref=e1219] [cursor=pointer]:
                  - /url: https://twitter.com
                  - img [ref=e1220]
              - listitem [ref=e1222]:
                - link "Instagram" [ref=e1223] [cursor=pointer]:
                  - /url: https://instagram.com
                  - img [ref=e1224]
              - listitem [ref=e1227]:
                - link "LinkedIn" [ref=e1228] [cursor=pointer]:
                  - /url: https://linkedin.com
                  - img [ref=e1229]
              - listitem [ref=e1233]:
                - link "E-mail" [ref=e1234] [cursor=pointer]:
                  - /url: mailto:contato@severinno.com
                  - img [ref=e1235]
          - navigation "Sobre" [ref=e1238]:
            - heading "Sobre" [level=3] [ref=e1239]:
              - img [ref=e1240]
              - text: Sobre
            - list [ref=e1243]:
              - listitem [ref=e1244]:
                - button "Como funciona" [ref=e1245]
              - listitem [ref=e1246]:
                - button "Quem somos" [ref=e1247]
              - listitem [ref=e1248]:
                - button "Termos de uso" [ref=e1249]
              - listitem [ref=e1250]:
                - button "Privacidade" [ref=e1251]
          - navigation "Para profissionais" [ref=e1252]:
            - heading "Para profissionais" [level=3] [ref=e1253]:
              - img [ref=e1254]
              - text: Para profissionais
            - list [ref=e1257]:
              - listitem [ref=e1258]:
                - button "Cadastre-se" [ref=e1259]
              - listitem [ref=e1260]:
                - button "Meu painel" [ref=e1261]
              - listitem [ref=e1262]:
                - button "Central de ajuda" [ref=e1263]
          - navigation "Precisa de ajuda?" [ref=e1264]:
            - heading "Precisa de ajuda?" [level=3] [ref=e1265]:
              - img [ref=e1266]
              - text: Precisa de ajuda?
            - list [ref=e1268]:
              - listitem [ref=e1269]:
                - button "Perguntas frequentes" [ref=e1270]
              - listitem [ref=e1271]:
                - button "Segurança" [ref=e1272]
              - listitem [ref=e1273]:
                - button "Reportar problema" [ref=e1274]
          - generic [ref=e1275]:
            - heading "Contato" [level=3] [ref=e1276]:
              - img [ref=e1277]
              - text: Contato
            - list [ref=e1282]:
              - listitem [ref=e1283]:
                - img [ref=e1284]
                - link "contato@severinno.com" [ref=e1287] [cursor=pointer]:
                  - /url: mailto:contato@severinno.com
              - listitem [ref=e1288]:
                - img [ref=e1289]
                - text: São Paulo, Brasil
            - button "Fale conosco" [ref=e1292]:
              - img
              - text: Fale conosco
        - generic [ref=e1293]:
          - paragraph [ref=e1294]: © 2026 Severinno Marketplace. Todos os direitos reservados.
          - paragraph [ref=e1295]:
            - text: Feito com
            - img [ref=e1296]
            - text: usando tecnologia Open Source (
            - link "MapLibre" [ref=e1298] [cursor=pointer]:
              - /url: https://maplibre.org/
            - text: ·
            - link "OpenStreetMap" [ref=e1299] [cursor=pointer]:
              - /url: https://www.openstreetmap.org/copyright
            - text: )
      - button "Voltar ao topo" [ref=e1300]:
        - img [ref=e1301]
    - button "Voltar ao topo" [ref=e1304]:
      - img
    - button "Abrir assistente virtual" [ref=e1305]:
      - img [ref=e1306]
    - generic [ref=e1310]:
      - generic [ref=e1311]:
        - img [ref=e1313]
        - generic [ref=e1315]:
          - paragraph [ref=e1316]: Usamos cookies para melhorar sua experiência
          - paragraph [ref=e1317]:
            - text: Utilizamos cookies essenciais para o funcionamento do site e cookies de análise para melhorar nossos serviços.
            - button "Política de privacidade" [ref=e1318]
      - generic [ref=e1319]:
        - button "Recusar" [ref=e1320]
        - button "Aceitar" [ref=e1321]:
          - img
          - text: Aceitar
        - button "Dispensar" [ref=e1322]:
          - img [ref=e1323]
  - region "Notifications alt+T"
  - generic [active]:
    - generic [ref=e1328]:
      - generic [ref=e1329]:
        - generic [ref=e1330]:
          - navigation [ref=e1331]:
            - button "previous" [disabled] [ref=e1332]:
              - img "previous" [ref=e1333]
            - generic [ref=e1335]:
              - generic [ref=e1336]: 1/
              - text: "1"
            - button "next" [disabled] [ref=e1337]:
              - img "next" [ref=e1338]
          - img
        - generic [ref=e1340]:
          - link "Next.js 16.1.3 (stale) Turbopack" [ref=e1341] [cursor=pointer]:
            - /url: https://nextjs.org/docs/messages/version-staleness
            - img [ref=e1342]
            - generic "There is a newer version (16.2.11) available, upgrade recommended!" [ref=e1344]: Next.js 16.1.3 (stale)
            - generic [ref=e1345]: Turbopack
          - img
      - dialog "Build Error" [ref=e1347]:
        - generic [ref=e1350]:
          - generic [ref=e1351]:
            - generic [ref=e1352]:
              - generic [ref=e1354]: Build Error
              - generic [ref=e1355]:
                - button "Copy Error Info" [ref=e1356] [cursor=pointer]:
                  - img [ref=e1357]
                - button "No related documentation found" [disabled] [ref=e1359]:
                  - img [ref=e1360]
                - button "Attach Node.js inspector" [ref=e1362] [cursor=pointer]:
                  - img [ref=e1363]
            - generic [ref=e1372]: Reading source code for parsing failed
          - generic [ref=e1374]:
            - generic [ref=e1376]:
              - img [ref=e1378]
              - generic [ref=e1382]: ./.freebuff/worktrees/thmrzp9vv9y86o/src/lib/api-server.ts
              - button "Open in editor" [ref=e1383] [cursor=pointer]:
                - img [ref=e1385]
            - generic [ref=e1389]: "Reading source code for parsing failed An unexpected error happened while trying to read the source code to parse: failed to convert rope into string Caused by: - invalid utf-8 sequence of 1 bytes from index 5415 Import trace: App Route: ./.freebuff/worktrees/thmrzp9vv9y86o/src/lib/api-server.ts ./.freebuff/worktrees/thmrzp9vv9y86o/src/app/api/auth/me/route.ts"
        - generic [ref=e1390]: "1"
        - generic [ref=e1391]: "2"
    - generic [ref=e1396] [cursor=pointer]:
      - button "Open Next.js Dev Tools" [ref=e1397]:
        - img [ref=e1398]
      - button "Open issues overlay" [ref=e1402]:
        - generic [ref=e1403]:
          - generic [ref=e1404]: "0"
          - generic [ref=e1405]: "1"
        - generic [ref=e1406]: Issue
  - alert [ref=e1407]
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