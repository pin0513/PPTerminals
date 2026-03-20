import { useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { registerFileLinkProvider, FileLinkProvider } from '../addons/file-link-provider';
import { parseClaudeOutput, onShellPromptDetected, setParserCallback } from '../addons/claude-output-parser';
import { useFileViewerStore } from '../stores/file-viewer-store';
import { useTabStore } from '../stores/tab-store';

interface PtyOutput {
  tab_id: string;
  data: string;
}

export interface PtyHooks {
  onBeforeInput?: (data: string) => boolean;
  onAfterInput?: (data: string) => void;
  onPromptDetected?: () => void;
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

    // ─── Terminal setup (canvas renderer, no WebGL) ───
    const terminal = new Terminal({
      fontFamily: "'JetBrains Mono', 'Menlo', 'Cascadia Code', monospace",
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
      drawBoldTextInBrightColors: true,
    });

    // Addons
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(new Unicode11Addon());
    terminal.unicode.activeVersion = '11';
    terminal.loadAddon(new WebLinksAddon((_event, uri) => {
      invoke('plugin:opener|open_url', { url: uri }).catch(console.error);
    }));

    // File link provider
    const { provider: fileProvider, dispose: disposeFileLinks } = registerFileLinkProvider(
      terminal, initialCwd,
      (path) => useFileViewerStore.getState().openFile(path),
      (dir) => import('../stores/explorer-store').then(({ useExplorerStore }) => useExplorerStore.getState().setRootPath(dir))
    );
    fileLinkRef.current = fileProvider;

    // ─── Key handling ───
    const isMac = navigator.platform.toUpperCase().includes('MAC');
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true;
      const mod = isMac ? event.metaKey : event.ctrlKey;

      // Shift+Enter → newline
      if (event.key === 'Enter' && event.shiftKey) {
        event.preventDefault();
        invoke('pty_write', { tabId, data: '\n' }).catch(console.error);
        return false;
      }

      // Readline shortcuts only at shell prompt
      const buf = terminal.buffer.active;
      if (buf.type !== 'normal') return true;
      if (buf.cursorY < terminal.rows - 3) return true;

      if (event.key === 'Home' || (mod && event.key === 'ArrowLeft' && !event.shiftKey)) {
        event.preventDefault(); invoke('pty_write', { tabId, data: '\x01' }).catch(console.error); return false;
      }
      if (event.key === 'End' || (mod && event.key === 'ArrowRight' && !event.shiftKey)) {
        event.preventDefault(); invoke('pty_write', { tabId, data: '\x05' }).catch(console.error); return false;
      }
      if (mod && event.key === 'Backspace') {
        event.preventDefault(); invoke('pty_write', { tabId, data: '\x15' }).catch(console.error); return false;
      }
      if (event.altKey && event.key === 'ArrowLeft') {
        event.preventDefault(); invoke('pty_write', { tabId, data: '\x1bb' }).catch(console.error); return false;
      }
      if (event.altKey && event.key === 'ArrowRight') {
        event.preventDefault(); invoke('pty_write', { tabId, data: '\x1bf' }).catch(console.error); return false;
      }
      if (event.altKey && event.key === 'Backspace') {
        event.preventDefault(); invoke('pty_write', { tabId, data: '\x17' }).catch(console.error); return false;
      }
      return true;
    });

    // ─── Open terminal ───
    terminal.open(containerRef.current);
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // Initial fit (multi-stage for font loading)
    requestAnimationFrame(() => {
      fitAddon.fit();
      invoke('pty_resize', { tabId, cols: terminal.cols, rows: terminal.rows }).catch(() => {});
    });
    setTimeout(() => debouncedFit(), 300);
    setTimeout(() => debouncedFit(), 1000);

    // ─── PTY I/O ───
    const onDataDisposable = terminal.onData((data) => {
      const h = hooksRef.current;
      if (h?.onBeforeInput && !h.onBeforeInput(data)) return;
      invoke('pty_write', { tabId, data }).catch(console.error);
      h?.onAfterInput?.(data);
    });

    let unlistenOutput: UnlistenFn | null = null;
    let unlistenExited: UnlistenFn | null = null;
    let promptTimer: ReturnType<typeof setTimeout> | null = null;
    let parseBuffer = '';
    let parseTimer: ReturnType<typeof setTimeout> | null = null;
    let lastChunk = '';

    const setupListeners = async () => {
      unlistenOutput = await listen<PtyOutput>(`pty:output:${tabId}`, (event) => {
        terminal.write(event.payload.data);
        lastChunk = event.payload.data;

        // Debounced parser (300ms batch)
        parseBuffer += event.payload.data;
        if (parseTimer) clearTimeout(parseTimer);
        parseTimer = setTimeout(() => {
          parseClaudeOutput(tabId, parseBuffer);
          parseBuffer = '';
        }, 300);

        // Prompt detection (100ms idle)
        if (promptTimer) clearTimeout(promptTimer);
        promptTimer = setTimeout(() => {
          const clean = lastChunk.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
          const lastLine = clean.split('\n').pop()?.trim() || '';
          if (lastLine.length > 0 && lastLine.length < 200 &&
              /[$%❯➜#]\s*$/.test(lastLine)) {
            hooksRef.current?.onPromptDetected?.();
            onShellPromptDetected(tabId);
          }
        }, 100);
      });

      unlistenExited = await listen(`pty:exited:${tabId}`, () => {
        terminal.write('\r\n\x1b[90m[Process exited]\x1b[0m\r\n');
        if (useTabStore.getState().activeTabId !== tabId) {
          useTabStore.getState().markCompleted(tabId);
        }
      });
    };
    setupListeners();

    // ─── Resize observer ───
    const parentEl = containerRef.current.closest('.terminal-view') || containerRef.current;
    const resizeObserver = new ResizeObserver(() => debouncedFit());
    resizeObserver.observe(parentEl);

    // Parser state change → fit
    setParserCallback((id) => {
      if (id === tabId) setTimeout(() => debouncedFit(), 500);
    });

    // ─── Cleanup ───
    return () => {
      if (fitTimeoutRef.current) clearTimeout(fitTimeoutRef.current);
      if (promptTimer) clearTimeout(promptTimer);
      if (parseTimer) clearTimeout(parseTimer);
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
