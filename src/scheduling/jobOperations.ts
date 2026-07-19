import type { Job, OperationStep } from './SchedulingContext';
import type { Machine } from '../machines/MachinesContext';
import { buildMachineLookup, resolveMachineId, type MachineLookup } from './machineIdentity';
import { splitMachineChain } from './cpm';

/**
 * Phase D — operations as rows (`public.job_operations`) + DB-level overlap checking.
 *
 * This module is the **pure, tested TypeScript mirror** of what the SQL migration
 * `supabase/migrations/0008_job_operations_table_and_overlap.sql` does on the live database:
 *
 *   1. {@link buildJobOperationRows} — the canonical `jobs.operations` JSONB → `job_operations`
 *      row mapping. The migration's `sync_job_operations()` trigger produces byte-for-byte the same
 *      rows; keeping the mapping defined once (here) and mirrored in SQL is exactly how Phase C kept
 *      `machineBackfill.ts` and its migration in lock-step. The dual-write (JSONB stays the client
 *      write format; rows are derived) is implemented server-side as that trigger, so every existing
 *      client write path (`updateJob`, `addJob`, WorkOrderCreator, board lane-move) keeps both copies
 *      in sync atomically — no client change and no second, racy round-trip.
 *   2. {@link detectOperationOverlaps} — the warn-then-enforce overlap logic. Mirrors the SQL
 *      `job_effective_windows` view + `detect_job_operation_overlaps()` so the vitest suite can prove
 *      the machine-vs-machine, id-vs-name, and routed-vs-plain rules against mocked data before the
 *      trigger is ever pointed at production. Starts in **warn** mode (see the migration): conflicts
 *      are surfaced/logged, never blocked, until an operator flips the enforcement flag.
 *
 * Nothing here performs I/O. Production persistence is the migration + trigger, not this file.
 */

/** One `public.job_operations` row, as derived from a job's `operations` JSONB. */
export interface JobOperationRow {
  jobId: number;
  /** 0-based index within `job.operations` (SQL uses `ordinality - 1`), so `unique(job_id, seq)`. */
  seq: number;
  name: string;
  /** Stored verbatim from the op (Phase C identity). Null on legacy ops; resolved to a live machine
   *  only at read/overlap time, never mutated into the row — the row is a faithful copy of the JSONB. */
  machineId: number | null;
  /** Denormalized display name, trimmed. May be '' for an op with no machine yet (kept, not dropped,
   *  so the row count equals the JSONB length — the checksum the migration verifies). */
  machineName: string;
  /** Never negative. An op with 0 hours is a real (zero-length) step and is kept. */
  hours: number;
  operatorId: number | null;
  operatorName: string;
}

/**
 * The canonical mapping a routed job's `operations` JSONB → `job_operations` rows. A plain job (no
 * `operations` array) contributes **no** rows — its single-machine window is enforced by the legacy
 * `machine`-string branch of `validate_job_assignment`, unchanged. Every operation is emitted (even
 * one with an empty machine or 0 hours) so `count(rows) == jsonb_array_length(operations)` holds; that
 * equality is the migration's post-backfill checksum.
 */
export function buildJobOperationRows(job: Job): JobOperationRow[] {
  const ops = job.operations;
  if (!ops || ops.length === 0) return [];
  return ops.map((op: OperationStep, index) => ({
    jobId: job.id,
    seq: index,
    name: op.name ?? '',
    machineId: op.machineId ?? null,
    machineName: (op.machine ?? '').trim(),
    hours: Math.max(0, op.hours || 0),
    operatorId: op.operatorId ?? null,
    operatorName: (op.operator ?? '').trim(),
  }));
}

/** Per-job checksum the migration verifies (rows written == operations in the JSONB). */
export interface JobOperationChecksum {
  jobId: number;
  order: string;
  jsonbLength: number;
  rowCount: number;
  ok: boolean;
}

export function jobOperationChecksum(job: Job): JobOperationChecksum {
  const jsonbLength = job.operations?.length ?? 0;
  const rowCount = buildJobOperationRows(job).length;
  return { jobId: job.id, order: job.order, jsonbLength, rowCount, ok: jsonbLength === rowCount };
}

// ---------------------------------------------------------------------------------------------------
// Overlap detection — mirror of the SQL `job_effective_windows` view + `detect_job_operation_overlaps`.
// ---------------------------------------------------------------------------------------------------

/**
 * One (machine, time-window) a job effectively occupies, in the exact shape the SQL view produces:
 *  - Routed job → one window per operation, sequential from the job's start (`op.hours` each). These
 *    are the persisted `job_operations` rows laid out against `jobs.start_time`.
 *  - Plain single-machine job (no operations, machine is not a `→` chain) → one window spanning the
 *    whole job. Included so routed-vs-plain double-booking is caught; plain-vs-plain is intentionally
 *    left to the legacy string check (which already hard-enforces it).
 *
 * Legacy chain-string jobs without `operations` are **excluded** here (as in the SQL view): they have
 * no per-segment window we can trust for enforcement. The board still displays them via
 * `operationSlots`; enforcement waits until they're converted to real operations.
 */
