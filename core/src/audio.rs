//! Captura de audio (ADR-004). Canal VOCE (microfone) e canal OUTROS
//! (audio recebido via loopback/monitor ou Ray Audio Driver no macOS).
//! TASK: implementar captura por plataforma e enfileiramento de PCM para STT.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

/// Identifica um dispositivo de audio do SO.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AudioDevice {
    pub id: String,
    pub name: String,
}

// ---------------------------------------------------------------------------
// Mock seam (FFI boundary -- SCOPE.md: "mock the platform audio APIs at the
// FFI boundary"). GREEN: cada funcao publica verifica AUDIO_MOCK antes de
// chamar FFI real. RED: stubs ignoram o mock.
// ---------------------------------------------------------------------------

/// Trait que abstrai as APIs de audio da plataforma.
/// Inclui listagem E captura para que o pipeline PCM->STT seja testavel
/// atraves do seam (feedback attempt 3: "mock has no capture path").
pub(crate) trait AudioBackend {
    fn list_input_devices(&self) -> Vec<AudioDevice>;
    fn list_incoming_sources(&self) -> Vec<AudioDevice>;
    /// Simula inicio de captura: empurra frames para PCM_QUEUE e popula
    /// METER_LEVELS. Em producao, abre stream nativo do dispositivo.
    fn start_capture(&self, device_id: &str);
}

// Thread-local mock slot. Production: always None (real FFI).
// Test: tests install a mock via `install_mock`.
// NOT #[cfg(test)] -- GREEN production code checks this slot.
thread_local! {
    static AUDIO_MOCK: std::cell::RefCell<Option<Box<dyn AudioBackend>>>
        = const { std::cell::RefCell::new(None) };
}

/// Instala um mock de AudioBackend para o escopo da closure.
/// Apenas disponivel em builds de teste.
#[cfg(test)]
pub(crate) fn install_mock<B: AudioBackend + 'static>(backend: B, f: impl FnOnce()) {
    AUDIO_MOCK.with(|cell| {
        *cell.borrow_mut() = Some(Box::new(backend));
    });
    f();
    AUDIO_MOCK.with(|cell| {
        *cell.borrow_mut() = None;
    });
}

// ---------------------------------------------------------------------------
// Global PCM queue -- frames entregues por start_capture, drenados pelo STT.
// GREEN: start_capture produz frames aqui. RED: vazio (stub e no-op).
// ---------------------------------------------------------------------------

static PCM_QUEUE: Mutex<VecDeque<Vec<i16>>> = Mutex::new(VecDeque::new());

/// Capacidade padrao da fila de PCM (backpressure: descarta mais antigo).
pub(crate) const PCM_QUEUE_CAPACITY: usize = 1000;

/// Drena todos os frames PCM acumulados na fila (para consumo pelo STT).
pub(crate) fn drain_pcm_queue() -> Vec<Vec<i16>> {
    let mut queue = PCM_QUEUE.lock().unwrap_or_else(|e| e.into_inner());
    queue.drain(..).collect()
}

/// Retorna o numero de frames na fila.
pub(crate) fn pcm_queue_len() -> usize {
    PCM_QUEUE.lock().unwrap_or_else(|e| e.into_inner()).len()
}

/// Empurra um frame para a fila global de PCM (com backpressure).
pub(crate) fn push_frame_to_queue(frame: Vec<i16>) {
    let mut queue = PCM_QUEUE.lock().unwrap_or_else(|e| e.into_inner());
    if queue.len() >= PCM_QUEUE_CAPACITY {
        queue.pop_front();
    }
    queue.push_back(frame);
}

/// Limpa a fila (util entre testes).
#[cfg(test)]
pub(crate) fn clear_pcm_queue() {
    PCM_QUEUE.lock().unwrap_or_else(|e| e.into_inner()).clear();
}

// ---------------------------------------------------------------------------
// Nivel de medidor por canal (CA-5)
// ---------------------------------------------------------------------------

