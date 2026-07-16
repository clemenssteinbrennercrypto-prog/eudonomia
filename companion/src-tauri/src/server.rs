// Axum HTTP server on localhost:7331.
//
// GET  /status  — current frontmost app/tab (polled by the Eudonomia web app)
// POST /session — session + blocking config pushed by the web app on session
//                 start/end (and re-pushed periodically as a keepalive)
//
// CORS is wide open (localhost bind only) so the Vercel-hosted app can talk
// to us from the browser.

use crate::activity::{now_ms, SharedActivity, SharedDebug, SharedSession};
use axum::{
    extract::State,
    http::{header, HeaderValue, Method, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use std::net::SocketAddr;

const PORT: u16 = 7331;

#[derive(Clone)]
pub struct AppState {
    pub activity: SharedActivity,
    pub session: SharedSession,
    pub debug: SharedDebug,
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

    let activity = state.activity.lock().map(|guard| guard.clone()).unwrap_or_default();
    let debug = state.debug.lock().map(|guard| guard.clone()).unwrap_or_default();

    let body = serde_json::json!({
        "sessionActive": debug.session_active,
        "sessionEndTs": debug.session_end_ts,
        "blockedAppsCount": debug.blocked_apps_count,
        "blockedDomainsCount": debug.blocked_domains_count,
        "strictMode": debug.strict_mode,
        "allowedAppsCount": debug.allowed_apps_count,
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
        "companionVersion": env!("CARGO_PKG_VERSION"),
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

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct SessionPayload {
    active: bool,
    end_ts: u64,
    blocked_apps: Vec<String>,
    blocked_domains: Vec<String>,
    strict_mode: bool,
    allowed_apps: Vec<String>,
}

async fn session(State(state): State<AppState>, Json(payload): Json<SessionPayload>) -> Response {
    let active = payload.active;
    let end_ts = payload.end_ts;
    let blocked_apps_count = payload.blocked_apps.len();
    let blocked_domains_count = payload.blocked_domains.len();
    let strict_mode = payload.strict_mode;
    let allowed_apps_count = payload.allowed_apps.len();

    let accepted = if let Ok(mut cfg) = state.session.lock() {
        // Update the requested config, but PRESERVE host_block_applied /
        // applied_domains — those track the real /etc/hosts state, and the
        // reconcile loop decides when to (un)apply from them. Overwriting them
        // here would make reconcile re-prompt for admin on every keepalive push.
        cfg.active = active;
        cfg.end_ts = end_ts;
        cfg.blocked_apps = payload.blocked_apps;
        cfg.blocked_domains = payload.blocked_domains;
        cfg.strict_mode = payload.strict_mode;
        cfg.allowed_apps = payload.allowed_apps;
        // Allow an immediate app-hide notification after a fresh push.
        cfg.last_notify_ts = 0;
        true
    } else {
        false
    };

    if accepted {
        if let Ok(mut debug) = state.debug.lock() {
            debug.session_active = active;
            debug.session_end_ts = end_ts;
            debug.blocked_apps_count = blocked_apps_count;
            debug.blocked_domains_count = blocked_domains_count;
            debug.strict_mode = strict_mode;
            debug.allowed_apps_count = allowed_apps_count;
        }
    }

    let body = serde_json::json!({
        "ok": accepted,
        "receivedAt": now_ms(),
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
    Router::new()
        .route("/status", get(status).options(status))
        .route("/debug", get(debug).options(debug))
        .route("/session", post(session).options(preflight))
        .route("/install-helper", post(install_helper).options(preflight))
        .route("/uninstall-helper", post(uninstall_helper).options(preflight))
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
