---
name: Claude CLI Integration
description: Claude CLI 深度整合指南，包含 stream-json 格式、permission 橋接、output 解析
---

# Claude CLI Integration Guide

## Claude CLI Output Formats

### stream-json Mode (Recommended for Deep Integration)

```bash
claude --output-format stream-json
```

Each line is a JSON object:

```jsonl
{"type":"system","subtype":"init","session_id":"abc123","tools":["Read","Write","Bash"]}
{"type":"assistant","subtype":"text","text":"Let me "}
{"type":"assistant","subtype":"text","text":"read that file."}
{"type":"assistant","subtype":"tool_use","id":"tu_1","tool":"Read","input":{"file_path":"/foo.ts"}}
{"type":"tool_result","id":"tu_1","tool":"Read","output":"const x = 1;","is_error":false}
{"type":"assistant","subtype":"text","text":"The file contains..."}
{"type":"system","subtype":"permission_request","id":"pr_1","tool":"Bash","input":{"command":"npm test"}}
{"type":"result","subtype":"success","text":"Done.","session_id":"abc123"}
```

### Key Event Types

| type | subtype | Description |
|------|---------|-------------|
| `system` | `init` | Session started, includes available tools |
| `assistant` | `text` | Text content (may arrive in chunks) |
| `assistant` | `tool_use` | Claude is calling a tool |
| `tool_result` | - | Tool execution result |
| `system` | `permission_request` | Claude needs permission to run a tool |
| `result` | `success`/`error` | Session ended |

## Permission Bridge Protocol

### Detection (Rust Side)

```rust
// When we see a permission_request event:
if event_type == "system" && subtype == "permission_request" {
    let request = PermissionRequest {
        id: event["id"].as_str().unwrap().to_string(),
        tool: event["tool"].as_str().unwrap().to_string(),
        input: event["input"].clone(),
    };

    // Emit to frontend
    app_handle.emit(
        &format!("claude:permission-request:{}", tab_id),
        &request,
    )?;

    // Wait for user response (do NOT continue reading stdout)
    // The response will come via claude_respond_permission command
}
```

### Response (Write to stdin)

```rust
// When user responds via frontend:
fn respond_permission(stdin: &mut impl Write, allowed: bool) {
    if allowed {
        stdin.write_all(b"y\n")?; // or the appropriate response format
    } else {
        stdin.write_all(b"n\n")?;
    }
    stdin.flush()?;
}
```

## Spawning Claude CLI

```rust
use std::process::{Command, Stdio};

fn spawn_claude(working_dir: &str, args: &[String]) -> Result<Child> {
    let claude_path = which::which("claude")
        .map_err(|_| "Claude CLI not found in PATH")?;

    Command::new(claude_path)
        .args(args)
        .arg("--output-format")
        .arg("stream-json")
        .current_dir(working_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn Claude: {}", e))
}
```

## Markdown Detection in Claude Output

Claude's text output often contains Markdown. Detect blocks that benefit from rendering:

```typescript
// Heuristic: if text contains MD markers, render as Markdown
function shouldRenderAsMarkdown(text: string): boolean {
  return /^#{1,6}\s|```|\*\*|^\s*[-*]\s|\|.*\|/.test(text);
}
```

## Error Handling

- If Claude CLI exits unexpectedly, emit `claude:error:{tabId}` with exit code
- If stream-json line fails to parse, log and skip (do not crash)
- If permission response times out (5 min), auto-deny and emit warning
- If Claude CLI is not installed, show helpful error with install instructions
