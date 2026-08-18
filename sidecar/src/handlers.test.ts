// T-100/T-101 RED: integration tests for session + assistant handlers.
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

interface StoredSummary {
  id: string;
  sessionId: string;
  text: string;
  actionItems: string;
  createdAt: Date;
  updatedAt: Date;
}

let sessions: Map<string, StoredSession> = new Map();
let segments: Map<string, StoredSegment> = new Map();
let assistants: Map<string, StoredAssistant> = new Map();
let summaries: Map<string, StoredSummary> = new Map();
let idCounter = 0;

function resetStore() {
  sessions = new Map();
  segments = new Map();
  assistants = new Map();
  summaries = new Map();
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
      assistant: {
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
        upsert: vi.fn(
          async ({
            where,
            create,
            update,
          }: {
            where: { name: string };
            create: Record<string, unknown>;
            update: Record<string, unknown>;
          }) => {
            const existing = Array.from(assistants.values()).find(
              (a) => a.name === where.name,
            );
            if (existing) {
              const updated = { ...existing, ...update, updatedAt: new Date() };
              assistants.set(existing.id, updated);
              return { ...updated };
            }
            const id = nextId("assistant");
            const now = new Date();
            const assistant: StoredAssistant = {
              id,
              userId: (create.userId as string) ?? null,
              name: create.name as string,
              category: create.category as string,
              source: (create.source as string) ?? "USER",
              prompt: create.prompt as string,
              icon: (create.icon as string) ?? null,
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
      summary: {
        create: vi.fn(
          async ({ data }: { data: Record<string, unknown> }) => {
            const id = nextId("summary");
            const now = new Date();
            const summary: StoredSummary = {
              id,
              sessionId: data.sessionId as string,
              text: data.text as string,
              actionItems: JSON.stringify(data.actionItems ?? []),
              createdAt: now,
              updatedAt: now,
            };
            summaries.set(id, summary);
            return { ...summary };
          },
        ),
        findUnique: vi.fn(
          async ({ where }: { where: { sessionId?: string; id?: string } }) => {
            if (where.sessionId) {
              for (const s of summaries.values()) {
                if (s.sessionId === where.sessionId) return { ...s };
              }
              return null;
            }
            const summary = summaries.get(where.id!);
            return summary ? { ...summary } : null;
          },
        ),
      },
      $disconnect: vi.fn(async () => {}),
    },
  };
});

// ---------------------------------------------------------------------------
// Mock: summary module — fake generateSummary for T-103
//
// The mock signature matches the declared generateSummary exactly:
// (TranscriptContextSegment[], InjectedCredential, AiProvider).
// A vi.fn captures arguments so handler-level tests can assert that
// endSession forwards req.credential and transcript segments.
// ---------------------------------------------------------------------------

import type {
  TranscriptContextSegment,
  InjectedCredential,
} from "./contract.js";

/** Per-kind provider configs for T-206/T-207 handler tests. */
const providerConfigs = new Map<string, {
  validate: (cred: InjectedCredential) => Promise<{ valid: boolean; availableModels?: string[]; reason?: string }>;
  capabilities: { analysis: boolean; transcription: boolean; translation: boolean };
  translate: (credential: InjectedCredential, text: string, targetLanguage: string) => Promise<string>;
}>();

const { mockGenerateSummary, configureProvider } = vi.hoisted(() => ({
  mockGenerateSummary: vi.fn(
    async (
      _segments: TranscriptContextSegment[],
      _credential: InjectedCredential,
      _provider: unknown,
    ) => {
      // Fake summary: at least 1 action item.
      const text = "Summary of session.";
      const actionItems = ["Follow up on discussion"];
      return { text, actionItems };
    },
  ),
  /** Per-kind provider config. Set in beforeEach for handler tests. */
  configureProvider: (
    kind: string,
    overrides: Partial<{
      validate: (cred: InjectedCredential) => Promise<{ valid: boolean; availableModels?: string[]; reason?: string }>;
      capabilities: { analysis: boolean; transcription: boolean; translation: boolean };
      translate: (credential: InjectedCredential, text: string, targetLanguage: string) => Promise<string>;
    }> = {},
  ) => {
    providerConfigs.set(kind, {
      validate: overrides.validate ?? (async () => ({ valid: true })),
      capabilities: overrides.capabilities ?? { analysis: true, transcription: false, translation: true },
      translate: overrides.translate ?? (async () => "translated text"),
    });
  },
}));

vi.mock("./agent/summary.js", () => {
  return {
    generateSummary: mockGenerateSummary,
  };
});

// ---------------------------------------------------------------------------
// Mock: provider registry — returns a fake provider for T-103
// ---------------------------------------------------------------------------

vi.mock("./providers/registry.js", () => ({
  getProvider: (kind: string) => {
    const config = providerConfigs.get(kind);
    return {
      kind,
      capabilities: config?.capabilities ?? { analysis: true, transcription: false, translation: true },
      validate: config?.validate ?? (async () => ({ valid: true })),
      analyzeStream: async function* () {
        yield { text: "fake" };
      },
      translate: config?.translate ?? (async () => "translated text"),
    };
  },
}));

// ---------------------------------------------------------------------------
// Imports — handlers.ts will receive the mocked prisma from ./db.js
// ---------------------------------------------------------------------------

import {
  createAssistant,
  startSession,
  appendTranscript,
  endSession,
  validateCredential,
  translate,
} from "./handlers.js";
import type {
  CreateAssistantRequest,
  CreateAssistantResponse,
  StartSessionRequest,
  AppendTranscriptRequest,
  EndSessionRequest,
  IpcResult,
  StartSessionResponse,
  EndSessionResponse,
  ValidateCredentialRequest,
  ValidateCredentialResponse,
  TranslateRequest,
  TranslateResponse,
} from "./contract.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// createAssistant (T-101)
// ---------------------------------------------------------------------------

describe("createAssistant (T-101)", () => {
  beforeEach(() => {
    resetStore();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns an assistantId and persists a USER assistant with given fields", async () => {
    const req: CreateAssistantRequest = {
      userId: "user-1",
      name: "My Custom Assistant",
      category: "CUSTOM",
      prompt: "You are a helpful assistant.",
      icon: "star",
    };
    const result: IpcResult<CreateAssistantResponse> = await createAssistant(req);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.assistantId).toBeTruthy();
    expect(typeof result.value.assistantId).toBe("string");

    const assistant = assistants.get(result.value.assistantId);
    expect(assistant).toBeDefined();
    expect(assistant!.source).toBe("USER");
    expect(assistant!.name).toBe("My Custom Assistant");
    expect(assistant!.category).toBe("CUSTOM");
    expect(assistant!.prompt).toBe("You are a helpful assistant.");
    expect(assistant!.icon).toBe("star");
    expect(assistant!.userId).toBe("user-1");
  });

  it("persists a USER assistant with null icon when icon is omitted", async () => {
    const req: CreateAssistantRequest = {
      userId: "user-1",
      name: "No Icon Assistant",
      category: "GENERAL",
      prompt: "General purpose.",
    };
    const result = await createAssistant(req);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const assistant = assistants.get(result.value.assistantId);
    expect(assistant).toBeDefined();
    expect(assistant!.icon).toBeNull();
    expect(assistant!.source).toBe("USER");
  });

  it("returns ok:true with the IpcResult envelope shape", async () => {
    const req: CreateAssistantRequest = {
      userId: "user-1",
      name: "Envelope Test",
      category: "MEETINGS",
      prompt: "Meeting assistant.",
    };
    const result = await createAssistant(req);
    expect(result).toHaveProperty("ok");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result).toHaveProperty("value");
      expect(result.value).toHaveProperty("assistantId");
    }
  });

  it("returns ok:false with BAD_REQUEST and a descriptive message when name is empty", async () => {
    const result = await createAssistant({
      userId: "user-1",
      name: "",
      category: "GENERAL",
      prompt: "test",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // A real validation path returns BAD_REQUEST with a descriptive message.
    // The stub returns INTERNAL/"not_implemented" — neither matches.
    expect(result.error.code).toBe("BAD_REQUEST");
    expect(result.error.message).not.toBe("not_implemented");
    expect(result.error.message.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// session handlers (T-100)
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
  // endSession with generateSummary=true (T-103, RF-803)
  // -----------------------------------------------------------------------

  describe("endSession with generateSummary (T-103)", () => {
    let sessionId: string;

    const SAMPLE_CREDENTIAL: InjectedCredential = {
      kind: "OPENAI",
      connectionMode: "API_KEY",
      secret: "sk-test-secret-12345",
    };

    beforeEach(async () => {
      mockGenerateSummary.mockClear();

      const result = await startSession({ userId: "user-1" });
      if (!result.ok) throw new Error("startSession failed in beforeEach");
      sessionId = result.value.sessionId;

      // Seed transcript segments so the summary has context.
      await appendTranscript({
        sessionId,
        speaker: "SELF",
        text: "Hello, let's discuss the project.",
        startMs: 0,
        endMs: 3000,
      });
      await appendTranscript({
        sessionId,
        speaker: "OTHERS",
        text: "Sure, the deployment is on track.",
        startMs: 3500,
        endMs: 6000,
      });
      await appendTranscript({
        sessionId,
        speaker: "SELF",
        text: "Great, let's schedule the next review.",
        startMs: 6500,
        endMs: 9000,
      });
    });

    it("generates and persists a Summary with at least 1 action item when generateSummary=true", async () => {
      const req: EndSessionRequest = {
        sessionId,
        generateSummary: true,
        credential: SAMPLE_CREDENTIAL,
      };
      const result: IpcResult<EndSessionResponse> = await endSession(req);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.sessionId).toBe(sessionId);
      expect(result.value.summaryId).toBeTruthy();
      expect(typeof result.value.summaryId).toBe("string");

      // Verify the Summary was persisted 1:1 with the session.
      const summaryId = result.value.summaryId!;
      const summary = summaries.get(summaryId);
      expect(summary).toBeDefined();
      expect(summary!.sessionId).toBe(sessionId);
      expect(summary!.text.length).toBeGreaterThan(0);

      const actionItems = JSON.parse(summary!.actionItems);
      expect(Array.isArray(actionItems)).toBe(true);
      expect(actionItems.length).toBeGreaterThanOrEqual(1);
    });

    it("returns summaryId in the response when a summary was generated", async () => {
      const result = await endSession({
        sessionId,
        generateSummary: true,
        credential: SAMPLE_CREDENTIAL,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.summaryId).toBeTruthy();
      expect(typeof result.value.summaryId).toBe("string");
    });

    it("creates exactly one Summary per session (1:1 via unique sessionId)", async () => {
      await endSession({
        sessionId,
        generateSummary: true,
        credential: SAMPLE_CREDENTIAL,
      });

      // Count summaries for this session — should be exactly 1.
      let count = 0;
      for (const s of summaries.values()) {
        if (s.sessionId === sessionId) count += 1;
      }
      expect(count).toBe(1);
    });

    it("sets session status to ENDED and endedAt even when generating a summary", async () => {
      await endSession({
        sessionId,
        generateSummary: true,
        credential: SAMPLE_CREDENTIAL,
      });

      const session = sessions.get(sessionId);
      expect(session).toBeDefined();
      expect(session!.status).toBe("ENDED");
      expect(session!.endedAt).toBeInstanceOf(Date);
    });

    it("forwards EndSessionRequest.credential to generateSummary (RF-803)", async () => {
      const credential: InjectedCredential = {
        kind: "ANTHROPIC",
        connectionMode: "API_KEY",
        secret: "sk-ant-forward-test-55555",
        model: "claude-sonnet-5",
      };

      await endSession({
        sessionId,
        generateSummary: true,
        credential,
      });

      // generateSummary was called — assert it received the exact credential.
      expect(mockGenerateSummary).toHaveBeenCalledTimes(1);
      const [segments, receivedCredential, receivedProvider] =
        mockGenerateSummary.mock.calls[0]!;

      expect(receivedCredential).toEqual(credential);
      expect(receivedCredential.kind).toBe("ANTHROPIC");
      expect(receivedCredential.secret).toBe("sk-ant-forward-test-55555");

      // Also verify transcript segments were forwarded.
      expect(Array.isArray(segments)).toBe(true);
      expect(segments.length).toBe(3);
    });

    it("forwards transcript segments from the session to generateSummary", async () => {
      await endSession({
        sessionId,
        generateSummary: true,
        credential: SAMPLE_CREDENTIAL,
      });

      expect(mockGenerateSummary).toHaveBeenCalledTimes(1);
      const [segments] = mockGenerateSummary.mock.calls[0]!;

      // The 3 segments we seeded in beforeEach.
      expect(segments).toHaveLength(3);
      expect(segments[0].text).toBe("Hello, let's discuss the project.");
      expect(segments[1].text).toBe("Sure, the deployment is on track.");
      expect(segments[2].text).toBe("Great, let's schedule the next review.");
    });

    it("credential secret never appears in persisted Summary (ADR-003)", async () => {
      const secret = "sk-super-secret-never-persist-99999";
      const result = await endSession({
        sessionId,
        generateSummary: true,
        credential: {
          kind: "OPENAI",
          connectionMode: "API_KEY",
          secret,
        },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // Check the persisted summary does not contain the secret.
      const summary = summaries.get(result.value.summaryId!);
      expect(summary).toBeDefined();
      expect(summary!.text).not.toContain(secret);
      expect(summary!.actionItems).not.toContain(secret);
    });

    it("credential secret never appears in the response (ADR-003)", async () => {
      const secret = "sk-super-secret-never-in-response-88888";
      const result = await endSession({
        sessionId,
        generateSummary: true,
        credential: {
          kind: "OPENAI",
          connectionMode: "API_KEY",
          secret,
        },
      });

      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain(secret);
      expect(serialized).not.toContain("sk-super-secret-never-in-response-88888");
    });

    it("does not create a Summary when generateSummary=false", async () => {
      const countBefore = summaries.size;

      const result = await endSession({
        sessionId,
        generateSummary: false,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.summaryId).toBeUndefined();
      expect(summaries.size).toBe(countBefore);
      expect(mockGenerateSummary).not.toHaveBeenCalled();
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

// ---------------------------------------------------------------------------
// validateCredential (T-206)
// ---------------------------------------------------------------------------

const SENTINEL_SECRET = "sk-T206-sentinel-NEVER-LEAK-99999";

function fakeCredential(kind: string): InjectedCredential {
  return {
    kind: kind as InjectedCredential["kind"],
    connectionMode: "API_KEY",
    secret: SENTINEL_SECRET,
    baseUrl: "https://fake.example.com",
    model: "test-model",
  };
}

describe("validateCredential (T-206)", () => {
  beforeEach(() => {
    providerConfigs.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Delegation: correct adapter by kind
  // -------------------------------------------------------------------------

  describe("delegation — correct adapter by kind", () => {
    it.each(["OPENAI", "ANTHROPIC", "GEMINI", "DEEPSEEK", "OPENROUTER", "GENERIC"])(
      "delegates to the %s adapter via getProvider(kind) and calls validate with the credential",
      async (kind) => {
        let receivedCred: InjectedCredential | undefined;
        configureProvider(kind, {
          validate: async (cred) => {
            receivedCred = cred;
            return { valid: true, availableModels: ["model-a"] };
          },
        });

        const credential = fakeCredential(kind);
        const req: ValidateCredentialRequest = { credential };
        await validateCredential(req);

        expect(receivedCred).toBeDefined();
        expect(receivedCred).toBe(credential);
        expect(receivedCred!.kind).toBe(kind);
        expect(receivedCred!.secret).toBe(SENTINEL_SECRET);
      },
    );

    it("does not branch on ProviderKind — each kind delegates to its own adapter without a conditional in the handler", async () => {
      // Configure two providers with distinct return values.
      configureProvider("OPENAI", {
        validate: async () => ({ valid: true, availableModels: ["gpt-4o"] }),
      });
      configureProvider("ANTHROPIC", {
        validate: async () => ({ valid: true, availableModels: ["claude-sonnet-5"] }),
      });

      const openaiResult = await validateCredential({
        credential: fakeCredential("OPENAI"),
      });
      const anthropicResult = await validateCredential({
        credential: fakeCredential("ANTHROPIC"),
      });

      expect(openaiResult.ok).toBe(true);
      expect(anthropicResult.ok).toBe(true);
      if (openaiResult.ok && anthropicResult.ok) {
        expect(openaiResult.value.availableModels).toEqual(["gpt-4o"]);
        expect(anthropicResult.value.availableModels).toEqual(["claude-sonnet-5"]);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Envelope: adapter result passed through as { ok: true, value }
  // -------------------------------------------------------------------------

  describe("envelope — adapter result passed through as { ok: true, value }", () => {
    it("wraps a valid result with availableModels as { ok: true, value }", async () => {
      configureProvider("OPENAI", {
        validate: async () => ({ valid: true, availableModels: ["gpt-4o", "gpt-4o-mini"] }),
      });

      const result = await validateCredential({
        credential: fakeCredential("OPENAI"),
      });

      expect(result).toEqual({
        ok: true,
        value: { valid: true, availableModels: ["gpt-4o", "gpt-4o-mini"] },
      });
    });

    it("wraps a valid result without availableModels as { ok: true, value }", async () => {
      configureProvider("GEMINI", {
        validate: async () => ({ valid: true }),
      });

      const result = await validateCredential({
        credential: fakeCredential("GEMINI"),
      });

      expect(result).toEqual({ ok: true, value: { valid: true } });
    });

    it("wraps an invalid result with reason as { ok: true, value }", async () => {
      configureProvider("DEEPSEEK", {
        validate: async () => ({ valid: false, reason: "Unauthorized: invalid API key" }),
      });

      const result = await validateCredential({
        credential: fakeCredential("DEEPSEEK"),
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.valid).toBe(false);
      expect(result.value.reason).toBe("Unauthorized: invalid API key");
    });
  });

  // -------------------------------------------------------------------------
  // Failure mapping: adapter errors → { ok: false, error }
  // Uses ProviderError (typed signal) for provider/network failures,
  // plain Error for unexpected failures — no fragile message-pattern matching.
  // -------------------------------------------------------------------------

  describe("failure mapping — adapter errors to IpcError", () => {
    it("maps a ProviderError to PROVIDER_UNAVAILABLE (typed signal, not message pattern)", async () => {
      const { ProviderError } = await import("./handlers.js");
      configureProvider("OPENAI", {
        validate: async () => {
          throw new ProviderError("fetch failed");
        },
      });

      const result = await validateCredential({
        credential: fakeCredential("OPENAI"),
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("PROVIDER_UNAVAILABLE");
      expect(result.error.message.length).toBeGreaterThan(0);
    });

    it("maps a ProviderError with HTTP status to PROVIDER_UNAVAILABLE", async () => {
      const { ProviderError } = await import("./handlers.js");
      configureProvider("ANTHROPIC", {
        validate: async () => {
          throw new ProviderError("Anthropic API error: HTTP 503");
        },
      });

      const result = await validateCredential({
        credential: fakeCredential("ANTHROPIC"),
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("PROVIDER_UNAVAILABLE");
      expect(result.error.message.length).toBeGreaterThan(0);
    });

    it("maps a CapabilityNotSupported error to PROVIDER_UNAVAILABLE", async () => {
      const { CapabilityNotSupported } = await import("./providers/provider.js");
      configureProvider("GENERIC", {
        validate: async () => {
          throw new CapabilityNotSupported("GENERIC", "analysis");
        },
      });

      const result = await validateCredential({
        credential: fakeCredential("GENERIC"),
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("PROVIDER_UNAVAILABLE");
    });

    it("maps an unexpected (non-provider) error to INTERNAL", async () => {
      configureProvider("DEEPSEEK", {
        validate: async () => {
          throw new Error("something completely unexpected");
        },
      });

      const result = await validateCredential({
        credential: fakeCredential("DEEPSEEK"),
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("INTERNAL");
      expect(result.error.message.length).toBeGreaterThan(0);
    });

    it("distinguishes ProviderError (PROVIDER_UNAVAILABLE) from plain Error (INTERNAL) by type, not by message text", async () => {
      const { ProviderError } = await import("./handlers.js");

      // Same message text, different error types → different IpcError codes.
      const sharedMessage = "connection refused";

      configureProvider("OPENAI", {
        validate: async () => {
          throw new ProviderError(sharedMessage);
        },
      });
      const providerResult = await validateCredential({
        credential: fakeCredential("OPENAI"),
      });

      configureProvider("OPENAI", {
        validate: async () => {
          throw new Error(sharedMessage);
        },
      });
      const unexpectedResult = await validateCredential({
        credential: fakeCredential("OPENAI"),
      });

      expect(providerResult.ok).toBe(false);
      expect(unexpectedResult.ok).toBe(false);
      if (!providerResult.ok && !unexpectedResult.ok) {
        expect(providerResult.error.code).toBe("PROVIDER_UNAVAILABLE");
        expect(unexpectedResult.error.code).toBe("INTERNAL");
      }
    });

    it("never produces an unhandled rejection when adapter throws", async () => {
      const { ProviderError } = await import("./handlers.js");
      configureProvider("OPENROUTER", {
        validate: async () => {
          throw new ProviderError("network timeout");
        },
      });

      // Should resolve (not reject) with an error envelope.
      const result = await validateCredential({
        credential: fakeCredential("OPENROUTER"),
      });
      expect(result.ok).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Secret safety: the secret never appears in any result field
  // Error messages that embed the sentinel secret must be sanitized before
  // crossing the IPC boundary (ADR-003, RNF-301).
  // -------------------------------------------------------------------------

  describe("secret safety — secret never leaks", () => {
    it("does not include the secret in a success result", async () => {
      configureProvider("OPENAI", {
        validate: async () => ({ valid: true, availableModels: ["gpt-4o"] }),
      });

      const result = await validateCredential({
        credential: fakeCredential("OPENAI"),
      });

      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain(SENTINEL_SECRET);
      expect(serialized).not.toContain("NEVER-LEAK");
    });

    it("strips the secret from error messages when the adapter throws an error containing the secret", async () => {
      // The error message EMBEDS the sentinel secret — a real scenario when
      // an API returns "401 Unauthorized: invalid key sk-xxx" in its response.
      configureProvider("ANTHROPIC", {
        validate: async () => {
          throw new Error("401 Unauthorized for key " + SENTINEL_SECRET);
        },
      });

      const result = await validateCredential({
        credential: fakeCredential("ANTHROPIC"),
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      // The handler must strip the secret before it crosses the IPC boundary.
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain(SENTINEL_SECRET);
      expect(serialized).not.toContain("NEVER-LEAK");
      // The error message should still exist (not empty), just sanitized.
      expect(result.error.message.length).toBeGreaterThan(0);
    });

    it("strips the secret from ProviderError messages that embed the secret", async () => {
      const { ProviderError } = await import("./handlers.js");
      // A provider error whose message also embeds the secret.
      configureProvider("OPENAI", {
        validate: async () => {
          throw new ProviderError("HTTP 401: invalid key " + SENTINEL_SECRET);
        },
      });

      const result = await validateCredential({
        credential: fakeCredential("OPENAI"),
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain(SENTINEL_SECRET);
      expect(serialized).not.toContain("NEVER-LEAK");
      expect(result.error.message.length).toBeGreaterThan(0);
    });

    it("does not include the secret in an invalid-credential result (adapter-controlled reason)", async () => {
      configureProvider("GEMINI", {
        validate: async () => ({ valid: false, reason: "Unauthorized: invalid API key" }),
      });

      const result = await validateCredential({
        credential: fakeCredential("GEMINI"),
      });

      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain(SENTINEL_SECRET);
      expect(serialized).not.toContain("NEVER-LEAK");
    });

    it("does not leak the secret via error message when CapabilityNotSupported is thrown", async () => {
      const { CapabilityNotSupported } = await import("./providers/provider.js");
      configureProvider("GENERIC", {
        validate: async () => {
          throw new CapabilityNotSupported("GENERIC", "analysis");
        },
      });

      const result = await validateCredential({
        credential: fakeCredential("GENERIC"),
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain(SENTINEL_SECRET);
      expect(serialized).not.toContain("NEVER-LEAK");
    });
  });
});

// ---------------------------------------------------------------------------
// translate (T-207)
// ---------------------------------------------------------------------------

describe("translate (T-207)", () => {
  beforeEach(() => {
    providerConfigs.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  function fakeTranslateReq(overrides: Partial<TranslateRequest> = {}): TranslateRequest {
    return {
      sessionId: "session_translate_1",
      text: "Hello, how are you?",
      targetLanguage: "pt",
      credential: fakeCredential("OPENAI"),
      ...overrides,
    };
  }

  // -------------------------------------------------------------------------
  // Success path: delegates to adapter translate, returns { translatedText }
  // -------------------------------------------------------------------------

  describe("success path — delegates to adapter translate", () => {
    it.each(["OPENAI", "ANTHROPIC", "GEMINI", "DEEPSEEK", "OPENROUTER", "GENERIC"])(
      "delegates to the %s adapter's translate(credential, text, targetLanguage) and returns { ok: true, value: { translatedText } }",
      async (kind) => {
        let receivedArgs: { credential?: InjectedCredential; text?: string; targetLanguage?: string } | undefined;
        configureProvider(kind, {
          translate: async (credential, text, targetLanguage) => {
            receivedArgs = { credential, text, targetLanguage };
            return "Ola, como voce esta?";
          },
        });

        const credential = fakeCredential(kind);
        const req = fakeTranslateReq({ credential });
        const result: IpcResult<TranslateResponse> = await translate(req);

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.translatedText).toBe("Ola, como voce esta?");

        // Verify the adapter received the exact arguments.
        expect(receivedArgs).toBeDefined();
        expect(receivedArgs!.credential).toBe(credential);
        expect(receivedArgs!.text).toBe("Hello, how are you?");
        expect(receivedArgs!.targetLanguage).toBe("pt");
      },
    );

    it("does not branch on ProviderKind — delegates via getProvider only", async () => {
      configureProvider("OPENAI", {
        translate: async () => "openai translation",
      });
      configureProvider("ANTHROPIC", {
        translate: async () => "anthropic translation",
      });

      const openaiResult = await translate(fakeTranslateReq({
        credential: fakeCredential("OPENAI"),
      }));
      const anthropicResult = await translate(fakeTranslateReq({
        credential: fakeCredential("ANTHROPIC"),
      }));

      expect(openaiResult.ok).toBe(true);
      expect(anthropicResult.ok).toBe(true);
      if (openaiResult.ok && anthropicResult.ok) {
        expect(openaiResult.value.translatedText).toBe("openai translation");
        expect(anthropicResult.value.translatedText).toBe("anthropic translation");
      }
    });
  });

  // -------------------------------------------------------------------------
  // Capability gating: translation required
  // -------------------------------------------------------------------------

  describe("capability gating — requires translation capability", () => {
    it("returns { ok: false, error } with a specific IpcError code when adapter does not support translation", async () => {
      configureProvider("OPENAI", {
        capabilities: { analysis: true, transcription: false, translation: false },
        translate: async () => {
          throw new Error("should not be called");
        },
      });

      const result = await translate(fakeTranslateReq({
        credential: fakeCredential("OPENAI"),
      }));

      expect(result.ok).toBe(false);
      if (result.ok) return;
      // The handler must return a specific IpcError code, not a generic one.
      // PROVIDER_UNAVAILABLE is the expected code for a missing capability.
      expect(result.error.code).toBe("PROVIDER_UNAVAILABLE");
      expect(result.error.message.length).toBeGreaterThan(0);
    });

    it("never throws or crashes — always returns an IpcError envelope", async () => {
      configureProvider("GENERIC", {
        capabilities: { analysis: true, transcription: false, translation: false },
        translate: async () => {
          throw new Error("should not be called");
        },
      });

      // Should resolve (not reject) with an error envelope.
      const result = await translate(fakeTranslateReq({
        credential: fakeCredential("GENERIC"),
      }));
      expect(result.ok).toBe(false);
      // Must be a specific error code, not a generic one.
      if (result.ok) return;
      expect(result.error.code).toBe("PROVIDER_UNAVAILABLE");
    });

    it("mentions the missing capability in the error message", async () => {
      configureProvider("DEEPSEEK", {
        capabilities: { analysis: true, transcription: false, translation: false },
        translate: async () => {
          throw new Error("should not be called");
        },
      });

      const result = await translate(fakeTranslateReq({
        credential: fakeCredential("DEEPSEEK"),
      }));

      expect(result.ok).toBe(false);
      if (result.ok) return;
      // The error message should indicate which capability is missing.
      expect(result.error.message).toMatch(/translat/i);
      // Must be a specific error code.
      expect(result.error.code).toBe("PROVIDER_UNAVAILABLE");
    });

    it("delegates to adapter when translation capability is true", async () => {
      configureProvider("ANTHROPIC", {
        capabilities: { analysis: true, transcription: false, translation: true },
        translate: async () => "Ola mundo",
      });

      const result = await translate(fakeTranslateReq({
        credential: fakeCredential("ANTHROPIC"),
      }));

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.translatedText).toBe("Ola mundo");
    });

    it("does NOT gate when capabilities.translation is true — succeeds instead of erroring", async () => {
      configureProvider("GEMINI", {
        capabilities: { analysis: true, transcription: true, translation: true },
        translate: async () => "Gemini translated",
      });

      const result = await translate(fakeTranslateReq({
        credential: fakeCredential("GEMINI"),
      }));

      // This must succeed — the capability check must pass through.
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.translatedText).toBe("Gemini translated");
    });
  });

  // -------------------------------------------------------------------------
  // Envelope: adapter errors mapped to IpcError, never unhandled rejection
  // -------------------------------------------------------------------------

  describe("envelope — adapter errors mapped to IpcError", () => {
    it("maps a ProviderError to PROVIDER_UNAVAILABLE", async () => {
      const { ProviderError } = await import("./handlers.js");
      configureProvider("OPENAI", {
        translate: async () => {
          throw new ProviderError("network timeout");
        },
      });

      const result = await translate(fakeTranslateReq());

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("PROVIDER_UNAVAILABLE");
      expect(result.error.message.length).toBeGreaterThan(0);
    });

    it("maps a CapabilityNotSupported to PROVIDER_UNAVAILABLE", async () => {
      const { CapabilityNotSupported } = await import("./providers/provider.js");
      configureProvider("GEMINI", {
        translate: async () => {
          throw new CapabilityNotSupported("GEMINI", "translation");
        },
      });

      const result = await translate(fakeTranslateReq({
        credential: fakeCredential("GEMINI"),
      }));

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("PROVIDER_UNAVAILABLE");
    });

    it("maps an unexpected error to INTERNAL", async () => {
      configureProvider("DEEPSEEK", {
        translate: async () => {
          throw new Error("something completely unexpected");
        },
      });

      const result = await translate(fakeTranslateReq({
        credential: fakeCredential("DEEPSEEK"),
      }));

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("INTERNAL");
      expect(result.error.message.length).toBeGreaterThan(0);
    });

    it("never produces an unhandled rejection when adapter throws", async () => {
      const { ProviderError } = await import("./handlers.js");
      configureProvider("OPENROUTER", {
        translate: async () => {
          throw new ProviderError("API unreachable");
        },
      });

      // Should resolve (not reject) with an error envelope.
      const result = await translate(fakeTranslateReq({
        credential: fakeCredential("OPENROUTER"),
      }));
      expect(result.ok).toBe(false);
    });

    it("distinguishes ProviderError (PROVIDER_UNAVAILABLE) from plain Error (INTERNAL) by type", async () => {
      const { ProviderError } = await import("./handlers.js");
      const sharedMessage = "connection refused";

      configureProvider("OPENAI", {
        translate: async () => {
          throw new ProviderError(sharedMessage);
        },
      });
      const providerResult = await translate(fakeTranslateReq());

      configureProvider("OPENAI", {
        translate: async () => {
          throw new Error(sharedMessage);
        },
      });
      const unexpectedResult = await translate(fakeTranslateReq());

      expect(providerResult.ok).toBe(false);
      expect(unexpectedResult.ok).toBe(false);
      if (!providerResult.ok && !unexpectedResult.ok) {
        expect(providerResult.error.code).toBe("PROVIDER_UNAVAILABLE");
        expect(unexpectedResult.error.code).toBe("INTERNAL");
      }
    });
  });

  // -------------------------------------------------------------------------
  // Secret safety: secret never appears in any result/error field
  // -------------------------------------------------------------------------

  describe("secret safety — secret never leaks", () => {
    it("does not include the secret in a success result", async () => {
      configureProvider("OPENAI", {
        translate: async () => "Ola",
      });

      const result = await translate(fakeTranslateReq());

      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain(SENTINEL_SECRET);
      expect(serialized).not.toContain("NEVER-LEAK");
    });

    it("strips the secret from error messages when the adapter throws an error containing the secret", async () => {
      configureProvider("ANTHROPIC", {
        translate: async () => {
          throw new Error("401 Unauthorized for key " + SENTINEL_SECRET);
        },
      });

      const result = await translate(fakeTranslateReq({
        credential: fakeCredential("ANTHROPIC"),
      }));

      expect(result.ok).toBe(false);
      if (result.ok) return;
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain(SENTINEL_SECRET);
      expect(serialized).not.toContain("NEVER-LEAK");
      expect(result.error.message.length).toBeGreaterThan(0);
    });

    it("strips the secret from ProviderError messages that embed the secret", async () => {
      const { ProviderError } = await import("./handlers.js");
      configureProvider("OPENAI", {
        translate: async () => {
          throw new ProviderError("HTTP 401: invalid key " + SENTINEL_SECRET);
        },
      });

      const result = await translate(fakeTranslateReq());

      expect(result.ok).toBe(false);
      if (result.ok) return;
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain(SENTINEL_SECRET);
      expect(serialized).not.toContain("NEVER-LEAK");
    });

    it("does not leak the secret via CapabilityNotSupported error messages", async () => {
      const { CapabilityNotSupported } = await import("./providers/provider.js");
      configureProvider("GENERIC", {
        capabilities: { analysis: true, transcription: false, translation: false },
        translate: async () => {
          throw new CapabilityNotSupported("GENERIC", "translation");
        },
      });

      const result = await translate(fakeTranslateReq({
        credential: fakeCredential("GENERIC"),
      }));

      expect(result.ok).toBe(false);
      if (result.ok) return;
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain(SENTINEL_SECRET);
      expect(serialized).not.toContain("NEVER-LEAK");
    });
  });
});
