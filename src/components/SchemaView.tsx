import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { api, errMessage } from "../api";
import { formatBytes, formatCount } from "../lib/format";
import { useApp } from "../store";
import type { CreateIndexSpec, KeyAttr, TableInfo } from "../types";
import { ATTR_TYPES } from "../types";
import { Badge, Button, Field } from "./ui";

export function SchemaView({ table }: { table: TableInfo }) {
  const { active, setTableInfo, toast } = useApp();
  const [ttlName, setTtlName] = useState(table.ttl_attribute ?? "ttl");
  const [showGsi, setShowGsi] = useState(false);
  const [gsi, setGsi] = useState<CreateIndexSpec>({
    name: "",
    partition_key: { name: "", type: "S" },
    sort_key: { name: "", type: "S" },
    projection: "ALL",
  });
  const [busy, setBusy] = useState(false);

  async function refresh() {
    if (!active) return;
    setTableInfo(await api.describeTable(active.id, table.name));
  }

  async function toggleTtl(enabled: boolean) {
    if (!active) return;
    try {
      setTableInfo(await api.updateTtl(active.id, table.name, enabled, ttlName));
      toast("ok", enabled ? "TTL enabled" : "TTL disabled");
    } catch (e) {
      toast("err", errMessage(e));
    }
  }

  async function addGsi() {
    if (!active) return;
    setBusy(true);
    try {
      const extras: KeyAttr[] = [gsi.partition_key];
      if (gsi.sort_key?.name) extras.push(gsi.sort_key);
      setTableInfo(await api.addGsi(active.id, table.name, gsi, extras));
      toast("ok", `Creating GSI ${gsi.name}`);
      setShowGsi(false);
    } catch (e) {
      toast("err", errMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function dropGsi(name: string) {
    if (!active) return;
    if (!confirm(`Delete GSI ${name}? This cannot be undone.`)) return;
    try {
      setTableInfo(await api.deleteGsi(active.id, table.name, name));
      toast("ok", `Deleting GSI ${name}`);
    } catch (e) {
      toast("err", errMessage(e));
    }
  }

  return (
    <div className="app-scroll h-full p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">Table schema</h3>
          <StatusBadge status={table.status} />
        </div>
        <Button onClick={() => refresh().catch((e) => toast("err", errMessage(e)))}>
          Refresh describe
        </Button>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <Stat label="Items (approx)" value={formatCount(table.item_count)} />
        <Stat label="Size" value={formatBytes(table.table_size_bytes)} />
        <Stat label="Billing" value={table.billing_mode ?? "—"} />
        <Stat
          label="Capacity"
          value={
            table.read_capacity != null
              ? `${table.read_capacity} / ${table.write_capacity} R/W`
              : "On-demand"
          }
        />
      </div>

      <section className="mt-6">
        <h4 className="mb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-faint">
          Primary key
        </h4>
        <div className="flex flex-wrap gap-2">
          {table.key_schema.map((k) => (
            <div key={k.name} className="rounded-lg border border-line bg-raised px-3 py-2">
              <div className="mono text-sm">{k.name}</div>
              <div className="mt-1 flex gap-1">
                <Badge tone={k.key_type === "HASH" ? "pk" : "sk"}>
                  {k.key_type === "HASH" ? "Partition" : "Sort"}
                </Badge>
                <Badge>
                  {table.attribute_definitions.find((a) => a.name === k.name)?.type ?? "?"}
                </Badge>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-6">
        <h4 className="mb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-faint">
          Attribute definitions
        </h4>
        <div className="flex flex-wrap gap-1.5">
          {table.attribute_definitions.map((a) => (
            <Badge key={a.name}>
              <span className="mono mr-1">{a.name}</span> {a.type}
            </Badge>
          ))}
        </div>
      </section>

      <section className="mt-6">
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-[11px] font-medium uppercase tracking-[0.12em] text-faint">
            Global secondary indexes
          </h4>
          <Button onClick={() => setShowGsi((v) => !v)}>
            <Plus size={13} /> Add GSI
          </Button>
        </div>
        {showGsi && (
          <div className="mb-3 grid grid-cols-4 gap-2 rounded-xl border border-line p-3">
            <Field label="Name">
              <input className="mono" value={gsi.name} onChange={(e) => setGsi({ ...gsi, name: e.target.value })} />
            </Field>
            <Field label="Partition key">
              <div className="flex gap-1">
                <input
                  className="mono"
                  value={gsi.partition_key.name}
                  onChange={(e) =>
                    setGsi({ ...gsi, partition_key: { ...gsi.partition_key, name: e.target.value } })
                  }
                />
                <select
                  className="w-16"
                  value={gsi.partition_key.type}
                  onChange={(e) =>
                    setGsi({ ...gsi, partition_key: { ...gsi.partition_key, type: e.target.value } })
                  }
                >
                  {ATTR_TYPES.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </div>
            </Field>
            <Field label="Sort key">
              <input
                className="mono"
                value={gsi.sort_key?.name ?? ""}
                onChange={(e) =>
                  setGsi({
                    ...gsi,
                    sort_key: { name: e.target.value, type: gsi.sort_key?.type ?? "S" },
                  })
                }
              />
            </Field>
            <div className="flex items-end">
              <Button tone="primary" disabled={busy} onClick={addGsi}>
                Create GSI
              </Button>
            </div>
          </div>
        )}
        {table.gsis.length === 0 ? (
          <div className="text-sm text-muted">No GSIs. Query can still run against the base table.</div>
        ) : (
          <div className="space-y-2">
            {table.gsis.map((g) => (
              <div key={g.name} className="flex items-center justify-between rounded-xl border border-line bg-raised px-3 py-2.5">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="mono font-medium">{g.name}</span>
                    <StatusBadge status={g.status} />
                    <Badge>{g.projection ?? "ALL"}</Badge>
                  </div>
                  <div className="mt-1 text-xs text-muted">
                    {g.key_schema.map((k) => `${k.name} (${k.key_type})`).join(" · ")}
                    {g.item_count != null ? ` · ~${formatCount(g.item_count)} items` : ""}
                  </div>
                </div>
                <button className="text-faint hover:text-danger" onClick={() => dropGsi(g.name)}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="mt-6">
        <h4 className="mb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-faint">
          Local secondary indexes
        </h4>
        {table.lsis.length === 0 ? (
          <div className="text-sm text-muted">No LSIs.</div>
        ) : (
          <div className="space-y-2">
            {table.lsis.map((l) => (
              <div key={l.name} className="rounded-xl border border-line bg-raised px-3 py-2.5">
                <span className="mono font-medium">{l.name}</span>
                <div className="mt-1 text-xs text-muted">
                  {l.key_schema.map((k) => `${k.name} (${k.key_type})`).join(" · ")}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="mt-6 grid grid-cols-2 gap-4">
        <div className="rounded-xl border border-line p-4">
          <h4 className="mb-2 text-sm font-medium">Time to live</h4>
          <div className="mb-3 flex gap-2">
            <input
              className="mono"
              value={ttlName}
              onChange={(e) => setTtlName(e.target.value)}
              placeholder="attribute name"
            />
            {table.ttl_enabled ? (
              <Button onClick={() => toggleTtl(false)}>Disable</Button>
            ) : (
              <Button tone="primary" onClick={() => toggleTtl(true)}>
                Enable
              </Button>
            )}
          </div>
          <div className="text-xs text-muted">
            {table.ttl_enabled
              ? `Enabled on ${table.ttl_attribute}`
              : "Items are not expired automatically."}
          </div>
        </div>
        <div className="rounded-xl border border-line p-4">
          <h4 className="mb-2 text-sm font-medium">Streams</h4>
          <div className="text-sm">
            {table.stream_enabled ? (
              <>
                <Badge tone="ok">Enabled</Badge>
                <div className="mt-2 text-xs text-muted">{table.stream_view_type}</div>
                {table.stream_arn ? (
                  <div className="mt-1 break-all font-mono text-[11px] text-faint">{table.stream_arn}</div>
                ) : null}
              </>
            ) : (
              <span className="text-muted">Disabled</span>
            )}
          </div>
        </div>
      </section>

      <p className="mt-6 text-[11px] text-faint">
        Item count and size are updated by DynamoDB periodically, not in real time.
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-raised px-3 py-3">
      <div className="text-[11px] uppercase tracking-[0.12em] text-faint">{label}</div>
      <div className="mt-1 text-sm font-medium">{value}</div>
    </div>
  );
}

function StatusBadge({ status }: { status?: string | null }) {
  if (!status) return null;
  const tone =
    status === "ACTIVE" ? "ok" : status === "DELETING" ? "danger" : "warn";
  return <Badge tone={tone}>{status}</Badge>;
}
