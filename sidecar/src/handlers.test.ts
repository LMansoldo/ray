// T-100 RED: integration tests for session handlers.
//
// Mocks Prisma at the module level so tests execute WITHOUT a real Postgres
// (DATABASE_URL). This makes the RED signal observable: the stub handlers
// return ipcErr("INTERNAL", "not_implemented") instead of the expected
// IpcResult.ok shapes, so every assertion on result.ok === true fails.
//
// Once the GREEN step implements the handlers against the real Prisma
// singleton, these same tests pass with zero mock changes — the mock
// provides the same API surface as the real PrismaClient.

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// ---------------------------------------------------------------------------
// In-memory store — replaces PrismaClient for the test run
// ---------------------------------------------------------------------------

interface StoredSession {
  id: string;
  userId: string;
  status: string;
  platform: string;
  sourceLanguage: string | null;
  targetLanguage: string | null;
  assistantId: string | null;
  startedAt: Date;
  endedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface StoredSegment {
  id: string;
  sessionId: string;
  speaker: string;
  text: string;
  translatedText: string | null;
  startMs: number;
  endMs: number;
  createdAt: Date;
}

let sessions: Map<string, StoredSession> = new Map();
let segments: Map<string, StoredSegment> = new Map();
let idCounter = 0;

function resetStore() {
  sessions = new Map();
  segments = new Map();
  idCounter = 0;
}

function nextId(prefix: string) {
  idCounter += 1;
  return `${prefix}_test_${idCounter}`;
}

// ---------------------------------------------------------------------------
// Mock PrismaClient — vi.mock factory runs before module evaluation
// ---------------------------------------------------------------------------

vi.mock("./db.js", () => {
  return {
    prisma: {
      session: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const id = nextId("session");
          const now = new Date();
          const session: StoredSession = {
            id,
            userId: data.userId as string,
            status: (data.status as string) ?? "ACTIVE",
            platform: (data.platform as string) ?? "OTHER",
            sourceLanguage: (data.sourceLanguage as string) ?? null,
            targetLanguage: (data.targetLanguage as string) ?? null,
            assistantId: (data.assistantId as string) ?? null,
            startedAt: (data.startedAt as Date) ?? now,
            endedAt: null,
            createdAt: now,
            updatedAt: now,
          };
          sessions.set(id, session);
          return { ...session };
        }),
        update: vi.fn(
          async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
            const session = sessions.get(where.id);
            if (!session) {
              throw new Error(`Session not found: ${where.id}`);
            }
            const updated = { ...session, ...data, updatedAt: new Date() };
            sessions.set(where.id, updated);
            return { ...updated };
          },
        ),
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
          const session = sessions.get(where.id);
          return session ? { ...session } : null;
        }),
      },
      transcriptSegment: {
        create: vi.fn(
          async ({ data }: { data: Record<string, unknown> }) => {
            const id = nextId("segment");
            const now = new Date();
            const segment: StoredSegment = {
              id,
              sessionId: data.sessionId as string,
              speaker: data.speaker as string,
              text: data.text as string,
              translatedText: (data.translatedText as string) ?? null,
              startMs: data.startMs as number,
              endMs: data.endMs as number,
              createdAt: now,
            };
            segments.set(id, segment);
            return { ...segment };
          },
        ),
        count: vi.fn(async ({ where }: { where: { sessionId: string } }) => {
          let count = 0;
          for (const seg of segments.values()) {
            if (seg.sessionId === where.sessionId) count += 1;
          }
          return count;
        }),
        findMany: vi.fn(
          async ({ where }: { where: { sessionId: string } }) => {
            const result: StoredSegment[] = [];
            for (const seg of segments.values()) {
              if (seg.sessionId === where.sessionId) result.push({ ...seg });
            }
            return result;
          },
        ),
      },
      $disconnect: vi.fn(async () => {}),
    },
  };
});

