import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';

export interface DirEntry {
  name: string;
  path: string;
  is_dir: boolean;
  is_hidden: boolean;
  extension: string | null;
  size: number | null;
}

interface TreeNode extends DirEntry {
  children?: TreeNode[];
  isExpanded: boolean;
  isLoading: boolean;
  depth: number;
}

interface ExplorerStore {
  rootPath: string | null;
  nodes: Map<string, TreeNode>;
  rootEntries: string[];
  showHidden: boolean;
  isOpen: boolean;
  width: number;

  setRootPath: (path: string) => Promise<void>;
  toggleDir: (path: string) => Promise<void>;
  toggleHidden: () => void;
  toggleOpen: () => void;
  setWidth: (width: number) => void;
  refreshDir: (path: string) => Promise<void>;
}

export const useExplorerStore = create<ExplorerStore>((set, get) => ({
  rootPath: null,
  nodes: new Map(),
  rootEntries: [],
  showHidden: false,
  isOpen: true,
  width: 260,

  setRootPath: async (path: string) => {
    set({ rootPath: path });
    const entries = await invoke<DirEntry[]>('fs_list_dir', { path });
    const nodes = new Map(get().nodes);
    const rootEntries: string[] = [];

    for (const entry of entries) {
      rootEntries.push(entry.path);
      nodes.set(entry.path, {
        ...entry,
        isExpanded: false,
        isLoading: false,
        depth: 0,
      });
    }

    set({ nodes, rootEntries });
  },

  toggleDir: async (path: string) => {
    const nodes = new Map(get().nodes);
    const node = nodes.get(path);
    if (!node || !node.is_dir) return;

    if (node.isExpanded) {
      // Collapse
      nodes.set(path, { ...node, isExpanded: false });
      set({ nodes });
      return;
    }

    // Expand - load children
    nodes.set(path, { ...node, isLoading: true, isExpanded: true });
    set({ nodes });

    try {
      const entries = await invoke<DirEntry[]>('fs_list_dir', { path });
      const freshNodes = new Map(get().nodes);
      const parentNode = freshNodes.get(path);
      if (!parentNode) return;

      const childPaths: string[] = [];
      for (const entry of entries) {
        childPaths.push(entry.path);
        freshNodes.set(entry.path, {
          ...entry,
          isExpanded: false,
          isLoading: false,
          depth: parentNode.depth + 1,
        });
      }

      freshNodes.set(path, {
        ...parentNode,
        isExpanded: true,
        isLoading: false,
        children: childPaths.map((p) => freshNodes.get(p)!),
      });
      set({ nodes: freshNodes });
    } catch {
      const fallbackNodes = new Map(get().nodes);
      const n = fallbackNodes.get(path);
      if (n) {
        fallbackNodes.set(path, { ...n, isLoading: false, isExpanded: false });
        set({ nodes: fallbackNodes });
      }
    }
  },

  refreshDir: async (path: string) => {
    const nodes = new Map(get().nodes);
    const node = nodes.get(path);
    if (node) {
      nodes.set(path, { ...node, isExpanded: false });
      set({ nodes });
    }
    await get().toggleDir(path);
  },

  toggleHidden: () => set((s) => ({ showHidden: !s.showHidden })),
  toggleOpen: () => set((s) => ({ isOpen: !s.isOpen })),
  setWidth: (width: number) => set({ width: Math.max(180, Math.min(600, width)) }),
}));
