import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

export interface CommandItem {
  id: string;
  label: string;
  description: string;
  group: string;
  keywords?: string;
  shortcut?: string;
  icon?: ReactNode;
  run: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  commands: CommandItem[];
  language: 'hr' | 'en';
}

export function CommandPalette({ open, onClose, commands, language }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return commands;
    return commands.filter((command) => `${command.label} ${command.description} ${command.keywords ?? ''}`.toLocaleLowerCase().includes(needle));
  }, [commands, query]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIndex(0);
    window.setTimeout(() => inputRef.current?.focus(), 20);
  }, [open]);

  useEffect(() => setActiveIndex((index) => Math.min(index, Math.max(0, filtered.length - 1))), [filtered.length]);

  if (!open) return null;

  function run(command: CommandItem) {
    command.run();
    onClose();
  }

  return <div className="command-palette-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="command-palette" role="dialog" aria-modal="true" aria-label={language === 'hr' ? 'Paleta naredbi' : 'Command palette'}>
      <div className="command-search-row">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onClose();
            if (event.key === 'ArrowDown') { event.preventDefault(); setActiveIndex((index) => filtered.length ? (index + 1) % filtered.length : 0); }
            if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex((index) => filtered.length ? (index - 1 + filtered.length) % filtered.length : 0); }
            if (event.key === 'Enter' && filtered[activeIndex]) { event.preventDefault(); run(filtered[activeIndex]); }
          }}
          placeholder={language === 'hr' ? 'Traži modul ili naredbu…' : 'Search modules or actions…'}
          aria-label={language === 'hr' ? 'Traži naredbe' : 'Search commands'}
        />
        <kbd>ESC</kbd>
      </div>
      <div className="command-results" role="listbox">
        {filtered.length ? filtered.map((command, index) => {
          const previousGroup = filtered[index - 1]?.group;
          return <div key={command.id}>
            {command.group !== previousGroup && <div className="command-group-label">{command.group}</div>}
            <button className={index === activeIndex ? 'active' : ''} onMouseEnter={() => setActiveIndex(index)} onClick={() => run(command)} role="option" aria-selected={index === activeIndex}>
              <span className="command-item-icon">{command.icon ?? '→'}</span>
              <span><strong>{command.label}</strong><small>{command.description}</small></span>
              {command.shortcut && <kbd>{command.shortcut}</kbd>}
            </button>
          </div>;
        }) : <div className="command-empty"><strong>{language === 'hr' ? 'Nema rezultata' : 'No matching commands'}</strong><small>{language === 'hr' ? 'Pokušajte kraći ili drugačiji pojam.' : 'Try a shorter or different search.'}</small></div>}
      </div>
      <footer><span><kbd>↑</kbd><kbd>↓</kbd> {language === 'hr' ? 'odabir' : 'navigate'}</span><span><kbd>↵</kbd> {language === 'hr' ? 'pokreni' : 'run'}</span><span>DravaInt Command</span></footer>
    </section>
  </div>;
}
