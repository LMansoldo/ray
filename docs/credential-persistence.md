# Spec: Persistência de Credenciais de Ponta a Ponta (T-406 / T-302 / T-206)

> Estado em 2026-08-23. Contexto: a UI de Settings já existe e despachaa ação
> `credentialSave`, mas não há nenhum Tauri command registrado para consumi-la.
> Este documento especifica tudo que falta para fechar o fluxo.

---

## 1. Visão geral do fluxo alvo

```
UI (Settings.svelte)
  ↓ dispatchSettingsAction({ type: 'credentialSave', slot, kind, connectionMode, secret, baseUrl? })
App.svelte (onSettingsAction)
  ↓ invoke('save_credential', { slot, kind, connectionMode, secret, baseUrl })
core/src/lib.rs — save_credential()
  ├─ vault::store_secret(label, &secret) → secretRef   [ADR-003: único lugar com segredo]
  └─ POST http://127.0.0.1:{port}/credentials
       Body: SaveCredentialRequest { slot, kind, connectionMode, label, secretRef, baseUrl }
sidecar/src/handlers.ts — POST /credentials
  └─ prisma.apiKeyRef.upsert({ ... })   [persiste ApiKeyRef SEM o segredo]
       retorna: { id, secretRef }

UI (Settings.svelte) — recarrega estado
  ↓ invoke('get_provider_statuses') → ProviderStatus[]
core/src/lib.rs — get_provider_statuses()
  └─ GET http://127.0.0.1:{port}/credentials
sidecar/src/handlers.ts — GET /credentials
  └─ prisma.apiKeyRef.findMany() → ApiKeyRef[]
       retorna: GetCredentialsResponse
```

---

## 2. Pré-condições já implementadas (NÃO reimplementar)

| Artefato | Localização | Status |
|---|---|---|
| `vault::store_secret / get_secret / delete_secret` | `core/src/vault.rs` | DONE |
| `ApiKeyRef` Prisma model | `prisma/schema.prisma` | DONE |
| `ValidateCredentialRequest/Response` + `InjectedCredential` | `contracts/ipc.ts` | DONE |
| Rota `POST /providers/validate` no `IpcEndpoints` | `contracts/ipc.ts` | DONE |
| Dispatcher `dispatchSettingsAction` + tipo `credentialSave` | `apps/ui/src/surfaces/settings/settings-actions.ts` | DONE |
| `SettingsStateFeed` / `readSettingsState()` | `apps/ui/src/surfaces/settings/settings-feed.ts` | DONE (placeholder) |

---

## 3. O que está faltando

### 3.1 Structs IPC em `core/src/ipc.rs`

Adicionar (com `#[derive(TS, Serialize, Deserialize)]`):

```rust
/// Payload de POST /credentials (core → sidecar).
/// O segredo NUNCA aparece aqui — apenas o secretRef opaco (ADR-003).
#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SaveCredentialRequest {
    pub slot: String,           // ProviderSlotId da UI
    pub kind: ProviderKind,
    pub connection_mode: ProviderConnectionMode,
    pub label: String,          // nome legível: "{kind} – {slot}"
    pub secret_ref: String,     // ponteiro opaco do cofre
    pub base_url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SaveCredentialResponse {
    pub id: String,             // id do ApiKeyRef no banco
    pub secret_ref: String,
}

/// Payload de DELETE /credentials/{slot}.
#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DeleteCredentialRequest {
    pub slot: String,
}

/// Resposta de GET /credentials.
#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct GetCredentialsResponse {
    pub credentials: Vec<CredentialSummary>,
}

/// Resumo de uma credencial (sem segredo).
#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CredentialSummary {
    pub id: String,
    pub slot: String,
    pub kind: ProviderKind,
    pub connection_mode: ProviderConnectionMode,
    pub base_url: Option<String>,
    pub last_validated_at: Option<String>, // ISO-8601
}
```

**`ProviderKind` e `ProviderConnectionMode` já existem em `ipc.rs`** — não redeclarar.

Após adicionar, executar:
```bash
cd core && cargo test   # gera os arquivos TS via ts-rs
```
e copiar os tipos gerados para `contracts/ipc.ts` (blocos `BEGIN gerado por ts-rs`).

Adicionar ao `IpcEndpoints` em `contracts/ipc.ts` (bloco "mantido à mão"):
```ts
"POST /credentials":    { req: SaveCredentialRequest;    res: IpcResult<SaveCredentialResponse> };
"DELETE /credentials":  { req: DeleteCredentialRequest;  res: IpcResult<{ deleted: boolean }> };
"GET /credentials":     { req: void;                     res: IpcResult<GetCredentialsResponse> };
```

