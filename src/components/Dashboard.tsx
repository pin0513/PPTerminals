import { useDashboardStore } from '../stores/dashboard-store';
import { useTabStore } from '../stores/tab-store';
import './Dashboard.css';

export function Dashboard() {
  const {
    totalInputTokens,
    totalOutputTokens,
    totalRequests,
    claudeSessions,
    isOpen,
    toggleDashboard,
    getCost,
  } = useDashboardStore();
  const tabs = useTabStore((s) => s.tabs);

  if (!isOpen) return null;

  const cost = getCost();

  return (
    <div className="dashboard-overlay" onClick={toggleDashboard}>
      <div className="dashboard" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="dash-header">
          <span className="dash-title">Dashboard</span>
          <button className="dash-close" onClick={toggleDashboard}>×</button>
        </div>

        {/* Cost Summary */}
        <div className="dash-section">
          <div className="dash-cost-cards">
            <div className="cost-card">
              <span className="cost-label">Est. Cost</span>
              <span className="cost-value cost-total">${cost.total.toFixed(2)}</span>
            </div>
            <div className="cost-card">
              <span className="cost-label">Tokens</span>
              <span className="cost-value">{formatTokens(totalInputTokens + totalOutputTokens)}</span>
              <span className="cost-tokens">≈ detected from CLI</span>
            </div>
            <div className="cost-card">
              <span className="cost-label">Requests</span>
              <span className="cost-value">{totalRequests}</span>
            </div>
            <div className="cost-card">
              <span className="cost-label">Sessions</span>
              <span className="cost-value">{claudeSessions.size}</span>
              <span className="cost-tokens">{Array.from(claudeSessions.values()).filter(s => s.active).length} active</span>
            </div>
          </div>
        </div>

        {/* Claude Sessions breakdown */}
        <div className="dash-section">
          <div className="dash-section-title">Claude Sessions</div>
          {claudeSessions.size === 0 ? (
            <div className="village-empty">No sessions yet — open Claude CLI to start tracking</div>
          ) : (
            <div className="dash-table">
              <div className="dash-table-header">
                <span>Session</span>
                <span>Model</span>
                <span>Tokens</span>
                <span>Reqs</span>
                <span>Cost</span>
              </div>
              {Array.from(claudeSessions.values()).map((cs) => {
                const tab = tabs.find((t) => t.id === cs.tabId);
                const tokens = cs.usage.outputTokens;
                const reqs = cs.usage.requests;
                const c = (tokens / 1_000_000) * 15;
              return (
                <div key={cs.tabId} className="dash-table-row">
                  <span className="dash-cell-name">{tab?.hotkey || '?'} {tab?.title || cs.tabId.slice(0, 8)}</span>
                  <span>{cs.model}</span>
                  <span>{formatTokens(tokens)}</span>
                  <span>{reqs}</span>
                  <span>${c.toFixed(2)}</span>
                </div>
              );
            })}
          </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Helpers ─── */

function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}
