# Documento de Requisitos de Software (SRS)
## Ray — Copiloto de IA para Reuniões em Tempo Real

**Versão:** 2.0
**Data:** 15 de agosto de 2026
**Status:** Rascunho — consolidado a partir dos wireframes

---

## 1. Introdução

### 1.1 Propósito

Este documento especifica os requisitos funcionais e não funcionais do **Ray**, um aplicativo desktop que fornece assistência de IA em tempo real durante reuniões, entrevistas, apresentações e chamadas de vendas. O sistema captura o áudio do usuário e dos demais participantes, transcreve e traduz ao vivo, e sugere respostas, argumentos e tratamento de objeções — exibidos em superfícies de overlay que não aparecem no compartilhamento de tela.

### 1.2 Escopo

O produto é um aplicativo desktop multiplataforma (Linux, macOS, Windows) construído com Svelte 5 + Tauri, núcleo nativo em Rust e serviços auxiliares em contêiner. O usuário fornece a própria credencial de um provedor de IA (BYOK), com suporte a chave de API (DeepSeek, Anthropic, Google Gemini, OpenAI), login por assinatura (ChatGPT), agregadores (OpenRouter) e endpoints compatíveis com OpenAI (modelos locais/auto-hospedados). O sistema não depende de infraestrutura de inferência própria.

Os assistentes (comportamentos do copiloto) são orientados por um agente construído com LangGraph.js, que carrega diferentes prompts/capacidades conforme a seleção do usuário.

### 1.3 Definições

| Termo | Definição |
|---|---|
| Copiloto | O assistente de IA que gera sugestões em tempo real |
| Assistente | Configuração de prompt + categoria que define o comportamento do copiloto |
| Modo stealth | Modo em que as janelas do app são excluídas da captura de tela/screenshare |
| Overlay / Modal | Superfície flutuante que exibe transcrição, tradução e sugestões durante a sessão |
| Notch | Superfície compacta de insights em tempo real, com histórico navegável |
| App bar / Barra de Ações | Barra de controle flutuante do app |
| STT | Speech-to-Text (reconhecimento de fala) |
| BYOK | Bring Your Own Key — o usuário fornece a própria credencial |
| Provider | Provedor de IA (chave, assinatura, agregador ou endpoint compatível) |
| Audio Driver | Dispositivo de áudio virtual do produto para capturar o áudio recebido |
| TCC | Transparency, Consent and Control — subsistema de permissões do macOS |
| Canal VOCÊ / OUTROS | Fontes de áudio separadas: microfone do usuário vs. áudio recebido |

### 1.4 Stack Tecnológica

- **Frontend / UI:** Svelte 5 (runes)
- **Shell desktop / runtime nativo:** Tauri 2 (Rust)
- **Agente de assistentes:** LangGraph.js (TypeScript)
- **ORM:** Prisma
- **Banco de dados:** PostgreSQL
- **Containerização:** Docker / Docker Compose
- **Captura de áudio:** APIs nativas do SO + dispositivo de áudio virtual próprio
- **Linguagem visual:** Liquid Glass (superfícies translúcidas com sombreamento de fundo)

---

## 2. Descrição Geral

### 2.1 Perspectiva do Produto

O aplicativo roda localmente como um conjunto de janelas flutuantes (app bar, home, overlay/modal, Notch) separadas da reunião. Não injeta bot na chamada nem aparece como participante: a captura do áudio recebido é feita de forma passiva por um dispositivo de áudio virtual. Integra-se a Zoom, Google Meet, Microsoft Teams, Hangouts e qualquer app que emita áudio pelo sistema, sem instalar plugins nessas plataformas.

### 2.2 Perfis de Usuário

Profissionais de vendas, empreendedores, executivos e diretores, entrevistadores e candidatos, e apresentadores em geral.

### 2.3 Restrições Gerais

- O usuário deve configurar ao menos um provedor de IA.
- A latência ponta a ponta deve ser baixa o suficiente para uso conversacional.
- Credenciais nunca são persistidas em texto claro.
- No macOS, funções dependem de permissões do TCC e de reinício após concessão.

---

## 3. Superfícies de Interface

O produto expõe quatro superfícies distintas, todas sob a linguagem visual Liquid Glass (ver seção 8):

