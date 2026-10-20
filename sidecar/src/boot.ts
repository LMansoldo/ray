// Inicializacao do banco SQLite na primeira execucao (T-406).
// O arquivo .db e criado pelo Prisma no primeiro connect; as tabelas NAO.
// Este modulo aplica o DDL gerado de prisma/schema.prisma
// (`prisma migrate diff --from-empty --to-schema-datamodel --script`)
// quando o schema ainda nao existe, tornando o boot idempotente.
//
// Resolucao do caminho do DDL (dist e prisma sao irmaos em todos os
// layouts — repo e bundle):
//   repo:     sidecar/dist/boot.js   -> sidecar/prisma/sqlite_init.sql
//   bundle:   .../sidecar/dist/boot.js -> .../sidecar/prisma/sqlite_init.sql

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "./db.js";

const SENTINEL_TABLE = "User";

function ddlCandidates(): string[] {
  const fromEnv = process.env.RAY_SIDECAR_SQL;
  const list: string[] = [];
  if (fromEnv) list.push(fromEnv);
  list.push(
    join(dirname(fileURLToPath(import.meta.url)), "../prisma/sqlite_init.sql"),
  );
  return list;
}

export async function initDb(): Promise<void> {
  const existing = (await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
    SENTINEL_TABLE,
  )) as Array<{ name: string }>;
  if (Array.isArray(existing) && existing.length > 0) {
    // schema ja aplicado — só garantem colunas de versões posteriores.
    await ensurePostBootColumns();
    return;
  }

  let sql: string | undefined;
  let usedFrom: string | undefined;
  for (const candidate of ddlCandidates()) {
    try {
      sql = readFileSync(candidate, "utf8");
      usedFrom = candidate;
      break;
    } catch {
      // tenta o proximo
    }
  }
  if (!sql) {
    throw new Error(
      `sqlite_init.sql not found (tried: ${ddlCandidates().join(", ")})`,
    );
  }

  // Remove linhas de comentario SQL e divide em statements individuais.
  const statements = sql
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  await prisma.$transaction(
    statements.map((s) => prisma.$executeRawUnsafe(s)),
  );
  process.stderr.write(
    `[sidecar] database initialized from ${usedFrom} (${statements.length} statements)\n`,
  );

  await ensurePostBootColumns();
}

/**
 * Colunas acrescentadas ao schema depois do primeiro boot de um usuário.
 * O initDb só aplica o DDL completo quando o banco NÃO existe — sem este
 * passo, bancos já existentes ficariam sem as colunas novas e toda query
 * do Prisma que as tocasse falharia. Idempotente: PRAGMA antes de cada
 * ALTER, custo desprezível no boot.
 */
async function ensurePostBootColumns(): Promise<void> {
  const cols = (await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    'PRAGMA table_info("Session")',
  )) as Array<{ name: string }>;
  const names = new Set(cols.map((c) => c.name));
  if (!names.has("rollingSummary")) {
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "Session" ADD COLUMN "rollingSummary" TEXT',
    );
  }
  if (!names.has("summarizedSegmentCount")) {
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "Session" ADD COLUMN "summarizedSegmentCount" INTEGER NOT NULL DEFAULT 0',
    );
  }

  // Settings.sttLanguage — locale de STT (contracts/settings.ts). Coluna
  // acrescentada depois do primeiro boot; bancos antigos ganham a coluna
  // com o default do contrato.
  const settingsCols = (await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    'PRAGMA table_info("Settings")',
  )) as Array<{ name: string }>;
  const settingsNames = new Set(settingsCols.map((c) => c.name));
  if (!settingsNames.has("sttLanguage")) {
    await prisma.$executeRawUnsafe(
      "ALTER TABLE \"Settings\" ADD COLUMN \"sttLanguage\" TEXT NOT NULL DEFAULT 'pt-BR'",
    );
  }
  // Overlay customizado (contracts/settings.ts): template HTML+CSS do
  // usuário + flag de ativação. Mesmo motivo do sttLanguage — bancos
  // antigos ganham as colunas com os defaults do contrato.
  if (!settingsNames.has("overlayTemplateEnabled")) {
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "Settings" ADD COLUMN "overlayTemplateEnabled" BOOLEAN NOT NULL DEFAULT false',
    );
  }
  if (!settingsNames.has("overlayTemplate")) {
    await prisma.$executeRawUnsafe(
      "ALTER TABLE \"Settings\" ADD COLUMN \"overlayTemplate\" TEXT NOT NULL DEFAULT ''",
    );
  }
}

/// Seed minimo de primeiro boot: usuario local + assistente BUILTIN padrao.
/// Sem isso a Home e o copiloto ficam sem assistantId real (SuggestRequest).
export async function seedDefaults(): Promise<void> {
  const count = await prisma.assistant.count();
  if (count > 0) return;

  await prisma.user.upsert({
    where: { id: "local" },
    update: {},
    create: { id: "local", displayName: "Usuario local" },
  });
  const assistant = await prisma.assistant.create({
    data: {
      userId: "local",
      name: "Assistente Padrao",
      category: "GENERAL",
      source: "BUILTIN",
      prompt:
        "Voce e o Ray, copiloto de reunioes. Responda de forma curta e acionavel, " +
        "em pt-BR, com base no contexto da conversa fornecido.",
      icon: null,
    },
  });
  process.stderr.write(`[sidecar] seeded default assistant ${assistant.id}\n`);
}
