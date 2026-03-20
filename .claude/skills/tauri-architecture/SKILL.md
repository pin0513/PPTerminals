---
name: Tauri 2.0 Architecture
description: Tauri 2.0 專案結構、IPC 模式、事件系統、跨平台建置指南
---

# Tauri 2.0 Architecture Guide

## Project Structure

```
src-tauri/
├── Cargo.toml
├── tauri.conf.json
├── capabilities/
│   └── default.json          ← Permission capabilities
├── src/
│   ├── main.rs               ← Entry point
│   ├── lib.rs                ← Tauri app builder
│   ├── commands/
│   │   ├── mod.rs
│   │   ├── pty.rs            ← PTY commands
│   │   ├── claude.rs         ← Claude CLI commands
│   │   └── permission.rs    ← App permission commands
│   ├── pty/
│   │   ├── mod.rs
│   │   ├── manager.rs        ← PTY session manager
│   │   └── platform.rs       ← Platform-specific PTY
│   ├── claude/
│   │   ├── mod.rs
│   │   ├── parser.rs         ← Output parser
│   │   └── session.rs        ← Session lifecycle
│   └── state.rs              ← AppState definition
└── icons/

src/                           ← React frontend
├── main.tsx
├── App.tsx
├── components/
├── hooks/
├── stores/
└── types/
```

## IPC Pattern (Tauri 2.0)

### Define Command (Rust)

```rust
#[tauri::command]
async fn pty_create(
    state: tauri::State<'_, AppState>,
    shell: Option<String>,
) -> Result<String, String> {
    // Implementation
}
```

### Register Command

```rust
// lib.rs
tauri::Builder::default()
    .manage(AppState::default())
    .invoke_handler(tauri::generate_handler![
        commands::pty::pty_create,
        commands::pty::pty_write,
        commands::pty::pty_resize,
        commands::pty::pty_close,
        commands::claude::claude_start,
        commands::claude::claude_respond_permission,
    ])
    .run(tauri::generate_context!())
```

### Call from Frontend (TypeScript)

```typescript
import { invoke } from '@tauri-apps/api/core';

const tabId = await invoke<string>('pty_create', { shell: null });
```

## Event System

### Emit from Rust

```rust
use tauri::Emitter;

app_handle.emit(&format!("pty:output:{}", tab_id), &output_data)?;
```

### Listen in Frontend

```typescript
import { listen } from '@tauri-apps/api/event';

const unlisten = await listen<string>('pty:output:tab-1', (event) => {
  terminal.write(event.payload);
});

// Cleanup
unlisten();
```

## Cross-platform Build

```bash
# Development
pnpm tauri dev

# Build for current platform
pnpm tauri build

# Build for specific targets
pnpm tauri build --target universal-apple-darwin    # macOS universal
pnpm tauri build --target x86_64-pc-windows-msvc    # Windows x64
```

## Capabilities (Tauri 2.0 Permission Model)

```json
// src-tauri/capabilities/default.json
{
  "identifier": "default",
  "description": "Default capabilities",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "shell:allow-open",
    "dialog:default",
    "fs:default"
  ]
}
```