- **RF-010 — App bar (Barra de Ações):** barra flutuante compacta com grip para arrastar, botão Home, indicador de status, botão que ativa o modo stealth e o botão "Iniciar Configuração" (onboarding). Alternável por atalho, com o mesmo comportamento do menu da bandeja.
- **RF-011 — Home:** tela principal com busca de sessões passadas, badge de plano, acesso a configurações/perfil, cards de assistente atual, memória em tempo real, teste/free tier, ações de conversa e sessões recentes.
- **RF-012 — Overlay / Modal de sessão:** superfície de uso em tempo real que exibe os cards de insight (ver RF-330) e pode ser reposicionada por atalho.
- **RF-013 — Notch:** superfície compacta de insights em tempo real durante sessões ativas, com histórico navegável (anterior/próximo). Implementada como janela Tauri secundária (transparente, sempre-no-topo, excluída de captura) em todas as plataformas; o que varia é a ancoragem e o material de vidro nativo: no macOS aproveita o entalhe físico e o vibrancy; no Windows ancora no topo-centro/bandeja com material Mica/Acrylic; no Linux é um HUD flutuante com translucidez dependente do compositor (degrada para fundo semi-opaco quando indisponível).

---

## 4. Requisitos Funcionais

### 4.1 Onboarding e Permissões (RF-100)

- **RF-101** — Fluxo de onboarding em etapas ordenadas: (1) verificação de permissões, (2) configuração de áudio, (3) transcrição, (4) análise de texto e imagem, (5) comunidade e ajuda [opcional], (6) trial de 7 dias [cartão].
- **RF-102** — O onboarding deve poder ser reiniciado a qualquer momento (via Ajuda → Reiniciar Integração).
- **RF-103** — Gerenciar as permissões nativas, cada uma vinculada à função que habilita:
  - Microfone → captura de voz (canal VOCÊ);
  - Gravação/Captura de Tela → função "Capturar Tela" e leitura de contexto visual;
  - Acessibilidade → "Analisar Seleção" (detectar texto selecionado);
  - Reconhecimento de Fala (Apple Speech) → STT on-device no macOS. No Windows e Linux o STT local é feito por Whisper embutido, que não exige permissão de sistema (apenas acesso ao microfone/áudio já coberto acima).
- **RF-104** — Detectar o estado de cada permissão, oferecer "Conceder permissões ausentes" e orientar o reinício do app quando exigido.

### 4.2 Captura e Áudio (RF-200)

- **RF-201** — Canal "Seu Áudio" (VOCÊ): seleção do microfone, medidor de nível, indicação de prontidão.
- **RF-202** — Canal "Áudio Recebido" (OUTROS): captura via dispositivo de áudio virtual do produto.
- **RF-203 — Ray Audio Driver:** componente nativo separado (dispositivo de áudio virtual) que permite capturar o áudio da reunião sem depender da permissão de gravação de tela. Requer instalação privilegiada (senha de administrador) e possui versionamento próprio.
  - macOS: plugin CoreAudio/HAL; selecionável em "Áudio Recebido" apenas dentro do app.
  - Windows: usar "Saída do Sistema (Windows)" / loopback WASAPI; instalação de driver quando aplicável.
  - Linux: módulo/monitor PulseAudio ou PipeWire.
- **RF-204** — O driver é uma fonte de captura, nunca saída de som: não deve ser selecionado como alto-falante da reunião, saída do sistema ou microfone. O app deve documentar e, quando possível, validar a configuração correta.
- **RF-205** — Fornecer teste rápido de áudio: o usuário ouve o som, o medidor OUTROS reage à fala alheia e o medidor VOCÊ reage à própria voz.
- **RF-206** — Medidores de áudio por canal, com opção de ocultar.

### 4.3 Modelos: Transcrição, Análise e Tradução (RF-300)

Cada função tem seleção de provedor/modelo independente. Quando houver mais de uma credencial disponível (ex.: login ChatGPT + chave OpenAI), o grupo de provedor escolhido decide qual credencial é usada. Estado vazio explícito quando nada está configurado.

- **RF-301 — Transcrição:** escolher o motor de STT, com três camadas:
  - **Local on-device (padrão, sem chave):** definido por plataforma — **Apple Speech** no macOS (nativo, on-device) e **Whisper** (via `whisper.cpp`, embutido no app) no Windows e no Linux. Garante transcrição offline e sem custo de API em qualquer plataforma.
  - **Nuvem (opcional):** STT via provedor (OpenAI/Gemini) para maior precisão, usando a credencial BYOK.
  - O Whisper embutido deve ser distribuído com o app (binário/sidecar) e usar streaming por janela deslizante para exibição ao vivo; a transcrição definitiva da sessão (com pontuação) pode ser reprocessada ao final sobre o áudio completo.
