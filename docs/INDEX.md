# Ray — Pacote do Projeto

Documentação e scaffold do Ray, copiloto de IA para reuniões em tempo real.

## Documentos (`docs/`)
- **docs/SRS-Ray.md** — Especificação de requisitos de software (o "o quê").
- **docs/ADR-Ray.md** — Registros de decisão arquitetural (o "como" e "por quê"), ADR-001 a ADR-011.
- **TASKS.md** — Backlog fragmentado para o Claude Code (38 tasks em 6 fases).

## Scaffold
- **README.md** — Estrutura do monorepo e mapa contrato → stub.
- **prisma/schema.prisma** — Fonte de verdade dos tipos de domínio.
- **contracts/** — Contrato de fronteira IPC (ipc.ts) + README explicativo.
- **core/** — Núcleo Tauri (Rust): áudio, janelas/stealth, cofre, sidecar, IPC.
- **sidecar/** — Sidecar Node/TS: servidor loopback, handlers, agente, providers.
- **apps/ui/** — Placeholder do frontend Svelte 5 (scaffold na task T-001).

## Ordem de leitura sugerida
1. docs/SRS-Ray.md  →  2. docs/ADR-Ray.md  →  3. TASKS.md  →  4. README.md + código.

## Verificação
- Sidecar: type-check `tsc --noEmit` passou no ambiente de geração.
- Prisma: validado estruturalmente; rodar `npx prisma validate` no host para o carimbo final.
- Core (Rust): verificado estruturalmente; rodar `cargo check` no host (requer toolchain + deps do Tauri).
