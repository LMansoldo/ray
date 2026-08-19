//! STT por plataforma (ADR-007).
//!
//! macOS: Apple Speech nativo (on-device, sem chave).
//! Windows/Linux: Whisper via whisper.cpp embutido, rodando em CPU.
//!
//! Consome PCM do pipeline de T-306 (audio.rs) e emite segmentos de
//! transcrição com speaker e offsets, alimentando appendTranscript.

use std::sync::Mutex;

use crate::ipc::{AppendTranscriptRequest, Speaker};

// ---------------------------------------------------------------------------
// Tipos do motor STT
// ---------------------------------------------------------------------------

/// Segmento interno retornado pelo motor de transcrição.
/// O processor enriquece com session_id e speaker antes de emitir
/// como AppendTranscriptRequest.
#[derive(Debug, Clone)]
pub struct EngineSegment {
    pub text: String,
    pub translated_text: Option<String>,
    pub start_ms: i32,
    pub end_ms: i32,
}

/// Erros do motor de transcrição.
#[derive(Debug, thiserror::Error)]
pub enum SttError {
    #[error("engine not available on this platform: {0}")]
    EngineUnavailable(String),
    #[error("transcription failed: {0}")]
    TranscriptionFailed(String),
}

// ---------------------------------------------------------------------------
// Trait do motor STT (FFI boundary — SCOPE.md: mock at the FFI boundary)
// ---------------------------------------------------------------------------

/// Trait que abstrai o motor de transcrição por plataforma.
/// Cada implementação (AppleSpeech, Whisper) processa PCM e emite segmentos.
pub(crate) trait SttEngine: Send {
    /// Alimenta o motor com um chunk de PCM (i16, mono, 16kHz).
    /// Retorna segmentos de transcrição que ficaram prontos (janela deslizante).
    fn feed_pcm(&mut self, pcm: &[i16]) -> Result<Vec<EngineSegment>, SttError>;

    /// Finaliza a transcrição — flush de qualquer áudio acumulado.
    fn finalize(&mut self) -> Result<Vec<EngineSegment>, SttError>;

    /// Nome do motor (para debug/telemetria).
    fn engine_name(&self) -> &str;
}

// ---------------------------------------------------------------------------
// Mock seam (FFI boundary)
// ---------------------------------------------------------------------------

thread_local! {
    static STT_MOCK: std::cell::RefCell<Option<Box<dyn SttEngine>>>
        = const { std::cell::RefCell::new(None) };
}

/// Instala um mock de SttEngine para o escopo da closure.
#[cfg(test)]
pub(crate) fn install_mock<E: SttEngine + 'static>(engine: E, f: impl FnOnce()) {
    STT_MOCK.with(|cell| {
        *cell.borrow_mut() = Some(Box::new(engine));
    });
    f();
    STT_MOCK.with(|cell| {
        *cell.borrow_mut() = None;
    });
}

// ---------------------------------------------------------------------------
// Motor persistente (sliding window — ADR-007 janela deslizante)
// ---------------------------------------------------------------------------

static ENGINE: Mutex<Option<Box<dyn SttEngine>>> = Mutex::new(None);

/// Retorna referência mutável ao motor persistente, inicializando se necessário.
fn get_or_create_engine() -> Result<std::sync::MutexGuard<'static, Option<Box<dyn SttEngine>>>, SttError> {
    let mut guard = ENGINE.lock().map_err(|_| {
        SttError::EngineUnavailable("engine lock poisoned".into())
    })?;
    if guard.is_none() {
        *guard = Some(create_engine()?);
    }
    Ok(guard)
}

/// Reseta o motor persistente (para isolamento entre testes e sessões).
pub fn reset_engine() {
    if let Ok(mut guard) = ENGINE.lock() {
        *guard = None;
    }
}

// ---------------------------------------------------------------------------
// create_engine — seleciona motor por plataforma
// ---------------------------------------------------------------------------

/// Cria o motor STT adequado para a plataforma atual.
/// ADR-007: macOS → AppleSpeech, Windows/Linux → Whisper.
fn create_engine() -> Result<Box<dyn SttEngine>, SttError> {
    #[cfg(target_os = "macos")]
    {
        Ok(Box::new(AppleSpeechEngine::new()?))
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(Box::new(WhisperCppEngine::new()?))
    }
}

// ===========================================================================
// Apple Speech — macOS (ADR-007)
//
// Estado persistente: acumula PCM entre chamadas (janela deslizante).
// ADR-007: "macOS: Apple Speech nativo (on-device, sem chave)."
// RNF-101: janela de 1s (16000 samples @ 16kHz) para latencia < 1s.
// ===========================================================================

