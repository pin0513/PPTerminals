import { invoke } from '@tauri-apps/api/core';
import type { Terminal, ILinkProvider, ILink } from '@xterm/xterm';

interface PathCheckResult {
  path: string;
  resolved: string;
  exists: boolean;
  is_file: boolean;
  is_dir: boolean;
}

/**
 * Detects file paths and URLs in terminal output and makes them clickable.
 * Works with Claude Code output, git output, compiler errors, etc.
 *
 * Patterns:
 *   /Users/paul/file.md              absolute path
 *   ~/Documents/spec.md              home path
 *   ./config.json, ../README.md      relative path
 *   src/App.tsx:42:5                  path with line:col (compiler errors)
 *   src/App.tsx(42,5)                 path with (line,col) (MSBuild)
 *   package.json                     bare filename with known extension
 */

// Path patterns — match on clean text (no ANSI codes in xterm buffer)
const PATTERNS: RegExp[] = [
  // Absolute paths: /foo/bar/baz.ts or /foo/bar/baz.ts:10:5
  /(\/[\w.\-@]+(?:\/[\w.\-@]+)+(?:[:\(]\d+[\),:]?\d*\)?)?)/g,
  // Home paths: ~/foo/bar
  /(~\/[\w.\-@]+(?:\/[\w.\-@]+)*(?:[:\(]\d+[\),:]?\d*\)?)?)/g,
  // Relative paths: ./foo or ../foo
  /(\.\.?\/[\w.\-@]+(?:\/[\w.\-@]+)*(?:[:\(]\d+[\),:]?\d*\)?)?)/g,
  // Bare filenames with known extensions
  /(?:^|[\s'"(])(\w[\w.\-]*\.(?:md|txt|json|ya?ml|toml|rs|tsx?|jsx?|css|html?|xml|csv|log|conf|cfg|ini|sh|bash|zsh|py|rb|go|java|[ch](?:pp)?|lock|env|gitignore|Dockerfile|Makefile))(?=[\s'")\]:,]|$)/g,
];

export class FileLinkProvider implements ILinkProvider {
  private cwd: string;
  private onFileClick: (resolvedPath: string) => void;
  private onDirClick: (dirPath: string) => void;
  private terminal: Terminal;
  private pathCache = new Map<string, PathCheckResult>();

  constructor(
    terminal: Terminal,
    cwd: string,
    onFileClick: (resolvedPath: string) => void,
    onDirClick: (dirPath: string) => void
  ) {
    this.terminal = terminal;
    this.cwd = cwd;
    this.onFileClick = onFileClick;
    this.onDirClick = onDirClick;
  }

  setCwd(cwd: string) {
    this.cwd = cwd;
    this.pathCache.clear();
  }

  provideLinks(
    bufferLineNumber: number,
    callback: (links: ILink[] | undefined) => void
  ): void {
    const buffer = this.terminal.buffer.active;
    const line = buffer.getLine(bufferLineNumber - 1);
    if (!line) { callback(undefined); return; }

    // Read line text from xterm buffer (already stripped of ANSI)
    let lineText = '';
    for (let i = 0; i < line.length; i++) {
      lineText += line.getCell(i)?.getChars() || ' ';
    }
    // Trim trailing spaces but preserve leading (for indented output)
    lineText = lineText.replace(/\s+$/, '');

    if (lineText.length < 3) { callback(undefined); return; }

    const links: ILink[] = [];
    const seen = new Set<string>(); // avoid duplicate links

    for (const pattern of PATTERNS) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(lineText)) !== null) {
        const rawPath = match[1];
        if (!rawPath || rawPath.length < 2) continue;

        // Strip :line:col suffix for path resolution
        const cleanPath = rawPath.replace(/[:\(]\d+[\),:]?\d*\)?$/, '');
        if (seen.has(cleanPath)) continue;
        seen.add(cleanPath);

        // Find exact position in the line text
        const startIdx = match.index + (match[0].length - rawPath.length);

        links.push({
          range: {
            start: { x: startIdx + 1, y: bufferLineNumber },
            end: { x: startIdx + rawPath.length + 1, y: bufferLineNumber },
          },
          text: rawPath,
          activate: (_event, text) => this.handleActivate(text),
          hover: () => {},
          dispose: () => {},
        });
      }
    }

    callback(links.length > 0 ? links : undefined);
  }

  private async handleActivate(rawPath: string): Promise<void> {
    // Strip :line:col
    const cleanPath = rawPath.replace(/[:\(]\d+[\),:]?\d*\)?$/, '');

    try {
      const result = await this.checkPath(cleanPath);
      if (result.exists && result.is_file) {
        this.onFileClick(result.resolved);
      } else if (result.exists && result.is_dir) {
        this.onDirClick(result.resolved);
      }
    } catch {
      // Not a real path, ignore
    }
  }

  private async checkPath(pathStr: string): Promise<PathCheckResult> {
    const cacheKey = `${this.cwd}:${pathStr}`;
    const cached = this.pathCache.get(cacheKey);
    if (cached) return cached;

    const result = await invoke<PathCheckResult>('fs_check_path', {
      path: pathStr,
      cwd: this.cwd,
    });

    if (this.pathCache.size > 500) {
      const firstKey = this.pathCache.keys().next().value;
      if (firstKey) this.pathCache.delete(firstKey);
    }
    this.pathCache.set(cacheKey, result);
    return result;
  }
}

export function registerFileLinkProvider(
  terminal: Terminal,
  cwd: string,
  onFileClick: (resolvedPath: string) => void,
  onDirClick?: (dirPath: string) => void
): { provider: FileLinkProvider; dispose: () => void } {
  const provider = new FileLinkProvider(
    terminal,
    cwd,
    onFileClick,
    onDirClick || (() => {})
  );

  const disposable = terminal.registerLinkProvider(provider);

  return { provider, dispose: () => disposable.dispose() };
}