- **RF-302 — Análise:** escolher o modelo que faz análise de IA e chat.
- **RF-303 — Tradução:** escolher um modelo leve para traduzir os outros falantes em tempo real, reaproveitando um provedor já configurado (sem chave extra), com 70+ idiomas de destino. **Não é recurso premium** — segue o mesmo padrão de Transcrição e Análise (seletor de provedor/modelo e estado vazio), sem paywall.

### 4.4 Copiloto e Assistentes (RF-330)

- **RF-331 — Card de insight (layout canônico do overlay/Notch):** contexto da situação (com ícone) no topo; bloco "ELES DISSERAM" com a fala/pergunta do outro falante; bloco "DIGA ISSO" com a resposta sugerida; ação contextual ("Ver caso de uso").
- **RF-332** — Gerar sugestões de resposta, fatos de apoio e tratamento de objeções a partir da transcrição corrente, com streaming token a token.
- **RF-333 — Ações de conversa** (a partir da Home): "Analisar Conversa" (análise completa do que foi dito), "Capturar Tela" (análise visual) e "Perguntar Algo" (prompt livre), cada uma com atalho.
- **RF-334 — Histórico de insights no Notch:** navegável para insight anterior e próximo.
- **RF-335 — Analisar Seleção:** analisar texto selecionado no SO (depende da permissão de Acessibilidade).

#### Biblioteca de Assistentes

- **RF-336** — Biblioteca de assistentes com busca, filtro por categoria (General, Meetings, Sales, Translation, …), paginação e importação de prompts. Cada assistente tem nome, categoria e prompt.
- **RF-337 — Agente LangGraph.js:** selecionar um assistente carrega o prompt/comportamento correspondente no grafo. Trocar de assistente troca a capacidade ativa.
- **RF-338 — Novo assistente:** o usuário insere um prompt em um textarea e cria uma nova capacidade em runtime, adicionada ao grafo.
- **RF-339 — Assistente de Memória:** pesquisa sessões anteriores e permite ler resumos, chat e contexto de transcrições por voz. Requer credencial de provedor (ex.: OpenAI) para sessões de voz em tempo real.

### 4.5 Provedores de IA / BYOK (RF-400)

- **RF-401** — Suportar quatro modos de conexão sob uma abstração comum:
  - **Chave de API:** DeepSeek, Anthropic, Google Gemini, OpenAI;
  - **Login por assinatura:** ChatGPT (sem chave de API);
  - **Agregador:** OpenRouter;
  - **Endpoint compatível com OpenAI:** modelos locais/auto-hospedados (vLLM, LocalAI, etc.), com endpoint base configurável.
- **RF-402** — Campo dedicado para inserir a chave por provedor; filtro Todos / Local / Nuvem.
- **RF-403** — Validar a credencial (chamada de teste) antes de salvar; exibir status de conexão (Conectado / Não Conectado).
- **RF-404** — Alternar provedor/modelo ativo por função (transcrição, análise, tradução) e gerenciar múltiplas credenciais.
- **RF-405** — A lógica do copiloto/agente é agnóstica ao provedor; adicionar novo provedor não altera o grafo.
- **RF-406** — DeepSeek deve estar disponível como card dedicado (chave), além de alcançável por OpenRouter/endpoint compatível.

### 4.6 Modo Stealth e Controles de Janela (RF-500)

- **RF-501 — Exclusão de captura:** as janelas do app são invisíveis na captura de tela/screenshare, mas visíveis ao usuário.
  - Windows: `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)`;
  - macOS: `NSWindowSharingNone` / `sharingType = none`;
  - Linux: depende do compositor (X11/Wayland); degradar graciosamente e documentar limitações.
- **RF-502** — Ativação rápida do stealth pela app bar (indicador de status) e sinalização clara do estado ao usuário.
- **RF-503** — Nenhum bot/participante é adicionado à chamada; captura sempre passiva.
- **RF-504 — Alternar Visibilidade da Janela ("panic hide"):** ocultar/mostrar o app inteiro por atalho global.
- **RF-505 — Sempre no Topo:** toggle por atalho.
- **RF-506 — Opacidade:** aumentar/reduzir a opacidade das superfícies (overlay, Notch, Home) por atalho.
- **RF-507 — Reposicionamento do modal:** deslocar o overlay para esquerda/direita/cima/baixo por atalho (toque = discreto; segurar = contínuo).
- **RF-508** — Exibir aviso sobre uso responsável e conformidade legal ao ativar o stealth (ver seção 7).

