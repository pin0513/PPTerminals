import { useState, useCallback } from 'react';
import { useTabStore } from '../stores/tab-store';
import { useDashboardStore, type ClaudeSession } from '../stores/dashboard-store';
import { AvatarGroup } from './PixelAvatar';
import './AgentPanel.css';

export function AgentPanel() {
  const tabs = useTabStore((s) => s.tabs);
  const activeTabId = useTabStore((s) => s.activeTabId);
  const setActiveTab = useTabStore((s) => s.setActiveTab);
  const claudeSessions = useDashboardStore((s) => s.claudeSessions);
  const [collapsed, setCollapsed] = useState(false);

  const handleClick = useCallback(
    (tabId: string) => setActiveTab(tabId),
    [setActiveTab]
  );

  // Only show tabs that have a Claude session (active or ended)
  const sessionsArray = Array.from(claudeSessions.values());
  const activeSessions = sessionsArray.filter((s) => s.active);
  const endedSessions = sessionsArray.filter((s) => !s.active);
  const totalSubAgents = activeSessions.reduce((sum, s) => sum + s.subAgents, 0);

  const getTabTitle = (tabId: string) => {
    const tab = tabs.find((t) => t.id === tabId);
    return tab ? `${tab.hotkey} ${tab.title}` : tabId.slice(0, 8);
  };

  return (
    <div className="agent-panel">
      <div className="agent-panel-header" onClick={() => setCollapsed(!collapsed)}>
        <span className={`agent-chevron ${collapsed ? '' : 'expanded'}`}>›</span>
        <span className="agent-panel-title">Claude Sessions</span>
        {activeSessions.length > 0 && (
          <span className="agent-busy-badge">
            {activeSessions.length} active
            {totalSubAgents > 0 && ` · ${totalSubAgents} agents`}
          </span>
        )}
      </div>

      {!collapsed && (
        <div className="agent-panel-body">
          {sessionsArray.length === 0 && (
            <div className="agent-empty">No Claude sessions</div>
          )}

          {activeSessions.map((session) => (
            <SessionRow
              key={session.tabId}
              session={session}
              title={getTabTitle(session.tabId)}
              isCurrent={session.tabId === activeTabId}
              onClick={() => handleClick(session.tabId)}
            />
          ))}

          {endedSessions.length > 0 && activeSessions.length > 0 && (
            <div className="agent-divider" />
          )}

          {endedSessions.map((session) => (
            <SessionRow
              key={session.tabId}
              session={session}
              title={getTabTitle(session.tabId)}
              isCurrent={session.tabId === activeTabId}
              onClick={() => handleClick(session.tabId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SessionRow({
  session,
  title,
  isCurrent,
  onClick,
}: {
  session: ClaudeSession;
  title: string;
  isCurrent: boolean;
  onClick: () => void;
}) {
  return (
    <div
      className={`agent-row ${session.active ? 'busy' : 'idle'} ${isCurrent ? 'current' : ''}`}
      onClick={onClick}
    >
      <AvatarGroup
        name={title}
        subAgentCount={session.subAgents}
        isActive={session.active}
      />
      <div className="agent-info">
        <span className="agent-name">{title}</span>
        <span className={`agent-status-text ${session.active ? '' : 'idle-text'}`}>
          {session.active
            ? session.subAgents > 0
              ? `${session.subAgents} agent${session.subAgents > 1 ? 's' : ''} running`
              : `${session.model} · running`
            : `${session.model} · exited`}
        </span>
        {session.usage.requests > 0 && (
          <span className="agent-stats">
            {session.usage.requests} req · {formatTokens(session.usage.outputTokens)} tok
          </span>
        )}
      </div>
      {session.active && <LoadingDots />}
      {!session.active && <CompletedBadge />}
    </div>
  );
}

function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

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
