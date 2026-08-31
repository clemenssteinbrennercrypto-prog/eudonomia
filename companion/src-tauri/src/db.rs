// Durable session storage.
//
// The web build keeps history in localStorage, which caps out around 5 MB and
// therefore drops everything past the newest 100 sessions. Per-second timelines
// are most of that weight, so the cap bites quickly. This module is the native
// answer: a real SQLite file in the app data directory, holding the complete
// history indefinitely.
//
// ── Division of labour, deliberately lopsided ───────────────────────────────
//
// Rust stores; JavaScript decides. Every value that requires product knowledge
// — whether a session counts as measured, what its focus contribution is, how
// an outcome normalizes — is computed on the JS side and handed here as data.
// This module never re-derives any of it.
//
// That is not laziness. Focus Metric V1 and the attention scoring rules live in
// focusMetric.js with their versioning and their refusals; a second, drifting
// implementation on this side of the language boundary is exactly the class of
// bug the project's invariants warn about. So: sessions arrive with a
// pre-computed `summary` for the indexed columns and a pre-computed ledger day,
// and SQLite's only job is to write them atomically and hand them back.
//
// The one exception is deleting a session's ledger contribution, which is
// referential cleanup (drop this id, drop the day if it empties) rather than
// scoring, and is safe to do here.

use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::sync::Mutex;

/// Bumping this triggers `migrate()` on next open. Add a new arm there; never
/// edit an existing one, or already-shipped databases will skip the change.
const SCHEMA_VERSION: i64 = 1;

const MIGRATION_STATUS_KEY: &str = "legacy_migration_status";
const MIGRATION_COUNTS_KEY: &str = "legacy_migration_counts";
const MIGRATION_DONE: &str = "completed";

pub struct DbState(pub Mutex<Connection>);

/// Lenient number parsing for the indexed columns.
///
/// These come from a live JavaScript accumulator that adds elapsed time in
/// fractions, so `focusedSeconds` is routinely something like
/// 92.59400000000004 rather than 93. Declaring them as plain integers made
/// serde reject the payload outright — which meant a real history could not be
/// imported at all, while a test fixture full of round numbers passed happily.
///
/// These columns exist only to filter and sort on; the exact original value is
/// preserved verbatim in `record_json` either way. So anything numeric is
/// accepted and rounded, and anything else degrades to zero rather than
/// failing the whole import.
mod lenient {
    use serde::{Deserialize, Deserializer};
    use serde_json::Value;

    pub fn i64<'de, D: Deserializer<'de>>(deserializer: D) -> Result<i64, D::Error> {
        Ok(Value::deserialize(deserializer)?
            .as_f64()
            .map(|value| value.round() as i64)
            .unwrap_or(0))
    }

    pub fn opt_i64<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Option<i64>, D::Error> {
        Ok(Value::deserialize(deserializer)?
            .as_f64()
            .map(|value| value.round() as i64))
    }
}

/// The indexed columns behind a session, computed by the JS repository so the
/// two adapters cannot disagree about what a filter means. See sessionQuery.js
/// for the semantics each of these fields feeds.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SessionSummary {
    pub id: String,
    #[serde(deserialize_with = "lenient::i64")]
    pub timestamp: i64,
    pub task: String,
    pub goal: String,
    #[serde(deserialize_with = "lenient::i64")]
    pub actual_seconds: i64,
    #[serde(deserialize_with = "lenient::opt_i64")]
    pub focused_seconds: Option<i64>,
    #[serde(deserialize_with = "lenient::opt_i64")]
    pub measured_seconds: Option<i64>,
    #[serde(deserialize_with = "lenient::i64")]
    pub distraction_events: i64,
    /// Normalized to yes/partly/no by JS, or absent when never rated.
    pub goal_outcome: Option<String>,
    pub workspace_id: Option<String>,
    #[serde(deserialize_with = "lenient::opt_i64")]
    pub workspace_revision: Option<i64>,
    pub workspace_name: Option<String>,
    pub energy_level: Option<String>,
    pub completed: bool,
    /// Whether focus was genuinely measured — `hasMeasuredFocus` on the JS side.
    pub measured: bool,
    pub tags: Vec<String>,
    /// Lowercased task + tags, so a LIKE here matches what the JS filter does.
    pub search_text: String,
}

/// Filters for a summary listing. Dates arrive as an absolute epoch bound
/// rather than a range name: the JS side already knows the user's timezone and
/// what "this month" means there, and re-deriving that in Rust would be a
/// second calendar implementation to keep in step.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SummaryQuery {
    pub date_from: Option<i64>,
    pub date_to: Option<i64>,
    /// "yes" | "partly" | "no" | "unrated" | absent for all.
    pub outcome: Option<String>,
    pub workspace_id: Option<String>,
    /// "measured" | "unmeasured" | absent for all.
    pub measurement: Option<String>,
    pub search: Option<String>,
    pub page: Option<i64>,
    pub page_size: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SummaryPage {
    pub rows: Vec<Value>,
    pub total: i64,
    pub page: i64,
    pub page_size: i64,
    pub page_count: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationOutcome {
    pub migrated: bool,
    pub imported_count: i64,
    pub skipped_duplicate_count: i64,
    pub verified: bool,
    pub reason: Option<String>,
}

fn to_err(error: impl std::fmt::Display) -> String {
    error.to_string()
}

// ── Schema ──────────────────────────────────────────────────────────────────

pub fn open(path: &std::path::Path) -> Result<Connection, String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(to_err)?;
    }
    let connection = Connection::open(path).map_err(to_err)?;
    prepare(&connection)?;
    Ok(connection)
}

