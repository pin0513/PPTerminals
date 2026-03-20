use parking_lot::Mutex;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Arc;

/// A cell in the terminal grid
#[derive(Serialize, Clone, Debug)]
pub struct TermCell {
    pub ch: String,
    pub fg: String,
    pub bg: String,
    pub bold: bool,
    pub italic: bool,
    pub underline: bool,
    pub dim: bool,
    pub wide: bool,  // true = double-width character (CJK, emoji)
    pub skip: bool,  // true = continuation of a wide char (don't render)
}

/// Complete screen state sent to frontend
#[derive(Serialize, Clone, Debug)]
pub struct ScreenState {
    pub rows: Vec<Vec<TermCell>>,
    pub cursor_row: u16,
    pub cursor_col: u16,
    pub cursor_visible: bool,
    pub cols: u16,
    pub row_count: u16,
}

/// Maps vt100 Color to CSS color string
fn color_to_css(color: vt100::Color, is_fg: bool) -> String {
    match color {
        vt100::Color::Default => {
            if is_fg { "#e6e6e6".to_string() } else { "transparent".to_string() }
        }
        vt100::Color::Idx(i) => match i {
            0 => "#0a0e14".to_string(),
            1 => "#f85149".to_string(),
            2 => "#3fb950".to_string(),
            3 => "#d29922".to_string(),
            4 => "#58a6ff".to_string(),
            5 => "#bc8cff".to_string(),
            6 => "#39c5cf".to_string(),
            7 => "#e6e6e6".to_string(),
            8 => "#484f58".to_string(),
            9 => "#ff7b72".to_string(),
            10 => "#56d364".to_string(),
            11 => "#e3b341".to_string(),
            12 => "#79c0ff".to_string(),
            13 => "#d2a8ff".to_string(),
            14 => "#56d4dd".to_string(),
            15 => "#ffffff".to_string(),
            // 256-color approximate
            _ => format!("#{:02x}{:02x}{:02x}",
                if i < 232 { let n = i - 16; ((n / 36) * 51) } else { let g = (i - 232) * 10 + 8; g },
                if i < 232 { let n = i - 16; (((n % 36) / 6) * 51) } else { let g = (i - 232) * 10 + 8; g },
                if i < 232 { let n = i - 16; ((n % 6) * 51) } else { let g = (i - 232) * 10 + 8; g },
            ),
        }
        vt100::Color::Rgb(r, g, b) => format!("#{:02x}{:02x}{:02x}", r, g, b),
    }
}

/// Tracks which rows changed since last screen fetch
#[derive(Serialize, Clone, Debug)]
pub struct ScreenDiff {
    pub changed_rows: Vec<(u16, Vec<TermCell>)>, // (row_index, cells)
    pub cursor_row: u16,
    pub cursor_col: u16,
    pub cursor_visible: bool,
}

pub struct NativeTermManager {
    parsers: Mutex<HashMap<String, vt100::Parser>>,
    prev_screens: Mutex<HashMap<String, Vec<Vec<String>>>>, // row → cell contents for diff
}

impl NativeTermManager {
    pub fn new() -> Self {
        Self {
            parsers: Mutex::new(HashMap::new()),
            prev_screens: Mutex::new(HashMap::new()),
        }
    }

    pub fn create(&self, tab_id: &str, cols: u16, rows: u16) {
        let parser = vt100::Parser::new(rows, cols, 0); // 0 = no scrollback for now
        self.parsers.lock().insert(tab_id.to_string(), parser);
    }

    pub fn process(&self, tab_id: &str, data: &[u8]) {
        let mut parsers = self.parsers.lock();
        if let Some(parser) = parsers.get_mut(tab_id) {
            parser.process(data);
        }
    }

    pub fn resize(&self, tab_id: &str, cols: u16, rows: u16) {
        let mut parsers = self.parsers.lock();
        if let Some(parser) = parsers.get_mut(tab_id) {
            parser.screen_mut().set_size(rows, cols);
        }
    }

