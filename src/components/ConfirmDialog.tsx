import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { formatItemKey } from "../lib/format";
import type { TableInfo } from "../types";
import { Button } from "./ui";

export function ConfirmDialog({
  title,
  body,
  items,
  table,
  confirmLabel = "Delete",
  confirmRequires,
  busy,
  onConfirm,
  onClose,
}: {
  title: string;
  body: ReactNode;
  items?: Record<string, unknown>[];
  table?: TableInfo;
  confirmLabel?: string;
  confirmRequires?: string;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const [typed, setTyped] = useState("");
  const canConfirm = !confirmRequires || typed === confirmRequires;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const preview = items?.slice(0, 8) ?? [];
  const extra = items ? Math.max(0, items.length - preview.length) : 0;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border border-[#5a2430] bg-[#161014] shadow-2xl">
        <div className="flex items-start gap-3 border-b border-[#3a1a20] px-5 py-4">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#2a1418] text-danger">
            <AlertTriangle size={16} />
          </div>
          <div>
            <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
            <div className="mt-1 text-sm text-muted">{body}</div>
          </div>
        </div>

        {items && table ? (
          <div className="max-h-48 overflow-auto border-b border-[#3a1a20] px-5 py-3">
            <div className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-faint">
              {items.length} item{items.length === 1 ? "" : "s"}
            </div>
            <ul className="space-y-1">
              {preview.map((item, i) => (
                <li key={i} className="truncate font-mono text-[12px] text-ink">
                  {formatItemKey(item, table)}
                </li>
              ))}
            </ul>
            {extra > 0 ? (
              <div className="mt-1 text-xs text-faint">and {extra} more…</div>
            ) : null}
          </div>
        ) : null}

        <div className="space-y-3 px-5 py-4">
          {confirmRequires ? (
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium uppercase tracking-[0.12em] text-faint">
                Type {confirmRequires} to confirm
              </span>
              <input
                className="mono"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoFocus
                placeholder={confirmRequires}
              />
            </label>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button tone="danger" onClick={onConfirm} disabled={!canConfirm || busy}>
              {busy ? "Working…" : confirmLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
