import { useEffect, useRef, useState } from 'react';
import type { TranslationShape } from '../../i18n/translations';
import type { ZoomPreset } from '../../scheduling/boardGeometry';
import { ZOOM_ORDER } from '../../scheduling/boardGeometry';
import type { SortBy, BoardView } from './useMachineBoardController';
import type { JobStatus } from '../../scheduling/SchedulingContext';
import { IconRefresh } from '../Icons';

interface BoardToolbarProps {
  t: TranslationShape['machineBoard'];
  statusLabels: TranslationShape['progress']['statusOptions'];
  zoom: ZoomPreset;
  onZoomChange: (zoom: ZoomPreset) => void;
  sortBy: SortBy;
  onSortChange: (sort: SortBy) => void;
  statusFilter: JobStatus | 'all';
  onStatusFilterChange: (status: JobStatus | 'all') => void;
  query: string;
  onQueryChange: (value: string) => void;
  onQuerySubmit: () => void;
  conflictCount: number;
  conflictPanelOpen: boolean;
  onToggleConflicts: () => void;
  hideEmpty: boolean;
  onToggleHideEmpty: () => void;
  onShowLegend: () => void;
  connectMode: boolean;
  onToggleConnectMode: () => void;
  onScrollToday: () => void;
  onAutoSchedule: () => void;
  onExportCsv: () => void;
  onExportPng: () => void;
  onChainSelected: () => void;
  selectionCount: number;
  views: BoardView[];
  onSaveView: (name: string) => void;
  onApplyView: (id: string) => void;
  onDeleteView: (id: string) => void;
  canUndo: boolean;
  canRedo: boolean;
  historyDepth: number;
  futureDepth: number;
  onUndo: () => void;
  onRedo: () => void;
  compact?: boolean;
}

const ZOOM_LABEL_KEY: Record<ZoomPreset, keyof TranslationShape['machineBoard']> = {
  hour: 'zoomHour',
  shift: 'zoomShift',
  day: 'zoomDay',
  week: 'zoomWeek',
};

const STATUSES: JobStatus[] = ['planned', 'inProgress', 'done', 'delayed'];

