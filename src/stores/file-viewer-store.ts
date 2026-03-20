import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';

export type ViewMode = 'rendered' | 'raw' | 'editor';

export interface FileInfo {
  path: string;
  name: string;
  extension: string | null;
  content: string;
  size: number;
  is_binary: boolean;
}

interface FileViewerStore {
  isOpen: boolean;
  file: FileInfo | null;
  viewMode: ViewMode;
  isLoading: boolean;
  error: string | null;
  editedContent: string | null;
  isDirty: boolean;
  width: number;

  openFile: (path: string) => Promise<void>;
  close: () => void;
  setViewMode: (mode: ViewMode) => void;
  setEditedContent: (content: string) => void;
  saveFile: () => Promise<void>;
  setWidth: (width: number) => void;
}

const RENDERABLE_EXTENSIONS = new Set(['md', 'markdown', 'mdx', 'html', 'htm']);

export function isRenderable(ext: string | null): boolean {
  return ext !== null && RENDERABLE_EXTENSIONS.has(ext.toLowerCase());
}

export const useFileViewerStore = create<FileViewerStore>((set, get) => ({
  isOpen: false,
  file: null,
  viewMode: 'rendered',
  isLoading: false,
  error: null,
  editedContent: null,
  isDirty: false,
  width: 480,

  openFile: async (path: string) => {
    set({ isOpen: true, isLoading: true, error: null, editedContent: null, isDirty: false });
    try {
      const file = await invoke<FileInfo>('fs_read_file', { path });
      const defaultMode = isRenderable(file.extension) ? 'rendered' : 'raw';
      set({ file, isLoading: false, viewMode: defaultMode });
    } catch (err) {
      set({ error: String(err), isLoading: false });
    }
  },

  close: () => {
    set({ isOpen: false, file: null, error: null, editedContent: null, isDirty: false });
  },

  setViewMode: (mode: ViewMode) => {
    const { file, editedContent } = get();
    if (mode === 'editor' && file && editedContent === null) {
      set({ viewMode: mode, editedContent: file.content });
    } else {
      set({ viewMode: mode });
    }
  },

  setEditedContent: (content: string) => {
    set({ editedContent: content, isDirty: true });
  },

  saveFile: async () => {
    const { file, editedContent } = get();
    if (!file || editedContent === null) return;
    try {
      await invoke('fs_write_file', { path: file.path, content: editedContent });
      set({
        file: { ...file, content: editedContent },
        isDirty: false,
      });
    } catch (err) {
      set({ error: String(err) });
    }
  },

  setWidth: (width: number) => set({ width: Math.max(320, Math.min(800, width)) }),
}));
