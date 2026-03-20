import { useEffect, useRef, useCallback, useState } from 'react';
import { useDashboardStore } from '../stores/dashboard-store';
import { useTabStore } from '../stores/tab-store';
import './PixelFarm.css';

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
  state: 'idle' | 'walking' | 'pecking' | 'ascending' | 'soul';
  stateTimer: number;
  soulY: number;
  opacity: number;
  zoneX: number; // center X of this session's zone
}

interface Gravestone {
  x: number; y: number;
  label: string; cost: string;
  createdAt: number; // timestamp for fadeout
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
  if (cost < 0.001) return '';
  if (cost < 0.01) return `$${cost.toFixed(3)}`;
  return `$${cost.toFixed(2)}`;
}

export function PixelFarm({ onClose }: { onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chickensRef = useRef<Map<string, Chicken>>(new Map());
  const gravestonesRef = useRef<Gravestone[]>([]);
  const animRef = useRef<number>(0);
  const claudeSessions = useDashboardStore((s) => s.claudeSessions);
  const tabs = useTabStore((s) => s.tabs);

  // Draggable
  const [pos, setPos] = useState({ x: -1, y: -1 });
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);

  useEffect(() => {
    if (pos.x === -1) setPos({ x: Math.round((window.innerWidth - FARM_W) / 2), y: Math.round((window.innerHeight - FARM_H) / 3) });
  }, []);

  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y };
    const onMove = (ev: MouseEvent) => { if (!dragRef.current) return; setPos({ x: dragRef.current.ox + ev.clientX - dragRef.current.sx, y: dragRef.current.oy + ev.clientY - dragRef.current.sy }); };
    const onUp = () => { dragRef.current = null; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [pos]);

  const syncChickens = useCallback(() => {
    const chickens = chickensRef.current;
    const neededIds = new Set<string>();
    const sessionList = Array.from(claudeSessions.values());
    const zoneWidth = sessionList.length > 0 ? (FARM_W - 40) / sessionList.length : FARM_W;
    let soulSlot = 0;

    sessionList.forEach((session, si) => {
      const tab = tabs.find((t) => t.id === session.tabId);
      const henId = `hen-${session.tabId}`;
      neededIds.add(henId);

      // Each session gets its own zone
      const zoneCenter = 20 + si * zoneWidth + zoneWidth / 2;
      const zoneLeft = zoneCenter - zoneWidth / 2 + 10;
      const zoneRight = zoneCenter + zoneWidth / 2 - 10;

      if (!chickens.has(henId)) {
        const c = mkChicken(henId, hashColor(session.tabId), tab?.hotkey || '?', true);
        c.x = zoneCenter;
        c.targetX = zoneCenter;
        c.zoneX = zoneCenter;
        chickens.set(henId, c);
      }
      const hen = chickens.get(henId)!;
      hen.cost = formatCost(session.usage.outputTokens);
      hen.label = tab?.hotkey || '?';
      hen.zoneX = zoneCenter;

      session.subAgentDetails.forEach((agent, i) => {
        const cid = `chick-${session.tabId}-${agent.name}`;
        neededIds.add(cid);
        const chickCost = agent.tokens > 0 ? formatCost(agent.tokens) : '';

        if (!chickens.has(cid)) {
          const c = mkChicken(cid, hen.color, agent.name.slice(0, 6), false, henId);
          c.x = hen.x + 8 + i * 10;
          c.y = hen.y + 6;
          c.zoneX = zoneCenter;
          chickens.set(cid, c);
        }

        const chick = chickens.get(cid)!;
        chick.cost = chickCost;
        chick.zoneX = zoneCenter;

        // Trigger ascension
        if (agent.status === 'done' && chick.state !== 'ascending' && chick.state !== 'soul') {
          // Place gravestone at current position
          gravestonesRef.current.push({
            x: Math.round(chick.x),
            y: GROUND_Y - 2,
            label: agent.name.slice(0, 3),
            cost: chickCost,
            createdAt: Date.now(),
          });
          chick.state = 'ascending';
          chick.soulY = 12 + soulSlot * 16;
          soulSlot++;
        }
      });

      // Constrain hen to its zone
      if (hen.state === 'walking' || hen.stateTimer <= 0) {
        hen.targetX = zoneLeft + Math.random() * (zoneRight - zoneLeft);
      }
    });

    chickens.forEach((_, id) => { if (!neededIds.has(id)) chickens.delete(id); });
  }, [claudeSessions, tabs]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;

    const render = () => {
      syncChickens();
      ctx.clearRect(0, 0, FARM_W, FARM_H);
      drawFarm(ctx);

      // Zone dividers
      const sessionList = Array.from(claudeSessions.values());
      const zoneWidth = sessionList.length > 0 ? (FARM_W - 40) / sessionList.length : 0;
      sessionList.forEach((_, i) => {
        if (i > 0) {
          const x = 20 + i * zoneWidth;
          ctx.strokeStyle = '#ffffff08';
          ctx.setLineDash([2, 4]);
          ctx.beginPath(); ctx.moveTo(x, GROUND_Y - 20); ctx.lineTo(x, FARM_H); ctx.stroke();
          ctx.setLineDash([]);
        }
      });

      // Gravestones (fade after 30 min, remove after fully faded)
      const FADE_MS = 30 * 60 * 1000;
      const now = Date.now();
      gravestonesRef.current = gravestonesRef.current.filter((g) => now - g.createdAt < FADE_MS);
      gravestonesRef.current.forEach((g) => {
        const age = now - g.createdAt;
        const fade = Math.max(0, 1 - age / FADE_MS);
        drawGravestone(ctx, g, fade);
      });

      // Draw order: souls → ascending → living
      // Souls fade after 30 min
      const SOUL_FADE_MS = 30 * 60 * 1000;
      const toRemove: string[] = [];
      chickensRef.current.forEach((c) => {
        if (c.state === 'soul') {
          const soulAge = now - c.stateTimer;
          if (soulAge > SOUL_FADE_MS) { toRemove.push(c.id); return; }
          const soulFade = Math.max(0.05, 1 - soulAge / SOUL_FADE_MS);
          drawSoul(ctx, c, soulFade);
        }
      });
      toRemove.forEach((id) => chickensRef.current.delete(id));
      chickensRef.current.forEach((c) => { if (c.state === 'ascending') { updateAscending(c); drawAscending(ctx, c); } });
      chickensRef.current.forEach((c) => {
        if (c.state !== 'ascending' && c.state !== 'soul') {
          updateChicken(c, chickensRef.current);
          drawChicken(ctx, c);
        }
      });

      animRef.current = requestAnimationFrame(render);
    };
    animRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animRef.current);
  }, [syncChickens, claudeSessions]);

  return (
    <div className="pixel-farm" style={{ left: pos.x, top: pos.y }}>
      <div className="pixel-farm-header" onMouseDown={onDragStart}>
        <span className="pixel-farm-title">🐔 Agent Farm</span>
        <span className="pixel-farm-count">
          {Array.from(claudeSessions.values()).filter((s) => s.active).length} sessions
        </span>
        <button className="pixel-farm-close" onClick={onClose}>×</button>
      </div>
      <canvas ref={canvasRef} width={FARM_W} height={FARM_H} className="pixel-farm-canvas" />
    </div>
  );
}

