// Destinos que a app bar pode abrir (T-401 / RF-010).
// Navegacao cross-window via eventos Tauri (emit/listen) — sem pub/sub in-process.
export type AppBarDestination = 'home' | 'settings' | 'assistants' | 'onboarding'
