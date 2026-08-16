export type ConnectionKind = "profile" | "access_key" | "local";

export type ConnectionAuth =
  | { kind: "profile"; profile: string }
  | {
      kind: "access_key";
      access_key_id: string;
      secret_access_key: string;
      session_token?: string | null;
    }
  | { kind: "local"; endpoint: string };

export interface SavedConnection {
  id: string;
  name: string;
  region: string;
  auth: ConnectionAuth;
}

export interface ConnectionDraft {
  id?: string | null;
  name: string;
  region: string;
  auth: ConnectionAuth;
}

export interface KeyAttr {
  name: string;
  type: string;
}

export interface IndexKey {
  name: string;
  key_type: string;
}

export interface IndexInfo {
  name: string;
  kind: "GSI" | "LSI" | string;
  status?: string | null;
  key_schema: IndexKey[];
  projection?: string | null;
  non_key_attributes: string[];
  item_count?: number | null;
  size_bytes?: number | null;
}

export interface TableInfo {
  name: string;
  status?: string | null;
  arn?: string | null;
  item_count?: number | null;
  table_size_bytes?: number | null;
  billing_mode?: string | null;
  table_class?: string | null;
  creation_date_time?: string | null;
  deletion_protection: boolean;
  attribute_definitions: KeyAttr[];
  key_schema: IndexKey[];
  gsis: IndexInfo[];
  lsis: IndexInfo[];
  stream_enabled: boolean;
  stream_view_type?: string | null;
  stream_arn?: string | null;
  read_capacity?: number | null;
  write_capacity?: number | null;
  ttl_enabled: boolean;
  ttl_attribute?: string | null;
}

export interface CreateIndexSpec {
  name: string;
  partition_key: KeyAttr;
  sort_key?: KeyAttr | null;
  projection: string;
  non_key_attributes?: string[] | null;
  read_capacity?: number | null;
  write_capacity?: number | null;
}

export interface CreateLsiSpec {
  name: string;
  sort_key: KeyAttr;
  projection: string;
  non_key_attributes?: string[] | null;
}

export interface CreateTableRequest {
  table_name: string;
  partition_key: KeyAttr;
  sort_key?: KeyAttr | null;
  billing_mode: string;
  read_capacity?: number | null;
  write_capacity?: number | null;
  gsis?: CreateIndexSpec[] | null;
  lsis?: CreateLsiSpec[] | null;
  stream_enabled?: boolean | null;
  stream_view_type?: string | null;
  deletion_protection?: boolean | null;
}

export interface UpdateTableSettings {
  billing_mode?: string | null;
  read_capacity?: number | null;
  write_capacity?: number | null;
  deletion_protection?: boolean | null;
  stream_enabled?: boolean | null;
  stream_view_type?: string | null;
}

export interface Condition {
  attribute: string;
  operator: string;
  value?: unknown;
  value_to?: unknown;
  values?: unknown[];
  value_type?: string | null;
}

export interface QueryRequest {
  table_name: string;
  index_name?: string | null;
  partition_key: Condition;
  sort_key?: Condition | null;
  filters?: Condition[] | null;
  limit?: number | null;
  exclusive_start_key?: unknown;
  scan_index_forward?: boolean | null;
  consistent_read?: boolean | null;
  projection?: string | null;
}

export interface ScanRequest {
  table_name: string;
  index_name?: string | null;
  filters?: Condition[] | null;
  limit?: number | null;
  exclusive_start_key?: unknown;
  consistent_read?: boolean | null;
  projection?: string | null;
  segment?: number | null;
  total_segments?: number | null;
}

export interface PageResult {
  items: Record<string, unknown>[];
  items_ddb: Record<string, unknown>[];
  count: number;
  scanned_count: number;
  last_evaluated_key?: unknown;
  consumed_capacity?: number | null;
}

export interface BackupInfo {
  arn?: string | null;
  name?: string | null;
  status?: string | null;
  created_at?: string | null;
  size_bytes?: number | null;
  table_name?: string | null;
  backup_type?: string | null;
}

export const REGIONS = [
  "us-east-1",
  "us-east-2",
  "us-west-1",
  "us-west-2",
  "ca-central-1",
  "eu-west-1",
  "eu-west-2",
  "eu-west-3",
  "eu-central-1",
  "eu-north-1",
  "eu-south-1",
  "ap-south-1",
  "ap-southeast-1",
  "ap-southeast-2",
  "ap-northeast-1",
  "ap-northeast-2",
  "ap-northeast-3",
  "ap-east-1",
  "sa-east-1",
  "af-south-1",
  "me-south-1",
  "me-central-1",
  "us-gov-west-1",
  "us-gov-east-1",
];

export const ATTR_TYPES = ["S", "N", "B"] as const;
export const VALUE_TYPES = ["S", "N", "BOOL", "NULL"] as const;

export const SK_OPERATORS = [
  { value: "eq", label: "=" },
  { value: "lt", label: "<" },
  { value: "lte", label: "≤" },
  { value: "gt", label: ">" },
  { value: "gte", label: "≥" },
  { value: "begins_with", label: "begins_with" },
  { value: "between", label: "between" },
];

export interface BatchMutateResult {
  succeeded: number;
  skipped: number;
  errors: string[];
}

export interface SoftDeleteSpec {
  rename_partition: boolean;
  rename_sort: boolean;
  strategy: "prefix" | "suffix" | string;
  token: string;
  stamp_deleted_at: boolean;
  deleted_at?: string | null;
}

export const SOFT_DELETE_TOKEN = "DELETED#";

export const FILTER_OPERATORS = [
  ...SK_OPERATORS,
  { value: "ne", label: "≠" },
  { value: "contains", label: "contains" },
  { value: "exists", label: "exists" },
  { value: "not_exists", label: "not exists" },
  { value: "in", label: "in" },
];
