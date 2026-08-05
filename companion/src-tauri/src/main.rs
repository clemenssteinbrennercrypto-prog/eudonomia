// Eudonomia — macOS app.
//
// A normal windowed app that loads the bundled Eudonomia UI in its own WebView,
// plus a menubar tray for quick access and quit. Loading the UI in the app's own
// window sidesteps every browser↔localhost problem (Brave shields,
// IPv6, mixed content): the WebView talks to the in-process companion server on
// 127.0.0.1:7331 directly. Two background workers run for the app's lifetime:
// the AppleScript activity poller and the axum HTTP server.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod activity;
mod blocking;
mod output;
mod server;

use activity::{
    ActivityState, DebugState, SessionConfig, SharedActivity, SharedDebug, SharedSession,
};
use serde::Serialize;
use server::AppState;
use std::sync::{Arc, Mutex};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};

const MAIN_LABEL: &str = "main";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeUpdateStatus {
    supported: bool,
    available: bool,
    current_version: String,
    version: Option<String>,
    error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeUpdateInstallResult {
    installed: bool,
    version: Option<String>,
    error: Option<String>,
}

/// Check GitHub Releases for a newer signed companion build. This only reports
/// state; installation is a separate user action so the UI can distinguish a
/// local WebView reload from a real native app update.
#[tauri::command]
async fn check_native_update(app: tauri::AppHandle) -> NativeUpdateStatus {
    use tauri_plugin_updater::UpdaterExt;

    let current_version = app.package_info().version.to_string();

    if tauri_plugin_updater::target().is_none() {
        return NativeUpdateStatus {
            supported: false,
            available: false,
            current_version,
            version: None,
            error: Some("Updater is not supported on this platform.".into()),
        };
    }

    let updater = match app.updater() {
        Ok(updater) => updater,
        Err(err) => {
            return NativeUpdateStatus {
                supported: true,
                available: false,
                current_version,
                version: None,
                error: Some(err.to_string()),
            };
        }
    };

    match updater.check().await {
        Ok(Some(update)) => NativeUpdateStatus {
            supported: true,
            available: true,
            current_version,
            version: Some(update.version.to_string()),
            error: None,
        },
        Ok(None) => NativeUpdateStatus {
            supported: true,
            available: false,
            current_version,
            version: None,
            error: None,
        },
        Err(err) => NativeUpdateStatus {
            supported: true,
            available: false,
            current_version,
            version: None,
            error: Some(err.to_string()),
        },
    }
}

/// Install the currently available signed companion update and restart into it.
/// A fresh check is performed so we never install a stale or fabricated update.
#[tauri::command]
async fn install_native_update(app: tauri::AppHandle) -> NativeUpdateInstallResult {
    use tauri_plugin_updater::UpdaterExt;

    let updater = match app.updater() {
        Ok(updater) => updater,
        Err(err) => {
            return NativeUpdateInstallResult {
                installed: false,
                version: None,
                error: Some(err.to_string()),
            };
        }
    };

    match updater.check().await {
        Ok(Some(update)) => {
            let version = update.version.to_string();
            match update.download_and_install(|_, _| {}, || {}).await {
                Ok(()) => {
                    app.restart();
                    NativeUpdateInstallResult {
                        installed: true,
                        version: Some(version),
                        error: None,
                    }
                }
                Err(err) => NativeUpdateInstallResult {
                    installed: false,
                    version: Some(version),
                    error: Some(err.to_string()),
                },
            }
        }
        Ok(None) => NativeUpdateInstallResult {
            installed: false,
            version: None,
            error: None,
        },
        Err(err) => NativeUpdateInstallResult {
            installed: false,
            version: None,
            error: Some(err.to_string()),
        },
    }
}

/// Show and focus the main Eudonomia window (defined in tauri.conf.json).
fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_LABEL) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    // Failsafe #3: never leave the machine blocked after the app closes.
    let _ = blocking::clear_block();
    app.exit(0);
}

fn main() {
    // Failsafe #1: if a previous run crashed mid-session, an Eudonomia block may
    // still be sitting in /etc/hosts. Clear it on every startup so blocking can
    // never outlive the process that created it. (Prompts for admin only if a
    // leftover block actually exists — a clean file is a no-op.)
    if blocking::hosts_has_block() {
        let _ = blocking::clear_block();
    }

    let state: SharedActivity = Arc::new(Mutex::new(ActivityState::default()));
    let session: SharedSession = Arc::new(Mutex::new(SessionConfig::default()));
    let debug: SharedDebug = Arc::new(Mutex::new(DebugState::default()));

    activity::start_polling(state.clone(), session.clone(), debug.clone());

    let server_state = AppState {
        activity: state.clone(),
        session: session.clone(),
        debug: debug.clone(),
        // No folder is watched until the UI nominates one for a session.
        output_baseline: std::sync::Arc::new(std::sync::Mutex::new(None)),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            check_native_update,
            install_native_update,
            quit_app
        ])
        .setup(move |app| {
            // HTTP server on the tauri-managed tokio runtime.
            tauri::async_runtime::spawn(server::run(server_state.clone()));

            let open = MenuItem::with_id(app, "open", "Open Eudonomia", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit Eudonomia", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &quit])?;

            TrayIconBuilder::with_id("main-tray")
                .icon(app.default_window_icon().cloned().expect("bundled icon"))
                .icon_as_template(false)
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_main_window(app),
                    "quit" => {
                        let _ = blocking::clear_block();
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                })
                .build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running eudonomia");
}
