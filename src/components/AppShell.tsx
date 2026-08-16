import { useEffect, useMemo, useState } from "react";
import {
  Database,
  Plus,
  RefreshCw,
  Search,
  Table2,
  X,
} from "lucide-react";
import { connectionKindLabel } from "../lib/format";
import { useApp } from "../store";
import { BackupsView } from "./BackupsView";
import { ConnectionScreen } from "./ConnectionScreen";
import { CreateTableModal } from "./CreateTableModal";
import { ExplorePanel } from "./ExplorePanel";
import { SchemaView } from "./SchemaView";
import { SettingsView } from "./SettingsView";
import { Badge, Button, EmptyState, Spinner } from "./ui";

type Tab = "explore" | "schema" | "backups" | "settings";

export function AppShell() {
  const {
    active,
    sessions,
    activeId,
    tables,
    selectedTable,
    tableInfo,
    loadingTables,
    loadingTable,
    disconnect,
    focusSession,
    refreshTables,
    selectTable,
    toast,
  } = useApp();
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<Tab>("explore");
  const [creating, setCreating] = useState(false);
  const [adding, setAdding] = useState(false);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return tables;
    return tables.filter((t) => t.toLowerCase().includes(s));
  }, [tables, q]);

  useEffect(() => {
    setTab("explore");
  }, [selectedTable, activeId]);

  useEffect(() => {
    setQ("");
  }, [activeId]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 items-center gap-3 border-b border-line bg-panel px-3">
        <div className="flex shrink-0 items-center gap-2 pl-1">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-accent/15 text-accent">
            <Database size={14} />
          </div>
          <span className="hidden font-semibold tracking-tight sm:inline">DynamoDB Admin</span>
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {sessions.map((s) => {
            const focused = s.connection.id === activeId;
            return (
              <div
                key={s.connection.id}
                className={`flex max-w-[240px] shrink-0 items-center rounded-lg border ${
                  focused
                    ? "border-accent/40 bg-accent/10"
                    : "border-transparent bg-raised/60 hover:bg-hover"
                }`}
              >
                <button
                  className="min-w-0 flex-1 px-2.5 py-1.5 text-left"
                  onClick={() => focusSession(s.connection.id)}
                  title={`${s.connection.name} · ${connectionKindLabel(s.connection.auth.kind)} · ${s.connection.region}`}
                >
                  <div className="truncate text-[13px] font-medium">{s.connection.name}</div>
                  <div className="truncate text-[10px] text-faint">
                    {connectionKindLabel(s.connection.auth.kind)} · {s.connection.region}
                    {s.connection.auth.kind === "local" ? ` · ${s.connection.auth.endpoint}` : ""}
                  </div>
                </button>
                <button
                  className="mr-1 rounded p-1 text-faint hover:bg-raised hover:text-danger"
                  title="Close this connection"
                  onClick={() => disconnect(s.connection.id)}
                >
                  <X size={12} />
                </button>
              </div>
            );
          })}
          <button
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-dashed border-line-strong text-muted hover:border-accent/50 hover:text-ink"
            onClick={() => setAdding(true)}
            title="Open another connection"
          >
            <Plus size={14} />
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[260px] flex-col border-r border-line bg-panel">
          <div className="flex items-center gap-2 border-b border-line p-3">
            <div className="relative flex-1">
              <Search size={13} className="absolute left-2.5 top-2.5 text-faint" />
              <input
                className="pl-8"
                placeholder="Filter tables"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <button
              className="rounded-lg border border-line-strong p-2 text-muted hover:bg-hover"
              onClick={() => refreshTables()}
              title="Refresh tables"
            >
              <RefreshCw size={13} className={loadingTables ? "animate-spin" : ""} />
            </button>
          </div>
          <div className="flex items-center justify-between px-3 py-2 text-[11px] uppercase tracking-[0.12em] text-faint">
            <span>
              Tables · {tables.length}
            </span>
            <button
              className="rounded p-1 text-muted hover:bg-hover hover:text-ink"
              onClick={() => setCreating(true)}
              title="Create table"
            >
              <Plus size={13} />
            </button>
          </div>
          <div className="app-scroll flex-1 px-2 pb-3">
            {loadingTables ? (
              <div className="p-3">
                <Spinner label="Loading tables…" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="px-2 py-4 text-sm text-muted">No tables.</div>
            ) : (
              <ul className="space-y-0.5">
                {filtered.map((name) => (
                  <li key={name}>
                    <button
                      onClick={() => selectTable(name)}
                      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left ${
                        selectedTable === name
                          ? "bg-accent/10 text-ink"
                          : "text-muted hover:bg-hover hover:text-ink"
                      }`}
                    >
                      <Table2 size={13} className="shrink-0 text-faint" />
                      <span className="truncate mono text-[12.5px]">{name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col bg-bg">
          {!selectedTable ? (
            <EmptyState
              title="Select a table"
              body="Pick a table from the sidebar to scan, query (base table or any GSI/LSI), and edit items. You can also create a new table."
              action={<Button onClick={() => setCreating(true)}>Create table</Button>}
            />
          ) : loadingTable || !tableInfo ? (
            <div className="flex h-full items-center justify-center">
              <Spinner label={`Describing ${selectedTable}…`} />
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between border-b border-line px-4 py-2">
                <div className="flex items-center gap-3">
                  <h2 className="mono text-[15px] font-semibold">{tableInfo.name}</h2>
                  {tableInfo.status ? (
                    <Badge tone={tableInfo.status === "ACTIVE" ? "ok" : "warn"}>
                      {tableInfo.status}
                    </Badge>
                  ) : null}
                  <span className="text-xs text-faint">
                    {tableInfo.gsis.length} GSI · {tableInfo.lsis.length} LSI
                  </span>
                </div>
                <div className="flex gap-1">
                  {(
                    [
                      ["explore", "Explore"],
                      ["schema", "Schema"],
                      ["backups", "Backups"],
                      ["settings", "Settings"],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      onClick={() => setTab(id)}
                      className={`rounded-lg px-3 py-1.5 text-sm ${
                        tab === id ? "bg-hover text-ink" : "text-muted hover:text-ink"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="min-h-0 flex-1">
                {tab === "explore" && (
                  <ExplorePanel
                    key={`${active?.id}:${tableInfo.name}`}
                    table={tableInfo}
                  />
                )}
                {tab === "schema" && (
                  <SchemaView key={`${active?.id}:${tableInfo.name}:schema`} table={tableInfo} />
                )}
                {tab === "backups" && (
                  <BackupsView key={`${active?.id}:${tableInfo.name}:backups`} table={tableInfo} />
                )}
                {tab === "settings" && (
                  <SettingsView key={`${active?.id}:${tableInfo.name}:settings`} table={tableInfo} />
                )}
              </div>
            </>
          )}
        </main>
      </div>

      {creating && (
        <CreateTableModal
          onClose={() => setCreating(false)}
          onCreated={async (name) => {
            await refreshTables();
            await selectTable(name);
            toast("ok", `Table ${name} requested`);
          }}
        />
      )}

      {adding && <ConnectionScreen asModal onClose={() => setAdding(false)} />}
    </div>
  );
}
