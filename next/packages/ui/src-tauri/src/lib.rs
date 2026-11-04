use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;
use std::os::unix::process::CommandExt;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::ipc::Channel;
use tauri::{AppHandle, State};
use tauri_plugin_notification::NotificationExt;

const CLOSED_LINE: &str = r#"{"jsonrpc":"2.0","method":"bridge.closed","params":{}}"#;
const RPC_TIMEOUT: Duration = Duration::from_secs(30);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Default)]
struct Shared {
    writer: Mutex<Option<UnixStream>>,
    pending: Mutex<HashMap<String, Sender<String>>>,
    events: Mutex<Option<Channel<String>>>,
    connecting: Mutex<()>,
}

#[derive(Clone, Default)]
pub struct Bridge(Arc<Shared>);

#[derive(Serialize)]
struct EnvInfo {
    home: String,
    shell: String,
}

fn home_dir() -> PathBuf {
    PathBuf::from(std::env::var_os("HOME").unwrap_or_default())
}

// Same rule as the core and holder: GROVE_NEXT_HOME, else ~/.grove-next.
fn grove_home() -> PathBuf {
    match std::env::var_os("GROVE_NEXT_HOME") {
        Some(home) if !home.is_empty() => PathBuf::from(home),
        _ => home_dir().join(".grove-next"),
    }
}

// The next/ folder, which holds packages/ and node_modules/. Dev builds only.
fn next_root() -> PathBuf {
    match std::env::var_os("GROVE_NEXT_ROOT") {
        Some(root) if !root.is_empty() => PathBuf::from(root),
        _ => PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../.."),
    }
}

// Starts the holder detached: its own process group and no stdio, so it outlives this app.
fn start_holder() -> Result<(), String> {
    let node = std::env::var("GROVE_NEXT_NODE")
        .ok()
        .filter(|path| !path.is_empty())
        .unwrap_or_else(|| "node".to_string());
    let root = next_root();
    Command::new(&node)
        .arg("--import")
        .arg("tsx")
        .arg(root.join("packages/holder/bin.ts"))
        .current_dir(&root)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .process_group(0)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("could not start the holder with {node}: {error}"))
}

fn ensure_connected(shared: &Arc<Shared>) -> Result<(), String> {
    let _guard = shared.connecting.lock().map_err(|_| "bridge lock poisoned")?;
    if shared.writer.lock().map_err(|_| "bridge lock poisoned")?.is_some() {
        return Ok(());
    }
    let home = grove_home();
    let core = home.join("s");
    let stream = match UnixStream::connect(&core) {
        Ok(stream) => stream,
        Err(_) => {
            if UnixStream::connect(home.join("h")).is_err() {
                start_holder()?;
            }
            let deadline = Instant::now() + CONNECT_TIMEOUT;
            let mut delay = Duration::from_millis(100);
            loop {
                match UnixStream::connect(&core) {
                    Ok(stream) => break stream,
                    Err(error) if Instant::now() >= deadline => {
                        return Err(format!("core socket {} not reachable: {error}", core.display()));
                    }
                    Err(_) => {
                        thread::sleep(delay);
                        delay = (delay * 2).min(Duration::from_secs(1));
                    }
                }
            }
        }
    };
    let reader = stream.try_clone().map_err(|error| error.to_string())?;
    *shared.writer.lock().map_err(|_| "bridge lock poisoned")? = Some(stream);
    spawn_reader(shared.clone(), reader);
    Ok(())
}

// Responses go to the waiting rpc call; notifications go to the page's channel as raw lines.
fn spawn_reader(shared: Arc<Shared>, stream: UnixStream) {
    thread::spawn(move || {
        for line in BufReader::new(stream).lines() {
            let Ok(line) = line else { break };
            let Ok(message) = serde_json::from_str::<Value>(&line) else { continue };
            if message.get("method").is_some() {
                if let Some(events) = shared.events.lock().ok().and_then(|events| events.clone()) {
                    let _ = events.send(line);
                }
            } else if let Some(id) = message.get("id") {
                let waiter = shared.pending.lock().ok().and_then(|mut pending| pending.remove(&id.to_string()));
                if let Some(waiter) = waiter {
                    let _ = waiter.send(line);
                }
            }
        }
        if let Ok(mut writer) = shared.writer.lock() {
            *writer = None;
        }
        if let Ok(mut pending) = shared.pending.lock() {
            pending.clear();
        }
        if let Some(events) = shared.events.lock().ok().and_then(|events| events.clone()) {
            let _ = events.send(CLOSED_LINE.to_string());
        }
    });
}

#[tauri::command]
async fn connect(bridge: State<'_, Bridge>, events: Channel<String>) -> Result<(), String> {
    let shared = bridge.0.clone();
    *shared.events.lock().map_err(|_| "bridge lock poisoned")? = Some(events);
    tauri::async_runtime::spawn_blocking(move || ensure_connected(&shared))
        .await
        .map_err(|error| error.to_string())?
}

// Sends one JSON-RPC request and returns the response line unchanged.
#[tauri::command]
async fn rpc(bridge: State<'_, Bridge>, request: Value) -> Result<String, String> {
    let shared = bridge.0.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        ensure_connected(&shared)?;
        let key = request.get("id").ok_or("request has no id")?.to_string();
        let mut line = serde_json::to_string(&request).map_err(|error| error.to_string())?;
        line.push('\n');
        let (sender, receiver) = channel();
        shared.pending.lock().map_err(|_| "bridge lock poisoned")?.insert(key.clone(), sender);
        let written = {
            let mut writer = shared.writer.lock().map_err(|_| "bridge lock poisoned")?;
            let result = match writer.as_mut() {
                Some(stream) => stream.write_all(line.as_bytes()).map_err(|error| error.to_string()),
                None => Err("core is not connected".to_string()),
            };
            if result.is_err() {
                *writer = None;
            }
            result
        };
        if let Err(error) = written {
            shared.pending.lock().map_err(|_| "bridge lock poisoned")?.remove(&key);
            return Err(error);
        }
        receiver.recv_timeout(RPC_TIMEOUT).map_err(|_| {
            if let Ok(mut pending) = shared.pending.lock() {
                pending.remove(&key);
            }
            "the core did not answer".to_string()
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
fn env_info() -> EnvInfo {
    EnvInfo {
        home: home_dir().display().to_string(),
        shell: std::env::var("SHELL").ok().filter(|shell| !shell.is_empty()).unwrap_or_else(|| "/bin/zsh".to_string()),
    }
}

// Shows a notification and, when there is a sound file, plays it with afplay without waiting for it to finish.
#[tauri::command]
fn notify(app: AppHandle, title: String, body: String, sound: Option<String>) {
    if let Err(error) = app.notification().builder().title(title).body(body).show() {
        eprintln!("notification failed: {error}");
    }
    if let Some(file) = sound {
        match Command::new("/usr/bin/afplay")
            .arg(&file)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
        {
            // Reaped on a thread so the finished process does not linger as a zombie.
            Ok(mut child) => {
                thread::spawn(move || {
                    let _ = child.wait();
                });
            }
            Err(error) => eprintln!("sound failed: {error}"),
        }
    }
}

pub fn run() {
    tauri::Builder::default()
        .manage(Bridge::default())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![connect, rpc, env_info, notify])
        .run(tauri::generate_context!())
        .expect("error while running the Grove window");
}
