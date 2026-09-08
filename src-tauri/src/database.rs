use crate::{
    crypto::{Encrypted, Metadata},
    errors::{Error, Result},
};
use rusqlite::Connection;
use std::{path::Path, time::Duration};
pub struct Database(pub Connection);
impl Database {
    pub fn open(path: &Path) -> Result<Self> {
        let c = Connection::open(path)?;
        c.busy_timeout(Duration::from_secs(3))?;
        c.execute_batch("PRAGMA journal_mode=DELETE; PRAGMA locking_mode=EXCLUSIVE; PRAGMA secure_delete=ON; PRAGMA trusted_schema=OFF; CREATE TABLE IF NOT EXISTS metadata (id INTEGER PRIMARY KEY CHECK(id=1), payload BLOB NOT NULL); CREATE TABLE IF NOT EXISTS credentials (id TEXT PRIMARY KEY, nonce BLOB NOT NULL, payload BLOB NOT NULL); CREATE TABLE IF NOT EXISTS relations (id TEXT PRIMARY KEY, nonce BLOB NOT NULL, payload BLOB NOT NULL);")?;
        Ok(Self(c))
    }
    pub fn exists(&self) -> Result<bool> {
        Ok(self
            .0
            .query_row("SELECT EXISTS(SELECT 1 FROM metadata)", [], |r| r.get(0))?)
    }
    pub fn metadata(&self) -> Result<Metadata> {
        if !self.exists()? {
            return Err(Error::Missing);
        }
        let data: Vec<u8> =
            self.0
                .query_row("SELECT payload FROM metadata WHERE id=1", [], |r| r.get(0))?;
        if data.len() > 4096 {
            return Err(Error::Integrity);
        }
        Ok(serde_json::from_slice(&data)?)
    }
    pub fn set_metadata(&self, m: &Metadata) -> Result<()> {
        self.0.execute("INSERT INTO metadata VALUES (1,?1) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",[serde_json::to_vec(m)?])?;
        Ok(())
    }
    pub fn rows(&self, relations: bool) -> Result<Vec<(String, Encrypted)>> {
        let sql = if relations {
            "SELECT id,nonce,payload FROM relations"
        } else {
            "SELECT id,nonce,payload FROM credentials"
        };
        let mut st = self.0.prepare(sql)?;
        let rows = st.query_map([], |r| {
            Ok((
                r.get(0)?,
                Encrypted {
                    nonce: r.get(1)?,
                    ciphertext: r.get(2)?,
                },
            ))
        })?;
        Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
    }
    #[cfg(test)]
    pub fn put(&self, id: &str, e: &Encrypted) -> Result<()> {
        self.0.execute("INSERT INTO credentials VALUES (?1,?2,?3) ON CONFLICT(id) DO UPDATE SET nonce=excluded.nonce,payload=excluded.payload",rusqlite::params![id,e.nonce,e.ciphertext])?;
        Ok(())
    }
}
