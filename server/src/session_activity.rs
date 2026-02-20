use std::collections::HashSet;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use std::time::{SystemTime, UNIX_EPOCH};

use dashmap::DashMap;
use serde_json::Value;
use tokio::sync::oneshot;

const SESSION_COOLDOWN_DURATION: Duration = Duration::from_millis(2000);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionPhase {
    Idle,
    Busy,
    Cooldown,
}

impl SessionPhase {
    pub fn as_str(&self) -> &'static str {
        match self {
            SessionPhase::Idle => "idle",
            SessionPhase::Busy => "busy",
            SessionPhase::Cooldown => "cooldown",
        }
    }
}

#[derive(Debug, Clone)]
struct PhaseRecord {
    phase: SessionPhase,
    updated_at: u64,
}

#[derive(Debug)]
struct CooldownHandle {
    token: u64,
    cancel: oneshot::Sender<()>,
}

#[derive(Clone)]
pub struct SessionActivityManager {
    phases: Arc<DashMap<String, PhaseRecord>>, // sessionID -> record
    cooldown_cancel: Arc<DashMap<String, CooldownHandle>>,
    next_cooldown_token: Arc<AtomicU64>,
}

impl SessionActivityManager {
    pub fn new() -> Self {
        Self {
            phases: Arc::new(DashMap::new()),
            cooldown_cancel: Arc::new(DashMap::new()),
            next_cooldown_token: Arc::new(AtomicU64::new(1)),
        }
    }

    pub fn snapshot_json(&self) -> Value {
        let mut out = serde_json::Map::new();
        for entry in self.phases.iter() {
            out.insert(
                entry.key().to_string(),
                serde_json::json!({"type": entry.value().phase.as_str()}),
            );
        }
        Value::Object(out)
    }

    fn now_millis() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_millis() as u64)
            .unwrap_or(0)
    }

    pub fn set_phase(&self, session_id: &str, phase: SessionPhase) {
        let session_id = session_id.trim();
        if session_id.is_empty() {
            return;
        }

        let now = Self::now_millis();
        let existing_phase = self.phases.get(session_id).map(|entry| entry.phase);
        let phase_changed = existing_phase != Some(phase);

        // Cancel existing cooldown timer whenever phase changes or when leaving cooldown.
        if (phase_changed || phase != SessionPhase::Cooldown)
            && let Some((_, handle)) = self.cooldown_cancel.remove(session_id)
        {
            let _ = handle.cancel.send(());
        }

        self.phases.insert(
            session_id.to_string(),
            PhaseRecord {
                phase,
                updated_at: now,
            },
        );

        if phase != SessionPhase::Cooldown {
            return;
        }

        // Keep the existing timer when the phase is unchanged and a timer is already active.
        if !phase_changed && self.cooldown_cancel.contains_key(session_id) {
            return;
        }

        // Schedule cooldown -> idle transition.
        let token = self.next_cooldown_token.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = oneshot::channel::<()>();
        self.cooldown_cancel
            .insert(session_id.to_string(), CooldownHandle { token, cancel: tx });
        let phases = self.phases.clone();
        let cooldown_cancel = self.cooldown_cancel.clone();
        let sid = session_id.to_string();

        tokio::spawn(async move {
            tokio::select! {
                _ = tokio::time::sleep(SESSION_COOLDOWN_DURATION) => {
                    if phases
                        .get(&sid)
                        .is_some_and(|rec| rec.phase == SessionPhase::Cooldown)
                    {
                        phases.insert(
                            sid.clone(),
                            PhaseRecord {
                                phase: SessionPhase::Idle,
                                updated_at: Self::now_millis(),
                            },
                        );
                    }
                }
                _ = rx => {
                    // cancelled
                }
            }

            if let Some(entry) = cooldown_cancel.get(&sid)
                && entry.token == token
            {
                drop(entry);
                cooldown_cancel.remove(&sid);
            }
        });
    }

    pub fn prune_stale_idle_entries(&self, max_idle_age: Duration) {
        let max_idle_age_ms = max_idle_age.as_millis();
        if max_idle_age_ms == 0 {
            return;
        }

        let now = Self::now_millis();
        let cutoff = now.saturating_sub(max_idle_age_ms as u64);
        let stale: Vec<String> = self
            .phases
            .iter()
            .filter(|entry| {
                let record = entry.value();
                record.phase == SessionPhase::Idle && record.updated_at < cutoff
            })
            .map(|entry| entry.key().to_string())
            .collect();

        for sid in stale {
            self.phases.remove(&sid);
            if let Some((_, handle)) = self.cooldown_cancel.remove(&sid) {
                let _ = handle.cancel.send(());
            }
        }
    }

    /// Best-effort reconciliation using an authoritative busy set.
    ///
    /// This fixes the common case where the server missed a terminal session.idle while
    /// no SSE clients were connected, leaving the snapshot stuck in `busy`.
    pub fn reconcile_busy_set(&self, busy_ids: &HashSet<String>) {
        // Mark currently busy sessions as busy.
        for sid in busy_ids.iter() {
            self.set_phase(sid, SessionPhase::Busy);
        }

        // Clear stale busy phases.
        let stale_busy: Vec<String> = self
            .phases
            .iter()
            .filter(|e| e.value().phase == SessionPhase::Busy)
            .map(|e| e.key().to_string())
            .collect();
        for sid in stale_busy {
            if !busy_ids.contains(&sid) {
                self.set_phase(&sid, SessionPhase::Idle);
            }
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

            if busy_ids.contains(trimmed) {
                self.set_phase(trimmed, SessionPhase::Busy);
                continue;
            }

            let is_busy = self
                .phases
                .get(trimmed)
                .is_some_and(|entry| entry.phase == SessionPhase::Busy);
            if is_busy {
                self.set_phase(trimmed, SessionPhase::Idle);
            }
        }
    }
}

