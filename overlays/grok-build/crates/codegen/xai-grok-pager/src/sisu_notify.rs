//! Desktop (out-of-terminal) notification when an agent turn completes.
//!
//! The in-terminal rail (`crate::notifications`: OSC 9/99/777, BEL) only
//! reaches terminals that render those sequences — a user who switched to
//! another window never sees them. This module is the OS-level counterpart,
//! fired from the driver turn boundary (`handle_prompt_response`): a desktop
//! notification plus a terminal bell as the always-on baseline.
//!
//! Gates (see [`TurnNotifyGate::should_notify`]):
//! - `SISU_TUI_NOTIFY=0` disables the feature entirely (default: on).
//! - At most one notification per [`DEBOUNCE`] window, process-wide.
//! - The terminal is unfocused OR the turn ran ≥ [`LONG_TURN_THRESHOLD`].
//!   Focus is the primary signal; duration is the fallback for terminals
//!   without focus reporting (which never leave `focused == true`).
//!
//! Delivery is best-effort: helper processes spawn detached and every
//! failure (missing binary, nonzero exit) is swallowed.

use std::path::Path;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

/// Notification title on every channel.
const TITLE: &str = "SiSu";
/// Env kill switch: `SISU_TUI_NOTIFY=0` turns desktop notifications off.
pub(crate) const ENV_DISABLE: &str = "SISU_TUI_NOTIFY";
/// Turns at least this long notify even while the terminal is focused.
pub(crate) const LONG_TURN_THRESHOLD: Duration = Duration::from_secs(45);
/// Minimum gap between two desktop notifications from this process.
pub(crate) const DEBOUNCE: Duration = Duration::from_secs(30);
/// Display-column cap for the trailing assistant-message preview.
const MAX_MESSAGE_WIDTH: usize = 80;

/// Process-wide debounce state: when the last desktop notification fired.
#[derive(Debug, Default)]
pub(crate) struct TurnNotifyGate {
    last_sent: Option<Instant>,
}

impl TurnNotifyGate {
    /// Whether a completed turn should raise a desktop notification.
    ///
    /// `enabled` is the env resolution ([`enabled_from_env`]);
    /// `terminal_focused` comes from the focus tracker (also `true` when the
    /// terminal never reports focus — which is why a long `elapsed` alone
    /// suffices); `now` is passed in so the debounce is testable.
    pub(crate) fn should_notify(
        &self,
        enabled: bool,
        terminal_focused: bool,
        elapsed: Option<Duration>,
        now: Instant,
    ) -> bool {
        if !enabled {
            return false;
        }
        if let Some(last) = self.last_sent
            && now.duration_since(last) < DEBOUNCE
        {
            return false;
        }
        !terminal_focused || elapsed.is_some_and(|e| e >= LONG_TURN_THRESHOLD)
    }

    pub(crate) fn mark_sent(&mut self, now: Instant) {
        self.last_sent = Some(now);
    }
}

fn gate() -> &'static Mutex<TurnNotifyGate> {
    static GATE: OnceLock<Mutex<TurnNotifyGate>> = OnceLock::new();
    GATE.get_or_init(Mutex::default)
}

/// `SISU_TUI_NOTIFY=0` (whitespace tolerated) disables; unset/other values on.
pub(crate) fn enabled_from_env(raw: Option<&str>) -> bool {
    !matches!(raw.map(str::trim), Some("0"))
}

