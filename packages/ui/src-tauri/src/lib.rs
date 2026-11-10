use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::UnixStream;
use std::os::unix::process::CommandExt;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::ipc::Channel;
use tauri::menu::{Menu, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Manager, State};
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

// Same rule as the core and holder: GROVE_HOME, else ~/.grove. The app used to keep its state in ~/.grove-next; each
// entry moves over unless it is already there, so ~/.grove's other files are left alone.
fn grove_home() -> PathBuf {
    match std::env::var_os("GROVE_HOME") {
        Some(home) if !home.is_empty() => PathBuf::from(home),
        _ => {
            let home = home_dir().join(".grove");
            let legacy = home_dir().join(".grove-next");
            if let Ok(entries) = fs::read_dir(&legacy) {
                let _ = fs::create_dir_all(&home);
                for entry in entries.flatten() {
                    let target = home.join(entry.file_name());
                    if !target.exists() {
                        let _ = fs::rename(entry.path(), target);
                    }
                }
                let _ = fs::remove_dir(&legacy);
            }
            home
        }
    }
}

// The next/ folder, which holds packages/ and node_modules/. Dev builds only.
fn repo_root() -> PathBuf {
    match std::env::var_os("GROVE_ROOT") {
        Some(root) if !root.is_empty() => PathBuf::from(root),
        _ => PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../.."),
    }
}

