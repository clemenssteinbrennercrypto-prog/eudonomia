// Eudonomia — macOS app.
//
// A normal windowed app that loads the Eudonomia UI (the Vercel web app) in its
// own WebView, plus a menubar tray for quick access and quit. Loading the UI in
// the app's own window sidesteps every browser↔localhost problem (Brave shields,
// IPv6, mixed content): the WebView talks to the in-process companion server on
// 127.0.0.1:7331 directly. Two background workers run for the app's lifetime:
// the AppleScript activity poller and the axum HTTP server.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod activity;
mod blocking;
mod server;

use activity::{
    ActivityState, DebugState, SessionConfig, SharedActivity, SharedDebug, SharedSession,
};
use server::AppState;
use std::sync::{Arc, Mutex};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};

const MAIN_LABEL: &str = "main";

/// Check GitHub Releases for a newer companion build and install it silently in
/// the background. The update is applied on the next launch, so this never
/// interrupts a running focus session. Signed with our updater key; the plugin
/// verifies the signature before installing. Any failure (offline, no update)
/// is ignored — the app runs fine on the current version.
fn spawn_update_check(handle: tauri::AppHandle) {
    use tauri_plugin_updater::UpdaterExt;
    tauri::async_runtime::spawn(async move {
        let Ok(updater) = handle.updater() else { return };
        match updater.check().await {
            Ok(Some(update)) => {
                let _ = update.download_and_install(|_, _| {}, || {}).await;
                // Installed; it applies the next time the user opens Eudonomia.
            }
            _ => {}
        }
    });
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
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![quit_app])
        .setup(move |app| {
            // HTTP server on the tauri-managed tokio runtime.
            tauri::async_runtime::spawn(server::run(server_state.clone()));

            // Check for a newer signed build in the background.
            spawn_update_check(app.handle().clone());

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
