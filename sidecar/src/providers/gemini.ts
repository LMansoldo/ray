// Adapter Gemini — validate / analyzeStream / translate contra a API Gemini.
// Endpoints: GET /v1beta/models (validate), POST /v1beta/models/{model}:streamGenerateContent?alt=sse (stream),
// POST /v1beta/models/{model}:generateContent (translate).
// NÃO alterar a assinatura da interface AiProvider (ADR-006).

import {
  type AiProvider,
  type AnalyzeParams,
  type CompletionChunk,
  type ProviderCapabilities,
} from "./provider.js";
import type {
  InjectedCredential,
  ProviderKind,
  TranscriptContextSegment,
} from "./types.js";

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com";
const DEFAULT_MODEL = "gemini-2.5-pro";

function buildBaseUrl(credential: InjectedCredential): string {
  return credential.baseUrl ?? DEFAULT_BASE_URL;
}

function geminiHeaders(secret: string): Record<string, string> {
  return {
    "x-goog-api-key": secret,
    "Content-Type": "application/json",
  };
}

function buildContextBlock(context: TranscriptContextSegment[]): string {
  return context
    .map((segment) => "[" + segment.speaker + "] " + segment.text)
    .join("\n");
}

type GeminiPart = { text: string } | { inline_data: { mime_type: string; data: string } };

function buildContents(
  system: string,
  context: TranscriptContextSegment[],
  userPrompt?: string,
  screenshots?: string[],
): Array<{ role: string; parts: Array<GeminiPart> }> {
  const contextBlock = buildContextBlock(context);
  let userContent = system;
  if (contextBlock.length > 0) {
    userContent += "\n\nTranscript context:\n" + contextBlock;
  }
  if (userPrompt) {
    userContent += "\n\n" + userPrompt;
  }
  const parts: GeminiPart[] = [{ text: userContent }];
  for (const shot of screenshots ?? []) {
    const match = /^data:(image\/[a-zA-Z+]+);base64,(.+)$/.exec(shot);
    if (match) {
      parts.push({
        inline_data: { mime_type: match[1], data: match[2] },
      });
    }
  }
  return [{ role: "user", parts }];
}

export class GeminiProvider implements AiProvider {
  readonly kind: ProviderKind = "GEMINI";
  readonly capabilities: ProviderCapabilities = {
    analysis: true,
    transcription: true,
    translation: true,
  };

  async validate(credential: InjectedCredential): Promise<{
    valid: boolean;
    availableModels?: string[];
    reason?: string;
  }> {
    const baseUrl = buildBaseUrl(credential);
    const url = baseUrl + "/v1beta/models";

    const response = await fetch(url, {
      method: "GET",
      headers: geminiHeaders(credential.secret),
    });

    if (response.ok) {
      const body = (await response.json()) as {
        models: Array<{ name: string }>;
      };
      const availableModels = body.models.map((m) => m.name);
      return { valid: true, availableModels };
    }

    if (response.status === 401) {
      return { valid: false, reason: "Unauthorized: invalid API key" };
    }

    return { valid: false, reason: "HTTP " + response.status };
  }

  async *analyzeStream(
    params: AnalyzeParams,
  ): AsyncIterable<CompletionChunk> {
    const baseUrl = buildBaseUrl(params.credential);
    const model = params.credential.model ?? DEFAULT_MODEL;
    const url =
      baseUrl +
      "/v1beta/models/" +
      model +
      ":streamGenerateContent?alt=sse";

    const body = {
      contents: buildContents(
        params.system,
        params.context,
        params.userPrompt,
        params.screenshots,
      ),
    };

    const response = await fetch(url, {
      method: "POST",
      headers: geminiHeaders(params.credential.secret),
      body: JSON.stringify(body),
    });

    if (!response.ok || !response.body) {
      throw new Error("Gemini API error: HTTP " + response.status);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;

          const payload = trimmed.slice("data: ".length);

          try {
            const parsed = JSON.parse(payload) as {
              candidates?: Array<{
                content?: { parts?: Array<{ text?: string }> };
              }>;
            };
            const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text !== undefined && text !== null) {
              yield { text };
            }
          } catch {
            // Skip malformed JSON lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async translate(
    credential: InjectedCredential,
    text: string,
    targetLanguage: string,
  ): Promise<string> {
    const baseUrl = buildBaseUrl(credential);
    const model = credential.model ?? DEFAULT_MODEL;
    const url = baseUrl + "/v1beta/models/" + model + ":generateContent";

    const body = {
      contents: [
        {
          role: "user",
          parts: [
            {
              text:
                "You are a translation assistant. Translate the user's text to " +
                targetLanguage +
                ". Return only the translated text, nothing else.\n\n" +
                text,
            },
          ],
        },
      ],
    };

    const response = await fetch(url, {
      method: "POST",
      headers: geminiHeaders(credential.secret),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error("Gemini API error: HTTP " + response.status);
    }

    const result = (await response.json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    return result.candidates[0].content.parts[0].text;
  }
}