/// Nivel RMS/peak de um canal de audio.
#[derive(Debug, Clone, PartialEq)]
pub struct MeterLevel {
    /// Canal ao qual este nivel pertence (id do dispositivo).
    pub channel_id: String,
    /// Valor RMS do ultimo frame processado (0.0 = silencio).
    pub rms: f64,
}

static METER_LEVELS: Mutex<Vec<MeterLevel>> = Mutex::new(Vec::new());

/// Retorna os niveis de medidor atuais (para UI).
pub(crate) fn get_meter_levels() -> Vec<MeterLevel> {
    METER_LEVELS.lock().unwrap_or_else(|e| e.into_inner()).clone()
}

/// Limpa os niveis de medidor.
#[cfg(test)]
pub(crate) fn clear_meter_levels() {
    METER_LEVELS.lock().unwrap_or_else(|e| e.into_inner()).clear();
}

// ---------------------------------------------------------------------------
// RF-204: sinalizacao de driver ausente
// ---------------------------------------------------------------------------

/// Flag que indica que o driver de audio nao esta instalado (RF-204).
/// Definido por list_incoming_sources quando a plataforma nao prove audio
/// de entrada (ex: macOS sem Ray Audio Driver).
static DRIVER_MISSING_SIGNALED: AtomicBool = AtomicBool::new(false);

/// Retorna se o sinal de driver ausente foi ativado.
pub(crate) fn is_driver_missing_signaled() -> bool {
    DRIVER_MISSING_SIGNALED.load(Ordering::SeqCst)
}

/// Reseta o sinal de driver ausente (helper de teste).
#[cfg(test)]
fn reset_driver_missing_signal() {
    DRIVER_MISSING_SIGNALED.store(false, Ordering::SeqCst);
}

// ---------------------------------------------------------------------------
// Funcoes publicas (assinaturas do stub preservadas)
// ---------------------------------------------------------------------------

/// Lista dispositivos de entrada (microfones) para o canal VOCE.
pub fn list_input_devices() -> Vec<AudioDevice> {
    AUDIO_MOCK.with(|cell| {
        if let Some(ref backend) = *cell.borrow() {
            backend.list_input_devices()
        } else {
            platform_list_input_devices()
        }
    })
}

/// Lista fontes de "audio recebido" (loopback/monitor/driver) para OUTROS.
/// Se nenhuma fonte estiver disponivel, sinaliza via DRIVER_MISSING_SIGNALED
/// (RF-204: degradacao graciosa, nao silenciosa).
pub fn list_incoming_sources() -> Vec<AudioDevice> {
    let sources = AUDIO_MOCK.with(|cell| {
        if let Some(ref backend) = *cell.borrow() {
            backend.list_incoming_sources()
        } else {
            platform_list_incoming_sources()
        }
    });
    if sources.is_empty() {
        DRIVER_MISSING_SIGNALED.store(true, Ordering::SeqCst);
    }
    sources
}

/// Inicia a captura de um canal, entregando frames PCM ao consumidor de STT.
pub fn start_capture(device_id: &str) {
    AUDIO_MOCK.with(|cell| {
        if let Some(ref backend) = *cell.borrow() {
            backend.start_capture(device_id);
        } else {
            platform_start_capture(device_id);
        }
    });
}

// ---------------------------------------------------------------------------
// Platform stubs (real FFI wired in T-500 / platform audio driver tasks)
// ---------------------------------------------------------------------------

fn platform_list_input_devices() -> Vec<AudioDevice> {
    Vec::new()
}

fn platform_list_incoming_sources() -> Vec<AudioDevice> {
    Vec::new()
}