export function BoardToolbar({
  t,
  statusLabels,
  zoom,
  onZoomChange,
  sortBy,
  onSortChange,
  statusFilter,
  onStatusFilterChange,
  query,
  onQueryChange,
  onQuerySubmit,
  conflictCount,
  conflictPanelOpen,
  onToggleConflicts,
  hideEmpty,
  onToggleHideEmpty,
  onShowLegend,
  connectMode,
  onToggleConnectMode,
  onScrollToday,
  onAutoSchedule,
  onExportCsv,
  onExportPng,
  onChainSelected,
  selectionCount,
  views,
  onSaveView,
  onApplyView,
  onDeleteView,
  canUndo,
  canRedo,
  historyDepth,
  futureDepth,
  onUndo,
  onRedo,
  compact,
}: BoardToolbarProps) {
  const [viewName, setViewName] = useState('');
  const [activeViewId, setActiveViewId] = useState('');
  const [overflowOpen, setOverflowOpen] = useState(false);
  const overflowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!overflowOpen) return;
    const close = (event: MouseEvent) => { if (overflowRef.current && !overflowRef.current.contains(event.target as Node)) setOverflowOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [overflowOpen]);

  const conflictChip = (
    <button
      type="button"
      className={`board-conflict-chip${conflictCount > 0 ? ' has-conflicts' : ''}${conflictPanelOpen ? ' active' : ''}`}
      onClick={onToggleConflicts}
      aria-pressed={conflictPanelOpen}
      title={t.conflictsTitle}
    >
      <span className="board-conflict-chip-dot" />
      {conflictCount > 0 ? `${t.conflictsTitle} (${conflictCount})` : t.noConflicts}
    </button>
  );

  const searchBox = (
    <input
      type="search"
      className="board-toolbar-search"
      placeholder={t.searchPlaceholder}
      aria-label={t.search}
      value={query}
      onChange={(event) => onQueryChange(event.target.value)}
      onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); onQuerySubmit(); } }}
    />
  );

  const statusFilterGroup = (
    <div className="board-toolbar-group board-toolbar-scroll" role="group" aria-label={t.conflicts}>
      <button type="button" className={`board-toolbar-btn${statusFilter === 'all' ? ' active' : ''}`} onClick={() => onStatusFilterChange('all')}>
        {t.filterAll}
      </button>
      {STATUSES.map((status) => (
        <button
          key={status}
          type="button"
          className={`board-toolbar-btn${statusFilter === status ? ' active' : ''}`}
          onClick={() => onStatusFilterChange(statusFilter === status ? 'all' : status)}
        >
          {statusLabels[status]}
        </button>
      ))}
    </div>
  );

  if (compact) {
    // Mobile has its own sticky conflict banner (MachineBoardMobile) and agenda interactions, so the
    // desktop-only conflict chip and search (which drive desktop-board state) are omitted here.
    return (
      <div className="board-toolbar board-toolbar-compact">
        {statusFilterGroup}
      </div>
    );
  }

  return (
    <div className="board-toolbar">
      <div className="board-toolbar-group" role="group" aria-label="Zoom">
        {ZOOM_ORDER.map((preset) => (
          <button
            key={preset}
            type="button"
            className={`board-toolbar-btn${zoom === preset ? ' active' : ''}`}
            onClick={() => onZoomChange(preset)}
          >
            {t[ZOOM_LABEL_KEY[preset]]}
          </button>
        ))}
      </div>
      {statusFilterGroup}
      {searchBox}
      {conflictChip}
      <button type="button" className="board-toolbar-btn" onClick={onScrollToday}>
        {t.scrollToday}
      </button>
      <div className="board-toolbar-group">
        <button type="button" className="board-toolbar-btn" onClick={onUndo} disabled={!canUndo} aria-label={t.undo} title={`${t.undo} (${historyDepth})`}>
          <IconRefresh style={{ transform: 'scaleX(-1)' }} />
          {historyDepth > 0 && <small>{historyDepth}</small>}
        </button>
        <button type="button" className="board-toolbar-btn" onClick={onRedo} disabled={!canRedo} aria-label={t.redo} title={`${t.redo} (${futureDepth})`}>
          <IconRefresh />
          {futureDepth > 0 && <small>{futureDepth}</small>}
        </button>
      </div>

      <div className="board-toolbar-overflow" ref={overflowRef}>
        <button type="button" className={`board-toolbar-btn${overflowOpen ? ' active' : ''}`} onClick={() => setOverflowOpen((v) => !v)} aria-haspopup="true" aria-expanded={overflowOpen} title={t.more}>
          ⋯
        </button>
        {overflowOpen && (
          <div className="board-toolbar-overflow-menu" role="menu">
            <label className="board-overflow-row">
              <span>{sortBy === 'name' ? t.sortByName : t.sortByLoad}</span>
              <select className="board-toolbar-select" value={sortBy} onChange={(event) => onSortChange(event.target.value as SortBy)}>
                <option value="name">{t.sortByName}</option>
                <option value="load">{t.sortByLoad}</option>
              </select>
            </label>
            <button type="button" className="board-overflow-item" onClick={onToggleHideEmpty}>{hideEmpty ? '☑' : '☐'} {t.hideEmpty}</button>
            <button type="button" className={`board-overflow-item${connectMode ? ' active' : ''}`} onClick={onToggleConnectMode}>{t.connectMode}</button>
            <button type="button" className="board-overflow-item" onClick={onChainSelected} disabled={selectionCount < 2}>{t.chainSelected}{selectionCount >= 2 ? ` (${selectionCount})` : ''}</button>
            <button type="button" className="board-overflow-item" onClick={onAutoSchedule}>{t.autoSchedule}</button>
            <button type="button" className="board-overflow-item" onClick={onExportCsv}>{t.exportCsv}</button>
            <button type="button" className="board-overflow-item" onClick={onExportPng}>{t.exportPng}</button>
            <button type="button" className="board-overflow-item" onClick={onShowLegend}>{t.legend}</button>
            <div className="board-overflow-views">
              <select
                className="board-toolbar-select"
                value={activeViewId}
                onChange={(event) => { setActiveViewId(event.target.value); if (event.target.value) onApplyView(event.target.value); }}
                aria-label={t.savedViews}
              >
                <option value="">{t.savedViews}</option>
                {views.map((view) => <option key={view.id} value={view.id}>{view.name}</option>)}
              </select>
              <div className="board-overflow-view-save">
                <input
                  type="text"
                  className="board-view-name-input"
                  placeholder={t.viewNamePlaceholder}
                  value={viewName}
                  onChange={(event) => setViewName(event.target.value)}
                />
                <button type="button" className="board-toolbar-btn" disabled={!viewName.trim()} onClick={() => { onSaveView(viewName); setViewName(''); }}>{t.saveView}</button>
                {activeViewId && (
                  <button type="button" className="board-toolbar-btn" onClick={() => { onDeleteView(activeViewId); setActiveViewId(''); }} aria-label={t.deleteView}>×</button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
