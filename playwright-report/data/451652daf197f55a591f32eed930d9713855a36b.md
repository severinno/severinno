# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: booking-flow.spec.ts >> Fluxo de Pagamento PIX >> 10. booking + PIX — QR code visível após confirmação
- Location: e2e\booking-flow.spec.ts:494:7

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
    - banner [ref=e4]:
      - generic [ref=e5]:
        - button "Severinno — página inicial" [ref=e6]:
          - generic [ref=e7]:
            - img [ref=e9]
            - img [ref=e13]
          - generic [ref=e15]: Severinno
          - generic [ref=e16]:
            - img [ref=e17]
            - generic [ref=e20]: Verificado
        - generic [ref=e23]:
          - img
          - textbox "Buscar prestadores" [ref=e24]:
            - /placeholder: Buscar serviço ou prestador…
          - generic: ⌘K
        - button "Usar minha localização" [ref=e26]:
          - img
          - generic [ref=e27]: Definir localização
        - generic [ref=e28]:
          - button "Alternar tema" [ref=e29]:
            - generic [ref=e30]:
              - img
          - button "Notificações" [ref=e31]:
            - img
          - button "Favoritos" [ref=e32]:
            - img
          - button "Menu da conta" [ref=e33]:
            - generic [ref=e36]: TU
            - generic [ref=e38]: Test
            - img [ref=e39]
    - main [ref=e41]:
      - generic [ref=e48]:
        - generic [ref=e49]:
          - generic [ref=e51]:
            - img [ref=e52]
            - text: Marketplace de serviços verificados
          - heading "Prestadores de serviço verificados, perto de você." [level=1] [ref=e55]
          - paragraph [ref=e56]: Compare avaliações reais, peça orçamento grátis e agende — encanador, eletricista, pintor e mais. Você escolhe o profissional.
          - generic [ref=e58]:
            - generic [ref=e59]:
              - img [ref=e60]
              - textbox "Serviço buscado" [ref=e63]:
                - /placeholder: "O que você precisa? Ex.: encanador, pintura…"
            - generic [ref=e64]:
              - img [ref=e65]
              - textbox "Localização" [ref=e68]:
                - /placeholder: CEP ou cidade
            - button "Buscar" [ref=e69]:
              - img
              - text: Buscar
          - generic [ref=e70]:
            - generic [ref=e71]: "Mais buscados:"
            - button "Encanador" [ref=e72]:
              - generic [ref=e73]: 🔧
              - text: Encanador
            - button "Eletricista" [ref=e74]:
              - generic [ref=e75]: 💡
              - text: Eletricista
            - button "Pintor" [ref=e76]:
              - generic [ref=e77]: 🎨
              - text: Pintor
            - button "Diarista" [ref=e78]:
              - generic [ref=e79]: 🧹
              - text: Diarista
            - button "Pedreiro" [ref=e80]:
              - generic [ref=e81]: 🧱
              - text: Pedreiro
            - button "Jardineiro" [ref=e82]:
              - generic [ref=e83]: 🌿
              - text: Jardineiro
          - button "Usar minha localização" [ref=e84]:
            - img [ref=e85]
            - text: Usar minha localização
          - generic [ref=e88]:
            - button "Cadastrar grátis" [ref=e89]:
              - text: Cadastrar grátis
              - img
            - button "Ver como funciona" [ref=e90]
          - paragraph [ref=e91]: Cadastro grátis · Orçamento sem compromisso · Você escolhe o profissional
          - list [ref=e92]:
            - listitem "Documentos validados e identidade confirmada" [ref=e93]:
              - img [ref=e95]
              - generic [ref=e98]: Prestadores verificados
            - listitem "Avaliações de clientes após a conclusão do serviço" [ref=e99]:
              - img [ref=e101]
              - generic [ref=e103]: Avaliações reais
            - listitem "Pagamento só é liberado após você marcar como concluído" [ref=e104]:
              - img [ref=e106]
              - generic [ref=e109]: Pagamento seguro
        - generic [ref=e112]:
          - generic [ref=e118]: Atividade ao vivo
          - generic [ref=e120]:
            - img [ref=e121]
            - paragraph [ref=e123]: Carregando atividades…
      - region "Atividade recente na plataforma" [ref=e125]:
        - generic [ref=e126]:
          - generic [ref=e128]: Atividade recente
          - generic [ref=e132]:
            - generic [ref=e134]:
              - generic [ref=e135]:
                - generic [ref=e136]: ⚡
                - text: Maria contratou um eletricista em São Paulo
              - generic [ref=e138]:
                - generic [ref=e139]: ⭐
                - text: João avaliou ★★★★★ o prestador Ricardo
              - generic [ref=e141]:
                - generic [ref=e142]: 🎨
                - text: "Nova avaliação: 4.9 para Serviços de Pintura"
              - generic [ref=e144]:
                - generic [ref=e145]: 🔧
                - text: Ana pediu orçamento para encanador
              - generic [ref=e147]:
                - generic [ref=e148]: ✅
                - text: Pedro se cadastrou como prestador verificado
              - generic [ref=e150]:
                - generic [ref=e151]: 📋
                - text: 12 orçamentos enviados hoje
              - generic [ref=e153]:
                - generic [ref=e154]: ⚡
                - text: Maria contratou um eletricista em São Paulo
              - generic [ref=e156]:
                - generic [ref=e157]: ⭐
                - text: João avaliou ★★★★★ o prestador Ricardo
              - generic [ref=e159]:
                - generic [ref=e160]: 🎨
                - text: "Nova avaliação: 4.9 para Serviços de Pintura"
              - generic [ref=e162]:
                - generic [ref=e163]: 🔧
                - text: Ana pediu orçamento para encanador
              - generic [ref=e165]:
                - generic [ref=e166]: ✅
                - text: Pedro se cadastrou como prestador verificado
              - generic [ref=e168]:
                - generic [ref=e169]: 📋
                - text: 12 orçamentos enviados hoje
            - generic [ref=e173]:
              - generic [ref=e174]:
                - generic [ref=e175]: 🧹
                - text: Carlos agendou limpeza de quintal em Belo Horizonte
              - generic [ref=e177]:
                - generic [ref=e178]: ⭐
                - text: Fernanda avaliou ★★★★★ o prestador José
              - generic [ref=e180]:
                - generic [ref=e181]: 🛡️
                - text: 8 novos prestadores verificados esta semana
              - generic [ref=e183]:
                - generic [ref=e184]: 🎨
                - text: Luciana contratou um pintor no Rio de Janeiro
              - generic [ref=e186]:
                - generic [ref=e187]: 🚿
                - text: "Orçamento aceito: reforma de banheiro em Curitiba"
              - generic [ref=e189]:
                - generic [ref=e190]: 🏆
                - text: 5.200 serviços concluídos este mês
              - generic [ref=e192]:
                - generic [ref=e193]: 🧹
                - text: Carlos agendou limpeza de quintal em Belo Horizonte
              - generic [ref=e195]:
                - generic [ref=e196]: ⭐
                - text: Fernanda avaliou ★★★★★ o prestador José
              - generic [ref=e198]:
                - generic [ref=e199]: 🛡️
                - text: 8 novos prestadores verificados esta semana
              - generic [ref=e201]:
                - generic [ref=e202]: 🎨
                - text: Luciana contratou um pintor no Rio de Janeiro
              - generic [ref=e204]:
                - generic [ref=e205]: 🚿
                - text: "Orçamento aceito: reforma de banheiro em Curitiba"
              - generic [ref=e207]:
                - generic [ref=e208]: 🏆
                - text: 5.200 serviços concluídos este mês
      - region "Categorias de serviços" [ref=e210]:
        - generic [ref=e211]:
          - generic:
            - img
          - generic [ref=e213]:
            - generic [ref=e214]:
              - img [ref=e215]
              - text: Explore categorias
            - heading "Encontre o serviço ideal" [level=2] [ref=e218]
            - paragraph [ref=e219]: Serviços verificados perto de você — 0 categorias disponíveis
          - generic [ref=e220]:
            - img [ref=e222]
            - generic [ref=e225]:
              - paragraph [ref=e226]: Nenhuma categoria disponível
              - paragraph [ref=e227]: As categorias aparecerão aqui assim que estiverem disponíveis. Tente recarregar a página.
            - button "Tentar carregar categorias novamente" [ref=e228]:
              - img
              - text: Tentar novamente
      - region "Resultados da busca" [ref=e229]:
        - generic [ref=e230]:
          - complementary [ref=e231]:
            - generic [ref=e233]:
              - generic [ref=e234]:
                - heading "Filtros" [level=2] [ref=e235]:
                  - img [ref=e236]
                  - text: Filtros
                - button "Limpar filtros" [ref=e237]
              - generic [ref=e238]:
                - generic [ref=e239]: Buscar
                - generic [ref=e240]:
                  - img [ref=e241]
                  - textbox "Buscar" [ref=e244]:
                    - /placeholder: Serviço, prestador…
              - generic [ref=e245]:
                - generic [ref=e246]:
                  - generic [ref=e247]: Raio de busca
                  - generic [ref=e248]: 15 km
                - generic "Raio de busca em quilômetros" [ref=e249]:
                  - slider [ref=e253]
                - generic [ref=e254]:
                  - generic [ref=e255]: 1 km
                  - generic [ref=e256]: 50 km
              - generic [ref=e257]:
                - generic [ref=e258]: Categoria
                - combobox [ref=e259]:
                  - generic: Todas as categorias
                  - img
              - generic [ref=e260]:
                - generic [ref=e261]: Ordenar por
                - radiogroup "Ordenar por" [ref=e262]:
                  - radio "Melhor avaliação" [checked] [ref=e263]
                  - radio "Mais próximos" [ref=e264]
              - generic [ref=e265]:
                - generic [ref=e266]: Avaliação mínima
                - radiogroup [ref=e267]:
                  - generic [ref=e268] [cursor=pointer]:
                    - radio "Todas" [checked] [ref=e269]:
                      - img [ref=e270]
                    - generic [ref=e272]: Todas
                  - generic [ref=e273] [cursor=pointer]:
                    - radio "3+" [ref=e274]
                    - generic [ref=e275]: 3+
                  - generic [ref=e276] [cursor=pointer]:
                    - radio "4+" [ref=e277]
                    - generic [ref=e278]: 4+
                  - generic [ref=e279] [cursor=pointer]:
                    - radio "5" [ref=e280]
                    - generic [ref=e281]: "5"
              - generic [ref=e282] [cursor=pointer]:
                - generic [ref=e283]:
                  - img [ref=e284]
                  - generic [ref=e286]: Somente verificados
                - switch "Somente verificados" [ref=e287]
              - button "Ver 3 resultados" [disabled]
          - generic [ref=e288]:
            - generic [ref=e290]:
              - generic [ref=e291]:
                - heading "3 prestadores encontrados" [level=2] [ref=e292]
                - paragraph [ref=e293]: Exibindo 1–3 de 3
              - generic [ref=e294]:
                - generic [ref=e295]:
                  - text: "Ordenado por:"
                  - generic [ref=e296]: Melhor avaliação
                - tablist "Visualização" [ref=e297]:
                  - tab "Lista" [selected] [ref=e298]:
                    - img [ref=e299]
                    - generic [ref=e300]: Lista
                  - tab "Mapa" [ref=e301]:
                    - img [ref=e302]
                    - generic [ref=e304]: Mapa
            - generic [ref=e306]:
              - generic [ref=e308]:
                - generic [ref=e309]:
                  - img "Capa de Maria Silva" [ref=e310]
                  - generic [ref=e312]:
                    - img [ref=e313]
                    - text: Verificado
                  - generic [ref=e316]:
                    - button "Adicionar Maria Silva à comparação" [ref=e317]:
                      - img [ref=e318]
                    - button "Adicionar Maria Silva aos favoritos" [ref=e323]:
                      - img [ref=e324]
                  - img "Maria Silva" [ref=e328]
                - generic [ref=e329]:
                  - generic [ref=e330]:
                    - button "Ver perfil de Maria Silva" [ref=e331]:
                      - heading "Maria Silva" [level=3] [ref=e332]:
                        - generic [ref=e333]: Maria Silva
                        - img [ref=e334]
                    - generic "Avaliação média" [ref=e336]:
                      - img [ref=e337]
                      - text: "4.8"
                      - generic [ref=e339]: (42)
                  - paragraph [ref=e340]: a partir de R$ 120,00
                  - generic [ref=e341]:
                    - generic [ref=e342]:
                      - img [ref=e343]
                      - text: 2,5 km
                    - generic [ref=e346]:
                      - img [ref=e347]
                      - text: São Paulo
                  - paragraph [ref=e350]: Especialista em instalações elétricas residenciais com mais de 10 anos de experiência.
                  - generic [ref=e351]:
                    - generic "Serviços concluídos com sucesso" [ref=e352]:
                      - img [ref=e353]
                      - text: 230 serviços concluídos
                    - generic "Na plataforma desde" [ref=e356]:
                      - img [ref=e357]
                      - text: desde jan. de 2023
                - generic [ref=e361]:
                  - generic [ref=e362]:
                    - img [ref=e363]
                    - generic [ref=e365]: Instalação Elétrica · a partir de R$ 120,00
                  - heading "Elétrica 1 serviço" [level=3] [ref=e368]:
                    - button "Elétrica 1 serviço" [ref=e369]:
                      - generic [ref=e371]:
                        - paragraph [ref=e372]: Elétrica
                        - paragraph [ref=e373]: 1 serviço
                      - img
                - generic [ref=e374]:
                  - button "Orçamento" [ref=e375]:
                    - img
                    - text: Orçamento
                  - button "Agendar" [ref=e376]:
                    - img
                    - text: Agendar
              - generic [ref=e378]:
                - generic [ref=e379]:
                  - img "Capa de João Pedreiro" [ref=e380]
                  - generic [ref=e382]:
                    - img [ref=e383]
                    - text: Verificado
                  - generic [ref=e386]:
                    - button "Adicionar João Pedreiro à comparação" [ref=e387]:
                      - img [ref=e388]
                    - button "Adicionar João Pedreiro aos favoritos" [ref=e393]:
                      - img [ref=e394]
                  - img "João Pedreiro" [ref=e398]
                - generic [ref=e399]:
                  - generic [ref=e400]:
                    - button "Ver perfil de João Pedreiro" [ref=e401]:
                      - heading "João Pedreiro" [level=3] [ref=e402]:
                        - generic [ref=e403]: João Pedreiro
                        - img [ref=e404]
                    - generic "Avaliação média" [ref=e406]:
                      - img [ref=e407]
                      - text: "4.8"
                      - generic [ref=e409]: (42)
                  - paragraph [ref=e410]: a partir de R$ 120,00
                  - generic [ref=e411]:
                    - generic [ref=e412]:
                      - img [ref=e413]
                      - text: 2,5 km
                    - generic [ref=e416]:
                      - img [ref=e417]
                      - text: São Paulo
                  - paragraph [ref=e420]: Especialista em instalações elétricas residenciais com mais de 10 anos de experiência.
                  - generic [ref=e421]:
                    - generic "Serviços concluídos com sucesso" [ref=e422]:
                      - img [ref=e423]
                      - text: 230 serviços concluídos
                    - generic "Na plataforma desde" [ref=e426]:
                      - img [ref=e427]
                      - text: desde jan. de 2023
                - generic [ref=e431]:
                  - generic [ref=e432]:
                    - img [ref=e433]
                    - generic [ref=e435]: Instalação Elétrica · a partir de R$ 120,00
                  - heading "Construção 1 serviço" [level=3] [ref=e438]:
                    - button "Construção 1 serviço" [ref=e439]:
                      - generic [ref=e441]:
                        - paragraph [ref=e442]: Construção
                        - paragraph [ref=e443]: 1 serviço
                      - img
                - generic [ref=e444]:
                  - button "Orçamento" [ref=e445]:
                    - img
                    - text: Orçamento
                  - button "Agendar" [ref=e446]:
                    - img
                    - text: Agendar
              - generic [ref=e448]:
                - generic [ref=e449]:
                  - img "Capa de Ana Pintora" [ref=e450]
                  - generic [ref=e452]:
                    - img [ref=e453]
                    - text: Verificado
                  - generic [ref=e456]:
                    - button "Adicionar Ana Pintora à comparação" [ref=e457]:
                      - img [ref=e458]
                    - button "Adicionar Ana Pintora aos favoritos" [ref=e463]:
                      - img [ref=e464]
                  - img "Ana Pintora" [ref=e468]
                - generic [ref=e469]:
                  - generic [ref=e470]:
                    - button "Ver perfil de Ana Pintora" [ref=e471]:
                      - heading "Ana Pintora" [level=3] [ref=e472]:
                        - generic [ref=e473]: Ana Pintora
                        - img [ref=e474]
                    - generic "Avaliação média" [ref=e476]:
                      - img [ref=e477]
                      - text: "4.8"
                      - generic [ref=e479]: (42)
                  - paragraph [ref=e480]: a partir de R$ 120,00
                  - generic [ref=e481]:
                    - generic [ref=e482]:
                      - img [ref=e483]
                      - text: 2,5 km
                    - generic [ref=e486]:
                      - img [ref=e487]
                      - text: São Paulo
                  - paragraph [ref=e490]: Especialista em instalações elétricas residenciais com mais de 10 anos de experiência.
                  - generic [ref=e491]:
                    - generic "Serviços concluídos com sucesso" [ref=e492]:
                      - img [ref=e493]
                      - text: 230 serviços concluídos
                    - generic "Na plataforma desde" [ref=e496]:
                      - img [ref=e497]
                      - text: desde jan. de 2023
                - generic [ref=e501]:
                  - generic [ref=e502]:
                    - img [ref=e503]
                    - generic [ref=e505]: Instalação Elétrica · a partir de R$ 120,00
                  - heading "Pintura 1 serviço" [level=3] [ref=e508]:
                    - button "Pintura 1 serviço" [ref=e509]:
                      - generic [ref=e511]:
                        - paragraph [ref=e512]: Pintura
                        - paragraph [ref=e513]: 1 serviço
                      - img
                - generic [ref=e514]:
                  - button "Orçamento" [ref=e515]:
                    - img
                    - text: Orçamento
                  - button "Agendar" [ref=e516]:
                    - img
                    - text: Agendar
      - region "Como funciona" [ref=e517]:
        - generic [ref=e522]:
          - generic [ref=e523]:
            - link "Pular para resultados" [ref=e524] [cursor=pointer]:
              - /url: "#vitrine-resultados"
              - img [ref=e525]
              - text: Pular para resultados
            - generic [ref=e529]:
              - img [ref=e530]
              - generic [ref=e532]: "4"
              - text: passos simples
            - heading "Como funciona" [level=2] [ref=e533]
            - paragraph [ref=e534]: Sem surpresas — do início ao fim, você tem o controle.
            - generic [ref=e535]:
              - img [ref=e536]
              - text: Sem compromisso
          - generic [ref=e542]:
            - img [ref=e544]
            - generic [ref=e545]:
              - 'button "1 Busque o serviço Encontre prestadores verificados perto de você. 50 + categorias encanador em São Paulo | Verificados < 5 km Mais filtros Ex: Busque ''encanador em São Paulo'' Buscar prestadores" [ref=e546] [cursor=pointer]':
                - generic [ref=e548]:
                  - generic [ref=e550]: "1"
                  - img [ref=e553]
                  - heading "Busque o serviço" [level=3] [ref=e556]
                  - paragraph [ref=e557]: Encontre prestadores verificados perto de você.
                  - generic [ref=e559]:
                    - generic [ref=e560]: "50"
                    - text: +
                    - generic [ref=e561]: categorias
                  - generic [ref=e563]:
                    - generic [ref=e564]:
                      - img [ref=e565]
                      - generic [ref=e568]: encanador em São Paulo
                      - generic [ref=e569]: "|"
                    - generic [ref=e570]:
                      - generic [ref=e571]: Verificados
                      - generic [ref=e572]: < 5 km
                      - generic [ref=e573]:
                        - img [ref=e574]
                        - text: Mais filtros
                  - paragraph [ref=e576]: "Ex: Busque 'encanador em São Paulo'"
                  - button "Buscar prestadores" [ref=e577]:
                    - text: Buscar prestadores
                    - img
              - 'button "2 Compare orçamentos Receba e compare propostas lado a lado. 3 orçamentos em 24h João S. R$ 180 Maria L. R$ 150 Melhor avaliação Compare lado a lado Ex: Compare 3 orçamentos em 24h Sem compromisso Pedir orçamento" [ref=e578] [cursor=pointer]':
                - generic [ref=e580]:
                  - generic [ref=e582]: "2"
                  - img [ref=e585]
                  - heading "Compare orçamentos" [level=3] [ref=e590]
                  - paragraph [ref=e591]: Receba e compare propostas lado a lado.
                  - generic [ref=e593]:
                    - generic [ref=e594]: "3"
                    - generic [ref=e595]: orçamentos em 24h
                  - generic [ref=e597]:
                    - generic [ref=e598]:
                      - generic [ref=e599]:
                        - generic [ref=e602]: João S.
                        - generic [ref=e603]:
                          - img [ref=e604]
                          - img [ref=e606]
                          - img [ref=e608]
                          - img [ref=e610]
                          - img [ref=e612]
                        - generic [ref=e614]: R$ 180
                      - generic [ref=e615]:
                        - generic [ref=e618]: Maria L.
                        - generic [ref=e619]:
                          - img [ref=e620]
                          - img [ref=e622]
                          - img [ref=e624]
                          - img [ref=e626]
                          - img [ref=e628]
                        - generic [ref=e630]: R$ 150
                        - generic [ref=e631]: Melhor avaliação
                    - generic [ref=e632]:
                      - img [ref=e633]
                      - text: Compare lado a lado
                  - paragraph [ref=e638]: "Ex: Compare 3 orçamentos em 24h"
                  - generic [ref=e639]:
                    - img [ref=e640]
                    - text: Sem compromisso
                  - button "Pedir orçamento" [ref=e645]:
                    - text: Pedir orçamento
                    - img
              - 'button "3 Agende com confiança Solicite um orçamento ou agende diretamente. 24 h para confirmar Março 2025 S T Q Q S S D 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 12 Mar, 14:00 — Confirmado Ex: Agende para amanhã às 14h Agendar agora" [ref=e646] [cursor=pointer]':
                - generic [ref=e648]:
                  - generic [ref=e650]: "3"
                  - img [ref=e653]
                  - heading "Agende com confiança" [level=3] [ref=e656]
                  - paragraph [ref=e657]: Solicite um orçamento ou agende diretamente.
                  - generic [ref=e659]:
                    - generic [ref=e660]: "24"
                    - text: h
                    - generic [ref=e661]: para confirmar
                  - generic [ref=e664]:
                    - generic [ref=e665]: Março 2025
                    - generic [ref=e666]:
                      - generic [ref=e667]: S
                      - generic [ref=e668]: T
                      - generic [ref=e669]: Q
                      - generic [ref=e670]: Q
                      - generic [ref=e671]: S
                      - generic [ref=e672]: S
                      - generic [ref=e673]: D
                      - generic [ref=e674]: "1"
                      - generic [ref=e675]: "2"
                      - generic [ref=e676]: "3"
                      - generic [ref=e677]: "4"
                      - generic [ref=e678]: "5"
                      - generic [ref=e679]: "6"
                      - generic [ref=e680]: "7"
                      - generic [ref=e681]: "8"
                      - generic [ref=e682]: "9"
                      - generic [ref=e683]: "10"
                      - generic [ref=e684]: "11"
                      - generic [ref=e685]: "12"
                      - generic [ref=e686]: "13"
                      - generic [ref=e687]: "14"
                      - generic [ref=e688]: "15"
                    - generic [ref=e689]:
                      - img [ref=e690]
                      - generic [ref=e693]: 12 Mar, 14:00 — Confirmado
                  - paragraph [ref=e694]: "Ex: Agende para amanhã às 14h"
                  - button "Agendar agora" [ref=e695]:
                    - text: Agendar agora
                    - img
              - 'button "4 Avalie o resultado Sua opinião mantém a qualidade da comunidade. 98 % satisfação 4.0 \"Excelente trabalho, recomendo!\" Avaliação verificada Ex: Avalie de 1 a 5 estrelas com comentário Cadastrar grátis" [ref=e696] [cursor=pointer]':
                - generic [ref=e698]:
                  - generic [ref=e700]: "4"
                  - img [ref=e703]
                  - heading "Avalie o resultado" [level=3] [ref=e705]
                  - paragraph [ref=e706]: Sua opinião mantém a qualidade da comunidade.
                  - generic [ref=e708]:
                    - generic [ref=e709]: "98"
                    - text: "%"
                    - generic [ref=e710]: satisfação
                  - generic [ref=e712]:
                    - generic [ref=e713]:
                      - generic [ref=e714]:
                        - img [ref=e715]
                        - img [ref=e717]
                        - img [ref=e719]
                        - img [ref=e721]
                        - img [ref=e723]
                        - generic [ref=e725]: "4.0"
                      - paragraph [ref=e728]: "\"Excelente trabalho, recomendo!\""
                    - generic [ref=e729]:
                      - img [ref=e730]
                      - text: Avaliação verificada
                  - paragraph [ref=e733]: "Ex: Avalie de 1 a 5 estrelas com comentário"
                  - button "Cadastrar grátis" [ref=e734]:
                    - text: Cadastrar grátis
                    - img
          - generic [ref=e735]:
            - generic [ref=e736]:
              - img [ref=e737]
              - generic [ref=e740]: Garantia Severinno
            - generic [ref=e741]:
              - generic [ref=e742]:
                - img [ref=e743]
                - generic [ref=e746]: Prestadores verificados
              - generic [ref=e747]:
                - img [ref=e748]
                - generic [ref=e751]: Resposta rápida
              - generic [ref=e752]:
                - img [ref=e753]
                - generic [ref=e755]: Satisfação garantida
              - generic [ref=e756]:
                - img [ref=e757]
                - generic [ref=e762]: Compare antes de contratar
          - generic [ref=e763]:
            - button "Começar agora" [ref=e764]:
              - text: Começar agora
              - img
            - link "Buscar prestadores" [ref=e765] [cursor=pointer]:
              - /url: "#vitrine-resultados"
              - img
              - text: Buscar prestadores
          - button "Voltar ao topo" [ref=e767]:
            - img [ref=e768]
            - text: Voltar ao topo
      - generic [ref=e771]:
        - generic [ref=e772]:
          - generic [ref=e773]:
            - img
            - text: Simulador de preços
          - heading "Quanto custa? Simule agora" [level=2] [ref=e774]
          - paragraph [ref=e775]: Estime o valor do serviço em 3 passos rápidos. Sem compromisso, sem cadastro.
        - generic [ref=e776]:
          - generic [ref=e777]: "1"
          - generic [ref=e779]: "2"
          - generic [ref=e781]: "3"
        - generic [ref=e784]:
          - heading "1. Qual serviço você precisa?" [level=3] [ref=e785]
          - paragraph [ref=e786]: Selecione a categoria do serviço
          - generic [ref=e787]:
            - button "Elétrica" [ref=e788]:
              - img [ref=e790]
              - generic [ref=e792]: Elétrica
            - button "Hidráulica" [ref=e793]:
              - img [ref=e795]
              - generic [ref=e798]: Hidráulica
            - button "Pintura" [ref=e799]:
              - img [ref=e801]
              - generic [ref=e805]: Pintura
            - button "Alvenaria" [ref=e806]:
              - img [ref=e808]
              - generic [ref=e810]: Alvenaria
            - button "Pisos" [ref=e811]:
              - img [ref=e813]
              - generic [ref=e815]: Pisos
            - button "Pós-obra" [ref=e816]:
              - img [ref=e818]
              - generic [ref=e823]: Pós-obra
            - button "Residencial" [ref=e824]:
              - img [ref=e826]
              - generic [ref=e829]: Residencial
      - region "Parceiros e imprensa" [ref=e830]:
        - generic [ref=e831]:
          - paragraph [ref=e833]: Referência no mercado
          - generic [ref=e835]:
            - generic [ref=e838]: G1
            - generic [ref=e841]: Folha de S.Paulo
            - generic [ref=e844]: Valor Econômico
            - generic [ref=e847]: Exame
            - generic [ref=e850]: InfoMoney
            - generic [ref=e853]: Startups
            - generic [ref=e856]: Sebrae
            - generic [ref=e859]: ABES
          - paragraph [ref=e860]: + de 6.000 prestadores confiam no Severinno
      - region "Avaliações de clientes" [ref=e861]:
        - generic:
          - generic:
            - img
        - generic [ref=e862]:
          - generic [ref=e863]:
            - generic [ref=e864]:
              - img [ref=e865]
              - text: Avaliações reais
            - heading "O que nossos clientes dizem" [level=2] [ref=e867]
            - paragraph [ref=e868]: Avaliações de clientes após a conclusão do serviço.
          - generic [ref=e869]:
            - img [ref=e871]
            - heading "Não foi possível carregar as avaliações" [level=3] [ref=e876]
            - paragraph [ref=e877]: Ocorreu um erro ao buscar as avaliações. Tente novamente.
            - button "Tentar novamente" [ref=e878]:
              - img
              - text: Tentar novamente
      - generic [ref=e879]:
        - generic [ref=e882]:
          - generic [ref=e883]:
            - img [ref=e885]
            - generic [ref=e890]: "0"
            - paragraph [ref=e891]: Prestadores verificados
          - generic [ref=e892]:
            - img [ref=e894]
            - generic [ref=e896]: "0"
            - paragraph [ref=e897]: Serviços cadastrados
          - generic [ref=e898]:
            - img [ref=e900]
            - generic [ref=e903]: "0"
            - paragraph [ref=e904]: Serviços concluídos
          - generic [ref=e905]:
            - img [ref=e907]
            - generic [ref=e910]: 0.0/5
            - paragraph [ref=e911]: Nota média
        - generic [ref=e913]:
          - generic [ref=e914]:
            - generic [ref=e915]:
              - img [ref=e916]
              - text: Por que Severinno?
            - heading "Confiança em cada agendamento" [level=2] [ref=e919]
            - paragraph [ref=e920]: Mais que um diretório de serviços — um ecossistema pensado para proteger você e o prestador. Da verificação ao pagamento, cada etapa foi desenhada para a sua tranquilidade.
            - link "Pular para FAQ" [ref=e922] [cursor=pointer]:
              - /url: "#faq"
              - img [ref=e923]
              - text: Pular para FAQ
          - generic [ref=e926]:
            - generic [ref=e929]:
              - generic [ref=e930]:
                - img [ref=e932]
                - button "Saiba mais sobre Prestadores verificados" [ref=e935]:
                  - img [ref=e936]
              - heading "Prestadores verificados" [level=3] [ref=e939]
              - paragraph [ref=e940]: João verificou 3 documentos antes de aprovar o prestador. Você só vê profissionais validados.
              - button "Saiba mais" [ref=e941]:
                - text: Saiba mais
                - img [ref=e942]
            - generic [ref=e946]:
              - generic [ref=e947]:
                - img [ref=e949]
                - button "Saiba mais sobre Pagamento protegido" [ref=e952]:
                  - img [ref=e953]
              - heading "Pagamento protegido" [level=3] [ref=e956]
              - paragraph [ref=e957]: O valor só é liberado ao prestador após você confirmar que ficou satisfeito com o serviço.
              - button "Saiba mais" [ref=e958]:
                - text: Saiba mais
                - img [ref=e959]
            - generic [ref=e963]:
              - generic [ref=e964]:
                - img [ref=e966]
                - button "Saiba mais sobre Resposta rápida" [ref=e969]:
                  - img [ref=e970]
              - heading "Resposta rápida" [level=3] [ref=e973]
              - paragraph [ref=e974]: Prestadores comprometidos a responder em até 24h. Acompanhe o status em tempo real.
              - button "Saiba mais" [ref=e975]:
                - text: Saiba mais
                - img [ref=e976]
            - generic [ref=e980]:
              - generic [ref=e981]:
                - img [ref=e983]
                - button "Saiba mais sobre Avaliações reais" [ref=e985]:
                  - img [ref=e986]
              - heading "Avaliações reais" [level=3] [ref=e989]
              - paragraph [ref=e990]: Apenas clientes que concluíram o serviço podem avaliar. Sem falsas avaliações.
              - button "Saiba mais" [ref=e991]:
                - text: Saiba mais
                - img [ref=e992]
            - generic [ref=e996]:
              - generic [ref=e997]:
                - img [ref=e999]
                - button "Saiba mais sobre Próximo de você" [ref=e1002]:
                  - img [ref=e1003]
              - heading "Próximo de você" [level=3] [ref=e1006]
              - paragraph [ref=e1007]: Geolocalização inteligente mostra os melhores prestadores na sua região.
              - button "Saiba mais" [ref=e1008]:
                - text: Saiba mais
                - img [ref=e1009]
            - generic [ref=e1013]:
              - generic [ref=e1014]:
                - img [ref=e1016]
                - button "Saiba mais sobre Suporte humano" [ref=e1018]:
                  - img [ref=e1019]
              - heading "Suporte humano" [level=3] [ref=e1022]
              - paragraph [ref=e1023]: Equipe disponível para mediar disputas, tirar dúvidas e garantir uma experiência justa.
              - button "Saiba mais" [ref=e1024]:
                - text: Saiba mais
                - img [ref=e1025]
        - generic [ref=e1028]:
          - img [ref=e1029]
          - paragraph [ref=e1031]: "Garantia Severinno: seu dinheiro de volta se o serviço não for bem-feito."
          - link "Saiba mais" [ref=e1032] [cursor=pointer]:
            - /url: "#faq"
            - text: Saiba mais
            - img [ref=e1033]
      - generic [ref=e1036]:
        - generic [ref=e1037]:
          - generic [ref=e1038]:
            - img [ref=e1039]
            - text: Destaque da semana
          - heading "Profissional em destaque" [level=2] [ref=e1045]
          - paragraph [ref=e1046]: Conheça um dos nossos prestadores mais bem avaliados.
        - generic [ref=e1050]:
          - generic [ref=e1051]:
            - generic [ref=e1052]:
              - img [ref=e1055]
              - img [ref=e1059]
              - generic [ref=e1063]:
                - img [ref=e1064]
                - text: Top
            - generic [ref=e1066]:
              - generic [ref=e1067]:
                - heading "Maria Silva" [level=3] [ref=e1068]
                - generic [ref=e1069]:
                  - generic [ref=e1070]:
                    - img [ref=e1071]
                    - text: São Paulo
                  - generic [ref=e1074]: 3 km
                  - generic [ref=e1075]:
                    - img [ref=e1076]
                    - text: Membro desde 2023
              - generic [ref=e1078]:
                - generic [ref=e1079]:
                  - img [ref=e1080]
                  - generic [ref=e1082]: "4.8"
                - generic [ref=e1083]: (42 avaliações)
              - generic [ref=e1084]:
                - generic [ref=e1085]:
                  - img
                  - text: 230 serviços concluídos
                - generic [ref=e1086]:
                  - img
                  - text: Responde em ~30min
              - generic [ref=e1087]:
                - paragraph [ref=e1088]: Serviços
                - generic [ref=e1090]:
                  - generic [ref=e1091]: Instalação Elétrica
                  - generic [ref=e1092]: R$ 120,00
              - paragraph [ref=e1094]: Especialista em instalações elétricas residenciais com mais de 10 anos de experiência.
              - generic [ref=e1095]:
                - generic [ref=e1096]:
                  - generic "Maria S." [ref=e1097]: M
                  - generic "João P." [ref=e1098]: J
                  - generic "Ana L." [ref=e1099]: A
                - generic [ref=e1100]: Clientes recentes
          - generic [ref=e1101]:
            - generic [ref=e1102]:
              - button "Pedir orçamento" [ref=e1103]:
                - img
                - text: Pedir orçamento
              - button "Ver perfil completo" [ref=e1104]:
                - text: Ver perfil completo
                - img
            - button "Enviar mensagem" [ref=e1106]:
              - img
              - text: Enviar mensagem
      - generic [ref=e1110]:
        - generic [ref=e1111]:
          - generic [ref=e1112]:
            - generic [ref=e1113]:
              - img [ref=e1114]
              - text: Perguntas frequentes
            - heading "Tire suas dúvidas antes de contratar" [level=2] [ref=e1117]
            - paragraph [ref=e1118]: Reunimos as perguntas mais comuns sobre como o Severinno funciona — do cadastro ao pagamento.
          - generic [ref=e1119]:
            - img [ref=e1120]
            - textbox "Buscar nas perguntas frequentes" [ref=e1123]:
              - /placeholder: Buscar nas dúvidas…
          - generic [ref=e1124]:
            - paragraph [ref=e1125]: Filtrar por categoria
            - generic [ref=e1126]:
              - button "Filtrar por Geral" [ref=e1127]:
                - img [ref=e1128]
                - text: Geral
                - generic [ref=e1131]: (2)
              - button "Filtrar por Pagamento" [ref=e1132]:
                - img [ref=e1133]
                - text: Pagamento
                - generic [ref=e1135]: (2)
              - button "Filtrar por Agendamento" [ref=e1136]:
                - img [ref=e1137]
                - text: Agendamento
                - generic [ref=e1139]: (2)
              - button "Filtrar por Prestadores" [ref=e1140]:
                - img [ref=e1141]
                - text: Prestadores
                - generic [ref=e1145]: (2)
              - button "Filtrar por Segurança" [ref=e1146]:
                - img [ref=e1147]
                - text: Segurança
                - generic [ref=e1150]: (2)
          - generic [ref=e1151]:
            - paragraph [ref=e1152]: Perguntas mais frequentes
            - list [ref=e1153]:
              - listitem [ref=e1154]:
                - button "Como funciona o Severinno?" [ref=e1155]:
                  - img [ref=e1156]
                  - generic [ref=e1158]: Como funciona o Severinno?
              - listitem [ref=e1159]:
                - button "Preciso pagar para me cadastrar?" [ref=e1160]:
                  - img [ref=e1161]
                  - generic [ref=e1163]: Preciso pagar para me cadastrar?
              - listitem [ref=e1164]:
                - button "Como faço para agendar um serviço?" [ref=e1165]:
                  - img [ref=e1166]
                  - generic [ref=e1168]: Como faço para agendar um serviço?
              - listitem [ref=e1169]:
                - button "E se o serviço não for bem-feito?" [ref=e1170]:
                  - img [ref=e1171]
                  - generic [ref=e1173]: E se o serviço não for bem-feito?
          - generic [ref=e1175]:
            - img [ref=e1177]
            - generic [ref=e1179]:
              - paragraph [ref=e1180]: Ainda tem dúvidas?
              - paragraph [ref=e1181]: Cadastre-se grátis e converse diretamente com prestadores verificados. Sem compromisso.
              - generic [ref=e1182]:
                - button "Cadastrar grátis" [ref=e1183]
                - link "Fale conosco" [ref=e1184] [cursor=pointer]:
                  - /url: "#faq"
                  - img
                  - text: Fale conosco
        - generic [ref=e1185]:
          - generic [ref=e1187]:
            - generic [ref=e1189]:
              - heading "01 Como funciona o Severinno? Geral" [level=3] [ref=e1190]:
                - button "01 Como funciona o Severinno? Geral" [expanded] [ref=e1191]:
                  - generic [ref=e1192]:
                    - generic [ref=e1193]: "01"
                    - generic [ref=e1194]: Como funciona o Severinno?
                    - generic [ref=e1195]:
                      - img
                      - text: Geral
                  - img
              - region "01 Como funciona o Severinno? Geral" [ref=e1196]:
                - generic [ref=e1198]:
                  - paragraph [ref=e1199]: O Severinno conecta você a prestadores de serviço verificados próximos à sua localização. Você busca o serviço, compara avaliações reais de outros clientes, pede orçamento grátis e agenda — tudo pela plataforma. O pagamento só é liberado após você confirmar a conclusão do serviço.
                  - paragraph [ref=e1200]: "Ex: Maria precisava de um eletricista. Buscou na plataforma, comparou 3 profissionais e contratou o mais bem avaliado — tudo em 5 minutos."
            - heading "02 Preciso pagar para me cadastrar? Geral" [level=3] [ref=e1203]:
              - button "02 Preciso pagar para me cadastrar? Geral" [ref=e1204]:
                - generic [ref=e1205]:
                  - generic [ref=e1206]: "02"
                  - generic [ref=e1207]: Preciso pagar para me cadastrar?
                  - generic [ref=e1208]:
                    - img
                    - text: Geral
                - img
            - heading "03 Como os prestadores são verificados? Prestadores" [level=3] [ref=e1211]:
              - button "03 Como os prestadores são verificados? Prestadores" [ref=e1212]:
                - generic [ref=e1213]:
                  - generic [ref=e1214]: "03"
                  - generic [ref=e1215]: Como os prestadores são verificados?
                  - generic [ref=e1216]:
                    - img
                    - text: Prestadores
                - img
            - heading "04 Posso me tornar um prestador no Severinno? Prestadores" [level=3] [ref=e1219]:
              - button "04 Posso me tornar um prestador no Severinno? Prestadores" [ref=e1220]:
                - generic [ref=e1221]:
                  - generic [ref=e1222]: "04"
                  - generic [ref=e1223]: Posso me tornar um prestador no Severinno?
                  - generic [ref=e1224]:
                    - img
                    - text: Prestadores
                - img
            - heading "05 Como faço para agendar um serviço? Agendamento" [level=3] [ref=e1227]:
              - button "05 Como faço para agendar um serviço? Agendamento" [ref=e1228]:
                - generic [ref=e1229]:
                  - generic [ref=e1230]: "05"
                  - generic [ref=e1231]: Como faço para agendar um serviço?
                  - generic [ref=e1232]:
                    - img
                    - text: Agendamento
                - img
            - heading "06 Posso remarcar ou cancelar um agendamento? Agendamento" [level=3] [ref=e1235]:
              - button "06 Posso remarcar ou cancelar um agendamento? Agendamento" [ref=e1236]:
                - generic [ref=e1237]:
                  - generic [ref=e1238]: "06"
                  - generic [ref=e1239]: Posso remarcar ou cancelar um agendamento?
                  - generic [ref=e1240]:
                    - img
                    - text: Agendamento
                - img
            - heading "07 Como funciona o pagamento? Pagamento" [level=3] [ref=e1243]:
              - button "07 Como funciona o pagamento? Pagamento" [ref=e1244]:
                - generic [ref=e1245]:
                  - generic [ref=e1246]: "07"
                  - generic [ref=e1247]: Como funciona o pagamento?
                  - generic [ref=e1248]:
                    - img
                    - text: Pagamento
                - img
            - heading "08 O orçamento tem compromisso? Pagamento" [level=3] [ref=e1251]:
              - button "08 O orçamento tem compromisso? Pagamento" [ref=e1252]:
                - generic [ref=e1253]:
                  - generic [ref=e1254]: "08"
                  - generic [ref=e1255]: O orçamento tem compromisso?
                  - generic [ref=e1256]:
                    - img
                    - text: Pagamento
                - img
            - heading "09 E se o serviço não for bem-feito? Segurança" [level=3] [ref=e1259]:
              - button "09 E se o serviço não for bem-feito? Segurança" [ref=e1260]:
                - generic [ref=e1261]:
                  - generic [ref=e1262]: "09"
                  - generic [ref=e1263]: E se o serviço não for bem-feito?
                  - generic [ref=e1264]:
                    - img
                    - text: Segurança
                - img
            - heading "10 Meus dados pessoais estão seguros? Segurança" [level=3] [ref=e1267]:
              - button "10 Meus dados pessoais estão seguros? Segurança" [ref=e1268]:
                - generic [ref=e1269]:
                  - generic [ref=e1270]: "10"
                  - generic [ref=e1271]: Meus dados pessoais estão seguros?
                  - generic [ref=e1272]:
                    - img
                    - text: Segurança
                - img
          - generic [ref=e1273]:
            - paragraph [ref=e1274]: 10 de 10 dúvidas
            - button "Voltar ao topo da seção" [ref=e1275]:
              - img [ref=e1276]
              - text: Topo
      - generic [ref=e1280]:
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
        - generic [ref=e1285]:
          - generic [ref=e1286]:
            - generic [ref=e1288]:
              - img [ref=e1289]
              - text: Comece agora mesmo
            - heading "Encontre o serviço que você precisa" [level=2] [ref=e1291]
            - paragraph [ref=e1292]: Navegue pela vitrine, salve seus favoritos e agende com confiança. Tudo em um só lugar.
            - list [ref=e1293]:
              - generic [ref=e1294]:
                - listitem [ref=e1295]:
                  - img [ref=e1296]
                  - text: Cadastro gratuito
                - listitem [ref=e1299]:
                  - img [ref=e1300]
                  - text: Sem taxa de serviço
                - listitem [ref=e1303]:
                  - img [ref=e1304]
                  - text: Orçamento sem compromisso
            - button "Buscar prestadores" [ref=e1312]:
              - img
              - text: Buscar prestadores
              - generic [ref=e1313]:
                - img
          - generic [ref=e1314]:
            - generic [ref=e1315]:
              - heading "O que vem depois?" [level=3] [ref=e1316]
              - paragraph [ref=e1317]: Três passos simples e você estará agendando
              - generic [ref=e1318]:
                - img [ref=e1319]
                - generic [ref=e1320]:
                  - generic [ref=e1321]:
                    - generic [ref=e1323]: "1"
                    - generic [ref=e1324]:
                      - paragraph [ref=e1325]: Cadastre-se grátis
                      - paragraph [ref=e1326]: ~30s
                  - generic [ref=e1327]:
                    - generic [ref=e1329]: "2"
                    - generic [ref=e1330]:
                      - paragraph [ref=e1331]: Busque e compare
                      - paragraph [ref=e1332]: ~2 min
                  - generic [ref=e1333]:
                    - generic [ref=e1335]: "3"
                    - generic [ref=e1336]:
                      - paragraph [ref=e1337]: Agende com confiança
                      - paragraph [ref=e1338]: ~5 min
              - generic [ref=e1339]:
                - generic [ref=e1340]:
                  - img [ref=e1341]
                  - text: Sem compromisso
                - generic [ref=e1345]:
                  - img [ref=e1346]
                  - text: Cancele quando quiser
                - generic [ref=e1349]:
                  - img [ref=e1350]
                  - text: Suporte 24h
              - link "Saiba mais sobre pagamento protegido" [ref=e1353] [cursor=pointer]:
                - /url: "#faq"
                - img [ref=e1354]
                - text: Saiba mais sobre pagamento protegido
            - generic [ref=e1358]:
              - generic [ref=e1362]: Cliente
              - generic [ref=e1363]:
                - img [ref=e1367]
                - generic [ref=e1369]: Prestador
              - img [ref=e1374]
              - img [ref=e1376]
              - img [ref=e1380]
              - img [ref=e1383]
              - img [ref=e1387]
        - generic [ref=e1391]:
          - img [ref=e1392]
          - generic [ref=e1395]:
            - paragraph [ref=e1396]: “Encontrei um encanador em 10 minutos, paguei menos do que esperava e ainda pude avaliar o serviço. Recomendo demais!”
            - paragraph [ref=e1397]: — Ana P., Cliente, São Paulo
        - generic [ref=e1398]:
          - generic [ref=e1399]:
            - img [ref=e1400]
            - text: Sem compromisso
          - generic [ref=e1404]:
            - img [ref=e1405]
            - text: Cancele quando quiser
          - generic [ref=e1408]:
            - img [ref=e1409]
            - text: Pagamento protegido
    - contentinfo [ref=e1411]:
      - generic [ref=e1413]:
        - generic [ref=e1414]:
          - paragraph [ref=e1415]: Receba novidades e dicas de serviços
          - paragraph [ref=e1416]: Cadastre-se e receba ofertas exclusivas. Cancele quando quiser.
        - generic [ref=e1417]:
          - generic [ref=e1418]:
            - img [ref=e1419]
            - textbox "E-mail para newsletter" [ref=e1422]:
              - /placeholder: Seu e-mail
          - button "Assinar" [disabled]:
            - img
            - text: Assinar
      - generic [ref=e1423]:
        - generic [ref=e1424]:
          - generic [ref=e1425]:
            - generic [ref=e1426]:
              - img [ref=e1428]
              - generic [ref=e1431]: Severinno
            - paragraph [ref=e1432]: Marketplace de serviços com geolocalização. Encontre prestadores verificados, próximos e bem avaliados.
            - list "Redes sociais" [ref=e1433]:
              - listitem [ref=e1434]:
                - link "GitHub" [ref=e1435] [cursor=pointer]:
                  - /url: https://github.com
                  - img [ref=e1436]
              - listitem [ref=e1439]:
                - link "Twitter" [ref=e1440] [cursor=pointer]:
                  - /url: https://twitter.com
                  - img [ref=e1441]
              - listitem [ref=e1443]:
                - link "Instagram" [ref=e1444] [cursor=pointer]:
                  - /url: https://instagram.com
                  - img [ref=e1445]
              - listitem [ref=e1448]:
                - link "LinkedIn" [ref=e1449] [cursor=pointer]:
                  - /url: https://linkedin.com
                  - img [ref=e1450]
              - listitem [ref=e1454]:
                - link "E-mail" [ref=e1455] [cursor=pointer]:
                  - /url: mailto:contato@severinno.com
                  - img [ref=e1456]
          - navigation "Sobre" [ref=e1459]:
            - heading "Sobre" [level=3] [ref=e1460]:
              - img [ref=e1461]
              - text: Sobre
            - list [ref=e1464]:
              - listitem [ref=e1465]:
                - button "Como funciona" [ref=e1466]
              - listitem [ref=e1467]:
                - button "Quem somos" [ref=e1468]
              - listitem [ref=e1469]:
                - button "Termos de uso" [ref=e1470]
              - listitem [ref=e1471]:
                - button "Privacidade" [ref=e1472]
          - navigation "Para profissionais" [ref=e1473]:
            - heading "Para profissionais" [level=3] [ref=e1474]:
              - img [ref=e1475]
              - text: Para profissionais
            - list [ref=e1478]:
              - listitem [ref=e1479]:
                - button "Cadastre-se" [ref=e1480]
              - listitem [ref=e1481]:
                - button "Meu painel" [ref=e1482]
              - listitem [ref=e1483]:
                - button "Central de ajuda" [ref=e1484]
          - navigation "Precisa de ajuda?" [ref=e1485]:
            - heading "Precisa de ajuda?" [level=3] [ref=e1486]:
              - img [ref=e1487]
              - text: Precisa de ajuda?
            - list [ref=e1489]:
              - listitem [ref=e1490]:
                - button "Perguntas frequentes" [ref=e1491]
              - listitem [ref=e1492]:
                - button "Segurança" [ref=e1493]
              - listitem [ref=e1494]:
                - button "Reportar problema" [ref=e1495]
          - generic [ref=e1496]:
            - heading "Contato" [level=3] [ref=e1497]:
              - img [ref=e1498]
              - text: Contato
            - list [ref=e1503]:
              - listitem [ref=e1504]:
                - img [ref=e1505]
                - link "contato@severinno.com" [ref=e1508] [cursor=pointer]:
                  - /url: mailto:contato@severinno.com
              - listitem [ref=e1509]:
                - img [ref=e1510]
                - text: São Paulo, Brasil
            - button "Fale conosco" [ref=e1513]:
              - img
              - text: Fale conosco
        - generic [ref=e1514]:
          - paragraph [ref=e1515]: © 2026 Severinno Marketplace. Todos os direitos reservados.
          - paragraph [ref=e1516]:
            - text: Feito com
            - img [ref=e1517]
            - text: usando tecnologia Open Source (
            - link "MapLibre" [ref=e1519] [cursor=pointer]:
              - /url: https://maplibre.org/
            - text: ·
            - link "OpenStreetMap" [ref=e1520] [cursor=pointer]:
              - /url: https://www.openstreetmap.org/copyright
            - text: )
    - button "Abrir assistente virtual" [ref=e1521]:
      - img [ref=e1522]
    - generic [ref=e1526]:
      - generic [ref=e1527]:
        - img [ref=e1529]
        - generic [ref=e1531]:
          - paragraph [ref=e1532]: Usamos cookies para melhorar sua experiência
          - paragraph [ref=e1533]:
            - text: Utilizamos cookies essenciais para o funcionamento do site e cookies de análise para melhorar nossos serviços.
            - button "Política de privacidade" [ref=e1534]
      - generic [ref=e1535]:
        - button "Recusar" [ref=e1536]
        - button "Aceitar" [ref=e1537]:
          - img
          - text: Aceitar
        - button "Dispensar" [ref=e1538]:
          - img [ref=e1539]
  - region "Notifications alt+T"
  - generic [active]:
    - generic [ref=e1544]:
      - generic [ref=e1545]:
        - generic [ref=e1546]:
          - navigation [ref=e1547]:
            - button "previous" [disabled] [ref=e1548]:
              - img "previous" [ref=e1549]
            - generic [ref=e1551]:
              - generic [ref=e1552]: 1/
              - text: "1"
            - button "next" [disabled] [ref=e1553]:
              - img "next" [ref=e1554]
          - img
        - generic [ref=e1556]:
          - link "Next.js 16.1.3 (stale) Turbopack" [ref=e1557] [cursor=pointer]:
            - /url: https://nextjs.org/docs/messages/version-staleness
            - img [ref=e1558]
            - generic "There is a newer version (16.2.11) available, upgrade recommended!" [ref=e1560]: Next.js 16.1.3 (stale)
            - generic [ref=e1561]: Turbopack
          - img
      - dialog "Build Error" [ref=e1563]:
        - generic [ref=e1566]:
          - generic [ref=e1567]:
            - generic [ref=e1568]:
              - generic [ref=e1570]: Build Error
              - generic [ref=e1571]:
                - button "Copy Error Info" [ref=e1572] [cursor=pointer]:
                  - img [ref=e1573]
                - button "No related documentation found" [disabled] [ref=e1575]:
                  - img [ref=e1576]
                - button "Attach Node.js inspector" [ref=e1578] [cursor=pointer]:
                  - img [ref=e1579]
            - generic [ref=e1588]: Reading source code for parsing failed
          - generic [ref=e1590]:
            - generic [ref=e1592]:
              - img [ref=e1594]
              - generic [ref=e1598]: ./.freebuff/worktrees/thmrzp9vv9y86o/src/lib/api-server.ts
              - button "Open in editor" [ref=e1599] [cursor=pointer]:
                - img [ref=e1601]
            - generic [ref=e1605]: "Reading source code for parsing failed An unexpected error happened while trying to read the source code to parse: failed to convert rope into string Caused by: - invalid utf-8 sequence of 1 bytes from index 5415 Import trace: App Route: ./.freebuff/worktrees/thmrzp9vv9y86o/src/lib/api-server.ts ./.freebuff/worktrees/thmrzp9vv9y86o/src/app/api/auth/me/route.ts"
        - generic [ref=e1606]: "1"
        - generic [ref=e1607]: "2"
    - generic [ref=e1612] [cursor=pointer]:
      - button "Open Next.js Dev Tools" [ref=e1613]:
        - img [ref=e1614]
      - button "Open issues overlay" [ref=e1618]:
        - generic [ref=e1619]:
          - generic [ref=e1620]: "0"
          - generic [ref=e1621]: "1"
        - generic [ref=e1622]: Issue
  - alert [ref=e1623]
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