import type { Job, OperationStep } from './SchedulingContext';
import type { Machine } from '../machines/MachinesContext';
import { buildMachineLookup, type MachineLookup } from './machineIdentity';
import { splitMachineChain } from './cpm';

/**
 * Phase C backfill planner (pure, no I/O).
 *
 * Mirrors, in TypeScript, exactly what `supabase/migrations/0007_backfill_operation_machine_ids.sql`
 * does on the live database — so the vitest suite (`machineBackfill.test.ts`) can validate the
 * mapping against a mocked/snapshot dataset before anyone runs the SQL, and the standalone dry-run
 * script (`scripts/backfill-machine-ids.mjs`) can print the same plan against a real data export.
 *
 * The rule is deliberately conservative: an operation is only assigned a `machineId` when its
 * recorded machine name matches a current machine (case-insensitive, trimmed) AND it doesn't already
 * carry an id. Names that match nothing are never guessed — they're returned in `unmatched` for a
 * human to reconcile (via the Admin "unmapped machines" report or by registering the machine).
 */

export interface OpBackfillAssignment {
  jobId: number;
  order: string;
  opId: number;
  opName: string;
  machineName: string;
  machineId: number;
}

export interface UnmatchedMachineName {
  jobId: number;
  order: string;
  /** Op id for a routed step; null for a plain/legacy-chain job's own machine name. */
  opId: number | null;
  opName?: string;
  machineName: string;
}

export interface PlainJobBackfillAssignment {
  jobId: number;
  order: string;
  machineName: string;
  machineId: number;
}

export interface BackfillPlan {
  /** Routed-operation id assignments to write into `jobs.operations` JSONB. */
  opAssignments: OpBackfillAssignment[];
  /** Plain single-machine job id assignments to write into `jobs.machine_id`. */
  plainJobAssignments: PlainJobBackfillAssignment[];
  /** Machine names (routed ops and plain/chain jobs) that resolve to no current machine. */
  unmatched: UnmatchedMachineName[];
}

function opHasId(op: OperationStep): boolean {
  return op.machineId != null;
}

/**
 * Computes what a backfill run *would* change, without mutating anything. `opAssignments` and
 * `plainJobAssignments` are the fills to apply; `unmatched` is the report of names that need a human.
 */
export function planBackfill(jobs: Job[], machines: Machine[]): BackfillPlan {
  const lookup: MachineLookup = buildMachineLookup(machines);
  const opAssignments: OpBackfillAssignment[] = [];
  const plainJobAssignments: PlainJobBackfillAssignment[] = [];
  const unmatched: UnmatchedMachineName[] = [];

  for (const job of jobs) {
    if (job.operations?.length) {
      for (const op of job.operations) {
        const name = (op.machine || '').trim();
        if (!name) continue;
        if (opHasId(op)) continue; // never overwrite an existing id
        const match = lookup.byName.get(name.toLowerCase());
        if (match) {
          opAssignments.push({ jobId: job.id, order: job.order, opId: op.id, opName: op.name, machineName: name, machineId: match.id });
        } else {
          unmatched.push({ jobId: job.id, order: job.order, opId: op.id, opName: op.name, machineName: name });
        }
      }
      continue;
    }

    // Plain job → jobs.machine_id. Only single-machine names are backfilled; a legacy chain string
    // ("A → B") has no single owning machine, so each segment is reported as unmatched-for-id instead.
    const segments = splitMachineChain(job.machine);
    if (segments.length === 1) {
      const name = segments[0];
      const match = lookup.byName.get(name.toLowerCase());
      if (match) {
        plainJobAssignments.push({ jobId: job.id, order: job.order, machineName: name, machineId: match.id });
      } else {
        unmatched.push({ jobId: job.id, order: job.order, opId: null, machineName: name });
      }
    } else {
      for (const name of segments) {
        if (!lookup.byName.get(name.toLowerCase())) {
          unmatched.push({ jobId: job.id, order: job.order, opId: null, machineName: name });
        }
      }
    }
  }

  return { opAssignments, plainJobAssignments, unmatched };
}

/**
 * Applies a plan to an in-memory jobs array, returning a new array (used by the dry-run test to prove
 * the resulting rows are what the matching logic then treats as fully mapped). Pure — callers persist
 * the result themselves; production persistence is the SQL migration, not this.
 */
export function applyBackfill(jobs: Job[], plan: BackfillPlan): Job[] {
  const opById = new Map<string, number>();
  for (const a of plan.opAssignments) opById.set(`${a.jobId}:${a.opId}`, a.machineId);
  return jobs.map((job) => {
    if (!job.operations?.length) return job;
    let changed = false;
    const operations = job.operations.map((op) => {
      const id = opById.get(`${job.id}:${op.id}`);
      if (id == null) return op;
      changed = true;
      return { ...op, machineId: id };
    });
    return changed ? { ...job, operations } : job;
  });
}
