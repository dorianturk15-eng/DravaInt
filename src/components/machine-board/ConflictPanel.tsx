import { useState } from 'react';
import type { BoardConflict } from '../../scheduling/boardConflicts';
import type { Machine } from '../../machines/MachinesContext';

interface ConflictPanelProps {
  conflicts: BoardConflict[];
  locale: string;
  onFocus: (conflict: BoardConflict) => void;
  onShiftLater: (conflict: BoardConflict) => void;
  getMoveOptions: (slotKey: string) => Machine[];
  onMoveTo: (slotKey: string, machineName: string) => void;
  onViewInGantt?: (jobId: number) => void;
  onClose: () => void;
  labels: {
    title: string;
    none: string;
    shiftLater: string;
    moveTo: string;
    viewInGantt: string;
    overlaps: string;
    noFreeMachine: string;
    close: string;
  };
}

function opLabel(order: string, opPosition: number | null, opName?: string): string {
  if (opPosition == null) return order;
  return `${order} op ${opPosition}${opName ? ` "${opName}"` : ''}`;
}

function timeShort(ms: number, locale: string): string {
  return new Date(ms).toLocaleString(locale, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
}

export function ConflictPanel({ conflicts, locale, onFocus, onShiftLater, getMoveOptions, onMoveTo, onViewInGantt, onClose, labels }: ConflictPanelProps) {
  // Which conflict row's "Move to…" dropdown is open (by key), and which side of it to move.
  const [moveFor, setMoveFor] = useState<{ conflictKey: string; slotKey: string } | null>(null);

  return (
    <section className="board-conflict-panel" aria-label={labels.title}>
      <header>
        <strong>{labels.title} ({conflicts.length})</strong>
        <button type="button" className="board-toolbar-btn" onClick={onClose} aria-label={labels.close}>×</button>
      </header>
      {conflicts.length === 0 ? (
        <p className="board-conflict-panel-empty">{labels.none}</p>
      ) : (
        <ul className="board-conflict-panel-list">
          {conflicts.map((conflict) => {
            // The later-starting side is the natural "Move to…" target.
            const later = conflict.a.startMs <= conflict.b.startMs ? conflict.b : conflict.a;
            const moveOpen = moveFor?.conflictKey === conflict.key;
            const moveOptions = moveOpen ? getMoveOptions(moveFor!.slotKey) : [];
            return (
              <li key={conflict.key} className="board-conflict-panel-row">
                <button type="button" className="board-conflict-panel-row-main" onClick={() => onFocus(conflict)}>
                  <span className="board-conflict-panel-row-title">
                    {opLabel(conflict.a.order, conflict.a.opPosition, conflict.a.opName)} ⟷ {opLabel(conflict.b.order, conflict.b.opPosition, conflict.b.opName)}
                  </span>
                  <span className="board-conflict-panel-row-detail">
                    {conflict.machineName} · {timeShort(conflict.a.startMs, locale)}–{timeShort(conflict.a.endMs, locale)} {labels.overlaps} {timeShort(conflict.b.startMs, locale)}–{timeShort(conflict.b.endMs, locale)}
                  </span>
                </button>
                <div className="board-conflict-panel-row-actions">
                  <button type="button" className="board-toolbar-btn" onClick={() => onShiftLater(conflict)}>{labels.shiftLater}</button>
                  <button type="button" className="board-toolbar-btn" onClick={() => setMoveFor(moveOpen ? null : { conflictKey: conflict.key, slotKey: later.slotKey })}>{labels.moveTo}</button>
                  {onViewInGantt && <button type="button" className="board-toolbar-btn" onClick={() => onViewInGantt(later.jobId)}>{labels.viewInGantt}</button>}
                </div>
                {moveOpen && (
                  <div className="board-conflict-move-options">
                    {moveOptions.length === 0
                      ? <span className="board-conflict-panel-row-detail">{labels.noFreeMachine}</span>
                      : moveOptions.map((machine) => (
                        <button key={machine.id} type="button" className="board-toolbar-btn" onClick={() => { setMoveFor(null); onMoveTo(later.slotKey, machine.name); }}>{machine.name}</button>
                      ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
