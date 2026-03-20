import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';

interface PtyCreateResult {
  tab_id: string;
  cwd: string;
}

export interface Tab {
  id: string;
  title: string;
  cwd: string;
  isActive: boolean;
  hotkey: string; // A-Z
  completed: boolean; // true when process exited
}

interface TabStore {
  tabs: Tab[];
  activeTabId: string | null;
  pendingCloseTabId: string | null;
  createTab: (cwd?: string) => Promise<void>;
  createClaudeTab: (cwd?: string) => Promise<void>;
  closeTab: (id: string) => Promise<void>;
  requestCloseTab: (id: string) => void;
  confirmCloseTab: () => void;
  cancelCloseTab: () => void;
  setActiveTab: (id: string) => void;
  renameTab: (id: string, title: string) => void;
  updateTabTitle: (id: string, title: string) => void;
  markCompleted: (id: string) => void;
  clearCompleted: (id: string) => void;
  restoreTabs: () => Promise<void>;
  saveTabs: () => void;
}

const HOTKEY_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function nextHotkey(tabs: Tab[]): string {
  const used = new Set(tabs.map((t) => t.hotkey));
  for (const letter of HOTKEY_LETTERS) {
    if (!used.has(letter)) return letter;
  }
  return '';
}

function dirName(path: string): string {
  const parts = path.replace(/\/$/, '').split('/');
  return parts[parts.length - 1] || path;
}

const STORAGE_KEY = 'ppterminals_tabs';

interface SavedTab {
  cwd: string;
  title: string;
  hotkey: string;
}

function loadSavedTabs(): SavedTab[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return [];
}

function saveTabs(tabs: Tab[]) {
  const data: SavedTab[] = tabs.map((t) => ({
    cwd: t.cwd,
    title: t.title,
    hotkey: t.hotkey,
  }));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

let _restoring = false;

export const useTabStore = create<TabStore>((set, get) => ({
  tabs: [],
  activeTabId: null,
  pendingCloseTabId: null,

  createTab: async (cwd?: string) => {
    const result = await invoke<PtyCreateResult>('pty_create', { cwd: cwd ?? null });
    const currentTabs = get().tabs;
    const newTab: Tab = {
      id: result.tab_id,
      title: dirName(result.cwd),
      cwd: result.cwd,
      isActive: false,
      hotkey: nextHotkey(currentTabs),
      completed: false,
    };
    set((state) => ({
      tabs: [...state.tabs, newTab],
      activeTabId: result.tab_id,
    }));
    get().saveTabs();
  },

  createClaudeTab: async (cwd?: string) => {
    const result = await invoke<PtyCreateResult>('pty_create', { cwd: cwd ?? null });
    const currentTabs = get().tabs;
    const newTab: Tab = {
      id: result.tab_id,
      title: 'Claude',
      cwd: result.cwd,
      isActive: false,
      hotkey: nextHotkey(currentTabs),
      completed: false,
    };
    set((state) => ({
      tabs: [...state.tabs, newTab],
      activeTabId: result.tab_id,
    }));
    get().saveTabs();
    // Auto-launch Claude CLI after a short delay for PTY to be ready
    setTimeout(() => {
      invoke('pty_write', {
        tabId: result.tab_id,
        data: 'claude --dangerously-skip-permissions\n',
      }).catch(console.error);
    }, 300);
  },

  closeTab: async (id: string) => {
    try {
      await invoke('pty_close', { tabId: id });
    } catch {
      // Session may already be closed
    }
    // Clean up Claude session and dashboard data
    const { useDashboardStore } = await import('./dashboard-store');
    const dashStore = useDashboardStore.getState();
    dashStore.endClaudeSession(id);
    dashStore.removeSession(id);
    // Remove from claudeSessions map entirely
    useDashboardStore.setState((s) => {
      const claudeSessions = new Map(s.claudeSessions);
      claudeSessions.delete(id);
      return { claudeSessions };
    });

    set((state) => {
      const remaining = state.tabs.filter((t) => t.id !== id);
      let newActiveId = state.activeTabId;
      if (state.activeTabId === id) {
        const idx = state.tabs.findIndex((t) => t.id === id);
        newActiveId = remaining[Math.min(idx, remaining.length - 1)]?.id ?? null;
      }
      return { tabs: remaining, activeTabId: newActiveId };
    });
    get().saveTabs();
  },

  // Always confirm — every close goes through dialog
  requestCloseTab: (id: string) => {
    set({ pendingCloseTabId: id });
  },

  confirmCloseTab: () => {
    const { pendingCloseTabId, closeTab } = get();
    if (pendingCloseTabId) {
      closeTab(pendingCloseTabId);
      set({ pendingCloseTabId: null });
    }
  },

  cancelCloseTab: () => {
    set({ pendingCloseTabId: null });
  },

  setActiveTab: (id: string) => {
    // Clear completed indicator when switching to it
    set((state) => ({
      activeTabId: id,
      tabs: state.tabs.map((t) =>
        t.id === id ? { ...t, completed: false } : t
      ),
    }));
  },

  renameTab: (id: string, title: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === id ? { ...t, title: trimmed } : t)),
    }));
    get().saveTabs();
  },

  updateTabTitle: (id: string, title: string) => {
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === id ? { ...t, title } : t)),
    }));
  },

  markCompleted: (id: string) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === id ? { ...t, completed: true } : t
      ),
    }));
  },

  clearCompleted: (id: string) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === id ? { ...t, completed: false } : t
      ),
    }));
  },

  restoreTabs: async () => {
    // Guard: prevent double-mount in React StrictMode (async race)
    if (_restoring || get().tabs.length > 0) return;
    _restoring = true;

    const saved = loadSavedTabs();

    if (saved.length === 0) {
      // First launch — just one tab
      await get().createTab();
      return;
    }

    // Deduplicate by cwd
    const seenCwd = new Set<string>();
    const deduped = saved.filter((s) => {
      if (seenCwd.has(s.cwd)) return false;
      seenCwd.add(s.cwd);
      return true;
    });

    // Assign unique hotkeys
    const usedHotkeys = new Set<string>();
    const fixed = deduped.map((s) => {
      let hotkey = s.hotkey;
      if (!hotkey || usedHotkeys.has(hotkey)) {
        for (const letter of HOTKEY_LETTERS) {
          if (!usedHotkeys.has(letter)) { hotkey = letter; break; }
        }
      }
      usedHotkeys.add(hotkey);
      return { ...s, hotkey };
    });

    for (const s of fixed) {
      try {
        const result = await invoke<PtyCreateResult>('pty_create', { cwd: s.cwd });
        set((state) => ({
          tabs: [...state.tabs, {
            id: result.tab_id,
            title: s.title || dirName(result.cwd),
            cwd: result.cwd,
            isActive: false,
            hotkey: s.hotkey,
            completed: false,
          }],
          activeTabId: state.activeTabId ?? result.tab_id,
        }));
      } catch { /* skip */ }
    }

    if (get().tabs.length === 0) {
      await get().createTab();
    }
    get().saveTabs();
  },

  saveTabs: () => {
    saveTabs(get().tabs);
  },
}));