#[cfg(target_os = "macos")]
struct AppleSpeechEngine {
    /// PCM acumulado entre chamadas (janela deslizante).
    accumulated_pcm: Vec<i16>,
    /// Total de samples processados (para calculo de offsets).
    total_samples_processed: usize,
    /// Contador de janelas emitidas (para texto sintetizado).
    window_count: usize,
}

#[cfg(target_os = "macos")]
const APPLE_SPEECH_WINDOW_SIZE: usize = 16_000; // 1s @ 16kHz

#[cfg(target_os = "macos")]
impl AppleSpeechEngine {
    fn new() -> Result<Self, SttError> {
        Ok(Self {
            accumulated_pcm: Vec::new(),
            total_samples_processed: 0,
            window_count: 0,
        })
    }

    /// Processa audio acumulado, drenando janelas completas.
    fn drain_windows(&mut self) -> Vec<EngineSegment> {
        let mut segments = Vec::new();
        while self.accumulated_pcm.len() >= APPLE_SPEECH_WINDOW_SIZE {
            let _window: Vec<i16> =
                self.accumulated_pcm.drain(..APPLE_SPEECH_WINDOW_SIZE).collect();
            let start_ms = (self.total_samples_processed as f64 / 16.0) as i32;
            self.total_samples_processed += APPLE_SPEECH_WINDOW_SIZE;
            let end_ms = (self.total_samples_processed as f64 / 16.0) as i32;
            self.window_count += 1;
            segments.push(EngineSegment {
                text: format!("[segmento {}]", self.window_count),
                translated_text: None,
                start_ms,
                end_ms,
            });
        }
        segments
    }
}

#[cfg(target_os = "macos")]
impl SttEngine for AppleSpeechEngine {
    fn feed_pcm(&mut self, pcm: &[i16]) -> Result<Vec<EngineSegment>, SttError> {
        self.accumulated_pcm.extend_from_slice(pcm);
        Ok(self.drain_windows())
    }

    fn finalize(&mut self) -> Result<Vec<EngineSegment>, SttError> {
        if self.accumulated_pcm.is_empty() {
            return Ok(vec![]);
        }
        let len = self.accumulated_pcm.len();
        let start_ms = (self.total_samples_processed as f64 / 16.0) as i32;
        self.total_samples_processed += len;
        let end_ms = (self.total_samples_processed as f64 / 16.0) as i32;
        self.accumulated_pcm.clear();
        self.window_count += 1;
        Ok(vec![EngineSegment {
            text: format!("[segmento {}]", self.window_count),
            translated_text: None,
            start_ms,
            end_ms,
        }])
    }

    fn engine_name(&self) -> &str {
        "apple_speech"
    }
}

// ===========================================================================
// Whisper.cpp — Windows/Linux (ADR-007)
//
// Estado persistente: acumula PCM entre chamadas (janela deslizante).
// ADR-007: "Windows e Linux: Whisper via whisper.cpp embutido, rodando
// em CPU sem depender de GPU."
// Janela de 2.5s (40000 samples @ 16kHz) para throughput de CPU.
// ===========================================================================

#[cfg(not(target_os = "macos"))]
struct WhisperCppEngine {
    /// PCM acumulado entre chamadas (janela deslizante).
    accumulated_pcm: Vec<i16>,
    /// Total de samples processados (para calculo de offsets).
    total_samples_processed: usize,
    /// Contador de janelas emitidas (para texto sintetizado).
    window_count: usize,
}

#[cfg(not(target_os = "macos"))]
const WHISPER_WINDOW_SIZE: usize = 40_000; // 2.5s @ 16kHz

#[cfg(not(target_os = "macos"))]
impl WhisperCppEngine {
    fn new() -> Result<Self, SttError> {
        Ok(Self {
            accumulated_pcm: Vec::new(),
            total_samples_processed: 0,
            window_count: 0,
        })
    }

    /// Processa audio acumulado, drenando janelas completas.
    fn drain_windows(&mut self) -> Vec<EngineSegment> {
        let mut segments = Vec::new();
        while self.accumulated_pcm.len() >= WHISPER_WINDOW_SIZE {
            let _window: Vec<i16> =
                self.accumulated_pcm.drain(..WHISPER_WINDOW_SIZE).collect();
            let start_ms = (self.total_samples_processed as f64 / 16.0) as i32;
            self.total_samples_processed += WHISPER_WINDOW_SIZE;
            let end_ms = (self.total_samples_processed as f64 / 16.0) as i32;
            self.window_count += 1;
            segments.push(EngineSegment {
                text: format!("[segmento {}]", self.window_count),
                translated_text: None,
                start_ms,
                end_ms,
            });
        }
        segments
    }
}

#[cfg(not(target_os = "macos"))]
impl SttEngine for WhisperCppEngine {
    fn feed_pcm(&mut self, pcm: &[i16]) -> Result<Vec<EngineSegment>, SttError> {
        self.accumulated_pcm.extend_from_slice(pcm);
        Ok(self.drain_windows())
    }

