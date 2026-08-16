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

interface AppCtx {
  connections: SavedConnection[];
  active: SavedConnection | null;
  tables: string[];
  selectedTable: string | null;
  tableInfo: TableInfo | null;
  loadingTables: boolean;
  loadingTable: boolean;
  toasts: Toast[];
  refreshConnections: () => Promise<void>;
  connectTo: (id: string) => Promise<void>;
  disconnect: () => Promise<void>;
  refreshTables: () => Promise<void>;
  selectTable: (name: string | null) => Promise<void>;
  setTableInfo: (info: TableInfo | null) => void;
  toast: (kind: ToastKind, message: string) => void;
  dismissToast: (id: number) => void;
}

const Ctx = createContext<AppCtx | null>(null);

let toastSeq = 1;

export function AppProvider({ children }: { children: ReactNode }) {
  const [connections, setConnections] = useState<SavedConnection[]>([]);
  const [active, setActive] = useState<SavedConnection | null>(null);
  const [tables, setTables] = useState<string[]>([]);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [tableInfo, setTableInfo] = useState<TableInfo | null>(null);
  const [loadingTables, setLoadingTables] = useState(false);
  const [loadingTable, setLoadingTable] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);

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

  const refreshTables = useCallback(async () => {
    if (!active) return;
    setLoadingTables(true);
    try {
      setTables(await api.listTables(active.id));
    } catch (e) {
      toast("err", errMessage(e));
    } finally {
      setLoadingTables(false);
    }
  }, [active, toast]);

  const selectTable = useCallback(
    async (name: string | null) => {
      setSelectedTable(name);
      setTableInfo(null);
      if (!name || !active) return;
      setLoadingTable(true);
      try {
        setTableInfo(await api.describeTable(active.id, name));
      } catch (e) {
        toast("err", errMessage(e));
      } finally {
        setLoadingTable(false);
      }
    },
    [active, toast],
  );

  const connectTo = useCallback(
    async (id: string) => {
      try {
        const conn = await api.connect(id);
        setActive(conn);
        setSelectedTable(null);
        setTableInfo(null);
        setLoadingTables(true);
        try {
          setTables(await api.listTables(conn.id));
        } finally {
          setLoadingTables(false);
        }
        toast("ok", `Connected to ${conn.name}`);
      } catch (e) {
        toast("err", errMessage(e));
        throw e;
      }
    },
    [toast],
  );

  const disconnect = useCallback(async () => {
    if (!active) return;
    try {
      await api.disconnect(active.id);
    } catch {
      /* ignore */
    }
    setActive(null);
    setTables([]);
    setSelectedTable(null);
    setTableInfo(null);
  }, [active]);

  const value = useMemo<AppCtx>(
    () => ({
      connections,
      active,
      tables,
      selectedTable,
      tableInfo,
      loadingTables,
      loadingTable,
      toasts,
      refreshConnections,
      connectTo,
      disconnect,
      refreshTables,
      selectTable,
      setTableInfo,
      toast,
      dismissToast,
    }),
    [
      connections,
      active,
      tables,
      selectedTable,
      tableInfo,
      loadingTables,
      loadingTable,
      toasts,
      refreshConnections,
      connectTo,
      disconnect,
      refreshTables,
      selectTable,
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
