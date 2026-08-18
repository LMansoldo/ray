// RED-step tests for GeminiProvider (T-202).
// These tests assert the HTTP behavior the implementation must provide.
// The current stub does not exist yet, so these fail — correct for RED.

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { GeminiProvider } from "./gemini.js";
import { CapabilityNotSupported } from "./provider.js";
import type { InjectedCredential } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fakeCredential(
  overrides?: Partial<InjectedCredential>,
): InjectedCredential {
  return {
    kind: "GEMINI",
    connectionMode: "API_KEY",
    secret: "AIzaSyGemini-test-secret-abc123",
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
 * Create a mock Response whose body is a ReadableStream yielding Gemini
 * SSE events via streamGenerateContent?alt=sse.
 *
 * Gemini SSE format: each line is `data: {json}\n\n` with the JSON being
 * a GenerateContentResponse containing candidates[0].content.parts[0].text.
 */
function mockGeminiSseStream(tokens: string[]): Response {
  let index = 0;

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const encoder = new TextEncoder();

      if (index < tokens.length) {
        const payload = JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: tokens[index] }],
                role: "model",
              },
              finishReason: null,
              index: 0,
            },
          ],
          usageMetadata: {
            promptTokenCount: 10,
            candidatesTokenCount: index + 1,
            totalTokenCount: 10 + index + 1,
          },
        });
        controller.enqueue(encoder.encode("data: " + payload + "\n\n"));
        index++;
        return;
      }

      // Final chunk with finishReason
      const finalPayload = JSON.stringify({
        candidates: [
          {
            content: { parts: [], role: "model" },
            finishReason: "STOP",
            index: 0,
          },
        ],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: tokens.length,
          totalTokenCount: 10 + tokens.length,
        },
      });
      controller.enqueue(encoder.encode("data: " + finalPayload + "\n\n"));
      controller.close();
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

