// Adapter Anthropic — validate / analyzeStream / translate contra a API Anthropic.
// Endpoints: GET /v1/models (validate), POST /v1/messages (stream + translate).
// NÃO alterar a assinatura da interface AiProvider (ADR-006).

import {
  type AiProvider,
  type AnalyzeParams,
  type CompletionChunk,
  type ProviderCapabilities,
  CapabilityNotSupported,
} from "./provider.js";
import type {
  InjectedCredential,
  ProviderKind,
  TranscriptContextSegment,
} from "./types.js";

const DEFAULT_BASE_URL = "https://api.anthropic.com";
const DEFAULT_MODEL = "claude-sonnet-5";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MAX_TOKENS = 4096;

function buildBaseUrl(credential: InjectedCredential): string {
  return credential.baseUrl ?? DEFAULT_BASE_URL;
}

function anthropicHeaders(secret: string): Record<string, string> {
  return {
    "x-api-key": secret,
    "anthropic-version": ANTHROPIC_VERSION,
    "Content-Type": "application/json",
  };
}

function buildContextBlock(context: TranscriptContextSegment[]): string {
  return context
    .map((segment) => "[" + segment.speaker + "] " + segment.text)
    .join("\n");
}

function buildMessages(
  context: TranscriptContextSegment[],
  userPrompt?: string,
): Array<{ role: string; content: string }> {
  const messages: Array<{ role: string; content: string }> = [];

  const contextBlock = buildContextBlock(context);
  if (contextBlock.length > 0) {
    let userContent = "Transcript context:\n" + contextBlock;
    if (userPrompt) {
      userContent += "\n\n" + userPrompt;
    }
    messages.push({ role: "user", content: userContent });
  } else if (userPrompt) {
    messages.push({ role: "user", content: userPrompt });
  }

  if (messages.length === 0) {
    messages.push({ role: "user", content: "" });
  }

  return messages;
}

export class AnthropicProvider implements AiProvider {
  readonly kind: ProviderKind = "ANTHROPIC";
  readonly capabilities: ProviderCapabilities = {
    analysis: true,
    transcription: false,
    translation: true,
  };

  async validate(credential: InjectedCredential): Promise<{
    valid: boolean;
    availableModels?: string[];
    reason?: string;
  }> {
    const baseUrl = buildBaseUrl(credential);
    const url = baseUrl + "/v1/models";

    const response = await fetch(url, {
      method: "GET",
      headers: anthropicHeaders(credential.secret),
    });

    if (response.ok) {
      const body = (await response.json()) as { data: Array<{ id: string }> };
      const availableModels = body.data.map((m) => m.id);
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
    if (!this.capabilities.analysis) {
      throw new CapabilityNotSupported(this.kind, "analysis");
    }

    const baseUrl = buildBaseUrl(params.credential);
    const url = baseUrl + "/v1/messages";
    const model = params.credential.model ?? DEFAULT_MODEL;

    const body = {
      model,
      max_tokens: DEFAULT_MAX_TOKENS,
      stream: true,
      system: params.system,
      messages: buildMessages(params.context, params.userPrompt),
    };

    const response = await fetch(url, {
      method: "POST",
      headers: anthropicHeaders(params.credential.secret),
      body: JSON.stringify(body),
    });

    if (!response.ok || !response.body) {
      throw new Error("Anthropic API error: HTTP " + response.status);
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
              type?: string;
              delta?: { type?: string; text?: string };
            };
            if (
              parsed.type === "content_block_delta" &&
              parsed.delta?.type === "text_delta" &&
              parsed.delta.text !== undefined
            ) {
              yield { text: parsed.delta.text };
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
    const url = baseUrl + "/v1/messages";
    const model = credential.model ?? DEFAULT_MODEL;

    const body = {
      model,
      max_tokens: DEFAULT_MAX_TOKENS,
      stream: false,
      system:
        "You are a translation assistant. Translate the user's text to " +
        targetLanguage +
        ". Return only the translated text, nothing else.",
      messages: [
        {
          role: "user",
          content:
            "Translate the following text to " +
            targetLanguage +
            ":\n\n" +
            text,
        },
      ],
    };

    const response = await fetch(url, {
      method: "POST",
      headers: anthropicHeaders(credential.secret),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error("Anthropic API error: HTTP " + response.status);
    }

    const result = (await response.json()) as {
      content: Array<{ type: string; text: string }>;
    };
    return result.content[0].text;
  }
}
