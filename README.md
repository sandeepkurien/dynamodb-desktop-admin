# DynamoDB Admin

A desktop admin for Amazon DynamoDB, built with **Rust**, **Tauri 2**, and **React**.

Connect with an AWS named profile, access keys, or DynamoDB Local. Browse tables, scan and query (base table or any GSI/LSI), edit items, manage schema, TTL, streams, capacity, and on-demand backups.

## Features

- **Connections**
  - AWS named profiles from `~/.aws/config` and `~/.aws/credentials`
  - Access key + secret + optional session token
  - DynamoDB Local / LocalStack via endpoint (default `http://localhost:8000`)
  - Saved connections stored on this machine
  - Open several connections at once (tabs); add more with **+** without closing the others
- **Tables**
  - List, filter, create, and delete
  - Schema: keys, attribute definitions, GSIs, LSIs
  - Add / delete GSIs
  - Capacity (on-demand or provisioned)
  - Streams, TTL, deletion protection
- **Items**
  - Scan with filters and pagination
  - Query against the table or any GSI/LSI, with sort-key operators
  - Get item by primary key
  - PartiQL
  - Create / edit / delete items (document JSON or DynamoDB JSON)
  - Select items (shift-click) for individual or bulk delete, with a confirmation step
  - Soft-delete by prefixing/suffixing the partition and/or sort key (writes a renamed copy, then removes the original)
  - Import / export JSON
- **Backups**
  - Create, list, delete, and restore on-demand backups (not available on DynamoDB Local)

## Develop

Requirements: Rust (stable), Node 20+, and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS.

```bash
npm install
npm run tauri dev
```

Production build:

```bash
npm run tauri build
```

## Local DynamoDB

Start DynamoDB Local on port 8000, then create a **Local** connection:

- Endpoint: `http://localhost:8000`
- Region: any (default `us-east-1`)

Dummy credentials are sent automatically.

## Notes

- Saved connections (including access keys) live in `connections.json` under the OS app-data directory:
  - macOS: `~/Library/Application Support/dynamodb-admin/connections.json`
  - Linux: `~/.local/share/dynamodb-admin/connections.json`
  - Windows: `%APPDATA%\dynamodb-admin\connections.json`
  Treat that file as sensitive. The connection screen shows the exact path and can open it in Finder/Explorer.
- Table item counts and sizes come from DynamoDB’s periodic `DescribeTable` stats, not a live count.
- Strongly consistent reads apply to the base table and LSIs only — not GSIs.
