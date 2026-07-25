# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: quote-response.spec.ts >> Quote Response — Cliente aprova orcamento respondido >> 4. registra como cliente e ve orcamento respondido
- Location: e2e\quote-response.spec.ts:242:7

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.fill: Test timeout of 30000ms exceeded.
Call log:
  - waiting for getByPlaceholder(/nome/i).first()

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
              - button "Ver 0 resultados" [disabled]
          - generic [ref=e300]:
            - generic [ref=e302]:
              - generic [ref=e303]:
                - heading "0 prestadores encontrados" [level=2] [ref=e304]
                - paragraph [ref=e305]: Exibindo 0–0 de 0
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
              - img [ref=e320]
              - heading "Algo deu errado" [level=3] [ref=e323]
              - paragraph [ref=e324]: Não foi possível carregar os prestadores. Verifique sua conexão e tente novamente.
              - button "Tentar novamente" [ref=e325]
      - region "Como funciona" [ref=e326]:
        - generic [ref=e331]:
          - generic [ref=e332]:
            - link "Pular para resultados" [ref=e333] [cursor=pointer]:
              - /url: "#vitrine-resultados"
              - img [ref=e334]
              - text: Pular para resultados
            - generic [ref=e338]:
              - img [ref=e339]
              - generic [ref=e341]: "4"
              - text: passos simples
            - heading "Como funciona" [level=2] [ref=e342]
            - paragraph [ref=e343]: Sem surpresas — do início ao fim, você tem o controle.
            - generic [ref=e344]:
              - img [ref=e345]
              - text: Sem compromisso
          - generic [ref=e351]:
            - img [ref=e353]
            - generic [ref=e354]:
              - 'button "1 Busque o serviço Encontre prestadores verificados perto de você. 50 + categorias encanador em São Paulo | Verificados < 5 km Mais filtros Ex: Busque ''encanador em São Paulo'' Buscar prestadores" [ref=e355] [cursor=pointer]':
                - generic [ref=e357]:
                  - generic [ref=e359]: "1"
                  - img [ref=e362]
                  - heading "Busque o serviço" [level=3] [ref=e365]
                  - paragraph [ref=e366]: Encontre prestadores verificados perto de você.
                  - generic [ref=e368]:
                    - generic [ref=e369]: "50"
                    - text: +
                    - generic [ref=e370]: categorias
                  - generic [ref=e372]:
                    - generic [ref=e373]:
                      - img [ref=e374]
                      - generic [ref=e377]: encanador em São Paulo
                      - generic [ref=e378]: "|"
                    - generic [ref=e379]:
                      - generic [ref=e380]: Verificados
                      - generic [ref=e381]: < 5 km
                      - generic [ref=e382]:
                        - img [ref=e383]
                        - text: Mais filtros
                  - paragraph [ref=e385]: "Ex: Busque 'encanador em São Paulo'"
                  - button "Buscar prestadores" [ref=e386]:
                    - text: Buscar prestadores
                    - img
              - 'button "2 Compare orçamentos Receba e compare propostas lado a lado. 3 orçamentos em 24h João S. R$ 180 Maria L. R$ 150 Melhor avaliação Compare lado a lado Ex: Compare 3 orçamentos em 24h Sem compromisso Pedir orçamento" [ref=e387] [cursor=pointer]':
                - generic [ref=e389]:
                  - generic [ref=e391]: "2"
                  - img [ref=e394]
                  - heading "Compare orçamentos" [level=3] [ref=e399]
                  - paragraph [ref=e400]: Receba e compare propostas lado a lado.
                  - generic [ref=e402]:
                    - generic [ref=e403]: "3"
                    - generic [ref=e404]: orçamentos em 24h
                  - generic [ref=e406]:
                    - generic [ref=e407]:
                      - generic [ref=e408]:
                        - generic [ref=e411]: João S.
                        - generic [ref=e412]:
                          - img [ref=e413]
                          - img [ref=e415]
                          - img [ref=e417]
                          - img [ref=e419]
                          - img [ref=e421]
                        - generic [ref=e423]: R$ 180
                      - generic [ref=e424]:
                        - generic [ref=e427]: Maria L.
                        - generic [ref=e428]:
                          - img [ref=e429]
                          - img [ref=e431]
                          - img [ref=e433]
                          - img [ref=e435]
                          - img [ref=e437]
                        - generic [ref=e439]: R$ 150
                        - generic [ref=e440]: Melhor avaliação
                    - generic [ref=e441]:
                      - img [ref=e442]
                      - text: Compare lado a lado
                  - paragraph [ref=e447]: "Ex: Compare 3 orçamentos em 24h"
                  - generic [ref=e448]:
                    - img [ref=e449]
                    - text: Sem compromisso
                  - button "Pedir orçamento" [ref=e454]:
                    - text: Pedir orçamento
                    - img
              - 'button "3 Agende com confiança Solicite um orçamento ou agende diretamente. 24 h para confirmar Março 2025 S T Q Q S S D 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 12 Mar, 14:00 — Confirmado Ex: Agende para amanhã às 14h Agendar agora" [ref=e455] [cursor=pointer]':
                - generic [ref=e457]:
                  - generic [ref=e459]: "3"
                  - img [ref=e462]
                  - heading "Agende com confiança" [level=3] [ref=e465]
                  - paragraph [ref=e466]: Solicite um orçamento ou agende diretamente.
                  - generic [ref=e468]:
                    - generic [ref=e469]: "24"
                    - text: h
                    - generic [ref=e470]: para confirmar
                  - generic [ref=e473]:
                    - generic [ref=e474]: Março 2025
                    - generic [ref=e475]:
                      - generic [ref=e476]: S
                      - generic [ref=e477]: T
                      - generic [ref=e478]: Q
                      - generic [ref=e479]: Q
                      - generic [ref=e480]: S
                      - generic [ref=e481]: S
                      - generic [ref=e482]: D
                      - generic [ref=e483]: "1"
                      - generic [ref=e484]: "2"
                      - generic [ref=e485]: "3"
                      - generic [ref=e486]: "4"
                      - generic [ref=e487]: "5"
                      - generic [ref=e488]: "6"
                      - generic [ref=e489]: "7"
                      - generic [ref=e490]: "8"
                      - generic [ref=e491]: "9"
                      - generic [ref=e492]: "10"
                      - generic [ref=e493]: "11"
                      - generic [ref=e494]: "12"
                      - generic [ref=e495]: "13"
                      - generic [ref=e496]: "14"
                      - generic [ref=e497]: "15"
                    - generic [ref=e498]:
                      - img [ref=e499]
                      - generic [ref=e502]: 12 Mar, 14:00 — Confirmado
                  - paragraph [ref=e503]: "Ex: Agende para amanhã às 14h"
                  - button "Agendar agora" [ref=e504]:
                    - text: Agendar agora
                    - img
              - 'button "4 Avalie o resultado Sua opinião mantém a qualidade da comunidade. 98 % satisfação 4.0 \"Excelente trabalho, recomendo!\" Avaliação verificada Ex: Avalie de 1 a 5 estrelas com comentário Cadastrar grátis" [ref=e505] [cursor=pointer]':
                - generic [ref=e507]:
                  - generic [ref=e509]: "4"
                  - img [ref=e512]
                  - heading "Avalie o resultado" [level=3] [ref=e514]
                  - paragraph [ref=e515]: Sua opinião mantém a qualidade da comunidade.
                  - generic [ref=e517]:
                    - generic [ref=e518]: "98"
                    - text: "%"
                    - generic [ref=e519]: satisfação
                  - generic [ref=e521]:
                    - generic [ref=e522]:
                      - generic [ref=e523]:
                        - img [ref=e524]
                        - img [ref=e526]
                        - img [ref=e528]
                        - img [ref=e530]
                        - img [ref=e532]
                        - generic [ref=e534]: "4.0"
                      - paragraph [ref=e537]: "\"Excelente trabalho, recomendo!\""
                    - generic [ref=e538]:
                      - img [ref=e539]
                      - text: Avaliação verificada
                  - paragraph [ref=e542]: "Ex: Avalie de 1 a 5 estrelas com comentário"
                  - button "Cadastrar grátis" [ref=e543]:
                    - text: Cadastrar grátis
                    - img
          - generic [ref=e544]:
            - generic [ref=e545]:
              - img [ref=e546]
              - generic [ref=e549]: Garantia Severinno
            - generic [ref=e550]:
              - generic [ref=e551]:
                - img [ref=e552]
                - generic [ref=e555]: Prestadores verificados
              - generic [ref=e556]:
                - img [ref=e557]
                - generic [ref=e560]: Resposta rápida
              - generic [ref=e561]:
                - img [ref=e562]
                - generic [ref=e564]: Satisfação garantida
              - generic [ref=e565]:
                - img [ref=e566]
                - generic [ref=e571]: Compare antes de contratar
          - generic [ref=e572]:
            - button "Começar agora" [ref=e573]:
              - text: Começar agora
              - img
            - link "Buscar prestadores" [ref=e574] [cursor=pointer]:
              - /url: "#vitrine-resultados"
              - img
              - text: Buscar prestadores
          - button "Voltar ao topo" [ref=e576]:
            - img [ref=e577]
            - text: Voltar ao topo
      - generic [ref=e580]:
        - generic [ref=e581]:
          - generic [ref=e582]:
            - img
            - text: Simulador de preços
          - heading "Quanto custa? Simule agora" [level=2] [ref=e583]
          - paragraph [ref=e584]: Estime o valor do serviço em 3 passos rápidos. Sem compromisso, sem cadastro.
        - generic [ref=e585]:
          - generic [ref=e586]: "1"
          - generic [ref=e588]: "2"
          - generic [ref=e590]: "3"
        - generic [ref=e593]:
          - heading "1. Qual serviço você precisa?" [level=3] [ref=e594]
          - paragraph [ref=e595]: Selecione a categoria do serviço
          - generic [ref=e596]:
            - button "Elétrica" [ref=e597]:
              - img [ref=e599]
              - generic [ref=e601]: Elétrica
            - button "Hidráulica" [ref=e602]:
              - img [ref=e604]
              - generic [ref=e607]: Hidráulica
            - button "Pintura" [ref=e608]:
              - img [ref=e610]
              - generic [ref=e614]: Pintura
            - button "Alvenaria" [ref=e615]:
              - img [ref=e617]
              - generic [ref=e619]: Alvenaria
            - button "Pisos" [ref=e620]:
              - img [ref=e622]
              - generic [ref=e624]: Pisos
            - button "Pós-obra" [ref=e625]:
              - img [ref=e627]
              - generic [ref=e632]: Pós-obra
            - button "Residencial" [ref=e633]:
              - img [ref=e635]
              - generic [ref=e638]: Residencial
      - region "Parceiros e imprensa" [ref=e639]:
        - generic [ref=e640]:
          - paragraph [ref=e642]: Referência no mercado
          - generic [ref=e644]:
            - generic [ref=e647]: G1
            - generic [ref=e650]: Folha de S.Paulo
            - generic [ref=e653]: Valor Econômico
            - generic [ref=e656]: Exame
            - generic [ref=e659]: InfoMoney
            - generic [ref=e662]: Startups
            - generic [ref=e665]: Sebrae
            - generic [ref=e668]: ABES
          - paragraph [ref=e669]: + de 6.000 prestadores confiam no Severinno
      - region "Avaliações de clientes" [ref=e670]:
        - generic:
          - generic:
            - img
        - generic [ref=e672]:
          - generic [ref=e673]:
            - img [ref=e674]
            - text: Avaliações reais
          - heading "O que nossos clientes dizem" [level=2] [ref=e676]
          - paragraph [ref=e677]: Avaliações de clientes após a conclusão do serviço.
      - generic [ref=e742]:
        - generic [ref=e745]:
          - generic [ref=e746]:
            - img [ref=e748]
            - generic [ref=e753]: "0"
            - paragraph [ref=e754]: Prestadores verificados
          - generic [ref=e755]:
            - img [ref=e757]
            - generic [ref=e759]: "0"
            - paragraph [ref=e760]: Serviços cadastrados
          - generic [ref=e761]:
            - img [ref=e763]
            - generic [ref=e766]: "0"
            - paragraph [ref=e767]: Serviços concluídos
          - generic [ref=e768]:
            - img [ref=e770]
            - generic [ref=e773]: 0.0/5
            - paragraph [ref=e774]: Nota média
        - generic [ref=e776]:
          - generic [ref=e777]:
            - generic [ref=e778]:
              - img [ref=e779]
              - text: Por que Severinno?
            - heading "Confiança em cada agendamento" [level=2] [ref=e782]
            - paragraph [ref=e783]: Mais que um diretório de serviços — um ecossistema pensado para proteger você e o prestador. Da verificação ao pagamento, cada etapa foi desenhada para a sua tranquilidade.
            - link "Pular para FAQ" [ref=e785] [cursor=pointer]:
              - /url: "#faq"
              - img [ref=e786]
              - text: Pular para FAQ
          - generic [ref=e789]:
            - generic [ref=e792]:
              - generic [ref=e793]:
                - img [ref=e795]
                - button "Saiba mais sobre Prestadores verificados" [ref=e798]:
                  - img [ref=e799]
              - heading "Prestadores verificados" [level=3] [ref=e802]
              - paragraph [ref=e803]: João verificou 3 documentos antes de aprovar o prestador. Você só vê profissionais validados.
              - button "Saiba mais" [ref=e804]:
                - text: Saiba mais
                - img [ref=e805]
            - generic [ref=e809]:
              - generic [ref=e810]:
                - img [ref=e812]
                - button "Saiba mais sobre Pagamento protegido" [ref=e815]:
                  - img [ref=e816]
              - heading "Pagamento protegido" [level=3] [ref=e819]
              - paragraph [ref=e820]: O valor só é liberado ao prestador após você confirmar que ficou satisfeito com o serviço.
              - button "Saiba mais" [ref=e821]:
                - text: Saiba mais
                - img [ref=e822]
            - generic [ref=e826]:
              - generic [ref=e827]:
                - img [ref=e829]
                - button "Saiba mais sobre Resposta rápida" [ref=e832]:
                  - img [ref=e833]
              - heading "Resposta rápida" [level=3] [ref=e836]
              - paragraph [ref=e837]: Prestadores comprometidos a responder em até 24h. Acompanhe o status em tempo real.
              - button "Saiba mais" [ref=e838]:
                - text: Saiba mais
                - img [ref=e839]
            - generic [ref=e843]:
              - generic [ref=e844]:
                - img [ref=e846]
                - button "Saiba mais sobre Avaliações reais" [ref=e848]:
                  - img [ref=e849]
              - heading "Avaliações reais" [level=3] [ref=e852]
              - paragraph [ref=e853]: Apenas clientes que concluíram o serviço podem avaliar. Sem falsas avaliações.
              - button "Saiba mais" [ref=e854]:
                - text: Saiba mais
                - img [ref=e855]
            - generic [ref=e859]:
              - generic [ref=e860]:
                - img [ref=e862]
                - button "Saiba mais sobre Próximo de você" [ref=e865]:
                  - img [ref=e866]
              - heading "Próximo de você" [level=3] [ref=e869]
              - paragraph [ref=e870]: Geolocalização inteligente mostra os melhores prestadores na sua região.
              - button "Saiba mais" [ref=e871]:
                - text: Saiba mais
                - img [ref=e872]
            - generic [ref=e876]:
              - generic [ref=e877]:
                - img [ref=e879]
                - button "Saiba mais sobre Suporte humano" [ref=e881]:
                  - img [ref=e882]
              - heading "Suporte humano" [level=3] [ref=e885]
              - paragraph [ref=e886]: Equipe disponível para mediar disputas, tirar dúvidas e garantir uma experiência justa.
              - button "Saiba mais" [ref=e887]:
                - text: Saiba mais
                - img [ref=e888]
        - generic [ref=e891]:
          - img [ref=e892]
          - paragraph [ref=e894]: "Garantia Severinno: seu dinheiro de volta se o serviço não for bem-feito."
          - link "Saiba mais" [ref=e895] [cursor=pointer]:
            - /url: "#faq"
            - text: Saiba mais
            - img [ref=e896]
      - generic [ref=e899]:
        - generic [ref=e900]:
          - generic [ref=e901]:
            - img [ref=e902]
            - text: Destaque da semana
          - heading "Profissional em destaque" [level=2] [ref=e908]
          - paragraph [ref=e909]: Conheça um dos nossos prestadores mais bem avaliados.
        - generic [ref=e910]:
          - img [ref=e911]
          - paragraph [ref=e914]: Nenhum prestador em destaque no momento.
          - paragraph [ref=e915]: Cadastre-se como prestador e apareça aqui!
      - generic [ref=e919]:
        - generic [ref=e920]:
          - generic [ref=e921]:
            - generic [ref=e922]:
              - img [ref=e923]
              - text: Perguntas frequentes
            - heading "Tire suas dúvidas antes de contratar" [level=2] [ref=e926]
            - paragraph [ref=e927]: Reunimos as perguntas mais comuns sobre como o Severinno funciona — do cadastro ao pagamento.
          - generic [ref=e928]:
            - img [ref=e929]
            - textbox "Buscar nas perguntas frequentes" [ref=e932]:
              - /placeholder: Buscar nas dúvidas…
          - generic [ref=e933]:
            - paragraph [ref=e934]: Filtrar por categoria
            - generic [ref=e935]:
              - button "Filtrar por Geral" [ref=e936]:
                - img [ref=e937]
                - text: Geral
                - generic [ref=e940]: (2)
              - button "Filtrar por Pagamento" [ref=e941]:
                - img [ref=e942]
                - text: Pagamento
                - generic [ref=e944]: (2)
              - button "Filtrar por Agendamento" [ref=e945]:
                - img [ref=e946]
                - text: Agendamento
                - generic [ref=e948]: (2)
              - button "Filtrar por Prestadores" [ref=e949]:
                - img [ref=e950]
                - text: Prestadores
                - generic [ref=e954]: (2)
              - button "Filtrar por Segurança" [ref=e955]:
                - img [ref=e956]
                - text: Segurança
                - generic [ref=e959]: (2)
          - generic [ref=e960]:
            - paragraph [ref=e961]: Perguntas mais frequentes
            - list [ref=e962]:
              - listitem [ref=e963]:
                - button "Como funciona o Severinno?" [ref=e964]:
                  - img [ref=e965]
                  - generic [ref=e967]: Como funciona o Severinno?
              - listitem [ref=e968]:
                - button "Preciso pagar para me cadastrar?" [ref=e969]:
                  - img [ref=e970]
                  - generic [ref=e972]: Preciso pagar para me cadastrar?
              - listitem [ref=e973]:
                - button "Como faço para agendar um serviço?" [ref=e974]:
                  - img [ref=e975]
                  - generic [ref=e977]: Como faço para agendar um serviço?
              - listitem [ref=e978]:
                - button "E se o serviço não for bem-feito?" [ref=e979]:
                  - img [ref=e980]
                  - generic [ref=e982]: E se o serviço não for bem-feito?
          - generic [ref=e984]:
            - img [ref=e986]
            - generic [ref=e988]:
              - paragraph [ref=e989]: Ainda tem dúvidas?
              - paragraph [ref=e990]: Cadastre-se grátis e converse diretamente com prestadores verificados. Sem compromisso.
              - generic [ref=e991]:
                - button "Cadastrar grátis" [ref=e992]
                - link "Fale conosco" [ref=e993] [cursor=pointer]:
                  - /url: "#faq"
                  - img
                  - text: Fale conosco
        - generic [ref=e994]:
          - generic [ref=e996]:
            - generic [ref=e998]:
              - heading "01 Como funciona o Severinno? Geral" [level=3] [ref=e999]:
                - button "01 Como funciona o Severinno? Geral" [expanded] [ref=e1000]:
                  - generic [ref=e1001]:
                    - generic [ref=e1002]: "01"
                    - generic [ref=e1003]: Como funciona o Severinno?
                    - generic [ref=e1004]:
                      - img
                      - text: Geral
                  - img
              - region "01 Como funciona o Severinno? Geral" [ref=e1005]:
                - generic [ref=e1007]:
                  - paragraph [ref=e1008]: O Severinno conecta você a prestadores de serviço verificados próximos à sua localização. Você busca o serviço, compara avaliações reais de outros clientes, pede orçamento grátis e agenda — tudo pela plataforma. O pagamento só é liberado após você confirmar a conclusão do serviço.
                  - paragraph [ref=e1009]: "Ex: Maria precisava de um eletricista. Buscou na plataforma, comparou 3 profissionais e contratou o mais bem avaliado — tudo em 5 minutos."
            - heading "02 Preciso pagar para me cadastrar? Geral" [level=3] [ref=e1012]:
              - button "02 Preciso pagar para me cadastrar? Geral" [ref=e1013]:
                - generic [ref=e1014]:
                  - generic [ref=e1015]: "02"
                  - generic [ref=e1016]: Preciso pagar para me cadastrar?
                  - generic [ref=e1017]:
                    - img
                    - text: Geral
                - img
            - heading "03 Como os prestadores são verificados? Prestadores" [level=3] [ref=e1020]:
              - button "03 Como os prestadores são verificados? Prestadores" [ref=e1021]:
                - generic [ref=e1022]:
                  - generic [ref=e1023]: "03"
                  - generic [ref=e1024]: Como os prestadores são verificados?
                  - generic [ref=e1025]:
                    - img
                    - text: Prestadores
                - img
            - heading "04 Posso me tornar um prestador no Severinno? Prestadores" [level=3] [ref=e1028]:
              - button "04 Posso me tornar um prestador no Severinno? Prestadores" [ref=e1029]:
                - generic [ref=e1030]:
                  - generic [ref=e1031]: "04"
                  - generic [ref=e1032]: Posso me tornar um prestador no Severinno?
                  - generic [ref=e1033]:
                    - img
                    - text: Prestadores
                - img
            - heading "05 Como faço para agendar um serviço? Agendamento" [level=3] [ref=e1036]:
              - button "05 Como faço para agendar um serviço? Agendamento" [ref=e1037]:
                - generic [ref=e1038]:
                  - generic [ref=e1039]: "05"
                  - generic [ref=e1040]: Como faço para agendar um serviço?
                  - generic [ref=e1041]:
                    - img
                    - text: Agendamento
                - img
            - heading "06 Posso remarcar ou cancelar um agendamento? Agendamento" [level=3] [ref=e1044]:
              - button "06 Posso remarcar ou cancelar um agendamento? Agendamento" [ref=e1045]:
                - generic [ref=e1046]:
                  - generic [ref=e1047]: "06"
                  - generic [ref=e1048]: Posso remarcar ou cancelar um agendamento?
                  - generic [ref=e1049]:
                    - img
                    - text: Agendamento
                - img
            - heading "07 Como funciona o pagamento? Pagamento" [level=3] [ref=e1052]:
              - button "07 Como funciona o pagamento? Pagamento" [ref=e1053]:
                - generic [ref=e1054]:
                  - generic [ref=e1055]: "07"
                  - generic [ref=e1056]: Como funciona o pagamento?
                  - generic [ref=e1057]:
                    - img
                    - text: Pagamento
                - img
            - heading "08 O orçamento tem compromisso? Pagamento" [level=3] [ref=e1060]:
              - button "08 O orçamento tem compromisso? Pagamento" [ref=e1061]:
                - generic [ref=e1062]:
                  - generic [ref=e1063]: "08"
                  - generic [ref=e1064]: O orçamento tem compromisso?
                  - generic [ref=e1065]:
                    - img
                    - text: Pagamento
                - img
            - heading "09 E se o serviço não for bem-feito? Segurança" [level=3] [ref=e1068]:
              - button "09 E se o serviço não for bem-feito? Segurança" [ref=e1069]:
                - generic [ref=e1070]:
                  - generic [ref=e1071]: "09"
                  - generic [ref=e1072]: E se o serviço não for bem-feito?
                  - generic [ref=e1073]:
                    - img
                    - text: Segurança
                - img
            - heading "10 Meus dados pessoais estão seguros? Segurança" [level=3] [ref=e1076]:
              - button "10 Meus dados pessoais estão seguros? Segurança" [ref=e1077]:
                - generic [ref=e1078]:
                  - generic [ref=e1079]: "10"
                  - generic [ref=e1080]: Meus dados pessoais estão seguros?
                  - generic [ref=e1081]:
                    - img
                    - text: Segurança
                - img
          - generic [ref=e1082]:
            - paragraph [ref=e1083]: 10 de 10 dúvidas
            - button "Voltar ao topo da seção" [ref=e1084]:
              - img [ref=e1085]
              - text: Topo
      - generic [ref=e1089]:
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
        - generic [ref=e1094]:
          - generic [ref=e1095]:
            - generic [ref=e1097]:
              - img [ref=e1098]
              - text: Comece agora mesmo
            - heading "Encontre o serviço que você precisa" [level=2] [ref=e1100]
            - paragraph [ref=e1101]: Navegue pela vitrine, salve seus favoritos e agende com confiança. Tudo em um só lugar.
            - list [ref=e1102]:
              - generic [ref=e1103]:
                - listitem [ref=e1104]:
                  - img [ref=e1105]
                  - text: Cadastro gratuito
                - listitem [ref=e1108]:
                  - img [ref=e1109]
                  - text: Sem taxa de serviço
                - listitem [ref=e1112]:
                  - img [ref=e1113]
                  - text: Orçamento sem compromisso
            - button "Buscar prestadores" [ref=e1121]:
              - img
              - text: Buscar prestadores
              - generic [ref=e1122]:
                - img
          - generic [ref=e1123]:
            - generic [ref=e1124]:
              - heading "O que vem depois?" [level=3] [ref=e1125]
              - paragraph [ref=e1126]: Três passos simples e você estará agendando
              - generic [ref=e1127]:
                - img [ref=e1128]
                - generic [ref=e1129]:
                  - generic [ref=e1130]:
                    - generic [ref=e1132]: "1"
                    - generic [ref=e1133]:
                      - paragraph [ref=e1134]: Cadastre-se grátis
                      - paragraph [ref=e1135]: ~30s
                  - generic [ref=e1136]:
                    - generic [ref=e1138]: "2"
                    - generic [ref=e1139]:
                      - paragraph [ref=e1140]: Busque e compare
                      - paragraph [ref=e1141]: ~2 min
                  - generic [ref=e1142]:
                    - generic [ref=e1144]: "3"
                    - generic [ref=e1145]:
                      - paragraph [ref=e1146]: Agende com confiança
                      - paragraph [ref=e1147]: ~5 min
              - generic [ref=e1148]:
                - generic [ref=e1149]:
                  - img [ref=e1150]
                  - text: Sem compromisso
                - generic [ref=e1154]:
                  - img [ref=e1155]
                  - text: Cancele quando quiser
                - generic [ref=e1158]:
                  - img [ref=e1159]
                  - text: Suporte 24h
              - link "Saiba mais sobre pagamento protegido" [ref=e1162] [cursor=pointer]:
                - /url: "#faq"
                - img [ref=e1163]
                - text: Saiba mais sobre pagamento protegido
            - generic [ref=e1167]:
              - generic [ref=e1171]: Cliente
              - generic [ref=e1172]:
                - img [ref=e1176]
                - generic [ref=e1178]: Prestador
              - img [ref=e1183]
              - img [ref=e1185]
              - img [ref=e1189]
              - img [ref=e1192]
              - img [ref=e1196]
        - generic [ref=e1200]:
          - img [ref=e1201]
          - generic [ref=e1204]:
            - paragraph [ref=e1205]: “Encontrei um encanador em 10 minutos, paguei menos do que esperava e ainda pude avaliar o serviço. Recomendo demais!”
            - paragraph [ref=e1206]: — Ana P., Cliente, São Paulo
        - generic [ref=e1207]:
          - generic [ref=e1208]:
            - img [ref=e1209]
            - text: Sem compromisso
          - generic [ref=e1213]:
            - img [ref=e1214]
            - text: Cancele quando quiser
          - generic [ref=e1217]:
            - img [ref=e1218]
            - text: Pagamento protegido
    - contentinfo [ref=e1220]:
      - generic [ref=e1222]:
        - generic [ref=e1223]:
          - paragraph [ref=e1224]: Receba novidades e dicas de serviços
          - paragraph [ref=e1225]: Cadastre-se e receba ofertas exclusivas. Cancele quando quiser.
        - generic [ref=e1226]:
          - generic [ref=e1227]:
            - img [ref=e1228]
            - textbox "E-mail para newsletter" [ref=e1231]:
              - /placeholder: Seu e-mail
          - button "Assinar" [disabled]:
            - img
            - text: Assinar
      - generic [ref=e1232]:
        - generic [ref=e1233]:
          - generic [ref=e1234]:
            - generic [ref=e1235]:
              - img [ref=e1237]
              - generic [ref=e1240]: Severinno
            - paragraph [ref=e1241]: Marketplace de serviços com geolocalização. Encontre prestadores verificados, próximos e bem avaliados.
            - list "Redes sociais" [ref=e1242]:
              - listitem [ref=e1243]:
                - link "GitHub" [ref=e1244] [cursor=pointer]:
                  - /url: https://github.com
                  - img [ref=e1245]
              - listitem [ref=e1248]:
                - link "Twitter" [ref=e1249] [cursor=pointer]:
                  - /url: https://twitter.com
                  - img [ref=e1250]
              - listitem [ref=e1252]:
                - link "Instagram" [ref=e1253] [cursor=pointer]:
                  - /url: https://instagram.com
                  - img [ref=e1254]
              - listitem [ref=e1257]:
                - link "LinkedIn" [ref=e1258] [cursor=pointer]:
                  - /url: https://linkedin.com
                  - img [ref=e1259]
              - listitem [ref=e1263]:
                - link "E-mail" [ref=e1264] [cursor=pointer]:
                  - /url: mailto:contato@severinno.com
                  - img [ref=e1265]
          - navigation "Sobre" [ref=e1268]:
            - heading "Sobre" [level=3] [ref=e1269]:
              - img [ref=e1270]
              - text: Sobre
            - list [ref=e1273]:
              - listitem [ref=e1274]:
                - button "Como funciona" [ref=e1275]
              - listitem [ref=e1276]:
                - button "Quem somos" [ref=e1277]
              - listitem [ref=e1278]:
                - button "Termos de uso" [ref=e1279]
              - listitem [ref=e1280]:
                - button "Privacidade" [ref=e1281]
          - navigation "Para profissionais" [ref=e1282]:
            - heading "Para profissionais" [level=3] [ref=e1283]:
              - img [ref=e1284]
              - text: Para profissionais
            - list [ref=e1287]:
              - listitem [ref=e1288]:
                - button "Cadastre-se" [ref=e1289]
              - listitem [ref=e1290]:
                - button "Meu painel" [ref=e1291]
              - listitem [ref=e1292]:
                - button "Central de ajuda" [ref=e1293]
          - navigation "Precisa de ajuda?" [ref=e1294]:
            - heading "Precisa de ajuda?" [level=3] [ref=e1295]:
              - img [ref=e1296]
              - text: Precisa de ajuda?
            - list [ref=e1298]:
              - listitem [ref=e1299]:
                - button "Perguntas frequentes" [ref=e1300]
              - listitem [ref=e1301]:
                - button "Segurança" [ref=e1302]
              - listitem [ref=e1303]:
                - button "Reportar problema" [ref=e1304]
          - generic [ref=e1305]:
            - heading "Contato" [level=3] [ref=e1306]:
              - img [ref=e1307]
              - text: Contato
            - list [ref=e1312]:
              - listitem [ref=e1313]:
                - img [ref=e1314]
                - link "contato@severinno.com" [ref=e1317] [cursor=pointer]:
                  - /url: mailto:contato@severinno.com
              - listitem [ref=e1318]:
                - img [ref=e1319]
                - text: São Paulo, Brasil
            - button "Fale conosco" [ref=e1322]:
              - img
              - text: Fale conosco
        - generic [ref=e1323]:
          - paragraph [ref=e1324]: © 2026 Severinno Marketplace. Todos os direitos reservados.
          - paragraph [ref=e1325]:
            - text: Feito com
            - img [ref=e1326]
            - text: usando tecnologia Open Source (
            - link "MapLibre" [ref=e1328] [cursor=pointer]:
              - /url: https://maplibre.org/
            - text: ·
            - link "OpenStreetMap" [ref=e1329] [cursor=pointer]:
              - /url: https://www.openstreetmap.org/copyright
            - text: )
    - button "Abrir assistente virtual" [ref=e1330]:
      - img [ref=e1331]
    - generic [ref=e1335]:
      - generic [ref=e1336]:
        - img [ref=e1338]
        - generic [ref=e1340]:
          - paragraph [ref=e1341]: Usamos cookies para melhorar sua experiência
          - paragraph [ref=e1342]:
            - text: Utilizamos cookies essenciais para o funcionamento do site e cookies de análise para melhorar nossos serviços.
            - button "Política de privacidade" [ref=e1343]
      - generic [ref=e1344]:
        - button "Recusar" [ref=e1345]
        - button "Aceitar" [ref=e1346]:
          - img
          - text: Aceitar
        - button "Dispensar" [ref=e1347]:
          - img [ref=e1348]
  - region "Notifications alt+T"
  - generic [active]:
    - generic [ref=e1353]:
      - generic [ref=e1354]:
        - generic [ref=e1355]:
          - navigation [ref=e1356]:
            - button "previous" [disabled] [ref=e1357]:
              - img "previous" [ref=e1358]
            - generic [ref=e1360]:
              - generic [ref=e1361]: 1/
              - text: "1"
            - button "next" [disabled] [ref=e1362]:
              - img "next" [ref=e1363]
          - img
        - generic [ref=e1365]:
          - link "Next.js 16.1.3 (stale) Turbopack" [ref=e1366] [cursor=pointer]:
            - /url: https://nextjs.org/docs/messages/version-staleness
            - img [ref=e1367]
            - generic "There is a newer version (16.2.11) available, upgrade recommended!" [ref=e1369]: Next.js 16.1.3 (stale)
            - generic [ref=e1370]: Turbopack
          - img
      - dialog "Build Error" [ref=e1372]:
        - generic [ref=e1375]:
          - generic [ref=e1376]:
            - generic [ref=e1377]:
              - generic [ref=e1379]: Build Error
              - generic [ref=e1380]:
                - button "Copy Error Info" [ref=e1381] [cursor=pointer]:
                  - img [ref=e1382]
                - button "No related documentation found" [disabled] [ref=e1384]:
                  - img [ref=e1385]
                - button "Attach Node.js inspector" [ref=e1387] [cursor=pointer]:
                  - img [ref=e1388]
            - generic [ref=e1397]: Reading source code for parsing failed
          - generic [ref=e1399]:
            - generic [ref=e1401]:
              - img [ref=e1403]
              - generic [ref=e1407]: ./.freebuff/worktrees/thmrzp9vv9y86o/src/lib/api-server.ts
              - button "Open in editor" [ref=e1408] [cursor=pointer]:
                - img [ref=e1410]
            - generic [ref=e1414]: "Reading source code for parsing failed An unexpected error happened while trying to read the source code to parse: failed to convert rope into string Caused by: - invalid utf-8 sequence of 1 bytes from index 5415 Import trace: App Route: ./.freebuff/worktrees/thmrzp9vv9y86o/src/lib/api-server.ts ./.freebuff/worktrees/thmrzp9vv9y86o/src/app/api/auth/me/route.ts"
        - generic [ref=e1415]: "1"
        - generic [ref=e1416]: "2"
    - generic [ref=e1421] [cursor=pointer]:
      - button "Open Next.js Dev Tools" [ref=e1422]:
        - img [ref=e1423]
      - button "Open issues overlay" [ref=e1427]:
        - generic [ref=e1428]:
          - generic [ref=e1429]: "0"
          - generic [ref=e1430]: "1"
        - generic [ref=e1431]: Issue
  - alert [ref=e1432]
```

# Test source

```ts
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
  104 |     await criarBtn.click()
  105 |     await page.waitForTimeout(300)
  106 |   }
  107 | 
  108 |   // Fill the registration form
  109 |   const nameInput = page.getByPlaceholder(/nome/i).first()
> 110 |   await nameInput.fill(`Test User ${role}`)
      |                   ^ Error: locator.fill: Test timeout of 30000ms exceeded.
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
  205 |   const cepInput = page.getByPlaceholder(/CEP/i).first()
  206 |   if (await cepInput.isVisible()) {
  207 |     await cepInput.fill("01310100")
  208 |     await page.waitForTimeout(1500)
  209 |   }
  210 | 
```