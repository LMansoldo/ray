# Camada de Types & Contratos — Ray

Este pacote é o **alicerce tipado** do qual as tasks de codificação derivam. Segue o ADR-010 (duas camadas de fonte de verdade).

## O que há aqui

- **`../prisma/schema.prisma`** — fonte de verdade dos **tipos de domínio** (ADR-002). O Prisma gera os tipos TS do sidecar via `prisma generate`. Estruturalmente validado; a validação semântica completa roda com `npx prisma validate` em ambiente com acesso aos engines do Prisma.
- **`ipc.ts`** — **gerado** (T-000/ADR-010) a partir dos structs Rust `#[derive(TS)]` em `../core/src/ipc.rs`. Type-checka em `--strict`. Duas exceções continuam mantidas à mão dentro do próprio arquivo (`IpcResult<T>` e `IpcEndpoints` — motivo explicado inline): não são payloads serializáveis, então não têm struct Rust equivalente.

## Como regenerar `ipc.ts`

```sh
cd core && cargo test               # ts-rs exporta os bindings (staging em core/target/)
./core/scripts/gen-ipc-contract.sh  # funde o staging com os blocos mantidos à mão
```

Editar os structs Rust em `core/src/ipc.rs`, nunca `contracts/ipc.ts` diretamente
(fora dos dois blocos marcados "mantido à mão").

## Regra de ouro para as tasks

Cada fragmento de codificação deve ser escrito **contra** um destes contratos, nunca inventando shapes novos na fronteira. Um fragmento "está pronto" quando:

1. compila contra os tipos gerados (Prisma) e/ou a especificação IPC;
2. passa os testes de contrato do endpoint/modelo que implementa.

## Fonte de verdade em runtime (não redigitar tipos)

- **Domínio:** `schema.prisma` → `prisma generate` → tipos TS no sidecar.
- **Fronteira IPC:** os structs **Rust** anotados com `#[derive(TS)]` (ts-rs) geram os tipos TS equivalentes aos de `ipc.ts`. O `ipc.ts` é a especificação espelho; se divergir dos structs Rust, é bug de contrato.

## Ordem sugerida das próximas tasks

1. ~~**Fechar a fonte Rust dos tipos IPC:** criar os structs Rust espelhando `ipc.ts`, com `#[derive(TS)]`, e o comando de geração. A partir daí, `ipc.ts` passa a ser gerado, não mantido à mão.~~ **Feito (T-000).**
2. **Scaffold que compila:** projeto Tauri + sidecar com stubs vazios que já satisfazem os contratos (endpoints respondem `INTERNAL`/`todo`, modelos migrados). É o "chão" para os agentes preencherem.
3. **Fragmentar por contrato:** cada endpoint de `ipc.ts` e cada adapter de provedor (ADR-006) vira uma task isolada — "implemente X contra este contrato + estes testes".

## Segurança que o contrato já carrega

- Segredos só circulam em `InjectedCredential`, por requisição, nunca persistidos no sidecar nem logados (ADR-003).
- Nenhum endpoint retorna segredo; `ApiKeyRef` no banco guarda só um ponteiro para o cofre nativo.
