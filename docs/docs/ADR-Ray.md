# Registros de Decisão Arquitetural (ADRs) — Ray

**Versão:** 1.0
**Data:** 15 de agosto de 2026
**Relacionado a:** SRS-Ray.md v2.0

> Cada ADR segue o formato: Contexto → Decisão → Alternativas consideradas → Consequências.
> Estes registros congelam as decisões estruturais antes da definição de types/interfaces e da fragmentação em tasks. Devem ser tratados como fonte de verdade pelos agentes de codificação.

---

## ADR-001 — Fronteira de processos: núcleo Rust + sidecar Node

**Status:** Aceito

### Contexto

O Ray combina tecnologias de runtimes diferentes: captura de áudio nativa, gestão de janelas (stealth, opacidade) e acesso ao cofre de credenciais são naturais em Rust (núcleo Tauri); o agente de assistentes (LangGraph.js) e o ORM (Prisma) são do ecossistema Node/TypeScript. É preciso decidir como esses mundos coexistem em um app desktop distribuível, sem exigir que o usuário instale Node.

### Decisão

Adotar dois processos:

1. **Núcleo Tauri (Rust)** — processo principal: captura de áudio, janelas, atalhos globais, cofre de credenciais, orquestração e IPC com a UI.
2. **Sidecar Node/TypeScript** — processo secundário empacotado como binário autocontido (via `pkg` ou equivalente) e declarado em `externalBin` no `tauri.conf.json`. Hospeda o agente LangGraph.js e o Prisma Client.

O Rust é o supervisor: inicia o sidecar no boot do app, monitora seu ciclo de vida e o reinicia em caso de falha. A UI Svelte nunca fala com o sidecar diretamente — sempre via núcleo Rust.

### Alternativas consideradas

- **Tudo em Rust (sem sidecar):** exigiria reimplementar o agente e o acesso Prisma em Rust. Perde-se o LangGraph.js. Rejeitada — o custo de reescrever a orquestração de agentes supera o ganho de ter um só runtime.
- **Runtime Node instalado pelo usuário:** rejeitada — fere o requisito de app autocontido (RNF-401).
- **Embutir o runtime Node + JS como resource** (em vez de binário `pkg`): possível, mas expõe o código como arquivos legíveis e tende a gerar bundle maior. Preterida em favor do binário autocontido.

### Consequências

- (+) Cada capacidade fica no runtime onde é mais natural; o LangGraph.js é preservado.
- (+) Isolamento de falhas: uma queda do sidecar não derruba as janelas de overlay (atende RNF-302).
- (−) Overhead de empacotar e versionar um binário Node por plataforma/arquitetura (target triple).
- (−) Introduz uma fronteira de IPC entre Rust e sidecar que precisa de contrato explícito (ver ADR-005).

---

## ADR-002 — Acesso ao PostgreSQL: Prisma no sidecar

**Status:** Aceito

### Contexto

O Prisma é um ORM de TypeScript. O núcleo é Rust. Há duas formas de usar o Postgres: (a) Prisma rodando no sidecar Node e o Rust delegando toda persistência a ele; (b) usar o Prisma apenas para schema/migrações e acessar o Postgres a partir do Rust via `sqlx`/`diesel`.

### Decisão

Adotar **(a)**: o Prisma Client roda no sidecar Node e é a única via de acesso ao banco. O sidecar expõe operações de dados ao núcleo; o Rust não acessa o Postgres diretamente.

Justificativa central: o consumidor primário dos dados de sessão é o próprio agente LangGraph.js (contexto, memória, histórico de assistentes), que já vive no sidecar. Colocar o Prisma no mesmo runtime elimina uma fronteira de serialização entre agente e dados.

### Alternativas consideradas

- **`sqlx` no Rust + Prisma só para migração:** manteria a persistência no processo mais estável e daria tipos Rust nativos. Rejeitada como padrão porque duplicaria a modelagem de dados em dois lugares (schema Prisma + structs Rust) e afastaria os dados do seu consumidor principal (o agente). Fica registrada como plano B caso a latência de dados via sidecar se mostre problemática.

### Consequências

- (+) Uma única definição de modelo (`schema.prisma`) como fonte de verdade; migrações versionadas (atende RNF-602).
- (+) Agente e dados no mesmo runtime — menos serialização no caminho quente do copiloto.
- (−) Toda leitura/escrita que o Rust precise fazer passa pelo IPC com o sidecar.
- (−) O sidecar passa a ser dependência crítica para persistência; reforça a necessidade de supervisão (ADR-001) e de fila local para degradação graciosa (RNF-301).

---

