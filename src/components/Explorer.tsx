import { useEffect, useCallback, useState, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useExplorerStore, type DirEntry } from '../stores/explorer-store';
import { useFileViewerStore } from '../stores/file-viewer-store';
import { useTabStore } from '../stores/tab-store';
import { FileIcon } from './FileIcon';
import './Explorer.css';

export function Explorer() {
  const {
    rootPath,
    nodes,
    rootEntries,
    showHidden,
    isOpen,
    setRootPath,
    toggleDir,
    toggleHidden,
    refreshDir,
  } = useExplorerStore();

  const [isCreating, setIsCreating] = useState<'file' | 'folder' | null>(null);
  const [newName, setNewName] = useState('');
  const [createParent, setCreateParent] = useState<string | null>(null);
  const createInputRef = useRef<HTMLInputElement>(null);

  // Initialize with home dir
  useEffect(() => {
    if (!rootPath) {
      invoke<string>('fs_get_home_dir').then((home) => {
        setRootPath(home);
      });
    }
  }, [rootPath, setRootPath]);

  const openFileViewer = useFileViewerStore((s) => s.openFile);

  const handleFileClick = useCallback(
    (entry: DirEntry) => {
      if (entry.is_dir) return;
      openFileViewer(entry.path);
    },
    [openFileViewer]
  );

  // Navigate explorer to a directory
  const handleNavigateToDir = useCallback(
    (dirPath: string) => {
      setRootPath(dirPath);
    },
    [setRootPath]
  );

  // New file / folder creation
  const handleCreateStart = useCallback(
    (type: 'file' | 'folder', parentPath: string) => {
      setIsCreating(type);
      setCreateParent(parentPath);
      setNewName('');
      setTimeout(() => createInputRef.current?.focus(), 50);
    },
    []
  );

  const handleCreateConfirm = useCallback(async () => {
    if (!newName.trim() || !createParent) {
      setIsCreating(null);
      return;
    }
    const fullPath = `${createParent}/${newName.trim()}`;
    try {
      if (isCreating === 'folder') {
        await invoke('fs_create_dir', { path: fullPath });
      } else {
        await invoke('fs_create_file', { path: fullPath });
      }
      await refreshDir(createParent);
    } catch (err) {
      console.error('Failed to create:', err);
    }
    setIsCreating(null);
    setNewName('');
  }, [newName, createParent, isCreating, refreshDir]);

  const handleCreateKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') handleCreateConfirm();
      if (e.key === 'Escape') setIsCreating(null);
    },
    [handleCreateConfirm]
  );

  if (!isOpen) return null;

  const rootName = rootPath?.split('/').pop() || rootPath || '';

  return (
    <div className="explorer">
      <div className="explorer-toolbar">
        <div className="explorer-toolbar-icons">
          <button className="explorer-icon-btn active" title="Explorer">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M1.5 1h5l1 1H14.5l.5.5v4h-1V3H7.71l-1-1H2v10h4v1H1.5l-.5-.5v-11l.5-.5z" />
              <path d="M7.5 7h8l.5.5v6l-.5.5h-8l-.5-.5v-6l.5-.5zm.5 1v1h2V8H8zm3 0v1h2V8h-2zm-3 2v1h2v-1H8zm3 0v1h2v-1h-2zm-3 2v1h2v-1H8zm3 0v1h2v-1h-2z" />
            </svg>
          </button>
          <button className="explorer-icon-btn" title="Search (coming soon)">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M15.25 0a.75.75 0 01.75.75V15.25a.75.75 0 01-1.5 0V.75a.75.75 0 01.75-.75zM11.5 2.5a.5.5 0 00-.5.5v10a.5.5 0 001 0V3a.5.5 0 00-.5-.5zm-4 3a.5.5 0 00-.5.5v4a.5.5 0 001 0V6a.5.5 0 00-.5-.5zm-4 2a.5.5 0 00-.5.5v2a.5.5 0 001 0V8a.5.5 0 00-.5-.5z" />
            </svg>
          </button>
        </div>
        <div className="explorer-toolbar-right">
          {rootPath && (
            <>
              <button
                className="explorer-icon-btn"
                title="New file"
                onClick={() => handleCreateStart('file', rootPath)}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M9.5 1.1l3.4 3.5.1.4v2h-1V6H8.5L8 5.5V2H3.5l-.5.5v11l.5.5H7v1H3.5l-1.5-1.5v-11l1.5-1.5h5.7l.3.1zM9 2v3h2.9L9 2zm4 12h-1v-3H9v-1h3V7h1v3h3v1h-3v3z" />
                </svg>
              </button>
              <button
                className="explorer-icon-btn"
                title="New folder"
                onClick={() => handleCreateStart('folder', rootPath)}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M14 4H9.618l-1-2H2a1 1 0 00-1 1v10a1 1 0 001 1h12a1 1 0 001-1V5a1 1 0 00-1-1zm-4.5 7H8v1.5a.5.5 0 01-1 0V11H5.5a.5.5 0 010-1H7V8.5a.5.5 0 011 0V10h1.5a.5.5 0 010 1z" />
                </svg>
              </button>
            </>
          )}
          <button
            className="explorer-icon-btn close-btn"
            title="Close sidebar"
            onClick={useExplorerStore.getState().toggleOpen}
          >
            ×
          </button>
        </div>
      </div>

      <div className="explorer-header">
        <span className="explorer-title">{rootName}</span>
        <div className="explorer-header-actions">
          {rootPath && (
            <button
              className="explorer-icon-btn small"
              title="Go to parent directory"
              onClick={() => {
                const parent = rootPath.substring(0, rootPath.lastIndexOf('/')) || '/';
                handleNavigateToDir(parent);
              }}
            >
              ↑
            </button>
          )}
          <button
            className={`explorer-icon-btn small ${showHidden ? 'active' : ''}`}
            onClick={toggleHidden}
            title={showHidden ? 'Hide hidden files' : 'Show hidden files'}
          >
            ⊙
          </button>
        </div>
      </div>

      {/* New file/folder inline input */}
      {isCreating && createParent === rootPath && (
        <div className="tree-item-create" style={{ paddingLeft: '12px' }}>
          <FileIcon
            name={newName || (isCreating === 'folder' ? 'folder' : 'file')}
            isDir={isCreating === 'folder'}
            extension={null}
          />
          <input
            ref={createInputRef}
            className="tree-create-input"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={handleCreateKeyDown}
            onBlur={handleCreateConfirm}
            placeholder={isCreating === 'folder' ? 'folder name' : 'file name'}
          />
        </div>
      )}

      <div className="explorer-tree">
        {rootEntries.map((entryPath) => {
          const node = nodes.get(entryPath);
          if (!node) return null;
          if (!showHidden && node.is_hidden) return null;
          return (
            <TreeItem
              key={node.path}
              path={node.path}
              nodes={nodes}
              showHidden={showHidden}
              onToggle={toggleDir}
              onFileClick={handleFileClick}
              onNavigate={handleNavigateToDir}
              onCreateStart={handleCreateStart}
              isCreating={isCreating}
              createParent={createParent}
              newName={newName}
              setNewName={setNewName}
              createInputRef={createInputRef}
              handleCreateKeyDown={handleCreateKeyDown}
              handleCreateConfirm={handleCreateConfirm}
            />
          );
        })}
      </div>

      {/* Explorer footer: show current root path */}
      {rootPath && (
        <div className="explorer-footer">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" style={{ flexShrink: 0 }}>
            <path d="M1.5 1h5l1 1H14.5l.5.5v11l-.5.5h-13l-.5-.5v-11l.5-.5z" />
          </svg>
          <span className="explorer-footer-path" title={rootPath}>{rootPath}</span>
        </div>
      )}
    </div>
  );
}

