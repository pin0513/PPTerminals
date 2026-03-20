---
name: Cross-platform Compatibility
description: macOS 與 Windows 跨平台開發規範，確保所有程式碼在兩個平台都能正確運作
---

# Cross-platform Compatibility Rules

## Rust Backend

### File Paths
- Use `std::path::PathBuf` for all path operations, never string concatenation
- Use `dirs` crate or `tauri::path` API for system directories (home, config, temp)
- Never hardcode path separators (`/` or `\`)

### PTY
- Use `portable-pty` crate for unified API across macOS (openpty) and Windows (ConPTY)
- Default shell: macOS → `$SHELL` or `/bin/zsh`; Windows → `cmd.exe` or `powershell.exe`
- Signal handling: macOS → SIGHUP/SIGTERM; Windows → TerminateProcess

### Conditional Compilation
```rust
#[cfg(target_os = "macos")]
fn default_shell() -> String { /* ... */ }

#[cfg(target_os = "windows")]
fn default_shell() -> String { /* ... */ }
```

## React Frontend

### Keyboard Shortcuts
- Use `Cmd` on macOS, `Ctrl` on Windows
- Detect platform via `navigator.platform` or Tauri's `os` module
- Define shortcuts as `{ mac: 'Cmd+T', win: 'Ctrl+T' }`

### File Path Display
- Show paths in platform-native format (forward slash on macOS, backslash on Windows)

### Font Fallbacks
- Always include cross-platform font stack: `'JetBrains Mono', 'Cascadia Code', monospace`

## Violation Criteria

- Hardcoded Unix paths (`/bin/bash`) without Windows equivalent
- Using `std::fs` path operations with string slicing instead of `PathBuf`
- Keyboard shortcuts that only work on one platform
- Tests that only pass on one OS
