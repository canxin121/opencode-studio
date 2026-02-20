use std::cmp::Ordering;
use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use dashmap::{DashMap, mapref::entry::Entry};
use serde_json::{Map, Value, json};

#[derive(Debug, Clone)]
pub struct SessionSummaryRecord {
    pub session_id: String,
    pub directory_path: String,
    pub parent_id: Option<String>,
    pub title: String,
    pub updated_at: f64,
    pub raw: Value,
}

#[derive(Debug, Clone)]
pub struct RuntimeRecord {
    pub status_type: String,
    pub phase: String,
    pub attention: Option<String>,
    pub effective_type: String,
    pub updated_at: i64,
}

#[derive(Debug, Clone)]
pub struct RecentSessionRecord {
    pub session_id: String,
    pub directory_id: String,
    pub directory_path: String,
    pub updated_at: f64,
}

const RECENT_SESSIONS_LIMIT: usize = 40;
const SESSION_DELETE_TOMBSTONE_TTL_MS: i64 = 10 * 60 * 1000;

#[derive(Debug, Default)]
struct RecentSessionsCache {
    items: Vec<RecentSessionRecord>,
}

fn compare_recent(left: &RecentSessionRecord, right: &RecentSessionRecord) -> Ordering {
    right
        .updated_at
        .partial_cmp(&left.updated_at)
        .unwrap_or(Ordering::Equal)
        .then_with(|| left.session_id.cmp(&right.session_id))
}

impl RecentSessionsCache {
    fn upsert(
        &mut self,
        session_id: &str,
        directory_id: &str,
        directory_path: &str,
        updated_at: f64,
    ) {
        let sid = session_id.trim();
        let did = directory_id.trim();
        let directory = directory_path.trim();
        if sid.is_empty() || did.is_empty() || directory.is_empty() {
            return;
        }
        let safe_updated_at = if updated_at.is_finite() {
            updated_at
        } else {
            0.0
        };

        self.items.retain(|entry| entry.session_id != sid);
        self.items.push(RecentSessionRecord {
            session_id: sid.to_string(),
            directory_id: did.to_string(),
            directory_path: directory.to_string(),
            updated_at: safe_updated_at,
        });
        self.items.sort_by(compare_recent);
        self.items.truncate(RECENT_SESSIONS_LIMIT);
    }

    fn remove(&mut self, session_id: &str) {
        let sid = session_id.trim();
        if sid.is_empty() {
            return;
        }
        self.items.retain(|entry| entry.session_id != sid);
    }

    fn snapshot(&self) -> Vec<RecentSessionRecord> {
        self.items.clone()
    }
}

#[derive(Clone)]
pub struct DirectorySessionIndexManager {
    summaries_by_session: Arc<DashMap<String, SessionSummaryRecord>>,
    directory_by_session: Arc<DashMap<String, String>>,
    sessions_by_directory: Arc<DashMap<String, HashSet<String>>>,
    directory_id_by_path: Arc<DashMap<String, String>>,
    runtime_by_session: Arc<DashMap<String, RuntimeRecord>>,
    deleted_sessions: Arc<DashMap<String, i64>>,
    recent_sessions: Arc<Mutex<RecentSessionsCache>>,
}

fn normalize_directory_for_index(path: &str) -> Option<String> {
    let normalized = crate::path_utils::normalize_directory_path(path);
    let normalized = normalized.trim();
    if normalized.is_empty() {
        return None;
    }
    Some(
        normalized
            .replace('\\', "/")
            .trim_end_matches('/')
            .to_string(),
    )
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn normalize_effective_type(status: &str, phase: &str, attention: Option<&str>) -> &'static str {
    if attention.is_some() {
        return "attention";
    }
    if status == "busy" || status == "retry" {
        return "busy";
    }
    if phase == "busy" {
        return "busy";
    }
    if phase == "cooldown" {
        return "cooldown";
    }
    "idle"
}

fn parse_runtime_status(value: &Value) -> String {
    value
        .as_str()
        .map(|s| s.trim().to_string())
        .or_else(|| {
            value
                .get("type")
                .and_then(|x| x.as_str())
                .map(|s| s.trim().to_string())
        })
        .or_else(|| {
            value
                .get("status")
                .and_then(|x| x.get("type"))
                .and_then(|x| x.as_str())
                .map(|s| s.trim().to_string())
        })
        .unwrap_or_else(|| "idle".to_string())
}