---

### 3.2 Tauri commands em `core/src/lib.rs`

Adicionar as três funções abaixo e registrá-las em `tauri::generate_handler!`.

#### `save_credential`

```rust
/// Salva uma credencial: grava o segredo no cofre nativo e persiste o ApiKeyRef
/// no sidecar (sem o segredo). ADR-003: o segredo nunca sai deste handler.
#[tauri::command]
fn save_credential(
    slot: String,
    kind: ipc::ProviderKind,
    connection_mode: ipc::ProviderConnectionMode,
    secret: String,
    base_url: Option<String>,
) -> Result<ipc::SaveCredentialResponse, String> {
    // 1. Gravar no cofre nativo.
    let label = format!("{:?}-{}", kind, slot);
    let secret_ref = vault::store_secret(&label, &secret)
        .map_err(|e| e.to_string())?;

    // 2. Montar payload para o sidecar (sem o segredo).
    let req = ipc::SaveCredentialRequest {
        slot: slot.clone(),
        kind,
        connection_mode,
        label,
        secret_ref,
        base_url,
    };

    // 3. POST /credentials no sidecar via thread dedicada (mesmo padrão do `suggest`).
    let port = SIDECAR_PORT.load(Ordering::Acquire);
    if port == 0 {
        return Err("sidecar not started".into());
    }
    let base_url_sidecar = format!("http://127.0.0.1:{}", port);

    let handle = std::thread::spawn(move || -> Result<ipc::SaveCredentialResponse, String> {
        let rt = tokio::runtime::Runtime::new().map_err(|e| e.to_string())?;
        rt.block_on(async {
            let client = reqwest::Client::new();
            let resp = client
                .post(format!("{}/credentials", base_url_sidecar))
                .json(&req)
                .send()
                .await
                .map_err(|e| e.to_string())?;
            resp.json::<ipc::IpcResult<ipc::SaveCredentialResponse>>()
                .await
                .map_err(|e| e.to_string())
                .and_then(|r| match r {
                    ipc::IpcResult::Ok { value } => Ok(value),
                    ipc::IpcResult::Err { error } => Err(error.message),
                })
        })
    });

    handle.join().map_err(|_| "thread panicked".to_string())?
}
```

> **Nota de segurança ADR-003**: o campo `secret: String` é consumido aqui,
> gravado no cofre, e o próprio `secret` nunca viaja para fora deste handler.
> O sidecar recebe apenas `secret_ref`.

#### `delete_credential`

```rust
/// Remove a credencial do cofre nativo e do banco (via sidecar).
#[tauri::command]
fn delete_credential(slot: String) -> Result<(), String> {
    let port = SIDECAR_PORT.load(Ordering::Acquire);
    if port == 0 {
        return Err("sidecar not started".into());
    }
    let base_url = format!("http://127.0.0.1:{}", port);

    let handle = std::thread::spawn(move || -> Result<(), String> {
        let rt = tokio::runtime::Runtime::new().map_err(|e| e.to_string())?;
        rt.block_on(async {
            let client = reqwest::Client::new();
            // 1. Buscar o secretRef no sidecar antes de deletar do cofre.
            let get_resp = client
                .get(format!("{}/credentials", base_url))
                .send()
                .await
                .map_err(|e| e.to_string())?;
            let creds: ipc::IpcResult<ipc::GetCredentialsResponse> =
                get_resp.json().await.map_err(|e| e.to_string())?;
            let creds = match creds {
                ipc::IpcResult::Ok { value } => value,
                ipc::IpcResult::Err { error } => return Err(error.message),
            };

            // 2. Encontrar o secretRef do slot.
            if let Some(cred) = creds.credentials.iter().find(|c| c.slot == slot) {
                // 3. Remover do cofre nativo.
                vault::delete_secret(&cred.secret_ref /* precisa ajustar: ver nota */)
                    .ok(); // ignorar se não existe no cofre

                // 4. DELETE /credentials no sidecar.
                let req = ipc::DeleteCredentialRequest { slot: slot.clone() };
                let del_resp = client
                    .delete(format!("{}/credentials", base_url))
                    .json(&req)
                    .send()
                    .await
                    .map_err(|e| e.to_string())?;
                let result: ipc::IpcResult<serde_json::Value> =
                    del_resp.json().await.map_err(|e| e.to_string())?;
                match result {
                    ipc::IpcResult::Ok { .. } => Ok(()),
                    ipc::IpcResult::Err { error } => Err(error.message),
                }
            } else {
                Ok(()) // slot não existe, nada a fazer
            }
        })
    });

    handle.join().map_err(|_| "thread panicked".to_string())?
}
```

