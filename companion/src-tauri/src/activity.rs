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
    pub session_state: String,
    pub session_active: bool,
    pub session_end_ts: u64,
    pub session_updated_ts: u64,
    pub blocked_apps_count: usize,
    pub blocked_domains_count: usize,
    pub strict_mode: bool,
    pub allowed_apps_count: usize,
    /// True while an /etc/hosts block is actually in place.
    pub host_block_active: bool,
    /// Last error/cancellation from applying or clearing the hosts block
    /// (e.g. "cancelled" when the user dismissed the admin password dialog).
    pub host_block_error: Option<String>,
}

pub type SharedDebug = Arc<Mutex<DebugState>>;

/// Blocking configuration pushed by the bundled UI via POST /session.
/// While a session is active, blocked apps get hidden and blocked browser
/// domains get redirected away — enforcement lives in `enforce_blocking`.
#[derive(Debug, Clone, Default)]
pub struct SessionConfig {
    pub active: bool,
    pub state: String,
    pub end_ts: u64,
    pub blocked_apps: Vec<String>,
    pub blocked_domains: Vec<String>,
    /// Strict/allowlist mode: hide EVERY non-browser app except `allowed_apps`
    /// and the base system apps. When false, only `blocked_apps` are hidden.
    pub strict_mode: bool,
    pub allowed_apps: Vec<String>,
    /// Timestamp of the last user-facing block notification (throttling).
    pub last_notify_ts: u64,
    /// Whether an /etc/hosts block is currently applied, and for which domains.
    /// These track the real state of the file (not the requested config) so the
    /// reconcile loop only prompts for admin on an actual transition. A fresh
    /// POST /session must preserve these — never reset them blindly.
    pub host_block_applied: bool,
    pub applied_domains: Vec<String>,
}

pub type SharedSession = Arc<Mutex<SessionConfig>>;

/// Apps that must never be hidden in strict mode — hiding them would break the
/// Mac or the focus session itself. Browsers are handled separately (their
/// content is filtered via /etc/hosts, so they always stay visible). Matched
/// case-insensitively against the frontmost process name.
const BASE_APPS: &[&str] = &[
    "Finder",
    "System Settings",
    "System Preferences",
    "loginwindow",
    "Dock",
    "SystemUIServer",
    "Control Center",
    "Control Centre",
    "Notification Center",
    "NotificationCenter",
    "WindowServer",
    "Spotlight",
    "coreautha",
    "SecurityAgent",
    "UserNotificationCenter",
    "osascript",
    "Eudonomia Companion",
    "eudonomia-companion",
];

fn is_base_app(app_lc: &str) -> bool {
    BASE_APPS.iter().any(|b| b.to_lowercase() == app_lc)
}

/// Groups of names that refer to the same app. The frontmost process name from
/// System Events is often the short/binary name (e.g. "Code" for VS Code,
/// "Google Chrome" for a "Chrome" entry), not the friendly name a user types in
/// the Focus Apps list. Without this, strict mode would hide an allowed app —
/// e.g. add "VS Code" as a focus app, but the process is "Code", no match, hide.
/// Kept conservative: only well-known, unambiguous aliases (never "Electron",
/// which many apps share).
const APP_ALIASES: &[&[&str]] = &[
    &["vs code", "visual studio code", "code"],
    &["chrome", "google chrome"],
    &["brave", "brave browser"],
    &["edge", "microsoft edge"],
    &["intellij", "intellij idea", "idea"],
    &["word", "microsoft word"],
    &["excel", "microsoft excel"],
    &["powerpoint", "microsoft powerpoint"],
];

/// True if a user-entered app name refers to the given frontmost process name,
/// resolving common display-name ↔ process-name aliases.
fn app_name_matches(entry: &str, process_name_lc: &str) -> bool {
    let entry_lc = entry.trim().to_lowercase();
    if entry_lc == process_name_lc {
        return true;
    }
    APP_ALIASES.iter().any(|group| {
        group.contains(&entry_lc.as_str()) && group.contains(&process_name_lc)
    })
}

/// Decide whether the frontmost app should be hidden. Pure so it can be
/// unit-tested. `app_lc` is the lowercased frontmost process name.
fn should_hide_app(
    strict_mode: bool,
    app_lc: &str,
    is_browser: bool,
    allowed_apps: &[String],
    blocked_apps: &[String],
) -> bool {
    if strict_mode {
        // Browsers are never hidden (content filtered via hosts); base system
        // apps and explicitly-allowed apps stay; everything else is hidden.
        if is_browser || is_base_app(app_lc) {
            return false;
        }
        let allowed = allowed_apps
            .iter()
            .any(|a| app_name_matches(a, app_lc));
        !allowed
    } else {
        blocked_apps
            .iter()
            .any(|a| app_name_matches(a, app_lc))
    }
}

