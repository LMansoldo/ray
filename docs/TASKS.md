# Ray — Backlog de Tasks para Claude Code

**Versão:** 1.0
**Relacionado a:** SRS-Ray.md, ADR-Ray.md, e o scaffold em `ray/`

## Como usar este backlog

Cada task é auto-contida e escrita para ser entregue isolada ao Claude Code. Uma task traz: o **objetivo**, os **arquivos que toca**, o **contrato** (o que não pode mudar de assinatura), as **dependências** (tasks que precisam estar prontas antes) e o **critério de pronto** (verificável, sem julgamento subjetivo).

Regras gerais que valem para toda task, para colar no início de cada sessão do Claude Code:

- Não alterar assinaturas ditadas por `contracts/ipc.ts`, `prisma/schema.prisma` ou pela interface `AiProvider`. Se um contrato parecer errado, parar e sinalizar — não improvisar um shape novo.
- Uma task só está pronta quando compila (`tsc --noEmit` no sidecar/UI; `cargo check` no core) e passa os testes indicados.
- Segredos de credencial nunca são logados, nunca persistidos no sidecar, nunca em query string (ADR-003).
- Preencher stubs no lugar; não recriar arquivos do zero.

As tasks estão agrupadas em fases por dependência. Dentro de uma fase, as tasks são majoritariamente paralelizáveis.

---

## FASE 0 — Fundação (bloqueia quase tudo; fazer primeiro, em série) — CONCLUÍDA (T-000..T-003)

### T-000 · Ligar a geração de tipos ts-rs → contracts/ipc.ts
**Status:** Concluído — commit `57ea6ae` (merge `fbac5c7` em `dev`).
**Objetivo:** Tornar `core/src/ipc.rs` a fonte de verdade real, gerando `contracts/ipc.ts` em vez de mantê-lo à mão (ADR-010).
**Toca:** `core/src/ipc.rs`, `core/Cargo.toml`, `contracts/ipc.ts` (passa a ser gerado), script de build.
**Contrato:** Os tipos gerados devem bater 1:1 com o `contracts/ipc.ts` atual (que é o espelho de referência). Divergência de nome/shape é regressão.
**Dependências:** nenhuma.
**Pronto quando:** `cargo test` exporta os bindings; o diff entre o `ipc.ts` gerado e o espelho de referência é só de formatação; documentado o comando de regeneração no README.

### T-001 · Setup do projeto Tauri 2 + scaffold da UI Svelte 5
**Status:** Concluído — commit `d53ecc5` (merge `fbac5c7` em `dev`).
**Objetivo:** Criar o app Tauri 2 real cabeando `core/` como o crate do núcleo, e inicializar `apps/ui` como projeto Svelte 5 + Vite + TypeScript.
**Toca:** `core/` (tauri.conf.json, build.rs, main.rs), `apps/ui/` (projeto Svelte novo), configuração de `externalBin` para o sidecar.
**Contrato:** `core/src/lib.rs` já define `run()` e os comandos; manter. A UI deve usar Svelte 5 com runes.
**Dependências:** nenhuma (pode ir em paralelo a T-000).
**Pronto quando:** `cargo check` no core passa no host; `npm run build` na UI passa; o app abre uma janela em dev.

### T-002 · Migração inicial do Prisma + Prisma Client no sidecar
**Status:** Concluído — commit `30418a0` (merge `fbac5c7` em `dev`).
**Objetivo:** Gerar o cliente Prisma e a primeira migração a partir de `prisma/schema.prisma`; expor uma instância de client reutilizável no sidecar.
**Toca:** `prisma/`, `sidecar/src/db.ts` (novo), `sidecar/package.json` (scripts de migração).
**Contrato:** Não alterar `schema.prisma` sem sinalizar. O client é singleton no processo do sidecar.
**Dependências:** nenhuma.
**Pronto quando:** `npx prisma validate` passa; `npx prisma migrate dev` cria a migração; `import { prisma } from "./db.js"` disponível e tipado.

