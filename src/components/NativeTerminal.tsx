import { useEffect, useRef, useCallback, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import './NativeTerminal.css';

interface TermCell {
  ch: string;
  fg: string;
  bg: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  dim: boolean;
}

interface ScreenState {
  rows: TermCell[][];
  cursor_row: number;
  cursor_col: number;
  cursor_visible: boolean;
  cols: number;
  row_count: number;
}

interface Props {
  tabId: string;
  isVisible: boolean;
}

export function NativeTerminal({ tabId, isVisible }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [screen, setScreen] = useState<ScreenState | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Calculate terminal size from container
  const getTermSize = useCallback(() => {
    if (!containerRef.current) return { cols: 80, rows: 24 };
    const el = containerRef.current;
    const charW = 8.4; // approx for 14px monospace
    const charH = 19;  // 14px * 1.35 line-height
    const cols = Math.floor(el.clientWidth / charW);
    const rows = Math.floor(el.clientHeight / charH);
    return { cols: Math.max(10, cols), rows: Math.max(5, rows) };
  }, []);

  // Create native term and sync size
  useEffect(() => {
    if (!tabId) return;
    const { cols, rows } = getTermSize();
    invoke('native_term_create', { tabId, cols, rows }).catch(console.error);
    invoke('native_term_resize', { tabId, cols, rows }).catch(console.error);
    // Also tell PTY the size
    invoke('pty_resize', { tabId, cols, rows }).catch(console.error);
  }, [tabId, getTermSize]);

  // Resize observer
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(() => {
      const { cols, rows } = getTermSize();
      invoke('native_term_resize', { tabId, cols, rows }).catch(() => {});
      invoke('pty_resize', { tabId, cols, rows }).catch(() => {});
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [tabId, getTermSize]);

  // Listen for PTY output → refresh screen from native_term
  useEffect(() => {
    let unlistenOutput: UnlistenFn | null = null;
    let unlistenExited: UnlistenFn | null = null;

    const setup = async () => {
      unlistenOutput = await listen(`pty:output:${tabId}`, () => {
        // Debounce screen refresh (every 50ms max)
        if (refreshTimer.current) return;
        refreshTimer.current = setTimeout(async () => {
          refreshTimer.current = null;
          try {
            const state = await invoke<ScreenState>('native_term_screen', { tabId });
            setScreen(state);
          } catch { /* ignore */ }
        }, 50);
      });

      unlistenExited = await listen(`pty:exited:${tabId}`, () => {
        // Final screen refresh
        invoke<ScreenState>('native_term_screen', { tabId }).then(setScreen).catch(() => {});
      });
    };
    setup();

    return () => {
      unlistenOutput?.();
      unlistenExited?.();
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, [tabId]);

  // Initial screen fetch
  useEffect(() => {
    if (isVisible) {
      setTimeout(async () => {
        try {
          const state = await invoke<ScreenState>('native_term_screen', { tabId });
          setScreen(state);
        } catch { /* ignore */ }
      }, 200);
    }
  }, [isVisible, tabId]);

  // Keyboard input → PTY
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    e.preventDefault();
    const isMac = navigator.platform.toUpperCase().includes('MAC');
    const mod = isMac ? e.metaKey : e.ctrlKey;

    let data = '';

    // Special keys
    if (e.key === 'Enter') data = e.shiftKey ? '\n' : '\r';
    else if (e.key === 'Backspace') data = '\x7f';
    else if (e.key === 'Tab') data = '\t';
    else if (e.key === 'Escape') data = '\x1b';
    else if (e.key === 'ArrowUp') data = '\x1b[A';
    else if (e.key === 'ArrowDown') data = '\x1b[B';
    else if (e.key === 'ArrowRight') data = '\x1b[C';
    else if (e.key === 'ArrowLeft') data = '\x1b[D';
    else if (e.key === 'Home') data = '\x1b[H';
    else if (e.key === 'End') data = '\x1b[F';
    else if (e.key === 'Delete') data = '\x1b[3~';
    else if (e.key === 'PageUp') data = '\x1b[5~';
    else if (e.key === 'PageDown') data = '\x1b[6~';
    // Ctrl+letter
    else if (mod && e.key.length === 1 && e.key >= 'a' && e.key <= 'z') {
      data = String.fromCharCode(e.key.charCodeAt(0) - 96);
    }
    // Regular printable
    else if (e.key.length === 1) {
      data = e.key;
    }

    if (data) {
      invoke('pty_write', { tabId, data }).catch(console.error);
    }
  }, [tabId]);

  // Focus management
  useEffect(() => {
    if (isVisible && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isVisible]);

  // Drag & drop
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setIsDragOver(true);
  }, []);
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setIsDragOver(false);
    const path = e.dataTransfer.getData('application/x-ppterminals-path') || e.dataTransfer.getData('text/plain');
    if (path) invoke('pty_write', { tabId, data: path.includes(' ') ? `"${path}"` : path }).catch(console.error);
  }, [tabId]);

  return (
    <div
      className={`native-terminal ${isDragOver ? 'drag-over' : ''}`}
      style={{ display: isVisible ? 'flex' : 'none' }}
      onDragOver={handleDragOver}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.focus()}
    >
      {/* Hidden textarea for capturing keyboard input */}
      <textarea
        ref={inputRef}
        className="native-term-input"
        onKeyDown={handleKeyDown}
        autoFocus
      />

      <div ref={containerRef} className="native-term-grid">
        {screen && screen.rows.map((row, r) => (
          <div key={r} className="native-term-row">
            {row.map((cell, c) => (
              <span
                key={c}
                className={`tc${cell.bold ? ' b' : ''}${cell.italic ? ' i' : ''}${cell.underline ? ' u' : ''}${cell.dim ? ' d' : ''}${
                  screen.cursor_visible && r === screen.cursor_row && c === screen.cursor_col ? ' cursor' : ''
                }`}
                style={{
                  color: cell.fg,
                  backgroundColor: cell.bg !== 'transparent' ? cell.bg : undefined,
                }}
              >
                {cell.ch}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
