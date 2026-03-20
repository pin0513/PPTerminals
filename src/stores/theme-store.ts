import { create } from 'zustand';

export type ThemeMode = 'dark' | 'light';

interface ThemeStore {
  mode: ThemeMode;
  toggle: () => void;
  setMode: (mode: ThemeMode) => void;
}

const STORAGE_KEY = 'ppterminals_theme';

function loadTheme(): ThemeMode {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch { /* ignore */ }
  return 'dark';
}

export const useThemeStore = create<ThemeStore>((set, get) => ({
  mode: loadTheme(),

  toggle: () => {
    const next = get().mode === 'dark' ? 'light' : 'dark';
    localStorage.setItem(STORAGE_KEY, next);
    set({ mode: next });
  },

  setMode: (mode: ThemeMode) => {
    localStorage.setItem(STORAGE_KEY, mode);
    set({ mode });
  },
}));
