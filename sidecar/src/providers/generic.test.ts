// RED-step tests for GenericProvider (T-205).
// These tests assert the HTTP behavior the implementation must provide.
// The current stubs never call fetch, so these fail — that is correct for RED.

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { GenericProvider } from "./generic.js";
import { CapabilityNotSupported } from "./provider.js";
import type { InjectedCredential } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fakeCredential(overrides?: Partial<InjectedCredential>): InjectedCredential {
  return {
    kind: "GENERIC",
    connectionMode: "COMPATIBLE_ENDPOINT",
    secret: "sk-gen-test-secret-abc123",
    baseUrl: "https://my-vllm.local:8080",
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
 * Create a mock Response whose body is a ReadableStream yielding SSE chunks
 * one token at a time with small delays — simulates real streaming.
 */
function mockSseStreamResponse(tokens: string[]): Response {
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (index < tokens.length) {
        const payload = JSON.stringify({ choices: [{ delta: { content: tokens[index] } }] });
        const line = "data: " + payload + "\n\n";
        controller.enqueue(new TextEncoder().encode(line));
        index++;
      } else {
        controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
        controller.close();
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

describe("GenericProvider", () => {
  const provider = new GenericProvider();

  describe("kind and capabilities", () => {
    it("declares kind GENERIC", () => {
      expect(provider.kind).toBe("GENERIC");
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
    it("calls GET {baseUrl}/v1/models with Bearer auth header", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: [] }),
      } as unknown as Response);

      await provider.validate(fakeCredential({ secret: "sk-gen-my-key" }));

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://my-vllm.local:8080/v1/models");
      expect(init.method).toBe("GET");
      expect((init.headers as Record<string, string>).Authorization).toBe(
        "Bearer sk-gen-my-key",
      );
    });

    it("returns { valid: true, availableModels } when models endpoint returns 200", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            data: [{ id: "llama-3-8b" }, { id: "mistral-7b" }],
          }),
      } as unknown as Response);

      const result = await provider.validate(fakeCredential());

      expect(result).toEqual({
        valid: true,
        availableModels: ["llama-3-8b", "mistral-7b"],
      });
    });

    it("uses baseUrl from credential — never a hardcoded default", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: [] }),
      } as unknown as Response);

      await provider.validate(
        fakeCredential({ baseUrl: "https://localai.custom:3000" }),
      );

      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://localai.custom:3000/v1/models");
    });

    it("returns { valid: false, reason } when models endpoint returns 401", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        json: () =>
          Promise.resolve({
            error: { message: "Invalid API key" },
          }),
      } as unknown as Response);

      const result = await provider.validate(fakeCredential());

      expect(result.valid).toBe(false);
      expect(result.reason).toBeDefined();
      expect(typeof result.reason).toBe("string");
    });

    it("returns { valid: false, reason } when baseUrl is missing (no throw)", async () => {
      const result = await provider.validate(
        fakeCredential({ baseUrl: undefined }),
      );

      expect(result.valid).toBe(false);
      expect(result.reason).toBeDefined();
      expect(typeof result.reason).toBe("string");
      // Must not throw — returns a result object
    });

    it("never returns the scaffold placeholder { valid: false, reason: 'not_implemented' } for a 200 response", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: [{ id: "llama-3-8b" }] }),
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
    it("calls POST {baseUrl}/v1/chat/completions with stream: true", async () => {
      fetchMock.mockResolvedValueOnce(mockSseStreamResponse(["Hello"]));

      const params = fakeAnalyzeParams();
      const chunks: string[] = [];
      for await (const chunk of provider.analyzeStream(params)) {
        chunks.push(chunk.text);
      }

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://my-vllm.local:8080/v1/chat/completions");
      expect(init.method).toBe("POST");

      const body = JSON.parse(init.body as string);
      expect(body.stream).toBe(true);
    });

    it("sends Authorization: Bearer <secret> header", async () => {
      fetchMock.mockResolvedValueOnce(mockSseStreamResponse(["Hi"]));

      const params = fakeAnalyzeParams({
        credential: fakeCredential({ secret: "sk-gen-stream-key" }),
      });
      for await (const _ of provider.analyzeStream(params)) {
        // drain
      }

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect((init.headers as Record<string, string>).Authorization).toBe(
        "Bearer sk-gen-stream-key",
      );
    });

    it("sends Content-Type: application/json", async () => {
      fetchMock.mockResolvedValueOnce(mockSseStreamResponse(["Hi"]));

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
        mockSseStreamResponse(["Hello", " world", "!"]),
      );

      const params = fakeAnalyzeParams();
      const chunks: string[] = [];
      for await (const chunk of provider.analyzeStream(params)) {
        chunks.push(chunk.text);
      }

      expect(chunks).toEqual(["Hello", " world", "!"]);
    });

    it("builds messages array with system prompt and transcript context", async () => {
      fetchMock.mockResolvedValueOnce(mockSseStreamResponse(["ok"]));

      const params = fakeAnalyzeParams({
        system: "You are a helpful assistant.",
        userPrompt: "Summarize this.",
      });
      for await (const _ of provider.analyzeStream(params)) {
        // drain
      }

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string);

      expect(body.messages).toBeDefined();
      expect(Array.isArray(body.messages)).toBe(true);

      const systemMsg = body.messages.find(
        (m: { role: string }) => m.role === "system",
      );
      expect(systemMsg).toBeDefined();
      expect(systemMsg.content).toBe("You are a helpful assistant.");
    });

    it("includes transcript context segments in messages", async () => {
      fetchMock.mockResolvedValueOnce(mockSseStreamResponse(["ok"]));

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

    it("uses baseUrl from credential — never a hardcoded default", async () => {
      fetchMock.mockResolvedValueOnce(mockSseStreamResponse(["ok"]));

      const params = fakeAnalyzeParams({
        credential: fakeCredential({
          baseUrl: "https://self-hosted-llm.example.com:9090",
        }),
      });
      for await (const _ of provider.analyzeStream(params)) {
        // drain
      }

      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(
        "https://self-hosted-llm.example.com:9090/v1/chat/completions",
      );
    });

    it("uses model from credential when provided", async () => {
      fetchMock.mockResolvedValueOnce(mockSseStreamResponse(["ok"]));

      const params = fakeAnalyzeParams({
        credential: fakeCredential({ model: "llama-3-70b" }),
      });
      for await (const _ of provider.analyzeStream(params)) {
        // drain
      }

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string);
      expect(body.model).toBe("llama-3-70b");
    });

    it("uses default model when credential has no model", async () => {
      fetchMock.mockResolvedValueOnce(mockSseStreamResponse(["ok"]));

      const params = fakeAnalyzeParams({
        credential: fakeCredential({ model: undefined }),
      });
      for await (const _ of provider.analyzeStream(params)) {
        // drain
      }

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string);
      expect(body.model).toBeDefined();
      expect(typeof body.model).toBe("string");
      expect(body.model.length).toBeGreaterThan(0);
    });

    it("throws when baseUrl is missing (cannot construct endpoint)", async () => {
      const params = fakeAnalyzeParams({
        credential: fakeCredential({ baseUrl: undefined }),
      });

      await expect(async () => {
        for await (const _ of provider.analyzeStream(params)) {
          // drain
        }
      }).rejects.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // 4. translate()
  // ---------------------------------------------------------------------------

  describe("translate()", () => {
    it("calls POST {baseUrl}/v1/chat/completions", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            choices: [{ message: { content: "Ola mundo" } }],
          }),
      } as unknown as Response);

      await provider.translate(fakeCredential(), "Hello world", "pt-BR");

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://my-vllm.local:8080/v1/chat/completions");
      expect(init.method).toBe("POST");
    });

    it("sends Authorization: Bearer <secret> header", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            choices: [{ message: { content: "translated" } }],
          }),
      } as unknown as Response);

      await provider.translate(
        fakeCredential({ secret: "sk-gen-translate-key" }),
        "test",
        "es",
      );

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect((init.headers as Record<string, string>).Authorization).toBe(
        "Bearer sk-gen-translate-key",
      );
    });

    it("returns the translated text from the response", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            choices: [{ message: { content: "Ola mundo" } }],
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
            choices: [{ message: { content: "Hola mundo" } }],
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
            choices: [{ message: { content: "result" } }],
          }),
      } as unknown as Response);

      await provider.translate(fakeCredential(), "Hello world", "pt-BR");

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string);
      const messageContent: string = JSON.stringify(body.messages);

      expect(messageContent).toContain("Hello world");
    });

    it("uses baseUrl from credential — never a hardcoded default", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            choices: [{ message: { content: "translated" } }],
          }),
      } as unknown as Response);

      await provider.translate(
        fakeCredential({ baseUrl: "https://custom-generic.example.com" }),
        "test",
        "es",
      );

      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(
        "https://custom-generic.example.com/v1/chat/completions",
      );
    });

    it("sends stream: false in the request body", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            choices: [{ message: { content: "translated" } }],
          }),
      } as unknown as Response);

      await provider.translate(fakeCredential(), "test", "es");

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string);
      expect(body.stream).toBe(false);
    });

    it("throws when baseUrl is missing (cannot construct endpoint)", async () => {
      await expect(
        provider.translate(
          fakeCredential({ baseUrl: undefined }),
          "test",
          "es",
        ),
      ).rejects.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Secret safety (ADR-003)
  // ---------------------------------------------------------------------------

  describe("secret safety", () => {
    it("secret never appears in error messages from validate()", async () => {
      const secret = "sk-gen-super-secret-key-should-not-leak";
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
      const secret = "sk-gen-stream-secret-should-not-leak";
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
      const secret = "sk-gen-translate-secret-should-not-leak";
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

      const secret = "sk-gen-query-leak-test";
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

      fetchMock.mockResolvedValueOnce(mockSseStreamResponse(["ok"]));

      const params = fakeAnalyzeParams();
      const chunks: string[] = [];
      for await (const chunk of provider.analyzeStream(params)) {
        chunks.push(chunk.text);
      }
      expect(chunks.length).toBeGreaterThan(0);
    });

    it("transcription is declared false (self-hosted endpoints have no STT)", () => {
      expect(provider.capabilities.transcription).toBe(false);
    });

    it("translation is declared true and translate does not throw CapabilityNotSupported", async () => {
      expect(provider.capabilities.translation).toBe(true);

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            choices: [{ message: { content: "translated" } }],
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
    it("getProvider('GENERIC') returns a GenericProvider instance", async () => {
      const { getProvider } = await import("./registry.js");
      const p = getProvider("GENERIC");
      expect(p).toBeInstanceOf(GenericProvider);
      expect(p.kind).toBe("GENERIC");
    });

    it("getProvider('GENERIC') returns a substitutable AiProvider (SOLID L)", async () => {
      const { getProvider } = await import("./registry.js");
      const p = getProvider("GENERIC");

      expect(typeof p.validate).toBe("function");
      expect(typeof p.analyzeStream).toBe("function");
      expect(typeof p.translate).toBe("function");
      expect(p.capabilities).toBeDefined();
    });
  });
});
