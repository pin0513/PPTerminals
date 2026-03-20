import { create } from 'zustand';

// Anthropic pricing per 1M tokens (USD) — Claude 4 Sonnet as default
const PRICING = {
  input: 3.0, // $3 per 1M input tokens
  output: 15.0, // $15 per 1M output tokens
};

export interface SessionUsage {
  tabId: string;
  inputTokens: number;
  outputTokens: number;
  requests: number;
  startedAt: number;
  lastActivity: number;
  subAgents: number;
}

export interface SubAgentInfo {
  name: string;
  toolUses: number;
  tokens: number;
  status: 'running' | 'done';
}

export interface ClaudeSession {
  tabId: string;
  model: string;
  cwd: string;
  startedAt: number;
  active: boolean;
  subAgents: number;
  subAgentDetails: SubAgentInfo[];
  bashCommands: string[]; // recent bash commands
  usage: SessionUsage;
}

interface DashboardStore {
  sessions: Map<string, SessionUsage>;
  claudeSessions: Map<string, ClaudeSession>;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalRequests: number;
  isOpen: boolean;

  startClaudeSession: (tabId: string, model: string, cwd: string) => void;
  endClaudeSession: (tabId: string) => void;
  setSubAgentCount: (tabId: string, count: number) => void;
  updateSubAgentInfo: (tabId: string, name: string, info: Partial<SubAgentInfo>) => void;
  trackBashCommand: (tabId: string, command: string) => void;

  trackOutput: (tabId: string, charCount: number) => void;
  trackInput: (tabId: string, charCount: number) => void;
  trackRequest: (tabId: string) => void;
  trackSubAgent: (tabId: string, delta: number) => void;
  removeSession: (tabId: string) => void;
  toggleDashboard: () => void;
  getCost: () => { input: number; output: number; total: number };
  getSessionUsage: (tabId: string) => SessionUsage | undefined;
}

const STORAGE_KEY = 'ppterminals_usage';

function loadUsage(): { totalInput: number; totalOutput: number; totalReqs: number } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      return {
        totalInput: data.totalInput || 0,
        totalOutput: data.totalOutput || 0,
        totalReqs: data.totalReqs || 0,
      };
    }
  } catch { /* ignore */ }
  return { totalInput: 0, totalOutput: 0, totalReqs: 0 };
}

function saveUsage(input: number, output: number, reqs: number) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    totalInput: input,
    totalOutput: output,
    totalReqs: reqs,
  }));
}

// Rough char-to-token ratio (1 token ≈ 4 chars for English, ~2 for CJK)
function charsToTokens(chars: number): number {
  return Math.ceil(chars / 3.5);
}

