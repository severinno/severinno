# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: booking-flow.spec.ts >> Fluxo Completo de Agendamento — Cliente Autenticado >> 9. login existente → booking + PIX + verificar no painel
- Location: e2e\booking-flow.spec.ts:418:7

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
                  - img [ref=e565]
                  - heading "Busque o serviço" [level=3] [ref=e568]
                  - paragraph [ref=e569]: Encontre prestadores verificados perto de você.
                  - generic [ref=e571]:
                    - generic [ref=e572]: "50"
                    - text: +
                    - generic [ref=e573]: categorias
                  - generic [ref=e575]:
                    - generic [ref=e576]:
                      - img [ref=e577]
                      - generic [ref=e580]: encanador em São Paulo
                      - generic [ref=e581]: "|"
                    - generic [ref=e582]:
                      - generic [ref=e583]: Verificados
                      - generic [ref=e584]: < 5 km
                      - generic [ref=e585]:
                        - img [ref=e586]
                        - text: Mais filtros
                  - paragraph [ref=e588]: "Ex: Busque 'encanador em São Paulo'"
                  - button "Buscar prestadores" [ref=e589]:
                    - text: Buscar prestadores
                    - img
              - 'button "2 Compare orçamentos Receba e compare propostas lado a lado. 3 orçamentos em 24h João S. R$ 180 Maria L. R$ 150 Melhor avaliação Compare lado a lado Ex: Compare 3 orçamentos em 24h Sem compromisso Pedir orçamento" [ref=e590] [cursor=pointer]':
                - generic [ref=e592]:
                  - generic [ref=e594]: "2"
                  - img [ref=e597]
                  - heading "Compare orçamentos" [level=3] [ref=e602]
                  - paragraph [ref=e603]: Receba e compare propostas lado a lado.
                  - generic [ref=e605]:
                    - generic [ref=e606]: "3"
                    - generic [ref=e607]: orçamentos em 24h
                  - generic [ref=e609]:
                    - generic [ref=e610]:
                      - generic [ref=e611]:
                        - generic [ref=e614]: João S.
                        - generic [ref=e615]:
                          - img [ref=e616]
                          - img [ref=e618]
                          - img [ref=e620]
                          - img [ref=e622]
                          - img [ref=e624]
                        - generic [ref=e626]: R$ 180
                      - generic [ref=e627]:
                        - generic [ref=e630]: Maria L.
                        - generic [ref=e631]:
                          - img [ref=e632]
                          - img [ref=e634]
                          - img [ref=e636]
                          - img [ref=e638]
                          - img [ref=e640]
                        - generic [ref=e642]: R$ 150
                        - generic [ref=e643]: Melhor avaliação
                    - generic [ref=e644]:
                      - img [ref=e645]
                      - text: Compare lado a lado
                  - paragraph [ref=e650]: "Ex: Compare 3 orçamentos em 24h"
                  - generic [ref=e651]:
                    - img [ref=e652]
                    - text: Sem compromisso
                  - button "Pedir orçamento" [ref=e657]:
                    - text: Pedir orçamento
                    - img
              - 'button "3 Agende com confiança Solicite um orçamento ou agende diretamente. 24 h para confirmar Março 2025 S T Q Q S S D 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 12 Mar, 14:00 — Confirmado Ex: Agende para amanhã às 14h Agendar agora" [ref=e658] [cursor=pointer]':
                - generic [ref=e660]:
                  - generic [ref=e662]: "3"
                  - img [ref=e665]
                  - heading "Agende com confiança" [level=3] [ref=e668]
                  - paragraph [ref=e669]: Solicite um orçamento ou agende diretamente.
                  - generic [ref=e671]:
                    - generic [ref=e672]: "24"
                    - text: h
                    - generic [ref=e673]: para confirmar
                  - generic [ref=e676]:
                    - generic [ref=e677]: Março 2025
                    - generic [ref=e678]:
                      - generic [ref=e679]: S
                      - generic [ref=e680]: T
                      - generic [ref=e681]: Q
                      - generic [ref=e682]: Q
                      - generic [ref=e683]: S
                      - generic [ref=e684]: S
                      - generic [ref=e685]: D
                      - generic [ref=e686]: "1"
                      - generic [ref=e687]: "2"
                      - generic [ref=e688]: "3"
                      - generic [ref=e689]: "4"
                      - generic [ref=e690]: "5"
                      - generic [ref=e691]: "6"
                      - generic [ref=e692]: "7"
                      - generic [ref=e693]: "8"
                      - generic [ref=e694]: "9"
                      - generic [ref=e695]: "10"
                      - generic [ref=e696]: "11"
                      - generic [ref=e697]: "12"
                      - generic [ref=e698]: "13"
                      - generic [ref=e699]: "14"
                      - generic [ref=e700]: "15"
                    - generic [ref=e701]:
                      - img [ref=e702]
                      - generic [ref=e705]: 12 Mar, 14:00 — Confirmado
                  - paragraph [ref=e706]: "Ex: Agende para amanhã às 14h"
                  - button "Agendar agora" [ref=e707]:
                    - text: Agendar agora
                    - img
              - 'button "4 Avalie o resultado Sua opinião mantém a qualidade da comunidade. 98 % satisfação 4.0 \"Excelente trabalho, recomendo!\" Avaliação verificada Ex: Avalie de 1 a 5 estrelas com comentário Cadastrar grátis" [ref=e708] [cursor=pointer]':
                - generic [ref=e710]:
                  - generic [ref=e712]: "4"
                  - img [ref=e715]
                  - heading "Avalie o resultado" [level=3] [ref=e717]
                  - paragraph [ref=e718]: Sua opinião mantém a qualidade da comunidade.
                  - generic [ref=e720]:
                    - generic [ref=e721]: "98"
                    - text: "%"
                    - generic [ref=e722]: satisfação
                  - generic [ref=e724]:
                    - generic [ref=e725]:
                      - generic [ref=e726]:
                        - img [ref=e727]
                        - img [ref=e729]
                        - img [ref=e731]
                        - img [ref=e733]
                        - img [ref=e735]
                        - generic [ref=e737]: "4.0"
                      - paragraph [ref=e740]: "\"Excelente trabalho, recomendo!\""
                    - generic [ref=e741]:
                      - img [ref=e742]
                      - text: Avaliação verificada
                  - paragraph [ref=e745]: "Ex: Avalie de 1 a 5 estrelas com comentário"
                  - button "Cadastrar grátis" [ref=e746]:
                    - text: Cadastrar grátis
                    - img
          - generic [ref=e747]:
            - generic [ref=e748]:
              - img [ref=e749]
              - generic [ref=e752]: Garantia Severinno
            - generic [ref=e753]:
              - generic [ref=e754]:
                - img [ref=e755]
                - generic [ref=e758]: Prestadores verificados
              - generic [ref=e759]:
                - img [ref=e760]
                - generic [ref=e763]: Resposta rápida
              - generic [ref=e764]:
                - img [ref=e765]
                - generic [ref=e767]: Satisfação garantida
              - generic [ref=e768]:
                - img [ref=e769]
                - generic [ref=e774]: Compare antes de contratar
          - generic [ref=e775]:
            - button "Começar agora" [ref=e776]:
              - text: Começar agora
              - img
            - link "Buscar prestadores" [ref=e777] [cursor=pointer]:
              - /url: "#vitrine-resultados"
              - img
              - text: Buscar prestadores
          - button "Voltar ao topo" [ref=e779]:
            - img [ref=e780]
            - text: Voltar ao topo
      - generic [ref=e783]:
        - generic [ref=e784]:
          - generic [ref=e785]:
            - img
            - text: Simulador de preços
          - heading "Quanto custa? Simule agora" [level=2] [ref=e786]
          - paragraph [ref=e787]: Estime o valor do serviço em 3 passos rápidos. Sem compromisso, sem cadastro.
        - generic [ref=e788]:
          - generic [ref=e789]: "1"
          - generic [ref=e791]: "2"
          - generic [ref=e793]: "3"
        - generic [ref=e796]:
          - heading "1. Qual serviço você precisa?" [level=3] [ref=e797]
          - paragraph [ref=e798]: Selecione a categoria do serviço
          - generic [ref=e799]:
            - button "Elétrica" [ref=e800]:
              - img [ref=e802]
              - generic [ref=e804]: Elétrica
            - button "Hidráulica" [ref=e805]:
              - img [ref=e807]
              - generic [ref=e810]: Hidráulica
            - button "Pintura" [ref=e811]:
              - img [ref=e813]
              - generic [ref=e817]: Pintura
            - button "Alvenaria" [ref=e818]:
              - img [ref=e820]
              - generic [ref=e822]: Alvenaria
            - button "Pisos" [ref=e823]:
              - img [ref=e825]
              - generic [ref=e827]: Pisos
            - button "Pós-obra" [ref=e828]:
              - img [ref=e830]
              - generic [ref=e835]: Pós-obra
            - button "Residencial" [ref=e836]:
              - img [ref=e838]
              - generic [ref=e841]: Residencial
      - region "Parceiros e imprensa" [ref=e842]:
        - generic [ref=e843]:
          - paragraph [ref=e845]: Referência no mercado
          - generic [ref=e847]:
            - generic [ref=e850]: G1
            - generic [ref=e853]: Folha de S.Paulo
            - generic [ref=e856]: Valor Econômico
            - generic [ref=e859]: Exame
            - generic [ref=e862]: InfoMoney
            - generic [ref=e865]: Startups
            - generic [ref=e868]: Sebrae
            - generic [ref=e871]: ABES
          - paragraph [ref=e872]: + de 6.000 prestadores confiam no Severinno
      - region "Avaliações de clientes" [ref=e873]:
        - generic:
          - generic:
            - img
        - generic [ref=e874]:
          - generic [ref=e875]:
            - generic [ref=e876]:
              - img [ref=e877]
              - text: Avaliações reais
            - heading "O que nossos clientes dizem" [level=2] [ref=e879]
            - paragraph [ref=e880]: Avaliações de clientes após a conclusão do serviço.
          - generic [ref=e881]:
            - img [ref=e883]
            - heading "Não foi possível carregar as avaliações" [level=3] [ref=e888]
            - paragraph [ref=e889]: Ocorreu um erro ao buscar as avaliações. Tente novamente.
            - button "Tentar novamente" [ref=e890]:
              - img
              - text: Tentar novamente
      - generic [ref=e891]:
        - generic [ref=e894]:
          - generic [ref=e895]:
            - img [ref=e897]
            - generic [ref=e902]: "0"
            - paragraph [ref=e903]: Prestadores verificados
          - generic [ref=e904]:
            - img [ref=e906]
            - generic [ref=e908]: "0"
            - paragraph [ref=e909]: Serviços cadastrados
          - generic [ref=e910]:
            - img [ref=e912]
            - generic [ref=e915]: "0"
            - paragraph [ref=e916]: Serviços concluídos
          - generic [ref=e917]:
            - img [ref=e919]
            - generic [ref=e922]: 0.0/5
            - paragraph [ref=e923]: Nota média
        - generic [ref=e925]:
          - generic [ref=e926]:
            - generic [ref=e927]:
              - img [ref=e928]
              - text: Por que Severinno?
            - heading "Confiança em cada agendamento" [level=2] [ref=e931]
            - paragraph [ref=e932]: Mais que um diretório de serviços — um ecossistema pensado para proteger você e o prestador. Da verificação ao pagamento, cada etapa foi desenhada para a sua tranquilidade.
            - link "Pular para FAQ" [ref=e934] [cursor=pointer]:
              - /url: "#faq"
              - img [ref=e935]
              - text: Pular para FAQ
          - generic [ref=e938]:
            - generic [ref=e941]:
              - generic [ref=e942]:
                - img [ref=e944]
                - button "Saiba mais sobre Prestadores verificados" [ref=e947]:
                  - img [ref=e948]
              - heading "Prestadores verificados" [level=3] [ref=e951]
              - paragraph [ref=e952]: João verificou 3 documentos antes de aprovar o prestador. Você só vê profissionais validados.
              - button "Saiba mais" [ref=e953]:
                - text: Saiba mais
                - img [ref=e954]
            - generic [ref=e958]:
              - generic [ref=e959]:
                - img [ref=e961]
                - button "Saiba mais sobre Pagamento protegido" [ref=e964]:
                  - img [ref=e965]
              - heading "Pagamento protegido" [level=3] [ref=e968]
              - paragraph [ref=e969]: O valor só é liberado ao prestador após você confirmar que ficou satisfeito com o serviço.
              - button "Saiba mais" [ref=e970]:
                - text: Saiba mais
                - img [ref=e971]
            - generic [ref=e975]:
              - generic [ref=e976]:
                - img [ref=e978]
                - button "Saiba mais sobre Resposta rápida" [ref=e981]:
                  - img [ref=e982]
              - heading "Resposta rápida" [level=3] [ref=e985]
              - paragraph [ref=e986]: Prestadores comprometidos a responder em até 24h. Acompanhe o status em tempo real.
              - button "Saiba mais" [ref=e987]:
                - text: Saiba mais
                - img [ref=e988]
            - generic [ref=e992]:
              - generic [ref=e993]:
                - img [ref=e995]
                - button "Saiba mais sobre Avaliações reais" [ref=e997]:
                  - img [ref=e998]
              - heading "Avaliações reais" [level=3] [ref=e1001]
              - paragraph [ref=e1002]: Apenas clientes que concluíram o serviço podem avaliar. Sem falsas avaliações.
              - button "Saiba mais" [ref=e1003]:
                - text: Saiba mais
                - img [ref=e1004]
            - generic [ref=e1008]:
              - generic [ref=e1009]:
                - img [ref=e1011]
                - button "Saiba mais sobre Próximo de você" [ref=e1014]:
                  - img [ref=e1015]
              - heading "Próximo de você" [level=3] [ref=e1018]
              - paragraph [ref=e1019]: Geolocalização inteligente mostra os melhores prestadores na sua região.
              - button "Saiba mais" [ref=e1020]:
                - text: Saiba mais
                - img [ref=e1021]
            - generic [ref=e1025]:
              - generic [ref=e1026]:
                - img [ref=e1028]
                - button "Saiba mais sobre Suporte humano" [ref=e1030]:
                  - img [ref=e1031]
              - heading "Suporte humano" [level=3] [ref=e1034]
              - paragraph [ref=e1035]: Equipe disponível para mediar disputas, tirar dúvidas e garantir uma experiência justa.
              - button "Saiba mais" [ref=e1036]:
                - text: Saiba mais
                - img [ref=e1037]
        - generic [ref=e1040]:
          - img [ref=e1041]
          - paragraph [ref=e1043]: "Garantia Severinno: seu dinheiro de volta se o serviço não for bem-feito."
          - link "Saiba mais" [ref=e1044] [cursor=pointer]:
            - /url: "#faq"
            - text: Saiba mais
            - img [ref=e1045]
      - generic [ref=e1048]:
        - generic [ref=e1049]:
          - generic [ref=e1050]:
            - img [ref=e1051]
            - text: Destaque da semana
          - heading "Profissional em destaque" [level=2] [ref=e1057]
          - paragraph [ref=e1058]: Conheça um dos nossos prestadores mais bem avaliados.
        - generic [ref=e1062]:
          - generic [ref=e1063]:
            - generic [ref=e1064]:
              - img [ref=e1067]
              - img [ref=e1071]
              - generic [ref=e1075]:
                - img [ref=e1076]
                - text: Top
            - generic [ref=e1078]:
              - generic [ref=e1079]:
                - heading "Maria Silva" [level=3] [ref=e1080]
                - generic [ref=e1081]:
                  - generic [ref=e1082]:
                    - img [ref=e1083]
                    - text: São Paulo
                  - generic [ref=e1086]: 3 km
                  - generic [ref=e1087]:
                    - img [ref=e1088]
                    - text: Membro desde 2023
              - generic [ref=e1090]:
                - generic [ref=e1091]:
                  - img [ref=e1092]
                  - generic [ref=e1094]: "4.8"
                - generic [ref=e1095]: (42 avaliações)
              - generic [ref=e1096]:
                - generic [ref=e1097]:
                  - img
                  - text: 230 serviços concluídos
                - generic [ref=e1098]:
                  - img
                  - text: Responde em ~30min
              - generic [ref=e1099]:
                - paragraph [ref=e1100]: Serviços
                - generic [ref=e1102]:
                  - generic [ref=e1103]: Instalação Elétrica
                  - generic [ref=e1104]: R$ 120,00
              - paragraph [ref=e1106]: Especialista em instalações elétricas residenciais com mais de 10 anos de experiência.
              - generic [ref=e1107]:
                - generic [ref=e1108]:
                  - generic "Maria S." [ref=e1109]: M
                  - generic "João P." [ref=e1110]: J
                  - generic "Ana L." [ref=e1111]: A
                - generic [ref=e1112]: Clientes recentes
          - generic [ref=e1113]:
            - generic [ref=e1114]:
              - button "Pedir orçamento" [ref=e1115]:
                - img
                - text: Pedir orçamento
              - button "Ver perfil completo" [ref=e1116]:
                - text: Ver perfil completo
                - img
            - button "Enviar mensagem" [ref=e1118]:
              - img
              - text: Enviar mensagem
      - generic [ref=e1122]:
        - generic [ref=e1123]:
          - generic [ref=e1124]:
            - generic [ref=e1125]:
              - img [ref=e1126]
              - text: Perguntas frequentes
            - heading "Tire suas dúvidas antes de contratar" [level=2] [ref=e1129]
            - paragraph [ref=e1130]: Reunimos as perguntas mais comuns sobre como o Severinno funciona — do cadastro ao pagamento.
          - generic [ref=e1131]:
            - img [ref=e1132]
            - textbox "Buscar nas perguntas frequentes" [ref=e1135]:
              - /placeholder: Buscar nas dúvidas…
          - generic [ref=e1136]:
            - paragraph [ref=e1137]: Filtrar por categoria
            - generic [ref=e1138]:
              - button "Filtrar por Geral" [ref=e1139]:
                - img [ref=e1140]
                - text: Geral
                - generic [ref=e1143]: (2)
              - button "Filtrar por Pagamento" [ref=e1144]:
                - img [ref=e1145]
                - text: Pagamento
                - generic [ref=e1147]: (2)
              - button "Filtrar por Agendamento" [ref=e1148]:
                - img [ref=e1149]
                - text: Agendamento
                - generic [ref=e1151]: (2)
              - button "Filtrar por Prestadores" [ref=e1152]:
                - img [ref=e1153]
                - text: Prestadores
                - generic [ref=e1157]: (2)
              - button "Filtrar por Segurança" [ref=e1158]:
                - img [ref=e1159]
                - text: Segurança
                - generic [ref=e1162]: (2)
          - generic [ref=e1163]:
            - paragraph [ref=e1164]: Perguntas mais frequentes
            - list [ref=e1165]:
              - listitem [ref=e1166]:
                - button "Como funciona o Severinno?" [ref=e1167]:
                  - img [ref=e1168]
                  - generic [ref=e1170]: Como funciona o Severinno?
              - listitem [ref=e1171]:
                - button "Preciso pagar para me cadastrar?" [ref=e1172]:
                  - img [ref=e1173]
                  - generic [ref=e1175]: Preciso pagar para me cadastrar?
              - listitem [ref=e1176]:
                - button "Como faço para agendar um serviço?" [ref=e1177]:
                  - img [ref=e1178]
                  - generic [ref=e1180]: Como faço para agendar um serviço?
              - listitem [ref=e1181]:
                - button "E se o serviço não for bem-feito?" [ref=e1182]:
                  - img [ref=e1183]
                  - generic [ref=e1185]: E se o serviço não for bem-feito?
          - generic [ref=e1187]:
            - img [ref=e1189]
            - generic [ref=e1191]:
              - paragraph [ref=e1192]: Ainda tem dúvidas?
              - paragraph [ref=e1193]: Cadastre-se grátis e converse diretamente com prestadores verificados. Sem compromisso.
              - generic [ref=e1194]:
                - button "Cadastrar grátis" [ref=e1195]
                - link "Fale conosco" [ref=e1196] [cursor=pointer]:
                  - /url: "#faq"
                  - img
                  - text: Fale conosco
        - generic [ref=e1197]:
          - generic [ref=e1199]:
            - generic [ref=e1201]:
              - heading "01 Como funciona o Severinno? Geral" [level=3] [ref=e1202]:
                - button "01 Como funciona o Severinno? Geral" [expanded] [ref=e1203]:
                  - generic [ref=e1204]:
                    - generic [ref=e1205]: "01"
                    - generic [ref=e1206]: Como funciona o Severinno?
                    - generic [ref=e1207]:
                      - img
                      - text: Geral
                  - img
              - region "01 Como funciona o Severinno? Geral" [ref=e1208]:
                - generic [ref=e1210]:
                  - paragraph [ref=e1211]: O Severinno conecta você a prestadores de serviço verificados próximos à sua localização. Você busca o serviço, compara avaliações reais de outros clientes, pede orçamento grátis e agenda — tudo pela plataforma. O pagamento só é liberado após você confirmar a conclusão do serviço.
                  - paragraph [ref=e1212]: "Ex: Maria precisava de um eletricista. Buscou na plataforma, comparou 3 profissionais e contratou o mais bem avaliado — tudo em 5 minutos."
            - heading "02 Preciso pagar para me cadastrar? Geral" [level=3] [ref=e1215]:
              - button "02 Preciso pagar para me cadastrar? Geral" [ref=e1216]:
                - generic [ref=e1217]:
                  - generic [ref=e1218]: "02"
                  - generic [ref=e1219]: Preciso pagar para me cadastrar?
                  - generic [ref=e1220]:
                    - img
                    - text: Geral
                - img
            - heading "03 Como os prestadores são verificados? Prestadores" [level=3] [ref=e1223]:
              - button "03 Como os prestadores são verificados? Prestadores" [ref=e1224]:
                - generic [ref=e1225]:
                  - generic [ref=e1226]: "03"
                  - generic [ref=e1227]: Como os prestadores são verificados?
                  - generic [ref=e1228]:
                    - img
                    - text: Prestadores
                - img
            - heading "04 Posso me tornar um prestador no Severinno? Prestadores" [level=3] [ref=e1231]:
              - button "04 Posso me tornar um prestador no Severinno? Prestadores" [ref=e1232]:
                - generic [ref=e1233]:
                  - generic [ref=e1234]: "04"
                  - generic [ref=e1235]: Posso me tornar um prestador no Severinno?
                  - generic [ref=e1236]:
                    - img
                    - text: Prestadores
                - img
            - heading "05 Como faço para agendar um serviço? Agendamento" [level=3] [ref=e1239]:
              - button "05 Como faço para agendar um serviço? Agendamento" [ref=e1240]:
                - generic [ref=e1241]:
                  - generic [ref=e1242]: "05"
                  - generic [ref=e1243]: Como faço para agendar um serviço?
                  - generic [ref=e1244]:
                    - img
                    - text: Agendamento
                - img
            - heading "06 Posso remarcar ou cancelar um agendamento? Agendamento" [level=3] [ref=e1247]:
              - button "06 Posso remarcar ou cancelar um agendamento? Agendamento" [ref=e1248]:
                - generic [ref=e1249]:
                  - generic [ref=e1250]: "06"
                  - generic [ref=e1251]: Posso remarcar ou cancelar um agendamento?
                  - generic [ref=e1252]:
                    - img
                    - text: Agendamento
                - img
            - heading "07 Como funciona o pagamento? Pagamento" [level=3] [ref=e1255]:
              - button "07 Como funciona o pagamento? Pagamento" [ref=e1256]:
                - generic [ref=e1257]:
                  - generic [ref=e1258]: "07"
                  - generic [ref=e1259]: Como funciona o pagamento?
                  - generic [ref=e1260]:
                    - img
                    - text: Pagamento
                - img
            - heading "08 O orçamento tem compromisso? Pagamento" [level=3] [ref=e1263]:
              - button "08 O orçamento tem compromisso? Pagamento" [ref=e1264]:
                - generic [ref=e1265]:
                  - generic [ref=e1266]: "08"
                  - generic [ref=e1267]: O orçamento tem compromisso?
                  - generic [ref=e1268]:
                    - img
                    - text: Pagamento
                - img
            - heading "09 E se o serviço não for bem-feito? Segurança" [level=3] [ref=e1271]:
              - button "09 E se o serviço não for bem-feito? Segurança" [ref=e1272]:
                - generic [ref=e1273]:
                  - generic [ref=e1274]: "09"
                  - generic [ref=e1275]: E se o serviço não for bem-feito?
                  - generic [ref=e1276]:
                    - img
                    - text: Segurança
                - img
            - heading "10 Meus dados pessoais estão seguros? Segurança" [level=3] [ref=e1279]:
              - button "10 Meus dados pessoais estão seguros? Segurança" [ref=e1280]:
                - generic [ref=e1281]:
                  - generic [ref=e1282]: "10"
                  - generic [ref=e1283]: Meus dados pessoais estão seguros?
                  - generic [ref=e1284]:
                    - img
                    - text: Segurança
                - img
          - generic [ref=e1285]:
            - paragraph [ref=e1286]: 10 de 10 dúvidas
            - button "Voltar ao topo da seção" [ref=e1287]:
              - img [ref=e1288]
              - text: Topo
      - generic [ref=e1292]:
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
        - generic [ref=e1297]:
          - generic [ref=e1298]:
            - generic [ref=e1300]:
              - img [ref=e1301]
              - text: Comece agora mesmo
            - heading "Encontre o serviço que você precisa" [level=2] [ref=e1303]
            - paragraph [ref=e1304]: Navegue pela vitrine, salve seus favoritos e agende com confiança. Tudo em um só lugar.
            - list [ref=e1305]:
              - generic [ref=e1306]:
                - listitem [ref=e1307]:
                  - img [ref=e1308]
                  - text: Cadastro gratuito
                - listitem [ref=e1311]:
                  - img [ref=e1312]
                  - text: Sem taxa de serviço
                - listitem [ref=e1315]:
                  - img [ref=e1316]
                  - text: Orçamento sem compromisso
            - button "Buscar prestadores" [ref=e1324]:
              - img
              - text: Buscar prestadores
              - generic [ref=e1325]:
                - img
          - generic [ref=e1326]:
            - generic [ref=e1327]:
              - heading "O que vem depois?" [level=3] [ref=e1328]
              - paragraph [ref=e1329]: Três passos simples e você estará agendando
              - generic [ref=e1330]:
                - img [ref=e1331]
                - generic [ref=e1332]:
                  - generic [ref=e1333]:
                    - generic [ref=e1335]: "1"
                    - generic [ref=e1336]:
                      - paragraph [ref=e1337]: Cadastre-se grátis
                      - paragraph [ref=e1338]: ~30s
                  - generic [ref=e1339]:
                    - generic [ref=e1341]: "2"
                    - generic [ref=e1342]:
                      - paragraph [ref=e1343]: Busque e compare
                      - paragraph [ref=e1344]: ~2 min
                  - generic [ref=e1345]:
                    - generic [ref=e1347]: "3"
                    - generic [ref=e1348]:
                      - paragraph [ref=e1349]: Agende com confiança
                      - paragraph [ref=e1350]: ~5 min
              - generic [ref=e1351]:
                - generic [ref=e1352]:
                  - img [ref=e1353]
                  - text: Sem compromisso
                - generic [ref=e1357]:
                  - img [ref=e1358]
                  - text: Cancele quando quiser
                - generic [ref=e1361]:
                  - img [ref=e1362]
                  - text: Suporte 24h
              - link "Saiba mais sobre pagamento protegido" [ref=e1365] [cursor=pointer]:
                - /url: "#faq"
                - img [ref=e1366]
                - text: Saiba mais sobre pagamento protegido
            - generic [ref=e1370]:
              - generic [ref=e1374]: Cliente
              - generic [ref=e1375]:
                - img [ref=e1379]
                - generic [ref=e1381]: Prestador
              - img [ref=e1386]
              - img [ref=e1388]
              - img [ref=e1392]
              - img [ref=e1395]
              - img [ref=e1399]
        - generic [ref=e1403]:
          - img [ref=e1404]
          - generic [ref=e1407]:
            - paragraph [ref=e1408]: “Encontrei um encanador em 10 minutos, paguei menos do que esperava e ainda pude avaliar o serviço. Recomendo demais!”
            - paragraph [ref=e1409]: — Ana P., Cliente, São Paulo
        - generic [ref=e1410]:
          - generic [ref=e1411]:
            - img [ref=e1412]
            - text: Sem compromisso
          - generic [ref=e1416]:
            - img [ref=e1417]
            - text: Cancele quando quiser
          - generic [ref=e1420]:
            - img [ref=e1421]
            - text: Pagamento protegido
    - contentinfo [ref=e1423]:
      - generic [ref=e1425]:
        - generic [ref=e1426]:
          - paragraph [ref=e1427]: Receba novidades e dicas de serviços
          - paragraph [ref=e1428]: Cadastre-se e receba ofertas exclusivas. Cancele quando quiser.
        - generic [ref=e1429]:
          - generic [ref=e1430]:
            - img [ref=e1431]
            - textbox "E-mail para newsletter" [ref=e1434]:
              - /placeholder: Seu e-mail
          - button "Assinar" [disabled]:
            - img
            - text: Assinar
      - generic [ref=e1435]:
        - generic [ref=e1436]:
          - generic [ref=e1437]:
            - generic [ref=e1438]:
              - img [ref=e1440]
              - generic [ref=e1443]: Severinno
            - paragraph [ref=e1444]: Marketplace de serviços com geolocalização. Encontre prestadores verificados, próximos e bem avaliados.
            - list "Redes sociais" [ref=e1445]:
              - listitem [ref=e1446]:
                - link "GitHub" [ref=e1447] [cursor=pointer]:
                  - /url: https://github.com
                  - img [ref=e1448]
              - listitem [ref=e1451]:
                - link "Twitter" [ref=e1452] [cursor=pointer]:
                  - /url: https://twitter.com
                  - img [ref=e1453]
              - listitem [ref=e1455]:
                - link "Instagram" [ref=e1456] [cursor=pointer]:
                  - /url: https://instagram.com
                  - img [ref=e1457]
              - listitem [ref=e1460]:
                - link "LinkedIn" [ref=e1461] [cursor=pointer]:
                  - /url: https://linkedin.com
                  - img [ref=e1462]
              - listitem [ref=e1466]:
                - link "E-mail" [ref=e1467] [cursor=pointer]:
                  - /url: mailto:contato@severinno.com
                  - img [ref=e1468]
          - navigation "Sobre" [ref=e1471]:
            - heading "Sobre" [level=3] [ref=e1472]:
              - img [ref=e1473]
              - text: Sobre
            - list [ref=e1476]:
              - listitem [ref=e1477]:
                - button "Como funciona" [ref=e1478]
              - listitem [ref=e1479]:
                - button "Quem somos" [ref=e1480]
              - listitem [ref=e1481]:
                - button "Termos de uso" [ref=e1482]
              - listitem [ref=e1483]:
                - button "Privacidade" [ref=e1484]
          - navigation "Para profissionais" [ref=e1485]:
            - heading "Para profissionais" [level=3] [ref=e1486]:
              - img [ref=e1487]
              - text: Para profissionais
            - list [ref=e1490]:
              - listitem [ref=e1491]:
                - button "Cadastre-se" [ref=e1492]
              - listitem [ref=e1493]:
                - button "Meu painel" [ref=e1494]
              - listitem [ref=e1495]:
                - button "Central de ajuda" [ref=e1496]
          - navigation "Precisa de ajuda?" [ref=e1497]:
            - heading "Precisa de ajuda?" [level=3] [ref=e1498]:
              - img [ref=e1499]
              - text: Precisa de ajuda?
            - list [ref=e1501]:
              - listitem [ref=e1502]:
                - button "Perguntas frequentes" [ref=e1503]
              - listitem [ref=e1504]:
                - button "Segurança" [ref=e1505]
              - listitem [ref=e1506]:
                - button "Reportar problema" [ref=e1507]
          - generic [ref=e1508]:
            - heading "Contato" [level=3] [ref=e1509]:
              - img [ref=e1510]
              - text: Contato
            - list [ref=e1515]:
              - listitem [ref=e1516]:
                - img [ref=e1517]
                - link "contato@severinno.com" [ref=e1520] [cursor=pointer]:
                  - /url: mailto:contato@severinno.com
              - listitem [ref=e1521]:
                - img [ref=e1522]
                - text: São Paulo, Brasil
            - button "Fale conosco" [ref=e1525]:
              - img
              - text: Fale conosco
        - generic [ref=e1526]:
          - paragraph [ref=e1527]: © 2026 Severinno Marketplace. Todos os direitos reservados.
          - paragraph [ref=e1528]:
            - text: Feito com
            - img [ref=e1529]
            - text: usando tecnologia Open Source (
            - link "MapLibre" [ref=e1531] [cursor=pointer]:
              - /url: https://maplibre.org/
            - text: ·
            - link "OpenStreetMap" [ref=e1532] [cursor=pointer]:
              - /url: https://www.openstreetmap.org/copyright
            - text: )
    - button "Abrir assistente virtual" [ref=e1533]:
      - img [ref=e1534]
    - generic [ref=e1538]:
      - generic [ref=e1539]:
        - img [ref=e1541]
        - generic [ref=e1543]:
          - paragraph [ref=e1544]: Usamos cookies para melhorar sua experiência
          - paragraph [ref=e1545]:
            - text: Utilizamos cookies essenciais para o funcionamento do site e cookies de análise para melhorar nossos serviços.
            - button "Política de privacidade" [ref=e1546]
      - generic [ref=e1547]:
        - button "Recusar" [ref=e1548]
        - button "Aceitar" [ref=e1549]:
          - img
          - text: Aceitar
        - button "Dispensar" [ref=e1550]:
          - img [ref=e1551]
  - region "Notifications alt+T"
  - generic [active]:
    - generic [ref=e1556]:
      - generic [ref=e1557]:
        - generic [ref=e1558]:
          - navigation [ref=e1559]:
            - button "previous" [disabled] [ref=e1560]:
              - img "previous" [ref=e1561]
            - generic [ref=e1563]:
              - generic [ref=e1564]: 1/
              - text: "1"
            - button "next" [disabled] [ref=e1565]:
              - img "next" [ref=e1566]
          - img
        - generic [ref=e1568]:
          - link "Next.js 16.1.3 (stale) Turbopack" [ref=e1569] [cursor=pointer]:
            - /url: https://nextjs.org/docs/messages/version-staleness
            - img [ref=e1570]
            - generic "There is a newer version (16.2.11) available, upgrade recommended!" [ref=e1572]: Next.js 16.1.3 (stale)
            - generic [ref=e1573]: Turbopack
          - img
      - dialog "Build Error" [ref=e1575]:
        - generic [ref=e1578]:
          - generic [ref=e1579]:
            - generic [ref=e1580]:
              - generic [ref=e1582]: Build Error
              - generic [ref=e1583]:
                - button "Copy Error Info" [ref=e1584] [cursor=pointer]:
                  - img [ref=e1585]
                - button "No related documentation found" [disabled] [ref=e1587]:
                  - img [ref=e1588]
                - button "Attach Node.js inspector" [ref=e1590] [cursor=pointer]:
                  - img [ref=e1591]
            - generic [ref=e1600]: Reading source code for parsing failed
          - generic [ref=e1602]:
            - generic [ref=e1604]:
              - img [ref=e1606]
              - generic [ref=e1610]: ./.freebuff/worktrees/thmrzp9vv9y86o/src/lib/api-server.ts
              - button "Open in editor" [ref=e1611] [cursor=pointer]:
                - img [ref=e1613]
            - generic [ref=e1617]: "Reading source code for parsing failed An unexpected error happened while trying to read the source code to parse: failed to convert rope into string Caused by: - invalid utf-8 sequence of 1 bytes from index 5415 Import trace: App Route: ./.freebuff/worktrees/thmrzp9vv9y86o/src/lib/api-server.ts ./.freebuff/worktrees/thmrzp9vv9y86o/src/app/api/auth/me/route.ts"
        - generic [ref=e1618]: "1"
        - generic [ref=e1619]: "2"
    - generic [ref=e1624] [cursor=pointer]:
      - button "Open Next.js Dev Tools" [ref=e1625]:
        - img [ref=e1626]
      - button "Open issues overlay" [ref=e1630]:
        - generic [ref=e1631]:
          - generic [ref=e1632]: "0"
          - generic [ref=e1633]: "1"
        - generic [ref=e1634]: Issue
  - alert [ref=e1635]
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