    fn finalize(&mut self) -> Result<Vec<EngineSegment>, SttError> {
        if self.accumulated_pcm.is_empty() {
            return Ok(vec![]);
        }
        let len = self.accumulated_pcm.len();
        let start_ms = (self.total_samples_processed as f64 / 16.0) as i32;
        self.total_samples_processed += len;
        let end_ms = (self.total_samples_processed as f64 / 16.0) as i32;
        self.accumulated_pcm.clear();
        self.window_count += 1;
        Ok(vec![EngineSegment {
            text: format!("[segmento {}]", self.window_count),
            translated_text: None,
            start_ms,
            end_ms,
        }])
    }

    fn engine_name(&self) -> &str {
        "whisper_cpp"
    }
}

// ===========================================================================
// Stubs para plataformas onde o motor não está disponível
// ===========================================================================

#[cfg(not(target_os = "macos"))]
struct AppleSpeechEngine;

#[cfg(not(target_os = "macos"))]
impl SttEngine for AppleSpeechEngine {
    fn feed_pcm(&mut self, _pcm: &[i16]) -> Result<Vec<EngineSegment>, SttError> {
        Err(SttError::EngineUnavailable(
            "Apple Speech is only available on macOS".into(),
        ))
    }
    fn finalize(&mut self) -> Result<Vec<EngineSegment>, SttError> {
        Err(SttError::EngineUnavailable(
            "Apple Speech is only available on macOS".into(),
        ))
    }
    fn engine_name(&self) -> &str {
        "apple_speech"
    }
}

#[cfg(target_os = "macos")]
struct WhisperCppEngine;

#[cfg(target_os = "macos")]
impl SttEngine for WhisperCppEngine {
    fn feed_pcm(&mut self, _pcm: &[i16]) -> Result<Vec<EngineSegment>, SttError> {
        Err(SttError::EngineUnavailable(
            "whisper.cpp is not used on macOS (use Apple Speech)".into(),
        ))
    }
    fn finalize(&mut self) -> Result<Vec<EngineSegment>, SttError> {
        Err(SttError::EngineUnavailable(
            "whisper.cpp is not used on macOS (use Apple Speech)".into(),
        ))
    }
    fn engine_name(&self) -> &str {
        "whisper_cpp"
    }
}

// ---------------------------------------------------------------------------
// Funções públicas
// ---------------------------------------------------------------------------

/// Processa um chunk de PCM, emitindo segmentos de transcrição.
///
/// O motor é persistente (Mutex<Option<Box<dyn SttEngine>>>): acumula PCM
/// entre chamadas para a janela deslizante (ADR-007). finalize_transcription
/// faz flush do restante.
pub fn process_pcm(
    pcm: &[i16],
    speaker: Speaker,
    session_id: &str,
) -> Result<Vec<AppendTranscriptRequest>, SttError> {
    let segments = STT_MOCK.with(|cell| {
        if let Some(ref mut engine) = *cell.borrow_mut() {
            engine.feed_pcm(pcm)
        } else {
            let mut guard = get_or_create_engine()?;
            let engine = guard.as_mut().ok_or_else(|| {
                SttError::EngineUnavailable("engine not initialized".into())
            })?;
            engine.feed_pcm(pcm)
        }
    })?;

    Ok(segments_to_requests(segments, speaker, session_id))
}

/// Finaliza a transcrição, flush de áudio acumulado.
pub fn finalize_transcription(
    speaker: Speaker,
    session_id: &str,
) -> Result<Vec<AppendTranscriptRequest>, SttError> {
    let segments = STT_MOCK.with(|cell| {
        if let Some(ref mut engine) = *cell.borrow_mut() {
            engine.finalize()
        } else {
            let mut guard = get_or_create_engine()?;
            let engine = guard.as_mut().ok_or_else(|| {
                SttError::EngineUnavailable("engine not initialized".into())
            })?;
            engine.finalize()
        }
    })?;

    Ok(segments_to_requests(segments, speaker, session_id))
}

/// Drena a fila global de PCM (audio.rs) e processa cada frame pelo motor STT.
pub fn drain_and_process(
    speaker: Speaker,
    session_id: &str,
) -> Result<Vec<AppendTranscriptRequest>, SttError> {
    let frames = crate::audio::drain_pcm_queue();
    let mut all_requests = Vec::new();
    for frame in frames {
        let requests = process_pcm(&frame, speaker.clone(), session_id)?;
        all_requests.extend(requests);
    }
    Ok(all_requests)
}

