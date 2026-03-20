import { useDashboardStore } from '../stores/dashboard-store';

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
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

// Sub-agent patterns
const RUNNING_AGENTS_RE = /Running\s+(\d+)\s+agents?/;
const AGENT_TREE_LINE_RE = /[├└]─\s+(.+?)(?:\s+·\s+(\d+)\s+tool|\s*$)/;
const AGENT_DONE_RE = /[└├].*Done/;
const AGENT_INIT_RE = /Initializing/;
const AGENT_NAME_RE = /Agent\(([^)]+)\)/;
const BASH_TOOL_RE = /Bash[:\s]+(.{5,80})/;
const TOOL_USES_RE = /(\d+)\s+tool\s+uses?/;
const TOKENS_RE = /([\d.]+k?)\s+tokens?/;

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

  if (!state.claudeStarted) return;

  // ─── Sub-agents count: "Running 3 agents..." ───
  const runningMatch = clean.match(RUNNING_AGENTS_RE);
  if (runningMatch) {
    store.setSubAgentCount(tabId, parseInt(runningMatch[1], 10));
  }

  // ─── Agent tree lines: "├─ 查台北今天天氣 · 0 tool uses" ───
  for (const line of clean.split('\n')) {
    const trimmed = line.trim();

    const treeMatch = trimmed.match(AGENT_TREE_LINE_RE);
    if (treeMatch) {
      const name = treeMatch[1].trim();
      const toolUses = treeMatch[2] ? parseInt(treeMatch[2], 10) : 0;
      if (name.length > 1 && name.length < 50) {
        const status = AGENT_DONE_RE.test(trimmed) ? 'done' as const
          : AGENT_INIT_RE.test(trimmed) ? 'running' as const
          : 'running' as const;
        store.updateSubAgentInfo(tabId, name, { toolUses, status });
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

  // ─── Token usage ───
  const tokenMatch = clean.match(TOKENS_RE);
  if (tokenMatch) {
    let tokens = parseFloat(tokenMatch[1]);
    if (tokenMatch[1].endsWith('k')) tokens *= 1000;
    if (tokens > 0) store.trackOutput(tabId, Math.round(tokens * 3.5));
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
