import { useState, useCallback } from 'react';
import { useTabStore } from '../stores/tab-store';
import { useDashboardStore, type ClaudeSession } from '../stores/dashboard-store';
import { AvatarGroup, PixelAvatar } from './PixelAvatar';
import './AgentPanel.css';

export function AgentPanel() {
  const tabs = useTabStore((s) => s.tabs);
  const activeTabId = useTabStore((s) => s.activeTabId);
  const setActiveTab = useTabStore((s) => s.setActiveTab);
  const claudeSessions = useDashboardStore((s) => s.claudeSessions);
  const [collapsed, setCollapsed] = useState(false);
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set());

  const toggleExpand = useCallback((tabId: string) => {
    setExpandedSessions((prev) => {
      const next = new Set(prev);
      next.has(tabId) ? next.delete(tabId) : next.add(tabId);
      return next;
    });
  }, []);

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
            <SessionCard
              key={session.tabId}
              session={session}
              title={getTabTitle(session.tabId)}
              isCurrent={session.tabId === activeTabId}
              isExpanded={expandedSessions.has(session.tabId)}
              onToggleExpand={() => toggleExpand(session.tabId)}
              onClick={() => setActiveTab(session.tabId)}
            />
          ))}

          {endedSessions.length > 0 && activeSessions.length > 0 && (
            <div className="agent-divider" />
          )}

          {endedSessions.map((session) => (
            <SessionCard
              key={session.tabId}
              session={session}
              title={getTabTitle(session.tabId)}
              isCurrent={session.tabId === activeTabId}
              isExpanded={expandedSessions.has(session.tabId)}
              onToggleExpand={() => toggleExpand(session.tabId)}
              onClick={() => setActiveTab(session.tabId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SessionCard({
  session,
  title,
  isCurrent,
  isExpanded,
  onToggleExpand,
  onClick,
}: {
  session: ClaudeSession;
  title: string;
  isCurrent: boolean;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onClick: () => void;
}) {
  return (
    <div className={`session-card ${session.active ? 'active' : 'ended'} ${isCurrent ? 'current' : ''}`}>
      {/* Main row */}
      <div className="session-card-main" onClick={onClick}>
        <AvatarGroup name={title} subAgentCount={session.subAgents} isActive={session.active} />
        <div className="session-card-info">
          <div className="session-card-title">{title}</div>
          <div className="session-card-meta">
            <span className={`session-model ${session.active ? 'glow' : ''}`}>
              {session.model}
            </span>
            {session.active && session.subAgents > 0 && (
              <span className="session-agents-count">
                {session.subAgents} agent{session.subAgents > 1 ? 's' : ''}
              </span>
            )}
            {!session.active && <span className="session-ended-badge">exited</span>}
          </div>
        </div>
        {session.active && <LoadingDots />}
        {/* Expand button */}
        {(session.subAgentDetails.length > 0 || session.bashCommands.length > 0) && (
          <button
            className={`session-expand-btn ${isExpanded ? 'expanded' : ''}`}
            onClick={(e) => { e.stopPropagation(); onToggleExpand(); }}
            title="Show details"
          >
            ›
          </button>
        )}
      </div>

      {/* Expanded details */}
      {isExpanded && (
        <div className="session-details">
          {/* Sub-agents */}
          {session.subAgentDetails.length > 0 && (
            <div className="detail-section">
              <div className="detail-label">Agents</div>
              {session.subAgentDetails.map((agent, i) => (
                <div key={i} className="detail-agent-row">
                  <PixelAvatar name={`${title}-${agent.name}`} size={16} isActive={agent.status === 'running'} />
                  <span className="detail-agent-name">{agent.name}</span>
                  <span className="detail-agent-tools">{agent.toolUses} tools</span>
                </div>
              ))}
            </div>
          )}

          {/* Bash commands */}
          {session.bashCommands.length > 0 && (
            <div className="detail-section">
              <div className="detail-label">Bash</div>
              {session.bashCommands.slice(-5).map((cmd, i) => (
                <div key={i} className="detail-bash-row">
                  <span className="detail-bash-prompt">$</span>
                  <span className="detail-bash-cmd">{cmd}</span>
                </div>
              ))}
            </div>
          )}

          {/* Usage stats */}
          <div className="detail-section detail-stats">
            <span>{session.usage.requests} req</span>
            <span>{formatTokens(session.usage.outputTokens)} out</span>
            <span>${((session.usage.outputTokens / 1_000_000) * 15).toFixed(3)}</span>
          </div>
        </div>
      )}
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
