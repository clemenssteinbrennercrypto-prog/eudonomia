// AppleScript-based activity polling.
//
// Every 3 seconds we ask macOS which app is frontmost (and, if it's a known
// browser, which URL the active tab shows) and store the result in a shared
// ActivityState that the HTTP server exposes on /status.

use serde::Serialize;
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::Duration;

#[derive(Debug, Clone, Serialize, Default)]
pub struct ActivityState {
    pub app: String,
    pub window: String,
    pub url: Option<String>,
    pub domain: Option<String>,
    pub ts: u64,
}

pub type SharedActivity = Arc<Mutex<ActivityState>>;

const BROWSER_APPS: &[&str] = &[
    "Safari",
    "Google Chrome",
    "Arc",
    "Brave Browser",
    "Firefox",
];

fn run_osascript(script: &str) -> Option<String> {
    let output = Command::new("osascript")
        .arg("-e")
        .arg(script)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

fn frontmost_app_and_window() -> Option<(String, String)> {
    let script = r#"tell application "System Events"
  set frontApp to first process whose frontmost is true
  try
    set w to name of first window of frontApp
  on error
    set w to ""
  end try
  return (name of frontApp) & "|" & w
end tell"#;
    let raw = run_osascript(script)?;
    let mut parts = raw.splitn(2, '|');
    let app = parts.next().unwrap_or("").trim().to_string();
    let window = parts.next().unwrap_or("").trim().to_string();
    if app.is_empty() {
        None
    } else {
        Some((app, window))
    }
}

fn browser_url(app: &str) -> Option<String> {
    let script = match app {
        "Safari" => {
            r#"tell application "Safari"
  if (count of windows) > 0 then return URL of current tab of front window
  return ""
end tell"#
                .to_string()
        }
        // Chromium-family browsers all speak the same AppleScript dialect;
        // address each one by its own application name.
        "Google Chrome" | "Arc" | "Brave Browser" => format!(
            r#"tell application "{app}"
  if (count of windows) > 0 then return URL of active tab of front window
  return ""
end tell"#
        ),
        // Firefox has no AppleScript URL support — skip rather than error.
        _ => return None,
    };
    run_osascript(&script)
}

/// Extract a bare hostname ("youtube.com") from a URL string, without pulling
/// in a full URL-parsing dependency.
fn extract_domain(url: &str) -> Option<String> {
    let after_scheme = url.split("://").nth(1).unwrap_or(url);
    let host = after_scheme
        .split(['/', '?', '#'])
        .next()?
        .split('@')
        .last()? // strip userinfo if present
        .split(':')
        .next()?; // strip port
    let host = host.trim().trim_start_matches("www.").to_lowercase();
    if host.is_empty() {
        None
    } else {
        Some(host)
    }
}

fn now_ms() -> u64 {
    chrono::Utc::now().timestamp_millis().max(0) as u64
}

fn poll_once(state: &SharedActivity) {
    let Some((app, window)) = frontmost_app_and_window() else {
        return;
    };

    let url = if BROWSER_APPS.contains(&app.as_str()) {
        browser_url(&app).filter(|u| !u.is_empty())
    } else {
        None
    };
    let domain = url.as_deref().and_then(extract_domain);

    if let Ok(mut guard) = state.lock() {
        *guard = ActivityState {
            app,
            window,
            url,
            domain,
            ts: now_ms(),
        };
    }
}

/// Spawn the polling loop. AppleScript via `osascript` is blocking, so the
/// loop runs on a dedicated OS thread rather than a tokio task.
pub fn start_polling(state: SharedActivity) {
    std::thread::spawn(move || loop {
        poll_once(&state);
        std::thread::sleep(Duration::from_secs(3));
    });
}

#[cfg(test)]
mod tests {
    use super::extract_domain;

    #[test]
    fn extracts_plain_domain() {
        assert_eq!(
            extract_domain("https://www.youtube.com/watch?v=abc"),
            Some("youtube.com".into())
        );
    }

    #[test]
    fn handles_port_and_path() {
        assert_eq!(
            extract_domain("http://localhost:5173/app"),
            Some("localhost".into())
        );
    }

    #[test]
    fn empty_input_is_none() {
        assert_eq!(extract_domain(""), None);
    }
}
