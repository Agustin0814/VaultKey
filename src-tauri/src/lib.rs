mod clipboard;
mod crypto;
mod database;
mod errors;
mod models;
mod vault;
use crate::{
    clipboard::{ClipboardGuard, Native},
    errors::Error,
    vault::Vault,
};
use std::{sync::Mutex, time::Duration};
use tauri::{Emitter, Manager};
use zeroize::Zeroizing;
struct State {
    vault: Mutex<Option<Vault>>,
    path: std::path::PathBuf,
    clipboard: Mutex<ClipboardGuard>,
}
type Reply<T> = std::result::Result<T, String>;
fn access<T>(state: &State, f: impl FnOnce(&mut Vault) -> errors::Result<T>) -> Reply<T> {
    let mut v = state.vault.lock().map_err(|_| "Vault unavailable")?;
    if v.is_none() {
        std::fs::create_dir_all(&state.path).map_err(|_| Error::Database.to_string())?;
        *v = Some(Vault::new(
            database::Database::open(&state.path.join("vault.db")).map_err(|e| e.to_string())?,
        ));
    }
    f(v.as_mut().ok_or_else(|| Error::Database.to_string())?).map_err(|e| e.to_string())
}
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct Status {
    exists: bool,
    unlocked: bool,
    timeout_seconds: u64,
}
#[tauri::command]
fn status(s: tauri::State<State>) -> Reply<Status> {
    access(&s, |v| {
        Ok(Status {
            exists: v.db.exists()?,
            unlocked: v.unlocked(),
            timeout_seconds: v.timeout.as_secs(),
        })
    })
}
#[tauri::command]
async fn create_vault(s: tauri::State<'_, State>, password: String) -> Reply<()> {
    let p = Zeroizing::new(password);
    access(&s, |v| v.create(&p))
}
#[tauri::command]
async fn unlock_vault(s: tauri::State<'_, State>, password: String) -> Reply<()> {
    let p = Zeroizing::new(password);
    access(&s, |v| v.unlock(&p))
}
#[tauri::command]
fn lock_vault(s: tauri::State<State>, app: tauri::AppHandle) -> Reply<()> {
    access(&s, |v| {
        v.lock();
        Ok(())
    })?;
    let _ = app.emit("vault-locked", ());
    if let Ok(mut c) = s.clipboard.lock() {
        c.clear(&mut Native, true).map_err(|e| e.to_string())?;
    }
    Ok(())
}
#[tauri::command]
fn activity(s: tauri::State<State>) -> Reply<()> {
    access(&s, |v| v.activity())
}
#[tauri::command]
fn list_credentials(s: tauri::State<State>, query: String) -> Reply<Vec<models::View>> {
    access(&s, |v| v.list(&query))
}
#[tauri::command]
fn save_credential(
    s: tauri::State<State>,
    id: Option<String>,
    credential: models::Credential,
    replace_password: bool,
) -> Reply<String> {
    access(&s, |v| v.save(id, credential, replace_password))
}
#[tauri::command]
fn delete_credential(s: tauri::State<State>, id: String) -> Reply<()> {
    access(&s, |v| v.delete(&id))
}
#[tauri::command]
fn reveal_password(s: tauri::State<State>, id: String) -> Reply<String> {
    access(&s, |v| Ok(v.get(&id)?.password.clone()))
}
#[tauri::command]
fn copy_field(s: tauri::State<State>, id: String, field: String) -> Reply<()> {
    access(&s, |v| {
        let c = v.get(&id)?;
        let text = match field.as_str() {
            "password" => &c.password,
            "email" => &c.email,
            "username" => &c.username,
            "phone" => &c.phone,
            _ => return Err(Error::Invalid),
        };
        s.clipboard
            .lock()
            .map_err(|_| Error::Clipboard)?
            .copy(&mut Native, text)
    })
}
#[tauri::command]
async fn change_password(s: tauri::State<'_, State>, current: String, new: String) -> Reply<()> {
    let c = Zeroizing::new(current);
    let n = Zeroizing::new(new);
    access(&s, |v| v.change_password(&c, &n))
}
#[tauri::command]
fn set_timeout(s: tauri::State<State>, seconds: u64) -> Reply<()> {
    access(&s, |v| {
        v.activity()?;
        if ![60, 120, 300, 600, 900].contains(&seconds) {
            return Err(Error::Invalid);
        }
        v.timeout = Duration::from_secs(seconds);
        Ok(())
    })
}
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let path = app.path().app_data_dir()?;
            // Test isolation is deliberately unavailable in release builds.
            #[cfg(debug_assertions)]
            let path = std::env::var_os("VAULTKEY_TEST_DATA_DIR")
                .map(std::path::PathBuf::from)
                .unwrap_or(path);
            app.manage(State {
                vault: Mutex::new(None),
                path,
                clipboard: Mutex::new(ClipboardGuard::default()),
            });
            let handle = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(Duration::from_secs(1));
                let s = handle.state::<State>();
                let expired = s
                    .vault
                    .lock()
                    .map(|mut v| v.as_mut().is_some_and(|v| v.expire()))
                    .unwrap_or(true);
                if expired {
                    let _ = handle.emit("vault-locked", ());
                }
                if let Ok(mut c) = s.clipboard.lock() {
                    if c.clear(&mut Native, expired).is_err() {
                        let _ = handle.emit("clipboard-error", ());
                    }
                };
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                let s = window.state::<State>();
                if let Ok(mut v) = s.vault.lock() {
                    if let Some(v) = v.as_mut() {
                        v.lock();
                    }
                };
                if let Ok(mut c) = s.clipboard.lock() {
                    let _ = c.clear(&mut Native, true);
                };
            }
        })
        .invoke_handler(tauri::generate_handler![
            status,
            create_vault,
            unlock_vault,
            lock_vault,
            activity,
            list_credentials,
            save_credential,
            delete_credential,
            reveal_password,
            copy_field,
            change_password,
            set_timeout
        ])
        .run(tauri::generate_context!())
        .expect("Unable to start VaultKey");
}
