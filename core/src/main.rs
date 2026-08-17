// Ponto de entrada binário do app Tauri (T-001). Toda a lógica vive em
// `ray_core::run()` (src/lib.rs) — este binário só a invoca, para que a
// biblioteca continue reutilizável (ex.: por testes de integração).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    ray_core::run();
}
