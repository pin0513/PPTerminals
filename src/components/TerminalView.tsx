import { useRef, useEffect, useCallback, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { usePty } from '../hooks/use-pty';
import { useAutocomplete } from '../hooks/use-autocomplete';
import { Autocomplete } from './Autocomplete';
import '@xterm/xterm/css/xterm.css';
import './TerminalView.css';

interface Props {
  tabId: string;
  isVisible: boolean;
}

export function TerminalView({ tabId, isVisible }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const ac = useAutocomplete(tabId);
  const acRef = useRef(ac);
  acRef.current = ac;

  // Stable hooks — never re-created, reads latest from acRef
  const hooks = useRef({
    onBeforeInput: (data: string): boolean => {
      const { state, acceptSuggestion, moveSelection, dismiss } = acRef.current;
      if (state.visible) {
        if (data === '\t') {
          const insertion = acceptSuggestion();
          if (insertion) {
            invoke('pty_write', { tabId, data: insertion }).catch(console.error);
          }
          return false;
        }
        if (data === '\x1b[A') { moveSelection(-1); return false; }
        if (data === '\x1b[B') { moveSelection(1); return false; }
        if (data === '\x1b') { dismiss(); return false; }
      }
      return true;
    },
    onAfterInput: (data: string) => {
      acRef.current.handleInput(data);
    },
    onPromptDetected: () => {
      acRef.current.resetBuffer();
    },
  }).current;

  const { terminalRef, fitAddonRef } = usePty(tabId, containerRef, hooks);

  // Pass terminal to autocomplete for cursor position
  useEffect(() => {
    if (terminalRef.current) {
      ac.setTerminal(terminalRef.current);
    }
  });

  // Re-fit when tab becomes visible — multi-stage to ensure accuracy
  useEffect(() => {
    if (isVisible && fitAddonRef.current && terminalRef.current) {
      const fit = () => {
        fitAddonRef.current?.fit();
        if (terminalRef.current) {
          const { cols, rows } = terminalRef.current;
          invoke('pty_resize', { tabId, cols, rows }).catch(() => {});
        }
      };
      // Immediate + delayed to catch layout shifts
      const t1 = setTimeout(fit, 50);
      const t2 = setTimeout(fit, 300);
      return () => { clearTimeout(t1); clearTimeout(t2); };
    }
  }, [isVisible, fitAddonRef, terminalRef, tabId]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => setIsDragOver(false), []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const path =
      e.dataTransfer.getData('application/x-ppterminals-path') ||
      e.dataTransfer.getData('text/plain');
    if (path) {
      const escaped = path.includes(' ') ? `"${path}"` : path;
      invoke('pty_write', { tabId, data: escaped }).catch(console.error);
    }
  }, [tabId]);

  const terminalElement = containerRef.current?.querySelector('.xterm') as HTMLElement | null;

  return (
    <div
      className={`terminal-view ${isDragOver ? 'drag-over' : ''}`}
      style={{ display: isVisible ? 'flex' : 'none' }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div ref={containerRef} className="terminal-container" />
      {isDragOver && (
        <div className="terminal-drop-overlay">
          <span>Drop to insert path</span>
        </div>
      )}
      <Autocomplete
        suggestions={ac.state.suggestions}
        selectedIndex={ac.state.selectedIndex}
        visible={ac.state.visible}
        cursorX={ac.state.cursorX}
        cursorY={ac.state.cursorY}
        terminalElement={terminalElement}
      />
    </div>
  );
}