### 4.7 Atalhos de Teclado (RF-600)

- **RF-601** — Atalhos globais configuráveis, cada um com toggle de ativação e regravável ("Change"); "Redefinir Todos para Padrões".
- **RF-602 — Regras de validação:** devem incluir modificador (Command/Ctrl ou Alt), exceto teclas únicas permitidas (ex.: Caps Lock); efeito imediato; sem duplicatas; ESC cancela a gravação.
- **RF-603** — Atalhos que operam com o app sem foco (oculto/stealth) requerem registro como atalho global do SO (no macOS, permissão de Acessibilidade).
- **RF-604 — Conjunto padrão:** Perguntar/Enviar (⌘Enter), Capturar Tela (⌘E), Gravação de Voz (⌘D), Alternar Captura do Microfone (⌘⇧D), Rolar Cima/Baixo (⌘↑ / ⌘↓), Insight Anterior/Próximo do Notch (⌘← / ⌘→), Resposta Anterior/Próxima (⌘⌥↑ / ⌘⌥↓), Alternar Barra de Ações (⌘M), Sempre no Topo (⌘⇧A), Aumentar/Reduzir Opacidade (⌘⇧+ / ⌘⇧−), Deslizar Modal Cima/Baixo (⌘⇧↑ / ⌘⇧↓), Deslizar Modal Esquerda/Direita (não atribuídos por padrão), Alternar Visibilidade da Janela.

### 4.8 Recursos de Sessão (RF-700)

- **RF-701 — Rolagem Automática:** acompanha a resposta mais recente; pausa quando o usuário rola para ler o histórico e retoma ao voltar ao fim.
- **RF-702 — Selecionar para Prompt:** selecionar texto + Command+C analisa o conteúdo automaticamente (depende de Acessibilidade).
- **RF-703 — Temporizador de Sessão:** aviso "Continuar Gravando?" a cada 30 min; se não respondido em 60 s, pausa a gravação (controle de custo de API na nuvem).
- **RF-704 — Experiência do Notch:** exibe o Notch durante sessões ativas com sugestões em tempo real e insights de seleção de tela.
- **RF-705 — Compactação automática:** ao atingir um limite de tokens configurável (ex.: 50.000), mensagens antigas são substituídas por um resumo em evolução; acionável por `/compact`; reversível.
- **RF-706 — Análise Rápida de Screenshots:** o atalho de análise envia os screenshots imediatamente, sem passar pela caixa de texto.

### 4.9 Sessões, Histórico e Resumo (RF-800)

- **RF-801** — Registrar cada sessão (transcrição, traduções, sugestões, metadados) no PostgreSQL.
- **RF-802** — Buscar sessões passadas (busca na Home) e listar sessões recentes / todas as sessões.
- **RF-803** — Gerar resumo da sessão (pontos-chave, itens de ação).
- **RF-804** — Revisar e excluir sessões; exportar transcrição/resumo.

### 4.10 Free Tier, Trial e Premium (RF-900)

- **RF-901** — Free tier com contador de sessões grátis (ex.: 0 de 5 usadas).
- **RF-902** — Trial de 7 dias (requer cartão), iniciável pela Home ou onboarding.
- **RF-903** — Badge de plano e distinção de recursos premium.

### 4.11 Ajuda, Suporte e Diagnóstico (RF-1000)

- **RF-1001** — Tela "Sobre" com versão do app.
- **RF-1002** — Comunidade (Discord) e Suporte (documentação/contato).
- **RF-1003** — Reiniciar Integração (reabre onboarding).
- **RF-1004 — Logs de Depuração:** em produção, registrar apenas erros (privacidade); nunca conteúdo de reunião. Abrir pasta de logs e copiar logs para a área de transferência.

---

## 5. Requisitos Não Funcionais

### 5.1 Desempenho

- **RNF-101** — STT streaming: primeiros tokens de transcrição em < 1 s após a fala.
- **RNF-102** — Copiloto: primeiro token da sugestão em < 2 s após o acionamento.
- **RNF-103** — Rodar em segundo plano durante toda a reunião sem degradar a chamada.

