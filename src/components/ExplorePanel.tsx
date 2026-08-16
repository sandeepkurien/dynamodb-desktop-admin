import { useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  FolderArchive,
  Play,
  Plus,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { api, errMessage } from "../api";
import {
  attrType,
  hashKey,
  itemKey,
  itemKeyId,
  previewValue,
  pretty,
  rangeKey,
  selectableIndexes,
} from "../lib/format";
import { useApp } from "../store";
import type { Condition, PageResult, TableInfo } from "../types";
import { FILTER_OPERATORS, SK_OPERATORS, VALUE_TYPES } from "../types";
import { ConfirmDialog } from "./ConfirmDialog";
import { ItemEditor } from "./ItemEditor";
import { SoftDeleteDialog } from "./SoftDeleteDialog";
import { Badge, Button, Field } from "./ui";

type Mode = "query" | "scan" | "get" | "partiql";

const blankFilter = (): Condition => ({
  attribute: "",
  operator: "eq",
  value: "",
  value_type: "S",
});

export function ExplorePanel({ table }: { table: TableInfo }) {
  const { active, toast } = useApp();
  const [mode, setMode] = useState<Mode>("scan");
  const [indexId, setIndexId] = useState("");
  const [pkValue, setPkValue] = useState("");
  const [skOp, setSkOp] = useState("eq");
  const [skValue, setSkValue] = useState("");
  const [skValueTo, setSkValueTo] = useState("");
  const [filters, setFilters] = useState<Condition[]>([]);
  const [limit, setLimit] = useState(50);
  const [forward, setForward] = useState(true);
  const [consistent, setConsistent] = useState(false);
  const [getPk, setGetPk] = useState("");
  const [getSk, setGetSk] = useState("");
  const [partiql, setPartiql] = useState(`SELECT * FROM "${table.name}"`);
  const [result, setResult] = useState<PageResult | null>(null);
  const [pages, setPages] = useState<unknown[]>([]);
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState<{
    mode: "create" | "edit";
    item?: Record<string, unknown>;
    ddb?: Record<string, unknown>;
  } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastClicked, setLastClicked] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Record<string, unknown>[] | null>(null);
  const [pendingSoft, setPendingSoft] = useState<Record<string, unknown>[] | null>(null);
  const [mutating, setMutating] = useState(false);

  const indexes = useMemo(() => selectableIndexes(table), [table]);
  const selected = indexes.find((i) => i.id === indexId) ?? indexes[0];
  const pkName = hashKey(selected?.schema ?? table.key_schema);
  const skName = rangeKey(selected?.schema ?? table.key_schema);
  const tablePk = hashKey(table.key_schema);
  const tableSk = rangeKey(table.key_schema);

  useEffect(() => {
    setIndexId("");
    setResult(null);
    setPages([]);
    setSelectedIds(new Set());
    setLastClicked(null);
    setPartiql(`SELECT * FROM "${table.name}"`);
  }, [table.name]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        run();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, indexId, pkValue, skOp, skValue, skValueTo, filters, limit, forward, consistent, getPk, getSk, partiql, table, active]);

  const columns = useMemo(() => {
    const keys = new Set<string>();
    for (const k of table.key_schema) keys.add(k.name);
    for (const item of result?.items ?? []) {
      Object.keys(item).forEach((k) => keys.add(k));
    }
    return Array.from(keys);
  }, [result, table]);

  function pkType() {
    return pkName ? attrType(table, pkName) : "S";
  }
  function skType() {
    return skName ? attrType(table, skName) : "S";
  }

  async function run(startKey?: unknown, stack?: unknown[]) {
    if (!active) return;
    setBusy(true);
    try {
      let page: PageResult;
      if (mode === "scan") {
        page = await api.scanItems(active.id, {
          table_name: table.name,
          index_name: indexId || null,
          filters: filters.length ? filters : null,
          limit,
          exclusive_start_key: startKey ?? null,
          consistent_read: indexId ? false : consistent,
        });
      } else if (mode === "query") {
        if (!pkName || pkValue === "") {
          toast("err", "Partition key value is required");
          setBusy(false);
          return;
        }
        page = await api.queryItems(active.id, {
          table_name: table.name,
          index_name: indexId || null,
          partition_key: {
            attribute: pkName,
            operator: "eq",
            value: pkValue,
            value_type: pkType(),
          },
          sort_key:
            skName && skValue !== ""
              ? {
                  attribute: skName,
                  operator: skOp,
                  value: skValue,
                  value_to: skOp === "between" ? skValueTo : undefined,
                  value_type: skType(),
                }
              : null,
          filters: filters.length ? filters : null,
          limit,
          exclusive_start_key: startKey ?? null,
          scan_index_forward: forward,
          consistent_read: indexId ? false : consistent,
        });
      } else if (mode === "get") {
        if (!tablePk || getPk === "") {
          toast("err", "Partition key is required");
          setBusy(false);
          return;
        }
        const key: Record<string, unknown> = { [tablePk]: coerce(getPk, attrType(table, tablePk)) };
        if (tableSk) {
          if (getSk === "") {
            toast("err", "Sort key is required");
            setBusy(false);
            return;
          }
          key[tableSk] = coerce(getSk, attrType(table, tableSk));
        }
        const item = await api.getItem(active.id, table.name, key, consistent);
        page = {
          items: item ? [item] : [],
          items_ddb: [],
          count: item ? 1 : 0,
          scanned_count: 1,
        };
      } else {
        const token =
          startKey && typeof startKey === "object" && startKey && "nextToken" in (startKey as object)
            ? String((startKey as { nextToken: string }).nextToken)
            : null;
        page = await api.executePartiql(active.id, partiql, token, limit);
      }
      setResult(page);
      setPages(stack ?? []);
      setSelectedIds(new Set());
      setLastClicked(null);
    } catch (e) {
      toast("err", errMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function nextPage() {
    if (!result?.last_evaluated_key) return;
    const stack = [...pages, result.last_evaluated_key];
    // previous start is last of current stack; we need to pass current LEK
    const prevStarts = pages;
    run(result.last_evaluated_key, prevStarts.concat(result.last_evaluated_key));
    void stack;
  }

  function prevPage() {
    if (pages.length === 0) {
      run(undefined, []);
      return;
    }
    const stack = pages.slice(0, -1);
    run(stack[stack.length - 1], stack);
  }

  const selectedItems = useMemo(() => {
    if (!result) return [];
    return result.items.filter((item) => selectedIds.has(itemKeyId(item, table)));
  }, [result, selectedIds, table]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        !!target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);
      if (typing || pendingDelete || pendingSoft || editor) return;
      if (e.key === "Escape" && selectedIds.size) {
        setSelectedIds(new Set());
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedItems.length) {
        e.preventDefault();
        setPendingDelete(selectedItems);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedIds, selectedItems, pendingDelete, pendingSoft, editor]);

  function toggleOne(item: Record<string, unknown>, index: number, shift: boolean) {
    if (!result) return;
    const id = itemKeyId(item, table);
    if (shift && lastClicked != null) {
      const from = Math.min(lastClicked, index);
      const to = Math.max(lastClicked, index);
      const next = new Set(selectedIds);
      for (let i = from; i <= to; i++) {
        next.add(itemKeyId(result.items[i], table));
      }
      setSelectedIds(next);
    } else {
      const next = new Set(selectedIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setSelectedIds(next);
    }
    setLastClicked(index);
  }

  function toggleAll() {
    if (!result || result.items.length === 0) return;
    if (selectedItems.length === result.items.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(result.items.map((item) => itemKeyId(item, table))));
    }
  }

  function reportMutate(
    action: string,
    result: { succeeded: number; skipped: number; errors: string[] },
  ) {
    const bits = [`${result.succeeded} ${action}`];
    if (result.skipped) bits.push(`${result.skipped} skipped`);
    if (result.errors.length) {
      toast("err", `${bits.join(" · ")}. ${result.errors[0]}`);
    } else {
      toast("ok", bits.join(" · "));
    }
  }

  async function confirmHardDelete() {
    if (!active || !pendingDelete?.length) return;
    setMutating(true);
    try {
      const keys = pendingDelete.map((item) => itemKey(item, table));
      const out = await api.batchDeleteItems(active.id, table.name, keys);
      reportMutate(out.succeeded === 1 ? "deleted" : "deleted", out);
      setPendingDelete(null);
      setSelectedIds(new Set());
      setEditor(null);
      await run(pages[pages.length - 1], pages);
    } catch (e) {
      toast("err", errMessage(e));
    } finally {
      setMutating(false);
    }
  }

  async function confirmSoftDelete(opts: {
    renamePartition: boolean;
    renameSort: boolean;
    strategy: "prefix" | "suffix";
    token: string;
    stampDeletedAt: boolean;
  }) {
    if (!active || !pendingSoft?.length) return;
    setMutating(true);
    try {
      const out = await api.softDeleteItems(active.id, table.name, pendingSoft, {
        rename_partition: opts.renamePartition,
        rename_sort: opts.renameSort,
        strategy: opts.strategy,
        token: opts.token,
        stamp_deleted_at: opts.stampDeletedAt,
        deleted_at: new Date().toISOString(),
      });
      reportMutate("soft-deleted", out);
      setPendingSoft(null);
      setSelectedIds(new Set());
      setEditor(null);
      await run(pages[pages.length - 1], pages);
    } catch (e) {
      toast("err", errMessage(e));
    } finally {
      setMutating(false);
    }
  }

  async function importJson(file: File) {
    if (!active) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      const n = await api.batchPutItems(active.id, table.name, items, "document");
      toast("ok", `Imported ${n} item${n === 1 ? "" : "s"}`);
      run();
    } catch (e) {
      toast("err", errMessage(e));
    }
  }

  function exportJson() {
    const blob = new Blob([pretty(result?.items ?? [])], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${table.name}-items.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-line px-4 py-3">
        <div className="mb-3 flex items-center gap-1">
          {(["query", "scan", "get", "partiql"] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`rounded-lg px-3 py-1.5 text-sm capitalize ${
                mode === m ? "bg-hover text-ink" : "text-muted hover:text-ink"
              }`}
            >
              {m === "partiql" ? "PartiQL" : m}
            </button>
          ))}
        </div>

        {(mode === "query" || mode === "scan") && (
          <div className="space-y-3">
            <div className="grid grid-cols-12 gap-2">
              <Field label="Index" className="col-span-6">
                <select value={indexId} onChange={(e) => setIndexId(e.target.value)}>
                  {indexes.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.label}
                      {i.status && i.status !== "ACTIVE" ? ` (${i.status})` : ""}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Limit" className="col-span-2">
                <input
                  type="number"
                  min={1}
                  max={1000}
                  value={limit}
                  onChange={(e) => setLimit(Number(e.target.value))}
                />
              </Field>
              {mode === "query" && (
                <Field label="Order" className="col-span-2">
                  <select value={forward ? "asc" : "desc"} onChange={(e) => setForward(e.target.value === "asc")}>
                    <option value="asc">Ascending</option>
                    <option value="desc">Descending</option>
                  </select>
                </Field>
              )}
              <label className="col-span-2 mt-6 flex items-center gap-2 text-xs text-muted">
                <input
                  type="checkbox"
                  className="w-auto"
                  checked={consistent}
                  disabled={!!indexId}
                  onChange={(e) => setConsistent(e.target.checked)}
                />
                Consistent
              </label>
            </div>

            {mode === "query" && (
              <div className="grid grid-cols-12 gap-2">
                <Field label={`${pkName ?? "partition key"} *`} className="col-span-6">
                  <div className="flex gap-2">
                    <input
                      className="mono"
                      value={pkValue}
                      onChange={(e) => setPkValue(e.target.value)}
                      placeholder={pkName}
                      onKeyDown={(e) => e.key === "Enter" && run()}
                    />
                    <Badge tone="pk">{pkType()}</Badge>
                  </div>
                </Field>
                {skName ? (
                  <Field label={skName} className="col-span-6">
                    <div className="flex gap-2">
                      <select className="w-36" value={skOp} onChange={(e) => setSkOp(e.target.value)}>
                        {SK_OPERATORS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                      <input
                        className="mono"
                        value={skValue}
                        onChange={(e) => setSkValue(e.target.value)}
                        placeholder="value"
                        onKeyDown={(e) => e.key === "Enter" && run()}
                      />
                      {skOp === "between" && (
                        <input
                          className="mono"
                          value={skValueTo}
                          onChange={(e) => setSkValueTo(e.target.value)}
                          placeholder="and"
                        />
                      )}
                      <Badge tone="sk">{skType()}</Badge>
                    </div>
                  </Field>
                ) : null}
              </div>
            )}

            <Filters filters={filters} setFilters={setFilters} />
          </div>
        )}

        {mode === "get" && (
          <div className="grid grid-cols-12 gap-2">
            <Field label={`${tablePk ?? "pk"} *`} className="col-span-5">
              <input className="mono" value={getPk} onChange={(e) => setGetPk(e.target.value)} />
            </Field>
            {tableSk ? (
              <Field label={`${tableSk} *`} className="col-span-5">
                <input className="mono" value={getSk} onChange={(e) => setGetSk(e.target.value)} />
              </Field>
            ) : (
              <div className="col-span-5" />
            )}
            <label className="col-span-2 mt-6 flex items-center gap-2 text-xs text-muted">
              <input
                type="checkbox"
                className="w-auto"
                checked={consistent}
                onChange={(e) => setConsistent(e.target.checked)}
              />
              Consistent
            </label>
          </div>
        )}

        {mode === "partiql" && (
          <Field label="Statement">
            <textarea
              className="h-24"
              value={partiql}
              onChange={(e) => setPartiql(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") run();
              }}
            />
          </Field>
        )}

        <div className="mt-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button tone="primary" onClick={() => run()} disabled={busy}>
              <Play size={13} />
              {busy ? "Running…" : mode === "get" ? "Get item" : "Run"}
            </Button>
            <span className="text-[11px] text-faint">⌘↵</span>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={() => setEditor({ mode: "create" })}>
              <Plus size={13} /> New item
            </Button>
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-line-strong bg-raised px-3 py-1.5 text-[13px] hover:bg-hover">
              <Upload size={13} /> Import
              <input
                type="file"
                accept="application/json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) importJson(f);
                  e.target.value = "";
                }}
              />
            </label>
            <Button onClick={exportJson} disabled={!result?.items.length}>
              <Download size={13} /> Export page
            </Button>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between border-b border-line px-4 py-2 text-xs text-muted">
        <div className="flex min-w-0 items-center gap-2">
          <span>
            {result
              ? `${result.count} returned · ${result.scanned_count} scanned${
                  result.consumed_capacity != null
                    ? ` · ${result.consumed_capacity.toFixed(2)} RCU`
                    : ""
                }`
              : "No results yet"}
          </span>
          {selectedItems.length > 0 ? (
            <div className="flex items-center gap-1.5">
              <Badge tone="warn">{selectedItems.length} selected</Badge>
              <Button
                tone="quiet"
                onClick={() => setPendingSoft(selectedItems)}
                title="Soft-delete selected"
              >
                <FolderArchive size={13} /> Soft-delete
              </Button>
              <Button
                tone="danger"
                onClick={() => setPendingDelete(selectedItems)}
                title="Delete selected permanently"
              >
                <Trash2 size={13} /> Delete
              </Button>
              <button
                className="rounded p-1 text-faint hover:text-ink"
                onClick={() => setSelectedIds(new Set())}
                title="Clear selection"
              >
                <X size={13} />
              </button>
            </div>
          ) : result?.items.length ? (
            <span className="text-faint">Select rows to delete or soft-delete</span>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          <Button tone="quiet" disabled={pages.length === 0 && !result} onClick={prevPage}>
            <ChevronLeft size={14} /> Prev
          </Button>
          <Button tone="quiet" disabled={!result?.last_evaluated_key} onClick={nextPage}>
            Next <ChevronRight size={14} />
          </Button>
        </div>
      </div>

      <div className="app-scroll min-h-0 flex-1">
        {!result ? (
          <div className="p-8 text-sm text-muted">
            Run a scan to browse items, or switch to Query and pick the table or a GSI.
          </div>
        ) : result.items.length === 0 ? (
          <div className="p-8 text-sm text-muted">No items matched.</div>
        ) : (
          <table className="w-full min-w-max text-left text-[13px]">
            <thead className="sticky top-0 bg-panel">
              <tr className="border-b border-line">
                <th className="w-10 px-3 py-2">
                  <input
                    type="checkbox"
                    className="w-auto"
                    checked={
                      result.items.length > 0 &&
                      selectedItems.length === result.items.length
                    }
                    ref={(el) => {
                      if (el) {
                        el.indeterminate =
                          selectedItems.length > 0 &&
                          selectedItems.length < result.items.length;
                      }
                    }}
                    onChange={toggleAll}
                    title="Select all on this page"
                  />
                </th>
                {columns.map((c) => (
                  <th key={c} className="px-3 py-2 font-medium text-faint">
                    <span className="mono">{c}</span>
                    {c === tablePk ? (
                      <Badge tone="pk">PK</Badge>
                    ) : c === tableSk ? (
                      <span className="ml-1">
                        <Badge tone="sk">SK</Badge>
                      </span>
                    ) : null}
                  </th>
                ))}
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {result.items.map((item, i) => {
                const id = itemKeyId(item, table);
                const checked = selectedIds.has(id);
                return (
                  <tr
                    key={id || i}
                    className={`cursor-pointer border-b border-line/70 hover:bg-hover/70 ${
                      checked ? "bg-accent/5" : ""
                    }`}
                    onClick={() =>
                      setEditor({
                        mode: "edit",
                        item,
                        ddb: result.items_ddb[i],
                      })
                    }
                  >
                    <td
                      className="px-3 py-2"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleOne(item, i, e.shiftKey);
                      }}
                    >
                      <input
                        type="checkbox"
                        className="w-auto"
                        checked={checked}
                        onChange={() => undefined}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleOne(item, i, e.shiftKey);
                        }}
                      />
                    </td>
                    {columns.map((c) => (
                      <td key={c} className="max-w-[280px] truncate px-3 py-2 font-mono text-[12px]">
                        {previewValue(item[c])}
                      </td>
                    ))}
                    <td className="px-2 py-1 text-right" onClick={(e) => e.stopPropagation()}>
                      <button
                        className="rounded p-1 text-faint hover:text-ink"
                        title="Copy JSON"
                        onClick={() => {
                          navigator.clipboard.writeText(pretty(item));
                          toast("ok", "Copied");
                        }}
                      >
                        <Copy size={13} />
                      </button>
                      <button
                        className="rounded p-1 text-faint hover:text-accent"
                        title="Soft-delete"
                        onClick={() => setPendingSoft([item])}
                      >
                        <FolderArchive size={13} />
                      </button>
                      <button
                        className="rounded p-1 text-faint hover:text-danger"
                        title="Delete permanently"
                        onClick={() => setPendingDelete([item])}
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {editor && (
        <ItemEditor
          table={table}
          mode={editor.mode}
          initial={editor.item}
          initialDdb={editor.ddb}
          onClose={() => setEditor(null)}
          onSaved={() => run(pages[pages.length - 1], pages)}
          onRequestDelete={
            editor.item ? () => setPendingDelete([editor.item!]) : undefined
          }
          onRequestSoftDelete={
            editor.item ? () => setPendingSoft([editor.item!]) : undefined
          }
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title={
            pendingDelete.length === 1
              ? "Delete this item permanently?"
              : `Delete ${pendingDelete.length} items permanently?`
          }
          body={
            pendingDelete.length === 1 ? (
              <>
                This cannot be undone. DynamoDB will remove the item identified by the
                primary key below. Soft-delete if you want to keep a renamed copy.
              </>
            ) : (
              <>
                This cannot be undone. All selected items will be removed by primary key.
                Type DELETE to confirm the bulk operation.
              </>
            )
          }
          items={pendingDelete}
          table={table}
          confirmLabel={
            pendingDelete.length === 1 ? "Delete permanently" : `Delete ${pendingDelete.length} items`
          }
          confirmRequires={pendingDelete.length > 1 ? "DELETE" : undefined}
          busy={mutating}
          onConfirm={confirmHardDelete}
          onClose={() => !mutating && setPendingDelete(null)}
        />
      )}

      {pendingSoft && (
        <SoftDeleteDialog
          table={table}
          items={pendingSoft}
          busy={mutating}
          onClose={() => !mutating && setPendingSoft(null)}
          onConfirm={confirmSoftDelete}
        />
      )}
    </div>
  );
}

function Filters({
  filters,
  setFilters,
}: {
  filters: Condition[];
  setFilters: (f: Condition[]) => void;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-faint">
          Filters
        </span>
        <button
          className="text-xs text-muted hover:text-ink"
          onClick={() => setFilters([...filters, blankFilter()])}
        >
          + Add filter
        </button>
      </div>
      <div className="space-y-1.5">
        {filters.map((f, i) => (
          <div key={i} className="grid grid-cols-12 gap-2">
            <input
              className="col-span-3 mono"
              placeholder="attribute"
              value={f.attribute}
              onChange={(e) => {
                const next = [...filters];
                next[i] = { ...f, attribute: e.target.value };
                setFilters(next);
              }}
            />
            <select
              className="col-span-2"
              value={f.operator}
              onChange={(e) => {
                const next = [...filters];
                next[i] = { ...f, operator: e.target.value };
                setFilters(next);
              }}
            >
              {FILTER_OPERATORS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <input
              className="col-span-4 mono"
              placeholder={f.operator === "in" ? "a, b, c" : "value"}
              value={String(f.value ?? "")}
              disabled={f.operator === "exists" || f.operator === "not_exists"}
              onChange={(e) => {
                const next = [...filters];
                next[i] = { ...f, value: e.target.value };
                setFilters(next);
              }}
            />
            {f.operator === "between" ? (
              <input
                className="col-span-2 mono"
                placeholder="and"
                value={String(f.value_to ?? "")}
                onChange={(e) => {
                  const next = [...filters];
                  next[i] = { ...f, value_to: e.target.value };
                  setFilters(next);
                }}
              />
            ) : (
              <select
                className="col-span-2"
                value={f.value_type ?? "S"}
                onChange={(e) => {
                  const next = [...filters];
                  next[i] = { ...f, value_type: e.target.value };
                  setFilters(next);
                }}
              >
                {VALUE_TYPES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            )}
            <button
              className="col-span-1 text-faint hover:text-danger"
              onClick={() => setFilters(filters.filter((_, j) => j !== i))}
            >
              <Trash2 size={14} className="mx-auto" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function coerce(raw: string, ty: string): unknown {
  if (ty === "N") {
    const n = Number(raw);
    return Number.isNaN(n) ? raw : n;
  }
  if (ty === "BOOL") return raw === "true" || raw === "1";
  return raw;
}
