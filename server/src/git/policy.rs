use std::sync::Arc;

use regex::Regex;
use serde_json::Value;

fn parse_bool_like(value: Option<&Value>, default_value: bool) -> bool {
    match value {
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_i64().map(|v| v != 0).unwrap_or(default_value),
        Some(Value::String(s)) => {
            let t = s.trim().to_ascii_lowercase();
            if t == "true" || t == "1" || t == "yes" || t == "on" {
                true
            } else if t == "false" || t == "0" || t == "no" || t == "off" {
                false
            } else {
                default_value
            }
        }
        _ => default_value,
    }
}

fn parse_bool_env(var_name: &str) -> Option<bool> {
    let raw = std::env::var(var_name).ok()?;
    let t = raw.trim().to_ascii_lowercase();
    if t == "true" || t == "1" || t == "yes" || t == "on" {
        Some(true)
    } else if t == "false" || t == "0" || t == "no" || t == "off" {
        Some(false)
    } else {
        None
    }
}

async fn git_flag_bool(
    state: &Arc<crate::AppState>,
    env_key: &str,
    settings_key: &str,
    default_value: bool,
) -> bool {
    if let Some(v) = parse_bool_env(env_key) {
        return v;
    }
    let settings = state.settings.read().await;
    parse_bool_like(settings.extra.get(settings_key), default_value)
}

pub(crate) async fn git_allow_force_push(state: &Arc<crate::AppState>) -> bool {
    git_flag_bool(
        state,
        "OPENCODE_STUDIO_GIT_ALLOW_FORCE_PUSH",
        "gitAllowForcePush",
        false,
    )
    .await
}

pub(crate) async fn git_allow_no_verify_commit(state: &Arc<crate::AppState>) -> bool {
    git_flag_bool(
        state,
        "OPENCODE_STUDIO_GIT_ALLOW_NO_VERIFY_COMMIT",
        "gitAllowNoVerifyCommit",
        false,
    )
    .await
}

pub(crate) async fn git_enforce_branch_protection(state: &Arc<crate::AppState>) -> bool {
    git_flag_bool(
        state,
        "OPENCODE_STUDIO_GIT_ENFORCE_BRANCH_PROTECTION",
        "gitEnforceBranchProtection",
        false,
    )
    .await
}

pub(crate) async fn git_strict_patch_validation(state: &Arc<crate::AppState>) -> bool {
    git_flag_bool(
        state,
        "OPENCODE_STUDIO_GIT_STRICT_PATCH_VALIDATION",
        "gitStrictPatchValidation",
        false,
    )
    .await
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum GitBranchProtectionPrompt {
    AlwaysCommit,
    AlwaysCommitToNewBranch,
    AlwaysPrompt,
}

impl GitBranchProtectionPrompt {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::AlwaysCommit => "alwaysCommit",
            Self::AlwaysCommitToNewBranch => "alwaysCommitToNewBranch",
            Self::AlwaysPrompt => "alwaysPrompt",
        }
    }
}

fn parse_branch_protection_prompt(value: Option<&Value>) -> GitBranchProtectionPrompt {
    let raw = match value {
        Some(Value::String(s)) => s.trim(),
        _ => "",
    };
    if raw.eq_ignore_ascii_case("alwaysCommit") {
        GitBranchProtectionPrompt::AlwaysCommit
    } else if raw.eq_ignore_ascii_case("alwaysCommitToNewBranch") {
        GitBranchProtectionPrompt::AlwaysCommitToNewBranch
    } else {
        GitBranchProtectionPrompt::AlwaysPrompt
    }
}

fn parse_string_array(value: Option<&Value>) -> Vec<String> {
    let Some(Value::Array(arr)) = value else {
        return Vec::new();
    };
    let mut out: Vec<String> = Vec::new();
    for v in arr {
        if let Value::String(s) = v {
            let t = s.trim();
            if !t.is_empty() && !out.iter().any(|it| it == t) {
                out.push(t.to_string());
            }
        }
    }
    out
}

fn wildcard_to_regex(rule: &str) -> Option<Regex> {
    let r = rule.trim();
    if r.is_empty() {
        return None;
    }
    let escaped = regex::escape(r).replace("\\*", ".*").replace("\\?", ".");
    Regex::new(&format!("^{escaped}$")).ok()
}

fn is_branch_protected(branch: &str, rules: &[String]) -> bool {
    let branch = branch.trim();
    if branch.is_empty() {
        return false;
    }
    rules
        .iter()
        .filter_map(|rule| wildcard_to_regex(rule))
        .any(|rx| rx.is_match(branch))
}

pub(crate) async fn git_branch_protection_for_branch(
    state: &Arc<crate::AppState>,
    branch: &str,
) -> Option<GitBranchProtectionPrompt> {
    let settings = state.settings.read().await;
    let rules = parse_string_array(settings.extra.get("gitBranchProtection"));
    if !is_branch_protected(branch, &rules) {
        return None;
    }
    Some(parse_branch_protection_prompt(
        settings.extra.get("gitBranchProtectionPrompt"),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wildcard_rules_match_expected_branches() {
        let rules = vec![
            "main".to_string(),
            "release/*".to_string(),
            "hotfix-?".to_string(),
        ];
        assert!(is_branch_protected("main", &rules));
        assert!(is_branch_protected("release/1.2", &rules));
        assert!(is_branch_protected("hotfix-a", &rules));
        assert!(!is_branch_protected("feature/main", &rules));
        assert!(!is_branch_protected("hotfix-abc", &rules));
    }

    #[test]
    fn prompt_defaults_to_always_prompt() {
        assert_eq!(
            parse_branch_protection_prompt(None),
            GitBranchProtectionPrompt::AlwaysPrompt
        );
        assert_eq!(
            parse_branch_protection_prompt(Some(&Value::String("alwaysCommit".to_string()))),
            GitBranchProtectionPrompt::AlwaysCommit
        );
        assert_eq!(
            parse_branch_protection_prompt(Some(&Value::String(
                "alwaysCommitToNewBranch".to_string()
            ))),
            GitBranchProtectionPrompt::AlwaysCommitToNewBranch
        );
    }

    #[test]
    fn parse_bool_env_accepts_truthy_and_falsey() {
        assert_eq!(parse_bool_env("__MISSING_ENV_KEY__"), None);
    }
}
