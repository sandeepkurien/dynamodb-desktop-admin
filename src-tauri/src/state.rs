use crate::connections::{load_connections, save_connections, SavedConnection};
use aws_sdk_dynamodb::Client;
use std::collections::HashMap;
use std::sync::Mutex;

pub struct AppState {
    pub connections: Mutex<Vec<SavedConnection>>,
    pub clients: Mutex<HashMap<String, Client>>,
}

impl AppState {
    pub fn load() -> Self {
        Self {
            connections: Mutex::new(load_connections()),
            clients: Mutex::new(HashMap::new()),
        }
    }

    pub fn persist(&self) -> crate::error::Result<()> {
        let guard = self
            .connections
            .lock()
            .map_err(|_| crate::error::AppError::msg("State lock poisoned"))?;
        save_connections(&guard)
    }

    pub fn client(&self, connection_id: &str) -> crate::error::Result<Client> {
        let clients = self
            .clients
            .lock()
            .map_err(|_| crate::error::AppError::msg("State lock poisoned"))?;
        clients
            .get(connection_id)
            .cloned()
            .ok_or(crate::error::AppError::NotConnected)
    }
}
