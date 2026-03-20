import { useDashboardStore } from '../stores/dashboard-store';

function stripAnsi(text: string): string {
  return text
    // CSI sequences: ESC [ ... (letter) — covers colors, cursor, scroll, etc.
    .replace(/\x1b\[[\x20-\x3f]*[\x30-\x7e]/g, '')
    // OSC sequences: ESC ] ... ST
    .replace(/\x1b\].*?(?:\x07|\x1b\\)/g, '')
    // Other ESC sequences: ESC (letter)
    .replace(/\x1b[^[\]]/g, '')
    // Remaining control chars except newline/tab
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
}

// ─── Detection Patterns (multiple for resilience against chunk splitting) ───

const CLAUDE_START_PATTERNS = [
  /Claude\s*Code\s*v[\d.]+/,
  /Claude\s*Code/,
  /Opus\s+[\d.]+.*context/i,
  /Sonnet\s+[\d.]+.*context/i,
  /Haiku\s+[\d.]+.*context/i,
  /bypass\s+permissions\s+on/i,           // --dangerously-skip-permissions mode
  /shift\+tab\s+to\s+cycle/i,            // UI hint unique to Claude Code
  /codex\s+v[\d.]+/i,
  /Codex\s+CLI/i,
];

const MODEL_RE = /(Opus|Sonnet|Haiku)\s+[\d.]+/i;

const CLAUDE_EXIT_PATTERNS = [
  /Press\s+Ctrl[+-]?C\s+again\s+to\s+exit/,
  /Ctrl-C\s+again\s+to\s+exit/,
];

// Sub-agent patterns (handle both ... and … ellipsis)
const RUNNING_AGENTS_RE = /Running\s+(\d+)\s+agents?/;
const AGENT_TREE_LINE_RE = /[├└][─┬]\s*(.+?)(?:\s+[·•]\s*(\d+)\s+tool|\s*$)/;
const AGENT_DONE_RE = /Done/i;
const AGENT_NAME_RE = /Agent\s*\(([^)]+)\)/;
const BASH_TOOL_RE = /(?:Bash|bash|Read|Write|Edit|Glob|Grep)[:\s]+(.{3,80})/;
const TOOL_USES_RE = /(\d+)\s+tool\s+uses?/;
const TOKENS_RE = /([\d.]+)\s*[kK]?\s*tokens?/;

// Per-tab state
const tabState = new Map<string, {
  claudeStarted: boolean;
  lastModel: string;
  recentOutput: string;
}>();

function getState(tabId: string) {
  if (!tabState.has(tabId)) {
    tabState.set(tabId, { claudeStarted: false, lastModel: '', recentOutput: '' });
  }
  return tabState.get(tabId)!;
}

// Callback for when significant state changes happen (sub-agents start/end)
let _onStateChange: ((tabId: string) => void) | null = null;

export function setParserCallback(cb: (tabId: string) => void) {
  _onStateChange = cb;
}

