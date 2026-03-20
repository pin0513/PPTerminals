import { useEffect, useRef, useCallback } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useDashboardStore } from '../stores/dashboard-store';
import { useTabStore } from '../stores/tab-store';
import './FarmWindow.css';

// Reuse farm drawing logic
const HEN_COLORS = ['#f0883e', '#3fb950', '#58a6ff', '#bc8cff', '#f85149', '#d29922', '#39c5cf', '#ff7b72'];

interface Chicken {
  id: string;
  x: number; y: number;
  targetX: number; targetY: number;
  color: string;
  label: string;
  cost: string;
  isHen: boolean;
  parentId?: string;
  frame: number;
  direction: 'left' | 'right';
  state: 'idle' | 'walking' | 'pecking';
  stateTimer: number;
}

function hashColor(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  return HEN_COLORS[Math.abs(h) % HEN_COLORS.length];
}

function formatCost(tokens: number): string {
  const cost = (tokens / 1_000_000) * 15;
  return cost < 0.01 ? '' : `$${cost.toFixed(2)}`;
}

export function FarmWindow() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chickensRef = useRef<Map<string, Chicken>>(new Map());
  const animRef = useRef<number>(0);
  const claudeSessions = useDashboardStore((s) => s.claudeSessions);
  const tabs = useTabStore((s) => s.tabs);

  // Listen for data from main window via events
  // The farm window shares the same Zustand stores with the main window
  // because it's the same app loaded with #farm hash

  const getCanvasSize = useCallback(() => {
    return {
      w: window.innerWidth,
      h: window.innerHeight - 32, // subtract header
    };
  }, []);

  const syncChickens = useCallback(() => {
    const chickens = chickensRef.current;
    const { w, h } = getCanvasSize();
    const groundY = h - 50;

    claudeSessions.forEach((session) => {
      const tab = tabs.find((t) => t.id === session.tabId);
      const henId = `hen-${session.tabId}`;

      if (!chickens.has(henId)) {
        chickens.set(henId, {
          id: henId,
          x: 40 + Math.random() * (w - 80),
          y: groundY - 10 + Math.random() * 15,
          targetX: 40 + Math.random() * (w - 80),
          targetY: groundY - 10 + Math.random() * 15,
          color: hashColor(session.tabId),
          label: tab?.hotkey || '?',
          cost: formatCost(session.usage.outputTokens),
          isHen: true,
          frame: 0,
          direction: Math.random() > 0.5 ? 'right' : 'left',
          state: 'idle',
          stateTimer: Math.random() * 100,
        });
      } else {
        const hen = chickens.get(henId)!;
        hen.cost = formatCost(session.usage.outputTokens);
        hen.label = tab?.hotkey || '?';
      }

      session.subAgentDetails.forEach((agent, i) => {
        const chickId = `chick-${session.tabId}-${agent.name}`;
        if (!chickens.has(chickId)) {
          const hen = chickens.get(henId)!;
          chickens.set(chickId, {
            id: chickId,
            x: hen.x + 10 + i * 8, y: hen.y + 8,
            targetX: hen.x + 10 + i * 8, targetY: hen.y + 8,
            color: hen.color, label: '', cost: '',
            isHen: false, parentId: henId,
            frame: 0, direction: hen.direction,
            state: agent.status === 'done' ? 'idle' : 'walking',
            stateTimer: Math.random() * 60,
          });
        }
      });
    });

    // Clean up removed sessions
    const activeIds = new Set<string>();
    claudeSessions.forEach((s) => {
      activeIds.add(`hen-${s.tabId}`);
      s.subAgentDetails.forEach((a) => activeIds.add(`chick-${s.tabId}-${a.name}`));
    });
    chickens.forEach((_, id) => { if (!activeIds.has(id)) chickens.delete(id); });
  }, [claudeSessions, tabs, getCanvasSize]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const render = () => {
      const { w, h } = getCanvasSize();
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      const groundY = h - 50;

      syncChickens();
      ctx.clearRect(0, 0, w, h);

      // Sky
      const sky = ctx.createLinearGradient(0, 0, 0, groundY);
      sky.addColorStop(0, '#0a1628');
      sky.addColorStop(1, '#162035');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, groundY);

      // Stars
      ctx.fillStyle = '#ffffff20';
      for (let i = 0; i < 40; i++) {
        ctx.fillRect((i * 97 + 13) % w, (i * 53 + 7) % (groundY - 20), 1, 1);
      }

      // Moon
      ctx.fillStyle = '#ffffff15';
      ctx.beginPath();
      ctx.arc(w - 60, 40, 20, 0, Math.PI * 2);
      ctx.fill();

      // Ground
      ctx.fillStyle = '#1a2810';
      ctx.fillRect(0, groundY - 5, w, h - groundY + 5);

      // Grass
      ctx.fillStyle = '#2a4015';
      for (let x = 0; x < w; x += 12) {
        ctx.fillRect(x, groundY - 6, 3, 4);
        ctx.fillRect(x + 6, groundY - 4, 2, 3);
      }

      // Fence
      ctx.fillStyle = '#5c4033';
      for (let x = 10; x < w - 10; x += 30) ctx.fillRect(x, groundY - 20, 3, 20);
      ctx.fillRect(10, groundY - 18, w - 20, 2);
      ctx.fillRect(10, groundY - 10, w - 20, 2);

      // Chickens
      chickensRef.current.forEach((c) => {
        updateChicken(c, chickensRef.current, w, h, groundY);
        drawChicken(ctx, c);
      });

      animRef.current = requestAnimationFrame(render);
    };

    animRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animRef.current);
  }, [syncChickens, getCanvasSize]);

  return (
    <div className="farm-window">
      <div className="farm-window-header">
        <span>🐔 Agent Farm</span>
        <span className="farm-window-stats">
          {Array.from(claudeSessions.values()).filter((s) => s.active).length} active sessions
        </span>
        <button className="farm-window-close" onClick={() => getCurrentWindow().close()}>×</button>
      </div>
      <canvas ref={canvasRef} className="farm-window-canvas" />
    </div>
  );
}