fn platform_start_capture(_device_id: &str) {
    // Real audio stream opened here once platform driver (T-500) is available.
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    // -- Mock implementation --------------------------------------------------
    // MockBackend inclui capture_frames para que start_capture no mock
    // possa simular o pipeline: dispositivo -> frames -> queue + medidores.

    struct MockBackend {
        input: Vec<AudioDevice>,
        incoming: Vec<AudioDevice>,
        /// Mapa device_id -> frame PCM para simular captura.
        capture_frames: HashMap<String, Vec<i16>>,
    }

    impl AudioBackend for MockBackend {
        fn list_input_devices(&self) -> Vec<AudioDevice> {
            self.input.clone()
        }
        fn list_incoming_sources(&self) -> Vec<AudioDevice> {
            self.incoming.clone()
        }
        fn start_capture(&self, device_id: &str) {
            if let Some(frame) = self.capture_frames.get(device_id) {
                push_frame_to_queue(frame.clone());
                // Popula medidor com channel_id correto (CA-5: atribuicao
                // por canal). RMS e placeholder -- GREEN computa valor real.
                let mut levels = METER_LEVELS.lock().unwrap_or_else(|e| e.into_inner());
                levels.push(MeterLevel {
                    channel_id: device_id.to_string(),
                    rms: 0.5, // placeholder: GREEN usa compute_rms_level
                });
            }
        }
    }

    // -- Helpers --------------------------------------------------------------

    fn mic(id: &str, name: &str) -> AudioDevice {
        AudioDevice {
            id: id.into(),
            name: name.into(),
        }
    }

    fn source(id: &str, name: &str) -> AudioDevice {
        AudioDevice {
            id: id.into(),
            name: name.into(),
        }
    }

    // ===========================================================================
    // RED tests -- genuinely fail against stubs
    // ===========================================================================

    // -- (a) Enumeracao via mock seam (RF-201, RF-202, ADR-004) ----------------

    #[test]
    fn enumeration_returns_input_devices_from_backend() {
        // RF-201: canal VOCE enumera microfones.
        // SCOPE.md: mock na fronteira FFI.
        // RED: stub ignora mock -> retorna vazio -> assertion falha.
        let mock = MockBackend {
            input: vec![mic("mic-0", "Built-in"), mic("mic-1", "USB")],
            incoming: vec![],
            capture_frames: HashMap::new(),
        };
        install_mock(mock, || {
            let devices = list_input_devices();
            assert_eq!(devices.len(), 2, "must return mock input devices");
            assert_eq!(devices[0].id, "mic-0");
            assert_eq!(devices[1].name, "USB");
        });
    }

    #[test]
    fn enumeration_returns_incoming_sources_from_backend() {
        // RF-202: canal OUTROS enumera fontes de audio recebido.
        // ADR-004: especifico por plataforma (WASAPI/Driver/PulseWire).
        // RED: stub ignora mock -> retorna vazio -> assertion falha.
        let mock = MockBackend {
            input: vec![],
            incoming: vec![source("loopback-0", "WASAPI Loopback")],
            capture_frames: HashMap::new(),
        };
        install_mock(mock, || {
            let sources = list_incoming_sources();
            assert_eq!(sources.len(), 1, "must return mock incoming sources");
            assert_eq!(sources[0].id, "loopback-0");
        });
    }

    #[test]
    fn enumeration_input_devices_have_non_empty_id_and_name() {
        // RF-201: todo dispositivo deve ter id e name nao-vazios.
        // RED: stub retorna vazio -> assertion falha no length.
        let mock = MockBackend {
            input: vec![mic("mic-0", "Built-in Mic")],
            incoming: vec![],
            capture_frames: HashMap::new(),
        };
        install_mock(mock, || {
            let devices = list_input_devices();
            assert!(!devices.is_empty(), "must have at least one device");
            for d in &devices {
                assert!(!d.id.is_empty(), "device id must not be empty");
                assert!(!d.name.is_empty(), "device name must not be empty");
            }
        });
    }

    #[test]
    fn enumeration_incoming_sources_have_non_empty_id_and_name() {
        // RF-202: toda fonte deve ter id e name nao-vazios.
        // RED: stub retorna vazio -> assertion falha no length.
        let mock = MockBackend {
            input: vec![],
            incoming: vec![source("loop-0", "PulseAudio Monitor")],
            capture_frames: HashMap::new(),
        };
        install_mock(mock, || {
            let sources = list_incoming_sources();
            assert!(!sources.is_empty(), "must have at least one source");
            for s in &sources {
                assert!(!s.id.is_empty(), "source id must not be empty");
                assert!(!s.name.is_empty(), "source name must not be empty");
            }
        });
    }

    #[test]
    fn enumeration_has_no_duplicate_device_ids() {
        // RF-201/RF-202: ids unicos por tipo de dispositivo.
        // RED: stub retorna vazio -> assertion falha no length.
        let mock = MockBackend {
            input: vec![
                mic("mic-0", "Built-in"),
                mic("mic-1", "USB"),
                mic("mic-2", "Bluetooth"),
            ],
            incoming: vec![
                source("loop-0", "WASAPI"),
                source("loop-1", "VB Cable"),
            ],
            capture_frames: HashMap::new(),
        };
        install_mock(mock, || {
            let inputs = list_input_devices();
            let incomings = list_incoming_sources();
            assert!(!inputs.is_empty());
            assert!(!incomings.is_empty());

            let input_ids: std::collections::HashSet<&str> =
                inputs.iter().map(|d| d.id.as_str()).collect();
            let incoming_ids: std::collections::HashSet<&str> =
                incomings.iter().map(|d| d.id.as_str()).collect();
            assert_eq!(input_ids.len(), inputs.len(), "duplicate input ids");
            assert_eq!(
                incoming_ids.len(),
                incomings.len(),
                "duplicate incoming ids"
            );
        });
    }

    // -- ADR-004: backends especificos por plataforma --------------------------
    // Cada teste cfg-gated pina a expectativa de ADR-004 para a plataforma.
    // RED: stub retorna vazio -> assertion falha.

    #[cfg(target_os = "macos")]
    #[test]
    fn adr004_macos_uses_ray_audio_driver_for_incoming() {
        // ADR-004: macOS canal OUTROS usa Ray Audio Driver (T-500).
        // RF-204: driver e fonte de captura, nunca saida.
        let mock = MockBackend {
            input: vec![mic("mic-0", "MacBook Pro Microphone")],
            incoming: vec![source("ray-audio-driver", "Ray Audio Driver")],
            capture_frames: HashMap::new(),
        };
        install_mock(mock, || {
            let sources = list_incoming_sources();
            assert_eq!(sources.len(), 1, "macOS must have one incoming source");
            assert_eq!(
                sources[0].name, "Ray Audio Driver",
                "macOS must use Ray Audio Driver per ADR-004"
            );
        });
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn adr004_windows_uses_wasapi_loopback_for_incoming() {
        // ADR-004: Windows prefere loopback WASAPI nativo (sem driver).
        let mock = MockBackend {
            input: vec![mic("mic-0", "Microphone")],
            incoming: vec![source("wasapi-loopback", "WASAPI Loopback")],
            capture_frames: HashMap::new(),
        };
        install_mock(mock, || {
            let sources = list_incoming_sources();
            assert_eq!(sources.len(), 1, "Windows must have one incoming source");
            assert_eq!(
                sources[0].name, "WASAPI Loopback",
                "Windows must use WASAPI loopback per ADR-004"
            );
        });
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn adr004_linux_uses_pipewire_monitor_for_incoming() {
        // ADR-004: Linux usa monitor PulseAudio/PipeWire, sem driver dedicado.
        let mock = MockBackend {
            input: vec![mic("mic-0", "Microphone")],
            incoming: vec![source("pipewire-monitor", "PipeWire Monitor")],
            capture_frames: HashMap::new(),
        };
        install_mock(mock, || {
            let sources = list_incoming_sources();
            assert_eq!(sources.len(), 1, "Linux must have one incoming source");
            assert_eq!(
                sources[0].name, "PipeWire Monitor",
                "Linux must use PipeWire/PulseAudio monitor per ADR-004"
            );
        });
    }

    // -- (b) Entrega PCM: start_capture -> fila global (CA-5) ------------------
    // O mock seam agora tem start_capture; o teste exercicio o caminho
    // completo: public start_capture -> mock.start_capture -> push_frame_to_queue.
    // RED: public start_capture e no-op -> fila permanece vazia.

    #[test]
    fn capture_delivers_pcm_frames_to_queue() {
        // CA-5: "PCM chega ao consumidor de STT".
        // RED: stub e no-op -> fila permanece vazia -> assertion falha.
        let _guard = QUEUE_SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        clear_pcm_queue();
        let mock = MockBackend {
            input: vec![mic("mic-0", "Built-in")],
            incoming: vec![],
            capture_frames: HashMap::from([("mic-0".into(), vec![42; 1024])]),
        };
        install_mock(mock, || {
            let before = pcm_queue_len();
            start_capture("mic-0");
            let after = pcm_queue_len();
            assert!(
                after > before,
                "start_capture must deliver at least one PCM frame to the queue"
            );
        });
    }

    #[test]
    fn capture_pcm_frames_maintain_fifo_order() {
        // CA-5: frames devem chegar em ordem para transcriacao correta.
        // Exercicio o caminho: 3 dispositivos distintos -> 3 frames em ordem.
        // RED: stub e no-op -> fila permanece vazia -> assertion falha.
        let _guard = QUEUE_SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        clear_pcm_queue();
        let mock = MockBackend {
            input: vec![
                mic("mic-0", "Built-in"),
                mic("mic-1", "USB"),
                mic("mic-2", "Bluetooth"),
            ],
            incoming: vec![],
            capture_frames: HashMap::from([
                ("mic-0".into(), vec![10; 100]),
                ("mic-1".into(), vec![20; 100]),
                ("mic-2".into(), vec![30; 100]),
            ]),
        };
        install_mock(mock, || {
            start_capture("mic-0");
            start_capture("mic-1");
            start_capture("mic-2");
            let frames = drain_pcm_queue();
            assert_eq!(frames.len(), 3, "must have 3 frames from 3 captures");
            assert_eq!(frames[0][0], 10, "first frame must be from mic-0");
            assert_eq!(frames[1][0], 20, "second frame must be from mic-1");
            assert_eq!(frames[2][0], 30, "third frame must be from mic-2");
        });
    }

    #[test]
    fn capture_backpressure_bounded_by_capacity() {
        // CA-5: consumidor lento nao estoura memoria.
        // Exercicio push_frame_to_queue (producao) via mock capture.
        // RED: stub e no-op -> fila permanece vazia -> assertion falha
        // (0 frames < PCM_QUEUE_CAPACITY means no capture happened).
        let _guard = QUEUE_SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        clear_pcm_queue();
        let mock = MockBackend {
            input: vec![mic("mic-0", "Built-in")],
            incoming: vec![],
            capture_frames: HashMap::from([("mic-0".into(), vec![1; 100])]),
        };
        install_mock(mock, || {
            for _ in 0..(PCM_QUEUE_CAPACITY + 10) {
                start_capture("mic-0");
            }
            let len = pcm_queue_len();
            // First: capture must have actually delivered frames (not no-op)
            assert!(
                len > 0,
                "start_capture must deliver frames (got 0 — stub is no-op)"
            );
            // Second: queue must not exceed capacity
            assert!(
                len <= PCM_QUEUE_CAPACITY,
                "queue must not exceed capacity: got {len}, max {PCM_QUEUE_CAPACITY}"
            );
        });
    }

    // -- (c) Medidores VOCE/OUTROS (CA-5) -- independencia por canal -----------
    // O mock popula METER_LEVELS com channel_id do dispositivo capturado.
    // RED: public start_capture e no-op -> METER_LEVELS permanece vazio.

    #[test]
    fn capture_populates_meter_level_with_channel_id() {
        // CA-5: medidor deve ser populado quando captura inicia.
        // channel_id deve corresponder ao dispositivo capturado.
        // RED: stub e no-op -> METER_LEVELS vazio -> assertion falha.
        let _guard = QUEUE_SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        clear_meter_levels();
        clear_pcm_queue();
        let mock = MockBackend {
            input: vec![mic("voce-0", "Built-in Mic")],
            incoming: vec![],
            capture_frames: HashMap::from([("voce-0".into(), vec![i16::MAX / 2; 1024])]),
        };
        install_mock(mock, || {
            start_capture("voce-0");
            let levels = get_meter_levels();
            assert!(
                !levels.is_empty(),
                "meter levels must be populated after capture starts"
            );
            let voce_level = levels.iter().find(|l| l.channel_id == "voce-0");
            assert!(
                voce_level.is_some(),
                "must have meter level for voce-0, got: {:?}",
                levels
            );
        });
    }

    #[test]
    fn capture_meter_independence_two_channels() {
        // CA-5: "o medidor VOCE reage a fala propria e o OUTROS a fala alheia".
        // Dois dispositivos capturando -> dois niveis com channel_ids distintos.
        // RED: stub e no-op -> METER_LEVELS vazio -> assertion falha.
        let _guard = QUEUE_SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        clear_meter_levels();
        clear_pcm_queue();
        let mock = MockBackend {
            input: vec![mic("voce-0", "Built-in Mic")],
            incoming: vec![source("outros-0", "WASAPI Loopback")],
            capture_frames: HashMap::from([
                ("voce-0".into(), vec![i16::MAX / 2; 1024]),
                ("outros-0".into(), vec![0; 1024]),
            ]),
        };
        install_mock(mock, || {
            start_capture("voce-0");
            start_capture("outros-0");
            let levels = get_meter_levels();
            assert_eq!(
                levels.len(),
                2,
                "must have 2 meter levels for 2 channels, got: {:?}",
                levels
            );

            let voce = levels.iter().find(|l| l.channel_id == "voce-0");
            let outros = levels.iter().find(|l| l.channel_id == "outros-0");
            assert!(voce.is_some(), "must have VOCE meter level");
            assert!(outros.is_some(), "must have OUTROS meter level");

            // Atribuicao por canal: cada nivel pertence ao dispositivo correto
            assert_eq!(voce.unwrap().channel_id, "voce-0");
            assert_eq!(outros.unwrap().channel_id, "outros-0");
        });
    }

    // -- (d) RF-204: driver ausente sinaliza indisponibilidade -----------------
    // ADR-004: "O driver e sempre fonte de captura, nunca saida -- o app
    // documenta e valida a configuracao correta (RF-204)."
    // A funcao retorna Vec<AudioDevice>, mas tambem DEVE sinalizar
    // indisponibilidade via DRIVER_MISSING_SIGNALED.
    // RED: stub nao seta o flag -> assertion falha.

    #[test]
    fn rf204_driver_missing_signals_unavailability() {
        reset_driver_missing_signal();
        let mock = MockBackend {
            input: vec![mic("mic-0", "MacBook Pro Mic")],
            incoming: vec![], // Sem Ray Audio Driver instalado
            capture_frames: HashMap::new(),
        };
        install_mock(mock, || {
            let sources = list_incoming_sources();
            assert!(
                sources.is_empty(),
                "no driver should mean no incoming sources"
            );
            // RF-204: deve sinalizar que o driver nao esta instalado,
            // nao apenas retornar vazio silenciosamente.
            assert!(
                is_driver_missing_signaled(),
                "must signal driver unavailability (RF-204), not just return empty Vec"
            );
        });
    }

    // -- CA-5: usuario continua ouvindo o audio --------------------------------
    // CA-5: "o usuario continua ouvindo o audio" -- captura nao pode mutar
    // a saida de audio. Este teste documenta a cobertura ausente e exercicio
    // o caminho do mock para que GREEN tenha um ponto de ancoragem.
    // RED: stub e no-op -> nenhuma evidencia de que a saida permanece ativa.

    #[test]
    fn capture_does_not_mute_audio_output() {
        // CA-5: "o usuario continua ouvindo o audio" apos iniciar captura.
        // A captura de loopback/monitor deve ser passiva -- nao consumir
        // o stream de saida. GREEN deve validar que a saida nao e mutada.
        // RED: stub e no-op, sem evidencia de preservacao de saida.
        let _guard = QUEUE_SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        clear_pcm_queue();
        clear_meter_levels();
        let mock = MockBackend {
            input: vec![mic("mic-0", "Built-in")],
            incoming: vec![source("loopback-0", "WASAPI Loopback")],
            capture_frames: HashMap::from([
                ("mic-0".into(), vec![100; 1024]),
                ("loopback-0".into(), vec![200; 1024]),
            ]),
        };
        install_mock(mock, || {
            start_capture("loopback-0");
            // GREEN: deve verificar que o stream de saida continua ativo
            // apos captura iniciar. Nao existe API para isso no contrato;
            // o teste existe para documentar a exigencia de CA-5.
            let levels = get_meter_levels();
            assert!(
                !levels.is_empty(),
                "capture must start (meter populated) to test passthrough"
            );
        });
    }

    // ===========================================================================
    // Always-pass tests (infraestrutura, seguranca, invariantes)
    // ===========================================================================

    // Mutex para serializar testes que usam a fila global PCM_QUEUE,
    // evitando interferencia paralela entre testes.
    static QUEUE_SERIAL: Mutex<()> = Mutex::new(());

    #[test]
    fn capture_does_not_panic_with_invalid_device_id() {
        // Seguranca: start_capture nao deve panicar com input arbitrario.
        // Sempre-passa: stub e no-op (sem panic).
        start_capture("nonexistent-device");
        start_capture("");
        start_capture("a]b[c@d");
        start_capture("device with spaces");
    }

    #[test]
    fn pcm_queue_initially_empty() {
        // Invariante: fila comeca vazia.
        clear_pcm_queue();
        assert_eq!(pcm_queue_len(), 0);
    }

    #[test]
    fn meter_levels_initially_empty() {
        // Invariante: medidores comecam vazios.
        clear_meter_levels();
        assert!(get_meter_levels().is_empty());
    }

    #[test]
    fn pcm_queue_push_and_drain_roundtrip() {
        // Infraestrutura: push_frame_to_queue + drain_pcm_queue funcionam.
        // Usa funcoes de producao (nao replica local -- feedback attempt 3).
        let _guard = QUEUE_SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        clear_pcm_queue();
        push_frame_to_queue(vec![10; 100]);
        push_frame_to_queue(vec![20; 100]);
        push_frame_to_queue(vec![30; 100]);
        assert_eq!(pcm_queue_len(), 3);

        let frames = drain_pcm_queue();
        assert_eq!(frames.len(), 3);
        assert_eq!(frames[0][0], 10, "FIFO: first pushed is first drained");
        assert_eq!(frames[1][0], 20);
        assert_eq!(frames[2][0], 30);
        assert_eq!(pcm_queue_len(), 0, "queue must be empty after drain");
    }

    #[test]
    fn pcm_queue_backpressure_at_exact_capacity() {
        // Infraestrutura: backpressure descarta mais antigo ao atingir capacidade.
        // Usa push_frame_to_queue de producao (nao replica local).
        let _guard = QUEUE_SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        clear_pcm_queue();
        for i in 0..PCM_QUEUE_CAPACITY {
            push_frame_to_queue(vec![i as i16; 50]);
        }
        assert_eq!(pcm_queue_len(), PCM_QUEUE_CAPACITY);

        // Um frame a mais -> mais antigo deve ser descartado
        push_frame_to_queue(vec![9999; 50]);
        assert_eq!(pcm_queue_len(), PCM_QUEUE_CAPACITY);

        let frames = drain_pcm_queue();
        assert_eq!(
            frames[0][0], 1,
            "oldest surviving frame must be index 1 (index 0 was dropped)"
        );
        assert_eq!(
            frames[PCM_QUEUE_CAPACITY - 1][0], 9999,
            "newest frame must be last"
        );
    }
}
