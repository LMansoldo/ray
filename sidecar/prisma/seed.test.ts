// T-101 RED: tests for the BUILTIN assistant seed function.
//
// Mocks Prisma at the module level (same pattern as handlers.test.ts).
// IMPORTANT: Assistant.name is NOT @unique in the schema. The mock exposes
// findFirst + create (not upsert) to force a schema-correct idempotency
// strategy — the GREEN implementation must use findFirst-by-name to detect
// existing BUILTINs before inserting, because Prisma's upsert requires a
// unique where-clause that the Assistant model does not provide on `name`.
//
// RED state: sidecar/prisma/seed.ts does not exist yet, so the import
// fails with a module resolution error. Once the GREEN step creates it,
// these tests pass with zero mock changes.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// In-memory store — replaces PrismaClient for the test run
// ---------------------------------------------------------------------------

interface StoredAssistant {
  id: string;
  userId: string | null;
  name: string;
  category: string;
  source: string;
  prompt: string;
  icon: string | null;
  createdAt: Date;
  updatedAt: Date;
}

let assistants: Map<string, StoredAssistant> = new Map();
let idCounter = 0;

function resetStore() {
  assistants = new Map();
  idCounter = 0;
}

function nextId(prefix: string) {
  idCounter += 1;
  return `${prefix}_test_${idCounter}`;
}

// ---------------------------------------------------------------------------
// Mock PrismaClient — vi.mock factory runs before module evaluation
// ---------------------------------------------------------------------------
// Exposes findFirst + create (not upsert) because Assistant.name lacks
// @unique — Prisma rejects upsert({ where: { name } }) on the real client.
// The seed must be idempotent via application-level find-before-insert.

vi.mock("../src/db.js", () => {
  return {
    prisma: {
      assistant: {
        findFirst: vi.fn(
          async ({
            where,
          }: {
            where: { name?: string; source?: string };
          }) => {
            for (const a of assistants.values()) {
              const nameMatch = where.name === undefined || a.name === where.name;
              const sourceMatch = where.source === undefined || a.source === where.source;
              if (nameMatch && sourceMatch) {
                return { ...a };
              }
            }
            return null;
          },
        ),
        create: vi.fn(
          async ({ data }: { data: Record<string, unknown> }) => {
            const id = nextId("assistant");
            const now = new Date();
            const assistant: StoredAssistant = {
              id,
              userId: (data.userId as string) ?? null,
              name: data.name as string,
              category: data.category as string,
              source: (data.source as string) ?? "USER",
              prompt: data.prompt as string,
              icon: (data.icon as string) ?? null,
              createdAt: now,
              updatedAt: now,
            };
            assistants.set(id, assistant);
            return { ...assistant };
          },
        ),
        count: vi.fn(async () => {
          return assistants.size;
        }),
      },
      $disconnect: vi.fn(async () => {}),
    },
  };
});

// ---------------------------------------------------------------------------
// Imports — seed.ts will receive the mocked prisma from ../src/db.js
// ---------------------------------------------------------------------------

import { seed } from "./seed.js";

// ---------------------------------------------------------------------------
// Expected BUILTIN assistants
// ---------------------------------------------------------------------------

const BUILTIN_NAMES = [
  "General",
  "LeetCode",
  "Note Taker",
  "Sales",
  "Study",
  "Tech Candidate",
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("seed BUILTIN assistants (T-101)", () => {
  beforeEach(() => {
    resetStore();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("inserts all 6 BUILTIN assistants with source=BUILTIN", async () => {
    await seed();

    expect(assistants.size).toBe(6);

    for (const name of BUILTIN_NAMES) {
      const found = Array.from(assistants.values()).find(
        (a) => a.name === name,
      );
      expect(found).toBeDefined();
      expect(found!.source).toBe("BUILTIN");
    }
  });

  it("assigns correct categories to each BUILTIN assistant", async () => {
    await seed();

    const byName = (name: string) =>
      Array.from(assistants.values()).find((a) => a.name === name);

    expect(byName("General")!.category).toBe("GENERAL");
    expect(byName("LeetCode")!.category).toBe("INTERVIEW");
    expect(byName("Note Taker")!.category).toBe("MEETINGS");
    expect(byName("Sales")!.category).toBe("SALES");
    expect(byName("Study")!.category).toBe("STUDY");
    expect(byName("Tech Candidate")!.category).toBe("INTERVIEW");
  });

  it("is idempotent — running seed twice does not duplicate assistants", async () => {
    await seed();
    const countAfterFirst = assistants.size;

    await seed();
    const countAfterSecond = assistants.size;

    expect(countAfterFirst).toBe(6);
    expect(countAfterSecond).toBe(6);

    // Each BUILTIN name still appears exactly once.
    for (const name of BUILTIN_NAMES) {
      const matches = Array.from(assistants.values()).filter(
        (a) => a.name === name,
      );
      expect(matches.length).toBe(1);
    }
  });

  it("all BUILTIN assistants have userId=null", async () => {
    await seed();

    for (const assistant of assistants.values()) {
      expect(assistant.userId).toBeNull();
    }
  });

  it("all BUILTIN assistants have a non-empty prompt", async () => {
    await seed();

    for (const assistant of assistants.values()) {
      expect(assistant.prompt).toBeTruthy();
      expect(typeof assistant.prompt).toBe("string");
      expect(assistant.prompt.length).toBeGreaterThan(0);
    }
  });
});
