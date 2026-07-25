# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: auth.spec.ts >> Autenticação >> login com credenciais inválidas mostra erro
- Location: e2e\auth.spec.ts:39:7

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.fill: Test timeout of 30000ms exceeded.
Call log:
  - waiting for getByPlaceholder(/email/i).first()

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
          - generic [ref=e31]:
            - button "Entrar" [ref=e32]
            - button "Cadastrar" [ref=e33]
    - main [ref=e34]:
      - generic [ref=e41]:
        - generic [ref=e42]:
          - generic [ref=e44]:
            - img [ref=e45]
            - text: Marketplace de serviços verificados
          - heading "Prestadores de serviço verificados, perto de você." [level=1] [ref=e48]
          - paragraph [ref=e49]: Compare avaliações reais, peça orçamento grátis e agende — encanador, eletricista, pintor e mais. Você escolhe o profissional.
          - generic [ref=e51]:
            - generic [ref=e52]:
              - img [ref=e53]
              - textbox "Serviço buscado" [ref=e56]:
                - /placeholder: "O que você precisa? Ex.: encanador, pintura…"
            - generic [ref=e57]:
              - img [ref=e58]
              - textbox "Localização" [ref=e61]:
                - /placeholder: CEP ou cidade
            - button "Buscar" [ref=e62]:
              - img
              - text: Buscar
          - generic [ref=e63]:
            - generic [ref=e64]: "Mais buscados:"
            - button "Encanador" [ref=e65]:
              - generic [ref=e66]: 🔧
              - text: Encanador
            - button "Eletricista" [ref=e67]:
              - generic [ref=e68]: 💡
              - text: Eletricista
            - button "Pintor" [ref=e69]:
              - generic [ref=e70]: 🎨
              - text: Pintor
            - button "Diarista" [ref=e71]:
              - generic [ref=e72]: 🧹
              - text: Diarista
            - button "Pedreiro" [ref=e73]:
              - generic [ref=e74]: 🧱
              - text: Pedreiro
            - button "Jardineiro" [ref=e75]:
              - generic [ref=e76]: 🌿
              - text: Jardineiro
          - button "Usar minha localização" [ref=e77]:
            - img [ref=e78]
            - text: Usar minha localização
          - generic [ref=e81]:
            - button "Cadastrar grátis" [ref=e82]:
              - text: Cadastrar grátis
              - img
            - button "Ver como funciona" [ref=e83]
          - paragraph [ref=e84]: Cadastro grátis · Orçamento sem compromisso · Você escolhe o profissional
          - list [ref=e85]:
            - listitem "Documentos validados e identidade confirmada" [ref=e86]:
              - img [ref=e88]
              - generic [ref=e91]: Prestadores verificados
            - listitem "Avaliações de clientes após a conclusão do serviço" [ref=e92]:
              - img [ref=e94]
              - generic [ref=e96]: Avaliações reais
            - listitem "Pagamento só é liberado após você marcar como concluído" [ref=e97]:
              - img [ref=e99]
              - generic [ref=e102]: Pagamento seguro
        - generic [ref=e105]:
          - generic [ref=e111]: Atividade ao vivo
          - generic [ref=e113]:
            - img [ref=e114]
            - paragraph [ref=e116]: Carregando atividades…
      - region "Atividade recente na plataforma" [ref=e118]:
        - generic [ref=e119]:
          - generic [ref=e121]: Atividade recente
          - generic [ref=e125]:
            - generic [ref=e127]:
              - generic [ref=e128]:
                - generic [ref=e129]: ⚡
                - text: Maria contratou um eletricista em São Paulo
              - generic [ref=e131]:
                - generic [ref=e132]: ⭐
                - text: João avaliou ★★★★★ o prestador Ricardo
              - generic [ref=e134]:
                - generic [ref=e135]: 🎨
                - text: "Nova avaliação: 4.9 para Serviços de Pintura"
              - generic [ref=e137]:
                - generic [ref=e138]: 🔧
                - text: Ana pediu orçamento para encanador
              - generic [ref=e140]:
                - generic [ref=e141]: ✅
                - text: Pedro se cadastrou como prestador verificado
              - generic [ref=e143]:
                - generic [ref=e144]: 📋
                - text: 12 orçamentos enviados hoje
              - generic [ref=e146]:
                - generic [ref=e147]: ⚡
                - text: Maria contratou um eletricista em São Paulo
              - generic [ref=e149]:
                - generic [ref=e150]: ⭐
                - text: João avaliou ★★★★★ o prestador Ricardo
              - generic [ref=e152]:
                - generic [ref=e153]: 🎨
                - text: "Nova avaliação: 4.9 para Serviços de Pintura"
              - generic [ref=e155]:
                - generic [ref=e156]: 🔧
                - text: Ana pediu orçamento para encanador
              - generic [ref=e158]:
                - generic [ref=e159]: ✅
                - text: Pedro se cadastrou como prestador verificado
              - generic [ref=e161]:
                - generic [ref=e162]: 📋
                - text: 12 orçamentos enviados hoje
            - generic [ref=e166]:
              - generic [ref=e167]:
                - generic [ref=e168]: 🧹
                - text: Carlos agendou limpeza de quintal em Belo Horizonte
              - generic [ref=e170]:
                - generic [ref=e171]: ⭐
                - text: Fernanda avaliou ★★★★★ o prestador José
              - generic [ref=e173]:
                - generic [ref=e174]: 🛡️
                - text: 8 novos prestadores verificados esta semana
              - generic [ref=e176]:
                - generic [ref=e177]: 🎨
                - text: Luciana contratou um pintor no Rio de Janeiro
              - generic [ref=e179]:
                - generic [ref=e180]: 🚿
                - text: "Orçamento aceito: reforma de banheiro em Curitiba"
              - generic [ref=e182]:
                - generic [ref=e183]: 🏆
                - text: 5.200 serviços concluídos este mês
              - generic [ref=e185]:
                - generic [ref=e186]: 🧹
                - text: Carlos agendou limpeza de quintal em Belo Horizonte
              - generic [ref=e188]:
                - generic [ref=e189]: ⭐
                - text: Fernanda avaliou ★★★★★ o prestador José
              - generic [ref=e191]:
                - generic [ref=e192]: 🛡️
                - text: 8 novos prestadores verificados esta semana
              - generic [ref=e194]:
                - generic [ref=e195]: 🎨
                - text: Luciana contratou um pintor no Rio de Janeiro
              - generic [ref=e197]:
                - generic [ref=e198]: 🚿
                - text: "Orçamento aceito: reforma de banheiro em Curitiba"
              - generic [ref=e200]:
                - generic [ref=e201]: 🏆
                - text: 5.200 serviços concluídos este mês
      - region "Categorias de serviços" [ref=e203]:
        - generic [ref=e204]:
          - generic:
            - img
          - generic [ref=e206]:
            - generic [ref=e207]:
              - img [ref=e208]
              - text: Explore categorias
            - heading "Encontre o serviço ideal" [level=2] [ref=e211]
            - paragraph [ref=e212]: Serviços verificados perto de você — 0 categorias disponíveis
          - generic [ref=e213]:
            - img [ref=e215]
            - generic [ref=e218]:
              - paragraph [ref=e219]: Nenhuma categoria disponível
              - paragraph [ref=e220]: As categorias aparecerão aqui assim que estiverem disponíveis. Tente recarregar a página.
            - button "Tentar carregar categorias novamente" [ref=e221]:
              - img
              - text: Tentar novamente
      - region "Resultados da busca" [ref=e222]:
        - generic [ref=e223]:
          - complementary [ref=e224]:
            - generic [ref=e226]:
              - generic [ref=e227]:
                - heading "Filtros" [level=2] [ref=e228]:
                  - img [ref=e229]
                  - text: Filtros
                - button "Limpar filtros" [ref=e230]
              - generic [ref=e231]:
                - generic [ref=e232]: Buscar
                - generic [ref=e233]:
                  - img [ref=e234]
                  - textbox "Buscar" [ref=e237]:
                    - /placeholder: Serviço, prestador…
              - generic [ref=e238]:
                - generic [ref=e239]:
                  - generic [ref=e240]: Raio de busca
                  - generic [ref=e241]: 15 km
                - generic "Raio de busca em quilômetros" [ref=e242]:
                  - slider [ref=e246]
                - generic [ref=e247]:
                  - generic [ref=e248]: 1 km
                  - generic [ref=e249]: 50 km
              - generic [ref=e250]:
                - generic [ref=e251]: Categoria
                - combobox [ref=e252]:
                  - generic: Todas as categorias
                  - img
              - generic [ref=e253]:
                - generic [ref=e254]: Ordenar por
                - radiogroup "Ordenar por" [ref=e255]:
                  - radio "Melhor avaliação" [checked] [ref=e256]
                  - radio "Mais próximos" [ref=e257]
              - generic [ref=e258]:
                - generic [ref=e259]: Avaliação mínima
                - radiogroup [ref=e260]:
                  - generic [ref=e261] [cursor=pointer]:
                    - radio "Todas" [checked] [ref=e262]:
                      - img [ref=e263]
                    - generic [ref=e265]: Todas
                  - generic [ref=e266] [cursor=pointer]:
                    - radio "3+" [ref=e267]
                    - generic [ref=e268]: 3+
                  - generic [ref=e269] [cursor=pointer]:
                    - radio "4+" [ref=e270]
                    - generic [ref=e271]: 4+
                  - generic [ref=e272] [cursor=pointer]:
                    - radio "5" [ref=e273]
                    - generic [ref=e274]: "5"
              - generic [ref=e275] [cursor=pointer]:
                - generic [ref=e276]:
                  - img [ref=e277]
                  - generic [ref=e279]: Somente verificados
                - switch "Somente verificados" [ref=e280]
              - button "Ver 0 resultados" [disabled]
          - generic [ref=e281]:
            - generic [ref=e283]:
              - generic [ref=e284]:
                - heading "0 prestadores encontrados" [level=2] [ref=e285]
                - paragraph [ref=e286]: Exibindo 0–0 de 0
              - generic [ref=e287]:
                - generic [ref=e288]:
                  - text: "Ordenado por:"
                  - generic [ref=e289]: Melhor avaliação
                - tablist "Visualização" [ref=e290]:
                  - tab "Lista" [selected] [ref=e291]:
                    - img [ref=e292]
                    - generic [ref=e293]: Lista
                  - tab "Mapa" [ref=e294]:
                    - img [ref=e295]
                    - generic [ref=e297]: Mapa
            - generic [ref=e299]:
              - img [ref=e301]
              - heading "Algo deu errado" [level=3] [ref=e304]
              - paragraph [ref=e305]: Não foi possível carregar os prestadores. Verifique sua conexão e tente novamente.
              - button "Tentar novamente" [ref=e306]
      - region "Como funciona" [ref=e307]:
        - generic [ref=e312]:
          - generic [ref=e313]:
            - link "Pular para resultados" [ref=e314] [cursor=pointer]:
              - /url: "#vitrine-resultados"
              - img [ref=e315]
              - text: Pular para resultados
            - generic [ref=e319]:
              - img [ref=e320]
              - generic [ref=e322]: "4"
              - text: passos simples
            - heading "Como funciona" [level=2] [ref=e323]
            - paragraph [ref=e324]: Sem surpresas — do início ao fim, você tem o controle.
            - generic [ref=e325]:
              - img [ref=e326]
              - text: Sem compromisso
          - generic [ref=e332]:
            - img [ref=e334]
            - generic [ref=e335]:
              - 'button "1 Busque o serviço Encontre prestadores verificados perto de você. 50 + categorias encanador em São Paulo | Verificados < 5 km Mais filtros Ex: Busque ''encanador em São Paulo'' Buscar prestadores" [ref=e336] [cursor=pointer]':
                - generic [ref=e338]:
                  - generic [ref=e340]: "1"
                  - img [ref=e343]
                  - heading "Busque o serviço" [level=3] [ref=e346]
                  - paragraph [ref=e347]: Encontre prestadores verificados perto de você.
                  - generic [ref=e349]:
                    - generic [ref=e350]: "50"
                    - text: +
                    - generic [ref=e351]: categorias
                  - generic [ref=e353]:
                    - generic [ref=e354]:
                      - img [ref=e355]
                      - generic [ref=e358]: encanador em São Paulo
                      - generic [ref=e359]: "|"
                    - generic [ref=e360]:
                      - generic [ref=e361]: Verificados
                      - generic [ref=e362]: < 5 km
                      - generic [ref=e363]:
                        - img [ref=e364]
                        - text: Mais filtros
                  - paragraph [ref=e366]: "Ex: Busque 'encanador em São Paulo'"
                  - button "Buscar prestadores" [ref=e367]:
                    - text: Buscar prestadores
                    - img
              - 'button "2 Compare orçamentos Receba e compare propostas lado a lado. 3 orçamentos em 24h João S. R$ 180 Maria L. R$ 150 Melhor avaliação Compare lado a lado Ex: Compare 3 orçamentos em 24h Sem compromisso Pedir orçamento" [ref=e368] [cursor=pointer]':
                - generic [ref=e370]:
                  - generic [ref=e372]: "2"
                  - img [ref=e375]
                  - heading "Compare orçamentos" [level=3] [ref=e380]
                  - paragraph [ref=e381]: Receba e compare propostas lado a lado.
                  - generic [ref=e383]:
                    - generic [ref=e384]: "3"
                    - generic [ref=e385]: orçamentos em 24h
                  - generic [ref=e387]:
                    - generic [ref=e388]:
                      - generic [ref=e389]:
                        - generic [ref=e392]: João S.
                        - generic [ref=e393]:
                          - img [ref=e394]
                          - img [ref=e396]
                          - img [ref=e398]
                          - img [ref=e400]
                          - img [ref=e402]
                        - generic [ref=e404]: R$ 180
                      - generic [ref=e405]:
                        - generic [ref=e408]: Maria L.
                        - generic [ref=e409]:
                          - img [ref=e410]
                          - img [ref=e412]
                          - img [ref=e414]
                          - img [ref=e416]
                          - img [ref=e418]
                        - generic [ref=e420]: R$ 150
                        - generic [ref=e421]: Melhor avaliação
                    - generic [ref=e422]:
                      - img [ref=e423]
                      - text: Compare lado a lado
                  - paragraph [ref=e428]: "Ex: Compare 3 orçamentos em 24h"
                  - generic [ref=e429]:
                    - img [ref=e430]
                    - text: Sem compromisso
                  - button "Pedir orçamento" [ref=e435]:
                    - text: Pedir orçamento
                    - img
              - 'button "3 Agende com confiança Solicite um orçamento ou agende diretamente. 24 h para confirmar Março 2025 S T Q Q S S D 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 12 Mar, 14:00 — Confirmado Ex: Agende para amanhã às 14h Agendar agora" [ref=e436] [cursor=pointer]':
                - generic [ref=e438]:
                  - generic [ref=e440]: "3"
                  - img [ref=e443]
                  - heading "Agende com confiança" [level=3] [ref=e446]
                  - paragraph [ref=e447]: Solicite um orçamento ou agende diretamente.
                  - generic [ref=e449]:
                    - generic [ref=e450]: "24"
                    - text: h
                    - generic [ref=e451]: para confirmar
                  - generic [ref=e454]:
                    - generic [ref=e455]: Março 2025
                    - generic [ref=e456]:
                      - generic [ref=e457]: S
                      - generic [ref=e458]: T
                      - generic [ref=e459]: Q
                      - generic [ref=e460]: Q
                      - generic [ref=e461]: S
                      - generic [ref=e462]: S
                      - generic [ref=e463]: D
                      - generic [ref=e464]: "1"
                      - generic [ref=e465]: "2"
                      - generic [ref=e466]: "3"
                      - generic [ref=e467]: "4"
                      - generic [ref=e468]: "5"
                      - generic [ref=e469]: "6"
                      - generic [ref=e470]: "7"
                      - generic [ref=e471]: "8"
                      - generic [ref=e472]: "9"
                      - generic [ref=e473]: "10"
                      - generic [ref=e474]: "11"
                      - generic [ref=e475]: "12"
                      - generic [ref=e476]: "13"
                      - generic [ref=e477]: "14"
                      - generic [ref=e478]: "15"
                    - generic [ref=e479]:
                      - img [ref=e480]
                      - generic [ref=e483]: 12 Mar, 14:00 — Confirmado
                  - paragraph [ref=e484]: "Ex: Agende para amanhã às 14h"
                  - button "Agendar agora" [ref=e485]:
                    - text: Agendar agora
                    - img
              - 'button "4 Avalie o resultado Sua opinião mantém a qualidade da comunidade. 98 % satisfação 4.0 \"Excelente trabalho, recomendo!\" Avaliação verificada Ex: Avalie de 1 a 5 estrelas com comentário Cadastrar grátis" [ref=e486] [cursor=pointer]':
                - generic [ref=e488]:
                  - generic [ref=e490]: "4"
                  - img [ref=e493]
                  - heading "Avalie o resultado" [level=3] [ref=e495]
                  - paragraph [ref=e496]: Sua opinião mantém a qualidade da comunidade.
                  - generic [ref=e498]:
                    - generic [ref=e499]: "98"
                    - text: "%"
                    - generic [ref=e500]: satisfação
                  - generic [ref=e502]:
                    - generic [ref=e503]:
                      - generic [ref=e504]:
                        - img [ref=e505]
                        - img [ref=e507]
                        - img [ref=e509]
                        - img [ref=e511]
                        - img [ref=e513]
                        - generic [ref=e515]: "4.0"
                      - paragraph [ref=e518]: "\"Excelente trabalho, recomendo!\""
                    - generic [ref=e519]:
                      - img [ref=e520]
                      - text: Avaliação verificada
                  - paragraph [ref=e523]: "Ex: Avalie de 1 a 5 estrelas com comentário"
                  - button "Cadastrar grátis" [ref=e524]:
                    - text: Cadastrar grátis
                    - img
          - generic [ref=e525]:
            - generic [ref=e526]:
              - img [ref=e527]
              - generic [ref=e530]: Garantia Severinno
            - generic [ref=e531]:
              - generic [ref=e532]:
                - img [ref=e533]
                - generic [ref=e536]: Prestadores verificados
              - generic [ref=e537]:
                - img [ref=e538]
                - generic [ref=e541]: Resposta rápida
              - generic [ref=e542]:
                - img [ref=e543]
                - generic [ref=e545]: Satisfação garantida
              - generic [ref=e546]:
                - img [ref=e547]
                - generic [ref=e552]: Compare antes de contratar
          - generic [ref=e553]:
            - button "Começar agora" [ref=e554]:
              - text: Começar agora
              - img
            - link "Buscar prestadores" [ref=e555] [cursor=pointer]:
              - /url: "#vitrine-resultados"
              - img
              - text: Buscar prestadores
          - button "Voltar ao topo" [ref=e557]:
            - img [ref=e558]
            - text: Voltar ao topo
      - generic [ref=e561]:
        - generic [ref=e562]:
          - generic [ref=e563]:
            - img
            - text: Simulador de preços
          - heading "Quanto custa? Simule agora" [level=2] [ref=e564]
          - paragraph [ref=e565]: Estime o valor do serviço em 3 passos rápidos. Sem compromisso, sem cadastro.
        - generic [ref=e566]:
          - generic [ref=e567]: "1"
          - generic [ref=e569]: "2"
          - generic [ref=e571]: "3"
        - generic [ref=e574]:
          - heading "1. Qual serviço você precisa?" [level=3] [ref=e575]
          - paragraph [ref=e576]: Selecione a categoria do serviço
          - generic [ref=e577]:
            - button "Elétrica" [ref=e578]:
              - img [ref=e580]
              - generic [ref=e582]: Elétrica
            - button "Hidráulica" [ref=e583]:
              - img [ref=e585]
              - generic [ref=e588]: Hidráulica
            - button "Pintura" [ref=e589]:
              - img [ref=e591]
              - generic [ref=e595]: Pintura
            - button "Alvenaria" [ref=e596]:
              - img [ref=e598]
              - generic [ref=e600]: Alvenaria
            - button "Pisos" [ref=e601]:
              - img [ref=e603]
              - generic [ref=e605]: Pisos
            - button "Pós-obra" [ref=e606]:
              - img [ref=e608]
              - generic [ref=e613]: Pós-obra
            - button "Residencial" [ref=e614]:
              - img [ref=e616]
              - generic [ref=e619]: Residencial
      - region "Parceiros e imprensa" [ref=e620]:
        - generic [ref=e621]:
          - paragraph [ref=e623]: Referência no mercado
          - generic [ref=e625]:
            - generic [ref=e628]: G1
            - generic [ref=e631]: Folha de S.Paulo
            - generic [ref=e634]: Valor Econômico
            - generic [ref=e637]: Exame
            - generic [ref=e640]: InfoMoney
            - generic [ref=e643]: Startups
            - generic [ref=e646]: Sebrae
            - generic [ref=e649]: ABES
          - paragraph [ref=e650]: + de 6.000 prestadores confiam no Severinno
      - region "Avaliações de clientes" [ref=e651]:
        - generic:
          - generic:
            - img
        - generic [ref=e652]:
          - generic [ref=e653]:
            - generic [ref=e654]:
              - img [ref=e655]
              - text: Avaliações reais
            - heading "O que nossos clientes dizem" [level=2] [ref=e657]
            - paragraph [ref=e658]: Avaliações de clientes após a conclusão do serviço.
          - generic [ref=e659]:
            - img [ref=e661]
            - heading "Não foi possível carregar as avaliações" [level=3] [ref=e666]
            - paragraph [ref=e667]: Ocorreu um erro ao buscar as avaliações. Tente novamente.
            - button "Tentar novamente" [ref=e668]:
              - img
              - text: Tentar novamente
      - generic [ref=e669]:
        - generic [ref=e672]:
          - generic [ref=e673]:
            - img [ref=e675]
            - generic [ref=e680]: "0"
            - paragraph [ref=e681]: Prestadores verificados
          - generic [ref=e682]:
            - img [ref=e684]
            - generic [ref=e686]: "0"
            - paragraph [ref=e687]: Serviços cadastrados
          - generic [ref=e688]:
            - img [ref=e690]
            - generic [ref=e693]: "0"
            - paragraph [ref=e694]: Serviços concluídos
          - generic [ref=e695]:
            - img [ref=e697]
            - generic [ref=e700]: 0.0/5
            - paragraph [ref=e701]: Nota média
        - generic [ref=e703]:
          - generic [ref=e704]:
            - generic [ref=e705]:
              - img [ref=e706]
              - text: Por que Severinno?
            - heading "Confiança em cada agendamento" [level=2] [ref=e709]
            - paragraph [ref=e710]: Mais que um diretório de serviços — um ecossistema pensado para proteger você e o prestador. Da verificação ao pagamento, cada etapa foi desenhada para a sua tranquilidade.
            - link "Pular para FAQ" [ref=e712] [cursor=pointer]:
              - /url: "#faq"
              - img [ref=e713]
              - text: Pular para FAQ
          - generic [ref=e716]:
            - generic [ref=e719]:
              - generic [ref=e720]:
                - img [ref=e722]
                - button "Saiba mais sobre Prestadores verificados" [ref=e725]:
                  - img [ref=e726]
              - heading "Prestadores verificados" [level=3] [ref=e729]
              - paragraph [ref=e730]: João verificou 3 documentos antes de aprovar o prestador. Você só vê profissionais validados.
              - button "Saiba mais" [ref=e731]:
                - text: Saiba mais
                - img [ref=e732]
            - generic [ref=e736]:
              - generic [ref=e737]:
                - img [ref=e739]
                - button "Saiba mais sobre Pagamento protegido" [ref=e742]:
                  - img [ref=e743]
              - heading "Pagamento protegido" [level=3] [ref=e746]
              - paragraph [ref=e747]: O valor só é liberado ao prestador após você confirmar que ficou satisfeito com o serviço.
              - button "Saiba mais" [ref=e748]:
                - text: Saiba mais
                - img [ref=e749]
            - generic [ref=e753]:
              - generic [ref=e754]:
                - img [ref=e756]
                - button "Saiba mais sobre Resposta rápida" [ref=e759]:
                  - img [ref=e760]
              - heading "Resposta rápida" [level=3] [ref=e763]
              - paragraph [ref=e764]: Prestadores comprometidos a responder em até 24h. Acompanhe o status em tempo real.
              - button "Saiba mais" [ref=e765]:
                - text: Saiba mais
                - img [ref=e766]
            - generic [ref=e770]:
              - generic [ref=e771]:
                - img [ref=e773]
                - button "Saiba mais sobre Avaliações reais" [ref=e775]:
                  - img [ref=e776]
              - heading "Avaliações reais" [level=3] [ref=e779]
              - paragraph [ref=e780]: Apenas clientes que concluíram o serviço podem avaliar. Sem falsas avaliações.
              - button "Saiba mais" [ref=e781]:
                - text: Saiba mais
                - img [ref=e782]
            - generic [ref=e786]:
              - generic [ref=e787]:
                - img [ref=e789]
                - button "Saiba mais sobre Próximo de você" [ref=e792]:
                  - img [ref=e793]
              - heading "Próximo de você" [level=3] [ref=e796]
              - paragraph [ref=e797]: Geolocalização inteligente mostra os melhores prestadores na sua região.
              - button "Saiba mais" [ref=e798]:
                - text: Saiba mais
                - img [ref=e799]
            - generic [ref=e803]:
              - generic [ref=e804]:
                - img [ref=e806]
                - button "Saiba mais sobre Suporte humano" [ref=e808]:
                  - img [ref=e809]
              - heading "Suporte humano" [level=3] [ref=e812]
              - paragraph [ref=e813]: Equipe disponível para mediar disputas, tirar dúvidas e garantir uma experiência justa.
              - button "Saiba mais" [ref=e814]:
                - text: Saiba mais
                - img [ref=e815]
        - generic [ref=e818]:
          - img [ref=e819]
          - paragraph [ref=e821]: "Garantia Severinno: seu dinheiro de volta se o serviço não for bem-feito."
          - link "Saiba mais" [ref=e822] [cursor=pointer]:
            - /url: "#faq"
            - text: Saiba mais
            - img [ref=e823]
      - generic [ref=e826]:
        - generic [ref=e827]:
          - generic [ref=e828]:
            - img [ref=e829]
            - text: Destaque da semana
          - heading "Profissional em destaque" [level=2] [ref=e835]
          - paragraph [ref=e836]: Conheça um dos nossos prestadores mais bem avaliados.
        - generic [ref=e837]:
          - img [ref=e838]
          - paragraph [ref=e841]: Nenhum prestador em destaque no momento.
          - paragraph [ref=e842]: Cadastre-se como prestador e apareça aqui!
      - generic [ref=e846]:
        - generic [ref=e847]:
          - generic [ref=e848]:
            - generic [ref=e849]:
              - img [ref=e850]
              - text: Perguntas frequentes
            - heading "Tire suas dúvidas antes de contratar" [level=2] [ref=e853]
            - paragraph [ref=e854]: Reunimos as perguntas mais comuns sobre como o Severinno funciona — do cadastro ao pagamento.
          - generic [ref=e855]:
            - img [ref=e856]
            - textbox "Buscar nas perguntas frequentes" [ref=e859]:
              - /placeholder: Buscar nas dúvidas…
          - generic [ref=e860]:
            - paragraph [ref=e861]: Filtrar por categoria
            - generic [ref=e862]:
              - button "Filtrar por Geral" [ref=e863]:
                - img [ref=e864]
                - text: Geral
                - generic [ref=e867]: (2)
              - button "Filtrar por Pagamento" [ref=e868]:
                - img [ref=e869]
                - text: Pagamento
                - generic [ref=e871]: (2)
              - button "Filtrar por Agendamento" [ref=e872]:
                - img [ref=e873]
                - text: Agendamento
                - generic [ref=e875]: (2)
              - button "Filtrar por Prestadores" [ref=e876]:
                - img [ref=e877]
                - text: Prestadores
                - generic [ref=e881]: (2)
              - button "Filtrar por Segurança" [ref=e882]:
                - img [ref=e883]
                - text: Segurança
                - generic [ref=e886]: (2)
          - generic [ref=e887]:
            - paragraph [ref=e888]: Perguntas mais frequentes
            - list [ref=e889]:
              - listitem [ref=e890]:
                - button "Como funciona o Severinno?" [ref=e891]:
                  - img [ref=e892]
                  - generic [ref=e894]: Como funciona o Severinno?
              - listitem [ref=e895]:
                - button "Preciso pagar para me cadastrar?" [ref=e896]:
                  - img [ref=e897]
                  - generic [ref=e899]: Preciso pagar para me cadastrar?
              - listitem [ref=e900]:
                - button "Como faço para agendar um serviço?" [ref=e901]:
                  - img [ref=e902]
                  - generic [ref=e904]: Como faço para agendar um serviço?
              - listitem [ref=e905]:
                - button "E se o serviço não for bem-feito?" [ref=e906]:
                  - img [ref=e907]
                  - generic [ref=e909]: E se o serviço não for bem-feito?
          - generic [ref=e911]:
            - img [ref=e913]
            - generic [ref=e915]:
              - paragraph [ref=e916]: Ainda tem dúvidas?
              - paragraph [ref=e917]: Cadastre-se grátis e converse diretamente com prestadores verificados. Sem compromisso.
              - generic [ref=e918]:
                - button "Cadastrar grátis" [ref=e919]
                - link "Fale conosco" [ref=e920] [cursor=pointer]:
                  - /url: "#faq"
                  - img
                  - text: Fale conosco
        - generic [ref=e921]:
          - generic [ref=e923]:
            - generic [ref=e925]:
              - heading "01 Como funciona o Severinno? Geral" [level=3] [ref=e926]:
                - button "01 Como funciona o Severinno? Geral" [expanded] [ref=e927]:
                  - generic [ref=e928]:
                    - generic [ref=e929]: "01"
                    - generic [ref=e930]: Como funciona o Severinno?
                    - generic [ref=e931]:
                      - img
                      - text: Geral
                  - img
              - region "01 Como funciona o Severinno? Geral" [ref=e932]:
                - generic [ref=e934]:
                  - paragraph [ref=e935]: O Severinno conecta você a prestadores de serviço verificados próximos à sua localização. Você busca o serviço, compara avaliações reais de outros clientes, pede orçamento grátis e agenda — tudo pela plataforma. O pagamento só é liberado após você confirmar a conclusão do serviço.
                  - paragraph [ref=e936]: "Ex: Maria precisava de um eletricista. Buscou na plataforma, comparou 3 profissionais e contratou o mais bem avaliado — tudo em 5 minutos."
            - heading "02 Preciso pagar para me cadastrar? Geral" [level=3] [ref=e939]:
              - button "02 Preciso pagar para me cadastrar? Geral" [ref=e940]:
                - generic [ref=e941]:
                  - generic [ref=e942]: "02"
                  - generic [ref=e943]: Preciso pagar para me cadastrar?
                  - generic [ref=e944]:
                    - img
                    - text: Geral
                - img
            - heading "03 Como os prestadores são verificados? Prestadores" [level=3] [ref=e947]:
              - button "03 Como os prestadores são verificados? Prestadores" [ref=e948]:
                - generic [ref=e949]:
                  - generic [ref=e950]: "03"
                  - generic [ref=e951]: Como os prestadores são verificados?
                  - generic [ref=e952]:
                    - img
                    - text: Prestadores
                - img
            - heading "04 Posso me tornar um prestador no Severinno? Prestadores" [level=3] [ref=e955]:
              - button "04 Posso me tornar um prestador no Severinno? Prestadores" [ref=e956]:
                - generic [ref=e957]:
                  - generic [ref=e958]: "04"
                  - generic [ref=e959]: Posso me tornar um prestador no Severinno?
                  - generic [ref=e960]:
                    - img
                    - text: Prestadores
                - img
            - heading "05 Como faço para agendar um serviço? Agendamento" [level=3] [ref=e963]:
              - button "05 Como faço para agendar um serviço? Agendamento" [ref=e964]:
                - generic [ref=e965]:
                  - generic [ref=e966]: "05"
                  - generic [ref=e967]: Como faço para agendar um serviço?
                  - generic [ref=e968]:
                    - img
                    - text: Agendamento
                - img
            - heading "06 Posso remarcar ou cancelar um agendamento? Agendamento" [level=3] [ref=e971]:
              - button "06 Posso remarcar ou cancelar um agendamento? Agendamento" [ref=e972]:
                - generic [ref=e973]:
                  - generic [ref=e974]: "06"
                  - generic [ref=e975]: Posso remarcar ou cancelar um agendamento?
                  - generic [ref=e976]:
                    - img
                    - text: Agendamento
                - img
            - heading "07 Como funciona o pagamento? Pagamento" [level=3] [ref=e979]:
              - button "07 Como funciona o pagamento? Pagamento" [ref=e980]:
                - generic [ref=e981]:
                  - generic [ref=e982]: "07"
                  - generic [ref=e983]: Como funciona o pagamento?
                  - generic [ref=e984]:
                    - img
                    - text: Pagamento
                - img
            - heading "08 O orçamento tem compromisso? Pagamento" [level=3] [ref=e987]:
              - button "08 O orçamento tem compromisso? Pagamento" [ref=e988]:
                - generic [ref=e989]:
                  - generic [ref=e990]: "08"
                  - generic [ref=e991]: O orçamento tem compromisso?
                  - generic [ref=e992]:
                    - img
                    - text: Pagamento
                - img
            - heading "09 E se o serviço não for bem-feito? Segurança" [level=3] [ref=e995]:
              - button "09 E se o serviço não for bem-feito? Segurança" [ref=e996]:
                - generic [ref=e997]:
                  - generic [ref=e998]: "09"
                  - generic [ref=e999]: E se o serviço não for bem-feito?
                  - generic [ref=e1000]:
                    - img
                    - text: Segurança
                - img
            - heading "10 Meus dados pessoais estão seguros? Segurança" [level=3] [ref=e1003]:
              - button "10 Meus dados pessoais estão seguros? Segurança" [ref=e1004]:
                - generic [ref=e1005]:
                  - generic [ref=e1006]: "10"
                  - generic [ref=e1007]: Meus dados pessoais estão seguros?
                  - generic [ref=e1008]:
                    - img
                    - text: Segurança
                - img
          - generic [ref=e1009]:
            - paragraph [ref=e1010]: 10 de 10 dúvidas
            - button "Voltar ao topo da seção" [ref=e1011]:
              - img [ref=e1012]
              - text: Topo
      - generic [ref=e1016]:
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
        - generic [ref=e1021]:
          - generic [ref=e1022]:
            - generic [ref=e1024]:
              - img [ref=e1025]
              - text: Comece agora mesmo
            - heading "Pronto para encontrar o prestador ideal?" [level=2] [ref=e1027]
            - paragraph [ref=e1028]: Comece em 30 segundos — é como pedir um Uber, mas para serviços. Cadastre-se gratuitamente e tenha acesso a prestadores verificados.
            - generic [ref=e1029]:
              - button "Para clientes" [ref=e1030]: Para clientes
              - button "Para prestadores" [ref=e1032]
            - list [ref=e1033]:
              - generic [ref=e1034]:
                - listitem [ref=e1035]:
                  - img [ref=e1036]
                  - text: Cadastro gratuito
                - listitem [ref=e1039]:
                  - img [ref=e1040]
                  - text: Sem taxa de serviço
                - listitem [ref=e1043]:
                  - img [ref=e1044]
                  - text: Orçamento sem compromisso
            - generic [ref=e1047]:
              - button "Cadastrar grátis" [ref=e1052]:
                - text: Cadastrar grátis
                - generic [ref=e1053]:
                  - img
              - button "Sou prestador" [ref=e1055]:
                - img
                - text: Sou prestador
            - generic [ref=e1056]:
              - img [ref=e1057]
              - text: Comece em 30 segundos
            - button "Já tenho conta · Entrar" [ref=e1061]:
              - img [ref=e1062]
              - text: Já tenho conta · Entrar
            - generic [ref=e1065]:
              - generic [ref=e1066]:
                - generic [ref=e1067]: AL
                - generic [ref=e1068]: RM
                - generic [ref=e1069]: JS
                - generic [ref=e1070]: PF
                - generic [ref=e1071]: CM
                - generic [ref=e1072]: "+5"
              - generic [ref=e1073]:
                - paragraph [ref=e1074]: 527+ cadastrados
                - paragraph [ref=e1075]: na plataforma
          - generic [ref=e1076]:
            - generic [ref=e1077]:
              - heading "O que vem depois?" [level=3] [ref=e1078]
              - paragraph [ref=e1079]: Três passos simples e você estará agendando
              - generic [ref=e1080]:
                - img [ref=e1081]
                - generic [ref=e1082]:
                  - generic [ref=e1083]:
                    - generic [ref=e1085]: "1"
                    - generic [ref=e1086]:
                      - paragraph [ref=e1087]: Cadastre-se grátis
                      - paragraph [ref=e1088]: ~30s
                  - generic [ref=e1089]:
                    - generic [ref=e1091]: "2"
                    - generic [ref=e1092]:
                      - paragraph [ref=e1093]: Busque e compare
                      - paragraph [ref=e1094]: ~2 min
                  - generic [ref=e1095]:
                    - generic [ref=e1097]: "3"
                    - generic [ref=e1098]:
                      - paragraph [ref=e1099]: Agende com confiança
                      - paragraph [ref=e1100]: ~5 min
              - generic [ref=e1101]:
                - generic [ref=e1102]:
                  - img [ref=e1103]
                  - text: Sem compromisso
                - generic [ref=e1107]:
                  - img [ref=e1108]
                  - text: Cancele quando quiser
                - generic [ref=e1111]:
                  - img [ref=e1112]
                  - text: Suporte 24h
              - link "Saiba mais sobre pagamento protegido" [ref=e1115] [cursor=pointer]:
                - /url: "#faq"
                - img [ref=e1116]
                - text: Saiba mais sobre pagamento protegido
            - generic [ref=e1120]:
              - generic [ref=e1124]: Cliente
              - generic [ref=e1125]:
                - img [ref=e1129]
                - generic [ref=e1131]: Prestador
              - img [ref=e1136]
              - img [ref=e1138]
              - img [ref=e1142]
              - img [ref=e1145]
              - img [ref=e1149]
        - generic [ref=e1153]:
          - img [ref=e1154]
          - generic [ref=e1157]:
            - paragraph [ref=e1158]: “Encontrei um encanador em 10 minutos, paguei menos do que esperava e ainda pude avaliar o serviço. Recomendo demais!”
            - paragraph [ref=e1159]: — Ana P., Cliente, São Paulo
        - generic [ref=e1160]:
          - generic [ref=e1161]:
            - img [ref=e1162]
            - text: Sem compromisso
          - generic [ref=e1166]:
            - img [ref=e1167]
            - text: Cancele quando quiser
          - generic [ref=e1170]:
            - img [ref=e1171]
            - text: Pagamento protegido
    - contentinfo [ref=e1173]:
      - generic [ref=e1175]:
        - generic [ref=e1176]:
          - paragraph [ref=e1177]: Receba novidades e dicas de serviços
          - paragraph [ref=e1178]: Cadastre-se e receba ofertas exclusivas. Cancele quando quiser.
        - generic [ref=e1179]:
          - generic [ref=e1180]:
            - img [ref=e1181]
            - textbox "E-mail para newsletter" [ref=e1184]:
              - /placeholder: Seu e-mail
          - button "Assinar" [disabled]:
            - img
            - text: Assinar
      - generic [ref=e1185]:
        - generic [ref=e1186]:
          - generic [ref=e1187]:
            - generic [ref=e1188]:
              - img [ref=e1190]
              - generic [ref=e1193]: Severinno
            - paragraph [ref=e1194]: Marketplace de serviços com geolocalização. Encontre prestadores verificados, próximos e bem avaliados.
            - list "Redes sociais" [ref=e1195]:
              - listitem [ref=e1196]:
                - link "GitHub" [ref=e1197] [cursor=pointer]:
                  - /url: https://github.com
                  - img [ref=e1198]
              - listitem [ref=e1201]:
                - link "Twitter" [ref=e1202] [cursor=pointer]:
                  - /url: https://twitter.com
                  - img [ref=e1203]
              - listitem [ref=e1205]:
                - link "Instagram" [ref=e1206] [cursor=pointer]:
                  - /url: https://instagram.com
                  - img [ref=e1207]
              - listitem [ref=e1210]:
                - link "LinkedIn" [ref=e1211] [cursor=pointer]:
                  - /url: https://linkedin.com
                  - img [ref=e1212]
              - listitem [ref=e1216]:
                - link "E-mail" [ref=e1217] [cursor=pointer]:
                  - /url: mailto:contato@severinno.com
                  - img [ref=e1218]
          - navigation "Sobre" [ref=e1221]:
            - heading "Sobre" [level=3] [ref=e1222]:
              - img [ref=e1223]
              - text: Sobre
            - list [ref=e1226]:
              - listitem [ref=e1227]:
                - button "Como funciona" [ref=e1228]
              - listitem [ref=e1229]:
                - button "Quem somos" [ref=e1230]
              - listitem [ref=e1231]:
                - button "Termos de uso" [ref=e1232]
              - listitem [ref=e1233]:
                - button "Privacidade" [ref=e1234]
          - navigation "Para profissionais" [ref=e1235]:
            - heading "Para profissionais" [level=3] [ref=e1236]:
              - img [ref=e1237]
              - text: Para profissionais
            - list [ref=e1240]:
              - listitem [ref=e1241]:
                - button "Cadastre-se" [ref=e1242]
              - listitem [ref=e1243]:
                - button "Meu painel" [ref=e1244]
              - listitem [ref=e1245]:
                - button "Central de ajuda" [ref=e1246]
          - navigation "Precisa de ajuda?" [ref=e1247]:
            - heading "Precisa de ajuda?" [level=3] [ref=e1248]:
              - img [ref=e1249]
              - text: Precisa de ajuda?
            - list [ref=e1251]:
              - listitem [ref=e1252]:
                - button "Perguntas frequentes" [ref=e1253]
              - listitem [ref=e1254]:
                - button "Segurança" [ref=e1255]
              - listitem [ref=e1256]:
                - button "Reportar problema" [ref=e1257]
          - generic [ref=e1258]:
            - heading "Contato" [level=3] [ref=e1259]:
              - img [ref=e1260]
              - text: Contato
            - list [ref=e1265]:
              - listitem [ref=e1266]:
                - img [ref=e1267]
                - link "contato@severinno.com" [ref=e1270] [cursor=pointer]:
                  - /url: mailto:contato@severinno.com
              - listitem [ref=e1271]:
                - img [ref=e1272]
                - text: São Paulo, Brasil
            - button "Fale conosco" [ref=e1275]:
              - img
              - text: Fale conosco
        - generic [ref=e1276]:
          - paragraph [ref=e1277]: © 2026 Severinno Marketplace. Todos os direitos reservados.
          - paragraph [ref=e1278]:
            - text: Feito com
            - img [ref=e1279]
            - text: usando tecnologia Open Source (
            - link "MapLibre" [ref=e1281] [cursor=pointer]:
              - /url: https://maplibre.org/
            - text: ·
            - link "OpenStreetMap" [ref=e1282] [cursor=pointer]:
              - /url: https://www.openstreetmap.org/copyright
            - text: )
    - button "Abrir assistente virtual" [ref=e1283]:
      - img [ref=e1284]
    - generic [ref=e1288]:
      - generic [ref=e1289]:
        - img [ref=e1291]
        - generic [ref=e1293]:
          - paragraph [ref=e1294]: Usamos cookies para melhorar sua experiência
          - paragraph [ref=e1295]:
            - text: Utilizamos cookies essenciais para o funcionamento do site e cookies de análise para melhorar nossos serviços.
            - button "Política de privacidade" [ref=e1296]
      - generic [ref=e1297]:
        - button "Recusar" [ref=e1298]
        - button "Aceitar" [ref=e1299]:
          - img
          - text: Aceitar
        - button "Dispensar" [ref=e1300]:
          - img [ref=e1301]
  - region "Notifications alt+T"
  - generic [active]:
    - generic [ref=e1306]:
      - generic [ref=e1307]:
        - generic [ref=e1308]:
          - navigation [ref=e1309]:
            - button "previous" [disabled] [ref=e1310]:
              - img "previous" [ref=e1311]
            - generic [ref=e1313]:
              - generic [ref=e1314]: 1/
              - text: "1"
            - button "next" [disabled] [ref=e1315]:
              - img "next" [ref=e1316]
          - img
        - generic [ref=e1318]:
          - link "Next.js 16.1.3 (stale) Turbopack" [ref=e1319] [cursor=pointer]:
            - /url: https://nextjs.org/docs/messages/version-staleness
            - img [ref=e1320]
            - generic "There is a newer version (16.2.11) available, upgrade recommended!" [ref=e1322]: Next.js 16.1.3 (stale)
            - generic [ref=e1323]: Turbopack
          - img
      - dialog "Build Error" [ref=e1325]:
        - generic [ref=e1328]:
          - generic [ref=e1329]:
            - generic [ref=e1330]:
              - generic [ref=e1332]: Build Error
              - generic [ref=e1333]:
                - button "Copy Error Info" [ref=e1334] [cursor=pointer]:
                  - img [ref=e1335]
                - button "No related documentation found" [disabled] [ref=e1337]:
                  - img [ref=e1338]
                - button "Attach Node.js inspector" [ref=e1340] [cursor=pointer]:
                  - img [ref=e1341]
            - generic [ref=e1350]: Reading source code for parsing failed
          - generic [ref=e1352]:
            - generic [ref=e1354]:
              - img [ref=e1356]
              - generic [ref=e1360]: ./.freebuff/worktrees/thmrzp9vv9y86o/src/lib/api-server.ts
              - button "Open in editor" [ref=e1361] [cursor=pointer]:
                - img [ref=e1363]
            - generic [ref=e1367]: "Reading source code for parsing failed An unexpected error happened while trying to read the source code to parse: failed to convert rope into string Caused by: - invalid utf-8 sequence of 1 bytes from index 5415 Import trace: App Route: ./.freebuff/worktrees/thmrzp9vv9y86o/src/lib/api-server.ts ./.freebuff/worktrees/thmrzp9vv9y86o/src/app/api/auth/me/route.ts"
        - generic [ref=e1368]: "1"
        - generic [ref=e1369]: "2"
    - generic [ref=e1374] [cursor=pointer]:
      - button "Open Next.js Dev Tools" [ref=e1375]:
        - img [ref=e1376]
      - button "Open issues overlay" [ref=e1380]:
        - generic [ref=e1381]:
          - generic [ref=e1382]: "0"
          - generic [ref=e1383]: "1"
        - generic [ref=e1384]: Issue
  - alert [ref=e1385]
```

# Test source

```ts
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
> 158 |   await emailInput.fill(email)
      |                    ^ Error: locator.fill: Test timeout of 30000ms exceeded.
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