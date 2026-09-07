# HANDOFF — Ray Audio Driver no macOS 26 (T-500)

**Data:** 2026-09-06 · **Branch:** `feat/premium-ui` · **Status:** plugin CARREGA no coreaudiod; registro do dispositivo AINDA NÃO COMPLETO (última hipótese testada e descartada: ControlList vazio)

> **DESPESCLA (2026-09-06, fim do dia):** o T-500 foi **arquivado em favor do
> BlackHole** — decisão registrada na **ADR-012** (`docs/docs/ADR-Ray.md`).
> O app instrui `brew install --cask blackhole-2ch` e detecta o dispositivo
> pelo nome; os hints apontam para o brew, não mais para `install.sh`.
> O `RAY_TRACE` foi removido do `plugin.c` e o bundle/SHA256SUMS regerados.
> Coreaudiod: se o driver instalado em `/Library/Audio/Plug-Ins/HAL/` incomodar
> (ele é carregado a cada boot, sem efeito visível), rode
> `driver/installer/uninstall.sh`. **Este documento permanece como histórico
> de diagnóstico** para quem um dia retomar o driver ou implementar Process
> Taps (o estado final da conversa HAL está na seção 3: HAL pergunta `'siso'`
> — seletor privado — e `'ring'` = `kAudioDevicePropertyZeroTimeStampPeriod`
> após o `'ctrl'` vazio, e o log do coreaudiod mostra `'nope'`
> = `kAudioHardwareUnsupportedOperationError` na camada remota).

Este documento é o handoff completo da tarefa "instalar o Ray Audio Driver no macOS 26.3 (Tahoe, arm64)". Tudo abaixo foi verificado empiricamente nesta máquina (`Mac-mini-de-Lucas`, macOS 26.3.1, Build 25D2128). Nenhum commit foi feito ainda — **tudo está no working tree**.

---

## 1. Tarefa original

Usuário executou `driver/installer/install.sh` e recebeu:

```
Instalacao falhou: senha de administrador negada ou operacao cancelada
```

Não era problema de senha. Era 1 bug no instalador + 5 bugs no plugin HAL, todos encontrados e corrigidos em sequência.

## 2. O que foi feito (em ordem, com causa → fix)

### 2.1 Instalador quebrado por quoting AppleScript — CORRIGIDO
- **Causa:** `install.sh:96-100` montava `do shell script "mkdir -p "/Library/..." ..."` — aspas duplas internas terminavam a string AppleScript antes da hora → syntax error `-2740` → osascript falhava **antes de pedir senha**, e `2>&1 >/dev/null` escondia o erro real. Reproduzível com: `osascript -e 'do shell script "mkdir -p "/tmp/x" && true"'`.
- **Fix (arquivos `driver/installer/install.sh` e `uninstall.sh`):** caminhos com aspas SIMPLES via helper `sh_quote()` (seguras dentro da string AppleScript) + captura do stderr real do osascript; cancelamento do usuário (`User canceled`/`-128`) discriminado de outros erros.
- **Verificado:** instalação real executada com sucesso múltiplas vezes (bundle em `/Library/Audio/Plug-Ins/HAL/RayAudioDriver.driver`, root:wheel).

### 2.2 Plugin não carregava: três bugs de contrato CFPlugIn — CORRIGIDOS
O coreaudiod do macOS 26 carrega AudioServerPlugIns via `HALS_RemotePlugInRegistrar` + helper XPC (`com.apple.audio.Core-Audio-Driver-Service.helper`). Diagnóstico por log (comandos na seção 5). Em sequência de descoberta:

1. **Sem registro CFPlugIn no Info.plist** — log: `Attempting to load: RayAudioDriver.driver` → 13ms → `unable to load plug-in`. Drivers funcionais da máquina (Steam=BlackHole fork, Parrot=Apple) declaram `CFPlugInFactories`/`CFPlugInTypes`.
   - **Fix:** `driver/ray-audio-driver/Info.plist` agora declara fábrica `RayAudioDriverFactory` (UUID `9C2A17B4-6E58-4F41-B2D7-0A93E5C84F01`) para o tipo `443ABAB8-E7B3-491A-B985-BEB9187030DB` (= `kAudioServerPlugInTypeUUID`, confirmado no header do SDK). Export adicionado em `plugin.c`.
2. **Fábrica devolvia a tabela de interface em vez do handle** — crash do helper (`get_asp_interface`, SIGSEGV em 0x8; crash report `Core-Audio-Driver-Service.helper-*.ips`). `AudioServerPlugInDriverRef` é `AudioServerPlugInDriverInterface**` — o retorno da fábrica precisa ter a tabela no **primeiro campo**.
   - **Fix:** `static struct RayAudioDriverInstance { AudioServerPlugInDriverInterface *interface; } gDriverInstance = { &gDriverInterface };` — fábricas e `QueryInterface` devolvem `&gDriverInstance`. (Definição tardia, após a tabela, para compilar.)
3. **`CFEqual(requestedTypeUUID, ...)` sem guard de NULL** em `AudioServerPlugInMain` (crash silencioso no pedido padrão). Guard `requestedTypeUUID == NULL ||` adicionado (padrão BlackHole).

**Resultado:** log passou a mostrar `Creating remote driver service: RayAudioDriver.driver, pid N` **sem erro** — plugin carrega.

### 2.3 Dispositivo não era enumerado: protocolo de propriedades incompleto — QUASE CORRIGIDO
Método que destravou o diagnóstico: **instrumentação do plugin com trace em arquivo** (`RAY_TRACE` escrevendo em `/tmp/raydriver-trace.log` — AINDA PRESENTE NO CÓDIGO, remover) + harnesses in-process (seção 5). O trace mostrou a conversa exata do HAL e onde ela parava:

1. **Faltava `kAudioObjectPropertyOwnedObjects` no nível plugin** (é como o HAL descobre os devices; `DeviceList` sozinho não basta) → adicionado (devolve o `kRayDeviceObjectID`).
2. **Faltava `kAudioStreamPropertyAvailablePhysicalFormats` (`'pfta'`)** — o HAL do macOS 26 pergunta os formatos disponíveis do stream; sem resposta (`'who?'` = 2003332927 = `kAudioHardwareUnknownPropertyError`) ele **abortava a enumeração ali mesmo** (depois de `stm#` in/out, antes até de pedir o nome do device).
   - **Fix:** casos `sfma`/`pfta` nos handlers do stream (Data+Size) devolvendo UM `AudioStreamRangedDescription` = `kInputFormat` com taxa fixa `kRaySampleRate` (48kHz). Tamanho do struct: 56 bytes.
   - Verificado no trace: `pfta → size=56 status=0` e a conversa seguiu em frente (chegou até `rsrc`, fim típico).
3. **Faltava `kAudioObjectPropertyControlList` (`'ctrl'`) no device** — log do coreaudiod: `HALS_UCRemotePlugIn::ObjectGetPropertyDataSize: failed … Error: 2003332927` → **`Caught exception trying to add device` (HALS_PlugIn.cpp:1441)** — o HAL decidia adicionar o device, perguntava a lista de controles, recebia `'who?'` e desistia.
   - **Fix APLICADO E VERIFICADO — NÃO RESOLVEU SOZINHO:** casos `ctrl` e `cust` (ControlList / CustomPropertyInfoList) devolvendo **lista vazia** (`*outDataSize = 0`, `kAudioHardwareNoError`) no device; `cust` vazio também no stream; `cust`/`box#`/`clk#` vazios no plugin. Instalado e testado em 23:2x: `system_profiler` segue sem listar o device e o `RayAudioProbe` não o encontra. **Ou seja: a exceção do add-device tem outra causa além do 'ctrl' vazio** (ou o HAL exige controles REAIS, não lista vazia).