### T-003 · Fonte de verdade única para features/shortcuts (tipos dos JSON)
**Status:** Concluído — commit `59de7c1` (merge `fbac5c7` em `dev`).
**Objetivo:** Definir os tipos canônicos dos campos `Settings.features` e `Settings.shortcuts` (hoje `Json` no schema), num módulo compartilhado, com validação em runtime.
**Toca:** `contracts/settings.ts` (novo), `sidecar/src/settings.ts` (validação).
**Contrato:** Os toggles de recursos (RF-700) e o conjunto de atalhos com defaults (RF-604) do SRS. Os nomes dos atalhos devem casar com os comandos que a UI e o core registram.
**Dependências:** nenhuma.
**Pronto quando:** tipos definidos e um validador (ex.: zod ou checagem manual) rejeita objetos malformados; `tsc --noEmit` passa.

---

## FASE 1 — Sidecar: dados e agente (dependem da Fase 0)

### T-100 · Handler: sessões (start / transcript / end)
**Objetivo:** Implementar `startSession`, `appendTranscript`, `endSession` em `handlers.ts` usando o Prisma.
**Toca:** `sidecar/src/handlers.ts`, `sidecar/src/db.ts`.
**Contrato:** Assinaturas de `StartSessionRequest/Response`, `AppendTranscriptRequest`, `EndSessionRequest/Response` em `contract.ts`. `endSession` com `generateSummary=true` dispara a geração (ver T-103).
**Dependências:** T-002.
**Pronto quando:** cada handler persiste/atualiza corretamente; teste de integração com um Postgres de teste cria uma sessão, anexa 2 segmentos e a encerra; retornos seguem `IpcResult`.

### T-101 · Handler: assistentes (create) + seed dos builtin
**Objetivo:** Implementar `createAssistant` e semear os assistentes BUILTIN (General, LeetCode, Note Taker, Sales, Study, Tech Candidate) do wireframe.
**Toca:** `sidecar/src/handlers.ts`, `sidecar/prisma/seed.ts` (novo).
**Contrato:** `CreateAssistantRequest/Response`; `AssistantSource.BUILTIN` para os semeados, `USER` para os criados em runtime (RF-336/338).
**Dependências:** T-002.
**Pronto quando:** criar um assistente USER retorna id e persiste; o seed insere os builtin idempotentemente; teste cobre ambos.

### T-102 · Grafo LangGraph base + carregamento de assistente
**Objetivo:** Montar o grafo LangGraph.js que recebe o prompt do assistente ativo e o contexto, e produz a sugestão. No stub, um nó que chama o provider resolvido.
**Toca:** `sidecar/src/agent/graph.ts` (novo), `sidecar/src/handlers.ts` (suggestStream/analyze).
**Contrato:** Entrada = `SuggestRequest`; saída = sequência de `SuggestStreamEvent` (streaming) ou `AnalyzeResponse` (consolidado). O grafo é agnóstico ao provider (usa a interface `AiProvider`).
**Dependências:** T-101 (carrega o assistente), T-2xx (providers — pelo menos um real).
**Pronto quando:** dado um assistente e um contexto, o grafo emite `start` → `token`* → `done`; troca de assistente troca o comportamento; teste com um provider fake.

### T-103 · Geração de resumo de sessão
**Objetivo:** Implementar a geração de `Summary` (texto + action items) ao encerrar a sessão.
**Toca:** `sidecar/src/handlers.ts` (endSession), `sidecar/src/agent/summary.ts` (novo).
**Contrato:** Usa a credencial injetada em `EndSessionRequest.credential`; persiste `Summary` 1:1 com a sessão (RF-803).
**Dependências:** T-100, T-102.
**Pronto quando:** encerrar uma sessão com transcrição gera e persiste resumo com ao menos 1 action item; teste com provider fake.

---

## FASE 2 — Sidecar: adapters de provedor (paralelizáveis entre si)