export function parseClaudeOutput(tabId: string, rawData: string): void {
  const clean = stripAnsi(rawData);
  if (!clean.trim()) return;

  const store = useDashboardStore.getState();
  const state = getState(tabId);

  state.recentOutput = (state.recentOutput + clean).slice(-1000);

  // ─── Detect startup ───
  if (!state.claudeStarted) {
    const isStart = CLAUDE_START_PATTERNS.some((re) => re.test(state.recentOutput));
    if (isStart) {
      const modelMatch = state.recentOutput.match(MODEL_RE);
      const model = modelMatch ? modelMatch[0] : 'Claude';
      state.claudeStarted = true;
      state.lastModel = model;
      store.startClaudeSession(tabId, model, '');
      state.recentOutput = '';
      console.log(`[PPT] Claude session started: ${model} (tab ${tabId})`);
    }
  }

  // ─── Detect exit ───
  if (state.claudeStarted) {
    const isExit = CLAUDE_EXIT_PATTERNS.some((re) => re.test(clean));
    if (isExit) {
      state.claudeStarted = false;
      store.endClaudeSession(tabId);
      return;
    }
  }

  // If we see agent patterns but haven't detected startup yet, auto-start
  if (!state.claudeStarted && RUNNING_AGENTS_RE.test(clean)) {
    state.claudeStarted = true;
    state.lastModel = 'Claude';
    store.startClaudeSession(tabId, 'Claude', '');
    console.log(`[PPT] Auto-started Claude session from agent output (tab ${tabId})`);
  }

  if (!state.claudeStarted) return;

  // Debug: log cleaned output chunks that contain interesting keywords
  if (/[Rr]unning.*agent|[├└]|Agent\(/i.test(clean)) {
    console.log(`[PPT-DEBUG] Interesting output:`, JSON.stringify(clean.slice(0, 200)));
  }

  // ─── Sub-agents count: "Running 3 agents..." ───
  const runningMatch = clean.match(RUNNING_AGENTS_RE);
  if (runningMatch) {
    const count = parseInt(runningMatch[1], 10);
    console.log(`[PPT] Detected ${count} sub-agents for tab ${tabId}`);
    store.setSubAgentCount(tabId, count);
    _onStateChange?.(tabId);
  }

  // Also detect sub-agents from tree lines even without "Running N" header
  const treeLines = clean.split('\n').filter((l) => /[├└]/.test(l));
  if (treeLines.length > 0 && !runningMatch) {
    const session = store.claudeSessions.get(tabId);
    if (session && session.subAgents === 0) {
      console.log(`[PPT] Auto-detected ${treeLines.length} sub-agents from tree lines`);
      store.setSubAgentCount(tabId, treeLines.length);
      _onStateChange?.(tabId);
    }
  }

  // ─── Detect agents completed ───
  const session = store.claudeSessions.get(tabId);
  if (session && session.subAgents > 0) {
    // Multiple ways to detect completion:
    // 1. Claude Code's `>` or `❯` prompt returns
    // 2. "Done" appears in output
    // 3. No more "Running N agents" after agents were active
    const hasPrompt = /[❯>]\s*$/m.test(clean) || /^\s*[❯>]/m.test(clean);
    const hasDoneAll = /Done/i.test(clean) && !/Running\s+\d+\s+agents/i.test(clean);

    if (hasPrompt || hasDoneAll) {
      console.log(`[PPT] Sub-agents completed for tab ${tabId} (prompt=${hasPrompt} done=${hasDoneAll})`);
      // Mark all running sub-agents as done
      session.subAgentDetails.forEach((a) => {
        if (a.status === 'running') {
          store.updateSubAgentInfo(tabId, a.name, { status: 'done' });
        }
      });
      store.setSubAgentCount(tabId, 0);
      _onStateChange?.(tabId);
    }
  }

  // ─── Agent tree lines: "├─ 查台北今天天氣 · 1 tool use · 9.6k tokens" ───
  for (const line of clean.split('\n')) {
    const trimmed = line.trim();

    const treeMatch = trimmed.match(AGENT_TREE_LINE_RE);
    if (treeMatch) {
      const name = treeMatch[1].trim();
      const toolUses = treeMatch[2] ? parseInt(treeMatch[2], 10) : 0;
      if (name.length > 1 && name.length < 50) {
        const status = AGENT_DONE_RE.test(trimmed) ? 'done' as const : 'running' as const;

        // Parse per-agent tokens: "9.6k tokens"
        const agentTokenMatch = trimmed.match(TOKENS_RE);
        let agentTokens = 0;
        if (agentTokenMatch) {
          agentTokens = parseFloat(agentTokenMatch[1]);
          if (agentTokenMatch[1].endsWith('k') || agentTokenMatch[1].endsWith('K')) {
            agentTokens *= 1000;
          }
        }

        store.updateSubAgentInfo(tabId, name, { toolUses, status, tokens: Math.round(agentTokens) });
      }
    }

    // "Done" anywhere in a tree line → mark last running agent as done
    if (/Done/i.test(trimmed) && /[└├│]/.test(trimmed)) {
      const session = store.claudeSessions.get(tabId);
      if (session && session.subAgentDetails.length > 0) {
        const lastRunning = [...session.subAgentDetails].reverse().find((a) => a.status === 'running');
        if (lastRunning) {
          store.updateSubAgentInfo(tabId, lastRunning.name, { status: 'done' });
        }
      }
    }

    // Agent(name)
    const agentMatch = trimmed.match(AGENT_NAME_RE);
    if (agentMatch) {
      store.updateSubAgentInfo(tabId, agentMatch[1], {});
    }

    // Bash commands
    const bashMatch = trimmed.match(BASH_TOOL_RE);
    if (bashMatch) {
      store.trackBashCommand(tabId, bashMatch[1].trim());
    }
  }

  // ─── Session-level token usage (from Claude Code status line) ───
  const tokenMatches = [...clean.matchAll(/(\d[\d,.]*)\s*[kK]?\s*tokens?/g)];
  if (tokenMatches.length > 0) {
    // Take the largest token count as the session total (Claude shows cumulative)
    let maxTokens = 0;
    for (const m of tokenMatches) {
      let t = parseFloat(m[1].replace(/,/g, ''));
      if (m[0].toLowerCase().includes('k')) t *= 1000;
      if (t > maxTokens) maxTokens = t;
    }
    if (maxTokens > 0) {
      store.trackOutput(tabId, Math.round(maxTokens));
    }
  }

  // ─── Tool uses ───
  const toolMatch = clean.match(TOOL_USES_RE);
  if (toolMatch) {
    const uses = parseInt(toolMatch[1], 10);
    if (uses > 0) store.trackRequest(tabId);
  }
}

export function onShellPromptDetected(tabId: string): void {
  const state = getState(tabId);
  if (state.claudeStarted) {
    state.claudeStarted = false;
    useDashboardStore.getState().endClaudeSession(tabId);
  }
}
