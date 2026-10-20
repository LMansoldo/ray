// Pipeline de fact-checking (T-600): extrai afirmações verificáveis do delta
// de transcrição, verifica cada uma contra a web e devolve uma seção
// "## Verificação de fatos" para o system prompt — mesmo molde de
// withMeetingSummary/withSearchResults em ../graph.ts: o consumidor é o
// próprio prompt (a UI da task T-602 apenas renderiza o markdown).
//
// Decisão de design — extração e julgamento em DUAS chamadas LLM separadas:
// o julgamento precisa dos snippets da busca, que só existem DEPOIS de extrair
// as claims (a busca usa o texto da claim como query). Julgar na mesma chamada
// da extração significaria classificar sem evidência nenhuma. Custo: 1 chamada
// LLM extra por ciclo de fact-check; limite de 2 claims e busca com timeout
// curto mantêm a latência sob controle.
//
// As fontes nunca vêm do modelo: o julgamento devolve apenas ÍNDICES (1-based)
// dos resultados de busca usados e a seção monta [título](url) a partir dos
// resultados reais — o modelo não inventa URL.
//
// Best-effort por construção: QUALQUER falha (LLM, busca, parse, sem claims)
// devolve "" e a seção simplesmente não entra no prompt — nunca derruba a
// sugestão.
//
// ADR-003: credential.secret vive só dentro das chamadas ao provider — nunca
// é logado, nunca persistido, nunca em variável de módulo.

import type { AiProvider } from "../../providers/provider.js";
import type { InjectedCredential } from "../../providers/types.js";
import type { SuggestRequest, SuggestionTrigger } from "../../contract.js";
import { searchDuckDuckGo, type SearchResult } from "./websearch.js";

// Triggers com material denso para verificar: análise da conversa acumulada e
// trecho explicitamente selecionado. AUTO fica FORA por padrão — fact-check a
// cada intervalo de acompanhamento ao vivo multiplicaria a latência do fluxo
// (toda a pipeline roda antes do primeiro token da sugestão).
export const CLAIMS_TRIGGERS: ReadonlySet<SuggestionTrigger> = new Set([
  "ANALYZE_CONVERSATION",
  "ANALYZE_SELECTION",
]);

export function shouldFactCheck(req: SuggestRequest): boolean {
  if (!CLAIMS_TRIGGERS.has(req.trigger)) return false;
  // Sem delta de transcrição nem seleção não há o que verificar.
  return req.context.length > 0 || Boolean(req.selectionText?.trim());
}

// --- Limites do pipeline -----------------------------------------------------

const MAX_CLAIMS = 2; // máx. 2 claims por ciclo
const MAX_CLAIM_LENGTH = 300; // claim normalizada não passa disso
const SEARCH_TIMEOUT_MS = 4000; // busca curta — fact-check não pode travar o prompt
const SEARCH_RESULTS_PER_CLAIM = 3; // snippets disponíveis por claim
const MAX_SOURCES_PER_CLAIM = 2; // fontes citadas por claim na seção
const MAX_SEARCH_QUERY_LENGTH = 300; // mesmo teto do deriveSearchQuery
const MAX_JUSTIFICATION_LENGTH = 400;

type SearchFn = typeof searchDuckDuckGo;

// --- Tipos internos -----------------------------------------------------------

type Verdict = "TRUE" | "FALSE" | "UNCERTAIN";
type Confidence = "alta" | "média" | "baixa";

interface ClaimJudgment {
  verdict: Verdict;
  confidence: Confidence;
  justification: string;
  /** Índices 1-based dos resultados de busca (da claim) usados como fonte. */
  sourceIndexes: number[];
}

interface ClaimEvidence {
  query: string;
  results: SearchResult[];
}

// --- Prompts -----------------------------------------------------------------
// Prompts em inglês (mesma convenção de summary.ts); seções de saída em PT-BR.

