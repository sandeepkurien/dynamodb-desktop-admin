import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, errMessage } from "./api";
import type { SavedConnection, TableInfo } from "./types";

export type ToastKind = "ok" | "err" | "info";
export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

export interface Session {
  connection: SavedConnection;
  tables: string[];
  selectedTable: string | null;
  tableInfo: TableInfo | null;
  loadingTables: boolean;
  loadingTable: boolean;
}

interface AppCtx {
  connections: SavedConnection[];
  sessions: Session[];
  activeId: string | null;
  active: SavedConnection | null;
  tables: string[];
  selectedTable: string | null;
  tableInfo: TableInfo | null;
  loadingTables: boolean;
  loadingTable: boolean;
  toasts: Toast[];
  refreshConnections: () => Promise<void>;
  connectTo: (id: string) => Promise<void>;
  focusSession: (id: string) => void;
  disconnect: (id?: string) => Promise<void>;
  refreshTables: () => Promise<void>;
  selectTable: (name: string | null) => Promise<void>;
  setTableInfo: (info: TableInfo | null) => void;
  toast: (kind: ToastKind, message: string) => void;
  dismissToast: (id: number) => void;
}

const Ctx = createContext<AppCtx | null>(null);

let toastSeq = 1;

function patchSession(
  sessions: Session[],
  id: string,
  patch: Partial<Session> | ((s: Session) => Session),
): Session[] {
  return sessions.map((s) => {
    if (s.connection.id !== id) return s;
    return typeof patch === "function" ? patch(s) : { ...s, ...patch };
  });
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [connections, setConnections] = useState<SavedConnection[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const focused = sessions.find((s) => s.connection.id === activeId) ?? null;
  const active = focused?.connection ?? null;
  const tables = focused?.tables ?? [];
  const selectedTable = focused?.selectedTable ?? null;
  const tableInfo = focused?.tableInfo ?? null;
  const loadingTables = focused?.loadingTables ?? false;
  const loadingTable = focused?.loadingTable ?? false;

  const toast = useCallback((kind: ToastKind, message: string) => {
    const id = toastSeq++;
    setToasts((t) => [...t, { id, kind, message }]);
    window.setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id));
    }, 4200);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const refreshConnections = useCallback(async () => {
    try {
      setConnections(await api.listConnections());
    } catch (e) {
      toast("err", errMessage(e));
    }
  }, [toast]);

  const focusSession = useCallback((id: string) => {
    setActiveId(id);
  }, []);

  const refreshTables = useCallback(async () => {
    if (!activeId) return;
    const id = activeId;
    setSessions((ss) => patchSession(ss, id, { loadingTables: true }));
    try {
      const names = await api.listTables(id);
      setSessions((ss) => patchSession(ss, id, { tables: names, loadingTables: false }));
    } catch (e) {
      toast("err", errMessage(e));
      setSessions((ss) => patchSession(ss, id, { loadingTables: false }));
    }
  }, [activeId, toast]);

  const selectTable = useCallback(
    async (name: string | null) => {
      if (!activeId) return;
      const id = activeId;
      setSessions((ss) =>
        patchSession(ss, id, {
          selectedTable: name,
          tableInfo: null,
          loadingTable: !!name,
        }),
      );
      if (!name) return;
      try {
        const info = await api.describeTable(id, name);
        setSessions((ss) =>
          patchSession(ss, id, (s) =>
            s.selectedTable === name ? { ...s, tableInfo: info, loadingTable: false } : s,
          ),
        );
      } catch (e) {
        toast("err", errMessage(e));
        setSessions((ss) => patchSession(ss, id, { loadingTable: false }));
      }
    },
    [activeId, toast],
  );

  const setTableInfo = useCallback(
    (info: TableInfo | null) => {
      if (!activeId) return;
      setSessions((ss) => patchSession(ss, activeId, { tableInfo: info }));
    },
    [activeId],
  );

  const connectTo = useCallback(
    async (id: string) => {
      const existing = sessions.find((s) => s.connection.id === id);
      if (existing) {
        setActiveId(id);
        toast("ok", `Switched to ${existing.connection.name}`);
        return;
      }
      try {
        const conn = await api.connect(id);
        setSessions((ss) => {
          if (ss.some((s) => s.connection.id === conn.id)) return ss;
          return [
            ...ss,
            {
              connection: conn,
              tables: [],
              selectedTable: null,
              tableInfo: null,
              loadingTables: true,
              loadingTable: false,
            },
          ];
        });
        setActiveId(conn.id);
        toast("ok", `Connected to ${conn.name}`);
        try {
          const names = await api.listTables(conn.id);
          setSessions((ss) =>
            patchSession(ss, conn.id, { tables: names, loadingTables: false }),
          );
        } catch (e) {
          toast("err", errMessage(e));
          setSessions((ss) => patchSession(ss, conn.id, { loadingTables: false }));
        }
      } catch (e) {
        toast("err", errMessage(e));
        throw e;
      }
    },
    [sessions, toast],
  );

  const disconnect = useCallback(async (id?: string) => {
    const target = id ?? activeId;
    if (!target) return;
    try {
      await api.disconnect(target);
    } catch {
      /* ignore */
    }
    setSessions((ss) => {
      const next = ss.filter((s) => s.connection.id !== target);
      setActiveId((curr) => {
        if (curr !== target) return curr;
        return next[next.length - 1]?.connection.id ?? null;
      });
      return next;
    });
  }, [activeId]);

  const value = useMemo<AppCtx>(
    () => ({
      connections,
      sessions,
      activeId,
      active,
      tables,
      selectedTable,
      tableInfo,
      loadingTables,
      loadingTable,
      toasts,
      refreshConnections,
      connectTo,
      focusSession,
      disconnect,
      refreshTables,
      selectTable,
      setTableInfo,
      toast,
      dismissToast,
    }),
    [
      connections,
      sessions,
      activeId,
      active,
      tables,
      selectedTable,
      tableInfo,
      loadingTables,
      loadingTable,
      toasts,
      refreshConnections,
      connectTo,
      focusSession,
      disconnect,
      refreshTables,
      selectTable,
      setTableInfo,
      toast,
      dismissToast,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
