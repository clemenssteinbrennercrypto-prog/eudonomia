// Axum HTTP server on localhost:7331.
//
// GET  /status  — current frontmost app/tab (polled by the Eudonomia web app)
// POST /session — session + blocking config pushed by the web app on session
//                 start/end (and re-pushed periodically as a keepalive)
//
// CORS is wide open (localhost bind only) so the Vercel-hosted app can talk
// to us from the browser.

use crate::activity::{now_ms, SessionConfig, SharedActivity, SharedDebug, SharedSession};
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
}

async fn session(State(state): State<AppState>, Json(payload): Json<SessionPayload>) -> Response {
    let active = payload.active;
    let end_ts = payload.end_ts;
    let blocked_apps_count = payload.blocked_apps.len();
    let blocked_domains_count = payload.blocked_domains.len();

    let accepted = if let Ok(mut cfg) = state.session.lock() {
        *cfg = SessionConfig {
            active,
            end_ts,
            blocked_apps: payload.blocked_apps,
            blocked_domains: payload.blocked_domains,
            // Preserve nothing across pushes: a fresh push may immediately
            // block the current app, so allow an immediate notification.
            last_notify_ts: 0,
        };
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

pub async fn run(state: AppState) {
    let app = Router::new()
        .route("/status", get(status).options(status))
        .route("/debug", get(debug).options(debug))
        .route("/session", post(session).options(preflight))
        .with_state(state);

    let addr = SocketAddr::from(([127, 0, 0, 1], PORT));
    match tokio::net::TcpListener::bind(addr).await {
        Ok(listener) => {
            eprintln!("eudonomia-companion: serving http://localhost:{PORT}/status");
            if let Err(err) = axum::serve(listener, app).await {
                eprintln!("eudonomia-companion: server error: {err}");
            }
        }
        Err(err) => {
            // Port already taken (e.g. the old Python daemon) — log and keep
            // the tray app alive rather than crashing.
            eprintln!("eudonomia-companion: cannot bind port {PORT}: {err}");
        }
    }
}
