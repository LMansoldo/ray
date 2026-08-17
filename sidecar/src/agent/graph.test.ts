// T-102 RED: tests for the LangGraph agent graph + handler wiring.
//
// Uses a fake AiProvider (no real T-2xx adapter, no real API calls).
// Mocks Prisma (assistant lookup) and the provider registry (fake provider).
//
// Acceptance criteria tested:
// 1. suggestStream emits start → token* → done in order.
// 2. Swapping the active assistant swaps behavior (different system prompt),
//    same graph shape.
// 3. analyze returns a consolidated IpcResult<AnalyzeResponse> with sayThis.
// 4. Credential secret never appears in emitted events.
// 5. Graph is provider-agnostic: depends on AiProvider, never imports a
//    concrete adapter.

import { describe, expect, it, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Fake AiProvider — emits deterministic tokens, captures the system prompt
// ---------------------------------------------------------------------------

import type {
  AiProvider,
  AnalyzeParams,
  CompletionChunk,
  ProviderCapabilities,
} from "../providers/provider.js";
import type { InjectedCredential, ProviderKind } from "../providers/types.js";

class FakeProvider implements AiProvider {
  readonly kind: ProviderKind = "OPENAI";
  readonly capabilities: ProviderCapabilities = {
    analysis: true,
    transcription: false,
    translation: false,
  };

  /** Captures the system prompt from the last analyzeStream call. */
  lastSystemPrompt: string | undefined;

  async validate(_credential: InjectedCredential) {
    return { valid: true };
  }

  async *analyzeStream(params: AnalyzeParams): AsyncIterable<CompletionChunk> {
    this.lastSystemPrompt = params.system;
    yield { text: "Hello " };
    yield { text: "world" };
  }

  async translate(
    _credential: InjectedCredential,
    _text: string,
    _targetLanguage: string,
  ): Promise<string> {
    throw new Error("not supported");
  }
}

const fakeProvider = new FakeProvider();

// ---------------------------------------------------------------------------
// Mock: provider registry — always returns the fake provider
// ---------------------------------------------------------------------------

vi.mock("../providers/registry.js", () => ({
  getProvider: (_kind: ProviderKind) => fakeProvider,
}));

// ---------------------------------------------------------------------------
// Mock: Prisma — in-memory assistant store
// ---------------------------------------------------------------------------

interface StoredAssistant {
  id: string;
  name: string;
  prompt: string;
  source: string;
  category: string;
  userId: string | null;
  icon: string | null;
}

const assistants = new Map<string, StoredAssistant>();

function seedAssistant(id: string, name: string, prompt: string) {
  assistants.set(id, {
    id,
    name,
    prompt,
    source: "BUILTIN",
    category: "GENERAL",
    userId: null,
    icon: null,
  });
}

vi.mock("../db.js", () => ({
  prisma: {
    assistant: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const a = assistants.get(where.id);
        return a ? { ...a } : null;
      }),
    },
    $disconnect: vi.fn(async () => {}),
  },
}));

// ---------------------------------------------------------------------------
// Imports — under test
// ---------------------------------------------------------------------------

import { suggestStream, analyze } from "../handlers.js";
import type {
  SuggestRequest,
  SuggestStreamEvent,
  AnalyzeResponse,
  IpcResult,
} from "../contract.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_CREDENTIAL: InjectedCredential = {
  kind: "OPENAI",
  connectionMode: "API_KEY",
  secret: "sk-super-secret-do-not-leak-12345",
  model: "gpt-4o",
};

function makeRequest(assistantId: string): SuggestRequest {
  return {
    sessionId: "session-1",
    assistantId,
    trigger: "AUTO",
    context: [
      { speaker: "OTHERS", text: "How are you?", startMs: 0 },
    ],
    credential: BASE_CREDENTIAL,
  };
}

async function collectEvents(
  gen: AsyncIterable<SuggestStreamEvent>,
): Promise<SuggestStreamEvent[]> {
  const events: SuggestStreamEvent[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  assistants.clear();
  fakeProvider.lastSystemPrompt = undefined;
});