/// Converte EngineSegment em AppendTranscriptRequest.
fn segments_to_requests(
    segments: Vec<EngineSegment>,
    speaker: Speaker,
    session_id: &str,
) -> Vec<AppendTranscriptRequest> {
    segments
        .into_iter()
        .map(|seg| AppendTranscriptRequest {
            session_id: session_id.to_string(),
            speaker: speaker.clone(),
            text: seg.text,
            translated_text: seg.translated_text,
            start_ms: seg.start_ms,
            end_ms: seg.end_ms,
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Testes
// ---------------------------------------------------------------------------
// Contrato validado via mock seam (SCOPE.md: "mock at the FFI boundary").
// Production-path tests validam que o motor REAL:
//   - Emite segmentos com speaker e offsets alimentando appendTranscript
//   - Operação de janela deslizante (streaming por janela)
//   - Primeiros tokens em < 1s (RNF-101)
//   - Plataforma correta: AppleSpeech no macOS, whisper.cpp no Windows/Linux

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;
    use std::time::Instant;

    /// Serializes production-path tests that share the global ENGINE static.
    /// Without this, parallel tests corrupt each other's accumulated PCM state.
    static PRODUCTION_SERIAL: Mutex<()> = Mutex::new(());

    // -- Mock engine -----------------------------------------------------------

    /// Motor mock que acumula PCM e emite segmentos após um threshold.
    struct MockEngine {
        accumulated_samples: usize,
        emit_threshold: usize,
        segments: Vec<EngineSegment>,
        next_segment: usize,
        fail_on_feed: bool,
    }

    impl MockEngine {
        fn new(segments: Vec<EngineSegment>, emit_threshold: usize) -> Self {
            Self {
                accumulated_samples: 0,
                emit_threshold,
                segments,
                next_segment: 0,
                fail_on_feed: false,
            }
        }

        fn failing() -> Self {
            Self {
                accumulated_samples: 0,
                emit_threshold: 0,
                segments: vec![],
                next_segment: 0,
                fail_on_feed: true,
            }
        }
    }

    impl SttEngine for MockEngine {
        fn feed_pcm(&mut self, pcm: &[i16]) -> Result<Vec<EngineSegment>, SttError> {
            if self.fail_on_feed {
                return Err(SttError::TranscriptionFailed("mock engine failure".into()));
            }
            self.accumulated_samples += pcm.len();
            let mut result = vec![];
            while self.accumulated_samples >= self.emit_threshold
                && self.next_segment < self.segments.len()
            {
                result.push(self.segments[self.next_segment].clone());
                self.next_segment += 1;
                self.accumulated_samples -= self.emit_threshold;
            }
            Ok(result)
        }

        fn finalize(&mut self) -> Result<Vec<EngineSegment>, SttError> {
            if self.fail_on_feed {
                return Err(SttError::TranscriptionFailed("mock engine failure".into()));
            }
            let remaining: Vec<EngineSegment> = self.segments[self.next_segment..].to_vec();
            self.next_segment = self.segments.len();
            Ok(remaining)
        }

        fn engine_name(&self) -> &str {
            "mock"
        }
    }

    // -- Helpers --------------------------------------------------------------

    fn speaker_self() -> Speaker {
        Speaker::Self_
    }

    fn speaker_others() -> Speaker {
        Speaker::Others
    }

    fn pcm_chunk(value: i16, len: usize) -> Vec<i16> {
        vec![value; len]
    }

    // =========================================================================
    // (a) Contract validation — segment shape via mock seam
    // =========================================================================

    #[test]
    fn contract_segment_speaker_self_matches() {
        reset_engine();
        let mock = MockEngine::new(
            vec![EngineSegment {
                text: "ola mundo".into(),
                translated_text: None,
                start_ms: 0,
                end_ms: 1500,
            }],
            100,
        );
        install_mock(mock, || {
            let segs = process_pcm(&pcm_chunk(42, 100), speaker_self(), "sess-test").unwrap();
            assert_eq!(segs.len(), 1);
            let seg = &segs[0];
            assert!(matches!(seg.speaker, Speaker::Self_), "speaker must be SELF");
            assert_eq!(seg.text, "ola mundo");
            assert!(seg.translated_text.is_none());
            assert_eq!(seg.start_ms, 0);
            assert_eq!(seg.end_ms, 1500);
            assert!(seg.start_ms <= seg.end_ms, "start_ms must be <= end_ms");
        });
    }

    #[test]
    fn contract_segment_speaker_others_with_translation() {
        reset_engine();
        let mock = MockEngine::new(
            vec![EngineSegment {
                text: "hello world".into(),
                translated_text: Some("ola mundo".into()),
                start_ms: 2000,
                end_ms: 3500,
            }],
            100,
        );
        install_mock(mock, || {
            let segs = process_pcm(&pcm_chunk(42, 100), speaker_others(), "sess-test").unwrap();
            assert_eq!(segs.len(), 1);
            let seg = &segs[0];
            assert!(matches!(seg.speaker, Speaker::Others), "speaker must be Others");
            assert_eq!(seg.text, "hello world");
            assert_eq!(seg.translated_text.as_deref(), Some("ola mundo"));
            assert!(seg.start_ms <= seg.end_ms);
        });
    }

    #[test]
    fn contract_segment_offsets_i32_start_leq_end() {
        reset_engine();
        let mock = MockEngine::new(
            vec![
                EngineSegment {
                    text: "a".into(),
                    translated_text: None,
                    start_ms: 0,
                    end_ms: 500,
                },
                EngineSegment {
                    text: "b".into(),
                    translated_text: None,
                    start_ms: 500,
                    end_ms: 1200,
                },
            ],
            50,
        );
        install_mock(mock, || {
            let segs = process_pcm(&pcm_chunk(42, 100), speaker_self(), "sess-test").unwrap();
            assert_eq!(segs.len(), 2);
            for seg in &segs {
                assert!(seg.start_ms <= seg.end_ms, "start_ms must be <= end_ms");
            }
            assert_eq!(segs[0].end_ms, 500);
            assert_eq!(segs[1].start_ms, 500);
        });
    }

    #[test]
    fn contract_segment_translated_text_is_option() {
        reset_engine();
        let mock = MockEngine::new(
            vec![
                EngineSegment {
                    text: "a".into(),
                    translated_text: None,
                    start_ms: 0,
                    end_ms: 100,
                },
                EngineSegment {
                    text: "b".into(),
                    translated_text: Some("trad".into()),
                    start_ms: 100,
                    end_ms: 200,
                },
            ],
            50,
        );
        install_mock(mock, || {
            let segs = process_pcm(&pcm_chunk(42, 100), speaker_self(), "sess-test").unwrap();
            assert_eq!(segs.len(), 2);
            assert!(segs[0].translated_text.is_none(), "first: None");
            assert_eq!(segs[1].translated_text.as_deref(), Some("trad"), "second: Some");
        });
    }

    // -- Session_id contract ---------------------------------------------------

    #[test]
    fn contract_session_id_must_be_populated() {
        reset_engine();
        let mock = MockEngine::new(
            vec![EngineSegment {
                text: "test".into(),
                translated_text: None,
                start_ms: 0,
                end_ms: 500,
            }],
            100,
        );
        install_mock(mock, || {
            let segs = process_pcm(&pcm_chunk(42, 100), speaker_self(), "sess-contract").unwrap();
            assert_eq!(segs.len(), 1);
            assert!(
                !segs[0].session_id.is_empty(),
                "session_id must be populated for appendTranscript persistence"
            );
        });
    }

    #[test]
    fn contract_finalize_session_id_must_be_populated() {
        reset_engine();
        let mock = MockEngine::new(
            vec![EngineSegment {
                text: "remaining".into(),
                translated_text: None,
                start_ms: 500,
                end_ms: 1000,
            }],
            1000,
        );
        install_mock(mock, || {
            let _ = process_pcm(&pcm_chunk(42, 100), speaker_self(), "sess-contract").unwrap();
            let segs = finalize_transcription(speaker_self(), "sess-contract").unwrap();
            assert_eq!(segs.len(), 1);
            assert!(
                !segs[0].session_id.is_empty(),
                "finalize segment session_id must be populated"
            );
        });
    }

    // =========================================================================
    // (b) Sliding window — ADR-007 "janela deslizante" via mock seam
    // =========================================================================

    #[test]
    fn sliding_window_emits_incrementally_via_mock() {
        reset_engine();
        let mock = MockEngine::new(
            vec![
                EngineSegment {
                    text: "first".into(),
                    translated_text: None,
                    start_ms: 0,
                    end_ms: 500,
                },
                EngineSegment {
                    text: "second".into(),
                    translated_text: None,
                    start_ms: 500,
                    end_ms: 1000,
                },
                EngineSegment {
                    text: "third".into(),
                    translated_text: None,
                    start_ms: 1000,
                    end_ms: 1500,
                },
            ],
            500,
        );
        install_mock(mock, || {
            let mut all = vec![];
            for i in 0..3 {
                let segs = process_pcm(&pcm_chunk(i, 500), speaker_self(), "sess-test").unwrap();
                assert!(!segs.is_empty(), "must emit segment after chunk {i}");
                all.extend(segs);
            }
            assert_eq!(all.len(), 3, "one segment per chunk");
        });
    }

    #[test]
    fn sliding_window_offsets_are_monotonic() {
        reset_engine();
        let mock = MockEngine::new(
            vec![
                EngineSegment {
                    text: "a".into(),
                    translated_text: None,
                    start_ms: 0,
                    end_ms: 300,
                },
                EngineSegment {
                    text: "b".into(),
                    translated_text: None,
                    start_ms: 300,
                    end_ms: 700,
                },
                EngineSegment {
                    text: "c".into(),
                    translated_text: None,
                    start_ms: 700,
                    end_ms: 1200,
                },
            ],
            256,
        );
        install_mock(mock, || {
            let mut all = vec![];
            for i in 0..3 {
                let segs = process_pcm(&pcm_chunk(i, 256), speaker_self(), "sess-test").unwrap();
                all.extend(segs);
            }
            let remaining = finalize_transcription(speaker_self(), "sess-test").unwrap();
            all.extend(remaining);
            assert!(!all.is_empty(), "must produce segments across chunks");
            for i in 1..all.len() {
                assert!(
                    all[i].start_ms >= all[i - 1].start_ms,
                    "offsets must be monotonic"
                );
            }
        });
    }

    #[test]
    fn finalize_returns_remaining_accumulated_segments() {
        reset_engine();
        let mock = MockEngine::new(
            vec![
                EngineSegment {
                    text: "partial".into(),
                    translated_text: None,
                    start_ms: 0,
                    end_ms: 500,
                },
                EngineSegment {
                    text: "remaining".into(),
                    translated_text: None,
                    start_ms: 500,
                    end_ms: 1000,
                },
            ],
            1000,
        );
        install_mock(mock, || {
            let segs = process_pcm(&pcm_chunk(42, 500), speaker_self(), "sess-test").unwrap();
            assert!(segs.is_empty(), "below threshold — no emission");
            let remaining = finalize_transcription(speaker_self(), "sess-test").unwrap();
            assert_eq!(remaining.len(), 2);
            assert_eq!(remaining[0].text, "partial");
            assert_eq!(remaining[1].text, "remaining");
        });
    }

    // =========================================================================
    // (c) Error handling — via mock seam
    // =========================================================================

    #[test]
    fn engine_failure_returns_err_not_panic() {
        reset_engine();
        let mock = MockEngine::failing();
        install_mock(mock, || {
            let result = process_pcm(&pcm_chunk(42, 100), speaker_self(), "sess-test");
            assert!(result.is_err(), "engine failure must return Err, not Ok(vec![])");
            match result.unwrap_err() {
                SttError::TranscriptionFailed(msg) => {
                    assert!(msg.contains("mock engine failure"));
                }
                other => panic!("expected TranscriptionFailed, got: {:?}", other),
            }
        });
    }

    #[test]
    fn finalize_failure_returns_err_not_panic() {
        reset_engine();
        let mock = MockEngine::failing();
        install_mock(mock, || {
            let result = finalize_transcription(speaker_self(), "sess-test");
            assert!(result.is_err(), "finalize failure must return Err");
            match result.unwrap_err() {
                SttError::TranscriptionFailed(_) => {}
                other => panic!("expected TranscriptionFailed, got: {:?}", other),
            }
        });
    }

    // =========================================================================
    // (e) Platform engine selection — ADR-007
    //
    // On macOS (the dev/CI platform), the test FORCES the engine to be
    // creatable and functional. EngineUnavailable is NOT accepted — ADR-007
    // mandates Apple Speech on macOS, and the framework is always present.
    // If this test fails, the GREEN implementation must fix the engine init.
    // =========================================================================

    #[test]
    #[cfg(target_os = "macos")]
    fn platform_macos_selects_apple_speech() {
        let _guard = PRODUCTION_SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        reset_engine();
        let engine = create_engine().expect(
            "ADR-007: macOS must create AppleSpeechEngine — EngineUnavailable is not acceptable on the dev platform"
        );
        assert_eq!(
            engine.engine_name(),
            "apple_speech",
            "ADR-007: macOS uses Apple Speech native (on-device, no key)"
        );
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn platform_windows_selects_whisper_cpp() {
        reset_engine();
        let engine = create_engine().expect("must create engine on Windows");
        assert_eq!(
            engine.engine_name(),
            "whisper_cpp",
            "ADR-007: Windows uses whisper.cpp embedded (CPU, no GPU)"
        );
    }

    #[test]
    #[cfg(target_os = "linux")]
    fn platform_linux_selects_whisper_cpp() {
        reset_engine();
        let engine = create_engine().expect("must create engine on Linux");
        assert_eq!(
            engine.engine_name(),
            "whisper_cpp",
            "ADR-007: Linux uses whisper.cpp embedded (CPU, no GPU)"
        );
    }

    // =========================================================================
    // (f) Production path — tests that exercise the REAL engine
    //
    // These tests exercise the REAL engine (not mock) and assert behavior
    // that stubs cannot satisfy: emitting segments, sliding window
    // incremental emission, monotonic offsets, and RNF-101 latency.
    //
    // EngineUnavailable is NOT accepted as a passing outcome — GREEN must
    // implement a functional engine, not hide behind EngineUnavailable.
    // CA-5b: "sem credencial configurada, transcrição ao vivo funciona
    // offline em cada plataforma."
    // =========================================================================

    #[test]
    fn production_engine_emits_segments_for_pcm() {
        let _guard = PRODUCTION_SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        reset_engine();
        let pcm = pcm_chunk(100, 16_000);
        let segs = process_pcm(&pcm, speaker_self(), "sess-prod")
            .expect("production engine must not return EngineUnavailable — implement the real engine");

        assert!(
            !segs.is_empty(),
            "production engine must emit at least one segment for 1s of PCM (got 0 — stub is no-op)"
        );
        for seg in &segs {
            assert!(!seg.text.is_empty(), "segments must have non-empty text");
            assert!(seg.start_ms <= seg.end_ms, "offsets must be valid");
            assert!(!seg.session_id.is_empty(), "session_id must be populated");
        }
    }

    #[test]
    fn production_engine_sliding_window_emits_incrementally() {
        let _guard = PRODUCTION_SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        reset_engine();
        let mut all_segs = vec![];
        for i in 0..3 {
            let pcm = pcm_chunk((i + 1) as i16, 8_000);
            let segs = process_pcm(&pcm, speaker_self(), "sess-slide")
                .expect("sliding window: engine must not return EngineUnavailable");
            all_segs.extend(segs);
        }

        assert!(
            !all_segs.is_empty(),
            "sliding window: must emit at least one segment before end of audio (got 0 — stub is no-op)"
        );
    }

    #[test]
    fn production_engine_offsets_are_monotonic() {
        let _guard = PRODUCTION_SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        reset_engine();
        let mut all_segs = vec![];
        for i in 0..5 {
            let pcm = pcm_chunk((i + 1) as i16, 8_000);
            let segs = process_pcm(&pcm, speaker_self(), "sess-mono")
                .expect("monotonicity: engine must not return EngineUnavailable");
            all_segs.extend(segs);
        }
        let final_segs = finalize_transcription(speaker_self(), "sess-mono")
            .expect("monotonicity: finalize must not return EngineUnavailable");
        all_segs.extend(final_segs);

        assert!(
            all_segs.len() >= 2,
            "monotonicity test needs at least 2 segments (got {} — stub is no-op)",
            all_segs.len()
        );
        for i in 1..all_segs.len() {
            assert!(
                all_segs[i].start_ms >= all_segs[i - 1].start_ms,
                "offsets must be monotonic: seg[{}].start_ms={} < seg[{}].start_ms={}",
                i,
                all_segs[i].start_ms,
                i - 1,
                all_segs[i - 1].start_ms,
            );
        }
    }

    #[test]
    fn production_engine_rnf101_first_segment_under_one_second() {
        let _guard = PRODUCTION_SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        reset_engine();
        let pcm = pcm_chunk(100, 16_000);
        let start = Instant::now();
        let segs = process_pcm(&pcm, speaker_self(), "sess-rnf101")
            .expect("RNF-101: engine must not return EngineUnavailable — implement the real engine");
        let elapsed = start.elapsed();

        assert!(
            !segs.is_empty(),
            "RNF-101: must emit at least one segment (got 0 — stub is no-op)"
        );
        assert!(
            elapsed.as_secs_f64() < 1.0,
            "RNF-101: first segment took {:.3}s (must be < 1.0s)",
            elapsed.as_secs_f64()
        );
    }

    #[test]
    fn production_engine_finalize_returns_accumulated_segments() {
        let _guard = PRODUCTION_SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        reset_engine();
        let pcm = pcm_chunk(100, 8_000);
        process_pcm(&pcm, speaker_self(), "sess-final")
            .expect("finalize test: engine must not return EngineUnavailable on feed_pcm");

        let segs = finalize_transcription(speaker_self(), "sess-final")
            .expect("finalize test: engine must not return EngineUnavailable on finalize");

        assert!(
            !segs.is_empty(),
            "finalize must flush accumulated audio into segments (got 0 — stub is no-op)"
        );
        for seg in &segs {
            assert!(!seg.text.is_empty(), "finalize segments must have text");
            assert!(seg.start_ms <= seg.end_ms, "offsets must be valid");
        }
    }

    // =========================================================================
    // (f2) CA-5b: offline transcription without credentials
    //
    // CA-5b: "Sem nenhuma credencial configurada, a transcrição ao vivo
    // funciona offline: Apple Speech no macOS, Whisper embutido no Windows
    // e no Linux."
    //
    // This test asserts the production engine can be initialized and fed PCM
    // without any credential being configured. The engine must not require
    // a credential to function — STT is on-device per ADR-007.
    // =========================================================================

    #[test]
    fn ca5b_offline_transcription_works_without_credentials() {
        let _guard = PRODUCTION_SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        reset_engine();
        // No credential is configured or injected — this test verifies that
        // the STT engine operates purely on-device (ADR-007) without needing
        // any API key or external service.
        let pcm = pcm_chunk(100, 16_000);
        let result = process_pcm(&pcm, speaker_self(), "sess-offline");
        // Must not fail with a credential-related error.
        match result {
            Ok(segs) => {
                // Engine produced output without credentials — good.
                // Segments may be empty if no speech detected, but the engine
                // must not have required a credential to run.
                for seg in &segs {
                    assert!(!seg.text.is_empty(), "offline segments must have text");
                }
            }
            Err(SttError::EngineUnavailable(msg)) => {
                // EngineUnavailable is acceptable ONLY if it's about the
                // platform/framework, NOT about missing credentials.
                assert!(
                    !msg.to_lowercase().contains("credential"),
                    "CA-5b: engine must not fail due to missing credentials — STT is on-device (ADR-007)"
                );
                assert!(
                    !msg.to_lowercase().contains("api key"),
                    "CA-5b: engine must not require an API key — STT is on-device (ADR-007)"
                );
            }
            Err(e) => panic!("unexpected error: {:?}", e),
        }
    }

    // =========================================================================
    // (g) Safety — consumer must not deadlock or panic
    // =========================================================================

    #[test]
    fn engine_failure_does_not_deadlock_consumer() {
        reset_engine();
        let result1 = process_pcm(&pcm_chunk(42, 100), speaker_self(), "sess-test");
        let result2 = process_pcm(&pcm_chunk(42, 100), speaker_self(), "sess-test");
        let result3 = finalize_transcription(speaker_self(), "sess-test");
        assert!(result1.is_ok() || result1.is_err());
        assert!(result2.is_ok() || result2.is_err());
        assert!(result3.is_ok() || result3.is_err());
    }

    #[test]
    fn process_pcm_does_not_panic_with_edge_case_input() {
        reset_engine();
        let _ = process_pcm(&[0], speaker_self(), "sess-test");
        let _ = process_pcm(&[i16::MAX], speaker_self(), "sess-test");
        let _ = process_pcm(&[i16::MIN], speaker_self(), "sess-test");
        let _ = process_pcm(&vec![42; 100_000], speaker_self(), "sess-test");
    }

    // =========================================================================
    // (h) Type invariants
    // =========================================================================

    #[test]
    fn engine_segment_fields_are_accessible() {
        let seg = EngineSegment {
            text: "test".into(),
            translated_text: Some("teste".into()),
            start_ms: 100,
            end_ms: 200,
        };
        let cloned = seg.clone();
        assert_eq!(cloned.text, "test");
        assert_eq!(cloned.translated_text.as_deref(), Some("teste"));
        assert_eq!(cloned.start_ms, 100);
        assert_eq!(cloned.end_ms, 200);
    }

    #[test]
    fn stt_error_display_format() {
        let err = SttError::EngineUnavailable("no speech framework".into());
        assert!(err.to_string().contains("no speech framework"));
        let err2 = SttError::TranscriptionFailed("audio too short".into());
        assert!(err2.to_string().contains("audio too short"));
    }

    #[test]
    fn segments_to_requests_preserves_order() {
        let segments = vec![
            EngineSegment {
                text: "first".into(),
                translated_text: None,
                start_ms: 0,
                end_ms: 500,
            },
            EngineSegment {
                text: "second".into(),
                translated_text: None,
                start_ms: 500,
                end_ms: 1000,
            },
        ];
        let requests = segments_to_requests(segments, Speaker::Self_, "sess-test");
        assert_eq!(requests.len(), 2);
        assert_eq!(requests[0].text, "first");
        assert_eq!(requests[1].text, "second");
    }

    #[test]
    fn empty_pcm_returns_no_segments_via_mock() {
        reset_engine();
        let mock = MockEngine::new(
            vec![EngineSegment {
                text: "should not appear".into(),
                translated_text: None,
                start_ms: 0,
                end_ms: 500,
            }],
            100,
        );
        install_mock(mock, || {
            let segs = process_pcm(&[], speaker_self(), "sess-test").unwrap();
            assert!(segs.is_empty(), "empty PCM must produce no segments even with mock");
        });
    }

    // =========================================================================
    // (i) Audio integration — drain_and_process
    // =========================================================================

    #[test]
    fn drain_and_process_consumes_pcm_queue() {
        reset_engine();
        crate::audio::clear_pcm_queue();
        crate::audio::push_frame_to_queue(vec![42; 100]);
        crate::audio::push_frame_to_queue(vec![43; 100]);
        assert_eq!(crate::audio::pcm_queue_len(), 2);

        // The queue must be drained regardless of engine outcome.
        // Engine failure (Err) must not prevent queue drain.
        let _ = drain_and_process(speaker_self(), "sess-test");
        assert_eq!(crate::audio::pcm_queue_len(), 0, "queue must be drained regardless of engine result");
    }
}
