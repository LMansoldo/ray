// Canal de ações declaradas da superfície Assistentes (T-407 / RF-336,
// RF-337, RF-338) — a fronteira de SAÍDA do estado da UI (mesmo padrão de
// settings-actions.ts T-406, navigation.ts T-402, restart.ts T-405 e
// lib/glass/opacity.ts T-400). Nenhum comando core existe para listar/
// buscar/criar/trocar assistente (core/src/lib.rs registra apenas
// set_stealth/toggle_window/suggest/transcribe_pending_pcm): as ações saem
// por este canal pub/sub local e, quando os comandos existirem, o canal
// passa a chamá-los via invoke() — a UI NUNCA inventa um nome de comando
// por conta própria (general.md / frontend.md: o contrato é a fronteira).
//
// assistantCreate carrega os campos que a UI conhece ({ name, category,
// prompt } — espelho do CreateAssistantRequest MENOS userId, que só o core
// sabe injetar; mesmo princípio do ADR-003). O canal de ENTRADA de prompt
// importado (onPromptImport/dispatchPromptImport) é o par assimétrico: o
// futuro leitor de arquivo nativo (core) entrega o Markdown aqui, e o
// criador o recebe no editor T-408.
import type { AssistantCategory } from '../../../../../contracts/ipc'

/** União exata das ações declaradas da superfície Assistentes. */
export type AssistantAction =
  | { type: 'assistantSelect'; assistantId: string }
  | { type: 'assistantCreate'; name: string; category: AssistantCategory; prompt: string }
  | { type: 'assistantDelete'; assistantId: string }
  | { type: 'promptImportRequest' }

type AssistantActionListener = (action: AssistantAction) => void

const actionListeners = new Set<AssistantActionListener>()

/** Observa ações da superfície; o retorno cancela a inscrição. */
export function onAssistantAction(listener: AssistantActionListener): () => void {
  actionListeners.add(listener)
  return () => {
    actionListeners.delete(listener)
  }
}

/** Emite uma ação para todos os inscritos. */
export function dispatchAssistantAction(action: AssistantAction): void {
  for (const listener of actionListeners) {
    listener(action)
  }
}

type PromptImportListener = (prompt: string) => void

const promptImportListeners = new Set<PromptImportListener>()

/** Observa prompts importados; o retorno cancela a inscrição. */
export function onPromptImport(listener: PromptImportListener): () => void {
  promptImportListeners.add(listener)
  return () => {
    promptImportListeners.delete(listener)
  }
}

/** Entrega um prompt importado (Markdown cru) aos inscritos. */
export function dispatchPromptImport(prompt: string): void {
  for (const listener of promptImportListeners) {
    listener(prompt)
  }
}
