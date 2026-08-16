use crate::connections::{build_client, connections_dir, redact, verify_client, ConnectionAuth, SavedConnection};
use crate::error::{AppError, Result};
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::Duration;
use uuid::Uuid;

const DOWNLOAD_URL: &str = "https://d1ni2b6xgvw0s0.cloudfront.net/v2.x/dynamodb_local_latest.tar.gz";
const DEFAULT_PORT: u16 = 8000;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalDbMeta {
    pub id: String,
    pub name: String,
    pub slug: String,
    pub port: u16,
    pub mode: String,
    pub created_at: String,
    pub last_opened_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalDbInfo {
    #[serde(flatten)]
    pub meta: LocalDbMeta,
    pub running: bool,
    pub pid: Option<u32>,
    pub endpoint: String,
    pub data_path: String,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeStatus {
    pub java_path: Option<String>,
    pub java_version: Option<String>,
    pub runtime_ready: bool,
    pub runtime_path: String,
    pub download_url: String,
}

pub struct ManagedProc {
    pub pid: u32,
    pub child: Option<Child>,
}

pub fn app_root() -> PathBuf {
    connections_dir()
}

pub fn runtime_dir() -> PathBuf {
    let p = app_root().join("runtime").join("dynamodb-local");
    let _ = fs::create_dir_all(&p);
    p
}

pub fn dbs_dir() -> PathBuf {
    let p = app_root().join("local-dbs");
    let _ = fs::create_dir_all(&p);
    p
}

pub fn runtime_status() -> RuntimeStatus {
    let java = find_java();
    RuntimeStatus {
        java_path: java.as_ref().map(|(p, _)| p.display().to_string()),
        java_version: java.as_ref().map(|(_, v)| v.clone()),
        runtime_ready: find_jar(&runtime_dir()).is_some(),
        runtime_path: runtime_dir().display().to_string(),
        download_url: DOWNLOAD_URL.into(),
    }
}

pub async fn ensure_runtime() -> Result<RuntimeStatus> {
    if find_jar(&runtime_dir()).is_some() {
        return Ok(runtime_status());
    }
    download_and_extract().await?;
    if find_jar(&runtime_dir()).is_none() {
        return Err(AppError::msg(
            "Downloaded DynamoDB Local, but DynamoDBLocal.jar was not found in the archive",
        ));
    }
    Ok(runtime_status())
}

async fn download_and_extract() -> Result<()> {
    let dest = runtime_dir();
    let _ = fs::create_dir_all(&dest);
    let archive = dest.join("dynamodb_local_latest.tar.gz");

    let bytes = reqwest::Client::builder()
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|e| AppError::msg(e.to_string()))?
        .get(DOWNLOAD_URL)
        .send()
        .await
        .map_err(|e| AppError::msg(format!("Download failed: {e}")))?
        .error_for_status()
        .map_err(|e| AppError::msg(format!("Download failed: {e}")))?
        .bytes()
        .await
        .map_err(|e| AppError::msg(format!("Download failed: {e}")))?;

    fs::write(&archive, &bytes).map_err(|e| AppError::msg(format!("Could not save archive: {e}")))?;

    let file = File::open(&archive).map_err(|e| AppError::msg(e.to_string()))?;
    let gz = flate2::read::GzDecoder::new(file);
    let mut tar = tar::Archive::new(gz);
    tar.unpack(&dest)
        .map_err(|e| AppError::msg(format!("Could not extract DynamoDB Local: {e}")))?;
    let _ = fs::remove_file(&archive);
    Ok(())
}

pub fn list_dbs(state: &AppState) -> Result<Vec<LocalDbInfo>> {
    reap(state);
    let mut out = Vec::new();
    let dir = dbs_dir();
    let entries = fs::read_dir(&dir).map_err(|e| AppError::msg(e.to_string()))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        if let Ok(info) = load_info(state, &path) {
            out.push(info);
        }
    }
    out.sort_by(|a, b| a.meta.name.to_lowercase().cmp(&b.meta.name.to_lowercase()));
    Ok(out)
}