> Todas seguem o mesmo molde de `providers/openai.ts` e implementam `AiProvider` (ADR-006). Cada uma é uma task idêntica em forma. Registrar em `providers/registry.ts`.

### T-200 · Adapter OpenAI (chave de API)
**Toca:** `sidecar/src/providers/openai.ts`, `registry.ts`.
**Contrato:** `AiProvider`; capabilities analysis+transcription+translation. `validate` confirma a chave; `analyzeStream` faz streaming de chat; `translate` traduz.
**Dependências:** T-000 (tipos), T-102 pode consumir depois.
**Pronto quando:** contra a API real (ou mock HTTP), `validate` retorna modelos; `analyzeStream` emite chunks; testes de capacidade.

### T-201 · Adapter Anthropic
### T-202 · Adapter Google Gemini
### T-203 · Adapter DeepSeek
### T-204 · Adapter OpenRouter (agregador)
### T-205 · Adapter Generic (endpoint compatível com OpenAI: baseUrl configurável)
**(T-201..T-205 idênticas em forma a T-200, trocando o provedor.)**
**Nota T-205:** cobre vLLM/LocalAI/self-hosted via `baseUrl`; é o caminho alternativo para DeepSeek também (RF-406).

### T-206 · Handler: validateCredential ligado aos adapters
**Objetivo:** Terminar `validateCredential` para delegar ao adapter certo por `kind` (já esboçado).
**Toca:** `sidecar/src/handlers.ts`.
**Dependências:** ao menos T-200.
**Pronto quando:** validar credencial de cada provider registrado retorna resultado correto; credencial inválida retorna `valid:false` sem vazar segredo.

### T-207 · Handler: translate ligado aos adapters
**Toca:** `sidecar/src/handlers.ts`.
**Contrato:** `TranslateRequest/Response`; escolhe adapter por `credential.kind`, exige capability translation.
**Dependências:** ao menos T-200.
**Pronto quando:** traduz um texto EN→PT via adapter; provider sem translation lança erro tratado.

---

## FASE 3 — Núcleo Rust (dependem de T-001; várias paralelizáveis)

### T-300 · Supervisão do sidecar + descoberta de porta
**Objetivo:** Implementar `sidecar::Sidecar::start`: spawnar o sidecar via externalBin, ler `RAY_SIDECAR_PORT=` do stdout, healthcheck, e reinício em falha (ADR-001/005).
**Toca:** `core/src/sidecar.rs`.
**Contrato:** Expõe `base_url()` e `health()`; reinicia sem derrubar as janelas (RNF-302).
**Dependências:** T-001.
**Pronto quando:** o core sobe o sidecar, obtém a porta, e `GET /health` responde; matar o sidecar dispara reinício.

### T-301 · Cofre de credenciais nativo
**Objetivo:** Implementar `vault.rs` com `keyring`: store/get/delete. O banco só guarda `secret_ref` (ADR-003).
**Toca:** `core/src/vault.rs`.
**Dependências:** T-001.
**Pronto quando:** um segredo é gravado no keychain nativo, recuperado e apagado; nada do segredo aparece em log; teste por plataforma (ao menos a de desenvolvimento).

### T-302 · Injeção de credencial no fluxo de IPC
**Objetivo:** No caminho de chamada ao sidecar, o core busca o segredo via `vault::get_secret` e o injeta em `InjectedCredential` por requisição.
**Toca:** `core/src/lib.rs` (comando suggest e afins), novo módulo `core/src/ipc_client.rs`.
**Contrato:** O segredo é efêmero; nunca persistido no sidecar; `ApiKeyRef` no banco não contém segredo.
**Dependências:** T-300, T-301.
**Pronto quando:** um `suggest` resolve a credencial do cofre e a envia ao sidecar; teste confirma que o segredo não aparece em logs.

