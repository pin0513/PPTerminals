import { useTabStore } from '../stores/tab-store';
import { useExplorerStore } from '../stores/explorer-store';
import { useDashboardStore } from '../stores/dashboard-store';
import { SessionMonitor } from './SessionMonitor';
import './StatusBar.css';

export function StatusBar() {
  const { tabs, activeTabId } = useTabStore();
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const toggleExplorer = useExplorerStore((s) => s.toggleOpen);
  const explorerOpen = useExplorerStore((s) => s.isOpen);
  const toggleDashboard = useDashboardStore((s) => s.toggleDashboard);
  const getCost = useDashboardStore((s) => s.getCost);
  const cost = getCost();

  return (
    <div className="status-bar">
      <button
        className={`status-btn ${explorerOpen ? 'active' : ''}`}
        onClick={toggleExplorer}
        title="Toggle Explorer (Cmd+B)"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
          <path d="M1.5 1h5l1 1H14.5l.5.5v4h-1V3H7.71l-1-1H2v10h4v1H1.5l-.5-.5v-11l.5-.5z" />
          <path d="M7.5 7h8l.5.5v6l-.5.5h-8l-.5-.5v-6l.5-.5z" />
        </svg>
      </button>
      <span className="status-item">
        {activeTab ? activeTab.cwd : ''}
      </span>
      <span className="status-spacer" />
      {/* Cost indicator — click to open dashboard */}
      <button
        className="status-btn status-cost"
        onClick={toggleDashboard}
        title="Open Dashboard"
      >
        <span className="cost-indicator">${cost.total.toFixed(2)}</span>
      </button>
      <SessionMonitor />
    </div>
  );
}
