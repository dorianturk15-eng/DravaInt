import type { Machine } from '../machines/MachinesContext';
import type { Job, OperationStep } from './SchedulingContext';
import { splitMachineChain } from './cpm';

/**
 * Phase C — machine identity by id, not name string.
 *
 * Historically every machine reference in the app (board lanes, capacity, Gantt, the legacy
 * `job.machine` chain) matched on the machine's *name*. That silently orphans a schedule the moment
 * a machine is renamed in Admin: the name on the operation no longer equals any lane name.
 *
 * The fix is to carry a stable `machineId` on each {@link OperationStep} (and, server-side, on
 * `jobs.machine_id` for plain jobs) and to *resolve the current display name through that id* at
 * read time. Legacy rows that predate the backfill have no id — those fall back to name matching, so
 * nothing regresses before the backfill runs. See {@link resolveMachineName}.
 */

export interface MachineLookup {
  byId: Map<number, Machine>;
  /** Keyed by trimmed, lower-cased name. First registration wins (matches Admin's dup guard). */
  byName: Map<string, Machine>;
}

export function buildMachineLookup(machines: Machine[]): MachineLookup {
  const byId = new Map<number, Machine>();
  const byName = new Map<string, Machine>();
  for (const machine of machines) {
    byId.set(machine.id, machine);
    const key = machine.name.trim().toLowerCase();
    if (key && !byName.has(key)) byName.set(key, machine);
  }
  return { byId, byName };
}

/**
 * The id a machine reference *should* carry. An explicit id that still exists wins (rename-safe);
 * otherwise we name-match against the current machine list. Returns null when neither resolves —
 * that reference is "unmapped" and surfaces in the Admin report rather than being guessed at.
 */
export function resolveMachineId(
  machineName: string | undefined | null,
  machineId: number | null | undefined,
  lookup: MachineLookup,
): number | null {
  if (machineId != null && lookup.byId.has(machineId)) return machineId;
  const key = (machineName || '').trim().toLowerCase();
  const match = key ? lookup.byName.get(key) : undefined;
  return match ? match.id : null;
}

/**
 * The *current* display name for a machine reference. If it carries a live id, that machine's
 * present-day name is returned (so an Admin rename follows through everywhere); otherwise the stored
 * name string is used verbatim (legacy, pre-backfill). This is the single primitive that makes all
 * downstream name-string matching rename-safe: both sides resolve through the same id first.
 */
export function resolveMachineName(
  machineName: string | undefined | null,
  machineId: number | null | undefined,
  lookup: MachineLookup,
): string {
  if (machineId != null) {
    const match = lookup.byId.get(machineId);
    if (match) return match.name;
  }
  return (machineName || '').trim();
}

export function resolveOpMachineName(op: Pick<OperationStep, 'machine' | 'machineId'>, lookup: MachineLookup): string {
  return resolveMachineName(op.machine, op.machineId, lookup);
}

export interface UnmappedMachineRef {
  jobId: number;
  order: string;
  /** OperationStep id for a routed op; null for a plain job's own machine / chain segment. */
  opId: number | null;
  opName?: string;
  /** The recorded machine name that doesn't resolve to any current machine. */
  machineName: string;
}

/**
 * Every machine reference in `jobs` whose name doesn't resolve to a current machine id — i.e. it has
 * a non-empty name but neither a live `machineId` nor a name that matches the `machines` table. These
 * are exactly the rows a rename would (or already did) orphan; the Admin report lists them so a human
 * can rename the machine back, register the missing machine, or fix the operation.
 */
export function findUnmappedOperationMachines(jobs: Job[], lookup: MachineLookup): UnmappedMachineRef[] {
  const out: UnmappedMachineRef[] = [];
  for (const job of jobs) {
    if (job.operations?.length) {
      for (const op of job.operations) {
        const name = (op.machine || '').trim();
        if (!name) continue;
        if (resolveMachineId(op.machine, op.machineId, lookup) == null) {
          out.push({ jobId: job.id, order: job.order, opId: op.id, opName: op.name, machineName: name });
        }
      }
      continue;
    }
    // Plain / legacy-chain job: each chain segment is a name-only reference (no per-segment id yet).
    for (const name of splitMachineChain(job.machine)) {
      if (resolveMachineId(name, null, lookup) == null) {
        out.push({ jobId: job.id, order: job.order, opId: null, machineName: name });
      }
    }
  }
  return out;
}

/**
 * Operations that depend on a given machine *by name only* (no matching `machineId`), i.e. the ones a
 * rename of that machine would orphan. Used by the Admin rename guard to warn before the name changes
 * out from under un-backfilled rows. Post-backfill this list is empty and renames are safe.
 */
export function findMachineNameDependents(jobs: Job[], machine: Machine): UnmappedMachineRef[] {
  const target = machine.name.trim().toLowerCase();
  if (!target) return [];
  const out: UnmappedMachineRef[] = [];
  for (const job of jobs) {
    if (job.operations?.length) {
      for (const op of job.operations) {
        const name = (op.machine || '').trim();
        if (!name || name.toLowerCase() !== target) continue;
        if (op.machineId !== machine.id) {
          out.push({ jobId: job.id, order: job.order, opId: op.id, opName: op.name, machineName: name });
        }
      }
      continue;
    }
    for (const name of splitMachineChain(job.machine)) {
      if (name.toLowerCase() === target) {
        out.push({ jobId: job.id, order: job.order, opId: null, machineName: name });
      }
    }
  }
  return out;
}
