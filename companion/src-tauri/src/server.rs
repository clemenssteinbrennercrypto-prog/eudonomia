// Axum HTTP server exposing the current activity on localhost:7331.
//
// The Eudonomia web app polls GET /status every few seconds. CORS is wide
// open (GET only, no credentials, localhost bind) so the Vercel-hosted app
// can read it from the browser.

use crate::activity::SharedActivity;
use axum::{
    extract::State,
    http::{header, HeaderValue, Method, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Router,
};
use std::net::SocketAddr;

const PORT: u16 = 7331;

fn with_cors(mut response: Response) -> Response {
    let headers = response.headers_mut();
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_ORIGIN,
        HeaderValue::from_static("*"),
    );
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static("GET, OPTIONS"),
    );
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_HEADERS,
        HeaderValue::from_static("Content-Type"),
    );
    response
}

async fn status(State(state): State<SharedActivity>, method: Method) -> Response {
    if method == Method::OPTIONS {
        return with_cors(StatusCode::OK.into_response());
    }

    let body = state
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

pub async fn run(state: SharedActivity) {
    let app = Router::new()
        .route("/status", get(status).options(status))
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