impl DirectorySessionIndexManager {
    pub fn new() -> Self {
        Self {
            summaries_by_session: Arc::new(DashMap::new()),
            directory_by_session: Arc::new(DashMap::new()),
            sessions_by_directory: Arc::new(DashMap::new()),
            directory_id_by_path: Arc::new(DashMap::new()),
            runtime_by_session: Arc::new(DashMap::new()),
            deleted_sessions: Arc::new(DashMap::new()),
            recent_sessions: Arc::new(Mutex::new(RecentSessionsCache::default())),
        }
    }

    pub fn replace_directory_mappings(&self, entries: Vec<(String, String)>) {
        self.directory_id_by_path.clear();
        for (directory_id, directory_path) in entries {
            let did = directory_id.trim();
            if did.is_empty() {
                continue;
            }
            let Some(path_key) = normalize_directory_for_index(&directory_path) else {
                continue;
            };
            self.directory_id_by_path.insert(path_key, did.to_string());
        }
    }

    pub fn upsert_summary_from_value(&self, session: &Value) {
        let session_id = session
            .get("id")
            .and_then(|v| v.as_str())
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty());
        let Some(session_id) = session_id else {
            return;
        };
        self.deleted_sessions.remove(&session_id);

        let directory_path = session
            .get("directory")
            .and_then(|v| v.as_str())
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty());
        let Some(directory_path) = directory_path else {
            return;
        };
        let Some(directory_key) = normalize_directory_for_index(&directory_path) else {
            return;
        };

        let parent_id = session
            .get("parentID")
            .or_else(|| session.get("parentId"))
            .or_else(|| session.get("parent_id"))
            .and_then(|v| v.as_str())
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty());

        let title = session
            .get("title")
            .or_else(|| session.get("slug"))
            .and_then(|v| v.as_str())
            .map(|v| v.trim().to_string())
            .unwrap_or_default();

        let updated_at = session
            .get("time")
            .and_then(|v| v.get("updated"))
            .and_then(|v| v.as_f64())
            .filter(|v| v.is_finite())
            .unwrap_or(0.0);

        let old_directory = self
            .directory_by_session
            .insert(session_id.clone(), directory_path.clone());
        if let Some(old_directory) = old_directory {
            self.remove_session_from_directory(&session_id, &old_directory);
        }

        self.add_session_to_directory(&session_id, &directory_key);
        let directory_id = self
            .directory_id_by_path
            .get(&directory_key)
            .map(|value| value.value().clone())
            .unwrap_or_default();
        self.upsert_recent_session(&session_id, &directory_id, &directory_path, updated_at);
        self.summaries_by_session.insert(
            session_id.clone(),
            SessionSummaryRecord {
                session_id,
                directory_path,
                parent_id,
                title,
                updated_at,
                raw: session.clone(),
            },
        );
    }

    pub fn remove_summary(&self, session_id: &str) {
        let sid = session_id.trim();
        if sid.is_empty() {
            return;
        }
        self.summaries_by_session.remove(sid);
        if let Some((_, directory)) = self.directory_by_session.remove(sid) {
            self.remove_session_from_directory(sid, &directory);
        }
        self.runtime_by_session.remove(sid);
        self.deleted_sessions.insert(sid.to_string(), now_millis());
        self.remove_recent_session(sid);
    }

    pub fn is_recently_deleted(&self, session_id: &str) -> bool {
        let sid = session_id.trim();
        if sid.is_empty() {
            return false;
        }

        let now = now_millis();
        let cutoff = now.saturating_sub(SESSION_DELETE_TOMBSTONE_TTL_MS);
        if let Some(entry) = self.deleted_sessions.get(sid) {
            let deleted_at = *entry;
            if deleted_at >= cutoff {
                return true;
            }
        }

        self.deleted_sessions.remove(sid);
        false
    }

    pub fn remove_recent_session_entry(&self, session_id: &str) {
        self.remove_recent_session(session_id);
    }

    fn add_session_to_directory(&self, session_id: &str, directory: &str) {
        let sid = session_id.trim();
        if sid.is_empty() {
            return;
        }
        let Some(directory_key) = normalize_directory_for_index(directory) else {
            return;
        };

        match self.sessions_by_directory.entry(directory_key) {
            Entry::Occupied(mut entry) => {
                entry.get_mut().insert(sid.to_string());
            }
            Entry::Vacant(entry) => {
                let mut ids = HashSet::new();
                ids.insert(sid.to_string());
                entry.insert(ids);
            }
        }
    }

    fn remove_session_from_directory(&self, session_id: &str, directory: &str) {
        let Some(directory_key) = normalize_directory_for_index(directory) else {
            return;
        };
        let mut remove_bucket = false;
        if let Some(mut bucket) = self.sessions_by_directory.get_mut(&directory_key) {
            bucket.remove(session_id);
            remove_bucket = bucket.is_empty();
        }
        if remove_bucket {
            self.sessions_by_directory.remove(&directory_key);
        }
    }

    pub fn summary(&self, session_id: &str) -> Option<SessionSummaryRecord> {
        let sid = session_id.trim();
        if sid.is_empty() {
            return None;
        }
        self.summaries_by_session.get(sid).map(|v| v.clone())
    }

    pub fn recent_sessions_snapshot(&self) -> Vec<RecentSessionRecord> {
        self.recent_sessions.lock().unwrap().snapshot()
    }

    pub fn directory_for_session(&self, session_id: &str) -> Option<String> {
        let sid = session_id.trim();
        if sid.is_empty() {
            return None;
        }
        self.directory_by_session
            .get(sid)
            .map(|v| v.value().trim().to_string())
            .filter(|v| !v.is_empty())
    }

    pub fn directory_id_for_path(&self, directory_path: &str) -> Option<String> {
        let directory_key = normalize_directory_for_index(directory_path)?;
        self.directory_id_by_path
            .get(&directory_key)
            .map(|value| value.value().trim().to_string())
            .filter(|v| !v.is_empty())
    }

    pub fn session_ids_for_directory(&self, directory: &str) -> HashSet<String> {
        let Some(directory_key) = normalize_directory_for_index(directory) else {
            return HashSet::new();
        };
        self.sessions_by_directory
            .get(&directory_key)
            .map(|bucket| bucket.iter().cloned().collect())
            .unwrap_or_default()
    }

    pub fn merge_runtime_status_map(&self, payload: &Value) -> HashSet<String> {
        let mut busy = HashSet::new();
        let Some(map) = payload.as_object() else {
            return busy;
        };

        for (sid, value) in map {
            let session_id = sid.trim();
            if session_id.is_empty() {
                continue;
            }

            let status = parse_runtime_status(value);

            if status == "busy" || status == "retry" {
                busy.insert(session_id.to_string());
            }
            self.upsert_runtime_status(session_id, &status);
        }

        busy
    }

    pub fn reconcile_runtime_status_map(&self, payload: &Value) -> HashSet<String> {
        let busy = self.merge_runtime_status_map(payload);

        self.reconcile_busy_set(&busy);
        busy
    }

    pub fn reconcile_runtime_phase_map(&self, payload: &Value) {
        let Some(map) = payload.as_object() else {
            return;
        };
        for (sid, value) in map {
            let session_id = sid.trim();
            if session_id.is_empty() {
                continue;
            }
            let phase = value
                .get("type")
                .and_then(|v| v.as_str())
                .or_else(|| value.as_str())
                .unwrap_or("idle");
            self.upsert_runtime_phase(session_id, phase);
        }
    }

    pub fn upsert_runtime_status(&self, session_id: &str, status_type: &str) {
        let sid = session_id.trim();
        if sid.is_empty() {
            return;
        }
        let status = status_type.trim();
        if status.is_empty() {
            return;
        }

        let current = self.runtime_by_session.get(sid).map(|v| v.clone());
        let phase = current
            .as_ref()
            .map(|v| v.phase.clone())
            .unwrap_or_else(|| "idle".to_string());
        let attention = current.as_ref().and_then(|v| v.attention.clone());
        let effective = normalize_effective_type(status, &phase, attention.as_deref()).to_string();

        if let Some(existing) = current.as_ref()
            && existing.status_type == status
            && existing.phase == phase
            && existing.attention == attention
            && existing.effective_type == effective
        {
            return;
        }

        self.runtime_by_session.insert(
            sid.to_string(),
            RuntimeRecord {
                status_type: status.to_string(),
                phase,
                attention,
                effective_type: effective,
                updated_at: now_millis(),
            },
        );
    }

    pub fn upsert_runtime_phase(&self, session_id: &str, phase_type: &str) {
        let sid = session_id.trim();
        if sid.is_empty() {
            return;
        }
        let phase = phase_type.trim();
        if phase.is_empty() {
            return;
        }

        let current = self.runtime_by_session.get(sid).map(|v| v.clone());
        let status = current
            .as_ref()
            .map(|v| v.status_type.clone())
            .unwrap_or_else(|| "idle".to_string());
        let attention = current.as_ref().and_then(|v| v.attention.clone());
        let effective = normalize_effective_type(&status, phase, attention.as_deref()).to_string();

        if let Some(existing) = current.as_ref()
            && existing.status_type == status
            && existing.phase == phase
            && existing.attention == attention
            && existing.effective_type == effective
        {
            return;
        }

        self.runtime_by_session.insert(
            sid.to_string(),
            RuntimeRecord {
                status_type: status,
                phase: phase.to_string(),
                attention,
                effective_type: effective,
                updated_at: now_millis(),
            },
        );
    }

    pub fn upsert_runtime_attention(&self, session_id: &str, attention_kind: Option<&str>) {
        let sid = session_id.trim();
        if sid.is_empty() {
            return;
        }

        let attention = attention_kind
            .map(|v| v.trim())
            .filter(|v| !v.is_empty())
            .map(|v| v.to_ascii_lowercase())
            .and_then(|v| match v.as_str() {
                "permission" => Some("permission".to_string()),
                "question" => Some("question".to_string()),
                _ => None,
            });

        let current = self.runtime_by_session.get(sid).map(|v| v.clone());
        let status = current
            .as_ref()
            .map(|v| v.status_type.clone())
            .unwrap_or_else(|| "idle".to_string());
        let phase = current
            .as_ref()
            .map(|v| v.phase.clone())
            .unwrap_or_else(|| "idle".to_string());
        let effective = normalize_effective_type(&status, &phase, attention.as_deref()).to_string();

        if let Some(existing) = current.as_ref()
            && existing.status_type == status
            && existing.phase == phase
            && existing.attention == attention
            && existing.effective_type == effective
        {
            return;
        }

        self.runtime_by_session.insert(
            sid.to_string(),
            RuntimeRecord {
                status_type: status,
                phase,
                attention,
                effective_type: effective,
                updated_at: now_millis(),
            },
        );
    }

    pub fn reconcile_busy_set(&self, busy_ids: &HashSet<String>) {
        for sid in busy_ids {
            let trimmed = sid.trim();
            if trimmed.is_empty() {
                continue;
            }
            let current_status = self
                .runtime_by_session
                .get(trimmed)
                .map(|entry| entry.status_type.clone())
                .unwrap_or_default();
            if current_status == "busy" || current_status == "retry" {
                continue;
            }
            self.upsert_runtime_status(trimmed, "busy");
        }

        let stale: Vec<String> = self
            .runtime_by_session
            .iter()
            .filter(|entry| {
                let sid = entry.key();
                let status = entry.value().status_type.as_str();
                (status == "busy" || status == "retry") && !busy_ids.contains(sid)
            })
            .map(|entry| entry.key().to_string())
            .collect();

        for sid in stale {
            self.upsert_runtime_status(&sid, "idle");
        }
    }

    pub fn reconcile_busy_set_scoped(
        &self,
        busy_ids: &HashSet<String>,
        scope_session_ids: &HashSet<String>,
    ) {
        for sid in scope_session_ids {
            let trimmed = sid.trim();
            if trimmed.is_empty() {
                continue;
            }

            let current_status = self
                .runtime_by_session
                .get(trimmed)
                .map(|entry| entry.status_type.clone())
                .unwrap_or_default();
            let should_be_busy = busy_ids.contains(trimmed);

            if should_be_busy {
                if current_status != "busy" && current_status != "retry" {
                    self.upsert_runtime_status(trimmed, "busy");
                }
                continue;
            }

            if current_status == "busy" || current_status == "retry" {
                self.upsert_runtime_status(trimmed, "idle");
            }
        }
    }

    pub fn runtime_snapshot_json(&self) -> Value {
        let mut out = Map::new();
        for entry in self.runtime_by_session.iter() {
            out.insert(
                entry.key().to_string(),
                json!({
                    "sessionID": entry.key().to_string(),
                    "type": entry.value().effective_type,
                    "statusType": entry.value().status_type,
                    "phase": entry.value().phase,
                    "attention": entry.value().attention,
                    "updatedAt": entry.value().updated_at,
                }),
            );
        }
        Value::Object(out)
    }

    fn prune_deleted_tombstones(&self, now_ms: i64) {
        let cutoff = now_ms.saturating_sub(SESSION_DELETE_TOMBSTONE_TTL_MS);
        let stale: Vec<String> = self
            .deleted_sessions
            .iter()
            .filter(|entry| *entry.value() < cutoff)
            .map(|entry| entry.key().to_string())
            .collect();
        for sid in stale {
            self.deleted_sessions.remove(&sid);
        }
    }

    pub fn prune_stale_runtime_entries(&self, max_idle_age: Duration) {
        let max_idle_age_ms = max_idle_age.as_millis();
        if max_idle_age_ms == 0 {
            return;
        }

        let now = now_millis();
        let cutoff = now.saturating_sub(max_idle_age_ms as i64);

        let stale: Vec<String> = self
            .runtime_by_session
            .iter()
            .filter(|entry| {
                let runtime = entry.value();
                runtime.status_type == "idle"
                    && runtime.phase == "idle"
                    && runtime.attention.is_none()
                    && runtime.updated_at < cutoff
            })
            .map(|entry| entry.key().to_string())
            .collect();

        for sid in stale {
            self.runtime_by_session.remove(&sid);
        }

        self.prune_deleted_tombstones(now);
    }

    fn upsert_recent_session(
        &self,
        session_id: &str,
        directory_id: &str,
        directory_path: &str,
        updated_at: f64,
    ) {
        self.recent_sessions.lock().unwrap().upsert(
            session_id,
            directory_id,
            directory_path,
            updated_at,
        );
    }

    fn remove_recent_session(&self, session_id: &str) {
        self.recent_sessions.lock().unwrap().remove(session_id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::{Arc, Barrier};
    use std::thread;
    use std::time::Duration;

    #[test]
    fn summary_index_updates_directory_mapping() {
        let idx = DirectorySessionIndexManager::new();

        idx.upsert_summary_from_value(&json!({
            "id": "s_1",
            "directory": "/tmp/a",
            "title": "one",
            "time": { "updated": 1.0 }
        }));
        assert_eq!(idx.directory_for_session("s_1").as_deref(), Some("/tmp/a"));

        idx.upsert_summary_from_value(&json!({
            "id": "s_1",
            "directory": "/tmp/b",
            "title": "two",
            "time": { "updated": 2.0 }
        }));
        assert_eq!(idx.directory_for_session("s_1").as_deref(), Some("/tmp/b"));

        idx.remove_summary("s_1");
        assert!(idx.summary("s_1").is_none());
        assert!(idx.directory_for_session("s_1").is_none());
    }

    #[test]
    fn runtime_effective_type_prefers_phase_when_idle_status() {
        let idx = DirectorySessionIndexManager::new();

        idx.upsert_runtime_phase("s_1", "busy");
        idx.upsert_runtime_status("s_1", "idle");

        let snapshot = idx.runtime_snapshot_json();
        assert_eq!(
            snapshot
                .get("s_1")
                .and_then(|v| v.get("type"))
                .and_then(|v| v.as_str()),
            Some("busy")
        );
    }

    #[test]
    fn reconcile_runtime_status_map_updates_busy_set() {
        let idx = DirectorySessionIndexManager::new();

        let busy = idx.reconcile_runtime_status_map(&json!({
            "s_busy": { "type": "busy" },
            "s_retry": { "status": { "type": "retry" } },
            "s_idle": "idle"
        }));

        assert!(busy.contains("s_busy"));
        assert!(busy.contains("s_retry"));
        assert!(!busy.contains("s_idle"));

        let snapshot = idx.runtime_snapshot_json();
        assert_eq!(
            snapshot
                .get("s_busy")
                .and_then(|v| v.get("statusType"))
                .and_then(|v| v.as_str()),
            Some("busy")
        );
        assert_eq!(
            snapshot
                .get("s_retry")
                .and_then(|v| v.get("statusType"))
                .and_then(|v| v.as_str()),
            Some("retry")
        );
    }

    #[test]
    fn merge_runtime_status_map_does_not_clear_other_sessions() {
        let idx = DirectorySessionIndexManager::new();

        idx.reconcile_runtime_status_map(&json!({
            "s_other": { "type": "busy" }
        }));

        idx.merge_runtime_status_map(&json!({
            "s_target": { "type": "busy" }
        }));

        let snapshot = idx.runtime_snapshot_json();
        assert_eq!(
            snapshot
                .get("s_other")
                .and_then(|v| v.get("statusType"))
                .and_then(|v| v.as_str()),
            Some("busy")
        );
        assert_eq!(
            snapshot
                .get("s_target")
                .and_then(|v| v.get("statusType"))
                .and_then(|v| v.as_str()),
            Some("busy")
        );
    }

    #[test]
    fn reconcile_busy_set_resets_stale_busy_sessions_to_idle() {
        let idx = DirectorySessionIndexManager::new();

        idx.reconcile_runtime_status_map(&json!({
            "s_1": { "type": "busy" },
            "s_2": { "type": "busy" }
        }));

        let mut busy = HashSet::new();
        busy.insert("s_2".to_string());
        idx.reconcile_busy_set(&busy);

        let snapshot = idx.runtime_snapshot_json();
        assert_eq!(
            snapshot
                .get("s_1")
                .and_then(|v| v.get("statusType"))
                .and_then(|v| v.as_str()),
            Some("idle")
        );
        assert_eq!(
            snapshot
                .get("s_2")
                .and_then(|v| v.get("statusType"))
                .and_then(|v| v.as_str()),
            Some("busy")
        );
    }

    #[test]
    fn reconcile_busy_set_scoped_only_updates_target_sessions() {
        let idx = DirectorySessionIndexManager::new();

        idx.reconcile_runtime_status_map(&json!({
            "s_1": { "type": "busy" },
            "s_2": { "type": "busy" }
        }));

        let busy = HashSet::new();
        let mut scope = HashSet::new();
        scope.insert("s_1".to_string());
        idx.reconcile_busy_set_scoped(&busy, &scope);

        let snapshot = idx.runtime_snapshot_json();
        assert_eq!(
            snapshot
                .get("s_1")
                .and_then(|v| v.get("statusType"))
                .and_then(|v| v.as_str()),
            Some("idle")
        );
        assert_eq!(
            snapshot
                .get("s_2")
                .and_then(|v| v.get("statusType"))
                .and_then(|v| v.as_str()),
            Some("busy")
        );
    }

    #[test]
    fn upsert_runtime_phase_unchanged_does_not_bump_updated_at() {
        let idx = DirectorySessionIndexManager::new();

        idx.upsert_runtime_phase("s_1", "busy");
        let first = idx
            .runtime_snapshot_json()
            .get("s_1")
            .and_then(|v| v.get("updatedAt"))
            .and_then(|v| v.as_i64())
            .unwrap_or(0);

        thread::sleep(Duration::from_millis(3));
        idx.upsert_runtime_phase("s_1", "busy");

        let second = idx
            .runtime_snapshot_json()
            .get("s_1")
            .and_then(|v| v.get("updatedAt"))
            .and_then(|v| v.as_i64())
            .unwrap_or(0);

        assert_eq!(first, second);
    }

    #[test]
    fn upsert_runtime_status_unchanged_does_not_bump_updated_at() {
        let idx = DirectorySessionIndexManager::new();

        idx.upsert_runtime_status("s_1", "busy");
        let first = idx
            .runtime_snapshot_json()
            .get("s_1")
            .and_then(|v| v.get("updatedAt"))
            .and_then(|v| v.as_i64())
            .unwrap_or(0);

        thread::sleep(Duration::from_millis(3));
        idx.upsert_runtime_status("s_1", "busy");

        let second = idx
            .runtime_snapshot_json()
            .get("s_1")
            .and_then(|v| v.get("updatedAt"))
            .and_then(|v| v.as_i64())
            .unwrap_or(0);

        assert_eq!(first, second);
    }

    #[test]
    fn recent_sessions_snapshot_keeps_latest_40() {
        let idx = DirectorySessionIndexManager::new();
        idx.replace_directory_mappings(vec![("d_1".to_string(), "/tmp/a".to_string())]);

        for i in 0..50 {
            idx.upsert_summary_from_value(&json!({
                "id": format!("s_{i}"),
                "directory": "/tmp/a",
                "title": format!("session {i}"),
                "time": { "updated": i as f64 }
            }));
        }

        let recent = idx.recent_sessions_snapshot();
        assert_eq!(recent.len(), 40);
        assert_eq!(
            recent.first().map(|row| row.session_id.as_str()),
            Some("s_49")
        );
        assert_eq!(
            recent.last().map(|row| row.session_id.as_str()),
            Some("s_10")
        );

        for window in recent.windows(2) {
            assert!(window[0].updated_at >= window[1].updated_at);
        }
    }

    #[test]
    fn remove_summary_evicts_recent_session_entry() {
        let idx = DirectorySessionIndexManager::new();
        idx.replace_directory_mappings(vec![("d_1".to_string(), "/tmp/a".to_string())]);

        idx.upsert_summary_from_value(&json!({
            "id": "s_1",
            "directory": "/tmp/a",
            "title": "one",
            "time": { "updated": 10.0 }
        }));
        idx.upsert_summary_from_value(&json!({
            "id": "s_2",
            "directory": "/tmp/a",
            "title": "two",
            "time": { "updated": 9.0 }
        }));

        idx.remove_summary("s_1");
        let recent = idx.recent_sessions_snapshot();
        assert_eq!(recent.len(), 1);
        assert_eq!(recent[0].session_id, "s_2");
    }

    #[test]
    fn concurrent_first_writers_do_not_drop_directory_bucket_members() {
        let idx = DirectorySessionIndexManager::new();
        let barrier = Arc::new(Barrier::new(3));

        let idx_a = idx.clone();
        let barrier_a = barrier.clone();
        let t1 = thread::spawn(move || {
            barrier_a.wait();
            idx_a.add_session_to_directory("s_1", "/tmp/a");
        });

        let idx_b = idx.clone();
        let barrier_b = barrier.clone();
        let t2 = thread::spawn(move || {
            barrier_b.wait();
            idx_b.add_session_to_directory("s_2", "/tmp/a");
        });

        barrier.wait();
        t1.join().expect("thread 1");
        t2.join().expect("thread 2");

        let members = idx.session_ids_for_directory("/tmp/a");
        assert_eq!(members.len(), 2);
        assert!(members.contains("s_1"));
        assert!(members.contains("s_2"));
    }

    #[test]
    fn remove_summary_marks_recent_delete_tombstone() {
        let idx = DirectorySessionIndexManager::new();

        idx.upsert_summary_from_value(&json!({
            "id": "s_1",
            "directory": "/tmp/a",
            "title": "one",
            "time": { "updated": 1.0 }
        }));
        idx.remove_summary("s_1");

        assert!(idx.is_recently_deleted("s_1"));
    }

    #[test]
    fn prune_stale_runtime_entries_removes_old_idle_only() {
        let idx = DirectorySessionIndexManager::new();
        let now = now_millis();

        idx.runtime_by_session.insert(
            "s_idle_old".to_string(),
            RuntimeRecord {
                status_type: "idle".to_string(),
                phase: "idle".to_string(),
                attention: None,
                effective_type: "idle".to_string(),
                updated_at: now.saturating_sub(120_000),
            },
        );
        idx.runtime_by_session.insert(
            "s_busy_old".to_string(),
            RuntimeRecord {
                status_type: "busy".to_string(),
                phase: "busy".to_string(),
                attention: None,
                effective_type: "busy".to_string(),
                updated_at: now.saturating_sub(120_000),
            },
        );
        idx.runtime_by_session.insert(
            "s_idle_recent".to_string(),
            RuntimeRecord {
                status_type: "idle".to_string(),
                phase: "idle".to_string(),
                attention: None,
                effective_type: "idle".to_string(),
                updated_at: now,
            },
        );

        idx.prune_stale_runtime_entries(Duration::from_secs(30));

        let snapshot = idx.runtime_snapshot_json();
        assert!(snapshot.get("s_idle_old").is_none());
        assert!(snapshot.get("s_busy_old").is_some());
        assert!(snapshot.get("s_idle_recent").is_some());
    }
}
