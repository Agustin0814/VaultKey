import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, native } from "./services/tauri";
import type { CredentialView, VaultStatus } from "./types";
import { AuthPage } from "./pages/AuthPage";
import { SettingsPage } from "./pages/SettingsPage";
import { Brand, Icon } from "./components/common/Icon";
import { Modal } from "./components/common/Modal";
import { CredentialForm } from "./components/credentials/CredentialForm";
type Page =
  | "Vault"
  | "All Credentials"
  | "Linked Accounts"
  | "Favorites"
  | "Security"
  | "Settings";
const navigation: { page: Page; icon: string }[] = [
  { page: "Vault", icon: "vault" },
  { page: "All Credentials", icon: "password" },
  { page: "Linked Accounts", icon: "link" },
  { page: "Favorites", icon: "favorite" },
  { page: "Security", icon: "security" },
  { page: "Settings", icon: "settings" },
];
function initials(name: string) {
  return name.slice(0, 2).toUpperCase();
}
export default function App() {
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [fatal, setFatal] = useState("");
  const [page, setPage] = useState<Page>("Vault");
  const [all, setAll] = useState<CredentialView[]>([]);
  const [results, setResults] = useState<CredentialView[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ value: CredentialView | null } | null>(
    null,
  );
  const [deleting, setDeleting] = useState<CredentialView | null>(null);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [revealed, setRevealed] = useState<{
    id: string;
    password: string;
  } | null>(null);
  const epoch = useRef(0);
  const searchEpoch = useRef(0);
  const revealEpoch = useRef(0);
  const notify = useCallback((text: string) => setNotice(text), []);
  const hide = useCallback(() => {
    revealEpoch.current++;
    setRevealed(null);
  }, []);
  const clear = useCallback(() => {
    epoch.current++;
    searchEpoch.current++;
    hide();
    setAll([]);
    setResults([]);
    setQuery("");
    setSelected(null);
    setEditor(null);
    setDeleting(null);
    setPage("Vault");
    setStatus((s) => (s ? { ...s, unlocked: false } : s));
  }, [hide]);
  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await api.status());
      setFatal("");
    } catch (e) {
      setFatal(String(e));
    }
  }, []);
  useEffect(() => {
    if (native) void refreshStatus();
    else setStatus({ exists: false, unlocked: false, timeoutSeconds: 300 });
  }, [refreshStatus]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 6000);
    return () => clearTimeout(t);
  }, [notice]);
  useEffect(() => {
    if (!native) return;
    const a = listen("vault-locked", () => {
      clear();
      notify("Vault locked.");
    });
    const b = listen("clipboard-error", () =>
      notify("Clipboard could not be cleared. Clear it manually."),
    );
    return () => {
      void a.then((f) => f());
      void b.then((f) => f());
    };
  }, [clear, notify]);
  useEffect(() => {
    hide();
  }, [selected, page, editor, hide]);
  useEffect(() => {
    window.addEventListener("blur", hide);
    const visibility = () => {
      if (document.hidden) hide();
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("blur", hide);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [hide]);
  useEffect(() => {
    if (!status?.unlocked) return;
    let last = 0;
    const touch = (e: Event) => {
      if (!e.isTrusted || document.hidden || Date.now() - last < 1000) return;
      last = Date.now();
      void api.activity().catch(() => clear());
    };
    for (const name of ["pointerdown", "keydown", "wheel", "pointermove"])
      window.addEventListener(name, touch, { passive: true });
    const t = setInterval(() => {
      void api
        .status()
        .then((s) => {
          if (!s.unlocked) clear();
        })
        .catch(() => clear());
    }, 2000);
    return () => {
      clearInterval(t);
      for (const name of ["pointerdown", "keydown", "wheel", "pointermove"])
        window.removeEventListener(name, touch);
    };
  }, [status?.unlocked, clear]);
  const refresh = useCallback(async () => {
    const token = epoch.current;
    setLoading(true);
    try {
      const data = await api.list();
      if (token === epoch.current) {
        setAll(data);
        setResults(data);
        setSelected((s) =>
          data.some((c) => c.id === s) ? s : data[0]?.id || null,
        );
      }
    } catch (e) {
      notify(String(e));
      if (String(e).includes("locked")) clear();
    } finally {
      setLoading(false);
    }
  }, [clear, notify]);
  useEffect(() => {
    if (status?.unlocked) void refresh();
  }, [status?.unlocked, refresh]);
  useEffect(() => {
    if (!status?.unlocked) return;
    const token = ++searchEpoch.current;
    const session = epoch.current;
    const t = setTimeout(() => {
      void api
        .list(query)
        .then((data) => {
          if (token === searchEpoch.current && session === epoch.current)
            setResults(data);
        })
        .catch((e) => notify(String(e)));
    }, 180);
    return () => clearTimeout(t);
  }, [query, status?.unlocked, notify]);
  async function locked() {
    clear();
    try {
      await api.lock();
      notify("Vault locked.");
    } catch (e) {
      notify(String(e));
      await refreshStatus();
    }
  }
  async function reveal(id: string) {
    if (revealed?.id === id) {
      hide();
      return;
    }
    const token = ++revealEpoch.current;
    const session = epoch.current;
    try {
      const password = await api.reveal(id);
      if (token === revealEpoch.current && session === epoch.current)
        setRevealed({ id, password });
    } catch (e) {
      notify(String(e));
    }
  }
  async function copy(id: string, field: string) {
    try {
      await api.copy(id, field);
      notify("Copied — clipboard will clear automatically");
    } catch (e) {
      notify(String(e));
    }
  }
  if (fatal)
    return (
      <div className="startup">
        <Icon name="warning" size={36} />
        <h1>Vault unavailable</h1>
        <p>{fatal}</p>
        <button onClick={() => void refreshStatus()}>Try again</button>
      </div>
    );
  if (!status)
    return (
      <div className="startup">
        <Brand />
        <p>Opening your private space…</p>
      </div>
    );
  if (!status.unlocked)
    return (
      <>
        <AuthPage
          exists={status.exists}
          onUnlock={() => void refreshStatus()}
        />
        {notice && (
          <div className="toast" role="status">
            {notice}
          </div>
        )}
      </>
    );
  const filtered = results.filter((c) => page !== "Favorites" || c.favorite);
  const chosen = all.find((c) => c.id === selected);
  const linked = all.filter((c) => c.linkedAccount);
  const favorites = all.filter((c) => c.favorite).length;
  const selectPage = (next: Page) => {
    hide();
    setPage(next);
    setQuery("");
    setEditor(null);
    setDeleting(null);
  };
  const dependentCount = deleting
    ? all.filter((c) => c.linkedAccount === deleting.id).length
    : 0;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <div className="workspace-label">PERSONAL WORKSPACE</div>
        <nav aria-label="Main navigation">
          {navigation.map(({ page: p, icon }, i) => (
            <button
              key={p}
              className={`${page === p ? "active" : ""} ${i === 4 ? "nav-divider" : ""}`}
              onClick={() => selectPage(p)}
            >
              <Icon name={icon} />
              {p}
              {p === "All Credentials" && (
                <span className="nav-count">{all.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-badge">
            <span className="status-dot" />
            <div>
              <strong>On this device only</strong>
              <small>Private. Encrypted. Offline.</small>
            </div>
          </div>
          <button className="lock-button" onClick={() => void locked()}>
            <Icon name="lock" /> Lock Vault <span>↗</span>
          </button>
          <span className="version">
            VAULTKEY <span>v0.1.0</span>
          </span>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <span className="breadcrumb">
            Workspace <Icon name="chevron" size={14} /> <strong>{page}</strong>
          </span>
          <div className="topbar-right">
            <span className="offline">
              <span className="status-dot" /> Offline vault
            </span>
            <div className="profile">
              <Icon name="user" size={18} />
            </div>
          </div>
        </header>
        <div className="content">
          <header className="page-heading">
            <div>
              <div className="eyebrow">YOUR DIGITAL LIFE, IN ORDER</div>
              <h1>{page === "Vault" ? "Your vault" : page}</h1>
              <p className="muted">
                {page === "Linked Accounts"
                  ? "See the accounts behind your accounts."
                  : page === "Settings"
                    ? "Make your private space work for you."
                    : page === "Security"
                      ? "A clear view of your local vault."
                      : "All your credentials. One secure place."}
              </p>
            </div>
            <button
              className="primary"
              onClick={() => setEditor({ value: null })}
            >
              <Icon name="add" /> Add Credential
            </button>
          </header>
          {(page === "Vault" || page === "Security") && (
            <div className="stats">
              <Stat
                icon="password"
                value={all.length}
                label="Total credentials"
                hint="Safely stored"
              />
              <Stat
                icon="link"
                value={linked.length}
                label="Linked accounts"
                hint="Connected sign-ins"
              />
              <Stat
                icon="favorite"
                value={favorites}
                label="Favorites"
                hint="Your everyday essentials"
              />
              <Stat
                icon="lock"
                value={`${status.timeoutSeconds / 60} min`}
                label="Automatic lock"
                hint="After inactivity"
              />
            </div>
          )}
          {page === "Settings" ? (
            <SettingsPage
              timeout={status.timeoutSeconds}
              onTimeout={(s) => setStatus({ ...status, timeoutSeconds: s })}
              notify={notify}
            />
          ) : page === "Security" ? (
            <section className="panel security-panel">
              <span className="section-icon">
                <Icon name="security" size={28} />
              </span>
              <h2>Private by design</h2>
              <p>
                Your credentials are encrypted locally with XChaCha20-Poly1305.
                Your master password protects a separate vault key using
                Argon2id.
              </p>
              <div className="security-facts">
                <span>
                  <Icon name="success" /> No cloud synchronization
                </span>
                <span>
                  <Icon name="success" /> No analytics or telemetry
                </span>
                <span>
                  <Icon name="success" /> Clipboard clears after 30 seconds
                </span>
              </div>
              <div className="notice">
                Breach monitoring and password auditing are not implemented. No
                security score is calculated. This educational project has not
                received a professional security audit.
              </div>
            </section>
          ) : page === "Linked Accounts" ? (
            <section className="panel linked-panel">
              <div className="panel-heading">
                <h2>Account connections</h2>
                <span className="tag">{linked.length} linked</span>
              </div>
              {linked.length === 0 ? (
                <Empty
                  icon="link"
                  title="Your accounts, connected"
                  text="Choose a Linked Account when adding or editing a credential to see the connection here."
                />
              ) : (
                all
                  .filter((c) =>
                    all.some((child) => child.linkedAccount === c.id),
                  )
                  .map((parent) => (
                    <div className="account-tree" key={parent.id}>
                      <button
                        className="tree-parent"
                        onClick={() => {
                          setSelected(parent.id);
                          selectPage("All Credentials");
                        }}
                      >
                        <span className="service-avatar">
                          {initials(parent.service)}
                        </span>
                        <span>
                          <strong>{parent.service}</strong>
                          <small>
                            {
                              all.filter((c) => c.linkedAccount === parent.id)
                                .length
                            }{" "}
                            linked accounts
                          </small>
                        </span>
                        <Icon name="arrow" />
                      </button>
                      <div className="tree-children">
                        {all
                          .filter((c) => c.linkedAccount === parent.id)
                          .map((child) => (
                            <button
                              key={child.id}
                              onClick={() => {
                                setSelected(child.id);
                                selectPage("All Credentials");
                              }}
                            >
                              <Icon name="link" size={16} />
                              <strong>{child.service}</strong>
                              <span className="muted">
                                {child.accessMethod}
                              </span>
                              <Icon name="chevron" size={16} />
                            </button>
                          ))}
                      </div>
                    </div>
                  ))
              )}
            </section>
          ) : (
            <section className="panel credential-workspace">
              <div className="credential-list">
                <div className="panel-heading">
                  <h2>
                    {page === "Favorites" ? "Favorites" : "Credentials"}{" "}
                    <span className="count">{filtered.length}</span>
                  </h2>
                  <span className="sort-label">A — Z</span>
                </div>
                <label className="search">
                  <Icon name="search" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search your vault…"
                    aria-label="Search credentials"
                    maxLength={1024}
                  />
                  {query && (
                    <button
                      className="icon-button"
                      aria-label="Clear search"
                      onClick={() => setQuery("")}
                    >
                      <Icon name="close" size={15} />
                    </button>
                  )}
                </label>
                <div className="list-items">
                  {loading ? (
                    <p className="muted loading">Opening credentials…</p>
                  ) : filtered.length === 0 ? (
                    <Empty
                      icon="password"
                      title={query ? "No matches found" : "A fresh start"}
                      text={
                        query
                          ? "Try a different service, email, or category."
                          : "Add your first credential and give your accounts a home."
                      }
                    />
                  ) : (
                    filtered.map((c) => (
                      <button
                        key={c.id}
                        className={`credential-item ${selected === c.id ? "selected" : ""}`}
                        onClick={() => setSelected(c.id)}
                      >
                        <span
                          className={`service-avatar color-${c.service.charCodeAt(0) % 4}`}
                        >
                          {initials(c.service)}
                        </span>
                        <span className="credential-item-text">
                          <strong>{c.service}</strong>
                          <small>
                            {c.email ||
                              c.username ||
                              c.phone ||
                              "Linked sign-in"}
                          </small>
                          <span className="method">{c.accessMethod}</span>
                        </span>
                        {c.favorite ? (
                          <Icon name="favorite" size={15} />
                        ) : (
                          <Icon name="chevron" size={15} />
                        )}
                      </button>
                    ))
                  )}
                </div>
                <div className="list-footer">
                  <Icon name="lock" size={13} /> Encrypted at rest on your
                  device
                </div>
              </div>
              <div className="credential-details">
                {chosen ? (
                  <>
                    <div className="details-head">
                      <span
                        className={`service-avatar large color-${chosen.service.charCodeAt(0) % 4}`}
                      >
                        {initials(chosen.service)}
                      </span>
                      <div className="detail-actions">
                        <button
                          className={`icon-button ${chosen.favorite ? "favorited" : ""}`}
                          aria-label={
                            chosen.favorite ? "Remove favorite" : "Add favorite"
                          }
                          onClick={async () => {
                            try {
                              await api.save(
                                chosen.id,
                                {
                                  ...pickCredential(chosen),
                                  favorite: !chosen.favorite,
                                },
                                false,
                              );
                              await refresh();
                            } catch (e) {
                              notify(String(e));
                            }
                          }}
                        >
                          <Icon name="favorite" />
                        </button>
                        <button
                          className="icon-button"
                          aria-label="Edit credential"
                          onClick={() => setEditor({ value: chosen })}
                        >
                          <Icon name="edit" />
                        </button>
                        <button
                          className="icon-button danger"
                          aria-label="Delete credential"
                          onClick={() => setDeleting(chosen)}
                        >
                          <Icon name="delete" />
                        </button>
                      </div>
                    </div>
                    <h2 className="service-title">{chosen.service}</h2>
                    <div className="detail-tags">
                      <span className="tag blue">
                        <Icon name="password" size={13} />
                        {chosen.accessMethod}
                      </span>
                      {chosen.category && (
                        <span className="tag">{chosen.category}</span>
                      )}
                    </div>
                    <div className="detail-fields">
                      {(["email", "username", "phone"] as const)
                        .filter((f) => chosen[f])
                        .map((field) => (
                          <div className="detail-field" key={field}>
                            <span className="field-label">{field}</span>
                            <div>
                              <span>{chosen[field]}</span>
                              <button
                                className="icon-button"
                                aria-label={`Copy ${field}`}
                                onClick={() => void copy(chosen.id, field)}
                              >
                                <Icon name="copy" size={17} />
                              </button>
                            </div>
                          </div>
                        ))}
                      <div className="detail-field">
                        <span className="field-label">Password</span>
                        <div>
                          <span className="secret-value">
                            {chosen.hasPassword
                              ? revealed?.id === chosen.id
                                ? revealed.password
                                : "••••••••••••"
                              : "No password stored"}
                          </span>
                          {chosen.hasPassword && (
                            <span className="field-actions">
                              <button
                                className="icon-button"
                                aria-label={
                                  revealed?.id === chosen.id
                                    ? "Hide password"
                                    : "Show password"
                                }
                                onClick={() => void reveal(chosen.id)}
                              >
                                <Icon
                                  name={
                                    revealed?.id === chosen.id ? "hide" : "show"
                                  }
                                  size={17}
                                />
                              </button>
                              <button
                                className="icon-button"
                                aria-label="Copy Password"
                                onClick={() => void copy(chosen.id, "password")}
                              >
                                <Icon name="copy" size={17} />
                              </button>
                            </span>
                          )}
                        </div>
                      </div>
                      {chosen.url && (
                        <div className="detail-field">
                          <span className="field-label">Website</span>
                          <p className="url-value">{chosen.url}</p>
                        </div>
                      )}
                    </div>
                    {chosen.linkedAccount && (
                      <div className="linked-callout">
                        <Icon name="link" />
                        <div>
                          <small>CONNECTED THROUGH</small>
                          <strong>
                            {all.find((c) => c.id === chosen.linkedAccount)
                              ?.service || "Unavailable account"}
                          </strong>
                        </div>
                        <button
                          className="icon-button"
                          aria-label="Open linked account"
                          onClick={() => setSelected(chosen.linkedAccount)}
                        >
                          <Icon name="arrow" />
                        </button>
                      </div>
                    )}
                    {chosen.notes && (
                      <div className="notes">
                        <h3>
                          <Icon name="notes" size={16} /> Notes
                        </h3>
                        <p>{chosen.notes}</p>
                      </div>
                    )}
                    <div className="detail-footer">
                      Created{" "}
                      {new Date(chosen.createdAt * 1000).toLocaleDateString()}
                      <span>
                        Updated{" "}
                        {new Date(chosen.updatedAt * 1000).toLocaleDateString()}
                      </span>
                    </div>
                  </>
                ) : (
                  <Empty
                    icon="lock"
                    title="A home for every sign-in"
                    text="Select a credential to view its details, or add your first one to get started."
                  />
                )}
              </div>
            </section>
          )}
          {page === "Vault" && (
            <div className="bottom-note">
              <span>
                <Icon name="security" size={18} />
                <strong>Your privacy stays with you.</strong> VaultKey works
                entirely offline.
              </span>
              <span>NO CLOUD. NO TRACKING.</span>
            </div>
          )}
        </div>
      </main>
      {editor && (
        <CredentialForm
          value={editor.value}
          all={all}
          onClose={() => setEditor(null)}
          onSave={(id) => {
            setEditor(null);
            setQuery("");
            setSelected(id);
            void refresh();
            notify(editor.value ? "Credential updated." : "Credential saved.");
          }}
        />
      )}
      {deleting && (
        <Modal title="Delete credential?" onClose={() => setDeleting(null)}>
          <div className="delete-body">
            <p>
              Delete <strong>{deleting.service}</strong>? This cannot be undone.
            </p>
            {dependentCount > 0 ? (
              <div className="warning">
                <Icon name="warning" />
                {dependentCount} linked account(s) depend on this credential.
                Edit them to remove their link before deleting. Dependent
                accounts will not be deleted.
              </div>
            ) : (
              <p className="muted">
                Only this credential and its incoming link will be removed.
              </p>
            )}
            <div className="modal-actions">
              <button onClick={() => setDeleting(null)}>Cancel</button>
              <button
                className="danger-button"
                disabled={dependentCount > 0}
                onClick={async () => {
                  try {
                    await api.delete(deleting.id);
                    setDeleting(null);
                    await refresh();
                    notify("Credential deleted.");
                  } catch (e) {
                    notify(String(e));
                  }
                }}
              >
                Delete credential
              </button>
            </div>
          </div>
        </Modal>
      )}
      {notice && (
        <div className="toast" role="status">
          <Icon name="security" size={17} />
          {notice}
          <button
            className="icon-button"
            aria-label="Dismiss message"
            onClick={() => setNotice("")}
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
function Stat({
  icon,
  value,
  label,
  hint,
}: {
  icon: string;
  value: string | number;
  label: string;
  hint: string;
}) {
  return (
    <div className="stat">
      <span className="stat-icon">
        <Icon name={icon} />
      </span>
      <div className="stat-value">{value}</div>
      <strong>{label}</strong>
      <small>{hint}</small>
    </div>
  );
}
function Empty({
  icon,
  title,
  text,
}: {
  icon: string;
  title: string;
  text: string;
}) {
  return (
    <div className="empty">
      <span>
        <Icon name={icon} size={29} />
      </span>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
function pickCredential(c: CredentialView) {
  return {
    service: c.service,
    accessMethod: c.accessMethod,
    email: c.email,
    username: c.username,
    phone: c.phone,
    password: "",
    linkedAccount: c.linkedAccount,
    url: c.url,
    category: c.category,
    notes: c.notes,
    favorite: c.favorite,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}
