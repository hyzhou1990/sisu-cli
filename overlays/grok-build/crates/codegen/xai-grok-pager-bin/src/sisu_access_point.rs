//! SiSu access-point gate. Direct pager invoke without the host contract exits 2.
//! Does not self-apply credentials from ~/.sisu/auth.json.

pub fn active() -> bool {
    xai_grok_shell::sisu_access_point::active()
}

pub fn is_sisu_runtime_url(url: &str) -> bool {
    xai_grok_shell::sisu_access_point::is_sisu_runtime_url(url)
}

pub fn enforce() {
    if !active() {
        eprintln!("run `sisu` — this binary is the SiSu local engine, not a grok.com client");
        std::process::exit(2);
    }
    if let Some(code) = xai_grok_shell::sisu_access_point::missing_token_exit_code() {
        eprintln!("sisu: host login required");
        std::process::exit(code);
    }
    if let Some(error) = xai_grok_shell::sisu_access_point::runtime_contract_error() {
        eprintln!("{error}");
        std::process::exit(2);
    }
    unsafe {
        std::env::remove_var("GROK_CODE_XAI_API_KEY");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runtime_url_must_be_sisu() {
        assert!(is_sisu_runtime_url("https://www.sisu.chat/api/runtime/v1"));
        assert!(!is_sisu_runtime_url("https://api.x.ai/v1"));
        assert!(!is_sisu_runtime_url("https://cli-chat-proxy.grok.com/v1"));
    }
}
