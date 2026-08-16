import { invoke } from "@tauri-apps/api/core";
import type {
  BackupInfo,
  BatchMutateResult,
  ConnectionDraft,
  CreateIndexSpec,
  CreateTableRequest,
  KeyAttr,
  PageResult,
  QueryRequest,
  SavedConnection,
  ScanRequest,
  SoftDeleteSpec,
  TableInfo,
  UpdateTableSettings,
} from "./types";

export const api = {
  listAwsProfiles: () => invoke<string[]>("list_aws_profiles"),
  connectionsFilePath: () => invoke<string>("connections_file_path"),
  listConnections: () => invoke<SavedConnection[]>("list_saved_connections"),
  upsertConnection: (draft: ConnectionDraft) =>
    invoke<SavedConnection>("upsert_connection", { draft }),
  deleteConnection: (connectionId: string) =>
    invoke<void>("delete_saved_connection", { connectionId }),
  testConnection: (connectionId: string) =>
    invoke<number>("test_connection", { connectionId }),
  testDraft: (draft: ConnectionDraft) => invoke<number>("test_draft", { draft }),
  connect: (connectionId: string) =>
    invoke<SavedConnection>("connect", { connectionId }),
  disconnect: (connectionId: string) =>
    invoke<void>("disconnect", { connectionId }),

  listTables: (connectionId: string) =>
    invoke<string[]>("list_tables", { connectionId }),
  describeTable: (connectionId: string, tableName: string) =>
    invoke<TableInfo>("describe_table", { connectionId, tableName }),
  createTable: (connectionId: string, request: CreateTableRequest) =>
    invoke<TableInfo>("create_table", { connectionId, request }),
  deleteTable: (connectionId: string, tableName: string) =>
    invoke<void>("delete_table", { connectionId, tableName }),
  updateTableSettings: (
    connectionId: string,
    tableName: string,
    settings: UpdateTableSettings,
  ) =>
    invoke<TableInfo>("update_table_settings", {
      connectionId,
      tableName,
      settings,
    }),
  updateTtl: (
    connectionId: string,
    tableName: string,
    enabled: boolean,
    attributeName: string,
  ) =>
    invoke<TableInfo>("update_ttl", {
      connectionId,
      tableName,
      enabled,
      attributeName,
    }),
  addGsi: (
    connectionId: string,
    tableName: string,
    spec: CreateIndexSpec,
    extraAttrs: KeyAttr[],
  ) =>
    invoke<TableInfo>("add_gsi", {
      connectionId,
      tableName,
      spec,
      extraAttrs,
    }),
  deleteGsi: (connectionId: string, tableName: string, indexName: string) =>
    invoke<TableInfo>("delete_gsi", { connectionId, tableName, indexName }),

  scanItems: (connectionId: string, request: ScanRequest) =>
    invoke<PageResult>("scan_items", { connectionId, request }),
  queryItems: (connectionId: string, request: QueryRequest) =>
    invoke<PageResult>("query_items", { connectionId, request }),
  getItem: (
    connectionId: string,
    tableName: string,
    key: Record<string, unknown>,
    consistent: boolean,
  ) =>
    invoke<Record<string, unknown> | null>("get_item", {
      connectionId,
      tableName,
      key,
      consistent,
    }),
  putItem: (
    connectionId: string,
    tableName: string,
    item: unknown,
    format: "document" | "ddb",
  ) => invoke<void>("put_item", { connectionId, tableName, item, format }),
  deleteItem: (
    connectionId: string,
    tableName: string,
    key: Record<string, unknown>,
  ) => invoke<void>("delete_item", { connectionId, tableName, key }),
  batchPutItems: (
    connectionId: string,
    tableName: string,
    items: unknown[],
    format: "document" | "ddb",
  ) =>
    invoke<number>("batch_put_items", {
      connectionId,
      tableName,
      items,
      format,
    }),
  batchDeleteItems: (
    connectionId: string,
    tableName: string,
    keys: Record<string, unknown>[],
  ) =>
    invoke<BatchMutateResult>("batch_delete_items", {
      connectionId,
      tableName,
      keys,
    }),
  softDeleteItems: (
    connectionId: string,
    tableName: string,
    items: Record<string, unknown>[],
    spec: SoftDeleteSpec,
  ) =>
    invoke<BatchMutateResult>("soft_delete_items", {
      connectionId,
      tableName,
      items,
      spec,
    }),
  executePartiql: (
    connectionId: string,
    statement: string,
    nextToken?: string | null,
    limit?: number | null,
  ) =>
    invoke<PageResult>("execute_partiql", {
      connectionId,
      statement,
      nextToken,
      limit,
    }),

  listBackups: (connectionId: string, tableName: string) =>
    invoke<BackupInfo[]>("list_backups", { connectionId, tableName }),
  createBackup: (connectionId: string, tableName: string, backupName: string) =>
    invoke<BackupInfo>("create_backup", {
      connectionId,
      tableName,
      backupName,
    }),
  deleteBackup: (connectionId: string, backupArn: string) =>
    invoke<void>("delete_backup", { connectionId, backupArn }),
  restoreBackup: (
    connectionId: string,
    backupArn: string,
    targetTableName: string,
  ) =>
    invoke<TableInfo>("restore_backup", {
      connectionId,
      backupArn,
      targetTableName,
    }),
};

export function errMessage(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return String(e);
}