### 5.2 Segurança e Privacidade

- **RNF-201** — Credenciais no cofre nativo do SO (Keychain macOS, Credential Manager Windows, Secret Service/`libsecret` no Linux). Nunca em texto claro no Postgres nem em logs.
- **RNF-202** — Comunicação com provedores sempre via TLS.
- **RNF-203** — Dados de sessão locais por padrão; nenhuma telemetria de conteúdo de reunião.
- **RNF-204** — Opção de criptografar o banco de sessões em repouso e purga automática após N dias.
- **RNF-205** — Segredos e conexões via variáveis de ambiente / secrets do Docker.
- **RNF-206 — Fluxo de credencial no BYOK:** o núcleo Rust busca a credencial no cofre e a injeta na chamada ao sidecar por requisição; o segredo não é persistido no lado Node.

### 5.3 Confiabilidade

- **RNF-301** — Degradação graciosa quando a credencial é inválida, o provedor está indisponível ou a rede cai.
- **RNF-302** — Falha de um serviço auxiliar não trava as superfícies de overlay.

### 5.4 Portabilidade

- **RNF-401** — Builds para Linux (AppImage x86_64/ARM64, .deb), macOS e Windows.
- **RNF-402** — Serviços de apoio conteinerizados via Docker Compose.
- **RNF-403** — Funções com implementação específica de macOS têm equivalente definido nas demais plataformas: STT local → Apple Speech (macOS) e Whisper embutido (Windows/Linux); Notch → janela Tauri secundária com material nativo por plataforma; Liquid Glass → vibrancy (macOS), Mica/Acrylic (Windows), translucidez por compositor (Linux).
- **RNF-404 — Whisper embutido:** empacotar o motor Whisper (`whisper.cpp`) e ao menos um modelo por padrão nos builds de Windows e Linux; selecionar tamanho de modelo conforme hardware; rodar em CPU sem depender de GPU.

### 5.5 Usabilidade

- **RNF-501** — UI responsiva; janelas compactas; sempre-no-topo e opacidade ajustáveis.
- **RNF-502** — i18n; PT e EN no lançamento.

### 5.6 Manutenibilidade

- **RNF-601** — Camada de provedores plugável.
- **RNF-602** — Schema de banco versionado por migrações Prisma.
- **RNF-603** — Assistentes/prompts versionáveis e importáveis/exportáveis.

---

## 6. Arquitetura

### 6.1 Visão de Componentes

- **UI (Svelte 5):** app bar, home, overlay/modal, Notch, configurações.
- **Núcleo Tauri (Rust):** captura de áudio nativa, gestão de janelas (stealth, always-on-top, opacidade, reposicionamento), atalhos globais, acesso ao cofre, orquestração.
- **Sidecar Node/TypeScript (empacotado pelo Tauri):** hospeda o Prisma Client e o agente LangGraph.js. O Rust busca a credencial no cofre e a injeta por requisição.
- **Dispositivo de áudio virtual (Ray Audio Driver):** componente nativo por plataforma, com instalação privilegiada.
- **Provedores de IA:** adaptadores (chave / assinatura / agregador / endpoint compatível) atrás de interface comum.
- **PostgreSQL:** persistência de sessões, transcrições, sugestões, assistentes, métricas.
- **Docker Compose:** Postgres e serviços auxiliares para desenvolvimento reproduzível.

> Decisão em aberto (registrar ADR): o Prisma pode rodar no sidecar (Prisma Client via IPC) ou ser usado apenas para schema/migrações, com o Rust acessando o Postgres via `sqlx`. O uso do LangGraph.js favorece o sidecar Node compartilhado (agente + Prisma no mesmo runtime).

### 6.2 Modelo de Dados (alto nível)

`User` · `ApiKeyRef` (ponteiro para o cofre, sem o segredo; inclui tipo de conexão e endpoint base quando aplicável) · `Assistant` (nome, categoria, prompt) · `Session` · `Transcript` (segmento, falante, timestamp) · `Translation` · `Suggestion` (gatilho, provedor/modelo) · `Summary` · `PerformanceMetric` · `Settings` (atalhos, recursos, áudio, idioma).

### 6.3 Fluxos Principais

