// Eudonomia — macOS app.
//
// A normal windowed app that loads the bundled Eudonomia UI in its own WebView,
// plus a menubar tray for quick access and quit. Loading the UI in the app's own
// window. The WebView talks to Rust only through Tauri commands and events, so
// private activity data is never exposed through a local network port.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod activity;
mod blocking;
mod native;
mod output;

use activity::{
    ActivityState, DebugState, SessionConfig, SharedActivity, SharedDebug, SharedSession,
};
use native::NativeState;
use semver::Version;
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};

const MAIN_LABEL: &str = "main";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BundledBuildInfo {
    built_at: String,
}

fn bundled_build_timestamp() -> Option<i64> {
    let info: BundledBuildInfo =
        serde_json::from_str(include_str!("../../webui/build-info.json")).ok()?;
    chrono::DateTime::parse_from_rfc3339(&info.built_at)
        .ok()
        .map(|date| date.timestamp())
}

fn should_install_update(
    current_version: &Version,
    release_version: &Version,
    current_built_at: Option<i64>,
    release_published_at: Option<i64>,
) -> bool {
    if release_version <= current_version {
        return false;
    }

    match (current_built_at, release_published_at) {
        (Some(current), Some(release)) => release > current,
        _ => true,
    }
}

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
        let _ = window.emit(
            "window-lifecycle",
            serde_json::json!({
                "state": "visible",
                "reason": "reopen"
            }),
        );
    }
}

/// Native folder picker for output evidence. Returns the chosen path, or None
/// if the user cancelled. Only the path is returned — the companion reads
/// nothing from the folder until a session starts, and even then only metadata.
#[tauri::command]
async fn pick_output_folder(app: tauri::AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title("Choose the folder this session's work lives in")
        .pick_folder(move |picked| {
            let _ = tx.send(picked);
        });
    rx.await
        .ok()
        .flatten()
        .and_then(|p| p.into_path().ok())
        .map(|p| p.to_string_lossy().to_string())
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

    let current_build_timestamp = bundled_build_timestamp();

    tauri::Builder::default()
        .plugin(
            tauri_plugin_updater::Builder::new()
                .default_version_comparator(move |current, release| {
                    should_install_update(
                        &current,
                        &release.version,
                        current_build_timestamp,
                        release.pub_date.map(|date| date.unix_timestamp()),
                    )
                })
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            check_native_update,
            native::get_activity_status,
            native::get_companion_debug,
            native::get_companion_session,
            native::set_companion_session,
            native::install_blocking_helper,
            native::set_output_watch_folder,
            native::get_output_delta,
            pick_output_folder,
            install_native_update,
            quit_app
        ])
        .setup(move |app| {
            let native_state = NativeState {
                activity: state.clone(),
                session: session.clone(),
                debug: debug.clone(),
                companion_version: app.package_info().version.to_string(),
                // No folder is watched until the UI nominates one for a session.
                output_baseline: std::sync::Arc::new(std::sync::Mutex::new(None)),
            };

            app.manage(native_state.clone());
            activity::start_polling(native_state, app.handle().clone());

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
        .on_window_event(|window, event| {
            if window.label() != MAIN_LABEL {
                return;
            }
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // The session is held in the live WebView. Destroying it here
                // loses the timer and camera state, while the tray's later
                // show() cannot resurrect that WebView. Keep it alive, notify
                // React so it can pause and tear down the camera, then hide it.
                api.prevent_close();
                let _ = window.emit(
                    "window-lifecycle",
                    serde_json::json!({
                        "state": "hidden",
                        "reason": "close"
                    }),
                );
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running eudonomia");
}

#[cfg(test)]
mod update_tests {
    use super::should_install_update;
    use semver::Version;

    fn version(value: &str) -> Version {
        Version::parse(value).expect("valid test version")
    }

    #[test]
    fn rejects_a_higher_semver_published_before_the_current_ui() {
        assert!(!should_install_update(
            &version("0.1.2"),
            &version("0.1.10"),
            Some(200),
            Some(100),
        ));
    }

    #[test]
    fn accepts_a_higher_semver_published_after_the_current_ui() {
        assert!(should_install_update(
            &version("0.1.2"),
            &version("0.1.2608221200"),
            Some(100),
            Some(200),
        ));
    }

    #[test]
    fn never_accepts_a_lower_semver_even_with_a_newer_publish_date() {
        assert!(!should_install_update(
            &version("0.1.2608221200"),
            &version("0.1.10"),
            Some(100),
            Some(200),
        ));
    }

    #[test]
    fn falls_back_to_semver_when_publish_dates_are_unavailable() {
        assert!(should_install_update(
            &version("0.1.2"),
            &version("0.1.10"),
            None,
            None,
        ));
    }
}
