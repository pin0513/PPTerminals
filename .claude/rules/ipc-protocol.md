---
name: IPC Protocol Standard
description: Tauri IPC 通訊規範，確保 Rust backend 與 React frontend 之間的型別安全與一致性
---

# IPC Protocol Standard

## Command Naming

Format: `{domain}_{action}` (snake_case, matching Rust function names)

| Domain | Commands |
|--------|----------|
| `pty` | `pty_create`, `pty_write`, `pty_resize`, `pty_close`, `pty_is_active` |
| `claude` | `claude_start`, `claude_respond_permission` |
| `permission` | `permission_get_rules`, `permission_set_rule` |
| `system` | `open_external` |

## Event Naming

Format: `{domain}:{event}:{identifier}` (colon-separated)

| Event | Payload | Direction |
|-------|---------|-----------|
| `pty:output:{tabId}` | `string` (raw terminal data) | Rust → React |
| `claude:text:{tabId}` | `{ content: string }` | Rust → React |
| `claude:tool-use:{tabId}` | `{ tool: string, input: object }` | Rust → React |
| `claude:tool-result:{tabId}` | `{ tool: string, output: string, isError: boolean }` | Rust → React |
| `claude:permission-request:{tabId}` | `{ id: string, tool: string, input: object }` | Rust → React |
| `claude:error:{tabId}` | `{ message: string, code?: number }` | Rust → React |

## Type Safety

Every Rust struct used in IPC must have a corresponding TypeScript interface:

```rust
// Rust
#[derive(Serialize, Deserialize)]
pub struct PermissionRule {
    pub tool: String,
    pub action: PermissionAction, // Allow, Deny, Ask
}
```

```typescript
// TypeScript
interface PermissionRule {
  tool: string;
  action: 'allow' | 'deny' | 'ask';
}
```

## Error Handling

All commands return `Result<T, String>`. Frontend must handle both success and error cases:

```typescript
try {
  const result = await invoke<string>('pty_create');
} catch (error) {
  // error is the String from Rust's Err variant
  console.error('Failed to create PTY:', error);
}
```

## Violation Criteria

- Rust IPC struct without matching TypeScript interface
- Event name not following `{domain}:{event}:{id}` format
- Command that returns raw `unwrap()` instead of `Result`
- Frontend invoke call without error handling
