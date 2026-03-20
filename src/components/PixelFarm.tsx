import { useEffect, useRef, useCallback, useState } from 'react';
import { useDashboardStore } from '../stores/dashboard-store';
import { useTabStore } from '../stores/tab-store';
import './PixelFarm.css';

interface Chicken {
  id: string;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  color: string;
  label: string;
  cost: string;
  isHen: boolean; // true = main session, false = sub-agent chick
  parentId?: string;
  frame: number;
  direction: 'left' | 'right';
  state: 'idle' | 'walking' | 'pecking';
  stateTimer: number;
}

const HEN_COLORS = ['#f0883e', '#3fb950', '#58a6ff', '#bc8cff', '#f85149', '#d29922', '#39c5cf', '#ff7b72'];
const FARM_W = 400;
const FARM_H = 260;
const GROUND_Y = 200;

function hashColor(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  return HEN_COLORS[Math.abs(h) % HEN_COLORS.length];
}

function formatCost(tokens: number): string {
  const cost = (tokens / 1_000_000) * 15;
  if (cost < 0.01) return '';
  return `$${cost.toFixed(2)}`;
}

export function PixelFarm({ onClose }: { onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chickensRef = useRef<Map<string, Chicken>>(new Map());
  const animRef = useRef<number>(0);
  const claudeSessions = useDashboardStore((s) => s.claudeSessions);
  const tabs = useTabStore((s) => s.tabs);

  // Draggable window
  const [pos, setPos] = useState({ x: -1, y: -1 });
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  // Center on first render
  useEffect(() => {
    if (pos.x === -1) {
      setPos({
        x: Math.round((window.innerWidth - FARM_W) / 2),
        y: Math.round((window.innerHeight - FARM_H - 40) / 2),
      });
    }
  }, []);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      setPos({
        x: dragRef.current.origX + ev.clientX - dragRef.current.startX,
        y: dragRef.current.origY + ev.clientY - dragRef.current.startY,
      });
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [pos]);

  // Sync chickens with sessions
  const syncChickens = useCallback(() => {
    const chickens = chickensRef.current;
    const existingIds = new Set(chickens.keys());
    const neededIds = new Set<string>();

    claudeSessions.forEach((session) => {
      const tab = tabs.find((t) => t.id === session.tabId);
      const henId = `hen-${session.tabId}`;
      neededIds.add(henId);

      if (!chickens.has(henId)) {
        chickens.set(henId, {
          id: henId,
          x: 40 + Math.random() * (FARM_W - 80),
          y: GROUND_Y - 10 + Math.random() * 20,
          targetX: 40 + Math.random() * (FARM_W - 80),
          targetY: GROUND_Y - 10 + Math.random() * 20,
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

      // Sub-agent chicks
      session.subAgentDetails.forEach((agent, i) => {
        const chickId = `chick-${session.tabId}-${agent.name}`;
        neededIds.add(chickId);
        if (!chickens.has(chickId)) {
          const hen = chickens.get(henId)!;
          chickens.set(chickId, {
            id: chickId,
            x: hen.x + 10 + i * 8,
            y: hen.y + 8,
            targetX: hen.x + 10 + i * 8,
            targetY: hen.y + 8,
            color: hen.color,
            label: '',
            cost: '',
            isHen: false,
            parentId: henId,
            frame: 0,
            direction: hen.direction,
            state: agent.status === 'done' ? 'idle' : 'walking',
            stateTimer: Math.random() * 60,
          });
        }
      });
    });

    // Remove chickens for ended sessions (keep for a while)
    existingIds.forEach((id) => {
      if (!neededIds.has(id)) {
        chickens.delete(id);
      }
    });
  }, [claudeSessions, tabs]);

  // Animation loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;

    const render = () => {
      syncChickens();
      ctx.clearRect(0, 0, FARM_W, FARM_H);
      drawFarm(ctx);

      chickensRef.current.forEach((chicken) => {
        updateChicken(chicken, chickensRef.current);
        drawChicken(ctx, chicken);
      });

      animRef.current = requestAnimationFrame(render);
    };

    animRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animRef.current);
  }, [syncChickens]);

  return (
    <div
      className="pixel-farm"
      style={{ left: pos.x, top: pos.y }}
    >
      <div className="pixel-farm-header" onMouseDown={handleDragStart}>
        <span className="pixel-farm-title">🐔 Agent Farm</span>
        <span className="pixel-farm-count">
          {Array.from(claudeSessions.values()).filter((s) => s.active).length} sessions
        </span>
        <button className="pixel-farm-close" onClick={onClose}>×</button>
      </div>
      <canvas
        ref={canvasRef}
        width={FARM_W}
        height={FARM_H}
        className="pixel-farm-canvas"
      />
    </div>
  );
}

// ─── Drawing ───

