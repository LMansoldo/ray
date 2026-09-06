// Adapter OpenAI — validate / analyzeStream / translate contra a API OpenAI.
// Endpoints: GET /v1/models (validate), POST /v1/chat/completions (stream + translate).
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

const DEFAULT_BASE_URL = "https://api.openai.com";

function buildBaseUrl(credential: InjectedCredential): string {
  return credential.baseUrl ?? DEFAULT_BASE_URL;
}

function authHeaders(secret: string): Record<string, string> {
  return {
    Authorization: "Bearer " + secret,
    "Content-Type": "application/json",
  };
}

function buildContextBlock(context: TranscriptContextSegment[]): string {
  return context
    .map((segment) => "[" + segment.speaker + "] " + segment.text)
    .join("\n");
}

type OpenAiContent =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

function buildMessages(
  system: string,
  context: TranscriptContextSegment[],
  userPrompt?: string,
  screenshots?: string[],
): Array<{ role: string; content: string | OpenAiContent[] }> {
  const messages: Array<{ role: string; content: string | OpenAiContent[] }> = [];

  messages.push({ role: "system", content: system });

  const contextBlock = buildContextBlock(context);
  let userContent = "";
  if (contextBlock.length > 0) {
    userContent = "Transcript context:\n" + contextBlock;
    if (userPrompt) {
      userContent += "\n\n" + userPrompt;
    }
  } else if (userPrompt) {
    userContent = userPrompt;
  }

  // Visão (RF-332): capturas de tela entram como image_url no turno do user.
  const images: OpenAiContent[] = (screenshots ?? []).map((url) => ({
    type: "image_url",
    image_url: { url },
  }));
  if (images.length > 0) {
    const parts: OpenAiContent[] = [{ type: "text", text: userContent }];
    parts.push(...images);
    messages.push({ role: "user", content: parts });
  } else if (userContent !== "") {
    messages.push({ role: "user", content: userContent });
  }

  return messages;
}

export class OpenAiProvider implements AiProvider {
  readonly kind: ProviderKind = "OPENAI";
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
    const url = baseUrl + "/v1/models";

    const response = await fetch(url, {
      method: "GET",
      headers: authHeaders(credential.secret),
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
    const url = baseUrl + "/v1/chat/completions";
    const model = params.credential.model ?? "gpt-4o";

    const body = {
      model,
      stream: true,
      messages: buildMessages(
        params.system,
        params.context,
        params.userPrompt,
        params.screenshots,
      ),
    };

    const response = await fetch(url, {
      method: "POST",
      headers: authHeaders(params.credential.secret),
      body: JSON.stringify(body),
    });

    if (!response.ok || !response.body) {
      throw new Error("OpenAI API error: HTTP " + response.status);
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
          if (payload === "[DONE]") return;

          try {
            const parsed = JSON.parse(payload) as {
              choices?: Array<{ delta?: { content?: string } }>;
            };
            const content = parsed.choices?.[0]?.delta?.content;
            if (content !== undefined && content !== null) {
              yield { text: content };
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
    const url = baseUrl + "/v1/chat/completions";
    const model = credential.model ?? "gpt-4o";

    const body = {
      model,
      stream: false,
      messages: [
        {
          role: "system",
          content:
            "You are a translation assistant. Translate the user's text to " +
            targetLanguage +
            ". Return only the translated text, nothing else.",
        },
        { role: "user", content: text },
      ],
    };

    const response = await fetch(url, {
      method: "POST",
      headers: authHeaders(credential.secret),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error("OpenAI API error: HTTP " + response.status);
    }

    const result = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
    };
    return result.choices[0].message.content;
  }
}
