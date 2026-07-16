// System-wide website blocking via /etc/hosts.
//
// This is the one macOS mechanism that blocks a domain in *every* browser and
// app at once, with no per-browser Automation permission. The trade-off is that
// editing /etc/hosts needs admin rights.
//
// Safety design:
//   * All the "which lines go in the file" logic is pure and unit-tested here.
//   * The privileged step is only a `cp` of a fully-formed file into place plus
//     a DNS-cache flush — the smallest possible thing to run as root.
//   * Everything Eudonomia writes lives between START/END markers, so we can
//     always strip exactly our block and never touch the user's own entries.
//   * The caller wires up a triple failsafe (startup cleanup, session-end
//     cleanup, and an expiry watchdog) so a crash can never leave sites blocked
//     forever — see activity.rs / main.rs.

use std::io::Write;
use std::process::Command;

const HOSTS_PATH: &str = "/etc/hosts";
const START_MARKER: &str = "# EUDONOMIA_START — focus session block (auto-managed, safe to delete)";
const END_MARKER: &str = "# EUDONOMIA_END";

/// Remove any existing Eudonomia block (between the markers, inclusive),
/// leaving the rest of the file untouched. Idempotent.
pub fn strip_eudonomia_block(content: &str) -> String {
    let mut out = Vec::new();
    let mut skipping = false;
    for line in content.lines() {
        let trimmed = line.trim_end();
        if trimmed == START_MARKER {
            skipping = true;
            continue;
        }
        if trimmed == END_MARKER {
            skipping = false;
            continue;
        }
        if !skipping {
            out.push(line);
        }
    }
    let mut result = out.join("\n");
    // Preserve a single trailing newline (hosts files conventionally end in one).
    if !result.ends_with('\n') {
        result.push('\n');
    }
    result
}

/// Normalize a user-entered domain/URL down to a bare host ("youtube.com").
/// Returns None for anything that isn't a usable hostname.
pub fn normalize_host(entry: &str) -> Option<String> {
    let mut s = entry.trim().to_lowercase();
    if s.is_empty() {
        return None;
    }
    if let Some(idx) = s.find("://") {
        s = s[idx + 3..].to_string();
    }
    // Drop path/query/fragment and any port or credentials.
    let host = s
        .split(['/', '?', '#'])
        .next()
        .unwrap_or("")
        .rsplit('@')
        .next()
        .unwrap_or("")
        .split(':')
        .next()
        .unwrap_or("")
        .trim_start_matches("www.")
        .trim_matches('.')
        .to_string();
    // Must look like a domain (contain a dot, no spaces).
    if host.contains('.') && !host.contains(' ') {
        Some(host)
    } else {
        None
    }
}

/// Build the full hosts-file content with a fresh Eudonomia block appended for
/// the given domains. Each domain is blocked for both the bare and www. form,
/// over IPv4 and IPv6. Deduplicated; input order preserved.
pub fn build_hosts_with_block(content: &str, domains: &[String]) -> String {
    let base = strip_eudonomia_block(content);

    let mut hosts: Vec<String> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for d in domains {
        if let Some(h) = normalize_host(d) {
            if seen.insert(h.clone()) {
                hosts.push(h);
            }
        }
    }
    if hosts.is_empty() {
        return base;
    }

    let mut result = base;
    if !result.ends_with('\n') {
        result.push('\n');
    }
    result.push_str(START_MARKER);
    result.push('\n');
    for h in &hosts {
        result.push_str(&format!("127.0.0.1\t{h}\n"));
        result.push_str(&format!("127.0.0.1\twww.{h}\n"));
        result.push_str(&format!("::1\t{h}\n"));
        result.push_str(&format!("::1\twww.{h}\n"));
    }
    result.push_str(END_MARKER);
    result.push('\n');
    result
}

/// Read the current /etc/hosts (readable without admin).
pub fn read_hosts() -> std::io::Result<String> {
    std::fs::read_to_string(HOSTS_PATH)
}

/// True if the file currently contains an Eudonomia block.
pub fn hosts_has_block() -> bool {
    read_hosts()
        .map(|c| c.contains(START_MARKER))
        .unwrap_or(false)
}

