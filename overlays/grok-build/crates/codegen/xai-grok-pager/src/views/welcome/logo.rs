//! Logo component — the SiSu Möbius ASCII animation.
//!
//! Hidden entirely on legacy Windows consoles: the half-block / shade ramp is
//! fine there, but the rest of the welcome chrome still collapses the logo
//! slot on ConHost so layout matches the original braille-art gate.

use ratatui::buffer::Buffer;
use ratatui::layout::{Alignment, Rect};
use ratatui::style::{Color, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Paragraph, Widget};

use crate::theme::Theme;

use super::mobius;

/// Full hero-box logo (left of changelog / menu).
const FULL_COLS: u16 = 38;
const FULL_ROWS: u16 = 9;
/// Compact / stacked welcome card.
const SMALL_COLS: u16 = 32;
const SMALL_ROWS: u16 = 7;

/// Height at or above which the small logo is shown (below it, no logo).
const SMALL_LOGO_MIN_HEIGHT: u16 = 22;
/// Height at or above which the full logo is shown.
const FULL_LOGO_MIN_HEIGHT: u16 = 26;

/// Seconds for one full half-twist lap (matches the Node splash cadence).
const LAP_SECS: f32 = 1.8;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum LogoTier {
    Small,
    Full,
}

fn pick_logo(window_height: u16) -> Option<LogoTier> {
    pick_logo_for(window_height, logo_hidden())
}

fn pick_logo_for(window_height: u16, hidden: bool) -> Option<LogoTier> {
    if hidden || window_height < SMALL_LOGO_MIN_HEIGHT {
        None
    } else if window_height < FULL_LOGO_MIN_HEIGHT {
        Some(LogoTier::Small)
    } else {
        Some(LogoTier::Full)
    }
}

fn logo_hidden() -> bool {
    crate::glyphs::is_legacy_windows_console()
}

fn tier_size(tier: LogoTier) -> (u16, u16) {
    match tier {
        LogoTier::Small => (SMALL_COLS, SMALL_ROWS),
        LogoTier::Full => (FULL_COLS, FULL_ROWS),
    }
}

/// Animation phase in seconds since the first render. Wall-clock based so the
/// twist speed is independent of the frame rate.
fn anim_phase_secs() -> f32 {
    use std::sync::OnceLock;
    use std::time::Instant;
    static START: OnceLock<Instant> = OnceLock::new();
    START.get_or_init(Instant::now).elapsed().as_secs_f32()
}

/// Möbius redraw cadence. The ribbon is a slow lap, so a modest fps is enough.
const SHIMMER_FPS: f32 = 16.0;

/// Quantized animation frame for the current wall-clock phase. The welcome
/// screen redraws only when this advances.
pub fn shimmer_frame() -> u64 {
    if logo_hidden() {
        return 0;
    }
    (anim_phase_secs() * SHIMMER_FPS) as u64
}

fn render_into(area: Rect, buf: &mut Buffer, _theme: &Theme, cols: u16, rows: u16) {
    if area.width == 0 || area.height == 0 {
        return;
    }
    let cols = cols.min(area.width).max(16) as usize;
    let rows = rows.min(area.height).max(5) as usize;
    let phase = f64::from(anim_phase_secs()) * std::f64::consts::TAU / f64::from(LAP_SECS);
    let grid = mobius::render_frame(cols, rows, phase);
    let logo_lines: Vec<Line> = grid
        .into_iter()
        .map(|line| {
            let mut spans: Vec<Span> = Vec::new();
            let mut run = String::new();
            let mut run_color: Option<Color> = None;
            for cell in line {
                let (ch, color) = match cell {
                    Some(g) => (g.ch, Color::Rgb(g.rgb.0, g.rgb.1, g.rgb.2)),
                    None => (' ', Color::Reset),
                };
                if run_color != Some(color) {
                    if let Some(prev) = run_color {
                        spans.push(Span::styled(
                            std::mem::take(&mut run),
                            Style::default().fg(prev),
                        ));
                    }
                    run_color = Some(color);
                }
                run.push(ch);
            }
            if let Some(prev) = run_color {
                spans.push(Span::styled(run, Style::default().fg(prev)));
            }
            Line::from(spans).alignment(Alignment::Center)
        })
        .collect();
    Paragraph::new(logo_lines).render(area, buf);
}

