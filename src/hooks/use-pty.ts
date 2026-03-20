import { useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { registerFileLinkProvider, FileLinkProvider } from '../addons/file-link-provider';
import { useFileViewerStore } from '../stores/file-viewer-store';
import { useTabStore } from '../stores/tab-store';

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
    }, 30);
  }, [tabId]);

  useEffect(() => {
    if (!containerRef.current || !tabId) return;

    const tab = useTabStore.getState().tabs.find((t) => t.id === tabId);
    const initialCwd = tab?.cwd || '/';

    const terminal = new Terminal({
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Menlo', monospace",
      fontSize: 13,
      lineHeight: 1.2,
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
      },
      cursorBlink: true,
      cursorStyle: 'bar',
      scrollback: 10000,
      allowProposedApi: true,
      // Unicode/TUI support
      drawBoldTextInBrightColors: true,
      minimumContrastRatio: 1,
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
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

    // Shift+Enter → send newline (\n) instead of carriage return (\r)
    // This enables multi-line input in Claude CLI and similar tools
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type === 'keydown' && event.key === 'Enter' && event.shiftKey) {
        event.preventDefault();
        invoke('pty_write', { tabId, data: '\n' }).catch(console.error);
        return false;
      }
      return true;
    });

    terminal.open(containerRef.current);
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    requestAnimationFrame(() => {
      fitAddon.fit();
      const { cols, rows } = terminal;
      invoke('pty_resize', { tabId, cols, rows }).catch(() => {});
    });

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

    const setupListeners = async () => {
      unlistenOutput = await listen<PtyOutput>(`pty:output:${tabId}`, (event) => {
        terminal.write(event.payload.data);
        lastOutputChunk = event.payload.data;

        // Debounced prompt detection: if output stops for 100ms and last chunk looks like a prompt
        if (promptTimer) clearTimeout(promptTimer);
        promptTimer = setTimeout(() => {
          if (looksLikePrompt(lastOutputChunk)) {
            hooksRef.current?.onPromptDetected?.();
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

    return () => {
      if (fitTimeoutRef.current) clearTimeout(fitTimeoutRef.current);
      if (promptTimer) clearTimeout(promptTimer);
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
