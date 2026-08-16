//! Cofre de credenciais (ADR-003). O núcleo Rust é o ÚNICO guardião do segredo.
//! Usa o keychain nativo via `keyring`. O banco guarda só um `secret_ref`
//! (ponteiro), nunca o segredo. TASK: implementar leitura/escrita reais.

use thiserror::Error;

#[derive(Debug, Error)]
pub enum VaultError {
    #[error("credential not found")]
    NotFound,
    #[error("vault backend error: {0}")]
    Backend(String),
}

const SERVICE: &str = "com.ray.app";

/// Grava um segredo no cofre e retorna o `secret_ref` a persistir no banco.
pub fn store_secret(_label: &str, _secret: &str) -> Result<String, VaultError> {
    // TASK: keyring::Entry::new(SERVICE, label)?.set_password(secret)?;
    // retornar um ref opaco (ex.: o próprio label namespaced).
    let _ = SERVICE;
    Err(VaultError::Backend("not_implemented".into()))
}

/// Recupera um segredo a partir do `secret_ref` para injeção efêmera.
pub fn get_secret(_secret_ref: &str) -> Result<String, VaultError> {
    // TASK: keyring::Entry::new(SERVICE, ref)?.get_password()
    Err(VaultError::Backend("not_implemented".into()))
}

/// Remove um segredo (rotação/remoção, RF-405).
pub fn delete_secret(_secret_ref: &str) -> Result<(), VaultError> {
    // TASK: keyring::Entry::new(SERVICE, ref)?.delete_password()
    Err(VaultError::Backend("not_implemented".into()))
}