// ---------------------------------------------------------------------------
// Imports — handlers.ts will receive the mocked prisma from ./db.js
// ---------------------------------------------------------------------------

import {
  startSession,
  appendTranscript,
  endSession,
} from "./handlers.js";
import type {
  StartSessionRequest,
  AppendTranscriptRequest,
  EndSessionRequest,
  IpcResult,
  StartSessionResponse,
  EndSessionResponse,
} from "./contract.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("session handlers (T-100)", () => {
  beforeEach(() => {
    resetStore();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // startSession
  // -----------------------------------------------------------------------

  describe("startSession", () => {
    it("creates a session with status ACTIVE and returns a sessionId", async () => {
      const req: StartSessionRequest = { userId: "user-1" };
      const result: IpcResult<StartSessionResponse> = await startSession(req);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.sessionId).toBeTruthy();
      expect(typeof result.value.sessionId).toBe("string");

      // Verify persisted state in the mock store.
      const session = sessions.get(result.value.sessionId);
      expect(session).toBeDefined();
      expect(session!.status).toBe("ACTIVE");
      expect(session!.userId).toBe("user-1");
      expect(session!.startedAt).toBeInstanceOf(Date);
      expect(session!.endedAt).toBeNull();
    });

    it("persists optional fields when provided", async () => {
      const req: StartSessionRequest = {
        userId: "user-1",
        platform: "ZOOM",
        sourceLanguage: "pt",
        targetLanguage: "en",
      };
      const result = await startSession(req);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const session = sessions.get(result.value.sessionId);
      expect(session).toBeDefined();
      expect(session!.platform).toBe("ZOOM");
      expect(session!.sourceLanguage).toBe("pt");
      expect(session!.targetLanguage).toBe("en");
    });

    it("returns ok:true with the IpcResult envelope shape", async () => {
      const result = await startSession({ userId: "user-1" });
      expect(result).toHaveProperty("ok");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result).toHaveProperty("value");
        expect(result.value).toHaveProperty("sessionId");
      }
    });
  });

  // -----------------------------------------------------------------------
  // appendTranscript
  // -----------------------------------------------------------------------

  describe("appendTranscript", () => {
    let sessionId: string;

    beforeEach(async () => {
      const result = await startSession({ userId: "user-1" });
      if (!result.ok) throw new Error("startSession failed in beforeEach");
      sessionId = result.value.sessionId;
    });

    it("appends a transcript segment and returns a segmentId", async () => {
      const req: AppendTranscriptRequest = {
        sessionId,
        speaker: "SELF",
        text: "Hello, how are you?",
        startMs: 0,
        endMs: 2500,
      };
      const result = await appendTranscript(req);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.segmentId).toBeTruthy();
      expect(typeof result.value.segmentId).toBe("string");

      const segment = segments.get(result.value.segmentId);
      expect(segment).toBeDefined();
      expect(segment!.sessionId).toBe(sessionId);
      expect(segment!.speaker).toBe("SELF");
      expect(segment!.text).toBe("Hello, how are you?");
      expect(segment!.startMs).toBe(0);
      expect(segment!.endMs).toBe(2500);
      expect(segment!.translatedText).toBeNull();
    });

    it("appends a second segment with a distinct segmentId", async () => {
      const first = await appendTranscript({
        sessionId,
        speaker: "SELF",
        text: "Hello",
        startMs: 0,
        endMs: 1000,
      });
      expect(first.ok).toBe(true);

      const req: AppendTranscriptRequest = {
        sessionId,
        speaker: "OTHERS",
        text: "I am fine, thank you.",
        translatedText: "Eu estou bem, obrigado.",
        startMs: 3000,
        endMs: 5500,
      };
      const result = await appendTranscript(req);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.segmentId).toBeTruthy();
      if (first.ok) {
        expect(result.value.segmentId).not.toBe(first.value.segmentId);
      }

      const segment = segments.get(result.value.segmentId);
      expect(segment).toBeDefined();
      expect(segment!.speaker).toBe("OTHERS");
      expect(segment!.text).toBe("I am fine, thank you.");
      expect(segment!.translatedText).toBe("Eu estou bem, obrigado.");
      expect(segment!.startMs).toBe(3000);
      expect(segment!.endMs).toBe(5500);
    });

    it("persists exactly 2 segments for the session", async () => {
      await appendTranscript({
        sessionId,
        speaker: "SELF",
        text: "First",
        startMs: 0,
        endMs: 1000,
      });
      await appendTranscript({
        sessionId,
        speaker: "OTHERS",
        text: "Second",
        startMs: 1500,
        endMs: 3000,
      });

      let count = 0;
      for (const seg of segments.values()) {
        if (seg.sessionId === sessionId) count += 1;
      }
      expect(count).toBe(2);
    });

    it("returns ok:true with the IpcResult envelope shape", async () => {
      const result = await appendTranscript({
        sessionId,
        speaker: "SELF",
        text: "test",
        startMs: 0,
        endMs: 100,
      });
      expect(result).toHaveProperty("ok");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result).toHaveProperty("value");
        expect(result.value).toHaveProperty("segmentId");
      }
    });
  });

  // -----------------------------------------------------------------------
  // endSession
  // -----------------------------------------------------------------------

  describe("endSession", () => {
    let sessionId: string;

    beforeEach(async () => {
      const result = await startSession({ userId: "user-1" });
      if (!result.ok) throw new Error("startSession failed in beforeEach");
      sessionId = result.value.sessionId;
    });

    it("sets status to ENDED and endedAt when generateSummary is false", async () => {
      const req: EndSessionRequest = {
        sessionId,
        generateSummary: false,
      };
      const result: IpcResult<EndSessionResponse> = await endSession(req);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.sessionId).toBe(sessionId);
      expect(result.value.summaryId).toBeUndefined();

      const session = sessions.get(sessionId);
      expect(session).toBeDefined();
      expect(session!.status).toBe("ENDED");
      expect(session!.endedAt).toBeInstanceOf(Date);
    });

    it("returns ok:true with the IpcResult envelope shape", async () => {
      const result = await endSession({
        sessionId,
        generateSummary: false,
      });
      expect(result).toHaveProperty("ok");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result).toHaveProperty("value");
        expect(result.value).toHaveProperty("sessionId");
      }
    });
  });

  // -----------------------------------------------------------------------
  // Error path: nonexistent session returns ok:false
  // -----------------------------------------------------------------------

  describe("error path", () => {
    it("returns ok:false when appending to a nonexistent session", async () => {
      const req: AppendTranscriptRequest = {
        sessionId: "nonexistent-session-id",
        speaker: "SELF",
        text: "orphan segment",
        startMs: 0,
        endMs: 100,
      };
      const result = await appendTranscript(req);

      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(["DB_ERROR", "INTERNAL"]).toContain(result.error.code);
      expect(typeof result.error.message).toBe("string");
      expect(result.error.message.length).toBeGreaterThan(0);
    });

    it("returns ok:false when ending a nonexistent session", async () => {
      const req: EndSessionRequest = {
        sessionId: "nonexistent-session-id",
        generateSummary: false,
      };
      const result = await endSession(req);

      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(["DB_ERROR", "INTERNAL"]).toContain(result.error.code);
      expect(typeof result.error.message).toBe("string");
      expect(result.error.message.length).toBeGreaterThan(0);
    });

    it("does not leak secrets in error messages (ADR-003)", async () => {
      const result = await endSession({
        sessionId: "nonexistent-session-id",
        generateSummary: false,
        credential: {
          kind: "OPENAI",
          connectionMode: "API_KEY",
          secret: "sk-super-secret-key-12345",
        },
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.error.message).not.toContain("sk-super-secret-key-12345");
      expect(result.error.message).not.toContain("secret");
      expect(result.error.message).not.toContain("credential");
    });
  });
});