### 2.4 Contexto do repo nesta branch (já commitado antes desta tarefa)
- `core/src/audio.rs` já **prioriza o driver Ray** no canal OUTROS ("ray audio" antes de "blackhole") e computa RMS real dos medidores.
- Dica do app ao faltar driver menciona `driver/installer/install.sh`.
- DMG do app já gerado (`core/target/aarch64-apple-darwin/release/bundle/dmg/ray_0.0.0_aarch64.dmg`).

## 3. Estado atual — o que falta

**Situação verificada:** o plugin carrega (serviço criado, sem crash), a conversa de propriedades corre até o fim (`rsrc`), mas o **dispositivo não é adicionado** ao sistema. O `ControlList` vazio não bastou.

O próximo agente deve começar pelo loop de iteração já estabelecido (leva minutos por rodada):

1. Registrar a posição atual do trace: `wc -l < /tmp/raydriver-trace.log` → `N`.
2. Reinstalar (para reiniciar o coreaudiod): `cd driver/installer && ./install.sh` (diálogo de senha na tela) + `sleep 4`.
3. `tail -n +$((N+1)) /tmp/raydriver-trace.log` — ver a conversa nova e onde para agora.
4. `/usr/bin/log show --last 2m --predicate 'process == "coreaudiod"' --style compact | grep -B2 -A8 "RayAudio\|Caught exception\|failed"` — o motivo do add-device falhar aparece aqui (seletores são `<private>`, mas o momento casa com o trace).
5. Mapear o seletor fourcc do trace (`sel='xxxx'`) no SDK:
   `grep -rn "'xxxx'" /Library/Developer/CommandLineTools/SDKs/MacOSX26.4.sdk/System/Library/Frameworks/CoreAudio.framework/Headers/`
   e implementar o handler conforme o tipo documentado no comentário do header.

**Hipóteses priorizadas (em ordem):**
1. **Controles REAIS exigidos** em device de input no macOS 26 — se o log seguir apontando a exceção no add-device depois de 'ctrl' vazio, implementar um controle de volume/mute simples (modelo: `AudioServerPlugInControlInterface` do header `AudioServerPlugIn.h`; referência binária funcional = Steam/BlackHole em `/Library/Audio/Plug-Ins/HAL/SteamStreamingSpeakers.driver`, exporta só `_BlackHole_Create`; e o plist completo dele). O OwnedObjects do device teria que listar device+stream+control(s).
2. **`Initialize` ignorando `inHost`** — guardá-lo (`static AudioServerPlugInHostRef gHost`), padrão de toda implementação de referência; o host é passado não-nulo (trace: `host=0x…`). Algum caminho do HAL pode depender de o plugin ter registrado interesse via host (ex.: `PropertiesChanged` no boot).
3. **`kAudioDevicePropertyDeviceIsHidden`** — responder 0 explícito.
4. **'nam ' nunca foi consultado no device** — o HAL não chega a pedir o nome; isso confirma que a rejeição acontece ANTES da finalização. Qualquer seletor que falhe entre 'uid ' e o fim é candidato — o trace é a fonte da verdade.

Quando o device aparecer:
1. **REMOVER o trace temporário** do `plugin.c`: apagar a função `RAY_TRACE` e todas as ~10 chamadas (`grep -n RAY_TRACE driver/ray-audio-driver/Sources/RayAudioDriver/plugin.c`; bloco marcado com comentário `TRACE TEMPORARIO`).
2. Rebuild (`swift build --package-path driver/ray-audio-driver -c release` + `driver/scripts/assemble-bundle.sh`) e reinstalar.
3. `driver/scripts/verify-driver.sh` (estrutural) e `--e2e` se possível (exige senha interativa — plano do T-500).
4. Teste de ponta a ponta (CA-5): `afplay` + tap do driver + `RayAudioProbe --capture` (fluxo do verify e2e).
5. **Commitar tudo** (nada commitado): `driver/installer/{install,uninstall}.sh`, `driver/installer/{SHA256SUMS,RayAudioDriver.driver/}`, `driver/ray-audio-driver/{Info.plist,Sources/RayAudioDriver/plugin.c,build/}`, `docs/HANDOFF-driver-macos26.md` (ou removê-lo após concluir).

