import { useDashboardStore } from '../stores/dashboard-store';

/**
 * Parses Claude Code CLI output to detect:
 * - CLI startup: "Claude Code v2.1.80" → start session
 * - Model info: "Opus 4.6 (1M context)"
 * - CLI exit: "Press Ctrl+C again to exit" or prompt returns → end session
 * - Sub-agent spawning: "Running 3 agents..."
 * - Token counts: "13.2k tokens"
 * - Tool use counts: "1 tool uses"
 */

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
}

// ─── Detection Patterns ───

// Claude Code / Codex CLI startup — multiple patterns for resilience
const CLAUDE_START_PATTERNS = [
  /Claude\s*Code\s*v[\d.]+/,
  /Claude\s*Code/,
  /Opus\s+[\d.]+.*context/i,
  /Sonnet\s+[\d.]+.*context/i,
  /Haiku\s+[\d.]+.*context/i,
  /codex\s+v[\d.]+/i,             // OpenAI Codex CLI
  /Codex\s+CLI/i,
];
const MODEL_RE = /(Opus|Sonnet|Haiku)\s+[\d.]+/i;

// Claude Code CLI exit
const CLAUDE_EXIT_PATTERNS = [
  /Press\s+Ctrl[+-]?C\s+again\s+to\s+exit/,
  /Ctrl-C\s+again\s+to\s+exit/,
];

// Sub-agents
const RUNNING_AGENTS_RE = /Running\s+(\d+)\s+agents?/;
const TOOL_USES_RE = /(\d+)\s+tool\s+uses?/;
const TOKENS_RE = /([\d.]+k?)\s+tokens?/;

// Track per-tab state with output buffer for multi-chunk detection
const tabState = new Map<string, { claudeStarted: boolean; lastModel: string; recentOutput: string }>();

function getTabState(tabId: string) {
  if (!tabState.has(tabId)) {
    tabState.set(tabId, { claudeStarted: false, lastModel: '', recentOutput: '' });
  }
  return tabState.get(tabId)!;
}

/**
 * Process a chunk of PTY output and update dashboard store.
 */
export function parseClaudeOutput(tabId: string, rawData: string): void {
  const clean = stripAnsi(rawData);
  if (!clean.trim()) return;

  const store = useDashboardStore.getState();
  const state = getTabState(tabId);

  // Accumulate recent output (keep last 500 chars for multi-chunk matching)
  state.recentOutput = (state.recentOutput + clean).slice(-500);

  // ─── Detect Claude Code CLI startup ───
  if (!state.claudeStarted) {
    const isStart = CLAUDE_START_PATTERNS.some((re) => re.test(state.recentOutput));
    if (isStart) {
      const modelMatch = state.recentOutput.match(MODEL_RE);
      const model = modelMatch ? modelMatch[0] : 'Claude';
      state.claudeStarted = true;
      state.lastModel = model;
      store.startClaudeSession(tabId, model, '');
      state.recentOutput = ''; // reset buffer after detection
    }
  }

  // ─── Detect Claude Code CLI exit ───
  if (state.claudeStarted) {
    const isExit = CLAUDE_EXIT_PATTERNS.some((re) => re.test(clean));
    if (isExit) {
      state.claudeStarted = false;
      store.endClaudeSession(tabId);
    }
  }

  // ─── Only track metrics if Claude is running ───
  if (!state.claudeStarted) return;

  // Sub-agents
  const runningMatch = clean.match(RUNNING_AGENTS_RE);
  if (runningMatch) {
    const count = parseInt(runningMatch[1], 10);
    const current = store.getSessionUsage(tabId)?.subAgents || 0;
    store.trackSubAgent(tabId, count - current);
  }

  // Token usage
  const tokenMatch = clean.match(TOKENS_RE);
  if (tokenMatch) {
    let tokens = parseFloat(tokenMatch[1]);
    if (tokenMatch[1].endsWith('k')) {
      tokens = parseFloat(tokenMatch[1].replace('k', '')) * 1000;
    }
    if (tokens > 0) {
      store.trackOutput(tabId, Math.round(tokens * 3.5));
    }
  }

  // Tool uses
  const toolMatch = clean.match(TOOL_USES_RE);
  if (toolMatch) {
    const uses = parseInt(toolMatch[1], 10);
    if (uses > 0) store.trackRequest(tabId);
  }
}

/**
 * Called when shell prompt is detected (Claude Code exited back to shell).
 */
export function onShellPromptDetected(tabId: string): void {
  const state = getTabState(tabId);
  if (state.claudeStarted) {
    state.claudeStarted = false;
    useDashboardStore.getState().endClaudeSession(tabId);
  }
}