## ADR-003 — Fluxo de credenciais BYOK: cofre no Rust, injeção por requisição

**Status:** Aceito

### Contexto

As credenciais de IA (chaves, tokens de sessão) são o dado mais sensível do app. O SRS exige armazenamento no cofre nativo do SO e proíbe texto claro no banco e em logs (RNF-201). O consumidor das credenciais é o sidecar (que faz as chamadas aos provedores via LangGraph.js). Precisamos evitar que o segredo seja persistido no lado Node.

### Decisão

O **núcleo Rust é o único guardião das credenciais**. Fluxo:

1. O Rust lê/grava segredos exclusivamente no cofre nativo (Keychain no macOS, Credential Manager no Windows, Secret Service/`libsecret` no Linux).
2. No banco, persiste-se apenas um `ApiKeyRef` (provedor, rótulo, tipo de conexão, endpoint base quando aplicável) — **nunca o segredo**.
3. Quando o sidecar precisa chamar um provedor, o Rust busca o segredo no cofre e o injeta na requisição ao sidecar **por chamada**. O sidecar usa o segredo em memória e não o persiste.

### Alternativas consideradas

- **Sidecar acessa o cofre diretamente:** rejeitada — espalha a superfície de acesso ao segredo por dois runtimes e complica a auditoria.
- **Segredo em variável de ambiente do sidecar no boot:** rejeitada — o segredo ficaria residente no processo por toda a sessão e visível em inspeções de ambiente.

### Consequências

- (+) Superfície de exposição do segredo minimizada e centralizada no Rust.
- (+) Facilita rotação/remoção de credencial (RF-405) sem tocar no sidecar.
- (−) O núcleo precisa injetar credencial em cada requisição de provedor, exigindo um contrato de IPC que carregue o segredo de forma efêmera.
- (−) A validação de chave (RF-403) é orquestrada pelo Rust, não pelo sidecar.

---

## ADR-004 — Captura de áudio recebido: driver de áudio virtual próprio

**Status:** Aceito

### Contexto

Para transcrever os demais participantes (canal OUTROS) sem depender da permissão de gravação de tela, o Ray precisa de acesso ao áudio de saída do sistema. As plataformas diferem: o macOS não permite capturar áudio de saída sem um dispositivo virtual; o Windows oferece loopback via WASAPI; o Linux expõe monitores de saída em PulseAudio/PipeWire.

### Decisão

Fornecer o **Ray Audio Driver**, um dispositivo de áudio virtual, como componente nativo separado, com estratégia por plataforma:

- **macOS:** plugin CoreAudio/HAL instalado com privilégio; selecionável como fonte de "Áudio Recebido" apenas dentro do app.
- **Windows:** preferir loopback WASAPI nativo (sem driver); instalar driver apenas se o loopback não cobrir o caso.
- **Linux:** usar monitor de saída do PulseAudio/PipeWire; sem driver dedicado.

O driver é sempre **fonte de captura, nunca saída** — o app documenta e valida a configuração correta (RF-204).

### Alternativas consideradas

- **Só permissão de gravação de tela para obter áudio:** rejeitada — mais intrusiva e nem sempre entrega o áudio isolado; o driver é o caminho que o próprio produto-referência adota.
- **Driver virtual único cross-platform:** inviável — a camada de áudio é fundamentalmente diferente por SO.

### Consequências

- (+) Captura confiável do canal OUTROS sem exigir gravação de tela.
- (+) No Windows/Linux, evita instalar driver quando o SO já oferece loopback/monitor.
- (−) No macOS, exige instalação privilegiada e versionamento próprio do driver (RID-5); é o ponto mais frágil de onboarding.
- (−) Aumenta a matriz de teste (um caminho de áudio por plataforma).

---

## ADR-005 — Protocolo de IPC entre núcleo e sidecar

**Status:** Aceito

### Contexto

Rust e sidecar Node precisam trocar mensagens: acionar o agente, transmitir transcrição, receber sugestões em streaming, executar operações de dados, injetar credenciais. O SRS exige streaming token a token (RF-332) e baixa latência (RNF-102).

### Decisão

Comunicação sobre **HTTP local (loopback) com streaming**: o sidecar sobe um servidor em `127.0.0.1` numa porta efêmera, escolhida no boot e informada ao Rust. Respostas em streaming usam resposta chunked/SSE para carregar tokens conforme chegam. Toda a superfície é composta por endpoints tipados, definidos por um contrato compartilhado (ver observação abaixo).

Regras:
- O servidor liga **apenas em loopback**; nunca exposto na rede.
- Segredos trafegam apenas no corpo de requisições efêmeras (ADR-003), nunca em query string nem em logs.
- A porta é aleatória por sessão; o Rust é o único cliente.

