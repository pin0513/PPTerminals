import { useEffect, useCallback } from 'react';
import { useTabStore } from '../stores/tab-store';
import './TabSwitcher.css';

interface TabSwitcherProps {
  isOpen: boolean;
  onClose: () => void;
}

export function TabSwitcher({ isOpen, onClose }: TabSwitcherProps) {
  const tabs = useTabStore((s) => s.tabs);
  const activeTabId = useTabStore((s) => s.activeTabId);
  const setActiveTab = useTabStore((s) => s.setActiveTab);

  const handleSelect = useCallback(
    (tabId: string) => {
      setActiveTab(tabId);
      onClose();
    },
    [setActiveTab, onClose]
  );

  // Listen for hotkey letter press while open
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'F1') {
        e.preventDefault();
        onClose();
        return;
      }
      const letter = e.key.toUpperCase();
      if (letter >= 'A' && letter <= 'Z') {
        const tab = tabs.find((t) => t.hotkey === letter);
        if (tab) {
          e.preventDefault();
          handleSelect(tab.id);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, tabs, handleSelect, onClose]);

  if (!isOpen) return null;

  return (
    <div className="tab-switcher-overlay" onClick={onClose}>
      <div className="tab-switcher" onClick={(e) => e.stopPropagation()}>
        <div className="tab-switcher-header">
          <span className="tab-switcher-title">Switch Tab</span>
          <span className="tab-switcher-hint">press letter or Esc</span>
        </div>
        <div className="tab-switcher-grid">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={`tab-switcher-item ${tab.id === activeTabId ? 'current' : ''} ${tab.completed ? 'completed' : ''}`}
              onClick={() => handleSelect(tab.id)}
            >
              <span className="switcher-hotkey">{tab.hotkey}</span>
              <span className="switcher-icon">
                {tab.completed ? (
                  <svg width="20" height="20" viewBox="0 0 16 16" fill="#3fb950">
                    <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z" />
                  </svg>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M0 2.75C0 1.784.784 1 1.75 1h12.5c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0114.25 15H1.75A1.75 1.75 0 010 13.25V2.75zm1.75-.25a.25.25 0 00-.25.25v10.5c0 .138.112.25.25.25h12.5a.25.25 0 00.25-.25V2.75a.25.25 0 00-.25-.25H1.75z" />
                    <path d="M7 4.75a.75.75 0 01.75-.75h4.5a.75.75 0 010 1.5h-4.5A.75.75 0 017 4.75zm-3.5.5L5 3.75v2l-1.5-1v.5z" />
                  </svg>
                )}
              </span>
              <span className="switcher-title">{tab.title}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
