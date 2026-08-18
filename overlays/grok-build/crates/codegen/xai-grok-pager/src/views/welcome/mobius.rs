//! Volumetric ∞ Möbius: lemniscate centerline, half-twist ribbon, traveling glint.
//! Port of sisu-cli `src/mobius.ts` — the SiSu splash animation.

const SHADE_RAMP: &[u8] = b" .:-=+*#%@";
const SCALE: f64 = 1.72;
const HALF_WIDTH: f64 = 0.3;
const THICKNESS: f64 = 0.045;
const CELL_ASPECT: f64 = 0.5;
const CAM: f64 = 6.4;
const FOCAL: f64 = 5.2;
// Normalized from [-0.55, 0.7, 0.45] / [0.52, 0.1, 0.85].
const KEY: [f64; 3] = [-0.551388, 0.701767, 0.451136];
const FILL: [f64; 3] = [0.519247, 0.099855, 0.848769];
const VIEW: [f64; 3] = [0.0, 0.06, 1.0];

#[derive(Clone, Copy)]
struct Cell {
    z: f64,
    shade: f64,
    t: f64,
    spec: f64,
}

#[derive(Clone, Copy, Debug)]
pub struct Glyph {
    pub ch: char,
    pub rgb: (u8, u8, u8),
}

fn clamp(value: f64, lo: f64, hi: f64) -> f64 {
    value.max(lo).min(hi)
}

fn lerp(a: f64, b: f64, t: f64) -> f64 {
    a + (b - a) * t
}

fn norm(v: [f64; 3]) -> [f64; 3] {
    let length = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt().max(1e-9);
    [v[0] / length, v[1] / length, v[2] / length]
}

