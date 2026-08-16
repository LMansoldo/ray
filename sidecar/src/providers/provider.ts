// Interface única de provedor de IA (ADR-006).
// Cada provedor concreto (OpenAI, Anthropic, Gemini, DeepSeek, OpenRouter,
// endpoint compatível) é um adapter que implementa esta interface.
// O agente e o resto do sistema permanecem agnósticos ao provedor concreto.

import type {
  InjectedCredential,
  ProviderKind,
  TranscriptContextSegment,
} from "./types.js";

/** Capacidades que um adapter declara suportar. Nem todo provedor faz tudo. */
export type ProviderCapabilities = {
  analysis: boolean;
  transcription: boolean;
  translation: boolean;
};

/** Um chunk de saída em streaming (token a token). */
export type CompletionChunk = { text: string };

/** Parâmetros de uma geração de análise/chat. */
export type AnalyzeParams = {
  credential: InjectedCredential;
  /** Prompt de sistema (vem do assistente ativo). */
  system: string;
  /** Contexto de transcrição relevante. */
  context: TranscriptContextSegment[];
  /** Prompt livre do usuário, quando houver. */
  userPrompt?: string;
  /** Frames em base64, quando houver (análise visual). */
  screenshots?: string[];
};

/** Contrato que todo adapter de provedor implementa. */
export interface AiProvider {
  readonly kind: ProviderKind;
  readonly capabilities: ProviderCapabilities;

  /** Valida a credencial; retorna modelos disponíveis quando o provedor expõe. */
  validate(credential: InjectedCredential): Promise<{
    valid: boolean;
    availableModels?: string[];
    reason?: string;
  }>;

  /** Análise/chat em streaming. Deve lançar se capabilities.analysis for false. */
  analyzeStream(params: AnalyzeParams): AsyncIterable<CompletionChunk>;

  /** Tradução de um texto. Deve lançar se capabilities.translation for false. */
  translate(
    credential: InjectedCredential,
    text: string,
    targetLanguage: string,
  ): Promise<string>;
}

/** Erro padrão de adapter para capacidade não suportada. */
export class CapabilityNotSupported extends Error {
  constructor(kind: ProviderKind, capability: keyof ProviderCapabilities) {
    super(`Provider ${kind} does not support ${capability}`);
    this.name = "CapabilityNotSupported";
  }
}
