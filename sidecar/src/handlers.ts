// Handlers stub de todos os endpoints do contrato IPC.
// Cada função tem a assinatura ditada pelo contrato; o corpo é placeholder.
// TASK: preencher cada handler mantendo a assinatura.

import {
  ipcErr,
  type IpcResult,
  type ValidateCredentialRequest,
  type ValidateCredentialResponse,
  type SuggestRequest,
  type SuggestStreamEvent,
  type AnalyzeResponse,
  type CreateAssistantRequest,
  type CreateAssistantResponse,
  type StartSessionRequest,
  type StartSessionResponse,
  type AppendTranscriptRequest,
  type TranscriptContextSegment,
  type EndSessionRequest,
  type EndSessionResponse,
  type RollSummaryRequest,
  type RollSummaryResponse,
  type TranslateRequest,
  type TranslateResponse,
  type SaveCredentialRequest,
  type SaveCredentialResponse,
  type DeleteCredentialRequest,
  type GetCredentialsResponse,
  type ProviderKind,
  type ProviderConnectionMode,
} from "./contract.js";
import { prisma } from "./db.js";
import { getProvider } from "./providers/registry.js";
import {
  CapabilityNotSupported,
} from "./providers/provider.js";

/**
 * Typed error for provider/network failures.
 * The handler maps this to IpcError code PROVIDER_UNAVAILABLE.
 * Providers should throw this when the upstream API is unreachable or returns
 * a transport-level error (DNS failure, TLS error, HTTP 5xx, timeout).
 */
export class ProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderError";
  }
}

/**
 * Strip a secret from an error message before it crosses the IPC boundary.
 * Never let a credential leak into an IpcError.message (ADR-003, RNF-301).
 */
function sanitizeSecret(message: string, secret: string): string {
  if (!secret || !message.includes(secret)) return message;
  return message.replaceAll(secret, "[REDACTED]");
}

// Identificador do usuário local enquanto autenticação multi-usuário
// não existe. Qualquer string fixa funciona; valor registrado como
// decisão técnica (credential-persistence.md §3.3).
const SYSTEM_USER_ID = "local";

function parseSaveCredentialRequest(body: unknown): SaveCredentialRequest {
  if (typeof body !== "object" || body === null) throw new Error("invalid body");
  const b = body as Record<string, unknown>;
  if (
    typeof b.slot !== "string" ||
    typeof b.kind !== "string" ||
    typeof b.connectionMode !== "string" ||
    typeof b.label !== "string" ||
    typeof b.secretRef !== "string"
  ) {
    throw new Error("invalid SaveCredentialRequest");
  }
  return {
    slot: b.slot,
    kind: b.kind as ProviderKind,
    connectionMode: b.connectionMode as ProviderConnectionMode,
    label: b.label,
    secretRef: b.secretRef,
    baseUrl: typeof b.baseUrl === "string" ? b.baseUrl : undefined,
  };
}

function parseDeleteCredentialRequest(body: unknown): DeleteCredentialRequest {
  if (typeof body !== "object" || body === null) throw new Error("invalid body");
  const b = body as Record<string, unknown>;
  if (typeof b.slot !== "string") throw new Error("slot required");
  return { slot: b.slot };
}

// --- Provedores -------------------------------------------------------

export async function validateCredential(
  req: ValidateCredentialRequest,
): Promise<IpcResult<ValidateCredentialResponse>> {
  try {
    const provider = getProvider(req.credential.kind);
    const r = await provider.validate(req.credential);
    if (r.valid && req.slot) {
      await prisma.apiKeyRef.updateMany({
        where: { userId: SYSTEM_USER_ID, slot: req.slot },
        data: { lastValidatedAt: new Date() },
      });
    }
    return { ok: true, value: r };
  } catch (e) {
    const raw = (e as Error).message;
    const message = sanitizeSecret(raw, req.credential.secret);
    if (e instanceof ProviderError || e instanceof CapabilityNotSupported) {
      return ipcErr("PROVIDER_UNAVAILABLE", message);
    }
    return ipcErr("INTERNAL", message);
  }
}

// --- Credenciais (T-302/T-406) ----------------------------------------