/// Create the schema if absent and run any pending migration. Idempotent, so
/// it runs on every open.
pub fn prepare(connection: &Connection) -> Result<(), String> {
    // Durability over raw speed: a focus session is minutes of the user's life,
    // and WAL keeps a crash from taking the most recent one with it.
    connection
        .pragma_update(None, "journal_mode", "WAL")
        .map_err(to_err)?;
    connection
        .pragma_update(None, "foreign_keys", "ON")
        .map_err(to_err)?;

    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS schema_meta (
                 key   TEXT PRIMARY KEY,
                 value TEXT NOT NULL
             );

             CREATE TABLE IF NOT EXISTS sessions (
                 id                 TEXT PRIMARY KEY,
                 timestamp          INTEGER NOT NULL,
                 record_json        TEXT NOT NULL,
                 timeline_json      TEXT NOT NULL,
                 analysis_json      TEXT,
                 analysis_version   INTEGER,
                 task               TEXT NOT NULL DEFAULT '',
                 goal               TEXT NOT NULL DEFAULT '',
                 actual_seconds     INTEGER NOT NULL DEFAULT 0,
                 focused_seconds    INTEGER,
                 measured_seconds   INTEGER,
                 distraction_events INTEGER NOT NULL DEFAULT 0,
                 goal_outcome       TEXT,
                 workspace_id       TEXT,
                 workspace_revision INTEGER,
                 workspace_name     TEXT,
                 energy_level       TEXT,
                 completed          INTEGER NOT NULL DEFAULT 0,
                 measured           INTEGER NOT NULL DEFAULT 0,
                 tags_json          TEXT NOT NULL DEFAULT '[]',
                 search_text        TEXT NOT NULL DEFAULT ''
             );

             CREATE INDEX IF NOT EXISTS idx_sessions_timestamp ON sessions(timestamp DESC);
             CREATE INDEX IF NOT EXISTS idx_sessions_outcome   ON sessions(goal_outcome);
             CREATE INDEX IF NOT EXISTS idx_sessions_workspace ON sessions(workspace_id, workspace_revision);

             CREATE TABLE IF NOT EXISTS focus_ledger_days (
                 day_key    TEXT PRIMARY KEY,
                 entry_json TEXT NOT NULL
             );",
        )
        .map_err(to_err)?;

    migrate(connection)
}

fn migrate(connection: &Connection) -> Result<(), String> {
    let current: i64 = connection
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(to_err)?;
    if current >= SCHEMA_VERSION {
        return Ok(());
    }
    // Version 1 is the base schema created above; later versions add their
    // ALTER TABLE steps here, each gated on the version it upgrades from.
    connection
        .pragma_update(None, "user_version", SCHEMA_VERSION)
        .map_err(to_err)?;
    Ok(())
}

fn meta_get(connection: &Connection, key: &str) -> Result<Option<String>, String> {
    connection
        .query_row(
            "SELECT value FROM schema_meta WHERE key = ?1",
            params![key],
            |row| row.get(0),
        )
        .optional()
        .map_err(to_err)
}

fn meta_set(tx: &Transaction<'_>, key: &str, value: &str) -> Result<(), String> {
    tx.execute(
        "INSERT INTO schema_meta (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )
    .map_err(to_err)?;
    Ok(())
}

// ── Writing ─────────────────────────────────────────────────────────────────

/// Split the heavy timeline out of the record. A list view draws none of it,
/// and it is the bulk of a session's bytes, so summaries must never carry it.
fn split_timeline(session: &Value) -> (Value, Value) {
    let mut record = session.clone();
    let timeline = record
        .get_mut("timeline")
        .map(|slot| slot.take())
        .unwrap_or(Value::Array(vec![]));
    if let Some(object) = record.as_object_mut() {
        object.remove("timeline");
    }
    (record, timeline)
}

fn write_session(
    tx: &Transaction<'_>,
    session: &Value,
    summary: &SessionSummary,
    analysis: Option<&Value>,
) -> Result<(), String> {
    let (record, timeline) = split_timeline(session);
    tx.execute(
        "INSERT INTO sessions (
             id, timestamp, record_json, timeline_json, analysis_json, analysis_version,
             task, goal, actual_seconds, focused_seconds, measured_seconds,
             distraction_events, goal_outcome, workspace_id, workspace_revision,
             workspace_name, energy_level, completed, measured, tags_json, search_text
         ) VALUES (
             ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11,
             ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21
         )
         ON CONFLICT(id) DO UPDATE SET
             timestamp = excluded.timestamp,
             record_json = excluded.record_json,
             timeline_json = excluded.timeline_json,
             analysis_json = excluded.analysis_json,
             analysis_version = excluded.analysis_version,
             task = excluded.task,
             goal = excluded.goal,
             actual_seconds = excluded.actual_seconds,
             focused_seconds = excluded.focused_seconds,
             measured_seconds = excluded.measured_seconds,
             distraction_events = excluded.distraction_events,
             goal_outcome = excluded.goal_outcome,
             workspace_id = excluded.workspace_id,
             workspace_revision = excluded.workspace_revision,
             workspace_name = excluded.workspace_name,
             energy_level = excluded.energy_level,
             completed = excluded.completed,
             measured = excluded.measured,
             tags_json = excluded.tags_json,
             search_text = excluded.search_text",
        params![
            summary.id,
            summary.timestamp,
            serde_json::to_string(&record).map_err(to_err)?,
            serde_json::to_string(&timeline).map_err(to_err)?,
            analysis
                .map(|value| serde_json::to_string(value))
                .transpose()
                .map_err(to_err)?,
            analysis.and_then(|value| value.get("version")).and_then(Value::as_i64),
            summary.task,
            summary.goal,
            summary.actual_seconds,
            summary.focused_seconds,
            summary.measured_seconds,
            summary.distraction_events,
            summary.goal_outcome,
            summary.workspace_id,
            summary.workspace_revision,
            summary.workspace_name,
            summary.energy_level,
            summary.completed as i64,
            summary.measured as i64,
            serde_json::to_string(&summary.tags).map_err(to_err)?,
            summary.search_text.to_lowercase(),
        ],
    )
    .map_err(to_err)?;
    Ok(())
}

/// Upsert one day of the focus ledger. `entry` is the day object as
/// focusMetric.js produced it: `{ sessions: { <id>: contribution } }`.
fn write_ledger_day(tx: &Transaction<'_>, day_key: &str, entry: &Value) -> Result<(), String> {
    tx.execute(
        "INSERT INTO focus_ledger_days (day_key, entry_json) VALUES (?1, ?2)
         ON CONFLICT(day_key) DO UPDATE SET entry_json = excluded.entry_json",
        params![day_key, serde_json::to_string(entry).map_err(to_err)?],
    )
    .map_err(to_err)?;
    Ok(())
}