// Starts the holder detached: its own process group and no stdio, so it outlives this app.
fn start_holder() -> Result<(), String> {
    let node = std::env::var("GROVE_NODE")
        .ok()
        .filter(|path| !path.is_empty())
        .unwrap_or_else(|| "node".to_string());
    let root = repo_root();
    // The holder and the core it supervises log here, so a core that dies leaves a trace.
    let log_path = grove_home().join("holder.log");
    let open_log = || fs::OpenOptions::new().create(true).append(true).open(&log_path);
    let (out, err) = match (open_log(), open_log()) {
        (Ok(out), Ok(err)) => (Stdio::from(out), Stdio::from(err)),
        _ => (Stdio::null(), Stdio::null()),
    };
    Command::new(&node)
        .arg("--import")
        .arg("tsx")
        .arg(root.join("packages/holder/bin.ts"))
        .current_dir(&root)
        .stdin(Stdio::null())
        .stdout(out)
        .stderr(err)
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
            let holder_up = UnixStream::connect(home.join("h")).is_ok();
            if !holder_up {
                start_holder()?;
            }
            let deadline = Instant::now() + CONNECT_TIMEOUT;
            let mut delay = Duration::from_millis(100);
            loop {
                match UnixStream::connect(&core) {
                    Ok(stream) => break stream,
                    Err(error) if Instant::now() >= deadline => {
                        let hint = if holder_up {
                            format!(
                                "; a holder is already running but its core is not. It is probably left over from an older build: stop it (pkill -f packages/holder/bin.ts) and relaunch. See {}",
                                home.join("holder.log").display()
                            )
                        } else {
                            format!("; see {}", home.join("holder.log").display())
                        };
                        return Err(format!("core socket {} not reachable: {error}{hint}", core.display()));
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

// Brings the main window forward for a CLI focus request.
#[tauri::command]
fn raise_window(app: AppHandle) -> Result<(), String> {
    let window = app.get_webview_window("main").ok_or("the main window is not open")?;
    window.show().map_err(|error| error.to_string())?;
    window.unminimize().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())
}

// The first line of every wrapper written by install_cli; a file that starts with it is ours and may be replaced.
const WRAPPER_START: &str = "#!/bin/sh\nexec '";

// Writes ~/.local/bin/grove as a wrapper script, not a symlink: the script finds its folder from $0.
#[tauri::command]
fn install_cli() -> Result<String, String> {
    let script = fs::canonicalize(repo_root().join("bin/grove"))
        .map_err(|error| format!("grove not found under {}: {error}", repo_root().display()))?;
    let dir = home_dir().join(".local/bin");
    let target = dir.join("grove");
    // A symlink is never followed here: it is not one of our wrappers, whatever it points at.
    if let Ok(metadata) = fs::symlink_metadata(&target) {
        let ours = !metadata.file_type().is_symlink()
            && fs::read_to_string(&target).map(|text| text.starts_with(WRAPPER_START)).unwrap_or(false);
        if !ours {
            return Err(format!("{} exists and is not a grove command; remove it first", target.display()));
        }
    }
    fs::create_dir_all(&dir).map_err(|error| format!("could not create {}: {error}", dir.display()))?;
    let path = script.display().to_string();
    // A line break in the path would split the wrapper's exec line, so such a checkout is refused.
    if path.chars().any(char::is_control) {
        return Err(format!("{path} has a control character in its path; the command cannot be installed from there"));
    }
    let quoted = path.replace('\'', r"'\''");
    // Written beside the target and renamed over it, so a failed write never leaves a half-written wrapper behind.
    let staged = dir.join(format!(".grove.{}.tmp", std::process::id()));
    fs::write(&staged, format!("{WRAPPER_START}{quoted}' \"$@\"\n"))
        .map_err(|error| format!("could not write {}: {error}", staged.display()))?;
    fs::set_permissions(&staged, fs::Permissions::from_mode(0o755))
        .map_err(|error| format!("could not make {} executable: {error}", staged.display()))?;
    fs::rename(&staged, &target).map_err(|error| {
        let _ = fs::remove_file(&staged);
        format!("could not install {}: {error}", target.display())
    })?;
    Ok(target.display().to_string())
}

// Shows a notification and, when there is a sound file, plays it with afplay without waiting for it to finish.
#[tauri::command]
fn notify(app: AppHandle, title: String, body: String, sound: Option<String>) {
    if let Err(error) = app.notification().builder().title(title).body(body).show() {
        eprintln!("notification failed: {error}");
    }
    if let Some(file) = sound {
        play_sound(file);
    }
}

// Plays one system sound file apart from any notification: the Settings switch uses it to let the human hear the sound.
#[tauri::command]
fn play_sound(file: String) {
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

// The default menu binds Cmd+W to "close window", which the system handles before the page sees the key. Grove's
// window closes its tabs on Cmd+W instead, so the menu leaves that item out and keeps the rest of the default one.
fn build_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let app_menu = Submenu::with_items(
        app,
        "Grove",
        true,
        &[
            &PredefinedMenuItem::about(app, None, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;
    let edit_menu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;
    let window_menu = Submenu::with_items(app, "Window", true, &[&PredefinedMenuItem::minimize(app, None)?])?;
    Menu::with_items(app, &[&app_menu, &edit_menu, &window_menu])
}

// The title bar stays (a titled window keeps its rounded corners and stays a standard window for tiling managers such as
// AeroSpace); only the close, minimise and zoom buttons are hidden.
#[cfg(target_os = "macos")]
fn hide_window_buttons(window: &tauri::WebviewWindow) {
    use objc2_app_kit::{NSWindow, NSWindowButton};
    let Ok(ptr) = window.ns_window() else { return };
    // SAFETY: Tauri hands out the window's live NSWindow, and setup runs on the main thread.
    let ns_window: &NSWindow = unsafe { &*ptr.cast() };
    for kind in [NSWindowButton::CloseButton, NSWindowButton::MiniaturizeButton, NSWindowButton::ZoomButton] {
        if let Some(button) = ns_window.standardWindowButton(kind) {
            button.setHidden(true);
        }
    }
}

pub fn run() {
    tauri::Builder::default()
        .manage(Bridge::default())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let menu = build_menu(app.handle())?;
            app.set_menu(menu)?;
            #[cfg(target_os = "macos")]
            if let Some(window) = app.get_webview_window("main") {
                hide_window_buttons(&window);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![connect, rpc, env_info, notify, play_sound, raise_window, install_cli])
        .run(tauri::generate_context!())
        .expect("error while running the Grove window");
}