export interface EffectiveWindow {
  jobId: number;
  order: string;
  seq: number;
  isOperation: boolean;
  /** Resolution key mirroring {@link resolveMachineId}: an id when the reference resolves to a current
   *  machine (by its own id or a name match), else `name:<normalized>`. This is what makes an
   *  id-carrying op and a name-only op on the *same* machine compare equal (rename-safe). */
  machineKey: string;
  machineName: string;
  startMs: number;
  endMs: number;
}

function machineKey(name: string | null | undefined, id: number | null | undefined, lookup: MachineLookup): string {
  const resolved = resolveMachineId(name, id, lookup);
  return resolved != null ? `id:${resolved}` : `name:${(name || '').trim().toLowerCase()}`;
}

export function expandJobEffectiveWindows(jobs: Job[], machines: Machine[] = []): EffectiveWindow[] {
  const lookup = buildMachineLookup(machines);
  const windows: EffectiveWindow[] = [];
  const hasKids = (id: number) => jobs.some((j) => j.parentId === id);

  for (const job of jobs) {
    if (job.status === 'done') continue;
    if (hasKids(job.id)) continue; // containers contribute nothing; their leaves do
    if (!job.start) continue;
    const start = new Date(job.start).getTime();
    if (Number.isNaN(start)) continue;

    // Routed order: sequential per-operation windows.
    if (job.operations && job.operations.length > 0) {
      let cursor = start;
      job.operations.forEach((op, index) => {
        const opStart = cursor;
        const opEnd = cursor + Math.max(0, op.hours || 0) * 3_600_000;
        cursor = opEnd;
        const name = (op.machine || '').trim();
        if (!name || opEnd <= opStart) return; // empty-machine / zero-length op can't double-book
        windows.push({
          jobId: job.id,
          order: job.order,
          seq: index,
          isOperation: true,
          machineKey: machineKey(op.machine, op.machineId, lookup),
          machineName: name,
          startMs: opStart,
          endMs: opEnd,
        });
      });
      continue;
    }

    // Plain single-machine job: one window over the whole job. Chain strings are excluded (see docs).
    const segments = splitMachineChain(job.machine);
    if (segments.length !== 1) continue;
    if (!job.end) continue;
    const end = new Date(job.end).getTime();
    if (Number.isNaN(end) || end <= start) continue;
    const name = segments[0];
    // Plain jobs resolve by name only: the client Job shape doesn't carry jobs.machine_id (Phase C
    // populates it server-side but the client never reads it). The SQL view keys on that id when set;
    // both sides land on the same 'id:X' key whenever the name is registered, which is the norm. The
    // only divergence is a plain job on a *renamed* machine whose name no longer matches — the same
    // pre-backfill orphan edge documented for routed ops, and rare for plain jobs.
    windows.push({
      jobId: job.id,
      order: job.order,
      seq: 0,
      isOperation: false,
      machineKey: machineKey(name, null, lookup),
      machineName: name,
      startMs: start,
      endMs: end,
    });
  }

  return windows;
}

export interface OperationOverlap {
  jobId: number;
  order: string;
  seq: number;
  otherJobId: number;
  otherOrder: string;
  otherSeq: number;
  machineName: string;
}

function rangesOverlap(a: EffectiveWindow, b: EffectiveWindow): boolean {
  return a.startMs < b.endMs && b.startMs < a.endMs;
}

/**
 * Every routed-operation double-booking across the given jobs: two windows on the same machine whose
 * time ranges overlap, where **at least one side is a real operation** (`isOperation`). Plain-vs-plain
 * pairs are excluded — the legacy `machine`-string check in `validate_job_assignment` already enforces
 * those, so the new op-level check adds exactly the coverage that was missing (routed-vs-routed and
 * routed-vs-plain) without double-reporting.
 *
 * Directed pairs are de-duplicated (each unordered clash reported once, from the lower job id). This
 * mirrors what a single trigger evaluation of `detect_job_operation_overlaps(NEW.id)` would surface
 * for the whole dataset.
 */
export function detectOperationOverlaps(jobs: Job[], machines: Machine[] = []): OperationOverlap[] {
  const windows = expandJobEffectiveWindows(jobs, machines);
  const out: OperationOverlap[] = [];
  for (let i = 0; i < windows.length; i++) {
    for (let k = i + 1; k < windows.length; k++) {
      const a = windows[i];
      const b = windows[k];
      if (a.jobId === b.jobId) continue;
      if (!a.isOperation && !b.isOperation) continue; // plain-vs-plain: legacy check owns it
      if (a.machineKey !== b.machineKey) continue;
      if (!rangesOverlap(a, b)) continue;
      const [lo, hi] = a.jobId <= b.jobId ? [a, b] : [b, a];
      out.push({
        jobId: lo.jobId,
        order: lo.order,
        seq: lo.seq,
        otherJobId: hi.jobId,
        otherOrder: hi.order,
        otherSeq: hi.seq,
        machineName: lo.machineName,
      });
    }
  }
  return out;
}
