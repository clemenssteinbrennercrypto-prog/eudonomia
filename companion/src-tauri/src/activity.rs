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

#[derive(Debug, Clone, Serialize, Default)]
pub struct DebugState {
    pub last_osascript_error: Option<String>,
    pub permission_missing: Option<String>,
    pub last_poll_ts: u64,
    pub session_active: bool,
    pub session_end_ts: u64,
    pub blocked_apps_count: usize,
    pub blocked_domains_count: usize,
}

pub type SharedDebug = Arc<Mutex<DebugState>>;

/// Blocking configuration pushed by the Eudonomia web app via POST /session.
/// While a session is active, blocked apps get hidden and blocked browser
/// domains get redirected away — enforcement lives in `enforce_blocking`.
#[derive(Debug, Clone, Default)]
pub struct SessionConfig {
    pub active: bool,
    pub end_ts: u64,
    pub blocked_apps: Vec<String>,
    pub blocked_domains: Vec<String>,
    /// Timestamp of the last user-facing block notification (throttling).
    pub last_notify_ts: u64,
}

pub type SharedSession = Arc<Mutex<SessionConfig>>;

/// Failsafe, mirroring the browser extension's rule: if the web app dies
/// without clearing the session flag, blocking must stop on its own once the
/// planned session end (+ grace) has passed — never block indefinitely.
const BLOCK_GRACE_MS: u64 = 2 * 60 * 1000;
const BLOCK_NOTIFY_COOLDOWN_MS: u64 = 15_000;

const BROWSER_APPS: &[&str] = &[
    "Safari",
    "Google Chrome",
    "Arc",
    "Brave Browser",
    "Firefox",
];

