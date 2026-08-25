//! Access-point flag + SiSu session bearer. Shared by catalog, credentials, and chrome.

use std::path::{Path, PathBuf};

pub const HOST_LOGIN_EXIT_CODE: i32 = 10;

pub fn active() -> bool {
    std::env::var("SISU_ACCESS_POINT").ok().as_deref() == Some("1")
}

pub fn is_sisu_runtime_url(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    lower.contains("/api/runtime/v1") && !lower.contains("api.x.ai") && !lower.contains("grok.com")
}

/// Host-pinned inference URL. Catalog `baseUrl` cannot retarget api.x.ai.
pub fn pin_runtime_url(candidate: &str) -> Option<String> {
    if !active() {
        return Some(candidate.to_string());
    }
    let pinned = env_nonempty("GROK_XAI_API_BASE_URL")
        .or_else(|| env_nonempty("XAI_API_BASE_URL"))
        .unwrap_or_default();
    if is_sisu_runtime_url(&pinned) {
        return Some(pinned);
    }
    if is_sisu_runtime_url(candidate) {
        return Some(candidate.to_string());
    }
    None
}

/// `Some(10)` when the host must log in. Direct pager invoke without a token
/// must not fall through to grok.com OAuth.
pub fn missing_token_exit_code() -> Option<i32> {
    if active() && sisu_token().is_none() {
        Some(HOST_LOGIN_EXIT_CODE)
    } else {
        None
    }
}

pub fn runtime_contract_error() -> Option<String> {
    if !active() {
        return None;
    }
    let names = [
        "GROK_XAI_API_BASE_URL",
        "XAI_API_BASE_URL",
        "GROK_MODELS_BASE_URL",
        "GROK_MODELS_LIST_URL",
        "GROK_CLI_CHAT_PROXY_BASE_URL",
    ];
    for name in names {
        match env_nonempty(name) {
            None if name == "GROK_XAI_API_BASE_URL" || name == "GROK_MODELS_LIST_URL" => {
                return Some(format!("sisu: refusing to start — {name} missing"));
            }
            None => {}
            Some(value) if !is_sisu_runtime_url(&value) => {
                return Some(format!("sisu: refusing to start — {name} is not a SiSu runtime"));
            }
            Some(_) => {}
        }
    }
    None
}

fn env_nonempty(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Session JWT from the host. Never counted as `has_xai_api_key_env`.
/// B-lite hosts (pager stamp < 0.3.0) put the JWT in `XAI_API_KEY` only.
pub fn sisu_token() -> Option<String> {
    env_nonempty("SISU_TOKEN").or_else(|| {
        if active() {
            env_nonempty("XAI_API_KEY")
        } else {
            None
        }
    })
}

pub fn client_version() -> String {
    std::env::var("SISU_CLIENT_VERSION")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "0.0.0".to_string())
}

/// Host-owned SiSu identity file (`~/.sisu/auth.json`). Not grok AuthStore.
pub fn auth_path() -> Option<PathBuf> {
    std::env::var_os("SISU_AUTH_PATH")
        .filter(|p| !p.is_empty())
        .map(PathBuf::from)
}

pub fn account_email() -> Option<String> {
    std::env::var("SISU_ACCOUNT_EMAIL")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

pub fn account_plan() -> Option<String> {
    std::env::var("SISU_ACCOUNT_PLAN")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Unlink the SiSu identity file. No-op when `SISU_AUTH_PATH` is unset/missing.
pub fn unlink_auth() -> std::io::Result<()> {
    let Some(path) = auth_path() else {
        return Ok(());
    };
    unlink_auth_at(&path)
}

fn unlink_auth_at(path: &Path) -> std::io::Result<()> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serial_test::serial;
    use xai_grok_test_support::EnvGuard;

    #[test]
    #[serial]
    fn sisu_token_alone_is_not_an_xai_api_key() {
        let _ap = EnvGuard::set("SISU_ACCESS_POINT", "1");
        let _tok = EnvGuard::set("SISU_TOKEN", "jwt");
        let _xai = EnvGuard::unset("XAI_API_KEY");
        let _legacy = EnvGuard::unset("GROK_CODE_XAI_API_KEY");
        assert!(active());
        assert_eq!(sisu_token().as_deref(), Some("jwt"));
        assert!(!crate::agent::auth_method::has_xai_api_key_env());
    }

    #[test]
    #[serial]
    fn b_lite_xai_api_key_is_sisu_bearer_not_welcome_badge() {
        let _ap = EnvGuard::set("SISU_ACCESS_POINT", "1");
        let _tok = EnvGuard::unset("SISU_TOKEN");
        let _xai = EnvGuard::set("XAI_API_KEY", "jwt-from-b-lite");
        let _legacy = EnvGuard::unset("GROK_CODE_XAI_API_KEY");
        assert!(active());
        assert_eq!(sisu_token().as_deref(), Some("jwt-from-b-lite"));
        assert!(!crate::agent::auth_method::has_xai_api_key_env());
    }

    #[test]
    #[serial]
    fn runtime_url_rejects_xai_and_grok() {
        assert!(is_sisu_runtime_url("https://www.sisu.chat/api/runtime/v1"));
        assert!(is_sisu_runtime_url("https://www.sisu.chat/api/runtime/v1/models"));
        assert!(!is_sisu_runtime_url("https://api.x.ai/v1"));
        assert!(!is_sisu_runtime_url("https://cli-chat-proxy.grok.com/v1"));
        assert!(!is_sisu_runtime_url("https://evil.example/api/runtime/v1?redirect=api.x.ai"));
    }

    #[test]
    #[serial]
    fn pin_runtime_url_ignores_catalog_xai_base() {
        let _ap = EnvGuard::set("SISU_ACCESS_POINT", "1");
        let _base = EnvGuard::set("GROK_XAI_API_BASE_URL", "https://www.sisu.chat/api/runtime/v1");
        assert_eq!(
            pin_runtime_url("https://api.x.ai/v1").as_deref(),
            Some("https://www.sisu.chat/api/runtime/v1")
        );
    }

    #[test]
    #[serial]
    fn missing_sisu_token_is_host_login() {
        let _ap = EnvGuard::set("SISU_ACCESS_POINT", "1");
        let _tok = EnvGuard::unset("SISU_TOKEN");
        let _xai = EnvGuard::unset("XAI_API_KEY");
        assert_eq!(missing_token_exit_code(), Some(10));
    }

    #[test]
    #[serial]
    fn unlink_auth_removes_sisu_auth_path_only() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("auth.json");
        std::fs::write(&path, r#"{"token":"jwt"}"#).unwrap();
        let _ap = EnvGuard::set("SISU_ACCESS_POINT", "1");
        let _auth = EnvGuard::set("SISU_AUTH_PATH", path.to_str().unwrap());
        unlink_auth().unwrap();
        assert!(!path.exists());
        unlink_auth().unwrap(); // missing is ok
    }
}
