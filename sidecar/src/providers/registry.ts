// Registro de provedores (ADR-006).
// Resolve um ProviderKind para o adapter correspondente.
// TASK: registrar os demais adapters (Anthropic, Gemini, DeepSeek, OpenRouter,
// Generic/compatível) à medida que forem implementados — cada um é uma task.

import type { AiProvider } from "./provider.js";
import type { ProviderKind } from "./types.js";
import { OpenAiProvider } from "./openai.js";
import { AnthropicProvider } from "./anthropic.js";
import { GeminiProvider } from "./gemini.js";
import { DeepSeekProvider } from "./deepseek.js";

const registry = new Map<ProviderKind, AiProvider>([
  ["OPENAI", new OpenAiProvider()],
  ["ANTHROPIC", new AnthropicProvider()],
  ["GEMINI", new GeminiProvider()],
  ["DEEPSEEK", new DeepSeekProvider()],
  // ["OPENROUTER", new OpenRouterProvider()],
  // ["GENERIC", new GenericProvider()],
]);

export function getProvider(kind: ProviderKind): AiProvider {
  const p = registry.get(kind);
  if (!p) throw new Error(`No provider registered for kind=${kind}`);
  return p;
}
