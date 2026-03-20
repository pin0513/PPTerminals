import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useFileViewerStore, isRenderable } from '../stores/file-viewer-store';
import type { ViewMode } from '../stores/file-viewer-store';
import './FileViewer.css';

export function FileViewer() {
  const {
    isOpen,
    file,
    viewMode,
    isLoading,
    error,
    editedContent,
    isDirty,
    width,
    close,
    setViewMode,
    setEditedContent,
    saveFile,
    setWidth,
  } = useFileViewerStore();

  const [isDragging, setIsDragging] = useState(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);

  // Resize drag
  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDragging(true);
      dragStartX.current = e.clientX;
      dragStartWidth.current = width;
    },
    [width]
  );

  useEffect(() => {
    if (!isDragging) return;
    const handleMouseMove = (e: MouseEvent) => {
      const delta = dragStartX.current - e.clientX;
      setWidth(dragStartWidth.current + delta);
    };
    const handleMouseUp = () => setIsDragging(false);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, setWidth]);

  // Keyboard shortcut: Cmd/Ctrl+S to save in editor mode
  useEffect(() => {
    if (!isOpen || viewMode !== 'editor') return;
    const isMac = navigator.platform.toUpperCase().includes('MAC');
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e[isMac ? 'metaKey' : 'ctrlKey'] && e.key === 's') {
        e.preventDefault();
        saveFile();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, viewMode, saveFile]);

  // Close with Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, close]);

  if (!isOpen) return null;

  const canRender = file && isRenderable(file.extension);
  const dirPath = file?.path.substring(0, file.path.lastIndexOf('/')) || '';

  const handleCopyPath = useCallback(() => {
    if (file) navigator.clipboard.writeText(file.path);
  }, [file]);

  const handleOpenExternal = useCallback(() => {
    if (file) invoke('fs_open_file', { path: file.path }).catch(console.error);
  }, [file]);

  return (
    <>
      <div
        className={`fileviewer-resize-handle ${isDragging ? 'dragging' : ''}`}
        onMouseDown={handleResizeMouseDown}
      />
      <div className="fileviewer" style={{ width }}>
        {/* Header */}
        <div className="fileviewer-header">
          <div className="fileviewer-title-row">
            <span className="fileviewer-filename">{file?.name || 'Loading...'}</span>
            <div className="fileviewer-actions">
              <ViewModeToggle
                viewMode={viewMode}
                canRender={!!canRender}
                onSetMode={setViewMode}
              />
              <button className="fileviewer-icon-btn" title="More" onClick={() => {}}>
                <MoreIcon />
              </button>
              <button className="fileviewer-icon-btn" title="Close" onClick={close}>
                <CloseIcon />
              </button>
            </div>
          </div>
          {file && (
            <div className="fileviewer-subheader">
              <div className="fileviewer-path" title={file.path}>{dirPath}</div>
              <div className="fileviewer-path-actions">
                <button
                  className="fileviewer-icon-btn small"
                  title="Copy path"
                  onClick={handleCopyPath}
                >
                  <CopyIcon />
                </button>
                <button
                  className="fileviewer-icon-btn small"
                  title="Open in default app"
                  onClick={handleOpenExternal}
                >
                  <ExternalIcon />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="fileviewer-content">
          {isLoading && <div className="fileviewer-loading">Loading...</div>}
          {error && <div className="fileviewer-error">{error}</div>}
          {file && file.is_binary && (
            <div className="fileviewer-binary">Binary file — cannot preview</div>
          )}
          {file && !file.is_binary && !isLoading && !error && (
            <>
              {viewMode === 'rendered' && canRender && (
                <RenderedView content={file.content} extension={file.extension} />
              )}
              {viewMode === 'raw' && <RawView content={file.content} />}
              {viewMode === 'editor' && (
                <EditorView
                  content={editedContent ?? file.content}
                  onChange={setEditedContent}
                  isDirty={isDirty}
                  onSave={saveFile}
                />
              )}
              {/* If not renderable and mode was rendered, fallback to raw */}
              {viewMode === 'rendered' && !canRender && <RawView content={file.content} />}
            </>
          )}
        </div>

        {/* Footer */}
        {file && (
          <div className="fileviewer-footer">
            <span>{formatFileSize(file.size)}</span>
            <span>{file.extension?.toUpperCase() || 'TEXT'}</span>
            {isDirty && <span className="fileviewer-dirty">Modified</span>}
          </div>
        )}
      </div>
    </>
  );
}

/* ─── Sub-components ─── */

function ViewModeToggle({
  viewMode,
  canRender,
  onSetMode,
}: {
  viewMode: ViewMode;
  canRender: boolean;
  onSetMode: (m: ViewMode) => void;
}) {
  return (
    <div className="fileviewer-mode-toggle">
      {canRender && (
        <button
          className={`mode-btn ${viewMode === 'rendered' ? 'active' : ''}`}
          onClick={() => onSetMode('rendered')}
        >
          Rendered
        </button>
      )}
      <button
        className={`mode-btn ${viewMode === 'raw' ? 'active' : ''}`}
        onClick={() => onSetMode('raw')}
      >
        Raw
      </button>
      <button
        className={`mode-btn ${viewMode === 'editor' ? 'active' : ''}`}
        onClick={() => onSetMode('editor')}
      >
        Editor
      </button>
    </div>
  );
}

function RenderedView({ content, extension }: { content: string; extension: string | null }) {
  const ext = extension?.toLowerCase();
  if (ext === 'html' || ext === 'htm') {
    return (
      <div className="fileviewer-rendered">
        <iframe
          className="fileviewer-html-iframe"
          srcDoc={content}
          sandbox="allow-same-origin"
          title="HTML Preview"
        />
      </div>
    );
  }

  // Markdown
  return (
    <div className="fileviewer-rendered fileviewer-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}

function RawView({ content }: { content: string }) {
  const lines = content.split('\n');
  return (
    <div className="fileviewer-raw">
      <table className="fileviewer-raw-table">
        <tbody>
          {lines.map((line, i) => (
            <tr key={i}>
              <td className="line-number">{i + 1}</td>
              <td className="line-content">
                <pre>{line}</pre>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EditorView({
  content,
  onChange,
  isDirty,
  onSave,
}: {
  content: string;
  onChange: (c: string) => void;
  isDirty: boolean;
  onSave: () => void;
}) {
  const isMac = navigator.platform.toUpperCase().includes('MAC');
  return (
    <div className="fileviewer-editor">
      <textarea
        className="fileviewer-textarea"
        value={content}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
      />
      {isDirty && (
        <div className="fileviewer-editor-bar">
          <span className="editor-hint">{isMac ? '⌘S' : 'Ctrl+S'} to save</span>
          <button className="editor-save-btn" onClick={onSave}>
            Save
          </button>
        </div>
      )}
    </div>
  );
}

/* ─── Icons ─── */

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
      <path d="M1.707.293A1 1 0 00.293 1.707L5.586 7 .293 12.293a1 1 0 101.414 1.414L7 8.414l5.293 5.293a1 1 0 001.414-1.414L8.414 7l5.293-5.293A1 1 0 0012.293.293L7 5.586 1.707.293z" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <circle cx="8" cy="3" r="1.5" />
      <circle cx="8" cy="8" r="1.5" />
      <circle cx="8" cy="13" r="1.5" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 010 1.5h-1.5a.25.25 0 00-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 00.25-.25v-1.5a.75.75 0 011.5 0v1.5A1.75 1.75 0 019.25 16h-7.5A1.75 1.75 0 010 14.25v-7.5z" />
      <path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0114.25 11h-7.5A1.75 1.75 0 015 9.25v-7.5zm1.75-.25a.25.25 0 00-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 00.25-.25v-7.5a.25.25 0 00-.25-.25h-7.5z" />
    </svg>
  );
}

function ExternalIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <path d="M3.75 2A1.75 1.75 0 002 3.75v8.5c0 .966.784 1.75 1.75 1.75h8.5A1.75 1.75 0 0014 12.25v-3.5a.75.75 0 00-1.5 0v3.5a.25.25 0 01-.25.25h-8.5a.25.25 0 01-.25-.25v-8.5a.25.25 0 01.25-.25h3.5a.75.75 0 000-1.5h-3.5z" />
      <path d="M10 1a.75.75 0 000 1.5h2.44L7.72 7.22a.75.75 0 001.06 1.06l4.72-4.72V6a.75.75 0 001.5 0V1.75a.75.75 0 00-.75-.75H10z" />
    </svg>
  );
}

/* ─── Helpers ─── */

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
