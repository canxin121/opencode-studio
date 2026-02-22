#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg_attr(feature = "cef", tauri::cef_entry_point)]
fn main() {
    opencode_studio_desktop::run()
}
