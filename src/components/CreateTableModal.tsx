import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { api, errMessage } from "../api";
import { useApp } from "../store";
import type { CreateIndexSpec, CreateLsiSpec, CreateTableRequest, KeyAttr } from "../types";
import { ATTR_TYPES } from "../types";
import { Button, Field, Modal } from "./ui";

const blankKey = (): KeyAttr => ({ name: "", type: "S" });
const blankGsi = (): CreateIndexSpec => ({
  name: "",
  partition_key: blankKey(),
  sort_key: { name: "", type: "S" },
  projection: "ALL",
});
const blankLsi = (): CreateLsiSpec => ({
  name: "",
  sort_key: blankKey(),
  projection: "ALL",
});

export function CreateTableModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (name: string) => void;
}) {
  const { active, toast } = useApp();
  const [name, setName] = useState("");
  const [pk, setPk] = useState<KeyAttr>({ name: "pk", type: "S" });
  const [useSk, setUseSk] = useState(true);
  const [sk, setSk] = useState<KeyAttr>({ name: "sk", type: "S" });
  const [billing, setBilling] = useState("PAY_PER_REQUEST");
  const [rcu, setRcu] = useState(5);
  const [wcu, setWcu] = useState(5);
  const [streams, setStreams] = useState(false);
  const [protect, setProtect] = useState(false);
  const [gsis, setGsis] = useState<CreateIndexSpec[]>([]);
  const [lsis, setLsis] = useState<CreateLsiSpec[]>([]);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!active) return;
    const request: CreateTableRequest = {
      table_name: name.trim(),
      partition_key: pk,
      sort_key: useSk && sk.name.trim() ? sk : null,
      billing_mode: billing,
      read_capacity: billing === "PROVISIONED" ? rcu : null,
      write_capacity: billing === "PROVISIONED" ? wcu : null,
      gsis: gsis.filter((g) => g.name.trim() && g.partition_key.name.trim()),
      lsis: lsis.filter((l) => l.name.trim() && l.sort_key.name.trim()),
      stream_enabled: streams,
      stream_view_type: streams ? "NEW_AND_OLD_IMAGES" : null,
      deletion_protection: protect,
    };
    setBusy(true);
    try {
      await api.createTable(active.id, request);
      toast("ok", `Creating table ${request.table_name}`);
      onCreated(request.table_name);
      onClose();
    } catch (e) {
      toast("err", errMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Create table" onClose={onClose} wide>
      <div className="app-scroll max-h-[70vh] space-y-5 pr-1">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Table name" className="col-span-2">
            <input className="mono" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <KeyFields label="Partition key" value={pk} onChange={setPk} />
          <div>
            <label className="mb-2 flex items-center gap-2 text-sm text-muted">
              <input
                type="checkbox"
                className="w-auto"
                checked={useSk}
                onChange={(e) => setUseSk(e.target.checked)}
              />
              Sort key
            </label>
            {useSk ? <KeyFields label="Sort key" value={sk} onChange={setSk} /> : null}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Field label="Capacity">
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

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="w-auto" checked={streams} onChange={(e) => setStreams(e.target.checked)} />
          Enable streams (NEW_AND_OLD_IMAGES)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="w-auto" checked={protect} onChange={(e) => setProtect(e.target.checked)} />
          Deletion protection
        </label>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-medium">Global secondary indexes</h3>
            <Button onClick={() => setGsis((g) => [...g, blankGsi()])}>
              <Plus size={13} /> Add GSI
            </Button>
          </div>
          <div className="space-y-3">
            {gsis.map((g, i) => (
              <div key={i} className="rounded-xl border border-line p-3">
                <div className="mb-2 flex justify-end">
                  <button className="text-faint hover:text-danger" onClick={() => setGsis(gsis.filter((_, j) => j !== i))}>
                    <Trash2 size={14} />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Index name">
                    <input className="mono" value={g.name} onChange={(e) => {
                      const next = [...gsis];
                      next[i] = { ...g, name: e.target.value };
                      setGsis(next);
                    }} />
                  </Field>
                  <Field label="Projection">
                    <select value={g.projection} onChange={(e) => {
                      const next = [...gsis];
                      next[i] = { ...g, projection: e.target.value };
                      setGsis(next);
                    }}>
                      <option>ALL</option>
                      <option>KEYS_ONLY</option>
                      <option>INCLUDE</option>
                    </select>
                  </Field>
                  <KeyFields label="GSI partition key" value={g.partition_key} onChange={(v) => {
                    const next = [...gsis];
                    next[i] = { ...g, partition_key: v };
                    setGsis(next);
                  }} />
                  <KeyFields label="GSI sort key (optional)" value={g.sort_key ?? blankKey()} onChange={(v) => {
                    const next = [...gsis];
                    next[i] = { ...g, sort_key: v };
                    setGsis(next);
                  }} />
                </div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-medium">Local secondary indexes</h3>
            <Button onClick={() => setLsis((l) => [...l, blankLsi()])} disabled={!useSk}>
              <Plus size={13} /> Add LSI
            </Button>
          </div>
          <div className="space-y-3">
            {lsis.map((l, i) => (
              <div key={i} className="rounded-xl border border-line p-3">
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Index name">
                    <input className="mono" value={l.name} onChange={(e) => {
                      const next = [...lsis];
                      next[i] = { ...l, name: e.target.value };
                      setLsis(next);
                    }} />
                  </Field>
                  <KeyFields label="LSI sort key" value={l.sort_key} onChange={(v) => {
                    const next = [...lsis];
                    next[i] = { ...l, sort_key: v };
                    setLsis(next);
                  }} />
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button tone="primary" disabled={busy || !name.trim() || !pk.name.trim()} onClick={submit}>
          {busy ? "Creating…" : "Create table"}
        </Button>
      </div>
    </Modal>
  );
}

function KeyFields({
  label,
  value,
  onChange,
}: {
  label: string;
  value: KeyAttr;
  onChange: (v: KeyAttr) => void;
}) {
  return (
    <Field label={label}>
      <div className="flex gap-2">
        <input
          className="mono"
          value={value.name}
          onChange={(e) => onChange({ ...value, name: e.target.value })}
          placeholder="attribute"
        />
        <select
          className="w-20"
          value={value.type}
          onChange={(e) => onChange({ ...value, type: e.target.value })}
        >
          {ATTR_TYPES.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </div>
    </Field>
  );
}