export async function saveCredential(
  body: unknown,
): Promise<IpcResult<SaveCredentialResponse>> {
  const req = parseSaveCredentialRequest(body);
  try {
    const record = await prisma.apiKeyRef.upsert({
      where: { userId_slot: { userId: SYSTEM_USER_ID, slot: req.slot } },
      update: {
        kind: req.kind,
        connectionMode: req.connectionMode,
        label: req.label,
        secretRef: req.secretRef,
        baseUrl: req.baseUrl ?? null,
        lastValidatedAt: null,
      },
      create: {
        user: {
          connectOrCreate: {
            where: { id: SYSTEM_USER_ID },
            create: { id: SYSTEM_USER_ID },
          },
        },
        slot: req.slot,
        kind: req.kind,
        connectionMode: req.connectionMode,
        label: req.label,
        secretRef: req.secretRef,
        baseUrl: req.baseUrl ?? null,
      },
    });
    return { ok: true, value: { id: record.id, secretRef: record.secretRef } };
  } catch (e) {
    return ipcErr("DB_ERROR", (e as Error).message);
  }
}

export async function deleteCredential(
  body: unknown,
): Promise<IpcResult<{ deleted: boolean }>> {
  const req = parseDeleteCredentialRequest(body);
  try {
    const result = await prisma.apiKeyRef.deleteMany({
      where: { userId: SYSTEM_USER_ID, slot: req.slot },
    });
    return { ok: true, value: { deleted: result.count > 0 } };
  } catch (e) {
    return ipcErr("DB_ERROR", (e as Error).message);
  }
}

export async function getCredentials(): Promise<IpcResult<GetCredentialsResponse>> {
  try {
    const records = await prisma.apiKeyRef.findMany({
      where: { userId: SYSTEM_USER_ID },
    });
    return {
      ok: true,
      value: {
        credentials: records.map((r) => ({
          id: r.id,
          slot: r.slot,
          kind: r.kind as ProviderKind,
          connectionMode: r.connectionMode as ProviderConnectionMode,
          secretRef: r.secretRef,
          baseUrl: r.baseUrl ?? undefined,
          lastValidatedAt: r.lastValidatedAt?.toISOString() ?? undefined,
        })),
      },
    };
  } catch (e) {
    return ipcErr("DB_ERROR", (e as Error).message);
  }
}

// --- Copiloto (streaming) --------------------------------------------

import { runSuggestStream, runAnalyze } from "./agent/graph.js";
import { generateSummary, rollSummary } from "./agent/summary.js";

async function loadAssistant(assistantId: string) {
  const assistant = await prisma.assistant.findUnique({
    where: { id: assistantId },
  });
  if (!assistant) {
    throw new Error(`Assistant not found: ${assistantId}`);
  }
  return assistant;
}

/**
 * Resumo rolante da sessão (memória da reunião além da janela verbatim).
 * Null quando a sessão não existe (ex.: placeholder do atalho sem reunião)
 * ou ainda não tem rolamento — o copiloto segue funcionando só com a
 * janela recente.
 */
async function loadMeetingSummary(sessionId: string): Promise<string | null> {
  if (!sessionId) return null;
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { rollingSummary: true },
  });
  return session?.rollingSummary ?? null;
}

/**
 * Gera eventos SSE do copiloto: start → token* → done.
 * Carrega o assistente via Prisma, resolve o provedor via registry, delega ao
 * grafo LangGraph (provider-agnostic). Emite erro se o assistente não existir.
 */
export async function* suggestStream(
  req: SuggestRequest,
): AsyncIterable<SuggestStreamEvent> {
  try {
    const assistant = await loadAssistant(req.assistantId);
    const provider = getProvider(req.credential.kind);
    const meetingSummary = await loadMeetingSummary(req.sessionId);
    yield* runSuggestStream(req, assistant.prompt, provider, meetingSummary);
  } catch (err) {
    yield {
      type: "error",
      error: { code: "AGENT_ERROR", message: (err as Error).message },
    };
  }
}

/**
 * Versão não-streaming: consolida todos os tokens em um AnalyzeResponse.
 */
