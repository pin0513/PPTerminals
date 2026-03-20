import { useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebglAddon } from '@xterm/addon-webgl';
import { registerFileLinkProvider, FileLinkProvider } from '../addons/file-link-provider';
import { parseClaudeOutput, onShellPromptDetected, setParserCallback } from '../addons/claude-output-parser';
import { useFileViewerStore } from '../stores/file-viewer-store';
import { useTabStore } from '../stores/tab-store';
import { useDashboardStore } from '../stores/dashboard-store';

interface PtyOutput {
  tab_id: string;
  data: string;
}

export interface PtyHooks {
  onBeforeInput?: (data: string) => boolean;
  onAfterInput?: (data: string) => void;
  /** Called when PTY output contains a shell prompt (buffer should reset) */
  onPromptDetected?: () => void;
}

// Detect common shell prompt endings
const PROMPT_PATTERNS = [
  /\$\s*$/,        // bash: user@host:~$
  /%\s*$/,         // zsh: user@host ~ %
  />\s*$/,         // fish/powershell: >
  /[#]\s*$/,       // root: #
  /❯\s*$/,         // starship/custom
  /➜\s*$/,         // oh-my-zsh
];

function looksLikePrompt(text: string): boolean {
  // Check last line of output (strip ANSI codes)
  const clean = text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
  const lastLine = clean.split('\n').pop()?.trim() || '';
  if (lastLine.length < 1 || lastLine.length > 200) return false;
  return PROMPT_PATTERNS.some((p) => p.test(lastLine));
}

export function usePty(
  tabId: string,
  containerRef: React.RefObject<HTMLDivElement | null>,
  hooks?: PtyHooks
) {
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const fitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileLinkRef = useRef<FileLinkProvider | null>(null);
  const hooksRef = useRef(hooks);
  hooksRef.current = hooks;

  const debouncedFit = useCallback(() => {
    if (fitTimeoutRef.current) clearTimeout(fitTimeoutRef.current);
    fitTimeoutRef.current = setTimeout(() => {
      if (fitAddonRef.current && terminalRef.current) {
        try {
          fitAddonRef.current.fit();
          const { cols, rows } = terminalRef.current;
          invoke('pty_resize', { tabId, cols, rows }).catch(() => {});
        } catch { /* not ready */ }
      }
    }, 50);
  }, [tabId]);

  useEffect(() => {
    if (!containerRef.current || !tabId) return;

    const tab = useTabStore.getState().tabs.find((t) => t.id === tabId);
    const initialCwd = tab?.cwd || '/';

    const terminal = new Terminal({
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Menlo', monospace",
      fontSize: 14,
      lineHeight: 1.35,
      theme: {
        background: '#0a0e14',
        foreground: '#e6e6e6',
        cursor: '#58a6ff',
        selectionBackground: '#264f78',
        black: '#0a0e14',
        red: '#f85149',
        green: '#3fb950',
        yellow: '#d29922',
        blue: '#58a6ff',
        magenta: '#bc8cff',
        cyan: '#39c5cf',
        white: '#e6e6e6',
        // Bright variants (used by Claude Code for dim lines, bold text, etc.)
        brightBlack: '#484f58',
        brightRed: '#ff7b72',
        brightGreen: '#56d364',
        brightYellow: '#e3b341',
        brightBlue: '#79c0ff',
        brightMagenta: '#d2a8ff',
        brightCyan: '#56d4dd',
        brightWhite: '#ffffff',
      },
      cursorBlink: true,
      cursorStyle: 'bar',
      scrollback: 10000,
      allowProposedApi: true,
      // Unicode/TUI support
      drawBoldTextInBrightColors: true,
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);

    // Unicode 11 — proper width for CJK, emoji, box-drawing characters
    const unicode11 = new Unicode11Addon();
    terminal.loadAddon(unicode11);
    terminal.unicode.activeVersion = '11';

    terminal.loadAddon(
      new WebLinksAddon((_event, uri) => {
        invoke('plugin:opener|open_url', { url: uri }).catch(console.error);
      })
    );

    const { provider: fileProvider, dispose: disposeFileLinks } = registerFileLinkProvider(
      terminal,
      initialCwd,
      (resolvedPath) => {
        useFileViewerStore.getState().openFile(resolvedPath);
      },
      (dirPath) => {
        // Navigate explorer to clicked directory
        import('../stores/explorer-store').then(({ useExplorerStore }) => {
          useExplorerStore.getState().setRootPath(dirPath);
        });
      }
    );
    fileLinkRef.current = fileProvider;

    // Custom key handling for terminal
    const isMac = navigator.platform.toUpperCase().includes('MAC');
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true;

      const mod = isMac ? event.metaKey : event.ctrlKey;

      // Shift+Enter → newline (works in both shell and TUI like Claude CLI)
      if (event.key === 'Enter' && event.shiftKey) {
        event.preventDefault();
        invoke('pty_write', { tabId, data: '\n' }).catch(console.error);
        return false;
      }

      // ─── Readline shortcuts ───
      // Only in normal buffer AND only when cursor is near bottom (shell prompt).
      // TUI apps (vim, claude code inline) use the full screen area.
      const buf = terminal.buffer.active;
      const isNormalBuffer = buf.type === 'normal';
      // Heuristic: if cursor is on the last 2 rows of viewport, likely at shell prompt
      const isAtPrompt = isNormalBuffer && (buf.cursorY >= terminal.rows - 3);

      if (!isNormalBuffer) return true; // Alternate buffer → pass through

      // These readline shortcuts only apply at shell prompt
      if (isAtPrompt) {
        if (event.key === 'Home' || (mod && event.key === 'ArrowLeft' && !event.shiftKey)) {
          event.preventDefault();
          invoke('pty_write', { tabId, data: '\x01' }).catch(console.error);
          return false;
        }
        if (event.key === 'End' || (mod && event.key === 'ArrowRight' && !event.shiftKey)) {
          event.preventDefault();
          invoke('pty_write', { tabId, data: '\x05' }).catch(console.error);
          return false;
        }
        if (mod && event.key === 'Backspace') {
          event.preventDefault();
          invoke('pty_write', { tabId, data: '\x15' }).catch(console.error);
          return false;
        }
        if (event.altKey && event.key === 'ArrowLeft') {
          event.preventDefault();
          invoke('pty_write', { tabId, data: '\x1bb' }).catch(console.error);
          return false;
        }
        if (event.altKey && event.key === 'ArrowRight') {
          event.preventDefault();
          invoke('pty_write', { tabId, data: '\x1bf' }).catch(console.error);
          return false;
        }
        if (event.altKey && event.key === 'Backspace') {
          event.preventDefault();
          invoke('pty_write', { tabId, data: '\x17' }).catch(console.error);
          return false;
        }
      }

      return true;
    });

    terminal.open(containerRef.current);
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // WebGL renderer — GPU-accelerated, pixel-perfect text rendering
    // Falls back to canvas if WebGL not available
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => {
        webgl.dispose();
      });
      terminal.loadAddon(webgl);
    } catch {
      // WebGL not supported, canvas renderer is fine
    }

    // Multi-stage fit: ensure PTY gets correct size after layout settles
    // Stage 1: immediate after open
    requestAnimationFrame(() => {
      fitAddon.fit();
      const { cols, rows } = terminal;
      invoke('pty_resize', { tabId, cols, rows }).catch(() => {});
    });
    // Stage 2: after 200ms (layout fully settled, fonts loaded)
    setTimeout(() => debouncedFit(), 200);
    // Stage 3: after 500ms (WebGL renderer initialized)
    setTimeout(() => debouncedFit(), 500);
    // Stage 4: after 1s (final safety net)
    setTimeout(() => debouncedFit(), 1000);

    const onDataDisposable = terminal.onData((data) => {
      const h = hooksRef.current;
      if (h?.onBeforeInput) {
        const proceed = h.onBeforeInput(data);
        if (!proceed) return;
      }
      invoke('pty_write', { tabId, data }).catch(console.error);
      if (h?.onAfterInput) {
        h.onAfterInput(data);
      }
    });

    let unlistenOutput: UnlistenFn | null = null;
    let unlistenExited: UnlistenFn | null = null;

    // Debounce prompt detection to avoid false positives during fast output
    let promptTimer: ReturnType<typeof setTimeout> | null = null;
    let lastOutputChunk = '';
    let parseBuffer = '';
    let parseTimer: ReturnType<typeof setTimeout> | null = null;
    let idleResizeTimer: ReturnType<typeof setTimeout> | null = null;

    // SIGWINCH after streaming: only trigger when output just stopped
    // After output pauses, call pty_refresh which does a bounce (cols+1→cols)
    // entirely in Rust — no visual change on xterm, but SIGWINCH forces redraw.
    const scheduleIdleResize = () => {
      if (idleResizeTimer) clearTimeout(idleResizeTimer);
      idleResizeTimer = setTimeout(() => {
        const hasSession = useDashboardStore.getState().claudeSessions.has(tabId);
        if (hasSession && terminalRef.current) {
          const { cols, rows } = terminalRef.current;
          invoke('pty_refresh', { tabId, cols, rows }).catch(() => {});
        }
      }, 500);
    };

    const setupListeners = async () => {
      unlistenOutput = await listen<PtyOutput>(`pty:output:${tabId}`, (event) => {
        terminal.write(event.payload.data);
        lastOutputChunk = event.payload.data;

        // Smart idle resize for Claude Code streaming
        scheduleIdleResize();

        // Parse Claude Code output — debounced to handle streaming
        parseBuffer += event.payload.data;
        if (parseTimer) clearTimeout(parseTimer);
        parseTimer = setTimeout(() => {
          const prevSz = useDashboardStore.getState().claudeSessions.size;
          parseClaudeOutput(tabId, parseBuffer);
          const newSz = useDashboardStore.getState().claudeSessions.size;
          parseBuffer = '';

          // New session detected → SIGWINCH after welcome screen
          if (newSz > prevSz) {
            setTimeout(() => {
              if (terminalRef.current) {
                const { cols, rows } = terminalRef.current;
                invoke('pty_refresh', { tabId, cols, rows }).catch(() => {});
              }
            }, 1500);
          }
        }, 300);

        // Debounced prompt detection: if output stops for 100ms and last chunk looks like a prompt
        if (promptTimer) clearTimeout(promptTimer);
        promptTimer = setTimeout(() => {
          if (looksLikePrompt(lastOutputChunk)) {
            hooksRef.current?.onPromptDetected?.();
            onShellPromptDetected(tabId);
          }
        }, 100);
      });

      unlistenExited = await listen(`pty:exited:${tabId}`, () => {
        terminal.write('\r\n\x1b[90m[Process exited]\x1b[0m\r\n');
        const store = useTabStore.getState();
        if (store.activeTabId !== tabId) {
          store.markCompleted(tabId);
        }
      });
    };

    setupListeners();

    const parentEl = containerRef.current.closest('.terminal-view') || containerRef.current;
    const resizeObserver = new ResizeObserver(() => debouncedFit());
    resizeObserver.observe(parentEl);

    // When Claude state changes (sub-agents start/end), trigger resize only once
    setParserCallback((changedTabId) => {
      if (changedTabId === tabId) {
        setTimeout(() => debouncedFit(), 500);
      }
    });

    // Periodic size check (window resize etc) — only when size actually changes
    let lastCols = 0, lastRows = 0;
    const periodicSync = setInterval(() => {
      if (fitAddonRef.current && terminalRef.current) {
        fitAddonRef.current.fit();
        const { cols, rows } = terminalRef.current;
        if (cols !== lastCols || rows !== lastRows) {
          lastCols = cols; lastRows = rows;
          invoke('pty_resize', { tabId, cols, rows }).catch(() => {});
        }
      }
    }, 5000);

    return () => {
      if (fitTimeoutRef.current) clearTimeout(fitTimeoutRef.current);
      if (promptTimer) clearTimeout(promptTimer);
      if (parseTimer) clearTimeout(parseTimer);
      if (idleResizeTimer) clearTimeout(idleResizeTimer);
      clearInterval(periodicSync);
      onDataDisposable.dispose();
      disposeFileLinks();
      unlistenOutput?.();
      unlistenExited?.();
      resizeObserver.disconnect();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      fileLinkRef.current = null;
    };
  }, [tabId, containerRef, debouncedFit]);

  return { terminalRef, fitAddonRef, fileLinkRef };
}