### Alternativas consideradas

- **stdin/stdout do sidecar:** simples e sem porta de rede, mas o multiplexação de múltiplas requisições concorrentes com streaming fica mais frágil. Preterida; pode ser reavaliada se a porta loopback trouxer atrito.
- **Unix domain sockets / named pipes:** ótima opção de isolamento, mas com diferenças por plataforma que aumentam o custo de implementação inicial. Registrada como evolução futura de ADR-005.

### Consequências

- (+) Streaming natural (SSE/chunked) atende o token-a-token do copiloto.
- (+) Contrato de endpoints tipado vira a fronteira de tasks entre agentes de codificação.
- (−) Superfície de rede local exige cuidado (bind restrito a loopback, porta efêmera).
- (−) Necessita um esquema de contrato versionado e compartilhado entre Rust e TS.

> Observação de implementação: o contrato de IPC deve ter uma fonte de verdade única (ex.: schema compartilhado que gere tanto tipos TS quanto structs Rust) para garantir que ambos os lados sejam codificados contra a mesma definição. Detalhar na etapa de types/interfaces.

---

## ADR-006 — Abstração de provedores de IA

**Status:** Aceito

### Contexto

O SRS exige quatro modos de conexão (chave de API, login por assinatura, agregador, endpoint compatível com OpenAI) sobre provedores distintos (DeepSeek, Anthropic, Gemini, OpenAI, OpenRouter, endpoints locais), com seleção independente por função (transcrição, análise, tradução) e resolução de credencial por "grupo de provedor" (RF-400/404/405).

### Decisão

Definir uma **interface única de provedor** no sidecar, contra a qual cada provedor concreto é um adapter. A interface abstrai: identidade do provedor, modo de conexão, resolução de credencial (recebida do Rust por requisição), e as operações suportadas (análise/chat com streaming; e, quando aplicável, transcrição e tradução). O agente LangGraph.js e o restante do sistema permanecem agnósticos ao provedor concreto.

### Alternativas consideradas

- **Condicionais por provedor espalhadas no código do agente:** rejeitada — acopla o grafo aos provedores e viola RNF-601.
- **Uma interface separada por modo de conexão:** rejeitada — multiplicaria as fronteiras; o modo de conexão é um atributo do adapter, não uma interface distinta.

### Consequências

- (+) Adicionar um provedor é implementar um adapter, sem tocar no grafo (atende RNF-601) — e vira uma task isolável e paralelizável por agente de codificação.
- (+) DeepSeek entra como adapter dedicado, além de alcançável por OpenRouter/endpoint (RF-406).
- (−) A interface precisa ser larga o suficiente para cobrir capacidades heterogêneas (nem todo provedor faz transcrição), exigindo declaração de capacidades por adapter.

---

## ADR-007 — Estratégia de STT por plataforma

**Status:** Aceito

### Contexto

O SRS fixou STT local on-device como padrão sem chave, com implementação por plataforma, além de nuvem opcional (RF-301).

### Decisão

- **macOS:** Apple Speech nativo (on-device, sem chave).
- **Windows e Linux:** Whisper via `whisper.cpp`, embutido no app (binário/sidecar), rodando em CPU sem depender de GPU.
- **Nuvem (opcional):** STT via provedor (OpenAI/Gemini) para maior precisão, usando BYOK.

Para exibição ao vivo, o Whisper opera com janela deslizante (streaming aproximado). A transcrição definitiva da sessão pode ser reprocessada ao final sobre o áudio completo.

### Alternativas consideradas

- **Whisper em todas as plataformas (inclusive macOS):** unificaria o motor, mas descartaria um recurso nativo, gratuito e integrado no macOS. Preterida.
- **Motor incremental (ex.: Vosk) para o ao vivo:** melhor latência de streaming que o Whisper, mas menor precisão. Registrada como evolução caso a latência ao vivo em Windows/Linux se mostre insuficiente (o RF-301 já deixa o gancho arquitetural).

### Consequências

- (+) "Sem chave, offline" garantido em qualquer plataforma.
- (+) Aproveita o melhor de cada SO no macOS.
- (−) Builds de Windows/Linux embarcam modelo Whisper, impactando tamanho do instalador (RID-6).
- (−) Latência ao vivo do Whisper (janela deslizante) fica na faixa de segundos, não milissegundos.

---

## ADR-008 — Superfícies de janela e modo stealth

**Status:** Aceito

### Contexto

