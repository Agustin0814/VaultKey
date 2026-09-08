use serde::{Deserialize, Serialize};
use zeroize::{Zeroize, ZeroizeOnDrop};

#[derive(Serialize, Deserialize, Clone, Default, Zeroize, ZeroizeOnDrop)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Credential {
    pub service: String,
    pub access_method: String,
    pub email: String,
    pub username: String,
    pub phone: String,
    pub password: String,
    pub linked_account: Option<String>,
    pub url: String,
    pub notes: String,
    pub category: String,
    pub favorite: bool,
    pub created_at: u64,
    pub updated_at: u64,
}
#[derive(Serialize, Deserialize, Zeroize, ZeroizeOnDrop)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Relation {
    pub source_credential_id: String,
    pub target_credential_id: String,
    pub relation_type: String,
    pub notes: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct View {
    pub id: String,
    #[serde(flatten)]
    pub credential: Credential,
    pub has_password: bool,
}
impl View {
    pub fn new(id: String, mut credential: Credential) -> Self {
        let has_password = !credential.password.is_empty();
        credential.password.zeroize();
        Self {
            id,
            credential,
            has_password,
        }
    }
}
