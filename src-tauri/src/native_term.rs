use parking_lot::Mutex;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Arc;

/// A cell in the terminal grid
#[derive(Serialize, Clone, Debug)]
pub struct TermCell {
    pub ch: String,
    pub fg: String,    // CSS color
    pub bg: String,    // CSS color
    pub bold: bool,
    pub italic: bool,
    pub underline: bool,
    pub dim: bool,
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

pub struct NativeTermManager {
    parsers: Mutex<HashMap<String, vt100::Parser>>,
}

impl NativeTermManager {
    pub fn new() -> Self {
        Self {
            parsers: Mutex::new(HashMap::new()),
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
                        row.push(TermCell {
                            ch: if ch.is_empty() { " ".to_string() } else { ch.to_string() },
                            fg: color_to_css(cell.fgcolor(), true),
                            bg: color_to_css(cell.bgcolor(), false),
                            bold: cell.bold(),
                            italic: cell.italic(),
                            underline: cell.underline(),
                            dim: cell.dim(),
                        });
                    }
                    None => {
                        row.push(TermCell {
                            ch: " ".to_string(),
                            fg: "#e6e6e6".to_string(),
                            bg: "transparent".to_string(),
                            bold: false,
                            italic: false,
                            underline: false,
                            dim: false,
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

    pub fn remove(&self, tab_id: &str) {
        self.parsers.lock().remove(tab_id);
    }
}
