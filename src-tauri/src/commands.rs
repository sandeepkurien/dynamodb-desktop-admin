use crate::connections::{
    build_client, list_aws_profiles as discover_profiles, redact, verify_client, ConnectionAuth,
    ConnectionDraft, SavedConnection,
};
use crate::dynamo::{
    self, BackupInfo, BatchMutateResult, CreateIndexSpec, CreateTableRequest, PageResult,
    QueryRequest, ScanRequest, SoftDeleteSpec, TableInfo, UpdateTableSettings,
};
use crate::error::{AppError, Result};
use crate::state::AppState;
use serde_json::Value;
use tauri::State;
use uuid::Uuid;

#[tauri::command]
pub fn list_aws_profiles() -> Vec<String> {
    discover_profiles()
}

#[tauri::command]
pub fn connections_file_path() -> String {
    crate::connections::connections_path().display().to_string()
}

#[tauri::command]
pub fn list_saved_connections(state: State<'_, AppState>) -> Result<Vec<SavedConnection>> {
    let list = state
        .connections
        .lock()
        .map_err(|_| AppError::msg("State lock poisoned"))?;
    Ok(list.iter().map(redact).collect())
}

#[tauri::command]
pub fn upsert_connection(
    state: State<'_, AppState>,
    draft: ConnectionDraft,
) -> Result<SavedConnection> {
    if draft.name.trim().is_empty() {
        return Err(AppError::msg("Connection name is required"));
    }
    if draft.region.trim().is_empty() {
        return Err(AppError::msg("Region is required"));
    }

    let mut list = state
        .connections
        .lock()
        .map_err(|_| AppError::msg("State lock poisoned"))?;

    let id = draft
        .id
        .clone()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| Uuid::new_v4().to_string());

    let auth = match draft.auth {
        ConnectionAuth::AccessKey {
            access_key_id,
            secret_access_key,
            session_token,
        } => {
            let keep_secret = secret_access_key.is_empty() || secret_access_key.contains('•');
            let secret = if keep_secret {
                list.iter()
                    .find(|c| c.id == id)
                    .and_then(|c| match &c.auth {
                        ConnectionAuth::AccessKey {
                            secret_access_key, ..
                        } => Some(secret_access_key.clone()),
                        _ => None,
                    })
                    .unwrap_or_default()
            } else {
                secret_access_key
            };
            ConnectionAuth::AccessKey {
                access_key_id,
                secret_access_key: secret,
                session_token,
            }
        }
        other => other,
    };

    let saved = SavedConnection {
        id: id.clone(),
        name: draft.name.trim().to_string(),
        region: draft.region.trim().to_string(),
        auth,
    };

    if let Some(existing) = list.iter_mut().find(|c| c.id == id) {
        *existing = saved.clone();
    } else {
        list.push(saved.clone());
    }
    drop(list);
    state.persist()?;
    Ok(redact(&saved))
}

#[tauri::command]
pub fn delete_saved_connection(state: State<'_, AppState>, connection_id: String) -> Result<()> {
    {
        let mut list = state
            .connections
            .lock()
            .map_err(|_| AppError::msg("State lock poisoned"))?;
        list.retain(|c| c.id != connection_id);
    }
    if let Ok(mut clients) = state.clients.lock() {
        clients.remove(&connection_id);
    }
    state.persist()
}

fn find_connection(state: &AppState, id: &str) -> Result<SavedConnection> {
    let list = state
        .connections
        .lock()
        .map_err(|_| AppError::msg("State lock poisoned"))?;
    list.iter()
        .find(|c| c.id == id)
        .cloned()
        .ok_or(AppError::ConnectionNotFound)
}

#[tauri::command]
pub async fn test_connection(state: State<'_, AppState>, connection_id: String) -> Result<usize> {
    let conn = find_connection(&state, &connection_id)?;
    let client = build_client(&conn).await?;
    verify_client(&client).await
}

#[tauri::command]
pub async fn test_draft(draft: ConnectionDraft) -> Result<usize> {
    let conn = SavedConnection {
        id: "draft".into(),
        name: draft.name,
        region: draft.region,
        auth: draft.auth,
    };
    let client = build_client(&conn).await?;
    verify_client(&client).await
}

#[tauri::command]
pub async fn connect(
    state: State<'_, AppState>,
    connection_id: String,
) -> Result<SavedConnection> {
    let conn = find_connection(&state, &connection_id)?;
    let client = build_client(&conn).await?;
    verify_client(&client).await?;
    let mut clients = state
        .clients
        .lock()
        .map_err(|_| AppError::msg("State lock poisoned"))?;
    clients.insert(connection_id, client);
    Ok(redact(&conn))
}

