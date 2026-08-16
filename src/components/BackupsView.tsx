import { useEffect, useState } from "react";
import { api, errMessage } from "../api";
import { formatBytes } from "../lib/format";
import { useApp } from "../store";
import type { BackupInfo, TableInfo } from "../types";
import { Badge, Button, Field } from "./ui";

export function BackupsView({ table }: { table: TableInfo }) {
  const { active, toast, refreshTables, selectTable } = useApp();
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [name, setName] = useState(`${table.name}-${Date.now()}`);
  const [restoreName, setRestoreName] = useState("");
  const [restoreArn, setRestoreArn] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    if (!active) return;
    try {
      setBackups(await api.listBackups(active.id, table.name));
    } catch (e) {
      toast("err", errMessage(e));
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table.name, active?.id]);

  async function create() {
    if (!active) return;
    setBusy(true);
    try {
      await api.createBackup(active.id, table.name, name.trim());
      toast("ok", "Backup started");
      setName(`${table.name}-${Date.now()}`);
      await load();
    } catch (e) {
      toast("err", errMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(arn: string) {
    if (!active) return;
    if (!confirm("Delete this backup?")) return;
    try {
      await api.deleteBackup(active.id, arn);
      toast("ok", "Backup deleted");
      await load();
    } catch (e) {
      toast("err", errMessage(e));
    }
  }

  async function restore() {
    if (!active || !restoreArn || !restoreName.trim()) return;
    setBusy(true);
    try {
      await api.restoreBackup(active.id, restoreArn, restoreName.trim());
      toast("ok", `Restoring to ${restoreName.trim()}`);
      await refreshTables();
      await selectTable(restoreName.trim());
    } catch (e) {
      toast("err", errMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-scroll h-full p-5">
      <div className="mb-4 flex items-end gap-2">
        <Field label="On-demand backup name" className="flex-1">
          <input className="mono" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Button tone="primary" disabled={busy || !name.trim()} onClick={create}>
          Create backup
        </Button>
      </div>

      {restoreArn && (
        <div className="mb-4 flex items-end gap-2 rounded-xl border border-accent/30 bg-accent/5 p-3">
          <Field label="Restore to new table" className="flex-1">
            <input
              className="mono"
              value={restoreName}
              onChange={(e) => setRestoreName(e.target.value)}
              placeholder="new-table-name"
            />
          </Field>
          <Button tone="primary" disabled={busy} onClick={restore}>
            Restore
          </Button>
          <Button onClick={() => setRestoreArn(null)}>Cancel</Button>
        </div>
      )}

      {backups.length === 0 ? (
        <div className="text-sm text-muted">
          No backups for this table. On-demand backups are not available on DynamoDB Local.
        </div>
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-line text-[11px] uppercase tracking-[0.12em] text-faint">
              <th className="py-2">Name</th>
              <th>Status</th>
              <th>Type</th>
              <th>Created</th>
              <th>Size</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {backups.map((b) => (
              <tr key={b.arn ?? b.name} className="border-b border-line/70">
                <td className="py-2 font-mono text-xs">{b.name}</td>
                <td>
                  <Badge tone={b.status === "AVAILABLE" ? "ok" : "warn"}>{b.status}</Badge>
                </td>
                <td className="text-muted">{b.backup_type}</td>
                <td className="text-muted">{b.created_at}</td>
                <td>{formatBytes(b.size_bytes)}</td>
                <td className="text-right">
                  <Button
                    tone="quiet"
                    disabled={!b.arn}
                    onClick={() => {
                      setRestoreArn(b.arn ?? null);
                      setRestoreName(`${table.name}-restored`);
                    }}
                  >
                    Restore
                  </Button>
                  <Button tone="quiet" disabled={!b.arn} onClick={() => b.arn && remove(b.arn)}>
                    Delete
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