### T-303 · Ponte de streaming SSE(sidecar) → evento Tauri(UI)
**Objetivo:** Consumir o SSE de `/copilot/suggest` no core e reemitir cada `SuggestStreamEvent` como evento Tauri para a UI.
**Toca:** `core/src/lib.rs` (comando suggest), `core/src/ipc_client.rs`.
**Contrato:** Ordem preservada: `start` → `token`* → `done`/`error`.
**Dependências:** T-302, T-102 (sidecar emitindo de verdade).
**Pronto quando:** a UI recebe tokens em tempo real; erro no meio vira evento `error`.

### T-304 · Controles de janela e stealth
**Objetivo:** Implementar `windows.rs`: exclusão de captura por plataforma, always-on-top, opacidade, toggle de visibilidade (ADR-008).
**Toca:** `core/src/windows.rs`, `core/src/lib.rs` (comandos).
**Contrato:** Windows `WDA_EXCLUDEFROMCAPTURE`; macOS `NSWindowSharingNone`; Linux degrada e sinaliza.
**Dependências:** T-001.
**Pronto quando:** em macOS/Windows a janela some da captura de tela; no Linux o app avisa quando não suportado; toggles funcionam.

### T-305 · Atalhos globais
**Objetivo:** Registrar os atalhos globais do SRS (RF-604) com as regras de validação (RF-602), mapeando cada um a um comando.
**Toca:** `core/src/shortcuts.rs` (novo), `core/src/lib.rs`.
**Contrato:** Nomes dos atalhos casam com T-003; funcionam com o app sem foco (stealth).
**Dependências:** T-001, T-003, T-304 (alguns atalhos operam janelas).
**Pronto quando:** cada atalho dispara sua ação com o app oculto; duplicatas rejeitadas; ESC cancela regravação.

### T-306 · Captura de áudio (canais VOCÊ e OUTROS)
**Objetivo:** Implementar `audio.rs`: enumerar dispositivos, iniciar captura, entregar PCM ao pipeline de STT. Loopback WASAPI (Win), Ray Audio Driver (mac), monitor Pulse/PipeWire (Linux) — ADR-004.
**Toca:** `core/src/audio.rs`.
**Dependências:** T-001.
**Pronto quando:** os medidores VOCÊ/OUTROS reagem à fala respectiva (CA-5); PCM chega ao consumidor de STT.

### T-307 · STT por plataforma (Apple Speech / Whisper)
**Objetivo:** Transcrição on-device: Apple Speech no macOS, `whisper.cpp` embutido no Windows/Linux, com streaming por janela deslizante (ADR-007).
**Toca:** `core/src/stt/` (novo, com impl por plataforma), integração com `audio.rs`.
**Contrato:** Emite segmentos de transcrição com speaker e offsets, alimentando `appendTranscript`.
**Dependências:** T-306.
**Pronto quando:** sem credencial configurada, a transcrição ao vivo funciona offline em cada plataforma (CA-5b).

---

## FASE 4 — UI Svelte 5 (dependem de T-001; superfícies paralelizáveis)

> Design system Liquid Glass compartilhado primeiro (T-400), depois as superfícies.

### T-400 · Design system Liquid Glass + tokens
**Objetivo:** Criar os tokens e componentes base de vidro (superfícies translúcidas, sombreamento de fundo) e o controle de opacidade, com fallback multiplataforma (SRS seção 8).
**Toca:** `apps/ui/src/lib/glass/` (novo), estilos globais.
**Contrato:** vibrancy nativa quando disponível; `backdrop-filter` + fallback sólido quando não.
**Dependências:** T-001.
**Pronto quando:** um componente de exemplo renderiza com vidro; opacidade ajustável responde aos comandos de T-304.

### T-401 · App bar (Barra de Ações)
**Objetivo:** A barra flutuante: grip de arrastar, home, indicador de status, botão stealth (bola laranja), "Iniciar Configuração" (RF-010).
**Toca:** `apps/ui/src/surfaces/appbar/`.
**Contrato:** botão stealth chama o comando `set_stealth`; home abre a superfície Home.
**Dependências:** T-400, T-304 (stealth).
**Pronto quando:** a barra opera os controles; stealth alterna visivelmente.