export async function analyze(
  req: SuggestRequest,
): Promise<IpcResult<AnalyzeResponse>> {
  try {
    const assistant = await loadAssistant(req.assistantId);
    const provider = getProvider(req.credential.kind);
    const meetingSummary = await loadMeetingSummary(req.sessionId);
    const value = await runAnalyze(req, assistant.prompt, provider, meetingSummary);
    return { ok: true, value };
  } catch (err) {
    return ipcErr("AGENT_ERROR", (err as Error).message);
  }
}

// --- Assistentes ------------------------------------------------------

/** GET /assistants — lista assistentes (BUILTIN + USER) para a UI. */
export async function listAssistants(): Promise<
  IpcResult<{
    assistants: Array<{
      id: string;
      name: string;
      category: string;
      source: string;
      icon: string | null;
    }>;
  }>
> {
  try {
    const records = await prisma.assistant.findMany({
      orderBy: { createdAt: "asc" },
    });
    return {
      ok: true,
      value: {
        assistants: records.map((a) => ({
          id: a.id,
          name: a.name,
          category: a.category as string,
          source: a.source as string,
          icon: a.icon ?? null,
        })),
      },
    };
  } catch (e) {
    return ipcErr("DB_ERROR", (e as Error).message);
  }
}

export async function createAssistant(
  req: CreateAssistantRequest,
): Promise<IpcResult<CreateAssistantResponse>> {
  if (!req.name || req.name.trim().length === 0) {
    return ipcErr("BAD_REQUEST", "Assistant name must not be empty");
  }
  try {
    const assistant = await prisma.assistant.create({
      data: {
        userId: req.userId,
        name: req.name,
        category: req.category,
        source: "USER",
        prompt: req.prompt,
        icon: req.icon ?? null,
      },
    });
    return { ok: true, value: { assistantId: assistant.id } };
  } catch (e) {
    return ipcErr("DB_ERROR", (e as Error).message);
  }
}

/** DELETE /assistants/:id — remove um assistente USER (RF-336). */
export async function deleteAssistant(req: {
  assistantId: string;
}): Promise<IpcResult<{ deleted: true }>> {
  try {
    const assistant = await prisma.assistant.findUnique({
      where: { id: req.assistantId },
    });
    if (!assistant) {
      return ipcErr("DB_ERROR", `Assistant not found: ${req.assistantId}`);
    }
    // BUILTIN é o seed do copiloto (boot.ts) — não é deletável pela UI.
    if (assistant.source === "BUILTIN") {
      return ipcErr("BAD_REQUEST", "BUILTIN assistants cannot be deleted");
    }
    // Sessões e Settings.activeAssistantId referenciam com onDelete: SetNull
    // (schema.prisma) — a exclusão não órfã nada.
    await prisma.assistant.delete({ where: { id: req.assistantId } });
    return { ok: true, value: { deleted: true } };
  } catch (e) {
    return ipcErr("DB_ERROR", (e as Error).message);
  }
}

// --- Sessões ----------------------------------------------------------

export async function startSession(
  req: StartSessionRequest,
): Promise<IpcResult<StartSessionResponse>> {
  try {
    const session = await prisma.session.create({
      data: {
        userId: req.userId,
        assistantId: req.assistantId ?? null,
        platform: req.platform ?? "OTHER",
        sourceLanguage: req.sourceLanguage ?? null,
        targetLanguage: req.targetLanguage ?? null,
      },
    });
    return { ok: true, value: { sessionId: session.id } };
  } catch (e) {
    return ipcErr("DB_ERROR", (e as Error).message);
  }
}

export async function appendTranscript(
  req: AppendTranscriptRequest,
): Promise<IpcResult<{ segmentId: string }>> {
  try {
    const session = await prisma.session.findUnique({
      where: { id: req.sessionId },
    });
    if (!session) {
      return ipcErr("DB_ERROR", `Session not found: ${req.sessionId}`);
    }

    const segment = await prisma.transcriptSegment.create({
      data: {
        sessionId: req.sessionId,
        speaker: req.speaker,
        text: req.text,
        translatedText: req.translatedText ?? null,
        startMs: req.startMs,
        endMs: req.endMs,
      },
    });
    return { ok: true, value: { segmentId: segment.id } };
  } catch (e) {
    return ipcErr("DB_ERROR", (e as Error).message);
  }
}

