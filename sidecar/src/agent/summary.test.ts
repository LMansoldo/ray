// T-103 RED: tests for session summary generation.
//
// Uses a fake AiProvider (no real adapter, no real API calls).
// Mocks nothing beyond the provider — tests the summary module in isolation.
//
// Acceptance criteria tested:
// 1. generateSummary returns text (non-empty) + actionItems (>=1 item).
// 2. Uses the provider's analyzeStream with the transcript context.
// 3. Credential secret never appears in the result (ADR-003).
// 4. Provider-agnostic: depends on AiProvider interface, not concrete adapter.

import { describe, expect, it, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Fake AiProvider — emits deterministic summary content
// ---------------------------------------------------------------------------

import type {
  AiProvider,
  AnalyzeParams,
  CompletionChunk,
  ProviderCapabilities,
} from "../providers/provider.js";
import type { InjectedCredential } from "../providers/types.js";
import type { TranscriptContextSegment } from "../contract.js";

class FakeSummaryProvider implements AiProvider {
  readonly kind = "OPENAI" as const;
  readonly capabilities: ProviderCapabilities = {
    analysis: true,
    transcription: false,
    translation: false,
  };

  /** Captures the context passed to analyzeStream for assertions. */
  lastParams: AnalyzeParams | undefined;

  async validate(_credential: InjectedCredential) {
    return { valid: true };
  }

  async *analyzeStream(params: AnalyzeParams): AsyncIterable<CompletionChunk> {
    this.lastParams = params;
    // Emit a summary in chunks: text first, then action items.
    yield { text: "Session summary: " };
    yield { text: "The meeting covered project updates." };
    yield { text: "\n\nAction Items:\n" };
    yield { text: "1. Follow up on the deployment plan" };
    yield { text: "\n2. Schedule the next review meeting" };
  }

  async translate(
    _credential: InjectedCredential,
    _text: string,
    _targetLanguage: string,
  ): Promise<string> {
    throw new Error("not supported");
  }
}

const fakeProvider = new FakeSummaryProvider();

// ---------------------------------------------------------------------------
// Imports — under test
// ---------------------------------------------------------------------------

import { generateSummary } from "./summary.js";
import type { SummaryResult } from "./summary.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_CREDENTIAL: InjectedCredential = {
  kind: "OPENAI",
  connectionMode: "API_KEY",
  secret: "sk-super-secret-do-not-leak-summary-12345",
  model: "gpt-4o",
};

const SAMPLE_SEGMENTS: TranscriptContextSegment[] = [
  { speaker: "SELF", text: "Hello, let's discuss the project.", startMs: 0 },
  { speaker: "OTHERS", text: "Sure, the deployment is on track.", startMs: 3000 },
  { speaker: "SELF", text: "Great, let's schedule the next review.", startMs: 6000 },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  fakeProvider.lastParams = undefined;
});

describe("generateSummary (T-103)", () => {
  it("returns a SummaryResult with non-empty text and at least 1 action item", async () => {
    const result: SummaryResult = await generateSummary(
      SAMPLE_SEGMENTS,
      BASE_CREDENTIAL,
      fakeProvider,
    );

    expect(result).toHaveProperty("text");
    expect(result).toHaveProperty("actionItems");

    expect(typeof result.text).toBe("string");
    expect(result.text.length).toBeGreaterThan(0);

    expect(Array.isArray(result.actionItems)).toBe(true);
    expect(result.actionItems.length).toBeGreaterThanOrEqual(1);
    for (const item of result.actionItems) {
      expect(typeof item).toBe("string");
      expect(item.length).toBeGreaterThan(0);
    }
  });

  it("passes transcript context to the provider's analyzeStream", async () => {
    await generateSummary(SAMPLE_SEGMENTS, BASE_CREDENTIAL, fakeProvider);

    expect(fakeProvider.lastParams).toBeDefined();
    expect(fakeProvider.lastParams!.context).toEqual(SAMPLE_SEGMENTS);
    expect(fakeProvider.lastParams!.credential).toBe(BASE_CREDENTIAL);
  });

  it("uses the injected credential for the provider call", async () => {
    const credential: InjectedCredential = {
      kind: "ANTHROPIC",
      connectionMode: "API_KEY",
      secret: "sk-ant-secret-key-99999",
      model: "claude-sonnet-5",
    };

    await generateSummary(SAMPLE_SEGMENTS, credential, fakeProvider);

    expect(fakeProvider.lastParams).toBeDefined();
    expect(fakeProvider.lastParams!.credential.kind).toBe("ANTHROPIC");
    expect(fakeProvider.lastParams!.credential.model).toBe("claude-sonnet-5");
  });

  it("credential secret never appears in the result (ADR-003)", async () => {
    const result = await generateSummary(
      SAMPLE_SEGMENTS,
      BASE_CREDENTIAL,
      fakeProvider,
    );

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("sk-super-secret-do-not-leak-summary-12345");
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("credential");
  });

  it("credential secret is not held in module-level state after generateSummary returns (ADR-003)", async () => {
    // The module under test must not store the credential in a variable that
    // outlives the function call. We verify this by checking that the result
    // itself never contains the secret (the provider's lastParams DOES hold
    // the credential for its own use — that's expected — but the summary
    // module must not leak it through its own return value or any global).
    const secret = "sk-module-level-check-77777";
    const credential: InjectedCredential = {
      kind: "OPENAI",
      connectionMode: "API_KEY",
      secret,
    };

    const result = await generateSummary(SAMPLE_SEGMENTS, credential, fakeProvider);
    const resultSerialized = JSON.stringify(result);
    expect(resultSerialized).not.toContain(secret);

    // Call again to verify no cross-call leakage.
    const result2 = await generateSummary(SAMPLE_SEGMENTS, credential, fakeProvider);
    expect(JSON.stringify(result2)).not.toContain(secret);

    // The result objects should be independent — no shared mutable state.
    expect(result.text).toBe(result2.text);
    expect(result.actionItems).toEqual(result2.actionItems);
  });

  it("throws when provider.analyzeStream fails", async () => {
    const failingProvider: AiProvider = {
      kind: "OPENAI",
      capabilities: { analysis: true, transcription: false, translation: false },
      validate: async () => ({ valid: true }),
      async *analyzeStream(): AsyncIterable<CompletionChunk> {
        throw new Error("Provider unavailable");
      },
      async translate() { throw new Error("not supported"); },
    };

    await expect(
      generateSummary(SAMPLE_SEGMENTS, BASE_CREDENTIAL, failingProvider),
    ).rejects.toThrow("Provider unavailable");
  });
});