### T-402 · Home
**Objetivo:** Tela principal: busca de sessões, cards de assistente atual e memória, ações de conversa (Analisar/Capturar/Perguntar com atalhos), sessões recentes (RF-011/333). O uso completo é o default — sem free tier/trial.
**Toca:** `apps/ui/src/surfaces/home/`.
**Contrato:** ações disparam os comandos/atalhos corretos; lista de sessões vem do sidecar via core.
**Dependências:** T-400, T-100 (sessões), T-101 (assistentes).
**Pronto quando:** a home lista sessões reais e dispara as três ações de conversa.

### T-403 · Overlay / Modal de sessão + card de insight
**Objetivo:** A superfície de uso em tempo real com o card canônico (contexto / ELES DISSERAM / DIGA ISSO), streaming de tokens, e reposicionamento por atalho (RF-012/331).
**Toca:** `apps/ui/src/surfaces/overlay/`.
**Contrato:** consome os eventos Tauri de streaming (T-303); layout do card conforme RF-331.
**Dependências:** T-400, T-303.
**Pronto quando:** os tokens aparecem ao vivo no card; reposicionamento funciona.

### T-404 · Notch + histórico de insights
**Objetivo:** A superfície compacta com sugestões em tempo real e navegação anterior/próximo (RF-013/334), janela Tauri secundária com material nativo por plataforma.
**Toca:** `apps/ui/src/surfaces/notch/`, config de janela no core.
**Dependências:** T-400, T-303, T-304.
**Pronto quando:** o Notch mostra o insight atual e navega o histórico via atalhos.

### T-405 · Onboarding (5 passos)
**Objetivo:** O fluxo ordenado: permissões, áudio, transcrição, análise, comunidade [opcional, terminal] (RF-101), reabrível (RF-102). O uso completo é o default — sem passo de trial.
**Toca:** `apps/ui/src/surfaces/onboarding/`.
**Contrato:** cada passo reflete o estado real (permissões concedidas, dispositivos, provider configurado).
**Dependências:** T-400, T-301, T-304, T-306.
**Pronto quando:** completar o fluxo deixa o app pronto para uma sessão; reabrir funciona.

### T-406 · Configurações (todas as abas)
**Objetivo:** As abas Fontes de IA, Modelos (Transcrição/Análise/Tradução), Áudio e Tela, Permissões, Recursos, Atalhos, Ajuda (SRS seções 3–4).
**Toca:** `apps/ui/src/surfaces/settings/`.
**Contrato:** BYOK (RF-400) com os quatro modos de conexão; Tradução sem paywall; atalhos editáveis com as regras de T-305; logs em Ajuda.
**Dependências:** T-400, T-2xx (validação de credencial), T-003, T-305.
**Pronto quando:** adicionar/validar uma credencial funciona ponta a ponta; atribuir provider por função persiste; atalhos editáveis.

### T-407 · Biblioteca de assistentes + Novo assistente
**Objetivo:** A tela de trocar assistente (busca, categorias, paginação) e o criador (textarea de prompt) — RF-336/338.
**Toca:** `apps/ui/src/surfaces/assistants/`.
**Dependências:** T-400, T-101.
**Pronto quando:** trocar assistente muda o ativo; criar um novo o disponibiliza na sessão seguinte (CA-7).

---