/// Failsafe, mirroring the browser extension's rule: if the web app dies
/// without clearing the session flag, blocking must stop on its own once the
/// planned session end (+ grace) has passed — never block indefinitely.
const BLOCK_GRACE_MS: u64 = 2 * 60 * 1000;
const BLOCK_NOTIFY_COOLDOWN_MS: u64 = 15_000;

const BROWSER_APPS: &[&str] = &["Safari", "Google Chrome", "Arc", "Brave Browser", "Firefox"];

fn run_osascript(
    script: &str,
    debug: &SharedDebug,
    permission_context: Option<&str>,
) -> Option<String> {
    let output = Command::new("osascript")
        .arg("-e")
        .arg(script)
        .output()
        .map_err(|e| {
            if let Ok(mut d) = debug.lock() {
                d.last_osascript_error = Some(format!("osascript: {e}"));
            }
        })
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
    let raw = run_osascript(script, debug, Some("System Events"))?;
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
        "Safari" => r#"tell application "Safari"
  if (count of windows) > 0 then return URL of current tab of front window
  return ""
end tell"#
            .to_string(),
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

/// Redirect the front tab of a browser away from a blocked domain. This is what
/// catches Brave/Chrome when they use DNS-over-HTTPS (Secure DNS), which bypasses
/// /etc/hosts entirely — so hosts blocking alone would miss them. Works by
/// reading + rewriting the active tab's URL via AppleScript, independent of DNS.
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
    Hide,
    Redirect,
}

/// Check the frontmost activity against the session's block lists and act.
/// Decisions happen under the lock; the (slow) osascript calls happen after
/// it is released.
fn enforce_blocking(session: &SharedSession, debug: &SharedDebug, app: &str, domain: Option<&str>) {
    let decision = {
        let Ok(mut cfg) = session.lock() else { return };
        if !cfg.active {
            return;
        }
        let now = now_ms();
        if cfg.end_ts == 0 || now > cfg.end_ts + BLOCK_GRACE_MS {
            // Stale session (web app gone without cleanup) — self-heal.
            cfg.active = false;
            cfg.state = "inactive".to_string();
            if let Ok(mut d) = debug.lock() {
                d.session_active = false;
                d.session_state = "inactive".to_string();
                d.session_end_ts = 0;
                d.session_updated_ts = now;
                d.blocked_apps_count = 0;
                d.blocked_domains_count = 0;
            }
            return;
        }

        let app_lc = app.trim().to_lowercase();
        let is_browser = BROWSER_APPS.iter().any(|b| b.to_lowercase() == app_lc);

        // Two independent block paths:
        //  1. Browser showing a blocked domain → redirect the tab. This is the
        //     belt to /etc/hosts's suspenders: browsers using DNS-over-HTTPS
        //     (Brave/Chrome "Secure DNS") bypass /etc/hosts, so hosts alone
        //     blocks some browsers but not others. Redirecting the tab catches
        //     every browser regardless of how it resolves DNS.
        //  2. Non-browser app that should be hidden (blocklist or strict mode).
        let domain_blocked = domain
            .map(|d| domain_is_blocked(d, &cfg.blocked_domains))
            .unwrap_or(false);

        let action = if is_browser && domain_blocked {
            Some((BlockAction::Redirect, domain.unwrap_or("").to_string()))
        } else if should_hide_app(
            cfg.strict_mode,
            &app_lc,
            is_browser,
            &cfg.allowed_apps,
            &cfg.blocked_apps,
        ) {
            Some((BlockAction::Hide, app.to_string()))
        } else {
            None
        };

        let (block_action, label) = match action {
            Some(a) => a,
            None => return,
        };
        let notify = now.saturating_sub(cfg.last_notify_ts) >= BLOCK_NOTIFY_COOLDOWN_MS;
        if notify {
            cfg.last_notify_ts = now;
        }
        (block_action, label, notify)
    };

    let (block_action, label, notify) = decision;
    match block_action {
        BlockAction::Hide => hide_app(app, debug),
        BlockAction::Redirect => redirect_browser_tab(app, debug),
    }
    if notify {
        notify_blocked(&label, debug);
    }
}

