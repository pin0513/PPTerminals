mod fs_commands;
mod pty_manager;

use pty_manager::PtyManager;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::State;

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct PtyOutput {
    pub tab_id: String,
    pub data: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct PtyExited {
    pub tab_id: String,
    pub exit_code: Option<i32>,
}

pub struct AppState {
    pub pty_manager: Arc<PtyManager>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct PtyCreateResult {
    pub tab_id: String,
    pub cwd: String,
}

#[tauri::command]
async fn pty_create(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    cwd: Option<String>,
) -> Result<PtyCreateResult, String> {
    let tab_id = uuid::Uuid::new_v4().to_string();
    let resolved_cwd = cwd
        .or_else(|| dirs::home_dir().map(|p| p.to_string_lossy().to_string()))
        .unwrap_or_else(|| "/".to_string());
    state
        .pty_manager
        .create_session(&tab_id, None, Some(&resolved_cwd), app)
        .map_err(|e| e.to_string())?;
    Ok(PtyCreateResult {
        tab_id,
        cwd: resolved_cwd,
    })
}

#[tauri::command]
async fn pty_write(
    state: State<'_, AppState>,
    tab_id: String,
    data: String,
) -> Result<(), String> {
    state
        .pty_manager
        .write_to_session(&tab_id, &data)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn pty_resize(
    state: State<'_, AppState>,
    tab_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    state
        .pty_manager
        .resize_session(&tab_id, cols, rows)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn pty_close(
    state: State<'_, AppState>,
    tab_id: String,
) -> Result<(), String> {
    state
        .pty_manager
        .close_session(&tab_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn pty_is_active(
    state: State<'_, AppState>,
    tab_id: String,
) -> Result<bool, String> {
    Ok(state.pty_manager.is_active(&tab_id))
}

#[derive(Clone, Serialize, Debug)]
pub struct SessionStatus {
    pub tab_id: String,
    pub active: bool,
}

#[tauri::command]
async fn pty_all_status(
    state: State<'_, AppState>,
) -> Result<Vec<SessionStatus>, String> {
    Ok(state
        .pty_manager
        .all_sessions_status()
        .into_iter()
        .map(|(tab_id, active)| SessionStatus { tab_id, active })
        .collect())
}

#[derive(Clone, Serialize, Debug)]
pub struct HelpCompletion {
    pub name: String,
    pub description: String,
    pub kind: String, // "flag", "subcommand", "option"
}

#[derive(Clone, Serialize, Debug)]
pub struct HelpResult {
    pub command: String,
    pub completions: Vec<HelpCompletion>,
    pub raw: String,
}

#[tauri::command]
async fn cmd_get_help(command: String, cwd: Option<String>) -> Result<HelpResult, String> {
    use std::process::Command;

    let parts: Vec<&str> = command.split_whitespace().collect();
    if parts.is_empty() {
        return Err("Empty command".to_string());
    }

    let program = parts[0];
    let mut args: Vec<&str> = parts[1..].to_vec();
    args.push("--help");

    let resolved_cwd = cwd.unwrap_or_else(|| {
        dirs::home_dir()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| "/".to_string())
    });

    let output = Command::new(program)
        .args(&args)
        .current_dir(&resolved_cwd)
        .output()
        .map_err(|e| format!("Failed to run {} --help: {}", command, e))?;

    // Many tools output help to stderr (e.g., git), so combine both
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let raw = if stdout.len() > stderr.len() { &stdout } else { &stderr };

    let completions = parse_help_output(raw);

    Ok(HelpResult {
        command,
        completions,
        raw: raw.to_string(),
    })
}

fn parse_help_output(text: &str) -> Vec<HelpCompletion> {
    let mut completions = Vec::new();

    for line in text.lines() {
        let trimmed = line.trim();

        // Match flag patterns: -f, --flag, --flag=VALUE, --flag <value>
        // Common formats:
        //   -h, --help            Show help
        //   --verbose             Enable verbose
        //   -o, --output <file>   Output file
        if let Some(caps) = parse_flag_line(trimmed) {
            completions.push(caps);
            continue;
        }

        // Match subcommand patterns (indented word followed by description)
        // Common formats:
        //   init          Initialize a new project
        //   clone         Clone a repository
        if let Some(caps) = parse_subcommand_line(trimmed) {
            completions.push(caps);
        }
    }

    completions
}

fn parse_flag_line(line: &str) -> Option<HelpCompletion> {
    // Pattern: starts with - or --
    if !line.starts_with('-') {
        return None;
    }

    // Split on 2+ spaces to separate flags from description
    let parts: Vec<&str> = line.splitn(2, "  ").collect();
    let flag_part = parts[0].trim();
    let desc = parts.get(1).map(|s| s.trim()).unwrap_or("").to_string();

    // Extract the longest flag name
    let flags: Vec<&str> = flag_part.split(',').map(|s| s.trim().split_whitespace().next().unwrap_or("")).collect();

    // Prefer --long over -s
    let best = flags
        .iter()
        .filter(|f| f.starts_with("--"))
        .next()
        .or_else(|| flags.first())
        .unwrap_or(&"");

    if best.is_empty() || !best.starts_with('-') {
        return None;
    }

    // Determine if it's a flag or an option (takes value)
    let kind = if flag_part.contains('<') || flag_part.contains('=') || flag_part.contains("VALUE") {
        "option"
    } else {
        "flag"
    };

    Some(HelpCompletion {
        name: best.to_string(),
        description: desc,
        kind: kind.to_string(),
    })
}

fn parse_subcommand_line(line: &str) -> Option<HelpCompletion> {
    // Must start with a letter (not a flag, not empty)
    if line.is_empty() || line.starts_with('-') || !line.chars().next()?.is_alphabetic() {
        return None;
    }

    // Must have 2+ space gap separating name from description
    let parts: Vec<&str> = line.splitn(2, "  ").collect();
    if parts.len() < 2 {
        return None;
    }

    let name = parts[0].trim();
    let desc = parts[1].trim();

    // Name must be a single word, no spaces, reasonable length
    if name.contains(' ') || name.len() > 30 || name.len() < 2 || desc.is_empty() {
        return None;
    }

    // Skip lines that look like section headers (all caps, etc.)
    if name.chars().all(|c| c.is_uppercase() || c == ':') {
        return None;
    }

    Some(HelpCompletion {
        name: name.to_string(),
        description: desc.to_string(),
        kind: "subcommand".to_string(),
    })
}

#[tauri::command]
async fn cmd_list_path_commands() -> Result<Vec<String>, String> {
    use std::collections::BTreeSet;

    let path_var = std::env::var("PATH").unwrap_or_default();
    let mut commands = BTreeSet::new();

    for dir in path_var.split(':') {
        let Ok(entries) = std::fs::read_dir(dir) else { continue };
        for entry in entries.flatten() {
            let meta = entry.metadata();
            let is_exec = meta.as_ref().map(|m| !m.is_dir()).unwrap_or(false);
            if is_exec {
                let name = entry.file_name().to_string_lossy().to_string();
                // Skip hidden and names with dots (like .DS_Store)
                if !name.starts_with('.') && !name.contains('.') || name.contains('-') {
                    commands.insert(name);
                }
            }
        }
    }

    // Also read shell history for frequently used commands
    if let Some(home) = dirs::home_dir() {
        for hist_file in &[".zsh_history", ".bash_history"] {
            let path = home.join(hist_file);
            if let Ok(content) = std::fs::read_to_string(&path) {
                // Take last 500 lines
                for line in content.lines().rev().take(500) {
                    // zsh history format: ": timestamp:0;command"
                    let cmd_part = if line.contains(";") {
                        line.splitn(2, ';').nth(1).unwrap_or(line)
                    } else {
                        line
                    };
                    if let Some(first_word) = cmd_part.trim().split_whitespace().next() {
                        let clean = first_word.trim();
                        if clean.len() >= 2 && clean.chars().next().map(|c| c.is_alphabetic()).unwrap_or(false) {
                            commands.insert(clean.to_string());
                        }
                    }
                }
            }
        }
    }

    Ok(commands.into_iter().collect())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .manage(AppState {
            pty_manager: Arc::new(PtyManager::new()),
        })
        .invoke_handler(tauri::generate_handler![
            pty_create,
            pty_write,
            pty_resize,
            pty_close,
            pty_is_active,
            pty_all_status,
            fs_commands::fs_list_dir,
            fs_commands::fs_get_home_dir,
            fs_commands::fs_open_file,
            fs_commands::fs_read_file,
            fs_commands::fs_write_file,
            fs_commands::fs_create_file,
            fs_commands::fs_create_dir,
            fs_commands::fs_check_path,
            fs_commands::fs_scan_ecosystem,
            cmd_get_help,
            cmd_list_path_commands,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
