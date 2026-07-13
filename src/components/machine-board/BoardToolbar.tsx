import type { TranslationShape } from '../../i18n/translations';
import type { ZoomPreset } from '../../scheduling/boardGeometry';
import { ZOOM_ORDER } from '../../scheduling/boardGeometry';
import type { SortBy } from './useMachineBoardController';
import { IconRefresh } from '../Icons';

interface BoardToolbarProps {
  t: TranslationShape['machineBoard'];
  zoom: ZoomPreset;
  onZoomChange: (zoom: ZoomPreset) => void;
  sortBy: SortBy;
  onSortChange: (sort: SortBy) => void;
  connectMode: boolean;
  onToggleConnectMode: () => void;
  onScrollToday: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}

const ZOOM_LABEL_KEY: Record<ZoomPreset, keyof TranslationShape['machineBoard']> = {
  hour: 'zoomHour',
  shift: 'zoomShift',
  day: 'zoomDay',
  week: 'zoomWeek',
};

export function BoardToolbar({ t, zoom, onZoomChange, sortBy, onSortChange, connectMode, onToggleConnectMode, onScrollToday, canUndo, canRedo, onUndo, onRedo }: BoardToolbarProps) {
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
      <div className="board-toolbar-group">
        <button type="button" className="board-toolbar-btn" onClick={onUndo} disabled={!canUndo} aria-label={t.undo}>
          <IconRefresh style={{ transform: 'scaleX(-1)' }} />
        </button>
        <button type="button" className="board-toolbar-btn" onClick={onRedo} disabled={!canRedo} aria-label={t.redo}>
          <IconRefresh />
        </button>
      </div>
    </div>
  );
}