fn parse_sse_data_json(block: &str) -> Option<Value> {
    if block.trim().is_empty() {
        return None;
    }

    let data_lines: Vec<&str> = block
        .lines()
        .filter_map(|line| {
            let line = line.trim_end();
            line.strip_prefix("data:").map(|rest| rest.trim_start())
        })
        .collect();

    if data_lines.is_empty() {
        return None;
    }

    let payload_text = data_lines.join("\n").trim().to_string();
    if payload_text.is_empty() {
        return None;
    }

    serde_json::from_str(&payload_text).ok()
}

/// Parse OpenCode SSE blocks (flat or wrapped): `data: { type, properties }` or `data: { directory, payload }`.
pub fn parse_sse_data_payload(block: &str) -> Option<Value> {
    let parsed = parse_sse_data_json(block)?;
    let obj = parsed.as_object()?;
    if obj.get("type").and_then(|v| v.as_str()).is_some() {
        return Some(parsed);
    }
    let payload = obj.get("payload")?;
    if payload.get("type").and_then(|v| v.as_str()).is_some() {
        return Some(payload.clone());
    }
    None
}

fn read_session_id(props: Option<&serde_json::Map<String, Value>>) -> Option<String> {
    props
        .and_then(|p| {
            p.get("sessionID")
                .or_else(|| p.get("sessionId"))
                .or_else(|| p.get("session_id"))
                .and_then(|v| v.as_str())
        })
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

pub fn derive_session_activity(payload: &Value) -> Option<(String, SessionPhase)> {
    let obj = payload.as_object()?;
    let ty = obj.get("type").and_then(|v| v.as_str()).unwrap_or("");

    if ty == "session.status" {
        let props = obj.get("properties").and_then(|v| v.as_object());
        let status = props
            .and_then(|p| p.get("status"))
            .and_then(|v| v.as_object());
        let session_id = read_session_id(props);
        let status_type = status.and_then(|s| s.get("type")).and_then(|v| v.as_str());

        if let (Some(session_id), Some(status_type)) = (session_id, status_type) {
            let phase = if status_type == "busy" || status_type == "retry" {
                SessionPhase::Busy
            } else {
                SessionPhase::Idle
            };
            return Some((session_id, phase));
        }
    }

    if ty == "message.updated" || ty == "message.part.updated" {
        let props = obj.get("properties").and_then(|v| v.as_object());
        let info = props
            .and_then(|p| p.get("info"))
            .and_then(|v| v.as_object());
        let read_session_id_from = |map: Option<&serde_json::Map<String, Value>>| {
            map.and_then(|m| {
                m.get("sessionID")
                    .or_else(|| m.get("sessionId"))
                    .or_else(|| m.get("session_id"))
                    .and_then(|v| v.as_str())
            })
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty())
        };
        let session_id = read_session_id_from(info).or_else(|| read_session_id_from(props));
        let role = info.and_then(|i| i.get("role")).and_then(|v| v.as_str());
        let finish = info.and_then(|i| i.get("finish")).and_then(|v| v.as_str());
        if let (Some(session_id), Some("assistant"), Some("stop")) = (session_id, role, finish) {
            return Some((session_id, SessionPhase::Cooldown));
        }
    }

    if ty == "session.idle" {
        let props = obj.get("properties").and_then(|v| v.as_object());
        let session_id = read_session_id(props);
        if let Some(session_id) = session_id {
            return Some((session_id, SessionPhase::Idle));
        }
    }

    if ty == "session.error" {
        // Treat errors as terminal for the current run; avoid leaving the UI stuck "busy".
        let props = obj.get("properties").and_then(|v| v.as_object());
        let session_id = read_session_id(props);
        if let Some(session_id) = session_id {
            return Some((session_id, SessionPhase::Idle));
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::time::{Duration, sleep};

    #[test]
    fn parse_flat_event_requires_type() {
        let block = r#"data: {"type":"session.idle","properties":{"sessionID":"s_1"}}"#;
        let v = parse_sse_data_payload(block).expect("parsed");
        assert_eq!(v.get("type").and_then(|v| v.as_str()), Some("session.idle"));
    }

    #[test]
    fn parse_wrapped_event_extracts_payload() {
        let block = r#"data: {"directory":"/tmp","payload":{"type":"session.status","properties":{"sessionID":"s_1","status":{"type":"busy"}}}}"#;
        let v = parse_sse_data_payload(block).expect("parsed");
        assert_eq!(
            v.get("type").and_then(|v| v.as_str()),
            Some("session.status")
        );
    }

    #[test]
    fn derive_session_activity_supports_session_id_variants() {
        let payload = serde_json::json!({
            "type": "session.status",
            "properties": {
                "sessionId": "s_1",
                "status": { "type": "busy" }
            }
        });

        let derived = derive_session_activity(&payload);
        assert_eq!(derived, Some(("s_1".to_string(), SessionPhase::Busy)));
    }

    #[test]
    fn derive_session_activity_cooldown_accepts_session_id_variants() {
        let payload = serde_json::json!({
            "type": "message.updated",
            "properties": {
                "info": {
                    "sessionId": "s_1",
                    "role": "assistant",
                    "finish": "stop"
                }
            }
        });

        let derived = derive_session_activity(&payload);
        assert_eq!(derived, Some(("s_1".to_string(), SessionPhase::Cooldown)));
    }

    #[test]
    fn reconcile_busy_set_scoped_does_not_clear_outside_scope() {
        let mgr = SessionActivityManager::new();

        mgr.set_phase("s_1", SessionPhase::Busy);
        mgr.set_phase("s_2", SessionPhase::Busy);

        let busy = HashSet::new();
        let mut scope = HashSet::new();
        scope.insert("s_1".to_string());
        mgr.reconcile_busy_set_scoped(&busy, &scope);

        let snapshot = mgr.snapshot_json();
        assert_eq!(
            snapshot
                .get("s_1")
                .and_then(|v| v.get("type"))
                .and_then(|v| v.as_str()),
            Some("idle")
        );
        assert_eq!(
            snapshot
                .get("s_2")
                .and_then(|v| v.get("type"))
                .and_then(|v| v.as_str()),
            Some("busy")
        );
    }

    #[tokio::test]
    async fn cooldown_phase_retrigger_keeps_timer_and_cleans_handle() {
        let mgr = SessionActivityManager::new();

        mgr.set_phase("s_1", SessionPhase::Cooldown);
        mgr.set_phase("s_1", SessionPhase::Cooldown);

        sleep(SESSION_COOLDOWN_DURATION + Duration::from_millis(200)).await;

        let snapshot = mgr.snapshot_json();
        assert_eq!(
            snapshot
                .get("s_1")
                .and_then(|v| v.get("type"))
                .and_then(|v| v.as_str()),
            Some("idle")
        );
        assert!(mgr.cooldown_cancel.get("s_1").is_none());
    }

    #[tokio::test]
    async fn cooldown_cancellation_cleans_handle() {
        let mgr = SessionActivityManager::new();

        mgr.set_phase("s_1", SessionPhase::Cooldown);
        mgr.set_phase("s_1", SessionPhase::Busy);
        sleep(Duration::from_millis(50)).await;

        assert!(mgr.cooldown_cancel.get("s_1").is_none());
    }

    #[test]
    fn prune_stale_idle_entries_removes_old_idle_only() {
        let mgr = SessionActivityManager::new();
        let now = SessionActivityManager::now_millis();

        mgr.phases.insert(
            "s_idle_old".to_string(),
            PhaseRecord {
                phase: SessionPhase::Idle,
                updated_at: now.saturating_sub(120_000),
            },
        );
        mgr.phases.insert(
            "s_busy_old".to_string(),
            PhaseRecord {
                phase: SessionPhase::Busy,
                updated_at: now.saturating_sub(120_000),
            },
        );

        mgr.prune_stale_idle_entries(Duration::from_secs(30));
        let snapshot = mgr.snapshot_json();

        assert!(snapshot.get("s_idle_old").is_none());
        assert_eq!(
            snapshot
                .get("s_busy_old")
                .and_then(|v| v.get("type"))
                .and_then(|v| v.as_str()),
            Some("busy")
        );
    }
}