    pub fn get_screen(&self, tab_id: &str) -> Option<ScreenState> {
        let parsers = self.parsers.lock();
        let parser = parsers.get(tab_id)?;
        let screen = parser.screen();

        let cols = screen.size().1;
        let row_count = screen.size().0;
        let mut rows = Vec::with_capacity(row_count as usize);

        for r in 0..row_count {
            let mut row = Vec::with_capacity(cols as usize);
            for c in 0..cols {
                let cell = screen.cell(r, c);
                match cell {
                    Some(cell) => {
                        let ch = cell.contents();
                        let is_wide = cell.is_wide();
                        let is_continuation = cell.is_wide_continuation();
                        row.push(TermCell {
                            ch: if is_continuation { String::new() } else if ch.is_empty() { " ".to_string() } else { ch.to_string() },
                            fg: color_to_css(cell.fgcolor(), true),
                            bg: color_to_css(cell.bgcolor(), false),
                            bold: cell.bold(),
                            italic: cell.italic(),
                            underline: cell.underline(),
                            dim: cell.dim(),
                            wide: is_wide,
                            skip: is_continuation,
                        });
                    }
                    None => {
                        row.push(TermCell {
                            ch: " ".to_string(),
                            fg: "#e6e6e6".to_string(),
                            bg: "transparent".to_string(),
                            bold: false, italic: false, underline: false, dim: false,
                            wide: false, skip: false,
                        });
                    }
                }
            }
            rows.push(row);
        }

        let cursor = screen.cursor_position();
        Some(ScreenState {
            rows,
            cursor_row: cursor.0,
            cursor_col: cursor.1,
            cursor_visible: !screen.hide_cursor(),
            cols,
            row_count,
        })
    }

    /// Get only the rows that changed since last call
    pub fn get_screen_diff(&self, tab_id: &str) -> Option<ScreenDiff> {
        let parsers = self.parsers.lock();
        let parser = parsers.get(tab_id)?;
        let screen = parser.screen();
        let cols = screen.size().1;
        let row_count = screen.size().0;

        let mut prev_screens = self.prev_screens.lock();
        let prev = prev_screens.entry(tab_id.to_string()).or_insert_with(Vec::new);

        let mut changed_rows = Vec::new();

        for r in 0..row_count {
            let mut row_hash = Vec::with_capacity(cols as usize);
            let mut row_cells = Vec::with_capacity(cols as usize);

            for c in 0..cols {
                let cell = screen.cell(r, c);
                let (ch, fg, bg, bold, italic, underline, dim, wide, skip) = match cell {
                    Some(cell) => {
                        let contents = cell.contents();
                        let is_wide = cell.is_wide();
                        let is_cont = cell.is_wide_continuation();
                        (
                            if is_cont { String::new() } else if contents.is_empty() { " ".to_string() } else { contents.to_string() },
                            color_to_css(cell.fgcolor(), true),
                            color_to_css(cell.bgcolor(), false),
                            cell.bold(), cell.italic(), cell.underline(), cell.dim(),
                            is_wide, is_cont,
                        )
                    }
                    None => (" ".to_string(), "#e6e6e6".to_string(), "transparent".to_string(), false, false, false, false, false, false),
                };

                row_hash.push(format!("{}|{}", ch, fg));
                row_cells.push(TermCell {
                    ch, fg, bg, bold, italic, underline, dim, wide, skip,
                });
            }

            // Compare with previous
            let row_idx = r as usize;
            let changed = if row_idx >= prev.len() {
                true
            } else {
                prev[row_idx] != row_hash
            };

            if changed {
                changed_rows.push((r, row_cells));
            }

            // Update prev
            if row_idx >= prev.len() {
                prev.push(row_hash);
            } else {
                prev[row_idx] = row_hash;
            }
        }

        // Trim prev if screen shrank
        prev.truncate(row_count as usize);

        let cursor = screen.cursor_position();
        Some(ScreenDiff {
            changed_rows,
            cursor_row: cursor.0,
            cursor_col: cursor.1,
            cursor_visible: !screen.hide_cursor(),
        })
    }

    pub fn remove(&self, tab_id: &str) {
        self.parsers.lock().remove(tab_id);
        self.prev_screens.lock().remove(tab_id);
    }
}
