# Ray

Copiloto de reuniões ao vivo para desktop. O Ray escuta a reunião (microfone +
áudio do sistema), transcreve localmente e sugere respostas acionáveis em um
overlay sempre-no-topo — com busca web (DuckDuckGo) para o copiloto checar
fatos, biblioteca de assistentes customizáveis, atalhos globais, modo stealth
(invisível à captura de tela) e BYOK (sua própria chave de API: OpenAI,
Anthropic, Gemini, DeepSeek, OpenRouter ou endpoint compatível).

## Arquitetura

| Camada     | Stack                                  | Responsabilidade                                                          |
| ---------- | -------------------------------------- | ------------------------------------------------------------------------- |
| `apps/ui`  | Svelte 5 + Vite                        | AppBar, Home, Assistentes, Configurações, Overlay (janelas Tauri)          |
| `core`     | Rust + Tauri 2                         | Áudio (cpal), STT local, janelas, atalhos globais, vault, proxy loopback   |
| `sidecar`  | Node/TypeScript + Prisma (SQLite)      | Agentes/LLM, busca web, sessões, credenciais, resumos                      |
| `contracts`| TypeScript (gerado via ts-rs + manual) | Contratos de IPC e settings compartilhados entre core/sidecar/UI           |

O core nunca fala com a internet: é o sidecar (spawnado como binário externo)
que consome os provedores de LLM e o DuckDuckGo — o core apenas faz proxy
loopback `127.0.0.1` entre a UI e o sidecar (ADR-005).

## Requisitos gerais (todos os sistemas)

