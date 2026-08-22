use crate::activity::{now_ms, ActivityState, SharedActivity, SharedDebug, SharedSession};
use crate::output::{self, OutputDelta, OutputSnapshot};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

pub const ACTIVITY_UPDATED_EVENT: &str = "activity-updated";
pub const SESSION_STATE_CHANGED_EVENT: &str = "session-state-changed";

#[derive(Clone)]
pub struct NativeState {
    pub activity: SharedActivity,
    pub session: SharedSession,
    pub debug: SharedDebug,
    pub companion_version: String,
    pub output_baseline: Arc<Mutex<Option<OutputSnapshot>>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanionDebug {
    session_active: bool,
    session_state: String,
    session_end_ts: u64,
    session_updated_ts: u64,
    blocked_apps_count: usize,
    blocked_domains_count: usize,
    strict_mode: bool,
    allowed_apps_count: usize,
    last_poll_ts: u64,
    last_activity: ActivityState,
    last_osascript_error: Option<String>,
    permission_missing: Option<String>,
    host_block_active: bool,
    host_block_error: Option<String>,
    helper_installed: bool,
    companion_version: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanionSession {
    ok: bool,
    active: bool,
    session_active: bool,
    session_state: String,
    session_end_ts: u64,
    session_updated_ts: u64,
    received_at: u64,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct SessionPayload {
    active: bool,
    end_ts: u64,
    session_state: Option<String>,
    blocked_apps: Vec<String>,
    blocked_domains: Vec<String>,
    strict_mode: bool,
    allowed_apps: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationResult {
    ok: bool,
    error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputWatchResult {
    watched: bool,
    files: usize,
    truncated: bool,
    error: Option<String>,
}

fn normalized_session_state(primary: &str, fallback: &str, active: bool) -> String {
    if !primary.is_empty() {
        primary.to_string()
    } else if !fallback.is_empty() {
        fallback.to_string()
    } else if active {
        "active".to_string()
    } else {
        "inactive".to_string()
    }
}

fn debug_snapshot(state: &NativeState) -> CompanionDebug {
    let activity = state
        .activity
        .lock()
        .map(|guard| guard.clone())
        .unwrap_or_default();
    let debug = state
        .debug
        .lock()
        .map(|guard| guard.clone())
        .unwrap_or_default();
    let session = state
        .session
        .lock()
        .map(|guard| guard.clone())
        .unwrap_or_default();

    CompanionDebug {
        session_active: session.active,
        session_state: normalized_session_state(
            &session.state,
            &debug.session_state,
            session.active || debug.session_active,
        ),
        session_end_ts: session.end_ts,
        session_updated_ts: debug.session_updated_ts,
        blocked_apps_count: session.blocked_apps.len(),
        blocked_domains_count: session.blocked_domains.len(),
        strict_mode: session.strict_mode,
        allowed_apps_count: session.allowed_apps.len(),
        last_poll_ts: debug.last_poll_ts,
        last_activity: activity,
        last_osascript_error: debug.last_osascript_error,
        permission_missing: debug.permission_missing,
        host_block_active: debug.host_block_active,
        host_block_error: debug.host_block_error,
        helper_installed: crate::blocking::helper_available(),
        companion_version: state.companion_version.clone(),
    }
}

pub(crate) fn session_snapshot(state: &NativeState) -> CompanionSession {
    let session = state
        .session
        .lock()
        .map(|guard| guard.clone())
        .unwrap_or_default();
    let debug = state
        .debug
        .lock()
        .map(|guard| guard.clone())
        .unwrap_or_default();

    CompanionSession {
        ok: true,
        active: session.active,
        session_active: session.active,
        session_state: normalized_session_state(
            &session.state,
            &debug.session_state,
            session.active || debug.session_active,
        ),
        session_end_ts: session.end_ts,
        session_updated_ts: debug.session_updated_ts,
        received_at: 0,
    }
}

fn apply_session_payload(
    state: &NativeState,
    payload: SessionPayload,
    received_at: u64,
) -> CompanionSession {
    let active = payload.active && payload.end_ts > received_at;
    let requested_state = payload.session_state.as_deref().unwrap_or("");
    let session_state = if active {
        "active"
    } else if requested_state == "paused" {
        "paused"
    } else if requested_state == "ended" {
        "ended"
    } else {
        "inactive"
    };
    let end_ts = if active { payload.end_ts } else { 0 };
    let blocked_apps = if active {
        payload.blocked_apps
    } else {
        Vec::new()
    };
    let blocked_domains = if active {
        let mut seen = HashSet::new();
        payload
            .blocked_domains
            .into_iter()
            .filter_map(|domain| crate::blocking::normalize_host(&domain))
            .filter(|domain| seen.insert(domain.clone()))
            .collect()
    } else {
        Vec::new()
    };
    let strict_mode = active && payload.strict_mode;
    let allowed_apps = if active {
        payload.allowed_apps
    } else {
        Vec::new()
    };
    let blocked_apps_count = blocked_apps.len();
    let blocked_domains_count = blocked_domains.len();
    let allowed_apps_count = allowed_apps.len();

    let accepted = if let Ok(mut config) = state.session.lock() {
        // Preserve host_block_applied/applied_domains: they mirror real system
        // state and must survive repeated session updates.
        config.active = active;
        config.state = session_state.to_string();
        config.end_ts = end_ts;
        config.blocked_apps = blocked_apps;
        config.blocked_domains = blocked_domains;
        config.strict_mode = strict_mode;
        config.allowed_apps = allowed_apps;
        config.last_notify_ts = 0;
        true
    } else {
        false
    };

    if accepted {
        if let Ok(mut debug) = state.debug.lock() {
            debug.session_active = active;
            debug.session_state = session_state.to_string();
            debug.session_end_ts = end_ts;
            debug.session_updated_ts = received_at;
            debug.blocked_apps_count = blocked_apps_count;
            debug.blocked_domains_count = blocked_domains_count;
            debug.strict_mode = strict_mode;
            debug.allowed_apps_count = allowed_apps_count;
        }
    }

    CompanionSession {
        ok: accepted,
        active,
        session_active: active,
        session_state: session_state.to_string(),
        session_end_ts: end_ts,
        session_updated_ts: received_at,
        received_at,
    }
}

#[tauri::command]
pub fn get_activity_status(state: tauri::State<'_, NativeState>) -> ActivityState {
    state
        .activity
        .lock()
        .map(|guard| guard.clone())
        .unwrap_or_default()
}

#[tauri::command]
pub fn get_companion_debug(state: tauri::State<'_, NativeState>) -> CompanionDebug {
    debug_snapshot(&state)
}

#[tauri::command]
pub fn get_companion_session(state: tauri::State<'_, NativeState>) -> CompanionSession {
    session_snapshot(&state)
}

#[tauri::command]
pub fn set_companion_session(
    app: AppHandle,
    state: tauri::State<'_, NativeState>,
    payload: SessionPayload,
) -> CompanionSession {
    let session = apply_session_payload(&state, payload, now_ms());
    let _ = app.emit(SESSION_STATE_CHANGED_EVENT, &session);
    session
}

#[tauri::command]
pub async fn install_blocking_helper() -> OperationResult {
    let result = tauri::async_runtime::spawn_blocking(crate::blocking::install_helper).await;
    match result {
        Ok(Ok(())) => OperationResult {
            ok: true,
            error: None,
        },
        Ok(Err(error)) => OperationResult {
            ok: false,
            error: Some(error),
        },
        Err(error) => OperationResult {
            ok: false,
            error: Some(format!("join: {error}")),
        },
    }
}

#[tauri::command]
pub async fn set_output_watch_folder(
    state: tauri::State<'_, NativeState>,
    path: String,
) -> Result<OutputWatchResult, String> {
    let raw = path.trim().to_string();
    if raw.is_empty() {
        if let Ok(mut guard) = state.output_baseline.lock() {
            *guard = None;
        }
        return Ok(OutputWatchResult {
            watched: false,
            files: 0,
            truncated: false,
            error: None,
        });
    }

    let path = PathBuf::from(raw);
    if !path.is_dir() {
        return Ok(OutputWatchResult {
            watched: false,
            files: 0,
            truncated: false,
            error: Some("not a readable folder".to_string()),
        });
    }

    match tauri::async_runtime::spawn_blocking(move || output::snapshot(&path)).await {
        Ok(snapshot) => {
            let files = snapshot.files.len();
            let truncated = snapshot.truncated;
            if let Ok(mut guard) = state.output_baseline.lock() {
                *guard = Some(snapshot);
            }
            Ok(OutputWatchResult {
                watched: true,
                files,
                truncated,
                error: None,
            })
        }
        Err(error) => Ok(OutputWatchResult {
            watched: false,
            files: 0,
            truncated: false,
            error: Some(format!("scan failed: {error}")),
        }),
    }
}

#[tauri::command]
pub async fn get_output_delta(state: tauri::State<'_, NativeState>) -> Result<OutputDelta, String> {
    let baseline = state
        .output_baseline
        .lock()
        .ok()
        .and_then(|guard| guard.clone());

    let Some(baseline) = baseline else {
        return Ok(OutputDelta::default());
    };

    match tauri::async_runtime::spawn_blocking(move || output::delta(&baseline)).await {
        Ok(delta) => Ok(delta),
        Err(error) => Ok(OutputDelta {
            watched: true,
            error: Some(format!("scan failed: {error}")),
            ..Default::default()
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::{apply_session_payload, debug_snapshot, NativeState, SessionPayload};

    fn state() -> NativeState {
        NativeState {
            activity: Default::default(),
            session: Default::default(),
            debug: Default::default(),
            companion_version: "0.1.2608221200".to_string(),
            output_baseline: Default::default(),
        }
    }

    #[test]
    fn debug_reports_the_tauri_app_version_and_inactive_default() {
        let state = state();
        let value = serde_json::to_value(debug_snapshot(&state)).expect("serializable debug state");

        assert_eq!(value["companionVersion"], "0.1.2608221200");
        assert_eq!(value["sessionState"], "inactive");
        assert_eq!(value["sessionActive"], false);
    }

    #[test]
    fn expired_session_payload_cannot_activate_blocking() {
        let state = state();
        let response = apply_session_payload(
            &state,
            SessionPayload {
                active: true,
                end_ts: 99,
                blocked_apps: vec!["Discord".to_string()],
                blocked_domains: vec!["reddit.com".to_string()],
                strict_mode: true,
                allowed_apps: vec!["Code".to_string()],
                ..Default::default()
            },
            100,
        );

        let config = state.session.lock().expect("session state");
        assert!(!response.active);
        assert!(!config.active);
        assert!(config.blocked_apps.is_empty());
        assert!(config.blocked_domains.is_empty());
        assert!(!config.strict_mode);
        assert!(config.allowed_apps.is_empty());
    }

    #[test]
    fn active_session_normalizes_domains_without_losing_applied_host_state() {
        let state = state();
        {
            let mut config = state.session.lock().expect("session state");
            config.host_block_applied = true;
            config.applied_domains = vec!["old.example".to_string()];
        }

        let response = apply_session_payload(
            &state,
            SessionPayload {
                active: true,
                end_ts: 200,
                blocked_domains: vec![
                    "https://www.Reddit.com/r/all".to_string(),
                    "reddit.com".to_string(),
                ],
                ..Default::default()
            },
            100,
        );

        let config = state.session.lock().expect("session state");
        assert!(response.active);
        assert_eq!(config.blocked_domains, vec!["reddit.com"]);
        assert!(config.host_block_applied);
        assert_eq!(config.applied_domains, vec!["old.example"]);
    }
}