pub fn create_db(state: &AppState, name: String, mode: String, port: Option<u16>) -> Result<LocalDbInfo> {
    let name = name.trim().to_string();
    validate_name(&name)?;
    let mode = if mode.eq_ignore_ascii_case("memory") {
        "memory"
    } else {
        "persistent"
    };
    let slug = unique_slug(&slugify(&name));
    let port = port.unwrap_or_else(|| next_port(state, None));
    let id = Uuid::new_v4().to_string();
    let dir = dbs_dir().join(&slug);
    fs::create_dir_all(&dir).map_err(|e| AppError::msg(e.to_string()))?;
    let meta = LocalDbMeta {
        id,
        name,
        slug,
        port,
        mode: mode.into(),
        created_at: now_iso(),
        last_opened_at: None,
    };
    write_meta(&dir, &meta)?;
    load_info(state, &dir)
}

pub fn rename_db(state: &AppState, id: &str, name: String) -> Result<LocalDbInfo> {
    let name = name.trim().to_string();
    validate_name(&name)?;
    let (dir, mut meta) = find_by_id(id)?;
    if is_running(state, &meta) {
        return Err(AppError::msg("Stop the database before renaming"));
    }
    meta.name = name;
    write_meta(&dir, &meta)?;
    load_info(state, &dir)
}

pub fn duplicate_db(state: &AppState, id: &str, new_name: String) -> Result<LocalDbInfo> {
    let name = new_name.trim().to_string();
    validate_name(&name)?;
    let (src, src_meta) = find_by_id(id)?;
    if is_running(state, &src_meta) {
        return Err(AppError::msg("Stop the database before duplicating"));
    }
    let slug = unique_slug(&slugify(&name));
    let dest = dbs_dir().join(&slug);
    copy_dir(&src, &dest)?;
    let _ = fs::remove_file(dest.join("pid"));
    let meta = LocalDbMeta {
        id: Uuid::new_v4().to_string(),
        name,
        slug,
        port: next_port(state, None),
        mode: src_meta.mode,
        created_at: now_iso(),
        last_opened_at: None,
    };
    write_meta(&dest, &meta)?;
    load_info(state, &dest)
}

pub fn delete_db(state: &AppState, id: &str) -> Result<()> {
    let (dir, meta) = find_by_id(id)?;
    if is_running(state, &meta) {
        stop_db(state, id)?;
    }
    fs::remove_dir_all(&dir).map_err(|e| AppError::msg(format!("Could not delete database: {e}")))?;
    if let Ok(mut list) = state.connections.lock() {
        list.retain(|c| c.id != meta.id);
    }
    if let Ok(mut clients) = state.clients.lock() {
        clients.remove(&meta.id);
    }
    let _ = state.persist();
    Ok(())
}

pub async fn start_db(state: &AppState, id: &str) -> Result<LocalDbInfo> {
    reap(state);
    let (dir, mut meta) = find_by_id(id)?;
    if is_running(state, &meta) {
        return load_info(state, &dir);
    }

    let status = runtime_status();
    if !status.runtime_ready {
        return Err(AppError::msg(
            "DynamoDB Local is not installed yet. The app will download it on Setup.",
        ));
    }
    let java = find_java().ok_or_else(|| {
        AppError::msg(
            "Java was not found. Install a JRE 11+ (for example: brew install openjdk) and try again.",
        )
    })?;

    let jar = find_jar(&runtime_dir()).ok_or_else(|| AppError::msg("DynamoDBLocal.jar is missing"))?;
    let lib = jar
        .parent()
        .map(|p| p.join("DynamoDBLocal_lib"))
        .filter(|p| p.exists())
        .ok_or_else(|| AppError::msg("DynamoDBLocal_lib is missing"))?;

    if port_taken(meta.port) {
        let next = next_port(state, Some(meta.port));
        meta.port = next;
        write_meta(&dir, &meta)?;
    }

    let log = File::create(dir.join("local.log")).map_err(|e| AppError::msg(e.to_string()))?;
    let log_err = log.try_clone().map_err(|e| AppError::msg(e.to_string()))?;

    let mut cmd = Command::new(&java.0);
    cmd.arg(format!("-Djava.library.path={}", lib.display()))
        .arg("-jar")
        .arg(&jar)
        .arg("-port")
        .arg(meta.port.to_string())
        .arg("-disableTelemetry")
        .current_dir(jar.parent().unwrap_or(runtime_dir().as_path()))
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(log_err));

    if meta.mode == "memory" {
        cmd.arg("-inMemory");
    } else {
        cmd.arg("-sharedDb").arg("-dbPath").arg(&dir);
    }

    let child = cmd
        .spawn()
        .map_err(|e| AppError::msg(format!("Failed to start Java: {e}")))?;
    let pid = child.id();
    write_pid(&dir, pid)?;

    {
        let mut procs = state
            .local_procs
            .lock()
            .map_err(|_| AppError::msg("State lock poisoned"))?;
        procs.insert(
            meta.id.clone(),
            ManagedProc {
                pid,
                child: Some(child),
            },
        );
    }

    wait_until_up(meta.port).await.inspect_err(|_| {
        let _ = stop_db(state, id);
    })?;

    Ok(load_info(state, &dir)?)
}