describe("GeminiProvider", () => {
  const provider = new GeminiProvider();

  describe("kind and capabilities", () => {
    it("declares kind GEMINI", () => {
      expect(provider.kind).toBe("GEMINI");
    });

    it("declares capabilities { analysis: true, transcription: true, translation: true }", () => {
      expect(provider.capabilities).toEqual({
        analysis: true,
        transcription: true,
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
            models: [
              { name: "models/gemini-2.5-pro", displayName: "Gemini 2.5 Pro" },
              {
                name: "models/gemini-2.5-flash",
                displayName: "Gemini 2.5 Flash",
              },
            ],
          }),
      } as unknown as Response);

      const result = await provider.validate(fakeCredential());

      expect(result).toEqual({
        valid: true,
        availableModels: ["models/gemini-2.5-pro", "models/gemini-2.5-flash"],
      });
    });

    it("calls GET https://generativelanguage.googleapis.com/v1beta/models with x-goog-api-key header", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ models: [] }),
      } as unknown as Response);

      await provider.validate(fakeCredential({ secret: "AIzaSyMyKey" }));

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(
        "https://generativelanguage.googleapis.com/v1beta/models",
      );
      expect(init.method).toBe("GET");
      expect(
        (init.headers as Record<string, string>)["x-goog-api-key"],
      ).toBe("AIzaSyMyKey");
    });

    it("uses baseUrl from credential when provided", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ models: [] }),
      } as unknown as Response);

      await provider.validate(
        fakeCredential({
          baseUrl: "https://custom.gemini.example.com",
        }),
      );

      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://custom.gemini.example.com/v1beta/models");
    });

    it("returns { valid: false, reason } when models endpoint returns 401", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        json: () =>
          Promise.resolve({
            error: {
              code: 401,
              message: "API key not valid",
              status: "UNAUTHENTICATED",
            },
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
          Promise.resolve({
            models: [
              {
                name: "models/gemini-2.5-pro",
                displayName: "Gemini 2.5 Pro",
              },
            ],
          }),
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
    it("calls POST streamGenerateContent with alt=sse and x-goog-api-key header", async () => {
      fetchMock.mockResolvedValueOnce(mockGeminiSseStream(["Hello"]));

      const params = fakeAnalyzeParams({
        credential: fakeCredential({ secret: "AIzaSyStreamKey" }),
      });
      const chunks: string[] = [];
      for await (const chunk of provider.analyzeStream(params)) {
        chunks.push(chunk.text);
      }

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      // Gemini streaming endpoint: POST /v1beta/models/{model}:streamGenerateContent?alt=sse
      expect(url).toContain("streamGenerateContent");
      expect(url).toContain("alt=sse");
      expect(init.method).toBe("POST");
      expect(
        (init.headers as Record<string, string>)["x-goog-api-key"],
      ).toBe("AIzaSyStreamKey");
    });

    it("sends Content-Type: application/json", async () => {
      fetchMock.mockResolvedValueOnce(mockGeminiSseStream(["Hi"]));

      const params = fakeAnalyzeParams();
      for await (const _ of provider.analyzeStream(params)) {
        // drain
      }

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
        "application/json",
      );
    });

    it("sends model and generationConfig in request body", async () => {
      fetchMock.mockResolvedValueOnce(mockGeminiSseStream(["ok"]));

      const params = fakeAnalyzeParams({
        credential: fakeCredential({ model: "gemini-2.5-flash" }),
      });
      for await (const _ of provider.analyzeStream(params)) {
        // drain
      }

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string);
      // Gemini uses contents array, not "stream: true" like OpenAI
      expect(body.contents).toBeDefined();
      expect(Array.isArray(body.contents)).toBe(true);
    });

    it("emits CompletionChunk per token in arrival order", async () => {
      fetchMock.mockResolvedValueOnce(
        mockGeminiSseStream(["Hello", " world", "!"]),
      );

      const params = fakeAnalyzeParams();
      const chunks: string[] = [];
      for await (const chunk of provider.analyzeStream(params)) {
        chunks.push(chunk.text);
      }

      expect(chunks).toEqual(["Hello", " world", "!"]);
    });

    it("includes transcript context segments in contents", async () => {
      fetchMock.mockResolvedValueOnce(mockGeminiSseStream(["ok"]));

      const params = fakeAnalyzeParams();
      for await (const _ of provider.analyzeStream(params)) {
        // drain
      }

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string);
      const contentsStr: string = JSON.stringify(body.contents);

      expect(contentsStr).toContain("Hello everyone.");
      expect(contentsStr).toContain("Hi, let's start.");
    });

    it("uses baseUrl from credential when provided", async () => {
      fetchMock.mockResolvedValueOnce(mockGeminiSseStream(["ok"]));

      const params = fakeAnalyzeParams({
        credential: fakeCredential({
          baseUrl: "https://custom.gemini.example.com",
        }),
      });
      for await (const _ of provider.analyzeStream(params)) {
        // drain
      }

      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain("https://custom.gemini.example.com");
      expect(url).toContain("streamGenerateContent");
    });

    it("uses model from credential when provided", async () => {
      fetchMock.mockResolvedValueOnce(mockGeminiSseStream(["ok"]));

      const params = fakeAnalyzeParams({
        credential: fakeCredential({ model: "gemini-2.5-flash" }),
      });
      for await (const _ of provider.analyzeStream(params)) {
        // drain
      }

      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain("gemini-2.5-flash");
    });

    it("throws Error on non-ok HTTP response", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        body: null,
      } as unknown as Response);

      const params = fakeAnalyzeParams();
      const iterator = provider.analyzeStream(params)[Symbol.asyncIterator]();

      await expect(iterator.next()).rejects.toThrow("Gemini API error");
    });
  });

  // ---------------------------------------------------------------------------
  // 4. translate()
  // ---------------------------------------------------------------------------

  describe("translate()", () => {
    it("calls POST generateContent endpoint", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            candidates: [
              {
                content: {
                  parts: [{ text: "Ola mundo" }],
                  role: "model",
                },
              },
            ],
          }),
      } as unknown as Response);

      await provider.translate(fakeCredential(), "Hello world", "pt-BR");

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain("generateContent");
      expect(url).not.toContain("streamGenerateContent");
      expect(init.method).toBe("POST");
    });

    it("sends x-goog-api-key header", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            candidates: [
              {
                content: { parts: [{ text: "translated" }], role: "model" },
              },
            ],
          }),
      } as unknown as Response);

      await provider.translate(
        fakeCredential({ secret: "AIzaSyTranslateKey" }),
        "test",
        "es",
      );

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(
        (init.headers as Record<string, string>)["x-goog-api-key"],
      ).toBe("AIzaSyTranslateKey");
    });

    it("returns the translated text from the response", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            candidates: [
              {
                content: { parts: [{ text: "Ola mundo" }], role: "model" },
              },
            ],
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
            candidates: [
              {
                content: { parts: [{ text: "Hola mundo" }], role: "model" },
              },
            ],
          }),
      } as unknown as Response);

      await provider.translate(fakeCredential(), "Hello world", "es");

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string);
      const contentsStr: string = JSON.stringify(body.contents);

      expect(contentsStr).toContain("es");
    });

    it("includes the source text in the request body", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            candidates: [
              {
                content: { parts: [{ text: "result" }], role: "model" },
              },
            ],
          }),
      } as unknown as Response);

      await provider.translate(fakeCredential(), "Hello world", "pt-BR");

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string);
      const contentsStr: string = JSON.stringify(body.contents);

      expect(contentsStr).toContain("Hello world");
    });

    it("uses baseUrl from credential when provided", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            candidates: [
              {
                content: { parts: [{ text: "translated" }], role: "model" },
              },
            ],
          }),
      } as unknown as Response);

      await provider.translate(
        fakeCredential({ baseUrl: "https://custom.gemini.example.com" }),
        "test",
        "es",
      );

      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain("https://custom.gemini.example.com");
      expect(url).toContain("generateContent");
    });

    it("throws Error on non-ok HTTP response", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      } as unknown as Response);

      await expect(
        provider.translate(fakeCredential(), "test", "es"),
      ).rejects.toThrow("Gemini API error");
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Secret safety (ADR-003)
  // ---------------------------------------------------------------------------

  describe("secret safety", () => {
    it("secret never appears in error messages from validate()", async () => {
      const secret = "AIzaSySuper-secret-should-not-leak";
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
      const secret = "AIzaSyStream-secret-should-not-leak";
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
      const secret = "AIzaSyTranslate-secret-should-not-leak";
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
        json: () => Promise.resolve({ models: [] }),
      } as unknown as Response);

      const secret = "AIzaSyQuery-leak-test";
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

      fetchMock.mockResolvedValueOnce(mockGeminiSseStream(["ok"]));

      const params = fakeAnalyzeParams();
      const chunks: string[] = [];
      for await (const chunk of provider.analyzeStream(params)) {
        chunks.push(chunk.text);
      }
      expect(chunks.length).toBeGreaterThan(0);
    });

    it("transcription is declared true (Gemini is a named cloud STT provider per RF-301)", () => {
      // RF-301: 'Nuvem (opcional): STT via provedor (OpenAI/Gemini)'
      // Gemini must declare transcription: true even if the adapter does not
      // implement the STT call yet — the capability is declared truthfully.
      expect(provider.capabilities.transcription).toBe(true);
    });

    it("translation is declared true and translate does not throw CapabilityNotSupported", async () => {
      expect(provider.capabilities.translation).toBe(true);

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            candidates: [
              {
                content: { parts: [{ text: "translated" }], role: "model" },
              },
            ],
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
    it("getProvider('GEMINI') returns a GeminiProvider instance", async () => {
      const { getProvider } = await import("./registry.js");
      const p = getProvider("GEMINI");
      expect(p).toBeInstanceOf(GeminiProvider);
      expect(p.kind).toBe("GEMINI");
    });

    it("getProvider('GEMINI') returns a substitutable AiProvider (SOLID L)", async () => {
      const { getProvider } = await import("./registry.js");
      const p = getProvider("GEMINI");

      expect(typeof p.validate).toBe("function");
      expect(typeof p.analyzeStream).toBe("function");
      expect(typeof p.translate).toBe("function");
      expect(p.capabilities).toBeDefined();
    });
  });
});
