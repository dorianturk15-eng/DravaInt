/**
 * Shift rotation: who is on which shift, for a whole week at a time.
 *
 * The department rotates weekly — a worker holds one shift Monday to Friday and
 * steps to the next shift the following week. Two rules the original generator
 * got wrong or lacked:
 *
 * 1. **Phase was positional.** A worker's shift was a function of their index in
 *    the roster array: `definitions[(worker_index + week_index) % count]`.
 *    Deselecting one worker shifted every worker after them onto a different
 *    shift on the next regenerate, silently rewriting already-planned weeks.
 *    Phase is now anchored to the worker's *own* previous week — "I was on
 *    second last week, so I'm on third now" — which is both how the crew thinks
 *    and idempotent under roster edits. The positional formula survives only as
 *    the seed for a worker with no history at all.
 *
 * 2. **No fixed group.** Some workers never rotate. `fixedShiftDefinitionId` on
 *    the worker pins them; they simply do not participate in the rotation. If
 *    the pinned definition is inactive the worker falls back to rotating, and
 *    the caller is told via `warnings` rather than silently getting odd output.
 */

export interface RotationDefinition {
  id: number;
  isActive: boolean;
}

export interface RotationWorker {
  id: number;
  /** Pin: this worker always works this shift and never rotates. */
  fixedShiftDefinitionId?: number | null;
}

export interface RotationWarning {
  workerId: number;
  reason: 'inactive-fixed-shift';
  shiftDefinitionId: number;
}

export interface RotationPlan {
  /** weekIndex → workerId → shift definition id. */
  weeks: Array<Map<number, number>>;
  warnings: RotationWarning[];
}

/** The next shift in the cycle, by position in the active-definition ordering. */
export function nextShift(definitionIds: number[], current: number | null | undefined): number {
  if (definitionIds.length === 0) throw new Error('No active shift definitions');
  if (current == null) return definitionIds[0];
  const index = definitionIds.indexOf(current);
  // A worker coming off a since-retired lane rejoins at the start of the cycle.
  if (index === -1) return definitionIds[0];
  return definitionIds[(index + 1) % definitionIds.length];
}

/**
 * The seed shift for a rotating worker with no scheduling history. This is the
 * old positional formula, kept only so a brand-new roster still fans out across
 * the shifts instead of stacking everyone onto shift 1.
 */
export function seedShift(definitionIds: number[], rotatingIndex: number): number {
  return definitionIds[rotatingIndex % definitionIds.length];
}

export interface RotationInput {
  workers: RotationWorker[];
  /** Active definitions in cycle order (by start time). */
  definitions: RotationDefinition[];
  weekCount: number;
  /**
   * The worker's dominant shift in the week immediately before the first
   * generated week, where known. Absent → the worker is seeded positionally.
   */
  previousWeekShift: (workerId: number) => number | null | undefined;
}

export function planRotation(input: RotationInput): RotationPlan {
  const active = input.definitions.filter((d) => d.isActive);
  const definitionIds = active.map((d) => d.id);
  if (definitionIds.length === 0) throw new Error('No active shift definitions');
  const activeSet = new Set(definitionIds);

  const warnings: RotationWarning[] = [];
  // Rotating index is assigned over the rotating workers only, so pinning a
  // worker doesn't renumber — and therefore doesn't reshuffle — the others.
  let rotatingIndex = 0;
  const seeded = input.workers.map((worker) => {
    const pinned = worker.fixedShiftDefinitionId;
    if (pinned != null) {
      if (activeSet.has(pinned)) return { worker, fixed: pinned, start: null as number | null };
      warnings.push({ workerId: worker.id, reason: 'inactive-fixed-shift', shiftDefinitionId: pinned });
    }
    const previous = input.previousWeekShift(worker.id);
    const start = previous != null
      ? nextShift(definitionIds, previous)
      : seedShift(definitionIds, rotatingIndex);
    rotatingIndex += 1;
    return { worker, fixed: null as number | null, start };
  });

  const weeks: Array<Map<number, number>> = [];
  const current = new Map<number, number>();
  for (let weekIndex = 0; weekIndex < input.weekCount; weekIndex++) {
    const week = new Map<number, number>();
    for (const entry of seeded) {
      if (entry.fixed != null) {
        week.set(entry.worker.id, entry.fixed);
        continue;
      }
      const shift = weekIndex === 0
        ? entry.start!
        : nextShift(definitionIds, current.get(entry.worker.id));
      week.set(entry.worker.id, shift);
      current.set(entry.worker.id, shift);
    }
    weeks.push(week);
  }
  return { weeks, warnings };
}

/**
 * A worker's dominant shift across a set of day assignments — the week's shift
 * for display and for anchoring the next week's phase. Ties break toward the
 * earliest-ordered definition so the result is deterministic.
 */
export function dominantShift(
  assignments: Array<{ workerId: number; shiftDefinitionId: number }>,
  workerId: number,
  order: number[] = [],
): number | null {
  const counts = new Map<number, number>();
  for (const a of assignments) {
    if (a.workerId !== workerId) continue;
    counts.set(a.shiftDefinitionId, (counts.get(a.shiftDefinitionId) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  let best: number | null = null;
  let bestCount = -1;
  for (const [id, count] of counts) {
    const rank = order.indexOf(id);
    const bestRank = best == null ? Infinity : order.indexOf(best);
    if (count > bestCount || (count === bestCount && rank !== -1 && rank < bestRank)) {
      best = id;
      bestCount = count;
    }
  }
  return best;
}

/** True when every workday in the week shares one shift (an unsplit week cell). */
export function isUniformWeek(
  assignments: Array<{ workerId: number; shiftDefinitionId: number }>,
  workerId: number,
): boolean {
  const ids = new Set(assignments.filter((a) => a.workerId === workerId).map((a) => a.shiftDefinitionId));
  return ids.size <= 1;
}
