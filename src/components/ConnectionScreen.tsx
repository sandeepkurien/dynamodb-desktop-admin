import { useEffect, useMemo, useState } from "react";
import {
  Cloud,
  FolderOpen,
  KeyRound,
  MonitorSmartphone,
  Plus,
  Trash2,
  Unplug,
  Plug,
  ShieldCheck,
  X,
} from "lucide-react";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { api, errMessage } from "../api";
import { connectionKindLabel } from "../lib/format";
import { useApp } from "../store";
import type { ConnectionAuth, ConnectionDraft, ConnectionKind, SavedConnection } from "../types";
import { REGIONS } from "../types";
import { ConfirmDialog } from "./ConfirmDialog";
import { LocalManager } from "./LocalManager";
import { Badge, Button, Field } from "./ui";
import dynamodweepLogo from "../../assets/branding/dynamodweep-logo-dark.svg";

const emptyDraft = (kind: ConnectionKind): ConnectionDraft => {
  const auth: ConnectionAuth =
    kind === "profile"
      ? { kind: "profile", profile: "default" }
      : kind === "access_key"
        ? { kind: "access_key", access_key_id: "", secret_access_key: "", session_token: "" }
        : { kind: "local", endpoint: "http://localhost:8000" };
  return {
    name:
      kind === "local"
        ? "DynamoDB Local"
        : kind === "profile"
          ? "AWS profile"
          : "Access keys",
    region: kind === "local" ? "us-east-1" : "us-east-1",
    auth,
  };
};

