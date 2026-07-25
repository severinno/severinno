# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dashboard.spec.ts >> GET /dashboard returns 200 and shows login redirect for unauthenticated
- Location: e2e\dashboard.spec.ts:3:5

# Error details

```
Error: expect(page).toHaveURL(expected) failed

Expected pattern: /\?login/
Received string:  "http://localhost:3000/"
Timeout: 5000ms

Call log:
  - Expect "toHaveURL" with timeout 5000ms
    10 × unexpected value "http://localhost:3000/"

```

```yaml
- banner:
  - button "Severinno — página inicial": Severinno Verificado
  - textbox "Buscar prestadores":
    - /placeholder: Buscar serviço ou prestador…
  - text: ⌘K
  - button "Usar minha localização": Definir localização
  - button "Alternar tema"
  - button "Entrar"
  - button "Cadastrar"
- main:
  - text: Marketplace de serviços verificados
  - heading "Prestadores de serviço verificados, perto de você." [level=1]
  - paragraph: Compare avaliações reais, peça orçamento grátis e agende — encanador, eletricista, pintor e mais. Você escolhe o profissional.
  - textbox "Serviço buscado":
    - /placeholder: "O que você precisa? Ex.: encanador, pintura…"
  - textbox "Localização":
    - /placeholder: CEP ou cidade
  - button "Buscar"
  - text: "Mais buscados:"
  - button "Encanador"
  - button "Eletricista"
  - button "Pintor"
  - button "Diarista"
  - button "Pedreiro"
  - button "Jardineiro"
  - button "Usar minha localização"
  - button "Cadastrar grátis"
  - button "Ver como funciona"
  - paragraph: Cadastro grátis · Orçamento sem compromisso · Você escolhe o profissional
  - list:
    - listitem "Documentos validados e identidade confirmada": Prestadores verificados
    - listitem "Avaliações de clientes após a conclusão do serviço": Avaliações reais
    - listitem "Pagamento só é liberado após você marcar como concluído": Pagamento seguro
  - text: Atividade ao vivo
  - region "Atividade recente na plataforma": "Atividade recente Maria contratou um eletricista em São Paulo João avaliou ★★★★★ o prestador Ricardo Nova avaliação: 4.9 para Serviços de Pintura Ana pediu orçamento para encanador Pedro se cadastrou como prestador verificado 12 orçamentos enviados hoje Maria contratou um eletricista em São Paulo João avaliou ★★★★★ o prestador Ricardo Nova avaliação: 4.9 para Serviços de Pintura Ana pediu orçamento para encanador Pedro se cadastrou como prestador verificado 12 orçamentos enviados hoje Carlos agendou limpeza de quintal em Belo Horizonte Fernanda avaliou ★★★★★ o prestador José 8 novos prestadores verificados esta semana Luciana contratou um pintor no Rio de Janeiro Orçamento aceito: reforma de banheiro em Curitiba 5.200 serviços concluídos este mês Carlos agendou limpeza de quintal em Belo Horizonte Fernanda avaliou ★★★★★ o prestador José 8 novos prestadores verificados esta semana Luciana contratou um pintor no Rio de Janeiro Orçamento aceito: reforma de banheiro em Curitiba 5.200 serviços concluídos este mês"
  - region "Categorias de serviços":
    - text: Explore categorias
    - heading "Encontre o serviço ideal" [level=2]
    - paragraph: Serviços verificados perto de você — … carregando categorias
  - region "Resultados da busca":
    - complementary:
      - heading "Filtros" [level=2]
      - button "Limpar filtros"
      - text: Buscar
      - textbox "Buscar":
        - /placeholder: Serviço, prestador…
      - text: Raio de busca 15 km
      - slider
      - text: 1 km 50 km Categoria
      - combobox: Todas as categorias
      - text: Ordenar por
      - radiogroup "Ordenar por":
        - radio "Melhor avaliação" [checked]
        - radio "Mais próximos"
      - text: Avaliação mínima
      - radiogroup:
        - radio "Todas" [checked]
        - text: Todas
        - radio "3+"
        - text: 3+
        - radio "4+"
        - text: 4+
        - radio "5"
        - text: "5"
      - text: Somente verificados
      - switch "Somente verificados"
      - button "Ver 0 resultados" [disabled]
    - heading [level=2]
    - paragraph: Exibindo 0–0 de 0
    - text: "Ordenado por: Melhor avaliação"
    - tablist "Visualização":
      - tab "Lista" [selected]
      - tab "Mapa"
  - region "Como funciona":
    - link "Pular para resultados":
      - /url: "#vitrine-resultados"
    - text: 0 passos simples
    - heading "Como funciona" [level=2]
    - paragraph: Sem surpresas — do início ao fim, você tem o controle.
    - text: Sem compromisso
    - 'button "1 Busque o serviço Encontre prestadores verificados perto de você. 0 + categorias encanador em São Paulo | Verificados < 5 km Mais filtros Ex: Busque ''encanador em São Paulo'' Buscar prestadores"':
      - text: "1"
      - heading "Busque o serviço" [level=3]
      - paragraph: Encontre prestadores verificados perto de você.
      - text: 0 + categorias encanador em São Paulo | Verificados < 5 km Mais filtros
      - paragraph: "Ex: Busque 'encanador em São Paulo'"
      - button "Buscar prestadores"
    - 'button "2 Compare orçamentos Receba e compare propostas lado a lado. 0 orçamentos em 24h João S. R$ 180 Maria L. R$ 150 Melhor avaliação Compare lado a lado Ex: Compare 3 orçamentos em 24h Sem compromisso Pedir orçamento"':
      - text: "2"
      - heading "Compare orçamentos" [level=3]
      - paragraph: Receba e compare propostas lado a lado.
      - text: 0 orçamentos em 24h João S. R$ 180 Maria L. R$ 150 Melhor avaliação Compare lado a lado
      - paragraph: "Ex: Compare 3 orçamentos em 24h"
      - text: Sem compromisso
      - button "Pedir orçamento"
    - 'button "3 Agende com confiança Solicite um orçamento ou agende diretamente. 0 h para confirmar Março 2025 S T Q Q S S D 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 12 Mar, 14:00 — Confirmado Ex: Agende para amanhã às 14h Agendar agora"':
      - text: "3"
      - heading "Agende com confiança" [level=3]
      - paragraph: Solicite um orçamento ou agende diretamente.
      - text: 0 h para confirmar Março 2025 S T Q Q S S D 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 12 Mar, 14:00 — Confirmado
      - paragraph: "Ex: Agende para amanhã às 14h"
      - button "Agendar agora"
    - 'button "4 Avalie o resultado Sua opinião mantém a qualidade da comunidade. 0 % satisfação 4.0 \"Excelente trabalho, recomendo!\" Avaliação verificada Ex: Avalie de 1 a 5 estrelas com comentário Cadastrar grátis"':
      - text: "4"
      - heading "Avalie o resultado" [level=3]
      - paragraph: Sua opinião mantém a qualidade da comunidade.
      - text: 0 % satisfação 4.0
      - paragraph: "\"Excelente trabalho, recomendo!\""
      - text: Avaliação verificada
      - paragraph: "Ex: Avalie de 1 a 5 estrelas com comentário"
      - button "Cadastrar grátis"
    - text: Garantia Severinno Prestadores verificados Resposta rápida Satisfação garantida Compare antes de contratar
    - button "Começar agora"
    - link "Buscar prestadores":
      - /url: "#vitrine-resultados"
    - button "Voltar ao topo"
  - text: Simulador de preços
  - heading "Quanto custa? Simule agora" [level=2]
  - paragraph: Estime o valor do serviço em 3 passos rápidos. Sem compromisso, sem cadastro.
  - text: 1 2 3
  - heading "1. Qual serviço você precisa?" [level=3]
  - paragraph: Selecione a categoria do serviço
  - button "Elétrica"
  - button "Hidráulica"
  - button "Pintura"
  - button "Alvenaria"
  - button "Pisos"
  - button "Pós-obra"
  - button "Residencial"
  - region "Parceiros e imprensa":
    - paragraph: Referência no mercado
    - text: G1 Folha de S.Paulo Valor Econômico Exame InfoMoney Startups Sebrae ABES
    - paragraph: + de 6.000 prestadores confiam no Severinno
  - region "Avaliações de clientes":
    - text: Avaliações reais
    - heading "O que nossos clientes dizem" [level=2]
    - paragraph: Avaliações de clientes após a conclusão do serviço.
  - paragraph: Prestadores verificados
  - paragraph: Serviços cadastrados
  - paragraph: Serviços concluídos
  - paragraph: Nota média
  - text: Por que Severinno?
  - heading "Confiança em cada agendamento" [level=2]
  - paragraph: Mais que um diretório de serviços — um ecossistema pensado para proteger você e o prestador. Da verificação ao pagamento, cada etapa foi desenhada para a sua tranquilidade.
  - link "Pular para FAQ":
    - /url: "#faq"
  - button "Saiba mais sobre Prestadores verificados"
  - heading "Prestadores verificados" [level=3]
  - paragraph: João verificou 3 documentos antes de aprovar o prestador. Você só vê profissionais validados.
  - button "Saiba mais"
  - button "Saiba mais sobre Pagamento protegido"
  - heading "Pagamento protegido" [level=3]
  - paragraph: O valor só é liberado ao prestador após você confirmar que ficou satisfeito com o serviço.
  - button "Saiba mais"
  - button "Saiba mais sobre Resposta rápida"
  - heading "Resposta rápida" [level=3]
  - paragraph: Prestadores comprometidos a responder em até 24h. Acompanhe o status em tempo real.
  - button "Saiba mais"
  - button "Saiba mais sobre Avaliações reais"
  - heading "Avaliações reais" [level=3]
  - paragraph: Apenas clientes que concluíram o serviço podem avaliar. Sem falsas avaliações.
  - button "Saiba mais"
  - button "Saiba mais sobre Próximo de você"
  - heading "Próximo de você" [level=3]
  - paragraph: Geolocalização inteligente mostra os melhores prestadores na sua região.
  - button "Saiba mais"
  - button "Saiba mais sobre Suporte humano"
  - heading "Suporte humano" [level=3]
  - paragraph: Equipe disponível para mediar disputas, tirar dúvidas e garantir uma experiência justa.
  - button "Saiba mais"
  - paragraph: "Garantia Severinno: seu dinheiro de volta se o serviço não for bem-feito."
  - link "Saiba mais":
    - /url: "#faq"
  - text: Destaque da semana
  - heading "Profissional em destaque" [level=2]
  - paragraph: Conheça um dos nossos prestadores mais bem avaliados.
  - text: Perguntas frequentes
  - heading "Tire suas dúvidas antes de contratar" [level=2]
  - paragraph: Reunimos as perguntas mais comuns sobre como o Severinno funciona — do cadastro ao pagamento.
  - textbox "Buscar nas perguntas frequentes":
    - /placeholder: Buscar nas dúvidas…
  - paragraph: Filtrar por categoria
  - button "Filtrar por Geral": Geral (2)
  - button "Filtrar por Pagamento": Pagamento (2)
  - button "Filtrar por Agendamento": Agendamento (2)
  - button "Filtrar por Prestadores": Prestadores (2)
  - button "Filtrar por Segurança": Segurança (2)
  - paragraph: Perguntas mais frequentes
  - list:
    - listitem:
      - button "Como funciona o Severinno?"
    - listitem:
      - button "Preciso pagar para me cadastrar?"
    - listitem:
      - button "Como faço para agendar um serviço?"
    - listitem:
      - button "E se o serviço não for bem-feito?"
  - paragraph: Ainda tem dúvidas?
  - paragraph: Cadastre-se grátis e converse diretamente com prestadores verificados. Sem compromisso.
  - button "Cadastrar grátis"
  - link "Fale conosco":
    - /url: "#faq"
  - heading "01 Como funciona o Severinno? Geral" [level=3]:
    - button "01 Como funciona o Severinno? Geral" [expanded]
  - region "01 Como funciona o Severinno? Geral":
    - paragraph: O Severinno conecta você a prestadores de serviço verificados próximos à sua localização. Você busca o serviço, compara avaliações reais de outros clientes, pede orçamento grátis e agenda — tudo pela plataforma. O pagamento só é liberado após você confirmar a conclusão do serviço.
    - paragraph: "Ex: Maria precisava de um eletricista. Buscou na plataforma, comparou 3 profissionais e contratou o mais bem avaliado — tudo em 5 minutos."
  - heading "02 Preciso pagar para me cadastrar? Geral" [level=3]:
    - button "02 Preciso pagar para me cadastrar? Geral"
  - heading "03 Como os prestadores são verificados? Prestadores" [level=3]:
    - button "03 Como os prestadores são verificados? Prestadores"
  - heading "04 Posso me tornar um prestador no Severinno? Prestadores" [level=3]:
    - button "04 Posso me tornar um prestador no Severinno? Prestadores"
  - heading "05 Como faço para agendar um serviço? Agendamento" [level=3]:
    - button "05 Como faço para agendar um serviço? Agendamento"
  - heading "06 Posso remarcar ou cancelar um agendamento? Agendamento" [level=3]:
    - button "06 Posso remarcar ou cancelar um agendamento? Agendamento"
  - heading "07 Como funciona o pagamento? Pagamento" [level=3]:
    - button "07 Como funciona o pagamento? Pagamento"
  - heading "08 O orçamento tem compromisso? Pagamento" [level=3]:
    - button "08 O orçamento tem compromisso? Pagamento"
  - heading "09 E se o serviço não for bem-feito? Segurança" [level=3]:
    - button "09 E se o serviço não for bem-feito? Segurança"
  - heading "10 Meus dados pessoais estão seguros? Segurança" [level=3]:
    - button "10 Meus dados pessoais estão seguros? Segurança"
  - paragraph: 10 de 10 dúvidas
  - button "Voltar ao topo da seção": Topo
  - text: Comece agora mesmo
  - heading "Pronto para encontrar o prestador ideal?" [level=2]
  - paragraph: Comece em 30 segundos — é como pedir um Uber, mas para serviços. Cadastre-se gratuitamente e tenha acesso a prestadores verificados.
  - button "Para clientes"
  - button "Para prestadores"
  - list:
    - listitem: Cadastro gratuito
    - listitem: Sem taxa de serviço
    - listitem: Orçamento sem compromisso
  - button "Cadastrar grátis"
  - button "Sou prestador"
  - text: Comece em 30 segundos
  - button "Já tenho conta · Entrar"
  - paragraph: 0+ cadastrados
  - paragraph: na plataforma
  - heading "O que vem depois?" [level=3]
  - paragraph: Três passos simples e você estará agendando
  - text: "1"
  - paragraph: Cadastre-se grátis
  - paragraph: ~30s
  - text: "2"
  - paragraph: Busque e compare
  - paragraph: ~2 min
  - text: "3"
  - paragraph: Agende com confiança
  - paragraph: ~5 min
  - text: Sem compromisso Cancele quando quiser Suporte 24h
  - link "Saiba mais sobre pagamento protegido":
    - /url: "#faq"
  - paragraph: “Encontrei um encanador em 10 minutos, paguei menos do que esperava e ainda pude avaliar o serviço. Recomendo demais!”
  - paragraph: — Ana P., Cliente, São Paulo
  - text: Sem compromisso Cancele quando quiser Pagamento protegido
- contentinfo:
  - paragraph: Receba novidades e dicas de serviços
  - paragraph: Cadastre-se e receba ofertas exclusivas. Cancele quando quiser.
  - textbox "E-mail para newsletter":
    - /placeholder: Seu e-mail
  - button "Assinar" [disabled]
  - text: Severinno
  - paragraph: Marketplace de serviços com geolocalização. Encontre prestadores verificados, próximos e bem avaliados.
  - list "Redes sociais":
    - listitem:
      - link "GitHub":
        - /url: https://github.com
    - listitem:
      - link "Twitter":
        - /url: https://twitter.com
    - listitem:
      - link "Instagram":
        - /url: https://instagram.com
    - listitem:
      - link "LinkedIn":
        - /url: https://linkedin.com
    - listitem:
      - link "E-mail":
        - /url: mailto:contato@severinno.com
  - navigation "Sobre":
    - heading "Sobre" [level=3]
    - list:
      - listitem:
        - button "Como funciona"
      - listitem:
        - button "Quem somos"
      - listitem:
        - button "Termos de uso"
      - listitem:
        - button "Privacidade"
  - navigation "Para profissionais":
    - heading "Para profissionais" [level=3]
    - list:
      - listitem:
        - button "Cadastre-se"
      - listitem:
        - button "Meu painel"
      - listitem:
        - button "Central de ajuda"
  - navigation "Precisa de ajuda?":
    - heading "Precisa de ajuda?" [level=3]
    - list:
      - listitem:
        - button "Perguntas frequentes"
      - listitem:
        - button "Segurança"
      - listitem:
        - button "Reportar problema"
  - heading "Contato" [level=3]
  - list:
    - listitem:
      - link "contato@severinno.com":
        - /url: mailto:contato@severinno.com
    - listitem: São Paulo, Brasil
  - button "Fale conosco"
  - paragraph: © 2026 Severinno Marketplace. Todos os direitos reservados.
  - paragraph:
    - text: Feito com usando tecnologia Open Source (
    - link "MapLibre":
      - /url: https://maplibre.org/
    - text: ·
    - link "OpenStreetMap":
      - /url: https://www.openstreetmap.org/copyright
    - text: )
- button "Abrir assistente virtual"
- region "Notifications alt+T"
- alert
```

# Test source

```ts
  1  | import { test, expect } from "@playwright/test"
  2  | 
  3  | test("GET /dashboard returns 200 and shows login redirect for unauthenticated", async ({ page }) => {
  4  |   await page.goto("/dashboard")
> 5  |   await expect(page).toHaveURL(/\?login/)
     |                      ^ Error: expect(page).toHaveURL(expected) failed
  6  | })
  7  | 
  8  | test("authenticated client can access dashboard", async ({ page, context }) => {
  9  |   await page.goto("/dashboard")
  10 |   await expect(page.locator("h1, h2").first()).toBeVisible()
  11 | })
  12 | 
```