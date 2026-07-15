// Axum HTTP server on localhost:7331.
//
// GET  /status  — current frontmost app/tab (polled by the Eudonomia web app)
// POST /session — session + blocking config pushed by the web app on session
//                 start/end (and re-pushed periodically as a keepalive)
//
// CORS is wide open (localhost bind only) so the Vercel-hosted app can talk
// to us from the browser.

use crate::activity::{now_ms, SessionConfig, SharedActivity, SharedSession};
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

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct SessionPayload {
    active: bool,
    end_ts: u64,
    blocked_apps: Vec<String>,
    blocked_domains: Vec<String>,
}

async fn session(State(state): State<AppState>, Json(payload): Json<SessionPayload>) -> Response {
    let accepted = if let Ok(mut cfg) = state.session.lock() {
        *cfg = SessionConfig {
            active: payload.active,
            end_ts: payload.end_ts,
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