export function ConnectionScreen({
  asModal,
  onClose,
}: {
  asModal?: boolean;
  onClose?: () => void;
} = {}) {
  const { connections, sessions, refreshConnections, connectTo, disconnect, toast } = useApp();
  const openIds = useMemo(() => new Set(sessions.map((s) => s.connection.id)), [sessions]);
  const [draft, setDraft] = useState<ConnectionDraft>(emptyDraft("profile"));
  const [kind, setKind] = useState<ConnectionKind>("profile");
  const [profiles, setProfiles] = useState<string[]>(["default"]);
  const [busy, setBusy] = useState<"test" | "save" | "connect" | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SavedConnection | null>(null);
  const [storePath, setStorePath] = useState<string>("");

  useEffect(() => {
    refreshConnections();
    api.listAwsProfiles().then(setProfiles).catch(() => setProfiles(["default"]));
    api.connectionsFilePath().then(setStorePath).catch(() => setStorePath(""));
  }, [refreshConnections]);

  const selected = useMemo(
    () => connections.find((c) => c.id === selectedId) ?? null,
    [connections, selectedId],
  );

  function applyKind(next: ConnectionKind) {
    setKind(next);
    setDraft((d) => ({
      ...emptyDraft(next),
      id: d.id,
      name: d.name,
      region: next === "local" ? d.region || "us-east-1" : d.region,
    }));
  }

  function loadConnection(c: SavedConnection) {
    setSelectedId(c.id);
    setKind(c.auth.kind);
    setDraft({
      id: c.id,
      name: c.name,
      region: c.region,
      auth:
        c.auth.kind === "access_key"
          ? { ...c.auth, secret_access_key: "" }
          : c.auth,
    });
  }

  function newConnection(next: ConnectionKind) {
    setSelectedId(null);
    setKind(next);
    setDraft(emptyDraft(next));
  }

  async function onSave(andConnect: boolean) {
    setBusy(andConnect ? "connect" : "save");
    try {
      const saved = await api.upsertConnection(draft);
      await refreshConnections();
      setDraft({ ...draft, id: saved.id });
      setSelectedId(saved.id);
      toast("ok", "Connection saved");
      if (andConnect) {
        await connectTo(saved.id);
        onClose?.();
      }
    } catch (e) {
      toast("err", errMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function onConnectSaved(id: string) {
    setSelectedId(id);
    const c = connections.find((x) => x.id === id);
    if (c) loadConnection(c);
    setBusy("connect");
    try {
      await connectTo(id);
      onClose?.();
    } catch {
      /* toast already shown */
    } finally {
      setBusy(null);
    }
  }

  async function onTest() {
    setBusy("test");
    try {
      const n = draft.id
        ? await api.testConnection(draft.id)
        : await api.testDraft(draft);
      toast("ok", `Reachable — listed ${n} table${n === 1 ? "" : "s"}`);
    } catch (e) {
      toast("err", errMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function onDeleteConfirmed() {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    try {
      if (sessions.some((s) => s.connection.id === id)) {
        await disconnect(id);
      }
      await api.deleteConnection(id);
      await refreshConnections();
      if (selectedId === id) newConnection(kind);
      setPendingDelete(null);
      toast("ok", "Connection removed");
    } catch (e) {
      toast("err", errMessage(e));
    }
  }

  const body = (
    <div className={`grid-bg flex h-full ${asModal ? "rounded-2xl border border-line-strong overflow-hidden" : ""}`}>
      <aside className="flex w-[320px] flex-col border-r border-line bg-panel/90">
        <div className="border-b border-line px-5 py-4">
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              {asModal ? (
                <div className="text-[15px] font-semibold">Add connection</div>
              ) : (
                <img
                  src={dynamodweepLogo}
                  alt="DynamoDweep"
                  className="h-14 w-[210px] object-contain object-left"
                />
              )}
              <div className="text-[11px] text-faint">
                {asModal
                  ? "Open another account, profile, or Local instance"
                  : (
                    <>
                      A product by{" "}
                      <a
                        href="https://technodweep.com"
                        className="text-info hover:text-accent-2 hover:underline"
                        onClick={(event) => {
                          event.preventDefault();
                          void openUrl("https://technodweep.com");
                        }}
                      >
                        Technodweep
                      </a>
                    </>
                  )}
              </div>
            </div>
            {asModal ? (
              <button
                className="rounded-md p-1 text-muted hover:bg-hover hover:text-ink"
                onClick={onClose}
                title="Close"
              >
                <X size={16} />
              </button>
            ) : null}
          </div>
        </div>
        <div className="max-h-[46%] overflow-auto border-b border-line px-3 py-3">
          <LocalManager compact onOpened={onClose} />
        </div>
        <div className="flex items-center justify-between px-4 py-3">
          <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-faint">
            Saved connections
          </div>
          <button
            onClick={() => newConnection("profile")}
            className="rounded-md p-1 text-muted hover:bg-hover hover:text-ink"
            title="New connection"
          >
            <Plus size={14} />
          </button>
        </div>
        <div className="app-scroll flex-1 px-3 pb-4">
          {connections.length === 0 ? (
            <div className="px-2 py-6 text-sm text-muted">
              No saved connections yet. Create one on the right.
            </div>
          ) : (
            <ul className="space-y-1">
              {connections.map((c) => (
                <li key={c.id}>
                  <div
                    className={`flex items-center gap-1 rounded-lg border px-2 py-2 ${
                      selectedId === c.id
                        ? "border-accent/40 bg-accent/10"
                        : "border-transparent hover:bg-hover"
                    }`}
                  >
                    <button
                      className="min-w-0 flex-1 px-1 text-left"
                      onClick={() => loadConnection(c)}
                      onDoubleClick={() => onConnectSaved(c.id)}
                      title="Click to edit · Double-click to connect"
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="truncate font-medium">{c.name}</span>
                        {openIds.has(c.id) ? <Badge tone="ok">Open</Badge> : null}
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-faint">
                        <span>{connectionKindLabel(c.auth.kind)}</span>
                        <span>·</span>
                        <span className="mono">{c.region}</span>
                      </div>
                    </button>
                    <button
                      className="shrink-0 rounded-md p-1.5 text-muted hover:bg-raised hover:text-accent"
                      onClick={() => onConnectSaved(c.id)}
                      title={openIds.has(c.id) ? "Switch to this connection" : "Open connection"}
                      disabled={busy === "connect"}
                    >
                      <Plug size={14} />
                    </button>
                    <button
                      className="shrink-0 rounded-md p-1.5 text-muted hover:bg-raised hover:text-danger"
                      onClick={() => setPendingDelete(c)}
                      title="Delete saved connection"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="border-t border-line px-4 py-3 text-[11px] text-faint">
          <div className="mb-1">Saved on this machine</div>
          {storePath ? (
            <button
              className="flex w-full items-start gap-1.5 text-left text-[11px] text-muted hover:text-ink"
              title={storePath}
              onClick={() => {
                revealItemInDir(storePath).catch((e) => toast("err", errMessage(e)));
              }}
            >
              <FolderOpen size={12} className="mt-0.5 shrink-0" />
              <span className="break-all font-mono leading-4">{storePath}</span>
            </button>
          ) : (
            <span>Loading path…</span>
          )}
        </div>
      </aside>

      <main className="app-scroll flex-1">
        <div className="mx-auto max-w-xl px-10 py-12">
          <div className="mb-8">
            <h1 className="text-2xl font-semibold tracking-tight">
              {draft.id ? "Edit connection" : "Connect to DynamoDB"}
            </h1>
            <p className="mt-2 text-sm text-muted">
              Use an AWS named profile, static keys, or DynamoDB Local / LocalStack.
            </p>
          </div>

          <div className="mb-6 grid grid-cols-3 gap-2">
            {(
              [
                ["profile", "Profile", <Cloud size={15} key="c" />],
                ["access_key", "Access keys", <KeyRound size={15} key="k" />],
                ["local", "Local", <MonitorSmartphone size={15} key="l" />],
              ] as const
            ).map(([id, label, icon]) => (
              <button
                key={id}
                onClick={() => applyKind(id)}
                className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm ${
                  kind === id
                    ? "border-accent/50 bg-accent/10 text-ink"
                    : "border-line-strong bg-raised text-muted hover:bg-hover"
                }`}
              >
                {icon}
                {label}
              </button>
            ))}
          </div>

          <div className="space-y-4 rounded-2xl border border-line bg-panel/80 p-5">
            <Field label="Display name">
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="Production"
              />
            </Field>
            <Field label="Region">
              <select
                value={draft.region}
                onChange={(e) => setDraft({ ...draft, region: e.target.value })}
              >
                {REGIONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </Field>

            {kind === "profile" && draft.auth.kind === "profile" && (
              <Field label="AWS profile">
                <select
                  value={draft.auth.profile}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      auth: { kind: "profile", profile: e.target.value },
                    })
                  }
                >
                  {profiles.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </Field>
            )}

            {kind === "access_key" && draft.auth.kind === "access_key" && (
              <>
                <Field label="Access key ID">
                  <input
                    className="mono"
                    value={draft.auth.access_key_id}
                    onChange={(e) => {
                      if (draft.auth.kind !== "access_key") return;
                      setDraft({
                        ...draft,
                        auth: {
                          kind: "access_key",
                          access_key_id: e.target.value,
                          secret_access_key: draft.auth.secret_access_key,
                          session_token: draft.auth.session_token,
                        },
                      });
                    }}
                    autoComplete="off"
                  />
                </Field>
                <Field label="Secret access key">
                  <input
                    className="mono"
                    type="password"
                    value={draft.auth.secret_access_key}
                    placeholder={selected?.auth.kind === "access_key" ? "•••••••• (unchanged)" : ""}
                    onChange={(e) => {
                      if (draft.auth.kind !== "access_key") return;
                      setDraft({
                        ...draft,
                        auth: {
                          kind: "access_key",
                          access_key_id: draft.auth.access_key_id,
                          secret_access_key: e.target.value,
                          session_token: draft.auth.session_token,
                        },
                      });
                    }}
                    autoComplete="new-password"
                  />
                </Field>
                <Field label="Session token (optional)">
                  <input
                    className="mono"
                    value={draft.auth.session_token ?? ""}
                    onChange={(e) => {
                      if (draft.auth.kind !== "access_key") return;
                      setDraft({
                        ...draft,
                        auth: {
                          kind: "access_key",
                          access_key_id: draft.auth.access_key_id,
                          secret_access_key: draft.auth.secret_access_key,
                          session_token: e.target.value,
                        },
                      });
                    }}
                  />
                </Field>
              </>
            )}

            {kind === "local" && draft.auth.kind === "local" && (
              <Field label="Endpoint">
                <input
                  className="mono"
                  value={draft.auth.endpoint}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      auth: { kind: "local", endpoint: e.target.value },
                    })
                  }
                  placeholder="http://localhost:8000"
                />
              </Field>
            )}
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Button onClick={onTest} disabled={!!busy}>
              <ShieldCheck size={14} />
              {busy === "test" ? "Testing…" : "Test"}
            </Button>
            <Button onClick={() => onSave(false)} disabled={!!busy}>
              {busy === "save" ? "Saving…" : "Save"}
            </Button>
            {draft.id ? (
              <Button
                tone="primary"
                onClick={() => onConnectSaved(draft.id!)}
                disabled={!!busy}
              >
                <Plug size={14} />
                {busy === "connect"
                  ? "Connecting…"
                  : draft.id && openIds.has(draft.id)
                    ? "Switch to this"
                    : "Connect"}
              </Button>
            ) : (
              <Button tone="primary" onClick={() => onSave(true)} disabled={!!busy}>
                <Plug size={14} />
                {busy === "connect" ? "Connecting…" : "Save & connect"}
              </Button>
            )}
            {draft.id ? (
              <Badge tone="info">{connectionKindLabel(kind)}</Badge>
            ) : (
              <span className="ml-1 text-xs text-faint">
                <Unplug size={12} className="mr-1 inline" />
                Not connected
              </span>
            )}
          </div>
        </div>
      </main>

      {pendingDelete && (
        <ConfirmDialog
          title={`Delete “${pendingDelete.name}”?`}
          body="This only removes the saved connection from this app. It does not change anything in DynamoDB or AWS."
          confirmLabel="Delete connection"
          onConfirm={onDeleteConfirmed}
          onClose={() => setPendingDelete(null)}
        />
      )}
    </div>
  );

  if (asModal) {
    return (
      <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/65 p-6 backdrop-blur-sm">
        <div className="h-[min(820px,100%)] w-full max-w-5xl">{body}</div>
      </div>
    );
  }

  return body;
}
