// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;

/// Store a token securely in the OS keychain.
/// In production, use tauri-plugin-keyring or os_keyring crate.
#[tauri::command]
fn store_token(key: String, value: String) -> Result<(), String> {
    // In production: keyring::Entry::new("company-ai", &key).set_password(&value)
    // For now, log that it would be stored
    println!("Would store token for key: {} (production: OS keychain)", key);
    Ok(())
}

/// Retrieve a token from the OS keychain.
#[tauri::command]
fn get_token(key: String) -> Result<Option<String>, String> {
    // In production: keyring::Entry::new("company-ai", &key).get_password().ok()
    Ok(None)
}

/// Delete a token from the OS keychain.
#[tauri::command]
fn delete_token(key: String) -> Result<(), String> {
    // In production: keyring::Entry::new("company-ai", &key).delete_password()
    println!("Would delete token for key: {}", key);
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // Configure system tray (optional)
            #[cfg(desktop)]
            {
                let window = app.get_webview_window("main").unwrap();
                window.set_title("Company AI").unwrap();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            store_token,
            get_token,
            delete_token,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Company AI");
}