/// Bring the /etc/hosts block into agreement with the current session, applying
/// or clearing only on a real transition so admin is prompted at most once per
/// change — never per poll. This is Failsafe #2: a session that has expired
/// (`now > end_ts + grace`) or gone inactive gets its block cleared here even if
/// the web app never sent an explicit "session ended".
fn reconcile_host_blocking(session: &SharedSession, debug: &SharedDebug) {
    enum Action {
        Apply(Vec<String>),
        Clear,
    }

    let action = {
        let Ok(mut cfg) = session.lock() else { return };
        let now = now_ms();
        let expired = cfg.end_ts == 0 || now > cfg.end_ts + BLOCK_GRACE_MS;
        if cfg.active && expired {
            cfg.active = false;
            cfg.state = "inactive".to_string();
            cfg.strict_mode = false;
            cfg.blocked_apps.clear();
            cfg.blocked_domains.clear();
            cfg.allowed_apps.clear();
            if let Ok(mut d) = debug.lock() {
                d.session_active = false;
                d.session_state = "inactive".to_string();
                d.session_end_ts = 0;
                d.session_updated_ts = now;
                d.blocked_apps_count = 0;
                d.blocked_domains_count = 0;
                d.strict_mode = false;
                d.allowed_apps_count = 0;
            }
        }

        let mut valid_domains = Vec::new();
        let mut seen = std::collections::HashSet::new();
        for domain in &cfg.blocked_domains {
            if let Some(host) = crate::blocking::normalize_host(domain) {
                if seen.insert(host.clone()) {
                    valid_domains.push(host);
                }
            }
        }

        let want_block = cfg.active && !valid_domains.is_empty();

        if want_block {
            if !cfg.host_block_applied || valid_domains != cfg.applied_domains {
                Some(Action::Apply(valid_domains))
            } else {
                None
            }
        } else if cfg.host_block_applied {
            Some(Action::Clear)
        } else {
            None
        }
    };

    let Some(action) = action else { return };

    match action {
        Action::Apply(domains) => match crate::blocking::apply_block(&domains) {
            Ok(()) => {
                if let Ok(mut cfg) = session.lock() {
                    cfg.host_block_applied = true;
                    cfg.applied_domains = domains;
                }
                if let Ok(mut d) = debug.lock() {
                    d.host_block_active = true;
                    d.host_block_error = None;
                }
            }
            Err(e) => {
                if let Ok(mut d) = debug.lock() {
                    d.host_block_error = Some(e);
                }
            }
        },
        Action::Clear => match crate::blocking::clear_block() {
            Ok(()) => {
                if let Ok(mut cfg) = session.lock() {
                    cfg.host_block_applied = false;
                    cfg.applied_domains.clear();
                }
                if let Ok(mut d) = debug.lock() {
                    d.host_block_active = false;
                    d.host_block_error = None;
                }
            }
            Err(e) => {
                if let Ok(mut d) = debug.lock() {
                    d.host_block_error = Some(e);
                }
            }
        },
    }
}

fn poll_once(state: &SharedActivity, session: &SharedSession, debug: &SharedDebug) {
    let poll_ts = now_ms();
    if let Ok(mut d) = debug.lock() {
        d.last_poll_ts = poll_ts;
    }

    // Reconcile hosts blocking first, unconditionally: session start/end/expiry
    // cleanup must happen regardless of what (if anything) is frontmost.
    reconcile_host_blocking(session, debug);

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
    use super::{domain_is_blocked, extract_domain, should_hide_app};

    fn v(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn strict_mode_hides_unlisted_nonbrowser_apps() {
        let allowed = v(&["VS Code", "Notion"]);
        // Distraction app, not allowed → hidden.
        assert!(should_hide_app(true, "discord", false, &allowed, &[]));
        // Allowed app → stays.
        assert!(!should_hide_app(true, "vs code", false, &allowed, &[]));
        // Browser → never hidden (content filtered via hosts).
        assert!(!should_hide_app(true, "google chrome", true, &allowed, &[]));
        // Base system app → never hidden, even if unlisted.
        assert!(!should_hide_app(true, "finder", false, &allowed, &[]));
        assert!(!should_hide_app(
            true,
            "system settings",
            false,
            &allowed,
            &[]
        ));
        // The companion itself → never hidden.
        assert!(!should_hide_app(
            true,
            "eudonomia companion",
            false,
            &allowed,
            &[]
        ));
    }

    #[test]
    fn strict_mode_resolves_display_name_aliases() {
        // The real bug: System Events reports VS Code's process as "Code", but
        // the user added the friendly "VS Code" preset. It must NOT be hidden.
        let allowed = v(&["VS Code", "Notion"]);
        assert!(!should_hide_app(true, "code", false, &allowed, &[]));
        // A different unlisted app is still hidden.
        assert!(should_hide_app(true, "slack", false, &allowed, &[]));
        // Blocklist mode resolves aliases too: blocking "VS Code" hides "Code".
        let blocked = v(&["VS Code"]);
        assert!(should_hide_app(false, "code", false, &[], &blocked));
    }

    #[test]
    fn blocklist_mode_hides_only_listed_apps() {
        let blocked = v(&["Discord", "Slack"]);
        assert!(should_hide_app(false, "discord", false, &[], &blocked));
        assert!(!should_hide_app(false, "vs code", false, &[], &blocked));
        // In blocklist mode a browser CAN be hidden if the user lists it.
        let blocked_browser = v(&["Safari"]);
        assert!(should_hide_app(
            false,
            "safari",
            true,
            &[],
            &blocked_browser
        ));
    }

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
