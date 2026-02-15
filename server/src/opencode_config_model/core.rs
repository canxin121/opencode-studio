//! Typed models for `opencode.json` / `opencode.jsonc`.
//!
//! Source schema: /home/canxin/Git/opencode_dir/opencode/opencode_config_example.rs

use std::collections::BTreeMap;

use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::primitives::{FalseOnly, HexColor, PositiveInt, ScrollSpeed, TrueOnly};

/// Top-level opencode.json config.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct OpenCodeConfig {
    /// JSON schema reference, typically "https://opencode.ai/config.json".
    #[serde(rename = "$schema")]
    pub schema: Option<String>,
    /// Theme name to use for the interface (TUI/desktop).
    pub theme: Option<String>,
    /// Keybind overrides for the TUI/desktop UI.
    pub keybinds: Option<KeybindsConfig>,
    /// Log level for opencode internal logs.
    #[serde(rename = "logLevel")]
    pub log_level: Option<LogLevel>,
    /// TUI-specific settings.
    pub tui: Option<TuiConfig>,
    /// Server config for `opencode serve` and `opencode web`.
    pub server: Option<ServerConfig>,
    /// Custom commands, keyed by command name.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub command: BTreeMap<String, CommandConfig>,
    /// Additional skill folder paths.
    pub skills: Option<SkillsConfig>,
    /// File watcher settings.
    pub watcher: Option<WatcherConfig>,
    /// Plugin specifiers (npm packages or file URLs).
    pub plugin: Option<Vec<String>>,
    /// Enable/disable snapshot tracking (git-based checkpoints).
    pub snapshot: Option<bool>,
    /// Session sharing behavior.
    pub share: Option<ShareMode>,
    /// Auto-update behavior (bool or "notify").
    pub autoupdate: Option<AutoUpdateMode>,
    /// Provider IDs to disable even if credentials are present.
    pub disabled_providers: Option<Vec<String>>,
    /// Allowlist of provider IDs. If set, only these are enabled.
    pub enabled_providers: Option<Vec<String>>,
    /// Default model in "provider/model" format (e.g. "anthropic/claude-sonnet-4-5").
    pub model: Option<String>,
    /// Small model for lightweight tasks (title generation, etc).
    pub small_model: Option<String>,
    /// Default primary agent name (must be primary).
    pub default_agent: Option<String>,
    /// Custom username shown in conversations.
    pub username: Option<String>,
    /// Agent configuration, keyed by agent name.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub agent: BTreeMap<String, AgentConfig>,
    /// Provider configuration overrides and custom providers.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub provider: BTreeMap<String, ProviderConfig>,
    /// MCP server configurations, keyed by server name.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub mcp: BTreeMap<String, McpEntry>,
    /// Formatter configuration. `false` disables all formatters.
    pub formatter: Option<FormatterSetting>,
    /// LSP server configuration. `false` disables all LSP servers.
    pub lsp: Option<LspSetting>,
    /// Extra instruction files or URLs to include.
    pub instructions: Option<Vec<String>>,
    /// Global permission rules for tools and actions.
    pub permission: Option<PermissionConfig>,
    /// Enterprise configuration (GitHub Enterprise URL, etc).
    pub enterprise: Option<EnterpriseConfig>,
    /// Context compaction settings.
    pub compaction: Option<CompactionConfig>,
    /// Experimental settings (unstable).
    pub experimental: Option<ExperimentalConfig>,

    /// Preserve unknown keys for forward compatibility with newer OpenCode.
    #[serde(flatten, default, skip_serializing_if = "BTreeMap::is_empty")]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum LogLevel {
    Debug,
    Info,
    Warn,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ShareMode {
    Manual,
    Auto,
    Disabled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum AutoUpdateMode {
    Bool(bool),
    Notify(NotifyOnly),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NotifyOnly {
    Notify,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TuiConfig {
    /// Scroll speed multiplier (min 0.001). Ignored when scroll_acceleration.enabled = true.
    pub scroll_speed: Option<ScrollSpeed>,
    /// Scroll acceleration settings.
    pub scroll_acceleration: Option<TuiScrollAcceleration>,
    /// Diff rendering style.
    pub diff_style: Option<TuiDiffStyle>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TuiScrollAcceleration {
    /// Enable macOS-style scroll acceleration.
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TuiDiffStyle {
    Auto,
    Stacked,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerConfig {
    /// Port to listen on.
    pub port: Option<PositiveInt>,
    /// Hostname to listen on.
    pub hostname: Option<String>,
    /// Enable mDNS service discovery.
    pub mdns: Option<bool>,
    /// Custom domain name for mDNS service.
    #[serde(rename = "mdnsDomain")]
    pub mdns_domain: Option<String>,
    /// Additional CORS origins.
    pub cors: Option<Vec<String>>,

    /// Preserve unknown keys for forward compatibility with newer OpenCode.
    #[serde(flatten, default, skip_serializing_if = "BTreeMap::is_empty")]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WatcherConfig {
    /// Glob patterns to ignore for file watching.
    pub ignore: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CommandConfig {
    /// Prompt template for the command (required).
    #[serde(default)]
    pub template: String,
    /// Description shown in command list.
    pub description: Option<String>,
    /// Agent name to use for this command.
    pub agent: Option<String>,
    /// Model override for this command.
    pub model: Option<String>,
    /// If true, treat as a subtask.
    pub subtask: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillsConfig {
    /// Additional paths to skill folders.
    pub paths: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AgentConfig {
    /// Model override for this agent.
    pub model: Option<String>,
    /// Default model variant for this agent.
    pub variant: Option<String>,
    /// Sampling temperature.
    pub temperature: Option<f64>,
    /// Top-p sampling.
    pub top_p: Option<f64>,
    /// System prompt for the agent.
    pub prompt: Option<String>,
    /// Disable this agent.
    pub disable: Option<bool>,
    /// Description of when to use the agent.
    pub description: Option<String>,
    /// Agent mode: primary, subagent, or all.
    pub mode: Option<AgentMode>,
    /// Hide from @ autocomplete (subagents only).
    pub hidden: Option<bool>,
    /// Provider/model-specific options (explicit field).
    pub options: Option<BTreeMap<String, Value>>,
    /// Hex color (e.g. "#FF5733") or theme color token (e.g. "primary").
    pub color: Option<AgentColor>,
    /// Max number of agentic iterations.
    pub steps: Option<PositiveInt>,
    /// Agent-specific permission rules.
    pub permission: Option<PermissionConfig>,
    /// Extra fields are passed through as model options (merged into `options`).
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentMode {
    Subagent,
    Primary,
    All,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum AgentColor {
    Hex(HexColor),
    Theme(ThemeColor),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ThemeColor {
    Primary,
    Secondary,
    Accent,
    Success,
    Warning,
    Error,
    Info,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeybindsConfig {
    /// Default: "ctrl+x".
    pub leader: Option<String>,
    /// Default: "ctrl+c,ctrl+d,<leader>q".
    pub app_exit: Option<String>,
    /// Default: "<leader>e".
    pub editor_open: Option<String>,
    /// Default: "<leader>t".
    pub theme_list: Option<String>,
    /// Default: "<leader>b".
    pub sidebar_toggle: Option<String>,
    /// Default: "none".
    pub scrollbar_toggle: Option<String>,
    /// Default: "none".
    pub username_toggle: Option<String>,
    /// Default: "<leader>s".
    pub status_view: Option<String>,
    /// Default: "<leader>x".
    pub session_export: Option<String>,
    /// Default: "<leader>n".
    pub session_new: Option<String>,
    /// Default: "<leader>l".
    pub session_list: Option<String>,
    /// Default: "<leader>g".
    pub session_timeline: Option<String>,
    /// Default: "none".
    pub session_fork: Option<String>,
    /// Default: "ctrl+r".
    pub session_rename: Option<String>,
    /// Default: "ctrl+d".
    pub session_delete: Option<String>,
    /// Default: "ctrl+d".
    pub stash_delete: Option<String>,
    /// Default: "ctrl+a".
    pub model_provider_list: Option<String>,
    /// Default: "ctrl+f".
    pub model_favorite_toggle: Option<String>,
    /// Default: "none".
    pub session_share: Option<String>,
    /// Default: "none".
    pub session_unshare: Option<String>,
    /// Default: "escape".
    pub session_interrupt: Option<String>,
    /// Default: "<leader>c".
    pub session_compact: Option<String>,
    /// Default: "pageup,ctrl+alt+b".
    pub messages_page_up: Option<String>,
    /// Default: "pagedown,ctrl+alt+f".
    pub messages_page_down: Option<String>,
    /// Default: "ctrl+alt+y".
    pub messages_line_up: Option<String>,
    /// Default: "ctrl+alt+e".
    pub messages_line_down: Option<String>,
    /// Default: "ctrl+alt+u".
    pub messages_half_page_up: Option<String>,
    /// Default: "ctrl+alt+d".
    pub messages_half_page_down: Option<String>,
    /// Default: "ctrl+g,home".
    pub messages_first: Option<String>,
    /// Default: "ctrl+alt+g,end".
    pub messages_last: Option<String>,
    /// Default: "none".
    pub messages_next: Option<String>,
    /// Default: "none".
    pub messages_previous: Option<String>,
    /// Default: "none".
    pub messages_last_user: Option<String>,
    /// Default: "<leader>y".
    pub messages_copy: Option<String>,
    /// Default: "<leader>u".
    pub messages_undo: Option<String>,
    /// Default: "<leader>r".
    pub messages_redo: Option<String>,
    /// Default: "<leader>h".
    pub messages_toggle_conceal: Option<String>,
    /// Default: "none".
    pub tool_details: Option<String>,
    /// Default: "<leader>m".
    pub model_list: Option<String>,
    /// Default: "f2".
    pub model_cycle_recent: Option<String>,
    /// Default: "shift+f2".
    pub model_cycle_recent_reverse: Option<String>,
    /// Default: "none".
    pub model_cycle_favorite: Option<String>,
    /// Default: "none".
    pub model_cycle_favorite_reverse: Option<String>,
    /// Default: "ctrl+p".
    pub command_list: Option<String>,
    /// Default: "<leader>a".
    pub agent_list: Option<String>,
    /// Default: "tab".
    pub agent_cycle: Option<String>,
    /// Default: "shift+tab".
    pub agent_cycle_reverse: Option<String>,
    /// Default: "ctrl+t".
    pub variant_cycle: Option<String>,
    /// Default: "ctrl+c".
    pub input_clear: Option<String>,
    /// Default: "ctrl+v".
    pub input_paste: Option<String>,
    /// Default: "return".
    pub input_submit: Option<String>,
    /// Default: "shift+return,ctrl+return,alt+return,ctrl+j".
    pub input_newline: Option<String>,
    /// Default: "left,ctrl+b".
    pub input_move_left: Option<String>,
    /// Default: "right,ctrl+f".
    pub input_move_right: Option<String>,
    /// Default: "up".
    pub input_move_up: Option<String>,
    /// Default: "down".
    pub input_move_down: Option<String>,
    /// Default: "shift+left".
    pub input_select_left: Option<String>,
    /// Default: "shift+right".
    pub input_select_right: Option<String>,
    /// Default: "shift+up".
    pub input_select_up: Option<String>,
    /// Default: "shift+down".
    pub input_select_down: Option<String>,
    /// Default: "ctrl+a".
    pub input_line_home: Option<String>,
    /// Default: "ctrl+e".
    pub input_line_end: Option<String>,
    /// Default: "ctrl+shift+a".
    pub input_select_line_home: Option<String>,
    /// Default: "ctrl+shift+e".
    pub input_select_line_end: Option<String>,
    /// Default: "alt+a".
    pub input_visual_line_home: Option<String>,
    /// Default: "alt+e".
    pub input_visual_line_end: Option<String>,
    /// Default: "alt+shift+a".
    pub input_select_visual_line_home: Option<String>,
    /// Default: "alt+shift+e".
    pub input_select_visual_line_end: Option<String>,
    /// Default: "home".
    pub input_buffer_home: Option<String>,
    /// Default: "end".
    pub input_buffer_end: Option<String>,
    /// Default: "shift+home".
    pub input_select_buffer_home: Option<String>,
    /// Default: "shift+end".
    pub input_select_buffer_end: Option<String>,
    /// Default: "ctrl+shift+d".
    pub input_delete_line: Option<String>,
    /// Default: "ctrl+k".
    pub input_delete_to_line_end: Option<String>,
    /// Default: "ctrl+u".
    pub input_delete_to_line_start: Option<String>,
    /// Default: "backspace,shift+backspace".
    pub input_backspace: Option<String>,
    /// Default: "ctrl+d,delete,shift+delete".
    pub input_delete: Option<String>,
    /// Default: "ctrl+-,super+z".
    pub input_undo: Option<String>,
    /// Default: "ctrl+.,super+shift+z".
    pub input_redo: Option<String>,
    /// Default: "alt+f,alt+right,ctrl+right".
    pub input_word_forward: Option<String>,
    /// Default: "alt+b,alt+left,ctrl+left".
    pub input_word_backward: Option<String>,
    /// Default: "alt+shift+f,alt+shift+right".
    pub input_select_word_forward: Option<String>,
    /// Default: "alt+shift+b,alt+shift+left".
    pub input_select_word_backward: Option<String>,
    /// Default: "alt+d,alt+delete,ctrl+delete".
    pub input_delete_word_forward: Option<String>,
    /// Default: "ctrl+w,ctrl+backspace,alt+backspace".
    pub input_delete_word_backward: Option<String>,
    /// Default: "up".
    pub history_previous: Option<String>,
    /// Default: "down".
    pub history_next: Option<String>,
    /// Default: "<leader>right".
    pub session_child_cycle: Option<String>,
    /// Default: "<leader>left".
    pub session_child_cycle_reverse: Option<String>,
    /// Default: "<leader>up".
    pub session_parent: Option<String>,
    /// Default: "ctrl+z".
    pub terminal_suspend: Option<String>,
    /// Default: "none".
    pub terminal_title_toggle: Option<String>,
    /// Default: "<leader>h".
    pub tips_toggle: Option<String>,
    /// Default: "none".
    pub display_thinking: Option<String>,

    /// Preserve unknown keys for forward compatibility with newer OpenCode.
    #[serde(flatten, default, skip_serializing_if = "BTreeMap::is_empty")]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
#[allow(clippy::large_enum_variant)]
pub enum PermissionConfig {
    /// A single action applied as a global rule (equivalent to {"*": action}).
    Action(PermissionAction),
    /// Per-tool rules (with optional pattern maps).
    Map(PermissionMap),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionMap {
    /// Internal key order (not intended for manual editing).
    #[serde(rename = "__originalKeys")]
    pub original_keys: Option<Vec<String>>,
    /// Global rule for all tools ("*").
    #[serde(rename = "*")]
    pub any: Option<PermissionRule>,
    pub read: Option<PermissionRule>,
    pub edit: Option<PermissionRule>,
    pub glob: Option<PermissionRule>,
    pub grep: Option<PermissionRule>,
    pub list: Option<PermissionRule>,
    pub bash: Option<PermissionRule>,
    pub task: Option<PermissionRule>,
    /// Skill tool permissions (allowed via catchall in the schema).
    pub skill: Option<PermissionRule>,
    pub external_directory: Option<PermissionRule>,
    pub todowrite: Option<PermissionAction>,
    pub todoread: Option<PermissionAction>,
    pub question: Option<PermissionAction>,
    pub webfetch: Option<PermissionAction>,
    pub websearch: Option<PermissionAction>,
    pub codesearch: Option<PermissionAction>,
    pub lsp: Option<PermissionRule>,
    pub doom_loop: Option<PermissionAction>,
    /// Catch-all for custom tools (including MCP and skills).
    #[serde(flatten)]
    pub other: BTreeMap<String, PermissionRule>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum PermissionRule {
    /// A single action (allow/ask/deny).
    Action(PermissionAction),
    /// Pattern map where keys are glob-like patterns and values are actions.
    /// Order matters (last matching rule wins), so preserve insertion order.
    PatternMap(IndexMap<String, PermissionAction>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PermissionAction {
    Ask,
    Allow,
    Deny,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderConfig {
    /// API base URL override for model list (custom providers).
    pub api: Option<String>,
    /// Display name.
    pub name: Option<String>,
    /// Environment variable names checked for credentials.
    pub env: Option<Vec<String>>,
    /// Optional provider id override (usually derived from the map key).
    pub id: Option<String>,
    /// AI SDK package (e.g. "@ai-sdk/openai-compatible").
    pub npm: Option<String>,
    /// Allowlist of model IDs.
    pub whitelist: Option<Vec<String>>,
    /// Blocklist of model IDs.
    pub blacklist: Option<Vec<String>>,
    /// Per-model overrides and additions.
    pub models: Option<BTreeMap<String, ProviderModelConfig>>,
    /// Provider options (common + provider-specific).
    pub options: Option<ProviderOptions>,

    /// Preserve unknown keys for forward compatibility with newer OpenCode.
    #[serde(flatten, default, skip_serializing_if = "BTreeMap::is_empty")]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderOptions {
    /// API key override (can use {env:VAR} or {file:path}).
    #[serde(rename = "apiKey")]
    pub api_key: Option<String>,
    /// Base URL override (proxies, local servers, gateways).
    #[serde(rename = "baseURL")]
    pub base_url: Option<String>,
    /// GitHub Enterprise URL for copilot authentication.
    #[serde(rename = "enterpriseUrl")]
    pub enterprise_url: Option<String>,
    /// Force prompt cache key support (default false).
    #[serde(rename = "setCacheKey")]
    pub set_cache_key: Option<bool>,
    /// Timeout in ms. Use false to disable.
    pub timeout: Option<TimeoutSetting>,
    /// Extra HTTP headers (used by gateways like Helicone).
    pub headers: Option<BTreeMap<String, String>>,
    /// Include usage metadata for OpenAI-compatible providers.
    #[serde(rename = "includeUsage")]
    pub include_usage: Option<bool>,
    /// Azure-only: use completion URLs rather than Responses API.
    #[serde(rename = "useCompletionUrls")]
    pub use_completion_urls: Option<bool>,
    /// Amazon Bedrock: AWS region.
    pub region: Option<String>,
    /// Amazon Bedrock: AWS profile name.
    pub profile: Option<String>,
    /// Amazon Bedrock: custom endpoint (alias of baseURL, takes precedence).
    pub endpoint: Option<String>,
    /// Google Vertex: project id.
    pub project: Option<String>,
    /// Google Vertex: location/region.
    pub location: Option<String>,
    /// SAP AI Core: deployment id.
    #[serde(rename = "deploymentId")]
    pub deployment_id: Option<String>,
    /// SAP AI Core: resource group.
    #[serde(rename = "resourceGroup")]
    pub resource_group: Option<String>,
    /// GitLab: instance URL.
    #[serde(rename = "instanceUrl")]
    pub instance_url: Option<String>,
    /// GitLab: feature flags map.
    #[serde(rename = "featureFlags")]
    pub feature_flags: Option<BTreeMap<String, bool>>,
    /// Provider-specific options (open-ended).
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum TimeoutSetting {
    /// Milliseconds (positive int).
    Ms(PositiveInt),
    /// Explicitly disable timeouts (expects false).
    Disabled(FalseOnly),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderModelConfig {
    /// Model id override (API id).
    pub id: Option<String>,
    /// Display name.
    pub name: Option<String>,
    /// Model family.
    pub family: Option<String>,
    /// Release date string.
    pub release_date: Option<String>,
    /// Supports file attachments.
    pub attachment: Option<bool>,
    /// Supports reasoning output.
    pub reasoning: Option<bool>,
    /// Supports temperature parameter.
    pub temperature: Option<bool>,
    /// Supports tool calls.
    pub tool_call: Option<bool>,
    /// Interleaved reasoning config.
    pub interleaved: Option<InterleavedConfig>,
    /// Cost config (per-token pricing).
    pub cost: Option<ModelCostConfig>,
    /// Token limits.
    pub limit: Option<ModelLimitConfig>,
    /// Supported input/output modalities.
    pub modalities: Option<ModelModalitiesConfig>,
    /// Experimental flag.
    pub experimental: Option<bool>,
    /// Model status (alpha/beta/deprecated).
    pub status: Option<ModelStatus>,
    /// Model-specific options (provider-defined).
    pub options: Option<BTreeMap<String, Value>>,
    /// Per-model headers.
    pub headers: Option<BTreeMap<String, String>>,
    /// Provider override for this model (npm package).
    pub provider: Option<ModelProviderConfig>,
    /// Variant overrides; use disabled=true to remove a variant.
    pub variants: Option<BTreeMap<String, ModelVariantConfig>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum InterleavedConfig {
    Enabled(TrueOnly),
    Field { field: InterleavedField },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InterleavedField {
    ReasoningContent,
    ReasoningDetails,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelCostConfig {
    pub input: f64,
    pub output: f64,
    pub cache_read: Option<f64>,
    pub cache_write: Option<f64>,
    pub context_over_200k: Option<ModelCostOver200kConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelCostOver200kConfig {
    pub input: f64,
    pub output: f64,
    pub cache_read: Option<f64>,
    pub cache_write: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelLimitConfig {
    pub context: f64,
    pub input: Option<f64>,
    pub output: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelModalitiesConfig {
    pub input: Vec<ModelModality>,
    pub output: Vec<ModelModality>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ModelModality {
    Text,
    Audio,
    Image,
    Video,
    Pdf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ModelStatus {
    Alpha,
    Beta,
    Deprecated,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelProviderConfig {
    pub npm: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelVariantConfig {
    /// If true, this variant is removed from the model list.
    pub disabled: Option<bool>,
    /// Variant-specific overrides (open-ended).
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum McpEntry {
    /// Full MCP server definition.
    Server(McpServerConfig),
    /// Minimal override (typically for remote defaults).
    Toggle(McpToggle),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum McpServerConfig {
    Local(McpLocalConfig),
    Remote(McpRemoteConfig),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpToggle {
    pub enabled: bool,

    /// Preserve unknown keys for forward compatibility with newer OpenCode.
    #[serde(flatten, default, skip_serializing_if = "BTreeMap::is_empty")]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpLocalConfig {
    /// Command and args to launch the server.
    pub command: Vec<String>,
    /// Environment variables for the server process.
    pub environment: Option<BTreeMap<String, String>>,
    /// Enable or disable this server.
    pub enabled: Option<bool>,
    /// Timeout in ms for MCP server requests.
    pub timeout: Option<PositiveInt>,

    /// Preserve unknown keys for forward compatibility with newer OpenCode.
    #[serde(flatten, default, skip_serializing_if = "BTreeMap::is_empty")]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpRemoteConfig {
    /// Remote MCP URL.
    pub url: String,
    /// Enable or disable this server.
    pub enabled: Option<bool>,
    /// Headers sent with MCP requests.
    pub headers: Option<BTreeMap<String, String>>,
    /// OAuth config or false to disable auto-detection.
    pub oauth: Option<McpOauthSetting>,
    /// Timeout in ms for MCP server requests.
    pub timeout: Option<PositiveInt>,

    /// Preserve unknown keys for forward compatibility with newer OpenCode.
    #[serde(flatten, default, skip_serializing_if = "BTreeMap::is_empty")]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum McpOauthSetting {
    Config(McpOauthConfig),
    Disabled(FalseOnly),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpOauthConfig {
    #[serde(rename = "clientId")]
    pub client_id: Option<String>,
    #[serde(rename = "clientSecret")]
    pub client_secret: Option<String>,
    pub scope: Option<String>,

    /// Preserve unknown keys for forward compatibility with newer OpenCode.
    #[serde(flatten, default, skip_serializing_if = "BTreeMap::is_empty")]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum FormatterSetting {
    Disabled(FalseOnly),
    Formatters(BTreeMap<String, FormatterConfig>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FormatterConfig {
    /// Disable this formatter.
    pub disabled: Option<bool>,
    /// Command to run. Use $FILE as a placeholder.
    pub command: Option<Vec<String>>,
    /// Environment variables for the formatter process.
    pub environment: Option<BTreeMap<String, String>>,
    /// File extensions handled by this formatter.
    pub extensions: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum LspSetting {
    Disabled(FalseOnly),
    Servers(BTreeMap<String, LspServerConfig>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum LspServerConfig {
    Disabled {
        /// Disable this LSP server.
        disabled: TrueOnly,
    },
    Config {
        /// Command to start the LSP server.
        command: Vec<String>,
        /// File extensions handled by this server (required for custom servers).
        extensions: Option<Vec<String>>,
        /// Disable this LSP server.
        disabled: Option<bool>,
        /// Environment variables for the LSP server process.
        env: Option<BTreeMap<String, String>>,
        /// Initialization options passed to the server.
        initialization: Option<BTreeMap<String, Value>>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnterpriseConfig {
    /// Enterprise URL (e.g. GitHub Enterprise).
    pub url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompactionConfig {
    /// Auto-compact when context is full (default true).
    pub auto: Option<bool>,
    /// Prune old tool outputs (default true).
    pub prune: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExperimentalConfig {
    /// Disable paste summary in the UI.
    pub disable_paste_summary: Option<bool>,
    /// Enable the batch tool.
    pub batch_tool: Option<bool>,
    /// Enable OpenTelemetry spans for AI SDK calls.
    #[serde(rename = "openTelemetry")]
    pub open_telemetry: Option<bool>,
    /// Tools that should only be available to primary agents.
    pub primary_tools: Option<Vec<String>>,
    /// Continue agent loop when a tool call is denied.
    pub continue_loop_on_deny: Option<bool>,
    /// MCP timeout in ms (overrides default).
    pub mcp_timeout: Option<PositiveInt>,
}

const BUILTIN_LSP_IDS: &[&str] = &[
    "deno",
    "typescript",
    "vue",
    "eslint",
    "oxlint",
    "biome",
    "gopls",
    "ruby-lsp",
    "ty",
    "pyright",
    "elixir-ls",
    "zls",
    "csharp",
    "fsharp",
    "sourcekit-lsp",
    "rust",
    "clangd",
    "svelte",
    "astro",
    "jdtls",
    "kotlin-ls",
    "yaml-ls",
    "lua-ls",
    "php intelephense",
    "prisma",
    "dart",
    "ocaml-lsp",
    "bash",
    "terraform",
    "texlab",
    "dockerfile",
    "gleam",
    "clojure-lsp",
    "nixd",
    "tinymist",
    "haskell-language-server",
];

impl OpenCodeConfig {
    pub fn validate(&self) -> Result<(), String> {
        self.validate_lsp()
    }

    fn validate_lsp(&self) -> Result<(), String> {
        let servers = match &self.lsp {
            Some(LspSetting::Servers(servers)) => servers,
            _ => return Ok(()),
        };

        for (id, config) in servers {
            let disabled = match config {
                LspServerConfig::Disabled { .. } => true,
                LspServerConfig::Config { disabled, .. } => disabled.unwrap_or(false),
            };
            if disabled {
                continue;
            }
            if BUILTIN_LSP_IDS.contains(&id.as_str()) {
                continue;
            }

            let extensions = match config {
                LspServerConfig::Disabled { .. } => None,
                LspServerConfig::Config { extensions, .. } => extensions.as_ref(),
            };
            if extensions.is_some() {
                continue;
            }

            return Err(format!("custom LSP server '{id}' requires extensions"));
        }

        Ok(())
    }
}
