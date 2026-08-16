mod attr;
mod commands;
mod connections;
mod dynamo;
mod error;
mod local;
mod state;

use state::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::load())
        .invoke_handler(tauri::generate_handler![
            commands::list_aws_profiles,
            commands::connections_file_path,
            commands::list_saved_connections,
            commands::upsert_connection,
            commands::delete_saved_connection,
            commands::test_connection,
            commands::test_draft,
            commands::connect,
            commands::disconnect,
            commands::list_tables,
            commands::describe_table,
            commands::create_table,
            commands::delete_table,
            commands::update_table_settings,
            commands::update_ttl,
            commands::add_gsi,
            commands::delete_gsi,
            commands::scan_items,
            commands::query_items,
            commands::get_item,
            commands::put_item,
            commands::delete_item,
            commands::batch_put_items,
            commands::batch_delete_items,
            commands::soft_delete_items,
            commands::execute_partiql,
            commands::list_backups,
            commands::create_backup,
            commands::delete_backup,
            commands::restore_backup,
            commands::local_runtime_status,
            commands::ensure_local_runtime,
            commands::list_local_dbs,
            commands::create_local_db,
            commands::rename_local_db,
            commands::duplicate_local_db,
            commands::delete_local_db,
            commands::start_local_db,
            commands::stop_local_db,
            commands::open_local_db,
        ])
        .build(tauri::generate_context!())
        .expect("error while building DynamoDB Admin")
        .run(|app, event| {
            if matches!(
                event,
                tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. }
            ) {
                if let Some(state) = app.try_state::<AppState>() {
                    local::stop_all(&state);
                }
            }
        });
}
