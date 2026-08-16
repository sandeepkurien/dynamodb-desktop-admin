import { useEffect, useState } from "react";
import { api, errMessage } from "../api";
import { pretty } from "../lib/format";
import { useApp } from "../store";
import type { TableInfo } from "../types";
import { Button, Modal } from "./ui";

export function ItemEditor({
  table,
  initial,
  initialDdb,
  mode,
  onClose,
  onSaved,
  onRequestDelete,
  onRequestSoftDelete,
}: {
  table: TableInfo;
  initial?: Record<string, unknown> | null;
  initialDdb?: Record<string, unknown> | null;
  mode: "create" | "edit";
  onClose: () => void;
  onSaved: () => void;
  onRequestDelete?: () => void;
  onRequestSoftDelete?: () => void;
}) {
  const { active, toast } = useApp();
  const [format, setFormat] = useState<"document" | "ddb">("document");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (mode === "create" && !initial) {
      const seed: Record<string, unknown> = {};
      for (const k of table.key_schema) {
        seed[k.name] = table.attribute_definitions.find((a) => a.name === k.name)?.type === "N"
          ? 0
          : "";
      }
      setText(pretty(format === "ddb" ? toDdbSeed(seed, table) : seed));
    } else if (format === "ddb" && initialDdb) {
      setText(pretty(initialDdb));
    } else {
      setText(pretty(initial ?? {}));
    }
    // Recreate buffer when switching format or target item; user edits are in `text`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, table.name, initial, initialDdb, format]);

  async function save() {
    if (!active) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      toast("err", "Item JSON is not valid");
      return;
    }
    setBusy(true);
    try {
      await api.putItem(active.id, table.name, parsed, format);
      toast("ok", mode === "create" ? "Item created" : "Item saved");
      onSaved();
      onClose();
    } catch (e) {
      toast("err", errMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function remove() {
    if (!initial) return;
    if (onRequestDelete) {
      onRequestDelete();
      return;
    }
  }

  return (
    <Modal
      title={mode === "create" ? `New item · ${table.name}` : `Edit item · ${table.name}`}
      onClose={onClose}
      wide
    >
      <div className="mb-3 flex items-center justify-between">
        <div className="text-xs text-muted">
          Keys: {table.key_schema.map((k) => k.name).join(", ")}
        </div>
        <div className="flex rounded-lg border border-line p-0.5">
          {(["document", "ddb"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFormat(f)}
              className={`rounded-md px-2.5 py-1 text-xs ${
                format === f ? "bg-hover text-ink" : "text-muted"
              }`}
            >
              {f === "document" ? "Document JSON" : "DynamoDB JSON"}
            </button>
          ))}
        </div>
      </div>
      <textarea
        className="h-[420px] w-full"
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
      />
      <div className="mt-4 flex items-center justify-between">
        {mode === "edit" ? (
          <div className="flex gap-2">
            {onRequestSoftDelete ? (
              <Button onClick={onRequestSoftDelete} disabled={busy}>
                Soft-delete
              </Button>
            ) : null}
            <Button tone="danger" onClick={remove} disabled={busy || !onRequestDelete}>
              Delete item
            </Button>
          </div>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button tone="primary" onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save item"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function toDdbSeed(seed: Record<string, unknown>, table: TableInfo): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(seed)) {
    const ty = table.attribute_definitions.find((a) => a.name === k)?.type ?? "S";
    out[k] = ty === "N" ? { N: String(v) } : { S: String(v) };
  }
  return out;
}
