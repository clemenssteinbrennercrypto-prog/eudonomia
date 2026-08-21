// Axum HTTP server on localhost:7331.
//
// GET  /status  — current frontmost app/tab (polled by the bundled UI)
// POST /output/watch  — nominate a project folder; snapshots it as the baseline
// GET  /output/delta  — what changed in that folder since the baseline
//                       (metadata only: sizes, names, git counts — never content)
// POST /session — session + blocking config pushed by the bundled UI on session
//                 start/end (and re-pushed periodically as a keepalive)
//
// CORS is wide open (localhost bind only) for local development and the
// Companion WebView.

use crate::activity::{now_ms, SharedActivity, SharedDebug, SharedSession};
use crate::output::{self, OutputSnapshot};
use axum::{
    extract::State,
    http::{header, HeaderValue, Method, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

const PORT: u16 = 7331;

#[derive(Clone)]
pub struct AppState {
    pub activity: SharedActivity,
    pub session: SharedSession,
    pub debug: SharedDebug,
    /// Version from Tauri's merged runtime config. This is the version the
    /// updater compares, which can intentionally differ from Cargo.toml.
    pub companion_version: String,
    /// Opening snapshot of the watched project folder, if the user nominated
    /// one for this session. None means output evidence is simply off.
    pub output_baseline: Arc<Mutex<Option<OutputSnapshot>>>,
}

fn with_cors(mut response: Response) -> Response {
    let headers = response.headers_mut();
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_ORIGIN,
        HeaderValue::from_static("*"),
    );
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static("GET, POST, OPTIONS"),
    );
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_HEADERS,
        HeaderValue::from_static("Content-Type"),
    );
    // Chrome/Brave "Private Network Access": a public HTTPS page fetching a
    // localhost service triggers a preflight demanding this header, else the
    // request is blocked. Without it the web app reports "Companion not found"
    // in those browsers even though the server is up.
    headers.insert(
        "Access-Control-Allow-Private-Network",
        HeaderValue::from_static("true"),
    );
    response
}

async fn preflight() -> Response {
    with_cors(StatusCode::OK.into_response())
}

async fn status(State(state): State<AppState>, method: Method) -> Response {
    if method == Method::OPTIONS {
        return preflight().await;
    }

    let body = state
        .activity
        .lock()
        .map(|guard| serde_json::to_string(&*guard).unwrap_or_else(|_| "{}".into()))
        .unwrap_or_else(|_| "{}".into());

    let response = (
        StatusCode::OK,
        [(header::CONTENT_TYPE, "application/json")],
        body,
    )
        .into_response();
    with_cors(response)
}

async fn debug(State(state): State<AppState>, method: Method) -> Response {
    if method == Method::OPTIONS {
        return preflight().await;
    }

    let body = debug_body(&state);

    let response = (
        StatusCode::OK,
        [(header::CONTENT_TYPE, "application/json")],
        body,
    )
        .into_response();
    with_cors(response)
}

