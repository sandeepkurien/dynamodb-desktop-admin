import { useState } from "react";
import { api, errMessage } from "../api";
import { useApp } from "../store";
import type { TableInfo } from "../types";
import { Badge, Button, Field } from "./ui";

export function SettingsView({ table }: { table: TableInfo }) {
  const { active, setTableInfo, toast, refreshTables, selectTable } = useApp();
  const [billing, setBilling] = useState(table.billing_mode ?? "PAY_PER_REQUEST");
  const [rcu, setRcu] = useState(table.read_capacity ?? 5);
  const [wcu, setWcu] = useState(table.write_capacity ?? 5);
  const [view, setView] = useState(table.stream_view_type ?? "NEW_AND_OLD_IMAGES");
  const [busy, setBusy] = useState(false);
  const [confirmName, setConfirmName] = useState("");

  async function applyBilling() {
    if (!active) return;
    setBusy(true);
    try {
      const info = await api.updateTableSettings(active.id, table.name, {
        billing_mode: billing,
        read_capacity: billing === "PROVISIONED" ? rcu : null,
        write_capacity: billing === "PROVISIONED" ? wcu : null,
      });
      setTableInfo(info);
      toast("ok", "Capacity settings updated");
    } catch (e) {
      toast("err", errMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function setProtection(enabled: boolean) {
    if (!active) return;
    try {
      setTableInfo(
        await api.updateTableSettings(active.id, table.name, {
          deletion_protection: enabled,
        }),
      );
      toast("ok", enabled ? "Deletion protection on" : "Deletion protection off");
    } catch (e) {
      toast("err", errMessage(e));
    }
  }

  async function setStreams(enabled: boolean) {
    if (!active) return;
    try {
      setTableInfo(
        await api.updateTableSettings(active.id, table.name, {
          stream_enabled: enabled,
          stream_view_type: enabled ? view : null,
        }),
      );
      toast("ok", enabled ? "Streams enabled" : "Streams disabled");
    } catch (e) {
      toast("err", errMessage(e));
    }
  }

  async function drop() {
    if (!active) return;
    if (confirmName !== table.name) {
      toast("err", "Type the table name to confirm");
      return;
    }
    try {
      await api.deleteTable(active.id, table.name);
      toast("ok", `Deleting ${table.name}`);
      await refreshTables();
      await selectTable(null);
    } catch (e) {
      toast("err", errMessage(e));
    }
  }

  return (
    <div className="app-scroll h-full p-5">
      <div className="max-w-xl space-y-6">
        <section className="rounded-xl border border-line p-4">
          <h3 className="mb-3 text-sm font-semibold">Capacity</h3>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Mode">
              <select value={billing} onChange={(e) => setBilling(e.target.value)}>
                <option value="PAY_PER_REQUEST">On-demand</option>
                <option value="PROVISIONED">Provisioned</option>
              </select>
            </Field>
            {billing === "PROVISIONED" && (
              <>
                <Field label="RCU">
                  <input type="number" value={rcu} onChange={(e) => setRcu(Number(e.target.value))} />
                </Field>
                <Field label="WCU">
                  <input type="number" value={wcu} onChange={(e) => setWcu(Number(e.target.value))} />
                </Field>
              </>
            )}
          </div>
          <div className="mt-3">
            <Button tone="primary" disabled={busy} onClick={applyBilling}>
              Save capacity
            </Button>
          </div>
        </section>

        <section className="rounded-xl border border-line p-4">
          <h3 className="mb-3 text-sm font-semibold">Streams</h3>
          <Field label="View type">
            <select value={view} onChange={(e) => setView(e.target.value)}>
              <option>KEYS_ONLY</option>
              <option>NEW_IMAGE</option>
              <option>OLD_IMAGE</option>
              <option>NEW_AND_OLD_IMAGES</option>
            </select>
          </Field>
          <div className="mt-3 flex gap-2">
            {table.stream_enabled ? (
              <Button onClick={() => setStreams(false)}>Disable streams</Button>
            ) : (
              <Button tone="primary" onClick={() => setStreams(true)}>
                Enable streams
              </Button>
            )}
          </div>
        </section>

        <section className="rounded-xl border border-line p-4">
          <h3 className="mb-2 text-sm font-semibold">Deletion protection</h3>
          <p className="mb-3 text-sm text-muted">
            {table.deletion_protection ? (
              <Badge tone="ok">Enabled</Badge>
            ) : (
              <Badge>Disabled</Badge>
            )}
          </p>
          {table.deletion_protection ? (
            <Button onClick={() => setProtection(false)}>Turn off</Button>
          ) : (
            <Button onClick={() => setProtection(true)}>Turn on</Button>
          )}
        </section>

        <section className="rounded-xl border border-[#5a2430] bg-[#1a1012] p-4">
          <h3 className="mb-1 text-sm font-semibold text-danger">Danger zone</h3>
          <p className="mb-3 text-sm text-muted">
            Permanently delete this table and all of its items. Type the table name to confirm.
          </p>
          <Field label="Table name">
            <input
              className="mono"
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              placeholder={table.name}
            />
          </Field>
          <div className="mt-3">
            <Button tone="danger" onClick={drop} disabled={confirmName !== table.name}>
              Delete table
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}
