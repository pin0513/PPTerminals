import { useState, useRef, useEffect } from 'react';
import { useTabStore } from '../stores/tab-store';
import { ConfirmDialog } from './ConfirmDialog';
import './TabBar.css';

export function TabBar() {
  const {
    tabs,
    activeTabId,
    pendingCloseTabId,
    setActiveTab,
    requestCloseTab,
    confirmCloseTab,
    cancelCloseTab,
    createTab,
    renameTab,
  } = useTabStore();

  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingTabId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingTabId]);

  const handleDoubleClick = (tabId: string, currentTitle: string) => {
    setEditingTabId(tabId);
    setEditValue(currentTitle);
  };

  const commitRename = () => {
    if (editingTabId) {
      renameTab(editingTabId, editValue);
      setEditingTabId(null);
    }
  };

  const handleClose = (e: React.MouseEvent, tabId: string) => {
    e.stopPropagation();
    requestCloseTab(tabId);
  };

  const closingTab = pendingCloseTabId ? tabs.find((t) => t.id === pendingCloseTabId) : null;

  return (
    <>
      <div className="tab-bar">
        <div className="tab-list">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              className={`tab ${activeTabId === tab.id ? 'active' : ''} ${tab.completed ? 'completed' : ''}`}
              onClick={() => setActiveTab(tab.id)}
              onDoubleClick={() => handleDoubleClick(tab.id, tab.title)}
              title={`${tab.title} — \` + ${tab.hotkey}`}
            >
              {/* Hotkey badge */}
              <span className="tab-hotkey">{tab.hotkey}</span>

              {/* Completed indicator */}
              {tab.completed && (
                <span className="tab-completed-icon" title="Process completed">
                  <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z" />
                  </svg>
                </span>
              )}

              {editingTabId === tab.id ? (
                <input
                  ref={inputRef}
                  className="tab-rename-input"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename();
                    if (e.key === 'Escape') setEditingTabId(null);
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span className="tab-title">{tab.title}</span>
              )}
              <button
                className="tab-close"
                onClick={(e) => handleClose(e, tab.id)}
                title="Close tab"
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <button className="tab-new" onClick={() => createTab()} title="New tab (Cmd+T)">
          +
        </button>
      </div>

      {pendingCloseTabId && (
        <ConfirmDialog
          title="Close Terminal?"
          message={`Are you sure you want to close "${closingTab?.title || 'Terminal'}"? This session will be terminated.`}
          confirmLabel="Close"
          cancelLabel="Cancel"
          variant="danger"
          onConfirm={confirmCloseTab}
          onCancel={cancelCloseTab}
        />
      )}
    </>
  );
}
