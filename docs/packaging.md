# Ray — Packaging and Distribution

Covers T-501 (RNF-401 / RID-3 / RID-6 / ADR-009).

## Distribution matrix

| Platform | Format | Architecture | Channel |
|----------|--------|--------------|---------|
| Linux    | AppImage | x86_64 | stable / unstable |
| Linux    | AppImage | aarch64 | stable / unstable |
| Linux    | .deb   | x86_64 | stable / unstable |
| Linux    | .deb   | aarch64 | stable / unstable |
| macOS    | .dmg   | universal (x86_64 + ARM64) | stable / unstable |
| Windows  | .msi   | x86_64 | stable / unstable |

**stable** — tagged releases (e.g. `1.0.0`).  
**unstable** — nightly / pre-release builds (e.g. `1.0.0-unstable`).  
Artifact naming: `ray_<version>[–unstable]_<arch>_<platform>.<ext>`.

## Estimated installer sizes

Sizes are approximate; actual CI measurements should update this table.

| Format | Baseline (no Whisper) | With ggml-tiny (default) | With ggml-small |
|--------|----------------------|--------------------------|-----------------|
| AppImage | ~45 MB | ~120 MB | ~185 MB |
| .deb     | ~42 MB | ~118 MB | ~183 MB |
| .dmg     | ~60 MB | n/a (macOS uses on-demand download) | n/a |
| .msi     | ~50 MB | ~125 MB | ~190 MB |

macOS builds do NOT embed the Whisper engine — the STT module downloads the model on first use, consistent with the lower macOS installer footprint expectation.

## Embedded Whisper engine (Windows and Linux only)

Per ADR-007 and RNF-404, the Whisper engine (`whisper.cpp`) and a default model are embedded into **Windows and Linux bundles only**.  
The engine runs entirely on CPU — no GPU dependency (RNF-404).

### Default model: ggml-tiny

- Embedded in the installer (≈75 MB).
- Minimum hardware: any modern CPU (x86_64 SSE4.2 or ARM64 NEON).
- Accuracy: suitable for meeting assistance; may struggle with heavy accents or low-quality audio.

### Hardware-based model selection guide

| RAM available | Recommended model | Approx size |
|---------------|-------------------|-------------|
| < 4 GB        | ggml-tiny         | 75 MB       |
| 4–8 GB        | ggml-base         | 145 MB      |
| 8–16 GB       | ggml-small        | 465 MB      |
| > 16 GB       | ggml-medium       | 1.5 GB      |

Selection is manual (Settings > AI > Whisper model). The app will expose a download button for larger models; the download is verified by SHA-256 checksum before use.

## On-demand model download

Larger Whisper models (base, small, medium, large) can be downloaded from the Ray release CDN on demand:

1. Open **Settings > AI > Whisper model**.
2. Select the target model size.
3. Ray fetches the `.bin` file, verifies SHA-256, and stores it under `$APP_DATA/whisper/`.
4. The new model is active on next recording session start.

Downloaded models are retained across app updates. Users may delete them from Settings to reclaim disk space.

## Sidecar bundling (ADR-009)

The Node.js sidecar is compiled to a self-contained binary per target triple using `pkg` / `ncc`.  
`core/binaries/` holds one stub per triple (replaced by real builds in CI):

| File | Triple | Platform |
|------|--------|----------|
| `ray-sidecar-aarch64-apple-darwin` | aarch64-apple-darwin | macOS ARM64 |
| `ray-sidecar-x86_64-apple-darwin` | x86_64-apple-darwin | macOS x86_64 |
| `ray-sidecar-x86_64-unknown-linux-gnu` | x86_64-unknown-linux-gnu | Linux x86_64 |
| `ray-sidecar-aarch64-unknown-linux-gnu` | aarch64-unknown-linux-gnu | Linux ARM64 |
| `ray-sidecar-x86_64-pc-windows-msvc.exe` | x86_64-pc-windows-msvc | Windows x86_64 |

Tauri resolves the correct binary at build time using the target triple suffix.

## Release pipeline

`core/scripts/release.sh` orchestrates per-platform builds.  
Run with `--dry-run` to verify artifact naming without building:

```sh
./core/scripts/release.sh --dry-run --channel stable   --platform linux
./core/scripts/release.sh --dry-run --channel unstable --platform macos
./core/scripts/release.sh --dry-run --channel stable   --platform windows
```

Actual signing requires `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (injected by CI — never committed). See `core/scripts/release.sh` for details.

## CI notes

Full installer builds and signing run only in GitHub Actions (the dev host lacks signing certificates and cross-compilation toolchains).  
`core/scripts/validate-packaging.sh` runs on the dev host and gates on manifest correctness + binary stub presence — no signing required.
