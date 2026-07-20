import { useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import type { JobConflicts } from '../../scheduling/cpm';
import type { OperationSlot } from '../../scheduling/operationSlots';
import type { BoardConflict } from '../../scheduling/boardConflicts';
import type { Machine } from '../../machines/MachinesContext';
import type { CardEdge } from '../../scheduling/boardGeometry';
import type { CardLayout } from './useMachineBoardController';
import { IconAlert } from '../Icons';

interface TaskCardProps {
  slot: OperationSlot;
  layout: CardLayout;
  color: string;
  /** Machine-overlap conflicts this specific slot participates in (per-operation, not job-level). */
  slotConflicts: BoardConflict[];
  /** Job-level checks (operator overlap, qualification, shift, hours, rest) — shown on the first slot only. */
  jobConflicts: JobConflicts;
  locale: string;
  selected: boolean;
  isDragging: boolean;
  isConnectSource: boolean;
  isPulsing: boolean;
  dimmed: boolean;
  horizontalLocked: boolean;
  lockHint: string;
  liveOffset?: { x: number; y: number } | null;
  /** Live edge-resize preview: dx moves the left edge, dw changes the width. */
  liveResize?: { dx: number; dw: number } | null;
  conflictsOpen: boolean;
  onToggleConflicts: () => void;
  getMoveOptions: (slotKey: string) => Machine[];
  onShiftLater: (conflict: BoardConflict) => void;
  onMoveTo: (slotKey: string, machineName: string) => void;
  onViewInGantt?: (jobId: number) => void;
  labels: { shiftLater: string; moveTo: string; viewInGantt: string; overlaps: string; noFreeMachine: string };
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onResizePointerDown: (event: ReactPointerEvent<HTMLDivElement>, edge: 'start' | 'end') => void;
  onConnectPointerDown: (event: ReactPointerEvent<HTMLDivElement>, edge: CardEdge) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onToggleSelect: (additive: boolean) => void;
  onRemove: () => void;
}

function jobLevelMessages(conflicts: JobConflicts): string[] {
  return [
    conflicts.operatorOverlap && `Operator overlap: ${conflicts.operatorOverlap.otherOrder}`,
    conflicts.unqualified?.message,
    conflicts.shiftOutside?.message,
    conflicts.hoursExceeded?.message,
    conflicts.restViolation?.message,
    conflicts.absent?.message,
  ].filter(Boolean) as string[];
}

function timeShort(ms: number, locale: string): string {
  return new Date(ms).toLocaleString(locale, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
}

export function TaskCard({
  slot,
  layout,
  color,
  slotConflicts,
  jobConflicts,
  locale,
  selected,
  isDragging,
  isConnectSource,
  isPulsing,
  dimmed,
  horizontalLocked,
  lockHint,
  liveOffset,
  liveResize,
  conflictsOpen,
  onToggleConflicts,
  getMoveOptions,
  onShiftLater,
  onMoveTo,
  onViewInGantt,
  labels,
  onPointerDown,
  onResizePointerDown,
  onConnectPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onToggleSelect,
  onRemove,
}: TaskCardProps) {
  const job = slot.job;
  const isRoutePart = slot.slotCount > 1;
  const title = job.order || slot.machine;
  const subtitle = slot.isOperation ? slot.name || slot.machine : slot.operator || job.operator || '—';
  const jobMessages = slot.isFirstSlot ? jobLevelMessages(jobConflicts) : [];
  const flagged = slotConflicts.length > 0 || jobMessages.length > 0;
  const [moveOpen, setMoveOpen] = useState(false);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onToggleSelect(event.shiftKey || event.ctrlKey || event.metaKey);
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      onRemove();
    }
  }

  const moveOptions = moveOpen ? getMoveOptions(slot.key) : [];

  return (
    <div
      className={`board-task-card${slot.isOperation ? ' is-operation' : ''}${slot.isChainSegment ? ' is-chain-segment' : ''}${selected ? ' is-selected' : ''}${isDragging ? ' is-dragging' : ''}${isConnectSource ? ' is-connect-source' : ''}${flagged ? ' has-conflict' : ''}${isPulsing ? ' is-pulsing' : ''}${dimmed ? ' is-dimmed' : ''}${horizontalLocked ? ' is-locked' : ''}`}
      style={{
        left: layout.x + (liveResize?.dx ?? 0),
        top: layout.y,
        width: Math.max(8, layout.width + (liveResize?.dw ?? 0)),
        height: layout.height,
        borderLeftColor: color,
        touchAction: 'none',
        transform: liveOffset ? `translate(${liveOffset.x}px, ${liveOffset.y}px)` : undefined,
      }}
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
      {horizontalLocked && <span className="board-task-card-lock" title={lockHint} aria-hidden="true">🔒</span>}
      {/* Left handle only where the start can actually move: a plain card, or a route's FIRST
          operation. A later op's start is pinned by the ops before it, so no handle is offered. */}
      {slot.isFirstSlot && <div className="board-task-card-resize left" onPointerDown={(event) => onResizePointerDown(event, 'start')} title="Resize" />}
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
          {slotConflicts.map((conflict) => {
            const self = conflict.a.slotKey === slot.key ? conflict.a : conflict.b;
            const other = conflict.a.slotKey === slot.key ? conflict.b : conflict.a;
            return (
              <div key={conflict.key} className="board-conflict-detail">
                <span className="board-conflict-detail-line">
                  <strong>{other.order}</strong>{other.opName ? ` · ${other.opName}` : ''} · {conflict.machineName}
                </span>
                <span className="board-conflict-detail-times">
                  {timeShort(self.startMs, locale)}–{timeShort(self.endMs, locale)} {labels.overlaps} {timeShort(other.startMs, locale)}–{timeShort(other.endMs, locale)}
                </span>
                <div className="board-conflict-detail-actions">
                  <button type="button" className="board-toolbar-btn" onClick={(e) => { e.stopPropagation(); onShiftLater(conflict); }}>{labels.shiftLater}</button>
                  <button type="button" className="board-toolbar-btn" onClick={(e) => { e.stopPropagation(); setMoveOpen((v) => !v); }}>{labels.moveTo}</button>
                  {onViewInGantt && <button type="button" className="board-toolbar-btn" onClick={(e) => { e.stopPropagation(); onViewInGantt(job.id); }}>{labels.viewInGantt}</button>}
                </div>
                {moveOpen && (
                  <div className="board-conflict-move-options">
                    {moveOptions.length === 0
                      ? <span className="board-conflict-detail-times">{labels.noFreeMachine}</span>
                      : moveOptions.map((machine) => (
                        <button key={machine.id} type="button" className="board-toolbar-btn" onClick={(e) => { e.stopPropagation(); setMoveOpen(false); onMoveTo(slot.key, machine.name); }}>
                          {machine.name}
                        </button>
                      ))}
                  </div>
                )}
              </div>
            );
          })}
          {jobMessages.map((message) => <span key={message} className="board-conflict-detail-line">{message}</span>)}
        </div>
      )}
      {slot.isLastSlot && <div className="board-task-card-connect right" onPointerDown={(event) => onConnectPointerDown(event, 'end')} title="Drag to link" />}
      <div className="board-task-card-resize right" onPointerDown={(event) => onResizePointerDown(event, 'end')} title="Resize" />
      {isRoutePart && !slot.isLastSlot && <span className="board-task-card-chain-end" aria-hidden="true">›</span>}
    </div>
  );
}
