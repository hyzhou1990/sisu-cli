//! SiSu-only tests extracted from the 7.6kLOC stock `config_tests.rs` snapshot.
use super::*;
use serial_test::serial;
use xai_grok_test_support::EnvGuard;

fn sisu_model() -> ModelEntry {
    let mut model = ModelEntry::fallback("m", &EndpointsConfig::default());
    model.info.base_url = "https://www.sisu.chat/api/runtime/v1".to_string();
    model
}

#[test]
#[serial]
fn resolve_credentials_sisu_token_is_session_bearer() {
    use xai_chat_state::AuthType;
    let _ap = EnvGuard::set("SISU_ACCESS_POINT", "1");
    let _tok = EnvGuard::set("SISU_TOKEN", "sisu-jwt");
    let _xai = EnvGuard::unset("XAI_API_KEY");
    let _legacy = EnvGuard::unset("GROK_CODE_XAI_API_KEY");
    let creds = resolve_credentials(&sisu_model(), Some("stale-grok-session"));
    assert_eq!(creds.auth_type, AuthType::SessionToken);
    assert_eq!(creds.api_key.as_deref(), Some("sisu-jwt"));
    assert_ne!(creds.api_key.as_deref(), Some("stale-grok-session"));
}

#[test]
#[serial]
fn resolve_credentials_b_lite_xai_api_key_is_session_bearer() {
    use xai_chat_state::AuthType;
    let _ap = EnvGuard::set("SISU_ACCESS_POINT", "1");
    let _tok = EnvGuard::unset("SISU_TOKEN");
    let _xai = EnvGuard::set("XAI_API_KEY", "jwt-from-b-lite");
    let _legacy = EnvGuard::unset("GROK_CODE_XAI_API_KEY");
    let creds = resolve_credentials(&sisu_model(), None);
    assert_eq!(creds.auth_type, AuthType::SessionToken);
    assert_eq!(creds.api_key.as_deref(), Some("jwt-from-b-lite"));
    assert!(!crate::agent::auth_method::has_xai_api_key_env());
}

#[test]
#[serial]
fn sampling_config_access_point_stamps_exclude_request_id() {
    let _ap = EnvGuard::set("SISU_ACCESS_POINT", "1");
    let _ver = EnvGuard::set("SISU_CLIENT_VERSION", "0.3.0");
    let creds = resolve_credentials(&sisu_model(), None);
    let cfg = sampling_config_for_model(&sisu_model(), creds, None, None, None, None);
    assert_eq!(
        cfg.extra_headers.get("x-sisu-client").map(String::as_str),
        Some("tui")
    );
    assert_eq!(
        cfg.extra_headers
            .get("x-sisu-client-version")
            .map(String::as_str),
        Some("0.3.0")
    );
    assert!(!cfg.extra_headers.contains_key("x-sisu-client-request-id"));
    assert!(!cfg.extra_headers.contains_key("x-sisu-conversation-id"));
    let injector = cfg.header_injector.expect("header_injector");
    let mut headers = reqwest::header::HeaderMap::new();
    injector.inject(&mut headers);
    let first = headers
        .get("x-sisu-client-request-id")
        .expect("request id on first inject")
        .clone();
    let mut headers2 = reqwest::header::HeaderMap::new();
    injector.inject(&mut headers2);
    let second = headers2
        .get("x-sisu-client-request-id")
        .expect("request id on second inject")
        .clone();
    assert_ne!(first, second, "fresh x-sisu-client-request-id per inject");
}

#[test]
#[serial]
fn access_point_injects_stable_conversation_id() {
    let _ap = EnvGuard::set("SISU_ACCESS_POINT", "1");
    let _ver = EnvGuard::set("SISU_CLIENT_VERSION", "0.3.0");
    let _cid = EnvGuard::set(
        "SISU_CONVERSATION_ID",
        "11111111-1111-1111-1111-111111111111",
    );
    let creds = resolve_credentials(&sisu_model(), None);
    let cfg = sampling_config_for_model(&sisu_model(), creds, None, None, None, None);
    assert_eq!(
        cfg.extra_headers
            .get("x-sisu-conversation-id")
            .map(String::as_str),
        Some("11111111-1111-1111-1111-111111111111")
    );
}