- **Rust** stable via [rustup](https://rustup.rs)
- **Node.js ≥ 18.18** (LTS 20+ recomendado) e npm
- **Tauri CLI**: `cargo install tauri-cli --locked`
- Git

```bash
git clone https://github.com/LMansoldo/ray.git
cd ray
npm install                      # Prisma CLI (raiz)
npm --prefix apps/ui install     # dependências da UI
npx prisma generate              # cliente Prisma (schema em prisma/)
```

---

## macOS (suporte completo)

### Dependências

```bash
xcode-select --install
```

- Rust com target `aarch64-apple-darwin` (Apple Silicon) — via rustup
- Node.js (via [nvm](https://github.com/nvm-sh/nvm) ou `brew install node`)
- Tauri CLI (ver requisitos gerais)

### Rodar em desenvolvimento

O macOS exige bundle assinado para as permissões de TCC (microfone, fala e
tela) — binário desempacotado leva `ABORT` do TCC. Por isso o dev usa o
script que monta um `.app` mínimo e lança via `open`:

```bash
sh core/scripts/build-sidecar.sh   # compila o sidecar (tsc + resources)
sh core/scripts/dev-app.sh         # cargo build + bundle dev + abre o app
```

Logs: `/tmp/ray-core-dev.log` e `/tmp/ray-vite-dev.log`. Na primeira execução,
conceda as permissões em **Ajustes → Privacidade e Segurança** (Microfone,
Reconhecimento de Fala, Gravação de Tela). A transcrição local usa **Apple
Speech on-device** (baixe o modelo de ditado em pt-BR em Ajustes → Teclado →
Ditado para reconhecimento offline em português).

### Gerar o DMG

```bash
sh core/scripts/build-dmg.sh       # sidecar + cargo tauri build --bundles dmg
```

Artefato: `core/target/release/bundle/dmg/ray_<versão>_aarch64.dmg`
(assinatura ad-hoc — roda na sua máquina; para distribuir, use notarização
via `core/scripts/release.sh`).

---

## Linux (suporte parcial)

### Dependências (Ubuntu/Debian)

```bash
sudo apt update
sudo apt install -y \
  libwebkit2gtk-4.1-dev \
  build-essential \
  curl \
  wget \
  file \
  libxdo-dev \
  libssl-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  libasound2-dev
```

- `libwebkit2gtk-4.1-dev` — WebView do Tauri
- `libayatana-appindicator3-dev` — ícone de tray (o Ray vive na bandeja)
- `libasound2-dev` — captura de áudio (cpal/ALSA); o desktop precisa de
  **PipeWire ou PulseAudio** rodando (padrão nas distros atuais)
- `libxdo-dev` — automação de input usada pelos atalhos

### Rodar em desenvolvimento

```bash
sh core/scripts/build-sidecar.sh
cd core && cargo tauri dev
```

### Gerar pacotes

```bash
cd core && cargo tauri build --bundles appimage,deb
```

### Limitações conhecidas no Linux

- **Transcrição local (STT) ainda não funciona**: os recursos do
  whisper.cpp já são empacotados (`resources/whisper/`), mas o motor está
  implementado apenas como placeholder — os segmentos saem como
  `[segmento N]`. A camada de análise/overlay funciona; a captação de fala
  depende de concluir a integração do whisper.
- Captura do áudio do sistema usa o **monitor do PulseAudio/PipeWire**
  (ADR-004), sem driver dedicado.

---

## Windows (experimental)

### Dependências

1. **Rust** com toolchain `stable-x86_64-pc-windows-msvc` (rustup instala o
   prerequisite automaticamente) — ou instale manualmente o
   [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-studio-build-tools/)
   com a workload **"Desktop development with C++"**
2. **WebView2 Runtime** — já vem no Windows 11 e no Windows 10 atualizado;
   se necessário, instale o [Evergreen Bootstrapper](https://developer.microsoft.com/microsoft-edge/webview2/)
3. **Node.js ≥ 18.18**
4. **Git for Windows** — os scripts do repositório são POSIX (`sh`); rode-os
   pelo **Git Bash**
5. Tauri CLI (ver requisitos gerais)

### Rodar em desenvolvimento

```powershell
# No Git Bash:
sh core/scripts/build-sidecar.sh
cd core && cargo tauri dev
```

Para gerar o instalador: `cd core && cargo tauri build --bundles msi`
(o WiX é baixado automaticamente pelo Tauri no primeiro bundle).

### Limitações conhecidas no Windows

- **O sidecar não sobe em builds nativos ainda**: o launcher
  (`ray-sidecar-<triple>`) é um script POSIX `#!/bin/sh` e o `CreateProcess`
  do Windows não executa shebangs — um launcher `.exe` nativo está no plano
  (o binário autocontido via `pkg` também segue como TODO). Compilar a UI/core
  funciona; o fluxo completo depende dessa peça.
- **Transcrição local (STT) ainda não funciona** — mesmo placeholder do
  whisper.cpp descrito no Linux.

---

## Matriz de suporte

| Capacidade                       | macOS            | Linux                 | Windows               |
| -------------------------------- | ---------------- | --------------------- | --------------------- |
| Overlay, AppBar, Configurações   | ✅               | ✅                    | ⚠️ compila            |
| Transcrição local (STT)          | ✅ Apple Speech  | ❌ whisper placeholder | ❌ whisper placeholder |
| Captura de áudio (mic + sistema) | ✅               | ✅ (PipeWire/Pulse)   | ⚠️ não validado       |
| Copiloto (LLM via sidecar)       | ✅               | ✅                    | ❌ launcher POSIX     |
| Busca web (fact-check)           | ✅               | ✅                    | ❌ idem               |
| Atalhos globais                  | ✅               | ⚠️ não validado       | ⚠️ não validado       |
| Stealth (invisível à captura)    | ✅               | ❌ sem API comum      | ⚠️ não validado       |
| Bundle                           | `.dmg`           | `.appimage` / `.deb`  | `.msi`                |

## Scripts úteis

| Script                          | Função                                                        |
| ------------------------------- | ------------------------------------------------------------- |
| `core/scripts/dev-app.sh`       | Bundle dev no macOS com TCC correto e lançamento via `open`    |
| `core/scripts/build-sidecar.sh` | Compila o sidecar (tsc) + resources + launcher                 |
| `core/scripts/build-dmg.sh`     | Release macOS em `.dmg`                                        |
| `core/scripts/release.sh`       | Release assinado/notarizado (requer chaves de CI)              |
| `core/scripts/gen-ipc-contract.sh` | Regenera `contracts/ipc.ts` a partir dos structs Rust (ts-rs) |
| `core/scripts/validate-packaging.sh` | Valida o layout de empacotamento                          |

## Testes

```bash
npm --prefix apps/ui test          # UI (vitest + testing-library)
npm --prefix apps/ui run check     # svelte-check
cd sidecar && npm test             # sidecar (vitest)
cd sidecar && npm run typecheck    # tsc --noEmit
cd core && cargo test              # core (unit + integração)
```

## Licença

[MIT](LICENSE)