function drawChicken(ctx: CanvasRenderingContext2D, c: Chicken) {
  const flip = c.direction === 'left' ? -1 : 1;
  const bobY = c.state === 'walking' ? Math.sin(c.frame * 0.3) * 1.5 : 0;
  const x = Math.round(c.x);
  const y = Math.round(c.y + bobY);

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(flip, 1);

  if (c.isHen) {
    ctx.fillStyle = c.color;
    ctx.fillRect(-6, -4, 12, 8);
    ctx.fillRect(4, -8, 6, 6);
    ctx.fillStyle = '#fff'; ctx.fillRect(7, -7, 2, 2);
    ctx.fillStyle = '#000'; ctx.fillRect(8, -7, 1, 1);
    ctx.fillStyle = '#f0c040'; ctx.fillRect(10, -5, 3, 2);
    ctx.fillStyle = '#e03030'; ctx.fillRect(5, -10, 2, 3); ctx.fillRect(7, -11, 2, 3);
    ctx.fillStyle = c.color; ctx.globalAlpha = 0.8;
    ctx.fillRect(-8, -8, 3, 5); ctx.fillRect(-9, -6, 2, 3);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#f0c040';
    const lo = c.state === 'walking' ? Math.sin(c.frame * 0.4) * 2 : 0;
    ctx.fillRect(-2, 4, 1, 4); ctx.fillRect(2 + lo, 4, 1, 4);
    ctx.fillRect(-3, 7, 3, 1); ctx.fillRect(1 + lo, 7, 3, 1);
  } else {
    ctx.fillStyle = '#f0e060'; ctx.fillRect(-3, -2, 6, 5); ctx.fillRect(1, -4, 4, 3);
    ctx.fillStyle = '#000'; ctx.fillRect(3, -3, 1, 1);
    ctx.fillStyle = '#f0a030'; ctx.fillRect(5, -2, 2, 1);
  }
  ctx.restore();

  ctx.textAlign = 'center';
  if (c.label) {
    ctx.fillStyle = '#ffffff90';
    ctx.font = 'bold 9px "JetBrains Mono", monospace';
    ctx.fillText(c.label, x, y - (c.isHen ? 14 : 7));
  }
  if (c.cost) {
    ctx.fillStyle = '#3fb950';
    ctx.font = '8px "JetBrains Mono", monospace';
    ctx.fillText(c.cost, x, y - (c.isHen ? 20 : 11));
  }
}

function updateChicken(c: Chicken, all: Map<string, Chicken>, w: number, h: number, groundY: number) {
  c.frame++;
  c.stateTimer--;

  if (!c.isHen && c.parentId) {
    const parent = all.get(c.parentId);
    if (parent) {
      c.targetX = parent.x + Math.sin(c.frame * 0.05 + c.x) * 20;
      c.targetY = parent.y + 8 + Math.cos(c.frame * 0.03) * 3;
    }
  }

  if (c.stateTimer <= 0) {
    const r = Math.random();
    if (r < 0.4) {
      c.state = 'walking';
      c.targetX = 30 + Math.random() * (w - 60);
      c.targetY = groundY - 10 + Math.random() * 15;
      c.stateTimer = 60 + Math.random() * 120;
    } else if (r < 0.7) {
      c.state = 'pecking'; c.stateTimer = 20 + Math.random() * 40;
    } else {
      c.state = 'idle'; c.stateTimer = 40 + Math.random() * 80;
    }
  }

  if (c.state === 'walking' || !c.isHen) {
    const speed = c.isHen ? 0.5 : 0.8;
    c.x += (c.targetX - c.x) * 0.02 * speed;
    c.y += (c.targetY - c.y) * 0.02 * speed;
    c.direction = (c.targetX - c.x) > 0 ? 'right' : 'left';
  }

  c.x = Math.max(15, Math.min(w - 15, c.x));
  c.y = Math.max(groundY - 15, Math.min(h - 15, c.y));
}