pub fn stop_db(state: &AppState, id: &str) -> Result<LocalDbInfo> {
    let (dir, meta) = find_by_id(id)?;
    let mut procs = state
        .local_procs
        .lock()
        .map_err(|_| AppError::msg("State lock poisoned"))?;
    if let Some(mut proc) = procs.remove(id) {
        if let Some(mut child) = proc.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        } else {
            kill_pid(proc.pid);
        }
    } else if let Some(pid) = read_pid(&dir) {
        kill_pid(pid);
    }
    let _ = fs::remove_file(dir.join("pid"));
    drop(procs);
    // brief wait so the port is released
    std::thread::sleep(Duration::from_millis(200));
    load_info(state, &dir).or_else(|_| {
        Ok(LocalDbInfo {
            endpoint: endpoint(meta.port),
            running: false,
            pid: None,
            data_path: dir.display().to_string(),
            size_bytes: dir_size(&dir),
            meta,
        })
    })
}

pub fn stop_all(state: &AppState) {
    let ids: Vec<String> = {
        if let Ok(procs) = state.local_procs.lock() {
            procs.keys().cloned().collect()
        } else {
            Vec::new()
        }
    };
    for id in ids {
        let _ = stop_db(state, &id);
    }
    if let Ok(dbs) = list_dbs(state) {
        for db in dbs {
            if db.running {
                let _ = stop_db(state, &db.meta.id);
            }
        }
    }
}

pub async fn open_db(state: &AppState, id: &str) -> Result<SavedConnection> {
    if !runtime_status().runtime_ready {
        ensure_runtime().await?;
    }
    let info = start_db(state, id).await?;
    let (dir, mut meta) = find_by_id(id)?;
    meta.last_opened_at = Some(now_iso());
    write_meta(&dir, &meta)?;

    let conn = SavedConnection {
        id: meta.id.clone(),
        name: format!("Local · {}", meta.name),
        region: "us-east-1".into(),
        auth: ConnectionAuth::Local {
            endpoint: endpoint(info.meta.port),
        },
    };
    {
        let mut list = state
            .connections
            .lock()
            .map_err(|_| AppError::msg("State lock poisoned"))?;
        if let Some(existing) = list.iter_mut().find(|c| c.id == conn.id) {
            *existing = conn.clone();
        } else {
            list.push(conn.clone());
        }
    }
    state.persist()?;
    Ok(redact(&conn))
}

