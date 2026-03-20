import { useState, useRef, useEffect, useCallback } from 'react';
import { useTabStore } from '../stores/tab-store';
import { useExplorerStore } from '../stores/explorer-store';
import { useFileViewerStore } from '../stores/file-viewer-store';
import { useDashboardStore } from '../stores/dashboard-store';
import './MenuBar.css';

interface MenuItem {
  label: string;
  shortcut?: string;
  action?: () => void;
  separator?: boolean;
  disabled?: boolean;
}

interface Menu {
  label: string;
  items: MenuItem[];
}

interface MenuBarProps {
  onShowSwitcher: () => void;
}

const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC');
const mod = isMac ? '⌘' : 'Ctrl+';

export function MenuBar({ onShowSwitcher }: MenuBarProps) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  const createTab = useTabStore((s) => s.createTab);
  const requestCloseTab = useTabStore((s) => s.requestCloseTab);
  const activeTabId = useTabStore((s) => s.activeTabId);
  const tabs = useTabStore((s) => s.tabs);
  const setActiveTab = useTabStore((s) => s.setActiveTab);
  const toggleExplorer = useExplorerStore((s) => s.toggleOpen);
  const explorerOpen = useExplorerStore((s) => s.isOpen);
  const fileViewerOpen = useFileViewerStore((s) => s.isOpen);
  const closeFileViewer = useFileViewerStore((s) => s.close);

  const menus: Menu[] = [
    {
      label: 'File',
      items: [
        { label: 'New Terminal', shortcut: `${mod}T`, action: () => createTab() },
        { separator: true, label: '' },
        {
          label: 'Close Terminal',
          shortcut: `${mod}W`,
          action: () => { if (activeTabId) requestCloseTab(activeTabId); },
          disabled: !activeTabId,
        },
        { separator: true, label: '' },
        {
          label: fileViewerOpen ? 'Close File Viewer' : 'File Viewer',
          action: () => { if (fileViewerOpen) closeFileViewer(); },
          disabled: !fileViewerOpen,
        },
      ],
    },
    {
      label: 'Edit',
      items: [
        { label: 'Copy', shortcut: `${mod}C` },
        { label: 'Paste', shortcut: `${mod}V` },
        { separator: true, label: '' },
        { label: 'Select All', shortcut: `${mod}A` },
        { separator: true, label: '' },
        { label: 'Find', shortcut: `${mod}F` },
      ],
    },
    {
      label: 'View',
      items: [
        {
          label: explorerOpen ? 'Hide Explorer' : 'Show Explorer',
          shortcut: `${mod}\\`,
          action: toggleExplorer,
        },
        { separator: true, label: '' },
        { label: 'Zoom In', shortcut: `${mod}+` },
        { label: 'Zoom Out', shortcut: `${mod}-` },
        { label: 'Reset Zoom', shortcut: `${mod}0` },
        { separator: true, label: '' },
        {
          label: 'Dashboard',
          shortcut: `${mod}D`,
          action: () => useDashboardStore.getState().toggleDashboard(),
        },
      ],
    },
    {
      label: 'Tab',
      items: [
        { label: 'Tab Switcher', shortcut: 'F1', action: onShowSwitcher },
        { separator: true, label: '' },
        {
          label: 'Next Tab',
          shortcut: `${mod}Tab`,
          action: () => {
            const idx = tabs.findIndex((t) => t.id === activeTabId);
            if (tabs.length > 1) setActiveTab(tabs[(idx + 1) % tabs.length].id);
          },
          disabled: tabs.length <= 1,
        },
        {
          label: 'Previous Tab',
          shortcut: `${mod}⇧Tab`,
          action: () => {
            const idx = tabs.findIndex((t) => t.id === activeTabId);
            if (tabs.length > 1) setActiveTab(tabs[(idx - 1 + tabs.length) % tabs.length].id);
          },
          disabled: tabs.length <= 1,
        },
        { separator: true, label: '' },
        ...tabs.map((tab) => ({
          label: `${tab.hotkey}  ${tab.title}`,
          shortcut: `\` ${tab.hotkey}`,
          action: () => setActiveTab(tab.id),
        })),
      ],
    },
  ];

  // Close menu on outside click
  useEffect(() => {
    if (!openMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMenu(null);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [openMenu]);

  const handleMenuClick = useCallback(
    (label: string) => {
      setOpenMenu((prev) => (prev === label ? null : label));
    },
    []
  );

  const handleItemClick = useCallback(
    (item: MenuItem) => {
      if (item.disabled || item.separator) return;
      item.action?.();
      setOpenMenu(null);
    },
    []
  );

  // Hover to switch between open menus
  const handleMenuHover = useCallback(
    (label: string) => {
      if (openMenu) setOpenMenu(label);
    },
    [openMenu]
  );

  return (
    <div className="menu-bar" ref={barRef}>
      {menus.map((menu) => (
        <div key={menu.label} className="menu-container">
          <button
            className={`menu-trigger ${openMenu === menu.label ? 'open' : ''}`}
            onClick={() => handleMenuClick(menu.label)}
            onMouseEnter={() => handleMenuHover(menu.label)}
          >
            {menu.label}
          </button>
          {openMenu === menu.label && (
            <div className="menu-dropdown">
              {menu.items.map((item, i) =>
                item.separator ? (
                  <div key={`sep-${i}`} className="menu-separator" />
                ) : (
                  <button
                    key={item.label}
                    className={`menu-item ${item.disabled ? 'disabled' : ''}`}
                    onClick={() => handleItemClick(item)}
                    disabled={item.disabled}
                  >
                    <span className="menu-item-label">{item.label}</span>
                    {item.shortcut && (
                      <span className="menu-item-shortcut">{item.shortcut}</span>
                    )}
                  </button>
                )
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