describe("suggestStream (T-102)", () => {
  it("emits exactly one 'start', then zero-or-more 'token', then one 'done' — in order", async () => {
    seedAssistant("a1", "General", "You are a general assistant.");

    const events = await collectEvents(suggestStream(makeRequest("a1")));

    expect(events.length).toBeGreaterThanOrEqual(3);

    // First event must be 'start'
    expect(events[0].type).toBe("start");

    // Last event must be 'done'
    const last = events[events.length - 1];
    expect(last.type).toBe("done");

    // Middle events must all be 'token'
    const middle = events.slice(1, -1);
    for (const ev of middle) {
      expect(ev.type).toBe("token");
    }

    // Exactly one 'start' and one 'done'
    const starts = events.filter((e) => e.type === "start");
    const dones = events.filter((e) => e.type === "done");
    expect(starts).toHaveLength(1);
    expect(dones).toHaveLength(1);
  });

  it("no 'token' or 'done' precedes 'start'", async () => {
    seedAssistant("a1", "General", "You are a general assistant.");

    const events = await collectEvents(suggestStream(makeRequest("a1")));

    let seenStart = false;
    for (const ev of events) {
      if (ev.type === "start") {
        seenStart = true;
        continue;
      }
      // Any non-start event before start is a violation
      expect(seenStart).toBe(true);
    }
  });

  it("swapping the assistant swaps behavior (different system prompt) without changing graph shape", async () => {
    seedAssistant("a-general", "General", "You are a general assistant.");
    seedAssistant("a-sales", "Sales", "You are a sales coach.");

    const eventsGeneral = await collectEvents(
      suggestStream(makeRequest("a-general")),
    );
    const systemPromptGeneral = fakeProvider.lastSystemPrompt;

    const eventsSales = await collectEvents(
      suggestStream(makeRequest("a-sales")),
    );
    const systemPromptSales = fakeProvider.lastSystemPrompt;

    // Both produce the same event shape (start → token* → done)
    expect(eventsGeneral[0].type).toBe("start");
    expect(eventsGeneral[eventsGeneral.length - 1].type).toBe("done");
    expect(eventsSales[0].type).toBe("start");
    expect(eventsSales[eventsSales.length - 1].type).toBe("done");

    // But the system prompt received by the provider differs
    expect(systemPromptGeneral).toBe("You are a general assistant.");
    expect(systemPromptSales).toBe("You are a sales coach.");
    expect(systemPromptGeneral).not.toBe(systemPromptSales);
  });

  it("start event includes a suggestionId", async () => {
    seedAssistant("a1", "General", "You are a general assistant.");

    const events = await collectEvents(suggestStream(makeRequest("a1")));

    const startEvent = events[0];
    expect(startEvent.type).toBe("start");
    if (startEvent.type === "start") {
      expect(startEvent.suggestionId).toBeTruthy();
      expect(typeof startEvent.suggestionId).toBe("string");
    }
  });

  it("done event includes providerKind matching the credential", async () => {
    seedAssistant("a1", "General", "You are a general assistant.");

    const events = await collectEvents(suggestStream(makeRequest("a1")));

    const doneEvent = events[events.length - 1];
    expect(doneEvent.type).toBe("done");
    if (doneEvent.type === "done") {
      expect(doneEvent.providerKind).toBe("OPENAI");
    }
  });

  it("token events carry text from the provider chunks", async () => {
    seedAssistant("a1", "General", "You are a general assistant.");

    const events = await collectEvents(suggestStream(makeRequest("a1")));

    const tokens = events.filter((e) => e.type === "token");
    expect(tokens.length).toBe(2);
    if (tokens[0].type === "token") {
      expect(tokens[0].text).toBe("Hello ");
    }
    if (tokens[1].type === "token") {
      expect(tokens[1].text).toBe("world");
    }
  });

  it("credential secret never appears in emitted events (ADR-003)", async () => {
    seedAssistant("a1", "General", "You are a general assistant.");

    const events = await collectEvents(suggestStream(makeRequest("a1")));

    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain("sk-super-secret-do-not-leak-12345");
    expect(serialized).not.toContain("secret");
  });
});

describe("analyze (T-102)", () => {
  it("returns ok:true with a consolidated AnalyzeResponse containing sayThis", async () => {
    seedAssistant("a1", "General", "You are a general assistant.");

    const result: IpcResult<AnalyzeResponse> = await analyze(
      makeRequest("a1"),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.sayThis).toBeTruthy();
    expect(typeof result.value.sayThis).toBe("string");
    expect(result.value.sayThis.length).toBeGreaterThan(0);
  });

  it("returns providerKind matching the credential", async () => {
    seedAssistant("a1", "General", "You are a general assistant.");

    const result = await analyze(makeRequest("a1"));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.providerKind).toBe("OPENAI");
  });

  it("returns a suggestionId", async () => {
    seedAssistant("a1", "General", "You are a general assistant.");

    const result = await analyze(makeRequest("a1"));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.suggestionId).toBeTruthy();
    expect(typeof result.value.suggestionId).toBe("string");
  });

  it("swapping the assistant swaps behavior for analyze too", async () => {
    seedAssistant("a-general", "General", "You are a general assistant.");
    seedAssistant("a-sales", "Sales", "You are a sales coach.");

    await analyze(makeRequest("a-general"));
    const systemPromptGeneral = fakeProvider.lastSystemPrompt;

    await analyze(makeRequest("a-sales"));
    const systemPromptSales = fakeProvider.lastSystemPrompt;

    expect(systemPromptGeneral).toBe("You are a general assistant.");
    expect(systemPromptSales).toBe("You are a sales coach.");
  });

  it("credential secret never appears in the response (ADR-003)", async () => {
    seedAssistant("a1", "General", "You are a general assistant.");

    const result = await analyze(makeRequest("a1"));

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("sk-super-secret-do-not-leak-12345");
    expect(serialized).not.toContain("secret");
  });

  it("returns ok:false when assistant is not found", async () => {
    const result = await analyze(makeRequest("nonexistent-assistant"));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBeTruthy();
    expect(result.error.message.length).toBeGreaterThan(0);
  });
});