fn wait_until_up(port: u16) -> impl std::future::Future<Output = Result<()>> {
    async move {
        let endpoint = endpoint(port);
        let dummy = SavedConnection {
            id: "probe".into(),
            name: "probe".into(),
            region: "us-east-1".into(),
            auth: ConnectionAuth::Local { endpoint },
        };
        for _ in 0..40 {
            if let Ok(client) = build_client(&dummy).await {
                if verify_client(&client).await.is_ok() {
                    return Ok(());
                }
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
        Err(AppError::msg(
            "DynamoDB Local started but did not become ready. Check local.log in the database folder.",
        ))
    }
}

fn load_info(state: &AppState, dir: &Path) -> Result<LocalDbInfo> {
    let meta = read_meta(dir)?;
    let running = is_running(state, &meta);
    let pid = if running {
        read_pid(dir).or_else(|| {
            state
                .local_procs
                .lock()
                .ok()
                .and_then(|p| p.get(&meta.id).map(|m| m.pid))
        })
    } else {
        None
    };
    Ok(LocalDbInfo {
        endpoint: endpoint(meta.port),
        running,
        pid,
        data_path: dir.display().to_string(),
        size_bytes: dir_size(dir),
        meta,
    })
}

fn is_running(state: &AppState, meta: &LocalDbMeta) -> bool {
    if let Ok(mut procs) = state.local_procs.lock() {
        if let Some(proc) = procs.get_mut(&meta.id) {
            if let Some(child) = proc.child.as_mut() {
                match child.try_wait() {
                    Ok(None) => return true,
                    Ok(Some(_)) | Err(_) => {
                        procs.remove(&meta.id);
                        return false;
                    }
                }
            }
            if pid_alive(proc.pid) {
                return true;
            }
            procs.remove(&meta.id);
        }
    }
    if let Ok((dir, _)) = find_dir_for_id(&meta.id) {
        if let Some(pid) = read_pid(&dir) {
            if pid_alive(pid) {
                if let Ok(mut procs) = state.local_procs.lock() {
                    procs.insert(
                        meta.id.clone(),
                        ManagedProc {
                            pid,
                            child: None,
                        },
                    );
                }
                return true;
            }
            let _ = fs::remove_file(dir.join("pid"));
        }
    }
    false
}

fn reap(state: &AppState) {
    if let Ok(mut procs) = state.local_procs.lock() {
        procs.retain(|_, proc| {
            if let Some(child) = proc.child.as_mut() {
                matches!(child.try_wait(), Ok(None))
            } else {
                pid_alive(proc.pid)
            }
        });
    }
}

fn find_by_id(id: &str) -> Result<(PathBuf, LocalDbMeta)> {
    let (dir, meta) = find_dir_for_id(id)?;
    Ok((dir, meta))
}

fn find_dir_for_id(id: &str) -> Result<(PathBuf, LocalDbMeta)> {
    for entry in fs::read_dir(dbs_dir()).map_err(|e| AppError::msg(e.to_string()))? {
        let path = entry.map_err(|e| AppError::msg(e.to_string()))?.path();
        if !path.is_dir() {
            continue;
        }
        if let Ok(meta) = read_meta(&path) {
            if meta.id == id {
                return Ok((path, meta));
            }
        }
    }
    Err(AppError::msg("Local database not found"))
}

fn read_meta(dir: &Path) -> Result<LocalDbMeta> {
    let raw = fs::read_to_string(dir.join("meta.json"))
        .map_err(|_| AppError::msg("Database folder is missing meta.json"))?;
    serde_json::from_str(&raw).map_err(|e| AppError::msg(e.to_string()))
}

fn write_meta(dir: &Path, meta: &LocalDbMeta) -> Result<()> {
    let json = serde_json::to_string_pretty(meta).map_err(|e| AppError::msg(e.to_string()))?;
    fs::write(dir.join("meta.json"), json).map_err(|e| AppError::msg(e.to_string()))
}

fn write_pid(dir: &Path, pid: u32) -> Result<()> {
    fs::write(dir.join("pid"), pid.to_string()).map_err(|e| AppError::msg(e.to_string()))
}

fn read_pid(dir: &Path) -> Option<u32> {
    fs::read_to_string(dir.join("pid"))
        .ok()
        .and_then(|s| s.trim().parse().ok())
}

fn find_jar(root: &Path) -> Option<PathBuf> {
    let direct = root.join("DynamoDBLocal.jar");
    if direct.exists() {
        return Some(direct);
    }
    if let Ok(entries) = fs::read_dir(root) {
        for entry in entries.flatten() {
            let jar = entry.path().join("DynamoDBLocal.jar");
            if jar.exists() {
                return Some(jar);
            }
        }
    }
    None
}

fn find_java() -> Option<(PathBuf, String)> {
    if let Ok(home) = std::env::var("JAVA_HOME") {
        let p = PathBuf::from(home).join("bin").join(java_bin());
        if let Some(v) = java_version(&p) {
            return Some((p, v));
        }
    }
    if let Some(p) = which("java") {
        if let Some(v) = java_version(&p) {
            return Some((p, v));
        }
    }
    #[cfg(target_os = "macos")]
    {
        if let Ok(out) = Command::new("/usr/libexec/java_home").output() {
            if out.status.success() {
                let home = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if !home.is_empty() {
                    let p = PathBuf::from(home).join("bin").join("java");
                    if let Some(v) = java_version(&p) {
                        return Some((p, v));
                    }
                }
            }
        }
    }
    None
}

fn java_version(bin: &Path) -> Option<String> {
    if !bin.exists() {
        return None;
    }
    let out = Command::new(bin).arg("-version").output().ok()?;
    let text = if out.stderr.is_empty() {
        String::from_utf8_lossy(&out.stdout).into_owned()
    } else {
        String::from_utf8_lossy(&out.stderr).into_owned()
    };
    let line = text.lines().next()?.trim();
    if line.is_empty() {
        None
    } else {
        Some(line.to_string())
    }
}

fn which(cmd: &str) -> Option<PathBuf> {
    let finder = if cfg!(windows) { "where" } else { "which" };
    let out = Command::new(finder).arg(cmd).output().ok()?;
    if !out.status.success() {
        return None;
    }
    let first = String::from_utf8_lossy(&out.stdout).lines().next()?.trim().to_string();
    if first.is_empty() {
        None
    } else {
        Some(PathBuf::from(first))
    }
}

fn java_bin() -> &'static str {
    if cfg!(windows) {
        "java.exe"
    } else {
        "java"
    }
}

fn pid_alive(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }
    #[cfg(unix)]
    {
        Command::new("kill")
            .args(["-0", &pid.to_string()])
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }
    #[cfg(windows)]
    {
        Command::new("tasklist")
            .args(["/FI", &format!("PID eq {pid}"), "/NH"])
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).contains(&pid.to_string()))
            .unwrap_or(false)
    }
}

