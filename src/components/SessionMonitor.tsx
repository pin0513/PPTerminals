import { useEffect, useState, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTabStore } from '../stores/tab-store';
import './SessionMonitor.css';

interface SessionStatus {
  tab_id: string;
  active: boolean;
}

export function SessionMonitor() {
  const tabs = useTabStore((s) => s.tabs);
  const activeTabId = useTabStore((s) => s.activeTabId);
  const setActiveTab = useTabStore((s) => s.setActiveTab);
  const [statuses, setStatuses] = useState<Map<string, boolean>>(new Map());
  const [isOpen, setIsOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Poll session status every 2 seconds
  useEffect(() => {
    const poll = async () => {
      try {
        const result = await invoke<SessionStatus[]>('pty_all_status');
        const map = new Map<string, boolean>();
        result.forEach((s) => map.set(s.tab_id, s.active));
        setStatuses(map);
      } catch {
        // ignore
      }
    };

    poll();
    const interval = setInterval(poll, 2000);
    return () => clearInterval(interval);
  }, []);

  // Close panel on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isOpen]);

  const busyCount = tabs.filter((t) => statuses.get(t.id) === true).length;
  const idleCount = tabs.length - busyCount;

  const handleTabClick = useCallback(
    (tabId: string) => {
      setActiveTab(tabId);
      setIsOpen(false);
    },
    [setActiveTab]
  );

  return (
    <div className="session-monitor" ref={panelRef}>
      {/* Trigger button in StatusBar */}
      <button
        className={`session-monitor-btn ${busyCount > 0 ? 'has-busy' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        title={`${busyCount} active, ${idleCount} idle`}
      >
        {busyCount > 0 ? (
          <span className="session-runner">
            <RunnerIcon />
            <span className="session-busy-count">{busyCount}</span>
          </span>
        ) : (
          <span className="session-idle">
            <IdleIcon />
            <span className="session-count">{tabs.length}</span>
          </span>
        )}
      </button>

      {/* Popup panel */}
      {isOpen && (
        <div className="session-panel">
          <div className="session-panel-header">
            <span className="session-panel-title">Sessions</span>
            <span className="session-panel-summary">
              {busyCount > 0 && (
                <span className="summary-active">{busyCount} active</span>
              )}
              {idleCount > 0 && (
                <span className="summary-idle">{idleCount} idle</span>
              )}
            </span>
          </div>
          <div className="session-panel-list">
            {tabs.map((tab) => {
              const isActive = statuses.get(tab.id) === true;
              const isCurrent = tab.id === activeTabId;
              return (
                <button
                  key={tab.id}
                  className={`session-item ${isCurrent ? 'current' : ''}`}
                  onClick={() => handleTabClick(tab.id)}
                >
                  <span className={`session-dot ${isActive ? 'active' : 'idle'}`} />
                  <span className="session-item-title">{tab.title}</span>
                  <span className="session-item-status">
                    {isActive ? (
                      <span className="status-running">
                        <RunnerIcon />
                        running
                      </span>
                    ) : (
                      <span className="status-idle-text">idle</span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
          {tabs.length === 0 && (
            <div className="session-panel-empty">No sessions</div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Icons ─── */

function RunnerIcon() {
  return (
    <svg className="runner-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="17" cy="4" r="2" />
      <path d="M10.5 21l-2-7-3 1.5V21" />
      <path d="M15 21l-4-9-3.5 2L10 7.5l4.5-1 3.5 4.5-3 1.5" />
    </svg>
  );
}

function IdleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 1.5a5.5 5.5 0 110 11 5.5 5.5 0 010-11z" />
      <path d="M7.25 4v4.5l3 1.72.75-1.3-2.25-1.3V4h-1.5z" />
    </svg>
  );
}