function mkChicken(id: string, color: string, label: string, isHen: boolean, parentId?: string): Chicken {
  return {
    id, color, label, isHen, parentId, cost: '', frame: 0,
    x: 40 + Math.random() * (FARM_W - 80), y: GROUND_Y - 10 + Math.random() * 12,
    targetX: FARM_W / 2, targetY: GROUND_Y - 8,
    direction: Math.random() > 0.5 ? 'right' : 'left',
    state: 'idle', stateTimer: Math.random() * 80,
    soulY: 20, opacity: 1, zoneX: FARM_W / 2,
  };
}

// ─── Farm background ───
function drawFarm(ctx: CanvasRenderingContext2D) {
  const sky = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
  sky.addColorStop(0, '#0a1628'); sky.addColorStop(1, '#162035');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, FARM_W, GROUND_Y);
  // Heaven zone (top area with glow)
  const heavenH = 50;
  const heavenGlow = ctx.createLinearGradient(0, 0, 0, heavenH);
  heavenGlow.addColorStop(0, 'rgba(240, 224, 96, 0.06)');
  heavenGlow.addColorStop(1, 'rgba(240, 224, 96, 0)');
  ctx.fillStyle = heavenGlow;
  ctx.fillRect(0, 0, FARM_W, heavenH);

  // Heaven border line
  ctx.strokeStyle = 'rgba(240, 224, 96, 0.08)';
  ctx.setLineDash([4, 6]);
  ctx.beginPath(); ctx.moveTo(10, heavenH); ctx.lineTo(FARM_W - 10, heavenH); ctx.stroke();
  ctx.setLineDash([]);

  // Clouds
  ctx.fillStyle = '#ffffff08';
  ctx.beginPath(); ctx.ellipse(60, 18, 20, 8, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(180, 12, 25, 6, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(320, 20, 18, 7, 0, 0, Math.PI * 2); ctx.fill();

  // Heaven label
  ctx.fillStyle = '#f0e06030'; ctx.font = 'bold 8px monospace'; ctx.textAlign = 'center';
  ctx.fillText('✦ HEAVEN ✦', FARM_W / 2, 10);

  // Stars
  ctx.fillStyle = '#ffffff10';
  for (let i = 0; i < 25; i++) ctx.fillRect((i * 97 + 13) % FARM_W, (i * 53 + 7) % (GROUND_Y - 20), 1, 1);
  ctx.fillStyle = '#1a2810'; ctx.fillRect(0, GROUND_Y - 5, FARM_W, FARM_H - GROUND_Y + 5);
  ctx.fillStyle = '#2a4015';
  for (let x = 0; x < FARM_W; x += 10) { ctx.fillRect(x, GROUND_Y - 5, 2, 3); ctx.fillRect(x + 5, GROUND_Y - 4, 2, 2); }
  ctx.fillStyle = '#5c4033';
  for (let x = 8; x < FARM_W - 8; x += 28) ctx.fillRect(x, GROUND_Y - 18, 2, 18);
  ctx.fillRect(8, GROUND_Y - 16, FARM_W - 16, 2);
  ctx.fillRect(8, GROUND_Y - 9, FARM_W - 16, 2);
}

// ─── Gravestone ───
function drawGravestone(ctx: CanvasRenderingContext2D, g: Gravestone, fade: number = 1) {
  ctx.save();
  ctx.globalAlpha = fade;

  ctx.fillStyle = '#4a4a4a'; ctx.fillRect(g.x - 3, g.y - 8, 6, 8);
  ctx.fillStyle = '#5a5a5a'; ctx.fillRect(g.x - 2, g.y - 9, 4, 2);
  ctx.fillStyle = '#3a3a3a'; ctx.fillRect(g.x - 4, g.y - 1, 8, 2);
  ctx.fillStyle = '#666'; ctx.fillRect(g.x, g.y - 7, 1, 4); ctx.fillRect(g.x - 1, g.y - 6, 3, 1);

  if (g.cost) {
    ctx.fillStyle = '#8b949e'; ctx.font = '5px monospace'; ctx.textAlign = 'center';
    ctx.fillText(g.cost, g.x, g.y + 8);
  }
  ctx.restore();
}

// ─── Living chicken ───
function drawChicken(ctx: CanvasRenderingContext2D, c: Chicken) {
  const flip = c.direction === 'left' ? -1 : 1;
  const bob = c.state === 'walking' ? Math.sin(c.frame * 0.3) * 1.5 : 0;
  const x = Math.round(c.x), y = Math.round(c.y + bob);
  ctx.save(); ctx.translate(x, y); ctx.scale(flip, 1);
  if (c.isHen) {
    ctx.fillStyle = c.color; ctx.fillRect(-6, -4, 12, 8); ctx.fillRect(4, -8, 6, 6);
    ctx.fillStyle = '#fff'; ctx.fillRect(7, -7, 2, 2);
    ctx.fillStyle = '#000'; ctx.fillRect(8, -7, 1, 1);
    ctx.fillStyle = '#f0c040'; ctx.fillRect(10, -5, 3, 2);
    ctx.fillStyle = '#e03030'; ctx.fillRect(5, -10, 2, 3); ctx.fillRect(7, -11, 2, 3);
    ctx.fillStyle = c.color; ctx.globalAlpha = 0.8;
    ctx.fillRect(-8, -8, 3, 5); ctx.fillRect(-9, -6, 2, 3); ctx.globalAlpha = 1;
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
  if (c.label) { ctx.fillStyle = '#ffffffa0'; ctx.font = 'bold 7px "JetBrains Mono", monospace'; ctx.fillText(c.label, x, y - (c.isHen ? 14 : 7)); }
  if (c.cost) { ctx.fillStyle = '#3fb950'; ctx.font = '7px "JetBrains Mono", monospace'; ctx.fillText(c.cost, x, y - (c.isHen ? 20 : 11)); }
}

// ─── Ascending ───
function updateAscending(c: Chicken) {
  c.frame++; c.y -= 0.7; c.opacity = Math.max(0.1, 1 - (GROUND_Y - c.y) / (GROUND_Y - c.soulY));
  c.x += Math.sin(c.frame * 0.08) * 0.3;
  if (c.y <= c.soulY + 3) { c.state = 'soul'; c.y = c.soulY; c.opacity = 0.4; c.stateTimer = Date.now(); /* mark soul birth */ }
}

function drawAscending(ctx: CanvasRenderingContext2D, c: Chicken) {
  const x = Math.round(c.x), y = Math.round(c.y);
  ctx.save(); ctx.globalAlpha = c.opacity;
  ctx.fillStyle = '#f0e060'; ctx.shadowColor = '#f0e060'; ctx.shadowBlur = 6;
  ctx.fillRect(x - 3, y - 2, 6, 5); ctx.fillRect(x + 1, y - 4, 4, 3); ctx.shadowBlur = 0;
  ctx.fillStyle = '#fff';
  for (let i = 0; i < 3; i++) ctx.fillRect(x + Math.sin(c.frame * 0.15 + i * 2) * 8, y + Math.cos(c.frame * 0.12 + i * 3) * 5 - 3, 1, 1);
  ctx.fillStyle = '#ffffff40';
  const w = Math.sin(c.frame * 0.4) * 2;
  ctx.fillRect(x - 5, y - 1 + w, 3, 2); ctx.fillRect(x + 4, y - 1 - w, 3, 2);
  ctx.restore();
  if (c.cost) { ctx.globalAlpha = c.opacity; ctx.fillStyle = '#3fb950'; ctx.font = '7px "JetBrains Mono", monospace'; ctx.textAlign = 'center'; ctx.fillText(c.cost, x, y - 8); ctx.globalAlpha = 1; }
}

// ─── Soul ───
function drawSoul(ctx: CanvasRenderingContext2D, c: Chicken, fade: number = 1) {
  const x = Math.round(c.x), y = Math.round(c.y), bob = Math.sin(c.frame++ * 0.03) * 2;
  ctx.save(); ctx.globalAlpha = 0.3 * fade;
  ctx.fillStyle = '#fff'; ctx.fillRect(x - 2, y - 1 + bob, 5, 4); ctx.fillRect(x, y - 3 + bob, 3, 2);
  ctx.strokeStyle = '#f0e060'; ctx.lineWidth = 0.5;
  ctx.beginPath(); ctx.ellipse(x + 1, y - 4 + bob, 4, 1.5, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
  if (c.cost) { ctx.globalAlpha = 0.4 * fade; ctx.fillStyle = '#3fb950'; ctx.font = 'bold 7px "JetBrains Mono", monospace'; ctx.textAlign = 'center'; ctx.fillText(c.cost, x + 1, y + 10 + bob); }
  if (c.label) { ctx.globalAlpha = 0.15 * fade; ctx.fillStyle = '#fff'; ctx.font = '6px monospace'; ctx.textAlign = 'center'; ctx.fillText(c.label, x + 1, y + 17 + bob); }
  ctx.globalAlpha = 1;
}

// ─── Update ───
function updateChicken(c: Chicken, all: Map<string, Chicken>) {
  c.frame++; c.stateTimer--;
  // Chicks follow parent within zone
  if (!c.isHen && c.parentId) {
    const p = all.get(c.parentId);
    if (p) { c.targetX = p.x + Math.sin(c.frame * 0.05 + c.x) * 12; c.targetY = p.y + 6 + Math.cos(c.frame * 0.03) * 3; }
  }
  if (c.stateTimer <= 0 && c.isHen) {
    const r = Math.random();
    const range = 30;
    if (r < 0.5) { c.state = 'walking'; c.targetX = c.zoneX - range + Math.random() * range * 2; c.targetY = GROUND_Y - 8 + Math.random() * 10; c.stateTimer = 60 + Math.random() * 100; }
    else if (r < 0.75) { c.state = 'pecking'; c.stateTimer = 20 + Math.random() * 30; }
    else { c.state = 'idle'; c.stateTimer = 30 + Math.random() * 60; }
  }
  if (c.state === 'walking' || !c.isHen) {
    const spd = c.isHen ? 0.4 : 0.7;
    c.x += (c.targetX - c.x) * 0.02 * spd; c.y += (c.targetY - c.y) * 0.02 * spd;
    c.direction = (c.targetX - c.x) > 0 ? 'right' : 'left';
  }
  c.x = Math.max(10, Math.min(FARM_W - 10, c.x));
  c.y = Math.max(GROUND_Y - 12, Math.min(FARM_H - 10, c.y));
}
