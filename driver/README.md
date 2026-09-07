# Ray Audio Driver (macOS)

> **ARQUIVADO (2026-09-06, ADR-012):** o canal OUTROS usa o BlackHole
> (`brew install --cask blackhole-2ch`). Este driver não é mais instalado pelo
> app. Estado do código: o plugin carrega no coreaudiod do macOS 26, mas o
> dispositivo não é enumerado — histórico completo em
> `docs/HANDOFF-driver-macos26.md`.

Dispositivo virtual de áudio do Ray para macOS: um plugin CoreAudio/HAL
(bundle `.driver`) que aparece no sistema como **"Ray Audio Driver"** e
alimenta a fonte **Áudio Recebido** (canal OUTROS, ADR-004/RF-203) dentro do
app.

## Configuração correta: captura, nunca saída

O dispositivo é **captura-only** (RF-204). Ele:

- registra somente streams de **entrada** (captura) — `RayAudioDriverCaptureOnly=true`
  no Info.plist;
- **nunca** aparece como dispositivo de saída, e **não deve** ser usado como
  tal por nenhum aplicativo;
- entrega o áudio do sistema (CA-5) por um tap criado dentro do processo que
  hospeda o plugin, lendo o dispositivo de saída padrão e espelhando o sinal
  no stream de captura.

## Estrutura

```
driver/
├── VERSION                        # versão do driver (semver, independente do app — ADR-009)
├── ray-audio-driver/
│   ├── Package.swift              # SwiftPM: biblioteca dinâmica (plugin) + probe
│   ├── Info.plist                 # declaração do bundle (identidade, captura-only)
│   └── Sources/
│       ├── RayAudioDriver/        # plugin AudioServerPlugIn (C)
│       └── RayAudioProbe/         # probe de diagnóstico (C)
├── installer/
│   ├── install.sh                 # instalação privilegiada (senha de administrador)
│   ├── uninstall.sh               # desinstalação privilegiada
│   ├── package.sh                 # regenera o manifesto SHA256SUMS do payload
│   ├── SHA256SUMS                 # checksums do payload (verificados antes de qualquer
│   │                              #   operação privilegiada — SCOPE.md)
│   └── RayAudioDriver.driver      # payload embalado (cópia do build)
└── scripts/
    ├── assemble-bundle.sh         # compila e monta o bundle + payload + manifesto
    └── verify-driver.sh           # gate de CI do driver
```

## Build

```bash
# compila plugin e probe (SwiftPM, funciona com CommandLineTools)
swift build --package-path driver/ray-audio-driver -c release

# monta o bundle .driver, atualiza o payload do instalador e o SHA256SUMS
driver/scripts/assemble-bundle.sh
```

Os produtos ficam em `driver/ray-audio-driver/build/` (bundle
`RayAudioDriver.driver` + executável `RayAudioProbe`).

## Instalação (privilegiada)

A instalação exige **senha de administrador** (RF-203/RID-5), pedida pelo
diálogo nativo do macOS:

```bash
driver/installer/install.sh      # copia para /Library/Audio/Plug-Ins/HAL/ e reinicia o coreaudiod
driver/installer/uninstall.sh    # remove e reinicia o coreaudiod
```

Antes de qualquer operação privilegiada, `install.sh` verifica o payload
arquivo a arquivo contra `installer/SHA256SUMS` e recusa payloads corrompidos
ou adulterados (superfície de ataque mínima — SCOPE.md).

Modo de teste (sem privilégio): `install.sh --test-mode <dir>` estagia o
bundle em `<dir>/RayAudioDriver.driver` e escreve
`<dir>/ray-audio-driver-receipt.json`; `uninstall.sh --test-mode <dir>`
remove ambos.

## Validação

O gate de CI é `driver/scripts/verify-driver.sh`:

```bash
driver/scripts/verify-driver.sh          # estrutural + build + instalador em modo de teste
driver/scripts/verify-driver.sh --e2e    # + instalação privilegiada real, system_profiler,
                                         #   fluxo de áudio (afplay -> probe --capture)
```

O modo `--e2e` exige senha de administrador interativa e por isso não roda
desassistido.

## Versionamento (ADR-009)

`driver/VERSION` segue semver e é a versão do driver — independente da versão
do app. O mesmo valor é replicado em `Info.plist`
(`RayAudioDriverVersion`); o app não lê nem empacota o driver (nenhum código
fora de `driver/` referencia `driver/VERSION`, e `tauri.conf.json` não
referencia o bundle).

## Limitações conhecidas (v0.1)

- O tap lê o dispositivo de saída **padrão** no momento em que a captura
  inicia; trocar o dispositivo de saída exige reiniciar a captura.
- O comportamento de instalação/desinstalação privilegiada só é exercitado
  pelo `verify-driver.sh --e2e`, que exige interação humana (senha).