fn cross(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

fn dot(a: [f64; 3], b: [f64; 3]) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

/// Brand gradient along the band: blue → purple → gold.
pub fn mobius_rgb(t: f64) -> (u8, u8, u8) {
    let u = ((t / (std::f64::consts::TAU)) % 1.0 + 1.0) % 1.0;
    if u < 0.5 {
        let k = u / 0.5;
        (
            lerp(37.0, 124.0, k).round() as u8,
            lerp(99.0, 58.0, k).round() as u8,
            lerp(235.0, 237.0, k).round() as u8,
        )
    } else {
        let k = (u - 0.5) / 0.5;
        (
            lerp(124.0, 217.0, k).round() as u8,
            lerp(58.0, 119.0, k).round() as u8,
            lerp(237.0, 6.0, k).round() as u8,
        )
    }
}

fn rotate_x(y: f64, z: f64, angle: f64) -> (f64, f64) {
    let c = angle.cos();
    let s = angle.sin();
    (y * c - z * s, y * s + z * c)
}

fn rotate_y(x: f64, z: f64, angle: f64) -> (f64, f64) {
    let c = angle.cos();
    let s = angle.sin();
    (x * c + z * s, -x * s + z * c)
}

fn lemniscate(t: f64) -> [f64; 3] {
    [SCALE * t.sin(), SCALE * t.sin() * t.cos(), 0.0]
}

fn lemniscate_tangent(t: f64) -> [f64; 3] {
    norm([t.cos(), (2.0 * t).cos(), 0.0])
}

/// Ribbon around the ∞: width offset in a frame that half-twists once per lap.
pub fn logo_point(t: f64, width: f64, phase: f64) -> [f64; 3] {
    let [cx, cy, cz] = lemniscate(t);
    let tangent = lemniscate_tangent(t);
    let binormal = [0.0, 0.0, 1.0];
    let normal = norm(cross(binormal, tangent));
    let twist = (t + phase) / 2.0;
    let ox = normal[0] * twist.cos() + binormal[0] * twist.sin();
    let oy = normal[1] * twist.cos() + binormal[1] * twist.sin();
    let oz = normal[2] * twist.cos() + binormal[2] * twist.sin();
    let w = width * HALF_WIDTH;
    [cx + ox * w, cy + oy * w, cz + oz * w]
}

fn logo_normal(t: f64, phase: f64) -> [f64; 3] {
    let tangent = lemniscate_tangent(t);
    let binormal = [0.0, 0.0, 1.0];
    let normal = norm(cross(binormal, tangent));
    let twist = (t + phase) / 2.0;
    norm([
        normal[0] * twist.cos() + binormal[0] * twist.sin(),
        normal[1] * twist.cos() + binormal[1] * twist.sin(),
        normal[2] * twist.cos() + binormal[2] * twist.sin(),
    ])
}

fn transform(mut x: f64, mut y: f64, mut z: f64, tilt: f64, yaw: f64) -> [f64; 3] {
    let (ny, nz) = rotate_x(y, z, tilt);
    y = ny;
    z = nz;
    let (nx, nz) = rotate_y(x, z, yaw);
    x = nx;
    z = nz;
    [x, y, z]
}

fn shade_char(shade: f64) -> char {
    let idx = (clamp(shade, 0.0, 1.0) * (SHADE_RAMP.len() - 1) as f64).round() as usize;
    SHADE_RAMP[idx.min(SHADE_RAMP.len() - 1)] as char
}

/// Render one Möbius frame. `phase` slides the half-twist around the single face.
pub fn render_frame(cols: usize, rows: usize, phase: f64) -> Vec<Vec<Option<Glyph>>> {
    let cols = cols.max(16);
    let rows = rows.max(5);
    let mut grid: Vec<Vec<Option<Cell>>> = vec![vec![None; cols]; rows];
    let tilt = 0.42;
    let yaw = 0.18 * (phase * 0.5).sin();
    let theta_steps = (cols * 12).clamp(240, 520);
    let scale = ((cols as f64 - 2.0) / 4.15).min((rows as f64 - 2.0) / (2.15 * CELL_ASPECT));

    for i in 0..theta_steps {
        let theta = (i as f64 / theta_steps as f64) * std::f64::consts::TAU;
        for j in -4..=4 {
            let width = j as f64 / 4.0;
            let base = logo_point(theta, width, phase);
            let n0 = logo_normal(theta, phase);
            let thicks: &[i32] = if j == -4 || j == 4 { &[-1, 0, 1] } else { &[-1, 1] };
            for &thick in thicks {
                let mut x = base[0] + n0[0] * f64::from(thick) * THICKNESS;
                let mut y = base[1] + n0[1] * f64::from(thick) * THICKNESS;
                let mut z = base[2] + n0[2] * f64::from(thick) * THICKNESS;
                let mut nx = if thick < 0 { -n0[0] } else { n0[0] };
                let mut ny = if thick < 0 { -n0[1] } else { n0[1] };
                let mut nz = if thick < 0 { -n0[2] } else { n0[2] };
                [x, y, z] = transform(x, y, z, tilt, yaw);
                [nx, ny, nz] = transform(nx, ny, nz, tilt, yaw);
                if !x.is_finite() || !y.is_finite() || !z.is_finite() {
                    continue;
                }

                let mut normal = [nx, ny, nz];
                let facing = dot(normal, VIEW);
                let back = facing < 0.0;
                if back {
                    normal = [-normal[0], -normal[1], -normal[2]];
                }

                let depth = CAM - z;
                if depth < 0.4 || !depth.is_finite() {
                    continue;
                }
                let px = (x * FOCAL) / depth;
                let py = (y * FOCAL) / depth;
                if !px.is_finite() || !py.is_finite() {
                    continue;
                }

                let lambert = dot(normal, KEY).max(0.0);
                let fill = dot(normal, FILL).max(0.0) * 0.2;
                let cam_fill = dot(normal, VIEW).max(0.0) * 0.2;
                let half = norm([
                    KEY[0] + VIEW[0],
                    KEY[1] + VIEW[1],
                    KEY[2] + VIEW[2],
                ]);
                let spec = dot(normal, half).max(0.0).powf(26.0);
                let edge = width.abs();
                let rim = (1.0 - dot(normal, VIEW).abs()).powf(2.2) * (0.12 + 0.45 * edge * edge);
                let rider = (theta - phase).cos().max(0.0).powf(18.0);
                let ambient = if back { 0.1 } else { 0.2 };
                let lit = ambient
                    + lambert * (if back { 0.32 } else { 0.7 })
                    + fill
                    + cam_fill
                    + spec * 0.45
                    + rim
                    + rider * 0.55;
                let shade = clamp(lit.powf(1.12), 0.07, 1.0);
                let fog = 0.5 + 0.5 * clamp(1.0 - (depth - 5.2) / 3.4, 0.0, 1.0);

                let col = (px * scale + (cols as f64 - 1.0) / 2.0).round() as isize;
                let row = (-py * scale * CELL_ASPECT + (rows as f64 - 1.0) / 2.0).round() as isize;
                if col < 0 || col >= cols as isize || row < 0 || row >= rows as isize {
                    continue;
                }
                let prev = grid[row as usize][col as usize];
                if prev.is_none_or(|p| depth < p.z) {
                    grid[row as usize][col as usize] = Some(Cell {
                        z: depth,
                        shade: clamp(shade * fog, 0.06, 1.0),
                        t: theta + phase,
                        spec: (spec + rider) * fog,
                    });
                }
            }
        }
    }

    grid.into_iter()
        .map(|line| {
            line.into_iter()
                .map(|cell| {
                    cell.map(|cell| {
                        let ch = shade_char(cell.shade);
                        let (r, g, b) = mobius_rgb(cell.t);
                        let lift = 0.2 + cell.shade * 0.92 + cell.spec * 0.55;
                        Glyph {
                            ch,
                            rgb: (
                                clamp(f64::from(r) * lift, 0.0, 255.0).round() as u8,
                                clamp(f64::from(g) * lift, 0.0, 255.0).round() as u8,
                                clamp(f64::from(b) * lift, 0.0, 255.0).round() as u8,
                            ),
                        }
                    })
                })
                .collect()
        })
        .collect()
}

#[cfg(test)]
pub fn render_plain(cols: usize, rows: usize, phase: f64) -> String {
    render_frame(cols, rows, phase)
        .into_iter()
        .map(|line| {
            line.into_iter()
                .map(|cell| cell.map(|g| g.ch).unwrap_or(' '))
                .collect::<String>()
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn half_twist_is_continuous() {
        let a = logo_point(0.4, 1.0, 0.0);
        let b = logo_point(0.4 + std::f64::consts::TAU, -1.0, 0.0);
        assert!((a[0] - b[0]).abs() < 1e-5);
        assert!((a[1] - b[1]).abs() < 1e-5);
        assert!((a[2] - b[2]).abs() < 1e-5);
    }

    #[test]
    fn phases_are_different_views() {
        let a = render_plain(36, 9, 0.0);
        let b = render_plain(36, 9, 1.1);
        assert_ne!(a, b);
        assert!(!a.contains("NaN"));
        assert!(!b.contains("NaN"));
        let marks: String = a.chars().filter(|c| !c.is_whitespace()).collect();
        assert!(marks.len() > 20);
        assert!(marks.chars().any(|c| "@%#".contains(c)));
        assert!(marks.chars().any(|c| ".:-".contains(c)));
    }

    #[test]
    fn brand_gradient_runs_blue_to_gold() {
        assert!(mobius_rgb(0.0).2 > 180);
        assert!(mobius_rgb(std::f64::consts::PI).0 > 100);
        assert!(mobius_rgb(std::f64::consts::TAU * 0.99).0 > 180);
    }

    #[test]
    fn frame_size_is_stable() {
        let frame = render_plain(36, 9, 0.85);
        let lines: Vec<&str> = frame.lines().collect();
        assert_eq!(lines.len(), 9);
        assert!(lines.iter().all(|l| l.chars().count() == 36));
    }
}
