// RED-step tests for AnthropicProvider (T-201).
// These tests assert the HTTP behavior the implementation must provide.
// The current stub (placeholder) never calls fetch, so these fail — correct for RED.

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { AnthropicProvider } from "./anthropic.js";
import { CapabilityNotSupported } from "./provider.js";
import type { InjectedCredential } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fakeCredential(
  overrides?: Partial<InjectedCredential>,
): InjectedCredential {
  return {
    kind: "ANTHROPIC",
    connectionMode: "API_KEY",
    secret: "sk-ant-test-secret-abc123",
    ...overrides,
  };
}

function fakeAnalyzeParams(overrides?: Record<string, unknown>) {
  return {
    credential: fakeCredential(),
    system: "You are a meeting assistant.",
    context: [
      { speaker: "SELF" as const, text: "Hello everyone.", startMs: 0 },
      { speaker: "OTHERS" as const, text: "Hi, let's start.", startMs: 3000 },
    ],
    ...overrides,
  };
}

/**
 * Create a mock Response whose body is a ReadableStream yielding Anthropic
 * SSE events: message_start, content_block_delta (one per token),
 * content_block_stop, message_delta, message_stop.
 */
function mockAnthropicSseStream(tokens: string[]): Response {
  let index = 0;
  let phase: "start" | "deltas" | "end" = "start";

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const encoder = new TextEncoder();

      if (phase === "start") {
        const event =
          "event: message_start\ndata: " +
          JSON.stringify({
            type: "message_start",
            message: {
              id: "msg_test",
              type: "message",
              role: "assistant",
              content: [],
              model: "claude-sonnet-4-20250514",
              stop_reason: null,
              usage: { input_tokens: 10, output_tokens: 0 },
            },
          }) +
          "\n\n";
        controller.enqueue(encoder.encode(event));
        phase = "deltas";
        return;
      }

      if (phase === "deltas") {
        if (index < tokens.length) {
          const event =
            "event: content_block_delta\ndata: " +
            JSON.stringify({
              type: "content_block_delta",
              index: 0,
              delta: { type: "text_delta", text: tokens[index] },
            }) +
            "\n\n";
          controller.enqueue(encoder.encode(event));
          index++;
          return;
        }
        // All tokens sent — emit stop events
        controller.enqueue(
          encoder.encode(
            "event: content_block_stop\ndata: " +
              JSON.stringify({ type: "content_block_stop", index: 0 }) +
              "\n\n",
          ),
        );
        controller.enqueue(
          encoder.encode(
            "event: message_delta\ndata: " +
              JSON.stringify({
                type: "message_delta",
                delta: { stop_reason: "end_turn", stop_sequence: null },
                usage: { output_tokens: tokens.length },
              }) +
              "\n\n",
          ),
        );
        controller.enqueue(
          encoder.encode(
            "event: message_stop\ndata: " +
              JSON.stringify({ type: "message_stop" }) +
              "\n\n",
          ),
        );
        controller.close();
        return;
      }
    },
  });

  return {
    ok: true,
    status: 200,
    body,
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Mock setup
// ---------------------------------------------------------------------------

let fetchMock: Mock;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

// ---------------------------------------------------------------------------
// 1. Kind and capabilities
// ---------------------------------------------------------------------------

describe("AnthropicProvider", () => {
  const provider = new AnthropicProvider();

  describe("kind and capabilities", () => {
    it("declares kind ANTHROPIC", () => {
      expect(provider.kind).toBe("ANTHROPIC");
    });

    it("declares capabilities { analysis: true, transcription: false, translation: true }", () => {
      expect(provider.capabilities).toEqual({
        analysis: true,
        transcription: false,
        translation: true,
      });
    });
  });

  // ---------------------------------------------------------------------------
  // 2. validate()
  // ---------------------------------------------------------------------------

  describe("validate()", () => {
    it("returns { valid: true, availableModels } when models endpoint returns 200", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            data: [
              { id: "claude-sonnet-4-20250514" },
              { id: "claude-haiku-4-5-20251001" },
            ],
          }),
      } as unknown as Response);

      const result = await provider.validate(fakeCredential());

      expect(result).toEqual({
        valid: true,
        availableModels: ["claude-sonnet-4-20250514", "claude-haiku-4-5-20251001"],
      });
    });

    it("calls GET https://api.anthropic.com/v1/models with x-api-key header", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: [] }),
      } as unknown as Response);

      await provider.validate(fakeCredential({ secret: "sk-ant-my-key" }));

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://api.anthropic.com/v1/models");
      expect(init.method).toBe("GET");
      expect((init.headers as Record<string, string>)["x-api-key"]).toBe(
        "sk-ant-my-key",
      );
    });

    it("sends anthropic-version header", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: [] }),
      } as unknown as Response);

      await provider.validate(fakeCredential());

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(
        (init.headers as Record<string, string>)["anthropic-version"],
      ).toBeDefined();
    });

    it("uses baseUrl from credential when provided", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: [] }),
      } as unknown as Response);

      await provider.validate(
        fakeCredential({ baseUrl: "https://custom.anthropic.example.com" }),
      );

      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://custom.anthropic.example.com/v1/models");
    });

    it("returns { valid: false, reason } when models endpoint returns 401", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        json: () =>
          Promise.resolve({
            type: "error",
            error: { type: "authentication_error", message: "Invalid key" },
          }),
      } as unknown as Response);

      const result = await provider.validate(fakeCredential());

      expect(result.valid).toBe(false);
      expect(result.reason).toBeDefined();
      expect(typeof result.reason).toBe("string");
    });

    it("never returns the scaffold placeholder for a 200 response", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({ data: [{ id: "claude-sonnet-4-20250514" }] }),
      } as unknown as Response);

      const result = await provider.validate(fakeCredential());

      const isPlaceholder =
        result.valid === false && result.reason === "not_implemented";
      expect(isPlaceholder).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. analyzeStream()
  // ---------------------------------------------------------------------------

  describe("analyzeStream()", () => {
    it("calls POST https://api.anthropic.com/v1/messages with x-api-key header", async () => {
      fetchMock.mockResolvedValueOnce(mockAnthropicSseStream(["Hello"]));

      const params = fakeAnalyzeParams({ credential: fakeCredential({ secret: "sk-ant-stream-key" }) });
      const chunks: string[] = [];
      for await (const chunk of provider.analyzeStream(params)) {
        chunks.push(chunk.text);
      }

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://api.anthropic.com/v1/messages");
      expect(init.method).toBe("POST");
      expect((init.headers as Record<string, string>)["x-api-key"]).toBe(
        "sk-ant-stream-key",
      );
    });

    it("sends anthropic-version header", async () => {
      fetchMock.mockResolvedValueOnce(mockAnthropicSseStream(["Hi"]));

      const params = fakeAnalyzeParams();
      for await (const _ of provider.analyzeStream(params)) {
        // drain
      }

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(
        (init.headers as Record<string, string>)["anthropic-version"],
      ).toBeDefined();
    });

    it("sends stream: true and model in request body", async () => {
      fetchMock.mockResolvedValueOnce(mockAnthropicSseStream(["ok"]));

      const params = fakeAnalyzeParams({
        credential: fakeCredential({ model: "claude-haiku-4-5-20251001" }),
      });
      for await (const _ of provider.analyzeStream(params)) {
        // drain
      }

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string);
      expect(body.stream).toBe(true);
      expect(body.model).toBe("claude-haiku-4-5-20251001");
    });

    it("sends Content-Type: application/json", async () => {
      fetchMock.mockResolvedValueOnce(mockAnthropicSseStream(["Hi"]));

      const params = fakeAnalyzeParams();
      for await (const _ of provider.analyzeStream(params)) {
        // drain
      }

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
        "application/json",
      );
    });

    it("emits CompletionChunk per token in arrival order", async () => {
      fetchMock.mockResolvedValueOnce(
        mockAnthropicSseStream(["Hello", " world", "!"]),
      );

      const params = fakeAnalyzeParams();
      const chunks: string[] = [];
      for await (const chunk of provider.analyzeStream(params)) {
        chunks.push(chunk.text);
      }

      expect(chunks).toEqual(["Hello", " world", "!"]);
    });

    it("sends system prompt as top-level 'system' field (Anthropic Messages API)", async () => {
      fetchMock.mockResolvedValueOnce(mockAnthropicSseStream(["ok"]));

      const params = fakeAnalyzeParams({
        system: "You are a helpful assistant.",
      });
      for await (const _ of provider.analyzeStream(params)) {
        // drain
      }

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string);

      // Anthropic uses top-level "system", not a system message in the messages array
      expect(body.system).toBe("You are a helpful assistant.");
    });

    it("includes transcript context segments in messages array", async () => {
      fetchMock.mockResolvedValueOnce(mockAnthropicSseStream(["ok"]));

      const params = fakeAnalyzeParams();
      for await (const _ of provider.analyzeStream(params)) {
        // drain
      }

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string);
      const messageContent: string = JSON.stringify(body.messages);

      expect(messageContent).toContain("Hello everyone.");
      expect(messageContent).toContain("Hi, let's start.");
    });

    it("uses baseUrl from credential when provided", async () => {
      fetchMock.mockResolvedValueOnce(mockAnthropicSseStream(["ok"]));

      const params = fakeAnalyzeParams({
        credential: fakeCredential({
          baseUrl: "https://custom.anthropic.example.com",
        }),
      });
      for await (const _ of provider.analyzeStream(params)) {
        // drain
      }

      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(
        "https://custom.anthropic.example.com/v1/messages",
      );
    });

    it("uses model from credential when provided", async () => {
      fetchMock.mockResolvedValueOnce(mockAnthropicSseStream(["ok"]));

      const params = fakeAnalyzeParams({
        credential: fakeCredential({ model: "claude-haiku-4-5-20251001" }),
      });
      for await (const _ of provider.analyzeStream(params)) {
        // drain
      }

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string);
      expect(body.model).toBe("claude-haiku-4-5-20251001");
    });
  });

  // ---------------------------------------------------------------------------
  // 4. translate()
  // ---------------------------------------------------------------------------

  describe("translate()", () => {
    it("calls POST https://api.anthropic.com/v1/messages", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            content: [{ type: "text", text: "Ola mundo" }],
          }),
      } as unknown as Response);

      await provider.translate(fakeCredential(), "Hello world", "pt-BR");

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://api.anthropic.com/v1/messages");
      expect(init.method).toBe("POST");
    });

    it("sends x-api-key header instead of Authorization Bearer", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            content: [{ type: "text", text: "translated" }],
          }),
      } as unknown as Response);

      await provider.translate(
        fakeCredential({ secret: "sk-ant-translate-key" }),
        "test",
        "es",
      );

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect((init.headers as Record<string, string>)["x-api-key"]).toBe(
        "sk-ant-translate-key",
      );
    });

    it("sends anthropic-version header", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            content: [{ type: "text", text: "translated" }],
          }),
      } as unknown as Response);

      await provider.translate(fakeCredential(), "test", "es");

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(
        (init.headers as Record<string, string>)["anthropic-version"],
      ).toBeDefined();
    });

    it("returns the translated text from the response", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            content: [{ type: "text", text: "Ola mundo" }],
          }),
      } as unknown as Response);

      const result = await provider.translate(
        fakeCredential(),
        "Hello world",
        "pt-BR",
      );

      expect(result).toBe("Ola mundo");
    });

    it("includes targetLanguage in the request", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            content: [{ type: "text", text: "Hola mundo" }],
          }),
      } as unknown as Response);

      await provider.translate(fakeCredential(), "Hello world", "es");

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string);
      const messageContent: string = JSON.stringify(body.messages);

      expect(messageContent).toContain("es");
    });

    it("includes the source text in the request body", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            content: [{ type: "text", text: "result" }],
          }),
      } as unknown as Response);

      await provider.translate(fakeCredential(), "Hello world", "pt-BR");

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string);
      const messageContent: string = JSON.stringify(body.messages);

      expect(messageContent).toContain("Hello world");
    });

    it("uses baseUrl from credential when provided", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            content: [{ type: "text", text: "translated" }],
          }),
      } as unknown as Response);

      await provider.translate(
        fakeCredential({ baseUrl: "https://custom.anthropic.example.com" }),
        "test",
        "es",
      );

      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(
        "https://custom.anthropic.example.com/v1/messages",
      );
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Secret safety (ADR-003)
  // ---------------------------------------------------------------------------

  describe("secret safety", () => {
    it("secret never appears in error messages from validate()", async () => {
      const secret = "sk-ant-super-secret-should-not-leak";
      fetchMock.mockRejectedValueOnce(new Error("network failure"));

      try {
        await provider.validate(fakeCredential({ secret }));
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        expect(message).not.toContain(secret);
      }
    });

    it("secret never appears in error messages from analyzeStream()", async () => {
      const secret = "sk-ant-stream-secret-should-not-leak";
      fetchMock.mockRejectedValueOnce(new Error("connection refused"));

      try {
        const params = fakeAnalyzeParams({
          credential: fakeCredential({ secret }),
        });
        for await (const _ of provider.analyzeStream(params)) {
          // drain
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        expect(message).not.toContain(secret);
      }
    });

    it("secret never appears in error messages from translate()", async () => {
      const secret = "sk-ant-translate-secret-should-not-leak";
      fetchMock.mockRejectedValueOnce(new Error("timeout"));

      try {
        await provider.translate(fakeCredential({ secret }), "hi", "es");
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        expect(message).not.toContain(secret);
      }
    });

    it("secret is never included in query strings", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: [] }),
      } as unknown as Response);

      const secret = "sk-ant-query-leak-test";
      await provider.validate(fakeCredential({ secret }));

      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).not.toContain(secret);
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Capability tests
  // ---------------------------------------------------------------------------

  describe("capabilities", () => {
    it("analysis is declared true and analyzeStream does not throw CapabilityNotSupported", async () => {
      expect(provider.capabilities.analysis).toBe(true);

      fetchMock.mockResolvedValueOnce(mockAnthropicSseStream(["ok"]));

      const params = fakeAnalyzeParams();
      const chunks: string[] = [];
      for await (const chunk of provider.analyzeStream(params)) {
        chunks.push(chunk.text);
      }
      expect(chunks.length).toBeGreaterThan(0);
    });

    it("transcription is declared false (Anthropic has no STT endpoint per RF-301)", () => {
      expect(provider.capabilities.transcription).toBe(false);
    });

    it("translation is declared true and translate does not throw CapabilityNotSupported", async () => {
      expect(provider.capabilities.translation).toBe(true);

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            content: [{ type: "text", text: "translated" }],
          }),
      } as unknown as Response);

      const result = await provider.translate(
        fakeCredential(),
        "test",
        "es",
      );
      expect(typeof result).toBe("string");
    });
  });

  // ---------------------------------------------------------------------------
  // 7. Registry
  // ---------------------------------------------------------------------------

  describe("registry", () => {
    it("getProvider('ANTHROPIC') returns an AnthropicProvider instance", async () => {
      const { getProvider } = await import("./registry.js");
      const p = getProvider("ANTHROPIC");
      expect(p).toBeInstanceOf(AnthropicProvider);
      expect(p.kind).toBe("ANTHROPIC");
    });

    it("getProvider('ANTHROPIC') returns a substitutable AiProvider (SOLID L)", async () => {
      const { getProvider } = await import("./registry.js");
      const p = getProvider("ANTHROPIC");

      expect(typeof p.validate).toBe("function");
      expect(typeof p.analyzeStream).toBe("function");
      expect(typeof p.translate).toBe("function");
      expect(p.capabilities).toBeDefined();
    });
  });
});
