import { useDashboardStore } from '../stores/dashboard-store';
import { useTabStore } from '../stores/tab-store';
import './Dashboard.css';

export function Dashboard() {
  const {
    totalInputTokens,
    totalOutputTokens,
    totalRequests,
    sessions,
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
              <span className="cost-label">Total Cost</span>
              <span className="cost-value cost-total">${cost.total.toFixed(4)}</span>
            </div>
            <div className="cost-card">
              <span className="cost-label">Input</span>
              <span className="cost-value">${cost.input.toFixed(4)}</span>
              <span className="cost-tokens">{formatTokens(totalInputTokens)} tokens</span>
            </div>
            <div className="cost-card">
              <span className="cost-label">Output</span>
              <span className="cost-value">${cost.output.toFixed(4)}</span>
              <span className="cost-tokens">{formatTokens(totalOutputTokens)} tokens</span>
            </div>
            <div className="cost-card">
              <span className="cost-label">Requests</span>
              <span className="cost-value">{totalRequests}</span>
            </div>
          </div>
        </div>

        {/* Agent Village — pixel art characters */}
        <div className="dash-section">
          <div className="dash-section-title">Agent Village</div>
          <div className="agent-village">
            {tabs.map((tab) => {
              const usage = sessions.get(tab.id);
              const subAgents = usage?.subAgents || 0;
              const isActive = usage && usage.lastActivity > Date.now() - 5000;
              const state: AgentState = tab.completed
                ? 'done'
                : isActive
                ? subAgents > 0
                  ? 'cloning'
                  : 'working'
                : 'idle';

              return (
                <div key={tab.id} className="village-agent">
                  <PixelAgent state={state} />
                  {/* Shadow clones */}
                  {state === 'cloning' &&
                    Array.from({ length: Math.min(subAgents, 3) }).map((_, i) => (
                      <div
                        key={i}
                        className="village-clone"
                        style={{ animationDelay: `${i * 0.2}s` }}
                      >
                        <PixelAgent state="clone" />
                      </div>
                    ))}
                  <span className="village-name">{tab.hotkey}</span>
                  <span className={`village-status village-${state}`}>
                    {state === 'done' ? '✓' : state === 'idle' ? 'zzz' : ''}
                  </span>
                </div>
              );
            })}
            {tabs.length === 0 && (
              <div className="village-empty">No agents deployed</div>
            )}
          </div>
        </div>

        {/* Per-session breakdown */}
        <div className="dash-section">
          <div className="dash-section-title">Session Breakdown</div>
          <div className="dash-table">
            <div className="dash-table-header">
              <span>Tab</span>
              <span>In</span>
              <span>Out</span>
              <span>Reqs</span>
              <span>Cost</span>
            </div>
            {tabs.map((tab) => {
              const u = sessions.get(tab.id);
              const inT = u?.inputTokens || 0;
              const outT = u?.outputTokens || 0;
              const reqs = u?.requests || 0;
              const c = (inT / 1_000_000) * 3 + (outT / 1_000_000) * 15;
              return (
                <div key={tab.id} className="dash-table-row">
                  <span className="dash-cell-name">{tab.hotkey} {tab.title}</span>
                  <span>{formatTokens(inT)}</span>
                  <span>{formatTokens(outT)}</span>
                  <span>{reqs}</span>
                  <span>${c.toFixed(4)}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Pixel Agent Character ─── */

type AgentState = 'idle' | 'working' | 'cloning' | 'done' | 'clone';

function PixelAgent({ state }: { state: AgentState }) {
  const stateClass = `pixel-agent pixel-${state}`;
  return (
    <div className={stateClass}>
      {/* 8-bit style character using CSS */}
      <div className="pixel-head" />
      <div className="pixel-body" />
      <div className="pixel-legs">
        <div className="pixel-leg left" />
        <div className="pixel-leg right" />
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
