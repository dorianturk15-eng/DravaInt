import type { TranslationShape } from '../../i18n/translations';
import type { ZoomPreset } from '../../scheduling/boardGeometry';
import { ZOOM_ORDER } from '../../scheduling/boardGeometry';
import type { SortBy } from './useMachineBoardController';
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
  connectMode: boolean;
  onToggleConnectMode: () => void;
  onScrollToday: () => void;
  onAutoSchedule: () => void;
  onExportCsv: () => void;
  canUndo: boolean;
  canRedo: boolean;
  historyDepth: number;
  futureDepth: number;
  onUndo: () => void;
  onRedo: () => void;
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
  connectMode,
  onToggleConnectMode,
  onScrollToday,
  onAutoSchedule,
  onExportCsv,
  canUndo,
  canRedo,
  historyDepth,
  futureDepth,
  onUndo,
  onRedo,
}: BoardToolbarProps) {
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
      <div className="board-toolbar-group" role="group" aria-label={t.conflicts}>
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
      <select className="board-toolbar-select" value={sortBy} onChange={(event) => onSortChange(event.target.value as SortBy)}>
        <option value="name">{t.sortByName}</option>
        <option value="load">{t.sortByLoad}</option>
      </select>
      <button type="button" className={`board-toolbar-btn${connectMode ? ' active' : ''}`} onClick={onToggleConnectMode} title={t.connectModeHint}>
        {t.connectMode}
      </button>
      <button type="button" className="board-toolbar-btn" onClick={onScrollToday}>
        {t.scrollToday}
      </button>
      <button type="button" className="board-toolbar-btn" onClick={onAutoSchedule}>
        {t.autoSchedule}
      </button>
      <button type="button" className="board-toolbar-btn" onClick={onExportCsv}>
        {t.exportCsv}
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
    </div>
  );
}
