---
name: Terminal Emulation
description: xterm.js 整合指南，包含 PTY 連接、addons、resize 處理、效能優化
---

# Terminal Emulation Guide

## xterm.js Setup

### Installation

```bash
pnpm add @xterm/xterm @xterm/addon-fit @xterm/addon-web-links @xterm/addon-search
```

### Basic Integration

```typescript
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

function createTerminal(container: HTMLElement): Terminal {
  const terminal = new Terminal({
    fontFamily: 'JetBrains Mono, Fira Code, Cascadia Code, monospace',
    fontSize: 13,
    theme: {
      background: '#0a0e14',
      foreground: '#e6e6e6',
      cursor: '#58a6ff',
      selectionBackground: '#264f78',
    },
    cursorBlink: true,
    cursorStyle: 'bar',
    scrollback: 10000,
    allowProposedApi: true,
  });

  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.loadAddon(new WebLinksAddon());

  terminal.open(container);
  fitAddon.fit();

  return terminal;
}
```

### Resize Handling

```typescript
// Use ResizeObserver for responsive resize
const resizeObserver = new ResizeObserver(() => {
  fitAddon.fit();
  // Notify backend of new dimensions
  const { cols, rows } = terminal;
  invoke('pty_resize', { tabId, cols, rows });
});

resizeObserver.observe(containerRef.current);

// Cleanup
return () => resizeObserver.disconnect();
```

### PTY Connection Pattern

```typescript
// Write user input to PTY
terminal.onData((data) => {
  invoke('pty_write', { tabId, data });
});

// Receive PTY output
const unlisten = await listen<string>(`pty:output:${tabId}`, (event) => {
  terminal.write(event.payload);
});
```

## Performance Tips

- Use `terminal.write()` batching for large outputs
- Set `scrollback: 10000` (not unlimited) to control memory
- Use `requestAnimationFrame` for resize debouncing
- Dispose terminal properly on tab close: `terminal.dispose()`

## Custom Link Handler

```typescript
// Detect file paths and open externally
terminal.registerLinkProvider({
  provideLinks(bufferLineNumber, callback) {
    const line = terminal.buffer.active.getLine(bufferLineNumber);
    if (!line) return callback(undefined);

    const text = line.translateToString();
    const links = detectClickableElements(text);
    callback(links);
  }
});

function detectClickableElements(text: string): ILink[] {
  // Match URLs, file paths, etc.
  // Return array of { range, text, activate() } objects
}
```