export async function endSession(
  req: EndSessionRequest,
): Promise<IpcResult<EndSessionResponse>> {
  try {
    let summaryId: string | undefined;

    if (req.generateSummary && req.credential) {
      const rows = await prisma.transcriptSegment.findMany({
        where: { sessionId: req.sessionId },
      });
      // SQLite nao tem enums: speaker volta como String. Os valores
      // persistidos sao exatamente os da uniao Speaker do contrato.
      const segments = rows.map((s) => ({
        speaker: s.speaker as TranscriptContextSegment["speaker"],
        text: s.text,
        startMs: s.startMs,
      }));
      const provider = getProvider(req.credential.kind);
      const summaryResult = await generateSummary(
        segments,
        req.credential,
        provider,
      );

      const summary = await prisma.summary.create({
        data: {
          sessionId: req.sessionId,
          text: summaryResult.text,
          // SQLite (provider sqlite) nao tem tipo Json — serializa.
          actionItems: JSON.stringify(summaryResult.actionItems ?? []),
        },
      });
      summaryId = summary.id;
    }

    const session = await prisma.session.update({
      where: { id: req.sessionId },
      data: {
        status: "ENDED",
        endedAt: new Date(),
      },
    });

    return { ok: true, value: { sessionId: session.id, summaryId } };
  } catch (e) {
    return ipcErr("DB_ERROR", (e as Error).message);
  }
}

// --- Resumo rolante (contexto completo do copiloto — fase 1) -------------

/**
 * Segmentos finais que ficam FORA do rolamento: são a cauda recente, que a
 * janela verbatim do copiloto (20 segmentos no core) já cobre. Manter
 * KEEP < WINDOW garante sobreposição — nenhum segmento fica fora de ambas
 * as camadas de contexto.
 */
const ROLL_KEEP_RECENT = 16;
/**
 * Lote mínimo para valer uma chamada de LLM: com menos que isso de segmento
 * novo além da cauda, o rolamento é adiado para o próximo gatilho do core.
 */
const ROLL_MIN_BATCH = 8;

/**
 * Rolamentos em andamento, por sessionId. O core dispara fire-and-forget a
 * cada ciclo de análise; sem este guard, dois rolamentos da mesma sessão
 * poderiam correr em paralelo e persistir fora de ordem.
 */
const rollsInFlight = new Set<string>();

/**
 * POST /sessions/summary/roll — atualiza o resumo rolante da sessão.
 *
 * Corta (do banco) os segmentos que saíram da janela verbatim, consolida no
 * resumo vigente via LLM e persiste `rollingSummary` +
 * `summarizedSegmentCount`. No-op barato quando não há volume suficiente —
 * o core pode disparar a cada ciclo sem custo.
 */
export async function rollSessionSummary(
  req: RollSummaryRequest,
): Promise<IpcResult<RollSummaryResponse>> {
  if (rollsInFlight.has(req.sessionId)) {
    return { ok: true, value: { updated: false } };
  }
  rollsInFlight.add(req.sessionId);
  try {
    const session = await prisma.session.findUnique({
      where: { id: req.sessionId },
    });
    if (!session) {
      return ipcErr("DB_ERROR", `Session not found: ${req.sessionId}`);
    }

    const total = await prisma.transcriptSegment.count({
      where: { sessionId: req.sessionId },
    });
    const covered = session.summarizedSegmentCount ?? 0;
    const newCoverage = total - covered - ROLL_KEEP_RECENT;
    if (newCoverage < ROLL_MIN_BATCH) {
      return { ok: true, value: { updated: false } };
    }

    const rows = await prisma.transcriptSegment.findMany({
      where: { sessionId: req.sessionId },
      orderBy: [{ startMs: "asc" }, { createdAt: "asc" }],
      skip: covered,
      take: newCoverage,
    });
    // SQLite nao tem enums: speaker volta como String (mesma conversão de
    // endSession).
    const segments = rows.map((s) => ({
      speaker: s.speaker as TranscriptContextSegment["speaker"],
      text: s.text,
      startMs: s.startMs,
    }));

    const provider = getProvider(req.credential.kind);
    const summary = await rollSummary(
      session.rollingSummary ?? null,
      segments,
      req.credential,
      provider,
    );
    const summarizedSegmentCount = covered + newCoverage;

    await prisma.session.update({
      where: { id: req.sessionId },
      data: { rollingSummary: summary, summarizedSegmentCount },
    });

    return {
      ok: true,
      value: { updated: true, summary, summarizedSegmentCount },
    };
  } catch (e) {
    const raw = (e as Error).message;
    return ipcErr("AGENT_ERROR", sanitizeSecret(raw, req.credential.secret));
  } finally {
    rollsInFlight.delete(req.sessionId);
  }
}

