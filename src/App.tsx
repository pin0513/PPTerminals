import { useEffect, useRef, useCallback, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { MenuBar } from './components/MenuBar';
import { TabBar } from './components/TabBar';
import { TerminalView } from './components/TerminalView';
import { StatusBar } from './components/StatusBar';
import { Explorer } from './components/Explorer';
import { AgentPanel } from './components/AgentPanel';
import { FileViewer } from './components/FileViewer';
import { TabSwitcher } from './components/TabSwitcher';
import { Dashboard } from './components/Dashboard';
import { useTabStore } from './stores/tab-store';
import { useExplorerStore } from './stores/explorer-store';
import { useFileViewerStore } from './stores/file-viewer-store';
import './App.css';

function App() {
  const { tabs, activeTabId, createTab, requestCloseTab, setActiveTab, restoreTabs } =
    useTabStore();
  const explorerOpen = useExplorerStore((s) => s.isOpen);
  const explorerWidth = useExplorerStore((s) => s.width);
  const setExplorerWidth = useExplorerStore((s) => s.setWidth);
  const toggleExplorer = useExplorerStore((s) => s.toggleOpen);

  const fileViewerOpen = useFileViewerStore((s) => s.isOpen);

  const [isDragging, setIsDragging] = useState(false);
  const [showSwitcher, setShowSwitcher] = useState(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);
  const backtickPressed = useRef(false);
  const backtickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Restore saved tabs on mount
  useEffect(() => {
    restoreTabs();
  }, []);

  // Resize handle drag
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDragging(true);
      dragStartX.current = e.clientX;
      dragStartWidth.current = explorerWidth;
    },
    [explorerWidth]
  );

  useEffect(() => {
    if (!isDragging) return;
    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - dragStartX.current;
      setExplorerWidth(dragStartWidth.current + delta);
    };
    const handleMouseUp = () => setIsDragging(false);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, setExplorerWidth]);

  // Keyboard shortcuts
  useEffect(() => {
    const isMac = navigator.platform.toUpperCase().includes('MAC');
    const modKey = isMac ? 'metaKey' : 'ctrlKey';

    const handleKeyDown = (e: KeyboardEvent) => {
      // F1 — Tab Switcher
      if (e.key === 'F1') {
        e.preventDefault();
        setShowSwitcher((prev) => !prev);
        return;
      }

      // Backtick chord: ` then A-Z
      if (e.key === '`' && !e[modKey] && !e.altKey) {
        // Don't intercept if typing in an input/textarea
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

        backtickPressed.current = true;
        if (backtickTimer.current) clearTimeout(backtickTimer.current);
        backtickTimer.current = setTimeout(() => {
          backtickPressed.current = false;
        }, 500);
        return;
      }

      // If backtick was just pressed, check for A-Z
      if (backtickPressed.current) {
        const letter = e.key.toUpperCase();
        if (letter >= 'A' && letter <= 'Z') {
          e.preventDefault();
          backtickPressed.current = false;
          if (backtickTimer.current) clearTimeout(backtickTimer.current);
          const currentTabs = useTabStore.getState().tabs;
          const tab = currentTabs.find((t) => t.hotkey === letter);
          if (tab) setActiveTab(tab.id);
          return;
        }
        backtickPressed.current = false;
      }

      // Cmd+Shift+Letter — switch to tab by hotkey
      if (e[modKey] && e.shiftKey) {
        const letter = e.key.toUpperCase();
        if (letter >= 'A' && letter <= 'Z') {
          e.preventDefault();
          const currentTabs = useTabStore.getState().tabs;
          const tab = currentTabs.find((t) => t.hotkey === letter);
          if (tab) setActiveTab(tab.id);
          return;
        }
      }

      // Cmd/Ctrl shortcuts
      if (e[modKey]) {
        if (e.key === 'r') {
          // Cmd+R — refresh terminal (force SIGWINCH for clean redraw)
          e.preventDefault();
          if (activeTabId) {
            invoke('pty_refresh', {
              tabId: activeTabId,
              cols: 80, rows: 24, // will be overridden by fit
            }).catch(() => {});
          }
        } else if (e.key === 't') {
          e.preventDefault();
          createTab();
        } else if (e.key === 'w') {
          e.preventDefault();
          if (activeTabId) requestCloseTab(activeTabId);
        } else if (e.key === 'b') {
          e.preventDefault();
          toggleExplorer();
        } else if (e.key === '\\') {
          e.preventDefault();
          toggleExplorer();
        } else if (e.key === 'Tab') {
          e.preventDefault();
          const currentIdx = tabs.findIndex((t) => t.id === activeTabId);
          if (tabs.length > 1) {
            const nextIdx = e.shiftKey
              ? (currentIdx - 1 + tabs.length) % tabs.length
              : (currentIdx + 1) % tabs.length;
            setActiveTab(tabs[nextIdx].id);
          }
        } else if (e.key === '=' || e.key === '+') {
          // Cmd+= or Cmd++ → Tab grid switcher
          e.preventDefault();
          setShowSwitcher((prev) => !prev);
        } else if (e.key >= '1' && e.key <= '9') {
          e.preventDefault();
          const idx = parseInt(e.key) - 1;
          if (idx < tabs.length) setActiveTab(tabs[idx].id);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (backtickTimer.current) clearTimeout(backtickTimer.current);
    };
  }, [tabs, activeTabId, createTab, requestCloseTab, setActiveTab, toggleExplorer]);

  return (
    <div className={`app ${isDragging ? 'resizing' : ''}`}>
      <MenuBar onShowSwitcher={() => setShowSwitcher(true)} />
      <TabBar />
      <div className="main-area">
        {explorerOpen && (
          <>
            <div className="explorer-panel" style={{ width: explorerWidth }}>
              <Explorer />
              <AgentPanel />
            </div>
            <div
              className={`sidebar-resize-handle ${isDragging ? 'dragging' : ''}`}
              onMouseDown={handleMouseDown}
            />
          </>
        )}
        <div className="terminal-area">
          <div className="terminal-panels">
            {tabs.map((tab) => (
              <TerminalView
                key={tab.id}
                tabId={tab.id}
                isVisible={tab.id === activeTabId}
              />
            ))}
            {tabs.length === 0 && (
              <div className="empty-state">
                <p>No terminals open</p>
                <button onClick={() => createTab()}>New Terminal</button>
              </div>
            )}
          </div>
          {fileViewerOpen && <FileViewer />}
        </div>
      </div>
      <StatusBar />
      <TabSwitcher isOpen={showSwitcher} onClose={() => setShowSwitcher(false)} />
      <Dashboard />
    </div>
  );
}

export default App;
