#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("Vault is locked")]
    Locked,
    #[error("Incorrect password or invalid vault")]
    Unlock,
    #[error("Integrity error: encrypted data is invalid")]
    Integrity,
    #[error("Vault does not exist")]
    Missing,
    #[error("Vault already exists")]
    Exists,
    #[error("Database unavailable, busy, or unable to write")]
    Database,
    #[error("Invalid input or payload")]
    Invalid,
    #[error("Credential has linked dependents; unlink them before deleting")]
    Dependents,
    #[error("Clipboard unavailable")]
    Clipboard,
    #[error("Cryptographic operation failed")]
    Crypto,
}
impl From<rusqlite::Error> for Error {
    fn from(_: rusqlite::Error) -> Self {
        Self::Database
    }
}
impl From<serde_json::Error> for Error {
    fn from(_: serde_json::Error) -> Self {
        Self::Integrity
    }
}
pub type Result<T> = std::result::Result<T, Error>;