// --- Tradução ---------------------------------------------------------

export async function translate(
  req: TranslateRequest,
): Promise<IpcResult<TranslateResponse>> {
  try {
    const provider = getProvider(req.credential.kind);
    if (!provider.capabilities.translation) {
      return ipcErr(
        "PROVIDER_UNAVAILABLE",
        `Provider ${req.credential.kind} does not support translation`,
      );
    }
    const translatedText = await provider.translate(
      req.credential,
      req.text,
      req.targetLanguage,
    );
    return { ok: true, value: { translatedText } };
  } catch (e) {
    const raw = (e as Error).message;
    const message = sanitizeSecret(raw, req.credential.secret);
    if (e instanceof ProviderError || e instanceof CapabilityNotSupported) {
      return ipcErr("PROVIDER_UNAVAILABLE", message);
    }
    return ipcErr("INTERNAL", message);
  }
}

// --- Configurações (RF-600/RF-700) -------------------------------------

import {
  DEFAULT_FEATURE_TOGGLES,
  DEFAULT_STT_LANGUAGE,
  isOverlayTemplate,
  isSttLanguage,
  OVERLAY_TEMPLATE_MAX_LENGTH,
  parseFeatureToggles,
  parseShortcutMap,
  type FeatureToggles,
  type ShortcutMap,
  type SttLanguage,
} from "./settings.js";

export type SettingsBlob = {
  features: FeatureToggles;
  shortcuts: ShortcutMap;
  sttLanguage: SttLanguage;
  overlayTemplateEnabled: boolean;
  overlayTemplate: string;
};

