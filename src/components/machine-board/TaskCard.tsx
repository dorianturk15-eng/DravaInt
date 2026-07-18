import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import type { JobConflicts } from '../../scheduling/cpm';
import type { OperationSlot } from '../../scheduling/operationSlots';
import type { CardEdge } from '../../scheduling/boardGeometry';
import type { CardLayout } from './useMachineBoardController';
import { IconAlert } from '../Icons';

interface TaskCardProps {
  slot: OperationSlot;
  layout: CardLayout;
  color: string;
  conflicts: JobConflicts;
  selected: boolean;
  isDragging: boolean;
  isConnectSource: boolean;
  conflictsOpen: boolean;
  onToggleConflicts: () => void;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onResizePointerDown: (event: ReactPointerEvent<HTMLDivElement>, edge: 'start' | 'end') => void;
  onConnectPointerDown: (event: ReactPointerEvent<HTMLDivElement>, edge: CardEdge) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onToggleSelect: (additive: boolean) => void;
  onRemove: () => void;
}

function hasAnyConflict(conflicts: JobConflicts): boolean {
  return Boolean(
    conflicts.machineOverlap || conflicts.operatorOverlap || conflicts.unqualified || conflicts.shiftOutside || conflicts.hoursExceeded || conflicts.restViolation,
  );
}

export function TaskCard({
  slot,
  layout,
  color,
  conflicts,
  selected,
  isDragging,
  isConnectSource,
  conflictsOpen,
  onToggleConflicts,
  onPointerDown,
  onResizePointerDown,
  onConnectPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onToggleSelect,
  onRemove,
}: TaskCardProps) {
  const flagged = hasAnyConflict(conflicts);
  const job = slot.job;
  // A route's operation cards are chained left→right; only the ends carry a connector handle
  // (dependencies are job-level), and a subtle chain glyph marks a card that has a sibling op.
  const isRoutePart = slot.slotCount > 1;
  const title = job.order || slot.machine;
  const subtitle = slot.isOperation ? slot.name || slot.machine : slot.operator || job.operator || '—';

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onToggleSelect(event.shiftKey || event.ctrlKey || event.metaKey);
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      onRemove();
    }
  }

  const conflictMessages = [
    conflicts.machineOverlap && `Machine overlap: ${conflicts.machineOverlap.otherOrder}`,
    conflicts.operatorOverlap && `Operator overlap: ${conflicts.operatorOverlap.otherOrder}`,
    conflicts.unqualified?.message,
    conflicts.shiftOutside?.message,
    conflicts.hoursExceeded?.message,
    conflicts.restViolation?.message,
  ].filter(Boolean) as string[];

  return (
    <div
      className={`board-task-card${slot.isOperation ? ' is-operation' : ''}${selected ? ' is-selected' : ''}${isDragging ? ' is-dragging' : ''}${isConnectSource ? ' is-connect-source' : ''}${flagged ? ' has-conflict' : ''}`}
      style={{ left: layout.x, top: layout.y, width: layout.width, height: layout.height, borderLeftColor: color, touchAction: 'none' }}
      data-job-id={job.id}
      data-slot-key={slot.key}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      aria-label={slot.isOperation ? `${title} · ${subtitle}` : title}
      aria-pressed={selected}
    >
      {!slot.isFirstSlot && <span className="board-task-card-chain" aria-hidden="true">‹</span>}
      <div className="board-task-card-resize left" onPointerDown={(event) => onResizePointerDown(event, 'start')} />
      {slot.isFirstSlot && <div className="board-task-card-connect left" onPointerDown={(event) => onConnectPointerDown(event, 'start')} title="Drag to link" />}
      <div className="board-task-card-body">
        <strong>{title}</strong>
        <small>{subtitle}</small>
        <div className="progress-bar-track">
          <div className="progress-bar-fill" style={{ width: `${job.progress}%`, background: job.status === 'done' ? 'var(--success-color)' : color }} />
        </div>
      </div>
      {flagged && (
        <button
          type="button"
          className="board-task-conflict-badge"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => { event.stopPropagation(); onToggleConflicts(); }}
          aria-label="Show warnings"
        >
          <IconAlert />
        </button>
      )}
      {flagged && conflictsOpen && (
        <div className="board-task-conflict-popover" onPointerDown={(event) => event.stopPropagation()}>
          {conflictMessages.map((message) => <span key={message}>{message}</span>)}
        </div>
      )}
      {slot.isLastSlot && <div className="board-task-card-connect right" onPointerDown={(event) => onConnectPointerDown(event, 'end')} title="Drag to link" />}
      <div className="board-task-card-resize right" onPointerDown={(event) => onResizePointerDown(event, 'end')} />
      {isRoutePart && !slot.isLastSlot && <span className="board-task-card-chain-end" aria-hidden="true">›</span>}
    </div>
  );
}
