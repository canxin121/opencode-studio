mod backend;
mod config;
mod updater;

#[cfg(not(feature = "cef"))]
type AppRuntime = tauri::Wry;

#[cfg(feature = "cef")]
type AppRuntime = tauri::Cef;

type AppHandle = tauri::AppHandle<AppRuntime>;

use tauri::{
    Manager,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};
use tauri_plugin_autostart::ManagerExt;

use backend::BackendManager;

pub fn run() {
    tauri::Builder::<AppRuntime>::new()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .invoke_handler(tauri::generate_handler![
            desktop_backend_status,
            desktop_backend_start,
            desktop_backend_stop,
            desktop_backend_restart,
            desktop_config_get,
            desktop_config_save,
            desktop_open_logs_dir,
            desktop_open_config,
            desktop_runtime_info,
            desktop_open_external,
            desktop_service_update,
            desktop_installer_update,
            desktop_update_progress_get,
        ])
        .setup(|app| {
            let app_handle = app.handle().clone();

            // Ensure a user-editable runtime config file exists.
            if let Ok(cfg) = config::load_or_create(&app_handle) {
                if let Err(err) = apply_autostart_on_boot(&app_handle, cfg.autostart_on_boot) {
                    eprintln!("desktop autostart apply failed: {err}");
                }
            }

            // Backend manager is always present so tray actions and UI commands share
            // one code path even when sidecar startup fails.
            app.manage(BackendManager::new());
            app.manage(updater::UpdateProgressState::default());

            // Create tray.
            let open_i = MenuItem::with_id(app, "open", "Open", true, None::<&str>)?;
            let start_i =
                MenuItem::with_id(app, "backend_start", "Start backend", true, None::<&str>)?;
            let stop_i =
                MenuItem::with_id(app, "backend_stop", "Stop backend", true, None::<&str>)?;
            let restart_i = MenuItem::with_id(
                app,
                "backend_restart",
                "Restart backend",
                true,
                None::<&str>,
            )?;
            let logs_i = MenuItem::with_id(app, "open_logs", "Open logs", true, None::<&str>)?;
            let cfg_i =
                MenuItem::with_id(app, "open_config", "Open runtime config", true, None::<&str>)?;
            let autostart_i = MenuItem::with_id(
                app,
                "toggle_autostart_on_boot",
                "Toggle launch at login",
                true,
                None::<&str>,
            )?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(
                app,
                &[
                    &open_i,
                    &start_i,
                    &stop_i,
                    &restart_i,
                    &logs_i,
                    &cfg_i,
                    &autostart_i,
                    &quit_i,
                ],
            )?;

            let tray = TrayIconBuilder::<AppRuntime>::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| {
                    let app = app.clone();
                    let id = event.id.as_ref().to_string();
                    tauri::async_runtime::spawn(async move {
                        handle_tray_menu(&app, &id).await;
                    });
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                })
                .build(app)?;

            // Keep tray handle alive.
            app.manage(tray);

            // Close-to-tray behavior.
            if let Some(win) = app.get_webview_window("main") {
                let win2 = win.clone();
                win.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = win2.hide();
                    }
                });
            }

            // Attempt autostart backend.
            let manager = app_handle.state::<BackendManager>().inner().clone();
            tauri::async_runtime::spawn(async move {
                let _ = manager.ensure_started(&app_handle).await;
                // If the main window is configured to load the backend URL, force a reload once ready.
                if let Some(win) = app_handle.get_webview_window("main") {
                    let _ = win.eval("try { window.location.reload(); } catch {}");
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application")
}

#[tauri::command]
async fn desktop_backend_status(app: AppHandle) -> backend::BackendStatus {
    app.state::<BackendManager>().inner().status().await
}

#[tauri::command]
async fn desktop_backend_start(app: AppHandle) -> Result<backend::BackendStatus, String> {
    app.state::<BackendManager>()
        .inner()
        .ensure_started(&app)
        .await
}

#[tauri::command]
async fn desktop_backend_stop(app: AppHandle) -> Result<(), String> {
    app.state::<BackendManager>().inner().stop(&app).await
}

#[tauri::command]
async fn desktop_backend_restart(app: AppHandle) -> Result<backend::BackendStatus, String> {
    app.state::<BackendManager>().inner().restart(&app).await
}

#[tauri::command]
fn desktop_config_get(app: AppHandle) -> Result<config::DesktopConfig, String> {
    config::load_or_create(&app)
}

#[tauri::command]
fn desktop_config_save(
    app: AppHandle,
    config: config::DesktopConfig,
) -> Result<config::DesktopConfig, String> {
    save_desktop_config(&app, config)
}

#[tauri::command]
fn desktop_open_logs_dir(app: AppHandle) -> Result<(), String> {
    backend::open_logs_dir(&app)
}

#[tauri::command]
fn desktop_open_config(app: AppHandle) -> Result<(), String> {
    config::open_runtime_config_file(&app)
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopRuntimeInfo {
    installer_version: String,
    installer_target: String,
    installer_channel: String,
    installer_type: String,
    installer_manager: String,
}

#[tauri::command]
fn desktop_runtime_info(app: AppHandle) -> DesktopRuntimeInfo {
    let target = runtime_target_triple()
        .unwrap_or_else(|| format!("{}-{}", std::env::consts::ARCH, std::env::consts::OS));
    let (installer_type, installer_manager) = detect_installer_identity();
    DesktopRuntimeInfo {
        installer_version: app.package_info().version.to_string(),
        installer_target: target,
        installer_channel: if cfg!(feature = "cef") {
            "cef".to_string()
        } else {
            "main".to_string()
        },
        installer_type,
        installer_manager,
    }
}

fn detect_installer_identity() -> (String, String) {
    let installer_type = std::env::var("OPENCODE_STUDIO_INSTALLER_TYPE")
        .ok()
        .and_then(|value| normalize_installer_type(&value))
        .unwrap_or_else(infer_installer_type_from_runtime);
    let installer_manager = std::env::var("OPENCODE_STUDIO_INSTALLER_MANAGER")
        .ok()
        .and_then(|value| normalize_installer_manager(&value))
        .unwrap_or_else(|| infer_installer_manager_from_runtime(&installer_type));
    (installer_type, installer_manager)
}

fn normalize_installer_type(raw: &str) -> Option<String> {
    let normalized = raw.trim().to_ascii_lowercase();
    match normalized.as_str() {
        "exe" | "msi" | "dmg" | "appimage" | "deb" | "rpm" | "pkg" => Some(normalized),
        _ => None,
    }
}

fn normalize_installer_manager(raw: &str) -> Option<String> {
    let normalized = raw.trim().to_ascii_lowercase();
    match normalized.as_str() {
        "direct" | "winget" | "choco" | "scoop" | "brew" | "apt" | "dnf" | "pacman" => {
            Some(normalized)
        }
        _ => None,
    }
}

fn infer_installer_type_from_runtime() -> String {
    #[cfg(target_os = "windows")]
    {
        if let Ok(exe_path) = std::env::current_exe() {
            if let Some(parent) = exe_path.parent() {
                if parent.join("uninstall.exe").exists() || parent.join("unins000.exe").exists() {
                    return "exe".to_string();
                }
            }
        }
        return "msi".to_string();
    }

    #[cfg(target_os = "macos")]
    {
        return "dmg".to_string();
    }

    #[cfg(target_os = "linux")]
    {
        if let Ok(exe_path) = std::env::current_exe() {
            let display = exe_path.to_string_lossy().to_ascii_lowercase();
            if display.contains("/scoop/") {
                return "appimage".to_string();
            }
        }
        return "appimage".to_string();
    }

    #[allow(unreachable_code)]
    "unknown".to_string()
}

fn infer_installer_manager_from_runtime(installer_type: &str) -> String {
    if let Ok(exe_path) = std::env::current_exe() {
        let display = exe_path.to_string_lossy().to_ascii_lowercase();
        if display.contains("\\scoop\\") || display.contains("/scoop/") {
            return "scoop".to_string();
        }
        if display.contains("\\chocolatey\\") || display.contains("/chocolatey/") {
            return "choco".to_string();
        }
        if display.contains("windowsapps") {
            return "winget".to_string();
        }
    }

    match installer_type {
        "deb" => "apt".to_string(),
        "rpm" => "dnf".to_string(),
        "pkg" => "pacman".to_string(),
        "dmg" => "direct".to_string(),
        "appimage" => "direct".to_string(),
        "exe" | "msi" => "direct".to_string(),
        _ => "direct".to_string(),
    }
}

#[tauri::command]
fn desktop_open_external(app: AppHandle, url: String) -> Result<(), String> {
    let url = url.trim();
    if !url.starts_with("https://") && !url.starts_with("http://") {
        return Err("only http/https urls are supported".to_string());
    }
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_path(url, None::<&str>)
        .map_err(|err| format!("open external url: {err}"))
}

#[tauri::command]
async fn desktop_service_update(app: AppHandle, asset_url: String) -> Result<(), String> {
    let progress = app.state::<updater::UpdateProgressState>().inner().clone();
    updater::apply_service_update(&app, &progress, asset_url).await
}

#[tauri::command]
async fn desktop_installer_update(
    app: AppHandle,
    asset_url: String,
    asset_name: Option<String>,
) -> Result<(), String> {
    let progress = app.state::<updater::UpdateProgressState>().inner().clone();
    updater::apply_installer_update(&app, &progress, asset_url, asset_name).await
}

#[tauri::command]
fn desktop_update_progress_get(app: AppHandle) -> updater::UpdateProgressSnapshot {
    app.state::<updater::UpdateProgressState>()
        .inner()
        .snapshot()
}

fn runtime_target_triple() -> Option<String> {
    let os = std::env::consts::OS;
    let arch = std::env::consts::ARCH;
    match (os, arch) {
        ("linux", "x86_64") => Some("x86_64-unknown-linux-gnu".to_string()),
        ("macos", "x86_64") => Some("x86_64-apple-darwin".to_string()),
        ("macos", "aarch64") => Some("aarch64-apple-darwin".to_string()),
        ("windows", "x86_64") => Some("x86_64-pc-windows-msvc".to_string()),
        _ => None,
    }
}

async fn handle_tray_menu(app: &AppHandle, id: &str) {
    match id {
        "open" => {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.set_focus();
            }
        }
        "backend_start" => {
            let manager = app.state::<BackendManager>().inner().clone();
            let _ = manager.ensure_started(app).await;
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.eval("try { window.location.reload(); } catch {}");
            }
        }
        "backend_stop" => {
            let manager = app.state::<BackendManager>().inner().clone();
            let _ = manager.stop(app).await;
        }
        "backend_restart" => {
            let manager = app.state::<BackendManager>().inner().clone();
            let _ = manager.restart(app).await;
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.eval("try { window.location.reload(); } catch {}");
            }
        }
        "open_logs" => {
            let _ = backend::open_logs_dir(app);
        }
        "open_config" => {
            let _ = config::open_runtime_config_file(app);
        }
        "toggle_autostart_on_boot" => {
            let _ = toggle_autostart_on_boot(app);
        }
        "quit" => {
            let manager = app.state::<BackendManager>().inner().clone();
            let _ = manager.stop(app).await;
            app.exit(0);
        }
        _ => {}
    }
}

fn toggle_autostart_on_boot(app: &AppHandle) -> Result<config::DesktopConfig, String> {
    let mut cfg = config::load_or_create(app)?;
    cfg.autostart_on_boot = !cfg.autostart_on_boot;
    save_desktop_config(app, cfg)
}

fn save_desktop_config(
    app: &AppHandle,
    cfg: config::DesktopConfig,
) -> Result<config::DesktopConfig, String> {
    let saved = config::save(app, cfg)?;
    apply_autostart_on_boot(app, saved.autostart_on_boot)?;
    Ok(saved)
}

fn apply_autostart_on_boot(app: &AppHandle, enabled: bool) -> Result<(), String> {
    let manager = app.autolaunch();
    let is_enabled = manager
        .is_enabled()
        .map_err(|e| format!("autostart status: {e}"))?;

    if enabled && !is_enabled {
        manager
            .enable()
            .map_err(|e| format!("autostart enable: {e}"))?;
    } else if !enabled && is_enabled {
        manager
            .disable()
            .map_err(|e| format!("autostart disable: {e}"))?;
    }

    Ok(())
}
