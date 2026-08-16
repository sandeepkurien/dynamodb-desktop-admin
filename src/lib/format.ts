import type { IndexInfo, IndexKey, TableInfo } from "../types";

export function formatBytes(n?: number | null): string {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function formatCount(n?: number | null): string {
  if (n == null) return "—";
  return n.toLocaleString();
}

export function hashKey(schema: IndexKey[]): string | undefined {
  return schema.find((k) => k.key_type === "HASH")?.name;
}

export function rangeKey(schema: IndexKey[]): string | undefined {
  return schema.find((k) => k.key_type === "RANGE")?.name;
}

export function tableHash(info: TableInfo): string | undefined {
  return hashKey(info.key_schema);
}

export function tableRange(info: TableInfo): string | undefined {
  return rangeKey(info.key_schema);
}

export function attrType(info: TableInfo, name: string): string {
  return info.attribute_definitions.find((a) => a.name === name)?.type ?? "S";
}

export function selectableIndexes(info: TableInfo): Array<{
  id: string;
  label: string;
  kind: string;
  schema: IndexKey[];
  status?: string | null;
}> {
  const tablePk = tableHash(info) ?? "pk";
  const tableSk = tableRange(info);
  return [
    {
      id: "",
      label: `Table · ${info.name}`,
      kind: "TABLE",
      schema: info.key_schema,
    },
    ...info.gsis.map((g) => ({
      id: g.name,
      label: `GSI · ${g.name}`,
      kind: "GSI",
      schema: g.key_schema,
      status: g.status,
    })),
    ...info.lsis.map((l) => ({
      id: l.name,
      label: `LSI · ${l.name}`,
      kind: "LSI",
      schema: l.key_schema,
    })),
  ].map((x) => {
    const pk = hashKey(x.schema) ?? tablePk;
    const sk = rangeKey(x.schema) ?? (x.kind === "TABLE" ? tableSk : undefined);
    return {
      ...x,
      label: `${x.label}  (${[pk, sk].filter(Boolean).join(", ")})`,
    };
  });
}

export function previewValue(value: unknown): string {
  if (value == null) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    const s = JSON.stringify(value);
    return s.length > 80 ? s.slice(0, 77) + "…" : s;
  } catch {
    return String(value);
  }
}

export function itemKey(
  item: Record<string, unknown>,
  info: TableInfo,
): Record<string, unknown> {
  const key: Record<string, unknown> = {};
  for (const k of info.key_schema) {
    if (k.name in item) key[k.name] = item[k.name];
  }
  return key;
}

export function itemKeyId(item: Record<string, unknown>, info: TableInfo): string {
  return JSON.stringify(itemKey(item, info));
}

export function formatItemKey(item: Record<string, unknown>, info: TableInfo): string {
  return info.key_schema
    .map((k) => `${k.name}=${previewValue(item[k.name])}`)
    .join("  ·  ");
}

export function applySoftDeleteToken(
  value: unknown,
  strategy: "prefix" | "suffix",
  token: string,
): string {
  const s = value == null ? "" : String(value);
  if (s.startsWith(token) || s.endsWith(token)) return s;
  return strategy === "suffix" ? `${s}${token}` : `${token}${s}`;
}

export function isAlreadySoftDeleted(
  item: Record<string, unknown>,
  info: TableInfo,
  token: string,
): boolean {
  return info.key_schema.some((k) => {
    const s = item[k.name] == null ? "" : String(item[k.name]);
    return token.length > 0 && (s.startsWith(token) || s.endsWith(token));
  });
}

export function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function indexKeys(index: IndexInfo | undefined, table: TableInfo): IndexKey[] {
  return index?.key_schema ?? table.key_schema;
}

export function connectionKindLabel(kind: string): string {
  if (kind === "profile") return "AWS profile";
  if (kind === "access_key") return "Access keys";
  return "Local";
}
