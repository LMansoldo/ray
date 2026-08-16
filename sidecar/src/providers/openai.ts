// Adapter STUB — OpenAI (e base para endpoints compatíveis).
// TASK: implementar validate/analyzeStream/translate contra a API real.
// NÃO alterar a assinatura da interface AiProvider (ADR-006).

import {
  type AiProvider,
  type AnalyzeParams,
  type CompletionChunk,
  type ProviderCapabilities,
  CapabilityNotSupported,
} from "./provider.js";
import type { InjectedCredential, ProviderKind } from "./types.js";

export class OpenAiProvider implements AiProvider {
  readonly kind: ProviderKind = "OPENAI";
  readonly capabilities: ProviderCapabilities = {
    analysis: true,
    transcription: true,
    translation: true,
  };

  async validate(_credential: InjectedCredential): Promise<{
    valid: boolean;
    availableModels?: string[];
    reason?: string;
  }> {
    // TASK: chamar o endpoint de modelos e confirmar a credencial.
    return { valid: false, reason: "not_implemented" };
  }

  async *analyzeStream(_params: AnalyzeParams): AsyncIterable<CompletionChunk> {
    // TASK: abrir stream de chat e emitir chunks conforme chegam.
    // Stub não emite nada; apenas satisfaz o tipo AsyncIterable.
    if (!this.capabilities.analysis) {
      throw new CapabilityNotSupported(this.kind, "analysis");
    }
    return;
  }

  async translate(
    _credential: InjectedCredential,
    _text: string,
    _targetLanguage: string,
  ): Promise<string> {
    // TASK: traduzir via chat/completions.
    throw new CapabilityNotSupported(this.kind, "translation");
  }
}
