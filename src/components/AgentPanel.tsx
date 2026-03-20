import { useEffect, useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTabStore } from '../stores/tab-store';
import { useDashboardStore } from '../stores/dashboard-store';
import './AgentPanel.css';

interface SessionStatus {
  tab_id: string;
  active: boolean;
}

export function AgentPanel() {
  const tabs = useTabStore((s) => s.tabs);
  const activeTabId = useTabStore((s) => s.activeTabId);
  const setActiveTab = useTabStore((s) => s.setActiveTab);
  const sessions = useDashboardStore((s) => s.sessions);
  const [statuses, setStatuses] = useState<Map<string, boolean>>(new Map());
  const [collapsed, setCollapsed] = useState(false);

  // Poll session status
  useEffect(() => {
    const poll = async () => {
      try {
        const result = await invoke<SessionStatus[]>('pty_all_status');
        const map = new Map<string, boolean>();
        result.forEach((s) => map.set(s.tab_id, s.active));
        setStatuses(map);
      } catch { /* ignore */ }
    };
    poll();
    const interval = setInterval(poll, 2000);
    return () => clearInterval(interval);
  }, []);

  const busyTabs = tabs.filter((t) => statuses.get(t.id) === true);
  const idleTabs = tabs.filter((t) => statuses.get(t.id) !== true);

  const handleClick = useCallback(
    (tabId: string) => setActiveTab(tabId),
    [setActiveTab]
  );

  return (
    <div className="agent-panel">
      <div className="agent-panel-header" onClick={() => setCollapsed(!collapsed)}>
        <span className={`agent-chevron ${collapsed ? '' : 'expanded'}`}>›</span>
        <span className="agent-panel-title">Sessions</span>
        {busyTabs.length > 0 && (
          <span className="agent-busy-badge">{busyTabs.length} active</span>
        )}
      </div>

      {!collapsed && (
        <div className="agent-panel-body">
          {tabs.length === 0 && (
            <div className="agent-empty">No sessions</div>
          )}

          {busyTabs.map((tab) => {
            const usage = sessions.get(tab.id);
            const subAgents = usage?.subAgents || 0;
            const isCurrent = tab.id === activeTabId;

            return (
              <div
                key={tab.id}
                className={`agent-row busy ${isCurrent ? 'current' : ''}`}
                onClick={() => handleClick(tab.id)}
              >
                {/* Shadow clone avatars — main + sub-agents */}
                <div className="agent-avatars">
                  <div className="agent-avatar main">
                    <RunnerSvg />
                  </div>
                  {Array.from({ length: Math.min(subAgents, 4) }).map((_, i) => (
                    <div
                      key={i}
                      className="agent-avatar clone"
                      style={{
                        animationDelay: `${i * 0.15}s`,
                        opacity: 0.6 - i * 0.12,
                      }}
                    >
                      <RunnerSvg />
                    </div>
                  ))}
                </div>
                <div className="agent-info">
                  <span className="agent-name">
                    {tab.hotkey} {tab.title}
                  </span>
                  <span className="agent-status-text">
                    {subAgents > 0
                      ? `running + ${subAgents} sub-agent${subAgents > 1 ? 's' : ''}`
                      : 'running'}
                  </span>
                </div>
                <LoadingDots />
              </div>
            );
          })}

          {idleTabs.map((tab) => {
            const isCurrent = tab.id === activeTabId;
            return (
              <div
                key={tab.id}
                className={`agent-row idle ${isCurrent ? 'current' : ''}`}
                onClick={() => handleClick(tab.id)}
              >
                <div className="agent-avatars">
                  <div className="agent-avatar idle-avatar">
                    <IdleSvg />
                  </div>
                </div>
                <div className="agent-info">
                  <span className="agent-name">
                    {tab.hotkey} {tab.title}
                  </span>
                  <span className="agent-status-text idle-text">
                    {tab.completed ? 'completed' : 'idle'}
                  </span>
                </div>
                {tab.completed && <CompletedBadge />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─── Sub-components ─── */

function LoadingDots() {
  return (
    <div className="loading-dots">
      <span className="dot" />
      <span className="dot" />
      <span className="dot" />
    </div>
  );
}

function CompletedBadge() {
  return (
    <span className="completed-badge">
      <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
        <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z" />
      </svg>
    </span>
  );
}

function RunnerSvg() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="17" cy="4" r="2" />
      <path d="M10.5 21l-2-7-3 1.5V21" />
      <path d="M15 21l-4-9-3.5 2L10 7.5l4.5-1 3.5 4.5-3 1.5" />
    </svg>
  );
}

function IdleSvg() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" opacity="0.4">
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7.25 5v3.5l2.5 1.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
