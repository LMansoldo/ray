# surfaces/settings — configurações (T-406)

`Settings.svelte` sem props. Sete abas, cada uma num `{#if activeTab === ...}`.
Estado entra via `readSettingsState()` (settings-feed.ts) uma vez no `const`
de nível superior e é refinado pela hidratação do core
(`loadSettingsState()` — nunca rejeita; cada falha individual cai na base).

## Abas

| id | Título | RF |
|---|---|---|
| `aiSources` | Fontes de IA | RF-401/402/403/406 |
| `models` | Modelos | RF-301/302/303/404 |
| `audioScreen` | Áudio e Tela | RF-206 |
| `permissions` | Permissões | RF-103/104/335 |
| `features` | Recursos | RF-700 |
| `shortcuts` | Atalhos | RF-601/602/604 |
| `help` | Ajuda | RF-1001..1004 |

## Credenciais (ADR-003)

`keyValues` vive **apenas em memória**. O segredo sai da UI uma única vez, dentro
do payload `credentialSave` despachado para o canal `settings-actions.ts`. Nunca
logar, nunca persistir, nunca reutilizar fora do clique de "Salvar".

Cards com status != `notConfigured` têm botão "Excluir"
(`data-provider-delete`): invoca `delete_credential`, limpa o campo de chave e
emite `ray:credentials-changed` `{slot, valid: undefined}` para os status
recarregarem.

## Atalhos

- Gravação global: ao clicar "Change", um `keydown` listener é adicionado à
  `window` e removido ao cancelar/confirmar.
- `validateShortcutChange` impede combos sem modificador e combos duplicados.
- `formatCombo(binding)` formata para exibição (ex.: `Cmd+Shift+A`).
- Commit válido, toggle de ativação e "Redefinir Todos para Padrões" chamam
  `invoke('apply_shortcuts', { bindings })` (registro no SO + persistência);
  erros retornados pelo núcleo viram feedback na linha alterada.

## Preferências locais (Web Storage, chaves allowlistadas)

| Chave | Conteúdo | Origem |
|---|---|---|
| `ray_audio_meters` | `'1'`/`'0'` (ausente = visível) | Áudio e Tela |
| `ray_models` | JSON `{TRANSCRIPTION, ANALYSIS, TRANSLATION}` (`null` = sem provedor) | Modelos |

Mudanças emitem eventos Tauri consumidos fora da superfície (ela não escuta os
próprios eventos): `ray:meters-changed` `{visible}`, `ray:models-changed`
(mapa por função), `ray:features-changed` (toggles completos).

## Comandos Tauri invocados

| Ação | Comando | Arquivo core |
|---|---|---|
| Hidratar provedores | `get_provider_statuses` | `core/src/lib.rs` |
| Hidratar permissões | `get_permission_status` | `core/src/permissions.rs` |
| Hidratar atalhos | `get_shortcuts` | `core/src/lib.rs` |
| Hidratar features | `get_app_settings` | `core/src/lib.rs` |
| Aplicar atalhos | `apply_shortcuts` | `core/src/lib.rs` |
| Persistir features | `save_feature_toggles` | `core/src/lib.rs` |
| Excluir credencial | `delete_credential` | `core/src/lib.rs` |
| Conceder permissões | `request_all_permissions` | `core/src/permissions.rs` |
| Abrir pasta de logs | `open_logs_folder` | `core/src/lib.rs` |
| Copiar logs | `copy_logs_to_clipboard` | `core/src/lib.rs` |
| Versão do app | `getVersion()` | `@tauri-apps/api/app` |

Reiniciar Integração usa `dispatchOnboardingRestart()` (canal local, não invoke).

## Arquivos auxiliares

| Arquivo | O que faz |
|---|---|
| `settings-feed.ts` | Lê estado inicial + hidrata do core (`loadSettingsState`, nunca rejeita) |
| `settings-actions.ts` | Canal pub/sub de ações de settings |
| `shortcut-validation.ts` | `validateShortcutChange`, `formatCombo` |
| `types.ts` | `SettingsState`, `SettingsTabId`, `ProviderSlotId`, etc. |
