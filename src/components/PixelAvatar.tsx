import { useMemo } from 'react';
import './PixelAvatar.css';

interface PixelAvatarProps {
  name: string;
  size?: number;      // px, default 28
  isActive?: boolean;
  isClone?: boolean;
  index?: number;     // for clone offset animation
}

// Generate a deterministic hash from string
function hash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

// HSL color palette based on hash
function hashToColor(h: number, offset: number): string {
  const hue = (h + offset * 60) % 360;
  const sat = 60 + (h % 30);
  const lit = 50 + (h % 15);
  return `hsl(${hue}, ${sat}%, ${lit}%)`;
}

/**
 * Generate a 5x5 symmetric pixel grid (like GitHub identicons).
 * Only the left half + center column are random; right half mirrors.
 */
function generateGrid(seed: number): boolean[][] {
  const grid: boolean[][] = [];
  for (let y = 0; y < 5; y++) {
    const row: boolean[] = [];
    for (let x = 0; x < 3; x++) {
      // Use different bits of the hash for each cell
      const bit = (seed >> (y * 3 + x)) & 1;
      row.push(bit === 1);
    }
    // Mirror: [0,1,2] → [0,1,2,1,0]
    grid.push([row[0], row[1], row[2], row[1], row[0]]);
  }
  return grid;
}

export function PixelAvatar({ name, size = 28, isActive = false, isClone = false, index = 0 }: PixelAvatarProps) {
  const { grid, fg, bg } = useMemo(() => {
    const h = hash(name);
    return {
      grid: generateGrid(h),
      fg: hashToColor(h, 0),
      bg: hashToColor(h, 4),
    };
  }, [name]);

  const cellSize = size / 7; // 5 cells + 1px padding each side
  const pad = cellSize;

  return (
    <div
      className={`pixel-avatar-wrap ${isActive ? 'active' : ''} ${isClone ? 'clone' : ''}`}
      style={{
        width: size,
        height: size,
        animationDelay: isClone ? `${index * 0.15}s` : undefined,
      }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ borderRadius: size * 0.2 }}
      >
        <rect width={size} height={size} fill={bg} rx={size * 0.2} />
        {grid.map((row, y) =>
          row.map((on, x) =>
            on ? (
              <rect
                key={`${x}-${y}`}
                x={pad + x * cellSize}
                y={pad + y * cellSize}
                width={cellSize}
                height={cellSize}
                fill={fg}
                rx={0.5}
              />
            ) : null
          )
        )}
      </svg>
    </div>
  );
}

/**
 * Row of avatars: main + clones (sub-agents).
 */
export function AvatarGroup({
  name,
  subAgentCount,
  isActive,
}: {
  name: string;
  subAgentCount: number;
  isActive: boolean;
}) {
  return (
    <div className="avatar-group">
      <PixelAvatar name={name} size={28} isActive={isActive} />
      {Array.from({ length: Math.min(subAgentCount, 4) }).map((_, i) => (
        <PixelAvatar
          key={i}
          name={`${name}-sub-${i}`}
          size={20}
          isActive={isActive}
          isClone
          index={i}
        />
      ))}
    </div>
  );
}