/// Fire a desktop notification for a completed turn when every gate passes.
///
/// `terminal_focused` is the terminal focus state, `elapsed` the turn's
/// wall-clock duration, `cwd` the session working directory (for the project
/// name), `last_message` a preview of the last assistant message, and
/// `session_id` only feeds the unified-log breadcrumb.
pub(crate) fn maybe_notify_turn_complete(
    terminal_focused: bool,
    elapsed: Option<Duration>,
    cwd: &Path,
    last_message: Option<&str>,
    session_id: Option<&str>,
) {
    let enabled = enabled_from_env(std::env::var(ENV_DISABLE).ok().as_deref());
    let now = Instant::now();
    {
        let mut gate = gate().lock().unwrap_or_else(|e| e.into_inner());
        if !gate.should_notify(enabled, terminal_focused, elapsed, now) {
            return;
        }
        gate.mark_sent(now);
    }
    let body = compose_body(&project_name(cwd), elapsed, last_message);
    crate::unified_log::info(
        "turn.desktop_notify",
        session_id,
        Some(serde_json::json!({
            "focused": terminal_focused,
            "elapsed_ms": elapsed.map(|d| d.as_millis() as u64),
        })),
    );
    deliver(TITLE, &body);
}

/// Body text: project name + turn duration on the first line, then the first
/// ~80 columns of the last assistant message when one is available.
pub(crate) fn compose_body(
    project: &str,
    elapsed: Option<Duration>,
    last_message: Option<&str>,
) -> String {
    let mut head = project.to_string();
    if let Some(d) = elapsed {
        head.push_str(&format!(" · done in {}", crate::util::format_duration(d)));
    }
    match last_message.map(str::trim).filter(|m| !m.is_empty()) {
        Some(message) => {
            let preview = crate::util::truncate_to_width(message, MAX_MESSAGE_WIDTH);
            format!("{head}\n{preview}")
        }
        None => format!("{head} — turn complete"),
    }
}

/// Project label from the session cwd (basename; roots fall back).
pub(crate) fn project_name(cwd: &Path) -> String {
    cwd.file_name()
        .and_then(|n| n.to_str())
        .map(str::trim)
        .filter(|n| !n.is_empty())
        .unwrap_or("session")
        .to_string()
}

/// Ring the terminal bell — the baseline that works on every platform.
fn ring_bell() {
    xai_grok_shell::util::with_locked_stderr(|stderr| {
        use std::io::Write as _;
        let _ = stderr.write_all(b"\x07");
        let _ = stderr.flush();
    });
}

fn deliver(title: &str, body: &str) {
    ring_bell();
    #[cfg(target_os = "macos")]
    spawn_detached(std::process::Command::new("osascript").arg("-e").arg(
        format!(
            "display notification \"{}\" with title \"{}\"",
            applescript_escape(body),
            applescript_escape(title)
        ),
    ));
    // A missing binary errors the spawn, which is swallowed — the bell above
    // is the fallback on platforms without a notifier.
    #[cfg(all(unix, not(target_os = "macos")))]
    spawn_detached(std::process::Command::new("notify-send").arg(title).arg(body));
    // BurntToast is the de-facto toast module: use it when installed,
    // otherwise this command is a silent no-op and the bell carries.
    #[cfg(target_os = "windows")]
    spawn_detached(
        std::process::Command::new("powershell")
            .arg("-NoProfile")
            .arg("-NonInteractive")
            .arg("-Command")
            .arg(format!(
                "if (Get-Command New-BurntToastNotification -ErrorAction SilentlyContinue) \
                 {{ New-BurntToastNotification -Text '{}','{}' | Out-Null }}",
                powershell_escape(title),
                powershell_escape(body)
            )),
    );
}

/// Spawn `cmd` detached (null stdio) and reap it on a helper thread so the
/// child can't linger as a zombie. Spawn errors are swallowed by design.
fn spawn_detached(cmd: &mut std::process::Command) {
    let child = cmd
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn();
    if let Ok(mut child) = child {
        std::thread::spawn(move || {
            let _ = child.wait();
        });
    }
}

/// Escape a string for an AppleScript `"…"` literal.
pub(crate) fn applescript_escape(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}

