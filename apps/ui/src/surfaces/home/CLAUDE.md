# surfaces/home — tela principal (T-402)

`Home.svelte` compõe os cards da sessão ativa e a lista de sessões recentes.
Toda a IPC vem por props — sem `invoke()` direto na Home (está no `ConversationActions`).

## Componentes filhos

| Componente | RF | Descrição |
|---|---|---|
| `SessionSearch` | RF-802 | Busca de sessões; `query` sobe por binding |
| `ConversationActions` | RF-333 | Três ações: Analisar Conversa, Capturar Tela, Perguntar Algo |
| `AssistantCard` | RF-011 | Nome e categoria do assistente ativo |
| `MemoryCard` | RF-339 | Lista de itens de memória do assistente |
| `RecentSessions` | RF-011/802 | Lista filtrada de sessões recentes |

Nota: o uso completo é o default — não existem PlanBadge, TierCard nem
conceitos de plano/free tier/trial na Home.

## Props (`HomeProps` em `types.ts`)

Todas obrigatórias — `App.svelte` passa o placeholder até o core retornar dados
reais:

```ts
sessions, assistant, memoryItems, sessionId, assistantId,
context, credential, screenshots?
```

## Navegação — `navigation.ts`

`dispatchHomeNavigation('settings' | 'assistants')` — escutado em `App.svelte`.
Botões "Configurações" e "Assistentes" no header da Home usam esse canal.

## ConversationActions — IPC

O único `invoke('suggest', { req })` da Home Surface vive em `ConversationActions`.
A credencial chega por prop (ADR-003: `InjectedCredential` efêmero, não armazenado).
