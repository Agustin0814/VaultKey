import { useState, type FormEvent } from "react";
import { Modal } from "../common/Modal";
import { emptyCredential, methods, type CredentialView } from "../../types";
import { api } from "../../services/tauri";
export function CredentialForm({
  value,
  all,
  onClose,
  onSave,
}: {
  value: CredentialView | null;
  all: CredentialView[];
  onClose: () => void;
  onSave: (id: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [replace, setReplace] = useState(!value);
  const initial = value || emptyCredential();
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const form = e.currentTarget;
    const data = new FormData(form);
    const c = emptyCredential();
    for (const key of [
      "service",
      "accessMethod",
      "email",
      "username",
      "phone",
      "password",
      "url",
      "category",
      "notes",
    ] as const)
      c[key] = String(data.get(key) || "");
    c.linkedAccount = String(data.get("linkedAccount") || "") || null;
    c.favorite = data.has("favorite");
    const passwordInput = form.elements.namedItem(
      "password",
    ) as HTMLInputElement | null;
    if (passwordInput) passwordInput.value = "";
    data.delete("password");
    setBusy(true);
    setError("");
    try {
      const id = await api.save(value?.id || null, c, replace);
      onSave(id);
    } catch (e) {
      setError(String(e));
    } finally {
      c.password = "";
      setBusy(false);
    }
  }
  return (
    <Modal
      title={value ? "Edit credential" : "Add Credential"}
      onClose={onClose}
    >
      <form onSubmit={submit} className="credential-form">
        <p className="muted">
          Keep every sign-in method in one place. Only the service is required.
        </p>
        <div className="form-grid">
          <label>
            Service
            <input
              name="service"
              defaultValue={initial.service}
              required
              maxLength={256}
              placeholder="e.g. Notion"
              autoFocus
            />
          </label>
          <label>
            Access Method
            <select name="accessMethod" defaultValue={initial.accessMethod}>
              {methods.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </label>
          <label>
            Email
            <input
              name="email"
              type="email"
              defaultValue={initial.email}
              maxLength={1024}
              placeholder="name@example.com"
            />
          </label>
          <label>
            Username
            <input
              name="username"
              defaultValue={initial.username}
              maxLength={1024}
              placeholder="Your username"
            />
          </label>
          <label>
            Phone
            <input
              name="phone"
              type="tel"
              defaultValue={initial.phone}
              maxLength={128}
              placeholder="Phone number"
            />
          </label>
          <label>
            Linked Account
            <select
              name="linkedAccount"
              defaultValue={initial.linkedAccount || ""}
            >
              <option value="">None</option>
              {all
                .filter((c) => c.id !== value?.id)
                .map((c) => (
                  <option value={c.id} key={c.id}>
                    {c.service} — {c.email || c.username || c.phone}
                  </option>
                ))}
            </select>
          </label>
          <label className="full">
            Password{" "}
            {value && (
              <span className="inline-check">
                <input
                  type="checkbox"
                  checked={replace}
                  onChange={(e) => setReplace(e.target.checked)}
                />{" "}
                Replace saved password
              </span>
            )}
            <input
              name="password"
              type="password"
              autoComplete="new-password"
              disabled={!replace}
              maxLength={4096}
              placeholder={
                value
                  ? "Saved password stays unchanged unless replaced"
                  : "Optional for linked sign-ins"
              }
            />
          </label>
          <label>
            URL
            <input
              name="url"
              defaultValue={initial.url}
              maxLength={2048}
              placeholder="https://example.com"
            />
          </label>
          <label>
            Category
            <input
              name="category"
              defaultValue={initial.category}
              maxLength={256}
              placeholder="e.g. Work, Personal"
            />
          </label>
          <label className="full">
            Notes
            <textarea
              name="notes"
              defaultValue={initial.notes}
              maxLength={12000}
              rows={3}
              placeholder="Anything else to remember"
            />
          </label>
        </div>
        <label className="checkbox">
          <input
            name="favorite"
            type="checkbox"
            defaultChecked={initial.favorite}
          />{" "}
          Add to favorites
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "Saving…" : "Save credential"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
