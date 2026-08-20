//! Cofre de credenciais (ADR-003). O núcleo Rust é o ÚNICO guardião do segredo.
//! Usa o keychain nativo via `keyring`. O banco guarda só um `secret_ref`
//! (ponteiro), nunca o segredo.

use keyring::Entry;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum VaultError {
    #[error("credential not found")]
    NotFound,
    #[error("vault backend error: {0}")]
    Backend(String),
}

const SERVICE: &str = "com.ray.app";

fn map_keyring_err(e: keyring::Error) -> VaultError {
    VaultError::Backend(e.to_string())
}

fn map_not_found_or_backend(e: keyring::Error) -> VaultError {
    match e {
        keyring::Error::NoEntry => VaultError::NotFound,
        other => VaultError::Backend(other.to_string()),
    }
}

/// Grava um segredo no cofre e retorna o `secret_ref` a persistir no banco.
///
/// O `secret_ref` é opaco — não contém o segredo em claro. Internamente é o
/// `label` usado como chave no keyring nativo (service = `SERVICE`).
pub fn store_secret(label: &str, secret: &str) -> Result<String, VaultError> {
    let entry = Entry::new(SERVICE, label).map_err(map_keyring_err)?;
    entry.set_password(secret).map_err(map_keyring_err)?;
    Ok(label.to_string())
}

/// Recupera um segredo a partir do `secret_ref` para injeção efêmera.
pub fn get_secret(secret_ref: &str) -> Result<String, VaultError> {
    let entry = Entry::new(SERVICE, secret_ref).map_err(map_keyring_err)?;
    entry.get_password().map_err(map_not_found_or_backend)
}

/// Remove um segredo (rotação/remoção, RF-405).
pub fn delete_secret(secret_ref: &str) -> Result<(), VaultError> {
    let entry = Entry::new(SERVICE, secret_ref).map_err(map_keyring_err)?;
    entry.delete_credential().map_err(map_not_found_or_backend)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Gera um label único por execução para evitar colisão no keychain.
    /// Usa pid + contador atômico — sem dependências externas.
    fn unique_label(prefix: &str) -> String {
        use std::sync::atomic::{AtomicU32, Ordering};
        static COUNTER: AtomicU32 = AtomicU32::new(0);
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        let pid = std::process::id();
        format!("{prefix}_{pid}_{n}")
    }

    // ---------------------------------------------------------------
    // (a) store → get retorna o valor exato; delete → get retorna NotFound
    // ---------------------------------------------------------------
    #[test]
    fn store_get_delete_cycle_returns_exact_secret() {
        let label = unique_label("cycle");
        let secret = "sk-test-super-secret-value-42";

        // store
        let secret_ref = store_secret(&label, secret)
            .expect("store_secret should succeed on native keychain");

        // get — valor exato
        let recovered = get_secret(&secret_ref)
            .expect("get_secret should return the stored value");
        assert_eq!(recovered, secret, "recovered secret must match stored value");

        // delete → get deve retornar NotFound
        delete_secret(&secret_ref)
            .expect("delete_secret should succeed");
        let result = get_secret(&secret_ref);
        assert!(result.is_err(), "get after delete must fail");
        assert!(
            matches!(result.unwrap_err(), VaultError::NotFound),
            "get after delete must return VaultError::NotFound"
        );
    }

    // ---------------------------------------------------------------
    // (b) dois labels diferentes não se sobrescrevem
    // ---------------------------------------------------------------
    #[test]
    fn two_different_labels_do_not_overwrite() {
        let label_a = unique_label("label_a");
        let label_b = unique_label("label_b");
        let secret_a = "secret-alpha-aaa";
        let secret_b = "secret-beta-bbb";

        let ref_a = store_secret(&label_a, secret_a)
            .expect("store label_a should succeed");
        let ref_b = store_secret(&label_b, secret_b)
            .expect("store label_b should succeed");

        // Ambos devem ser recuperáveis independentemente
        let got_a = get_secret(&ref_a).expect("get label_a should succeed");
        let got_b = get_secret(&ref_b).expect("get label_b should succeed");

        assert_eq!(got_a, secret_a, "label_a must return its own secret");
        assert_eq!(got_b, secret_b, "label_b must return its own secret");
        assert_ne!(got_a, got_b, "different labels must not overwrite each other");

        // Cleanup: deletar ambas as entradas
        let _ = delete_secret(&ref_a);
        let _ = delete_secret(&ref_b);
    }

    // ---------------------------------------------------------------
    // (c) get_secret com ref inexistente retorna NotFound
    // ---------------------------------------------------------------
    #[test]
    fn get_nonexistent_returns_not_found() {
        let fake_ref = unique_label("nonexistent");
        let result = get_secret(&fake_ref);
        assert!(result.is_err(), "get_secret for nonexistent ref must fail");
        assert!(
            matches!(result.unwrap_err(), VaultError::NotFound),
            "nonexistent ref must produce VaultError::NotFound, not a backend error"
        );
    }

    // ---------------------------------------------------------------
    // (d) secret_ref não contém o segredo em claro
    // ---------------------------------------------------------------
    #[test]
    fn secret_ref_does_not_contain_plaintext_secret() {
        let label = unique_label("opaque");
        let secret = "super-sensitive-api-key-do-not-leak";

        let secret_ref = store_secret(&label, secret)
            .expect("store_secret should succeed");

        // O ref retornado não deve conter o segredo como substring
        assert!(
            !secret_ref.contains(secret),
            "secret_ref must NOT contain the plaintext secret — ADR-003 violation"
        );

        // Cleanup
        let _ = delete_secret(&secret_ref);
    }
}