function parseJsonOrEmpty(raw: string | null | undefined): unknown {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/** GET /settings — features + atalhos + locale de STT (defaults quando vazio). */
export async function getSettings(): Promise<IpcResult<SettingsBlob>> {
  try {
    const row = await prisma.settings.findUnique({ where: { userId: "local" } });
    const features = parseJsonOrEmpty(row?.features);
    const shortcuts = parseJsonOrEmpty(row?.shortcuts);
    const parsedFeatures = parseFeatureToggles(features);
    const parsedShortcuts = parseShortcutMap(shortcuts);
    return {
      ok: true,
      value: {
        features: parsedFeatures.ok ? parsedFeatures.value : DEFAULT_FEATURE_TOGGLES,
        // Atalhos parciais são aceitos na leitura: o core mescla com os
        // defaults antes de registrar (binds omitidos = default).
        shortcuts: parsedShortcuts.ok ? parsedShortcuts.value : ({} as ShortcutMap),
        // Leitura tolerante: linha antiga sem a coluna ou valor inválido
        // caem no default do contrato — STT nunca fica sem locale.
        sttLanguage: isSttLanguage(row?.sttLanguage)
          ? row.sttLanguage
          : DEFAULT_STT_LANGUAGE,
        // Leitura tolerante dos campos do overlay customizado: linha antiga
        // sem as colunas (undefined) ou valor inválido caem nos defaults do
        // contrato (desligado, template vazio = InsightCard embutido).
        overlayTemplateEnabled: row?.overlayTemplateEnabled === true,
        overlayTemplate: isOverlayTemplate(row?.overlayTemplate)
          ? row.overlayTemplate
          : "",
      },
    };
  } catch (e) {
    return ipcErr("DB_ERROR", (e as Error).message);
  }
}

/** PUT /settings — valida e persiste features, atalhos, locale de STT e/ou
 * template de overlay (upsert). */
export async function saveSettings(
  req: {
    features?: unknown;
    shortcuts?: unknown;
    sttLanguage?: unknown;
    overlayTemplateEnabled?: unknown;
    overlayTemplate?: unknown;
  },
): Promise<IpcResult<SettingsBlob>> {
  try {
    const data: {
      features?: string;
      shortcuts?: string;
      sttLanguage?: string;
      overlayTemplateEnabled?: boolean;
      overlayTemplate?: string;
    } = {};
    if (req.features !== undefined) {
      const parsed = parseFeatureToggles(req.features);
      if (!parsed.ok) {
        return ipcErr("BAD_REQUEST", parsed.errors.map((e) => `${e.path}: ${e.message}`).join("; "));
      }
      data.features = JSON.stringify(parsed.value);
    }
    if (req.shortcuts !== undefined) {
      const parsed = parseShortcutMap(req.shortcuts);
      if (!parsed.ok) {
        return ipcErr("BAD_REQUEST", parsed.errors.map((e) => `${e.path}: ${e.message}`).join("; "));
      }
      data.shortcuts = JSON.stringify(parsed.value);
    }
    // Escrita estrita: valor fora do contrato é recusado (a leitura, não a
    // escrita, é quem tolera — mesmo princípio dos blobs features/shortcuts).
    if (req.sttLanguage !== undefined) {
      if (!isSttLanguage(req.sttLanguage)) {
        return ipcErr(
          "BAD_REQUEST",
          `sttLanguage inválido — valores aceitos: ${JSON.stringify(["pt-BR", "en-US"])}`,
        );
      }
      data.sttLanguage = req.sttLanguage;
    }
    // Overlay customizado: escrita estrita nos dois campos — tipo errado ou
    // template acima do teto do contrato é recusado (o sidecar nunca persiste
    // um blob que ele mesmo não conseguiria reler); campo ausente = não
    // tocado (mesmo update parcial dos demais).
    if (req.overlayTemplateEnabled !== undefined) {
      if (typeof req.overlayTemplateEnabled !== "boolean") {
        return ipcErr(
          "BAD_REQUEST",
          "overlayTemplateEnabled inválido — esperado boolean",
        );
      }
      data.overlayTemplateEnabled = req.overlayTemplateEnabled;
    }
    if (req.overlayTemplate !== undefined) {
      if (!isOverlayTemplate(req.overlayTemplate)) {
        return ipcErr(
          "BAD_REQUEST",
          `overlayTemplate inválido — esperado string com até ${OVERLAY_TEMPLATE_MAX_LENGTH} caracteres`,
        );
      }
      data.overlayTemplate = req.overlayTemplate;
    }
    await prisma.settings.upsert({
      where: { userId: "local" },
      update: data,
      create: { userId: "local", ...data },
    });
    return getSettings();
  } catch (e) {
    return ipcErr("DB_ERROR", (e as Error).message);
  }
}

// --- Listagem de sessões (RF-802) ---------------------------------------

export type SessionListItem = {
  id: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  assistantName: string | null;
  segmentCount: number;
};

/** GET /sessions — últimas sessões com contagem de segmentos. */
export async function listSessions(): Promise<IpcResult<{ sessions: SessionListItem[] }>> {
  try {
    const rows = await prisma.session.findMany({
      orderBy: { startedAt: "desc" },
      take: 30,
      include: {
        assistant: { select: { name: true } },
        _count: { select: { transcripts: true } },
      },
    });
    return {
      ok: true,
      value: {
        sessions: rows.map((s) => ({
          id: s.id,
          status: s.status,
          startedAt: s.startedAt.toISOString(),
          endedAt: s.endedAt ? s.endedAt.toISOString() : null,
          assistantName: s.assistant?.name ?? null,
          segmentCount: s._count.transcripts,
        })),
      },
    };
  } catch (e) {
    return ipcErr("DB_ERROR", (e as Error).message);
  }
}

export type SessionDetail = {
  id: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  assistantName: string | null;
  transcript: Array<{
    speaker: string;
    text: string;
    translatedText: string | null;
    startMs: number;
  }>;
};

/** GET /sessions/:id — sessão com a transcrição ordenada. */
export async function getSessionDetail(
  req: { sessionId: string },
): Promise<IpcResult<SessionDetail>> {
  try {
    const session = await prisma.session.findUnique({
      where: { id: req.sessionId },
      include: {
        assistant: { select: { name: true } },
        transcripts: { orderBy: { startMs: "asc" } },
      },
    });
    if (!session) {
      return ipcErr("DB_ERROR", `Session not found: ${req.sessionId}`);
    }
    return {
      ok: true,
      value: {
        id: session.id,
        status: session.status,
        startedAt: session.startedAt.toISOString(),
        endedAt: session.endedAt ? session.endedAt.toISOString() : null,
        assistantName: session.assistant?.name ?? null,
        transcript: session.transcripts.map((t) => ({
          speaker: t.speaker,
          text: t.text,
          translatedText: t.translatedText,
          startMs: t.startMs,
        })),
      },
    };
  } catch (e) {
    return ipcErr("DB_ERROR", (e as Error).message);
  }
}

// --- Export de relatório da sessão (T-604) -------------------------------

import {
  buildSessionReport,
  parseStoredActionItems,
  type ReportFormat,
  type ReportInsight,
} from "./agent/report.js";

export type SessionReport = {
  sessionId: string;
  format: ReportFormat;
  /** Nome sugerido do arquivo para a UI entregar no download. */
  filename: string;
  /** Documento completo (Markdown ou HTML). */
  content: string;
};

/**
 * GET /sessions/:id/report?format=md|html — monta o relatório exportável
 * (resumo + action items, transcrição com offsets e insights persistidos).
 *
 * Montagem pura via agent/report.ts: SEM provider, SEM LLM — o relatório
 * só consolida o que já está no banco. Segue o mesmo padrão de erro dos
 * handlers de leitura (sessão ausente = DB_ERROR).
 */
export async function getSessionReport(
  req: { sessionId: string; format?: string },
): Promise<IpcResult<SessionReport>> {
  const format: ReportFormat = req.format === "html" ? "html" : "md";
  if (req.format !== undefined && req.format !== "md" && req.format !== "html") {
    return ipcErr(
      "BAD_REQUEST",
      `format inválido: '${req.format}' — valores aceitos: md, html`,
    );
  }
  try {
    const session = await prisma.session.findUnique({
      where: { id: req.sessionId },
      include: {
        assistant: { select: { name: true } },
        transcripts: { orderBy: { startMs: "asc" } },
        summary: true,
        suggestions: { orderBy: { createdAt: "asc" } },
      },
    });
    if (!session) {
      return ipcErr("DB_ERROR", `Session not found: ${req.sessionId}`);
    }

    // SQLite não tem enums: speaker volta como String (mesma conversão de
    // endSession/getSessionDetail).
    const insights: ReportInsight[] = session.suggestions.map((s) => ({
      trigger: s.trigger,
      contextLabel: s.contextLabel,
      theySaid: s.theySaid,
      sayThis: s.sayThis,
    }));

    const content = buildSessionReport(
      {
        id: session.id,
        startedAt: session.startedAt.toISOString(),
        endedAt: session.endedAt ? session.endedAt.toISOString() : null,
        assistantName: session.assistant?.name ?? null,
      },
      session.summary
        ? {
            text: session.summary.text,
            actionItems: parseStoredActionItems(session.summary.actionItems),
          }
        : null,
      session.transcripts.map((t) => ({
        speaker: t.speaker,
        text: t.text,
        startMs: t.startMs,
        translatedText: t.translatedText,
      })),
      format,
      insights,
    );

    // Nome de arquivo ASCII e determinístico, derivado do início da sessão.
    const dateTag = session.startedAt.toISOString().slice(0, 10);
    return {
      ok: true,
      value: {
        sessionId: session.id,
        format,
        filename: `relatorio-sessao-${dateTag}.${format}`,
        content,
      },
    };
  } catch (e) {
    return ipcErr("DB_ERROR", (e as Error).message);
  }
}
