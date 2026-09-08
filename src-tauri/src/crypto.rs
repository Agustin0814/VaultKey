use crate::errors::{Error, Result};
use argon2::{Algorithm, Argon2, Params, Version};
use chacha20poly1305::{
    aead::{Aead, Payload},
    KeyInit, XChaCha20Poly1305, XNonce,
};
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

#[derive(Serialize, Deserialize, Clone)]
#[serde(deny_unknown_fields)]
pub struct Metadata {
    pub version: u32,
    pub salt: [u8; 16],
    pub memory: u32,
    pub iterations: u32,
    pub parallelism: u32,
    pub argon_version: u32,
    pub wrapped: Encrypted,
}
#[derive(Serialize, Deserialize, Clone)]
pub struct Encrypted {
    pub nonce: Vec<u8>,
    pub ciphertext: Vec<u8>,
}
pub fn random<const N: usize>() -> Result<[u8; N]> {
    let mut out = [0; N];
    OsRng.try_fill_bytes(&mut out).map_err(|_| Error::Crypto)?;
    Ok(out)
}
pub fn derive(password: &str, m: &Metadata) -> Result<Zeroizing<[u8; 32]>> {
    // Bound untrusted on-disk parameters before allocating memory. Version 1 has one supported profile.
    if m.version != 1
        || m.argon_version != 19
        || m.memory != 65536
        || m.iterations != 3
        || m.parallelism != 4
    {
        return Err(Error::Unlock);
    }
    let params =
        Params::new(m.memory, m.iterations, m.parallelism, Some(32)).map_err(|_| Error::Crypto)?;
    let mut key = Zeroizing::new([0; 32]);
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(password.as_bytes(), &m.salt, key.as_mut())
        .map_err(|_| Error::Crypto)?;
    Ok(key)
}
pub fn seal(key: &[u8; 32], data: &[u8], aad: &[u8]) -> Result<Encrypted> {
    let nonce = random::<24>()?;
    let ciphertext = XChaCha20Poly1305::new(key.into())
        .encrypt(XNonce::from_slice(&nonce), Payload { msg: data, aad })
        .map_err(|_| Error::Crypto)?;
    Ok(Encrypted {
        nonce: nonce.to_vec(),
        ciphertext,
    })
}
pub fn open(key: &[u8; 32], data: &Encrypted, aad: &[u8]) -> Result<Zeroizing<Vec<u8>>> {
    if data.nonce.len() != 24 {
        return Err(Error::Integrity);
    }
    XChaCha20Poly1305::new(key.into())
        .decrypt(
            XNonce::from_slice(&data.nonce),
            Payload {
                msg: &data.ciphertext,
                aad,
            },
        )
        .map(Zeroizing::new)
        .map_err(|_| Error::Integrity)
}
pub fn wrap(password: &str, dek: &[u8; 32]) -> Result<Metadata> {
    let mut m = Metadata {
        version: 1,
        salt: random()?,
        memory: 65536,
        iterations: 3,
        parallelism: 4,
        argon_version: 19,
        wrapped: Encrypted {
            nonce: vec![],
            ciphertext: vec![],
        },
    };
    let kek = derive(password, &m)?;
    m.wrapped = seal(&kek, dek, b"VaultKey:1:DEK")?;
    Ok(m)
}
pub fn unwrap(password: &str, m: &Metadata) -> Result<Zeroizing<[u8; 32]>> {
    let kek = derive(password, m)?;
    let bytes = open(&kek, &m.wrapped, b"VaultKey:1:DEK").map_err(|_| Error::Unlock)?;
    if bytes.len() != 32 {
        return Err(Error::Unlock);
    }
    let mut key = Zeroizing::new([0; 32]);
    key.copy_from_slice(&bytes);
    Ok(key)
}