pub fn logo_line_count(window_height: u16) -> u16 {
    pick_logo(window_height).map_or(0, |tier| tier_size(tier).1)
}

pub fn logo_visual_width(window_height: u16) -> u16 {
    pick_logo(window_height).map_or(24, |tier| tier_size(tier).0)
}

pub fn render_logo(area: Rect, buf: &mut Buffer, theme: &Theme, window_height: u16) {
    if let Some(tier) = pick_logo(window_height) {
        let (cols, rows) = tier_size(tier);
        render_into(area, buf, theme, cols, rows);
    }
}

/// The hero box always shows the full logo: it is laid out beside the menu, so
/// it fits whenever the box does.
pub fn full_logo_line_count() -> u16 {
    full_logo_line_count_for(logo_hidden())
}

fn full_logo_line_count_for(hidden: bool) -> u16 {
    if hidden { 0 } else { FULL_ROWS }
}

pub fn full_logo_visual_width() -> u16 {
    full_logo_visual_width_for(logo_hidden())
}

fn full_logo_visual_width_for(hidden: bool) -> u16 {
    if hidden { 0 } else { FULL_COLS }
}

pub fn render_full_logo(area: Rect, buf: &mut Buffer, theme: &Theme) {
    if !logo_hidden() {
        render_into(area, buf, theme, FULL_COLS, FULL_ROWS);
    }
}

/// Line count of the small logo used in minimal's committed welcome card.
pub fn compact_logo_line_count() -> u16 {
    if logo_hidden() {
        0
    } else {
        SMALL_ROWS
    }
}

/// Render the small Möbius (centered) into `area` for minimal's welcome card.
pub fn render_compact_logo(area: Rect, buf: &mut Buffer, theme: &Theme) {
    if !logo_hidden() {
        render_into(area, buf, theme, SMALL_COLS, SMALL_ROWS);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn logo_sizes_by_height() {
        assert!(pick_logo_for(SMALL_LOGO_MIN_HEIGHT - 1, false).is_none());
        assert_eq!(
            pick_logo_for(SMALL_LOGO_MIN_HEIGHT, false),
            Some(LogoTier::Small)
        );
        assert_eq!(
            pick_logo_for(FULL_LOGO_MIN_HEIGHT - 1, false),
            Some(LogoTier::Small)
        );
        assert_eq!(
            pick_logo_for(FULL_LOGO_MIN_HEIGHT, false),
            Some(LogoTier::Full)
        );
    }

    #[test]
    fn logo_hidden_on_legacy_console_at_every_height() {
        for h in [0, SMALL_LOGO_MIN_HEIGHT, FULL_LOGO_MIN_HEIGHT, u16::MAX] {
            assert!(pick_logo_for(h, true).is_none(), "height {h}");
        }
    }

    #[test]
    fn hero_box_always_uses_full_logo() {
        assert_eq!(full_logo_line_count_for(false), FULL_ROWS);
        assert_eq!(full_logo_visual_width_for(false), FULL_COLS);
        assert!(full_logo_line_count_for(false) > SMALL_ROWS);
        assert!(full_logo_visual_width_for(false) > SMALL_COLS);
    }

    #[test]
    fn full_logo_helpers_collapse_when_hidden() {
        assert_eq!(full_logo_line_count_for(true), 0);
        assert_eq!(full_logo_visual_width_for(true), 0);
    }

    #[test]
    fn compact_logo_line_count_matches_small_logo_when_visible() {
        if !logo_hidden() {
            assert_eq!(compact_logo_line_count(), SMALL_ROWS);
            assert!(compact_logo_line_count() < FULL_ROWS);
            assert!(compact_logo_line_count() > 0);
        } else {
            assert_eq!(compact_logo_line_count(), 0);
        }
    }
}
