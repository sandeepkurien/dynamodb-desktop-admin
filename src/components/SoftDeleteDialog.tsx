import { useEffect, useMemo, useState } from "react";
import { FolderArchive } from "lucide-react";
import {
  applySoftDeleteToken,
  attrType,
  formatItemKey,
  hashKey,
  isAlreadySoftDeleted,
  rangeKey,
} from "../lib/format";
import type { TableInfo } from "../types";
import { SOFT_DELETE_TOKEN } from "../types";
import { Badge, Button, Field } from "./ui";

export function SoftDeleteDialog({
  table,
  items,
  busy,
  onClose,
  onConfirm,
}: {
  table: TableInfo;
  items: Record<string, unknown>[];
  busy?: boolean;
  onClose: () => void;
  onConfirm: (opts: {
    renamePartition: boolean;
    renameSort: boolean;
    strategy: "prefix" | "suffix";
    token: string;
    stampDeletedAt: boolean;
  }) => void;
}) {
  const pk = hashKey(table.key_schema);
  const sk = rangeKey(table.key_schema);
  const pkType = pk ? attrType(table, pk) : "S";
  const skType = sk ? attrType(table, sk) : "S";
  const pkString = pkType === "S";
  const skString = !!sk && skType === "S";

  const [renamePk, setRenamePk] = useState(!skString && pkString);
  const [renameSk, setRenameSk] = useState(skString);
  const [strategy, setStrategy] = useState<"prefix" | "suffix">("prefix");
  const [token, setToken] = useState(SOFT_DELETE_TOKEN);
  const [stamp, setStamp] = useState(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const already = useMemo(
    () => items.filter((item) => isAlreadySoftDeleted(item, table, token)).length,
    [items, table, token],
  );

  const preview = useMemo(() => {
    return items.slice(0, 6).map((item) => {
      const next = { ...item };
      if (renamePk && pk) next[pk] = applySoftDeleteToken(item[pk], strategy, token);
      if (renameSk && sk) next[sk] = applySoftDeleteToken(item[sk], strategy, token);
      return { from: formatItemKey(item, table), to: formatItemKey(next, table) };
    });
  }, [items, renamePk, renameSk, pk, sk, strategy, token, table]);

  const canRun =
    token.trim().length > 0 &&
    (renamePk || renameSk) &&
    (!renamePk || pkString) &&
    (!renameSk || skString);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm">
      <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-line-strong bg-panel shadow-2xl">
        <div className="flex items-start gap-3 border-b border-line px-5 py-4">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
            <FolderArchive size={16} />
          </div>
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold">
              Soft-delete {items.length} item{items.length === 1 ? "" : "s"}
            </h2>
            <p className="mt-1 text-sm leading-5 text-muted">
              DynamoDB cannot rename a key in place. This writes a copy with the new key, then
              deletes the original. The item stays in the table but is no longer found under the
              live key.
            </p>
          </div>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <KeyChoice
              checked={renamePk}
              disabled={!pkString}
              onChange={setRenamePk}
              title="Rename partition key"
              meta={`${pk ?? "pk"} · ${pkType}`}
              hint={
                !pkString
                  ? "Numeric/binary keys cannot be prefixed."
                  : "Moves the item to a new partition."
              }
              hintTone={!pkString ? "danger" : "muted"}
            />
            <KeyChoice
              checked={renameSk}
              disabled={!skString}
              onChange={setRenameSk}
              title="Rename sort key"
              meta={sk ? `${sk} · ${skType}` : "No sort key on this table"}
              hint={
                sk && skString
                  ? "Recommended — keeps the item in the same partition."
                  : undefined
              }
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="How to rename">
              <select
                value={strategy}
                onChange={(e) => setStrategy(e.target.value as "prefix" | "suffix")}
              >
                <option value="prefix">Prefix</option>
                <option value="suffix">Suffix</option>
              </select>
            </Field>
            <Field label="Token">
              <input
                className="mono"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="DELETED#"
              />
            </Field>
          </div>

          <label className="flex items-start gap-2 text-sm leading-5">
            <input
              type="checkbox"
              className="mt-0.5 shrink-0"
              checked={stamp}
              onChange={(e) => setStamp(e.target.checked)}
            />
            <span className="min-w-0">
              Store <span className="mono text-xs">_deletedAt</span> and{" "}
              <span className="mono text-xs">_originalKeys</span> on the new item
            </span>
          </label>

          {already > 0 ? (
            <div className="rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 text-xs text-accent">
              {already} selected item{already === 1 ? " already looks" : "s already look"}{" "}
              soft-deleted and will be skipped.
            </div>
          ) : null}

          <div>
            <div className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-faint">
              Preview
            </div>
            <div className="space-y-1.5 rounded-xl border border-line bg-raised p-3">
              {preview.map((row, i) => (
                <div key={i} className="text-[12px]">
                  <div className="truncate font-mono text-muted">{row.from}</div>
                  <div className="truncate font-mono text-ok">→ {row.to}</div>
                </div>
              ))}
              {items.length > preview.length ? (
                <div className="text-xs text-faint">
                  and {items.length - preview.length} more…
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-3">
          <Badge tone="warn">Original key is deleted after the copy succeeds</Badge>
          <div className="flex shrink-0 gap-2">
            <Button onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button
              tone="primary"
              disabled={!canRun || busy}
              onClick={() =>
                onConfirm({
                  renamePartition: renamePk,
                  renameSort: renameSk,
                  strategy,
                  token: token.trim(),
                  stampDeletedAt: stamp,
                })
              }
            >
              {busy ? "Soft-deleting…" : "Soft-delete"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function KeyChoice({
  checked,
  disabled,
  onChange,
  title,
  meta,
  hint,
  hintTone = "muted",
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  title: string;
  meta: string;
  hint?: string;
  hintTone?: "muted" | "danger";
}) {
  return (
    <label className="flex min-w-0 items-start gap-2.5 overflow-hidden rounded-xl border border-line bg-raised p-3 text-sm">
      <input
        type="checkbox"
        className="mt-0.5 shrink-0"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="min-w-0">
        <span className="block font-medium">{title}</span>
        <span className="mt-0.5 block truncate font-mono text-[11px] text-faint">{meta}</span>
        {hint ? (
          <span
            className={`mt-1 block text-[11px] leading-4 ${
              hintTone === "danger" ? "text-danger" : "text-muted"
            }`}
          >
            {hint}
          </span>
        ) : null}
      </span>
    </label>
  );
}