const EXTRACTION_SYSTEM_PROMPT =
  "You are a fact-checking extractor for a live meeting copilot. " +
  "You receive the newest transcript delta (and possibly a user-selected " +
  "excerpt). Extract UP TO 2 verifiable factual claims — objective statements " +
  "that could be checked against public sources (versions, numbers, dates, " +
  "releases, quotes, events, technical facts). Rules: " +
  "1. Max 2 claims; prefer 0 over a weak or speculative claim. " +
  "2. Quote claims as close to the original wording as possible; never invent. " +
  "3. Ignore opinions, plans, questions and small talk. " +
  "4. Output ONLY a JSON array of strings, in the transcript language, e.g. " +
  '[\"React 19 is stable\",\"Node 24 is the current LTS\"]. ' +
  "5. If nothing is verifiable, output [] — nothing else.";

const JUDGMENT_SYSTEM_PROMPT =
  "You are a strict fact-checker. You receive numbered claims and, for each " +
  "claim, numbered web search results (title, url, snippet). Classify each " +
  "claim as TRUE (supported by a specific result), FALSE (contradicted by a " +
  "specific result) or UNCERTAIN. Epistemic rules: a generalization without a " +
  "specific supporting source becomes UNCERTAIN; actively look for " +
  "counterevidence in the results — if any result contradicts the claim, " +
  "FALSE wins over TRUE. Rules: " +
  "1. justification: 1-2 short sentences, in the claim's language. " +
  "2. confidence: one of alta, média, baixa. " +
  "3. sources: 1-based numbers of the results you actually used; [] if none. " +
  "4. Output ONLY a JSON array with one object per claim, e.g. " +
  '[{\"index\":1,\"verdict\":\"TRUE\",\"confidence\":\"alta\",' +
  '\"justification\":\"...\",\"sources\":[1,2]}].';

// --- Entrada do grafo ----------------------------------------------------------

/**
 * Ponto de entrada usado pelo grafo: roda a pipeline inteira (extração →
 * busca → julgamento → seção) e devolve o markdown pronto. String vazia
 * significa "sem seção de fact-check" — o chamador só anexa quando não-vazia.
 *
 * @param req — pedido de sugestão (fonte do delta de transcrição e do trigger)
 * @param credential — credencial injetada pelo core (ADR-003)
 * @param provider — AiProvider resolvido para a credencial
 * @param searchFn — busca web (injeção para testes; padrão: searchDuckDuckGo)
 */
export async function factCheckForRequest(
  req: SuggestRequest,
  credential: InjectedCredential,
  provider: AiProvider,
  searchFn: SearchFn = searchDuckDuckGo,
): Promise<string> {
  try {
    if (!shouldFactCheck(req)) return "";

    // 1) Extração — 1 chamada LLM sobre o delta de transcrição.
    const claims = await extractClaims(req, credential, provider);
    if (claims.length === 0) return "";

    // 2) Verificação — 1 busca por claim, sequencial, timeout curto.
    const evidence = await collectEvidence(claims, searchFn);
    // Nenhuma busca retornou nada (rede fora, DDG bloqueando): sem evidência
    // não há o que julgar — omite a seção inteira em vez de chutar veredito.
    if (evidence.every((e) => e.results.length === 0)) return "";

    // 3) Julgamento — 2ª chamada LLM com claims + snippets.
    const verdicts = await judgeClaims(claims, evidence, credential, provider);
    if (verdicts.length === 0) return "";

    // 4) Seção final no formato exato compartilhado com a UI (T-602).
    return renderSection(claims, evidence, verdicts);
  } catch (err) {
    // Best-effort: nenhum passo do fact-check pode derrubar a sugestão.
    console.warn(
      "[claims] fact-check skipped — answering without fact-check section:",
      (err as Error).message,
    );
    return "";
  }
}

// --- Etapas da pipeline --------------------------------------------------------

/** 1) Extração: 0–2 claims verificáveis a partir do delta de transcrição. */
async function extractClaims(
  req: SuggestRequest,
  credential: InjectedCredential,
  provider: AiProvider,
): Promise<string[]> {
  const selection = req.selectionText?.trim();
  const output = await completeOnce(provider, {
    credential,
    system: EXTRACTION_SYSTEM_PROMPT,
    context: req.context,
    userPrompt: selection
      ? "Selected excerpt provided by the user (check it too):\n" + selection
      : undefined,
  });
  return parseClaims(output);
}