1. **Captura → Transcrição → Tradução:** canais VOCÊ/OUTROS → STT streaming → segmentos → tradução → overlay/Notch.
2. **Acionar copiloto:** atalho/ação → agente LangGraph carrega o assistente ativo → monta prompt (transcrição + contexto) → provedor selecionado → streaming → card de insight.
3. **Configurar credencial:** inserir/validar → cofre nativo → `ApiKeyRef` no Postgres.
4. **Trocar/criar assistente:** seleciona ou cria prompt → grafo recarrega a capacidade ativa.

---

## 7. Considerações Legais e Éticas

- **7.1** — Gravação e transcrição de conversas estão sujeitas a leis de consentimento que variam por jurisdição; o app deve avisar e recomendar a obtenção do consentimento necessário.
- **7.2** — Uso em entrevistas, exames ou processos seletivos pode violar termos, políticas ou regras de integridade; alertar sobre uso responsável.
- **7.3** — O modo stealth existe para manter a tela de apresentação limpa; a conformidade legal e contratual do uso é responsabilidade do usuário.
- **7.4** — Conformidade com LGPD/GDPR: base legal, minimização, direito de exclusão (RF-804) e retenção configurável (RNF-204).

---

## 8. Linguagem Visual — Liquid Glass

- **8.1** — Todo o app adota Liquid Glass: superfícies translúcidas com material de vidro (blur/refração de fundo) e sombreamento do background por trás dos painéis.
- **8.2** — No macOS (26/2026), usar o material nativo/vibrancy da janela quando disponível.
- **8.3** — Fora do macOS, implementar via camadas translúcidas (`backdrop-filter`) e um design system de tokens de vidro para consistência multiplataforma.
- **8.4** — A opacidade das superfícies (overlay, Notch, Home) é ajustável em tempo real (RF-506), preservando legibilidade sobre fundos variados.

---

## 9. Requisitos de Implantação e DevOps

- **RID-1** — `docker-compose.yml` com PostgreSQL (volume persistente), variáveis de ambiente e sidecar Node quando aplicável.
- **RID-2** — Migrações Prisma versionadas e aplicáveis por comando único.
- **RID-3** — Pipeline de build/release por plataforma (AppImage, .deb, .dmg, .msi) com canais stable/unstable.
- **RID-4** — Auto-update assinado.
- **RID-5** — Empacotamento e instalação do dispositivo de áudio virtual por plataforma (fluxo privilegiado).
- **RID-6** — Builds de Windows e Linux embarcam o motor Whisper e o modelo padrão; considerar o impacto no tamanho do instalador e permitir download/troca de modelos maiores sob demanda.

---

## 10. Escopo Futuro

Diarização avançada por identidade; motor de STT/tradução totalmente offline; sincronização multi-dispositivo criptografada; marketplace de assistentes/playbooks; análise de desempenho histórica agregada.

---

## 11. Critérios de Aceitação (amostra)

| ID | Critério |
|---|---|
| CA-1 | Com um provedor válido, ao acionar o atalho durante uma fala, uma sugestão relevante começa a aparecer em < 2 s. |
| CA-2 | Ao compartilhar a tela em Zoom/Meet/Teams, nenhuma janela do app aparece na captura vista pelos participantes (nas plataformas suportadas). |
| CA-3 | A fala em inglês do canal OUTROS é traduzida para o português em tempo real no overlay, sem paywall. |
| CA-4 | Credenciais não aparecem em texto claro no Postgres nem em logs; ficam no cofre nativo. |
| CA-5 | Com o Audio Driver configurado, o medidor OUTROS reage à fala alheia e o VOCÊ à própria voz, e o usuário continua ouvindo o áudio. |
| CA-5b | Sem nenhuma credencial configurada, a transcrição ao vivo funciona offline: Apple Speech no macOS, Whisper embutido no Windows e no Linux. |
| CA-6 | Trocar de provedor (ex.: OpenAI → Anthropic) não quebra o fluxo do copiloto. |
| CA-7 | Criar um novo assistente com um prompt colado disponibiliza a nova capacidade na próxima sessão. |
| CA-8 | Um atalho sem modificador (fora das exceções) é rejeitado; duplicatas são bloqueadas; ESC cancela a gravação. |
| CA-9 | O card de insight exibe contexto, "ELES DISSERAM" e "DIGA ISSO", e o histórico do Notch navega entre insights. |
| CA-10 | Todas as superfícies renderizam sob Liquid Glass e respondem aos atalhos de opacidade. |