function drawFarm(ctx: CanvasRenderingContext2D) {
  // Sky gradient
  const sky = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
  sky.addColorStop(0, '#0a1628');
  sky.addColorStop(1, '#162035');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, FARM_W, GROUND_Y);

  // Stars
  ctx.fillStyle = '#ffffff20';
  for (let i = 0; i < 20; i++) {
    const sx = (i * 97 + 13) % FARM_W;
    const sy = (i * 53 + 7) % (GROUND_Y - 20);
    ctx.fillRect(sx, sy, 1, 1);
  }

  // Ground
  ctx.fillStyle = '#1a2810';
  ctx.fillRect(0, GROUND_Y - 5, FARM_W, FARM_H - GROUND_Y + 5);

  // Grass tufts
  ctx.fillStyle = '#2a4015';
  for (let x = 0; x < FARM_W; x += 12) {
    ctx.fillRect(x, GROUND_Y - 6, 3, 4);
    ctx.fillRect(x + 6, GROUND_Y - 4, 2, 3);
  }

  // Fence
  ctx.fillStyle = '#5c4033';
  for (let x = 10; x < FARM_W - 10; x += 30) {
    ctx.fillRect(x, GROUND_Y - 20, 3, 20); // post
  }
  ctx.fillRect(10, GROUND_Y - 18, FARM_W - 20, 2); // top rail
  ctx.fillRect(10, GROUND_Y - 10, FARM_W - 20, 2); // bottom rail
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
    // ─── Hen (16x14 px) ───
    // Body
    ctx.fillStyle = c.color;
    ctx.fillRect(-6, -4, 12, 8);
    // Head
    ctx.fillRect(4, -8, 6, 6);
    // Eye
    ctx.fillStyle = '#fff';
    ctx.fillRect(7, -7, 2, 2);
    ctx.fillStyle = '#000';
    ctx.fillRect(8, -7, 1, 1);
    // Beak
    ctx.fillStyle = '#f0c040';
    ctx.fillRect(10, -5, 3, 2);
    // Comb
    ctx.fillStyle = '#e03030';
    ctx.fillRect(5, -10, 2, 3);
    ctx.fillRect(7, -11, 2, 3);
    // Tail
    ctx.fillStyle = c.color;
    ctx.globalAlpha = 0.8;
    ctx.fillRect(-8, -8, 3, 5);
    ctx.fillRect(-9, -6, 2, 3);
    ctx.globalAlpha = 1;
    // Legs
    ctx.fillStyle = '#f0c040';
    const legOffset = c.state === 'walking' ? Math.sin(c.frame * 0.4) * 2 : 0;
    ctx.fillRect(-2, 4, 1, 4);
    ctx.fillRect(2 + legOffset, 4, 1, 4);
    // Feet
    ctx.fillRect(-3, 7, 3, 1);
    ctx.fillRect(1 + legOffset, 7, 3, 1);
  } else {
    // ─── Chick (8x8 px) ───
    ctx.fillStyle = '#f0e060';
    ctx.fillRect(-3, -2, 6, 5);
    // Head
    ctx.fillRect(1, -4, 4, 3);
    // Eye
    ctx.fillStyle = '#000';
    ctx.fillRect(3, -3, 1, 1);
    // Beak
    ctx.fillStyle = '#f0a030';
    ctx.fillRect(5, -2, 2, 1);
  }

  ctx.restore();

  // Labels (drawn without flip)
  ctx.textAlign = 'center';
  ctx.font = 'bold 8px "JetBrains Mono", monospace';

  // Hotkey label
  if (c.label) {
    ctx.fillStyle = '#ffffff90';
    ctx.fillText(c.label, x, y - (c.isHen ? 14 : 7));
  }

  // Cost label
  if (c.cost) {
    ctx.fillStyle = '#3fb950';
    ctx.font = '7px "JetBrains Mono", monospace';
    ctx.fillText(c.cost, x, y - (c.isHen ? 20 : 11));
  }
}

function updateChicken(c: Chicken, all: Map<string, Chicken>) {
  c.frame++;
  c.stateTimer--;

  // Chicks follow their parent hen
  if (!c.isHen && c.parentId) {
    const parent = all.get(c.parentId);
    if (parent) {
      c.targetX = parent.x + (Math.sin(c.frame * 0.05 + c.x) * 15);
      c.targetY = parent.y + 8 + Math.cos(c.frame * 0.03) * 3;
    }
  }

  // State machine
  if (c.stateTimer <= 0) {
    const r = Math.random();
    if (r < 0.4) {
      c.state = 'walking';
      c.targetX = 30 + Math.random() * (FARM_W - 60);
      c.targetY = GROUND_Y - 10 + Math.random() * 15;
      c.stateTimer = 60 + Math.random() * 120;
    } else if (r < 0.7) {
      c.state = 'pecking';
      c.stateTimer = 20 + Math.random() * 40;
    } else {
      c.state = 'idle';
      c.stateTimer = 40 + Math.random() * 80;
    }
  }

  // Movement
  if (c.state === 'walking' || !c.isHen) {
    const dx = c.targetX - c.x;
    const dy = c.targetY - c.y;
    const speed = c.isHen ? 0.5 : 0.8;
    c.x += dx * 0.02 * speed;
    c.y += dy * 0.02 * speed;
    c.direction = dx > 0 ? 'right' : 'left';
  }

  // Boundary
  c.x = Math.max(15, Math.min(FARM_W - 15, c.x));
  c.y = Math.max(GROUND_Y - 15, Math.min(FARM_H - 15, c.y));
}