export const useDashboardStore = create<DashboardStore>((set, get) => {
  const saved = loadUsage();
  return {
    sessions: new Map(),
    claudeSessions: new Map(),
    totalInputTokens: saved.totalInput,
    totalOutputTokens: saved.totalOutput,
    totalRequests: saved.totalReqs,
    isOpen: false,

    startClaudeSession: (tabId, model, cwd) => {
      set((s) => {
        const claudeSessions = new Map(s.claudeSessions);
        if (!claudeSessions.has(tabId)) {
          claudeSessions.set(tabId, {
            tabId, model, cwd,
            startedAt: Date.now(),
            active: true,
            subAgents: 0,
            subAgentDetails: [],
            bashCommands: [],
            usage: {
              tabId, inputTokens: 0, outputTokens: 0,
              requests: 0, startedAt: Date.now(), lastActivity: Date.now(), subAgents: 0,
            },
          });
        }
        return { claudeSessions };
      });
    },

    setSubAgentCount: (tabId, count) => {
      set((s) => {
        const claudeSessions = new Map(s.claudeSessions);
        const session = claudeSessions.get(tabId);
        if (session) {
          claudeSessions.set(tabId, { ...session, subAgents: count });
        }
        return { claudeSessions };
      });
    },

    updateSubAgentInfo: (tabId, name, info) => {
      set((s) => {
        const claudeSessions = new Map(s.claudeSessions);
        const session = claudeSessions.get(tabId);
        if (session) {
          const details = [...session.subAgentDetails];
          const existing = details.find((d) => d.name === name);
          if (existing) {
            Object.assign(existing, info);
          } else {
            details.push({ name, toolUses: info.toolUses || 0, tokens: info.tokens || 0, status: 'running' });
          }
          claudeSessions.set(tabId, { ...session, subAgentDetails: details });
        }
        return { claudeSessions };
      });
    },

    trackBashCommand: (tabId, command) => {
      set((s) => {
        const claudeSessions = new Map(s.claudeSessions);
        const session = claudeSessions.get(tabId);
        if (session) {
          const cmds = [...session.bashCommands, command].slice(-10); // keep last 10
          claudeSessions.set(tabId, { ...session, bashCommands: cmds });
        }
        return { claudeSessions };
      });
    },

    endClaudeSession: (tabId) => {
      set((s) => {
        const claudeSessions = new Map(s.claudeSessions);
        const session = claudeSessions.get(tabId);
        if (session) {
          claudeSessions.set(tabId, { ...session, active: false, subAgents: 0 });
        }
        return { claudeSessions };
      });
    },

    trackOutput: (tabId, charCount) => {
      const tokens = charsToTokens(charCount);
      set((s) => {
        const sessions = new Map(s.sessions);
        const session = sessions.get(tabId) || {
          tabId, inputTokens: 0, outputTokens: 0,
          requests: 0, startedAt: Date.now(), lastActivity: Date.now(), subAgents: 0,
        };
        session.outputTokens += tokens;
        session.lastActivity = Date.now();
        sessions.set(tabId, session);

        // Also update claudeSessions usage
        const claudeSessions = new Map(s.claudeSessions);
        const cs = claudeSessions.get(tabId);
        if (cs) {
          cs.usage.outputTokens += tokens;
          cs.usage.lastActivity = Date.now();
          claudeSessions.set(tabId, { ...cs });
        }

        const totalOutput = s.totalOutputTokens + tokens;
        saveUsage(s.totalInputTokens, totalOutput, s.totalRequests);
        return { sessions, claudeSessions, totalOutputTokens: totalOutput };
      });
    },

    trackInput: (tabId, charCount) => {
      const tokens = charsToTokens(charCount);
      set((s) => {
        const sessions = new Map(s.sessions);
        const session = sessions.get(tabId) || {
          tabId,
          inputTokens: 0,
          outputTokens: 0,
          requests: 0,
          startedAt: Date.now(),
          lastActivity: Date.now(),
          subAgents: 0,
        };
        session.inputTokens += tokens;
        session.lastActivity = Date.now();
        sessions.set(tabId, session);
        const totalInput = s.totalInputTokens + tokens;
        saveUsage(totalInput, s.totalOutputTokens, s.totalRequests);
        return { sessions, totalInputTokens: totalInput };
      });
    },

    trackRequest: (tabId) => {
      set((s) => {
        const sessions = new Map(s.sessions);
        const session = sessions.get(tabId) || {
          tabId, inputTokens: 0, outputTokens: 0,
          requests: 0, startedAt: Date.now(), lastActivity: Date.now(), subAgents: 0,
        };
        session.requests += 1;
        session.lastActivity = Date.now();
        sessions.set(tabId, session);

        const claudeSessions = new Map(s.claudeSessions);
        const cs = claudeSessions.get(tabId);
        if (cs) {
          cs.usage.requests += 1;
          claudeSessions.set(tabId, { ...cs });
        }

        const totalReqs = s.totalRequests + 1;
        saveUsage(s.totalInputTokens, s.totalOutputTokens, totalReqs);
        return { sessions, claudeSessions, totalRequests: totalReqs };
      });
    },

    trackSubAgent: (tabId, delta) => {
      set((s) => {
        const sessions = new Map(s.sessions);
        const session = sessions.get(tabId);
        if (session) {
          session.subAgents = Math.max(0, session.subAgents + delta);
          sessions.set(tabId, session);
        }
        return { sessions };
      });
    },

    removeSession: (tabId) => {
      set((s) => {
        const sessions = new Map(s.sessions);
        sessions.delete(tabId);
        return { sessions };
      });
    },

    toggleDashboard: () => set((s) => ({ isOpen: !s.isOpen })),

    getCost: () => {
      const { totalInputTokens, totalOutputTokens } = get();
      const inputCost = (totalInputTokens / 1_000_000) * PRICING.input;
      const outputCost = (totalOutputTokens / 1_000_000) * PRICING.output;
      return { input: inputCost, output: outputCost, total: inputCost + outputCost };
    },

    getSessionUsage: (tabId) => get().sessions.get(tabId),
  };
});