/// Drop a session's ledger contribution wherever it sits, removing the day
/// entirely once it holds nothing else. Mirrors removeSessionFromFocusLedger.
fn drop_ledger_contribution(tx: &Transaction<'_>, session_id: &str) -> Result<(), String> {
    let days: Vec<(String, String)> = {
        let mut statement = tx
            .prepare("SELECT day_key, entry_json FROM focus_ledger_days")
            .map_err(to_err)?;
        let rows = statement
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(to_err)?;
        rows.collect::<Result<_, _>>().map_err(to_err)?
    };

    for (day_key, entry_json) in days {
        let Ok(mut entry) = serde_json::from_str::<Value>(&entry_json) else {
            continue;
        };
        let removed = entry
            .get_mut("sessions")
            .and_then(Value::as_object_mut)
            .map(|sessions| sessions.remove(session_id).is_some())
            .unwrap_or(false);
        if !removed {
            continue;
        }
        let empty = entry
            .get("sessions")
            .and_then(Value::as_object)
            .map(Map::is_empty)
            .unwrap_or(true);
        if empty {
            tx.execute(
                "DELETE FROM focus_ledger_days WHERE day_key = ?1",
                params![day_key],
            )
            .map_err(to_err)?;
        } else {
            write_ledger_day(tx, &day_key, &entry)?;
        }
    }
    Ok(())
}

// ── Reading ─────────────────────────────────────────────────────────────────

fn row_record(row: &rusqlite::Row<'_>, with_timeline: bool) -> rusqlite::Result<Value> {
    let record_json: String = row.get("record_json")?;
    let mut record: Value = serde_json::from_str(&record_json).unwrap_or_else(|_| json!({}));

    if with_timeline {
        let timeline_json: String = row.get("timeline_json")?;
        let timeline: Value =
            serde_json::from_str(&timeline_json).unwrap_or_else(|_| Value::Array(vec![]));
        if let Some(object) = record.as_object_mut() {
            object.insert("timeline".into(), timeline);
        }
    }

    if let Some(object) = record.as_object_mut() {
        let analysis: Option<String> = row.get("analysis_json")?;
        if let Some(analysis) = analysis.and_then(|raw| serde_json::from_str::<Value>(&raw).ok()) {
            object.insert("analysisSnapshot".into(), analysis);
        }
    }
    Ok(record)
}

fn load_ledger(connection: &Connection) -> Result<Value, String> {
    let mut statement = connection
        .prepare("SELECT day_key, entry_json FROM focus_ledger_days")
        .map_err(to_err)?;
    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(to_err)?;

    let mut days = Map::new();
    for row in rows {
        let (day_key, entry_json) = row.map_err(to_err)?;
        if let Ok(entry) = serde_json::from_str::<Value>(&entry_json) {
            days.insert(day_key, entry);
        }
    }
    Ok(json!({ "schemaVersion": 1, "days": days }))
}

