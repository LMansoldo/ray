// TDD para o singleton do Prisma Client (T-002).
// Não deve exigir uma conexão real com o Postgres: instanciar o PrismaClient
// não conecta de fato (conexão é lazy, na primeira query).

import { describe, expect, it } from "vitest";
import { prisma as prismaFromFirstImport } from "./db.js";
import { prisma as prismaFromSecondImport } from "./db.js";

describe("db", () => {
  it("exports the same Prisma Client instance across imports (singleton)", () => {
    expect(prismaFromFirstImport).toBeDefined();
    expect(prismaFromFirstImport).toBe(prismaFromSecondImport);
  });

  it("exposes typed query delegates for the domain models", () => {
    expect(typeof prismaFromFirstImport.session.findMany).toBe("function");
    expect(typeof prismaFromFirstImport.user.findMany).toBe("function");
    expect(typeof prismaFromFirstImport.assistant.create).toBe("function");
  });
});
