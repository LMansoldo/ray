//! Captura de áudio (ADR-004). Canal VOCÊ (microfone) e canal OUTROS
//! (áudio recebido via loopback/monitor ou Ray Audio Driver no macOS).
//! TASK: implementar captura por plataforma e enfileiramento de PCM para STT.

/// Identifica um dispositivo de áudio do SO.
pub struct AudioDevice {
    pub id: String,
    pub name: String,
}

/// Lista dispositivos de entrada (microfones) para o canal VOCÊ.
pub fn list_input_devices() -> Vec<AudioDevice> {
    // TASK: enumerar via API nativa (WASAPI/CoreAudio/PulseAudio).
    Vec::new()
}

/// Lista fontes de "áudio recebido" (loopback/monitor/driver) para OUTROS.
pub fn list_incoming_sources() -> Vec<AudioDevice> {
    // TASK: Windows loopback WASAPI; macOS Ray Audio Driver; Linux monitor.
    Vec::new()
}

/// Inicia a captura de um canal, entregando frames PCM ao consumidor de STT.
pub fn start_capture(_device_id: &str) {
    // TASK: abrir stream e empurrar PCM para o pipeline de transcrição.
}