fn run_osascript(
    script: &str,
    debug: &SharedDebug,
    permission_context: Option<&str>,
) -> Option<String> {
    let output = Command::new("osascript")
        .arg("-e")
        .arg(script)
        .output()
        .ok()?;
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if !output.status.success() {
        if let Ok(mut d) = debug.lock() {
            d.last_osascript_error = Some(stderr.clone());
            if stderr.contains("-1743") || stderr.contains("1743") {
                d.permission_missing = Some(
                    permission_context
                        .unwrap_or("Browser (check Automation permissions)")
                        .to_string(),
                );
            }
        }
        return None;
    }
    if let Ok(mut d) = debug.lock() {
        d.last_osascript_error = None;
        if permission_context.is_some() {
            d.permission_missing = None;
        }
    }
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

fn frontmost_app_and_window(debug: &SharedDebug) -> Option<(String, String)> {
    let script = r#"tell application "System Events"
  set frontApp to first process whose frontmost is true
  try
    set w to name of first window of frontApp
  on error
    set w to ""
  end try
  return (name of frontApp) & "|" & w
end tell"#;
    let raw = run_osascript(script, debug, None)?;
    let mut parts = raw.splitn(2, '|');
    let app = parts.next().unwrap_or("").trim().to_string();
    let window = parts.next().unwrap_or("").trim().to_string();
    if app.is_empty() {
        None
    } else {
        Some((app, window))
    }
}

fn browser_url(app: &str, debug: &SharedDebug) -> Option<String> {
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
    run_osascript(&script, debug, Some(app))
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

pub fn now_ms() -> u64 {
    chrono::Utc::now().timestamp_millis().max(0) as u64
}

// ── Blocking enforcement ──────────────────────────────────────────────────────

fn escape_applescript(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

/// Hide a blocked app via System Events. Hiding (not quitting) is deliberate:
/// no unsaved-work loss, and macOS returns focus to the previous app.
fn hide_app(app: &str, debug: &SharedDebug) {
    let esc = escape_applescript(app);
    let script =
        format!(r#"tell application "System Events" to set visible of process "{esc}" to false"#);
    let _ = run_osascript(&script, debug, None);
}

/// Redirect the front tab of a blocked browser page away from the distraction.
fn redirect_browser_tab(app: &str, debug: &SharedDebug) {
    let script = match app {
        "Safari" => {
            r#"tell application "Safari" to set URL of current tab of front window to "about:blank""#
                .to_string()
        }
        "Google Chrome" | "Arc" | "Brave Browser" => {
            let esc = escape_applescript(app);
            format!(
                r#"tell application "{esc}" to set URL of active tab of front window to "about:blank""#
            )
        }
        _ => return,
    };
    let _ = run_osascript(&script, debug, Some(app));
}

fn notify_blocked(label: &str, debug: &SharedDebug) {
    let esc = escape_applescript(label);
    let script = format!(
        r#"display notification "{esc} is blocked during your focus session" with title "Eudonomia""#
    );
    let _ = run_osascript(&script, debug, None);
}

fn normalize_domain_entry(entry: &str) -> Option<String> {
    let trimmed = entry.trim().to_lowercase();
    if trimmed.is_empty() {
        return None;
    }
    if trimmed.contains("://") {
        return extract_domain(&trimmed);
    }
    let host = trimmed
        .trim_start_matches("www.")
        .split(['/', '?', '#'])
        .next()?
        .to_string();
    if host.is_empty() {
        None
    } else {
        Some(host)
    }
}

fn domain_is_blocked(domain: &str, blocked: &[String]) -> bool {
    let d = domain.trim_start_matches("www.").to_lowercase();
    blocked
        .iter()
        .filter_map(|entry| normalize_domain_entry(entry))
        .any(|b| d == b || d.ends_with(&format!(".{b}")))
}

enum BlockAction {
    HideApp,
    RedirectTab,
}

/// Check the frontmost activity against the session's block lists and act.
/// Decisions happen under the lock; the (slow) osascript calls happen after
/// it is released.
fn enforce_blocking(
    session: &SharedSession,
    debug: &SharedDebug,
    app: &str,
    domain: Option<&str>,
) {
    let decision = {
        let Ok(mut cfg) = session.lock() else { return };
        if !cfg.active {
            return;
        }
        let now = now_ms();
        if cfg.end_ts == 0 || now > cfg.end_ts + BLOCK_GRACE_MS {
            // Stale session (web app gone without cleanup) — self-heal.
            cfg.active = false;
            if let Ok(mut d) = debug.lock() {
                d.session_active = false;
                d.session_end_ts = 0;
                d.blocked_apps_count = 0;
                d.blocked_domains_count = 0;
            }
            return;
        }

        let app_lc = app.trim().to_lowercase();
        let app_blocked = cfg
            .blocked_apps
            .iter()
            .any(|a| a.trim().to_lowercase() == app_lc);
        let domain_blocked = domain
            .map(|d| domain_is_blocked(d, &cfg.blocked_domains))
            .unwrap_or(false);

        let (action, label) = if app_blocked {
            (BlockAction::HideApp, app.to_string())
        } else if domain_blocked {
            (BlockAction::RedirectTab, domain.unwrap_or("").to_string())
        } else {
            return;
        };

        let notify = now.saturating_sub(cfg.last_notify_ts) >= BLOCK_NOTIFY_COOLDOWN_MS;
        if notify {
            cfg.last_notify_ts = now;
        }
        (action, label, notify)
    };

    let (action, label, notify) = decision;
    match action {
        BlockAction::HideApp => hide_app(app, debug),
        BlockAction::RedirectTab => redirect_browser_tab(app, debug),
    }
    if notify {
        notify_blocked(&label, debug);
    }
}

fn poll_once(state: &SharedActivity, session: &SharedSession, debug: &SharedDebug) {
    let poll_ts = now_ms();
    if let Ok(mut d) = debug.lock() {
        d.last_poll_ts = poll_ts;
    }

    let Some((app, window)) = frontmost_app_and_window(debug) else {
        return;
    };

    let url = if BROWSER_APPS.contains(&app.as_str()) {
        browser_url(&app, debug).filter(|u| !u.is_empty())
    } else {
        None
    };
    let domain = url.as_deref().and_then(extract_domain);

    enforce_blocking(session, debug, &app, domain.as_deref());

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
pub fn start_polling(state: SharedActivity, session: SharedSession, debug: SharedDebug) {
    std::thread::spawn(move || loop {
        poll_once(&state, &session, &debug);
        std::thread::sleep(Duration::from_secs(3));
    });
}

#[cfg(test)]
mod tests {
    use super::{domain_is_blocked, extract_domain};

    #[test]
    fn blocks_exact_and_subdomains() {
        let blocked = vec!["youtube.com".to_string()];
        assert!(domain_is_blocked("youtube.com", &blocked));
        assert!(domain_is_blocked("www.youtube.com", &blocked));
        assert!(domain_is_blocked("m.youtube.com", &blocked));
        assert!(!domain_is_blocked("notyoutube.com", &blocked));
    }

    #[test]
    fn blocked_entries_may_be_urls_or_hosts() {
        let blocked = vec![
            "https://www.reddit.com/r/all".to_string(),
            "  X.com  ".to_string(),
        ];
        assert!(domain_is_blocked("reddit.com", &blocked));
        assert!(domain_is_blocked("x.com", &blocked));
        assert!(!domain_is_blocked("example.com", &blocked));
    }

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
