# surfaces/assistants — biblioteca e criador de assistentes (T-407)

`Assistants.svelte` tem duas views internas: `'library'` (RF-336/337) e
`'creator'` (RF-338). A alternância é estado local — sem rota ou navegação de
surface.

## Views

### library
- Busca por nome (`searchAssistants`)
- Filtro por categoria (`filterAssistantsByCategory`)
- Paginação de `ASSISTANTS_PAGE_SIZE` itens (`paginateAssistants`)
- Seleção otimista: `activeOverride` prevalece sobre `seededActiveId` do feed;
  também emite o evento Tauri `ray:assistant-changed` (`{ id, name, category }`)
  — o App/Home escuta no barramento cross-surface (precedente `ray:navigate`)
- "Importar prompt" emite `promptImportRequest` no canal e abre o seletor de
  arquivo nativo (input escondido `data-assistant-import-input`, `.md`/`.txt`):
  o conteúdo (`file.text()`) é entregue pelo canal `onPromptImport`, abre o
  criador e semeia o nome com o nome do arquivo sem extensão

### creator
- Nome (obrigatório para criar), categoria, prompt via `MarkdownEditor`
- `createAssistant()`: valida nome, lê Markdown do handle, despacha
  `assistantCreate`, adiciona localmente com `id: local-${Date.now()}`, volta
  para library

## Canais (`assistant-actions.ts`)

| Ação despachada | Quando |
|---|---|
| `assistantSelect` | Clique numa linha da biblioteca |
| `assistantCreate` | Clique em "Criar assistente" |
| `promptImportRequest` | Clique em "Importar prompt" |

`onPromptImport` — escutado para receber o Markdown importado pelo core.

## Persistência

Não há comando core de persistência de assistentes ainda. Assistentes criados
existem apenas em memória Svelte (perdidos na recarga). `assistantCreate` é
despachado para uso futuro quando o comando core existir.

## Arquivos auxiliares

| Arquivo | O que faz |
|---|---|
| `assistants-feed.ts` | Lê o estado inicial (lista + ativo) |
| `library.ts` | Funções puras: search, filter, paginate |
| `types.ts` | `AssistantView`, `AssistantCategoryFilter` |
