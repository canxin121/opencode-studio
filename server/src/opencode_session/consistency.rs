use serde::Serialize;

pub(super) const DEFAULT_DEGRADED_RETRY_AFTER_MS: usize = 180;

#[derive(Debug, Clone, Copy, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub(super) struct ResponseConsistency {
    degraded: bool,
    #[serde(skip_serializing_if = "is_zero")]
    stale_reads: usize,
    #[serde(skip_serializing_if = "is_zero")]
    transient_skips: usize,
    #[serde(skip_serializing_if = "is_zero")]
    parse_skips: usize,
    #[serde(skip_serializing_if = "is_zero")]
    io_skips: usize,
    #[serde(skip_serializing_if = "is_zero")]
    fallback_summaries: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    retry_after_ms: Option<usize>,
}

fn is_zero(value: &usize) -> bool {
    *value == 0
}

impl ResponseConsistency {
    pub(super) fn note_stale_read(&mut self) {
        self.degraded = true;
        self.stale_reads = self.stale_reads.saturating_add(1);
    }

    pub(super) fn note_transient_skip(&mut self) {
        self.degraded = true;
        self.transient_skips = self.transient_skips.saturating_add(1);
        if self.retry_after_ms.is_none() {
            self.retry_after_ms = Some(DEFAULT_DEGRADED_RETRY_AFTER_MS);
        }
    }

    pub(super) fn note_parse_skip(&mut self) {
        self.degraded = true;
        self.parse_skips = self.parse_skips.saturating_add(1);
    }

    pub(super) fn note_io_skip(&mut self) {
        self.degraded = true;
        self.io_skips = self.io_skips.saturating_add(1);
        if self.retry_after_ms.is_none() {
            self.retry_after_ms = Some(DEFAULT_DEGRADED_RETRY_AFTER_MS);
        }
    }

    pub(super) fn note_fallback_summary(&mut self) {
        self.degraded = true;
        self.fallback_summaries = self.fallback_summaries.saturating_add(1);
    }

    pub(super) fn into_option(self) -> Option<Self> {
        if self.degraded { Some(self) } else { None }
    }
}
