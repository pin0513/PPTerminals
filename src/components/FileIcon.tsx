interface Props {
  name: string;
  isDir: boolean;
  extension: string | null;
}

const EXT_COLORS: Record<string, string> = {
  ts: '#3178c6',
  tsx: '#3178c6',
  js: '#f7df1e',
  jsx: '#f7df1e',
  json: '#cb8f32',
  md: '#519aba',
  rs: '#dea584',
  toml: '#9c4121',
  css: '#563d7c',
  html: '#e44d26',
  yaml: '#cb171e',
  yml: '#cb171e',
  lock: '#484f58',
  svg: '#ffb13b',
  png: '#a074c4',
  jpg: '#a074c4',
  gif: '#a074c4',
  gitignore: '#f05032',
};

const DIR_NAMES: Record<string, string> = {
  src: '#42a5f5',
  'src-tauri': '#dea584',
  node_modules: '#8b949e',
  '.claude': '#cc7832',
  '.vscode': '#007acc',
  '.git': '#f05032',
  public: '#4caf50',
  dist: '#ff9800',
  target: '#dea584',
};

export function FileIcon({ name, isDir, extension }: Props) {
  if (isDir) {
    const color = DIR_NAMES[name] || '#8b949e';
    return (
      <span className="file-icon" style={{ color }}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
          <path d="M1.5 1h5l1 1H14.5l.5.5V13.5l-.5.5h-13l-.5-.5v-12l.5-.5zM2 2v11h12V3H7.29l-1-1H2z" />
        </svg>
      </span>
    );
  }

  const ext = extension?.toLowerCase() || '';
  const dotName = name.startsWith('.') ? name.slice(1) : '';
  const color = EXT_COLORS[ext] || EXT_COLORS[dotName] || '#8b949e';

  return (
    <span className="file-icon" style={{ color }}>
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
        <path d="M13.71 4.29l-3-3L10 1H4L3 2v12l1 1h9l1-1V5l-.29-.71zM13 14H4V2h5v4h4v8z" />
      </svg>
    </span>
  );
}
