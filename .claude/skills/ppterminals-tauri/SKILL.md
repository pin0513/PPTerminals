---
name: PPTerminals Tauri Stack
description: Tauri 2.0 + React + xterm.js terminal app 開發指南。涵蓋 PTY 管理、IPC 模式、Claude CLI 整合、terminal rendering。當需要修改 PPTerminals 的 Tauri 版本時使用。
---

# PPTerminals Tauri Stack Guide

> **Status**: Legacy — Native 版 (egui + Rust) 為主力開發方向。此版本僅維護。

## Architecture

```
React Frontend (xterm.js) ← IPC → Rust Backend (portable-pty)
```

## Key Patterns

### IPC Commands
```rust
#[tauri::command]
async fn pty_create(state: State<'_, AppState>, cwd: Option<String>) -> Result<PtyCreateResult, String>
```
```typescript
const result = await invoke<PtyCreateResult>('pty_create', { cwd });
```

### Events (Rust → Frontend)
```rust
app.emit(&format!("pty:output:{}", tab_id), &PtyOutput { tab_id, data });
```
```typescript
const unlisten = await listen<PtyOutput>(`pty:output:${tabId}`, (e) => terminal.write(e.payload.data));
```

### Terminal (xterm.js)
- Canvas renderer (not WebGL) for emoji support
- Unicode11Addon for CJK width
- FitAddon for auto-resize
- Claude Code TUI has inherent rendering limitations in webview

### Claude CLI Detection
Parse PTY output for: `Claude Code v`, `bypass permissions`, `Running N agents`, `↓ N tokens`

## File Structure
- `src-tauri/src/pty_manager.rs` — PTY sessions
- `src-tauri/src/fs_commands.rs` — File system operations
- `src-tauri/src/native_term.rs` — vt100 parser (experimental)
- `src/hooks/use-pty.ts` — Terminal hook
- `src/components/TerminalView.tsx` — Terminal UI
- `src/stores/` — Zustand stores