O Ray tem múltiplas superfícies (app bar, home, overlay/modal, Notch) que precisam de comportamentos de janela especiais: exclusão de captura (stealth), always-on-top, opacidade ajustável e reposicionamento — com forte dependência de SO/compositor (RF-500).

### Decisão

Cada superfície é uma **janela Tauri gerenciada pelo núcleo Rust**. O stealth (exclusão de captura) usa a API nativa de cada plataforma:

- **Windows:** `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)`.
- **macOS:** `NSWindowSharingNone`.
- **Linux:** depende do compositor (X11/Wayland); degradar graciosamente e sinalizar limitação ao usuário quando indisponível.

Os demais controles (always-on-top, opacidade, reposicionamento) são operações de janela expostas pelo núcleo e acionadas por atalhos globais.

### Alternativas consideradas

- **Uma única janela com regiões internas:** rejeitada — as superfícies têm ciclos de vida e comportamentos de captura distintos (a home não precisa de stealth; o overlay sim).
- **Overlay via tecnologia fora do Tauri:** rejeitada — aumentaria a complexidade sem ganho claro; o Tauri já gerencia múltiplas janelas.

### Consequências

- (+) Controle fino por superfície; stealth aplicável só onde necessário.
- (−) Comportamento de stealth no Linux é não-garantido e precisa de comunicação clara ao usuário.
- (−) Exige teste por plataforma e por compositor no Linux.

---

## ADR-009 — Empacotamento, atualização e componentes privilegiados

**Status:** Aceito

### Contexto

O app distribui múltiplos artefatos por plataforma: binário principal, sidecar Node, modelo Whisper (Windows/Linux), e o driver de áudio (macOS). Alguns exigem privilégio de instalação. O SRS pede builds por plataforma, canais stable/unstable e auto-update assinado (RID-3/4/5/6).

### Decisão

- Distribuir por plataforma: AppImage (x86_64/ARM64) e `.deb` no Linux, `.dmg` no macOS, `.msi` no Windows, com canais stable/unstable.
- O sidecar Node é empacotado como binário autocontido por target triple e embarcado via `externalBin`.
- O modelo Whisper padrão é embarcado nos builds de Windows/Linux; modelos maiores podem ser baixados sob demanda.
- O driver de áudio (macOS) tem fluxo de instalação privilegiado próprio e versionamento independente do app.
- Auto-update assinado para o app; o driver, por ser privilegiado, tem ciclo de atualização à parte.

### Consequências

- (+) App autocontido, sem dependências externas para o usuário.
- (−) Matriz de build ampla (SO × arquitetura × artefatos).
- (−) O componente privilegiado (driver) não pode depender do auto-update comum e precisa de fluxo próprio.

---

## ADR-011 — Renderização e edição de Markdown na UI

**Status:** Aceito

### Contexto

O agente devolve respostas em Markdown, frequentemente com blocos de código que precisam de syntax highlight. O conteúdo é salvo/exportado como Markdown (RF-704/803 e afins). A UI tem dois usos distintos: exibir respostas em streaming (read-only) e editar Markdown (a resposta pronta e, futuramente, campos de input do usuário).

### Decisão

Separar em duas peças:

1. **Renderizador read-only leve** para exibição em streaming (card "DIGA ISSO", Notch, resumos), com syntax highlight. Não usa editor completo — evita re-render pesado a cada token.
2. **Editor WYSIWYG Milkdown** (ProseMirror + remark) para edição, cujo modelo interno já é Markdown — entrada e saída em Markdown sem round-trip para HTML.

Milkdown é headless (estilizado pelos tokens Liquid Glass) e tem plugins de code highlight e CommonMark/GFM.

### Alternativas consideradas

- **Tiptap/Tipex (base HTML):** têm wrapper Svelte 5 nativo mais pronto, mas exigem conversão Markdown↔HTML (Turndown) nas duas pontas — cada round-trip arrisca a fidelidade de blocos de código vindos do agente. Registrado como alternativa aceitável se um wrapper Svelte 5 turnkey for prioridade sobre fidelidade de Markdown.
- **Um só editor para exibir e editar:** rejeitada — usar o editor completo para renderizar streaming é peso desnecessário.

### Consequências

- (+) Markdown é cidadão de primeira classe; sem perda em conversão; código sobrevive ao round-trip.
- (+) Estilização integrada ao Liquid Glass (headless).
- (−) Em Svelte 5, o Milkdown provavelmente exige fiação manual via API core (não há componente Svelte turnkey oficial tão polido quanto o de React) — sinalizado na task T-408.

---

## ADR-010 — Fonte de verdade dos tipos (duas camadas)

**Status:** Aceito

### Contexto

