import type { Completion } from '../hooks/use-autocomplete';
import './Autocomplete.css';

interface AutocompleteProps {
  suggestions: Completion[];
  selectedIndex: number;
  visible: boolean;
  cursorX: number;
  cursorY: number;
  terminalElement: HTMLElement | null;
}

export function Autocomplete({
  suggestions,
  selectedIndex,
  visible,
  cursorX,
  cursorY,
  terminalElement,
}: AutocompleteProps) {
  if (!visible || suggestions.length === 0 || !terminalElement) return null;

  // Calculate pixel position from terminal cursor
  // xterm cell size: approximate from font metrics
  const cellWidth = 7.8; // ~13px font @ monospace
  const cellHeight = 15.6; // 13px * 1.2 line-height
  const rect = terminalElement.getBoundingClientRect();
  const padding = { left: 8, top: 4 }; // terminal-container padding

  const left = rect.left + padding.left + cursorX * cellWidth;
  const top = rect.top + padding.top + (cursorY + 1) * cellHeight + 2;

  // If dropdown would go off bottom, show above cursor
  const dropdownHeight = Math.min(suggestions.length, 10) * 28 + 8;
  const showAbove = top + dropdownHeight > window.innerHeight - 30;
  const finalTop = showAbove
    ? rect.top + padding.top + cursorY * cellHeight - dropdownHeight - 2
    : top;

  return (
    <div
      className="autocomplete-dropdown"
      style={{ left: `${left}px`, top: `${finalTop}px` }}
    >
      {suggestions.map((s, i) => (
        <div
          key={s.name}
          className={`autocomplete-item ${i === selectedIndex ? 'selected' : ''}`}
        >
          <span className={`ac-kind ac-kind-${s.kind}`}>
            {s.kind === 'flag' ? '⚑' : s.kind === 'option' ? '◆' : '▸'}
          </span>
          <span className="ac-name">{s.name}</span>
          {s.description && (
            <span className="ac-desc">{truncate(s.description, 40)}</span>
          )}
        </div>
      ))}
      <div className="autocomplete-hint">
        <span>Tab accept</span>
        <span>↑↓ navigate</span>
        <span>Esc dismiss</span>
      </div>
    </div>
  );
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}