/** 2) Verificação: 1 busca por claim, sequencial (não estoura rate limit). */
async function collectEvidence(
  claims: string[],
  searchFn: SearchFn,
): Promise<ClaimEvidence[]> {
  const evidence: ClaimEvidence[] = [];
  for (const claim of claims) {
    const query = claim.slice(0, MAX_SEARCH_QUERY_LENGTH);
    let results: SearchResult[] = [];
    try {
      results = await searchFn(query, {
        timeoutMs: SEARCH_TIMEOUT_MS,
        limit: SEARCH_RESULTS_PER_CLAIM,
      });
    } catch (err) {
      // searchDuckDuckGo já resolve [] em falha; o catch cobre uma searchFn
      // injetada que lance — busca ruim vira "sem resultados", não exceção.
      console.warn(
        "[claims] search failed for claim — treating as no results:",
        (err as Error).message,
      );
    }
    evidence.push({ query, results });
  }
  return evidence;
}

/** 3) Julgamento: 2ª chamada LLM classifica cada claim contra os snippets. */
async function judgeClaims(
  claims: string[],
  evidence: ClaimEvidence[],
  credential: InjectedCredential,
  provider: AiProvider,
): Promise<ClaimJudgment[]> {
  const worksheet = claims
    .map((claim, i) => {
      const results = evidence[i].results
        .map(
          (r, j) => `  ${j + 1}. [${r.title}](${r.url}) — ${r.snippet}`,
        )
        .join("\n");
      return `Claim ${i + 1}: ${claim}\nSearch results:\n${
        results || "  (no results)"
      }`;
    })
    .join("\n\n");

  const output = await completeOnce(provider, {
    credential,
    system: JUDGMENT_SYSTEM_PROMPT,
    context: [],
    userPrompt: worksheet,
  });

  return parseVerdicts(output, claims.length);
}

// --- Parse tolerante -------------------------------------------------------------

/**
 * Parse tolerante da extração: aceita cercas de código e texto ao redor do
 * array JSON. SEM fallback por linhas — prosa do modelo ("Aqui estão as
 * claims:") jamais vira claim falsa; se o JSON não vier, o ciclo simplesmente
 * não tem fact-check (best-effort).
 */
export function parseClaims(text: string): string[] {
  const json = extractJsonArray(text);
  if (json === undefined) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((c): c is string => typeof c === "string")
    .map(normalizeClaim)
    .filter((c) => c.length > 0)
    .slice(0, MAX_CLAIMS);
}

/**
 * Parse tolerante do julgamento: indexa por "index" (1-based) e preenche na
 * ordem das claims — item ausente/inválido vira UNCERTAIN padrão, nunca trava
 * a pipeline. Se nenhum item for válido, devolve [] (sem seção).
 */
function parseVerdicts(text: string, claimCount: number): ClaimJudgment[] {
  const json = extractJsonArray(text);
  if (json === undefined) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const byIndex = new Map<number, ClaimJudgment>();
  for (const item of parsed) {
    const entry = parseJudgmentItem(item);
    if (entry) byIndex.set(entry.index, entry.judgment);
  }
  if (byIndex.size === 0) return [];

  const verdicts: ClaimJudgment[] = [];
  for (let i = 1; i <= claimCount; i++) {
    verdicts.push(
      byIndex.get(i) ?? {
        verdict: "UNCERTAIN",
        confidence: "baixa",
        justification: "O veredito não pôde ser determinado a partir da busca.",
        sourceIndexes: [],
      },
    );
  }
  return verdicts;
}