/// Escape a string for a PowerShell `'…'` literal (single quotes double).
pub(crate) fn powershell_escape(s: &str) -> String {
    s.replace('\'', "''")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn env_zero_disables_everything_else_enables() {
        assert!(!enabled_from_env(Some("0")));
        assert!(!enabled_from_env(Some(" 0 ")));
        assert!(enabled_from_env(None));
        assert!(enabled_from_env(Some("1")));
        assert!(enabled_from_env(Some("")));
    }

    #[test]
    fn unfocused_notifies_regardless_of_duration() {
        let gate = TurnNotifyGate::default();
        let now = Instant::now();
        assert!(gate.should_notify(true, false, None, now));
        assert!(gate.should_notify(true, false, Some(Duration::from_secs(2)), now));
        assert!(gate.should_notify(true, false, Some(LONG_TURN_THRESHOLD), now));
    }

    #[test]
    fn focused_notifies_only_for_long_turns() {
        let gate = TurnNotifyGate::default();
        let now = Instant::now();
        assert!(!gate.should_notify(true, true, None, now));
        assert!(
            !gate.should_notify(true, true, Some(LONG_TURN_THRESHOLD - Duration::from_secs(1)), now)
        );
        assert!(gate.should_notify(true, true, Some(LONG_TURN_THRESHOLD), now));
        assert!(
            gate.should_notify(true, true, Some(Duration::from_secs(3600)), now)
        );
    }

    #[test]
    fn disabled_env_wins_over_every_other_gate() {
        let gate = TurnNotifyGate::default();
        let now = Instant::now();
        assert!(!gate.should_notify(false, false, Some(Duration::from_secs(3600)), now));
        assert!(!gate.should_notify(false, true, Some(LONG_TURN_THRESHOLD), now));
    }

    #[test]
    fn debounce_suppresses_within_window_and_allows_after() {
        let mut gate = TurnNotifyGate::default();
        let t0 = Instant::now();
        gate.mark_sent(t0);
        assert!(!gate.should_notify(true, false, None, t0 + DEBOUNCE - Duration::from_secs(1)));
        assert!(gate.should_notify(true, false, None, t0 + DEBOUNCE));
        // A fresh send re-arms the window.
        gate.mark_sent(t0 + DEBOUNCE);
        assert!(!gate.should_notify(true, false, None, t0 + DEBOUNCE + Duration::from_secs(1)));
    }

    #[test]
    fn compose_body_includes_project_duration_and_message_preview() {
        let body = compose_body(
            "myproj",
            Some(Duration::from_secs(125)),
            Some("  All done, tests pass.  "),
        );
        assert_eq!(body, "myproj · done in 2m5s\nAll done, tests pass.");
    }

    #[test]
    fn compose_body_without_message_uses_plain_summary() {
        assert_eq!(
            compose_body("myproj", Some(Duration::from_secs(3)), None),
            "myproj · done in 3.0s — turn complete"
        );
        assert_eq!(
            compose_body("myproj", None, Some("")),
            "myproj — turn complete"
        );
    }

    #[test]
    fn compose_body_truncates_long_messages_column_safely() {
        let long = "x".repeat(200);
        let body = compose_body("p", None, Some(&long));
        let preview = body.lines().nth(1).unwrap();
        assert!(preview.ends_with('…'));
        assert!(preview.chars().count() <= MAX_MESSAGE_WIDTH);

        // Wide (CJK) glyphs count double against the column budget.
        let wide = "汉".repeat(100);
        let body = compose_body("p", None, Some(&wide));
        let preview = body.lines().nth(1).unwrap();
        assert!(preview.ends_with('…'));
        assert!(preview.len() < wide.len());
    }

    #[test]
    fn project_name_uses_basename_with_fallback() {
        assert_eq!(project_name(Path::new("/a/b/c")), "c");
        assert_eq!(project_name(Path::new("/a/b/c/")), "c");
        assert_eq!(project_name(Path::new("/")), "session");
    }

    #[test]
    fn applescript_escape_quotes_and_backslashes() {
        assert_eq!(applescript_escape("plain"), "plain");
        assert_eq!(applescript_escape("a\"b"), "a\\\"b");
        assert_eq!(applescript_escape("a\\b"), "a\\\\b");
    }

    #[test]
    fn powershell_escape_doubles_single_quotes() {
        assert_eq!(powershell_escape("plain"), "plain");
        assert_eq!(powershell_escape("it's"), "it''s");
    }
}
