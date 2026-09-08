import { useState, type FormEvent } from "react";
import { api } from "../services/tauri";
import { Icon } from "../components/common/Icon";
export function SettingsPage({
  timeout,
  onTimeout,
  notify,
}: {
  timeout: number;
  onTimeout: (s: number) => void;
  notify: (s: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function change(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    let current = String(data.get("current") || "");
    let next = String(data.get("new") || "");
    let confirm = String(data.get("confirm") || "");
    form.reset();
    data.delete("current");
    data.delete("new");
    data.delete("confirm");
    if (next !== confirm) {
      setError("New passwords do not match.");
      current = "";
      next = "";
      confirm = "";
      return;
    }
    confirm = "";
    setBusy(true);
    setError("");
    try {
      await api.changePassword(current, next);
      notify("Master password updated. Your credentials are unchanged.");
    } catch (e) {
      setError(String(e));
    } finally {
      current = "";
      next = "";
      setBusy(false);
    }
  }
  return (
    <div className="settings-grid">
      <section className="panel settings-card">
        <span className="section-icon">
          <Icon name="lock" />
        </span>
        <h2>Automatic lock</h2>
        <p className="muted">
          Rust enforces the inactivity timer, even when the interface is not
          responding.
        </p>
        <label>
          Lock vault after
          <select
            value={timeout}
            onChange={async (e) => {
              const s = Number(e.target.value);
              try {
                await api.timeout(s);
                onTimeout(s);
                notify("Auto-lock updated for this session.");
              } catch (e) {
                setError(String(e));
              }
            }}
          >
            {[60, 120, 300, 600, 900].map((s) => (
              <option value={s} key={s}>
                {s / 60} minutes
              </option>
            ))}
          </select>
        </label>
        <small className="muted">
          Resets to the secure default of 5 minutes when you restart.
        </small>
        <hr />
        <h3>Clipboard protection</h3>
        <p className="muted">
          Copied fields expire after 30 seconds. New clipboard text is
          preserved.
        </p>
      </section>
      <section className="panel settings-card">
        <span className="section-icon">
          <Icon name="password" />
        </span>
        <h2>Master password</h2>
        <p className="muted">
          Protect your existing vault key with a new master password.
        </p>
        <form onSubmit={change}>
          <label>
            Current password
            <input
              name="current"
              type="password"
              autoComplete="current-password"
              required
              maxLength={1024}
            />
          </label>
          <label>
            New password
            <input
              name="new"
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={1024}
              required
            />
          </label>
          <label>
            Confirm new password
            <input
              name="confirm"
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={1024}
              required
            />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="primary" disabled={busy}>
            {busy ? "Updating…" : "Change master password"}
          </button>
        </form>
      </section>
      <div className="notice full">
        No recovery is available. Keep your master password safe. VaultKey is an
        educational project and has not received a professional security audit.
      </div>
    </div>
  );
}