function parseJudgmentItem(
  item: unknown,
): { index: number; judgment: ClaimJudgment } | undefined {
  if (typeof item !== "object" || item === null) return undefined;
  const rec = item as Record<string, unknown>;
  const index = Number(rec.index ?? rec.claim);
  if (!Number.isInteger(index) || index < 1) return undefined;

  const rawJustification =
    typeof rec.justification === "string" ? rec.justification.trim() : "";
  const sourcesRaw = Array.isArray(rec.sources)
    ? rec.sources
    : Array.isArray(rec.fontes)
      ? rec.fontes
      : [];

  return {
    index,
    judgment: {
      verdict: normalizeVerdict(rec.verdict ?? rec.veredito),
      confidence: normalizeConfidence(rec.confidence),
      justification: rawJustification
        ? rawJustification.replace(/\s+/g, " ").slice(0, MAX_JUSTIFICATION_LENGTH)
        : "Sem justificativa produzida pelo modelo.",
      sourceIndexes: sourcesRaw
        .map(Number)
        .filter((n) => Number.isInteger(n) && n >= 1),
    },
  };
}

function normalizeVerdict(raw: unknown): Verdict {
  const v = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  if (v === "TRUE" || v === "VERDADEIRO") return "TRUE";
  if (v === "FALSE" || v === "FALSO") return "FALSE";
  return "UNCERTAIN";
}

function normalizeConfidence(raw: unknown): Confidence {
  const c = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (c === "alta" || c === "high") return "alta";
  if (c === "média" || c === "media" || c === "medium") return "média";
  return "baixa";
}

/** Normaliza a claim: colapsa whitespace, tira grifos das pontas e aplica o teto. */
function normalizeClaim(raw: string): string {
  return raw
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["'“”«»]+|["'“”«»]+$/g, "")
    .trim()
    .slice(0, MAX_CLAIM_LENGTH);
}

/**
 * Recorta o primeiro array JSON do texto: cerca de código removida e fatia
 * do primeiro "[" ao último "]". Undefined se não houver array aparente.
 */
function extractJsonArray(text: string): string | undefined {
  const cleaned = text.replace(/```[a-z]*\n?/gi, "").trim();
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start === -1 || end <= start) return undefined;
  return cleaned.slice(start, end + 1);
}

// --- 1 chamada LLM coletada -------------------------------------------------------

/**
 * Uma chamada LLM com resposta coletada — mesmo padrão de rollSummary em
 * ../summary.ts: analyzeStream + join dos chunks. Provider-agnostic; o
 * segredo da credencial vive só dentro desta chamada (ADR-003).
 */
async function completeOnce(
  provider: AiProvider,
  params: {
    credential: InjectedCredential;
    system: string;
    context: SuggestRequest["context"];
    userPrompt?: string;
  },
): Promise<string> {
  const stream = provider.analyzeStream({
    credential: params.credential,
    system: params.system,
    context: params.context,
    userPrompt: params.userPrompt,
  });
  const chunks: string[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk.text);
  }
  return chunks.join("").trim();
}

// --- Seção final (contrato de formato com a T-602) --------------------------------

/**
 * Monta a seção markdown no formato EXATO compartilhado com a T-602:
 *
 * ## Verificação de fatos
 *
 * ### Claim: "<afirmação textual, normalizada>"
 * **Veredito: TRUE** · confiança: alta
 * <1–2 frases de justificativa>
 * Fontes: [título](url) · [título](url)
 *
 * Claim sem fonte utilizada mantém a linha "Fontes:" com "nenhuma" — o
 * prefixo é o que a UI usa para reconhecer a linha, então ele sempre existe.
 */
function renderSection(
  claims: string[],
  evidence: ClaimEvidence[],
  verdicts: ClaimJudgment[],
): string {
  const blocks = claims.map((claim, i) => {
    const v = verdicts[i];
    const sources = v.sourceIndexes
      .map((n) => evidence[i]?.results[n - 1])
      .filter((r): r is SearchResult => Boolean(r?.title && r.url))
      .slice(0, MAX_SOURCES_PER_CLAIM);
    const sourcesLine =
      sources.length > 0
        ? sources.map((r) => `[${r.title}](${r.url})`).join(" · ")
        : "nenhuma";
    return (
      `### Claim: "${claim}"\n` +
      `**Veredito: ${v.verdict}** · confiança: ${v.confidence}\n` +
      `${v.justification}\n` +
      `Fontes: ${sourcesLine}`
    );
  });
  return "## Verificação de fatos\n\n" + blocks.join("\n\n");
}
