use serde::Serialize;
use std::fs;
use std::path::PathBuf;

#[derive(Serialize, Clone, Debug)]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_hidden: bool,
    pub extension: Option<String>,
    pub size: Option<u64>,
}

#[tauri::command]
pub async fn fs_list_dir(path: String) -> Result<Vec<DirEntry>, String> {
    let dir_path = PathBuf::from(&path);
    if !dir_path.is_dir() {
        return Err(format!("Not a directory: {}", path));
    }

    let mut entries: Vec<DirEntry> = Vec::new();

    let read_dir = fs::read_dir(&dir_path).map_err(|e| e.to_string())?;

    for entry in read_dir {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };

        let name = entry.file_name().to_string_lossy().to_string();
        let path = entry.path().to_string_lossy().to_string();
        let is_hidden = name.starts_with('.');

        let metadata = entry.metadata().ok();
        let is_dir = metadata.as_ref().map(|m| m.is_dir()).unwrap_or(false);
        let size = metadata.as_ref().and_then(|m| if m.is_file() { Some(m.len()) } else { None });
        let extension = entry
            .path()
            .extension()
            .map(|e| e.to_string_lossy().to_string());

        entries.push(DirEntry {
            name,
            path,
            is_dir,
            is_hidden,
            extension,
            size,
        });
    }

    // Sort: directories first, then alphabetically (case-insensitive)
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(entries)
}

#[tauri::command]
pub async fn fs_get_home_dir() -> Result<String, String> {
    dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| "Cannot determine home directory".to_string())
}

#[tauri::command]
pub async fn fs_open_file(path: String) -> Result<(), String> {
    open::that(&path).map_err(|e| format!("Failed to open {}: {}", path, e))
}

#[derive(Serialize, Clone, Debug)]
pub struct FileInfo {
    pub path: String,
    pub name: String,
    pub extension: Option<String>,
    pub content: String,
    pub size: u64,
    pub is_binary: bool,
}

#[tauri::command]
pub async fn fs_read_file(path: String) -> Result<FileInfo, String> {
    let file_path = PathBuf::from(&path);
    if !file_path.is_file() {
        return Err(format!("Not a file: {}", path));
    }

    let metadata = fs::metadata(&file_path).map_err(|e| e.to_string())?;
    let size = metadata.len();

    // Limit file size to 5MB for preview
    if size > 5 * 1024 * 1024 {
        return Err("File too large for preview (>5MB)".to_string());
    }

    let bytes = fs::read(&file_path).map_err(|e| e.to_string())?;

    // Check if binary by looking for null bytes in first 8KB
    let check_len = bytes.len().min(8192);
    let is_binary = bytes[..check_len].contains(&0);

    let content = if is_binary {
        String::new()
    } else {
        String::from_utf8_lossy(&bytes).to_string()
    };

    let name = file_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();

    let extension = file_path
        .extension()
        .map(|e| e.to_string_lossy().to_string());

    Ok(FileInfo {
        path,
        name,
        extension,
        content,
        size,
        is_binary,
    })
}

#[tauri::command]
pub async fn fs_write_file(path: String, content: String) -> Result<(), String> {
    fs::write(&path, content).map_err(|e| format!("Failed to write {}: {}", path, e))
}

#[derive(Serialize, Clone, Debug)]
pub struct PathCheckResult {
    pub path: String,
    pub resolved: String,
    pub exists: bool,
    pub is_file: bool,
    pub is_dir: bool,
}

#[tauri::command]
pub async fn fs_create_file(path: String) -> Result<(), String> {
    let file_path = PathBuf::from(&path);
    if file_path.exists() {
        return Err(format!("Already exists: {}", path));
    }
    fs::write(&file_path, "").map_err(|e| format!("Failed to create file {}: {}", path, e))
}

#[tauri::command]
pub async fn fs_create_dir(path: String) -> Result<(), String> {
    let dir_path = PathBuf::from(&path);
    if dir_path.exists() {
        return Err(format!("Already exists: {}", path));
    }
    fs::create_dir_all(&dir_path).map_err(|e| format!("Failed to create directory {}: {}", path, e))
}

#[tauri::command]
pub async fn fs_check_path(path: String, cwd: Option<String>) -> Result<PathCheckResult, String> {
    let expanded = if path.starts_with('~') {
        if let Some(home) = dirs::home_dir() {
            home.join(path.strip_prefix("~/").unwrap_or(&path[1..]))
        } else {
            PathBuf::from(&path)
        }
    } else {
        let p = PathBuf::from(&path);
        if p.is_absolute() {
            p
        } else if let Some(ref cwd_str) = cwd {
            PathBuf::from(cwd_str).join(&path)
        } else {
            p
        }
    };

    let resolved = expanded.to_string_lossy().to_string();
    let exists = expanded.exists();
    let is_file = expanded.is_file();
    let is_dir = expanded.is_dir();

    Ok(PathCheckResult {
        path,
        resolved,
        exists,
        is_file,
        is_dir,
    })
}

