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
            None if name == "GROK_XAI_API_BASE_URL"
                || name == "GROK_MODELS_LIST_URL"
                || name == "GROK_CLI_CHAT_PROXY_BASE_URL" =>
            {
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

/// grok.com / api.x.ai / auth.x.ai — access-point must not send leftover grok tokens there.
pub fn is_grok_or_xai_url(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    lower.contains("grok.com") || lower.contains("api.x.ai") || lower.contains("auth.x.ai")
}

/// `Authorization` value for access-point HTTP. Never a grok AuthStore key.
pub fn access_point_authorization() -> Option<String> {
    if !active() {
        return None;
    }
    sisu_token().map(|token| format!("Bearer {token}"))
}

/// Access-point Authorization for a concrete URL.
///
/// - `None` — not access-point; caller uses grok AuthStore.
/// - `Some(None)` — access-point, attach nothing (grok.com / api.x.ai / auth.x.ai, or no token).
/// - `Some(Some("Bearer …"))` — attach SiSu JWT.
pub fn access_point_authorization_for_url(url: &str) -> Option<Option<String>> {
    if !active() {
        return None;
    }
    if is_grok_or_xai_url(url) {
        return Some(None);
    }
    Some(access_point_authorization())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BilledTurnCopy {
    pub headline: &'static str,
    pub action: &'static str,
    pub why: &'static str,
}

/// User-facing billed-turn copy. `None` when not access-point or not 401/402.
pub fn billed_turn_copy(status: u16) -> Option<BilledTurnCopy> {
    if !active() {
        return None;
    }
    match status {
        401 => Some(BilledTurnCopy {
            headline: "Sign in required",
            action: "Run `sisu login`.",
            why: "Your SiSu session expired.",
        }),
        402 => Some(BilledTurnCopy {
            headline: "Quota exhausted",
            action: "Top up at https://www.sisu.chat",
            why: "This account has no remaining SiSu quota.",
        }),
        _ => None,
    }
}

pub fn billed_turn_is_host_login(status: u16) -> bool {
    active() && status == 401
}

/// Stamp billed-turn headers onto a sampling `extra_headers` map.
/// Request id is per-request via [`sampling_header_injector`], never a static header.
pub fn stamp_sampling_headers(extra_headers: &mut indexmap::IndexMap<String, String>) {
    if !active() {
        return;
    }
    extra_headers
        .entry("x-sisu-client".to_string())
        .or_insert_with(|| "tui".to_string());
    extra_headers
        .entry("x-sisu-client-version".to_string())
        .or_insert_with(client_version);
    extra_headers.shift_remove("x-sisu-client-request-id");
    if let Ok(id) = std::env::var("SISU_CONVERSATION_ID") {
        let id = id.trim().to_string();
        if !id.is_empty() {
            extra_headers
                .entry("x-sisu-conversation-id".to_string())
                .or_insert(id);
        }
    }
}

#[derive(Debug)]
pub struct SisuClientRequestIdInjector;

impl xai_grok_sampler::HeaderInjector for SisuClientRequestIdInjector {
    fn inject(&self, headers: &mut reqwest::header::HeaderMap) {
        if !active() {
            return;
        }
        let id = uuid::Uuid::new_v4().to_string();
        if let Ok(value) = reqwest::header::HeaderValue::from_str(&id) {
            headers.insert("x-sisu-client-request-id", value);
        }
    }
}

/// Access-point request-id injector for `SamplerConfig.header_injector`.
pub fn sampling_header_injector() -> Option<xai_grok_sampler::SharedHeaderInjector> {
    if active() {
        Some(std::sync::Arc::new(SisuClientRequestIdInjector))
    } else {
        None
    }
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
    fn runtime_contract_requires_sisu_cli_chat_proxy() {
        let _ap = EnvGuard::set("SISU_ACCESS_POINT", "1");
        let sisu = "https://www.sisu.chat/api/runtime/v1";
        let _xai = EnvGuard::set("GROK_XAI_API_BASE_URL", sisu);
        let _list = EnvGuard::set("GROK_MODELS_LIST_URL", format!("{sisu}/models"));
        let _models = EnvGuard::unset("GROK_MODELS_BASE_URL");
        let _xai2 = EnvGuard::unset("XAI_API_BASE_URL");
        let _proxy = EnvGuard::unset("GROK_CLI_CHAT_PROXY_BASE_URL");
        let err = runtime_contract_error().expect("proxy URL required");
        assert!(err.contains("GROK_CLI_CHAT_PROXY_BASE_URL"));
        assert!(err.contains("missing"));

        let _grok = EnvGuard::set(
            "GROK_CLI_CHAT_PROXY_BASE_URL",
            "https://cli-chat-proxy.grok.com/v1",
        );
        let err = runtime_contract_error().expect("grok proxy refused");
        assert!(err.contains("GROK_CLI_CHAT_PROXY_BASE_URL"));
        assert!(err.contains("not a SiSu runtime"));

        let _ok = EnvGuard::set("GROK_CLI_CHAT_PROXY_BASE_URL", sisu);
        assert_eq!(runtime_contract_error(), None);
    }

    #[test]
    #[serial]
    fn access_point_authorization_for_url_omits_on_xai() {
        let _ap = EnvGuard::set("SISU_ACCESS_POINT", "1");
        let _tok = EnvGuard::set("SISU_TOKEN", "sisu-jwt");
        assert_eq!(
            access_point_authorization_for_url("https://api.x.ai/v1/models"),
            Some(None)
        );
        assert_eq!(
            access_point_authorization_for_url("https://cli-chat-proxy.grok.com/v1/user"),
            Some(None)
        );
        assert_eq!(
            access_point_authorization_for_url("https://www.sisu.chat/api/runtime/v1/user"),
            Some(Some("Bearer sisu-jwt".into()))
        );
        let _off = EnvGuard::unset("SISU_ACCESS_POINT");
        assert_eq!(
            access_point_authorization_for_url("https://www.sisu.chat/api/runtime/v1/user"),
            None
        );
    }

    #[test]
    #[serial]
    fn access_point_authorization_is_sisu_token_not_grok_store() {
        let _ap = EnvGuard::set("SISU_ACCESS_POINT", "1");
        let _tok = EnvGuard::set("SISU_TOKEN", "sisu-jwt");
        let _xai = EnvGuard::unset("XAI_API_KEY");
        assert_eq!(
            access_point_authorization().as_deref(),
            Some("Bearer sisu-jwt")
        );
        assert!(is_grok_or_xai_url("https://cli-chat-proxy.grok.com/v1/settings"));
        assert!(is_grok_or_xai_url("https://api.x.ai/v1"));
        assert!(!is_grok_or_xai_url("https://www.sisu.chat/api/runtime/v1/settings"));
    }

    #[test]
    #[serial]
    fn billed_turn_401_is_sisu_login_not_request_denied() {
        let _ap = EnvGuard::set("SISU_ACCESS_POINT", "1");
        let copy = billed_turn_copy(401).expect("401");
        assert_eq!(copy.headline, "Sign in required");
        assert!(copy.action.contains("sisu login"));
        assert!(!copy.why.to_ascii_lowercase().contains("not authenticated"));
        assert!(billed_turn_is_host_login(401));
        assert_eq!(HOST_LOGIN_EXIT_CODE, 10);
    }

    #[test]
    #[serial]
    fn billed_turn_402_is_sisu_quota_not_supergrok() {
        let _ap = EnvGuard::set("SISU_ACCESS_POINT", "1");
        let copy = billed_turn_copy(402).expect("402");
        assert_eq!(copy.headline, "Quota exhausted");
        assert!(copy.action.contains("https://www.sisu.chat"));
        assert!(!copy.action.to_ascii_lowercase().contains("grok.com"));
        assert!(!copy.why.to_ascii_lowercase().contains("supergrok"));
        let _off = EnvGuard::unset("SISU_ACCESS_POINT");
        assert!(billed_turn_copy(401).is_none());
        assert!(billed_turn_copy(402).is_none());
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

    #[test]
    #[serial]
    fn stamp_sampling_headers_sets_client_and_skips_request_id() {
        let _ap = EnvGuard::set("SISU_ACCESS_POINT", "1");
        let _ver = EnvGuard::set("SISU_CLIENT_VERSION", "0.3.0");
        let _cid = EnvGuard::unset("SISU_CONVERSATION_ID");
        let mut headers = indexmap::IndexMap::new();
        stamp_sampling_headers(&mut headers);
        assert_eq!(headers.get("x-sisu-client").map(String::as_str), Some("tui"));
        assert_eq!(
            headers.get("x-sisu-client-version").map(String::as_str),
            Some("0.3.0")
        );
        assert!(!headers.contains_key("x-sisu-client-request-id"));
        assert!(!headers.contains_key("x-sisu-conversation-id"));
        let injector = sampling_header_injector().expect("injector");
        let mut map = reqwest::header::HeaderMap::new();
        injector.inject(&mut map);
        let first = map
            .get("x-sisu-client-request-id")
            .expect("request id")
            .clone();
        let mut map2 = reqwest::header::HeaderMap::new();
        injector.inject(&mut map2);
        let second = map2
            .get("x-sisu-client-request-id")
            .expect("request id")
            .clone();
        assert_ne!(first, second);
    }

    #[test]
    #[serial]
    fn stamp_sampling_headers_keeps_stable_conversation_id() {
        let _ap = EnvGuard::set("SISU_ACCESS_POINT", "1");
        let _cid = EnvGuard::set(
            "SISU_CONVERSATION_ID",
            "11111111-1111-1111-1111-111111111111",
        );
        let mut headers = indexmap::IndexMap::new();
        stamp_sampling_headers(&mut headers);
        assert_eq!(
            headers.get("x-sisu-conversation-id").map(String::as_str),
            Some("11111111-1111-1111-1111-111111111111")
        );
    }

    #[test]
    #[serial]
    fn stamp_sampling_headers_is_noop_when_not_access_point() {
        let _off = EnvGuard::unset("SISU_ACCESS_POINT");
        let mut headers = indexmap::IndexMap::new();
        headers.insert("keep".to_string(), "me".to_string());
        stamp_sampling_headers(&mut headers);
        assert_eq!(headers.len(), 1);
        assert_eq!(headers.get("keep").map(String::as_str), Some("me"));
        assert!(sampling_header_injector().is_none());
    }
}
