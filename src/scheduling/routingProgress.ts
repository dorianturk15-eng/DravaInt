import type { Job, OperationStep } from './SchedulingContext';

/**
 * Per-operation state for the Dashboard routing map.
 *
 * The map used to hardcode `i === 1` as the active node, so the *second*
 * operation of every route pulsed blue regardless of what was actually
 * happening — a single-operation job had no active node at all, and a job at
 * 90% still showed step 2 as in progress. There is no per-operation progress
 * column in the schema, so state is derived from the job's own `progress` and
 * `status` by spreading the completed fraction across the routing weighted by
 * each operation's hours (the same weighting the Gantt uses for op windows).
 */
export type OperationState = 'done' | 'active' | 'pending';

/** Ops with no hours still occupy a step; weight them equally so they can't vanish. */
function weights(operations: OperationStep[]): number[] {
  const hours = operations.map((op) => (Number.isFinite(op.hours) && op.hours > 0 ? op.hours : 0));
  const total = hours.reduce((sum, h) => sum + h, 0);
  return total > 0 ? hours : operations.map(() => 1);
}

export function routingStates(job: Pick<Job, 'status' | 'progress' | 'operations'>): OperationState[] {
  const operations = job.operations ?? [];
  if (operations.length === 0) return [];

  // A finished order has no active node — every step is behind it.
  if (job.status === 'done') return operations.map(() => 'done');
  // Nothing has started yet, so nothing is active.
  if (job.status === 'planned') return operations.map(() => 'pending');

  const progress = Math.min(100, Math.max(0, Number.isFinite(job.progress) ? job.progress : 0));
  const w = weights(operations);
  const total = w.reduce((sum, h) => sum + h, 0);
  const completed = total * (progress / 100);

  const states: OperationState[] = [];
  let cursor = 0;
  let activeTaken = false;
  for (let i = 0; i < operations.length; i++) {
    const end = cursor + w[i];
    // Epsilon guards float drift so an exactly-complete op doesn't read as active.
    if (end <= completed + 1e-9) {
      states.push('done');
    } else if (!activeTaken) {
      states.push('active');
      activeTaken = true;
    } else {
      states.push('pending');
    }
    cursor = end;
  }
  return states;
}
