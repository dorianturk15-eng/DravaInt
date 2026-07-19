import type { OperationSlot } from './operationSlots';

/**
 * Board-level conflict surfacing (Phase D made visible).
 *
 * Phase D's {@link import('./jobOperations').detectOperationOverlaps} is the tested mirror of the SQL
 * warn-mode detector, but it returns only `(jobId, seq, otherJobId, otherSeq, machineName)` — enough
 * for a count, not enough to badge the exact card on screen, name the operations, or show the times.
 *
 * This module runs the *same* overlap rule (same machine key, same "at least one side is a real
 * operation" exclusion of plain-vs-plain, same de-dup from the lower job id) directly over the board's
 * rendered {@link OperationSlot}s. Because the slots already carry their resolved machine identity,
 * window, operation name and stable key, the result is self-consistent with what the user sees: the
 * chip count equals the number of badged pairs equals what pulses when a panel row is clicked. For the
 * common case (routed orders whose start isn't dependency-cascaded) it agrees with the SQL detector.
 */

export interface ConflictSide {
  slotKey: string;
  jobId: number;
  order: string;
  /** Operation name (routed) or undefined (plain/synthetic). */
  opName?: string;
  /** 1-based operation position for display ("op 2"); null for a plain/synthetic slot. */
  opPosition: number | null;
  machineName: string;
  startMs: number;
  endMs: number;
  isOperation: boolean;
}

export interface BoardConflict {
  /** Stable key for the unordered pair: `${loJobId}:${loSeq}|${hiJobId}:${hiSeq}`. */
  key: string;
  /** Resolution key both sides share (`id:N` or `name:x`) — the lane they collide on. */
  machineKey: string;
  machineName: string;
  /** Lower job-id side (deterministic ordering, matching the SQL detector's de-dup). */
  a: ConflictSide;
  b: ConflictSide;
  /** The overlapping sub-window (max start … min end). */
  overlapStartMs: number;
  overlapEndMs: number;
}

function machineKeyOf(slot: OperationSlot): string {
  return slot.machineId != null ? `id:${slot.machineId}` : `name:${slot.machine.trim().toLowerCase()}`;
}

function sideOf(slot: OperationSlot): ConflictSide {
  return {
    slotKey: slot.key,
    jobId: slot.jobId,
    order: slot.job.order,
    opName: slot.isOperation ? slot.name : undefined,
    opPosition: slot.opIndex != null ? slot.opIndex + 1 : null,
    machineName: slot.machine,
    startMs: slot.startMs,
    endMs: slot.endMs,
    isOperation: slot.isOperation,
  };
}

function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Every double-booking among the given slots: two slots on the same machine whose windows overlap,
 * where at least one side is a real routed operation (plain-vs-plain is left to the legacy hard-
 * enforced `machine`-string check, exactly as the SQL detector does). Same job never conflicts with
 * itself. Each unordered pair is reported once.
 */
export function detectBoardConflicts(slots: OperationSlot[]): BoardConflict[] {
  const byMachine = new Map<string, OperationSlot[]>();
  for (const slot of slots) {
    if (slot.job.status === 'done') continue; // a finished op no longer contends for the machine
    const key = machineKeyOf(slot);
    const list = byMachine.get(key);
    if (list) list.push(slot);
    else byMachine.set(key, [slot]);
  }

  const conflicts: BoardConflict[] = [];
  for (const [key, machineSlots] of byMachine) {
    const sorted = [...machineSlots].sort((x, y) => x.startMs - y.startMs);
    for (let i = 0; i < sorted.length; i++) {
      for (let k = i + 1; k < sorted.length; k++) {
        const a = sorted[i];
        const b = sorted[k];
        if (b.startMs >= a.endMs) break; // sorted by start: nothing further can overlap a
        if (a.jobId === b.jobId) continue;
        if (!a.isOperation && !b.isOperation) continue; // plain-vs-plain: legacy check owns it
        if (!rangesOverlap(a.startMs, a.endMs, b.startMs, b.endMs)) continue;
        const [lo, hi] = a.jobId <= b.jobId ? [a, b] : [b, a];
        conflicts.push({
          key: `${lo.jobId}:${lo.opIndex ?? 0}|${hi.jobId}:${hi.opIndex ?? 0}`,
          machineKey: key,
          machineName: a.machine,
          a: sideOf(lo),
          b: sideOf(hi),
          overlapStartMs: Math.max(a.startMs, b.startMs),
          overlapEndMs: Math.min(a.endMs, b.endMs),
        });
      }
    }
  }
  return conflicts;
}

/** Set of every slot key involved in any conflict — the cards that should badge. */
export function conflictingSlotKeys(conflicts: BoardConflict[]): Set<string> {
  const keys = new Set<string>();
  for (const conflict of conflicts) {
    keys.add(conflict.a.slotKey);
    keys.add(conflict.b.slotKey);
  }
  return keys;
}

/** Map from a slot key to the conflicts that slot participates in (for per-card popovers). */
export function conflictsBySlot(conflicts: BoardConflict[]): Map<string, BoardConflict[]> {
  const map = new Map<string, BoardConflict[]>();
  const push = (key: string, conflict: BoardConflict) => {
    const list = map.get(key);
    if (list) list.push(conflict);
    else map.set(key, [conflict]);
  };
  for (const conflict of conflicts) {
    push(conflict.a.slotKey, conflict);
    push(conflict.b.slotKey, conflict);
  }
  return map;
}