/// Write `new_content` to /etc/hosts using one admin-privileged copy, then flush
/// the DNS cache so the change takes effect immediately. Shows exactly one macOS
/// password dialog. Returns Err with a short reason on failure/cancel.
fn write_hosts_via_admin(new_content: &str) -> Result<(), String> {
    // Stage the fully-formed file in a user-owned temp path; the privileged
    // step only moves it into place and flushes DNS — nothing user-controlled
    // is interpolated into the shell beyond this fixed temp path.
    let mut tmp = std::env::temp_dir();
    tmp.push("eudonomia-hosts.staged");
    {
        let mut f = std::fs::File::create(&tmp).map_err(|e| format!("temp write: {e}"))?;
        f.write_all(new_content.as_bytes())
            .map_err(|e| format!("temp write: {e}"))?;
    }
    let tmp_str = tmp.to_string_lossy().replace('"', "");

    let shell = format!(
        "cp '{tmp_str}' {HOSTS_PATH} && dscacheutil -flushcache; killall -HUP mDNSResponder"
    );
    let apple = format!(
        r#"do shell script "{}" with administrator privileges"#,
        shell.replace('\\', "\\\\").replace('"', "\\\"")
    );

    let output = Command::new("osascript")
        .arg("-e")
        .arg(&apple)
        .output()
        .map_err(|e| format!("osascript: {e}"))?;

    let _ = std::fs::remove_file(&tmp);

    if output.status.success() {
        Ok(())
    } else {
        let err = String::from_utf8_lossy(&output.stderr);
        if err.contains("-128") {
            Err("cancelled".into()) // user dismissed the password dialog
        } else {
            Err(err.trim().to_string())
        }
    }
}

/// Apply a block for `domains`. No-op (and no prompt) if the resulting file
/// would be identical to what's already there.
pub fn apply_block(domains: &[String]) -> Result<(), String> {
    let current = read_hosts().map_err(|e| format!("read hosts: {e}"))?;
    let desired = build_hosts_with_block(&current, domains);
    if desired == current {
        return Ok(());
    }
    write_hosts_via_admin(&desired)
}

/// Remove the Eudonomia block entirely. No-op (and no prompt) if none present.
pub fn clear_block() -> Result<(), String> {
    let current = read_hosts().map_err(|e| format!("read hosts: {e}"))?;
    if !current.contains(START_MARKER) {
        return Ok(());
    }
    let desired = strip_eudonomia_block(&current);
    write_hosts_via_admin(&desired)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "127.0.0.1\tlocalhost\n255.255.255.255\tbroadcasthost\n::1\tlocalhost\n";

    #[test]
    fn normalize_various_forms() {
        assert_eq!(normalize_host("instagram.com"), Some("instagram.com".into()));
        assert_eq!(normalize_host("https://www.YouTube.com/watch?v=x"), Some("youtube.com".into()));
        assert_eq!(normalize_host("  reddit.com/r/all  "), Some("reddit.com".into()));
        assert_eq!(normalize_host("localhost"), None); // no dot
        assert_eq!(normalize_host(""), None);
        assert_eq!(normalize_host("Instagram"), None); // app name, not a domain
    }

    #[test]
    fn build_and_strip_roundtrip() {
        let blocked = build_hosts_with_block(SAMPLE, &["instagram.com".into()]);
        assert!(blocked.contains("127.0.0.1\tinstagram.com"));
        assert!(blocked.contains("127.0.0.1\twww.instagram.com"));
        assert!(blocked.contains("::1\tinstagram.com"));
        assert!(blocked.contains(START_MARKER));
        // Stripping returns the original file exactly.
        assert_eq!(strip_eudonomia_block(&blocked), SAMPLE);
    }

    #[test]
    fn reapplying_replaces_not_stacks() {
        let once = build_hosts_with_block(SAMPLE, &["instagram.com".into()]);
        let twice = build_hosts_with_block(&once, &["reddit.com".into()]);
        // Old block gone, new block present, exactly one block.
        assert!(!twice.contains("instagram.com"));
        assert!(twice.contains("reddit.com"));
        assert_eq!(twice.matches(START_MARKER).count(), 1);
    }

    #[test]
    fn empty_domains_leaves_file_clean() {
        let out = build_hosts_with_block(SAMPLE, &[]);
        assert_eq!(out, SAMPLE);
        assert!(!out.contains(START_MARKER));
    }

    #[test]
    fn dedupes_and_preserves_user_entries() {
        let out = build_hosts_with_block(
            SAMPLE,
            &["youtube.com".into(), "www.youtube.com".into(), "youtube.com".into()],
        );
        assert_eq!(out.matches("127.0.0.1\tyoutube.com\n").count(), 1);
        assert!(out.contains("127.0.0.1\tlocalhost")); // user entry intact
    }
}
