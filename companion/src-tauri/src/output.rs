// Output evidence — did the work actually move?
//
// The focus score says how attentive someone was. It cannot say whether
// anything came of it: a session spent rapt on the wrong file scores the same
// as one that finished the chapter. This module supplies the missing half.
//
// PRIVACY, non-negotiable: this reads metadata only — sizes, timestamps, names,
// git counts. It never opens a file, never reads content, never logs keystrokes.
// If a signal cannot be had from `stat`, it is not gathered.

use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

/// Depth and count caps. A project folder is the intended target; someone
/// pointing this at their home directory should get a truncated answer rather
/// than a hung companion.
const MAX_DEPTH: usize = 6;
const MAX_FILES: usize = 20_000;

/// Directories that are never the user's work: build output, dependencies and
/// VCS internals. Walking them is slow and their churn is noise, not progress.
const SKIP_DIRS: &[&str] = &[
    ".git", ".hg", ".svn", "node_modules", "target", "dist", "build", "out",
    ".next", ".nuxt", ".venv", "venv", "__pycache__", ".cache", ".DS_Store",
    "Library", "vendor", ".gradle", ".idea",
];

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn mtime_secs(meta: &fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// A point-in-time picture of a folder: which files exist, how big, last touched.
#[derive(Clone, Debug, Default)]
pub struct OutputSnapshot {
    pub root: PathBuf,
    pub taken_at: u64,
    /// relative path -> (size, mtime)
    pub files: HashMap<PathBuf, (u64, u64)>,
    pub truncated: bool,
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct OutputDelta {
    pub watched: bool,
    pub root: String,
    #[serde(rename = "elapsedSecs")]
    pub elapsed_secs: u64,
    #[serde(rename = "filesChanged")]
    pub files_changed: usize,
    #[serde(rename = "filesCreated")]
    pub files_created: usize,
    #[serde(rename = "bytesAdded")]
    pub bytes_added: i64,
    /// File names only, capped. Never paths outside the watched root, never
    /// contents. Enough to say "thesis_intro.docx grew", nothing more.
    #[serde(rename = "changedNames")]
    pub changed_names: Vec<String>,
    pub commits: usize,
    #[serde(rename = "linesAdded")]
    pub lines_added: u64,
    #[serde(rename = "linesRemoved")]
    pub lines_removed: u64,
    pub truncated: bool,
    pub error: Option<String>,
}

fn should_skip_dir(name: &str) -> bool {
    name.starts_with('.') && name != "." || SKIP_DIRS.iter().any(|s| s.eq_ignore_ascii_case(name))
}

/// Walk the folder recording (size, mtime) per file. Symlinks are not followed:
/// a loop would hang the walk, and a link out of the folder is not the user's
/// work by definition.
fn walk(root: &Path) -> (HashMap<PathBuf, (u64, u64)>, bool) {
    let mut files = HashMap::new();
    let mut truncated = false;
    let mut stack: Vec<(PathBuf, usize)> = vec![(root.to_path_buf(), 0)];

    while let Some((dir, depth)) = stack.pop() {
        if depth > MAX_DEPTH {
            truncated = true;
            continue;
        }
        let entries = match fs::read_dir(&dir) {
            Ok(e) => e,
            Err(_) => continue, // unreadable subfolder is not fatal
        };
        for entry in entries.flatten() {
            if files.len() >= MAX_FILES {
                truncated = true;
                return (files, truncated);
            }
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            // symlink_metadata: describes the link itself, so links are never traversed
            let meta = match fs::symlink_metadata(&path) {
                Ok(m) => m,
                Err(_) => continue,
            };
            if meta.file_type().is_symlink() {
                continue;
            }
            if meta.is_dir() {
                if !should_skip_dir(&name) {
                    stack.push((path, depth + 1));
                }
            } else if meta.is_file() {
                let rel = path.strip_prefix(root).unwrap_or(&path).to_path_buf();
                files.insert(rel, (meta.len(), mtime_secs(&meta)));
            }
        }
    }
    (files, truncated)
}

pub fn snapshot(root: &Path) -> OutputSnapshot {
    let (files, truncated) = walk(root);
    OutputSnapshot {
        root: root.to_path_buf(),
        taken_at: now_secs(),
        files,
        truncated,
    }
}

/// Commits and line counts since the session began. Reads git's own summary —
/// message bodies and diffs are never touched.
fn git_stats(root: &Path, since: u64) -> Option<(usize, u64, u64)> {
    if !root.join(".git").exists() {
        return None;
    }
    let since_arg = format!("@{}", since);

    let count = Command::new("git")
        .args(["-C", root.to_str()?, "log", "--since", &since_arg, "--oneline"])
        .output()
        .ok()?;
    let commits = String::from_utf8_lossy(&count.stdout).lines().count();
    if commits == 0 {
        return Some((0, 0, 0));
    }

    // --shortstat gives "N files changed, A insertions(+), D deletions(-)"
    let stat = Command::new("git")
        .args(["-C", root.to_str()?, "log", "--since", &since_arg, "--shortstat", "--format="])
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&stat.stdout);
    let mut added = 0u64;
    let mut removed = 0u64;
    for line in text.lines() {
        for part in line.split(',') {
            let part = part.trim();
            let n: u64 = part
                .split_whitespace()
                .next()
                .and_then(|v| v.parse().ok())
                .unwrap_or(0);
            if part.contains("insertion") {
                added += n;
            } else if part.contains("deletion") {
                removed += n;
            }
        }
    }
    Some((commits, added, removed))
}

/// Compare the folder against the session's opening snapshot.
pub fn delta(base: &OutputSnapshot) -> OutputDelta {
    let root = &base.root;
    if !root.is_dir() {
        return OutputDelta {
            watched: true,
            root: root.to_string_lossy().to_string(),
            error: Some("watched folder is no longer readable".into()),
            ..Default::default()
        };
    }

    let (now_files, truncated) = walk(root);
    let mut files_changed = 0usize;
    let mut files_created = 0usize;
    let mut bytes_added: i64 = 0;
    let mut changed_names: Vec<String> = Vec::new();

    for (rel, (size, mtime)) in &now_files {
        match base.files.get(rel) {
            None => {
                files_created += 1;
                bytes_added += *size as i64;
                if changed_names.len() < 12 {
                    changed_names.push(rel.to_string_lossy().to_string());
                }
            }
            Some((old_size, old_mtime)) => {
                if mtime > old_mtime || size != old_size {
                    files_changed += 1;
                    bytes_added += *size as i64 - *old_size as i64;
                    if changed_names.len() < 12 {
                        changed_names.push(rel.to_string_lossy().to_string());
                    }
                }
            }
        }
    }
    // Deleted files count as movement too, and shrink the byte delta.
    for (rel, (old_size, _)) in &base.files {
        if !now_files.contains_key(rel) {
            files_changed += 1;
            bytes_added -= *old_size as i64;
        }
    }

    let (commits, lines_added, lines_removed) =
        git_stats(root, base.taken_at).unwrap_or((0, 0, 0));

    OutputDelta {
        watched: true,
        root: root.to_string_lossy().to_string(),
        elapsed_secs: now_secs().saturating_sub(base.taken_at),
        files_changed,
        files_created,
        bytes_added,
        changed_names,
        commits,
        lines_added,
        lines_removed,
        truncated: truncated || base.truncated,
        error: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn skips_build_and_vcs_directories() {
        assert!(should_skip_dir("node_modules"));
        assert!(should_skip_dir(".git"));
        assert!(should_skip_dir("target"));
        assert!(!should_skip_dir("src"));
        assert!(!should_skip_dir("thesis"));
    }

    #[test]
    fn detects_a_created_file_and_its_bytes() {
        let dir = std::env::temp_dir().join(format!("eud_out_{}", now_secs()));
        fs::create_dir_all(&dir).unwrap();
        let base = snapshot(&dir);

        fs::write(dir.join("chapter.txt"), "hello world").unwrap();
        let d = delta(&base);

        assert_eq!(d.files_created, 1);
        assert_eq!(d.bytes_added, 11);
        assert!(d.changed_names.iter().any(|n| n == "chapter.txt"));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_shrinking_file_reports_negative_bytes() {
        let dir = std::env::temp_dir().join(format!("eud_out_s_{}", now_secs()));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("draft.txt"), "aaaaaaaaaa").unwrap();
        let base = snapshot(&dir);

        fs::write(dir.join("draft.txt"), "aa").unwrap();
        let d = delta(&base);

        assert_eq!(d.files_changed, 1);
        assert!(d.bytes_added < 0, "deleting text must not read as progress");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn counts_commits_and_lines_made_during_the_session() {
        let dir = std::env::temp_dir().join(format!("eud_out_git_{}", now_secs()));
        fs::create_dir_all(&dir).unwrap();
        let git = |args: &[&str]| {
            Command::new("git")
                .args(["-C", dir.to_str().unwrap()])
                .args(args)
                .output()
                .expect("git available")
        };
        git(&["init", "-q"]);
        git(&["config", "user.email", "t@t.t"]);
        git(&["config", "user.name", "t"]);

        // A commit from before the session must NOT be counted as this session's work.
        fs::write(dir.join("old.txt"), "before\n").unwrap();
        git(&["add", "-A"]);
        git(&["commit", "-qm", "before the session"]);

        std::thread::sleep(std::time::Duration::from_millis(1100));
        let base = snapshot(&dir);
        std::thread::sleep(std::time::Duration::from_millis(1100));

        fs::write(dir.join("new.txt"), "one\ntwo\nthree\n").unwrap();
        git(&["add", "-A"]);
        git(&["commit", "-qm", "during the session"]);

        let d = delta(&base);
        assert_eq!(d.commits, 1, "only the in-session commit counts");
        assert_eq!(d.lines_added, 3);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_folder_without_git_still_reports_file_evidence() {
        let dir = std::env::temp_dir().join(format!("eud_out_nogit_{}", now_secs()));
        fs::create_dir_all(&dir).unwrap();
        let base = snapshot(&dir);
        fs::write(dir.join("notes.md"), "abc").unwrap();

        let d = delta(&base);
        assert_eq!(d.commits, 0);
        assert_eq!(d.files_created, 1, "git is optional, files are not");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn an_untouched_folder_reports_nothing() {
        let dir = std::env::temp_dir().join(format!("eud_out_q_{}", now_secs()));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("a.txt"), "x").unwrap();
        let base = snapshot(&dir);

        let d = delta(&base);
        assert_eq!(d.files_changed, 0);
        assert_eq!(d.files_created, 0);
        assert_eq!(d.bytes_added, 0);
        fs::remove_dir_all(&dir).ok();
    }
}