#[tauri::command]
pub fn disconnect(state: State<'_, AppState>, connection_id: String) -> Result<()> {
    let mut clients = state
        .clients
        .lock()
        .map_err(|_| AppError::msg("State lock poisoned"))?;
    clients.remove(&connection_id);
    Ok(())
}

#[tauri::command]
pub async fn list_tables(state: State<'_, AppState>, connection_id: String) -> Result<Vec<String>> {
    let client = state.client(&connection_id)?;
    dynamo::list_tables(&client).await
}

#[tauri::command]
pub async fn describe_table(
    state: State<'_, AppState>,
    connection_id: String,
    table_name: String,
) -> Result<TableInfo> {
    let client = state.client(&connection_id)?;
    dynamo::describe_table(&client, &table_name).await
}

#[tauri::command]
pub async fn create_table(
    state: State<'_, AppState>,
    connection_id: String,
    request: CreateTableRequest,
) -> Result<TableInfo> {
    let client = state.client(&connection_id)?;
    dynamo::create_table(&client, request).await
}

#[tauri::command]
pub async fn delete_table(
    state: State<'_, AppState>,
    connection_id: String,
    table_name: String,
) -> Result<()> {
    let client = state.client(&connection_id)?;
    dynamo::delete_table(&client, &table_name).await
}

#[tauri::command]
pub async fn update_table_settings(
    state: State<'_, AppState>,
    connection_id: String,
    table_name: String,
    settings: UpdateTableSettings,
) -> Result<TableInfo> {
    let client = state.client(&connection_id)?;
    dynamo::update_table_settings(&client, &table_name, settings).await
}

#[tauri::command]
pub async fn update_ttl(
    state: State<'_, AppState>,
    connection_id: String,
    table_name: String,
    enabled: bool,
    attribute_name: String,
) -> Result<TableInfo> {
    let client = state.client(&connection_id)?;
    dynamo::update_ttl(&client, &table_name, enabled, attribute_name).await
}

#[tauri::command]
pub async fn add_gsi(
    state: State<'_, AppState>,
    connection_id: String,
    table_name: String,
    spec: CreateIndexSpec,
    extra_attrs: Vec<dynamo::KeyAttr>,
) -> Result<TableInfo> {
    let client = state.client(&connection_id)?;
    let info = dynamo::describe_table(&client, &table_name).await?;
    let provisioned = info
        .billing_mode
        .as_deref()
        .is_some_and(|m| m.eq_ignore_ascii_case("PROVISIONED"));
    dynamo::add_gsi(&client, &table_name, spec, provisioned, extra_attrs).await
}

#[tauri::command]
pub async fn delete_gsi(
    state: State<'_, AppState>,
    connection_id: String,
    table_name: String,
    index_name: String,
) -> Result<TableInfo> {
    let client = state.client(&connection_id)?;
    dynamo::delete_gsi(&client, &table_name, &index_name).await
}

#[tauri::command]
pub async fn scan_items(
    state: State<'_, AppState>,
    connection_id: String,
    request: ScanRequest,
) -> Result<PageResult> {
    let client = state.client(&connection_id)?;
    dynamo::scan_items(&client, request).await
}

#[tauri::command]
pub async fn query_items(
    state: State<'_, AppState>,
    connection_id: String,
    request: QueryRequest,
) -> Result<PageResult> {
    let client = state.client(&connection_id)?;
    dynamo::query_items(&client, request).await
}

#[tauri::command]
pub async fn get_item(
    state: State<'_, AppState>,
    connection_id: String,
    table_name: String,
    key: Value,
    consistent: bool,
) -> Result<Option<Value>> {
    let client = state.client(&connection_id)?;
    dynamo::get_item(&client, &table_name, key, consistent).await
}

#[tauri::command]
pub async fn put_item(
    state: State<'_, AppState>,
    connection_id: String,
    table_name: String,
    item: Value,
    format: String,
) -> Result<()> {
    let client = state.client(&connection_id)?;
    dynamo::put_item(&client, &table_name, item, &format).await
}

#[tauri::command]
pub async fn delete_item(
    state: State<'_, AppState>,
    connection_id: String,
    table_name: String,
    key: Value,
) -> Result<()> {
    let client = state.client(&connection_id)?;
    dynamo::delete_item(&client, &table_name, key).await
}