### T-408 · Renderizador Markdown (streaming, read-only) + editor WYSIWYG (Milkdown)
**Objetivo:** Duas peças distintas para Markdown na UI: (a) um renderizador leve read-only com syntax highlight para exibir respostas do agente em streaming (card "DIGA ISSO", Notch, resumos); (b) um editor WYSIWYG baseado em **Milkdown** (ProseMirror + remark) para editar a resposta pronta e para os campos de input Markdown futuros.
**Toca:** `apps/ui/src/lib/markdown/` (renderer read-only), `apps/ui/src/lib/editor/` (Milkdown).
**Contrato:**
- Entrada e saída do editor são **Markdown** (sem round-trip para HTML) — o modelo interno do Milkdown já é Markdown, preservar isso.
- Blocos de código com highlight (plugin Prism/CommonMark+GFM do Milkdown; highlight equivalente no renderer read-only).
- Headless: estilizar com os tokens do design system Liquid Glass (T-400), sem CSS embutido conflitante.
- O renderer de streaming é read-only e leve; NÃO usar o editor completo para exibir tokens ao vivo (peso desnecessário e re-render a cada token).
**Dependências:** T-400 (tokens de vidro); consumido por T-403 (overlay), T-404 (Notch), T-407 (edição de prompt de assistente).
**Nota de implementação (Svelte 5):** o Milkdown é framework-agnóstico; em Svelte 5 provavelmente será integrado via API core (`Editor.make()` apontando para um nó do DOM) e não um componente Svelte turnkey. Não presumir um wrapper `<Milkdown>` pronto. Alternativa aceitável se um wrapper Svelte 5 nativo for preferido: Tipex (TipTap), ao custo de conversão HTML↔Markdown.
**Pronto quando:** uma resposta do agente em Markdown com um bloco de código renderiza com highlight em streaming (read-only); ao "editar", abre no Milkdown e salva de volta como Markdown fiel (o bloco de código sobrevive ao round-trip sem corrupção); `tsc --noEmit` e build da UI passam.


### T-500 · Ray Audio Driver (macOS) + fluxo de instalação privilegiado
**Objetivo:** O dispositivo de áudio virtual do macOS e seu instalador privilegiado, versionado à parte (ADR-004/009, RID-5).
**Dependências:** T-306.
**Pronto quando:** instalado, aparece como fonte de "Áudio Recebido" só dentro do app; captura o áudio da reunião.
**Status (2026-09-06): ARQUIVADO (ADR-012).** O plugin carrega no coreaudiod do macOS 26, mas o device nunca é enumerado (protocolo não documentado). O canal OUTROS usa BlackHole (`brew install --cask blackhole-2ch`) — histórico em `docs/HANDOFF-driver-macos26.md`.

### T-501 · Empacotamento por plataforma + modelo Whisper embarcado
**Objetivo:** Builds AppImage/.deb (Linux), .dmg (macOS), .msi (Windows), canais stable/unstable; embarcar Whisper nos builds Win/Linux (ADR-009, RID-3/6).
**Dependências:** T-001, T-307.
**Pronto quando:** cada instalador gera app funcional; tamanho do instalador documentado.

### T-502 · Auto-update assinado
**Objetivo:** Auto-update do app (RID-4); driver com ciclo à parte.
**Dependências:** T-501.
**Pronto quando:** o app detecta e aplica atualização assinada.

### T-503 · Logs e diagnóstico (aba Ajuda)
**Objetivo:** Logging local só de erros em produção, abrir pasta e copiar logs (RF-1004).
**Dependências:** T-001.
**Pronto quando:** erros são registrados; conteúdo de reunião nunca é logado; exportação funciona.

---

## Grafo de dependências (resumo)

- **Fundação:** T-000, T-001, T-002, T-003 → destravam tudo.
- **Sidecar dados/agente:** T-100, T-101 → T-102 → T-103.
- **Providers:** T-200..T-205 (paralelas) → T-206, T-207.
- **Core:** T-300, T-301 → T-302 → T-303; T-304, T-305, T-306 → T-307.
- **UI:** T-400 → T-401..T-408; T-408 (markdown/editor) alimenta T-403, T-404, T-407.
- **Integração:** T-500, T-501 → T-502; T-503.

**Caminho crítico para um MVP demonstrável** (transcrição ao vivo + uma sugestão com um provider): T-001 → T-002 → T-306 → T-307 → T-300 → T-301 → T-302 → T-200 → T-102 → T-303 → T-400 → T-403.