fn debug_body(state: &AppState) -> String {
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
    let session_state = if !session.state.is_empty() {
        session.state.as_str()
    } else if !debug.session_state.is_empty() {
        debug.session_state.as_str()
    } else if session.active || debug.session_active {
        "active"
    } else {
        "inactive"
    };
    let session_active = session.active;
    let session_end_ts = session.end_ts;

    serde_json::json!({
        "sessionActive": session_active,
        "sessionState": session_state,
        "sessionEndTs": session_end_ts,
        "sessionUpdatedTs": debug.session_updated_ts,
        "blockedAppsCount": session.blocked_apps.len(),
        "blockedDomainsCount": session.blocked_domains.len(),
        "strictMode": session.strict_mode,
        "allowedAppsCount": session.allowed_apps.len(),
        "lastPollTs": debug.last_poll_ts,
        "lastActivity": {
            "app": activity.app,
            "window": activity.window,
            "url": activity.url,
            "domain": activity.domain,
            "ts": activity.ts,
        },
        "lastOsascriptError": debug.last_osascript_error,
        "permissionMissing": debug.permission_missing,
        "hostBlockActive": debug.host_block_active,
        "hostBlockError": debug.host_block_error,
        "helperInstalled": crate::blocking::helper_available(),
        "companionVersion": state.companion_version,
    })
    .to_string()
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct SessionPayload {
    active: bool,
    end_ts: u64,
    session_state: Option<String>,
    blocked_apps: Vec<String>,
    blocked_domains: Vec<String>,
    strict_mode: bool,
    allowed_apps: Vec<String>,
}

async fn session(State(state): State<AppState>, Json(payload): Json<SessionPayload>) -> Response {
    let received_at = now_ms();
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
        let mut seen = std::collections::HashSet::new();
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

    let accepted = if let Ok(mut cfg) = state.session.lock() {
        // Update the requested config, but PRESERVE host_block_applied /
        // applied_domains — those track the real /etc/hosts state, and the
        // reconcile loop decides when to (un)apply from them. Overwriting them
        // here would make reconcile re-prompt for admin on every keepalive push.
        cfg.active = active;
        cfg.state = session_state.to_string();
        cfg.end_ts = end_ts;
        cfg.blocked_apps = blocked_apps;
        cfg.blocked_domains = blocked_domains;
        cfg.strict_mode = strict_mode;
        cfg.allowed_apps = allowed_apps;
        // Allow an immediate app-hide notification after a fresh push.
        cfg.last_notify_ts = 0;
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

    let body = serde_json::json!({
        "ok": accepted,
        "active": active,
        "sessionActive": active,
        "sessionState": session_state,
        "sessionEndTs": end_ts,
        "sessionUpdatedTs": received_at,
        "receivedAt": received_at,
    })
    .to_string();

    let response = (
        StatusCode::OK,
        [(header::CONTENT_TYPE, "application/json")],
        body,
    )
        .into_response();
    with_cors(response)
}

/// One-time install of the zero-prompt helper. Runs on a blocking thread
/// because it shows a modal admin dialog. Triggered by a deliberate user action
/// in the UI, so the single password prompt is expected.
async fn install_helper() -> Response {
    let result = tokio::task::spawn_blocking(crate::blocking::install_helper)
        .await
        .unwrap_or_else(|e| Err(format!("join: {e}")));

    let body = match &result {
        Ok(()) => serde_json::json!({ "ok": true }).to_string(),
        Err(e) => serde_json::json!({ "ok": false, "error": e }).to_string(),
    };
    let response = (
        StatusCode::OK,
        [(header::CONTENT_TYPE, "application/json")],
        body,
    )
        .into_response();
    with_cors(response)
}

async fn uninstall_helper() -> Response {
    let result = tokio::task::spawn_blocking(crate::blocking::uninstall_helper)
        .await
        .unwrap_or_else(|e| Err(format!("join: {e}")));
    let body = match &result {
        Ok(()) => serde_json::json!({ "ok": true }).to_string(),
        Err(e) => serde_json::json!({ "ok": false, "error": e }).to_string(),
    };
    let response = (
        StatusCode::OK,
        [(header::CONTENT_TYPE, "application/json")],
        body,
    )
        .into_response();
    with_cors(response)
}

fn router(state: AppState) -> Router {
#[derive(Deserialize)]
struct WatchPayload {
    path: String,
}

/// Nominate a folder and record its opening state. Scanning happens on a
/// blocking thread — a large project would otherwise stall the async runtime
/// that is also serving /status every three seconds.
async fn output_watch(State(state): State<AppState>, Json(payload): Json<WatchPayload>) -> Response {
    let raw = payload.path.trim().to_string();
    if raw.is_empty() {
        if let Ok(mut guard) = state.output_baseline.lock() {
            *guard = None; // empty path = stop watching
        }
        return with_cors(json_ok("{\"watched\":false}"));
    }

    let path = PathBuf::from(&raw);
    if !path.is_dir() {
        return with_cors(
            (
                StatusCode::BAD_REQUEST,
                [(header::CONTENT_TYPE, "application/json")],
                "{\"error\":\"not a readable folder\"}",
            )
                .into_response(),
        );
    }

    let snap = tokio::task::spawn_blocking(move || output::snapshot(&path))
        .await
        .ok();

    let body = match snap {
        Some(snap) => {
            let files = snap.files.len();
            let truncated = snap.truncated;
            if let Ok(mut guard) = state.output_baseline.lock() {
                *guard = Some(snap);
            }
            format!(
                "{{\"watched\":true,\"files\":{},\"truncated\":{}}}",
                files, truncated
            )
        }
        None => "{\"watched\":false,\"error\":\"scan failed\"}".to_string(),
    };
    with_cors(json_ok(&body))
}

async fn output_delta(State(state): State<AppState>, method: Method) -> Response {
    if method == Method::OPTIONS {
        return preflight().await;
    }
    let base = state
        .output_baseline
        .lock()
        .ok()
        .and_then(|guard| guard.clone());

    let body = match base {
        None => "{\"watched\":false}".to_string(),
        Some(base) => {
            let delta = tokio::task::spawn_blocking(move || output::delta(&base))
                .await
                .ok();
            delta
                .and_then(|d| serde_json::to_string(&d).ok())
                .unwrap_or_else(|| "{\"watched\":true,\"error\":\"scan failed\"}".into())
        }
    };
    with_cors(json_ok(&body))
}

fn json_ok(body: &str) -> Response {
    (
        StatusCode::OK,
        [(header::CONTENT_TYPE, "application/json")],
        body.to_string(),
    )
        .into_response()
}


    Router::new()
        .route("/output/watch", post(output_watch).options(preflight))
        .route("/output/delta", get(output_delta).options(output_delta))
        .route("/status", get(status).options(status))
        .route("/debug", get(debug).options(debug))
        .route("/session", post(session).options(preflight))
        .route("/install-helper", post(install_helper).options(preflight))
        .route(
            "/uninstall-helper",
            post(uninstall_helper).options(preflight),
        )
        .with_state(state)
}

async fn serve_on(addr: SocketAddr, app: Router) {
    match tokio::net::TcpListener::bind(addr).await {
        Ok(listener) => {
            eprintln!("eudonomia-companion: serving http://{addr}/status");
            if let Err(err) = axum::serve(listener, app).await {
                eprintln!("eudonomia-companion: server error on {addr}: {err}");
            }
        }
        Err(err) => {
            // A failed bind on one stack (or a port already taken by the old
            // Python daemon) must not kill the tray app — the other listener
            // may still succeed. Just log.
            eprintln!("eudonomia-companion: cannot bind {addr}: {err}");
        }
    }
}

pub async fn run(state: AppState) {
    // Bind BOTH IPv4 and IPv6 localhost. macOS often resolves `localhost` to
    // ::1 first; a browser hitting http://localhost:7331 would then fail if we
    // only bound 127.0.0.1. Serving both makes the companion reachable however
    // `localhost` resolves. Bind is localhost-only — never exposed off-machine.
    let v4 = SocketAddr::from(([127, 0, 0, 1], PORT));
    let v6 = SocketAddr::from((std::net::Ipv6Addr::LOCALHOST, PORT));
    tokio::join!(
        serve_on(v4, router(state.clone())),
        serve_on(v6, router(state)),
    );
}

#[cfg(test)]
mod tests {
    use super::{debug_body, AppState};

    #[test]
    fn debug_reports_the_tauri_app_version() {
        let state = AppState {
            activity: Default::default(),
            session: Default::default(),
            debug: Default::default(),
            companion_version: "0.1.2608221200".to_string(),
            output_baseline: Default::default(),
        };

        let body: serde_json::Value =
            serde_json::from_str(&debug_body(&state)).expect("valid debug JSON");

        assert_eq!(body["companionVersion"], "0.1.2608221200");
    }
}
