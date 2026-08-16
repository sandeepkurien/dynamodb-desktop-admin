# DynamoDweep

**A modern DynamoDB admin GUI and desktop client.**

DynamoDweep makes it easier to browse tables, query and edit items, manage indexes and table settings, and work with Amazon DynamoDB or DynamoDB Local from one desktop application.

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

A product by [Technodweep](https://technodweep.com).

Built with Rust, Tauri 2, React, and TypeScript.

## Features

### Connect your way

- Use AWS named profiles from `~/.aws/config` and `~/.aws/credentials`.
- Connect with an access key, secret key, and optional session token.
- Connect to DynamoDB Local or LocalStack through a custom endpoint.
- Open multiple connections in tabs.
- Save connections on your machine for quick access.
- Create and manage named DynamoDB Local instances directly in the app.

### Manage tables

- List, filter, create, and delete tables.
- Inspect keys, attribute definitions, global secondary indexes, and local secondary indexes.
- Add or remove GSIs.
- Configure on-demand or provisioned capacity.
- Manage streams, TTL, and deletion protection.

### Explore and edit data

- Scan tables with filters and pagination.
- Query tables, GSIs, and LSIs with sort-key operators.
- Retrieve an item by its primary key.
- Run PartiQL statements.
- Create, edit, and delete items using document JSON or DynamoDB JSON.
- Select and bulk-delete items with confirmation.
- Soft-delete items by renaming their partition key, sort key, or both.
- Import and export JSON.

### Work with backups

- Create, list, delete, and restore on-demand backups.
- Backup operations are available for AWS-hosted tables and are not supported by DynamoDB Local.

## Development

### Prerequisites

- [Node.js 20 or later](https://nodejs.org/)
- [Rust stable](https://www.rust-lang.org/tools/install)
- The [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your operating system

### Run locally

```bash
git clone git@github.com:sandeepkurien/dynamodb-desktop-admin.git
cd dynamodb-desktop-admin
npm install
npm run tauri dev
```

### Create a production build

```bash
npm run tauri build
```

Tauri writes the platform-specific installers and application bundles under `src-tauri/target/release/bundle/`.

## Connecting to DynamoDB Local

Start DynamoDB Local on port `8000`, then create a **Local** connection with:

- Endpoint: `http://localhost:8000`
- Region: `us-east-1` (or any region name)

DynamoDweep supplies dummy credentials automatically for local connections.

Alternatively, use the built-in local-instance manager. It creates a separate data directory for each named instance and downloads the official DynamoDB Local engine the first time it is needed. The engine is not bundled with DynamoDweep.

## Security

Saved connections are stored in `connections.json` in the operating system's application-data directory. Access keys stored there are not currently encrypted, so treat the file as sensitive.

- macOS: `~/Library/Application Support/dynamodb-admin/connections.json`
- Linux: `~/.local/share/dynamodb-admin/connections.json`
- Windows: `%APPDATA%\dynamodb-admin\connections.json`

Prefer short-lived credentials or AWS named profiles whenever possible. The connection screen displays the exact storage path and can reveal the file in Finder or Explorer.

## DynamoDB notes

- Table item counts and sizes come from DynamoDB's periodic `DescribeTable` statistics and are not live counts.
- Strongly consistent reads are supported for base tables and LSIs, but not for GSIs.

## License

Copyright 2026 [Technodweep](https://technodweep.com).

Licensed under the [Apache License 2.0](LICENSE).

## Trademark notice

Amazon Web Services, AWS, and Amazon DynamoDB are trademarks of Amazon.com, Inc. or its affiliates. DynamoDweep is an independent project and is not affiliated with or endorsed by Amazon Web Services.