> **Nota**: `GetCredentialsResponse` precisa incluir `secret_ref` em
> `CredentialSummary` para que o core possa deletar do cofre. Ajustar a struct
> — o campo `secret_ref` é opaco (não é o segredo), portanto sua presença aqui
> não viola ADR-003.

#### `get_provider_statuses`

```rust
/// Retorna o status de cada slot de provedor (configurado / não configurado).
/// Chamado pelo settings-feed para preencher `providerStatus`.
#[tauri::command]
fn get_provider_statuses() -> Result<ipc::GetCredentialsResponse, String> {
    let port = SIDECAR_PORT.load(Ordering::Acquire);
    if port == 0 {
        // Sidecar não subiu ainda — retornar lista vazia (estado restritivo).
        return Ok(ipc::GetCredentialsResponse { credentials: vec![] });
    }
    let base_url = format!("http://127.0.0.1:{}", port);

    let handle = std::thread::spawn(move || -> Result<ipc::GetCredentialsResponse, String> {
        let rt = tokio::runtime::Runtime::new().map_err(|e| e.to_string())?;
        rt.block_on(async {
            let client = reqwest::Client::new();
            let resp = client
                .get(format!("{}/credentials", base_url))
                .send()
                .await
                .map_err(|e| e.to_string())?;
            let result: ipc::IpcResult<ipc::GetCredentialsResponse> =
                resp.json().await.map_err(|e| e.to_string())?;
            match result {
                ipc::IpcResult::Ok { value } => Ok(value),
                ipc::IpcResult::Err { error } => Err(error.message),
            }
        })
    });

    handle.join().map_err(|_| "thread panicked".to_string())?
}
```

Registrar em `tauri::generate_handler!`:
```rust
tauri::generate_handler![
    set_stealth, toggle_window, show_window, hide_window,
    suggest, transcribe_pending_pcm,
    open_logs_folder, copy_logs_to_clipboard,
    save_credential, delete_credential, get_provider_statuses,  // NOVO
]
```

---

### 3.3 Sidecar endpoints

Arquivo: `sidecar/src/handlers.ts`

#### `POST /credentials`

```ts
import type { SaveCredentialRequest, SaveCredentialResponse } from '../../../contracts/ipc'

export async function handleSaveCredential(
  body: unknown,
  db: PrismaClient,
): Promise<IpcResult<SaveCredentialResponse>> {
  // Validar shape
  const req = parseSaveCredentialRequest(body) // type guard Zod ou manual

  const record = await db.apiKeyRef.upsert({
    where: {
      // índice único por userId + slot — ver nota abaixo
      userId_slot: { userId: SYSTEM_USER_ID, slot: req.slot },
    },
    update: {
      kind: req.kind,
      connectionMode: req.connection_mode,
      label: req.label,
      secretRef: req.secret_ref,
      baseUrl: req.base_url ?? null,
      lastValidatedAt: null,  // reset ao salvar nova chave
    },
    create: {
      userId: SYSTEM_USER_ID,
      kind: req.kind,
      connectionMode: req.connection_mode,
      label: req.label,
      secretRef: req.secret_ref,
      baseUrl: req.base_url ?? null,
      slot: req.slot,
    },
  })

  return { ok: true, value: { id: record.id, secretRef: record.secretRef } }
}
```

> **Nota sobre `userId`**: O modelo `ApiKeyRef` tem `userId` — enquanto o sistema
> de autenticação multi-usuário não existe, usar uma constante
> `SYSTEM_USER_ID = 'local'` (ou qualquer string fixa). Registrar como decisão
> técnica.

> **Nota sobre `slot`**: O modelo `ApiKeyRef` não tem coluna `slot` ainda —
> **é necessário adicionar uma migration** Prisma:
> ```prisma
> model ApiKeyRef {
>   ...
>   slot  String              // ProviderSlotId: 'openai' | 'anthropic' | ...
>   @@unique([userId, slot])  // um slot por usuário
> }
> ```
> Gerar e aplicar: `npx prisma migrate dev --name add_slot_to_api_key_ref`

#### `DELETE /credentials`

```ts
export async function handleDeleteCredential(
  body: unknown,
  db: PrismaClient,
): Promise<IpcResult<{ deleted: boolean }>> {
  const req = parseDeleteCredentialRequest(body)

  const deleted = await db.apiKeyRef.deleteMany({
    where: { userId: SYSTEM_USER_ID, slot: req.slot },
  })

  return { ok: true, value: { deleted: deleted.count > 0 } }
}
```

