# PPTerminals - Team Contract

## Project Overview

PPTerminals 是一個跨平台（macOS + Windows）Terminal App，基於 **Tauri 2.0 + React + TypeScript** 技術棧，深度整合 Claude CLI。參考 Warp Terminal 的設計風格。

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Desktop Framework** | Tauri 2.0 |
| **Backend** | Rust |
| **Frontend** | React 18 + TypeScript |
| **Terminal Emulation** | xterm.js |
| **Styling** | Tailwind CSS |
| **State Management** | Zustand |
| **Build** | Vite |
| **Package Manager** | pnpm |

## Architecture

```
┌─────────────────────────────────────────┐
│              React Frontend             │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌───────┐  │
│  │Tab 1 │ │Tab 2 │ │Tab 3 │ │ + New │  │
│  └──┬───┘ └──┬───┘ └──┬───┘ └───────┘  │
│     │        │        │                 │
│  ┌──┴────────┴────────┴──────────────┐  │
│  │     Terminal Renderer (xterm.js)  │  │
│  │     + Markdown Preview            │  │
│  │     + Clickable Links             │  │
│  │     + Permission Dialog           │  │
│  └──────────────┬────────────────────┘  │
├─────────────────┼───────────────────────┤
│  Tauri IPC      │                       │
├─────────────────┼───────────────────────┤
│              Rust Backend               │
│  ┌──────────────┴────────────────────┐  │
│  │  PTY Manager (per-tab sessions)   │  │
│  │  Claude CLI Process Manager       │  │
│  │  Permission Controller            │  │
│  │  App-level Auth                   │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

## Core Features

1. **Multi Tab** - 每個 Tab 是獨立的 PTY session，關閉時彈出確認對話框
2. **Claude CLI Deep Integration** - tool use 狀態視覺化、permission prompt UI 化、streaming output 渲染
3. **Clickable Elements** - HTML content、file path、HTTP/HTTPS URL 均可點擊，打開對應外部工具
4. **Markdown Preview** - Claude 回應中的 Markdown 即時渲染預覽
5. **Permission Control** - Claude CLI permission（allow/deny tool calls）+ App 層級權限管理

## Team Roles

| Role | Agent File | Responsibility |
|------|-----------|----------------|
| **Project Coordinator** | `agents/project-coordinator.md` | 任務規劃、架構決策、進度追蹤 |
| **Rust Developer** | `agents/backend/rust-developer.md` | Tauri backend、PTY、IPC、權限系統 |
| **React Developer** | `agents/frontend/react-developer.md` | Terminal UI、Tabs、Markdown、Links |
| **UI Designer** | `agents/frontend/ui-designer.md` | Warp 風格介面、互動設計 |
| **Claude Integration Dev** | `agents/integration/claude-integration-dev.md` | Claude CLI 整合、output parsing |

## Conventions

### File Naming
- Rust: `snake_case.rs`
- React Components: `PascalCase.tsx`
- Hooks: `use-camel-case.ts`
- Utils: `camel-case.ts`
- Styles: `component-name.module.css` or Tailwind utility classes

### IPC Command Naming
- Format: `{domain}:{action}`
- Examples: `pty:create`, `pty:write`, `pty:resize`, `claude:start`, `claude:permission-respond`

### Commit Message
- Format: `type(scope): description`
- Types: `feat`, `fix`, `refactor`, `style`, `test`, `docs`, `chore`
- Scopes: `pty`, `tabs`, `claude`, `ui`, `permission`, `ipc`

### Branch Naming
- Feature: `feat/{short-description}`
- Fix: `fix/{short-description}`

## Constraints

- All code must compile and run on both macOS and Windows
- Rust code must handle platform-specific PTY APIs via conditional compilation (`#[cfg(target_os)]`)
- No hardcoded file paths - use `dirs` crate or Tauri path APIs
- IPC calls must have TypeScript type definitions matching Rust structs
- Tab close must always prompt confirmation if session is active
