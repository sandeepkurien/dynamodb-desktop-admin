use crate::error::{sdk_err, AppError, Result};
use aws_config::BehaviorVersion;
use aws_credential_types::Credentials;
use aws_sdk_dynamodb::Client;
use aws_types::region::Region;
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ConnectionAuth {
    Profile {
        profile: String,
    },
    AccessKey {
        access_key_id: String,
        secret_access_key: String,
        #[serde(default)]
        session_token: Option<String>,
    },
    Local {
        #[serde(default = "default_local_endpoint")]
        endpoint: String,
    },
}

fn default_local_endpoint() -> String {
    "http://localhost:8000".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedConnection {
    pub id: String,
    pub name: String,
    pub region: String,
    pub auth: ConnectionAuth,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionDraft {
    pub id: Option<String>,
    pub name: String,
    pub region: String,
    pub auth: ConnectionAuth,
}

pub fn connections_dir() -> PathBuf {
    let mut dir = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."));
    dir.push("dynamodb-admin");
    let _ = fs::create_dir_all(&dir);
    dir
}

pub fn connections_path() -> PathBuf {
    let mut dir = connections_dir();
    dir.push("connections.json");
    dir
}

pub fn load_connections() -> Vec<SavedConnection> {
    let path = connections_path();
    fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save_connections(list: &[SavedConnection]) -> Result<()> {
    let path = connections_path();
    let json = serde_json::to_string_pretty(list).map_err(|e| AppError::msg(e.to_string()))?;
    fs::write(path, json).map_err(|e| AppError::msg(format!("Failed to save connections: {e}")))
}

pub fn redact(conn: &SavedConnection) -> SavedConnection {
    let mut clone = conn.clone();
    if let ConnectionAuth::AccessKey {
        secret_access_key, ..
    } = &mut clone.auth
    {
        if !secret_access_key.is_empty() {
            *secret_access_key = "••••••••".into();
        }
    }
    clone
}

pub fn list_aws_profiles() -> Vec<String> {
    let mut profiles = BTreeSet::new();
    if let Some(home) = dirs::home_dir() {
        parse_ini_sections(home.join(".aws/credentials"), &mut profiles, false);
        parse_ini_sections(home.join(".aws/config"), &mut profiles, true);
    }
    if profiles.is_empty() {
        profiles.insert("default".into());
    }
    profiles.into_iter().collect()
}

fn parse_ini_sections(path: PathBuf, out: &mut BTreeSet<String>, config_file: bool) {
    let Ok(text) = fs::read_to_string(path) else {
        return;
    };
    for line in text.lines() {
        let line = line.trim();
        if let Some(inner) = line.strip_prefix('[').and_then(|s| s.strip_suffix(']')) {
            let name = if config_file {
                if inner == "default" || inner == "sso-session" {
                    inner.to_string()
                } else {
                    inner
                        .strip_prefix("profile ")
                        .unwrap_or(inner)
                        .trim()
                        .to_string()
                }
            } else {
                inner.to_string()
            };
            if !name.is_empty() && !name.starts_with("sso-session") {
                out.insert(name);
            }
        }
    }
}

pub async fn build_client(conn: &SavedConnection) -> Result<Client> {
    let region = Region::new(conn.region.clone());
    let loader = aws_config::defaults(BehaviorVersion::latest()).region(region);

    let sdk_config = match &conn.auth {
        ConnectionAuth::Profile { profile } => loader.profile_name(profile).load().await,
        ConnectionAuth::AccessKey {
            access_key_id,
            secret_access_key,
            session_token,
        } => {
            if access_key_id.is_empty() || secret_access_key.is_empty() {
                return Err(AppError::msg("Access key and secret key are required"));
            }
            let creds = Credentials::new(
                access_key_id,
                secret_access_key,
                session_token.clone().filter(|s| !s.is_empty()),
                None,
                "dynamodb-admin",
            );
            loader.credentials_provider(creds).load().await
        }
        ConnectionAuth::Local { endpoint } => {
            let endpoint = if endpoint.trim().is_empty() {
                default_local_endpoint()
            } else {
                endpoint.trim().to_string()
            };
            loader.endpoint_url(endpoint).test_credentials().load().await
        }
    };

    Ok(Client::new(&sdk_config))
}

pub async fn verify_client(client: &Client) -> Result<usize> {
    let resp = client
        .list_tables()
        .limit(100)
        .send()
        .await
        .map_err(|e| {
            let raw = e.to_string();
            if raw.contains("Connection refused")
                || raw.contains("ConnectError")
                || raw.contains("tcp connect error")
            {
                AppError::msg(format!(
                    "Could not reach DynamoDB ({raw}). For Local, start DynamoDB Local (default http://localhost:8000). For AWS, check VPN, region, and credentials."
                ))
            } else {
                sdk_err(e)
            }
        })?;
    Ok(resp.table_names().len())
}
