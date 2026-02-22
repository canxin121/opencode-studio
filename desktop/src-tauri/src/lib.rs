mod backend;
mod config;

#[cfg(not(feature = "cef"))]
type AppRuntime = tauri::Wry;

#[cfg(feature = "cef")]
type AppRuntime = tauri::Cef;

use tauri::{
  menu::{Menu, MenuItem},
  tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
  Manager,
};

use backend::BackendManager;

struct TrayState(tauri::tray::TrayIcon);

pub fn run() {
  tauri::Builder::<AppRuntime>::new()
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_opener::init())
    .invoke_handler(tauri::generate_handler![
      desktop_backend_status,
      desktop_backend_start,
      desktop_backend_stop,
      desktop_backend_restart,
      desktop_open_logs_dir,
      desktop_open_config,
    ])
    .setup(|app| {
      let app_handle = app.handle().clone();

      // Ensure a user-editable config file exists.
      let _ = config::load_or_create(&app_handle);

      // Backend manager is present even in frontend-only builds; it will
      // simply not find a sidecar to spawn.
      app.manage(BackendManager::new());

      // Create tray.
      let open_i = MenuItem::with_id(app, "open", "Open", true, None::<&str>)?;
      let start_i = MenuItem::with_id(app, "backend_start", "Start backend", true, None::<&str>)?;
      let stop_i = MenuItem::with_id(app, "backend_stop", "Stop backend", true, None::<&str>)?;
      let restart_i = MenuItem::with_id(app, "backend_restart", "Restart backend", true, None::<&str>)?;
      let logs_i = MenuItem::with_id(app, "open_logs", "Open logs", true, None::<&str>)?;
      let cfg_i = MenuItem::with_id(app, "open_config", "Open config", true, None::<&str>)?;
      let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
      let menu = Menu::with_items(app, &[&open_i, &start_i, &stop_i, &restart_i, &logs_i, &cfg_i, &quit_i])?;

      let tray = TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .menu_on_left_click(false)
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
      app.manage(TrayState(tray));

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

      // Attempt autostart backend (only works on full build where sidecar exists).
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
async fn desktop_backend_status(app: tauri::AppHandle) -> backend::BackendStatus {
  app.state::<BackendManager>().inner().status().await
}

#[tauri::command]
async fn desktop_backend_start(app: tauri::AppHandle) -> Result<backend::BackendStatus, String> {
  app.state::<BackendManager>().inner().ensure_started(&app).await
}

#[tauri::command]
async fn desktop_backend_stop(app: tauri::AppHandle) -> Result<(), String> {
  app.state::<BackendManager>().inner().stop(&app).await
}

#[tauri::command]
async fn desktop_backend_restart(app: tauri::AppHandle) -> Result<backend::BackendStatus, String> {
  app.state::<BackendManager>().inner().restart(&app).await
}

#[tauri::command]
fn desktop_open_logs_dir(app: tauri::AppHandle) -> Result<(), String> {
  backend::open_logs_dir(&app)
}

#[tauri::command]
fn desktop_open_config(app: tauri::AppHandle) -> Result<(), String> {
  config::open_config_file(&app)
}

async fn handle_tray_menu(app: &tauri::AppHandle, id: &str) {
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
      let _ = config::open_config_file(app);
    }
    "quit" => {
      let manager = app.state::<BackendManager>().inner().clone();
      let _ = manager.stop(app).await;
      app.exit(0);
    }
    _ => {}
  }
}