Para que agentes de codificação em contextos isolados produzam fragmentos que encaixem, os contratos de tipo precisam de fonte de verdade única e gerada, não redigitada em cada lado. No Ray, porém, há duas fronteiras de tipos com donos naturais diferentes.

### Decisão

Duas camadas, cada uma com sua fonte:

1. **Tipos de domínio** (Session, Transcript, Assistant, …): a fonte é o **`schema.prisma`** (coerente com ADR-002). O Prisma gera os tipos TS do sidecar. Como o Rust não acessa o banco (ADR-002), ele só conhece os tipos de domínio que aparecem nos payloads de IPC — que entram pela camada 2.
2. **Tipos de fronteira IPC** (payloads Rust↔sidecar): a fonte é o **Rust**, com **`ts-rs`** gerando os tipos TS correspondentes. Escolhido `ts-rs` sobre `typeshare` por termos só dois alvos (Rust/TS) e pela geração colada à definição via derive macro.

### Alternativas consideradas

- **Fonte única para tudo (só Rust, ou só um schema neutro):** rejeitada — contraria o ADR-002 (Prisma dono do banco) e criaria acoplamento artificial entre domínio e fronteira.
- **`typeshare` no lugar de `ts-rs`:** viável; preterida por não precisarmos de multi-linguagem.

### Consequências

- (+) Cada camada é gerada de sua fonte natural; zero redigitação manual de tipos entre linguagens.
- (+) As duas fontes viram os primeiros artefatos verificáveis da etapa de types (o `schema.prisma` e os structs `#[derive(TS)]`).
- (−) São dois geradores no pipeline de build (Prisma generate + ts-rs), que precisam rodar antes de compilar os consumidores.

---

## ADR-012 — Captura de áudio no macOS: BlackHole no lugar do driver próprio

**Status:** Aceito (2026-09-06). Supersedes a parte macOS do ADR-004.

### Contexto

O Ray Audio Driver (T-500) chegou a carregar no coreaudiod do macOS 26, mas o dispositivo nunca é enumerado: o protocolo de propriedades do HAL do Tahoe exige mais do que o contrato documentado (a conversa para após `'ctrl'` vazio, com o HAL perguntando seletores privados como `'siso'`). Cada rodada de diagnóstico exige reinstalação privilegiada e reinício do coreaudiod, e o resultado final — mesmo se concluído — manteria os dois maiores atritos de onboarding: instalação com senha de administrador e configuração manual de Multi-Output Device.

### Decisão

No macOS, o canal OUTROS usa o **BlackHole** (existente, GPL, já suportado pelo fallback de enumeração do core) em vez do driver próprio:

- O hint do app instrui `brew install --cask blackhole-2ch` + Multi-Output Device.
- A detecção (cpal) casa "blackhole" no nome do dispositivo; "ray audio" permanece como fallback inofensivo.
- O código do driver fica arquivado no repo (`driver/`), com o plugin carregável mas sem enumeração de device (ver `docs/HANDOFF-driver-macos26.md`).

### Alternativas consideradas

- **Concluir o T-500 (controles de volume/mute no plugin):** rejeitada por ora — protocolo não documentado, ciclo de teste lento e UX final ainda ruim (senha + Multi-Output).
- **Core Audio Process Taps (macOS 14.4+):** o caminho estratégico de longo prazo — captura sem driver, sem senha e sem Multi-Output, apenas permissão do usuário; requer reescrever a captura do core (FFI). Fica registrado para reavaliação.
- **libASPL (biblioteca C++17 para AudioServerPlugIn):** resolveria o protocolo, mas manteria os atritos de instalação.

### Consequências

- (+) Elimina a instalação privilegiada do nosso lado — o usuário instala o BlackHole pelo brew, caminho amplamente documentado.
- (+) Zero manutenção de plugin HAL proprietário contra um alvo (macOS 26) cujo protocolo é opaco.
- (−) Dependência externa (GPL) — aceitável porque não embutimos o código, apenas detectamos e capturamos do dispositivo.
- (−) O atrito do Multi-Output Device permanece até a migração para Process Taps.

---

## Decisões em aberto (para revisitar)

- **Migração de loopback HTTP para socket/pipe** (ADR-005): reavaliar se latência ou isolamento exigirem.
- **`sqlx` no Rust como plano B** (ADR-002): reavaliar se a persistência via sidecar virar gargalo.
- **Motor incremental para STT ao vivo** (ADR-007): reavaliar conforme latência observada em Windows/Linux.
- **Core Audio Process Taps no macOS** (ADR-012): captura de sistema sem driver nenhum (macOS 14.4+); reavaliar como próximo passo da captura de áudio.