#### `GET /credentials`

```ts
export async function handleGetCredentials(
  db: PrismaClient,
): Promise<IpcResult<GetCredentialsResponse>> {
  const records = await db.apiKeyRef.findMany({
    where: { userId: SYSTEM_USER_ID },
  })

  return {
    ok: true,
    value: {
      credentials: records.map((r) => ({
        id: r.id,
        slot: r.slot,
        kind: r.kind,
        connection_mode: r.connectionMode,
        secret_ref: r.secretRef,         // opaco, não é o segredo
        base_url: r.baseUrl ?? undefined,
        last_validated_at: r.lastValidatedAt?.toISOString() ?? undefined,
      })),
    },
  }
}
```

Registrar as três rotas em `sidecar/src/server.ts` (adicionar ao switch/router existente):
```ts
case 'POST /credentials':   return handleSaveCredential(body, db)
case 'DELETE /credentials': return handleDeleteCredential(body, db)
case 'GET /credentials':    return handleGetCredentials(db)
```

---

### 3.4 Wiring em `App.svelte`

Em `onMount` (bloco `if (!isAppBarWindow)`), adicionar assinatura ao canal de actions:

```ts
import { onSettingsAction } from './surfaces/settings/settings-actions'
import { invoke } from '@tauri-apps/api/core'

// Dentro de onMount, após os listeners existentes:
const unsubSettings = onSettingsAction(async (action) => {
  if (action.type === 'credentialSave') {
    try {
      await invoke('save_credential', {
        slot: action.slot,
        kind: action.kind,
        connectionMode: action.connectionMode,
        secret: action.secret,
        baseUrl: action.baseUrl,
      })
      // Recarregar o estado de settings para refletir o novo status.
      // Quando settings-feed.ts for atualizado (seção 3.5), basta
      // um signal reativo — por ora, nada muda na UI além do botão
      // que já volta ao estado normal após o clique.
    } catch (err) {
      console.error('[save_credential]', err)
      // TODO: expor toast de erro para o usuário (T-406 pós-MVP)
    }
  }

  if (action.type === 'logFolderOpen') {
    await invoke('open_logs_folder')
  }

  if (action.type === 'logCopy') {
    await invoke('copy_logs_to_clipboard')
  }
})

// Cleanup no return de onMount:
return () => {
  unlistenNavigate?.()
  unsubHome()
  unsubRestart()
  unsubSettings()    // NOVO
}
```

> **Nota**: `logFolderOpen` e `logCopy` já têm comandos core registrados mas
> não estão sendo chamados em nenhum lugar. Esta é a oportunidade de wirá-los.

---

### 3.5 Atualizar `settings-feed.ts` para ler do core

Substituir o placeholder estático por uma leitura real:

```ts
import { invoke } from '@tauri-apps/api/core'
import type { GetCredentialsResponse, ProviderKind } from '../../../../../contracts/ipc'
import type { ProviderSlotId, ProviderConnectionStatus, SettingsState } from './types'

const SLOT_KINDS: Record<ProviderSlotId, ProviderKind> = {
  openai: 'OPENAI',
  anthropic: 'ANTHROPIC',
  gemini: 'GEMINI',
  deepseek: 'DEEPSEEK',
  openrouter: 'OPENROUTER',
  chatgpt: 'OPENAI',   // chatgpt usa OPENAI kind com connectionMode SUBSCRIPTION
  generic: 'GENERIC',
}

export async function loadSettingsState(): Promise<SettingsState> {
  let creds: GetCredentialsResponse = { credentials: [] }

  try {
    creds = await invoke<GetCredentialsResponse>('get_provider_statuses')
  } catch {
    // sidecar não pronto — usar placeholder restritivo
  }

  const providerStatus = Object.fromEntries(
    (Object.keys(SLOT_KINDS) as ProviderSlotId[]).map((slot) => {
      const found = creds.credentials.find((c) => c.slot === slot)
      const status: ProviderConnectionStatus = found
        ? (found.last_validated_at ? 'connected' : 'disconnected')
        : 'notConfigured'
      return [slot, status]
    }),
  ) as Record<ProviderSlotId, ProviderConnectionStatus>

  return {
    ...RESTRICTIVE_PLACEHOLDER,
    providerStatus,
  }
}
```

Em `Settings.svelte`, trocar `readSettingsState()` (síncrono) por um `$state`
que resolve a Promise:

