import { useEffect, useRef, useCallback, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { useAutocomplete } from '../hooks/use-autocomplete';
import { Autocomplete } from './Autocomplete';
import { parseClaudeOutput, onShellPromptDetected } from '../addons/claude-output-parser';
import { useTabStore } from '../stores/tab-store';
import './NativeTerminal.css';

interface TermCell {
  ch: string;
  fg: string;
  bg: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  dim: boolean;
  wide: boolean;
  skip: boolean;
}

interface ScreenState {
  rows: TermCell[][];
  cursor_row: number;
  cursor_col: number;
  cursor_visible: boolean;
  cols: number;
  row_count: number;
}

interface ScreenDiff {
  changed_rows: [number, TermCell[]][];
  cursor_row: number;
  cursor_col: number;
  cursor_visible: boolean;
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
  const parseBuffer = useRef('');
  const parseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Autocomplete
  const ac = useAutocomplete(tabId);
  const acRef = useRef(ac);
  acRef.current = ac;

  const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC');

  // Calculate terminal size
  const getTermSize = useCallback(() => {
    if (!containerRef.current) return { cols: 80, rows: 24 };
    const el = containerRef.current;
    const charW = 8.4;
    const charH = 19;
    return {
      cols: Math.max(10, Math.floor(el.clientWidth / charW)),
      rows: Math.max(5, Math.floor(el.clientHeight / charH)),
    };
  }, []);

  // Create native term
  useEffect(() => {
    if (!tabId) return;
    const { cols, rows } = getTermSize();
    invoke('native_term_create', { tabId, cols, rows }).catch(console.error);
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


  // PTY output → refresh screen
  useEffect(() => {
    let unlistenOutput: UnlistenFn | null = null;
    let unlistenExited: UnlistenFn | null = null;

    const setup = async () => {
      unlistenOutput = await listen(`pty:output:${tabId}`, (event: any) => {
        const data = event.payload.data as string;

        // Debounced parser
        parseBuffer.current += data;
        if (parseTimer.current) clearTimeout(parseTimer.current);
        parseTimer.current = setTimeout(() => {
          parseClaudeOutput(tabId, parseBuffer.current);
          parseBuffer.current = '';

          // Prompt detection
          const clean = data.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
          const lastLine = clean.split('\n').pop()?.trim() || '';
          if (lastLine.length > 0 && /[$%❯➜#]\s*$/.test(lastLine)) {
            onShellPromptDetected(tabId);
            acRef.current.resetBuffer();
          }
        }, 300);

        // Debounce screen refresh — use diff for partial update (30ms)
        if (refreshTimer.current) return;
        refreshTimer.current = setTimeout(async () => {
          refreshTimer.current = null;
          try {
            const diff = await invoke<ScreenDiff>('native_term_diff', { tabId });
            if (diff.changed_rows.length > 0) {
              setScreen((prev) => {
                if (!prev) {
                  // First time — do full fetch
                  invoke<ScreenState>('native_term_screen', { tabId }).then(setScreen).catch(() => {});
                  return prev;
                }
                // Apply diff: only update changed rows
                const newRows = [...prev.rows];
                for (const [rowIdx, cells] of diff.changed_rows) {
                  newRows[rowIdx] = cells;
                }
                return {
                  ...prev,
                  rows: newRows,
                  cursor_row: diff.cursor_row,
                  cursor_col: diff.cursor_col,
                  cursor_visible: diff.cursor_visible,
                };
              });
            } else {
              // Only cursor moved
              setScreen((prev) => prev ? {
                ...prev,
                cursor_row: diff.cursor_row,
                cursor_col: diff.cursor_col,
                cursor_visible: diff.cursor_visible,
              } : prev);
            }
          } catch { /* ignore */ }
        }, 30);
      });

      unlistenExited = await listen(`pty:exited:${tabId}`, () => {
        invoke<ScreenState>('native_term_screen', { tabId }).then(setScreen).catch(() => {});
        if (useTabStore.getState().activeTabId !== tabId) {
          useTabStore.getState().markCompleted(tabId);
        }
      });
    };
    setup();

    return () => {
      unlistenOutput?.();
      unlistenExited?.();
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      if (parseTimer.current) clearTimeout(parseTimer.current);
    };
  }, [tabId]);

  // Keyboard input
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    let data = '';

    // ─── Autocomplete interception ───
    if (acRef.current.state.visible) {
      if (e.key === 'Tab') {
        e.preventDefault();
        const insertion = acRef.current.acceptSuggestion();
        if (insertion) invoke('pty_write', { tabId, data: insertion }).catch(console.error);
        return;
      }
      if (e.key === 'ArrowUp') { e.preventDefault(); acRef.current.moveSelection(-1); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); acRef.current.moveSelection(1); return; }
      if (e.key === 'Escape') { e.preventDefault(); acRef.current.dismiss(); return; }
    }

    // ─── macOS: Cmd+C = copy, Cmd+A = select all (let browser handle) ───
    if (isMac && e.metaKey && ['c', 'a', 'x'].includes(e.key)) {
      return;
    }
    // ─── Cmd+V = paste from clipboard into PTY ───
    if (isMac && e.metaKey && e.key === 'v') {
      e.preventDefault();
      navigator.clipboard.readText().then((text) => {
        if (text) invoke('pty_write', { tabId, data: text }).catch(console.error);
      }).catch(console.error);
      return;
    }

    // ─── Cmd+key shortcuts handled by App.tsx (Cmd+T, Cmd+W, etc.) ───
    if (isMac && e.metaKey && ['t', 'w', 'b', 'r', '\\', '=', '+', 'Tab'].includes(e.key)) {
      return; // let it bubble to App.tsx
    }
    if (isMac && e.metaKey && e.shiftKey) {
      return; // Cmd+Shift+letter → tab switch, let bubble
    }

    e.preventDefault();

    // ─── Special keys ───
    if (e.key === 'Enter') data = e.shiftKey ? '\n' : '\r';
    else if (e.key === 'Backspace') {
      if (isMac ? e.metaKey : e.ctrlKey) data = '\x15'; // Cmd/Ctrl+Backspace → clear line
      else if (e.altKey) data = '\x17'; // Alt+Backspace → delete word
      else data = '\x7f';
    }
    else if (e.key === 'Tab') data = '\t';
    else if (e.key === 'Escape') data = '\x1b';
    else if (e.key === 'ArrowUp') data = '\x1b[A';
    else if (e.key === 'ArrowDown') data = '\x1b[B';
    else if (e.key === 'ArrowRight') {
      if (isMac ? e.metaKey : e.ctrlKey) data = '\x05';
      else if (e.altKey) data = '\x1bf';
      else data = '\x1b[C';
    }
    else if (e.key === 'ArrowLeft') {
      if (isMac ? e.metaKey : e.ctrlKey) data = '\x01';
      else if (e.altKey) data = '\x1bb';
      else data = '\x1b[D';
    }
    else if (e.key === 'Home') data = '\x01';
    else if (e.key === 'End') data = '\x05';
    else if (e.key === 'Delete') data = '\x1b[3~';
    else if (e.key === 'PageUp') data = '\x1b[5~';
    else if (e.key === 'PageDown') data = '\x1b[6~';
    // Ctrl+letter → terminal control codes (Ctrl+C = \x03, Ctrl+D = \x04, etc.)
    else if (e.ctrlKey && !e.metaKey && e.code && e.code.startsWith('Key')) {
      const letter = e.code.charAt(3).toLowerCase();
      data = String.fromCharCode(letter.charCodeAt(0) - 96);
    }
    // Regular printable
    else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
      data = e.key;
    }

    if (data) {
      invoke('pty_write', { tabId, data }).catch(console.error);
      acRef.current.handleInput(data);
    } else {
      // Debug: log unhandled keys
      console.log(`[KEY] Unhandled: key=${e.key} code=${e.code} ctrl=${e.ctrlKey} meta=${e.metaKey} alt=${e.altKey} shift=${e.shiftKey}`);
    }
  }, [tabId, isMac]);

  // Focus
  useEffect(() => {
    if (isVisible && inputRef.current) inputRef.current.focus();
  }, [isVisible]);

  // Drag & drop — insert full path into terminal
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setIsDragOver(false);
    const rawPath = e.dataTransfer.getData('application/x-ppterminals-path') || e.dataTransfer.getData('text/plain');
    if (rawPath) {
      const escaped = rawPath.includes(' ') ? `"${rawPath}"` : rawPath;
      // Write path with trailing space for convenience
      invoke('pty_write', { tabId, data: escaped + ' ' }).catch(console.error);
    }
  }, [tabId]);

  return (
    <div
      className={`native-terminal ${isDragOver ? 'drag-over' : ''}`}
      style={{ display: isVisible ? 'flex' : 'none' }}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setIsDragOver(true); }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.focus()}
    >
      <textarea
        ref={inputRef}
        className="native-term-input"
        onKeyDown={handleKeyDown}
        autoFocus
      />

      <div ref={containerRef} className="native-term-grid">
        {screen && screen.rows.map((row, r) => (
          <div key={r} className="native-term-row">
            {row.map((cell, c) => {
              if (cell.skip) return null; // wide char continuation — skip
              return (
                <span
                  key={c}
                  className={`tc${cell.bold ? ' b' : ''}${cell.italic ? ' i' : ''}${cell.underline ? ' u' : ''}${cell.dim ? ' d' : ''}${cell.wide ? ' w' : ''}${
                    screen.cursor_visible && r === screen.cursor_row && c === screen.cursor_col ? ' cursor' : ''
                  }`}
                  style={{
                    color: cell.fg,
                    backgroundColor: cell.bg !== 'transparent' ? cell.bg : undefined,
                  }}
                >
                  {cell.ch}
                </span>
              );
            })}
          </div>
        ))}
      </div>

      {/* Autocomplete overlay */}
      {ac.state.visible && screen && (
        <div
          className="native-term-ac"
          style={{
            left: `${2 + screen.cursor_col * 8.4}px`,
            top: `${(screen.cursor_row + 1) * 19}px`,
          }}
        >
          <Autocomplete
            suggestions={ac.state.suggestions}
            selectedIndex={ac.state.selectedIndex}
            visible={ac.state.visible}
            cursorX={screen.cursor_col}
            cursorY={screen.cursor_row}
            terminalElement={containerRef.current}
          />
        </div>
      )}
    </div>
  );
}
