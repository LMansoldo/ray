fn main() {
    tauri_build::build();

    // macOS: embute o Info.plist na seção __TEXT,__info_plist do binário.
    // O bundler do Tauri mescla o plist apenas no build EMPACOTADO; no dev o
    // binário roda desempacotado. Esta seção cobre as APIs que leem o plist
    // direto do executável (ex.: AVFoundation/microfone). ATENÇÃO: o Speech
    // (SFSpeechRecognizer.requestAuthorization) lê a usage description do
    // BUNDLE principal e o TCC aborta o processo mesmo com a seção — por
    // isso request_permission recusa em binário desempacotado e o dev usa
    // core/scripts/dev-app.sh (dev bundle real).
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap_or_default();
        let plist = std::path::Path::new(&manifest_dir).join("Info.plist");
        if plist.exists() {
            println!(
                "cargo:rustc-link-arg=-Wl,-sectcreate,__TEXT,__info_plist,{}",
                plist.display()
            );
        }
        println!("cargo:rerun-if-changed=Info.plist");
    }
}
