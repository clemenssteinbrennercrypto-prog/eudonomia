// Eudonomia Companion — macOS menubar app.
//
// No main window: a tray icon toggles a small popup WebView (ui/index.html)
// anchored near the menubar. Two background workers run for the whole app
// lifetime: the AppleScript activity poller and the axum HTTP server.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod activity;
mod server;

use activity::{ActivityState, SharedActivity};
use std::sync::{Arc, Mutex};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    ActivationPolicy, Manager, WebviewUrl, WebviewWindowBuilder,
};

const POPUP_LABEL: &str = "popup";
const POPUP_WIDTH: f64 = 260.0;
const POPUP_HEIGHT: f64 = 190.0;

fn toggle_popup(app: &tauri::AppHandle, tray_position: Option<tauri::PhysicalPosition<f64>>) {
    if let Some(window) = app.get_webview_window(POPUP_LABEL) {
        let visible = window.is_visible().unwrap_or(false);
        if visible {
            let _ = window.hide();
        } else {
            position_near_tray(&window, tray_position);
            let _ = window.show();
            let _ = window.set_focus();
        }
        return;
    }

    // First click: create the popup lazily.
    let window = WebviewWindowBuilder::new(app, POPUP_LABEL, WebviewUrl::App("index.html".into()))
        .title("Eudonomia")
        .inner_size(POPUP_WIDTH, POPUP_HEIGHT)
        .resizable(false)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .build();

    if let Ok(window) = window {
        position_near_tray(&window, tray_position);
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn position_near_tray(
    window: &tauri::WebviewWindow,
    tray_position: Option<tauri::PhysicalPosition<f64>>,
) {
    if let Some(pos) = tray_position {
        let scale = window
            .current_monitor()
            .ok()
            .flatten()
            .map(|m| m.scale_factor())
            .unwrap_or(1.0);
        let logical_x = pos.x / scale - POPUP_WIDTH / 2.0;
        // Menubar sits at the top on macOS; drop the popup just below it.
        let logical_y = pos.y / scale + 8.0;
        let _ = window.set_position(tauri::LogicalPosition::new(logical_x.max(8.0), logical_y));
    }
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

fn main() {
    let state: SharedActivity = Arc::new(Mutex::new(ActivityState::default()));

    activity::start_polling(state.clone());

    let server_state = state.clone();

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![quit_app])
        .setup(move |app| {
            // Menubar-only app: hide the Dock icon.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(ActivationPolicy::Accessory);

            // HTTP server on the tauri-managed tokio runtime.
            tauri::async_runtime::spawn(server::run(server_state.clone()));

            let quit = MenuItem::with_id(app, "quit", "Quit Eudonomia Companion", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&quit])?;

            TrayIconBuilder::with_id("main-tray")
                .icon(app.default_window_icon().cloned().expect("bundled icon"))
                .icon_as_template(false)
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| {
                    if event.id.as_ref() == "quit" {
                        app.exit(0);
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        position,
                        ..
                    } = event
                    {
                        toggle_popup(tray.app_handle(), Some(position));
                    }
                })
                .build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running eudonomia-companion");
}
