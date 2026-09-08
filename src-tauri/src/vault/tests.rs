use super::*;
use crate::{
    crypto::{open, seal},
    models::Credential,
};
const PASSWORD: &str = "ExamplePassword123!";
fn vault() -> (tempfile::TempDir, Vault) {
    let dir = tempfile::tempdir().unwrap();
    let v = Vault::new(Database::open(&dir.path().join("vault.db")).unwrap());
    (dir, v)
}
fn credential() -> Credential {
    let mut c = Credential::default();
    c.service = "Demo Service".into();
    c.access_method = "Email + Password".into();
    c.email = "example@example.com".into();
    c.password = "ExamplePassword123!".into();
    c
}
#[test]
fn crypto_roundtrip_and_unique_nonces() {
    let key = crypto::random().unwrap();
    let a = seal(&key, b"exact bytes\0\xff", b"record-a").unwrap();
    let b = seal(&key, b"exact bytes\0\xff", b"record-a").unwrap();
    assert_eq!(
        open(&key, &a, b"record-a").unwrap().as_slice(),
        b"exact bytes\0\xff"
    );
    assert_ne!(a.nonce, b.nonce);
    assert_ne!(a.ciphertext, b.ciphertext);
    assert!(open(&key, &a, b"record-b").is_err());
}
#[test]
fn tamper_and_invalid_nonce_fail() {
    let key = crypto::random().unwrap();
    let mut e = seal(&key, b"fake", b"aad").unwrap();
    e.ciphertext[0] ^= 1;
    assert!(matches!(open(&key, &e, b"aad"), Err(Error::Integrity)));
    e.nonce.clear();
    assert!(matches!(open(&key, &e, b"aad"), Err(Error::Integrity)));
}
#[test]
fn create_reopen_and_wrong_password() {
    let (dir, mut v) = vault();
    assert!(!v.db.exists().unwrap());
    v.create(PASSWORD).unwrap();
    assert!(v.create(PASSWORD).is_err());
    let id = v.save(None, credential(), true).unwrap();
    drop(v);
    let mut v = Vault::new(Database::open(&dir.path().join("vault.db")).unwrap());
    assert!(v.db.exists().unwrap());
    assert!(matches!(v.unlock("wrong password"), Err(Error::Unlock)));
    assert!(!v.unlocked());
    v.unlock(PASSWORD).unwrap();
    assert_eq!(v.get(&id).unwrap().password, PASSWORD);
}
#[test]
fn crud_search_and_lock() {
    let (_, mut v) = vault();
    v.create(PASSWORD).unwrap();
    let id = v.save(None, credential(), true).unwrap();
    assert_eq!(v.list("EXAMPLE@").unwrap().len(), 1);
    assert!(v.list("unmatched").unwrap().is_empty());
    let views = v.list("").unwrap();
    assert!(views[0].credential.password.is_empty());
    assert!(views[0].has_password);
    let mut c = credential();
    c.service = "Edited Service".into();
    c.password.clear();
    v.save(Some(id.clone()), c, false).unwrap();
    assert_eq!(v.get(&id).unwrap().password, PASSWORD);
    assert_eq!(v.get(&id).unwrap().service, "Edited Service");
    v.lock();
    assert!(v.dek.is_none());
    assert!(matches!(v.get(&id), Err(Error::Locked)));
    assert!(matches!(v.list(""), Err(Error::Locked)));
    v.unlock(PASSWORD).unwrap();
    v.delete(&id).unwrap();
    assert!(v.list("").unwrap().is_empty());
}
#[test]
fn password_rotation_only_rewraps_key() {
    let (_, mut v) = vault();
    v.create(PASSWORD).unwrap();
    let id = v.save(None, credential(), true).unwrap();
    let before = v.db.rows(false).unwrap()[0].1.clone();
    assert!(v
        .change_password("wrong password", "NewExamplePassword123!")
        .is_err());
    v.change_password(PASSWORD, "NewExamplePassword123!")
        .unwrap();
    let after = v.db.rows(false).unwrap()[0].1.clone();
    assert_eq!(before.ciphertext, after.ciphertext);
    assert_eq!(before.nonce, after.nonce);
    v.lock();
    assert!(v.unlock(PASSWORD).is_err());
    v.unlock("NewExamplePassword123!").unwrap();
    assert_eq!(v.get(&id).unwrap().password, PASSWORD);
}
#[test]
fn relations_and_delete_protection() {
    let (_, mut v) = vault();
    v.create(PASSWORD).unwrap();
    let parent = v.save(None, credential(), true).unwrap();
    let mut child = credential();
    child.service = "Demo Child".into();
    child.access_method = "Google".into();
    child.password.clear();
    child.linked_account = Some(parent.clone());
    let id = v.save(None, child, true).unwrap();
    assert_eq!(v.relations().unwrap().len(), 1);
    assert!(matches!(v.delete(&parent), Err(Error::Dependents)));
    assert!(!v.get(&id).unwrap().password.contains(PASSWORD));
    let mut cycle = v.get(&parent).unwrap();
    cycle.linked_account = Some(id.clone());
    assert!(v.save(Some(parent.clone()), cycle, false).is_err());
    v.delete(&id).unwrap();
    assert!(v.relations().unwrap().is_empty());
    v.delete(&parent).unwrap();
}
#[test]
fn corrupt_rows_abort_all_results() {
    let (_, mut v) = vault();
    v.create(PASSWORD).unwrap();
    v.save(None, credential(), true).unwrap();
    v.db.0
        .execute("UPDATE credentials SET payload=zeroblob(32)", [])
        .unwrap();
    assert!(matches!(v.list(""), Err(Error::Integrity)));
    v.lock();
    assert!(matches!(v.unlock(PASSWORD), Err(Error::Integrity)));
    assert!(!v.unlocked());
}
#[test]
fn expiry_does_not_need_frontend() {
    let (_, mut v) = vault();
    v.create(PASSWORD).unwrap();
    v.last = Instant::now() - Duration::from_secs(301);
    assert!(matches!(v.list(""), Err(Error::Locked)));
    assert!(v.dek.is_none());
    assert!(v.activity().is_err());
}
#[test]
fn persisted_data_contains_no_personal_plaintext() {
    let (dir, mut v) = vault();
    v.create(PASSWORD).unwrap();
    v.save(None, credential(), true).unwrap();
    drop(v);
    let bytes = std::fs::read(dir.path().join("vault.db")).unwrap();
    for text in [PASSWORD, "Demo Service", "example@example.com"] {
        assert!(!bytes.windows(text.len()).any(|s| s == text.as_bytes()));
    }
}
#[test]
fn invalid_payload_and_hostile_kdf_are_rejected() {
    let (_, mut v) = vault();
    v.create(PASSWORD).unwrap();
    let id = Uuid::new_v4().to_string();
    let e = seal(
        v.key().unwrap(),
        b"not json",
        format!("VaultKey:1:credential:{id}").as_bytes(),
    )
    .unwrap();
    v.db.put(&id, &e).unwrap();
    assert!(matches!(v.list(""), Err(Error::Integrity)));
    let mut m = v.db.metadata().unwrap();
    m.memory = u32::MAX;
    assert!(matches!(crypto::unwrap(PASSWORD, &m), Err(Error::Unlock)));
}
#[test]
fn invalid_input_is_rejected() {
    let (_, mut v) = vault();
    assert!(v.create("").is_err());
    assert!(v.create("short").is_err());
    v.create(PASSWORD).unwrap();
    let mut c = credential();
    c.service.clear();
    assert!(v.save(None, c, true).is_err());
    let mut c = credential();
    c.linked_account = Some(Uuid::new_v4().to_string());
    assert!(v.save(None, c, true).is_err());
}

#[test]
fn corrupt_database_and_missing_parent_fail_cleanly() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("corrupt.db");
    std::fs::write(&path, b"not a SQLite database").unwrap();
    assert!(matches!(Database::open(&path), Err(Error::Database)));
    assert!(matches!(
        Database::open(&dir.path().join("absent").join("vault.db")),
        Err(Error::Database)
    ));
}

#[test]
fn second_connection_cannot_mutate_an_open_vault() {
    let (dir, mut v) = vault();
    v.create(PASSWORD).unwrap();
    assert!(matches!(
        Database::open(&dir.path().join("vault.db")),
        Err(Error::Database)
    ));
    drop(v);
    assert!(Database::open(&dir.path().join("vault.db")).is_ok());
}