/// Neutralise LIKE's wildcards so a search term is matched literally. The
/// backslash is escaped first, or it would corrupt the escapes added after it.
fn escape_like(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

/// Build the WHERE clause for a summary listing. Returns the SQL fragment plus
/// its bound values, so the count and page queries cannot drift apart.
fn summary_filters(query: &SummaryQuery) -> (String, Vec<Box<dyn rusqlite::ToSql>>) {
    let mut clauses: Vec<String> = Vec::new();
    let mut binds: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    if let Some(from) = query.date_from {
        clauses.push(format!("timestamp >= ?{}", binds.len() + 1));
        binds.push(Box::new(from));
    }
    if let Some(to) = query.date_to {
        clauses.push(format!("timestamp <= ?{}", binds.len() + 1));
        binds.push(Box::new(to));
    }
    match query.outcome.as_deref() {
        Some("unrated") => clauses.push("goal_outcome IS NULL".into()),
        Some(value) if value != "all" => {
            clauses.push(format!("goal_outcome = ?{}", binds.len() + 1));
            binds.push(Box::new(value.to_string()));
        }
        _ => {}
    }
    if let Some(workspace) = query.workspace_id.as_deref() {
        if workspace != "all" {
            clauses.push(format!("workspace_id = ?{}", binds.len() + 1));
            binds.push(Box::new(workspace.to_string()));
        }
    }
    match query.measurement.as_deref() {
        Some("measured") => clauses.push("measured = 1".into()),
        Some("unmeasured") => clauses.push("measured = 0".into()),
        _ => {}
    }
    if let Some(search) = query.search.as_deref() {
        let trimmed = search.trim();
        if !trimmed.is_empty() {
            // Searching for "50%" must look for a literal percent sign, not
            // "anything after 50". LIKE's own wildcards have to be escaped or
            // the in-memory filter and this one disagree on such queries.
            clauses.push(format!("search_text LIKE ?{} ESCAPE '\\'", binds.len() + 1));
            binds.push(Box::new(format!("%{}%", escape_like(&trimmed.to_lowercase()))));
        }
    }

    let sql = if clauses.is_empty() {
        String::new()
    } else {
        format!(" WHERE {}", clauses.join(" AND "))
    };
    (sql, binds)
}

// ── Operations, each one transaction ────────────────────────────────────────

pub fn save_session(
    connection: &mut Connection,
    session: &Value,
    summary: &SessionSummary,
    analysis: Option<&Value>,
    ledger_day: Option<(&str, &Value)>,
) -> Result<Value, String> {
    let tx = connection.transaction().map_err(to_err)?;
    write_session(&tx, session, summary, analysis)?;
    // The session row and its ledger contribution land together or not at all:
    // a half-written pair would show a session whose focus score is missing.
    if let Some((day_key, entry)) = ledger_day {
        write_ledger_day(&tx, day_key, entry)?;
    }
    tx.commit().map_err(to_err)?;
    Ok(session.clone())
}

pub fn get_session(connection: &Connection, id: &str) -> Result<Option<Value>, String> {
    connection
        .query_row(
            "SELECT record_json, timeline_json, analysis_json FROM sessions WHERE id = ?1",
            params![id],
            |row| row_record(row, true),
        )
        .optional()
        .map_err(to_err)
}

pub fn load_all(connection: &Connection) -> Result<Vec<Value>, String> {
    let mut statement = connection
        .prepare(
            "SELECT record_json, timeline_json, analysis_json FROM sessions ORDER BY timestamp DESC",
        )
        .map_err(to_err)?;
    let rows = statement
        .query_map([], |row| row_record(row, true))
        .map_err(to_err)?;
    rows.collect::<Result<_, _>>().map_err(to_err)
}

pub fn list_summaries(
    connection: &Connection,
    query: &SummaryQuery,
) -> Result<SummaryPage, String> {
    let (where_sql, binds) = summary_filters(query);
    let bind_refs: Vec<&dyn rusqlite::ToSql> = binds.iter().map(|b| b.as_ref()).collect();

    let total: i64 = connection
        .query_row(
            &format!("SELECT COUNT(*) FROM sessions{where_sql}"),
            bind_refs.as_slice(),
            |row| row.get(0),
        )
        .map_err(to_err)?;

    let page_size = query.page_size.filter(|size| *size > 0).unwrap_or(10);
    let page = query.page.filter(|page| *page > 0).unwrap_or(0);
    let offset = page * page_size;

    // Summaries deliberately omit the timeline — see split_timeline.
    let sql = format!(
        "SELECT record_json, timeline_json, analysis_json FROM sessions{where_sql}
         ORDER BY timestamp DESC LIMIT {page_size} OFFSET {offset}"
    );
    let mut statement = connection.prepare(&sql).map_err(to_err)?;
    let rows = statement
        .query_map(bind_refs.as_slice(), |row| row_record(row, false))
        .map_err(to_err)?;
    let rows: Vec<Value> = rows.collect::<Result<_, _>>().map_err(to_err)?;

    Ok(SummaryPage {
        rows,
        total,
        page,
        page_size,
        page_count: ((total as f64) / (page_size as f64)).ceil().max(1.0) as i64,
    })
}

pub fn update_session(
    connection: &mut Connection,
    id: &str,
    patch: &Value,
    summary: Option<&SessionSummary>,
    analysis: Option<&Value>,
) -> Result<Option<Value>, String> {
    let Some(existing) = get_session(connection, id)? else {
        return Ok(None);
    };

    let mut merged = existing;
    if let (Some(target), Some(patch)) = (merged.as_object_mut(), patch.as_object()) {
        for (key, value) in patch {
            target.insert(key.clone(), value.clone());
        }
    }

    // A caller that changed the outcome sends a refreshed summary so the
    // indexed columns keep matching the record; one that only touched a note
    // may omit it, and the existing columns stand.
    let summary = match summary {
        Some(summary) => summary.clone(),
        None => summary_from_row(connection, id)?,
    };

    let tx = connection.transaction().map_err(to_err)?;
    write_session(&tx, &merged, &summary, analysis)?;
    tx.commit().map_err(to_err)?;
    Ok(Some(merged))
}

/// Re-read the stored indexed columns for a session, so an update that does
/// not supply a fresh summary preserves them exactly.
fn summary_from_row(connection: &Connection, id: &str) -> Result<SessionSummary, String> {
    connection
        .query_row(
            "SELECT id, timestamp, task, goal, actual_seconds, focused_seconds,
                    measured_seconds, distraction_events, goal_outcome, workspace_id,
                    workspace_revision, workspace_name, energy_level, completed,
                    measured, tags_json, search_text
             FROM sessions WHERE id = ?1",
            params![id],
            |row| {
                let tags_json: String = row.get("tags_json")?;
                Ok(SessionSummary {
                    id: row.get("id")?,
                    timestamp: row.get("timestamp")?,
                    task: row.get("task")?,
                    goal: row.get("goal")?,
                    actual_seconds: row.get("actual_seconds")?,
                    focused_seconds: row.get("focused_seconds")?,
                    measured_seconds: row.get("measured_seconds")?,
                    distraction_events: row.get("distraction_events")?,
                    goal_outcome: row.get("goal_outcome")?,
                    workspace_id: row.get("workspace_id")?,
                    workspace_revision: row.get("workspace_revision")?,
                    workspace_name: row.get("workspace_name")?,
                    energy_level: row.get("energy_level")?,
                    completed: row.get::<_, i64>("completed")? != 0,
                    measured: row.get::<_, i64>("measured")? != 0,
                    tags: serde_json::from_str(&tags_json).unwrap_or_default(),
                    search_text: row.get("search_text")?,
                })
            },
        )
        .map_err(to_err)
}

pub fn delete_session(connection: &mut Connection, id: &str) -> Result<(), String> {
    let tx = connection.transaction().map_err(to_err)?;
    tx.execute("DELETE FROM sessions WHERE id = ?1", params![id])
        .map_err(to_err)?;
    drop_ledger_contribution(&tx, id)?;
    tx.commit().map_err(to_err)?;
    Ok(())
}

pub fn clear_all(connection: &mut Connection) -> Result<(), String> {
    let tx = connection.transaction().map_err(to_err)?;
    tx.execute("DELETE FROM sessions", []).map_err(to_err)?;
    tx.execute("DELETE FROM focus_ledger_days", [])
        .map_err(to_err)?;
    tx.commit().map_err(to_err)?;
    Ok(())
}

/// Replace the whole focus ledger in one transaction.
///
/// Used when a scoring rule changes and every stored session has to be
/// re-derived: a partial rewrite would leave the ledger disagreeing with the
/// records it was built from, so it lands whole or not at all.
pub fn replace_focus_ledger(connection: &mut Connection, ledger: &Value) -> Result<(), String> {
    let tx = connection.transaction().map_err(to_err)?;
    tx.execute("DELETE FROM focus_ledger_days", []).map_err(to_err)?;
    if let Some(days) = ledger.get("days").and_then(Value::as_object) {
        for (day_key, entry) in days {
            write_ledger_day(&tx, day_key, entry)?;
        }
    }
    tx.commit().map_err(to_err)?;
    Ok(())
}

pub fn export_archive(connection: &Connection) -> Result<Value, String> {
    Ok(json!({
        "schemaVersion": SCHEMA_VERSION,
        "sessions": load_all(connection)?,
        "focusLedger": load_ledger(connection)?,
    }))
}

// ── Legacy migration ────────────────────────────────────────────────────────

/// Import the localStorage archive once, then never again.
///
/// Safety properties this must hold, because it runs against the only copy of
/// someone's history:
///   * idempotent — a second call after success is a no-op
///   * deduplicating — re-running after a crash cannot double-insert
///   * verified — success is recorded only after every id is confirmed present
///   * non-destructive — the caller keeps the localStorage copy either way
///
/// An interrupted run leaves the status unset, so the next launch retries.
pub fn migrate_legacy(
    connection: &mut Connection,
    sessions: &[Value],
    summaries: &[SessionSummary],
    ledger: &Value,
) -> Result<MigrationOutcome, String> {
    if meta_get(connection, MIGRATION_STATUS_KEY)?.as_deref() == Some(MIGRATION_DONE) {
        return Ok(MigrationOutcome {
            migrated: false,
            imported_count: 0,
            skipped_duplicate_count: 0,
            verified: true,
            reason: Some("already_migrated".into()),
        });
    }

    if sessions.len() != summaries.len() {
        return Err("session and summary counts differ".into());
    }

    let before: i64 = connection
        .query_row("SELECT COUNT(*) FROM sessions", [], |row| row.get(0))
        .map_err(to_err)?;

    let tx = connection.transaction().map_err(to_err)?;
    let mut skipped = 0_i64;
    for (session, summary) in sessions.iter().zip(summaries.iter()) {
        if summary.id.is_empty() {
            skipped += 1;
            continue;
        }
        let exists: bool = tx
            .query_row(
                "SELECT 1 FROM sessions WHERE id = ?1",
                params![summary.id],
                |_| Ok(true),
            )
            .optional()
            .map_err(to_err)?
            .unwrap_or(false);
        if exists {
            skipped += 1;
            continue;
        }
        // Legacy fields are preserved untouched: the record goes in as it was
        // written, whatever shape that build used.
        write_session(&tx, session, summary, None)?;
    }

    if let Some(days) = ledger.get("days").and_then(Value::as_object) {
        for (day_key, entry) in days {
            write_ledger_day(&tx, day_key, entry)?;
        }
    }

    // Verify inside the transaction: if a single expected id is missing, roll
    // the whole thing back rather than record a success that isn't one.
    let mut missing = 0_i64;
    for summary in summaries {
        if summary.id.is_empty() {
            continue;
        }
        let present: bool = tx
            .query_row(
                "SELECT 1 FROM sessions WHERE id = ?1",
                params![summary.id],
                |_| Ok(true),
            )
            .optional()
            .map_err(to_err)?
            .unwrap_or(false);
        if !present {
            missing += 1;
        }
    }
    if missing > 0 {
        tx.rollback().map_err(to_err)?;
        return Ok(MigrationOutcome {
            migrated: false,
            imported_count: 0,
            skipped_duplicate_count: 0,
            verified: false,
            reason: Some(format!("{missing} sessions failed verification")),
        });
    }

    let after: i64 = tx
        .query_row("SELECT COUNT(*) FROM sessions", [], |row| row.get(0))
        .map_err(to_err)?;
    let imported = after - before;

    meta_set(&tx, MIGRATION_STATUS_KEY, MIGRATION_DONE)?;
    meta_set(
        &tx,
        MIGRATION_COUNTS_KEY,
        &json!({ "imported": imported, "skipped": skipped }).to_string(),
    )?;
    tx.commit().map_err(to_err)?;

    Ok(MigrationOutcome {
        migrated: true,
        imported_count: imported,
        skipped_duplicate_count: skipped,
        verified: true,
        reason: None,
    })
}

// ── Tauri commands ──────────────────────────────────────────────────────────

fn with_connection<T>(
    state: &tauri::State<'_, DbState>,
    action: impl FnOnce(&mut Connection) -> Result<T, String>,
) -> Result<T, String> {
    let mut guard = state.0.lock().map_err(|_| "database lock poisoned".to_string())?;
    action(&mut guard)
}

#[tauri::command]
pub fn db_load_all(state: tauri::State<'_, DbState>) -> Result<Vec<Value>, String> {
    with_connection(&state, |connection| load_all(connection))
}

#[tauri::command]
pub fn db_list_session_summaries(
    state: tauri::State<'_, DbState>,
    query: SummaryQuery,
) -> Result<SummaryPage, String> {
    with_connection(&state, |connection| list_summaries(connection, &query))
}

#[tauri::command]
pub fn db_get_session(
    state: tauri::State<'_, DbState>,
    id: String,
) -> Result<Option<Value>, String> {
    with_connection(&state, |connection| get_session(connection, &id))
}

#[tauri::command]
pub fn db_save_session(
    state: tauri::State<'_, DbState>,
    session: Value,
    summary: SessionSummary,
    analysis: Option<Value>,
    ledger_day_key: Option<String>,
    ledger_day_entry: Option<Value>,
) -> Result<Value, String> {
    with_connection(&state, |connection| {
        let ledger = match (ledger_day_key.as_deref(), ledger_day_entry.as_ref()) {
            (Some(key), Some(entry)) => Some((key, entry)),
            _ => None,
        };
        save_session(connection, &session, &summary, analysis.as_ref(), ledger)
    })
}

#[tauri::command]
pub fn db_update_session(
    state: tauri::State<'_, DbState>,
    id: String,
    patch: Value,
    summary: Option<SessionSummary>,
    analysis: Option<Value>,
) -> Result<Option<Value>, String> {
    with_connection(&state, |connection| {
        update_session(connection, &id, &patch, summary.as_ref(), analysis.as_ref())
    })
}

#[tauri::command]
pub fn db_delete_session(state: tauri::State<'_, DbState>, id: String) -> Result<(), String> {
    with_connection(&state, |connection| delete_session(connection, &id))
}

#[tauri::command]
pub fn db_clear_all(state: tauri::State<'_, DbState>) -> Result<(), String> {
    with_connection(&state, clear_all)
}

#[tauri::command]
pub fn db_load_focus_ledger(state: tauri::State<'_, DbState>) -> Result<Value, String> {
    with_connection(&state, |connection| load_ledger(connection))
}

#[tauri::command]
pub fn db_replace_focus_ledger(
    state: tauri::State<'_, DbState>,
    ledger: Value,
) -> Result<(), String> {
    with_connection(&state, |connection| replace_focus_ledger(connection, &ledger))
}

#[tauri::command]
pub fn db_export_archive(state: tauri::State<'_, DbState>) -> Result<Value, String> {
    with_connection(&state, |connection| export_archive(connection))
}

#[tauri::command]
pub fn db_migrate_legacy(
    state: tauri::State<'_, DbState>,
    sessions: Vec<Value>,
    summaries: Vec<SessionSummary>,
    ledger: Value,
) -> Result<MigrationOutcome, String> {
    with_connection(&state, |connection| {
        migrate_legacy(connection, &sessions, &summaries, &ledger)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db() -> Connection {
        let connection = Connection::open_in_memory().expect("in-memory database");
        prepare(&connection).expect("schema");
        connection
    }

    fn summary(id: &str, timestamp: i64) -> SessionSummary {
        SessionSummary {
            id: id.into(),
            timestamp,
            task: "Thesis".into(),
            goal: "Draft intro".into(),
            actual_seconds: 1800,
            focused_seconds: Some(1500),
            measured_seconds: Some(1800),
            distraction_events: 2,
            goal_outcome: Some("yes".into()),
            workspace_id: Some("ws1".into()),
            workspace_revision: Some(0),
            workspace_name: Some("Office".into()),
            energy_level: Some("medium".into()),
            completed: true,
            measured: true,
            tags: vec!["writing".into()],
            search_text: "thesis writing".into(),
        }
    }

    fn session_value(id: &str) -> Value {
        json!({
            "id": id,
            "task": "Thesis",
            "actualSeconds": 1800,
            "timeline": [{ "second": 0, "score": 80 }, { "second": 1, "score": 82 }],
        })
    }

    #[test]
    fn saves_and_reads_back_a_complete_record() {
        let mut connection = db();
        save_session(
            &mut connection,
            &session_value("a"),
            &summary("a", 100),
            None,
            None,
        )
        .unwrap();

        let fetched = get_session(&connection, "a").unwrap().expect("session");
        assert_eq!(fetched["task"], "Thesis");
        // The timeline is split out for storage but must come back intact.
        assert_eq!(fetched["timeline"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn summaries_omit_the_timeline_but_full_reads_include_it() {
        let mut connection = db();
        save_session(&mut connection, &session_value("a"), &summary("a", 100), None, None).unwrap();

        let page = list_summaries(&connection, &SummaryQuery::default()).unwrap();
        assert_eq!(page.rows.len(), 1);
        assert!(page.rows[0].get("timeline").is_none());
        assert!(get_session(&connection, "a").unwrap().unwrap()["timeline"].is_array());
    }

    #[test]
    fn returns_none_for_an_unknown_id() {
        let connection = db();
        assert!(get_session(&connection, "missing").unwrap().is_none());
    }

    #[test]
    fn orders_newest_first() {
        let mut connection = db();
        for (id, ts) in [("old", 100), ("new", 300), ("mid", 200)] {
            save_session(&mut connection, &session_value(id), &summary(id, ts), None, None).unwrap();
        }
        let all = load_all(&connection).unwrap();
        let ids: Vec<&str> = all.iter().map(|s| s["id"].as_str().unwrap()).collect();
        assert_eq!(ids, vec!["new", "mid", "old"]);
    }

    #[test]
    fn paginates_with_a_stable_total() {
        let mut connection = db();
        for index in 0..25 {
            let id = format!("s{index}");
            save_session(
                &mut connection,
                &session_value(&id),
                &summary(&id, index as i64),
                None,
                None,
            )
            .unwrap();
        }

        let first = list_summaries(
            &connection,
            &SummaryQuery { page: Some(0), page_size: Some(10), ..Default::default() },
        )
        .unwrap();
        assert_eq!(first.rows.len(), 10);
        assert_eq!(first.total, 25);
        assert_eq!(first.page_count, 3);

        let last = list_summaries(
            &connection,
            &SummaryQuery { page: Some(2), page_size: Some(10), ..Default::default() },
        )
        .unwrap();
        assert_eq!(last.rows.len(), 5);
        assert_eq!(last.total, 25);
    }

    #[test]
    fn a_page_past_the_end_is_empty_rather_than_an_error() {
        let mut connection = db();
        save_session(&mut connection, &session_value("a"), &summary("a", 1), None, None).unwrap();
        let page = list_summaries(
            &connection,
            &SummaryQuery { page: Some(99), page_size: Some(10), ..Default::default() },
        )
        .unwrap();
        assert!(page.rows.is_empty());
        assert_eq!(page.total, 1);
    }

    #[test]
    fn filters_by_outcome_including_the_unrated_bucket() {
        let mut connection = db();
        let mut rated = summary("rated", 1);
        rated.goal_outcome = Some("yes".into());
        let mut unrated = summary("unrated", 2);
        unrated.goal_outcome = None;
        save_session(&mut connection, &session_value("rated"), &rated, None, None).unwrap();
        save_session(&mut connection, &session_value("unrated"), &unrated, None, None).unwrap();

        let yes = list_summaries(
            &connection,
            &SummaryQuery { outcome: Some("yes".into()), ..Default::default() },
        )
        .unwrap();
        assert_eq!(yes.total, 1);

        let none = list_summaries(
            &connection,
            &SummaryQuery { outcome: Some("unrated".into()), ..Default::default() },
        )
        .unwrap();
        assert_eq!(none.total, 1);
        assert_eq!(none.rows[0]["id"], "unrated");
    }

    #[test]
    fn filters_by_measurement_status_and_search_text() {
        let mut connection = db();
        let mut measured = summary("measured", 1);
        measured.search_text = "thesis writing".into();
        let mut unmeasured = summary("unmeasured", 2);
        unmeasured.measured = false;
        unmeasured.search_text = "review pr".into();
        save_session(&mut connection, &session_value("measured"), &measured, None, None).unwrap();
        save_session(&mut connection, &session_value("unmeasured"), &unmeasured, None, None).unwrap();

        let only_measured = list_summaries(
            &connection,
            &SummaryQuery { measurement: Some("measured".into()), ..Default::default() },
        )
        .unwrap();
        assert_eq!(only_measured.total, 1);
        assert_eq!(only_measured.rows[0]["id"], "measured");

        // Search is case-insensitive, matching the JS filter.
        let searched = list_summaries(
            &connection,
            &SummaryQuery { search: Some("THESIS".into()), ..Default::default() },
        )
        .unwrap();
        assert_eq!(searched.total, 1);
    }

    #[test]
    fn search_treats_like_wildcards_as_literal_characters() {
        let mut connection = db();
        let mut percent = summary("percent", 1);
        percent.search_text = "hit 50% target".into();
        let mut other = summary("other", 2);
        other.search_text = "hit 50 targets".into();
        save_session(&mut connection, &session_value("percent"), &percent, None, None).unwrap();
        save_session(&mut connection, &session_value("other"), &other, None, None).unwrap();

        // Unescaped, "50%" would match both rows because % is LIKE's wildcard.
        let page = list_summaries(
            &connection,
            &SummaryQuery { search: Some("50%".into()), ..Default::default() },
        )
        .unwrap();
        assert_eq!(page.total, 1);
        assert_eq!(page.rows[0]["id"], "percent");

        // The single-character wildcard needs the same treatment.
        let mut underscore = summary("underscore", 3);
        underscore.search_text = "deep_work".into();
        save_session(&mut connection, &session_value("underscore"), &underscore, None, None)
            .unwrap();
        let page = list_summaries(
            &connection,
            &SummaryQuery { search: Some("deep_".into()), ..Default::default() },
        )
        .unwrap();
        assert_eq!(page.total, 1);
        assert_eq!(page.rows[0]["id"], "underscore");
    }

    #[test]
    fn combines_filters_conjunctively() {
        let mut connection = db();
        let mut hit = summary("hit", 500);
        hit.search_text = "thesis".into();
        let mut wrong_outcome = summary("wrong", 500);
        wrong_outcome.goal_outcome = Some("no".into());
        wrong_outcome.search_text = "thesis".into();
        save_session(&mut connection, &session_value("hit"), &hit, None, None).unwrap();
        save_session(&mut connection, &session_value("wrong"), &wrong_outcome, None, None).unwrap();

        let page = list_summaries(
            &connection,
            &SummaryQuery {
                date_from: Some(400),
                outcome: Some("yes".into()),
                search: Some("thesis".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(page.total, 1);
        assert_eq!(page.rows[0]["id"], "hit");
    }

    #[test]
    fn updates_merge_into_the_stored_record() {
        let mut connection = db();
        save_session(&mut connection, &session_value("a"), &summary("a", 1), None, None).unwrap();

        let updated = update_session(
            &mut connection,
            "a",
            &json!({ "goalOutcome": "partly", "blockerText": "meetings" }),
            None,
            None,
        )
        .unwrap()
        .expect("updated");

        assert_eq!(updated["goalOutcome"], "partly");
        assert_eq!(updated["blockerText"], "meetings");
        // Untouched fields survive, and so does the timeline.
        assert_eq!(updated["task"], "Thesis");
        assert_eq!(updated["timeline"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn updating_an_unknown_session_reports_none_rather_than_creating_one() {
        let mut connection = db();
        assert!(update_session(&mut connection, "ghost", &json!({}), None, None)
            .unwrap()
            .is_none());
        assert_eq!(load_all(&connection).unwrap().len(), 0);
    }

    #[test]
    fn deletes_one_session_and_its_ledger_contribution_together() {
        let mut connection = db();
        let day = json!({ "sessions": { "a": { "version": 1, "measuredSeconds": 1800 } } });
        save_session(
            &mut connection,
            &session_value("a"),
            &summary("a", 1),
            None,
            Some(("2026-08-15", &day)),
        )
        .unwrap();
        assert_eq!(
            load_ledger(&connection).unwrap()["days"]["2026-08-15"]["sessions"]["a"]["version"],
            1
        );

        delete_session(&mut connection, "a").unwrap();
        assert!(get_session(&connection, "a").unwrap().is_none());
        // The day held only this session, so it goes with it.
        assert!(load_ledger(&connection).unwrap()["days"]
            .as_object()
            .unwrap()
            .is_empty());
    }

    #[test]
    fn deleting_one_session_keeps_the_others_in_its_ledger_day() {
        let mut connection = db();
        let day = json!({ "sessions": { "a": { "version": 1 }, "b": { "version": 1 } } });
        save_session(
            &mut connection,
            &session_value("a"),
            &summary("a", 1),
            None,
            Some(("2026-08-15", &day)),
        )
        .unwrap();

        delete_session(&mut connection, "a").unwrap();
        let ledger = load_ledger(&connection).unwrap();
        assert!(ledger["days"]["2026-08-15"]["sessions"]["a"].is_null());
        assert_eq!(ledger["days"]["2026-08-15"]["sessions"]["b"]["version"], 1);
    }

    #[test]
    fn clear_all_empties_sessions_and_ledger_together() {
        let mut connection = db();
        let day = json!({ "sessions": { "a": { "version": 1 } } });
        save_session(
            &mut connection,
            &session_value("a"),
            &summary("a", 1),
            None,
            Some(("2026-08-15", &day)),
        )
        .unwrap();

        clear_all(&mut connection).unwrap();
        assert_eq!(load_all(&connection).unwrap().len(), 0);
        assert!(load_ledger(&connection).unwrap()["days"]
            .as_object()
            .unwrap()
            .is_empty());
    }

    #[test]
    fn a_failed_write_inside_a_transaction_leaves_nothing_behind() {
        let mut connection = db();
        save_session(&mut connection, &session_value("keep"), &summary("keep", 1), None, None)
            .unwrap();

        // Force a mid-transaction failure and confirm the partial work is gone.
        {
            let tx = connection.transaction().unwrap();
            write_session(&tx, &session_value("rolled"), &summary("rolled", 2), None).unwrap();
            tx.rollback().unwrap();
        }

        let ids: Vec<String> = load_all(&connection)
            .unwrap()
            .iter()
            .map(|s| s["id"].as_str().unwrap().to_string())
            .collect();
        assert_eq!(ids, vec!["keep".to_string()]);
    }

    #[test]
    fn export_carries_every_record_with_its_timeline_and_the_ledger() {
        let mut connection = db();
        let day = json!({ "sessions": { "a": { "version": 1 } } });
        save_session(
            &mut connection,
            &session_value("a"),
            &summary("a", 1),
            None,
            Some(("2026-08-15", &day)),
        )
        .unwrap();

        let archive = export_archive(&connection).unwrap();
        assert_eq!(archive["schemaVersion"], SCHEMA_VERSION);
        assert_eq!(archive["sessions"].as_array().unwrap().len(), 1);
        assert_eq!(archive["sessions"][0]["timeline"].as_array().unwrap().len(), 2);
        assert_eq!(archive["focusLedger"]["days"]["2026-08-15"]["sessions"]["a"]["version"], 1);
    }

    #[test]
    fn replacing_the_ledger_swaps_every_day_at_once() {
        let mut connection = db();
        let first = json!({ "sessions": { "a": { "version": 1 } } });
        save_session(
            &mut connection,
            &session_value("a"),
            &summary("a", 1),
            None,
            Some(("2026-08-15", &first)),
        )
        .unwrap();

        // A re-derivation produces a different ledger; the old days must not
        // survive alongside the new ones.
        let rebuilt = json!({
            "schemaVersion": 1,
            "days": { "2026-08-16": { "sessions": { "b": { "version": 1 } } } }
        });
        replace_focus_ledger(&mut connection, &rebuilt).unwrap();

        let stored = load_ledger(&connection).unwrap();
        assert!(stored["days"]["2026-08-15"].is_null());
        assert_eq!(stored["days"]["2026-08-16"]["sessions"]["b"]["version"], 1);
        // The sessions themselves are untouched by a ledger rebuild.
        assert_eq!(load_all(&connection).unwrap().len(), 1);
    }

    #[test]
    fn migration_imports_sessions_and_ledger_in_one_pass() {
        let mut connection = db();
        let ledger = json!({ "schemaVersion": 1, "days": { "2026-08-15": { "sessions": { "a": { "version": 1 } } } } });
        let outcome = migrate_legacy(
            &mut connection,
            &[session_value("a"), session_value("b")],
            &[summary("a", 1), summary("b", 2)],
            &ledger,
        )
        .unwrap();

        assert!(outcome.migrated);
        assert!(outcome.verified);
        assert_eq!(outcome.imported_count, 2);
        assert_eq!(load_all(&connection).unwrap().len(), 2);
        assert_eq!(load_ledger(&connection).unwrap()["days"]["2026-08-15"]["sessions"]["a"]["version"], 1);
    }

    #[test]
    fn migration_is_idempotent() {
        let mut connection = db();
        let ledger = json!({ "days": {} });
        migrate_legacy(&mut connection, &[session_value("a")], &[summary("a", 1)], &ledger).unwrap();

        // A second run must not re-import, even given the same input.
        let second = migrate_legacy(
            &mut connection,
            &[session_value("a")],
            &[summary("a", 1)],
            &ledger,
        )
        .unwrap();
        assert!(!second.migrated);
        assert_eq!(second.reason.as_deref(), Some("already_migrated"));
        assert_eq!(load_all(&connection).unwrap().len(), 1);
    }

    #[test]
    fn migration_deduplicates_by_id_after_an_interrupted_run() {
        let mut connection = db();
        // Simulate a crash after one session landed but before status was set.
        save_session(&mut connection, &session_value("a"), &summary("a", 1), None, None).unwrap();

        let outcome = migrate_legacy(
            &mut connection,
            &[session_value("a"), session_value("b")],
            &[summary("a", 1), summary("b", 2)],
            &json!({ "days": {} }),
        )
        .unwrap();

        assert!(outcome.migrated);
        assert_eq!(outcome.imported_count, 1);
        assert_eq!(outcome.skipped_duplicate_count, 1);
        assert_eq!(load_all(&connection).unwrap().len(), 2);
    }

    // Real records carry fractional seconds from the live accumulator. An
    // import that rejects them rejects the user's entire history, which is
    // exactly what shipped: "invalid type: floating point 92.59400000000004,
    // expected i64".
    #[test]
    fn accepts_the_fractional_seconds_real_records_carry() {
        let raw = json!({
            "id": "real",
            "timestamp": 1_787_440_169_711_i64,
            "task": "Thesis",
            "goal": "",
            "actualSeconds": 620.0000000001_f64,
            "focusedSeconds": 92.59400000000004_f64,
            "measuredSeconds": 600.5_f64,
            "distractionEvents": 2,
            "goalOutcome": "yes",
            "workspaceId": "ws1",
            "workspaceRevision": 0,
            "completed": true,
            "measured": true,
            "tags": [],
            "searchText": "thesis",
        });
        let parsed: SessionSummary = serde_json::from_value(raw).expect("fractional seconds parse");
        assert_eq!(parsed.focused_seconds, Some(93));
        assert_eq!(parsed.measured_seconds, Some(601));
        assert_eq!(parsed.actual_seconds, 620);

        // And such a record imports rather than failing the whole migration.
        let mut connection = db();
        let outcome = migrate_legacy(
            &mut connection,
            &[session_value("real")],
            &[parsed],
            &json!({ "days": {} }),
        )
        .unwrap();
        assert!(outcome.verified);
        assert_eq!(outcome.imported_count, 1);
    }

    #[test]
    fn a_null_or_unexpected_number_field_degrades_instead_of_failing_the_import() {
        let raw = json!({
            "id": "odd",
            "timestamp": null,
            "actualSeconds": null,
            "focusedSeconds": null,
            "distractionEvents": null,
            "completed": false,
            "measured": false,
            "tags": [],
            "searchText": "",
        });
        let parsed: SessionSummary = serde_json::from_value(raw).expect("null numbers parse");
        assert_eq!(parsed.timestamp, 0);
        assert_eq!(parsed.actual_seconds, 0);
        assert_eq!(parsed.focused_seconds, None);
    }

    #[test]
    fn migration_rejects_mismatched_session_and_summary_counts() {
        let mut connection = db();
        let error = migrate_legacy(
            &mut connection,
            &[session_value("a"), session_value("b")],
            &[summary("a", 1)],
            &json!({ "days": {} }),
        )
        .unwrap_err();
        assert!(error.contains("differ"));
        assert_eq!(load_all(&connection).unwrap().len(), 0);
    }

    #[test]
    fn migration_preserves_unknown_legacy_fields_untouched() {
        let mut connection = db();
        let legacy = json!({
            "id": "legacy",
            "task": "Old",
            "someRetiredField": "keep me",
            "goalAchieved": true,
        });
        let mut legacy_summary = summary("legacy", 1);
        legacy_summary.goal_outcome = Some("yes".into());

        migrate_legacy(&mut connection, &[legacy], &[legacy_summary], &json!({ "days": {} }))
            .unwrap();

        let stored = get_session(&connection, "legacy").unwrap().unwrap();
        assert_eq!(stored["someRetiredField"], "keep me");
        assert_eq!(stored["goalAchieved"], true);
    }

    #[test]
    fn a_malformed_stored_record_yields_an_object_rather_than_a_panic() {
        let mut connection = db();
        save_session(&mut connection, &session_value("a"), &summary("a", 1), None, None).unwrap();
        connection
            .execute("UPDATE sessions SET record_json = 'not json' WHERE id = 'a'", [])
            .unwrap();

        let fetched = get_session(&connection, "a").unwrap().expect("row still returned");
        assert!(fetched.is_object());
    }

    #[test]
    fn an_analysis_snapshot_round_trips_with_its_version() {
        let mut connection = db();
        let analysis = json!({ "version": 1, "status": "ready", "conclusion": { "code": "HIGH_FOCUS_GOAL_MET" } });
        save_session(
            &mut connection,
            &session_value("a"),
            &summary("a", 1),
            Some(&analysis),
            None,
        )
        .unwrap();

        let stored = get_session(&connection, "a").unwrap().unwrap();
        assert_eq!(stored["analysisSnapshot"]["status"], "ready");
        let version: i64 = connection
            .query_row("SELECT analysis_version FROM sessions WHERE id = 'a'", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, 1);
    }

    #[test]
    fn reopening_a_database_preserves_everything() {
        let dir = std::env::temp_dir().join(format!("eudonomia-db-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let path = dir.join("sessions.db");

        {
            let mut connection = open(&path).unwrap();
            save_session(&mut connection, &session_value("a"), &summary("a", 1), None, None)
                .unwrap();
        }
        {
            let connection = open(&path).unwrap();
            assert_eq!(load_all(&connection).unwrap().len(), 1);
            assert_eq!(
                connection
                    .query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))
                    .unwrap(),
                SCHEMA_VERSION
            );
        }

        let _ = std::fs::remove_dir_all(&dir);
    }
}