fn kill_pid(pid: u32) {
    if pid == 0 {
        return;
    }
    #[cfg(unix)]
    {
        let _ = Command::new("kill").arg(pid.to_string()).status();
    }
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/F"])
            .status();
    }
}

fn port_taken(port: u16) -> bool {
    TcpListener::bind(("127.0.0.1", port)).is_err()
}

fn next_port(state: &AppState, skip: Option<u16>) -> u16 {
    let mut used = HashSet::new();
    if let Some(p) = skip {
        used.insert(p);
    }
    if let Ok(dbs) = list_dbs_meta_only() {
        for m in dbs {
            used.insert(m.port);
        }
    }
    let _ = state;
    for port in DEFAULT_PORT..DEFAULT_PORT + 200 {
        if used.contains(&port) {
            continue;
        }
        if !port_taken(port) {
            return port;
        }
    }
    DEFAULT_PORT
}

fn list_dbs_meta_only() -> Result<Vec<LocalDbMeta>> {
    let mut out = Vec::new();
    if let Ok(entries) = fs::read_dir(dbs_dir()) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if let Ok(meta) = read_meta(&path) {
                    out.push(meta);
                }
            }
        }
    }
    Ok(out)
}

fn endpoint(port: u16) -> String {
    format!("http://127.0.0.1:{port}")
}

fn validate_name(name: &str) -> Result<()> {
    if name.is_empty() || name.len() > 64 {
        return Err(AppError::msg("Name must be 1–64 characters"));
    }
    if !name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == ' ' || c == '-' || c == '_' || c == '.')
    {
        return Err(AppError::msg(
            "Use letters, numbers, spaces, dash, underscore, or dot",
        ));
    }
    Ok(())
}

fn slugify(name: &str) -> String {
    let s = name
        .trim()
        .to_ascii_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect::<String>();
    let s = s.trim_matches('-').to_string();
    if s.is_empty() {
        "db".into()
    } else {
        s
    }
}

fn unique_slug(base: &str) -> String {
    let mut slug = base.to_string();
    let mut n = 2;
    while dbs_dir().join(&slug).exists() {
        slug = format!("{base}-{n}");
        n += 1;
    }
    slug
}

fn copy_dir(src: &Path, dest: &Path) -> Result<()> {
    fs::create_dir_all(dest).map_err(|e| AppError::msg(e.to_string()))?;
    for entry in fs::read_dir(src).map_err(|e| AppError::msg(e.to_string()))? {
        let entry = entry.map_err(|e| AppError::msg(e.to_string()))?;
        let from = entry.path();
        let to = dest.join(entry.file_name());
        if from.is_dir() {
            copy_dir(&from, &to)?;
        } else {
            fs::copy(&from, &to).map_err(|e| AppError::msg(e.to_string()))?;
        }
    }
    Ok(())
}

fn dir_size(path: &Path) -> u64 {
    let mut total = 0u64;
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                total += dir_size(&p);
            } else if let Ok(meta) = entry.metadata() {
                total += meta.len();
            }
        }
    }
    total
}

fn now_iso() -> String {
    // Keep this dependency-free; local display is enough.
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    secs.to_string()
}

#[allow(dead_code)]
fn read_to_string_lossy(path: &Path) -> String {
    let mut buf = String::new();
    if let Ok(mut f) = File::open(path) {
        let _ = f.read_to_string(&mut buf);
    }
    buf
}

#[allow(dead_code)]
fn append_log(path: &Path, line: &str) {
    if let Ok(mut f) = File::options().create(true).append(true).open(path) {
        let _ = writeln!(f, "{line}");
    }
}
