// View models de exibição da superfície Home (T-402). São formas locais de
// UI, não o shape de nenhum comando do core — nenhum comando de listagem de
// sessões foi declarado ainda, então a lista chega por props no seam do
// invoke() e permanece coberta no coverageMap com coveredBy vazio.
import type {
  AssistantCategory,
  InjectedCredential,
  TranscriptContextSegment,
} from '../../../../../contracts/ipc'

/** Sessão resumida para a lista de recentes e a busca (RF-802). */
export interface SessionSummary {
  id: string
  title: string
  /** ISO-8601 do início da sessão (exibição da lista). */
  startedAt?: string
  /** Número de segmentos de transcrição persistidos. */
  segmentCount?: number
}

/** Detalhe de uma sessão aberta da lista (transcrição persistida). */
export interface SessionDetailData {
  id: string
  assistantName: string | null
  startedAt: string
  transcript: Array<{ speaker: string; text: string; startMs: number }>
}

/** Item de memória recente do card em tempo real (RF-339). */
export interface MemoryItem {
  id: string
  text: string
}

/** Assistente atual exibido no card da Home (RF-011). */
export interface AssistantSummary {
  name: string
  category: AssistantCategory
}

/**
 * Props da Home (T-402). Fonte única do contrato de props da superfície:
 * os componentes declaram `$props()` contra estes tipos e os testes montam
 * com os mesmos tipos. O ComponentProps<> de svelte não serve aqui — sob o
 * svelte-check a importação de um .svelte a partir de um .ts resolve para o
 * shape legado { $on?; $set? }, e ComponentProps vira never (ver
 * decisions.md).
 */
export interface HomeProps {
  sessions: SessionSummary[]
  assistant: AssistantSummary
  memoryItems: MemoryItem[]
  sessionId: string
  assistantId: string
  context: TranscriptContextSegment[]
  credential: InjectedCredential
  screenshots?: string[]
  /** RF-206: exibir medidores de áudio durante a reunião. */
  metersVisible?: boolean
  /** RF-703: aviso "Continuar Gravando?" a cada 30 min de reunião. */
  sessionTimerEnabled?: boolean
}

/** Props do grupo de ações de conversa (RF-333). */
export interface ConversationActionsProps {
  sessionId: string
  assistantId: string
  context: TranscriptContextSegment[]
  credential: InjectedCredential
  screenshots?: string[]
}
