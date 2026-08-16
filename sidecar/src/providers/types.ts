// Espelho dos tipos de contrato usados pelos adapters.
// Em runtime, estes tipos vêm de contracts/ipc.ts (fonte: Rust + ts-rs, ADR-010).
// Reexportados aqui localmente para manter o pacote de providers auto-contido.

export type ProviderKind =
  | "OPENAI" | "ANTHROPIC" | "GEMINI" | "DEEPSEEK" | "OPENROUTER" | "GENERIC";

export type ProviderConnectionMode =
  | "API_KEY" | "SUBSCRIPTION" | "AGGREGATOR" | "COMPATIBLE_ENDPOINT";

export type Speaker = "SELF" | "OTHERS";

export type InjectedCredential = {
  kind: ProviderKind;
  connectionMode: ProviderConnectionMode;
  secret: string;
  baseUrl?: string;
  model?: string;
};

export type TranscriptContextSegment = {
  speaker: Speaker;
  text: string;
  startMs: number;
};
