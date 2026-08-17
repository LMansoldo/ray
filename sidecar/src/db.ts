// Prisma Client singleton do processo do sidecar (ADR-002).
// Este é o único ponto de acesso ao Postgres em toda a aplicação: o núcleo
// Rust nunca toca o banco diretamente. O cache de módulos do Node garante
// que esta instância é reutilizada por todo importador de "./db.js".

import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();