## 4. Fixtures de referência nesta máquina

- `/Library/Audio/Plug-Ins/HAL/SteamStreamingSpeakers.driver` — BlackHole 0.2.10 (Valve), funcional, **melhor referência binária** (fábrica `BlackHole_Create`; plist completo em `Contents/Info.plist`).
- `/Library/Audio/Plug-Ins/HAL/ParrotAudioPlugin.driver` — plugin DA APPLE para macOS 26.3 (referência de plist moderno; tem `AudioServerPlugIn_LoadingConditions`, NÃO tem `AudioServerPlugIn_Network`).
- Crash reports do helper: `/Library/Logs/DiagnosticReports/com.apple.audio.Core-Audio-Driver-Service.helper-*.ips` (os dois últimos são das fases 2.2/2.3 — históricos).
- Harnesses criados em `/tmp/ray-plugintest/` (`main.c` CFPlugIn, `proto.c` protocolo HAL completo, `battery.c` bateria de propriedades — cuidado: `Initialize` do BlackHole crasha com host NULL, o harness precisa de guard). Não fazem parte do repo.

## 5. Comandos de diagnóstico usados (reproduzir se precisar)

```bash
# Log do coreaudiod durante a carga (o mais útil)
/usr/bin/log show --last 2m --predicate 'subsystem == "com.apple.coreaudio" AND eventMessage CONTAINS[c] "RayAudio"' --style compact

# Erros de add-device / propriedades
/usr/bin/log show --last 4m --predicate 'process == "coreaudiod"' --style compact | grep -B2 -A8 "RayAudio\|Caught exception"

# Trace do plugin (com a instrumentação ainda presente)
tail -n +N /tmp/raydriver-trace.log

# Reiniciar o coreaudiod sem reinstalar (se volumes de DMG ficarem presos: hdiutil detach -force)
killall coreaudiod

# Enumeração
system_profiler SPAudioDataType -json | python3 -c "…"   # (lista _name de _items)
driver/ray-audio-driver/build/RayAudioProbe
```

## 6. Limitações conhecidas do driver (v0.1, pós-registro)

- O tap lê o dispositivo de saída **padrão** no momento em que a captura inicia (trocar saída exige reiniciar captura) — `driver/README.md`.
- O usuário precisa rotear o áudio da reunião para um **Multi-Output Device** que inclua o driver (o driver é capture-only, RF-204 — nunca é saída). O hint do app (`core/src/lib.rs`, `ray:analysis-hint`) já instrui isso.
- O binário é adhoc-signed (linker). Carregou sem reclamação nesta máquina; se distribuição externa reclamar, ver `core/scripts/sign-release.sh` (ADR-009).

## 7. Mapa dos diffs não commitados

| Arquivo | Mudança |
|---|---|
| `driver/installer/install.sh` | quoting AppleScript + erros reais |
| `driver/installer/uninstall.sh` | idem |
| `driver/installer/SHA256SUMS` + `RayAudioDriver.driver/` | payload reconstruído |
| `driver/ray-audio-driver/Info.plist` | CFPlugInFactories/Types |
| `driver/ray-audio-driver/Sources/RayAudioDriver/plugin.c` | guard NULL, fábrica, gDriverInstance, OwnedObjects plugin, sfma/pfta, listas vazias cust/box#/clk#/ctrl, **RAY_TRACE (temporário — remover)** |
| `driver/ray-audio-driver/build/*` | artefatos de build |