interface TreeItemProps {
  path: string;
  nodes: Map<string, any>;
  showHidden: boolean;
  onToggle: (path: string) => void;
  onFileClick: (entry: DirEntry) => void;
  onNavigate: (dirPath: string) => void;
  onCreateStart: (type: 'file' | 'folder', parentPath: string) => void;
  isCreating: 'file' | 'folder' | null;
  createParent: string | null;
  newName: string;
  setNewName: (name: string) => void;
  createInputRef: React.RefObject<HTMLInputElement | null>;
  handleCreateKeyDown: (e: React.KeyboardEvent) => void;
  handleCreateConfirm: () => void;
}

function TreeItem({
  path,
  nodes,
  showHidden,
  onToggle,
  onFileClick,
  onNavigate,
  onCreateStart,
  isCreating,
  createParent,
  newName,
  setNewName,
  createInputRef,
  handleCreateKeyDown,
  handleCreateConfirm,
}: TreeItemProps) {
  const node = nodes.get(path);
  if (!node) return null;

  const [showContextMenu, setShowContextMenu] = useState(false);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });

  const handleClick = () => {
    if (node.is_dir) {
      onToggle(node.path);
    } else {
      onFileClick(node);
    }
  };

  // Drag start — set path as drag data
  const handleDragStart = (e: React.DragEvent) => {
    const pathStr = node.path.includes(' ') ? `"${node.path}"` : node.path;
    e.dataTransfer.setData('text/plain', pathStr);
    e.dataTransfer.setData('application/x-ppterminals-path', node.path);
    e.dataTransfer.effectAllowed = 'copy';
  };

  // Right-click context menu
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setShowContextMenu(true);
    setMenuPos({ x: e.clientX, y: e.clientY });
  };

  const closeMenu = () => setShowContextMenu(false);

  const handleCopyPath = () => {
    navigator.clipboard.writeText(node.path);
    closeMenu();
  };

  const handleOpenInTerminal = () => {
    const dirPath = node.is_dir ? node.path : node.path.substring(0, node.path.lastIndexOf('/'));
    // Write cd command to active terminal
    const activeTabId = useTabStore.getState().activeTabId;
    if (activeTabId) {
      invoke('pty_write', { tabId: activeTabId, data: `cd "${dirPath}"\n` }).catch(console.error);
    }
    closeMenu();
  };

  const handleNavigateHere = () => {
    if (node.is_dir) {
      onNavigate(node.path);
    } else {
      const dirPath = node.path.substring(0, node.path.lastIndexOf('/'));
      onNavigate(dirPath);
    }
    closeMenu();
  };

  const handleNewFileHere = () => {
    const parentDir = node.is_dir ? node.path : node.path.substring(0, node.path.lastIndexOf('/'));
    if (node.is_dir && !node.isExpanded) {
      onToggle(node.path);
    }
    onCreateStart('file', parentDir);
    closeMenu();
  };

  const handleOpenClaudeHere = () => {
    const dirPath = node.is_dir ? node.path : node.path.substring(0, node.path.lastIndexOf('/'));
    useTabStore.getState().createClaudeTab(dirPath);
    closeMenu();
  };

  const handleNewFolderHere = () => {
    const parentDir = node.is_dir ? node.path : node.path.substring(0, node.path.lastIndexOf('/'));
    if (node.is_dir && !node.isExpanded) {
      onToggle(node.path);
    }
    onCreateStart('folder', parentDir);
    closeMenu();
  };

  const childPaths = node.children
    ? (node.children as any[])
        .filter((c: any) => showHidden || !c.is_hidden)
        .map((c: any) => c.path)
    : [];

  return (
    <>
      <div
        className={`tree-item ${node.is_dir ? 'dir' : 'file'}`}
        style={{ paddingLeft: `${12 + node.depth * 16}px` }}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        title={node.path}
        draggable
        onDragStart={handleDragStart}
      >
        {node.is_dir && (
          <span className={`tree-chevron ${node.isExpanded ? 'expanded' : ''}`}>
            ›
          </span>
        )}
        {!node.is_dir && <span className="tree-chevron-spacer" />}
        <FileIcon name={node.name} isDir={node.is_dir} extension={node.extension} />
        <span className={`tree-name ${node.is_hidden ? 'hidden-entry' : ''}`}>
          {node.name}
        </span>
      </div>

      {/* Inline create input for this directory */}
      {node.is_dir && node.isExpanded && isCreating && createParent === node.path && (
        <div
          className="tree-item-create"
          style={{ paddingLeft: `${12 + (node.depth + 1) * 16}px` }}
        >
          <FileIcon
            name={newName || (isCreating === 'folder' ? 'folder' : 'file')}
            isDir={isCreating === 'folder'}
            extension={null}
          />
          <input
            ref={createInputRef}
            className="tree-create-input"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={handleCreateKeyDown}
            onBlur={handleCreateConfirm}
            placeholder={isCreating === 'folder' ? 'folder name' : 'file name'}
          />
        </div>
      )}

      {node.is_dir &&
        node.isExpanded &&
        childPaths.map((childPath: string) => (
          <TreeItem
            key={childPath}
            path={childPath}
            nodes={nodes}
            showHidden={showHidden}
            onToggle={onToggle}
            onFileClick={onFileClick}
            onNavigate={onNavigate}
            onCreateStart={onCreateStart}
            isCreating={isCreating}
            createParent={createParent}
            newName={newName}
            setNewName={setNewName}
            createInputRef={createInputRef}
            handleCreateKeyDown={handleCreateKeyDown}
            handleCreateConfirm={handleCreateConfirm}
          />
        ))}

      {/* Context Menu */}
      {showContextMenu && (
        <ContextMenu
          x={menuPos.x}
          y={menuPos.y}
          isDir={node.is_dir}
          onClose={closeMenu}
          onCopyPath={handleCopyPath}
          onOpenInTerminal={handleOpenInTerminal}
          onNavigateHere={handleNavigateHere}
          onNewFile={handleNewFileHere}
          onNewFolder={handleNewFolderHere}
          onOpenClaude={handleOpenClaudeHere}
        />
      )}
    </>
  );
}

/* ─── Context Menu ─── */

interface ContextMenuProps {
  x: number;
  y: number;
  isDir: boolean;
  onClose: () => void;
  onCopyPath: () => void;
  onOpenInTerminal: () => void;
  onNavigateHere: () => void;
  onNewFile: () => void;
  onNewFolder: () => void;
  onOpenClaude: () => void;
}

function ContextMenu({
  x,
  y,
  isDir,
  onClose,
  onCopyPath,
  onOpenInTerminal,
  onNavigateHere,
  onNewFile,
  onNewFolder,
  onOpenClaude,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="explorer-context-menu"
      style={{ top: y, left: x }}
    >
      <button className="context-claude" onClick={onOpenClaude}>
        Open Claude Here
      </button>
      <div className="context-menu-divider" />
      <button onClick={onCopyPath}>Copy Path</button>
      <button onClick={onOpenInTerminal}>Open in Terminal</button>
      {isDir && <button onClick={onNavigateHere}>Navigate Here</button>}
      {!isDir && <button onClick={onNavigateHere}>Go to Directory</button>}
      <div className="context-menu-divider" />
      <button onClick={onNewFile}>New File</button>
      <button onClick={onNewFolder}>New Folder</button>
    </div>
  );
}
