//! SiSu二次开发 boot: prefer ~/.sisu identity, never require an xAI login,
//! and keep grok-build telemetry off unless the user opts back in.

use std::path::PathBuf;

fn sisu_home() -> Option<PathBuf> {
    if let Some(home) = std::env::var_os("SISU_HOME").filter(|value| !value.is_empty()) {
        return Some(PathBuf::from(home));
    }
    // pager-bin does not depend on `dirs`; HOME is enough (Windows pager is out of scope).
    std::env::var_os("HOME")
        .filter(|value| !value.is_empty())
        .map(|home| PathBuf::from(home).join(".sisu"))
}

/// Apply SiSu identity before clap/auth. Safe to call more than once.
///
/// When `SISU_ACCESS_POINT=1`, the host already set the contract: do not
/// derive `GROK_HOME` from `~/.sisu` and do not inject `XAI_API_KEY` from
/// `auth.json`.
pub fn apply() {
    // Rust 1.94+: env::set_var is unsafe. This runs once at process start
    // before any threads are spawned by the pager.
    unsafe {
        if std::env::var_os("GROK_TELEMETRY_ENABLED").is_none() {
            std::env::set_var("GROK_TELEMETRY_ENABLED", "0");
        }
        if std::env::var("SISU_ACCESS_POINT").ok().as_deref() == Some("1") {
            return;
        }
        if std::env::var_os("GROK_HOME").is_none() {
            if let Some(home) = sisu_home() {
                std::env::set_var("GROK_HOME", home);
            }
        }
        let Some(home) = sisu_home() else {
            return;
        };
        let Ok(raw) = std::fs::read_to_string(home.join("auth.json")) else {
            return;
        };
        let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) else {
            return;
        };
        if std::env::var_os("XAI_API_KEY").is_none() {
            if let Some(token) = value.get("token").and_then(|item| item.as_str()) {
                if !token.is_empty() {
                    std::env::set_var("XAI_API_KEY", token);
                }
            }
        }
        if let Some(api_base) = value.get("api_base").and_then(|item| item.as_str()) {
            if !api_base.is_empty() {
                let base = api_base.trim_end_matches('/');
                let runtime = format!("{base}/api/runtime/v1");
                // grok-build EndpointsConfig reads GROK_XAI_API_BASE_URL.
                if std::env::var_os("GROK_XAI_API_BASE_URL").is_none() {
                    std::env::set_var("GROK_XAI_API_BASE_URL", &runtime);
                }
                if std::env::var_os("XAI_API_BASE_URL").is_none() {
                    std::env::set_var("XAI_API_BASE_URL", &runtime);
                }
            }
        }
    }
}
