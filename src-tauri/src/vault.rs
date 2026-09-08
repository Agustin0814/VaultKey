use crate::{
    crypto,
    database::Database,
    errors::{Error, Result},
    models::{Credential, Relation, View},
};
use secrecy::{ExposeSecret, Secret};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use uuid::Uuid;
use zeroize::Zeroizing;

pub struct Vault {
    pub db: Database,
    dek: Option<Secret<[u8; 32]>>,
    last: Instant,
    pub timeout: Duration,
}
impl Vault {
    pub fn new(db: Database) -> Self {
        Self {
            db,
            dek: None,
            last: Instant::now(),
            timeout: Duration::from_secs(300),
        }
    }
    pub fn lock(&mut self) {
        self.dek = None;
    }
    pub fn expire(&mut self) -> bool {
        if self.dek.is_some() && self.last.elapsed() >= self.timeout {
            self.lock();
            return true;
        }
        false
    }
    pub fn unlocked(&mut self) -> bool {
        self.expire();
        self.dek.is_some()
    }
    fn key(&mut self) -> Result<&[u8; 32]> {
        self.expire();
        self.dek
            .as_ref()
            .map(|k| k.expose_secret())
            .ok_or(Error::Locked)
    }
    pub fn activity(&mut self) -> Result<()> {
        self.key()?;
        self.last = Instant::now();
        Ok(())
    }
    pub fn create(&mut self, password: &str) -> Result<()> {
        if self.db.exists()? {
            return Err(Error::Exists);
        }
        Self::validate_password(password)?;
        let dek = Zeroizing::new(crypto::random::<32>()?);
        let metadata = crypto::wrap(password, &dek)?;
        self.db.set_metadata(&metadata)?;
        self.dek = Some(Secret::new(*dek));
        self.last = Instant::now();
        Ok(())
    }
    pub fn unlock(&mut self, password: &str) -> Result<()> {
        self.lock();
        let metadata = self.db.metadata().map_err(|_| Error::Unlock)?;
        let dek = crypto::unwrap(password, &metadata)?;
        self.dek = Some(Secret::new(*dek));
        self.last = Instant::now();
        if self.all().is_err() || self.relations().is_err() {
            self.lock();
            return Err(Error::Integrity);
        }
        Ok(())
    }
    fn validate_password(password: &str) -> Result<()> {
        if password.chars().count() < 12 || password.len() > 1024 {
            return Err(Error::Invalid);
        }
        Ok(())
    }
    pub fn change_password(&mut self, current: &str, new: &str) -> Result<()> {
        self.key()?;
        Self::validate_password(new)?;
        let dek = crypto::unwrap(current, &self.db.metadata()?)?;
        let m = crypto::wrap(new, &dek)?;
        self.db.set_metadata(&m)
    }
    fn all(&mut self) -> Result<Vec<(String, Credential)>> {
        self.key()?;
        let rows = self.db.rows(false)?;
        let key = self.key()?;
        rows.into_iter()
            .map(|(id, e)| {
                let plain =
                    crypto::open(key, &e, format!("VaultKey:1:credential:{id}").as_bytes())?;
                let c = serde_json::from_slice(&plain)?;
                Ok((id, c))
            })
            .collect()
    }
    pub fn relations(&mut self) -> Result<Vec<Relation>> {
        self.key()?;
        let rows = self.db.rows(true)?;
        let key = self.key()?;
        rows.into_iter()
            .map(|(id, e)| {
                let plain = crypto::open(key, &e, format!("VaultKey:1:relation:{id}").as_bytes())?;
                Ok(serde_json::from_slice(&plain)?)
            })
            .collect()
    }
    pub fn list(&mut self, query: &str) -> Result<Vec<View>> {
        if query.len() > 1024 {
            return Err(Error::Invalid);
        }
        let q = query.to_lowercase();
        let mut views: Vec<View> = self
            .all()?
            .into_iter()
            .filter(|(_, c)| {
                [
                    &c.service,
                    &c.email,
                    &c.username,
                    &c.category,
                    &c.access_method,
                ]
                .iter()
                .any(|v| v.to_lowercase().contains(&q))
            })
            .map(|(id, c)| View::new(id, c))
            .collect();
        views.sort_by(|a, b| {
            a.credential
                .service
                .to_lowercase()
                .cmp(&b.credential.service.to_lowercase())
        });
        Ok(views)
    }
    pub fn get(&mut self, id: &str) -> Result<Credential> {
        self.all()?
            .into_iter()
            .find(|(i, _)| i == id)
            .map(|(_, c)| c)
            .ok_or(Error::Invalid)
    }
    pub fn save(
        &mut self,
        id: Option<String>,
        mut c: Credential,
        replace_password: bool,
    ) -> Result<String> {
        self.key()?;
        let methods = [
            "Email + Password",
            "Username + Password",
            "Phone + Password",
            "Google",
            "Facebook",
            "Apple",
            "Microsoft",
            "Linked Account",
            "Custom",
        ];
        if c.service.trim().is_empty()
            || c.service.len() > 256
            || !methods.contains(&c.access_method.as_str())
        {
            return Err(Error::Invalid);
        }
        let id = match id {
            Some(id) => {
                let old = self.get(&id)?;
                c.created_at = old.created_at;
                if !replace_password {
                    c.password = old.password.clone();
                }
                id
            }
            None => {
                c.created_at = now();
                Uuid::new_v4().to_string()
            }
        };
        c.updated_at = now();
        if let Some(parent) = &c.linked_account {
            if parent == &id {
                return Err(Error::Invalid);
            }
            let all = self.all()?;
            let mut cursor = Some(parent.clone());
            let mut seen = std::collections::HashSet::new();
            while let Some(ref p) = cursor {
                if p == &id || !seen.insert(p.clone()) {
                    return Err(Error::Invalid);
                }
                cursor = all
                    .iter()
                    .find(|(i, _)| i == p)
                    .ok_or(Error::Invalid)?
                    .1
                    .linked_account
                    .clone();
            }
        }
        let plain = Zeroizing::new(serde_json::to_vec(&c)?);
        if plain.len() > 65536 {
            return Err(Error::Invalid);
        }
        let encrypted = crypto::seal(
            self.key()?,
            &plain,
            format!("VaultKey:1:credential:{id}").as_bytes(),
        )?;
        // One incoming relation per credential; the relation ID is independent of both endpoints.
        let old_relations = self.db.rows(true)?;
        let mut remove = vec![];
        for (rid, e) in old_relations {
            let data = crypto::open(
                self.key()?,
                &e,
                format!("VaultKey:1:relation:{rid}").as_bytes(),
            )?;
            let r: Relation = serde_json::from_slice(&data)?;
            if r.target_credential_id == id {
                remove.push(rid);
            }
        }
        let relation = if let Some(source) = &c.linked_account {
            let rid = Uuid::new_v4().to_string();
            let r = Relation {
                source_credential_id: source.clone(),
                target_credential_id: id.clone(),
                relation_type: c.access_method.clone(),
                notes: String::new(),
            };
            let data = Zeroizing::new(serde_json::to_vec(&r)?);
            let e = crypto::seal(
                self.key()?,
                &data,
                format!("VaultKey:1:relation:{rid}").as_bytes(),
            )?;
            Some((rid, e))
        } else {
            None
        };
        let tx = self.db.0.transaction()?;
        tx.execute("INSERT INTO credentials VALUES (?1,?2,?3) ON CONFLICT(id) DO UPDATE SET nonce=excluded.nonce,payload=excluded.payload",rusqlite::params![id,encrypted.nonce,encrypted.ciphertext])?;
        for rid in remove {
            tx.execute("DELETE FROM relations WHERE id=?1", [rid])?;
        }
        if let Some((rid, e)) = relation {
            tx.execute(
                "INSERT INTO relations VALUES (?1,?2,?3)",
                rusqlite::params![rid, e.nonce, e.ciphertext],
            )?;
        }
        tx.commit()?;
        Ok(id)
    }
    pub fn delete(&mut self, id: &str) -> Result<()> {
        self.get(id)?;
        if self
            .all()?
            .iter()
            .any(|(_, c)| c.linked_account.as_deref() == Some(id))
        {
            return Err(Error::Dependents);
        }
        let rows = self.db.rows(true)?;
        let mut remove = vec![];
        for (rid, e) in rows {
            let plain = crypto::open(
                self.key()?,
                &e,
                format!("VaultKey:1:relation:{rid}").as_bytes(),
            )?;
            let r: Relation = serde_json::from_slice(&plain)?;
            if r.target_credential_id == id {
                remove.push(rid)
            }
        }
        let tx = self.db.0.transaction()?;
        tx.execute("DELETE FROM credentials WHERE id=?1", [id])?;
        for rid in remove {
            tx.execute("DELETE FROM relations WHERE id=?1", [rid])?;
        }
        tx.commit()?;
        Ok(())
    }
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

#[cfg(test)]
mod tests;
