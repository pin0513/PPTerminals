import { useRef, useCallback, useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { Terminal } from '@xterm/xterm';
import { useTabStore } from '../stores/tab-store';

export interface Completion {
  name: string;
  description: string;
  kind: 'flag' | 'option' | 'subcommand' | 'command';
}

interface HelpResult {
  command: string;
  completions: Completion[];
  raw: string;
}

export interface AutocompleteState {
  suggestions: Completion[];
  selectedIndex: number;
  visible: boolean;
  cursorX: number;
  cursorY: number;
}

const EMPTY: AutocompleteState = {
  suggestions: [],
  selectedIndex: 0,
  visible: false,
  cursorX: 0,
  cursorY: 0,
};

// ─── Caches ───
const helpCache = new Map<string, Completion[]>();
let pathCommandsCache: string[] | null = null;

async function fetchHelp(cmd: string, cwd: string): Promise<Completion[]> {
  const key = cmd.trim();
  if (helpCache.has(key)) return helpCache.get(key)!;
  try {
    const r = await invoke<HelpResult>('cmd_get_help', { command: key, cwd });
    helpCache.set(key, r.completions);
    return r.completions;
  } catch {
    helpCache.set(key, []);
    return [];
  }
}

async function getPathCommands(): Promise<string[]> {
  if (pathCommandsCache) return pathCommandsCache;
  try {
    pathCommandsCache = await invoke<string[]>('cmd_list_path_commands');
  } catch {
    pathCommandsCache = [];
  }
  return pathCommandsCache;
}

/**
 * Read the current input from xterm's buffer.
 * Only triggers on real shell prompts, not TUI prompts like Claude Code's `>`.
 *
 * Shell prompt patterns we recognize:
 *   user@host:~/dir$       (bash)
 *   user@host ~/dir %      (zsh)
 *   ~/dir ❯                (starship)
 *   ➜  dir                 (oh-my-zsh)
 *
 * NOT recognized (intentionally):
 *   >                      (Claude Code input)
 *   >>>                    (Python REPL)
 *   irb>                   (Ruby REPL)
 */

// Shell prompt: find prompt char ($, %, ❯, ➜) that has shell context before it
// The prompt char is NOT at end of line — user's input follows it
const SHELL_PROMPT_CHAR_RE = /[$%❯➜#]\s+/g;
const SHELL_CONTEXT_RE = /[@~\/]/; // must have @ or ~ or / somewhere before prompt char

function readCurrentInput(term: Terminal): string {
  const buf = term.buffer.active;
  const y = buf.cursorY + buf.viewportY;
  const line = buf.getLine(y);
  if (!line) return '';

  let text = '';
  for (let x = 0; x < line.length; x++) {
    text += line.getCell(x)?.getChars() || '';
  }
  text = text.trimEnd();
  if (!text) return '';

  // Find the LAST prompt char that has shell context before it
  // e.g. "paul_huang@A2 ~ % claude --da" → finds "%" → returns "claude --da"
  SHELL_PROMPT_CHAR_RE.lastIndex = 0;
  let bestMatch: { index: number; length: number } | null = null;

  let m: RegExpExecArray | null;
  while ((m = SHELL_PROMPT_CHAR_RE.exec(text)) !== null) {
    const prefix = text.slice(0, m.index);
    if (SHELL_CONTEXT_RE.test(prefix)) {
      bestMatch = { index: m.index, length: m[0].length };
    }
  }

  if (!bestMatch) return '';

  const input = text.slice(bestMatch.index + bestMatch.length);
  return input;
}

export function useAutocomplete(tabId: string) {
  const [state, setState] = useState<AutocompleteState>(EMPTY);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const completionsRef = useRef<Completion[]>([]);
  const cwdRef = useRef('/');
  const termRef = useRef<Terminal | null>(null);

  // Pre-load PATH commands
  useEffect(() => { getPathCommands(); }, []);

  const setTerminal = useCallback((t: Terminal | null) => { termRef.current = t; }, []);

  const dismiss = useCallback(() => setState(EMPTY), []);

  const resetBuffer = useCallback(() => {
    completionsRef.current = [];
    if (timerRef.current) clearTimeout(timerRef.current);
    dismiss();
  }, [dismiss]);

  const showFor = useCallback(async (input: string) => {
    const trimmed = input.trim();
    const parts = trimmed.split(/\s+/);
    if (!parts[0]) { dismiss(); return; }

    let filtered: Completion[];

    if (parts.length === 1 && !input.endsWith(' ')) {
      // ─── Base command from PATH ───
      const partial = parts[0].toLowerCase();
      if (partial.length < 2) { dismiss(); return; }
      const cmds = await getPathCommands();
      filtered = cmds
        .filter((c) => c.toLowerCase().startsWith(partial) && c.toLowerCase() !== partial)
        .slice(0, 12)
        .map((c) => ({ name: c, description: '', kind: 'command' as const }));
    } else {
      // ─── Flags / subcommands ───
      // Fetch help if we don't have completions yet for this command
      if (completionsRef.current.length === 0) {
        let cmd = parts[0];
        if (parts.length >= 2 && !parts[1].startsWith('-')) {
          cmd = `${parts[0]} ${parts[1]}`;
        }
        let results = await fetchHelp(cmd, cwdRef.current);
        if (results.length === 0 && cmd !== parts[0]) {
          results = await fetchHelp(parts[0], cwdRef.current);
        }
        completionsRef.current = results;
      }

      const lastWord = parts[parts.length - 1] || '';
      if (lastWord.startsWith('-')) {
        filtered = completionsRef.current.filter(
          (c) => (c.kind === 'flag' || c.kind === 'option') &&
                 c.name.startsWith(lastWord) && c.name !== lastWord
        );
      } else {
        filtered = completionsRef.current.filter(
          (c) => c.name.toLowerCase().startsWith(lastWord.toLowerCase()) &&
                 c.name.toLowerCase() !== lastWord.toLowerCase()
        );
      }
    }

    if (filtered.length === 0) { dismiss(); return; }

    const term = termRef.current;
    setState({
      suggestions: filtered.slice(0, 10),
      selectedIndex: 0,
      visible: true,
      cursorX: term ? term.buffer.active.cursorX : 0,
      cursorY: term ? term.buffer.active.cursorY : 0,
    });
  }, [dismiss]);

  /**
   * Core trigger: called after every user keystroke.
   * Reads current line from xterm buffer (100% reliable).
   * Disables itself when a TUI app is using alternate screen buffer.
   */
  const handleInput = useCallback((data: string) => {
    const term = termRef.current;

    // ─── TUI detection: if alternate buffer is active, disable autocomplete ───
    // Claude Code, vim, htop etc. use alternate screen buffer.
    // term.buffer.active !== term.buffer.normal means alternate buffer is active.
    if (term && term.buffer.active.type !== 'normal') {
      dismiss();
      return;
    }

    // On Enter or Ctrl+C — clear
    for (const ch of data) {
      const code = ch.charCodeAt(0);
      if (ch === '\r' || ch === '\n' || code === 3 || code === 4) {
        completionsRef.current = [];
        dismiss();
        return;
      }
    }

    // Debounce: read the actual terminal line after xterm renders
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (!term) return;

      // Double check: TUI might have started between keystroke and timeout
      if (term.buffer.active.type !== 'normal') {
        dismiss();
        return;
      }

      const input = readCurrentInput(term);
      if (input.length > 0) {
        showFor(input);
      } else {
        dismiss();
      }
    }, 120);
  }, [dismiss, showFor]);

  const acceptSuggestion = useCallback((): string | null => {
    if (!state.visible || state.suggestions.length === 0) return null;
    const s = state.suggestions[state.selectedIndex];
    if (!s) return null;

    const term = termRef.current;
    if (!term) return null;

    const input = readCurrentInput(term);
    const parts = input.trim().split(/\s+/);
    const lastWord = parts[parts.length - 1] || '';
    const insert = s.name.slice(lastWord.length) + ' ';

    if (s.kind === 'command') completionsRef.current = [];
    dismiss();
    return insert;
  }, [state, dismiss]);

  const moveSelection = useCallback((delta: number) => {
    if (!state.visible) return;
    setState((prev) => ({
      ...prev,
      selectedIndex: (prev.selectedIndex + delta + prev.suggestions.length) % prev.suggestions.length,
    }));
  }, [state.visible]);

  useEffect(() => {
    const tab = useTabStore.getState().tabs.find((t) => t.id === tabId);
    if (tab) cwdRef.current = tab.cwd;
  }, [tabId]);

  return { state, handleInput, acceptSuggestion, moveSelection, dismiss, setTerminal, resetBuffer };
}
