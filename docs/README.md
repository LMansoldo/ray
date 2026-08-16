# Ray — Scaffold

Esqueleto que **compila** dos dois lados (Rust e TypeScript), com stubs vazios que já satisfazem os contratos definidos em `contracts/`. É o "chão" sobre o qual as tasks de codificação preenchem função a função.

## Estrutura

```
ray/
├── prisma/            # schema.prisma — fonte dos tipos de domínio (ADR-002/010)
├── contracts/         # ipc.ts — contrato de fronteira Rust<->sidecar (ADR-005/010)
├── core/              # núcleo Tauri (Rust): áudio, janelas, cofre, supervisão do sidecar
│   └── src/
├── sidecar/           # sidecar Node/TS: agente LangGraph.js + Prisma Client
│   └── src/
│       └── providers/ # adapters de provedor de IA (ADR-006) — um arquivo por provedor
└── apps/ui/           # frontend Svelte 5 (placeholder no scaffold)
```

## Regra dos stubs

Cada stub compila e responde, mas não implementa a lógica: retorna `INTERNAL`/`todo!()` ou um valor placeholder tipado. Uma task "está pronta" quando troca o corpo do stub pela implementação real **sem alterar a assinatura** ditada pelo contrato.

## Mapa contrato → stub

| Contrato (`contracts/ipc.ts`) | Stub |
|---|---|
| `GET /health` | `sidecar/src/server.ts` |
| `POST /providers/validate` | `sidecar/src/handlers/providers.ts` |
| `POST /copilot/suggest` (SSE) | `sidecar/src/handlers/copilot.ts` |
| `POST /copilot/analyze` | `sidecar/src/handlers/copilot.ts` |
| `POST /assistants` | `sidecar/src/handlers/assistants.ts` |
| `POST /sessions/*` | `sidecar/src/handlers/sessions.ts` |
| `POST /translate` | `sidecar/src/handlers/translate.ts` |
| interface de provedor (ADR-006) | `sidecar/src/providers/provider.ts` (+ um stub por provedor) |
| supervisão do sidecar, cofre, janelas | `core/src/*.rs` |

## Build

- Sidecar: `cd sidecar && npm install && npm run build` (tsc) e `npm run typecheck`.
- Núcleo: `cd core && cargo check` (requer toolchain Rust + deps do Tauri no host).
- Prisma: `npx prisma generate` na raiz (requer engines do Prisma disponíveis).

O scaffold foi verificado com `tsc --noEmit` no lado TS. O `cargo check` deve ser rodado no teu host (o núcleo Tauri precisa de dependências de sistema não presentes no ambiente de geração).
