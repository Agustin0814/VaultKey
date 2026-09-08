import { useRef, useState, type FormEvent } from "react";
import { Brand, Icon } from "../components/common/Icon";
import { api, native } from "../services/tauri";
export function AuthPage({
  exists,
  onUnlock,
}: {
  exists: boolean;
  onUnlock: () => void;
}) {
  const form = useRef<HTMLFormElement>(null);
  const [show, setShow] = useState(false);
  const [strength, setStrength] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const data = new FormData(form.current!);
    let password = String(data.get("password") || "");
    let confirm = String(data.get("confirm") || "");
    data.delete("password");
    data.delete("confirm");
    form.current?.reset();
    setStrength(0);
    setShow(false);
    if (!exists && password !== confirm) {
      setError("Master passwords do not match.");
      password = "";
      confirm = "";
      return;
    }
    confirm = "";
    setBusy(true);
    setError("");
    try {
      await (exists ? api.unlock(password) : api.create(password));
      onUnlock();
    } catch (e) {
      setError(String(e));
    } finally {
      password = "";
      setBusy(false);
    }
  }
  return (
    <div className="auth">
      <aside className="auth-story">
        <Brand />
        <div className="story-body">
          <div className="eyebrow">A PRIVATE SPACE FOR YOUR DIGITAL LIFE</div>
          <h1>
            Your accounts.
            <br />
            Connected.
            <br />
            <span>Protected.</span>
          </h1>
          <p>
            One place for your passwords, sign-in methods, and the accounts that
            connect them.
          </p>
          <div className="vault-art">
            <div className="art-orbit orbit-one" />
            <div className="art-orbit orbit-two" />
            <div className="art-lock">
              <Icon name="lock" size={66} />
            </div>
            <span className="art-node node-one">
              <Icon name="email" />
            </span>
            <span className="art-node node-two">
              <Icon name="link" />
            </span>
            <span className="art-node node-three">
              <Icon name="user" />
            </span>
          </div>
        </div>
        <div className="story-footer">
          <Icon name="security" /> Local by design. Yours by default.
        </div>
      </aside>
      <main className="auth-main">
        <div className="auth-card">
          <span className="pill">
            <span className="status-dot" /> COMPLETELY OFFLINE
          </span>
          <div className="auth-heading-icon">
            <Icon name={exists ? "lock" : "add"} size={29} />
          </div>
          <h2>{exists ? "Welcome back." : "Create your Vault"}</h2>
          <p className="muted">
            {exists
              ? "Unlock your private space with your master password."
              : "A little setup. A more organized digital life."}
          </p>
          {!native && (
            <div className="notice">
              Desktop preview only. Run <code>npm run tauri dev</code> to create
              or unlock your encrypted vault.
            </div>
          )}
          <form ref={form} onSubmit={submit}>
            <label>
              Master Password
              <div className="password-input">
                <input
                  name="password"
                  type={show ? "text" : "password"}
                  autoComplete={exists ? "current-password" : "new-password"}
                  required
                  minLength={exists ? 1 : 12}
                  maxLength={1024}
                  placeholder={
                    exists
                      ? "Enter your master password"
                      : "At least 12 characters"
                  }
                  onChange={(e) =>
                    setStrength(
                      Math.min(4, Math.floor(e.target.value.length / 5)),
                    )
                  }
                />
                <button
                  type="button"
                  className="icon-button"
                  aria-label={
                    show ? "Hide master password" : "Show master password"
                  }
                  onClick={() => setShow(!show)}
                >
                  <Icon name={show ? "hide" : "show"} />
                </button>
              </div>
            </label>
            {!exists && (
              <>
                <div
                  className="strength"
                  aria-label="Basic password length indicator"
                >
                  {[1, 2, 3, 4].map((i) => (
                    <span key={i} className={strength >= i ? "active" : ""} />
                  ))}
                </div>
                <small className="muted">
                  {
                    [
                      "Use a long, unique passphrase",
                      "Keep going — longer is better",
                      "Choose at least 12 characters",
                      "Good length; make it unique",
                      "Long passphrase",
                    ][strength]
                  }{" "}
                  · length estimate only
                </small>
                <label>
                  Confirm Master Password
                  <input
                    name="confirm"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={12}
                    maxLength={1024}
                    placeholder="Enter it once more"
                  />
                </label>
                <div className="warning">
                  <Icon name="warning" />
                  <span>
                    Si pierdes tu contraseña maestra, no podremos recuperar tus
                    credenciales.
                  </span>
                </div>
              </>
            )}
            {error && (
              <div className="error" role="alert">
                {error}
              </div>
            )}
            <button className="primary auth-submit" disabled={busy || !native}>
              <Icon name={exists ? "unlock" : "lock"} />
              {busy
                ? "Securing your vault…"
                : exists
                  ? "Unlock Vault"
                  : "Create Vault"}
              <Icon name="arrow" />
            </button>
          </form>
          <div className="auth-footnote">
            <Icon name="security" size={16} /> Encrypted on this device. Never
            sent to a server.
          </div>
        </div>
        <footer>
          VAULTKEY <span>YOUR KEYS. YOUR CONTROL.</span>
        </footer>
      </main>
    </div>
  );
}