```svelte
<script lang="ts">
  import { loadSettingsState } from './settings-feed'
  import type { SettingsState } from './types'
  import { RESTRICTIVE_PLACEHOLDER } from './settings-feed'

  // Estado inicia restritivo e atualiza quando a Promise resolve.
  let settingsState = $state<SettingsState>(RESTRICTIVE_PLACEHOLDER)

  void loadSettingsState().then((s) => { settingsState = s })
</script>
```

---

### 3.6 Implementar o handler `validateCredential` (T-206)

Arquivo: `sidecar/src/handlers.ts`

A rota `POST /providers/validate` já existe no `IpcEndpoints` mas o handler
não está implementado. Implementar conforme ADR-006:

```ts
import type { ValidateCredentialRequest, ValidateCredentialResponse } from '../../../contracts/ipc'
import { providerRegistry } from './providers/registry'

export async function handleValidateCredential(
  body: unknown,
): Promise<IpcResult<ValidateCredentialResponse>> {
  const req = parseValidateCredentialRequest(body)

  const adapter = providerRegistry.get(req.credential.kind)
  if (!adapter) {
    return {
      ok: false,
      error: { code: 'INVALID_CREDENTIAL', message: `Provider '${req.credential.kind}' not registered` },
    }
  }

  try {
    const result = await adapter.validate(req.credential)
    return { ok: true, value: result }
  } catch (err) {
    return {
      ok: false,
      error: { code: 'INVALID_CREDENTIAL', message: String(err) },
    }
  }
}
```

Após validação bem-sucedida, atualizar `lastValidatedAt` no banco:

```ts
await db.apiKeyRef.updateMany({
  where: { userId: SYSTEM_USER_ID, slot: /* precisa vir no request */ },
  data: { lastValidatedAt: new Date() },
})
```

> **Nota**: `ValidateCredentialRequest` não tem `slot` — será necessário
> adicioná-lo ao struct Rust e regenerar, OU o core atualiza via
> `save_credential` após uma validação bem-sucedida disparada da UI.
> Decisão: adicionar `slot?: string` opcional ao request (não quebra o contrato
> existente, o sidecar usa quando presente).

---

## 4. Migration Prisma necessária

```prisma
// Adicionar ao model ApiKeyRef em prisma/schema.prisma:
slot  String              // ex.: 'openai', 'anthropic', 'deepseek'

@@unique([userId, slot])  // um slot por usuário
```

```bash
npx prisma migrate dev --name add_slot_to_api_key_ref
npx prisma generate
```

---

## 5. Segurança — checklist ADR-003

Antes de fechar qualquer task que implemente os itens acima, verificar:

- [ ] `secret` não aparece em nenhum `log!()`, `tracing::debug!()`, ou `println!()` em Rust.
- [ ] `secret` não aparece em nenhum `console.log()`, `console.error()` em TypeScript.
- [ ] `SaveCredentialRequest` (Rust → sidecar) contém apenas `secret_ref`, nunca `secret`.
- [ ] `GetCredentialsResponse` contém `secret_ref` (ponteiro opaco), nunca o segredo real.
- [ ] `InjectedCredential.secret` (usado no `suggest`) é resolvido por `vault::get_secret` a cada chamada, nunca cacheado em variável de módulo.
- [ ] `grep -r "secret" sidecar/src/` não mostra nenhum log.

---

## 6. Ordem de implementação recomendada

1. **Migration Prisma** (`add_slot_to_api_key_ref`) — base de tudo.
2. **Structs Rust em `ipc.rs`** + regeneração de `contracts/ipc.ts`.
3. **Handlers sidecar** (`POST /credentials`, `DELETE /credentials`, `GET /credentials`) + testes Vitest.
4. **Handler `validateCredential`** com `adapter.validate()` real.
5. **Tauri commands** (`save_credential`, `delete_credential`, `get_provider_statuses`) com `cargo test`.
6. **Wiring em `App.svelte`** — assinar `onSettingsAction`.
7. **Atualizar `settings-feed.ts`** — `loadSettingsState()` async + atualizar `Settings.svelte`.
8. **Teste manual**: abrir Settings → aba Fontes de IA → colar uma API key → Salvar → fechar e reabrir Settings → verificar que o status mostra `disconnected` (salvo mas não validado) → clicar Validar → verificar `connected`.

---

## 7. Tasks do backlog relacionadas

| Task | Descrição | Status |
|---|---|---|
| T-301 | vault.rs — cofre nativo | DONE |
| T-302 | Injeção de credencial por request | pending (este doc cobre) |
| T-206 | validateCredential handler sidecar | pending (seção 3.6) |
| T-406 | Settings ponta a ponta | pending (este doc cobre) |
