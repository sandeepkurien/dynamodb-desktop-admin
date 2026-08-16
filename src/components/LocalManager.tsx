import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  Copy,
  FolderOpen,
  HardDrive,
  Play,
  Plus,
  Square,
  Trash2,
  Plug,
} from "lucide-react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { api, errMessage } from "../api";
import { formatBytes } from "../lib/format";
import { useApp } from "../store";
import type { LocalDbInfo, RuntimeStatus } from "../types";
import { ConfirmDialog } from "./ConfirmDialog";
import { Badge, Button, Field } from "./ui";

export function LocalManager({
  compact,
  onOpened,
}: {
  compact?: boolean;
  onOpened?: () => void;
}) {
  const { connectTo, toast, refreshConnections } = useApp();
  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null);
  const [dbs, setDbs] = useState<LocalDbInfo[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [setupBusy, setSetupBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newMode, setNewMode] = useState<"persistent" | "memory">("persistent");
  const [pendingDelete, setPendingDelete] = useState<LocalDbInfo | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [st, list] = await Promise.all([
        api.localRuntimeStatus(),
        api.listLocalDbs(),
      ]);
      setRuntime(st);
      setDbs(list);
    } catch (e) {
      toast("err", errMessage(e));
    }
  }, [toast]);

  useEffect(() => {
    refresh();
    const t = window.setInterval(refresh, 4000);
    return () => window.clearInterval(t);
  }, [refresh]);

  async function setupRuntime() {
    setSetupBusy(true);
    try {
      const st = await api.ensureLocalRuntime();
      setRuntime(st);
      toast("ok", "DynamoDB Local runtime is ready");
    } catch (e) {
      toast("err", errMessage(e));
    } finally {
      setSetupBusy(false);
    }
  }

  async function createDb() {
    if (!newName.trim()) return;
    setBusyId("new");
    try {
      const db = await api.createLocalDb(newName.trim(), newMode);
      setNewName("");
      setCreating(false);
      await refresh();
      toast("ok", `Created “${db.name}”`);
    } catch (e) {
      toast("err", errMessage(e));
    } finally {
      setBusyId(null);
    }
  }

  async function start(id: string) {
    setBusyId(id);
    try {
      await api.startLocalDb(id);
      await refresh();
    } catch (e) {
      toast("err", errMessage(e));
    } finally {
      setBusyId(null);
    }
  }

  async function stop(id: string) {
    setBusyId(id);
    try {
      await api.stopLocalDb(id);
      await refresh();
    } catch (e) {
      toast("err", errMessage(e));
    } finally {
      setBusyId(null);
    }
  }

  async function open(id: string) {
    setBusyId(id);
    try {
      const conn = await api.openLocalDb(id);
      await refreshConnections();
      await connectTo(conn.id);
      onOpened?.();
    } catch (e) {
      toast("err", errMessage(e));
    } finally {
      setBusyId(null);
    }
  }

  async function duplicate(db: LocalDbInfo) {
    const name = `${db.name} copy`;
    setBusyId(db.id);
    try {
      await api.duplicateLocalDb(db.id, name);
      await refresh();
      toast("ok", `Duplicated as “${name}”`);
    } catch (e) {
      toast("err", errMessage(e));
    } finally {
      setBusyId(null);
    }
  }

  async function remove() {
    if (!pendingDelete) return;
    setBusyId(pendingDelete.id);
    try {
      await api.deleteLocalDb(pendingDelete.id);
      setPendingDelete(null);
      await refresh();
      toast("ok", "Local database removed");
    } catch (e) {
      toast("err", errMessage(e));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className={compact ? "space-y-2" : "space-y-4"}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-faint">
            Local databases
          </div>
          {!compact && (
            <p className="mt-1 text-xs text-muted">
              Each name is a separate DynamoDB Local data folder — one per project.
            </p>
          )}
        </div>
        <button
          className="rounded-md p-1 text-muted hover:bg-hover hover:text-ink"
          onClick={() => setCreating((v) => !v)}
          title="New local database"
        >
          <Plus size={14} />
        </button>
      </div>

      {runtime && !runtime.java_path && (
        <div className="rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 text-xs text-accent">
          Java 11+ was not found. Install a JRE (e.g. <span className="mono">brew install openjdk</span>)
          so the app can start DynamoDB Local.
        </div>
      )}

      {runtime && runtime.java_path && !runtime.runtime_ready && (
        <div className="rounded-lg border border-line bg-raised px-3 py-2 text-xs text-muted">
          <div className="mb-2">
            DynamoDB Local will be downloaded once (~50 MB) into Application Support. It is not
            bundled with the app.
          </div>
          <Button tone="primary" disabled={setupBusy} onClick={setupRuntime}>
            {setupBusy ? "Downloading…" : "Download runtime"}
          </Button>
        </div>
      )}

      {runtime?.java_version && compact && (
        <div className="truncate text-[10px] text-faint">{runtime.java_version}</div>
      )}

      {creating && (
        <div className="space-y-2 rounded-xl border border-line bg-raised p-3">
          <Field label="Database name">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="shop, staging, my-app"
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && createDb()}
            />
          </Field>
          <label className="flex items-center gap-2 text-xs text-muted">
            <input
              type="checkbox"
              className="shrink-0"
              checked={newMode === "memory"}
              onChange={(e) => setNewMode(e.target.checked ? "memory" : "persistent")}
            />
            In-memory (data gone when stopped)
          </label>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setCreating(false)}>Cancel</Button>
            <Button
              tone="primary"
              disabled={!newName.trim() || busyId === "new"}
              onClick={createDb}
            >
              Create
            </Button>
          </div>
        </div>
      )}

      {dbs.length === 0 && !creating ? (
        <div className="px-1 py-2 text-xs text-muted">
          No local databases yet. Create one for each project.
        </div>
      ) : (
        <ul className="space-y-1">
          {dbs.map((db) => {
            const busy = busyId === db.id;
            return (
              <li
                key={db.id}
                className="rounded-lg border border-transparent px-2 py-2 hover:border-line hover:bg-hover/60"
              >
                <div className="flex items-start gap-2">
                  <HardDrive
                    size={14}
                    className={`mt-0.5 shrink-0 ${db.running ? "text-ok" : "text-faint"}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-medium">{db.name}</span>
                      {db.running ? (
                        <Badge tone="ok">:{db.port}</Badge>
                      ) : (
                        <Badge>stopped</Badge>
                      )}
                      {db.mode === "memory" ? <Badge tone="warn">memory</Badge> : null}
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[10px] text-faint">
                      {db.endpoint}
                      {db.size_bytes ? ` · ${formatBytes(db.size_bytes)}` : ""}
                    </div>
                  </div>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-0.5 pl-6">
                  <IconBtn
                    title="Open in app"
                    disabled={busy}
                    onClick={() => open(db.id)}
                  >
                    <Plug size={13} />
                  </IconBtn>
                  {db.running ? (
                    <IconBtn title="Stop" disabled={busy} onClick={() => stop(db.id)}>
                      <Square size={12} />
                    </IconBtn>
                  ) : (
                    <IconBtn title="Start" disabled={busy} onClick={() => start(db.id)}>
                      <Play size={13} />
                    </IconBtn>
                  )}
                  <IconBtn title="Duplicate" disabled={busy} onClick={() => duplicate(db)}>
                    <Copy size={13} />
                  </IconBtn>
                  <IconBtn
                    title="Show folder"
                    disabled={busy}
                    onClick={() =>
                      revealItemInDir(db.data_path).catch((e) => toast("err", errMessage(e)))
                    }
                  >
                    <FolderOpen size={13} />
                  </IconBtn>
                  <IconBtn
                    title="Delete"
                    disabled={busy}
                    danger
                    onClick={() => setPendingDelete(db)}
                  >
                    <Trash2 size={13} />
                  </IconBtn>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {pendingDelete && (
        <ConfirmDialog
          title={`Delete local database “${pendingDelete.name}”?`}
          body="This stops the instance if it is running and deletes its data folder. Tables and items in that file are gone. AWS accounts are not affected."
          confirmLabel="Delete database"
          confirmRequires={pendingDelete.size_bytes > 0 ? pendingDelete.name : undefined}
          onConfirm={remove}
          onClose={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}

function IconBtn({
  title,
  children,
  onClick,
  disabled,
  danger,
}: {
  title: string;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-md p-1.5 disabled:opacity-40 ${
        danger ? "text-faint hover:bg-raised hover:text-danger" : "text-faint hover:bg-raised hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}