#[tauri::command]
pub async fn batch_put_items(
    state: State<'_, AppState>,
    connection_id: String,
    table_name: String,
    items: Vec<Value>,
    format: String,
) -> Result<usize> {
    let client = state.client(&connection_id)?;
    dynamo::batch_put_items(&client, &table_name, items, &format).await
}

#[tauri::command]
pub async fn batch_delete_items(
    state: State<'_, AppState>,
    connection_id: String,
    table_name: String,
    keys: Vec<Value>,
) -> Result<BatchMutateResult> {
    let client = state.client(&connection_id)?;
    dynamo::batch_delete_items(&client, &table_name, keys).await
}

#[tauri::command]
pub async fn soft_delete_items(
    state: State<'_, AppState>,
    connection_id: String,
    table_name: String,
    items: Vec<Value>,
    spec: SoftDeleteSpec,
) -> Result<BatchMutateResult> {
    let client = state.client(&connection_id)?;
    dynamo::soft_delete_items(&client, &table_name, items, spec).await
}

#[tauri::command]
pub async fn execute_partiql(
    state: State<'_, AppState>,
    connection_id: String,
    statement: String,
    next_token: Option<String>,
    limit: Option<i32>,
) -> Result<PageResult> {
    let client = state.client(&connection_id)?;
    dynamo::execute_partiql(&client, &statement, next_token, limit).await
}

#[tauri::command]
pub async fn list_backups(
    state: State<'_, AppState>,
    connection_id: String,
    table_name: String,
) -> Result<Vec<BackupInfo>> {
    let client = state.client(&connection_id)?;
    dynamo::list_backups(&client, &table_name).await
}

#[tauri::command]
pub async fn create_backup(
    state: State<'_, AppState>,
    connection_id: String,
    table_name: String,
    backup_name: String,
) -> Result<BackupInfo> {
    let client = state.client(&connection_id)?;
    dynamo::create_backup(&client, &table_name, &backup_name).await
}

#[tauri::command]
pub async fn delete_backup(
    state: State<'_, AppState>,
    connection_id: String,
    backup_arn: String,
) -> Result<()> {
    let client = state.client(&connection_id)?;
    dynamo::delete_backup(&client, &backup_arn).await
}

#[tauri::command]
pub async fn restore_backup(
    state: State<'_, AppState>,
    connection_id: String,
    backup_arn: String,
    target_table_name: String,
) -> Result<TableInfo> {
    let client = state.client(&connection_id)?;
    dynamo::restore_backup(&client, &backup_arn, &target_table_name).await
}

#[tauri::command]
pub fn local_runtime_status() -> crate::local::RuntimeStatus {
    crate::local::runtime_status()
}

#[tauri::command]
pub async fn ensure_local_runtime() -> Result<crate::local::RuntimeStatus> {
    crate::local::ensure_runtime().await
}

#[tauri::command]
pub fn list_local_dbs(state: State<'_, AppState>) -> Result<Vec<crate::local::LocalDbInfo>> {
    crate::local::list_dbs(&state)
}

#[tauri::command]
pub fn create_local_db(
    state: State<'_, AppState>,
    name: String,
    mode: String,
    port: Option<u16>,
) -> Result<crate::local::LocalDbInfo> {
    crate::local::create_db(&state, name, mode, port)
}

#[tauri::command]
pub fn rename_local_db(
    state: State<'_, AppState>,
    id: String,
    name: String,
) -> Result<crate::local::LocalDbInfo> {
    crate::local::rename_db(&state, &id, name)
}

#[tauri::command]
pub fn duplicate_local_db(
    state: State<'_, AppState>,
    id: String,
    name: String,
) -> Result<crate::local::LocalDbInfo> {
    crate::local::duplicate_db(&state, &id, name)
}

#[tauri::command]
pub fn delete_local_db(state: State<'_, AppState>, id: String) -> Result<()> {
    crate::local::delete_db(&state, &id)
}

#[tauri::command]
pub async fn start_local_db(
    state: State<'_, AppState>,
    id: String,
) -> Result<crate::local::LocalDbInfo> {
    crate::local::ensure_runtime().await?;
    crate::local::start_db(&state, &id).await
}

#[tauri::command]
pub fn stop_local_db(
    state: State<'_, AppState>,
    id: String,
) -> Result<crate::local::LocalDbInfo> {
    crate::local::stop_db(&state, &id)
}

#[tauri::command]
pub async fn open_local_db(
    state: State<'_, AppState>,
    id: String,
) -> Result<SavedConnection> {
    crate::local::open_db(&state, &id).await
}