// ─── Repo Ecosystem Scanner ───

#[derive(Serialize, Clone, Debug)]
pub struct SkillEntry {
    pub name: String,
    pub path: String,
    pub source: String, // "claude" or "codex"
    pub description: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct SubRepo {
    pub name: String,
    pub path: String,
    pub has_git: bool,
    pub has_claude: bool,
}

#[derive(Serialize, Clone, Debug)]
pub struct RepoEcosystem {
    pub root: String,
    pub has_git: bool,
    pub git_branch: String,
    pub has_claude_md: bool,
    pub has_claude_dir: bool,
    pub skills: Vec<SkillEntry>,
    pub sub_repos: Vec<SubRepo>,
}

#[tauri::command]
pub async fn fs_scan_ecosystem(path: String) -> Result<RepoEcosystem, String> {
    let root = PathBuf::from(&path);
    if !root.is_dir() {
        return Err(format!("Not a directory: {}", path));
    }

    let has_git = root.join(".git").exists();

    // Get git branch
    let git_branch = if has_git {
        let head = root.join(".git/HEAD");
        fs::read_to_string(&head)
            .ok()
            .and_then(|content| {
                content.strip_prefix("ref: refs/heads/")
                    .map(|b| b.trim().to_string())
            })
            .unwrap_or_else(|| "detached".to_string())
    } else {
        String::new()
    };

    let has_claude_md = root.join("CLAUDE.md").exists();
    let has_claude_dir = root.join(".claude").exists();

    // Scan skills from .claude/skills/ and .claude/agents/
    let mut skills = Vec::new();
    scan_skills_dir(&root.join(".claude/skills"), "claude", &mut skills);
    scan_skills_dir(&root.join(".claude/agents"), "claude", &mut skills);

    // Scan codex skills if .codex directory exists
    scan_skills_dir(&root.join(".codex"), "codex", &mut skills);

    // Scan sub-repos (1 level deep only)
    let mut sub_repos = Vec::new();
    if let Ok(entries) = fs::read_dir(&root) {
        for entry in entries.flatten() {
            let p = entry.path();
            if !p.is_dir() { continue; }
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') { continue; }
            if name == "node_modules" || name == "target" || name == "dist" || name == "build" {
                continue;
            }
            let sub_git = p.join(".git").exists();
            let sub_claude = p.join("CLAUDE.md").exists() || p.join(".claude").exists();
            if sub_git || sub_claude {
                sub_repos.push(SubRepo {
                    name,
                    path: p.to_string_lossy().to_string(),
                    has_git: sub_git,
                    has_claude: sub_claude,
                });
            }
        }
    }
    sub_repos.sort_by(|a, b| a.name.cmp(&b.name));

    Ok(RepoEcosystem {
        root: path,
        has_git,
        git_branch,
        has_claude_md,
        has_claude_dir,
        skills,
        sub_repos,
    })
}

fn scan_skills_dir(dir: &PathBuf, source: &str, out: &mut Vec<SkillEntry>) {
    let Ok(entries) = fs::read_dir(dir) else { return; };
    for entry in entries.flatten() {
        let p = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();

        if p.is_dir() {
            // Directory-based skill: look for SKILL.md or *.md
            let skill_md = p.join("SKILL.md");
            let desc = if skill_md.exists() {
                first_line_after_header(&skill_md)
            } else {
                String::new()
            };
            out.push(SkillEntry {
                name: name.clone(),
                path: p.to_string_lossy().to_string(),
                source: source.to_string(),
                description: desc,
            });
        } else if name.ends_with(".md") {
            // File-based skill
            let desc = first_line_after_header(&p);
            out.push(SkillEntry {
                name: name.trim_end_matches(".md").to_string(),
                path: p.to_string_lossy().to_string(),
                source: source.to_string(),
                description: desc,
            });
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
}

fn first_line_after_header(path: &PathBuf) -> String {
    let Ok(content) = fs::read_to_string(path) else { return String::new(); };
    // Skip YAML frontmatter
    let body = if content.starts_with("---") {
        content.splitn(3, "---").nth(2).unwrap_or("")
    } else {
        &content
    };
    // Find first non-empty, non-heading line
    for line in body.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') { continue; }
        let desc = trimmed.chars().take(80).collect::<String>();
        return desc;
    }
    String::new()
}
